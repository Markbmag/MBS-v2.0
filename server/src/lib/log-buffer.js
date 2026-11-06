// Последние ошибки и предупреждения сервера — для страницы администратора.
// console.error / console.warn работают как раньше (пишут в окно и журнал),
// дополнительно последние MAX записей хранятся в памяти.
const util = require('util');

const MAX = 200;
const entries = [];

for (const level of ['error', 'warn']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    try {
      entries.push({ time: new Date().toISOString(), level, text: util.format(...args).slice(0, 1500) });
      if (entries.length > MAX) entries.shift();
    } catch { /* запись в буфер не должна мешать выводу */ }
    original(...args);
  };
}

function recentLogEntries(limit = 100) {
  return entries.slice(-limit).reverse();
}

module.exports = { recentLogEntries };
