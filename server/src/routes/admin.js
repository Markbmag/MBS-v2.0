// Маршрут для страницы администратора (/admin) — только по специальному паролю (IMPORT_PASSWORD).
//
// POST /api/admin/overview { password } → состояние системы, резервные копии, статистика
// использования страниц, медленные запросы, последние ошибки, блокировки ввода пароля.
// Только чтение. Неверный пароль учитывается защитой от подбора, как и везде.

const { app } = require('../app');
const { IMPORT_PASSWORD } = require('../config/passwords');
const { collectHealth } = require('./health');
const { usageSummary } = require('../services/usage');
const { requestStats } = require('../middleware/request-stats');
const { recentLogEntries } = require('../lib/log-buffer');
const { lockedComputers } = require('../middleware/password-guard');

const STARTED_AT = new Date().toISOString();

app.post('/api/admin/overview', async (req, res) => {
  const { password, days } = req.body || {};
  if (typeof password !== 'string' || password !== IMPORT_PASSWORD) {
    return res.status(403).json({ success: false, error: 'Неверный пароль' });
  }
  try {
    const health = await collectHealth();
    res.json({
      success: true,
      server: { startedAt: STARTED_AT, node: process.version, memoryMb: Math.round(process.memoryUsage().rss / 1048576) },
      health,
      usage: usageSummary(Math.min(Math.max(Number(days) || 30, 1), 365)),
      requests: requestStats(),
      log: recentLogEntries(100),
      locks: lockedComputers(),
    });
  } catch (err) {
    console.error('[ADMIN] Ошибка сводки:', err.message);
    res.status(500).json({ success: false, error: 'Не удалось собрать сводку' });
  }
});
