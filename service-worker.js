var CACHE = 'wc26-v11';

// Only precache assets that rarely change
var PRECACHE = [
  '/',
  '/index.html',
  '/icon-512.png',
  '/manifest.json'
];

// Files that change frequently: always fetch fresh, cache as offline fallback
var NETWORK_FIRST = ['/data.json', '/app.js', '/live-api.js', '/style.css', '/world-cup-2026-schedule.ics'];

// Install: cache core shell assets only (small, fast, reliable)
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(PRECACHE);
    })
  );
  // Skip waiting immediately — essential for iOS PWA where there's only one "tab"
  // and the old SW would otherwise never relinquish control
  self.skipWaiting();
});

// Activate: clean ALL old caches aggressively
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  // Claim clients so the new SW takes over immediately after activation
  self.clients.claim();
});

// Fetch strategy: network-first for dynamic data, stale-while-revalidate for shell
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // Skip non-GET requests, non-http schemes, and cross-origin requests (live API)
  if (e.request.method !== 'GET' || !url.protocol.startsWith('http')) return;
  if (url.origin !== self.location.origin) return;

  var isApiRequest = url.pathname.indexOf('/api/') === 0;
  var isNetworkFirst = isApiRequest || NETWORK_FIRST.some(function(path) {
    return url.pathname === path || url.pathname.endsWith(path);
  });

  if (isNetworkFirst) {
    // Network-first: always try fresh, cache as offline fallback
    e.respondWith(
      fetch(e.request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
        }
        return response;
      }).catch(function() {
        return caches.match(e.request);
      })
    );
  } else {
    // Stale-while-revalidate: serve from cache immediately, update in background
    e.respondWith(
      caches.open(CACHE).then(function(cache) {
        return cache.match(e.request).then(function(cached) {
          var fetchPromise = fetch(e.request).then(function(response) {
            if (response.ok) {
              cache.put(e.request, response.clone());
            }
            return response;
          }).catch(function() { return cached; });

          return cached || fetchPromise;
        });
      })
    );
  }
});

// Listen for skipWaiting message from client (user tapped "update" banner)
self.addEventListener('message', function(e) {
  if (e.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
