// Время ответа на запросы /api — для поиска медленных отчётов.
//
// Для каждого маршрута считается: сколько раз вызывался, среднее и максимальное время,
// сколько раз был медленным и сколько раз закончился ошибкой сервера (с момента запуска).
// Запрос дольше SLOW_REQUEST_MS (по умолчанию 5000 мс) пишется в журнал и в список
// последних медленных запросов. На ответы это никак не влияет.

const { app } = require('../app');
const { clientAddress } = require('../lib/client-address');

const SLOW_MS = Number(process.env.SLOW_REQUEST_MS) > 0 ? Number(process.env.SLOW_REQUEST_MS) : 5000;
const MAX_SLOW = 100;
const SKIP = new Set(['/api/usage']);
const STARTED_AT = new Date().toISOString();

const byRoute = new Map(); // 'GET /api/x' -> { count, totalMs, maxMs, slow, errors }
const slowList = [];

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || SKIP.has(req.path)) return next();
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    // Маршрут по шаблону (/api/drr-cp7-snapshot/:id), чтобы не плодить записи на каждый id.
    const key = `${req.method} ${req.route ? req.route.path : '(нет такого маршрута)'}`;
    const s = byRoute.get(key) || { count: 0, totalMs: 0, maxMs: 0, slow: 0, errors: 0 };
    s.count++;
    s.totalMs += ms;
    if (ms > s.maxMs) s.maxMs = ms;
    if (res.statusCode >= 500) s.errors++;
    if (ms >= SLOW_MS) {
      s.slow++;
      const url = req.originalUrl.slice(0, 300);
      slowList.push({ time: new Date().toISOString(), method: req.method, url, ms: Math.round(ms), status: res.statusCode, computer: clientAddress(req) });
      if (slowList.length > MAX_SLOW) slowList.shift();
      console.warn(`[МЕДЛЕННО] ${req.method} ${url} — ${(ms / 1000).toFixed(1)} с (статус ${res.statusCode})`);
    }
    byRoute.set(key, s);
  });
  next();
});

function requestStats() {
  const routes = [...byRoute.entries()].map(([route, s]) => ({
    route, count: s.count, avgMs: Math.round(s.totalMs / s.count), maxMs: Math.round(s.maxMs), slow: s.slow, errors: s.errors,
  }));
  return { since: STARTED_AT, slowThresholdMs: SLOW_MS, routes, recentSlow: slowList.slice().reverse() };
}

module.exports = { requestStats };
