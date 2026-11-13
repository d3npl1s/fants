/* ═══════════════ SPY-UI: smoke-проверки интеграции режима «Шпион» ═══════════════
   Запуск: node tests/spy-ui-smoke.test.js
   Статическая проверка точки интеграции, без DOM и зависимостей: порядок
   подключения css/js в index.html, отдельная ветка data-play === 'spy'
   (не общий else «Продолжи фразу»), карточка и иконка в карусели игр,
   экраны .screen-spy-*, записи в CORE sw.js, префиксы селекторов css/spy.css,
   очистка секретной карточки и нетронутая версия. */
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
const sw = read('sw.js');
const css = read('css/spy.css');

/* 1. Подключение стилей: spy.css последним из стилей */
const styleIdx = html.indexOf('css/style.css?v=');
const desktopIdx = html.indexOf('css/desktop.css?v=');
const spyCssIdx = html.indexOf('css/spy.css?v=');
ok(styleIdx >= 0 && desktopIdx > styleIdx && spyCssIdx > desktopIdx,
   'spy.css подключён в index.html после css/style.css и css/desktop.css');

/* 2. Скрипты: spy-data.js и spy-core.js до app.js */
const dataIdx = html.indexOf('js/spy-data.js?v=');
const coreIdx = html.indexOf('js/spy-core.js?v=');
const appIdx = html.indexOf('js/app.js?v=');
ok(dataIdx > 0 && coreIdx > dataIdx && appIdx > coreIdx,
   'spy-data.js и spy-core.js подключены до app.js');

/* 3. Экраны режима присутствуют в разметке */
['screen-spy-setup', 'screen-spy-reveal', 'screen-spy-draw', 'screen-spy-discussion',
 'screen-spy-vote', 'screen-spy-vote-result', 'screen-spy-guess', 'screen-spy-final']
  .forEach(id => ok(html.includes(`id="${id}"`), `экран ${id} есть в index.html`));

/* 4. app.js: карточка в GAMES, иконка в GAME_ICONS, отдельная ветка data-play */
ok(/id:\s*'spy',\s*name:\s*'Шпион'/.test(app), 'GAMES содержит карточку «Шпион»');
ok(/spy:\s*`<svg class="game-icon"/.test(app), 'GAME_ICONS содержит svg-иконку шпиона');
ok(/else if \(b\.dataset\.play === 'spy'\)\s*\{\s*spyEnter\(\);\s*\}/.test(app),
   'обработчик data-play === "spy" — отдельная ветка else if');
ok(!/else\s*\{[^}]*renderModeChips\(\)[^}]*\}[^\n]*spyEnter/.test(app),
   'spyEnter не попал в общий else «Продолжи фразу»');

/* 5. Активные экраны шпиона в GAME_SCREENS (wake lock) */
['screen-spy-reveal', 'screen-spy-draw', 'screen-spy-discussion',
 'screen-spy-vote', 'screen-spy-vote-result', 'screen-spy-final']
  .forEach(id => ok(app.includes(`'${id}'`), `GAME_SCREENS включает ${id}`));

/* 6. Навигация: системный «Назад» различает шпиона и сбрасывает партию наружу */
ok(app.includes("startsWith('screen-spy-')"), 'popstate различает экраны шпиона');
ok(app.includes('function spyAbandonIfUnfinished') && app.includes('spyAbandonIfUnfinished()'),
   'выход из режима сбрасывает незавершённую партию');
ok(app.includes('function spyClearCard') && app.includes("'#spyCardWord', '#spyCardCat', '#spyCardNote']"),
   'секретная карточка очищается из DOM при скрытии');
ok(app.includes("'#spyCardRole', "), 'роль тоже входит в очистку карточки');

/* 7. Попытка шпиона доступна на всех активных фазах */
['screen-spy-draw', 'screen-spy-discussion', 'screen-spy-vote', 'screen-spy-vote-result']
  .forEach(s => ok(new RegExp(`spyOpenGuess\\('${s}'\\)`).test(app),
     `кнопка «Шпион назвал слово» открывает попытку с ${s}`));

/* 8. sw.js: новые файлы в CORE */
['./css/spy.css', './js/spy-data.js', './js/spy-core.js'].forEach(f => {
  const lit = f.replace(/\./g, '\\.');
  ok(new RegExp(`CORE\\s*=\\s*[\\s\\S]*?${lit}`).test(sw), `${f} в CORE sw.js`);
});

/* 9. css/spy.css: все селекторы с префиксом .spy-/.screen-spy-
   (одно задокументированное исключение — палитра карточки в общей карусели) */
const ALLOWED = /^\.game-card\[data-game="spy"\]$/;
const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '{');
const selectorMatches = [...body.matchAll(/(^|\})\s*([^{}@]+?)\{/g)];
const bad = [];
for (const m of selectorMatches) {
  for (const raw of m[2].split(',')) {
    const s = raw.trim();
    if (!s || ALLOWED.test(s)) continue;
    if (!/^\.spy[\w-]/.test(s) && !/^\.screen-spy/.test(s)) bad.push(s);
  }
}
ok(bad.length === 0, 'все селекторы spy.css с префиксом .spy-/.screen-spy-; нарушители: ' + bad.join(' | '));

/* 10. Версия не тронута (бамп делает менеджер единым коммитом) */
ok(/const VERSION = '1\.7\.1';/.test(sw), 'sw.js: VERSION не менялся');
ok(!html.includes('?v=1.8') && html.includes('?v=1.7.1'), 'index.html: ?v= не поднимался');

console.log('SPY-UI smoke: ' + n + ' проверок пройдено');
