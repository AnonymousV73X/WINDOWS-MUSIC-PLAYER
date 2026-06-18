/**
 * NovaTune — Settings Service
 * Manages application settings with persistence via the main process.
 * Provides type-safe access to all configuration options with defaults.
 */

const { ipcRenderer } = require('electron');

class SettingsService {
  constructor() {
    /** @type {Object} Current settings */
    this._settings = {};
    /** @type {Object} Default values */
    this._defaults = {
      theme: 'dark',
      accentColor: '#1DB954',
      volume: 0.8,
      crossfadeDuration: 0,
      equalizer: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      repeatMode: 'off',
      shuffle: false,
      showLyrics: false,
      visualizerStyle: 'bars',
      scanFolders: [],
      sortOrder: 'title',
      sortDirection: 'asc',
      miniPlayer: false,
      alwaysOnTop: false,
      hardwareAcceleration: true,
      outputDevice: 'default',
      language: 'en'
    };
    this._onChangedCallbacks = [];
    this._loaded = false;
  }

  /**
   * Load settings from the main process.
   * @returns {Promise<Object>}
   */
  async load() {
    try {
      const result = await ipcRenderer.invoke('settings:get-all');
      if (result.success) {
        // Merge with defaults to fill any missing keys
        this._settings = { ...this._defaults, ...result.settings };
      } else {
        this._settings = { ...this._defaults };
      }
      this._loaded = true;
      this._applyTheme();
      return this._settings;
    } catch (err) {
      console.error('Failed to load settings:', err);
      this._settings = { ...this._defaults };
      return this._settings;
    }
  }

  /**
   * Get a setting value.
   * @param {string} key
   * @returns {Promise<*>}
   */
  async get(key) {
    if (!this._loaded) await this.load();
    return this._settings[key] !== undefined ? this._settings[key] : this._defaults[key];
  }

  /**
   * Set a setting value and persist it.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<boolean>}
   */
  async set(key, value) {
    try {
      const oldValue = this._settings[key];
      this._settings[key] = value;

      const result = await ipcRenderer.invoke('settings:set', key, value);
      if (result.success) {
        this._notifyChanged(key, value, oldValue);
        this._applyTheme();
        return true;
      }

      // Revert on failure
      this._settings[key] = oldValue;
      return false;
    } catch (err) {
      console.error(`Failed to set setting '${key}':`, err);
      return false;
    }
  }

  /**
   * Get all settings.
   * @returns {Object}
   */
  getAll() {
    return { ...this._settings };
  }

  /**
   * Reset all settings to defaults.
   * @returns {Promise<Object>}
   */
  async reset() {
    try {
      const result = await ipcRenderer.invoke('settings:reset');
      if (result.success) {
        this._settings = { ...this._defaults };
        this._notifyChanged('*', this._settings, null);
        this._applyTheme();
      }
      return this._settings;
    } catch (err) {
      return this._settings;
    }
  }

  /**
   * Apply theme settings to the DOM.
   * @private
   */
  _applyTheme() {
    const root = document.documentElement;
    if (!root) return;

    // Set CSS custom properties
    root.style.setProperty('--accent', this._settings.accentColor || '#1DB954');

    if (this._settings.theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
  }

  /**
   * Register a callback for settings changes.
   * @param {Function} callback - Called with (key, newValue, oldValue)
   */
  onSettingsChanged(callback) {
    this._onChangedCallbacks.push(callback);
  }

  /**
   * Notify all settings change callbacks.
   * @private
   */
  _notifyChanged(key, newValue, oldValue) {
    for (const cb of this._onChangedCallbacks) {
      try {
        cb(key, newValue, oldValue);
      } catch (e) {
        /* ignore handler errors */
      }
    }
  }

  /**
   * Get default value for a setting.
   * @param {string} key
   * @returns {*}
   */
  getDefault(key) {
    return this._defaults[key];
  }

  /**
   * Get all default settings.
   * @returns {Object}
   */
  get defaults() {
    return { ...this._defaults };
  }
}

module.exports = SettingsService;
