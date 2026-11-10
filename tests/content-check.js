/* ═══════════════ Процедура самопроверки контента (контент-пак v2, §5) ═══════════════
   Запуск: node tests/content-check.js — гонять после ЛЮБОГО изменения
   js/data.js / js/phrase-data.js (и перед каждым релизом).

   Здесь — инварианты ВСЕЙ базы: счётчики, поцелуи, токены (с инвентарём),
   дубликаты (полные — ошибка, похожие — на ручную проверку), таймеры,
   формат фраз, служебные пометки редактуры.
   Правила «только для новых записей» (новый truth кончается «?», новые
   [[тайно]]/[[мод:]]/[[пояснение:]] не добавлены) проверяются в момент
   обновления контента по git diff — разовая сверка, не инвариант. */
'use strict';
globalThis.window = globalThis;
const COUNTS = require('./counts.js');
require('../js/data.js');
require('../js/phrase-data.js');
const FANT = window.FANT, PHRASE = window.PHRASE;

let errors = 0, warnings = 0;
const err = m => { errors++; console.error('ОШИБКА        ' + m); };
const warn = m => { warnings++; console.error('ручная проверка: ' + m); };

const T = FANT.tasks;
const LEVELS = ['fun', 'soft', 'hot'], TYPES = ['truth', 'action'];

/* ── §5.1 Счётчики: база, пакеты, фразы — против tests/counts.js и README ── */
const actual = {};
LEVELS.forEach(lv => TYPES.forEach(tp => { actual[lv + '.' + tp] = T[lv][tp].length; }));
Object.entries(COUNTS.tasks).forEach(([k, v]) => {
  if (actual[k] !== v) err(`счётчик ${k} = ${actual[k]}, ожидание (counts.js/README) ${v}`);
});
const baseTotal = Object.values(actual).reduce((a, b) => a + b, 0);
const packsTotal = FANT.packs.reduce((a, p) => a + p.truth.length + p.action.length, 0);
const phActual = { friendly: PHRASE.prompts.friendly.length, names: PHRASE.prompts.names.length, dark: PHRASE.prompts.dark.length };
const phrasesTotal = Object.values(phActual).reduce((a, b) => a + b, 0);
console.log(`Задания: ${JSON.stringify(actual)}`);
console.log(`Итого: база ${baseTotal}/${COUNTS.baseTotal} · пакеты ${packsTotal}/${COUNTS.packs} · фразы ${phrasesTotal}/${COUNTS.phrasesTotal} (факт/ожидание)`);
if (baseTotal !== COUNTS.baseTotal) err(`база ${baseTotal} ≠ ${COUNTS.baseTotal} — обнови tests/counts.js и README вместе`);
if (packsTotal !== COUNTS.packs) err(`пакеты ${packsTotal} ≠ ${COUNTS.packs}`);
Object.entries(COUNTS.phrases).forEach(([k, v]) => {
  if (phActual[k] !== v) err(`фразы ${k} = ${phActual[k]}, ожидание ${v}`);
});
if (phrasesTotal !== COUNTS.phrasesTotal) err(`фразы ${phrasesTotal} ≠ ${COUNTS.phrasesTotal}`);

/* ── §5.2 Поцелуи не возвращаются в Soft/Hot и в не-friendly фразы ──
   (сказка «Поцеловал лягушку» во friendly разрешена ревью) */
const KISS = /поцелу|целу/i;
LEVELS.forEach(lv => TYPES.forEach(tp => T[lv][tp].forEach(t => {
  if (KISS.test(t)) err(`поцелуй в ${lv}.${tp}: «${t.slice(0, 60)}…»`);
})));
Object.entries(PHRASE.prompts).forEach(([cat, arr]) => arr.forEach(p => {
  if (KISS.test(p) && cat !== 'friendly') err(`поцелуй в фразах ${cat}: «${p.slice(0, 60)}…»`);
}));
// оговорки «без касаний» в карточках не нужны (правило пакета: добровольность без дисклеймеров)
LEVELS.forEach(lv => ['soft', 'hot'].includes(lv) && TYPES.forEach(tp => T[lv][tp].forEach(t => {
  if (/без касани|без прикосновений/i.test(t)) warn(`оговорка про касания в ${lv}.${tp}: «${t.slice(0, 60)}…»`);
})));

/* ── §5.3 Токены: только разрешённый набор + вывод инвентаря ── */
const OK_TOK = new Set(['name', 'name-acc', 'name-dat', 'name-inst', 'name-gen',
  'other', 'other-acc', 'other-dat', 'other-inst', 'other-gen', 'room', 'object']);
const inventory = new Map();
const countTok = tok => inventory.set(tok, (inventory.get(tok) || 0) + 1);
LEVELS.forEach(lv => TYPES.forEach(tp => T[lv][tp].forEach(t =>
  (t.match(/\{[^}]+\}/g) || []).forEach(tok => {
    const k = tok.slice(1, -1);
    if (!OK_TOK.has(k)) err(`неизвестный токен ${tok} в ${lv}.${tp}: «${t.slice(0, 50)}…»`);
    countTok(k);
  }))));
Object.entries(PHRASE.prompts).forEach(([cat, arr]) => arr.forEach(p =>
  (p.match(/\{[^}]+\}/g) || []).forEach(tok => {
    const k = tok.slice(1, -1);
    if (!OK_TOK.has(k)) err(`неизвестный токен ${tok} в фразах ${cat}: «${p.slice(0, 50)}…»`);
    countTok(k);
  })));
console.log('Инвентарь токенов (§5.3): ' +
  [...inventory.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `{${t}}×${c}`).join(', '));

/* ── §5.4 Дубликаты: полные — ошибка; похожие (≥80% общих слов) — вручную ── */
const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const wordSet = s => new Set(norm(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2));
const jaccard = (a, b) => {
  const A = wordSet(a), B = wordSet(b);
  let inter = 0;
  A.forEach(w => { if (B.has(w)) inter++; });
  return inter / (A.size + B.size - inter || 1);
};
const dupCheck = (where, arr) => {
  const seen = new Map();
  arr.forEach(t => {
    const k = norm(t);
    if (seen.has(k)) err(`полный дубль в ${where}: «${t.slice(0, 60)}»`);
    else seen.set(k, t);
  });
  // похожие формулировки внутри одного массива — не ошибка, но смотрим глазами
  const list = [...seen.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (jaccard(list[i], list[j]) >= 0.8) {
        warn(`похожие записи в ${where}:\n      ① «${list[i].slice(0, 70)}»\n      ② «${list[j].slice(0, 70)}»`);
      }
    }
  }
};
LEVELS.forEach(lv => TYPES.forEach(tp => dupCheck(`${lv}.${tp}`, T[lv][tp])));
Object.entries(PHRASE.prompts).forEach(([cat, arr]) => dupCheck(`фразы.${cat}`, arr));

/* ── §5.5 Формат: таймеры только 15/20/30/60/120, фразы кончаются «...», ──
   служебные пометки редактуры и счётчик сервисных тегов */
const LEGAL_SECS = new Set([15, 20, 30, 60, 120]);
const tagCount = { '[[тайно]]': 0, '[[мод:': 0, '[[пояснение:': 0, '[[без-мод]]': 0 };
LEVELS.forEach(lv => TYPES.forEach(tp => T[lv][tp].forEach(t => {
  (t.match(/\[\[таймер (\d+)\]\]/g) || []).forEach(tag => {
    if (!LEGAL_SECS.has(parseInt(tag.match(/\d+/)[0], 10))) err(`нелегальный таймер ${tag} в ${lv}.${tp} (разрешены 15/20/30/60/120)`);
  });
  Object.keys(tagCount).forEach(tag => { if (t.includes(tag)) tagCount[tag]++; });
  if (/замена №|не использовать|не копировать/i.test(t)) err(`служебная пометка редактуры в ${lv}.${tp}: «${t.slice(0, 60)}…»`);
})));
Object.entries(PHRASE.prompts).forEach(([cat, arr]) => arr.forEach(p => {
  if (!/(\.\.\.|…)(»|")?$/.test(p)) err(`фраза ${cat} не заканчивается «...»: «${p.slice(0, 60)}…»`);
}));
console.log('Сервисные теги в базе: ' + Object.entries(tagCount).map(([t, c]) => `${t}…×${c}`).join(', '));

/* ── Итог ── */
if (errors) { console.error(`\nИТОГ: ${errors} ошибок${warnings ? ', ' + warnings + ' на ручную проверку' : ''}`); process.exit(1); }
console.log(warnings ? `\nИТОГ: ошибок нет, ${warnings} формулировок на ручную проверку (см. выше)` : '\nИТОГ: все процедуры самопроверки §5 пройдены');
