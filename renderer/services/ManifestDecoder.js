/**
 * NovaTune — Renderer-side manifest decoder
 * ─────────────────────────────────────────────────────────────────────────
 * Wraps an ArrayBuffer received from the main process via the
 * `library:get-manifest-buffer` IPC and exposes a surface that
 * the rest of the renderer can use as a drop-in replacement for
 * the old `state.tracks = result.tracks` pattern.
 *
 * KEY DIFFERENCE vs old flow
 *   Old:  N IPC round-trips (one per page of 500 tracks)
 *         + N×500 structured-clone deserializations on the renderer
 *         + N×500 JSON.parse calls on the main process
 *   New:  ONE IPC call returning a single ArrayBuffer (~1MB for 1000 tracks)
 *         + lazy per-track decode on demand (only the visible viewport)
 *         + sort orders pre-computed → no re-sort on startup
 *
 * The ArrayBuffer is held by this object for the lifetime of the session.
 * It is NOT transferred back to main — main keeps its own copy for
 * subsequent requests (e.g. hot reload after a background scan).
 */

"use strict";

const ManifestReader = require("../../main/manifestReader");

class ManifestDecoder {
  constructor() {
    /** @type {ManifestReader|null} */
    this._reader = null;
    /** @type {{ trackCount:number, createdAt:number, fpHash:number, version:number }|null} */
    this._info = null;
    /** @type {string|null} */
    this._sortOrder = "sortDateAddedDesc"; // matches the old ORDER BY dateAdded DESC
  }

  /**
   * Fetch the manifest ArrayBuffer from the main process and initialize
   * the reader. Returns false on any failure (caller should fall back
   * to the SQLite path).
   *
   * @returns {Promise<boolean>}
   */
  async load() {
    try {
      // Step 1: cheap probe — is the manifest available at all?
      const info = await window.novaAPI.invoke("library:get-manifest-info");
      if (!info || !info.available) {
        console.log("[manifest-decoder] not available:", info?.reason || "unknown");
        return false;
      }

      // Step 2: fetch the buffer.
      const result = await window.novaAPI.invoke("library:get-manifest-buffer", {
        transfer: true,
      });
      if (!result || !result.success || !result.buffer) {
        console.log("[manifest-decoder] buffer fetch failed:", result?.reason);
        return false;
      }

      // Step 3: wrap in ManifestReader.
      const reader = new ManifestReader(result.buffer);
      if (!reader.valid) {
        console.warn("[manifest-decoder] validation failed:", reader.error);
        return false;
      }

      this._reader = reader;
      this._info = info;
      console.log(
        `[manifest-decoder] loaded: ${reader.trackCount} tracks, ` +
        `v${reader.version}, flags=0x${reader.flags.toString(16)}, ` +
        `sortOrders=[${reader.getAvailableSortOrders().join(", ")}]`,
      );
      return true;
    } catch (err) {
      console.warn("[manifest-decoder] load error:", err.message);
      return false;
    }
  }

  /**
   * Whether the decoder has a valid manifest loaded.
   */
  get isReady() {
    return this._reader !== null && this._reader.valid;
  }

  get trackCount() {
    return this._reader ? this._reader.trackCount : 0;
  }

  get headerInfo() {
    return this._info;
  }

  /**
   * Set the active sort order for getTracksRange() calls.
   * @param {string} name  one of ManifestReader.SORT_ORDERS
   */
  setSortOrder(name) {
    if (ManifestReader.SORT_ORDERS.includes(name)) {
      this._sortOrder = name;
    } else {
      console.warn("[manifest-decoder] unknown sort order:", name);
    }
  }

  get sortOrder() {
    return this._sortOrder;
  }

  /**
   * Get a range of tracks in the active sort order.
   * Drop-in replacement for `library:get-page` results.
   *
   * @param {number} start
   * @param {number} count
   * @param {string} [sortOrder]  override the active sort order for this call
   * @returns {Object[]}
   */
  getTracksRange(start, count, sortOrder) {
    if (!this._reader) return [];
    const order = sortOrder || this._sortOrder;
    return this._reader.getTracksRange(start, count, order);
  }

  /**
   * Get all tracks in the active sort order. Use sparingly — defeats
   * the lazy-decode purpose. Provided for compatibility with code
   * paths that expect a flat array (e.g. LibraryIndex.getAll()).
   *
   * @param {string} [sortOrder]
   * @returns {Object[]}
   */
  getAllTracks(sortOrder) {
    if (!this._reader) return [];
    return this._reader.getAllTracks(sortOrder || this._sortOrder);
  }

  /**
   * Find a track by its ID (O(log n) binary search).
   * @param {string} id
   * @returns {Object|null}
   */
  getById(id) {
    if (!this._reader) return null;
    return this._reader.findById(id);
  }

  /**
   * Find a track by its file path (O(1) hash lookup).
   * @param {string} filePath
   * @returns {Object|null}
   */
  getByFilePath(filePath) {
    if (!this._reader) return null;
    return this._reader.findByFilePath(filePath);
  }

  /**
   * Returns the raw sort order array (zero-copy Uint32Array view).
   * Useful for virtualized scrollers that want to slice on their own.
   */
  getSortOrderArray(name) {
    if (!this._reader) return null;
    return this._reader.getSortOrder(name);
  }

  /**
   * Drop the decode cache. Call after the manifest is refreshed
   * (e.g. background scan completed).
   */
  invalidateCache() {
    if (this._reader) this._reader.invalidateCache();
  }

  /**
   * Reload the manifest from main. Used after a background scan
   * so the renderer sees the fresh track list without a full
   * renderer re-init.
   */
  async reload() {
    this._reader = null;
    this._info = null;
    return this.load();
  }
}

module.exports = ManifestDecoder;
