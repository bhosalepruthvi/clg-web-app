/**
 * service-worker.js
 * Offline support for the College Study Portal.
 *
 * Strategy, chosen so a stale cache can never break the interface again:
 *
 *   HTML pages   -> network first, cache only as an offline fallback.
 *                   A page fetched from a frozen cache is exactly how a layout
 *                   goes "disturbed" after an update, so HTML is never served
 *                   from cache while the network is available.
 *   Static assets-> cache first (safe: filenames or the cache version change).
 *   API requests -> never intercepted, always straight to the network.
 *
 * The authenticated pages (dashboards) are deliberately NOT pre-cached. They are
 * gated server-side by the session, so caching them would let the browser show a
 * dashboard to a signed-out user.
 */

// Bump this whenever you change any page. Activation deletes every other cache,
// which is what clears a client's stale copies.
const CACHE_NAME = 'studyportal-v2';

// Only public, non-personalised assets are pre-cached.
const PRECACHE = [
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll aborts the whole install if one URL 404s, so add individually.
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch((err) =>
            console.warn('[SW] Could not pre-cache', url, err && err.message)
          )
        )
      )
    )
  );
  // Take over as soon as possible so a fix reaches the user without two reloads.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Removing outdated cache:', name);
            return caches.delete(name);
          })
      )
    )
  );
  // Apply to pages that are already open, not just new ones.
  self.clients.claim();
});

/** True for the API surface, which must never be cached. */
function isApi(request) {
  return new URL(request.url).pathname.startsWith('/api/');
}

/** True for a document navigation (typing a URL, following a link, reloading). */
function isNavigation(request) {
  return request.mode === 'navigate' ||
    (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html'));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is cached; POST/PUT/DELETE go straight through.
  if (request.method !== 'GET') return;

  // Never interfere with the API or its session handling.
  if (isApi(request)) return;

  // --- HTML: network first -------------------------------------------------
  if (isNavigation(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Keep a copy so a later offline visit still shows something.
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/login'))
        )
    );
    return;
  }

  // --- other same-origin GETs: cache first, revalidate in the background ---
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});

/**
 * Lets a page ask the service worker to drop everything and re-fetch.
 * Usage from the console:  navigator.serviceWorker.controller.postMessage('clear')
 */
self.addEventListener('message', (event) => {
  if (event.data === 'clear' || event.data === 'skipWaiting') {
    caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))));
  }
});
