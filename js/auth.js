// ============================================
// VAULTX - AUTH MODULE
// Handles: Login, Register, Google Auth,
//          PIN setup/verify, Biometric,
//          Onboarding flow
// ============================================

import {
  auth, db, googleProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  doc, setDoc, getDoc, serverTimestamp
} from './firebase-config.js';

// ============================================
// UTILITY - Show Toast (global)
// ============================================
function toast(msg, type = 'info') {
  window.VaultUtils?.showToast(msg, type);
}

// ============================================
// AUTH STATE MANAGER
// ============================================
export const AuthManager = {

  currentUser: null,
  _authReady: false,
  _onReadyCallbacks: [],

  // ---- Init ----
  init() {
    this._watchAuthState();
    this._initTabSwitcher();
    this._initLoginForm();
    this._initRegisterForm();
    this._initEyeButtons();
    this._initForgotPassword();
  },

  // ---- Watch Firebase auth changes ----
  _watchAuthState() {
    onAuthStateChanged(auth, async (user) => {
      this.currentUser = user;
      this._authReady  = true;

      // Run all waiting callbacks
      this._onReadyCallbacks.forEach(cb => cb(user));
      this._onReadyCallbacks = [];
    });
  },

  // ---- Wait for auth to be ready ----
  onReady(callback) {
    if (this._authReady) {
      callback(this.currentUser);
    } else {
      this._onReadyCallbacks.push(callback);
    }
  },

  // ============================================
  // TAB SWITCHER (Login / Register)
  // ============================================
  _initTabSwitcher() {
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;

        // Update tabs
        document.querySelectorAll('.auth-tab').forEach(t =>
          t.classList.toggle('active', t.dataset.tab === target)
        );

        // Update forms
        document.querySelectorAll('.auth-form').forEach(f =>
          f.classList.toggle('active', f.id === `form-${target}`)
        );

        // Clear message
        this._clearMsg();
      });
    });
  },

  // ============================================
  // LOGIN FORM
  // ============================================
  _initLoginForm() {
    // Email/Password login
    const loginBtn = document.getElementById('login-btn');
    loginBtn?.addEventListener('click', () => this.handleLogin());

    // Enter key
    document.getElementById('login-password')
      ?.addEventListener('keydown', e => {
        if (e.key === 'Enter') this.handleLogin();
      });

    // Google Sign In
    document.getElementById('google-signin-btn')
      ?.addEventListener('click', () => this.handleGoogleAuth());
  },

  async handleLogin() {
    const email    = document.getElementById('login-email')?.value.trim();
    const password = document.getElementById('login-password')?.value;

    // Validate
    if (!email || !password) {
      this._showMsg('Please fill in all fields', 'error');
      return;
    }
    if (!this._isValidEmail(email)) {
      this._showMsg('Please enter a valid email address', 'error');
      return;
    }

    this._setLoading('login-btn', true);

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      this.currentUser = cred.user;
      await this._afterLogin(cred.user, false);
    } catch (err) {
      this._showMsg(this._firebaseError(err.code), 'error');
    } finally {
      this._setLoading('login-btn', false);
    }
  },

  // ============================================
  // REGISTER FORM
  // ============================================
  _initRegisterForm() {
    const regBtn = document.getElementById('register-btn');
    regBtn?.addEventListener('click', () => this.handleRegister());

    document.getElementById('reg-confirm')
      ?.addEventListener('keydown', e => {
        if (e.key === 'Enter') this.handleRegister();
      });

    // Google Sign Up
    document.getElementById('google-signup-btn')
      ?.addEventListener('click', () => this.handleGoogleAuth());
  },

  async handleRegister() {
    const name     = document.getElementById('reg-name')?.value.trim();
    const email    = document.getElementById('reg-email')?.value.trim();
    const password = document.getElementById('reg-password')?.value;
    const confirm  = document.getElementById('reg-confirm')?.value;

    // Validate
    if (!name || !email || !password || !confirm) {
      this._showMsg('Please fill in all fields', 'error');
      return;
    }
    if (!this._isValidEmail(email)) {
      this._showMsg('Please enter a valid email address', 'error');
      return;
    }
    if (password.length < 6) {
      this._showMsg('Password must be at least 6 characters', 'error');
      return;
    }
    if (password !== confirm) {
      this._showMsg('Passwords do not match', 'error');
      return;
    }

    this._setLoading('register-btn', true);

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);

      // Set display name
      await updateProfile(cred.user, { displayName: name });

      // Create Firestore user profile
      await this._createUserProfile(cred.user, name);

      this.currentUser = cred.user;
      await this._afterLogin(cred.user, true);
    } catch (err) {
      this._showMsg(this._firebaseError(err.code), 'error');
    } finally {
      this._setLoading('register-btn', false);
    }
  },

  // ============================================
  // GOOGLE AUTH
  // ============================================
  async handleGoogleAuth() {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user   = result.user;
      const isNew  = result._tokenResponse?.isNewUser || false;

      this.currentUser = user;

      if (isNew) {
        await this._createUserProfile(user, user.displayName || 'User');
      }

      await this._afterLogin(user, isNew);
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' &&
          err.code !== 'auth/cancelled-popup-request') {
        this._showMsg(this._firebaseError(err.code), 'error');
      }
    }
  },

  // ============================================
  // FORGOT PASSWORD
  // ============================================
  _initForgotPassword() {
    document.getElementById('forgot-btn')
      ?.addEventListener('click', () => this.handleForgotPassword());
  },

  async handleForgotPassword() {
    const email = document.getElementById('login-email')?.value.trim();

    if (!email) {
      this._showMsg('Enter your email address first', 'error');
      return;
    }
    if (!this._isValidEmail(email)) {
      this._showMsg('Please enter a valid email address', 'error');
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      this._showMsg('Password reset email sent! Check your inbox ✉️', 'success');
    } catch (err) {
      this._showMsg(this._firebaseError(err.code), 'error');
    }
  },

  // ============================================
  // AFTER LOGIN - Decide which screen to show
  // ============================================
  async _afterLogin(user, isNewUser) {
    const hasCompletedOnboarding = localStorage.getItem('vaultx_onboarded');
    const hasPin                 = localStorage.getItem('vaultx_pin');

    if (!hasCompletedOnboarding || isNewUser) {
      // First time → show onboarding
      ScreenManager.show('onboarding');
      OnboardManager.start(user);
    } else if (hasPin) {
      // Has PIN → show PIN lock
      ScreenManager.show('pin');
      PinManager.startVerify(user);
    } else {
      // No PIN set yet (shouldn't happen but handle it)
      ScreenManager.show('onboarding');
      OnboardManager.start(user, true); // skip to PIN step
    }
  },

  // ============================================
  // CREATE USER PROFILE IN FIRESTORE
  // ============================================
  async _createUserProfile(user, name) {
    try {
      await setDoc(doc(db, 'users', user.uid), {
        uid:       user.uid,
        name:      name,
        email:     user.email,
        photoURL:  user.photoURL || '',
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
        settings: {
          theme:        'dark',
          autoLock:     5,
          biometric:    false,
          defaultDrive: null
        }
      }, { merge: true }); // merge so we don't overwrite on re-login
    } catch (err) {
      console.error('[VaultX] Error creating user profile:', err);
    }
  },

  // ============================================
  // SIGN OUT
  // ============================================
  async signOut() {
    try {
      await signOut(auth);
      // Clear local data
      localStorage.removeItem('vaultx_pin');
      localStorage.removeItem('vaultx_bio');
      localStorage.removeItem('vaultx_onboarded');
      // Reload to auth screen
      window.location.reload();
    } catch (err) {
      toast('Error signing out. Try again.', 'error');
    }
  },

  // ============================================
  // EYE BUTTONS (show/hide password)
  // ============================================
  _initEyeButtons() {
    document.querySelectorAll('.eye-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const inputId = btn.dataset.target;
        const input   = document.getElementById(inputId);
        const icon    = btn.querySelector('i');

        if (!input) return;

        if (input.type === 'password') {
          input.type = 'text';
          icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
          input.type = 'password';
          icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
      });
    });
  },

  // ============================================
  // HELPERS
  // ============================================
  _showMsg(msg, type = 'error') {
    const el = document.getElementById('auth-msg');
    if (!el) return;
    el.textContent  = msg;
    el.className    = `auth-msg ${type}`;
    el.classList.remove('hidden');
  },

  _clearMsg() {
    const el = document.getElementById('auth-msg');
    if (el) el.classList.add('hidden');
  },

  _setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled  = loading;
    btn.style.opacity = loading ? '0.7' : '1';

    const span = btn.querySelector('span');
    const icon = btn.querySelector('i');

    if (loading) {
      if (span) span.textContent = 'Please wait...';
      if (icon) icon.className = 'fas fa-spinner fa-spin';
    } else {
      if (btnId === 'login-btn') {
        if (span) span.textContent = 'Sign In';
        if (icon) icon.className = 'fas fa-arrow-right';
      } else {
        if (span) span.textContent = 'Create Account';
        if (icon) icon.className = 'fas fa-arrow-right';
      }
    }
  },

  _isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  },

  _firebaseError(code) {
    const map = {
      'auth/user-not-found':       'No account found with this email',
      'auth/wrong-password':       'Incorrect password. Try again',
      'auth/invalid-credential':   'Invalid email or password',
      'auth/email-already-in-use': 'This email is already registered',
      'auth/weak-password':        'Password is too weak (min 6 chars)',
      'auth/invalid-email':        'Invalid email address format',
      'auth/too-many-requests':    'Too many attempts. Please wait and try again',
      'auth/network-request-failed':'Network error. Check your connection',
      'auth/popup-blocked':        'Popup was blocked. Please allow popups',
      'auth/requires-recent-login':'Please sign in again to continue',
      'auth/user-disabled':        'This account has been disabled',
    };
    return map[code] || 'Something went wrong. Please try again';
  }
};

// ============================================
// SCREEN MANAGER
// ============================================
export const ScreenManager = {

  _current: null,

  show(name) {
    // Map name → element id
    const map = {
      splash:     'splash-screen',
      auth:       'auth-screen',
      onboarding: 'onboarding-screen',
      pin:        'pin-screen',
      app:        'app-screen'
    };

    const targetId = map[name];
    if (!targetId) return;

    // Hide all screens
    ['splash-screen', 'auth-screen', 'onboarding-screen',
     'pin-screen', 'app-screen'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    // Show target
    const target = document.getElementById(targetId);
    if (target) target.classList.remove('hidden');

    this._current = name;
    console.log(`[VaultX] Screen → ${name}`);
  },

  current() { return this._current; }
};

// ============================================
// PIN MANAGER
// ============================================
export const PinManager = {

  _mode:        'verify', // 'setup' | 'confirm' | 'verify'
  _entered:     '',
  _firstPin:    '',
  _attempts:    0,
  _maxAttempts: 5,
  _user:        null,
  _onSuccess:   null,

  // ---- Setup (called from onboarding) ----
  startSetup(user, onSuccess) {
    this._mode      = 'setup';
    this._entered   = '';
    this._firstPin  = '';
    this._attempts  = 0;
    this._user      = user;
    this._onSuccess = onSuccess;

    this._updateUI('setup');
    this._bindKeys('ob-pin', 'ob');
    this._updateDots('ob', 0);
  },

  // ---- Verify (called on app open) ----
  startVerify(user) {
    this._mode     = 'verify';
    this._entered  = '';
    this._attempts = 0;
    this._user     = user;

    // Update lock screen user info
    this._updateLockUser(user);
    this._updateUI('verify');
    this._bindKeys('lock-pin', 'lock');
    this._updateDots('lock', 0);

    // Check biometric availability
    this._checkBiometric();
  },

  // ---- Bind keypad ----
  _bindKeys(prefix, dotPrefix) {
    // Number keys
    document.querySelectorAll('.pin-key[data-val]').forEach(key => {
      // Remove old listener by cloning
      const newKey = key.cloneNode(true);
      key.parentNode?.replaceChild(newKey, key);

      newKey.addEventListener('click', () => {
        if (this._entered.length >= 6) return;
        this._entered += newKey.dataset.val;
        this._updateDots(dotPrefix, this._entered.length);

        // Haptic feedback (mobile)
        if (navigator.vibrate) navigator.vibrate(10);

        if (this._entered.length === 6) {
          setTimeout(() => this._processEntry(), 250);
        }
      });
    });

    // Delete key - onboarding
    const delOb = document.getElementById('ob-pin-del');
    if (delOb) {
      const newDel = delOb.cloneNode(true);
      delOb.parentNode?.replaceChild(newDel, delOb);
      newDel.addEventListener('click', () => this._delete(dotPrefix));
    }

    // Delete key - lock screen
    const delLock = document.getElementById('lock-pin-del');
    if (delLock) {
      const newDel = delLock.cloneNode(true);
      delLock.parentNode?.replaceChild(newDel, delLock);
      newDel.addEventListener('click', () => this._delete(dotPrefix));
    }

    // Biometric key on lock screen
    const bioKey = document.getElementById('lock-bio-btn');
    if (bioKey) {
      const newBio = bioKey.cloneNode(true);
      bioKey.parentNode?.replaceChild(newBio, bioKey);
      newBio.addEventListener('click', () => BiometricManager.verify());
    }

    // Forgot PIN button
    document.getElementById('forgot-pin-btn')
      ?.addEventListener('click', () => {
        if (confirm('Forgot PIN? You will need to sign in again.')) {
          AuthManager.signOut();
        }
      });
  },

  // ---- Process PIN entry ----
  _processEntry() {
    if (this._mode === 'setup') {
      // Save first PIN, ask to confirm
      this._firstPin = this._entered;
      this._entered  = '';
      this._mode     = 'confirm';
      this._updateUI('confirm');
      this._updateDots('ob', 0);

    } else if (this._mode === 'confirm') {
      // Compare with first
      if (this._entered === this._firstPin) {
        // Match! Save PIN
        this._savePin(this._entered);
        this._dotSuccess('ob');
        toast('PIN set successfully! 🔐', 'success');
        setTimeout(() => {
          if (this._onSuccess) this._onSuccess();
        }, 600);
      } else {
        // Mismatch
        this._dotError('ob');
        this._entered  = '';
        this._firstPin = '';
        this._mode     = 'setup';
        setTimeout(() => {
          this._updateUI('setup');
          this._updateDots('ob', 0);
          toast('PINs did not match. Try again', 'error');
        }, 600);
      }

    } else if (this._mode === 'verify') {
      const stored = localStorage.getItem('vaultx_pin');
      const hashed = this._hashPin(this._entered);

      if (hashed === stored) {
        // Correct!
        this._dotSuccess('lock');
        this._attempts = 0;
        setTimeout(() => {
          window.AppManager?.launch(this._user);
        }, 400);
      } else {
        // Wrong
        this._attempts++;
        this._dotError('lock');
        this._entered = '';

        setTimeout(() => {
          this._updateDots('lock', 0);

          const remaining = this._maxAttempts - this._attempts;

          if (this._attempts >= this._maxAttempts) {
            toast('Too many wrong attempts. Signing out...', 'error');
            setTimeout(() => AuthManager.signOut(), 2000);
          } else {
            const errEl = document.getElementById('pin-error-msg');
            if (errEl) {
              errEl.textContent =
                `Wrong PIN. ${remaining} attempt${remaining > 1 ? 's' : ''} left`;
              errEl.classList.remove('hidden');
              setTimeout(() => errEl.classList.add('hidden'), 2500);
            }
          }
        }, 600);
      }
    }
  },

  // ---- Delete last digit ----
  _delete(dotPrefix) {
    if (this._entered.length > 0) {
      this._entered = this._entered.slice(0, -1);
      this._updateDots(dotPrefix, this._entered.length);
      if (navigator.vibrate) navigator.vibrate(5);
    }
  },

  // ---- Update dot visuals ----
  _updateDots(prefix, count) {
    for (let i = 0; i < 6; i++) {
      const dot = document.getElementById(`${prefix}-dot-${i}`);
      if (!dot) continue;
      dot.classList.toggle('filled', i < count);
      dot.classList.remove('error', 'success');
    }
  },

  _dotError(prefix) {
    for (let i = 0; i < 6; i++) {
      const dot = document.getElementById(`${prefix}-dot-${i}`);
      if (dot) {
        dot.classList.remove('filled', 'success');
        dot.classList.add('error');
      }
    }
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  },

  _dotSuccess(prefix) {
    for (let i = 0; i < 6; i++) {
      const dot = document.getElementById(`${prefix}-dot-${i}`);
      if (dot) {
        dot.classList.remove('filled', 'error');
        dot.classList.add('success');
      }
    }
  },

  // ---- Update hint text ----
  _updateUI(mode) {
    const hint = document.getElementById('ob-pin-hint');
    const title = document.getElementById('pin-lock-title');

    if (mode === 'setup' && hint) {
      hint.textContent = 'Enter a new 6-digit PIN';
    } else if (mode === 'confirm' && hint) {
      hint.textContent = 'Enter PIN again to confirm';
    } else if (mode === 'verify' && title) {
      title.textContent = 'Enter your PIN';
    }
  },

  // ---- Update lock screen user info ----
  _updateLockUser(user) {
    const nameEl   = document.getElementById('lock-username');
    const avatarEl = document.getElementById('lock-avatar');

    if (nameEl) {
      nameEl.textContent = user.displayName
        ? `Hey, ${user.displayName.split(' ')[0]}!`
        : 'Welcome back!';
    }

    if (avatarEl && user.photoURL) {
      avatarEl.innerHTML =
        `<img src="${user.photoURL}"
              style="width:100%;height:100%;object-fit:cover;border-radius:50%"
              alt="avatar" />`;
    }
  },

  // ---- Save hashed PIN ----
  _savePin(pin) {
    localStorage.setItem('vaultx_pin', this._hashPin(pin));
  },

  // ---- Hash PIN (simple but effective for local storage) ----
  _hashPin(pin) {
    // Simple hash - for production use WebCrypto API
    let hash = 5381;
    const salt = 'vaultx_salt_2024';
    const str  = pin + salt;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit int
    }
    return btoa(Math.abs(hash).toString() + pin.length);
  },

  // ---- Check biometric ----
  async _checkBiometric() {
    const bioEnabled = localStorage.getItem('vaultx_bio') === 'true';
    const bioBtn     = document.getElementById('lock-bio-btn');

    if (!bioBtn) return;

    if (bioEnabled && window.PublicKeyCredential) {
      try {
        const available =
          await PublicKeyCredential
            .isUserVerifyingPlatformAuthenticatorAvailable();
        if (available) {
          bioBtn.classList.remove('hidden');
          // Auto-trigger biometric after short delay
          setTimeout(() => BiometricManager.verify(), 800);
          return;
        }
      } catch (e) {}
    }

    bioBtn.classList.add('hidden');
  },

  // ---- Change PIN (from settings) ----
  changePIN(user, onSuccess) {
    this._mode      = 'setup';
    this._entered   = '';
    this._firstPin  = '';
    this._user      = user;
    this._onSuccess = onSuccess;

    ScreenManager.show('pin');
    this._updateUI('setup');
    this._bindKeys('lock-pin', 'lock');
    this._updateDots('lock', 0);
  }
};

// ============================================
// BIOMETRIC MANAGER
// ============================================
export const BiometricManager = {

  async isAvailable() {
    if (!window.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential
        .isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },

  // Register biometric (during onboarding)
  async register() {
    const available = await this.isAvailable();
    if (!available) {
      toast('Biometric not available on this device', 'error');
      return false;
    }

    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const userId = new TextEncoder().encode(
        auth.currentUser?.uid || 'vaultx-user'
      );

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: 'VaultX',
            id:   window.location.hostname
          },
          user: {
            id:          userId,
            name:        auth.currentUser?.email || 'user',
            displayName: auth.currentUser?.displayName || 'VaultX User'
          },
          pubKeyCredParams: [
            { alg: -7,   type: 'public-key' }, // ES256
            { alg: -257, type: 'public-key' }  // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification:        'required'
          },
          timeout: 60000
        }
      });

      if (credential) {
        // Store credential ID
        const credId = btoa(
          String.fromCharCode(...new Uint8Array(credential.rawId))
        );
        localStorage.setItem('vaultx_bio_cred', credId);
        localStorage.setItem('vaultx_bio', 'true');
        return true;
      }
    } catch (err) {
      console.error('[VaultX] Biometric register error:', err);
      if (err.name !== 'NotAllowedError') {
        toast('Biometric setup failed. Try again.', 'error');
      }
    }
    return false;
  },

  // Verify biometric (on lock screen)
  async verify() {
    const available = await this.isAvailable();
    if (!available) return false;

    const bioEnabled = localStorage.getItem('vaultx_bio') === 'true';
    if (!bioEnabled) return false;

    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId:            window.location.hostname,
          userVerification: 'required',
          timeout:          60000
        }
      });

      if (assertion) {
        // Biometric verified!
        PinManager._dotSuccess('lock');
        setTimeout(() => {
          window.AppManager?.launch(auth.currentUser);
        }, 400);
        return true;
      }
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        console.warn('[VaultX] Biometric verify:', err.name);
      }
    }
    return false;
  }
};

// ============================================
// ONBOARDING MANAGER
// ============================================
export const OnboardManager = {

  _currentStep: 1,
  _totalSteps:  4,
  _user:        null,
  _connectedDrives: [],

  start(user, skipToStep = false) {
    this._user         = user;
    this._currentStep  = skipToStep ? 2 : 1;
    this._connectedDrives = [];

    this._bindButtons();
    this._goToStep(this._currentStep);
  },

  _bindButtons() {
    // Step 1 - "Get Started" button is inline onclick
    // Step 3 - Biometric buttons are inline onclick
    // Step 4 - Drive button is inline onclick

    // These are called from inline onclick in HTML
    window.Onboard = {
      nextStep:        () => this.nextStep(),
      enableBiometric: () => this.enableBiometric(),
      skipBiometric:   () => this.skipBiometric(),
      addDrive:        () => this.addDrive(),
      skipDrive:       () => this.skipDrive(),
      finish:          () => this.finish()
    };
  },

  nextStep() {
    this._currentStep++;
    if (this._currentStep > this._totalSteps) {
      this.finish();
      return;
    }
    this._goToStep(this._currentStep);
  },

  _goToStep(step) {
    // Update step dots
    document.querySelectorAll('.step-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i + 1 === step);
      dot.classList.toggle('done',   i + 1 < step);
    });

    // Hide all steps
    document.querySelectorAll('.onboard-step').forEach(el =>
      el.classList.remove('active')
    );

    // Show target step
    const target = document.getElementById(`ob-step-${step}`);
    if (target) target.classList.add('active');

    // Step-specific init
    if (step === 2) this._initPinStep();
    if (step === 3) this._initBiometricStep();
    if (step === 4) this._initDriveStep();
  },

  // ---- Step 2: PIN ----
  _initPinStep() {
    PinManager.startSetup(this._user, () => {
      // PIN set successfully → go to next step
      this._currentStep = 3;
      this._goToStep(3);
    });
  },

  // ---- Step 3: Biometric ----
  _initBiometricStep() {
    BiometricManager.isAvailable().then(available => {
      if (!available) {
        // Skip biometric step if not supported
        document.getElementById('enable-bio-btn')?.classList.add('hidden');
        document.getElementById('bio-status-text').textContent =
          'Biometric not available on this device';
      }
    });
  },

  async enableBiometric() {
    const ring   = document.getElementById('bio-ring');
    const status = document.getElementById('bio-status-text');

    ring?.classList.add('scanning');
    if (status) status.textContent = 'Scanning...';

    const success = await BiometricManager.register();

    ring?.classList.remove('scanning');

    if (success) {
      ring?.classList.add('success');
      if (status) status.textContent = 'Biometric enabled! ✅';
      toast('Biometric lock enabled! 🔐', 'success');

      // Auto-advance after 1.2s
      setTimeout(() => this.nextStep(), 1200);
    } else {
      if (status) status.textContent = 'Try again or skip';
    }
  },

  skipBiometric() {
    localStorage.setItem('vaultx_bio', 'false');
    this.nextStep();
  },

  // ---- Step 4: Drive ----
  _initDriveStep() {
    this._renderConnectedDrives();
  },

  async addDrive() {
    // Use Google OAuth to get drive access
    // We reuse the googleProvider which has drive scopes
    try {
      const result = await signInWithPopup(auth, googleProvider);

      // Get the access token for Drive API
      const credential = result._tokenResponse;
      const email      = result.user.email;

      // Check if already added
      const exists = this._connectedDrives.find(d => d.email === email);
      if (exists) {
        toast('This Drive account is already connected', 'error');
        return;
      }

      // Save drive info
      const driveInfo = {
        id:          result.user.uid + '_drive_' + Date.now(),
        email:       email,
        name:        result.user.displayName || email,
        photoURL:    result.user.photoURL || '',
        isDefault:   this._connectedDrives.length === 0,
        addedAt:     new Date().toISOString(),
        storageUsed: 0,
        storageTotal: 15 * 1024 * 1024 * 1024 // 15GB in bytes
      };

      this._connectedDrives.push(driveInfo);

      // Save to Firestore
      await this._saveDriveToFirestore(driveInfo);

      // Save to localStorage for quick access
      localStorage.setItem(
        'vaultx_drives',
        JSON.stringify(this._connectedDrives)
      );

      if (driveInfo.isDefault) {
        localStorage.setItem('vaultx_default_drive', driveInfo.email);
      }

      this._renderConnectedDrives();
      toast(`Drive connected: ${email} ✅`, 'success');

      // Show finish button
      document.getElementById('ob-finish-btn')?.classList.remove('hidden');
      document.getElementById('ob-add-drive-btn').textContent =
        '+ Add Another Drive';

    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        toast('Could not connect Drive. Try again.', 'error');
        console.error('[VaultX] Drive connect error:', err);
      }
    }
  },

  async _saveDriveToFirestore(driveInfo) {
    if (!this._user) return;
    try {
      const { doc, setDoc, db } = await import('./firebase-config.js');
      await setDoc(
        doc(db, 'users', this._user.uid, 'drives', driveInfo.id),
        {
          ...driveInfo,
          addedAt: serverTimestamp()
        }
      );
    } catch (err) {
      console.error('[VaultX] Save drive error:', err);
    }
  },

  _renderConnectedDrives() {
    const container = document.getElementById('ob-drives-list');
    if (!container) return;

    if (this._connectedDrives.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = this._connectedDrives.map(drive => `
      <div class="connected-drive-item">
        <i class="fab fa-google-drive" style="color:#34A853;font-size:20px"></i>
        <span class="drive-email">${drive.email}</span>
        ${drive.isDefault
          ? '<span class="badge badge-green">Default</span>'
          : ''}
        <i class="fas fa-check-circle drive-check"></i>
      </div>
    `).join('');
  },

  skipDrive() {
    this.finish();
  },

  // ---- Finish onboarding ----
  finish() {
    // Mark onboarding complete
    localStorage.setItem('vaultx_onboarded', 'true');

    // Launch app
    window.AppManager?.launch(this._user);
  }
};

// ============================================
// AUTO-LOCK MANAGER
// ============================================
export const AutoLockManager = {

  _timer:    null,
  _minutes:  5,
  _user:     null,

  init(user) {
    this._user    = user;
    this._minutes = parseInt(
      localStorage.getItem('vaultx_autolock') || '5'
    );

    if (this._minutes === 0) return; // Never

    this._resetTimer();
    this._bindActivity();
  },

  _resetTimer() {
    clearTimeout(this._timer);
    if (this._minutes === 0) return;

    this._timer = setTimeout(() => {
      this._lock();
    }, this._minutes * 60 * 1000);
  },

  _bindActivity() {
    const reset = () => this._resetTimer();
    document.addEventListener('touchstart', reset, { passive: true });
    document.addEventListener('click',      reset);
    document.addEventListener('keydown',    reset);
    document.addEventListener('scroll',     reset, { passive: true });
  },

  _lock() {
    const hasPin = localStorage.getItem('vaultx_pin');
    if (hasPin && ScreenManager.current() === 'app') {
      ScreenManager.show('pin');
      PinManager.startVerify(this._user);
      toast('VaultX locked for security 🔒', 'info');
    }
  },

  updateMinutes(minutes) {
    this._minutes = parseInt(minutes);
    localStorage.setItem('vaultx_autolock', minutes);
    this._resetTimer();
  },

  stop() {
    clearTimeout(this._timer);
  }
};