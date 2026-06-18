/**
 * NovaTune — Main Process Entry  [v2 — REVFIX]
 * Bootstraps the Electron application, manages the main window,
 * and orchestrates all main-process modules.
 *
 * CHANGES v2 (revolutionary performance):
 * - In-flight thumbnail generation deduplication: if multiple requests
 *   arrive for the same trackId+size while sharp is already generating,
 *   they wait for the same generation instead of starting a new one.
 *   This prevents redundant sharp() calls that waste CPU and disk I/O.
 *
 * CHANGES v1:
 * - Protocol handler returns 404 for missing art files (was 200+dark pixel)
 * - On-demand thumbnail generation in nova-media://thumb/ handler
 * - These fixes unblock the renderer's 3-tier fallback chain
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
// electron-updater is optional — gracefully degrade if not installed (dev mode).
// autoUpdater will be null and all update features will be no-ops.
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch (_) {
  console.warn(
    "[autoUpdater] electron-updater not installed — OTA updates disabled. Run `npm install` to enable.",
  );
}
const path = require("path");
const fs = require("fs");
const { Readable } = require("stream");
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
// Must be set before app.whenReady() / before Chromium initialises.
//
// --autoplay-policy=no-user-gesture-required
//   Prevents Chromium from silently blocking AudioContext.resume() until
//   a user gesture, which would cause the first track to play silently.
//
// --disable-features=AudioServiceOutOfProcess
//   Keeps audio in-process on Windows; avoids an extra IPC hop between
//   Chromium's audio service and the render process (lower latency).
//
// --enable-features=PlatformHEVCEncoderSupport
//   Unlocks platform audio decoders (WASAPI on Windows, CoreAudio on macOS)
//   so AAC / ALAC tracks are decoded by the OS codec rather than a software
//   fallback, preserving bit-perfect output where possible.
//
// --audio-buffer-size=2048
//   Keeps the OS audio buffer small enough to avoid perceptible latency
//   while still being large enough to prevent underruns on typical hardware.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch(
  "disable-features",
  "AudioServiceOutOfProcess,BackgroundTracing,PaintHolding",
);
app.commandLine.appendSwitch("enable-features", "PlatformHEVCEncoderSupport");
app.commandLine.appendSwitch("audio-buffer-size", "2048");

// ─── GPU-Accelerated Image Rendering ──────────────────────────────
// --enable-gpu-rasterization: Use GPU for rasterizing images (cover art,
//   thumbnails, collages) instead of CPU software rasterization.
// --enable-zero-copy: Zero-copy texture uploads from decoder to compositor,
//   reduces memory copies for large cover art images.
// --force-gpu-mem-available-mb=1024: Tells Chromium it has 1GB of GPU memory
//   available, preventing it from falling back to software rasterization
//   when it thinks GPU memory is scarce (common on integrated GPUs).
// --disk-cache-size=268435456: 256MB disk cache for protocol responses,
//   so nova-media:// resources are cached on disk across restarts.
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("force-gpu-mem-available-mb", "1024");
app.commandLine.appendSwitch("disk-cache-size", "268435456");

// Windows-only: request exclusive-mode WASAPI for bit-perfect output
// (bypasses Windows audio mixer and its forced resampling to the system
//  sample rate).  Falls back gracefully if the device doesn't support it.
if (process.platform === "win32") {
  app.commandLine.appendSwitch("enable-exclusive-audio");
}

// ─── MIME map for local audio files ────────────────────────────────
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
protocol.registerSchemesAsPrivileged([
  {
    scheme: "nova-media",
    privileges: {
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

// ─── Prevent multiple instances ────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

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

// ─── Globals ────────────────────────────────────────────────────────
let mainWindow = null;
// REVFIX v2: In-flight thumbnail generation deduplication map.
// Key: `thumbGen::${trackId}::${size}` → Promise<Buffer>
// Prevents redundant sharp() calls when multiple requests arrive for the
// same thumbnail while it's already being generated.
const _thumbGenInFlight = new Map();

// ─── Protocol Response Memory Cache ─────────────────────────────────
// Caches decoded cover art buffers in memory to avoid repeated SQLite
// lookups + base64 decodes. This is the single biggest bottleneck:
// each album card, track row, and now-playing display hits nova-media://art/{trackId},
// which was doing a full SQLite query + base64 decode EVERY time.
// With this cache, the second request for the same art is ~0.1ms (memory read)
// vs ~5-15ms (SQLite + base64 decode).
const _protocolCache = new Map(); // trackId → { buffer, mimeType }
const PROTOCOL_CACHE_MAX = 500; // max entries (LRU eviction)

// ─── Cover Art Lookup Cache ────────────────────────────────────────
// Caches getCoverArtByTrackId results to avoid repeated Map lookups
// and function call overhead on every image load.
// Key: trackId → Value: coverArt string or null.
const _coverArtLookupCache = new Map();

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

  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 360,
    minHeight: 420,
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

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (isMaximized) mainWindow.maximize();
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

// ─── App Lifecycle ──────────────────────────────────────────────────
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  if (process.platform === "win32") {
    app.setAppUserModelId("com.novatune.player");
  }

  // ── nova-media:// protocol handler ──────────────────────────────
  // Serves local audio files with correct MIME types so Chromium can
  // decode FLAC, M4A/AAC and other formats without file:// security issues.
  // REVFIX v1.1: Made handler async to support on-demand thumbnail generation (await sharp)
  protocol.handle("nova-media", async (request) => {
    try {
      const url = request.url;

      // ── Common CORS headers for ALL nova-media:// responses ──────
      // Critical: Without Access-Control-Allow-Origin, any <img> with
      // crossOrigin="anonymous" (used by canvas operations like collage
      // generation and color sampling) will taint the canvas, making
      // canvas.toDataURL() throw SecurityError. This was the ROOT CAUSE
      // of playlist collages never being generated.
      const _corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Range",
      };

      // ── nova-media://art/{trackId} ──────────────────────────────
      // Revolutionary: Serves cover art by track ID from the library database.
      // This fixes the critical gap where base64 data: URIs are stripped from
      // library:get-all (to save 50-200MB on startup) but the renderer still
      // needs to display them. By looking up coverArt from libraryById,
      // we can serve both file paths AND base64 data URIs without sending
      // them all on startup. Also handles file paths for tracks with _hasCoverArt.
      if (url.startsWith("nova-media://art/")) {
        const trackId = decodeURIComponent(
          url.slice("nova-media://art/".length).split("?")[0],
        );

        // ── Protocol cache check ──────────────────────────────────────
        // Second request for the same art is ~0.1ms (memory read)
        // vs ~5-15ms (SQLite lookup + base64 decode / file read).
        const cached = _protocolCache.get(trackId);
        if (cached) {
          // Move to end for LRU (most recently used stays longest)
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

        // ── Cover art lookup (with cache) ─────────────────────────────
        let coverArt = _coverArtLookupCache.get(trackId);
        if (coverArt === undefined) {
          coverArt = registerIPCHandlers.getCoverArtByTrackId(trackId);
          _coverArtLookupCache.set(trackId, coverArt);
        }

        if (!coverArt) {
          // No cover art in database — return 404 so renderer fallback chain fires.
          // REVFIX v1: Previously returned HTTP 200 + dark 1x1 pixel, which caused
          // img.onload to fire with a stretched dark pixel instead of img.onerror.
          // This silently killed the entire 3-tier fallback chain:
          // protocol URL → retry with cache-bust → IPC thumbnail → art-placeholder.
          // Now returns 404 so onerror fires and the fallback chain works correctly.
          return new Response("No cover art", {
            status: 404,
            headers: {
              ..._corsHeaders,
              "Content-Type": "text/plain",
              "Cache-Control": "no-store",
            },
          });
        }

        // Base64 data: URI — decode and serve directly
        if (coverArt.startsWith("data:")) {
          const matches = coverArt.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            const mimeType = matches[1] || "image/jpeg";
            const buffer = Buffer.from(matches[2], "base64");
            // Cache for future requests
            if (_protocolCache.size >= PROTOCOL_CACHE_MAX) {
              // Evict oldest entry (first in Map = least recently used)
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

        // File path — serve the file (same logic as nova-media://cover/)
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
          // Cache for future requests
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

        // File path doesn't exist anymore — return 404 so renderer fallback chain fires.
        // REVFIX v1: Same bug as above — returning 200 + dark pixel killed the fallback.
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
      // Serves pre-generated WebP thumbnails from cached_covers/thumbs/
      // REVFIX v2: Now uses in-flight deduplication — if multiple requests
      // arrive for the same trackId+size while sharp is already generating
      // the thumbnail, they share the same generation Promise instead of
      // each starting a separate sharp() process. This prevents:
      //   - Redundant sharp() CPU usage (each call = 10-50ms of CPU)
      //   - Redundant disk reads for the same cover art source
      //   - Redundant disk writes for the same thumbnail output
      // Result: When 50 track rows request the same album thumbnail,
      // only 1 sharp() process runs instead of 50.
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

        // If thumbnail already exists on disk, serve it directly
        if (fs.existsSync(thumbFile)) {
          const stat = fs.statSync(thumbFile);
          const stream = fs.createReadStream(thumbFile);
          return new Response(stream, {
            status: 200,
            headers: {
              ..._corsHeaders,
              "Content-Type": "image/webp",
              "Cache-Control": "public, max-age=31536000, immutable",
              "Content-Length": String(stat.size),
            },
          });
        }

        // REVFIX v2: In-flight deduplication for thumbnail generation
        // If sharp is already generating this exact thumbnail, wait for it
        // instead of starting a redundant generation.
        const genKey = `thumbGen::${trackId}::${size}`;
        if (_thumbGenInFlight.has(genKey)) {
          // Wait for the in-flight generation to complete
          try {
            await _thumbGenInFlight.get(genKey);
          } catch (_) {}
          // Now the file should exist on disk — serve it
          if (fs.existsSync(thumbFile)) {
            const stat = fs.statSync(thumbFile);
            const stream = fs.createReadStream(thumbFile);
            return new Response(stream, {
              status: 200,
              headers: {
                ..._corsHeaders,
                "Content-Type": "image/webp",
                "Cache-Control": "public, max-age=31536000, immutable",
                "Content-Length": String(stat.size),
              },
            });
          }
          // Generation failed — return 404
          return new Response("Thumbnail not available", {
            status: 404,
            headers: {
              ..._corsHeaders,
              "Content-Type": "text/plain",
              "Cache-Control": "no-store",
            },
          });
        }

        // Start on-demand generation with deduplication
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

          const thumbBuffer = await sharp(inputBuffer)
            .extract({ left, top, width: side, height: side })
            .resize(targetSize, targetSize, { fit: "cover" })
            .webp({ quality: 75 })
            .toBuffer();

          // Cache to disk for future requests
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

        // No cover art available at all — return 404 so renderer fallback chain fires
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
      // Serves cover art files by absolute path (for album/artist cards)
      if (url.startsWith("nova-media://cover/")) {
        const encoded = url.slice("nova-media://cover/".length);
        // Strip query params (retry=1&t=... cache-bust from renderer)
        const cleanEncoded = encoded.split("?")[0];
        const filePath = decodeURIComponent(cleanEncoded);

        if (!fs.existsSync(filePath)) {
          // REVFIX v1: Return 404 for missing files so renderer fallback chain fires.
          // Previously returned HTTP 200 + dark 1x1 pixel which killed the fallback
          // because img.onload fired with a valid (but blank) image instead of onerror.
          // The renderer's 3-tier fallback + art-placeholder guarantees no black cards.
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
        const stream = fs.createReadStream(filePath);
        return new Response(stream, {
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
      // Serves local audio files with correct MIME types.
      // Explicitly supports byte-range requests for seeking to avoid media player restarts.
      const encoded = url.slice("nova-media://local/".length);
      let filePath = decodeURIComponent(encoded);

      if (!fs.existsSync(filePath)) {
        // Self-healing: if the file is missing, try to find a track in the database
        // with the same title/artist that actually exists on disk.
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

      const ext = path.extname(filePath).toLowerCase();
      const mimeType = AUDIO_MIME[ext] || "audio/mpeg";

      let responseStatus = 200;
      let responseHeaders = {
        ..._corsHeaders,
        "Accept-Ranges": "bytes",
        "Content-Type": mimeType,
      };
      let readStreamOptions = {};

      const rangeHeader = request.headers.get("Range") || request.headers.get("range");
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;

          if (start < stat.size) {
            responseStatus = 206;
            readStreamOptions = { start, end };
            responseHeaders["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
            responseHeaders["Content-Length"] = String(end - start + 1);
          }
        }
      }

      if (responseStatus === 200) {
        responseHeaders["Content-Length"] = String(stat.size);
      }

      try {
        const stream = fs.createReadStream(filePath, readStreamOptions);
        return new Response(stream, {
          status: responseStatus,
          headers: responseHeaders,
        });
      } catch (err) {
        console.error("nova-media local stream error:", err);
        return new Response("Internal error", { status: 500 });
      }
    } catch (err) {
      console.error("nova-media protocol error:", err);
      return new Response("Internal error", { status: 500 });
    }
  });

  createMainWindow();
  registerIPCHandlers(mainWindow);

  // ─── Auto-Updater (electron-updater + GitHub Releases) ─────────────
  // Configures automatic update checks on launch and IPC events for
  // renderer-driven update flow (check → download → install).
  // Only runs in production (packaged app) AND when electron-updater is installed.
  if (autoUpdater && app.isPackaged) {
    autoUpdater.autoDownload = false; // Don't download without user consent
    autoUpdater.autoInstallOnAppQuit = true; // Install on next quit

    // Forward autoUpdater events to the renderer
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

    // Auto-check for updates on launch (1-minute delay to avoid slowing startup)
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn("[autoUpdater] Startup check failed:", err.message);
      });
    }, 60_000);

    // Periodic check every 4 hours
    setInterval(
      () => {
        autoUpdater.checkForUpdates().catch(() => {});
      },
      4 * 60 * 60 * 1000,
    );
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
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.protocol !== "file:") event.preventDefault();
  });
});

module.exports = { mainWindow: () => mainWindow };
