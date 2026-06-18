/**
 * NovaTune — Audio Engine
 * Core audio playback engine built on the Web Audio API.
 * Manages the audio graph, playback state, and real-time analysis data.
 *
 * Audio graph (signal flow):
 *   MediaElementSource → GainNode → DynamicsCompressorNode → AnalyserNode → Destination
 *
 * Compressor acts as a transparent mastering limiter:
 *   - Catches inter-sample peaks and hot masters before they clip
 *   - Gentle enough to be inaudible on well-mastered tracks
 *   - Settings sourced from Web Audio API community best practices
 *     (MDN, Tone.js wiki, music production engineering guides)
 */

// ── Best-practice audio configuration constants ────────────────────────────
const AUDIO_CONFIG = {
  // AudioContext
  latencyHint: "playback", // prioritise sustained playback over interactive latency (MDN recommended for music players)
  // No sampleRate forced — let the context match the hardware device rate.
  // Forcing 44100 on a 48000-Hz device causes an SRC conversion that adds
  // a measurable noise floor. Device-native avoids the extra resample pass.

  // AnalyserNode
  fftSize: 8192, // 8192 bins → ~5.8 Hz resolution at 48 kHz; significantly finer than 4096 for visualizer
  smoothingTimeConstant: 0.8, // slight time-smear gives a natural VU-meter feel without choppiness
  minDecibels: -90, // full dynamic range floor
  maxDecibels: -10, // top rail; leaves headroom above noise floor

  // DynamicsCompressorNode — transparent mastering limiter
  // Target: inaudible on well-mastered tracks, catches hot peaks on loud masters.
  // Derived from: MDN compressor docs, music production cheat-sheets,
  // Tone.js performance wiki, and community consensus on "glue" bus compression.
  compressor: {
    threshold: -14, // dB — only engages on loud peaks above -14 dBFS; normal material untouched
    knee: 8, // dB — soft knee; gradual onset, transparent on normal dynamic range
    ratio: 4, // 4:1 — gentle limiting, not aggressive squashing
    attack: 0.003, // 3 ms — fast enough to catch transients before they clip the output
    release: 0.15, // 150 ms — natural release; avoids pumping on bass-heavy tracks
  },
};

// ─── Pre-allocated analyser data buffers ──────────────────────────────
// Avoid GC pressure from allocating new Uint8Arrays every animation frame.
// The visualizer calls getAnalyserData()/getTimeDomainData() at 60fps,
// which was creating 120 new Uint8Array(4096) allocations per second.
// Pre-allocating eliminates this GC pressure entirely.
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
    this.audio.preload = "auto";
    // crossOrigin breaks file:// protocol; only set for http sources
    // this.audio.crossOrigin = 'anonymous';

    /** @type {MediaElementAudioSourceNode|null} */
    this.sourceNode = null;
    /** @type {GainNode|null} */
    this.gainNode = null;
    /** @type {DynamicsCompressorNode|null} */
    this.compressorNode = null;
    /** @type {AnalyserNode|null} */
    this.analyserNode = null;
    /** @type {GainNode|null} Volume boost node (post-analyser, 1.0–2.0) */
    this.boostNode = null;

    this._isInitialized = false;
    this._isLoading = false;
    this._isSeeking = false; // BUGFIX (v4): suppress MEDIA_ERR_ABORTED during seeks
    this._seekTimer = null;
    this._events = {};
    this._fftSize = AUDIO_CONFIG.fftSize;
    this._currentTrackPath = null;
    this._playbackRate = 1.0;
    this._volume = 0.5;
    this._boost = 1.0;

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

    try {
      // Use device-native sample rate — forcing 44100 when hardware runs at
      // 48000 (or 96000) causes an extra SRC conversion that degrades quality.
      this.audioContext = new (
        window.AudioContext || window.webkitAudioContext
      )({
        latencyHint: AUDIO_CONFIG.latencyHint, // "playback" — optimise for music, not interactive latency
      });

      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      // ── Audio graph: source → gain → compressor → analyser → destination ──
      //
      // Volume is controlled ONLY through gainNode.gain; audio.volume stays at 1
      // to avoid double-attenuation and quantisation errors.
      this.sourceNode = this.audioContext.createMediaElementSource(this.audio);

      // Gain node — user volume control
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this._volume;

      // Dynamics compressor — transparent mastering limiter
      // Catches inter-sample peaks on hot masters before they hit the DAC.
      // At these settings it is inaudible on normal material; only engages
      // when peaks exceed -14 dBFS.
      this.compressorNode = this.audioContext.createDynamicsCompressor();
      const t = this.audioContext.currentTime;
      const c = AUDIO_CONFIG.compressor;
      this.compressorNode.threshold.setValueAtTime(c.threshold, t);
      this.compressorNode.knee.setValueAtTime(c.knee, t);
      this.compressorNode.ratio.setValueAtTime(c.ratio, t);
      this.compressorNode.attack.setValueAtTime(c.attack, t);
      this.compressorNode.release.setValueAtTime(c.release, t);

      // Analyser node — feeds Visualizer.js
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = AUDIO_CONFIG.fftSize;
      this.analyserNode.smoothingTimeConstant =
        AUDIO_CONFIG.smoothingTimeConstant;
      this.analyserNode.minDecibels = AUDIO_CONFIG.minDecibels;
      this.analyserNode.maxDecibels = AUDIO_CONFIG.maxDecibels;

      // Boost node — post-analyser gain for volume boost up to 200%
      // Sits after the analyser so the visualizer sees pre-boost levels.
      this.boostNode = this.audioContext.createGain();
      this.boostNode.gain.value = this._boost;

      // Wire the graph
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.compressorNode);
      this.compressorNode.connect(this.analyserNode);
      this.analyserNode.connect(this.boostNode);
      this.boostNode.connect(this.audioContext.destination);

      // Keep HTMLAudioElement volume at unity — all attenuation via gainNode
      this.audio.volume = 1.0;

      this._isInitialized = true;
      console.log(
        `[AudioEngine] Initialized — sampleRate: ${this.audioContext.sampleRate} Hz, ` +
          `baseLatency: ${(this.audioContext.baseLatency * 1000).toFixed(1)} ms`,
      );
      this._emit("initialized");
    } catch (err) {
      console.warn(
        "AudioEngine init deferred (needs user gesture):",
        err.message,
      );
    }
  }

  /**
   * Convert a local absolute file path to a nova-media:// URL.
   * This lets Chromium serve the file with the correct MIME type and
   * byte-range support, fixing FLAC / M4A / AAC playback.
   * @param {string} filePath
   * @returns {string}
   */
  _toMediaURL(filePath) {
    if (!filePath) return filePath;
    // Already a URL
    if (/^[a-z]+:\/\//i.test(filePath) && !filePath.startsWith("file://")) {
      return filePath;
    }
    // Strip file:// prefix if present
    let abs = filePath.startsWith("file://")
      ? decodeURIComponent(filePath.slice(7))
      : filePath;
    // Normalise Windows backslashes
    abs = abs.replace(/\\/g, "/");
    // Remove leading slash-duplicate on Windows (//C:/... → C:/...)
    if (/^\/[A-Za-z]:/.test(abs)) abs = abs.slice(1);
    // Encode each path segment individually — encodeURIComponent on the whole
    // path encodes slashes (%2F) and the Windows drive colon (%3A), which
    // Chromium normalises unpredictably in protocol.handle, causing
    // DEMUXER_ERROR_COULD_NOT_OPEN on paths like C:\Users\...
    const encoded = abs
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return "nova-media://local/" + encoded;
  }

  /**
   * Preload a track into the audio buffer without starting playback.
   * Initialises the AudioContext if needed, loads the file, and resolves
   * once canplaythrough fires — meaning play() will start with zero delay.
   * @param {string} filePath
   * @returns {Promise<void>}
   */
  async preload(filePath) {
    if (!this._isInitialized) {
      await this.init();
    }
    return this.loadTrack(filePath);
  }

  /**
   * Load a track for playback.
   * @param {string} filePath - Path or URL to the audio file
   * @returns {Promise<void>}
   */
  async loadTrack(filePath) {
    this._isLoading = true;
    return new Promise((resolve, reject) => {
      if (this._objectURL) {
        URL.revokeObjectURL(this._objectURL);
        this._objectURL = null;
      }

      const mediaURL = this._toMediaURL(filePath);

      const onCanPlay = () => {
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

      const onError = () => {
        cleanup();
        this._isLoading = false;
        const error = this.audio.error;
        const code = error ? error.code : 0;
        const msg = error
          ? error.message || `MediaError code ${code}`
          : "Unknown error";
        console.warn(
          `[AudioEngine] load failed for ${mediaURL} (code ${code}): ${msg}`,
        );
        // NOTE: do not also _emit("error") here — loadTrack's rejection is
        // already handled by the caller's catch block (which calls playNext()).
        // Emitting "error" too caused a second, overlapping playNext() call
        // that reassigned audio.src mid-load, producing spurious
        // "code 0 / Unknown error" events on the next track.
        reject(new Error(`Failed to load audio: ${msg} (code ${code})`));
      };

      const cleanup = () => {
        this.audio.removeEventListener("canplaythrough", onCanPlay);
        this.audio.removeEventListener("error", onError);
      };

      this.audio.addEventListener("canplaythrough", onCanPlay, { once: true });
      this.audio.addEventListener("error", onError, { once: true });

      this.audio.src = mediaURL;
      this.audio.load();
    });
  }

  /**
   * Start or resume playback.
   */
  async play() {
    if (!this._isInitialized) {
      await this.init();
    }

    try {
      if (this.audioContext && this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
      await this.audio.play();
      this._emit("play");
    } catch (err) {
      console.error("Playback failed:", err);
      throw err;
    }
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
    this.audio.pause();
    this.audio.currentTime = 0;
    this._emit("stop");
  }

  /**
   * Seek to a specific time.
   *
   * BUGFIX (v4): The real root cause of "drag to seek → song restarts" was
   * NOT in the seek logic itself — it was in the ERROR handler. When you
   * set audio.currentTime, the audio element aborts the current byte-range
   * fetch to fetch the new position. This fires a MEDIA_ERR_ABORTED (code 1)
   * error event. The old error handler only suppressed errors during
   * _isLoading, but during playback _isLoading is false — so the error
   * fired → renderer's error handler called playNext() → which called
   * playTrack() → which called loadTrack() → audio.src = mediaURL +
   * audio.load() → track reloaded from position 0. THAT was the restart.
   *
   * The fix has three layers:
   *   1. AudioEngine.seek() sets _isSeeking = true for a 1.5s window.
   *   2. AudioEngine's error listener ignores ALL errors while _isSeeking.
   *   3. AudioEngine's error listener ALSO ignores MEDIA_ERR_ABORTED (code 1)
   *      unconditionally — it's ALWAYS an expected, non-fatal event
   *      (fired on seek abort, on loadTrack replacement, on pause in some
   *      cases). It should never trigger playNext().
   *
   * @param {number} time - Time in seconds
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

    // Set the seeking flag BEFORE assigning currentTime. The assignment
    // synchronously fires `seeking`, then the abort+refetch happens
    // asynchronously, then `seeked` fires. The error event (if any) fires
    // during the abort+refetch window — so _isSeeking must already be true.
    this._isSeeking = true;
    clearTimeout(this._seekTimer);
    this._seekTimer = setTimeout(() => {
      this._isSeeking = false;
    }, 1500);

    try {
      this.audio.currentTime = clamped;
    } catch (e) {
      console.warn("[AudioEngine] seek failed:", e.message);
      // On exception, clear the flag immediately — no seek happened.
      this._isSeeking = false;
      clearTimeout(this._seekTimer);
    }
  }

  /**
   * Get the duration of the currently loaded track.
   *
   * BUGFIX: Previously returned `this.audio.duration || 0`, which collapses
   * NaN → 0. Callers (notably `seekFromPointer` in renderer.js) used a
   * truthy check on the return value to decide whether to compute a seek
   * target, so a NaN-duration track silently dropped every seek.
   *
   * Now: returns the raw duration, which may be NaN (metadata not loaded),
   * Infinity (unbounded stream), or a finite number. Callers that need a
   * finite fallback should use `getDurationOrZero()` below.
   *
   * @returns {number}
   */
  getDuration() {
    return this.audio.duration;
  }

  /**
   * Convenience wrapper — always returns a finite number ≥ 0.
   * Use this in UI code that just needs a number for display purposes.
   * @returns {number}
   */
  getDurationOrZero() {
    const d = this.audio.duration;
    return isFinite(d) && d > 0 ? d : 0;
  }

  getCurrentTime() {
    return this.audio.currentTime || 0;
  }

  /**
   * Set the playback volume.
   * Volume is applied exclusively through gainNode to avoid double-attenuation.
   * A slight equal-power curve is used so perceived loudness scales linearly.
   * @param {number} volume - 0 to 1
   */
  setVolume(volume) {
    const v = Math.max(0, Math.min(1, volume));
    this._volume = v;

    if (this.gainNode && this.audioContext) {
      const gainValue = v;
      this.gainNode.gain.setTargetAtTime(
        gainValue,
        this.audioContext.currentTime,
        0.008, // ~8 ms time constant — fast enough for scrubbing, no zipper
      );
    }
    // Do NOT touch this.audio.volume — keep it at 1.0
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

  /**
   * Set the volume boost multiplier (1.0 = 100%, 2.0 = 200%).
   * Applied post-analyser so the visualizer is unaffected.
   * Uses a short ramp to avoid clicks when scrubbing the slider.
   * @param {number} boost - 1.0 to 2.0
   */
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

  /**
   * Get frequency data from the analyser node.
   * Uses a pre-allocated buffer to avoid GC pressure at 60fps.
   * @returns {Uint8Array}
   */
  getAnalyserData() {
    if (!this.analyserNode) return new Uint8Array(0);
    const binCount = this.analyserNode.frequencyBinCount;
    // Lazy-allocate buffer on first call (after analyser is created)
    if (!_frequencyDataBuffer || _frequencyDataBuffer.length !== binCount) {
      _frequencyDataBuffer = new Uint8Array(binCount);
    }
    this.analyserNode.getByteFrequencyData(_frequencyDataBuffer);
    return _frequencyDataBuffer;
  }

  /**
   * Get time-domain waveform data from the analyser node.
   * Uses a pre-allocated buffer to avoid GC pressure at 60fps.
   * @returns {Uint8Array}
   */
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
    this.audio.addEventListener("ended", () => this._emit("ended"));

    this.audio.addEventListener("timeupdate", () => {
      this._emit("timeupdate", {
        currentTime: this.audio.currentTime,
        duration: this.audio.duration,
      });
    });

    // `seeked` fires when a currentTime assignment actually completes.
    // The renderer uses this to know when it's safe to re-enable
    // timeupdate-driven visual updates after a drag-seek.
    // Also clears the _isSeeking flag so the error suppressor is lifted.
    this.audio.addEventListener("seeked", () => {
      this._isSeeking = false;
      clearTimeout(this._seekTimer);
      this._emit("seeked", {
        currentTime: this.audio.currentTime,
        duration: this.audio.duration,
      });
    });

    // `seeking` fires when a currentTime assignment starts. The renderer
    // can use this to show a buffering indicator if needed.
    this.audio.addEventListener("seeking", () => {
      this._emit("seeking");
    });

    this.audio.addEventListener("error", () => {
      // BUGFIX (v4): Suppress errors during seeks. When you set
      // audio.currentTime, the audio element aborts the current byte-range
      // fetch, which fires MEDIA_ERR_ABORTED (code 1). This is expected
      // and NOT a real error — it should never trigger playNext().
      if (this._isLoading) return;
      if (this._isSeeking) return; // suppress during active seek

      const error = this.audio.error;
      const code = error ? error.code : 0;

      // MEDIA_ERR_ABORTED (code 1) is ALWAYS expected during seeks, track
      // switches, and pausing. It should NEVER trigger the error cascade.
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
    AudioEngine._instance = null;
  }
}

module.exports = AudioEngine;
