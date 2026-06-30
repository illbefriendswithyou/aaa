const CACHE_NAME = 'kjg-buoy-tracker-v1';
const urlsToCache = [
  './',
  './index.html',
  './dashboard.html',
  './css/style.css',
  './css/dashboard.css',
  './js/auth.js',
  './js/dashboard.js'
];

// Install service worker dan cache file penting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell');
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

// Aktivasi - bersihkan cache lama
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[SW] Menghapus cache lama:', name);
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch - pakai cache dulu, fallback ke network
// Untuk request API, selalu pakai network (data realtime)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Request ke API backend selalu langsung ke network (jangan di-cache)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Request file statis (HTML/CSS/JS) pakai cache-first strategy
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
