/**
 * NovaTune — File Logger
 * ─────────────────────────────────────────────────────────────────────────
 * Redirects console.log / console.warn / console.error to a rotating log
 * file at <userData>/novatune.log (max 5MB, keeps 1 backup).
 *
 * CRITICAL: This runs BEFORE any other module so we capture every log
 * line from the entire app lifecycle — including startup crashes that
 * would otherwise vanish in a packaged exe (no terminal to print to).
 *
 * The log file is at:
 *   Windows: %APPDATA%\NovaTune\novatune.log
 *   macOS:   ~/Library/Application Support/NovaTune/novatune.log
 *   Linux:   ~/.config/NovaTune/novatune.log
 *
 * If userData isn't available yet (app not ready), falls back to:
 *   <os.tmpdir()>/novatune.log
 *
 * Log rotation: when novatune.log exceeds 5MB, it's renamed to
 * novatune.log.1 (overwriting any previous backup) and a fresh
 * novatune.log is started. This keeps disk usage bounded.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LOG_LINES_IN_MEMORY = 0; // 0 = flush every line (safety > performance)

let _logPath = null;
let _writeStream = null;
let _originalConsole = null;
let _initialized = false;

/**
 * Resolve the log file path. Always uses app.getPath('userData') —
 * this API does NOT require app.isReady() (it just returns the path
 * string). Falls back to os.tmpdir() only if Electron isn't available
 * at all (e.g. running in plain Node without Electron).
 *
 * CHANGED v3.0.1: The old code checked app.isReady() before calling
 * getPath(), but the logger initializes BEFORE whenReady() fires —
 * so isReady() was always false and the log went to os.tmpdir()
 * (AppData\Local\Temp on Windows). Users couldn't find it there.
 * Now we always use userData, which is where users expect to find
 * app data: %APPDATA%\NovaTune\ on Windows.
 */
function _resolveLogPath() {
  try {
    const { app } = require("electron");
    if (app && typeof app.getPath === "function") {
      const userData = app.getPath("userData");
      // Ensure the directory exists
      try {
        fs.mkdirSync(userData, { recursive: true });
      } catch (_) {}
      return path.join(userData, "novatune.log");
    }
  } catch (_) {
    // Electron not available (plain Node) — fall through to tmpdir
  }
  return path.join(os.tmpdir(), "novatune.log");
}

/**
 * Rotate the log file if it exceeds MAX_LOG_SIZE.
 * Renames novatune.log → novatune.log.1 (overwriting previous backup).
 */
function _rotateIfNeeded() {
  try {
    if (!fs.existsSync(_logPath)) return;
    const stats = fs.statSync(_logPath);
    if (stats.size < MAX_LOG_SIZE) return;

    // Close current stream before rotating
    if (_writeStream) {
      try {
        _writeStream.end();
      } catch (_) {}
      _writeStream = null;
    }

    // Rotate: novatune.log → novatune.log.1 (overwrite)
    const backupPath = _logPath + ".1";
    try {
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      fs.renameSync(_logPath, backupPath);
    } catch (_) {
      // If rename fails (file locked), just truncate — better than
      // having no logs at all.
      try {
        fs.writeFileSync(_logPath, "");
      } catch (_) {}
    }
  } catch (_) {}
}

/**
 * Open (or reopen) the write stream. Uses append mode so multiple
 * app instances don't clobber each other's logs (though single-instance
 * lock should prevent that).
 */
function _openStream() {
  try {
    _writeStream = fs.createWriteStream(_logPath, { flags: "a" });
    _writeStream.on("error", () => {
      /* swallow — logging must never crash */
    });
  } catch (err) {
    _writeStream = null;
  }
}

/**
 * Format a log line with timestamp and level prefix.
 */
function _formatLine(level, args) {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level}]`;
  // Convert args to string, handling objects/errors
  const parts = args.map((arg) => {
    if (arg instanceof Error) return arg.stack || arg.message;
    if (typeof arg === "object" && arg !== null) {
      try {
        return JSON.stringify(arg);
      } catch (_) {
        return String(arg);
      }
    }
    return String(arg);
  });
  return `${prefix} ${parts.join(" ")}\n`;
}

/**
 * Write a line to the log file. Also forwards to the original console
 * method so dev mode still prints to terminal.
 */
function _writeLog(level, originalFn, args) {
  // Always forward to original (terminal in dev, void in prod)
  try {
    originalFn.apply(console, args);
  } catch (_) {}

  if (!_writeStream) return;
  const line = _formatLine(level, args);
  try {
    _writeStream.write(line);
    // Check rotation every ~500 lines (cheap stat check)
    if (Math.random() < 0.002) _rotateIfNeeded();
  } catch (_) {}
}

/**
 * Initialize file logging. Should be called as early as possible —
 * ideally the first line of main.js, before any other require().
 *
 * @param {Object} [options]
 * @param {string} [options.logPath]  Override log file path (testing)
 */
function initFileLogger(options = {}) {
  if (_initialized) return;
  _initialized = true;

  _logPath = options.logPath || _resolveLogPath();

  // Rotate if the existing log is already too big
  _rotateIfNeeded();
  _openStream();

  // Snapshot original console methods
  _originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  };

  // Override console methods
  console.log = function (...args) {
    _writeLog("LOG", _originalConsole.log, args);
  };
  console.warn = function (...args) {
    _writeLog("WARN", _originalConsole.warn, args);
  };
  console.error = function (...args) {
    _writeLog("ERROR", _originalConsole.error, args);
  };
  console.info = function (...args) {
    _writeLog("INFO", _originalConsole.info, args);
  };

  // Log startup banner
  console.log(
    "═══════════════════════════════════════════════════════════════",
  );
  console.log(`NovaTune session started at ${new Date().toISOString()}`);
  console.log(`Log file: ${_logPath}`);
  console.log(`Process PID: ${process.pid}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(
    `Electron: ${process.versions.electron}, Node: ${process.versions.node}`,
  );
  console.log(`Argv: ${process.argv.join(" ")}`);
  console.log(
    "═══════════════════════════════════════════════════════════════",
  );
}

/**
 * Flush and close the log. Called on app quit.
 */
function closeFileLogger() {
  if (!_writeStream) return;
  try {
    console.log("NovaTune session ending.");
    _writeStream.end();
  } catch (_) {}
  _writeStream = null;
}

/**
 * Get the current log file path (for "Open Log" UI buttons).
 */
function getLogPath() {
  return _logPath;
}

module.exports = {
  initFileLogger,
  closeFileLogger,
  getLogPath,
};
