/**
 * NovaTune — Now Playing Overlay UI Controller
 * Full-screen immersive overlay with blurred cover bg, lyrics, and controls.
 * Uses `.open` class on `.np-overlay` to toggle visibility.
 */

class NowPlayingOverlay {
  constructor() {
    this.overlay = document.getElementById('now-playing-overlay');
    this.overlayCover = document.getElementById('overlay-cover');
    this.overlayTitle = document.getElementById('overlay-title');
    this.overlayArtist = document.getElementById('overlay-artist');
    this.overlayProgress = document.getElementById('overlay-progress');
    this.overlayTime = document.getElementById('overlay-time');
    this.overlayVisualizer = document.getElementById('overlay-visualizer');
    this.overlayClose = document.getElementById('overlay-close');
    this.overlayBg = document.getElementById('overlay-bg');
    this.overlayMiniCover = document.getElementById('overlay-mini-cover');
    this.overlayMiniTitle = document.getElementById('overlay-mini-title');
    this.overlayMiniArtist = document.getElementById('overlay-mini-artist');
    this.overlayDuration = document.getElementById('overlay-duration');
    this.overlayLyricsScroll = document.getElementById('overlay-lyrics-scroll');

    this._isVisible = false;
    this._audioEngine = null;
    this._visualizer = null;
    this._callbacks = {};
    this._handlers = [];
    this._bgCanvas = document.getElementById('overlay-bg-canvas');
    this._bgCtx = null;
    this._particles = [];
    this._duration = 0;
  }

  init(audioEngine, visualizer, callbacks = {}) {
    this._audioEngine = audioEngine;
    this._visualizer = visualizer;
    this._callbacks = callbacks;

    // Close button
    if (this.overlayClose) {
      const handler = () => this.hide();
      this.overlayClose.addEventListener('click', handler);
      this._handlers.push({ el: this.overlayClose, ev: 'click', fn: handler });
    }

    // Escape key to close
    const escapeHandler = (e) => {
      if (e.key === 'Escape' && this._isVisible) {
        this.hide();
      }
    };
    document.addEventListener('keydown', escapeHandler);
    this._handlers.push({ el: document, ev: 'keydown', fn: escapeHandler });

    // Click on background to close
    if (this.overlay) {
      const bgHandler = (e) => {
        if (e.target === this.overlay || e.target.classList.contains('np-overlay-shade')) {
          this.hide();
        }
      };
      this.overlay.addEventListener('click', bgHandler);
      this._handlers.push({ el: this.overlay, ev: 'click', fn: bgHandler });
    }

    // Initialize background canvas
    this._initBackgroundCanvas();

    // Overlay progress bar seek (div-based)
    if (this.overlayProgress) {
      const barFill = this.overlayProgress.querySelector('.ov-bar-fill');
      const seekHandler = (e) => {
        const rect = this.overlayProgress.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const time = pct * (this._duration || 1);
        this._callbacks.onSeek?.(time);
        if (barFill) barFill.style.width = (pct * 100) + '%';
      };

      const moveHandler = (e) => {
        const rect = this.overlayProgress.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const time = pct * (this._duration || 1);
        if (barFill) barFill.style.width = (pct * 100) + '%';
        this.overlayTime.textContent = this._formatTime(time) + ' / ' + this._formatTime(this._duration);
      };

      const upHandler = () => {
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', upHandler);
      };

      this.overlayProgress.addEventListener('mousedown', (e) => {
        seekHandler(e);
        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('mouseup', upHandler);
      });
    }

    // Play/pause and prev/next buttons in overlay
    this.overlay.querySelectorAll('[data-action="play-pause"]').forEach(btn => {
      const handler = () => {
        // Trigger main play/pause via renderer
        if (this._callbacks.onPlayPause) {
          this._callbacks.onPlayPause();
        }
      };
      btn.addEventListener('click', handler);
      this._handlers.push({ el: btn, ev: 'click', fn: handler });
    });

    this.overlay.querySelectorAll('[data-action="next"]').forEach(btn => {
      const handler = () => { if (this._callbacks.onNext) this._callbacks.onNext(); };
      btn.addEventListener('click', handler);
      this._handlers.push({ el: btn, ev: 'click', fn: handler });
    });

    this.overlay.querySelectorAll('[data-action="previous"]').forEach(btn => {
      const handler = () => { if (this._callbacks.onPrevious) this._callbacks.onPrevious(); };
      btn.addEventListener('click', handler);
      this._handlers.push({ el: btn, ev: 'click', fn: handler });
    });
  }

  show(track) {
    if (!this.overlay) return;

    this._isVisible = true;
    document.body.classList.add('overlay-visible');
    this.overlay.classList.add('open');

    if (track) {
      if (this.overlayTitle) this.overlayTitle.textContent = track.title || '';
      if (this.overlayArtist) this.overlayArtist.textContent = track.artist || '';

      const coverUrl = track.coverArt || '../assets/default-cover.png';
      if (this.overlayCover) {
        this.overlayCover.src = coverUrl;
        this.overlayCover.onerror = () => { this.overlayCover.src = '../assets/default-cover.png'; };
      }
      if (this.overlayMiniCover) {
        this.overlayMiniCover.src = coverUrl;
        this.overlayMiniCover.onerror = () => { this.overlayMiniCover.src = '../assets/default-cover.png'; };
      }
      if (this.overlayMiniTitle) this.overlayMiniTitle.textContent = track.title || '';
      if (this.overlayMiniArtist) this.overlayMiniArtist.textContent = track.artist || '';

      this._duration = track.duration || 0;

      // Set blurred background from cover art
      if (this.overlayBg && track.coverArt) {
        this.overlayBg.style.backgroundImage = `url('${track.coverArt}')`;
      }

      // Reset progress bar fill
      const barFill = this.overlayProgress?.querySelector('.ov-bar-fill');
      if (barFill) barFill.style.width = '0%';
      if (this.overlayTime) this.overlayTime.textContent = '0:00 / ' + this._formatTime(this._duration);
      if (this.overlayDuration) this.overlayDuration.textContent = this._formatTime(this._duration);
    }

    // Start visualizer in overlay
    if (this._visualizer && this.overlayVisualizer) {
      this._visualizer.canvas = this.overlayVisualizer;
      this._visualizer.resize();
      this._visualizer.start();
    }

    this._startBackgroundAnimation();

    // F11 to close
    const fullscreenHandler = (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        this.hide();
      }
    };
    document.addEventListener('keydown', fullscreenHandler);
    this._handlers.push({ el: document, ev: 'keydown', fn: fullscreenHandler });
  }

  hide() {
    if (!this.overlay || !this._isVisible) return;

    this._isVisible = false;
    document.body.classList.remove('overlay-visible');
    this.overlay.classList.remove('open');

    if (this._visualizer) {
      this._visualizer.stop();
    }

    this._stopBackgroundAnimation();
  }

  toggle(track) {
    if (this._isVisible) {
      this.hide();
    } else {
      this.show(track);
    }
  }

  updateProgress(currentTime, duration) {
    if (!this._isVisible) return;

    this._duration = duration;

    // Update overlay progress bar fill
    if (this.overlayProgress) {
      const barFill = this.overlayProgress.querySelector('.ov-bar-fill');
      if (barFill && isFinite(duration) && duration > 0) {
        const pct = (currentTime / duration) * 100;
        barFill.style.width = pct + '%';
      }
    }

    if (this.overlayTime) {
      this.overlayTime.textContent = `${this._formatTime(currentTime)} / ${this._formatTime(duration)}`;
    }
  }

  _initBackgroundCanvas() {
    if (!this._bgCanvas) return;
    this._bgCtx = this._bgCanvas.getContext('2d');
    this._resizeBgCanvas();

    window.addEventListener('resize', () => this._resizeBgCanvas());
  }

  _resizeBgCanvas() {
    if (!this._bgCanvas) return;
    this._bgCanvas.width = window.innerWidth;
    this._bgCanvas.height = window.innerHeight;
  }

  _startBackgroundAnimation() {
    if (this._bgAnimId) return;
    this._initParticles();

    const animate = () => {
      if (!this._isVisible) return;
      this._bgAnimId = requestAnimationFrame(animate);
      this._drawParticles();
    };
    animate();
  }

  _stopBackgroundAnimation() {
    if (this._bgAnimId) {
      cancelAnimationFrame(this._bgAnimId);
      this._bgAnimId = null;
    }
    if (this._bgCtx && this._bgCanvas) {
      this._bgCtx.clearRect(0, 0, this._bgCanvas.width, this._bgCanvas.height);
    }
  }

  _initParticles() {
    this._particles = [];
    const count = 60;
    for (let i = 0; i < count; i++) {
      this._particles.push({
        x: Math.random() * (this._bgCanvas?.width || window.innerWidth),
        y: Math.random() * (this._bgCanvas?.height || window.innerHeight),
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.3 + 0.1
      });
    }
  }

  _drawParticles() {
    if (!this._bgCtx || !this._bgCanvas) return;

    const ctx = this._bgCtx;
    const w = this._bgCanvas.width;
    const h = this._bgCanvas.height;

    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < this._particles.length; i++) {
      for (let j = i + 1; j < this._particles.length; j++) {
        const dx = this._particles[i].x - this._particles[j].x;
        const dy = this._particles[i].y - this._particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 150) {
          const alpha = (1 - dist / 150) * 0.08;
          ctx.strokeStyle = `rgba(29, 185, 84, ${alpha})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(this._particles[i].x, this._particles[i].y);
          ctx.lineTo(this._particles[j].x, this._particles[j].y);
          ctx.stroke();
        }
      }
    }

    for (const p of this._particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.1, p.radius), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(29, 185, 84, ${p.alpha})`;
      ctx.fill();

      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;
    }
  }

  _formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  get isVisible() { return this._isVisible; }

  destroy() {
    this.hide();
    for (const { el, ev, fn } of this._handlers) {
      el.removeEventListener(ev, fn);
    }
    this._handlers = [];
  }
}

module.exports = NowPlayingOverlay;
