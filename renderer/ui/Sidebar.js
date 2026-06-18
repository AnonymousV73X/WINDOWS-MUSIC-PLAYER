/**
 * NovaTune — Sidebar UI Controller
 * Manages the left sidebar navigation, search bar, and playlist list.
 * Updated for new nav design with stroke-based SVG icons and green active indicator.
 */

class Sidebar {
  constructor() {
    this.container = document.getElementById('sidebar');
    this.searchInput = document.getElementById('search-input');
    this.searchClear = document.getElementById('search-clear');
    this.playlistList = document.getElementById('playlist-list');
    this.createPlaylistBtn = document.getElementById('create-playlist-btn');

    this._playlists = [];
    this._activeSection = 'library';
    this._callbacks = {};
    this._handlers = [];
    this._searchDebounce = null;
    this._searchDebounceMs = 300;
  }

  init(playlists, callbacks = {}) {
    this._callbacks = callbacks;
    this._playlists = playlists || [];
    this._updatePlaylistList();
    this._initNavigation();
    this._initSearch();
    this._initPlaylistActions();
    this._initMobileMenu();
  }

  updatePlaylists(playlists) {
    this._playlists = Array.isArray(playlists) ? [...playlists] : [];
    this._updatePlaylistList();
  }

  setActiveSection(section) {
    this._activeSection = section;

    // Update nav items
    this.container.querySelectorAll('.nav-item[data-section]').forEach(item => {
      item.classList.toggle('active', item.dataset.section === section);
    });

    // Update main content visibility
    this._callbacks.onNavigate?.(section);

    // Close mobile sidebar
    this.container.classList.remove('open');
    const overlay = document.getElementById('sidebar-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  setSearchQuery(query) {
    if (this.searchInput) {
      this.searchInput.value = query || '';
      this._toggleSearchClear(!!query);
    }
  }

  _initNavigation() {
    const navItems = this.container.querySelectorAll('.nav-item[data-section]');
    navItems.forEach(item => {
      const handler = () => {
        const section = item.dataset.section;
        if (section) {
          this.setActiveSection(section);
        }
      };
      item.addEventListener('click', handler);
      this._handlers.push({ el: item, ev: 'click', fn: handler });
    });
  }

  _initSearch() {
    if (!this.searchInput) return;

    const inputHandler = () => {
      const query = this.searchInput.value;
      this._toggleSearchClear(!!query);

      if (this._searchDebounce) clearTimeout(this._searchDebounce);
      this._searchDebounce = setTimeout(() => {
        this._callbacks.onSearch?.(query);
      }, this._searchDebounceMs);
    };

    this.searchInput.addEventListener('input', inputHandler);
    this._handlers.push({ el: this.searchInput, ev: 'input', fn: inputHandler });

    // Clear button
    if (this.searchClear) {
      const clearHandler = () => {
        this.searchInput.value = '';
        this._toggleSearchClear(false);
        this._callbacks.onSearch?.('');
        this.searchInput.focus();
      };
      this.searchClear.addEventListener('click', clearHandler);
      this._handlers.push({ el: this.searchClear, ev: 'click', fn: clearHandler });
    }

    // Focus search on Ctrl+F or /
    const keyboardHandler = (e) => {
      if ((e.ctrlKey && e.key === 'f') || (e.key === '/' && e.target.tagName !== 'INPUT')) {
        e.preventDefault();
        this.searchInput?.focus();
        this.searchInput?.select();
      }
      if (e.key === 'Escape' && document.activeElement === this.searchInput) {
        this.searchInput.blur();
        this.searchInput.value = '';
        this._toggleSearchClear(false);
        this._callbacks.onSearch?.('');
      }
    };
    document.addEventListener('keydown', keyboardHandler);
    this._handlers.push({ el: document, ev: 'keydown', fn: keyboardHandler });
  }

  _initMobileMenu() {
    const menuBtn = document.getElementById('menu-btn');
    const overlay = document.getElementById('sidebar-overlay');
    if (!menuBtn || !overlay) return;

    const toggleHandler = () => {
      this.container.classList.toggle('open');
      overlay.classList.toggle('open');
    };

    menuBtn.addEventListener('click', toggleHandler);
    overlay.addEventListener('click', () => {
      this.container.classList.remove('open');
      overlay.classList.remove('open');
    });
    this._handlers.push(
      { el: menuBtn, ev: 'click', fn: toggleHandler },
      { el: overlay, ev: 'click', fn: () => { this.container.classList.remove('open'); overlay.classList.remove('open'); } }
    );
  }

  _initPlaylistActions() {
    if (this.createPlaylistBtn) {
      const handler = () => {
        this._showCreateDialog();
      };
      this.createPlaylistBtn.addEventListener('click', handler);
      this._handlers.push({ el: this.createPlaylistBtn, ev: 'click', fn: handler });
    }
  }

  _updatePlaylistList() {
    if (!this.playlistList) return;

    this._handlers = this._handlers.filter(h => !h.el.classList?.contains('playlist-item'));

    if (this._playlists.length === 0) {
      this.playlistList.innerHTML = '<div class="playlist-empty"><p>No playlists yet</p></div>';
      return;
    }

    const fragment = document.createDocumentFragment();

    this._playlists.forEach(playlist => {
      const item = document.createElement('div');
      item.className = 'playlist-item';
      item.dataset.playlistId = playlist.id;

      item.innerHTML = `
        <svg class="playlist-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
        </svg>
        <span class="playlist-name">${this._escapeHtml(playlist.name)}</span>
        <span class="playlist-count">${playlist.tracks ? playlist.tracks.length : 0}</span>
      `;

      const clickHandler = () => {
        this.container.querySelectorAll('.playlist-item').forEach(p => p.classList.remove('active'));
        item.classList.add('active');
        this._callbacks.onPlaylistSelect?.(playlist);
      };

      const dblClickHandler = () => {
        this._showRenameDialog(playlist);
      };

      const contextHandler = (e) => {
        e.preventDefault();
        this._showPlaylistContextMenu(e, playlist);
      };

      item.addEventListener('click', clickHandler);
      item.addEventListener('dblclick', dblClickHandler);
      item.addEventListener('contextmenu', contextHandler);
      this._handlers.push(
        { el: item, ev: 'click', fn: clickHandler },
        { el: item, ev: 'dblclick', fn: dblClickHandler },
        { el: item, ev: 'contextmenu', fn: contextHandler }
      );

      fragment.appendChild(item);
    });

    this.playlistList.innerHTML = '';
    this.playlistList.appendChild(fragment);
  }

  _showCreateDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'playlist-create-dialog';
    dialog.innerHTML = `
      <input type="text" class="playlist-input" placeholder="Playlist name..." maxlength="100" autofocus>
      <div class="playlist-dialog-actions">
        <button class="btn btn-small" style="background:var(--surface);color:var(--text-secondary);">Cancel</button>
        <button class="btn btn-small" style="background:var(--green);color:#000;">Create</button>
      </div>
    `;

    const input = dialog.querySelector('.playlist-input');
    const cancelBtn = dialog.querySelector('.btn-small:first-of-type');
    const createBtn = dialog.querySelector('.btn-small:last-of-type');

    const create = () => {
      const name = input.value.trim();
      if (name) this._callbacks.onPlaylistCreate?.(name);
      dialog.remove();
    };

    const cancel = () => dialog.remove();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') create();
      if (e.key === 'Escape') cancel();
    });
    cancelBtn.addEventListener('click', cancel);
    createBtn.addEventListener('click', create);

    this.playlistList.appendChild(dialog);
    input.focus();
  }

  _showRenameDialog(playlist) {
    const dialog = document.createElement('div');
    dialog.className = 'playlist-create-dialog';
    dialog.innerHTML = `
      <input type="text" class="playlist-input" value="${this._escapeHtml(playlist.name)}" maxlength="100" autofocus>
      <div class="playlist-dialog-actions">
        <button class="btn btn-small" style="background:var(--surface);color:var(--text-secondary);">Cancel</button>
        <button class="btn btn-small" style="background:var(--green);color:#000;">Rename</button>
      </div>
    `;

    const input = dialog.querySelector('.playlist-input');
    const cancelBtn = dialog.querySelector('.btn-small:first-of-type');
    const renameBtn = dialog.querySelector('.btn-small:last-of-type');

    input.select();

    const rename = () => {
      const name = input.value.trim();
      if (name && name !== playlist.name) this._callbacks.onPlaylistRename?.(playlist.id, name);
      dialog.remove();
    };

    const cancel = () => dialog.remove();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') rename();
      if (e.key === 'Escape') cancel();
    });
    cancelBtn.addEventListener('click', cancel);
    renameBtn.addEventListener('click', rename);

    this.playlistList.appendChild(dialog);
    input.focus();
  }

  _showPlaylistContextMenu(e, playlist) {
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.top = `${e.clientY}px`;
    menu.style.left = `${e.clientX}px`;

    menu.innerHTML = `
      <div class="context-menu-item" data-action="rename">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        Rename
      </div>
      <div class="context-menu-item danger" data-action="delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        Delete
      </div>
    `;

    const closeMenu = () => menu.remove();
    const renameHandler = () => { this._showRenameDialog(playlist); closeMenu(); };
    const deleteHandler = () => { this._callbacks.onPlaylistDelete?.(playlist.id); closeMenu(); };

    menu.querySelector('[data-action="rename"]').addEventListener('click', renameHandler);
    menu.querySelector('[data-action="delete"]').addEventListener('click', deleteHandler);

    document.addEventListener('click', closeMenu, { once: true });
    document.body.appendChild(menu);
  }

  _toggleSearchClear(show) {
    if (this.searchClear) {
      this.searchClear.style.display = show ? 'flex' : 'none';
    }
  }

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  get activeSection() { return this._activeSection; }

  destroy() {
    for (const { el, ev, fn } of this._handlers) {
      el.removeEventListener(ev, fn);
    }
    this._handlers = [];
    if (this._searchDebounce) clearTimeout(this._searchDebounce);
  }
}

module.exports = Sidebar;
