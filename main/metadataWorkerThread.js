/**
 * NovaTune — Metadata Worker Thread (runs in Worker Thread)
 * Performs metadata parsing off the main process thread.
 * Uses music-metadata (ESM dynamic import) to read audio file metadata.
 *
 * PERF FIX: This runs in a separate thread so the main process event loop
 * is never blocked by metadata parsing, even on slow HDDs.
 *
 * Communication: receives { type, filePath, taskId } messages,
 * responds with { taskId, result, error } messages.
 */

const path = require("path");
const fs = require("fs");

// ─── FLAC Binary Duration Reader (same as metadataReader.js) ────
function _readFlacDurationBinary(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, header, 0, 4096, 0);
    fs.closeSync(fd);

    let flacOffset = -1;
    for (let i = 0; i <= bytesRead - 4; i++) {
      if (
        header[i] === 0x66 &&
        header[i + 1] === 0x4c &&
        header[i + 2] === 0x61 &&
        header[i + 3] === 0x43
      ) {
        flacOffset = i;
        break;
      }
    }
    if (flacOffset < 0) return 0;

    const blockHeaderByte = header[flacOffset + 4];
    const isLast0 = (blockHeaderByte & 0x80) !== 0;
    const blockLen0 =
      (header[flacOffset + 5] << 16) |
      (header[flacOffset + 6] << 8) |
      header[flacOffset + 7];

    if (flacOffset + 8 + blockLen0 > bytesRead) return 0;

    const si = flacOffset + 8;
    const byte8 = header[si + 8];
    const byte9 = header[si + 9];
    const byte10 = header[si + 10];
    const byte11 = header[si + 11];
    const byte12 = header[si + 12];
    const byte13 = header[si + 13];
    const byte14 = header[si + 14];
    const byte15 = header[si + 15];
    const byte16 = header[si + 16];
    const byte17 = header[si + 17];

    const sampleRate = (byte8 << 12) | (byte9 << 4) | (byte10 >> 4);
    if (sampleRate === 0) return 0;

    const totalSamples =
      (BigInt(byte10 & 0x0f) << 32n) |
      (BigInt(byte11) << 24n) |
      (BigInt(byte12) << 16n) |
      (BigInt(byte13) << 8n) |
      BigInt(byte14);

    return totalSamples > 0n
      ? Math.round(Number(totalSamples) / sampleRate)
      : 0;
  } catch (_) {
    return 0;
  }
}

// ─── Module state ────────────────────────────────────────────────
let mm = null;
let coverCacheDir = null;

async function ensureMM() {
  if (mm) return mm;
  try {
    const mod = await import("music-metadata");
    mm = mod.default || mod;
    return mm;
  } catch (err) {
    throw new Error("music-metadata failed to load: " + err.message);
  }
}

// ─── Cover art cache helpers ─────────────────────────────────────
function _saveEmbeddedCover(filePath, picture) {
  if (!coverCacheDir) return null;
  try {
    if (!fs.existsSync(coverCacheDir)) {
      fs.mkdirSync(coverCacheDir, { recursive: true });
    }
    const hash = require("crypto")
      .createHash("md5")
      .update(filePath)
      .digest("hex")
      .substring(0, 16);
    const ext = (picture.format || "image/jpeg").split("/")[1] || "jpeg";
    const cachePath = path.join(coverCacheDir, `${hash}.${ext}`);
    if (!fs.existsSync(cachePath)) {
      fs.writeFileSync(cachePath, picture.data);
    }
    return cachePath;
  } catch (err) {
    return null;
  }
}

function _findOfflineCover(filePath) {
  try {
    const dir = path.dirname(filePath);
    const audioName = path
      .basename(filePath, path.extname(filePath))
      .toLowerCase();
    const extList = [
      ".jpg",
      ".jpeg",
      ".png",
      ".webp",
      ".bmp",
      ".gif",
      ".tiff",
      ".tif",
    ];
    const commonNames = new Set([
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

    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir);

    // .novaart sidecar
    for (const file of files) {
      const lower = file.toLowerCase();
      if (lower.includes(".novaart") && extList.includes(path.extname(lower))) {
        return path.join(dir, file);
      }
    }
    // Exact name match
    for (const file of files) {
      const fileExt = path.extname(file).toLowerCase();
      if (extList.includes(fileExt)) {
        if (
          path.basename(file, path.extname(file)).toLowerCase() === audioName
        ) {
          return path.join(dir, file);
        }
      }
    }
    // Common names
    for (const file of files) {
      const fileExt = path.extname(file).toLowerCase();
      if (extList.includes(fileExt)) {
        const nameNoExt = path.basename(file, path.extname(file)).toLowerCase();
        if (commonNames.has(nameNoExt)) {
          return path.join(dir, file);
        }
      }
    }
    // Album art files
    let fallbackArt = null;
    for (const file of files) {
      const fileExt = path.extname(file).toLowerCase();
      if (extList.includes(fileExt)) {
        const nameNoExt = path.basename(file, path.extname(file)).toLowerCase();
        if (nameNoExt.startsWith("albumart")) {
          const fullPath = path.join(dir, file);
          if (nameNoExt.includes("large")) return fullPath;
          fallbackArt = fallbackArt || fullPath;
        }
      }
    }
    return fallbackArt;
  } catch (_) {
    return null;
  }
}

// ─── Main metadata reader (same logic as MetadataReader but for worker) ──
async function readMetadata(filePath, knownArtists) {
  const attempts = 3;
  const delay = 200;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const lib = await ensureMM();
      const result = await lib.parseFile(filePath, {
        duration: true,
        skipCovers: false,
        includeChapters: false,
      });

      const duration = result.format.duration
        ? Math.round(result.format.duration)
        : 0;

      if (duration === 0 && attempt < attempts) {
        let fileSize = 0;
        try {
          fileSize = fs.statSync(filePath).size;
        } catch (_) {}
        if (fileSize > 0) {
          lastError = new Error("Duration parsed as 0");
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }

      const metadata = {
        title:
          (Array.isArray(result.common.title)
            ? result.common.title[0]
            : result.common.title) || "",
        artist:
          (result.common.artists && result.common.artists.join(", ")) || "",
        album: result.common.album || "",
        albumArtist: result.common.albumartist || "",
        genre:
          (Array.isArray(result.common.genre)
            ? result.common.genre.join(", ")
            : result.common.genre) || "",
        year: result.common.year || 0,
        trackNumber: (result.common.track && result.common.track.no) || 0,
        discNumber: (result.common.disc && result.common.disc.no) || 0,
        duration,
        bitrate: result.format.bitrate
          ? Math.round(result.format.bitrate / 1000)
          : 0,
        sampleRate: result.format.sampleRate || 0,
        channels: result.format.numberOfChannels || 0,
        format:
          (result.format.container || "").toUpperCase() ||
          path.extname(filePath).replace(".", "").toUpperCase(),
        coverArt: null,
      };

      // FLAC binary fallback
      if (
        metadata.duration === 0 &&
        path.extname(filePath).toLowerCase() === ".flac"
      ) {
        const binaryDur = _readFlacDurationBinary(filePath);
        if (binaryDur > 0) metadata.duration = binaryDur;
      }

      // Extract cover art
      if (result.common.picture && result.common.picture.length > 0) {
        const picture = result.common.picture[0];
        const buf = picture.data;
        if (buf.length < 200 * 1024) {
          metadata.coverArt = `data:${picture.format || "image/jpeg"};base64,${Buffer.from(buf).toString("base64")}`;
        } else {
          metadata.coverArt = _saveEmbeddedCover(filePath, picture);
        }
      }

      if (!metadata.coverArt) {
        metadata.coverArt = _findOfflineCover(filePath);
      }

      // v1.1.6 EXHAUSTIVE SCANNER FIX: If the file has underscores in its
      // name (YouTube rip) AND music-metadata returned an empty title
      // (no ID3 tags), run _workerFallbackMetadata to get a nice parsed
      // title. This is the KEY fix for files like
      // don_toliver_high_unreleased__yaxBLgIoHuI_140.mp3 where the MP3
      // stream is valid (duration > 0) but there are no metadata tags.
      // Previously these files got added with the raw filename as title.
      {
        const fileName = path.basename(filePath);
        const hasUnderscores = /_/.test(fileName || "");
        const hasYtSuffix = /__(?:[A-Za-z0-9_-]{8,})_\d{2,4}$/.test(fileName || "");
        const nameNoExt = path.basename(filePath, path.extname(filePath));
        const hasEmptyTitle =
          !metadata.title || metadata.title === fileName ||
          metadata.title === nameNoExt;
        if ((hasUnderscores || hasYtSuffix) && hasEmptyTitle && typeof _workerFallbackMetadata === "function") {
          try {
            const fallback = _workerFallbackMetadata(filePath, knownArtists || new Map());
            if (fallback && fallback.title) {
              metadata.title = fallback.title;
              metadata.artist = fallback.artist;
              if (!metadata.album || metadata.album === "Unknown Album")
                metadata.album = fallback.album;
              if (!metadata.coverArt) metadata.coverArt = fallback.coverArt;
            }
          } catch (_) {}
        }
      }

      return metadata;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // Last resort: parseBuffer
  try {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      ".mp3": "audio/mpeg",
      ".flac": "audio/flac",
      ".m4a": "audio/mp4",
      ".ogg": "audio/ogg",
      ".opus": "audio/ogg",
      ".wav": "audio/wav",
      ".wma": "audio/x-ms-wma",
      ".ape": "audio/x-ape",
      ".wv": "audio/x-wavpack",
    };
    const mime = mimeMap[ext];
    if (mime) {
      const lib = await ensureMM();
      const buf = fs.readFileSync(filePath);
      const result = await lib.parseBuffer(buf, mime, {
        duration: true,
        skipCovers: true,
      });
      const duration = result.format.duration
        ? Math.round(result.format.duration)
        : 0;
      if (duration > 0) {
        const nameNoExt = path.basename(filePath, path.extname(filePath));
        let title = nameNoExt;
        let artist = "Unknown Artist";
        const dashIdx = nameNoExt.indexOf(" - ");
        if (dashIdx > 0) {
          artist = nameNoExt.substring(0, dashIdx).trim();
          title = nameNoExt.substring(dashIdx + 3).trim();
        }
        return {
          title:
            (Array.isArray(result.common.title)
              ? result.common.title[0]
              : result.common.title) || title,
          artist:
            (result.common.artists && result.common.artists.join(", ")) ||
            artist,
          album: result.common.album || "Unknown Album",
          albumArtist: "",
          genre: "",
          year: 0,
          trackNumber: 0,
          discNumber: 0,
          duration,
          bitrate: result.format.bitrate
            ? Math.round(result.format.bitrate / 1000)
            : 0,
          sampleRate: result.format.sampleRate || 0,
          channels: result.format.numberOfChannels || 0,
          format: ext.replace(".", "").toUpperCase(),
          coverArt: null,
        };
      }
    }
  } catch (_) {}

  // v1.1.5: Filename-based fallback (mirrors MetadataReader._fallbackMetadata).
  // This runs INSIDE the worker so we don't have to round-trip back to the
  // main thread when music-metadata fails. knownArtists is a plain object
  // (serialized from a Map by metadataWorker.js).
  if (knownArtists && typeof knownArtists === "object") {
    // Rehydrate as a Map for the fallback parser
    const knownArtistsMap = new Map(Object.entries(knownArtists));
    try {
      const fallback = _workerFallbackMetadata(filePath, knownArtistsMap);
      if (fallback) return fallback;
    } catch (_) {}
  } else {
    // No knownArtists — still try the fallback with an empty Map
    try {
      const fallback = _workerFallbackMetadata(filePath, new Map());
      if (fallback) return fallback;
    } catch (_) {}
  }

  throw lastError || new Error("Failed to read metadata");
}

async function readQuickInfo(filePath) {
  try {
    const lib = await ensureMM();
    const result = await lib.parseFile(filePath, {
      duration: true,
      skipCovers: true,
      includeChapters: false,
    });
    const duration = result.format.duration
      ? Math.round(result.format.duration)
      : 0;
    let title = "",
      artist = "Unknown Artist",
      album = "Unknown Album";
    if (result.common.title)
      title = Array.isArray(result.common.title)
        ? result.common.title[0]
        : result.common.title;
    if (result.common.artists) artist = result.common.artists.join(", ");
    if (result.common.album) album = result.common.album;
    if (!title) {
      const nameNoExt = path.basename(filePath, path.extname(filePath));
      const dashIdx = nameNoExt.indexOf(" - ");
      if (dashIdx > 0) {
        artist = nameNoExt.substring(0, dashIdx).trim();
        title = nameNoExt.substring(dashIdx + 3).trim();
      } else title = nameNoExt;
    }
    const ext = path.extname(filePath).replace(".", "").toUpperCase();
    let fileSize = 0;
    try {
      fileSize = fs.statSync(filePath).size;
    } catch (_) {}
    return {
      title,
      artist,
      album,
      duration,
      bitrate: result.format.bitrate
        ? Math.round(result.format.bitrate / 1000)
        : 0,
      sampleRate: result.format.sampleRate || 0,
      channels: result.format.numberOfChannels || 0,
      format: ext,
      fileSize,
      coverArt: null,
    };
  } catch (err) {
    throw err;
  }
}


// ─── v1.1.5: Filename-based fallback for the worker thread ────────
// Mirrors MetadataReader._fallbackMetadata in metadataReader.js.
// Runs INSIDE the worker so we don't round-trip to main on failure.
function _workerFallbackMetadata(filePath, knownArtists) {
  const nameWithoutExt = path.basename(filePath, path.extname(filePath));

  // 1. Strip YouTube-rip suffix: __<id>_<itag>
  let cleanedName = nameWithoutExt;
  const ytSuffixMatch = nameWithoutExt.match(/__(?:[A-Za-z0-9_-]{8,})_(\d{2,4})$/);
  let ytItag = 0;
  if (ytSuffixMatch) {
    ytItag = parseInt(ytSuffixMatch[1], 10) || 0;
    cleanedName = nameWithoutExt.slice(0, nameWithoutExt.length - ytSuffixMatch[0].length);
    cleanedName = cleanedName.replace(/_+$/, "").replace(/^_+/, "");
  }

  // 2. Parse "Artist - Title" or underscore-separated
  let title = cleanedName;
  let artist = "Unknown Artist";
  const dashIndex = cleanedName.indexOf(" - ");
  if (dashIndex > 0 && dashIndex < cleanedName.length - 3) {
    artist = cleanedName.substring(0, dashIndex).trim();
    title = cleanedName.substring(dashIndex + 3).trim();
  } else if (/[_]/.test(cleanedName)) {
    const tokens = cleanedName.split(/[_]+/).map((t) => t.trim()).filter(Boolean);
    let matchedArtist = null;
    let artistTokenCount = 0;
    if (knownArtists && knownArtists.size > 0 && tokens.length >= 2) {
      for (let n = Math.min(3, tokens.length - 1); n >= 1; n--) {
        const prefix = tokens.slice(0, n).join(" ").toLowerCase();
        if (knownArtists.has(prefix)) {
          matchedArtist = knownArtists.get(prefix);
          artistTokenCount = n;
          break;
        }
      }
    }
    if (matchedArtist && artistTokenCount > 0) {
      artist = matchedArtist;
      const titleTokens = tokens.slice(artistTokenCount);
      const titleStr = titleTokens.join(" ");
      const titleCased = titleStr.replace(/\b\w/g, (c) => c.toUpperCase());
      title = titleCased
        .replace(/\bUnreleased\b/g, "(Unreleased)")
        .replace(/\bOfficial\s+(Video|Visualizer|Audio)\b/g, "(Official $1)")
        .replace(/\bOfficial\b/g, "(Official)")
        .replace(/\bLyrics\b/g, "(Lyrics)")
        .replace(/\s+/g, " ")
        .trim();
    } else {
      const spaced = cleanedName.replace(/_/g, " ").replace(/\s+/g, " ").trim();
      const titleCased = spaced.replace(/\b\w/g, (c) => c.toUpperCase());
      title = titleCased
        .replace(/\bUnreleased\b/g, "(Unreleased)")
        .replace(/\bOfficial\s+(Video|Visualizer|Audio)\b/g, "(Official $1)")
        .replace(/\bOfficial\b/g, "(Official)")
        .replace(/\bLyrics\b/g, "(Lyrics)")
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  title = title.replace(/^\d+[._\s]+/, "").trim() || title;
  title = title.replace(/\s+/g, " ").trim();
  artist = artist.replace(/\s+/g, " ").trim() || "Unknown Artist";

  // 3. Estimate duration from file size
  const ext = path.extname(filePath).replace(".", "").toUpperCase();
  let fileSize = 0;
  try {
    fileSize = fs.statSync(filePath).size;
  } catch (_) {}

  let duration = 0;
  let bitrate = 0;
  if (fileSize > 0) {
    const extLower = path.extname(filePath).toLowerCase();
    let assumedKbps = 128;
    if (ytItag > 0) {
      const itagBitrate = {
        140: 128, 139: 48, 171: 128, 249: 50, 250: 70, 251: 160,
        18: 96, 22: 192,
      };
      if (itagBitrate[ytItag]) assumedKbps = itagBitrate[ytItag];
    } else if (extLower === ".m4a") assumedKbps = 256;
    else if (extLower === ".opus") assumedKbps = 96;
    else if (extLower === ".ogg") assumedKbps = 112;
    else if (extLower === ".flac") assumedKbps = 900;
    else if (extLower === ".wav") assumedKbps = 1411;
    if (assumedKbps > 0) {
      const estimated = Math.floor((fileSize * 8) / (assumedKbps * 1000));
      duration = Math.min(3600, Math.max(1, estimated));
      bitrate = assumedKbps;
    }
  }

  return {
    title,
    artist,
    album: "Unknown Album",
    albumArtist: "",
    genre: "",
    year: 0,
    trackNumber: 0,
    discNumber: 0,
    duration,
    bitrate,
    sampleRate: 0,
    channels: 0,
    format: ext,
    coverArt: _findOfflineCover(filePath),
    fileSize,
  };
}

// ─── Message handler ─────────────────────────────────────────────
const { parentPort } = require("worker_threads");

parentPort.on("message", async (msg) => {
  if (msg.type === "setCoverCacheDir") {
    coverCacheDir = msg.dir;
    return;
  }

  const { type, filePath, taskId, knownArtists } = msg;
  try {
    let result;
    if (type === "readMetadata") {
      // v1.1.5: knownArtists is a plain object (serialized from a Map).
      // readMetadata will rehydrate it.
      result = await readMetadata(filePath, knownArtists);
    } else if (type === "readQuickInfo") {
      result = await readQuickInfo(filePath);
    } else {
      throw new Error(`Unknown message type: ${type}`);
    }
    parentPort.postMessage({ taskId, result });
  } catch (err) {
    parentPort.postMessage({ taskId, error: err.message });
  }
});
