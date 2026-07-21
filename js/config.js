// ============================================
// VAULTX - config.js v2.0
// Firebase · VaultUtils · Boot sequence
// Loads first — no dependencies
// ============================================

import { initializeApp }                         from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider,
         signInWithEmailAndPassword,
         createUserWithEmailAndPassword,
         signInWithPopup,
         signOut, onAuthStateChanged,
         updateProfile, sendPasswordResetEmail,
         deleteUser }                             from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { initializeFirestore,
         persistentLocalCache,
         singleTabManager,
         collection, doc,
         addDoc, getDoc, getDocs, setDoc,
         updateDoc, deleteDoc,
         query, where, orderBy, limit,
         onSnapshot, serverTimestamp,
         writeBatch, getCountFromServer }         from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ============================================
// FIREBASE CONFIG — replace with yours later
// ============================================
const firebaseConfig = {
  apiKey:            "AIzaSyDmQJZk_PrV3ViD0Lo9vWQqsgGn1TimPyc",
  authDomain:        "vaultx-199f5.firebaseapp.com",
  projectId:         "vaultx-199f5",
  storageBucket:     "vaultx-199f5.firebasestorage.app",
  messagingSenderId: "74209623401",
  appId:             "1:74209623401:web:2e228f2a4876d5e91d91f8"
};

// ============================================
// INITIALIZE
// ============================================
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Modern offline persistence (replaces deprecated enableIndexedDbPersistence)
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: singleTabManager() })
});

const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');
googleProvider.addScope('profile');
googleProvider.addScope('email');
googleProvider.setCustomParameters({ prompt: 'select_account' });

// ============================================
// FIRESTORE HELPERS
// ============================================
const itemsRef  = (uid) => collection(db, 'users', uid, 'items');
const userDocRef = (uid) => doc(db, 'users', uid);

// ============================================
// VAULT UTILS — available immediately to all modules
// ============================================
const VaultUtils = {

  /** Show toast notification */
  toast(message, type = 'info', duration = 3200) {
    const wrap = document.getElementById('toast-wrap');
    if (!wrap) return;
    const icons = { success:'fa-circle-check', error:'fa-circle-xmark', info:'fa-circle-info', warning:'fa-triangle-exclamation' };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
    wrap.appendChild(t);
    setTimeout(() => {
      t.classList.add('hiding');
      t.addEventListener('animationend', () => t.remove(), { once: true });
    }, duration);
  },

  /** Format bytes to human readable */
  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024, sizes = ['B','KB','MB','GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k,i)).toFixed(1))} ${sizes[i]}`;
  },

  /** Format Firestore timestamp or Date to relative or absolute */
  formatDate(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60)    return 'Just now';
    if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    if (diff < 604800)return `${Math.floor(diff/86400)}d ago`;
    return d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
  },

  /** Detect URL type */
  detectURL(str) {
    str = str.trim();
    try { new URL(str); } catch { return null; }
    const ytPatterns = [
      /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of ytPatterns) { const m = str.match(p); if (m) return { type:'youtube', id: m[1] }; }
    return { type:'link', url: str };
  },

  /** Get domain from URL */
  getDomain(url) {
    try { return new URL(url).hostname.replace('www.',''); }
    catch { return url; }
  },

  /** Truncate string */
  trunc(str, max = 80) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '…' : str;
  },

  /** SHA-256 hash (for PIN) */
  async sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  },

  /** Get MIME type icon class and color */
  fileIcon(mimeType = '') {
    if (mimeType.includes('pdf'))        return { icon:'fa-file-pdf',   color:'#FF4444', grad:'var(--grad-danger)' };
    if (mimeType.includes('image'))      return { icon:'fa-file-image', color:'#00D4FF', grad:'var(--grad-blue)' };
    if (mimeType.includes('video'))      return { icon:'fa-file-video', color:'#FF6B6B', grad:'var(--grad-orange)' };
    if (mimeType.includes('audio'))      return { icon:'fa-file-audio', color:'#A855F7', grad:'var(--grad-purple)' };
    if (mimeType.includes('word') || mimeType.includes('document'))
                                          return { icon:'fa-file-word',  color:'#2563EB', grad:'var(--grad-blue)' };
    if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv'))
                                          return { icon:'fa-file-excel', color:'#16A34A', grad:'var(--grad-teal)' };
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint'))
                                          return { icon:'fa-file-powerpoint', color:'#EA580C', grad:'var(--grad-orange)' };
    if (mimeType.includes('text'))       return { icon:'fa-file-lines', color:'#6C63FF', grad:'var(--grad-primary)' };
    if (mimeType.includes('zip') || mimeType.includes('archive'))
                                          return { icon:'fa-file-zipper',color:'#F7971E', grad:'var(--grad-warn)' };
    return { icon:'fa-file', color:'#38ef7d', grad:'var(--grad-success)' };
  },

  /** Show/hide a modal */
  openModal(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
  },
  closeModal(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); document.body.style.overflow = ''; }
  },
  closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
    document.body.style.overflow = '';
  }
};

// ============================================
// SERVICE WORKER REGISTRATION
// ============================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/vaultx/sw.js', { scope: '/vaultx/' })
      .then(reg => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) {
              VaultUtils.toast('Update available — reload to apply', 'info', 6000);
            }
          });
        });
      })
      .catch(err => console.warn('[VaultX] SW registration failed:', err));
  });

  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'SYNC_NOW') {
      window.AppManager?.syncOfflineQueue?.();
    }
  });
}

// ============================================
// ONLINE / OFFLINE DETECTION
// ============================================
const offlineBanner = document.getElementById('offline-banner');
window.addEventListener('offline', () => {
  offlineBanner?.classList.remove('hidden');
});
window.addEventListener('online', () => {
  offlineBanner?.classList.add('hidden');
  VaultUtils.toast('Back online', 'success');
  if (!navigator.onLine === false) {
    navigator.serviceWorker?.ready.then(reg => reg.sync?.register('vaultx-sync').catch(()=>{}));
  }
});
if (!navigator.onLine) offlineBanner?.classList.remove('hidden');

// ============================================
// MODAL CLOSE HELPERS (global)
// ============================================
document.addEventListener('click', e => {
  // Close modal on backdrop click
  if (e.target.classList.contains('modal-backdrop')) {
    VaultUtils.closeAllModals();
  }
  // Close on modal-close buttons
  const closeBtn = e.target.closest('[data-modal]');
  if (closeBtn) {
    VaultUtils.closeModal(closeBtn.dataset.modal);
  }
});

// ============================================
// PWA INSTALL PROMPT
// ============================================
let _deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredPrompt = e;
  setTimeout(() => {
    if (_deferredPrompt) {
      VaultUtils.toast('Install VaultX as an app 📱', 'info', 8000);
    }
  }, 15000);
});
window.addEventListener('appinstalled', () => {
  VaultUtils.toast('VaultX installed! 🎉', 'success');
  _deferredPrompt = null;
});

// ============================================
// BOOT SEQUENCE
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[VaultX] Booting v2.0...');

  // Import modules in order (config → auth → drive → app)
  let AuthManager, ScreenManager, OnboardManager, PinManager, BiometricManager;
  try {
    const authMod        = await import('./auth.js');
    AuthManager          = authMod.AuthManager;
    ScreenManager        = authMod.ScreenManager;
    OnboardManager       = authMod.OnboardManager;
    PinManager           = authMod.PinManager;
    BiometricManager     = authMod.BiometricManager;
    const AutoLockManager= authMod.AutoLockManager;

    // Make globally accessible (order matters — VaultUtils first)
    window.VaultUtils      = VaultUtils;
    window.AuthManager     = AuthManager;
    window.ScreenManager   = ScreenManager;
    window.OnboardManager  = OnboardManager;
    window.PinManager      = PinManager;
    window.BiometricManager= BiometricManager;
    window.AutoLockManager = AutoLockManager;

    // Init auth listener
    AuthManager.init();

    // Load app and drive modules
    await import('./app.js');

    console.log('[VaultX] Modules loaded ✅');
  } catch (err) {
    console.error('[VaultX] Module load error:', err);
    _showLoadError(err.message);
    return;
  }

  // Minimum splash duration (branding)
  await _wait(2200);

  // Wait for Firebase auth to settle
  await new Promise(resolve => AuthManager.onReady(resolve));

  // Hide splash
  const splash = document.getElementById('splash-screen');
  if (splash) {
    splash.style.opacity = '0';
    splash.style.transition = 'opacity .4s ease';
    await _wait(420);
    splash.classList.add('hidden');
  }

  // Apply saved theme
  if (localStorage.getItem('vaultx_theme') === 'light') {
    document.body.classList.add('light');
  }

  // Decide starting screen
  const user        = AuthManager.currentUser;
  const onboarded   = localStorage.getItem('vaultx_onboarded');
  const hasPin      = localStorage.getItem('vaultx_pin');

  // Handle share target (URL passed via Web Share Target)
  const urlParams = new URLSearchParams(window.location.search);
  const sharedUrl = urlParams.get('url') || urlParams.get('text') || urlParams.get('title');

  if (!user) {
    ScreenManager.show('auth-screen');
  } else if (!onboarded || !hasPin) {
    ScreenManager.show('onboarding-screen');
    OnboardManager.start(user);
  } else {
    ScreenManager.show('pin-screen');
    PinManager.startVerify(user, sharedUrl || null);
  }

  console.log('[VaultX] Boot complete ✅');
});

function _wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function _showLoadError(msg) {
  const splash = document.getElementById('splash-screen');
  if (splash) {
    splash.innerHTML = `
      <div style="padding:40px;text-align:center;color:var(--t1)">
        <i class="fas fa-triangle-exclamation" style="font-size:48px;color:var(--danger);display:block;margin-bottom:20px"></i>
        <h2 style="margin-bottom:10px">Failed to load</h2>
        <p style="color:var(--t3);margin-bottom:24px;font-size:14px">${msg || 'Check your internet connection and try again.'}</p>
        <button onclick="location.reload()"
          style="padding:12px 32px;background:var(--grad-primary);border:none;border-radius:50px;
                 color:#fff;font-size:15px;font-weight:600;cursor:pointer">
          Reload
        </button>
      </div>`;
  }
}

// ============================================
// EXPORTS
// ============================================
export {
  auth, db, googleProvider, app,
  // Firebase auth
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, signOut, onAuthStateChanged,
  updateProfile, sendPasswordResetEmail, deleteUser,
  GoogleAuthProvider,
  // Firestore
  collection, doc, addDoc, getDoc, getDocs, setDoc,
  updateDoc, deleteDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, writeBatch, getCountFromServer,
  // Helpers
  itemsRef, userDocRef,
  // Utils
  VaultUtils
};