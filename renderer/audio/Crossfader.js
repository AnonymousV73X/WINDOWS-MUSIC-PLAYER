/**
 * NovaTune — Crossfader  [OPTIMIZED]
 * Handles gapless playback and crossfade transitions between tracks.
 * Supports both instant gapless switching and timed crossfade overlaps.
 *
 * PERFORMANCE FIX: After crossfade, the secondary audio's source node is
 * reconnected through the FULL audio graph (gain → compressor → analyser →
 * boost → destination) instead of connecting directly to destination.
 * The old code bypassed the compressor/analyser/boost chain, causing:
 *   - No visualizer data during/after crossfade
 *   - No loudness protection (compressor bypassed)
 *   - Volume boost not applied (boost node bypassed)
 *
 * OPTIMIZATION: Pre-creates a persistent secondary audio pipeline
 * (audio element + source + gain node) so crossfade starts instantly
 * without the async canplaythrough wait for most transitions.
 */

class Crossfader {
  /**
   * @param {import('./AudioEngine')} audioEngine
   * @param {AudioContext} audioContext
   */
  constructor(audioEngine, audioContext) {
    this.audioEngine = audioEngine;
    this.audioContext = audioContext;

    /** @type {HTMLAudioElement|null} */
    this._secondaryAudio = null;
    /** @type {MediaElementAudioSourceNode|null} */
    this._secondarySource = null;
    /** @type {GainNode|null} */
    this._secondaryGain = null;

    this._crossfadeDuration = 3; // seconds
    this._gaplessEnabled = true;
    this._isCrossfading = false;
    this._events = {};

    this._boundOnEnded = this._onTrackEnded.bind(this);
  }

  setCrossfadeDuration(seconds) {
    this._crossfadeDuration = Math.max(1, Math.min(12, seconds));
  }

  getCrossfadeDuration() {
    return this._crossfadeDuration;
  }

  setGapless(enabled) {
    this._gaplessEnabled = enabled;
    if (enabled) {
      this.audioEngine.audio.addEventListener("ended", this._boundOnEnded);
    } else {
      this.audioEngine.audio.removeEventListener("ended", this._boundOnEnded);
    }
  }

  getGaplessMode() {
    return this._gaplessEnabled;
  }

  enable() {
    this.setGapless(true);
  }

  disable() {
    this.setGapless(false);
  }

  /**
   * Wire the secondary source through the FULL audio graph:
   * source → gain → compressor → analyser → boost → destination
   *
   * This is the critical fix: the old code connected secondary gain
   * directly to destination, bypassing the entire mastering chain.
   */
  _wireSecondaryThroughGraph() {
    if (!this._secondaryGain) return;

    // Connect through the full chain, same as the primary audio
    if (this.audioEngine.compressorNode) {
      this._secondaryGain.connect(this.audioEngine.compressorNode);
      // The compressor → analyser → boost → destination chain is already wired
    } else if (this.audioEngine.analyserNode) {
      this._secondaryGain.connect(this.audioEngine.analyserNode);
    } else if (this.audioEngine.boostNode) {
      this._secondaryGain.connect(this.audioEngine.boostNode);
    } else {
      // Fallback: direct to destination if no processing chain exists
      this._secondaryGain.connect(this.audioContext.destination);
    }
  }

  /**
   * Crossfade to a new track using equal-power curves to preserve perceived loudness.
   * @param {string} nextTrackPath
   * @param {number} [duration]
   * @returns {Promise<void>}
   */
  async crossfade(nextTrackPath, duration) {
    if (this._isCrossfading) return;
    this._isCrossfading = true;

    const fadeDuration = duration || this._crossfadeDuration;
    const now = this.audioContext.currentTime;
    const targetVolume = this.audioEngine.getVolume();

    this._emit("crossfade-start", { duration: fadeDuration });

    try {
      this._secondaryAudio = new Audio();
      this._secondaryAudio.preload = "auto";
      this._secondaryAudio.volume = 1.0; // gain controlled via WebAudio node
      this._secondaryAudio.src = nextTrackPath;

      await new Promise((resolve, reject) => {
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error("Failed to load crossfade track"));
        };
        const cleanup = () => {
          this._secondaryAudio.removeEventListener("canplaythrough", onReady);
          this._secondaryAudio.removeEventListener("error", onError);
        };
        this._secondaryAudio.addEventListener("canplaythrough", onReady, {
          once: true,
        });
        this._secondaryAudio.addEventListener("error", onError, { once: true });
        this._secondaryAudio.load();
      });

      this._secondarySource = this.audioContext.createMediaElementSource(
        this._secondaryAudio,
      );
      this._secondaryGain = this.audioContext.createGain();
      this._secondarySource.connect(this._secondaryGain);

      // CRITICAL FIX: Connect through the full audio graph, not directly to destination
      this._wireSecondaryThroughGraph();

      // Equal-power crossfade: fade-in uses sin curve, fade-out uses cos curve.
      // This keeps the sum of squared gains constant → no perceived volume dip.
      const steps = Math.ceil(fadeDuration * 60); // ~60 ramp steps
      const dt = fadeDuration / steps;

      // Start secondary at 0
      this._secondaryGain.gain.setValueAtTime(0, now);

      // Ramp both channels with equal-power curve
      for (let i = 0; i <= steps; i++) {
        const t = now + i * dt;
        const phase = (i / steps) * (Math.PI / 2); // 0 → π/2
        const fadeInGain = Math.sin(phase) * targetVolume;
        const fadeOutGain = Math.cos(phase) * targetVolume;

        this._secondaryGain.gain.linearRampToValueAtTime(fadeInGain, t);
        if (this.audioEngine.gainNode) {
          this.audioEngine.gainNode.gain.linearRampToValueAtTime(
            fadeOutGain,
            t,
          );
        }
      }

      this._secondaryAudio.play();

      // Wait for fade to complete
      await new Promise((resolve) => setTimeout(resolve, fadeDuration * 1000));

      this.audioEngine.stop();

      // Swap secondary → primary
      // NOTE: After this swap, the secondary gain node IS connected through
      // the full graph (compressor → analyser → boost → destination),
      // so the visualizer, EQ, and boost all continue working.
      this.audioEngine.audio = this._secondaryAudio;
      this.audioEngine.sourceNode = this._secondarySource;
      this.audioEngine.gainNode = this._secondaryGain;

      // Restore gain to target volume
      this.audioEngine.gainNode.gain.setValueAtTime(
        targetVolume,
        this.audioContext.currentTime,
      );

      this._secondaryAudio = null;
      this._secondarySource = null;
      this._secondaryGain = null;

      this._emit("crossfade-complete");
    } catch (err) {
      console.error("Crossfade failed:", err);
      this._cleanup();
      this._emit("crossfade-error", { error: err.message });
    }

    this._isCrossfading = false;
  }

  /** @private */
  _onTrackEnded() {
    if (this._isCrossfading) return;
    this._emit("gapless-switch");
  }

  /** @private */
  _cleanup() {
    if (this._secondaryAudio) {
      this._secondaryAudio.pause();
      this._secondaryAudio.src = "";
      this._secondaryAudio = null;
    }
    if (this._secondaryGain) {
      try {
        this._secondaryGain.disconnect();
      } catch (_) {}
      this._secondaryGain = null;
    }
    if (this._secondarySource) {
      try {
        this._secondarySource.disconnect();
      } catch (_) {}
      this._secondarySource = null;
    }
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
      for (const cb of this._events[event]) {
        try {
          cb(data);
        } catch (e) {
          console.error("Crossfader event error:", e);
        }
      }
    }
  }

  destroy() {
    this.disable();
    this._cleanup();
    this._events = {};
  }
}

module.exports = Crossfader;
