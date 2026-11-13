/* Шпион: самопроверка базы слов.
   Гонять после любого изменения js/spy-data.js. Только Node, без
   сторонних зависимостей.

   Инварианты контракта 01-DATA-AGENT.md:
   - модуль подключается в Node через CommonJS;
   - единственная структура данных — SPY_DATA.categories, без
     хардкорного пула и меток, которые UI мог бы показать в хардкоре;
   - от 8 категорий: у каждой уникальный непустой id, непустое имя и
     не менее 18 слов; слова — непустые строки;
   - дубли между категориями с учётом регистра, ё/е, пробелов и
     пунктуации запрещены; каждое слово встречается в пуле ровно один
     раз;
   - общий пул достаточно велик. */
'use strict';

let SPY_DATA;
try {
  SPY_DATA = require('../js/spy-data.js');
} catch (e) {
  console.error('ПРОВАЛ: js/spy-data.js не загружается через require: ' + e.message);
  process.exit(1);
}

let fails = 0, checks = 0;
const eq = (actual, expected, msg) => {
  checks++;
  if (actual !== expected) {
    fails++;
    console.error('ПРОВАЛ: ' + msg + ' — ожидалось ' + JSON.stringify(expected) +
      ', получено ' + JSON.stringify(actual));
  }
};
const ok = (cond, msg) => eq(cond === true, true, msg);

/* ── Форма модуля: только categories, никаких доп. структур ── */
ok(SPY_DATA !== null && typeof SPY_DATA === 'object' && !Array.isArray(SPY_DATA),
  'SPY_DATA — объект');
const topKeys = Object.keys(SPY_DATA || {});
eq(topKeys.length, 1, 'у SPY_DATA ровно один ключ (без хардкорного пула и меток)');
eq(topKeys[0], 'categories', 'ключ называется categories');
const cats = SPY_DATA && SPY_DATA.categories;
ok(Array.isArray(cats) && cats.length > 0, 'categories — непустой массив');
eq(cats.length >= 8, true, 'категорий не менее 8, сейчас ' + (cats ? cats.length : 0));

/* ── Нормализация: регистр, ё/е, пробелы, пунктуация ── */
const norm = s => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');

if (Array.isArray(cats)) {
  const seenIds = new Set();
  const pool = new Map(); // нормализованное слово → id категории
  let total = 0;

  cats.forEach(cat => {
    const where = cat && cat.id ? 'категория «' + cat.id + '»' : 'безымянная категория';

    ok(cat !== null && typeof cat === 'object' && !Array.isArray(cat), where + ' — объект');
    if (cat === null || typeof cat !== 'object' || Array.isArray(cat)) return;

    const id = cat.id, name = cat.name, words = cat.words;
    ok(typeof id === 'string' && /^[a-z]+$/.test(id), where + ': id — непустая строка в формате [a-z]+');
    eq(seenIds.has(id), false, 'id «' + id + '» уникален');
    seenIds.add(id);
    ok(typeof name === 'string' && name.trim().length > 0, where + ': непустое русское имя');
    ok(Array.isArray(words) && words.length > 0, where + ': words — непустой массив');
    eq(words.length >= 18, true, where + ' («' + name + '»): слов не менее 18, сейчас ' + words.length);

    const seenInCat = new Set();
    (words || []).forEach(w => {
      ok(typeof w === 'string', where + ': слово — строка (' + JSON.stringify(w) + ')');
      if (typeof w !== 'string') return;
      ok(w.trim().length >= 2, where + ': слово не пустое и осмысленное (' + JSON.stringify(w) + ')');
      ok(w === w.trim(), where + ': нет пробелов по краям (' + JSON.stringify(w) + ')');
      ok(!/\s{2,}/.test(w), where + ': нет двойных пробелов (' + JSON.stringify(w) + ')');
      ok(/^[а-яё][а-яё\s-]*$/i.test(w), where + ': только кириллица/пробел/дефис (' + JSON.stringify(w) + ')');
      const key = norm(w);
      ok(key.length > 0, where + ': после нормализации слово не пустое (' + JSON.stringify(w) + ')');
      eq(seenInCat.has(key), false, where + ': дубль внутри категории (' + w + ')');
      seenInCat.add(key);
      eq(pool.has(key), false,
        'слово «' + w + '» уже есть в категории «' + pool.get(key) + '» (дубль между категориями)');
      pool.set(key, id);
      total++;
    });
  });

  /* ── Общий пул: достаточно велик, каждое слово ровно один раз ── */
  eq(pool.size, total, 'все записи пула уникальны после нормализации');
  eq(total >= 150, true, 'общий пул достаточно велик: сейчас ' + total + ' слов, минимум 150');

  if (!fails) {
    console.log('OK: ' + checks + ' проверок пройдено — категорий: ' + cats.length +
      ', слов в пуле: ' + total);
    console.log('Категории: ' + cats.map(c => c.name + ' (' + c.words.length + ')').join(', '));
  }
} else {
  if (!fails) console.error('ПРОВАЛ: categories не массив — дальнейшие проверки невозможны');
  fails++;
}

process.exit(fails ? 1 : 0);
