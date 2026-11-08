/* Фанты — офлайн-кеш */
const CACHE = 'fant-v1.2.2';
const ASSETS = [
  './', './index.html',
  './css/style.css', './js/data.js', './js/combo-data.js', './js/phrase-data.js', './js/app.js',
  './manifest.webmanifest', './icon.svg', './apple-touch-icon.png',
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
  const url = new URL(e.request.url);
  // Страница (навигация) — всегда СНАЧАЛА СЕТЬ: обновления доезжают сразу,
  // кеш используется только когда интернета нет.
  if (e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }
  // Версионированные ассеты (?v=NNN) — cache-first: новый ?v = новый запрос = сеть
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (e.request.method === 'GET' && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
