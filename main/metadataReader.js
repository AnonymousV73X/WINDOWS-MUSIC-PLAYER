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

/**
 * Read duration directly from FLAC STREAMINFO binary block.
 * Works even when music-metadata fails (ID3-prefixed FLAC, etc.)
 * @param {string} filePath
 * @returns {number} Duration in seconds, or 0 on failure
 */
function _readFlacDurationBinary(filePath) {
  try {
    // FLAC format: 4-byte marker "fLaC", then metadata blocks.
    // Some FLAC files have an ID3v2 tag prepended — scan for "fLaC" marker.
    const fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, header, 0, 4096, 0);
    fs.closeSync(fd);

    // Find "fLaC" magic bytes (may be after ID3 tag)
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

    // After "fLaC", the first metadata block is always STREAMINFO (type 0).
    // Block header: 1 byte (type+last-flag), 3 bytes length.
    // STREAMINFO layout (34 bytes):
    //   [0-1]  min block size (16 bits)
    //   [2-3]  max block size (16 bits)
    //   [4-6]  min frame size (24 bits)
    //   [7-9]  max frame size (24 bits)
    //   [10-12.4] sample rate (20 bits), channels (3 bits), bits/sample (5 bits)
    //   [12.7-16]  total samples (36 bits)
    //   [17-33] MD5 signature

    const blockHeaderOffset = flacOffset + 4;
    if (blockHeaderOffset + 4 + 34 > bytesRead) return 0;

    const blockType = header[blockHeaderOffset] & 0x7f;
    if (blockType !== 0) return 0; // Not STREAMINFO

    const siOffset = blockHeaderOffset + 4; // skip 4-byte block header

    // Read 20-bit sample rate: bytes 10-12 of STREAMINFO, first 20 bits
    // Byte 10: 8 bits, byte 11: 8 bits, byte 12: top 4 bits
    const byte10 = header[siOffset + 10];
    const byte11 = header[siOffset + 11];
    const byte12 = header[siOffset + 12];
    const sampleRate = (byte10 << 12) | (byte11 << 4) | (byte12 >> 4);
    if (!sampleRate) return 0;

    // STREAMINFO bit layout:
    //   bits 80-99:   samplerate (20 bits)
    //   bits 100-102: channels-1 (3 bits)
    //   bits 103-107: bits-per-sample-1 (5 bits)
    //   bits 108-143: total samples (36 bits)
    // byte 13 = bits 104-111 → total samples lower 4 bits of byte13
    // byte 14-17 = next 32 bits
    const byte13 = header[siOffset + 13];
    const byte14 = header[siOffset + 14];
    const byte15 = header[siOffset + 15];
    const byte16 = header[siOffset + 16];
    const byte17 = header[siOffset + 17];
    const totalSamples =
      (BigInt(byte13 & 0x0f) << 32n) |
      (BigInt(byte14) << 24n) |
      (BigInt(byte15) << 16n) |
      (BigInt(byte16) << 8n) |
      BigInt(byte17);

    const duration = Math.round(Number(totalSamples) / sampleRate);
    return duration > 0 ? duration : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Read Vorbis comment tags directly from a FLAC file's binary blocks.
 * Works for ID3-prefixed FLACs that break music-metadata.
 * @param {string} filePath
 * @returns {{title:string,artist:string,album:string,albumArtist:string,genre:string,year:number,trackNumber:number,discNumber:number}}
 */
function _readFlacVorbisCommentsBinary(filePath) {
  const result = {
    title: "",
    artist: "",
    album: "",
    albumArtist: "",
    genre: "",
    year: 0,
    trackNumber: 0,
    discNumber: 0,
  };
  try {
    // Read enough to cover all metadata blocks (they come before audio frames)
    // Use a large buffer — FLAC metadata blocks can be up to ~16MB if cover art is embedded
    // We read 256KB which is enough for tags; cover art blocks we skip
    const CHUNK = 256 * 1024;
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(CHUNK);
    const bytesRead = fs.readSync(fd, buf, 0, CHUNK, 0);
    fs.closeSync(fd);

    // Find "fLaC" marker
    let offset = -1;
    for (let i = 0; i <= bytesRead - 4; i++) {
      if (
        buf[i] === 0x66 &&
        buf[i + 1] === 0x4c &&
        buf[i + 2] === 0x61 &&
        buf[i + 3] === 0x43
      ) {
        offset = i + 4; // point past "fLaC"
        break;
      }
    }
    if (offset < 0) return result;

    // Walk metadata blocks
    while (offset + 4 <= bytesRead) {
      const blockHeaderByte = buf[offset];
      const isLast = (blockHeaderByte & 0x80) !== 0;
      const blockType = blockHeaderByte & 0x7f;
      const blockLen =
        (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
      offset += 4;

      if (blockType === 4) {
        // VORBIS_COMMENT block
        // Format: [4 LE] vendor_length, [vendor_length bytes] vendor,
        //         [4 LE] comment_count, then comment_count × ([4 LE] len, [len bytes] "KEY=VALUE")
        let p = offset;
        const vendorLen = buf.readUInt32LE(p);
        p += 4 + vendorLen;
        if (p + 4 > bytesRead) break;
        const commentCount = buf.readUInt32LE(p);
        p += 4;
        for (let c = 0; c < commentCount; c++) {
          if (p + 4 > bytesRead) break;
          const cLen = buf.readUInt32LE(p);
          p += 4;
          if (p + cLen > bytesRead) break;
          const comment = buf.slice(p, p + cLen).toString("utf8");
          p += cLen;
          const eqIdx = comment.indexOf("=");
          if (eqIdx < 0) continue;
          const key = comment.substring(0, eqIdx).toUpperCase().trim();
          const val = comment.substring(eqIdx + 1).trim();
          if (key === "TITLE" && !result.title) result.title = val;
          else if (key === "ARTIST" && !result.artist) result.artist = val;
          else if (key === "ALBUM" && !result.album) result.album = val;
          else if (
            (key === "ALBUMARTIST" || key === "ALBUM ARTIST") &&
            !result.albumArtist
          )
            result.albumArtist = val;
          else if (key === "GENRE" && !result.genre) result.genre = val;
          else if (key === "DATE" || key === "YEAR")
            result.year = parseInt(val) || result.year;
          else if (key === "TRACKNUMBER")
            result.trackNumber = parseInt(val) || result.trackNumber;
          else if (key === "DISCNUMBER")
            result.discNumber = parseInt(val) || result.discNumber;
        }
        break; // Found the comment block, done
      }

      offset += blockLen;
      if (isLast) break;
    }
  } catch (_) {}
  return result;
}

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

        // If duration is 0 but file has content, retry
        if (duration === 0 && attempt < attempts) {
          let fileSize = 0;
          try {
            fileSize = (await fs.promises.stat(filePath)).size;
          } catch (_) {}
          if (fileSize > 0) {
            lastError = new Error("Duration parsed as 0 for non-empty file");
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        }

        const metadata = {
          title: this._getFirst(result.common.title) || "",
          artist: this._joinArtists(result.common.artists) || "",
          album: this._getFirst(result.common.album) || "",
          albumArtist: this._getFirst(result.common.albumartist) || "",
          genre: this._joinArray(result.common.genre) || "",
          year: result.common.year || 0,
          trackNumber: this._getNumber(result.common.track) || 0,
          discNumber: this._getNumber(result.common.disc) || 0,
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

        // FLAC binary fallback: if music-metadata returned 0:00, read STREAMINFO directly
        if (
          metadata.duration === 0 &&
          path.extname(filePath).toLowerCase() === ".flac"
        ) {
          const binaryDur = _readFlacDurationBinary(filePath);
          if (binaryDur > 0) {
            metadata.duration = binaryDur;
          }
        }

        // Extract cover art (limit to 200KB base64 to avoid IPC bloat, cache files larger than that)
        if (result.common.picture && result.common.picture.length > 0) {
          const picture = result.common.picture[0];
          const buf = picture.data;
          if (buf.length < 200 * 1024) {
            metadata.coverArt = `data:${picture.format || "image/jpeg"};base64,${Buffer.from(buf).toString("base64")}`;
          } else {
            metadata.coverArt = this._saveEmbeddedCover(filePath, picture);
          }
        }

        if (!metadata.coverArt) {
          metadata.coverArt = await this._findOfflineCover(filePath);
        }

        return metadata;
      } catch (err) {
        lastError = err;
        console.warn(
          `[metadataReader] Attempt ${attempt} failed for ${path.basename(filePath)}: ${err.message}`,
        );
        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // Last resort: try parseBuffer with explicit MIME type (fixes FLAC with unusual headers/preamble)
    try {
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap = {
        ".flac": "audio/flac",
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
        ".opus": "audio/ogg; codecs=opus",
        ".m4a": "audio/mp4",
        ".wav": "audio/wav",
        ".aac": "audio/aac",
      };
      const mimeType = mimeMap[ext];
      if (mimeType) {
        const lib = await ensureMM();
        const buf = fs.readFileSync(filePath);
        const result = await lib.parseBuffer(buf, { mimeType, duration: true });
        const duration = result.format.duration
          ? Math.round(result.format.duration)
          : 0;
        const metadata = {
          title: this._getFirst(result.common.title) || "",
          artist: this._joinArtists(result.common.artists) || "",
          album: this._getFirst(result.common.album) || "",
          albumArtist: this._getFirst(result.common.albumartist) || "",
          genre: this._joinArray(result.common.genre) || "",
          year: result.common.year || 0,
          trackNumber: this._getNumber(result.common.track) || 0,
          discNumber: this._getNumber(result.common.disc) || 0,
          duration:
            duration ||
            (ext === ".flac" ? _readFlacDurationBinary(filePath) : 0),
          bitrate: result.format.bitrate
            ? Math.round(result.format.bitrate / 1000)
            : 0,
          sampleRate: result.format.sampleRate || 0,
          channels: result.format.numberOfChannels || 0,
          format:
            (result.format.container || "").toUpperCase() ||
            ext.replace(".", "").toUpperCase(),
          coverArt: null,
        };
        if (result.common.picture && result.common.picture.length > 0) {
          const picture = result.common.picture[0];
          const picBuf = picture.data;
          if (picBuf.length < 200 * 1024) {
            metadata.coverArt = `data:${picture.format || "image/jpeg"};base64,${Buffer.from(picBuf).toString("base64")}`;
          } else {
            metadata.coverArt = this._saveEmbeddedCover(filePath, picture);
          }
        }
        if (!metadata.coverArt)
          metadata.coverArt = await this._findOfflineCover(filePath);
        if (metadata.duration > 0 || metadata.title) {
          console.log(
            `[metadataReader] parseBuffer succeeded for ${path.basename(filePath)}`,
          );
          return metadata;
        }
      }
    } catch (bufErr) {
      console.warn(
        `[metadataReader] parseBuffer also failed for ${path.basename(filePath)}: ${bufErr.message}`,
      );
    }

    // Binary FLAC fallback: read Vorbis comment tags and STREAMINFO directly from bytes
    // This works for ID3-prefixed FLACs that music-metadata rejects as "Invalid FLAC preamble"
    if (path.extname(filePath).toLowerCase() === ".flac") {
      const tags = _readFlacVorbisCommentsBinary(filePath);
      const duration = _readFlacDurationBinary(filePath);
      if (duration > 0 || tags.title) {
        console.log(
          `[metadataReader] Binary Vorbis read succeeded for ${path.basename(filePath)}: "${tags.title}" / "${tags.artist}" / "${tags.album}"`,
        );
        const nameNoExt = path.basename(filePath, ".flac");
        const fallbackTags = this._fallbackMetadata(filePath);
        return {
          title: tags.title || fallbackTags.title || nameNoExt,
          artist: tags.artist || fallbackTags.artist || "Unknown Artist",
          album: tags.album || "Unknown Album",
          albumArtist: tags.albumArtist || "",
          genre: tags.genre || "",
          year: tags.year || 0,
          trackNumber: tags.trackNumber || 0,
          discNumber: tags.discNumber || 0,
          duration,
          bitrate: 0,
          sampleRate: 0,
          channels: 0,
          format: "FLAC",
          coverArt: await this._findOfflineCover(filePath),
        };
      }
    }

    console.warn(
      `[metadataReader] All attempts failed for ${path.basename(filePath)}. Falling back to filename metadata.`,
    );
    // Return fallback metadata from filename
    return this._fallbackMetadata(filePath);
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
      const quickInfo = {
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
      // FLAC binary fallback if music-metadata returned 0 duration
      if (
        quickInfo.duration === 0 &&
        path.extname(filePath).toLowerCase() === ".flac"
      ) {
        const binaryDur = _readFlacDurationBinary(filePath);
        if (binaryDur > 0) quickInfo.duration = binaryDur;
      }
      return quickInfo;
    } catch {
      // Last resort: binary FLAC reader
      if (path.extname(filePath).toLowerCase() === ".flac") {
        const binaryDur = _readFlacDurationBinary(filePath);
        if (binaryDur > 0)
          return {
            duration: binaryDur,
            format: "FLAC",
            bitrate: 0,
            sampleRate: 0,
            channels: 0,
          };
      }
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
      return await this._findOfflineCover(filePath);
    } catch (err) {
      return await this._findOfflineCover(filePath);
    }
  }

  // ─── Utility Helpers ─────────────────────────────────────────────

  /**
   * Generate fallback metadata from the filename when music-metadata fails.
   * @private
   */
  async _fallbackMetadata(filePath) {
    const nameWithoutExt = path.basename(filePath, path.extname(filePath));

    // Try to parse "Artist - Title" pattern
    let title = nameWithoutExt;
    let artist = "Unknown Artist";

    const dashIndex = nameWithoutExt.indexOf(" - ");
    if (dashIndex > 0 && dashIndex < nameWithoutExt.length - 3) {
      artist = nameWithoutExt.substring(0, dashIndex).trim();
      title = nameWithoutExt.substring(dashIndex + 3).trim();
    }

    // Strip leading track number prefix from title (e.g. "14. Title" → "Title", "01_Title" → "Title")
    title = title.replace(/^\d+[._\s]+/, "").trim() || title;

    // Get format from extension
    const ext = path.extname(filePath).replace(".", "").toUpperCase();
    let fileSize = 0;
    try {
      fileSize = (await fs.promises.stat(filePath)).size;
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
      coverArt: await this._findOfflineCover(filePath),
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
  async _findOfflineCover(filePath) {
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

      try {
        await fs.promises.access(dir);
      } catch (_) {
        return null;
      }
      const files = await fs.promises.readdir(dir);

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

      // 6. Search 1 level of subdirectories for cover art
      for (const file of files) {
        const subdir = path.join(dir, file);
        let stat;
        try {
          stat = await fs.promises.stat(subdir);
          if (!stat.isDirectory()) continue;
        } catch (_) {
          continue;
        }

        let subFiles;
        try {
          subFiles = await fs.promises.readdir(subdir);
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
      }

      // 7. Walk up parent directories (up to 3 levels) for common cover art names
      let current = dir;
      for (let depth = 0; depth < 3; depth++) {
        const parent = path.dirname(current);
        if (!parent || parent === current) break; // reached root
        try {
          await fs.promises.access(parent);
        } catch (_) {
          break;
        }

        let parentFiles;
        try {
          parentFiles = await fs.promises.readdir(parent);
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
