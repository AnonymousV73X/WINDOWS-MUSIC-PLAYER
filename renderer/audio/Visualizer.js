/**
 * NovaTune — Audio Visualizer
 * Real-time audio visualization using Canvas 2D and AnalyserNode data.
 * Supports multiple visualization styles: bars, wave, and circle.
 */

class Visualizer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {AnalyserNode} analyserNode
   * @param {{ style?: string, colors?: string[], backgroundColor?: string, sensitivity?: number }} options
   */
  constructor(canvas, analyserNode, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.analyserNode = analyserNode;

    this.style = options.style || "bars";
    this.colors = options.colors || ["#1DB954", "#1ed760"];
    this.backgroundColor = options.backgroundColor || "transparent";
    this.sensitivity = options.sensitivity || 1.0;

    this._animationId = null;
    this._isRunning = false;
    this._fps = 0;
    this._frameCount = 0;
    this._lastFpsUpdate = 0;

    // Smooth data arrays for animation easing
    this._smoothedFrequency = null;
    this._smoothedTimeDomain = null;

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(canvas.parentElement || canvas);

    this.resize();
  }

  /**
   * Start the visualization animation loop.
   */
  start() {
    if (this._isRunning) return;
    this._isRunning = true;
    this._lastFpsUpdate = performance.now();
    this._animate();
  }

  /**
   * Stop the visualization animation loop.
   */
  stop() {
    this._isRunning = false;
    if (this._animationId) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Change the visualization style.
   * @param {'bars'|'wave'|'circle'} style
   */
  setStyle(style) {
    this.style = style;
  }

  /**
   * Change the visualization colors.
   * @param {string[]} colors - Array of at least 2 color strings
   */
  setColors(colors) {
    if (Array.isArray(colors) && colors.length >= 2) {
      this.colors = colors;
    }
  }

  /**
   * Set the visualization sensitivity.
   * @param {number} sensitivity - Multiplier (0.1 to 3.0)
   */
  setSensitivity(sensitivity) {
    this.sensitivity = Math.max(0.1, Math.min(3.0, sensitivity));
  }

  /**
   * Resize the canvas to match its display size.
   */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this._displayWidth = rect.width;
    this._displayHeight = rect.height;
  }

  /**
   * Main animation loop.
   * PERFORMANCE: Pre-allocated data buffers to eliminate per-frame GC pressure.
   * The old code created 2 new Uint8Array(4096) per frame = 120 allocations/sec
   * at 60fps. Pre-allocating reduces this to zero.
   * @private
   */
  _animate() {
    if (!this._isRunning) return;

    this._animationId = requestAnimationFrame(() => this._animate());

    // FPS counter
    this._frameCount++;
    const now = performance.now();
    if (now - this._lastFpsUpdate >= 1000) {
      this._fps = this._frameCount;
      this._frameCount = 0;
      this._lastFpsUpdate = now;
    }

    // Get audio data using pre-allocated buffers
    const binCount = this.analyserNode.frequencyBinCount;
    if (!this._freqBuffer || this._freqBuffer.length !== binCount) {
      this._freqBuffer = new Uint8Array(binCount);
      this._tdBuffer = new Uint8Array(binCount);
    }
    this.analyserNode.getByteFrequencyData(this._freqBuffer);
    this.analyserNode.getByteTimeDomainData(this._tdBuffer);

    // Smooth the data for nicer animations
    this._smoothedFrequency = this._smoothData(
      this._freqBuffer,
      this._smoothedFrequency,
      0.15,
    );
    this._smoothedTimeDomain = this._smoothData(
      this._tdBuffer,
      this._smoothedTimeDomain,
      0.3,
    );

    // Clear canvas
    this.ctx.clearRect(0, 0, this._displayWidth, this._displayHeight);

    // Draw based on style
    switch (this.style) {
      case "bars":
        this._drawBars(this._smoothedFrequency);
        break;
      case "wave":
        this._drawWave(this._smoothedTimeDomain);
        break;
      case "circle":
        this._drawCircle(this._smoothedFrequency);
        break;
    }
  }

  /**
   * Draw frequency bars visualization.
   * @private
   * @param {Float32Array} data
   */
  _drawBars(data) {
    const width = this._displayWidth;
    const height = this._displayHeight;
    const barCount = Math.min(64, Math.floor(width / 6));
    const barWidth = (width / barCount) * 0.7;
    const gap = (width / barCount) * 0.3;
    const sensitivity = this.sensitivity;

    // Use only the lower frequency range (more visually interesting)
    const step = Math.floor(data.length / barCount);

    // Create gradient
    const gradient = this.ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, this.colors[0]);
    gradient.addColorStop(0.5, this.colors[1] || this.colors[0]);
    gradient.addColorStop(1, this._lightenColor(this.colors[0], 40));

    for (let i = 0; i < barCount; i++) {
      // Average nearby frequency bins
      let sum = 0;
      for (let j = 0; j < step; j++) {
        sum += data[i * step + j] || 0;
      }
      const average = (sum / step / 255) * sensitivity;
      const barHeight = Math.max(2, average * height * 0.85);

      const x = i * (barWidth + gap);
      const y = height - barHeight;

      // Draw bar with rounded top
      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      const radius = Math.min(barWidth / 2, 4);
      this.ctx.moveTo(x, height);
      this.ctx.lineTo(x, y + radius);
      this.ctx.quadraticCurveTo(x, y, x + radius, y);
      this.ctx.lineTo(x + barWidth - radius, y);
      this.ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
      this.ctx.lineTo(x + barWidth, height);
      this.ctx.closePath();
      this.ctx.fill();

      // Draw reflection (subtle)
      const reflectionGradient = this.ctx.createLinearGradient(
        0,
        height,
        0,
        height + barHeight * 0.3,
      );
      reflectionGradient.addColorStop(0, this._hexToRgba(this.colors[0], 0.15));
      reflectionGradient.addColorStop(1, "transparent");
      this.ctx.fillStyle = reflectionGradient;
      this.ctx.fillRect(x, height, barWidth, barHeight * 0.3);
    }
  }

  /**
   * Draw waveform visualization.
   * @private
   * @param {Float32Array} data
   */
  _drawWave(data) {
    const width = this._displayWidth;
    const height = this._displayHeight;
    const sensitivity = this.sensitivity;
    const centerY = height / 2;

    // Main waveform
    const gradient = this.ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, this.colors[0]);
    gradient.addColorStop(0.5, this.colors[1] || this.colors[0]);
    gradient.addColorStop(1, this.colors[0]);

    this.ctx.beginPath();
    this.ctx.strokeStyle = gradient;
    this.ctx.lineWidth = 2.5;
    this.ctx.lineJoin = "round";
    this.ctx.lineCap = "round";

    const sliceWidth = width / data.length;
    let x = 0;

    for (let i = 0; i < data.length; i++) {
      const v = (data[i] / 128.0 - 1.0) * sensitivity;
      const y = centerY + v * centerY * 0.9;

      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    this.ctx.stroke();

    // Glow effect
    this.ctx.shadowColor = this.colors[0];
    this.ctx.shadowBlur = 12;
    this.ctx.stroke();
    this.ctx.shadowBlur = 0;

    // Fill below the wave with semi-transparent gradient
    this.ctx.lineTo(width, centerY);
    this.ctx.lineTo(0, centerY);
    this.ctx.closePath();
    const fillGradient = this.ctx.createLinearGradient(0, 0, 0, height);
    fillGradient.addColorStop(0, this._hexToRgba(this.colors[0], 0.08));
    fillGradient.addColorStop(0.5, this._hexToRgba(this.colors[0], 0.03));
    fillGradient.addColorStop(1, "transparent");
    this.ctx.fillStyle = fillGradient;
    this.ctx.fill();
  }

  /**
   * Draw circular frequency visualization.
   * @private
   * @param {Float32Array} data
   */
  _drawCircle(data) {
    const width = this._displayWidth;
    const height = this._displayHeight;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.25;
    const sensitivity = this.sensitivity;
    const bars = 128;

    const step = Math.floor(data.length / bars);

    // Inner circle glow
    const glowGradient = this.ctx.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      radius * 1.5,
    );
    glowGradient.addColorStop(0, this._hexToRgba(this.colors[0], 0.05));
    glowGradient.addColorStop(1, "transparent");
    this.ctx.fillStyle = glowGradient;
    this.ctx.fillRect(0, 0, width, height);

    // Draw frequency bars radiating outward
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) {
        sum += data[i * step + j] || 0;
      }
      const average = (sum / step / 255) * sensitivity;

      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const barLength = Math.max(2, average * radius * 1.2);

      const x1 = centerX + Math.cos(angle) * radius;
      const y1 = centerY + Math.sin(angle) * radius;
      const x2 = centerX + Math.cos(angle) * (radius + barLength);
      const y2 = centerY + Math.sin(angle) * (radius + barLength);

      const alpha = 0.3 + average * 0.7;
      this.ctx.strokeStyle = this._hexToRgba(this.colors[0], alpha);
      this.ctx.lineWidth = Math.max(1, ((Math.PI * 2 * radius) / bars) * 0.6);
      this.ctx.lineCap = "round";
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
    }

    // Draw inner circle
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, radius - 1, 0, Math.PI * 2);
    this.ctx.strokeStyle = this._hexToRgba(this.colors[0], 0.3);
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();
  }

  /**
   * Smooth data array for animation easing.
   * @private
   * @param {Uint8Array} newData
   * @param {Float32Array|null} oldData
   * @param {number} smoothingFactor - 0 = no smoothing, 1 = full smoothing
   * @returns {Float32Array}
   */
  _smoothData(newData, oldData, smoothingFactor) {
    if (!oldData || oldData.length !== newData.length) {
      return new Float32Array(newData);
    }
    for (let i = 0; i < newData.length; i++) {
      oldData[i] += (newData[i] - oldData[i]) * (1 - smoothingFactor);
    }
    return oldData;
  }

  /**
   * Lighten a hex color by adding to RGB values.
   * @private
   */
  _lightenColor(hex, amount) {
    const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
    const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
    const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  /**
   * Convert hex color to rgba string.
   * @private
   */
  _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * Get current FPS.
   * @returns {number}
   */
  get fps() {
    return this._fps;
  }

  /**
   * Clean up resources.
   */
  destroy() {
    this.stop();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
  }
}

module.exports = Visualizer;
