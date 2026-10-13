// Browsered's service worker: the editor keeps working offline.
// Network first, so a new version is used as soon as it is published;
// the cached copy answers when there is no connection.
const CACHE = "browsered-v1";
const FILES = ["./", "manifest.webmanifest", "init.scm",
               "icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(names =>
    Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, {ignoreSearch: true})));
});
