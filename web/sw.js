// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Service worker: the app shell comes from the cache (precached per version), the library's
// metadata (manifest, file index, catalog, colours) from the network with the cached copy as
// fallback. Library chunks are not handled here: library.mjs caches the files it reads and,
// on request, the whole library.

const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const SHELL_CACHE = `ldraw-stl-shell-${VERSION}`;
const META_CACHE = 'ldraw-stl-meta';
const scope = new URL(self.registration.scope);

const META = ['library/manifest.json', 'library/files.json', 'library/catalog.json', 'library/colours.json'];

// The library metadata is cached at install too: the first visit is not yet controlled by the
// worker, and the app must still start offline afterwards.
self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all([
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)),
    caches.open(META_CACHE).then((cache) => cache.addAll(META)),
  ]));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('ldraw-stl-shell-') && name !== SHELL_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function networkFirst(request) {
  const cache = await caches.open(META_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && cacheName === META_CACHE) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const rel = url.pathname.slice(scope.pathname.length);
  if (rel.startsWith('library/')) {
    if (rel.endsWith('.json')) event.respondWith(networkFirst(request));
    else if (rel.endsWith('.txt')) event.respondWith(cacheFirst(request, META_CACHE));
    return; // chunks: straight to the network (range requests)
  }
  if (request.mode === 'navigate' && (rel === '' || rel === 'index.html')) {
    event.respondWith(caches.open(SHELL_CACHE).then((c) => c.match('index.html')).then((r) => r ?? fetch(request)));
    return;
  }
  event.respondWith(cacheFirst(request, SHELL_CACHE));
});
