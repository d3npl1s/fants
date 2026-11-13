/* ═══════════════ SPY-LAYOUT: мобильная вёрстка «Шпиона» ═══════════════
   Запуск: node tests/spy-layout.test.js
   Статические проверки точечных фиксов вёрстки (только css/spy.css):
   1) экран настроек прокручивается — активная секция получает flex-контекст
      (как у фразовых настроек в style.css), внутренний контейнер — с
      min-height: 0 для flex-child с overflow-y: auto;
   2) «Пропустить» в голосовании — отдельная строка на всю ширину сетки,
      без переноса текста; зона нажатия и выбранное состояние не сломаны;
   3) masking-фиксы запрещены: нет position: fixed в spy.css. */
'use strict';
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'spy.css'), 'utf8');

let n = 0;
const ok = (cond, msg) => {
  n++;
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
};
const rule = sel => {
  const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
};

/* 1. Экран настроек: flex-контекст и прокручиваемый внутренний контейнер */
const setupBody = rule('.screen-spy-setup.active');
ok(setupBody !== null, '.screen-spy-setup.active — правило существует');
ok(/display:\s*flex/.test(setupBody), 'экран настроек: display: flex');
ok(/flex-direction:\s*column/.test(setupBody), 'экран настроек: flex-direction: column');
const innerBody = rule('.screen-spy-setup .phrase-setup-inner');
ok(innerBody !== null && /min-height:\s*0/.test(innerBody),
   '.phrase-setup-inner внутри настроек: min-height: 0 (flex-child с overflow-y: auto)');

/* 2. «Пропустить»: своя строка, без переноса */
const skipBody = rule('.spy-chips button.spy-skip');
ok(skipBody !== null, '.spy-chips button.spy-skip — правило существует');
ok(/grid-column:\s*1\s*\/\s*-1/.test(skipBody), '«Пропустить»: grid-column: 1 / -1 (своя строка сетки)');
ok(/white-space:\s*nowrap/.test(skipBody), '«Пропустить»: white-space: nowrap (без переноса «ь»)');
ok(/word-break:\s*normal/.test(skipBody), '«Пропустить»: word-break: normal (перебивает break-word базы)');

/* 3. Зона нажатия и выбранное состояние не потеряны */
const chipsBody = rule('.spy-chips button');
ok(chipsBody !== null && /min-height:\s*48px/.test(chipsBody),
   'базовые кнопки голосования: min-height: 48px (тап ≥ 48px)');
const skipSel = rule('.spy-chips button.spy-skip.sel');
ok(skipSel !== null && /#ffd166/.test(skipSel),
   'выбранный «Пропустить» — золотой фон сохранён (контраст navy на #ffd166)');

/* 4. Masking-фиксы запрещены */
ok(!css.includes('position: fixed'), 'в spy.css нет position: fixed (кнопки остаются в потоке)');

console.log('SPY-LAYOUT: ' + n + ' проверок пройдено');
