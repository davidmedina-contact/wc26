var CACHE = 'wc26-v19';
var BUILD_TS = '2026-06-22T23:10:12.834Z'; // auto-updated by npm run predeploy

// Only precache assets that rarely change
var PRECACHE = [
  '/',
  '/index.html',
  '/icon-512.png',
  '/manifest.json'
];

// Files that change frequently: always fetch fresh, cache as offline fallback
var NETWORK_FIRST = ['/', '/index.html', '/app.js', '/style.css', '/world-cup-2026-schedule.ics'];

// Stale-while-revalidate + notify: serve cache instantly, fetch fresh in background,
// notify client if fresh data differs so it can re-render
var SWR_NOTIFY = ['/data.json', '/api/data'];

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

// Fetch strategy
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // Skip non-GET requests, non-http schemes, and cross-origin requests.
  if (e.request.method !== 'GET' || !url.protocol.startsWith('http')) return;
  if (url.origin !== self.location.origin) return;

  var isSWRNotify = SWR_NOTIFY.some(function(path) {
    return url.pathname === path || url.pathname.endsWith(path);
  });

  var isNetworkFirst = !isSWRNotify && NETWORK_FIRST.some(function(path) {
    return url.pathname === path || url.pathname.endsWith(path);
  });

  if (isSWRNotify) {
    // Stale-while-revalidate with freshness notification:
    // 1. Return cached response immediately (instant render)
    // 2. Fetch fresh in background
    // 3. If the fresh body differs from the cached body, update cache and notify
    //    all clients. We compare the actual response bodies rather than ETags so
    //    change detection is robust even when the server sends no ETag/Last-Modified
    //    (relying on header presence caused false "changed" signals and a refresh
    //    loop that spammed clients with DATA_UPDATED on every revalidation).
    e.respondWith(
      caches.open(CACHE).then(function(cache) {
        return cache.match(e.request).then(function(cached) {
          var fetchPromise = fetch(e.request).then(function(response) {
            if (!response.ok) {
              // On error, keep serving cache
              return cached || response;
            }
            var freshForCache = response.clone();
            var freshForCompare = response.clone();
            return Promise.all([
              cached ? cached.clone().text().catch(function() { return null; }) : Promise.resolve(null),
              freshForCompare.text().catch(function() { return null; })
            ]).then(function(bodies) {
              var cachedBody = bodies[0];
              var freshBody = bodies[1];
              // Only treat as changed when we have a fresh body that differs from
              // a previously cached body. No cached body yet => first load, not a
              // "change". Unreadable fresh body => don't notify (avoid false loop).
              var hasChanged = cachedBody !== null && freshBody !== null && cachedBody !== freshBody;
              return cache.put(e.request, freshForCache).then(function() {
                if (hasChanged) {
                  return self.clients.matchAll().then(function(clients) {
                    clients.forEach(function(client) {
                      client.postMessage({ type: 'DATA_UPDATED', url: e.request.url });
                    });
                  });
                }
              }).then(function() { return response; });
            });
          }).catch(function() { return cached; });

          // Return cached immediately if available, otherwise wait for network
          return cached || fetchPromise;
        });
      })
    );
  } else if (isNetworkFirst) {
    // Network-first: always try fresh, cache as offline fallback
    e.respondWith(
      fetch(e.request).then(function(response) {
        if (!response.ok) {
          return caches.match(e.request).then(function(cached) { return cached || response; });
        }
        var clone = response.clone();
        caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
        return response;
      }).catch(function() { return caches.match(e.request); })
    );
  } else {
    // Stale-while-revalidate for other assets (icons, manifest, etc.)
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
