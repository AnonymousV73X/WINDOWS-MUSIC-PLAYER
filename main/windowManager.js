/**
 * NovaTune — Window State Manager
 * Persists and restores window position, size, and maximized state
 * across application sessions using a JSON configuration file.
 */

const fs = require('fs');
const path = require('path');
const { screen, app } = require('electron');

const DATA_DIR = (process.defaultApp || process.env.NODE_ENV === 'development' || process.argv.includes('--dev'))
  ? path.join(__dirname, '..', 'data')
  : app.getPath('userData');
const STATE_FILE = path.join(DATA_DIR, 'window-state.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class WindowStateManager {
  /**
   * @param {string} windowName - Unique name for this window state
   * @param {{ defaultWidth: number, defaultHeight: number, minWidth: number, minHeight: number }} defaults
   */
  constructor(windowName, defaults = {}) {
    this.windowName = windowName;
    this.defaults = {
      defaultWidth: defaults.defaultWidth || 1280,
      defaultHeight: defaults.defaultHeight || 720,
      minWidth: defaults.minWidth || 360,
      minHeight: defaults.minHeight || 420
    };
    this.state = this._loadState();
  }

  /**
   * Load the saved window state from disk.
   * @private
   * @returns {Object}
   */
  _loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        const saved = raw[this.windowName];
        if (saved) {
          return {
            x: typeof saved.x === 'number' ? saved.x : undefined,
            y: typeof saved.y === 'number' ? saved.y : undefined,
            width: saved.width || this.defaults.defaultWidth,
            height: saved.height || this.defaults.defaultHeight,
            isMaximized: !!saved.isMaximized
          };
        }
      }
    } catch (err) {
      console.warn('Failed to load window state:', err.message);
    }
    return {
      x: undefined,
      y: undefined,
      width: this.defaults.defaultWidth,
      height: this.defaults.defaultHeight,
      isMaximized: false
    };
  }

  /**
   * Get the current window state for creating a BrowserWindow.
   * Validates that the saved position is within screen bounds.
   * @returns {{ x: number|undefined, y: number|undefined, width: number, height: number, isMaximized: boolean }}
   */
  getState() {
    let state = { ...this.state };

    // Validate position is within screen bounds
    if (state.x !== undefined && state.y !== undefined) {
      const displays = screen.getAllDisplays();
      const bounds = {
        x: Math.min(...displays.map(d => d.bounds.x)),
        y: Math.min(...displays.map(d => d.bounds.y)),
        width: Math.max(...displays.map(d => d.bounds.x + d.bounds.width)),
        height: Math.max(...displays.map(d => d.bounds.y + d.bounds.height))
      };

      // If window is outside all display bounds, reset position
      if (state.x < bounds.x || state.y < bounds.y ||
          state.x > bounds.x + bounds.width - 100 ||
          state.y > bounds.y + bounds.height - 100) {
        state.x = undefined;
        state.y = undefined;
      }
    }

    return state;
  }

  /**
   * Save the current window state to disk.
   * @param {import('electron').BrowserWindow} browserWindow
   */
  saveState(browserWindow) {
    if (!browserWindow || browserWindow.isDestroyed()) return;

    try {
      let allStates = {};
      try {
        if (fs.existsSync(STATE_FILE)) {
          allStates = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        }
      } catch (readErr) {
        allStates = {};
      }

      const isMaximized = browserWindow.isMaximized();
      const bounds = isMaximized ? this.state : browserWindow.getBounds();

      allStates[this.windowName] = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized
      };

      fs.writeFileSync(STATE_FILE, JSON.stringify(allStates, null, 2), 'utf-8');
      this.state = { ...allStates[this.windowName] };
    } catch (err) {
      console.warn('Failed to save window state:', err.message);
    }
  }
}

module.exports = WindowStateManager;