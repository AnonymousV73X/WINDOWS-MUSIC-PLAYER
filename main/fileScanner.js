/**
 * NovaTune — File Scanner Module
 * Recursively scans directories for audio files and provides
 * filesystem watching capabilities for automatic library updates.
 */

const fs = require('fs');
const path = require('path');

// Directories to always skip during recursive scanning
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '__pycache__',
  'System Volume Information', '$RECYCLE.BIN',
  'Windows', 'Program Files', 'Program Files (x86)',
  'ProgramData', 'AppData'
]);

class FileScanner {
  /**
   * @param {string[]} supportedExtensions - Array of extensions like ['.mp3', '.flac']
   */
  constructor(supportedExtensions) {
    this.supportedExtensions = new Set(
      supportedExtensions.map(ext => ext.toLowerCase())
    );
    this.watchers = new Map();
    this.debounceTimers = new Map();
    this.debounceDelay = 500; // ms
  }

  /**
   * Recursively scan a directory for supported audio files.
   * @param {string} dirPath - Absolute path to scan
   * @returns {Promise<Array<{filePath: string, fileName: string, fileSize: number, modifiedTime: number}>>}
   */
  async scanDirectory(dirPath) {
    const results = [];

    if (!fs.existsSync(dirPath)) {
      throw new Error(`Directory does not exist: ${dirPath}`);
    }

    await this._scanRecursive(dirPath, results);
    return results;
  }

  /**
   * @private
   * Recursive scan helper
   */
  async _scanRecursive(currentDir, results) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err) {
      console.warn(`Cannot read directory ${currentDir}:`, err.message);
      return;
    }

    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip known non-music directories
        if (SKIP_DIRS.has(entry.name)) continue;
        await this._scanRecursive(fullPath, results);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (this.supportedExtensions.has(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            results.push({
              filePath: fullPath,
              fileName: entry.name,
              fileSize: stat.size,
              modifiedTime: stat.mtimeMs,
              birthTime: stat.birthtimeMs
            });
          } catch (statErr) {
            console.warn(`Cannot stat file ${fullPath}:`, statErr.message);
          }
        }
      }
    }
  }

  /**
   * Watch a directory for file changes.
   * @param {string} dirPath - Directory to watch
   * @param {function} callback - Called with (eventType, filePath) on changes
   */
  watchDirectory(dirPath, callback) {
    if (!fs.existsSync(dirPath)) {
      throw new Error(`Directory does not exist: ${dirPath}`);
    }

    // Clean up existing watcher for this directory
    this.unwatchDirectory(dirPath);

    const watcher = fs.watch(dirPath, { persistent: false, recursive: true }, (eventType, filename) => {
      if (!filename) return;
      
      const ext = path.extname(filename).toLowerCase();
      if (!this.supportedExtensions.has(ext)) return;
      
      const fullPath = path.join(dirPath, filename);
      
      // Debounce rapid events
      const key = fullPath;
      if (this.debounceTimers.has(key)) {
        clearTimeout(this.debounceTimers.get(key));
      }
      
      const timer = setTimeout(() => {
        this.debounceTimers.delete(key);
        callback(eventType, fullPath);
      }, this.debounceDelay);
      
      this.debounceTimers.set(key, timer);
    });

    watcher.on('error', (err) => {
      console.warn(`Watcher error for ${dirPath}:`, err.message);
    });

    this.watchers.set(dirPath, watcher);
  }

  /**
   * Stop watching a specific directory.
   * @param {string} dirPath
   */
  unwatchDirectory(dirPath) {
    const watcher = this.watchers.get(dirPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(dirPath);
    }
  }

  /**
   * Stop all active watchers.
   */
  unwatchAll() {
    for (const [dirPath, watcher] of this.watchers) {
      try {
        watcher.close();
      } catch (err) {
        // Silently close
      }
    }
    this.watchers.clear();
    
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Get count of currently watched directories.
   * @returns {number}
   */
  get watchedCount() {
    return this.watchers.size;
  }
}

module.exports = FileScanner;
