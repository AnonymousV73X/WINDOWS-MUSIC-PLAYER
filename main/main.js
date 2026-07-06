/**
 * NovaTune — Main Process Entry  [v3 — AUDIO REWRITE]
 * Bootstraps the Electron application, manages the main window,
 * and orchestrates all main-process modules.
 *
 * CRITICAL CHANGE v4 (audio rewrite):
 * - Replaced net.fetch(file://) with fs.createReadStream via Node ReadableStream
 *   for the nova-media://local/ audio handler. net.fetch routes through Chromium's
 *   network service thread; on Windows with stream:true, a second net.fetch call
 *   while a prior streaming response is still open BLOCKS — causing every track
 *   click after the preloaded one to time out at 15s (readyState=0, networkState=2).
 *   fs.createReadStream runs on Node's libuv thread pool, fully independent of
 *   Chromium's network service — concurrent streams never block each other.
 *   Range requests for seeking are handled manually with correct MIME types.
 * - Moved electron-updater require inside whenReady() to avoid blocking startup
 * - Added electron-updater + chokidar to esbuild externals
 * - Image handlers (art/thumb/cover) keep using Buffer Responses (they work fine)
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
  dialog,
  protocol,
  net,
} = require("electron");

// ─── File Logger (v3.0) ─────────────────────────────────────────────
// MUST be the first thing initialized — before any other require() —
// so we capture every log line from the entire app lifecycle. In a
// packaged exe there's no terminal, so without this all console output
// vanishes and users have no way to send logs for debugging.
const { initFileLogger, closeFileLogger } = require("./fileLogger");
initFileLogger();

// ─── Crash Safety Net ────────────────────────────────────────────────
// Previously, any synchronous throw during startup (e.g. mkdir failing
// right after a user manually deleted the app's data folder) crashed the
// process before a window ever appeared — no dialog, nothing in Event
// Viewer, just a ghost process in Task Manager. Log to a location that
// never depends on userData (which may be the very thing that's broken)
// and keep going wherever possible instead of dying silently.
const os = require("os");
const fsSafety = require("fs");
const pathSafety = require("path");
const _crashLogPath = pathSafety.join(os.tmpdir(), "novatune-crash.log");
function _logFatal(label, err) {
  try {
    fsSafety.appendFileSync(
      _crashLogPath,
      `[${new Date().toISOString()}] ${label}: ${err && err.stack ? err.stack : err}\n`,
    );
  } catch (_) {}
  console.error(label, err);
}
process.on("uncaughtException", (err) => _logFatal("uncaughtException", err));
process.on("unhandledRejection", (err) => _logFatal("unhandledRejection", err));

// ─── V8 Compile Cache (HDD Optimization) ─────────────────────────
// MUST be required immediately after electron but before any massive user modules.
try {
  require("v8-compile-cache");
} catch (err) {
  console.warn("v8-compile-cache failed to load (ignoring):", err.message);
}

// electron-updater is optional — loaded lazily inside whenReady()
let autoUpdater = null;

const path = require("path");
const fs = require("fs");
const { URL, pathToFileURL } = require("url");
const WindowStateManager = require("./windowManager");
const registerIPCHandlers = require("./ipc");
let SMTCBridge;
try {
  SMTCBridge = require("./smtc");
} catch (e) {
  console.warn("SMTC native module unavailable, entering simulation mode.");
  SMTCBridge = class {
    constructor() {}
    initialize() {
      console.log("SMTC Bridge initialized (simulation mode)");
    }
    destroy() {
      console.log("SMTC Bridge destroyed (simulation mode)");
    }
  };
}

// ─── HQ Audio: Chromium flags ───────────────────────────────────────
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch(
  "disable-features",
  "BackgroundTracing,PaintHolding",
);
app.commandLine.appendSwitch("enable-features", "PlatformHEVCEncoderSupport");

// ─── GPU-Accelerated Image Rendering ──────────────────────────────
// Gated: forcing these on an unsupported GPU driver can stop Chromium
// from ever compositing a frame, so ready-to-show never fires and the
// window stays hidden forever (ghost process, nothing on screen).
if (process.env.NOVATUNE_GPU_RASTER === "1") {
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-zero-copy");
  app.commandLine.appendSwitch("force-gpu-mem-available-mb", "1024");
}
app.commandLine.appendSwitch("disk-cache-size", "268435456");

// ─── MIME map for local audio files ────────────────────────────────
// Used as a fallback when net.fetch doesn't set the right Content-Type.
const AUDIO_MIME = {
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
  ".webm": "audio/webm",
};

// Register nova-media:// — must be called before app.whenReady()
// CRITICAL: stream:true is required for <audio>/<video> elements to work
// with custom protocols. Without it, Chromium buffers the entire response
// and seeking/Range requests break.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "nova-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true, // REQUIRED for audio/video streaming
      bypassCSP: true,
      corsEnabled: true, // REQUIRED for canvas crossOrigin="anonymous"
    },
  },
]);

// ─── Prevent multiple instances (v3.0: hardened) ───────────────────
// CHANGED v3.0: The old code had a zombie-process bug:
//   1. User closes window → window-all-closed fires → smtcBridge.destroy()
//      hangs or throws → app.quit() never runs → process stays in Task Manager
//   2. User relaunches → new process fails to get lock → app.quit() →
//      second-instance fires on the OLD zombie → old process tries to focus
//      its destroyed window → nothing visible → user sees nothing
//
// Fix:
//   - In second-instance: if no window exists, the old process is a zombie
//     → call app.exit(0) to force-kill it (the new instance will retry)
//   - In window-all-closed: wrap smtcBridge.destroy() in try/catch so it
//     can never prevent app.quit()
//   - Add before-quit handler with a 3-second force-exit safety net:
//     if app.quit() doesn't complete in 3s (something is hanging),
//     process.exit(0) forces immediate termination
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log("[single-instance] Another instance has the lock — quitting.");
  app.quit();
} else {
  app.on("second-instance", () => {
    console.log(
      "[single-instance] Second instance launched — focusing existing window.",
    );
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      // CHANGED v3.0: No window exists — this process is a zombie (the
      // window was closed but app.quit() never completed). Force-exit
      // so the new instance can acquire the lock on its next attempt.
      console.log(
        "[single-instance] No window exists — zombie process. Force-exiting.",
      );
      app.exit(0);
    }
  });
}

// ─── Force-quit safety net (v3.0) ──────────────────────────────────
// If app.quit() is called but something hangs (SMTC destroy, native
// module cleanup, pending IPC, etc.), the process stays alive in Task
// Manager. This timer fires 3 seconds after before-quit and calls
// process.exit(0) to guarantee termination.
let _forceQuitTimer = null;
app.on("before-quit", (event) => {
  console.log("[quit] before-quit received — starting 3s force-exit timer.");
  if (_forceQuitTimer) return; // already armed
  _forceQuitTimer = setTimeout(() => {
    console.warn("[quit] Force-exit timer fired — process.exit(0).");
    try {
      closeFileLogger();
    } catch (_) {}
    process.exit(0);
  }, 3000);
  // Allow the timer to keep the process alive (unref would let it exit
  // early if nothing else is pending — we WANT it to fire)
});

// Also flush logger on normal quit
app.on("will-quit", () => {
  console.log("[quit] will-quit — flushing logger.");
  try {
    closeFileLogger();
  } catch (_) {}
});

// ─── Globals ────────────────────────────────────────────────────────
let mainWindow = null;
const _thumbGenInFlight = new Map();

// ─── Protocol Response Memory Cache ─────────────────────────────────
const _protocolCache = new Map();
const PROTOCOL_CACHE_MAX = 500;

// ─── Stat Cache: avoids blocking statSync on every nova-media request ─
// Key: filePath → { size, mtime }. Evicted when filePath changes on disk.
const _statCache = new Map();
const STAT_CACHE_MAX = 2000;
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
module.exports.clearProtocolCache = clearProtocolCache;

const isDev =
  process.env.NODE_ENV === "development" || process.argv.includes("--dev");

// ─── Window Manager ────────────────────────────────────────────────
const windowState = new WindowStateManager("main", {
  defaultWidth: 1280,
  defaultHeight: 720,
  minWidth: 360,
  minHeight: 420,
});

// ─── SMTC Bridge ───────────────────────────────────────────────────
let smtcBridge = null;

// ─── Create Main Window ────────────────────────────────────────────
function createMainWindow() {
  const { x, y, width, height, isMaximized } = windowState.getState();

  let initAccentColor = "#1ed760";
  try {
    const dataDir = isDev
      ? path.join(__dirname, "..", "data")
      : WindowStateManager.DATA_DIR || app.getPath("userData");
    const settingsPath = path.join(dataDir, "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (settings.accentColor) initAccentColor = settings.accentColor;
    }
  } catch (_) {}

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
    titleBarOverlay:
      process.platform === "win32"
        ? {
            color: "rgba(0, 0, 0, 0)",
            symbolColor: "#b3b3b3",
            height: 32,
          }
        : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
      sandbox: false,
      additionalArguments: [`--accent-color=${initAccentColor}`],
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  mainWindow.webContents.on(
    "console-message",
    (event, level, message, line, sourceId) => {
      console.log(
        `[Renderer Console] ${message} (at ${path.basename(sourceId)}:${line})`,
      );
    },
  );

  // ─── Multi-signal show() ──────────────────────────────────────────
  // ready-to-show requires a real composited frame. On some GPU drivers
  // that never happens even though the renderer is fully alive (it keeps
  // running JS, just never paints), so ready-to-show silently never fires
  // and the window stays hidden — a ghost process the user can't see.
  // Fall back through progressively less-ideal signals so the window is
  // guaranteed to appear.
  let _windowShown = false;
  function _showWindow(reason) {
    if (_windowShown || !mainWindow || mainWindow.isDestroyed()) return;
    _windowShown = true;
    console.log(`[window] show() — triggered by ${reason}`);
    if (isMaximized !== false) {
      try {
        mainWindow.maximize();
      } catch (_) {}
    }
    mainWindow.show();
  }

  mainWindow.once("ready-to-show", () => _showWindow("ready-to-show"));

  mainWindow.webContents.once("did-finish-load", () => {
    setTimeout(() => _showWindow("did-finish-load+500ms"), 500);
  });

  setTimeout(() => _showWindow("5s-hard-fallback"), 5000);

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

// ─── Helper: decode nova-media://local/ URL to file path ──────────
function decodeNovaMediaLocalPath(url) {
  const encoded = url.slice("nova-media://local/".length);
  let filePath = decodeURIComponent(encoded);
  // Normalise Windows backslashes
  filePath = filePath.replace(/\\/g, "/");
  // Remove leading slash-duplicate on Windows (//C:/... → C:/...)
  if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
  return filePath;
}

// ─── Helper: serve audio file via fs.createReadStream ──────────────
// Streams local audio files using Node's ReadableStream (libuv thread pool).
// This avoids net.fetch(file://) which blocks on Windows when a prior streaming
// response through Chromium's network service thread is still open.
function serveAudioFile(request, filePath) {
  // REWRITE: Use fs.createReadStream via Node.js ReadableStream instead of net.fetch.
  //
  // WHY: net.fetch(file://) routes through Chromium's network service thread.
  // On Windows, when protocol.handle has stream:true active, a second net.fetch
  // call while a prior streaming response is still being consumed (e.g. the audio
  // element is actively reading the preloaded track) BLOCKS — Chromium serialises
  // these on the same internal IO thread. This caused every track click after the
  // preloaded one to time out at 15s (readyState stays 0, networkState=2).
  //
  // fs.createReadStream runs entirely on Node's libuv thread pool — independent of
  // Chromium's network service — so concurrent streams never block each other.
  // Range requests (for seeking) are handled manually, which is required anyway
  // because we need correct Content-Type headers for all formats.
  //
  // NOTE: Now async — uses _cachedStat() instead of statSync() so the libuv
  // thread pool is never blocked by a synchronous HDD stat call.
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
      "Access-Control-Allow-Headers": "Range",
    };

    // Parse Range header for seek support
    const rangeHeader =
      request.headers.get("Range") || request.headers.get("range");

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const clampedEnd = Math.min(end, fileSize - 1);

        if (start >= fileSize) {
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${fileSize}` },
          });
        }

        const chunkSize = clampedEnd - start + 1;
        const nodeStream = fs.createReadStream(filePath, {
          start,
          end: clampedEnd,
        });
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
          },
        });

        return new Response(webStream, {
          status: 206,
          headers: {
            ...corsHeaders,
            "Content-Type": mimeType,
            "Content-Range": `bytes ${start}-${clampedEnd}/${fileSize}`,
            "Content-Length": String(chunkSize),
            "Accept-Ranges": "bytes",
          },
        });
      }
    }

    // Full file response
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
      },
    });

    console.log(`[nova-media:local] Serving via ReadableStream: ${filePath}`);
    return new Response(webStream, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": mimeType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
      },
    });
  } catch (err) {
    console.error("[nova-media:local] serveAudioFile error:", err.message);
    return new Response("Internal error", { status: 500 });
  }
}

// ─── App Lifecycle ──────────────────────────────────────────────────
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

  // Lazy-load electron-updater after app is ready (avoids blocking startup)
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (_) {
    console.warn(
      "[autoUpdater] electron-updater not installed — OTA updates disabled.",
    );
  }

  // ── nova-media:// protocol handler ──────────────────────────────
  try {
    protocol.handle("nova-media", async (request) => {
      try {
        const url = request.url;

        // ── Common CORS headers for ALL nova-media:// responses ──────
        const _corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Headers": "Range",
        };

        // ── nova-media://art/{trackId} ──────────────────────────────
        if (url.startsWith("nova-media://art/")) {
          const trackId = decodeURIComponent(
            url.slice("nova-media://art/".length).split("?")[0],
          );

          // Protocol cache check
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
                "Content-Length": String(cached.buffer.length),
              },
            });
          }

          const coverArt = registerIPCHandlers.getCoverArtByTrackId(trackId);

          if (!coverArt) {
            return new Response("No cover art", {
              status: 404,
              headers: {
                ..._corsHeaders,
                "Content-Type": "text/plain",
                "Cache-Control": "no-store",
              },
            });
          }

          // Base64 data: URI
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
                  "Content-Length": String(buffer.length),
                },
              });
            }
          }

          // File path
          if (fs.existsSync(coverArt)) {
            const ext = path.extname(coverArt).toLowerCase();
            const mimeMap = {
              ".webp": "image/webp",
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".gif": "image/gif",
              ".bmp": "image/bmp",
              ".avif": "image/avif",
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
                "Content-Length": String(buffer.length),
              },
            });
          }

          return new Response("Cover art file not found", {
            status: 404,
            headers: {
              ..._corsHeaders,
              "Content-Type": "text/plain",
              "Cache-Control": "no-store",
            },
          });
        }

        // ── nova-media://thumb/{trackId}/{size} ──────────────────────
        if (url.startsWith("nova-media://thumb/")) {
          const parts = url.slice("nova-media://thumb/".length).split("/");
          const trackId = parts[0];
          const size = parts[1] || "48";
          const thumbDir = path.join(
            app.getPath("userData"),
            "cached_covers",
            "thumbs",
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
                "Content-Length": String(stat.size),
              },
            });
          }

          // In-flight deduplication
          const genKey = `thumbGen::${trackId}::${size}`;
          if (_thumbGenInFlight.has(genKey)) {
            try {
              await _thumbGenInFlight.get(genKey);
            } catch (_) {}
            if (fs.existsSync(thumbFile)) {
              const stat = fs.statSync(thumbFile);
              const buffer = fs.readFileSync(thumbFile);
              return new Response(buffer, {
                status: 200,
                headers: {
                  ..._corsHeaders,
                  "Content-Type": "image/webp",
                  "Cache-Control": "public, max-age=31536000, immutable",
                  "Content-Length": String(stat.size),
                },
              });
            }
            return new Response("Thumbnail not available", {
              status: 404,
              headers: {
                ..._corsHeaders,
                "Content-Type": "text/plain",
                "Cache-Control": "no-store",
              },
            });
          }

          // Start on-demand generation
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
              Math.min(parseInt(size) || 48, 800),
            );
            const metadata = await sharp(inputBuffer).metadata();
            const side = Math.min(metadata.width, metadata.height);
            const left = Math.floor((metadata.width - side) / 2);
            const top = Math.floor((metadata.height - side) / 2);

            const thumbBuffer = await sharp(inputBuffer)
              .extract({ left, top, width: side, height: side })
              .resize(targetSize, targetSize, { fit: "cover" })
              .webp({ quality: 75 })
              .toBuffer();

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
                  "Content-Length": String(thumbBuffer.length),
                },
              });
            }
          } catch (e) {
            console.warn(
              `[thumb] On-demand generation failed for ${trackId}:`,
              e.message,
            );
          } finally {
            _thumbGenInFlight.delete(genKey);
          }

          return new Response("Thumbnail not available", {
            status: 404,
            headers: {
              ..._corsHeaders,
              "Content-Type": "text/plain",
              "Cache-Control": "no-store",
            },
          });
        }

        // ── nova-media://cover/{encoded-path} ────────────────────────
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
                "Cache-Control": "no-store",
              },
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
            ".avif": "image/avif",
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
              "Content-Length": String(stat.size),
            },
          });
        }

        // ── nova-media://local/<encoded-absolute-path> ───────────────
        // Served via fs.createReadStream (Node libuv thread pool).
        // Avoids net.fetch(file://) blocking on Windows when concurrent
        // streams are open through Chromium's network service thread.
        if (url.startsWith("nova-media://local/")) {
          let filePath = decodeNovaMediaLocalPath(url);

          // Self-healing: find alternative path if file is missing
          if (!fs.existsSync(filePath)) {
            try {
              const alternativePath =
                registerIPCHandlers.findAlternativeTrackPath(filePath);
              if (alternativePath) {
                console.log(
                  `[self-healing] Resolved missing file ${filePath} to ${alternativePath}`,
                );
                filePath = alternativePath;
              }
            } catch (err) {
              console.warn(
                "[self-healing] Failed to resolve alternative file:",
                err.message,
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

        // Unknown nova-media:// path
        return new Response("Not found", { status: 404 });
      } catch (err) {
        console.error("nova-media protocol error:", err);
        return new Response("Internal error", { status: 500 });
      }
    });
  } catch (err) {
    _logFatal("protocol.handle(nova-media) registration failed", err);
  }

  // createMainWindow() must run no matter what happened above — the window
  // is the whole point, and every step before this is best-effort.
  try {
    createMainWindow();
  } catch (err) {
    _logFatal("createMainWindow failed", err);
    // Last-resort minimal window so the app isn't a silent ghost process.
    try {
      mainWindow = new BrowserWindow({ width: 900, height: 600 });
      mainWindow.loadURL(
        "data:text/html,<body style='background:#121212;color:#fff;font-family:sans-serif;padding:40px'>" +
          "<h2>NovaTune failed to start</h2><p>Details were written to:<br>" +
          _crashLogPath.replace(/\\/g, "\\\\") +
          "</p></body>",
      );
    } catch (_) {}
  }

  try {
    registerIPCHandlers(mainWindow);
  } catch (err) {
    _logFatal("registerIPCHandlers failed", err);
  }

  // ─── Auto-Updater ─────────────────────────────────────────────────
  if (autoUpdater && app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("update-available", (info) => {
      mainWindow?.webContents.send("update:available", {
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseName: info.releaseName,
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
        bytesPerSecond: progress.bytesPerSecond,
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
    }, 60_000);

    setInterval(
      () => {
        autoUpdater.checkForUpdates().catch(() => {});
      },
      4 * 60 * 60 * 1000,
    );
  } else if (!app.isPackaged) {
    setTimeout(async () => {
      try {
        const CURRENT_VERSION = require("../package.json").version || "1.0.0";
        const response = await net.fetch(
          "https://api.github.com/repos/AnonymousV73X/WINDOWS-MUSIC-PLAYER/releases/latest",
          { headers: { "User-Agent": "NovaTune-Update-Check" } },
        );
        if (response.ok) {
          const data = await response.json();
          const latestVersion = (data.tag_name || "").replace(/^v/, "");
          if (latestVersion && latestVersion !== CURRENT_VERSION) {
            mainWindow?.webContents.send("update:available", {
              version: latestVersion,
              releaseNotes: data.name || "",
              releaseName: data.name || "",
            });
          }
        }
      } catch (_) {}
    }, 30_000);
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
  console.log("[quit] window-all-closed — cleaning up SMTC and quitting.");
  // CHANGED v3.0: Wrap smtcBridge.destroy() in try/catch. The old code
  // let any throw from the native SMTC module prevent app.quit() from
  // running, leaving a zombie process in Task Manager. Now SMTC cleanup
  // failures are logged but never block quit.
  if (smtcBridge) {
    try {
      smtcBridge.destroy();
    } catch (err) {
      console.warn("[quit] SMTC destroy failed (ignoring):", err.message);
    }
    smtcBridge = null;
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("web-contents-created", (event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.protocol !== "file:") event.preventDefault();
  });
});

module.exports = { mainWindow: () => mainWindow };
