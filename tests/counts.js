/* ═══════════════ Единая точка счётчиков контента ═══════════════
   На эти числа сверяются tests/core.test.js, tests/content-check.js и README.
   При изменении базы правится только этот файл (+ README, если итог менялся):
   расходящееся число где-то ещё уронит тесты. */
module.exports = {
  tasks: {
    'fun.truth': 56, 'fun.action': 55,
    'soft.truth': 68, 'soft.action': 92,
    'hot.truth': 40, 'hot.action': 51
  },
  baseTotal: 362,        // сумма tasks — как в README
  packs: 34,             // задания во всех пакетах суммарно
  phrases: { friendly: 85, names: 75, dark: 55 },
  phrasesTotal: 215      // сумма phrases — как в README
};
