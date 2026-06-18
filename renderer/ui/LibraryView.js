/**
 * NovaTune — Library View UI Controller
 * Renders track library with new grid-based track rows (thumb + info + cells + menu).
 * Includes scanning progress bar overlay.
 */

class LibraryView {
  constructor() {
    this.container = document.getElementById('library-content');
    this.headerRow = document.getElementById('library-header');
    this.emptyState = document.getElementById('library-empty');

    this._tracks = [];
    this._filteredTracks = [];
    this._selectedTrackId = null;
    this._currentPlayingId = null;
    this._sortField = 'title';
    this._sortDirection = 'asc';
    this._filterQuery = '';
    this._callbacks = {};
    this._handlers = [];

    this._defaultCover = '../assets/default-cover.png';

    // Progress bar elements
    this._progressOverlay = null;
    this._createProgressOverlay();
  }

  _createProgressOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'scan-progress-overlay';
    overlay.className = 'scan-progress-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="scan-progress-card">
        <div class="scan-progress-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="var(--green)" class="scan-icon-svg">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
          </svg>
          <div class="scan-pulse-ring"></div>
        </div>
        <div class="scan-progress-info">
          <span id="scan-progress-title" class="scan-progress-title">Scanning...</span>
          <span id="scan-progress-detail" class="scan-progress-detail">Preparing...</span>
        </div>
        <div class="scan-progress-bar-track">
          <div id="scan-progress-bar-fill" class="scan-progress-bar-fill" style="width: 0%"></div>
        </div>
        <div class="scan-progress-stats">
          <span id="scan-progress-files" class="scan-progress-stat">0 / 0 files</span>
          <span id="scan-progress-time" class="scan-progress-stat">0.0s</span>
          <span id="scan-progress-pct" class="scan-progress-stat">0%</span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this._progressOverlay = overlay;
  }

  updateProgress(data) {
    if (!this._progressOverlay) return;

    const titleEl = document.getElementById('scan-progress-title');
    const detailEl = document.getElementById('scan-progress-detail');
    const barFill = document.getElementById('scan-progress-bar-fill');
    const filesEl = document.getElementById('scan-progress-files');
    const timeEl = document.getElementById('scan-progress-time');
    const pctEl = document.getElementById('scan-progress-pct');

    switch (data.stage) {
      case 'scanning':
        this._progressOverlay.style.display = 'flex';
        if (titleEl) titleEl.textContent = 'Scanning Folder...';
        if (detailEl) detailEl.textContent = data.message || 'Looking for audio files...';
        if (barFill) { barFill.style.width = '0%'; barFill.classList.remove('indeterminate'); barFill.style.animation = 'none'; }
        if (filesEl) filesEl.textContent = '...';
        if (timeEl) timeEl.textContent = '';
        if (pctEl) pctEl.textContent = '';
        break;

      case 'reading':
        this._progressOverlay.style.display = 'flex';
        if (titleEl) titleEl.textContent = 'Reading Metadata...';
        if (detailEl) { const c = data.current || 0, t = data.total || 0; detailEl.textContent = data.message || `Processing ${c} of ${t}`; }
        if (barFill) { barFill.classList.remove('indeterminate'); barFill.style.animation = 'none'; const pct = data.percent || Math.round(((data.current || 0) / Math.max(data.total || 1)) * 100); barFill.style.width = pct + '%'; }
        if (filesEl) filesEl.textContent = `${data.current || 0} / ${data.total || 0} files`;
        if (timeEl) timeEl.textContent = (data.elapsed || '0') + 's';
        if (pctEl) pctEl.textContent = (data.percent || 0) + '%';
        break;

      case 'saving':
        if (titleEl) titleEl.textContent = 'Saving Library...';
        if (detailEl) detailEl.textContent = 'Writing to disk...';
        if (barFill) barFill.style.width = '100%';
        break;

      case 'complete':
        if (titleEl) titleEl.textContent = 'Scan Complete!';
        if (detailEl) detailEl.textContent = data.message || 'Your library has been updated.';
        if (barFill) barFill.style.width = '100%';
        if (filesEl) { filesEl.textContent = `+${data.newTracks || 0} new | ${data.totalTracks || 0} total`; }
        if (timeEl) timeEl.textContent = (data.elapsed || '0') + 's';
        if (pctEl) { pctEl.textContent = data.failedCount ? `${data.failedCount} failed` : 'Done!'; }
        setTimeout(() => { this.hideProgress(); }, 3000);
        break;

      case 'error':
        if (titleEl) titleEl.textContent = 'Scan Error';
        if (detailEl) detailEl.textContent = data.message || 'Something went wrong.';
        if (barFill) { barFill.style.width = '100%'; barFill.style.background = 'var(--danger, #e74c3c)'; }
        setTimeout(() => { this.hideProgress(); }, 5000);
        break;
    }
  }

  showProgress() {
    if (this._progressOverlay) {
      const barFill = document.getElementById('scan-progress-bar-fill');
      if (barFill) barFill.style.background = '';
      this._progressOverlay.style.display = 'flex';
    }
  }

  hideProgress() {
    if (this._progressOverlay) { this._progressOverlay.style.display = 'none'; }
  }

  init(tracks, callbacks = {}) {
    this._callbacks = callbacks;
    this.setTracks(tracks);
    this._initHeaderSort();
  }

  setTracks(tracks) {
    this._tracks = Array.isArray(tracks) ? [...tracks] : [];
    this._applyFilterAndSort();
    this.render();
  }

  filterTracks(query) {
    this._filterQuery = (query || '').toLowerCase().trim();
    this._applyFilterAndSort();
    this.render();
  }

  sortTracks(field, direction) {
    if (this._sortField === field && !direction) {
      this._sortDirection = this._sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this._sortField = field;
      this._sortDirection = direction || 'asc';
    }
    this._applyFilterAndSort();
    this.render();
    this._updateHeaderSortIndicators();
  }

  _applyFilterAndSort() {
    let result = [...this._tracks];
    if (this._filterQuery) {
      result = result.filter(track => {
        return (
          (track.title || '').toLowerCase().includes(this._filterQuery) ||
          (track.artist || '').toLowerCase().includes(this._filterQuery) ||
          (track.album || '').toLowerCase().includes(this._filterQuery) ||
          (track.genre || '').toLowerCase().includes(this._filterQuery)
        );
      });
    }
    const field = this._sortField;
    const dir = this._sortDirection === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      let valA, valB;
      switch (field) {
        case 'title': valA = (a.title || '').toLowerCase(); valB = (b.title || '').toLowerCase(); break;
        case 'artist': valA = (a.artist || '').toLowerCase(); valB = (b.artist || '').toLowerCase(); break;
        case 'album': valA = (a.album || '').toLowerCase(); valB = (b.album || '').toLowerCase(); break;
        case 'duration': return ((a.duration || 0) - (b.duration || 0)) * dir;
        case 'dateAdded': return ((a.dateAdded || 0) - (b.dateAdded || 0)) * dir;
        default: valA = (a[field] || '').toLowerCase(); valB = (b[field] || '').toLowerCase();
      }
      if (valA < valB) return -1 * dir;
      if (valA > valB) return 1 * dir;
      return 0;
    });
    this._filteredTracks = result;
  }

  render() {
    if (!this.container) return;

    // Show/hide empty state
    if (this.emptyState) {
      const isEmpty = this._tracks.length === 0;
      const noResults = this._tracks.length > 0 && this._filteredTracks.length === 0;
      this.emptyState.style.display = isEmpty || noResults ? 'flex' : 'none';
      if (noResults) {
        this.emptyState.innerHTML = `
          <div class="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="var(--text-muted)">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
          </div>
          <p class="empty-state-text">No tracks match your search</p>
          <p class="empty-state-sub">Try a different search term</p>
        `;
      } else if (isEmpty) {
        this.emptyState.innerHTML = `
          <div class="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="var(--text-muted)">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
          <p class="empty-state-text">Your library is empty</p>
          <p class="empty-state-sub">Click "Add Music" or "Scan Folder" to get started</p>
        `;
      }
    }

    if (this._filteredTracks.length === 0) {
      this.container.innerHTML = '';
      return;
    }

    const fragment = document.createDocumentFragment();

    this._filteredTracks.forEach((track, index) => {
      const row = document.createElement('div');
      row.className = 'track-row';
      row.dataset.trackId = track.id;

      if (track.id === this._selectedTrackId) row.classList.add('selected');
      if (track.id === this._currentPlayingId) row.classList.add('active');

      const isActive = track.id === this._currentPlayingId;
      const coverSrc = track.coverArt || this._defaultCover;

      row.innerHTML = `
        <div class="track-thumb">
          <img src="${coverSrc}" alt="" loading="lazy" onerror="this.src='${this._defaultCover}'">
          <div class="eq-icon">
            <span class="eq-bar"></span>
            <span class="eq-bar"></span>
            <span class="eq-bar"></span>
          </div>
        </div>
        <div class="track-info">
          <span class="track-name" title="${this._escapeHtml(track.title || '')}">${this._escapeHtml(track.title || 'Unknown')}</span>
        </div>
        <span class="track-cell hide-md" title="${this._escapeHtml(track.artist || '')}">${this._escapeHtml(track.artist || 'Unknown Artist')}</span>
        <span class="track-cell hide-md" title="${this._escapeHtml(track.album || '')}">${this._escapeHtml(track.album || 'Unknown Album')}</span>
        <span class="track-cell muted hide-sm">${this._formatDuration(track.duration || 0)}</span>
        <span class="track-cell" style="visibility:hidden;">spacer</span>
        <span class="track-cell" style="visibility:hidden;">spacer</span>
        <button class="track-menu" title="Add to playlist">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      `;

      // Double click to play
      const dblClickHandler = (e) => {
        if (e.target.closest('.track-menu')) return;
        this._selectedTrackId = track.id;
        this._callbacks.onTrackPlay?.(track, index);
        this.render();
      };

      // Single click to select
      const clickHandler = (e) => {
        if (e.target.closest('.track-menu')) return;
        this._selectedTrackId = track.id;
        this._callbacks.onTrackSelect?.(track, index);
        this.container.querySelectorAll('.track-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
      };

      // Right click context menu
      const contextHandler = (e) => {
        e.preventDefault();
        this._selectedTrackId = track.id;
        this._callbacks.onContextMenu?.(e, track);
      };

      // Track menu button click
      const menuBtn = row.querySelector('.track-menu');
      if (menuBtn) {
        const menuHandler = (e) => {
          e.stopPropagation();
          this._selectedTrackId = track.id;
          this._callbacks.onContextMenu?.(e, track);
        };
        menuBtn.addEventListener('click', menuHandler);
        this._handlers.push({ el: menuBtn, ev: 'click', fn: menuHandler });
      }

      row.addEventListener('dblclick', dblClickHandler);
      row.addEventListener('click', clickHandler);
      row.addEventListener('contextmenu', contextHandler);
      this._handlers.push(
        { el: row, ev: 'dblclick', fn: dblClickHandler },
        { el: row, ev: 'click', fn: clickHandler },
        { el: row, ev: 'contextmenu', fn: contextHandler }
      );

      fragment.appendChild(row);
    });

    this.container.innerHTML = '';
    this.container.appendChild(fragment);
  }

  setNowPlaying(trackId) {
    this._currentPlayingId = trackId;
    this.container.querySelectorAll('.track-row').forEach(row => {
      const id = row.dataset.trackId;
      row.classList.toggle('active', id === trackId);
      const eqIcon = row.querySelector('.eq-icon');
      if (eqIcon) {
        eqIcon.style.display = id === trackId ? 'flex' : 'none';
      }
    });
  }

  updateProgress(currentTime, duration) {
    // Update individual track progress overlay (if needed)
    // Currently handled by PlayerControls
  }

  highlightTrack(trackId) {
    this._selectedTrackId = trackId;
    const row = this.container.querySelector(`[data-track-id="${trackId}"]`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('selected');
      row.classList.add('highlight-flash');
      setTimeout(() => row.classList.remove('highlight-flash'), 1000);
    }
  }

  getSelectedTrack() {
    if (!this._selectedTrackId) return null;
    return this._tracks.find(t => t.id === this._selectedTrackId) || null;
  }

  showLoading() { this.showProgress(); }
  hideLoading() { this.hideProgress(); }

  _initHeaderSort() {
    if (!this.headerRow) return;
    const headers = this.headerRow.querySelectorAll('[data-sort]');
    headers.forEach(header => {
      const handler = () => {
        const field = header.dataset.sort;
        this.sortTracks(field);
      };
      header.addEventListener('click', handler);
      this._handlers.push({ el: header, ev: 'click', fn: handler });
    });
  }

  _updateHeaderSortIndicators() {
    if (!this.headerRow) return;
    this.headerRow.querySelectorAll('[data-sort]').forEach(header => {
      const field = header.dataset.sort;
      const isActive = field === this._sortField;
      header.classList.toggle('sort-active', isActive);
    });
  }

  _formatDuration(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  destroy() {
    for (const { el, ev, fn } of this._handlers) {
      el.removeEventListener(ev, fn);
    }
    this._handlers = [];
    if (this._progressOverlay && this._progressOverlay.parentNode) {
      this._progressOverlay.parentNode.removeChild(this._progressOverlay);
    }
  }
}

module.exports = LibraryView;