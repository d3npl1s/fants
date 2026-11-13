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
const core = read('js/spy-core.js');

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
 'screen-spy-vote', 'screen-spy-vote-result', 'screen-spy-final', 'screen-spy-guess']
  .forEach(id => ok(app.includes(`'${id}'`), `GAME_SCREENS включает ${id}`));

/* 6. Навигация: системный «Назад» различает шпиона и сбрасывает партию наружу */
ok(app.includes("startsWith('screen-spy-')"), 'popstate различает экраны шпиона');
ok(app.includes('function spyAbandonIfUnfinished') && app.includes('spyAbandonIfUnfinished()'),
   'выход из режима сбрасывает незавершённую партию');
ok(app.includes('function spyClearCard') && app.includes("'#spyCardWord', '#spyCardCat', '#spyCardNote']"),
   'секретная карточка очищается из DOM при скрытии');
ok(app.includes("'#spyCardRole', "), 'роль тоже входит в очистку карточки');

/* 7. Попытка шпиона: коллективный вердикт (SPYGUESS, решение владельца).
   Старая форма (выбор имени + ручной ввод слова) удалена; UI только вызывает
   SPYC.resolveSpyGuess(g, true/false) и показывает финал по result из ядра. */
ok(/function spyOpenGuess\(\)/.test(app),
   'spyOpenGuess без аргументов — открывает экран вердикта, а не форму ввода');
ok(/spyOpenGuess\(\)\s*\{[^}]*g\.phase === 'finished' \|\| g\.phase === 'reveal'\) return;/.test(app),
   'попытка недоступна в reveal и после завершения партии');
['spyGuessBtn1', 'spyGuessBtn2', 'spyGuessBtn3', 'spyGuessBtn4'].forEach(btn =>
  ok(app.includes(`$('#${btn}').addEventListener('click', spyOpenGuess)`),
     `${btn} (активная фаза) ведёт на экран вердикта`));

/* 7a. Экран вердикта: заголовок, пояснение, две кнопки, вызовы ядра */
const verdictTitle = (html.match(/<h2[^>]*id="spyGuessTitle"[^>]*>([^<]*)<\/h2>/) || [])[1];
ok(verdictTitle === 'Шпион назвал слово!', 'заголовок экрана попытки — «Шпион назвал слово!»');
const verdictNote = (html.match(/id="spyGuessNote"[^>]*>([^<]*)<\/p>/) || [])[1];
ok(verdictNote === 'Остальные решают, верно ли он назвал слово.',
   'пояснение экрана попытки — «Остальные решают, верно ли он назвал слово.»');
const yesLabel = (html.match(/<button[^>]*id="spyGuessCorrectBtn"[^>]*>([^<]*)<\/button>/) || [])[1];
const noLabel = (html.match(/<button[^>]*id="spyGuessWrongBtn"[^>]*>([^<]*)<\/button>/) || [])[1];
ok(yesLabel === 'Да, угадал', 'кнопка верного вердикта — «Да, угадал»');
ok(noLabel === 'Нет, ошибся', 'кнопка неверного вердикта — «Нет, ошибся»');
const verdictFn = (app.match(/const spyVerdict = isCorrect => \{[\s\S]*?\n  \};/) || [])[0] || '';
ok(verdictFn.includes('SPYC.resolveSpyGuess(g, isCorrect)') &&
   verdictFn.includes('spyRenderPhase()'),
   'вердикт обрабатывает только ядро (resolveSpyGuess), после успеха — рендер фазы из ядра');
ok(app.includes("$('#spyGuessCorrectBtn').addEventListener('click', () => spyVerdict(true))") &&
   app.includes("$('#spyGuessWrongBtn').addEventListener('click', () => spyVerdict(false))"),
   '«Да, угадал» → resolveSpyGuess(g, true), «Нет, ошибся» → resolveSpyGuess(g, false)');

/* 7б. Старые элементы ручной попытки полностью удалены */
['spyGuessInput', 'spyGuessChips', 'spyGuessReject'].forEach(id =>
  ok(!html.includes(id), `${id} удалён из index.html`));
ok(!app.includes('guessWho'), 'spy.guessWho и обработчики выбора имени удалены из UI');
ok(!app.includes('SPYC.makeGuess') && !core.includes('makeGuess'),
   'makeGuess удалён и из UI, и из ядра (resolveSpyGuess — единственный механизм попытки)');
ok(!html.includes('Попытку нельзя принять') && !app.includes('Попытку нельзя принять'),
   'старый экран отказа по введённому слову убран');

/* 7в. Склонения: передача телефона через decline(gen) с fallback на guessGender,
   «Голосует:»/«Рисует:» — именительный, старые формулировки удалены */
ok(app.includes("decline(name, 'gen', state.genders[name] || guessGender(name))") &&
   app.includes("decline(voter, 'gen', state.genders[voter] || guessGender(voter))"),
   "передача телефона: decline(name/voter, 'gen', state.genders[...] || guessGender(...))");
ok(app.includes("'Голосует: ' + voter") && app.includes("'Рисует: ' + (SPYC.getCurrentDrawer(g)"),
   '«Голосует:»/«Рисует:» — имя в именительном падеже (без склонения)');
ok(!app.includes('Передайте телефон') && !app.includes('Роли розданы'),
   'старые формулировки «Передайте телефон …»/«Роли розданы» удалены из шаблонов');
// живая санити-проверка общего модуля склонений на gen-примерах из брифа
require('../js/lang.js');
const LANG = globalThis.FANT_LANG;
const GEN_CASES = [['Денис', 'Дениса'], ['Анна', 'Анны'], ['Илья', 'Ильи'], ['Маша', 'Маши']];
GEN_CASES.forEach(([nm, gen]) =>
  ok(LANG.decline(nm, 'gen', LANG.guessGender(nm)) === gen,
     `decline('${nm}', 'gen') → '${gen}' (общий модуль склонений)`));

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

/* 10. SPY-INT (05): каждый метод SPYC.*, вызываемый UI, экспортирован ядром */
const used = new Set([...app.matchAll(/SPYC\.(\w+)/g)].map(m => m[1]));
const exportBlock = core.slice(core.indexOf('const SPY_CORE = {'));
const exported = new Set([...exportBlock.matchAll(/(?:^|[,{\s])([A-Za-z_]\w*)(?=[,}])/g)].map(m => m[1]));
for (const m of used) {
  ok(exported.has(m) && new RegExp(`\\b${m}\\s*(?:\\(|,|\\})`).test(exportBlock),
     `SPYC.${m} вызывается в app.js и экспортирован в spy-core.js`);
}
ok(used.has('votesCast'), 'UI использует votesCast (регрессия контракта 05)');

/* 11. SPY-INT (05): исход партии UI берёт из result.outcome, не из endHint */
ok(app.includes("g.result.outcome === 'spy-caught'"),
   'экран итога голосования различает «шпион пойман» по result.outcome');
ok(app.includes("SPY_END_TITLES[r.outcome]"),
   'финальный экран строит заголовок из result.outcome');
ok(app.includes("$('#spyGuessBtn4').classList.toggle('hidden', caught)"),
   'после поимки шпиона кнопка попытки скрыта');
ok(app.includes("'Показать итоги'"),
   'кнопка после поимки шпиона ведёт в итоги, а не «следующий круг»');

/* 11a. SPY-SCORE (04, решение владельца): очки только текущей партии,
        накопительного рейтинга между партиями нет */
ok(/spyFinalScores.*g\.scores\[p\]/s.test(app),
   'финальная таблица показывает очки текущей партии (g.scores)');
ok(!app.includes('spyScores') && !app.includes('totalScores') && !app.includes('scoreApplied'),
   'накопительный счёт и его хранилище полностью удалены из UI');
ok(!core.includes('mergeScores'),
   'mergeScores удалена из ядра');
ok(!html.includes('spyFinalResetBtn'),
   'кнопка сброса накопительного счёта убрана с финального экрана');

/* 12. Версия согласована (бамп делает менеджер одним релизным коммитом) */
const ver = (sw.match(/const VERSION = '([\d.]+)';/) || [])[1];
ok(ver === '1.8.2', 'sw.js: VERSION 1.8.2 (ревью: очки партии, единый выход)');
ok(html.includes(`?v=${ver}`) && html.includes('версия 1.8.2'),
   'index.html: ?v= и main-ver совпадают с VERSION');

console.log('SPY-UI smoke: ' + n + ' проверок пройдено');
