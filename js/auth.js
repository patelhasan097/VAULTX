// ============================================
// VAULTX - auth.js v2.0
// Auth · Screens · Onboarding · PIN · Biometric
// ============================================

import {
  auth, db, googleProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, signOut, onAuthStateChanged,
  updateProfile, sendPasswordResetEmail, deleteUser,
  GoogleAuthProvider,
  doc, setDoc, getDoc, updateDoc, serverTimestamp,
  userDocRef, VaultUtils
} from './config.js';

// ============================================
// SCREEN MANAGER
// ============================================
export const ScreenManager = {
  _current: null,

  show(screenId) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const el = document.getElementById(screenId);
    if (el) {
      el.classList.remove('hidden');
      this._current = screenId;
    }
  },

  current() { return this._current; }
};

// ============================================
// AUTH MANAGER
// ============================================
export const AuthManager = {
  currentUser: null,
  _readyCallbacks: [],
  _isReady: false,
  _unsubscribe: null,

  init() {
    this._unsubscribe = onAuthStateChanged(auth, async user => {
      this.currentUser = user;
      this._isReady = true;
      this._readyCallbacks.forEach(cb => cb(user));
      this._readyCallbacks = [];

      // Sync user profile to Firestore on sign-in
      if (user) {
        try {
          const ref = userDocRef(user.uid);
          const snap = await getDoc(ref);
          if (!snap.exists()) {
            await setDoc(ref, {
              name:       user.displayName || 'VaultX User',
              photoURL:   user.photoURL || null,
              email:      user.email,
              theme:      'dark',
              pinHash:    null,
              bioEnabled: false,
              autolockMins: 5,
              driveConnected: false,
              driveFolderId:  null,
              createdAt:  serverTimestamp()
            });
          }
        } catch (e) { /* offline — ok */ }
      }

      // Notify app manager
      if (window.AppManager) {
        if (user) window.AppManager.onUserSignedIn(user);
        else      window.AppManager.onUserSignedOut();
      }
    });
  },

  onReady(cb) {
    if (this._isReady) cb(this.currentUser);
    else this._readyCallbacks.push(cb);
  },

  async login(email, password) {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  },

  async register(name, email, password) {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName: name });
    return result.user;
  },

  async googleSignIn() {
    const result = await signInWithPopup(auth, googleProvider);
    // Capture access token for Drive (correct API — not private property)
    const credential  = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken;
    if (accessToken && window.DriveManager) {
      window.DriveManager.setToken(accessToken, result.user.uid);
    }
    return { user: result.user, accessToken };
  },

  async signOut() {
    window.AutoLockManager?.destroy();
    localStorage.removeItem('vaultx_onboarded');
    localStorage.removeItem('vaultx_pin');
    window.AppManager?.teardown();
    await signOut(auth);
  },

  async resetPassword(email) {
    await sendPasswordResetEmail(auth, email);
  },

  async deleteAccount() {
    const user = auth.currentUser;
    if (!user) return;
    window.AppManager?.teardown();
    await deleteUser(user);
  }
};

// ============================================
// AUTH UI SETUP
// ============================================
(function setupAuthUI() {
  // Tab switching
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      tab.classList.add('active');
      const formId = tab.dataset.tab === 'login' ? 'form-login' : 'form-register';
      document.getElementById(formId)?.classList.add('active');
      document.getElementById('auth-msg')?.classList.add('hidden');
    });
  });

  // Password visibility toggles
  document.querySelectorAll('.eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.for);
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      btn.querySelector('i').className = `fas fa-eye${inp.type === 'password' ? '' : '-slash'}`;
    });
  });

  // Login
  document.getElementById('login-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('login-email')?.value.trim();
    const pass  = document.getElementById('login-password')?.value;
    if (!email || !pass) { _authMsg('Please fill in all fields', 'error'); return; }
    _setAuthLoading(true, 'login-btn');
    try {
      await AuthManager.login(email, pass);
      // onAuthStateChanged handles routing
    } catch (e) {
      _authMsg(_parseAuthError(e.code), 'error');
    } finally { _setAuthLoading(false, 'login-btn'); }
  });

  // Register
  document.getElementById('register-btn')?.addEventListener('click', async () => {
    const name  = document.getElementById('reg-name')?.value.trim();
    const email = document.getElementById('reg-email')?.value.trim();
    const pass  = document.getElementById('reg-password')?.value;
    if (!name || !email || !pass) { _authMsg('Please fill in all fields', 'error'); return; }
    if (pass.length < 6) { _authMsg('Password must be at least 6 characters', 'error'); return; }
    _setAuthLoading(true, 'register-btn');
    try {
      await AuthManager.register(name, email, pass);
    } catch (e) {
      _authMsg(_parseAuthError(e.code), 'error');
    } finally { _setAuthLoading(false, 'register-btn'); }
  });

  // Google Sign-In (both buttons)
  ['google-signin-btn','google-register-btn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', async () => {
      try {
        await AuthManager.googleSignIn();
      } catch (e) {
        if (e.code !== 'auth/popup-closed-by-user') {
          _authMsg(_parseAuthError(e.code), 'error');
        }
      }
    });
  });

  // Forgot password
  document.getElementById('forgot-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('login-email')?.value.trim();
    if (!email) { _authMsg('Enter your email address first', 'error'); return; }
    try {
      await AuthManager.resetPassword(email);
      _authMsg('Reset email sent! Check your inbox.', 'success');
    } catch (e) {
      _authMsg(_parseAuthError(e.code), 'error');
    }
  });

  // Enter key on inputs
  ['login-email','login-password'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('login-btn')?.click();
    });
  });
  ['reg-name','reg-email','reg-password'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('register-btn')?.click();
    });
  });
})();

function _authMsg(msg, type = 'error') {
  const el = document.getElementById('auth-msg');
  if (!el) return;
  el.textContent = msg;
  el.className = `auth-msg ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

function _setAuthLoading(loading, btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<div class="spinner" style="width:18px;height:18px;border-width:2px;border-top-color:#fff"></div>'
    : (btnId === 'login-btn' ? 'Sign in' : 'Create account');
}

function _parseAuthError(code) {
  const map = {
    'auth/invalid-email':          'Invalid email address.',
    'auth/user-not-found':         'No account found with this email.',
    'auth/wrong-password':         'Incorrect password.',
    'auth/invalid-credential':     'Invalid email or password.',
    'auth/email-already-in-use':   'An account already exists with this email.',
    'auth/weak-password':          'Password is too weak.',
    'auth/too-many-requests':      'Too many attempts. Try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/user-disabled':          'This account has been disabled.',
    'auth/popup-blocked':          'Popup blocked. Allow popups for this site.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

// ============================================
// ONBOARD MANAGER
// ============================================
export const OnboardManager = {
  _user: null,
  _step: 0,
  _newPin: null,
  _pinStep: 'set',  // 'set' | 'confirm'

  start(user) {
    this._user = user;
    this._step = 0;
    this._newPin = null;
    this._pinStep = 'set';
    this._showStep(0);
    this._setupObPinPad();
    this._setupBioBtn();
  },

  _showStep(n) {
    this._step = n;
    document.querySelectorAll('.ob-step').forEach((s, i) => {
      s.classList.toggle('active', i === n);
    });
    document.querySelectorAll('.ob-dot').forEach((d, i) => {
      d.classList.toggle('active', i === n);
      d.classList.toggle('done', i < n);
    });
    const nextBtn = document.getElementById('ob-next-btn');
    const skipBtn = document.getElementById('ob-skip-btn');
    if (!nextBtn || !skipBtn) return;

    if (n === 0) { nextBtn.textContent = 'Get started'; skipBtn.classList.add('hidden'); }
    else if (n === 1) { nextBtn.textContent = 'Next'; nextBtn.disabled = true; skipBtn.classList.remove('hidden'); skipBtn.textContent = 'Back'; }
    else if (n === 2) { nextBtn.textContent = 'Finish'; skipBtn.classList.remove('hidden'); skipBtn.textContent = 'Skip'; }
  },

  _setupObPinPad() {
    let pin = '';
    const dotsEl  = document.getElementById('ob-pin-dots');
    const hintEl  = document.getElementById('ob-pin-hint');
    const nextBtn = document.getElementById('ob-next-btn');

    const updateDots = () => {
      dotsEl?.querySelectorAll('.pin-dot').forEach((d,i) => {
        d.classList.toggle('filled', i < pin.length);
      });
    };

    document.getElementById('ob-pin-pad')?.addEventListener('click', async e => {
      const btn = e.target.closest('.pin-key');
      if (!btn || this._step !== 1) return;

      const digit = btn.dataset.digit;
      if (digit === 'back') { pin = pin.slice(0, -1); updateDots(); return; }
      if (pin.length >= 4) return;

      pin += digit;
      updateDots();

      if (pin.length === 4) {
        if (this._pinStep === 'set') {
          this._newPin = pin;
          pin = '';
          this._pinStep = 'confirm';
          hintEl && (hintEl.textContent = 'Confirm your PIN');
          updateDots();
        } else {
          // Confirm step
          if (pin === this._newPin) {
            // Save PIN hash
            const hash = await VaultUtils.sha256(pin);
            localStorage.setItem('vaultx_pin', hash);
            // Save to Firestore too
            try { await updateDoc(userDocRef(this._user.uid), { pinHash: hash }); } catch {}
            hintEl && (hintEl.textContent = '✅ PIN set successfully!');
            if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = 'Continue'; }
          } else {
            // Mismatch
            pin = ''; this._newPin = null; this._pinStep = 'set';
            hintEl && (hintEl.textContent = "PINs didn't match. Try again.");
            dotsEl?.classList.add('shake');
            updateDots();
            setTimeout(() => dotsEl?.classList.remove('shake'), 500);
          }
        }
      }
    });
  },

  _setupBioBtn() {
    document.getElementById('ob-bio-btn')?.addEventListener('click', async () => {
      if (!this._user) return;
      const ring   = document.getElementById('ob-bio-btn');
      const status = document.getElementById('ob-bio-status');
      ring?.classList.add('scanning');
      status && (status.textContent = 'Registering biometric...');
      const ok = await BiometricManager.register(this._user.uid);
      ring?.classList.remove('scanning');
      if (ok) {
        ring?.classList.add('success');
        status && (status.textContent = '✅ Biometric enabled!');
        VaultUtils.toast('Biometric enabled', 'success');
        try { await updateDoc(userDocRef(this._user.uid), { bioEnabled: true }); } catch {}
        localStorage.setItem('vaultx_bio', '1');
      } else {
        status && (status.textContent = 'Biometric not available on this device.');
      }
    });
  },

  async finish() {
    localStorage.setItem('vaultx_onboarded', '1');
    try { await updateDoc(userDocRef(this._user?.uid), { theme:'dark' }); } catch {}
    VaultUtils.toast(`Welcome to VaultX, ${this._user?.displayName?.split(' ')[0] || 'there'}! 🚀`, 'success');
    ScreenManager.show('app-screen');
    window.AppManager?.launch(this._user);
  }
};

// Onboarding nav buttons
document.getElementById('ob-next-btn')?.addEventListener('click', () => {
  const step = OnboardManager._step;
  if (step === 0) OnboardManager._showStep(1);
  else if (step === 1) {
    if (!localStorage.getItem('vaultx_pin')) {
      VaultUtils.toast('Please set your PIN first', 'warning');
      return;
    }
    OnboardManager._showStep(2);
  }
  else if (step === 2) OnboardManager.finish();
});

document.getElementById('ob-skip-btn')?.addEventListener('click', () => {
  const step = OnboardManager._step;
  if (step === 1) OnboardManager._showStep(0);
  else if (step === 2) OnboardManager.finish();
});

// ============================================
// PIN MANAGER
// ============================================
export const PinManager = {
  _user: null,
  _pendingSharedUrl: null,
  _currentPin: '',

  startVerify(user, sharedUrl = null) {
    this._user = user;
    this._pendingSharedUrl = sharedUrl;
    this._currentPin = '';
    this._updateUI();
    this._setupPad('main-pin-pad', this._handleVerifyDigit.bind(this));
    this._setupBioUnlock();

    // Update avatar
    if (user.photoURL) {
      const img  = document.getElementById('pin-avatar-img');
      const icon = document.getElementById('pin-avatar-icon');
      if (img)  { img.src = user.photoURL; img.style.display = 'block'; }
      if (icon) icon.style.display = 'none';
    }
    document.getElementById('pin-name')?.textContent &&
      (document.getElementById('pin-name').textContent = user.displayName?.split(' ')[0] || 'Welcome back');

    // Clone signout btn to clear stale listeners from previous startVerify calls
    const soBtn = document.getElementById('pin-signout-btn');
    if (soBtn) {
      const newSo = soBtn.cloneNode(true);
      soBtn.parentNode?.replaceChild(newSo, soBtn);
      newSo.addEventListener('click', async () => {
        if (confirm('Sign out of VaultX?')) await AuthManager.signOut();
      });
    }
  },

  _updateUI() {
    this._currentPin = '';
    this._updateDots('pin-verify-dots', 0);
    document.getElementById('pin-error-msg')?.classList.add('hidden');
  },

  _updateDots(dotsId, count, error = false) {
    const dotsEl = document.getElementById(dotsId);
    if (!dotsEl) return;
    dotsEl.querySelectorAll('.pin-dot').forEach((d, i) => {
      d.classList.remove('filled','error');
      if (i < count) d.classList.add(error ? 'error' : 'filled');
    });
  },

  _setupPad(padId, handler) {
    const pad = document.getElementById(padId);
    if (!pad) return;
    // Remove old listeners by cloning
    const newPad = pad.cloneNode(true);
    pad.parentNode.replaceChild(newPad, pad);
    newPad.addEventListener('click', e => {
      const btn = e.target.closest('.pin-key');
      if (!btn) return;
      handler(btn.dataset.digit, newPad.id);
    });
  },

  async _handleVerifyDigit(digit, padId) {
    if (digit === 'back') {
      this._currentPin = this._currentPin.slice(0,-1);
      this._updateDots('pin-verify-dots', this._currentPin.length);
      return;
    }
    if (this._currentPin.length >= 4) return;
    this._currentPin += digit;
    this._updateDots('pin-verify-dots', this._currentPin.length);

    if (this._currentPin.length === 4) {
      const hash    = await VaultUtils.sha256(this._currentPin);
      const stored  = localStorage.getItem('vaultx_pin');
      if (hash === stored) {
        // Correct
        ScreenManager.show('app-screen');
        window.AppManager?.launch(this._user, this._pendingSharedUrl);
        window.AutoLockManager?.init(this._user);
      } else {
        // Wrong
        this._updateDots('pin-verify-dots', 4, true);
        const dotsEl = document.getElementById('pin-verify-dots');
        dotsEl?.classList.add('shake');
        const errEl  = document.getElementById('pin-error-msg');
        if (errEl) { errEl.classList.remove('hidden'); errEl.textContent = 'Incorrect PIN. Try again.'; }
        setTimeout(() => {
          dotsEl?.classList.remove('shake');
          this._currentPin = '';
          this._updateDots('pin-verify-dots', 0);
          errEl?.classList.add('hidden');
        }, 900);
      }
    }
  },

  _setupBioUnlock() {
    const bioBtn = document.getElementById('bio-unlock-btn');
    if (!bioBtn) return;

    if (!localStorage.getItem('vaultx_bio')) {
      bioBtn.classList.add('hidden');
      return;
    }
    bioBtn.classList.remove('hidden');

    // Clone to remove any stale listeners from previous PIN screen shows
    const newBtn = bioBtn.cloneNode(true);
    bioBtn.parentNode?.replaceChild(newBtn, bioBtn);

    newBtn.addEventListener('click', async () => {
      const ok = await BiometricManager.authenticate(this._user?.uid);
      if (ok) {
        ScreenManager.show('app-screen');
        window.AppManager?.launch(this._user, this._pendingSharedUrl);
        window.AutoLockManager?.init(this._user);
      } else {
        VaultUtils.toast('Biometric failed — use PIN', 'warning');
      }
      // No { once: true } — user can retry biometric if it fails
    });

    // Auto-trigger on screen load
    setTimeout(() => newBtn.click(), 700);
  },

  // For settings: change PIN flow
  startChange() {
    VaultUtils.openModal('change-pin-modal');
    let pin = '', step = 'old', newPin = '';

    document.getElementById('change-pin-hint').textContent = 'Enter current PIN';
    this._updateDots('change-pin-dots', 0);

    this._setupPad('change-pin-pad', async (digit) => {
      if (digit === 'back') { pin = pin.slice(0,-1); this._updateDots('change-pin-dots', pin.length); return; }
      if (pin.length >= 4) return;
      pin += digit;
      this._updateDots('change-pin-dots', pin.length);

      if (pin.length === 4) {
        if (step === 'old') {
          const hash   = await VaultUtils.sha256(pin);
          const stored = localStorage.getItem('vaultx_pin');
          if (hash === stored) {
            pin = ''; step = 'new';
            document.getElementById('change-pin-hint').textContent = 'Enter new PIN';
            this._updateDots('change-pin-dots', 0);
          } else {
            this._updateDots('change-pin-dots', 4, true);
            document.getElementById('change-pin-dots').classList.add('shake');
            setTimeout(() => { document.getElementById('change-pin-dots').classList.remove('shake'); pin = ''; this._updateDots('change-pin-dots',0); }, 900);
          }
        } else if (step === 'new') {
          newPin = pin; pin = ''; step = 'confirm';
          document.getElementById('change-pin-hint').textContent = 'Confirm new PIN';
          this._updateDots('change-pin-dots', 0);
        } else {
          if (pin === newPin) {
            const hash = await VaultUtils.sha256(pin);
            localStorage.setItem('vaultx_pin', hash);
            try { await updateDoc(userDocRef(AuthManager.currentUser.uid), { pinHash: hash }); } catch {}
            VaultUtils.closeModal('change-pin-modal');
            VaultUtils.toast('PIN changed successfully', 'success');
          } else {
            this._updateDots('change-pin-dots', 4, true);
            document.getElementById('change-pin-dots').classList.add('shake');
            setTimeout(() => {
              document.getElementById('change-pin-dots').classList.remove('shake');
              pin = ''; newPin = ''; step = 'new';
              document.getElementById('change-pin-hint').textContent = 'Enter new PIN';
              this._updateDots('change-pin-dots', 0);
            }, 900);
          }
        }
      }
    });
  }
};

// ============================================
// BIOMETRIC MANAGER (WebAuthn)
// ============================================
export const BiometricManager = {
  _credKey: 'vaultx_bio_cred',

  isSupported() {
    return !!(window.PublicKeyCredential &&
              navigator.credentials?.create &&
              navigator.credentials?.get);
  },

  async register(userId) {
    if (!this.isSupported()) return false;
    try {
      const challenge  = crypto.getRandomValues(new Uint8Array(32));
      const userIdBuf  = new TextEncoder().encode(userId);
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp:   { name: 'VaultX', id: location.hostname },
          user: { id: userIdBuf, name: userId, displayName: 'VaultX User' },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required'
          },
          timeout: 60000,
          attestation: 'none'
        }
      });
      if (credential) {
        // Store credential ID
        localStorage.setItem(this._credKey, btoa(String.fromCharCode(...new Uint8Array(credential.rawId))));
        localStorage.setItem('vaultx_bio', '1');
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[VaultX] Biometric register failed:', e);
      return false;
    }
  },

  async authenticate(userId) {
    if (!this.isSupported()) return false;
    const storedId = localStorage.getItem(this._credKey);
    if (!storedId) return false;
    try {
      const credId = Uint8Array.from(atob(storedId), c => c.charCodeAt(0));
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: location.hostname,
          allowCredentials: [{ id: credId, type: 'public-key' }],
          userVerification: 'required',
          timeout: 60000
        }
      });
      return !!assertion;
    } catch (e) {
      console.warn('[VaultX] Biometric authenticate failed:', e);
      return false;
    }
  },

  disable() {
    localStorage.removeItem(this._credKey);
    localStorage.removeItem('vaultx_bio');
  }
};

// ============================================
// AUTO-LOCK MANAGER
// ============================================
export const AutoLockManager = {
  _timer: null,
  _user:  null,
  _hiddenAt: null,

  init(user) {
    this._user = user;
    this.destroy();

    document.addEventListener('visibilitychange', this._onVisibility.bind(this));
    this._resetTimer();
    ['touchstart','click','keydown'].forEach(ev => {
      document.addEventListener(ev, this._resetTimer.bind(this), { passive: true });
    });

    window.AutoLockManager = this;
  },

  _getMins() {
    return parseInt(localStorage.getItem('vaultx_autolock') || '5', 10);
  },

  _resetTimer() {
    clearTimeout(this._timer);
    const mins = this._getMins();
    if (!mins) return;
    this._timer = setTimeout(() => this._lock(), mins * 60 * 1000);
  },

  _onVisibility() {
    if (document.hidden) {
      this._hiddenAt = Date.now();
    } else {
      if (this._hiddenAt) {
        const secs = (Date.now() - this._hiddenAt) / 1000;
        const mins = this._getMins();
        if (mins && secs > mins * 60) this._lock();
        this._hiddenAt = null;
      }
    }
  },

  _lock() {
    if (ScreenManager.current() === 'app-screen' && this._user) {
      ScreenManager.show('pin-screen');
      PinManager.startVerify(this._user);
      window.AppManager?.teardown();
    }
  },

  destroy() {
    clearTimeout(this._timer);
    document.removeEventListener('visibilitychange', this._onVisibility);
    ['touchstart','click','keydown'].forEach(ev => {
      document.removeEventListener(ev, this._resetTimer);
    });
  }
};
