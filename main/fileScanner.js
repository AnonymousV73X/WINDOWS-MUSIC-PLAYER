/**
 * NovaTune — File Scanner Module  [v2 — ASYNC I/O]
 * Recursively scans directories for audio files and provides
 * filesystem watching capabilities for automatic library updates.
 *
 * PERF FIX v2: All synchronous I/O replaced with async equivalents.
 * - fs.readdirSync → fs.promises.readdir
 * - fs.statSync → fs.promises.stat
 * - fs.existsSync → fs.promises.access (or fs.promises.stat)
 * This prevents the main process event loop from being blocked during
 * scans, which on HDD can freeze the entire app for 5-30 seconds.
 * Parallel directory traversal uses a concurrency limit to avoid
 * overwhelming the disk with too many simultaneous I/O requests.
 */

const fs = require("fs");
const path = require("path");

// Directories to always skip during recursive scanning
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "__pycache__",
  "System Volume Information",
  "$RECYCLE.BIN",
  "Windows",
  "Program Files",
  "Program Files (x86)",
  "ProgramData",
  "AppData",
]);

// Maximum concurrent directory reads (avoids HDD head thrashing)
const MAX_CONCURRENT_DIRS = 4;

class FileScanner {
  /**
   * @param {string[]} supportedExtensions - Array of extensions like ['.mp3', '.flac']
   */
  constructor(supportedExtensions) {
    this.supportedExtensions = new Set(
      supportedExtensions.map((ext) => ext.toLowerCase()),
    );
    this.watchers = new Map();
    this.debounceTimers = new Map();
    this.debounceDelay = 500; // ms
  }

  /**
   * Recursively scan a directory for supported audio files.
   * Uses ASYNC I/O to avoid blocking the main process event loop.
   * @param {string} dirPath - Absolute path to scan
   * @returns {Promise<Array<{filePath: string, fileName: string, fileSize: number, modifiedTime: number}>>}
   */
  async scanDirectory(dirPath) {
    const results = [];

    // Check directory exists asynchronously
    try {
      await fs.promises.access(dirPath);
    } catch (_) {
      throw new Error(`Directory does not exist: ${dirPath}`);
    }

    await this._scanRecursive(dirPath, results);
    return results;
  }

  /**
   * @private
   * Recursive scan helper — fully async with parallel directory traversal.
   * Uses a semaphore-like pattern to limit concurrent I/O on HDD.
   */
  async _scanRecursive(currentDir, results) {
    let entries;
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      console.warn(`Cannot read directory ${currentDir}:`, err.message);
      return;
    }

    // Separate directories and files for parallel processing
    const directories = [];
    const fileJobs = [];

    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.name.startsWith(".")) continue;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip known non-music directories
        if (!SKIP_DIRS.has(entry.name)) {
          directories.push(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (this.supportedExtensions.has(ext)) {
          fileJobs.push({ fullPath, fileName: entry.name });
        }
      }
    }

    // Stat all audio files in parallel (they're in the same directory = sequential on HDD anyway,
    // but async keeps the event loop responsive)
    const statResults = await Promise.allSettled(
      fileJobs.map(async ({ fullPath, fileName }) => {
        const stat = await fs.promises.stat(fullPath);
        return {
          filePath: fullPath,
          fileName,
          fileSize: stat.size,
          modifiedTime: stat.mtimeMs,
          birthTime: stat.birthtimeMs,
        };
      }),
    );
    for (const result of statResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      }
    }

    // Recursively scan subdirectories with limited concurrency
    // On HDD, too many parallel reads cause head thrashing. Limit to MAX_CONCURRENT_DIRS.
    if (directories.length > 0) {
      // Process directories in batches
      for (let i = 0; i < directories.length; i += MAX_CONCURRENT_DIRS) {
        const batch = directories.slice(i, i + MAX_CONCURRENT_DIRS);
        await Promise.all(
          batch.map((dir) => this._scanRecursive(dir, results)),
        );
      }
    }
  }

  /**
   * Watch a directory for file changes.
   * @param {string} dirPath - Directory to watch
   * @param {function} callback - Called with (eventType, filePath) on changes
   */
  watchDirectory(dirPath, callback) {
    // Use async check for directory existence
    fs.promises.access(dirPath).catch(() => {
      throw new Error(`Directory does not exist: ${dirPath}`);
    });

    // Clean up existing watcher for this directory
    this.unwatchDirectory(dirPath);

    const watcher = fs.watch(
      dirPath,
      { persistent: false, recursive: true },
      (eventType, filename) => {
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
      },
    );

    watcher.on("error", (err) => {
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
