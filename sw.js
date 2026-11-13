/* Фанты — офлайн-кеш */
// Единая точка версии для ассетов: должна совпадать с ?v= в index.html и текстом main-ver.
// (сборки нет, поэтому константа одна на файл — при бампе правятся только эти три места)
const VERSION = '1.8.1';
const CACHE = 'fant-v' + VERSION;
// предзакеш идёт с тем же ?v=, что и запросы из index.html:
// caches.match сравнивает URL вместе с query — без версии ассет не найдётся
const withV = u => (u.endsWith('/') || u.endsWith('.html') ? u : u + '?v=' + VERSION);
// ядро: без него офлайн невозможен — addAll атомарен, эти файлы обязаны существовать
const CORE = [
  './', './index.html',
  './css/style.css', './css/desktop.css', './css/spy.css', './js/lang.js', './js/data.js', './js/combo-data.js', './js/phrase-data.js',
  './js/draw-memory-data.js', './js/draw-memory-core.js', './js/spy-data.js', './js/spy-core.js', './js/app.js'
].map(withV);
// остальное (иконки, шрифты): один 404 не должен ломать установку SW целиком
const EXTRA = [
  './manifest.webmanifest', './icon.svg', './apple-touch-icon.png', './icon-192.png', './icon-512.png',
  './fonts/montserrat-500-cyrillic.woff2', './fonts/montserrat-500-latin.woff2',
  './fonts/montserrat-700-cyrillic.woff2', './fonts/montserrat-700-latin.woff2',
  './fonts/montserrat-800-cyrillic.woff2', './fonts/montserrat-800-latin.woff2'
].map(withV);

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      await c.addAll(CORE);                                  // атомарно: ядро — всё или ничего
      await Promise.allSettled(EXTRA.map(u => c.add(u)));    // отсутствие иконки/шрифта не фатально
    }).then(() => self.skipWaiting())
  );
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
  // не-GET запросы SW не перехватывает — кешировать их нельзя
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Версионированные ассеты (?v=NNN) — cache-first: новый ?v = новый запрос = сеть.
  // В кеш кладём только успешные same-origin ответы: один 404 не должен
  // закешироваться навсегда (cache-first уже никогда не спросит сеть)
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
