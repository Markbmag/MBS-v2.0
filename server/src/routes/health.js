// Маршрут: состояние системы — GET /api/health
//
// Показывает, работают ли базы данных, связь с ПЛК (OPC UA) и сохранение снимков DRR.
// Только читает: в базы отправляется лишь «SELECT 1» и выборка времени последнего снимка.
// Каждая проверка ограничена по времени, поэтому ответ приходит даже при зависшей БД.
//
// Ответ: 200, если всё в порядке; 503, если не работает основная БД или LES
// (без них сервер бесполезен). Остальные проблемы видны в полях ответа.

const { app } = require('../app');
const { pool, notesPool, mesPool, lesPool, bmsPool } = require('../db');
const { opcState } = require('../services/opc');
const backup = require('../jobs/backup');

const CHECK_TIMEOUT_MS = 3000;
const STARTED_AT = Date.now();

// Снимки DRR сохраняются после каждой смены (3 раза в сутки) и за сутки.
// Если последнему снимку больше 12 часов — что-то не так.
const SNAPSHOT_MAX_AGE_HOURS = 12;
const SNAPSHOT_TABLES = {
  cp6: 'drr_cp6_snapshots',
  cp7: 'drr_cp7_snapshots',
  cp7_tup: 'drr_cp7_tup_snapshots',
  adas: 'drr_adas_snapshots',
  pip: 'drr_pip_snapshots',
  cpfinal: 'drr_cpfinal_snapshots',
  electronics: 'drr_electronics_snapshots',
};

function withTimeout(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`нет ответа за ${CHECK_TIMEOUT_MS / 1000} с`)), CHECK_TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

async function pingDb(p) {
  const started = Date.now();
  try {
    await withTimeout(p.query('SELECT 1'));
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err.code || err.message };
  }
}

async function snapshotStatus(table) {
  try {
    const [rows] = await withTimeout(notesPool.query(`SELECT MAX(snapshot_time) AS last_saved, MAX(shift_date) AS last_shift_date FROM ${table}`));
    const last = rows[0] && rows[0].last_saved;
    if (!last) return { ok: false, lastSaved: null, error: 'снимков нет' };
    const ageHours = (Date.now() - new Date(String(last).replace(' ', 'T')).getTime()) / 3600000;
    return {
      ok: ageHours <= SNAPSHOT_MAX_AGE_HOURS,
      lastSaved: String(last),
      lastShiftDate: rows[0].last_shift_date ? String(rows[0].last_shift_date).slice(0, 10) : null,
      ageHours: Math.round(ageHours * 10) / 10,
    };
  } catch (err) {
    return { ok: false, lastSaved: null, error: err.code || err.message };
  }
}

async function collectHealth() {
  const [main, les, mes, notes, bms] = await Promise.all([pool, lesPool, mesPool, notesPool, bmsPool].map(pingDb));
  const snapshots = {};
  if (notes.ok) {
    const entries = await Promise.all(Object.entries(SNAPSHOT_TABLES).map(async ([k, t]) => [k, await snapshotStatus(t)]));
    entries.forEach(([k, v]) => { snapshots[k] = v; });
  }
  const opc = {
    ok: Boolean(opcState.connected && !opcState.error),
    connected: opcState.connected,
    lastValueAt: opcState.ts ? new Date(opcState.ts).toISOString() : null,
    error: opcState.error,
  };
  const databases = { main, les, mes, notes, bms };
  const critical = main.ok && les.ok;
  const allOk = critical && mes.ok && notes.ok && bms.ok && opc.ok && Object.values(snapshots).every((s) => s.ok);

  return {
    status: allOk ? 'ok' : critical ? 'degraded' : 'down',
    time: new Date().toISOString(),
    uptimeMinutes: Math.round((Date.now() - STARTED_AT) / 60000),
    node: process.version,
    databases,
    opc,
    snapshots,
    backup: backup.status(),
  };
}

app.get('/api/health', async (req, res) => {
  const h = await collectHealth();
  res.status(h.status === 'down' ? 503 : 200).json(h);
});

module.exports = { collectHealth };
