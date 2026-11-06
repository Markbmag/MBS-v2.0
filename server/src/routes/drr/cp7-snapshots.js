// DRR CP7 — снимки смен (фоновое сохранение и маршруты).
// Код перенесён из server.js без изменений.

const { getWeekNumberForDate } = require('../../lib/shared');
const { app } = require('../../app');
const { notesPool, pool } = require('../../db');
const { CP7_GRACE_MS, getCp72TimesMap, isDefectNokCp7 } = require('./cp7');

/* ====================================================================== */
/* ================== DRR CP7 — СНИМКИ СМЕН ============================= */
/* ====================================================================== */

const CP7_SNAPSHOT_POST_LISTS = {
  all: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
  cp7: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP9'],
  pip: ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
};

function getShiftLetterForSnapshot(shift, weekNumber) {
  if (shift === 'night') return 'C';
  if (shift === 'all') return 'ALL';
  const isEven = weekNumber % 2 === 0;
  if (shift === 'day') return isEven ? 'B' : 'A';
  if (shift === 'evening') return isEven ? 'A' : 'B';
  return null;
}

function getLastCompletedShiftCp7() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();

  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const todayStr = fmt(now);
  const yest = new Date(now);
  yest.setUTCDate(yest.getUTCDate() - 1);
  const yesterdayStr = fmt(yest);

  if (mins < 91) return { shiftDate: yesterdayStr, shift: 'day' };
  if (mins < 470) return { shiftDate: yesterdayStr, shift: 'evening' };
  if (mins < 1001) return { shiftDate: todayStr, shift: 'night' };
  return { shiftDate: todayStr, shift: 'day' };
}

function getCompletedDayDate() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  if (mins >= 1439) return fmt(now);
  const yest = new Date(now);
  yest.setUTCDate(yest.getUTCDate() - 1);
  return fmt(yest);
}

function getShiftRangeCp7(shiftDate, shift) {
  if (shift === 'all')     return { start: `${shiftDate} 00:00:00`, end: `${shiftDate} 23:59:59` };
  if (shift === 'day')     return { start: `${shiftDate} 07:50:00`, end: `${shiftDate} 16:40:00` };
  if (shift === 'night')   return { start: `${shiftDate} 01:31:00`, end: `${shiftDate} 07:50:00` };
  if (shift === 'evening') {
    const next = new Date(`${shiftDate}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    return { start: `${shiftDate} 16:41:00`, end: `${nextStr} 01:30:00` };
  }
  return null;
}

async function saveDrrCp7Snapshot(shiftDate, shift, filterName) {
  try {
    const range = getShiftRangeCp7(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDate(shiftDate);
    const shiftLetter = getShiftLetterForSnapshot(shift, weekNumber);

    const postList = CP7_SNAPSHOT_POST_LISTS[filterName] || CP7_SNAPSHOT_POST_LISTS.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    // CP72 — из MES
    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(range.start, range.end);

    const totalVins = cp72Rows.length;
    let closedVins = 0;
    let nokVins = 0;
    let drrPercent = 0;
    let topDefects = [];

    if (totalVins > 0) {
      const vins = cp72Rows.map(r => r.VIN);
      const ph = vins.map(() => '?').join(',');

      const [defectRows] = await pool.query(`
        SELECT
          d.VIN, d.STATUS, d.CREATION_TIME,
          d.REPAIR_TIME, d.REPAIR_TIME1,
          wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE
        FROM at_qm_defect_info d
        LEFT JOIN work_order wo ON wo.VIN = d.VIN
        WHERE d.VIN IN (${ph})
          AND d.POST_NAME IN (${postListStr})
      `, vins);

      const vinHasNok = new Map();
      const defectGroupMap = new Map();

      defectRows.forEach(d => {
        const cp72TimeStr = cp72TimeMap.get(d.VIN);
        if (!cp72TimeStr) return;
        const cp72Ms = new Date(cp72TimeStr).getTime();
        const defectMs = new Date(d.CREATION_TIME).getTime();
        if (defectMs > cp72Ms + CP7_GRACE_MS) return;

        if (isDefectNokCp7(d, cp72Ms)) {
          vinHasNok.set(d.VIN, true);

          const mpp = `${d.MODEL || '-'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`.trim();
          const key = `${mpp}|${d.PROBLEM_GRADE || '-'}`;
          if (!defectGroupMap.has(key)) {
            defectGroupMap.set(key, {
              mpp,
              model: d.MODEL || '',
              part_name: d.PART_NAME || '',
              problem_type: d.PROBLEM_TYPE || '',
              grade: d.PROBLEM_GRADE || '-',
              defectCount: 0,
            });
          }
          defectGroupMap.get(key).defectCount += 1;
        }
      });

      let okCount = 0;
      cp72Rows.forEach(r => {
        if (!vinHasNok.get(r.VIN)) okCount++;
      });
      closedVins = okCount;
      nokVins = totalVins - closedVins;
      drrPercent = totalVins > 0 ? Math.round((closedVins / totalVins) * 1000) / 10 : 0;

      topDefects = Array.from(defectGroupMap.values())
        .sort((a, b) => b.defectCount - a.defectCount);

    }

    await notesPool.query(`
      INSERT INTO drr_cp7_snapshots
        (shift_date, week_number, shift, shift_letter, filter_name,
         total_vins, closed_vins, nok_vins, drr_percent, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_vins = VALUES(total_vins),
        closed_vins = VALUES(closed_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        top_defects = VALUES(top_defects)
    `, [shiftDate, weekNumber, shift, shiftLetter, filterName,
        totalVins, closedVins, nokVins, drrPercent, JSON.stringify(topDefects)]);

    console.log(`[DRR CP7 snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) ${filterName} → ${drrPercent}% (${closedVins}/${totalVins})`);
  } catch (err) {
    console.error('[DRR CP7 snapshot] ошибка сохранения:', err.message);
  }
}

async function saveAllDrrCp7Snapshots(shiftDate, shift) {
  await saveDrrCp7Snapshot(shiftDate, shift, 'all');
  await saveDrrCp7Snapshot(shiftDate, shift, 'cp7');
  await saveDrrCp7Snapshot(shiftDate, shift, 'pip');
}

async function checkAndSaveDrrCp7Snapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShiftCp7();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_cp7_snapshots WHERE shift_date = ? AND shift = ?`,
      [shiftDate, shift]
    );
    if (Number(existing[0]?.cnt || 0) < 3) {
      await saveAllDrrCp7Snapshots(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR CP7 snapshot] ошибка проверки смены:', err.message);
  }
}

async function checkAndSaveDrrCp7DailySnapshot() {
  try {
    const dayDate = getCompletedDayDate();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_cp7_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (Number(existing[0]?.cnt || 0) < 3) {
      await saveAllDrrCp7Snapshots(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR CP7 snapshot] ошибка проверки суток:', err.message);
  }
}

setInterval(() => {
  checkAndSaveDrrCp7Snapshot();
  checkAndSaveDrrCp7DailySnapshot();
}, 60 * 1000);
checkAndSaveDrrCp7Snapshot();
checkAndSaveDrrCp7DailySnapshot();

function enrichCp7Snapshot(r) {
  const shiftDate = String(r.shift_date).slice(0, 10);
  const weekNumber = r.week_number != null
    ? r.week_number
    : getWeekNumberForDate(shiftDate);
  const shiftLetter = r.shift_letter != null
    ? r.shift_letter
    : getShiftLetterForSnapshot(r.shift, weekNumber);

  return {
    id: r.id,
    shiftDate,
    weekNumber,
    shift: r.shift,
    shiftLetter,
    filter: r.filter_name,
    snapshotTime: r.snapshot_time,
    totalVins: r.total_vins,
    closedVins: r.closed_vins,
    nokVins: r.nok_vins,
    drrPercent: Number(r.drr_percent),
  };
}

app.get('/api/drr-cp7-snapshots', async (req, res) => {
  try {
    const { days = 14, filter = 'all' } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);

    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, filter_name, snapshot_time,
             total_vins, closed_vins, nok_vins, drr_percent
      FROM drr_cp7_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND filter_name = ?
      ORDER BY shift_date DESC,
        FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays, filter]);

    res.json(rows.map(enrichCp7Snapshot));
  } catch (err) {
    console.error('Ошибка /api/drr-cp7-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-cp7-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query(
      'SELECT * FROM drr_cp7_snapshots WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Снимок не найден' });

    const r = rows[0];
    let topDefects = [];
    try {
      topDefects = r.top_defects
        ? (typeof r.top_defects === 'string' ? JSON.parse(r.top_defects) : r.top_defects)
        : [];
    } catch { topDefects = []; }

    res.json({
      ...enrichCp7Snapshot(r),
      topDefects,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-cp7-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { CP7_SNAPSHOT_POST_LISTS, getCompletedDayDate, getLastCompletedShiftCp7, getShiftLetterForSnapshot, getShiftRangeCp7 };
