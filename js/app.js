// ============================================
// VAULTX - app.js v2.0
// App shell · Items · URL detect · Search · Settings
// ============================================

import {
  auth, db,
  collection, doc, addDoc, getDoc, getDocs,
  setDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp,
  itemsRef, userDocRef, VaultUtils
} from './config.js';

import { DriveManager } from './drive.js';

// ============================================
// STATE
// ============================================
let _user          = null;
let _items         = [];          // All items (realtime)
let _unsubItems    = null;        // Firestore listener unsub
let _activeFilter  = 'all';
let _activeSort    = 'newest';
let _currentPage   = 'home';
let _linkTags      = [];
let _noteTags      = [];
let _pendingLink   = null;        // Detected link data before save
let _selectedColor = '#6C63FF';  // Note color
let _fabOpen       = false;
let _pendingShared = null;        // URL from Web Share Target

// ============================================
// APP MANAGER
// ============================================
export const AppManager = {

  async launch(user, sharedUrl = null) {
    _user = user;
    _pendingShared = sharedUrl;
    _linkTags = []; _noteTags = [];

    this._setupHeader(user);
    this._setupNav();
    this._setupFAB();
    this._startItemsListener();

    // Go to home tab
    _switchPage('home');

    // Handle shared URL
    if (sharedUrl) {
      await _wait(800);
      _openAddLinkModal(sharedUrl);
    }

    // Autolock
    window.AutoLockManager?.init(user);

    window.AppManager = this;
    console.log('[VaultX] App launched for', user.email);
  },

  teardown() {
    _unsubItems?.();
    _unsubItems = null;
    _items = [];
    _user  = null;
  },

  onUserSignedIn(user) {
    // handled in launch()
  },

  onUserSignedOut() {
    this.teardown();
    window.ScreenManager?.show('auth-screen');
    // Clear auth form fields
    ['login-email','login-password','reg-name','reg-email','reg-password'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('auth-msg')?.classList.add('hidden');
  },

  syncOfflineQueue() {
    // Placeholder for background sync
    console.log('[VaultX] Sync triggered');
  },

  _setupHeader(user) {
    // Avatar
    const avatarBtn = document.getElementById('header-avatar-btn');
    const avatarImg = document.getElementById('header-avatar-img');
    const avatarIco = document.getElementById('header-avatar-icon');
    if (user.photoURL && avatarImg) {
      avatarImg.src = user.photoURL;
      avatarImg.style.display = 'block';
      avatarIco && (avatarIco.style.display = 'none');
    }
    avatarBtn?.addEventListener('click', () => _switchPage('settings'));

    // Greeting
    document.getElementById('greeting-name') &&
      (document.getElementById('greeting-name').textContent = user.displayName?.split(' ')[0] || 'there');
    const h = new Date().getHours();
    const period = h < 12 ? '🌅 Good morning' : h < 17 ? '☀️ Good afternoon' : '🌙 Good evening';
    document.getElementById('greeting-time') && (document.getElementById('greeting-time').textContent = period);

    // Search shortcut in header
    document.getElementById('app-search-btn')?.addEventListener('click', () => _switchPage('search'));
  },

  _setupNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        if (page) _switchPage(page);
      });
    });

    // Quick add buttons (home page)
    document.querySelectorAll('.quick-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'add-link') _openAddLinkModal();
        else if (action === 'add-note') _openAddNoteModal();
        else if (action === 'add-file') _triggerFileUpload();
      });
    });
  },

  _setupFAB() {
    const fabBtn     = document.getElementById('fab-btn');
    const fabMenu    = document.getElementById('fab-menu');
    const fabOverlay = document.getElementById('fab-overlay');

    fabBtn?.addEventListener('click', () => {
      _fabOpen = !_fabOpen;
      fabMenu?.classList.toggle('hidden', !_fabOpen);
      fabOverlay?.classList.toggle('hidden', !_fabOpen);
      fabBtn.classList.toggle('open', _fabOpen);
    });

    fabOverlay?.addEventListener('click', _closeFAB);

    // FAB menu items (data-action delegation)
    fabMenu?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      _closeFAB();
      const action = btn.dataset.action;
      if (action === 'add-link') _openAddLinkModal();
      else if (action === 'add-note') _openAddNoteModal();
      else if (action === 'add-file') _triggerFileUpload();
    });
  },

  _startItemsListener() {
    if (!_user) return;
    _unsubItems?.();
    const q = query(itemsRef(_user.uid), orderBy('createdAt', 'desc'));
    _unsubItems = onSnapshot(q, snap => {
      _items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _renderAll();
      _updateStats();
    }, err => {
      if (err.code !== 'unavailable') console.error('[VaultX] Items listener error:', err);
    });
  }
};

// ============================================
// PAGE NAVIGATION
// ============================================
function _switchPage(name) {
  _currentPage = name;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`${name}-page`)?.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === name);
  });

  // Focus search input
  if (name === 'search') {
    setTimeout(() => document.getElementById('search-input')?.focus(), 200);
  }

  // Load settings data
  if (name === 'settings') _loadSettingsPage();
}

// ============================================
// STATS
// ============================================
function _updateStats() {
  const counts = { total:0, youtube:0, link:0, note:0, file:0 };
  _items.forEach(it => {
    counts.total++;
    if (counts[it.type] !== undefined) counts[it.type]++;
  });
  _el('stat-total', counts.total);
  _el('stat-yt',    counts.youtube);
  _el('stat-notes', counts.note);
  _el('stat-files', counts.file);
}

// ============================================
// RENDER ALL VIEWS
// ============================================
function _renderAll() {
  _renderHome();
  _renderLibrary();
  _renderSearch(document.getElementById('search-input')?.value || '');
}

function _renderHome() {
  const list = document.getElementById('home-recent-list');
  if (!list) return;
  const recent = _items.slice(0, 8);
  if (recent.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📦</div>
      <p>Your vault is empty</p>
      <span>Tap ＋ to save your first link, note, or file</span>
    </div>`;
    return;
  }
  list.innerHTML = '';
  recent.forEach((item, i) => {
    const card = _buildCard(item, i);
    list.appendChild(card);
  });
}

function _renderLibrary() {
  const list = document.getElementById('library-list');
  if (!list) return;

  let filtered = _activeFilter === 'all'     ? [..._items]
               : _activeFilter === 'starred' ? _items.filter(it => it.starred)
               : _items.filter(it => it.type === _activeFilter);

  // Sort
  if (_activeSort === 'oldest') filtered.reverse();
  else if (_activeSort === 'alpha') filtered.sort((a,b) => (a.title||'').localeCompare(b.title||''));

  if (filtered.length === 0) {
    const msg = _activeFilter === 'starred' ? "No starred items yet" : "Nothing here yet";
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>${msg}</p><span>Tap + to add something</span></div>`;
    return;
  }
  list.innerHTML = '';
  filtered.forEach((item, i) => {
    const card = _buildCard(item, i);
    list.appendChild(card);
  });
}

function _renderSearch(query) {
  const list = document.getElementById('search-results');
  if (!list) return;
  const q = query.trim().toLowerCase();

  if (!q) {
    list.innerHTML = `<div class="search-empty-state empty-state">
      <div class="empty-icon">🔎</div>
      <p>Search your vault</p>
      <span>Find links, notes, and files instantly</span>
    </div>`;
    return;
  }

  const results = _items.filter(it =>
    (it.title        || '').toLowerCase().includes(q) ||
    (it.description  || '').toLowerCase().includes(q) ||
    (it.url          || '').toLowerCase().includes(q) ||
    (it.channel      || '').toLowerCase().includes(q) ||
    (it.tags         || []).some(t => t.toLowerCase().includes(q))
  );

  if (results.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">😕</div><p>No results for "${VaultUtils.trunc(q,30)}"</p><span>Try different keywords</span></div>`;
    return;
  }
  list.innerHTML = '';
  results.forEach((item, i) => {
    const card = _buildCard(item, i);
    list.appendChild(card);
  });
}

// ============================================
// CARD BUILDER
// ============================================
function _buildCard(item, index = 0) {
  const div = document.createElement('div');
  div.className = 'item-card';
  div.dataset.type = item.type;
  div.dataset.id   = item.id;
  div.style.animationDelay = `${index * 0.04}s`;

  const starClass = item.starred ? 'card-star-btn starred' : 'card-star-btn';
  const starIcon  = item.starred ? 'fas fa-star' : 'far fa-star';
  const tagsHtml  = item.tags?.length
    ? `<div class="card-tags">${item.tags.map(t => `<span class="tag-chip">${t}</span>`).join('')}</div>` : '';

  if (item.type === 'youtube') {
    const thumb = item.thumbnail || '';
    const thumbHtml = thumb
      ? `<img class="yt-thumb" src="${thumb}" alt="${VaultUtils.trunc(item.title,60)}" loading="lazy">`
      : `<div class="yt-thumb-placeholder"><i class="fab fa-youtube" style="color:#FF4444"></i></div>`;
    div.innerHTML = `
      <div class="yt-card-inner">
        <div class="yt-thumb-wrap">
          ${thumbHtml}
          <div class="yt-play-badge"><i class="fas fa-play"></i> YouTube</div>
        </div>
        <div class="yt-card-info">
          <p class="yt-title">${VaultUtils.trunc(item.title, 90)}</p>
          <div class="yt-meta">
            <i class="fas fa-circle-user"></i>
            <span>${VaultUtils.trunc(item.channel || 'YouTube', 40)}</span>
            <span>·</span>
            <span>${VaultUtils.formatDate(item.createdAt)}</span>
          </div>
        </div>
        ${tagsHtml}
      </div>
      <button class="${starClass}" data-action="star"><i class="${starIcon}"></i></button>`;

  } else if (item.type === 'link') {
    const domain = VaultUtils.getDomain(item.url || '');
    const faviconHtml = item.favicon
      ? `<img src="${item.favicon}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : `<i class="fas fa-globe"></i>`;
    div.innerHTML = `
      <div class="link-card-inner">
        <div class="link-favicon">${faviconHtml}</div>
        <div class="link-info">
          <p class="link-title">${VaultUtils.trunc(item.title || domain, 80)}</p>
          <p class="link-domain">${domain}</p>
          ${item.description ? `<p class="link-desc">${VaultUtils.trunc(item.description, 100)}</p>` : ''}
        </div>
        <button class="link-open-btn" data-action="open" title="Open link"><i class="fas fa-arrow-up-right-from-square"></i></button>
      </div>
      ${tagsHtml}
      <button class="${starClass}" data-action="star"><i class="${starIcon}"></i></button>`;

  } else if (item.type === 'note') {
    const color = item.color || '#6C63FF';
    div.innerHTML = `
      <div class="note-card-inner">
        <div class="note-color-bar" style="background:${color}"></div>
        ${item.title ? `<p class="note-card-title">${VaultUtils.trunc(item.title, 60)}</p>` : ''}
        <p class="note-card-body">${VaultUtils.trunc(item.description || '', 160)}</p>
        <p class="note-card-date">${VaultUtils.formatDate(item.createdAt)}</p>
      </div>
      ${tagsHtml}
      <button class="${starClass}" data-action="star"><i class="${starIcon}"></i></button>`;

  } else if (item.type === 'file') {
    const fi = VaultUtils.fileIcon(item.driveMimeType || '');
    div.innerHTML = `
      <div class="file-card-inner">
        <div class="file-icon" style="background:${fi.grad}"><i class="fas ${fi.icon}"></i></div>
        <div class="file-info">
          <p class="file-name">${VaultUtils.trunc(item.title || 'Untitled', 60)}</p>
          <div class="file-meta">
            <span>${VaultUtils.formatBytes(item.driveSize || 0)}</span>
            <span class="file-drive-badge"><i class="fab fa-google-drive"></i> Drive</span>
          </div>
        </div>
        <button class="link-open-btn" data-action="open-drive" title="Open in Drive"><i class="fas fa-arrow-up-right-from-square"></i></button>
      </div>
      ${tagsHtml}
      <button class="${starClass}" data-action="star"><i class="${starIcon}"></i></button>`;
  }

  // Card click delegation
  div.addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'star') {
      e.stopPropagation();
      _toggleStar(item);
    } else if (action === 'open') {
      e.stopPropagation();
      window.open(item.url, '_blank', 'noopener');
    } else if (action === 'open-drive') {
      e.stopPropagation();
      window.open(DriveManager.getViewURL(item.driveFileId), '_blank', 'noopener');
    } else {
      _openDetail(item);
    }
  });

  return div;
}

// ============================================
// STAR / UNSTAR
// ============================================
async function _toggleStar(item) {
  if (!_user) return;
  try {
    await updateDoc(doc(db, 'users', _user.uid, 'items', item.id), {
      starred: !item.starred
    });
    VaultUtils.toast(item.starred ? 'Removed from starred' : 'Added to starred ⭐', 'info', 1800);
  } catch { VaultUtils.toast('Could not update', 'error'); }
}

// ============================================
// LIBRARY FILTERS + SORT
// ============================================
(function setupLibraryControls() {
  // Filter pills
  document.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      _activeFilter = pill.dataset.filter;
      _renderLibrary();
    });
  });

  // Sort button toggle
  document.getElementById('sort-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('sort-dropdown')?.classList.toggle('hidden');
  });
  document.querySelectorAll('.sort-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.sort-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      _activeSort = opt.dataset.sort;
      document.getElementById('sort-btn')?.querySelector('i')?.classList.toggle('fa-sort-amount-up', _activeSort === 'oldest');
      document.getElementById('sort-dropdown')?.classList.add('hidden');
      _renderLibrary();
    });
  });
  document.addEventListener('click', () => document.getElementById('sort-dropdown')?.classList.add('hidden'));
})();

// ============================================
// SEARCH
// ============================================
(function setupSearch() {
  const inp   = document.getElementById('search-input');
  const clear = document.getElementById('search-clear-btn');

  inp?.addEventListener('input', () => {
    const val = inp.value;
    clear?.classList.toggle('hidden', !val);
    _renderSearch(val);
  });
  clear?.addEventListener('click', () => {
    inp && (inp.value = '');
    clear.classList.add('hidden');
    _renderSearch('');
    inp?.focus();
  });
})();

// ============================================
// ADD LINK MODAL
// ============================================
async function _openAddLinkModal(prefillUrl = '') {
  _pendingLink = null;
  _linkTags    = [];
  const urlInput = document.getElementById('link-url-input');
  const preview  = document.getElementById('link-preview');
  const tagsWrap = document.getElementById('link-tags-wrap');
  const saveBtn  = document.getElementById('save-link-btn');
  const loading  = document.getElementById('link-loading');

  if (urlInput) urlInput.value = prefillUrl;
  preview?.classList.add('hidden');
  tagsWrap?.classList.add('hidden');
  if (saveBtn) saveBtn.disabled = true;
  loading?.classList.add('hidden');
  document.getElementById('link-tags-display') && (document.getElementById('link-tags-display').innerHTML = '');

  VaultUtils.openModal('add-link-modal');

  if (prefillUrl) {
    await _detectAndPreview(prefillUrl);
  }

  // Focus input if no prefill
  if (!prefillUrl) setTimeout(() => urlInput?.focus(), 300);
}

// Detect button
document.getElementById('detect-btn')?.addEventListener('click', async () => {
  const url = document.getElementById('link-url-input')?.value.trim();
  if (url) await _detectAndPreview(url);
});
document.getElementById('link-url-input')?.addEventListener('keydown', async e => {
  if (e.key === 'Enter') {
    const url = e.target.value.trim();
    if (url) await _detectAndPreview(url);
  }
});

// Auto-detect on paste
document.getElementById('link-url-input')?.addEventListener('paste', e => {
  setTimeout(async () => {
    const url = e.target.value.trim();
    if (url) await _detectAndPreview(url);
  }, 100);
});

async function _detectAndPreview(rawUrl) {
  const detected = VaultUtils.detectURL(rawUrl);
  if (!detected) { VaultUtils.toast('Please enter a valid URL', 'warning'); return; }

  const preview  = document.getElementById('link-preview');
  const tagsWrap = document.getElementById('link-tags-wrap');
  const saveBtn  = document.getElementById('save-link-btn');
  const loading  = document.getElementById('link-loading');

  loading?.classList.remove('hidden');
  preview?.classList.add('hidden');

  try {
    if (detected.type === 'youtube') {
      _pendingLink = await URLDetector.fetchYouTube(rawUrl, detected.id);
    } else {
      _pendingLink = await URLDetector.fetchWebsite(rawUrl);
    }

    // Render preview
    if (preview) {
      preview.innerHTML = _buildLinkPreview(_pendingLink);
      preview.classList.remove('hidden');
    }
    tagsWrap?.classList.remove('hidden');
    if (saveBtn) saveBtn.disabled = false;

  } catch (e) {
    VaultUtils.toast('Could not fetch link info — it will be saved with URL only', 'warning', 4000);
    _pendingLink = { type: detected.type === 'youtube' ? 'youtube' : 'link', url: rawUrl,
                     title: VaultUtils.getDomain(rawUrl), description: '', favicon: '', thumbnail: '', channel: '' };
    if (saveBtn) saveBtn.disabled = false;
    tagsWrap?.classList.remove('hidden');
  } finally {
    loading?.classList.add('hidden');
  }
}

function _buildLinkPreview(data) {
  if (data.type === 'youtube') {
    const thumb = data.thumbnail
      ? `<img class="preview-yt-thumb" src="${data.thumbnail}" alt="" loading="lazy">`
      : `<div class="preview-yt-thumb" style="height:160px;background:var(--bg-3);display:flex;align-items:center;justify-content:center;font-size:40px"><i class="fab fa-youtube" style="color:#FF4444"></i></div>`;
    return `<div class="preview-yt">${thumb}
      <div class="preview-yt-info">
        <p class="preview-yt-title">${VaultUtils.trunc(data.title, 100)}</p>
        <p class="preview-yt-meta"><i class="fas fa-circle-user"></i> ${data.channel || 'YouTube'}</p>
      </div></div>`;
  }
  const domain = VaultUtils.getDomain(data.url);
  const favicon = data.favicon
    ? `<img src="${data.favicon}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-globe\\'></i>'">`
    : `<i class="fas fa-globe"></i>`;
  return `<div class="preview-link">
    <div class="preview-link-icon">${favicon}</div>
    <div>
      <p class="preview-link-title">${VaultUtils.trunc(data.title || domain, 80)}</p>
      <p class="preview-link-url">${domain}</p>
    </div></div>`;
}

// Save link
document.getElementById('save-link-btn')?.addEventListener('click', async () => {
  if (!_pendingLink || !_user) return;
  const btn = document.getElementById('save-link-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px;border-top-color:#fff"></div>';
  try {
    await addDoc(itemsRef(_user.uid), {
      ..._pendingLink,
      tags:      _linkTags,
      starred:   false,
      pinned:    false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    VaultUtils.closeModal('add-link-modal');
    VaultUtils.toast('Saved to vault ✅', 'success');
    _pendingLink = null;
    _linkTags = [];
  } catch (e) {
    VaultUtils.toast('Failed to save: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<span>Save</span>';
  }
});

// ============================================
// ADD NOTE MODAL
// ============================================
function _openAddNoteModal() {
  _noteTags = [];
  _selectedColor = '#6C63FF';

  const titleIn   = document.getElementById('note-title');
  const contentIn = document.getElementById('note-content');
  const tagsDisp  = document.getElementById('note-tags-display');
  if (titleIn)   titleIn.value = '';
  if (contentIn) contentIn.value = '';
  if (tagsDisp)  tagsDisp.innerHTML = '';

  // Reset color swatches
  document.querySelectorAll('.note-color-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === _selectedColor);
  });

  VaultUtils.openModal('add-note-modal');
  setTimeout(() => contentIn?.focus(), 300);
}

// Color picker
document.querySelectorAll('.note-color-swatch').forEach(sw => {
  sw.addEventListener('click', () => {
    document.querySelectorAll('.note-color-swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    _selectedColor = sw.dataset.color;
  });
});

// Save note
document.getElementById('save-note-btn')?.addEventListener('click', async () => {
  if (!_user) return;
  const title   = document.getElementById('note-title')?.value.trim();
  const content = document.getElementById('note-content')?.value.trim();
  if (!content && !title) { VaultUtils.toast('Write something first', 'warning'); return; }

  const btn = document.getElementById('save-note-btn');
  btn.disabled = true;
  try {
    await addDoc(itemsRef(_user.uid), {
      type:        'note',
      title:       title || '',
      description: content,
      color:       _selectedColor,
      tags:        _noteTags,
      starred:     false,
      pinned:      false,
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp()
    });
    VaultUtils.closeModal('add-note-modal');
    VaultUtils.toast('Note saved ✅', 'success');
    _noteTags = [];
  } catch (e) {
    VaultUtils.toast('Failed to save: ' + e.message, 'error');
    btn.disabled = false;
  }
});

// ============================================
// FILE UPLOAD
// ============================================
async function _triggerFileUpload() {
  const inp = document.getElementById('file-input');
  if (!inp) return;

  // Check Drive connected
  if (!DriveManager._token) {
    const ok = await DriveManager.connect(_user.uid);
    if (!ok) return;
  }

  inp.click();
}

document.getElementById('file-input')?.addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file || !_user) return;
  e.target.value = ''; // Reset for re-use

  VaultUtils.toast(`Uploading ${VaultUtils.trunc(file.name, 30)}...`, 'info', 30000);

  try {
    const driveFile = await DriveManager.uploadFile(file, _user.uid, pct => {
      console.log('[VaultX] Upload progress:', pct + '%');
    });

    await addDoc(itemsRef(_user.uid), {
      type:         'file',
      title:        driveFile.name,
      driveFileId:  driveFile.id,
      driveMimeType:driveFile.mimeType,
      driveSize:    driveFile.size,
      tags:         [],
      starred:      false,
      pinned:       false,
      createdAt:    serverTimestamp(),
      updatedAt:    serverTimestamp()
    });

    // Dismiss the uploading toast by showing success
    VaultUtils.toast(`${VaultUtils.trunc(file.name, 30)} saved to Drive ✅`, 'success');
  } catch (e) {
    VaultUtils.toast('Upload failed: ' + e.message, 'error');
  }
});

// ============================================
// TAGS INPUT (reusable)
// ============================================
(function setupTagsInputs() {
  // Link tags
  _setupTagInput('link-tags-input', 'link-tags-display', _linkTags);
  // Note tags
  _setupTagInput('note-tags-input', 'note-tags-display', _noteTags);
})();

function _setupTagInput(inputId, displayId, tagsArray) {
  const inp  = document.getElementById(inputId);
  const disp = document.getElementById(displayId);
  if (!inp || !disp) return;

  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = inp.value.trim().toLowerCase().replace(/,/g,'');
      if (tag && !tagsArray.includes(tag) && tagsArray.length < 10) {
        tagsArray.push(tag);
        inp.value = '';
        _renderTags(disp, tagsArray);
      }
    } else if (e.key === 'Backspace' && !inp.value && tagsArray.length) {
      tagsArray.pop();
      _renderTags(disp, tagsArray);
    }
  });
}

function _renderTags(container, tags) {
  container.innerHTML = tags.map((t,i) => `
    <span class="tag-removable">
      ${t}
      <button type="button" data-idx="${i}" aria-label="Remove tag">×</button>
    </span>`).join('');
  container.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      tags.splice(parseInt(btn.dataset.idx),1);
      _renderTags(container, tags);
    });
  });
}

// ============================================
// ITEM DETAIL MODAL
// ============================================
function _openDetail(item) {
  const body    = document.getElementById('detail-body');
  const footer  = document.getElementById('detail-footer');
  const typeLabel = document.getElementById('detail-type-label');
  if (!body || !footer) return;

  // Type label
  const labels = { youtube:'YouTube', link:'Web link', note:'Note', file:'File' };
  if (typeLabel) typeLabel.textContent = labels[item.type] || 'Item';

  // Build body HTML
  const tagsHtml = item.tags?.length
    ? `<div class="detail-tags">${item.tags.map(t => `<span class="tag-chip">${t}</span>`).join('')}</div>` : '';
  const dateStr = VaultUtils.formatDate(item.createdAt);

  if (item.type === 'youtube') {
    const thumb = item.thumbnail
      ? `<img src="${item.thumbnail}" alt="" style="width:100%;border-radius:var(--r3)">`
      : `<div style="height:180px;background:var(--bg-3);border-radius:var(--r3);display:flex;align-items:center;justify-content:center;font-size:48px"><i class="fab fa-youtube" style="color:#FF4444"></i></div>`;
    body.innerHTML = `
      <div>${thumb}</div>
      <p class="detail-title">${item.title || 'Untitled'}</p>
      <div class="detail-meta">
        <span><i class="fas fa-circle-user"></i> ${item.channel || 'YouTube'}</span>
        <span><i class="fas fa-clock"></i> ${dateStr}</span>
      </div>
      <p class="detail-url">${item.url}</p>
      ${tagsHtml}`;
    footer.innerHTML = `
      <button class="btn btn-primary" id="detail-open-btn"><i class="fas fa-play"></i> Watch</button>
      <button class="btn btn-secondary" id="detail-delete-btn"><i class="fas fa-trash"></i></button>`;

  } else if (item.type === 'link') {
    const domain = VaultUtils.getDomain(item.url || '');
    const faviconHtml = item.favicon
      ? `<img src="${item.favicon}" alt="" style="width:32px;height:32px;object-fit:contain">`
      : `<i class="fas fa-globe" style="font-size:32px;color:var(--primary)"></i>`;
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--s3)">
        ${faviconHtml}
        <div>
          <p class="detail-title" style="margin:0">${item.title || domain}</p>
          <p style="font-size:13px;color:var(--t3)">${domain}</p>
        </div>
      </div>
      ${item.description ? `<p class="detail-desc">${item.description}</p>` : ''}
      <p class="detail-url">${item.url}</p>
      <div class="detail-meta"><span><i class="fas fa-clock"></i> ${dateStr}</span></div>
      ${tagsHtml}`;
    footer.innerHTML = `
      <button class="btn btn-primary" id="detail-open-btn"><i class="fas fa-arrow-up-right-from-square"></i> Open</button>
      <button class="btn btn-secondary" id="detail-share-btn"><i class="fas fa-share"></i></button>
      <button class="btn btn-secondary" id="detail-delete-btn"><i class="fas fa-trash"></i></button>`;

  } else if (item.type === 'note') {
    const color = item.color || '#6C63FF';
    body.innerHTML = `
      <div style="width:40px;height:4px;border-radius:2px;background:${color};margin-bottom:var(--s2)"></div>
      ${item.title ? `<p class="detail-title">${item.title}</p>` : ''}
      <p class="detail-note-body">${item.description || ''}</p>
      <div class="detail-meta"><span><i class="fas fa-clock"></i> ${dateStr}</span></div>
      ${tagsHtml}`;
    footer.innerHTML = `
      <button class="btn btn-secondary" id="detail-copy-btn"><i class="fas fa-copy"></i> Copy</button>
      <button class="btn btn-secondary" id="detail-delete-btn"><i class="fas fa-trash"></i></button>`;

  } else if (item.type === 'file') {
    const fi = VaultUtils.fileIcon(item.driveMimeType || '');
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:var(--s4)">
        <div style="width:80px;height:80px;border-radius:var(--r4);background:${fi.grad};display:flex;align-items:center;justify-content:center;font-size:36px;color:#fff">
          <i class="fas ${fi.icon}"></i>
        </div>
        <p class="detail-title" style="text-align:center">${item.title || 'Untitled'}</p>
        <div class="detail-meta">
          <span>${VaultUtils.formatBytes(item.driveSize || 0)}</span>
          <span class="file-drive-badge"><i class="fab fa-google-drive"></i> Google Drive</span>
        </div>
        <div class="detail-meta"><span><i class="fas fa-clock"></i> ${dateStr}</span></div>
      </div>
      ${tagsHtml}`;
    footer.innerHTML = `
      <button class="btn btn-primary" id="detail-open-btn"><i class="fas fa-arrow-up-right-from-square"></i> Open in Drive</button>
      <button class="btn btn-secondary" id="detail-delete-btn"><i class="fas fa-trash"></i></button>`;
  }

  VaultUtils.openModal('item-detail-modal');

  // Button handlers
  document.getElementById('detail-open-btn')?.addEventListener('click', () => {
    if (item.type === 'file') window.open(DriveManager.getViewURL(item.driveFileId), '_blank', 'noopener');
    else window.open(item.url, '_blank', 'noopener');
  });

  document.getElementById('detail-share-btn')?.addEventListener('click', async () => {
    if (navigator.share) {
      try { await navigator.share({ title: item.title, url: item.url }); }
      catch {}
    } else {
      await navigator.clipboard.writeText(item.url);
      VaultUtils.toast('URL copied to clipboard', 'success');
    }
  });

  document.getElementById('detail-copy-btn')?.addEventListener('click', async () => {
    const text = [item.title, item.description].filter(Boolean).join('\n');
    await navigator.clipboard.writeText(text);
    VaultUtils.toast('Copied to clipboard', 'success');
  });

  document.getElementById('detail-delete-btn')?.addEventListener('click', () => {
    VaultUtils.closeModal('item-detail-modal');
    _confirmDelete(item);
  });
}

// ============================================
// DELETE ITEM
// ============================================
function _confirmDelete(item) {
  const title = document.getElementById('confirm-title');
  const msg   = document.getElementById('confirm-message');
  if (title) title.textContent = 'Delete item?';
  if (msg)   msg.textContent   = `"${VaultUtils.trunc(item.title || 'This item', 50)}" will be permanently deleted.`;
  VaultUtils.openModal('confirm-modal');

  const okBtn = document.getElementById('confirm-ok');
  const canBtn= document.getElementById('confirm-cancel');

  const cleanup = () => {
    okBtn?.removeEventListener('click', handleOk);
    canBtn?.removeEventListener('click', handleCancel);
    VaultUtils.closeModal('confirm-modal');
  };
  const handleOk = async () => {
    cleanup();
    try {
      await deleteDoc(doc(db, 'users', _user.uid, 'items', item.id));
      // Also delete from Drive if file
      if (item.type === 'file' && item.driveFileId) {
        DriveManager.deleteFile(item.driveFileId).catch(()=>{});
      }
      VaultUtils.toast('Item deleted', 'info');
    } catch { VaultUtils.toast('Failed to delete', 'error'); }
  };
  const handleCancel = cleanup;

  okBtn?.addEventListener('click', handleOk,    { once: true });
  canBtn?.addEventListener('click', handleCancel,{ once: true });
}

// ============================================
// URL DETECTOR — YouTube oEmbed + OG meta
// ============================================
const URLDetector = {
  async fetchYouTube(url, videoId) {
    const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res  = await fetch(oEmbedUrl);
    if (!res.ok) throw new Error('YouTube fetch failed');
    const data = await res.json();
    return {
      type:      'youtube',
      url,
      title:     data.title || 'YouTube Video',
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      channel:   data.author_name || '',
      description: ''
    };
  },

  async fetchWebsite(url) {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res      = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('Fetch failed');
    const data     = await res.json();
    const parser   = new DOMParser();
    const doc2     = parser.parseFromString(data.contents || '', 'text/html');

    const getMeta = (prop) =>
      doc2.querySelector(`meta[property="${prop}"]`)?.content ||
      doc2.querySelector(`meta[name="${prop}"]`)?.content || '';

    const title  = getMeta('og:title') || doc2.title || VaultUtils.getDomain(url);
    const desc   = getMeta('og:description') || getMeta('description') || '';
    const domain = VaultUtils.getDomain(url);
    const favicon= `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

    return { type: 'link', url, title, description: desc, favicon };
  }
};

// ============================================
// SETTINGS PAGE
// ============================================
async function _loadSettingsPage() {
  if (!_user) return;
  // Profile
  document.getElementById('settings-name')  && (document.getElementById('settings-name').textContent  = _user.displayName || 'VaultX User');
  document.getElementById('settings-email') && (document.getElementById('settings-email').textContent = _user.email || '');

  // Settings avatar
  const sa = document.getElementById('settings-avatar');
  if (sa) {
    if (_user.photoURL) {
      sa.innerHTML = `<img src="${_user.photoURL}" alt="">`;
    } else {
      const initials = (_user.displayName || 'VX').split(' ').map(w => w[0]).join('').toUpperCase().substring(0,2);
      sa.innerHTML = `<span style="font-size:18px;font-weight:700;color:#fff">${initials}</span>`;
    }
  }

  // Drive status
  try {
    const snap = await getDoc(userDocRef(_user.uid));
    const data = snap.data() || {};
    if (data.driveConnected) {
      document.getElementById('drive-email-display') && (document.getElementById('drive-email-display').textContent = data.driveEmail || 'Connected');
      document.getElementById('connect-drive-btn')   && (document.getElementById('connect-drive-btn').textContent   = 'Reconnect');
    }

    // Biometric toggle
    const bioToggle = document.getElementById('bio-toggle');
    if (bioToggle) bioToggle.checked = !!localStorage.getItem('vaultx_bio');

    // Autolock select
    const autolockSel = document.getElementById('autolock-select');
    if (autolockSel) autolockSel.value = localStorage.getItem('vaultx_autolock') || '5';

    // Dark mode toggle
    const darkToggle = document.getElementById('dark-toggle');
    if (darkToggle) darkToggle.checked = !document.body.classList.contains('light');
  } catch {}
}

(function setupSettings() {
  // Connect Drive
  document.getElementById('connect-drive-btn')?.addEventListener('click', async () => {
    if (_user) await DriveManager.connect(_user.uid);
  });

  // Change PIN
  document.getElementById('change-pin-btn')?.addEventListener('click', () => {
    window.PinManager?.startChange();
  });

  // Biometric toggle
  document.getElementById('bio-toggle')?.addEventListener('change', async e => {
    if (e.target.checked) {
      const ok = await window.BiometricManager?.register(_user?.uid);
      if (!ok) {
        e.target.checked = false;
        VaultUtils.toast('Biometric not available on this device', 'warning');
      } else {
        VaultUtils.toast('Biometric enabled', 'success');
        try { await updateDoc(userDocRef(_user.uid), { bioEnabled: true }); } catch {}
      }
    } else {
      window.BiometricManager?.disable();
      try { await updateDoc(userDocRef(_user.uid), { bioEnabled: false }); } catch {}
      VaultUtils.toast('Biometric disabled', 'info');
    }
  });

  // Autolock select
  document.getElementById('autolock-select')?.addEventListener('change', e => {
    const val = e.target.value;
    localStorage.setItem('vaultx_autolock', val);
    VaultUtils.toast(`Auto-lock set to ${val === '0' ? 'off' : val + ' min'}`, 'info', 2000);
  });

  // Dark mode toggle
  document.getElementById('dark-toggle')?.addEventListener('change', e => {
    if (e.target.checked) {
      document.body.classList.remove('light');
      localStorage.setItem('vaultx_theme', 'dark');
    } else {
      document.body.classList.add('light');
      localStorage.setItem('vaultx_theme', 'light');
    }
  });

  // Export data
  document.getElementById('export-btn')?.addEventListener('click', async () => {
    if (!_user || !_items.length) { VaultUtils.toast('Nothing to export', 'warning'); return; }
    const json = JSON.stringify(_items.map(({id,...rest}) => ({id,...rest})), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vaultx-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    VaultUtils.toast('Export downloaded', 'success');
  });

  // Sign out (auth listener handles navigation to auth screen)
  document.getElementById('signout-btn')?.addEventListener('click', async () => {
    if (confirm('Sign out of VaultX?')) {
      await window.AuthManager?.signOut();
    }
  });

  // Delete account
  document.getElementById('delete-account-btn')?.addEventListener('click', async () => {
    if (!confirm('Delete your account? This cannot be undone. All your vault data will be permanently deleted.')) return;
    if (!confirm('Are you absolutely sure? Type "ok" in the next prompt.')) return;
    const conf = prompt('Type DELETE to confirm:');
    if (conf !== 'DELETE') return;
    try {
      // Delete all Firestore items then delete account
      const snap = await getDocs(itemsRef(_user.uid));
      for (const d of snap.docs) await deleteDoc(d.ref);
      await window.AuthManager?.deleteAccount();
      VaultUtils.toast('Account deleted', 'info');
    } catch (e) {
      VaultUtils.toast('Failed: ' + e.message + ' — please re-login and try again', 'error', 6000);
    }
  });
})();

// ============================================
// FAB CLOSE
// ============================================
function _closeFAB() {
  _fabOpen = false;
  document.getElementById('fab-menu')?.classList.add('hidden');
  document.getElementById('fab-overlay')?.classList.add('hidden');
  document.getElementById('fab-btn')?.classList.remove('open');
}

// ============================================
// HELPERS
// ============================================
function _el(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function _wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================
// EXPORTS
// ============================================
window.AppManager    = AppManager;
window.URLDetector   = URLDetector;

export { AppManager };
