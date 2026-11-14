/* ═══════════════ Тесты чистой логики без фреймворка ═══════════════
   Запуск: node tests/core.test.js
   Данные-файлы кладут глобалы на window — в Node подкладываем window = globalThis. */
'use strict';
globalThis.window = globalThis;
require('../js/lang.js');
require('../js/data.js');
require('../js/combo-data.js');
require('../js/phrase-data.js');

const { decline, guessGender, renderTemplate, speakSafe, choicePreview, detectTimerSecs, wheelPool } = window.FANT_LANG;
const FANT = window.FANT;
const COMBO = FANT.combo;   // P4: комбинаторика живёт внутри window.FANT, отдельного глобала нет
const PHRASE = window.PHRASE;

let n = 0, fails = 0;
function eq(actual, expected, label) {
  n++;
  if (actual !== expected) { fails++; console.error(`FAIL  ${label}\n      получилось: ${actual}\n      ожидалось:  ${expected}`); }
}
function ok(cond, label) { n++; if (!cond) { fails++; console.error(`FAIL  ${label}`); } }

/* ── NAME-1: таблица склонений из ревью ── */
const CASES = [
  // [имя, acc, dat, inst, gen, пол]
  ['Саша', 'Сашу', 'Саше', 'Сашей', 'Саши', ''],
  ['Маша', 'Машу', 'Маше', 'Машей', 'Маши', ''],
  ['Даша', 'Дашу', 'Даше', 'Дашей', 'Даши', ''],
  ['Наташа', 'Наташу', 'Наташе', 'Наташей', 'Наташи', ''],
  ['Лёша', 'Лёшу', 'Лёше', 'Лёшей', 'Лёши', ''],
  ['Илья', 'Илью', 'Илье', 'Ильёй', 'Ильи', 'm'],
  ['Дарья', 'Дарью', 'Дарье', 'Дарьей', 'Дарьи', 'f'],
  ['Софья', 'Софью', 'Софье', 'Софьей', 'Софьи', 'f'],
  ['Марья', 'Марью', 'Марье', 'Марьей', 'Марьи', 'f'],
  ['Лев', 'Льва', 'Льву', 'Львом', 'Льва', 'm'],
  ['Павел', 'Павла', 'Павлу', 'Павлом', 'Павла', 'm'],
  ['Пётр', 'Петра', 'Петру', 'Петром', 'Петра', 'm'],
  ['Любовь', 'Любовь', 'Любови', 'Любовью', 'Любови', 'f'],
  ['Анна-Мария', 'Анну-Марию', 'Анне-Марии', 'Анной-Марией', 'Анны-Марии', ''],
  ['Жизель', 'Жизель', 'Жизели', 'Жизелью', 'Жизели', 'f'],
  // базовые, работали и раньше
  ['Ника', 'Нику', 'Нике', 'Никой', 'Ники', ''],
  ['Нина', 'Нину', 'Нине', 'Ниной', 'Нины', ''],
  ['Мария', 'Марию', 'Марии', 'Марией', 'Марии', ''],
  ['Даня', 'Даню', 'Дане', 'Даней', 'Дани', ''],
  ['Андрей', 'Андрея', 'Андрею', 'Андреем', 'Андрея', ''],
  ['Игорь', 'Игоря', 'Игорю', 'Игорем', 'Игоря', ''],
  ['Денис', 'Дениса', 'Денису', 'Денисом', 'Дениса', ''],
  ['Фома', 'Фому', 'Фоме', 'Фомой', 'Фомы', 'm'],
];
CASES.forEach(([name, acc, dat, inst, gen, g]) => {
  eq(decline(name, 'acc', g), acc, `acc ${name}`);
  eq(decline(name, 'dat', g), dat, `dat ${name}`);
  eq(decline(name, 'inst', g), inst, `inst ${name}`);
  eq(decline(name, 'gen', g), gen, `gen ${name}`);
});

// Любовь без пола: fallback как у мужского ь-имени, но не «Любовя»
ok(!decline('Любовь', 'gen', '').startsWith('Любовя'), 'Любовь gen без пола не «Любовя»');
// составное через пробел
eq(decline('Анна Мария', 'acc'), 'Анну Марию', 'acc Анна Мария');
// латиница
eq(decline('denplis', 'inst'), "denplis'ом", 'inst латиница');
// nom — само имя
eq(decline('Саша', 'nom'), 'Саша', 'nom не определён → как есть');

/* ── GENDER-1: эвристика пола ── */
eq(guessGender('Саша'), 'm', 'guessGender Саша (м-уменьшительное)');
eq(guessGender('Маша'), 'f', 'guessGender Маша');
eq(guessGender('Илья'), 'm', 'guessGender Илья');
eq(guessGender('Любовь'), 'f', 'guessGender Любовь');
eq(guessGender('Никита'), 'm', 'guessGender Никита');
eq(guessGender('Денис'), 'm', 'guessGender Денис');
eq(guessGender(''), '', 'guessGender пустое');

/* ── GENDER-1: renderTemplate во всех режимах пола ── */
const tpl1 = '{name}, (целовался|целовалась) ли ты с {other-inst}?';
eq(renderTemplate(tpl1, 'Маша', 'Дима', 'f', 'm').plain, 'Маша, целовалась ли ты с Димой?', 'rt ж-род');
eq(renderTemplate(tpl1, 'Дима', 'Маша', 'm', 'f').plain, 'Дима, целовался ли ты с Машей?', 'rt м-род');
const neutral = renderTemplate(tpl1, 'Xyz', 'Abc', '', '').plain;
eq(neutral, "Xyz, целовался/целовалась ли ты с Abc'ом?", 'rt без пола — нейтральный слэш');
ok(!/[()|]/.test(neutral), 'rt без пола — нет скобок и черты');
const tpl2 = '{name}, отправил(а) сообщение';
eq(renderTemplate(tpl2, 'Дима', '', 'm', '').plain, 'Дима, отправил сообщение', 'rt м: (а) убрано');
eq(renderTemplate(tpl2, 'Маша', '', 'f', '').plain, 'Маша, отправила сообщение', 'rt ж: (а) → а');
ok(!/[()]/.test(renderTemplate(tpl2, 'Xyz', '', '', '').plain), 'rt без пола: (а) не остаётся');
// служебные токены вычищаются
const tok = renderTemplate('{name}, скажи [[таймер 30]] [[тайно]] [[пояснение:х]] [[без-мод]]', 'Дима', '', 'm', '').plain;
eq(tok, 'Дима, скажи', 'rt служебные токены удалены');
// speakSafe: скобки, черты и фигурные скобки не для ушей
eq(speakSafe('Ты (а) любопытн(а)|любопытна? {name}'), 'Ты а любопытналюбопытна? name', 'speakSafe чистит ()|{}');

/* ── COMBO-1: совместимость глагол × формат, 10 000 генераций ── */
// копия логики выбора комбо из drawTask (app.js) на чистых данных
function comboDraw() {
  const obj = COMBO.objects[Math.floor(Math.random() * COMBO.objects.length)];
  const v = obj.verbs[Math.floor(Math.random() * obj.verbs.length)];
  const fms = COMBO.formats.filter(f => !f.verbs || f.verbs.includes(v));
  const fm = fms[Math.floor(Math.random() * fms.length)];
  const objPhrase = (v === 'расскажи' && obj.tell) ? obj.tell : obj.o;
  return v + ' ' + objPhrase + ' ' + fm.f;
}
for (let i = 0; i < 10000; i++) {
  const s = comboDraw();
  ok(!/^(расскажи|отрекламируй) .*без слов/.test(s), 'комбо без абсурда: ' + s);
  ok(!/^изобрази .*в рифму/.test(s) && !/^покажи .*в рифму/.test(s), 'в рифму без изобрази/покажи: ' + s);
  ok(!/^изобрази .*как ведущий/.test(s) && !/^покажи .*как ведущий/.test(s), 'новости без изобрази/покажи: ' + s);
  ok(!/^расскажи (?!про)/.test(s), 'расскажи управляет падежом («про»): ' + s);
}
// «без слов» должен оставаться достижимым: пантомима не исчезла
let secretSeen = false;
for (let i = 0; i < 20000 && !secretSeen; i++) if (/без слов/.test(comboDraw())) secretSeen = true;
ok(secretSeen, 'комбо «без слов» всё ещё генерируется');

/* ── PREVIEW-1: секретные задания не утекают в превью выбора ── */
eq(choicePreview('{name}, признайся в тайном [[тайно]]', 'truth'), 'Секретный вопрос', 'preview secret truth → подпись');
eq(choicePreview('{name}, изобрази пантомиму [[тайно]]', 'action'), 'Секретное действие', 'preview secret action → подпись');
eq(choicePreview('{name}, обычное задание без секрета', 'truth'), null, 'preview обычное → полный текст, не подпись');
eq(choicePreview('{name}, обычное действие', 'action'), null, 'preview обычное действие → полный текст');
eq(choicePreview('', 'truth'), null, 'пустой шаблон не секрет');
// вся база: каждый [[тайно]]-фант определяется помощником, подпись не содержит текста задания
let secretCount = 0, secretLeak = 0;
Object.keys(FANT.tasks).forEach(lv => {
  ['truth', 'action'].forEach(tp => {
    FANT.tasks[lv][tp].forEach(t => {
      if (/\[\[тайно\]\]/.test(t)) {
        secretCount++;
        const label = choicePreview(t, tp);
        if (label !== (tp === 'truth' ? 'Секретный вопрос' : 'Секретное действие')) secretLeak++;
        // подпись не должна содержать кусков задания — иначе превью утечёт
        if (label && t.replace(/\[\[тайно\]\]/g, '').includes(label)) secretLeak++;
      }
    });
  });
});
ok(secretCount > 0, 'в базе есть секретные задания (' + secretCount + ' шт.)');
eq(secretLeak, 0, 'ни один секрет не утекает в подпись превью');

/* ── detectTimerSecs: таймер из текста задания ── */
eq(detectTimerSecs('{name}, молчи [[таймер 20]]'), 20, 'таймер явный');
eq(detectTimerSecs('30 секунд изображай замёрзшего'), 30, 'таймер из цифр+секунд');
eq(detectTimerSecs('2 минуты на импровизацию'), 120, 'таймер из цифр+минут');
eq(detectTimerSecs('10-секундный взгляд в камеру'), 10, 'таймер из «10-секундный»');
eq(detectTimerSecs('держи одну минуту'), 60, 'таймер из «одну минуту»');
eq(detectTimerSecs('подожди три минуты'), 180, 'таймер из «три минуты»');
eq(detectTimerSecs('{name}, просто расскажи'), 0, 'без таймера');
// вся база: [[таймер N]] только с разрешёнными N (правило контент-пака)
const LEGAL_SECS = new Set([15, 20, 30, 60, 120]);
Object.keys(FANT.tasks).forEach(lv => {
  ['truth', 'action'].forEach(tp => {
    FANT.tasks[lv][tp].forEach(t => {
      (t.match(/\[\[таймер (\d+)\]\]/g) || []).forEach(tag => {
        ok(LEGAL_SECS.has(parseInt(tag.match(/\d+/)[0], 10)), `легальный таймер в ${lv}.${tp}: ${tag}`);
      });
    });
  });
});

/* ── WHEEL-1: пул колеса — чистая функция wheelPool ── */
{
  const rem3 = ['А', 'Б', 'В'];
  let p = wheelPool(rem3, ['А']);           // последний победитель «А» исключается при ≥3
  eq(p.length, 2, 'WHEEL-1: при 3 игроках пул без последнего');
  ok(!p.some(i => rem3[i] === 'А'), 'WHEEL-1: последний победитель не в пуле');
  p = wheelPool(rem3, []);                  // без истории — весь пул
  eq(p.length, 3, 'WHEEL-1: без истории пул полный');
  const rem2 = ['А', 'Б'];
  eq(wheelPool(rem2, ['А']).length, 2, 'WHEEL-1: при 2 игроках исключения нет (иначе предопределено)');
  // симуляция 50 000 спинов: при 3 игроках последний не выпадает вовсе
  let repeat = 0;
  for (let i = 0; i < 50000; i++) {
    const pool = wheelPool(rem3, ['А']);
    const w = pool[Math.floor(Math.random() * pool.length)];
    if (rem3[w] === 'А') repeat++;
  }
  eq(repeat, 0, 'WHEEL-1: симуляция — последний победитель не выпадает');
  // а при 2 игроках — выпадает (повтор разрешён, механика не ломается)
  let repeat2 = 0;
  for (let i = 0; i < 50000; i++) {
    const pool = wheelPool(rem2, ['А']);
    const w = pool[Math.floor(Math.random() * pool.length)];
    if (rem2[w] === 'А') repeat2++;
  }
  ok(repeat2 > 10000, 'WHEEL-1: при 2 игроках повтор возможен (' + repeat2 + '/50000)');
}

/* ── Инварианты данных: токены, дубликаты, пунктуация, поцелуи ── */
// разрешённый набор токенов для window.FANT.tasks (правило контент-пака)
const TASK_TOKENS = new Set(['name', 'name-acc', 'name-dat', 'name-inst', 'name-gen',
  'other', 'other-acc', 'other-dat', 'other-inst', 'other-gen', 'room', 'object']);
const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
const allTasks = [];
Object.keys(FANT.tasks).forEach(lv => {
  ['truth', 'action'].forEach(tp => {
    const seen = new Set();
    FANT.tasks[lv][tp].forEach(t => {
      ok(typeof t === 'string' && t.length > 5, `${lv}.${tp}: непустая строка`);
      allTasks.push([lv + '.' + tp, t]);
      // токены — только из разрешённого набора
      (t.match(/\{([^}]+)\}/g) || []).forEach(tok => {
        ok(TASK_TOKENS.has(tok.slice(1, -1)), `${lv}.${tp}: легальный токен ${tok} в «${t.slice(0, 40)}…»`);
      });
      // полные дубликаты внутри массива (после нормализации регистра/пробелов)
      const key = norm(t);
      ok(!seen.has(key), `${lv}.${tp}: без дублей — «${t.slice(0, 40)}…»`);
      seen.add(key);
    });
  });
});
// поцелуи не возвращаются в Soft/Hot (контент-пак v2), оговорки «без касаний» не нужны
const KISS = /поцелу|целу(й|е|ю|ешь|ет|ем|ете|ют|уй)/i;
['soft', 'hot'].forEach(lv => {
  ['truth', 'action'].forEach(tp => {
    FANT.tasks[lv][tp].forEach(t => {
      ok(!KISS.test(t), `${lv}.${tp}: без поцелуев — «${t.slice(0, 50)}…»`);
      ok(!/без касани|без прикосновений/i.test(t), `${lv}.${tp}: без оговорок про касания`);
    });
  });
});
// служебные пометки редактуры не попадают в данные
allTasks.forEach(([where, t]) => {
  ok(!/замена №|не использовать|не копировать/i.test(t), `${where}: без служебных пометок`);
});
// база зада́ний: каждая запись ссылается на игрока (кроме известных безымянных старых Hot-вопросов)
let nameless = 0;
allTasks.forEach(([where, t]) => {
  if (!/\{(name|other)/.test(t)) { nameless++; console.error(`      … задание без токена игрока (${where}): ${t.slice(0, 60)}`); }
});
ok(nameless <= 7, 'заданий без токена игрока не больше известных старых семи (' + nameless + ')');

// фразы: все начинаются законченным началом и заканчиваются «...» (возможно с закрывающей кавычкой)
Object.keys(PHRASE.prompts).forEach(cat => {
  const seen = new Set();
  PHRASE.prompts[cat].forEach(p => {
    ok(typeof p === 'string' && /(\.\.\.|…)(»|")?$/.test(p), `${cat}: фраза заканчивается «...» — «${p.slice(0, 40)}…»`);
    const key = norm(p);
    ok(!seen.has(key), `${cat}: без дублей — «${p.slice(0, 40)}…»`);
    seen.add(key);
    // токены фраз рендерятся renderTemplate: только известные падежные (pack-правило для новых записей)
    (p.match(/\{([^}]+)\}/g) || []).forEach(tok => {
      ok(['name', 'name-acc', 'name-dat', 'name-inst', 'name-gen',
        'other', 'other-acc', 'other-dat', 'other-inst', 'other-gen'].includes(tok.slice(1, -1)),
        `${cat}: легальный токен ${tok}`);
    });
  });
});
// счётчики базы защищены тестом: единая точка — tests/counts.js (числа README)
const COUNTS = require('./counts.js');
Object.entries(COUNTS.tasks).forEach(([k, v]) => {
  const [lv, tp] = k.split('.');
  eq(FANT.tasks[lv][tp].length, v, `${k} = ${v} (counts.js)`);
});
eq(Object.values(COUNTS.tasks).reduce((a, b) => a + b, 0), COUNTS.baseTotal, 'counts.js: сумма tasks = baseTotal');
eq(Object.values(FANT.tasks).reduce((a, lv) => a + lv.truth.length + lv.action.length, 0), COUNTS.baseTotal, `база = ${COUNTS.baseTotal} (как в README)`);
eq(FANT.packs.reduce((a, p) => a + p.truth.length + p.action.length, 0), COUNTS.packs, `пакеты = ${COUNTS.packs} (как в README)`);
Object.entries(COUNTS.phrases).forEach(([k, v]) => eq(PHRASE.prompts[k].length, v, `${k} = ${v} (counts.js)`));
eq(Object.values(COUNTS.phrases).reduce((a, b) => a + b, 0), COUNTS.phrasesTotal, 'counts.js: сумма phrases = phrasesTotal');
eq(Object.values(PHRASE.prompts).reduce((a, arr) => a + arr.length, 0), COUNTS.phrasesTotal, `фразы = ${COUNTS.phrasesTotal} (как в README)`);
ok(FANT.packs.length === 3 && FANT.packs.every(p => p.truth.length && p.action.length), 'пакеты на месте (3, непустые)');

/* ── PHRASE-5/6: pickPhraseTargets — чистый выбор целей фразы (SKIP до интеграции) ──
   Замороженный менеджером контракт (предложен тестами, сверить при интеграции
   с агентом приложения): чистая функция-член FANT_LANG в js/lang.js с инъекцией
   rnd — pickPhraseTargets(template, answerer, players, rnd) → { who, other, template },
   где who/other — имена из players; template — исходный шаблон без тега [[о себе]];
   other === null, если шаблон не использует {other}. Поведение:
   • [[о себе]] → who === answerer (текст обращён к самому отвечающему);
   • обычная → who !== answerer;
   • при 2 игроках и {other} в шаблоне → other === второй игрок, who !== other
     (PHRASE-6: никакого «other = who»);
   • при 3+ игроках → who, other и answerer попарно различны;
   • тег [[о себе]] не возвращается сырым ни в template, ни в рендере
     (renderTemplate/speakSafe) — попадание тега в HTML/preview/TTS невозможно;
   • недостаток игроков — без undefined: who всегда валидное имя.
   Пока агент приложения не влил ветку — блок честно пропускается с пометкой
   SKIP (не маскируя будущий провал); если реализация появится под другим именем,
   SKIP-вывод подскажет имя для сверки контракта. */
{
  const FANT_LANG = window.FANT_LANG;
  const CANDIDATES = ['pickPhraseTargets', 'choosePhraseTargets', 'phraseTargets'];
  const pick = CANDIDATES.find(cn => typeof FANT_LANG[cn] === 'function');
  if (!pick) {
    console.log('SKIP: FANT_LANG.pickPhraseTargets ещё не интегрирована (контракт заморожен, ждём agent/auditfix2-app)');
  } else {
    if (pick !== 'pickPhraseTargets') {
      console.log(`ВНИМАНИЕ: функция целей найдена как FANT_LANG.${pick} — сверить имя контракта с тестом`);
    }
    const P4 = ['Аня', 'Боря', 'Вика', 'Гоша'];
    const SELF = '[[о себе]] Каким своим талантом ты гордишься, {name}?';
    const PAIR = '{name}, если бы вы с {other} попали в лифт, что бы вы там обсуждали?';
    const rndAt = k => () => k;                       // фиксированное значение rnd

    // self-фраза: {name} адресуется отвечающему
    {
      const r = FANT_LANG[pick](SELF, 'Боря', P4, rndAt(0));
      eq(r.who, 'Боря', '[[о себе]]: who = отвечающий');
      eq(r.template.includes('[[о себе]]'), false, '[[о себе]]: тег удалён из возвращённого шаблона');
    }
    // обычная фраза: {name} — не отвечающий
    {
      const r = FANT_LANG[pick](PAIR, 'Боря', P4, rndAt(0));
      ok(r.who !== 'Боря', 'обычная фраза: who !== отвечающего');
      ok(r.template.includes('[[о себе]]') === false, 'обычная фраза: тег не добавляется');
    }
    // 2 игрока: other — второй игрок, дубли «other = who» нет (PHRASE-6)
    {
      const P2 = ['Аня', 'Боря'];
      const r1 = FANT_LANG[pick](PAIR, 'Аня', P2, rndAt(0));   // обычная
      eq(r1.who, 'Боря', '2 игрока, обычная: who = второй игрок');
      eq(r1.other, 'Аня', '2 игрока, обычная: other = второй игрок (не дубль who)');
      ok(r1.who !== r1.other, '2 игрока, обычная: {name} и {other} различны');
      const r2 = FANT_LANG[pick](SELF, 'Аня', P2, rndAt(0));   // о себе
      eq(r2.who, 'Аня', '2 игрока, [[о себе]]: who = отвечающий');
      ok(r2.other !== r2.who, '2 игрока, [[о себе]]: other !== who');
    }
    // 3 игрока: who, other и отвечающий попарно различны
    {
      const P3 = ['Аня', 'Боря', 'Вика'];
      const r = FANT_LANG[pick](PAIR, 'Боря', P3, rndAt(0));
      ok(r.who !== 'Боря' && r.other !== 'Боря', '3 игрока: who и other — не отвечающий');
      ok(r.who !== r.other, '3 игрока: who !== other');
      ok(P3.includes(r.who) && (r.other === null || P3.includes(r.other)), '3 игрока: цели из списка игроков');
    }
    // 5 игроков: перебор rnd — пул who не вырожден, other различен и валиден
    {
      const P5 = P4.concat(['Даша']);
      const whos = new Set(), others = new Set();
      for (let k = 0; k < 20; k++) {
        const r = FANT_LANG[pick](PAIR, 'Боря', P5, rndAt(k / 20));
        ok(r.who !== 'Боря', `5 игроков, rnd=${k / 20}: who !== отвечающего`);
        ok(r.who !== r.other, `5 игроков, rnd=${k / 20}: who !== other`);
        ok(r.other !== 'Боря' && P5.includes(r.other), `5 игроков, rnd=${k / 20}: other валиден и не отвечающий`);
        whos.add(r.who);
        others.add(r.other);
      }
      ok(whos.size >= 2, `5 игроков: выбор who не вырожден при разных rnd (получено ${whos.size})`);
      ok(others.size >= 2, `5 игроков: other различен при разных rnd (получено ${others.size})`);
    }
    // тег не попадает сырым в рендер и озвучку (HTML/preview/TTS)
    {
      const r = FANT_LANG[pick](SELF, 'Вика', P4, rndAt(0));
      const out = renderTemplate(r.template, r.who, r.other || r.who);
      ok(out.html.includes('[[о себе]]') === false, 'тег отсутствует в HTML');
      ok(out.plain.includes('[[о себе]]') === false, 'тег отсутствует в plain (preview)');
      ok(speakSafe(out.plain).includes('[[о себе]]') === false, 'тег отсутствует в TTS-тексте');
    }
    // недостаток игроков: без undefined, без дубля там, где он не задуман
    {
      const r = FANT_LANG[pick](SELF, 'Аня', ['Аня'], rndAt(0));
      ok(typeof r.who === 'string' && r.who.length > 0, '1 игрок: who — валидная строка, не undefined');
      const r2 = FANT_LANG[pick](PAIR, 'Аня', ['Аня'], rndAt(0));
      ok(typeof r2.who === 'string' && r2.who.length > 0, '1 игрок + {other}: who — валидная строка, не undefined');
    }
  }
}

console.log(fails ? `\n${fails}/${n} упало` : `OK: ${n} проверок пройдено`);
process.exit(fails ? 1 : 0);
