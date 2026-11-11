/* ═══════════════ Тесты режима «Нарисуй по памяти» ═══════════════
   Запуск: node tests/draw-memory.test.js
   Проверяет базу слов и чистую логику (draw-memory-core.js):
   пары, выбор слов, начисление баллов, резерв номеров, сохранение состояния. */
'use strict';
globalThis.window = globalThis;
require('../js/draw-memory-data.js');
require('../js/draw-memory-core.js');

const DMD = window.DRAW_MEMORY_DATA;
const DMC = window.DRAW_MEMORY_CORE;

let n = 0, fails = 0;
function eq(actual, expected, label) {
  n++;
  if (actual !== expected) { fails++; console.error(`FAIL  ${label}\n      получилось: ${JSON.stringify(actual)}\n      ожидалось:  ${JSON.stringify(expected)}`); }
}
function ok(cond, label) { n++; if (!cond) { fails++; console.error(`FAIL  ${label}`); } }

/* ── §5 базы слов: объём, категории, дубликаты, «стволы» ── */
const allWords = DMD.cats.flatMap(c => c.words);
console.log(`База: ${DMD.cats.length} категорий — ${DMD.cats.map(c => `${c.id}: ${c.words.length}`).join(', ')} — всего ${allWords.length}`);
ok(allWords.length >= 200, `в базе не меньше 200 слов (сейчас ${allWords.length})`);
ok(DMD.cats.length >= 5, 'база разделена на категории');
ok(DMD.cats.every(c => c.id && c.name && Array.isArray(c.words) && c.words.length >= 10), 'у каждой категории есть id, имя и минимум 10 слов');

const seen = new Map();
allWords.forEach(w => {
  ok(typeof w === 'string' && w.length >= 3 && w.length <= 30, `слово подходящей длины: «${w}»`);
  ok(/^[А-ЯЁа-яё][а-яё\- ]*$/i.test(w), `слово кириллицей без лишних знаков: «${w}»`);
  const k = DMC.normWord(w);
  ok(!seen.has(k), `без полных дубликатов: «${w}»`);
  seen.set(k, w);
});
// одинаковые «стволы» запрещены во всей базе: близкие слова не встретятся даже в разных раундах
const stems = new Map();
allWords.forEach(w => {
  const st = DMC.stem(w);
  ok(!stems.has(st), `уникальный ствол «${st}»: «${w}» совпал с «${stems.get(st)}»`);
  stems.set(st, w);
});
// известные абстракции не просочились
['счастье', 'ответственность', 'справедливость', 'любовь', 'дружба', 'надежда'].forEach(a => {
  ok(!allWords.includes(a), `без абстракций: «${a}» в базе не нужен`);
});

/* ── plural ── */
eq(DMC.plural(1, ['балл', 'балла', 'баллов']), 'балл', 'plural 1 балл');
eq(DMC.plural(2, ['балл', 'балла', 'баллов']), 'балла', 'plural 2 балла');
eq(DMC.plural(5, ['балл', 'балла', 'баллов']), 'баллов', 'plural 5 баллов');
eq(DMC.plural(11, ['балл', 'балла', 'баллов']), 'баллов', 'plural 11 баллов');
eq(DMC.plural(21, ['балл', 'балла', 'баллов']), 'балл', 'plural 21 балл');
eq(DMC.plural(3, ['вопрос', 'вопроса', 'вопросов']), 'вопроса', 'plural 3 вопроса');

/* ── §10.1–10.5: пары для 2, 3, 5, 12 игроков × per 1..6, много случайных прогонов ── */
const ROSTERS = {
  2: ['Аня', 'Боря'],
  3: ['Аня', 'Боря', 'Вика'],
  5: ['Аня', 'Боря', 'Вика', 'Гоша', 'Даша'],
  12: ['Аня', 'Боря', 'Вика', 'Гоша', 'Даша', 'Ева', 'Жора', 'Зина', 'Игорь', 'Клава', 'Лёша', 'Маша']
};
for (const [size, roster] of Object.entries(ROSTERS)) {
  const nP = Number(size);
  for (let per = 1; per <= 6; per++) {
    for (let round = 0; round < 300; round++) {
      const pairs = DMC.buildPairs(roster, per);
      const label = `пары ${nP}×${per} (раунд ${round})`;
      if (round > 0 && per > 3 && nP === 12) continue;   // ускоряем тяжёлую клетку
      n++;
      if (pairs.length !== nP * per) { fails++; console.error(`FAIL  ${label}: длина ${pairs.length} ≠ ${nP * per}`); continue; }
      // каждый задаёт ровно per
      const askCnt = {};
      pairs.forEach(p => { askCnt[p.asker] = (askCnt[p.asker] || 0) + 1; });
      roster.forEach(nm => eq(askCnt[nm] || 0, per, `${label}: «${nm}» задаёт ровно ${per}`));
      // каждый отвечает ровно per (максимально равномерно = идеально)
      const ansCnt = {};
      pairs.forEach(p => { ansCnt[p.answerer] = (ansCnt[p.answerer] || 0) + 1; });
      roster.forEach(nm => eq(ansCnt[nm] || 0, per, `${label}: «${nm}» отвечает ровно ${per}`));
      // никто не спрашивает себя; направленная пара не повторяется, пока у спрашивающего
      // остались непроспрошенные (для 2 игроков повтор неизбежен и разрешён)
      const uniq = {};
      pairs.forEach(p => {
        ok(p.asker !== p.answerer, `${label}: без самопары ${p.asker}→${p.answerer}`);
        const key = p.asker + '→' + p.answerer;
        uniq[key] = (uniq[key] || 0) + 1;
      });
      roster.forEach(a => {
        const used = Object.keys(uniq).filter(k => k.startsWith(a + '→')).length;
        const expected = Math.min(per, nP - 1);
        eq(used, expected, `${label}: «${a}» опросил ${expected} разных (без преждевременных повторов)`);
      });
      // перемешивание карточек: хотя бы в части раундов порядок не совпадает с порядком задающих
    }
  }
}
// перестановка не вырожденная: карточки не идут блоками одного задающего
{
  const roster = ROSTERS[5];
  let mixedSeen = 0;
  for (let i = 0; i < 100; i++) {
    const pairs = DMC.buildPairs(roster, 3);
    let mixed = false;
    for (let k = 1; k < pairs.length; k++) if (pairs[k].asker !== pairs[k - 1].asker) { mixed = true; break; }
    if (mixed) mixedSeen++;
  }
  ok(mixedSeen >= 95, `карточки перемешиваются (${mixedSeen}/100 раундов со сменой задающего внутри списка)`);
}

/* ── §10.6: слова раунда уникальны, без недавних, без одинаковых стволов ── */
for (const size of [2, 3, 5, 12]) {
  for (let per = 1; per <= 5; per++) {
    const total = Number(size) * per;
    const words = DMC.pickWords(allWords, total);
    eq(words.length, total, `pickWords ${size}×${per}: ровно ${total} слов`);
    eq(new Set(words.map(DMC.normWord)).size, total, `pickWords ${size}×${per}: без повторов`);
    eq(new Set(words.map(DMC.stem)).size, total, `pickWords ${size}×${per}: без одинаковых стволов`);
  }
}
{
  // свежесть: недавние слова не выбираются, пока пул позволяет
  const recent = allWords.slice(0, 120);
  const words = DMC.pickWords(allWords, 30, recent);
  ok(words.every(w => !recent.includes(w)), 'pickWords не берёт недавние слова, пока пул позволяет');
  // пул исчерпан: всё «недавнее» — всё равно полный набор без повторов
  const words2 = DMC.pickWords(allWords, 30, allWords);
  eq(words2.length, 30, 'pickWords при исчерпанном пуле всё отдаёт 30');
  eq(new Set(words2).size, 30, 'pickWords при исчерпанном пуле без повторов');
  eq(DMC.pickWords(allWords, 500).length, allWords.length, 'pickWords не отдаёт больше базы');
}

/* ── §10.8–10.9: баллы — три результата, без двойного начисления, «Никому» не меняет счёт ── */
{
  const round = {
    players: ['Аня', 'Боря', 'Вика'],
    scores: DMC.newScores(['Аня', 'Боря', 'Вика']),
    cards: [
      { state: 'active', num: null, result: null },
      { state: 'active', num: null, result: null }
    ],
    pairs: [
      { asker: 'Аня', answerer: 'Боря' },
      { asker: 'Боря', answerer: 'Аня' }
    ]
  };
  ok(DMC.applyResult(round, 0, 'answerer'), 'результат применяется');
  eq(round.scores['Боря'], 1, 'балл отвечающему');
  eq(round.scores['Аня'], 0, 'задающий без балла');
  ok(!DMC.applyResult(round, 0, 'answerer'), 'повтор того же результата — no-op');
  eq(round.scores['Боря'], 1, 'двойного начисления нет');
  ok(DMC.applyResult(round, 0, 'asker'), 'результат можно скорректировать');
  eq(round.scores['Боря'], 0, 'старый балл снят');
  eq(round.scores['Аня'], 1, 'балл задающему');
  ok(DMC.applyResult(round, 0, 'none'), '«Никому» применяется');
  eq(round.scores['Аня'], 0, '«Никому» не меняет счёт (сняло старое)');
  eq(round.scores['Боря'], 0, '«Никому» не меняет счёт');
  ok(DMC.applyResult(round, 0, null), 'отмена результата');
  eq(round.scores['Аня'] + round.scores['Боря'], 0, 'после отмены баллов нет');
  // «Никому» на чистой карточке фиксируется на карточке, но счёт не трогает
  ok(DMC.applyResult(round, 1, 'none'), '«Никому» на чистой карточке записывается');
  eq(round.cards[1].result, 'none', 'результат «Никому» сохранён на карточке');
  eq(round.scores['Аня'] + round.scores['Боря'] + round.scores['Вика'], 0, 'счёт по-прежнему нулевой');

/* ── DM-NUMS: резерв номеров — один номер на всю партию ── */
{
  const roster = ['Аня', 'Боря', 'Вика'];
  const round = {
    total: 6, players: roster.slice(),
    scores: DMC.newScores(roster),
    pairs: DMC.buildPairs(roster, 2),
    cards: DMC.buildPairs(roster, 2).map(() => ({ state: 'pending', num: null, result: null, revealed: false })),
    usedNums: [], hist: []
  };
  ok(DMC.reserveNum(round, 0, 3), 'номер резервируется');
  eq(round.cards[0].num, 3, 'номер записан на карточку');
  eq(round.usedNums.join('|'), '3', 'номер попал в общий список партии');
  ok(!DMC.reserveNum(round, 1, 3), 'тот же номер в другой проверке недоступен');
  ok(!DMC.reserveNum(round, 0, 3), 'повторный вызов обработчика — no-op');
  ok(DMC.reserveNum(round, 1, 1), 'другой номер свободен');
  ok(!DMC.reserveNum(round, 2, 0), 'номер вне диапазона снизу отвергнут');
  ok(!DMC.reserveNum(round, 2, 7), 'номер вне диапазона сверху отвергнут');
  ok(!DMC.reserveNum(round, 2, 2.5), 'дробный номер отвергнут');
  // завершённая карточка и карточка с номером не принимают резерв
  round.cards[0].state = 'done';
  ok(!DMC.reserveNum(round, 0, 5), 'завершённая карточка номер не меняет');
  ok(!DMC.reserveNum(round, 1, 5), 'карточка с номером второй не принимает');
  // отмена результата не возвращает номер в пул
  round.cards[0].state = 'pending'; round.cards[0].result = 'answerer';
  DMC.applyResult(round, 0, null);
  ok(!DMC.reserveNum(round, 0, 3), 'после раскрытия/отмены номер 3 остаётся использованным');
  eq(round.usedNums.length, 2, 'usedNums не разросся и не сократился');
}

/* ── §5 приёмка: 5 игроков × 3 = 15 проверок, номера строго по одному разу ── */
for (let sim = 0; sim < 200; sim++) {
  const roster = ROSTERS[5];
  const total = 15;
  const round = {
    total, players: roster.slice(), per: 3,
    scores: DMC.newScores(roster),
    pairs: DMC.buildPairs(roster, 3),
    cards: [], usedNums: [], hist: []
  };
  round.cards = round.pairs.map(() => ({ state: 'pending', num: null, result: null, revealed: false }));
  let verdicts = 0;
  for (let i = 0; i < total; i++) {
    // каждая проверка берёт СВОБОДНЫЙ номер (в случайном порядке, как игроки)
    const free = Array.from({ length: total }, (_, k) => k + 1).filter(n => !round.usedNums.includes(n));
    eq(free.length, total - i, `сим ${sim}: перед проверкой ${i + 1} свободно ${total - i} номеров`);
    const num = free[Math.floor(Math.random() * free.length)];
    ok(DMC.reserveNum(round, i, num), `сим ${sim}: номер ${num} зарезервирован за проверкой ${i + 1}`);
    round.cards[i].revealed = true;
    // исход: ровно один из трёх вариантов
    const result = ['answerer', 'asker', 'none'][Math.floor(Math.random() * 3)];
    ok(DMC.applyResult(round, i, result), `сим ${sim}: исход ${result} зафиксирован`);
    ok(!DMC.applyResult(round, i, result), `сим ${sim}: повторное начисление невозможно`);
    round.cards[i].state = 'done';
    verdicts++;
  }
  eq(verdicts, 15, `сим ${sim}: 15 проверок с одним исходом каждая`);
  eq(round.usedNums.length, 15, `сим ${sim}: все 15 номеров использованы ровно по разу`);
  eq(new Set(round.usedNums).size, 15, `сим ${sim}: без дублей в usedNums`);
  const sum = Object.values(round.scores).reduce((a, b) => a + b, 0);
  const expected = round.cards.filter(c => c.result !== 'none').length;
  eq(sum, expected, `сим ${sim}: сумма баллов = числу ненулевых исходов`);
  // новая партия — номера снова доступны
  round.usedNums = [];
  round.cards.forEach(c => { c.num = null; c.state = 'pending'; c.result = null; });
  ok(DMC.reserveNum(round, 0, 3), 'в новой партии номера снова доступны');
}
}

/* ── §10.10: перезагрузка/перерендер не меняют сохранённое состояние ── */
{
  const roster = ROSTERS[5];
  const round = {
    v: 1, phase: 'checks', players: roster.slice(), per: 3, total: 15,
    words: DMC.pickWords(allWords, 15),
    pairs: DMC.buildPairs(roster, 3),
    cards: [], scores: DMC.newScores(roster), hist: [], listenIdx: 15, drawEndsAt: 0
  };
  round.cards = round.pairs.map(() => ({ state: 'pending', num: null, result: null, revealed: false }));
  round.cards[2].state = 'done'; round.cards[2].num = 7; round.cards[2].result = 'answerer';
  round.scores[round.pairs[2].answerer] = 1;
  const saved = JSON.stringify(round);
  const restored = JSON.parse(saved);   // так же, как из localStorage
  eq(JSON.stringify(restored), saved, 'круговая поездка JSON не меняет данные');
  // восстановленный раунд дорабатывается: очки, карточки, история
  ok(DMC.applyResult(restored, 5, 'asker'), 'восстановленный раунд принимает результат');
  const asker5 = restored.pairs[5].asker;
  // дельта, а не абсолют: у игрока может быть балл из предзаполненной карточки 2
  eq(restored.scores[asker5] - (round.scores[asker5] || 0), 1, 'баллы восстановленного раунда считаются');
  eq(restored.pairs[2].answerer, round.pairs[2].answerer, 'пары после восстановления те же');
  eq(restored.cards[2].result, 'answerer', 'карточки после восстановления те же');
  // repeatable: ядро ничего не пишет в localStorage
  ok(Object.keys(DMC).every(k => typeof DMC[k] === 'function'), 'в ядре только функции — хранилищем не занимается');
}

/* ── mergeRecent ── */
{
  let rec = DMC.mergeRecent([], ['а', 'б']);
  eq(rec.join('|'), 'а|б', 'mergeRecent добавляет');
  rec = DMC.mergeRecent(rec, ['б', 'в']);
  eq(rec.join('|'), 'а|б|в', 'mergeRecent без дублей');
  const cap = DMC.mergeRecent(['1', '2', '3'], ['4', '5'], 4);
  eq(cap.join('|'), '2|3|4|5', 'mergeRecent подрезает до лимита с конца');
}

console.log(fails ? `\n${fails}/${n} упало` : `OK: ${n} проверок пройдено`);
process.exit(fails ? 1 : 0);
