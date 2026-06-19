const CACHE_NAME = 'logixa-pharmacy-static-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Deliberately do not intercept Next.js HTML, CSS or JS. A previous
// precaching worker could combine files from different deployments.
