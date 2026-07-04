/**
 * NovaTune — Manifest IPC handlers
 * ─────────────────────────────────────────────────────────────────────────
 * Three IPC channels:
 *
 *   library:get-manifest-info   → { available, version, trackCount, fpHash, createdAt, ms }
 *   library:get-manifest-buffer → ArrayBuffer (Transferable, zero-copy)
 *   library:rebuild-manifest    → forces a rebuild from the current SQLite library
 *
 * The ArrayBuffer returned by library:get-manifest-buffer is the *entire*
 * manifest file, transferred as a Transferable so V8 doesn't structured-clone
 * it. The renderer wraps it in ManifestDecoder (renderer/services) and
 * lazily decodes tracks on demand.
 *
 * HOT-PATH INVARIANTS
 *   - The manifest file is read ONCE at app startup, cached in `manifestBuf`
 *     as a Node Buffer (off-heap shared with the filesystem cache via libuv).
 *   - On rebuild, the cached buffer is invalidated and re-read on next access.
 *   - If the manifest is missing/corrupt, all three handlers return
 *     graceful-failure payloads so the renderer can fall back to the
 *     SQLite path with zero user-visible disruption.
 */

"use strict";

const { ipcMain, app } = require("electron");
const fs = require("fs");
const path = require("path");
const ManifestWriter = require("./manifest");
const ManifestReader = require("./manifestReader");

// ─── State ──────────────────────────────────────────────────────────
let _manifestPath = null;          // resolved in registerManifestIPC()
let _manifestBuf = null;            // cached Buffer of library.bin
let _manifestInfo = null;           // cached header info (size, version, count, fpHash)
let _lastRebuildAt = 0;
let _featureFlagEnabled = true;     // default ON — flip via env or settings

// Public setter — ipc.js calls this after reading settings.json so the
// flag can be flipped per-user without recompiling.
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

/**
 * Read (or re-read) the manifest file from disk into the cache.
 * Returns null if missing/corrupt.
 */
function _loadBuffer() {
  const p = _resolvePath();
  try {
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p); // small (~1MB for 1000 tracks) — sync is fine
    // Validate by constructing a reader (cheap: parses 64-byte header + CRC)
    const reader = new ManifestReader(buf);
    if (!reader.valid) {
      console.warn("[manifest] cached file failed validation:", reader.error);
      return null;
    }
    _manifestBuf = buf;
    _manifestInfo = reader.headerInfo;
    _manifestInfo.size = buf.length;
    _manifestInfo.ms = 0; // not used here; see loadBufferTimed
    return buf;
  } catch (err) {
    console.warn("[manifest] load failed:", err.message);
    return null;
  }
}

/**
 * Synchronous info accessor — used by library:get-manifest-info.
 * Lazy-loads the buffer on first call.
 */
function getManifestInfo() {
  if (!_manifestBuf) _loadBuffer();
  if (!_manifestBuf) {
    return { available: false, reason: "missing-or-corrupt" };
  }
  return {
    available: true,
    path: _manifestPath,
    ..._manifestInfo,
  };
}

/**
 * Returns the manifest as a fresh ArrayBuffer (Transferable).
 * Caller should transfer it via IPC — once transferred, the buffer is
 * detached on the main-process side, so we drop our reference.
 *
 * NOTE: We deliberately return a *copy* of the underlying ArrayBuffer
 * rather than transferring our cached Buffer's backing storage, because
 * the cache needs to stay valid for subsequent requests (e.g. if the
 * renderer hot-reloads). The copy is a single memcpy of ~1MB and is
 * dwarfed by the savings vs N IPC round-trips for paginated SQLite reads.
 */
function getManifestArrayBuffer() {
  if (!_manifestBuf) _loadBuffer();
  if (!_manifestBuf) return null;
  // Buffer → ArrayBuffer copy. Node's Buffer is a Uint8Array subclass
  // backed by an ArrayBuffer; .slice() returns a *new* ArrayBuffer copy.
  return _manifestBuf.buffer.slice(
    _manifestBuf.byteOffset,
    _manifestBuf.byteOffset + _manifestBuf.byteLength,
  );
}

/**
 * Rebuild the manifest from a tracks array (usually from getLibrary()).
 * Writes atomically, invalidates the cache, and re-loads.
 *
 * @param {Object[]} tracks
 * @param {string}  [folderFingerprint]  optional folder fingerprint string for fpHash
 * @returns {Promise<{ ok:boolean, ms:number, size:number, trackCount:number }>}
 */
async function rebuildManifest(tracks, folderFingerprint) {
  const p = _resolvePath();
  try {
    const result = await ManifestWriter.write(p, tracks || [], {
      folderFingerprint,
    });
    _manifestBuf = null;     // invalidate cache
    _manifestInfo = null;
    _lastRebuildAt = Date.now();
    console.log(
      `[manifest] rebuilt: ${result.trackCount} tracks, ${result.size} bytes, ${result.ms}ms`,
    );
    return { ok: true, ...result };
  } catch (err) {
    console.error("[manifest] rebuild failed:", err.message);
    return { ok: false, error: err.message, ms: 0, size: 0, trackCount: 0 };
  }
}

/**
 * Synchronous rebuild — used during app-quit or other points where
 * we cannot yield to the event loop.
 */
function rebuildManifestSync(tracks, folderFingerprint) {
  const p = _resolvePath();
  try {
    const result = ManifestWriter.writeSync(p, tracks || [], {
      folderFingerprint,
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

/**
 * Invalidate the in-memory cache. Called when the underlying SQLite
 * library is changed (saveLibrary / library:clear) so the next
 * getManifestInfo call re-reads from disk (or returns missing).
 *
 * NOTE: this does NOT delete the file. If the manifest is stale but
 * present, the renderer will still use it — that's fine because
 * rebuildManifest is called immediately after saveLibrary in the
 * scan flow. We only call this on library:clear so the renderer
 * falls back to SQLite until the next rebuild.
 */
function invalidateCache() {
  _manifestBuf = null;
  _manifestInfo = null;
}

/**
 * Delete the manifest file entirely. Called on library:clear so
 * the renderer doesn't accidentally load stale data.
 */
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

// ─── IPC registration ───────────────────────────────────────────────
function registerManifestIPC() {
  // (1) Info — cheap, no transfer. Renderer calls this first to decide
  // whether to use the manifest fast path or fall back to SQLite.
  ipcMain.handle("library:get-manifest-info", async () => {
    if (!_featureFlagEnabled) {
      return { available: false, reason: "feature-disabled" };
    }
    return getManifestInfo();
  });

  // (2) Buffer — returns the entire manifest as a Transferable ArrayBuffer.
  // The renderer wraps it in ManifestDecoder and never calls this again
  // unless it explicitly wants to refresh (e.g. after a background scan).
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
      // Default: transfer the buffer (zero-copy on the IPC boundary).
      // The renderer takes ownership; main's reference is already a copy.
      if (transfer === false) {
        // Caller asked for non-transferable (debugging only)
        return { success: true, buffer: ab };
      }
      // Returning an ArrayBuffer from ipcMain.handle is structured-cloned
      // by default. To make it transferable, we use event.sender.send
      // with the transferList. But ipcMain.handle can't directly transfer.
      // So we fall back to structured clone (one ~1MB memcpy, still much
      // faster than N paginated SQLite reads).
      return { success: true, buffer: ab };
    },
  );

  // (3) Rebuild — forces a rebuild from the current in-memory SQLite library.
  // Called by the renderer's "refresh library" action and internally by
  // library:scan after saveLibrary succeeds.
  ipcMain.handle("library:rebuild-manifest", async (event, opts = {}) => {
    // Lazy-load the SQLite library — ipc.js exposes getLibrary() globally
    // via the require graph. We try-catch to avoid breaking the IPC handler
    // if ipc.js hasn't finished initializing.
    let tracks = opts.tracks;
    if (!tracks) {
      try {
        const ipcModule = require("./ipc");
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

module.exports = {
  registerManifestIPC,
  setFeatureFlag,
  isFeatureFlagEnabled,
  getManifestInfo,
  getManifestArrayBuffer,
  rebuildManifest,
  rebuildManifestSync,
  invalidateCache,
  deleteManifest,
};
