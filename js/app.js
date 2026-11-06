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
    streaks: {},          // имя игрока -> { type, count } — лимит «2 раза подряд»
    bags: {},             // мешки заданий без повторов
    timerId: null,
    spinning: false,
    taskFailed: false,
    currentTask: null
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

  /* ── Круги: кто остался в колесе ── */
  function resetRounds() {
    state.round = 1;
    state.remaining = [...state.players];
    store.set('round', state.round);
    store.set('remaining', state.remaining);
    renderHud();
  }
  // при загрузке: remaining должен соответствовать текущим игрокам
  if (!Array.isArray(state.remaining) || !state.remaining.length ||
      state.remaining.some(n => !state.players.includes(n))) {
    state.remaining = [...state.players];
  }
  function renderHud() {
    $('#hudRound').textContent = 'Круг ' + state.round;
    $('#hudLeft').textContent = 'в колесе ' + state.remaining.length + ' из ' + state.players.length;
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
        <button class="rm" title="Удалить">×</button>`;
      const inp = row.querySelector('input');
      inp.value = name;
      inp.addEventListener('input', () => { state.players[i] = inp.value.trim(); });
      inp.addEventListener('blur', () => { state.players[i] = inp.value.trim(); store.set('players', state.players); });
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
    showScreen('screen-levels');
    syncCarousel();
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
  $('#spinBtn').addEventListener('click', spin);

  // свайп в любом месте экрана запускает колесо
  let swipeStart = null;
  const wheelScreen = $('#screen-wheel');
  wheelScreen.addEventListener('touchstart', e => { swipeStart = e.touches[0].clientX; }, { passive: true });
  wheelScreen.addEventListener('touchend', e => {
    if (swipeStart === null) return;
    if (Math.abs(e.changedTouches[0].clientX - swipeStart) > 45) spin();
    swipeStart = null;
  }, { passive: true });

  function pickOther(name) {
    const others = state.players.filter(p => p !== name);
    return others[Math.floor(Math.random() * others.length)] || name;
  }

  function drawTask(level, type) {
    const bagKey = level + ':' + type;
    if (!state.bags[bagKey] || !state.bags[bagKey].length) {
      state.bags[bagKey] = [...DATA.tasks[level][type]].sort(() => Math.random() - .5);
    }
    return state.bags[bagKey].pop();
  }

  function spin() {
    if (state.spinning || state.players.length < 2) return;
    state.spinning = true;
    vibrate(30);

    const rem = state.remaining.length ? state.remaining : [...state.players];
    const n = rem.length;
    const chosenIdx = Math.floor(Math.random() * n);
    const loops = 2 + Math.floor(Math.random() * 2);            // 2–3 круга
    const steps = loops * n + chosenIdx;
    const pad = SPIN_PAD;
    const total = steps + pad * 2 + 1;
    const winIdx = steps + pad;                                  // индекс победителя в ленте

    const track = $('#spinTrack');
    let html = '';
    for (let i = 0; i < total; i++) {
      const pIdx = ((i - pad) % n + n) % n;
      const pname = rem[pIdx];
      const cIdx = Math.max(0, state.players.indexOf(pname));   // цвет — по позиции в общем списке
      html += `<div class="spin-name" data-i="${i}"><span style="background:${playerColor(cIdx)}">${esc(pname)}</span></div>`;
    }
    track.innerHTML = html;

    const overlay = $('#spinOverlay');
    overlay.classList.remove('hidden');

    // имя i по центру: translate(-50%, (total/2 - i - 0.5) * H)
    const offset = i => (total / 2 - i - .5) * NAME_H;
    track.style.transition = 'none';
    track.style.transform = `translate(-50%, calc(-50% + ${offset(pad)}px))`;
    void track.offsetWidth;

    const from = offset(pad), to = offset(winIdx);
    const dist = to - from;
    const dur = 3200;
    const t0 = performance.now();
    let lastIdx = -1;

    // разгон с места → быстрый разгон → быстрая остановка
    const ease = t => t < .5 ? 8 * t * t * t * t : 1 - 8 * Math.pow(1 - t, 4);

    function frame(now) {
      const t = Math.min(1, (now - t0) / dur);
      const y = from + ease(t) * dist;
      const idx = Math.floor(-y / NAME_H + total / 2);
      if (idx !== lastIdx) { lastIdx = idx; tickSound(); }
      track.style.transform = `translate(-50%, calc(-50% + ${y}px))`;
      if (t < 1) requestAnimationFrame(frame);
      else finishSpin(winIdx, rem[chosenIdx]);
    }
    requestAnimationFrame(frame);
  }

  function finishSpin(winIdx, winnerName) {
    const winner = document.querySelector(`.spin-name[data-i="${winIdx}"]`);
    if (winner) winner.classList.add('win');
    vibrate([60, 60, 140]);
    // победитель колеса — единственный источник имени для экрана выбора
    setTimeout(() => {
      $('#spinOverlay').classList.add('hidden');
      openChoice(winnerName);
      state.spinning = false;
    }, 700);
  }

  /* ══════════ Экран 4: выбор правда / действие ══════════ */
  let pending = null;   // { name, truth, action }

  function openChoice(name) {
    pending = {
      name,
      truth: drawTask(state.level, 'truth'),
      action: drawTask(state.level, 'action')
    };
    $('#choiceName').textContent = name;
    // текст фиксируется один раз: превью = то, что получишь после выбора
    pending.truthHtml = renderTemplate(pending.truth, name);
    pending.actionHtml = renderTemplate(pending.action, name);
    $('#truthPreview').innerHTML = pending.truthHtml;
    $('#actionPreview').innerHTML = pending.actionHtml;

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

  function renderTemplate(tpl, name) {
    return esc(tpl)
      .replaceAll('{name}', `<b>${esc(name)}</b>`)
      .replaceAll('{other}', `<b>${esc(pickOther(name))}</b>`);
  }

  $('#choiceTruth').addEventListener('click', () => choose('truth'));
  $('#choiceAction').addEventListener('click', () => choose('action'));
  $('#choiceBackBtn').addEventListener('click', () => showScreen('screen-wheel'));

  function choose(type) {
    if (!pending) return;
    const st = state.streaks[pending.name];
    if (st && st.type === type) st.count += 1;
    else state.streaks[pending.name] = { type, count: 1 };
    reveal(type);
  }

  /* ══════════ Экран 5: задание ══════════ */
  function reveal(type) {
    state.currentTask = pending[type];
    state.taskFailed = false;
    const isTruth = type === 'truth';
    $('#revealType').textContent = isTruth ? 'правда' : 'действие';
    $('#revealText').innerHTML = isTruth ? pending.truthHtml : pending.actionHtml;
    revealSound(isTruth);
    app.classList.remove('failed');
    $('#failBanner').classList.add('hidden');
    $('#actionRow').classList.remove('hidden');
    $('#btnNext').classList.add('hidden');
    showScreen('screen-reveal');
    startTimer(levelTimerSecs());
  }

  const levelTimerSecs = () => {
    const lv = DATA.levels.find(l => l.id === state.level);
    return (lv && lv.timer) || 60;
  };

  function startTimer(sec) {
    stopTimer();
    const fill = $('#timerFill'), secs = $('#timerSecs');
    fill.style.transition = 'none';
    fill.style.width = '100%';
    secs.textContent = sec;
    void fill.offsetWidth;
    fill.style.transition = 'width 1s linear';
    const endAt = Date.now() + sec * 1000;
    state.timerId = setInterval(() => {
      const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      secs.textContent = left;
      fill.style.width = (Math.max(0, endAt - Date.now()) / (sec * 1000) * 100) + '%';
      if (left <= 5 && left > 0) beep(660, .07, 'square', .1);   // тик-так на последних секундах
      if (left <= 0) failTask();
    }, 1000);
  }
  function stopTimer() { if (state.timerId) { clearInterval(state.timerId); state.timerId = null; } }

  function failTask() {
    if (state.taskFailed) return;
    state.taskFailed = true;
    stopTimer();
    $('#timerFill').style.width = '0%';
    $('#timerSecs').textContent = '0';
    app.classList.add('failed');
    $('#failBanner').classList.remove('hidden');
    $('#actionRow').classList.add('hidden');
    $('#btnNext').classList.remove('hidden');
    failSound();
    vibrate([200, 100, 200, 100, 300]);
  }

  /* ── Круги: Выполнил → вылетает до следующего круга; Не выполнил → остаётся ── */
  function completeTask(done) {
    stopTimer();
    app.classList.remove('failed');
    $('#failBanner').classList.add('hidden');
    const name = pending.name;
    if (done) {
      state.remaining = state.remaining.filter(p => p !== name);
      store.set('remaining', state.remaining);
      if (!state.remaining.length) {
        state.round += 1;
        state.remaining = [...state.players];
        store.set('round', state.round);
        store.set('remaining', state.remaining);
        toast('Круг завершён! Круг ' + state.round + ' — все снова в колесе');
      } else {
        toast(name + ' выбывает до следующего круга. Осталось: ' + state.remaining.length);
      }
    } else {
      vibrate(120);
      toast(name + ' остаётся в колесе — и пей стопку');
    }
    renderHud();
    showScreen('screen-wheel');
  }

  $('#btnDone').addEventListener('click', () => completeTask(true));
  $('#btnFail').addEventListener('click', () => completeTask(false));
  $('#btnNext').addEventListener('click', () => completeTask(false));

  /* ══════════ Настройки ══════════ */
  function openSettings() {
    renderChips();
    $('#setPlayersCount').textContent = state.players.length || '—';
    $('#setSoundState').textContent = state.sound ? 'Вкл' : 'Выкл';
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

  function syncSoundIcons() {
    $('#soundOnIcon').classList.toggle('hidden', !state.sound);
    $('#soundOffIcon').classList.toggle('hidden', state.sound);
  }
  $('#soundBtn').addEventListener('click', () => {
    state.sound = !state.sound; store.set('sound', state.sound); syncSoundIcons();
  });

  $('#crownBtn').addEventListener('click', () => toast('Премиум здесь не нужен — всё и так бесплатно'));

  /* ── Старт: всегда с игроков ── */
  buildCarousel();
  syncSoundIcons();
  syncCarousel(false);
  if (state.players.length < 2) state.players = state.players.concat(['', '']);
  renderPlayers();
  renderHud();
  showScreen('screen-players');

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
