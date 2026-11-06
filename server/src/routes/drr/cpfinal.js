// DRR CPFinal: маршруты и снимки смен.
// Код перенесён из server.js без изменений.

const { getWeekNumberForDate } = require('../../lib/shared');
const { app } = require('../../app');
const { mesPool, notesPool, pool } = require('../../db');
const { getCompletedDayDate, getShiftLetterForSnapshot } = require('./cp7-snapshots');

/* ====================================================================== */
/* ===================== DRR CPFinal ==================================== */
/* ====================================================================== */

const CPFINAL_DEFECT_POSTS = [
  'TLTT', 'CP8', 'TLADAS', 'TLWA', 'TLRT', 'CPA',
  'CP8 Gate', 'CP8-gate',
  'TEST TRACK', 'TRACK', 'WT', 'REPAIR VERIFICATION'
];
const CPFINAL_DEFECT_POSTS_STR = CPFINAL_DEFECT_POSTS.map(p => `'${p}'`).join(',');

const CPFINAL_GRACE_MS = 20 * 60 * 1000;

/* Хелпер: NOK дефекта для CPFinal.
   - есть REPAIR_TIME / REPAIR_TIME1 (берём самое раннее):
     NOK, если оно > TLTT + 20 мин; иначе OK
   - нет времени: NOK, если статус != closed; иначе OK
   LAST_MODIFIED_TIME НЕ используем. */
function isDefectNokCpFinal(defectRow, tlttMs) {
  const repairTimes = [defectRow.REPAIR_TIME, defectRow.REPAIR_TIME1]
    .filter(t => t != null && t !== '')
    .map(t => new Date(t).getTime())
    .filter(t => !Number.isNaN(t));

  const threshold = tlttMs + CPFINAL_GRACE_MS;

  if (repairTimes.length > 0) {
    return Math.min(...repairTimes) > threshold;
  }

  const isClosed = defectRow.STATUS && defectRow.STATUS.toUpperCase() === 'CLOSED';
  return !isClosed;
}

/* ---------------------------------------------------------------------- */
/* Хелпер: VIN + два времени TLTT + общее число записей TLTT              */
/* ---------------------------------------------------------------------- */
async function getCpFinalTlttVins(startTime, endTime) {
  const [rows] = await mesPool.query(`
    SELECT
      vin,
      MIN(gmt_create) AS tltt_first_time,
      MAX(gmt_create) AS tltt_last_time
    FROM tm_vhc_test_line_movement
    WHERE node_nature = 'TLTT'
      AND is_deleted = 0
      AND gmt_create >= ? AND gmt_create <= ?
    GROUP BY vin
  `, [startTime, endTime]);

  const [countRows] = await mesPool.query(`
    SELECT COUNT(*) AS total_records
    FROM tm_vhc_test_line_movement
    WHERE node_nature = 'TLTT'
      AND is_deleted = 0
      AND gmt_create >= ? AND gmt_create <= ?
  `, [startTime, endTime]);

  const totalRecords = Number(countRows[0]?.total_records) || 0;

  const vins = rows.map(r => ({
    vin: r.vin,
    tltt_first_time: r.tltt_first_time,
    tltt_last_time:  r.tltt_last_time,
  }));

  return { vins, totalRecords };
}

/* ---------------------------------------------------------------------- */
/* Хелпер: классификация VIN (OK / NOK) — новая логика                    */
/* ---------------------------------------------------------------------- */
async function classifyCpFinalVins(tlttRows) {
  const okSet = new Set();
  const nokSet = new Set();
  const vins = tlttRows.map(r => r.vin);

  vins.forEach(v => okSet.add(v));
  if (vins.length === 0) return { okSet, nokSet };

  const firstTlttByVin = new Map(tlttRows.map(r => [r.vin, r.tltt_first_time]));
  const ph = vins.map(() => '?').join(',');

  const [defectRows] = await pool.query(`
    SELECT
      VIN, STATUS,
      REPAIR_TIME, REPAIR_TIME1
    FROM at_qm_defect_info
    WHERE VIN IN (${ph})
      AND POST_NAME IN (${CPFINAL_DEFECT_POSTS_STR})
  `, vins);

  defectRows.forEach(d => {
    const tlttFirst = firstTlttByVin.get(d.VIN);
    if (!tlttFirst) return;

    const tlttMs = new Date(tlttFirst).getTime();
    if (isDefectNokCpFinal(d, tlttMs)) {
      nokSet.add(d.VIN);
      okSet.delete(d.VIN);
    }
  });

  return { okSet, nokSet };
}

/* ====================================================================== */
/* ЭНДПОИНТ 1: главные цифры                                              */
/* ====================================================================== */
app.get('/api/drr-cpfinal-dashboard', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const { vins: tlttRows, totalRecords } = await getCpFinalTlttVins(startTime, endTime);
    const totalVins = tlttRows.length;

    if (totalVins === 0) {
      return res.json({ totalRecords, totalVins: 0, okVins: 0, nokVins: 0, drrPercent: 0 });
    }

    const { okSet, nokSet } = await classifyCpFinalVins(tlttRows);
    const okVins = okSet.size;
    const nokVins = nokSet.size;
    const drrPercent = totalVins > 0 ? (okVins / totalVins) * 100 : 0;

    res.json({
      totalRecords,
      totalVins,
      okVins,
      nokVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-cpfinal-dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 2: список VIN для модалки                                     */
/* ====================================================================== */
app.get('/api/drr-cpfinal-vins', async (req, res) => {
  try {
    const { startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    const { vins: tlttRows } = await getCpFinalTlttVins(startTime, endTime);
    if (tlttRows.length === 0) return res.json([]);

    const lastTlttByVin = new Map(tlttRows.map(r => [r.vin, r.tltt_last_time]));
    const { okSet, nokSet } = await classifyCpFinalVins(tlttRows);

    let vins;
    if (status === 'ALL') vins = tlttRows.map(r => r.vin);
    else if (status === 'OK') vins = [...okSet];
    else if (status === 'NOK') vins = [...nokSet];
    else return res.status(400).json({ error: 'Неизвестный status' });

    if (vins.length === 0) return res.json([]);

    const ph = vins.map(() => '?').join(',');
    const [modelRows] = await pool.query(`
      SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})
    `, vins);
    const modelByVin = new Map(modelRows.map(r => [r.VIN, r.MODEL || '—']));

    const result = vins.map(vin => ({
      vin,
      model: modelByVin.get(vin) || '—',
      tltt_time: lastTlttByVin.get(vin) || null,
    })).sort((a, b) => new Date(a.tltt_time) - new Date(b.tltt_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cpfinal-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 3: топ дефектов                                               */
/* ====================================================================== */
app.get('/api/drr-cpfinal-top-defects', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const { vins: tlttRows } = await getCpFinalTlttVins(startTime, endTime);
    if (tlttRows.length === 0) return res.json([]);

    const firstTlttByVin = new Map(tlttRows.map(r => [r.vin, r.tltt_first_time]));
    const { nokSet } = await classifyCpFinalVins(tlttRows);
    const nokVins = [...nokSet];
    if (nokVins.length === 0) return res.json([]);

    const ph = nokVins.map(() => '?').join(',');
    const [defectRows] = await pool.query(`
      SELECT
        d.VIN, wo.MODEL,
        d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE,
        d.PROBLEM_DESCRIPTION,
        d.STATUS,
        d.REPAIR_TIME, d.REPAIR_TIME1
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.VIN IN (${ph})
        AND d.POST_NAME IN (${CPFINAL_DEFECT_POSTS_STR})
    `, nokVins);

    const map = new Map();
    defectRows.forEach(d => {
      const tlttFirst = firstTlttByVin.get(d.VIN);
      if (!tlttFirst) return;
      const tlttMs = new Date(tlttFirst).getTime();
      if (!isDefectNokCpFinal(d, tlttMs)) return;

      const model = d.MODEL || '—';
      const part = (d.PART_NAME || '').trim();
      const problem = (d.PROBLEM_TYPE || '').trim();
      const desc = (d.PROBLEM_DESCRIPTION || '').trim();

      let mpp;
      if (!part && !problem) {
        mpp = desc ? `${model} ${desc}`.replace(/\s+/g, ' ').trim() : `${model} (Без описания)`;
      } else {
        mpp = `${model} ${part} ${problem}`.replace(/\s+/g, ' ').trim();
      }

      // Ключ для группировки, чтобы разные описания не склеивались
      const mppKey = `${model}|${part}|${problem}|${desc}`;

      if (!map.has(mppKey)) {
        map.set(mppKey, {
          mpp,
          model: model,
          part_name: part,
          problem_type: problem,
          problem_description: desc, // <-- Добавили в ответ
          defectCount: 0,
        });
      }
      map.get(mppKey).defectCount += 1;
    });

    const result = [...map.values()]
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cpfinal-top-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 4: VIN'ы по конкретному MPP                                   */
/* ====================================================================== */
app.get('/api/drr-cpfinal-mpp-vins', async (req, res) => {
  try {
    const { startTime, endTime, model, part_name = '', problem_type = '', problem_description = '' } = req.query;

    if (!startTime || !endTime || !model) {
      return res.status(400).json({ error: 'startTime, endTime и model обязательны' });
    }

    const { vins: tlttRows } = await getCpFinalTlttVins(startTime, endTime);
    if (tlttRows.length === 0) return res.json([]);

    const firstTlttByVin = new Map(tlttRows.map(r => [r.vin, r.tltt_first_time]));
    const lastTlttByVin = new Map(tlttRows.map(r => [r.vin, r.tltt_last_time]));
    const { nokSet } = await classifyCpFinalVins(tlttRows);
    const nokVins = [...nokSet];

    if (nokVins.length === 0) return res.json([]);

    const ph = nokVins.map(() => '?').join(',');

    let whereClause = `d.VIN IN (${ph}) AND d.POST_NAME IN (${CPFINAL_DEFECT_POSTS_STR}) AND wo.MODEL = ?`;
    const params = [...nokVins, model];

    if (part_name === '' && problem_type === '') {
      whereClause += ` AND (d.PART_NAME IS NULL OR TRIM(d.PART_NAME) = '') AND (d.PROBLEM_TYPE IS NULL OR TRIM(d.PROBLEM_TYPE) = '')`;
      if (problem_description !== '') {
        whereClause += ` AND d.PROBLEM_DESCRIPTION = ?`;
        params.push(problem_description);
      } else {
        whereClause += ` AND (d.PROBLEM_DESCRIPTION IS NULL OR TRIM(d.PROBLEM_DESCRIPTION) = '')`;
      }
    } else {
      whereClause += ` AND d.PART_NAME = ? AND d.PROBLEM_TYPE = ?`;
      params.push(part_name, problem_type);
    }

    const [defectRows] = await pool.query(`
      SELECT
        d.VIN, wo.MODEL,
        d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE,
        d.PROBLEM_DESCRIPTION,
        d.STATUS, d.CREATION_TIME,
        d.REPAIR_TIME, d.REPAIR_TIME1
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE ${whereClause}
    `, params);

    const vinMap = new Map();
    defectRows.forEach(d => {
      const tlttFirst = firstTlttByVin.get(d.VIN);
      if (!tlttFirst) return;
      const tlttMs = new Date(tlttFirst).getTime();
      if (!isDefectNokCpFinal(d, tlttMs)) return;

      const repairTimes = [d.REPAIR_TIME, d.REPAIR_TIME1]
        .filter(t => t != null && t !== '')
        .map(t => new Date(t).getTime())
        .filter(t => !Number.isNaN(t));
      const repairMs = repairTimes.length > 0 ? Math.min(...repairTimes) : null;

      const existing = vinMap.get(d.VIN);
      const defectTimeMs = new Date(d.CREATION_TIME).getTime();
      if (!existing || defectTimeMs > existing._defectTimeMs) {
        vinMap.set(d.VIN, {
          vin: d.VIN,
          model: d.MODEL || '—',
          grade: d.PROBLEM_GRADE || '—',
          status: d.STATUS || '',
          defect_time: d.CREATION_TIME,
          repair_time: repairMs ? new Date(repairMs).toISOString() : null,
          tltt_time: lastTlttByVin.get(d.VIN) || null,
          _defectTimeMs: defectTimeMs,
        });
      }
    });

    const result = Array.from(vinMap.values())
      .map(({ _defectTimeMs, ...v }) => v)
      .sort((a, b) => new Date(a.tltt_time) - new Date(b.tltt_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cpfinal-mpp-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ============== DRR CPFINAL — СНИМКИ СМЕН ============================ */
/* ====================================================================== */

function getLastCompletedShiftCpFinal() {
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

function getShiftRangeCpFinal(shiftDate, shift) {
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

async function saveDrrCpFinalSnapshot(shiftDate, shift) {
  try {
    const range = getShiftRangeCpFinal(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDate(shiftDate);
    const shiftLetter = getShiftLetterForSnapshot(shift, weekNumber);

    const { vins: tlttRows, totalRecords } = await getCpFinalTlttVins(range.start, range.end);
    const totalVins = tlttRows.length;

    let okVins = 0, nokVins = 0, drrPercent = 0, topDefects = [];

    if (totalVins > 0) {
      const { okSet, nokSet } = await classifyCpFinalVins(tlttRows);
      okVins = okSet.size;
      nokVins = nokSet.size;
      drrPercent = Math.round((okVins / totalVins) * 1000) / 10;

      const firstTlttByVin = new Map(tlttRows.map(r => [r.vin, r.tltt_first_time]));
      const nokVinsList = [...nokSet];

      if (nokVinsList.length > 0) {
        const ph = nokVinsList.map(() => '?').join(',');
        
        // 1. ДОБАВЛЕНО: d.PROBLEM_DESCRIPTION в SELECT
        const [defectRows] = await pool.query(`
          SELECT
            d.VIN, wo.MODEL,
            d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE,
            d.PROBLEM_DESCRIPTION,
            d.STATUS, d.REPAIR_TIME, d.REPAIR_TIME1
          FROM at_qm_defect_info d
          LEFT JOIN work_order wo ON wo.VIN = d.VIN
          WHERE d.VIN IN (${ph})
            AND d.POST_NAME IN (${CPFINAL_DEFECT_POSTS_STR})
        `, nokVinsList);

        const map = new Map();
        defectRows.forEach(d => {
          const tlttFirst = firstTlttByVin.get(d.VIN);
          if (!tlttFirst) return;
          const tlttMs = new Date(tlttFirst).getTime();
          if (!isDefectNokCpFinal(d, tlttMs)) return;

          const model = d.MODEL || '—';
          const part = (d.PART_NAME || '').trim();
          const problem = (d.PROBLEM_TYPE || '').trim();
          const desc = (d.PROBLEM_DESCRIPTION || '').trim(); // 2. ДОБАВЛЕНО: читаем описание

          // 3. ИЗМЕНЕНО: убрали костыль TS02 WA EC Tool
          let mpp;
          if (!part && !problem) {
            mpp = desc ? `${model} ${desc}`.replace(/\s+/g, ' ').trim() : `${model} (Без описания)`;
          } else {
            mpp = `${model} ${part} ${problem}`.replace(/\s+/g, ' ').trim();
          }

          // Ключ для Map, чтобы разные описания не склеивались в одну строку
          const mppKey = `${model}|${part}|${problem}|${desc}`;

          if (!map.has(mppKey)) {
            map.set(mppKey, { 
              mpp, 
              model, 
              part_name: part, 
              problem_type: problem, 
              problem_description: desc, // 4. ДОБАВЛЕНО: сохраняем в JSON
              defectCount: 0 
            });
          }
          map.get(mppKey).defectCount += 1;
        });

        topDefects = [...map.values()]
          .sort((a, b) => b.defectCount - a.defectCount);
          
      }
    }

    await notesPool.query(`
      INSERT INTO drr_cpfinal_snapshots
        (shift_date, week_number, shift, shift_letter,
         total_records, total_vins, ok_vins, nok_vins, drr_percent, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_records = VALUES(total_records),
        total_vins = VALUES(total_vins),
        ok_vins = VALUES(ok_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        top_defects = VALUES(top_defects)
    `, [shiftDate, weekNumber, shift, shiftLetter,
        totalRecords, totalVins, okVins, nokVins, drrPercent, JSON.stringify(topDefects)]);

    console.log(`[DRR CPFinal snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) → ${drrPercent}% (${okVins}/${totalVins})`);
  } catch (err) {
    console.error('[DRR CPFinal snapshot] ошибка сохранения:', err.message);
  }
}

async function checkAndSaveDrrCpFinalSnapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShiftCpFinal();
    const [existing] = await notesPool.query(
      'SELECT id FROM drr_cpfinal_snapshots WHERE shift_date = ? AND shift = ?',
      [shiftDate, shift]
    );
    if (existing.length === 0) {
      await saveDrrCpFinalSnapshot(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR CPFinal snapshot] ошибка проверки смены:', err.message);
  }
}

async function checkAndSaveDrrCpFinalDailySnapshot() {
  try {
    const dayDate = getCompletedDayDate();
    const [existing] = await notesPool.query(
      `SELECT id FROM drr_cpfinal_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (existing.length === 0) {
      await saveDrrCpFinalSnapshot(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR CPFinal snapshot] ошибка проверки суток:', err.message);
  }
}

setInterval(() => {
  checkAndSaveDrrCpFinalSnapshot();
  checkAndSaveDrrCpFinalDailySnapshot();
}, 60 * 1000);
checkAndSaveDrrCpFinalSnapshot();
checkAndSaveDrrCpFinalDailySnapshot();

/* Хелпер: дозаполнить week_number / shift_letter */
function enrichCpFinalSnapshot(r) {
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
    okVins: r.ok_vins,
    nokVins: r.nok_vins,
    drrPercent: Number(r.drr_percent),
  };
}

app.get('/api/drr-cpfinal-snapshots', async (req, res) => {
  try {
    const { days = 14 } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);

    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, snapshot_time,
             total_records, total_vins, ok_vins, nok_vins, drr_percent
      FROM drr_cpfinal_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY shift_date DESC,
        FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays]);

    res.json(rows.map(enrichCpFinalSnapshot));
  } catch (err) {
    console.error('Ошибка /api/drr-cpfinal-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-cpfinal-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query(
      'SELECT * FROM drr_cpfinal_snapshots WHERE id = ?',
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
      ...enrichCpFinalSnapshot(r),
      topDefects,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-cpfinal-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});
