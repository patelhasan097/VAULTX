// ============================================
// VAULTX - drive.js v2.0
// Google Drive REST API v3 — pure fetch(), no gapi
// ============================================

import {
  auth, db, googleProvider,
  signInWithPopup, GoogleAuthProvider,
  doc, getDoc, updateDoc,
  userDocRef, VaultUtils
} from './config.js';

const DRIVE_API    = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME  = 'VaultX';
const FOLDER_MIME  = 'application/vnd.google-apps.folder';

// ============================================
// DRIVE MANAGER
// ============================================
export const DriveManager = {
  _token:    null,      // Access token (memory only — never localStorage)
  _tokenUid: null,      // UID the token belongs to
  _folderId: null,      // Cached folder ID
  _quota:    null,      // Cached quota info

  /** Store token after Google sign-in */
  setToken(accessToken, uid) {
    this._token    = accessToken;
    this._tokenUid = uid;
  },

  /** Re-authenticate to get a fresh Drive token */
  async _reauth() {
    try {
      const result     = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      this._token      = credential?.accessToken;
      this._tokenUid   = result.user.uid;
      return !!this._token;
    } catch {
      return false;
    }
  },

  /** Authenticated fetch to Drive API — auto-retries on 401 */
  async _fetch(url, opts = {}, retry = true) {
    if (!this._token) {
      const ok = await this._reauth();
      if (!ok) throw new Error('Drive not connected. Please sign in with Google.');
    }
    const headers = { 'Authorization': `Bearer ${this._token}`, ...(opts.headers || {}) };
    const res = await fetch(url, { ...opts, headers });

    if (res.status === 401 && retry) {
      const ok = await this._reauth();
      if (!ok) throw new Error('Google session expired. Please reconnect Drive.');
      return this._fetch(url, opts, false);
    }
    return res;
  },

  /** Connect Drive for email/password users */
  async connect(uid) {
    try {
      const result     = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      this._token    = credential?.accessToken;
      this._tokenUid = uid;

      const driveEmail = result.user.email;
      await updateDoc(userDocRef(uid), { driveConnected: true, driveEmail });
      VaultUtils.toast('Google Drive connected! ✅', 'success');

      // Update settings UI
      document.getElementById('drive-email-display')  && (document.getElementById('drive-email-display').textContent = driveEmail);
      document.getElementById('connect-drive-btn')    && (document.getElementById('connect-drive-btn').textContent = 'Connected');
      return true;
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user') {
        VaultUtils.toast('Failed to connect Drive', 'error');
      }
      return false;
    }
  },

  /** Get or create the VaultX folder in Drive */
  async getOrCreateFolder(uid) {
    // Check local cache
    if (this._folderId) return this._folderId;

    // Check Firestore
    try {
      const snap = await getDoc(userDocRef(uid));
      if (snap.exists() && snap.data().driveFolderId) {
        this._folderId = snap.data().driveFolderId;
        return this._folderId;
      }
    } catch {}

    // Search in Drive
    const searchUrl = `${DRIVE_API}/files?q=${encodeURIComponent(
      `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`
    )}&fields=files(id,name)`;

    try {
      const searchRes  = await this._fetch(searchUrl);
      const searchData = await searchRes.json();
      if (searchData.files?.length) {
        this._folderId = searchData.files[0].id;
      } else {
        // Create new folder
        const createRes = await this._fetch(`${DRIVE_API}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME })
        });
        const data = await createRes.json();
        this._folderId = data.id;
      }

      // Persist in Firestore
      try { await updateDoc(userDocRef(uid), { driveFolderId: this._folderId }); } catch {}
      return this._folderId;
    } catch (e) {
      throw new Error(`Could not access Google Drive folder: ${e.message}`);
    }
  },

  /**
   * Upload a file to VaultX folder in Drive
   * Returns: { id, name, mimeType, size }
   */
  async uploadFile(file, uid, onProgress) {
    if (!file) throw new Error('No file selected');
    if (file.size > 150 * 1024 * 1024) throw new Error('File too large (max 150MB)');

    const folderId = await this.getOrCreateFolder(uid);

    const metadata = JSON.stringify({
      name:    file.name,
      parents: [folderId]
    });

    const body = new FormData();
    body.append('metadata', new Blob([metadata], { type: 'application/json' }));
    body.append('file', file);

    // Use multipart upload (simple, works for files up to 5MB well)
    // For larger files we could use resumable — multipart is fine for typical docs
    onProgress?.(10);

    const res = await this._fetch(
      `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType,size`,
      { method: 'POST', body }
    );

    onProgress?.(90);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Upload failed');
    }

    const data = await res.json();
    onProgress?.(100);

    // Set file permissions to "anyone with link can view" for easy opening
    try {
      await this._fetch(`${DRIVE_API}/files/${data.id}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' })
      });
    } catch {} // non-critical

    return {
      id:       data.id,
      name:     data.name,
      mimeType: data.mimeType,
      size:     parseInt(data.size || 0, 10)
    };
  },

  /** Delete a file from Drive */
  async deleteFile(fileId) {
    if (!fileId) return;
    try {
      await this._fetch(`${DRIVE_API}/files/${fileId}`, { method: 'DELETE' });
    } catch (e) {
      console.warn('[Drive] Delete failed:', e);
    }
  },

  /** Get web view link (opens in Drive) */
  getViewURL(fileId) {
    return `https://drive.google.com/file/d/${fileId}/view`;
  },

  /** Get direct download link */
  getDownloadURL(fileId) {
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  },

  /** Get thumbnail URL for images/PDFs */
  getThumbnailURL(fileId, size = 400) {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
  },

  /** Get storage quota */
  async getQuota() {
    if (this._quota) return this._quota;
    try {
      const res  = await this._fetch(`${DRIVE_API}/about?fields=storageQuota`);
      const data = await res.json();
      this._quota = data.storageQuota;
      return this._quota;
    } catch {
      return null;
    }
  },

  /** Check if Drive is connected for a user */
  async isConnected(uid) {
    try {
      const snap = await getDoc(userDocRef(uid));
      return snap.exists() && snap.data().driveConnected === true;
    } catch { return false; }
  }
};

// Make globally accessible
window.DriveManager = DriveManager;
