/**
 * NovaTune — IPC Handler Registry  [v2 — REVFIX]
 * Registers all inter-process communication handlers between
 * the renderer and main processes.
 *
 * CHANGES v2:
 * - In-flight deduplication for coverart:thumbnail IPC handler:
 *   if multiple renderer calls request the same path+size thumbnail
 *   while sharp is already generating it, they share the same Promise.
 *   Eliminates redundant sharp() calls and disk reads.
 *
 * CHANGES v1:
 * - No changes needed in this file — the previous session's fixes are already here.
 *   (library:get-all keeps file paths, _hasCoverArt flag, sidecar handler, etc.)
 *   This file is versioned for consistency with the other v1 files.
 */

const { ipcMain, dialog, shell, net, BrowserWindow, app } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
// Database is loaded lazily inside registerIPCHandlers() — see the
// try/catch block there for error handling when the native addon is
// missing or compiled for the wrong Electron version.
const FileScanner = require("./fileScanner");
const MetadataReader = require("./metadataReader");
const MetadataWorker = require("./metadataWorker");

// ─── Supported Audio Formats ────────────────────────────────────────
const SUPPORTED_FORMATS = [
  ".mp3",
  ".flac",
  ".wav",
  ".ogg",
  ".m4a",
  ".aac",
  ".wma",
  ".opus",
  ".ape",
  ".wv",
  ".tta",
  ".mpc",
];

// ─── Data Paths ─────────────────────────────────────────────────────
// Resolved lazily inside registerIPCHandlers (after app is ready)
// so app.getPath() is never called at require() time.
let DATA_DIR, PLAYLISTS_DIR, LIBRARY_CACHE, SETTINGS_FILE, DB_FILE;
let libraryCache = null;
let _libraryDirty = false;
let _libraryJsonCache = null; // Cached parsed library to avoid re-parsing row.data JSON
let libraryById = null;
let playlistsCache = null;

// ─── Defaults ───────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  theme: "dark",
  accentColor: "#1DB954",
  volume: 0.5,
  crossfadeDuration: 0,
  equalizer: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  repeatMode: "off",
  shuffle: false,
  showLyrics: false,
  visualizerStyle: "bars",
  scanFolders: [],
  sortOrder: "title",
  sortDirection: "asc",
  miniPlayer: false,
  alwaysOnTop: false,
  hardwareAcceleration: true,
  outputDevice: "default",
};

// ─── Helpers ────────────────────────────────────────────────────────
let db = null;
const DB_SCHEMA = `
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    title TEXT,
    artist TEXT,
    album TEXT,
    genre TEXT,
    year INTEGER,
    duration REAL,
    dateAdded INTEGER,
    filePath TEXT UNIQUE,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_tracks_date_added ON tracks(dateAdded DESC);
  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    createdAt INTEGER,
    updatedAt INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_playlists_updated ON playlists(updatedAt DESC);
  CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlistId TEXT NOT NULL,
    trackId TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    addedAt INTEGER NOT NULL,
    PRIMARY KEY (playlistId, trackId)
  );
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlistId, position);
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(trackId);
  CREATE TABLE IF NOT EXISTS track_covers (
    trackId TEXT PRIMARY KEY,
    coverArt TEXT
  );
`;

function readJSON(filePath, fallback = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (err) {
    console.error(`Failed to read ${filePath}:`, err.message);
  }
  return fallback;
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error(`Failed to write ${filePath}:`, err.message);
    return false;
  }
}

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".wav",
  ".ogg",
  ".m4a",
  ".aac",
  ".opus",
  ".wma",
  ".aiff",
  ".ape",
  ".wv",
  ".mpc",
]);

/**
 * Fast folder fingerprint — async stat walk, no music-metadata parsing.
 * Returns a string like "1126:1718000000000" (fileCount:newestMtime).
 * PERF FIX: Converted from sync to async to avoid blocking the main process
 * event loop. On HDD, the sync version blocked for 50-150ms per call.
 */
const _FP_MAX_CONCURRENT_DIRS = 4;

async function _computeFolderFingerprint(folderPaths) {
  let fileCount = 0;
  let newestMtime = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    const dirs = [];
    const files = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.push(full);
      } else if (
        entry.isFile() &&
        AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        files.push(full);
      }
    }

    if (files.length > 0) {
      const stats = await Promise.allSettled(
        files.map((f) => fs.promises.stat(f)),
      );
      for (const result of stats) {
        if (result.status === "fulfilled") {
          fileCount++;
          if (result.value.mtimeMs > newestMtime)
            newestMtime = result.value.mtimeMs;
        }
      }
    }

    for (let i = 0; i < dirs.length; i += _FP_MAX_CONCURRENT_DIRS) {
      const batch = dirs.slice(i, i + _FP_MAX_CONCURRENT_DIRS);
      await Promise.all(batch.map((d) => walk(d)));
    }
  }

  for (const folder of folderPaths) {
    try {
      await fs.promises.access(folder);
      await walk(folder);
    } catch (_) {}
  }

  return `${fileCount}:${Math.floor(newestMtime)}`;
}

function migrateJsonToDb() {
  const trackCount = db
    .prepare("SELECT COUNT(*) AS count FROM tracks")
    .get().count;
  if (trackCount === 0 && fs.existsSync(LIBRARY_CACHE)) {
    const legacy = readJSON(LIBRARY_CACHE, []);
    if (Array.isArray(legacy) && legacy.length) saveLibrary(legacy);
  }

  const playlistCount = db
    .prepare("SELECT COUNT(*) AS count FROM playlists")
    .get().count;
  if (playlistCount === 0 && fs.existsSync(PLAYLISTS_DIR)) {
    const files = fs
      .readdirSync(PLAYLISTS_DIR)
      .filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const data = readJSON(path.join(PLAYLISTS_DIR, file), {});
      if (!data) continue;
      savePlaylist({
        id: data.id || path.basename(file, ".json"),
        name: data.name || "Unnamed Playlist",
        tracks: Array.isArray(data.tracks) ? data.tracks : [],
        createdAt: data.createdAt || Date.now(),
        updatedAt: data.updatedAt || Date.now(),
      });
    }
  }
}

function migrateDbCovers() {
  try {
    const rows = db.prepare("SELECT id, data FROM tracks").all();
    let migratedCount = 0;

    let needsMigration = false;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const track = JSON.parse(rows[i].data);
      if (track.coverArt) {
        needsMigration = true;
        break;
      }
    }

    if (!needsMigration) return;

    console.log(
      `[database:migration] Migrating cover art for ${rows.length} tracks...`,
    );

    const updateTrack = db.prepare("UPDATE tracks SET data = ? WHERE id = ?");
    const insertCover = db.prepare(
      "INSERT OR REPLACE INTO track_covers (trackId, coverArt) VALUES (?, ?)",
    );

    const tx = db.transaction(() => {
      for (const row of rows) {
        try {
          const track = JSON.parse(row.data);
          if (track.coverArt) {
            const coverArt = track.coverArt;
            const { coverArt: _, ...strippedTrack } = track;
            strippedTrack._hasCoverArt = true;
            updateTrack.run(JSON.stringify(strippedTrack), row.id);
            insertCover.run(row.id, coverArt);
            migratedCount++;
          }
        } catch (_) {}
      }
    });
    tx();
    console.log(
      `[database:migration] Successfully migrated ${migratedCount} cover arts to track_covers table.`,
    );
  } catch (err) {
    console.error("[database:migration] Migration failed:", err.message);
  }
}

function getLibrary() {
  if (!libraryCache) {
    if (_libraryJsonCache && !_libraryDirty) {
      // Reuse previously parsed JSON — avoids JSON.parse(row.data) for every
      // track on every call. This is the hot path when libraryCache is
      // invalidated (e.g., by saveLibrary) but the data hasn't changed.
      libraryCache = _libraryJsonCache;
    } else {
      libraryCache = db
        .prepare(
          "SELECT data FROM tracks ORDER BY dateAdded DESC, title COLLATE NOCASE",
        )
        .all()
        .map((row) => JSON.parse(row.data));
      _libraryJsonCache = libraryCache;
    }
    libraryById = new Map(libraryCache.map((track) => [track.id, track]));
  }
  return libraryCache;
}

async function refreshTrackDateAdded(track) {
  let changed = false;
  try {
    if (track.filePath) {
      try {
        const stat = await fs.promises.stat(track.filePath);
        const mtime = Math.floor(stat.mtimeMs);
        const birthTime = stat.birthtimeMs ? Math.floor(stat.birthtimeMs) : 0;

        const realDate = birthTime || mtime || Date.now();
        if (track.dateAdded !== realDate) {
          track.dateAdded = realDate;
          changed = true;
        }
      } catch (_) {
        // File doesn't exist or can't be stat'd
        if (!track.dateAdded) {
          track.dateAdded = Date.now();
          changed = true;
        }
      }
    } else if (!track.dateAdded) {
      track.dateAdded = Date.now();
      changed = true;
    }
  } catch (err) {
    if (!track.dateAdded) {
      track.dateAdded = Date.now();
      changed = true;
    }
  }

  // Persist updated dateAdded to database if changed
  if (changed) {
    try {
      db.prepare(
        `
        UPDATE tracks 
        SET dateAdded = ?, data = ?
        WHERE id = ?
      `,
      ).run(track.dateAdded, JSON.stringify(track), track.id);
    } catch (err) {
      console.warn(
        `Failed to update dateAdded for track ${track.id}:`,
        err.message,
      );
    }
  }

  return track;
}

function saveLibrary(library) {
  libraryCache = library;
  _libraryJsonCache = library; // Keep JSON parse cache in sync
  libraryById = new Map(library.map((track) => [track.id, track]));

  const tx = db.transaction((tracks) => {
    db.prepare("DELETE FROM tracks").run();
    db.prepare("DELETE FROM track_covers").run();

    const insertTrack = db.prepare(`
      INSERT OR REPLACE INTO tracks
      (id, title, artist, album, genre, year, duration, dateAdded, filePath, data)
      VALUES (@id, @title, @artist, @album, @genre, @year, @duration, @dateAdded, @filePath, @data)
    `);
    const insertCover = db.prepare(`
      INSERT OR REPLACE INTO track_covers (trackId, coverArt) VALUES (?, ?)
    `);

    for (const track of tracks) {
      const newCoverArt = track.coverArt;

      // Determine whether this track has cover art:
      // 1. track.coverArt present → fresh data from a full metadata read
      // 2. track._hasCoverArt = true → art was in track_covers before (will be restored below)
      const hasCoverArt = !!(newCoverArt || track._hasCoverArt);

      const { coverArt: _, ...strippedTrack } = track;
      strippedTrack._hasCoverArt = hasCoverArt;

      insertTrack.run({
        id: track.id,
        title: track.title || "",
        artist: Array.isArray(track.artist)
          ? track.artist.join(", ")
          : track.artist || "",
        album: track.album || "",
        genre: track.genre || "",
        year: Number(track.year) || null,
        duration: Number(track.duration) || 0,
        dateAdded: Number(track.dateAdded) || Date.now(),
        filePath: track.filePath || "",
        data: JSON.stringify(strippedTrack),
      });

      if (newCoverArt) {
        // Fresh cover art from metadata read — save it immediately
        insertCover.run(track.id, newCoverArt);
      }
      // If no fresh coverArt but _hasCoverArt was true, the restore step
      // outside this tx will copy old art back from preExistingCovers.
    }
  });

  // Snapshot existing cover art BEFORE wiping, so we can restore entries
  // for tracks that were cached (have _hasCoverArt but no new coverArt in memory).
  let preExistingCovers;
  try {
    preExistingCovers = new Map(
      db
        .prepare("SELECT trackId, coverArt FROM track_covers")
        .all()
        .map((r) => [r.trackId, r.coverArt]),
    );
  } catch (_) {
    preExistingCovers = new Map();
  }

  tx(library);

  // Restore cover art for cached tracks whose art was in track_covers but
  // wasn't re-read during this scan (track._hasCoverArt=true, track.coverArt=undefined).
  if (preExistingCovers.size > 0) {
    const restoreInsert = db.prepare(
      "INSERT OR IGNORE INTO track_covers (trackId, coverArt) VALUES (?, ?)",
    );
    const restoreTx = db.transaction(() => {
      for (const track of library) {
        if (!track.coverArt && track._hasCoverArt) {
          const oldArt = preExistingCovers.get(track.id);
          if (oldArt) {
            restoreInsert.run(track.id, oldArt);
          }
        }
      }
    });
    restoreTx();
  }

  // Clear the cover-art lookup cache so fresh DB data is used on next request
  if (typeof _coverArtByIdCache !== "undefined") _coverArtByIdCache.clear();
  try {
    const mainModule = require("./main");
    if (mainModule && typeof mainModule.clearProtocolCache === "function") {
      mainModule.clearProtocolCache();
    }
  } catch (_) {}
  return true;
}

function getPlaylists() {
  if (playlistsCache) return playlistsCache;
  const rows = db
    .prepare("SELECT * FROM playlists ORDER BY updatedAt DESC")
    .all();
  const tracksStmt = db.prepare(
    "SELECT trackId FROM playlist_tracks WHERE playlistId = ? ORDER BY position, addedAt",
  );
  playlistsCache = rows.map((row) => ({
    ...row,
    tracks: tracksStmt.all(row.id).map((item) => item.trackId),
  }));
  return playlistsCache;
}

function savePlaylist(playlist) {
  const tx = db.transaction((p) => {
    db.prepare(
      "INSERT OR REPLACE INTO playlists (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)",
    ).run(p.id, p.name, p.createdAt || Date.now(), p.updatedAt || Date.now());
    db.prepare("DELETE FROM playlist_tracks WHERE playlistId = ?").run(p.id);
    const insert = db.prepare(
      "INSERT OR IGNORE INTO playlist_tracks (playlistId, trackId, position, addedAt) VALUES (?, ?, ?, ?)",
    );
    (p.tracks || []).forEach((trackId, index) =>
      insert.run(p.id, trackId, index, Date.now()),
    );
  });
  tx(playlist);
  const idx = getPlaylists().findIndex((p) => p.id === playlist.id);
  if (idx >= 0) playlistsCache[idx] = playlist;
  else playlistsCache.push(playlist);
  return true;
}

function generateTrackId(filePath) {
  return crypto
    .createHash("sha256")
    .update(filePath)
    .digest("hex")
    .substring(0, 16);
}

function isAudioFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_FORMATS.includes(ext);
}

/** Delete a stale playlist collage file from disk cache. */
function _invalidateCollageFile(playlistId) {
  try {
    const collageDir = path.join(
      app.getPath("userData"),
      "cached_covers",
      "collages",
    );
    const collagePath = path.join(collageDir, `${playlistId}.webp`);
    if (fs.existsSync(collagePath)) fs.unlinkSync(collagePath);
  } catch (_) {}
}

function sendProgress(mainWindow, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("library:scan-progress", data);
  }
}

// ─── File Scanner Instance ─────────────────────────────────────────
const fileScanner = new FileScanner(SUPPORTED_FORMATS);
const metadataReader = new MetadataReader();

// ─── Register All Handlers ─────────────────────────────────────────
// smtcBridgeRef: optional { bridge: SMTCBridge } holder — populated by main.js
// after the bridge is initialized. Using a ref object avoids order-of-init issues.
let _smtcBridgeRef = null;

function setSMTCBridge(bridge) {
  _smtcBridgeRef = bridge;
}

function registerIPCHandlers(mainWindow, smtcBridge) {
  // Accept either a direct instance or nothing (main.js can call setSMTCBridge later)
  if (smtcBridge) _smtcBridgeRef = smtcBridge;
  // ── Resolve paths now that app is ready ──────────────────────────
  const isDev =
    process.defaultApp ||
    process.env.NODE_ENV === "development" ||
    process.argv.includes("--dev");
  DATA_DIR = isDev
    ? path.join(__dirname, "..", "data")
    : app.getPath("userData");
  PLAYLISTS_DIR = path.join(DATA_DIR, "playlists");
  LIBRARY_CACHE = path.join(DATA_DIR, "library.json");
  SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
  DB_FILE = path.join(DATA_DIR, "novatune.sqlite");

  [DATA_DIR, PLAYLISTS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  // Set cover art cache directory for metadataReader (must be after DATA_DIR is resolved)
  metadataReader.setCoverCacheDir(path.join(DATA_DIR, "cached_covers"));

  // ── Open SQLite database ─────────────────────────────────────────
  // Wrapped in try/catch so a native-module mismatch (e.g. better-sqlite3
  // compiled for Node instead of Electron) is reported clearly instead of
  // crashing the entire registerIPCHandlers() call, which would silently
  // leave ALL IPC handlers unregistered and break the whole app.
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch (err) {
    console.error(
      "[FATAL] better-sqlite3 failed to load — the native addon is missing or " +
        "compiled for the wrong Node/Electron version. Run `npx electron-rebuild` " +
        "or `npm rebuild better-sqlite3 --runtime=electron --target=28.1.0` to fix.\n" +
        "Original error:",
      err.message,
    );
    // Return early so the caller knows something went wrong.  Without a
    // working database the app cannot function, but at least the protocol
    // handler (registered separately) will still serve audio files.
    return;
  }
  db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -20000");
  db.pragma("temp_store = MEMORY");
  db.pragma("mmap_size = 268435456");
  db.exec(DB_SCHEMA);

  migrateJsonToDb();
  migrateDbCovers();
  // ═══════════════════════════════════════════════════════════════════
  // LIBRARY IPC
  // ═══════════════════════════════════════════════════════════════════

  ipcMain.handle("library:scan", async (event, folderPath) => {
    try {
      console.log(`[library:scan] Scanning folder: ${folderPath}`);
      sendProgress(mainWindow, {
        stage: "scanning",
        current: 0,
        total: 0,
        folder: folderPath,
        message: "Scanning for audio files...",
      });

      // Save folder to settings
      try {
        const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
        const scanFolders = Array.isArray(settings.scanFolders)
          ? settings.scanFolders
          : [];
        if (!scanFolders.includes(folderPath)) {
          scanFolders.push(folderPath);
          settings.scanFolders = scanFolders;
          writeJSON(SETTINGS_FILE, settings);
        }
      } catch (err) {
        console.error("Failed to save scanFolders settings:", err.message);
      }

      // Phase 1: Scan filesystem for audio files
      const files = await fileScanner.scanDirectory(folderPath);
      const totalFiles = files.length;
      console.log(`[library:scan] Found ${totalFiles} audio files`);

      if (totalFiles === 0) {
        sendProgress(mainWindow, {
          stage: "complete",
          current: 0,
          total: 0,
          message: "No audio files found in this folder.",
        });
        return { success: true, tracks: [], newTracks: 0 };
      }

      sendProgress(mainWindow, {
        stage: "reading",
        current: 0,
        total: totalFiles,
        folder: folderPath,
        message: `Reading metadata (0 / ${totalFiles})...`,
      });

      // Phase 2: Read metadata for each file (optimized using database cache)
      const existingLibrary = getLibrary();
      const existingMap = new Map(existingLibrary.map((t) => [t.filePath, t]));

      const tracks = [];
      let failedCount = 0;
      let skippedCount = 0;
      const startTime = Date.now();

      // PERF FIX: Worker pool — spawn N workers and saturate all of them in
      // parallel. On HDD, one worker reads ~20 files/s; 4 workers = ~80/s
      // because each read is mostly waiting on disk seeks, not CPU.
      const WORKER_POOL_SIZE = 4;
      const coverCacheDir = path.join(app.getPath("userData"), "cached_covers");
      let workerPool = [];
      let useWorker = true;
      try {
        for (let w = 0; w < WORKER_POOL_SIZE; w++) {
          const worker = new MetadataWorker();
          worker.setCoverCacheDir(coverCacheDir);
          workerPool.push(worker);
        }
      } catch (err) {
        console.warn(
          "[library:scan] MetadataWorker pool unavailable, using main thread:",
          err.message,
        );
        useWorker = false;
        workerPool = [];
      }

      // Split files into cached (skip) and needing parse
      const toScan = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const existing = existingMap.get(file.filePath);
        const hasGoodMetadata =
          existing &&
          existing.artist &&
          existing.artist !== "Unknown Artist" &&
          existing.album &&
          existing.album !== "Unknown Album";
        const hasCoverArt =
          existing &&
          (existing._hasCoverArt === true ||
            (existing.coverArt && !/base64,\d+/.test(existing.coverArt)));
        if (
          existing &&
          hasGoodMetadata &&
          existing.dateModified === file.modifiedTime &&
          hasCoverArt &&
          existing.duration > 0
        ) {
          tracks.push(existing);
          skippedCount++;
        } else {
          toScan.push({ file, globalIdx: i });
        }
      }

      // Send initial progress for cached files
      if (skippedCount > 0) {
        const pct = Math.round((skippedCount / totalFiles) * 100);
        sendProgress(mainWindow, {
          stage: "reading",
          current: skippedCount,
          total: totalFiles,
          percent: pct,
          message: `Reading metadata (${skippedCount} / ${totalFiles}) — ${pct}% (cached: ${skippedCount})`,
        });
      }

      // ── Parallel scan with worker pool ──────────────────────────────────
      // Process toScan in chunks equal to pool size so every worker is busy.
      let doneCount = skippedCount;
      const CHUNK = useWorker ? WORKER_POOL_SIZE : 1;

      for (let ci = 0; ci < toScan.length; ci += CHUNK) {
        const chunk = toScan.slice(ci, ci + CHUNK);
        const chunkResults = await Promise.allSettled(
          chunk.map(async ({ file }, wi) => {
            let metadata;
            if (useWorker && workerPool.length > 0) {
              const worker = workerPool[wi % workerPool.length];
              try {
                metadata = await worker.readMetadata(file.filePath);
              } catch (_) {
                metadata = await metadataReader.readMetadata(file.filePath);
              }
            } else {
              metadata = await metadataReader.readMetadata(file.filePath);
            }
            return { file, metadata };
          }),
        );

        for (const settled of chunkResults) {
          doneCount++;
          if (settled.status === "fulfilled") {
            const { file, metadata } = settled.value;
            // QuickInfo fallback for 0-duration
            if (metadata.duration <= 0) {
              try {
                const worker = workerPool[0];
                const quickInfo =
                  useWorker && worker
                    ? await worker
                        .readQuickInfo(file.filePath)
                        .catch(() =>
                          metadataReader.readQuickInfo(file.filePath),
                        )
                    : await metadataReader.readQuickInfo(file.filePath);
                if (quickInfo && quickInfo.duration > 0) {
                  metadata.duration = quickInfo.duration;
                  if (!metadata.bitrate)
                    metadata.bitrate = quickInfo.bitrate || 0;
                  if (!metadata.sampleRate)
                    metadata.sampleRate = quickInfo.sampleRate || 0;
                  if (!metadata.channels)
                    metadata.channels = quickInfo.channels || 2;
                }
              } catch (_) {}
            }
            if (metadata.duration <= 0) {
              console.log(
                `[library:scan] Skipping 0:00 track: ${file.filePath}`,
              );
            } else {
              tracks.push({
                id: generateTrackId(file.filePath),
                filePath: file.filePath,
                fileName: file.fileName,
                title:
                  metadata.title ||
                  path.basename(file.fileName, path.extname(file.fileName)),
                artist: metadata.artist || "Unknown Artist",
                album: metadata.album || "Unknown Album",
                albumArtist: metadata.albumArtist || "",
                genre: metadata.genre || "",
                year: metadata.year || 0,
                trackNumber: metadata.trackNumber || 0,
                discNumber: metadata.discNumber || 0,
                duration: metadata.duration || 0,
                bitrate: metadata.bitrate || 0,
                sampleRate: metadata.sampleRate || 0,
                channels: metadata.channels || 2,
                format:
                  metadata.format ||
                  path.extname(file.fileName).replace(".", "").toUpperCase(),
                fileSize: file.fileSize || metadata.fileSize || 0,
                coverArt: metadata.coverArt || null,
                dateAdded: file.birthTime || file.modifiedTime || Date.now(),
                dateModified: file.modifiedTime || Date.now(),
              });
            }
          } else {
            // Promise rejected — try quickInfo fallback
            const { file } = toScan[ci + chunkResults.indexOf(settled)];
            try {
              const quickInfo = await metadataReader.readQuickInfo(
                file.filePath,
              );
              if (quickInfo && quickInfo.duration > 0) {
                const nameNoExt = path.basename(
                  file.fileName,
                  path.extname(file.fileName),
                );
                let title = nameNoExt;
                let artist = "Unknown Artist";
                const dashIdx = nameNoExt.indexOf(" - ");
                if (dashIdx > 0) {
                  artist = nameNoExt.substring(0, dashIdx).trim();
                  title = nameNoExt.substring(dashIdx + 3).trim();
                }
                title = title.replace(/^\d+[._\s]+/, "").trim() || title;
                tracks.push({
                  id: generateTrackId(file.filePath),
                  filePath: file.filePath,
                  fileName: file.fileName,
                  title,
                  artist,
                  album: "Unknown Album",
                  albumArtist: "",
                  genre: "",
                  year: 0,
                  trackNumber: 0,
                  discNumber: 0,
                  duration: quickInfo.duration,
                  bitrate: quickInfo.bitrate || 0,
                  sampleRate: quickInfo.sampleRate || 0,
                  channels: quickInfo.channels || 2,
                  format: path
                    .extname(file.fileName)
                    .replace(".", "")
                    .toUpperCase(),
                  fileSize: file.fileSize || 0,
                  coverArt: null,
                  dateAdded: file.birthTime || file.modifiedTime || Date.now(),
                  dateModified: file.modifiedTime || Date.now(),
                });
              } else {
                failedCount++;
              }
            } catch (_) {
              failedCount++;
            }
          }
        }

        // Progress after each chunk
        {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const pct = Math.round((doneCount / totalFiles) * 100);
          sendProgress(mainWindow, {
            stage: "reading",
            current: doneCount,
            total: totalFiles,
            folder: folderPath,
            percent: pct,
            elapsed,
            failedCount,
            message: `Reading metadata (${doneCount} / ${totalFiles}) — ${pct}%`,
          });
        }
      }

      // Phase 3: Merge with existing library
      sendProgress(mainWindow, {
        stage: "saving",
        current: totalFiles,
        total: totalFiles,
        message: "Saving library...",
      });

      const existingLibrary2 = getLibrary();
      const existingMap2 = new Map(existingLibrary2.map((t) => [t.id, t]));

      // Clear any tracks from existingMap2 that were in this scan's folder (handles deleted/skipped files)
      const normalizedFolder = folderPath.replace(/\\/g, "/").toLowerCase();
      for (const [id, t] of existingMap2.entries()) {
        if (
          t.filePath &&
          t.filePath
            .replace(/\\/g, "/")
            .toLowerCase()
            .startsWith(normalizedFolder)
        ) {
          existingMap2.delete(id);
        }
      }

      for (const track of tracks) {
        existingMap2.set(track.id, track);
      }

      // Clean up any remaining tracks anywhere in the library database that have duration <= 0
      for (const [id, track] of existingMap2.entries()) {
        if (track.duration <= 0) {
          existingMap2.delete(id);
        }
      }

      const mergedLibrary = Array.from(existingMap2.values());
      // PERF FIX: Refresh dateAdded during scans (not at startup).
      // This is the right place: files are already being accessed,
      // and the scan runs in the background with progress reporting.
      // Do it asynchronously to avoid blocking the event loop.
      const dateRefreshBatch = 50;
      for (let i = 0; i < mergedLibrary.length; i += dateRefreshBatch) {
        const batch = mergedLibrary.slice(i, i + dateRefreshBatch);
        await Promise.all(batch.map((track) => refreshTrackDateAdded(track)));
        // Yield to event loop between batches
        if (i + dateRefreshBatch < mergedLibrary.length) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      saveLibrary(mergedLibrary);

      // Clean up worker pool
      for (const w of workerPool) w.shutdown();
      workerPool = [];

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        `[library:scan] Done! ${mergedLibrary.length} tracks in library (${tracks.length} scanned/checked, ${skippedCount} skipped/cached, ${failedCount} failed) in ${elapsed}s`,
      );

      sendProgress(mainWindow, {
        stage: "complete",
        current: totalFiles,
        total: totalFiles,
        newTracks: tracks.length,
        totalTracks: mergedLibrary.length,
        failedCount,
        elapsed,
        message: `Done! Checked ${tracks.length} tracks (${skippedCount} from cache) in ${elapsed}s`,
      });

      // Save fingerprint so next startup can skip the scan if nothing changed
      try {
        const fp = await _computeFolderFingerprint([folderPath]);
        const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
        settings._scanFingerprints = settings._scanFingerprints || {};
        settings._scanFingerprints[folderPath] = fp;
        writeJSON(SETTINGS_FILE, settings);
      } catch (_) {}

      return { success: true, tracks: mergedLibrary, newTracks: tracks.length };
    } catch (err) {
      console.error("[library:scan] Error:", err);
      sendProgress(mainWindow, {
        stage: "error",
        message: `Scan failed: ${err.message}`,
      });
      return { success: false, error: err.message };
    }
  });

  // ─── Quick fingerprint check: does the folder need re-scanning? ──
  // Walks the directory structure reading only file stat (mtime + size),
  // NOT music-metadata. Takes ~5-50ms vs ~30-120s for a full scan.
  // Returns { needsScan: true/false } so the renderer can skip the
  // deferred background scan on clean startups.
  ipcMain.handle("library:needs-scan", async (event, folderPaths) => {
    try {
      const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
      const saved = settings._scanFingerprints || {};
      for (const folder of folderPaths) {
        const current = await _computeFolderFingerprint([folder]);
        if (saved[folder] !== current) {
          console.log(`[library:needs-scan] Change detected in: ${folder}`);
          return { needsScan: true };
        }
      }
      return { needsScan: false };
    } catch (err) {
      // On any error, default to scanning to be safe
      return { needsScan: true };
    }
  });

  ipcMain.handle("library:get-all", async () => {
    try {
      const library = getLibrary();
      // PERF FIX: Do NOT call refreshTrackDateAdded() on startup.
      // On HDD, fs.statSync() per track causes 10-20s of blocking I/O.
      // dateAdded is now cached in SQLite and only refreshed during scans.
      // See: refreshTrackDateAdded() still used in library:scan for correctness.
      return { success: true, tracks: library };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Paginated library access (for very large libraries) ──────────
  // PERF FIX: Returns library in pages so the renderer can start rendering
  // the first page immediately while loading the rest in the background.
  // This cuts time-to-first-paint for 5000+ track libraries.
  ipcMain.handle("library:get-page", async (event, { page, pageSize }) => {
    try {
      const p = Math.max(0, page || 0);
      const ps = Math.max(1, Math.min(pageSize || 500, 2000));
      const start = p * ps;

      // FAST PATH: library already fully cached in memory (warm) — just slice it.
      if (libraryCache) {
        const tracks = libraryCache.slice(start, start + ps);
        return {
          success: true,
          tracks,
          page: p,
          pageSize: ps,
          total: libraryCache.length,
          hasMore: start + ps < libraryCache.length,
        };
      }

      // COLD PATH: nothing cached yet — hit SQLite directly with LIMIT/OFFSET
      // using the dateAdded index, so we only read+parse the rows this page
      // needs instead of the entire table. Critical for 10k+ libraries on HDD:
      // avoids one huge synchronous JSON.parse() of every track just to
      // return the first 500.
      const total = db.prepare("SELECT COUNT(*) AS c FROM tracks").get().c;
      const rows = db
        .prepare(
          "SELECT data FROM tracks ORDER BY dateAdded DESC, title COLLATE NOCASE LIMIT ? OFFSET ?",
        )
        .all(ps, start);
      const tracks = rows.map((row) => JSON.parse(row.data));

      // Warm the full in-memory cache in the background (off the response
      // path) so libraryById is populated for other handlers and later
      // pages can hit the fast in-memory slice path above.
      setImmediate(() => {
        try {
          getLibrary();
        } catch (err) {
          console.warn(
            "[library:get-page] Background warm failed:",
            err.message,
          );
        }
      });

      return {
        success: true,
        tracks,
        page: p,
        pageSize: ps,
        total,
        hasMore: start + ps < total,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Cover Art: fetch single track's cover art by trackId ──────────
  ipcMain.handle("coverart:get", async (event, trackId) => {
    try {
      const row = db
        .prepare("SELECT coverArt FROM track_covers WHERE trackId = ?")
        .get(trackId);
      return { success: true, coverArt: row ? row.coverArt : null };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Cover Art: batch thumbnails for all tracks with art ─────
  // Revolutionary: Uses Sharp (libvips) for 5-10x faster thumbnail generation.
  // Saves WebP thumbnails to disk for protocol URL serving (nova-media://thumb/)
  // instead of base64 data URIs — native browser caching, faster decode.
  // Also generates ThumbHash (~100 byte) hashes for instant blurred placeholders.
  ipcMain.handle("coverart:get-all-thumbs", async (event, { size } = {}) => {
    try {
      const sharp = require("sharp");
      const library = getLibrary();
      const targetSize = size || 48;
      const thumbDir = path.join(
        app.getPath("userData"),
        "cached_covers",
        "thumbs",
      );
      if (!fs.existsSync(thumbDir))
        await fs.promises.mkdir(thumbDir, { recursive: true });

      const thumbs = {};
      const thumbHashes = {};

      // Process in parallel batches of 8 for speed
      const BATCH = 8;
      // Include tracks with coverArt OR _hasCoverArt flag (base64 was stripped but exists in DB)
      const tracks = library.filter(
        (t) => (t.coverArt || t._hasCoverArt) && t.id,
      );

      for (let i = 0; i < tracks.length; i += BATCH) {
        const batch = tracks.slice(i, i + BATCH);
        await Promise.allSettled(
          batch.map(async (track) => {
            try {
              const thumbFile = path.join(
                thumbDir,
                `${track.id}_${targetSize}.webp`,
              );

              // Check if thumbnail already exists on disk
              const alreadyExists = await fs.promises
                .access(thumbFile)
                .then(() => true)
                .catch(() => false);
              if (alreadyExists) {
                // Return protocol URL instead of base64 - browser caches natively
                thumbs[track.id] =
                  `nova-media://thumb/${track.id}/${targetSize}`;
                return;
              }

              // Load source image
              let inputBuffer;
              if (track.coverArt.startsWith("data:")) {
                const base64 = track.coverArt.split(",")[1];
                if (!base64) return;
                inputBuffer = Buffer.from(base64, "base64");
              } else {
                try {
                  inputBuffer = await fs.promises.readFile(track.coverArt);
                } catch (_) {
                  // Stale coverArt path — file no longer exists. Clear it in SQLite
                  // so it doesn't waste time on every future launch.
                  if (libraryById && libraryById.has(track.id)) {
                    libraryById.get(track.id).coverArt = null;
                    _libraryDirty = true;
                  }
                  return;
                }
              }

              // Use sharp to generate thumbnail with dark background (eliminates white borders)
              // Center-crop to square, resize, output as WebP
              const metadata = await sharp(inputBuffer).metadata();
              const side = Math.min(metadata.width, metadata.height);
              const left = Math.floor((metadata.width - side) / 2);
              const top = Math.floor((metadata.height - side) / 2);

              const thumbBuffer = await sharp(inputBuffer)
                .extract({ left, top, width: side, height: side })
                .resize(targetSize, targetSize, { fit: "cover" })
                .webp({ quality: 75 }) // WebP: 25-35% smaller than PNG, faster decode
                .toBuffer();

              // Save to disk for future use
              await fs.promises.writeFile(thumbFile, thumbBuffer);

              // Return protocol URL
              thumbs[track.id] = `nova-media://thumb/${track.id}/${targetSize}`;

              // Generate ThumbHash for instant placeholder (only for 48px thumbs)
              if (targetSize <= 48) {
                try {
                  const { rgbaToThumbHash } = require("thumbhash");
                  // Create a tiny 4x4 version for ThumbHash
                  const tinyPng = await sharp(inputBuffer)
                    .extract({ left, top, width: side, height: side })
                    .resize(4, 4)
                    .raw()
                    .toBuffer();

                  // Convert to ThumbHash
                  const hash = rgbaToThumbHash(4, 4, tinyPng);
                  thumbHashes[track.id] = Buffer.from(hash).toString("base64");
                } catch (e) {
                  // ThumbHash generation is optional - don't fail
                }
              }
            } catch (_) {
              // Skip broken art silently
            }
          }),
        );
        // Yield to event loop between batches to prevent IPC stalls.
        await new Promise((resolve) => setImmediate(resolve));

        // Back off harder while audio is actively streaming so nova-media://
        // requests never queue up behind background thumbnail I/O.
        if (Date.now() - (global._lastAudioActivity || 0) < 1500) {
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
      }
      // Persist any stale path cleanups to disk
      if (_libraryDirty) {
        saveLibrary(getLibrary());
        _libraryDirty = false;
      }
      return { success: true, thumbs, thumbHashes };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Cover Art: return resized thumbnail via protocol URL ─────────
  // Uses Sharp for 5-10x faster generation, saves WebP to disk cache,
  // returns nova-media://cover/ URL for native browser caching.
  // REVFIX v2: In-flight deduplication — if multiple renderer calls request
  // the same path+size while sharp is already generating, they share
  // the same Promise. Eliminates redundant sharp() + disk I/O.
  const _ipcThumbInFlight = new Map(); // `${pathHash}_${size}` → Promise
  ipcMain.handle(
    "coverart:thumbnail",
    async (event, { path: filePath, size }) => {
      try {
        const targetSize = Math.max(32, Math.min(size || 200, 800));
        const thumbDir = path.join(
          app.getPath("userData"),
          "cached_covers",
          "thumbs",
        );
        if (!fs.existsSync(thumbDir))
          fs.mkdirSync(thumbDir, { recursive: true });

        // Create a hash-based filename for the thumbnail
        const pathHash = crypto
          .createHash("md5")
          .update(filePath || "")
          .digest("hex")
          .substring(0, 12);
        const thumbFile = path.join(
          thumbDir,
          `path_${pathHash}_${targetSize}.webp`,
        );

        // Check disk cache
        if (fs.existsSync(thumbFile)) {
          return {
            success: true,
            url: `nova-media://cover/${encodeURIComponent(thumbFile)}`,
          };
        }

        // REVFIX v2: In-flight deduplication — check if sharp is already generating
        const dedupeKey = `${pathHash}_${targetSize}`;
        if (_ipcThumbInFlight.has(dedupeKey)) {
          // Wait for the in-flight generation, then return from disk cache
          try {
            await _ipcThumbInFlight.get(dedupeKey);
          } catch (_) {}
          if (fs.existsSync(thumbFile)) {
            return {
              success: true,
              url: `nova-media://cover/${encodeURIComponent(thumbFile)}`,
            };
          }
          return { success: false, error: "Thumbnail generation failed" };
        }

        // Start generation
        const genPromise = (async () => {
          const sharp = require("sharp");
          let inputBuffer;
          if (filePath && filePath.startsWith("data:")) {
            const base64 = filePath.split(",")[1];
            if (!base64) throw new Error("Invalid data URI");
            inputBuffer = Buffer.from(base64, "base64");
          } else if (filePath && fs.existsSync(filePath)) {
            inputBuffer = fs.readFileSync(filePath);
          } else {
            throw new Error("File not found");
          }

          const metadata = await sharp(inputBuffer).metadata();
          const side = Math.min(metadata.width, metadata.height);
          const left = Math.floor((metadata.width - side) / 2);
          const top = Math.floor((metadata.height - side) / 2);

          const thumbBuffer = await sharp(inputBuffer)
            .extract({ left, top, width: side, height: side })
            .resize(targetSize, targetSize, { fit: "cover" })
            .webp({ quality: 80 })
            .toBuffer();

          fs.writeFileSync(thumbFile, thumbBuffer);
          return thumbFile;
        })();

        _ipcThumbInFlight.set(dedupeKey, genPromise);
        try {
          await genPromise;
          return {
            success: true,
            url: `nova-media://cover/${encodeURIComponent(thumbFile)}`,
          };
        } finally {
          _ipcThumbInFlight.delete(dedupeKey);
        }
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  );

  // ─── Cover Art: batch decode ThumbHashes to PNG data URLs ──────────
  // The renderer stores ThumbHash hashes but needs actual image data to display.
  // This handler decodes ALL hashes at once and returns data URLs.
  // Decoding is ~0.1ms per hash, so 1000 tracks = ~100ms total.
  // Also returns RGBA data for dominant color extraction (revolutionary instant backgrounds).
  ipcMain.handle("coverart:decode-thumbhashes", async (event, { hashes }) => {
    try {
      const { thumbHashToRGBA } = require("thumbhash");
      const results = {};
      const rgbaResults = {};
      for (const [trackId, hashB64] of Object.entries(hashes)) {
        try {
          const hashArr = Uint8Array.from(atob(hashB64), (c) =>
            c.charCodeAt(0),
          );
          const { width, height, rgba } = thumbHashToRGBA(hashArr);
          // Create a small PNG from the RGBA data using sharp
          const sharp = require("sharp");
          const pngBuffer = await sharp(Buffer.from(rgba), {
            raw: { width, height, channels: 4 },
          })
            .png()
            .toBuffer();
          results[trackId] =
            `data:image/png;base64,${pngBuffer.toString("base64")}`;
          // Also return raw RGBA for dominant color extraction on the renderer side
          rgbaResults[trackId] = { width, height, data: Array.from(rgba) };
        } catch (_) {
          // Skip failed decodes
        }
      }
      return { success: true, dataURLs: results, rgbaData: rgbaResults };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Cover Art: generate ThumbHash for a single track ─────────────
  // Returns a ~100 byte base64-encoded ThumbHash that the renderer decodes
  // instantly as a blurred color preview — eliminates ALL black cards.
  ipcMain.handle("coverart:generate-thumbhash", async (event, { trackId }) => {
    try {
      const sharp = require("sharp");
      const { rgbaToThumbHash } = require("thumbhash");
      getLibrary();
      const track = libraryById && libraryById.get(trackId);
      if (!track || !track.coverArt)
        return { success: false, error: "No cover art" };

      let inputBuffer;
      if (track.coverArt.startsWith("data:")) {
        const base64 = track.coverArt.split(",")[1];
        if (!base64) return { success: false, error: "Invalid data URI" };
        inputBuffer = Buffer.from(base64, "base64");
      } else if (fs.existsSync(track.coverArt)) {
        inputBuffer = fs.readFileSync(track.coverArt);
      } else {
        return { success: false, error: "File not found" };
      }

      const metadata = await sharp(inputBuffer).metadata();
      const side = Math.min(metadata.width, metadata.height);
      const left = Math.floor((metadata.width - side) / 2);
      const top = Math.floor((metadata.height - side) / 2);

      const tinyRaw = await sharp(inputBuffer)
        .extract({ left, top, width: side, height: side })
        .resize(4, 4)
        .raw()
        .toBuffer();

      const hash = rgbaToThumbHash(4, 4, tinyRaw);
      return { success: true, thumbHash: Buffer.from(hash).toString("base64") };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("library:search", async (event, query) => {
    try {
      const q = query.toLowerCase().trim();

      if (!q) return { success: true, tracks: getLibrary() };

      const like = `%${q}%`;
      const results = db
        .prepare(
          `
          SELECT data FROM tracks
          WHERE title LIKE ? COLLATE NOCASE
             OR artist LIKE ? COLLATE NOCASE
             OR album LIKE ? COLLATE NOCASE
             OR genre LIKE ? COLLATE NOCASE
          ORDER BY title COLLATE NOCASE
        `,
        )
        .all(like, like, like, like)
        .map((row) => JSON.parse(row.data));

      return { success: true, tracks: results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("library:get-by-id", async (event, trackId) => {
    try {
      getLibrary();
      const track = libraryById.get(trackId);
      if (track) {
        return { success: true, track };
      }
      return { success: false, error: "Track not found" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("library:clear", async () => {
    try {
      saveLibrary([]);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Library: remove a single track by ID ──
  ipcMain.handle("library:remove-track", async (event, trackId) => {
    try {
      const library = getLibrary();
      const filtered = library.filter((t) => t.id !== trackId);
      if (filtered.length === library.length)
        return { success: true, removed: false };
      saveLibrary(filtered);
      return { success: true, removed: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Cover Art: find sidecar cover art in the audio file's directory ──
  // Revolutionary: This handler was MISSING — the renderer called it via
  // window.novaAPI.invoke("coverart:find-sidecar") but it was never registered,
  // causing the probe to fail and disabling ALL sidecar searches permanently.
  // Now searches for: cover.jpg, folder.jpg, album.jpg, front.jpg, artwork.jpg,
  // art.jpg, thumbnail.jpg, AlbumArt_{GUID}_Large.jpg, AlbumArtSmall.jpg
  ipcMain.handle("coverart:find-sidecar", async (event, filePath) => {
    try {
      // Probe support — renderer sends "__probe__" to test if handler exists
      if (filePath === "__probe__") return { success: true, coverArt: null };

      if (!filePath || !fs.existsSync(filePath))
        return { success: true, coverArt: null };
      const dir = path.dirname(filePath);
      const IMAGE_EXTS = new Set([
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".bmp",
        ".gif",
      ]);

      // Sidecar filenames to check (most common first)
      const sidecarNames = [
        "cover.jpg",
        "cover.jpeg",
        "cover.png",
        "cover.webp",
        "folder.jpg",
        "folder.jpeg",
        "folder.png",
        "album.jpg",
        "album.jpeg",
        "album.png",
        "front.jpg",
        "front.jpeg",
        "front.png",
        "artwork.jpg",
        "artwork.jpeg",
        "artwork.png",
        "art.jpg",
        "art.jpeg",
        "art.png",
        "thumbnail.jpg",
        "thumbnail.jpeg",
      ];

      // Try exact sidecar filenames first (fast path)
      for (const name of sidecarNames) {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate)) {
          return { success: true, coverArt: candidate };
        }
      }

      // Now do a full directory scan for: WMP caches, .novaart files, and any image
      let fallbackCandidate = null;
      try {
        const files = fs.readdirSync(dir);
        const audioName = path
          .basename(filePath, path.extname(filePath))
          .toLowerCase();

        for (const file of files) {
          const lower = file.toLowerCase();
          const fileExt = path.extname(lower);

          // WMP hidden album art cache
          if (
            (lower.startsWith("albumart_") &&
              (lower.endsWith("_large.jpg") || lower.endsWith("_small.jpg"))) ||
            lower === "albumartsmall.jpg"
          ) {
            const fullPath = path.join(dir, file);
            if (lower.includes("large")) {
              return { success: true, coverArt: fullPath };
            }
            fallbackCandidate = fallbackCandidate || fullPath;
          }

          // .novaart sidecar files (downloaded online art)
          if (lower.includes(".novaart") && IMAGE_EXTS.has(fileExt)) {
            return { success: true, coverArt: path.join(dir, file) };
          }

          // Exact name match (Song.jpg for Song.mp3)
          if (IMAGE_EXTS.has(fileExt)) {
            const nameNoExt = path
              .basename(file, path.extname(file))
              .toLowerCase();
            if (nameNoExt === audioName) {
              return { success: true, coverArt: path.join(dir, file) };
            }
          }
        }

        // Last resort: any image file in the directory (size-gated to avoid icons)
        if (!fallbackCandidate) {
          for (const file of files) {
            const fileExt = path.extname(file).toLowerCase();
            if (IMAGE_EXTS.has(fileExt)) {
              const fullPath = path.join(dir, file);
              try {
                const stat = fs.statSync(fullPath);
                if (stat.size >= 5000) {
                  fallbackCandidate = fullPath;
                  break;
                }
              } catch (_) {}
            }
          }
        }
      } catch (_) {}

      if (fallbackCandidate) {
        return { success: true, coverArt: fallbackCandidate };
      }

      return { success: true, coverArt: null };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Cover Art: Exhaustive Filesystem Search ─────────────────────────
  // When a card has no cover art, this handler does a deep, exhaustive search
  // across the filesystem to find ANY usable image. Searches:
  //   1. Same directory — ALL image files (not just common names)
  //   2. .novaart sidecar files (downloaded art from iTunes/Deezer)
  //   3. Parent directory — common cover art names
  //   4. Parent directory — ANY image file
  //   5. Subdirectories (1 level deep) — common cover art names
  //   6. Subdirectories (1 level deep) — ANY image file
  //   7. Recursive walk up to 3 parent levels
  // The goal is simple: ALWAYS display cover art. Never show a blank card
  // if there's an image file anywhere nearby in the filesystem.
  ipcMain.handle("coverart:exhaustive-search", async (event, filePaths) => {
    try {
      // Support both single path and array of paths (for album groups with multiple tracks)
      const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
      const IMAGE_EXTS = new Set([
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".bmp",
        ".gif",
        ".tiff",
        ".tif",
      ]);
      const COMMON_NAMES = new Set([
        "cover",
        "folder",
        "album",
        "front",
        "artwork",
        "art",
        "thumb",
        "thumbnail",
        "back",
        "insert",
        "booklet",
        "jacket",
        "label",
        "sticker",
      ]);

      // Collect all unique directories from the track file paths
      const dirs = new Set();
      for (const fp of paths) {
        if (!fp || typeof fp !== "string") continue;
        const dir = path.dirname(fp);
        dirs.add(dir);
        // Also add parent
        dirs.add(path.dirname(dir));
      }

      // Priority-ordered list of candidates
      const candidates = [];

      for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        let files;
        try {
          files = fs.readdirSync(dir);
        } catch (_) {
          continue;
        }

        // Tier 1: .novaart files (previously downloaded online art)
        for (const file of files) {
          const lower = file.toLowerCase();
          if (
            lower.includes(".novaart") &&
            IMAGE_EXTS.has(path.extname(lower))
          ) {
            candidates.push({ path: path.join(dir, file), priority: 1 });
          }
        }

        // Tier 2: Exact name match (Song.jpg for Song.mp3)
        for (const fp of paths) {
          if (!fp || typeof fp !== "string") continue;
          const audioName = path.basename(fp, path.extname(fp)).toLowerCase();
          for (const file of files) {
            const fileExt = path.extname(file).toLowerCase();
            if (IMAGE_EXTS.has(fileExt)) {
              const nameNoExt = path
                .basename(file, path.extname(file))
                .toLowerCase();
              if (nameNoExt === audioName) {
                candidates.push({ path: path.join(dir, file), priority: 2 });
              }
            }
          }
        }

        // Tier 3: Common cover art names (cover.jpg, folder.jpg, etc.)
        for (const file of files) {
          const fileExt = path.extname(file).toLowerCase();
          if (IMAGE_EXTS.has(fileExt)) {
            const nameNoExt = path
              .basename(file, path.extname(file))
              .toLowerCase();
            if (COMMON_NAMES.has(nameNoExt)) {
              candidates.push({ path: path.join(dir, file), priority: 3 });
            }
          }
        }

        // Tier 4: WMP-style hidden album art cache
        for (const file of files) {
          const lower = file.toLowerCase();
          const fileExt = path.extname(lower);
          if (IMAGE_EXTS.has(fileExt) && lower.startsWith("albumart")) {
            const prio = lower.includes("large") ? 3 : 4;
            candidates.push({ path: path.join(dir, file), priority: prio });
          }
        }

        // Tier 5: ANY image file in same directory (catches custom names)
        for (const file of files) {
          const fileExt = path.extname(file).toLowerCase();
          if (IMAGE_EXTS.has(fileExt)) {
            const lower = file.toLowerCase();
            // Skip very small files (likely icons/thumbnails, not album art)
            const fullPath = path.join(dir, file);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.size < 5000) continue; // Skip files under 5KB
            } catch (_) {
              continue;
            }
            // Avoid duplicates
            if (!candidates.some((c) => c.path === fullPath)) {
              candidates.push({ path: fullPath, priority: 5 });
            }
          }
        }

        // Tier 6: Search 1 level of subdirectories
        for (const file of files) {
          const subdir = path.join(dir, file);
          try {
            const stat = fs.statSync(subdir);
            if (!stat.isDirectory()) continue;
          } catch (_) {
            continue;
          }

          let subFiles;
          try {
            subFiles = fs.readdirSync(subdir);
          } catch (_) {
            continue;
          }

          // .novaart in subdirs
          for (const sf of subFiles) {
            const lower = sf.toLowerCase();
            if (
              lower.includes(".novaart") &&
              IMAGE_EXTS.has(path.extname(lower))
            ) {
              candidates.push({ path: path.join(subdir, sf), priority: 6 });
            }
          }

          // Common names in subdirs
          for (const sf of subFiles) {
            const fileExt = path.extname(sf).toLowerCase();
            if (IMAGE_EXTS.has(fileExt)) {
              const nameNoExt = path
                .basename(sf, path.extname(sf))
                .toLowerCase();
              if (COMMON_NAMES.has(nameNoExt)) {
                candidates.push({ path: path.join(subdir, sf), priority: 6 });
              }
            }
          }

          // Any image in subdirs (size-gated)
          for (const sf of subFiles) {
            const fileExt = path.extname(sf).toLowerCase();
            if (IMAGE_EXTS.has(fileExt)) {
              const fullPath = path.join(subdir, sf);
              try {
                const stat = fs.statSync(fullPath);
                if (stat.size < 5000) continue;
              } catch (_) {
                continue;
              }
              if (!candidates.some((c) => c.path === fullPath)) {
                candidates.push({ path: fullPath, priority: 7 });
              }
            }
          }
        }
      }

      // Walk up parent directories (up to 3 levels) for common cover art names
      for (const dir of [...dirs]) {
        let current = dir;
        for (let depth = 0; depth < 3; depth++) {
          const parent = path.dirname(current);
          if (!parent || parent === current) break; // reached root
          if (!fs.existsSync(parent)) break;

          let parentFiles;
          try {
            parentFiles = fs.readdirSync(parent);
          } catch (_) {
            break;
          }

          // Common cover art names in parent directories
          for (const file of parentFiles) {
            const fileExt = path.extname(file).toLowerCase();
            if (IMAGE_EXTS.has(fileExt)) {
              const nameNoExt = path
                .basename(file, path.extname(file))
                .toLowerCase();
              if (COMMON_NAMES.has(nameNoExt)) {
                const fullPath = path.join(parent, file);
                if (!candidates.some((c) => c.path === fullPath)) {
                  candidates.push({ path: fullPath, priority: 8 + depth });
                }
              }
            }
          }

          current = parent;
        }
      }

      // Sort by priority and return the best candidate
      candidates.sort((a, b) => a.priority - b.priority);

      if (candidates.length > 0) {
        return {
          success: true,
          coverArt: candidates[0].path,
          candidates: candidates.slice(0, 5).map((c) => c.path),
        };
      }

      return { success: true, coverArt: null };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Cover Art: download remote URL → local sidecar, persist to DB ──
  ipcMain.handle("coverart:save", async (event, { trackId, url }) => {
    try {
      const row = db
        .prepare("SELECT data FROM tracks WHERE id = ?")
        .get(trackId);
      if (!row) return { success: false, error: "Track not found" };
      const track = JSON.parse(row.data);
      if (!track.filePath) return { success: false, error: "No filePath" };

      // Download image via Electron net (bypasses CORS)
      const imgData = await new Promise((resolve, reject) => {
        const req = net.request(url);
        const chunks = [];
        req.on("response", (res) => {
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", reject);
        });
        req.on("error", reject);
        req.end();
      });

      // Save as sidecar next to the audio file
      const sidecarPath = track.filePath.replace(/\.[^.]+$/, ".novaart.jpg");
      fs.writeFileSync(sidecarPath, imgData);

      // Persist local path into SQLite
      track.coverArt = sidecarPath;
      db.prepare("UPDATE tracks SET data = ? WHERE id = ?").run(
        JSON.stringify(track),
        trackId,
      );
      if (libraryById && libraryById.has(trackId)) {
        libraryById.get(trackId).coverArt = sidecarPath;
      }
      if (libraryCache) {
        const t = libraryCache.find((t) => t.id === trackId);
        if (t) t.coverArt = sidecarPath;
      }

      return { success: true, localPath: sidecarPath };
    } catch (err) {
      console.error("[coverart:save]", err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── Playlist Collage Cache: save collage image to disk ────────────
  // Persists playlist cover collage as a file so it survives app restarts
  // and doesn't rely on browser IDB which can be cleared.
  // Also stores a content hash (of sorted track IDs) for smart invalidation:
  // if the playlist's track list changes, the hash won't match and the
  // collage is regenerated on next load.
  ipcMain.handle(
    "playlist:save-collage",
    async (event, { playlistId, dataURL, contentHash }) => {
      try {
        if (!playlistId || !dataURL)
          return { success: false, error: "Missing params" };
        const collageDir = path.join(
          app.getPath("userData"),
          "cached_covers",
          "collages",
        );
        if (!fs.existsSync(collageDir))
          fs.mkdirSync(collageDir, { recursive: true });
        const collagePath = path.join(collageDir, `${playlistId}.webp`);
        // Extract base64 data from data URL
        const matches = dataURL.match(/^data:image\/[^;]+;base64,(.+)$/);
        if (!matches) return { success: false, error: "Invalid data URL" };
        const buffer = Buffer.from(matches[1], "base64");
        fs.writeFileSync(collagePath, buffer);
        // Save content hash alongside the collage for smart invalidation
        if (contentHash) {
          const hashPath = path.join(collageDir, `${playlistId}.hash`);
          fs.writeFileSync(hashPath, contentHash, "utf8");
        }
        return { success: true, path: collagePath };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  );

  // ─── Playlist Collage Cache: load collage image from disk ──────────
  // Returns the collage URL ONLY if the content hash matches the current
  // playlist state. If the hash doesn't match (playlist changed), the
  // collage is deleted and a miss is returned so the renderer regenerates it.
  ipcMain.handle(
    "playlist:get-collage",
    async (event, { playlistId, contentHash }) => {
      try {
        if (!playlistId) return { success: false, error: "Missing playlistId" };
        const collageDir = path.join(
          app.getPath("userData"),
          "cached_covers",
          "collages",
        );
        const collagePath = path.join(collageDir, `${playlistId}.webp`);
        const hashPath = path.join(collageDir, `${playlistId}.hash`);
        if (!fs.existsSync(collagePath))
          return { success: false, error: "Not cached" };
        // Smart invalidation: check if the content hash matches
        if (contentHash && fs.existsSync(hashPath)) {
          const storedHash = fs.readFileSync(hashPath, "utf8");
          if (storedHash !== contentHash) {
            // Playlist contents changed — delete stale collage
            try {
              fs.unlinkSync(collagePath);
            } catch (_) {}
            try {
              fs.unlinkSync(hashPath);
            } catch (_) {}
            return { success: false, error: "Stale collage" };
          }
        } else if (contentHash && !fs.existsSync(hashPath)) {
          // No hash file but one was provided — old cache format, invalidate
          try {
            fs.unlinkSync(collagePath);
          } catch (_) {}
          return { success: false, error: "No hash, regenerating" };
        }
        // Return protocol URL so the browser can cache it natively
        const url = `nova-media://cover/${encodeURIComponent(collagePath)}`;
        return { success: true, url };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  );

  // ─── Playlist Collage Cache: invalidate (delete) stale collage ─────
  ipcMain.handle("playlist:invalidate-collage", async (event, playlistId) => {
    try {
      if (!playlistId) return { success: false };
      const collageDir = path.join(
        app.getPath("userData"),
        "cached_covers",
        "collages",
      );
      const collagePath = path.join(collageDir, `${playlistId}.webp`);
      const hashPath = path.join(collageDir, `${playlistId}.hash`);
      if (fs.existsSync(collagePath)) fs.unlinkSync(collagePath);
      if (fs.existsSync(hashPath)) fs.unlinkSync(hashPath);
      return { success: true };
    } catch (_) {
      return { success: false };
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // FILE DIALOGS
  // ═══════════════════════════════════════════════════════════════════

  ipcMain.handle("file:open-dialog", async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Select Music Files",
        properties: ["openFile", "openDirectory", "multiSelections"],
        filters: [
          {
            name: "Audio Files",
            extensions: SUPPORTED_FORMATS.map((f) => f.replace(".", "")),
          },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const filesToProcess = [];
      for (const p of result.filePaths) {
        if (fs.existsSync(p)) {
          const stat = fs.statSync(p);
          if (stat.isDirectory()) {
            try {
              const scannedFiles = await fileScanner.scanDirectory(p);
              filesToProcess.push(...scannedFiles);
            } catch (scanErr) {
              console.warn(`Failed scanning directory ${p}:`, scanErr.message);
            }
          } else {
            filesToProcess.push({
              filePath: p,
              fileName: path.basename(p),
              fileSize: stat.size,
              modifiedTime: stat.mtimeMs,
              birthTime: stat.birthtimeMs,
            });
          }
        }
      }

      const tracks = [];
      for (const file of filesToProcess) {
        try {
          const metadata = await metadataReader.readMetadata(file.filePath);
          tracks.push({
            id: generateTrackId(file.filePath),
            filePath: file.filePath,
            fileName: file.fileName,
            title:
              metadata.title ||
              path.basename(file.filePath, path.extname(file.filePath)),
            artist: metadata.artist || "Unknown Artist",
            album: metadata.album || "Unknown Album",
            albumArtist: metadata.albumArtist || "",
            genre: metadata.genre || "",
            year: metadata.year || 0,
            trackNumber: metadata.trackNumber || 0,
            discNumber: metadata.discNumber || 0,
            duration: metadata.duration || 0,
            bitrate: metadata.bitrate || 0,
            sampleRate: metadata.sampleRate || 0,
            channels: metadata.channels || 2,
            format:
              metadata.format ||
              path.extname(file.filePath).replace(".", "").toUpperCase(),
            fileSize: file.fileSize,
            coverArt: metadata.coverArt || null,
            dateAdded: Date.now(),
            dateModified: file.modifiedTime || Date.now(),
          });
        } catch (err) {
          console.warn(
            `Metadata read failed for ${file.filePath}:`,
            err.message,
          );
        }
      }

      // Also persist these tracks into the library
      if (tracks.length > 0) {
        const existingLibrary = getLibrary();
        const existingMap = new Map(existingLibrary.map((t) => [t.id, t]));
        for (const track of tracks) {
          existingMap.set(track.id, track);
        }
        const mergedLibrary = Array.from(existingMap.values());
        saveLibrary(mergedLibrary);
      }

      return { success: true, tracks };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("file:open-folder-dialog", async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Select Music Folder",
        properties: ["openDirectory"],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      return { success: true, folderPath: result.filePaths[0] };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("file:read-audio", async (event, filePath) => {
    try {
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString("base64");
      const mimeType = getAudioMimeType(filePath);
      return { success: true, data: `data:${mimeType};base64,${base64}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("file:open-cover-art", async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Select Cover Art",
        properties: ["openFile"],
        filters: [
          { name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const coverBuffer = fs.readFileSync(result.filePaths[0]);
      const base64 = coverBuffer.toString("base64");
      const ext = path.extname(result.filePaths[0]).toLowerCase();
      const mimeMap = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
      };

      return {
        success: true,
        data: `data:${mimeMap[ext] || "image/png"};base64,${base64}`,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  function getAudioMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      ".mp3": "audio/mpeg",
      ".flac": "audio/flac",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".m4a": "audio/mp4",
      ".aac": "audio/aac",
      ".wma": "audio/x-ms-wma",
      ".opus": "audio/opus",
      ".ape": "audio/x-ape",
    };
    return mimeMap[ext] || "audio/mpeg";
  }

  // ═══════════════════════════════════════════════════════════════════
  // SETTINGS IPC
  // ═══════════════════════════════════════════════════════════════════

  ipcMain.handle("settings:get", async (event, key) => {
    const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
    return {
      success: true,
      value:
        settings[key] !== undefined ? settings[key] : DEFAULT_SETTINGS[key],
    };
  });

  ipcMain.handle("settings:set", async (event, key, value) => {
    try {
      const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
      settings[key] = value;
      writeJSON(SETTINGS_FILE, settings);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("settings:get-all", async () => {
    const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (settings[key] === undefined) {
        settings[key] = DEFAULT_SETTINGS[key];
      }
    }
    return { success: true, settings };
  });

  ipcMain.handle("settings:reset", async () => {
    try {
      writeJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
      return { success: true, settings: { ...DEFAULT_SETTINGS } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // PLAYLIST IPC
  // ═══════════════════════════════════════════════════════════════════

  ipcMain.handle("playlist:get-all", async () => {
    try {
      return { success: true, playlists: getPlaylists() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("playlist:create", async (event, name) => {
    try {
      const id = crypto
        .createHash("sha256")
        .update(`playlist:${name}:${Date.now()}`)
        .digest("hex")
        .substring(0, 12);
      const playlist = {
        id,
        name: name.trim() || "Untitled Playlist",
        tracks: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      savePlaylist(playlist);
      return { success: true, playlist };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("playlist:delete", async (event, playlistId) => {
    try {
      const existing = getPlaylists().find((p) => p.id === playlistId);
      if (existing) {
        db.prepare("DELETE FROM playlist_tracks WHERE playlistId = ?").run(
          playlistId,
        );
        db.prepare("DELETE FROM playlists WHERE id = ?").run(playlistId);
        playlistsCache = getPlaylists().filter((p) => p.id !== playlistId);
        return { success: true };
      }
      return { success: false, error: "Playlist not found" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("playlist:add-track", async (event, playlistId, trackId) => {
    try {
      const playlist = getPlaylists().find((p) => p.id === playlistId);
      if (!playlist) return { success: false, error: "Playlist not found" };
      if (!playlist.tracks.includes(trackId)) {
        playlist.tracks.push(trackId);
        playlist.updatedAt = Date.now();
        savePlaylist(playlist);
        // Invalidate collage cache since track list changed
        _invalidateCollageFile(playlistId);
      }
      return { success: true, playlist };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(
    "playlist:remove-track",
    async (event, playlistId, trackId) => {
      try {
        const playlist = getPlaylists().find((p) => p.id === playlistId);
        if (!playlist) return { success: false, error: "Playlist not found" };
        playlist.tracks = playlist.tracks.filter((id) => id !== trackId);
        playlist.updatedAt = Date.now();
        savePlaylist(playlist);
        // Invalidate collage cache since track list changed
        _invalidateCollageFile(playlistId);
        return { success: true, playlist };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle("playlist:rename", async (event, playlistId, newName) => {
    try {
      const playlist = getPlaylists().find((p) => p.id === playlistId);
      if (!playlist) return { success: false, error: "Playlist not found" };
      playlist.name = newName.trim() || playlist.name;
      playlist.updatedAt = Date.now();
      savePlaylist(playlist);
      return { success: true, playlist };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Playlist file I/O (multi-format export/import) ───────────────────

  ipcMain.handle("playlist:import", async () => {
    try {
      const openResult = await dialog.showOpenDialog(mainWindow, {
        title: "Import Playlist",
        properties: ["openFile"],
        filters: [
          {
            name: "All Playlists",
            extensions: ["m3u", "m3u8", "pls", "xspf", "json"],
          },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (openResult.canceled || openResult.filePaths.length === 0)
        return { success: false, canceled: true };

      const filePath = openResult.filePaths[0];
      const ext = path.extname(filePath).toLowerCase().replace(".", "");
      const encoding = ext === "m3u" ? "latin1" : "utf-8";
      const content = fs.readFileSync(filePath, encoding);
      const baseName = path.basename(filePath, path.extname(filePath));

      let entries = [];
      let playlistName = baseName;

      if (ext === "m3u" || ext === "m3u8") {
        const lines = content
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        let pendingDuration = 0;
        for (const line of lines) {
          if (line.startsWith("#EXTM3U")) continue;
          if (line.startsWith("#EXTINF:")) {
            const comma = line.indexOf(",");
            pendingDuration =
              parseFloat(line.substring(8, comma > 0 ? comma : undefined)) || 0;
          } else if (!line.startsWith("#")) {
            entries.push({ filePath: line, duration: pendingDuration });
            pendingDuration = 0;
          }
        }
      } else if (ext === "pls") {
        const fileMap = {};
        content.split(/\r?\n/).forEach((line) => {
          const m = line.match(/^File(\d+)=(.+)$/i);
          if (m) fileMap[m[1]] = m[2].trim();
        });
        entries = Object.keys(fileMap)
          .sort((a, b) => +a - +b)
          .map((n) => ({ filePath: fileMap[n] }));
      } else if (ext === "xspf") {
        const titleMatch = content.match(
          /<playlist[^>]*>[\s\S]*?<title>([\s\S]*?)<\/title>/,
        );
        if (titleMatch)
          playlistName = titleMatch[1]
            .trim()
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");
        const trackRegex = /<track>([\s\S]*?)<\/track>/g;
        let m;
        while ((m = trackRegex.exec(content)) !== null) {
          const loc = m[1].match(/<location>([\s\S]*?)<\/location>/);
          if (!loc) continue;
          let fp = loc[1]
            .trim()
            .replace(/&amp;/g, "&")
            .replace(/^file:\/\/\/?/, "");
          if (/^\/[A-Za-z]:/.test(fp)) fp = fp.substring(1);
          entries.push({ filePath: fp });
        }
      } else if (ext === "json") {
        try {
          const data = JSON.parse(content);
          playlistName = data.name || baseName;
          const raw = Array.isArray(data)
            ? data
            : Array.isArray(data.tracks)
              ? data.tracks
              : [];
          entries = raw
            .map((t) => ({ filePath: t.filePath || t.path || t.file || "" }))
            .filter((e) => e.filePath);
          if (entries.length === 0 && Array.isArray(data.trackIds)) {
            const library = getLibrary();
            const idSet = new Set(data.trackIds);
            entries = library
              .filter((t) => idSet.has(t.id))
              .map((t) => ({ filePath: t.filePath, resolvedId: t.id }));
          }
        } catch (_) {}
      }

      if (entries.length === 0)
        return { success: false, error: "No tracks found in playlist file" };

      const library = getLibrary();
      const pathToId = new Map(
        library.filter((t) => t?.filePath).map((t) => [t.filePath, t.id]),
      );
      // Cross-platform filename extractor: handles both Windows backslash
      // and Android/POSIX forward-slash paths correctly on any host OS.
      const crossBasename = (fp) => {
        const posix = String(fp || "").replace(/\\/g, "/");
        const idx = posix.lastIndexOf("/");
        return idx >= 0 ? posix.substring(idx + 1) : posix;
      };
      // Filename-only fallback for cross-platform paths (e.g. Android paths on Windows)
      const fileNameToTrack = new Map();
      // Also index without extension for fuzzy matching
      const fileNameNoExtToTrack = new Map();
      for (const t of library) {
        if (!t?.filePath) continue;
        const fname = crossBasename(t.filePath).toLowerCase();
        if (!fileNameToTrack.has(fname)) fileNameToTrack.set(fname, t);
        const fnameNoExt = fname.replace(/\.[^.]+$/, "");
        if (!fileNameNoExtToTrack.has(fnameNoExt))
          fileNameNoExtToTrack.set(fnameNoExt, t);
      }

      const id = crypto
        .createHash("sha256")
        .update(`playlist:${playlistName}:${Date.now()}`)
        .digest("hex")
        .substring(0, 12);
      const playlist = {
        id,
        name: (playlistName || "Imported Playlist").trim(),
        tracks: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const unmatchedTracks = [];
      for (const entry of entries) {
        if (!entry?.filePath && !entry?.resolvedId) continue;
        let trackId = entry.resolvedId || pathToId.get(entry.filePath);
        if (!trackId) {
          // Use cross-platform basename so Android /storage/emulated/0/... paths
          // resolve correctly even when running on Windows.
          const fname = crossBasename(entry.filePath).toLowerCase();
          const match =
            fileNameToTrack.get(fname) ||
            fileNameNoExtToTrack.get(fname.replace(/\.[^.]+$/, ""));
          trackId = match ? match.id : null;
        }
        if (trackId) {
          if (!playlist.tracks.includes(trackId)) {
            playlist.tracks.push(trackId);
          }
        } else {
          unmatchedTracks.push(crossBasename(entry.filePath) || entry.filePath);
        }
      }

      const unmatched = unmatchedTracks.length;
      if (unmatched > 0) {
        console.warn(
          `[playlist:import] ${unmatched}/${entries.length} tracks unresolved — library may not include those files`,
        );
      }

      if (playlist.tracks.length === 0) {
        // All entries parsed but none matched the library.
        // Most likely cause in a built exe: library not yet scanned.
        return {
          success: false,
          error: `Playlist parsed (${entries.length} tracks) but none matched your library. Scan the folder containing these files first, then re-import.`,
          parsedCount: entries.length,
          matchedCount: 0,
        };
      }

      savePlaylist(playlist);
      playlistsCache = null;
      return {
        success: true,
        playlist,
        matchedCount: playlist.tracks.length,
        unmatchedCount: unmatched,
        unmatchedTracks,
      };
    } catch (err) {
      console.error("[playlist:import]", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("playlist:export", async (event, playlistId) => {
    try {
      const playlist = getPlaylists().find((p) => p.id === playlistId);
      if (!playlist) return { success: false, error: "Playlist not found" };

      const saveResult = await dialog.showSaveDialog(mainWindow, {
        title: "Export Playlist",
        defaultPath: playlist.name,
        filters: [
          { name: "M3U Playlist", extensions: ["m3u"] },
          { name: "M3U8 Playlist", extensions: ["m3u8"] },
          { name: "PLS Playlist", extensions: ["pls"] },
          { name: "XSPF Playlist", extensions: ["xspf"] },
          { name: "JSON Playlist", extensions: ["json"] },
        ],
      });
      if (saveResult.canceled || !saveResult.filePath)
        return { success: false, canceled: true };

      const filePath = saveResult.filePath;
      const ext = path.extname(filePath).toLowerCase().replace(".", "");
      const library = getLibrary();
      const libMap = new Map(library.map((t) => [t.id, t]));
      const tracks = playlist.tracks
        .map((id) => libMap.get(id))
        .filter(Boolean);

      let content = "";
      if (ext === "m3u" || ext === "m3u8") {
        const lines = ["#EXTM3U"];
        for (const t of tracks) {
          lines.push(
            `#EXTINF:${Math.round(t.duration || 0)},${t.artist || "Unknown"} - ${t.title || "Unknown"}`,
          );
          lines.push(t.filePath);
        }
        content = lines.join("\r\n");
      } else if (ext === "pls") {
        const lines = ["[playlist]"];
        tracks.forEach((t, i) => {
          lines.push(`File${i + 1}=${t.filePath}`);
          lines.push(
            `Title${i + 1}=${t.artist || "Unknown"} - ${t.title || "Unknown"}`,
          );
          lines.push(`Length${i + 1}=${Math.round(t.duration || -1)}`);
        });
        lines.push("", `NumberOfEntries=${tracks.length}`, "Version=2");
        content = lines.join("\r\n");
      } else if (ext === "xspf") {
        const esc = (s) =>
          (s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        const items = tracks
          .map((t) => {
            if (!t?.filePath) return "";
            const fp = t.filePath.replace(/\\/g, "/");
            const uri = fp.startsWith("/") ? `file://${fp}` : `file:///${fp}`;
            return `    <track>\n      <location>${esc(uri)}</location>\n      <title>${esc(t.title)}</title>\n      <creator>${esc(t.artist)}</creator>\n      <album>${esc(t.album)}</album>${t.duration ? `\n      <duration>${Math.round(t.duration * 1000)}</duration>` : ""}\n    </track>`;
          })
          .filter(Boolean)
          .join("\n");
        content = `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n  <title>${esc(playlist.name)}</title>\n  <trackList>\n${items}\n  </trackList>\n</playlist>`;
      } else {
        content = JSON.stringify(
          {
            name: playlist.name,
            createdAt: playlist.createdAt,
            updatedAt: Date.now(),
            tracks: tracks.map((t) => ({
              filePath: t.filePath,
              title: t.title || null,
              artist: t.artist || null,
              album: t.album || null,
              duration: t.duration || 0,
            })),
          },
          null,
          2,
        );
      }

      fs.writeFileSync(filePath, content, ext === "m3u" ? "latin1" : "utf-8");
      return { success: true };
    } catch (err) {
      console.error("[playlist:export]", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(
    "playlist:show-save-dialog",
    async (event, { defaultName, formats }) => {
      try {
        const result = await dialog.showSaveDialog(mainWindow, {
          title: "Export Playlist",
          defaultPath: defaultName || "playlist",
          filters: formats || [
            { name: "M3U Playlist", extensions: ["m3u"] },
            { name: "M3U8 Playlist", extensions: ["m3u8"] },
            { name: "PLS Playlist", extensions: ["pls"] },
            { name: "XSPF Playlist", extensions: ["xspf"] },
            { name: "JSON Playlist", extensions: ["json"] },
          ],
        });
        if (result.canceled || !result.filePath) return { canceled: true };
        return { canceled: false, filePath: result.filePath };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle("playlist:show-open-dialog", async (event, { formats }) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Import Playlist",
        properties: ["openFile"],
        filters: formats || [
          {
            name: "All Playlists",
            extensions: ["m3u", "m3u8", "pls", "xspf", "json"],
          },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0)
        return { canceled: true };
      return { canceled: false, filePath: result.filePaths[0] };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(
    "playlist:write-file",
    async (event, { filePath, content }) => {
      try {
        const encoding = filePath.toLowerCase().endsWith(".m3u")
          ? "latin1"
          : "utf-8";
        fs.writeFileSync(filePath, content, encoding);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle("playlist:read-file", async (event, { filePath }) => {
    try {
      const encoding = filePath.toLowerCase().endsWith(".m3u")
        ? "latin1"
        : "utf-8";
      const content = fs.readFileSync(filePath, encoding);
      return { success: true, filePath, content };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Window controls for frameless shell
  ipcMain.handle("window:minimize", async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (win && !win.isDestroyed()) win.minimize();
    return { success: true };
  });

  ipcMain.handle("window:toggle-maximize", async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
    return { success: true };
  });

  ipcMain.handle("window:close", async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (win && !win.isDestroyed()) win.close();
    return { success: true };
  });

  ipcMain.handle("window:set-fullscreen", async (event, enabled) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (win && !win.isDestroyed()) {
      win.setFullScreen(!!enabled);
    }
    return { success: true };
  });

  ipcMain.handle("window:set-overlay-chrome", async (event, hidden) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (win && !win.isDestroyed() && process.platform === "win32") {
      win.setTitleBarOverlay(
        hidden
          ? {
              color: "rgba(0, 0, 0, 0)",
              symbolColor: "rgba(0, 0, 0, 0)",
              height: 0,
            }
          : { color: "rgba(0, 0, 0, 0)", symbolColor: "#b3b3b3", height: 32 },
      );
    }
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // SMTC — renderer pushes playback state to the OS notification card
  // ═══════════════════════════════════════════════════════════════════

  // handle() variants so renderer can use novaAPI.invoke() (fire-and-forget)
  ipcMain.handle("smtc:update-metadata", (_, metadata) => {
    if (_smtcBridgeRef && typeof _smtcBridgeRef.updateMetadata === "function") {
      _smtcBridgeRef.updateMetadata(metadata);
    }
    return { success: true };
  });

  ipcMain.handle("smtc:update-status", (_, status) => {
    if (
      _smtcBridgeRef &&
      typeof _smtcBridgeRef.updatePlaybackStatus === "function"
    ) {
      _smtcBridgeRef.updatePlaybackStatus(status);
    }
    return { success: true };
  });

  ipcMain.handle("smtc:update-position", (_, positionMs) => {
    if (_smtcBridgeRef && typeof _smtcBridgeRef.updatePosition === "function") {
      _smtcBridgeRef.updatePosition(positionMs);
    }
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════════════
  // LYRICS
  // ═══════════════════════════════════════════════════════════════════

  // ── Fast DB lookup — returns lyrics already stored in track row ──────
  // Call this first before any network or file I/O. Returns the stored
  // syncedLyrics / plainLyrics / lyricsPath data from the SQLite row.
  ipcMain.handle("lyrics:get-from-db", async (event, trackId) => {
    try {
      if (!trackId) return { success: false, error: "No trackId" };
      getLibrary(); // ensure cache is warm
      const track = libraryById ? libraryById.get(trackId) : null;
      if (!track) return { success: false, error: "Track not found" };

      console.log(`[lyrics:get-from-db] ${track.artist} - ${track.title}`);
      console.log(`  filePath     : ${track.filePath}`);
      console.log(`  lyricsPath   : ${track.lyricsPath || "none"}`);
      console.log(
        `  plainLyrics  : ${track.plainLyrics ? track.plainLyrics.slice(0, 60).replace(/\n/g, " ") + "…" : "none"}`,
      );
      console.log(
        `  syncedLyrics : ${track.syncedLyrics ? track.syncedLyrics.slice(0, 60).replace(/\n/g, " ") + "…" : "none"}`,
      );

      // If there's a lyricsPath on disk, read it fresh (covers edits since scan)
      if (track.lyricsPath && fs.existsSync(track.lyricsPath)) {
        const content = fs.readFileSync(track.lyricsPath, "utf-8");
        const parsed = parseLRC(content);
        console.log(
          `  → served from lyricsPath (${parsed.synced ? parsed.synced.length + " synced lines" : "plain only"})`,
        );
        return { success: true, lyrics: { ...parsed, source: "local-lrc" } };
      }

      // Return whatever was stored during scan
      if (track.syncedLyrics || track.plainLyrics) {
        // syncedLyrics stored could be raw LRC string or already parsed JSON
        let synced = null;
        if (track.syncedLyrics) {
          if (typeof track.syncedLyrics === "string") {
            // Try JSON first (previously serialised array)
            try {
              const parsed = JSON.parse(track.syncedLyrics);
              synced = Array.isArray(parsed)
                ? parsed
                : parseLRC(track.syncedLyrics).synced;
            } catch {
              synced = parseLRC(track.syncedLyrics).synced;
            }
          } else if (Array.isArray(track.syncedLyrics)) {
            synced = track.syncedLyrics;
          }
        }
        console.log(
          `  → served from DB (${synced ? synced.length + " synced lines" : "plain only"})`,
        );
        return {
          success: true,
          lyrics: { synced, plain: track.plainLyrics || "", source: "db" },
        };
      }

      console.log(`  → no lyrics in DB for this track`);
      return { success: false, error: "No lyrics in DB" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(
    "lyrics:fetch-online",
    async (event, { artist, title, album, duration }) => {
      const HEADERS = {
        "User-Agent": "NovaTune/1.0 (https://github.com/novatune)",
        Accept: "application/json",
      };
      const TIMEOUT_MS = 12000;

      async function lrcFetch(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const res = await net.fetch(url, {
            headers: HEADERS,
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.json();
        } finally {
          clearTimeout(timer);
        }
      }

      try {
        // Fire /api/get and /api/search in parallel; take whichever resolves first with lyrics
        const promises = [];

        if (artist && title) {
          // /api/get — exact match, duration-aware
          const getParams = new URLSearchParams({
            track_name: title,
            artist_name: artist,
          });
          if (album) getParams.append("album_name", album);
          if (duration) getParams.append("duration", Math.round(duration));
          promises.push(
            lrcFetch(`https://lrclib.net/api/get?${getParams}`)
              .then((hit) =>
                hit && (hit.plainLyrics || hit.syncedLyrics) ? hit : null,
              )
              .catch(() => null),
          );
        }

        // /api/search — broader, returns array
        const searchParams = new URLSearchParams({ track_name: title });
        if (artist) searchParams.append("artist_name", artist);
        promises.push(
          lrcFetch(`https://lrclib.net/api/search?${searchParams}`)
            .then((results) => {
              if (!Array.isArray(results) || results.length === 0) return null;
              if (duration) {
                return (
                  results.find(
                    (r) => Math.abs((r.duration || 0) - duration) <= 2,
                  ) || results[0]
                );
              }
              return results[0];
            })
            .catch(() => null),
        );

        // Race: resolve with first non-null result
        let match = null;
        const settled = await Promise.allSettled(promises);
        for (const r of settled) {
          if (r.status === "fulfilled" && r.value) {
            match = r.value;
            break;
          }
        }

        if (!match) return { success: false, error: "No lyrics found" };

        // Parse synced LRC string → array before sending to renderer.
        // Some LRCLIB entries have syncedLyrics=null but store LRC-formatted
        // text (with [mm:ss.xx] timestamps) inside plainLyrics. When that
        // happens, parse the plain field for synced lines and expose a clean
        // plain string (timestamps stripped) so the renderer never shows raw
        // [00:15.04] timestamp tokens as display text.
        let parsedSynced = match.syncedLyrics
          ? parseLRC(match.syncedLyrics).synced
          : null;

        let plainText = match.plainLyrics || "";

        if (!parsedSynced && plainText) {
          const rescued = parseLRC(plainText);
          if (rescued.synced && rescued.synced.length > 0) {
            parsedSynced = rescued.synced;
            // Use the timestamp-stripped plain so the panel has clean fallback text
            plainText =
              rescued.plain || rescued.synced.map((l) => l.text).join("\n");
          }
        }

        return {
          success: true,
          lyrics: {
            synced: parsedSynced,
            plain: plainText,
            source: "LRCLIB",
            title: match.trackName || title,
            artist: match.artistName || artist,
          },
        };
      } catch (err) {
        const msg =
          err.name === "AbortError" ? "Request timed out" : err.message;
        return { success: false, error: msg };
      }
    },
  );

  ipcMain.handle("lyrics:search-online", async (event, { title, artist }) => {
    const HEADERS = {
      "User-Agent": "NovaTune/1.0 (https://github.com/novatune)",
      Accept: "application/json",
    };
    const TIMEOUT_MS = 15000;
    const MAX_RETRIES = 3;
    const params = new URLSearchParams({ track_name: title });
    if (artist) params.append("artist_name", artist);
    const url = `https://lrclib.net/api/search?${params}`;
    let lastErr;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1200 * attempt));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await net.fetch(url, {
          headers: HEADERS,
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const results = await res.json();
        return {
          success: true,
          results: Array.isArray(results) ? results : [],
        };
      } catch (err) {
        lastErr = err;
        if (err.message && err.message.startsWith("HTTP 4")) break;
      } finally {
        clearTimeout(timer);
      }
    }
    const msg =
      lastErr.name === "AbortError" ? "Search timed out" : lastErr.message;
    return { success: false, error: msg };
  });

  ipcMain.handle("lyrics:read-local", async (event, filePath) => {
    try {
      const lrcPath = filePath.replace(path.extname(filePath), ".lrc");
      if (!fs.existsSync(lrcPath)) {
        const lrcPathUpper = filePath.replace(path.extname(filePath), ".LRC");
        if (!fs.existsSync(lrcPathUpper)) {
          console.log(
            `[lyrics:read-local] no .lrc found for: ${path.basename(filePath)}`,
          );
          return { success: false, error: "No local lyrics file found" };
        }
        console.log(
          `[lyrics:read-local] found .LRC: ${path.basename(lrcPathUpper)}`,
        );
        const content = fs.readFileSync(lrcPathUpper, "utf-8");
        const parsed = parseLRC(content);
        console.log(
          `  → ${parsed.synced ? parsed.synced.length + " synced lines" : "plain only"}`,
        );
        return { success: true, lyrics: parsed };
      }
      console.log(`[lyrics:read-local] found .lrc: ${path.basename(lrcPath)}`);
      const content = fs.readFileSync(lrcPath, "utf-8");
      const parsed = parseLRC(content);
      console.log(
        `  → ${parsed.synced ? parsed.synced.length + " synced lines" : "plain only"}`,
      );
      return { success: true, lyrics: parsed };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Read embedded lyrics (USLT/SYLT tags) directly from audio file ──
  // Uses music-metadata parseFile() with skipCovers + skipPostProcessing
  // for maximum speed — only reads tag headers, skips audio data & cover art.
  ipcMain.handle("lyrics:read-embedded", async (event, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: "File not found" };
      }

      // music-metadata v8+ is ESM-only — must use dynamic import(), never require().
      const mmMod = await import("music-metadata");
      // v8+ has NO default export — parseFile is a named export directly on the module.
      const parseFile = mmMod.parseFile;
      // TimestampFormat.milliseconds === 2; used to decide ms→seconds conversion.
      const TimestampFormat = mmMod.TimestampFormat;

      const metadata = await parseFile(filePath, {
        skipCovers: true,
        skipPostProcessing: true,
      });

      let plainText = "";
      let syncedLines = null;

      // ── common.lyrics — music-metadata v8+ shape ──────────────────────────
      // common.lyrics is ILyricsTag[] (flat array, not an object).
      // Each entry is one of:
      //   USLT: { language, descriptor, text }               — no syncText
      //   SYLT: { language, descriptor, contentType,
      //           timeStampFormat, syncText: [{text, timestamp}] }
      // timestamp unit: milliseconds when timeStampFormat === TimestampFormat.milliseconds (2)
      //                 MPEG frame number when timeStampFormat === 1 (rare, skip)
      if (
        metadata.common &&
        Array.isArray(metadata.common.lyrics) &&
        metadata.common.lyrics.length > 0
      ) {
        const lyricsArr = metadata.common.lyrics;

        // SYLT entry: has a non-empty syncText array
        const syltEntry = lyricsArr.find(
          (l) => Array.isArray(l.syncText) && l.syncText.length > 0,
        );
        // USLT entry: has text, no syncText (or empty syncText)
        const usltEntry = lyricsArr.find(
          (l) => l.text && (!l.syncText || l.syncText.length === 0),
        );

        if (syltEntry) {
          // Only convert ms→s when timeStampFormat is milliseconds (2).
          // Frame-number format (1) is rare and has no reliable conversion without
          // knowing the MPEG header bitrate, so we skip it gracefully.
          const isMsFormat =
            syltEntry.timeStampFormat ===
            (TimestampFormat ? TimestampFormat.milliseconds : 2);
          if (isMsFormat) {
            syncedLines = syltEntry.syncText
              .map((s) => ({
                time: s.timestamp / 1000,
                text: s.text || "",
              }))
              .filter((l) => l.text.trim())
              .sort((a, b) => a.time - b.time);
            if (syncedLines.length === 0) syncedLines = null;
          }
        }

        if (usltEntry && usltEntry.text) {
          plainText = usltEntry.text;
        }
      }

      // ── Fallback: read raw native ID3v2 tags (USLT / SYLT frames) ──
      if (!plainText && !syncedLines && metadata.native) {
        // Try ID3v2.4 then ID3v2.3 (MP3)
        const id3 =
          metadata.native["ID3v2.4"] || metadata.native["ID3v2.3"] || [];
        for (const tag of id3) {
          if (tag.id === "USLT" && tag.value) {
            // USLT value can be string or object with text property
            plainText =
              typeof tag.value === "string"
                ? tag.value
                : tag.value.text || String(tag.value);
            if (plainText && plainText.trim()) break;
          }
        }
        for (const tag of id3) {
          if (tag.id === "SYLT" && tag.value) {
            const raw = Array.isArray(tag.value) ? tag.value : [tag.value];
            const lines = [];
            for (const entry of raw) {
              if (entry && entry.text != null && entry.timeStamp != null) {
                lines.push({
                  time: entry.timeStamp / 1000,
                  text: String(entry.text),
                });
              }
            }
            if (lines.length > 0) {
              syncedLines = lines.sort((a, b) => a.time - b.time);
              break;
            }
          }
        }

        // Vorbis Comments (FLAC/OGG) — LYRICS tag
        if (!plainText && !syncedLines) {
          const vorbis = metadata.native["vorbis"] || [];
          for (const tag of vorbis) {
            if (tag.id === "LYRICS" && tag.value) {
              plainText = String(tag.value);
              break;
            }
          }
        }

        // M4A/MP4 — ©lyr tag
        if (!plainText && !syncedLines) {
          const mp4 = metadata.native["iTunes"] || [];
          for (const tag of mp4) {
            if ((tag.id === "©lyr" || tag.id === "lyr") && tag.value) {
              plainText = String(tag.value);
              break;
            }
          }
        }

        // APEv2 (APE/Musepack) — LYRICS tag
        if (!plainText && !syncedLines) {
          const ape = metadata.native["APEv2"] || [];
          for (const tag of ape) {
            if ((tag.id === "LYRICS" || tag.id === "Lyrics") && tag.value) {
              plainText = String(tag.value);
              break;
            }
          }
        }
      }

      if (!plainText && !syncedLines) {
        return { success: false, error: "No embedded lyrics" };
      }

      // If SYLT was absent but USLT text is LRC-formatted, rescue synced lines
      // and strip timestamps from plain so the renderer never shows raw [mm:ss] tokens.
      if (!syncedLines && plainText) {
        const rescued = parseLRC(plainText);
        if (rescued.synced && rescued.synced.length > 0) {
          syncedLines = rescued.synced;
          plainText =
            rescued.plain || rescued.synced.map((l) => l.text).join("\n");
        }
      }

      return {
        success: true,
        lyrics: {
          synced: syncedLines,
          plain: plainText,
          source: "embedded",
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(
    "lyrics:save-to-track",
    async (event, { trackId, filePath, plain, synced }) => {
      try {
        const lrcPath = filePath.replace(/\.[^.]+$/, ".lrc");
        const isEmpty = !plain && !synced;

        // File write first (fast) — this is the only blocking part
        if (isEmpty) {
          try {
            if (fs.existsSync(lrcPath)) fs.unlinkSync(lrcPath);
          } catch (_) {}
        } else {
          fs.writeFileSync(lrcPath, synced || plain || "", "utf-8");
        }

        // Patch only this one track — no full-table rewrite.
        try {
          const row = db
            .prepare("SELECT data FROM tracks WHERE id = ?")
            .get(trackId);
          if (row) {
            const track = JSON.parse(row.data);
            track.lyricsPath = isEmpty ? null : lrcPath;
            track.plainLyrics = isEmpty ? null : plain || null;
            track.syncedLyrics = isEmpty ? null : synced || null;
            db.prepare("UPDATE tracks SET data = ? WHERE id = ?").run(
              JSON.stringify(track),
              trackId,
            );
            if (libraryById && libraryById.has(trackId)) {
              Object.assign(libraryById.get(trackId), {
                lyricsPath: track.lyricsPath,
                plainLyrics: track.plainLyrics,
                syncedLyrics: track.syncedLyrics,
              });
            }
          }
        } catch (e) {
          console.error("[lyrics:save-to-track] patch failed:", e.message);
        }

        return { success: true, lrcPath: isEmpty ? null : lrcPath };
      } catch (err) {
        console.error("[lyrics:save-to-track]", err.message);
        return { success: false, error: err.message };
      }
    },
  );
}

// ─── LRC Parser ────────────────────────────────────────────────────
function parseLRC(content) {
  if (typeof content !== "string") return { synced: null, plain: "" };
  const lines = content.split("\n");
  const synced = [];
  const plain = [];

  // Matches [MM:SS.ms], [MM:SS:ms], [MM:SS] — minutes 1-3 digits, ms optional
  const timeRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\]/g;
  // Strip pattern mirrors timeRegex
  const stripRegex = /\[\d{1,3}:\d{2}(?:[.:]\d{2,3})?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith("[ti:") ||
      trimmed.startsWith("[ar:") ||
      trimmed.startsWith("[al:") ||
      trimmed.startsWith("[by:") ||
      trimmed.startsWith("[offset:")
    ) {
      if (!trimmed.match(/^\[/)) plain.push(trimmed);
      continue;
    }

    const timeMatches = [...trimmed.matchAll(timeRegex)];
    if (timeMatches.length > 0) {
      const text = trimmed.replace(stripRegex, "").trim();
      for (const match of timeMatches) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        let ms = 0;
        if (match[3]) {
          const msStr = match[3];
          if (msStr.length === 2) ms = parseInt(msStr, 10) * 10;
          else if (msStr.length === 1) ms = parseInt(msStr, 10) * 100;
          else ms = parseInt(msStr, 10);
        }
        const time = minutes * 60 + seconds + ms / 1000;
        if (text) synced.push({ time, text });
      }
      if (text) plain.push(text);
    } else {
      plain.push(trimmed);
    }
  }

  synced.sort((a, b) => a.time - b.time);

  return {
    synced: synced.length > 0 ? synced : null,
    plain: plain.join("\n"),
  };
}

module.exports = registerIPCHandlers;
module.exports.setSMTCBridge = setSMTCBridge;

/**
 * Revolutionary: Look up cover art by track ID for the nova-media://art/ protocol.
 * This allows the renderer to display cover art even for tracks whose
 * base64 data: URIs were stripped from library:get-all to save bandwidth.
 * Returns { coverArt: string|null } where coverArt is a file path or data: URI.
 *
 * Performance: Uses an in-memory Map cache to avoid repeated libraryById
 * lookups. Each cover art image triggers multiple requests (album card,
 * track row, now-playing display), so caching the lookup result eliminates
 * redundant Map.get() calls and null checks.
 */
const _coverArtByIdCache = new Map(); // trackId → coverArt string | null
function getCoverArtByTrackId(trackId) {
  const cached = _coverArtByIdCache.get(trackId);
  if (cached !== undefined) return cached;
  if (!db) {
    return null;
  }
  let result = null;
  try {
    const row = db
      .prepare("SELECT coverArt FROM track_covers WHERE trackId = ?")
      .get(trackId);
    result = row ? row.coverArt : null;
  } catch (err) {
    console.error("Failed to query track_covers:", err.message);
  }
  _coverArtByIdCache.set(trackId, result);
  return result;
}
module.exports.getCoverArtByTrackId = getCoverArtByTrackId;

function findAlternativeTrackPath(originalPath) {
  try {
    if (!db) return null;
    const normalizedPath = path.win32.normalize(originalPath);
    const row = db
      .prepare("SELECT id, title, artist, data FROM tracks WHERE filePath = ?")
      .get(normalizedPath);
    if (!row || !row.title) return null;

    const alternatives = db
      .prepare(
        `
      SELECT filePath FROM tracks 
      WHERE title = ? COLLATE NOCASE 
        AND artist = ? COLLATE NOCASE 
        AND filePath != ?
    `,
      )
      .all(row.title, row.artist, normalizedPath);

    for (const alt of alternatives) {
      if (alt.filePath && fs.existsSync(alt.filePath)) {
        try {
          const trackData = JSON.parse(row.data);
          trackData.filePath = alt.filePath;
          db.prepare(
            `
            UPDATE tracks 
            SET filePath = ?, data = ?
            WHERE id = ?
          `,
          ).run(alt.filePath, JSON.stringify(trackData), row.id);

          libraryCache = null;
          _libraryDirty = true;
          console.log(
            `[self-healing] Updated DB track ${row.id} to new path: ${alt.filePath}`,
          );
        } catch (updateErr) {
          console.warn(
            "[self-healing] Failed to update DB path:",
            updateErr.message,
          );
        }
        return alt.filePath;
      }
    }
  } catch (err) {
    console.warn("Failed to find alternative track path:", err.message);
  }
  return null;
}
module.exports.findAlternativeTrackPath = findAlternativeTrackPath;

// ─── Over-the-Air (OTA) Update Check ─────────────────────────────────
// Two update paths:
// 1. Manual/GitHub API check (fallback for dev mode or non-packaged builds)
// 2. electron-updater autoUpdater (production, packaged builds)
// The renderer calls app:check-update which tries autoUpdater first,
// then falls back to the GitHub API check.
const CURRENT_VERSION = require("../package.json").version || "1.0.0";

ipcMain.handle("app:check-update", async () => {
  // If electron-updater is available and we're packaged, use it
  try {
    const { autoUpdater } = require("electron-updater");
    const { app } = require("electron");
    if (autoUpdater && app.isPackaged) {
      const result = await autoUpdater.checkForUpdates();
      if (result && result.updateInfo) {
        const latestVersion = result.updateInfo.version;
        const hasUpdate =
          latestVersion && compareVersions(latestVersion, CURRENT_VERSION) > 0;
        return {
          success: true,
          currentVersion: CURRENT_VERSION,
          latestVersion: latestVersion || CURRENT_VERSION,
          hasUpdate,
          releaseNotes: result.updateInfo.releaseNotes || "",
          source: "electron-updater",
        };
      }
    }
  } catch (_) {
    // Fall through to GitHub API check
  }

  // Fallback: GitHub Releases API check (works in dev mode too)
  try {
    const response = await net.fetch(
      "https://api.github.com/repos/AnonymousV73X/WINDOWS-MUSIC-PLAYER/releases/latest",
      {
        headers: { "User-Agent": "NovaTune-Update-Check" },
      },
    );
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    const latestVersion = (data.tag_name || "").replace(/^v/, "");
    const hasUpdate =
      latestVersion && compareVersions(latestVersion, CURRENT_VERSION) > 0;

    return {
      success: true,
      currentVersion: CURRENT_VERSION,
      latestVersion: latestVersion || CURRENT_VERSION,
      hasUpdate,
      releaseUrl: data.html_url || "",
      releaseNotes: data.body || "",
      downloadUrl:
        data.assets && data.assets.length > 0
          ? data.assets[0].browser_download_url
          : "",
      source: "github-api",
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Download the available update (electron-updater only)
ipcMain.handle("app:download-update", async () => {
  try {
    const { autoUpdater } = require("electron-updater");
    if (!autoUpdater) {
      return { success: false, error: "electron-updater not installed" };
    }
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Install the downloaded update (electron-updater only)
ipcMain.handle("app:install-update", async () => {
  try {
    const { autoUpdater } = require("electron-updater");
    if (!autoUpdater) {
      return { success: false, error: "electron-updater not installed" };
    }
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("app:open-external", async (_event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Simple semver comparison. Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareVersions(a, b) {
  const pa = (a || "0").split(".").map(Number);
  const pb = (b || "0").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}
