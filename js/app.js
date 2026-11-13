/* ═══════════════ Фанты — логика ═══════════════ */
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const DATA = window.FANT;
  const { decline, guessGender, renderTemplate, speakSafe, choicePreview, detectTimerSecs, wheelPool } = window.FANT_LANG;  // чистые функции из js/lang.js (тестируются на Node)
  // SPIN-1: высоты строк лент берутся из CSS-переменных — JS и CSS больше не расходятся
  const cssPx = (prop, fallback) => {
    try {
      const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(prop));
      return isNaN(v) ? fallback : v;
    } catch { return fallback; }
  };
  const nameH = () => cssPx('--spin-name-h', 150);   // высота имени в ленте колеса, px
  const SPIN_PAD = 8;                       // запас имён сверху и снизу ленты
  const PLAYER_COLORS = [
    '#21265c', '#c2185b', '#6a1fa2', '#0e7c86', '#d84315', '#2e7d32',
    '#37474f', '#ad1457', '#4527a0', '#00695c', '#8d6e63', '#b71c1c'
  ];
  const BLITZ_SECS = 180;   // блиц-круг: 3 минуты на круг
  // UX-1: дефолтное наказание в одном месте — нейтральное, алкогольный вариант вводят сами
  const DEFAULT_PUNISH = 'штрафное задание';
  // локальные токены: комнаты и предметы этого дома
  const ROOMS = ['кухня', 'балкон', 'душ на втором этаже', 'веранда', 'гостиная'];
  const OBJECTS = ['плед', 'лопатка для мангала', 'шампур', 'кубик льда', 'одеяло', 'бокал'];
  const MODS = [            // случайные модификаторы к действиям
    'шёпотом', 'с акцентом', 'стоя на одной ноге', 'с каменным лицом',
    'как робот', 'максимально драматично', 'в замедленной съёмке', 'не моргая'
  ];

  /* ── Хранилище ── */
  const store = {
    // тип значения сверяется с дефолтом: битый ключ (строка вместо массива и т.п.)
    // отдаёт дефолт, а не роняет весь IIFE белым экраном
    get(k, d) {
      try {
        const v = localStorage.getItem('fant.' + k);
        if (v === null) return d;
        const p = JSON.parse(v);
        if (Array.isArray(d) !== Array.isArray(p)) return d;
        if (d !== null && typeof d === 'object' && !Array.isArray(d) && (typeof p !== 'object' || p === null)) return d;
        return p;
      } catch { return d; }
    },
    set(k, v) { try { localStorage.setItem('fant.' + k, JSON.stringify(v)); } catch { toast('Не удалось сохранить — память браузера переполнена'); } }
  };

  const state = {
    level: store.get('level', 'fun'),
    players: store.get('players', []),
    round: store.get('round', 1),
    remaining: store.get('remaining', []),  // кто ещё в колесе в текущем круге
    sound: store.get('sound', true),
    tts: store.get('tts', true),            // озвучка заданий диктором
    genders: store.get('genders', {}),      // имя → 'm' | 'f' | '' — только для окончаний
    chosen: store.get('chosen', {}),        // имя → { truth: [], action: [] } — уже выпадавшие игроку
    punish: store.get('punish', DEFAULT_PUNISH),
    blacklist: store.get('blacklist', []),  // задания, исключённые компанией (сырые шаблоны)
    packs: store.get('packs', { kvartirnik: true, dacha: false, ny: false }), // включённые пакеты
    comboBan: store.get('comboBan', []),    // забаненные скелеты комбо «глагол|объект»
    stats: store.get('stats', {}),          // имя → { truth, action, done, fails }
    blitz: store.get('blitz', false),
    blitzEndsAt: 0,
    blitzTimerId: null,
    streaks: {},          // имя игрока -> { type, count } — лимит «2 раза подряд»
    bags: {},             // мешки заданий без повторов
    taskTimerId: null,
    spinning: false,
    spinRmTimer: null,      // SPIN-3: отложенный finishSpin при prefers-reduced-motion (250 мс)
    spinChoiceTimer: null,  // SPIN-3: отложенный openChoice после finishSpin (700 мс)
    recent: [],             // последние 2 игрока колеса — чтобы не выпадали подряд
    recentSkel: [],         // последние 4 скелета комбо — анти-залипание (только сессия)
    recentObj: [],          // последние 3 объекта комбо — «чайка» не упадёт трижды подряд
    currentTask: null,
    currentPlain: ''
  };

  const app = $('#app');
  app.dataset.level = state.level;
  // STORE-1: повреждённые числа не дают NaN ни в степпере, ни в HUD
  state.round = Math.max(1, Math.floor(Number(state.round) || 1));
  // STORE-1: счётчики статистики чинятся при загрузке — битые значения (строки,
  // отрицательные, NaN) не доезжают до сводок, а рост ограничен сверху
  const clampCount = v => { v = Math.floor(Number(v)); return isFinite(v) ? Math.min(99999, Math.max(0, v)) : 0; };
  Object.keys(state.stats).forEach(nm => {
    const s = state.stats[nm] || {};
    state.stats[nm] = { truth: clampCount(s.truth), action: clampCount(s.action), done: clampCount(s.done), fails: clampCount(s.fails) };
  });
  store.set('stats', state.stats);

  /* ── NAV-1: системная кнопка «Назад» ходит по экранам приложения ──
     каждый показ экрана кладёт запись в history; модалки/попапы — свои записи,
     «Назад» закрывает их первым; popstate возвращает на предыдущий экран */
  let navFromPop = false;   // показ экрана из popstate не кладёт новую запись
  function showScreen(id) {
    // SPIN-2/3: уход с экрана колеса гасит прокрутку в любом активном состоянии —
    // WAAPI, RAF, reduced-motion-таймер и отложенный openChoice, не только anim/raf
    if (id !== 'screen-wheel' && (state.spinAnim || state.spinRaf || state.spinRmTimer || state.spinChoiceTimer)) {
      state.spinToken = (state.spinToken || 0) + 1;
      cancelSpin();
      $('#spinOverlay').classList.add('hidden');
      $('#spinOverlay').classList.remove('show');
      $('#screen-wheel').classList.remove('leaving');
      state.spinning = false;
    }
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    if (!navFromPop) { try { history.pushState({ fant: id }, ''); } catch {} }
    syncWakeLock();
  }
  const activeScreenId = () => document.querySelector('.screen.active')?.id || '';
  window.addEventListener('popstate', e => {
    // открытая модалка закрывается первым «Назад», экран не дёргается
    const modal = document.querySelector('.modal:not(.hidden)');
    if (modal) { closeModal('#' + modal.id); return; }
    if (!$('#banPopup').classList.contains('hidden')) { hideBanPopup(); return; }
    const st = e.state || {};
    if (st.fant && st.fant !== activeScreenId()) {
      // DM-1: уход с экранов режима системной кнопкой «Назад» глушит его голос и таймеры
      if (!String(st.fant).startsWith('screen-dm-')) dmStopEngine();
      navFromPop = true;
      showScreen(st.fant);
      navFromPop = false;
      // SPY-NAV: «Назад» наружу из режима шпиона выбрасывает незавершённую партию
      // (без confirm — блокировать системную кнопку нельзя), «Назад» внутрь —
      // перерисовывает экран по актуальной фазе, старые состояния не показываются
      if (String(st.fant).startsWith('screen-spy-')) spyOnHistory(st.fant);
      else spyAbandonIfUnfinished();
    }
  });

  /* ── Звук (WebAudio) ── */
  let actx = null;
  function audio() {
    if (!state.sound) return null;
    if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; actx = new C(); }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function beep(freq, dur = .06, type = 'square', vol = .12, when = 0) {
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, a.currentTime + when);
    g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + when + dur);
    o.connect(g).connect(a.destination);
    o.start(a.currentTime + when); o.stop(a.currentTime + when + dur + .02);
  }
  const tickSound = () => beep(880, .035, 'square', .05);
  const revealSound = isTruth => {
    if (isTruth) { beep(392, .12, 'triangle', .16); beep(294, .18, 'triangle', .16, .13); }
    else { beep(392, .09, 'triangle', .16); beep(494, .09, 'triangle', .16, .1); beep(659, .16, 'triangle', .16, .2); }
  };
  const failSound = () => { beep(196, .3, 'sawtooth', .18); beep(147, .45, 'sawtooth', .18, .3); };
  const vibrate = p => { if (navigator.vibrate) navigator.vibrate(p); };
  // примечание: failSound оставлен на будущее (сейчас провал — только по кнопке)

  /* ── Озвучка заданий (системный речевой синтез) ── */
  let ruVoice = null;
  function pickVoice() {
    try {
      const vs = speechSynthesis.getVoices();
      ruVoice = vs.find(v => v.lang && v.lang.toLowerCase().startsWith('ru')) || null;
    } catch { ruVoice = null; }
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text) {
    if (!state.tts || !('speechSynthesis' in window) || !text) return;
    try {
      speechSynthesis.cancel();
      // родовые маркеры и служебные скобки не для ушей (GENDER-1.3)
      const u = new SpeechSynthesisUtterance(speakSafe(text));
      u.lang = 'ru-RU';
      if (ruVoice) u.voice = ruVoice;
      u.rate = 1.02;
      speechSynthesis.speak(u);
    } catch {}
  }
  const stopSpeak = () => { try { speechSynthesis.cancel(); } catch {} };

  /* ── Тост ── */
  let toastT = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const playerColor = i => PLAYER_COLORS[i % PLAYER_COLORS.length];
  const fmtTime = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  // Фишер–Йетс: sort(() => Math.random() - .5) даёт смещённую тасовку
  const shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  /* ── Склонение имён — в js/lang.js (window.FANT_LANG.decline), тестируется на Node ── */
  /* ── Круги: кто остался в колесе ── */
  function resetRounds() {
    state.round = 1;
    state.remaining = [...state.players];
    store.set('round', state.round);
    store.set('remaining', state.remaining);
    renderHud();
    startBlitzClock();
  }
  // при загрузке: remaining должен соответствовать текущим игрокам
  if (!Array.isArray(state.remaining) || !state.remaining.length ||
      state.remaining.some(n => !state.players.includes(n))) {
    state.remaining = [...state.players];
  }
  function renderHud() {
    $('#hudRound').textContent = 'Круг ' + state.round;
    $('#hudLeft').textContent = 'в колесе ' + state.remaining.length + ' из ' + state.players.length;
    $('#hudBlitz').classList.toggle('hidden', !state.blitz);
    $('#sepBlitz').classList.toggle('hidden', !state.blitz);   // без блица не остаётся двойного буллета
    // блиц теперь включается прямо с экрана колеса
    $('#blitzWheelBtn').classList.toggle('on', state.blitz);
  }

  /* ── Блиц-круг: 3 минуты на весь круг, не успел — наказание ── */
  const newStats = () => ({ truth: 0, action: 0, done: 0, fails: 0 });
  function startBlitzClock() {
    clearInterval(state.blitzTimerId);
    if (!state.blitz) { $('#hudBlitz').classList.add('hidden'); return; }
    state.blitzEndsAt = Date.now() + BLITZ_SECS * 1000;
    state.blitzLastTick = Date.now();
    state.blitzTimerId = setInterval(tickBlitz, 500);
    tickBlitz();
  }
  function tickBlitz() {
    if (!state.blitz) return;
    const now = Date.now();
    // BLITZ-1: часы идут только на игровых экранах без открытых модалок/попапов.
    // В меню, настройках и на экране игроков — пауза (дедлайн сдвигается на время каждого тика)
    const act = document.querySelector('.screen.active')?.id || '';
    const onGame = act === 'screen-wheel' || act === 'screen-choice' || act === 'screen-reveal';
    const overlayed = document.querySelector('.modal:not(.hidden)') || !$('#banPopup').classList.contains('hidden');
    if (!onGame || overlayed) {
      state.blitzEndsAt += now - (state.blitzLastTick || now);
      state.blitzLastTick = now;
      return;
    }
    state.blitzLastTick = now;
    const left = Math.max(0, Math.round((state.blitzEndsAt - now) / 1000));
    const hb = $('#hudBlitz');
    hb.textContent = 'блиц ' + fmtTime(left);
    if (left <= 0) blitzExpire();
  }
  function blitzExpire() {
    clearInterval(state.blitzTimerId);
    stopTaskTimer();                      // TIMER-1
    hideBanPopup();                       // BLITZ-1: banOpen не должен навсегда блокировать choose()
    state.spinToken = (state.spinToken || 0) + 1;   // отменяем анимацию колеса, если она шла
    cancelSpin();                                    // SPIN-2: гасим WAAPI/RAF и отложенные щелчки
    state.spinning = false;
    // блиц — механика фантов: в других играх просто перезапускаем отсчёт
    const act = document.querySelector('.screen.active')?.id;
    if (act !== 'screen-wheel' && act !== 'screen-reveal' && act !== 'screen-choice') {
      startBlitzClock();
      return;
    }
    stopSpeak();
    const laggards = state.remaining.slice();
    laggards.forEach(nm => {
      if (!state.stats[nm]) state.stats[nm] = newStats();
      state.stats[nm].fails++;
    });
    store.set('stats', state.stats);
    state.round += 1;
    state.remaining = [...state.players];
    store.set('round', state.round);
    store.set('remaining', state.remaining);
    pending = null;
    renderHud();
    showScreen('screen-wheel');
    toast(laggards.length
      ? 'Блиц-время! ' + laggards.join(', ') + ' — ' + state.punish
      : 'Блиц-время вышло!');
    startBlitzClock();
  }

  /* ══════════ Экран 1: игроки ══════════ */
  function renderPlayers() {
    const list = $('#playerList');
    list.innerHTML = '';
    state.players.forEach((name, i) => {
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `<input maxlength="14" placeholder="Имя ${i + 1}" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="next" style="border-left:6px solid ${playerColor(i)}">
        <button class="gx" title="Пол — для окончаний в заданиях" aria-label="Пол игрока ${esc(name) || i + 1}: не указан"></button>
        <button class="rm" title="Удалить" aria-label="Удалить игрока ${esc(name) || i + 1}">×</button>`;
      const inp = row.querySelector('input');
      const original = name;                 // имя на момент рендера строки — база для миграции
      inp.value = name;
      inp.addEventListener('input', () => { state.players[i] = inp.value.trim(); });
      // PLAYERS-3: Enter — следующее поле, в последнем — новый игрок (до 12)
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (state.players.length < 12 && i === state.players.length - 1) {
          $('#addPlayerBtn').click();
        } else {
          const inputs = document.querySelectorAll('#playerList input');
          inputs[Math.min(i + 1, inputs.length - 1)]?.focus();
        }
      });
      inp.addEventListener('blur', () => {
        let nv = inp.value.trim();
        // PLAYERS-1: дубль — только среди ТЕКУЩИХ игроков, без регистра и лишних пробелов.
        // Данные удалённого игрока остаются в хранилищах: повторное добавление имени —
        // намеренный «возврат» статистики, а не запрещённый дубль
        const dup = nv && nv.toLowerCase() !== original.toLowerCase() &&
          state.players.some((p, k) => k !== i && p.trim().toLowerCase() === nv.toLowerCase());
        if (dup) {
          state.players[i] = original;
          inp.value = original;
          toast('Имя «' + nv + '» уже есть — оставил «' + original + '»');   // PLAYERS-1.2: в тосте введённое имя
          nv = original;
        } else {
          state.players[i] = nv;             // сначала актуальное имя — renderPlayers ниже покажет его
        }
        // переименование: переносим пол/статистику/выпавшие задания под новый ключ
        if (nv && original && nv !== original) {
          [['genders'], ['chosen'], ['stats'], ['phStats']].forEach(([k]) => {
            const obj = store.get(k, {});
            if (obj[original] !== undefined) {
              if (obj[nv] === undefined) obj[nv] = obj[original];   // не затираем чужие данные
              delete obj[original];
              store.set(k, obj);
            }
          });
          // обновляем оперативные копии, чтобы пол/статистика не «слетали» до перезагрузки
          state.genders = store.get('genders', {});
          state.chosen = store.get('chosen', {});
          state.stats = store.get('stats', {});
          phStats = store.get('phStats', {});
          // текущий круг: переименовываем игрока в remaining, иначе колесо выберет «призрака»
          if (state.remaining.includes(original)) {
            state.remaining = state.remaining.map(p => (p === original ? nv : p));
            store.set('remaining', state.remaining);
            renderHud();
          }
          if (state.streaks[original] !== undefined) {   // лимит «2 раза подряд» следует за именем
            state.streaks[nv] = state.streaks[original];
            delete state.streaks[original];
          }
          renderPlayers();
        }
        store.set('players', state.players);
      });
      // пол: — → М → Ж → — (влияет только на грамматику заданий)
      const gx = row.querySelector('.gx');
      const gxLabel = () => {
        const cur = state.genders[state.players[i]] || '';
        gx.textContent = cur === 'm' ? 'М' : cur === 'f' ? 'Ж' : '—';
        gx.setAttribute('aria-label', 'Пол игрока ' + (state.players[i] || i + 1) + ': ' +
          (cur === 'm' ? 'М' : cur === 'f' ? 'Ж' : 'не указан'));
      };
      gxLabel();
      gx.addEventListener('click', () => {
        const nm = state.players[i];                 // читаем актуальное имя, а не снимок при рендере
        const cur = state.genders[nm];
        state.genders[nm] = cur === 'm' ? 'f' : cur === 'f' ? '' : 'm';
        store.set('genders', state.genders);
        gxLabel();
      });
      row.querySelector('.rm').addEventListener('click', () => {
        const gone = state.players[i];
        state.players.splice(i, 1); store.set('players', state.players);
        // удалённый не должен остаться в текущем круге — иначе колесо выберет его имя
        if (gone && state.remaining.includes(gone)) {
          state.remaining = state.remaining.filter(p => p !== gone);
          store.set('remaining', state.remaining);
        }
        delete state.streaks[gone];
        renderPlayers(); renderHud();
      });
      list.appendChild(row);
    });
  }
  // PLAYERS-2: состав на момент открытия экрана — сброс круга только при реальном изменении
  let playersReturn = null, rosterAtOpen = '';
  function openPlayers(from) {
    playersReturn = from || null;
    rosterAtOpen = state.players.filter(Boolean).join('|');
    if (state.players.length < 2) state.players = state.players.concat(['', '']);
    renderPlayers();
    showScreen('screen-players');
  }
  $('#addPlayerBtn').addEventListener('click', () => {
    if (state.players.length >= 12) return toast('Максимум 12 игроков');
    state.players.push(''); renderPlayers();
    const inputs = document.querySelectorAll('#playerList input');
    inputs[inputs.length - 1].focus();
  });
  $('#setupSaveBtn').addEventListener('click', () => {
    state.players = state.players.map(s => s.trim()).filter(Boolean);
    if (state.players.length < 2) return toast('Нужно минимум 2 игрока');
    if (new Set(state.players.map(s => s.toLowerCase())).size !== state.players.length) return toast('Имена не должны повторяться');
    store.set('players', state.players);
    // PLAYERS-2: круг сбрасывается только при изменении состава (добавили/убрали),
    // простое переименование игру не ломает
    if (state.players.join('|') !== rosterAtOpen) resetRounds();
    if (playersReturn) { const back = playersReturn; playersReturn = null; if (back === 'screen-spy-setup') spyRenderSetup(); showScreen(back); }
    else showScreen('screen-games');
  });

  /* ══════════ Экран 2: выбор игры ══════════ */
  const GAME_ICONS = {
    fants: `<svg class="game-icon" viewBox="0 0 120 120"><rect x="30" y="16" width="60" height="60" rx="14" fill="#fff"/><path d="M44 52 40 26l14 10 6-14 6 14 14-10-4 26z" fill="none" stroke="#21265c" stroke-width="4" stroke-linejoin="round"/><path d="M44 52h32v6c0 5-4 9-9 9H53c-5 0-9-4-9-9z" fill="#21265c"/></svg>`,
    phrase: `<svg class="game-icon" viewBox="0 0 120 120"><path fill="#fff" d="M18 24c0-6 5-11 11-11h62c6 0 11 5 11 11v40c0 6-5 11-11 11H56L38 94V75H29c-6 0-11-5-11-11z"/><circle cx="43" cy="44" r="5" fill="#26b5a2"/><circle cx="60" cy="44" r="5" fill="#26b5a2"/><circle cx="77" cy="44" r="5" fill="#26b5a2"/><path fill="#fff" opacity=".85" d="M50 96l14-12 18 8c4 2 6 7 4 11s-7 6-11 4z"/></svg>`,
    draw: `<svg class="game-icon" viewBox="0 0 120 120"><rect x="20" y="12" width="76" height="96" rx="10" fill="#fff"/><path d="M32 38h52M32 54h52M32 70h34" stroke="#c25a2a" stroke-width="6" stroke-linecap="round" fill="none" opacity=".4"/><path d="M99 28 59 84l-17 9 4-19 40-56z" fill="#ffd166" stroke="#21265c" stroke-width="4" stroke-linejoin="round"/><path d="M91 40 71 68" stroke="#21265c" stroke-width="4" stroke-linecap="round"/></svg>`,
    spy: `<svg class="game-icon" viewBox="0 0 120 120"><path fill="#fff" d="M30 48c-2-16 12-30 30-30s32 14 30 30z"/><rect x="22" y="48" width="76" height="12" rx="6" fill="#fff"/><circle cx="44" cy="82" r="13" fill="none" stroke="#fff" stroke-width="6"/><circle cx="76" cy="82" r="13" fill="none" stroke="#fff" stroke-width="6"/><path d="M57 82h6" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg>`
  };
  const GAMES = [
    { id: 'fants', name: 'Фанты', tagline: 'Правда или действие: колесо, уровни и задания.' },
    { id: 'phrase', name: 'Продолжи фразу', tagline: 'Отвечай неправильно, но уверенно. Зал ставит оценку.' },
    { id: 'draw', name: 'Нарисуй по памяти', tagline: 'Услышь слова, зарисуй по памяти и угадай чужие рисунки.' },
    { id: 'spy', name: 'Шпион', tagline: 'Рисуйте одно слово по штриху — и вычислите того, кто его не знает.' }
  ];
  function buildGames() {
    $('#gamesTrack').innerHTML = GAMES.map(g => `
      <div class="game-card" data-game="${g.id}">
        ${GAME_ICONS[g.id]}
        <div class="game-name">${g.name}</div>
        <p class="game-tag">${g.tagline}</p>
        <button class="play-btn" data-play="${g.id}"><span>Играть</span><i class="chev">›</i></button>
      </div>`).join('');
    $('#gamesDots').innerHTML = GAMES.map((g, i) => `<button type="button" class="dot${i === 0 ? ' on' : ''}" data-i="${i}" aria-label="${g.name}"></button>`).join('');
  }
  function syncGames() {
    const i = Math.round($('#gamesCarousel').scrollLeft / Math.max(1, $('#gamesCarousel').clientWidth));
    document.querySelectorAll('#gamesDots .dot').forEach((d, k) => d.classList.toggle('on', k === i));
  }
  $('#gamesCarousel').addEventListener('scroll', syncGames, { passive: true });
  $('#prevGame').addEventListener('click', () => $('#gamesCarousel').scrollBy({ left: -$('#gamesCarousel').clientWidth, behavior: 'smooth' }));
  $('#nextGame').addEventListener('click', () => $('#gamesCarousel').scrollBy({ left: $('#gamesCarousel').clientWidth, behavior: 'smooth' }));
  $('#gamesTrack').addEventListener('click', e => {
    const b = e.target.closest('[data-play]');
    if (!b) return;
    // настройки открываются только по кнопке-меню, не поверх каждой игры
    if (b.dataset.play === 'fants') { showScreen('screen-levels'); syncCarousel(); }
    else if (b.dataset.play === 'draw') { dmEnter(); }
    else if (b.dataset.play === 'spy') { spyEnter(); }
    else { renderModeChips(); showScreen('screen-phrase-setup'); }
  });
  $('#backToGames').addEventListener('click', () => showScreen('screen-games'));
  $('#phraseBackBtn').addEventListener('click', () => showScreen('screen-games'));
  // PHRASE-3: выход из круга — только через подтверждение, прогресс не теряется молча
  $('#phraseRoundBackBtn').addEventListener('click', () => {
    if (!confirm('Выйти? Прогресс круга пропадёт.')) return;
    clearTimeout(phrase.pairTimer);
    phrase.current = null;
    renderModeChips();
    showScreen('screen-phrase-setup');
  });

  /* ══════════ Пакеты заданий (экран уровней) ══════════ */
  function buildPacksRow() {
    const row = $('#packsRow');
    if (!row) return;
    // LEVEL-1: на Hot пакеты всё равно игнорируются — вместо фиктивных чипов объясняем
    if (state.level === 'hot') {
      row.innerHTML = '<p class="packs-note">Hot — авторский уровень: пакеты в него не подмешиваются</p>';
      return;
    }
    let html = `<button type="button" class="pack-chip on base" data-pack="sea">У моря зимой</button>`;
    html += DATA.packs.map(p => {
      const on = !!state.packs[p.id];
      return `<button type="button" class="pack-chip${on ? ' on' : ''}" data-pack="${p.id}">${p.name}</button>`;
    }).join('');
    row.innerHTML = html;
  }
  $('#packsRow').addEventListener('click', e => {
    const b = e.target.closest('[data-pack]');
    if (!b || b.dataset.pack === 'sea') return toast('«У моря зимой» — базовый набор, он всегда с тобой');
    const id = b.dataset.pack;
    state.packs[id] = !state.packs[id];
    store.set('packs', state.packs);
    state.bags = {};
    buildPacksRow();
    toast(state.packs[id] ? 'Пакет «' + (DATA.packs.find(p => p.id === id) || {}).name + '» в игре' : 'Пакет выключен');
  });

  /* ══════════ Экран 2: карусель уровней (нативный свайп) ══════════ */
  const ICONS = {
    cloud: `<svg class="level-icon" viewBox="0 0 120 120"><path fill="#fff" d="M60 14c14 0 26 7 32 18 12 2 21 12 21 25 0 14-11 25-25 25H32C18 82 7 71 7 57c0-12 8-22 19-25 5-11 18-18 34-18z"/><g fill="#3b82d6"><path d="M38 46l12 6-12 6 4-6z"/><path d="M82 46l-12 6 12 6-4-6z"/><path d="M36 68c6 7 13 10 24 10s18-3 24-10c-6 3-14 5-24 5s-18-2-24-5z"/></g></svg>`,
    wink: `<svg class="level-icon" viewBox="0 0 120 120"><path fill="#fff" d="M60 10l8 10 12-4 3 12 13 1-3 13 12 5-8 11 8 11-12 5 3 13-13 1-3 12-12-4-8 10-8-10-12 4-3-12-13-1 3-13-12-5 8-11-8-11 12-5-3-13 13-1 3-12 12 4z"/><g fill="#ff5a45"><circle cx="42" cy="54" r="6"/><path d="M74 48l12 6-12 6 4-6z"/><path d="M38 74c7 6 14 9 22 9s15-3 22-9c-7 3-14 4-22 4s-15-1-22-4z"/></g></svg>`,
    hearts: `<svg class="level-icon" viewBox="0 0 120 120"><path fill="#fff" d="M60 10l8 10 12-4 3 12 13 1-3 13 12 5-8 11 8 11-12 5 3 13-13 1-3 12-12-4-8 10-8-10-12 4-3-12-13-1 3-13-12-5 8-11-8-11 12-5-3-13 13-1 3-12 12 4z"/><g fill="#ff2e78"><path d="M42 46c4-5 12-4 13 2 1-6 9-7 13-2 3 4 1 8-4 12l-9 7-9-7c-5-4-7-8-4-12z"/><path d="M72 46c4-5 12-4 13 2 1-6 9-7 13-2 3 4 1 8-4 12l-9 7-9-7c-5-4-7-8-4-12z" transform="translate(-12 2) scale(.92)"/><path d="M38 78c7 5 14 8 22 8s15-3 22-8c-7 3-14 4-22 4s-15-1-22-4z"/></g></svg>`
  };

  const carousel = $('#carousel');
  function buildCarousel() {
    $('#carTrack').innerHTML = DATA.levels.map(lv => `
      <div class="level-card" data-lv="${lv.id}">
        ${ICONS[lv.icon]}
        <div class="level-name">${lv.name}</div>
        <p class="level-tag">${lv.tagline}</p>
        <button class="play-btn" data-play="${lv.id}"><span>Играть</span><i class="chev">›</i></button>
      </div>`).join('');
    $('#carDots').innerHTML = DATA.levels.map(l => `<button type="button" class="dot" data-lv="${l.id}" aria-label="${l.name}"></button>`).join('');
  }

  const levelIndex = () => Math.max(0, DATA.levels.findIndex(l => l.id === state.level));
  function syncCarousel(smooth = true) {
    const i = levelIndex();
    carousel.scrollTo({ left: i * carousel.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
    document.querySelectorAll('#carDots .dot').forEach(d => d.classList.toggle('on', d.dataset.lv === DATA.levels[i].id));
  }
  // LEVEL-1: свайп карусели меняет и уровень, и тему — по завершении скролла
  let carScrollT = null;
  function adoptCarouselLevel() {
    const i = Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth));
    const lv = DATA.levels[i];
    if (lv && lv.id !== state.level) {
      state.level = lv.id;
      store.set('level', lv.id);
      app.dataset.level = lv.id;
      buildPacksRow();                 // Hot: строка пакетов не нужна
    }
  }
  if ('onscrollend' in carousel) {
    carousel.addEventListener('scrollend', adoptCarouselLevel);
    carousel.addEventListener('scroll', () => {                        // точки следуют за свайпом
      const i = Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth));
      document.querySelectorAll('#carDots .dot').forEach((d, k) => d.classList.toggle('on', k === i));
    }, { passive: true });
  } else {
    carousel.addEventListener('scroll', () => {                        // точки следуют за свайпом
      const i = Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth));
      document.querySelectorAll('#carDots .dot').forEach((d, k) => d.classList.toggle('on', k === i));
      clearTimeout(carScrollT);
      carScrollT = setTimeout(adoptCarouselLevel, 150);
    }, { passive: true });
  }
  $('#carDots').addEventListener('click', e => {
    const d = e.target.closest('[data-lv]'); if (!d) return;
    state.level = d.dataset.lv; store.set('level', state.level);
    app.dataset.level = state.level;
    buildPacksRow();
    syncCarousel();
  });
  $('#prevLv').addEventListener('click', () => carousel.scrollBy({ left: -carousel.clientWidth, behavior: 'smooth' }));
  $('#nextLv').addEventListener('click', () => carousel.scrollBy({ left: carousel.clientWidth, behavior: 'smooth' }));

  $('#carTrack').addEventListener('click', e => {
    const b = e.target.closest('[data-play]');
    if (!b) return;
    tryStartGame(b.dataset.play);
  });

  function tryStartGame(levelId) {
    if (state.players.length < 2) { toast('Сначала добавьте игроков'); openPlayers(); return; }
    state.level = levelId;
    store.set('level', levelId);
    app.dataset.level = levelId;
    renderHud();
    showScreen('screen-wheel');
  }

  /* ══════════ Экран 3: колесо ══════════ */
  $('#backToLevels').addEventListener('click', () => { showScreen('screen-levels'); buildPacksRow(); syncCarousel(); });
  $('#statsWheelBtn').addEventListener('click', () => renderStats('Статистика фантов'));
  $('#blitzWheelBtn').addEventListener('click', () => {
    state.blitz = !state.blitz; store.set('blitz', state.blitz);
    renderHud();
    if (state.blitz) { startBlitzClock(); toast('Блиц: ' + (BLITZ_SECS / 60) + ' минуты на круг — не успел, ' + state.punish); }
    else { clearInterval(state.blitzTimerId); toast('Блиц выключен'); }
  });
  $('#mainStartBtn').addEventListener('click', () => openPlayers());
  // SPIN-1: MouseEvent не должен попадать в opts — spin() вызывается без аргументов
  $('#spinBtn').addEventListener('click', () => spin());

  // свайп в любом месте экрана запускает колесо — как продолжение жеста (палец или мышь)
  let swipeStart = null;
  const wheelScreen = $('#screen-wheel');
  wheelScreen.addEventListener('pointerdown', e => {
    if (!e.isPrimary) return;
    // SPIN-1: жест, начатый на кнопке (назад/статистика/блиц), колесо не запускает
    if (e.target.closest('button')) { swipeStart = null; return; }
    swipeStart = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  wheelScreen.addEventListener('pointerup', e => {
    if (!swipeStart || !e.isPrimary) return;
    const dx = e.clientX - swipeStart.x, dy = e.clientY - swipeStart.y;
    const dt = Math.max(1, performance.now() - swipeStart.t);
    swipeStart = null;
    if (Math.hypot(dx, dy) < 45) return;
    // направление ленты вслед за жестом: вправо/вниз — имена вниз, влево/вверх — вверх
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? -1 : 1) : (dy > 0 ? -1 : 1);
    const v = Math.min(8, Math.max(1.2, Math.hypot(dx, dy) / dt));   // скорость жеста, px/мс
    spin({ swipe: true, dir, v });
  });
  wheelScreen.addEventListener('pointercancel', () => { swipeStart = null; });

  function pickOther(name) {
    const others = state.players.filter(p => p !== name);
    return others[Math.floor(Math.random() * others.length)] || name;
  }

  function drawTask(level, type, playerName) {
    // комбинаторика для действий: объект × совместимый глагол × формат (шанс ~20%).
    // Hot не комбинируется: там только авторские задания под тематику уровня
    if (type === 'action' && level !== 'hot' && Math.random() < .2) {
      for (let a = 0; a < 6; a++) {
        const obj = DATA.combo.objects[Math.floor(Math.random() * DATA.combo.objects.length)];
        const v = obj.verbs[Math.floor(Math.random() * obj.verbs.length)];
        // формат совместим с глаголом (COMBO-1): «расскажи … без слов» не генерируется
        const fms = DATA.combo.formats.filter(f => !f.verbs || f.verbs.includes(v));
        if (!fms.length) continue;
        const fm = fms[Math.floor(Math.random() * fms.length)];
        const skel = v + '|' + obj.o;
        // один объект не должен выпасть несколько раз подряд (жалоба на тройную чайку)
        if (state.comboBan.includes(skel) || state.recentSkel.includes(skel) || state.recentObj.includes(obj.o)) continue;
        state.recentSkel.push(skel);
        state.recentSkel = state.recentSkel.slice(-4);
        state.recentObj.push(obj.o);
        state.recentObj = state.recentObj.slice(-3);
        // «без слов» — секретная пантомима (крокодил) с таймером на подумать
        const tokens = fm.secret ? ' [[тайно]] [[таймер ' + fm.timer + ']]' : '';
        // «расскажи» управляет падежом: «про новый год», а не «расскажи новый год»
        const objPhrase = (v === 'расскажи' && obj.tell) ? obj.tell : obj.o;
        // tpl: null — комбо не пишутся в chosen/blacklist, их ведут recentSkel + comboBan
        return { text: '{name}, ' + v + ' ' + objPhrase + ' ' + fm.f + '.' + tokens, tpl: null, skel };
      }
    }
    const bagKey = level + ':' + type;
    if (!state.bags[bagKey] || !state.bags[bagKey].length) {
      let pool = [...DATA.tasks[level][type]];
      // пакеты: включённые темы подмешиваются в общий мешок (Hot — без пакетов, он тематический)
      if (level !== 'hot') DATA.packs.forEach(p => { if (state.packs[p.id]) pool = pool.concat(p[type] || []); });
      state.bags[bagKey] = shuffle(pool);
    }
    // чёрный список компании + то, что игрок уже ВЫБИРАЛ, не выпадает; не выбранное — может
    const chosenBy = (state.chosen[playerName] || {})[type] || [];
    const skipped = [];
    let text = null;
    while (state.bags[bagKey].length) {
      const t = state.bags[bagKey].pop();
      if (state.blacklist.includes(t) || chosenBy.includes(t)) { skipped.push(t); continue; }
      text = t; break;
    }
    if (text === null) {                    // игрок уже прошёл всё — разрешаем повторы
      // пересобираем мешок с нуля: база + включённые пакеты, без чёрного списка и уже выбранного
      let pool = [...DATA.tasks[level][type]];
      if (level !== 'hot') DATA.packs.forEach(p => { if (state.packs[p.id]) pool = pool.concat(p[type] || []); });
      pool = pool.filter(t => !state.blacklist.includes(t) && !chosenBy.includes(t));
      // совсем нечего (всё забанено/выбрано) — тогда повторяем из всей базы уровня
      // (копия! ссылку в мешок давать нельзя — pop() выкачает DATA насквозь)
      if (!pool.length) pool = [...DATA.tasks[level][type]];
      state.bags[bagKey] = shuffle(pool);
      text = pool[Math.floor(Math.random() * pool.length)];
      toast('Новые задания закончились, повторяем');   // DATA-2: молчаливые повторы выглядят как баг
    } else {
      skipped.forEach(t => state.bags[bagKey].unshift(t));
    }
    // локальные токены фиксируются при вытяжке — превью и задание совпадают;
    // tpl (сырой шаблон с {room}/{object}) нужен для чёрного списка и «уже выбранного»
    const tpl = text;
    text = text.replace(/\{room\}/g, () => ROOMS[Math.floor(Math.random() * ROOMS.length)])
               .replace(/\{object\}/g, () => OBJECTS[Math.floor(Math.random() * OBJECTS.length)]);
    return { text, tpl };
  }

  function markChosen(name, type, text) {
    if (!state.chosen[name]) state.chosen[name] = { truth: [], action: [] };
    if (!state.chosen[name][type].includes(text)) state.chosen[name][type].push(text);
    // STORE-1: chosen не разрастается бесконечно — старейшие забываются
    if (state.chosen[name][type].length > 80) state.chosen[name][type].splice(0, state.chosen[name][type].length - 80);
    store.set('chosen', state.chosen);
  }

  /* ── SPIN-2/SPIN-3: анимация колеса ──
     Ведущий путь — Web Animations API (track.animate): нативный API браузера,
     без библиотек/CDN/сети — работает офлайн так же, как CSS-анимации. JS не
     пишет style.transform каждый кадр. Fallback — requestAnimationFrame от
     timestamp кадра (синхронизирован с repaint; setInterval не используется).
     Любая отмена (блиц, уход с экрана, новый запуск) гасит анимацию, RAF,
     запланированные щелчки и оба отложенных перехода (reduced-motion finishSpin
     через 250 мс и openChoice через 700 мс) — двойной finishSpin и открытие
     выбора поверх чужого экрана невозможны. */
  function dropSpinAnim() {   // снять залившуюся анимацию (fill: forwards держит финал)
    if (state.spinAnim) { try { state.spinAnim.cancel(); } catch {} state.spinAnim = null; }
  }
  function cancelSpin() {     // полный аборт: анимация + RAF + отложенные щелчки + отложенные переходы
    dropSpinAnim();
    if (state.spinRaf) { cancelAnimationFrame(state.spinRaf); state.spinRaf = null; }
    clearSpinTicks();
    if (state.spinRmTimer) { clearTimeout(state.spinRmTimer); state.spinRmTimer = null; }
    if (state.spinChoiceTimer) { clearTimeout(state.spinChoiceTimer); state.spinChoiceTimer = null; }
  }
  function clearSpinTicks() {
    (state.spinTicks || []).forEach(clearTimeout);
    state.spinTicks = null;
  }
  // момент пересечения границы имени (доля пути p) на кривой cubic-bezier:
  // решаем x(u)=p Ньютоном и берём y(u) — тот же масштаб времени, что у браузера
  function bezierTime(x1, y1, x2, y2, p) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const xf = u => ((ax * u + bx) * u + cx) * u;
    const yf = u => ((ay * u + by) * u + cy) * u;
    let u = p;
    for (let i = 0; i < 8; i++) {
      const dx = (3 * ax * u + 2 * bx) * u + cx;
      if (Math.abs(dx) < 1e-6) break;
      const diff = xf(u) - p;
      if (Math.abs(diff) < 1e-5) break;
      u -= diff / dx;
    }
    return Math.min(1, Math.max(0, yf(u)));
  }
  // расписание щелчков: по границе на каждое пройденное имя; тики ближе 40 мс
  // сливаются — прежний троттлинг «не чаще 25 раз в секунду» без джанка
  function scheduleTicks(easeArr, dur, crossings) {
    const times = [];
    if (state.sound && crossings > 0) {
      for (let k = 1; k <= crossings; k++) {
        const t = bezierTime(easeArr[0], easeArr[1], easeArr[2], easeArr[3], k / crossings) * dur;
        if (times.length && t - times[times.length - 1] < 40) continue;
        times.push(t);
      }
    }
    state.spinTicks = times.map(ms => setTimeout(tickSound, ms));
  }

  function spin(opts = {}) {
    if (state.spinning || state.players.length < 2) return;
    state.spinning = true;
    state.spinToken = (state.spinToken || 0) + 1;   // блиц может сбросить круг прямо во время анимации
    const token = state.spinToken;
    dropSpinAnim();   // SPIN-2: fill:forwards прошлой прокрутки не должен держать ленту на месте
    vibrate(30);

    // экран колеса плавно уезжает — имена подъезжают следом
    const wheelScreen = $('#screen-wheel');
    const overlay = $('#spinOverlay');
    wheelScreen.classList.add('leaving');

    const rem = state.remaining.length ? state.remaining : [...state.players];
    const n = rem.length;
    // анти-повтор (WHEEL-1): pool — чистая функция в js/lang.js, последний выпавший
    // исключается только при ≥3 игроках; проверяется симуляцией в тестах
    const pool = wheelPool(rem, state.recent);
    const chosenIdx = pool[Math.floor(Math.random() * pool.length)];
    const pad = SPIN_PAD;
    const dir = opts.dir || 1;                                   // 1 — лента вверх, -1 — вниз
    const loops = opts.swipe ? 2 + Math.floor(Math.random() * 2) : 1;  // свайп — 2–3 оборота, тап — один короткий
    const endIdx = pad + chosenIdx + loops * n;                  // где встанет победитель
    const startIdx = dir === 1 ? pad : endIdx + (n - chosenIdx) + loops * n;
    const total = Math.max(endIdx, startIdx) + pad + 3;

    const track = $('#spinTrack');
    let html = '';
    for (let i = 0; i < total; i++) {
      const pIdx = ((i - pad) % n + n) % n;
      const pname = rem[pIdx];
      const cIdx = Math.max(0, state.players.indexOf(pname));   // цвет — по позиции в общем списке
      // PLAYERS-3: длинное имя ужимается, а не вылезает за экран 320px
      const tight = pname.length > 10 ? ' font-size:26px;padding:14px 22px;min-width:0;letter-spacing:0' : '';
      html += `<div class="spin-name" data-i="${i}"><span style="background:${playerColor(cIdx)}${tight}">${esc(pname)}</span></div>`;
    }
    track.innerHTML = html;

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('show');

    // имя i по центру: translate(-50%, (total/2 - i - 0.5) * H)
    const NAME_H = nameH();
    const offset = i => (total / 2 - i - .5) * NAME_H;
    track.style.transition = 'none';
    track.style.transform = `translate(-50%, calc(-50% + ${offset(startIdx)}px))`;
    void track.offsetWidth;

    const from = offset(startIdx), to = offset(endIdx);
    const dist = to - from;
    let dur, easeArr, ease;               // easeArr — контрольные точки cubic-bezier для WAAPI
    if (opts.swipe) {                     // свайп: лента сразу летит, как продолжение жеста (easeOutCubic)
      easeArr = [0.215, 0.61, 0.355, 1];
      ease = t => 1 - Math.pow(1 - t, 3);
      dur = Math.min(5500, Math.max(1500, 3 * Math.abs(dist) / (opts.v || 3)));
    } else {                              // тап: разгон с места, коротко (easeInOutQuart)
      easeArr = [0.77, 0, 0.175, 1];
      ease = t => t < .5 ? 8 * t * t * t * t : 1 - 8 * Math.pow(1 - t, 4);
      dur = 1200 + Math.random() * 200;
    }

    // SPIN-2: prefers-reduced-motion — мгновенный честный переход к победителю
    let reduced = false;
    try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
    if (reduced) {
      track.style.transform = `translate(-50%, calc(-50% + ${to}px))`;
      state.spinTicks = [];
      state.spinRmTimer = setTimeout(() => {
        state.spinRmTimer = null;                    // SPIN-3: сработал штатно — признак снят
        if (token !== state.spinToken) return;       // отменено или перезапущено — экран не трогаем
        finishSpin(endIdx, rem[chosenIdx], token);
      }, 250);
      return;
    }

    // SPIN-2: основной путь — нативная анимация, браузер двигает transform сам
    if (typeof track.animate === 'function' && track.animate.length >= 1) {
      let anim = null;
      try {
        anim = track.animate(
          [{ transform: `translate(-50%, calc(-50% + ${from}px))` }, { transform: `translate(-50%, calc(-50% + ${to}px))` }],
          { duration: dur, easing: `cubic-bezier(${easeArr[0]}, ${easeArr[1]}, ${easeArr[2]}, ${easeArr[3]})`, fill: 'forwards' }
        );
      } catch {}
      // anim.finished обязан быть промисом: без него — обычный rAF-путь
      if (anim && anim.finished && typeof anim.finished.then === 'function') {
        state.spinAnim = anim;   // fill: forwards держит победителя до следующего запуска
        scheduleTicks(easeArr, dur, Math.abs(endIdx - startIdx));
        anim.finished.then(() => {
          if (token !== state.spinToken) return;   // отменено — cancelSpin уже всё прибрал
          clearSpinTicks();
          finishSpin(endIdx, rem[chosenIdx], token);
        }).catch(() => {});                        // anim.cancel() штатно отклоняет promise
        return;
      }
      if (anim) { try { anim.cancel(); } catch {} }
    }

    // SPIN-2 fallback: requestAnimationFrame от timestamp кадра
    const t0 = performance.now();
    let lastIdx = -1, lastTickAt = 0;
    const frame = now => {
      if (token !== state.spinToken || state.spinRaf === null) return;   // отменено
      const t = Math.min(1, (now - t0) / dur);
      const y = from + ease(t) * dist;
      const idx = Math.floor(total / 2 - y / NAME_H);
      if (idx !== lastIdx) {
        lastIdx = idx;
        // троттлинг тиков: звук не чаще 25 раз в секунду — меньше джанка на свайпе
        if (now - lastTickAt > 40) { lastTickAt = now; tickSound(); }
      }
      track.style.transform = `translate(-50%, calc(-50% + ${y}px))`;
      if (t >= 1) {
        state.spinRaf = null;
        finishSpin(endIdx, rem[chosenIdx], token);
        return;
      }
      state.spinRaf = requestAnimationFrame(frame);
    };
    state.spinRaf = requestAnimationFrame(frame);
  }

  function finishSpin(winIdx, winnerName, token) {
    if (token !== state.spinToken) {         // круг сброшен блицем во время анимации
      cancelSpin();                           // SPIN-2: страховка — анимация/RAF/тики не переживут сброс
      $('#spinOverlay').classList.add('hidden');
      $('#screen-wheel').classList.remove('leaving');
      state.spinning = false;
      return;
    }
    // запоминаем двух последних, чтобы один игрок не выпадал много раз подряд
    state.recent.push(winnerName);
    state.recent = state.recent.slice(-2);
    const winner = document.querySelector(`.spin-name[data-i="${winIdx}"]`);
    if (winner) winner.classList.add('win');
    vibrate([60, 60, 140]);
    // победитель колеса — единственный источник имени для экрана выбора
    state.spinChoiceTimer = setTimeout(() => {
      state.spinChoiceTimer = null;                  // SPIN-3: сработал штатно — признак снят
      if (token !== state.spinToken) return;         // SPIN-3: уход с экрана/блиц/новый запуск — выбор не открываем
      const ov = $('#spinOverlay');
      ov.classList.add('hidden');
      ov.classList.remove('show');
      $('#screen-wheel').classList.remove('leaving');
      openChoice(winnerName);
      state.spinning = false;
    }, 700);
  }

  /* ══════════ Экран 4: выбор правда / действие ══════════ */
  let pending = null;   // { name, truth, action }

  function pickActionMod(taskText) {
    const o = taskText.match(/\[\[мод:([^\]]+)\]\]/);
    if (o) return o[1].trim();
    // DATA-3: [[без-мод]] и таймерные/секретные задания модификатор не получают
    if (/\[\[таймер/.test(taskText) || /\[\[тайно\]\]/.test(taskText) || /\[\[мод:/.test(taskText) || /\[\[без-мод\]\]/.test(taskText)) return null;
    return Math.random() < .5 ? MODS[Math.floor(Math.random() * MODS.length)] : null;
  }

  function openChoice(name) {
    const aDraw = drawTask(state.level, 'action', name);
    // модификатор: явный [[мод:X]] приоритетнее, иначе случайный с шансом 50% (не для таймерных/секретных)
    const actionMod = pickActionMod(aDraw.text);
    const tDraw = drawTask(state.level, 'truth', name);
    pending = {
      name,
      truth: tDraw.text, truthTpl: tDraw.tpl,
      action: aDraw.text, actionTpl: aDraw.tpl, actionSkel: aDraw.skel || null,
      actionMod
    };
    $('#choiceName').textContent = name;
    // «случайный друг» фиксируется один раз: превью = то, что получишь после выбора
    pending.otherTruth = pickOther(name);
    pending.otherAction = pickOther(name);
    renderChoicePreview('truth');
    renderChoicePreview('action');
    speak(name + ', правда или действие?');

    // лимит: тот же вариант не больше 2 раз подряд (сброс — выбором противоположного)
    const st = state.streaks[name];
    const lockTruth = st && st.type === 'truth' && st.count >= 2;
    const lockAction = st && st.type === 'action' && st.count >= 2;
    $('#choiceTruth').classList.toggle('locked', !!lockTruth);
    $('#choiceAction').classList.toggle('locked', !!lockAction);
    $('#truthLock').classList.toggle('hidden', !lockTruth);
    $('#actionLock').classList.toggle('hidden', !lockAction);
    // подсказка: выбрано 1 раз подряд — предупредить заранее
    $('#truthHint').textContent = (st && st.type === 'truth' && st.count === 1)
      ? 'Правда уже выбрана 1 раз подряд. Ещё раз — и в следующий раз её выбрать будет нельзя.' : '';
    $('#actionHint').textContent = (st && st.type === 'action' && st.count === 1)
      ? 'Действие уже выбрано 1 раз подряд. Ещё раз — и в следующий раз его выбрать будет нельзя.' : '';

    showScreen('screen-choice');
    // BAN-1: одноразовая подсказка про долгое нажатие — функция иначе не находится
    if (!store.get('banHint', false)) {
      store.set('banHint', true);
      toast('Задание не понравилось? Зажми карточку, чтобы убрать');
    }
  }

  /* рендер шаблона — чистая функция в js/lang.js; пол: выбор игрока приоритетнее,
     иначе эвристика по имени, иначе нейтральный текст без скобок (GENDER-1) */
  function rt(tpl, name, other) {
    return renderTemplate(tpl, name, other, state.genders[name] || guessGender(name), state.genders[other] || guessGender(other));
  }

  /* PREVIEW-1: единая отрисовка превью карточки выбора. Секретное задание ([[тайно]])
     не рендерится вовсе — только короткая подпись: rt() не вызывается, исходный текст
     не попадает ни в DOM, ни в title/aria-label/data-*. Он живёт в pending и раскрывается
     только приватным сценарием «возьми телефон» на экране задания */
  function renderChoicePreview(type) {
    const el = $(type === 'truth' ? '#truthPreview' : '#actionPreview');
    const secretLabel = choicePreview(pending[type], type);
    if (secretLabel) el.textContent = secretLabel;
    else el.innerHTML = rt(pending[type], pending.name, type === 'truth' ? pending.otherTruth : pending.otherAction).html;
  }

  $('#choiceTruth').addEventListener('click', () => choose('truth'));
  $('#choiceAction').addEventListener('click', () => choose('action'));

  function choose(type) {
    if (!pending || banOpen) return;   // клик после зажатия не выбирает
    const card = $(type === 'truth' ? '#choiceTruth' : '#choiceAction');
    if (card.classList.contains('locked')) return;   // залоченный вариант не выбирается (но бан по зажатию доступен)
    const st = state.streaks[pending.name];
    if (st && st.type === type) st.count += 1;
    else state.streaks[pending.name] = { type, count: 1 };
    // в chosen идёт сырой шаблон; комбо (tpl: null) не сохраняем — их ведёт recentSkel/comboBan
    if (pending[type + 'Tpl']) markChosen(pending.name, type, pending[type + 'Tpl']);
    if (!state.stats[pending.name]) state.stats[pending.name] = newStats();
    state.stats[pending.name][type === 'truth' ? 'truth' : 'action']++;
    store.set('stats', state.stats);
    reveal(type);
  }

  /* ══════════ Экран 5: задание ══════════ */
  // detectTimerSecs вынесен в js/lang.js (тестируется на Node)

  function reveal(type) {
    const raw = pending[type];          // сырой шаблон: все служебные токены на месте
    state.currentTask = raw;
    const isTruth = type === 'truth';
    $('#revealType').textContent = isTruth ? 'правда' : 'действие';

    // секретное задание: текст скрыт, отвечающий читает его один ([[тайно]])
    const secret = /\[\[тайно\]\]/.test(raw);

    // таймер задания: явный [[таймер N]] или длительность в тексте
    const secs = Math.min(600, detectTimerSecs(raw));
    clearInterval(state.taskTimerId);
    const tb = $('#taskTimerBtn');
    tb.classList.remove('running', 'finished');
    if (secs > 0) {
      tb.dataset.secs = secs;
      setTimerBtnText(tb, 'Запустить таймер (' + fmtTime(secs) + ')');
      tb.classList.remove('hidden');
    } else {
      tb.dataset.secs = '';
      tb.classList.add('hidden');
    }

    // пояснение: [[пояснение:X]] — кнопка «?» рядом с заданием
    const h = raw.match(/\[\[пояснение:([^\]]+)\]\]/);
    const hb = $('#hintBtn'), hbx = $('#hintBox');
    hbx.classList.add('hidden');
    if (h) { hb.classList.remove('hidden'); state.currentHint = h[1]; }
    else { hb.classList.add('hidden'); state.currentHint = ''; }

    // плашка модификатора к действию
    const mod = !isTruth ? pending.actionMod : null;
    state.currentMod = mod;
    const plate = $('#modPlate');
    if (mod) {
      plate.querySelector('span').textContent = 'Условие: ' + mod;
      plate.classList.toggle('hidden', secret);
    } else plate.classList.add('hidden');

    // рендер уже вычищает все служебные токены; other тот же, что был в превью
    const chosenOther = isTruth ? pending.otherTruth : pending.otherAction;
    const r = rt(raw, pending.name, chosenOther);
    let plain = r.plain;
    if (mod && !secret) plain = plain.replace(/\.?\s*$/, '') + '. Условие: ' + mod;
    $('#revealText').innerHTML = r.html;
    state.currentPlain = plain;
    $('#punishNote').innerHTML = 'Не выполнено — <b>' + esc(state.punish) + '</b><br>и остаёшься в колесе';

    const panel = $('#taskPanel');
    if (secret) {
      // флоу «возьми телефон»: текст появится только по кнопке, озвучка выключена
      $('#revealText').classList.add('hidden');
      plate.classList.add('hidden');
      tb.classList.add('hidden');
      $('#hintBtn').classList.add('hidden');
      $('#hintBox').classList.add('hidden');
      $('#secretBox').classList.remove('hidden');
      $('#secretTitle').innerHTML = '<b>' + esc(pending.name) + '</b>, возьми телефон';
      $('#secretReadBtn').textContent = 'Прочитать задание';
      $('#secretReadBtn').classList.remove('hidden');
      panel.classList.add('hidden');
      showScreen('screen-reveal');
      return;
    }
    $('#revealText').classList.remove('hidden');
    $('#secretBox').classList.add('hidden');
    $('#secretHideBtn').classList.add('hidden');
    $('#ttsBtn').classList.remove('hidden');       // не-секретное задание можно озвучить
    panel.classList.remove('hidden');
    revealSound(isTruth);
    showScreen('screen-reveal');
    speak(plain);                       // диктор читает задание
  }

  // автоматический таймер уровня убран: время — только там, где задаёт само задание ([[таймер N]])

  /* ── Круги: Выполнил → вылетает до следующего круга; Не выполнил → остаётся ── */
  function completeTask(done) {
    if (!pending) return;                 // двойной быстрый тап не должен писать статистику дважды
    stopSpeak();
    stopTaskTimer();                      // TIMER-1
    const name = pending.name;
    pending = null;                       // ход завершён — защищаем от повторного вызова
    if (!state.stats[name]) state.stats[name] = newStats();
    if (done) {
      state.stats[name].done++;
      state.remaining = state.remaining.filter(p => p !== name);
      store.set('remaining', state.remaining);
      if (!state.remaining.length) {
        const finishedRound = state.round;
        state.round += 1;
        state.remaining = [...state.players];
        store.set('round', state.round);
        store.set('remaining', state.remaining);
        renderHud();
        store.set('stats', state.stats);
        // сводка не на каждом круге, чтобы не надоедала: каждый 3-й
        if (finishedRound % 3 === 0) renderStats('Круг ' + finishedRound + ' завершён');
        startBlitzClock();
        showScreen('screen-wheel');
        return;
      }
      toast(name + ' выпадает до следующего круга. Осталось: ' + state.remaining.length);
    } else {
      state.stats[name].fails++;
      store.set('stats', state.stats);
      vibrate(120);
      toast(name + ' остаётся в колесе — ' + state.punish);
    }
    store.set('stats', state.stats);
    renderHud();
    showScreen('screen-wheel');
  }

  $('#btnDone').addEventListener('click', () => completeTask(true));
  $('#btnFail').addEventListener('click', () => completeTask(false));

  /* ── Внутренний таймер задания ── */
  // A11Y: видимый текст таймера — и aria-label (статичный label его перекрывал)
  const setTimerBtnText = (b, txt) => { b.textContent = txt; b.setAttribute('aria-label', 'Таймер задания: ' + txt); };
  // TIMER-1: таймер обязан глохнуть при любом завершении хода — beep не сработает на экране колеса
  function stopTaskTimer() {
    clearInterval(state.taskTimerId);
    state.taskTimerId = null;
    const tb = $('#taskTimerBtn');
    tb.classList.remove('running', 'finished');
  }
  $('#taskTimerBtn').addEventListener('click', () => {
    const b = $('#taskTimerBtn');
    if (b.classList.contains('running')) return;
    b.classList.add('running');
    const endAt = Date.now() + parseInt(b.dataset.secs, 10) * 1000;
    clearInterval(state.taskTimerId);
    state.taskTimerId = setInterval(() => {
      const left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      setTimerBtnText(b, fmtTime(left));
      if (left <= 0) {
        clearInterval(state.taskTimerId);
        b.classList.remove('running');
        b.classList.add('finished');
        setTimerBtnText(b, 'Время!');
        beep(660, .15, 'triangle', .18);
        vibrate([120, 80, 120]);
      }
    }, 250);
  });

  /* ── Повтор озвучки ── */
  $('#ttsBtn').addEventListener('click', () => speak(state.currentPlain));

  /* ── Пояснение к заданию ── */
  $('#hintBtn').addEventListener('click', () => {
    $('#hintText').textContent = state.currentHint || '';
    $('#hintBox').classList.remove('hidden');
    $('#hintBtn').classList.add('hidden');
  });
  $('#hintCloseBtn').addEventListener('click', () => {
    $('#hintBox').classList.add('hidden');
    $('#hintBtn').classList.remove('hidden');
  });

  /* ── Секретные задания: прочитать → скрыть → (можно перечитать) ── */
  $('#secretReadBtn').addEventListener('click', () => {
    $('#secretBox').classList.add('hidden');
    $('#revealText').classList.remove('hidden');
    const tb = $('#taskTimerBtn');
    if (tb.dataset.secs) tb.classList.remove('hidden');   // таймер показываем только после прочтения
    if (state.currentMod) $('#modPlate').classList.remove('hidden');
    if (state.currentHint) $('#hintBtn').classList.remove('hidden');
    $('#ttsBtn').classList.add('hidden');                 // TTS-1: секрет вслух не читается даже по кнопке
    $('#taskPanel').classList.remove('hidden');
    $('#secretHideBtn').classList.remove('hidden');
    vibrate(40);
  });
  $('#secretHideBtn').addEventListener('click', () => {
    $('#revealText').classList.add('hidden');
    $('#taskTimerBtn').classList.add('hidden');
    $('#modPlate').classList.add('hidden');
    $('#hintBtn').classList.add('hidden');
    $('#secretHideBtn').classList.add('hidden');
    $('#secretBox').classList.remove('hidden');
    $('#secretTitle').textContent = 'Выполняй! Затем нажми «Выполнил» или «Не выполнил»';
    $('#secretReadBtn').textContent = 'Показать ещё раз';   // путь без возврата больше не секрет
    $('#secretReadBtn').classList.remove('hidden');
    vibrate(40);
  });

  /* ══════════ Игра «Продолжи фразу» ══════════ */
  const PHRASE_H_DEFAULT = () => cssPx('--pair-item-h', 104);  // высота имени в столбике, px (источник — CSS)
  const phrase = {
    per: store.get('phPer', 5),
    mode: store.get('phMode', 'all'),
    bag: [], queue: [], picks: 0, qInPair: 0,
    scores: {}, current: null,
    pairTimer: null
  };
  phrase.per = Math.min(10, Math.max(1, Math.floor(Number(phrase.per) || 5)));   // STORE-1
  // накопительные средние оценки по игрокам: { имя: { sum, count } }
  let phStats = store.get('phStats', {});
  // STORE-1: оценки — тоже числа, битые ключи не ломают среднее
  Object.keys(phStats).forEach(nm => {
    const p = phStats[nm] || {};
    phStats[nm] = { sum: clampCount(p.sum), count: clampCount(p.count) };
  });
  store.set('phStats', phStats);

  function renderModeChips() {
    $('#modeChips').innerHTML = window.PHRASE.modes.map(m =>
      `<button data-mode="${m.id}" class="${m.id === phrase.mode ? 'on' : ''}">${m.name}</button>`).join('');
    $('#modeTag').textContent = (window.PHRASE.modes.find(m => m.id === phrase.mode) || {}).tagline || '';
    syncPunishInputs();
  }
  $('#modeChips').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]'); if (!b) return;
    phrase.mode = b.dataset.mode; store.set('phMode', phrase.mode);
    renderModeChips();
  });
  $('#perMinus').addEventListener('click', () => { phrase.per = Math.max(1, phrase.per - 1); store.set('phPer', phrase.per); $('#perValue').textContent = phrase.per; });
  $('#perPlus').addEventListener('click', () => { phrase.per = Math.min(10, phrase.per + 1); store.set('phPer', phrase.per); $('#perValue').textContent = phrase.per; });

  function phraseStart() {
    if (state.players.length < 2) { toast('Нужно минимум 2 игрока'); return; }
    clearTimeout(phrase.pairTimer);        // PHRASE-2: отложенный callback старой пары не survives новый круг
    phrase.current = null;                 // PHRASE-2
    phrase.bag = []; phrase.picks = 0; phrase.qInPair = 0;
    phrase.scores = {};
    state.players.forEach(nm => phrase.scores[nm] = []);
    // пары круга: случайная перестановка без самих себя — каждый по разу читает и отвечает
    const ans = shuffle([...state.players]);
    const rds = shuffle([...state.players]);
    for (let i = 0; i < ans.length; i++) {
      if (rds[i] === ans[i]) {
        const j = (i + 1) % ans.length;
        [rds[i], rds[j]] = [rds[j], rds[i]];
      }
    }
    phrase.queue = ans.map((a, i) => ({ reader: rds[i], answerer: a }));
    resetPairScreen();
    showScreen('screen-phrase-round');
  }
  $('#phraseStartBtn').addEventListener('click', phraseStart);
  $('#phraseAgainBtn').addEventListener('click', phraseStart);
  $('#phraseSettingsBtn').addEventListener('click', () => { renderModeChips(); showScreen('screen-phrase-setup'); });
  $('#phraseGamesBtn').addEventListener('click', () => showScreen('screen-games'));

  function resetPairScreen() {
    $('#pairSpinBtn').classList.remove('hidden');
    $('#phraseGoBtn').classList.add('hidden');
    $('#pairCaption').textContent = 'Выберите пару!';
    // после последней пары queue пуст — не показываем «Пара N+1 из N»
    const done = state.players.length - phrase.queue.length;
    $('#phProgress').textContent = 'Пара ' + Math.min(done + 1, state.players.length) + ' из ' + state.players.length;
  }

  function drawPair() {
    return phrase.queue.shift();
  }

  function spinColumns(reader, answerer) {
    const n = state.players.length;
    // разные подсветки: читающий — золотая, отвечающий — бирюзовая
    const winCls = ['win-reader', 'win-answer'];
    [['#colReader', reader], ['#colAnswerer', answerer]].forEach(([sel, who], k) => {
      const track = $(sel);
      const rIdx = Math.max(0, state.players.indexOf(who));
      const reps = 3;
      let html = '';
      for (let i = 0; i < n * (reps + 1); i++) {
        html += `<div class="pair-item" style="background:${playerColor(i % n)}"><span>${esc(state.players[i % n])}</span></div>`;
      }
      track.innerHTML = html;
      // проверка длины имени: ужимаем шрифт, пока текст не влезет с РАВНЫМИ отступами
      // (меряем сам span против ширины окна минус паддинги — scrollWidth тут врёт:
      //  центрированный переполняет в обе стороны и прячется в паддинг)
      const PAD = 20;                        // 10px слева + 10px справа (css .pair-item)
      const sizes = {};
      [...track.children].forEach(it => {
        const nm = it.textContent;
        if (!(nm in sizes)) {
          const span = it.querySelector('span');
          const avail = it.clientWidth - PAD;
          let size = 27;
          span.style.fontSize = size + 'px';
          while (span.getBoundingClientRect().width > avail && size > 13) {
            size -= 1;
            span.style.fontSize = size + 'px';
          }
          sizes[nm] = size;
        }
        it.querySelector('span').style.fontSize = sizes[nm] + 'px';
      });
      // высота строки — из фактического DOM, чтобы JS и CSS не разошлись
      const H = track.children[0]?.offsetHeight || PHRASE_H_DEFAULT();
      track.style.transition = 'none';
      track.style.transform = 'translateY(0)';
      void track.offsetWidth;
      const target = reps * n + rIdx;      // окно остановится на этом имени
      track.dataset.target = target;
      track.dataset.wincls = winCls[k];
      track.style.transition = `transform 1.9s cubic-bezier(.15,.85,.25,1) ${k * .15}s`;
      track.style.transform = `translateY(-${target * H}px)`;
    });
  }

  $('#pairSpinBtn').addEventListener('click', () => {
    if (!phrase.queue.length) return showPhResults();
    phrase.current = drawPair();                 // отвечающий берётся из очереди круга
    phrase.qInPair = 0;
    phrase.picks = state.players.length - phrase.queue.length;
    $('#phProgress').textContent = 'Пара ' + phrase.picks + ' из ' + state.players.length;
    spinColumns(phrase.current.reader, phrase.current.answerer);
    $('#pairSpinBtn').classList.add('hidden');
    $('#phraseGoBtn').classList.add('hidden');
    $('#pairCaption').textContent = '...';
    clearTimeout(phrase.pairTimer);        // PHRASE-2: двойной тап не плодит callback'и
    phrase.pairTimer = setTimeout(() => {
      // подсветка выпавшей пары — чтобы финал был виден и в середине анимации
      ['#colReader', '#colAnswerer'].forEach(sel => {
        const tr = $(sel);
        const w = tr.children[tr.dataset.target];
        if (w) w.classList.add(tr.dataset.wincls);
      });
      $('#pairCaption').textContent = phrase.current.reader + ' читает — ' + phrase.current.answerer + ' отвечает!';
      $('#phraseGoBtn').classList.remove('hidden');
      vibrate(40);
    }, 2250);
  });

  function drawPrompt() {
    if (!phrase.bag.length) {
      const cats = phrase.mode === 'all' ? ['friendly', 'names', 'dark'] : [phrase.mode];
      phrase.bag = shuffle(cats.flatMap(c => window.PHRASE.prompts[c]).filter(t => !state.blacklist.includes(t)));
    }
    let t = phrase.bag.pop();
    if (!t) {   // мешок пуст, а все фразы забанены — повторяем из незабаненных, в крайнем случае из любых
      const ok = window.PHRASE.prompts.friendly.filter(x => !state.blacklist.includes(x));
      t = ok[Math.floor(Math.random() * ok.length)] || window.PHRASE.prompts.friendly[0];
    }
    return t.replace(/\{room\}/g, () => ROOMS[Math.floor(Math.random() * ROOMS.length)])
            .replace(/\{object\}/g, () => OBJECTS[Math.floor(Math.random() * OBJECTS.length)]);
  }

  function showPhrasePrompt() {
    const tpl = drawPrompt();
    // отвечающий импровизирует ПРО других: цель — случайный игрок, но не сам отвечающий
    const others = state.players.filter(p => p !== phrase.current.answerer);
    const who = others[Math.floor(Math.random() * others.length)];
    const pool2 = others.filter(p => p !== who);
    const other = pool2[Math.floor(Math.random() * pool2.length)] || who;
    const r = rt(tpl, who, other);
    $('#phTaskMeta').textContent = phrase.current.reader + ' читает · фраза ' + (phrase.qInPair + 1) + ' из ' + phrase.per;
    $('#phTaskText').innerHTML = r.html;
    state.currentPlain = r.plain;
    // последняя фраза пары — на оценку зала
    const last = phrase.qInPair + 1 >= phrase.per;
    const btn = $('#phraseNextBtn');
    btn.classList.remove('hidden');                    // после оценки пары кнопка возвращается
    btn.textContent = last ? 'Оценить пару' : 'Следующая фраза ›';
    $('#ratePanel').classList.add('hidden');
    // PHRASE-1: очки получает отвечающий — подсказка говорит честно, за кого оценка
    $('.rate-hint').textContent = 'Оценка зала за ответы ' + phrase.current.answerer;
    showScreen('screen-phrase-task');
  }

  $('#phraseGoBtn').addEventListener('click', () => {
    if (!phrase.current) return;
    showPhrasePrompt();
  });

  $('#phraseNextBtn').addEventListener('click', () => {
    if (!phrase.current) return;
    if (phrase.qInPair + 1 < phrase.per) {
      phrase.qInPair++;
      showPhrasePrompt();
      return;
    }
    // пара отработала все фразы — зал ставит оценку
    $('#phraseNextBtn').classList.add('hidden');
    $('#ratePanel').classList.remove('hidden');
  });

  $('#ratePanel').addEventListener('click', e => {
    // шаг 1: зал выбирает балл — подсвечиваем и ждём подтверждения
    const b = e.target.closest('[data-r]');
    if (b) {
      document.querySelectorAll('.rate-btn').forEach(x => x.classList.toggle('sel', x === b));
      $('#rateConfirmBtn').classList.remove('hidden');
      return;
    }
    // шаг 2: подтверждение — записываем оценку
    if (e.target.closest('#rateConfirmBtn')) {
      const sel = document.querySelector('.rate-btn.sel');
      const r = parseInt(sel.dataset.r, 10);
      const who = phrase.current.answerer;
      phrase.scores[who].push(r);
      if (!phStats[who]) phStats[who] = { sum: 0, count: 0 };
      phStats[who].sum += r; phStats[who].count++;
      store.set('phStats', phStats);
      document.querySelectorAll('.rate-btn').forEach(x => x.classList.remove('sel'));
      $('#rateConfirmBtn').classList.add('hidden');
      if (!phrase.queue.length) return showPhResults();
      resetPairScreen();
      showScreen('screen-phrase-round');
    }
  });

  /* ── Статистика средних оценок фразы ── */
  function renderPhStats() {
    renderStats('Средние оценки', 'phrase');
  }
  $('#phraseStatsBtn').addEventListener('click', renderPhStats);
  $('#phraseStatsBtn2').addEventListener('click', renderPhStats);

  /* ── Наказание: инпут в настройках фразы синхронен глобальному ── */
  const syncPunishInputs = () => {
    const pi = $('#punishInput'), pp = $('#phrasePunishInput');
    if (pi) pi.value = state.punish;
    if (pp) pp.value = state.punish;
  };
  $('#phrasePunishInput').addEventListener('input', () => {
    const v = $('#phrasePunishInput').value.trim();
    state.punish = v || DEFAULT_PUNISH;
    store.set('punish', state.punish);
    const pi = $('#punishInput'); if (pi) pi.value = state.punish;
  });
  $('#phrasePunishInput').addEventListener('blur', syncPunishInputs);

  function showPhResults() {
    clearTimeout(phrase.pairTimer);
    const rows = state.players.map(nm => {
      const arr = phrase.scores[nm] || [];
      return { nm, sum: arr.reduce((a, b) => a + b, 0) };
    }).sort((a, b) => b.sum - a.sum);
    const min = rows.length ? rows[rows.length - 1].sum : 0;
    const max = rows.length ? rows[0].sum : 0;
    // PHRASE-1: ничья за последнее место — помечаем всех, а не «кого в списке последним»
    const losers = rows.filter(r => r.sum === min);
    const winners = rows.filter(r => r.sum === max && max !== min);
    $('#phResultsTitle').textContent = 'Круг завершён';
    $('#phResultsTable').innerHTML = rows.map(r =>
      `<div class="ph-result-row${r.sum === min ? ' loser' : ''}"><b>${esc(r.nm)}</b><span class="ph-score">${r.sum}</span></div>`).join('');
    $('#phLoser').innerHTML =
      (winners.length ? 'Лучший результат — <b>' + winners.map(w => esc(w.nm)).join(' и ') + '</b> (' + max + '). ' : '') +
      'Последнее место — <b>' + losers.map(l => esc(l.nm)).join(' и ') + '</b>: ' + esc(state.punish);
    showScreen('screen-phrase-results');
    vibrate([60, 60, 140]);
  }

  /* ══════════ Игра «Нарисуй по памяти» ══════════
     Отдельный режим: слова слушаются голосом (TTS — сама суть игры, поэтому
     глобальный выключатель «Озвучка заданий» здесь не применяется),
     рисуются на бумаге, проверяются парами «задающий → отвечающий».
     Чистая логика — в js/draw-memory-core.js, база — в js/draw-memory-data.js */
  const DMD = window.DRAW_MEMORY_DATA;
  const DMC = window.DRAW_MEMORY_CORE;
  const DM_PER_PRESETS = [
    { n: 2, label: 'Легко · 2' }, { n: 3, label: 'Нормально · 3' },
    { n: 4, label: 'Сложно · 4' }, { n: 5, label: 'Очень сложно · 5' }
  ];
  const DM_PACE_PRESETS = [
    { r: .7, label: 'Медленно' }, { r: 1, label: 'Обычно' }, { r: 1.3, label: 'Быстро' }
  ];
  const DM_DRAW_PRESETS = [15, 30, 45, 60, 0];
  const dmNum = (v, d, lo, hi) => { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };

  const dm = {
    settings: (() => {
      const s = store.get('dmSettings', {});
      return {
        per: Math.round(dmNum(s.per, 3, 1, 10)),
        rate: dmNum(s.rate, 1, .5, 1.5),
        pause: dmNum(s.pause, 1, 0, 3),
        drawSecs: Math.round(dmNum(s.drawSecs, 30, 0, 120))
      };
    })(),
    recent: (() => {
      const r = store.get('dmRecent', []);
      return Array.isArray(r) ? r.filter(w => typeof w === 'string') : [];
    })(),
    round: null,          // активный раунд (объект из fant.dmRound)
    checkIdx: null,       // открытая карточка проверки
    seqToken: 0,          // гвардия TTS-цепочки и таймеров (DM-1)
    tickId: null,         // интервал отсчёта/таймера дорисовки
    running: false,       // идёт ли озвучка/отсчёт/таймер прямо сейчас
    ttsOk: null,          // null — ещё проверяем
    ttsIv: null
  };
  // раунд читается из хранилища с проверкой целостности: битая/чужая схема — выбрасывается
  dm.round = (() => {
    const r = store.get('dmRound', null);
    if (!r || typeof r !== 'object' || r.v !== 1) return null;
    if (!Array.isArray(r.words) || !Array.isArray(r.cards) || !Array.isArray(r.pairs) || !Array.isArray(r.players)) return null;
    if (typeof r.total !== 'number' || r.words.length !== r.total || r.cards.length !== r.total || r.pairs.length !== r.total) return null;
    if (['listen', 'draw', 'checks', 'done'].indexOf(r.phase) < 0) return null;
    r.scores = r.scores && typeof r.scores === 'object' ? r.scores : DMC.newScores(r.players);
    r.hist = Array.isArray(r.hist) ? r.hist : [];
    r.listenIdx = Math.min(Math.max(0, Math.floor(dmNum(r.listenIdx, 0, 0, r.total))), r.total);
    r.drawLeft = Math.max(0, Math.floor(dmNum(r.drawLeft, 0, 0, 7200)));
    // DM-NUMS: использованные номера общие на всю партию и переживают перезагрузку;
    // список самовосстанавливается по карточкам — номер не может «вернуться» после сбоя
    r.usedNums = Array.isArray(r.usedNums)
      ? r.usedNums.filter(n => Number.isInteger(n) && n >= 1 && n <= r.total)
      : [];
    r.cards.forEach(c => {
      if (c.num && Number.isInteger(c.num) && c.num >= 1 && c.num <= r.total && !r.usedNums.includes(c.num)) {
        r.usedNums.push(c.num);
      }
    });
    return r;
  })();
  const dmSave = () => { if (dm.round) store.set('dmRound', dm.round); };
  const dmSaveSettings = () => store.set('dmSettings', dm.settings);

  /* ── вход в режим ── */
  function dmEnter() {
    if (state.players.length < 2) { toast('Сначала добавьте игроков'); openPlayers('screen-games'); return; }
    if (dm.round && dm.round.phase !== 'done') { dmOpenListen('hub'); return; }   // незавершённый раунд — в безопасную паузу
    dmRenderSetup();
    showScreen('screen-dm-setup');
  }

  /* ── настройки ── */
  const dmRateLabel = () => {
    const p = DM_PACE_PRESETS.find(p => Math.abs(dm.settings.rate - p.r) < .01);
    return p ? 'Темп: ' + p.label.toLowerCase() + ' (' + dm.settings.rate.toFixed(2).replace(/\.?0+$/, '') + '×)'
             : 'Свой темп: ' + dm.settings.rate.toFixed(2).replace(/\.?0+$/, '') + '×';
  };
  const dmPauseLabel = () => dm.settings.pause
    ? 'Пауза: ' + dm.settings.pause.toFixed(2).replace(/\.?0+$/, '') + ' с'
    : 'Без паузы — слова идут подряд';
  function dmTotalLine() {
    const nP = state.players.length, per = dm.settings.per, total = nP * per;
    $('#dmTotalLine').textContent = nP < 2
      ? 'Добавьте минимум 2 игроков'
      : nP + ' ' + DMC.plural(nP, ['игрок', 'игрока', 'игроков']) + ' × ' + per + ' ' +
        DMC.plural(per, ['вопрос', 'вопроса', 'вопросов']) + ' = ' + total + ' ' +
        DMC.plural(total, ['слово', 'слова', 'слов']) + ' и ' + total + ' ' +
        DMC.plural(total, ['проверка', 'проверки', 'проверок']);
  }
  function dmRenderTtsWarn(text) {
    const w = $('#dmTtsWarn');
    w.textContent = text || '';
    w.classList.toggle('hidden', !text);
    $('#dmStartBtn').classList.toggle('disabled', dm.ttsOk === false);
  }
  // русский голос ищем с запасом на асинхронную загрузку списка голосов
  function dmCheckTts() {
    clearInterval(dm.ttsIv);
    if (!('speechSynthesis' in window)) {
      dm.ttsOk = false;
      dmRenderTtsWarn('В этом браузере нет синтеза речи — диктор не сможет зачитать слова. Режим требует голоса и здесь недоступен.');
      return;
    }
    const find = () => speechSynthesis.getVoices().find(v => v.lang && v.lang.toLowerCase().startsWith('ru'));
    if (find()) { dm.ttsOk = true; dmRenderTtsWarn(''); return; }
    dm.ttsOk = null;
    dmRenderTtsWarn('Ищу русский голос…');
    let waited = 0;
    dm.ttsIv = setInterval(() => {
      if (find()) {
        clearInterval(dm.ttsIv);
        dm.ttsOk = true;
        if (activeScreenId() === 'screen-dm-setup') dmRenderTtsWarn('');
      } else if ((waited += 200) >= 2500) {
        clearInterval(dm.ttsIv);
        dm.ttsOk = false;
        if (activeScreenId() === 'screen-dm-setup') {
          dmRenderTtsWarn('Русский голос не найден — диктор не сможет зачитать слова. Режим требует голоса и здесь недоступен.');
        }
      }
    }, 200);
  }
  function dmRenderSetup() {
    $('#dmPerChips').innerHTML = DM_PER_PRESETS.map(p =>
      `<button data-per="${p.n}" class="${dm.settings.per === p.n ? 'on' : ''}">${p.label}</button>`).join('');
    $('#dmPerValue').textContent = dm.settings.per;
    $('#dmPaceChips').innerHTML = DM_PACE_PRESETS.map(p =>
      `<button data-rate="${p.r}" class="${Math.abs(dm.settings.rate - p.r) < .01 ? 'on' : ''}">${p.label}</button>`).join('');
    $('#dmRateRange').value = dm.settings.rate;
    $('#dmRateTag').textContent = dmRateLabel();
    $('#dmPauseRange').value = dm.settings.pause;
    $('#dmPauseTag').textContent = dmPauseLabel();
    $('#dmDrawChips').innerHTML = DM_DRAW_PRESETS.map(s =>
      `<button data-draw="${s}" class="${dm.settings.drawSecs === s ? 'on' : ''}">${s ? s + ' с' : 'Без таймера'}</button>`).join('');
    dmTotalLine();
    dmCheckTts();
  }
  $('#dmSetupBack').addEventListener('click', () => showScreen('screen-games'));
  $('#dmPerChips').addEventListener('click', e => {
    const b = e.target.closest('[data-per]'); if (!b) return;
    dm.settings.per = +b.dataset.per; dmSaveSettings(); dmRenderSetup();
  });
  $('#dmPerMinus').addEventListener('click', () => { dm.settings.per = Math.max(1, dm.settings.per - 1); dmSaveSettings(); dmRenderSetup(); });
  $('#dmPerPlus').addEventListener('click', () => { dm.settings.per = Math.min(10, dm.settings.per + 1); dmSaveSettings(); dmRenderSetup(); });
  $('#dmPaceChips').addEventListener('click', e => {
    const b = e.target.closest('[data-rate]'); if (!b) return;
    dm.settings.rate = +b.dataset.rate; dmSaveSettings(); dmRenderSetup();
  });
  $('#dmRateRange').addEventListener('input', () => {
    dm.settings.rate = dmNum($('#dmRateRange').value, 1, .5, 1.5);
    dmSaveSettings(); dmRenderSetup();
  });
  $('#dmPauseRange').addEventListener('input', () => {
    dm.settings.pause = dmNum($('#dmPauseRange').value, 1, 0, 3);
    dmSaveSettings(); dmRenderSetup();
  });
  $('#dmDrawChips').addEventListener('click', e => {
    const b = e.target.closest('[data-draw]'); if (!b) return;
    dm.settings.drawSecs = +b.dataset.draw; dmSaveSettings(); dmRenderSetup();
  });
  $('#dmStartBtn').addEventListener('click', () => {
    if (dm.ttsOk === false) { toast('Голос недоступен — режим не начнётся без диктора'); return; }
    if (state.players.length < 2) { toast('Нужно минимум 2 игрока'); return; }
    dmStartRound();
  });

  /* ── старт раунда: слова и пары генерируются один раз и сохраняются ── */
  function dmStartRound() {
    if (state.players.length < 2) { toast('Нужно минимум 2 игрока'); return; }
    const players = state.players.slice();
    const per = dm.settings.per;
    const total = players.length * per;
    const allWords = DMD.cats.reduce((a, c) => a.concat(c.words), []);
    if (total > allWords.length) { toast('Слишком много слов для базы — уменьшите настройку'); return; }
    dmStopEngine();
    dm.round = {
      v: 1, phase: 'listen', players, per, total,
      words: DMC.pickWords(allWords, total, dm.recent),
      pairs: DMC.buildPairs(players, per),
      cards: [], scores: DMC.newScores(players), hist: [],
      usedNums: [],   // DM-NUMS: номера рисунков, уже взятые любыми проверками партии
      listenIdx: 0, drawEndsAt: 0, drawLeft: 0, created: Date.now()
    };
    dm.round.cards = dm.round.pairs.map(() => ({ state: 'pending', num: null, result: null, revealed: false }));
    // слова уже услышат — отмечаем как недавние сразу, повтор в следующем раунде не страшен
    dm.recent = DMC.mergeRecent(dm.recent, dm.round.words, 80);
    store.set('dmRecent', dm.recent);
    dmSave();
    dmOpenListen('brief');
  }

  /* ── экран слушания (brief — инструкция, hub — пауза раунда) ── */
  function dmOpenListen(mode) {
    const r = dm.round;
    $('#dmListenBtn').classList.add('hidden');
    $('#dmNewRoundBtn').classList.add('hidden');
    $('#dmEq').classList.add('off');
    $('#dmListenProgress').textContent = 'Приготовьтесь';
    $('#dmBigNum').textContent = '?';
    if (mode === 'brief') {
      $('#dmListenNote').innerHTML = 'Возьмите бумагу и нарисуйте <b>одинаковое число пронумерованных ячеек</b> — по ' +
        r.total + ' на каждого.<br><br>Каждое слово рисуйте в ячейке со своим номером. ' +
        '<b>Писать слова буквами нельзя</b> — только рисунки.';
      $('#dmListenBtn').querySelector('span').textContent = 'Начать отсчёт';
      $('#dmListenBtn').classList.remove('hidden');
    } else {
      // пауза: слова заново не проигрываем — только явное «Продолжить»
      const note = r.phase === 'listen'
        ? 'Диктор дошёл до слова ' + Math.min(r.listenIdx + 1, r.total) + ' из ' + r.total + '. Продолжите — чтение пойдёт с этого слова.'
        : r.phase === 'draw'
          ? 'Рисунки почти готовы — осталось дорисовать.'
          : 'Осталось провести проверок: ' + r.cards.filter(c => c.state !== 'done').length + '.';
      $('#dmListenNote').innerHTML = '<b>Раунд приостановлен.</b><br>' + note;
      $('#dmListenBtn').querySelector('span').textContent =
        r.phase === 'listen' ? 'Продолжить чтение' : r.phase === 'draw' ? 'К дорисовке' : 'К проверкам';
      $('#dmListenBtn').classList.remove('hidden');
      $('#dmNewRoundBtn').classList.remove('hidden');
    }
    showScreen('screen-dm-listen');
  }
  $('#dmListenBtn').addEventListener('click', () => {
    const r = dm.round; if (!r) return;
    if (r.phase === 'draw') return dmOpenDraw();
    if (r.phase === 'checks') return dmOpenChecks();
    if (r.listenIdx > 0) return dmSpeakFrom(r.listenIdx);   // продолжение — без отсчёта
    dmPrimeTts();
    dmCountdown();
  });
  $('#dmNewRoundBtn').addEventListener('click', () => {
    if (!confirm('Начать новый раунд? Текущий прогресс пропадёт.')) return;
    dmStopEngine();
    dm.round = null;
    store.set('dmRound', null);
    dmRenderSetup();
    showScreen('screen-dm-setup');
  });
  $('#dmListenBack').addEventListener('click', () => {
    if (!confirm('Выйти? Раунд сохранится — продолжить можно позже.')) return;
    dmStopEngine();
    showScreen('screen-games');
  });

  /* ── TTS-движок режима: последовательное чтение с гвардией токена (DM-1).
     Любая остановка (выход, модалка, новый раунд) поднимает токен —
     «хвосты» onend/onerror и отложенные паузы молча умирают ── */
  function dmPrimeTts() {
    if (!('speechSynthesis' in window)) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch {}   // разблокировка жестом (iOS)
  }
  function dmCountdown() {
    dmStopEngine();
    const token = ++dm.seqToken;
    dm.running = true;
    let n = 3;
    $('#dmListenBtn').classList.add('hidden');
    const tick = () => {
      if (token !== dm.seqToken) return;
      if (n <= 0) {
        clearInterval(dm.tickId); dm.tickId = null;
        $('#dmBigNum').textContent = '';
        dmSpeakFrom(dm.round ? dm.round.listenIdx : 0);
        return;
      }
      $('#dmListenProgress').textContent = 'Приготовьтесь';
      $('#dmBigNum').textContent = n;
      beep(660, .12, 'triangle', .16);
      vibrate(30);
      n--;
    };
    tick();
    dm.tickId = setInterval(tick, 1000);
  }
  function dmSpeakFrom(i) {
    const r = dm.round; if (!r) return;
    dmStopEngine();
    const token = ++dm.seqToken;
    dm.running = true;
    r.phase = 'listen';
    const say = () => {
      if (token !== dm.seqToken) return;
      if (i >= r.total) return dmFinishListen(token);
      r.listenIdx = i; dmSave();
      // на экране только номер и прогресс — сами слова не показываются и не озвучиваются дважды
      $('#dmListenProgress').textContent = 'Слово ' + (i + 1) + ' из ' + r.total;
      $('#dmBigNum').textContent = i + 1;
      $('#dmListenNote').textContent = 'Зарисуйте слово №' + (i + 1) + ' в ячейке №' + (i + 1) + ' — буквы нельзя';
      $('#dmEq').classList.remove('off');
      let advanced = false;
      const adv = () => {
        if (token !== dm.seqToken || advanced) return;
        advanced = true;
        clearTimeout(wd);
        $('#dmEq').classList.add('off');
        i += 1;
        if (i >= r.total) return dmFinishListen(token);
        setTimeout(() => { if (token === dm.seqToken) dmSpeakFrom(i); }, Math.round(dm.settings.pause * 1000));
      };
      const wd = setTimeout(adv, 12000 + 1000 / dm.settings.rate);   // страховка, если onend не придёт
      const u = new SpeechSynthesisUtterance(r.words[i]);
      u.lang = 'ru-RU';
      if (ruVoice) u.voice = ruVoice;
      u.rate = dm.settings.rate;
      u.onend = adv; u.onerror = adv;
      try { speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { adv(); }
    };
    say();
  }
  function dmFinishListen(token) {
    if (token !== dm.seqToken) return;
    const r = dm.round; if (!r) return;
    r.listenIdx = r.total;
    r.phase = 'draw';
    if (dm.settings.drawSecs > 0) r.drawEndsAt = Date.now() + dm.settings.drawSecs * 1000;
    dmSave();
    clearInterval(dm.tickId); dm.tickId = null; dm.running = false;
    beep(880, .18, 'triangle', .18);
    vibrate([60, 60, 140]);
    dmOpenDraw();
  }

  /* ── время дорисовать ── */
  function dmOpenDraw() {
    const r = dm.round; if (!r) return;
    dmStopEngine();
    r.phase = 'draw';
    if (r.drawLeft > 0) { r.drawEndsAt = Date.now() + r.drawLeft * 1000; r.drawLeft = 0; }
    dmSave();
    showScreen('screen-dm-draw');
    const tmr = $('#dmDrawTime');
    if (!r.drawEndsAt) { tmr.textContent = '∞'; return; }   // вариант «без таймера»
    const token = ++dm.seqToken;
    dm.running = true;
    const tick = () => {
      if (token !== dm.seqToken) return;
      const left = Math.max(0, Math.round((r.drawEndsAt - Date.now()) / 1000));
      tmr.textContent = fmtTime(left);
      if (left <= 0) {
        dmStopEngine();
        beep(660, .15, 'triangle', .18); beep(880, .2, 'triangle', .18, .2);
        vibrate([120, 80, 120]);
        dmOpenChecks();
      }
    };
    tick();
    dm.tickId = setInterval(tick, 250);
  }
  $('#dmToChecksBtn').addEventListener('click', () => { dmStopEngine(); dmOpenChecks(); });
  $('#dmDrawBack').addEventListener('click', () => {
    if (!confirm('Выйти? Раунд сохранится — продолжить можно позже.')) return;
    dmStopEngine();
    showScreen('screen-games');
  });

  /* ── остановка движка режима: TTS + таймеры умирают вместе (DM-1) ── */
  function dmStopEngine() {
    dm.seqToken++;
    dm.running = false;
    clearInterval(dm.tickId); dm.tickId = null;
    try { speechSynthesis.cancel(); } catch {}
  }
  // приостановка с сохранением дедлайна дорисовки: вызывается из модалок и «Назад»
  function dmSuspend(reason) {
    if (!dm.round || dm.round.phase === 'done' || !dm.running) return;
    const r = dm.round;
    if (r.phase === 'draw' && r.drawEndsAt) {
      r.drawLeft = Math.max(0, Math.ceil((r.drawEndsAt - Date.now()) / 1000));
      r.drawEndsAt = 0;
    }
    dmStopEngine();
    dmSave();
    const act = activeScreenId();
    if (act === 'screen-dm-listen' || act === 'screen-dm-draw') {
      dmOpenListen('hub');   // безопасное состояние вместо «застывшего» экрана
    }
    if (reason) toast(reason);
  }

  /* ── проверки: по одной паре за раз (DM-SEQ) ──
     Будущие пары заранее не показываются; следующая открывается только после
     зафиксированного исхода текущей. Возврат на предыдущий экран результаты
     не сбрасывает, а использованные номера не возвращает. */
  function dmCurrentIdx() {
    return dm.round ? dm.round.cards.findIndex(c => c.state !== 'done') : -1;
  }
  function dmOpenChecks() {
    const r = dm.round; if (!r) return;
    dmStopEngine();
    r.phase = 'checks'; dmSave();
    if (dmCurrentIdx() < 0) return dmOpenResults();   // все проверки закрыты
    dmRenderChecks();
    showScreen('screen-dm-checks');
  }
  function dmRenderChecks() {
    const r = dm.round;
    const cur = dmCurrentIdx();
    $('#dmChecksProgress').textContent = 'Проверка ' + (cur + 1) + ' из ' + r.total;
    $('#dmScoresLine').textContent = 'Баллы: ' + r.players.map(nm => nm + ' ' + (r.scores[nm] || 0)).join(' · ');
    const p = r.pairs[cur];
    $('#dmPairNames').innerHTML = esc(p.asker) + ' → ' + esc(p.answerer);
    $('#dmPairRoles').textContent = p.asker + ' задаёт вопрос · ' + p.answerer + ' отвечает';
    const c = r.cards[cur];
    $('#dmToCheckBtn').textContent = (c.state === 'active' && c.num) ? 'Продолжить проверку ›' : 'К проверке ›';
    // пересмотр — только у только что закрытой проверки; её номер остаётся использованным
    const last = cur > 0 && r.cards[cur - 1].state === 'done';
    $('#dmUndoLastBtn').classList.toggle('hidden', !last);
  }
  $('#dmToCheckBtn').addEventListener('click', () => dmOpenCheck(dmCurrentIdx()));
  $('#dmUndoLastBtn').addEventListener('click', () => {
    const r = dm.round;
    const cur = dmCurrentIdx();
    const i = cur - 1;
    if (i < 0 || r.cards[i].state !== 'done') return;
    const c = r.cards[i], p = r.pairs[i];
    if (!confirm('Отменить результат проверки ' + (i + 1) + '? Балл вернётся на место.')) return;
    DMC.applyResult(r, i, null);
    r.hist.push({
      q: i + 1, asker: p.asker, answerer: p.answerer, num: c.num,
      word: r.words[c.num - 1], result: null, corr: true
    });
    c.state = 'active';
    c.result = null;
    // номер остаётся в usedNums: после раскрытия слова резерв не освобождается (DM-NUMS)
    dmSave();
    toast('Результат отменён');
    dmRenderChecks();
  });
  $('#dmChecksBack').addEventListener('click', () => {
    if (!confirm('Выйти? Раунд сохранится — продолжить можно позже.')) return;
    showScreen('screen-games');
  });

  /* ── одна проверка (только текущая пара — пропустить нельзя, DM-SEQ) ── */
  function dmOpenCheck(i) {
    const r = dm.round; if (!r || !r.cards[i]) return;
    if (i !== dmCurrentIdx()) return;   // чужая/завершённая проверка не открывается
    dm.checkIdx = i;
    if (r.cards[i].state === 'pending') {
      r.cards[i].state = 'active';
      dmSave();
    }
    dmRenderCheck();
    showScreen('screen-dm-check');
  }
  function dmRenderCheck() {
    const r = dm.round, i = dm.checkIdx;
    const c = r.cards[i], p = r.pairs[i];
    $('#dmCheckHead').textContent = 'Проверка ' + (i + 1) + ': ' + p.asker + ' → ' + p.answerer;
    // падеж и род — по полу отвечающего, как в остальных режимах
    const gA = state.genders[p.answerer] || guessGender(p.answerer);
    const drew = 'нарисовал' + (gA === 'f' ? 'а' : '') + (gA === '' ? '(а)' : '');
    const question = esc(p.asker) + ' спрашивает ' + esc(decline(p.answerer, 'acc', gA)) +
      ': «Что ты ' + drew + ' под номером ' + c.num + '?»';
    $('#dmCheckHint').classList.toggle('hidden', !!c.num);
    $('#dmCheckHint').innerHTML = '<b>' + esc(p.asker) + '</b>, выбери номер рисунка';
    // кнопки номеров: только цифры (DM-2); использованные в партии — disabled (DM-NUMS)
    $('#dmNums').innerHTML = Array.from({ length: r.total }, (_, k) => {
      const nmb = k + 1;
      const chosen = c.num === nmb;
      const used = r.usedNums.includes(nmb) || !!c.num;
      const aria = 'Рисунок номер ' + nmb + (chosen ? ', выбран' : used ? ', уже использован' : '');
      return `<button type="button" class="dm-num${chosen ? ' sel' : ''}${used && !chosen ? ' used' : ''}" data-num="${nmb}"${used ? ' disabled' : ''} aria-label="${aria}">${nmb}</button>`;
    }).join('');
    const revealed = c.revealed;
    $('#dmCheckQuestion').classList.toggle('hidden', !c.num);
    if (c.num) $('#dmCheckQuestion').innerHTML = question;
    $('#dmRevealBox').classList.toggle('hidden', !revealed);
    if (revealed) {
      $('#dmRevealNum').textContent = c.num;
      $('#dmRevealWord').textContent = r.words[c.num - 1];   // раскрытие — только здесь (DM-2)
    }
    $('#dmRevealBtn').classList.toggle('hidden', !c.num || revealed);
    $('#dmVerdictRow').classList.toggle('hidden', !revealed);
  }
  $('#dmNums').addEventListener('click', e => {
    const b = e.target.closest('[data-num]'); if (!b || b.disabled) return;
    const r = dm.round, i = dm.checkIdx, c = r.cards[i];
    // двойная защита: настоящая disabled-кнопка + проверка резерва в обработчике (DM-NUMS)
    if (!DMC.reserveNum(r, i, +b.dataset.num)) return;
    dmSave();
    dmRenderCheck();
  });
  $('#dmCheckBack').addEventListener('click', () => dmOpenChecks());
  $('#dmRevealBtn').addEventListener('click', () => {
    const r = dm.round, c = r.cards[dm.checkIdx];
    if (!c.num || c.revealed) return;
    c.revealed = true;   // раскрытие — только явной кнопкой, случайно нельзя (DM-2)
    dmSave();
    dmRenderCheck();
    beep(392, .1, 'triangle', .14);
  });
  const dmVerdict = result => {
    const r = dm.round, i = dm.checkIdx;
    const c = r.cards[i], p = r.pairs[i];
    if (!c.revealed || c.state === 'done') return;   // исход фиксируется ровно один раз
    DMC.applyResult(r, i, result);
    r.hist.push({
      q: i + 1, asker: p.asker, answerer: p.answerer, num: c.num,
      word: r.words[c.num - 1], result, corr: false
    });
    c.state = 'done';
    dmSave();
    vibrate(40);
    toast(result === 'none' ? 'Никому' : 'Балл: ' + (result === 'answerer' ? p.answerer : p.asker));
    if (r.cards.every(x => x.state === 'done')) dmOpenResults();
    else dmOpenChecks();   // сразу открывается следующая пара (DM-SEQ)
  };
  $('#dmPointAnswerer').addEventListener('click', () => dmVerdict('answerer'));
  $('#dmPointAsker').addEventListener('click', () => dmVerdict('asker'));
  $('#dmPointNone').addEventListener('click', () => dmVerdict('none'));

  /* ── итоги раунда ── */
  function dmOpenResults() {
    const r = dm.round;
    dmStopEngine();
    r.phase = 'done'; dmSave();
    const rows = r.players.map(nm => ({
      nm,
      score: r.scores[nm] || 0,
      asks: r.pairs.filter(p => p.asker === nm).length,
      ans: r.pairs.filter(p => p.answerer === nm).length
    })).sort((a, b) => b.score - a.score);
    const max = rows.length ? rows[0].score : 0;
    const winners = rows.filter(x => x.score === max && max > 0);
    $('#dmResultsTable').innerHTML = rows.map(x =>
      `<div class="ph-result-row"><b>${esc(x.nm)}</b><span class="dm-sub">вопросов: ${x.asks} · ответов: ${x.ans}</span><span class="ph-score">${x.score}</span></div>`).join('');
    // дательный после «по»: 1 баллу / 2 балла / 5 баллов
    const byDative = n => n === 1 ? 'баллу' : DMC.plural(n, ['балла', 'балла', 'баллов']);
    $('#dmWinnerLine').innerHTML = winners.length
      ? (winners.length === 1
        ? 'Победитель: <b>' + esc(winners[0].nm) + '</b> — ' + max + ' ' + DMC.plural(max, ['балл', 'балла', 'баллов'])
        : 'Ничья: <b>' + winners.slice(0, -1).map(w => esc(w.nm)).join(', ') + ' и ' + esc(winners[winners.length - 1].nm) + '</b> — по ' + max + ' ' + byDative(max))
      : 'Ни одного балла — победителя нет';
    $('#dmHistory').classList.add('hidden');
    $('#dmHistToggle').textContent = 'История проверок';
    showScreen('screen-dm-results');
    vibrate([60, 60, 140]);
  }
  const DM_RESULT_LABEL = { answerer: 'баллы отвечающему', asker: 'баллы задающему', none: 'никому' };
  function dmRenderHistory() {
    $('#dmHistory').innerHTML = dm.round.hist.map(h =>
      `<div class="dm-h-row">Проверка ${h.q}: <b>${esc(h.asker)}</b> → <b>${esc(h.answerer)}</b> · №${h.num} · «${esc(h.word)}» · ${DM_RESULT_LABEL[h.result] || 'отменено'}${h.corr ? ' <span class="corr">пересмотр</span>' : ''}</div>`).join('');
  }
  $('#dmHistToggle').addEventListener('click', () => {
    const h = $('#dmHistory');
    if (h.classList.contains('hidden')) { dmRenderHistory(); h.classList.remove('hidden'); $('#dmHistToggle').textContent = 'Скрыть историю'; }
    else { h.classList.add('hidden'); $('#dmHistToggle').textContent = 'История проверок'; }
  });
  $('#dmAgainBtn').addEventListener('click', () => dmStartRound());
  $('#dmSetupBtn').addEventListener('click', () => { dmRenderSetup(); showScreen('screen-dm-setup'); });
  $('#dmGamesBtn').addEventListener('click', () => showScreen('screen-games'));

  /* ══════════ Настройки ══════════ */
  /* доступность модалок: фокус входит внутрь и не покидает их (Tab по кругу),
     при закрытии возвращается на открывшую кнопку */
  let modalOpener = null;
  // A11Y: пока модалка открыта, остальной интерфейс недоступен для скринридера и Tab
  function setAppInert(on) {
    document.querySelectorAll('.screen, .topbar').forEach(el => { if ('inert' in el) el.inert = on; });
  }
  function openModal(sel) {
    modalOpener = document.activeElement;
    dmSuspend('Раунд приостановлен');   // DM-1: меню поверх чтения слов не оставляет их играть в фоне
    $(sel).classList.remove('hidden');
    setAppInert(true);
    try { history.pushState({ fant: activeScreenId(), modal: sel.slice(1) }, ''); } catch {}
    const f = $(sel).querySelector('button:not(.hidden), input');
    if (f) f.focus();
  }
  function closeModal(sel) {
    $(sel).classList.add('hidden');
    setAppInert(false);
    if (modalOpener && modalOpener.focus) modalOpener.focus();
    modalOpener = null;
  }
  function openSettings() {
    $('#setPlayersCount').textContent = state.players.filter(Boolean).length || '—';   // SET-1: без пустых полей
    $('#setSoundState').textContent = state.sound ? 'Вкл' : 'Выкл';
    $('#setTtsState').textContent = state.tts ? 'Вкл' : 'Выкл';
    $('#punishInput').value = state.punish;
    openModal('#settingsModal');
  }
  $('#menuBtn').addEventListener('click', openSettings);
  $('#settingsCloseBtn').addEventListener('click', () => closeModal('#settingsModal'));
  $('#settingsModal').addEventListener('click', e => { if (e.target.id === 'settingsModal') closeModal('#settingsModal'); });
  $('#setPlayersBtn').addEventListener('click', () => {
    // PLAYERS-2: запоминаем экран, с которого открыли игроков, — «Дальше» вернёт туда
    const from = document.querySelector('.screen.active')?.id || null;
    closeModal('#settingsModal');
    openPlayers(from);
  });
  $('#setSoundBtn').addEventListener('click', () => {
    state.sound = !state.sound; store.set('sound', state.sound);
    $('#setSoundState').textContent = state.sound ? 'Вкл' : 'Выкл';
    syncSoundIcons();
  });
  $('#setTtsBtn').addEventListener('click', () => {
    state.tts = !state.tts; store.set('tts', state.tts);
    $('#setTtsState').textContent = state.tts ? 'Вкл' : 'Выкл';
    if (!state.tts) stopSpeak();
    else toast('Диктор озвучит следующее задание');
  });
  $('#punishInput').addEventListener('input', () => {
    const v = $('#punishInput').value.trim();
    state.punish = v || DEFAULT_PUNISH;
    store.set('punish', state.punish);
  });
  $('#punishInput').addEventListener('blur', () => {
    $('#punishInput').value = state.punish;
  });
  // BAN-1: убранное долгим нажатием можно вернуть, историю выпавших — обнулить
  $('#setUnbanBtn').addEventListener('click', () => {
    state.blacklist = [];
    state.comboBan = [];
    store.set('blacklist', state.blacklist);
    store.set('comboBan', state.comboBan);
    state.bags = {};                        // мешки пересоберутся вместе с возвращёнными
    toast('Убранные задания вернулись в игру');
  });
  $('#setChosenResetBtn').addEventListener('click', () => {
    state.chosen = {};
    store.set('chosen', state.chosen);
    toast('История выпавших сброшена');
  });
  $('#setStatsBtn').addEventListener('click', () => {
    closeModal('#settingsModal');
    renderStats('Статистика фантов');
  });
  $('#setGamesBtn').addEventListener('click', () => {
    closeModal('#settingsModal');
    showScreen('screen-games');
  });

  function syncSoundIcons() {
    $('#soundOnIcon').classList.toggle('hidden', !state.sound);
    $('#soundOffIcon').classList.toggle('hidden', state.sound);
  }
  $('#soundBtn').addEventListener('click', () => {
    state.sound = !state.sound; store.set('sound', state.sound); syncSoundIcons();
  });

  /* ── Статистика ── */
  // UX-1: названия статистики унифицированы: «Статистика фантов» / «Средние оценки»
  function renderStats(title, kind = 'fants') {
    $('#statsTitle').textContent = title;
    $('#statsModal').dataset.kind = kind;
    if (kind === 'phrase') {
      const rows = state.players
        .map(nm => ({ nm, ...(phStats[nm] || { sum: 0, count: 0 }) }))
        .map(r => ({ ...r, avg: r.count ? r.sum / r.count : 0 }))
        .sort((a, b) => b.avg - a.avg || b.count - a.count);
      const best = rows.find(r => r.count);
      $('#statsTable').innerHTML = rows.map(r =>
        `<div class="stats-row"><b>${esc(r.nm)}</b><span>${r.count ? 'средняя: ' + (Math.round(r.avg * 10) / 10) + ' из 5 · оценок: ' + r.count : 'пока без оценок'}</span></div>`
      ).join('') + (best ? `<p class="stats-kings">Самый уверенный: ${esc(best.nm)}</p>` : '');
    } else {
      const rows = state.players.map(nm => ({ nm, ...(state.stats[nm] || newStats()) }));
      const top = rows.slice().sort((a, b) => b.done - a.done)[0];
      $('#statsTable').innerHTML = rows.map(r =>
        `<div class="stats-row"><b>${esc(r.nm)}</b><span>правда: ${r.truth} · действие: ${r.action} · сделано: ${r.done}</span><span>${esc(state.punish)}: ${r.fails}</span></div>`
      ).join('') + (top && top.done ? `<p class="stats-kings">Король мангала: ${esc(top.nm)} — ${top.done}</p>` : '');
    }
    openModal('#statsModal');
  }
  $('#statsCloseBtn').addEventListener('click', () => closeModal('#statsModal'));
  $('#statsModal').addEventListener('click', e => { if (e.target.id === 'statsModal') closeModal('#statsModal'); });
  $('#statsResetBtn').addEventListener('click', () => {
    const kind = $('#statsModal').dataset.kind || 'fants';
    if (kind === 'phrase') {
      phStats = {}; store.set('phStats', phStats);
    } else {
      state.stats = {}; store.set('stats', state.stats);
    }
    renderStats(kind === 'phrase' ? 'Средние оценки' : 'Статистика', kind);
    toast(kind === 'phrase' ? 'Оценки сброшены' : 'Статистика сброшена');
  });

  /* ── Долгое нажатие на карточке: убрать задание из игры ── */
  let banOpen = false, lpTimer = null, lpPos = null;
  function showBanPopup(type, x, y) {
    banOpen = true;
    const p = $('#banPopup');
    p.dataset.type = type;
    const w = 280, h = 150;
    p.style.left = Math.max(10, Math.min(x - w / 2, window.innerWidth - w - 10)) + 'px';
    p.style.top = Math.max(60, Math.min(y - 30, window.innerHeight - h - 10)) + 'px';
    p.classList.remove('hidden');
    setAppInert(true);
    try { history.pushState({ fant: activeScreenId(), modal: 'banPopup' }, ''); } catch {}
  }
  function hideBanPopup() {
    banOpen = false;
    $('#banPopup').classList.add('hidden');
    setAppInert(false);
  }
  ['choiceTruth', 'choiceAction'].forEach(id => {
    const card = $('#' + id);
    const type = id === 'choiceTruth' ? 'truth' : 'action';
    card.addEventListener('contextmenu', e => e.preventDefault());   // BAN-1: системное меню iOS/Android
    card.addEventListener('pointerdown', e => {
      if (!e.isPrimary) return;
      lpPos = { x: e.clientX, y: e.clientY };
      lpTimer = setTimeout(() => {
        lpTimer = null;
        vibrate(40);
        showBanPopup(type, lpPos.x, lpPos.y);
      }, 550);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
      card.addEventListener(ev, () => clearTimeout(lpTimer)));
  });
  $('#banYes').addEventListener('click', () => {
    const type = $('#banPopup').dataset.type;
    if (pending && pending[type]) {
      const tpl = pending[type + 'Tpl'];
      if (tpl) {
        // обычное задание: бан по сырому шаблону — только тогда оно реально исчезнет из мешка
        if (!state.blacklist.includes(tpl)) state.blacklist.push(tpl);
        store.set('blacklist', state.blacklist);
        state.bags = {};                                   // пересобрать мешки без убранного
      } else if (type === 'action' && pending.actionSkel) {
        // комбинаторное: бан по скелету «глагол|объект» — исчезают все 4 его формата
        if (!state.comboBan.includes(pending.actionSkel)) {
          state.comboBan.push(pending.actionSkel);
          store.set('comboBan', state.comboBan);
        }
      }
      const nd = drawTask(state.level, type, pending.name);
      pending[type] = nd.text;
      pending[type + 'Tpl'] = nd.tpl;
      if (type === 'action') {
        pending.actionSkel = nd.skel || null;
        pending.actionMod = pickActionMod(nd.text);
      }
      const otherKey = type === 'truth' ? 'otherTruth' : 'otherAction';
      pending[otherKey] = pickOther(pending.name);
      renderChoicePreview(type);   // PREVIEW-1: новое задание после бана — через тот же помощник
      toast('Задание убрано из игры');
    }
    hideBanPopup();
  });
  $('#banNo').addEventListener('click', hideBanPopup);
  // BAN-1: тап мимо попапа закрывает его; карточки исключены — там живёт долгое нажатие
  document.addEventListener('pointerdown', e => {
    if (banOpen && !e.target.closest('#banPopup') && !e.target.closest('.choice-card')) hideBanPopup();
  }, true);

  /* ══════════ Режим «Шпион» ══════════
     Секретные роли на одном телефоне, рисование на бумаге (по одному непрерывному
     штриху), тайное голосование и попытка шпиона назвать слово.
     Чистая логика — js/spy-core.js (window.SPY_CORE), база слов — js/spy-data.js.
     Партия живёт в памяти: системный «Назад»/меню выбрасывает незавершённую партию,
     восстановление не делаем (согласовано как вариант ТЗ «прогресс будет потерян»). */
  const SPYC = window.SPY_CORE;
  const SPYD = window.SPY_DATA;
  const spy = {
    game: null,             // объект партии из SPY_CORE.createGame
    mode: store.get('spyMode', 'normal') === 'hardcore' ? 'hardcore' : 'normal',
    revealIdx: 0,           // индекс раздачи карточек по game.players
    ballotOpen: false,      // экран бюллетеня открыт (иначе — заставка передачи)
    chosenVote: undefined,  // выбор в бюллетене: имя | null («Пропустить») | undefined — не выбран
    guessWho: undefined,    // выбранный игрок на экране попытки
    chipList: [],           // имена текущих чипов — клики идут по индексам, не по именам
    returnScreen: '',       // экран, из которого открыли попытку шпиона
    endHint: '',            // кто завершил партию (выводится из порядка вызовов core)
    lastEliminated: null    // кого исключило последнее голосование (мирный)
  };
  const SPY_PHASE_SCREENS = {
    reveal: 'screen-spy-reveal', draw: 'screen-spy-draw', discussion: 'screen-spy-discussion',
    vote: 'screen-spy-vote', 'vote-result': 'screen-spy-vote-result', finished: 'screen-spy-final'
  };
  const SPY_MODES = [
    { id: 'normal', name: 'Обычный', desc: 'Все знают категорию. Мирные знают слово, шпион — только категорию.' },
    { id: 'hardcore', name: 'Хардкор', desc: 'Категории нет ни у кого. Мирные знают слово, шпион не знает ни слова, ни категории.' }
  ];

  function spyAbandonIfUnfinished() {
    if (spy.game && spy.game.phase !== 'finished') spy.game = null;
  }
  function spyShow(id) { if (activeScreenId() !== id) showScreen(id); }

  /* ── вход в режим (кнопка «Играть» на карточке в карусели) ── */
  function spyEnter() {
    if (!SPYC || !SPYD || typeof SPYC.createGame !== 'function') {
      toast('Режим «Шпион» ещё не собран — обновите страницу позже');
      return;
    }
    if (state.players.filter(Boolean).length < 4) {
      toast('Для «Шпиона» нужно минимум 4 игрока');
      openPlayers('screen-spy-setup');
      return;
    }
    spyRenderSetup();
    showScreen('screen-spy-setup');
  }

  /* ── настройки ── */
  function spyRenderSetup() {
    $('#spyModeCards').innerHTML = SPY_MODES.map(m =>
      `<button type="button" class="spy-mode-card${spy.mode === m.id ? ' on' : ''}" data-mode="${m.id}"><b>${m.name}</b><span>${m.desc}</span></button>`).join('');
    const n = state.players.filter(Boolean).length;
    $('#spyPlayersLine').textContent = n < 4
      ? 'Сейчас игроков: ' + n + ' — для шпиона нужно минимум 4'
      : 'Игроков в списке: ' + n + ' — состав подходит';
  }
  $('#spyModeCards').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === spy.mode) return;
    spy.mode = b.dataset.mode;
    store.set('spyMode', spy.mode);
    spyRenderSetup();
  });
  $('#spyPlayersBtn').addEventListener('click', () => openPlayers('screen-spy-setup'));
  $('#spyStartBtn').addEventListener('click', () => {
    const players = state.players.map(s => (s || '').trim()).filter(Boolean);
    if (players.length < 4) { toast('Нужно минимум 4 игрока'); openPlayers('screen-spy-setup'); return; }
    if (new Set(players.map(s => s.toLowerCase())).size !== players.length) { toast('Имена не должны повторяться'); return; }
    try {
      spy.game = SPYC.createGame(players, spy.mode, SPYD);
    } catch (e) {
      toast('Не удалось начать: ' + (e && e.message ? e.message : 'проверьте базу слов'));
      return;
    }
    spy.revealIdx = 0;
    spy.ballotOpen = false;
    spy.chosenVote = undefined;
    spy.endHint = '';
    spy.lastEliminated = null;
    spyRenderPhase();
  });
  $('#spySetupBack').addEventListener('click', () => showScreen('screen-games'));

  /* ── единый маршрутизатор по фазе партии ── */
  function spyRenderPhase() {
    const g = spy.game;
    if (!g) { spyShow('screen-games'); return; }
    // все голоса собраны — сначала разрешаем голосование, потом показываем итог
    if (g.phase === 'vote' && SPYC.votesCast(g) >= g.alive.length) { spyResolveVote(); return; }
    if (g.phase === 'reveal') spyRenderReveal();
    else if (g.phase === 'draw') spyRenderDraw();
    else if (g.phase === 'discussion') spyRenderDiscussion();
    else if (g.phase === 'vote') spyRenderVote();
    else if (g.phase === 'vote-result') spyRenderVoteResult();
    else if (g.phase === 'finished') spyRenderFinal();
    spyShow(SPY_PHASE_SCREENS[g.phase] || 'screen-games');
  }

  /* ── раздача ролей ── */
  function spyRenderReveal() {
    const g = spy.game;
    const done = spy.revealIdx >= g.players.length;
    $('#spyRevealProgress').textContent = done
      ? 'Все карточки розданы'
      : 'Карточка ' + (spy.revealIdx + 1) + ' из ' + g.players.length;
    $('#spyPassBox').classList.toggle('hidden', done);
    $('#spyDoneBox').classList.toggle('hidden', !done);
    $('#spyCard').classList.add('hidden');
    spyClearCard();   // слово/роль предыдущего игрока не остаются в DOM
    if (!done) $('#spyPassTitle').textContent = 'Передайте телефон ' + g.players[spy.revealIdx];
  }
  // секреты карточки стираются явно: ни текста, ни подсветки роли в видимом DOM
  function spyClearCard() {
    ['#spyCardName', '#spyCardRole', '#spyCardWord', '#spyCardCat', '#spyCardNote']
      .forEach(s => { $(s).textContent = ''; });
    $('#spyCard').classList.remove('is-spy');
  }
  $('#spyShowCardBtn').addEventListener('click', () => {
    const g = spy.game;
    if (!g || g.phase !== 'reveal' || spy.revealIdx >= g.players.length) return;
    const name = g.players[spy.revealIdx];
    const isSpy = name === g.spy;
    $('#spyPassBox').classList.add('hidden');
    $('#spyCardName').textContent = name;
    $('#spyCardRole').textContent = isSpy ? 'Вы шпион' : 'Мирный';
    $('#spyCard').classList.toggle('is-spy', isSpy);
    if (!isSpy) {
      $('#spyCardWord').textContent = g.word;
      $('#spyCardCat').textContent = g.category ? g.category.name : '';
      $('#spyCardCat').classList.toggle('hidden', !g.category);   // хардкор: категории нет
      $('#spyCardNote').textContent = g.mode === 'normal'
        ? 'Это слово знают все мирные. Шпион видит только категорию.'
        : 'Категории нет — угадать можно только по рисунку.';
    } else {
      $('#spyCardWord').textContent = '';
      $('#spyCardCat').textContent = g.category ? g.category.name : '';
      $('#spyCardCat').classList.toggle('hidden', !g.category);
      $('#spyCardNote').textContent = g.mode === 'normal'
        ? 'Слово тебе не показывается. Категория — твоя единственная подсказка.'
        : 'Ни слова, ни категории. Смотри на рисунок и веди себя как мирный.';
    }
    $('#spyCard').classList.remove('hidden');
  });
  $('#spyHideCardBtn').addEventListener('click', () => {
    const g = spy.game;
    if (!g || g.phase !== 'reveal') return;
    spy.revealIdx++;
    spyRenderReveal();
  });
  $('#spyBeginDrawBtn').addEventListener('click', () => {
    const g = spy.game;
    if (!g || g.phase !== 'reveal') return;
    try { SPYC.startGame(g); } catch { return; }
    spyRenderPhase();
  });

  /* ── публичные фазы: рисование и обсуждение ── */
  function spySyncCatLine(sel) {
    const g = spy.game, el = $(sel);
    // хардкор: категории не существует — она не показывается нигде (правило 04)
    if (g.mode === 'normal' && g.category) {
      el.textContent = 'Категория: ' + g.category.name;
      el.classList.remove('hidden');
    } else {
      el.textContent = '';
      el.classList.add('hidden');
    }
  }
  function spyRenderDraw() {
    const g = spy.game;
    $('#spyDrawProgress').textContent = 'Круг ' + g.round;
    $('#spyDrawerName').textContent = 'Сейчас рисует: ' + (SPYC.getCurrentDrawer(g) || '—');
    spySyncCatLine('#spyCatLine');
  }
  function spyRenderDiscussion() {
    const g = spy.game;
    $('#spyDiscussProgress').textContent = 'Круг ' + g.round + ' — обсуждение';
    spySyncCatLine('#spyCatLine2');
  }
  $('#spyLineDoneBtn').addEventListener('click', () => {
    const g = spy.game;
    if (!g || g.phase !== 'draw') return;
    const drawer = SPYC.getCurrentDrawer(g);
    if (!drawer) return;
    try { SPYC.completeDrawTurn(g, drawer); } catch { return; }   // чужой/повторный ход ядро отклоняет
    spyRenderPhase();
  });
  $('#spyToVoteBtn').addEventListener('click', () => {
    const g = spy.game;
    if (!g || g.phase !== 'discussion') return;
    try { SPYC.openVote(g); } catch { return; }
    spy.ballotOpen = false;
    spyRenderPhase();
  });

  /* ── тайное голосование ── */
  function spyRenderVote() {
    const g = spy.game;
    // все голоса собраны — сразу к разрешению голосования (SPY-UI: без «телефон undefined»)
    if (SPYC.votesCast(g) >= g.alive.length) { spyResolveVote(); return; }
    $('#spyVoteProgress').textContent = 'Голосование · круг ' + g.round;
    const voter = g.alive[SPYC.votesCast(g)];
    if (!spy.ballotOpen) {
      $('#spyVotePassTitle').textContent = 'Передайте телефон ' + voter;
      $('#spyVotePass').classList.remove('hidden');
      $('#spyBallot').classList.add('hidden');
      return;
    }
    $('#spyVotePass').classList.add('hidden');
    $('#spyBallot').classList.remove('hidden');
    $('#spyBallotFor').textContent = voter + ', выбери одного. Голос тайный.';
    spyRenderChips('#spyVoteChips', g.alive.filter(p => p !== voter), spy.chosenVote, 'vote');
    $('#spyVoteConfirmBtn').disabled = spy.chosenVote === undefined;
  }
  // чипы: клики по индексам из spy.chipList — имена в разметке только видимый текст
  function spyRenderChips(containerSel, list, selected, kind) {
    spy.chipList = list.slice();
    let html = list.map((p, i) =>
      `<button type="button" class="spy-chip${selected === p ? ' sel' : ''}" data-i="${i}">${esc(p)}</button>`).join('');
    if (kind === 'vote') {
      html += `<button type="button" class="spy-chip spy-skip${selected === null ? ' sel' : ''}" data-i="skip">Пропустить</button>`;
    }
    $(containerSel).innerHTML = html;
  }
  $('#spyVoteShowBtn').addEventListener('click', () => {
    const g = spy.game;
    if (!g || g.phase !== 'vote') return;
    spy.ballotOpen = true;
    spy.chosenVote = undefined;
    spyRenderVote();
  });
  $('#spyVoteChips').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    spy.chosenVote = b.dataset.i === 'skip' ? null : spy.chipList[Number(b.dataset.i)];
    spyRenderVote();
  });
  $('#spyVoteConfirmBtn').addEventListener('click', () => {
    const g = spy.game;
    if (!g || g.phase !== 'vote') return;
    if (spy.chosenVote === undefined) return toast('Выбери игрока или «Пропустить»');
    const voter = g.alive[SPYC.votesCast(g)];
    try { SPYC.castVote(g, voter, spy.chosenVote); } catch { return toast('Голос не принят'); }
    spy.ballotOpen = false;
    spy.chosenVote = undefined;
    spyRenderPhase();   // следующий голосующий — или все проголосовали, и тогда итог
  });

  /* ── разрешение голосования и следующий круг ── */
  function spyResolveVote() {
    const g = spy.game;
    if (!g || g.phase !== 'vote') return;
    const beforeAlive = g.alive.slice();
    try { SPYC.resolveVote(g); } catch { return; }
    spy.ballotOpen = false;
    // SPY-INT (05): источник истины — g.result.outcome. Пойманный шпион даёт
    // result 'spy-caught' ещё в фазе vote-result: ядро намеренно ждёт continueAfterVote
    spy.lastEliminated = beforeAlive.find(p => !g.alive.includes(p)) || null;
    spyRenderPhase();
  }
  function spyRenderVoteResult() {
    const g = spy.game;
    // SPY-INT (05): 'spy-caught' приходит в result.outcome уже на экране итога голосования
    const caught = !!(g.result && g.result.outcome === 'spy-caught');
    $('#spyVRProgress').textContent = 'Итог голосования · круг ' + g.round;
    if (caught) {
      $('#spyVRTitle').textContent = 'Шпион пойман!';
      $('#spyVRNote').textContent = 'Голосование указало на шпиона — ' + g.spy + '.';
    } else if (spy.lastEliminated) {
      // роль выбывшего раскрывается публично; очки в разгар партии не показываем
      $('#spyVRTitle').textContent = spy.lastEliminated + ' выбывает';
      $('#spyVRNote').textContent = 'Это не шпион — партия продолжается.';
    } else {
      $('#spyVRTitle').textContent = 'Никто не выбывает';
      $('#spyVRNote').textContent = '«Пропустить» набрал больше всех или голоса разделились.';
    }
    // SPY-INT (05): после поимки шпиона попытка невозможна (шпион выбыл, makeGuess
    // не примет), а кнопка ведёт в итоги, а не «следующий круг»
    $('#spyGuessBtn4').classList.toggle('hidden', caught);
    $('#spyNextRoundBtn').querySelector('span').textContent = caught ? 'Показать итоги' : 'Следующий круг';
  }
  $('#spyNextRoundBtn').addEventListener('click', () => {
    const g = spy.game;
    if (!g || g.phase !== 'vote-result') return;
    try { SPYC.continueAfterVote(g); } catch { return; }
    spyRenderPhase();   // SPY-INT (05): finished → финал читает result.outcome, endHint не нужен
  });

  /* ── попытка шпиона назвать слово (доступна на любых активных фазах) ── */
  function spyOpenGuess(fromScreen) {
    const g = spy.game;
    if (!g || g.phase === 'finished' || g.phase === 'reveal') return;
    spy.returnScreen = fromScreen || activeScreenId();
    spy.guessWho = undefined;
    $('#spyGuessInput').value = '';
    $('#spyGuessForm').classList.remove('hidden');
    $('#spyGuessReject').classList.add('hidden');
    spyRenderChips('#spyGuessChips', g.alive.slice(), undefined, 'guess');
    spyShow('screen-spy-guess');
  }
  $('#spyGuessChips').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    spy.guessWho = spy.chipList[Number(b.dataset.i)];
    $('#spyGuessChips').querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
  });
  $('#spyGuessBtn1').addEventListener('click', () => spyOpenGuess('screen-spy-draw'));
  $('#spyGuessBtn2').addEventListener('click', () => spyOpenGuess('screen-spy-discussion'));
  $('#spyGuessBtn3').addEventListener('click', () => spyOpenGuess('screen-spy-vote'));
  $('#spyGuessBtn4').addEventListener('click', () => spyOpenGuess('screen-spy-vote-result'));
  $('#spyGuessBack').addEventListener('click', () => spyRenderPhase());
  $('#spyGuessReturnBtn').addEventListener('click', () => spyRenderPhase());
  $('#spyGuessCheckBtn').addEventListener('click', () => {
    const g = spy.game;
    if (!g || g.phase === 'finished' || g.phase === 'reveal') return;
    if (spy.guessWho === undefined) return toast('Выберите, кто назвал слово');
    const text = $('#spyGuessInput').value.trim();
    if (!text) return toast('Введите слово');
    const before = Object.assign({}, g.scores);
    let rejected = false;
    try { SPYC.makeGuess(g, spy.guessWho, text); } catch { rejected = true; }
    // отказ нейтральный: кто шпион, не раскрываем, партия не меняется
    if (rejected || g.phase !== 'finished') {
      $('#spyGuessForm').classList.add('hidden');
      $('#spyGuessReject').classList.remove('hidden');
      return;
    }
    // оба исхода завершают партию: +2 шпиону — угадал, иначе — раскрыт
    spy.endHint = g.scores[g.spy] === (before[g.spy] || 0) + 2 ? 'spy-guessed' : 'spy-wrong-guess';
    spyRenderPhase();
  });

  /* ── финал ── */
  const SPY_END_TITLES = {
    'spy-caught': 'Шпион пойман!',
    'spy-guessed': 'Шпион угадал слово!',
    'spy-wrong-guess': 'Шпион раскрыт',
    'spy-auto-win': 'Шпион победил'
  };
  const SPY_END_NOTES = {
    'spy-caught': 'Голосование указало на шпиона. Каждый мирный — включая выбывших раньше — получает по очку.',
    'spy-guessed': 'Шпион верно назвал загаданное слово и получает два очка.',
    'spy-wrong-guess': 'Попытка оказалась неверной: шпион раскрыт, все остальные получают по очку.',
    'spy-auto-win': 'Осталось двое: шпион и один мирный. Шпион побеждает автоматически.'
  };
  function spyRenderFinal() {
    const g = spy.game;
    if (!g) return;
    const r = g.result || {};
    // SPY-INT (05): единственный источник истины — result.outcome из ядра;
    // endHint остаётся только последнимfallback'ом на случай битого result
    const reason = SPY_END_TITLES[r.outcome] ? r.outcome : (spy.endHint || 'spy-caught');
    $('#spyFinalTitle').textContent = SPY_END_TITLES[reason] || 'Партия завершена';
    $('#spyFinalWhy').textContent = SPY_END_NOTES[reason] || '';
    $('#spyFinalSpy').textContent = g.spy;
    $('#spyFinalWord').textContent = g.word;
    const showCat = g.mode === 'normal' && !!g.category;
    $('#spyFinalCatLine').classList.toggle('hidden', !showCat);
    if (showCat) $('#spyFinalCat').textContent = g.category.name;
    $('#spyFinalScores').innerHTML = g.players.map(p =>
      `<div class="ph-result-row"><b>${esc(p)}</b><span class="ph-score">${g.scores[p] || 0}</span></div>`).join('');
  }
  $('#spyAgainBtn').addEventListener('click', () => {
    const g = spy.game;
    const players = g ? g.players.slice() : state.players.filter(Boolean);
    const mode = g ? g.mode : spy.mode;
    try {
      spy.game = SPYC.createGame(players, mode, SPYD);   // новое слово/шпион, счёт с нуля
    } catch { return toast('Не удалось начать новую партию'); }
    spy.revealIdx = 0;
    spy.ballotOpen = false;
    spy.chosenVote = undefined;
    spy.endHint = '';
    spy.lastEliminated = null;
    spyRenderPhase();
  });
  $('#spyGamesBtn').addEventListener('click', () => { spy.game = null; showScreen('screen-games'); });

  /* ── выходы из активной партии ── */
  // кнопки «Назад» в приложении: подтверждение, потом выброс партии
  const spyExitConfirm = () => {
    if (!confirm('Выйти из партии? Прогресс будет потерян.')) return;
    spy.game = null;
    showScreen('screen-games');
  };
  $('#spyRevealBack').addEventListener('click', spyExitConfirm);
  $('#spyDrawBack').addEventListener('click', spyExitConfirm);
  $('#spyDiscussBack').addEventListener('click', spyExitConfirm);
  $('#spyVoteBack').addEventListener('click', spyExitConfirm);
  $('#spyVoteResultBack').addEventListener('click', spyExitConfirm);
  // системный «Назад» (popstate) и «К выбору игры» в настройках: партия выбрасывается молча
  function spyOnHistory(targetId) {
    const g = spy.game;
    if (!g) { showScreen('screen-games'); return; }                 // партии нет — шпионские экраны недоступны
    if (g.phase === 'finished') { spyRenderFinal(); spyShow('screen-spy-final'); return; }
    if (targetId === 'screen-spy-guess') {
      // диалог попытки живёт только в активной партии: перерисовываем пустую форму,
      // чтобы не показать стухший экран прошлой партии
      if (g.phase !== 'reveal') {
        spy.returnScreen = SPY_PHASE_SCREENS[g.phase] || 'screen-games';
        spy.guessWho = undefined;
        $('#spyGuessInput').value = '';
        $('#spyGuessForm').classList.remove('hidden');
        $('#spyGuessReject').classList.add('hidden');
        spyRenderChips('#spyGuessChips', g.alive.slice(), undefined, 'guess');
      }
      return;
    }
    spy.ballotOpen = false;
    navFromPop = true;
    spyRenderPhase();   // перерисовка по актуальной фазе: setup — её содержимое
    navFromPop = false;
  }
  $('#setGamesBtn').addEventListener('click', spyAbandonIfUnfinished);

  /* ── FEAT-1: экран не засыпает во время партии (Screen Wake Lock) ── */
  let wakeLock = null;
  const GAME_SCREENS = ['screen-wheel', 'screen-choice', 'screen-reveal', 'screen-phrase-round', 'screen-phrase-task', 'screen-phrase-results',
    'screen-dm-listen', 'screen-dm-draw', 'screen-dm-checks', 'screen-dm-check', 'screen-dm-results',
    'screen-spy-reveal', 'screen-spy-draw', 'screen-spy-discussion', 'screen-spy-vote', 'screen-spy-vote-result', 'screen-spy-final',
    'screen-spy-guess'];
  async function keepAwake() {
    try {
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch {}
  }
  function syncWakeLock() {
    if (GAME_SCREENS.includes(activeScreenId())) { if (!wakeLock) keepAwake(); }
    else if (wakeLock) { try { wakeLock.release(); } catch {} wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncWakeLock(); });

  /* ── Старт: главный экран ── */
  buildCarousel();
  buildGames();
  buildPacksRow();
  syncSoundIcons();
  syncCarousel(false);
  if (state.players.length < 2) state.players = state.players.concat(['', '']);
  renderPlayers();
  renderHud();
  $('#perValue').textContent = phrase.per;
  syncPunishInputs();
  if (state.blitz) startBlitzClock();
  navFromPop = true; showScreen('screen-main'); navFromPop = false;
  history.replaceState({ fant: 'screen-main' }, '');   // NAV-1: базовая запись без дубля
  // DM-RESTORE: незавершённый раунд открывается в безопасном состоянии —
  // слова сами не проигрываются, продолжение только явной кнопкой
  if (dm.round && dm.round.phase !== 'done' && state.players.length >= 2) {
    dmOpenListen('hub');
    history.replaceState({ fant: 'screen-dm-listen' }, '');
  }

  // Escape закрывает модалки/всплывашку бана, Tab ходит по кругу внутри модалки
  addEventListener('keydown', e => {
    const modal = document.querySelector('.modal:not(.hidden)');
    if (e.key === 'Escape') {
      if (modal) closeModal('#' + modal.id);
      else if (!$('#banPopup').classList.contains('hidden')) { hideBanPopup(); banOpen = false; }
      return;
    }
    if (e.key !== 'Tab' || !modal) return;
    const f = [...modal.querySelectorAll('button:not(.hidden), input')]
      .filter(el => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    // есть ли уже контролирующий SW на момент регистрации: если нет — это первый
    // визит (install), а не обновление, и тост про «новую версию» показывать нельзя
    navigator.serviceWorker.register('sw.js')
      .then(reg => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('Вышла новая версия — обновите страницу');
            }
          });
        });
        // давно открытая вкладка сама узнаёт об обновлении — раз в час
        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
      })
      .catch(() => {});
  }

  // SPIN-3: тестовый крюк для node-тестов (tests/spin-cancel.test.js):
  // в браузере window.__FANT_TEST__ не выставляется, ветка не выполняется
  if (window.__FANT_TEST__) {
    window.__FANT_TEST_API__ = { state, showScreen, spin, cancelSpin };
  }
})();
