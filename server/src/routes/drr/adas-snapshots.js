// DRR ADAS — снимки смен (фоновое сохранение и маршруты).
// Код перенесён из server.js без изменений.

const { getWeekNumberForDate } = require('../../lib/shared');
const { getCompletedDayDate, getShiftLetterForSnapshot } = require('../../lib/shifts');
const { app } = require('../../app');
const { notesPool, pool } = require('../../db');
const { ADAS_DEFECT_POSTS_STR, classifyAdasVins, getAdasTladasVins } = require('./adas');

/* ====================================================================== */
/* ================== DRR ADAS — СНИМКИ СМЕН ============================ */
/* ====================================================================== */

function getLastCompletedShiftAdas() {
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

function getShiftRangeAdas(shiftDate, shift) {
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

async function saveDrrAdasSnapshot(shiftDate, shift) {
  try {
    const range = getShiftRangeAdas(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDate(shiftDate);
    const shiftLetter = getShiftLetterForSnapshot(shift, weekNumber);

    const { vins: tladRows, totalRecords } = await getAdasTladasVins(range.start, range.end);
    const totalVins = tladRows.length;

    let closedVins = 0, nokVins = 0, drrPercent = 0, topDefects = [];

    if (totalVins > 0) {
      const { okSet, nokSet } = await classifyAdasVins(tladRows);
      closedVins = okSet.size;
      nokVins = nokSet.size;
      drrPercent = Math.round((closedVins / totalVins) * 1000) / 10;

      const firstTladByVin = new Map(tladRows.map(r => [r.vin, r.tlad_first_time]));
      const nokVinsList = [...nokSet];

      if (nokVinsList.length > 0) {
        const ph = nokVinsList.map(() => '?').join(',');
        const [defectRows] = await pool.query(`
          SELECT d.VIN, wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE, d.STATUS, d.LAST_MODIFIED_TIME
          FROM at_qm_defect_info d
          LEFT JOIN work_order wo ON wo.VIN = d.VIN
          WHERE d.VIN IN (${ph})
            AND d.POST_NAME IN (${ADAS_DEFECT_POSTS_STR})
        `, nokVinsList);

        const map = new Map();
        defectRows.forEach(d => {
          const firstTlad = firstTladByVin.get(d.VIN);
          if (!firstTlad) return;
          const tladMs = new Date(firstTlad).getTime();
          const reworkMs = d.LAST_MODIFIED_TIME ? new Date(d.LAST_MODIFIED_TIME).getTime() : null;
          const isClosed = d.STATUS && d.STATUS.toUpperCase() === 'CLOSED';

          let isNok = false;
          if (reworkMs !== null) { if (reworkMs > tladMs) isNok = true; }
          else { if (!isClosed) isNok = true; }
          if (!isNok) return;

          const mpp = `${d.MODEL || '—'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`
            .replace(/\s+/g, ' ').trim();

          if (!map.has(mpp)) {
            map.set(mpp, {
              mpp,
              model: d.MODEL || '',
              part_name: d.PART_NAME || '',
              problem_type: d.PROBLEM_TYPE || '',
              defectCount: 0,
            });
          }
          map.get(mpp).defectCount += 1;
        });

        topDefects = [...map.values()]
          .sort((a, b) => b.defectCount - a.defectCount);
          
      }
    }

    await notesPool.query(`
      INSERT INTO drr_adas_snapshots
        (shift_date, week_number, shift, shift_letter,
         total_records, total_vins, closed_vins, nok_vins, drr_percent, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_records = VALUES(total_records),
        total_vins = VALUES(total_vins),
        closed_vins = VALUES(closed_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        top_defects = VALUES(top_defects)
    `, [shiftDate, weekNumber, shift, shiftLetter,
        totalRecords, totalVins, closedVins, nokVins, drrPercent, JSON.stringify(topDefects)]);

    console.log(`[DRR ADAS snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) → ${drrPercent}% (${closedVins}/${totalVins})`);
  } catch (err) {
    console.error('[DRR ADAS snapshot] ошибка сохранения:', err.message);
  }
}

async function checkAndSaveDrrAdasSnapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShiftAdas();
    const [existing] = await notesPool.query(
      'SELECT id FROM drr_adas_snapshots WHERE shift_date = ? AND shift = ?',
      [shiftDate, shift]
    );
    if (existing.length === 0) {
      await saveDrrAdasSnapshot(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR ADAS snapshot] ошибка проверки смены:', err.message);
  }
}

async function checkAndSaveDrrAdasDailySnapshot() {
  try {
    const dayDate = getCompletedDayDate();
    const [existing] = await notesPool.query(
      `SELECT id FROM drr_adas_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (existing.length === 0) {
      await saveDrrAdasSnapshot(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR ADAS snapshot] ошибка проверки суток:', err.message);
  }
}

setInterval(() => {
  checkAndSaveDrrAdasSnapshot();
  checkAndSaveDrrAdasDailySnapshot();
}, 60 * 1000);
checkAndSaveDrrAdasSnapshot();
checkAndSaveDrrAdasDailySnapshot();

/* ====================================================================== */
/* ХЕЛПЕР: дозаполнить week_number / shift_letter, если их нет в БД       */
/* ====================================================================== */
function enrichAdasSnapshot(r) {
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
    totalRecords: r.total_records,
    totalVins: r.total_vins,
    closedVins: r.closed_vins,
    nokVins: r.nok_vins,
    drrPercent: Number(r.drr_percent),
  };
}

/* ====================================================================== */
/* ЭНДПОИНТ: список снимков                                               */
/* ====================================================================== */
app.get('/api/drr-tl-snapshots', async (req, res) => {
  try {
    const { days = 14 } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);

    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, snapshot_time,
             total_records, total_vins, closed_vins, nok_vins, drr_percent
      FROM drr_adas_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY shift_date DESC,
        FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays]);

    res.json(rows.map(enrichAdasSnapshot));
  } catch (err) {
    console.error('Ошибка /api/drr-tl-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ: один снимок с top_defects                                    */
/* ====================================================================== */
app.get('/api/drr-tl-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query(
      'SELECT * FROM drr_adas_snapshots WHERE id = ?',
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
      ...enrichAdasSnapshot(r),
      topDefects,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-tl-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});
