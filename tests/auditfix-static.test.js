/* ═══════════════ AUDITFIX-STATIC: регрессии общего аудита 1/2/4 ═══════════════
   Запуск: node tests/auditfix-static.test.js
   Статические проверки реализации AUDIT-01/03 в js/app.js по фактическим
   маркерам (порядок операторов внутри блоков, а не наличие слов в комментариях):
   1) Back-история «Фантов»: уход системной кнопкой с активного задания гасит
      task timer и озвучку; мёртвые screen-choice/screen-reveal без живого
      pending заменяются колесом через history.replaceState;
   2) оценка «Продолжи фразу»: guard rated в rate-хендлере стоит ДО записи
      очков, rated фиксируется ДО push в phrase.scores/phStats; resetPairScreen
      скрывает панель оценки и сбрасывает выбор; мёртвый screen-phrase-task без
      неоценённой пары заменяется экраном круга;
   4) сброс истории выпавших пересоздает мешки (state.bags = {}), не трогая
      blacklist/comboBan.
   ОГРАНИЧЕНИЕ: настоящего браузерного harness для системного Back в проекте
   нет (vanilla JS без зависимостей) — эти проверки фиксируют маркеры кода,
   а ручной сценарий Back (01-AUDIT-REPORT §«Что стоит дополнительно проверить
   вручную», п.1–2) остаётся аудитору. Поведенческая часть AUDIT-02 покрыта
   в tests/draw-memory.test.js (freezeDrawDeadline, чистая функция ядра). */
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
/* фрагмент исходника между маркерами — порядок операторов внутри блока */
const between = (src, startMarker, endMarker) => {
  const a = src.indexOf(startMarker);
  ok(a >= 0, 'найден маркер начала: ' + startMarker);
  const b = endMarker ? src.indexOf(endMarker, a + startMarker.length) : -1;
  return b >= 0 ? src.slice(a, b) : src.slice(a);
};
const pos = (src, needle) => src.indexOf(needle);

const app = read('js/app.js');

/* ── 1. История «Фантов»: AUDIT-01 ── */
{
  const pop = between(app, "window.addEventListener('popstate'", "/* ── Звук (WebAudio) ── */");
  // уход системной кнопкой с активного задания гасит таймер и озвучку
  ok(pop.includes("if (act0 === 'screen-reveal') { stopTaskTimer(); stopSpeak(); }"),
     'popstate: уход с активного задания останавливает task timer и озвучку');
  // мёртвые экраны хода не resurrect'ятся: без живого pending — колесо
  ok(pop.includes("(target === 'screen-choice' || target === 'screen-reveal') && !pending) target = 'screen-wheel'"),
     'popstate: choice/reveal без живого pending заменяются колесом');
  // экран задания фразы без неоценённой пары — экраном круга
  ok(pop.includes("target === 'screen-phrase-task' && (!phrase.current || phrase.current.rated)) target = 'screen-phrase-round'"),
     'popstate: phrase-task без неоценённой пары заменяется экраном круга');
  // замена цели записывается в текущую запись истории, а не только показывается
  ok(pop.includes('if (target !== st.fant) { try { history.replaceState({ fant: target }'),
     'popstate: подменённая цель фиксируется через history.replaceState');
  ok(pos(pop, 'if (act0 === \'screen-reveal\')') < pos(pop, 'navFromPop = true'),
     'порядок: остановка таймера/озвучки до смены экрана');
}

/* ── 2. Оценка «Продолжи фразу»: AUDIT-01 ── */
{
  // guard и фиксация rated — до записи очков, внутри подтверждения оценки
  const confirm = between(app, "if (e.target.closest('#rateConfirmBtn'))",
    "/* ── Статистика средних оценок фразы ── */");
  const pGuard = pos(confirm, 'if (!cur || cur.rated) return;');
  const pMark = pos(confirm, 'cur.rated = true;');
  const pScore = pos(confirm, 'phrase.scores[who].push(r);');
  const pStats = pos(confirm, 'phStats[who].sum += r;');
  ok(pGuard >= 0 && pMark >= 0 && pScore >= 0 && pStats >= 0,
     'rate-хендлер: guard rated, фиксация и запись оценки присутствуют');
  ok(pGuard < pMark && pMark < pScore && pScore < pStats,
     'порядок: guard rated → cur.rated = true → запись в phrase.scores → запись в phStats');
  ok(confirm.includes('if (!cur || cur.rated) return;') &&
     confirm.indexOf("toast('Выберите оценку')") > pGuard,
     'guard стоит до чтения выбора и записи — повторное подтверждение не увеличивает баллы');
  // rated инициализируется при создании пары
  ok(app.includes("Object.assign(p, { rated: false })"),
     'пара создаётся с rated: false (guard валиден с первого подтверждения)');
  // resetPairScreen синхронизирует UI с состоянием: панель/выбор/подтверждение скрыты
  const reset = between(app, 'function resetPairScreen()', '\n  }');
  ok(reset.includes("$('#ratePanel').classList.add('hidden')"),
     'resetPairScreen скрывает панель оценки');
  ok(reset.includes("$('#rateConfirmBtn').classList.add('hidden')"),
     'resetPairScreen скрывает кнопку подтверждения оценки');
  ok(reset.includes("querySelectorAll('.rate-btn.sel')"),
     'resetPairScreen сбрасывает выбранный балл');
}

/* ── 4. Сброс истории выпавших: AUDIT-03 ── */
{
  const resetBtn = between(app, "$('#setChosenResetBtn').addEventListener('click'", "История выпавших сброшена");
  ok(resetBtn.includes('state.chosen = {};'), 'сброс истории очищает state.chosen');
  ok(resetBtn.includes('state.bags = {};'),
     'сброс истории пересоздаёт активные мешки (выбранное сразу возвращается в колоду)');
  // негативные проверки — по коду без комментариев (в реализации есть поясняющий комментарий)
  const resetCode = resetBtn.replace(/\/\/.*$/gm, '');
  ok(!resetCode.includes('blacklist') && !resetCode.includes('comboBan'),
     'сброс истории не трогает blacklist/comboBan (их сбрасывает «Вернуть убранные задания»)');
  ok(app.includes("$('#setUnbanBtn')"),
     'обработчик «Вернуть убранные задания» существует отдельно от сброса истории');
}

console.log('AUDITFIX static: ' + n + ' проверок пройдено');
