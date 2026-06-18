/**
 * NovaTune — Lyrics Panel UI Controller
 * Displays synchronized and plain-text lyrics with auto-scrolling.
 * Updated for new lyrics panel design (.lyrics-panel, .lyrics-body, .lyric-line).
 */

class LyricsPanel {
  constructor() {
    this.container = document.getElementById("lyrics-panel");
    this.lyricsContent = document.getElementById("lyrics-content");
    this.lyricsToggle = document.getElementById("lyrics-toggle");
    this._lyricsService = null;
    this._syncedLyrics = null;
    this._plainLyrics = "";
    this._currentIndex = -1;
    this._isVisible = false;
    this._fontSize = 18;
    this._handlers = [];
    this._fetchToken = 0;
    this._userScrolling = false;
    this._scrollDebounce = null;
    this._scrollDebounceMs = 1500;

    this._defaultCover = "../assets/default-cover.png";
  }

  init(lyricsService) {
    this._lyricsService = lyricsService;

    // Toggle button
    if (this.lyricsToggle) {
      const handler = () => this.toggle();
      this.lyricsToggle.addEventListener("click", handler);
      this._handlers.push({ el: this.lyricsToggle, ev: "click", fn: handler });
    }

    // Close button inside panel
    const closeBtn = document.getElementById("lyrics-close");
    if (closeBtn) {
      const handler = () => this.toggle(false);
      closeBtn.addEventListener("click", handler);
      this._handlers.push({ el: closeBtn, ev: "click", fn: handler });
    }

    // Manual scroll detection
    if (this.lyricsContent) {
      const scrollHandler = () => {
        this._userScrolling = true;
        if (this._scrollDebounce) clearTimeout(this._scrollDebounce);
        this._scrollDebounce = setTimeout(() => {
          this._userScrolling = false;
        }, this._scrollDebounceMs);
      };
      this.lyricsContent.addEventListener("scroll", scrollHandler);
      this._handlers.push({ el: this.lyricsContent, ev: "scroll", fn: scrollHandler });
    }
  }

  async showLyrics(track) {
    if (!this.container || !this.lyricsContent) return;

    // Bump token — any in-flight fetch for a previous track will be ignored
    const token = ++this._fetchToken;

    // Immediately clear stale lyrics and show spinner
    this._syncedLyrics = null;
    this._plainLyrics = "";
    this._currentIndex = -1;
    this.lyricsContent.innerHTML = `
      <div class="lyrics-loading">
        <div class="spinner-small"></div>
        <p>Loading lyrics...</p>
      </div>
    `;

    try {
      // getLyrics() tries DB → local .lrc → embedded tags → LRCLIB online
      const lyrics = await this._lyricsService.getLyrics(track);

      // Abort if a newer track started loading
      if (token !== this._fetchToken) return;

      if (lyrics && (lyrics.synced || lyrics.plain)) {
        // Guard: synced must be an array
        this._syncedLyrics =
          Array.isArray(lyrics.synced) && lyrics.synced.length > 0
            ? lyrics.synced
            : null;
        this._plainLyrics = lyrics.plain || "";
        this._currentIndex = -1;

        console.log(
          `[LyricsPanel] ${track.artist} - ${track.title} → source: ${lyrics.source}, synced: ${this._syncedLyrics ? this._syncedLyrics.length + " lines" : "none"}, plain: ${this._plainLyrics ? this._plainLyrics.length + " chars" : "none"}`,
        );

        if (this._syncedLyrics) {
          this._renderSyncedLyrics();
        } else if (this._plainLyrics) {
          this._renderPlainLyrics();
        } else {
          this._renderNoLyrics();
        }
      } else {
        console.log(
          `[LyricsPanel] ${track.artist} - ${track.title} → no lyrics found`,
        );
        this._renderNoLyrics();
      }
    } catch (err) {
      if (token !== this._fetchToken) return;
      console.error("[LyricsPanel] showLyrics error:", err);
      this._renderError("Failed to load lyrics");
    }
  }

  update(currentTime) {
    if (!this._syncedLyrics || !this._isVisible || !this.lyricsContent) return;

    let newIndex = -1;
    for (let i = this._syncedLyrics.length - 1; i >= 0; i--) {
      if (currentTime >= this._syncedLyrics[i].time) {
        newIndex = i;
        break;
      }
    }

    if (newIndex !== this._currentIndex) {
      this._currentIndex = newIndex;
      this._highlightCurrentLine();
    }
  }

  toggle(forceState) {
    this._isVisible =
      typeof forceState === "boolean" ? forceState : !this._isVisible;
    if (this.container) {
      this.container.classList.toggle("visible", this._isVisible);
    }
    if (this.lyricsToggle) {
      this.lyricsToggle.classList.toggle("active", this._isVisible);
    }
  }

  setFontSize(size) {
    this._fontSize = Math.max(12, Math.min(32, size));
    if (this.lyricsContent) {
      this.lyricsContent.style.fontSize = `${this._fontSize}px`;
    }
  }

  clear() {
    this._syncedLyrics = null;
    this._plainLyrics = "";
    this._currentIndex = -1;
    if (this.lyricsContent) {
      this.lyricsContent.innerHTML = `
        <div class="lyrics-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="var(--text-muted)">
            <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-1 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8z"/>
          </svg>
          <p>Lyrics will appear here</p>
          <p class="sub">Play a song to see its lyrics</p>
        </div>
      `;
    }
  }

  _renderSyncedLyrics() {
    if (!this.lyricsContent) return;
    if (!Array.isArray(this._syncedLyrics)) {
      this._renderNoLyrics();
      return;
    }

    const lines = this._syncedLyrics
      .map(
        (line, idx) => {
          // Ensure line is an object with text and time properties
          const text = typeof line === 'object' && line !== null ? (line.text || '') : String(line);
          const time = typeof line === 'object' && line !== null ? (line.time || 0) : 0;
          return `<div class="lyric-line" data-index="${idx}" data-time="${time}">${this._escapeHtml(text)}</div>`;
        }
      )
      .join("");

    this.lyricsContent.innerHTML = lines;

    this.lyricsContent.querySelectorAll(".lyric-line").forEach((el) => {
      const handler = () => {
        const time = parseFloat(el.dataset.time);
        this._lyricsService._onLyricSeek?.(time);
      };
      el.addEventListener("click", handler);
      this._handlers.push({ el, ev: "click", fn: handler });
    });
  }

  _renderPlainLyrics() {
    if (!this.lyricsContent) return;

    const lines = this._plainLyrics
      .split("\n")
      .filter((l) => l.trim())
      .map(
        (line) =>
          `<div class="lyric-line plain">${this._escapeHtml(line)}</div>`,
      )
      .join("");

    this.lyricsContent.innerHTML = lines;
  }

  _highlightCurrentLine() {
    if (!this.lyricsContent) return;

    const allLines = this.lyricsContent.querySelectorAll(".lyric-line");
    allLines.forEach((el, idx) => {
      const isCurrent = idx === this._currentIndex;
      el.classList.toggle("active", isCurrent);
      el.classList.toggle("past", idx < this._currentIndex);
    });

    // Only autoscroll if user is not manually scrolling
    if (!this._userScrolling && this._currentIndex >= 0 && allLines[this._currentIndex]) {
      const activeLine = allLines[this._currentIndex];
      const containerHeight = this.lyricsContent.clientHeight;
      const activeTop = activeLine.offsetTop;
      const activeHeight = activeLine.offsetHeight;
      const targetScrollTop =
        activeTop - containerHeight / 2 + activeHeight / 2;
      this.lyricsContent.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: "smooth",
      });
    }
  }

  _renderNoLyrics() {
    if (this.lyricsContent) {
      this.lyricsContent.innerHTML = `
        <div class="lyrics-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="var(--text-muted)">
            <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-1 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8z"/>
          </svg>
          <p>No lyrics available</p>
          <p class="sub">Try placing a .lrc file next to the audio file</p>
        </div>
      `;
    }
  }

  _renderError(message) {
    if (this.lyricsContent) {
      this.lyricsContent.innerHTML = `
        <div class="lyrics-empty error">
          <p>${message}</p>
        </div>
      `;
    }
  }

  _escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  destroy() {
    for (const { el, ev, fn } of this._handlers) {
      el.removeEventListener(ev, fn);
    }
    this._handlers = [];
  }
}

module.exports = LyricsPanel;
