// ============================================
// VAULTX - SERVICE WORKER REGISTER + BOOT
// ============================================

// ==========================================
// REGISTER SERVICE WORKER
// ==========================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/vaultx/sw.js', { scope: '/vaultx/' })
      .then(reg => {
        console.log('[VaultX] SW registered:', reg.scope);

        // Check for updates every 60s
        setInterval(() => reg.update(), 60000);

        // Update found
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' &&
                navigator.serviceWorker.controller) {
              console.log('[VaultX] Update available');
              // Optional: show update banner
            }
          });
        });
      })
      .catch(err => {
        console.warn('[VaultX] SW registration failed:', err);
      });
  });
}

// ==========================================
// APP BOOT SEQUENCE
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {

  console.log('[VaultX] Booting...');

  // Step 1: Show splash (already visible in HTML)
  const splash = document.getElementById('splash-screen');

  // Step 2: Load app modules
  let AuthManager, ScreenManager, OnboardManager,
      PinManager, BiometricManager;

  try {
    const authModule = await import('./auth.js');
    AuthManager      = authModule.AuthManager;
    ScreenManager    = authModule.ScreenManager;
    OnboardManager   = authModule.OnboardManager;
    PinManager       = authModule.PinManager;
    BiometricManager = authModule.BiometricManager;

    // Make globally available
    window.AuthManager      = AuthManager;
    window.ScreenManager    = ScreenManager;
    window.OnboardManager   = OnboardManager;
    window.PinManager       = PinManager;
    window.BiometricManager = BiometricManager;

    // Initialize auth module
    AuthManager.init();

    // Load AppManager
    await import('./app.js');

    console.log('[VaultX] Modules loaded ✅');
  } catch (err) {
    console.error('[VaultX] Module load error:', err);
    // Show error on splash
    if (splash) {
      splash.innerHTML = `
        <div style="color:white;text-align:center;padding:40px">
          <i class="fas fa-exclamation-triangle"
             style="font-size:48px;color:#FF4444;margin-bottom:20px;display:block"></i>
          <h2 style="margin-bottom:12px">Failed to Load</h2>
          <p style="color:rgba(255,255,255,0.6);margin-bottom:24px">
            Please check your internet connection<br>and reload the page
          </p>
          <button onclick="location.reload()"
                  style="padding:12px 32px;background:linear-gradient(135deg,#6C63FF,#00D4FF);
                         border:none;border-radius:50px;color:white;
                         font-size:16px;font-weight:600;cursor:pointer">
            Reload App
          </button>
        </div>
      `;
    }
    return;
  }

  // Step 3: Animate splash (minimum 2s for branding)
  await _wait(2000);

  // Step 4: Wait for Firebase auth to resolve
  await new Promise(resolve => AuthManager.onReady(resolve));

  // Step 5: Hide splash with fade
  if (splash) {
    splash.classList.add('fade-out');
    await _wait(500);
    splash.classList.add('hidden');
  }

  // Step 6: Decide which screen to show
  const user               = AuthManager.currentUser;
  const hasOnboarded       = localStorage.getItem('vaultx_onboarded');
  const hasPin             = localStorage.getItem('vaultx_pin');
  const savedTheme         = localStorage.getItem('vaultx_theme');

  // Apply saved theme
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
  }

  if (!user) {
    // Not logged in → show auth
    ScreenManager.show('auth');
    console.log('[VaultX] → Auth screen');

  } else if (!hasOnboarded || !hasPin) {
    // Logged in but not onboarded → onboarding
    ScreenManager.show('onboarding');
    OnboardManager.start(user);
    console.log('[VaultX] → Onboarding');

  } else {
    // Logged in + onboarded → PIN lock
    ScreenManager.show('pin');
    PinManager.startVerify(user);
    console.log('[VaultX] → PIN lock');
  }

  // Step 7: Handle PWA install prompt
  _handleInstallPrompt();

  // Step 8: Handle app visibility (re-lock on hide)
  _handleVisibilityChange();

  console.log('[VaultX] Boot complete ✅');
});

// ==========================================
// PWA INSTALL PROMPT
// ==========================================
function _handleInstallPrompt() {
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;

    // Show install hint after 10 seconds
    setTimeout(() => {
      if (deferredPrompt) {
        window.VaultUtils?.showToast(
          'Install VaultX as an app! 📱', 'info', 8000
        );
        deferredPrompt = null;
      }
    }, 10000);
  });

  window.addEventListener('appinstalled', () => {
    window.VaultUtils?.showToast(
      'VaultX installed successfully! 🎉', 'success'
    );
    deferredPrompt = null;
  });
}

// ==========================================
// HANDLE PAGE VISIBILITY (Auto-lock)
// ==========================================
function _handleVisibilityChange() {
  let hiddenAt = null;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else {
      // App came back to foreground
      if (!hiddenAt) return;

      const hiddenSeconds = (Date.now() - hiddenAt) / 1000;
      const autolock = parseInt(
        localStorage.getItem('vaultx_autolock') || '5'
      );

      // If hidden longer than autolock time → show PIN
      if (autolock > 0 &&
          hiddenSeconds > autolock * 60 &&
          window.ScreenManager?.current() === 'app') {

        const user   = window.AuthManager?.currentUser;
        const hasPin = localStorage.getItem('vaultx_pin');

        if (user && hasPin) {
          window.ScreenManager.show('pin');
          window.PinManager?.startVerify(user);
        }
      }

      hiddenAt = null;
    }
  });
}

// ==========================================
// UTILITY: Wait
// ==========================================
function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==========================================
// HANDLE SW MESSAGES
// ==========================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'SYNC_COMPLETE') {
      console.log('[VaultX] Background sync complete');
    }
  });
}

// ==========================================
// GLOBAL ERROR HANDLER
// ==========================================
window.addEventListener('unhandledrejection', event => {
  console.error('[VaultX] Unhandled promise rejection:', event.reason);
});

window.onerror = (msg, src, line) => {
  console.error(`[VaultX] Error: ${msg} (${src}:${line})`);
};