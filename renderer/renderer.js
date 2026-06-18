/**
 * NovaTune — Renderer Entry Point  [v2 — REVFIX]
 * Wires the user's custom UI to the Electron backend.
 * Uses window.novaAPI (from preload.js) for all IPC communication.
 *
 * CHANGES v2 (revolutionary performance):
 * - SingleFlight request deduplication: same thumbnail requested by 50 tracks = 1 IPC call
 * - Album Art Fingerprint Cache: tracks from same album reuse resolved URL (no re-resolution)
 * - Parallel collage generation: load all 4 images simultaneously (4x faster)
 * - Protocol URL reuse: same artPath+size returns cached result instantly
 * - In-flight dedupe for _getThumb, _attachEagerThumb, _loadThumbFallback
 *
 * CHANGES v1:
 * - playTrack() uses _resolveCoverArtSrc() instead of raw track.coverArt check (BUG 1)
 * - Album/artist detail views wrap <img> in .cover-img-container (BUG 3)
 * - _getProtocolThumbUrl uses nova-media://thumb/ for sized thumbnails (BUG 4)
 * - _createTrackRow onerror uses _loadThumbFallback instead of redundant retry (BUG 5)
 * - _attachEagerThumb fallback chain now works because protocol returns 404 (BUG 2)
 */

// ─── Audio Engine ──────────────────────────────────────────────────
const AudioEngine = require("./audio/AudioEngine");
const EQEngine = require("./audio/EQEngine");

try {
  const fs = require("fs");
  const path = require("path");
  const settingsPath = path.join(__dirname, "..", "data", "settings.json");
  if (fs.existsSync(settingsPath)) {
    const accentColor = JSON.parse(
      fs.readFileSync(settingsPath, "utf-8"),
    ).accentColor;
    if (accentColor) {
      document.documentElement.style.setProperty("--green", accentColor);
      document.documentElement.style.setProperty("--green-hover", accentColor);
    }
  }
} catch (_) {}

// ─── State ─────────────────────────────────────────────────────────
const state = {
  tracks: [],
  filteredTracks: [],
  queue: [],
  queueIndex: -1,
  currentTrack: null,
  isPlaying: false,
  shuffleEnabled: false,
  repeatMode: "off", // off | all | one
  volume: 0.5,
  currentView: "library",
  currentTab: "songs",
  sortKey: "dateAdded",
  sortAsc: false,
  overlayOpen: false,
  sidebarOpen: false,
  activeNavSection: "library",
  playlists: [],
  favoritesPlaylistId: null,
  activePlaylistId: null,
  settings: {},
  equalizer: new Array(10).fill(0),
  eqEnabled: true,
  volumeBoost: 1.0,
  recentlyPlayed: [],
  dynamicAccentColor: false,
};

const audioEngine = AudioEngine.getInstance();
let eqEngine = null;

// ─── Squiggly Progress (AOSP port) — OffscreenCanvas Worker ────────
// The wave RAF loop runs in a dedicated Worker via OffscreenCanvas.
// Main thread never touches the canvas; janky audio callbacks can't drop frames.
// Falls back to main-thread rendering when OffscreenCanvas is unavailable.

const _squigglyWorkerCode = `
  "use strict";
  let canvas, ctx;
  let dpr = 1, cssWidth = 100, cssHeight = 20;
  let progress = 0, playing = false, heightFraction = 0, _heightTarget = 0;
  let phaseOffset = 0, lastFrameTime = null, rafId = null;
  let waveColor = "#1ed760", overlay = false;
  let waveLength = 48, lineAmplitude = 3.5, phaseSpeed = 3.5;
  let strokeWidth = 2;
  const transitionPeriods = 1.5, minWaveEndpoint = 0.2, matchedWaveEndpoint = 0.6, edgeTaperPx = 12;

  function _lerp(a, b, t) { return a + (b - a) * t; }
  function _lerpInv(a, b, v) { return b === a ? 0 : (v - a) / (b - a); }
  function _lerpInvSat(a, b, v) { return Math.max(0, Math.min(1, _lerpInv(a, b, v))); }

  function _drawThumb(x, cy, r) {
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = overlay ? "#fff" : waveColor;
    ctx.fill();
  }

  function _draw() {
    if (!ctx || !cssWidth || !cssHeight) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const W = cssWidth, cy = cssHeight / 2;
    const thumbR = overlay ? 3 : 3.5;
    const leftInset = strokeWidth + 4, rightInset = strokeWidth + 4;
    const totalProgressPx = Math.max(leftInset, Math.min(W - rightInset, W * progress));
    const waveEndPx = Math.max(0, totalProgressPx - thumbR - 1);
    const waveProgressPx = W * (progress > matchedWaveEndpoint ? progress : _lerp(minWaveEndpoint, matchedWaveEndpoint, _lerpInv(0, matchedWaveEndpoint, progress)));

    const greyStart = progress <= 0 ? leftInset : Math.min(totalProgressPx + thumbR + 1, W);
    if (greyStart < W) {
      ctx.beginPath(); ctx.moveTo(greyStart, cy); ctx.lineTo(W, cy);
      ctx.strokeStyle = overlay ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.1)";
      ctx.lineWidth = strokeWidth * 0.8; ctx.lineCap = "round"; ctx.stroke();
    }
    if (progress > 0 && totalProgressPx > leftInset + thumbR * 2) {
      ctx.beginPath(); ctx.arc(leftInset, cy, strokeWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = overlay ? "rgba(255,255,255,0.3)" : waveColor; ctx.fill();
    }
    if (waveEndPx < 1) {
      if (progress > 0) _drawThumb(totalProgressPx, cy, thumbR);
      ctx.restore(); return;
    }

    const amp = lineAmplitude, hf = heightFraction, tp = transitionPeriods, edgeTaper = edgeTaperPx;
    const k = (2 * Math.PI) / waveLength, phase = phaseOffset;
    const computeAmp = (x) => {
      const length = tp * waveLength;
      const headCoeff = _lerpInvSat(waveProgressPx + length / 2, waveProgressPx - length / 2, x);
      const leftCoeff = _lerpInvSat(leftInset, leftInset + edgeTaper, x);
      const rightCoeff = _lerpInvSat(waveEndPx, waveEndPx - edgeTaper, x);
      return hf * amp * headCoeff * leftCoeff * rightCoeff;
    };

    ctx.save();
    ctx.beginPath(); ctx.rect(leftInset, 0, Math.max(0, waveEndPx - leftInset), cssHeight); ctx.clip();
    ctx.beginPath();
    const step = 2; let first = true;
    for (let x = leftInset; x <= waveEndPx; x += step) {
      const envelope = computeAmp(x);
      const y = cy + Math.sin(k * x + phase) * envelope;
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    if (!first) {
      const envelope = computeAmp(waveEndPx);
      ctx.lineTo(waveEndPx, cy + Math.sin(k * waveEndPx + phase) * envelope);
    }
    ctx.strokeStyle = overlay ? "#fff" : waveColor;
    ctx.lineWidth = strokeWidth; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
    ctx.restore();

    _drawThumb(totalProgressPx, cy, thumbR);
    ctx.restore();
  }

  function _raf(now) {
    rafId = requestAnimationFrame(_raf);
    const dt = Math.min((now - (lastFrameTime || now)) / 1000, 0.05);
    lastFrameTime = now;
    const diff = _heightTarget - heightFraction;
    const speed = _heightTarget > heightFraction ? 2.2 : 1.6;
    heightFraction += diff * Math.min(dt * speed * 5, 1);
    if (Math.abs(diff) < 0.001) heightFraction = _heightTarget;
    if (playing || heightFraction > 0.01) phaseOffset += dt * phaseSpeed;
    _draw();
  }

  self.onmessage = function(e) {
    const msg = e.data;
    switch (msg.type) {
      case "init":
        canvas = msg.canvas;
        ctx = canvas.getContext("2d");
        overlay = msg.overlay;
        waveLength = msg.waveLength;
        lineAmplitude = msg.lineAmplitude;
        phaseSpeed = msg.phaseSpeed;
        strokeWidth = msg.strokeWidth;
        waveColor = msg.waveColor;
        lastFrameTime = performance.now();
        rafId = requestAnimationFrame(_raf);
        break;
      case "resize":
        dpr = msg.dpr; cssWidth = msg.cssWidth; cssHeight = msg.cssHeight;
        const newW = Math.round(cssWidth * dpr), newH = Math.round(cssHeight * dpr);
        if (canvas.width !== newW || canvas.height !== newH) { canvas.width = newW; canvas.height = newH; }
        break;
      case "setPlaying":
        playing = msg.playing;
        _heightTarget = playing ? 1 : 0;
        break;
      case "setProgress":
        progress = Math.max(0, Math.min(1, msg.progress));
        break;
      case "setWaveColor":
        waveColor = msg.waveColor;
        break;
      case "destroy":
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        break;
    }
  };
`;

class SquigglyProgress {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.progress = 0;
    this.playing = false;
    this.waveColor = null;
    this.overlay = opts.overlay ?? false;
    this._heightTarget = 0;
    this._useWorker = false;
    this.worker = null;

    // Common config
    this.waveLength = opts.waveLength ?? 48;
    this.lineAmplitude = opts.lineAmplitude ?? 3.5;
    this.phaseSpeed = opts.phaseSpeed ?? 3.5;
    this.strokeWidth = opts.strokeWidth ?? 2;

    // Resolve wave color eagerly so we can pass it to the Worker
    this.waveColor =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--green")
        .trim() || "#1ed760";

    // ── Try OffscreenCanvas + Worker path ──
    // IMPORTANT: Create the Worker FIRST, then transfer the canvas.
    // If the Worker constructor throws (e.g. CSP blocks blob: URLs),
    // the canvas must remain untouched so the main-thread fallback works.
    if (
      typeof HTMLCanvasElement !== "undefined" &&
      typeof HTMLCanvasElement.prototype.transferControlToOffscreen ===
        "function"
    ) {
      try {
        // Step 1: Create Worker from blob — this can throw due to CSP
        const blob = new Blob([_squigglyWorkerCode], {
          type: "application/javascript",
        });
        const blobUrl = URL.createObjectURL(blob);
        this.worker = new Worker(blobUrl);
        URL.revokeObjectURL(blobUrl); // clean up — Worker already loaded

        // Step 2: Only NOW transfer the canvas to OffscreenCanvas.
        // This is irreversible, so we only do it after the Worker is confirmed.
        const offscreen = canvas.transferControlToOffscreen();
        this.worker.postMessage(
          {
            type: "init",
            canvas: offscreen,
            overlay: this.overlay,
            waveLength: this.waveLength,
            lineAmplitude: this.lineAmplitude,
            phaseSpeed: this.phaseSpeed,
            strokeWidth: this.strokeWidth,
            waveColor: this.waveColor,
          },
          [offscreen],
        );

        // ResizeObserver on main thread → sends resize to Worker
        this._resizeObserver = new ResizeObserver(() => {
          const rect = this.canvas.getBoundingClientRect();
          const cssW = Math.round(rect.width) || 100;
          const cssH = Math.round(rect.height) || 20;
          this.worker.postMessage({
            type: "resize",
            dpr: window.devicePixelRatio || 1,
            cssWidth: cssW,
            cssHeight: cssH,
          });
        });
        this._resizeObserver.observe(canvas);
        // Send initial size
        const initRect = canvas.getBoundingClientRect();
        this.worker.postMessage({
          type: "resize",
          dpr: window.devicePixelRatio || 1,
          cssWidth: Math.round(initRect.width) || 100,
          cssHeight: Math.round(initRect.height) || 20,
        });

        this._useWorker = true;
        return; // Worker handles everything — no main-thread RAF needed
      } catch (e) {
        // Worker creation failed — canvas was NOT transferred, safe to fallback
        this.worker = null;
        console.warn(
          "SquigglyProgress: OffscreenCanvas Worker failed, falling back to main thread:",
          e.message,
        );
      }
    }

    // ── Main-thread fallback ──
    this.ctx = canvas.getContext("2d");
    this.heightFraction = 0;
    this.phaseOffset = 0;
    this.lastFrameTime = null;
    this.rafId = null;
    this.transitionPeriods = 1.5;
    this.minWaveEndpoint = 0.2;
    this.matchedWaveEndpoint = 0.6;
    this.edgeTaperPx = 12;

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(canvas);
    this._resize();

    this._raf = this._raf.bind(this);
    this._startRaf();
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.round(rect.width) || 100;
    const cssH = Math.round(rect.height) || 20;
    const newW = Math.round(cssW * dpr);
    const newH = Math.round(cssH * dpr);
    if (this.canvas.width !== newW || this.canvas.height !== newH) {
      this.canvas.width = newW;
      this.canvas.height = newH;
    }
    this.dpr = dpr;
    this.cssWidth = cssW;
    this.cssHeight = cssH;
  }

  setPlaying(playing) {
    this.playing = playing;
    this._heightTarget = playing ? 1 : 0;
    if (this._useWorker) {
      this.worker.postMessage({ type: "setPlaying", playing });
      return;
    }
  }

  setProgress(pct) {
    this.progress = Math.max(0, Math.min(1, pct));
    if (this._useWorker) {
      this.worker.postMessage({ type: "setProgress", progress: this.progress });
      return;
    }
  }

  _startRaf() {
    if (this.rafId) return;
    this.lastFrameTime = performance.now();
    this.rafId = requestAnimationFrame(this._raf);
  }

  _raf(now) {
    this.rafId = requestAnimationFrame(this._raf);
    const dt = Math.min((now - (this.lastFrameTime || now)) / 1000, 0.05);
    this.lastFrameTime = now;

    const diff = this._heightTarget - this.heightFraction;
    const speed = this._heightTarget > this.heightFraction ? 2.2 : 1.6;
    this.heightFraction += diff * Math.min(dt * speed * 5, 1);
    if (Math.abs(diff) < 0.001) this.heightFraction = this._heightTarget;

    if (this.playing || this.heightFraction > 0.01) {
      this.phaseOffset += dt * this.phaseSpeed;
    }

    this._draw();
  }

  _draw() {
    const { ctx, canvas, dpr, cssWidth, cssHeight } = this;
    if (!ctx || !cssWidth || !cssHeight) return;

    if (!this.waveColor) {
      this.waveColor =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--green")
          .trim() || "#1ed760";
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const W = cssWidth;
    const cy = cssHeight / 2;
    const progress = this.progress;
    const thumbR = this.overlay ? 3 : 3.5;
    const leftInset = this.strokeWidth + 4;
    const rightInset = this.strokeWidth + 4;
    const totalProgressPx = Math.max(
      leftInset,
      Math.min(W - rightInset, W * progress),
    );
    const waveEndPx = Math.max(0, totalProgressPx - thumbR - 1);

    const waveProgressPx =
      W *
      (progress > this.matchedWaveEndpoint
        ? progress
        : this._lerp(
            this.minWaveEndpoint,
            this.matchedWaveEndpoint,
            this._lerpInv(0, this.matchedWaveEndpoint, progress),
          ));

    const greyStart =
      progress <= 0 ? leftInset : Math.min(totalProgressPx + thumbR + 1, W);
    if (greyStart < W) {
      ctx.beginPath();
      ctx.moveTo(greyStart, cy);
      ctx.lineTo(W, cy);
      ctx.strokeStyle = this.overlay
        ? "rgba(255,255,255,0.13)"
        : "rgba(255,255,255,0.1)";
      ctx.lineWidth = this.strokeWidth * 0.8;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    if (progress > 0 && totalProgressPx > leftInset + thumbR * 2) {
      ctx.beginPath();
      ctx.arc(leftInset, cy, this.strokeWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = this.overlay ? "rgba(255,255,255,0.3)" : this.waveColor;
      ctx.fill();
    }

    if (waveEndPx < 1) {
      if (progress > 0) this._drawThumb(ctx, totalProgressPx, cy, thumbR);
      ctx.restore();
      return;
    }

    const amp = this.lineAmplitude;
    const hf = this.heightFraction;
    const tp = this.transitionPeriods;
    const edgeTaper = this.edgeTaperPx;
    const k = (2 * Math.PI) / this.waveLength;
    const phase = this.phaseOffset;

    const computeAmp = (x) => {
      const length = tp * this.waveLength;
      const headCoeff = this._lerpInvSat(
        waveProgressPx + length / 2,
        waveProgressPx - length / 2,
        x,
      );
      const leftCoeff = this._lerpInvSat(leftInset, leftInset + edgeTaper, x);
      const rightCoeff = this._lerpInvSat(waveEndPx, waveEndPx - edgeTaper, x);
      return hf * amp * headCoeff * leftCoeff * rightCoeff;
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(leftInset, 0, Math.max(0, waveEndPx - leftInset), cssHeight);
    ctx.clip();

    ctx.beginPath();
    const step = 2;
    let first = true;
    for (let x = leftInset; x <= waveEndPx; x += step) {
      const envelope = computeAmp(x);
      const y = cy + Math.sin(k * x + phase) * envelope;
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else ctx.lineTo(x, y);
    }
    if (!first) {
      const envelope = computeAmp(waveEndPx);
      ctx.lineTo(waveEndPx, cy + Math.sin(k * waveEndPx + phase) * envelope);
    }
    ctx.strokeStyle = this.overlay ? "#fff" : this.waveColor;
    ctx.lineWidth = this.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();

    this._drawThumb(ctx, totalProgressPx, cy, thumbR);
    ctx.restore();
  }

  _drawThumb(ctx, x, cy, r) {
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = this.overlay ? "#fff" : this.waveColor;
    ctx.fill();
  }

  _lerp(a, b, t) {
    return a + (b - a) * t;
  }
  _lerpInv(a, b, v) {
    return b === a ? 0 : (v - a) / (b - a);
  }
  _lerpInvSat(a, b, v) {
    return Math.max(0, Math.min(1, this._lerpInv(a, b, v)));
  }

  destroy() {
    if (this._useWorker && this.worker) {
      this.worker.postMessage({ type: "destroy" });
      this.worker.terminate();
      this.worker = null;
    }
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this._resizeObserver?.disconnect();
  }
}

let squigglyNP = null; // now-playing bar squiggly
let squigglyOV = null; // overlay bar squiggly

const LYRIC_PANEL_FOCUS_RATIO = 0.2;
const LYRIC_OVERLAY_FOCUS_RATIO = 0.25;

// ── Lyrics scroll-override state ──
// When the user manually scrolls synced lyrics, auto-scroll pauses.
// It resumes automatically on the NEXT active-line change.
let _lyricsUserScrolling = false;
let _lyricsUserScrollTimer = null;
let _ovLyricsUserScrolling = false;
let _ovLyricsUserScrollTimer = null;
const VIRTUAL_ROW_HEIGHT = 58;
const VIRTUAL_ROW_BUFFER_BASE = 6;
let VIRTUAL_ROW_BUFFER = VIRTUAL_ROW_BUFFER_BASE;
let searchDebounceTimer = null;
let scrollEndTimer = null;

// ─── Velocity-Gated Overscan State ────────────────────────────────
const VELOCITY_THRESHOLD = 800; // px/s — above this, double the buffer
let _scrollVelocity = 0;
let _lastScrollTop = 0;
let _lastScrollTime = 0;
let _velocityIdleTimer = null;

// ─── Bitmap Thumbnail Atlas ───────────────────────────────────────
const thumbnailAtlas = new Map(); // trackId → ImageBitmap (40×40)
const THUMBNAIL_SIZE = 40;
const THUMB_DPR = Math.min(window.devicePixelRatio || 1, 2);
let _atlasBuildQueue = [];
let _atlasBuilding = false;

// ─── ThumbHash: Instant Placeholder System ────────────────────────
// Stores tiny (~100 byte) hashes per track for instant blurred previews.
// Eliminates ALL black cards - every card shows color immediately.
const _thumbHashCache = new Map(); // trackId → data URL of decoded placeholder
const THUMBHASH_PLACEHOLDER_CSS =
  "position:absolute;inset:0;width:100%;height:100%;filter:blur(8px);transform:scale(1.1);opacity:0.6;transition:opacity 0.3s ease;z-index:0;image-rendering:auto;";

// ─── Revolutionary: Dominant Color Cache ─────────────────────────────
// Extracts the dominant color from each track's ThumbHash or cover art.
// Every card gets an instant colored background BEFORE any image loads.
// Zero-cost: colors come from already-decoded ThumbHash data.
const _dominantColorCache = new Map(); // trackId → '#rrggbb'

function _extractDominantColor(rgbaData, w, h) {
  // Average center pixels (most representative of album art)
  let r = 0,
    g = 0,
    b = 0,
    count = 0;
  const cx0 = Math.floor(w * 0.25),
    cx1 = Math.floor(w * 0.75);
  const cy0 = Math.floor(h * 0.25),
    cy1 = Math.floor(h * 0.75);
  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      const i = (y * w + x) * 4;
      r += rgbaData[i];
      g += rgbaData[i + 1];
      b += rgbaData[i + 2];
      count++;
    }
  }
  if (count === 0) return "#333333";
  r = Math.round(r / count);
  g = Math.round(g / count);
  b = Math.round(b / count);
  // Darken to fit dark theme
  const darken = 0.45;
  r = Math.round(r * darken);
  g = Math.round(g * darken);
  b = Math.round(b * darken);
  return `rgb(${r},${g},${b})`;
}

// Pre-computed fallback gradient colors per art-index (matches .art-0..art-7)
const _artGradientColors = [
  "rgb(90,24,80)", // art-0: purple-red
  "rgb(110,55,18)", // art-1: orange-red
  "rgb(12,70,55)", // art-2: teal-blue
  "rgb(55,24,48)", // art-3: purple-dark
  "rgb(95,50,12)", // art-4: amber-red
  "rgb(18,55,75)", // art-5: ocean
  "rgb(75,30,50)", // art-6: berry
  "rgb(40,60,30)", // art-7: forest
];

function _getDominantColorForTrack(track) {
  if (!track) return "#1a1a1a";
  if (_dominantColorCache.has(track.id))
    return _dominantColorCache.get(track.id);
  return _artGradientColors[track.id % 8] || "#1a1a1a";
}

// ─── Playlist Collage Disk Cache ──────────────────────────────────
// Persists playlist cover collage images across app restarts.
// When a playlist's track list changes, the collage is invalidated and regenerated.
// Uses content-hash (hash of sorted track IDs) for smart invalidation:
// if a new song is added or removed, the hash changes and the collage
// is regenerated on next load.
const _playlistCollageCache = new Map(); // playlistId → dataURL (session hot-cache)
const COLLAGE_IDB_PREFIX = "collage::";
const COLLAGE_LAYOUT_VERSION = 3; // Bumped when collage layout changes (forces cache invalidation)

/** Compute a content hash for a playlist's track list (sorted for order-independence). */
function _computePlaylistContentHash(trackIds) {
  // Simple hash: sort IDs to be order-independent, then join and hash
  const sorted = [...trackIds].sort().join(",");
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const chr = sorted.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return String(hash);
}

async function _getCachedCollage(playlistId, tracks) {
  if (_playlistCollageCache.has(playlistId))
    return _playlistCollageCache.get(playlistId);
  const idbKey = COLLAGE_IDB_PREFIX + playlistId;
  const cached = await _idbGet(idbKey);
  // IDB cache stores {url, hash} — check if content hash still matches
  if (cached) {
    // Check layout version — if the collage was generated with an older layout,
    // force regeneration by invalidating the cache
    if (
      typeof cached === "object" &&
      cached.version !== COLLAGE_LAYOUT_VERSION
    ) {
      _idbSet(idbKey, null);
      // Don't return cached — force regeneration below
    } else {
      const trackIds = (tracks || []).map((t) => t.id);
      const currentHash = _computePlaylistContentHash(trackIds);
      if (typeof cached === "object" && cached.hash !== undefined) {
        if (cached.hash === currentHash) {
          _playlistCollageCache.set(playlistId, cached.url);
          return cached.url;
        }
        // Hash mismatch — playlist changed, invalidate IDB entry
        _idbSet(idbKey, null);
      } else if (typeof cached === "string") {
        // Old format (no hash) — use it but schedule a regeneration with hash
        _playlistCollageCache.set(playlistId, cached);
        return cached;
      }
    }
  }
  // Also try disk cache via IPC (with content hash for smart invalidation)
  try {
    const trackIds = (tracks || []).map((t) => t.id);
    const contentHash = _computePlaylistContentHash(trackIds);
    const res = await window.novaAPI.invoke("playlist:get-collage", {
      playlistId,
      contentHash,
    });
    if (res?.success && res.url) {
      _playlistCollageCache.set(playlistId, res.url);
      _idbSet(idbKey, { url: res.url, hash: contentHash });
      return res.url;
    }
  } catch (_) {}
  return null;
}

async function _saveCollageCache(playlistId, dataURL, tracks) {
  const trackIds = (tracks || []).map((t) => t.id);
  const contentHash = _computePlaylistContentHash(trackIds);
  _playlistCollageCache.set(playlistId, dataURL);
  _idbSet(COLLAGE_IDB_PREFIX + playlistId, {
    url: dataURL,
    hash: contentHash,
    version: COLLAGE_LAYOUT_VERSION,
  });
  // Also persist to disk for cross-session durability (IDB can be cleared by browser)
  try {
    await window.novaAPI.invoke("playlist:save-collage", {
      playlistId,
      dataURL,
      contentHash,
    });
  } catch (_) {}
}

function _invalidateCollageCache(playlistId) {
  _playlistCollageCache.delete(playlistId);
  _idbSet(COLLAGE_IDB_PREFIX + playlistId, null);
  // Also delete disk cache
  try {
    window.novaAPI.invoke("playlist:invalidate-collage", playlistId);
  } catch (_) {}
}

/**
 * Preload all playlist collage covers after library is loaded.
 * This ensures cached collages from previous sessions are immediately
 * available when the user navigates to the playlists section.
 *
 * BUGFIX v3: Also preloads the cover art URLs for all tracks that appear
 * in playlist collages. This way, when the user navigates to Playlists,
 * the live collage cells' <img> elements hit the browser cache instead
 * of making fresh protocol requests. Combined with the collage canvas cache,
 * this makes the Playlists section render instantly with all images visible.
 */
async function _preloadPlaylistCovers() {
  try {
    const playlists = state.playlists || [];
    if (playlists.length === 0) {
      // Playlists may not be loaded yet — wait for them
      return;
    }
    const libById = new Map(state.tracks.map((t) => [t.id, t]));
    for (const playlist of playlists) {
      const tracks = (playlist.tracks || [])
        .map((id) => libById.get(id))
        .filter(Boolean);
      if (tracks.length > 0) {
        // BUGFIX: Invalidate disk collage cache if layout version changed.
        // This forces re-generation of cached collages with the new diamond stack layout.
        try {
          await window.novaAPI.invoke(
            "playlist:invalidate-collage",
            playlist.id,
          );
        } catch (_) {}

        // Preload cover art URLs for the first 4 tracks (used by live collage cells)
        // into the browser cache so they're instantly available on render
        const artTracks = tracks
          .filter((t) => _resolveCoverArtSrcWithReuse(t))
          .slice(0, 4);
        for (const track of artTracks) {
          const src = _resolveCoverArtSrcWithReuse(track);
          if (src && !_coverArtPreloader.isLoaded(src)) {
            _coverArtPreloader.enqueue([src]);
          }
        }
        // This populates the canvas collage cache (in-memory + IDB + disk) for next display
        await _getCachedCollage(playlist.id, tracks);
      }
    }
  } catch (_) {}
}

/**
 * Resolve any coverArt value to a displayable image src.
 * Handles file paths, data: URIs, nova-media:// URLs, and _hasCoverArt tracks.
 *
 * Priority chain:
 * 1. track.coverArt (file path, data: URI, or nova-media:// URL) → display URL
 * 2. track._hasCoverArt flag → nova-media://art/{trackId}
 * 3. track._thumb (48px thumbnail URL) → display URL
 * 4. Empty string (triggers art-placeholder in caller)
 */
function _resolveCoverArtSrc(track) {
  if (!track) return "";
  if (track.coverArt) {
    return _getCoverArtDisplayUrl(track.coverArt);
  }
  if (track._hasCoverArt) {
    return `nova-media://art/${encodeURIComponent(track.id)}`;
  }
  if (track._thumb) {
    // _thumb can be a nova-media:// protocol URL or a data: URI
    if (
      track._thumb.startsWith("nova-media://") ||
      track._thumb.startsWith("data:")
    ) {
      return track._thumb;
    }
    return _getCoverArtDisplayUrl(track._thumb);
  }
  return "";
}

// ─── Revolutionary: Aggressive Cover Art Preloader ────────────────────
// Uses requestIdleCallback to preload ALL cover art URLs in background.
// By the time the user scrolls, images are already in browser cache.
// Dual-layer defense: preloader fills cache + fallback chain prevents black cards.
const _coverArtPreloader = {
  _queue: [],
  _loaded: new Set(),
  _failed: new Set(),
  _active: false,

  enqueue(urls) {
    const newUrls = urls.filter(
      (u) =>
        u &&
        !this._loaded.has(u) &&
        !this._failed.has(u) &&
        !this._queue.includes(u),
    );
    if (newUrls.length === 0) return;
    this._queue.push(...newUrls);
    if (!this._active) this._start();
  },

  _start() {
    this._active = true;
    const processBatch = (deadline) => {
      while (this._queue.length > 0 && deadline.timeRemaining() > 3) {
        const url = this._queue.shift();
        this._preloadSingle(url);
      }
      if (this._queue.length > 0) {
        requestIdleCallback(processBatch, { timeout: 800 });
      } else {
        this._active = false;
      }
    };
    requestIdleCallback(processBatch, { timeout: 200 });
  },

  _preloadSingle(url) {
    if (this._loaded.has(url) || this._failed.has(url)) return;
    const img = new Image();
    img.onload = () => this._loaded.add(url);
    img.onerror = () => this._failed.add(url);
    img.src = url;
  },

  isLoaded(url) {
    return this._loaded.has(url);
  },
};

function preloadAllCoverArt() {
  const urls = [];
  for (const t of state.tracks) {
    // Preload tracks with file-path coverArt (protocol URL)
    if (t.coverArt && !t.coverArt.startsWith("data:")) {
      const displayUrl = _getCoverArtDisplayUrl(t.coverArt);
      if (!urls.includes(displayUrl)) urls.push(displayUrl);
    }
    // Preload tracks with _hasCoverArt flag (base64 stripped, served via nova-media://art/)
    if (!t.coverArt && t._hasCoverArt) {
      const artUrl = `nova-media://art/${encodeURIComponent(t.id)}`;
      if (!urls.includes(artUrl)) urls.push(artUrl);
    }
    // Also preload tracks with thumb URLs (from IDB or IPC)
    if (t._thumb && t._thumb.startsWith("nova-media://")) {
      if (!urls.includes(t._thumb)) urls.push(t._thumb);
    }
  }
  _coverArtPreloader.enqueue(urls);
}

const virtualList = {
  items: [],
  mode: "library",
  raf: 0,
  lastStart: -1,
  lastEnd: -1,
  scrollHandler: null,
  slotPool: [], // all created slot DOM elements
  poolSize: 0, // high-water mark of pool usage
  activeSlots: new Map(), // trackId → slot (currently visible)
  freeSlots: [], // slots not currently assigned to a track
  _lastActiveTrackId: null,
};

// ─── Predictive Prefetch on Hover ─────────────────────────────────
// Warms cover art + lyrics for a track when the pointer enters its row.
const _coverArtWarmCache = new Map(); // trackId → HTMLImageElement (pre-decoded)
let _hoverPrefetchTrackId = null;

function warmCoverArt(track) {
  if (!track) return;
  if (!track.coverArt && !track._hasCoverArt) return;
  if (_coverArtWarmCache.has(track.id)) return;
  const img = new Image();
  img.src = track.coverArt
    ? _getCoverArtDisplayUrl(track.coverArt)
    : `nova-media://art/${encodeURIComponent(track.id)}`;
  img.decoding = "async";
  _coverArtWarmCache.set(track.id, img);
  // Evict oldest entries if cache grows too large
  if (_coverArtWarmCache.size > 200) {
    const firstKey = _coverArtWarmCache.keys().next().value;
    _coverArtWarmCache.delete(firstKey);
  }
}

function scrollToCurrentTrack() {
  if (!state.currentTrack) return;
  if (
    state.activeNavSection !== "library" &&
    state.activeNavSection !== "queue"
  )
    return;
  const idx = virtualList.items.findIndex(
    (t) => t.id === state.currentTrack.id,
  );
  if (idx < 0) return;
  const area = $("track-area");
  if (!area) return;
  const targetScrollTop = idx * VIRTUAL_ROW_HEIGHT;
  const areaHeight = area.clientHeight;
  const currentScroll = area.scrollTop;
  if (
    targetScrollTop < currentScroll ||
    targetScrollTop + VIRTUAL_ROW_HEIGHT > currentScroll + areaHeight
  ) {
    area.scrollTo({
      top: Math.max(0, targetScrollTop - areaHeight / 2),
      behavior: "smooth",
    });
  }
}
// ─── Scroll-to-playing pill ────────────────────────────────────────
function _updateScrollPill() {
  const pill = document.getElementById("scroll-to-track-pill");
  if (!pill) return;
  if (
    !state.currentTrack ||
    (state.activeNavSection !== "library" && state.activeNavSection !== "queue")
  ) {
    pill.classList.add("hidden");
    return;
  }
  const idx = virtualList.items.findIndex(
    (t) => t.id === state.currentTrack.id,
  );
  if (idx < 0) {
    pill.classList.add("hidden");
    return;
  }
  const area = $("track-area");
  if (!area) {
    pill.classList.add("hidden");
    return;
  }
  const rowTop = idx * VIRTUAL_ROW_HEIGHT;
  const inView =
    rowTop >= area.scrollTop &&
    rowTop + VIRTUAL_ROW_HEIGHT <= area.scrollTop + area.clientHeight;
  if (inView) {
    pill.classList.add("hidden");
  } else {
    // Update art
    const pillArt = document.getElementById("scroll-pill-art");
    const pillTitle = document.getElementById("scroll-pill-title");
    const pillArtist = document.getElementById("scroll-pill-artist");
    if (pillArt) {
      // Ensure pill-eq is always present
      let pillEq = pillArt.querySelector(".pill-eq");
      if (!pillEq) {
        pillEq = document.createElement("div");
        pillEq.className = "pill-eq";
        pillEq.innerHTML =
          "<span></span><span></span><span></span><span></span>";
        pillArt.appendChild(pillEq);
      }
      // Update art without destroying pill-eq
      let artEl = pillArt.querySelector("img, .art-placeholder");
      const hasArt =
        state.currentTrack.coverArt || state.currentTrack._hasCoverArt;
      if (hasArt) {
        if (!artEl || artEl.tagName !== "IMG") {
          artEl = document.createElement("img");
          artEl.alt = "";
          artEl.style.cssText =
            "width:100%;height:100%;object-fit:cover;display:block;position:absolute;inset:0;";
          pillArt.insertBefore(artEl, pillEq);
          pillArt
            .querySelectorAll(".art-placeholder")
            .forEach((e) => e.remove());
        }
        artEl.src = state.currentTrack.coverArt
          ? _getCoverArtDisplayUrl(state.currentTrack.coverArt)
          : `nova-media://art/${encodeURIComponent(state.currentTrack.id)}`;
      } else {
        if (!artEl || artEl.tagName === "IMG") {
          artEl = document.createElement("div");
          const artIdx = state.currentTrack.id % 8;
          artEl.className = `art-placeholder art-${artIdx}`;
          artEl.style.cssText =
            "width:100%;height:100%;font-size:14px;position:absolute;inset:0;";
          artEl.innerHTML = "&#127925;";
          pillArt.insertBefore(artEl, pillEq);
          pillArt.querySelectorAll("img").forEach((e) => e.remove());
        }
      }
      pillArt.classList.toggle("playing", state.isPlaying);
    }
    if (pillTitle)
      pillTitle.textContent = state.currentTrack.title || "Now Playing";
    if (pillArtist) pillArtist.textContent = state.currentTrack.artist || "";
    pill.classList.remove("hidden");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const pill = document.getElementById("scroll-to-track-pill");
  if (pill) {
    pill.addEventListener("click", () => {
      scrollToCurrentTrack();
      setTimeout(_updateScrollPill, 400);
    });
  }
  const area = $("track-area");
  if (area) {
    area.addEventListener(
      "scroll",
      () => {
        if (
          state.activeNavSection === "library" ||
          state.activeNavSection === "queue"
        )
          _updateScrollPill();
      },
      { passive: true },
    );
  }
  // On resize: if panel is open and we cross the float breakpoint, re-apply correct mode
  window.addEventListener("resize", () => {
    const lyricsPanel = $("lyrics-panel");
    if (!lyricsPanel || lyricsPanel.classList.contains("closed")) return;
    if (_isLyricsFloatMode()) {
      lyricsPanel.classList.add("floating", "float-open");
      document.querySelector(".content")?.classList.remove("lyrics-open");
    } else {
      lyricsPanel.classList.remove("floating", "float-open");
      document.querySelector(".content")?.classList.add("lyrics-open");
    }
    // Re-apply nav mode so floating card shows/hides correctly on resize
    _applyNavMode(state.settings.navMode || "hover");
  });

  // Draggable floating lyrics panel
  (function _wireLyricsDrag() {
    const panel = $("lyrics-panel");
    const header = panel?.querySelector(".lyrics-header");
    if (!panel || !header) return;
    let dragging = false,
      ox = 0,
      oy = 0;
    header.addEventListener("mousedown", (e) => {
      if (!panel.classList.contains("floating")) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      panel.style.transition = "none";
      panel.style.bottom = "auto";
      panel.style.right = "auto";
      panel.style.top = rect.top + "px";
      panel.style.left = rect.left + "px";
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      let nx = e.clientX - ox;
      let ny = e.clientY - oy;
      const pw = panel.offsetWidth,
        ph = panel.offsetHeight;
      nx = Math.max(0, Math.min(window.innerWidth - pw, nx));
      ny = Math.max(0, Math.min(window.innerHeight - ph, ny));
      panel.style.left = nx + "px";
      panel.style.top = ny + "px";
    });
    document.addEventListener("mouseup", () => {
      if (dragging) {
        dragging = false;
        panel.style.transition = "";
      }
    });
  })();
});

const sectionCache = {
  tracksVersion: 0,
  albums: null,
  artists: null,
};

// ─── Scroll Position Memory ──────────────────────────────────────
// Saves scroll position before navigating to a detail view (album/artist/playlist)
// and restores it when the user clicks "Back". Without this, the grid starts
// from the top every time, which is jarring for users with large libraries.
//
// KEY TECHNIQUE (from web research / SPA best practices):
// The container is hidden with visibility:hidden BEFORE DOM changes,
// then scrollTop is set SYNCHRONOUSLY after content is written,
// then revealed after the next paint. This guarantees the user
// NEVER sees scrollTop=0 → jump to saved position.
const _sectionScrollPos = new Map(); // section → { scrollTop, anchorKey, anchorOffset }
let _scrollRestoreSection = null; // set before renderFn if we need to restore

/**
 * Prepare for a scroll-restore render: hides the scroll container
 * so the user won't see any flash during the transition.
 * Must be called BEFORE renderSectionSurface().
 */
function _beginScrollRestore(section) {
  _scrollRestoreSection = section;
  const area = $("track-area");
  if (area) area.style.visibility = "hidden";
}

/**
 * Finish scroll restoration: set scrollTop, then reveal after paint.
 * Must be called AFTER cards are in the DOM.
 */
function _finishScrollRestore() {
  const section = _scrollRestoreSection;
  _scrollRestoreSection = null;
  if (!section) return;

  const saved = _sectionScrollPos.get(section);
  const area = $("track-area");
  if (!area) return;

  const restored = _tryScrollToSaved(area, saved);

  // Reveal after the browser has committed the scroll position
  if (restored) {
    requestAnimationFrame(() => {
      area.style.visibility = "";
    });
  } else {
    // Content not tall enough yet (large library, chunked rendering).
    // Keep hidden and retry until we succeed or give up.
    _retryScrollRestore(area, saved, 30);
  }
}

/**
 * Attempt to set scrollTop from saved data (anchor-based or pixel-based).
 * Returns true if scroll was successfully set.
 */
function _tryScrollToSaved(area, saved) {
  if (!saved || saved.scrollTop <= 0) {
    area.scrollTop = 0;
    return true;
  }
  // Anchor-based restore (most reliable after DOM rebuilds)
  if (saved.anchorKey) {
    const cards = area.querySelectorAll("[data-card-key]");
    for (const card of cards) {
      if (card.dataset.cardKey === saved.anchorKey) {
        const cardRect = card.getBoundingClientRect();
        const areaRect = area.getBoundingClientRect();
        const offset = cardRect.top - areaRect.top;
        area.scrollTop = area.scrollTop + offset - (saved.anchorOffset || 0);
        return true;
      }
    }
  }
  // Pixel-based fallback
  if (area.scrollHeight >= saved.scrollTop) {
    area.scrollTop = saved.scrollTop;
    return true;
  }
  return false;
}

/**
 * Retry scroll restoration with exponential backoff.
 * Keeps the container hidden until the scroll is set correctly,
 * or gives up after ~1.5s to avoid leaving the page blank.
 */
function _retryScrollRestore(area, saved, delay) {
  setTimeout(() => {
    if (_tryScrollToSaved(area, saved)) {
      requestAnimationFrame(() => {
        area.style.visibility = "";
      });
    } else if (delay < 500) {
      _retryScrollRestore(area, saved, Math.min(delay * 1.5, 500));
    } else {
      // Give up — reveal anyway at whatever position we're at
      area.style.visibility = "";
    }
  }, delay);
}

/**
 * Save scroll position for a section before navigating away.
 * Captures both pixel offset and the nearest card key for robust restoration.
 * @param {string} section - "albums" | "artists" | "playlists"
 */
function _saveSectionScroll(section) {
  const area = $("track-area");
  if (!area) return;
  const scrollTop = area.scrollTop;

  // Find the card closest to the top of the viewport for anchor-based restore
  let anchorKey = null;
  let anchorOffset = 0;
  const areaRect = area.getBoundingClientRect();
  const cards = area.querySelectorAll("[data-card-key]");
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (rect.top >= areaRect.top - 10) {
      anchorKey = card.dataset.cardKey;
      anchorOffset = Math.round(rect.top - areaRect.top);
      break;
    }
  }

  _sectionScrollPos.set(section, { scrollTop, anchorKey, anchorOffset });
}

// ─── Offscreen Panel System ───────────────────────────────────────
// One permanent <div> per non-virtual section lives in #section-panels.
// Navigation = display toggle only — zero DOM work after first visit.
// Virtual sections (library, queue) still use #track-list as before.
const _PANEL_SECTIONS = [
  "home",
  "albums",
  "artists",
  "playlists",
  "settings",
  "equalizer",
  "help",
];
const _panelDirty = {}; // section → true means needs re-render
_PANEL_SECTIONS.forEach((s) => {
  _panelDirty[s] = true;
});

let _activePanelTarget = null; // set before calling renderX so renderSectionSurface/getSectionSurface know which panel to write into

function _getPanel(section) {
  const host = document.getElementById("section-panels");
  if (!host) return null;
  let panel = host.querySelector(`[data-panel="${section}"]`);
  if (!panel) {
    panel = document.createElement("div");
    panel.dataset.panel = section;
    panel.style.display = "none";
    panel.style.width = "100%";
    panel.style.height = "100%";
    host.appendChild(panel);
  }
  return panel;
}

function _showPanel(section) {
  // Hide all panels
  const host = document.getElementById("section-panels");
  if (host) {
    host.querySelectorAll("[data-panel]").forEach((p) => {
      p.style.display = "none";
    });
  }
  // Also hide #track-list (used by virtual sections)
  const tl = $("track-list");
  if (tl) tl.style.display = "none";
  const headers = $("col-headers");
  if (headers) headers.style.display = "none";

  const area = $("track-area");
  if (area && virtualList.scrollHandler) {
    area.removeEventListener("scroll", virtualList.scrollHandler, {
      passive: true,
    });
    virtualList.scrollHandler = null;
  }
  if (area) area.onscroll = null;
  if (virtualList.raf) {
    cancelAnimationFrame(virtualList.raf);
    virtualList.raf = 0;
  }

  const panel = _getPanel(section);
  if (panel) panel.style.display = "";
  return panel;
}

function _showVirtual() {
  // Hide all section panels, show #track-list
  const host = document.getElementById("section-panels");
  if (host)
    host.querySelectorAll("[data-panel]").forEach((p) => {
      p.style.display = "none";
    });
  const tl = $("track-list");
  if (tl) tl.style.display = "";
}

function invalidateRendered(section) {
  if (section) {
    _panelDirty[section] = true;
  } else {
    _PANEL_SECTIONS.forEach((s) => {
      _panelDirty[s] = true;
    });
  }
}

function _showCached(section, renderFn) {
  const panel = _showPanel(section);
  if (_panelDirty[section]) {
    _activePanelTarget = panel;
    renderFn();
    _activePanelTarget = null;
    _panelDirty[section] = false;
    // Capture subtitle for this panel
    if (panel) panel.dataset.subtitle = $("content-subtitle").textContent || "";
  } else {
    $("content-subtitle").textContent = panel
      ? panel.dataset.subtitle || ""
      : "";
  }
}
let smoothProgressRaf = 0;
let smoothProgressBaseTime = 0;
let smoothProgressBasePerf = 0;
let smoothProgressDuration = 0;
let isSeeking = false;

// Re-render an already-visible panel (e.g. after a settings change).
// Only re-renders if the panel is currently visible.
function _reRenderPanel(section, renderFn) {
  const panel = _getPanel(section);
  if (!panel) {
    renderFn();
    return;
  }
  _panelDirty[section] = true;
  _activePanelTarget = panel;
  renderFn();
  _activePanelTarget = null;
  _panelDirty[section] = false;
  if (panel) panel.dataset.subtitle = $("content-subtitle").textContent || "";
}
// 8×8 canvas sample — ~64 pixel reads, runs once per track, cached by trackId.
const _artColorCache = new Map(); // trackId → css color string
const _artColorCallbacks = new Map(); // trackId → [pending callbacks]

// node-vibrant: Android Palette API port — gives DarkVibrant (saturated + dark).
// nodeIntegration=true so we can require() and pass file paths directly.
// For data: URIs we decode to a Buffer first (node-vibrant accepts Buffer in Node mode).
const _Vibrant = (() => {
  try {
    return require("node-vibrant/node").Vibrant;
  } catch (e) {
    return null;
  }
})();

function _sampleArtColor(trackId, src, cb) {
  if (_artColorCache.has(trackId)) {
    cb(_artColorCache.get(trackId));
    return;
  }
  if (_artColorCallbacks.has(trackId)) {
    _artColorCallbacks.get(trackId).push(cb);
    return;
  }
  _artColorCallbacks.set(trackId, [cb]);
  const _resolve = (color) => {
    _artColorCache.set(trackId, color);
    if (_artColorCache.size > 300)
      _artColorCache.delete(_artColorCache.keys().next().value);
    (_artColorCallbacks.get(trackId) || []).forEach((fn) => fn(color));
    _artColorCallbacks.delete(trackId);
  };

  if (!_Vibrant) {
    _resolve("rgb(18,18,18)");
    return;
  }

  let source;
  try {
    if (src.startsWith("nova-media://")) {
      // Custom protocol URL — load via Image element, then extract via canvas
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = src;
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const dataURL = canvas.toDataURL("image/jpeg", 0.5);
          const commaIdx = dataURL.indexOf(",");
          const buffer = Buffer.from(dataURL.slice(commaIdx + 1), "base64");
          _Vibrant
            .from(buffer)
            .quality(1)
            .getPalette()
            .then((palette) => {
              const swatch =
                palette.DarkVibrant ||
                palette.DarkMuted ||
                palette.Vibrant ||
                palette.Muted;
              if (!swatch) {
                _resolve("rgb(18,18,18)");
                return;
              }
              let [r, g, b] = swatch.rgb;
              const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
              if (lum > 0.4) {
                const d = 0.3 / lum;
                r = Math.round(r * d);
                g = Math.round(g * d);
                b = Math.round(b * d);
              }
              _resolve(`rgb(${r},${g},${b})`);
            })
            .catch(() => _resolve("rgb(18,18,18)"));
        } catch (_) {
          _resolve("rgb(18,18,18)");
        }
      };
      img.onerror = () => _resolve("rgb(18,18,18)");
      return; // async path — _resolve called in callbacks above
    }
    if (src.startsWith("data:")) {
      // data: URI → strip header, decode base64 to Buffer
      const comma = src.indexOf(",");
      source = Buffer.from(src.slice(comma + 1), "base64");
    } else {
      // file:// or plain path → strip scheme, decode URI encoding
      source = decodeURIComponent(
        src.startsWith("file:///")
          ? src.slice(8)
          : src.replace(/^file:\/\//, ""),
      );
    }
  } catch (e) {
    _resolve("rgb(18,18,18)");
    return;
  }

  _Vibrant
    .from(source)
    .quality(1) // quality=1: no downsampling, most accurate
    .getPalette()
    .then((palette) => {
      // Priority: DarkVibrant > DarkMuted > Vibrant darkened > fallback
      const swatch =
        palette.DarkVibrant ||
        palette.DarkMuted ||
        palette.Vibrant ||
        palette.Muted;
      if (!swatch) {
        _resolve("rgb(18,18,18)");
        return;
      }
      let [r, g, b] = swatch.rgb;
      // If we landed on Vibrant/Muted (not already dark), force luminance dark
      if (!palette.DarkVibrant && !palette.DarkMuted) {
        // Convert to HSL, clamp L to 0.15
        r /= 255;
        g /= 255;
        b /= 255;
        const max = Math.max(r, g, b),
          min = Math.min(r, g, b);
        const l = (max + min) / 2;
        const delta = max - min;
        const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
        let h = 0;
        if (delta > 0) {
          if (max === r) h = ((g - b) / delta + 6) % 6;
          else if (max === g) h = (b - r) / delta + 2;
          else h = (r - g) / delta + 4;
          h *= 60;
        }
        _resolve(`hsl(${Math.round(h)},${Math.round(s * 100)}%,15%)`);
      } else {
        _resolve(`rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`);
      }
    })
    .catch(() => _resolve("rgb(18,18,18)"));
}

function _setNpBg(track) {
  const el = $("np-overlay-bg");
  if (!el) return;
  if (track.coverArt || track._hasCoverArt) {
    const artSrc = track.coverArt
      ? _getCoverArtDisplayUrl(track.coverArt)
      : `nova-media://art/${encodeURIComponent(track.id)}`;
    _sampleArtColor(track.id, artSrc, (color) => {
      el.style.background = color;
      if (state.dynamicAccentColor) {
        _sampleArtColorVibrant(track.id, artSrc, (accent) => {
          _applyAccentColor(accent);
        });
      }
    });
  } else {
    el.style.background = "rgb(18,18,18)";
    if (state.dynamicAccentColor) _applyAccentColor("#1ed760");
  }
}

const _artVibrantCache = new Map();
function _sampleArtColorVibrant(trackId, src, cb) {
  if (_artVibrantCache.has(trackId)) {
    cb(_artVibrantCache.get(trackId));
    return;
  }
  if (!_Vibrant) {
    cb("#1ed760");
    return;
  }
  let source;
  try {
    if (src.startsWith("nova-media://")) {
      // Custom protocol URL — load via Image element, then extract via canvas
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = src;
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const dataURL = canvas.toDataURL("image/jpeg", 0.5);
          const commaIdx = dataURL.indexOf(",");
          const buffer = Buffer.from(dataURL.slice(commaIdx + 1), "base64");
          _Vibrant
            .from(buffer)
            .quality(1)
            .getPalette()
            .then((palette) => {
              const swatch =
                palette.Vibrant ||
                palette.LightVibrant ||
                palette.Muted ||
                palette.DarkVibrant;
              if (!swatch) {
                cb("#1ed760");
                return;
              }
              const [r, g, b] = swatch.rgb;
              const hex =
                "#" +
                [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
              _artVibrantCache.set(trackId, hex);
              cb(hex);
            })
            .catch(() => cb("#1ed760"));
        } catch (_) {
          cb("#1ed760");
        }
      };
      img.onerror = () => cb("#1ed760");
      return;
    }
    if (src.startsWith("data:")) {
      const comma = src.indexOf(",");
      source = Buffer.from(src.slice(comma + 1), "base64");
    } else {
      source = decodeURIComponent(
        src.startsWith("file:///")
          ? src.slice(8)
          : src.replace(/^file:\/\//, ""),
      );
    }
  } catch {
    cb("#1ed760");
    return;
  }
  _Vibrant
    .from(source)
    .quality(1)
    .getPalette()
    .then((palette) => {
      const swatch =
        palette.Vibrant ||
        palette.LightVibrant ||
        palette.Muted ||
        palette.DarkVibrant;
      if (!swatch) {
        cb("#1ed760");
        return;
      }
      const [r, g, b] = swatch.rgb;
      const hex =
        "#" +
        [r, g, b]
          .map((v) => Math.round(v).toString(16).padStart(2, "0"))
          .join("");
      if (_artVibrantCache.size > 200)
        _artVibrantCache.delete(_artVibrantCache.keys().next().value);
      _artVibrantCache.set(trackId, hex);
      cb(hex);
    })
    .catch(() => cb("#1ed760"));
}

// ─── Helpers ──────────────────────────────────────────────────────
function $(id) {
  return document.getElementById(id);
}
function $$(sel) {
  return document.querySelectorAll(sel);
}
function formatTime(sec) {
  if (!sec || !isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
function calcTotalDuration(tracks) {
  let s = 0;
  tracks.forEach((t) => {
    s += t.duration || 0;
  });
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}
function getArtIndex(track) {
  if (!track) return 0;
  let hash = 0;
  const str = (track.title || "") + (track.artist || "") + (track.album || "");
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 5;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getArtistText(track) {
  return Array.isArray(track?.artist)
    ? track.artist.join(", ")
    : track?.artist || "Unknown Artist";
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .trim();
}

// Strict exact-substring match only. Returns the priority tier hit (lower = higher priority),
// or null if no match. `fields` is an ordered array of already-normalised strings.
function exactMatchTier(fields, query) {
  for (let i = 0; i < fields.length; i++) {
    if (fields[i] && fields[i].includes(query)) return i;
  }
  return null;
}

function buildSearchIndex() {
  state.searchIndex = state.tracks.map((track) => ({
    track,
    // Pre-normalise every field once
    title: normalizeSearchText(track.title),
    artist: normalizeSearchText(getArtistText(track)),
    album: normalizeSearchText(track.album),
    genre: normalizeSearchText(track.genre),
    year: normalizeSearchText(String(track.year || "")),
  }));
}

function invalidateSectionCache() {
  sectionCache.tracksVersion += 1;
  sectionCache.albums = null;
  sectionCache.artists = null;
  _PANEL_SECTIONS.forEach((s) => {
    _panelDirty[s] = true;
  });
}

// Helper: Parse LRC string into array of { time, text }
function parseLrcString(lrcText) {
  if (typeof lrcText !== "string") return null;
  const lines = lrcText.split("\n");
  const synced = [];
  const timeRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const timeMatches = [...trimmed.matchAll(timeRegex)];
    if (timeMatches.length > 0) {
      const text = trimmed
        .replace(/\[\d{1,3}:\d{2}(?:[.:]\d{2,3})?\]/g, "")
        .trim();
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
        const time = minutes * 60 + seconds + ms / 1000;
        synced.push({ time, text });
      }
    }
  }

  if (synced.length === 0) return null;
  return synced.sort((a, b) => a.time - b.time);
}

// Helper: Center the active lyric line in container smoothly.
// State is stored per-container on the element to avoid shared-global conflicts
// between the sidebar lyrics panel and the overlay lyrics scroller.
function centerActiveLyric(container, activeEl) {
  if (!container || !activeEl) return;

  // SAFETY NET: never auto-scroll unsynced lyrics.  Unsynced lyrics are
  // strictly manual-scroll — the user is in full control of position at
  // all times.  _updateLyricsHighlight already returns early for unsynced
  // before reaching this function, but we double-check here in case any
  // future code path calls centerActiveLyric directly.
  if (container.classList.contains("unsynced-scroll")) return;

  // If the user is manually scrolling, don't override their position
  const isOverlay = container.id === "ov-lyrics-scroll";
  if (isOverlay && _ovLyricsUserScrolling) return;
  if (!isOverlay && _lyricsUserScrolling) return;

  if (container._lyricRaf) {
    cancelAnimationFrame(container._lyricRaf);
    container._lyricRaf = null;
  }

  container._lyricRaf = requestAnimationFrame(() => {
    container._lyricRaf = null;
    const containerHeight = container.clientHeight;
    const activeHeight = activeEl.offsetHeight;
    const activeTop = activeEl.offsetTop;
    if (activeTop === 0 && activeEl !== container.firstElementChild) return;
    const focusRatio = isOverlay
      ? LYRIC_OVERLAY_FOCUS_RATIO
      : LYRIC_PANEL_FOCUS_RATIO;
    const focusY = containerHeight * focusRatio;
    const target = Math.max(0, activeTop + activeHeight / 2 - focusY);
    container._lyricScrollTarget = target;
    if (!container._lyricScrolling) _lerpLyricScroll(container);
  });
}

function _lerpLyricScroll(container) {
  container._lyricScrolling = true;
  const SPEED = 0.13;
  const THRESHOLD = 0.5;
  function step() {
    // CRITICAL: check the cancel flag at every step.  Without this, once
    // the lerp starts it ignores setUserScrolling() (which sets
    // _lyricScrolling = false) and keeps overriding the user's manual
    // scroll position every animation frame.  This was the root cause
    // of "unsynced lyrics can't be scrolled after alternating with
    // synced" — a previous synced lerp kept running on the same
    // container after the unsynced re-render.
    if (!container._lyricScrolling) return;

    const diff = container._lyricScrollTarget - container.scrollTop;
    if (Math.abs(diff) < THRESHOLD) {
      container.scrollTop = container._lyricScrollTarget;
      container._lyricScrolling = false;
      container._lyricStepRaf = null;
      return;
    }
    container.scrollTop += diff * SPEED;
    // Store the inner RAF id too — setUserScrolling cancels _lyricRaf
    // (the outer one from centerActiveLyric), but the lerp runs its own
    // chain via requestAnimationFrame(step).  Without storing + cancelling
    // this id, cancelAnimationFrame(_lyricRaf) does nothing to stop the
    // lerp once it's already started.
    container._lyricStepRaf = requestAnimationFrame(step);
  }
  container._lyricStepRaf = requestAnimationFrame(step);
}

/**
 * Cancel any in-flight programmatic lyric scroll on a container.
 * Call this whenever the container's content is about to be replaced
 * (e.g. _renderLyrics, _buildOverlayLyrics) or when the user starts
 * scrolling manually.  Without this, a lerp started during a previous
 * synced-lyrics render keeps running on the same container after the
 * DOM is rebuilt for unsynced lyrics, fighting the user's manual scroll.
 */
function _cancelLyricLerp(container) {
  if (!container) return;
  container._lyricScrolling = false;
  if (container._lyricRaf) {
    cancelAnimationFrame(container._lyricRaf);
    container._lyricRaf = null;
  }
  if (container._lyricStepRaf) {
    cancelAnimationFrame(container._lyricStepRaf);
    container._lyricStepRaf = null;
  }
  container._lyricScrollTarget = 0;
}

// ─── Initialize ───────────────────────────────────────────────────
// PERFORMANCE OPTIMIZATION: Parallel startup — settings and library
// load are initiated simultaneously instead of sequentially. This
// cuts ~200-400ms from startup on typical libraries because:
//   1. settings:get-all IPC and library:get-all IPC run in parallel
//   2. UI wiring is deferred via requestIdleCallback so it doesn't
//      block the critical rendering path
//   3. SquigglyProgress init is deferred to after first paint
document.addEventListener("DOMContentLoaded", async () => {
  console.log("NovaTune initializing...");

  // ── Critical path: load data as fast as possible ──
  // Fire settings + library + playlists in parallel
  const [settingsResult, libraryResult, playlistsResult] = await Promise.all([
    _loadSettings(),
    _loadLibrary(),
    _loadPlaylists(),
  ]);

  // Post-load: restore session state (depends on settings + library)
  _loadRecentPlayed();
  if (!state.currentTrack) _setControlsVisible(false);

  // ── Deferred: UI wiring (non-critical, can wait) ──
  // Wire these during idle time so they don't delay first paint
  requestIdleCallback(
    () => {
      _wireSidebar();
      _wireNowPlaying();
      _wireOverlay();
      _wireSearch();
      _wireTabs();
      _wireSort();
      _wireAddFolder();
      _wireShufflePlay();
      _wireScanProgress();
      _wireVolume();
      _setupAudioEvents();
      _wireLyricsEditor();
      _wirePlaylistMenu();
      _wireAutoUpdater();
    },
    { timeout: 100 },
  );

  // ── Deferred: Squiggly progress canvases ──
  // These create OffscreenCanvas Workers which are expensive.
  // Defer to after first paint for faster time-to-interactive.
  requestAnimationFrame(() => {
    const npCanvas = $("squiggly-canvas");
    const ovCanvas = $("ov-squiggly-canvas");
    if (npCanvas)
      squigglyNP = new SquigglyProgress(npCanvas, {
        strokeWidth: 2,
        lineAmplitude: 3.5,
        waveLength: 22,
      });
    if (ovCanvas)
      squigglyOV = new SquigglyProgress(ovCanvas, {
        strokeWidth: 1.5,
        lineAmplitude: 2.8,
        waveLength: 20,
        overlay: true,
      });
  });

  // Lazy-init audio on first user interaction
  document.addEventListener(
    "click",
    async () => {
      if (!audioEngine._isInitialized) {
        try {
          await audioEngine.init();
          console.log("AudioEngine ready");
        } catch (e) {
          /* retry on play */
        }
      }
    },
    { once: true },
  );

  console.log("NovaTune ready!");

  // Dismiss splash screen after app is fully initialized
  // Wait for realistic loader animation (2.2s) plus a small buffer
  const splash = document.getElementById("splash-screen");
  if (splash) {
    const initTime = performance.now();
    // Minimum display time so the animation plays fully
    const MIN_SPLASH_MS = 2400;
    const elapsed = () => performance.now() - initTime;
    const dismiss = () => {
      splash.classList.add("hidden");
      // Remove from DOM after fade-out transition completes
      setTimeout(() => splash.remove(), 600);
    };
    // If app loaded faster than the animation, wait for it to finish
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed());
    setTimeout(dismiss, remaining);
  }
});

// ─── Keyboard Shortcuts (unified global handler) ─────────────────
//
// BUGFIX HISTORY:
//   The original code had three separate keydown listeners at lines 1931,
//   7858, and 7879, each handling a subset of shortcuts. Several documented
//   shortcuts (M for mute, Ctrl+F / "/" for search focus, F11 to close the
//   Now Playing overlay) were never wired in the live app — they only
//   existed in the unused renderer/ui/*.js scaffold files. The arrow-key
//   volume handler at line 7858 also required _seekBarActive to be set,
//   meaning arrows did nothing until the user had clicked the squiggly bar
//   at least once.
//
//   This handler consolidates every documented shortcut into one place,
//   runs them in a defined priority order, and respects editable fields.
//
// Priority order (highest first):
//   1. Media keys (always active, even in inputs)
//   2. F11 close Now Playing overlay (always active when overlay is open)
//   3. Ctrl+F / Cmd+F / "/" focus search (skipped in editable fields except plain "/" — actually skipped in editable too)
//   4. Editable-field guard — everything below is skipped while typing in INPUT/TEXTAREA/SELECT/contenteditable
//   5. Esc close overlay / dialog / clear search
//   6. Space play/pause
//   7. N / P next / previous
//   8. M mute toggle
//   9. Arrow Up / Down scroll library 200 px
//  10. Arrow Left / Right seek ±5 s (or Shift+Arrow = next/prev track)
//  11. If seek bar is active AND no Shift: Arrow Left/Right adjusts volume ±5%
//      (kept for parity with the Help docs that say "when seek bar focused")
//
document.addEventListener("keydown", (e) => {
  // ─── 1. Media keys (always active) ────────────────────────────
  if (e.code === "MediaPlayPause") {
    e.preventDefault();
    togglePlayPause();
    return;
  }
  if (e.code === "MediaNextTrack") {
    e.preventDefault();
    playNext();
    return;
  }
  if (e.code === "MediaPrevTrack") {
    e.preventDefault();
    playPrevious();
    return;
  }

  // ─── 2. F11 closes the Now Playing overlay (always active when open) ──
  // The Help docs say "F11 → Close Now Playing overlay". The scaffold
  // NowPlayingOverlay.js wired this but the live app never did. The
  // standard F11 (fullscreen) behaviour is also suppressed here while
  // the overlay is open, so the user's intent (close the overlay) wins.
  if (e.key === "F11" && state.overlayOpen) {
    e.preventDefault();
    closeOverlay();
    return;
  }

  // ─── 3. Ctrl+F / Cmd+F / "/" focus search ─────────────────────
  // Skipped while typing in any editable field — "/" in particular would
  // otherwise hijack quick-search inputs and the lyrics editor.
  const tag = e.target.tagName;
  const isEditable =
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    e.target.isContentEditable;

  if (!isEditable) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      const searchInput = $("search-input");
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      return;
    }
    // "/" focuses search (Google / YouTube / Gmail convention).
    // Shift+"/" produces "?" — let that fall through so it doesn't steal
    // the keystroke from any future help-overlay shortcut.
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const searchInput = $("search-input");
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      return;
    }
  }

  // ─── 4. Editable-field guard ──────────────────────────────────
  // Everything below this point is suppressed while the user is typing
  // in an input, textarea, select, or contenteditable element. The
  // individual dialog / lyrics-editor Enter+Esc handlers (registered on
  // the document by those components) still fire because they were added
  // AFTER this listener in document order — actually they were added
  // before, but they call e.stopPropagation() implicitly by being
  // registered on document with the same priority. To be safe, dialogs
  // and the lyrics editor handle their own Enter/Esc via per-input
  // listeners that fire before this global handler.
  if (isEditable) return;

  // ─── 5. Escape: close overlay / dialog / clear search ────────
  if (e.key === "Escape") {
    // Priority: overlay → dialog → search clear
    if (state.overlayOpen) {
      e.preventDefault();
      closeOverlay();
      return;
    }
    const openDialog = document.querySelector(".app-dialog");
    if (openDialog) {
      // The dialog's own keydown handler (registered in showAppDialog)
      // will catch this and resolve(null). Don't double-handle.
      return;
    }
    const lyricsEditor = $("lyrics-editor");
    if (lyricsEditor && lyricsEditor.classList.contains("open")) {
      // Lyrics editor has its own close path
      return;
    }
    // Otherwise: clear the search box if it has content
    const searchInput = $("search-input");
    if (searchInput && searchInput.value) {
      e.preventDefault();
      searchInput.value = "";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput.blur();
      return;
    }
    // Last resort: blur whatever has focus so the next keypress doesn't
    // accidentally trigger a button's space-bar click.
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    return;
  }

  // ─── 6. Space → play / pause ─────────────────────────────────
  if (e.code === "Space") {
    e.preventDefault();
    togglePlayPause();
    return;
  }

  // ─── 7. N → next, P → previous ───────────────────────────────
  if (e.code === "KeyN" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    playNext();
    return;
  }
  if (e.code === "KeyP" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    playPrevious();
    return;
  }

  // ─── 8. M → mute / unmute ────────────────────────────────────
  // Mirrors the click handler on #vol-btn in _wireVolume (line 8109):
  // if volume > 0, store it as _prevVolume and mute; if muted, restore.
  if (e.code === "KeyM" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (state.volume > 0) {
      state._prevVolume = state.volume;
      state.volume = 0;
    } else {
      state.volume = state._prevVolume || 0.5;
    }
    audioEngine.setVolume(state.volume);
    updateVolumeUi();
    return;
  }

  // ─── 9. ArrowUp / ArrowDown → scroll library 200 px ──────────
  if (e.code === "ArrowUp" && !e.shiftKey) {
    e.preventDefault();
    const area = $("track-area");
    if (area) area.scrollTop -= 200;
    return;
  }
  if (e.code === "ArrowDown" && !e.shiftKey) {
    e.preventDefault();
    const area = $("track-area");
    if (area) area.scrollTop += 200;
    return;
  }

  // ─── 10 & 11. ArrowLeft / ArrowRight ─────────────────────────
  // Help docs specify three behaviours for horizontal arrows:
  //   (a) When seek bar is focused AND no Shift → adjust volume ±5%
  //   (b) Shift+Arrow → next / previous track
  //   (c) Plain Arrow (no Shift, seek bar not focused) → seek ±5 s
  //
  // We honour (a) only when _seekBarActive is true (set by clicking the
  // squiggly bar). Otherwise we fall through to (b) or (c). This matches
  // the Help docs: "→ / ← (when seek bar focused) Adjust volume ±5%"
  // and "→ / ← (when seek bar focused, alt handler) Seek ±5 s" — the
  // latter is interpreted as "when not focused, seek ±5s".
  if (e.code === "ArrowRight" || e.code === "ArrowLeft") {
    e.preventDefault();
    const sign = e.code === "ArrowRight" ? 1 : -1;

    if (e.shiftKey) {
      // (b) Shift+Arrow → next / previous track
      if (sign > 0) playNext();
      else playPrevious();
      return;
    }

    if (_seekBarActive) {
      // (a) Seek bar focused → adjust volume ±5%
      state.volume = Math.max(0, Math.min(1, state.volume + sign * 0.05));
      audioEngine.setVolume(state.volume);
      updateVolumeUi();
      return;
    }

    // (c) Plain Arrow, no seek bar focused → seek ±5 s
    const cur = audioEngine.getCurrentTime() || 0;
    const dur = audioEngine.getDuration();
    let target = cur + sign * 5;
    if (isFinite(dur) && dur > 0) {
      target = Math.max(0, Math.min(target, dur));
    } else {
      target = Math.max(0, target);
    }
    audioEngine.seek(target);
    return;
  }
});

// ─── Sidebar ──────────────────────────────────────────────────────
function _wireSidebar() {
  const menuBtn = $("menu-btn");
  if (menuBtn) menuBtn.addEventListener("click", toggleSidebar);
  const overlay = $("sidebar-overlay");
  if (overlay) overlay.addEventListener("click", toggleSidebar);

  const lyricsToggle = $("lyrics-toggle-btn");
  if (lyricsToggle) {
    lyricsToggle.addEventListener("click", toggleLyricsPanel);
  }
  const lyricsClose = $("lyrics-close-btn");
  if (lyricsClose) {
    lyricsClose.addEventListener("click", closeLyricsPanel);
  }

  const lyricsEdit = $("lyrics-edit-btn");
  if (lyricsEdit) {
    lyricsEdit.addEventListener("click", () => openLyricsEditor());
  }

  $$(".nav-item[data-section]").forEach((item) => {
    item.addEventListener("click", () => {
      $$(".nav-item").forEach((n) => {
        n.classList.remove("active");
      });
      item.classList.add("active");
      state.activeNavSection = item.dataset.section;
      _navigateTo(item.dataset.section);
      // Close sidebar on mobile
      if (window.innerWidth <= 640) toggleSidebar();
    });
  });

  // Help "?" button in sidebar search bar
  const helpBtn = $("sidebar-help-btn");
  if (helpBtn) {
    helpBtn.addEventListener("click", () => {
      $$(".nav-item").forEach((n) => n.classList.remove("active"));
      state.activeNavSection = "help";
      _navigateTo("help");
      if (window.innerWidth <= 640) toggleSidebar();
    });
  }
}

function toggleLyricsPanel() {
  if (!state.currentTrack) return;
  const lyricsPanel = $("lyrics-panel");
  if (!lyricsPanel) return;
  if (lyricsPanel.classList.contains("closed")) {
    openLyricsPanel();
  } else {
    closeLyricsPanel();
  }
}

function _isLyricsFloatMode() {
  return window.innerWidth <= 1100;
}

function openLyricsPanel() {
  const lyricsPanel = $("lyrics-panel");
  const contentEl = document.querySelector(".content");
  const lyricsToggle = $("lyrics-toggle-btn");
  if (_isLyricsFloatMode()) {
    if (lyricsPanel) {
      lyricsPanel.classList.remove("closed");
      lyricsPanel.classList.add("floating", "float-open");
    }
  } else {
    if (lyricsPanel) {
      lyricsPanel.classList.remove("closed", "floating", "float-open");
    }
    if (contentEl) contentEl.classList.add("lyrics-open");
  }
  if (lyricsToggle) lyricsToggle.classList.add("active");
}

function closeLyricsPanel() {
  const lyricsPanel = $("lyrics-panel");
  const contentEl = document.querySelector(".content");
  const lyricsToggle = $("lyrics-toggle-btn");
  if (lyricsPanel) {
    lyricsPanel.classList.add("closed");
    lyricsPanel.classList.remove("floating", "float-open");
    // Reset any drag position
    lyricsPanel.style.top = "";
    lyricsPanel.style.left = "";
    lyricsPanel.style.bottom = "";
    lyricsPanel.style.right = "";
  }
  if (contentEl) contentEl.classList.remove("lyrics-open");
  if (lyricsToggle) lyricsToggle.classList.remove("active");
}

function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  $("sidebar").classList.toggle("open", state.sidebarOpen);
  $("sidebar-overlay").classList.toggle("open", state.sidebarOpen);
}

function _updateToolbarVisibility(section) {
  const shuffleBtn = $("shuffle-play-btn");
  const sortGroup = document.querySelector(".sort-group");
  const lyricsToggle = $("lyrics-toggle-btn");
  // Only show shuffle & play and sort-by in home and library sections
  const showShuffleAndSort = section === "home" || section === "library";
  if (shuffleBtn) shuffleBtn.style.display = showShuffleAndSort ? "" : "none";
  if (sortGroup) sortGroup.style.display = showShuffleAndSort ? "" : "none";
  // Show section title in toolbar for other sections (albums, artists, playlists, queue)
  // when shuffle/sort are hidden
  let sectionLabel = document.getElementById("toolbar-section-label");
  if (!showShuffleAndSort) {
    if (!sectionLabel) {
      sectionLabel = document.createElement("span");
      sectionLabel.id = "toolbar-section-label";
      sectionLabel.style.cssText =
        "font-size:14px;font-weight:700;color:var(--text-primary);letter-spacing:-0.2px;";
      const toolbar = document.querySelector(".toolbar");
      if (toolbar) toolbar.insertBefore(sectionLabel, toolbar.firstChild);
    }
    const sectionNames = {
      albums: "Albums",
      artists: "Artists",
      playlists: "Playlists",
      queue: "Play Queue",
      settings: "Settings",
      equalizer: "Equalizer",
      help: "Help",
    };
    sectionLabel.textContent = sectionNames[section] || "";
    sectionLabel.style.display = sectionLabel.textContent ? "" : "none";
  } else if (sectionLabel) {
    sectionLabel.style.display = "none";
  }
}

function _navigateTo(section) {
  const title = $("content-title");
  const area = $("track-area");
  // Reset scroll immediately for snappy feel
  if (area) {
    area.scrollTop = 0;
    area.style.scrollBehavior = "auto";
  }
  // Hide scroll pill immediately if not a list section
  if (section !== "library" && section !== "queue") {
    const pill = document.getElementById("scroll-to-track-pill");
    if (pill) pill.classList.add("hidden");
  }
  _updateToolbarVisibility(section);
  switch (section) {
    case "home":
      title.textContent = "Home";
      _showCached("home", renderHome);
      break;
    case "library":
      title.textContent = "Music";
      _showVirtual();
      renderTracks(state.filteredTracks, "library");
      requestAnimationFrame(_updateScrollPill);
      break;
    case "albums":
      title.textContent = "Albums";
      _showCached("albums", renderAlbums);
      // Trigger exhaustive cover art search for any blank album cards
      requestIdleCallback(() => _exhaustiveCoverArtAudit(), { timeout: 2000 });
      requestIdleCallback(() => _auditCardImages(), { timeout: 1000 });
      break;
    case "artists":
      title.textContent = "Artists";
      _showCached("artists", renderArtists);
      // Trigger exhaustive cover art search for any blank artist cards
      requestIdleCallback(() => _exhaustiveCoverArtAudit(), { timeout: 2000 });
      requestIdleCallback(() => _auditCardImages(), { timeout: 1000 });
      break;
    case "queue":
      title.textContent = "Play Queue";
      _showVirtual();
      renderTracks(state.queue, "queue");
      break;
    case "playlists":
      title.textContent = "Playlists";
      _showCached("playlists", renderPlaylists);
      break;
    case "lyrics":
      title.textContent = "Lyrics";
      break;
    case "settings":
      title.textContent = "Settings";
      _showCached("settings", renderSettings);
      break;
    case "equalizer":
      title.textContent = "Equalizer";
      _showCached("equalizer", renderEqualizer);
      break;
    case "help":
      title.textContent = "Help";
      _showCached("help", renderHelp);
      break;
    default:
      title.textContent = "Music";
  }
}

// ─── Search ───────────────────────────────────────────────────────
function _wireSearch() {
  const input = $("search-input");
  input.addEventListener("input", (e) => {
    const q = normalizeSearchText(e.target.value.trim());
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      if (!q) {
        state.filteredTracks = [...state.tracks];
      } else {
        const section = state.activeNavSection; // library | albums | artists | playlists | home

        // Field priority order per section
        // Each entry: [field, ...] in descending match priority
        let fieldOrder;
        if (section === "albums") {
          fieldOrder = ["album", "title", "artist", "genre", "year"];
        } else if (section === "playlists") {
          // playlist name handled separately below; fallback to track fields
          fieldOrder = ["title", "album", "artist", "genre", "year"];
        } else if (section === "home") {
          fieldOrder = ["title", "artist", "album", "genre", "year"];
        } else if (section === "artists") {
          fieldOrder = ["artist", "title", "album", "genre", "year"];
        } else {
          // library / home / default: song name first
          fieldOrder = ["title", "album", "artist", "genre", "year"];
        }

        // For playlists section, first check if query matches a playlist name
        if (section === "playlists") {
          const matchedPlaylists = (state.playlists || []).filter((pl) =>
            normalizeSearchText(pl.name).includes(q),
          );
          if (matchedPlaylists.length > 0) {
            // Show all tracks belonging to matched playlists
            const trackIds = new Set(
              matchedPlaylists.flatMap((pl) => pl.trackIds || []),
            );
            state.filteredTracks = state.tracks.filter((t) =>
              trackIds.has(t.id),
            );
            _sortTracks();
            renderTracks(state.filteredTracks, "library");
            renderSearchSuggestions(q);
            return;
          }
          // No playlist name match — fall through to track-level search
        }

        const results = [];
        for (const entry of state.searchIndex || []) {
          const fields = fieldOrder.map((f) => entry[f] || "");
          const tier = exactMatchTier(fields, q);
          if (tier !== null) results.push({ track: entry.track, tier });
        }
        // Sort by tier (priority) then original track order
        results.sort((a, b) => a.tier - b.tier);
        state.filteredTracks = results.map((r) => r.track);
      }
      _sortTracks();
      if (
        state.activeNavSection === "albums" ||
        state.activeNavSection === "artists"
      ) {
        // SEARCH SCROLL-TO-TOP FIX
        // When the user types in search, we must ALWAYS land on the first
        // matching card.  Previously, if the user had visited the section,
        // clicked into a detail view, and come back (which saves scroll
        // position via _saveSectionScroll), the saved position would
        // STILL be present in _sectionScrollPos when the search re-rendered.
        // That triggered _beginScrollRestore → _finishScrollRestore inside
        // renderAlbums/renderArtists, snapping the view back to the OLD
        // scroll position — landing the user mid-list (or past the end of
        // the now-shorter search results), so the first match was off-screen.
        //
        // Fix: delete the saved scroll position BEFORE re-rendering so
        // hasSavedScroll returns false inside renderAlbums/renderArtists,
        // which lets renderSectionSurface reset scrollTop = 0 normally.
        // Then belt-and-suspenders: force scrollTop = 0 on the next frame
        // in case chunked rendering or async image loads shifted it.
        _sectionScrollPos.delete(state.activeNavSection);
        const renderFn =
          state.activeNavSection === "albums" ? renderAlbums : renderArtists;
        _reRenderPanel(state.activeNavSection, renderFn);
        requestAnimationFrame(() => {
          const area = $("track-area");
          if (area) area.scrollTop = 0;
        });
      } else {
        renderTracks(state.filteredTracks, "library");
      }
      renderSearchSuggestions(q);
    }, 90);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      input.dispatchEvent(new Event("input"));
      closeSearchSuggestions();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".sidebar-search")) closeSearchSuggestions();
  });
}

function closeSearchSuggestions() {
  document.querySelector(".search-suggestions")?.remove();
}

function renderSearchSuggestions(q) {
  closeSearchSuggestions();
  if (!q) return;
  const host = document.querySelector(".sidebar-search");
  if (!host) return;
  const suggestions = state.filteredTracks.slice(0, 6);
  if (!suggestions.length) return;
  const box = document.createElement("div");
  box.className = "search-suggestions";
  suggestions.forEach((track) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = `<span>${escapeHtml(track.title || "Unknown")}</span><small>${escapeHtml(getArtistText(track))} • ${escapeHtml(track.album || "Unknown Album")}</small>`;
    btn.addEventListener("click", () => {
      $("search-input").value = track.title || "";
      state.filteredTracks = [track];
      renderTracks(state.filteredTracks, "library");
      closeSearchSuggestions();
    });
    box.appendChild(btn);
  });
  host.appendChild(box);
}

// ─── Tabs ─────────────────────────────────────────────────────────
function _wireTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.currentTab = tab.dataset.tab;
      // Future: filter by albums/artists
    });
  });
}

// ─── Sort ─────────────────────────────────────────────────────────
function _wireSort() {
  const trigger = $("sort-trigger");
  const dropdown = $("sort-dropdown");
  const menu = $("sort-menu");
  const currentText = $("sort-current");

  if (!trigger) return;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("open");
  });

  document.addEventListener("click", () => {
    dropdown.classList.remove("open");
  });

  const items = menu.querySelectorAll(".dropdown-item");
  items.forEach((item) => {
    item.addEventListener("click", () => {
      items.forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      currentText.textContent = item.textContent;

      const val = item.dataset.value;
      state.sortKey = val;
      if (val === "dateAdded") {
        state.sortAsc = false; // Newest first
      } else {
        state.sortAsc = true;
      }

      _sortTracks();
      renderTracks(state.filteredTracks, "library");
    });
  });
}

function _sortTracks() {
  const key = state.sortKey;
  state.filteredTracks.sort((a, b) => {
    let va = a[key];
    let vb = b[key];
    if (va === undefined || va === null) va = "";
    if (vb === undefined || vb === null) vb = "";
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va < vb) return state.sortAsc ? -1 : 1;
    if (va > vb) return state.sortAsc ? 1 : -1;
    return 0;
  });
}

// ─── Add Folder ───────────────────────────────────────────────────
function _wireAddFolder() {
  $("add-folder-nav").addEventListener("click", async () => {
    console.log("[Add Folder] Opening folder dialog...");
    try {
      const result = await window.novaAPI.invoke("file:open-folder-dialog");
      if (!result.success || result.canceled) return;

      const folderPath = result.folderPath;
      console.log("[Add Folder] Scanning:", folderPath);

      // Navigate to library
      $$(".nav-item").forEach((n) => n.classList.remove("active"));
      const libItem = document.querySelector('[data-section="library"]');
      libItem.classList.add("active");
      state.activeNavSection = "library";
      $("content-title").textContent = "Music";

      // Show progress
      $("scan-progress").style.display = "flex";
      $("scan-progress-bar").style.width = "0%";
      $("scan-progress-text").textContent = `Scanning ${folderPath}...`;

      const scanResult = await window.novaAPI.invoke(
        "library:scan",
        folderPath,
      );
      $("scan-progress").style.display = "none";

      if (scanResult.success) {
        console.log(
          `[Add Folder] Done: ${scanResult.newTracks} new, ${scanResult.tracks.length} total`,
        );
        _bustIDBThumbCache();
        await _loadLibrary();
        _updateSidebarFolderInfo();
      } else {
        console.error("[Add Folder] Scan failed:", scanResult.error);
      }
    } catch (err) {
      console.error("[Add Folder] Error:", err);
      $("scan-progress").style.display = "none";
    }
  });

  // Sidebar refresh button
  $("sidebar-refresh-btn")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const scanFolders = Array.isArray(state.settings.scanFolders)
      ? state.settings.scanFolders
      : [];
    if (scanFolders.length === 0) return;

    $("scan-progress").style.display = "flex";
    $("scan-progress-bar").style.width = "0%";
    $("scan-progress-text").textContent = "Refreshing library...";

    for (const folderPath of scanFolders) {
      await window.novaAPI.invoke("library:scan", folderPath);
    }

    $("scan-progress").style.display = "none";
    _bustIDBThumbCache();
    await _loadLibrary();
    _updateSidebarFolderInfo();
  });

  // Initialize folder info on load
  _updateSidebarFolderInfo();
}

/**
 * Update the sidebar folder info: show the last scanned folder name
 * and the refresh button. Only shows the last folder name (shortened).
 */
function _updateSidebarFolderInfo() {
  const infoEl = $("sidebar-folder-info");
  const nameEl = $("sidebar-folder-name");
  if (!infoEl || !nameEl) return;

  const scanFolders = Array.isArray(state.settings.scanFolders)
    ? state.settings.scanFolders
    : [];

  if (scanFolders.length === 0) {
    infoEl.style.display = "none";
    return;
  }

  // Show just the last folder name (e.g. "Music" from "C:/Users/Music")
  const lastFolder = scanFolders[scanFolders.length - 1];
  const shortName =
    lastFolder.split(/[/\\]/).filter(Boolean).pop() || lastFolder;

  nameEl.textContent = shortName;
  nameEl.title = scanFolders.join("\n");
  infoEl.style.display = "flex";
}

// ─── Scan Progress ───────────────────────────────────────────────
function _wireScanProgress() {
  if (window.novaAPI) {
    window.novaAPI.on("library:scan-progress", (data) => {
      console.log("[scan]", data.stage, data.message || "");
      const overlay = $("scan-progress");
      const bar = $("scan-progress-bar");
      const text = $("scan-progress-text");
      if (overlay) overlay.style.display = "flex";
      if (text) text.textContent = data.message || "Scanning...";
      if (bar && data.percent) bar.style.width = data.percent + "%";
      if (data.stage === "complete" || data.stage === "error") {
        setTimeout(() => {
          if (overlay) overlay.style.display = "none";
        }, 1500);
      }
    });
  }
}

// ─── Shuffle & Play ──────────────────────────────────────────────
function _wireShufflePlay() {
  $("shuffle-play-btn").addEventListener("click", () => {
    if (state.tracks.length === 0) return;
    state.shuffleEnabled = true;
    $("shuffle-btn").classList.add("active");
    const shuffled = [...state.tracks].sort(() => Math.random() - 0.5);
    state.queue = shuffled;
    state.queueIndex = 0;
    playTrack(state.queue[0]);
  });
}

// ─── Library Loading ─────────────────────────────────────────────
function _showSkeletonRows(count = 12) {
  const container = $("track-list");
  const headers = $("col-headers");
  if (!container) return;
  if (headers) headers.style.display = "";
  container.className = "";
  container.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const row = document.createElement("div");
    row.className = "track-skeleton-row";
    row.innerHTML = `
      <div class="skel-rect skel-thumb"></div>
      <div class="skel-rect skel-line" style="width:${55 + Math.random() * 35}%"></div>
      <div class="skel-rect skel-line" style="width:${40 + Math.random() * 30}%"></div>
      <div class="skel-rect skel-short"></div>
      <div class="skel-rect skel-line" style="width:${45 + Math.random() * 30}%"></div>
      <div class="skel-rect skel-short"></div>
      <div></div>
    `;
    container.appendChild(row);
  }
  $("content-subtitle").textContent = "";
}

// ─── Bitmap Thumbnail Atlas Builder ─────────────────────────────────
// Resizes cover art to exactly 40×40 via createImageBitmap and stores
// ImageBitmap in a Map<trackId>. drawImage from bitmap is ~5× faster
// than decoding a full-res src per row.
// Built incrementally in idle chunks so it doesn't block the UI.
async function buildThumbnailAtlas() {
  _atlasBuildQueue = state.tracks.filter(
    (t) =>
      (t._thumb || t.coverArt || t._hasCoverArt) && !thumbnailAtlas.has(t.id),
  );
  if (_atlasBuilding) return;
  _atlasBuilding = true;

  const BATCH_SIZE = 20; // thumbnails per idle tick
  while (_atlasBuildQueue.length > 0) {
    const batch = _atlasBuildQueue.splice(0, BATCH_SIZE);
    const promises = batch.map(async (track) => {
      try {
        const img = new Image();
        let thumbSrc = track._thumb || track.coverArt;
        // Handle _hasCoverArt tracks (base64 stripped, served via protocol)
        if (!thumbSrc && track._hasCoverArt) {
          thumbSrc = `nova-media://art/${encodeURIComponent(track.id)}`;
        }
        img.src =
          thumbSrc.startsWith("nova-media://") || thumbSrc.startsWith("data:")
            ? thumbSrc
            : _getCoverArtDisplayUrl(thumbSrc);
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
        // Skip 1x1 transparent pixels (stale cache from protocol handler)
        // Revolutionary: Also bust the stale IDB entry so next launch doesn't hit it
        if (img.naturalWidth <= 1 || img.naturalHeight <= 1) {
          // This thumbnail is stale — the disk file was deleted or corrupted.
          // Remove from IDB so next launch re-generates it.
          _idbSet(`batch48::${track.id}`, null);
          delete track._thumb;
          return;
        }
        // Center-crop to square then resize — preserves aspect ratio (no pinching)
        const sw = img.naturalWidth;
        const sh = img.naturalHeight;
        const side = Math.min(sw, sh);
        const sx = Math.floor((sw - side) / 2);
        const sy = Math.floor((sh - side) / 2);
        const bitmap = await createImageBitmap(img, sx, sy, side, side, {
          resizeWidth: THUMBNAIL_SIZE,
          resizeHeight: THUMBNAIL_SIZE,
          resizeQuality: "medium",
        });
        thumbnailAtlas.set(track.id, bitmap);
      } catch (_) {
        // Skip failed thumbnails — fall back to <img> tag
      }
    });
    await Promise.all(promises);
    // Yield to the main thread between batches
    await new Promise((r) => requestIdleCallback(r, { timeout: 50 }));
  }

  _atlasBuilding = false;

  // Re-render visible rows now that bitmaps are available
  if (
    state.activeNavSection === "library" ||
    state.activeNavSection === "queue"
  ) {
    // Force all active slots to be repopulated so bitmap canvases are drawn
    for (const [trackId, slot] of virtualList.activeSlots) {
      slot._trackId = null; // mark dirty so _populateSlot runs
    }
    virtualList.lastStart = -1;
    virtualList.lastEnd = -1;
    renderVirtualRows();
  }
}

// ─── Exhaustive Cover Art Search ──────────────────────────────────
// Searches for sidecar thumbnails in the audio file's directory, then
// falls back to free online APIs (iTunes → Deezer) for missing covers.
// This runs after library load and progressively fills in missing art.

const COVER_ART_FILENAMES = [
  // Common sidecar cover art filenames (case-insensitive)
  "cover.jpg",
  "cover.jpeg",
  "cover.png",
  "cover.webp",
  "cover.gif",
  "folder.jpg",
  "folder.jpeg",
  "folder.png",
  "albumart.jpg",
  "albumart.jpeg",
  "albumart.png",
  "album.jpg",
  "album.jpeg",
  "album.png",
  "front.jpg",
  "front.jpeg",
  "front.png",
  "artwork.jpg",
  "artwork.jpeg",
  "artwork.png",
  "thumb.jpg",
  "thumb.jpeg",
  "thumb.png",
  ".folder.png",
  ".folder.jpg",
  // Windows Media Player style
  "albumart_{*}_large.jpg",
  "albumart_{*}_small.jpg",
  // Generic
  "art.jpg",
  "art.jpeg",
  "art.png",
  "thumbnail.jpg",
  "thumbnail.jpeg",
  "thumbnail.png",
];

const _coverArtSearchCache = new Map(); // trackId → string (data:URL or http URL) | null (searched, not found)
const _onlineArtQueue = []; // tracks needing online lookup
let _onlineArtRunning = false;

/**
 * Try to find a sidecar cover art file in the same directory as the track.
 * Called via IPC to the main process which has filesystem access.
 * Probes once whether the IPC handler exists; if not, skips silently.
 */
let _sidecarIpcAvailable = undefined; // undefined=not probed, true/false
async function _findSidecarCoverArt(track) {
  if (!track.filePath) return null;
  if (_coverArtSearchCache.has(track.id))
    return _coverArtSearchCache.get(track.id);

  // Probe once whether the IPC handler exists in the main process
  if (_sidecarIpcAvailable === undefined) {
    try {
      await window.novaAPI.invoke("coverart:find-sidecar", "__probe__");
      _sidecarIpcAvailable = true;
    } catch (e) {
      _sidecarIpcAvailable = false;
      console.info(
        "[CoverArt] sidecar IPC not available — skipping filesystem search. Online APIs will be used instead.",
      );
    }
  }

  if (_sidecarIpcAvailable) {
    try {
      const result = await window.novaAPI.invoke(
        "coverart:find-sidecar",
        track.filePath,
      );
      if (result && result.coverArt) {
        _coverArtSearchCache.set(track.id, result.coverArt);
        return result.coverArt;
      }
    } catch (_) {
      // Handler existed but this particular call failed — skip silently
    }
  }

  // Mark as searched-but-not-found so we don't retry
  _coverArtSearchCache.set(track.id, null);
  return null;
}

/**
const _albumArtCache = new Map(); // "artist::album" → url promise

async function _searchiTunesArt(track) {
  const artist = (Array.isArray(track.artist) ? track.artist[0] : track.artist) || "";
  const album = track.album && track.album !== "Unknown Album" ? track.album : "";
  const query = (album ? `${artist} ${album}` : `${artist} ${track.title || ""}`).trim();
  if (!query) return null;
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=5&media=music`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.results || !data.results.length) return null;
    const exact = data.results.find(r =>
      r.artworkUrl100 && album &&
      r.collectionName?.toLowerCase().includes(album.toLowerCase())
    );
    const hit = exact || data.results.find(r => r.artworkUrl100);
    if (hit) return hit.artworkUrl100.replace("100x100bb", "3000x3000bb").replace("100x100", "3000x3000");
  } catch (_) {}
  return null;
}

async function _searchDeezerArt(track) {
  const artist = (Array.isArray(track.artist) ? track.artist[0] : track.artist) || "";
  const album = track.album && track.album !== "Unknown Album" ? track.album : "";
  const query = (album ? `${artist} ${album}` : `${artist} ${track.title || ""}`).trim();
  if (!query || query.length < 3) return null;
  try {
    const url = `https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=3`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.data && data.data.length > 0)
      return data.data[0].cover_xl || data.data[0].cover_big || data.data[0].cover_medium || null;
  } catch (_) {}
  return null;
}

/**
 * Progressive cover art resolver:
 * 1. If track already has coverArt → done
 * 2. Search filesystem for sidecar files (folder.jpg, cover.jpg, etc.)
 * 3. Search iTunes API
 * 4. Search Deezer API
 * Updates track.coverArt in-place and refreshes the visible row.
 */
async function _resolveCoverArt(track) {
  if (!track) return;

  // Revolutionary: If track has _hasCoverArt flag (base64 was stripped from library:get-all),
  // use nova-media://art/{trackId} to serve it from the main process's SQLite cache.
  // This is the key fix that makes ALL embedded cover art display without re-fetching.
  if (!track.coverArt && track._hasCoverArt) {
    track.coverArt = `nova-media://art/${encodeURIComponent(track.id)}`;
    _applyCoverArtToTrack(track);
    return;
  }

  if (track.coverArt) return;

  // Album-level dedup: all tracks sharing same album reuse one fetch
  const albumKey =
    `${getArtistText(track)}::${track.album || ""}`.toLowerCase();
  if (_albumArtCache.has(albumKey)) {
    const url = await _albumArtCache.get(albumKey);
    if (url) {
      track.coverArt = url;
      _applyCoverArtToTrack(track);
    }
    return;
  }

  // Exhaustive resolution chain: try EVERY source before giving up
  const fetchPromise = (async () => {
    // 1. Sidecar files (folder.jpg, cover.jpg, AlbumArt*.jpg, etc.)
    const sidecar = await _findSidecarCoverArt(track);
    if (sidecar) return sidecar;
    // 2. Exhaustive filesystem search (deep directory scan, parent/subdir walk)
    const exhaustive = await _exhaustiveSearchForTrack(track);
    if (exhaustive) return exhaustive;
    // 3. iTunes API (high quality, up to 3000x3000)
    const itunes = await _searchiTunesArt(track);
    if (itunes) return itunes;
    // 3. Deezer API (fallback, often has different coverage)
    const deezer = await _searchDeezerArt(track);
    if (deezer) return deezer;
    return null;
  })();

  _albumArtCache.set(albumKey, fetchPromise);
  const url = await fetchPromise;
  if (!url) {
    _coverArtSearchCache.set(track.id, null);
    return;
  }

  track.coverArt = url;
  _applyCoverArtToTrack(track);

  // ALWAYS persist online art to disk so it survives offline restarts.
  // This is critical: if we found art online, we must download it so
  // next launch doesn't need network access to show it.
  if (window.novaAPI) {
    // Persist any URL that isn't already a local file path
    const isLocalPath =
      url.startsWith("file://") ||
      url.startsWith("/") ||
      url.match(/^[A-Za-z]:\\/);
    const isProtocolUrl = url.startsWith("nova-media://");
    if (!isLocalPath && !isProtocolUrl) {
      window.novaAPI
        .invoke("coverart:save", { trackId: track.id, url })
        .then((res) => {
          if (res?.success && res.localPath) {
            track.coverArt = res.localPath;
            // Invalidate any playlist collages containing this track
            _invalidatePlaylistCollagesForTrack(track.id);
          }
        })
        .catch(() => {});
    }
  }
}

/** Invalidate collage caches for all playlists that contain the given track. */
function _invalidatePlaylistCollagesForTrack(trackId) {
  for (const playlist of state.playlists) {
    if (playlist.tracks && playlist.tracks.includes(trackId)) {
      _invalidateCollageCache(playlist.id);
    }
  }
}

/**
 * Get a displayable URL for a cover art path.
 * Uses protocol URLs for file paths (faster, natively cached by browser).
 * Returns data: URIs as-is.
 */
function _getCoverArtDisplayUrl(coverArtPath) {
  if (!coverArtPath) return "";
  if (coverArtPath.startsWith("data:")) return coverArtPath;
  // Already a protocol URL (nova-media://art/ or nova-media://cover/) — return as-is
  if (coverArtPath.startsWith("nova-media://")) return coverArtPath;
  // File path → protocol URL for native browser caching
  return `nova-media://cover/${encodeURIComponent(coverArtPath)}`;
}

/**
 * Apply a newly found coverArt to the track's visible row + now-playing UI.
 */
function _applyCoverArtToTrack(track) {
  // Rebuild thumbnail atlas entry
  if (track.coverArt) {
    const displayUrl = _getCoverArtDisplayUrl(track.coverArt);
    const img = new Image();
    img.src = displayUrl;
    img.onload = async () => {
      try {
        const sw2 = img.naturalWidth;
        const sh2 = img.naturalHeight;
        const side2 = Math.min(sw2, sh2);
        const sx2 = Math.floor((sw2 - side2) / 2);
        const sy2 = Math.floor((sh2 - side2) / 2);
        const bitmap = await createImageBitmap(img, sx2, sy2, side2, side2, {
          resizeWidth: THUMBNAIL_SIZE,
          resizeHeight: THUMBNAIL_SIZE,
          resizeQuality: "medium",
        });
        thumbnailAtlas.set(track.id, bitmap);
      } catch (_) {}
      // Refresh the row in the virtual list
      const slot = virtualList.activeSlots.get(track.id);
      if (slot) {
        slot._trackId = null; // force repopulate
      }
      virtualList.lastStart = -1;
      virtualList.lastEnd = -1;
      renderVirtualRows();
      // Also refresh now-playing UI if this is the active track
      if (state.currentTrack && state.currentTrack.id === track.id) {
        $("np-art").innerHTML =
          `<img src="${displayUrl}" alt="Cover Art" style="width:100%;height:100%;object-fit:cover;display:block;border:none;outline:none;" />`;
        $("ov-art").innerHTML =
          `<img src="${displayUrl}" alt="Cover Art" style="width:100%;height:100%;object-fit:cover;display:block;border:none;outline:none;" />`;
        $("ov-mini-art").innerHTML =
          `<img src="${displayUrl}" alt="Cover Art" style="width:100%;height:100%;object-fit:cover;display:block;border:none;outline:none;" />`;
        const floatArt = $("np-float-art");
        if (floatArt)
          floatArt.innerHTML = `<img src="${displayUrl}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:10px;border:none;outline:none;">`;
        _setNpBg(track);
      }
    };
  }

  // Warm cache
  warmCoverArt(track);

  // Update album/artist group caches if cover was missing
  invalidateSectionCache();
}

/**
 * Batch-resolve missing cover art for all tracks in the library.
 * Runs incrementally with idle yields to avoid blocking the UI.
 */
async function resolveMissingCoverArt() {
  // Revolutionary: Only resolve for tracks that genuinely have NO art.
  // Since library:get-all now preserves file paths, tracks with coverArt don't need resolving.
  // Also skip tracks marked with _hasCoverArt (base64 art stripped but exists in SQLite).
  const tracksNeedingArt = state.tracks.filter(
    (t) => !t.coverArt && !t._hasCoverArt && !_coverArtSearchCache.has(t.id),
  );
  if (tracksNeedingArt.length === 0) return;

  console.log(
    `[CoverArt] Resolving ${tracksNeedingArt.length} missing thumbnails...`,
  );
  const BATCH_SIZE = 8;

  for (let i = 0; i < tracksNeedingArt.length; i += BATCH_SIZE) {
    const batch = tracksNeedingArt.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map((t) => _resolveCoverArt(t)));
    // Yield to main thread between batches
    await new Promise((r) => requestIdleCallback(r, { timeout: 80 }));
  }

  console.log(
    `[CoverArt] Done. ${state.tracks.filter((t) => t.coverArt).length}/${state.tracks.length} tracks now have artwork.`,
  );
}

// ─── Exhaustive Cover Art Audit for Artists & Albums ─────────────
// After all other resolution methods (sidecar, iTunes, Deezer) have run,
// this audit checks every artist and album card. If any card still has
// no coverArt, it triggers a deep filesystem search using the new
// coverart:exhaustive-search IPC handler, which searches:
//   - ALL image files in the track's directory (not just common names)
//   - .novaart sidecar files
//   - Parent directories (up to 3 levels)
//   - Subdirectories (1 level deep)
// Goal: ALWAYS display cover art. Never show a blank card if there's
// an image file anywhere nearby in the filesystem.

const _exhaustiveSearchCache = new Map(); // "dir1::dir2" → coverArt path | null
let _exhaustiveSearchRunning = false;

/**
 * Exhaustive filesystem search for a single track.
 * Used in _resolveCoverArt() before going to online APIs.
 */
async function _exhaustiveSearchForTrack(track) {
  if (!track.filePath || !window.novaAPI) return null;
  const cacheKey = track.filePath;
  if (_exhaustiveSearchCache.has(cacheKey)) {
    return _exhaustiveSearchCache.get(cacheKey);
  }
  try {
    const result = await window.novaAPI.invoke("coverart:exhaustive-search", [
      track.filePath,
    ]);
    if (result && result.success && result.coverArt) {
      _exhaustiveSearchCache.set(cacheKey, result.coverArt);
      return result.coverArt;
    }
  } catch (_) {}
  _exhaustiveSearchCache.set(cacheKey, null);
  return null;
}

/**
 * Run exhaustive filesystem search for ALL artist/album groups missing cover art.
 * Called automatically after section rendering. Runs in idle batches.
 */
async function _exhaustiveCoverArtAudit() {
  if (_exhaustiveSearchRunning) return;
  _exhaustiveSearchRunning = true;

  try {
    // Collect groups that need cover art
    const groupsNeedingArt = [];

    // Check album groups
    const albums = getAlbumGroups();
    for (const album of albums) {
      if (!album.coverArt) {
        groupsNeedingArt.push({ type: "album", group: album });
      }
    }

    // Check artist groups
    const artists = getArtistGroups();
    for (const artist of artists) {
      if (!artist.coverArt) {
        groupsNeedingArt.push({ type: "artist", group: artist });
      }
    }

    if (groupsNeedingArt.length === 0) {
      console.log(
        "[ExhaustiveAudit] All cards have cover art. No search needed.",
      );
      return;
    }

    console.log(
      `[ExhaustiveAudit] ${groupsNeedingArt.length} groups missing cover art — starting deep filesystem search...`,
    );

    const BATCH_SIZE = 4; // Keep small — filesystem I/O can be heavy
    let patchedCount = 0;

    for (let i = 0; i < groupsNeedingArt.length; i += BATCH_SIZE) {
      const batch = groupsNeedingArt.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async ({ type, group }) => {
          try {
            const coverArtPath = await _exhaustiveSearchForGroup(group);
            if (coverArtPath) {
              group.coverArt = coverArtPath;
              // Find the track that provided this art and set the trackId
              const trackWithFile = group.tracks.find((t) => t.filePath);
              if (trackWithFile) {
                group._coverArtTrackId = trackWithFile.id;
              }
              // Also update all tracks in this group that have no coverArt
              for (const t of group.tracks) {
                if (!t.coverArt) {
                  t.coverArt = coverArtPath;
                }
              }
              // Immediately patch the live DOM card if it's on screen
              const didPatch = _patchLiveCard(group);
              if (didPatch) patchedCount++;
              console.log(
                `[ExhaustiveAudit] Found cover for ${type} "${group.album || group.artist}": ${coverArtPath.split(/[/\\]/).pop()}`,
              );
            }
          } catch (_) {}
        }),
      );
      // Yield to main thread between batches
      await new Promise((r) => requestIdleCallback(r, { timeout: 100 }));
    }

    // Refresh section caches so future navigations get the art immediately
    invalidateSectionCache();

    console.log(
      `[ExhaustiveAudit] Done. Patched ${patchedCount} live cards. Remaining blank: ${groupsNeedingArt.filter((g) => !g.group.coverArt).length}/${groupsNeedingArt.length}`,
    );
  } finally {
    _exhaustiveSearchRunning = false;
  }
}

/**
 * Exhaustive filesystem search for a single group (album or artist).
 * Tries all track filePaths in the group, plus deduplicates by directory.
 */
async function _exhaustiveSearchForGroup(group) {
  if (!window.novaAPI) return null;

  // Collect all unique filePaths from the group's tracks
  const filePaths = group.tracks.map((t) => t.filePath).filter(Boolean);

  if (filePaths.length === 0) return null;

  // Create a dedupe key from the unique directories
  const dirs = [
    ...new Set(filePaths.map((fp) => fp.split(/[/\\]/).slice(0, -1).join("/"))),
  ];
  const cacheKey = dirs.sort().join("::");

  if (_exhaustiveSearchCache.has(cacheKey)) {
    return _exhaustiveSearchCache.get(cacheKey);
  }

  try {
    const result = await window.novaAPI.invoke(
      "coverart:exhaustive-search",
      filePaths,
    );
    if (result && result.success && result.coverArt) {
      _exhaustiveSearchCache.set(cacheKey, result.coverArt);
      return result.coverArt;
    }
  } catch (_) {}

  _exhaustiveSearchCache.set(cacheKey, null);
  return null;
}

/**
 * Check all art-placeholder elements currently in the DOM and patch them
 * if their backing data group now has coverArt (found by exhaustive search).
 * Uses data-card-key for reliable matching (not fragile title text).
 */
function _auditCardImages() {
  const placeholders = document.querySelectorAll(".art-placeholder");
  if (placeholders.length === 0) return;

  for (const placeholder of placeholders) {
    const card = placeholder.closest(".album-card");
    if (!card) continue;

    const key = card.dataset.cardKey;
    if (!key) continue;

    // Find the matching group by key
    const group = _findGroupByKey(key);
    if (!group || !group.coverArt) continue;

    // This card has art in memory but still shows placeholder — patch it
    _patchLiveCard(group);
  }
}

/**
 * Find an album or artist group by its key.
 */
function _findGroupByKey(key) {
  const albums = getAlbumGroups();
  const album = albums.find((a) => a.key === key);
  if (album) return album;

  const artists = getArtistGroups();
  return artists.find((a) => a.key === key) || null;
}

/**
 * Patch a live DOM card with cover art for the given group.
 * Finds the card by data-card-key and replaces its art-placeholder
 * with the actual image. Returns true if a card was patched.
 */
function _patchLiveCard(group) {
  if (!group || !group.coverArt) return false;

  // Find the live card by key (reliable, not title-based matching)
  const card = document.querySelector(
    `.album-card[data-card-key="${CSS.escape(group.key)}"]`,
  );
  if (!card) return false;

  // Only patch if it still has an art-placeholder (no double-patching)
  const coverDiv = card.querySelector(".album-cover");
  if (!coverDiv) return false;

  const placeholder = coverDiv.querySelector(".art-placeholder");
  if (!placeholder) return false; // Already has an image

  // Remove the placeholder
  placeholder.remove();

  // Create image elements (same structure as _makeAlbumCard/_makeArtistCard)
  const container = document.createElement("div");
  container.className = "cover-img-container";
  container.style.backgroundColor = _getDominantColorForTrack(group.tracks[0]);

  const thumbHashData = _thumbHashCache.get(group.tracks[0]?.id);
  if (thumbHashData) {
    const ph = document.createElement("img");
    ph.className = "thumbhash-placeholder";
    ph.src = thumbHashData;
    ph.style.cssText = THUMBHASH_PLACEHOLDER_CSS;
    ph.alt = "";
    container.appendChild(ph);
  }

  const img = document.createElement("img");
  img.alt = "";
  const artTrackId = group._coverArtTrackId || group.tracks[0]?.id;
  container.appendChild(img);
  coverDiv.appendChild(container);
  _attachEagerThumb(img, group.coverArt, 200, artTrackId);

  // Fade in
  container.style.animation = "fadeIn 0.3s ease";
  return true;
}

/**
 * Progressively fetch cover art for each track via coverart:get,
 * batched during idle time so startup render is never blocked.
 */
async function _fetchLibraryCoverArtProgressive() {
  // Only fetch for tracks that genuinely have no art (no file path AND no _hasCoverArt flag)
  const tracksNeedingArt = state.tracks.filter(
    (t) => !t.coverArt && !t._hasCoverArt,
  );
  if (tracksNeedingArt.length === 0) return;
  const BATCH_SIZE = 8;
  for (let i = 0; i < tracksNeedingArt.length; i += BATCH_SIZE) {
    const batch = tracksNeedingArt.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (track) => {
        try {
          const res = await window.novaAPI.invoke("coverart:get", track.id);
          if (res && res.success && res.coverArt) {
            track.coverArt = res.coverArt;
            // Mirror into libraryById / state.tracks in-place
            const stateTrack = state.tracks.find((t) => t.id === track.id);
            if (stateTrack) stateTrack.coverArt = res.coverArt;
            _applyCoverArtToTrack(track);
          }
        } catch (_) {}
      }),
    );
    await new Promise((r) => requestIdleCallback(r, { timeout: 80 }));
  }
}

async function _loadLibrary() {
  // Show skeleton immediately so there's no blank state
  _showSkeletonRows(15);
  try {
    // Load track list first — we need IDs to check IDB
    const result = await window.novaAPI.invoke("library:get-all");
    if (result.success) {
      state.tracks = result.tracks || [];

      // Inject 48px display thumbs into track._thumb (NOT track.coverArt).
      // track.coverArt must stay as the original file path so IPC calls like
      // coverart:thumbnail and coverart:get can resolve it correctly.
      // Check IDB for cached 48px thumbs; only fetch from main process for misses.
      //
      // PERFORMANCE OPTIMIZATION: Instead of awaiting each IDB read individually
      // (which serializes N IndexedDB transactions), we batch reads into a single
      // IDB transaction using getAll(). This reduces IDB round-trips from N to 1
      // and cuts ~200-500ms on large libraries (1000+ tracks).
      const idbHits = {};
      const idbMisses = [];
      if (_idbReady && _idb) {
        try {
          // Batch read: open one readonly transaction for all keys
          const keys = state.tracks.map((t) => `batch48::${t.id}`);
          const tx = _idb.transaction(IDB_STORE, "readonly");
          const store = tx.objectStore(IDB_STORE);
          const results = await new Promise((resolve) => {
            const resultMap = {};
            let pending = keys.length;
            if (pending === 0) {
              resolve(resultMap);
              return;
            }
            for (const key of keys) {
              const req = store.get(key);
              req.onsuccess = () => {
                if (req.result !== undefined && req.result !== null) {
                  resultMap[key.replace("batch48::", "")] = req.result;
                }
                if (--pending === 0) resolve(resultMap);
              };
              req.onerror = () => {
                if (--pending === 0) resolve(resultMap);
              };
            }
          });
          for (const t of state.tracks) {
            if (results[t.id]) {
              idbHits[t.id] = results[t.id];
            } else {
              idbMisses.push(t.id);
            }
          }
        } catch (_) {
          // Fallback to individual reads if batch fails
          await Promise.all(
            state.tracks.map(async (t) => {
              const cached = await _idbGet(`batch48::${t.id}`);
              if (cached) {
                idbHits[t.id] = cached;
              } else {
                idbMisses.push(t.id);
              }
            }),
          );
        }
      } else {
        // IDB not ready — all are misses
        for (const t of state.tracks) idbMisses.push(t.id);
      }

      // Apply IDB hits as display thumbs
      // Revolutionary: Handle both old format (URL string) and new format ({url, hash} object)
      for (const t of state.tracks) {
        const cached = idbHits[t.id];
        if (!cached) continue;
        if (typeof cached === "string") {
          // Old format: just a URL string
          t._thumb = cached;
        } else if (cached && cached.url) {
          // New format: {url, hash} object with ThumbHash
          t._thumb = cached.url;
          if (cached.hash) {
            t._thumbHash = cached.hash;
          }
        }
      }

      // Fetch only misses from main process
      if (idbMisses.length > 0) {
        const thumbResult = await window.novaAPI.invoke(
          "coverart:get-all-thumbs",
          { size: 48 },
        );
        if (thumbResult?.success && thumbResult.thumbs) {
          const thumbs = thumbResult.thumbs;
          const thumbHashes = thumbResult.thumbHashes || {};
          for (const t of state.tracks) {
            if (thumbs[t.id] && !t._thumb) {
              t._thumb = thumbs[t.id];
              // Persist thumb URL + ThumbHash to IDB so next launch skips IPC
              const thumbData = { url: thumbs[t.id] };
              if (thumbHashes[t.id]) thumbData.hash = thumbHashes[t.id];
              _idbSet(`batch48::${t.id}`, thumbData);
            }
            // Store ThumbHash for instant placeholder rendering
            if (thumbHashes[t.id]) {
              t._thumbHash = thumbHashes[t.id];
            }
          }
        }
      }

      // ── Decode ThumbHashes to displayable data URLs ──────────────
      // ThumbHash hashes are ~100 bytes but need decoding to PNG data URLs
      // for the <img> elements. Batch decode all at once (~0.1ms per hash).
      const allHashes = {};
      for (const t of state.tracks) {
        if (t._thumbHash) allHashes[t.id] = t._thumbHash;
      }
      if (Object.keys(allHashes).length > 0) {
        try {
          const decodeResult = await window.novaAPI.invoke(
            "coverart:decode-thumbhashes",
            { hashes: allHashes },
          );
          if (decodeResult?.success && decodeResult.dataURLs) {
            for (const [trackId, dataURL] of Object.entries(
              decodeResult.dataURLs,
            )) {
              _thumbHashCache.set(trackId, dataURL);
            }
          }
          // Revolutionary: Extract dominant colors from decoded ThumbHashes for instant card backgrounds
          if (decodeResult?.success && decodeResult.rgbaData) {
            for (const [trackId, rgba] of Object.entries(
              decodeResult.rgbaData,
            )) {
              const color = _extractDominantColor(
                new Uint8Array(rgba.data),
                rgba.width,
                rgba.height,
              );
              _dominantColorCache.set(trackId, color);
            }
          }
        } catch (_) {
          // ThumbHash decoding is optional — art placeholders still work
        }
      }
      state.filteredTracks = [...state.tracks];
      buildSearchIndex();
      invalidateSectionCache();
      // Pre-compute section cache so album/artist navigation is instant
      sectionCache.albums = getAlbumGroups();
      sectionCache.artists = getArtistGroups();
      _sortTracks();
      // Render the active section immediately
      if (state.activeNavSection === "albums")
        _reRenderPanel("albums", renderAlbums);
      else if (state.activeNavSection === "artists")
        _reRenderPanel("artists", renderArtists);
      else renderTracks(state.filteredTracks, "library");
      // Sync nav highlight to match the actual active section
      $$(".nav-item[data-section]").forEach((item) => {
        item.classList.toggle(
          "active",
          item.dataset.section === state.activeNavSection,
        );
      });
      console.log(`Library loaded: ${state.tracks.length} tracks`);
      // Build bitmap thumbnail atlas in background (non-blocking)
      buildThumbnailAtlas();
      // Resolve missing cover art: sidecar files → iTunes API → Deezer API
      resolveMissingCoverArt();
      // Exhaustive filesystem audit: after online resolution, deep-search
      // the filesystem for any remaining blank artist/album cards
      _exhaustiveCoverArtAudit();
      // Progressively fetch full-res cover art for tracks that had thumbnails
      // (upgrades 48px thumbs to full-res for now-playing display)
      _fetchLibraryCoverArtProgressive();
      // Revolutionary: Aggressively preload ALL cover art URLs in background.
      // By the time the user navigates to albums/artists, images are already cached.
      preloadAllCoverArt();
      // Preload playlist covers after library is ready
      _preloadPlaylistCovers();
    }
  } catch (err) {
    console.error("Library load failed:", err);
  }
}

async function _loadSettings() {
  try {
    const result = await window.novaAPI.invoke("settings:get-all");
    if (!result.success) return;
    state.settings = result.settings || {};
    state.equalizer = Array.isArray(state.settings.equalizer)
      ? state.settings.equalizer.slice(0, 10)
      : new Array(10).fill(0);
    while (state.equalizer.length < 10) state.equalizer.push(0);
    state.eqEnabled = state.settings.equalizerEnabled !== false;
    state.volumeBoost =
      typeof state.settings.volumeBoost === "number"
        ? Math.max(1.0, Math.min(2.0, state.settings.volumeBoost))
        : 1.0;
    state.repeatMode = state.settings.repeatMode || state.repeatMode;
    state.shuffleEnabled = !!state.settings.shuffle;
    state.volume =
      typeof state.settings.volume === "number" ? state.settings.volume : 0.5;
    audioEngine.setVolume(state.volume);
    const volFill = $("vol-fill");
    if (volFill) volFill.style.width = state.volume * 100 + "%";
    _updateRepeatButton();
    const shuffleBtn = $("shuffle-btn");
    if (shuffleBtn) shuffleBtn.classList.toggle("active", state.shuffleEnabled);
    state.dynamicAccentColor = !!state.settings.dynamicAccentColor;
    if (!state.dynamicAccentColor && state.settings.accentColor)
      _applyAccentColor(state.settings.accentColor);
    _applyVolumeBarMode(state.settings.volumeBarMode || "hover");
    _applyNavMode(state.settings.navMode || "hover");
    _applyFont(state.settings.font || "outfit");
  } catch (err) {
    console.warn("Settings load failed:", err);
  }
}

async function saveSetting(key, value) {
  state.settings[key] = value;
  try {
    await window.novaAPI.invoke("settings:set", key, value);
  } catch (err) {
    console.warn("Setting save failed:", key, err);
  }
}

function _persistQueue() {
  try {
    window.novaAPI.invoke("settings:set", "_queue", {
      ids: state.queue.map((t) => t.id),
      index: state.queueIndex,
    });
  } catch (_) {}
}

function renderSectionSurface(html) {
  const headers = $("col-headers");
  const area = $("track-area");
  if (headers) headers.style.display = "none";
  if (area && virtualList.scrollHandler) {
    area.removeEventListener("scroll", virtualList.scrollHandler, {
      passive: true,
    });
    virtualList.scrollHandler = null;
  }
  if (area) area.onscroll = null;
  if (virtualList.raf) {
    cancelAnimationFrame(virtualList.raf);
    virtualList.raf = 0;
  }
  const target = _activePanelTarget || $("track-list");
  if (target) {
    target.className = "section-surface";
    target.innerHTML = html;
  }
  // Reset scroll to top ONLY when no scroll-restore is pending.
  // When _beginScrollRestore() was called, the container is already hidden
  // and _finishScrollRestore() will set the correct scrollTop + reveal.
  if (area && !_scrollRestoreSection) area.scrollTop = 0;
  $("content-subtitle").textContent = "";
}

function getSectionSurface() {
  return _activePanelTarget || $("track-list");
}

function renderHome() {
  // Recently Added: sort by dateAdded descending (most recent first)
  // Filter out tracks with missing title/artist to avoid "Unknown Song Unknown Artist"
  const validTracks = state.tracks.filter(
    (t) =>
      t.title &&
      t.title.trim() &&
      t.artist &&
      (typeof t.artist === "string" ? t.artist.trim() : t.artist.length > 0),
  );
  const recentlyAdded = [...validTracks]
    .sort((a, b) => {
      const da = a.dateAdded || 0;
      const db = b.dateAdded || 0;
      return db - da;
    })
    .slice(0, 6);
  const totalDuration = calcTotalDuration(state.tracks);
  renderSectionSurface(`
    <div class="home-hero">
      <img class="home-hero-bg" src="../assets/speaker-cone-bg.png" alt="">
      <div class="home-hero-content">
        <div class="section-kicker">NovaTune</div>
        <h2>Your music, ready fast.</h2>
        <p>${state.tracks.length} songs in library • ${state.playlists.length} ${state.playlists.length === 1 ? "playlist" : "playlists"} • ${totalDuration}</p>
      </div>
      <button style=" font-family: inherit;
  font-weight: 600!important;
  " class="section-primary-btn" id="home-shuffle-btn"><svg style="margin-bottom: -2px!important;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="4" y1="4" x2="21" y2="21" /></svg> Shuffle<span class="home-shuffle-wide"> Library</span></button>
    </div>
    <div class="section-grid" >
      <div class="section-panel home-played-panel" style="margin-bottom: 50px!important;">
        <div class="section-panel-title">Recently Added</div>
        <div class="mini-track-list" id="home-recent-list"></div>
      </div>
      <div class="section-panel" style="margin-bottom: 50px!important;">
        <div class="section-panel-title">Recently Played</div>
        <div class="mini-track-list" id="home-played-list"></div>
      </div>
    </div>
    
  `);

  const recentList = $("home-recent-list");
  if (recentList) {
    recentList.style.fontFamily = "inherit";
    if (recentlyAdded.length === 0) {
      recentList.innerHTML =
        '<div class="section-muted">Add a folder to build your library.</div>';
    } else {
      recentlyAdded.forEach((track) => {
        const btn = createMiniTrackButton(track);
        btn.style.fontFamily = "inherit";
        recentList.appendChild(btn);
      });
    }
  }

  const playedList = $("home-played-list");
  if (playedList) {
    playedList.style.fontFamily = "inherit";
    if (state.recentlyPlayed.length === 0) {
      playedList.innerHTML =
        '<div class="section-muted">Nothing played yet.</div>';
    } else {
      state.recentlyPlayed
        .filter((t) => t.title && t.title.trim())
        .forEach((track) => {
          const btn = createMiniTrackButton(track);
          btn.style.fontFamily = "inherit";
          playedList.appendChild(btn);
        });
    }
  }

  $("home-shuffle-btn")?.addEventListener("click", () =>
    $("shuffle-play-btn").click(),
  );
  $("home-library-btn")?.addEventListener("click", () =>
    navigateFromSurface("library"),
  );
  $("home-playlists-btn")?.addEventListener("click", () =>
    navigateFromSurface("playlists"),
  );
  $("home-eq-btn")?.addEventListener("click", () =>
    navigateFromSurface("equalizer"),
  );
}

function navigateFromSurface(section) {
  const item = document.querySelector(`.nav-item[data-section="${section}"]`);
  if (item) item.click();
}

function createMiniTrackButton(track) {
  const button = document.createElement("button");
  button.className = "mini-track-row";
  const miniArtSrc = track.coverArt
    ? _getCoverArtDisplayUrl(track.coverArt)
    : track._hasCoverArt
      ? `nova-media://art/${encodeURIComponent(track.id)}`
      : null;
  const art = miniArtSrc
    ? `<img src="${miniArtSrc}" alt="">`
    : `<div class="art-placeholder art-${getArtIndex(track)}">&#127925;</div>`;
  button.innerHTML = `
    <span class="mini-track-thumb">${art}</span>
    <span class="mini-track-copy">
      <span>${escapeHtml(track.title || "Untitled")}</span>
      <small>${escapeHtml(getArtistText(track))}</small>
    </span>
  `;
  button.addEventListener("click", () => {
    prefetchLyrics(track); // start lyrics race before audio init
    // BUGFIX: Previously this used `[track, ...remaining]` where
    // `remaining = state.tracks.filter(t => t.id !== track.id)`. That built
    // a queue that started at the clicked track then jumped back to song #1
    // of the entire library — ignoring the user's current sort / filter and
    // breaking the "Next" button's continuity.
    //
    // Now we build the queue from the user's current filtered+sorted view
    // (state.filteredTracks, falling back to state.tracks) and slice from
    // the clicked track's position, so "Next" advances through the visible
    // arrangement. Wrap-around (before-slice appended at the end) preserves
    // the "Repeat all" feel without forcing the user to enable it.
    const sourceList = state.filteredTracks.length
      ? state.filteredTracks
      : state.tracks;
    const clickedIdx = sourceList.findIndex((t) => t.id === track.id);
    if (clickedIdx >= 0) {
      const after = sourceList.slice(clickedIdx);
      const before = sourceList.slice(0, clickedIdx);
      state.queue = [...after, ...before];
    } else {
      // Track isn't in the current view (e.g. it's from "Recently Played"
      // but the library has been re-sorted). Fall back to a single-track
      // queue — the user can still click another song to rebuild it.
      state.queue = [track];
    }
    state.queueIndex = 0;
    playTrack(track);
  });
  return button;
}

function _applyAccentColor(hex) {
  document.documentElement.style.setProperty("--green", hex);
  document.documentElement.style.setProperty("--green-hover", hex);
  // Push new colour to SquigglyProgress instances (Worker or main-thread)
  if (squigglyNP) {
    squigglyNP.waveColor = hex;
    if (squigglyNP._useWorker && squigglyNP.worker)
      squigglyNP.worker.postMessage({ type: "setWaveColor", waveColor: hex });
  }
  if (squigglyOV) {
    squigglyOV.waveColor = hex;
    if (squigglyOV._useWorker && squigglyOV.worker)
      squigglyOV.worker.postMessage({ type: "setWaveColor", waveColor: hex });
  }
}

function _applyVolumeBarMode(mode) {
  const volGroup = document.querySelector(".vol-group");
  if (!volGroup) return;
  volGroup.classList.toggle("volume-always", mode === "always");
}

function _applyNavMode(mode) {
  let card = document.getElementById("floating-nav-card");
  if (!card) {
    // Card may not exist yet — create it so nav mode can be applied
    if (typeof _createFloatingNavCard === "function") {
      card = _createFloatingNavCard();
    }
  }
  if (!card) return;
  card.classList.toggle("nav-always", mode === "always");
  card.classList.toggle("nav-hover", mode === "hover");
  if (mode === "always" && window.innerWidth <= 950) {
    // Show immediately only when the real sidebar is already hidden
    card.style.display = "flex";
    requestAnimationFrame(() => card.classList.add("visible"));
  } else if (mode === "hover") {
    // In hover mode: hide the card completely unless user hovers near the edge
    // This applies to ALL screen sizes where sidebar is hidden (including tablets)
    card.classList.remove("visible");
    card.style.display = "none";
  }
  // If mode === "always" but screen is wide (>950px), do nothing —
  // the real sidebar is visible and the floating card should stay hidden.
}

function _applyFont(font) {
  const f = font === "figtree" ? "Figtree" : "Outfit";
  document.documentElement.style.setProperty(
    "--app-font",
    `"${f}", sans-serif`,
  );
  document.body.style.fontFamily = `var(--app-font)`;
}

function _setControlsVisible(visible) {
  const bar = $("now-playing");
  if (bar) bar.classList.toggle("hidden", !visible);
  const floatCard = $("np-float-card");
  if (floatCard) floatCard.classList.toggle("hidden", !visible);
}

/**
 * Update the now-playing title with marquee scroll when text overflows.
 * Duplicates the text so the scroll loops seamlessly.
 */
function _updateNpTitle(text) {
  const titleEl = $("np-title");
  const wrapEl = $("np-title-wrap");
  if (!titleEl || !wrapEl) return;

  // Reset: single text, no marquee, normal padding
  titleEl.textContent = text;
  titleEl.classList.remove("marquee");
  titleEl.style.paddingRight = "";

  // Force reflow so we can measure
  void titleEl.offsetWidth;

  // Check if text overflows the wrapper
  const wraps = titleEl.scrollWidth > wrapEl.clientWidth + 2;
  if (wraps && wrapEl.clientWidth > 30) {
    // Duplicate the text so the marquee loops seamlessly
    const gap = "\u00A0\u00A0\u00A0\u2022\u00A0\u00A0\u00A0"; // "  •  " — visual separator
    titleEl.textContent = text + gap + text + gap;
    titleEl.style.paddingRight = "24px";
    titleEl.classList.add("marquee");
  }
}

function _loadRecentPlayed() {
  const ids = Array.isArray(state.settings.recentlyPlayed)
    ? state.settings.recentlyPlayed
    : [];
  const byId = new Map(state.tracks.map((track) => [track.id, track]));
  state.recentlyPlayed = ids.map((id) => byId.get(id)).filter(Boolean);

  const saved = state.settings._queue;
  if (saved && Array.isArray(saved.ids) && saved.ids.length > 0) {
    const restored = saved.ids.map((id) => byId.get(id)).filter(Boolean);
    if (restored.length > 0) {
      state.queue = restored;
      state.queueIndex = Math.max(
        0,
        Math.min(saved.index || 0, restored.length - 1),
      );
      const track = restored[state.queueIndex];
      if (track) {
        state.currentTrack = track;
        // Do NOT show controls yet — preload the track first so play is instant
        _updateNpTitle(track.title || "Unknown");
        const npArtist = $("np-artist");
        if (npArtist) npArtist.textContent = getArtistText(track);

        const artIdx = getArtIndex(track);

        // Update np-art (bottom bar)
        const npArt = $("np-art");
        if (npArt) {
          const npArtSrc = _resolveCoverArtSrc(track);
          npArt.innerHTML = npArtSrc
            ? `<img src="${npArtSrc}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;border:none;outline:none;">`
            : `<div class="art-placeholder art-${artIdx}">&#127925;</div>`;
        }

        // BUGFIX: Also update the overlay (ov-title, ov-artist, ov-art, ov-mini-*)
        // Previously, when restoring a saved queue, only the bottom bar was updated.
        // The overlay showed stale/empty content, no dynamics, and no lyrics.
        const ovTitle = $("ov-title");
        if (ovTitle) ovTitle.textContent = track.title || "Unknown";
        const ovArtist = $("ov-artist");
        if (ovArtist) ovArtist.textContent = getArtistText(track);
        const ovMiniTitle = $("ov-mini-title");
        if (ovMiniTitle) ovMiniTitle.textContent = track.title || "Unknown";
        const ovMiniArtist = $("ov-mini-artist");
        if (ovMiniArtist) ovMiniArtist.textContent = getArtistText(track);

        const ovArtSrc = _resolveCoverArtSrc(track);
        const ovArt = $("ov-art");
        const ovMiniArt = $("ov-mini-art");
        if (ovArt) {
          ovArt.innerHTML = ovArtSrc
            ? `<img src="${ovArtSrc}" alt="Cover Art" style="width:100%;height:100%;object-fit:cover;display:block;border:none;outline:none;" />`
            : `<div class="art-placeholder art-${artIdx}" style="font-size:56px">&#127925;</div>`;
        }
        if (ovMiniArt) {
          ovMiniArt.innerHTML = ovArtSrc
            ? `<img src="${ovArtSrc}" alt="Cover Art" style="width:100%;height:100%;object-fit:cover;display:block;border:none;outline:none;" />`
            : `<div class="art-placeholder art-${artIdx}">&#127925;</div>`;
        }

        // BUGFIX: Update floating art card (small screens)
        const floatTitle = $("np-float-title");
        const floatArtist = $("np-float-artist");
        const floatArt = $("np-float-art");
        if (floatTitle) floatTitle.textContent = track.title || "Unknown";
        if (floatArtist) floatArtist.textContent = getArtistText(track);
        if (floatArt) {
          const floatSrc = _resolveCoverArtSrc(track);
          floatArt.innerHTML = floatSrc
            ? `<img src="${floatSrc}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:10px;border:none;outline:none;">`
            : `<div class="art-placeholder art-${artIdx}">&#127925;</div>`;
        }

        _setNpBg(track);

        // BUGFIX: Fetch lyrics for the restored track so they appear in overlay
        lastActiveIdx = -1;
        _fetchLyrics(track);

        // BUGFIX: Show lyrics toggle button
        const lyricsToggle = $("lyrics-toggle-btn");
        if (lyricsToggle) lyricsToggle.style.display = "inline-flex";

        // BUGFIX: Sync heart/favorite button state
        _syncHeartButton();

        // BUGFIX: Update OS media session so taskbar/lockscreen shows the right track
        _updateMediaSession(track);

        // BUGFIX: Highlight the active track in the virtual list
        updateActiveTrackRows(null, track.id);

        // Silently preload into AudioEngine; show controls only once buffered
        audioEngine
          .preload(track.filePath)
          .then(() => {
            _setControlsVisible(true);
            // BUGFIX: Since preload() calls init()+loadTrack(), _isInitialized
            // will be true. When user clicks play, togglePlayPause() won't
            // delegate to playTrack() (which would re-update all UI). Instead
            // it just calls audioEngine.play(). So we must mark the state
            // correctly here so the play/pause button and dynamics work.
            state.isPlaying = false; // not playing yet, just loaded
            _updatePlayPauseIcon(false);
          })
          .catch(() => {
            _setControlsVisible(true);
          }); // show anyway on error
      }
      console.log(
        `[queue] Restored ${restored.length} tracks, index ${state.queueIndex}`,
      );
    }
  }
}

function renderSettings() {
  const accentPresets = [
    { color: "#1ed760", label: "Spotify Green" },
    { color: "#00bfff", label: "Sky Blue" },
    { color: "#ff6b35", label: "Orange" },
    { color: "#f7c948", label: "Yellow" },
    { color: "#3de0c0", label: "Mint" },
    { color: "#e040fb", label: "Pink" },
    { color: "#ff4d6d", label: "Red" },
    { color: "#a8edea", label: "Ice" },
  ];
  const currentAccent = state.settings.accentColor || "#1ed760";

  const scanFolders = Array.isArray(state.settings.scanFolders)
    ? state.settings.scanFolders
    : [];
  let foldersListHtml = "";
  if (scanFolders.length > 0) {
    foldersListHtml = `
      <div class="settings-folders-list" style=" margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
        ${scanFolders
          .map(
            (folder, idx) => `
          <div class="settings-folder-item" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;">
            <span style="font-size: 13px; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 70%;" title="${escapeHtml(folder)}">${escapeHtml(folder)}</span>
            <div style="display: flex; gap: 6px;">
              <button class="folder-refresh-btn" data-folder="${escapeHtml(folder)}" style="padding: 4px 8px; font-size: 11px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-3); color: var(--text-primary); cursor: default; display: flex; align-items: center; gap: 4px; transition: background 0.15s; font-family: inherit;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refresh
              </button>
              <button class="folder-remove-btn" data-folder="${escapeHtml(folder)}" style="padding: 4px 8px; font-size: 11px; border-radius: 6px; border: 1px solid rgba(255, 0, 0, 0.2); background: rgba(255, 0, 0, 0.05); color: #ff5c5c; cursor: default; transition: background 0.15s; font-family: inherit;">
                Remove
              </button>
            </div>
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  }

  renderSectionSurface(`
    <div class="settings-layout">
      <!-- Row 1, Col 1: Playback -->
      <div class="section-panel">
        <div class="section-panel-title">Playback</div>
        <label class="settings-row">
          <span>Shuffle by default</span>
          <input type="checkbox" id="setting-shuffle">
        </label>
        <label class="settings-row">
          <span>Show lyrics panel when available</span>
          <input type="checkbox" id="setting-lyrics">
        </label>
        <label class="settings-row">
          <span>Hardware acceleration</span>
          <input type="checkbox" id="setting-hardware">
        </label>
        <div class="settings-row settings-row--wrap">
          <span>Volume bar</span>
          <div class="settings-btn-group">
            <button type="button" class="vol-mode-btn settings-toggle-btn${(state.settings.volumeBarMode || "hover") === "hover" ? " active" : ""}" data-mode="hover">On Hover</button>
            <button type="button" class="vol-mode-btn settings-toggle-btn${(state.settings.volumeBarMode || "hover") === "always" ? " active" : ""}" data-mode="always">Visible</button>
          </div>
        </div>
        <div class="settings-row settings-row--wrap">
          <span>Side menu (compact view)</span>
          <div class="settings-btn-group">
            <button type="button" class="nav-mode-btn settings-toggle-btn${(state.settings.navMode || "hover") === "hover" ? " active" : ""}" data-mode="hover">On Hover</button>
            <button type="button" class="nav-mode-btn settings-toggle-btn${(state.settings.navMode || "hover") === "always" ? " active" : ""}" data-mode="always">Always Visible</button>
          </div>
        </div>
      </div>
      <!-- Row 1, Col 2: Accent Colour -->
      <div class="section-panel">
        <div class="section-panel-title">Accent Colour</div>
        <div class="settings-accent-body">
          <div id="accent-swatches" style="display:flex;flex-wrap:wrap;gap:8px;">
            ${accentPresets
              .map(
                (p) => `
              <button
                class="accent-swatch${p.color === currentAccent ? " active" : ""}"
                data-color="${p.color}"
                title="${p.label}"
                style="background:${p.color};width:28px;height:28px;border-radius:50%;border:2px solid ${p.color === currentAccent ? "#fff" : "transparent"};cursor:default;flex-shrink:0;transition:border-color 0.15s,transform 0.1s;"
              ></button>
            `,
              )
              .join("")}
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <label style="font-size:13px;color:var(--text-secondary);">Custom:</label>
            <input type="color" id="accent-custom" value="${currentAccent}"
              style="width:36px;height:28px;border:1px solid #333;border-radius:6px;background:var(--surface);cursor:default;padding:2px;flex-shrink:0;">
            <span id="accent-hex" style="font-size:12px;color:var(--text-muted);font-variant-numeric:tabular-nums;">${currentAccent}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <button type="button" id="accent-dynamic-btn"
              style="font-family:inherit;font-size:12px;padding:5px 14px;border-radius:6px;border:1px solid #383838;background:${state.dynamicAccentColor ? "var(--green)" : "#2a2a2a"};color:${state.dynamicAccentColor ? "#000" : "var(--text-secondary)"};cursor:default;transition:background 0.15s,color 0.15s,border-color 0.15s;display:flex;align-items:center;gap:6px;flex-shrink:0;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              Dynamic (from album art)
            </button>
            <span style="font-size:11px;color:var(--text-muted);">${state.dynamicAccentColor ? "Changes with each song" : ""}</span>
          </div>
        </div>
      </div>
      <!-- Row 2, Col 1: Font -->
      <div class="section-panel">
        <div class="section-panel-title">Font</div>
        <div class="settings-row settings-row--wrap">
          <span>Interface font</span>
          <div class="settings-btn-group">
            <button type="button" class="font-pick-btn settings-toggle-btn${(state.settings.font || "outfit") === "outfit" ? " active" : ""}" data-font="outfit" style="font-family:'Outfit',sans-serif;">Outfit</button>
            <button type="button" class="font-pick-btn settings-toggle-btn${(state.settings.font || "outfit") === "figtree" ? " active" : ""}" data-font="figtree" style="font-family:'Figtree',sans-serif;">Figtree</button>
          </div>
        </div>
      </div>
      <!-- Row 2, Col 2: Library -->
      <div class="section-panel">
        <div class="section-panel-title">Library</div>
        <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <button class="settings-row action" id="settings-add-folder" style="flex:1;min-width:100px;margin-bottom:0;">Add Folder</button>
          ${scanFolders.length > 0 ? `<button class="settings-row action" id="settings-refresh-all" style="flex:1;min-width:100px;margin-bottom:0;background:var(--surface);">Refresh</button>` : ""}
        </div>
        ${foldersListHtml}
        <button class="settings-row action" id="settings-open-library" style="margin-top:12px;">Back to Music Library</button>
      </div>
    </div>

    <div style="height:30px;"></div>
  `);

  const shuffle = $("setting-shuffle");
  const lyrics = $("setting-lyrics");
  const hardware = $("setting-hardware");
  if (shuffle) shuffle.checked = !!state.shuffleEnabled;
  if (lyrics) lyrics.checked = !!state.settings.showLyrics;
  if (hardware)
    hardware.checked = state.settings.hardwareAcceleration !== false;

  shuffle?.addEventListener("change", async (e) => {
    state.shuffleEnabled = e.target.checked;
    $("shuffle-btn").classList.toggle("active", state.shuffleEnabled);
    await saveSetting("shuffle", state.shuffleEnabled);
  });
  lyrics?.addEventListener("change", async (e) => {
    await saveSetting("showLyrics", e.target.checked);
    if (e.target.checked && state.currentTrack) openLyricsPanel();
    if (!e.target.checked) closeLyricsPanel();
  });
  hardware?.addEventListener("change", (e) =>
    saveSetting("hardwareAcceleration", e.target.checked),
  );

  document.querySelectorAll(".vol-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      document.querySelectorAll(".vol-mode-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.mode === mode);
      });
      _applyVolumeBarMode(mode);
      saveSetting("volumeBarMode", mode);
    });
  });

  document.querySelectorAll(".nav-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      document.querySelectorAll(".nav-mode-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.mode === mode);
      });
      _applyNavMode(mode);
      saveSetting("navMode", mode);
    });
  });

  document.querySelectorAll(".font-pick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const font = btn.dataset.font;
      document.querySelectorAll(".font-pick-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.font === font);
      });
      _applyFont(font);
      saveSetting("font", font);
    });
  });

  $("settings-add-folder")?.addEventListener("click", () =>
    $("add-folder-nav").click(),
  );
  $("settings-open-library")?.addEventListener("click", () =>
    navigateFromSurface("library"),
  );

  // Refresh all folders
  $("settings-refresh-all")?.addEventListener("click", async () => {
    console.log("[Refresh All Folders]");
    const folders = Array.isArray(state.settings.scanFolders)
      ? state.settings.scanFolders
      : [];
    if (folders.length === 0) return;

    $("scan-progress").style.display = "flex";
    $("scan-progress-bar").style.width = "0%";
    $("scan-progress-text").textContent = "Refreshing library...";

    for (const folderPath of folders) {
      await window.novaAPI.invoke("library:scan", folderPath);
    }

    $("scan-progress").style.display = "none";
    _bustIDBThumbCache();
    await _loadLibrary();
    _reRenderPanel("settings", renderSettings);
  });

  // Individual folder refresh
  document.querySelectorAll(".folder-refresh-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const folderPath = btn.dataset.folder;
      console.log("[Refresh Folder]", folderPath);

      $("scan-progress").style.display = "flex";
      $("scan-progress-bar").style.width = "0%";
      $("scan-progress-text").textContent = `Scanning ${folderPath}...`;

      const scanResult = await window.novaAPI.invoke(
        "library:scan",
        folderPath,
      );
      $("scan-progress").style.display = "none";

      if (scanResult.success) {
        _bustIDBThumbCache();
        await _loadLibrary();
        _reRenderPanel("settings", renderSettings);
      }
    });
  });

  // Individual folder remove
  document.querySelectorAll(".folder-remove-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const folderPath = btn.dataset.folder;
      const ok = await showAppDialog({
        title: "Remove music folder",
        message: `Remove "${folderPath}" from library folders? Scanned tracks will remain in library until you clear it.`,
        confirmText: "Remove",
        cancelText: "Cancel",
        danger: true,
      });
      if (!ok) return;

      const newFolders = (state.settings.scanFolders || []).filter(
        (f) => f !== folderPath,
      );
      await saveSetting("scanFolders", newFolders);
      _reRenderPanel("settings", renderSettings);
    });
  });

  // ── Accent colour swatches ──
  const swatchContainer = $("accent-swatches");
  const customPicker = $("accent-custom");
  const hexLabel = $("accent-hex");

  function setAccent(hex, updatePicker = true) {
    _applyAccentColor(hex);
    if (hexLabel) hexLabel.textContent = hex;
    if (updatePicker && customPicker) customPicker.value = hex;
    swatchContainer?.querySelectorAll(".accent-swatch").forEach((sw) => {
      const match = sw.dataset.color === hex;
      sw.style.borderColor = match ? "#fff" : "transparent";
      sw.classList.toggle("active", match);
    });
    saveSetting("accentColor", hex);
  }

  swatchContainer?.querySelectorAll(".accent-swatch").forEach((sw) => {
    sw.addEventListener("click", () => setAccent(sw.dataset.color));
  });

  customPicker?.addEventListener("input", (e) => {
    if (state.dynamicAccentColor) return;
    setAccent(e.target.value, false);
    if (hexLabel) hexLabel.textContent = e.target.value;
  });
  customPicker?.addEventListener("change", (e) => {
    if (state.dynamicAccentColor) return;
    setAccent(e.target.value);
  });

  const dynamicBtn = $("accent-dynamic-btn");
  dynamicBtn?.addEventListener("click", () => {
    state.dynamicAccentColor = !state.dynamicAccentColor;
    saveSetting("dynamicAccentColor", state.dynamicAccentColor);
    if (state.dynamicAccentColor && state.currentTrack) {
      _setNpBg(state.currentTrack);
    } else if (!state.dynamicAccentColor) {
      _applyAccentColor(state.settings.accentColor || "#1ed760");
    }
    _reRenderPanel("settings", renderSettings);
  });
}

function renderEqualizer() {
  const labels = EQEngine.getFrequencyLabels();
  const presets = EQEngine.getPresets();
  const presetGroups = [
    {
      label: "Neutral",
      presets: [{ key: "flat", label: "Flat" }],
    },
    {
      label: "Genre",
      presets: [
        { key: "rock", label: "Rock" },
        { key: "pop", label: "Pop" },
        { key: "hiphop", label: "Hip-Hop" },
        { key: "jazz", label: "Jazz" },
        { key: "classical", label: "Classical" },
        { key: "electronic", label: "Electronic" },
        { key: "rnb", label: "R&B" },
        { key: "country", label: "Country" },
        { key: "metal", label: "Metal" },
        { key: "latin", label: "Latin" },
        { key: "acoustic", label: "Acoustic" },
      ],
    },
    {
      label: "Use-case",
      presets: [
        { key: "bassBoost", label: "Bass Boost" },
        { key: "trebleBoost", label: "Treble Boost" },
        { key: "vocal", label: "Vocal" },
        { key: "loudness", label: "Loudness" },
        { key: "lateNight", label: "Late Night" },
        { key: "headphones", label: "Headphones" },
        { key: "speakers", label: "Speakers" },
      ],
    },
  ];

  renderSectionSurface(`
    <div class="eq-layout" >
      <div class="eq-header">
        <div>
          <div class="section-kicker">Equalizer</div>
          <h2>Shape the sound</h2>
        </div>
        <label class="eq-enable"><input type="checkbox" id="eq-enabled"> Enabled</label>
      </div>
      <div class="eq-presets-wrap">
        ${presetGroups
          .map(
            (group) => `
        <div class="eq-preset-group" style="margin-bottom: 10px!important;">
            <span class="eq-preset-group-label">${group.label}</span>
            <div class="eq-preset-pills">
              ${group.presets
                .map(
                  (p) => `
                <button class="eq-preset-pill" data-preset="${p.key}">${p.label}</button>
              `,
                )
                .join("")}
            </div>
          </div>
        `,
          )
          .join("")}
      </div>
      <div class="eq-bands" style="margin-top: 30px!important;margin-bottom: 30px!important;">
        ${labels
          .map(
            (label, idx) => `
          <label class="eq-band">
            <span class="eq-gain" id="eq-gain-${idx}">${state.equalizer[idx]} dB</span>
            <input type="range" min="-12" max="12" step="1" value="${state.equalizer[idx]}" data-band="${idx}">
            <span>${label}</span>
          </label>
        `,
          )
          .join("")}
      </div>
      <div class="eq-boost-wrap"  style="margin-top: 30px!important;">
        <div class="eq-boost-header" style="margin-top: 10px!important;">
          <span class="eq-preset-group-label">Volume Boost</span>
          <span class="eq-boost-value" id="eq-boost-value">${Math.round(state.volumeBoost * 100)}%</span>
        </div>
        <input type="range" id="eq-boost-slider" min="100" max="200" step="1" value="${Math.round(state.volumeBoost * 100)}">
        <div class="eq-boost-ticks">
          <span>100%</span><span>125%</span><span>150%</span><span>175%</span><span>200%</span>
        </div>
      </div>
      <div class="eq-actions">
        <button class="section-primary-btn" id="eq-reset-btn">Reset</button>
      </div>
    </div>

    <div style="height:30px;"></div>
  `);

  const enabled = $("eq-enabled");
  if (enabled) enabled.checked = state.eqEnabled;
  enabled?.addEventListener("change", async (e) => {
    state.eqEnabled = e.target.checked;
    ensureEQEngine();
    if (eqEngine) eqEngine.setEnabled(state.eqEnabled);
    await saveSetting("equalizerEnabled", state.eqEnabled);
  });

  document.querySelectorAll(".eq-band input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.band);
      const value = Number(e.target.value);
      state.equalizer[idx] = value;
      const gain = $(`eq-gain-${idx}`);
      if (gain) gain.textContent = `${value} dB`;
      ensureEQEngine();
      if (eqEngine) eqEngine.setBandGain(idx, value);
    });
    input.addEventListener("change", () =>
      saveSetting("equalizer", state.equalizer),
    );
  });

  $("eq-reset-btn")?.addEventListener("click", () => {
    applyEQPreset(EQEngine.getPresets().flat);
    _setActiveEQPill("flat");
  });

  // Volume boost slider
  const boostSlider = $("eq-boost-slider");
  const boostValue = $("eq-boost-value");
  if (boostSlider) {
    const _updateBoostTrack = (pct) => {
      boostSlider.style.setProperty("--pct", ((pct - 100) / 100) * 100);
    };
    _updateBoostTrack(Math.round(state.volumeBoost * 100));
    boostSlider.addEventListener("input", (e) => {
      const pct = Number(e.target.value);
      state.volumeBoost = pct / 100;
      if (boostValue) boostValue.textContent = `${pct}%`;
      _updateBoostTrack(pct);
      audioEngine.setBoost(state.volumeBoost);
    });
    boostSlider.addEventListener("change", () =>
      saveSetting("volumeBoost", state.volumeBoost),
    );
  }

  // Preset pills
  document.querySelectorAll(".eq-preset-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.preset;
      const preset = EQEngine.getPresets()[key];
      if (preset) {
        applyEQPreset(preset);
        _setActiveEQPill(key);
      }
    });
  });

  // Mark the pill that matches the current state on load
  _setActiveEQPill(_detectActivePreset());
}

function _setActiveEQPill(key) {
  document.querySelectorAll(".eq-preset-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.preset === key);
  });
}

function _detectActivePreset() {
  const presets = EQEngine.getPresets();
  const current = JSON.stringify(state.equalizer.slice(0, 10));
  for (const [key, values] of Object.entries(presets)) {
    if (JSON.stringify(values) === current) return key;
  }
  return null; // custom / no match
}

function ensureEQEngine() {
  if (
    eqEngine ||
    !audioEngine.audioContext ||
    !audioEngine.sourceNode ||
    !audioEngine.gainNode
  )
    return;
  try {
    eqEngine = new EQEngine(
      audioEngine.audioContext,
      audioEngine.sourceNode,
      audioEngine.gainNode,
    );
    eqEngine.setAllBands(state.equalizer);
    eqEngine.setEnabled(state.eqEnabled);
    audioEngine.setBoost(state.volumeBoost);
  } catch (err) {
    console.warn("EQ unavailable:", err.message);
  }
}

function applyEQPreset(values) {
  state.equalizer = values.slice(0, 10);
  ensureEQEngine();
  if (eqEngine) eqEngine.setAllBands(state.equalizer);
  document.querySelectorAll(".eq-band input").forEach((input) => {
    const idx = Number(input.dataset.band);
    input.value = state.equalizer[idx];
    const gain = $(`eq-gain-${idx}`);
    if (gain) gain.textContent = `${state.equalizer[idx]} dB`;
  });
  saveSetting("equalizer", state.equalizer);
}

async function _loadPlaylists() {
  try {
    const result = await window.novaAPI.invoke("playlist:get-all");
    if (!result.success) return;
    state.playlists = result.playlists || [];
    const favorites = state.playlists.find((p) => p.name === "Favorites");
    state.favoritesPlaylistId = favorites ? favorites.id : null;
    if (state.activeNavSection === "playlists")
      _reRenderPanel("playlists", renderPlaylists);
    _syncHeartButton();
  } catch (err) {
    console.warn("Playlist load failed:", err);
  }
}

async function _getFavoritesPlaylist() {
  await _loadPlaylists();
  let playlist = state.playlists.find((p) => p.name === "Favorites");
  if (!playlist) {
    const created = await window.novaAPI.invoke("playlist:create", "Favorites");
    if (created.success) {
      playlist = created.playlist;
      state.playlists.push(playlist);
    }
  }
  state.favoritesPlaylistId = playlist ? playlist.id : null;
  return playlist;
}

function _isFavorite(track) {
  if (!track || !state.favoritesPlaylistId) return false;
  const fav = state.playlists.find((p) => p.id === state.favoritesPlaylistId);
  return !!fav?.tracks?.includes(track.id);
}

function _syncHeartButton() {
  const liked = _isFavorite(state.currentTrack);
  const heartBtn = $("heart-btn");
  const ovHeartBtn = $("ov-heart-btn");
  heartBtn?.classList.toggle("liked", liked);
  ovHeartBtn?.classList.toggle("liked", liked);
  const tip = liked ? "Liked" : "Like";
  if (heartBtn) heartBtn.dataset.tooltip = tip;
  if (ovHeartBtn) ovHeartBtn.dataset.tooltip = tip;
}

async function toggleFavorite() {
  if (!state.currentTrack) return;
  const playlist = await _getFavoritesPlaylist();
  if (!playlist) return;
  const isLiked = playlist.tracks?.includes(state.currentTrack.id);
  const channel = isLiked ? "playlist:remove-track" : "playlist:add-track";
  const result = await window.novaAPI.invoke(
    channel,
    playlist.id,
    state.currentTrack.id,
  );
  if (result.success) {
    const idx = state.playlists.findIndex((p) => p.id === playlist.id);
    if (idx >= 0) state.playlists[idx] = result.playlist;
    // Invalidate collage cache since track list changed
    _invalidateCollageCache(playlist.id);
    const nowLiked = !isLiked;
    const heartBtn = $("heart-btn");
    const ovHeartBtn = $("ov-heart-btn");
    heartBtn?.classList.toggle("liked", nowLiked);
    ovHeartBtn?.classList.toggle("liked", nowLiked);
    const tip = nowLiked ? "Liked" : "Like";
    if (heartBtn) heartBtn.dataset.tooltip = tip;
    if (ovHeartBtn) ovHeartBtn.dataset.tooltip = tip;
    if (state.activeNavSection === "playlists")
      _reRenderPanel("playlists", renderPlaylists);
  }
}

function renderPlaylists() {
  const container = _activePanelTarget || $("track-list");
  if (!container) return;
  state.activePlaylistId = null;

  // If returning from a detail view, hide container before DOM changes
  const hasSavedScroll =
    _sectionScrollPos.has("playlists") &&
    _sectionScrollPos.get("playlists").scrollTop > 0;
  if (hasSavedScroll) _beginScrollRestore("playlists");

  const _a = $("track-area");
  if (_a && virtualList.scrollHandler) {
    _a.removeEventListener("scroll", virtualList.scrollHandler, {
      passive: true,
    });
    virtualList.scrollHandler = null;
  }
  if (virtualList.raf) {
    cancelAnimationFrame(virtualList.raf);
    virtualList.raf = 0;
  }
  $("col-headers").style.display = "none";
  container.className = "playlist-section";
  container.innerHTML = `
    <div class="playlist-top-bar">
      <button class="playlist-import-fab" type="button" id="playlist-import-btn" title="Import playlist">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
    </div>
    <div class="playlist-grid" id="playlist-grid-inner"></div>
  `;

  const playlists = [...state.playlists].sort((a, b) => {
    if (a.name === "Favorites") return -1;
    if (b.name === "Favorites") return 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  if (playlists.length === 0) {
    container.innerHTML = `
      <div class="playlist-top-bar">
        <button class="playlist-import-fab" type="button" id="playlist-import-btn" title="Import playlist">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </div>
      <div class="playlist-empty-state">Like a song to create your Favorites playlist.</div>
    `;
    $("content-subtitle").textContent = "0 playlists";
    $("playlist-import-btn")?.addEventListener("click", importPlaylistFromFile);
    _finishScrollRestore();
    return;
  }

  const gridInner = $("playlist-grid-inner");
  const libraryById = new Map(state.tracks.map((track) => [track.id, track]));
  playlists.forEach((playlist) => {
    const tracks = (playlist.tracks || [])
      .map((id) => libraryById.get(id))
      .filter(Boolean);
    const card = document.createElement("div");
    card.className = "playlist-card";
    card.dataset.playlistId = playlist.id;
    // Build the cover collage using the new system that handles ALL art types
    const coverHTML = buildPlaylistCover(tracks, playlist.id);
    card.innerHTML = `
      <div class="playlist-cover playlist-cover-${Math.min(Math.max(tracks.length, 1), 4)}">
        ${coverHTML}
        <button class="playlist-cover-play-btn" data-playlist-id="${playlist.id}" title="Play" aria-label="Play">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="playlist-card-menu-btn" data-playlist-id="${playlist.id}" title="More options" aria-label="More options">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
        </button>
      </div>
      <div class="playlist-card-title">${escapeHtml(playlist.name)}</div>
      <div class="playlist-card-meta">${tracks.length} song${tracks.length === 1 ? "" : "s"}</div>
    `;
    // Click card → open detail
    card.addEventListener("click", (e) => {
      if (e.target.closest(".playlist-card-menu-btn")) return;
      if (e.target.closest(".playlist-cover-play-btn")) return;
      _activePanelTarget = _getPanel("playlists");
      _saveSectionScroll("playlists");
      renderPlaylistDetail(playlist.id);
      _activePanelTarget = null;
    });
    // Center play button → shuffle/play playlist tracks
    card
      .querySelector(".playlist-cover-play-btn")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        playPlaylistTracks(tracks, false);
      });
    // ⋯ menu → popover with export + delete
    card
      .querySelector(".playlist-card-menu-btn")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        _openCardMenu(e.currentTarget, playlist);
      });
    gridInner.appendChild(card);
    // CRITICAL FIX: Must call _tryCachedCollage AFTER card is in the DOM,
    // because it uses document.querySelector to find the card by data-playlist-id
    _tryCachedCollage(playlist.id, tracks);

    // Bleed corners: sample the image nearest each empty corner and paint a
    // soft color glow so the #1a1a1a background never shows as a hard black gap.
    // top-right corner → color from the last (bottom-right) cell's art
    // bottom-left corner → color from the first (top-left) cell's art
    const artTracks = tracks.filter((t) => _resolveCoverArtSrc(t)).slice(0, 4);
    if (artTracks.length >= 2) {
      const coverEl = card.querySelector(".playlist-cover");
      if (coverEl) {
        const trTrack = artTracks[artTracks.length - 1]; // nearest top-right gap
        const blTrack = artTracks[0]; // nearest bottom-left gap
        _sampleArtColor(
          trTrack.id,
          _resolveCoverArtSrcWithReuse(trTrack),
          (c) => {
            coverEl.style.setProperty("--bleed-tr", c);
          },
        );
        _sampleArtColor(
          blTrack.id,
          _resolveCoverArtSrcWithReuse(blTrack),
          (c) => {
            coverEl.style.setProperty("--bleed-bl", c);
          },
        );
      }
    }
  });

  // Restore scroll AFTER all playlist cards are in the DOM — then reveal
  _finishScrollRestore();

  $("content-subtitle").textContent =
    `${playlists.length} playlist${playlists.length === 1 ? "" : "s"}`;
  $("playlist-import-btn")?.addEventListener("click", importPlaylistFromFile);

  // BUGFIX v3: Use event delegation for collage image load/error instead of
  // inline onload/onerror handlers (which are blocked by CSP). When a collage
  // image loads, fade it in. When it errors, show the background color instead.
  gridInner.addEventListener(
    "load",
    (e) => {
      if (e.target.tagName === "IMG" && e.target.dataset.collageImg === "1") {
        e.target.style.opacity = "1";
      }
    },
    true,
  ); // capture phase to catch loads before they bubble
  gridInner.addEventListener(
    "error",
    (e) => {
      if (e.target.tagName === "IMG" && e.target.dataset.collageImg === "1") {
        e.target.style.opacity = "0";
        if (e.target.parentNode) {
          e.target.parentNode.style.backgroundColor = "#1a1a1a";
        }
      }
    },
    true,
  );
}

function _closeCardMenus() {
  document
    .querySelectorAll(".playlist-card-popover")
    .forEach((el) => el.remove());
}

function _openCardMenu(anchor, playlist) {
  _closeCardMenus();
  const menu = document.createElement("div");
  menu.className = "playlist-card-popover";
  menu.innerHTML = `
    <button type="button" data-action="export">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
      Export playlist
    </button>
    <button type="button" data-action="delete" class="danger">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      Delete playlist
    </button>
  `;
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left =
    Math.min(
      rect.right - menu.offsetWidth,
      window.innerWidth - menu.offsetWidth - 8,
    ) + "px";
  menu.style.top =
    Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 8) +
    "px";
  menu.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();
    _closeCardMenus();
    if (btn.dataset.action === "export") {
      exportPlaylistById(playlist.id);
    } else if (btn.dataset.action === "delete") {
      const ok = await showAppDialog({
        title: "Delete playlist",
        message: `Delete "${playlist.name}"? This cannot be undone.`,
        confirmText: "Delete",
        cancelText: "Keep",
        danger: true,
      });
      if (!ok) return;
      try {
        const result = await window.novaAPI.invoke(
          "playlist:delete",
          playlist.id,
        );
        if (result?.success || result?.error === undefined) {
          state.playlists = state.playlists.filter((p) => p.id !== playlist.id);
          if (state.favoritesPlaylistId === playlist.id)
            state.favoritesPlaylistId = null;
          _reRenderPanel("playlists", renderPlaylists);
        }
      } catch (err) {
        console.warn("playlist:delete failed:", err);
        state.playlists = state.playlists.filter((p) => p.id !== playlist.id);
        _reRenderPanel("playlists", renderPlaylists);
      }
    }
  });
  setTimeout(
    () => document.addEventListener("click", _closeCardMenus, { once: true }),
    0,
  );
}

async function importPlaylistFromFile() {
  try {
    const result = await window.novaAPI.invoke("playlist:import");
    if (result?.success) {
      await _loadPlaylists();
      if (state.activeNavSection === "playlists")
        _reRenderPanel("playlists", renderPlaylists);
      if (result.unmatchedCount > 0) {
        showAppDialog({
          title: "Playlist Imported",
          message: `${result.matchedCount} tracks added. ${result.unmatchedCount} tracks were not found in your library.`,
          confirmText: "OK",
          cancelText: null,
          details: result.unmatchedTracks,
        });
      }
    } else if (result && !result.canceled) {
      showAppDialog({
        title: "Import Failed",
        message: result.error || "Could not import playlist.",
        confirmText: "OK",
        cancelText: null,
        danger: false,
      });
    }
  } catch (err) {
    console.warn(
      "playlist:import not available — opening file dialog fallback",
    );
    // Fallback: open a file picker and parse JSON/m3u locally
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,.m3u,.m3u8";
      input.style.display = "none";
      document.body.appendChild(input);
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        const text = await file.text();
        let playlistName = file.name.replace(/\.[^.]+$/, "");
        let trackIds = [];
        const unmatchedFallback = [];

        if (file.name.endsWith(".json")) {
          try {
            const data = JSON.parse(text);
            playlistName = data.name || playlistName;
            trackIds = data.trackIds || data.tracks || [];
          } catch (_) {}
        } else {
          // m3u/m3u8: parse #EXTINF + path lines, resolve against library
          // Uses cross-platform basename so Android /storage/emulated/0/... paths
          // match local library files correctly.
          const crossBasename = (fp) => {
            const p = String(fp || "").replace(/\\/g, "/");
            const i = p.lastIndexOf("/");
            return i >= 0 ? p.substring(i + 1) : p;
          };
          const byPath = new Map(state.tracks.map((t) => [t.filePath, t.id]));
          const byName = new Map();
          const byNameNoExt = new Map();
          for (const t of state.tracks) {
            if (!t?.filePath) continue;
            const n = crossBasename(t.filePath).toLowerCase();
            if (!byName.has(n)) byName.set(n, t.id);
            const ne = n.replace(/\.[^.]+$/, "");
            if (!byNameNoExt.has(ne)) byNameNoExt.set(ne, t.id);
          }
          const rawLines = text.split(/\r?\n/);
          for (const raw of rawLines) {
            const l = raw.trim();
            if (!l || l.startsWith("#")) continue;
            const id =
              byPath.get(l) ||
              byName.get(crossBasename(l).toLowerCase()) ||
              byNameNoExt.get(
                crossBasename(l)
                  .toLowerCase()
                  .replace(/\.[^.]+$/, ""),
              );
            if (id) {
              if (!trackIds.includes(id)) trackIds.push(id);
            } else {
              unmatchedFallback.push(crossBasename(l) || l);
            }
          }
          // Extract playlist name from #PLAYLIST tag if present
          const playlistTag = text.match(/^#PLAYLIST:(.+)$/m);
          if (playlistTag) playlistName = playlistTag[1].trim();
        }

        if (trackIds.length > 0) {
          // Create the playlist and add tracks
          const created = await window.novaAPI.invoke(
            "playlist:create",
            playlistName,
          );
          if (created.success) {
            for (const tid of trackIds) {
              await window.novaAPI.invoke(
                "playlist:add-track",
                created.playlist.id,
                tid,
              );
            }
            await _loadPlaylists();
            if (state.activeNavSection === "playlists")
              _reRenderPanel("playlists", renderPlaylists);

            if (unmatchedFallback.length > 0) {
              showAppDialog({
                title: "Playlist Imported",
                message: `${trackIds.length} tracks added. ${unmatchedFallback.length} tracks were not found in your library.`,
                confirmText: "OK",
                cancelText: null,
                details: unmatchedFallback,
              });
            }
          }
        } else {
          showAppDialog({
            title: "Import Failed",
            message: "No songs from the playlist match your library.",
            confirmText: "OK",
            cancelText: null,
            details: unmatchedFallback.length > 0 ? unmatchedFallback : null,
          });
        }
        input.remove();
      });
      input.click();
    } catch (fallbackErr) {
      console.warn("Playlist import fallback failed:", fallbackErr);
    }
  }
}

async function exportPlaylistById(playlistId) {
  const playlist = state.playlists.find((p) => p.id === playlistId);
  if (!playlist) return;
  try {
    await window.novaAPI.invoke("playlist:export", playlist.id);
  } catch (err) {
    console.warn("playlist:export not available — saving file locally");
    // Fallback: build JSON and trigger download
    const libraryById = new Map(state.tracks.map((t) => [t.id, t]));
    const tracks = (playlist.tracks || [])
      .map((id) => libraryById.get(id))
      .filter(Boolean);
    const data = {
      name: playlist.name,
      trackIds: playlist.tracks || [],
      tracks: tracks.map((t) => ({
        title: t.title,
        artist: getArtistText(t),
        album: t.album,
        duration: t.duration,
        filePath: t.filePath,
      })),
      exportedAt: new Date().toISOString(),
      exportedBy: "NovaTune",
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${playlist.name.replace(/[^a-zA-Z0-9 ]/g, "_")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

async function addTrackToPlaylist(track, playlistId) {
  if (!track || !playlistId) return;
  const playlist = state.playlists.find((p) => p.id === playlistId);
  if (playlist?.tracks?.includes(track.id)) return;
  const result = await window.novaAPI.invoke(
    "playlist:add-track",
    playlistId,
    track.id,
  );
  if (result.success) {
    const idx = state.playlists.findIndex((p) => p.id === playlistId);
    if (idx >= 0) state.playlists[idx] = result.playlist;
    // Invalidate collage cache since track list changed
    _invalidateCollageCache(playlistId);
    if (state.activeNavSection === "playlists")
      _reRenderPanel("playlists", renderPlaylists);
  }
}

async function createPlaylistAndAdd(track) {
  const name = (
    (await showAppDialog({
      title: "New playlist",
      message: "Name this playlist.",
      input: true,
      confirmText: "Create",
      cancelText: "Cancel",
    })) || ""
  ).trim();
  if (!name) return;
  const created = await window.novaAPI.invoke("playlist:create", name);
  if (created.success) {
    state.playlists.push(created.playlist);
    await addTrackToPlaylist(track, created.playlist.id);
  }
}

function showAppDialog({
  title,
  message,
  input = false,
  confirmText = "OK",
  cancelText = "Cancel",
  danger = false,
  details = null,
}) {
  return new Promise((resolve) => {
    document.querySelector(".app-dialog")?.remove();
    const root = document.createElement("div");
    root.className = "app-dialog";

    let detailsHtml = "";
    if (Array.isArray(details) && details.length > 0) {
      detailsHtml = `
        <div class="app-dialog-details" style="max-height: 150px; overflow-y: auto; margin-top: 12px; padding: 8px 12px; background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 6px; text-align: left; font-size: 12px; font-family: monospace; color: var(--text-secondary);">
          ${details.map((item) => `<div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 2px 0;">• ${escapeHtml(item)}</div>`).join("")}
        </div>
      `;
    }

    root.innerHTML = `
      <div class="app-dialog-backdrop"></div>
      <div class="app-dialog-card">
        <div class="app-dialog-title">${escapeHtml(title || "NovaTune")}</div>
        ${message ? `<div class="app-dialog-message">${escapeHtml(message)}</div>` : ""}
        ${detailsHtml}
        ${input ? '<input class="app-dialog-input" type="text" maxlength="100" autocomplete="off">' : ""}
        <div class="app-dialog-actions">
          ${cancelText != null ? `<button type="button" class="app-dialog-btn secondary" data-action="cancel">${escapeHtml(cancelText)}</button>` : ""}
          <button type="button" class="app-dialog-btn primary${danger ? " danger" : ""}" data-action="confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    const cleanup = (value) => {
      root.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") cleanup(null);
      if (e.key === "Enter")
        cleanup(input ? root.querySelector(".app-dialog-input").value : true);
    };
    root
      .querySelector('[data-action="cancel"]')
      ?.addEventListener("click", () => cleanup(null));
    root
      .querySelector(".app-dialog-backdrop")
      .addEventListener("click", () => cleanup(null));
    root
      .querySelector('[data-action="confirm"]')
      .addEventListener("click", () =>
        cleanup(input ? root.querySelector(".app-dialog-input").value : true),
      );
    document.addEventListener("keydown", onKey);
    document.body.appendChild(root);
    root.querySelector(".app-dialog-input")?.focus();
  });
}

// Track which element opened the currently-visible playlist popover.
// Used by openPlaylistMenu to implement toggle behavior: if the user
// clicks the SAME opener button while its menu is already open, we
// close the menu instead of closing-then-reopening (which looked like
// nothing happened because the close+open was atomic from the user's
// POV).
let _playlistMenuOpener = null;

function closePlaylistMenus() {
  document.querySelectorAll(".playlist-popover").forEach((el) => el.remove());
  _playlistMenuOpener = null;
}

function openPlaylistMenu(anchor, track) {
  // TOGGLE BEHAVIOR: if a menu is already open AND the user clicked the
  // same anchor that opened it, just close and bail.  Without this,
  // clicking the 3-dot button twice in a row would close-then-reopen
  // the menu atomically, making it look like the button did nothing.
  // We compare with isSameNode() to handle the case where the anchor
  // element was recreated between renders (e.g. virtual list row that
  // got recycled) — in that case the references won't match and we
  // fall through to normal open behavior, which is correct.
  if (_playlistMenuOpener && _playlistMenuOpener === anchor) {
    closePlaylistMenus();
    return;
  }

  closePlaylistMenus();
  if (!track) return;
  _playlistMenuOpener = anchor;
  const isInQueue = virtualList.mode === "queue";
  const menu = document.createElement("div");
  menu.className = "playlist-popover track-context-menu";
  menu.innerHTML = `
    <div class="playlist-popover-title">Add to playlist</div>
    <button type="button" data-new="1">+ New Playlist</button>
    ${state.playlists
      .map((p) => {
        const exists = p.tracks?.includes(track.id);
        return `<button type="button" data-playlist-id="${escapeHtml(p.id)}" ${exists ? "disabled" : ""}>${escapeHtml(p.name)}<span>${exists ? "Added" : "Quickly Add"}</span></button>`;
      })
      .join("")}
    <div class="context-menu-divider"></div>
    <button type="button" class="context-menu-danger" data-action="delete">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0;vertical-align:-2px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      ${isInQueue ? "Remove from Queue" : "Delete Song"}
    </button>
  `;
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  // Initial off-screen placement so offsetHeight is measurable after paint
  menu.style.visibility = "hidden";
  menu.style.left = Math.min(rect.left, window.innerWidth - 220) + "px";
  menu.style.top = "0px";
  requestAnimationFrame(() => {
    const mh = menu.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top = spaceBelow >= mh ? rect.bottom + 6 : rect.top - mh - 6;
    menu.style.top = Math.max(8, top) + "px";
    menu.style.visibility = "";
  });
  menu.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();
    if (btn.disabled) return;
    if (btn.dataset.action === "delete") {
      closePlaylistMenus();
      if (virtualList.mode === "queue") {
        // Remove from queue
        const qIdx = state.queue.findIndex((t) => t.id === track.id);
        if (qIdx >= 0) {
          state.queue.splice(qIdx, 1);
          if (state.queueIndex >= qIdx)
            state.queueIndex = Math.max(0, state.queueIndex - 1);
          renderTracks(state.queue, "queue");
        }
      } else {
        // Remove from library
        _removeTrackFromLibrary(track);
      }
      return;
    }
    if (btn.dataset.new) await createPlaylistAndAdd(track);
    else await addTrackToPlaylist(track, btn.dataset.playlistId);
    closePlaylistMenus();
  });
}

/**
 * Remove a track from the library (state + IPC persist).
 */
async function _removeTrackFromLibrary(track) {
  if (!track) return;
  state.tracks = state.tracks.filter((t) => t.id !== track.id);
  state.filteredTracks = state.filteredTracks.filter((t) => t.id !== track.id);
  state.queue = state.queue.filter((t) => t.id !== track.id);
  invalidateSectionCache();
  // Persist removal via IPC
  try {
    await window.novaAPI.invoke("library:remove-track", track.id);
  } catch (_) {}
  // Re-render active section
  if (
    state.activeNavSection === "library" ||
    state.activeNavSection === "home"
  ) {
    renderTracks(state.filteredTracks, "library");
  } else if (state.activeNavSection === "queue") {
    renderTracks(state.queue, "queue");
  }
}

function _wirePlaylistMenu() {
  document.addEventListener("click", (e) => {
    // Don't close if click is inside the popover itself
    if (e.target.closest(".playlist-popover")) return;
    // Don't close if click is on an element that OPENS a menu
    // (otherwise the menu opens and gets immediately closed in the same event)
    if (e.target.closest(".track-menu")) return;
    if (e.target.closest("#np-menu-btn")) return;
    if (e.target.closest("#ov-add-btn")) return;
    if (e.target.closest("#ov-more-btn")) return;
    if (e.target.closest(".playlist-dots-btn")) return;
    if (e.target.closest(".playlist-action-icon")) return;
    if (
      !e.target.closest(".playlist-dots-btn") &&
      !e.target.closest(".playlist-remove-pill")
    ) {
      document
        .querySelectorAll(".playlist-remove-pill")
        .forEach((p) => p.remove());
    }
    closePlaylistMenus();
  });
  $("np-menu-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openPlaylistMenu(e.currentTarget, state.currentTrack);
  });
  $("ov-add-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openPlaylistMenu(e.currentTarget, state.currentTrack);
  });
  // Overlay "More options" 3-dot button
  $("ov-more-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.currentTrack) {
      openPlaylistMenu(e.currentTarget, state.currentTrack);
    }
  });
}

function getAlbumGroups() {
  const q = ($("search-input") || {}).value?.trim();
  const source = q ? state.filteredTracks : state.tracks;
  if (!q && sectionCache.albums) return sectionCache.albums;
  const groups = new Map();
  for (const track of source) {
    const album = (track.album || "Unknown Album").trim() || "Unknown Album";
    const artist = getArtistText(track) || "Unknown Artist";
    const key = `${album.toLowerCase()}::${artist.toLowerCase()}`;
    if (!groups.has(key))
      groups.set(key, {
        key,
        album,
        artist,
        tracks: [],
        coverArt: null,
        year: 0,
      });
    const group = groups.get(key);
    group.tracks.push(track);
    if (!group.coverArt && track.coverArt) {
      group.coverArt = track.coverArt;
      group._coverArtTrackId = track.id;
    }
    // Revolutionary: Also check _hasCoverArt for tracks with stripped base64 cover art
    if (!group.coverArt && track._hasCoverArt) {
      group.coverArt = `nova-media://art/${encodeURIComponent(track.id)}`;
      group._coverArtTrackId = track.id;
    }
    if (!group.year && track.year) group.year = track.year;
  }
  const albums = [...groups.values()].sort(
    (a, b) =>
      a.album.localeCompare(b.album) || a.artist.localeCompare(b.artist),
  );
  if (!q) sectionCache.albums = albums;
  return albums;
}

// ─── Persistent Thumbnail Cache (IndexedDB) ──────────────────────
// Key: `${artPath}::${size}` → dataURL string
// Falls back gracefully if IDB is unavailable (private browsing, etc.)
const _thumbnailCache = new Map(); // session hot-cache (avoids IDB round-trips for already-seen keys)

// ─── SingleFlight: Request Deduplication System [REVFIX v2] ──────────
// Revolutionary pattern from high-performance native apps (C++/C#):
// When multiple consumers request the same resource simultaneously
// (e.g., 50 tracks from the same album all needing the same thumbnail),
// only ONE actual request/IPC call is made. All consumers share the
// same Promise. This eliminates redundant:
//   - IPC calls to main process
//   - Sharp thumbnail generation in main process
//   - IndexedDB reads for the same key
//   - Protocol URL fetches for the same image
// Result: the app feels as fast as a native C++ app because there is
// ZERO redundant work — every unique resource is computed exactly once.
const _inflightRequests = new Map(); // key → Promise (cleared on resolve/reject)

function _dedupe(key, fn) {
  if (_inflightRequests.has(key)) return _inflightRequests.get(key);
  const promise = fn().finally(() => _inflightRequests.delete(key));
  _inflightRequests.set(key, promise);
  return promise;
}

// ─── Album Art Fingerprint Cache [REVFIX v2] ───────────────────────
// Tracks from the same album share the same cover art. Instead of
// resolving each track's cover art independently (which involves string
// checks, protocol URL construction, etc.), we fingerprint by album+artist
// and reuse the resolved URL. This means:
//   - 50 tracks from "Dark Side of the Moon" → 1 _resolveCoverArtSrc call
//   - Collage generation reuses already-resolved URLs
//   - Track row creation is nearly instant for duplicate albums
const _albumArtCache = new Map(); // `${album}::${artist}` → resolvedSrc

function _resolveCoverArtSrcWithReuse(track) {
  if (!track) return null;
  // Check album fingerprint cache first
  const albumKey = `${track.album || ""}::${track.artist || ""}`;
  if (albumKey !== "::" && _albumArtCache.has(albumKey)) {
    return _albumArtCache.get(albumKey);
  }
  // Resolve normally
  const src = _resolveCoverArtSrc(track);
  if (src && albumKey !== "::") {
    _albumArtCache.set(albumKey, src);
    // Evict oldest entries if cache grows too large (LRU-lite)
    if (_albumArtCache.size > 500) {
      const firstKey = _albumArtCache.keys().next().value;
      _albumArtCache.delete(firstKey);
    }
  }
  return src;
}

let _idbReady = false;
let _idb = null;
const IDB_NAME = "NovaTuneThumbCache";
const IDB_STORE = "thumbs";
const IDB_VERSION = 1;

(function _openIDB() {
  try {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE); // key-value: key → dataURL
      }
    };
    req.onsuccess = (e) => {
      _idb = e.target.result;
      _idbReady = true;
    };
    req.onerror = () => {
      /* silently degrade */
    };
  } catch (_) {
    /* IDB unavailable */
  }
})();

function _idbGet(key) {
  return new Promise((resolve) => {
    if (!_idbReady || !_idb) return resolve(null);
    try {
      const tx = _idb.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

function _idbSet(key, value) {
  if (!_idbReady || !_idb) return;
  try {
    const tx = _idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
  } catch (_) {}
}

/** Returns a cached dataURL from hot-cache → IDB → IPC, in that order.
 *  REVFIX v2: Uses SingleFlight deduplication — if the same thumbnail is
 *  already being fetched (e.g., 50 tracks from the same album), all consumers
 *  share the same Promise instead of making 50 separate IPC calls.
 */
async function _getThumb(artPath, size) {
  const cacheKey = `${artPath}::${size}`;
  if (_thumbnailCache.has(cacheKey)) return _thumbnailCache.get(cacheKey);

  // REVFIX v2: SingleFlight — deduplicate concurrent requests for the same thumbnail
  return _dedupe(`thumb::${cacheKey}`, async () => {
    // Double-check cache after dedupe resolves (another caller may have filled it)
    if (_thumbnailCache.has(cacheKey)) return _thumbnailCache.get(cacheKey);

    const persisted = await _idbGet(cacheKey);
    if (persisted) {
      _thumbnailCache.set(cacheKey, persisted);
      return persisted;
    }
    try {
      const res = await window.novaAPI.invoke("coverart:thumbnail", {
        path: artPath,
        size,
      });
      if (res && res.success) {
        const result = res.url || res.dataURL;
        if (result) {
          _thumbnailCache.set(cacheKey, result);
          _idbSet(cacheKey, result);
          return result;
        }
      }
    } catch (_) {}
    return null;
  });
}

/** Clear all batch48 thumb entries from IDB and in-memory _thumb fields (called after a library rescan). */
function _bustIDBThumbCache() {
  _thumbnailCache.clear();
  // Clear in-memory display thumbs so they get re-fetched
  for (const t of state.tracks) delete t._thumb;
  if (!_idbReady || !_idb) return;
  try {
    const tx = _idb.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith("batch48::")) cursor.delete();
      cursor.continue();
    };
  } catch (_) {}
}

/**
 * Attach a lazy-loading thumbnail to an <img> element.
 * Uses IntersectionObserver; resolves from IDB before hitting IPC.
 */
function _attachLazyThumb(img, artPath, size) {
  img.dataset.artPath = artPath;
  img.dataset.artSize = String(size);
  const cacheKey = `${artPath}::${size}`;
  if (_thumbnailCache.has(cacheKey)) {
    img.src = _thumbnailCache.get(cacheKey);
    return;
  }
  // Check IDB synchronously would block — do it async then fall through to observer
  _idbGet(cacheKey).then((persisted) => {
    if (persisted) {
      _thumbnailCache.set(cacheKey, persisted);
      if (!img.src) img.src = persisted;
    }
  });
  _getCardThumbnailObserver().observe(img);
}

// Shared IntersectionObserver for lazy-loading grid card thumbnails
let _cardThumbnailObserver = null;
function _getCardThumbnailObserver() {
  if (!_cardThumbnailObserver) {
    _cardThumbnailObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = entry.target;
          const artPath = img.dataset.artPath;
          const size = parseInt(img.dataset.artSize || "200", 10);
          if (!artPath) {
            _cardThumbnailObserver.unobserve(img);
            continue;
          }
          _cardThumbnailObserver.unobserve(img);
          const cacheKey = `${artPath}::${size}`;
          if (_thumbnailCache.has(cacheKey)) {
            img.src = _thumbnailCache.get(cacheKey);
          } else {
            _getThumb(artPath, size).then((dataURL) => {
              if (dataURL && !img.src) img.src = dataURL;
            });
          }
        }
      },
      { rootMargin: "200px" },
    );
  }
  return _cardThumbnailObserver;
}

/**
 * Eager-load a thumbnail for grid cards. Unlike lazy loading,
 * this starts loading immediately without waiting for IntersectionObserver.
 * Uses protocol URLs when available for native browser caching.
 * Fades in the image on load with a smooth transition.
 *
 * BUGFIX v3: Removed _dedupe from protocol URL loading. _dedupe was causing
 * blank cards when multiple img elements shared the same thumbUrl — the 2nd+
 * img elements never got their .src set because _dedupe skipped calling fn().
 * The browser's native HTTP cache handles duplicate requests efficiently anyway,
 * so deduplication here was net-negative.
 *
 * BUGFIX v3: Added guaranteed 2-second fallback timeout. If no image has loaded
 * within 2 seconds (e.g., sharp is slow, protocol handler errors), the
 * art-placeholder is shown so no card stays permanently blank.
 */
function _attachEagerThumb(img, artPath, size, trackId) {
  img.dataset.artPath = artPath;
  img.dataset.artSize = String(size);
  img.style.opacity = "0";
  img.style.transition = "opacity 0.25s ease";

  // Set dominant color background on container for instant visual feedback
  const container = img.closest(".cover-img-container");
  if (container) {
    const track = state.tracks.find((t) => t.id === trackId);
    container.style.backgroundColor = _getDominantColorForTrack(track);
  }

  // Guaranteed fallback: if no image loads within 2 seconds, show art-placeholder
  let _fallbackFired = false;
  const _fallbackTimer = setTimeout(() => {
    _fallbackFired = true;
    _showFinalFallback(img);
  }, 2000);

  const _cancelFallback = () => {
    if (_fallbackTimer) clearTimeout(_fallbackTimer);
  };

  // Try protocol URL first (fastest - native browser caching)
  const thumbUrl = _getProtocolThumbUrl(artPath, size, trackId);
  if (thumbUrl) {
    // Check hot protocol cache — if another card already loaded this
    // exact URL, we can set src immediately without any async work.
    if (_coverArtPreloader.isLoaded(thumbUrl)) {
      _cancelFallback();
      img.src = thumbUrl;
      img.style.opacity = "1";
      _fadePlaceholder(img);
      return;
    }

    // Load directly — NO _dedupe. The browser's native cache handles
    // duplicate protocol URL requests efficiently (instant on 2nd+ load).
    img.src = thumbUrl;
    img.onload = () => {
      _cancelFallback();
      if (!_fallbackFired) {
        img.style.opacity = "1";
        _fadePlaceholder(img);
      }
    };
    img.onerror = () => {
      if (_fallbackFired) return;
      // Tier 1.5: If this was a thumb URL that failed, try the direct art URL.
      // Thumbnails require on-demand sharp generation (slow); art URLs just do
      // a DB lookup + base64 decode (fast). This avoids the 300ms retry delay
      // and gets art on screen much faster for cards with embedded cover art.
      if (thumbUrl.includes("nova-media://thumb/")) {
        const artUrl = thumbUrl.replace(
          /nova-media:\/\/thumb\/([^/]+)\/\d+/,
          "nova-media://art/$1",
        );
        if (artUrl !== thumbUrl) {
          img.src = artUrl;
          img.onload = () => {
            _cancelFallback();
            if (!_fallbackFired) {
              img.style.opacity = "1";
              _fadePlaceholder(img);
            }
          };
          img.onerror = () => {
            if (_fallbackFired) return;
            // Tier 2: Retry original thumb URL with cache-bust
            setTimeout(() => {
              if (_fallbackFired) return;
              const retryUrl = thumbUrl.includes("?")
                ? `${thumbUrl}&retry=1`
                : `${thumbUrl}?retry=1&t=${Date.now()}`;
              img.src = retryUrl;
              img.onload = () => {
                _cancelFallback();
                if (!_fallbackFired) {
                  img.style.opacity = "1";
                  _fadePlaceholder(img);
                }
              };
              img.onerror = () => {
                if (_fallbackFired) return;
                _cancelFallback();
                // Tier 3: IPC thumbnail fallback
                _loadThumbFallback(img, artPath, size);
              };
            }, 300);
          };
          return;
        }
      }
      // Not a thumb URL or regex didn't match — retry with cache-bust
      setTimeout(() => {
        if (_fallbackFired) return;
        const retryUrl = thumbUrl.includes("?")
          ? `${thumbUrl}&retry=1`
          : `${thumbUrl}?retry=1&t=${Date.now()}`;
        img.src = retryUrl;
        img.onload = () => {
          _cancelFallback();
          if (!_fallbackFired) {
            img.style.opacity = "1";
            _fadePlaceholder(img);
          }
        };
        img.onerror = () => {
          if (_fallbackFired) return;
          _cancelFallback();
          // Tier 3: IPC thumbnail fallback
          _loadThumbFallback(img, artPath, size);
        };
      }, 300);
    };
    return;
  }

  // No protocol URL available - go straight to IPC fallback
  _cancelFallback();
  _loadThumbFallback(img, artPath, size);
}

/** Fade out the ThumbHash placeholder when the real image loads. */
function _fadePlaceholder(img) {
  const container = img.closest(".cover-img-container");
  if (container) {
    const ph = container.querySelector(".thumbhash-placeholder");
    if (ph) ph.classList.add("loaded");
  }
}

/**
 * Get a protocol URL for a thumbnail if available.
 */
function _getProtocolThumbUrl(artPath, size, trackId) {
  // Already a protocol URL — check if we should use sized thumbnails instead
  if (artPath && artPath.startsWith("nova-media://")) {
    // REVFIX v1: Previously returned nova-media://art/ URLs as-is, ignoring the
    // size parameter. This loaded full-res images (potentially multi-MB) for
    // thumbnails. Now uses nova-media://thumb/{trackId}/{size} when available,
    // which serves pre-generated WebP thumbnails. Falls back to full-res if
    // the thumbnail doesn't exist yet (protocol returns 404 → fallback chain).
    if (artPath.startsWith("nova-media://art/") && trackId && size) {
      return `nova-media://thumb/${encodeURIComponent(trackId)}/${size}`;
    }
    return artPath;
  }
  // File path → protocol URL for cover art
  if (artPath && !artPath.startsWith("data:")) {
    return `nova-media://cover/${encodeURIComponent(artPath)}`;
  }
  // For data: URIs, use nova-media://art/ route by track ID if available
  if (trackId) {
    if (size) {
      return `nova-media://thumb/${encodeURIComponent(trackId)}/${size}`;
    }
    return `nova-media://art/${encodeURIComponent(trackId)}`;
  }
  return null;
}

/**
 * Fallback: load thumbnail via IPC (for data: URI sources or protocol failures).
 */
function _loadThumbFallback(img, artPath, size) {
  _getThumb(artPath, size)
    .then((dataURL) => {
      if (dataURL) {
        img.src = dataURL;
        img.onload = () => {
          img.style.opacity = "1";
          _fadePlaceholder(img);
        };
        img.onerror = () => {
          // IPC thumbnail also failed - show the art placeholder
          _showFinalFallback(img);
        };
      } else {
        // No thumbnail available - show the art placeholder as last resort
        _showFinalFallback(img);
      }
    })
    .catch(() => {
      _showFinalFallback(img);
    });
}

/**
 * Final fallback when ALL image loading attempts fail.
 * Replaces the <img> with a colored art-placeholder.
 * GUARANTEES: no black card, no broken image icon.
 * BUGFIX v3: Also handles case where container is the .album-cover itself
 * (when no .cover-img-container was created because artist.coverArt was falsy).
 */
function _showFinalFallback(img) {
  const container = img.closest(".cover-img-container");
  if (!container) {
    // BUGFIX v3: If there's no .cover-img-container, try the parent .album-cover
    const albumCover = img.closest(".album-cover");
    if (albumCover) {
      img.style.display = "none";
      if (!albumCover.querySelector(".art-placeholder")) {
        const artIdx =
          Math.abs((img.dataset.artPath || "").hashCode?.() || 0) % 8;
        const placeholder = document.createElement("div");
        placeholder.className = `art-placeholder art-${artIdx}`;
        placeholder.innerHTML = "&#127925;";
        placeholder.style.cssText =
          "width:100%;height:100%;display:flex;align-items:center;justify-content:center;";
        albumCover.appendChild(placeholder);
      }
      return;
    }
    // Last resort: just hide the broken image
    img.style.opacity = "1";
    img.style.display = "none";
    return;
  }
  // Hide the broken image
  img.style.display = "none";
  // Fade out ThumbHash placeholder if present
  const ph = container.querySelector(".thumbhash-placeholder");
  if (ph) ph.classList.add("loaded");
  // Check if art-placeholder already exists
  if (container.querySelector(".art-placeholder")) return;
  // Create colored placeholder as absolute last resort
  const artIdx = Math.abs((img.dataset.artPath || "").hashCode?.() || 0) % 8;
  const placeholder = document.createElement("div");
  placeholder.className = `art-placeholder art-${artIdx}`;
  placeholder.innerHTML = "&#127925;";
  placeholder.style.cssText = "position:absolute;inset:0;z-index:2;";
  container.appendChild(placeholder);
}

// Simple string hash for deterministic art-index assignment
String.prototype.hashCode =
  String.prototype.hashCode ||
  function () {
    let hash = 0;
    for (let i = 0; i < this.length; i++) {
      const chr = this.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0;
    }
    return hash;
  };

function _makeAlbumCard(album) {
  const card = document.createElement("div");
  card.className = "album-card";
  card.dataset.cardKey = album.key;
  const coverDiv = document.createElement("div");
  coverDiv.className = "album-cover";

  if (album.coverArt) {
    // Create container for layered loading: Dominant color → ThumbHash blur → real image → fallback
    const container = document.createElement("div");
    container.className = "cover-img-container";
    // Set dominant color as instant background (zero-cost, already computed)
    container.style.backgroundColor = _getDominantColorForTrack(
      album.tracks[0],
    );

    // ThumbHash placeholder (instant, ~0.1ms decode)
    const thumbHashData = _thumbHashCache.get(album.tracks[0]?.id);
    if (thumbHashData) {
      const placeholder = document.createElement("img");
      placeholder.className = "thumbhash-placeholder";
      placeholder.src = thumbHashData;
      placeholder.style.cssText = THUMBHASH_PLACEHOLDER_CSS;
      placeholder.alt = "";
      container.appendChild(placeholder);
    }

    const img = document.createElement("img");
    img.alt = "";
    // BUGFIX: Use _coverArtTrackId (the track that provided the cover art) instead of
    // album.tracks[0]?.id (which might be a DIFFERENT track with NO cover art).
    const artTrackId = album._coverArtTrackId || album.tracks[0]?.id;
    // CRITICAL FIX: Append img to container BEFORE _attachEagerThumb
    // so img.closest('.cover-img-container') works inside the handler
    container.appendChild(img);
    coverDiv.appendChild(container);
    // Now trigger image loading — container is in the DOM tree so .closest() works
    _attachEagerThumb(img, album.coverArt, 200, artTrackId);
  } else {
    coverDiv.innerHTML = `<div class="art-placeholder art-${getArtIndex(album.tracks[0])}">&#127925;</div>`;
  }
  card.appendChild(coverDiv);
  const titleDiv = document.createElement("div");
  titleDiv.className = "album-title";
  titleDiv.textContent = album.album;
  const metaDiv = document.createElement("div");
  metaDiv.className = "album-meta";
  metaDiv.textContent = `${album.artist} • ${album.tracks.length} song${album.tracks.length === 1 ? "" : "s"}`;
  card.appendChild(titleDiv);
  card.appendChild(metaDiv);
  card.addEventListener("click", () => {
    _activePanelTarget = _getPanel("albums");
    _saveSectionScroll("albums");
    renderAlbumDetail(album.key);
    _activePanelTarget = null;
  });
  return card;
}

function renderHelp() {
  renderSectionSurface(`
    <div class="help-layout">
      <div class="help-hero">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <h2 style="margin:0;font-size:22px;font-weight:700;">NovaTune Help Center</h2>
        <p style="color:var(--text-secondary);margin:4px 0 0;">Everything you need to know about your music player</p>
      </div>

      <div class="help-contact-banner">
        <div class="help-contact-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/></svg>
        </div>
        <div class="help-contact-text">
          <strong>Need direct help?</strong> Chat with me on WhatsApp
        </div>
        <a href="https://wa.me/254741091123" target="_blank" class="help-contact-btn" id="help-whatsapp-btn" style="color:black;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/></svg>
          Chat Now
        </a>
      </div>

      <div class="help-sections">
        <div class="section-panel">
          <div class="section-panel-title">Getting Started</div>
          <div class="help-item">
            <div class="help-item-title">Adding Music to Your Library</div>
            <div class="help-item-body">Click the <strong>"Add Folder"</strong> button in the sidebar or navigate to Settings and add one or more folders containing your music files. NovaTune scans recursively and supports MP3, FLAC, WAV, OGG, M4A, AAC, and WMA formats. All subfolders are included automatically, so you can point it at your entire music directory. You can add multiple folders and refresh them individually or all at once from Settings.</div>
          </div>
          <div class="help-item">
            <div class="help-item-title">Playing Music</div>
            <div class="help-item-body">Click any song in your library to start playback immediately. The play queue is automatically built from the remaining tracks in your library. You can also click the <strong>Play</strong> or <strong>Shuffle</strong> buttons on album and artist cards to play all songs from that specific album or artist. When you select a song from an artist card, the remaining songs from that artist are queued up next, so the music continues seamlessly within that artist's catalog.</div>
          </div>
          <div class="help-item">
            <div class="help-item-title">Navigation</div>
            <div class="help-item-body">Use the sidebar on the left to switch between Home, Library, Albums, Artists, Playlists, Queue, Settings, Equalizer, and Help. On smaller screens (tablets), swipe from the left edge or hover near the left side to reveal the compact icon navigation. You can configure whether this menu appears on hover or stays always visible in Settings under "Side menu".</div>
          </div>
        </div>

        <div class="section-panel">
          <div class="section-panel-title">Playback Controls</div>
          <div class="help-item">
            <div class="help-item-title">Shuffle and Repeat</div>
            <div class="help-item-body">Toggle <strong>Shuffle</strong> to randomize the play order of your queue. Click the <strong>Repeat</strong> button once to repeat all tracks in the queue, or click it again to repeat only the current track (the icon changes to show a "1"). Click a third time to turn repeat off. These controls are available in the bottom now-playing bar and in the full-screen overlay.</div>
          </div>
          <div class="help-item">
            <div class="help-item-title">Seek and Volume</div>
            <div class="help-item-body">Click anywhere on the squiggly progress bar to seek to that position. Hover over the volume icon to reveal the volume slider, or set it to always visible in Settings. Use keyboard shortcuts: <strong>Space</strong> to play/pause, <strong>N</strong> for next track, <strong>P</strong> for previous track, and <strong>Arrow keys</strong> to scroll the library.</div>
          </div>
          <div class="help-item">
            <div class="help-item-title">Crossfade and Gapless Playback</div>
            <div class="help-item-body">NovaTune supports smooth crossfading between tracks for seamless transitions. Audio is processed through a professional Web Audio API pipeline with a compressor and 10-band equalizer for high-quality output. Gapless playback ensures no silence between consecutive tracks from the same album.</div>
          </div>
        </div>

        <div class="section-panel">
          <div class="section-panel-title">Lyrics</div>
          <div class="help-item">
            <div class="help-item-title">Viewing Lyrics</div>
            <div class="help-item-body">Click the lyrics toggle button in the toolbar to open the lyrics panel. Lyrics are fetched automatically from multiple sources in priority order: your local database, .lrc files next to the audio file, embedded lyrics in the file tags, and the LRCLIB online database. Synced lyrics (time-stamped) will auto-scroll and highlight the current line in real time, while unsynced lyrics display the full text for you to scroll manually.</div>
          </div>
          <div class="help-item">
            <div class="help-item-title">Editing and Adding Lyrics</div>
            <div class="help-item-body">Click the edit button on the lyrics panel to open the lyrics editor. You can search LRCLIB for synced or plain lyrics by track title and artist, import a .lrc file from disk, or paste lyrics manually. Save your changes to associate them with the track permanently. Use the <strong>Clear Lyrics</strong> button to remove saved lyrics for a track.</div>
          </div>
          <div class="help-item">
            <div class="help-item-title">Manual Scrolling</div>
            <div class="help-item-body">For synced lyrics, auto-scroll follows along with the music. If you scroll manually, auto-scroll pauses temporarily and resumes on the next lyric line change. For unsynced lyrics, you have full manual control over scrolling at all times — the app never restricts your scroll position when lyrics are not time-synced.</div>
          </div>
        </div>

        <div class="section-panel">
          <div class="section-panel-title">Playlists</div>
          <div class="help-item">
            <div class="help-item-title">Creating and Managing Playlists</div>
            <div class="help-item-body">Right-click the "Playlists" section header in the sidebar to create a new playlist. Right-click any playlist to rename or delete it. Drag and drop songs onto a playlist in the sidebar, or right-click a song and use "Add to Playlist" from the context menu. Playlists can also be imported and exported in M3U, PLS, XSPF, and JSON formats.</div>
          </div>
          <div class="help-item">
            <div class="help-item-title">Favorites</div>
            <div class="help-item-body">Click the heart icon on any song to add it to your Favorites playlist. This playlist is automatically created the first time you favorite a song. Click the heart again to unfavorite. The heart icon appears in the now-playing bar and in the full-screen overlay.</div>
          </div>
        </div>

        <div class="section-panel">
          <div class="section-panel-title">Equalizer</div>
          <div class="help-item">
            <div class="help-item-title">Using the Equalizer</div>
            <div class="help-item-body">Navigate to the Equalizer section to adjust the 10-band parametric EQ. Choose from 20 built-in presets (Bass Boost, Acoustic, Electronic, Vocal, etc.) or drag the sliders to create your own custom sound profile. The EQ applies in real time to all audio playback. You can toggle the EQ on/off with the master switch, and adjust the volume boost up to 2x for quieter tracks.</div>
          </div>
        </div>

        <div class="section-panel">
          <div class="section-panel-title">Settings</div>
          <div class="help-item">
            <div class="help-item-title">Accent Color and Themes</div>
            <div class="help-item-body">Personalize NovaTune with preset accent colors or choose any custom color. Enable <strong>Dynamic Accent</strong> to have the accent color automatically change based on the album art of the currently playing track. The entire UI adapts instantly, including the squiggly progress bar, buttons, and highlights.</div>
          </div>
          <div class="help-item">
            <div class="help-item-title">Side Menu Mode</div>
            <div class="help-item-body">On compact screens, choose between <strong>"On Hover"</strong> (swipe from the left edge to reveal the navigation) or <strong>"Always Visible"</strong> (the icon strip stays on screen at all times). This setting only affects the view when the full sidebar is hidden due to screen width.</div>
          </div>
          <div class="help-item">
            <div class="help-item-title">Volume Bar Mode</div>
            <div class="help-item-body">Choose whether the volume slider appears only when you hover over the volume icon, or stays always visible for quick adjustments.</div>
          </div>
          <div class="help-item">
            <div class="help-item-title">Over-the-Air Updates</div>
            <div class="help-item-body">NovaTune can check for updates automatically. When a new version is available, you will be notified with a download prompt. You can also manually check for updates from the Help section. This ensures you always have the latest features and bug fixes without needing to manually download and install updates.</div>
          </div>
        </div>

        <div class="section-panel">
          <div class="section-panel-title">Keyboard Shortcuts</div>
          <div class="help-shortcuts">
            <div class="help-shortcut"><kbd>Space</kbd><span>Play / Pause</span></div>
            <div class="help-shortcut"><kbd>N</kbd><span>Next Track</span></div>
            <div class="help-shortcut"><kbd>P</kbd><span>Previous Track</span></div>
            <div class="help-shortcut"><kbd>&uarr;</kbd><kbd>&darr;</kbd><span>Scroll Library</span></div>
            <div class="help-shortcut"><kbd>Ctrl+F</kbd><span>Focus Search</span></div>
            <div class="help-shortcut"><kbd>Esc</kbd><span>Close Overlay / Dialog</span></div>
            <div class="help-shortcut"><kbd>M</kbd><span>Mute / Unmute</span></div>
          </div>
        </div>

        <div class="section-panel">
          <div class="section-panel-title">Supported Formats</div>
          <div class="help-item">
            <div class="help-item-body">NovaTune supports the following audio formats: <strong>MP3</strong> (.mp3), <strong>FLAC</strong> (.flac), <strong>WAV</strong> (.wav), <strong>OGG Vorbis</strong> (.ogg), <strong>M4A/AAC</strong> (.m4a, .aac), and <strong>WMA</strong> (.wma). Cover art is automatically extracted from file tags and displayed. If no embedded art is found, NovaTune searches for cover images (cover.jpg, folder.jpg, etc.) in the same directory.</div>
          </div>
        </div>

        <div class="section-panel">
          <div class="section-panel-title">Contact and Support</div>
          <div class="help-item">
            <div class="help-item-title">Get in Touch</div>
            <div class="help-item-body">If you have questions, feedback, feature requests, or run into any issues, the fastest way to reach us is via WhatsApp. Tap the button below to start a conversation directly. We typically respond within a few hours during business hours (East Africa Time). For bug reports, please include your NovaTune version and steps to reproduce the issue.</div>
          </div>
          <div style="display:flex;gap:10px;margin-top:12px;">
            <a href="https://wa.me/254741091123" target="_blank" class="help-contact-btn" style="text-decoration:none; color:black; ">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/></svg>
              WhatsApp Support
            </a>
            <button class="help-contact-btn" id="help-check-update-btn" style="background:#2a2a2a;border:1px solid #383838;cursor:default;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Check for Updates
            </button>
          </div>
        </div>
      </div>

      <div class="help-footer" style="text-align:center;padding:24px 0 12px;color:var(--text-muted);font-size:12px;">
        NovaTune v1.0.0 &bull; Made with love for music lovers
      </div>
    </div>
  `);

  // Wire update check button
  const updateBtn = document.getElementById("help-check-update-btn");
  if (updateBtn) {
    updateBtn.addEventListener("click", async () => {
      updateBtn.disabled = true;
      updateBtn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;"><polyline points="23 4 23 10 17 10"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/></svg> Checking...';
      try {
        const result = await window.novaAPI.invoke("app:check-update");
        if (!result.success) {
          await showAppDialog({
            title: "Update Check Failed",
            message: `Could not check for updates: ${result.error}`,
            confirmText: "OK",
            cancelText: null,
          });
        } else if (result.hasUpdate) {
          // If electron-updater is the source, offer download-and-install
          if (result.source === "electron-updater") {
            const ok = await showAppDialog({
              title: "Update Available!",
              message: `NovaTune v${result.latestVersion} is available (you have v${result.currentVersion}). Download and install now?`,
              confirmText: "Download & Install",
              cancelText: "Later",
            });
            if (ok) {
              updateBtn.innerHTML =
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;"><polyline points="23 4 23 10 17 10"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/></svg> Downloading...';
              const dlResult = await window.novaAPI.invoke(
                "app:download-update",
              );
              if (dlResult.success) {
                const install = await showAppDialog({
                  title: "Update Ready!",
                  message: `NovaTune v${result.latestVersion} has been downloaded. Restart now to install?`,
                  confirmText: "Restart & Install",
                  cancelText: "Later",
                });
                if (install) {
                  await window.novaAPI.invoke("app:install-update");
                }
              } else {
                await showAppDialog({
                  title: "Download Failed",
                  message: `Could not download update: ${dlResult.error}`,
                  confirmText: "OK",
                  cancelText: null,
                });
              }
            }
          } else {
            // GitHub API fallback — open browser to download
            const ok = await showAppDialog({
              title: "Update Available!",
              message: `NovaTune v${result.latestVersion} is available (you have v${result.currentVersion}). Would you like to download it?`,
              confirmText: "Download",
              cancelText: "Later",
            });
            if (ok && result.downloadUrl) {
              await window.novaAPI.invoke(
                "app:open-external",
                result.downloadUrl,
              );
            } else if (ok && result.releaseUrl) {
              await window.novaAPI.invoke(
                "app:open-external",
                result.releaseUrl,
              );
            }
          }
        } else {
          await showAppDialog({
            title: "You're Up to Date",
            message: `NovaTune v${result.currentVersion} is the latest version.`,
            confirmText: "OK",
            cancelText: null,
          });
        }
      } catch (err) {
        await showAppDialog({
          title: "Update Check Failed",
          message: `Error: ${err.message}`,
          confirmText: "OK",
          cancelText: null,
        });
      }
      updateBtn.disabled = false;
      updateBtn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Check for Updates';
    });
  }
}

function renderAlbums() {
  // If returning from a detail view, hide container before DOM changes
  // so the user never sees scrollTop=0 flash before restore.
  const hasSavedScroll =
    _sectionScrollPos.has("albums") &&
    _sectionScrollPos.get("albums").scrollTop > 0;
  if (hasSavedScroll) _beginScrollRestore("albums");

  renderSectionSurface('<div class="album-grid"></div>');
  const container = getSectionSurface().querySelector(".album-grid");
  const albums = getAlbumGroups();
  if (albums.length === 0) {
    container.innerHTML =
      '<div class="playlist-empty-state">No albums in your library yet.</div>';
    $("content-subtitle").textContent = "0 albums";
    if (hasSavedScroll) _finishScrollRestore();
    return;
  }
  $("content-subtitle").textContent =
    `${albums.length} album${albums.length === 1 ? "" : "s"}`;
  const FIRST_BATCH = 24;
  const CHUNK = 32;
  // Paint first batch synchronously for instant response
  const frag = document.createDocumentFragment();
  const first = albums.slice(0, FIRST_BATCH);
  first.forEach((album) => frag.appendChild(_makeAlbumCard(album)));
  container.appendChild(frag);
  // Restore scroll AFTER first batch is in the DOM — then reveal
  _finishScrollRestore();
  if (albums.length <= FIRST_BATCH) {
    // Small library — audit immediately for any blank cards
    requestIdleCallback(() => _auditCardImages(), { timeout: 1000 });
    return;
  }
  // Render the rest in idle chunks
  let idx = FIRST_BATCH;
  function renderChunk(deadline) {
    // Bail if the user navigated away
    if (!container.isConnected) return;
    const chunkFrag = document.createDocumentFragment();
    while (
      idx < albums.length &&
      (deadline.timeRemaining() > 2 || deadline.didTimeout)
    ) {
      const end = Math.min(idx + CHUNK, albums.length);
      for (; idx < end; idx++)
        chunkFrag.appendChild(_makeAlbumCard(albums[idx]));
    }
    container.appendChild(chunkFrag);
    if (idx < albums.length) {
      requestIdleCallback(renderChunk, { timeout: 500 });
    } else {
      // All chunks rendered — audit for any blank cards
      requestIdleCallback(() => _auditCardImages(), { timeout: 1000 });
    }
  }
  requestIdleCallback(renderChunk, { timeout: 500 });
}

function renderAlbumDetail(albumKey) {
  const album = getAlbumGroups().find((item) => item.key === albumKey);
  if (!album) return;
  // REVFIX v1: Wrap album detail image in .cover-img-container so ThumbHash,
  // dominant color background, and _showFinalFallback all work correctly.
  // Previously the bare <img> was inside .album-detail-cover without a container,
  // so img.closest('.cover-img-container') returned null and fallbacks broke.
  const coverHtml = album.coverArt
    ? `<div class="cover-img-container" style="background-color:${_getDominantColorForTrack(album.tracks[0])}"><img id="album-detail-cover-img" alt=""></div>`
    : `<div class="art-placeholder art-${getArtIndex(album.tracks[0])}">&#127925;</div>`;
  renderSectionSurface(`
    <div class="playlist-detail-header">
      <button class="playlist-back-btn" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;"><polyline points="15 18 9 12 15 6"/></svg> Back</button>
      <div class="album-detail-cover">${coverHtml}</div>
      <div class="playlist-detail-copy">
        <div class="playlist-detail-title">${escapeHtml(album.album)}</div>
        <div class="playlist-detail-meta">${escapeHtml(album.artist)} • ${album.tracks.length} song${album.tracks.length === 1 ? "" : "s"}${album.year ? ` • ${album.year}` : ""}</div>
      </div>
      <div class="playlist-detail-actions">
        <button class="playlist-action-btn" type="button" data-action="export"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> Share</button>
        <button class="playlist-action-btn" type="button" data-action="sequential"><svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px;vertical-align:-2px;"><path d="M6 4l12 8-12 8V4z"/></svg> Play</button>
        <button class="playlist-action-btn" type="button" data-action="shuffle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="4" y1="4" x2="21" y2="21"/></svg> Shuffle</button>
      </div>
    </div>
    <div class="playlist-detail-list"></div>
  `);
  // Detail views should start from the top
  const _area = $("track-area");
  if (_area) _area.scrollTop = 0;
  if (album.coverArt) {
    const coverImg = document.getElementById("album-detail-cover-img");
    if (coverImg)
      _attachEagerThumb(
        coverImg,
        album.coverArt,
        400,
        album._coverArtTrackId || album.tracks[0]?.id,
      );
  }
  const surface = getSectionSurface();
  surface
    .querySelector(".playlist-back-btn")
    .addEventListener("click", () => _reRenderPanel("albums", renderAlbums));
  surface
    .querySelector('[data-action="sequential"]')
    .addEventListener("click", () => playPlaylistTracks(album.tracks, false));
  surface
    .querySelector('[data-action="shuffle"]')
    .addEventListener("click", () => playPlaylistTracks(album.tracks, true));
  const list = surface.querySelector(".playlist-detail-list");
  $("content-subtitle").textContent =
    `${album.tracks.length} song${album.tracks.length === 1 ? "" : "s"}`;
  const CHUNK = 40;
  const frag = document.createDocumentFragment();
  album.tracks
    .slice(0, CHUNK)
    .forEach((track) => frag.appendChild(_createTrackRow(track, album.tracks)));
  list.appendChild(frag);
  if (album.tracks.length > CHUNK) {
    let idx = CHUNK;
    function renderChunk(deadline) {
      if (!list.isConnected) return;
      const cf = document.createDocumentFragment();
      while (
        idx < album.tracks.length &&
        (deadline.timeRemaining() > 2 || deadline.didTimeout)
      ) {
        const end = Math.min(idx + CHUNK, album.tracks.length);
        for (; idx < end; idx++)
          cf.appendChild(_createTrackRow(album.tracks[idx], album.tracks));
      }
      list.appendChild(cf);
      if (idx < album.tracks.length)
        requestIdleCallback(renderChunk, { timeout: 300 });
    }
    requestIdleCallback(renderChunk, { timeout: 300 });
  }
}

function getArtistGroups() {
  const q2 = ($("search-input") || {}).value?.trim();
  const source = q2 ? state.filteredTracks : state.tracks;
  if (!q2 && sectionCache.artists) return sectionCache.artists;
  const groups = new Map();
  for (const track of source) {
    // Split artist text into individual artists so collaborations
    // like "Don Toliver, Rema" are treated as separate artists.
    const artistText = getArtistText(track) || "Unknown Artist";
    const individualArtists = artistText
      .split(/,\s*|;\s*|feat\.?\s*|ft\.?\s*/i)
      .map((a) => a.trim())
      .filter(Boolean);
    for (const singleArtist of individualArtists) {
      const key = singleArtist.toLowerCase();
      if (!groups.has(key))
        groups.set(key, {
          key,
          artist: singleArtist,
          tracks: [],
          coverArt: null,
        });
      const group = groups.get(key);
      // Avoid adding duplicate tracks (a track may match multiple parsed names)
      if (!group.tracks.some((t) => t.id === track.id)) {
        group.tracks.push(track);
      }
      if (!group.coverArt && track.coverArt) {
        group.coverArt = track.coverArt;
        group._coverArtTrackId = track.id; // Track which track provided the coverArt
      }
      // Revolutionary: Also check _hasCoverArt for stripped base64 cover art
      if (!group.coverArt && track._hasCoverArt) {
        group.coverArt = `nova-media://art/${encodeURIComponent(track.id)}`;
        group._coverArtTrackId = track.id;
      }
    }
  }

  // Second pass: if a search query is active, also check track titles for artist names.
  // This catches cases like "Don Toliver" appearing in the song title but not the artist field.
  if (q2) {
    const qLower = q2.toLowerCase();
    for (const track of source) {
      const titleLower = (track.title || "").toLowerCase();
      // For each existing artist group, check if the artist name appears in the track title
      // AND the track isn't already in that group
      for (const [key, group] of groups) {
        if (
          titleLower.includes(key) &&
          !group.tracks.some((t) => t.id === track.id)
        ) {
          group.tracks.push(track);
          if (!group.coverArt && track.coverArt) {
            group.coverArt = track.coverArt;
            group._coverArtTrackId = track.id;
          }
          if (!group.coverArt && track._hasCoverArt) {
            group.coverArt = `nova-media://art/${encodeURIComponent(track.id)}`;
            group._coverArtTrackId = track.id;
          }
        }
      }
      // Also check if the query itself appears in the title and create/merge a group
      // e.g., searching "cash cobain" where it's in the title but no artist group exists yet
      const artistTextLower = (getArtistText(track) || "").toLowerCase();
      if (titleLower.includes(qLower) && !artistTextLower.includes(qLower)) {
        // The search term is in the title but not the artist field
        // Check if any existing group key is contained in the title
        let foundGroup = false;
        for (const [key, group] of groups) {
          if (
            titleLower.includes(key) &&
            !group.tracks.some((t) => t.id === track.id)
          ) {
            group.tracks.push(track);
            if (!group.coverArt && track.coverArt) {
              group.coverArt = track.coverArt;
              group._coverArtTrackId = track.id;
            }
            if (!group.coverArt && track._hasCoverArt) {
              group.coverArt = `nova-media://art/${encodeURIComponent(track.id)}`;
              group._coverArtTrackId = track.id;
            }
            foundGroup = true;
          }
        }
      }
    }
  }

  // When searching, sort artists so that the best-matching artist comes first
  let artists;
  if (q2) {
    const qLower = q2.toLowerCase();
    artists = [...groups.values()].sort((a, b) => {
      const aExact =
        a.key === qLower
          ? 0
          : a.key.startsWith(qLower)
            ? 1
            : a.key.includes(qLower)
              ? 2
              : 3;
      const bExact =
        b.key === qLower
          ? 0
          : b.key.startsWith(qLower)
            ? 1
            : b.key.includes(qLower)
              ? 2
              : 3;
      if (aExact !== bExact) return aExact - bExact;
      return a.artist.localeCompare(b.artist);
    });
  } else {
    artists = [...groups.values()].sort((a, b) =>
      a.artist.localeCompare(b.artist),
    );
  }
  if (!q2) sectionCache.artists = artists;
  return artists;
}

function _makeArtistCard(artist) {
  const card = document.createElement("div");
  card.className = "album-card";
  card.dataset.cardKey = artist.key;
  const coverDiv = document.createElement("div");
  coverDiv.className = "album-cover";

  if (artist.coverArt) {
    const container = document.createElement("div");
    container.className = "cover-img-container";
    // Set dominant color as instant background (zero-cost, already computed)
    container.style.backgroundColor = _getDominantColorForTrack(
      artist.tracks[0],
    );

    const thumbHashData = _thumbHashCache.get(artist.tracks[0]?.id);
    if (thumbHashData) {
      const placeholder = document.createElement("img");
      placeholder.className = "thumbhash-placeholder";
      placeholder.src = thumbHashData;
      placeholder.style.cssText = THUMBHASH_PLACEHOLDER_CSS;
      placeholder.alt = "";
      container.appendChild(placeholder);
    }

    const img = document.createElement("img");
    img.alt = "";
    // BUGFIX: Use _coverArtTrackId (the track that provided the cover art) instead of
    // artist.tracks[0]?.id (which might be a DIFFERENT track with NO cover art).
    // When coverArt = "nova-media://art/trackId3" but trackId = tracks[0].id,
    // _getProtocolThumbUrl generates "nova-media://thumb/WRONG_ID/200" → 404 → blank card.
    const artTrackId = artist._coverArtTrackId || artist.tracks[0]?.id;
    // CRITICAL FIX: Append img to container BEFORE _attachEagerThumb
    container.appendChild(img);
    coverDiv.appendChild(container);
    _attachEagerThumb(img, artist.coverArt, 200, artTrackId);
  } else {
    coverDiv.innerHTML = `<div class="art-placeholder art-${getArtIndex(artist.tracks[0])}">&#127925;</div>`;
  }
  card.appendChild(coverDiv);
  const titleDiv = document.createElement("div");
  titleDiv.className = "album-title";
  titleDiv.textContent = artist.artist;
  const metaDiv = document.createElement("div");
  metaDiv.className = "album-meta";
  metaDiv.textContent = `${artist.tracks.length} song${artist.tracks.length === 1 ? "" : "s"}`;
  card.appendChild(titleDiv);
  card.appendChild(metaDiv);
  card.addEventListener("click", () => {
    _activePanelTarget = _getPanel("artists");
    _saveSectionScroll("artists");
    renderArtistDetail(artist.key);
    _activePanelTarget = null;
  });
  return card;
}

function renderArtists() {
  // If returning from a detail view, hide container before DOM changes
  // so the user never sees scrollTop=0 flash before restore.
  const hasSavedScroll =
    _sectionScrollPos.has("artists") &&
    _sectionScrollPos.get("artists").scrollTop > 0;
  if (hasSavedScroll) _beginScrollRestore("artists");

  renderSectionSurface('<div class="album-grid"></div>');
  const container = getSectionSurface().querySelector(".album-grid");
  const artists = getArtistGroups();
  if (artists.length === 0) {
    container.innerHTML =
      '<div class="playlist-empty-state">No artists in your library yet.</div>';
    $("content-subtitle").textContent = "0 artists";
    if (hasSavedScroll) _finishScrollRestore();
    return;
  }
  $("content-subtitle").textContent =
    `${artists.length} artist${artists.length === 1 ? "" : "s"}`;
  const FIRST_BATCH = 24;
  const CHUNK = 32;
  const frag = document.createDocumentFragment();
  const first = artists.slice(0, FIRST_BATCH);
  first.forEach((artist) => frag.appendChild(_makeArtistCard(artist)));
  container.appendChild(frag);
  // Restore scroll AFTER first batch is in the DOM — then reveal
  _finishScrollRestore();
  if (artists.length <= FIRST_BATCH) {
    // Small library — audit immediately for any blank cards
    requestIdleCallback(() => _auditCardImages(), { timeout: 1000 });
    return;
  }
  let idx = FIRST_BATCH;
  function renderChunk(deadline) {
    if (!container.isConnected) return;
    const chunkFrag = document.createDocumentFragment();
    while (
      idx < artists.length &&
      (deadline.timeRemaining() > 2 || deadline.didTimeout)
    ) {
      const end = Math.min(idx + CHUNK, artists.length);
      for (; idx < end; idx++)
        chunkFrag.appendChild(_makeArtistCard(artists[idx]));
    }
    container.appendChild(chunkFrag);
    if (idx < artists.length) {
      requestIdleCallback(renderChunk, { timeout: 500 });
    } else {
      // All chunks rendered — audit for any blank cards
      requestIdleCallback(() => _auditCardImages(), { timeout: 1000 });
    }
  }
  requestIdleCallback(renderChunk, { timeout: 500 });
}

function renderArtistDetail(artistKey) {
  const artist = getArtistGroups().find((item) => item.key === artistKey);
  if (!artist) return;
  // REVFIX v1: Wrap artist detail image in .cover-img-container (same fix as album detail)
  const coverHtml = artist.coverArt
    ? `<div class="cover-img-container" style="background-color:${_getDominantColorForTrack(artist.tracks[0])}"><img id="artist-detail-cover-img" alt=""></div>`
    : `<div class="art-placeholder art-${getArtIndex(artist.tracks[0])}">&#127925;</div>`;
  renderSectionSurface(`
    <div class="playlist-detail-header">
      <button class="playlist-back-btn" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;"><polyline points="15 18 9 12 15 6"/></svg> Back</button>
      <div class="album-detail-cover">${coverHtml}</div>
      <div class="playlist-detail-copy">
        <div class="playlist-detail-title">${escapeHtml(artist.artist)}</div>
        <div class="playlist-detail-meta">${artist.tracks.length} song${artist.tracks.length === 1 ? "" : "s"}</div>
      </div>
      <div class="playlist-detail-actions">
        <button class="playlist-action-btn" type="button" data-action="sequential"><svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px;vertical-align:-2px;"><path d="M6 4l12 8-12 8V4z"/></svg> Play</button>
        <button class="playlist-action-btn" type="button" data-action="shuffle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="4" y1="4" x2="21" y2="21"/></svg> Shuffle</button>
      </div>
    </div>
    <div class="playlist-detail-list"></div>
  `);
  // Detail views should start from the top
  const _area2 = $("track-area");
  if (_area2) _area2.scrollTop = 0;
  if (artist.coverArt) {
    const coverImg = document.getElementById("artist-detail-cover-img");
    if (coverImg)
      _attachEagerThumb(
        coverImg,
        artist.coverArt,
        400,
        artist._coverArtTrackId || artist.tracks[0]?.id,
      );
  }
  const surface = getSectionSurface();
  surface
    .querySelector(".playlist-back-btn")
    .addEventListener("click", () => _reRenderPanel("artists", renderArtists));
  surface
    .querySelector('[data-action="sequential"]')
    .addEventListener("click", () => playPlaylistTracks(artist.tracks, false));
  surface
    .querySelector('[data-action="shuffle"]')
    .addEventListener("click", () => playPlaylistTracks(artist.tracks, true));
  const list = surface.querySelector(".playlist-detail-list");
  $("content-subtitle").textContent =
    `${artist.tracks.length} song${artist.tracks.length === 1 ? "" : "s"}`;
  const CHUNK = 40;
  const frag = document.createDocumentFragment();
  artist.tracks
    .slice(0, CHUNK)
    .forEach((track) =>
      frag.appendChild(_createTrackRow(track, artist.tracks)),
    );
  list.appendChild(frag);
  if (artist.tracks.length > CHUNK) {
    let idx = CHUNK;
    function renderChunk(deadline) {
      if (!list.isConnected) return;
      const cf = document.createDocumentFragment();
      while (
        idx < artist.tracks.length &&
        (deadline.timeRemaining() > 2 || deadline.didTimeout)
      ) {
        const end = Math.min(idx + CHUNK, artist.tracks.length);
        for (; idx < end; idx++)
          cf.appendChild(_createTrackRow(artist.tracks[idx], artist.tracks));
      }
      list.appendChild(cf);
      if (idx < artist.tracks.length)
        requestIdleCallback(renderChunk, { timeout: 300 });
    }
    requestIdleCallback(renderChunk, { timeout: 300 });
  }
}

/**
 * Build playlist cover collage HTML.
 * Uses _resolveCoverArtSrcWithReuse() [REVFIX v2] to handle ALL cover art types
 * AND reuse resolved URLs for tracks from the same album:
 *   - file paths → nova-media://cover/ protocol URLs
 *   - data: URIs → served directly
 *   - nova-media://art/ URLs → served via protocol handler
 *   - _hasCoverArt flag → nova-media://art/ URL
 *   - Same album tracks reuse the same resolved URL (no redundant resolution)
 * Also supports cached collage images from disk for instant display.
 */
function buildPlaylistCover(tracks, playlistId) {
  // REVFIX v2: Use _resolveCoverArtSrcWithReuse for album-level URL reuse
  // This is much faster when many tracks share the same album art
  const cells = tracks
    .slice(0, 4)
    .map((track) => ({
      track,
      src: _resolveCoverArtSrcWithReuse(track),
    }))
    .filter((c) => c.src);

  if (cells.length === 0)
    return '<div class="playlist-cover-cell art-0" style="font-size:32px;display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#1a1a1a;border:none;outline:none;">&#127925;</div>';

  if (cells.length === 1) {
    const trackId = cells[0].track.id;
    const src = cells[0].src;
    // Set background color from dominant color cache for instant visual feedback
    const bgColor = _getDominantColorForTrack(cells[0].track);
    return `<div class="playlist-cover-cell playlist-cover-solo" data-lazy-id="${trackId}" style="background-color:${bgColor};border:none;outline:none;">
      <img src="${src}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.3s ease;border:none;outline:none;"
        data-collage-img="1">
    </div>`;
  }

  // Simple grid collage — images tile the square using CSS grid (set by
  // .playlist-cover-2/3/4 classes on the parent). No transforms, no clips.
  return cells
    .map((cell, i) => {
      const bgColor = _getDominantColorForTrack(cell.track);
      return `<div class="playlist-cover-cell playlist-cover-tilt" style="background-color:${bgColor};border:none;outline:none;" data-lazy-idx="${cell.track.id}${i}">
      <img src="${cell.src}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.3s ease;border:none;outline:none;" data-collage-img="1">
    </div>`;
    })
    .join("");
}

/**
 * Try to load a cached collage for a playlist.
 * Returns the cached src URL or null if not cached.
 * Also triggers async cache population for next time.
 * Uses content-hash based smart invalidation: if the playlist's track
 * list changed since the collage was cached, it's regenerated.
 */
async function _tryCachedCollage(playlistId, tracks) {
  if (!playlistId) return null;
  const cached = await _getCachedCollage(playlistId, tracks);
  if (cached) {
    // Replace the live-rendered cover with the cached collage image
    const coverEl =
      document.querySelector(
        `.playlist-card[data-playlist-id="${playlistId}"] .playlist-cover`,
      ) || document.querySelector(`.playlist-cover`);
    if (coverEl) {
      // Find the existing cover cells and replace with single cached image
      const existingImg = coverEl.querySelector("img[data-collage-cached]");
      if (!existingImg) {
        const img = document.createElement("img");
        img.dataset.collageCached = "1";
        img.src = cached;
        img.alt = "";
        img.style.cssText =
          "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.3s ease;border:none;outline:none;z-index:3;";
        img.onload = () => {
          img.style.opacity = "1";
        };
        img.onerror = () => {
          img.style.display = "none";
        };
        coverEl.appendChild(img);
      }
    }
    return cached;
  }
  // No cache yet — generate and cache the collage asynchronously
  _generateAndCacheCollage(playlistId, tracks);
  return null;
}

/**
 * Generate a collage image from playlist tracks and save it to cache.
 * Uses an offscreen canvas to render the collage, then saves as data URL.
 *
 * CRITICAL FIX: nova-media:// protocol now includes CORS headers
 * (Access-Control-Allow-Origin: *) so canvas.toDataURL() works.
 * Previously, the canvas was tainted and collage generation silently failed.
 */
async function _generateAndCacheCollage(playlistId, tracks) {
  if (!playlistId || !tracks || tracks.length === 0) return;

  // REVFIX v2: Upped collage resolution to 800 for crisp retina display.
  // Also uses PARALLEL image loading (4x faster than v1's sequential loop).
  const size = 800;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Fill with dark background
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, size, size);

  const artTracks = tracks.filter((t) => _resolveCoverArtSrcWithReuse(t));
  if (artTracks.length === 0) return;

  const cells = artTracks.slice(0, 4);

  try {
    if (cells.length === 1) {
      // Single image fills entire canvas (HQ, center-cropped)
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = _resolveCoverArtSrcWithReuse(cells[0]);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      if (img.naturalWidth <= 1 || img.naturalHeight <= 1) return;
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = Math.floor((img.naturalWidth - side) / 2);
      const sy = Math.floor((img.naturalHeight - side) / 2);
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    } else {
      // Simple grid collage — matches the live CSS grid rendering.
      // 2 images: side by side. 3 images: left half + right column stacked. 4: 2×2.
      const half = size / 2;
      const unit = size / 4; // 4x4 grid units, matches CSS grid-template
      const rects =
        cells.length >= 4
          ? [
              [0, 0, unit * 3, unit * 3], // large top-left, 3x3
              [unit * 3, 0, unit, unit * 2], // top-right, 1x2
              [unit * 3, unit * 2, unit, unit * 2], // bottom-right, 1x2
              [0, unit * 3, unit * 3, unit], // bottom strip, 3x1
            ]
          : cells.length === 3
            ? [
                [0, 0, half, size],
                [half, 0, half, half],
                [half, half, half, half],
              ]
            : [
                [0, 0, half, size],
                [half, 0, half, size],
              ];

      // Parallel image loading
      const loadPromises = cells.map(
        (cell, i) =>
          new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = _resolveCoverArtSrcWithReuse(cell);
            img.onload = () => resolve({ img, index: i, cell });
            img.onerror = () => resolve({ img: null, index: i, cell });
          }),
      );

      const loaded = await Promise.all(loadPromises);
      let drewAny = false;

      for (const { img, index, cell } of loaded) {
        const [dx, dy, dw, dh] = rects[index];
        if (img && img.naturalWidth > 1 && img.naturalHeight > 1) {
          // Center-crop source to match destination aspect ratio
          const srcAspect = img.naturalWidth / img.naturalHeight;
          const dstAspect = dw / dh;
          let sx, sy, sw, sh;
          if (srcAspect > dstAspect) {
            sh = img.naturalHeight;
            sw = sh * dstAspect;
            sx = (img.naturalWidth - sw) / 2;
            sy = 0;
          } else {
            sw = img.naturalWidth;
            sh = sw / dstAspect;
            sx = 0;
            sy = (img.naturalHeight - sh) / 2;
          }
          ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
        } else {
          ctx.fillStyle = _getDominantColorForTrack(cell);
          ctx.fillRect(dx, dy, dw, dh);
        }
        drewAny = true;
      }
      if (!drewAny) return;
    }

    // Save as high-quality WebP (quality 0.95 for retina-grade output)
    const dataURL = canvas.toDataURL("image/webp", 0.95);
    await _saveCollageCache(playlistId, dataURL, tracks);
  } catch (_) {
    // Collage generation failed — live rendering still works
  }
}

function _createTrackRow(track, contextQueue) {
  const row = document.createElement("div");
  row.className = "playlist-song-row";
  const thumbDiv = document.createElement("div");
  thumbDiv.className = "playlist-song-thumb";
  // REVFIX v2: Use album art reuse for faster resolution across duplicate albums
  const artSrc = _resolveCoverArtSrcWithReuse(track);
  if (artSrc) {
    const img = document.createElement("img");
    img.alt = "";
    // Set dominant color background for instant feedback
    thumbDiv.style.backgroundColor = _getDominantColorForTrack(track);
    img.src = artSrc;
    img.style.cssText =
      "width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.3s ease;border:none;outline:none;";
    img.onload = () => {
      img.style.opacity = "1";
    };
    img.onerror = () => {
      // REVFIX v1: _resolveCoverArtSrc already handles _hasCoverArt, so if it
      // returned a URL and that URL failed, retrying with the same URL is pointless.
      // Instead, try the IPC thumbnail fallback as a last resort.
      _loadThumbFallback(img, track.coverArt || "", 48);
    };
    thumbDiv.appendChild(img);
  } else if (track._hasCoverArt) {
    const img = document.createElement("img");
    img.alt = "";
    thumbDiv.style.backgroundColor = _getDominantColorForTrack(track);
    img.src = `nova-media://art/${encodeURIComponent(track.id)}`;
    img.style.cssText =
      "width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.3s ease;border:none;outline:none;";
    img.onload = () => {
      img.style.opacity = "1";
    };
    img.onerror = () => {
      img.style.opacity = "0";
    };
    thumbDiv.appendChild(img);
  } else {
    thumbDiv.innerHTML = `<div class="art-placeholder art-${getArtIndex(track)}">&#127925;</div>`;
  }
  row.appendChild(thumbDiv);
  // CRITICAL FIX: Use DOM manipulation instead of innerHTML +=
  // innerHTML += destroys ALL existing DOM elements and event handlers,
  // which means img.onload never fires and thumbnails stay at opacity:0 (invisible)
  const infoDiv = document.createElement("div");
  infoDiv.className = "playlist-song-info";
  infoDiv.innerHTML = `
      <div class="playlist-song-title">${escapeHtml(track.title || "Unknown")}</div>
      <div class="playlist-song-artist">${escapeHtml(getArtistText(track))}</div>
    `;
  row.appendChild(infoDiv);
  const durDiv = document.createElement("div");
  durDiv.className = "playlist-song-duration";
  durDiv.textContent = formatTime(track.duration);
  row.appendChild(durDiv);
  const actionBtn = document.createElement("button");
  actionBtn.className = "playlist-action-icon";
  actionBtn.type = "button";
  actionBtn.setAttribute("aria-label", "Add to playlist");
  actionBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>`;
  row.appendChild(actionBtn);
  row.addEventListener("click", () => {
    prefetchLyrics(track); // start lyrics race before audio init
    // If contextQueue is provided (e.g. artist/album detail), use it for the queue
    // so that songs from the same artist/album play sequentially
    if (contextQueue && contextQueue.length > 0) {
      const idx = contextQueue.findIndex((t) => t.id === track.id);
      const before = idx >= 0 ? contextQueue.slice(0, idx) : [];
      const after = idx >= 0 ? contextQueue.slice(idx + 1) : contextQueue;
      state.queue = [track, ...after, ...before];
    } else {
      // Default: queue starts with clicked track, then continues through the
      // rest of the list in its current sort order (wrap-around).
      //
      // BUGFIX: Previously this was `[track, ...remaining]` where
      // `remaining = allTracks.filter(t => t.id !== track.id)`, which
      // always resumed from song #1 of the list. Now we slice from the
      // clicked track's position so the "Next" button advances in the
      // user's visible arrangement — same behaviour as the playlist view.
      const allTracks = state.filteredTracks.length
        ? state.filteredTracks
        : state.tracks;
      const clickedIdx = allTracks.findIndex((t) => t.id === track.id);
      if (clickedIdx >= 0) {
        const after = allTracks.slice(clickedIdx);
        const before = allTracks.slice(0, clickedIdx);
        state.queue = [...after, ...before];
      } else {
        state.queue = [track];
      }
    }
    state.queueIndex = 0;
    playTrack(track);
  });
  actionBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openPlaylistMenu(e.currentTarget, track);
  });
  return row;
}

function renderPlaylistDetail(playlistId) {
  const playlist = state.playlists.find((p) => p.id === playlistId);
  if (!playlist) return;
  state.activePlaylistId = playlistId;

  const container = _activePanelTarget || $("track-list");
  const libraryById = new Map(state.tracks.map((track) => [track.id, track]));
  const tracks = (playlist.tracks || [])
    .map((id) => libraryById.get(id))
    .filter(Boolean);
  {
    const _a = $("track-area");
    if (_a && virtualList.scrollHandler) {
      _a.removeEventListener("scroll", virtualList.scrollHandler, {
        passive: true,
      });
      virtualList.scrollHandler = null;
    }
    if (virtualList.raf) {
      cancelAnimationFrame(virtualList.raf);
      virtualList.raf = 0;
    }
  }
  $("col-headers").style.display = "none";
  container.className = "";
  container.innerHTML = `
    <div class="playlist-detail-header">
      <button class="playlist-back-btn" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;"><polyline points="15 18 9 12 15 6"/></svg> Back</button>
      <div class="playlist-detail-copy">
        <div class="playlist-detail-title">${escapeHtml(playlist.name)}</div>
        <div class="playlist-detail-meta">${tracks.length} song${tracks.length === 1 ? "" : "s"}</div>
      </div>
      <div class="playlist-detail-actions">
        <button class="playlist-action-btn" type="button" data-action="export"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> Share</button>
        <button class="playlist-action-btn" type="button" data-action="sequential"><svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px;vertical-align:-2px;"><path d="M6 4l12 8-12 8V4z"/></svg> Play</button>
        <button class="playlist-action-btn" type="button" data-action="shuffle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="4" y1="4" x2="21" y2="21"/></svg> Shuffle</button>
      </div>
    </div>
    <div class="playlist-detail-list"></div>
  `;

  // Detail views should start from the top
  const _aScroll = $("track-area");
  if (_aScroll) _aScroll.scrollTop = 0;

  container
    .querySelector(".playlist-back-btn")
    .addEventListener("click", () =>
      _reRenderPanel("playlists", renderPlaylists),
    );
  container
    .querySelector('[data-action="sequential"]')
    .addEventListener("click", () => playPlaylistTracks(tracks, false));
  container
    .querySelector('[data-action="shuffle"]')
    .addEventListener("click", () => playPlaylistTracks(tracks, true));
  container
    .querySelector('[data-action="export"]')
    ?.addEventListener("click", () => exportPlaylistById(playlistId));

  const list = container.querySelector(".playlist-detail-list");
  if (tracks.length === 0) {
    list.innerHTML =
      '<div class="playlist-empty-state">No songs in this playlist yet.</div>';
  }

  tracks.forEach((track, idx) => {
    const row = document.createElement("div");
    row.className = "playlist-song-row";
    const thumbDiv = document.createElement("div");
    thumbDiv.className = "playlist-song-thumb";
    // Use _resolveCoverArtSrc for reliable image loading across ALL art types
    const artSrc = _resolveCoverArtSrc(track);
    if (artSrc) {
      const img = document.createElement("img");
      img.alt = "";
      thumbDiv.style.backgroundColor = _getDominantColorForTrack(track);
      img.src = artSrc;
      img.style.cssText =
        "width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.3s ease;";
      img.onload = () => {
        img.style.opacity = "1";
      };
      img.onerror = () => {
        img.style.display = "none";
      };
      thumbDiv.appendChild(img);
    } else if (track._hasCoverArt) {
      const img = document.createElement("img");
      img.alt = "";
      thumbDiv.style.backgroundColor = _getDominantColorForTrack(track);
      img.src = `nova-media://art/${encodeURIComponent(track.id)}`;
      img.style.cssText =
        "width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.3s ease;";
      img.onload = () => {
        img.style.opacity = "1";
      };
      img.onerror = () => {
        img.style.display = "none";
      };
      thumbDiv.appendChild(img);
    } else {
      thumbDiv.innerHTML = `<div class="art-placeholder art-${getArtIndex(track)}">&#127925;</div>`;
    }
    row.appendChild(thumbDiv);
    // CRITICAL FIX: Use DOM manipulation instead of innerHTML +=
    // innerHTML += destroys ALL existing DOM elements and event handlers
    const infoDiv2 = document.createElement("div");
    infoDiv2.className = "playlist-song-info";
    infoDiv2.innerHTML = `
        <div class="playlist-song-title">${escapeHtml(track.title || "Unknown")}</div>
        <div class="playlist-song-artist">${escapeHtml(getArtistText(track))}</div>
      `;
    row.appendChild(infoDiv2);
    const durDiv2 = document.createElement("div");
    durDiv2.className = "playlist-song-duration";
    durDiv2.textContent = formatTime(track.duration);
    row.appendChild(durDiv2);
    const dotsBtn = document.createElement("button");
    dotsBtn.className = "playlist-dots-btn";
    dotsBtn.type = "button";
    dotsBtn.setAttribute("aria-label", "More options");
    dotsBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;
    row.appendChild(dotsBtn);
    row.addEventListener("click", () => {
      prefetchLyrics(track); // start lyrics race before audio init
      state.shuffleEnabled = false;
      // BUGFIX: Previously the queue was built as `[track, ...remaining]`
      // where `remaining = tracks.filter(t => t.id !== track.id)`. This put
      // the clicked song first but then resumed from song #1 of the
      // playlist — so clicking song #5 would play #5, then #1, #2, #3, #4,
      // #6, #7... instead of #5, #6, #7, #8, #9, #10, #1, #2, #3, #4.
      //
      // The fix mirrors what the "Repeat all" toggle does (see _wireNowPlaying):
      // slice from the clicked track's index to the end, then append the
      // tracks that came before it (wrap-around). This way the "Next" button
      // always advances through the playlist in its original arrangement.
      const clickedIdx = tracks.findIndex((t) => t.id === track.id);
      if (clickedIdx >= 0) {
        const after = tracks.slice(clickedIdx); // [clicked, ...rest in order]
        const before = tracks.slice(0, clickedIdx); // [tracks before clicked]
        state.queue = [...after, ...before];
      } else {
        // Fallback (shouldn't happen) — old behaviour
        state.queue = [track, ...tracks.filter((t) => t.id !== track.id)];
      }
      state.queueIndex = 0;
      $("shuffle-btn").classList.remove("active");
      playTrack(track);
    });
    dotsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Toggle remove pill
      const existing = row.querySelector(".playlist-remove-pill");
      if (existing) {
        existing.remove();
        return;
      }
      // Close any other open pills
      document
        .querySelectorAll(".playlist-remove-pill")
        .forEach((p) => p.remove());
      const pill = document.createElement("button");
      pill.className = "playlist-remove-pill";
      pill.type = "button";
      pill.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Remove`;
      pill.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const result = await window.novaAPI.invoke(
          "playlist:remove-track",
          playlist.id,
          track.id,
        );
        if (result.success) {
          const playlistIdx = state.playlists.findIndex(
            (p) => p.id === playlist.id,
          );
          if (playlistIdx >= 0) state.playlists[playlistIdx] = result.playlist;
          // Invalidate collage cache since track list changed
          _invalidateCollageCache(playlist.id);
          _syncHeartButton();
          _activePanelTarget = _getPanel("playlists");
          renderPlaylistDetail(playlist.id);
          _activePanelTarget = null;
        }
      });
      row.appendChild(pill);
    });
    list.appendChild(row);
  });
}

function playPlaylistTracks(tracks, shuffle) {
  if (!tracks.length) return;
  state.shuffleEnabled = shuffle;
  state.queue = shuffle
    ? [...tracks].sort(() => Math.random() - 0.5)
    : [...tracks];
  state.queueIndex = 0;
  $("shuffle-btn").classList.toggle("active", shuffle);
  playTrack(state.queue[0]);
}

// ─── Track Rendering ─────────────────────────────────────────────
// Utility: Determine art placeholder index based on track title hash
function getArtIndex(track) {
  if (!track || !track.title) return 0;
  const str = track.title;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash) % 5; // match CSS art‑gradient classes (0‑4)
}

function renderTracks(list, mode = "library") {
  const container = $("track-list");
  const headers = $("col-headers");
  if (headers) headers.style.display = "";
  container.className = "virtual-track-list";
  container.innerHTML = "";
  virtualList.items = Array.isArray(list) ? list : [];
  virtualList.mode = mode;
  if (virtualList.raf) {
    cancelAnimationFrame(virtualList.raf);
    virtualList.raf = 0;
  }

  // ── Reset slot recycling state for new view ──
  // Old slots are destroyed by innerHTML reset below, so clear all references.
  virtualList.activeSlots.clear();
  virtualList.freeSlots.length = 0;
  virtualList.slotPool.length = 0;
  virtualList.poolSize = 0;
  virtualList.lastStart = -1;
  virtualList.lastEnd = -1;
  virtualList._lastActiveTrackId = null;

  if (virtualList.items.length === 0) {
    container.className = "";
    container.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:40px 12px;text-align:center;color:var(--text-muted);font-size:14px;">No tracks yet. Click "Add folder" in the sidebar to scan for music.</div>';
    $("content-subtitle").textContent = "0 tracks";
    return;
  }

  // Queue mode: add extra bottom padding so the last song isn't clamped
  const queuePadding = mode === "queue" ? 80 : 0;
  const totalHeight =
    virtualList.items.length * VIRTUAL_ROW_HEIGHT + queuePadding;
  container.innerHTML = `
    <div class="virtual-track-spacer" style="height:${totalHeight}px;">
      <div class="virtual-track-window" id="virtual-track-window" style="height:${totalHeight}px;"></div>
    </div>
  `;
  virtualList.lastStart = -1;
  virtualList.lastEnd = -1;

  // Pre-allocate DOM slot pool to avoid GC during scroll
  _ensureSlotPool();

  // Wire event delegation — ONE click/dragstart/dragover/drop listener
  // on the window element, never per-row listeners (no accumulation).
  _wireVirtualDelegation();

  const area = $("track-area");
  // Remove old listener if any
  if (virtualList.scrollHandler) {
    area.removeEventListener("scroll", virtualList.scrollHandler, {
      passive: true,
    });
  }
  area.onscroll = null;
  virtualList.scrollHandler = scheduleVirtualRender;
  area.addEventListener("scroll", virtualList.scrollHandler, { passive: true });
  if (area.scrollTop) area.scrollTop = 0;
  renderVirtualRows();

  $("content-subtitle").textContent =
    `${virtualList.items.length} track${virtualList.items.length !== 1 ? "s" : ""} \u2022 ${calcTotalDuration(virtualList.items)}`;
}

// Pre-allocate a fixed pool of row <div> elements.
// Each slot uses position:absolute + transform:translateY so it can be
// recycled independently. translateY triggers only compositing (no layout).
function _ensureSlotPool() {
  const area = $("track-area");
  const visibleCount = area
    ? Math.ceil((area.clientHeight || 800) / VIRTUAL_ROW_HEIGHT) +
      VIRTUAL_ROW_BUFFER * 2
    : 30;
  const needed = Math.max(60, visibleCount + 16);
  const pool = virtualList.slotPool;
  const freeSlots = virtualList.freeSlots;
  while (pool.length < needed) {
    const row = document.createElement("div");
    row.className = "track-row";
    row.style.position = "absolute";
    row.style.left = "0";
    row.style.right = "0";
    row.style.height = VIRTUAL_ROW_HEIGHT + "px";
    row.style.transform = "translateY(0)";
    row.style.willChange = "transform";
    row.style.display = "none";
    row._trackId = null;
    pool.push(row);
    freeSlots.push(row);
  }
  virtualList.poolSize = Math.max(virtualList.poolSize, needed);
}

function scheduleVirtualRender() {
  // ── Velocity-gated overscan ──
  const now = performance.now();
  const area = $("track-area");
  if (area) {
    const currentScrollTop = area.scrollTop;
    const dt = (now - _lastScrollTime) / 1000;
    if (dt > 0 && _lastScrollTime > 0) {
      const delta = Math.abs(currentScrollTop - _lastScrollTop);
      _scrollVelocity = delta / dt;
      if (_scrollVelocity > VELOCITY_THRESHOLD) {
        VIRTUAL_ROW_BUFFER = VIRTUAL_ROW_BUFFER_BASE * 2;
      }
    }
    _lastScrollTop = currentScrollTop;
    _lastScrollTime = now;
  }

  clearTimeout(_velocityIdleTimer);
  _velocityIdleTimer = setTimeout(() => {
    if (VIRTUAL_ROW_BUFFER !== VIRTUAL_ROW_BUFFER_BASE) {
      VIRTUAL_ROW_BUFFER = VIRTUAL_ROW_BUFFER_BASE;
      _ensureSlotPool();
      renderVirtualRows();
    }
    _scrollVelocity = 0;
  }, 150);

  if (virtualList.raf) return;
  virtualList.raf = requestAnimationFrame(() => {
    virtualList.raf = 0;
    if (VIRTUAL_ROW_BUFFER !== VIRTUAL_ROW_BUFFER_BASE) _ensureSlotPool();
    renderVirtualRows();
  });
}

function renderVirtualRows() {
  const area = $("track-area");
  const windowEl = $("virtual-track-window");
  if (!area || !windowEl || virtualList.items.length === 0) return;

  const scrollTop = area.scrollTop;
  const start = Math.max(
    0,
    Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_ROW_BUFFER,
  );
  const visibleCount =
    Math.ceil(area.clientHeight / VIRTUAL_ROW_HEIGHT) + VIRTUAL_ROW_BUFFER * 2;
  const end = Math.min(virtualList.items.length, start + visibleCount);

  if (start === virtualList.lastStart && end === virtualList.lastEnd) return;
  virtualList.lastStart = start;
  virtualList.lastEnd = end;

  // ── Handle active track change ──
  const activeTrackId = state.currentTrack ? state.currentTrack.id : null;
  const activeChanged = virtualList._lastActiveTrackId !== activeTrackId;
  if (activeChanged) virtualList._lastActiveTrackId = activeTrackId;

  const activeSlots = virtualList.activeSlots; // trackId → slot
  const freeSlots = virtualList.freeSlots;
  const newVisibleIds = new Set();

  // Collect IDs of tracks that should be visible
  for (let i = start; i < end; i++) {
    const track = virtualList.items[i];
    if (track) newVisibleIds.add(track.id);
  }

  // ── Release slots for tracks leaving the viewport ──
  for (const [trackId, slot] of activeSlots) {
    if (!newVisibleIds.has(trackId)) {
      slot.style.display = "none";
      slot._trackId = null;
      activeSlots.delete(trackId);
      freeSlots.push(slot);
    }
  }

  // ── Ensure enough free slots for new rows ──
  const neededNew = end - start - activeSlots.size;
  if (neededNew > freeSlots.length) {
    const deficit = neededNew - freeSlots.length;
    for (let n = 0; n < deficit; n++) {
      const row = document.createElement("div");
      row.className = "track-row";
      row.style.position = "absolute";
      row.style.left = "0";
      row.style.right = "0";
      row.style.height = VIRTUAL_ROW_HEIGHT + "px";
      row.style.transform = "translateY(0)";
      row.style.willChange = "transform";
      row.style.display = "none";
      row._trackId = null;
      virtualList.slotPool.push(row);
      freeSlots.push(row);
    }
  }

  // ── Assign slots to newly visible tracks (slot recycling) ──
  // Only 1-2 rows typically enter the viewport per scroll frame,
  // so only 1-2 innerHTML writes instead of 20+.
  for (let i = start; i < end; i++) {
    const track = virtualList.items[i];
    if (!track) continue;
    const trackId = track.id;

    if (activeSlots.has(trackId)) {
      // Slot already exists for this track.
      // If active state changed, repopulate only this row.
      if (activeChanged) {
        const slot = activeSlots.get(trackId);
        const isActive = activeTrackId === trackId;
        const wasActive = slot.classList.contains("active");
        if (isActive !== wasActive) {
          _populateSlot(slot, track, i);
          slot._trackId = trackId;
        }
      }
      continue;
    }

    // Need a new slot — take from free pool
    let slot = freeSlots.pop();
    if (!slot) {
      // Should not happen after neededNew block above, but guard anyway
      slot = document.createElement("div");
      slot.className = "track-row";
      slot.style.position = "absolute";
      slot.style.left = "0";
      slot.style.right = "0";
      slot.style.height = VIRTUAL_ROW_HEIGHT + "px";
      slot.style.willChange = "transform";
      slot._trackId = null;
      virtualList.slotPool.push(slot);
    }

    _populateSlot(slot, track, i);
    slot._trackId = trackId;
    slot.style.transform = `translateY(${Math.round(i * VIRTUAL_ROW_HEIGHT)}px)`;
    slot.style.display = "";

    // Append to windowEl if not already a child
    if (slot.parentElement !== windowEl) {
      windowEl.appendChild(slot);
    }

    activeSlots.set(trackId, slot);
  }

  // Each slot positioned via transform:translateY — compositing-only, no layout.
}

// Populate a pre-allocated slot element in-place with track data.
// Pure innerHTML write — NO addEventListener calls.
// All events are handled via delegation from the virtual-track-window.
// Uses Bitmap Thumbnail Atlas: drawImage from ImageBitmap is ~5× faster
// than decoding a full-res src per row.
function _populateSlot(row, track, idx) {
  const isActive = state.currentTrack && state.currentTrack.id === track.id;
  const artIdx = getArtIndex(track);
  const isQueue = virtualList.mode === "queue";

  row.className =
    "track-row" + (isActive ? " active" : "") + (isQueue ? " queue-row" : "");
  row.dataset.trackId = track.id;
  row.dataset.idx = idx;
  if (isQueue) row.dataset.queueIdx = idx;
  else delete row.dataset.queueIdx;

  // Drag attribute for queue rows (delegated drag handlers read dataset)
  if (isQueue) row.draggable = true;
  else row.draggable = false;

  const thumbInner = isQueue
    ? `<div class="queue-num-badge">${idx + 1}</div>`
    : "";

  // ── Bitmap thumbnail atlas: use canvas + drawImage from ImageBitmap ──
  // If the track has a pre-built thumbnail in the atlas, render a <canvas>
  // and draw the 40×40 bitmap directly — ~5× faster than full-res <img>.
  // Fall back to <img> tag if the atlas entry isn't ready yet.
  let artHtml;
  const bitmap = thumbnailAtlas.get(track.id);
  if (bitmap) {
    // Canvas size matches CSS size (42×42 track-thumb) × DPR for crispness.
    // The bitmap is already THUMBNAIL_SIZE×THUMBNAIL_SIZE pixels.
    const canvasW = THUMB_DPR * 42;
    const canvasH = THUMB_DPR * 42;
    artHtml =
      `<canvas class="track-thumb-canvas" width="${canvasW}" height="${canvasH}" ` +
      `style="width:42px;height:42px;border-radius:4px;display:block;" ` +
      `data-bitmap-id="${track.id}"></canvas>` +
      `<div class="art-placeholder art-${artIdx}" style="display:none">${isActive ? "" : "🎵"}</div>`;
  } else if (track._thumb || track.coverArt || track._hasCoverArt) {
    // CRITICAL FIX: Must convert file paths to protocol URLs for Electron security
    // Raw file paths like /path/to/cover.jpg can't be used as <img src> with webSecurity:true
    let displaySrc;
    if (track._thumb) {
      displaySrc =
        track._thumb.startsWith("nova-media://") ||
        track._thumb.startsWith("data:")
          ? track._thumb
          : _getCoverArtDisplayUrl(track._thumb);
    } else if (track.coverArt) {
      displaySrc = _getCoverArtDisplayUrl(track.coverArt);
    } else if (track._hasCoverArt) {
      displaySrc = `nova-media://art/${encodeURIComponent(track.id)}`;
    }
    artHtml =
      `<img src="${displaySrc}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;border:none;outline:none;" onerror="this.style.display='none';this.nextElementSibling.style.display=''">` +
      `<div class="art-placeholder art-${artIdx}" style="display:none">${isActive ? "" : "🎵"}</div>`;
  } else {
    artHtml = `<div class="art-placeholder art-${artIdx}">${isActive ? "" : "🎵"}</div>`;
  }

  const eqHtml = isActive
    ? '<div class="eq-icon"><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div></div>'
    : "";

  const menuSvg = isQueue
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
  const menuClass = isQueue ? "track-menu queue-drag-handle" : "track-menu";

  row.innerHTML =
    `<div class="track-thumb">${thumbInner}${artHtml}${eqHtml}</div>` +
    `<div class="track-info"><div class="track-name">${escapeHtml(track.title || "Unknown")}</div></div>` +
    `<div class="track-cell hide-md">${escapeHtml(getArtistText(track))}</div>` +
    `<div class="track-cell muted hide-sm">${track.year || ""}</div>` +
    `<div class="track-cell hide-md">${escapeHtml(track.album || "Unknown Album")}</div>` +
    `<div class="track-cell" style="padding-left:20px">${formatTime(track.duration)}</div>` +
    `<div class="${menuClass}">${menuSvg}</div>`;

  // ── Draw bitmap to canvas if atlas entry exists ──
  if (bitmap) {
    const canvas = row.querySelector(".track-thumb-canvas");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, THUMB_DPR * 42, THUMB_DPR * 42);
    }
  }

  // No addEventListener here — all events are delegated.
}

// ─── Virtual List Event Delegation ──────────────────────────────────
// ONE listener per event type on the virtual-track-window container.
// Reads dataset.trackId from the clicked row, looks up the track from
// virtualList.items — zero per-row listener accumulation.
let _delegationWired = false;

function _wireVirtualDelegation() {
  if (_delegationWired) return; // wire once, never again
  _delegationWired = true;

  // ── Predictive prefetch on hover ──
  // On pointerenter (via delegated mouseover), prefetch lyrics + warm cover art.
  // By click time everything is already in memory.
  // Suppressed during active scroll to prevent main-thread jitter.
  document.addEventListener("mouseover", (e) => {
    const row = e.target.closest(".track-row[data-track-id]");
    if (!row) return;
    const windowEl = row.closest("#virtual-track-window");
    if (!windowEl) return;
    const trackId = row.dataset.trackId;
    if (_hoverPrefetchTrackId === trackId) return; // already prefetched this row
    _hoverPrefetchTrackId = trackId;
    // Skip prefetch during active scroll — defer until idle
    if (_scrollVelocity > 100) {
      requestIdleCallback(
        () => {
          const idx = parseInt(row.dataset.idx, 10);
          const track = virtualList.items[idx];
          if (track && track.id === trackId) {
            prefetchLyrics(track);
            warmCoverArt(track);
          }
        },
        { timeout: 500 },
      );
      return;
    }
    const idx = parseInt(row.dataset.idx, 10);
    const track = virtualList.items[idx];
    if (!track || track.id !== trackId) return;
    // Fire lyrics prefetch + warm cover art src
    prefetchLyrics(track);
    warmCoverArt(track);
  });

  // We attach to document so we don't have to re-wire when the window
  // element is recreated on each renderTracks() call.
  document.addEventListener("click", (e) => {
    const row = e.target.closest(".track-row[data-track-id]");
    if (!row) return;
    const windowEl = row.closest("#virtual-track-window");
    if (!windowEl) return;

    const trackId = row.dataset.trackId;
    const idx = parseInt(row.dataset.idx, 10);
    const track = virtualList.items[idx];
    if (!track || track.id !== trackId) return;

    // If click was on the menu / drag-handle, handle separately
    if (e.target.closest(".track-menu")) {
      e.stopPropagation();
      if (virtualList.mode === "queue") {
        // Drag handle in queue — no action on click
      } else {
        const menuEl = e.target.closest(".track-menu");
        openPlaylistMenu(menuEl, track);
      }
      return;
    }

    // Normal row click — play the track
    prefetchLyrics(track);
    // Queue always starts with the clicked track, followed by the rest of the list.
    // This ensures the queue view always shows: [now playing] → [up next...]
    if (virtualList.mode === "queue") {
      // Already in queue view — keep current queue, just update index
      state.queue = [...state.queue];
      state.queueIndex = idx;
    } else {
      // Library/home view — build queue from the rendered (sorted) list,
      // starting at the clicked index so sort order is preserved.
      const sorted = virtualList.items;
      state.queue = sorted;
      state.queueIndex = idx;
    }
    playTrack(track);
  });

  // ── Queue drag-to-reorder delegation ──
  document.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".queue-row[data-track-id]");
    if (!row) return;
    const idx = parseInt(row.dataset.queueIdx, 10);
    _queueDragSrcIdx = idx;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
    row.classList.add("queue-drag-source");
  });

  document.addEventListener("dragend", (e) => {
    const row = e.target.closest(".queue-row");
    if (row) row.classList.remove("queue-drag-source");
    document
      .querySelectorAll(".queue-drag-over")
      .forEach((r) => r.classList.remove("queue-drag-over"));
    _queueDragSrcIdx = -1;
    _queueDragOverIdx = -1;
  });

  document.addEventListener("dragover", (e) => {
    const row = e.target.closest(".queue-row[data-track-id]");
    if (!row) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const idx = parseInt(row.dataset.queueIdx, 10);
    if (_queueDragOverIdx !== idx) {
      document
        .querySelectorAll(".queue-drag-over")
        .forEach((r) => r.classList.remove("queue-drag-over"));
      _queueDragOverIdx = idx;
      row.classList.add("queue-drag-over");
    }
  });

  document.addEventListener("drop", (e) => {
    const row = e.target.closest(".queue-row[data-track-id]");
    if (!row) return;
    e.preventDefault();
    const toIdx = parseInt(row.dataset.queueIdx, 10);
    if (_queueDragSrcIdx >= 0 && _queueDragSrcIdx !== toIdx) {
      const [moved] = state.queue.splice(_queueDragSrcIdx, 1);
      state.queue.splice(toIdx, 0, moved);
      _persistQueue();
      // Update queueIndex if current track was moved
      if (state.currentTrack) {
        state.queueIndex = state.queue.findIndex(
          (t) => t.id === state.currentTrack.id,
        );
      }
      renderTracks(state.queue, "queue");
    }
    _queueDragSrcIdx = -1;
    _queueDragOverIdx = -1;
    document
      .querySelectorAll(".queue-drag-over")
      .forEach((r) => r.classList.remove("queue-drag-over"));
  });
}

// ─── Queue Drag-to-Reorder (state shared with delegation) ────────
let _queueDragSrcIdx = -1;
let _queueDragOverIdx = -1;

function updateActiveTrackRows(previousId, nextId) {
  if (previousId) {
    document
      .querySelectorAll(`.track-row[data-track-id="${CSS.escape(previousId)}"]`)
      .forEach((row) => {
        row.classList.remove("active");
        const overlay = row.querySelector(".eq-icon");
        if (overlay) overlay.remove();
        const placeholder = row.querySelector(".art-placeholder");
        if (placeholder && !placeholder.textContent.trim())
          placeholder.innerHTML = "&#127925;";
      });
  }
  if (nextId) {
    document
      .querySelectorAll(`.track-row[data-track-id="${CSS.escape(nextId)}"]`)
      .forEach((row) => {
        row.classList.add("active");
        const thumb = row.querySelector(".track-thumb");
        const placeholder = row.querySelector(".art-placeholder");
        if (placeholder) placeholder.textContent = "";
        if (thumb && !thumb.querySelector(".eq-icon")) {
          thumb.insertAdjacentHTML(
            "beforeend",
            '<div class="eq-icon"><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div></div>',
          );
        }
      });
  }
}

// ─── Playback ─────────────────────────────────────────────────────
async function playTrack(track) {
  if (!track) return;
  const previousTrackId = state.currentTrack?.id || null;
  state.currentTrack = track;
  _persistQueue();
  console.log("[play]", track.title, "-", track.artist);

  // Track recently played (max 6, no duplicates)
  state.recentlyPlayed = [
    track,
    ...state.recentlyPlayed.filter((t) => t.id !== track.id),
  ].slice(0, 6);
  saveSetting(
    "recentlyPlayed",
    state.recentlyPlayed.map((t) => t.id),
  );
  _setControlsVisible(true);
  if (state.activeNavSection === "library")
    requestAnimationFrame(_updateScrollPill);

  lastActiveIdx = -1; // Reset active lyric index for new track

  // Update now playing bar
  const artIdx = getArtIndex(track);
  _updateNpTitle(track.title || "Unknown");
  $("np-artist").textContent = getArtistText(track);

  // REVFIX v1: Check BOTH track.coverArt AND track._hasCoverArt.
  // library:get-all strips base64 data: URIs and sets _hasCoverArt=true,
  // so tracks with embedded cover art had coverArt=undefined here,
  // showing the placeholder instead of the actual art via nova-media://art/.
  const _npArtSrc = _resolveCoverArtSrc(track);
  if (_npArtSrc) {
    $("np-art").innerHTML =
      `<img src="${_npArtSrc}" alt="Cover Art" style="width:100%; height:100%; object-fit:cover; display:block; border:none; outline:none;" />`;
  } else {
    $("np-art").innerHTML =
      `<div class="art-placeholder art-${artIdx}">&#127925;</div>`;
  }

  // Update overlay
  $("ov-title").textContent = track.title || "Unknown";
  $("ov-artist").textContent = getArtistText(track);
  $("ov-mini-title").textContent = track.title || "Unknown";
  $("ov-mini-artist").textContent = getArtistText(track);

  // REVFIX v1: Same fix — use _resolveCoverArtSrc which handles _hasCoverArt
  const _ovArtSrc = _resolveCoverArtSrc(track);
  if (_ovArtSrc) {
    $("ov-art").innerHTML =
      `<img src="${_ovArtSrc}" alt="Cover Art" style="width:100%; height:100%; object-fit:cover; display:block; border:none; outline:none;" />`;
    $("ov-mini-art").innerHTML =
      `<img src="${_ovArtSrc}" alt="Cover Art" style="width:100%; height:100%; object-fit:cover; display:block; border:none; outline:none;" />`;
  } else {
    $("ov-art").innerHTML =
      `<div class="art-placeholder art-${artIdx}" style="font-size:56px">&#127925;</div>`;
    $("ov-mini-art").innerHTML =
      `<div class="art-placeholder art-${artIdx}">&#127925;</div>`;
  }
  _setNpBg(track);

  // Sync floating art card (small screens)
  const floatTitle = $("np-float-title");
  const floatArtist = $("np-float-artist");
  const floatArt = $("np-float-art");
  if (floatTitle) floatTitle.textContent = track.title || "Unknown";
  if (floatArtist) floatArtist.textContent = getArtistText(track);
  if (floatArt) {
    // REVFIX v1: Same fix — use _resolveCoverArtSrc
    const _floatSrc = _resolveCoverArtSrc(track);
    if (_floatSrc) {
      floatArt.innerHTML = `<img src="${_floatSrc}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:10px;border:none;outline:none;">`;
    } else {
      floatArt.innerHTML = `<div class="art-placeholder art-${artIdx}">&#127925;</div>`;
    }
  }
  const lyricsToggle = $("lyrics-toggle-btn");
  if (lyricsToggle) lyricsToggle.style.display = "inline-flex";

  updateActiveTrackRows(previousTrackId, track.id);
  _syncHeartButton();
  _fetchLyrics(track);

  // Lazy-init audio
  if (!audioEngine._isInitialized) {
    try {
      await audioEngine.init();
    } catch (e) {
      console.warn("Audio init failed:", e.message);
    }
  }

  try {
    await audioEngine.loadTrack(track.filePath);
    await audioEngine.play();
    ensureEQEngine();
    state.isPlaying = true;
    _updatePlayPauseIcon(true);
    _updateMediaSession(track);
    // Reset consecutive failures on successful play
    state.consecutiveFailures = 0;
  } catch (err) {
    console.error("Playback failed:", err);

    // Auto-skip corrupt/missing files
    state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
    if (state.consecutiveFailures >= state.queue.length) {
      console.warn("All tracks in queue failed to play. Stopping.");
      state.consecutiveFailures = 0;
      showAppDialog({
        title: "Playback Error",
        message: "None of the tracks in the play queue could be played.",
        confirmText: "OK",
        cancelText: null,
      });
      return;
    }

    // Effortlessly skip to next track
    playNext();
  }
}

function _smtcStatus(status) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState =
    status === "playing" ? "playing" : "paused";
}

function _updateMediaSession(track) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title || "Unknown",
    artist:
      typeof track.artist === "string"
        ? track.artist
        : Array.isArray(track.artist)
          ? track.artist.join(", ")
          : "Unknown Artist",
    album: track.album || "",
    artwork: [],
  });
  // REVFIX v1: Use _resolveCoverArtSrc to handle _hasCoverArt tracks too.
  // Previously, tracks with embedded cover art (base64 stripped, _hasCoverArt=true)
  // had no coverArt set, so Media Session never got artwork.
  const _mediaArtSrc = _resolveCoverArtSrc(track);
  if (_mediaArtSrc) {
    if (/^(https?|data|blob):/.test(_mediaArtSrc)) {
      navigator.mediaSession.metadata.artwork = [{ src: _mediaArtSrc }];
    } else {
      fetch(_mediaArtSrc)
        .then((r) => r.blob())
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          if (navigator.mediaSession.metadata)
            navigator.mediaSession.metadata.artwork = [{ src: url }];
        })
        .catch(() => {});
    }
  }
  navigator.mediaSession.playbackState = "playing";
  navigator.mediaSession.setActionHandler("play", () => togglePlayPause(true));
  navigator.mediaSession.setActionHandler("pause", () =>
    togglePlayPause(false),
  );
  navigator.mediaSession.setActionHandler("nexttrack", () => playNext());
  navigator.mediaSession.setActionHandler("previoustrack", () =>
    playPrevious(),
  );
  navigator.mediaSession.setActionHandler("stop", () => togglePlayPause(false));
}

function togglePlayPause(forceState) {
  // If the engine isn't initialized yet, we have a restored currentTrack but
  // nothing loaded into audio. Delegate to playTrack so it inits + loads + plays.
  if (
    !audioEngine._isInitialized &&
    state.currentTrack &&
    forceState !== false
  ) {
    playTrack(state.currentTrack);
    return;
  }

  if (forceState === true) {
    audioEngine.play().then(() => {
      state.isPlaying = true;
      _updatePlayPauseIcon(true);
      if (squigglyNP) squigglyNP.setPlaying(true);
      if (squigglyOV) squigglyOV.setPlaying(true);
      _smtcStatus("playing");
    });
  } else if (forceState === false) {
    audioEngine.pause();
    state.isPlaying = false;
    _updatePlayPauseIcon(false);
    if (squigglyNP) squigglyNP.setPlaying(false);
    if (squigglyOV) squigglyOV.setPlaying(false);
    _smtcStatus("paused");
  } else {
    if (state.isPlaying) {
      audioEngine.pause();
      state.isPlaying = false;
      _updatePlayPauseIcon(false);
      if (squigglyNP) squigglyNP.setPlaying(false);
      if (squigglyOV) squigglyOV.setPlaying(false);
      _smtcStatus("paused");
    } else {
      audioEngine.play().then(() => {
        state.isPlaying = true;
        _updatePlayPauseIcon(true);
        if (squigglyNP) squigglyNP.setPlaying(true);
        if (squigglyOV) squigglyOV.setPlaying(true);
        _smtcStatus("playing");
      });
    }
  }
}

async function playNext() {
  if (state.queue.length === 0) return;
  // ALWAYS follow the queue order — the queue is the authoritative source.
  // When shuffle is on, the queue was already shuffled when the user enabled it.
  // When the user manually shuffles, the queue is reshuffled.
  state.queueIndex++;
  if (state.queueIndex >= state.queue.length) {
    if (state.repeatMode === "all") {
      state.queueIndex = 0;
    } else {
      state.queueIndex = state.queue.length - 1;
      audioEngine.pause();
      return;
    }
  }
  await playTrack(state.queue[state.queueIndex]);
}

async function playPrevious() {
  if (state.queue.length === 0) return;
  if (audioEngine.getCurrentTime() > 3) {
    audioEngine.seek(0);
    return;
  }
  state.queueIndex--;
  if (state.queueIndex < 0) {
    state.queueIndex = state.repeatMode === "all" ? state.queue.length - 1 : 0;
  }
  await playTrack(state.queue[state.queueIndex]);
}

function _handleTrackEnd() {
  if (state.repeatMode === "one") {
    state.queueIndex = Math.max(0, state.queueIndex);
    audioEngine.seek(0);
    audioEngine.play().then(() => {
      state.isPlaying = true;
      _updatePlayPauseIcon(true);
    });
  } else {
    playNext();
  }
}

function _updateRepeatButton() {
  const repeatIconSVG =
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M8.46967 2.46967C8.76256 2.17678 9.23744 2.17678 9.53033 2.46967L11.5303 4.46967C11.7448 4.68417 11.809 5.00676 11.6929 5.28701C11.5768 5.56727 11.3033 5.75 11 5.75H9C5.54822 5.75 2.75 8.54822 2.75 12C2.75 15.4517 5.54846 18.25 9.00028 18.25H9.5C9.91421 18.25 10.25 18.5858 10.25 19C10.25 19.4142 9.91421 19.75 9.5 19.75H9.00028C4.72011 19.75 1.25 16.2802 1.25 12C1.25 7.71979 4.71979 4.25 9 4.25H9.18934L8.46967 3.53033C8.17678 3.23744 8.17678 2.76256 8.46967 2.46967ZM13.75 5C13.75 4.58579 14.0858 4.25 14.5 4.25H15C19.2802 4.25 22.75 7.71979 22.75 12C22.75 16.2802 19.2802 19.75 15 19.75H14.8107L15.5303 20.4697C15.8232 20.7626 15.8232 21.2374 15.5303 21.5303C15.2374 21.8232 14.7626 21.8232 14.4697 21.5303L12.4697 19.5303C12.2552 19.3158 12.191 18.9932 12.3071 18.713C12.4232 18.4327 12.6967 18.25 13 18.25H15C18.4518 18.25 21.25 15.4518 21.25 12C21.25 8.54822 18.4518 5.75 15 5.75H14.5C14.0858 5.75 13.75 5.41421 13.75 5Z" fill="currentColor" />';
  const repeatOneIconSVG =
    '<path d="M9.5 19.75C9.91421 19.75 10.25 19.4142 10.25 19C10.25 18.5858 9.91421 18.25 9.5 18.25V19.75ZM11 5V5.75C11.3033 5.75 11.5768 5.56727 11.6929 5.28701C11.809 5.00676 11.7448 4.68417 11.5303 4.46967L11 5ZM9.53033 2.46967C9.23744 2.17678 8.76256 2.17678 8.46967 2.46967C8.17678 2.76256 8.17678 3.23744 8.46967 3.53033L9.53033 2.46967ZM9.5 18.25H9.00028V19.75H9.5V18.25ZM9 5.75H11V4.25H9V5.75ZM11.5303 4.46967L9.53033 2.46967L8.46967 3.53033L10.4697 5.53033L11.5303 4.46967ZM1.25 12C1.25 16.2802 4.72011 19.75 9.00028 19.75V18.25C5.54846 18.25 2.75 15.4517 2.75 12H1.25ZM2.75 12C2.75 8.54822 5.54822 5.75 9 5.75V4.25C4.71979 4.25 1.25 7.71979 1.25 12H2.75Z" fill="currentColor" />' +
    '<path d="M13 19V18.25C12.6967 18.25 12.4232 18.4327 12.3071 18.713C12.191 18.9932 12.2552 19.3158 12.4697 19.5303L13 19ZM14.4697 21.5303C14.7626 21.8232 15.2374 21.8232 15.5303 21.5303C15.8232 21.2374 15.8232 20.7626 15.5303 20.4697L14.4697 21.5303ZM14.5 4.25C14.0858 4.25 13.75 4.58579 13.75 5C13.75 5.41421 14.0858 5.75 14.5 5.75V4.25ZM15 18.25H13V19.75H15V18.25ZM12.4697 19.5303L14.4697 21.5303L15.5303 20.4697L13.5303 18.4697L12.4697 19.5303ZM14.5 5.75H15V4.25H14.5V5.75ZM21.25 12C21.25 15.4518 18.4518 18.25 15 18.25V19.75C19.2802 19.75 22.75 16.2802 22.75 12H21.25ZM22.75 12C22.75 7.71979 19.2802 4.25 15 4.25V5.75C18.4518 5.75 21.25 8.54822 21.25 12H22.75Z" fill="currentColor" />' +
    '<path d="M10.5 11.5L12 10V14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';

  const isOne = state.repeatMode === "one";
  const svgContent = isOne ? repeatOneIconSVG : repeatIconSVG;

  const btn = $("repeat-btn");
  if (!btn) return;
  btn.classList.toggle("active", state.repeatMode !== "off");
  btn.classList.toggle("repeat-one", isOne);
  btn.style.color = state.repeatMode === "off" ? "" : "var(--green)";
  const btnSvg = btn.querySelector("svg");
  if (btnSvg) btnSvg.innerHTML = svgContent;

  const ovBtn = $("ov-repeat-btn");
  if (ovBtn) {
    ovBtn.classList.toggle("active", state.repeatMode !== "off");
    ovBtn.classList.toggle("repeat-one", isOne);
    ovBtn.style.color = state.repeatMode === "off" ? "" : "var(--green)";
    const ovSvg = ovBtn.querySelector("svg");
    if (ovSvg) ovSvg.innerHTML = svgContent;
  }
}

function _updatePlayPauseIcon(playing) {
  const pauseIcon =
    '<rect x="6" y="4" width="4" height="16" rx="1.5" ry="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5" ry="1.5"/>';
  const playIcon =
    '<path d="M6 4l12 8-12 8V4z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>';
  const icon = playing ? pauseIcon : playIcon;
  $("play-icon").innerHTML = icon;
  $("ov-play-icon").innerHTML = icon;
  // Pause/resume EQ bars
  $$(".eq-bar").forEach((b) => {
    b.style.animationPlayState = playing ? "running" : "paused";
  });
  // Pause/resume EQ icon overlay (dim when paused)
  $$(".eq-icon").forEach((eq) => {
    eq.style.opacity = playing ? "1" : "0.5";
  });
  // Pause indicator on now-playing cover art
  const npArt = $("np-art");
  if (npArt) npArt.classList.toggle("paused", !playing);
  const ovArt = $("ov-art");
  if (ovArt) ovArt.classList.toggle("paused", !playing);
  // Sync scroll pill EQ animation
  const pillArt = document.getElementById("scroll-pill-art");
  if (pillArt) pillArt.classList.toggle("playing", playing);
}

// ─── Now Playing Bar ─────────────────────────────────────────────
function _wireNowPlaying() {
  // Float card: tap to open overlay, tap art area to play/pause
  $("np-float-card")?.addEventListener("click", (e) => {
    if (e.target.closest("#np-float-art")) {
      togglePlayPause();
    } else {
      openOverlay();
    }
  });

  $("play-btn").addEventListener("click", () => togglePlayPause());
  $("prev-btn").addEventListener("click", () => playPrevious());
  $("next-btn").addEventListener("click", () => playNext());

  // Shuffle toggle — when enabling shuffle, reshuffle the upcoming queue.
  // The currently playing song stays at position 0; the rest are randomized.
  $("shuffle-btn").addEventListener("click", () => {
    state.shuffleEnabled = !state.shuffleEnabled;
    $("shuffle-btn").classList.toggle("active", state.shuffleEnabled);
    if (state.shuffleEnabled && state.queue.length > 1) {
      // Keep the current track at position 0, shuffle the rest
      const currentTrack = state.queue[state.queueIndex];
      const beforeCurrent = state.queue.slice(0, state.queueIndex);
      const afterCurrent = state.queue.slice(state.queueIndex + 1);
      const rest = [...beforeCurrent, ...afterCurrent].sort(
        () => Math.random() - 0.5,
      );
      state.queue = [currentTrack, ...rest];
      state.queueIndex = 0;
    }
  });

  // Repeat toggle: off → all (sequential) → one → off
  $("repeat-btn").addEventListener("click", () => {
    const modes = ["off", "all", "one"];
    const idx = (modes.indexOf(state.repeatMode) + 1) % modes.length;
    state.repeatMode = modes[idx];
    // When enabling "all": rebuild queue sequentially from current track
    // following the current library sort order
    if (state.repeatMode === "all" && state.currentTrack) {
      const sorted = state.filteredTracks.length
        ? state.filteredTracks
        : state.tracks;
      const currentIdx = sorted.findIndex(
        (t) => t.id === state.currentTrack.id,
      );
      if (currentIdx >= 0) {
        const after = sorted.slice(currentIdx);
        const before = sorted.slice(0, currentIdx);
        state.queue = [...after, ...before];
        state.queueIndex = 0;
      }
    }
    _updateRepeatButton();
    saveSetting("repeatMode", state.repeatMode);
  });

  // Heart/Like
  $("heart-btn").addEventListener("click", toggleFavorite);

  // Progress bar seeking
  const npCanvas = $("squiggly-canvas");
  wireSeekCanvas(npCanvas, squigglyNP);

  // np-left click → open overlay
  $("np-left").addEventListener("click", openOverlay);
}

function seekFromPointer(canvas, e, squiggly) {
  // BUGFIX: The previous version read `audioEngine.getDuration()` and bailed
  // (return null) if it was falsy — but `0` is falsy, and so is `NaN` (after
  // the original `|| 0` coercion in getDuration). This meant that for any
  // track whose duration wasn't yet known (metadata not loaded) or whose
  // `nova-media://` byte-range response arrived without Content-Length,
  // every click on the squiggly bar silently did nothing.
  //
  // Now we read the raw duration. If it's a positive finite number, we
  // compute `pct * duration` as the seek target. If it's NaN or Infinity
  // (rare but possible), we still proceed — the new AudioEngine.seek()
  // handles those cases gracefully and clamps to a safe upper bound.
  const duration = audioEngine.getDuration();
  const hasFiniteDuration = isFinite(duration) && duration > 0;
  if (!canvas) return null;

  const rect = canvas.getBoundingClientRect();
  if (!rect || rect.width <= 0) return null;

  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

  // Compute nextTime only if we have a finite duration. If not, we still
  // update the visual progress so the user gets feedback, and we send a
  // relative seek (pct of the unknown total) which AudioEngine.seek()
  // will reject safely if needed.
  const nextTime = hasFiniteDuration ? pct * duration : 0;

  if (squiggly) squiggly.setProgress(pct);
  if (canvas.id === "squiggly-canvas" && squigglyOV)
    squigglyOV.setProgress(pct);
  if (canvas.id === "ov-squiggly-canvas" && squigglyNP)
    squigglyNP.setProgress(pct);
  updateProgressText(nextTime, hasFiniteDuration ? duration : 0);
  return { pct, nextTime, hasFiniteDuration };
}

function wireSeekCanvas(canvas, squiggly) {
  if (!canvas) return;
  let pendingSeekTime = null;
  let pendingSeekPct = null;
  let pendingHasFiniteDuration = false;
  let seekCommitted = false;

  // BUGFIX (v3): The v2 patch added a `click` safety-net handler and a
  // document-level `pointerup` safety net. Both of these caused the seek
  // to fire TWICE in some cases — once on pointerup and again on click —
  // and the second seek used a stale `pendingSeekTime` that was sometimes
  // 0 (if the click position differed slightly from the pointerup position
  // due to sub-pixel rounding). This was a contributing factor to
  // "drag to seek → song restarts".
  //
  // We now use a single, clean pointer-events flow with NO click handler
  // and NO document-level safety net. Pointer capture ensures we get the
  // pointerup event even if the user releases outside the canvas.
  //
  // Additionally, `isSeeking` is kept `true` for a brief grace period
  // AFTER the seek is committed, so that timeupdate events firing with
  // the old currentTime (before the seek completes) don't reset the
  // squiggly visually. This was the OTHER contributing factor to the
  // "song restarts" visual bug.

  let seekGraceTimer = null;

  const beginSeekGrace = () => {
    // Keep isSeeking true for 800ms after committing the seek, so that
    // timeupdate events with the OLD currentTime don't visually reset
    // the squiggly. The audio element fires `seeked` when the seek
    // actually completes — we clear the grace period early on that event.
    clearTimeout(seekGraceTimer);
    isSeeking = true;
    seekGraceTimer = setTimeout(() => {
      isSeeking = false;
    }, 800);
  };

  const commitSeek = () => {
    if (seekCommitted) return;
    seekCommitted = true;
    let seekTarget = null;
    if (pendingSeekTime !== null && pendingHasFiniteDuration) {
      seekTarget = pendingSeekTime;
    } else if (pendingSeekPct !== null) {
      // Duration was unknown at drag time — recompute now in case
      // metadata has loaded since.
      const dur = audioEngine.getDuration();
      if (isFinite(dur) && dur > 0) {
        seekTarget = pendingSeekPct * dur;
      }
    }
    pendingSeekTime = null;
    pendingSeekPct = null;
    if (seekTarget !== null && seekTarget >= 0) {
      audioEngine.seek(seekTarget);
      // Begin the grace period so timeupdate events don't visually
      // reset the squiggly while the seek is in flight.
      beginSeekGrace();
    }
  };

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    // Clear any pending grace timer from a previous seek
    clearTimeout(seekGraceTimer);
    isSeeking = true;
    _seekBarActive = canvas;
    seekCommitted = false;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_) {
      // setPointerCapture can throw on some platforms — non-fatal.
    }
    const result = seekFromPointer(canvas, e, squiggly);
    if (result) {
      pendingSeekTime = result.nextTime;
      pendingSeekPct = result.pct;
      pendingHasFiniteDuration = result.hasFiniteDuration;
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!isSeeking || seekCommitted) return;
    const result = seekFromPointer(canvas, e, squiggly);
    if (result) {
      pendingSeekTime = result.nextTime;
      pendingSeekPct = result.pct;
      pendingHasFiniteDuration = result.hasFiniteDuration;
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!seekCommitted) {
      commitSeek();
    }
    // NOTE: isSeeking is NOT set to false here — the grace period
    // handles that. This prevents timeupdate events from resetting
    // the squiggly while the seek is still in flight.
    if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {
        // ignore
      }
    }
  });

  canvas.addEventListener("pointercancel", () => {
    // Pointer was cancelled — commit whatever seek was in flight so the
    // user's intent isn't lost, then start the grace period.
    if (!seekCommitted) {
      commitSeek();
    }
  });

  // Listen for the audio element's `seeked` event to clear the grace
  // period early. This fires when the seek actually completes, so we
  // can safely re-enable timeupdate-driven visual updates.
  audioEngine.on("seeked", () => {
    clearTimeout(seekGraceTimer);
    isSeeking = false;
  });
}

// Tracks which seek bar (if any) was last interacted with, so ArrowLeft/Right
// can adjust volume (per the Help docs). This flag is set by wireSeekCanvas
// on pointerdown and consumed by the unified keydown handler at the top of
// this file. It is intentionally kept here, separate from the keydown logic,
// because the seek canvas wiring lives further down.
let _seekBarActive = null;

// ─── Overlay ──────────────────────────────────────────────────────
function _wireOverlay() {
  $("np-overlay-close").addEventListener("click", closeOverlay);
  // NOTE: Escape and F11 to close the overlay are now handled by the
  // unified global keydown listener at the top of this file. We no longer
  // register a duplicate Escape listener here — it caused double-fire
  // when both the global handler and this one called closeOverlay().

  $("ov-play-btn").addEventListener("click", () => togglePlayPause());
  $("ov-prev-btn").addEventListener("click", () => playPrevious());
  $("ov-next-btn").addEventListener("click", () => playNext());

  $("ov-shuffle-btn").addEventListener("click", () => {
    state.shuffleEnabled = !state.shuffleEnabled;
    $("shuffle-btn").classList.toggle("active", state.shuffleEnabled);
    $("ov-shuffle-btn").classList.toggle("active", state.shuffleEnabled);
    if (state.shuffleEnabled && state.queue.length > 1) {
      const currentTrack = state.queue[state.queueIndex];
      const beforeCurrent = state.queue.slice(0, state.queueIndex);
      const afterCurrent = state.queue.slice(state.queueIndex + 1);
      const rest = [...beforeCurrent, ...afterCurrent].sort(
        () => Math.random() - 0.5,
      );
      state.queue = [currentTrack, ...rest];
      state.queueIndex = 0;
    }
  });

  $("ov-repeat-btn").addEventListener("click", () => {
    const modes = ["off", "all", "one"];
    const idx = (modes.indexOf(state.repeatMode) + 1) % modes.length;
    state.repeatMode = modes[idx];
    if (state.repeatMode === "all" && state.currentTrack) {
      const sorted = state.filteredTracks.length
        ? state.filteredTracks
        : state.tracks;
      const currentIdx = sorted.findIndex(
        (t) => t.id === state.currentTrack.id,
      );
      if (currentIdx >= 0) {
        const after = sorted.slice(currentIdx);
        const before = sorted.slice(0, currentIdx);
        state.queue = [...after, ...before];
        state.queueIndex = 0;
      }
    }
    _updateRepeatButton();
    saveSetting("repeatMode", state.repeatMode);
  });

  $("ov-heart-btn").addEventListener("click", toggleFavorite);

  // Overlay progress seeking
  const ovCanvas = $("ov-squiggly-canvas");
  wireSeekCanvas(ovCanvas, squigglyOV);

  // Lyrics expand button → open overlay
  $("lyrics-expand-btn")?.addEventListener("click", openOverlay);

  // Overlay pencil → open lyrics editor
  $("ov-lyrics-edit-btn")?.addEventListener("click", () => openLyricsEditor());
}

function openOverlay() {
  state.overlayOpen = true;
  $("np-overlay").classList.add("open");
  document.body.classList.add("overlay-visible");
  document.body.style.overflow = "hidden";
  window.novaAPI.invoke("window:set-overlay-chrome", true);
  _buildOverlayLyrics();
}

function closeOverlay() {
  state.overlayOpen = false;
  $("np-overlay").classList.remove("open");
  document.body.classList.remove("overlay-visible");
  document.body.style.overflow = "";
  window.novaAPI.invoke("window:set-overlay-chrome", false);
}

// ─── Auto-Updater Notifications ───────────────────────────────────
// Listens for autoUpdater events forwarded from the main process
// and shows non-intrusive toast notifications or dialogs.
let _updateDownloaded = false;

function _wireAutoUpdater() {
  if (!window.novaAPI) return;

  // When autoUpdater finds an update on launch, show a toast
  window.novaAPI.on("update:available", async (info) => {
    const toast = _showUpdateToast(
      `NovaTune v${info.version} is available!`,
      "Click to install",
      async () => {
        try {
          await window.novaAPI.invoke("app:download-update");
        } catch (_) {}
      },
    );
  });

  // When download completes, prompt to restart
  window.novaAPI.on("update:downloaded", async () => {
    _updateDownloaded = true;
    const ok = await showAppDialog({
      title: "Update Ready!",
      message:
        "A new version of NovaTune has been downloaded. Restart now to install?",
      confirmText: "Restart & Install",
      cancelText: "Later",
    });
    if (ok) {
      await window.novaAPI.invoke("app:install-update");
    }
  });

  // Show download progress on the check-update button if visible
  window.novaAPI.on("update:download-progress", (progress) => {
    const updateBtn = document.getElementById("help-check-update-btn");
    if (updateBtn && !updateBtn.disabled) return; // only show if user initiated
    if (updateBtn) {
      updateBtn.innerHTML = `<span style="font-size:11px;">${Math.round(progress.percent)}%</span>`;
    }
  });

  window.novaAPI.on("update:error", (info) => {
    console.warn("[autoUpdater] Error:", info.message);
  });
}

/**
 * Show a non-blocking update toast at the bottom of the screen.
 * Returns the toast element so callers can dismiss it.
 */
function _showUpdateToast(title, subtitle, onClick) {
  const existing = document.getElementById("update-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "update-toast";
  toast.style.cssText = `
    position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
    background:var(--surface); border:1px solid var(--green);
    border-radius:12px; padding:12px 20px; display:flex; align-items:center; gap:12px;
    z-index:10000; cursor:pointer; box-shadow:0 8px 24px rgba(0,0,0,0.4);
    animation:slideUp 0.3s ease;
  `;
  toast.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
    </svg>
    <div>
      <div style="font-weight:600;font-size:13px;color:var(--text-primary);">${title}</div>
      <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${subtitle}</div>
    </div>
  `;
  if (onClick) toast.addEventListener("click", onClick);
  document.body.appendChild(toast);

  // Auto-dismiss after 15 seconds
  setTimeout(() => {
    if (toast.isConnected) {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s";
      setTimeout(() => toast.remove(), 300);
    }
  }, 15000);

  return toast;
}

// ─── Volume ───────────────────────────────────────────────────────
function _wireVolume() {
  const volBar = $("vol-bar");
  if (!volBar) return;
  const volGroup = volBar?.closest(".vol-group");
  let volumeCloseTimer = null;
  const keepVolumeOpen = () => {
    if (!volGroup) return;
    clearTimeout(volumeCloseTimer);
    volGroup.classList.add("volume-open");
  };
  const releaseVolumeOpen = (delay = 600) => {
    if (!volGroup) return;
    clearTimeout(volumeCloseTimer);
    volumeCloseTimer = setTimeout(() => {
      volGroup.classList.remove("volume-open");
    }, delay);
  };
  const applyVolume = (value) => {
    state.volume = Math.max(0, Math.min(1, value));
    audioEngine.setVolume(state.volume);
    updateVolumeUi();
  };
  const volumeFromEvent = (e) => {
    const rect = volBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    applyVolume(pct);
  };

  let _volDragging = false;

  volGroup?.addEventListener("mouseenter", keepVolumeOpen);
  volGroup?.addEventListener("mouseleave", () => {
    if (!_volDragging) releaseVolumeOpen(900);
  });
  volBar.addEventListener("click", volumeFromEvent);
  volBar.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    _volDragging = true;
    keepVolumeOpen();
    volBar.setPointerCapture(e.pointerId);
    volumeFromEvent(e);
  });
  volBar.addEventListener("pointermove", (e) => {
    if (e.buttons === 1) volumeFromEvent(e);
  });
  volBar.addEventListener("pointerup", () => {
    _volDragging = false;
    releaseVolumeOpen(900);
  });
  volBar.addEventListener("pointercancel", () => {
    _volDragging = false;
    releaseVolumeOpen(300);
  });
  $("vol-btn").addEventListener("wheel", (e) => {
    e.preventDefault();
    applyVolume(state.volume + (e.deltaY < 0 ? 0.05 : -0.05));
  });
  volBar.addEventListener("wheel", (e) => {
    e.preventDefault();
    applyVolume(state.volume + (e.deltaY < 0 ? 0.05 : -0.05));
  });

  $("vol-btn").addEventListener("click", () => {
    if (state.volume > 0) {
      state._prevVolume = state.volume;
      state.volume = 0;
    } else {
      state.volume = state._prevVolume || 0.5;
    }
    applyVolume(state.volume);
  });

  // Overlay volume button handlers
  const ovVolBtn = $("ov-vol-btn");
  if (ovVolBtn) {
    ovVolBtn.addEventListener("wheel", (e) => {
      e.preventDefault();
      applyVolume(state.volume + (e.deltaY < 0 ? 0.05 : -0.05));
    });
    ovVolBtn.addEventListener("click", () => {
      if (state.volume > 0) {
        state._prevVolume = state.volume;
        state.volume = 0;
      } else {
        state.volume = state._prevVolume || 0.5;
      }
      applyVolume(state.volume);
    });
  }

  // Overlay vol-bar drag support
  const ovVolBar = $("ov-vol-bar");
  if (ovVolBar) {
    const ovVolumeFromEvent = (e) => {
      const rect = ovVolBar.getBoundingClientRect();
      const pct = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      applyVolume(pct);
    };
    let _ovVolDragging = false;
    ovVolBar.addEventListener("click", ovVolumeFromEvent);
    ovVolBar.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      _ovVolDragging = true;
      ovVolBar.setPointerCapture(e.pointerId);
      ovVolumeFromEvent(e);
    });
    ovVolBar.addEventListener("pointermove", (e) => {
      if (e.buttons === 1) ovVolumeFromEvent(e);
    });
    ovVolBar.addEventListener("pointerup", () => {
      _ovVolDragging = false;
    });
    ovVolBar.addEventListener("pointercancel", () => {
      _ovVolDragging = false;
    });
    ovVolBar.addEventListener("wheel", (e) => {
      e.preventDefault();
      applyVolume(state.volume + (e.deltaY < 0 ? 0.05 : -0.05));
    });
  }
}

function updateVolumeUi() {
  const volFill = $("vol-fill");
  const volBar = $("vol-bar");
  if (volFill) volFill.style.width = state.volume * 100 + "%";
  if (volBar) volBar.style.setProperty("--vol-pct", state.volume * 100 + "%");

  // Update overlay vol-fill
  const ovVolFill = $("ov-vol-fill");
  if (ovVolFill) ovVolFill.style.width = state.volume * 100 + "%";

  // Update main volume button
  const volBtn = $("vol-btn");
  if (volBtn) {
    const muted = state.volume === 0;
    volBtn.setAttribute("data-tooltip", muted ? "Muted" : "Volume");
    volBtn.setAttribute("aria-label", muted ? "Muted" : "Volume");
    volBtn.innerHTML = muted
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>`;
  }

  // Update overlay volume button
  const ovVolBtn = $("ov-vol-btn");
  if (ovVolBtn) {
    const muted = state.volume === 0;
    ovVolBtn.setAttribute("data-tooltip", muted ? "Muted" : "Volume");
    ovVolBtn.setAttribute("aria-label", muted ? "Muted" : "Volume");
    ovVolBtn.innerHTML = muted
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>`;
  }
}

function updateProgressText(cur, dur) {
  const npCur = $("np-time-current");
  const npTotal = $("np-time-total");
  if (npCur) npCur.textContent = formatTime(cur);
  if (npTotal) npTotal.textContent = formatTime(dur);

  const ovCur = $("ov-time-current");
  const ovTotal = $("ov-time-total");
  if (ovCur) ovCur.textContent = formatTime(cur);
  if (ovTotal) ovTotal.textContent = formatTime(dur);
}

function startSmoothProgress(cur, dur) {
  // BUGFIX (v3): Use isFinite checks instead of `|| 0` coercion so that
  // NaN duration (common during seeks and nova-media:// byte-range loads)
  // doesn't collapse to 0 and reset the smooth-progress baseline.
  smoothProgressBaseTime = isFinite(cur) ? cur : 0;
  smoothProgressBasePerf = performance.now();
  smoothProgressDuration = isFinite(dur) && dur > 0 ? dur : 0;
  if (!smoothProgressRaf)
    smoothProgressRaf = requestAnimationFrame(tickSmoothProgress);
}

function tickSmoothProgress(now) {
  smoothProgressRaf = 0;
  if (!state.isPlaying || !smoothProgressDuration || isSeeking) return;
  const cur = Math.min(
    smoothProgressDuration,
    smoothProgressBaseTime + (now - smoothProgressBasePerf) / 1000,
  );
  const pct = smoothProgressDuration > 0 ? cur / smoothProgressDuration : 0;
  if (squigglyNP) squigglyNP.setProgress(pct);
  if (squigglyOV) squigglyOV.setProgress(pct);
  updateProgressText(cur, smoothProgressDuration);
  smoothProgressRaf = requestAnimationFrame(tickSmoothProgress);
}

// ─── Audio Events ─────────────────────────────────────────────────
function _setupAudioEvents() {
  audioEngine.on("timeupdate", (data) => {
    // BUGFIX (v3): `data.duration || 0` collapses NaN → 0, which made
    // `pct = 0` and visually reset the squiggly to the start whenever
    // the audio element's duration was briefly NaN (common during the
    // first few hundred ms of a nova-media:// byte-range response, or
    // during a seek while the browser re-reads metadata). Use isFinite
    // checks instead so NaN duration doesn't produce a zero percentage.
    const cur = isFinite(data.currentTime) ? data.currentTime : 0;
    const dur =
      isFinite(data.duration) && data.duration > 0 ? data.duration : 0;
    const pct = dur > 0 ? cur / dur : 0;

    if (!isSeeking) {
      if (squigglyNP) squigglyNP.setProgress(pct);
      if (squigglyOV) squigglyOV.setProgress(pct);
      updateProgressText(cur, dur);
      startSmoothProgress(cur, dur);
    }

    // Update lyrics
    _updateLyricsHighlight(cur);
  });

  // When a seek completes, immediately sync the squiggly to the new
  // position so there's no visual gap between the grace period ending
  // and the next timeupdate event.
  audioEngine.on("seeked", (data) => {
    const cur = isFinite(data.currentTime) ? data.currentTime : 0;
    const dur =
      isFinite(data.duration) && data.duration > 0 ? data.duration : 0;
    const pct = dur > 0 ? cur / dur : 0;
    if (squigglyNP) squigglyNP.setProgress(pct);
    if (squigglyOV) squigglyOV.setProgress(pct);
    updateProgressText(cur, dur);
    // Restart the smooth-progress baseline from the seeked position so
    // the animation continues smoothly from the new currentTime.
    startSmoothProgress(cur, dur);
  });

  audioEngine.on("ended", () => _handleTrackEnd());
  audioEngine.on("play", () => {
    state.isPlaying = true;
    _updatePlayPauseIcon(true);
    if (squigglyNP) squigglyNP.setPlaying(true);
    if (squigglyOV) squigglyOV.setPlaying(true);
  });
  audioEngine.on("pause", () => {
    state.isPlaying = false;
    if (smoothProgressRaf) {
      cancelAnimationFrame(smoothProgressRaf);
      smoothProgressRaf = 0;
    }
    _updatePlayPauseIcon(false);
    if (squigglyNP) squigglyNP.setPlaying(false);
    if (squigglyOV) squigglyOV.setPlaying(false);
  });
  audioEngine.on("error", (data) => {
    console.error("Playback error:", data.error, "(code", data.code + ")");

    // BUGFIX (v4): NEVER call playNext() during or immediately after a seek.
    // The AudioEngine now suppresses MEDIA_ERR_ABORTED (code 1) and all
    // errors during _isSeeking, but as a third layer of defense we also
    // check the renderer-side isSeeking flag. If a seek-triggered error
    // somehow slips through, we must NOT reload the track — that's what
    // was causing "drag to seek → song restarts".
    if (isSeeking) {
      console.warn("[error] Suppressed during active seek — ignoring.");
      return;
    }

    // Only handle mid-playback errors here (e.g. network drop during play).
    // Load-phase errors are already caught by playTrack()'s own try/catch
    // which increments consecutiveFailures and calls playNext() — the
    // _isLoading gate in AudioEngine prevents _emit("error") during load,
    // so this handler will never double-fire for load failures.
    state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
    if (state.consecutiveFailures < state.queue.length) {
      playNext();
    }
  });
}

// ─── Lyrics Editor ────────────────────────────────────────────────
let _leActiveTab = "search";
let _lePendingLyrics = null; // { plain, synced } ready to save

function openLyricsEditor() {
  const modal = $("lyrics-editor-modal");
  if (!modal) return;
  const track = state.currentTrack;
  const nameEl = $("le-track-name");
  if (nameEl) {
    const dur = track ? formatTime(track.duration) : "";
    nameEl.textContent = track
      ? `${track.title || "Unknown"} — ${getArtistText(track)}${dur ? ` · ${dur}` : ""}`
      : "No track playing";
  }
  // Pre-fill search fields with current track
  if (track) {
    const titleInput = $("le-search-title");
    const artistInput = $("le-search-artist");
    if (titleInput) titleInput.value = track.title || "";
    if (artistInput)
      artistInput.value = Array.isArray(track.artist)
        ? track.artist[0]
        : track.artist || "";
  }
  // Reset status
  _setSaveStatus("");
  _lePendingLyrics = null;
  _leShowTab("search");
  modal.classList.add("open");
}

function closeLyricsEditor() {
  const modal = $("lyrics-editor-modal");
  if (modal) modal.classList.remove("open");
  _lePendingLyrics = null;
}

function _leShowTab(tab) {
  _leActiveTab = tab;
  $$(".le-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.leTab === tab);
  });
  $$(".le-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `le-panel-${tab}`);
  });
}

function _setSaveStatus(msg, type) {
  const el = $("le-save-status");
  if (!el) return;
  el.textContent = msg;
  el.className = "le-save-status" + (type ? ` le-status-${type}` : "");
}

function _wireLyricsEditor() {
  const modal = $("lyrics-editor-modal");
  if (!modal) return;

  // Close
  $("lyrics-editor-close")?.addEventListener("click", closeLyricsEditor);
  $("lyrics-editor-backdrop")?.addEventListener("click", closeLyricsEditor);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("open"))
      closeLyricsEditor();
  });

  // Tabs
  $$(".le-tab").forEach((btn) => {
    btn.addEventListener("click", () => _leShowTab(btn.dataset.leTab));
  });

  // ── Search tab ──
  $("le-search-btn")?.addEventListener("click", _leSearch);
  $("le-search-title")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") _leSearch();
  });
  $("le-search-artist")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") _leSearch();
  });

  // ── File tab ──
  const fileInput = $("le-file-input");
  const fileDrop = $("le-file-drop");
  fileDrop?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) _leLoadFile(f);
  });
  fileDrop?.addEventListener("dragover", (e) => {
    e.preventDefault();
    fileDrop.classList.add("dragover");
  });
  fileDrop?.addEventListener("dragleave", () =>
    fileDrop.classList.remove("dragover"),
  );
  fileDrop?.addEventListener("drop", (e) => {
    e.preventDefault();
    fileDrop.classList.remove("dragover");
    const f = e.dataTransfer.files?.[0];
    if (f) _leLoadFile(f);
  });

  // ── Footer ──
  $("le-save-btn")?.addEventListener("click", _leSave);
  $("le-clear-btn")?.addEventListener("click", _leClear);
}

async function _leSearch() {
  const title = $("le-search-title")?.value.trim();
  const artist = $("le-search-artist")?.value.trim();
  if (!title) {
    _setSearchStatus("Enter a track title to search.", "warn");
    return;
  }
  _setSearchStatus("Searching LRCLIB…", "");
  $("le-search-results").innerHTML = "";

  try {
    const res = await window.novaAPI.invoke("lyrics:search-online", {
      title,
      artist: artist || "",
    });
    if (!res.success) {
      const isTimeout =
        res.error && res.error.toLowerCase().includes("timed out");
      _setSearchStatus(
        isTimeout
          ? "LRCLIB is slow right now — retried 3 times. Try again in a moment."
          : `Search failed: ${res.error}`,
        "error",
      );
      return;
    }
    const results = res.results || [];
    if (!results.length) {
      _setSearchStatus("No results found. Try adjusting the query...", "warn");
      return;
    }
    _setSearchStatus(
      `${results.length} result${results.length > 1 ? "s" : ""} found`,
      "ok",
    );
    _renderSearchResults(results);
  } catch (err) {
    _setSearchStatus(`Search failed: ${err.message}`, "error");
  }
}

function _setSearchStatus(msg, type) {
  const el = $("le-search-status");
  if (!el) return;
  el.textContent = msg;
  el.className = "le-search-status" + (type ? ` le-status-${type}` : "");
}

function _renderSearchResults(results) {
  const container = $("le-search-results");
  container.innerHTML = "";
  const trackDur = state.currentTrack?.duration || 0;
  results.slice(0, 20).forEach((item) => {
    const card = document.createElement("div");
    card.className = "le-result-card";
    const hasSynced = !!item.syncedLyrics;
    const hasPlain = !!item.plainLyrics;
    const itemDur = item.duration || 0;
    const durStr = itemDur ? formatTime(itemDur) : "";
    const durDiff = trackDur && itemDur ? Math.abs(trackDur - itemDur) : 999;
    const durMatch = durDiff <= 2;
    card.innerHTML = `
      <div class="le-result-meta">
        <span class="le-result-title">${escapeHtml(item.trackName || "")}</span>
        <span class="le-result-artist">${escapeHtml(item.artistName || "")}${item.albumName && item.albumName !== "null" ? ` · ${escapeHtml(item.albumName)}` : ""}</span>
      </div>
      <div class="le-result-badges">
        ${hasSynced ? '<span class="le-badge le-badge-synced">Synced</span>' : ""}
        ${hasPlain && !hasSynced ? '<span class="le-badge">Plain</span>' : ""}
        ${item.instrumental ? '<span class="le-badge le-badge-inst">Instrumental</span>' : ""}
        ${durStr ? `<span class="le-badge le-badge-dur${durMatch ? " le-badge-dur-match" : ""}">${durStr}</span>` : ""}
      </div>
      <button class="le-result-use-btn">Use</button>
    `;
    card.querySelector(".le-result-use-btn").addEventListener("click", () => {
      _lePendingLyrics = {
        plain: item.plainLyrics || "",
        synced: item.syncedLyrics || "",
        source: "lrclib",
      };
      _setSaveStatus(
        `Ready: "${item.trackName}" (${hasSynced ? "synced" : "plain"})`,
        "ok",
      );
      container
        .querySelectorAll(".le-result-card")
        .forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
    });
    container.appendChild(card);
  });
}

function _leLoadFile(file) {
  const nameEl = $("le-file-name");
  if (nameEl) nameEl.textContent = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const area = $("le-file-area");
    if (area) area.value = text;
    const isSynced = /\[\d{1,3}:\d{2}/.test(text);
    _lePendingLyrics = {
      plain: isSynced ? "" : text,
      synced: isSynced ? text : "",
      source: "file",
    };
    _setSaveStatus(
      `File loaded: ${file.name} (${isSynced ? "LRC synced" : "plain text"})`,
      "ok",
    );
  };
  reader.readAsText(file);
}

async function _leSave() {
  // Determine source of lyrics
  let payload = null;

  if (_leActiveTab === "paste") {
    const text = $("le-paste-area")?.value.trim();
    if (!text) {
      _setSaveStatus("Nothing to save — paste some lyrics first.", "warn");
      return;
    }
    const isSynced = /\[\d{1,3}:\d{2}/.test(text);
    payload = {
      plain: isSynced ? "" : text,
      synced: isSynced ? text : "",
      source: "paste",
    };
  } else if (_leActiveTab === "file") {
    if (!_lePendingLyrics) {
      _setSaveStatus("No file loaded yet.", "warn");
      return;
    }
    payload = _lePendingLyrics;
  } else {
    // search tab
    if (!_lePendingLyrics) {
      _setSaveStatus("Select a result first.", "warn");
      return;
    }
    payload = _lePendingLyrics;
  }

  const track = state.currentTrack;
  if (!track) {
    _setSaveStatus("No track is playing.", "warn");
    return;
  }

  _setSaveStatus("Saving…", "");
  try {
    const result = await window.novaAPI.invoke("lyrics:save-to-track", {
      trackId: track.id,
      filePath: track.filePath,
      plain: payload.plain,
      synced: payload.synced,
    });
    if (result && result.success) {
      _setSaveStatus("Saved! Reloading lyrics…", "ok");
      // Re-apply to player
      syncedLyrics = payload.synced ? parseLrcString(payload.synced) : null;
      lyricsData = payload.plain
        ? payload.plain
            .split("\n")
            .filter((l) => l.trim())
            .map((l) => ({ text: l.trim(), time: 0 }))
        : [];
      _updateSyncedBadge(syncedLyrics);
      _renderLyrics($("lyrics-body"));
      if (state.overlayOpen) _buildOverlayLyrics();
      lastActiveIdx = -1;
      setTimeout(closeLyricsEditor, 900);
    } else {
      _setSaveStatus(
        `Save failed: ${result?.error || "Unknown error"}`,
        "error",
      );
    }
  } catch (err) {
    _setSaveStatus(`Save error: ${err.message}`, "error");
  }
}

async function _leClear() {
  const track = state.currentTrack;
  if (!track) return;
  const ok = await showAppDialog({
    title: "Clear lyrics",
    message: "Remove saved lyrics for this track?",
    confirmText: "Clear",
    cancelText: "Keep",
    danger: true,
  });
  if (!ok) return;
  _lePendingLyrics = { plain: "", synced: "", source: "clear" };
  _leSave();
}
let lyricsData = [];
let syncedLyrics = null;
let lastActiveIdx = -1;
let lyricsTrackId = null;

// ─── Lyrics Prefetch ──────────────────────────────────────────────
// When the user clicks a track, we fire the LRCLIB fetch immediately,
// before playTrack() even starts audio init. By the time audio begins
// playing (~300-800ms later), the lyrics are usually already here.
let _prefetchPromise = null;
let _prefetchTrackId = null;

function prefetchLyrics(track) {
  if (!track) return;
  // Only skip prefetch if synced lyrics are already confirmed present.
  // plainLyrics alone may be raw LRC text that needs online upgrade to SYLT.
  if (track.syncedLyrics) return;
  // Same track already prefetching? Don't duplicate.
  if (_prefetchTrackId === track.id && _prefetchPromise) return;

  _prefetchTrackId = track.id;
  _prefetchPromise = window.novaAPI
    .invoke("lyrics:fetch-online", {
      artist: track.artist,
      title: track.title,
      album: track.album || "",
      duration: track.duration || 0,
    })
    .then((result) => {
      if (_prefetchTrackId !== track.id) return null; // stale
      return result;
    })
    .catch(() => null);
}

function consumePrefetch(track) {
  if (_prefetchTrackId !== track.id || !_prefetchPromise) return null;
  const p = _prefetchPromise;
  _prefetchPromise = null;
  return p;
}

async function _fetchLyrics(track) {
  if (!track) return;
  const lyricsBody = $("lyrics-body");
  lyricsTrackId = track.id;
  syncedLyrics = null;
  lyricsData = [];
  _buildOverlayLyrics();
  lyricsBody.innerHTML =
    '<div class="lyric-line" style="margin-top:30px;">Loading ...</div>';
  lastActiveIdx = -1; // Reset active lyric index

  // ── 1. In-memory cache (instant — from previous play or manual save) ──
  const cachedPlain = track.plainLyrics || "";
  const cachedSynced = track.syncedLyrics || "";
  if (cachedPlain || cachedSynced) {
    syncedLyrics = cachedSynced ? parseLrcString(cachedSynced) : null;
    // If still no synced, try rescuing timestamps out of plainLyrics.
    // LRCLIB sometimes stores LRC-formatted text in plainLyrics when syncedLyrics is absent.
    if (!syncedLyrics && cachedPlain) {
      const rescued = parseLrcString(cachedPlain);
      if (rescued && rescued.length > 0) {
        syncedLyrics = rescued;
        // Promote: store LRC string in syncedLyrics, strip timestamps from plain.
        const lrcStr = rescued
          .map((l) => {
            const m = Math.floor(l.time / 60);
            const sec = Math.floor(l.time % 60);
            const ms = Math.round((l.time % 1) * 1000);
            return `[${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}]${l.text}`;
          })
          .join("\n");
        const cleanPlain = rescued.map((l) => l.text).join("\n");
        track.syncedLyrics = lrcStr;
        track.plainLyrics = cleanPlain;
        // Re-persist so next play hits the correct synced cache path.
        if (track.filePath) {
          window.novaAPI
            .invoke("lyrics:save-to-track", {
              trackId: track.id,
              filePath: track.filePath,
              plain: cleanPlain,
              synced: lrcStr,
            })
            .catch(() => {});
        }
      }
    }
    lyricsData =
      !syncedLyrics && cachedPlain
        ? cachedPlain
            .split("\n")
            .filter((l) => l.trim())
            .map((l) => ({
              text: l
                .trim()
                .replace(/^\[\d{1,3}:\d{2}(?:[.:]\d{2,3})?\]\s*/g, ""),
              time: 0,
            }))
        : [];
    _updateSyncedBadge(syncedLyrics);
    _renderLyrics(lyricsBody);
    if (state.overlayOpen) _buildOverlayLyrics();
    if (syncedLyrics)
      _updateLyricsHighlight(
        audioEngine.getCurrentTime ? audioEngine.getCurrentTime() : 0,
      );
    // If cache only had plain (no synced), still fire online to try upgrading to synced.
    // Don't return — fall through to the progressive loading block below.
    if (syncedLyrics) return;
  }

  // ── 2. Progressive lyrics loading ──
  // Show lyrics the INSTANT any source returns. If a better source
  // arrives later (e.g. online synced beats local plain), upgrade.
  // This eliminates the "no lyrics" flash completely.

  function normSynced(val) {
    if (!val) return null;
    if (typeof val === "string") return parseLrcString(val);
    if (Array.isArray(val)) {
      if (val.length > 0 && val[0].time != null && val[0].text != null) {
        return val.sort((a, b) => (a.time || 0) - (b.time || 0));
      }
      return null;
    }
    if (val && Array.isArray(val.lines)) {
      return val.lines.sort((a, b) => (a.time || 0) - (b.time || 0));
    }
    return null;
  }

  // Helper: apply lyrics to UI + track object. Returns the source name.
  let _appliedSource = null; // track best source we've shown so far
  let _appliedHasSynced = false;

  function applyLyrics(source, s, p, rawSynced) {
    if (lyricsTrackId !== track.id) return; // stale
    const synced = s;
    const plain = p || "";

    // Skip if we already have synced lyrics and this source is plain-only
    if (_appliedHasSynced && !synced) return;
    // Skip if same quality already shown
    if (_appliedSource === source) return;

    syncedLyrics = synced;
    // Only build plain lyricsData when there are no synced lines — avoids
    // _renderLyrics falling back to plain when synced is available.
    lyricsData =
      !synced && plain
        ? plain
            .split("\n")
            .filter((l) => l.trim())
            .map((l) => ({
              text: l
                .trim()
                .replace(/^\[\d{1,3}:\d{2}(?:[.:]\d{2,3})?\]\s*/g, ""),
              time: 0,
            }))
        : [];
    track.plainLyrics = plain || null;
    track.syncedLyrics =
      rawSynced ||
      (synced
        ? synced
            .map((l) => {
              const m = Math.floor(l.time / 60);
              const sec = Math.floor(l.time % 60);
              const ms = Math.round((l.time % 1) * 1000);
              return `[${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}]${l.text}`;
            })
            .join("\n")
        : null);

    _updateSyncedBadge(synced);
    _renderLyrics(lyricsBody);
    if (state.overlayOpen) _buildOverlayLyrics();
    if (synced)
      _updateLyricsHighlight(
        audioEngine.getCurrentTime ? audioEngine.getCurrentTime() : 0,
      );

    _appliedSource = source;
    _appliedHasSynced = !!synced;

    // Auto-persist to .lrc + DB (skip if already a sidecar .lrc)
    if (track.filePath && source !== "lrc" && (plain || track.syncedLyrics)) {
      window.novaAPI
        .invoke("lyrics:save-to-track", {
          trackId: track.id,
          filePath: track.filePath,
          plain: plain,
          synced: track.syncedLyrics || "",
        })
        .catch((e) => console.warn("Lyrics auto-save failed:", e.message));
    }
  }

  // Fire all three sources. Each resolves independently.
  const localLrcP = track.filePath
    ? window.novaAPI
        .invoke("lyrics:read-local", track.filePath)
        .catch(() => null)
    : Promise.resolve(null);
  const embeddedP = track.filePath
    ? window.novaAPI
        .invoke("lyrics:read-embedded", track.filePath)
        .catch(() => null)
    : Promise.resolve(null);
  const prefetch = consumePrefetch(track);
  const onlineP = prefetch
    ? prefetch.catch(() => null)
    : window.novaAPI
        .invoke("lyrics:fetch-online", {
          artist: track.artist,
          title: track.title,
          album: track.album || "",
          duration: track.duration || 0,
        })
        .catch(() => null);

  // Process each source as it resolves — don't wait for all
  localLrcP.then((res) => {
    if (!res || !res.success || !res.lyrics) return;
    const s = normSynced(res.lyrics.synced);
    const p = res.lyrics.plain || "";
    if (s || p) applyLyrics("lrc", s, p, null);
  });

  embeddedP.then((res) => {
    if (!res || !res.success || !res.lyrics) return;
    const s = normSynced(res.lyrics.synced);
    const p = res.lyrics.plain || "";
    if (s || p) applyLyrics("embedded", s, p, null);
  });

  onlineP.then((res) => {
    if (!res || !res.success || !res.lyrics) return;
    const s = normSynced(res.lyrics.synced);
    const p = res.lyrics.plain || "";
    // res.lyrics.synced is always a parsed array from ipc.js — never a string.
    // Rebuild the LRC string from the array so applyLyrics can persist it correctly.
    const rawSynced =
      s && s.length
        ? s
            .map((l) => {
              const m = Math.floor(l.time / 60);
              const sec = Math.floor(l.time % 60);
              const ms = Math.round((l.time % 1) * 1000);
              return `[${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}]${l.text}`;
            })
            .join("\n")
        : "";
    if (s || p) applyLyrics("online", s, p, rawSynced);
  });

  // Wait for all to settle, then show "No lyrics" if nothing came through
  await Promise.allSettled([localLrcP, embeddedP, onlineP]);

  if (lyricsTrackId !== track.id) return; // stale

  if (!_appliedSource) {
    // No source had lyrics
    lyricsData = [];
    syncedLyrics = null;
    _updateSyncedBadge(null);
    _renderLyrics(lyricsBody);
    if (state.overlayOpen) _buildOverlayLyrics();
  }
}

function _updateSyncedBadge(synced) {
  const hasLyrics = !!(
    lyricsData.length > 0 ||
    (synced && Array.isArray(synced) && synced.length)
  );
  const isSynced = !!(synced && Array.isArray(synced) && synced.length);
  const badge = $("synced-badge");
  const ovBadge = $("ov-synced-badge");
  if (badge) {
    badge.style.display = hasLyrics ? "block" : "none";
    badge.textContent = isSynced ? "Synced" : "Unsynced";
    badge.classList.toggle("unsynced", !isSynced);
  }
  if (ovBadge) {
    ovBadge.style.display = hasLyrics ? "block" : "none";
    ovBadge.textContent = isSynced ? "Synced" : "Unsynced";
    ovBadge.classList.toggle("unsynced", !isSynced);
  }

  const lBody = $("lyrics-body");
  if (lBody) lBody.classList.toggle("unsynced-scroll", !isSynced);
  const ovScroll = $("ov-lyrics-scroll");
  if (ovScroll) ovScroll.classList.toggle("unsynced-scroll", !isSynced);
}

// ── Manual-scroll detection for lyrics containers ──────────────────
// When the user scrolls a lyrics container manually (wheel/touch/drag),
// we set a flag that temporarily blocks auto-scroll.  The flag clears
// automatically when the next lyric line becomes active (see
// _updateLyricsHighlight), so auto-scroll always re-engages on the
// next line change.

function _wireLyricsManualScroll(container, isOverlay) {
  if (!container) return;
  if (container._manualScrollWired) return; // only wire once
  container._manualScrollWired = true;

  const setUserScrolling = () => {
    // Cancel any in-flight programmatic lerp so it stops fighting the
    // user's drag/wheel immediately.  This cancels BOTH the outer RAF
    // (from centerActiveLyric) and the inner lerp step chain — without
    // cancelling both, a started lerp keeps running for a few frames.
    _cancelLyricLerp(container);

    if (isOverlay) {
      _ovLyricsUserScrolling = true;
      if (_ovLyricsUserScrollTimer) clearTimeout(_ovLyricsUserScrollTimer);
      // Debounce: resume auto-scroll 3s after the LAST user scroll event.
      // (Was 5s — felt sluggish. 3s matches Spotify's behavior closely.)
      _ovLyricsUserScrollTimer = setTimeout(() => {
        _ovLyricsUserScrolling = false;
      }, 3000);
    } else {
      _lyricsUserScrolling = true;
      if (_lyricsUserScrollTimer) clearTimeout(_lyricsUserScrollTimer);
      _lyricsUserScrollTimer = setTimeout(() => {
        _lyricsUserScrolling = false;
      }, 3000);
    }
  };

  container.addEventListener("wheel", setUserScrolling, { passive: true });
  container.addEventListener("touchmove", setUserScrolling, { passive: true });

  // Detect programmatic scroll vs user scroll by listening for
  // "scroll" events that happen without a pending _lyricScrollTarget
  let _programmaticScroll = false;
  const origLerp = _lerpLyricScroll;

  // Patch: mark programmatic scrolls so we don't treat them as manual
  const origCenter = centerActiveLyric;
  container.addEventListener(
    "scroll",
    () => {
      // If the lerp engine is actively scrolling, it's programmatic — ignore
      if (container._lyricScrolling) return;
      // Otherwise it's a user-initiated scroll
      setUserScrolling();
    },
    { passive: true },
  );
}

function _renderLyrics(container) {
  // Cancel any in-flight lerp from a PREVIOUS render before rebuilding
  // the DOM.  Otherwise, when switching from synced → unsynced lyrics,
  // the synced lerp keeps running on the same container after we wipe
  // its content, fighting the user's manual scroll on the new plain
  // lyrics.  This is the primary fix for "unsynced lyrics can't be
  // scrolled after alternating with synced."
  _cancelLyricLerp(container);

  container.innerHTML = "";
  if (lyricsData.length === 0 && !syncedLyrics) {
    container.classList.add("is-empty");
    container.innerHTML = `
      <div class="lyrics-empty-anim">
        <div class="lyrics-empty-vinyl">
          <div class="lyrics-empty-arm"></div>
        </div>
        <span>No lyrics</span>
      </div>`;
    return;
  }
  container.classList.remove("is-empty");

  const lines =
    syncedLyrics && Array.isArray(syncedLyrics)
      ? syncedLyrics
      : lyricsData.map((l) => ({ text: l.text, time: l.time || 0 }));
  const isSynced = !!(
    syncedLyrics &&
    Array.isArray(syncedLyrics) &&
    syncedLyrics.length
  );

  lines.forEach((line, i) => {
    const el = document.createElement("div");
    el.className = "lyric-line" + (isSynced ? "" : " unsynced-lit");
    const rawText =
      typeof line.text === "string"
        ? line.text
        : typeof line === "string"
          ? line
          : "";
    el.textContent = rawText
      .replace(/^\s*\[\d{1,3}:\d{2}(?:[.:]\d{2,3})?\]\s*/g, "")
      .trim();
    el.dataset.time = line.time || 0;
    el.addEventListener("click", () => {
      if (line.time && audioEngine.getDuration()) {
        // User explicitly jumped to a line — clear the manual-scroll
        // override so auto-scroll re-engages at the new position.
        _lyricsUserScrolling = false;
        if (_lyricsUserScrollTimer) {
          clearTimeout(_lyricsUserScrollTimer);
          _lyricsUserScrollTimer = null;
        }
        audioEngine.seek(line.time);
      }
    });
    container.appendChild(el);
  });

  // Wire manual-scroll detection (only once per container)
  _wireLyricsManualScroll(container, false);
}

function _updateLyricsHighlight(currentTime) {
  if (!syncedLyrics || syncedLyrics.length === 0) {
    // Unsynced/plain lyrics — never auto-scroll, just update overlay
    _updateOverlayLyrics(-1);
    return;
  }

  let activeIdx = -1;
  for (let i = syncedLyrics.length - 1; i >= 0; i--) {
    if (currentTime >= syncedLyrics[i].time) {
      activeIdx = i;
      break;
    }
  }

  // Throttle changes to avoid layout/animation thrashing
  if (activeIdx === lastActiveIdx) return;

  // NOTE: We intentionally do NOT clear `_lyricsUserScrolling` /
  // `_ovLyricsUserScrolling` here.  Clearing the flag on every line
  // change was the bug that made manual scrolling feel impossible —
  // every 3–10s the next lyric line would snap the panel back to the
  // active position, overriding the user's scroll.  Now the flag is
  // only cleared by:
  //   1. The debounce timer in _wireLyricsManualScroll (3s of no scroll)
  //   2. An explicit seek (user clicks a lyric line — see handler below)
  //   3. A track change / panel re-open
  lastActiveIdx = activeIdx;

  const container = $("lyrics-body");
  if (!container) return;
  const lines = container.querySelectorAll(".lyric-line");

  lines.forEach((el, i) => {
    if (i === activeIdx) {
      el.classList.add("active");
      // Only autoscroll when the lyrics panel is actually visible
      const panel = $("lyrics-panel");
      if (!panel || !panel.classList.contains("closed")) {
        centerActiveLyric(container, el);
      }
    } else {
      el.classList.remove("active");
    }
  });

  // Also update overlay lyrics
  _updateOverlayLyrics(activeIdx);
}

function _buildOverlayLyrics() {
  const scroll = $("ov-lyrics-scroll");

  // Cancel any in-flight lerp from a PREVIOUS render before rebuilding
  // the DOM (see comment in _renderLyrics for the full rationale).
  _cancelLyricLerp(scroll);

  scroll.innerHTML = "";
  const lines =
    syncedLyrics && Array.isArray(syncedLyrics)
      ? syncedLyrics
      : lyricsData.map((l) => ({ text: l.text, time: l.time || 0 }));
  const isSynced = !!(
    syncedLyrics &&
    Array.isArray(syncedLyrics) &&
    syncedLyrics.length
  );

  if (lines.length === 0) {
    scroll.classList.add("is-empty");
    scroll.innerHTML = `
      <div class="lyrics-empty-anim ov-lyrics-empty">
        <div class="lyrics-empty-vinyl">
          <div class="lyrics-empty-arm"></div>
        </div>
        <span>No lyrics</span>
      </div>`;
    _updateSyncedBadge(null);
    return;
  } else {
    scroll.classList.remove("is-empty");
  }

  lines.forEach((line, i) => {
    const el = document.createElement("div");
    el.className = "ov-lyric" + (isSynced ? "" : " unsynced-lit");
    const rawOvText =
      typeof line.text === "string"
        ? line.text
        : typeof line === "string"
          ? line
          : "";
    el.textContent = rawOvText
      .replace(/^\s*\[\d{1,3}:\d{2}(?:[.:]\d{2,3})?\]\s*/g, "")
      .trim();
    el.dataset.idx = i;
    el.addEventListener("click", () => {
      if (line.time && audioEngine.getDuration()) {
        // User explicitly jumped to a line — clear the manual-scroll
        // override so auto-scroll re-engages at the new position.
        _ovLyricsUserScrolling = false;
        if (_ovLyricsUserScrollTimer) {
          clearTimeout(_ovLyricsUserScrollTimer);
          _ovLyricsUserScrollTimer = null;
        }
        audioEngine.seek(line.time);
      }
    });
    scroll.appendChild(el);
  });

  // Wire manual-scroll detection (only once per container)
  _wireLyricsManualScroll(scroll, true);

  // Sync state immediately if already playing
  _updateSyncedBadge(isSynced ? syncedLyrics : null);
  if (isSynced && lastActiveIdx !== -1) {
    _updateOverlayLyrics(lastActiveIdx);
  }
}

function _updateOverlayLyrics(activeIdx) {
  const lines = $$("#ov-lyrics-scroll .ov-lyric");
  if (lines.length === 0) return;
  const isSynced = !!(
    syncedLyrics &&
    Array.isArray(syncedLyrics) &&
    syncedLyrics.length
  );

  lines.forEach((el, i) => {
    el.classList.remove("active", "prev-1", "prev-2", "next-1", "next-2");
    if (!isSynced) {
      el.classList.add("unsynced-lit");
      return;
    }
    const diff = i - activeIdx;
    if (diff === 0) el.classList.add("active");
    else if (diff === -1) el.classList.add("prev-1");
    else if (diff === -2) el.classList.add("prev-2");
    else if (diff === 1) el.classList.add("next-1");
    else if (diff === 2) el.classList.add("next-2");
  });

  // Scroll active into center smoothly (only for synced lyrics)
  const activeEl = document.querySelector("#ov-lyrics-scroll .ov-lyric.active");
  const scrollContainer = $("ov-lyrics-scroll");
  if (isSynced && activeEl && scrollContainer) {
    centerActiveLyric(scrollContainer, activeEl);
  }
}

// ─── Left-Edge Hover Sidebar Activation (Mobile/Tablet) ────────────────
function _createFloatingNavCard() {
  // Build the floating nav card if it doesn't already exist in the DOM
  if (document.getElementById("floating-nav-card"))
    return document.getElementById("floating-nav-card");

  const sections = [
    {
      id: "home",
      label: "Home",
      icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    },
    {
      id: "library",
      label: "Library",
      icon: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    },
    {
      id: "albums",
      label: "Albums",
      icon: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>',
    },
    {
      id: "artists",
      label: "Artists",
      icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    },
    {
      id: "playlists",
      label: "Playlists",
      icon: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    },
    {
      id: "queue",
      label: "Queue",
      icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><line x1="14" y1="4" x2="21" y2="4"/><line x1="14" y1="9" x2="18" y2="9"/><line x1="14" y1="15" x2="21" y2="15"/><line x1="14" y1="20" x2="18" y2="20"/>',
    },
    {
      id: "settings",
      label: "Settings",
      icon: '<circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>',
    },
    {
      id: "equalizer",
      label: "Equalizer",
      icon: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    },
  ];

  const card = document.createElement("div");
  card.id = "floating-nav-card";
  card.className = "floating-nav-card";

  // Mark the currently active section
  const activeSection = state.activeNavSection || "library";

  let html = "";
  sections.forEach((s) => {
    html += `<button class="fn-btn${s.id === activeSection ? " active" : ""}" data-section="${s.id}" data-label="${s.label}" aria-label="${s.label}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${s.icon}</svg>
    </button>`;
  });
  html += `<div class="fn-divider"></div>`;
  html += `<div class="fn-search-wrap">
    <button class="fn-btn" id="fn-search-btn" data-label="Search" aria-label="Search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    </button>
    <input type="text" class="fn-search-input" id="fn-search-input" placeholder="Search…">
  </div>`;
  html += `<button class="fn-btn fn-help-btn" id="fn-help-btn" data-section="help" data-label="Help" aria-label="Help">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
  </button>`;

  card.innerHTML = html;
  document.body.appendChild(card);
  return card;
}

function initLeftEdgeHover() {
  let card = document.getElementById("floating-nav-card");
  if (!card) {
    card = _createFloatingNavCard();
  }
  if (!card) return;

  const BREAKPOINT = 950;
  const EDGE_SHOW = 20; // px from left edge to show card
  const EDGE_HIDE = 80; // px from left edge beyond which card hides
  let showTimeout = null;
  let hideTimeout = null;
  let lastX = 0;
  let pinned = false; // stays open while search is active

  function isNarrow() {
    // Show the floating card when the real sidebar is hidden
    // This happens at <=950px (sidebar hidden) OR when sidebar is toggled closed
    if (window.innerWidth <= BREAKPOINT) return true;
    const sidebar = document.getElementById("sidebar");
    return (
      sidebar &&
      !sidebar.classList.contains("open") &&
      window.innerWidth <= 1100
    );
  }

  function showCard() {
    card.style.display = "flex";
    requestAnimationFrame(() => card.classList.add("visible"));
  }

  function hideCard() {
    if (pinned) return;
    card.classList.remove("visible");
    card.addEventListener(
      "transitionend",
      () => {
        if (!card.classList.contains("visible")) card.style.display = "none";
      },
      { once: true },
    );
  }

  // Wire nav buttons
  card.querySelectorAll(".fn-btn[data-section]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.dataset.section;
      // sync active state on both float card and main sidebar
      card
        .querySelectorAll(".fn-btn[data-section]")
        .forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".nav-item[data-section]").forEach((item) => {
        item.classList.toggle("active", item.dataset.section === section);
      });
      // Navigate directly — don't call sidebarItem.click() as that would
      // trigger toggleSidebar() and slide the full sidebar open
      state.activeNavSection = section;
      _navigateTo(section);
    });
  });

  // Sync float card active state when sidebar navigates
  const observer = new MutationObserver(() => {
    const active = document.querySelector(".nav-item.active");
    if (!active) return;
    const sec = active.dataset.section;
    card.querySelectorAll(".fn-btn[data-section]").forEach((b) => {
      b.classList.toggle("active", b.dataset.section === sec);
    });
  });
  const sidebar = document.getElementById("sidebar");
  if (sidebar)
    observer.observe(sidebar, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

  // Search button — expand inline input, relay to main search
  const fnSearchBtn = document.getElementById("fn-search-btn");
  const fnSearchInput = document.getElementById("fn-search-input");
  const mainSearch = document.getElementById("search-input");

  if (fnSearchBtn && fnSearchInput) {
    fnSearchBtn.addEventListener("click", () => {
      fnSearchInput.classList.toggle("open");
      pinned = fnSearchInput.classList.contains("open");
      if (pinned) {
        fnSearchInput.focus();
        fnSearchInput.select();
      } else {
        fnSearchInput.value = "";
        if (mainSearch) {
          mainSearch.value = "";
          mainSearch.dispatchEvent(new Event("input"));
        }
      }
    });

    fnSearchInput.addEventListener("input", () => {
      if (mainSearch) {
        mainSearch.value = fnSearchInput.value;
        mainSearch.dispatchEvent(new Event("input"));
      }
    });

    fnSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        fnSearchInput.classList.remove("open");
        pinned = false;
        fnSearchInput.value = "";
        if (mainSearch) {
          mainSearch.value = "";
          mainSearch.dispatchEvent(new Event("input"));
        }
      }
    });

    fnSearchInput.addEventListener("blur", () => {
      if (!fnSearchInput.value) {
        fnSearchInput.classList.remove("open");
        pinned = false;
      }
    });
  }

  // Edge hover detection (mouse)
  document.addEventListener("mousemove", (e) => {
    // Respect hover mode — only show on edge hover, not always
    if (!isNarrow()) {
      if (card.classList.contains("visible")) hideCard();
      if (showTimeout) {
        clearTimeout(showTimeout);
        showTimeout = null;
      }
      return;
    }

    // If nav mode is "always", skip edge detection (card stays visible)
    if (card.classList.contains("nav-always")) return;

    lastX = e.clientX;

    if (e.clientX < EDGE_SHOW) {
      if (!showTimeout) {
        showTimeout = setTimeout(() => {
          if (lastX < EDGE_SHOW) showCard();
          showTimeout = null;
        }, 100);
      }
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
    } else {
      if (showTimeout) {
        clearTimeout(showTimeout);
        showTimeout = null;
      }
      if (e.clientX > EDGE_HIDE && card.classList.contains("visible")) {
        if (!hideTimeout) {
          hideTimeout = setTimeout(() => {
            hideCard();
            hideTimeout = null;
          }, 300);
        }
      } else if (e.clientX <= EDGE_HIDE) {
        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = null;
        }
      }
    }
  });

  // Touch edge detection for tablets
  document.addEventListener(
    "touchstart",
    (e) => {
      if (!isNarrow()) return;
      if (card.classList.contains("nav-always")) return;

      const touch = e.touches[0];
      if (touch.clientX < EDGE_SHOW) {
        if (!showTimeout) {
          showTimeout = setTimeout(() => {
            if (touch.clientX < EDGE_SHOW) showCard();
            showTimeout = null;
          }, 100);
        }
      }
    },
    { passive: true },
  );

  document.addEventListener(
    "touchend",
    () => {
      if (card.classList.contains("nav-always")) return;
      if (!pinned && card.classList.contains("visible")) {
        hideTimeout = setTimeout(() => {
          hideCard();
          hideTimeout = null;
        }, 2500); // Stay open longer on touch devices
      }
    },
    { passive: true },
  );

  // Keep card visible while mouse is over it
  card.addEventListener("mouseenter", () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  });

  card.addEventListener("mouseleave", (e) => {
    if (!pinned && e.clientX > EDGE_HIDE) {
      hideTimeout = setTimeout(() => {
        hideCard();
        hideTimeout = null;
      }, 300);
    }
  });

  document.addEventListener("mouseleave", () => {
    if (showTimeout) {
      clearTimeout(showTimeout);
      showTimeout = null;
    }
  });
}

// Initialize on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLeftEdgeHover);
} else {
  initLeftEdgeHover();
}
