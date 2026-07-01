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
    var path = require("path");
    var { screen, app } = require("electron");
    var DATA_DIR = process.defaultApp || process.env.NODE_ENV === "development" || process.argv.includes("--dev") ? path.join(__dirname, "..", "data") : app.getPath("userData");
    var STATE_FILE = path.join(DATA_DIR, "window-state.json");
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
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
       * @returns {Promise<Object>} Parsed metadata object
       */
      async readMetadata(filePath) {
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
            const fallbackTags = this._fallbackMetadata(filePath);
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
        return this._fallbackMetadata(filePath);
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
       * @private
       */
      async _fallbackMetadata(filePath) {
        const nameWithoutExt = path.basename(filePath, path.extname(filePath));
        let title = nameWithoutExt;
        let artist = "Unknown Artist";
        const dashIndex = nameWithoutExt.indexOf(" - ");
        if (dashIndex > 0 && dashIndex < nameWithoutExt.length - 3) {
          artist = nameWithoutExt.substring(0, dashIndex).trim();
          title = nameWithoutExt.substring(dashIndex + 3).trim();
        }
        title = title.replace(/^\d+[._\s]+/, "").trim() || title;
        const ext = path.extname(filePath).replace(".", "").toUpperCase();
        let fileSize = 0;
        try {
          fileSize = (await fs.promises.stat(filePath)).size;
        } catch {
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
          duration: 0,
          bitrate: 0,
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
       * @returns {Promise<Object>}
       */
      readMetadata(filePath) {
        this._ensureWorker();
        const taskId = ++this._taskId;
        return new Promise((resolve, reject) => {
          this._pending.set(taskId, { resolve, reject });
          this._worker.postMessage({ type: "readMetadata", filePath, taskId });
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

// package.json
var require_package = __commonJS({
  "package.json"(exports2, module2) {
    module2.exports = {
      name: "novatune",
      version: "1.0.5",
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
      crossfadeDuration: 0,
      equalizer: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      repeatMode: "off",
      shuffle: false,
      showLyrics: false,
      visualizerStyle: "bars",
      scanFolders: [],
      sortOrder: "title",
      sortDirection: "asc",
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
  CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_tracks_date_added ON tracks(dateAdded DESC);
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
    var _FP_MAX_CONCURRENT_DIRS = 4;
    async function _computeFolderFingerprint(folderPaths) {
      let fileCount = 0;
      let newestMtime = 0;
      async function walk(dir) {
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
        if (files.length > 0) {
          const stats = await Promise.allSettled(
            files.map((f) => fs.promises.stat(f))
          );
          for (const result of stats) {
            if (result.status === "fulfilled") {
              fileCount++;
              if (result.value.mtimeMs > newestMtime)
                newestMtime = result.value.mtimeMs;
            }
          }
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
      return `${fileCount}:${Math.floor(newestMtime)}`;
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
    function saveLibrary(library) {
      libraryCache = library;
      _libraryJsonCache = library;
      libraryById = new Map(library.map((track) => [track.id, track]));
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
      tx(library);
      if (preExistingCovers.size > 0) {
        const restoreInsert = db.prepare(
          "INSERT OR IGNORE INTO track_covers (trackId, coverArt) VALUES (?, ?)"
        );
        const restoreTx = db.transaction(() => {
          for (const track of library) {
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
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
      db.exec(DB_SCHEMA);
      migrateJsonToDb();
      migrateDbCovers();
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
          const toScan = [];
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const existing = existingMap.get(file.filePath);
            const hasGoodMetadata = existing && existing.artist && existing.artist !== "Unknown Artist" && existing.album && existing.album !== "Unknown Album";
            const hasCoverArt = existing && (existing._hasCoverArt === true || existing.coverArt && !/base64,\d+/.test(existing.coverArt));
            if (existing && hasGoodMetadata && existing.dateModified === file.modifiedTime && hasCoverArt && existing.duration > 0) {
              tracks.push(existing);
              skippedCount++;
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
          for (let ci = 0; ci < toScan.length; ci += CHUNK) {
            const chunk = toScan.slice(ci, ci + CHUNK);
            const chunkResults = await Promise.allSettled(
              chunk.map(async ({ file }, wi) => {
                let metadata;
                if (useWorker && workerPool.length > 0) {
                  const worker = workerPool[wi % workerPool.length];
                  try {
                    metadata = await worker.readMetadata(file.filePath);
                  } catch (_) {
                    metadata = await metadataReader.readMetadata(file.filePath);
                  }
                } else {
                  metadata = await metadataReader.readMetadata(file.filePath);
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
                  console.log(
                    `[library:scan] Skipping 0:00 track: ${file.filePath}`
                  );
                } else {
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
                      dateAdded: file.birthTime || file.modifiedTime || Date.now(),
                      dateModified: file.modifiedTime || Date.now()
                    });
                  } else {
                    failedCount++;
                  }
                } catch (_) {
                  failedCount++;
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
          const dateRefreshBatch = 50;
          for (let i = 0; i < mergedLibrary.length; i += dateRefreshBatch) {
            const batch = mergedLibrary.slice(i, i + dateRefreshBatch);
            await Promise.all(batch.map((track) => refreshTrackDateAdded(track)));
            if (i + dateRefreshBatch < mergedLibrary.length) {
              await new Promise((resolve) => setImmediate(resolve));
            }
          }
          saveLibrary(mergedLibrary);
          for (const w of workerPool) w.shutdown();
          workerPool = [];
          const elapsed = ((Date.now() - startTime) / 1e3).toFixed(1);
          console.log(
            `[library:scan] Done! ${mergedLibrary.length} tracks in library (${tracks.length} scanned/checked, ${skippedCount} skipped/cached, ${failedCount} failed) in ${elapsed}s`
          );
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
          try {
            const fp = await _computeFolderFingerprint([folderPath]);
            const settings = readJSON(SETTINGS_FILE, { ...DEFAULT_SETTINGS });
            settings._scanFingerprints = settings._scanFingerprints || {};
            settings._scanFingerprints[folderPath] = fp;
            writeJSON(SETTINGS_FILE, settings);
          } catch (_) {
          }
          return { success: true, tracks: mergedLibrary, newTracks: tracks.length };
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
          const library = getLibrary();
          return { success: true, tracks: library };
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
      ipcMain.handle("coverart:get-all-thumbs", async (event, { size } = {}) => {
        try {
          const sharp = require("sharp");
          const library = getLibrary();
          const targetSize = size || 48;
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
          const tracks = library.filter(
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
                  const thumbBuffer = await sharp(inputBuffer).extract({ left, top, width: side, height: side }).resize(targetSize, targetSize, { fit: "cover" }).webp({ quality: 75 }).toBuffer();
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
              const thumbBuffer = await sharp(inputBuffer).extract({ left, top, width: side, height: side }).resize(targetSize, targetSize, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
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
      ipcMain.handle("library:clear", async () => {
        try {
          saveLibrary([]);
          return { success: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      });
      ipcMain.handle("library:remove-track", async (event, trackId) => {
        try {
          const library = getLibrary();
          const filtered = library.filter((t) => t.id !== trackId);
          if (filtered.length === library.length)
            return { success: true, removed: false };
          saveLibrary(filtered);
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
                const library2 = getLibrary();
                const idSet = new Set(data.trackIds);
                entries = library2.filter((t) => idSet.has(t.id)).map((t) => ({ filePath: t.filePath, resolvedId: t.id }));
              }
            } catch (_) {
            }
          }
          if (entries.length === 0)
            return { success: false, error: "No tracks found in playlist file" };
          const library = getLibrary();
          const pathToId = new Map(
            library.filter((t) => t?.filePath).map((t) => [t.filePath, t.id])
          );
          const crossBasename = (fp) => {
            const posix = String(fp || "").replace(/\\/g, "/");
            const idx = posix.lastIndexOf("/");
            return idx >= 0 ? posix.substring(idx + 1) : posix;
          };
          const fileNameToTrack = /* @__PURE__ */ new Map();
          const fileNameNoExtToTrack = /* @__PURE__ */ new Map();
          for (const t of library) {
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
          const library = getLibrary();
          const libMap = new Map(library.map((t) => [t.id, t]));
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
        return { success: true };
      });
      ipcMain.handle("smtc:update-position", (_, positionMs) => {
        if (_smtcBridgeRef && typeof _smtcBridgeRef.updatePosition === "function") {
          _smtcBridgeRef.updatePosition(positionMs);
        }
        return { success: true };
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
          const lrcPath = filePath.replace(path.extname(filePath), ".lrc");
          if (!fs.existsSync(lrcPath)) {
            const lrcPathUpper = filePath.replace(path.extname(filePath), ".LRC");
            if (!fs.existsSync(lrcPathUpper)) {
              console.log(
                `[lyrics:read-local] no .lrc found for: ${path.basename(filePath)}`
              );
              return { success: false, error: "No local lyrics file found" };
            }
            console.log(
              `[lyrics:read-local] found .LRC: ${path.basename(lrcPathUpper)}`
            );
            const content2 = fs.readFileSync(lrcPathUpper, "utf-8");
            const parsed2 = parseLRC(content2);
            console.log(
              `  \u2192 ${parsed2.synced ? parsed2.synced.length + " synced lines" : "plain only"}`
            );
            return { success: true, lyrics: parsed2 };
          }
          console.log(`[lyrics:read-local] found .lrc: ${path.basename(lrcPath)}`);
          const content = fs.readFileSync(lrcPath, "utf-8");
          const parsed = parseLRC(content);
          console.log(
            `  \u2192 ${parsed.synced ? parsed.synced.length + " synced lines" : "plain only"}`
          );
          return { success: true, lyrics: parsed };
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
            const lrcPath = filePath.replace(/\.[^.]+$/, ".lrc");
            const isEmpty = !plain && !synced;
            if (isEmpty) {
              try {
                if (fs.existsSync(lrcPath)) fs.unlinkSync(lrcPath);
              } catch (_) {
              }
            } else {
              fs.writeFileSync(lrcPath, synced || plain || "", "utf-8");
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
    app.commandLine.appendSwitch("enable-gpu-rasterization");
    app.commandLine.appendSwitch("enable-zero-copy");
    app.commandLine.appendSwitch("force-gpu-mem-available-mb", "1024");
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
    var gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      app.quit();
    } else {
      app.on("second-instance", () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });
    }
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
        const dataDir = isDev ? path.join(__dirname, "..", "data") : app.getPath("userData");
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
      mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
      mainWindow.webContents.on(
        "console-message",
        (event, level, message, line, sourceId) => {
          console.log(
            `[Renderer Console] ${message} (at ${path.basename(sourceId)}:${line})`
          );
        }
      );
      mainWindow.once("ready-to-show", () => {
        if (isMaximized !== false) {
          mainWindow.maximize();
        }
        mainWindow.show();
      });
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
      Menu.setApplicationMenu(null);
      if (process.platform === "win32") {
        app.setAppUserModelId("com.novatune.player");
      }
      try {
        ({ autoUpdater } = require("electron-updater"));
      } catch (_) {
        console.warn(
          "[autoUpdater] electron-updater not installed \u2014 OTA updates disabled."
        );
      }
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
              const targetSize = Math.max(32, Math.min(parseInt(size) || 48, 800));
              const metadata = await sharp(inputBuffer).metadata();
              const side = Math.min(metadata.width, metadata.height);
              const left = Math.floor((metadata.width - side) / 2);
              const top = Math.floor((metadata.height - side) / 2);
              const thumbBuffer = await sharp(inputBuffer).extract({ left, top, width: side, height: side }).resize(targetSize, targetSize, { fit: "cover" }).webp({ quality: 75 }).toBuffer();
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
      createMainWindow();
      registerIPCHandlers(mainWindow);
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
      if (smtcBridge) {
        smtcBridge.destroy();
        smtcBridge = null;
      }
      if (process.platform !== "darwin") app.quit();
    });
    app.on("web-contents-created", (event, contents) => {
      contents.on("will-navigate", (event2, navigationUrl) => {
        const parsedUrl = new URL(navigationUrl);
        if (parsedUrl.protocol !== "file:") event2.preventDefault();
      });
    });
    module2.exports = { mainWindow: () => mainWindow };
  }
});
module.exports = require_main();
//# sourceMappingURL=main.bundle.js.map
