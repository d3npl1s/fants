/* ═══════════════ Фанты — логика ═══════════════ */
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const DATA = window.FANT;
  const NAME_H = 150;                       // высота имени в ленте, px
  const SPIN_PAD = 8;                       // запас имён сверху и снизу ленты
  const PLAYER_COLORS = [
    '#21265c', '#c2185b', '#6a1fa2', '#0e7c86', '#d84315', '#2e7d32',
    '#37474f', '#ad1457', '#4527a0', '#00695c', '#8d6e63', '#b71c1c'
  ];
  const BLITZ_SECS = 180;   // блиц-круг: 3 минуты на круг
  const MODS = [            // случайные модификаторы к действиям
    'шёпотом', 'с акцентом', 'стоя на одной ноге', 'с каменным лицом',
    'как робот', 'максимально драматично', 'в замедленной съёмке', 'не моргая'
  ];

  /* ── Хранилище ── */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fant.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('fant.' + k, JSON.stringify(v)); } catch {} }
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
    punish: store.get('punish', 'пей стопку'),
    blacklist: store.get('blacklist', []),  // задания, исключённые компанией
    stats: store.get('stats', {}),          // имя → { truth, action, done, fails }
    blitz: store.get('blitz', false),
    blitzEndsAt: 0,
    blitzTimerId: null,
    streaks: {},          // имя игрока -> { type, count } — лимит «2 раза подряд»
    bags: {},             // мешки заданий без повторов
    taskTimerId: null,
    spinning: false,
    recent: [],             // последние 2 игрока колеса — чтобы не выпадали подряд
    currentTask: null,
    currentPlain: ''
  };

  const app = $('#app');
  app.dataset.level = state.level;

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  }

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
      const u = new SpeechSynthesisUtterance(text);
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

  /* ── Склонение имён: acc (кого), dat (кому), inst (с кем), gen (кого/чего) ── */
  function decline(raw, cs) {
    const name = String(raw).trim();
    if (!/[а-яёА-ЯЁ]/.test(name)) {                     // латиница/ники: denplis → denplis'а, denplis'ом
      const end = { acc: 'а', dat: 'у', inst: 'ом', gen: 'а' }[cs];
      return end ? name + "'" + end : name;
    }
    const low = name.toLowerCase();
    let forms;
    if (low.endsWith('ия')) {                            // Мария → Марию, Марии, Марией
      const s = low.slice(0, -1);
      forms = { acc: s + 'ю', dat: s + 'и', inst: s + 'ей', gen: s + 'и' };
    } else if (low.endsWith('ья')) {                     // Илья → Илью, Илье, Ильём
      const s = low.slice(0, -2) + 'ь';
      forms = { acc: s + 'ю', dat: s + 'е', inst: s + 'ём', gen: s + 'я' };
    } else if (low.endsWith('я')) {                      // Даня → Даню, Дане, Даней, Дани
      const s = low.slice(0, -1);
      forms = { acc: s + 'ю', dat: s + 'е', inst: s + 'ей', gen: s + 'и' };
    } else if (low.endsWith('а')) {                      // Ника → Нику, Нике, Никой, Ники
      const s = low.slice(0, -1);
      const hiss = /[кгхжшщч]$/.test(s);
      forms = { acc: s + 'у', dat: s + 'е', inst: s + 'ой', gen: s + (hiss ? 'и' : 'ы') };
    } else if (low.endsWith('й')) {                      // Андрей → Андрея, Андрею, Андреем
      const s = low.slice(0, -1);
      forms = { acc: s + 'я', dat: s + 'ю', inst: s + 'ем', gen: s + 'я' };
    } else if (low.endsWith('ь')) {                      // Игорь → Игоря, Игорю, Игорем
      const s = low.slice(0, -1);
      forms = { acc: s + 'я', dat: s + 'ю', inst: s + 'ем', gen: s + 'я' };
    } else {                                             // Денис → Дениса, Денису, Денисом
      forms = { acc: low + 'а', dat: low + 'у', inst: low + 'ом', gen: low + 'а' };
    }
    let res = forms[cs] || name;
    if (name[0] === name[0].toUpperCase()) res = res.charAt(0).toUpperCase() + res.slice(1);
    return res;
  }

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
  }

  /* ── Блиц-круг: 3 минуты на весь круг, не успел — наказание ── */
  const newStats = () => ({ truth: 0, action: 0, done: 0, fails: 0 });
  function startBlitzClock() {
    clearInterval(state.blitzTimerId);
    if (!state.blitz) { $('#hudBlitz').classList.add('hidden'); return; }
    state.blitzEndsAt = Date.now() + BLITZ_SECS * 1000;
    state.blitzTimerId = setInterval(tickBlitz, 500);
    tickBlitz();
  }
  function tickBlitz() {
    if (!state.blitz) return;
    const left = Math.max(0, Math.round((state.blitzEndsAt - Date.now()) / 1000));
    const hb = $('#hudBlitz');
    hb.textContent = 'блиц ' + fmtTime(left);
    if (left <= 0) blitzExpire();
  }
  function blitzExpire() {
    clearInterval(state.blitzTimerId);
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
  let setupReturn = 'screen-levels';
  function renderPlayers() {
    const list = $('#playerList');
    list.innerHTML = '';
    state.players.forEach((name, i) => {
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `<input maxlength="14" placeholder="Имя ${i + 1}" style="border-left:6px solid ${playerColor(i)}">
        <button class="gx" title="Пол — для окончаний в заданиях"></button>
        <button class="rm" title="Удалить">×</button>`;
      const inp = row.querySelector('input');
      inp.value = name;
      inp.addEventListener('input', () => { state.players[i] = inp.value.trim(); });
      inp.addEventListener('blur', () => { state.players[i] = inp.value.trim(); store.set('players', state.players); });
      // пол: — → М → Ж → — (влияет только на грамматику заданий)
      const gx = row.querySelector('.gx');
      const gxLabel = () => {
        const cur = state.genders[state.players[i]] || '';
        gx.textContent = cur === 'm' ? 'М' : cur === 'f' ? 'Ж' : '—';
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
        state.players.splice(i, 1); store.set('players', state.players); renderPlayers();
      });
      list.appendChild(row);
    });
  }
  function openPlayers(from) {
    setupReturn = from;
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
    store.set('players', state.players);
    resetRounds();
    showScreen('screen-games');
  });

  /* ══════════ Экран 2: выбор игры ══════════ */
  const GAME_ICONS = {
    fants: `<svg class="game-icon" viewBox="0 0 120 120"><rect x="30" y="16" width="60" height="60" rx="14" fill="#fff"/><path d="M44 52 40 26l14 10 6-14 6 14 14-10-4 26z" fill="none" stroke="#21265c" stroke-width="4" stroke-linejoin="round"/><path d="M44 52h32v6c0 5-4 9-9 9H53c-5 0-9-4-9-9z" fill="#21265c"/></svg>`,
    phrase: `<svg class="game-icon" viewBox="0 0 120 120"><path fill="#fff" d="M18 24c0-6 5-11 11-11h62c6 0 11 5 11 11v40c0 6-5 11-11 11H56L38 94V75H29c-6 0-11-5-11-11z"/><circle cx="43" cy="44" r="5" fill="#26b5a2"/><circle cx="60" cy="44" r="5" fill="#26b5a2"/><circle cx="77" cy="44" r="5" fill="#26b5a2"/><path fill="#fff" opacity=".85" d="M50 96l14-12 18 8c4 2 6 7 4 11s-7 6-11 4z"/></svg>`
  };
  const GAMES = [
    { id: 'fants', name: 'Фанты', tagline: 'Правда или действие: колесо, уровни и задания.' },
    { id: 'phrase', name: 'Продолжи фразу', tagline: 'Отвечай неправильно, но уверенно. Зал ставит оценку.' }
  ];
  function buildGames() {
    $('#gamesTrack').innerHTML = GAMES.map(g => `
      <div class="game-card" data-game="${g.id}">
        ${GAME_ICONS[g.id]}
        <div class="game-name">${g.name}</div>
        <p class="game-tag">${g.tagline}</p>
        <button class="play-btn" data-play="${g.id}"><span>Играть</span><i class="chev">›</i></button>
      </div>`).join('');
    $('#gamesDots').innerHTML = GAMES.map((g, i) => `<i data-i="${i}" class="${i === 0 ? 'on' : ''}"></i>`).join('');
  }
  function syncGames() {
    const i = Math.round($('#gamesCarousel').scrollLeft / Math.max(1, $('#gamesCarousel').clientWidth));
    document.querySelectorAll('#gamesDots i').forEach((d, k) => d.classList.toggle('on', k === i));
  }
  $('#gamesCarousel').addEventListener('scroll', syncGames, { passive: true });
  $('#prevGame').addEventListener('click', () => $('#gamesCarousel').scrollBy({ left: -$('#gamesCarousel').clientWidth, behavior: 'smooth' }));
  $('#nextGame').addEventListener('click', () => $('#gamesCarousel').scrollBy({ left: $('#gamesCarousel').clientWidth, behavior: 'smooth' }));
  $('#gamesTrack').addEventListener('click', e => {
    const b = e.target.closest('[data-play]');
    if (!b) return;
    if (b.dataset.play === 'fants') { showScreen('screen-levels'); syncCarousel(); }
    else { renderModeChips(); showScreen('screen-phrase-setup'); }
  });
  $('#backToGames').addEventListener('click', () => showScreen('screen-games'));
  $('#phraseBackBtn').addEventListener('click', () => showScreen('screen-games'));
  $('#phraseRoundBackBtn').addEventListener('click', () => { renderModeChips(); showScreen('screen-phrase-setup'); });

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
    $('#carDots').innerHTML = DATA.levels.map(l => `<i data-lv="${l.id}"></i>`).join('');
  }

  const levelIndex = () => Math.max(0, DATA.levels.findIndex(l => l.id === state.level));
  function syncCarousel(smooth = true) {
    const i = levelIndex();
    carousel.scrollTo({ left: i * carousel.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
    document.querySelectorAll('#carDots i').forEach(d => d.classList.toggle('on', d.dataset.lv === DATA.levels[i].id));
  }
  carousel.addEventListener('scroll', () => {                         // точки следуют за свайпом
    const i = Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth));
    document.querySelectorAll('#carDots i').forEach((d, k) => d.classList.toggle('on', k === i));
  }, { passive: true });
  $('#carDots').addEventListener('click', e => {
    const d = e.target.closest('[data-lv]'); if (!d) return;
    state.level = d.dataset.lv; store.set('level', state.level);
    app.dataset.level = state.level;
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
    if (state.players.length < 2) { toast('Сначала добавьте игроков'); openPlayers('screen-levels'); return; }
    state.level = levelId;
    store.set('level', levelId);
    app.dataset.level = levelId;
    renderHud();
    showScreen('screen-wheel');
  }

  /* ══════════ Экран 3: колесо ══════════ */
  $('#backToLevels').addEventListener('click', () => { showScreen('screen-levels'); syncCarousel(); });
  $('#statsWheelBtn').addEventListener('click', () => renderStats('Статистика'));
  $('#spinBtn').addEventListener('click', spin);

  // свайп в любом месте экрана запускает колесо — как продолжение жеста (палец или мышь)
  let swipeStart = null;
  const wheelScreen = $('#screen-wheel');
  wheelScreen.addEventListener('pointerdown', e => {
    if (!e.isPrimary) return;
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
    const bagKey = level + ':' + type;
    if (!state.bags[bagKey] || !state.bags[bagKey].length) {
      state.bags[bagKey] = [...DATA.tasks[level][type]].sort(() => Math.random() - .5);
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
      state.bags[bagKey] = skipped.filter(t => !state.blacklist.includes(t));
      const pool = state.bags[bagKey].length ? state.bags[bagKey] : DATA.tasks[level][type].filter(t => !state.blacklist.includes(t));
      text = pool[Math.floor(Math.random() * pool.length)] || DATA.tasks[level][type][0];
    } else {
      skipped.forEach(t => state.bags[bagKey].unshift(t));
    }
    return text;
  }

  function markChosen(name, type, text) {
    if (!state.chosen[name]) state.chosen[name] = { truth: [], action: [] };
    if (!state.chosen[name][type].includes(text)) state.chosen[name][type].push(text);
    store.set('chosen', state.chosen);
  }

  function spin(opts = {}) {
    if (state.spinning || state.players.length < 2) return;
    state.spinning = true;
    vibrate(30);

    // экран колеса плавно уезжает — имена подъезжают следом
    const wheelScreen = $('#screen-wheel');
    const overlay = $('#spinOverlay');
    wheelScreen.classList.add('leaving');

    const rem = state.remaining.length ? state.remaining : [...state.players];
    const n = rem.length;
    // дубовый анти-повтор: не даём последним двум игрокам выпасть снова
    let pool = rem.map((_, i) => i).filter(i => !state.recent.includes(rem[i]));
    if (!pool.length) pool = rem.map((_, i) => i);
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
      html += `<div class="spin-name" data-i="${i}"><span style="background:${playerColor(cIdx)}">${esc(pname)}</span></div>`;
    }
    track.innerHTML = html;

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('show');

    // имя i по центру: translate(-50%, (total/2 - i - 0.5) * H)
    const offset = i => (total / 2 - i - .5) * NAME_H;
    track.style.transition = 'none';
    track.style.transform = `translate(-50%, calc(-50% + ${offset(startIdx)}px))`;
    void track.offsetWidth;

    const from = offset(startIdx), to = offset(endIdx);
    const dist = to - from;
    let dur, ease;
    if (opts.swipe) {                     // свайп: лента сразу летит, как продолжение жеста
      ease = t => 1 - Math.pow(1 - t, 3);
      dur = Math.min(5500, Math.max(1500, 3 * Math.abs(dist) / (opts.v || 3)));
    } else {                              // тап: максимально короткий прогон
      ease = t => 1 - Math.pow(1 - t, 3);
      dur = 750 + Math.random() * 200;
    }
    const t0 = performance.now();
    let lastIdx = -1;

    // setInterval вместо rAF: не замирает в свёрнутых вкладках и webview
    const iv = setInterval(() => frame(performance.now()), 16);
    function frame(now) {
      const t = Math.min(1, (now - t0) / dur);
      const y = from + ease(t) * dist;
      const idx = Math.floor(total / 2 - y / NAME_H);
      if (idx !== lastIdx) { lastIdx = idx; tickSound(); }
      track.style.transform = `translate(-50%, calc(-50% + ${y}px))`;
      if (t >= 1) {
        clearInterval(iv);
        finishSpin(endIdx, rem[chosenIdx]);
      }
    }
  }

  function finishSpin(winIdx, winnerName) {
    // запоминаем двух последних, чтобы один игрок не выпадал много раз подряд
    state.recent.push(winnerName);
    state.recent = state.recent.slice(-2);
    const winner = document.querySelector(`.spin-name[data-i="${winIdx}"]`);
    if (winner) winner.classList.add('win');
    vibrate([60, 60, 140]);
    // победитель колеса — единственный источник имени для экрана выбора
    setTimeout(() => {
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

  function openChoice(name) {
    let aTask = drawTask(state.level, 'action', name);
    // случайный модификатор к действию (не для заданий со своим таймером)
    if (!/\[\[таймер/.test(aTask) && Math.random() < .3) {
      const mod = MODS[Math.floor(Math.random() * MODS.length)];
      aTask = aTask.replace(/\.?$/, '') + ' — и всё это ' + mod + '.';
    }
    pending = {
      name,
      truth: drawTask(state.level, 'truth', name),
      action: aTask
    };
    $('#choiceName').textContent = name;
    // текст и «случайный друг» фиксируются один раз: превью = то, что получишь после выбора
    const t = renderTemplate(pending.truth, name, pickOther(name));
    const a = renderTemplate(pending.action, name, pickOther(name));
    pending.truthHtml = t.html; pending.truthPlain = t.plain;
    pending.actionHtml = a.html; pending.actionPlain = a.plain;
    $('#truthPreview').innerHTML = t.html;
    $('#actionPreview').innerHTML = a.html;

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
      ? 'Правда уже выбрана раз подряд. Ещё раз — и в следующий раз её выбрать будет нельзя.' : '';
    $('#actionHint').textContent = (st && st.type === 'action' && st.count === 1)
      ? 'Действие уже выбрано раз подряд. Ещё раз — и в следующий раз его выбрать будет нельзя.' : '';

    showScreen('screen-choice');
  }

  function renderTemplate(tpl, name, other) {
    // пол игрока: «(а)»-окончания → «а» или пусто; пол не указан — остаётся «(а)»
    const g = state.genders[name];
    if (g === 'f') tpl = tpl.replace(/\((а|ась|ой|на|ся|ись)\)/g, '$1');
    else if (g === 'm') tpl = tpl.replace(/\((а|ась|ой|на|ся|ись)\)/g, '');
    // падежные токены: {other-acc} = кого, {other-dat} = кому, {other-inst} = с кем, {other-gen} = кого/чего
    const v = {
      'name': name, 'other': other,
      'name-acc': decline(name, 'acc'), 'name-dat': decline(name, 'dat'),
      'name-inst': decline(name, 'inst'), 'name-gen': decline(name, 'gen'),
      'other-acc': decline(other, 'acc'), 'other-dat': decline(other, 'dat'),
      'other-inst': decline(other, 'inst'), 'other-gen': decline(other, 'gen')
    };
    let html = tpl, plain = tpl;
    Object.keys(v).sort((a, b) => b.length - a.length).forEach(k => {
      html = html.split('{' + k + '}').join('<b>' + esc(v[k]) + '</b>');
      plain = plain.split('{' + k + '}').join(v[k]);
    });
    return { html, plain };
  }

  $('#choiceTruth').addEventListener('click', () => choose('truth'));
  $('#choiceAction').addEventListener('click', () => choose('action'));

  function choose(type) {
    if (!pending || banOpen) return;   // клик после зажатия не выбирает
    const st = state.streaks[pending.name];
    if (st && st.type === type) st.count += 1;
    else state.streaks[pending.name] = { type, count: 1 };
    markChosen(pending.name, type, pending[type]);   // выбранное больше не выпадет этому игроку
    if (!state.stats[pending.name]) state.stats[pending.name] = newStats();
    state.stats[pending.name][type === 'truth' ? 'truth' : 'action']++;
    store.set('stats', state.stats);
    reveal(type);
  }

  /* ══════════ Экран 5: задание ══════════ */
  function reveal(type) {
    state.currentTask = pending[type];
    const isTruth = type === 'truth';
    $('#revealType').textContent = isTruth ? 'правда' : 'действие';
    let html = isTruth ? pending.truthHtml : pending.actionHtml;
    let plain = isTruth ? pending.truthPlain : pending.actionPlain;

    // таймер задания: явный [[таймер N]] или длительность в тексте («на 15 секунд», «2 минуты»)
    const m = plain.match(/\[\[таймер (\d+)\]\]/);
    let secs = 0;
    if (m) {
      secs = parseInt(m[1], 10);
      html = html.replace(/\s*\[\[таймер \d+\]\]/g, '');
      plain = plain.replace(/\s*\[\[таймер \d+\]\]/g, '');
    } else {
      const a = plain.match(/(\d+)\s*(секунд\S*|сек\b|минут\S*|мин\b)/);
      if (a) secs = /мин/.test(a[2]) ? parseInt(a[1], 10) * 60 : parseInt(a[1], 10);
    }
    clearInterval(state.taskTimerId);
    const tb = $('#taskTimerBtn');
    tb.classList.remove('running', 'finished');
    if (secs > 0 && secs <= 600) {
      tb.dataset.secs = secs;
      tb.textContent = 'Запустить таймер (' + fmtTime(secs) + ')';
      tb.classList.remove('hidden');
    } else tb.classList.add('hidden');

    $('#revealText').innerHTML = html;
    state.currentPlain = plain;
    $('#punishNote').innerHTML = 'Не выполнил — <b>' + esc(state.punish) + '</b><br>и остаёшься в колесе';
    revealSound(isTruth);
    showScreen('screen-reveal');
    speak(plain);                       // диктор читает задание
  }

  // автоматический таймер уровня убран: время — только там, где задаёт само задание ([[таймер N]])

  /* ── Круги: Выполнил → вылетает до следующего круга; Не выполнил → остаётся ── */
  function completeTask(done) {
    stopSpeak();
    const name = pending.name;
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
  $('#taskTimerBtn').addEventListener('click', () => {
    const b = $('#taskTimerBtn');
    if (b.classList.contains('running')) return;
    b.classList.add('running');
    const endAt = Date.now() + parseInt(b.dataset.secs, 10) * 1000;
    clearInterval(state.taskTimerId);
    state.taskTimerId = setInterval(() => {
      const left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      b.textContent = fmtTime(left);
      if (left <= 0) {
        clearInterval(state.taskTimerId);
        b.classList.remove('running');
        b.classList.add('finished');
        b.textContent = 'Время!';
        beep(660, .15, 'triangle', .18);
        vibrate([120, 80, 120]);
      }
    }, 250);
  });

  /* ── Повтор озвучки ── */
  $('#ttsBtn').addEventListener('click', () => speak(state.currentPlain));

  /* ══════════ Игра «Продолжи фразу» ══════════ */
  const PHRASE_H = 96;                      // высота имени в столбике, px
  const phrase = {
    per: store.get('phPer', 5),
    mode: store.get('phMode', 'all'),
    bag: [], queue: [], picks: 0, qInPair: 0,
    scores: {}, current: null
  };

  function renderModeChips() {
    $('#modeChips').innerHTML = window.PHRASE.modes.map(m =>
      `<button data-mode="${m.id}" class="${m.id === phrase.mode ? 'on' : ''}">${m.name}</button>`).join('');
    $('#modeTag').textContent = (window.PHRASE.modes.find(m => m.id === phrase.mode) || {}).tagline || '';
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
    phrase.bag = []; phrase.picks = 0; phrase.qInPair = 0;
    phrase.scores = {};
    state.players.forEach(nm => phrase.scores[nm] = []);
    // пары круга: случайная перестановка без самих себя — каждый по разу читает и отвечает
    const ans = [...state.players].sort(() => Math.random() - .5);
    const rds = [...state.players].sort(() => Math.random() - .5);
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
    $('#phProgress').textContent = 'Пара 1 из ' + state.players.length;
  }

  function drawPair() {
    return phrase.queue.shift();
  }

  function spinColumns(reader, answerer) {
    const n = state.players.length, H = PHRASE_H;
    [['#colReader', reader], ['#colAnswerer', answerer]].forEach(([sel, who], k) => {
      const track = $(sel);
      const rIdx = Math.max(0, state.players.indexOf(who));
      const reps = 3;
      let html = '';
      for (let i = 0; i < n * (reps + 1); i++) {
        html += `<div class="pair-item" style="background:${playerColor(i % n)}">${esc(state.players[i % n])}</div>`;
      }
      track.innerHTML = html;
      track.style.transition = 'none';
      track.style.transform = 'translateY(0)';
      void track.offsetWidth;
      const target = reps * n + rIdx;      // окно остановится на этом имени
      requestAnimationFrame(() => {
        track.style.transition = `transform 1.9s cubic-bezier(.15,.85,.25,1) ${k * .15}s`;
        track.style.transform = `translateY(-${target * H}px)`;
      });
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
    setTimeout(() => {
      $('#pairCaption').textContent = phrase.current.reader + ' читает — ' + phrase.current.answerer + ' отвечает!';
      $('#phraseGoBtn').classList.remove('hidden');
      vibrate(40);
    }, 2250);
  });

  function drawPrompt() {
    if (!phrase.bag.length) {
      const cats = phrase.mode === 'all' ? ['friendly', 'names', 'dark'] : [phrase.mode];
      phrase.bag = cats.flatMap(c => window.PHRASE.prompts[c]).filter(t => !state.blacklist.includes(t)).sort(() => Math.random() - .5);
    }
    return phrase.bag.pop() || window.PHRASE.prompts.friendly[0];
  }

  function showPhrasePrompt() {
    const tpl = drawPrompt();
    const r = renderTemplate(tpl, phrase.current.answerer, pickOther(phrase.current.answerer));
    $('#phTaskMeta').textContent = phrase.current.reader + ' читает · фраза ' + (phrase.qInPair + 1) + ' из ' + phrase.per;
    $('#phTaskText').innerHTML = r.html;
    state.currentPlain = r.plain;
    // последняя фраза пары — на оценку зала
    const last = phrase.qInPair + 1 >= phrase.per;
    $('#phraseNextBtn').textContent = last ? 'Оценить пару' : 'Следующая фраза ›';
    $('#ratePanel').classList.add('hidden');
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
    const b = e.target.closest('[data-r]'); if (!b) return;
    const who = phrase.current.answerer;
    phrase.scores[who].push(parseInt(b.dataset.r, 10));
    if (!phrase.queue.length) return showPhResults();
    resetPairScreen();
    showScreen('screen-phrase-round');
  });

  function showPhResults() {
    const rows = state.players.map(nm => {
      const arr = phrase.scores[nm] || [];
      return { nm, sum: arr.reduce((a, b) => a + b, 0) };
    }).sort((a, b) => b.sum - a.sum);
    const loser = rows[rows.length - 1];
    $('#phResultsTitle').textContent = 'Круг завершён';
    $('#phResultsTable').innerHTML = rows.map(r =>
      `<div class="ph-result-row${r === loser ? ' loser' : ''}"><b>${esc(r.nm)}</b><span class="ph-score">${r.sum}</span></div>`).join('');
    $('#phLoser').innerHTML = 'Последнее место — <b>' + esc(loser.nm) + '</b>: ' + esc(state.punish);
    showScreen('screen-phrase-results');
    vibrate([60, 60, 140]);
  }

  /* ══════════ Настройки ══════════ */
  function openSettings() {
    renderChips();
    $('#setPlayersCount').textContent = state.players.length || '—';
    $('#setSoundState').textContent = state.sound ? 'Вкл' : 'Выкл';
    $('#setTtsState').textContent = state.tts ? 'Вкл' : 'Выкл';
    $('#setBlitzState').textContent = state.blitz ? 'Вкл' : 'Выкл';
    $('#punishInput').value = state.punish;
    $('#settingsModal').classList.remove('hidden');
  }
  function renderChips() {
    $('#levelChips').innerHTML = DATA.levels.map(l =>
      `<button data-lv="${l.id}" class="${l.id === state.level ? 'on' : ''}">${l.name}</button>`).join('');
  }
  $('#menuBtn').addEventListener('click', openSettings);
  $('#settingsCloseBtn').addEventListener('click', () => $('#settingsModal').classList.add('hidden'));
  $('#settingsModal').addEventListener('click', e => { if (e.target.id === 'settingsModal') e.currentTarget.classList.add('hidden'); });
  $('#levelChips').addEventListener('click', e => {
    const b = e.target.closest('[data-lv]'); if (!b) return;
    state.level = b.dataset.lv; store.set('level', state.level);
    app.dataset.level = state.level;
    syncCarousel();
    renderChips();
  });
  $('#setPlayersBtn').addEventListener('click', () => { $('#settingsModal').classList.add('hidden'); openPlayers('screen-wheel'); });
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
  $('#setBlitzBtn').addEventListener('click', () => {
    state.blitz = !state.blitz; store.set('blitz', state.blitz);
    $('#setBlitzState').textContent = state.blitz ? 'Вкл' : 'Выкл';
    if (state.blitz) { startBlitzClock(); toast('Блиц: ' + (BLITZ_SECS / 60) + ' минуты на круг — не успел, ' + state.punish); }
    else { clearInterval(state.blitzTimerId); renderHud(); toast('Блиц выключен'); }
  });
  $('#punishInput').addEventListener('input', () => {
    const v = $('#punishInput').value.trim();
    state.punish = v || 'пей стопку';
    store.set('punish', state.punish);
  });
  $('#punishInput').addEventListener('blur', () => {
    $('#punishInput').value = state.punish;
  });
  $('#setStatsBtn').addEventListener('click', () => {
    $('#settingsModal').classList.add('hidden');
    renderStats('Статистика');
  });
  $('#setGamesBtn').addEventListener('click', () => {
    $('#settingsModal').classList.add('hidden');
    showScreen('screen-games');
  });

  function syncSoundIcons() {
    $('#soundOnIcon').classList.toggle('hidden', !state.sound);
    $('#soundOffIcon').classList.toggle('hidden', state.sound);
  }
  $('#soundBtn').addEventListener('click', () => {
    state.sound = !state.sound; store.set('sound', state.sound); syncSoundIcons();
  });

  $('#crownBtn').addEventListener('click', () => toast('Премиум здесь не нужен — всё и так бесплатно'));

  /* ── Статистика ── */
  function renderStats(title) {
    $('#statsTitle').textContent = title;
    const rows = state.players.map(nm => ({ nm, ...(state.stats[nm] || newStats()) }));
    const top = rows.slice().sort((a, b) => b.done - a.done)[0];
    $('#statsTable').innerHTML = rows.map(r =>
      `<div class="stats-row"><b>${esc(r.nm)}</b><span>правда: ${r.truth} · действие: ${r.action} · сделано: ${r.done}</span><span>${esc(state.punish)}: ${r.fails}</span></div>`
    ).join('') + (top && top.done ? `<p class="stats-kings">Король мангала: ${esc(top.nm)} — ${top.done}</p>` : '');
    $('#statsModal').classList.remove('hidden');
  }
  $('#statsCloseBtn').addEventListener('click', () => $('#statsModal').classList.add('hidden'));
  $('#statsModal').addEventListener('click', e => { if (e.target.id === 'statsModal') e.currentTarget.classList.add('hidden'); });
  $('#statsResetBtn').addEventListener('click', () => {
    state.stats = {}; store.set('stats', state.stats);
    renderStats('Статистика');
    toast('Статистика сброшена');
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
  }
  function hideBanPopup() {
    banOpen = false;
    $('#banPopup').classList.add('hidden');
  }
  ['choiceTruth', 'choiceAction'].forEach(id => {
    const card = $('#' + id);
    const type = id === 'choiceTruth' ? 'truth' : 'action';
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
      const t = pending[type];
      if (!state.blacklist.includes(t)) state.blacklist.push(t);
      store.set('blacklist', state.blacklist);
      state.bags = {};                                   // пересобрать мешки без убранного
      pending[type] = drawTask(state.level, type, pending.name);
      const r = renderTemplate(pending[type], pending.name, pickOther(pending.name));
      pending[type + 'Html'] = r.html; pending[type + 'Plain'] = r.plain;
      $(type === 'truth' ? '#truthPreview' : '#actionPreview').innerHTML = r.html;
      toast('Задание убрано из игры');
    }
    hideBanPopup();
  });
  $('#banNo').addEventListener('click', hideBanPopup);

  /* ── Старт: всегда с игроков ── */
  buildCarousel();
  buildGames();
  syncSoundIcons();
  syncCarousel(false);
  if (state.players.length < 2) state.players = state.players.concat(['', '']);
  renderPlayers();
  renderHud();
  $('#perValue').textContent = phrase.per;
  if (state.blitz) startBlitzClock();
  showScreen('screen-players');

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
