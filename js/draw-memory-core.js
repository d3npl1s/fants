/* ═══════════════ Фанты — чистая логика «Нарисуй по памяти» ═══════════════
   Вынесено из app.js, чтобы гонять тесты на Node (tests/draw-memory.test.js):
   выбор слов раунда, генерация пар «задающий → отвечающий», начисление баллов,
   резерв номеров рисунков.
   Никакого DOM и localStorage — только данные на входе, данные на выходе.

   Алгоритм пар (DM-PAIRS): задающие фиксируются в случайном порядке, затем
   на каждый «шаг» (s = 1..per) подбирается бесповторная перестановка целей —
   деранжемент (никто не отвечает самому себе), избегающая уже использованных
   направленных пар. Поиск — алгоритм Куна: пока каждый задающий опросил не
   всех, оставшиеся допустимые пары образуют регулярный двудольный граф,
   где совершенное сочетание существует всегда (лемма Холла). Каждая
   перестановка отдаёт каждую роль отвечающего ровно по одному разу, поэтому
   за раунд каждый игрок отвечает ровно per раз, а направленная пара
   «А задаёт Б» не повторяется, пока у А остались непроспрошенные участники.
   Запасной ход — циклический сдвиг (сдвиги r = 1..n-1 не пересекаются по
   парам), он нужен только при исчерпании всех уникальных пар (2 игрока). */
((root) => {
  'use strict';

  /* ── нормализация слова: регистр, ё, только буквы ── */
  const normWord = w => String(w).toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z]/g, '').trim();
  /* «ствол» слова: первые 4 буквы — слова с одинаковым стволом (чашка/кружка
     не ловится, но чайник/чайная — да) не берут в один раунд */
  const stem = w => normWord(w).slice(0, 4);

  /* ── Фишер–Йетс с подменным ГСЧ (для тестов) ── */
  function shuffle(arr, rnd = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* ── русские формы: plural(5, ['балл', 'балла', 'баллов']) → «баллов» ── */
  function plural(n, forms) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return forms[0];
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
    return forms[2];
  }

  /* ── выбор слов раунда: total уникальных, без недавних (пока пул позволяет),
     без одинаковых стволов в одном раунде ── */
  function pickWords(all, total, recent = [], rnd = Math.random) {
    const total_ = Math.max(1, Math.floor(Number(total) || 1));
    const rec = new Set((recent || []).map(normWord));
    const fresh = all.filter(w => !rec.has(normWord(w)));
    // пул позволяет не трогать недавние — не трогаем; иначе берём из всей базы
    const pool = fresh.length >= total_ ? fresh : all.slice();
    const bag = shuffle(pool.slice(), rnd);
    const picked = [];
    const stems = new Set();
    for (const w of bag) {
      if (picked.length >= total_) break;
      const st = stem(w);
      if (stems.has(st)) continue;          // слишком похожее — пропускаем
      stems.add(st);
      picked.push(w);
    }
    // страховка (базы хватает с запасом, но без этого цикла возможно недобор)
    for (const w of bag) {
      if (picked.length >= total_) break;
      if (!picked.includes(w)) picked.push(w);
    }
    return picked;
  }

  /* ── генерация пар раунда ──
     players — имена (≥ 2), per — вопросов от каждого игрока.
     Возвращает перемешанный список карточек { asker, answerer } длиной n*per. */
  function buildPairs(players, per, rnd = Math.random) {
    const n = players.length;
    if (n < 2) return [];
    const per_ = Math.max(1, Math.floor(Number(per) || 1));
    const order = shuffle(players.slice(), rnd);            // порядок задающих на весь раунд
    const used = new Map(order.map(p => [p, new Set()]));   // кто кого уже спросил
    const exhausted = p => used.get(p).size >= n - 1;       // А уже спросил всех остальных
    const can = (a, b) => b !== a && (exhausted(a) || !used.get(a).has(b));

    const cards = [];
    for (let s = 0; s < per_; s++) {
      // 1) допустимые кандидаты каждого задающего — в случайном порядке
      const adj = new Map(order.map(a => {
        let cands = order.filter(b => b !== a && (exhausted(a) || !used.get(a).has(b)));
        if (!cands.length) cands = order.filter(b => b !== a);   // исчерпан — повтор разрешён
        return [a, shuffle(cands.slice(), rnd)];
      }));
      // 2) алгоритм Куна: совершенное сочетание «задающий → отвечающий»
      const matchT = new Map();   // отвечающий → задающий
      const tryMatch = (a, seen) => {
        for (const b of adj.get(a)) {
          if (seen.has(b)) continue;
          seen.add(b);
          if (!matchT.has(b) || tryMatch(matchT.get(b), seen)) {
            matchT.set(b, a);
            return true;
          }
        }
        return false;
      };
      let targets = null, allMatched = true;
      for (const a of order) {
        if (!tryMatch(a, new Set())) { allMatched = false; break; }
      }
      if (allMatched) {
        targets = order.map(a => {
          for (const [b, aa] of matchT) if (aa === a) return b;
          return null;
        });
      }
      // 3) запасной ход — циклический сдвиг (выравнивает и случается при исчерпании)
      if (!targets) {
        const offs = shuffle(Array.from({ length: n - 1 }, (_, k) => k + 1), rnd);
        for (const r of offs) {
          const cand = order.map((_, i) => order[(i + r) % n]);
          if (cand.every((t, i) => can(order[i], t))) { targets = cand; break; }
        }
        if (!targets) targets = order.map((_, i) => order[(i + offs[0]) % n]); // повтор неизбежен (2 игрока)
      }
      targets.forEach((t, i) => {
        cards.push({ asker: order[i], answerer: t });
        used.get(order[i]).add(t);
      });
    }
    return shuffle(cards, rnd);   // порядок карточек тоже случайный
  }

  /* ── новые баллы: имя → 0 ── */
  function newScores(players) {
    const s = {};
    players.forEach(nm => { s[nm] = 0; });
    return s;
  }

  /* ── резерв номера рисунка за проверкой idx (DM-NUMS) ──
     Номер общий на всю партию: после принятия он навсегда исчезает из
     доступных — независимо от того, кто спрашивает и кто отвечает.
     Возвращает true, если резерв удался. Отказ (false) — когда номер вне
     диапазона, уже использован в этой партии, карточка завершена или у неё
     уже есть номер. Повторный вызов обработчика и перерендер резерв не
     поднимают: usedNums живёт в состоянии раунда и сохраняется вместе с ним. */
  function reserveNum(round, idx, num) {
    const c = round && round.cards ? round.cards[idx] : null;
    if (!c || c.state === 'done' || c.num) return false;
    if (!Number.isInteger(num) || num < 1 || num > round.total) return false;
    if (!Array.isArray(round.usedNums)) round.usedNums = [];
    if (round.usedNums.includes(num)) return false;
    c.num = num;
    round.usedNums.push(num);
    return true;
  }

  /* ── начисление/снятие балла за карточку idx ──
     Роли живут в round.pairs[idx] (карточки и пары — параллельные массивы).
     result: 'answerer' | 'asker' | 'none' | null (null — отмена результата).
     Возвращает true, если состояние изменилось. Двойное начисление невозможно:
     повтор того же результата — no-op, другой — сначала снимает старый.
     «Никому» записывается на карточку (она завершена), но счёт не трогает. */
  function applyResult(round, idx, result) {
    const c = round.cards[idx];
    const p = round.pairs ? round.pairs[idx] : null;
    if (!c || !p || !round.scores) return false;
    const prev = c.result || null;
    const next = result || null;
    if (prev === next) return false;
    if (prev === 'answerer' && round.scores[p.answerer]) round.scores[p.answerer]--;
    if (prev === 'asker' && round.scores[p.asker]) round.scores[p.asker]--;
    if (next === 'answerer') round.scores[p.answerer] = (round.scores[p.answerer] || 0) + 1;
    if (next === 'asker') round.scores[p.asker] = (round.scores[p.asker] || 0) + 1;
    c.result = next;
    return true;
  }

  /* ── копилка недавних слов между раундами ── */
  function mergeRecent(recent, words, cap = 80) {
    const out = Array.isArray(recent) ? recent.slice() : [];
    (words || []).forEach(w => { if (!out.includes(w)) out.push(w); });
    return out.length > cap ? out.slice(out.length - cap) : out;
  }

  /* ── заморозка таймера дорисовки (AUDIT-02): пауза ограниченного таймера ──
     Остаток от абсолютного дедлайна drawEndsAt переносится в drawLeft,
     дедлайн обнуляется; возвращает остаток в секундах. Возобновление —
     в app.js (dmOpenDraw восстанавливает drawEndsAt из drawLeft), при
     drawLeft === 0 раунд должен уйти в проверки, а не получить «∞».
     Идемпотентна: если замораживать нечего (дедлайна уже нет, битый или
     пустой раунд) — возвращается null и состояние не меняется вовсе.
     Различие 0 и null существенно: 0 — «заморозка произошла, время вышло»,
     null — «заморозки не было». */
  function freezeDrawDeadline(round, now) {
    if (!round || typeof round !== 'object' || !round.drawEndsAt) return null;
    const left = Math.max(0, Math.ceil((round.drawEndsAt - now) / 1000));
    round.drawLeft = left;
    round.drawEndsAt = 0;
    return left;
  }

  root.DRAW_MEMORY_CORE = { normWord, stem, shuffle, plural, pickWords, buildPairs, newScores, reserveNum, applyResult, mergeRecent, freezeDrawDeadline };
})(typeof window !== 'undefined' ? window : globalThis);
