// ============================================
// VAULTX - MAIN APP MODULE
// Handles: Dashboard, Items CRUD,
//          URL detection, Search, Settings
// ============================================

import {
  auth, db,
  collection, doc,
  addDoc, getDocs, getDoc,
  updateDoc, deleteDoc,
  query, where, orderBy,
  onSnapshot, serverTimestamp,
  signOut
} from './firebase-config.js';

import { DriveManager }   from './drive.js';
import {
  ScreenManager,
  AutoLockManager,
  PinManager
} from './auth.js';

// ============================================
// UTILS
// ============================================
window.VaultUtils = {

  showToast(msg, type = 'info', duration = 3000) {
    const wrap = document.getElementById('toast-wrap');
    if (!wrap) return;

    const t    = document.createElement('div');
    const icons = {
      success: 'fa-check-circle',
      error:   'fa-times-circle',
      info:    'fa-info-circle',
      warning: 'fa-exclamation-triangle'
    };

    t.className   = `toast ${type}`;
    t.innerHTML   = `
      <i class="fas ${icons[type] || icons.info}"></i>
      <span>${msg}</span>
    `;
    wrap.appendChild(t);

    setTimeout(() => {
      t.classList.add('hiding');
      setTimeout(() => t.remove(), 300);
    }, duration);
  },

  formatDate(ts) {
    if (!ts) return '';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    const now  = new Date();
    const diff = now - date;

    if (diff < 60000)       return 'Just now';
    if (diff < 3600000)     return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000)    return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000)   return `${Math.floor(diff / 86400000)}d ago`;

    return date.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
  },

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k     = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i     = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  },

  isYouTube(url) {
    return /(?:youtube\.com\/(?:.*v=|.*\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
      .test(url);
  },

  getYouTubeId(url) {
    const m = url.match(
      /(?:youtube\.com\/(?:.*v=|.*\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return m ? m[1] : null;
  },

  isDriveLink(url) {
    return url.includes('drive.google.com') ||
           url.includes('docs.google.com');
  },

  getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 21) return 'Good evening';
    return 'Good night';
  },

  decodeHTML(html) {
    const t = document.createElement('textarea');
    t.innerHTML = html;
    return t.value;
  },

  truncate(str, n = 80) {
    return str && str.length > n
      ? str.substring(0, n) + '…'
      : str || '';
  }
};

// ============================================
// APP MANAGER
// ============================================
window.AppManager = {

  _user:           null,
  _items:          [],
  _unsubscribe:    null,
  _currentItem:    null,
  _selectedColor:  '#6C63FF',
  _pendingURLData: null,
  _pageHistory:    ['home'],

  // ==========================================
  // LAUNCH APP
  // ==========================================
  async launch(user) {
    this._user = user;

    ScreenManager.show('app');

    // Setup UI
    this._setupHeader(user);
    this._setupSettings(user);
    this._bindAllEvents();

    // Load drives
    await DriveManager.init(user.uid);
    DriveManager.checkStorageAlerts();

    // Start real-time listener
    this._startListener();

    // Start auto-lock
    AutoLockManager.init(user);

    // Check for URL shortcut params
    this._checkURLParams();

    console.log('[VaultX App] Launched for:', user.email);
  },

  // ==========================================
  // SETUP HEADER
  // ==========================================
  _setupHeader(user) {
    // Greeting
    const timeEl = document.getElementById('greeting-time');
    const nameEl = document.getElementById('greeting-name');
    if (timeEl) timeEl.textContent = `${VaultUtils.getGreeting()} 👋`;
    if (nameEl) {
      const firstName = (user.displayName || user.email)
        .split(/[\s@]/)[0];
      nameEl.textContent = firstName + '!';
    }

    // Avatar
    if (user.photoURL) {
      const img  = document.getElementById('header-avatar-img');
      const icon = document.getElementById('header-avatar-icon');
      if (img)  { img.src = user.photoURL; img.style.display = 'block'; }
      if (icon) icon.style.display = 'none';
    }
  },

  // ==========================================
  // SETUP SETTINGS PAGE
  // ==========================================
  _setupSettings(user) {
    // Profile
    const nameEl  = document.getElementById('settings-name');
    const emailEl = document.getElementById('settings-email');
    const picEl   = document.getElementById('settings-pic');

    if (nameEl)  nameEl.textContent  = user.displayName || 'User';
    if (emailEl) emailEl.textContent = user.email;
    if (picEl && user.photoURL) {
      picEl.innerHTML = `
        <img src="${user.photoURL}"
             style="width:100%;height:100%;object-fit:cover;border-radius:50%"
             alt="profile" />
      `;
    }

    // Load saved settings
    const autolock   = localStorage.getItem('vaultx_autolock') || '5';
    const bioEnabled = localStorage.getItem('vaultx_bio') === 'true';
    const darkMode   = localStorage.getItem('vaultx_theme') !== 'light';

    const autolockEl = document.getElementById('autolock-val');
    const bioEl      = document.getElementById('bio-toggle');
    const darkEl     = document.getElementById('dark-toggle');

    if (autolockEl) autolockEl.value   = autolock;
    if (bioEl)      bioEl.checked      = bioEnabled;
    if (darkEl)     darkEl.checked     = darkMode;
  },

  // ==========================================
  // BIND ALL EVENTS
  // ==========================================
  _bindAllEvents() {
    // --- FAB ---
    document.getElementById('fab-btn')
      ?.addEventListener('click', () => this.openFAB());

    document.getElementById('fab-overlay')
      ?.addEventListener('click', () => this.closeFAB());

    // FAB menu items (also available as window.App.xxx)
    document.getElementById('fab-menu')
      ?.addEventListener('click', e => {
        const item = e.target.closest('.fab-menu-item');
        if (!item) return;
        this.closeFAB();

        const action = item.getAttribute('onclick');
        if (!action) return;

        if (item.querySelector('.fa-link'))         this.addLink();
        else if (item.querySelector('.fa-sticky-note')) this.addNote();
        else if (item.querySelector('.fa-google-drive')) this.addFromDrive();
      });

    // --- Search ---
    document.getElementById('search-btn')
      ?.addEventListener('click', () => this.toggleSearch());
    document.getElementById('search-close')
      ?.addEventListener('click', () => this.closeSearch());
    document.getElementById('search-input')
      ?.addEventListener('input', e => this._handleSearch(e.target.value));

    // --- URL Modal ---
    document.getElementById('detect-url-btn')
      ?.addEventListener('click', () => this._detectURL());
    document.getElementById('url-paste-input')
      ?.addEventListener('keydown', e => {
        if (e.key === 'Enter') this._detectURL();
      });
    document.getElementById('url-paste-input')
      ?.addEventListener('paste', () => {
        setTimeout(() => this._detectURL(), 150);
      });
    document.getElementById('save-link-btn')
      ?.addEventListener('click', () => this._saveLink());

    // --- Note Modal ---
    document.querySelectorAll('.note-color').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.note-color')
          .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._selectedColor = btn.dataset.color;
      });
    });

    // --- Modal closes ---
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal-backdrop');
        if (modal) this.closeModal(modal.id);
      });
    });

    // --- Settings actions ---
    window.Settings = {
      changePIN:       () => this._changePIN(),
      changePassword:  () => this._changePassword(),
      toggleBiometric: (el) => this._toggleBiometric(el),
      setAutoLock:     (val) => AutoLockManager.updateMinutes(val),
      toggleDark:      (el) => this._toggleDark(el),
      exportData:      () => this._exportData(),
      signOut:         () => this._signOut(),
      deleteAccount:   () => this._deleteAccount()
    };

    // --- Add drive button (drives page) ---
    document.getElementById('add-drive-btn')
      ?.addEventListener('click', async () => {
        await DriveManager.addDrive(this._user.uid);
      });

    // --- Offline detection ---
    window.addEventListener('online',  () =>
      document.getElementById('offline-bar')?.classList.add('hidden')
    );
    window.addEventListener('offline', () =>
      document.getElementById('offline-bar')?.classList.remove('hidden')
    );
    if (!navigator.onLine) {
      document.getElementById('offline-bar')?.classList.remove('hidden');
    }

    // Detail modal buttons
    document.getElementById('detail-open-btn')
      ?.addEventListener('click', () => this._openCurrentItem());
  },

  // ==========================================
  // REAL-TIME FIRESTORE LISTENER
  // ==========================================
  _startListener() {
    if (this._unsubscribe) this._unsubscribe();

    const itemsRef = collection(db, 'users', this._user.uid, 'items');
    const q        = query(itemsRef, orderBy('createdAt', 'desc'));

    this._unsubscribe = onSnapshot(q, snap => {
      this._items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      this._updateAllUI();
    }, err => {
      console.error('[VaultX] Listener error:', err);
      VaultUtils.showToast('Error syncing data', 'error');
    });
  },

  // ==========================================
  // UPDATE ALL UI
  // ==========================================
  _updateAllUI() {
    this._updateStats();
    this._renderRecentList();
    this._renderCategoryPages();
    this._renderFavorites();
    DriveManager._updateDriveStatusBar();
  },

  // ==========================================
  // UPDATE STATS
  // ==========================================
  _updateStats() {
    const total    = this._items.length;
    const youtube  = this._items.filter(i => i.category === 'youtube').length;
    const links    = this._items.filter(i => i.category === 'links').length;
    const notes    = this._items.filter(i => i.category === 'notes').length;
    const files    = this._items.filter(
      i => i.category === 'documents' || i.category === 'study'
    ).length;

    // Stat cards
    this._setText('total-count',   total);
    this._setText('stat-youtube',  youtube);
    this._setText('stat-links',    links);
    this._setText('stat-notes',    notes);
    this._setText('stat-files',    files);

    // Category counts
    this._setText('cat-youtube',
      `${youtube} video${youtube !== 1 ? 's' : ''}`);
    this._setText('cat-links',
      `${links} link${links !== 1 ? 's' : ''}`);
    this._setText('cat-documents',
      `${this._items.filter(i => i.category === 'documents').length} files`);
    this._setText('cat-study',
      `${this._items.filter(i => i.category === 'study').length} items`);
    this._setText('cat-notes',
      `${notes} note${notes !== 1 ? 's' : ''}`);
    this._setText('cat-images',
      `${this._items.filter(i => i.category === 'images').length} images`);
  },

  _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  },

  // ==========================================
  // RENDER RECENT LIST (Home)
  // ==========================================
  _renderRecentList() {
    const container = document.getElementById('recent-list');
    if (!container) return;

    const recent = this._items.slice(0, 12);

    if (recent.length === 0) {
      container.innerHTML = `
        <div class="empty-state" id="home-empty">
          <div class="empty-icon"><i class="fas fa-inbox"></i></div>
          <h4>Your vault is empty</h4>
          <p>Tap the + button to add your first item</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    recent.forEach(item => {
      const card = this._buildCard(item);
      if (card) container.appendChild(card);
    });
  },

  // ==========================================
  // RENDER CATEGORY PAGES
  // ==========================================
  _renderCategoryPages() {
    const cats = [
      'youtube', 'links', 'documents',
      'study', 'images'
    ];

    cats.forEach(cat => {
      const el    = document.getElementById(`list-${cat}`);
      if (!el) return;

      const items = this._items.filter(i => i.category === cat);

      if (items.length === 0) return; // Keep empty state

      el.innerHTML = '';
      items.forEach(item => {
        const card = this._buildCard(item);
        if (card) el.appendChild(card);
      });
    });

    // Notes grid
    const notesEl = document.getElementById('list-notes');
    if (notesEl) {
      const notes = this._items.filter(i => i.category === 'notes');
      if (notes.length > 0) {
        notesEl.innerHTML = '';
        notes.forEach(item => {
          const card = this._buildCard(item);
          if (card) notesEl.appendChild(card);
        });
      }
    }
  },

  // ==========================================
  // RENDER FAVORITES
  // ==========================================
  _renderFavorites() {
    const el  = document.getElementById('list-favorites');
    if (!el) return;

    const favs = this._items.filter(i => i.starred);
    if (favs.length === 0) return;

    el.innerHTML = '';
    favs.forEach(item => {
      const card = this._buildCard(item);
      if (card) el.appendChild(card);
    });
  },

  // ==========================================
  // BUILD ITEM CARD
  // ==========================================
  _buildCard(item) {
    switch (item.category) {
      case 'youtube':   return this._buildYTCard(item);
      case 'notes':     return this._buildNoteCard(item);
      case 'images':    return this._buildImageCard(item);
      case 'documents':
      case 'study':     return this._buildDocCard(item);
      default:          return this._buildLinkCard(item);
    }
  },

  // ---- YouTube Card ----
  _buildYTCard(item) {
    const div  = document.createElement('div');
    div.className = 'yt-card';
    const thumb =
      item.thumbnail ||
      `https://img.youtube.com/vi/${item.youtubeId}/hqdefault.jpg`;

    div.innerHTML = `
      <div class="yt-thumb-wrap">
        <img src="${thumb}"
             alt="${item.title || 'YouTube'}"
             loading="lazy"
             onerror="this.src='https://img.youtube.com/vi/${item.youtubeId}/hqdefault.jpg'" />
        <div class="yt-play-overlay">
          <i class="fas fa-play-circle"></i>
        </div>
      </div>
      <div class="yt-card-body">
        <div class="yt-title">${item.title || 'YouTube Video'}</div>
        <div class="yt-meta">
          <span class="yt-channel">
            <i class="fab fa-youtube"></i>
            ${item.channelName || 'YouTube'}
          </span>
          <span class="yt-date">${VaultUtils.formatDate(item.createdAt)}</span>
        </div>
        <div class="card-actions">
          <button class="card-act-btn star ${item.starred ? 'starred' : ''}"
                  data-id="${item.id}">
            <i class="${item.starred ? 'fas' : 'far'} fa-star"></i>
            ${item.starred ? 'Saved' : 'Save'}
          </button>
          <button class="card-act-btn" onclick="window.open('${item.url}','_blank')">
            <i class="fab fa-youtube"></i> Watch
          </button>
          ${item.tags?.length
            ? `<span class="badge badge-purple">${item.tags[0]}</span>`
            : ''}
        </div>
      </div>
    `;

    div.querySelector('.star')
       ?.addEventListener('click', e => {
         e.stopPropagation();
         this._toggleStar(item.id);
       });

    div.addEventListener('click', e => {
      if (!e.target.closest('button')) this._showDetail(item);
    });

    return div;
  },

  // ---- Link Card ----
  _buildLinkCard(item) {
    const div = document.createElement('div');
    div.className = 'link-card';

    const faviconHTML = item.favicon
      ? `<img src="${item.favicon}" alt=""
              onerror="this.parentElement.innerHTML='<i class=\\'fas fa-globe\\'></i>'" />`
      : `<i class="fas fa-globe"></i>`;

    div.innerHTML = `
      <div class="link-favicon">${faviconHTML}</div>
      <div class="link-info">
        <div class="link-title">
          ${item.title || item.domain || item.url}
        </div>
        <div class="link-url">${item.domain || item.url}</div>
        ${item.description
          ? `<div class="link-desc">${item.description}</div>`
          : ''}
      </div>
      <div class="link-right">
        <button class="link-star ${item.starred ? 'starred' : ''}"
                data-id="${item.id}">
          <i class="${item.starred ? 'fas' : 'far'} fa-star"></i>
        </button>
        <span class="link-date">${VaultUtils.formatDate(item.createdAt)}</span>
      </div>
    `;

    div.querySelector('.link-star')
       ?.addEventListener('click', e => {
         e.stopPropagation();
         this._toggleStar(item.id);
       });

    div.addEventListener('click', e => {
      if (!e.target.closest('button')) this._showDetail(item);
    });

    return div;
  },

  // ---- Note Card ----
  _buildNoteCard(item) {
    const div = document.createElement('div');
    div.className = 'note-card';
    div.style.setProperty('--note-color', item.color || '#6C63FF');
    div.style.borderColor = item.color || '#6C63FF';

    div.innerHTML = `
      <div class="note-card-title">${item.title || 'Untitled'}</div>
      <div class="note-card-body">${item.content || ''}</div>
      <div class="note-card-date">${VaultUtils.formatDate(item.createdAt)}</div>
    `;

    div.addEventListener('click', () => this._showDetail(item));
    return div;
  },

  // ---- Doc Card ----
  _buildDocCard(item) {
    const div  = document.createElement('div');
    div.className = 'doc-card';
    const info = DriveManager.getFileIcon(item.mimeType || '', item.title || '');

    div.innerHTML = `
      <div class="doc-file-icon ${info.cls}">
        <i class="fas ${info.icon}"></i>
      </div>
      <div class="doc-info">
        <div class="doc-name">${item.title || 'Document'}</div>
        <div class="doc-meta">
          ${item.fileSize
            ? `<span>${VaultUtils.formatBytes(item.fileSize)}</span>`
            : ''}
          ${item.driveEmail
            ? `<span><i class="fab fa-google-drive" style="color:#4285F4"></i>
               ${item.driveEmail.split('@')[0]}</span>`
            : ''}
          <span>${VaultUtils.formatDate(item.createdAt)}</span>
        </div>
      </div>
      <button class="link-star ${item.starred ? 'starred' : ''}"
              data-id="${item.id}">
        <i class="${item.starred ? 'fas' : 'far'} fa-star"></i>
      </button>
    `;

    div.querySelector('.link-star')
       ?.addEventListener('click', e => {
         e.stopPropagation();
         this._toggleStar(item.id);
       });

    div.addEventListener('click', e => {
      if (!e.target.closest('button')) this._showDetail(item);
    });

    return div;
  },

  // ---- Image Card ----
  _buildImageCard(item) {
    const div = document.createElement('div');
    div.className = 'img-thumb';
    div.innerHTML = `
      <img src="${item.url}"
           alt="${item.title || 'Image'}"
           loading="lazy" />
    `;
    div.addEventListener('click', () => this._showDetail(item));
    return div;
  },

  // ==========================================
  // NAVIGATION
  // ==========================================
  goTo(page) {
    // Update history
    if (this._pageHistory[this._pageHistory.length - 1] !== page) {
      this._pageHistory.push(page);
    }

    // Hide all pages
    document.querySelectorAll('.page').forEach(p =>
      p.classList.remove('active')
    );

    // Show target
    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    // Update bottom nav
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });

    // Toggle header visibility
    const noHeader = [
      'youtube', 'links', 'documents',
      'study', 'notes', 'images'
    ];
    const header = document.getElementById('app-header');
    if (header) {
      header.style.display = noHeader.includes(page) ? 'none' : 'flex';
    }

    // Render drives page if navigating there
    if (page === 'drives') {
      DriveManager._renderDrivesPage();
    }

    this.closeSearch();
    this.closeFAB();
  },

  goBack() {
    if (this._pageHistory.length > 1) {
      this._pageHistory.pop();
      const prev = this._pageHistory[this._pageHistory.length - 1];
      this.goTo(prev);
    } else {
      this.goTo('home');
    }
  },

  // ==========================================
  // FAB
  // ==========================================
  openFAB() {
    const menu    = document.getElementById('fab-menu');
    const overlay = document.getElementById('fab-overlay');
    const circle  = document.querySelector('.fab-circle');

    menu?.classList.remove('hidden');
    overlay?.classList.remove('hidden');
    circle?.classList.add('open');
  },

  closeFAB() {
    const menu    = document.getElementById('fab-menu');
    const overlay = document.getElementById('fab-overlay');
    const circle  = document.querySelector('.fab-circle');

    menu?.classList.add('hidden');
    overlay?.classList.add('hidden');
    circle?.classList.remove('open');
  },

  // ==========================================
  // MODALS
  // ==========================================
  openModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
  },

  closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
    if (id === 'modal-add-link') this._resetLinkModal();
    if (id === 'modal-add-note') this._resetNoteModal();
  },

  _resetLinkModal() {
    const el = document.getElementById('url-paste-input');
    if (el) el.value = '';
    document.getElementById('url-preview-area')?.classList.add('hidden');
    document.getElementById('preview-result').innerHTML = '';
    document.getElementById('add-link-tags').value  = '';
    document.getElementById('add-link-note').value  = '';
    document.getElementById('add-link-category').value = 'links';
    this._pendingURLData = null;
  },

  _resetNoteModal() {
    document.getElementById('note-title-input').value = '';
    document.getElementById('note-body-input').value  = '';
    this._selectedColor = '#6C63FF';
    document.querySelectorAll('.note-color').forEach((b, i) => {
      b.classList.toggle('active', i === 0);
    });
  },

  // ==========================================
  // SEARCH
  // ==========================================
  toggleSearch() {
    const wrap = document.getElementById('search-bar-wrap');
    const isHidden = wrap?.classList.contains('hidden');
    if (isHidden) {
      wrap?.classList.remove('hidden');
      document.getElementById('search-input')?.focus();
    } else {
      this.closeSearch();
    }
  },

  closeSearch() {
    document.getElementById('search-bar-wrap')?.classList.add('hidden');
    const inp = document.getElementById('search-input');
    if (inp) inp.value = '';
  },

  _handleSearch(q) {
    if (!q.trim()) {
      this._renderRecentList();
      return;
    }

    const lower   = q.toLowerCase();
    const results = this._items.filter(item =>
      item.title?.toLowerCase().includes(lower)       ||
      item.description?.toLowerCase().includes(lower) ||
      item.content?.toLowerCase().includes(lower)     ||
      item.url?.toLowerCase().includes(lower)         ||
      item.channelName?.toLowerCase().includes(lower) ||
      item.tags?.some(t => t.toLowerCase().includes(lower))
    );

    const container = document.getElementById('recent-list');
    if (!container) return;

    this.goTo('home');

    if (results.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><i class="fas fa-search"></i></div>
          <h4>No results for "${q}"</h4>
          <p>Try different keywords</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <p style="font-size:13px;color:var(--text-3);padding:4px 2px">
        ${results.length} result${results.length > 1 ? 's' : ''} for "${q}"
      </p>
    `;
    results.forEach(item => {
      const card = this._buildCard(item);
      if (card) container.appendChild(card);
    });
  },

  // ==========================================
  // ADD LINK (Open modal)
  // ==========================================
  addLink() {
    this.closeFAB();
    this.openModal('modal-add-link');
  },

  // ==========================================
  // DETECT URL
  // ==========================================
  async _detectURL() {
    const input  = document.getElementById('url-paste-input');
    const rawURL = input?.value.trim();

    if (!rawURL) {
      VaultUtils.showToast('Please enter or paste a URL', 'error');
      return;
    }

    // Try adding https:// if missing
    const url = rawURL.startsWith('http') ? rawURL : `https://${rawURL}`;

    try { new URL(url); }
    catch {
      VaultUtils.showToast('Invalid URL. Please check and try again', 'error');
      return;
    }

    // Update input with normalized URL
    if (input) input.value = url;

    const previewArea = document.getElementById('url-preview-area');
    const loadingEl   = document.getElementById('preview-loading');
    const resultEl    = document.getElementById('preview-result');

    previewArea?.classList.remove('hidden');
    loadingEl?.classList.remove('hidden');
    if (resultEl) resultEl.innerHTML = '';

    try {
      if (VaultUtils.isYouTube(url)) {
        // ---- YouTube ----
        document.getElementById('add-link-category').value = 'youtube';
        await this._fetchYouTube(url, resultEl);

      } else if (VaultUtils.isDriveLink(url)) {
        // ---- Google Drive ----
        document.getElementById('add-link-category').value = 'documents';
        this._handleDriveURL(url, resultEl);

      } else {
        // ---- Regular website ----
        await this._fetchWebsite(url, resultEl);
      }
    } finally {
      loadingEl?.classList.add('hidden');
    }
  },

  // ---- Fetch YouTube info ----
  async _fetchYouTube(url, container) {
    const videoId = VaultUtils.getYouTubeId(url);
    if (!videoId) return;

    const thumb = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    let title   = 'YouTube Video';
    let channel = 'YouTube';

    try {
      // oEmbed API - FREE, no API key needed
      const oembedURL =
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const proxyURL  =
        `https://api.allorigins.win/get?url=${encodeURIComponent(oembedURL)}`;

      const res = await fetch(proxyURL, {
        signal: AbortSignal.timeout(6000)
      });

      if (res.ok) {
        const raw  = await res.json();
        const data = JSON.parse(raw.contents);
        title   = data.title       || title;
        channel = data.author_name || channel;
      }
    } catch (e) {
      console.warn('[VaultX] YouTube oEmbed failed, using defaults');
    }

    this._pendingURLData = {
      type: 'youtube', url, videoId, title, channelName: channel,
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
    };

    container.innerHTML = `
      <img class="preview-yt-thumb"
           src="${thumb}"
           alt="${title}"
           onerror="this.src='https://img.youtube.com/vi/${videoId}/hqdefault.jpg'" />
      <div class="preview-info-box">
        <span class="preview-badge yt">
          <i class="fab fa-youtube"></i> YouTube
        </span>
        <div class="preview-title">${title}</div>
        <div class="preview-sub">
          <i class="fas fa-user"></i> ${channel}
        </div>
      </div>
    `;
  },

  // ---- Handle Drive URL ----
  _handleDriveURL(url, container) {
    const parsed = DriveManager.parseDriveLink(url);
    const info   = DriveManager.getFileIcon('', url);

    this._pendingURLData = {
      type:    'drive',
      url:     parsed?.viewUrl || url,
      fileId:  parsed?.fileId  || '',
      title:   'Google Drive File',
      mimeType: '',
      driveEmail: DriveManager.getDefaultDrive()?.email || ''
    };

    container.innerHTML = `
      <div class="preview-link-row">
        <div class="preview-favicon-box">
          <i class="fab fa-google-drive" style="color:#4285F4;font-size:24px"></i>
        </div>
        <div>
          <span class="preview-badge web">
            <i class="fab fa-google-drive"></i> Google Drive
          </span>
          <div class="preview-title">Google Drive File</div>
          <div class="preview-sub">${url}</div>
        </div>
      </div>
    `;
  },

  // ---- Fetch Website info ----
  async _fetchWebsite(url, container) {
    let title  = '';
    let desc   = '';
    let domain = '';

    try {
      domain = new URL(url).hostname.replace('www.', '');
    } catch { domain = url; }

    const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

    try {
      const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const res   = await fetch(proxy, { signal: AbortSignal.timeout(7000) });

      if (res.ok) {
        const data = await res.json();
        const html = data.contents || '';

        // Parse title
        const titleMatch =
          html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
          html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i) ||
          html.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
        if (titleMatch) title = VaultUtils.decodeHTML(titleMatch[1].trim());

        // Parse description
        const descMatch =
          html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
          html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i) ||
          html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i);
        if (descMatch) desc = VaultUtils.decodeHTML(descMatch[1].trim());
      }
    } catch (e) {
      console.warn('[VaultX] Website fetch failed:', e.message);
    }

    title = title || domain;
    document.getElementById('add-link-category').value = 'links';

    this._pendingURLData = {
      type: 'link', url, title,
      description: desc, favicon, domain
    };

    container.innerHTML = `
      <div class="preview-link-row">
        <div class="preview-favicon-box">
          <img src="${favicon}" alt="${domain}"
               onerror="this.style.display='none'" />
        </div>
        <div style="flex:1;overflow:hidden">
          <span class="preview-badge web">
            <i class="fas fa-globe"></i> Website
          </span>
          <div class="preview-title">${title}</div>
          <div class="preview-sub">${domain}</div>
          ${desc
            ? `<div style="font-size:12px;color:var(--text-3);
                           margin-top:4px;line-height:1.4">
                 ${VaultUtils.truncate(desc, 120)}
               </div>`
            : ''}
        </div>
      </div>
    `;
  },

  // ==========================================
  // SAVE LINK
  // ==========================================
  async _saveLink() {
    const url      = document.getElementById('url-paste-input')?.value.trim();
    const category = document.getElementById('add-link-category')?.value;
    const tagsRaw  = document.getElementById('add-link-tags')?.value;
    const note     = document.getElementById('add-link-note')?.value.trim();

    if (!url) {
      VaultUtils.showToast('Please enter a URL', 'error');
      return;
    }

    const tags = tagsRaw
      ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
      : [];

    const saveBtn = document.getElementById('save-link-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }

    try {
      const data    = this._pendingURLData || {};
      let itemData  = {
        url,
        category:   category || data.type || 'links',
        tags,
        note,
        starred:    false,
        createdAt:  serverTimestamp(),
        updatedAt:  serverTimestamp(),
        userId:     this._user.uid
      };

      // Merge fetched data
      if (data.type === 'youtube') {
        itemData = {
          ...itemData,
          category:    'youtube',
          title:       data.title,
          channelName: data.channelName,
          thumbnail:   data.thumbnail,
          youtubeId:   data.videoId
        };
      } else if (data.type === 'drive') {
        itemData = {
          ...itemData,
          category:   category || 'documents',
          title:      data.title,
          fileId:     data.fileId,
          mimeType:   data.mimeType,
          driveEmail: data.driveEmail
        };
      } else if (data.type === 'link') {
        itemData = {
          ...itemData,
          title:       data.title,
          description: data.description,
          favicon:     data.favicon,
          domain:      data.domain
        };
      } else {
        // No preview data - save URL as-is
        try {
          itemData.domain = new URL(url).hostname.replace('www.', '');
          itemData.title  = itemData.domain;
          itemData.favicon =
            `https://www.google.com/s2/favicons?domain=${itemData.domain}&sz=64`;
        } catch {}
      }

      await addDoc(
        collection(db, 'users', this._user.uid, 'items'),
        itemData
      );

      VaultUtils.showToast('Saved to Vault! ✅', 'success');
      this.closeModal('modal-add-link');

    } catch (err) {
      console.error('[VaultX] Save link error:', err);
      VaultUtils.showToast('Error saving. Try again.', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled  = false;
        saveBtn.innerHTML =
          '<i class="fas fa-save"></i> Save';
      }
    }
  },

  // ==========================================
  // ADD NOTE
  // ==========================================
  addNote() {
    this.closeFAB();
    this.openModal('modal-add-note');
  },

  async saveNote() {
    const title   = document.getElementById('note-title-input')?.value.trim();
    const content = document.getElementById('note-body-input')?.value.trim();

    if (!title && !content) {
      VaultUtils.showToast('Note cannot be empty', 'error');
      return;
    }

    try {
      await addDoc(
        collection(db, 'users', this._user.uid, 'items'),
        {
          title:     title || 'Untitled Note',
          content,
          category:  'notes',
          color:     this._selectedColor,
          starred:   false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          userId:    this._user.uid
        }
      );

      VaultUtils.showToast('Note saved! 📝', 'success');
      this.closeModal('modal-add-note');
    } catch (err) {
      console.error('[VaultX] Save note error:', err);
      VaultUtils.showToast('Error saving note', 'error');
    }
  },

  // ==========================================
  // ADD FROM DRIVE (Pick file)
  // ==========================================
  addFromDrive() {
    this.closeFAB();

    if (!DriveManager.hasDrives()) {
      VaultUtils.showToast('Connect a Google Drive first', 'error');
      this.goTo('drives');
      return;
    }

    DriveManager.openPicker(this._user.uid, async (file) => {
      try {
        await addDoc(
          collection(db, 'users', this._user.uid, 'items'),
          {
            title:      file.name,
            url:        file.url,
            fileId:     file.id,
            mimeType:   file.mimeType,
            fileSize:   file.sizeBytes,
            driveEmail: file.driveEmail,
            iconUrl:    file.iconUrl,
            category:   this._getCategoryFromMime(file.mimeType),
            starred:    false,
            createdAt:  serverTimestamp(),
            updatedAt:  serverTimestamp(),
            userId:     this._user.uid
          }
        );

        VaultUtils.showToast(`"${file.name}" saved! ✅`, 'success');
      } catch (err) {
        VaultUtils.showToast('Error saving file', 'error');
      }
    });
  },

  // ---- Show Drive Link Modal (fallback) ----
  showDriveLinkModal(onFilePicked) {
    // Create a quick modal to paste Drive link
    const existing = document.getElementById('drive-link-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'drive-link-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-box">
        <div class="modal-head">
          <h3><i class="fab fa-google-drive" style="color:#4285F4"></i>
              Add from Drive</h3>
          <button class="modal-close-btn" id="drive-modal-close">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-body">
          <p style="font-size:14px;color:var(--text-3);line-height:1.6">
            Open Google Drive, right-click your file →
            "Get Link" → paste it below:
          </p>
          <div class="modal-field">
            <label>Google Drive Link</label>
            <input type="url" id="drive-link-input"
                   placeholder="https://drive.google.com/file/d/..." />
          </div>
          <div class="modal-field">
            <label>File Name</label>
            <input type="text" id="drive-file-name"
                   placeholder="e.g. Physics Notes Chapter 5.pdf" />
          </div>
          <div class="modal-field">
            <label>Category</label>
            <select id="drive-file-cat">
              <option value="documents">Document / PDF</option>
              <option value="study">Study Material</option>
              <option value="images">Image</option>
            </select>
          </div>
          <a href="https://drive.google.com"
             target="_blank"
             style="font-size:13px;color:#4285F4;display:flex;
                    align-items:center;gap:6px;margin-top:4px">
            <i class="fab fa-google-drive"></i> Open Google Drive
          </a>
        </div>
        <div class="modal-foot">
          <button class="btn-secondary" id="drive-modal-cancel">Cancel</button>
          <button class="btn-primary" id="drive-modal-save">
            <i class="fas fa-save"></i> Save File
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#drive-modal-close')
         ?.addEventListener('click', () => modal.remove());
    modal.querySelector('#drive-modal-cancel')
         ?.addEventListener('click', () => modal.remove());

    modal.querySelector('#drive-modal-save')
         ?.addEventListener('click', () => {
           const link = modal.querySelector('#drive-link-input')?.value.trim();
           const name = modal.querySelector('#drive-file-name')?.value.trim();
           const cat  = modal.querySelector('#drive-file-cat')?.value;

           if (!link) {
             VaultUtils.showToast('Please paste a Drive link', 'error');
             return;
           }

           const parsed = DriveManager.parseDriveLink(link);
           onFilePicked({
             id:         parsed?.fileId || '',
             name:       name || 'Drive File',
             mimeType:   '',
             url:        parsed?.viewUrl || link,
             sizeBytes:  0,
             driveEmail: DriveManager.getDefaultDrive()?.email || '',
             category:   cat
           });

           modal.remove();
         });
  },

  // ==========================================
  // TOGGLE STAR
  // ==========================================
  async _toggleStar(itemId) {
    const item = this._items.find(i => i.id === itemId);
    if (!item) return;

    try {
      await updateDoc(
        doc(db, 'users', this._user.uid, 'items', itemId),
        { starred: !item.starred, updatedAt: serverTimestamp() }
      );

      VaultUtils.showToast(
        item.starred ? 'Removed from favorites' : 'Added to favorites ⭐',
        'info'
      );
    } catch (err) {
      VaultUtils.showToast('Error updating item', 'error');
    }
  },

  // ==========================================
  // SHOW ITEM DETAIL
  // ==========================================
  _showDetail(item) {
    this._currentItem = item;

    const titleEl  = document.getElementById('detail-modal-title');
    const bodyEl   = document.getElementById('detail-modal-body');
    const openBtn  = document.getElementById('detail-open-btn');

    if (titleEl) titleEl.textContent = item.title || 'Details';
    if (openBtn) openBtn.style.display = item.url ? 'flex' : 'none';

    if (!bodyEl) return;

    let html = '';

    if (item.category === 'youtube') {
      html = `
        <img src="${item.thumbnail || `https://img.youtube.com/vi/${item.youtubeId}/hqdefault.jpg`}"
             style="width:100%;border-radius:var(--r3);margin-bottom:12px"
             alt="${item.title}" />
        <p style="font-size:13px;color:var(--text-3);
                  display:flex;align-items:center;gap:6px">
          <i class="fab fa-youtube" style="color:#FF0000"></i>
          ${item.channelName || 'YouTube'}
        </p>
      `;
    } else if (item.category === 'notes') {
      html = `
        <div style="background:${item.color || '#6C63FF'}18;
                    border:1px solid ${item.color || '#6C63FF'}44;
                    border-radius:var(--r3);padding:16px;
                    line-height:1.7;color:var(--text-1);white-space:pre-wrap">
          ${item.content || '(empty note)'}
        </div>
      `;
    } else if (item.category === 'images') {
      html = `
        <img src="${item.url}"
             style="width:100%;border-radius:var(--r3);margin-bottom:12px"
             alt="${item.title}" />
      `;
    } else if (item.category === 'documents' || item.category === 'study') {
      const info = DriveManager.getFileIcon(item.mimeType || '', item.title || '');
      html = `
        <div style="display:flex;align-items:center;gap:14px;
                    background:var(--bg-2);border-radius:var(--r3);
                    padding:16px;margin-bottom:12px">
          <div class="doc-file-icon ${info.cls}" style="width:52px;height:52px;font-size:26px">
            <i class="fas ${info.icon}"></i>
          </div>
          <div>
            <div style="font-size:15px;font-weight:600;margin-bottom:4px">
              ${item.title}
            </div>
            ${item.driveEmail
              ? `<div style="font-size:12px;color:var(--text-3)">
                   <i class="fab fa-google-drive" style="color:#4285F4"></i>
                   ${item.driveEmail}
                 </div>`
              : ''}
            ${item.fileSize
              ? `<div style="font-size:12px;color:var(--text-3)">
                   ${VaultUtils.formatBytes(item.fileSize)}
                 </div>`
              : ''}
          </div>
        </div>
      `;
    } else {
      html = `
        <div style="display:flex;align-items:center;gap:12px;
                    background:var(--bg-2);border-radius:var(--r3);
                    padding:14px;margin-bottom:12px">
          <div class="link-favicon">
            ${item.favicon
              ? `<img src="${item.favicon}" alt="" />`
              : '<i class="fas fa-globe"></i>'}
          </div>
          <div style="overflow:hidden">
            <div style="font-size:14px;font-weight:600;
                        white-space:nowrap;overflow:hidden;
                        text-overflow:ellipsis">
              ${item.title || item.domain || item.url}
            </div>
            <div style="font-size:12px;color:var(--text-4);
                        white-space:nowrap;overflow:hidden;
                        text-overflow:ellipsis">
              ${item.url}
            </div>
          </div>
        </div>
        ${item.description
          ? `<p style="font-size:14px;color:var(--text-2);
                       line-height:1.6;margin-bottom:12px">
               ${item.description}
             </p>`
          : ''}
      `;
    }

    // Common footer info
    html += `
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
        ${item.tags?.length
          ? `<div style="display:flex;gap:6px;flex-wrap:wrap">
               ${item.tags.map(t =>
                 `<span class="badge badge-purple">${t}</span>`
               ).join('')}
             </div>`
          : ''}
        ${item.note
          ? `<div style="padding:10px 12px;background:var(--bg-2);
                         border-radius:var(--r2);font-size:13px;
                         color:var(--text-2);line-height:1.5">
               <i class="fas fa-sticky-note"
                  style="margin-right:6px;color:var(--primary)"></i>
               ${item.note}
             </div>`
          : ''}
        <div style="font-size:11px;color:var(--text-4)">
          Added ${VaultUtils.formatDate(item.createdAt)}
        </div>
      </div>
    `;

    bodyEl.innerHTML = html;
    this.openModal('modal-detail');
  },

  _openCurrentItem() {
    if (this._currentItem?.url) {
      window.open(this._currentItem.url, '_blank');
    }
  },

  // ==========================================
  // DELETE ITEM
  // ==========================================
  async deleteCurrentItem() {
    if (!this._currentItem) return;
    if (!confirm('Delete this item from your vault?')) return;

    try {
      await deleteDoc(
        doc(db, 'users', this._user.uid, 'items', this._currentItem.id)
      );

      this.closeModal('modal-detail');
      VaultUtils.showToast('Item deleted', 'success');
      this._currentItem = null;
    } catch (err) {
      VaultUtils.showToast('Error deleting item', 'error');
    }
  },

  // ==========================================
  // SETTINGS ACTIONS
  // ==========================================
  _changePIN() {
    PinManager.changePIN(this._user, () => {
      ScreenManager.show('app');
      VaultUtils.showToast('PIN changed successfully!', 'success');
    });
  },

  async _changePassword() {
    const { sendPasswordResetEmail, auth } =
      await import('./firebase-config.js');
    try {
      await sendPasswordResetEmail(auth, this._user.email);
      VaultUtils.showToast(
        'Password reset email sent! Check your inbox.', 'success'
      );
    } catch (err) {
      VaultUtils.showToast('Error sending reset email', 'error');
    }
  },

  async _toggleBiometric(el) {
    const { BiometricManager } = await import('./auth.js');
    if (el.checked) {
      const ok = await BiometricManager.register();
      if (!ok) el.checked = false;
      else VaultUtils.showToast('Biometric enabled 🔐', 'success');
    } else {
      localStorage.setItem('vaultx_bio', 'false');
      VaultUtils.showToast('Biometric disabled', 'info');
    }
  },

  _toggleDark(el) {
    if (el.checked) {
      document.body.classList.remove('light-mode');
      localStorage.setItem('vaultx_theme', 'dark');
    } else {
      document.body.classList.add('light-mode');
      localStorage.setItem('vaultx_theme', 'light');
    }
  },

  async _exportData() {
    try {
      const exportObj = {
        exportDate: new Date().toISOString(),
        version:    '1.0',
        user:       this._user.email,
        totalItems: this._items.length,
        items:      this._items.map(item => ({
          ...item,
          createdAt: item.createdAt?.toDate?.()?.toISOString?.() || null,
          updatedAt: item.updatedAt?.toDate?.()?.toISOString?.() || null
        }))
      };

      const blob  = new Blob(
        [JSON.stringify(exportObj, null, 2)],
        { type: 'application/json' }
      );
      const url   = URL.createObjectURL(blob);
      const a     = document.createElement('a');
      a.href      = url;
      a.download  =
        `vaultx-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      VaultUtils.showToast('Data exported successfully! 📦', 'success');
    } catch (err) {
      VaultUtils.showToast('Export failed. Try again.', 'error');
    }
  },

  async _signOut() {
    if (!confirm('Sign out of VaultX?')) return;
    const { AuthManager } = await import('./auth.js');
    await AuthManager.signOut();
  },

  async _deleteAccount() {
    const confirmed = confirm(
      'DELETE ACCOUNT?\n\n' +
      'This will permanently delete:\n' +
      '• All your saved items\n' +
      '• Your VaultX account\n\n' +
      '(Files in Google Drive will NOT be deleted)\n\n' +
      'This CANNOT be undone!'
    );
    if (!confirmed) return;

    try {
      // Delete all items
      const snap = await getDocs(
        collection(db, 'users', this._user.uid, 'items')
      );
      const batch = (await import('./firebase-config.js')).writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();

      // Delete user doc
      await deleteDoc(doc(db, 'users', this._user.uid));

      // Delete Firebase auth account
      await this._user.delete();

      localStorage.clear();
      window.location.reload();
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        VaultUtils.showToast(
          'Please sign out and sign in again, then try deleting.',
          'error', 5000
        );
      } else {
        VaultUtils.showToast('Error deleting account. Try again.', 'error');
      }
    }
  },

  // ==========================================
  // HELPERS
  // ==========================================
  _getCategoryFromMime(mimeType = '') {
    if (mimeType.startsWith('image/')) return 'images';
    if (mimeType.includes('pdf') ||
        mimeType.includes('word') ||
        mimeType.includes('document') ||
        mimeType.includes('text')) return 'documents';
    return 'documents';
  },

  _checkURLParams() {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (action === 'add-link')  setTimeout(() => this.addLink(),  500);
    if (action === 'add-note')  setTimeout(() => this.addNote(),  500);
    if (action === 'search')    setTimeout(() => this.toggleSearch(), 500);
  }
};

// Make functions available globally for HTML onclick
window.App = window.AppManager;