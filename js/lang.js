/* ═══════════════ Фанты — чистая логика без DOM ═══════════════
   Вынесено из app.js, чтобы гонять тесты на Node (tests/core.test.js):
   склонение имён, определение пола по имени, шаблоны заданий.
   Подключается в index.html ДО app.js. */
((root) => {
  'use strict';

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── Склонение имён: acc (кого), dat (кому), inst (с кем), gen (кого/чего) ──
     gender ('m'|'f'|'') нужен только для имён на ь: мужской → -я, женский → -и */
  // творительный с ударным «ё» после ь: Ильёй (Дарьей — безударное «е»)
  const INST_YO = { 'илья': 'ёй' };
  // беглая гласная при склонении: Лев → Льв-, Павел → Павл-, Пётр → Петр-
  const FUGITIVE = { 'лев': 'льв', 'павел': 'павл', 'пётр': 'петр' };
  // женские имена на ь (III склонение): Любовь → Любови, Любовью
  const FEM_SOFT = new Set(['любовь', 'нинель', 'адель', 'жизель', 'руфь', 'изабель', 'эсфирь']);

  function declinePart(low, cs, gender) {
    const stem = low.slice(0, -1);                 // основа без последней буквы
    let forms;
    if (low.endsWith('ия')) {                      // Мария → Марию, Марии, Марией
      forms = { acc: stem + 'ю', dat: stem + 'и', inst: stem + 'ей', gen: stem + 'и' };
    } else if (low.endsWith('ья')) {               // Илья/Дарья → …ью/…ье/…ьей/…ьи
      forms = { acc: stem + 'ю', dat: stem + 'е', inst: stem + (INST_YO[low] || 'ей'), gen: stem + 'и' };
    } else if ((gender === 'f' || FEM_SOFT.has(low)) && low.endsWith('ь')) {
      // Любовь → Любовь / Любови / Любовью / Любови
      forms = { acc: low, dat: stem + 'и', inst: stem + 'ью', gen: stem + 'и' };
    } else if (low.endsWith('я')) {                // Даня → Даню, Дане, Даней, Дани
      forms = { acc: stem + 'ю', dat: stem + 'е', inst: stem + 'ей', gen: stem + 'и' };
    } else if (low.endsWith('а')) {                // Ника → Никой; Саша → Сашей
      const hush = /[жшщч]$/.test(stem);           // безударное окончание после шипящих — «ей»
      forms = {
        acc: stem + 'у', dat: stem + 'е',
        inst: stem + (hush ? 'ей' : 'ой'),
        gen: stem + (/[кгхжшщч]$/.test(stem) ? 'и' : 'ы')
      };
    } else if (FUGITIVE[low]) {                    // Лев → Льва, Льву, Львом, Льва
      const s = FUGITIVE[low];
      forms = { acc: s + 'а', dat: s + 'у', inst: s + 'ом', gen: s + 'а' };
    } else if (low.endsWith('й')) {                // Андрей → Андрея, Андрею, Андреем
      forms = { acc: stem + 'я', dat: stem + 'ю', inst: stem + 'ем', gen: stem + 'я' };
    } else if (low.endsWith('ь')) {                // Игорь → Игоря, Игорю, Игорем
      forms = { acc: stem + 'я', dat: stem + 'ю', inst: stem + 'ем', gen: stem + 'я' };
    } else {                                       // Денис → Дениса, Денису, Денисом
      forms = { acc: low + 'а', dat: low + 'у', inst: low + 'ом', gen: low + 'а' };
    }
    return forms[cs] || low;
  }

  // регистр первой буквы — как в исходном слове (Анна-Мария → Анну-Марию)
  const capFrom = (res, orig) =>
    (orig[0] && orig[0] !== orig[0].toLowerCase()) ? res.charAt(0).toUpperCase() + res.slice(1) : res;

  function decline(raw, cs, gender) {
    const name = String(raw).trim();
    if (!/[а-яёА-ЯЁ]/.test(name)) {                // латиница/ники: denplis → denplis'а
      const end = { acc: 'а', dat: 'у', inst: 'ом', gen: 'а' }[cs];
      return end ? name + "'" + end : name;
    }
    // составные имена (дефис/пробел): склоняется каждая часть, регистр каждой сохраняется
    if (/[-\s]/.test(name)) {
      return name.split(/([-\s]+)/).map(seg => {
        if (!seg || /^[-\s]+$/.test(seg)) return /-/.test(seg) ? '-' : ' ';
        const t = seg.trim();
        return capFrom(declinePart(t.toLowerCase(), cs, gender), t);
      }).join('');
    }
    return capFrom(declinePart(name.toLowerCase(), cs, gender), name);
  }

  /* ── Пол по имени (GENDER-1): пользовательский выбор приоритетнее, это fallback ── */
  // мужские имена/уменьшительные на а/я, которые эвристика «на а — женщина» сломала бы
  const MALE_A = new Set([
    'никита', 'данила', 'илья', 'фома', 'кузьма', 'лука', 'ларион', 'данил',
    // уменьшительные мужские
    'саша', 'женя', 'миша', 'гоша', 'лёва', 'вася', 'дима', 'паша', 'коля', 'ваня',
    'вова', 'юра', 'слава', 'саня', 'алёша', 'лёша', 'витя', 'костя', 'гриша',
    'боря', 'сева', 'дёма', 'сеня', 'стёпа', 'федя', 'дёша', 'тоша'
  ]);
  function guessGender(raw) {
    const low = String(raw).trim().toLowerCase();
    if (!low) return '';
    if (FEM_SOFT.has(low)) return 'f';
    if (MALE_A.has(low)) return 'm';
    if (/[ая]$/.test(low)) return 'f';
    return 'm';
  }

  /* ── Рендер шаблона задания (GENDER-1): чистая функция ──
     gN/gO — пол ('m'|'f'|'') игрока и второго имени; '' → нейтральный текст
     без скобок: формы целиком через слэш «целовался/целовалась»,
     короткие окончания отбрасываются (эвристика пола покрывает почти все имена) */
  function renderTemplate(tpl, name, other, gN, gO) {
    const g = gN || '';
    const fullForm = (m, f) => (g === 'f' ? f : g === 'm' ? m : m + '/' + f);
    if (g === 'f') {
      tpl = tpl.replace(/\(([^()]+)\|([^()]+)\)/g, '$2');
      tpl = tpl.replace(/\((а|ась|ся|ись|ла)\)/g, '$1');
    } else if (g === 'm') {
      tpl = tpl.replace(/\(([^()]+)\|([^()]+)\)/g, '$1');
      tpl = tpl.replace(/\((а|ась|ся|ись|ла)\)/g, '');
    } else {
      tpl = tpl.replace(/\(([^()]+)\|([^()]+)\)/g, (s, m, f) => fullForm(m, f));
      tpl = tpl.replace(/\((а|ась|ся|ись|ла)\)/g, '');
    }
    // служебные токены в превью не показываем
    tpl = tpl.replace(/\s*\[\[таймер \d+\]\]/g, '').replace(/\s*\[\[тайно\]\]/g, '')
             .replace(/\s*\[\[мод:[^\]]+\]\]/g, '').replace(/\s*\[\[пояснение:[^\]]+\]\]/g, '')
             .replace(/\s*\[\[без-мод\]\]/g, '');
    // падежные токены: {other-acc} = кого, {other-dat} = кому, {other-inst} = с кем, {other-gen} = кого/чего
    const v = {
      'name': name, 'other': other,
      'name-acc': decline(name, 'acc', g), 'name-dat': decline(name, 'dat', g),
      'name-inst': decline(name, 'inst', g), 'name-gen': decline(name, 'gen', g),
      'other-acc': decline(other, 'acc', gO || ''), 'other-dat': decline(other, 'dat', gO || ''),
      'other-inst': decline(other, 'inst', gO || ''), 'other-gen': decline(other, 'gen', gO || '')
    };
    let html = tpl, plain = tpl;
    Object.keys(v).sort((a, b) => b.length - a.length).forEach(k => {
      html = html.split('{' + k + '}').join('<b>' + esc(v[k]) + '</b>');
      plain = plain.split('{' + k + '}').join(v[k]);
    });
    return { html, plain };
  }

  // остатки служебных символов не должны попадать в озвучку (GENDER-1.3)
  const speakSafe = s => String(s).replace(/[()|\[\]{}]/g, '');

  /* ── PREVIEW-1: секретное задание ([[тайно]]) не показывается в превью выбора ──
     Возвращает короткую подпись для карточки или null — тогда превью рендерится
     как обычно. Исходный текст наружу не отдаётся: раскрытие только через
     приватный сценарий «возьми телефон» на экране задания */
  function choicePreview(tpl, kind) {
    return /\[\[тайно\]\]/.test(String(tpl)) ? (kind === 'truth' ? 'Секретный вопрос' : 'Секретное действие') : null;
  }

  /* ── Таймер из текста задания: цифры, слова («одну минуту») и «10-секундный» ── */
  function detectTimerSecs(raw) {
    const m = String(raw).match(/\[\[таймер (\d+)\]\]/);
    if (m) return parseInt(m[1], 10);
    const a = raw.match(/(\d+)\s*[-—]?\s*(секунд\S*|сек\b|минут\S*|мин\b)/);
    if (a) return /мин/.test(a[2]) ? parseInt(a[1], 10) * 60 : parseInt(a[1], 10);
    const w = raw.match(/(одну|две|три|четыре|пять)\s+(минут\S*|мин\b)/);
    if (w) return ({ одну: 1, две: 2, три: 3, четыре: 4, пять: 5 })[w[1]] * 60;
    return 0;
  }

  /* ── WHEEL-1: пул индексов колеса — последний победитель исключается,
     только когда игроков в пуле не меньше трёх (иначе результат предопределён) ── */
  function wheelPool(rem, recent) {
    const idx = rem.map((_, i) => i);
    const last = recent[recent.length - 1];
    if (rem.length >= 3 && last !== undefined) {
      const noRepeat = idx.filter(i => rem[i] !== last);
      if (noRepeat.length) return noRepeat;
    }
    return idx;
  }

  root.FANT_LANG = { esc, decline, guessGender, renderTemplate, speakSafe, choicePreview, detectTimerSecs, wheelPool };
})(typeof window !== 'undefined' ? window : globalThis);
