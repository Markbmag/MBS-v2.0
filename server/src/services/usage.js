// Статистика использования страниц: сколько раз открывали каждую страницу и
// с какого числа разных компьютеров (по дням). Без имён — входа в систему нет;
// компьютер хранится как короткий обезличенный код, а не адрес.
//
// Хранится в файле server/data/usage.json (не в БД — дополнительных прав не нужно).
// Запись на диск — не чаще раза в 30 секунд; хранится KEEP_DAYS дней.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SERVER_DIR } = require('../paths');

const FILE = path.join(SERVER_DIR, 'data', 'usage.json');
const KEEP_DAYS = 400;
const MAX_PATHS_PER_DAY = 300;
const MAX_COMPUTERS_PER_PAGE_DAY = 500;
const SAVE_DELAY_MS = 30 * 1000;

let data = { days: {} };
let saveTimer = null;

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function load() {
  try {
    if (!fs.existsSync(FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (parsed && typeof parsed.days === 'object') data = parsed;
  } catch (err) {
    console.error('[СТАТИСТИКА] Файл статистики повреждён, начинаю заново:', err.message);
    try { fs.renameSync(FILE, `${FILE}.bad`); } catch { /* ничего */ }
  }
}

function save() {
  saveTimer = null;
  try {
    const limit = dayOf(new Date(Date.now() - KEEP_DAYS * 86400000));
    for (const d of Object.keys(data.days)) if (d < limit) delete data.days[d];
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('[СТАТИСТИКА] Не удалось сохранить статистику:', err.message);
  }
}

function computerCode(address) {
  return crypto.createHash('sha256').update(`mbs-usage:${address}`).digest('hex').slice(0, 12);
}

function recordView(pagePath, address) {
  const day = dayOf(new Date());
  const days = data.days;
  if (!days[day]) days[day] = {};
  const pages = days[day];
  if (!pages[pagePath]) {
    if (Object.keys(pages).length >= MAX_PATHS_PER_DAY) return;
    pages[pagePath] = { views: 0, computers: [] };
  }
  const p = pages[pagePath];
  p.views++;
  const code = computerCode(address);
  if (!p.computers.includes(code) && p.computers.length < MAX_COMPUTERS_PER_PAGE_DAY) p.computers.push(code);
  if (!saveTimer) saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

// Сводка за последние N дней: по страницам и по дням.
function usageSummary(daysBack = 30) {
  const from = dayOf(new Date(Date.now() - (daysBack - 1) * 86400000));
  const pages = new Map();
  const perDay = [];
  const allComputers = new Set();
  for (const [day, dayPages] of Object.entries(data.days).sort()) {
    if (day < from) continue;
    let views = 0;
    const dayComputers = new Set();
    for (const [p, s] of Object.entries(dayPages)) {
      const agg = pages.get(p) || { path: p, views: 0, computers: new Set(), lastDay: day };
      agg.views += s.views;
      s.computers.forEach((c) => { agg.computers.add(c); dayComputers.add(c); allComputers.add(c); });
      agg.lastDay = day;
      pages.set(p, agg);
      views += s.views;
    }
    perDay.push({ day, views, computers: dayComputers.size });
  }
  const firstDay = Object.keys(data.days).sort()[0] || null;
  return {
    days: daysBack,
    collectingSince: firstDay,
    totalViews: perDay.reduce((s, d) => s + d.views, 0),
    computers: allComputers.size,
    perDay,
    pages: [...pages.values()].map((p) => ({ path: p.path, views: p.views, computers: p.computers.size, lastDay: p.lastDay })).sort((a, b) => b.views - a.views),
  };
}

load();

module.exports = { recordView, usageSummary };
