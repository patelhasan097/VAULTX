// ============================================
// VAULTX - SERVICE WORKER v1.0
// Repo: patelhasan097/VAULTX
// ============================================

const APP_VERSION   = 'v1.0.0';
const STATIC_CACHE  = `vaultx-static-${APP_VERSION}`;
const DYNAMIC_CACHE = `vaultx-dynamic-${APP_VERSION}`;

// ==========================================
// FILES TO CACHE
// ==========================================
const STATIC_ASSETS = [
  '/VAULTX/',
  '/VAULTX/index.html',
  '/VAULTX/manifest.json',
  '/VAULTX/css/main.css',
  '/VAULTX/css/auth.css',
  '/VAULTX/css/app.css',
  '/VAULTX/js/firebase-config.js',
  '/VAULTX/js/auth.js',
  '/VAULTX/js/drive.js',
  '/VAULTX/js/app.js',
  '/VAULTX/js/sw-register.js',
  '/VAULTX/assets/icons/icon-192.png',
  '/VAULTX/assets/icons/icon-512.png'
];

const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Poppins:wght@600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// ==========================================
// NEVER CACHE THESE (Always network)
// ==========================================
const NETWORK_ONLY_HOSTS = [
  'firebaseio.com',
  'googleapis.com',
  'firebase.google.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'allorigins.win',
  'img.youtube.com',
  'www.youtube.com',
  'accounts.google.com'
];

// ==========================================
// INSTALL
// ==========================================
self.addEventListener('install', (event) => {
  console.log(`[VaultX SW] Installing ${APP_VERSION}...`);

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[VaultX SW] Caching static assets...');

        const internalPromises = STATIC_ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[VaultX SW] Could not cache: ${url}`, err)
          )
        );

        const externalPromises = EXTERNAL_ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[VaultX SW] Could not cache external: ${url}`, err)
          )
        );

        return Promise.all([...internalPromises, ...externalPromises]);
      })
      .then(() => {
        console.log('[VaultX SW] Install complete ✅');
        return self.skipWaiting();
      })
  );
});

// ==========================================
// ACTIVATE
// ==========================================
self.addEventListener('activate', (event) => {
  console.log(`[VaultX SW] Activating ${APP_VERSION}...`);

  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key =>
            key.startsWith('vaultx-') &&
            key !== STATIC_CACHE &&
            key !== DYNAMIC_CACHE
          )
          .map(key => {
            console.log(`[VaultX SW] Deleting old cache: ${key}`);
            return caches.delete(key);
          })
      ))
      .then(() => {
        console.log('[VaultX SW] Activated ✅');
        return self.clients.claim();
      })
  );
});

// ==========================================
// FETCH
// ==========================================
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Skip non-http
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // NETWORK ONLY - Firebase, Google APIs
  const isNetworkOnly = NETWORK_ONLY_HOSTS.some(host =>
    url.hostname.includes(host)
  );

  if (isNetworkOnly) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      )
    );
    return;
  }

  // CACHE FIRST - Static files
  const isStatic =
    request.destination === 'style'  ||
    request.destination === 'script' ||
    request.destination === 'font'   ||
    request.destination === 'image'  ||
    url.pathname.startsWith('/VAULTX/assets/') ||
    url.hostname.includes('fonts.googleapis.com')  ||
    url.hostname.includes('fonts.gstatic.com')     ||
    url.hostname.includes('cdnjs.cloudflare.com');

  if (isStatic) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // NETWORK FIRST - HTML and everything else
  event.respondWith(networkFirst(request));
});

// ==========================================
// STRATEGY: Cache First
// ==========================================
async function cacheFirst(request) {
  try {
    const cached = await caches.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503 });
  }
}

// ==========================================
// STRATEGY: Network First
// ==========================================
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Fallback to index.html for navigation
    if (request.destination === 'document') {
      const fallback = await caches.match('/VAULTX/index.html');
      if (fallback) return fallback;
    }

    return new Response('Offline', { status: 503 });
  }
}

// ==========================================
// BACKGROUND SYNC
// ==========================================
self.addEventListener('sync', (event) => {
  if (event.tag === 'vaultx-sync-items') {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c =>
          c.postMessage({ type: 'SYNC_COMPLETE' })
        )
      )
    );
  }
});

// ==========================================
// MESSAGES FROM APP
// ==========================================
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      keys.filter(k => k.startsWith('vaultx-'))
          .forEach(k => caches.delete(k))
    );
  }
});

// ==========================================
// PUSH NOTIFICATIONS
// ==========================================
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification('VaultX', {
      body:    data.message || 'New notification',
      icon:    '/VAULTX/assets/icons/icon-192.png',
      badge:   '/VAULTX/assets/icons/icon-72.png',
      vibrate: [100, 50, 100],
      data:    { url: data.url || '/VAULTX/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/VAULTX/')
  );
});

console.log('[VaultX SW] Service Worker loaded ✅');