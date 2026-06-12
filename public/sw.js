// DropStream service worker — caches the app shell for offline launch and an
// installable PWA. It deliberately never touches /api/* (TURN credentials and
// the signaling WebSocket must always hit the network) or non-GET requests.

const CACHE = "dropstream-v3";
const SHELL = [
  "/",
  "/app.js",
  "/sha256.js",
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

  // Network-first: always serve the freshest code when online (so updates show
  // up immediately), and refresh the cache as we go. Fall back to the cache —
  // and to the cached app shell for navigations — only when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        if (request.mode === "navigate") {
          return caches.match("/");
        }
        return Response.error();
      })
  );
});
