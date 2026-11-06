// Маршрут: отметка об открытии страницы (для статистики использования).
// POST /api/usage { path: '/drr-cp7-dashboard' } → 204. Отправляется браузером сам.

const { app } = require('../app');
const { clientAddress } = require('../lib/client-address');
const { recordView } = require('../services/usage');

const PATH_RE = /^\/[A-Za-z0-9_\-/]{0,100}$/;

app.post('/api/usage', (req, res) => {
  const pagePath = req.body && req.body.path;
  if (typeof pagePath === 'string' && PATH_RE.test(pagePath)) {
    try { recordView(pagePath, clientAddress(req)); } catch (err) { console.error('[СТАТИСТИКА]', err.message); }
  }
  res.status(204).end();
});
