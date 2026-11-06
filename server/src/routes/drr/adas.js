// DRR ADAS (TLADAS): маршруты и снимки смен.
// Код перенесён из server.js без изменений.

const { getWeekNumberForDate } = require('../../lib/shared');
const { app } = require('../../app');
const { mesPool, notesPool, pool } = require('../../db');
const { getCompletedDayDate, getShiftLetterForSnapshot } = require('./cp7-snapshots');

/* ====================================================================== */
/* ===================== DRR ADAS (TLADAS) ============================== */
/* ====================================================================== */

const ADAS_DEFECT_POSTS = [
  '360', 'ADAS', 'ADAS+RB', 'WA'
];
const ADAS_DEFECT_POSTS_STR = ADAS_DEFECT_POSTS.map(p => `'${p}'`).join(',');

/* ---------------------------------------------------------------------- */
/* Хелпер: VIN + два времени TLADAS + общее число записей TLADAS          */
/* ---------------------------------------------------------------------- */
async function getAdasTladasVins(startTime, endTime) {
  const [rows] = await mesPool.query(`
    SELECT
      vin,
      MIN(gmt_create) AS tlad_first_time,
      MAX(gmt_create) AS tlad_last_time
    FROM tm_vhc_test_line_movement
    WHERE node_nature = 'TLADAS'
      AND is_deleted = 0
      AND gmt_create >= ? AND gmt_create <= ?
    GROUP BY vin
  `, [startTime, endTime]);

  const [countRows] = await mesPool.query(`
    SELECT COUNT(*) AS total_records
    FROM tm_vhc_test_line_movement
    WHERE node_nature = 'TLADAS'
      AND is_deleted = 0
      AND gmt_create >= ? AND gmt_create <= ?
  `, [startTime, endTime]);

  const totalRecords = Number(countRows[0]?.total_records) || 0;

  const vins = rows.map(r => ({
    vin: r.vin,
    tlad_first_time: r.tlad_first_time,
    tlad_last_time:  r.tlad_last_time,
  }));

  return { vins, totalRecords };
}

/* ---------------------------------------------------------------------- */
/* Хелпер: классификация VIN (OK / NOK) по LAST_MODIFIED_TIME             */
/* ---------------------------------------------------------------------- */
async function classifyAdasVins(tladRows) {
  const okSet = new Set();
  const nokSet = new Set();
  const vins = tladRows.map(r => r.vin);

  vins.forEach(v => okSet.add(v));

  if (vins.length === 0) return { okSet, nokSet };

  const firstTladByVin = new Map(tladRows.map(r => [r.vin, r.tlad_first_time]));
  const ph = vins.map(() => '?').join(',');

  const [defectRows] = await pool.query(`
    SELECT VIN, STATUS, LAST_MODIFIED_TIME
    FROM at_qm_defect_info
    WHERE VIN IN (${ph})
      AND POST_NAME IN (${ADAS_DEFECT_POSTS_STR})
  `, vins);

  defectRows.forEach(d => {
    const firstTlad = firstTladByVin.get(d.VIN);
    if (!firstTlad) return;

    const tladMs = new Date(firstTlad).getTime();
    const reworkMs = d.LAST_MODIFIED_TIME ? new Date(d.LAST_MODIFIED_TIME).getTime() : null;
    const isClosed = d.STATUS && d.STATUS.toUpperCase() === 'CLOSED';

    let isNok = false;
    if (reworkMs !== null) {
      if (reworkMs > tladMs) isNok = true;
    } else {
      if (!isClosed) isNok = true;
    }

    if (isNok) {
      nokSet.add(d.VIN);
      okSet.delete(d.VIN);
    }
  });

  return { okSet, nokSet };
}

/* ====================================================================== */
/* ЭНДПОИНТ 1: главные цифры                                              */
/* ====================================================================== */
app.get('/api/drr-tl-dashboard', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const { vins: tladRows, totalRecords } = await getAdasTladasVins(startTime, endTime);
    const totalVins = tladRows.length;

    if (totalVins === 0) {
      return res.json({
        totalRecords,
        totalVins: 0,
        closedVins: 0,
        nokVins: 0,
        drrPercent: 0,
      });
    }

    const { okSet, nokSet } = await classifyAdasVins(tladRows);
    const closedVins = okSet.size;
    const nokVins = nokSet.size;
    const drrPercent = totalVins > 0 ? (closedVins / totalVins) * 100 : 0;

    res.json({
      totalRecords,
      totalVins,
      closedVins,
      nokVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-tl-dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 2: список VIN для модалки (status: OK | NOK | ALL)            */
/* ====================================================================== */
app.get('/api/drr-tl-vins', async (req, res) => {
  try {
    const { startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    const { vins: tladRows } = await getAdasTladasVins(startTime, endTime);
    if (tladRows.length === 0) return res.json([]);

    const lastTladByVin = new Map(tladRows.map(r => [r.vin, r.tlad_last_time]));

    const { okSet, nokSet } = await classifyAdasVins(tladRows);

    let vins;
    if (status === 'OK') {
      vins = [...okSet];
    } else if (status === 'NOK') {
      vins = [...nokSet];
    } else if (status === 'ALL') {
      vins = tladRows.map(r => r.vin);
    } else {
      return res.status(400).json({ error: 'Неизвестный status' });
    }

    if (vins.length === 0) return res.json([]);

    const ph = vins.map(() => '?').join(',');
    const [modelRows] = await pool.query(`
      SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})
    `, vins);
    const modelByVin = new Map(modelRows.map(r => [r.VIN, r.MODEL || '—']));

    const result = vins.map(vin => ({
      vin,
      model: modelByVin.get(vin) || '—',
      tlad_time: lastTladByVin.get(vin) || null,
    })).sort((a, b) => new Date(a.tlad_time) - new Date(b.tlad_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-tl-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 3: топ дефектов у NOK VIN                                     */
/* — теперь возвращаем model / part_name / problem_type                   */
/* ====================================================================== */
app.get('/api/drr-tl-top-defects', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const { vins: tladRows } = await getAdasTladasVins(startTime, endTime);
    if (tladRows.length === 0) return res.json([]);

    const firstTladByVin = new Map(tladRows.map(r => [r.vin, r.tlad_first_time]));
    const { nokSet } = await classifyAdasVins(tladRows);
    const nokVins = [...nokSet];

    if (nokVins.length === 0) return res.json([]);

    const ph = nokVins.map(() => '?').join(',');
    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE,
        d.STATUS,
        d.LAST_MODIFIED_TIME
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.VIN IN (${ph})
        AND d.POST_NAME IN (${ADAS_DEFECT_POSTS_STR})
    `, nokVins);

    const map = new Map();
    defectRows.forEach(d => {
      const firstTlad = firstTladByVin.get(d.VIN);
      if (!firstTlad) return;
      const tladMs = new Date(firstTlad).getTime();
      const reworkMs = d.LAST_MODIFIED_TIME ? new Date(d.LAST_MODIFIED_TIME).getTime() : null;
      const isClosed = d.STATUS && d.STATUS.toUpperCase() === 'CLOSED';

      let isNok = false;
      if (reworkMs !== null) {
        if (reworkMs > tladMs) isNok = true;
      } else {
        if (!isClosed) isNok = true;
      }
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

    const result = [...map.values()]
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-tl-top-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 4: VIN'ы по конкретному MPP                                   */
/* ====================================================================== */
app.get('/api/drr-tl-mpp-vins', async (req, res) => {
  try {
    const { startTime, endTime, model, part_name = '', problem_type = '' } = req.query;

    if (!startTime || !endTime || !model) {
      return res.status(400).json({ error: 'startTime, endTime и model обязательны' });
    }

    const { vins: tladRows } = await getAdasTladasVins(startTime, endTime);
    if (tladRows.length === 0) return res.json([]);

    const firstTladByVin = new Map(tladRows.map(r => [r.vin, r.tlad_first_time]));
    const lastTladByVin = new Map(tladRows.map(r => [r.vin, r.tlad_last_time]));
    const { nokSet } = await classifyAdasVins(tladRows);
    const nokVins = [...nokSet];

    if (nokVins.length === 0) return res.json([]);

    const ph = nokVins.map(() => '?').join(',');

    let whereClause = `d.VIN IN (${ph}) AND d.POST_NAME IN (${ADAS_DEFECT_POSTS_STR}) AND wo.MODEL = ?`;
    const params = [...nokVins, model];

    if (part_name !== '' || problem_type !== '') {
      whereClause += ` AND d.PART_NAME = ? AND d.PROBLEM_TYPE = ?`;
      params.push(part_name, problem_type);
    } else {
      whereClause += ` AND (d.PART_NAME IS NULL OR TRIM(d.PART_NAME) = '') AND (d.PROBLEM_TYPE IS NULL OR TRIM(d.PROBLEM_TYPE) = '')`;
    }

    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE,
        d.STATUS,
        d.LAST_MODIFIED_TIME
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE ${whereClause}
    `, params);

    const vinMap = new Map();
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

      const existing = vinMap.get(d.VIN);
      const reworkTimeMs = reworkMs || 0;
      if (!existing || reworkTimeMs > existing._reworkMs) {
        vinMap.set(d.VIN, {
          vin: d.VIN,
          model: d.MODEL || '—',
          grade: d.PROBLEM_GRADE || '—',
          status: d.STATUS || '',
          last_modified: d.LAST_MODIFIED_TIME || null,
          tlad_time: lastTladByVin.get(d.VIN) || null,
          _reworkMs: reworkTimeMs,
        });
      }
    });

    const result = Array.from(vinMap.values())
      .map(({ _reworkMs, ...v }) => v)
      .sort((a, b) => new Date(a.tlad_time) - new Date(b.tlad_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-tl-mpp-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
