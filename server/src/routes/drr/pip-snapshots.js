// DRR PIP — снимки смен (фоновое сохранение и маршруты).
// Код перенесён из server.js без изменений.

const { getWeekNumberForDate } = require('../../lib/shared');
const { getCompletedDayDate, getShiftLetterForSnapshot } = require('../../lib/shifts');
const { app } = require('../../app');
const { mesPool, notesPool, pool } = require('../../db');
const { PIP_DEFECT_POSTS_STR } = require('./pip');

/* ====================================================================== */
/* ================== DRR PIP — СНИМКИ СМЕН ============================= */
/* ====================================================================== */

/* Определение последней ЗАВЕРШЁННОЙ смены (МСК) */
function getLastCompletedShift() {
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

/* Временные границы смены (+ 'all') */
function getShiftRange(shiftDate, shift) {
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

/* Сохранение снимка — с week_number и shift_letter */
async function saveDrrPipSnapshot(shiftDate, shift) {
  try {
    const range = getShiftRange(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDate(shiftDate);
    const shiftLetter = getShiftLetterForSnapshot(shift, weekNumber);

    const [pip9Rows] = await mesPool.query(`
      SELECT DISTINCT vin
      FROM ti_mes_movement
      WHERE uloc_no = 'AGMAS01003'
        AND scan_time >= ? AND scan_time <= ?
        AND is_deleted = 0
    `, [range.start, range.end]);

    const vins = pip9Rows.map(r => r.vin);
    const totalVins = vins.length;

    let closedVins = 0;
    let nokVins = 0;
    let drrPercent = 0;
    let topDefects = [];

    if (totalVins > 0) {
      const ph = vins.map(() => '?').join(',');
      const [defectRows] = await pool.query(`
        SELECT
          d.VIN,
          d.STATUS,
          wo.MODEL,
          d.PART_NAME,
          d.PROBLEM_TYPE,
          d.PROBLEM_GRADE
        FROM at_qm_defect_info d
        LEFT JOIN work_order wo ON wo.VIN = d.VIN
        WHERE d.VIN IN (${ph})
          AND d.POST_NAME IN (${PIP_DEFECT_POSTS_STR})
      `, vins);

      const nokSet = new Set();
      const defectGroupMap = new Map();

      defectRows.forEach(d => {
        const isClosed = d.STATUS && d.STATUS.toLowerCase() === 'closed';
        if (!isClosed) {
          nokSet.add(d.VIN);
          const mpp = `${d.MODEL || '-'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`.trim();
          if (!defectGroupMap.has(mpp)) {
            defectGroupMap.set(mpp, {
              mpp,
              model: d.MODEL || '',
              part_name: d.PART_NAME || '',
              problem_type: d.PROBLEM_TYPE || '',
              grade: d.PROBLEM_GRADE || '-',
              defectCount: 0,
            });
          }
          defectGroupMap.get(mpp).defectCount += 1;
        }
      });

      nokVins = nokSet.size;
      closedVins = totalVins - nokVins;
      drrPercent = totalVins > 0 ? Math.round((closedVins / totalVins) * 1000) / 10 : 0;

      topDefects = Array.from(defectGroupMap.values())
        .sort((a, b) => b.defectCount - a.defectCount);
        
    }

    await notesPool.query(`
      INSERT INTO drr_pip_snapshots
        (shift_date, week_number, shift, shift_letter,
         total_vins, closed_vins, nok_vins, drr_percent, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_vins = VALUES(total_vins),
        closed_vins = VALUES(closed_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        top_defects = VALUES(top_defects)
    `, [shiftDate, weekNumber, shift, shiftLetter,
        totalVins, closedVins, nokVins, drrPercent, JSON.stringify(topDefects)]);

    console.log(`[DRR PIP snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) → ${drrPercent}% (${closedVins}/${totalVins})`);
  } catch (err) {
    console.error('[DRR PIP snapshot] ошибка сохранения:', err.message);
  }
}

/* Проверка и сохранение смены */
async function checkAndSaveDrrPipSnapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShift();
    const [existing] = await notesPool.query(
      'SELECT id FROM drr_pip_snapshots WHERE shift_date = ? AND shift = ?',
      [shiftDate, shift]
    );
    if (existing.length === 0) {
      await saveDrrPipSnapshot(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR PIP snapshot] ошибка проверки смены:', err.message);
  }
}

/* Проверка и сохранение суток */
async function checkAndSaveDrrPipDailySnapshot() {
  try {
    const dayDate = getCompletedDayDate();
    const [existing] = await notesPool.query(
      `SELECT id FROM drr_pip_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (existing.length === 0) {
      await saveDrrPipSnapshot(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR PIP snapshot] ошибка проверки суток:', err.message);
  }
}

setInterval(() => {
  checkAndSaveDrrPipSnapshot();
  checkAndSaveDrrPipDailySnapshot();
}, 60 * 1000);
checkAndSaveDrrPipSnapshot();
checkAndSaveDrrPipDailySnapshot();

/* Хелпер: дозаполнить week_number / shift_letter */
function enrichPipSnapshot(r) {
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
    snapshotTime: r.snapshot_time,
    totalVins: r.total_vins,
    closedVins: r.closed_vins,
    nokVins: r.nok_vins,
    drrPercent: Number(r.drr_percent),
  };
}

/* ЭНДПОИНТ: список снимков */
app.get('/api/drr-pip-snapshots', async (req, res) => {
  try {
    const { days = 14 } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);

    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, snapshot_time,
             total_vins, closed_vins, nok_vins, drr_percent
      FROM drr_pip_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY shift_date DESC,
        FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays]);

    res.json(rows.map(enrichPipSnapshot));
  } catch (err) {
    console.error('Ошибка /api/drr-pip-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ЭНДПОИНТ: один снимок с top_defects */
app.get('/api/drr-pip-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query(
      'SELECT * FROM drr_pip_snapshots WHERE id = ?',
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
      ...enrichPipSnapshot(r),
      topDefects,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-pip-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});
