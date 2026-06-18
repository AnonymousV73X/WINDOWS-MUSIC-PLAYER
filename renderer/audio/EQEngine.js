/**
 * NovaTune — Equalizer Engine
 * 10-band parametric equalizer using Web Audio API BiquadFilterNodes.
 * Provides fine-grained frequency control for audio playback.
 */

class EQEngine {
  /** Standard 10-band EQ frequencies in Hz */
  static BAND_FREQUENCIES = [
    32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
  ];
  static BAND_LABELS = [
    "32",
    "64",
    "125",
    "250",
    "500",
    "1K",
    "2K",
    "4K",
    "8K",
    "16K",
  ];
  static MIN_GAIN = -12;
  static MAX_GAIN = 12;
  static HEADROOM_DB = -4;

  // Per-band Q values tuned for musical EQ:
  // Low shelf / high shelf at the extremes; peaking in the mid bands.
  // Q = 0.707 for shelves gives a maximally-flat (Butterworth) shelf response.
  // Q = 1.41 (~1 octave bandwidth) for mid peaking bands.
  // Q = 2.0 for upper-mid bands to tighten the boost and reduce bleed.
  static BAND_Q = [0.707, 1.0, 1.41, 1.41, 1.41, 1.41, 1.41, 2.0, 2.0, 0.707];

  // Filter types per band: low shelf for the lowest, high shelf for the highest,
  // peaking for everything in between. Shelves have no phase resonance artifact
  // at the extremes of the audible range.
  static BAND_TYPES = [
    "lowshelf", // 32 Hz
    "peaking", // 64 Hz
    "peaking", // 125 Hz
    "peaking", // 250 Hz
    "peaking", // 500 Hz
    "peaking", // 1 kHz
    "peaking", // 2 kHz
    "peaking", // 4 kHz
    "peaking", // 8 kHz
    "highshelf", // 16 kHz
  ];

  // Smooth time constant for gain automation: 5 ms — fast but click-free
  static TC = 0.005;

  /**
   * @param {AudioContext} audioContext
   * @param {AudioNode} sourceNode - The upstream node (e.g., MediaElementSource)
   * @param {AudioNode} destinationNode - The downstream node (e.g., GainNode)
   */
  constructor(audioContext, sourceNode, destinationNode) {
    this.audioContext = audioContext;
    this.sourceNode = sourceNode;
    this.destinationNode = destinationNode;
    this.filters = [];
    this.preampNode = null;
    this.enabled = true;
    this._gains = new Array(10).fill(0);

    this._createFilters();
    this._connectChain();
  }

  /** @private */
  _createFilters() {
    this.preampNode = this.audioContext.createGain();
    this.preampNode.gain.value = this._dbToLinear(EQEngine.HEADROOM_DB);

    for (let i = 0; i < EQEngine.BAND_FREQUENCIES.length; i++) {
      const filter = this.audioContext.createBiquadFilter();
      filter.type = EQEngine.BAND_TYPES[i];
      filter.frequency.value = EQEngine.BAND_FREQUENCIES[i];
      filter.Q.value = EQEngine.BAND_Q[i];
      filter.gain.value = 0;
      this.filters.push(filter);
    }
  }

  /** @private */
  _connectChain() {
    // Disconnect source from its current downstream before inserting EQ chain
    try {
      this.sourceNode.disconnect();
    } catch (_) {
      /* already disconnected */
    }

    this.sourceNode.connect(this.preampNode);
    this.preampNode.connect(this.filters[0]);
    for (let i = 0; i < this.filters.length - 1; i++) {
      this.filters[i].connect(this.filters[i + 1]);
    }
    this.filters[this.filters.length - 1].connect(this.destinationNode);
  }

  /**
   * Set the gain for a specific EQ band.
   * @param {number} bandIndex - 0–9
   * @param {number} gainDB - Gain in dB (−12 to +12)
   */
  setBandGain(bandIndex, gainDB) {
    if (bandIndex < 0 || bandIndex >= this.filters.length) return;

    const clampedGain = Math.max(
      EQEngine.MIN_GAIN,
      Math.min(EQEngine.MAX_GAIN, gainDB),
    );
    this._gains[bandIndex] = clampedGain;
    this._updateHeadroom();

    if (this.enabled) {
      this.filters[bandIndex].gain.setTargetAtTime(
        clampedGain,
        this.audioContext.currentTime,
        EQEngine.TC,
      );
    }
  }

  /**
   * Set gains for all EQ bands at once.
   * @param {number[]} gains - Array of 10 gain values in dB
   */
  setAllBands(gains) {
    if (!Array.isArray(gains) || gains.length !== 10) return;

    const now = this.audioContext.currentTime;
    for (let i = 0; i < 10; i++) {
      const clampedGain = Math.max(
        EQEngine.MIN_GAIN,
        Math.min(EQEngine.MAX_GAIN, gains[i] || 0),
      );
      this._gains[i] = clampedGain;

      if (this.enabled) {
        this.filters[i].gain.setTargetAtTime(clampedGain, now, EQEngine.TC);
      }
    }
    this._updateHeadroom();
  }

  /**
   * Get the current gain values for all bands.
   * @returns {number[]}
   */
  getAllBands() {
    return [...this._gains];
  }

  /**
   * Reset all bands to flat (0 dB).
   */
  reset() {
    const now = this.audioContext.currentTime;
    for (let i = 0; i < this.filters.length; i++) {
      this._gains[i] = 0;
      this.filters[i].gain.setTargetAtTime(0, now, EQEngine.TC);
    }
    this._updateHeadroom();
  }

  /**
   * Enable or bypass the equalizer.
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    const now = this.audioContext.currentTime;

    if (enabled) {
      this._updateHeadroom();
      for (let i = 0; i < this.filters.length; i++) {
        this.filters[i].gain.setTargetAtTime(this._gains[i], now, EQEngine.TC);
      }
    } else {
      this.preampNode.gain.setTargetAtTime(1, now, EQEngine.TC);
      for (const filter of this.filters) {
        filter.gain.setTargetAtTime(0, now, EQEngine.TC);
      }
    }
  }

  static getFrequencyLabels() {
    return [...EQEngine.BAND_LABELS];
  }

  static getBandFrequencies() {
    return [...EQEngine.BAND_FREQUENCIES];
  }

  static getPresets() {
    // Bands: 32Hz  64Hz  125Hz  250Hz  500Hz  1kHz  2kHz  4kHz  8kHz  16kHz
    return {
      // ── Neutral ───────────────────────────────────────────────────────────
      flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

      // ── Genre ─────────────────────────────────────────────────────────────
      // Rock: punchy sub-bass, scooped mids, air on top
      rock: [4, 3, 2, -1, -2, 0, 2, 4, 4, 3],

      // Pop: hyped low-end, slightly scooped 500 Hz box tone, bright presence
      pop: [2, 2, 1, 0, -1, 0, 1, 2, 3, 3],

      // Hip-Hop / Trap: massive sub, punchy 60 Hz, recessed mids, clear highs
      hiphop: [6, 5, 2, 0, -1, -1, 0, 1, 2, 2],

      // Jazz: warm low-mids, smooth presence, rolled-off extreme highs
      jazz: [2, 2, 1, 2, 1, 0, -1, 0, 1, 1],

      // Classical: flat but open — gentle low shelf, air, no mid coloration
      classical: [3, 2, 0, 0, 0, 0, 0, 0, 2, 3],

      // Electronic / EDM: sub slam, tight bass, prominent highs, 3 kHz clarity
      electronic: [5, 4, 1, 0, -1, 0, 1, 3, 4, 4],

      // R&B / Soul: warm 64 Hz body, smooth upper mids, gentle air
      rnb: [3, 5, 3, 1, 0, -1, 1, 2, 3, 2],

      // Country: tight bass, mid-forward guitar range, open top end
      country: [2, 2, 1, 2, 2, 1, 0, 1, 2, 3],

      // Metal: deep sub cut, thick 120 Hz, scooped 200–500, razor 3–4 kHz
      metal: [6, 4, 0, -2, -3, 0, 1, 5, 5, 4],

      // Latin: punchy bass, warm mids, lively presence for percussion & brass
      latin: [3, 2, 0, 1, 2, 1, 0, 2, 3, 3],

      // Acoustic / Folk: natural low-mid warmth, guitar body, gentle air
      acoustic: [2, 3, 2, 3, 2, 1, 0, 0, 1, 2],

      // ── Use-case ──────────────────────────────────────────────────────────
      // Bass Boost: heavy sub emphasis, falls off cleanly above 250 Hz
      bassBoost: [7, 6, 4, 2, 0, -1, -1, 0, 0, 0],

      // Treble Boost: air and presence boost, natural low-end
      trebleBoost: [0, 0, 0, 0, 0, 0, 2, 3, 5, 6],

      // Vocal / Podcast: cut sub rumble, cut boxy mids, boost 2–4 kHz presence
      vocal: [-3, -2, 0, -2, 1, 3, 4, 3, 1, 0],

      // Loudness: compensates for Fletcher–Munson at low listening volumes
      // (boosted bass and treble, flat mids — classic "loudness" curve)
      loudness: [6, 5, 2, 0, -1, 0, 0, 1, 3, 5],

      // Late Night: cuts highs and sub so you don't wake anyone up
      lateNight: [-2, -1, 0, 0, 0, 1, 2, 1, -1, -3],

      // Headphones: compensates for typical closed-back coloration
      // (slight bass shelve, pulled-back 3 kHz harshness, added air)
      headphones: [3, 2, 1, 0, -1, -1, -2, 0, 2, 4],

      // Speakers / Room: tighter bass (removes boom), gentle presence lift
      speakers: [-1, 1, 2, 1, 0, 0, 1, 2, 1, 0],
    };
  }

  _dbToLinear(db) {
    return Math.pow(10, db / 20);
  }

  _updateHeadroom() {
    if (!this.preampNode || !this.audioContext || !this.enabled) return;
    const maxBoost = Math.max(0, ...this._gains);
    const headroomDb = Math.min(EQEngine.HEADROOM_DB, -maxBoost * 0.7);
    this.preampNode.gain.setTargetAtTime(
      this._dbToLinear(headroomDb),
      this.audioContext.currentTime,
      EQEngine.TC,
    );
  }

  /**
   * Disconnect and destroy all EQ nodes, reconnecting source directly to destination.
   */
  destroy() {
    try {
      this.sourceNode.disconnect();
      if (this.preampNode) this.preampNode.disconnect();
      for (const filter of this.filters) filter.disconnect();
      this.sourceNode.connect(this.destinationNode);
    } catch (_) {
      /* nodes may already be disconnected */
    }
    this.filters = [];
  }
}

module.exports = EQEngine;
