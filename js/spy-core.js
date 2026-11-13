/* ═══════════════ Фанты — чистая логика режима «Шпион» ═══════════════
   Чистое ядро партии: без DOM, localStorage, таймеров и звука — телефон
   ведёт только роли, порядок штрихов, голосование, попытку шпиона назвать
   слово и счёт. Источник правил — docs 04-GAME-RULES.md (ссылки § ниже).

   SPY-VERDICT (1.8.3, решение владельца): попытка шпиона — коллективный
   вердикт остальных игроков. Шпион произносит слово вслух, остальные решают
   двумя кнопками: resolveSpyGuess(game, true) — «Да, угадал» (+2 шпиону),
   resolveSpyGuess(game, false) — «Нет, ошибся» (шпион раскрыт, всем остальным
   +1). Ручного ввода слова и сравнения текста с секретным словом больше нет —
   ядро получает готовый вердикт и само начисляет очки и пишет result.

   createGame возвращает новый объект партии, остальные функции меняют
   переданный объект и возвращают признак успеха (true/false) или запись
   голосования (resolveVote), либо null/false при некорректном вызове —
   «безопасное отклонение», партия при отказе не меняется.

   Модель состояния партии (v: 1):

     {
       v: 1,
       mode: 'normal' | 'hardcore',
       players: [...],           // исходный состав, не меняется
       alive: [...],             // ещё в игре
       eliminated: [...],        // выбывшие по порядку выхода
       spy: 'Вика',              // UI не показывает до конца партии
       word: 'обезьяна',         // UI не показывает до конца партии
       category: {id, name}|null,// null в хардкоре — категории не существует
       phase: 'reveal' | 'draw' | 'discussion' | 'vote' | 'vote-result' | 'finished',
       round: 1,
       drawOrder: [...],         // случайный порядок круга, не перемешивается заново (04 §4)
       drawIndex: 0,             // позиция стартового игрока круга в drawOrder
       drawCount: 0,             // сколько живых подтвердили штрих в текущем круге
       votes: {},                // игрок → имя|null («Пропустить»); null-прототип
       scores: {},               // имя → очки; промежуточные очки не показывать (04 §7)
       history: [...],           // по записи на каждое resolveVote (без очков!)
       result: null              // заполняется только при завершении партии
     }

   Запись history: { round, counts: {игрок: голоса}, skipVotes, eliminated: имя|null,
   role: 'spy'|'civilian'|null } — role раскрывается при изгнании (04 §5), очков в ней нет.

   result: { v: 1, outcome: 'spy-caught'|'spy-guessed'|'spy-wrong-guess'|'spy-auto-win',
   spy, word, category } — заполняется в конце партии; после spy-caught фаза ещё
   vote-result (UI показывает раскрытие), continueAfterVote переводит в finished.

   Порядок rnd-вызовов в createGame (для детерминированных тестов):
   [normal: категория] → слово → шпион → перемешивание drawOrder (n-1 вызов). */
((root) => {
  'use strict';

  const MIN_PLAYERS = 4;
  const MAX_PLAYERS = 12;

  /* ── Фишер–Йетс с подменным ГСЧ (как в draw-memory-core) ── */
  function shuffle(arr, rnd = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* ── нормализация слова: регистр, ё/е, края, повторные пробелы.
     В активном механизме попытки (resolveSpyGuess) сравнения текста нет;
     остаётся экспортом для совместимости и утилитарных нужд ── */
  function normalizeWord(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .trim()
      .replace(/\s+/g, ' ');
  }

  /* ── утилиты ── */
  const pickIndex = (n, rnd) => Math.floor(rnd() * n);
  const uniq = arr => [...new Set(arr)];
  /* словари без прототипа: имена вроде «constructor» ничего не ломают */
  const blankMap = () => Object.create(null);
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  function isGame(game) {
    return !!game && typeof game === 'object' && Array.isArray(game.players);
  }
  function inPhase(game, ...phases) {
    return isGame(game) && phases.includes(game.phase);
  }
  /* живые игроки в порядке общего круга, начиная с позиции start */
  function aliveFrom(game, start) {
    const alive = new Set(game.alive);
    const out = [];
    const n = game.drawOrder.length;
    for (let k = 0; k < n; k++) {
      const nm = game.drawOrder[(start + k) % n];
      if (alive.has(nm)) out.push(nm);
    }
    return out;
  }
  /* следующая позиция живого игрока в круге после позиции from (выбывшие — пропуск) */
  function nextAlivePos(game, from) {
    const alive = new Set(game.alive);
    const n = game.drawOrder.length;
    for (let k = 1; k <= n; k++) {
      const pos = (from + k) % n;
      if (alive.has(game.drawOrder[pos])) return pos;
    }
    return -1;
  }

  /* ── валидация входов createGame ── */
  function validatePlayers(players) {
    if (!Array.isArray(players)) throw new Error('Шпион: игроки должны быть массивом имён');
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS)
      throw new Error(`Шпион: нужно от ${MIN_PLAYERS} до ${MAX_PLAYERS} игроков`);
    const names = players.map(p => {
      if (typeof p !== 'string') throw new Error('Шпион: имя игрока должно быть строкой');
      const nm = p.trim();
      if (!nm) throw new Error('Шпион: имена игроков не могут быть пустыми');
      return nm;
    });
    const seen = new Set();
    for (const nm of names) {
      if (seen.has(nm)) throw new Error(`Шпион: повторяющееся имя «${nm}»`);
      seen.add(nm);
    }
    return names;
  }

  function validateData(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.categories) || !data.categories.length)
      throw new Error('Шпион: база слов должна содержать непустой список categories');
    for (const c of data.categories) {
      const bad = !c || typeof c !== 'object'
        || typeof c.id !== 'string' || !c.id.trim()
        || typeof c.name !== 'string' || !c.name.trim()
        || !Array.isArray(c.words) || !c.words.length
        || !c.words.every(w => typeof w === 'string' && w.trim());
      if (bad) throw new Error(`Шпион: некорректная категория в базе слов${c && c.id ? ` («${c.id}»)` : ''}`);
    }
  }

  /* ── создание партии (04 §1–§3) ── */
  function createGame(players, mode, data, rnd = Math.random) {
    const random = typeof rnd === 'function' ? rnd : Math.random;
    const names = validatePlayers(players);
    if (mode !== 'normal' && mode !== 'hardcore')
      throw new Error('Шпион: режим должен быть normal или hardcore');
    validateData(data);

    /* дубликаты слов убираем, чтобы выбор был честно равновероятным */
    const cats = data.categories.map(c => ({ id: c.id, name: c.name, words: uniq(c.words) }));
    const pool = uniq(cats.flatMap(c => c.words));
    if (!pool.length) throw new Error('Шпион: в базе слов нет ни одного слова');

    /* порядок random-вызовов: [категория] → слово → шпион → перемешивание */
    let category = null;
    let wordPool = pool;                                  // хардкор: общее объединение (04 §2)
    if (mode === 'normal') {
      const cat = cats[pickIndex(cats.length, random)];
      category = { id: cat.id, name: cat.name };
      wordPool = cat.words;
    }
    const word = wordPool[pickIndex(wordPool.length, random)];
    const spy = names[pickIndex(names.length, random)];   // ровно один шпион (04 §1)

    return {
      v: 1,
      mode,
      players: names,
      alive: names.slice(),
      eliminated: [],
      spy,
      word,
      category,
      phase: 'reveal',
      round: 1,
      drawOrder: shuffle(names.slice(), random),
      drawIndex: 0,
      drawCount: 0,
      votes: blankMap(),
      scores: names.reduce((s, nm) => (s[nm] = 0, s), blankMap()),
      history: [],
      result: null,
    };
  }

  /* ── передача ролей → рисование (04 §3) ── */
  function startGame(game) {
    if (!inPhase(game, 'reveal')) return false;
    game.phase = 'draw';
    game.drawIndex = 0;
    game.drawCount = 0;
    return true;
  }

  /* ── текущий живой рисующий (04 §4); вне фазы draw ходов нет ── */
  function getCurrentDrawer(game) {
    if (!inPhase(game, 'draw')) return null;
    const order = aliveFrom(game, game.drawIndex);
    return game.drawCount < order.length ? order[game.drawCount] : null;
  }

  /* ── «Линия готова — передать дальше»: только текущий рисующий (04 §4).
     Объём линии и сама линия — физическое правило игрока, core не проверяет ── */
  function completeDrawTurn(game, playerName) {
    if (!inPhase(game, 'draw')) return false;
    if (typeof playerName !== 'string' || playerName !== getCurrentDrawer(game)) return false;
    game.drawCount++;
    if (game.drawCount >= game.alive.length) game.phase = 'discussion';
    return true;
  }

  /* ── обсуждение → голосование: голоса каждого круга чистые (04 §5) ── */
  function openVote(game) {
    if (!inPhase(game, 'discussion')) return false;
    game.votes = blankMap();
    game.phase = 'vote';
    return true;
  }

  /* ── один тайный голос: за другого живого или null («Пропустить»).
     За себя, выбывшего, неизвестного — нельзя; голос не перезаписывается (04 §5) ── */
  function castVote(game, voterName, targetNameOrNull) {
    if (!inPhase(game, 'vote')) return false;
    if (typeof voterName !== 'string' || !game.alive.includes(voterName)) return false;
    if (has(game.votes, voterName)) return false;
    if (targetNameOrNull !== null) {
      if (typeof targetNameOrNull !== 'string') return false;
      if (targetNameOrNull === voterName) return false;
      if (!game.alive.includes(targetNameOrNull)) return false;
    }
    game.votes[voterName] = targetNameOrNull;
    return true;
  }

  /* ── SPY-INT (интеграция 05): сколько голосов уже принято.
     UI использует для индекса текущего голосующего и авто-resolve.
     Object.keys считает только собственные ключи — blankMap это
     Object.create(null), унаследованные свойства не мешают ── */
  function votesCast(game) {
    if (!game || !game.votes) return 0;
    return Object.keys(game.votes).length;
  }

  /* ── разрешение голосования: plurality с единоличным лидером,
     «Пропустить» наравне с игроками, ничья — никто не выбывает (04 §5).
     Возвращает запись истории или null (рано/некорректно). Очков в записи нет —
     промежуточные очки не показывать (04 §7) ── */
  function resolveVote(game) {
    if (!inPhase(game, 'vote')) return null;
    if (game.alive.some(p => !has(game.votes, p))) return null;

    const counts = blankMap();
    game.alive.forEach(p => { counts[p] = 0; });
    let skip = 0;
    game.alive.forEach(p => {
      const t = game.votes[p];
      if (t === null) skip++;
      else counts[t]++;
    });

    const entries = [...game.alive.map(p => [p, counts[p]]), ['skip', skip]];
    const max = Math.max(...entries.map(e => e[1]));
    const leaders = entries.filter(e => e[1] === max).map(e => e[0]);
    const eliminated = leaders.length === 1 && leaders[0] !== 'skip' ? leaders[0] : null;

    const entry = { round: game.round, counts, skipVotes: skip, eliminated, role: null };
    if (eliminated) {
      game.alive = game.alive.filter(p => p !== eliminated);
      game.eliminated.push(eliminated);
      if (eliminated === game.spy) {
        entry.role = 'spy';
        /* поймали шпиона: +1 каждому мирному — включая выбывших ранее (04 §7) */
        game.players.forEach(p => { if (p !== game.spy) game.scores[p]++; });
        game.result = { v: 1, outcome: 'spy-caught', spy: game.spy, word: game.word, category: game.category };
      } else {
        entry.role = 'civilian';
        /* ошибочное изгнание мирного: шпиону +1 — втайне до финала (04 §7) */
        game.scores[game.spy]++;
      }
    }
    game.history.push(entry);
    game.phase = 'vote-result';
    return entry;
  }

  /* ── после результата голосования (04 §5) ── */
  function continueAfterVote(game) {
    if (!inPhase(game, 'vote-result')) return false;
    if (game.result) {                    // шпион пойман — раскрытие показано, финал
      game.phase = 'finished';
      return true;
    }
    const nextPos = nextAlivePos(game, game.drawIndex);
    if (game.alive.length <= 2 || nextPos < 0) {
      /* шпион + один мирный — автоматическая победа шпиона, без доп. очка (04 §5, §7) */
      game.result = { v: 1, outcome: 'spy-auto-win', spy: game.spy, word: game.word, category: game.category };
      game.phase = 'finished';
      return true;
    }
    /* стартовый игрок сдвигается на следующего живого в сохранённом порядке,
       весь список заново не перемешивается (04 §4); выбывшие не рисуют и не голосуют */
    game.round++;
    game.drawIndex = nextPos;
    game.drawCount = 0;
    game.votes = blankMap();
    game.phase = 'draw';
    return true;
  }

  /* ── SPY-VERDICT (1.8.3): коллективный вердикт остальных игроков на попытку
     шпиона (04 §6, решение владельца; см. 01-SHARED-BRIEF). Шпион произносит
     слово вслух, остальные решают: isCorrect === true — «Да, угадал»,
     false — «Нет, ошибся». Ядро — единственный источник истины по исходу
     и счёту: UI только вызывает API и открывает финал по результату.

     Контракт: только фазы draw/discussion/vote/vote-result (в reveal ролей ещё
     нет, после финала — поздно); isCorrect — строго boolean; отказ при пустой/
     некорректной партии, завершённой партии или неверном типе — false, партия
     не меняется. Одна попытка на партию: любой вердикт завершает партию,
     повторный вызов после финала отклоняется без второго начисления (04 §6). */
  function resolveSpyGuess(game, isCorrect) {
    if (!inPhase(game, 'draw', 'discussion', 'vote', 'vote-result')) return false;
    if (game.result) return false;
    if (typeof isCorrect !== 'boolean') return false;
    if (!game.scores || !game.spy || !Array.isArray(game.players)) return false;
    if (isCorrect) {
      game.scores[game.spy] += 2;         // верно: шпиону ровно +2 (04 §7)
      game.result = { v: 1, outcome: 'spy-guessed', spy: game.spy, word: game.word, category: game.category };
    } else {
      /* ошибся: шпион раскрыт, каждому другому участнику +1 — включая
         выбывших ранее в этой же партии (04 §7) */
      game.players.forEach(p => { if (p !== game.spy) game.scores[p]++; });
      game.result = { v: 1, outcome: 'spy-wrong-guess', spy: game.spy, word: game.word, category: game.category };
    }
    game.phase = 'finished';
    return true;
  }

  const SPY_CORE = {
    createGame, startGame, getCurrentDrawer, completeDrawTurn,
    openVote, castVote, votesCast, resolveVote, continueAfterVote,
    resolveSpyGuess, normalizeWord,
  };
  root.SPY_CORE = SPY_CORE;
  if (typeof module !== 'undefined' && module.exports) module.exports = SPY_CORE;
})(typeof window !== 'undefined' ? window : globalThis);
