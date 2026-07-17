var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// main/fileLogger.js
var require_fileLogger = __commonJS({
  "main/fileLogger.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path = require("path");
    var os = require("os");
    var MAX_LOG_SIZE = 5 * 1024 * 1024;
    var _logPath = null;
    var _writeStream = null;
    var _originalConsole = null;
    var _initialized = false;
    function _resolveLogPath() {
      try {
        const { app } = require("electron");
        if (app && typeof app.getPath === "function") {
          const userData = app.getPath("userData");
          try {
            fs.mkdirSync(userData, { recursive: true });
          } catch (_) {
          }
          return path.join(userData, "novatune.log");
        }
      } catch (_) {
      }
      return path.join(os.tmpdir(), "novatune.log");
    }
    function _rotateIfNeeded() {
      try {
        if (!fs.existsSync(_logPath)) return;
        const stats = fs.statSync(_logPath);
        if (stats.size < MAX_LOG_SIZE) return;
        if (_writeStream) {
          try {
            _writeStream.end();
          } catch (_) {
          }
          _writeStream = null;
        }
        const backupPath = _logPath + ".1";
        try {
          if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
          fs.renameSync(_logPath, backupPath);
        } catch (_) {
          try {
            fs.writeFileSync(_logPath, "");
          } catch (_2) {
          }
        }
      } catch (_) {
      }
    }
    function _openStream() {
      try {
        _writeStream = fs.createWriteStream(_logPath, { flags: "a" });
        _writeStream.on("error", () => {
        });
      } catch (err) {
        _writeStream = null;
      }
    }
    function _formatLine(level, args) {
      const ts = (/* @__PURE__ */ new Date()).toISOString();
      const prefix = `[${ts}] [${level}]`;
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
      return `${prefix} ${parts.join(" ")}
`;
    }
    function _writeLog(level, originalFn, args) {
      try {
        originalFn.apply(console, args);
      } catch (_) {
      }
      if (!_writeStream) return;
      const line = _formatLine(level, args);
      try {
        _writeStream.write(line);
        if (Math.random() < 2e-3) _rotateIfNeeded();
      } catch (_) {
      }
    }
    function initFileLogger(options = {}) {
      if (_initialized) return;
      _initialized = true;
      _logPath = options.logPath || _resolveLogPath();
      _rotateIfNeeded();
      _openStream();
      _originalConsole = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        info: console.info.bind(console)
      };
      console.log = function(...args) {
        _writeLog("LOG", _originalConsole.log, args);
      };
      console.warn = function(...args) {
        _writeLog("WARN", _originalConsole.warn, args);
      };
      console.error = function(...args) {
        _writeLog("ERROR", _originalConsole.error, args);
      };
      console.info = function(...args) {
        _writeLog("INFO", _originalConsole.info, args);
      };
      console.log(
        "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550"
      );
      console.log(`NovaTune session started at ${(/* @__PURE__ */ new Date()).toISOString()}`);
      console.log(`Log file: ${_logPath}`);
      console.log(`Process PID: ${process.pid}`);
      console.log(`Platform: ${process.platform} ${process.arch}`);
      console.log(
        `Electron: ${process.versions.electron}, Node: ${process.versions.node}`
      );
      console.log(`Argv: ${process.argv.join(" ")}`);
      console.log(
        "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550"
      );
    }
    function closeFileLogger() {
      if (!_writeStream) return;
      try {
        console.log("NovaTune session ending.");
        _writeStream.end();
      } catch (_) {
      }
      _writeStream = null;
    }
    function getLogPath() {
      return _logPath;
    }
    module2.exports = {
      initFileLogger,
      closeFileLogger,
      getLogPath
    };
  }
});

// node_modules/v8-compile-cache/v8-compile-cache.js
var require_v8_compile_cache = __commonJS({
  "node_modules/v8-compile-cache/v8-compile-cache.js"(exports2, module2) {
    "use strict";
    var Module = require("module");
    var crypto = require("crypto");
    var fs = require("fs");
    var path = require("path");
    var vm = require("vm");
    var os = require("os");
    var hasOwnProperty = Object.prototype.hasOwnProperty;
    var FileSystemBlobStore = class {
      constructor(directory, prefix) {
        const name = prefix ? slashEscape(prefix + ".") : "";
        this._blobFilename = path.join(directory, name + "BLOB");
        this._mapFilename = path.join(directory, name + "MAP");
        this._lockFilename = path.join(directory, name + "LOCK");
        this._directory = directory;
        this._load();
      }
      has(key, invalidationKey) {
        if (hasOwnProperty.call(this._memoryBlobs, key)) {
          return this._invalidationKeys[key] === invalidationKey;
        } else if (hasOwnProperty.call(this._storedMap, key)) {
          return this._storedMap[key][0] === invalidationKey;
        }
        return false;
      }
      get(key, invalidationKey) {
        if (hasOwnProperty.call(this._memoryBlobs, key)) {
          if (this._invalidationKeys[key] === invalidationKey) {
            return this._memoryBlobs[key];
          }
        } else if (hasOwnProperty.call(this._storedMap, key)) {
          const mapping = this._storedMap[key];
          if (mapping[0] === invalidationKey) {
            return this._storedBlob.slice(mapping[1], mapping[2]);
          }
        }
      }
      set(key, invalidationKey, buffer) {
        this._invalidationKeys[key] = invalidationKey;
        this._memoryBlobs[key] = buffer;
        this._dirty = true;
      }
      delete(key) {
        if (hasOwnProperty.call(this._memoryBlobs, key)) {
          this._dirty = true;
          delete this._memoryBlobs[key];
        }
        if (hasOwnProperty.call(this._invalidationKeys, key)) {
          this._dirty = true;
          delete this._invalidationKeys[key];
        }
        if (hasOwnProperty.call(this._storedMap, key)) {
          this._dirty = true;
          delete this._storedMap[key];
        }
      }
      isDirty() {
        return this._dirty;
      }
      save() {
        const dump = this._getDump();
        const blobToStore = Buffer.concat(dump[0]);
        const mapToStore = JSON.stringify(dump[1]);
        try {
          mkdirpSync(this._directory);
          fs.writeFileSync(this._lockFilename, "LOCK", { flag: "wx" });
        } catch (error) {
          return false;
        }
        try {
          fs.writeFileSync(this._blobFilename, blobToStore);
          fs.writeFileSync(this._mapFilename, mapToStore);
        } finally {
          fs.unlinkSync(this._lockFilename);
        }
        return true;
      }
      _load() {
        try {
          this._storedBlob = fs.readFileSync(this._blobFilename);
          this._storedMap = JSON.parse(fs.readFileSync(this._mapFilename));
        } catch (e) {
          this._storedBlob = Buffer.alloc(0);
          this._storedMap = {};
        }
        this._dirty = false;
        this._memoryBlobs = {};
        this._invalidationKeys = {};
      }
      _getDump() {
        const buffers = [];
        const newMap = {};
        let offset = 0;
        function push(key, invalidationKey, buffer) {
          buffers.push(buffer);
          newMap[key] = [invalidationKey, offset, offset + buffer.length];
          offset += buffer.length;
        }
        for (const key of Object.keys(this._memoryBlobs)) {
          const buffer = this._memoryBlobs[key];
          const invalidationKey = this._invalidationKeys[key];
          push(key, invalidationKey, buffer);
        }
        for (const key of Object.keys(this._storedMap)) {
          if (hasOwnProperty.call(newMap, key)) continue;
          const mapping = this._storedMap[key];
          const buffer = this._storedBlob.slice(mapping[1], mapping[2]);
          push(key, mapping[0], buffer);
        }
        return [buffers, newMap];
      }
    };
    var NativeCompileCache = class {
      constructor() {
        this._cacheStore = null;
        this._previousModuleCompile = null;
      }
      setCacheStore(cacheStore) {
        this._cacheStore = cacheStore;
      }
      install() {
        const self = this;
        const hasRequireResolvePaths = typeof require.resolve.paths === "function";
        this._previousModuleCompile = Module.prototype._compile;
        Module.prototype._compile = function(content, filename) {
          const mod = this;
          function require2(id) {
            return mod.require(id);
          }
          function resolve(request, options) {
            return Module._resolveFilename(request, mod, false, options);
          }
          require2.resolve = resolve;
          if (hasRequireResolvePaths) {
            resolve.paths = function paths(request) {
              return Module._resolveLookupPaths(request, mod, true);
            };
          }
          require2.main = process.mainModule;
          require2.extensions = Module._extensions;
          require2.cache = Module._cache;
          const dirname = path.dirname(filename);
          const compiledWrapper = self._moduleCompile(filename, content);
          const args = [mod.exports, require2, mod, filename, dirname, process, global, Buffer];
          return compiledWrapper.apply(mod.exports, args);
        };
      }
      uninstall() {
        Module.prototype._compile = this._previousModuleCompile;
      }
      _moduleCompile(filename, content) {
        var contLen = content.length;
        if (contLen >= 2) {
          if (content.charCodeAt(0) === 35 && content.charCodeAt(1) === 33) {
            if (contLen === 2) {
              content = "";
            } else {
              var i = 2;
              for (; i < contLen; ++i) {
                var code = content.charCodeAt(i);
                if (code === 10 || code === 13) break;
              }
              if (i === contLen) {
                content = "";
              } else {
                content = content.slice(i);
              }
            }
          }
        }
        var wrapper = Module.wrap(content);
        var invalidationKey = crypto.createHash("sha1").update(content, "utf8").digest("hex");
        var buffer = this._cacheStore.get(filename, invalidationKey);
        var script = new vm.Script(wrapper, {
          filename,
          lineOffset: 0,
          displayErrors: true,
          cachedData: buffer,
          produceCachedData: true
        });
        if (script.cachedDataProduced) {
          this._cacheStore.set(filename, invalidationKey, script.cachedData);
        } else if (script.cachedDataRejected) {
          this._cacheStore.delete(filename);
        }
        var compiledWrapper = script.runInThisContext({
          filename,
          lineOffset: 0,
          columnOffset: 0,
          displayErrors: true
        });
        return compiledWrapper;
      }
    };
    function mkdirpSync(p_) {
      _mkdirpSync(path.resolve(p_), 511);
    }
    function _mkdirpSync(p, mode) {
      try {
        fs.mkdirSync(p, mode);
      } catch (err0) {
        if (err0.code === "ENOENT") {
          _mkdirpSync(path.dirname(p));
          _mkdirpSync(p);
        } else {
          try {
            const stat = fs.statSync(p);
            if (!stat.isDirectory()) {
              throw err0;
            }
          } catch (err1) {
            throw err0;
          }
        }
      }
    }
    function slashEscape(str) {
      const ESCAPE_LOOKUP = {
        "\\": "zB",
        ":": "zC",
        "/": "zS",
        "\0": "z0",
        "z": "zZ"
      };
      const ESCAPE_REGEX = /[\\:/\x00z]/g;
      return str.replace(ESCAPE_REGEX, (match) => ESCAPE_LOOKUP[match]);
    }
    function supportsCachedData() {
      const script = new vm.Script('""', { produceCachedData: true });
      return script.cachedDataProduced === true;
    }
    function getCacheDir() {
      const v8_compile_cache_cache_dir = process.env.V8_COMPILE_CACHE_CACHE_DIR;
      if (v8_compile_cache_cache_dir) {
        return v8_compile_cache_cache_dir;
      }
      const dirname = typeof process.getuid === "function" ? "v8-compile-cache-" + process.getuid() : "v8-compile-cache";
      const arch = process.arch;
      const version = typeof process.versions.v8 === "string" ? process.versions.v8 : typeof process.versions.chakracore === "string" ? "chakracore-" + process.versions.chakracore : "node-" + process.version;
      const cacheDir = path.join(os.tmpdir(), dirname, arch, version);
      return cacheDir;
    }
    function getMainName() {
      const mainName = require.main && typeof require.main.filename === "string" ? require.main.filename : process.cwd();
      return mainName;
    }
    if (!process.env.DISABLE_V8_COMPILE_CACHE && supportsCachedData()) {
      const cacheDir = getCacheDir();
      const prefix = getMainName();
      const blobStore = new FileSystemBlobStore(cacheDir, prefix);
      const nativeCompileCache = new NativeCompileCache();
      nativeCompileCache.setCacheStore(blobStore);
      nativeCompileCache.install();
      process.once("exit", () => {
        if (blobStore.isDirty()) {
          blobStore.save();
        }
        nativeCompileCache.uninstall();
      });
    }
    module2.exports.__TEST__ = {
      FileSystemBlobStore,
      NativeCompileCache,
      mkdirpSync,
      slashEscape,
      supportsCachedData,
      getCacheDir,
      getMainName
    };
  }
});

// main/windowManager.js
var require_windowManager = __commonJS({
  "main/windowManager.js"(exports2, module2) {
    var fs = require("fs");
    var os = require("os");
    var path = require("path");
    var { screen, app } = require("electron");
    function _sleep(ms) {
      try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      } catch (_) {
      }
    }
    function ensureDirSync(dir, attempts = 5) {
      for (let i = 0; i < attempts; i++) {
        try {
          fs.mkdirSync(dir, { recursive: true });
          return dir;
        } catch (err) {
          if (i === attempts - 1) throw err;
          _sleep(100 * (i + 1));
        }
      }
      return dir;
    }
    function resolveDataDir() {
      const preferred = process.defaultApp || process.env.NODE_ENV === "development" || process.argv.includes("--dev") ? path.join(__dirname, "..", "data") : app.getPath("userData");
      try {
        return ensureDirSync(preferred);
      } catch (err) {
        console.warn(
          "Primary data directory unavailable, falling back to temp dir:",
          err.message
        );
        const fallback = path.join(os.tmpdir(), "NovaTune");
        try {
          return ensureDirSync(fallback);
        } catch (err2) {
          console.warn("Fallback data directory also failed:", err2.message);
          return preferred;
        }
      }
    }
    var DATA_DIR = resolveDataDir();
    var STATE_FILE = path.join(DATA_DIR, "window-state.json");
    var WindowStateManager = class {
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
            const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
            const saved = raw[this.windowName];
            if (saved) {
              return {
                x: typeof saved.x === "number" ? saved.x : void 0,
                y: typeof saved.y === "number" ? saved.y : void 0,
                width: saved.width || this.defaults.defaultWidth,
                height: saved.height || this.defaults.defaultHeight,
                isMaximized: !!saved.isMaximized
              };
            }
          }
        } catch (err) {
          console.warn("Failed to load window state:", err.message);
        }
        return {
          x: void 0,
          y: void 0,
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
        if (state.x !== void 0 && state.y !== void 0) {
          const displays = screen.getAllDisplays();
          const bounds = {
            x: Math.min(...displays.map((d) => d.bounds.x)),
            y: Math.min(...displays.map((d) => d.bounds.y)),
            width: Math.max(...displays.map((d) => d.bounds.x + d.bounds.width)),
            height: Math.max(...displays.map((d) => d.bounds.y + d.bounds.height))
          };
          if (state.x < bounds.x || state.y < bounds.y || state.x > bounds.x + bounds.width - 100 || state.y > bounds.y + bounds.height - 100) {
            state.x = void 0;
            state.y = void 0;
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
              allStates = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
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
          fs.writeFileSync(STATE_FILE, JSON.stringify(allStates, null, 2), "utf-8");
          this.state = { ...allStates[this.windowName] };
        } catch (err) {
          console.warn("Failed to save window state:", err.message);
        }
      }
    };
    module2.exports = WindowStateManager;
    module2.exports.DATA_DIR = DATA_DIR;
    module2.exports.ensureDirSync = ensureDirSync;
  }
});

// main/fileScanner.js
var require_fileScanner = __commonJS({
  "main/fileScanner.js"(exports2, module2) {
    var fs = require("fs");
    var path = require("path");
    var SKIP_DIRS = /* @__PURE__ */ new Set([
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
      "AppData"
    ]);
    var MAX_CONCURRENT_DIRS = 4;
    var FileScanner = class {
      /**
       * @param {string[]} supportedExtensions - Array of extensions like ['.mp3', '.flac']
       */
      constructor(supportedExtensions) {
        this.supportedExtensions = new Set(
          supportedExtensions.map((ext) => ext.toLowerCase())
        );
        this.watchers = /* @__PURE__ */ new Map();
        this.debounceTimers = /* @__PURE__ */ new Map();
        this.debounceDelay = 500;
      }
      /**
       * Recursively scan a directory for supported audio files.
       * Uses ASYNC I/O to avoid blocking the main process event loop.
       * @param {string} dirPath - Absolute path to scan
       * @returns {Promise<Array<{filePath: string, fileName: string, fileSize: number, modifiedTime: number}>>}
       */
      async scanDirectory(dirPath) {
        const results = [];
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
        const directories = [];
        const fileJobs = [];
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
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
        const statResults = await Promise.allSettled(
          fileJobs.map(async ({ fullPath, fileName }) => {
            const stat = await fs.promises.stat(fullPath);
            return {
              filePath: fullPath,
              fileName,
              fileSize: stat.size,
              modifiedTime: stat.mtimeMs,
              birthTime: stat.birthtimeMs
            };
          })
        );
        for (const result of statResults) {
          if (result.status === "fulfilled") {
            results.push(result.value);
          }
        }
        if (directories.length > 0) {
          for (let i = 0; i < directories.length; i += MAX_CONCURRENT_DIRS) {
            const batch = directories.slice(i, i + MAX_CONCURRENT_DIRS);
            await Promise.all(
              batch.map((dir) => this._scanRecursive(dir, results))
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
        fs.promises.access(dirPath).catch(() => {
          throw new Error(`Directory does not exist: ${dirPath}`);
        });
        this.unwatchDirectory(dirPath);
        const watcher = fs.watch(
          dirPath,
          { persistent: false, recursive: true },
          (eventType, filename) => {
            if (!filename) return;
            const ext = path.extname(filename).toLowerCase();
            if (!this.supportedExtensions.has(ext)) return;
            const fullPath = path.join(dirPath, filename);
            const key = fullPath;
            if (this.debounceTimers.has(key)) {
              clearTimeout(this.debounceTimers.get(key));
            }
            const timer = setTimeout(() => {
              this.debounceTimers.delete(key);
              callback(eventType, fullPath);
            }, this.debounceDelay);
            this.debounceTimers.set(key, timer);
          }
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
          }
        }
        this.watchers.clear();
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
    };
    module2.exports = FileScanner;
  }
});

// main/metadataReader.js
var require_metadataReader = __commonJS({
  "main/metadataReader.js"(exports2, module2) {
    var path = require("path");
    var fs = require("fs");
    function _readFlacDurationBinary(filePath) {
      try {
        const fd = fs.openSync(filePath, "r");
        const header = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, header, 0, 4096, 0);
        fs.closeSync(fd);
        let flacOffset = -1;
        for (let i = 0; i <= bytesRead - 4; i++) {
          if (header[i] === 102 && header[i + 1] === 76 && header[i + 2] === 97 && header[i + 3] === 67) {
            flacOffset = i;
            break;
          }
        }
        if (flacOffset < 0) return 0;
        const blockHeaderOffset = flacOffset + 4;
        if (blockHeaderOffset + 4 + 34 > bytesRead) return 0;
        const blockType = header[blockHeaderOffset] & 127;
        if (blockType !== 0) return 0;
        const siOffset = blockHeaderOffset + 4;
        const byte10 = header[siOffset + 10];
        const byte11 = header[siOffset + 11];
        const byte12 = header[siOffset + 12];
        const sampleRate = byte10 << 12 | byte11 << 4 | byte12 >> 4;
        if (!sampleRate) return 0;
        const byte13 = header[siOffset + 13];
        const byte14 = header[siOffset + 14];
        const byte15 = header[siOffset + 15];
        const byte16 = header[siOffset + 16];
        const byte17 = header[siOffset + 17];
        const totalSamples = BigInt(byte13 & 15) << 32n | BigInt(byte14) << 24n | BigInt(byte15) << 16n | BigInt(byte16) << 8n | BigInt(byte17);
        const duration = Math.round(Number(totalSamples) / sampleRate);
        return duration > 0 ? duration : 0;
      } catch (_) {
        return 0;
      }
    }
    function _readFlacVorbisCommentsBinary(filePath) {
      const result = {
        title: "",
        artist: "",
        album: "",
        albumArtist: "",
        genre: "",
        year: 0,
        trackNumber: 0,
        discNumber: 0
      };
      try {
        const CHUNK = 256 * 1024;
        const fd = fs.openSync(filePath, "r");
        const buf = Buffer.alloc(CHUNK);
        const bytesRead = fs.readSync(fd, buf, 0, CHUNK, 0);
        fs.closeSync(fd);
        let offset = -1;
        for (let i = 0; i <= bytesRead - 4; i++) {
          if (buf[i] === 102 && buf[i + 1] === 76 && buf[i + 2] === 97 && buf[i + 3] === 67) {
            offset = i + 4;
            break;
          }
        }
        if (offset < 0) return result;
        while (offset + 4 <= bytesRead) {
          const blockHeaderByte = buf[offset];
          const isLast = (blockHeaderByte & 128) !== 0;
          const blockType = blockHeaderByte & 127;
          const blockLen = buf[offset + 1] << 16 | buf[offset + 2] << 8 | buf[offset + 3];
          offset += 4;
          if (blockType === 4) {
            let p = offset;
            const vendorLen = buf.readUInt32LE(p);
            p += 4 + vendorLen;
            if (p + 4 > bytesRead) break;
            const commentCount = buf.readUInt32LE(p);
            p += 4;
            for (let c = 0; c < commentCount; c++) {
              if (p + 4 > bytesRead) break;
              const cLen = buf.readUInt32LE(p);
              p += 4;
              if (p + cLen > bytesRead) break;
              const comment = buf.slice(p, p + cLen).toString("utf8");
              p += cLen;
              const eqIdx = comment.indexOf("=");
              if (eqIdx < 0) continue;
              const key = comment.substring(0, eqIdx).toUpperCase().trim();
              const val = comment.substring(eqIdx + 1).trim();
              if (key === "TITLE" && !result.title) result.title = val;
              else if (key === "ARTIST" && !result.artist) result.artist = val;
              else if (key === "ALBUM" && !result.album) result.album = val;
              else if ((key === "ALBUMARTIST" || key === "ALBUM ARTIST") && !result.albumArtist)
                result.albumArtist = val;
              else if (key === "GENRE" && !result.genre) result.genre = val;
              else if (key === "DATE" || key === "YEAR")
                result.year = parseInt(val) || result.year;
              else if (key === "TRACKNUMBER")
                result.trackNumber = parseInt(val) || result.trackNumber;
              else if (key === "DISCNUMBER")
                result.discNumber = parseInt(val) || result.discNumber;
            }
            break;
          }
          offset += blockLen;
          if (isLast) break;
        }
      } catch (_) {
      }
      return result;
    }
    var mm = null;
    var _loadAttempted = false;
    var _loadFailed = false;
    async function ensureMM() {
      if (mm) return mm;
      if (_loadFailed) {
        throw new Error(
          "music-metadata failed to load previously. Using fallback metadata only."
        );
      }
      try {
        const mod = await import("music-metadata");
        if (mod.default && typeof mod.default.parseFile === "function") {
          mm = mod.default;
        } else if (typeof mod.parseFile === "function") {
          mm = mod;
        } else if (typeof mod.default === "object" && mod.default !== null) {
          mm = mod.default;
        } else {
          throw new Error("Cannot find parseFile in music-metadata module exports");
        }
        _loadAttempted = true;
        console.log("[metadataReader] music-metadata loaded successfully");
        return mm;
      } catch (err) {
        _loadFailed = true;
        _loadAttempted = true;
        console.error(
          "[metadataReader] Failed to load music-metadata:",
          err.message
        );
        throw err;
      }
    }
    var MetadataReader = class {
      constructor() {
        this.supportedFormats = /* @__PURE__ */ new Set([
          "mp3",
          "flac",
          "wav",
          "ogg",
          "m4a",
          "aac",
          "wma",
          "opus",
          "ape",
          "wv",
          "tta",
          "mpc",
          "aiff"
        ]);
        this._coverCacheDir = null;
      }
      /**
       * Set the directory for caching large embedded cover art.
       * Must be called before readMetadata if you want large art support.
       * @param {string} dir - Absolute path to cache directory
       */
      setCoverCacheDir(dir) {
        this._coverCacheDir = dir;
      }
      /**
       * Check if music-metadata is available.
       * @returns {Promise<boolean>}
       */
      async isAvailable() {
        if (mm) return true;
        if (_loadFailed) return false;
        try {
          await ensureMM();
          return true;
        } catch {
          return false;
        }
      }
      /**
       * Read metadata from an audio file.
       * Falls back to basic filename-based metadata if music-metadata is unavailable.
       * @param {string} filePath - Absolute path to the audio file
       * @param {Map<string, string>} [knownArtists] - Optional Map of lowercased
       *   artist names → original-cased names from the existing library. Used by
       *   _fallbackMetadata to split artist from title for underscored YouTube-rip
       *   filenames. v1.1.5: forwarded to all _fallbackMetadata call sites.
       * @returns {Promise<Object>} Parsed metadata object
       */
      async readMetadata(filePath, knownArtists) {
        const attempts = 3;
        const delay = 200;
        let lastError = null;
        for (let attempt = 1; attempt <= attempts; attempt++) {
          try {
            const lib = await ensureMM();
            const result = await lib.parseFile(filePath, {
              duration: true,
              skipCovers: false,
              includeChapters: false
            });
            const duration = result.format.duration ? Math.round(result.format.duration) : 0;
            if (duration === 0 && attempt < attempts) {
              let fileSize = 0;
              try {
                fileSize = (await fs.promises.stat(filePath)).size;
              } catch (_) {
              }
              if (fileSize > 0) {
                lastError = new Error("Duration parsed as 0 for non-empty file");
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
              }
            }
            const metadata = {
              title: this._getFirst(result.common.title) || "",
              artist: this._joinArtists(result.common.artists) || "",
              album: this._getFirst(result.common.album) || "",
              albumArtist: this._getFirst(result.common.albumartist) || "",
              genre: this._joinArray(result.common.genre) || "",
              year: result.common.year || 0,
              trackNumber: this._getNumber(result.common.track) || 0,
              discNumber: this._getNumber(result.common.disc) || 0,
              duration,
              bitrate: result.format.bitrate ? Math.round(result.format.bitrate / 1e3) : 0,
              sampleRate: result.format.sampleRate || 0,
              channels: result.format.numberOfChannels || 0,
              format: (result.format.container || "").toUpperCase() || path.extname(filePath).replace(".", "").toUpperCase(),
              coverArt: null
            };
            if (metadata.duration === 0 && path.extname(filePath).toLowerCase() === ".flac") {
              const binaryDur = _readFlacDurationBinary(filePath);
              if (binaryDur > 0) {
                metadata.duration = binaryDur;
              }
            }
            if (result.common.picture && result.common.picture.length > 0) {
              const picture = result.common.picture[0];
              const buf = picture.data;
              if (buf.length < 200 * 1024) {
                metadata.coverArt = `data:${picture.format || "image/jpeg"};base64,${Buffer.from(buf).toString("base64")}`;
              } else {
                metadata.coverArt = this._saveEmbeddedCover(filePath, picture);
              }
            }
            if (!metadata.coverArt) {
              metadata.coverArt = await this._findOfflineCover(filePath);
            }
            return metadata;
          } catch (err) {
            lastError = err;
            console.warn(
              `[metadataReader] Attempt ${attempt} failed for ${path.basename(filePath)}: ${err.message}`
            );
            if (attempt < attempts) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        }
        try {
          const ext = path.extname(filePath).toLowerCase();
          const mimeMap = {
            ".flac": "audio/flac",
            ".mp3": "audio/mpeg",
            ".ogg": "audio/ogg",
            ".opus": "audio/ogg; codecs=opus",
            ".m4a": "audio/mp4",
            ".wav": "audio/wav",
            ".aac": "audio/aac"
          };
          const mimeType = mimeMap[ext];
          if (mimeType) {
            const lib = await ensureMM();
            const buf = fs.readFileSync(filePath);
            const result = await lib.parseBuffer(buf, { mimeType, duration: true });
            const duration = result.format.duration ? Math.round(result.format.duration) : 0;
            const metadata = {
              title: this._getFirst(result.common.title) || "",
              artist: this._joinArtists(result.common.artists) || "",
              album: this._getFirst(result.common.album) || "",
              albumArtist: this._getFirst(result.common.albumartist) || "",
              genre: this._joinArray(result.common.genre) || "",
              year: result.common.year || 0,
              trackNumber: this._getNumber(result.common.track) || 0,
              discNumber: this._getNumber(result.common.disc) || 0,
              duration: duration || (ext === ".flac" ? _readFlacDurationBinary(filePath) : 0),
              bitrate: result.format.bitrate ? Math.round(result.format.bitrate / 1e3) : 0,
              sampleRate: result.format.sampleRate || 0,
              channels: result.format.numberOfChannels || 0,
              format: (result.format.container || "").toUpperCase() || ext.replace(".", "").toUpperCase(),
              coverArt: null
            };
            if (result.common.picture && result.common.picture.length > 0) {
              const picture = result.common.picture[0];
              const picBuf = picture.data;
              if (picBuf.length < 200 * 1024) {
                metadata.coverArt = `data:${picture.format || "image/jpeg"};base64,${Buffer.from(picBuf).toString("base64")}`;
              } else {
                metadata.coverArt = this._saveEmbeddedCover(filePath, picture);
              }
            }
            if (!metadata.coverArt)
              metadata.coverArt = await this._findOfflineCover(filePath);
            if (metadata.duration > 0 || metadata.title) {
              console.log(
                `[metadataReader] parseBuffer succeeded for ${path.basename(filePath)}`
              );
              return metadata;
            }
          }
        } catch (bufErr) {
          console.warn(
            `[metadataReader] parseBuffer also failed for ${path.basename(filePath)}: ${bufErr.message}`
          );
        }
        if (path.extname(filePath).toLowerCase() === ".flac") {
          const tags = _readFlacVorbisCommentsBinary(filePath);
          const duration = _readFlacDurationBinary(filePath);
          if (duration > 0 || tags.title) {
            console.log(
              `[metadataReader] Binary Vorbis read succeeded for ${path.basename(filePath)}: "${tags.title}" / "${tags.artist}" / "${tags.album}"`
            );
            const nameNoExt = path.basename(filePath, ".flac");
            const fallbackTags = this._fallbackMetadata(filePath, knownArtists);
            return {
              title: tags.title || fallbackTags.title || nameNoExt,
              artist: tags.artist || fallbackTags.artist || "Unknown Artist",
              album: tags.album || "Unknown Album",
              albumArtist: tags.albumArtist || "",
              genre: tags.genre || "",
              year: tags.year || 0,
              trackNumber: tags.trackNumber || 0,
              discNumber: tags.discNumber || 0,
              duration,
              bitrate: 0,
              sampleRate: 0,
              channels: 0,
              format: "FLAC",
              coverArt: await this._findOfflineCover(filePath)
            };
          }
        }
        console.warn(
          `[metadataReader] All attempts failed for ${path.basename(filePath)}. Falling back to filename metadata.`
        );
        return this._fallbackMetadata(filePath, knownArtists);
      }
      /**
       * Get lightweight metadata (duration + format only) — much faster.
       * @param {string} filePath
       * @returns {Promise<{duration: number, format: string, bitrate: number, sampleRate: number, channels: number}>}
       */
      async readQuickInfo(filePath) {
        try {
          const lib = await ensureMM();
          const result = await lib.parseFile(filePath, {
            duration: true,
            skipCovers: true,
            includeChapters: false
          });
          const quickInfo = {
            duration: result.format.duration ? Math.round(result.format.duration) : 0,
            format: (result.format.container || "").toUpperCase() || path.extname(filePath).replace(".", "").toUpperCase(),
            bitrate: result.format.bitrate ? Math.round(result.format.bitrate / 1e3) : 0,
            sampleRate: result.format.sampleRate || 0,
            channels: result.format.numberOfChannels || 0
          };
          if (quickInfo.duration === 0 && path.extname(filePath).toLowerCase() === ".flac") {
            const binaryDur = _readFlacDurationBinary(filePath);
            if (binaryDur > 0) quickInfo.duration = binaryDur;
          }
          return quickInfo;
        } catch {
          if (path.extname(filePath).toLowerCase() === ".flac") {
            const binaryDur = _readFlacDurationBinary(filePath);
            if (binaryDur > 0)
              return {
                duration: binaryDur,
                format: "FLAC",
                bitrate: 0,
                sampleRate: 0,
                channels: 0
              };
          }
          return {
            duration: 0,
            format: "",
            bitrate: 0,
            sampleRate: 0,
            channels: 0
          };
        }
      }
      /**
       * Read metadata from a buffer (for in-memory files).
       * @param {Buffer} buffer - Audio file buffer
       * @param {string} mimeType - MIME type hint
       * @returns {Promise<Object>}
       */
      async readMetadataFromBuffer(buffer, mimeType) {
        try {
          const lib = await ensureMM();
          const result = await lib.parseBuffer(buffer, { mimeType });
          const metadata = {
            title: this._getFirst(result.common.title) || "",
            artist: this._joinArtists(result.common.artists) || "",
            album: this._getFirst(result.common.album) || "",
            albumArtist: this._getFirst(result.common.albumartist) || "",
            genre: this._joinArray(result.common.genre) || "",
            year: result.common.year || 0,
            trackNumber: this._getNumber(result.common.track) || 0,
            discNumber: this._getNumber(result.common.disc) || 0,
            duration: result.format.duration ? Math.round(result.format.duration) : 0,
            bitrate: result.format.bitrate ? Math.round(result.format.bitrate / 1e3) : 0,
            sampleRate: result.format.sampleRate || 0,
            channels: result.format.numberOfChannels || 0,
            format: (result.format.container || "").toUpperCase(),
            coverArt: null
          };
          if (result.common.picture && result.common.picture.length > 0) {
            const picture = result.common.picture[0];
            const buf = picture.data;
            if (buf.length < 200 * 1024) {
              metadata.coverArt = `data:${picture.format || "image/jpeg"};base64,${buf.toString("base64")}`;
            } else {
              metadata.coverArt = this._saveEmbeddedCoverFromBuffer(
                buffer,
                picture
              );
            }
          }
          return metadata;
        } catch (err) {
          throw new Error(`Buffer metadata read error: ${err.message}`);
        }
      }
      /**
       * Get only the cover art from a file.
       * @param {string} filePath
       * @returns {Promise<string|null>} Base64 data URI or null
       */
      async getCoverArt(filePath) {
        try {
          const lib = await ensureMM();
          const result = await lib.parseFile(filePath, {
            duration: false,
            skipCovers: false
          });
          if (result.common.picture && result.common.picture.length > 0) {
            const picture = result.common.picture[0];
            const buf = picture.data;
            if (buf.length < 200 * 1024) {
              return `data:${picture.format || "image/jpeg"};base64,${buf.toString("base64")}`;
            }
          }
          return await this._findOfflineCover(filePath);
        } catch (err) {
          return await this._findOfflineCover(filePath);
        }
      }
      // ─── Utility Helpers ─────────────────────────────────────────────
      /**
       * Generate fallback metadata from the filename when music-metadata fails.
       *
       * v1.1.0 — EXHAUSTIVE SCANNER FIX:
       *   1. Parse underscore-separated YouTube-rip filenames such as
       *      `don_toliver_high_unreleased__yaxBLgIoHuI_140.mp3`
       *      → artist "Don Toliver", title "High (Unreleased)".
       *      The `__<11-char-youtube-id>_<3-digit-itag>` suffix is stripped,
       *      then the remaining `_`-separated tokens are split into artist
       *      (first 1–2 lowercase-word tokens) and title (rest).
       *   2. Estimate duration from file size when music-metadata returned 0
       *      (common for YouTube rips with corrupt headers). Without this,
       *      ipc.js's `library:scan` rejects the track as "0:00" and adds
       *      the file to `_failedFiles`, permanently skipping it.
       *      Estimation: duration = fileSizeBytes * 8 / assumedBitrate.
       *      Bitrate is chosen by file extension (128 kbps for AAC/MP3,
       *      256 for M4A, 96 for Opus, etc.). Capped at 1 hour to avoid
       *      absurd estimates from oversized files.
       *
       * v1.1.3: Added optional `knownArtists` parameter — a Set of lowercased
       * artist names from the existing library. When parsing underscored
       * YouTube-rip filenames, we try to match the leading tokens against
       * this set so we can split artist from title correctly.
       *   e.g. "don_toliver_high_unreleased" + knownArtists={"don toliver"}
       *        → artist="Don Toliver", title="High (Unreleased)"
       *
       * @private
       */
      async _fallbackMetadata(filePath, knownArtists) {
        const nameWithoutExt = path.basename(filePath, path.extname(filePath));
        let cleanedName = nameWithoutExt;
        const ytSuffixMatch = nameWithoutExt.match(
          /__(?:[A-Za-z0-9_-]{8,})_(\d{2,4})$/
        );
        let ytItag = 0;
        if (ytSuffixMatch) {
          ytItag = parseInt(ytSuffixMatch[1], 10) || 0;
          cleanedName = nameWithoutExt.slice(
            0,
            nameWithoutExt.length - ytSuffixMatch[0].length
          );
          cleanedName = cleanedName.replace(/_+$/, "").replace(/^_+/, "");
        }
        let title = cleanedName;
        let artist = "Unknown Artist";
        const dashIndex = cleanedName.indexOf(" - ");
        if (dashIndex > 0 && dashIndex < cleanedName.length - 3) {
          artist = cleanedName.substring(0, dashIndex).trim();
          title = cleanedName.substring(dashIndex + 3).trim();
        } else if (/[_]/.test(cleanedName)) {
          const tokens = cleanedName.split(/[_]+/).map((t) => t.trim()).filter(Boolean);
          let matchedArtist = null;
          let artistTokenCount = 0;
          if (knownArtists && knownArtists.size > 0 && tokens.length >= 2) {
            for (let n = Math.min(3, tokens.length - 1); n >= 1; n--) {
              const prefix = tokens.slice(0, n).join(" ").toLowerCase();
              if (knownArtists.has(prefix)) {
                matchedArtist = knownArtists.get(prefix);
                artistTokenCount = n;
                break;
              }
            }
          }
          if (matchedArtist && artistTokenCount > 0) {
            artist = matchedArtist;
            const titleTokens = tokens.slice(artistTokenCount);
            const titleStr = titleTokens.join(" ");
            const titleCased = titleStr.replace(/\b\w/g, (c) => c.toUpperCase());
            title = titleCased.replace(/\bUnreleased\b/g, "(Unreleased)").replace(/\bOfficial\s+(Video|Visualizer|Audio)\b/g, "(Official $1)").replace(/\bOfficial\b/g, "(Official)").replace(/\bLyrics\b/g, "(Lyrics)").replace(/\s+/g, " ").trim();
          } else {
            const spaced = cleanedName.replace(/_/g, " ").replace(/\s+/g, " ").trim();
            const titleCased = spaced.replace(/\b\w/g, (c) => c.toUpperCase());
            title = titleCased.replace(/\bUnreleased\b/g, "(Unreleased)").replace(/\bOfficial\s+(Video|Visualizer|Audio)\b/g, "(Official $1)").replace(/\bOfficial\b/g, "(Official)").replace(/\bLyrics\b/g, "(Lyrics)").replace(/\s+/g, " ").trim();
          }
        }
        title = title.replace(/^\d+[._\s]+/, "").trim() || title;
        title = title.replace(/\s+/g, " ").trim();
        artist = artist.replace(/\s+/g, " ").trim() || "Unknown Artist";
        const ext = path.extname(filePath).replace(".", "").toUpperCase();
        let fileSize = 0;
        try {
          fileSize = (await fs.promises.stat(filePath)).size;
        } catch {
        }
        let duration = 0;
        let bitrate = 0;
        if (fileSize > 0) {
          const extLower = path.extname(filePath).toLowerCase();
          let assumedKbps = 128;
          if (ytItag > 0) {
            const itagBitrate = {
              140: 128,
              139: 48,
              171: 128,
              249: 50,
              250: 70,
              251: 160,
              18: 96,
              22: 192,
              137: 0,
              136: 0,
              135: 0
              // 13x = video-only, no audio
            };
            if (itagBitrate[ytItag]) assumedKbps = itagBitrate[ytItag];
          } else if (extLower === ".m4a") assumedKbps = 256;
          else if (extLower === ".opus") assumedKbps = 96;
          else if (extLower === ".ogg") assumedKbps = 112;
          else if (extLower === ".flac")
            assumedKbps = 900;
          else if (extLower === ".wav") assumedKbps = 1411;
          if (assumedKbps > 0) {
            const estimated = Math.floor(fileSize * 8 / (assumedKbps * 1e3));
            duration = Math.min(3600, Math.max(1, estimated));
            bitrate = assumedKbps;
          }
        }
        return {
          title,
          artist,
          album: "Unknown Album",
          albumArtist: "",
          genre: "",
          year: 0,
          trackNumber: 0,
          discNumber: 0,
          duration,
          bitrate,
          sampleRate: 0,
          channels: 0,
          format: ext,
          coverArt: await this._findOfflineCover(filePath),
          fileSize
        };
      }
      _getFirst(value) {
        if (Array.isArray(value)) return value[0];
        return value || null;
      }
      _joinArtists(artists) {
        if (!artists || !Array.isArray(artists)) return "";
        return artists.join(", ");
      }
      _joinArray(arr) {
        if (!arr || !Array.isArray(arr)) return "";
        return arr.join(", ");
      }
      _getNumber(value) {
        if (typeof value === "number") return value;
        if (typeof value === "object" && value !== null) return value.no || 0;
        return parseInt(value, 10) || 0;
      }
      /**
       * Save a large embedded cover art image to userData/cached_covers to avoid DB/IPC bloat.
       * @private
       */
      _saveEmbeddedCover(filePath, picture) {
        if (!this._coverCacheDir) return null;
        try {
          const crypto = require("crypto");
          if (!fs.existsSync(this._coverCacheDir)) {
            fs.mkdirSync(this._coverCacheDir, { recursive: true });
          }
          const hash = crypto.createHash("sha256").update(filePath).digest("hex").substring(0, 16);
          const ext = picture.format === "image/png" ? ".png" : ".jpg";
          const cachePath = path.join(this._coverCacheDir, `cover_${hash}${ext}`);
          if (!fs.existsSync(cachePath)) {
            fs.writeFileSync(cachePath, picture.data);
          }
          return cachePath;
        } catch (err) {
          console.warn(
            "[metadataReader] Failed to save embedded cover to cache:",
            err.message
          );
          return null;
        }
      }
      /**
       * Save an in-memory buffer's large embedded cover art to cached_covers.
       * @private
       */
      _saveEmbeddedCoverFromBuffer(buffer, picture) {
        if (!this._coverCacheDir) return null;
        try {
          const crypto = require("crypto");
          if (!fs.existsSync(this._coverCacheDir)) {
            fs.mkdirSync(this._coverCacheDir, { recursive: true });
          }
          const hash = crypto.createHash("sha256").update(buffer).digest("hex").substring(0, 16);
          const ext = picture.format === "image/png" ? ".png" : ".jpg";
          const cachePath = path.join(this._coverCacheDir, `cover_${hash}${ext}`);
          if (!fs.existsSync(cachePath)) {
            fs.writeFileSync(cachePath, picture.data);
          }
          return cachePath;
        } catch (err) {
          console.warn(
            "[metadataReader] Failed to save buffer cover to cache:",
            err.message
          );
          return null;
        }
      }
      /**
       * Exhaustive search for offline/cover art near the music file.
       * Searches: same directory (all images), .novaart sidecars, parent directories,
       * subdirectories (1 level), and walks up 3 parent levels.
       * The goal: ALWAYS find cover art if any image file exists nearby.
       * @private
       */
      async _findOfflineCover(filePath) {
        try {
          const dir = path.dirname(filePath);
          const audioName = path.basename(filePath, path.extname(filePath)).toLowerCase();
          const extList = [
            ".jpg",
            ".jpeg",
            ".png",
            ".webp",
            ".bmp",
            ".gif",
            ".tiff",
            ".tif"
          ];
          const commonNames = /* @__PURE__ */ new Set([
            "cover",
            "folder",
            "album",
            "front",
            "artwork",
            "art",
            "thumb",
            "thumbnail",
            "back",
            "insert",
            "booklet",
            "jacket",
            "label",
            "sticker"
          ]);
          try {
            await fs.promises.access(dir);
          } catch (_) {
            return null;
          }
          const files = await fs.promises.readdir(dir);
          for (const file of files) {
            const lower = file.toLowerCase();
            if (lower.includes(".novaart") && extList.includes(path.extname(lower))) {
              return path.join(dir, file);
            }
          }
          for (const file of files) {
            const fileExt = path.extname(file).toLowerCase();
            if (extList.includes(fileExt)) {
              const nameNoExt = path.basename(file, path.extname(file)).toLowerCase();
              if (nameNoExt === audioName) {
                return path.join(dir, file);
              }
            }
          }
          for (const file of files) {
            const fileExt = path.extname(file).toLowerCase();
            if (extList.includes(fileExt)) {
              const nameNoExt = path.basename(file, path.extname(file)).toLowerCase();
              if (commonNames.has(nameNoExt)) {
                return path.join(dir, file);
              }
            }
          }
          let fallbackArt = null;
          for (const file of files) {
            const fileExt = path.extname(file).toLowerCase();
            if (extList.includes(fileExt)) {
              const nameNoExt = path.basename(file, path.extname(file)).toLowerCase();
              if (nameNoExt.startsWith("albumart")) {
                const fullPath = path.join(dir, file);
                if (nameNoExt.includes("large")) {
                  return fullPath;
                }
                fallbackArt = fallbackArt || fullPath;
              }
            }
          }
          if (fallbackArt) return fallbackArt;
          for (const file of files) {
            const subdir = path.join(dir, file);
            let stat;
            try {
              stat = await fs.promises.stat(subdir);
              if (!stat.isDirectory()) continue;
            } catch (_) {
              continue;
            }
            let subFiles;
            try {
              subFiles = await fs.promises.readdir(subdir);
            } catch (_) {
              continue;
            }
            for (const sf of subFiles) {
              const lower = sf.toLowerCase();
              if (lower.includes(".novaart") && extList.includes(path.extname(lower))) {
                return path.join(subdir, sf);
              }
            }
            for (const sf of subFiles) {
              const sfExt = path.extname(sf).toLowerCase();
              if (extList.includes(sfExt)) {
                const nameNoExt = path.basename(sf, path.extname(sf)).toLowerCase();
                if (commonNames.has(nameNoExt)) {
                  return path.join(subdir, sf);
                }
              }
            }
          }
          let current = dir;
          for (let depth = 0; depth < 3; depth++) {
            const parent = path.dirname(current);
            if (!parent || parent === current) break;
            try {
              await fs.promises.access(parent);
            } catch (_) {
              break;
            }
            let parentFiles;
            try {
              parentFiles = await fs.promises.readdir(parent);
            } catch (_) {
              break;
            }
            for (const file of parentFiles) {
              const fileExt = path.extname(file).toLowerCase();
              if (extList.includes(fileExt)) {
                const nameNoExt = path.basename(file, path.extname(file)).toLowerCase();
                if (commonNames.has(nameNoExt)) {
                  return path.join(parent, file);
                }
              }
            }
            current = parent;
          }
        } catch (err) {
          console.warn(
            `[metadataReader] Offline cover search failed for ${filePath}:`,
            err.message
          );
        }
        return null;
      }
    };
    module2.exports = MetadataReader;
  }
});

// main/metadataWorker.js
var require_metadataWorker = __commonJS({
  "main/metadataWorker.js"(exports2, module2) {
    var { Worker } = require("worker_threads");
    var path = require("path");
    var MetadataWorker = class {
      constructor() {
        this._worker = null;
        this._taskId = 0;
        this._pending = /* @__PURE__ */ new Map();
        this._initPromise = null;
      }
      /**
       * Lazily initialize the worker thread.
       */
      _ensureWorker() {
        if (this._worker) return;
        this._worker = new Worker(path.join(__dirname, "metadataWorkerThread.js"), {
          workerData: { coverCacheDir: null }
        });
        this._worker.on("message", (msg) => {
          const pending = this._pending.get(msg.taskId);
          if (!pending) return;
          this._pending.delete(msg.taskId);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        });
        this._worker.on("error", (err) => {
          console.error("[MetadataWorker] Worker error:", err.message);
          for (const [id, { reject }] of this._pending) {
            reject(new Error(`Worker error: ${err.message}`));
          }
          this._pending.clear();
          this._worker = null;
        });
        this._worker.on("exit", (code) => {
          if (code !== 0) {
            console.warn(`[MetadataWorker] Worker exited with code ${code}`);
          }
          this._worker = null;
        });
      }
      /**
       * Set the cover cache directory for the worker.
       */
      setCoverCacheDir(dir) {
        this._ensureWorker();
        this._worker.postMessage({ type: "setCoverCacheDir", dir });
      }
      /**
       * Read full metadata from a file in the worker thread.
       * @param {string} filePath
       * @param {Map<string, string>} [knownArtists] - v1.1.5: Optional Map of
       *   lowercased artist names -> original-cased names. Serialized as a plain
       *   object for postMessage (Maps don't survive structured clone reliably),
       *   then rehydrated as a Map in the worker thread.
       * @returns {Promise<Object>}
       */
      readMetadata(filePath, knownArtists) {
        this._ensureWorker();
        const taskId = ++this._taskId;
        let knownArtistsObj = null;
        if (knownArtists && knownArtists.size > 0) {
          knownArtistsObj = {};
          for (const [k, v] of knownArtists) {
            knownArtistsObj[k] = v;
          }
        }
        return new Promise((resolve, reject) => {
          this._pending.set(taskId, { resolve, reject });
          this._worker.postMessage({
            type: "readMetadata",
            filePath,
            taskId,
            knownArtists: knownArtistsObj
          });
        });
      }
      /**
       * Read quick info (duration, bitrate) from a file in the worker thread.
       * @param {string} filePath
       * @returns {Promise<Object>}
       */
      readQuickInfo(filePath) {
        this._ensureWorker();
        const taskId = ++this._taskId;
        return new Promise((resolve, reject) => {
          this._pending.set(taskId, { resolve, reject });
          this._worker.postMessage({ type: "readQuickInfo", filePath, taskId });
        });
      }
      /**
       * Shut down the worker thread.
       */
      shutdown() {
        if (this._worker) {
          this._worker.terminate();
          this._worker = null;
        }
        for (const [id, { reject }] of this._pending) {
          reject(new Error("Worker shutdown"));
        }
        this._pending.clear();
      }
    };
    module2.exports = MetadataWorker;
  }
});

// main/manifestReader.js
var require_manifestReader = __commonJS({
  "main/manifestReader.js"(exports2, module2) {
    "use strict";
    var MAGIC = "NOVA-MFT";
    var VERSION = 1;
    var HEADER_SIZE = 64;
    var RECORD_SIZE = 128;
    var HASH_EMPTY = 4294967295;
    var FLAG_HAS_THUMBHASHES = 1;
    var FLAG_HAS_SORT_ORDERS = 2;
    var FLAG_SEALED = 4;
    var FORMAT_ENUM = {
      UNKNOWN: 0,
      MP3: 1,
      FLAC: 2,
      WAV: 3,
      OGG: 4,
      M4A: 5,
      AAC: 6,
      OPUS: 7,
      WMA: 8,
      APE: 9,
      WV: 10,
      TTA: 11,
      MPC: 12
    };
    var FORMAT_ENUM_REVERSE = {};
    for (const [k, v] of Object.entries(FORMAT_ENUM))
      FORMAT_ENUM_REVERSE[v] = k;
    var SORT_ORDERS = [
      "sortTitleAsc",
      "sortDateAddedDesc",
      "sortAlbumAsc",
      "sortArtistAsc"
    ];
    var _CRC_TABLE = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
          c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })();
    function crc32(buf, byteOffset, byteLength) {
      let c = 4294967295;
      const end = byteOffset + byteLength;
      for (let i = byteOffset; i < end; i++)
        c = _CRC_TABLE[(c ^ buf[i]) & 255] ^ c >>> 8;
      return (c ^ 4294967295) >>> 0;
    }
    function fnv1a(str) {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return h >>> 0;
    }
    function normalizePath(p) {
      if (!p) return "";
      return p.replace(/\\/g, "/").toLowerCase();
    }
    var _dv = (buf) => buf instanceof ArrayBuffer ? new DataView(buf) : buf instanceof Uint8Array ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength) : new DataView(buf);
    function readU16(dv, off) {
      return dv.getUint16(off, true);
    }
    function readU32(dv, off) {
      return dv.getUint32(off, true);
    }
    function readU64(dv, off) {
      const lo = dv.getUint32(off, true);
      const hi = dv.getUint32(off + 4, true);
      return hi * 4294967296 + lo;
    }
    function readF32(dv, off) {
      return dv.getFloat32(off, true);
    }
    function readU8(dv, off) {
      return dv.getUint8(off);
    }
    var ManifestReader = class {
      /**
       * @param {ArrayBuffer|Uint8Array|Buffer} buf
       */
      constructor(buf) {
        this._buf = buf;
        this._dv = _dv(buf);
        this._bytes = buf instanceof Uint8Array ? buf : buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        this.valid = false;
        this.error = null;
        this._sortCache = /* @__PURE__ */ new Map();
        this._decodeCache = /* @__PURE__ */ new Map();
        this._decodeCacheMax = 256;
        try {
          this._parseHeader();
          this.valid = true;
        } catch (err) {
          this.error = err.message || String(err);
        }
      }
      _parseHeader() {
        const dv = this._dv;
        if (this._bytes.byteLength < HEADER_SIZE)
          throw new Error("manifest: file too small");
        let magic = "";
        for (let i = 0; i < 8; i++)
          magic += String.fromCharCode(this._bytes[i]);
        if (magic !== MAGIC) throw new Error(`manifest: bad magic '${magic}'`);
        this.version = readU16(dv, 8);
        if (this.version !== VERSION)
          throw new Error(`manifest: unsupported version ${this.version}`);
        this.flags = readU16(dv, 10);
        this.createdAt = readU64(dv, 12);
        this.trackCount = readU32(dv, 20);
        this.fpHash = readU32(dv, 24);
        this.recordsOff = readU32(dv, 28);
        this.stringsOff = readU32(dv, 32);
        this.indexOff = readU32(dv, 36);
        this.sortOff = readU32(dv, 40);
        this.totalSize = readU32(dv, 44);
        if (this.totalSize !== this._bytes.byteLength)
          throw new Error(
            `manifest: size mismatch (header says ${this.totalSize}, file is ${this._bytes.byteLength})`
          );
        const expected = readU32(dv, 60);
        const actual = crc32(this._bytes, 0, 60);
        if (expected !== actual)
          throw new Error(`manifest: header CRC mismatch (got ${actual}, expected ${expected})`);
        if (!(this.flags & FLAG_SEALED))
          throw new Error("manifest: not sealed (write was incomplete)");
      }
      // ─── String pool ────────────────────────────────────────────────
      _readString(off, len) {
        if (len === 0) return "";
        if (typeof Buffer !== "undefined" && this._bytes instanceof Buffer) {
          return this._bytes.toString("utf8", off, off + len);
        }
        if (!this._td) this._td = new TextDecoder("utf-8");
        return this._td.decode(this._bytes.subarray(off, off + len));
      }
      _readId(recordOff) {
        let s = "";
        for (let i = 0; i < 16; i++)
          s += String.fromCharCode(this._bytes[recordOff + i]);
        return s;
      }
      // ─── Public API ─────────────────────────────────────────────────
      get headerInfo() {
        return {
          version: this.version,
          flags: this.flags,
          createdAt: this.createdAt,
          trackCount: this.trackCount,
          fpHash: this.fpHash,
          hasThumbhashes: !!(this.flags & FLAG_HAS_THUMBHASHES),
          hasSortOrders: !!(this.flags & FLAG_HAS_SORT_ORDERS)
        };
      }
      /**
       * Decode one record into a track object (same shape as the old
       * SQLite JSON rows — drop-in for the renderer).
       * @param {number} recordIdx  0..trackCount-1
       * @returns {Object|null}
       */
      getTrackAt(recordIdx) {
        if (recordIdx < 0 || recordIdx >= this.trackCount) return null;
        const cached = this._decodeCache.get(recordIdx);
        if (cached) return cached;
        const off = this.recordsOff + recordIdx * RECORD_SIZE;
        const dv = this._dv;
        const bytes = this._bytes;
        const id = this._readId(off);
        const filePath = this._readString(
          readU32(dv, off + 16),
          readU32(dv, off + 20)
        );
        const fileName = this._readString(
          readU32(dv, off + 24),
          readU32(dv, off + 28)
        );
        const title = this._readString(
          readU32(dv, off + 32),
          readU32(dv, off + 36)
        );
        const artist = this._readString(
          readU32(dv, off + 40),
          readU32(dv, off + 44)
        );
        const album = this._readString(
          readU32(dv, off + 48),
          readU32(dv, off + 52)
        );
        const albumArtist = this._readString(
          readU32(dv, off + 56),
          readU32(dv, off + 60)
        );
        const genre = this._readString(
          readU32(dv, off + 64),
          readU32(dv, off + 68)
        );
        const thumbHashOff = readU32(dv, off + 72);
        const thumbHashLen = readU16(dv, off + 76);
        const thumbHash = thumbHashOff === 0 ? null : this._readString(thumbHashOff, thumbHashLen);
        const track = {
          id,
          filePath,
          fileName,
          title,
          artist,
          album,
          albumArtist,
          genre,
          year: readU16(dv, off + 78),
          trackNumber: readU16(dv, off + 80),
          discNumber: readU16(dv, off + 82),
          duration: readF32(dv, off + 84),
          bitrate: readU32(dv, off + 88),
          sampleRate: readU32(dv, off + 92),
          channels: readU8(dv, off + 96),
          format: FORMAT_ENUM_REVERSE[readU8(dv, off + 97)] || "UNKNOWN",
          _hasCoverArt: readU8(dv, off + 98) === 1,
          _thumbHash: thumbHash,
          fileSize: readU64(dv, off + 100),
          dateAdded: readU64(dv, off + 108),
          dateModified: readU64(dv, off + 116)
        };
        if (this._decodeCache.size >= this._decodeCacheMax) {
          const firstKey = this._decodeCache.keys().next().value;
          this._decodeCache.delete(firstKey);
        }
        this._decodeCache.set(recordIdx, track);
        return track;
      }
      /**
       * Decode a range of records. Use this to render the visible viewport.
       * @param {number} start
       * @param {number} count
       * @param {string} [sortOrder]  one of SORT_ORDERS (default: physical order)
       * @returns {Object[]}
       */
      getTracksRange(start, count, sortOrder) {
        if (start < 0) start = 0;
        if (start >= this.trackCount) return [];
        if (count <= 0) return [];
        if (start + count > this.trackCount) count = this.trackCount - start;
        const out = new Array(count);
        if (sortOrder && SORT_ORDERS.includes(sortOrder)) {
          const order = this._getSortArray(sortOrder);
          for (let i = 0; i < count; i++)
            out[i] = this.getTrackAt(order[start + i]);
        } else {
          for (let i = 0; i < count; i++)
            out[i] = this.getTrackAt(start + i);
        }
        return out;
      }
      /**
       * Decode ALL tracks. Use sparingly — defeats the lazy-decode purpose.
       * Mainly for compatibility with code paths that expect a flat array.
       * @param {string} [sortOrder]
       * @returns {Object[]}
       */
      getAllTracks(sortOrder) {
        return this.getTracksRange(0, this.trackCount, sortOrder);
      }
      /**
       * O(log n) lookup by id — records are sorted by id at write time.
       * @param {string} id
       * @returns {Object|null}
       */
      findById(id) {
        if (!id || id.length !== 16) return null;
        let lo = 0;
        let hi = this.trackCount - 1;
        while (lo <= hi) {
          const mid = lo + hi >>> 1;
          const midOff = this.recordsOff + mid * RECORD_SIZE;
          let midId = "";
          for (let i = 0; i < 16; i++)
            midId += String.fromCharCode(this._bytes[midOff + i]);
          if (midId === id) return this.getTrackAt(mid);
          if (midId < id) lo = mid + 1;
          else hi = mid - 1;
        }
        return null;
      }
      /**
       * O(1) amortized lookup by filePath via the open-addressing hash table.
       * @param {string} filePath
       * @returns {Object|null}
       */
      findByFilePath(filePath) {
        if (!filePath) return null;
        const key = normalizePath(filePath);
        const h = fnv1a(key);
        const slotCount = this._hashSlotCount();
        if (slotCount === 0) return null;
        let slot = h & slotCount - 1;
        const dv = this._dv;
        for (let probe = 0; probe < slotCount; probe++) {
          const slotOff = this.indexOff + slot * 4;
          const recordIdx = readU32(dv, slotOff);
          if (recordIdx === HASH_EMPTY) return null;
          const recOff = this.recordsOff + recordIdx * RECORD_SIZE;
          const fpOff = readU32(dv, recOff + 16);
          const fpLen = readU32(dv, recOff + 20);
          const candidate = normalizePath(this._readString(fpOff, fpLen));
          if (candidate === key) return this.getTrackAt(recordIdx);
          slot = slot + 1 & slotCount - 1;
        }
        return null;
      }
      _hashSlotCount() {
        if (!this.indexOff) return 0;
        if (this.sortOff) return Math.floor((this.sortOff - this.indexOff) / 4);
        return Math.floor((this.totalSize - this.indexOff) / 4);
      }
      /**
       * Get a pre-computed sort order as a Uint32Array of record indices.
       * Returns null if sort orders aren't present in this manifest.
       */
      _getSortArray(name) {
        if (!(this.flags & FLAG_HAS_SORT_ORDERS)) return null;
        const cached = this._sortCache.get(name);
        if (cached) return cached;
        const idx = SORT_ORDERS.indexOf(name);
        if (idx < 0) return null;
        const arrOff = readU32(this._dv, this.sortOff + idx * 8);
        const arrCount = readU32(this._dv, this.sortOff + idx * 8 + 4);
        if (arrCount === 0 || arrOff === 0) return null;
        const view = new Uint32Array(
          this._bytes.buffer,
          this._bytes.byteOffset + arrOff,
          arrCount
        );
        this._sortCache.set(name, view);
        return view;
      }
      /**
       * Returns a sorted range — same as getTracksRange but uses a named
       * sort order. If the manifest doesn't have sort orders, falls back
       * to physical order (caller should re-sort if needed).
       */
      getSortedRange(name, start, count) {
        return this.getTracksRange(start, count, name);
      }
      /**
       * Returns the full sort order as a Uint32Array (zero-copy view).
       * Useful when the renderer wants to do its own slicing.
       */
      getSortOrder(name) {
        return this._getSortArray(name);
      }
      /**
       * Returns the list of sort order names present in this manifest.
       */
      getAvailableSortOrders() {
        if (!(this.flags & FLAG_HAS_SORT_ORDERS)) return [];
        return SORT_ORDERS.filter((n) => this._getSortArray(n) !== null);
      }
      /**
       * Drop the decode cache — call after the manifest is invalidated
       * (e.g. background scan completed and the renderer fetched a new
       * ArrayBuffer).
       */
      invalidateCache() {
        this._decodeCache.clear();
        this._sortCache.clear();
      }
    };
    ManifestReader.MAGIC = MAGIC;
    ManifestReader.VERSION = VERSION;
    ManifestReader.HEADER_SIZE = HEADER_SIZE;
    ManifestReader.RECORD_SIZE = RECORD_SIZE;
    ManifestReader.HASH_EMPTY = HASH_EMPTY;
    ManifestReader.FLAG_HAS_THUMBHASHES = FLAG_HAS_THUMBHASHES;
    ManifestReader.FLAG_HAS_SORT_ORDERS = FLAG_HAS_SORT_ORDERS;
    ManifestReader.FLAG_SEALED = FLAG_SEALED;
    ManifestReader.FORMAT_ENUM = FORMAT_ENUM;
    ManifestReader.SORT_ORDERS = SORT_ORDERS;
    ManifestReader.crc32 = crc32;
    ManifestReader.fnv1a = fnv1a;
    ManifestReader.normalizePath = normalizePath;
    module2.exports = ManifestReader;
  }
});

// main/manifest.js
var require_manifest = __commonJS({
  "main/manifest.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path = require("path");
    var ManifestReader = require_manifestReader();
    var {
      MAGIC,
      VERSION,
      HEADER_SIZE,
      RECORD_SIZE,
      HASH_EMPTY,
      FLAG_HAS_THUMBHASHES,
      FLAG_HAS_SORT_ORDERS,
      FLAG_SEALED,
      FORMAT_ENUM,
      SORT_ORDERS,
      crc32,
      fnv1a,
      normalizePath
    } = ManifestReader;
    function nextPow2(n) {
      let p = 1;
      while (p < n) p <<= 1;
      return p;
    }
    function formatToEnum(formatStr) {
      if (!formatStr) return 0;
      const up = String(formatStr).toUpperCase();
      return FORMAT_ENUM[up] || 0;
    }
    function normalizeId(id) {
      if (!id) return "0000000000000000";
      let s = String(id);
      if (s.length > 16) s = s.substring(0, 16);
      else if (s.length < 16) s = s.padEnd(16, "0");
      return s;
    }
    var StringPool = class {
      /**
       * @param {number} baseOffset  Absolute offset in the file where the
       *   string pool will be written (i.e. recordsOff + recordsBuf.length).
       *   We need this because records reference strings by ABSOLUTE offset,
       *   and the string pool's location isn't known until we've sized the
       *   records section — which happens BEFORE we add strings.
       *
       * Workaround: compute baseOffset up front (it's deterministic:
       *   HEADER_SIZE + trackCount * RECORD_SIZE) and pass it in.
       */
      constructor(baseOffset) {
        this.baseOffset = baseOffset;
        this.chunks = [];
        this.totalLen = 0;
        this.dedup = /* @__PURE__ */ new Map();
      }
      /**
       * Add a string and return its (offset, length).
       * Empty strings get offset 0 length 0 (we never legitimately point
       * at byte 0 of the file because the header sits there; readers
       * interpret offset 0 length 0 as "empty" — and for thumbhash,
       * offset 0 means "no thumbhash").
       */
      add(str) {
        if (!str) return { off: 0, len: 0 };
        const s = String(str);
        const cached = this.dedup.get(s);
        if (cached) return cached;
        const off = this.baseOffset + this.totalLen;
        const buf = Buffer.from(s, "utf8");
        const len = buf.length;
        this.chunks.push(buf);
        this.totalLen += len;
        const entry = { off, len };
        this.dedup.set(s, entry);
        return entry;
      }
      toBuffer() {
        if (this.chunks.length === 0) return Buffer.alloc(0);
        return Buffer.concat(this.chunks, this.totalLen);
      }
    };
    var ManifestWriter = class _ManifestWriter {
      /**
       * Build the manifest Buffer from an array of track objects.
       * Does NOT write to disk — caller can use writeManifest() for that.
       *
       * @param {Object[]} tracks  Array of track objects (same shape as SQLite rows)
       * @param {Object}  [opts]
       * @param {string}  [opts.folderFingerprint]  Folder fingerprint string (hash is stored)
       * @returns {Buffer}
       */
      static build(tracks, opts = {}) {
        const trackCount = tracks.length;
        const recordsOff = HEADER_SIZE;
        const stringsBaseOffset = recordsOff + trackCount * RECORD_SIZE;
        const pool = new StringPool(stringsBaseOffset);
        const sorted = tracks.slice().sort((a, b) => {
          const ai = normalizeId(a.id);
          const bi = normalizeId(b.id);
          return ai < bi ? -1 : ai > bi ? 1 : 0;
        });
        const recordsBuf = Buffer.alloc(trackCount * RECORD_SIZE);
        let hasThumbhashes = false;
        for (let i = 0; i < trackCount; i++) {
          const t = sorted[i];
          const off = i * RECORD_SIZE;
          const id = normalizeId(t.id);
          recordsBuf.write(id, off, 16, "ascii");
          const fp = pool.add(t.filePath || "");
          recordsBuf.writeUInt32LE(fp.off, off + 16);
          recordsBuf.writeUInt32LE(fp.len, off + 20);
          const fn = pool.add(t.fileName || "");
          recordsBuf.writeUInt32LE(fn.off, off + 24);
          recordsBuf.writeUInt32LE(fn.len, off + 28);
          const ti = pool.add(t.title || "");
          recordsBuf.writeUInt32LE(ti.off, off + 32);
          recordsBuf.writeUInt32LE(ti.len, off + 36);
          const ar = pool.add(t.artist || "");
          recordsBuf.writeUInt32LE(ar.off, off + 40);
          recordsBuf.writeUInt32LE(ar.len, off + 44);
          const al = pool.add(t.album || "");
          recordsBuf.writeUInt32LE(al.off, off + 48);
          recordsBuf.writeUInt32LE(al.len, off + 52);
          const aa = pool.add(t.albumArtist || "");
          recordsBuf.writeUInt32LE(aa.off, off + 56);
          recordsBuf.writeUInt32LE(aa.len, off + 60);
          const ge = pool.add(t.genre || "");
          recordsBuf.writeUInt32LE(ge.off, off + 64);
          recordsBuf.writeUInt32LE(ge.len, off + 68);
          if (t._thumbHash) {
            const th = pool.add(t._thumbHash);
            recordsBuf.writeUInt32LE(th.off, off + 72);
            recordsBuf.writeUInt16LE(Math.min(th.len, 65535), off + 76);
            hasThumbhashes = true;
          } else {
            recordsBuf.writeUInt32LE(0, off + 72);
            recordsBuf.writeUInt16LE(0, off + 76);
          }
          recordsBuf.writeUInt16LE(Math.min(t.year || 0, 65535), off + 78);
          recordsBuf.writeUInt16LE(Math.min(t.trackNumber || 0, 65535), off + 80);
          recordsBuf.writeUInt16LE(Math.min(t.discNumber || 0, 65535), off + 82);
          recordsBuf.writeFloatLE(Number(t.duration) || 0, off + 84);
          recordsBuf.writeUInt32LE(Math.min(t.bitrate || 0, 4294967295), off + 88);
          recordsBuf.writeUInt32LE(
            Math.min(t.sampleRate || 0, 4294967295),
            off + 92
          );
          recordsBuf.writeUInt8(Math.min(t.channels || 2, 255), off + 96);
          recordsBuf.writeUInt8(formatToEnum(t.format), off + 97);
          recordsBuf.writeUInt8(t._hasCoverArt || t.coverArt ? 1 : 0, off + 98);
          recordsBuf.writeUInt8(0, off + 99);
          writeU64LE(
            recordsBuf,
            off + 100,
            Math.min(t.fileSize || 0, Number.MAX_SAFE_INTEGER)
          );
          writeU64LE(
            recordsBuf,
            off + 108,
            Math.min(t.dateAdded || 0, Number.MAX_SAFE_INTEGER)
          );
          writeU64LE(
            recordsBuf,
            off + 116,
            Math.min(t.dateModified || 0, Number.MAX_SAFE_INTEGER)
          );
        }
        const slotCount = trackCount === 0 ? 16 : nextPow2(trackCount * 2);
        const slotMask = slotCount - 1;
        const indexBuf = Buffer.alloc(slotCount * 4, 255);
        for (let i = 0; i < trackCount; i++) {
          const t = sorted[i];
          const key = normalizePath(t.filePath || t.id || String(i));
          let slot = fnv1a(key) & slotMask;
          while (indexBuf.readUInt32LE(slot * 4) !== HASH_EMPTY)
            slot = slot + 1 & slotMask;
          indexBuf.writeUInt32LE(i, slot * 4);
        }
        const sortTitleAsc = buildSortIndices(sorted, (a, b) => {
          const ta = (a.title || "").toLowerCase();
          const tb = (b.title || "").toLowerCase();
          return ta < tb ? -1 : ta > tb ? 1 : 0;
        });
        const sortDateAddedDesc = buildSortIndices(sorted, (a, b) => {
          const da = a.dateAdded || 0;
          const db = b.dateAdded || 0;
          if (db !== da) return db - da;
          const ta = (a.title || "").toLowerCase();
          const tb = (b.title || "").toLowerCase();
          return ta < tb ? -1 : ta > tb ? 1 : 0;
        });
        const sortAlbumAsc = buildSortIndices(sorted, (a, b) => {
          const aa = (a.album || "").toLowerCase();
          const bb = (b.album || "").toLowerCase();
          if (aa !== bb) return aa < bb ? -1 : 1;
          const da = a.discNumber || 0;
          const db = b.discNumber || 0;
          if (da !== db) return da - db;
          return (a.trackNumber || 0) - (b.trackNumber || 0);
        });
        const sortArtistAsc = buildSortIndices(sorted, (a, b) => {
          const aa = (a.artist || "").toLowerCase();
          const bb = (b.artist || "").toLowerCase();
          if (aa !== bb) return aa < bb ? -1 : 1;
          const la = (a.album || "").toLowerCase();
          const lb = (b.album || "").toLowerCase();
          if (la !== lb) return la < lb ? -1 : 1;
          const da = a.discNumber || 0;
          const db = b.discNumber || 0;
          if (da !== db) return da - db;
          return (a.trackNumber || 0) - (b.trackNumber || 0);
        });
        const stringsOffPrecomputed = recordsOff + recordsBuf.length;
        const indexOffPrecomputed = stringsOffPrecomputed + pool.totalLen;
        const sortOffPrecomputed = indexOffPrecomputed + indexBuf.length;
        const sortArraysStart = sortOffPrecomputed + 32;
        const sortHeaderBuf = Buffer.alloc(32);
        const sortArrays = [
          sortTitleAsc,
          sortDateAddedDesc,
          sortAlbumAsc,
          sortArtistAsc
        ];
        const sortArraysBuf = Buffer.alloc(trackCount * 4 * 4);
        for (let i = 0; i < 4; i++) {
          const absOff = sortArraysStart + i * trackCount * 4;
          sortHeaderBuf.writeUInt32LE(absOff, i * 8);
          sortHeaderBuf.writeUInt32LE(trackCount, i * 8 + 4);
          for (let j = 0; j < trackCount; j++)
            sortArraysBuf.writeUInt32LE(
              sortArrays[i][j],
              i * trackCount * 4 + j * 4
            );
        }
        const headerBuf = Buffer.alloc(HEADER_SIZE, 0);
        const stringsPadding = (4 - pool.totalLen % 4) % 4;
        const stringsBuf = pool.totalLen === 0 ? Buffer.alloc(0) : Buffer.concat([pool.toBuffer(), Buffer.alloc(stringsPadding)]);
        const stringsOff = stringsOffPrecomputed;
        const indexOff = indexOffPrecomputed + stringsPadding;
        const sortOff = sortOffPrecomputed + stringsPadding;
        for (let i = 0; i < 4; i++) {
          const oldOff = sortHeaderBuf.readUInt32LE(i * 8);
          sortHeaderBuf.writeUInt32LE(oldOff + stringsPadding, i * 8);
        }
        const totalSize = sortOff + sortHeaderBuf.length + sortArraysBuf.length;
        const fpHash = opts.folderFingerprint ? fnv1a(String(opts.folderFingerprint)) : 0;
        let flags = 0;
        if (hasThumbhashes) flags |= FLAG_HAS_THUMBHASHES;
        flags |= FLAG_HAS_SORT_ORDERS;
        headerBuf.write(MAGIC, 0, 8, "ascii");
        headerBuf.writeUInt16LE(VERSION, 8);
        headerBuf.writeUInt16LE(flags, 10);
        writeU64LE(headerBuf, 12, Date.now());
        headerBuf.writeUInt32LE(trackCount, 20);
        headerBuf.writeUInt32LE(fpHash, 24);
        headerBuf.writeUInt32LE(recordsOff, 28);
        headerBuf.writeUInt32LE(stringsOff, 32);
        headerBuf.writeUInt32LE(indexOff, 36);
        headerBuf.writeUInt32LE(sortOff, 40);
        headerBuf.writeUInt32LE(totalSize, 44);
        const file = Buffer.concat(
          [
            headerBuf,
            recordsBuf,
            stringsBuf,
            indexBuf,
            sortHeaderBuf,
            sortArraysBuf
          ],
          totalSize
        );
        const finalFlags = flags | FLAG_SEALED;
        file.writeUInt16LE(finalFlags, 10);
        const crc = crc32(file, 0, 60);
        file.writeUInt32LE(crc, 60);
        return file;
      }
      /**
       * Write the manifest atomically (temp file + rename).
       *
       * @param {string} filePath  Target path (e.g. .../userData/library.bin)
       * @param {Object[]} tracks
       * @param {Object} [opts]
       * @param {string} [opts.folderFingerprint]
       * @returns {Promise<{ size:number, trackCount:number, ms:number }>}
       */
      static async write(filePath, tracks, opts = {}) {
        const start = Date.now();
        const buf = _ManifestWriter.build(tracks, opts);
        const tmpPath = filePath + ".tmp." + process.pid;
        await fs.promises.writeFile(tmpPath, buf);
        try {
          await fs.promises.rename(tmpPath, filePath);
        } catch (err) {
          try {
            await fs.promises.unlink(filePath);
          } catch (_) {
          }
          await fs.promises.rename(tmpPath, filePath);
        }
        return {
          size: buf.length,
          trackCount: tracks.length,
          ms: Date.now() - start
        };
      }
      /**
       * Synchronous version for cases where the caller is already on a
       * worker thread or explicitly wants to block (e.g. during app quit).
       */
      static writeSync(filePath, tracks, opts = {}) {
        const start = Date.now();
        const buf = _ManifestWriter.build(tracks, opts);
        const tmpPath = filePath + ".tmp." + process.pid;
        fs.writeFileSync(tmpPath, buf);
        try {
          fs.renameSync(tmpPath, filePath);
        } catch (err) {
          try {
            fs.unlinkSync(filePath);
          } catch (_) {
          }
          fs.renameSync(tmpPath, filePath);
        }
        return {
          size: buf.length,
          trackCount: tracks.length,
          ms: Date.now() - start
        };
      }
    };
    function writeU64LE(buf, offset, value) {
      const v = Math.max(0, Math.min(value, Number.MAX_SAFE_INTEGER));
      const lo = v >>> 0;
      const hi = Math.floor(v / 4294967296) >>> 0;
      buf.writeUInt32LE(lo, offset);
      buf.writeUInt32LE(hi, offset + 4);
    }
    function buildSortIndices(records, comparator) {
      const n = records.length;
      const indices = new Uint32Array(n);
      for (let i = 0; i < n; i++) indices[i] = i;
      const tmp = Array.from(indices);
      tmp.sort((a, b) => comparator(records[a], records[b]));
      for (let i = 0; i < n; i++) indices[i] = tmp[i];
      return indices;
    }
    module2.exports = ManifestWriter;
  }
});

// main/manifestIPC.js
var require_manifestIPC = __commonJS({
  "main/manifestIPC.js"(exports2, module2) {
    "use strict";
    var { ipcMain, app } = require("electron");
    var fs = require("fs");
    var path = require("path");
    var ManifestWriter = require_manifest();
    var ManifestReader = require_manifestReader();
    var _manifestPath = null;
    var _manifestBuf = null;
    var _manifestInfo = null;
    var _lastRebuildAt = 0;
    var _featureFlagEnabled = true;
    function setFeatureFlag(enabled) {
      _featureFlagEnabled = !!enabled;
    }
    function isFeatureFlagEnabled() {
      return _featureFlagEnabled;
    }
    function _resolvePath() {
      if (_manifestPath) return _manifestPath;
      const dataDir = app.getPath("userData");
      _manifestPath = path.join(dataDir, "library.bin");
      return _manifestPath;
    }
    function _loadBuffer() {
      const p = _resolvePath();
      try {
        if (!fs.existsSync(p)) return null;
        const buf = fs.readFileSync(p);
        const reader = new ManifestReader(buf);
        if (!reader.valid) {
          console.warn("[manifest] cached file failed validation:", reader.error);
          return null;
        }
        _manifestBuf = buf;
        _manifestInfo = reader.headerInfo;
        _manifestInfo.size = buf.length;
        _manifestInfo.ms = 0;
        return buf;
      } catch (err) {
        console.warn("[manifest] load failed:", err.message);
        return null;
      }
    }
    function getManifestInfo() {
      if (!_manifestBuf) _loadBuffer();
      if (!_manifestBuf) {
        return { available: false, reason: "missing-or-corrupt" };
      }
      return {
        available: true,
        path: _manifestPath,
        ..._manifestInfo
      };
    }
    function getManifestArrayBuffer() {
      if (!_manifestBuf) _loadBuffer();
      if (!_manifestBuf) return null;
      return _manifestBuf.buffer.slice(
        _manifestBuf.byteOffset,
        _manifestBuf.byteOffset + _manifestBuf.byteLength
      );
    }
    async function rebuildManifest(tracks, folderFingerprint) {
      const p = _resolvePath();
      try {
        const result = await ManifestWriter.write(p, tracks || [], {
          folderFingerprint
        });
        _manifestBuf = null;
        _manifestInfo = null;
        _lastRebuildAt = Date.now();
        console.log(
          `[manifest] rebuilt: ${result.trackCount} tracks, ${result.size} bytes, ${result.ms}ms`
        );
        return { ok: true, ...result };
      } catch (err) {
        console.error("[manifest] rebuild failed:", err.message);
        return { ok: false, error: err.message, ms: 0, size: 0, trackCount: 0 };
      }
    }
    function rebuildManifestSync(tracks, folderFingerprint) {
      const p = _resolvePath();
      try {
        const result = ManifestWriter.writeSync(p, tracks || [], {
          folderFingerprint
        });
        _manifestBuf = null;
        _manifestInfo = null;
        _lastRebuildAt = Date.now();
        return { ok: true, ...result };
      } catch (err) {
        console.error("[manifest] sync rebuild failed:", err.message);
        return { ok: false, error: err.message };
      }
    }
    function invalidateCache() {
      _manifestBuf = null;
      _manifestInfo = null;
    }
    function deleteManifest() {
      const p = _resolvePath();
      _manifestBuf = null;
      _manifestInfo = null;
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
        return true;
      } catch (err) {
        console.warn("[manifest] delete failed:", err.message);
        return false;
      }
    }
    function registerManifestIPC() {
      ipcMain.handle("library:get-manifest-info", async () => {
        if (!_featureFlagEnabled) {
          return { available: false, reason: "feature-disabled" };
        }
        return getManifestInfo();
      });
      ipcMain.handle(
        "library:get-manifest-buffer",
        async (event, { transfer } = {}) => {
          if (!_featureFlagEnabled) {
            return { success: false, reason: "feature-disabled" };
          }
          const ab = getManifestArrayBuffer();
          if (!ab) {
            return { success: false, reason: "missing-or-corrupt" };
          }
          if (transfer === false) {
            return { success: true, buffer: ab };
          }
          return { success: true, buffer: ab };
        }
      );
      ipcMain.handle("library:rebuild-manifest", async (event, opts = {}) => {
        let tracks = opts.tracks;
        if (!tracks) {
          try {
            const ipcModule = require_ipc();
            if (typeof ipcModule.getLibraryForManifest === "function") {
              tracks = ipcModule.getLibraryForManifest();
            }
          } catch (err) {
            console.warn("[manifest] rebuild: could not get library:", err.message);
            return { ok: false, error: "library-unavailable" };
          }
        }
        if (!tracks) {
          return { ok: false, error: "library-empty" };
        }
        return rebuildManifest(tracks, opts.folderFingerprint);
      });
    }
    module2.exports = {
      registerManifestIPC,
      setFeatureFlag,
      isFeatureFlagEnabled,
      getManifestInfo,
      getManifestArrayBuffer,
      rebuildManifest,
      rebuildManifestSync,
      invalidateCache,
      deleteManifest
    };
  }
});

// package.json
var require_package = __commonJS({
  "package.json"(exports2, module2) {
    module2.exports = {
      name: "novatune",
      version: "1.1.1",
      description: "NovaTune \u2014 A premium Windows music player with Spotify-dark aesthetics",
      main: "main/main.bundle.js",
      scripts: {
        "build:main": "node esbuild.main.config.js",
        start: "npm run build:main && electron .",
        dev: "electron .",
        build: "npm run build:main && electron-builder --win --config electron.config.js",
        "build:portable": "npm run build:main && electron-builder --win portable",
        test: "jest NovaTune.Tests/"
      },
      author: "NovaTune",
      license: "MIT",
      devDependencies: {
        electron: "^28.1.0",
        "electron-builder": "^24.9.1",
        esbuild: "^0.28.1",
        jest: "^29.7.0"
      },
      dependencies: {
        "better-sqlite3": "^12.10.0",
        chokidar: "^3.5.3",
        "electron-updater": "^6.8.9",
        "music-metadata": "^11.13.0",
        "node-id3": "^0.2.9",
        "node-vibrant": "^4.0.4",
        sharp: "^0.34.5",
        "v8-compile-cache": "^2.4.0"
      },
      build: {
        appId: "com.novatune.player",
        productName: "NovaTune",
        publish: {
          provider: "github",
          owner: "AnonymousV73X",
          repo: "WINDOWS-MUSIC-PLAYER"
        },
        win: {
          target: "nsis",
          icon: "assets/icons/icon.ico"
        },
        nsis: {
          oneClick: false,
          allowToChangeInstallationDirectory: true,
          installerIcon: "assets/icons/icon.ico",
          differentialPackage: true
        },
        files: [
          "main/**/*",
          "renderer/**/*",
          "assets/**/*",
          "package.json"
        ]
      }
    };
  }
});

// main/ipc.js
var require_ipc = __commonJS({
  "main/ipc.js"(exports2, module2) {
    var { ipcMain, dialog, shell, net, BrowserWindow, app } = require("electron");
    var fs = require("fs");
    var path = require("path");
    var crypto = require("crypto");
    var FileScanner = require_fileScanner();
    var MetadataReader = require_metadataReader();
    var MetadataWorker = require_metadataWorker();
    var { ensureDirSync } = require_windowManager();
    var ManifestWriter = require_manifest();
    var ManifestIPC = require_manifestIPC();
    var ManifestReader = require_manifestReader();
    var SUPPORTED_FORMATS = [
      ".mp3",
      ".flac",
      ".wav",
      ".ogg",
      ".m4a",
      ".aac",
      ".wma",
      ".opus",
      ".ape",
      ".wv",
      ".tta",
      ".mpc"
    ];
    var DATA_DIR;
    var PLAYLISTS_DIR;
    var LIBRARY_CACHE;
    var SETTINGS_FILE;
    var DB_FILE;
    var libraryCache = null;
    var _libraryDirty = false;
    var _libraryJsonCache = null;
    var libraryById = null;
    var playlistsCache = null;
    var DEFAULT_SETTINGS = {
      theme: "dark",
      accentColor: "#1DB954",
      volume: 0.5,
      // v1.1.0 — Volume persistence mode:
      //   "persist" → restore last-saved volume on launch (default; user explicit choice)
      //   "safe"    → revert to safeVolume on every launch (prevents loud restarts)
      volumePersistMode: "persist",
      // v1.1.0 — Safe volume used on launch when mode === "safe"
      safeVolume: 0.5,
      crossfadeDuration: 0,
      equalizer: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      repeatMode: "off",
      shuffle: false,
      showLyrics: false,
      visualizerStyle: "bars",
      scanFolders: [],
      sortOrder: "title",
      sortDirection: "asc",
      // v1.1.7 — Card sort settings for Albums / Artists / Playlists views.
      // Options: "songCountDesc" (most songs first), "songCountAsc" (fewest first),
      //          "alphaAsc" (A→Z), "alphaDesc" (Z→A),
      //          "dateAddedDesc" (newest first), "dateAddedAsc" (oldest first)
      cardSortMode: "alphaAsc",
      miniPlayer: false,
      alwaysOnTop: false,
      hardwareAcceleration: true,
      outputDevice: "default"
    };
    var db = null;
    var DB_SCHEMA = `
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    title TEXT,
    artist TEXT,
    album TEXT,
    genre TEXT,
    year INTEGER,
    duration REAL,
    dateAdded INTEGER,
    filePath TEXT UNIQUE,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tracks_title_v2 ON tracks(title COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_tracks_artist_v2 ON tracks(artist COLLATE NOCASE, title COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_tracks_album_v2 ON tracks(album COLLATE NOCASE, title COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_tracks_date_added_v2 ON tracks(dateAdded DESC, title COLLATE NOCASE);
  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    createdAt INTEGER,
    updatedAt INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_playlists_updated ON playlists(updatedAt DESC);
  CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlistId TEXT NOT NULL,
    trackId TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    addedAt INTEGER NOT NULL,
    PRIMARY KEY (playlistId, trackId)
  );
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlistId, position);
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(trackId);
  CREATE TABLE IF NOT EXISTS track_covers (
    trackId TEXT PRIMARY KEY,
    coverArt TEXT
  );
`;
    function readJSON(filePath, fallback = {}) {
      try {
        if (fs.existsSync(filePath)) {
          return JSON.parse(fs.readFileSync(filePath, "utf-8"));
        }
      } catch (err) {
        console.error(`Failed to read ${filePath}:`, err.message);
      }
      return fallback;
    }
    function writeJSON(filePath, data) {
      try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        return true;
      } catch (err) {
        console.error(`Failed to write ${filePath}:`, err.message);
        return false;
      }
    }
    var AUDIO_EXTENSIONS = /* @__PURE__ */ new Set([
      ".mp3",
      ".flac",
      ".wav",
      ".ogg",
      ".m4a",
      ".aac",
      ".opus",
      ".wma",
      ".aiff",
      ".ape",
      ".wv",
      ".mpc"
    ]);
    var _FP_MAX_CONCURRENT_DIRS = 8;
    var _FP_STAT_BATCH_SIZE = 16;
    var _FP_CACHE_TTL_MS = 60 * 1e3;
    var _fpCache = /* @__PURE__ */ new Map();
    async function _computeFolderFingerprint(folderPaths) {
      const cacheKey = folderPaths.slice().sort().join("|");
      const cached = _fpCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < _FP_CACHE_TTL_MS) {
        return cached.fp;
      }
      let fileCount = 0;
      let newestMtime = 0;
      const dirMtimes = /* @__PURE__ */ new Map();
      const prevDirMtimes = cached?.dirMtimes instanceof Map ? cached.dirMtimes : /* @__PURE__ */ new Map();
      const prevDirStats = cached?.dirStats instanceof Map ? cached.dirStats : /* @__PURE__ */ new Map();
      async function walk(dir) {
        let dirStat;
        try {
          dirStat = await fs.promises.stat(dir);
        } catch (_) {
          return;
        }
        const dirMtime = dirStat.mtimeMs;
        dirMtimes.set(dir, dirMtime);
        let entries;
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch (_) {
          return;
        }
        const dirs = [];
        const files = [];
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            dirs.push(full);
          } else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            files.push(full);
          }
        }
        const prevMtime = prevDirMtimes.get(dir);
        const prevStats = prevDirStats.get(dir);
        if (prevMtime === dirMtime && prevStats && prevStats.fileCount === files.length) {
          fileCount += prevStats.fileCount;
          if (prevStats.maxMtime > newestMtime) {
            newestMtime = prevStats.maxMtime;
          }
        } else if (files.length > 0) {
          let dirMaxMtime = 0;
          let dirFileCount = 0;
          for (let i = 0; i < files.length; i += _FP_STAT_BATCH_SIZE) {
            const batch = files.slice(i, i + _FP_STAT_BATCH_SIZE);
            const stats = await Promise.allSettled(
              batch.map((f) => fs.promises.stat(f))
            );
            for (const result of stats) {
              if (result.status === "fulfilled") {
                dirFileCount++;
                if (result.value.mtimeMs > dirMaxMtime) {
                  dirMaxMtime = result.value.mtimeMs;
                }
                if (result.value.mtimeMs > newestMtime) {
                  newestMtime = result.value.mtimeMs;
                }
              }
            }
          }
          fileCount += dirFileCount;
          prevDirStats.set(dir, { fileCount: dirFileCount, maxMtime: dirMaxMtime });
        }
        for (let i = 0; i < dirs.length; i += _FP_MAX_CONCURRENT_DIRS) {
          const batch = dirs.slice(i, i + _FP_MAX_CONCURRENT_DIRS);
          await Promise.all(batch.map((d) => walk(d)));
        }
      }
      for (const folder of folderPaths) {
        try {
          await fs.promises.access(folder);
          await walk(folder);
        } catch (_) {
        }
      }
      const fp = `${fileCount}:${Math.floor(newestMtime)}`;
      _fpCache.set(cacheKey, {
        fp,
        timestamp: Date.now(),
        dirMtimes,
        dirStats: prevDirStats
      });
      return fp;
    }
    function _maybeResetFailedFilesAtStartup() {
      try {
        const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
        let needsReset = false;
        let resetReason = "";
        if (!settings._failedFilesResetV115) {
          needsReset = true;
          resetReason = "v1.1.5 one-time reset";
        }
        if (!needsReset && (!settings._failedFilesLastRetry || Date.now() - settings._failedFilesLastRetry > 30 * 24 * 60 * 60 * 1e3)) {
          needsReset = true;
          resetReason = "30-day periodic re-check";
        }
        if (needsReset) {
          settings._failedFiles = {};
          settings._failedFilesResetV115 = true;
          settings._failedFilesLastRetry = Date.now();
          writeJSON(SETTINGS_FILE, settings);
          console.log(
            `[startup-reset] Cleared _failedFiles cache (${resetReason})`
          );
        }
        if (db) {
          try {
            const result = db.prepare("DELETE FROM tracks WHERE duration <= 0").run();
            if (result.changes > 0) {
              console.log(
                `[startup-reset] Deleted ${result.changes} tracks with duration <= 0 from SQLite (will be re-scanned with estimator)`
              );
              libraryCache = null;
              _libraryJsonCache = null;
              libraryById = null;
            }
          } catch (err) {
            console.warn(
              "[startup-reset] Failed to clean up 0-duration tracks:",
              err.message
            );
          }
        }
      } catch (err) {
        console.warn("[startup-reset] Failed:", err.message);
      }
    }
    function migrateJsonToDb() {
      const trackCount = db.prepare("SELECT COUNT(*) AS count FROM tracks").get().count;
      if (trackCount === 0 && fs.existsSync(LIBRARY_CACHE)) {
        const legacy = readJSON(LIBRARY_CACHE, []);
        if (Array.isArray(legacy) && legacy.length) saveLibrary(legacy);
      }
      const playlistCount = db.prepare("SELECT COUNT(*) AS count FROM playlists").get().count;
      if (playlistCount === 0 && fs.existsSync(PLAYLISTS_DIR)) {
        const files = fs.readdirSync(PLAYLISTS_DIR).filter((f) => f.endsWith(".json"));
        for (const file of files) {
          const data = readJSON(path.join(PLAYLISTS_DIR, file), {});
          if (!data) continue;
          savePlaylist({
            id: data.id || path.basename(file, ".json"),
            name: data.name || "Unnamed Playlist",
            tracks: Array.isArray(data.tracks) ? data.tracks : [],
            createdAt: data.createdAt || Date.now(),
            updatedAt: data.updatedAt || Date.now()
          });
        }
      }
    }
    function migrateDbCovers() {
      try {
        const rows = db.prepare("SELECT id, data FROM tracks").all();
        let migratedCount = 0;
        let needsMigration = false;
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
          const track = JSON.parse(rows[i].data);
          if (track.coverArt) {
            needsMigration = true;
            break;
          }
        }
        if (!needsMigration) return;
        console.log(
          `[database:migration] Migrating cover art for ${rows.length} tracks...`
        );
        const updateTrack = db.prepare("UPDATE tracks SET data = ? WHERE id = ?");
        const insertCover = db.prepare(
          "INSERT OR REPLACE INTO track_covers (trackId, coverArt) VALUES (?, ?)"
        );
        const tx = db.transaction(() => {
          for (const row of rows) {
            try {
              const track = JSON.parse(row.data);
              if (track.coverArt) {
                const coverArt = track.coverArt;
                const { coverArt: _, ...strippedTrack } = track;
                strippedTrack._hasCoverArt = true;
                updateTrack.run(JSON.stringify(strippedTrack), row.id);
                insertCover.run(row.id, coverArt);
                migratedCount++;
              }
            } catch (_) {
            }
          }
        });
        tx();
        console.log(
          `[database:migration] Successfully migrated ${migratedCount} cover arts to track_covers table.`
        );
      } catch (err) {
        console.error("[database:migration] Migration failed:", err.message);
      }
    }
    function getLibrary() {
      if (!libraryCache) {
        if (_libraryJsonCache && !_libraryDirty) {
          libraryCache = _libraryJsonCache;
        } else {
          libraryCache = db.prepare(
            "SELECT data FROM tracks ORDER BY dateAdded DESC, title COLLATE NOCASE"
          ).all().map((row) => JSON.parse(row.data));
          _libraryJsonCache = libraryCache;
        }
        libraryById = new Map(libraryCache.map((track) => [track.id, track]));
      }
      return libraryCache;
    }
    async function refreshTrackDateAdded(track) {
      let changed = false;
      try {
        if (track.filePath) {
          try {
            const stat = await fs.promises.stat(track.filePath);
            const mtime = Math.floor(stat.mtimeMs);
            const birthTime = stat.birthtimeMs ? Math.floor(stat.birthtimeMs) : 0;
            const realDate = birthTime || mtime || Date.now();
            if (track.dateAdded !== realDate) {
              track.dateAdded = realDate;
              changed = true;
            }
          } catch (_) {
            if (!track.dateAdded) {
              track.dateAdded = Date.now();
              changed = true;
            }
          }
        } else if (!track.dateAdded) {
          track.dateAdded = Date.now();
          changed = true;
        }
      } catch (err) {
        if (!track.dateAdded) {
          track.dateAdded = Date.now();
          changed = true;
        }
      }
      if (changed) {
        try {
          db.prepare(
            `
        UPDATE tracks 
        SET dateAdded = ?, data = ?
        WHERE id = ?
      `
          ).run(track.dateAdded, JSON.stringify(track), track.id);
        } catch (err) {
          console.warn(
            `Failed to update dateAdded for track ${track.id}:`,
            err.message
          );
        }
      }
      return track;
    }
    function saveLibrary(library2) {
      libraryCache = library2;
      _libraryJsonCache = library2;
      libraryById = new Map(library2.map((track) => [track.id, track]));
      const tx = db.transaction((tracks) => {
        db.prepare("DELETE FROM tracks").run();
        db.prepare("DELETE FROM track_covers").run();
        const insertTrack = db.prepare(`
      INSERT OR REPLACE INTO tracks
      (id, title, artist, album, genre, year, duration, dateAdded, filePath, data)
      VALUES (@id, @title, @artist, @album, @genre, @year, @duration, @dateAdded, @filePath, @data)
    `);
        const insertCover = db.prepare(`
      INSERT OR REPLACE INTO track_covers (trackId, coverArt) VALUES (?, ?)
    `);
        for (const track of tracks) {
          const newCoverArt = track.coverArt;
          const hasCoverArt = !!(newCoverArt || track._hasCoverArt);
          const { coverArt: _, ...strippedTrack } = track;
          strippedTrack._hasCoverArt = hasCoverArt;
          insertTrack.run({
            id: track.id,
            title: track.title || "",
            artist: Array.isArray(track.artist) ? track.artist.join(", ") : track.artist || "",
            album: track.album || "",
            genre: track.genre || "",
            year: Number(track.year) || null,
            duration: Number(track.duration) || 0,
            dateAdded: Number(track.dateAdded) || Date.now(),
            filePath: track.filePath || "",
            data: JSON.stringify(strippedTrack)
          });
          if (newCoverArt) {
            insertCover.run(track.id, newCoverArt);
          }
        }
      });
      let preExistingCovers;
      try {
        preExistingCovers = new Map(
          db.prepare("SELECT trackId, coverArt FROM track_covers").all().map((r) => [r.trackId, r.coverArt])
        );
      } catch (_) {
        preExistingCovers = /* @__PURE__ */ new Map();
      }
      tx(library2);
      if (preExistingCovers.size > 0) {
        const restoreInsert = db.prepare(
          "INSERT OR IGNORE INTO track_covers (trackId, coverArt) VALUES (?, ?)"
        );
        const restoreTx = db.transaction(() => {
          for (const track of library2) {
            if (!track.coverArt && track._hasCoverArt) {
              const oldArt = preExistingCovers.get(track.id);
              if (oldArt) {
                restoreInsert.run(track.id, oldArt);
              }
            }
          }
        });
        restoreTx();
      }
      if (typeof _coverArtByIdCache !== "undefined") _coverArtByIdCache.clear();
      try {
        const mainModule = require_main();
        if (mainModule && typeof mainModule.clearProtocolCache === "function") {
          mainModule.clearProtocolCache();
        }
      } catch (_) {
      }
      return true;
    }
    function getPlaylists() {
      if (playlistsCache) return playlistsCache;
      const rows = db.prepare("SELECT * FROM playlists ORDER BY updatedAt DESC").all();
      const tracksStmt = db.prepare(
        "SELECT trackId FROM playlist_tracks WHERE playlistId = ? ORDER BY position, addedAt"
      );
      playlistsCache = rows.map((row) => ({
        ...row,
        tracks: tracksStmt.all(row.id).map((item) => item.trackId)
      }));
      return playlistsCache;
    }
    function savePlaylist(playlist) {
      const tx = db.transaction((p) => {
        db.prepare(
          "INSERT OR REPLACE INTO playlists (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)"
        ).run(p.id, p.name, p.createdAt || Date.now(), p.updatedAt || Date.now());
        db.prepare("DELETE FROM playlist_tracks WHERE playlistId = ?").run(p.id);
        const insert = db.prepare(
          "INSERT OR IGNORE INTO playlist_tracks (playlistId, trackId, position, addedAt) VALUES (?, ?, ?, ?)"
        );
        (p.tracks || []).forEach(
          (trackId, index) => insert.run(p.id, trackId, index, Date.now())
        );
      });
      tx(playlist);
      const idx = getPlaylists().findIndex((p) => p.id === playlist.id);
      if (idx >= 0) playlistsCache[idx] = playlist;
      else playlistsCache.push(playlist);
      return true;
    }
    function generateTrackId(filePath) {
      return crypto.createHash("sha256").update(filePath).digest("hex").substring(0, 16);
    }
    function _estimateDurationFromFileSize(filePath, knownSize) {
      try {
        let fileSize = knownSize;
        if (!fileSize || fileSize <= 0) {
          const stat = fs.statSync(filePath);
          fileSize = stat.size;
        }
        if (!fileSize || fileSize <= 0) return 0;
        const ext = path.extname(filePath).toLowerCase();
        const basename = path.basename(filePath, ext);
        const ytMatch = basename.match(/__(?:[A-Za-z0-9_-]{8,})_(\d{2,4})$/);
        let assumedKbps = 0;
        if (ytMatch) {
          const itag = parseInt(ytMatch[1], 10) || 0;
          const itagBitrate = {
            140: 128,
            139: 48,
            171: 128,
            249: 50,
            250: 70,
            251: 160,
            18: 96
          };
          assumedKbps = itagBitrate[itag] || 128;
        } else {
          const extBitrate = {
            ".mp3": 192,
            ".aac": 128,
            ".m4a": 256,
            ".opus": 96,
            ".ogg": 112,
            ".flac": 900,
            ".wav": 1411,
            ".wma": 128,
            ".ape": 700,
            ".wv": 700,
            ".tta": 1411,
            ".mpc": 192
          };
          assumedKbps = extBitrate[ext] || 128;
        }
        if (assumedKbps <= 0) return 0;
        const estimated = Math.floor(fileSize * 8 / (assumedKbps * 1e3));
        return Math.min(3600, Math.max(1, estimated));
      } catch (_) {
        return 0;
      }
    }
    function _invalidateCollageFile(playlistId) {
      try {
        const collageDir = path.join(
          app.getPath("userData"),
          "cached_covers",
          "collages"
        );
        const collagePath = path.join(collageDir, `${playlistId}.webp`);
        if (fs.existsSync(collagePath)) fs.unlinkSync(collagePath);
      } catch (_) {
      }
    }
    function sendProgress(mainWindow, data) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("library:scan-progress", data);
      }
    }
    var fileScanner = new FileScanner(SUPPORTED_FORMATS);
    var metadataReader = new MetadataReader();
    var _smtcBridgeRef = null;
    function setSMTCBridge(bridge) {
      _smtcBridgeRef = bridge;
    }
    function registerIPCHandlers(mainWindow, smtcBridge) {
      if (smtcBridge) _smtcBridgeRef = smtcBridge;
      const isDev = process.defaultApp || process.env.NODE_ENV === "development" || process.argv.includes("--dev");
      DATA_DIR = isDev ? path.join(__dirname, "..", "data") : app.getPath("userData");
      PLAYLISTS_DIR = path.join(DATA_DIR, "playlists");
      LIBRARY_CACHE = path.join(DATA_DIR, "library.json");
      SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
      DB_FILE = path.join(DATA_DIR, "novatune.sqlite");
      [DATA_DIR, PLAYLISTS_DIR].forEach((dir) => {
        try {
          ensureDirSync(dir);
        } catch (err) {
          console.error(
            `[FATAL] Could not create required directory ${dir}:`,
            err.message
          );
        }
      });
      metadataReader.setCoverCacheDir(path.join(DATA_DIR, "cached_covers"));
      let Database;
      try {
        Database = require("better-sqlite3");
      } catch (err) {
        console.error(
          "[FATAL] better-sqlite3 failed to load \u2014 the native addon is missing or compiled for the wrong Node/Electron version. Run `npx electron-rebuild` or `npm rebuild better-sqlite3 --runtime=electron --target=28.1.0` to fix.\nOriginal error:",
          err.message
        );
        return;
      }
      db = new Database(DB_FILE);
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
      db.pragma("cache_size = -20000");
      db.pragma("temp_store = MEMORY");
      db.pragma("mmap_size = 268435456");
      db.exec("DROP INDEX IF EXISTS idx_tracks_title;");
      db.exec("DROP INDEX IF EXISTS idx_tracks_artist;");
      db.exec("DROP INDEX IF EXISTS idx_tracks_album;");
      db.exec("DROP INDEX IF EXISTS idx_tracks_date_added;");
      db.exec(DB_SCHEMA);
      migrateJsonToDb();
      migrateDbCovers();
      _maybeResetFailedFilesAtStartup();
      let manifestEnabled = true;
      if (process.env.NOVATUNE_USE_MANIFEST === "0" || process.env.NOVATUNE_USE_MANIFEST === "false") {
        manifestEnabled = false;
      } else if (process.env.NOVATUNE_USE_MANIFEST === "1" || process.env.NOVATUNE_USE_MANIFEST === "true") {
        manifestEnabled = true;
      } else {
        try {
          const settingsForFlag = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
          if (settingsForFlag._useManifest === false) manifestEnabled = false;
        } catch (_) {
        }
      }
      ManifestIPC.setFeatureFlag(manifestEnabled);
      console.log(`[manifest] feature flag: ${manifestEnabled ? "ON" : "OFF"}`);
      ManifestIPC.registerManifestIPC();
      if (manifestEnabled) {
        setImmediate(async () => {
          try {
            const info = ManifestIPC.getManifestInfo();
            if (!info.available) {
              console.log(
                "[manifest] missing on startup \u2014 building from SQLite library..."
              );
              const library2 = getLibrary();
              if (library2 && library2.length > 0) {
                const settings = readJSON(SETTINGS_FILE, {
                  ...DEFAULT_SETTINGS
                });
                const existingFp = settings._combinedFingerprint || "";
                const result = await ManifestIPC.rebuildManifest(
                  library2,
                  existingFp
                );
                if (result.ok) {
                  console.log(
                    `[manifest] built on startup: ${result.trackCount} tracks, ${result.size} bytes, ${result.ms}ms`
                  );
                  const scanFolders = Array.isArray(settings.scanFolders) ? settings.scanFolders : [];
                  if (scanFolders.length > 0 && !existingFp) {
                    console.log(
                      "[manifest] computing folder fingerprints in background..."
                    );
                    try {
                      const fps = {};
                      for (const folder of scanFolders) {
                        const fp = await _computeFolderFingerprint([folder]);
                        fps[folder] = fp;
                      }
                      const combined = Object.keys(fps).sort().map((k) => `${k}=${fps[k]}`).join("|");
                      const freshSettings = readJSON(SETTINGS_FILE, {
                        ...DEFAULT_SETTINGS
                      });
                      freshSettings._scanFingerprints = fps;
                      freshSettings._combinedFingerprint = combined;
                      writeJSON(SETTINGS_FILE, freshSettings);
                      console.log(
                        "[manifest] fingerprints persisted \u2014 next launch will skip fingerprint check"
                      );
                      await ManifestIPC.rebuildManifest(library2, combined);
                    } catch (fpErr) {
                      console.warn(
                        "[manifest] fingerprint computation failed:",
                        fpErr.message
                      );
                    }
                  }
                }
              } else {
                console.log("[manifest] library is empty \u2014 skipping build");
              }
            } else {
              console.log(
                `[manifest] already exists: ${info.trackCount} tracks, v${info.version}`
              );
            }
          } catch (err) {
            console.warn("[manifest] startup build failed:", err.message);
          }
        });
      }
      ipcMain.handle("library:scan", async (event, folderPath) => {
        try {
          console.log(`[library:scan] Scanning folder: ${folderPath}`);
          sendProgress(mainWindow, {
            stage: "scanning",
            current: 0,
            total: 0,
            folder: folderPath,
            message: "Scanning for audio files..."
          });
          try {
            const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
            const scanFolders = Array.isArray(settings.scanFolders) ? settings.scanFolders : [];
            if (!scanFolders.includes(folderPath)) {
              scanFolders.push(folderPath);
              settings.scanFolders = scanFolders;
              writeJSON(SETTINGS_FILE, settings);
            }
          } catch (err) {
            console.error("Failed to save scanFolders settings:", err.message);
          }
          const files = await fileScanner.scanDirectory(folderPath);
          const totalFiles = files.length;
          console.log(`[library:scan] Found ${totalFiles} audio files`);
          if (totalFiles === 0) {
            sendProgress(mainWindow, {
              stage: "complete",
              current: 0,
              total: 0,
              message: "No audio files found in this folder."
            });
            return { success: true, tracks: [], newTracks: 0 };
          }
          sendProgress(mainWindow, {
            stage: "reading",
            current: 0,
            total: totalFiles,
            folder: folderPath,
            message: `Reading metadata (0 / ${totalFiles})...`
          });
          const existingLibrary = getLibrary();
          const existingMap = new Map(existingLibrary.map((t) => [t.filePath, t]));
          const tracks = [];
          let failedCount = 0;
          let skippedCount = 0;
          const startTime = Date.now();
          const WORKER_POOL_SIZE = 4;
          const coverCacheDir = path.join(app.getPath("userData"), "cached_covers");
          let workerPool = [];
          let useWorker = true;
          try {
            for (let w = 0; w < WORKER_POOL_SIZE; w++) {
              const worker = new MetadataWorker();
              worker.setCoverCacheDir(coverCacheDir);
              workerPool.push(worker);
            }
          } catch (err) {
            console.warn(
              "[library:scan] MetadataWorker pool unavailable, using main thread:",
              err.message
            );
            useWorker = false;
            workerPool = [];
          }
          const scanSettings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
          if (!scanSettings._failedFilesResetV110) {
            scanSettings._failedFiles = {};
            scanSettings._failedFilesResetV110 = true;
            writeJSON(SETTINGS_FILE, scanSettings);
            console.log(
              "[library:scan] v1.1.0 reset: cleared _failedFiles cache (one-time migration)"
            );
          }
          if (!scanSettings._failedFilesResetV113) {
            scanSettings._failedFiles = {};
            scanSettings._failedFilesResetV113 = true;
            writeJSON(SETTINGS_FILE, scanSettings);
            console.log(
              "[library:scan] v1.1.3 reset: cleared _failedFiles cache for underscored-file re-scan"
            );
          }
          if (!scanSettings._failedFilesResetV115) {
            scanSettings._failedFiles = {};
            scanSettings._failedFilesResetV115 = true;
            scanSettings._failedFilesLastRetry = Date.now();
            writeJSON(SETTINGS_FILE, scanSettings);
            console.log(
              "[library:scan] v1.1.5 reset: cleared _failedFiles cache for exhaustive re-scan"
            );
          }
          if (!scanSettings._v116UnderscoreRescan) {
            scanSettings._v116UnderscoreRescan = true;
            writeJSON(SETTINGS_FILE, scanSettings);
            console.log(
              "[library:scan] v1.1.6: forcing re-scan of underscored files to fix raw-filename titles"
            );
          }
          if (!scanSettings._failedFilesLastRetry || Date.now() - scanSettings._failedFilesLastRetry > 30 * 24 * 60 * 60 * 1e3) {
            scanSettings._failedFiles = {};
            scanSettings._failedFilesLastRetry = Date.now();
            writeJSON(SETTINGS_FILE, scanSettings);
            console.log(
              "[library:scan] v1.1.5 periodic re-check: cleared _failedFiles cache (30-day cycle)"
            );
          }
          const failedFiles = scanSettings._failedFiles && typeof scanSettings._failedFiles === "object" ? scanSettings._failedFiles : {};
          const newlyFailedFiles = {};
          const toScan = [];
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const existing = existingMap.get(file.filePath);
            const failedMtime = failedFiles[file.filePath];
            const isPreviouslyFailed = failedMtime !== void 0 && failedMtime === file.modifiedTime;
            if (isPreviouslyFailed) {
              const hasUnderscores2 = /_/.test(file.fileName || "");
              if (hasUnderscores2) {
                toScan.push({ file, globalIdx: i });
                continue;
              }
              skippedCount++;
              continue;
            }
            const hasUnderscores = /_/.test(file.fileName || "");
            const nameNoExt = path.basename(
              file.fileName,
              path.extname(file.fileName)
            );
            const needsV113Rescan = hasUnderscores && existing && existing.dateModified === file.modifiedTime && (!existing.artist || existing.artist === "Unknown Artist");
            const needsV116Rescan = hasUnderscores && existing && existing.dateModified === file.modifiedTime && (!existing.title || existing.title === file.fileName || existing.title === nameNoExt);
            const needsV117Rescan = hasUnderscores && existing && existing.dateModified === file.modifiedTime;
            if (needsV113Rescan || needsV116Rescan || needsV117Rescan) {
              toScan.push({ file, globalIdx: i });
            } else if (existing && existing.dateModified === file.modifiedTime) {
              if (existing.duration > 0) {
                tracks.push(existing);
                skippedCount++;
              } else {
                toScan.push({ file, globalIdx: i });
              }
            } else {
              toScan.push({ file, globalIdx: i });
            }
          }
          if (skippedCount > 0) {
            const pct = Math.round(skippedCount / totalFiles * 100);
            sendProgress(mainWindow, {
              stage: "reading",
              current: skippedCount,
              total: totalFiles,
              percent: pct,
              message: `Reading metadata (${skippedCount} / ${totalFiles}) \u2014 ${pct}% (cached: ${skippedCount})`
            });
          }
          let doneCount = skippedCount;
          const CHUNK = useWorker ? WORKER_POOL_SIZE : 1;
          const knownArtists = /* @__PURE__ */ new Map();
          try {
            const existingLib = getLibrary();
            for (const t of existingLib) {
              const artistText = (t.artist || "").trim();
              if (artistText && artistText !== "Unknown Artist") {
                const individuals = artistText.split(/,\s*|;\s*|feat\.?\s*|ft\.?\s*|&\s*|\band\b/i).map((a) => a.trim()).filter(Boolean);
                for (const a of individuals) {
                  const lower = a.toLowerCase();
                  if (!knownArtists.has(lower)) {
                    knownArtists.set(lower, a);
                  }
                }
                if (t.albumArtist) {
                  const aa = t.albumArtist.trim();
                  if (aa && aa !== "Unknown Artist") {
                    const individualsAA = aa.split(/,\s*|;\s*|feat\.?\s*|ft\.?\s*|&\s*|\band\b/i).map((a) => a.trim()).filter(Boolean);
                    for (const a of individualsAA) {
                      const lower = a.toLowerCase();
                      if (!knownArtists.has(lower)) {
                        knownArtists.set(lower, a);
                      }
                    }
                  }
                }
              }
            }
          } catch (_) {
          }
          for (let ci = 0; ci < toScan.length; ci += CHUNK) {
            const chunk = toScan.slice(ci, ci + CHUNK);
            const chunkResults = await Promise.allSettled(
              chunk.map(async ({ file }, wi) => {
                let metadata;
                if (useWorker && workerPool.length > 0) {
                  const worker = workerPool[wi % workerPool.length];
                  try {
                    metadata = await worker.readMetadata(
                      file.filePath,
                      knownArtists
                    );
                  } catch (_) {
                    metadata = await metadataReader.readMetadata(
                      file.filePath,
                      knownArtists
                    );
                  }
                } else {
                  metadata = await metadataReader.readMetadata(
                    file.filePath,
                    knownArtists
                  );
                }
                return { file, metadata };
              })
            );
            for (const settled of chunkResults) {
              doneCount++;
              if (settled.status === "fulfilled") {
                const { file, metadata } = settled.value;
                if (metadata.duration <= 0) {
                  try {
                    const worker = workerPool[0];
                    const quickInfo = useWorker && worker ? await worker.readQuickInfo(file.filePath).catch(
                      () => metadataReader.readQuickInfo(file.filePath)
                    ) : await metadataReader.readQuickInfo(file.filePath);
                    if (quickInfo && quickInfo.duration > 0) {
                      metadata.duration = quickInfo.duration;
                      if (!metadata.bitrate)
                        metadata.bitrate = quickInfo.bitrate || 0;
                      if (!metadata.sampleRate)
                        metadata.sampleRate = quickInfo.sampleRate || 0;
                      if (!metadata.channels)
                        metadata.channels = quickInfo.channels || 2;
                    }
                  } catch (_) {
                  }
                }
                if (metadata.duration <= 0) {
                  const estimatedDuration = _estimateDurationFromFileSize(
                    file.filePath,
                    file.fileSize
                  );
                  if (estimatedDuration > 0) {
                    console.log(
                      `[library:scan] Estimated duration ${estimatedDuration}s from file size for: ${file.filePath}`
                    );
                    const fallback = await metadataReader._fallbackMetadata(
                      file.filePath,
                      knownArtists
                    );
                    metadata.duration = estimatedDuration;
                    if (!metadata.bitrate) metadata.bitrate = fallback.bitrate || 0;
                    const hasUnderscores = /_/.test(file.fileName || "");
                    const hasYtSuffix = /__(?:[A-Za-z0-9_-]{8,})_\d{2,4}$/.test(
                      file.fileName || ""
                    );
                    if (hasUnderscores || hasYtSuffix) {
                      metadata.title = fallback.title;
                      metadata.artist = fallback.artist;
                      if (!metadata.album || metadata.album === "Unknown Album")
                        metadata.album = fallback.album;
                    } else {
                      if (!metadata.title) metadata.title = fallback.title;
                      if (!metadata.artist || metadata.artist === "Unknown Artist")
                        metadata.artist = fallback.artist;
                      if (!metadata.album || metadata.album === "Unknown Album")
                        metadata.album = fallback.album;
                    }
                    if (!metadata.coverArt) metadata.coverArt = fallback.coverArt;
                  }
                }
                if (metadata.duration <= 0) {
                  console.log(
                    `[library:scan] Skipping 0:00 track (size estimate also failed): ${file.filePath}`
                  );
                  newlyFailedFiles[file.filePath] = file.modifiedTime;
                } else {
                  const hasUnderscores = /_/.test(file.fileName || "");
                  const hasYtSuffix = /__(?:[A-Za-z0-9_-]{8,})_\d{2,4}$/.test(
                    file.fileName || ""
                  );
                  if (hasUnderscores || hasYtSuffix) {
                    try {
                      const fallback = await metadataReader._fallbackMetadata(
                        file.filePath,
                        knownArtists
                      );
                      if (fallback.title) {
                        metadata.title = fallback.title;
                        metadata.artist = fallback.artist;
                        if (!metadata.album || metadata.album === "Unknown Album")
                          metadata.album = fallback.album;
                        if (!metadata.coverArt)
                          metadata.coverArt = fallback.coverArt;
                        console.log(
                          `[library:scan] Underscored file parsed: "${file.fileName}" \u2192 artist="${fallback.artist}", title="${fallback.title}"`
                        );
                      }
                    } catch (_) {
                    }
                  }
                  tracks.push({
                    id: generateTrackId(file.filePath),
                    filePath: file.filePath,
                    fileName: file.fileName,
                    title: metadata.title || path.basename(file.fileName, path.extname(file.fileName)),
                    artist: metadata.artist || "Unknown Artist",
                    album: metadata.album || "Unknown Album",
                    albumArtist: metadata.albumArtist || "",
                    genre: metadata.genre || "",
                    year: metadata.year || 0,
                    trackNumber: metadata.trackNumber || 0,
                    discNumber: metadata.discNumber || 0,
                    duration: metadata.duration || 0,
                    bitrate: metadata.bitrate || 0,
                    sampleRate: metadata.sampleRate || 0,
                    channels: metadata.channels || 2,
                    format: metadata.format || path.extname(file.fileName).replace(".", "").toUpperCase(),
                    fileSize: file.fileSize || metadata.fileSize || 0,
                    coverArt: metadata.coverArt || null,
                    _hasCoverArt: !!metadata.coverArt,
                    dateAdded: file.birthTime || file.modifiedTime || Date.now(),
                    dateModified: file.modifiedTime || Date.now()
                  });
                }
              } else {
                const { file } = toScan[ci + chunkResults.indexOf(settled)];
                try {
                  const quickInfo = await metadataReader.readQuickInfo(
                    file.filePath
                  );
                  if (quickInfo && quickInfo.duration > 0) {
                    const nameNoExt = path.basename(
                      file.fileName,
                      path.extname(file.fileName)
                    );
                    let title = nameNoExt;
                    let artist = "Unknown Artist";
                    const dashIdx = nameNoExt.indexOf(" - ");
                    if (dashIdx > 0) {
                      artist = nameNoExt.substring(0, dashIdx).trim();
                      title = nameNoExt.substring(dashIdx + 3).trim();
                    }
                    title = title.replace(/^\d+[._\s]+/, "").trim() || title;
                    tracks.push({
                      id: generateTrackId(file.filePath),
                      filePath: file.filePath,
                      fileName: file.fileName,
                      title,
                      artist,
                      album: "Unknown Album",
                      albumArtist: "",
                      genre: "",
                      year: 0,
                      trackNumber: 0,
                      discNumber: 0,
                      duration: quickInfo.duration,
                      bitrate: quickInfo.bitrate || 0,
                      sampleRate: quickInfo.sampleRate || 0,
                      channels: quickInfo.channels || 2,
                      format: path.extname(file.fileName).replace(".", "").toUpperCase(),
                      fileSize: file.fileSize || 0,
                      coverArt: null,
                      _hasCoverArt: false,
                      dateAdded: file.birthTime || file.modifiedTime || Date.now(),
                      dateModified: file.modifiedTime || Date.now()
                    });
                  } else {
                    const estimatedDuration = _estimateDurationFromFileSize(
                      file.filePath,
                      file.fileSize
                    );
                    if (estimatedDuration > 0) {
                      const fallback = await metadataReader._fallbackMetadata(
                        file.filePath,
                        knownArtists
                      );
                      console.log(
                        `[library:scan] Rejected-promise fallback: estimated ${estimatedDuration}s for ${file.filePath}`
                      );
                      tracks.push({
                        id: generateTrackId(file.filePath),
                        filePath: file.filePath,
                        fileName: file.fileName,
                        title: fallback.title,
                        artist: fallback.artist,
                        album: fallback.album,
                        albumArtist: "",
                        genre: "",
                        year: 0,
                        trackNumber: 0,
                        discNumber: 0,
                        duration: estimatedDuration,
                        bitrate: fallback.bitrate || 0,
                        sampleRate: 0,
                        channels: 2,
                        format: path.extname(file.fileName).replace(".", "").toUpperCase(),
                        fileSize: file.fileSize || 0,
                        coverArt: fallback.coverArt || null,
                        _hasCoverArt: !!fallback.coverArt,
                        dateAdded: file.birthTime || file.modifiedTime || Date.now(),
                        dateModified: file.modifiedTime || Date.now()
                      });
                    } else {
                      failedCount++;
                      newlyFailedFiles[file.filePath] = file.modifiedTime;
                    }
                  }
                } catch (_) {
                  const estimatedDuration = _estimateDurationFromFileSize(
                    file.filePath,
                    file.fileSize
                  );
                  if (estimatedDuration > 0) {
                    const fallback = await metadataReader._fallbackMetadata(
                      file.filePath,
                      knownArtists
                    );
                    console.log(
                      `[library:scan] Exception fallback: estimated ${estimatedDuration}s for ${file.filePath}`
                    );
                    tracks.push({
                      id: generateTrackId(file.filePath),
                      filePath: file.filePath,
                      fileName: file.fileName,
                      title: fallback.title,
                      artist: fallback.artist,
                      album: fallback.album,
                      albumArtist: "",
                      genre: "",
                      year: 0,
                      trackNumber: 0,
                      discNumber: 0,
                      duration: estimatedDuration,
                      bitrate: fallback.bitrate || 0,
                      sampleRate: 0,
                      channels: 2,
                      format: path.extname(file.fileName).replace(".", "").toUpperCase(),
                      fileSize: file.fileSize || 0,
                      coverArt: fallback.coverArt || null,
                      _hasCoverArt: !!fallback.coverArt,
                      dateAdded: file.birthTime || file.modifiedTime || Date.now(),
                      dateModified: file.modifiedTime || Date.now()
                    });
                  } else {
                    failedCount++;
                    newlyFailedFiles[file.filePath] = file.modifiedTime;
                  }
                }
              }
            }
            {
              const elapsed2 = ((Date.now() - startTime) / 1e3).toFixed(1);
              const pct = Math.round(doneCount / totalFiles * 100);
              sendProgress(mainWindow, {
                stage: "reading",
                current: doneCount,
                total: totalFiles,
                folder: folderPath,
                percent: pct,
                elapsed: elapsed2,
                failedCount,
                message: `Reading metadata (${doneCount} / ${totalFiles}) \u2014 ${pct}%`
              });
            }
          }
          sendProgress(mainWindow, {
            stage: "saving",
            current: totalFiles,
            total: totalFiles,
            message: "Saving library..."
          });
          const existingLibrary2 = getLibrary();
          const existingMap2 = new Map(existingLibrary2.map((t) => [t.id, t]));
          const normalizedFolder = folderPath.replace(/\\/g, "/").toLowerCase();
          for (const [id, t] of existingMap2.entries()) {
            if (t.filePath && t.filePath.replace(/\\/g, "/").toLowerCase().startsWith(normalizedFolder)) {
              existingMap2.delete(id);
            }
          }
          for (const track of tracks) {
            existingMap2.set(track.id, track);
          }
          for (const [id, track] of existingMap2.entries()) {
            if (track.duration <= 0) {
              existingMap2.delete(id);
            }
          }
          const mergedLibrary = Array.from(existingMap2.values());
          const nothingChanged = skippedCount === totalFiles && Object.keys(newlyFailedFiles).length === 0 && mergedLibrary.length === existingLibrary2.length;
          if (nothingChanged) {
            console.log(
              `[library:scan] No changes detected \u2014 skipping saveLibrary + dateAdded refresh + manifest rebuild. (${totalFiles} files checked, all cached)`
            );
          } else {
            const dateRefreshBatch = 50;
            for (let i = 0; i < mergedLibrary.length; i += dateRefreshBatch) {
              const batch = mergedLibrary.slice(i, i + dateRefreshBatch);
              await Promise.all(batch.map((track) => refreshTrackDateAdded(track)));
              if (i + dateRefreshBatch < mergedLibrary.length) {
                await new Promise((resolve) => setImmediate(resolve));
              }
            }
            saveLibrary(mergedLibrary);
          }
          for (const w of workerPool) w.shutdown();
          workerPool = [];
          if (Object.keys(newlyFailedFiles).length > 0 || !nothingChanged) {
            try {
              const freshSettings = readJSON(SETTINGS_FILE, {
                ...DEFAULT_SETTINGS
              });
              const existingFailed = freshSettings._failedFiles && typeof freshSettings._failedFiles === "object" ? freshSettings._failedFiles : {};
              for (const [fp, mt] of Object.entries(newlyFailedFiles)) {
                existingFailed[fp] = mt;
              }
              const filePaths = new Set(files.map((f) => f.filePath));
              for (const fp of Object.keys(existingFailed)) {
                if (!filePaths.has(fp)) delete existingFailed[fp];
              }
              freshSettings._failedFiles = existingFailed;
              writeJSON(SETTINGS_FILE, freshSettings);
              if (Object.keys(newlyFailedFiles).length > 0) {
                console.log(
                  `[library:scan] Recorded ${Object.keys(newlyFailedFiles).length} new failed files (total failed cache: ${Object.keys(existingFailed).length})`
                );
              }
            } catch (err) {
              console.warn(
                "[library:scan] Failed to persist _failedFiles:",
                err.message
              );
            }
          }
          const elapsed = ((Date.now() - startTime) / 1e3).toFixed(1);
          console.log(
            `[library:scan] Done! ${mergedLibrary.length} tracks in library (${tracks.length} scanned/checked, ${skippedCount} skipped/cached, ${failedCount} failed) in ${elapsed}s`
          );
          _fpCache.clear();
          sendProgress(mainWindow, {
            stage: "complete",
            current: totalFiles,
            total: totalFiles,
            newTracks: tracks.length,
            totalTracks: mergedLibrary.length,
            failedCount,
            elapsed,
            message: `Done! Checked ${tracks.length} tracks (${skippedCount} from cache) in ${elapsed}s`
          });
          let latestFingerprint = null;
          if (!nothingChanged) {
            try {
              const fp = await _computeFolderFingerprint([folderPath]);
              latestFingerprint = fp;
              const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
              settings._scanFingerprints = settings._scanFingerprints || {};
              settings._scanFingerprints[folderPath] = fp;
              const allFps = settings._scanFingerprints;
              const combined = Object.keys(allFps).sort().map((k) => `${k}=${allFps[k]}`).join("|");
              settings._combinedFingerprint = combined;
              writeJSON(SETTINGS_FILE, settings);
            } catch (_) {
            }
          }
          if (ManifestIPC.isFeatureFlagEnabled() && !nothingChanged) {
            const rebuildStart = Date.now();
            setImmediate(async () => {
              try {
                const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
                const fp = settings._combinedFingerprint || "";
                const result = await ManifestIPC.rebuildManifest(mergedLibrary, fp);
                if (result.ok) {
                  console.log(
                    `[manifest] rebuilt after scan in ${Date.now() - rebuildStart}ms (${result.trackCount} tracks, ${result.size} bytes)`
                  );
                }
              } catch (err) {
                console.warn("[manifest] post-scan rebuild failed:", err.message);
              }
            });
          }
          return {
            success: true,
            tracks: mergedLibrary,
            newTracks: tracks.length,
            nothingChanged
            // v1.0.12: renderer uses this to skip _loadLibrary()
          };
        } catch (err) {
          console.error("[library:scan] Error:", err);
          sendProgress(mainWindow, {
            stage: "error",
            message: `Scan failed: ${err.message}`
          });
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("library:needs-scan", async (event, folderPaths) => {
        try {
          const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
          const saved = settings._scanFingerprints || {};
          for (const folder of folderPaths) {
            const current = await _computeFolderFingerprint([folder]);
            if (saved[folder] !== current) {
              console.log(`[library:needs-scan] Change detected in: ${folder}`);
              return { needsScan: true };
            }
          }
          return { needsScan: false };
        } catch (err) {
          return { needsScan: true };
        }
      });
      ipcMain.handle("library:get-all", async () => {
        try {
          const library2 = getLibrary();
          return { success: true, tracks: library2 };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("library:get-page", async (event, { page, pageSize }) => {
        try {
          const p = Math.max(0, page || 0);
          const ps = Math.max(1, Math.min(pageSize || 500, 2e3));
          const start = p * ps;
          if (libraryCache) {
            const tracks2 = libraryCache.slice(start, start + ps);
            return {
              success: true,
              tracks: tracks2,
              page: p,
              pageSize: ps,
              total: libraryCache.length,
              hasMore: start + ps < libraryCache.length
            };
          }
          const total = db.prepare("SELECT COUNT(*) AS c FROM tracks").get().c;
          const rows = db.prepare(
            "SELECT data FROM tracks ORDER BY dateAdded DESC, title COLLATE NOCASE LIMIT ? OFFSET ?"
          ).all(ps, start);
          const tracks = rows.map((row) => JSON.parse(row.data));
          setImmediate(() => {
            try {
              getLibrary();
            } catch (err) {
              console.warn(
                "[library:get-page] Background warm failed:",
                err.message
              );
            }
          });
          return {
            success: true,
            tracks,
            page: p,
            pageSize: ps,
            total,
            hasMore: start + ps < total
          };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("coverart:get", async (event, trackId) => {
        try {
          const row = db.prepare("SELECT coverArt FROM track_covers WHERE trackId = ?").get(trackId);
          return { success: true, coverArt: row ? row.coverArt : null };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle(
        "coverart:get-thumb",
        async (event, { trackId, size } = {}) => {
          try {
            if (!trackId) return { success: false, error: "No trackId" };
            const targetSize = size || 128;
            const thumbDir = path.join(
              app.getPath("userData"),
              "cached_covers",
              "thumbs"
            );
            const thumbFile = path.join(thumbDir, `${trackId}_${targetSize}.webp`);
            const exists = await fs.promises.access(thumbFile).then(() => true).catch(() => false);
            if (exists) {
              return {
                success: true,
                url: `nova-media://thumb/${trackId}/${targetSize}`
              };
            }
            const library2 = getLibrary();
            const track = library2.find((t) => t.id === trackId);
            if (!track || !track.coverArt && !track._hasCoverArt) {
              return { success: false, error: "No cover art for track" };
            }
            const sharp = require("sharp");
            if (!fs.existsSync(thumbDir))
              fs.mkdirSync(thumbDir, { recursive: true });
            let inputBuffer;
            if (track.coverArt && track.coverArt.startsWith("data:")) {
              const base64 = track.coverArt.split(",")[1];
              if (!base64) return { success: false, error: "Invalid data URI" };
              inputBuffer = Buffer.from(base64, "base64");
            } else if (track.coverArt && fs.existsSync(track.coverArt)) {
              inputBuffer = await fs.promises.readFile(track.coverArt);
            } else if (track._hasCoverArt) {
              return {
                success: true,
                url: `nova-media://art/${encodeURIComponent(trackId)}`
              };
            } else {
              return { success: false, error: "Cover art not found on disk" };
            }
            const metadata = await sharp(inputBuffer).metadata();
            const side = Math.min(metadata.width, metadata.height);
            const left = Math.floor((metadata.width - side) / 2);
            const top = Math.floor((metadata.height - side) / 2);
            const thumbBuffer = await sharp(inputBuffer).extract({ left, top, width: side, height: side }).resize(targetSize, targetSize, { fit: "cover" }).webp({ quality: 90 }).toBuffer();
            await fs.promises.writeFile(thumbFile, thumbBuffer);
            return {
              success: true,
              url: `nova-media://thumb/${trackId}/${targetSize}`
            };
          } catch (err) {
            return { success: false, error: err.message };
          }
        }
      );
      ipcMain.handle("coverart:get-all-thumbs", async (event, { size } = {}) => {
        try {
          const sharp = require("sharp");
          const library2 = getLibrary();
          const targetSize = size || 128;
          const thumbDir = path.join(
            app.getPath("userData"),
            "cached_covers",
            "thumbs"
          );
          if (!fs.existsSync(thumbDir))
            await fs.promises.mkdir(thumbDir, { recursive: true });
          const thumbs = {};
          const thumbHashes = {};
          const BATCH = 8;
          const tracks = library2.filter(
            (t) => (t.coverArt || t._hasCoverArt) && t.id
          );
          for (let i = 0; i < tracks.length; i += BATCH) {
            const batch = tracks.slice(i, i + BATCH);
            await Promise.allSettled(
              batch.map(async (track) => {
                try {
                  const thumbFile = path.join(
                    thumbDir,
                    `${track.id}_${targetSize}.webp`
                  );
                  const alreadyExists = await fs.promises.access(thumbFile).then(() => true).catch(() => false);
                  if (alreadyExists) {
                    thumbs[track.id] = `nova-media://thumb/${track.id}/${targetSize}`;
                    return;
                  }
                  let inputBuffer;
                  if (track.coverArt.startsWith("data:")) {
                    const base64 = track.coverArt.split(",")[1];
                    if (!base64) return;
                    inputBuffer = Buffer.from(base64, "base64");
                  } else {
                    try {
                      inputBuffer = await fs.promises.readFile(track.coverArt);
                    } catch (_) {
                      if (libraryById && libraryById.has(track.id)) {
                        libraryById.get(track.id).coverArt = null;
                        _libraryDirty = true;
                      }
                      return;
                    }
                  }
                  const metadata = await sharp(inputBuffer).metadata();
                  const side = Math.min(metadata.width, metadata.height);
                  const left = Math.floor((metadata.width - side) / 2);
                  const top = Math.floor((metadata.height - side) / 2);
                  const thumbBuffer = await sharp(inputBuffer).extract({ left, top, width: side, height: side }).resize(targetSize, targetSize, { fit: "cover" }).webp({ quality: 90 }).toBuffer();
                  await fs.promises.writeFile(thumbFile, thumbBuffer);
                  thumbs[track.id] = `nova-media://thumb/${track.id}/${targetSize}`;
                  if (targetSize <= 48) {
                    try {
                      const { rgbaToThumbHash } = require("thumbhash");
                      const tinyPng = await sharp(inputBuffer).extract({ left, top, width: side, height: side }).resize(4, 4).raw().toBuffer();
                      const hash = rgbaToThumbHash(4, 4, tinyPng);
                      thumbHashes[track.id] = Buffer.from(hash).toString("base64");
                    } catch (e) {
                    }
                  }
                } catch (_) {
                }
              })
            );
            await new Promise((resolve) => setImmediate(resolve));
            if (Date.now() - (global._lastAudioActivity || 0) < 1500) {
              await new Promise((resolve) => setTimeout(resolve, 40));
            }
          }
          if (_libraryDirty) {
            saveLibrary(getLibrary());
            _libraryDirty = false;
          }
          return { success: true, thumbs, thumbHashes };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      const _ipcThumbInFlight = /* @__PURE__ */ new Map();
      ipcMain.handle(
        "coverart:thumbnail",
        async (event, { path: filePath, size }) => {
          try {
            const targetSize = Math.max(32, Math.min(size || 200, 800));
            const thumbDir = path.join(
              app.getPath("userData"),
              "cached_covers",
              "thumbs"
            );
            if (!fs.existsSync(thumbDir))
              fs.mkdirSync(thumbDir, { recursive: true });
            const pathHash = crypto.createHash("md5").update(filePath || "").digest("hex").substring(0, 12);
            const thumbFile = path.join(
              thumbDir,
              `path_${pathHash}_${targetSize}.webp`
            );
            if (fs.existsSync(thumbFile)) {
              return {
                success: true,
                url: `nova-media://cover/${encodeURIComponent(thumbFile)}`
              };
            }
            const dedupeKey = `${pathHash}_${targetSize}`;
            if (_ipcThumbInFlight.has(dedupeKey)) {
              try {
                await _ipcThumbInFlight.get(dedupeKey);
              } catch (_) {
              }
              if (fs.existsSync(thumbFile)) {
                return {
                  success: true,
                  url: `nova-media://cover/${encodeURIComponent(thumbFile)}`
                };
              }
              return { success: false, error: "Thumbnail generation failed" };
            }
            const genPromise = (async () => {
              const sharp = require("sharp");
              let inputBuffer;
              if (filePath && filePath.startsWith("data:")) {
                const base64 = filePath.split(",")[1];
                if (!base64) throw new Error("Invalid data URI");
                inputBuffer = Buffer.from(base64, "base64");
              } else if (filePath && fs.existsSync(filePath)) {
                inputBuffer = fs.readFileSync(filePath);
              } else {
                throw new Error("File not found");
              }
              const metadata = await sharp(inputBuffer).metadata();
              const side = Math.min(metadata.width, metadata.height);
              const left = Math.floor((metadata.width - side) / 2);
              const top = Math.floor((metadata.height - side) / 2);
              const thumbBuffer = await sharp(inputBuffer).extract({ left, top, width: side, height: side }).resize(targetSize, targetSize, { fit: "cover" }).webp({ quality: 90 }).toBuffer();
              fs.writeFileSync(thumbFile, thumbBuffer);
              return thumbFile;
            })();
            _ipcThumbInFlight.set(dedupeKey, genPromise);
            try {
              await genPromise;
              return {
                success: true,
                url: `nova-media://cover/${encodeURIComponent(thumbFile)}`
              };
            } finally {
              _ipcThumbInFlight.delete(dedupeKey);
            }
          } catch (err) {
            return { success: false, error: err.message };
          }
        }
      );
      ipcMain.handle("coverart:decode-thumbhashes", async (event, { hashes }) => {
        try {
          const { thumbHashToRGBA } = require("thumbhash");
          const results = {};
          const rgbaResults = {};
          for (const [trackId, hashB64] of Object.entries(hashes)) {
            try {
              const hashArr = Uint8Array.from(
                atob(hashB64),
                (c) => c.charCodeAt(0)
              );
              const { width, height, rgba } = thumbHashToRGBA(hashArr);
              const sharp = require("sharp");
              const pngBuffer = await sharp(Buffer.from(rgba), {
                raw: { width, height, channels: 4 }
              }).png().toBuffer();
              results[trackId] = `data:image/png;base64,${pngBuffer.toString("base64")}`;
              rgbaResults[trackId] = { width, height, data: Array.from(rgba) };
            } catch (_) {
            }
          }
          return { success: true, dataURLs: results, rgbaData: rgbaResults };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("coverart:generate-thumbhash", async (event, { trackId }) => {
        try {
          const sharp = require("sharp");
          const { rgbaToThumbHash } = require("thumbhash");
          getLibrary();
          const track = libraryById && libraryById.get(trackId);
          if (!track || !track.coverArt)
            return { success: false, error: "No cover art" };
          let inputBuffer;
          if (track.coverArt.startsWith("data:")) {
            const base64 = track.coverArt.split(",")[1];
            if (!base64) return { success: false, error: "Invalid data URI" };
            inputBuffer = Buffer.from(base64, "base64");
          } else if (fs.existsSync(track.coverArt)) {
            inputBuffer = fs.readFileSync(track.coverArt);
          } else {
            return { success: false, error: "File not found" };
          }
          const metadata = await sharp(inputBuffer).metadata();
          const side = Math.min(metadata.width, metadata.height);
          const left = Math.floor((metadata.width - side) / 2);
          const top = Math.floor((metadata.height - side) / 2);
          const tinyRaw = await sharp(inputBuffer).extract({ left, top, width: side, height: side }).resize(4, 4).raw().toBuffer();
          const hash = rgbaToThumbHash(4, 4, tinyRaw);
          return { success: true, thumbHash: Buffer.from(hash).toString("base64") };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("library:search", async (event, query) => {
        try {
          const q = query.toLowerCase().trim();
          if (!q) return { success: true, tracks: getLibrary() };
          const like = `%${q}%`;
          const results = db.prepare(
            `
          SELECT data FROM tracks
          WHERE title LIKE ? COLLATE NOCASE
             OR artist LIKE ? COLLATE NOCASE
             OR album LIKE ? COLLATE NOCASE
             OR genre LIKE ? COLLATE NOCASE
          ORDER BY title COLLATE NOCASE
        `
          ).all(like, like, like, like).map((row) => JSON.parse(row.data));
          return { success: true, tracks: results };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("library:get-by-id", async (event, trackId) => {
        try {
          getLibrary();
          const track = libraryById.get(trackId);
          if (track) {
            return { success: true, track };
          }
          return { success: false, error: "Track not found" };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("library:partial-update", async (event, existingIds) => {
        try {
          getLibrary();
          const currentIds = new Set(library.map((t) => t.id));
          const existingSet = new Set(
            Array.isArray(existingIds) ? existingIds : []
          );
          const newTracks = library.filter((t) => !existingSet.has(t.id));
          const removedIds = [...existingSet].filter((id) => !currentIds.has(id));
          return {
            success: true,
            newTracks,
            removedIds,
            totalTracks: library.length
          };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("library:clear", async () => {
        try {
          saveLibrary([]);
          try {
            ManifestIPC.deleteManifest();
          } catch (_) {
          }
          return { success: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("library:remove-track", async (event, trackId) => {
        try {
          const library2 = getLibrary();
          const track = library2.find((t) => t.id === trackId);
          if (!track) return { success: true, removed: false };
          const filtered = library2.filter((t) => t.id !== trackId);
          saveLibrary(filtered);
          if (track.filePath && fs.existsSync(track.filePath)) {
            try {
              await fs.promises.unlink(track.filePath);
              console.log(`[library] Deleted file from storage: ${track.filePath}`);
            } catch (e) {
              console.warn(
                `[library] Failed to delete file ${track.filePath} from storage:`,
                e.message
              );
            }
          }
          return { success: true, removed: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("coverart:find-sidecar", async (event, filePath) => {
        try {
          if (filePath === "__probe__") return { success: true, coverArt: null };
          if (!filePath || !fs.existsSync(filePath))
            return { success: true, coverArt: null };
          const dir = path.dirname(filePath);
          const IMAGE_EXTS = /* @__PURE__ */ new Set([
            ".jpg",
            ".jpeg",
            ".png",
            ".webp",
            ".bmp",
            ".gif"
          ]);
          const sidecarNames = [
            "cover.jpg",
            "cover.jpeg",
            "cover.png",
            "cover.webp",
            "folder.jpg",
            "folder.jpeg",
            "folder.png",
            "album.jpg",
            "album.jpeg",
            "album.png",
            "front.jpg",
            "front.jpeg",
            "front.png",
            "artwork.jpg",
            "artwork.jpeg",
            "artwork.png",
            "art.jpg",
            "art.jpeg",
            "art.png",
            "thumbnail.jpg",
            "thumbnail.jpeg"
          ];
          for (const name of sidecarNames) {
            const candidate = path.join(dir, name);
            if (fs.existsSync(candidate)) {
              return { success: true, coverArt: candidate };
            }
          }
          let fallbackCandidate = null;
          try {
            const files = fs.readdirSync(dir);
            const audioName = path.basename(filePath, path.extname(filePath)).toLowerCase();
            for (const file of files) {
              const lower = file.toLowerCase();
              const fileExt = path.extname(lower);
              if (lower.startsWith("albumart_") && (lower.endsWith("_large.jpg") || lower.endsWith("_small.jpg")) || lower === "albumartsmall.jpg") {
                const fullPath = path.join(dir, file);
                if (lower.includes("large")) {
                  return { success: true, coverArt: fullPath };
                }
                fallbackCandidate = fallbackCandidate || fullPath;
              }
              if (lower.includes(".novaart") && IMAGE_EXTS.has(fileExt)) {
                return { success: true, coverArt: path.join(dir, file) };
              }
              if (IMAGE_EXTS.has(fileExt)) {
                const nameNoExt = path.basename(file, path.extname(file)).toLowerCase();
                if (nameNoExt === audioName) {
                  return { success: true, coverArt: path.join(dir, file) };
                }
              }
            }
            if (!fallbackCandidate) {
              for (const file of files) {
                const fileExt = path.extname(file).toLowerCase();
                if (IMAGE_EXTS.has(fileExt)) {
                  const fullPath = path.join(dir, file);
                  try {
                    const stat = fs.statSync(fullPath);
                    if (stat.size >= 5e3) {
                      fallbackCandidate = fullPath;
                      break;
                    }
                  } catch (_) {
                  }
                }
              }
            }
          } catch (_) {
          }
          if (fallbackCandidate) {
            return { success: true, coverArt: fallbackCandidate };
          }
          return { success: true, coverArt: null };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("coverart:exhaustive-search", async (event, filePaths) => {
        try {
          const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
          const IMAGE_EXTS = /* @__PURE__ */ new Set([
            ".jpg",
            ".jpeg",
            ".png",
            ".webp",
            ".bmp",
            ".gif",
            ".tiff",
            ".tif"
          ]);
          const COMMON_NAMES = /* @__PURE__ */ new Set([
            "cover",
            "folder",
            "album",
            "front",
            "artwork",
            "art",
            "thumb",
            "thumbnail",
            "back",
            "insert",
            "booklet",
            "jacket",
            "label",
            "sticker"
          ]);
          const dirs = /* @__PURE__ */ new Set();
          for (const fp of paths) {
            if (!fp || typeof fp !== "string") continue;
            const dir = path.dirname(fp);
            dirs.add(dir);
            dirs.add(path.dirname(dir));
          }
          const candidates = [];
          for (const dir of dirs) {
            if (!fs.existsSync(dir)) continue;
            let files;
            try {
              files = fs.readdirSync(dir);
            } catch (_) {
              continue;
            }
            for (const file of files) {
              const lower = file.toLowerCase();
              if (lower.includes(".novaart") && IMAGE_EXTS.has(path.extname(lower))) {
                candidates.push({ path: path.join(dir, file), priority: 1 });
              }
            }
            for (const fp of paths) {
              if (!fp || typeof fp !== "string") continue;
              const audioName = path.basename(fp, path.extname(fp)).toLowerCase();
              for (const file of files) {
                const fileExt = path.extname(file).toLowerCase();
                if (IMAGE_EXTS.has(fileExt)) {
                  const nameNoExt = path.basename(file, path.extname(file)).toLowerCase();
                  if (nameNoExt === audioName) {
                    candidates.push({ path: path.join(dir, file), priority: 2 });
                  }
                }
              }
            }
            for (const file of files) {
              const fileExt = path.extname(file).toLowerCase();
              if (IMAGE_EXTS.has(fileExt)) {
                const nameNoExt = path.basename(file, path.extname(file)).toLowerCase();
                if (COMMON_NAMES.has(nameNoExt)) {
                  candidates.push({ path: path.join(dir, file), priority: 3 });
                }
              }
            }
            for (const file of files) {
              const lower = file.toLowerCase();
              const fileExt = path.extname(lower);
              if (IMAGE_EXTS.has(fileExt) && lower.startsWith("albumart")) {
                const prio = lower.includes("large") ? 3 : 4;
                candidates.push({ path: path.join(dir, file), priority: prio });
              }
            }
            for (const file of files) {
              const fileExt = path.extname(file).toLowerCase();
              if (IMAGE_EXTS.has(fileExt)) {
                const lower = file.toLowerCase();
                const fullPath = path.join(dir, file);
                try {
                  const stat = fs.statSync(fullPath);
                  if (stat.size < 5e3) continue;
                } catch (_) {
                  continue;
                }
                if (!candidates.some((c) => c.path === fullPath)) {
                  candidates.push({ path: fullPath, priority: 5 });
                }
              }
            }
            for (const file of files) {
              const subdir = path.join(dir, file);
              try {
                const stat = fs.statSync(subdir);
                if (!stat.isDirectory()) continue;
              } catch (_) {
                continue;
              }
              let subFiles;
              try {
                subFiles = fs.readdirSync(subdir);
              } catch (_) {
                continue;
              }
              for (const sf of subFiles) {
                const lower = sf.toLowerCase();
                if (lower.includes(".novaart") && IMAGE_EXTS.has(path.extname(lower))) {
                  candidates.push({ path: path.join(subdir, sf), priority: 6 });
                }
              }
              for (const sf of subFiles) {
                const fileExt = path.extname(sf).toLowerCase();
                if (IMAGE_EXTS.has(fileExt)) {
                  const nameNoExt = path.basename(sf, path.extname(sf)).toLowerCase();
                  if (COMMON_NAMES.has(nameNoExt)) {
                    candidates.push({ path: path.join(subdir, sf), priority: 6 });
                  }
                }
              }
              for (const sf of subFiles) {
                const fileExt = path.extname(sf).toLowerCase();
                if (IMAGE_EXTS.has(fileExt)) {
                  const fullPath = path.join(subdir, sf);
                  try {
                    const stat = fs.statSync(fullPath);
                    if (stat.size < 5e3) continue;
                  } catch (_) {
                    continue;
                  }
                  if (!candidates.some((c) => c.path === fullPath)) {
                    candidates.push({ path: fullPath, priority: 7 });
                  }
                }
              }
            }
          }
          for (const dir of [...dirs]) {
            let current = dir;
            for (let depth = 0; depth < 3; depth++) {
              const parent = path.dirname(current);
              if (!parent || parent === current) break;
              if (!fs.existsSync(parent)) break;
              let parentFiles;
              try {
                parentFiles = fs.readdirSync(parent);
              } catch (_) {
                break;
              }
              for (const file of parentFiles) {
                const fileExt = path.extname(file).toLowerCase();
                if (IMAGE_EXTS.has(fileExt)) {
                  const nameNoExt = path.basename(file, path.extname(file)).toLowerCase();
                  if (COMMON_NAMES.has(nameNoExt)) {
                    const fullPath = path.join(parent, file);
                    if (!candidates.some((c) => c.path === fullPath)) {
                      candidates.push({ path: fullPath, priority: 8 + depth });
                    }
                  }
                }
              }
              current = parent;
            }
          }
          candidates.sort((a, b) => a.priority - b.priority);
          if (candidates.length > 0) {
            return {
              success: true,
              coverArt: candidates[0].path,
              candidates: candidates.slice(0, 5).map((c) => c.path)
            };
          }
          return { success: true, coverArt: null };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("coverart:save", async (event, { trackId, url }) => {
        try {
          const row = db.prepare("SELECT data FROM tracks WHERE id = ?").get(trackId);
          if (!row) return { success: false, error: "Track not found" };
          const track = JSON.parse(row.data);
          if (!track.filePath) return { success: false, error: "No filePath" };
          const imgData = await new Promise((resolve, reject) => {
            const req = net.request(url);
            const chunks = [];
            req.on("response", (res) => {
              res.on("data", (c) => chunks.push(c));
              res.on("end", () => resolve(Buffer.concat(chunks)));
              res.on("error", reject);
            });
            req.on("error", reject);
            req.end();
          });
          const sidecarPath = track.filePath.replace(/\.[^.]+$/, ".novaart.jpg");
          fs.writeFileSync(sidecarPath, imgData);
          track.coverArt = sidecarPath;
          db.prepare("UPDATE tracks SET data = ? WHERE id = ?").run(
            JSON.stringify(track),
            trackId
          );
          if (libraryById && libraryById.has(trackId)) {
            libraryById.get(trackId).coverArt = sidecarPath;
          }
          if (libraryCache) {
            const t = libraryCache.find((t2) => t2.id === trackId);
            if (t) t.coverArt = sidecarPath;
          }
          return { success: true, localPath: sidecarPath };
        } catch (err) {
          console.error("[coverart:save]", err.message);
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle(
        "playlist:save-collage",
        async (event, { playlistId, dataURL, contentHash }) => {
          try {
            if (!playlistId || !dataURL)
              return { success: false, error: "Missing params" };
            const collageDir = path.join(
              app.getPath("userData"),
              "cached_covers",
              "collages"
            );
            if (!fs.existsSync(collageDir))
              fs.mkdirSync(collageDir, { recursive: true });
            const collagePath = path.join(collageDir, `${playlistId}.webp`);
            const matches = dataURL.match(/^data:image\/[^;]+;base64,(.+)$/);
            if (!matches) return { success: false, error: "Invalid data URL" };
            const buffer = Buffer.from(matches[1], "base64");
            fs.writeFileSync(collagePath, buffer);
            if (contentHash) {
              const hashPath = path.join(collageDir, `${playlistId}.hash`);
              fs.writeFileSync(hashPath, contentHash, "utf8");
            }
            return { success: true, path: collagePath };
          } catch (err) {
            return { success: false, error: err.message };
          }
        }
      );
      ipcMain.handle(
        "playlist:get-collage",
        async (event, { playlistId, contentHash }) => {
          try {
            if (!playlistId) return { success: false, error: "Missing playlistId" };
            const collageDir = path.join(
              app.getPath("userData"),
              "cached_covers",
              "collages"
            );
            const collagePath = path.join(collageDir, `${playlistId}.webp`);
            const hashPath = path.join(collageDir, `${playlistId}.hash`);
            if (!fs.existsSync(collagePath))
              return { success: false, error: "Not cached" };
            if (contentHash && fs.existsSync(hashPath)) {
              const storedHash = fs.readFileSync(hashPath, "utf8");
              if (storedHash !== contentHash) {
                try {
                  fs.unlinkSync(collagePath);
                } catch (_) {
                }
                try {
                  fs.unlinkSync(hashPath);
                } catch (_) {
                }
                return { success: false, error: "Stale collage" };
              }
            } else if (contentHash && !fs.existsSync(hashPath)) {
              try {
                fs.unlinkSync(collagePath);
              } catch (_) {
              }
              return { success: false, error: "No hash, regenerating" };
            }
            const url = `nova-media://cover/${encodeURIComponent(collagePath)}`;
            return { success: true, url };
          } catch (err) {
            return { success: false, error: err.message };
          }
        }
      );
      ipcMain.handle("playlist:invalidate-collage", async (event, playlistId) => {
        try {
          if (!playlistId) return { success: false };
          const collageDir = path.join(
            app.getPath("userData"),
            "cached_covers",
            "collages"
          );
          const collagePath = path.join(collageDir, `${playlistId}.webp`);
          const hashPath = path.join(collageDir, `${playlistId}.hash`);
          if (fs.existsSync(collagePath)) fs.unlinkSync(collagePath);
          if (fs.existsSync(hashPath)) fs.unlinkSync(hashPath);
          return { success: true };
        } catch (_) {
          return { success: false };
        }
      });
      ipcMain.handle("file:open-dialog", async () => {
        try {
          const result = await dialog.showOpenDialog(mainWindow, {
            title: "Select Music Files",
            properties: ["openFile", "openDirectory", "multiSelections"],
            filters: [
              {
                name: "Audio Files",
                extensions: SUPPORTED_FORMATS.map((f) => f.replace(".", ""))
              },
              { name: "All Files", extensions: ["*"] }
            ]
          });
          if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true };
          }
          const filesToProcess = [];
          for (const p of result.filePaths) {
            if (fs.existsSync(p)) {
              const stat = fs.statSync(p);
              if (stat.isDirectory()) {
                try {
                  const scannedFiles = await fileScanner.scanDirectory(p);
                  filesToProcess.push(...scannedFiles);
                } catch (scanErr) {
                  console.warn(`Failed scanning directory ${p}:`, scanErr.message);
                }
              } else {
                filesToProcess.push({
                  filePath: p,
                  fileName: path.basename(p),
                  fileSize: stat.size,
                  modifiedTime: stat.mtimeMs,
                  birthTime: stat.birthtimeMs
                });
              }
            }
          }
          const tracks = [];
          for (const file of filesToProcess) {
            try {
              const metadata = await metadataReader.readMetadata(file.filePath);
              tracks.push({
                id: generateTrackId(file.filePath),
                filePath: file.filePath,
                fileName: file.fileName,
                title: metadata.title || path.basename(file.filePath, path.extname(file.filePath)),
                artist: metadata.artist || "Unknown Artist",
                album: metadata.album || "Unknown Album",
                albumArtist: metadata.albumArtist || "",
                genre: metadata.genre || "",
                year: metadata.year || 0,
                trackNumber: metadata.trackNumber || 0,
                discNumber: metadata.discNumber || 0,
                duration: metadata.duration || 0,
                bitrate: metadata.bitrate || 0,
                sampleRate: metadata.sampleRate || 0,
                channels: metadata.channels || 2,
                format: metadata.format || path.extname(file.filePath).replace(".", "").toUpperCase(),
                fileSize: file.fileSize,
                coverArt: metadata.coverArt || null,
                dateAdded: Date.now(),
                dateModified: file.modifiedTime || Date.now()
              });
            } catch (err) {
              console.warn(
                `Metadata read failed for ${file.filePath}:`,
                err.message
              );
            }
          }
          if (tracks.length > 0) {
            const existingLibrary = getLibrary();
            const existingMap = new Map(existingLibrary.map((t) => [t.id, t]));
            for (const track of tracks) {
              existingMap.set(track.id, track);
            }
            const mergedLibrary = Array.from(existingMap.values());
            saveLibrary(mergedLibrary);
          }
          return { success: true, tracks };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("file:open-folder-dialog", async () => {
        try {
          const result = await dialog.showOpenDialog(mainWindow, {
            title: "Select Music Folder",
            properties: ["openDirectory"]
          });
          if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true };
          }
          return { success: true, folderPath: result.filePaths[0] };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("file:read-audio", async (event, filePath) => {
        try {
          const buffer = fs.readFileSync(filePath);
          const base64 = buffer.toString("base64");
          const mimeType = getAudioMimeType(filePath);
          return { success: true, data: `data:${mimeType};base64,${base64}` };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("file:get-metadata", async (event, filePath) => {
        try {
          const metadata = await metadataReader.readMetadata(filePath);
          return { success: true, metadata };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("file:open-cover-art", async () => {
        try {
          const result = await dialog.showOpenDialog(mainWindow, {
            title: "Select Cover Art",
            properties: ["openFile"],
            filters: [
              { name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] },
              { name: "All Files", extensions: ["*"] }
            ]
          });
          if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true };
          }
          const coverBuffer = fs.readFileSync(result.filePaths[0]);
          const base64 = coverBuffer.toString("base64");
          const ext = path.extname(result.filePaths[0]).toLowerCase();
          const mimeMap = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".bmp": "image/bmp"
          };
          return {
            success: true,
            data: `data:${mimeMap[ext] || "image/png"};base64,${base64}`
          };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle(
        "metadata:write-tags",
        async (event, { trackId, filePath, tags }) => {
          try {
            console.log("[metadata:write-tags] Request received for trackId:", trackId, "filePath:", filePath);
            if (!filePath || !fs.existsSync(filePath)) {
              console.error("[metadata:write-tags] File not found:", filePath);
              return { success: false, error: "File not found" };
            }
            getLibrary();
            const ext = path.extname(filePath).toLowerCase();
            if (ext === ".mp3") {
              const NodeID3 = require("node-id3");
              const id3Tags = {};
              if (tags.title !== void 0) id3Tags.title = tags.title || "";
              if (tags.artist !== void 0) id3Tags.artist = tags.artist || "";
              if (tags.album !== void 0) id3Tags.album = tags.album || "";
              if (tags.genre !== void 0) id3Tags.genre = tags.genre || "";
              if (tags.year !== void 0) id3Tags.year = tags.year ? String(tags.year) : "";
              if (tags.coverArt) {
                try {
                  const match = tags.coverArt.match(/^data:([^;]+);base64,(.+)$/);
                  if (match) {
                    const mime = match[1];
                    const buf = Buffer.from(match[2], "base64");
                    id3Tags.image = {
                      mime,
                      type: { id: 3, name: "front cover" },
                      description: "Cover",
                      imageBuffer: buf
                    };
                  }
                } catch (coverErr) {
                  console.warn("[metadata:write-tags] cover art parse failed:", coverErr.message);
                }
              }
              const written = NodeID3.update(id3Tags, filePath);
              if (written !== true) {
                console.warn("[metadata:write-tags] node-id3 write returned:", written);
              }
            }
            let updatedTrack = null;
            if (libraryById && libraryById.has(trackId)) {
              const track = libraryById.get(trackId);
              if (tags.title !== void 0) track.title = tags.title;
              if (tags.artist !== void 0) track.artist = tags.artist;
              if (tags.album !== void 0) track.album = tags.album;
              if (tags.genre !== void 0) track.genre = tags.genre;
              if (tags.year !== void 0) track.year = tags.year;
              if (tags.coverArt) {
                track.coverArt = tags.coverArt;
                track._hasCoverArt = true;
              }
              updatedTrack = track;
              try {
                const row = db.prepare("SELECT data FROM tracks WHERE id = ?").get(trackId);
                if (row) {
                  const dbTrack = JSON.parse(row.data);
                  Object.assign(dbTrack, {
                    title: track.title,
                    artist: track.artist,
                    album: track.album,
                    genre: track.genre,
                    year: track.year,
                    ...tags.coverArt ? { coverArt: tags.coverArt, _hasCoverArt: true } : {}
                  });
                  db.prepare("UPDATE tracks SET data = ? WHERE id = ?").run(
                    JSON.stringify(dbTrack),
                    trackId
                  );
                }
              } catch (dbErr) {
                console.error("[metadata:write-tags] DB update failed:", dbErr.message);
              }
              try {
                const library2 = getLibrary();
                const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
                const fingerprint = settings._combinedFingerprint || "";
                await ManifestIPC.rebuildManifest(library2, fingerprint);
              } catch (manifestErr) {
                console.error("[metadata:write-tags] Manifest rebuild failed:", manifestErr.message);
              }
            }
            return { success: true, updatedTrack };
          } catch (err) {
            console.error("[metadata:write-tags]", err.message);
            return { success: false, error: err.message };
          }
        }
      );
      function getAudioMimeType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap = {
          ".mp3": "audio/mpeg",
          ".flac": "audio/flac",
          ".wav": "audio/wav",
          ".ogg": "audio/ogg",
          ".m4a": "audio/mp4",
          ".aac": "audio/aac",
          ".wma": "audio/x-ms-wma",
          ".opus": "audio/opus",
          ".ape": "audio/x-ape"
        };
        return mimeMap[ext] || "audio/mpeg";
      }
      ipcMain.handle("settings:get", async (event, key) => {
        const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
        return {
          success: true,
          value: settings[key] !== void 0 ? settings[key] : DEFAULT_SETTINGS[key]
        };
      });
      ipcMain.handle("settings:set", async (event, key, value) => {
        try {
          const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
          settings[key] = value;
          writeJSON(SETTINGS_FILE, settings);
          return { success: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("settings:get-all", async () => {
        const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          if (settings[key] === void 0) {
            settings[key] = DEFAULT_SETTINGS[key];
          }
        }
        if (Array.isArray(settings.scanFolders) && settings.scanFolders.length) {
          const stillValid = settings.scanFolders.filter((f) => {
            try {
              return fs.existsSync(f);
            } catch (_) {
              return false;
            }
          });
          if (stillValid.length !== settings.scanFolders.length) {
            settings.scanFolders = stillValid;
            writeJSON(SETTINGS_FILE, settings);
          }
        }
        return { success: true, settings };
      });
      ipcMain.handle("settings:reset", async () => {
        try {
          writeJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
          return { success: true, settings: { ...DEFAULT_SETTINGS } };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("playlist:get-all", async () => {
        try {
          return { success: true, playlists: getPlaylists() };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("playlist:merge-duplicates", async () => {
        try {
          const allPlaylists = getPlaylists();
          if (allPlaylists.length === 0) {
            return { success: true, merged: 0, message: "No playlists" };
          }
          const groups = /* @__PURE__ */ new Map();
          for (const p of allPlaylists) {
            const key = (p.name || "").trim().toLowerCase();
            if (!key) continue;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(p);
          }
          let totalMerged = 0;
          const mergeOperations = [];
          for (const [key, dups] of groups) {
            if (dups.length < 2) continue;
            dups.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            const keeper = dups[0];
            const losers = dups.slice(1);
            const keeperTrackSet = new Set(keeper.tracks || []);
            let addedCount = 0;
            for (const loser of losers) {
              for (const trackId of loser.tracks || []) {
                if (!keeperTrackSet.has(trackId)) {
                  keeperTrackSet.add(trackId);
                  addedCount++;
                }
              }
            }
            keeper.tracks = Array.from(keeperTrackSet);
            keeper.updatedAt = Date.now();
            mergeOperations.push({
              keeperId: keeper.id,
              keeperName: keeper.name,
              loserIds: losers.map((l) => l.id),
              addedTracks: addedCount
            });
            totalMerged += losers.length;
          }
          if (mergeOperations.length === 0) {
            return { success: true, merged: 0, message: "No duplicates found" };
          }
          const tx = db.transaction(() => {
            for (const op of mergeOperations) {
              const moveStmt = db.prepare(`
            INSERT OR IGNORE INTO playlist_tracks (playlistId, trackId, position, addedAt)
            SELECT ?, trackId, position, addedAt
            FROM playlist_tracks WHERE playlistId = ?
          `);
              for (const loserId of op.loserIds) {
                moveStmt.run(op.keeperId, loserId);
              }
              const delTracksStmt = db.prepare(
                "DELETE FROM playlist_tracks WHERE playlistId = ?"
              );
              for (const loserId of op.loserIds) {
                delTracksStmt.run(loserId);
              }
              const delPlaylistStmt = db.prepare(
                "DELETE FROM playlists WHERE id = ?"
              );
              for (const loserId of op.loserIds) {
                delPlaylistStmt.run(loserId);
              }
              const keeper = getPlaylists().find((p) => p.id === op.keeperId);
              if (keeper) {
                const tracks = db.prepare(
                  "SELECT trackId FROM playlist_tracks WHERE playlistId = ? ORDER BY position, addedAt"
                ).all(op.keeperId).map((r) => r.trackId);
                keeper.tracks = tracks;
                keeper.updatedAt = Date.now();
                savePlaylist(keeper);
              }
            }
          });
          tx();
          playlistsCache = null;
          console.log(
            `[playlist:merge-duplicates] Merged ${totalMerged} duplicate playlists`
          );
          for (const op of mergeOperations) {
            console.log(
              `  \u2713 "${op.keeperName}": kept ${op.keeperId}, removed ${op.loserIds.length} duplicates, added ${op.addedTracks} tracks`
            );
          }
          return {
            success: true,
            merged: totalMerged,
            operations: mergeOperations
          };
        } catch (err) {
          console.error("[playlist:merge-duplicates] Error:", err);
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("playlist:create", async (event, name) => {
        try {
          const id = crypto.createHash("sha256").update(`playlist:${name}:${Date.now()}`).digest("hex").substring(0, 12);
          const playlist = {
            id,
            name: name.trim() || "Untitled Playlist",
            tracks: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          savePlaylist(playlist);
          return { success: true, playlist };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("playlist:delete", async (event, playlistId) => {
        try {
          const existing = getPlaylists().find((p) => p.id === playlistId);
          if (existing) {
            db.prepare("DELETE FROM playlist_tracks WHERE playlistId = ?").run(
              playlistId
            );
            db.prepare("DELETE FROM playlists WHERE id = ?").run(playlistId);
            playlistsCache = getPlaylists().filter((p) => p.id !== playlistId);
            return { success: true };
          }
          return { success: false, error: "Playlist not found" };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("playlist:add-track", async (event, playlistId, trackId) => {
        try {
          const playlist = getPlaylists().find((p) => p.id === playlistId);
          if (!playlist) return { success: false, error: "Playlist not found" };
          if (!playlist.tracks.includes(trackId)) {
            playlist.tracks.push(trackId);
            playlist.updatedAt = Date.now();
            savePlaylist(playlist);
            _invalidateCollageFile(playlistId);
          }
          return { success: true, playlist };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle(
        "playlist:remove-track",
        async (event, playlistId, trackId) => {
          try {
            const playlist = getPlaylists().find((p) => p.id === playlistId);
            if (!playlist) return { success: false, error: "Playlist not found" };
            playlist.tracks = playlist.tracks.filter((id) => id !== trackId);
            playlist.updatedAt = Date.now();
            savePlaylist(playlist);
            _invalidateCollageFile(playlistId);
            return { success: true, playlist };
          } catch (err) {
            return { success: false, error: err.message };
          }
        }
      );
      ipcMain.handle("playlist:rename", async (event, playlistId, newName) => {
        try {
          const playlist = getPlaylists().find((p) => p.id === playlistId);
          if (!playlist) return { success: false, error: "Playlist not found" };
          playlist.name = newName.trim() || playlist.name;
          playlist.updatedAt = Date.now();
          savePlaylist(playlist);
          return { success: true, playlist };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("playlist:import", async () => {
        try {
          const openResult = await dialog.showOpenDialog(mainWindow, {
            title: "Import Playlist",
            properties: ["openFile"],
            filters: [
              {
                name: "All Playlists",
                extensions: ["m3u", "m3u8", "pls", "xspf", "json"]
              },
              { name: "All Files", extensions: ["*"] }
            ]
          });
          if (openResult.canceled || openResult.filePaths.length === 0)
            return { success: false, canceled: true };
          const filePath = openResult.filePaths[0];
          const ext = path.extname(filePath).toLowerCase().replace(".", "");
          const encoding = ext === "m3u" ? "latin1" : "utf-8";
          const content = fs.readFileSync(filePath, encoding);
          const baseName = path.basename(filePath, path.extname(filePath));
          let entries = [];
          let playlistName = baseName;
          if (ext === "m3u" || ext === "m3u8") {
            const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            let pendingDuration = 0;
            for (const line of lines) {
              if (line.startsWith("#EXTM3U")) continue;
              if (line.startsWith("#EXTINF:")) {
                const comma = line.indexOf(",");
                pendingDuration = parseFloat(line.substring(8, comma > 0 ? comma : void 0)) || 0;
              } else if (!line.startsWith("#")) {
                entries.push({ filePath: line, duration: pendingDuration });
                pendingDuration = 0;
              }
            }
          } else if (ext === "pls") {
            const fileMap = {};
            content.split(/\r?\n/).forEach((line) => {
              const m = line.match(/^File(\d+)=(.+)$/i);
              if (m) fileMap[m[1]] = m[2].trim();
            });
            entries = Object.keys(fileMap).sort((a, b) => +a - +b).map((n) => ({ filePath: fileMap[n] }));
          } else if (ext === "xspf") {
            const titleMatch = content.match(
              /<playlist[^>]*>[\s\S]*?<title>([\s\S]*?)<\/title>/
            );
            if (titleMatch)
              playlistName = titleMatch[1].trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
            const trackRegex = /<track>([\s\S]*?)<\/track>/g;
            let m;
            while ((m = trackRegex.exec(content)) !== null) {
              const loc = m[1].match(/<location>([\s\S]*?)<\/location>/);
              if (!loc) continue;
              let fp = loc[1].trim().replace(/&amp;/g, "&").replace(/^file:\/\/\/?/, "");
              if (/^\/[A-Za-z]:/.test(fp)) fp = fp.substring(1);
              entries.push({ filePath: fp });
            }
          } else if (ext === "json") {
            try {
              const data = JSON.parse(content);
              playlistName = data.name || baseName;
              const raw = Array.isArray(data) ? data : Array.isArray(data.tracks) ? data.tracks : [];
              entries = raw.map((t) => ({ filePath: t.filePath || t.path || t.file || "" })).filter((e) => e.filePath);
              if (entries.length === 0 && Array.isArray(data.trackIds)) {
                const library3 = getLibrary();
                const idSet = new Set(data.trackIds);
                entries = library3.filter((t) => idSet.has(t.id)).map((t) => ({ filePath: t.filePath, resolvedId: t.id }));
              }
            } catch (_) {
            }
          }
          if (entries.length === 0)
            return { success: false, error: "No tracks found in playlist file" };
          const library2 = getLibrary();
          const pathToId = new Map(
            library2.filter((t) => t?.filePath).map((t) => [t.filePath, t.id])
          );
          const crossBasename = (fp) => {
            const posix = String(fp || "").replace(/\\/g, "/");
            const idx = posix.lastIndexOf("/");
            return idx >= 0 ? posix.substring(idx + 1) : posix;
          };
          const fileNameToTrack = /* @__PURE__ */ new Map();
          const fileNameNoExtToTrack = /* @__PURE__ */ new Map();
          for (const t of library2) {
            if (!t?.filePath) continue;
            const fname = crossBasename(t.filePath).toLowerCase();
            if (!fileNameToTrack.has(fname)) fileNameToTrack.set(fname, t);
            const fnameNoExt = fname.replace(/\.[^.]+$/, "");
            if (!fileNameNoExtToTrack.has(fnameNoExt))
              fileNameNoExtToTrack.set(fnameNoExt, t);
          }
          const id = crypto.createHash("sha256").update(`playlist:${playlistName}:${Date.now()}`).digest("hex").substring(0, 12);
          const playlist = {
            id,
            name: (playlistName || "Imported Playlist").trim(),
            tracks: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          const unmatchedTracks = [];
          for (const entry of entries) {
            if (!entry?.filePath && !entry?.resolvedId) continue;
            let trackId = entry.resolvedId || pathToId.get(entry.filePath);
            if (!trackId) {
              const fname = crossBasename(entry.filePath).toLowerCase();
              const match = fileNameToTrack.get(fname) || fileNameNoExtToTrack.get(fname.replace(/\.[^.]+$/, ""));
              trackId = match ? match.id : null;
            }
            if (trackId) {
              if (!playlist.tracks.includes(trackId)) {
                playlist.tracks.push(trackId);
              }
            } else {
              unmatchedTracks.push(crossBasename(entry.filePath) || entry.filePath);
            }
          }
          const unmatched = unmatchedTracks.length;
          if (unmatched > 0) {
            console.warn(
              `[playlist:import] ${unmatched}/${entries.length} tracks unresolved \u2014 library may not include those files`
            );
          }
          if (playlist.tracks.length === 0) {
            return {
              success: false,
              error: `Playlist parsed (${entries.length} tracks) but none matched your library. Scan the folder containing these files first, then re-import.`,
              parsedCount: entries.length,
              matchedCount: 0
            };
          }
          savePlaylist(playlist);
          playlistsCache = null;
          return {
            success: true,
            playlist,
            matchedCount: playlist.tracks.length,
            unmatchedCount: unmatched,
            unmatchedTracks
          };
        } catch (err) {
          console.error("[playlist:import]", err.message);
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("playlist:export", async (event, playlistId) => {
        try {
          const playlist = getPlaylists().find((p) => p.id === playlistId);
          if (!playlist) return { success: false, error: "Playlist not found" };
          const saveResult = await dialog.showSaveDialog(mainWindow, {
            title: "Export Playlist",
            defaultPath: playlist.name,
            filters: [
              { name: "M3U Playlist", extensions: ["m3u"] },
              { name: "M3U8 Playlist", extensions: ["m3u8"] },
              { name: "PLS Playlist", extensions: ["pls"] },
              { name: "XSPF Playlist", extensions: ["xspf"] },
              { name: "JSON Playlist", extensions: ["json"] }
            ]
          });
          if (saveResult.canceled || !saveResult.filePath)
            return { success: false, canceled: true };
          const filePath = saveResult.filePath;
          const ext = path.extname(filePath).toLowerCase().replace(".", "");
          const library2 = getLibrary();
          const libMap = new Map(library2.map((t) => [t.id, t]));
          const tracks = playlist.tracks.map((id) => libMap.get(id)).filter(Boolean);
          let content = "";
          if (ext === "m3u" || ext === "m3u8") {
            const lines = ["#EXTM3U"];
            for (const t of tracks) {
              lines.push(
                `#EXTINF:${Math.round(t.duration || 0)},${t.artist || "Unknown"} - ${t.title || "Unknown"}`
              );
              lines.push(t.filePath);
            }
            content = lines.join("\r\n");
          } else if (ext === "pls") {
            const lines = ["[playlist]"];
            tracks.forEach((t, i) => {
              lines.push(`File${i + 1}=${t.filePath}`);
              lines.push(
                `Title${i + 1}=${t.artist || "Unknown"} - ${t.title || "Unknown"}`
              );
              lines.push(`Length${i + 1}=${Math.round(t.duration || -1)}`);
            });
            lines.push("", `NumberOfEntries=${tracks.length}`, "Version=2");
            content = lines.join("\r\n");
          } else if (ext === "xspf") {
            const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const items = tracks.map((t) => {
              if (!t?.filePath) return "";
              const fp = t.filePath.replace(/\\/g, "/");
              const uri = fp.startsWith("/") ? `file://${fp}` : `file:///${fp}`;
              return `    <track>
      <location>${esc(uri)}</location>
      <title>${esc(t.title)}</title>
      <creator>${esc(t.artist)}</creator>
      <album>${esc(t.album)}</album>${t.duration ? `
      <duration>${Math.round(t.duration * 1e3)}</duration>` : ""}
    </track>`;
            }).filter(Boolean).join("\n");
            content = `<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>${esc(playlist.name)}</title>
  <trackList>
${items}
  </trackList>
</playlist>`;
          } else {
            content = JSON.stringify(
              {
                name: playlist.name,
                createdAt: playlist.createdAt,
                updatedAt: Date.now(),
                tracks: tracks.map((t) => ({
                  filePath: t.filePath,
                  title: t.title || null,
                  artist: t.artist || null,
                  album: t.album || null,
                  duration: t.duration || 0
                }))
              },
              null,
              2
            );
          }
          fs.writeFileSync(filePath, content, ext === "m3u" ? "latin1" : "utf-8");
          return { success: true };
        } catch (err) {
          console.error("[playlist:export]", err.message);
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle(
        "playlist:show-save-dialog",
        async (event, { defaultName, formats }) => {
          try {
            const result = await dialog.showSaveDialog(mainWindow, {
              title: "Export Playlist",
              defaultPath: defaultName || "playlist",
              filters: formats || [
                { name: "M3U Playlist", extensions: ["m3u"] },
                { name: "M3U8 Playlist", extensions: ["m3u8"] },
                { name: "PLS Playlist", extensions: ["pls"] },
                { name: "XSPF Playlist", extensions: ["xspf"] },
                { name: "JSON Playlist", extensions: ["json"] }
              ]
            });
            if (result.canceled || !result.filePath) return { canceled: true };
            return { canceled: false, filePath: result.filePath };
          } catch (err) {
            return { success: false, error: err.message };
          }
        }
      );
      ipcMain.handle("playlist:show-open-dialog", async (event, { formats }) => {
        try {
          const result = await dialog.showOpenDialog(mainWindow, {
            title: "Import Playlist",
            properties: ["openFile"],
            filters: formats || [
              {
                name: "All Playlists",
                extensions: ["m3u", "m3u8", "pls", "xspf", "json"]
              },
              { name: "All Files", extensions: ["*"] }
            ]
          });
          if (result.canceled || result.filePaths.length === 0)
            return { canceled: true };
          return { canceled: false, filePath: result.filePaths[0] };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle(
        "playlist:write-file",
        async (event, { filePath, content }) => {
          try {
            const encoding = filePath.toLowerCase().endsWith(".m3u") ? "latin1" : "utf-8";
            fs.writeFileSync(filePath, content, encoding);
            return { success: true };
          } catch (err) {
            return { success: false, error: err.message };
          }
        }
      );
      ipcMain.handle("playlist:read-file", async (event, { filePath }) => {
        try {
          const encoding = filePath.toLowerCase().endsWith(".m3u") ? "latin1" : "utf-8";
          const content = fs.readFileSync(filePath, encoding);
          return { success: true, filePath, content };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("window:minimize", async () => {
        const win = BrowserWindow.getFocusedWindow() || mainWindow;
        if (win && !win.isDestroyed()) win.minimize();
        return { success: true };
      });
      ipcMain.handle("window:toggle-maximize", async () => {
        const win = BrowserWindow.getFocusedWindow() || mainWindow;
        if (win && !win.isDestroyed()) {
          if (win.isMaximized()) win.unmaximize();
          else win.maximize();
        }
        return { success: true };
      });
      ipcMain.handle("window:close", async () => {
        const win = BrowserWindow.getFocusedWindow() || mainWindow;
        if (win && !win.isDestroyed()) win.close();
        return { success: true };
      });
      ipcMain.handle("window:set-fullscreen", async (event, enabled) => {
        const win = BrowserWindow.getFocusedWindow() || mainWindow;
        if (win && !win.isDestroyed()) {
          win.setFullScreen(!!enabled);
        }
        return { success: true };
      });
      ipcMain.handle("window:set-overlay-chrome", async (event, hidden) => {
        const win = BrowserWindow.getFocusedWindow() || mainWindow;
        if (win && !win.isDestroyed() && process.platform === "win32") {
          win.setTitleBarOverlay(
            hidden ? {
              color: "rgba(0, 0, 0, 0)",
              symbolColor: "rgba(0, 0, 0, 0)",
              height: 0
            } : { color: "rgba(0, 0, 0, 0)", symbolColor: "#b3b3b3", height: 32 }
          );
        }
        return { success: true };
      });
      ipcMain.handle("smtc:update-metadata", (_, metadata) => {
        if (_smtcBridgeRef && typeof _smtcBridgeRef.updateMetadata === "function") {
          _smtcBridgeRef.updateMetadata(metadata);
        }
        return { success: true };
      });
      ipcMain.handle("smtc:update-status", (_, status) => {
        if (_smtcBridgeRef && typeof _smtcBridgeRef.updatePlaybackStatus === "function") {
          _smtcBridgeRef.updatePlaybackStatus(status);
        }
        if (global.updateThumbarButtons) {
          global.updateThumbarButtons(status === "playing");
        }
        return { success: true };
      });
      ipcMain.handle("smtc:update-position", (_, positionMs) => {
        if (_smtcBridgeRef && typeof _smtcBridgeRef.updatePosition === "function") {
          _smtcBridgeRef.updatePosition(positionMs);
        }
        return { success: true };
      });
      ipcMain.handle("app:get-startup-file", () => {
        const file = global.fileToPlayOnStartup;
        global.fileToPlayOnStartup = null;
        return file;
      });
      ipcMain.handle("lyrics:get-from-db", async (event, trackId) => {
        try {
          if (!trackId) return { success: false, error: "No trackId" };
          getLibrary();
          const track = libraryById ? libraryById.get(trackId) : null;
          if (!track) return { success: false, error: "Track not found" };
          console.log(`[lyrics:get-from-db] ${track.artist} - ${track.title}`);
          console.log(`  filePath     : ${track.filePath}`);
          console.log(`  lyricsPath   : ${track.lyricsPath || "none"}`);
          console.log(
            `  plainLyrics  : ${track.plainLyrics ? track.plainLyrics.slice(0, 60).replace(/\n/g, " ") + "\u2026" : "none"}`
          );
          console.log(
            `  syncedLyrics : ${track.syncedLyrics ? track.syncedLyrics.slice(0, 60).replace(/\n/g, " ") + "\u2026" : "none"}`
          );
          if (track.lyricsPath && fs.existsSync(track.lyricsPath)) {
            const content = fs.readFileSync(track.lyricsPath, "utf-8");
            const parsed = parseLRC(content);
            console.log(
              `  \u2192 served from lyricsPath (${parsed.synced ? parsed.synced.length + " synced lines" : "plain only"})`
            );
            return { success: true, lyrics: { ...parsed, source: "local-lrc" } };
          }
          if (track.syncedLyrics || track.plainLyrics) {
            let synced = null;
            if (track.syncedLyrics) {
              if (typeof track.syncedLyrics === "string") {
                try {
                  const parsed = JSON.parse(track.syncedLyrics);
                  synced = Array.isArray(parsed) ? parsed : parseLRC(track.syncedLyrics).synced;
                } catch {
                  synced = parseLRC(track.syncedLyrics).synced;
                }
              } else if (Array.isArray(track.syncedLyrics)) {
                synced = track.syncedLyrics;
              }
            }
            console.log(
              `  \u2192 served from DB (${synced ? synced.length + " synced lines" : "plain only"})`
            );
            return {
              success: true,
              lyrics: { synced, plain: track.plainLyrics || "", source: "db" }
            };
          }
          console.log(`  \u2192 no lyrics in DB for this track`);
          return { success: false, error: "No lyrics in DB" };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle(
        "lyrics:fetch-online",
        async (event, { artist, title, album, duration }) => {
          const HEADERS = {
            "User-Agent": "NovaTune/1.0 (https://github.com/novatune)",
            Accept: "application/json"
          };
          const TIMEOUT_MS = 12e3;
          async function lrcFetch(url) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
            try {
              const res = await net.fetch(url, {
                headers: HEADERS,
                signal: controller.signal
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return await res.json();
            } finally {
              clearTimeout(timer);
            }
          }
          try {
            const promises = [];
            if (artist && title) {
              const getParams = new URLSearchParams({
                track_name: title,
                artist_name: artist
              });
              if (album) getParams.append("album_name", album);
              if (duration) getParams.append("duration", Math.round(duration));
              promises.push(
                lrcFetch(`https://lrclib.net/api/get?${getParams}`).then(
                  (hit) => hit && (hit.plainLyrics || hit.syncedLyrics) ? hit : null
                ).catch(() => null)
              );
            }
            const searchParams = new URLSearchParams({ track_name: title });
            if (artist) searchParams.append("artist_name", artist);
            promises.push(
              lrcFetch(`https://lrclib.net/api/search?${searchParams}`).then((results) => {
                if (!Array.isArray(results) || results.length === 0) return null;
                if (duration) {
                  return results.find(
                    (r) => Math.abs((r.duration || 0) - duration) <= 2
                  ) || results[0];
                }
                return results[0];
              }).catch(() => null)
            );
            let match = null;
            const settled = await Promise.allSettled(promises);
            for (const r of settled) {
              if (r.status === "fulfilled" && r.value) {
                match = r.value;
                break;
              }
            }
            if (!match) return { success: false, error: "No lyrics found" };
            let parsedSynced = match.syncedLyrics ? parseLRC(match.syncedLyrics).synced : null;
            let plainText = match.plainLyrics || "";
            if (!parsedSynced && plainText) {
              const rescued = parseLRC(plainText);
              if (rescued.synced && rescued.synced.length > 0) {
                parsedSynced = rescued.synced;
                plainText = rescued.plain || rescued.synced.map((l) => l.text).join("\n");
              }
            }
            return {
              success: true,
              lyrics: {
                synced: parsedSynced,
                plain: plainText,
                source: "LRCLIB",
                title: match.trackName || title,
                artist: match.artistName || artist
              }
            };
          } catch (err) {
            const msg = err.name === "AbortError" ? "Request timed out" : err.message;
            return { success: false, error: msg };
          }
        }
      );
      ipcMain.handle("lyrics:search-online", async (event, { title, artist }) => {
        const HEADERS = {
          "User-Agent": "NovaTune/1.0 (https://github.com/novatune)",
          Accept: "application/json"
        };
        const TIMEOUT_MS = 15e3;
        const MAX_RETRIES = 3;
        const params = new URLSearchParams({ track_name: title });
        if (artist) params.append("artist_name", artist);
        const url = `https://lrclib.net/api/search?${params}`;
        let lastErr;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 1200 * attempt));
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
          try {
            const res = await net.fetch(url, {
              headers: HEADERS,
              signal: controller.signal
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const results = await res.json();
            return {
              success: true,
              results: Array.isArray(results) ? results : []
            };
          } catch (err) {
            lastErr = err;
            if (err.message && err.message.startsWith("HTTP 4")) break;
          } finally {
            clearTimeout(timer);
          }
        }
        const msg = lastErr.name === "AbortError" ? "Search timed out" : lastErr.message;
        return { success: false, error: msg };
      });
      ipcMain.handle("lyrics:read-local", async (event, filePath) => {
        try {
          const fileDir = path.dirname(filePath);
          const fileBase = path.basename(filePath, path.extname(filePath));
          const musicDir = fileDir;
          const lyriczDir = path.join(musicDir, "lyricz");
          const lyriczPath = path.join(lyriczDir, fileBase + ".lrc");
          if (fs.existsSync(lyriczPath)) {
            const content = fs.readFileSync(lyriczPath, "utf-8");
            const parsed = parseLRC(content);
            _lyricsBinaryMap.set(filePath, lyriczPath);
            return { success: true, lyrics: parsed };
          }
          const lrcPath = filePath.replace(path.extname(filePath), ".lrc");
          let sidecarPath = null;
          if (fs.existsSync(lrcPath)) {
            sidecarPath = lrcPath;
          } else {
            const lrcPathUpper = filePath.replace(path.extname(filePath), ".LRC");
            if (fs.existsSync(lrcPathUpper)) {
              sidecarPath = lrcPathUpper;
            }
          }
          if (sidecarPath) {
            const content = fs.readFileSync(sidecarPath, "utf-8");
            const parsed = parseLRC(content);
            try {
              if (!fs.existsSync(lyriczDir)) {
                fs.mkdirSync(lyriczDir, { recursive: true });
              }
              const dst = path.join(lyriczDir, fileBase + ".lrc");
              if (!fs.existsSync(dst)) {
                fs.renameSync(sidecarPath, dst);
                _lyricsBinaryMap.set(filePath, dst);
                console.log(
                  `[lyrics:read-local] auto-migrated ${path.basename(sidecarPath)} \u2192 lyricz/`
                );
              } else {
                fs.unlinkSync(sidecarPath);
                _lyricsBinaryMap.set(filePath, dst);
              }
            } catch (migErr) {
              _lyricsBinaryMap.set(filePath, sidecarPath);
            }
            return { success: true, lyrics: parsed };
          }
          return { success: false, error: "No local lyrics file found" };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("lyrics:read-embedded", async (event, filePath) => {
        try {
          if (!filePath || !fs.existsSync(filePath)) {
            return { success: false, error: "File not found" };
          }
          const mmMod = await import("music-metadata");
          const parseFile = mmMod.parseFile;
          const TimestampFormat = mmMod.TimestampFormat;
          const metadata = await parseFile(filePath, {
            skipCovers: true,
            skipPostProcessing: true
          });
          let plainText = "";
          let syncedLines = null;
          if (metadata.common && Array.isArray(metadata.common.lyrics) && metadata.common.lyrics.length > 0) {
            const lyricsArr = metadata.common.lyrics;
            const syltEntry = lyricsArr.find(
              (l) => Array.isArray(l.syncText) && l.syncText.length > 0
            );
            const usltEntry = lyricsArr.find(
              (l) => l.text && (!l.syncText || l.syncText.length === 0)
            );
            if (syltEntry) {
              const isMsFormat = syltEntry.timeStampFormat === (TimestampFormat ? TimestampFormat.milliseconds : 2);
              if (isMsFormat) {
                syncedLines = syltEntry.syncText.map((s) => ({
                  time: s.timestamp / 1e3,
                  text: s.text || ""
                })).filter((l) => l.text.trim()).sort((a, b) => a.time - b.time);
                if (syncedLines.length === 0) syncedLines = null;
              }
            }
            if (usltEntry && usltEntry.text) {
              plainText = usltEntry.text;
            }
          }
          if (!plainText && !syncedLines && metadata.native) {
            const id3 = metadata.native["ID3v2.4"] || metadata.native["ID3v2.3"] || [];
            for (const tag of id3) {
              if (tag.id === "USLT" && tag.value) {
                plainText = typeof tag.value === "string" ? tag.value : tag.value.text || String(tag.value);
                if (plainText && plainText.trim()) break;
              }
            }
            for (const tag of id3) {
              if (tag.id === "SYLT" && tag.value) {
                const raw = Array.isArray(tag.value) ? tag.value : [tag.value];
                const lines = [];
                for (const entry of raw) {
                  if (entry && entry.text != null && entry.timeStamp != null) {
                    lines.push({
                      time: entry.timeStamp / 1e3,
                      text: String(entry.text)
                    });
                  }
                }
                if (lines.length > 0) {
                  syncedLines = lines.sort((a, b) => a.time - b.time);
                  break;
                }
              }
            }
            if (!plainText && !syncedLines) {
              const vorbis = metadata.native["vorbis"] || [];
              for (const tag of vorbis) {
                if (tag.id === "LYRICS" && tag.value) {
                  plainText = String(tag.value);
                  break;
                }
              }
            }
            if (!plainText && !syncedLines) {
              const mp4 = metadata.native["iTunes"] || [];
              for (const tag of mp4) {
                if ((tag.id === "\xA9lyr" || tag.id === "lyr") && tag.value) {
                  plainText = String(tag.value);
                  break;
                }
              }
            }
            if (!plainText && !syncedLines) {
              const ape = metadata.native["APEv2"] || [];
              for (const tag of ape) {
                if ((tag.id === "LYRICS" || tag.id === "Lyrics") && tag.value) {
                  plainText = String(tag.value);
                  break;
                }
              }
            }
          }
          if (!plainText && !syncedLines) {
            return { success: false, error: "No embedded lyrics" };
          }
          if (!syncedLines && plainText) {
            const rescued = parseLRC(plainText);
            if (rescued.synced && rescued.synced.length > 0) {
              syncedLines = rescued.synced;
              plainText = rescued.plain || rescued.synced.map((l) => l.text).join("\n");
            }
          }
          return {
            success: true,
            lyrics: {
              synced: syncedLines,
              plain: plainText,
              source: "embedded"
            }
          };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle(
        "lyrics:save-to-track",
        async (event, { trackId, filePath, plain, synced }) => {
          try {
            const isEmpty = !plain && !synced;
            const fileDir = path.dirname(filePath);
            const fileBase = path.basename(filePath, path.extname(filePath));
            const lyriczDir = path.join(fileDir, "lyricz");
            const lrcPath = path.join(lyriczDir, fileBase + ".lrc");
            if (!isEmpty) {
              if (!fs.existsSync(lyriczDir)) {
                fs.mkdirSync(lyriczDir, { recursive: true });
              }
              fs.writeFileSync(lrcPath, synced || plain || "", "utf-8");
              _lyricsBinaryMap.set(filePath, lrcPath);
            } else {
              try {
                if (fs.existsSync(lrcPath)) fs.unlinkSync(lrcPath);
              } catch (_) {
              }
              const oldLrcPath = filePath.replace(/\.[^.]+$/, ".lrc");
              try {
                if (fs.existsSync(oldLrcPath)) fs.unlinkSync(oldLrcPath);
              } catch (_) {
              }
              _lyricsBinaryMap.delete(filePath);
            }
            try {
              const row = db.prepare("SELECT data FROM tracks WHERE id = ?").get(trackId);
              if (row) {
                const track = JSON.parse(row.data);
                track.lyricsPath = isEmpty ? null : lrcPath;
                track.plainLyrics = isEmpty ? null : plain || null;
                track.syncedLyrics = isEmpty ? null : synced || null;
                db.prepare("UPDATE tracks SET data = ? WHERE id = ?").run(
                  JSON.stringify(track),
                  trackId
                );
                if (libraryById && libraryById.has(trackId)) {
                  Object.assign(libraryById.get(trackId), {
                    lyricsPath: track.lyricsPath,
                    plainLyrics: track.plainLyrics,
                    syncedLyrics: track.syncedLyrics
                  });
                }
              }
            } catch (e) {
              console.error("[lyrics:save-to-track] patch failed:", e.message);
            }
            return { success: true, lrcPath: isEmpty ? null : lrcPath };
          } catch (err) {
            console.error("[lyrics:save-to-track]", err.message);
            return { success: false, error: err.message };
          }
        }
      );
      const _lyricsBinaryMap = /* @__PURE__ */ new Map();
      ipcMain.handle("lyrics:migrate-to-lyricz", async (event, musicFolders) => {
        try {
          let collectLrcFiles2 = function(dir) {
            const results = [];
            try {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                if (entry.isDirectory() && entry.name.toLowerCase() === "lyricz")
                  continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  results.push(...collectLrcFiles2(full));
                } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".lrc")) {
                  results.push({ dir, name: entry.name, fullPath: full });
                }
              }
            } catch (_) {
            }
            return results;
          };
          var collectLrcFiles = collectLrcFiles2;
          let moved = 0;
          let skipped = 0;
          let fromSubdirs = 0;
          const folders = Array.isArray(musicFolders) ? musicFolders : [];
          const allLrc = [];
          for (const folder of folders) {
            if (!fs.existsSync(folder)) continue;
            allLrc.push(...collectLrcFiles2(folder));
          }
          if (allLrc.length === 0) {
            _rebuildLyricsMap();
            return {
              success: true,
              moved: 0,
              skipped: folders.length,
              fromSubdirs: 0
            };
          }
          const movedPaths = [];
          for (const lrc of allLrc) {
            const lyriczDir = path.join(lrc.dir, "lyricz");
            try {
              if (!fs.existsSync(lyriczDir)) {
                fs.mkdirSync(lyriczDir, { recursive: true });
              }
              const dst = path.join(lyriczDir, lrc.name);
              if (!fs.existsSync(dst)) {
                fs.renameSync(lrc.fullPath, dst);
                moved++;
                movedPaths.push({ src: lrc.fullPath, dst, dir: lrc.dir });
              } else {
                fs.unlinkSync(lrc.fullPath);
                movedPaths.push({ src: lrc.fullPath, dst, dir: lrc.dir });
              }
              if (lrc.dir !== folders.find((f) => lrc.fullPath.startsWith(f))) {
                fromSubdirs++;
              }
            } catch (_) {
            }
          }
          if (db && movedPaths.length > 0) {
            try {
              const selectStmt = db.prepare("SELECT id, data FROM tracks");
              const updateStmt = db.prepare(
                "UPDATE tracks SET data = ? WHERE id = ?"
              );
              const rows = selectStmt.all();
              for (const row of rows) {
                try {
                  const track = JSON.parse(row.data);
                  const match = movedPaths.find(
                    (mp) => mp.src === track.lyricsPath
                  );
                  if (match) {
                    track.lyricsPath = match.dst;
                    updateStmt.run(JSON.stringify(track), row.id);
                  }
                } catch (_) {
                }
              }
              if (libraryById) {
                for (const [id, track] of libraryById) {
                  if (track.lyricsPath) {
                    const match = movedPaths.find(
                      (mp) => mp.src === track.lyricsPath
                    );
                    if (match) {
                      track.lyricsPath = match.dst;
                    }
                  }
                }
              }
            } catch (dbErr) {
              console.warn("[lyrics:migrate] DB patch failed:", dbErr.message);
            }
          }
          _rebuildLyricsMap();
          return { success: true, moved, skipped, fromSubdirs };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      function _rebuildLyricsMap() {
        _lyricsBinaryMap.clear();
        if (!libraryById) return;
        for (const [id, track] of libraryById) {
          if (track.filePath) {
            if (track.lyricsPath && fs.existsSync(track.lyricsPath)) {
              _lyricsBinaryMap.set(track.filePath, track.lyricsPath);
              continue;
            }
            const fileDir = path.dirname(track.filePath);
            const fileBase = path.basename(
              track.filePath,
              path.extname(track.filePath)
            );
            const lyriczPath = path.join(fileDir, "lyricz", fileBase + ".lrc");
            if (fs.existsSync(lyriczPath)) {
              _lyricsBinaryMap.set(track.filePath, lyriczPath);
              continue;
            }
            const sidecarPath = track.filePath.replace(/\.[^.]+$/, ".lrc");
            if (fs.existsSync(sidecarPath)) {
              _lyricsBinaryMap.set(track.filePath, sidecarPath);
            }
          }
        }
      }
      ipcMain.handle("lyrics:fast-lookup", async (event, filePath) => {
        try {
          if (_lyricsBinaryMap.size === 0 && libraryById) {
            _rebuildLyricsMap();
          }
          if (_lyricsBinaryMap.has(filePath)) {
            const lrcPath = _lyricsBinaryMap.get(filePath);
            const content = fs.readFileSync(lrcPath, "utf-8");
            const parsed = parseLRC(content);
            return { success: true, lyrics: parsed };
          }
          return { success: false };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("lyrics:rebuild-map", async () => {
        try {
          _rebuildLyricsMap();
          return { success: true, size: _lyricsBinaryMap.size };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
    }
    function parseLRC(content) {
      if (typeof content !== "string") return { synced: null, plain: "" };
      const lines = content.split("\n");
      const synced = [];
      const plain = [];
      const timeRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\]/g;
      const stripRegex = /\[\d{1,3}:\d{2}(?:[.:]\d{2,3})?\]/g;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("[ti:") || trimmed.startsWith("[ar:") || trimmed.startsWith("[al:") || trimmed.startsWith("[by:") || trimmed.startsWith("[offset:")) {
          if (!trimmed.match(/^\[/)) plain.push(trimmed);
          continue;
        }
        const timeMatches = [...trimmed.matchAll(timeRegex)];
        if (timeMatches.length > 0) {
          const text = trimmed.replace(stripRegex, "").trim();
          for (const match of timeMatches) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            let ms = 0;
            if (match[3]) {
              const msStr = match[3];
              if (msStr.length === 2) ms = parseInt(msStr, 10) * 10;
              else if (msStr.length === 1) ms = parseInt(msStr, 10) * 100;
              else ms = parseInt(msStr, 10);
            }
            const time = minutes * 60 + seconds + ms / 1e3;
            if (text) synced.push({ time, text });
          }
          if (text) plain.push(text);
        } else {
          plain.push(trimmed);
        }
      }
      synced.sort((a, b) => a.time - b.time);
      return {
        synced: synced.length > 0 ? synced : null,
        plain: plain.join("\n")
      };
    }
    module2.exports = registerIPCHandlers;
    module2.exports.setSMTCBridge = setSMTCBridge;
    module2.exports.getLibraryForManifest = function() {
      try {
        return getLibrary();
      } catch (_) {
        return null;
      }
    };
    var _coverArtByIdCache = /* @__PURE__ */ new Map();
    function getCoverArtByTrackId(trackId) {
      const cached = _coverArtByIdCache.get(trackId);
      if (cached !== void 0) return cached;
      if (!db) {
        return null;
      }
      let result = null;
      try {
        const row = db.prepare("SELECT coverArt FROM track_covers WHERE trackId = ?").get(trackId);
        result = row ? row.coverArt : null;
      } catch (err) {
        console.error("Failed to query track_covers:", err.message);
      }
      _coverArtByIdCache.set(trackId, result);
      return result;
    }
    module2.exports.getCoverArtByTrackId = getCoverArtByTrackId;
    function findAlternativeTrackPath(originalPath) {
      try {
        if (!db) return null;
        const normalizedPath = path.win32.normalize(originalPath);
        const row = db.prepare("SELECT id, title, artist, data FROM tracks WHERE filePath = ?").get(normalizedPath);
        if (!row || !row.title) return null;
        const alternatives = db.prepare(
          `
      SELECT filePath FROM tracks 
      WHERE title = ? COLLATE NOCASE 
        AND artist = ? COLLATE NOCASE 
        AND filePath != ?
    `
        ).all(row.title, row.artist, normalizedPath);
        for (const alt of alternatives) {
          if (alt.filePath && fs.existsSync(alt.filePath)) {
            try {
              const trackData = JSON.parse(row.data);
              trackData.filePath = alt.filePath;
              db.prepare(
                `
            UPDATE tracks 
            SET filePath = ?, data = ?
            WHERE id = ?
          `
              ).run(alt.filePath, JSON.stringify(trackData), row.id);
              libraryCache = null;
              _libraryDirty = true;
              console.log(
                `[self-healing] Updated DB track ${row.id} to new path: ${alt.filePath}`
              );
            } catch (updateErr) {
              console.warn(
                "[self-healing] Failed to update DB path:",
                updateErr.message
              );
            }
            return alt.filePath;
          }
        }
      } catch (err) {
        console.warn("Failed to find alternative track path:", err.message);
      }
      return null;
    }
    module2.exports.findAlternativeTrackPath = findAlternativeTrackPath;
    var CURRENT_VERSION = require_package().version || "1.0.0";
    var _pendingUpdatePath = null;
    function _pickInstallerAsset(assets, version) {
      const exeAssets = (assets || []).filter(
        (a) => /\.exe$/i.test(a.name) && !/\.blockmap$/i.test(a.name)
      );
      if (!exeAssets.length) return null;
      const versioned = exeAssets.find((a) => a.name.includes(version));
      if (versioned) return versioned;
      return exeAssets.sort((a, b) => {
        const va = (a.name.match(/(\d+\.\d+\.\d+)/) || [, "0.0.0"])[1];
        const vb = (b.name.match(/(\d+\.\d+\.\d+)/) || [, "0.0.0"])[1];
        return compareVersions(vb, va);
      })[0];
    }
    ipcMain.handle("app:check-update", async () => {
      try {
        const { autoUpdater } = require("electron-updater");
        const { app: app2 } = require("electron");
        if (autoUpdater && app2.isPackaged) {
          const result = await autoUpdater.checkForUpdates();
          if (result && result.updateInfo) {
            const latestVersion = result.updateInfo.version;
            const hasUpdate = latestVersion && compareVersions(latestVersion, CURRENT_VERSION) > 0;
            return {
              success: true,
              currentVersion: CURRENT_VERSION,
              latestVersion: latestVersion || CURRENT_VERSION,
              hasUpdate,
              releaseNotes: result.updateInfo.releaseNotes || "",
              source: "electron-updater"
            };
          }
        }
      } catch (_) {
      }
      try {
        const response = await net.fetch(
          "https://api.github.com/repos/AnonymousV73X/WINDOWS-MUSIC-PLAYER/releases/latest",
          {
            headers: { "User-Agent": "NovaTune-Update-Check" }
          }
        );
        if (!response.ok) {
          return { success: false, error: `HTTP ${response.status}` };
        }
        const data = await response.json();
        const latestVersion = (data.tag_name || "").replace(/^v/, "");
        const hasUpdate = latestVersion && compareVersions(latestVersion, CURRENT_VERSION) > 0;
        const installerAsset = _pickInstallerAsset(data.assets, latestVersion);
        return {
          success: true,
          currentVersion: CURRENT_VERSION,
          latestVersion: latestVersion || CURRENT_VERSION,
          hasUpdate,
          releaseUrl: data.html_url || "",
          releaseNotes: data.body || "",
          downloadUrl: installerAsset ? installerAsset.browser_download_url : "",
          source: "github-api"
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });
    ipcMain.handle("app:download-update", async () => {
      try {
        const { autoUpdater } = require("electron-updater");
        if (autoUpdater && app.isPackaged) {
          await autoUpdater.downloadUpdate();
          return { success: true };
        }
      } catch (_) {
      }
      try {
        const response = await net.fetch(
          "https://api.github.com/repos/AnonymousV73X/WINDOWS-MUSIC-PLAYER/releases/latest",
          { headers: { "User-Agent": "NovaTune-Update-Check" } }
        );
        if (!response.ok) {
          return { success: false, error: `HTTP ${response.status}` };
        }
        const data = await response.json();
        const latestVersion = (data.tag_name || "").replace(/^v/, "");
        const asset = _pickInstallerAsset(data.assets, latestVersion);
        if (!asset) {
          return {
            success: false,
            error: "No installer (.exe) found in latest release"
          };
        }
        const dest = path.join(app.getPath("temp"), asset.name);
        const dlResponse = await net.fetch(asset.browser_download_url);
        if (!dlResponse.ok || !dlResponse.body) {
          return { success: false, error: `HTTP ${dlResponse.status}` };
        }
        const total = Number(dlResponse.headers.get("content-length")) || 0;
        let received = 0;
        const fileStream = fs.createWriteStream(dest);
        const reader = dlResponse.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.length;
          fileStream.write(Buffer.from(value));
          BrowserWindow.getAllWindows()[0]?.webContents.send(
            "update:download-progress",
            {
              percent: total ? received / total * 100 : 0,
              transferred: received,
              total
            }
          );
        }
        await new Promise((resolve, reject) => {
          fileStream.end((err) => err ? reject(err) : resolve());
        });
        _pendingUpdatePath = dest;
        BrowserWindow.getAllWindows()[0]?.webContents.send("update:downloaded");
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });
    ipcMain.handle("app:install-update", async () => {
      if (_pendingUpdatePath && fs.existsSync(_pendingUpdatePath)) {
        try {
          const openErr = await shell.openPath(_pendingUpdatePath);
          if (openErr) {
            return { success: false, error: openErr };
          }
          setTimeout(() => app.quit(), 500);
          return { success: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
      try {
        const { autoUpdater } = require("electron-updater");
        if (!autoUpdater) {
          return { success: false, error: "electron-updater not installed" };
        }
        autoUpdater.quitAndInstall(false, true);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });
    ipcMain.handle("app:open-external", async (_event, url) => {
      try {
        await shell.openExternal(url);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });
    var _thumbStubsPath = null;
    var _thumbStubsCache = null;
    var _thumbStubsDirty = false;
    var _thumbStubsSaveTimer = null;
    function _getThumbStubsPath() {
      if (_thumbStubsPath) return _thumbStubsPath;
      _thumbStubsPath = path.join(app.getPath("userData"), "thumb-stubs.json");
      return _thumbStubsPath;
    }
    function _readThumbStubsSync() {
      if (_thumbStubsCache !== null) return _thumbStubsCache;
      try {
        const p = _getThumbStubsPath();
        if (fs.existsSync(p)) {
          const txt = fs.readFileSync(p, "utf-8");
          _thumbStubsCache = JSON.parse(txt);
          if (!_thumbStubsCache || typeof _thumbStubsCache !== "object") {
            _thumbStubsCache = {};
          }
        } else {
          _thumbStubsCache = {};
        }
      } catch (err) {
        console.warn("[thumb-stubs] failed to read stub file:", err.message);
        _thumbStubsCache = {};
      }
      return _thumbStubsCache;
    }
    function _scheduleThumbStubsSave() {
      if (_thumbStubsSaveTimer) return;
      _thumbStubsSaveTimer = setTimeout(() => {
        _thumbStubsSaveTimer = null;
        _thumbStubsDirty = false;
        try {
          const p = _getThumbStubsPath();
          const data = _thumbStubsCache || {};
          const tmp = p + ".tmp";
          fs.writeFileSync(tmp, JSON.stringify(data), "utf-8");
          fs.renameSync(tmp, p);
        } catch (err) {
          console.warn("[thumb-stubs] failed to save stub file:", err.message);
        }
      }, 1e3);
    }
    ipcMain.handle("thumb-stubs:load", async () => {
      try {
        return { success: true, stubs: _readThumbStubsSync() };
      } catch (err) {
        return { success: false, error: err.message, stubs: {} };
      }
    });
    ipcMain.handle("thumb-stubs:save", async (_event, stubs) => {
      try {
        if (!stubs || typeof stubs !== "object") {
          return { success: false, error: "stubs must be an object" };
        }
        _thumbStubsCache = stubs;
        _thumbStubsDirty = true;
        _scheduleThumbStubsSave();
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });
    ipcMain.handle("thumb-stubs:patch", async (_event, patch) => {
      try {
        if (!patch || typeof patch !== "object") {
          return { success: false, error: "patch must be an object" };
        }
        const cache = _readThumbStubsSync();
        let added = 0, removed = 0;
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === void 0) {
            if (cache[k] !== void 0) {
              delete cache[k];
              removed++;
            }
          } else {
            if (cache[k] !== v) {
              cache[k] = v;
              added++;
            }
          }
        }
        if (added > 0 || removed > 0) {
          _thumbStubsDirty = true;
          _scheduleThumbStubsSave();
        }
        return { success: true, added, removed };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });
    var ARTIST_IMAGE_CACHE_DIR = () => path.join(app.getPath("userData"), "cached_covers", "artists");
    function _artistImageHash(artistName) {
      return crypto.createHash("sha256").update(artistName.toLowerCase().trim()).digest("hex").substring(0, 16);
    }
    var _artistImageCache = /* @__PURE__ */ new Map();
    function _loadArtistImageCache() {
      try {
        const dir = ARTIST_IMAGE_CACHE_DIR();
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (/\.(jpg|jpeg|png|webp)$/i.test(file)) {
          }
        }
        const mapFile = path.join(dir, "artist-images.json");
        if (fs.existsSync(mapFile)) {
          const map = JSON.parse(fs.readFileSync(mapFile, "utf-8"));
          for (const [name, p] of Object.entries(map)) {
            if (fs.existsSync(p)) {
              _artistImageCache.set(name.toLowerCase(), p);
            }
          }
        }
      } catch (_) {
      }
    }
    function _saveArtistImageMap() {
      try {
        const dir = ARTIST_IMAGE_CACHE_DIR();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const mapFile = path.join(dir, "artist-images.json");
        const map = {};
        for (const [k, v] of _artistImageCache) {
          map[k] = v;
        }
        fs.writeFileSync(mapFile, JSON.stringify(map, null, 2), "utf-8");
      } catch (_) {
      }
    }
    async function _fetchArtistImageOnline(artistName) {
      const name = (artistName || "").trim();
      if (!name || name === "Unknown Artist") return null;
      try {
        const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=1`;
        const resp = await fetch(itunesUrl, {
          signal: AbortSignal.timeout(8e3),
          headers: { "User-Agent": "NovaTune/1.2.0" }
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.results && data.results.length > 0) {
            const artist = data.results[0];
            if (artist.artistLinkUrl) {
              const lookupUrl = `https://itunes.apple.com/lookup?id=${artist.artistId}&entity=musicArtist`;
              const lookupResp = await fetch(lookupUrl, {
                signal: AbortSignal.timeout(8e3),
                headers: { "User-Agent": "NovaTune/1.2.0" }
              });
              if (lookupResp.ok) {
                const lookupData = await lookupResp.json();
                if (lookupData.results && lookupData.results.length > 0) {
                  const a = lookupData.results[0];
                  if (a.artworkUrl100) {
                    return a.artworkUrl100.replace("100x100", "600x600");
                  }
                }
              }
            }
          }
        }
      } catch (_) {
      }
      try {
        const deezerUrl = `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`;
        const resp = await fetch(deezerUrl, {
          signal: AbortSignal.timeout(8e3),
          headers: { "User-Agent": "NovaTune/1.2.0" }
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.data && data.data.length > 0) {
            const artist = data.data[0];
            const imgUrl = artist.picture_xl || artist.picture_big || artist.picture_medium || artist.picture;
            if (imgUrl && !imgUrl.includes("deezer.com/images/artist/default")) {
              return imgUrl;
            }
          }
        }
      } catch (_) {
      }
      return null;
    }
    async function _downloadArtistImage(url, artistName) {
      try {
        const dir = ARTIST_IMAGE_CACHE_DIR();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const hash = _artistImageHash(artistName);
        let ext = ".jpg";
        if (url.includes(".png")) ext = ".png";
        else if (url.includes(".webp")) ext = ".webp";
        const localPath = path.join(dir, `${hash}${ext}`);
        if (fs.existsSync(localPath)) return localPath;
        const resp = await fetch(url, {
          signal: AbortSignal.timeout(15e3),
          headers: { "User-Agent": "NovaTune/1.2.0" }
        });
        if (!resp.ok) return null;
        const buffer = Buffer.from(await resp.arrayBuffer());
        if (buffer.length < 2048) {
          console.log(
            `[artist-image] Rejected "${artistName}" \u2014 file too small (${buffer.length} bytes)`
          );
          return null;
        }
        try {
          const sharp = require("sharp");
          const metadata = await sharp(buffer).metadata();
          if (!metadata.width || !metadata.height || metadata.width < 100 || metadata.height < 100) {
            console.log(
              `[artist-image] Rejected "${artistName}" \u2014 image too small (${metadata.width}\xD7${metadata.height})`
            );
            return null;
          }
          const tiny = await sharp(buffer).resize(32, 32, { fit: "cover" }).raw().toBuffer();
          let sum = 0, sumSq = 0, n = 0;
          let rSum = 0, gSum = 0, bSum = 0;
          for (let i = 0; i < tiny.length; i += 4) {
            const r = tiny[i], g = tiny[i + 1], b = tiny[i + 2];
            sum += r + g + b;
            sumSq += r * r + g * g + b * b;
            rSum += r;
            gSum += g;
            bSum += b;
            n += 3;
          }
          const mean = sum / n;
          const variance = sumSq / n - mean * mean;
          const stdev = Math.sqrt(Math.max(0, variance));
          const rMean = rSum / (n / 3);
          const gMean = gSum / (n / 3);
          const bMean = bSum / (n / 3);
          const isNearWhite = mean > 235 && stdev < 25;
          const isNearBlack = mean < 15;
          const isAllWhite = rMean > 240 && gMean > 240 && bMean > 240;
          const isLowVariance = stdev < 15;
          if (isNearWhite || isNearBlack || isAllWhite || isLowVariance) {
            console.log(
              `[artist-image] Rejected "${artistName}" \u2014 placeholder (mean=${mean.toFixed(1)}, stdev=${stdev.toFixed(1)}, r=${rMean.toFixed(0)} g=${gMean.toFixed(0)} b=${bMean.toFixed(0)})`
            );
            return null;
          }
        } catch (sharpErr) {
          console.log(
            `[artist-image] Rejected "${artistName}" \u2014 Sharp validation failed: ${sharpErr.message}`
          );
          return null;
        }
        fs.writeFileSync(localPath, buffer);
        return localPath;
      } catch (_) {
        return null;
      }
    }
    async function _validateSavedArtistImage(filePath) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.size < 2048) return false;
        const sharp = require("sharp");
        const buffer = fs.readFileSync(filePath);
        const metadata = await sharp(buffer).metadata();
        if (!metadata.width || !metadata.height || metadata.width < 100 || metadata.height < 100) {
          return false;
        }
        const tiny = await sharp(buffer).resize(32, 32, { fit: "cover" }).raw().toBuffer();
        let sum = 0, sumSq = 0, n = 0;
        let rSum = 0, gSum = 0, bSum = 0;
        for (let i = 0; i < tiny.length; i += 4) {
          const r = tiny[i], g = tiny[i + 1], b = tiny[i + 2];
          sum += r + g + b;
          sumSq += r * r + g * g + b * b;
          rSum += r;
          gSum += g;
          bSum += b;
          n += 3;
        }
        const mean = sum / n;
        const variance = sumSq / n - mean * mean;
        const stdev = Math.sqrt(Math.max(0, variance));
        const rMean = rSum / (n / 3);
        const gMean = gSum / (n / 3);
        const bMean = bSum / (n / 3);
        const isNearWhite = mean > 235 && stdev < 25;
        const isNearBlack = mean < 15;
        const isAllWhite = rMean > 240 && gMean > 240 && bMean > 240;
        const isLowVariance = stdev < 15;
        return !(isNearWhite || isNearBlack || isAllWhite || isLowVariance);
      } catch (_) {
        return false;
      }
    }
    ipcMain.handle("artist-image:fetch", async (event, { artistName } = {}) => {
      try {
        const name = (artistName || "").trim();
        if (!name || name === "Unknown Artist") {
          return { success: true, localPath: null };
        }
        const key = name.toLowerCase();
        if (_artistImageCache.has(key)) {
          return { success: true, localPath: _artistImageCache.get(key) };
        }
        const imageUrl = await _fetchArtistImageOnline(name);
        if (!imageUrl) {
          _artistImageCache.set(key, null);
          _saveArtistImageMap();
          return { success: true, localPath: null };
        }
        const localPath = await _downloadArtistImage(imageUrl, name);
        if (localPath) {
          _artistImageCache.set(key, localPath);
          _saveArtistImageMap();
          console.log(`[artist-image] Saved image for "${name}" \u2192 ${localPath}`);
          return { success: true, localPath };
        }
        _artistImageCache.set(key, null);
        _saveArtistImageMap();
        return { success: true, localPath: null };
      } catch (err) {
        return { success: false, error: err.message, localPath: null };
      }
    });
    ipcMain.handle("artist-image:load-all", async () => {
      try {
        if (_artistImageCache.size === 0) {
          _loadArtistImageCache();
        }
        const result = {};
        for (const [name, localPath] of _artistImageCache) {
          if (localPath) result[name] = localPath;
        }
        return { success: true, images: result };
      } catch (err) {
        return { success: false, error: err.message, images: {} };
      }
    });
    ipcMain.handle("artist-image:get", async (event, { artistName } = {}) => {
      try {
        const name = (artistName || "").trim().toLowerCase();
        if (!name) return { success: true, localPath: null };
        if (_artistImageCache.size === 0) _loadArtistImageCache();
        return { success: true, localPath: _artistImageCache.get(name) || null };
      } catch (err) {
        return { success: false, error: err.message, localPath: null };
      }
    });
    ipcMain.handle("artist-image:validate-saved", async () => {
      try {
        const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
        if (settings._artistImageValidationV122) {
          return { success: true, validated: false, reason: "already-done" };
        }
        settings._artistImageValidationV122 = true;
        writeJSON(SETTINGS_FILE, settings);
        if (_artistImageCache.size === 0) _loadArtistImageCache();
        const dir = ARTIST_IMAGE_CACHE_DIR();
        if (!fs.existsSync(dir)) {
          return { success: true, validated: true, deletedCount: 0 };
        }
        let deletedCount = 0;
        let validCount = 0;
        const toDelete = [];
        for (const [name, localPath] of [..._artistImageCache]) {
          if (!localPath || !fs.existsSync(localPath)) {
            _artistImageCache.delete(name);
            continue;
          }
          const isValid = await _validateSavedArtistImage(localPath);
          if (!isValid) {
            toDelete.push({ name, path: localPath });
          } else {
            validCount++;
          }
        }
        for (const { name, path: p } of toDelete) {
          try {
            fs.unlinkSync(p);
            _artistImageCache.delete(name);
            deletedCount++;
            console.log(
              `[artist-image] Migration deleted invalid image for "${name}"`
            );
          } catch (_) {
          }
        }
        _saveArtistImageMap();
        console.log(
          `[artist-image] Migration: ${validCount} valid, ${deletedCount} deleted (corrupt/placeholder)`
        );
        return { success: true, validated: true, deletedCount, validCount };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });
    ipcMain.handle(
      "artist-image:save-custom",
      async (event, { artistName, localFilePath, url } = {}) => {
        try {
          const name = (artistName || "").trim();
          if (!name) return { success: false, error: "No artist name provided" };
          let buffer;
          if (localFilePath) {
            if (!fs.existsSync(localFilePath)) {
              return { success: false, error: "File not found: " + localFilePath };
            }
            buffer = fs.readFileSync(localFilePath);
          } else if (url) {
            const resp = await fetch(url, {
              signal: AbortSignal.timeout(2e4),
              headers: { "User-Agent": "NovaTune/1.2.0" }
            });
            if (!resp.ok) {
              return {
                success: false,
                error: `Download failed: HTTP ${resp.status}`
              };
            }
            buffer = Buffer.from(await resp.arrayBuffer());
          } else {
            return { success: false, error: "Provide localFilePath or url" };
          }
          if (!buffer || buffer.length < 100) {
            return { success: false, error: "Image data is empty or too small" };
          }
          const sharp = require("sharp");
          let croppedBuffer;
          try {
            croppedBuffer = await sharp(buffer).resize(600, 600, { fit: "cover", position: "attention" }).jpeg({ quality: 90 }).toBuffer();
          } catch (sharpErr) {
            try {
              croppedBuffer = await sharp(buffer, { failOnError: false }).resize(600, 600, { fit: "cover", position: "attention" }).jpeg({ quality: 90 }).toBuffer();
            } catch (_) {
              return {
                success: false,
                error: "Could not decode image: " + sharpErr.message
              };
            }
          }
          const dir = ARTIST_IMAGE_CACHE_DIR();
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const hash = _artistImageHash(name);
          try {
            const existingFiles = fs.readdirSync(dir);
            for (const f of existingFiles) {
              if (f.startsWith(hash + "_") || f === hash + ".jpg") {
                try {
                  fs.unlinkSync(path.join(dir, f));
                } catch (_) {
                }
              }
            }
          } catch (_) {
          }
          const localPath = path.join(dir, `${hash}_${Date.now()}.jpg`);
          fs.writeFileSync(localPath, croppedBuffer);
          _artistImageCache.set(name.toLowerCase(), localPath);
          _saveArtistImageMap();
          console.log(
            `[artist-image:save-custom] Saved custom image for "${name}" \u2192 ${localPath}`
          );
          return { success: true, localPath };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
    );
    ipcMain.handle(
      "coverart:ensure-thumbs",
      async (event, { trackIds, size = 128 } = {}) => {
        try {
          if (!Array.isArray(trackIds) || trackIds.length === 0) {
            return { success: true, thumbs: {}, missing: [] };
          }
          const sharp = require("sharp");
          const thumbDir = path.join(
            app.getPath("userData"),
            "cached_covers",
            "thumbs"
          );
          if (!fs.existsSync(thumbDir)) {
            await fs.promises.mkdir(thumbDir, { recursive: true });
          }
          const thumbs = {};
          const missing = [];
          const library2 = getLibrary();
          const libById = new Map(library2.map((t) => [t.id, t]));
          const BATCH = 8;
          for (let i = 0; i < trackIds.length; i += BATCH) {
            const batch = trackIds.slice(i, i + BATCH);
            await Promise.allSettled(
              batch.map(async (trackId) => {
                try {
                  const thumbFile = path.join(thumbDir, `${trackId}_${size}.webp`);
                  const exists = await fs.promises.access(thumbFile).then(() => true).catch(() => false);
                  if (exists) {
                    thumbs[trackId] = `nova-media://thumb/${trackId}/${size}`;
                    return;
                  }
                  const track = libById.get(trackId);
                  let coverArt = track?.coverArt || null;
                  if (!coverArt) {
                    coverArt = getCoverArtByTrackId(trackId);
                  }
                  if (!coverArt) {
                    missing.push(trackId);
                    return;
                  }
                  let inputBuffer;
                  if (coverArt.startsWith("data:")) {
                    const base64 = coverArt.split(",")[1];
                    if (!base64) return;
                    inputBuffer = Buffer.from(base64, "base64");
                  } else {
                    try {
                      inputBuffer = await fs.promises.readFile(coverArt);
                    } catch (_) {
                      missing.push(trackId);
                      return;
                    }
                  }
                  const metadata = await sharp(inputBuffer).metadata();
                  const side = Math.min(metadata.width, metadata.height);
                  const left = Math.floor((metadata.width - side) / 2);
                  const top = Math.floor((metadata.height - side) / 2);
                  const thumbBuffer = await sharp(inputBuffer).extract({ left, top, width: side, height: side }).resize(size, size, { fit: "cover" }).webp({ quality: 90 }).toBuffer();
                  await fs.promises.writeFile(thumbFile, thumbBuffer);
                  thumbs[trackId] = `nova-media://thumb/${trackId}/${size}`;
                } catch (_) {
                  missing.push(trackId);
                }
              })
            );
            await new Promise((resolve) => setImmediate(resolve));
            if (Date.now() - (global._lastAudioActivity || 0) < 1500) {
              await new Promise((resolve) => setTimeout(resolve, 40));
            }
          }
          return { success: true, thumbs, missing };
        } catch (err) {
          return { success: false, error: err.message, thumbs: {}, missing: [] };
        }
      }
    );
    ipcMain.handle("coverart:sibling-cover", async (event, { trackId } = {}) => {
      try {
        if (!trackId) return { success: false, error: "trackId required" };
        const library2 = getLibrary();
        const track = library2.find((t) => t.id === trackId);
        if (!track || !track.filePath) {
          return { success: true, coverArt: null };
        }
        const dir = path.dirname(track.filePath);
        const siblings = library2.filter(
          (t) => t.id !== trackId && t.filePath && path.dirname(t.filePath) === dir && (t.coverArt || t._hasCoverArt)
        );
        if (siblings.length === 0) {
          return { success: true, coverArt: null };
        }
        const sibling = siblings[0];
        let coverArt = sibling.coverArt;
        if (!coverArt && sibling._hasCoverArt) {
          coverArt = getCoverArtByTrackId(sibling.id);
        }
        return {
          success: true,
          coverArt,
          sourceTrackId: sibling.id,
          sourceTitle: sibling.title
        };
      } catch (err) {
        return { success: false, error: err.message, coverArt: null };
      }
    });
    ipcMain.handle("coverart:migrate-v114", async () => {
      try {
        const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
        if (settings._thumbMigrationV114) {
          return { success: true, migrated: false, reason: "already-done" };
        }
        const thumbDir = path.join(
          app.getPath("userData"),
          "cached_covers",
          "thumbs"
        );
        let deletedCount = 0;
        if (fs.existsSync(thumbDir)) {
          const files = await fs.promises.readdir(thumbDir);
          const deletePromises = files.map(async (file) => {
            if (/_48\.webp$/i.test(file) || /_96\.webp$/i.test(file)) {
              try {
                await fs.promises.unlink(path.join(thumbDir, file));
                deletedCount++;
              } catch (_) {
              }
            }
          });
          await Promise.allSettled(deletePromises);
        }
        settings._thumbMigrationV114 = true;
        writeJSON(SETTINGS_FILE, settings);
        console.log(
          `[migrate-v114] Deleted ${deletedCount} old thumbnail files (48px + 96px)`
        );
        return { success: true, migrated: true, deletedCount };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });
    function compareVersions(a, b) {
      const pa = (a || "0").split(".").map(Number);
      const pb = (b || "0").split(".").map(Number);
      for (let i = 0; i < 3; i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
      }
      return 0;
    }
  }
});

// main/smtc.js
var require_smtc = __commonJS({
  "main/smtc.js"(exports2, module2) {
    var { ipcMain } = require("electron");
    var path = require("path");
    var fs = require("fs");
    var os = require("os");
    var SMTCBridge = class {
      constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.isInitialized = false;
        this.currentMetadata = null;
        this.currentPosition = 0;
        this.playbackStatus = "stopped";
        this._thumbTempPath = null;
        this.nativeMediaControls = null;
        try {
          this.NativeMediaControls = require("windows-media-controls");
        } catch (e) {
          console.log("windows-media-controls not available \u2014 SMTC in simulation mode.");
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
        this.isInitialized = true;
        console.log("SMTC Bridge initialized");
      }
      _initializeNative() {
        try {
          this.nativeMediaControls = new this.NativeMediaControls();
          const controls = this.nativeMediaControls;
          const caps = ["play", "pause", "next", "previous", "stop"];
          if (typeof controls.setSupportedPlaybackCommands === "function") {
            controls.setSupportedPlaybackCommands(caps);
          } else if (typeof controls.setControls === "function") {
            controls.setControls(caps);
          } else if (typeof controls.setIsEnabled === "function") {
            controls.setIsEnabled(true);
          }
          const fwd = (nativeEvent, ipcChannel) => {
            if (typeof controls.on === "function") {
              controls.on(
                nativeEvent,
                (...args) => this._forwardToRenderer(ipcChannel, args[0])
              );
            }
          };
          fwd("play", "smtc:play");
          fwd("pause", "smtc:pause");
          fwd("next", "smtc:next");
          fwd("previous", "smtc:previous");
          fwd("stop", "smtc:stop");
          fwd("seek", "smtc:seek");
          console.log("Native SMTC controls registered");
        } catch (err) {
          console.warn("Failed to init native SMTC, falling back to simulation:", err.message);
          this.nativeMediaControls = null;
          this._initializeSimulation();
        }
      }
      _initializeSimulation() {
        ipcMain.on("smtc:simulation-play", () => this._forwardToRenderer("smtc:play"));
        ipcMain.on("smtc:simulation-pause", () => this._forwardToRenderer("smtc:pause"));
        ipcMain.on("smtc:simulation-next", () => this._forwardToRenderer("smtc:next"));
        ipcMain.on("smtc:simulation-previous", () => this._forwardToRenderer("smtc:previous"));
        ipcMain.on(
          "smtc:simulation-seek",
          (_, position) => this._forwardToRenderer("smtc:seek", position)
        );
        console.log("SMTC running in simulation mode");
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
          const map = { playing: "Playing", paused: "Paused", stopped: "Stopped" };
          const native = map[status] || "Stopped";
          if (typeof this.nativeMediaControls.setPlaybackStatus === "function") {
            this.nativeMediaControls.setPlaybackStatus(native);
          } else if (typeof this.nativeMediaControls.playbackStatus !== "undefined") {
            this.nativeMediaControls.playbackStatus = native;
          }
        } catch (err) {
          console.warn("SMTC setPlaybackStatus failed:", err.message);
        }
      }
      updateMetadata(metadata) {
        this.currentMetadata = metadata;
        if (!this.nativeMediaControls) return;
        try {
          let albumArt = "";
          if (metadata.coverArt) {
            try {
              albumArt = this._dataUriToTempFile(metadata.coverArt);
            } catch (_) {
            }
          }
          if (typeof this.nativeMediaControls.update === "function") {
            this.nativeMediaControls.update({
              title: metadata.title || "NovaTune",
              artist: metadata.artist || "",
              album: metadata.album || "",
              albumArt
            });
          } else if (typeof this.nativeMediaControls.setMetadata === "function") {
            this.nativeMediaControls.setMetadata({
              title: metadata.title || "NovaTune",
              artist: metadata.artist || "",
              album: metadata.album || "",
              albumArt
            });
          } else if (typeof this.nativeMediaControls.updateMetadata === "function") {
            this.nativeMediaControls.updateMetadata({
              Title: metadata.title || "NovaTune",
              Artist: metadata.artist || "",
              Album: metadata.album || "",
              Thumbnail: albumArt
            });
          }
        } catch (err) {
          console.warn("SMTC updateMetadata failed:", err.message);
        }
      }
      _dataUriToTempFile(dataUri) {
        const match = dataUri.match(/^data:image\/(png|jpeg|webp|bmp);base64,(.+)$/);
        if (!match) return "";
        const ext = match[1] === "jpeg" ? "jpg" : match[1];
        const buf = Buffer.from(match[2], "base64");
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
          if (typeof this.nativeMediaControls.setPosition === "function") {
            this.nativeMediaControls.setPosition(positionMs);
          }
        } catch (_) {
        }
      }
      destroy() {
        if (this.nativeMediaControls) {
          try {
            this.nativeMediaControls.destroy();
          } catch (_) {
          }
          this.nativeMediaControls = null;
        }
        if (this._thumbTempPath) {
          try {
            fs.unlinkSync(this._thumbTempPath);
          } catch (_) {
          }
          this._thumbTempPath = null;
        }
        const simChannels = [
          "smtc:simulation-play",
          "smtc:simulation-pause",
          "smtc:simulation-next",
          "smtc:simulation-previous",
          "smtc:simulation-seek"
        ];
        simChannels.forEach((ch) => ipcMain.removeAllListeners(ch));
        this.isInitialized = false;
        console.log("SMTC Bridge destroyed");
      }
    };
    module2.exports = SMTCBridge;
  }
});

// main/main.js
var require_main = __commonJS({
  "main/main.js"(exports2, module2) {
    var {
      app,
      BrowserWindow,
      ipcMain,
      Menu,
      shell,
      dialog,
      protocol,
      net
    } = require("electron");
    var { initFileLogger, closeFileLogger } = require_fileLogger();
    initFileLogger();
    var os = require("os");
    var fsSafety = require("fs");
    var pathSafety = require("path");
    var _crashLogPath = pathSafety.join(os.tmpdir(), "novatune-crash.log");
    function _logFatal(label, err) {
      try {
        fsSafety.appendFileSync(
          _crashLogPath,
          `[${(/* @__PURE__ */ new Date()).toISOString()}] ${label}: ${err && err.stack ? err.stack : err}
`
        );
      } catch (_) {
      }
      console.error(label, err);
    }
    process.on("uncaughtException", (err) => _logFatal("uncaughtException", err));
    process.on("unhandledRejection", (err) => _logFatal("unhandledRejection", err));
    try {
      require_v8_compile_cache();
    } catch (err) {
      console.warn("v8-compile-cache failed to load (ignoring):", err.message);
    }
    var autoUpdater = null;
    var path = require("path");
    var fs = require("fs");
    var { URL, pathToFileURL } = require("url");
    var WindowStateManager = require_windowManager();
    var registerIPCHandlers = require_ipc();
    var SMTCBridge;
    try {
      SMTCBridge = require_smtc();
    } catch (e) {
      console.warn("SMTC native module unavailable, entering simulation mode.");
      SMTCBridge = class {
        constructor() {
        }
        initialize() {
          console.log("SMTC Bridge initialized (simulation mode)");
        }
        destroy() {
          console.log("SMTC Bridge destroyed (simulation mode)");
        }
      };
    }
    app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
    app.commandLine.appendSwitch(
      "disable-features",
      "BackgroundTracing,PaintHolding"
    );
    app.commandLine.appendSwitch("enable-features", "PlatformHEVCEncoderSupport");
    if (process.env.NOVATUNE_GPU_RASTER === "1") {
      app.commandLine.appendSwitch("enable-gpu-rasterization");
      app.commandLine.appendSwitch("enable-zero-copy");
      app.commandLine.appendSwitch("force-gpu-mem-available-mb", "1024");
    }
    app.commandLine.appendSwitch("disk-cache-size", "268435456");
    var AUDIO_MIME = {
      ".mp3": "audio/mpeg",
      ".flac": "audio/flac",
      ".m4a": "audio/mp4",
      ".aac": "audio/aac",
      ".ogg": "audio/ogg",
      ".opus": "audio/ogg; codecs=opus",
      ".wav": "audio/wav",
      ".wma": "audio/x-ms-wma",
      ".aiff": "audio/aiff",
      ".aif": "audio/aiff",
      ".webm": "audio/webm"
    };
    protocol.registerSchemesAsPrivileged([
      {
        scheme: "nova-media",
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
          // REQUIRED for audio/video streaming
          bypassCSP: true,
          corsEnabled: true
          // REQUIRED for canvas crossOrigin="anonymous"
        }
      }
    ]);
    function parseFileFromArgv(argv) {
      if (!argv || !Array.isArray(argv)) return null;
      for (let i = 1; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith("-")) continue;
        const ext = path.extname(arg).toLowerCase();
        const audioExtensions = [".mp3", ".flac", ".wav", ".m4a", ".ogg", ".aac", ".wma", ".opus", ".m3u", ".m3u8"];
        if (audioExtensions.includes(ext)) {
          const fullPath = path.resolve(arg);
          if (fs.existsSync(fullPath)) {
            return fullPath;
          }
        }
      }
      return null;
    }
    global.fileToPlayOnStartup = parseFileFromArgv(process.argv);
    var gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      console.log("[single-instance] Another instance has the lock \u2014 quitting.");
      app.quit();
    } else {
      app.on("second-instance", (event, commandLine) => {
        console.log(
          "[single-instance] Second instance launched \u2014 focusing existing window."
        );
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
          const filePath = parseFileFromArgv(commandLine);
          if (filePath) {
            mainWindow.webContents.send("player:play-file", filePath);
          }
        } else {
          console.log(
            "[single-instance] No window exists \u2014 zombie process. Force-exiting."
          );
          app.exit(0);
        }
      });
    }
    var _forceQuitTimer = null;
    app.on("before-quit", (event) => {
      console.log("[quit] before-quit received \u2014 starting 3s force-exit timer.");
      if (_forceQuitTimer) return;
      _forceQuitTimer = setTimeout(() => {
        console.warn("[quit] Force-exit timer fired \u2014 process.exit(0).");
        try {
          closeFileLogger();
        } catch (_) {
        }
        process.exit(0);
      }, 3e3);
    });
    app.on("will-quit", () => {
      console.log("[quit] will-quit \u2014 flushing logger.");
      try {
        closeFileLogger();
      } catch (_) {
      }
    });
    var mainWindow = null;
    var _thumbGenInFlight = /* @__PURE__ */ new Map();
    var _protocolCache = /* @__PURE__ */ new Map();
    var PROTOCOL_CACHE_MAX = 500;
    var _statCache = /* @__PURE__ */ new Map();
    var STAT_CACHE_MAX = 2e3;
    async function _cachedStat(filePath) {
      if (_statCache.has(filePath)) return _statCache.get(filePath);
      const s = await fs.promises.stat(filePath);
      const entry = { size: s.size, mtime: s.mtimeMs };
      if (_statCache.size >= STAT_CACHE_MAX) {
        _statCache.delete(_statCache.keys().next().value);
      }
      _statCache.set(filePath, entry);
      return entry;
    }
    function clearProtocolCache() {
      _protocolCache.clear();
    }
    module2.exports.clearProtocolCache = clearProtocolCache;
    var isDev = process.env.NODE_ENV === "development" || process.argv.includes("--dev");
    var windowState = new WindowStateManager("main", {
      defaultWidth: 1280,
      defaultHeight: 720,
      minWidth: 360,
      minHeight: 420
    });
    var smtcBridge = null;
    function createMainWindow() {
      const { x, y, width, height, isMaximized } = windowState.getState();
      let initAccentColor = "#1ed760";
      try {
        const dataDir = isDev ? path.join(__dirname, "..", "data") : WindowStateManager.DATA_DIR || app.getPath("userData");
        const settingsPath = path.join(dataDir, "settings.json");
        if (fs.existsSync(settingsPath)) {
          const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
          if (settings.accentColor) initAccentColor = settings.accentColor;
        }
      } catch (_) {
      }
      mainWindow = new BrowserWindow({
        x,
        y,
        width,
        height,
        minWidth: 360,
        minHeight: 420,
        show: false,
        backgroundColor: "#121212",
        title: "NovaTune",
        titleBarStyle: "hidden",
        titleBarOverlay: process.platform === "win32" ? {
          color: "rgba(0, 0, 0, 0)",
          symbolColor: "#b3b3b3",
          height: 32
        } : void 0,
        webPreferences: {
          preload: path.join(__dirname, "preload.js"),
          nodeIntegration: true,
          contextIsolation: false,
          webSecurity: true,
          sandbox: false,
          additionalArguments: [`--accent-color=${initAccentColor}`]
        }
      });
      registerIPCHandlers(mainWindow);
      let thumbarIcons = null;
      ensureThumbarIcons().then((icons) => {
        thumbarIcons = icons;
        global.updateThumbarButtons = (isPlaying) => {
          if (!mainWindow || mainWindow.isDestroyed() || !thumbarIcons) return;
          try {
            mainWindow.setThumbarButtons([
              {
                tooltip: "Previous",
                icon: thumbarIcons.prev,
                click() {
                  mainWindow.webContents.send("player:prev");
                }
              },
              {
                tooltip: isPlaying ? "Pause" : "Play",
                icon: isPlaying ? thumbarIcons.pause : thumbarIcons.play,
                click() {
                  mainWindow.webContents.send("player:toggle-play-pause");
                }
              },
              {
                tooltip: "Next",
                icon: thumbarIcons.next,
                click() {
                  mainWindow.webContents.send("player:next");
                }
              }
            ]);
          } catch (err) {
            console.warn("Failed to set thumbar buttons:", err.message);
          }
        };
        global.updateThumbarButtons(false);
      }).catch((err) => {
        console.error("Failed to initialize thumbar icons:", err);
      });
      mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
      mainWindow.webContents.on(
        "console-message",
        (event, level, message, line, sourceId) => {
          console.log(
            `[Renderer Console] ${message} (at ${path.basename(sourceId)}:${line})`
          );
        }
      );
      let _windowShown = false;
      function _showWindow(reason) {
        if (_windowShown || !mainWindow || mainWindow.isDestroyed()) return;
        _windowShown = true;
        console.log(`[window] show() \u2014 triggered by ${reason}`);
        if (isMaximized !== false) {
          try {
            mainWindow.maximize();
          } catch (_) {
          }
        }
        mainWindow.show();
        if (global.updateThumbarButtons) {
          global.updateThumbarButtons(false);
        }
      }
      mainWindow.once("ready-to-show", () => _showWindow("ready-to-show"));
      mainWindow.webContents.once("did-finish-load", () => {
        setTimeout(() => _showWindow("did-finish-load+500ms"), 500);
      });
      setTimeout(() => _showWindow("5s-hard-fallback"), 5e3);
      mainWindow.on("close", () => {
        windowState.saveState(mainWindow);
      });
      mainWindow.on("closed", () => {
        mainWindow = null;
      });
      mainWindow.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith("file://")) {
          event.preventDefault();
          shell.openExternal(url);
        }
      });
      mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
      });
      app.on("gpu-process-crashed", (event, killed) => {
        console.error(`[gpu] GPU process crashed! killed=${killed}`);
        _showWindow("gpu-process-crashed");
      });
      mainWindow.webContents.on("render-process-gone", (event, details) => {
        console.error(`[window] render-process-gone: reason=${details.reason}`);
      });
      if (isDev) {
        mainWindow.webContents.openDevTools({ mode: "detach" });
      }
    }
    function decodeNovaMediaLocalPath(url) {
      const encoded = url.slice("nova-media://local/".length);
      let filePath = decodeURIComponent(encoded);
      filePath = filePath.replace(/\\/g, "/");
      if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
      return filePath;
    }
    function serveAudioFile(request, filePath) {
      return _serveAudioFileAsync(request, filePath);
    }
    async function _serveAudioFileAsync(request, filePath) {
      try {
        global._lastAudioActivity = Date.now();
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = AUDIO_MIME[ext] || "application/octet-stream";
        const { size: fileSize } = await _cachedStat(filePath);
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD",
          "Access-Control-Allow-Headers": "Range"
        };
        const rangeHeader = request.headers.get("Range") || request.headers.get("range");
        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
          if (match) {
            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
            const clampedEnd = Math.min(end, fileSize - 1);
            if (start >= fileSize) {
              return new Response(null, {
                status: 416,
                headers: { "Content-Range": `bytes */${fileSize}` }
              });
            }
            const chunkSize = clampedEnd - start + 1;
            const nodeStream2 = fs.createReadStream(filePath, {
              start,
              end: clampedEnd
            });
            const webStream2 = new ReadableStream({
              start(controller) {
                nodeStream2.on("data", (chunk) => {
                  global._lastAudioActivity = Date.now();
                  controller.enqueue(new Uint8Array(chunk));
                });
                nodeStream2.on("end", () => controller.close());
                nodeStream2.on("error", (err) => controller.error(err));
              },
              cancel() {
                nodeStream2.destroy();
              }
            });
            return new Response(webStream2, {
              status: 206,
              headers: {
                ...corsHeaders,
                "Content-Type": mimeType,
                "Content-Range": `bytes ${start}-${clampedEnd}/${fileSize}`,
                "Content-Length": String(chunkSize),
                "Accept-Ranges": "bytes"
              }
            });
          }
        }
        const nodeStream = fs.createReadStream(filePath);
        const webStream = new ReadableStream({
          start(controller) {
            nodeStream.on("data", (chunk) => {
              global._lastAudioActivity = Date.now();
              controller.enqueue(new Uint8Array(chunk));
            });
            nodeStream.on("end", () => controller.close());
            nodeStream.on("error", (err) => controller.error(err));
          },
          cancel() {
            nodeStream.destroy();
          }
        });
        console.log(`[nova-media:local] Serving via ReadableStream: ${filePath}`);
        return new Response(webStream, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": mimeType,
            "Content-Length": String(fileSize),
            "Accept-Ranges": "bytes"
          }
        });
      } catch (err) {
        console.error("[nova-media:local] serveAudioFile error:", err.message);
        return new Response("Internal error", { status: 500 });
      }
    }
    app.whenReady().then(() => {
      try {
        Menu.setApplicationMenu(null);
      } catch (err) {
        _logFatal("Menu.setApplicationMenu failed", err);
      }
      try {
        if (process.platform === "win32") {
          app.setAppUserModelId("com.novatune.player");
        }
      } catch (err) {
        _logFatal("setAppUserModelId failed", err);
      }
      try {
        ({ autoUpdater } = require("electron-updater"));
      } catch (_) {
        console.warn(
          "[autoUpdater] electron-updater not installed \u2014 OTA updates disabled."
        );
      }
      try {
        protocol.handle("nova-media", async (request) => {
          try {
            const url = request.url;
            const _corsHeaders = {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET",
              "Access-Control-Allow-Headers": "Range"
            };
            if (url.startsWith("nova-media://art/")) {
              const trackId = decodeURIComponent(
                url.slice("nova-media://art/".length).split("?")[0]
              );
              const cached = _protocolCache.get(trackId);
              if (cached) {
                _protocolCache.delete(trackId);
                _protocolCache.set(trackId, cached);
                return new Response(cached.buffer, {
                  status: 200,
                  headers: {
                    ..._corsHeaders,
                    "Content-Type": cached.mimeType,
                    "Cache-Control": "public, max-age=31536000, immutable",
                    "Content-Length": String(cached.buffer.length)
                  }
                });
              }
              const coverArt = registerIPCHandlers.getCoverArtByTrackId(trackId);
              if (!coverArt) {
                return new Response("No cover art", {
                  status: 404,
                  headers: {
                    ..._corsHeaders,
                    "Content-Type": "text/plain",
                    "Cache-Control": "no-store"
                  }
                });
              }
              if (coverArt.startsWith("data:")) {
                const matches = coverArt.match(/^data:([^;]+);base64,(.+)$/);
                if (matches) {
                  const mimeType = matches[1] || "image/jpeg";
                  const buffer = Buffer.from(matches[2], "base64");
                  if (_protocolCache.size >= PROTOCOL_CACHE_MAX) {
                    const firstKey = _protocolCache.keys().next().value;
                    _protocolCache.delete(firstKey);
                  }
                  _protocolCache.set(trackId, { buffer, mimeType });
                  return new Response(buffer, {
                    status: 200,
                    headers: {
                      ..._corsHeaders,
                      "Content-Type": mimeType,
                      "Cache-Control": "public, max-age=31536000, immutable",
                      "Content-Length": String(buffer.length)
                    }
                  });
                }
              }
              if (fs.existsSync(coverArt)) {
                const ext = path.extname(coverArt).toLowerCase();
                const mimeMap = {
                  ".webp": "image/webp",
                  ".png": "image/png",
                  ".jpg": "image/jpeg",
                  ".jpeg": "image/jpeg",
                  ".gif": "image/gif",
                  ".bmp": "image/bmp",
                  ".avif": "image/avif"
                };
                const mimeType = mimeMap[ext] || "image/webp";
                const buffer = fs.readFileSync(coverArt);
                if (_protocolCache.size >= PROTOCOL_CACHE_MAX) {
                  const firstKey = _protocolCache.keys().next().value;
                  _protocolCache.delete(firstKey);
                }
                _protocolCache.set(trackId, { buffer, mimeType });
                return new Response(buffer, {
                  status: 200,
                  headers: {
                    ..._corsHeaders,
                    "Content-Type": mimeType,
                    "Cache-Control": "public, max-age=31536000, immutable",
                    "Content-Length": String(buffer.length)
                  }
                });
              }
              return new Response("Cover art file not found", {
                status: 404,
                headers: {
                  ..._corsHeaders,
                  "Content-Type": "text/plain",
                  "Cache-Control": "no-store"
                }
              });
            }
            if (url.startsWith("nova-media://thumb/")) {
              const parts = url.slice("nova-media://thumb/".length).split("/");
              const trackId = parts[0];
              const size = parts[1] || "48";
              const thumbDir = path.join(
                app.getPath("userData"),
                "cached_covers",
                "thumbs"
              );
              if (!fs.existsSync(thumbDir))
                fs.mkdirSync(thumbDir, { recursive: true });
              const thumbFile = path.join(thumbDir, `${trackId}_${size}.webp`);
              if (fs.existsSync(thumbFile)) {
                const stat = fs.statSync(thumbFile);
                const buffer = fs.readFileSync(thumbFile);
                return new Response(buffer, {
                  status: 200,
                  headers: {
                    ..._corsHeaders,
                    "Content-Type": "image/webp",
                    "Cache-Control": "public, max-age=31536000, immutable",
                    "Content-Length": String(stat.size)
                  }
                });
              }
              const genKey = `thumbGen::${trackId}::${size}`;
              if (_thumbGenInFlight.has(genKey)) {
                try {
                  await _thumbGenInFlight.get(genKey);
                } catch (_) {
                }
                if (fs.existsSync(thumbFile)) {
                  const stat = fs.statSync(thumbFile);
                  const buffer = fs.readFileSync(thumbFile);
                  return new Response(buffer, {
                    status: 200,
                    headers: {
                      ..._corsHeaders,
                      "Content-Type": "image/webp",
                      "Cache-Control": "public, max-age=31536000, immutable",
                      "Content-Length": String(stat.size)
                    }
                  });
                }
                return new Response("Thumbnail not available", {
                  status: 404,
                  headers: {
                    ..._corsHeaders,
                    "Content-Type": "text/plain",
                    "Cache-Control": "no-store"
                  }
                });
              }
              const genPromise = (async () => {
                const sharp = require("sharp");
                const coverArt = registerIPCHandlers.getCoverArtByTrackId(trackId);
                if (!coverArt) return null;
                let inputBuffer;
                if (coverArt.startsWith("data:")) {
                  const base64 = coverArt.split(",")[1];
                  if (base64) inputBuffer = Buffer.from(base64, "base64");
                } else if (fs.existsSync(coverArt)) {
                  inputBuffer = fs.readFileSync(coverArt);
                }
                if (!inputBuffer) return null;
                const targetSize = Math.max(
                  32,
                  Math.min(parseInt(size) || 48, 800)
                );
                const metadata = await sharp(inputBuffer).metadata();
                const side = Math.min(metadata.width, metadata.height);
                const left = Math.floor((metadata.width - side) / 2);
                const top = Math.floor((metadata.height - side) / 2);
                const thumbBuffer = await sharp(inputBuffer).extract({ left, top, width: side, height: side }).resize(targetSize, targetSize, { fit: "cover" }).webp({ quality: 90 }).toBuffer();
                fs.writeFileSync(thumbFile, thumbBuffer);
                return thumbBuffer;
              })();
              _thumbGenInFlight.set(genKey, genPromise);
              try {
                const thumbBuffer = await genPromise;
                if (thumbBuffer) {
                  return new Response(thumbBuffer, {
                    status: 200,
                    headers: {
                      ..._corsHeaders,
                      "Content-Type": "image/webp",
                      "Cache-Control": "public, max-age=31536000, immutable",
                      "Content-Length": String(thumbBuffer.length)
                    }
                  });
                }
              } catch (e) {
                console.warn(
                  `[thumb] On-demand generation failed for ${trackId}:`,
                  e.message
                );
              } finally {
                _thumbGenInFlight.delete(genKey);
              }
              return new Response("Thumbnail not available", {
                status: 404,
                headers: {
                  ..._corsHeaders,
                  "Content-Type": "text/plain",
                  "Cache-Control": "no-store"
                }
              });
            }
            if (url.startsWith("nova-media://cover/")) {
              const encoded = url.slice("nova-media://cover/".length);
              const cleanEncoded = encoded.split("?")[0];
              const filePath = decodeURIComponent(cleanEncoded);
              if (!fs.existsSync(filePath)) {
                return new Response("Cover art file not found", {
                  status: 404,
                  headers: {
                    ..._corsHeaders,
                    "Content-Type": "text/plain",
                    "Cache-Control": "no-store"
                  }
                });
              }
              const ext = path.extname(filePath).toLowerCase();
              const mimeMap = {
                ".webp": "image/webp",
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".bmp": "image/bmp",
                ".avif": "image/avif"
              };
              const mimeType = mimeMap[ext] || "image/webp";
              const stat = fs.statSync(filePath);
              const buffer = fs.readFileSync(filePath);
              return new Response(buffer, {
                status: 200,
                headers: {
                  ..._corsHeaders,
                  "Content-Type": mimeType,
                  "Cache-Control": "public, max-age=31536000, immutable",
                  "Content-Length": String(stat.size)
                }
              });
            }
            if (url.startsWith("nova-media://local/")) {
              let filePath = decodeNovaMediaLocalPath(url);
              if (!fs.existsSync(filePath)) {
                try {
                  const alternativePath = registerIPCHandlers.findAlternativeTrackPath(filePath);
                  if (alternativePath) {
                    console.log(
                      `[self-healing] Resolved missing file ${filePath} to ${alternativePath}`
                    );
                    filePath = alternativePath;
                  }
                } catch (err) {
                  console.warn(
                    "[self-healing] Failed to resolve alternative file:",
                    err.message
                  );
                }
              }
              if (!fs.existsSync(filePath)) {
                return new Response("File not found", { status: 404 });
              }
              const stat = fs.statSync(filePath);
              if (stat.size === 0) {
                console.warn(`nova-media: zero-byte file: ${filePath}`);
                return new Response("Empty file", { status: 404 });
              }
              return serveAudioFile(request, filePath);
            }
            return new Response("Not found", { status: 404 });
          } catch (err) {
            console.error("nova-media protocol error:", err);
            return new Response("Internal error", { status: 500 });
          }
        });
      } catch (err) {
        _logFatal("protocol.handle(nova-media) registration failed", err);
      }
      try {
        createMainWindow();
      } catch (err) {
        _logFatal("createMainWindow failed", err);
        try {
          mainWindow = new BrowserWindow({ width: 900, height: 600 });
          mainWindow.loadURL(
            "data:text/html,<body style='background:#121212;color:#fff;font-family:sans-serif;padding:40px'><h2>NovaTune failed to start</h2><p>Details were written to:<br>" + _crashLogPath.replace(/\\/g, "\\\\") + "</p></body>"
          );
        } catch (_) {
        }
      }
      if (autoUpdater && app.isPackaged) {
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.on("update-available", (info) => {
          mainWindow?.webContents.send("update:available", {
            version: info.version,
            releaseNotes: info.releaseNotes,
            releaseName: info.releaseName
          });
        });
        autoUpdater.on("update-not-available", () => {
          mainWindow?.webContents.send("update:not-available");
        });
        autoUpdater.on("download-progress", (progress) => {
          mainWindow?.webContents.send("update:download-progress", {
            percent: progress.percent,
            transferred: progress.transferred,
            total: progress.total,
            bytesPerSecond: progress.bytesPerSecond
          });
        });
        autoUpdater.on("update-downloaded", () => {
          mainWindow?.webContents.send("update:downloaded");
        });
        autoUpdater.on("error", (err) => {
          console.error("[autoUpdater] Error:", err.message);
          mainWindow?.webContents.send("update:error", { message: err.message });
        });
        setTimeout(() => {
          autoUpdater.checkForUpdates().catch((err) => {
            console.warn("[autoUpdater] Startup check failed:", err.message);
          });
        }, 6e4);
        setInterval(
          () => {
            autoUpdater.checkForUpdates().catch(() => {
            });
          },
          4 * 60 * 60 * 1e3
        );
      } else if (!app.isPackaged) {
        setTimeout(async () => {
          try {
            const CURRENT_VERSION = require_package().version || "1.0.0";
            const response = await net.fetch(
              "https://api.github.com/repos/AnonymousV73X/WINDOWS-MUSIC-PLAYER/releases/latest",
              { headers: { "User-Agent": "NovaTune-Update-Check" } }
            );
            if (response.ok) {
              const data = await response.json();
              const latestVersion = (data.tag_name || "").replace(/^v/, "");
              if (latestVersion && latestVersion !== CURRENT_VERSION) {
                mainWindow?.webContents.send("update:available", {
                  version: latestVersion,
                  releaseNotes: data.name || "",
                  releaseName: data.name || ""
                });
              }
            }
          } catch (_) {
          }
        }, 3e4);
      }
      if (process.platform === "win32") {
        try {
          smtcBridge = new SMTCBridge(mainWindow);
          smtcBridge.initialize();
          registerIPCHandlers.setSMTCBridge(smtcBridge);
        } catch (err) {
          console.warn("SMTC initialization failed:", err.message);
        }
      }
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
      });
    });
    app.on("window-all-closed", () => {
      console.log("[quit] window-all-closed \u2014 quitting, SMTC cleanup deferred.");
      if (process.platform !== "darwin") app.quit();
      if (smtcBridge) {
        const bridge = smtcBridge;
        smtcBridge = null;
        setImmediate(() => {
          try {
            bridge.destroy();
          } catch (err) {
            console.warn("[quit] SMTC destroy failed (ignoring):", err.message);
          }
        });
      }
    });
    app.on("web-contents-created", (event, contents) => {
      contents.on("will-navigate", (event2, navigationUrl) => {
        const parsedUrl = new URL(navigationUrl);
        if (parsedUrl.protocol !== "file:") event2.preventDefault();
      });
    });
    var { nativeImage } = require("electron");
    async function ensureThumbarIcons() {
      const iconDir = path.join(app.getPath("userData"), "thumbar-icons");
      if (!fs.existsSync(iconDir)) {
        fs.mkdirSync(iconDir, { recursive: true });
      }
      const prevPath = path.join(iconDir, "prev.png");
      const playPath = path.join(iconDir, "play.png");
      const pausePath = path.join(iconDir, "pause.png");
      const nextPath = path.join(iconDir, "next.png");
      const prevSvg = `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M10 6 L10 26 M24 6 L12 16 L24 26 Z" fill="#ffffff"/></svg>`;
      const playSvg = `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M8 6 L26 16 L8 26 Z" fill="#ffffff"/></svg>`;
      const pauseSvg = `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="6" width="5" height="20" fill="#ffffff"/><rect x="19" y="6" width="5" height="20" fill="#ffffff"/></svg>`;
      const nextSvg = `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M6 6 L18 16 L6 26 M22 6 L22 26" fill="#ffffff"/></svg>`;
      try {
        const sharp = require("sharp");
        if (!fs.existsSync(prevPath)) await sharp(Buffer.from(prevSvg)).png().toFile(prevPath);
        if (!fs.existsSync(playPath)) await sharp(Buffer.from(playSvg)).png().toFile(playPath);
        if (!fs.existsSync(pausePath)) await sharp(Buffer.from(pauseSvg)).png().toFile(pausePath);
        if (!fs.existsSync(nextPath)) await sharp(Buffer.from(nextSvg)).png().toFile(nextPath);
      } catch (err) {
        console.error("Failed to generate taskbar icons using sharp, using empty image icons:", err.message);
      }
      return {
        prev: nativeImage.createFromPath(prevPath),
        play: nativeImage.createFromPath(playPath),
        pause: nativeImage.createFromPath(pausePath),
        next: nativeImage.createFromPath(nextPath)
      };
    }
    module2.exports = { mainWindow: () => mainWindow };
  }
});
module.exports = require_main();
//# sourceMappingURL=main.bundle.js.map
