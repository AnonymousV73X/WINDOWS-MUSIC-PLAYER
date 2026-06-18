/**
 * NovaTune — Playlist Manager Service
 * Manages playlist CRUD operations and multi-format import/export.
 * Formats: M3U, M3U8, PLS, XSPF, JSON
 * Communicates with the main process via IPC for persistence.
 */

const { ipcRenderer } = require('electron');

// ─── Format Definitions ──────────────────────────────────────────────
const EXPORT_FORMATS = [
  { name: 'M3U Playlist',   extensions: ['m3u']  },
  { name: 'M3U8 Playlist',  extensions: ['m3u8'] },
  { name: 'PLS Playlist',   extensions: ['pls']  },
  { name: 'XSPF Playlist',  extensions: ['xspf'] },
  { name: 'JSON Playlist',  extensions: ['json'] },
];

const IMPORT_FORMATS = [
  { name: 'All Playlists', extensions: ['m3u', 'm3u8', 'pls', 'xspf', 'json'] },
  { name: 'M3U / M3U8',    extensions: ['m3u', 'm3u8'] },
  { name: 'PLS',           extensions: ['pls'] },
  { name: 'XSPF',          extensions: ['xspf'] },
  { name: 'JSON',          extensions: ['json'] },
  { name: 'All Files',     extensions: ['*'] },
];

class PlaylistManager {
  constructor() {
    this._playlists = [];
    this._onUpdateCallbacks = [];
  }

  // ─── CRUD ────────────────────────────────────────────────────────────

  async loadAll() {
    try {
      const result = await ipcRenderer.invoke('playlist:get-all');
      if (result.success) {
        this._playlists = result.playlists || [];
        this._notifyUpdate();
        return this._playlists;
      }
      return [];
    } catch (err) {
      console.error('Failed to load playlists:', err);
      return [];
    }
  }

  async create(name) {
    try {
      const result = await ipcRenderer.invoke('playlist:create', name);
      if (result.success) {
        this._playlists.push(result.playlist);
        this._notifyUpdate();
        return result.playlist;
      }
      return null;
    } catch (err) {
      console.error('Failed to create playlist:', err);
      return null;
    }
  }

  async delete(playlistId) {
    try {
      const result = await ipcRenderer.invoke('playlist:delete', playlistId);
      if (result.success) {
        this._playlists = this._playlists.filter(p => p.id !== playlistId);
        this._notifyUpdate();
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to delete playlist:', err);
      return false;
    }
  }

  async rename(playlistId, newName) {
    try {
      const result = await ipcRenderer.invoke('playlist:rename', playlistId, newName);
      if (result.success) {
        const idx = this._playlists.findIndex(p => p.id === playlistId);
        if (idx >= 0) this._playlists[idx] = result.playlist;
        this._notifyUpdate();
        return result.playlist;
      }
      return null;
    } catch (err) {
      console.error('Failed to rename playlist:', err);
      return null;
    }
  }

  async addTrack(playlistId, trackId) {
    try {
      const result = await ipcRenderer.invoke('playlist:add-track', playlistId, trackId);
      if (result.success) {
        const idx = this._playlists.findIndex(p => p.id === playlistId);
        if (idx >= 0) this._playlists[idx] = result.playlist;
        this._notifyUpdate();
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to add track to playlist:', err);
      return false;
    }
  }

  async removeTrack(playlistId, trackId) {
    try {
      const result = await ipcRenderer.invoke('playlist:remove-track', playlistId, trackId);
      if (result.success) {
        const idx = this._playlists.findIndex(p => p.id === playlistId);
        if (idx >= 0) this._playlists[idx] = result.playlist;
        this._notifyUpdate();
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  getById(playlistId) {
    return this._playlists.find(p => p.id === playlistId) || null;
  }

  getAll() {
    return [...this._playlists];
  }

  getPlaylistTracks(playlistId, libraryIndex) {
    const playlist = this.getById(playlistId);
    if (!playlist || !libraryIndex) return [];
    return playlist.tracks.map(trackId => libraryIndex.getById(trackId)).filter(Boolean);
  }

  // ─── Export ──────────────────────────────────────────────────────────

  /**
   * Export a playlist. Opens a save dialog supporting all formats.
   * @param {string} playlistId
   * @returns {Promise<boolean>}
   */
  async exportPlaylist(playlistId) {
    try {
      const playlist = this.getById(playlistId);
      if (!playlist) return false;

      const saveResult = await ipcRenderer.invoke('playlist:show-save-dialog', {
        defaultName: playlist.name,
        formats: EXPORT_FORMATS,
      });

      if (!saveResult || saveResult.canceled) return false;

      const { filePath } = saveResult;
      const ext = filePath.split('.').pop().toLowerCase();

      const libraryResult = await ipcRenderer.invoke('library:get-all');
      if (!libraryResult.success) return false;

      const libraryMap = new Map(libraryResult.tracks.map(t => [t.id, t]));
      const tracks = playlist.tracks.map(id => libraryMap.get(id)).filter(Boolean);

      let content;
      switch (ext) {
        case 'm3u':
          content = this._encodeM3U(tracks, 'ascii');
          break;
        case 'm3u8':
          content = this._encodeM3U(tracks, 'utf8');
          break;
        case 'pls':
          content = this._encodePLS(tracks, playlist.name);
          break;
        case 'xspf':
          content = this._encodeXSPF(tracks, playlist.name);
          break;
        case 'json':
          content = this._encodeJSON(tracks, playlist);
          break;
        default:
          content = this._encodeM3U(tracks, 'utf8');
      }

      const writeResult = await ipcRenderer.invoke('playlist:write-file', { filePath, content });
      return writeResult && writeResult.success;
    } catch (err) {
      console.error('Export failed:', err);
      return false;
    }
  }

  /** @deprecated Use exportPlaylist() */
  async exportM3U(playlistId) {
    return this.exportPlaylist(playlistId);
  }

  // ─── Import ──────────────────────────────────────────────────────────

  /**
   * Import a playlist from any supported format.
   * @returns {Promise<Object|null>} The imported playlist or null
   */
  async importPlaylist() {
    try {
      const openResult = await ipcRenderer.invoke('playlist:show-open-dialog', {
        formats: IMPORT_FORMATS,
      });

      if (!openResult || openResult.canceled || !openResult.filePath) return null;

      const readResult = await ipcRenderer.invoke('playlist:read-file', { filePath: openResult.filePath });
      if (!readResult || !readResult.success) return null;

      const { filePath, content } = readResult;
      const ext = filePath.split('.').pop().toLowerCase();
      const baseName = String(filePath || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');

      let entries;
      switch (ext) {
        case 'm3u':
        case 'm3u8':
          entries = this._decodeM3U(content);
          break;
        case 'pls':
          entries = this._decodePLS(content);
          break;
        case 'xspf':
          entries = this._decodeXSPF(content);
          break;
        case 'json':
          entries = this._decodeJSON(content);
          break;
        default:
          entries = this._decodeM3U(content);
      }

      const playlistName = entries.playlistName || baseName || 'Imported Playlist';
      const playlist = await this.create(playlistName);
      if (!playlist) return null;

      // Resolve entries to track IDs via file paths
      let addedCount = 0;
      const libraryResult = await ipcRenderer.invoke('library:get-all');
      if (libraryResult.success) {
        const pathToId = new Map(
          libraryResult.tracks
            .filter(t => t?.filePath)
            .map(t => [t.filePath, t.id])
        );
        const crypto = require('crypto');

        for (const entry of entries.tracks) {
          if (!entry?.filePath) continue;
          let trackId = pathToId.get(entry.filePath);
          if (!trackId) {
            // Not in library yet — add by path hash; scanner will enrich it later
            trackId = crypto.createHash('sha256').update(entry.filePath).digest('hex').substring(0, 16);
          }
          const added = await this.addTrack(playlist.id, trackId);
          if (added) addedCount++;
        }
      }

      return { ...playlist, importedTracks: addedCount };
    } catch (err) {
      console.error('Import failed:', err);
      return null;
    }
  }

  /** @deprecated Use importPlaylist() */
  async importM3U() {
    return this.importPlaylist();
  }

  // ─── Encoders ────────────────────────────────────────────────────────

  _encodeM3U(tracks, encoding = 'utf8') {
    const lines = ['#EXTM3U'];
    for (const track of tracks) {
      if (!track?.filePath) continue;
      const duration = Math.round(track.duration || 0);
      const artist   = track.artist || 'Unknown Artist';
      const title    = track.title  || 'Unknown';
      lines.push(`#EXTINF:${duration},${artist} - ${title}`);
      lines.push(track.filePath);
    }
    return lines.join('\r\n');
  }

  _encodePLS(tracks, playlistName = 'Playlist') {
    const lines = ['[playlist]'];
    tracks.filter(track => track?.filePath).forEach((track, i) => {
      const n = i + 1;
      lines.push(`File${n}=${track.filePath}`);
      lines.push(`Title${n}=${track.artist || 'Unknown'} - ${track.title || 'Unknown'}`);
      lines.push(`Length${n}=${Math.round(track.duration || -1)}`);
    });
    lines.push('');
    lines.push(`NumberOfEntries=${tracks.length}`);
    lines.push('Version=2');
    return lines.join('\r\n');
  }

  _encodeXSPF(tracks, playlistName = 'Playlist') {
    const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const trackItems = tracks.map(track => {
      if (!track?.filePath) return '';
      const loc = track.filePath.replace(/\\/g, '/');
      const uri = loc.startsWith('/') ? `file://${loc}` : `file:///${loc}`;
      return [
        '    <track>',
        `      <location>${esc(uri)}</location>`,
        `      <title>${esc(track.title || 'Unknown')}</title>`,
        `      <creator>${esc(track.artist || 'Unknown Artist')}</creator>`,
        `      <album>${esc(track.album || '')}</album>`,
        track.duration ? `      <duration>${Math.round(track.duration * 1000)}</duration>` : '',
        '    </track>',
      ].filter(Boolean).join('\n');
    }).filter(Boolean).join('\n');

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<playlist version="1" xmlns="http://xspf.org/ns/0/">',
      `  <title>${esc(playlistName)}</title>`,
      '  <trackList>',
      trackItems,
      '  </trackList>',
      '</playlist>',
    ].join('\n');
  }

  _encodeJSON(tracks, playlist) {
    return JSON.stringify({
      name: playlist.name,
      createdAt: playlist.createdAt,
      updatedAt: Date.now(),
      tracks: tracks.map(t => ({
        filePath: t.filePath,
        title:    t.title    || null,
        artist:   t.artist   || null,
        album:    t.album    || null,
        duration: t.duration || 0,
      })),
    }, null, 2);
  }

  // ─── Decoders ────────────────────────────────────────────────────────

  _decodeM3U(content) {
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const tracks = [];
    let pendingMeta = null;

    for (const line of lines) {
      if (line.startsWith('#EXTM3U')) continue;
      if (line.startsWith('#EXTINF:')) {
        const comma = line.indexOf(',');
        const durationStr = line.substring(8, comma > 0 ? comma : undefined);
        const label = comma > 0 ? line.substring(comma + 1).trim() : '';
        pendingMeta = {
          duration: parseFloat(durationStr) || 0,
          label,
        };
      } else if (!line.startsWith('#')) {
        const filePath = line;
        const meta = pendingMeta || {};
        let title = meta.label || null;
        let artist = null;
        if (meta.label && meta.label.includes(' - ')) {
          const dash = meta.label.indexOf(' - ');
          artist = meta.label.substring(0, dash).trim();
          title  = meta.label.substring(dash + 3).trim();
        }
        tracks.push({ filePath, title, artist, duration: meta.duration || 0 });
        pendingMeta = null;
      }
    }

    return { tracks, playlistName: null };
  }

  _decodePLS(content) {
    const lines = content.split(/\r?\n/);
    const fileMap  = {};
    const titleMap = {};
    const lenMap   = {};
    let name = null;

    for (const line of lines) {
      const m = line.match(/^File(\d+)=(.+)$/i);
      if (m) { fileMap[m[1]] = m[2].trim(); continue; }
      const t = line.match(/^Title(\d+)=(.+)$/i);
      if (t) { titleMap[t[1]] = t[2].trim(); continue; }
      const l = line.match(/^Length(\d+)=(.+)$/i);
      if (l) { lenMap[l[1]] = parseFloat(l[2]) || 0; continue; }
    }

    const tracks = Object.keys(fileMap).sort((a,b) => +a - +b).map(n => {
      const label = titleMap[n] || '';
      let title = label, artist = null;
      if (label.includes(' - ')) {
        const dash = label.indexOf(' - ');
        artist = label.substring(0, dash).trim();
        title  = label.substring(dash + 3).trim();
      }
      return { filePath: fileMap[n], title, artist, duration: lenMap[n] || 0 };
    });

    return { tracks, playlistName: name };
  }

  _decodeXSPF(content) {
    // Minimal XML parse — no external deps
    const tracks = [];
    let playlistName = null;

    const titleMatch = content.match(/<playlist[^>]*>[\s\S]*?<title>([\s\S]*?)<\/title>/);
    if (titleMatch) playlistName = this._unescapeXml(titleMatch[1].trim());

    const trackRegex = /<track>([\s\S]*?)<\/track>/g;
    let m;
    while ((m = trackRegex.exec(content)) !== null) {
      const block = m[1];
      const loc      = block.match(/<location>([\s\S]*?)<\/location>/);
      const titleEl  = block.match(/<title>([\s\S]*?)<\/title>/);
      const creator  = block.match(/<creator>([\s\S]*?)<\/creator>/);
      const album    = block.match(/<album>([\s\S]*?)<\/album>/);
      const duration = block.match(/<duration>([\s\S]*?)<\/duration>/);

      if (!loc) continue;

      let filePath = this._unescapeXml(loc[1].trim());
      // Strip file:// or file:///
      filePath = filePath.replace(/^file:\/\/\/?/, '');
      // Restore Windows drive letter: /C:/... → C:/...
      if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.substring(1);

      tracks.push({
        filePath,
        title:    titleEl  ? this._unescapeXml(titleEl[1].trim())  : null,
        artist:   creator  ? this._unescapeXml(creator[1].trim())  : null,
        album:    album    ? this._unescapeXml(album[1].trim())    : null,
        duration: duration ? parseFloat(duration[1]) / 1000 : 0,
      });
    }

    return { tracks, playlistName };
  }

  _decodeJSON(content) {
    try {
      const data = JSON.parse(content);
      const rawTracks = Array.isArray(data) ? data : (Array.isArray(data.tracks) ? data.tracks : []);
      const tracks = rawTracks.map(t => ({
        filePath: t.filePath || t.path || t.file || '',
        title:    t.title    || null,
        artist:   t.artist   || null,
        album:    t.album    || null,
        duration: t.duration || 0,
      })).filter(t => t.filePath);
      return { tracks, playlistName: data.name || null };
    } catch (err) {
      console.error('JSON playlist parse error:', err);
      return { tracks: [], playlistName: null };
    }
  }

  // ─── XML helpers ─────────────────────────────────────────────────────

  _unescapeXml(str) {
    return String(str || '')
      .replace(/&amp;/g,  '&')
      .replace(/&lt;/g,   '<')
      .replace(/&gt;/g,   '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  // ─── Callbacks ───────────────────────────────────────────────────────

  onUpdate(callback) {
    this._onUpdateCallbacks.push(callback);
  }

  _notifyUpdate() {
    for (const cb of this._onUpdateCallbacks) {
      try { cb(this._playlists); } catch (e) { /* ignore */ }
    }
  }
}

module.exports = PlaylistManager;
