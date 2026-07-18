// ============================================
// VAULTX - FIREBASE CONFIG
// ============================================

import { initializeApp }              from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { getAuth,
         GoogleAuthProvider,
         signInWithEmailAndPassword,
         createUserWithEmailAndPassword,
         signInWithPopup,
         signInWithRedirect,
         getRedirectResult,
         signOut,
         onAuthStateChanged,
         updateProfile,
         sendPasswordResetEmail,
         deleteUser }                  from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { getFirestore,
         enableIndexedDbPersistence,
         collection,
         doc,
         addDoc,
         getDoc,
         getDocs,
         setDoc,
         updateDoc,
         deleteDoc,
         query,
         where,
         orderBy,
         limit,
         onSnapshot,
         serverTimestamp,
         writeBatch }                  from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

// ============================================
// ⚠️  REPLACE WITH YOUR FIREBASE CONFIG
// Firebase Console → Project Settings →
// Your Apps → Web App → SDK Setup & Config
// ============================================
const firebaseConfig = {
  apiKey: "AIzaSyDmQJZk_PrV3ViD0Lo9vWQqsgGn1TimPyc",
  authDomain: "vaultx-199f5.firebaseapp.com",
  projectId: "vaultx-199f5",
  storageBucket: "vaultx-199f5.firebasestorage.app",
  messagingSenderId: "74209623401",
  appId: "1:74209623401:web:2e228f2a4876d5e91d91f8"
};

// ============================================
// INITIALIZE
// ============================================
let app, auth, db, googleProvider;

try {
  app            = initializeApp(firebaseConfig);
  auth           = getAuth(app);
  db             = getFirestore(app);
  googleProvider = new GoogleAuthProvider();

  // Request extra scopes for Google Drive
  googleProvider.addScope('https://www.googleapis.com/auth/drive.file');
  googleProvider.addScope('https://www.googleapis.com/auth/drive.metadata.readonly');
  googleProvider.addScope('profile');
  googleProvider.addScope('email');

  // Force account selection every time
  googleProvider.setCustomParameters({
    prompt: 'select_account'
  });

  console.log('[VaultX] Firebase initialized ✅');
} catch (err) {
  console.error('[VaultX] Firebase init failed:', err);
}

// ============================================
// ENABLE OFFLINE PERSISTENCE
// ============================================
enableIndexedDbPersistence(db, { synchronizeTabs: false })
  .then(() => console.log('[VaultX] Offline persistence enabled ✅'))
  .catch(err => {
    if (err.code === 'failed-precondition') {
      console.warn('[VaultX] Multiple tabs — persistence in first tab only');
    } else if (err.code === 'unimplemented') {
      console.warn('[VaultX] Browser does not support offline persistence');
    }
  });

// ============================================
// FIRESTORE HELPERS
// ============================================

/**
 * Get user's items collection ref
 */
function itemsCol(uid) {
  return collection(db, 'users', uid, 'items');
}

/**
 * Get user's drives collection ref
 */
function drivesCol(uid) {
  return collection(db, 'users', uid, 'drives');
}

/**
 * Get user doc ref
 */
function userDoc(uid) {
  return doc(db, 'users', uid);
}

// ============================================
// EXPORT EVERYTHING
// ============================================
export {
  // Firebase instances
  app, auth, db, googleProvider,

  // Auth functions
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  deleteUser,

  // Firestore functions
  collection, doc,
  addDoc, getDoc, getDocs,
  setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit,
  onSnapshot, serverTimestamp, writeBatch,

  // Helper refs
  itemsCol, drivesCol, userDoc
};