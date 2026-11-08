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

  root.FANT_LANG = { esc, decline };
})(typeof window !== 'undefined' ? window : globalThis);
