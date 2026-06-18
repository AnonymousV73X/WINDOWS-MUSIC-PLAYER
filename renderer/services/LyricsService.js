/**
 * NovaTune — Lyrics Service
 * Handles fetching lyrics from online sources (LRCLIB) and reading
 * local .lrc files. Provides in-memory caching for performance.
 *
 * Priority order (fastest to slowest):
 *   1. In-memory cache (instant)
 *   2. DB-stored lyrics / lyricsPath on disk (lyrics:get-from-db, ~1ms)
 *   3. Local .lrc sidecar file (lyrics:read-local, ~2ms)
 *   4. Embedded tags USLT/SYLT (lyrics:read-embedded, ~10-50ms)
 *   5. Online LRCLIB (lyrics:fetch-online, ~200-2000ms)
 */

const { ipcRenderer } = require("electron");

class LyricsService {
  constructor() {
    /** @type {Map<string, Object>} In-memory lyrics cache */
    this._cache = new Map();
    this._onLyricSeek = null;
  }

  /**
   * Get lyrics for a track using the fastest available source.
   * Always checks DB/local/embedded before going online.
   * @param {{ id?: string, artist: string, title: string, filePath?: string, album?: string, duration?: number }} track
   * @returns {Promise<{ synced: Array|null, plain: string, source: string }|null>}
   */
  async getLyrics(track) {
    if (!track) return null;

    const trackCacheKey = track.id ? `track:${track.id}` : null;
    if (trackCacheKey && this._cache.has(trackCacheKey)) {
      return this._cache.get(trackCacheKey);
    }

    // 1. DB-stored lyrics (instant — already scanned or previously saved)
    if (track.id) {
      const dbResult = await this.getFromDb(track.id);
      if (dbResult && (dbResult.synced || dbResult.plain)) {
        if (trackCacheKey) this._cache.set(trackCacheKey, dbResult);
        return dbResult;
      }
    }

    // 2. Local .lrc sidecar
    if (track.filePath) {
      const localResult = await this.readLocal(track.filePath);
      if (localResult && (localResult.synced || localResult.plain)) {
        if (trackCacheKey) this._cache.set(trackCacheKey, localResult);
        return localResult;
      }
    }

    // 3. Embedded tags (USLT/SYLT)
    if (track.filePath) {
      const embResult = await this.readEmbedded(track.filePath);
      if (embResult && (embResult.synced || embResult.plain)) {
        if (trackCacheKey) this._cache.set(trackCacheKey, embResult);
        return embResult;
      }
    }

    // 4. Online LRCLIB
    const onlineResult = await this.fetchOnline(
      track.artist,
      track.title,
      track.album,
      track.duration,
    );
    if (onlineResult && (onlineResult.synced || onlineResult.plain)) {
      if (trackCacheKey) this._cache.set(trackCacheKey, onlineResult);
      return onlineResult;
    }

    return null;
  }

  /**
   * Check DB-stored lyrics for a track (fastest — no I/O if already scanned).
   * @param {string} trackId
   * @returns {Promise<{ synced: Array|null, plain: string, source: string }|null>}
   */
  async getFromDb(trackId) {
    if (!trackId) return null;
    try {
      const result = await ipcRenderer.invoke("lyrics:get-from-db", trackId);
      if (result.success && result.lyrics) {
        return result.lyrics;
      }
      return null;
    } catch (err) {
      console.warn("[LyricsService] getFromDb failed:", err);
      return null;
    }
  }

  /**
   * Fetch lyrics from the online LRCLIB service.
   * @param {string} artist
   * @param {string} title
   * @param {string} [album]
   * @param {number} [duration]
   * @returns {Promise<{ synced: Array|null, plain: string, source: string }|null>}
   */
  async fetchOnline(artist, title, album, duration) {
    if (!artist || !title) return null;

    const cacheKey = this._cacheKey(artist, title, "online");
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);

    try {
      const result = await ipcRenderer.invoke("lyrics:fetch-online", {
        artist,
        title,
        album,
        duration,
      });
      if (result.success && result.lyrics) {
        const lyrics = {
          synced: Array.isArray(result.lyrics.synced)
            ? result.lyrics.synced
            : null,
          plain: result.lyrics.plain || "",
          source: result.lyrics.source || "LRCLIB",
        };
        this._cache.set(cacheKey, lyrics);
        return lyrics;
      }
      return null;
    } catch (err) {
      console.error("[LyricsService] fetchOnline failed:", err);
      return null;
    }
  }

  /**
   * Read local .lrc sidecar file.
   * @param {string} audioFilePath
   * @returns {Promise<{ synced: Array|null, plain: string, source: string }|null>}
   */
  async readLocal(audioFilePath) {
    if (!audioFilePath) return null;

    const cacheKey = this._cacheKey("", "", "local:" + audioFilePath);
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);

    try {
      const result = await ipcRenderer.invoke(
        "lyrics:read-local",
        audioFilePath,
      );
      if (result.success && result.lyrics) {
        const lyrics = {
          synced: Array.isArray(result.lyrics.synced)
            ? result.lyrics.synced
            : null,
          plain: result.lyrics.plain || "",
          source: "local",
        };
        this._cache.set(cacheKey, lyrics);
        return lyrics;
      }
      return null;
    } catch (err) {
      console.error("[LyricsService] readLocal failed:", err);
      return null;
    }
  }

  /**
   * Read embedded lyrics (USLT/SYLT) from the audio file tags.
   * @param {string} audioFilePath
   * @returns {Promise<{ synced: Array|null, plain: string, source: string }|null>}
   */
  async readEmbedded(audioFilePath) {
    if (!audioFilePath) return null;

    const cacheKey = this._cacheKey("", "", "embedded:" + audioFilePath);
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);

    try {
      const result = await ipcRenderer.invoke(
        "lyrics:read-embedded",
        audioFilePath,
      );
      if (result.success && result.lyrics) {
        const lyrics = {
          synced: Array.isArray(result.lyrics.synced)
            ? result.lyrics.synced
            : null,
          plain: result.lyrics.plain || "",
          source: "embedded",
        };
        this._cache.set(cacheKey, lyrics);
        return lyrics;
      }
      return null;
    } catch (err) {
      console.error("[LyricsService] readEmbedded failed:", err);
      return null;
    }
  }

  /**
   * Invalidate all cache entries for a track after a save.
   */
  invalidate(trackId, { filePath, artist, title } = {}) {
    if (trackId) this._cache.delete(`track:${trackId}`);
    if (filePath) {
      this._cache.delete(this._cacheKey("", "", "local:" + filePath));
      this._cache.delete(this._cacheKey("", "", "embedded:" + filePath));
    }
    if (artist && title)
      this._cache.delete(this._cacheKey(artist, title, "online"));
  }

  cacheLyrics(trackId, lyrics) {
    if (trackId && lyrics) this._cache.set(`track:${trackId}`, lyrics);
  }

  getCached(trackId) {
    return this._cache.get(`track:${trackId}`) || null;
  }

  clearCache() {
    this._cache.clear();
  }

  set onLyricSeek(callback) {
    this._onLyricSeek = callback;
  }

  _cacheKey(artist, title, source) {
    return `${source}:${(artist || "").toLowerCase()}:${(title || "").toLowerCase()}`;
  }
}

module.exports = LyricsService;
