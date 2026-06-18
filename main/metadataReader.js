/**
 * NovaTune — Metadata Reader Module
 * Reads audio file metadata using the music-metadata library.
 * Extracts tags, technical properties, and embedded cover art.
 *
 * IMPORTANT: music-metadata v8+ is ESM-only. We use dynamic import()
 * with a robust wrapper that handles both default and named exports.
 */

const path = require("path");
const fs = require("fs");

/** @type {import('music-metadata')|null} */
let mm = null;
let _loadAttempted = false;
let _loadFailed = false;

/**
 * Safely load music-metadata (ESM-only package).
 * Handles both { default: {...} } and direct named export patterns.
 * @returns {Promise<Object>} The music-metadata module API
 */
async function ensureMM() {
  if (mm) return mm;

  if (_loadFailed) {
    throw new Error(
      "music-metadata failed to load previously. Using fallback metadata only.",
    );
  }

  try {
    const mod = await import("music-metadata");
    // ESM modules may export as default or as named exports
    // Handle both patterns: mod.parseFile OR mod.default.parseFile
    if (mod.default && typeof mod.default.parseFile === "function") {
      mm = mod.default;
    } else if (typeof mod.parseFile === "function") {
      mm = mod;
    } else if (typeof mod.default === "object" && mod.default !== null) {
      mm = mod.default;
    } else {
      throw new Error("Cannot find parseFile in music-metadata module exports");
    }
    _loadAttempted = true;
    console.log("[metadataReader] music-metadata loaded successfully");
    return mm;
  } catch (err) {
    _loadFailed = true;
    _loadAttempted = true;
    console.error(
      "[metadataReader] Failed to load music-metadata:",
      err.message,
    );
    throw err;
  }
}

class MetadataReader {
  constructor() {
    this.supportedFormats = new Set([
      "mp3",
      "flac",
      "wav",
      "ogg",
      "m4a",
      "aac",
      "wma",
      "opus",
      "ape",
      "wv",
      "tta",
      "mpc",
      "aiff",
    ]);
    this._coverCacheDir = null;
  }

  /**
   * Set the directory for caching large embedded cover art.
   * Must be called before readMetadata if you want large art support.
   * @param {string} dir - Absolute path to cache directory
   */
  setCoverCacheDir(dir) {
    this._coverCacheDir = dir;
  }

  /**
   * Check if music-metadata is available.
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    if (mm) return true;
    if (_loadFailed) return false;
    try {
      await ensureMM();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read metadata from an audio file.
   * Falls back to basic filename-based metadata if music-metadata is unavailable.
   * @param {string} filePath - Absolute path to the audio file
   * @returns {Promise<Object>} Parsed metadata object
   */
  async readMetadata(filePath) {
    try {
      const lib = await ensureMM();
      const result = await lib.parseFile(filePath, {
        duration: true,
        skipCovers: false,
        includeChapters: false,
      });

      const metadata = {
        title: this._getFirst(result.common.title) || "",
        artist: this._joinArtists(result.common.artists) || "",
        album: this._getFirst(result.common.album) || "",
        albumArtist: this._getFirst(result.common.albumartist) || "",
        genre: this._joinArray(result.common.genre) || "",
        year: result.common.year || 0,
        trackNumber: this._getNumber(result.common.track) || 0,
        discNumber: this._getNumber(result.common.disc) || 0,
        duration: result.format.duration
          ? Math.round(result.format.duration)
          : 0,
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

      // Extract cover art (limit to 200KB base64 to avoid IPC bloat, cache files larger than that)
      if (result.common.picture && result.common.picture.length > 0) {
        const picture = result.common.picture[0];
        const buf = picture.data;
        if (buf.length < 200 * 1024) {
          metadata.coverArt = `data:${picture.format || "image/jpeg"};base64,${buf.toString("base64")}`;
        } else {
          metadata.coverArt = this._saveEmbeddedCover(filePath, picture);
        }
      }

      if (!metadata.coverArt) {
        metadata.coverArt = this._findOfflineCover(filePath);
      }

      return metadata;
    } catch (err) {
      console.warn(
        `[metadataReader] Metadata read error for ${path.basename(filePath)}:`,
        err.message,
      );
      // Return fallback metadata from filename
      return this._fallbackMetadata(filePath);
    }
  }

  /**
   * Get lightweight metadata (duration + format only) — much faster.
   * @param {string} filePath
   * @returns {Promise<{duration: number, format: string, bitrate: number, sampleRate: number, channels: number}>}
   */
  async readQuickInfo(filePath) {
    try {
      const lib = await ensureMM();
      const result = await lib.parseFile(filePath, {
        duration: true,
        skipCovers: true,
        includeChapters: false,
      });
      return {
        duration: result.format.duration
          ? Math.round(result.format.duration)
          : 0,
        format:
          (result.format.container || "").toUpperCase() ||
          path.extname(filePath).replace(".", "").toUpperCase(),
        bitrate: result.format.bitrate
          ? Math.round(result.format.bitrate / 1000)
          : 0,
        sampleRate: result.format.sampleRate || 0,
        channels: result.format.numberOfChannels || 0,
      };
    } catch {
      return {
        duration: 0,
        format: "",
        bitrate: 0,
        sampleRate: 0,
        channels: 0,
      };
    }
  }

  /**
   * Read metadata from a buffer (for in-memory files).
   * @param {Buffer} buffer - Audio file buffer
   * @param {string} mimeType - MIME type hint
   * @returns {Promise<Object>}
   */
  async readMetadataFromBuffer(buffer, mimeType) {
    try {
      const lib = await ensureMM();
      const result = await lib.parseBuffer(buffer, { mimeType });

      const metadata = {
        title: this._getFirst(result.common.title) || "",
        artist: this._joinArtists(result.common.artists) || "",
        album: this._getFirst(result.common.album) || "",
        albumArtist: this._getFirst(result.common.albumartist) || "",
        genre: this._joinArray(result.common.genre) || "",
        year: result.common.year || 0,
        trackNumber: this._getNumber(result.common.track) || 0,
        discNumber: this._getNumber(result.common.disc) || 0,
        duration: result.format.duration
          ? Math.round(result.format.duration)
          : 0,
        bitrate: result.format.bitrate
          ? Math.round(result.format.bitrate / 1000)
          : 0,
        sampleRate: result.format.sampleRate || 0,
        channels: result.format.numberOfChannels || 0,
        format: (result.format.container || "").toUpperCase(),
        coverArt: null,
      };

      if (result.common.picture && result.common.picture.length > 0) {
        const picture = result.common.picture[0];
        const buf = picture.data;
        if (buf.length < 200 * 1024) {
          metadata.coverArt = `data:${picture.format || "image/jpeg"};base64,${buf.toString("base64")}`;
        } else {
          metadata.coverArt = this._saveEmbeddedCoverFromBuffer(
            buffer,
            picture,
          );
        }
      }

      return metadata;
    } catch (err) {
      throw new Error(`Buffer metadata read error: ${err.message}`);
    }
  }

  /**
   * Get only the cover art from a file.
   * @param {string} filePath
   * @returns {Promise<string|null>} Base64 data URI or null
   */
  async getCoverArt(filePath) {
    try {
      const lib = await ensureMM();
      const result = await lib.parseFile(filePath, {
        duration: false,
        skipCovers: false,
      });

      if (result.common.picture && result.common.picture.length > 0) {
        const picture = result.common.picture[0];
        const buf = picture.data;
        if (buf.length < 200 * 1024) {
          return `data:${picture.format || "image/jpeg"};base64,${buf.toString("base64")}`;
        }
      }
      return this._findOfflineCover(filePath);
    } catch (err) {
      return this._findOfflineCover(filePath);
    }
  }

  // ─── Utility Helpers ─────────────────────────────────────────────

  /**
   * Generate fallback metadata from the filename when music-metadata fails.
   * @private
   */
  _fallbackMetadata(filePath) {
    const fileName = path.basename(filePath);
    const nameWithoutExt = path.basename(filePath, path.extname(filePath));

    // Try to parse "Artist - Title" pattern
    let title = nameWithoutExt;
    let artist = "Unknown Artist";

    const dashIndex = nameWithoutExt.indexOf(" - ");
    if (dashIndex > 0 && dashIndex < nameWithoutExt.length - 3) {
      artist = nameWithoutExt.substring(0, dashIndex).trim();
      title = nameWithoutExt.substring(dashIndex + 3).trim();
    }

    // Get format from extension
    const ext = path.extname(filePath).replace(".", "").toUpperCase();
    let fileSize = 0;
    try {
      fileSize = fs.statSync(filePath).size;
    } catch {}

    return {
      title,
      artist,
      album: "Unknown Album",
      albumArtist: "",
      genre: "",
      year: 0,
      trackNumber: 0,
      discNumber: 0,
      duration: 0,
      bitrate: 0,
      sampleRate: 0,
      channels: 0,
      format: ext,
      coverArt: this._findOfflineCover(filePath),
      fileSize,
    };
  }

  _getFirst(value) {
    if (Array.isArray(value)) return value[0];
    return value || null;
  }

  _joinArtists(artists) {
    if (!artists || !Array.isArray(artists)) return "";
    return artists.join(", ");
  }

  _joinArray(arr) {
    if (!arr || !Array.isArray(arr)) return "";
    return arr.join(", ");
  }

  _getNumber(value) {
    if (typeof value === "number") return value;
    if (typeof value === "object" && value !== null) return value.no || 0;
    return parseInt(value, 10) || 0;
  }

  /**
   * Save a large embedded cover art image to userData/cached_covers to avoid DB/IPC bloat.
   * @private
   */
  _saveEmbeddedCover(filePath, picture) {
    if (!this._coverCacheDir) return null;
    try {
      const crypto = require("crypto");
      if (!fs.existsSync(this._coverCacheDir)) {
        fs.mkdirSync(this._coverCacheDir, { recursive: true });
      }

      const hash = crypto
        .createHash("sha256")
        .update(filePath)
        .digest("hex")
        .substring(0, 16);
      const ext = picture.format === "image/png" ? ".png" : ".jpg";
      const cachePath = path.join(this._coverCacheDir, `cover_${hash}${ext}`);

      if (!fs.existsSync(cachePath)) {
        fs.writeFileSync(cachePath, picture.data);
      }
      return cachePath;
    } catch (err) {
      console.warn(
        "[metadataReader] Failed to save embedded cover to cache:",
        err.message,
      );
      return null;
    }
  }

  /**
   * Save an in-memory buffer's large embedded cover art to cached_covers.
   * @private
   */
  _saveEmbeddedCoverFromBuffer(buffer, picture) {
    if (!this._coverCacheDir) return null;
    try {
      const crypto = require("crypto");
      if (!fs.existsSync(this._coverCacheDir)) {
        fs.mkdirSync(this._coverCacheDir, { recursive: true });
      }

      const hash = crypto
        .createHash("sha256")
        .update(buffer)
        .digest("hex")
        .substring(0, 16);
      const ext = picture.format === "image/png" ? ".png" : ".jpg";
      const cachePath = path.join(this._coverCacheDir, `cover_${hash}${ext}`);

      if (!fs.existsSync(cachePath)) {
        fs.writeFileSync(cachePath, picture.data);
      }
      return cachePath;
    } catch (err) {
      console.warn(
        "[metadataReader] Failed to save buffer cover to cache:",
        err.message,
      );
      return null;
    }
  }

  /**
   * Exhaustive search for offline/cover art near the music file.
   * Searches: same directory (all images), .novaart sidecars, parent directories,
   * subdirectories (1 level), and walks up 3 parent levels.
   * The goal: ALWAYS find cover art if any image file exists nearby.
   * @private
   */
  _findOfflineCover(filePath) {
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

      // 1. .novaart sidecar files (previously downloaded online art) — highest priority
      for (const file of files) {
        const lower = file.toLowerCase();
        if (
          lower.includes(".novaart") &&
          extList.includes(path.extname(lower))
        ) {
          return path.join(dir, file);
        }
      }

      // 2. Exact name match (e.g., Song.jpg for Song.mp3)
      for (const file of files) {
        const fileExt = path.extname(file).toLowerCase();
        if (extList.includes(fileExt)) {
          const nameNoExt = path
            .basename(file, path.extname(file))
            .toLowerCase();
          if (nameNoExt === audioName) {
            return path.join(dir, file);
          }
        }
      }

      // 3. Common image name match (e.g., cover.jpg, folder.jpg)
      for (const file of files) {
        const fileExt = path.extname(file).toLowerCase();
        if (extList.includes(fileExt)) {
          const nameNoExt = path
            .basename(file, path.extname(file))
            .toLowerCase();
          if (commonNames.has(nameNoExt)) {
            return path.join(dir, file);
          }
        }
      }

      // 4. WMP hidden cache image files (e.g., AlbumArt_{GUID}_Large.jpg, AlbumArtSmall.jpg)
      let fallbackArt = null;
      for (const file of files) {
        const fileExt = path.extname(file).toLowerCase();
        if (extList.includes(fileExt)) {
          const nameNoExt = path
            .basename(file, path.extname(file))
            .toLowerCase();
          if (nameNoExt.startsWith("albumart")) {
            const fullPath = path.join(dir, file);
            if (nameNoExt.includes("large")) {
              return fullPath;
            }
            fallbackArt = fallbackArt || fullPath;
          }
        }
      }
      if (fallbackArt) return fallbackArt;

      // 5. ANY image file in same directory (catches custom/unusual names)
      // Size-gated: skip files under 5KB (likely icons/thumbnails, not album art)
      for (const file of files) {
        const fileExt = path.extname(file).toLowerCase();
        if (extList.includes(fileExt)) {
          const fullPath = path.join(dir, file);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size >= 5000) {
              return fullPath;
            }
          } catch (_) {}
        }
      }

      // 6. Search 1 level of subdirectories for cover art
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
            extList.includes(path.extname(lower))
          ) {
            return path.join(subdir, sf);
          }
        }
        // Common names in subdirs
        for (const sf of subFiles) {
          const sfExt = path.extname(sf).toLowerCase();
          if (extList.includes(sfExt)) {
            const nameNoExt = path.basename(sf, path.extname(sf)).toLowerCase();
            if (commonNames.has(nameNoExt)) {
              return path.join(subdir, sf);
            }
          }
        }
        // Any large image in subdirs
        for (const sf of subFiles) {
          const sfExt = path.extname(sf).toLowerCase();
          if (extList.includes(sfExt)) {
            const fullPath = path.join(subdir, sf);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.size >= 5000) return fullPath;
            } catch (_) {}
          }
        }
      }

      // 7. Walk up parent directories (up to 3 levels) for common cover art names
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

        for (const file of parentFiles) {
          const fileExt = path.extname(file).toLowerCase();
          if (extList.includes(fileExt)) {
            const nameNoExt = path
              .basename(file, path.extname(file))
              .toLowerCase();
            if (commonNames.has(nameNoExt)) {
              return path.join(parent, file);
            }
          }
        }

        current = parent;
      }
    } catch (err) {
      console.warn(
        `[metadataReader] Offline cover search failed for ${filePath}:`,
        err.message,
      );
    }
    return null;
  }
}

module.exports = MetadataReader;
