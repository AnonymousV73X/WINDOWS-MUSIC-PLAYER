/**
 * NovaTune — Manifest vs SQLite startup benchmark
 * ─────────────────────────────────────────────────────────────────────────
 * Run with:  node scripts/bench-manifest.js
 *
 * Generates a synthetic 1127-track library (matching the user's real size),
 * then measures three startup-cost scenarios:
 *
 *   1. SQLite cold path: SELECT data FROM tracks + JSON.parse per row
 *      (what the renderer used to do via library:get-page)
 *   2. Manifest cold path: ONE fs.readFile + lazy decode of first 500 tracks
 *      (what the renderer does now via library:get-manifest-buffer)
 *   3. Manifest warm path: decode first 500 from already-loaded ArrayBuffer
 *      (simulates a re-render — e.g. after sort change)
 *
 * Outputs a comparison table + speedup factor.
 *
 * No external deps — uses the same in-tree modules the app uses.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const ManifestWriter = require("../main/manifest");
const ManifestReader = require("../main/manifestReader");

// better-sqlite3 is a native module — try to load it, but degrade
// gracefully if it's missing (e.g. in CI / dev environments without
// `npm install` having been run). The manifest half of the benchmark
// still works without it.
let Database = null;
try {
  Database = require("better-sqlite3");
} catch (err) {
  console.warn(`[bench] better-sqlite3 not available — skipping SQLite scenarios.`);
  console.warn(`[bench] (Run "npm install" in the project root to enable SQLite comparison.)\n`);
}

// ─── Config ─────────────────────────────────────────────────────────
const TRACK_COUNT = 1127;       // matches the user's real library size
const FIRST_PAGE_SIZE = 500;    // matches renderer's FIRST_PAGE_SIZE
const RUNS = 5;                 // median of N runs per scenario

// ─── Synthetic track generator ──────────────────────────────────────
const ARTISTS = [
  "Soul of Afrika", "The Midnight Synth", "Nova Quartet",
  "Echo Valley", "Lunar Drift", "Crimson Jazz Trio",
  "Aurora Sound System", "The Quiet Storm", "Velvet Underground",
  "Digital Nomads", "Unknown Artist",
];
const ALBUMS = [
  "My Portion", "Midnight Frequencies", "Echoes of Tomorrow",
  "Velvet Nights", "Solar Drift", "Crimson Skies",
  "Aurora Borealis", "Quiet Storm", "Underground Vibes",
  "Nomadic Rhythms", "Unknown Album",
];
const GENRES = ["Afrobeat", "Synthwave", "Jazz", "Electronic", "Ambient", "Soul"];
const FORMATS = ["MP3", "FLAC", "OGG", "M4A"];

function randomFrom(arr, seed) {
  return arr[Math.floor(seed * arr.length) % arr.length];
}

function generateTracks(n) {
  const tracks = [];
  for (let i = 0; i < n; i++) {
    const seed = (i * 2654435761) % 1000000 / 1000000;
    const artist = randomFrom(ARTISTS, seed);
    const album = randomFrom(ALBUMS, seed + 0.1);
    const title = `Track ${String(i + 1).padStart(3, "0")} — ${randomFrom(GENRES, seed + 0.2)}`;
    const filePath = `C:/Users/user/Music/Music/${String(i + 1).padStart(2, "0")}. ${artist} - ${title}.mp3`;
    tracks.push({
      id: crypto.createHash("sha256").update(filePath).digest("hex").substring(0, 16),
      filePath,
      fileName: path.basename(filePath),
      title,
      artist,
      album,
      albumArtist: artist,
      genre: randomFrom(GENRES, seed + 0.3),
      year: 1990 + Math.floor(seed * 35),
      trackNumber: (i % 12) + 1,
      discNumber: 1,
      duration: 120 + Math.floor(seed * 300),  // 2-7 minutes
      bitrate: 320,
      sampleRate: 44100,
      channels: 2,
      format: randomFrom(FORMATS, seed + 0.4),
      _hasCoverArt: i % 5 !== 0,  // 80% have cover art
      _thumbHash: i % 3 === 0 ? "AAAAYe" + btoa(String(i)).slice(0, 20) : null,
      fileSize: 3000000 + Math.floor(seed * 8000000),
      dateAdded: Date.now() - Math.floor(seed * 86400000 * 365),
      dateModified: Date.now() - Math.floor(seed * 86400000 * 30),
    });
  }
  return tracks;
}

// ─── Build SQLite DB (mirrors NovaTune's schema) ────────────────────
function buildSqlite(tracks, dbPath) {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY, title TEXT, artist TEXT, album TEXT,
      genre TEXT, year INTEGER, duration REAL, dateAdded INTEGER,
      filePath TEXT UNIQUE, data TEXT NOT NULL
    );
    CREATE INDEX idx_tracks_date_added ON tracks(dateAdded DESC);
  `);
  const insert = db.prepare(`
    INSERT INTO tracks (id, title, artist, album, genre, year, duration,
                        dateAdded, filePath, data)
    VALUES (@id, @title, @artist, @album, @genre, @year, @duration,
            @dateAdded, @filePath, @data)
  `);
  const tx = db.transaction((rows) => {
    for (const t of rows) {
      const { _thumbHash, _hasCoverArt, ...rest } = t;
      const data = { ...rest, _hasCoverArt, _thumbHash };
      insert.run({
        id: t.id, title: t.title, artist: t.artist, album: t.album,
        genre: t.genre, year: t.year, duration: t.duration,
        dateAdded: t.dateAdded, filePath: t.filePath,
        data: JSON.stringify(data),
      });
    }
  });
  tx(tracks);
  db.close();
}

// ─── Scenarios ──────────────────────────────────────────────────────
function benchSqliteCold(dbPath) {
  // Open DB, SELECT first 500, JSON.parse each row.
  // Mirrors library:get-page cold path.
  const t0 = process.hrtime.bigint();
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(
    "SELECT data FROM tracks ORDER BY dateAdded DESC, title COLLATE NOCASE LIMIT ? OFFSET 0"
  ).all(FIRST_PAGE_SIZE);
  const tracks = rows.map(r => JSON.parse(r.data));
  db.close();
  const t1 = process.hrtime.bigint();
  return { ms: Number(t1 - t0) / 1e6, count: tracks.length };
}

function benchSqliteFull(dbPath) {
  // Open DB, SELECT ALL, JSON.parse each row.
  // Mirrors what the renderer ultimately needs (all 1127 in state.tracks).
  const t0 = process.hrtime.bigint();
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(
    "SELECT data FROM tracks ORDER BY dateAdded DESC, title COLLATE NOCASE"
  ).all();
  const tracks = rows.map(r => JSON.parse(r.data));
  db.close();
  const t1 = process.hrtime.bigint();
  return { ms: Number(t1 - t0) / 1e6, count: tracks.length };
}

function benchManifestWrite(tracks, manifestPath) {
  const t0 = process.hrtime.bigint();
  ManifestWriter.writeSync(manifestPath, tracks, {
    folderFingerprint: "test-fingerprint"
  });
  const t1 = process.hrtime.bigint();
  const size = fs.statSync(manifestPath).size;
  return { ms: Number(t1 - t0) / 1e6, size };
}

function benchManifestColdRead(manifestPath) {
  // ONE fs.readFile + ManifestReader construction (header parse + CRC check)
  const t0 = process.hrtime.bigint();
  const buf = fs.readFileSync(manifestPath);
  const reader = new ManifestReader(buf);
  if (!reader.valid) throw new Error("manifest invalid: " + reader.error);
  const t1 = process.hrtime.bigint();
  return { ms: Number(t1 - t0) / 1e6, size: buf.length, count: reader.trackCount };
}

function benchManifestFirstPage(manifestPath) {
  // ONE fs.readFile + construct reader + decode first 500 tracks
  // This is the realistic "time to first paint" with the manifest.
  const t0 = process.hrtime.bigint();
  const buf = fs.readFileSync(manifestPath);
  const reader = new ManifestReader(buf);
  if (!reader.valid) throw new Error("manifest invalid: " + reader.error);
  const tracks = reader.getTracksRange(0, FIRST_PAGE_SIZE, "sortDateAddedDesc");
  const t1 = process.hrtime.bigint();
  return { ms: Number(t1 - t0) / 1e6, count: tracks.length };
}

function benchManifestFull(manifestPath) {
  // ONE fs.readFile + decode ALL tracks
  const t0 = process.hrtime.bigint();
  const buf = fs.readFileSync(manifestPath);
  const reader = new ManifestReader(buf);
  if (!reader.valid) throw new Error("manifest invalid: " + reader.error);
  const tracks = reader.getAllTracks("sortDateAddedDesc");
  const t1 = process.hrtime.bigint();
  return { ms: Number(t1 - t0) / 1e6, count: tracks.length };
}

function benchManifestFindById(manifestPath, id) {
  const buf = fs.readFileSync(manifestPath);
  const reader = new ManifestReader(buf);
  // Measure only the lookup, not the file read
  const t0 = process.hrtime.bigint();
  const result = reader.findById(id);
  const t1 = process.hrtime.bigint();
  return { ms: Number(t1 - t0) / 1e6, found: !!result };
}

function benchManifestFindByFilePath(manifestPath, filePath) {
  const buf = fs.readFileSync(manifestPath);
  const reader = new ManifestReader(buf);
  const t0 = process.hrtime.bigint();
  const result = reader.findByFilePath(filePath);
  const t1 = process.hrtime.bigint();
  return { ms: Number(t1 - t0) / 1e6, found: !!result };
}

// ─── Median helper ──────────────────────────────────────────────────
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function runBench(fn, ...args) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    // Force GC between runs to avoid measurement noise from object reuse
    if (global.gc) global.gc();
    samples.push(fn(...args).ms);
  }
  return median(samples);
}

// ─── Pretty-print ───────────────────────────────────────────────────
function fmt(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  NovaTune — Manifest vs SQLite startup benchmark");
  console.log(`  Library size: ${TRACK_COUNT} tracks  |  First page: ${FIRST_PAGE_SIZE}  |  Runs/scenario: ${RUNS}`);
  console.log("═══════════════════════════════════════════════════════════════════\n");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "novatune-bench-"));
  const dbPath = path.join(tmpDir, "bench.sqlite");
  const manifestPath = path.join(tmpDir, "library.bin");

  try {
    // ── Generate tracks ──
    console.log(`Generating ${TRACK_COUNT} synthetic tracks...`);
    const tracks = generateTracks(TRACK_COUNT);

    // ── Build SQLite (skip if better-sqlite3 not available) ──
    let dbSize = 0;
    if (Database) {
      console.log("Building SQLite DB (mirrors NovaTune schema)...");
      buildSqlite(tracks, dbPath);
      dbSize = fs.statSync(dbPath).size;
      console.log(`  SQLite size: ${fmtBytes(dbSize)}\n`);
    }

    // ── Build manifest ──
    console.log("Building binary manifest...");
    const writeResult = benchManifestWrite(tracks, manifestPath);
    console.log(`  Manifest size: ${fmtBytes(writeResult.size)}`);
    console.log(`  Write time:    ${fmt(writeResult.ms)}\n`);

    // ── Run benchmarks ──
    console.log("Running benchmarks...\n");

    let sqliteCold = 0, sqliteFull = 0;
    if (Database) {
      sqliteCold = runBench(benchSqliteCold, dbPath);
      sqliteFull = runBench(benchSqliteFull, dbPath);
    }
    const manifestColdRead = runBench(benchManifestColdRead, manifestPath);
    const manifestFirstPage = runBench(benchManifestFirstPage, manifestPath);
    const manifestFull = runBench(benchManifestFull, manifestPath);

    // Lookups
    const sampleId = tracks[Math.floor(TRACK_COUNT / 2)].id;
    const samplePath = tracks[Math.floor(TRACK_COUNT / 2)].filePath;
    const manifestFindById = runBench(benchManifestFindById, manifestPath, sampleId);
    const manifestFindByPath = runBench(benchManifestFindByFilePath, manifestPath, samplePath);

    // ── Report ──
    console.log("┌─────────────────────────────────────────────────────────┬───────────┐");
    console.log("│ Scenario                                                │ Median    │");
    console.log("├─────────────────────────────────────────────────────────┼───────────┤");
    if (Database) {
      console.log(`│ SQLite  cold (first ${FIRST_PAGE_SIZE} tracks)                    │ ${fmt(sqliteCold).padStart(9)} │`);
      console.log(`│ SQLite  cold (all ${TRACK_COUNT} tracks)                       │ ${fmt(sqliteFull).padStart(9)} │`);
    } else {
      console.log(`│ SQLite  cold (first ${FIRST_PAGE_SIZE} tracks)                    │  (n/a)    │`);
      console.log(`│ SQLite  cold (all ${TRACK_COUNT} tracks)                       │  (n/a)    │`);
    }
    console.log(`│ Manifest write (one-time, after scan)                   │ ${fmt(writeResult.ms).padStart(9)} │`);
    console.log(`│ Manifest cold read (file→buffer→valid header)           │ ${fmt(manifestColdRead).padStart(9)} │`);
    console.log(`│ Manifest first-page (file→decode ${FIRST_PAGE_SIZE})                │ ${fmt(manifestFirstPage).padStart(9)} │`);
    console.log(`│ Manifest full (file→decode all ${TRACK_COUNT})                     │ ${fmt(manifestFull).padStart(9)} │`);
    console.log(`│ Manifest findById (binary search, post-load)            │ ${fmt(manifestFindById).padStart(9)} │`);
    console.log(`│ Manifest findByFilePath (hash lookup, post-load)        │ ${fmt(manifestFindByPath).padStart(9)} │`);
    console.log("└─────────────────────────────────────────────────────────┴───────────┘\n");

    // ── Speedup calculation ──
    if (Database) {
      const firstPageSpeedup = sqliteCold / manifestFirstPage;
      const fullSpeedup = sqliteFull / manifestFull;
      const sizeReduction = dbSize / writeResult.size;

      console.log("┌─────────────────────────────────────────────────────────┬───────────┐");
      console.log("│ Metric                                                   │   Value   │");
      console.log("├─────────────────────────────────────────────────────────┼───────────┤");
      console.log(`│ First-page speedup (SQLite cold ÷ Manifest first-page)  │ ${firstPageSpeedup.toFixed(1).padStart(7)}x │`);
      console.log(`│ Full-library speedup (SQLite cold ÷ Manifest full)      │ ${fullSpeedup.toFixed(1).padStart(7)}x │`);
      console.log(`│ File-size reduction (SQLite ÷ Manifest)                  │ ${sizeReduction.toFixed(1).padStart(7)}x │`);
      console.log(`│ Manifest write overhead (one-time per scan)             │ ${fmt(writeResult.ms).padStart(9)} │`);
      console.log("└───────────────────────────────────────────────────────────────────────┘\n");
    } else {
      console.log(`Manifest write overhead (one-time per scan): ${fmt(writeResult.ms)}\n`);
    }

    console.log("Notes:");
    console.log("  • SQLite cold path includes: open DB, SELECT, JSON.parse per row.");
    console.log("    In production this happens on the MAIN process and the result is");
    console.log("    structured-cloned across IPC to the renderer — add ~30-100ms");
    console.log("    IPC overhead per paginated call (not included in this benchmark).");
    console.log("  • Manifest cold path includes: fs.readFile (one syscall), header");
    console.log("    parse + CRC32 validation, lazy decode of requested range.");
    console.log("  • In production the manifest ArrayBuffer crosses IPC as a");
    console.log("    structured-cloned ArrayBuffer (one ~1MB memcpy, much cheaper");
    console.log("    than N×500 structured-cloned track objects).");
    console.log("");

  } finally {
    // Cleanup
    try { fs.unlinkSync(dbPath); } catch (_) {}
    try { fs.unlinkSync(manifestPath); } catch (_) {}
    try { fs.rmdirSync(tmpDir); } catch (_) {}
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
