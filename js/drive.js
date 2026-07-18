// ============================================
// VAULTX - GOOGLE DRIVE MANAGER
// Handles: Drive connection, file picker,
//          storage info, multiple drives
// ============================================

import {
  db, auth,
  collection, doc,
  addDoc, getDocs, getDoc,
  setDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp
} from './firebase-config.js';

// ============================================
// DRIVE MANAGER
// ============================================
export const DriveManager = {

  _drives:       [],       // All connected drives
  _defaultDrive: null,     // Default drive object
  _pickerLoaded: false,    // Google Picker API loaded?
  _accessToken:  null,     // Current OAuth token

  // ==========================================
  // INIT - Load drives from Firestore
  // ==========================================
  async init(uid) {
    if (!uid) return;
    await this._loadDrives(uid);
    this._updateDriveStatusBar();
    this._loadGoogleAPIs();
  },

  // ==========================================
  // LOAD DRIVES FROM FIRESTORE
  // ==========================================
  async _loadDrives(uid) {
    try {
      const drivesRef = collection(db, 'users', uid, 'drives');
      const snap      = await getDocs(query(drivesRef, orderBy('addedAt')));

      this._drives = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Find default
      this._defaultDrive =
        this._drives.find(d => d.isDefault) || this._drives[0] || null;

      // Sync localStorage
      localStorage.setItem('vaultx_drives', JSON.stringify(this._drives));

      console.log(`[VaultX Drive] Loaded ${this._drives.length} drive(s)`);
    } catch (err) {
      console.error('[VaultX Drive] Load error:', err);
      // Fallback to localStorage
      const local = localStorage.getItem('vaultx_drives');
      if (local) {
        try { this._drives = JSON.parse(local); } catch {}
      }
    }
  },

  // ==========================================
  // LOAD GOOGLE APIS (Picker)
  // ==========================================
  _loadGoogleAPIs() {
    if (document.getElementById('google-api-script')) return;

    const script    = document.createElement('script');
    script.id       = 'google-api-script';
    script.src      = 'https://apis.google.com/js/api.js';
    script.onload   = () => {
      gapi.load('picker', () => {
        this._pickerLoaded = true;
        console.log('[VaultX Drive] Google Picker loaded ✅');
      });
    };
    script.onerror  = () => {
      console.warn('[VaultX Drive] Google Picker failed to load');
    };
    document.head.appendChild(script);
  },

  // ==========================================
  // ADD NEW DRIVE
  // ==========================================
  async addDrive(uid) {
    const { googleProvider, signInWithPopup, auth } =
      await import('./firebase-config.js');

    try {
      // Force account selection
      googleProvider.setCustomParameters({ prompt: 'select_account' });

      const result = await signInWithPopup(auth, googleProvider);
      const email  = result.user.email;
      const token  = result._tokenResponse?.oauthAccessToken || null;

      // Check duplicate
      if (this._drives.find(d => d.email === email)) {
        window.VaultUtils.showToast(
          'This Drive account is already connected', 'error'
        );
        return null;
      }

      const driveData = {
        email:        email,
        name:         result.user.displayName || email,
        photoURL:     result.user.photoURL    || '',
        isDefault:    this._drives.length === 0,
        addedAt:      serverTimestamp(),
        storageUsed:  0,
        storageTotal: 15 * 1024 * 1024 * 1024,
        filesCount:   0,
        lastSync:     null,
        accessToken:  token
      };

      // Save to Firestore
      const docRef = await addDoc(
        collection(db, 'users', uid, 'drives'),
        driveData
      );

      const newDrive = { id: docRef.id, ...driveData };
      this._drives.push(newDrive);

      if (newDrive.isDefault) this._defaultDrive = newDrive;

      // Update localStorage
      localStorage.setItem('vaultx_drives', JSON.stringify(this._drives));

      // Fetch actual storage info
      if (token) {
        await this._fetchStorageInfo(docRef.id, uid, token);
      }

      this._updateDriveStatusBar();
      this._renderDrivesPage();

      window.VaultUtils.showToast(
        `Drive connected: ${email} ✅`, 'success'
      );

      return newDrive;

    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' &&
          err.code !== 'auth/cancelled-popup-request') {
        console.error('[VaultX Drive] Add drive error:', err);
        window.VaultUtils.showToast(
          'Could not connect Drive. Try again.', 'error'
        );
      }
      return null;
    }
  },

  // ==========================================
  // FETCH STORAGE INFO FROM GOOGLE DRIVE API
  // ==========================================
  async _fetchStorageInfo(driveId, uid, accessToken) {
    if (!accessToken) return;

    try {
      const res = await fetch(
        'https://www.googleapis.com/drive/v3/about?fields=storageQuota',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!res.ok) return;

      const data   = await res.json();
      const quota  = data.storageQuota;

      const used   = parseInt(quota.usage)    || 0;
      const total  = parseInt(quota.limit)    || 15 * 1024 * 1024 * 1024;

      // Update Firestore
      await updateDoc(
        doc(db, 'users', uid, 'drives', driveId),
        { storageUsed: used, storageTotal: total, lastSync: serverTimestamp() }
      );

      // Update local
      const idx = this._drives.findIndex(d => d.id === driveId);
      if (idx !== -1) {
        this._drives[idx].storageUsed  = used;
        this._drives[idx].storageTotal = total;
      }

      localStorage.setItem('vaultx_drives', JSON.stringify(this._drives));

    } catch (err) {
      console.warn('[VaultX Drive] Storage fetch failed:', err);
    }
  },

  // ==========================================
  // REMOVE DRIVE
  // ==========================================
  async removeDrive(driveId, uid) {
    const drive = this._drives.find(d => d.id === driveId);
    if (!drive) return;

    const confirm = window.confirm(
      `Remove "${drive.email}" from VaultX?\n\n` +
      `Note: Files in Google Drive won't be deleted, ` +
      `but links saved from this drive won't open.`
    );

    if (!confirm) return;

    try {
      // Remove from Firestore
      await deleteDoc(doc(db, 'users', uid, 'drives', driveId));

      // Remove from local array
      this._drives = this._drives.filter(d => d.id !== driveId);

      // If removed drive was default → set first remaining as default
      if (drive.isDefault && this._drives.length > 0) {
        await this.setDefault(this._drives[0].id, uid);
      } else {
        this._defaultDrive = this._drives.find(d => d.isDefault) || null;
      }

      localStorage.setItem('vaultx_drives', JSON.stringify(this._drives));

      this._updateDriveStatusBar();
      this._renderDrivesPage();

      window.VaultUtils.showToast(
        `Drive removed: ${drive.email}`, 'info'
      );
    } catch (err) {
      console.error('[VaultX Drive] Remove error:', err);
      window.VaultUtils.showToast('Error removing drive', 'error');
    }
  },

  // ==========================================
  // SET DEFAULT DRIVE
  // ==========================================
  async setDefault(driveId, uid) {
    try {
      // Update all drives in Firestore
      const updates = this._drives.map(d => {
        const isDefault = d.id === driveId;
        d.isDefault = isDefault;
        return updateDoc(
          doc(db, 'users', uid, 'drives', d.id),
          { isDefault }
        );
      });

      await Promise.all(updates);

      this._defaultDrive = this._drives.find(d => d.id === driveId) || null;

      if (this._defaultDrive) {
        localStorage.setItem(
          'vaultx_default_drive',
          this._defaultDrive.email
        );
      }

      localStorage.setItem('vaultx_drives', JSON.stringify(this._drives));

      this._updateDriveStatusBar();
      this._renderDrivesPage();

      window.VaultUtils.showToast(
        `Default drive set to: ${this._defaultDrive?.email}`, 'success'
      );
    } catch (err) {
      console.error('[VaultX Drive] Set default error:', err);
      window.VaultUtils.showToast('Error updating default drive', 'error');
    }
  },

  // ==========================================
  // OPEN GOOGLE DRIVE FILE PICKER
  // ==========================================
  openPicker(uid, onFilePicked) {
    if (!this._defaultDrive) {
      window.VaultUtils.showToast(
        'Please connect a Google Drive first', 'error'
      );
      window.AppManager?.goTo('drives');
      return;
    }

    if (!this._pickerLoaded || typeof gapi === 'undefined') {
      // Fallback: open Google Drive in new tab
      this._fallbackDrivePicker(uid, onFilePicked);
      return;
    }

    const token = this._defaultDrive.accessToken;
    if (!token) {
      this._fallbackDrivePicker(uid, onFilePicked);
      return;
    }

    try {
      const picker = new google.picker.PickerBuilder()
        .addView(google.picker.ViewId.DOCS)
        .addView(google.picker.ViewId.PDFS)
        .addView(new google.picker.DocsView(google.picker.ViewId.DOCS)
          .setIncludeFolders(true))
        .setOAuthToken(token)
        .setDeveloperKey('') // Optional: Add your API key for production
        .setCallback((data) => {
          if (data.action === google.picker.Action.PICKED) {
            const file = data.docs[0];
            onFilePicked({
              id:       file.id,
              name:     file.name,
              mimeType: file.mimeType,
              url:      file.url || `https://drive.google.com/file/d/${file.id}/view`,
              iconUrl:  file.iconUrl,
              sizeBytes: file.sizeBytes || 0,
              driveEmail: this._defaultDrive.email
            });
          }
        })
        .build();

      picker.setVisible(true);
    } catch (err) {
      console.error('[VaultX Drive] Picker error:', err);
      this._fallbackDrivePicker(uid, onFilePicked);
    }
  },

  // ==========================================
  // FALLBACK: Manual Drive Link
  // ==========================================
  _fallbackDrivePicker(uid, onFilePicked) {
    // Show a modal asking user to paste Drive link
    window.AppManager?.showDriveLinkModal(onFilePicked);
  },

  // ==========================================
  // PARSE GOOGLE DRIVE LINK
  // ==========================================
  parseDriveLink(url) {
    // Handles various Google Drive URL formats
    const patterns = [
      /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
      /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
      /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/,
      /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
      /docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/,
      /drive\.google\.com\/drive\/folders\/([a-zA-Z0-9_-]+)/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          fileId:   match[1],
          viewUrl:  `https://drive.google.com/file/d/${match[1]}/view`,
          embedUrl: `https://drive.google.com/file/d/${match[1]}/preview`,
          type:     this._getDriveFileType(url)
        };
      }
    }
    return null;
  },

  _getDriveFileType(url) {
    if (url.includes('document'))     return 'doc';
    if (url.includes('spreadsheets')) return 'sheet';
    if (url.includes('presentation')) return 'slide';
    if (url.includes('folders'))      return 'folder';
    return 'file';
  },

  // ==========================================
  // CHECK DRIVE STORAGE - Alert if full
  // ==========================================
  checkStorageAlerts() {
    this._drives.forEach(drive => {
      if (!drive.storageTotal || drive.storageTotal === 0) return;

      const percent = (drive.storageUsed / drive.storageTotal) * 100;

      if (percent >= 95) {
        window.VaultUtils.showToast(
          `⚠️ Drive ${drive.email} is almost full (${percent.toFixed(0)}%)`,
          'warning',
          6000
        );
      }
    });
  },

  // ==========================================
  // FORMAT BYTES
  // ==========================================
  _formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k     = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i     = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  },

  // ==========================================
  // GET STORAGE PERCENT
  // ==========================================
  _getStoragePercent(drive) {
    if (!drive.storageTotal || drive.storageTotal === 0) return 0;
    return Math.min(
      (drive.storageUsed / drive.storageTotal) * 100,
      100
    );
  },

  // ==========================================
  // UPDATE DRIVE STATUS BAR (Home page)
  // ==========================================
  _updateDriveStatusBar() {
    const textEl = document.getElementById('drive-status-text');
    if (!textEl) return;

    if (this._drives.length === 0) {
      textEl.textContent = 'No drive connected — tap to add';
      return;
    }

    if (this._defaultDrive) {
      const percent = this._getStoragePercent(this._defaultDrive);
      const used    = this._formatBytes(this._defaultDrive.storageUsed);
      const total   = this._formatBytes(this._defaultDrive.storageTotal);

      textEl.textContent = percent > 0
        ? `${this._defaultDrive.email} • ${used} / ${total} used`
        : `${this._defaultDrive.email} • ${this._drives.length} drive${this._drives.length > 1 ? 's' : ''} connected`;
    }
  },

  // ==========================================
  // RENDER DRIVES PAGE
  // ==========================================
  _renderDrivesPage() {
    const container = document.getElementById('drives-list');
    if (!container) return;

    if (this._drives.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon" style="color:#4285F4">
            <i class="fab fa-google-drive"></i>
          </div>
          <h4>No drives connected</h4>
          <p>Add your Google Drive to store files</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this._drives.map(drive =>
      this._buildDriveCard(drive)
    ).join('');

    // Bind drive action buttons
    this._bindDriveActions();
  },

  // ==========================================
  // BUILD DRIVE CARD HTML
  // ==========================================
  _buildDriveCard(drive) {
    const percent = this._getStoragePercent(drive);
    const used    = this._formatBytes(drive.storageUsed || 0);
    const total   = this._formatBytes(drive.storageTotal || 15 * 1024 * 1024 * 1024);

    let fillClass = '';
    let dotClass  = '';
    let statusText = 'Connected';

    if (percent >= 95) {
      fillClass  = 'danger';
      dotClass   = 'danger';
      statusText = `Almost Full (${percent.toFixed(0)}%)`;
    } else if (percent >= 80) {
      fillClass  = 'warning';
      dotClass   = 'warning';
      statusText = `${percent.toFixed(0)}% used`;
    } else if (percent > 0) {
      statusText = `${percent.toFixed(0)}% used`;
    }

    const avatarHTML = drive.photoURL
      ? `<img src="${drive.photoURL}" alt="${drive.name}"
              onerror="this.parentElement.innerHTML='<i class=\\'fab fa-google-drive\\'></i>'" />`
      : `<i class="fab fa-google-drive"></i>`;

    return `
      <div class="drive-card" data-drive-id="${drive.id}">

        <div class="drive-card-header">
          <div class="drive-card-avatar">${avatarHTML}</div>
          <div class="drive-card-info">
            <div class="drive-card-email">${drive.email}</div>
            <div class="drive-card-status">
              <span class="drive-status-dot ${dotClass}"></span>
              ${statusText}
            </div>
          </div>
          ${drive.isDefault
            ? '<span class="drive-card-badge">Default</span>'
            : ''}
        </div>

        <div class="drive-storage">
          <div class="drive-storage-bar">
            <div class="drive-storage-fill ${fillClass}"
                 style="width:${percent.toFixed(1)}%"></div>
          </div>
          <div class="drive-storage-text">
            <span>${used} used</span>
            <span>${total} total</span>
          </div>
        </div>

        <div class="drive-card-actions">
          ${!drive.isDefault ? `
            <button class="drive-action-btn set-default"
                    data-action="set-default"
                    data-drive-id="${drive.id}">
              <i class="fas fa-star"></i> Set Default
            </button>
          ` : `
            <button class="drive-action-btn" disabled
                    style="opacity:0.4;pointer-events:none">
              <i class="fas fa-star" style="color:var(--warning)"></i> Default
            </button>
          `}
          <button class="drive-action-btn"
                  data-action="refresh"
                  data-drive-id="${drive.id}">
            <i class="fas fa-sync-alt"></i> Refresh
          </button>
          <button class="drive-action-btn remove"
                  data-action="remove"
                  data-drive-id="${drive.id}">
            <i class="fas fa-times"></i> Remove
          </button>
        </div>
      </div>
    `;
  },

  // ==========================================
  // BIND DRIVE ACTION BUTTONS
  // ==========================================
  _bindDriveActions() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action  = btn.dataset.action;
        const driveId = btn.dataset.driveId;

        if (action === 'set-default') {
          await this.setDefault(driveId, uid);
        }
        if (action === 'remove') {
          await this.removeDrive(driveId, uid);
        }
        if (action === 'refresh') {
          const drive = this._drives.find(d => d.id === driveId);
          if (drive?.accessToken) {
            window.VaultUtils.showToast('Refreshing storage info...', 'info');
            await this._fetchStorageInfo(driveId, uid, drive.accessToken);
            this._renderDrivesPage();
            this._updateDriveStatusBar();
          } else {
            window.VaultUtils.showToast(
              'Please re-connect this drive to refresh', 'info'
            );
          }
        }
      });
    });
  },

  // ==========================================
  // GET FILE TYPE ICON
  // ==========================================
  getFileIcon(mimeType = '', filename = '') {
    const ext = filename.split('.').pop().toLowerCase();

    const mimeMap = {
      'application/pdf':
        { icon: 'fa-file-pdf', cls: 'pdf', label: 'PDF' },
      'application/msword':
        { icon: 'fa-file-word', cls: 'word', label: 'Word' },
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        { icon: 'fa-file-word', cls: 'word', label: 'Word' },
      'application/vnd.ms-excel':
        { icon: 'fa-file-excel', cls: 'excel', label: 'Excel' },
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        { icon: 'fa-file-excel', cls: 'excel', label: 'Excel' },
      'application/vnd.ms-powerpoint':
        { icon: 'fa-file-powerpoint', cls: 'ppt', label: 'PPT' },
      'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        { icon: 'fa-file-powerpoint', cls: 'ppt', label: 'PPT' },
      'text/plain':
        { icon: 'fa-file-alt', cls: 'txt', label: 'Text' },
      'application/vnd.google-apps.document':
        { icon: 'fa-file-word', cls: 'word', label: 'Google Doc' },
      'application/vnd.google-apps.spreadsheet':
        { icon: 'fa-file-excel', cls: 'excel', label: 'Google Sheet' },
      'application/vnd.google-apps.presentation':
        { icon: 'fa-file-powerpoint', cls: 'ppt', label: 'Google Slides' },
    };

    const extMap = {
      pdf:  { icon: 'fa-file-pdf',        cls: 'pdf',   label: 'PDF'   },
      doc:  { icon: 'fa-file-word',        cls: 'word',  label: 'Word'  },
      docx: { icon: 'fa-file-word',        cls: 'word',  label: 'Word'  },
      xls:  { icon: 'fa-file-excel',       cls: 'excel', label: 'Excel' },
      xlsx: { icon: 'fa-file-excel',       cls: 'excel', label: 'Excel' },
      ppt:  { icon: 'fa-file-powerpoint',  cls: 'ppt',   label: 'PPT'   },
      pptx: { icon: 'fa-file-powerpoint',  cls: 'ppt',   label: 'PPT'   },
      txt:  { icon: 'fa-file-alt',         cls: 'txt',   label: 'Text'  },
      png:  { icon: 'fa-file-image',       cls: 'img',   label: 'Image' },
      jpg:  { icon: 'fa-file-image',       cls: 'img',   label: 'Image' },
      jpeg: { icon: 'fa-file-image',       cls: 'img',   label: 'Image' },
      gif:  { icon: 'fa-file-image',       cls: 'img',   label: 'Image' },
      mp4:  { icon: 'fa-file-video',       cls: 'video', label: 'Video' },
      mp3:  { icon: 'fa-file-audio',       cls: 'audio', label: 'Audio' },
      zip:  { icon: 'fa-file-archive',     cls: 'zip',   label: 'ZIP'   },
    };

    return mimeMap[mimeType] ||
           extMap[ext]       ||
           { icon: 'fa-file', cls: 'drive', label: 'File' };
  },

  // Getters
  getDrives()       { return this._drives; },
  getDefaultDrive() { return this._defaultDrive; },
  hasDrives()       { return this._drives.length > 0; },
};