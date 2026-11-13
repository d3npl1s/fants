/* ═══════════════ Тесты режима «Шпион» ═══════════════
   Запуск: node tests/spy-core.test.js
   Детерминированные: весь randomness — через внедряемый rnd (mulberry32
   с фиксированным сидом либо scripted-очередь значений), Math.random
   в проверках не используется. Без зависимостей. */
'use strict';
globalThis.window = globalThis;
const SC = require('../js/spy-core.js');

let n = 0, fails = 0;
function ok(cond, label) { n++; if (!cond) { fails++; console.error(`FAIL  ${label}`); } }
function eq(actual, expected, label) {
  n++;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { fails++; console.error(`FAIL  ${label}\n      получилось: ${a}\n      ожидалось:  ${e}`); }
}
function throws(fn, label) {
  n++;
  try { fn(); console.error(`FAIL  ${label} — не выбросил исключение`); fails++; }
  catch (err) { /* ожидаемое отклонение */ }
}

/* ── детерминированные ГСЧ ── */
function rng(seed) {   // mulberry32
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function scripted(vals, fallback = 0.5) {   // очередь значений → затем константа
  let i = 0;
  return () => (i < vals.length ? vals[i++] : fallback);
}
/* значение rnd, дающее floor(rnd*len) === k */
const at = (k, len) => (2 * k + 1) / (2 * len);

/* ── фикстуры ── */
const DATA = {
  categories: [
    { id: 'animals', name: 'Животные', words: ['кот', 'слон', 'обезьяна', 'жираф'] },
    { id: 'food', name: 'Еда', words: ['пицца', 'борщ', 'мороженое'] },
    { id: 'tech', name: 'Техника', words: ['ноутбук', 'телевизор', 'наушники'] },
  ],
};
const POOL = DATA.categories.flatMap(c => c.words);
const R4 = ['Аня', 'Борис', 'Вика', 'Глеб'];
const R5 = ['Аня', 'Борис', 'Вика', 'Глеб', 'Даша'];
const R12 = ['Аня', 'Борис', 'Вика', 'Глеб', 'Даша', 'Ева', 'Жора', 'Зина', 'Игорь', 'Клава', 'Лёша', 'Маша'];

/* ── сценарные хелперы ── */
function finishDrawing(game) {
  const seq = [];
  for (let guard = 0; guard < game.players.length + 2; guard++) {
    const d = SC.getCurrentDrawer(game);
    if (!d) break;
    seq.push(d);
    SC.completeDrawTurn(game, d);
  }
  return seq;
}
/* victim получает все голоса, сам голосует «Пропустить» → единоличный лидер */
function voteOut(game, victim) {
  SC.openVote(game);
  for (const v of game.alive.slice()) SC.castVote(game, v, v === victim ? null : victim);
  return SC.resolveVote(game);
}
function voteAllSkip(game) {
  SC.openVote(game);
  for (const v of game.alive.slice()) SC.castVote(game, v, null);
  return SC.resolveVote(game);
}
const newGame = (mode, players, seed, data = DATA) => SC.createGame(players, mode, data, rng(seed));
/* scripted-партия: нормальный режим, слово «кот», шпион по индексу spyIdx */
const catspy = (players, spyIdx) => SC.createGame(players, 'normal', DATA,
  scripted([at(0, 3), at(0, 4), at(spyIdx, players.length)]));

/* ═══ §0: модуль доступен и через module.exports, и через window.SPY_CORE ═══ */
ok(SC && typeof SC.createGame === 'function' && SC === globalThis.window.SPY_CORE,
  'модуль экспортируется в module.exports и window.SPY_CORE');

/* ═══ §1: валидация createGame ═══ */
throws(() => SC.createGame(['А', 'Б', 'В'], 'normal', DATA), '3 игрока — отказ');
throws(() => SC.createGame(R12.concat(['Нина']), 'normal', DATA), '13 игроков — отказ');
throws(() => SC.createGame(['Аня', 'Аня', 'Борис', 'Вика'], 'normal', DATA), 'дубликаты — отказ');
throws(() => SC.createGame(['Аня', 'Аня ', 'Борис', 'Вика'], 'normal', DATA), 'дубликат после trim — отказ');
throws(() => SC.createGame(['Аня', '', 'Борис', 'Вика'], 'normal', DATA), 'пустое имя — отказ');
throws(() => SC.createGame(['Аня', '   ', 'Борис', 'Вика'], 'normal', DATA), 'имя из пробелов — отказ');
throws(() => SC.createGame([1, 'Аня', 'Борис', 'Вика'], 'normal', DATA), 'не-строчное имя — отказ');
throws(() => SC.createGame('Аня,Борис', 'normal', DATA), 'не-массив игроков — отказ');
throws(() => SC.createGame(R4, 'crazy', DATA), 'неизвестный режим — отказ');
throws(() => SC.createGame(R4, 'normal', null), 'null-база — отказ');
throws(() => SC.createGame(R4, 'normal', {}), 'пустая база — отказ');
throws(() => SC.createGame(R4, 'normal', { categories: [] }), 'пустой categories — отказ');
throws(() => SC.createGame(R4, 'normal', { categories: [{ id: 'x', name: 'X', words: [] }] }), 'пустая категория — отказ');
throws(() => SC.createGame(R4, 'normal', { categories: [{ id: '', name: 'X', words: ['кот'] }] }), 'пустой id — отказ');
throws(() => SC.createGame(R4, 'normal', { categories: [{ id: 'x', name: 'X', words: ['кот', '  '] }] }), 'пустое слово — отказ');
ok(SC.createGame(R4, 'normal', DATA), '4 игрока — допустимо (граница)');
ok(SC.createGame(R12, 'hardcore', DATA), '12 игроков — допустимо (граница)');
{
  const g = SC.createGame(['  Аня ', 'Борис', 'Вика', 'Глеб'], 'normal', DATA, rng(1));
  eq(g.players, ['Аня', 'Борис', 'Вика', 'Глеб'], 'имена хранятся после trim');
}

/* ═══ §2: ровно один шпион, общее слово, стартовое состояние ═══ */
for (let seed = 1; seed <= 40; seed++) {
  for (const mode of ['normal', 'hardcore']) {
    const label = `s${seed}/${mode}`;
    const g = newGame(mode, R5, seed);
    ok(typeof g.spy === 'string' && R5.includes(g.spy), `${label}: шпион — один из игроков`);
    ok(g.alive.filter(p => p === g.spy).length === 1, `${label}: ровно один шпион среди живых`);
    ok(POOL.includes(g.word), `${label}: слово из общего пула`);
    ok(!('spyWord' in g), `${label}: у шпиона нет отдельного слова`);
    eq(g.v, 1, `${label}: версия модели`);
    eq(g.players, R5, `${label}: исходный состав`);
    eq(g.alive, R5, `${label}: все живы`);
    eq(g.eliminated, [], `${label}: никого не выбыло`);
    eq(g.phase, 'reveal', `${label}: стартовая фаза reveal`);
    eq(g.round, 1, `${label}: круг 1`);
    eq(Object.values(g.scores), [0, 0, 0, 0, 0], `${label}: очки нулевые`);
    eq(Object.keys(g.scores), R5, `${label}: очки у всех игроков`);
    ok(g.drawOrder.length === 5 && [...g.drawOrder].sort().join('|') === [...R5].sort().join('|'),
      `${label}: drawOrder — перестановка состава`);
    eq(g.result, null, `${label}: результат пуст`);
    eq(g.history, [], `${label}: история пуста`);
  }
}

/* ═══ §2b: порядок rnd-вызовов зафиксирован контрактом ═══ */
{
  const g = SC.createGame(R4, 'normal', DATA, scripted([at(1, 3), at(2, 3), at(3, 4)]));
  eq(g.category, { id: 'food', name: 'Еда' }, 'rnd-порядок: категория — 1-й вызов');
  eq(g.word, 'мороженое', 'rnd-порядок: слово — 2-й вызов');
  eq(g.spy, 'Глеб', 'rnd-порядок: шпион — 3-й вызов');
  const h = SC.createGame(R4, 'hardcore', DATA, scripted([at(2, 10), at(2, 4)]));
  eq(h.word, 'обезьяна', 'rnd-порядок хардкора: слово — 1-й вызов');
  eq(h.spy, 'Вика', 'rnd-порядок хардкора: шпион — 2-й вызов');
}

/* ═══ §3: normal — категория выбрана, слово принадлежит ей ═══ */
{
  const g = SC.createGame(R4, 'normal', DATA, scripted([at(1, 3), at(0, 3), at(0, 4)]));
  eq(g.category, { id: 'food', name: 'Еда' }, 'normal: категория из базы');
  eq(g.word, 'пицца', 'normal: слово из выбранной категории');
}
for (let seed = 1; seed <= 40; seed++) {
  const g = newGame('normal', R4, seed);
  const cat = DATA.categories.find(c => c.id === g.category.id && c.name === g.category.name);
  ok(!!cat, `s${seed}: категория существует в базе`);
  ok(cat && cat.words.some(w => SC.normalizeWord(w) === SC.normalizeWord(g.word)),
    `s${seed}: слово принадлежит категории`);
}

/* ═══ §4: hardcore — category строго null, слово из общего пула ═══ */
{
  const g = SC.createGame(R4, 'hardcore', DATA, scripted([at(2, 10), at(2, 4)]));
  ok(g.category === null, 'hardcore: category === null (строго)');
  eq(g.word, 'обезьяна', 'hardcore: слово из объединённого пула');
}
for (let seed = 1; seed <= 40; seed++) {
  const g = newGame('hardcore', R4, seed);
  ok(g.category === null, `s${seed}: category === null`);
  ok(POOL.includes(g.word), `s${seed}: слово из общего пула`);
}

/* ═══ §5: порядок рисования и завершение круга ═══ */
{
  const g = catspy(R4, 3);                    // шпион «Глеб»
  const startName = g.drawOrder[0];
  eq(SC.getCurrentDrawer(g), null, 'reveal: рисующего нет');
  ok(SC.startGame(g), 'startGame: reveal → draw');
  ok(!SC.startGame(g), 'startGame повторно — отказ');
  eq(g.phase, 'draw', 'фаза draw');
  eq(SC.getCurrentDrawer(g), startName, 'первый рисующий — drawOrder[0]');
  const seq = finishDrawing(g);
  eq(seq.length, 4, 'круг: ровно 4 хода');
  eq(new Set(seq).size, 4, 'каждый живой рисует ровно один раз');
  eq(seq[0], startName, 'круг начинается со стартового игрока');
  eq(g.phase, 'discussion', 'круг завершён → discussion');
  eq(SC.getCurrentDrawer(g), null, 'discussion: рисующего нет');
  ok(!SC.completeDrawTurn(g, startName), 'лишний ход после круга — отказ');
}

/* ═══ §6: чужой ход, повторный ход, преждевременные переходы ═══ */
{
  const g = catspy(R4, 3);
  SC.startGame(g);
  const first = SC.getCurrentDrawer(g);
  const other = R4.find(p => p !== first);
  ok(!SC.completeDrawTurn(g, other), 'чужой ход — отказ');
  eq(g.phase, 'draw', 'фаза не изменилась');
  eq(SC.getCurrentDrawer(g), first, 'очередь не сдвинулась чужим ходом');
  ok(SC.completeDrawTurn(g, first), 'правильный ход принят');
  const second = SC.getCurrentDrawer(g);
  ok(second !== first, 'очередь сдвинулась');
  ok(!SC.completeDrawTurn(g, first), 'повторный ход того же игрока — отказ');
  ok(!SC.openVote(g), 'openVote до конца круга — отказ');
  ok(!SC.resolveVote(g), 'resolveVote до голосования — отказ');
  ok(!SC.castVote(g, 'Аня', null), 'голос в фазе draw — отказ');
  ok(SC.completeDrawTurn(g, second), 'следующий ход принят');
  finishDrawing(g);
  eq(g.phase, 'discussion', 'круг завершён');
  ok(!SC.completeDrawTurn(g, 'Аня'), 'ход в discussion — отказ');
  ok(SC.openVote(g), 'openVote: discussion → vote');
  ok(!SC.openVote(g), 'openVote повторно — отказ');
  ok(!SC.resolveVote(g), 'resolveVote до всех голосов — отказ');
  eq(g.phase, 'vote', 'фаза vote сохраняется');
  ok(SC.castVote(g, 'Аня', null), 'первый голос принят');
  ok(!SC.resolveVote(g), 'resolveVote при 1 из 4 голосов — отказ');
  eq(g.phase, 'vote', 'фаза не перескочила досрочно');
}

/* ═══ §7: валидация голосов ═══ */
{
  const g = catspy(R4, 2);                    // шпион «Вика»
  SC.startGame(g); finishDrawing(g); SC.openVote(g);
  ok(!SC.castVote(g, 'Зюзя', null), 'неизвестный голосующий — отказ');
  ok(!SC.castVote(g, 'Аня', 'Аня'), 'голос за себя — отказ');
  ok(!SC.castVote(g, 'Аня', 'Зюзя'), 'голос за неизвестного — отказ');
  ok(!SC.castVote(g, 'Аня', 42), 'не-строчная цель — отказ');
  ok(!SC.castVote(g, 'Аня', undefined), 'undefined-цель — отказ (пропуск только null)');
  ok(SC.castVote(g, 'Аня', 'Борис'), 'обычный голос принят');
  ok(!SC.castVote(g, 'Аня', 'Вика'), 'перезапись голоса — отказ');
  ok(!SC.castVote(g, 'Аня', null), 'повторный голос (пропуск) — отказ');
  eq(g.votes['Аня'], 'Борис', 'первый голос сохранён');
  ok(SC.castVote(g, 'Борис', null), 'пропуск принят');
}
{
  const g = catspy(R5, 4);                    // шпион «Даша»
  SC.startGame(g); finishDrawing(g);
  const e1 = voteOut(g, 'Борис');
  eq(e1.eliminated, 'Борис', 'подготовка: Борис выбыл в круге 1');
  SC.continueAfterVote(g);
  eq(g.phase, 'draw', 'круг 2: рисование');
  finishDrawing(g); SC.openVote(g);
  ok(!SC.castVote(g, 'Аня', 'Борис'), 'голос за выбывшего — отказ');
  ok(SC.castVote(g, 'Аня', 'Глеб'), 'голос за живого принят');
  ok(!SC.castVote(g, 'Борис', null), 'выбывший не голосует — отказ');
}

/* ═══ §8: исходы голосования — лидер, пропуск, ничьи ═══ */
{
  const g = catspy(R4, 3);
  SC.startGame(g); finishDrawing(g); SC.openVote(g);
  SC.castVote(g, 'Аня', 'Борис'); SC.castVote(g, 'Борис', 'Вика');
  SC.castVote(g, 'Вика', 'Борис'); SC.castVote(g, 'Глеб', null);
  const e = SC.resolveVote(g);
  eq(e.eliminated, 'Борис', 'единоличный лидер выбывает');
  eq(e.role, 'civilian', 'выбывший — мирный');
  eq(e.counts['Борис'], 2, 'у лидера 2 голоса');
  eq(e.skipVotes, 1, 'пропуск учтён отдельно');
  eq(e.round, 1, 'запись истории — для текущего круга');
  eq(g.phase, 'vote-result', 'фаза vote-result');
}
{
  const g = catspy(R4, 3);
  SC.startGame(g); finishDrawing(g);
  const e = voteAllSkip(g);
  eq(e.eliminated, null, 'все пропустили — никто не выбывает');
  eq(e.skipVotes, 4, 'пропуски посчитаны');
  eq(e.role, null, 'роль не раскрывается');
}
{
  const g = catspy(R4, 3);                    // ничья 4 игроков: все по 1
  SC.startGame(g); finishDrawing(g); SC.openVote(g);
  SC.castVote(g, 'Аня', 'Борис'); SC.castVote(g, 'Борис', 'Вика');
  SC.castVote(g, 'Вика', 'Глеб'); SC.castVote(g, 'Глеб', 'Аня');
  eq(SC.resolveVote(g).eliminated, null, 'ничья между игроками — никто не выбывает');
}
{
  const g = catspy(R4, 3);                    // «Пропустить» впереди: skip 2 > игрок 1
  SC.startGame(g); finishDrawing(g); SC.openVote(g);
  SC.castVote(g, 'Аня', 'Борис'); SC.castVote(g, 'Борис', 'Аня');
  SC.castVote(g, 'Вика', null); SC.castVote(g, 'Глеб', null);
  eq(SC.resolveVote(g).eliminated, null, '«Пропустить» впереди — никто не выбывает');
}
{
  const g = catspy(R4, 3);                    // ничья «Пропустить» с игроком: 2 = 2
  SC.startGame(g); finishDrawing(g); SC.openVote(g);
  SC.castVote(g, 'Аня', 'Борис'); SC.castVote(g, 'Борис', null);
  SC.castVote(g, 'Вика', null); SC.castVote(g, 'Глеб', 'Борис');
  eq(SC.resolveVote(g).eliminated, null, 'ничья с «Пропустить» — никто не выбывает');
}

/* ═══ §9: ошибочное изгнание мирного ═══ */
{
  const g = catspy(R4, 3);                    // шпион «Глеб»
  SC.startGame(g); finishDrawing(g);
  const e = voteOut(g, 'Борис');
  eq(e.eliminated, 'Борис', 'мирный выбыл');
  eq(e.counts['Борис'], 3, 'голоса против выбывшего посчитаны');
  eq(g.alive, ['Аня', 'Вика', 'Глеб'], 'выбывший убран из живых');
  eq(g.eliminated, ['Борис'], 'выбывший в списке выбывших');
  eq(g.scores['Глеб'], 1, 'шпиону ровно +1');
  eq(g.scores['Аня'], 0, 'живому мирному очков нет');
  eq(g.scores['Борис'], 0, 'выбывшему мирному очков нет');
  eq(g.result, null, 'result пуст, пока партия продолжается');
  ok(!('scores' in e) && !('score' in e), 'запись истории не содержит очков');
  ok(SC.continueAfterVote(g), 'переход к следующему кругу');
  eq(g.round, 2, 'номер круга вырос');
  eq(g.phase, 'draw', 'круг 2: рисование');
}

/* ═══ §10: изгнание шпиона ═══ */
{
  const g = catspy(R5, 4);                    // шпион «Даша»
  SC.startGame(g); finishDrawing(g);
  voteOut(g, 'Борис');   // мирный прочь, Даша +1
  SC.continueAfterVote(g); finishDrawing(g);
  const e2 = voteOut(g, 'Даша');              // все живые против шпиона
  eq(e2.eliminated, 'Даша', 'шпион выбыл');
  eq(e2.role, 'spy', 'роль раскрыта: шпион');
  eq(g.scores['Даша'], 1, 'шпион сохранил +1 за ошибочный круг');
  eq(g.scores['Аня'], 1, 'мирному +1 за поимку');
  eq(g.scores['Борис'], 1, 'ранее выбывший мирный тоже +1');
  eq(g.scores['Вика'], 1, 'второй живой мирный +1');
  eq(g.scores['Глеб'], 1, 'третий живой мирный +1');
  ok(g.result && g.result.outcome === 'spy-caught', 'исход: шпион пойман');
  eq(g.result.spy, 'Даша', 'в результате имя шпиона');
  eq(g.result.word, g.word, 'в результате слово');
  eq(g.phase, 'vote-result', 'сначала vote-result (раскрытие)');
  ok(SC.continueAfterVote(g), 'continueAfterVote завершает партию');
  eq(g.phase, 'finished', 'фаза finished');
  ok(!SC.continueAfterVote(g), 'повторный continue — отказ');
  ok(!SC.makeGuess(g, 'Даша', g.word), 'после финала попытка невозможна');
}

/* ═══ §11: попытка шпиона назвать слово ═══ */
{
  const g = catspy(R4, 1);                    // шпион «Борис», слово «кот»
  eq(g.word, 'кот', 'слово зафиксировано');
  ok(!SC.makeGuess(g, 'Борис', 'кот'), 'в reveal попытка недоступна (роли ещё не раздались)');
  SC.startGame(g);
  ok(SC.makeGuess(g, 'Борис', '  КОТ '), 'верная попытка принята');
  eq(g.scores['Борис'], 2, 'шпиону ровно +2');
  eq(g.scores['Аня'], 0, 'остальным ничего');
  eq(g.phase, 'finished', 'партия завершена');
  ok(g.result && g.result.outcome === 'spy-guessed', 'исход spy-guessed');
  eq(g.result.word, 'кот', 'в результате слово');
  ok(!SC.makeGuess(g, 'Борис', 'кот'), 'повторная попытка — отказ');
}
{
  const g = catspy(R4, 1);
  SC.startGame(g);
  ok(SC.completeDrawTurn(g, SC.getCurrentDrawer(g)), 'ход рисования сделан');
  ok(SC.makeGuess(g, 'Борис', 'собака'), 'неверная попытка принята — и завершает партию');
  eq(g.scores['Борис'], 0, 'шпион не получил очков');
  eq(g.scores['Аня'], 1, 'мирному +1');
  eq(g.scores['Вика'], 1, 'второму мирному +1');
  eq(g.scores['Глеб'], 1, 'третьему мирному +1');
  ok(g.result && g.result.outcome === 'spy-wrong-guess', 'исход spy-wrong-guess');
  eq(g.phase, 'finished', 'партия завершена');
}
{
  const g = catspy(R4, 1);
  SC.startGame(g);
  ok(!SC.makeGuess(g, 'Борис', '   '), 'пустая попытка — отказ');
  ok(!SC.makeGuess(g, 'Борис', ''), 'пустая строка — отказ');
  eq(g.phase, 'draw', 'пустая попытка партию не тратит');
}

/* ═══ §12: не-шпион не может вызвать проверку, состояние не меняется ═══ */
{
  const g = catspy(R4, 1);                    // шпион «Борис»
  SC.startGame(g);
  const snap = JSON.stringify(g);
  ok(!SC.makeGuess(g, 'Аня', 'кот'), 'не-шпион не запускает проверку');
  eq(JSON.stringify(g), snap, 'состояние не изменилось');
  ok(!SC.makeGuess(g, 'Зюзя', 'кот'), 'неизвестный игрок — отказ');
  ok(!SC.makeGuess(g, null, 'кот'), 'null-имя — отказ');
  eq(JSON.stringify(g), snap, 'состояние по-прежнему не изменилось');
}
{
  const g = catspy(R5, 4);                    // шпион «Даша»
  SC.startGame(g); finishDrawing(g);
  voteOut(g, 'Борис');
  SC.continueAfterVote(g);
  ok(!SC.makeGuess(g, 'Борис', g.word), 'выбывший мирный не делает попыток');
  eq(g.phase, 'draw', 'партия не изменилась');
}

/* ═══ §13: вращение очереди; выбывшие не рисуют (drawOrder зафиксирован скриптом) ═══ */
{
  const g = SC.createGame(R5, 'normal', DATA,
    scripted([at(0, 3), at(0, 4), at(4, 5), 0.9, 0.875, 2.5 / 3, 0.75]));
  eq(g.spy, 'Даша', 'шпион — Даша');
  eq(g.drawOrder, R5, 'drawOrder = [Аня,Борис,Вика,Глеб,Даша]');
  SC.startGame(g);
  eq(SC.getCurrentDrawer(g), 'Аня', 'круг 1: Аня первая');
  eq(finishDrawing(g), ['Аня', 'Борис', 'Вика', 'Глеб', 'Даша'], 'круг 1: порядок по drawOrder');
  voteAllSkip(g); SC.continueAfterVote(g);
  eq(g.round, 2, 'круг 2');
  eq(SC.getCurrentDrawer(g), 'Борис', 'круг 2: старт сдвинулся на следующего');
  eq(finishDrawing(g), ['Борис', 'Вика', 'Глеб', 'Даша', 'Аня'], 'круг 2: цикл от нового старта');
  voteOut(g, 'Борис');                        // стартовый игрок круга 2 ошибочно изгнан
  eq(g.eliminated, ['Борис'], 'Борис выбыл');
  eq(g.scores['Даша'], 1, 'шпиону +1 за ошибку');
  SC.continueAfterVote(g);
  eq(g.round, 3, 'круг 3');
  eq(SC.getCurrentDrawer(g), 'Вика', 'круг 3: старт — следующий живой после изгнанного старта');
  eq(finishDrawing(g), ['Вика', 'Глеб', 'Даша', 'Аня'], 'круг 3: выбывший не рисует');
  voteAllSkip(g); SC.continueAfterVote(g);
  eq(g.round, 4, 'круг 4');
  eq(SC.getCurrentDrawer(g), 'Глеб', 'круг 4: вращение продолжается');
  eq(finishDrawing(g), ['Глеб', 'Даша', 'Аня', 'Вика'], 'круг 4: порядок живых по кругу');
  voteAllSkip(g); SC.continueAfterVote(g);
  eq(g.round, 5, 'круг 5');
  eq(SC.getCurrentDrawer(g), 'Даша', 'круг 5: дальше по сохранённому порядку');
  eq(g.drawOrder, R5, 'drawOrder не перемешивался заново');
  ok(g.alive.includes('Даша'), 'шпион до сих пор в игре');
}

/* ═══ §14: автоматическая победа шпиона при двух живых ═══ */
{
  const g = catspy(R4, 3);                    // шпион «Глеб»
  SC.startGame(g); finishDrawing(g);
  voteOut(g, 'Борис'); SC.continueAfterVote(g);
  eq(g.round, 2, 'круг 2 начался');
  finishDrawing(g);
  voteOut(g, 'Вика');                         // живых осталось 2: шпион + мирный
  eq(g.phase, 'vote-result', 'ещё vote-result');
  eq(g.result, null, 'результ ещё нет до continue');
  ok(SC.continueAfterVote(g), 'continue завершает партию автоматически');
  eq(g.phase, 'finished', 'партия закончена');
  ok(g.result && g.result.outcome === 'spy-auto-win', 'исход spy-auto-win');
  eq(g.result.spy, 'Глеб', 'шпион назван в результате');
  ok(g.result.word, 'слово в результате');
  eq(g.scores['Глеб'], 2, 'шпиону только за ошибочные изгнания — без доп. очка');
  eq(g.scores['Аня'], 0, 'мирному ничего');
  eq(g.scores['Борис'], 0, 'выбывшим ничего');
  eq(g.round, 2, 'номер круга не вырос');
}

/* ═══ §15: normalizeWord ═══ */
eq(SC.normalizeWord('КОТ'), 'кот', 'регистр');
eq(SC.normalizeWord('ЁЖИК'), 'ежик', 'Ё → е');
eq(SC.normalizeWord('Ёлка'), 'елка', 'ё в любом регистре');
eq(SC.normalizeWord('  пёс  '), 'пес', 'края и ё');
eq(SC.normalizeWord('кот\tи\nёж'), 'кот и еж', 'любые пробелы сворачиваются');
eq(SC.normalizeWord('кот   слон'), 'кот слон', 'повторные пробелы — в один');
eq(SC.normalizeWord(''), '', 'пустая строка');
eq(SC.normalizeWord('   '), '', 'одни пробелы → пусто');
eq(SC.normalizeWord(null), '', 'null безопасен');
eq(SC.normalizeWord(undefined), '', 'undefined безопасен');

/* ═══ §16: прогоны полных партий — инварианты очков и состава ═══ */
const OUTCOMES = ['spy-caught', 'spy-guessed', 'spy-wrong-guess', 'spy-auto-win'];

/* стратегия по seed % 3: 0 — пропуск по нечётным кругам, изгнание по чётным;
   1 — изгнание первого мирного каждый круг; 2 — круг 1 пропуск, дальше топим шпиона.
   opts.guess: 'correct'/'wrong' — после первого голосования шпион называет слово. */
function playToEnd(seed, n, mode, opts = {}) {
  const label = `s${seed}/n${n}/${mode}${opts.guess ? `/guess-${opts.guess}` : ''}`;
  const roster = R12.slice(0, n);
  const g = SC.createGame(roster, mode, DATA, rng(seed));
  const drawOrderSnap = JSON.stringify(g.drawOrder);
  let votesHeld = 0, guard = 0;
  while (g.phase !== 'finished' && guard++ < 200) {
    if (g.phase === 'reveal') { ok(SC.startGame(g), `${label}: reveal → draw`); continue; }
    if (g.phase === 'draw') {
      const seq = finishDrawing(g);
      ok(seq.length === g.alive.length && new Set(seq).size === seq.length,
        `${label}: круг ${g.round} — каждый живой рисует ровно раз`);
      ok(seq.every(p => g.alive.includes(p)), `${label}: круг ${g.round} — рисуют только живые`);
      ok(g.phase === 'discussion' && SC.getCurrentDrawer(g) === null,
        `${label}: круг ${g.round} завершён → discussion`);
      continue;
    }
    if (g.phase === 'discussion') { ok(SC.openVote(g), `${label}: discussion → vote`); continue; }
    if (g.phase === 'vote') {
      votesHeld++;
      const strategy = seed % 3;
      let target = null;                                   // «все пропустили»
      if (opts.guess && votesHeld === 1) target = null;    // первый круг — пропуск, затем попытка
      else if (strategy === 2 && g.round >= 2) target = g.spy;
      else if (strategy !== 0 || g.round % 2 === 0) target = g.alive.find(p => p !== g.spy);
      for (const v of g.alive.slice()) {
        if (!Object.prototype.hasOwnProperty.call(g.votes, v))
          ok(SC.castVote(g, v, v === target ? null : target), `${label}: голос r${g.round} от ${v}`);
      }
      const e = SC.resolveVote(g);
      ok(!!e && e.round === g.round, `${label}: голосование r${g.round} разрешено`);
      continue;
    }
    if (g.phase === 'vote-result') {
      if (opts.guess && votesHeld >= 1 && !g.result) {
        const text = opts.guess === 'correct' ? g.word : 'совершенно не то слово';
        ok(SC.makeGuess(g, g.spy, text), `${label}: попытка шпиона на vote-result`);
        continue;
      }
      ok(SC.continueAfterVote(g), `${label}: continue после r${g.round}`);
      continue;
    }
    ok(false, `${label}: неизвестная фаза ${g.phase}`);
    break;
  }
  ok(g.phase === 'finished', `${label}: партия завершилась за ${guard} шагов`);
  eq(JSON.stringify(g.drawOrder), drawOrderSnap, `${label}: drawOrder не менялся всю партию`);
  return g;
}

function checkEnd(g, seed, n, mode) {
  const label = `s${seed}/n${n}/${mode}`;
  const outcome = g.result && g.result.outcome;
  ok(OUTCOMES.includes(outcome), `${label}: исход валидный (${outcome})`);
  const k = g.history.filter(e => e.role === 'civilian').length;   // ошибочные изгнания
  const sum = Object.values(g.scores).reduce((a, b) => a + b, 0);
  const expectedSum = outcome === 'spy-guessed' ? 2 + k
    : outcome === 'spy-auto-win' ? k
    : (n - 1) + k;                                                 // caught / wrong-guess
  eq(sum, expectedSum, `${label}: сумма очков`);
  const spyScore = outcome === 'spy-guessed' ? 2 + k : k;
  eq(g.scores[g.spy], spyScore, `${label}: очки шпиона`);
  eq(g.eliminated.length, k + (outcome === 'spy-caught' ? 1 : 0), `${label}: число выбывших`);
  ok(g.alive.length + g.eliminated.length === n, `${label}: живые + выбывшие = состав`);
  ok(g.mode === 'hardcore' ? g.result.category === null : !!g.result.category,
    `${label}: категория в результате (${mode})`);
  eq(g.round, g.history.length, `${label}: круги совпадают с числом голосований`);
  ok(g.result.spy === g.spy && g.result.word === g.word, `${label}: результат называет шпиона и слово`);
  if (outcome === 'spy-caught') ok(!g.alive.includes(g.spy), `${label}: пойманный шпион выбыл`);
  else ok(g.alive.includes(g.spy), `${label}: шпион в игре в конце`);
  ok(g.history.every(e => !('scores' in e) && e.round >= 1), `${label}: в истории нет очков`);
}

for (let seed = 1; seed <= 24; seed++) {
  for (const n of [4, 5, 12]) {
    for (const mode of ['normal', 'hardcore']) {
      checkEnd(playToEnd(seed, n, mode), seed, n, mode);
    }
  }
}
for (const guess of ['correct', 'wrong']) {
  for (let seed = 1; seed <= 6; seed++) {
    for (const n of [4, 6]) {
      const g = playToEnd(seed, n, 'normal', { strategy: 0, guess });
      ok(g.result.outcome === (guess === 'correct' ? 'spy-guessed' : 'spy-wrong-guess'),
        `s${seed}/n${n}/guess-${guess}: исход через попытку шпиона`);
    }
  }
}

/* ═══ SPY-INT (интеграция 05): votesCast — счётчик принятых голосов ═══ */
{
  const g = SC.createGame(R4, 'normal', DATA, rng(7));
  SC.startGame(g);
  eq(SC.votesCast(g), 0, 'votesCast: до голосования — 0');
  finishDrawing(g);                                 // круг рисования → discussion
  SC.openVote(g);
  eq(SC.votesCast(g), 0, 'votesCast: открыто голосование, голосов нет — 0');
  ok(SC.castVote(g, 'Аня', null), 'votesCast: «Пропустить» — тоже голос');
  eq(SC.votesCast(g), 1, 'votesCast: один голос (пропуск) учтён');
  ok(SC.castVote(g, 'Борис', 'Вика'), 'votesCast: голос за игрока принимается');
  eq(SC.votesCast(g), 2, 'votesCast: два голоса');
  ok(SC.castVote(g, 'Глеб', 'Аня') && SC.castVote(g, 'Вика', null), 'votesCast: остальные голоса принимаются');
  eq(SC.votesCast(g), 4, 'votesCast: все живые проголосовали — 4');
  // votes как Object.create(null): чужие/несобственные ключи не считаются
  const g2 = SC.createGame(R4, 'normal', DATA, rng(8));
  SC.startGame(g2); finishDrawing(g2); SC.openVote(g2);
  Object.defineProperty(g2.votes, 'protoTrap', { value: 1, enumerable: false });   // несобственное
  eq(SC.votesCast(g2), 0, 'votesCast: несобственное свойство не считается');
  g2.votes.Гость = 1;                              // собственный ключ вне alive
  eq(SC.votesCast(g2), 1, 'votesCast: собственные ключи считаются');
}

/* ═══ SPY-INT (интеграция 05): каждый метод SPYC, используемый UI, экспортирован ═══ */
{
  const usedByUI = ['createGame', 'startGame', 'getCurrentDrawer', 'completeDrawTurn',
    'openVote', 'castVote', 'votesCast', 'resolveVote', 'continueAfterVote', 'makeGuess', 'normalizeWord'];
  for (const m of usedByUI) {
    ok(typeof SC[m] === 'function', `экспорт: SPY_CORE.${m} — функция`);
  }
}

/* ═══ итог ═══ */
console.log(`Проверок: ${n}, провалов: ${fails}`);
if (fails) { console.error(`ТЕСТЫ ПРОВАЛЕНЫ`); process.exit(1); }
console.log('OK — все проверки пройдены');
