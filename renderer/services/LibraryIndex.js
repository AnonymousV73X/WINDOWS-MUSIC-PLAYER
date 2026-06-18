/**
 * NovaTune — Library Index Service
 * In-memory index of all tracks providing fast search, filtering,
 * and statistics. Acts as the renderer-side data layer for the library.
 */

const { ipcRenderer } = require('electron');

class LibraryIndex {
  constructor() {
    /** @type {Array<Object>} All tracks in the library */
    this._tracks = [];
    /** @type {Map<string, Object>} ID-based lookup map */
    this._idMap = new Map();
    /** @type {Map<string, Array<Object>>} Album-based index */
    this._albumIndex = new Map();
    /** @type {Map<string, Array<Object>>} Artist-based index */
    this._artistIndex = new Map();
    this._isLoading = false;
    this._onUpdateCallbacks = [];
  }

  /**
   * Load all tracks from the main process cache.
   * @returns {Promise<Array>} Array of track objects
   */
  async loadAll() {
    this._isLoading = true;
    try {
      const result = await ipcRenderer.invoke('library:get-all');
      if (result.success) {
        this._tracks = result.tracks || [];
        this._rebuildIndex();
        this._notifyUpdate();
        return this._tracks;
      }
      return [];
    } catch (err) {
      console.error('Failed to load library:', err);
      return [];
    } finally {
      this._isLoading = false;
    }
  }

  /**
   * Search tracks by a query string.
   * @param {string} query - Search query
   * @returns {Array<Object>} Matched tracks, ranked by relevance
   */
  search(query) {
    if (!query || !query.trim()) return [...this._tracks];

    const terms = query.toLowerCase().trim().split(/\s+/);
    const scored = [];

    for (const track of this._tracks) {
      let score = 0;

      for (const term of terms) {
        const title = (track.title || '').toLowerCase();
        const artist = (track.artist || '').toLowerCase();
        const album = (track.album || '').toLowerCase();
        const genre = (track.genre || '').toLowerCase();

        // Exact title match is highest
        if (title === term) score += 100;
        // Title starts with term
        else if (title.startsWith(term)) score += 80;
        // Title contains term
        if (title.includes(term)) score += 50;

        // Exact artist match
        if (artist === term) score += 70;
        else if (artist.startsWith(term)) score += 55;
        if (artist.includes(term)) score += 40;

        // Album match
        if (album === term) score += 60;
        else if (album.startsWith(term)) score += 45;
        if (album.includes(term)) score += 30;

        // Genre match
        if (genre.includes(term)) score += 20;
      }

      if (score > 0) {
        scored.push({ track, score });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.track);
  }

  /**
   * Get a track by its ID.
   * @param {string} trackId
   * @returns {Object|null}
   */
  getById(trackId) {
    return this._idMap.get(trackId) || null;
  }

  /**
   * Get all tracks.
   * @returns {Array<Object>}
   */
  getAll() {
    return [...this._tracks];
  }

  /**
   * Get all tracks for a specific album.
   * @param {string} albumName
   * @returns {Array<Object>}
   */
  getByAlbum(albumName) {
    if (!albumName) return [];
    return this._albumIndex.get(albumName.toLowerCase()) || [];
  }

  /**
   * Get all tracks by a specific artist.
   * Matches individual artist names even within collaborations.
   * @param {string} artistName
   * @returns {Array<Object>}
   */
  getByArtist(artistName) {
    if (!artistName) return [];
    // First check the artist index for individual artist matches
    const key = artistName.toLowerCase().trim();
    const indexed = this._artistIndex.get(key);
    if (indexed && indexed.length > 0) {
      // Also add tracks where the artist name appears in the title
      const titleMatches = this._tracks.filter(track => {
        const titleLower = (track.title || '').toLowerCase();
        return titleLower.includes(key) && !indexed.some(t => t.id === track.id);
      });
      return [...indexed, ...titleMatches];
    }
    // Fallback: search through all tracks for a substring match in artist OR title
    return this._tracks.filter(track => {
      const artistText = (track.artist || '').toLowerCase();
      const titleText = (track.title || '').toLowerCase();
      const artistMatch = artistText.split(/,\s*|;\s*|feat\.\s*/).some(a => a.trim() === key);
      const titleMatch = titleText.includes(key);
      return artistMatch || titleMatch;
    });
  }

  /**
   * Get a list of unique albums.
   * @returns {Array<{ name: string, artist: string, coverArt: string|null, trackCount: number }>}
   */
  getAlbums() {
    const albumMap = new Map();

    for (const track of this._tracks) {
      const key = `${(track.album || 'Unknown Album').toLowerCase()}__${(track.albumArtist || track.artist || '').toLowerCase()}`;
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          name: track.album || 'Unknown Album',
          artist: track.albumArtist || track.artist || 'Unknown Artist',
          coverArt: track.coverArt || null,
          trackCount: 0,
          year: track.year || 0
        });
      }
      albumMap.get(key).trackCount++;
      // Use first available cover art
      if (!albumMap.get(key).coverArt && track.coverArt) {
        albumMap.get(key).coverArt = track.coverArt;
      }
    }

    return Array.from(albumMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get a list of unique artists.
   * @returns {Array<{ name: string, trackCount: number }>}
   */
  getArtists() {
    const artistMap = new Map();

    for (const track of this._tracks) {
      const artists = (track.artist || 'Unknown Artist').split(/,\s*|;\s*|feat\.\s*/);
      for (const artist of artists) {
        const clean = artist.trim().replace(/^\(|\)$/g, '');
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (!artistMap.has(key)) {
          artistMap.set(key, { name: clean, trackCount: 0 });
        }
        artistMap.get(key).trackCount++;
      }
    }

    return Array.from(artistMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
  /**
   * Get library statistics.
   * @returns {{ totalTracks: number, totalDuration: number, totalSize: number, artists: number, albums: number }}
   */
  getStats() {
    const totalDuration = this._tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    const totalSize = this._tracks.reduce((sum, t) => sum + (t.fileSize || 0), 0);
    const albums = this.getAlbums();
    const artists = this.getArtists();

    return {
      totalTracks: this._tracks.length,
      totalDuration: Math.round(totalDuration),
      totalSize: Math.round(totalSize),
      artists: artists.length,
      albums: albums.length
    };
  }

  /**
   * Scan a folder and refresh the library.
   * @param {string} folderPath - Path to scan
   * @returns {Promise<{ success: boolean, tracks: Array, newTracks: number }>}
   */
  async scanFolder(folderPath) {
    try {
      const result = await ipcRenderer.invoke('library:scan', folderPath);
      if (result.success) {
        await this.loadAll();
      }
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Clear the entire library.
   * @returns {Promise<boolean>}
   */
  async clear() {
    try {
      const result = await ipcRenderer.invoke('library:clear');
      if (result.success) {
        this._tracks = [];
        this._idMap.clear();
        this._albumIndex.clear();
        this._artistIndex.clear();
        this._notifyUpdate();
      }
      return result.success;
    } catch (err) {
      return false;
    }
  }

  /**
   * Rebuild internal indexes from the tracks array.
   * @private
   */
  _rebuildIndex() {
    this._idMap.clear();
    this._albumIndex.clear();
    this._artistIndex.clear();

    for (const track of this._tracks) {
      // ID map
      this._idMap.set(track.id, track);

      // Album index
      const albumKey = (track.album || 'Unknown Album').toLowerCase();
      if (!this._albumIndex.has(albumKey)) {
        this._albumIndex.set(albumKey, []);
      }
      this._albumIndex.get(albumKey).push(track);

      // Artist index — split collaborator strings into individual artists
      const artists = (track.artist || 'Unknown Artist').split(/,\s*|;\s*|feat\.\s*/);
      for (const artist of artists) {
        const clean = artist.trim().replace(/^\(|\)$/g, '');
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (!this._artistIndex.has(key)) {
          this._artistIndex.set(key, []);
        }
        // Avoid duplicate entries for the same track
        const existing = this._artistIndex.get(key);
        if (!existing.some(t => t.id === track.id)) {
          existing.push(track);
        }
      }
    }
  }

  /**
   * Notify registered callbacks that the library has been updated.
   * @private
   */
  _notifyUpdate() {
    for (const cb of this._onUpdateCallbacks) {
      try { cb(this._tracks); } catch (e) { /* ignore */ }
    }
  }

  /**
   * Register a callback for library updates.
   * @param {Function} callback
   */
  onUpdate(callback) {
    this._onUpdateCallbacks.push(callback);
  }

  /**
   * Get loading state.
   * @returns {boolean}
   */
  get isLoading() {
    return this._isLoading;
  }

  /**
   * Get track count.
   * @returns {number}
   */
  get count() {
    return this._tracks.length;
  }
}

module.exports = LibraryIndex;
