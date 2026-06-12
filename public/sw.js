// DropStream service worker — caches the app shell for offline launch and an
// installable PWA. It deliberately never touches /api/* (TURN credentials and
// the signaling WebSocket must always hit the network) or non-GET requests.

const CACHE = "dropstream-v1";
const SHELL = [
  "/",
  "/app.js",
  "/styles.css",
  "/manifest.webmanifest",
  "/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GETs; let API calls and everything else pass through.
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  // App-shell navigations (including /<room-code> deep links): serve cached "/"
  // so the app opens offline, falling back to the network when not cached.
  if (request.mode === "navigate") {
    event.respondWith(caches.match("/").then((cached) => cached || fetch(request)));
    return;
  }

  // Static assets: cache-first, then populate the cache on first network hit.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
