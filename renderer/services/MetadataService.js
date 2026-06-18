/**
 * NovaTune — Metadata Service
 * Provides renderer-side access to audio file metadata operations
 * via IPC communication with the main process.
 */

const { ipcRenderer } = require('electron');

class MetadataService {
  constructor() {
    this._cache = new Map();
  }

  /**
   * Read metadata from a file via the main process.
   * @param {string} filePath - Path to the audio file
   * @returns {Promise<Object|null>} Track metadata
   */
  async readMetadata(filePath) {
    if (!filePath) return null;

    if (this._cache.has(filePath)) {
      return this._cache.get(filePath);
    }

    try {
      // Use the library:get-by-id IPC to check if we already have this track
      const crypto = require('crypto');
      const trackId = crypto.createHash('sha256').update(filePath).digest('hex').substring(0, 16);
      const result = await ipcRenderer.invoke('library:get-by-id', trackId);

      if (result.success && result.track) {
        this._cache.set(filePath, result.track);
        return result.track;
      }

      return null;
    } catch (err) {
      console.error('Metadata read failed:', err);
      return null;
    }
  }

  /**
   * Get cover art for a file.
   * @param {string} filePath
   * @returns {Promise<string|null>} Base64 data URI or null
   */
  async getCoverArt(filePath) {
    const metadata = await this.readMetadata(filePath);
    if (metadata && metadata.coverArt) {
      return metadata.coverArt;
    }
    return null;
  }

  /**
   * Open a file picker to select custom cover art.
   * @returns {Promise<string|null>} Base64 data URI of the selected image or null
   */
  async selectCoverArt() {
    try {
      const result = await ipcRenderer.invoke('file:open-cover-art');
      if (result.success && result.data) {
        return result.data;
      }
      return null;
    } catch (err) {
      console.error('Cover art selection failed:', err);
      return null;
    }
  }

  /**
   * Open a file dialog to add music files.
   * @returns {Promise<Array>} Array of track objects
   */
  async openFiles() {
    try {
      const result = await ipcRenderer.invoke('file:open-dialog');
      if (result.success && result.tracks) {
        for (const track of result.tracks) {
          this._cache.set(track.filePath, track);
        }
        return result.tracks;
      }
      return [];
    } catch (err) {
      console.error('File open dialog failed:', err);
      return [];
    }
  }

  /**
   * Open a folder dialog to scan for music.
   * @returns {Promise<string|null>} Selected folder path or null
   */
  async openFolder() {
    try {
      const result = await ipcRenderer.invoke('file:open-folder-dialog');
      if (result.success && result.folderPath) {
        return result.folderPath;
      }
      return null;
    } catch (err) {
      console.error('Folder dialog failed:', err);
      return null;
    }
  }

  /**
   * Clear the metadata cache.
   */
  clearCache() {
    this._cache.clear();
  }
}

module.exports = MetadataService;
