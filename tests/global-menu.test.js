/* ═══════════════ MENU-UX: общее меню, контекстные пункты и «Главное меню» ═══════════════
   Запуск: node tests/global-menu.test.js
   Статические проверки без DOM (в духе spy-ui-smoke): глобальные пункты меню
   есть во всех режимах; Fants-only пункты скрыты в «Шпионе», «Продолжи фразу»
   и Draw Memory (явная карта screen id → режим, без эвристики по тексту);
   статистика каждого режима остаётся доступной из своего режима; «Главное меню»
   ведёт на screen-main, «К выбору игры» — на screen-games; незавершённая партия
   «Шпиона» требует подтверждение и не теряется при отказе; звук/игроки/настройки
   не сбрасываются переходом на главный экран; точки .dots-btn — 4px при
   touch-target ≥44px. */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let n = 0;
const ok = (cond, msg) => {
  n++;
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
};

const html = read('index.html');
const app = read('js/app.js');
const style = read('css/style.css');
const sw = read('sw.js');

/* фрагмент исходника между маркерами — для проверок внутри конкретного блока */
const between = (src, startMarker, endMarker) => {
  const a = src.indexOf(startMarker);
  ok(a >= 0, 'найден маркер начала: ' + startMarker);
  const b = endMarker ? src.indexOf(endMarker, a + startMarker.length) : -1;
  return b >= 0 ? src.slice(a, b) : src.slice(a);
};

/* ── 1. Разметка меню: глобальные пункты без скоупа ──
   Игроки, Звук, К выбору игры, Главное меню, Закрыть — доступны из любого режима */
['setPlayersBtn', 'setSoundBtn', 'setGamesBtn', 'setMainMenuBtn'].forEach(id => {
  ok(new RegExp('<button class="set-row set-btn" id="' + id + '">').test(html),
     `глобальный пункт ${id} без data-settings-scope (виден во всех режимах)`);
});
ok(/<button class="modal-close" id="settingsCloseBtn">Закрыть<\/button>/.test(html),
   'кнопка «Закрыть» на месте и без скоупа');

/* ── 2. Fants-only пункты помечены скоупом «fants» ── */
[['setTtsBtn', 'Озвучка заданий'], ['setUnbanBtn', 'Вернуть убранные задания'],
 ['setChosenResetBtn', 'Сбросить историю выпавших'], ['setStatsBtn', 'Статистика фантов']]
  .forEach(([id]) => {
    ok(new RegExp('id="' + id + '" data-settings-scope="fants"').test(html),
       `${id} — только в режиме «Фанты»`);
  });
ok(/data-settings-scope="fants phrase">\s*<label for="punishInput">Наказание за провал<\/label>/.test(html),
   '«Наказание за провал» — в Фантах и Продолжи фразу, скрыт в Draw Memory и Шпионе');

/* все скоупы в разметке — известные режимы */
const scopeRe = /data-settings-scope="([^"]+)"/g;
[...html.matchAll(scopeRe)].forEach(m => {
  m[1].split(/\s+/).forEach(t =>
    ok(['fants', 'phrase', 'dm', 'spy'].includes(t), `скоуп «${m[1]}» состоит из известных режимов`));
});

/* ── 3. Явная карта screen id → режим покрывает все экраны ── */
const ctxBlock = between(app, 'MENU-CTX: контекстные пункты меню', 'function openSettings');
const mapKeys = new Set([...ctxBlock.matchAll(/'(screen-[\w-]+)':\s*'(\w+)'/g)].map(m => m[1]));
const GLOBAL_SCREENS = ['screen-main', 'screen-players', 'screen-games'];
const screenIds = [...html.matchAll(/id="(screen-[\w-]+)"/g)].map(m => m[1]);
ok(screenIds.length >= 21, 'в index.html найдены экраны: ' + screenIds.length);
screenIds.forEach(id => {
  if (GLOBAL_SCREENS.includes(id)) {
    ok(!mapKeys.has(id), `${id} — общий экран, режимных пунктов в меню не получает`);
  } else {
    ok(mapKeys.has(id), `экран ${id} явно сопоставлен режиму в SCREEN_SETTINGS_MODE`);
  }
});
['fants', 'phrase', 'dm', 'spy'].forEach(mode =>
  ok([...ctxBlock.matchAll(/'(screen-[\w-]+)':\s*'(\w+)'/g)].some(m => m[2] === mode),
     `карта содержит режим ${mode}`));

/* сопоставление — по id экрана, не по тексту: нет поиска «Шпион»/«фраз» в контексте */
ok(!/includes\('Шпион'\)|indexOf\('Шпион'\)|textContent/.test(ctxBlock),
   'applySettingsContext не использует эвристику по тексту экрана');

/* ── 4. Контекст применяется при открытии меню; скрытые пункты исключаются из фокуса ── */
ok(/function openSettings\(\)\s*\{[^}]*applySettingsContext\(\);/.test(app),
   'openSettings вызывает applySettingsContext');
ok(/querySelectorAll\('#settingsModal \[data-settings-scope\]'\)/.test(ctxBlock) &&
   ctxBlock.includes("classList.toggle('hidden'"),
   'режимные пункты скрываются классом hidden (DOM не удаляется)');
ok(/classList\.toggle\('hidden', act === 'screen-main'\)/.test(ctxBlock),
   'на главном экране пункт «Главное меню» скрывается');
ok(app.includes('el.offsetParent !== null'),
   'focus-trap модалки не фокусирует скрытые пункты (фильтр offsetParent)');

/* ── 5. Статистика каждого режима остаётся доступной из своего режима ── */
ok(html.includes('id="statsWheelBtn"') &&
   app.includes("$('#statsWheelBtn').addEventListener('click', () => renderStats('Статистика фантов'))"),
   'у Фантов своя кнопка статистики на экране колеса');
ok(html.includes('id="phraseStatsBtn"') && html.includes('id="phraseStatsBtn2"') &&
   app.includes("$('#phraseStatsBtn').addEventListener('click', renderPhStats)") &&
   app.includes("$('#phraseStatsBtn2').addEventListener('click', renderPhStats)") &&
   app.includes("renderStats('Средние оценки', 'phrase')"),
   'у Продолжи фразы свои входы в средние оценки');
ok(html.includes('id="dmScoresLine"') && app.includes('dmRenderChecks()'),
   'Draw Memory показывает баллы на своих экранах');
/* синхронизация наказания с настройками фразы не сломана */
ok(app.includes('const syncPunishInputs = () => {') &&
   app.includes('if (pi) pi.value = state.punish;') &&
   app.includes('if (pp) pp.value = state.punish;'),
   'syncPunishInputs по-прежнему пишёт в оба инпута');
ok(app.includes("$('#phrasePunishInput').addEventListener('input'") &&
   app.includes('const pi = $(\'#punishInput\'); if (pi) pi.value = state.punish;'),
   'ввод в phrasePunishInput по-прежнему синхронен глобальному punishInput');

/* ── 6. «Главное меню» и «К выбору игры» ── */
ok(/<button class="set-row set-btn" id="setMainMenuBtn">\s*<span>Главное меню<\/span>/.test(html),
   'в меню есть кнопка «Главное меню»');
ok(html.indexOf('id="setMainMenuBtn"') < html.indexOf('id="settingsCloseBtn"'),
   '«Главное меню» внутри карточки настроек, до «Закрыть»');

const menuBlock = between(app, 'MENU-HOME/MENU-EXIT: единый безопасный выход', 'FEAT-1');
const mmHandler = between(menuBlock, "$('#setMainMenuBtn').addEventListener('click'", '');
ok(mmHandler.includes("exitViaMenu('screen-main', 'в главное меню')"),
   '«Главное меню» идёт через общий безопасный маршрут и ведёт на screen-main');
const gamesHandler = between(menuBlock, "$('#setGamesBtn').addEventListener('click'", '');
ok(gamesHandler.includes("exitViaMenu('screen-games', 'к выбору игры')"),
   '«К выбору игры» идёт через тот же маршрут и ведёт на screen-games (не подменён главным меню)');
const exitFn = between(menuBlock, 'function exitViaMenu', "$('#setMainMenuBtn')");
ok(exitFn.includes('if (!confirmExitActiveMode(whereLabel)) return;') &&
   exitFn.indexOf('confirmExitActiveMode') < exitFn.indexOf("closeModal('#settingsModal')") &&
   exitFn.indexOf("closeModal('#settingsModal')") < exitFn.indexOf('stopActiveEngines()') &&
   exitFn.indexOf('stopActiveEngines()') < exitFn.indexOf('showScreen(targetId)'),
   'единый маршрут: подтверждение → закрыть меню → остановить движки → целевой экран');
ok(app.split("$('#setGamesBtn').addEventListener").length - 1 === 1 &&
   !app.includes("addEventListener('click', spyAbandonIfUnfinished)"),
   'у «К выбору игры» ровно один обработчик — безусловный сброс партии удалён');

/* ── 7. Незавершённая партия «Шпиона»/круг «Фразы»: подтверждение, при отказе всё цело ── */
const confirmExit = between(menuBlock, 'function confirmExitActiveMode', 'function stopActiveEngines');
ok(confirmExit.includes("startsWith('screen-spy-')") &&
   confirmExit.includes('spy.game && spy.game.phase'),
   'подтверждение только для незавершённой партии «Шпиона» на его экранах');
const spyConfirmIdx = confirmExit.indexOf('Незавершённая партия «Шпиона» будет потеряна');
const spyNullIdx = confirmExit.indexOf('spy.game = null');
ok(spyConfirmIdx >= 0 && spyNullIdx > spyConfirmIdx,
   'партия сбрасывается только ПОСЛЕ согласия на подтверждении');
ok(confirmExit.includes("return false;") &&
   confirmExit.indexOf('return false;') < spyNullIdx,
   'при отказе — ранний выход, партия «Шпиона» не теряется');
ok(confirmExit.includes('Прогресс круга пропадёт'),
   'незавершённый круг «Продолжи фразу» предупреждает о потере прогресса');

/* ── 8. Движки остановлены, данные не тронуты ── */
const stopEngines = between(menuBlock, 'function stopActiveEngines', 'function exitViaMenu');
['cancelSpin()', 'stopTaskTimer()', 'stopSpeak()', 'clearTimeout(phrase.pairTimer)', 'dmStopEngine()']
  .forEach(fn => ok(stopEngines.includes(fn), `stopActiveEngines вызывает ${fn}`));
ok(stopEngines.includes('drawLeft') && stopEngines.includes('drawEndsAt') &&
   !stopEngines.includes('dm.round = null') && stopEngines.includes('dmSave()'),
   'Draw Memory: таймер дорисовки сохраняется, раунд не уничтожается');

const menuAll = menuBlock;
['store.set(', 'state.players =', 'state.sound', 'state.tts', 'state.punish',
 'resetRounds', 'state.chosen =', 'state.stats =', 'state.genders =', 'spyMode']
  .forEach(bad => ok(!menuAll.includes(bad), `переход на главный экран не трогает «${bad}»`));
ok(!/showScreen\('screen-(players|games|levels|wheel)'\)/.test(menuAll),
   '«Главное меню» ведёт ровно на screen-main и никуда больше');

/* ── 9. Точки .dots-btn: визуально 4px, touch-target не тронут ── */
ok(/\.dots-btn\s*\{[^}]*width:\s*44px; height:\s*52px/.test(style),
   '.dots-btn: кликабельная область осталась 44×52');
ok(/\.dots-btn span\s*\{[^}]*width:\s*4px; height:\s*4px/.test(style),
   'визуальные точки уменьшены до 4px');
ok(/\.dots-btn span\s*\{[^}]*margin:\s*2px 0/.test(style),
   'вертикальный интервал точек сокращён (2px против 2.5px)');
ok(/\.topbar\s*\{[^}]*safe-area-inset-top/.test(style),
   'верхний бар не сдвинут относительно safe-area');

/* ── 10. Версия согласована (интегратор бампает одним релизным коммитом) ── */
const ver = (sw.match(/const VERSION = '([\d.]+)';/) || [])[1];
ok(ver === '1.8.1', 'sw.js: VERSION 1.8.1');
ok(html.includes('?v=' + ver) && html.includes('версия 1.8.1'),
   'index.html: ?v= и main-ver совпадают с VERSION');

console.log('Global menu: ' + n + ' проверок пройдено');
