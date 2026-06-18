/**
 * NovaTune — Windows System Media Transport Controls Bridge
 */

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

class SMTCBridge {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.isInitialized = false;
    this.currentMetadata = null;
    this.currentPosition = 0;
    this.playbackStatus = 'stopped';
    this._thumbTempPath = null;
    this.nativeMediaControls = null;

    try {
      this.NativeMediaControls = require('windows-media-controls');
    } catch (e) {
      console.log('windows-media-controls not available — SMTC in simulation mode.');
      this.NativeMediaControls = null;
    }
  }

  initialize() {
    if (this.isInitialized) return;

    if (this.NativeMediaControls) {
      this._initializeNative();
    } else {
      this._initializeSimulation();
    }

    // NOTE: smtc:update-* IPC is handled by ipc.js via ipcMain.handle(), which
    // calls updateMetadata/updatePlaybackStatus/updatePosition directly on this
    // bridge instance. Do NOT register ipcMain.on() here — it would be shadowed
    // by the handle() and never fire.

    this.isInitialized = true;
    console.log('SMTC Bridge initialized');
  }

  _initializeNative() {
    try {
      this.nativeMediaControls = new this.NativeMediaControls();

      const controls = this.nativeMediaControls;

      const caps = ['play', 'pause', 'next', 'previous', 'stop'];
      if (typeof controls.setSupportedPlaybackCommands === 'function') {
        controls.setSupportedPlaybackCommands(caps);
      } else if (typeof controls.setControls === 'function') {
        controls.setControls(caps);
      } else if (typeof controls.setIsEnabled === 'function') {
        controls.setIsEnabled(true);
      }

      const fwd = (nativeEvent, ipcChannel) => {
        if (typeof controls.on === 'function') {
          controls.on(nativeEvent, (...args) =>
            this._forwardToRenderer(ipcChannel, args[0])
          );
        }
      };
      fwd('play',     'smtc:play');
      fwd('pause',    'smtc:pause');
      fwd('next',     'smtc:next');
      fwd('previous', 'smtc:previous');
      fwd('stop',     'smtc:stop');
      fwd('seek',     'smtc:seek');

      console.log('Native SMTC controls registered');
    } catch (err) {
      console.warn('Failed to init native SMTC, falling back to simulation:', err.message);
      this.nativeMediaControls = null;
      this._initializeSimulation();
    }
  }

  _initializeSimulation() {
    ipcMain.on('smtc:simulation-play',     () => this._forwardToRenderer('smtc:play'));
    ipcMain.on('smtc:simulation-pause',    () => this._forwardToRenderer('smtc:pause'));
    ipcMain.on('smtc:simulation-next',     () => this._forwardToRenderer('smtc:next'));
    ipcMain.on('smtc:simulation-previous', () => this._forwardToRenderer('smtc:previous'));
    ipcMain.on('smtc:simulation-seek', (_, position) =>
      this._forwardToRenderer('smtc:seek', position)
    );
    console.log('SMTC running in simulation mode');
  }

  _forwardToRenderer(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  updatePlaybackStatus(status) {
    this.playbackStatus = status;
    if (!this.nativeMediaControls) return;
    try {
      const map = { playing: 'Playing', paused: 'Paused', stopped: 'Stopped' };
      const native = map[status] || 'Stopped';
      if (typeof this.nativeMediaControls.setPlaybackStatus === 'function') {
        this.nativeMediaControls.setPlaybackStatus(native);
      } else if (typeof this.nativeMediaControls.playbackStatus !== 'undefined') {
        this.nativeMediaControls.playbackStatus = native;
      }
    } catch (err) {
      console.warn('SMTC setPlaybackStatus failed:', err.message);
    }
  }

  updateMetadata(metadata) {
    this.currentMetadata = metadata;
    if (!this.nativeMediaControls) return;
    try {
      let albumArt = '';
      if (metadata.coverArt) {
        try { albumArt = this._dataUriToTempFile(metadata.coverArt); } catch (_) {}
      }

      // windows-media-controls v2: update() with albumArt key
      if (typeof this.nativeMediaControls.update === 'function') {
        this.nativeMediaControls.update({
          title:    metadata.title  || 'NovaTune',
          artist:   metadata.artist || '',
          album:    metadata.album  || '',
          albumArt,
        });
      } else if (typeof this.nativeMediaControls.setMetadata === 'function') {
        this.nativeMediaControls.setMetadata({
          title:    metadata.title  || 'NovaTune',
          artist:   metadata.artist || '',
          album:    metadata.album  || '',
          albumArt,
        });
      } else if (typeof this.nativeMediaControls.updateMetadata === 'function') {
        this.nativeMediaControls.updateMetadata({
          Title:     metadata.title  || 'NovaTune',
          Artist:    metadata.artist || '',
          Album:     metadata.album  || '',
          Thumbnail: albumArt,
        });
      }
    } catch (err) {
      console.warn('SMTC updateMetadata failed:', err.message);
    }
  }

  _dataUriToTempFile(dataUri) {
    const match = dataUri.match(/^data:image\/(png|jpeg|webp|bmp);base64,(.+)$/);
    if (!match) return '';
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buf = Buffer.from(match[2], 'base64');
    if (!this._thumbTempPath) {
      this._thumbTempPath = path.join(os.tmpdir(), `novatune-smtc-thumb.${ext}`);
    }
    fs.writeFileSync(this._thumbTempPath, buf);
    return this._thumbTempPath;
  }

  updatePosition(positionMs) {
    this.currentPosition = positionMs;
    if (!this.nativeMediaControls) return;
    try {
      if (typeof this.nativeMediaControls.setPosition === 'function') {
        this.nativeMediaControls.setPosition(positionMs);
      }
    } catch (_) {}
  }

  destroy() {
    if (this.nativeMediaControls) {
      try { this.nativeMediaControls.destroy(); } catch (_) {}
      this.nativeMediaControls = null;
    }
    if (this._thumbTempPath) {
      try { fs.unlinkSync(this._thumbTempPath); } catch (_) {}
      this._thumbTempPath = null;
    }
    // Only remove simulation channels — ipc.js owns the smtc:update-* handles
    const simChannels = [
      'smtc:simulation-play', 'smtc:simulation-pause',
      'smtc:simulation-next', 'smtc:simulation-previous', 'smtc:simulation-seek',
    ];
    simChannels.forEach((ch) => ipcMain.removeAllListeners(ch));
    this.isInitialized = false;
    console.log('SMTC Bridge destroyed');
  }
}

module.exports = SMTCBridge;