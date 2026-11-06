// DRR PIP: маршруты и снимки смен.
// Код перенесён из server.js без изменений.

const { getWeekNumberForDate } = require('../../lib/shared');
const { app } = require('../../app');
const { mesPool, notesPool, pool } = require('../../db');
const { getCompletedDayDate, getShiftLetterForSnapshot } = require('./cp7-snapshots');

// ================== PIP DRR DASHBOARD ==================

const PIP_DEFECT_POSTS = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
const PIP_DEFECT_POSTS_STR = PIP_DEFECT_POSTS.map(p => `'${p}'`).join(',');

// 1. Основной DRR
app.get('/api/drr-pip-dashboard', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const [pip9Rows] = await mesPool.query(`
      SELECT DISTINCT vin
      FROM ti_mes_movement
      WHERE uloc_no = 'AGMAS01003'
        AND scan_time >= ? AND scan_time <= ?
        AND is_deleted = 0
    `, [startTime, endTime]);

    if (pip9Rows.length === 0) {
      return res.json({ totalVins: 0, closedVins: 0, drrPercent: 0 });
    }

    const vins = pip9Rows.map(r => r.vin);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT d.VIN, d.STATUS
      FROM at_qm_defect_info d
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${PIP_DEFECT_POSTS_STR})
    `, vins);

    const nokSet = new Set();
    defectRows.forEach(row => {
      if (!row.STATUS || row.STATUS.toLowerCase() !== 'closed') {
        nokSet.add(row.VIN);
      }
    });

    const closedVins = vins.length - nokSet.size;
    const drrPercent = vins.length > 0 ? (closedVins / vins.length) * 100 : 0;

    res.json({
      totalVins: vins.length,
      closedVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
    });
  } catch (err) {
    console.error('Ошибка DRR PIP Dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. Топ дефектов — теперь с model / part_name / problem_type
app.get('/api/drr-pip-top-defects', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const [pip9Rows] = await mesPool.query(`
      SELECT DISTINCT vin
      FROM ti_mes_movement
      WHERE uloc_no = 'AGMAS01003'
        AND scan_time >= ? AND scan_time <= ?
        AND is_deleted = 0
    `, [startTime, endTime]);

    if (pip9Rows.length === 0) return res.json([]);

    const vins = pip9Rows.map(r => r.vin);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE,
        d.STATUS
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${PIP_DEFECT_POSTS_STR})
    `, vins);

    const nokSet = new Set();
    defectRows.forEach(row => {
      if (!row.STATUS || row.STATUS.toLowerCase() !== 'closed') {
        nokSet.add(row.VIN);
      }
    });

    if (nokSet.size === 0) return res.json([]);

    const defectGroupMap = new Map();
    defectRows.forEach(row => {
      if (!nokSet.has(row.VIN)) return;
      if (row.STATUS && row.STATUS.toLowerCase() === 'closed') return;

      const mpp = `${row.MODEL || '-'} ${row.PART_NAME || ''} ${row.PROBLEM_TYPE || ''}`.trim();
      if (!defectGroupMap.has(mpp)) {
        defectGroupMap.set(mpp, {
          mpp,
          model: row.MODEL || '',
          part_name: row.PART_NAME || '',
          problem_type: row.PROBLEM_TYPE || '',
          grade: row.PROBLEM_GRADE || '-',
          defectCount: 0,
        });
      }
      defectGroupMap.get(mpp).defectCount += 1;
    });

    const topDefects = Array.from(defectGroupMap.values())
      .map(d => ({
        mpp: d.mpp,
        model: d.model,
        part_name: d.part_name,
        problem_type: d.problem_type,
        grade: d.grade,
        defectCount: d.defectCount,
      }))
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(topDefects);
  } catch (err) {
    console.error('Ошибка DRR PIP Top Defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. Список VIN OK/NOK
app.get('/api/drr-pip-vins', async (req, res) => {
  try {
    const { startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    const [pip9Rows] = await mesPool.query(`
      SELECT vin, MIN(scan_time) AS pip9_time
      FROM ti_mes_movement
      WHERE uloc_no = 'AGMAS01003'
        AND scan_time >= ? AND scan_time <= ?
        AND is_deleted = 0
      GROUP BY vin
    `, [startTime, endTime]);

    if (pip9Rows.length === 0) return res.json([]);

    const vins = pip9Rows.map(r => r.vin);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT d.VIN, d.STATUS
      FROM at_qm_defect_info d
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${PIP_DEFECT_POSTS_STR})
    `, vins);

    const nokSet = new Set();
    defectRows.forEach(row => {
      if (!row.STATUS || row.STATUS.toLowerCase() !== 'closed') {
        nokSet.add(row.VIN);
      }
    });

    const selectedVins = pip9Rows.filter(row => {
      const isNok = nokSet.has(row.vin);
      if (status === 'NOK') return isNok;
      if (status === 'OK') return !isNok;
      return false;
    });

    const modelMap = new Map();
    if (selectedVins.length > 0) {
      const selPlaceholders = selectedVins.map(() => '?').join(',');
      const [modelRows] = await pool.query(`
        SELECT VIN, MODEL FROM work_order WHERE VIN IN (${selPlaceholders})
      `, selectedVins.map(r => r.vin));
      modelRows.forEach(r => modelMap.set(r.VIN, r.MODEL));
    }

    const result = selectedVins.map(r => ({
      vin: r.vin,
      model: modelMap.get(r.vin) || '-',
      pip9_time: r.pip9_time,
    })).sort((a, b) => new Date(a.pip9_time) - new Date(b.pip9_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-pip-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. VIN'ы по конкретному MPP
app.get('/api/drr-pip-mpp-vins', async (req, res) => {
  try {
    const { startTime, endTime, model, part_name = '', problem_type = '' } = req.query;

    if (!startTime || !endTime || !model) {
      return res.status(400).json({ error: 'startTime, endTime и model обязательны' });
    }

    const [pip9Rows] = await mesPool.query(`
      SELECT vin, MIN(scan_time) AS pip9_time
      FROM ti_mes_movement
      WHERE uloc_no = 'AGMAS01003'
        AND scan_time >= ? AND scan_time <= ?
        AND is_deleted = 0
      GROUP BY vin
    `, [startTime, endTime]);

    if (pip9Rows.length === 0) return res.json([]);

    const pip9TimeByVin = new Map(pip9Rows.map(r => [r.vin, r.pip9_time]));
    const vins = pip9Rows.map(r => r.vin);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT d.VIN, d.STATUS
      FROM at_qm_defect_info d
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${PIP_DEFECT_POSTS_STR})
    `, vins);

    const nokSet = new Set();
    defectRows.forEach(row => {
      if (!row.STATUS || row.STATUS.toLowerCase() !== 'closed') {
        nokSet.add(row.VIN);
      }
    });

    const nokVins = [...nokSet];
    if (nokVins.length === 0) return res.json([]);

    const ph = nokVins.map(() => '?').join(',');
    let whereClause = `d.VIN IN (${ph}) AND d.POST_NAME IN (${PIP_DEFECT_POSTS_STR}) AND wo.MODEL = ?`;
    const params = [...nokVins, model];

    if (part_name !== '' || problem_type !== '') {
      whereClause += ` AND d.PART_NAME = ? AND d.PROBLEM_TYPE = ?`;
      params.push(part_name, problem_type);
    } else {
      whereClause += ` AND (d.PART_NAME IS NULL OR TRIM(d.PART_NAME) = '') AND (d.PROBLEM_TYPE IS NULL OR TRIM(d.PROBLEM_TYPE) = '')`;
    }

    const [matchedDefects] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE,
        d.STATUS
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE ${whereClause}
    `, params);

    const vinMap = new Map();
    matchedDefects.forEach(d => {
      if (!nokSet.has(d.VIN)) return; // только NOK
      if (!vinMap.has(d.VIN)) {
        vinMap.set(d.VIN, {
          vin: d.VIN,
          model: d.MODEL || '—',
          grade: d.PROBLEM_GRADE || '—',
          status: d.STATUS || '',
          pip9_time: pip9TimeByVin.get(d.VIN) || null,
        });
      }
    });

    const result = Array.from(vinMap.values())
      .sort((a, b) => new Date(a.pip9_time) - new Date(b.pip9_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-pip-mpp-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
