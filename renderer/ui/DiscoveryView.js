/**
 * NovaTune — Discovery & Download View
 * Ultra-lightweight UI component matching NovaTune's Spotify-dark aesthetics.
 * Features instant iTunes+Deezer search and one-click 320kbps MP3 download.
 */

class DiscoveryView {
  constructor(container, novaAPI, onPlayTrack) {
    this.container = container;
    this.novaAPI = novaAPI;
    this.onPlayTrack = onPlayTrack;
    this.tracks = [];
    this.currentPreviewAudio = null;
    this.playingTrackId = null;
    this.debounceTimer = null;
    this.downloadStates = new Map(); // trackId -> { status, percent, message, track }
    this._toastTimeout = null;

    this._setupProgressEvents();
  }

  // ── In-App Toast Notification ─────────────────────────────────────────────
  _showToast(message, type = "error") {
    // Remove any existing toast
    const existing = document.getElementById("discovery-toast");
    if (existing) existing.remove();
    if (this._toastTimeout) clearTimeout(this._toastTimeout);

    const isError = type === "error";
    const iconSvg = isError
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0;margin-top:1px"><polyline points="20 6 9 17 4 12"/></svg>`;

    const accentColor = isError ? "#f87171" : "var(--green, #1db954)";
    const bgColor = isError ? "rgba(239,68,68,0.12)" : "rgba(29,185,84,0.12)";
    const borderColor = isError ? "rgba(239,68,68,0.3)" : "rgba(29,185,84,0.3)";

    const toast = document.createElement("div");
    toast.id = "discovery-toast";
    toast.style.cssText = [
      "position:fixed",
      "bottom:100px",
      "left:50%",
      "transform:translateX(-50%) translateY(20px)",
      "z-index:99999",
      `background:${bgColor}`,
      "backdrop-filter:blur(12px)",
      "-webkit-backdrop-filter:blur(12px)",
      `border:1px solid ${borderColor}`,
      "border-radius:12px",
      "padding:12px 20px",
      "display:flex",
      "align-items:flex-start",
      "gap:10px",
      "max-width:420px",
      "width:calc(100vw - 48px)",
      "box-shadow:0 8px 32px rgba(0,0,0,0.5)",
      "font-family:inherit",
      `color:${accentColor}`,
      "font-size:13px",
      "font-weight:500",
      "line-height:1.4",
      "opacity:0",
      "transition:opacity 0.2s ease, transform 0.25s ease",
    ].join(";");

    toast.innerHTML = `
      ${iconSvg}
      <div style="flex:1;min-width:0;color:#fff;opacity:0.9">${message}</div>
      <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.4);padding:0;line-height:1;font-size:16px;flex-shrink:0">✕</button>
    `;

    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateX(-50%) translateY(0)";
    });

    // Auto-dismiss after 5s
    this._toastTimeout = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(-50%) translateY(10px)";
      setTimeout(() => toast.remove(), 250);
    }, 5000);
  }

  _setupProgressEvents() {
    if (this.novaAPI?.on) {
      this.novaAPI.on("discovery:progress", (data) => {
        if (!data || !data.trackId) return;
        const current = this.downloadStates.get(data.trackId) || {};
        const updated = { ...current, ...data };
        this.downloadStates.set(data.trackId, updated);
        this._updateTrackDownloadUI(data.trackId, updated);
      });

      // When main confirms the track is saved & scannable, promote to "done"
      this.novaAPI.on("library:track-added", (parsedTrack) => {
        if (!parsedTrack || !parsedTrack.filePath) return;
        // Find matching download by filePath
        for (const [trackId, state] of this.downloadStates) {
          if (
            state._pendingFilePath &&
            state._pendingFilePath === parsedTrack.filePath
          ) {
            const doneState = {
              status: "done",
              percent: 100,
              track: parsedTrack,
            };
            this.downloadStates.set(trackId, doneState);
            this._updateTrackDownloadUI(trackId, doneState);
            break;
          }
        }
      });
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="discovery-container" style="padding: 24px 32px 48px; box-sizing: border-box; color: var(--text-base); scrollbar-width: none; -ms-overflow-style: none;">
        <!-- Header & Search -->
        <div class="discovery-header" style="margin-bottom: 24px;">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
            <h1 style="font-size: 28px; font-weight: 700; margin: 0; letter-spacing: -0.5px;">Music Search & Download </h1>
            <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; padding: 2px 8px; border-radius: 6px; background: color-mix(in srgb, var(--green, #1ed760) 15%, transparent); color: var(--green, #1ed760); border: 1px solid color-mix(in srgb, var(--green, #1ed760) 30%, transparent); display: inline-flex; align-items: center; gap: 5px;">
              <span style="width: 5px; height: 5px; border-radius: 50%; background: var(--green, #1ed760);"></span>
              Beta
            </span>
          </div>
          <p style="color: var(--text-muted); font-size: 14px; margin: 0 0 20px 0;">
            Search any song and download high-fidelity 320kbps MP3s directly to your library.
          </p>

          <div class="discovery-search-wrap" style="position: relative; width: 100%; max-width: none; display: flex; align-items: center;">
            <input 
              type="text" 
              id="discovery-search-input" 
              placeholder="Search by song name, artist, or paste a Spotify link..." 
              style="width: 100%; height: 46px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 23px; padding: 0 54px 0 20px; color: #fff; font-size: 15px; outline: none; transition: border-color 0.2s;"
            />
            <button 
              id="discovery-search-btn" 
              title="Search" 
              style="position: absolute; right: 6px; top: 5px; width: 36px; height: 36px; background: var(--green); border: none; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #000; transition: transform 0.15s, opacity 0.15s;"
              onmouseenter="this.style.opacity='0.85'; this.style.transform='scale(1.05)'"
              onmouseleave="this.style.opacity='1'; this.style.transform='scale(1)'"
            >
              <svg id="discovery-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px;">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <div id="discovery-search-spinner" style="display: none; width: 18px; height: 18px; border: 2px solid rgba(0,0,0,0.25); border-top-color: #000; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
            </button>
          </div>
        </div>

        <!-- Search Results Grid / List -->
        <div id="discovery-results" style="display: flex; flex-direction: column; gap: 8px;">
          <div style="text-align: center; padding: 60px 0; color: var(--text-muted); font-size: 14px;">
            Type a song or artist above to start discovering music.
          </div>
        </div>
      </div>
    `;

    const input = this.container.querySelector("#discovery-search-input");
    const searchBtn = this.container.querySelector("#discovery-search-btn");
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this._performSearch(input.value);
        }
      });
      input.addEventListener("focus", () => {
        input.style.borderColor = "var(--green)";
      });
      input.addEventListener("blur", () => {
        input.style.borderColor = "rgba(255,255,255,0.1)";
      });
    }
    if (searchBtn) {
      searchBtn.addEventListener("click", () => {
        if (input) this._performSearch(input.value);
      });
    }
  }

  async _performSearch(value) {
    const query = (value || "").trim();
    if (!query) {
      this._renderEmpty(
        "Type a song or artist above to start discovering music.",
      );
      return;
    }

    const spinner = this.container.querySelector("#discovery-search-spinner");
    const icon = this.container.querySelector("#discovery-search-icon");
    const btn = this.container.querySelector("#discovery-search-btn");
    const setBusy = (b) => {
      if (spinner) spinner.style.display = b ? "block" : "none";
      if (icon) icon.style.display = b ? "none" : "";
      if (btn) btn.style.pointerEvents = b ? "none" : "";
    };
    setBusy(true);

    try {
      const res = await this.novaAPI.invoke("discovery:search", query);
      setBusy(false);

      if (res && res.success && Array.isArray(res.results)) {
        this.tracks = res.results;
        this._renderResults(this.tracks);
      } else {
        this._renderEmpty("No results found. Try another query.");
      }
    } catch (err) {
      setBusy(false);
      this._renderEmpty("Error searching tracks: " + err.message);
    }
  }

  _renderEmpty(message) {
    const list = this.container.querySelector("#discovery-results");
    if (!list) return;
    list.innerHTML = `
      <div style="text-align: center; padding: 60px 0; color: var(--text-muted); font-size: 14px;">
        ${message}
      </div>
    `;
  }

  _renderResults(tracks) {
    const list = this.container.querySelector("#discovery-results");
    if (!list) return;

    if (tracks.length === 0) {
      this._renderEmpty("No matching songs found.");
      return;
    }

    list.innerHTML = tracks
      .map((track) => {
        const durationMin = track.durationMs
          ? `${Math.floor(track.durationMs / 60000)}:${String(Math.floor((track.durationMs % 60000) / 1000)).padStart(2, "0")}`
          : "--:--";

        const state = this.downloadStates.get(track.id) || { status: "idle" };
        const isDownloaded = state.status === "done";

        return `
          <div class="discovery-track-row ${isDownloaded ? "is-downloaded" : ""}" data-id="${track.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-radius: 8px; background: rgba(255,255,255,0.03); transition: background 0.15s; cursor: ${isDownloaded ? "pointer" : "default"};">
            <!-- Left: Artwork & Info -->
            <div style="display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1; padding-right: 32px;">
              <div style="position: relative; width: 44px; height: 44px; flex-shrink: 0; border-radius: 4px; overflow: hidden; background: #222;">
                <img src="${track.artworkThumbnail || track.artworkUrl}" alt="" style="width: 100%; height: 100%; object-fit: cover;" />
              </div>

              <div style="min-width: 0; flex: 1; overflow: hidden;">
                <div style="font-weight: 600; font-size: 14px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${track.trackName}
                </div>
                <div style="font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">
                  ${track.artistName} • ${track.albumName || "Single"} ${track.releaseYear ? `(${track.releaseYear})` : ""}
                </div>
              </div>
            </div>

            <!-- Right: Duration & Download CTA -->
            <div style="display: flex; align-items: center; gap: 16px; flex-shrink: 0;">
              <span style="font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums;">
                ${durationMin}
              </span>

              <div class="download-btn-container" id="dl-container-${track.id}">
                ${this._getDownloadButtonHtml(track.id, state)}
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    // Attach listeners
    this._attachResultEvents();
  }

  _getDownloadButtonHtml(trackId, state) {
    if (state.status === "downloading" || state.status === "resolving") {
      return `
        <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--green); font-weight: 500;">
          <div style="width: 14px; height: 14px; border: 2px solid color-mix(in srgb, var(--green) 30%, transparent); border-top-color: var(--green); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          <span>${state.percent || 10}%</span>
        </div>
      `;
    }

    if (state.status === "tagging") {
      return `<span style="font-size: 12px; color: #3b82f6;">Tagging...</span>`;
    }

    if (state.status === "verifying") {
      return `
        <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--green); font-weight: 500;">
          <div style="width: 14px; height: 14px; border: 2px solid color-mix(in srgb, var(--green) 30%, transparent); border-top-color: var(--green); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          <span>Preparing...</span>
        </div>
      `;
    }

    if (state.status === "done") {
      return `
        <button class="action-play-downloaded-btn" data-id="${trackId}" style="background: none; border: none; padding: 4px 8px; cursor: pointer; display: flex; align-items: center; gap: 6px; color: var(--green); font-size: 12px; font-weight: 600; transition: transform 0.15s ease;">
          <svg viewBox="0 0 24 24" fill="currentColor" style="width: 14px; height: 14px;">
            <polygon points="5 3 19 12 5 21" />
          </svg>
          <span>Play</span>
        </button>
      `;
    }

    return `
      <button class="action-download-btn" data-id="${trackId}" style="display: flex; align-items: center; gap: 6px; padding: 6px 14px; background: rgba(255,255,255,0.08); border: none; border-radius: 16px; color: #fff; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>320k MP3</span>
      </button>
    `;
  }

  _attachResultEvents() {
    // 30s audio preview buttons
    this.container.querySelectorAll(".preview-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const url = btn.dataset.url;
        this._togglePreview(id, url, btn);
      });
    });

    // Download buttons
    this.container.querySelectorAll(".action-download-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const track = this.tracks.find((t) => t.id === id);
        if (track) {
          this._startDownload(track);
        }
      });
    });

    // Clicking row of a downloaded song plays it
    this.container.querySelectorAll(".discovery-track-row").forEach((row) => {
      row.addEventListener("mouseenter", () => {
        row.style.background = "rgba(255,255,255,0.08)";
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "rgba(255,255,255,0.03)";
      });

      row.addEventListener("click", (e) => {
        if (
          e.target.closest(".preview-btn") ||
          e.target.closest(".action-download-btn")
        )
          return;
        const id = row.dataset.id;
        const state = this.downloadStates.get(id);
        if (state && state.status === "done" && state.track) {
          if (this.currentPreviewAudio) {
            this.currentPreviewAudio.pause();
            this.currentPreviewAudio = null;
            this.playingTrackId = null;
          }
          if (typeof this.onPlayTrack === "function") {
            this.onPlayTrack(state.track);
          }
        }
      });
    });

    // Play downloaded CTA
    this.container
      .querySelectorAll(".action-play-downloaded-btn")
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const state = this.downloadStates.get(id);
          if (state && state.status === "done" && state.track) {
            if (this.currentPreviewAudio) {
              this.currentPreviewAudio.pause();
              this.currentPreviewAudio = null;
              this.playingTrackId = null;
            }
            if (typeof this.onPlayTrack === "function") {
              this.onPlayTrack(state.track);
            }
          }
        });
      });
  }

  _togglePreview(id, url, buttonEl) {
    if (this.playingTrackId === id) {
      if (this.currentPreviewAudio) {
        this.currentPreviewAudio.pause();
        this.currentPreviewAudio = null;
      }
      this.playingTrackId = null;
      buttonEl.classList.remove("playing");
      buttonEl.style.opacity = "1";
      buttonEl.innerHTML = `<svg viewBox="0 0 24 24" fill="#fff" style="width: 20px; height: 20px;"><polygon points="5,3 19,12 5,21"/></svg>`;
      return;
    }

    if (this.currentPreviewAudio) {
      this.currentPreviewAudio.pause();
      this.container.querySelectorAll(".preview-btn.playing").forEach((b) => {
        b.classList.remove("playing");
        b.style.opacity = "1";
        b.innerHTML = `<svg viewBox="0 0 24 24" fill="#fff" style="width: 20px; height: 20px;"><polygon points="5,3 19,12 5,21"/></svg>`;
      });
    }

    const audio = new Audio(url);
    this.currentPreviewAudio = audio;
    this.playingTrackId = id;
    buttonEl.classList.add("playing");
    buttonEl.style.opacity = "1";
    buttonEl.innerHTML = `<svg viewBox="0 0 24 24" fill="#fff" style="width: 20px; height: 20px;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;

    audio.play().catch((err) => {
      console.warn("Could not play preview audio:", err);
      this._togglePreview(id, url, buttonEl);
    });

    audio.onended = () => {
      this._togglePreview(id, url, buttonEl);
    };
  }

  async _startDownload(track) {
    this.downloadStates.set(track.id, { status: "resolving", percent: 5 });
    this._updateTrackDownloadUI(track.id, { status: "resolving", percent: 5 });

    try {
      const res = await this.novaAPI.invoke("discovery:download", track);
      if (res && res.success) {
        // Show "verifying" state while we wait for library:track-added confirmation
        // that the file is fully saved and scannable before showing the Play button.
        const savedPath = res.filePath;
        const verifyingState = {
          status: "verifying",
          percent: 100,
          _pendingFilePath: savedPath,
          track: res.track || {
            id: track.id,
            title: track.trackName,
            artist: track.artistName,
            album: track.albumName,
            filePath: savedPath,
            duration: track.durationMs
              ? Math.round(track.durationMs / 1000)
              : 0,
            coverArt: track.artworkUrl,
            _hasCoverArt: !!track.artworkUrl,
          },
        };
        this.downloadStates.set(track.id, verifyingState);
        this._updateTrackDownloadUI(track.id, verifyingState);

        // Fallback: if library:track-added doesn't arrive within 4s, promote anyway
        // (handles edge cases where the IPC event was missed)
        setTimeout(() => {
          const current = this.downloadStates.get(track.id);
          if (current && current.status === "verifying") {
            const doneState = {
              status: "done",
              percent: 100,
              track: current.track,
            };
            this.downloadStates.set(track.id, doneState);
            this._updateTrackDownloadUI(track.id, doneState);
          }
        }, 4000);
      } else {
        const msg = res?.error || "Unknown error";
        this._showToast("Download failed: " + msg);
        this.downloadStates.delete(track.id);
        this._updateTrackDownloadUI(track.id, { status: "idle" });
      }
    } catch (err) {
      this._showToast("Download error: " + err.message);
      this.downloadStates.delete(track.id);
      this._updateTrackDownloadUI(track.id, { status: "idle" });
    }
  }

  _updateTrackDownloadUI(trackId, state) {
    const container = this.container.querySelector(`#dl-container-${trackId}`);
    if (container) {
      container.innerHTML = this._getDownloadButtonHtml(trackId, state);
      const row = this.container.querySelector(
        `.discovery-track-row[data-id="${trackId}"]`,
      );
      if (row) {
        if (state.status === "done") {
          row.classList.add("is-downloaded");
          row.style.cursor = "pointer";
        } else {
          row.classList.remove("is-downloaded");
          row.style.cursor = "default";
        }
      }

      // Re-attach download click if idle
      if (state.status === "idle") {
        const btn = container.querySelector(".action-download-btn");
        if (btn) {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const track = this.tracks.find((t) => t.id === trackId);
            if (track) this._startDownload(track);
          });
        }
      }

      // Attach play click if done
      if (state.status === "done") {
        const playBtn = container.querySelector(".action-play-downloaded-btn");
        if (playBtn) {
          playBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (state.track) {
              if (this.currentPreviewAudio) {
                this.currentPreviewAudio.pause();
                this.currentPreviewAudio = null;
                this.playingTrackId = null;
              }
              if (typeof this.onPlayTrack === "function") {
                this.onPlayTrack(state.track);
              }
            }
          });
        }
      }
    }
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = DiscoveryView;
}
