// ============================================
// VAULTX SERVICE WORKER v2.0
// All paths lowercase — GitHub Pages safe
// ============================================

const APP_VER      = 'v2.0.0';
const STATIC_CACHE = `vaultx-static-${APP_VER}`;
const DYNAMIC_CACHE= `vaultx-dynamic-${APP_VER}`;

const STATIC_ASSETS = [
  '/vaultx/',
  '/vaultx/index.html',
  '/vaultx/manifest.json',
  '/vaultx/css/main.css',
  '/vaultx/css/app.css',
  '/vaultx/js/config.js',
  '/vaultx/js/auth.js',
  '/vaultx/js/drive.js',
  '/vaultx/js/app.js'
];

const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Poppins:wght@600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css'
];

// Never cache these hosts
const NETWORK_ONLY = [
  'firebaseio.com', 'googleapis.com', 'firebase.google.com',
  'identitytoolkit.googleapis.com', 'securetoken.googleapis.com',
  'allorigins.win', 'img.youtube.com', 'www.youtube.com',
  'accounts.google.com', 'fonts.gstatic.com'
];

// ---- INSTALL ----
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      const all = [
        ...STATIC_ASSETS.map(url => cache.add(url).catch(() => {})),
        ...EXTERNAL_ASSETS.map(url => cache.add(url).catch(() => {}))
      ];
      return Promise.all(all);
    }).then(() => self.skipWaiting())
  );
});

// ---- ACTIVATE ----
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith('vaultx-') && k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ---- FETCH ----
self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET' || !request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // Network-only for Firebase / Google APIs
  if (NETWORK_ONLY.some(h => url.hostname.includes(h))) {
    e.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503, headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Cache-first for static assets
  const isStatic = ['style','script','font','image'].includes(request.destination)
    || url.pathname.startsWith('/vaultx/assets/')
    || url.hostname.includes('cdnjs.cloudflare.com');

  if (isStatic) {
    e.respondWith(cacheFirst(request));
    return;
  }

  // Network-first for everything else (HTML, API)
  e.respondWith(networkFirst(request));
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res?.ok) {
      const c = await caches.open(STATIC_CACHE);
      c.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res?.ok) {
      const c = await caches.open(DYNAMIC_CACHE);
      c.put(req, res.clone());
    }
    return res;
  } catch {
    const hit = await caches.match(req);
    if (hit) return hit;
    if (req.destination === 'document') {
      const fb = await caches.match('/vaultx/index.html');
      if (fb) return fb;
    }
    return new Response('Offline', { status: 503 });
  }
}

// ---- BACKGROUND SYNC ----
self.addEventListener('sync', e => {
  if (e.tag === 'vaultx-sync') {
    e.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SYNC_NOW' }))
      )
    );
  }
});

// ---- MESSAGES ----
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      keys.filter(k => k.startsWith('vaultx-')).forEach(k => caches.delete(k))
    );
  }
});

// ---- PUSH ----
self.addEventListener('push', e => {
  if (!e.data) return;
  const d = e.data.json();
  e.waitUntil(
    self.registration.showNotification('VaultX', {
      body: d.message || 'New notification',
      icon: '/vaultx/assets/icons/icon-192.png',
      badge: '/vaultx/assets/icons/icon-72.png',
      vibrate: [100, 50, 100],
      data: { url: d.url || '/vaultx/' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/vaultx/'));
});
