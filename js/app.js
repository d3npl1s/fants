/* ═══════════════ Фанты — логика ═══════════════ */
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const DATA = window.FANT;

  /* ── Состояние ── */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fant.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('fant.' + k, JSON.stringify(v)); } catch {} }
  };

  const state = {
    level: store.get('level', 'fun'),
    players: store.get('players', []),
    sound: store.get('sound', true),
    bags: {},          // «мешки» заданий без повторов
    timerId: null,
    spinning: false
  };

  const app = $('#app');
  app.dataset.level = state.level;

  /* ── Экраны ── */
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  }

  /* ── Звук (WebAudio, без внешних файлов) ── */
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
  const tickSound = () => beep(880, .035, 'square', .06);
  const revealSound = isTruth => {
    if (isTruth) { beep(392, .12, 'triangle', .16); beep(294, .18, 'triangle', .16, .13); }
    else { beep(392, .09, 'triangle', .16); beep(494, .09, 'triangle', .16, .1); beep(659, .16, 'triangle', .16, .2); }
  };
  const vibrate = p => { if (navigator.vibrate) navigator.vibrate(p); };

  /* ── Тосты ── */
  let toastT = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  /* ══════════ Карусель уровней ══════════ */
  const ICONS = {
    cloud: `<svg class="level-icon" viewBox="0 0 120 120"><path fill="#fff" d="M60 14c14 0 26 7 32 18 12 2 21 12 21 25 0 14-11 25-25 25H32C18 82 7 71 7 57c0-12 8-22 19-25 5-11 18-18 34-18z"/><g fill="#3b82d6"><path d="M38 46l12 6-12 6 4-6z"/><path d="M82 46l-12 6 12 6-4-6z"/><path d="M36 68c6 7 13 10 24 10s18-3 24-10c-6 3-14 5-24 5s-18-2-24-5z"/></g></svg>`,
    wink: `<svg class="level-icon" viewBox="0 0 120 120"><path fill="#fff" d="M60 10l8 10 12-4 3 12 13 1-3 13 12 5-8 11 8 11-12 5 3 13-13 1-3 12-12-4-8 10-8-10-12 4-3-12-13-1 3-13-12-5 8-11-8-11 12-5-3-13 13-1 3-12 12 4z"/><g fill="#ff5a45"><circle cx="42" cy="54" r="6"/><path d="M74 48l12 6-12 6 4-6z"/><path d="M38 74c7 6 14 9 22 9s15-3 22-9c-7 3-14 4-22 4s-15-1-22-4z"/></g></svg>`,
    hearts: `<svg class="level-icon" viewBox="0 0 120 120"><path fill="#fff" d="M60 10l8 10 12-4 3 12 13 1-3 13 12 5-8 11 8 11-12 5 3 13-13 1-3 12-12-4-8 10-8-10-12 4-3-12-13-1 3-13-12-5 8-11-8-11 12-5-3-13 13-1 3-12 12 4z"/><g fill="#ff2e78"><path d="M42 46c4-5 12-4 13 2 1-6 9-7 13-2 3 4 1 8-4 12l-9 7-9-7c-5-4-7-8-4-12z"/><path d="M72 46c4-5 12-4 13 2 1-6 9-7 13-2 3 4 1 8-4 12l-9 7-9-7c-5-4-7-8-4-12z" transform="translate(-12 2) scale(.92)"/><path d="M38 78c7 5 14 8 22 8s15-3 22-8c-7 3-14 4-22 4s-15-1-22-4z"/></g></svg>`
  };

  function buildCarousel() {
    const track = $('#carTrack');
    track.innerHTML = DATA.levels.map(lv => `
      <div class="level-card" data-lv="${lv.id}">
        ${ICONS[lv.icon]}
        <div class="level-name">${lv.name}</div>
        <p class="level-tag">${lv.tagline}</p>
        <button class="play-btn" data-play="${lv.id}"><span>Играть</span><i class="chev">›</i></button>
      </div>`).join('');
    const dots = $('#carDots');
    dots.innerHTML = DATA.levels.map((l, i) => `<i data-i="${i}" class="${DATA.levels.findIndex(x => x.id === state.level) === i ? 'on' : ''}"></i>`).join('');

    track.addEventListener('click', e => {
      const b = e.target.closest('[data-play]');
      if (b) tryStartGame(b.dataset.play);
    });

    // свайп
    let startX = 0, startIndex = levelIndex();
    track.addEventListener('touchstart', e => { startX = e.touches[0].clientX; startIndex = levelIndex(); }, { passive: true });
    track.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 50) gotoLevel(startIndex + (dx < 0 ? 1 : -1));
      else gotoLevel(startIndex);
    }, { passive: true });
    // клик-навигация мышью
    track.addEventListener('click', e => {
      if (e.target.closest('[data-play]')) return;
      const r = track.getBoundingClientRect();
      gotoLevel(levelIndex() + (e.clientX > r.left + r.width / 2 ? 1 : -1));
    });
    requestAnimationFrame(() => gotoLevel(levelIndex(), true));
  }

  const levelIndex = () => Math.max(0, DATA.levels.findIndex(l => l.id === state.level));
  function gotoLevel(i, instant = false) {
    i = Math.max(0, Math.min(DATA.levels.length - 1, i));
    const track = $('#carTrack');
    if (instant) track.style.transition = 'none';
    track.style.transform = `translateX(${-i * 100}%)`;
    if (instant) requestAnimationFrame(() => track.style.transition = '');
    document.querySelectorAll('#carDots i').forEach((d, k) => d.classList.toggle('on', k === i));
  }

  /* ══════════ Игроки ══════════ */
  let setupReturn = 'screen-levels';
  function renderPlayers() {
    const list = $('#playerList');
    list.innerHTML = '';
    state.players.forEach((name, i) => {
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `<input maxlength="14" value="" placeholder="Имя ${i + 1}">
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
  function openSetup(from) {
    setupReturn = from;
    if (state.players.length < 2) { state.players = state.players.concat(['', '']); }
    renderPlayers();
    showScreen('screen-setup');
  }
  $('#addPlayerBtn').addEventListener('click', () => {
    if (state.players.length >= 12) return toast('Максимум 12 игроков');
    state.players.push(''); renderPlayers();
    const inputs = document.querySelectorAll('#playerList input');
    inputs[inputs.length - 1].focus();
  });
  $('#setupBackBtn').addEventListener('click', () => showScreen(setupReturn));
  $('#setupSaveBtn').addEventListener('click', () => {
    state.players = state.players.map(s => s.trim()).filter(Boolean);
    if (state.players.length < 2) return toast('Нужно минимум 2 игрока');
    store.set('players', state.players);
    showScreen('screen-wheel');
  });

  /* ══════════ Игра: колесо ══════════ */
  function tryStartGame(levelId) {
    if (state.players.length < 2) { openSetup('screen-levels'); return; }
    state.level = levelId;
    store.set('level', levelId);
    app.dataset.level = levelId;
    showScreen('screen-wheel');
  }

  $('#spinBtn').addEventListener('click', spin);

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

    const n = state.players.length;
    const chosenIdx = Math.floor(Math.random() * n);
    const loops = 2 + Math.floor(Math.random() * 2);          // 2–3 полных круга
    const steps = loops * n + chosenIdx;
    const H = 130;                                            // высота имени, px

    // лента имён: про запас 3 сверху и снизу
    const pad = 3, total = steps + pad * 2 + 1;
    const track = $('#spinTrack');
    let html = '';
    for (let i = 0; i < total; i++) {
      const name = state.players[((i - pad) % n + n) % n];
      html += `<div class="spin-name" data-i="${i}"><span>${esc(name)}</span></div>`;
    }
    track.innerHTML = html;
    // старт: чтобы pad-е имя было по центру
    const overlay = $('#spinOverlay');
    overlay.classList.remove('hidden');
    track.style.transition = 'none';
    track.style.transform = 'translate(-50%, calc(-50% + ' + (pad * H) + 'px))';
    void track.offsetWidth;

    const dist = steps * H;
    const dur = 3600 + Math.random() * 800;
    const t0 = performance.now();
    let lastIdx = -1;

    const ease = t => 1 - Math.pow(1 - t, 4);

    function frame(now) {
      const t = Math.min(1, (now - t0) / dur);
      const y = ease(t) * dist;
      const idx = Math.floor(y / H);
      if (idx !== lastIdx) { lastIdx = idx; tickSound(); }
      track.style.transform = 'translate(-50%, calc(-50% + ' + (pad * H - y) + 'px))';
      if (t < 1) requestAnimationFrame(frame);
      else finishSpin(steps);
    }
    requestAnimationFrame(frame);
  }

  function finishSpin(steps) {
    const H = 130;
    const winner = trackChild(steps);
    if (winner) winner.classList.add('win');
    vibrate([60, 60, 120]);
    setTimeout(() => {
      $('#spinOverlay').classList.add('hidden');
      const name = state.players[steps % state.players.length];
      reveal(name);
      state.spinning = false;
    }, 700);
  }
  const trackChild = i => document.querySelector(`.spin-name[data-i="${i}"]`);

  /* ══════════ Задание ══════════ */
  function reveal(name) {
    const isTruth = Math.random() < .45;
    const type = isTruth ? 'truth' : 'action';
    let text = drawTask(state.level, type)
      .replaceAll('{name}', `<b>${esc(name)}</b>`)
      .replaceAll('{other}', `<b>${esc(pickOther(name))}</b>`);

    $('#revealType').textContent = isTruth ? 'правда' : 'действие';
    $('#revealText').innerHTML = text;
    revealSound(isTruth);
    showScreen('screen-reveal');
    startTimer(60);
  }

  function startTimer(sec) {
    stopTimer();
    const fill = $('#timerFill');
    fill.style.transition = 'none';
    fill.style.height = '100%';
    void fill.offsetWidth;
    fill.style.transition = 'height .95s linear';
    const endAt = Date.now() + sec * 1000;
    state.timerId = setInterval(() => {
      const left = Math.max(0, endAt - Date.now());
      fill.style.height = (left / (sec * 1000) * 100) + '%';
      if (left <= 0) { stopTimer(); vibrate(300); $('#timerCard').animate({ opacity: [.25, 1, .25] }, { duration: 900, iterations: 2 }); }
    }, 950);
  }
  function stopTimer() { if (state.timerId) { clearInterval(state.timerId); state.timerId = null; } }

  $('#doneBtn').addEventListener('click', () => { stopTimer(); showScreen('screen-wheel'); });

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
    gotoLevel(levelIndex());
    renderChips();
  });
  $('#setPlayersBtn').addEventListener('click', () => { $('#settingsModal').classList.add('hidden'); openSetup('screen-wheel'); });
  $('#setSoundBtn').addEventListener('click', () => {
    state.sound = !state.sound; store.set('sound', state.sound);
    $('#setSoundState').textContent = state.sound ? 'Вкл' : 'Выкл';
    syncSoundIcons();
  });
  $('#setMenuBtn').addEventListener('click', () => { $('#settingsModal').classList.add('hidden'); stopTimer(); showScreen('screen-levels'); gotoLevel(levelIndex()); });

  /* ── Звук: кнопка и иконки ── */
  function syncSoundIcons() {
    $('#soundOnIcon').classList.toggle('hidden', !state.sound);
    $('#soundOffIcon').classList.toggle('hidden', state.sound);
  }
  $('#soundBtn').addEventListener('click', () => {
    state.sound = !state.sound; store.set('sound', state.sound); syncSoundIcons();
  });

  /* ── Корона ── */
  $('#crownBtn').addEventListener('click', () => toast('👑 Премиум здесь не нужен — всё и так бесплатно'));

  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── Старт ── */
  buildCarousel();
  syncSoundIcons();
  showScreen('screen-levels');
  gotoLevel(levelIndex(), true);

  // Service Worker — офлайн после первого открытия
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
