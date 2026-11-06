/* Фанты — офлайн-кеш */
const CACHE = 'fant-v5';
const ASSETS = [
  './', './index.html',
  './css/style.css', './js/data.js', './js/app.js',
  './manifest.webmanifest', './icon.svg',
  './fonts/montserrat-500-cyrillic.woff2', './fonts/montserrat-500-latin.woff2',
  './fonts/montserrat-700-cyrillic.woff2', './fonts/montserrat-700-latin.woff2',
  './fonts/montserrat-800-cyrillic.woff2', './fonts/montserrat-800-latin.woff2'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (e.request.method === 'GET' && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
