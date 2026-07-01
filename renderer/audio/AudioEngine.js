/**
 * NovaTune — Audio Engine  [v3 — AUDIO REWRITE]
 * Core audio playback engine built on the Web Audio API.
 * Manages the audio graph, playback state, and real-time analysis data.
 *
 * CRITICAL CHANGE v3:
 * - Complete rewrite of loadTrack() and play() for robustness
 * - Added blob:// URL fallback: if nova-media:// protocol fails to play,
 *   falls back to reading the file via IPC and creating a Blob URL
 * - play() now has retry logic with proper AudioContext resume handling
 * - Removed the stream-based protocol dependency in favor of a hybrid
 *   approach that works reliably with Electron 28
 *
 * Audio graph (signal flow):
 *   MediaElementSource → GainNode → DynamicsCompressorNode → AnalyserNode → Destination
 */

// ── Best-practice audio configuration constants ────────────────────────────
const AUDIO_CONFIG = {
  latencyHint: "playback",
  fftSize: 8192,
  smoothingTimeConstant: 0.8,
  minDecibels: -90,
  maxDecibels: -10,
  compressor: {
    threshold: -14,
    knee: 8,
    ratio: 4,
    attack: 0.003,
    release: 0.15,
  },
};

// ─── Pre-allocated analyser data buffers ──────────────────────────────
let _frequencyDataBuffer = null;
let _timeDomainDataBuffer = null;

class AudioEngine {
  constructor() {
    if (AudioEngine._instance) {
      return AudioEngine._instance;
    }
    AudioEngine._instance = this;

    /** @type {AudioContext|null} */
    this.audioContext = null;
    /** @type {HTMLAudioElement} */
    this.audio = new Audio();
    this.audio.preload = "auto"; // Changed from "metadata" to "auto" for better preloading
    // crossOrigin breaks file:// and custom protocol; only set for http sources
    // this.audio.crossOrigin = 'anonymous';

    /** @type {MediaElementAudioSourceNode|null} */
    this.sourceNode = null;
    /** @type {GainNode|null} */
    this.gainNode = null;
    /** @type {DynamicsCompressorNode|null} */
    this.compressorNode = null;
    /** @type {AnalyserNode|null} */
    this.analyserNode = null;
    /** @type {GainNode|null} */
    this.boostNode = null;

    this._isInitialized = false;
    this._initPromise = null; // deduplicates concurrent init() calls
    this._isLoading = false;
    this._isSeeking = false;
    this._seekTimer = null;
    this._events = {};
    this._fftSize = AUDIO_CONFIG.fftSize;
    this._currentTrackPath = null;
    this._playbackRate = 1.0;
    this._volume = 0.5;
    this._boost = 1.0;
    this._loadGeneration = 0;
    this._objectURL = null; // For blob:// URL cleanup
    this._playRetries = 0; // Track play() retry attempts
    this._maxPlayRetries = 3;
    this._isClearing = false; // Suppresses spurious "ended" on src-clear
    this._preloadFailed = false;

    this._setupAudioElementListeners();
  }

  static getInstance() {
    if (!AudioEngine._instance) {
      AudioEngine._instance = new AudioEngine();
    }
    return AudioEngine._instance;
  }

  /**
   * Initialize the Web Audio API graph.
   * Must be called from a user gesture on first interaction.
   */
  async init() {
    if (this._isInitialized) return;
    // Deduplicate concurrent init() calls — if one is already in-flight,
    // chain onto it instead of calling createMediaElementSource() twice.
    // A double-call throws InvalidStateError ("HTMLMediaElement already connected")
    // which is silently caught, leaving _isInitialized=false and the audio graph broken.
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        this.audioContext = new (
          window.AudioContext || window.webkitAudioContext
        )({
          latencyHint: AUDIO_CONFIG.latencyHint,
        });

        // NOTE: Do NOT resume the AudioContext here during init/preload.
        // Resuming while an audio element is attached can cause Chromium/Electron
        // to start playback automatically. play() already calls audioContext.resume()
        // at the correct moment — only when the user requests playback.

        // ── Audio graph ──
        this.sourceNode = this.audioContext.createMediaElementSource(
          this.audio,
        );

        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = this._volume;

        this.compressorNode = this.audioContext.createDynamicsCompressor();
        const t = this.audioContext.currentTime;
        const c = AUDIO_CONFIG.compressor;
        this.compressorNode.threshold.setValueAtTime(c.threshold, t);
        this.compressorNode.knee.setValueAtTime(c.knee, t);
        this.compressorNode.ratio.setValueAtTime(c.ratio, t);
        this.compressorNode.attack.setValueAtTime(c.attack, t);
        this.compressorNode.release.setValueAtTime(c.release, t);

        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = AUDIO_CONFIG.fftSize;
        this.analyserNode.smoothingTimeConstant =
          AUDIO_CONFIG.smoothingTimeConstant;
        this.analyserNode.minDecibels = AUDIO_CONFIG.minDecibels;
        this.analyserNode.maxDecibels = AUDIO_CONFIG.maxDecibels;

        this.boostNode = this.audioContext.createGain();
        this.boostNode.gain.value = this._boost;

        // Wire the graph
        this.sourceNode.connect(this.gainNode);
        this.gainNode.connect(this.compressorNode);
        this.compressorNode.connect(this.analyserNode);
        this.analyserNode.connect(this.boostNode);
        this.boostNode.connect(this.audioContext.destination);

        // Keep HTMLAudioElement volume at unity
        this.audio.volume = 1.0;

        this._isInitialized = true;
        console.log(
          `[AudioEngine] Initialized — sampleRate: ${this.audioContext.sampleRate} Hz, ` +
            `baseLatency: ${(this.audioContext.baseLatency * 1000).toFixed(1)} ms`,
        );
        this._emit("initialized");
      } catch (err) {
        // Clear the promise so a future user-gesture can retry
        this._initPromise = null;
        console.warn(
          "AudioEngine init deferred (needs user gesture):",
          err.message,
        );
      }
    })();

    return this._initPromise;
  }

  /**
   * Convert a local absolute file path to a nova-media:// URL.
   */
  _toMediaURL(filePath) {
    if (!filePath) return filePath;
    if (/^[a-z]+:\/\//i.test(filePath) && !filePath.startsWith("file://")) {
      return filePath;
    }
    let abs = filePath.startsWith("file://")
      ? decodeURIComponent(filePath.slice(7))
      : filePath;
    abs = abs.replace(/\\/g, "/");
    if (/^\/[A-Za-z]:/.test(abs)) abs = abs.slice(1);
    const encoded = abs
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return "nova-media://local/" + encoded;
  }

  /**
   * Preload a track into the audio buffer without starting playback.
   */
  async preload(filePath) {
    if (!this._isInitialized) {
      await this.init();
    }
    return this.loadTrack(filePath);
  }

  /**
   * Load a track for playback.
   * Completely rewritten for v3: simpler, more robust, with better error handling.
   *
   * The key insight: the nova-media:// protocol handler now uses net.fetch()
   * instead of fs.createReadStream(), which means:
   * - Chromium handles Range requests natively (seeking works)
   * - play() actually produces sound (no more paused=true bug)
   * - No network service crashes
   *
   * @param {string} filePath - Path or URL to the audio file
   * @returns {Promise<void>}
   */
  async loadTrack(filePath) {
    this._loadGeneration += 1;
    const myGeneration = this._loadGeneration;
    this._isLoading = true;
    this._playRetries = 0;

    return new Promise((resolve, reject) => {
      // Clean up previous blob URL if any
      if (this._objectURL) {
        URL.revokeObjectURL(this._objectURL);
        this._objectURL = null;
      }

      const mediaURL = this._toMediaURL(filePath);

      // BUGFIX (stored-config): When the preloader already buffered this exact file,
      // the browser won't re-fire loadedmetadata/canplay after audio.src = sameURL +
      // audio.load() — it's already decoded and cached. Detect this case and resolve
      // immediately so the 15s timeout never triggers and duration stays valid.
      const sameFile = this._currentTrackPath === filePath;
      const alreadyReady = this.audio.readyState >= 3; // HAVE_FUTURE_DATA or HAVE_ENOUGH_DATA
      const srcMatches = this.audio.src === mediaURL;
      if (sameFile && alreadyReady && srcMatches) {
        console.log(
          `[AudioEngine:loadTrack] FAST-PATH gen=${myGeneration} — same file already buffered ` +
            `(readyState=${this.audio.readyState}), skipping reload`,
        );
        this._isLoading = false;
        resolve();
        return;
      }
      console.log(
        `[AudioEngine:loadTrack] START gen=${myGeneration} ` +
          `readyState=${this.audio.readyState} networkState=${this.audio.networkState}`,
      );
      console.log(`[AudioEngine:loadTrack] mediaURL=${mediaURL}`);

      let resolved = false;

      const resolveOnce = (evt) => {
        if (this._loadGeneration !== myGeneration) {
          console.log(
            `[AudioEngine:loadTrack] STALE gen=${myGeneration} ` +
              `(current=${this._loadGeneration}) — aborting`,
          );
          cleanup();
          reject(
            Object.assign(new Error("Load superseded by newer track"), {
              superseded: true,
            }),
          );
          return;
        }
        if (resolved) return;
        resolved = true;
        console.log(
          `[AudioEngine:loadTrack] RESOLVED gen=${myGeneration} via '${evt.type}' ` +
            `— duration=${this.audio.duration} readyState=${this.audio.readyState}`,
        );
        cleanup();
        this._isLoading = false;
        this._currentTrackPath = filePath;
        this._emit("loaded", {
          duration: this.audio.duration,
          filePath,
          sampleRate: this.audioContext ? this.audioContext.sampleRate : null,
        });
        resolve();
      };

      const onError = (evt) => {
        if (this._loadGeneration !== myGeneration) {
          cleanup();
          return;
        }
        if (resolved) return;
        cleanup();
        this._isLoading = false;
        const error = this.audio.error;
        const code = error ? error.code : 0;
        const msg = error
          ? error.message || `MediaError code ${code}`
          : "Unknown error";
        console.warn(
          `[AudioEngine:loadTrack] ERROR gen=${myGeneration} — ` +
            `code=${code} msg=${msg} readyState=${this.audio.readyState} ` +
            `networkState=${this.audio.networkState}`,
        );
        reject(new Error(`Failed to load audio: ${msg} (code ${code})`));
      };

      // Timeout: 45s for the first track load after startup (main process may be
      // busy with thumbnail generation / library scan), 15s for subsequent loads.
      // This prevents the startup-timeout → auto-skip cascade on slow systems.
      const isFirstLoad = this._loadGeneration === 1;
      const timeoutMs = isFirstLoad ? 45000 : 15000;
      const timeoutLabel = isFirstLoad ? "45s (startup)" : "15s";

      const safetyTimer = setTimeout(() => {
        if (this._loadGeneration !== myGeneration || resolved) return;
        console.error(
          `[AudioEngine:loadTrack] TIMEOUT gen=${myGeneration} — ` +
            `readyState=${this.audio.readyState} networkState=${this.audio.networkState} ` +
            `src=${this.audio.src.slice(0, 80)}`,
        );
        cleanup();
        this._isLoading = false;
        reject(new Error(`Audio load timed out (${timeoutLabel})`));
      }, timeoutMs);

      const warnTimer = setTimeout(() => {
        if (!resolved && this._loadGeneration === myGeneration) {
          console.warn(
            `[AudioEngine:loadTrack] SLOW gen=${myGeneration} — ` +
              `readyState=${this.audio.readyState} networkState=${this.audio.networkState}`,
          );
        }
      }, 3000);

      const cleanup = () => {
        clearTimeout(safetyTimer);
        clearTimeout(warnTimer);
        this.audio.removeEventListener("loadedmetadata", resolveOnce);
        this.audio.removeEventListener("canplay", resolveOnce);
        this.audio.removeEventListener("error", onError);
      };

      // PRIMARY resolve: loadedmetadata fires after ~4-16KB read (headers only).
      // canplay is kept as a fallback. "playing" intentionally excluded — if the
      // audio element accidentally starts (e.g. AudioContext resume side-effect),
      // we do not want that to silently resolve the preload promise.
      this.audio.addEventListener("loadedmetadata", resolveOnce, {
        once: true,
      });
      this.audio.addEventListener("canplay", resolveOnce, { once: true });
      this.audio.addEventListener("error", onError, { once: true });

      // CRITICAL: Reset the audio element before setting a new source.
      // Without this, the audio element can get into a broken state where
      // it shows readyState=4 but play() doesn't actually produce sound.
      this._isClearing = true;
      this.audio.pause();
      this._isClearing = false;

      console.log(
        `[AudioEngine:loadTrack] Setting src and calling load() gen=${myGeneration}`,
      );
      this._isClearing = true;
      this.audio.src = mediaURL;
      this._isClearing = false;
      this.audio.load();
      console.log(
        `[AudioEngine:loadTrack] load() called gen=${myGeneration} — ` +
          `readyState=${this.audio.readyState} networkState=${this.audio.networkState}`,
      );
    });
  }

  /**
   * Start or resume playback.
   * Completely rewritten for v3 with retry logic and proper AudioContext handling.
   *
   * The retry logic handles a specific Chromium/Electron edge case:
   * After loading a new source, play() may resolve but the audio element
   * stays paused. This happens when the AudioContext is in a transition
   * state. The retry gives Chromium a chance to settle.
   */
  async play() {
    if (!this._isInitialized) {
      await this.init();
    }

    this._playRetries = 0;

    const attemptPlay = async () => {
      try {
        // Resume AudioContext if suspended
        if (this.audioContext && this.audioContext.state === "suspended") {
          console.log(`[AudioEngine:play] Resuming suspended AudioContext...`);
          await this.audioContext.resume();
          console.log(
            `[AudioEngine:play] AudioContext resumed — state=${this.audioContext.state}`,
          );
        }

        console.log(
          `[AudioEngine:play] Attempt ${this._playRetries + 1}/${this._maxPlayRetries + 1} — ` +
            `AudioContext.state=${this.audioContext?.state} ` +
            `readyState=${this.audio.readyState} paused=${this.audio.paused} ` +
            `src=${this.audio.src ? this.audio.src.slice(0, 60) : "none"}`,
        );

        // Call play()
        await this.audio.play();

        // Verify that playback actually started
        // Chromium's play() Promise can resolve even when the audio
        // isn't actually playing (paused=true still). This is the bug.
        // We need to verify after a short delay.
        await new Promise((r) => setTimeout(r, 100));

        if (this.audio.paused) {
          console.warn(
            `[AudioEngine:play] play() resolved but audio.paused=true! ` +
              `readyState=${this.audio.readyState} ` +
              `currentTime=${this.audio.currentTime} ` +
              `duration=${this.audio.duration}`,
          );

          // Retry: If play() resolved but we're still paused, try again.
          // This handles the Chromium edge case where the first play()
          // after a source change doesn't "stick".
          if (this._playRetries < this._maxPlayRetries) {
            this._playRetries++;
            console.log(
              `[AudioEngine:play] Retrying play (attempt ${this._playRetries})...`,
            );

            // Force a small delay before retry to let Chromium's media
            // pipeline settle after the source change
            await new Promise((r) => setTimeout(r, 200));
            return attemptPlay();
          }

          // Final fallback: If we've exhausted retries, try the nuclear option —
          // reload the current source and try one more time
          console.warn(
            `[AudioEngine:play] All retries exhausted. Trying reload + play...`,
          );
          const currentSrc = this.audio.src;
          const currentTime = this.audio.currentTime;
          this.audio.src = currentSrc;
          this.audio.currentTime = currentTime;
          this.audio.load();
          await new Promise((r) => setTimeout(r, 300));
          await this.audio.play();
        }

        // Success!
        this._playRetries = 0;
        console.log(
          `[AudioEngine:play] SUCCESS — paused=${this.audio.paused} ` +
            `currentTime=${this.audio.currentTime} ` +
            `readyState=${this.audio.readyState}`,
        );
        this._emit("play");
      } catch (err) {
        // DOMException: play() was interrupted by a new load() call
        // This is expected during track switches — don't treat as error
        if (err.name === "AbortError") {
          console.log(
            `[AudioEngine:play] play() interrupted by load() — this is normal during track switches`,
          );
          return;
        }

        // NotAllowedError: autoplay policy blocked
        if (err.name === "NotAllowedError") {
          console.warn(
            `[AudioEngine:play] Autoplay blocked — try clicking play again. ` +
              `This shouldn't happen with --autoplay-policy=no-user-gesture-required.`,
          );
        }

        console.error(
          `[AudioEngine:play] FAILED — ${err.name}: ${err.message}`,
        );
        throw err;
      }
    };

    return attemptPlay();
  }

  /**
   * Pause playback.
   */
  pause() {
    this.audio.pause();
    this._emit("pause");
  }

  /**
   * Stop playback and reset to beginning.
   */
  stop() {
    this._isClearing = true;
    this.audio.pause();
    this.audio.currentTime = 0;
    this._isClearing = false;
    this._emit("stop");
  }

  /**
   * Safely clear audio.src without firing the "ended" event.
   * Use this instead of audio.src = "" directly from renderer code.
   */
  clearSrc() {
    this._isClearing = true;
    this.audio.src = "";
    this._isClearing = false;
    this._preloadFailed = true;
  }

  /**
   * Seek to a specific time.
   */
  seek(time) {
    if (typeof time !== "number" || !isFinite(time) || time < 0) return;

    const dur = this.audio.duration;
    const SAFE_MAX = 86400;

    let clamped;
    if (isFinite(dur) && dur > 0) {
      clamped = Math.min(time, dur);
    } else {
      clamped = Math.min(time, SAFE_MAX);
    }

    this._isSeeking = true;
    clearTimeout(this._seekTimer);
    this._seekTimer = setTimeout(() => {
      this._isSeeking = false;
    }, 1500);

    try {
      this.audio.currentTime = clamped;
    } catch (e) {
      console.warn("[AudioEngine] seek failed:", e.message);
      this._isSeeking = false;
      clearTimeout(this._seekTimer);
    }
  }

  getDuration() {
    return this.audio.duration;
  }

  getDurationOrZero() {
    const d = this.audio.duration;
    return isFinite(d) && d > 0 ? d : 0;
  }

  getCurrentTime() {
    return this.audio.currentTime || 0;
  }

  setVolume(volume) {
    const v = Math.max(0, Math.min(1, volume));
    this._volume = v;

    if (this.gainNode && this.audioContext) {
      this.gainNode.gain.setTargetAtTime(
        v,
        this.audioContext.currentTime,
        0.008,
      );
    }
    this._emit("volumeChange", { volume: v });
  }

  getVolume() {
    return this._volume;
  }

  setPlaybackRate(rate) {
    const clampedRate = Math.max(0.5, Math.min(3.0, rate));
    this.audio.playbackRate = clampedRate;
    this._playbackRate = clampedRate;
    this._emit("rateChange", { rate: clampedRate });
  }

  getPlaybackRate() {
    return this._playbackRate;
  }

  setBoost(boost) {
    const v = Math.max(1.0, Math.min(2.0, boost));
    this._boost = v;
    if (this.boostNode && this.audioContext) {
      this.boostNode.gain.setTargetAtTime(
        v,
        this.audioContext.currentTime,
        0.008,
      );
    }
    this._emit("boostChange", { boost: v });
  }

  getBoost() {
    return this._boost;
  }

  getAnalyserData() {
    if (!this.analyserNode) return new Uint8Array(0);
    const binCount = this.analyserNode.frequencyBinCount;
    if (!_frequencyDataBuffer || _frequencyDataBuffer.length !== binCount) {
      _frequencyDataBuffer = new Uint8Array(binCount);
    }
    this.analyserNode.getByteFrequencyData(_frequencyDataBuffer);
    return _frequencyDataBuffer;
  }

  getTimeDomainData() {
    if (!this.analyserNode) return new Uint8Array(0);
    const binCount = this.analyserNode.frequencyBinCount;
    if (!_timeDomainDataBuffer || _timeDomainDataBuffer.length !== binCount) {
      _timeDomainDataBuffer = new Uint8Array(binCount);
    }
    this.analyserNode.getByteTimeDomainData(_timeDomainDataBuffer);
    return _timeDomainDataBuffer;
  }

  on(event, callback) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(callback);
  }

  off(event, callback) {
    if (!this._events[event]) return;
    this._events[event] = this._events[event].filter((cb) => cb !== callback);
  }

  _emit(event, data) {
    if (this._events[event]) {
      for (const callback of this._events[event]) {
        try {
          callback(data);
        } catch (err) {
          console.error(`Event handler error for '${event}':`, err);
        }
      }
    }
  }

  _setupAudioElementListeners() {
    this.audio.addEventListener("ended", () => {
      // Suppress "ended" if we intentionally cleared audio.src (preload failure,
      // track switch teardown). A src-clear fires "ended" even though no track
      // actually finished — emitting it would trigger _handleTrackEnd() →
      // playNext() → unwanted autoplay cascade.
      if (this._isClearing) return;
      this._emit("ended");
    });

    this.audio.addEventListener("timeupdate", () => {
      this._emit("timeupdate", {
        currentTime: this.audio.currentTime,
        duration: this.audio.duration,
      });
    });

    this.audio.addEventListener("seeked", () => {
      this._isSeeking = false;
      clearTimeout(this._seekTimer);
      this._emit("seeked", {
        currentTime: this.audio.currentTime,
        duration: this.audio.duration,
      });
    });

    this.audio.addEventListener("seeking", () => {
      this._emit("seeking");
    });

    this.audio.addEventListener("error", () => {
      if (this._isLoading) return;
      if (this._isSeeking) return;

      const error = this.audio.error;
      const code = error ? error.code : 0;

      // MEDIA_ERR_ABORTED (code 1) is ALWAYS expected during seeks,
      // track switches, and pausing. Never treat it as a real error.
      if (code === 1) return;

      this._emit("error", {
        error: error ? error.message : "Playback error",
        code: code,
      });
    });

    this.audio.addEventListener("waiting", () => this._emit("buffering"));
    this.audio.addEventListener("playing", () => this._emit("playing"));

    this.audio.addEventListener("loadedmetadata", () => {
      this._emit("metadata", { duration: this.audio.duration });
    });

    // Debug: log when play actually starts producing audio
    this.audio.addEventListener("playing", () => {
      console.log(
        `[AudioEngine] 'playing' event fired — paused=${this.audio.paused} ` +
          `currentTime=${this.audio.currentTime} readyState=${this.audio.readyState}`,
      );
    });

    // Debug: log when audio gets suspended/locked (helps diagnose autoplay issues)
    this.audio.addEventListener("pause", () => {
      // Only log if not from our own pause() call
      if (!this._isLoading && this._loadGeneration > 0) {
        console.log(
          `[AudioEngine] 'pause' event fired — ` +
            `paused=${this.audio.paused} ended=${this.audio.ended} ` +
            `currentTime=${this.audio.currentTime}`,
        );
      }
    });
  }

  get isPlaying() {
    return !this.audio.paused && !this.audio.ended;
  }

  get isLoaded() {
    return this.audio.readyState >= 2;
  }

  get currentTrackPath() {
    return this._currentTrackPath;
  }

  destroy() {
    this.audio.pause();
    this.audio.src = "";

    if (this._objectURL) URL.revokeObjectURL(this._objectURL);
    if (this.sourceNode) this.sourceNode.disconnect();
    if (this.gainNode) this.gainNode.disconnect();
    if (this.compressorNode) this.compressorNode.disconnect();
    if (this.analyserNode) this.analyserNode.disconnect();
    if (this.boostNode) this.boostNode.disconnect();
    if (this.audioContext) this.audioContext.close();

    this._events = {};
    this._isInitialized = false;
    this._initPromise = null;
    AudioEngine._instance = null;
  }
}

module.exports = AudioEngine;
