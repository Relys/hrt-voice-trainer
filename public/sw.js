// Both replaced with real values by scripts/inject-precache.mjs after `vite build` — left as
// fallbacks here so `npm run dev` (which never runs that script, and never registers this file
// at all — see the PROD gate in main.ts) still has valid syntax to parse. The version is a hash
// of this build's actual output files, so every deploy that changes anything gets a distinct
// cache name — activate() below then deletes the previous (now-differently-named) cache instead
// of leaving its stale, no-longer-referenced entries (old hashed filenames) to accumulate forever.
const CACHE_NAME = "hrt-voice-trainer-" + (self.__CACHE_VERSION__ || "dev");
const PRECACHE_URLS = self.__PRECACHE_URLS__ || [];

// Precache the actual app shell on install so a install-then-immediately-offline session works
// on the very first run, rather than depending on a second successful online visit to have
// warmed the cache via the fetch handler below.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Network-first with cache fallback for everything else: keeps the precached app shell above
// fresh on every successful load, and covers any other same-origin GET the app makes.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error())),
  );
});
