/* ═══════════════ SPIN-3: регрессионные тесты отмены колеса ═══════════════
   Запуск: node tests/spin-cancel.test.js
   Минимальный harness без зависимостей — в духе core.test.js: app.js
   (браузерный IIFE) исполняется один раз через require поверх фейковых
   глобалов (DOM, таймеры, rAF). Проверяются окна гонки: reduced-motion
   (250 мс) и отложенный openChoice (700 мс) — уход с экрана, сброс токена
   и повторный запуск не должны открывать чужой экран. */
'use strict';

/* ── Фейковые таймеры: виртуальное время вместо реального ── */
function makeClock() {
  const clock = {
    now: 0, seq: 1, timers: new Map(),
    setTimeout(fn, ms) { const id = clock.seq++; clock.timers.set(id, { fn, due: clock.now + Math.max(0, ms || 0) }); return id; },
    clearTimeout(id) { clock.timers.delete(id); },
    setInterval(fn, ms) {
      const id = clock.seq++;
      clock.timers.set(id, { fn, due: clock.now + Math.max(0, ms || 0), every: Math.max(0, ms || 0) });
      return id;
    },
    clearInterval(id) { clock.timers.delete(id); },
    // прокрутка виртуального времени последовательными rAF-кадрами шагом 16 мс
    // (как repaint браузера): каждый кадр вызывает каждый зарегистрированный
    // callback ровно один раз, затем исполняются таймеры, чей due наступил
    advance(ms) {
      const end = clock.now + ms;
      const FRAME = 16;
      while (clock.now < end) {
        clock.now = Math.min(end, clock.now + FRAME);
        clock.fireRaf();
        for (;;) {
          const due = [...clock.timers.entries()]
            .filter(([, t]) => t.due <= clock.now)
            .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
          if (!due) break;
          const [id, t] = due;
          if (t.every) { t.due = clock.now + t.every; } else { clock.timers.delete(id); }
          t.fn();
        }
      }
    }
  };
  return clock;
}

/* ── Фейковый DOM: постоянный фейк-элемент на каждый селектор ── */
const SCREEN_IDS = ['screen-main', 'screen-players', 'screen-games', 'screen-levels', 'screen-wheel',
  'screen-choice', 'screen-reveal', 'screen-phrase-setup', 'screen-phrase-round', 'screen-phrase-task',
  'screen-phrase-results', 'screen-dm-setup', 'screen-dm-listen', 'screen-dm-draw', 'screen-dm-checks',
  'screen-dm-check', 'screen-dm-results'];

function makeDom(harness) {
  const bySelector = new Map();

  function fakeEl(id = '') {
    const classes = new Set();
    const el = {
      id, dataset: {},
      style: { setProperty() {} },
      attrs: {},
      setAttribute(k, v) { el.attrs[k] = String(v); },
      getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
      removeAttribute(k) { delete el.attrs[k]; },
      hasAttribute(k) { return k in el.attrs; },
      classList: {
        add: (...cs) => cs.forEach(c => classes.add(c)),
        remove: (...cs) => cs.forEach(c => classes.delete(c)),
        contains: c => classes.has(c),
        toggle: (c, force) => {
          const on = force === undefined ? !classes.has(c) : !!force;
          if (on) classes.add(c); else classes.delete(c);
          return on;
        }
      },
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
      appendChild(ch) { return ch; }, removeChild() {}, remove() {}, focus() {}, blur() {},
      querySelector: sel => dom.querySelector(sel),
      querySelectorAll: () => [],
      contains: () => false,
      getBoundingClientRect: () => ({ width: 390, height: 100, left: 0, top: 0, right: 390, bottom: 100 }),
      getAnimations: () => [],
      scrollBy() {}, scrollTo() {},
      offsetWidth: 100, offsetHeight: 100, offsetParent: {},
      scrollWidth: 390, scrollHeight: 100, clientWidth: 390, clientHeight: 100,
      innerHTML: '', textContent: '', value: '', hidden: false, disabled: false
    };
    return el;
  }

  function get(sel) {
    if (!bySelector.has(sel)) bySelector.set(sel, fakeEl(sel.startsWith('#') ? sel.slice(1) : ''));
    return bySelector.get(sel);
  }

  const dom = {
    fakeEl, screens: SCREEN_IDS.map(id => fakeEl(id)),
    activeScreenId: () => (dom.screens.find(s => s.classList.contains('active')) || {}).id || '',
    querySelector(sel) {
      if (sel === '.screen.active') return dom.screens.find(s => s.classList.contains('active')) || null;
      return get(sel);
    },
    querySelectorAll(sel) {
      if (sel === '.screen') return dom.screens;
      return [];
    },
    createElement: () => fakeEl(''),
    addEventListener() {},
    documentElement: fakeEl('html'),
    body: fakeEl('body'),
    visibilityState: 'visible',
    activeElement: fakeEl('')
  };

  // #spinTrack: WAAPI-заглушка, управляемая тестом (finish()/cancel() вручную)
  const track = get('#spinTrack');
  const trackAnimate = (kf, opts) => {
    if (harness.noWAAPI) return undefined;
    let resolve, reject;
    const finished = new Promise((res, rej) => { resolve = res; reject = rej; });
    const anim = {
      finished,
      cancelCalled: false,
      cancel() { anim.cancelCalled = true; reject(new Error('anim.cancel()')); },
      finish() { resolve(); }
    };
    harness.lastAnim = anim;
    return anim;
  };
  Object.defineProperty(trackAnimate, 'length', { value: 2 });   // spin() требует animate.length >= 1
  track.animate = trackAnimate;
  dom.trackAnimate = trackAnimate;   // для восстановления после rAF-теста
  return dom;
}

/* ── Установка фейковых глобалов (один раз на процесс) ── */
const clock = makeClock();
const harness = { lastAnim: null, noWAAPI: false };
const vib = [];
const dom = makeDom(harness);

function defGlobal(name, value) {
  try { Object.defineProperty(globalThis, name, { value, writable: true, configurable: true }); }
  catch { globalThis[name] = value; }
}
defGlobal('window', globalThis);
defGlobal('document', dom);
defGlobal('navigator', { vibrate: p => vib.push(p), wakeLock: { request: async () => ({ release() {}, addEventListener() {} }) } });
defGlobal('localStorage', { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); }, removeItem(k) { this.m.delete(k); }, clear() { this.m.clear(); } });
defGlobal('matchMedia', () => ({ matches: harness.reducedMotion || false, addEventListener() {}, addListener() {} }));
defGlobal('performance', { now: () => clock.now });
defGlobal('setTimeout', (fn, ms) => clock.setTimeout(fn, ms));
defGlobal('clearTimeout', id => clock.clearTimeout(id));
defGlobal('setInterval', (fn, ms) => clock.setInterval(fn, ms));
defGlobal('clearInterval', id => clock.clearInterval(id));
/* ── rAF: одноразовые кадры, как в браузере ──
   callback снимается с очереди ДО вызова; зарегистрированные внутри кадра
   попадают в следующий; cancelAnimationFrame снимает только ещё не
   исполненный callback. */
clock.rafQ = new Map();
clock.rafSeq = 1;
defGlobal('requestAnimationFrame', fn => {
  const id = ++clock.rafSeq;
  clock.rafQ.set(id, fn);
  return id;
});
defGlobal('cancelAnimationFrame', id => { clock.rafQ.delete(id); });
clock.fireRaf = () => {
  const frame = [...clock.rafQ.entries()];   // снимок кадра на начало
  clock.rafQ.clear();                        // callback одноразовый — снят до вызова
  for (const [, fn] of frame) fn(clock.now); // новые rAF исполнится в следующем кадре
};
defGlobal('history', { pushState() {}, replaceState() {}, state: null });
defGlobal('location', { protocol: 'http:', hostname: '127.0.0.1' });
defGlobal('addEventListener', () => {});
defGlobal('__FANT_TEST__', true);      // включает тестовый крюк в app.js

/* app.js исполняется один раз на процесс; изоляция тестов — ручной сброс state */
require('../js/lang.js');
require('../js/data.js');
require('../js/combo-data.js');
require('../js/phrase-data.js');
require('../js/app.js');

const api = globalThis.__FANT_TEST_API__;
if (!api) throw new Error('тестовый крюк __FANT_TEST_API__ не выставился');

/* ── Мини-раннер в духе остальных тестов проекта ── */
let n = 0, fails = 0;
function ok(cond, label) { n++; if (!cond) { fails++; console.error('FAIL  ' + label); } }
function eq(actual, expected, label) {
  n++;
  if (actual !== expected) { fails++; console.error(`FAIL  ${label}\n      получилось: ${JSON.stringify(actual)}\n      ожидалось:  ${JSON.stringify(expected)}`); }
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const finishedVib = v => v.filter(x => Array.isArray(x) && x.length === 3 && x[0] === 60 && x[1] === 60 && x[2] === 140);

function resetState() {
  const s = api.state;
  s.players = ['Аня', 'Боря'];
  s.remaining = [];
  s.recent = [];
  s.spinning = false;
  s.spinAnim = null; s.spinRaf = null; s.spinTicks = null;
  s.spinRmTimer = null; s.spinChoiceTimer = null;
  harness.reducedMotion = false;
  harness.lastAnim = null;
  vib.length = 0;                                        // счётчики вибрации — на тест
  dom.querySelector('#choiceName').textContent = '';     // DOM-фейки живут между тестами
  dom.querySelector('#spinTrack').animate = dom.trackAnimate;   // после rAF-теста
  clock.rafQ.clear();                                    // кадры не перетекают между тестами
}

/* ── 0. Самопроверка harness: rAF одноразовый, вложенный — со следующего кадра ── */
function testRafMockOneShot() {
  resetState();
  let calls = 0, nestedCalls = 0;
  requestAnimationFrame(() => { calls++; requestAnimationFrame(() => { nestedCalls++; }); });
  clock.fireRaf();                          // первый кадр: callback снят с очереди и вызван
  eq(calls, 1, 'raf-mock: callback вызван ровно один раз');
  eq(nestedCalls, 0, 'raf-mock: вложенный rAF не исполнился в том же кадре');
  clock.fireRaf();                          // без новой внешней регистрации — вложенный из прошлого кадра
  eq(calls, 1, 'raf-mock: без новой регистрации callback не повторяется');
  eq(nestedCalls, 1, 'raf-mock: вложенный rAF исполнился на следующем кадре');
  clock.fireRaf();                          // ещё кадр — больше ничего не зарегистрировано
  eq(calls, 1, 'raf-mock: очередь пуста — вызовов больше нет');
  eq(nestedCalls, 1, 'raf-mock: очередь пуста — вложенных вызовов больше нет');
  const id = requestAnimationFrame(() => { calls++; });
  cancelAnimationFrame(id);
  clock.fireRaf();
  eq(calls, 1, 'raf-mock: cancelAnimationFrame снял не исполненный callback');
  // покадровый advance: не исполненный дважды callback не задваивается
  let adv = 0;
  requestAnimationFrame(() => { adv++; });
  clock.advance(50);                        // ~3 кадра по 16 мс
  eq(adv, 1, 'raf-mock: advance вызвал callback один раз на все кадры');
}

/* ── 1. Reduced motion: уход до истечения 250 мс — finishSpin не вызывается ── */
function testReducedMotionLeaveBefore250() {
  resetState();
  harness.reducedMotion = true;
  api.spin();
  ok(api.state.spinRmTimer !== null, 'RM-leave: таймер 250 мс поставлен и сохранён в state');
  ok(api.state.spinning === true, 'RM-leave: spinning выставлен');
  clock.advance(100);                       // внутри окна 250 мс
  api.showScreen('screen-levels');          // уход с экрана колеса
  eq(api.state.spinRmTimer, null, 'RM-leave: уход обнулил spinRmTimer через cancelSpin');
  clock.advance(2000);                      // окно давно истекло
  eq(finishedVib(vib).length, 0, 'RM-leave: finishSpin не вызывался (нет вибрации победителя)');
  eq(dom.querySelector('#choiceName').textContent, '', 'RM-leave: экран выбора не открылся');
  eq(dom.activeScreenId(), 'screen-levels', 'RM-leave: активный экран — тот, куда ушли');
  eq(api.state.spinning, false, 'RM-leave: spinning сброшен уходом');
}

/* ── 2. Reduced motion: штатное завершение — выбор открыт ровно один раз ── */
function testReducedMotionSuccess() {
  resetState();
  harness.reducedMotion = true;
  api.spin();
  clock.advance(250);                       // finishSpin по таймеру
  eq(finishedVib(vib).length, 1, 'RM-success: finishSpin отработал один раз');
  eq(api.state.spinRmTimer, null, 'RM-success: сработавший таймер снят с учёта');
  clock.advance(699);                       // внутри окна 700 мс выбора ещё нет
  eq(dom.querySelector('#choiceName').textContent, '', 'RM-success: до 700 мс выбор не открыт');
  clock.advance(1);                         // окно openChoice истекло
  const name = dom.querySelector('#choiceName').textContent;
  ok(name === 'Аня' || name === 'Боря', 'RM-success: openChoice получил победителя из колеса');
  eq(dom.activeScreenId(), 'screen-choice', 'RM-success: активен экран выбора');
  eq(api.state.spinChoiceTimer, null, 'RM-success: таймер выбора снят с учёта');
  eq(api.state.spinning, false, 'RM-success: spinning сброшен');
  clock.advance(5000);                      // никаких повторов
  eq(dom.querySelector('#choiceName').textContent, name, 'RM-success: имя не перезаписывалось');
  eq(finishedVib(vib).length, 1, 'RM-success: finishSpin не задвоился');
}

/* ── 3. WAAPI → окно 700 мс: уход после анимации отменяет отложенный openChoice ── */
async function testWaapiChoiceWindowLeave() {
  resetState();
  api.state.sound = true;
  api.spin();
  const anim = harness.lastAnim;
  ok(anim, 'WAAPI-700: анимация создана');
  ok(api.state.spinTicks && api.state.spinTicks.length > 0, 'WAAPI-700: щелчки запланированы');
  clock.advance(2000);                      // анимация «идёт» — finished ещё не разрешён
  anim.finish(); await flush();             // браузер завершил анимацию → finishSpin → окно 700 мс
  eq(finishedVib(vib).length, 1, 'WAAPI-700: finishSpin после anim.finished');
  ok(api.state.spinChoiceTimer !== null, 'WAAPI-700: таймер 700 мс сохранён в state');
  clock.advance(300);                       // внутри окна 700 мс
  api.showScreen('screen-players');         // уход с колеса
  eq(api.state.spinChoiceTimer, null, 'WAAPI-700: уход обнулил spinChoiceTimer');
  ok(anim.cancelCalled, 'WAAPI-700: держащая анимация отменена (dropSpinAnim)');
  eq(api.state.spinAnim, null, 'WAAPI-700: ссылка на анимацию снята');
  clock.advance(2000);
  eq(dom.querySelector('#choiceName').textContent, '', 'WAAPI-700: openChoice не сработал после ухода');
  eq(dom.activeScreenId(), 'screen-players', 'WAAPI-700: активный экран — не выбор');
  eq(api.state.spinning, false, 'WAAPI-700: spinning сброшен');
}

/* ── 4. Отмена посреди WAAPI + повторный запуск: старые колбэки не мешают ── */
async function testCancelMidFlightThenRespin() {
  resetState();
  api.spin();
  const anim1 = harness.lastAnim;
  clock.advance(300);                       // середина анимации
  api.showScreen('screen-levels');          // отмена
  ok(anim1.cancelCalled, 'mid-WAAPI: анимация отменена');
  eq(api.state.spinAnim, null, 'mid-WAAPI: spinAnim сброшен');
  eq(api.state.spinTicks, null, 'mid-WAAPI: щелчки погашены');
  eq(finishedVib(vib).length, 0, 'mid-WAAPI: finishSpin не вызывался');
  api.spin();                               // новый запуск
  const anim2 = harness.lastAnim;
  ok(anim2 && !anim2.cancelCalled, 'mid-WAAPI: повторная прокрутка создала новую анимацию');
  clock.advance(2000);
  anim2.finish(); await flush();
  clock.advance(700);
  eq(finishedVib(vib).length, 1, 'mid-WAAPI: финал ровно один — старый колбэк не задвоил');
  ok(dom.querySelector('#choiceName').textContent !== '', 'mid-WAAPI: выбор открыт для новой прокрутки');
}

/* ── 5. Отмена посреди rAF-fallback + повторный запуск ── */
function testCancelMidFlightRaf() {
  resetState();
  dom.querySelector('#spinTrack').animate = undefined;   // выключаем WAAPI — проверяем rAF-путь
  api.spin();
  eq(api.state.spinAnim, null, 'rAF: WAAPI-путь не используется');
  ok(api.state.spinRaf !== null, 'rAF: кадр зарегистрирован');
  clock.advance(600);                       // середина
  api.showScreen('screen-games');
  eq(api.state.spinRaf, null, 'rAF: кадр отменён');
  eq(finishedVib(vib).length, 0, 'rAF: finishSpin не вызывался');
  api.spin();                               // повторный запуск на rAF-пути
  ok(api.state.spinRaf !== null, 'rAF: новый кадр зарегистрирован');
  clock.advance(6000);                      // t >= 1 → finishSpin по завершению кадров
  eq(finishedVib(vib).length, 1, 'rAF: повторная прокрутка завершилась ровно один раз');
  clock.advance(700);
  ok(dom.querySelector('#choiceName').textContent !== '', 'rAF: выбор открыт');
  eq(dom.activeScreenId(), 'screen-choice', 'rAF: активен экран выбора');
}

/* ── 6. Токен-гвардия: устаревший колбэк 700 мс не открывает выбор.
      Изолированно проверяем проверку токена внутри колбэка (без cancelSpin) ── */
async function testTokenGuardOnStaleChoiceTimer() {
  resetState();
  api.spin();
  clock.advance(2000);
  const anim = api.state.spinAnim;
  anim.finish(); await flush();             // finishSpin → окно 700 мс поставлено
  api.state.spinToken += 1;                 // внешний сброс токена (как блиц), без cancelSpin
  clock.advance(1000);
  eq(dom.querySelector('#choiceName').textContent, '', 'token-guard: устаревший колбэк не открыл выбор');
  eq(api.state.spinChoiceTimer, null, 'token-guard: колбэк снял таймер с учёта');
  eq(finishedVib(vib).length, 1, 'token-guard: finishSpin не задвоился');
  api.state.spinning = false;               // в реальных путях сброс токена идёт парой с cancelSpin
}

(async () => {
  testRafMockOneShot();
  testReducedMotionLeaveBefore250();
  testReducedMotionSuccess();
  await testWaapiChoiceWindowLeave();
  await testCancelMidFlightThenRespin();
  testCancelMidFlightRaf();
  await testTokenGuardOnStaleChoiceTimer();
  console.log(`\nSPIN-3: ${n} проверок, провалов: ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
