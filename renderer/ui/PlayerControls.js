/**
 * NovaTune — Player Controls UI Controller
 * Manages the bottom now-playing bar: play/pause, next, previous,
 * div-based seek bar, div-based volume control, shuffle, and repeat.
 */

class PlayerControls {
  constructor() {
    // DOM Elements
    this.playPauseBtn = document.querySelector('[data-action="play-pause"]');
    this.nextBtn = document.querySelector('.np-btn[data-action="next"]');
    this.prevBtn = document.querySelector('.np-btn[data-action="previous"]');
    this.shuffleBtn = document.querySelector('.np-btn[data-action="shuffle"]');
    this.repeatBtn = document.querySelector('.np-btn[data-action="repeat"]');

    // Seek bar is now a div
    this.seekBar = document.getElementById("progress-bar");
    this.progressFill = this.seekBar
      ? this.seekBar.querySelector(".progress-fill")
      : null;
    this.volumeBar = document.getElementById("vol-bar");
    this.volFill = this.volumeBar
      ? this.volumeBar.querySelector(".vol-fill")
      : null;
    this.currentTimeEl = document.getElementById("np-time-current");
    this.durationEl = document.getElementById("np-time-total");
    this.volumeIcon = document.getElementById("vol-btn");

    this.trackTitleEl = document.getElementById("track-title");
    this.trackArtistEl = document.getElementById("track-artist");
    this.coverArtEl = document.getElementById("cover-art");
    this.coverArtContainer = document.getElementById("cover-art-container");

    // State
    this._isDraggingSeek = false;
    this._isDraggingVolume = false;
    this._shuffleEnabled = false;
    this._repeatMode = "off";
    this._audioEngine = null;
    this._handlers = {};
    this._callbacks = {};
    this._isPlaying = false;

    // Inject squiggle SVG into seek bar
    this._waveSvg = null;
    this._wavePath = null;
    this._injectWaveSvg();
  }

  _injectWaveSvg() {
    if (!this.progressFill) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("progress-wave-svg");
    svg.setAttribute("height", "10");
    svg.setAttribute("width", "200");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("progress-wave-path");
    // Repeating sine wave tiles: amplitude 3px, period 20px
    path.setAttribute("stroke-dasharray", "20");
    path.setAttribute("d", this._buildWavePath(200));
    svg.appendChild(path);

    // Hidden by default; shown when playing
    svg.style.display = "none";
    this.progressFill.appendChild(svg);
    this._waveSvg = svg;
    this._wavePath = path;
  }

  _buildWavePath(width) {
    // Sine wave: M 0,5 tiles of C control points, amplitude ±3px, period 20px
    let d = "M 0,5";
    for (let x = 0; x < width + 20; x += 20) {
      d += ` C ${x + 5},2 ${x + 10},8 ${x + 20},5`;
    }
    return d;
  }

  _syncWaveWidth() {
    if (!this._waveSvg || !this._wavePath || !this.progressFill) return;
    const w = Math.max(20, this.progressFill.offsetWidth);
    this._waveSvg.setAttribute("width", w);
    this._wavePath.setAttribute("d", this._buildWavePath(w));
  }

  init(audioEngine, callbacks = {}) {
    this._audioEngine = audioEngine;
    this._callbacks = callbacks;

    // ─── Play/Pause ──────────────────────────────────────────
    this._addHandler(this.playPauseBtn, "click", () => {
      this._callbacks.onPlayPause?.();
    });

    // ─── Next / Previous ────────────────────────────────────
    this._addHandler(this.nextBtn, "click", () => {
      this._callbacks.onNext?.();
    });
    this._addHandler(this.prevBtn, "click", () => {
      this._callbacks.onPrevious?.();
    });

    // ─── Shuffle ────────────────────────────────────────────
    this._addHandler(this.shuffleBtn, "click", () => {
      this._shuffleEnabled = !this._shuffleEnabled;
      this.setShuffle(this._shuffleEnabled);
    });

    // ─── Repeat ─────────────────────────────────────────────
    this._addHandler(this.repeatBtn, "click", () => {
      const modes = ["off", "all", "one"];
      const currentIdx = modes.indexOf(this._repeatMode);
      this._repeatMode = modes[(currentIdx + 1) % modes.length];
      this.setRepeatMode(this._repeatMode);
      this._callbacks.onRepeatChange?.(this._repeatMode);
    });

    // ─── Seek Bar (div-based) ──────────────────────────────
    if (this.seekBar) {
      this._addHandler(this.seekBar, "mousedown", (e) => {
        this._isDraggingSeek = true;
        this._seekFromEvent(e);
        const moveHandler = (ev) => {
          if (this._isDraggingSeek) this._seekFromEvent(ev);
        };
        const upHandler = () => {
          this._isDraggingSeek = false;
          document.removeEventListener("mousemove", moveHandler);
          document.removeEventListener("mouseup", upHandler);
        };
        document.addEventListener("mousemove", moveHandler);
        document.addEventListener("mouseup", upHandler);
      });
    }

    // ─── Volume Bar (div-based) ─────────────────────────────
    if (this.volumeBar) {
      this._addHandler(this.volumeBar, "mousedown", (e) => {
        this._isDraggingVolume = true;
        this._volumeFromEvent(e);
        const moveHandler = (ev) => {
          if (this._isDraggingVolume) this._volumeFromEvent(ev);
        };
        const upHandler = () => {
          this._isDraggingVolume = false;
          document.removeEventListener("mousemove", moveHandler);
          document.removeEventListener("mouseup", upHandler);
        };
        document.addEventListener("mousemove", moveHandler);
        document.addEventListener("mouseup", upHandler);
      });
    }

    // ─── Volume Icon Click (mute toggle) ────────────────────
    if (this.volumeIcon) {
      this._addHandler(this.volumeIcon, "click", () => {
        const currentVol = this._audioEngine.getVolume();
        if (currentVol > 0) {
          this._previousVolume = currentVol;
          this._audioEngine.setVolume(0);
          this.setVolume(0);
        } else {
          const restore = this._previousVolume || 0.8;
          this._audioEngine.setVolume(restore);
          this.setVolume(restore);
        }
      });
    }

    // ─── Cover Art Click (toggle now playing overlay) ──────
    if (this.coverArtContainer) {
      this._addHandler(this.coverArtContainer, "click", () => {
        this._callbacks.onCoverArtClick?.();
      });
    }

    // ─── Keyboard Shortcuts ─────────────────────────────────
    this._addHandler(document, "keydown", (e) => {
      if (
        e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA" ||
        e.target.tagName === "SELECT"
      )
        return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          this._callbacks.onPlayPause?.();
          break;
        case "ArrowRight":
          if (e.shiftKey) {
            this._callbacks.onNext?.();
          } else {
            const seekTo = Math.min(
              this._audioEngine.getCurrentTime() + 5,
              this._audioEngine.getDuration(),
            );
            this._audioEngine.seek(seekTo);
          }
          break;
        case "ArrowLeft":
          if (e.shiftKey) {
            this._callbacks.onPrevious?.();
          } else {
            const seekTo = Math.max(this._audioEngine.getCurrentTime() - 5, 0);
            this._audioEngine.seek(seekTo);
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          this._audioEngine.setVolume(
            Math.min(1, this._audioEngine.getVolume() + 0.05),
          );
          this.setVolume(this._audioEngine.getVolume());
          break;
        case "ArrowDown":
          e.preventDefault();
          this._audioEngine.setVolume(
            Math.max(0, this._audioEngine.getVolume() - 0.05),
          );
          this.setVolume(this._audioEngine.getVolume());
          break;
        case "KeyM":
          this.volumeIcon?.click();
          break;
      }
    });
  }

  /**
   * Seek from a mouse event on the progress bar div.
   * @private
   */
  _seekFromEvent(e) {
    if (!this.seekBar || !this._audioEngine) return;
    const rect = this.seekBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const duration = this._audioEngine.getDuration() || 1;
    const time = pct * duration;
    this._callbacks.onSeek?.(time);
    this.updateTimeDisplay(time, duration);
    if (this.progressFill) this.progressFill.style.width = pct * 100 + "%";
  }

  /**
   * Set volume from a mouse event on the volume bar div.
   * @private
   */
  _volumeFromEvent(e) {
    if (!this.volumeBar || !this._audioEngine) return;
    const rect = this.volumeBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this._audioEngine.setVolume(pct);
    this.setVolume(pct);
  }

  updateTrack(track) {
    if (this.trackTitleEl) {
      this.trackTitleEl.textContent = track.title || "No track selected";
      this.trackTitleEl.title = track.title || "";
    }
    if (this.trackArtistEl) {
      this.trackArtistEl.textContent = track.artist || "Unknown Artist";
    }
    if (this.coverArtEl) {
      if (track.coverArt) {
        this.coverArtEl.src = track.coverArt;
        this.coverArtEl.onerror = () => {
          this.coverArtEl.src = "../assets/default-cover.png";
        };
      } else {
        this.coverArtEl.src = "../assets/default-cover.png";
      }
    }

    // Reset seek bar
    if (this.progressFill) this.progressFill.style.width = "0%";
    if (this.currentTimeEl) this.currentTimeEl.textContent = "0:00";
    if (this.durationEl) this.durationEl.textContent = "0:00";
  }

  updateProgress(currentTime, duration) {
    if (this._isDraggingSeek) return;

    const pct =
      isFinite(duration) && duration > 0 ? (currentTime / duration) * 100 : 0;
    if (this.progressFill) this.progressFill.style.width = pct + "%";
    this.updateTimeDisplay(currentTime, duration);
    this._syncWaveWidth();
  }

  updateTimeDisplay(currentTime, duration) {
    if (this.currentTimeEl)
      this.currentTimeEl.textContent = this._formatTime(currentTime);
    if (this.durationEl)
      this.durationEl.textContent = this._formatTime(duration);
  }

  updatePlayState(isPlaying) {
    this._isPlaying = isPlaying;
    if (this._waveSvg) {
      this._waveSvg.style.display = isPlaying ? "block" : "none";
    }
    if (this.playPauseBtn) {
      this.playPauseBtn.innerHTML = isPlaying
        ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
      this.playPauseBtn.setAttribute("data-playing", isPlaying);
    }
  }

  setVolume(volume) {
    const pct = Math.max(0, Math.min(1, volume)) * 100;
    if (this.volFill) this.volFill.style.width = pct + "%";
    if (this.volumeIcon) {
      let icon;
      if (volume === 0) {
        icon =
          '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
      } else if (volume < 0.5) {
        icon =
          '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/></svg>';
      } else {
        icon =
          '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
      }
      this.volumeIcon.innerHTML = icon;
    }
  }

  setShuffle(enabled) {
    this._shuffleEnabled = enabled;
    if (this.shuffleBtn) {
      this.shuffleBtn.classList.toggle("active", enabled);
      this.shuffleBtn.setAttribute("aria-pressed", enabled);
    }
  }

  setRepeatMode(mode) {
    this._repeatMode = mode;
    if (this.repeatBtn) {
      this.repeatBtn.classList.toggle("active", mode !== "off");
      this.repeatBtn.setAttribute("data-mode", mode);

      let icon;
      if (mode === "off") {
        icon =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
      } else if (mode === "all") {
        icon =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
      } else {
        icon =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="15" text-anchor="middle" font-size="8" font-weight="bold" fill="currentColor" stroke="none">1</text></svg>';
      }
      this.repeatBtn.innerHTML = icon;
    }
  }

  updateSeekBarDragging(isDragging) {
    // Kept for API compatibility — not used with div-based bar
  }

  get shuffleEnabled() {
    return this._shuffleEnabled;
  }
  get repeatMode() {
    return this._repeatMode;
  }

  _formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  _addHandler(element, event, handler) {
    if (!element) return;
    element.addEventListener(event, handler);
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push({ element, handler });
  }

  destroy() {
    for (const [event, entries] of Object.entries(this._handlers)) {
      for (const { element, handler } of entries) {
        element.removeEventListener(event, handler);
      }
    }
    this._handlers = {};
  }
}

module.exports = PlayerControls;
