// DRR CP6 (PSIN/PSOUT/транзит): маршруты и снимки смен.
// Код перенесён из server.js без изменений.

const { app } = require('../../app');
const { mesPool, notesPool, pool } = require('../../db');

/* ====================================================================== */
/* ===================== DRR CP6 (PSIN/PSOUT/TRANSIT) =================== */
/* ====================================================================== */

// Точки
const CP6_PSIN_ULOC    = 'AGMPS01001';   // PSIN — вход в покраску (база NOK)
const CP6_PSOUT_ULOC   = 'AGMPS01002';   // PSOUT — выход из покраски (база OK/DRR)
const CP6_BUFFER_ENTER = 'AGMPS01003';   // PBSIN — вход в буфер
const CP6_BUFFER_EXIT  = 'AGMPS01004';   // PBSOUT — выход из буфера
const CP6_TRIMIN_ULOC  = 'AGMAS01001';   // TRIMIN — вход на сборку

// Окно для «активных на покраске» (System Fill) и для «в переходе PBSOUT → TRIMIN»
const BUFFER_MAX_AGE_DAYS   = 14;
const TRANSIT_MAX_AGE_DAYS  = 30;

const CP6_DEFECT_CLOSED_STATUSES = new Set(['CLOSED']);

/* ---------------------------------------------------------------------- */
/* Хелпер: VIN + времена PSOUT за период (база для OK / DRR)               */
/* ---------------------------------------------------------------------- */
async function getCp6PsoutVins(startTime, endTime) {
  const [rows] = await mesPool.query(`
    SELECT vin, MIN(scan_time) AS psout_first_time, MAX(scan_time) AS psout_last_time
    FROM ti_mes_movement
    WHERE uloc_no = ?
      AND is_deleted = 0
      AND scan_time >= ? AND scan_time <= ?
    GROUP BY vin
  `, [CP6_PSOUT_ULOC, startTime, endTime]);

  const [countRows] = await mesPool.query(`
    SELECT COUNT(*) AS total_records
    FROM ti_mes_movement
    WHERE uloc_no = ?
      AND is_deleted = 0
      AND scan_time >= ? AND scan_time <= ?
  `, [CP6_PSOUT_ULOC, startTime, endTime]);

  return {
    vins: rows.map(r => ({
      vin: r.vin,
      psout_first_time: r.psout_first_time,
      psout_last_time:  r.psout_last_time,
    })),
    totalRecords: Number(countRows[0]?.total_records) || 0,
  };
}

/* ---------------------------------------------------------------------- */
/* Хелпер: VIN + времена PSIN за период (база для NOK)                     */
/* ---------------------------------------------------------------------- */
async function getCp6PsinVins(startTime, endTime) {
  const [rows] = await mesPool.query(`
    SELECT vin, MIN(scan_time) AS psin_first_time, MAX(scan_time) AS psin_last_time
    FROM ti_mes_movement
    WHERE uloc_no = ?
      AND is_deleted = 0
      AND scan_time >= ? AND scan_time <= ?
    GROUP BY vin
  `, [CP6_PSIN_ULOC, startTime, endTime]);
  return rows.map(r => ({
    vin: r.vin,
    psin_first_time: r.psin_first_time,
    psin_last_time:  r.psin_last_time,
  }));
}

/* ---------------------------------------------------------------------- */
/* Хелпер: активные на покраске (System Fill)                              */
/* Последний PSIN > последнего PSOUT, PSIN не старше 14 дней               */
/* ---------------------------------------------------------------------- */
async function getCp6ActiveAtPaint() {
  const [rows] = await mesPool.query(`
    SELECT psin.vin, psin.last_psin AS active_enter_time
    FROM (
      SELECT vin, MAX(scan_time) AS last_psin
      FROM ti_mes_movement
      WHERE uloc_no = ? AND is_deleted = 0
      GROUP BY vin
    ) psin
    LEFT JOIN (
      SELECT vin, MAX(scan_time) AS last_psout
      FROM ti_mes_movement
      WHERE uloc_no = ? AND is_deleted = 0
      GROUP BY vin
    ) psout ON psout.vin = psin.vin
    WHERE (psout.vin IS NULL OR psin.last_psin > psout.last_psout)
      AND psin.last_psin >= DATE_SUB(NOW(), INTERVAL ? DAY)
    ORDER BY psin.last_psin DESC
  `, [CP6_PSIN_ULOC, CP6_PSOUT_ULOC, BUFFER_MAX_AGE_DAYS]);
  return rows;
}

/* ---------------------------------------------------------------------- */
/* Хелпер: VIN в переходе «PBSOUT → TRIMIN» (зелёный блок Buffer)          */
/* Прошли AGMPS01004 за 30 дней, ещё не прошли AGMAS01001                   */
/* ---------------------------------------------------------------------- */
async function getCp6TransitVins() {
  const [rows] = await mesPool.query(`
    SELECT psout.vin, psout.last_psout AS pbsout_time
    FROM (
      SELECT vin, MAX(scan_time) AS last_psout
      FROM ti_mes_movement
      WHERE uloc_no = ? AND is_deleted = 0
        AND scan_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY vin
    ) psout
    LEFT JOIN (
      SELECT vin, MAX(scan_time) AS last_trimin
      FROM ti_mes_movement
      WHERE uloc_no = ? AND is_deleted = 0
      GROUP BY vin
    ) trimin ON trimin.vin = psout.vin
    WHERE (trimin.vin IS NULL OR psout.last_psout > trimin.last_trimin)
    ORDER BY psout.last_psout DESC
  `, [CP6_BUFFER_EXIT, TRANSIT_MAX_AGE_DAYS, CP6_TRIMIN_ULOC]);
  return rows;
}

/* ---------------------------------------------------------------------- */
/* Хелпер: классификация дефекта (Spot / Перекрас / other)                 */
/* Только REPAIR_MEASURE и REPAIR_MEASURE1. Buffer-safe + Unicode-safe.   */
/* ---------------------------------------------------------------------- */
function classifyCp6DefectCategory(d) {
  const toStr = (v) => {
    if (v === null || v === undefined) return '';
    if (Buffer.isBuffer(v)) return v.toString('utf8').trim();
    return String(v).trim();
  };

  const measure  = toStr(d.REPAIR_MEASURE);
  const measure1 = toStr(d.REPAIR_MEASURE1);
  const combined = `${measure} ${measure1}`.toLowerCase();

  if (!combined.trim()) return 'other';
  if (combined.includes('spot')) return 'spot';
  if (combined.includes('перекрас') || combined.includes('repaint') || combined.includes('re-paint')) return 'repaint';
  return 'other';
}

/* ---------------------------------------------------------------------- */
/* Хелпер: расширенная классификация VIN                                  */
/*                                                                        */
/* OK  — PSOUT VIN'ы без открытых дефектов                                */
/* NOK — PSIN VIN'ы с хотя бы одним открытым дефектом                     */
/*                                                                        */
/* Блоки Spot / Перекрас / Остальные — ЭКСКЛЮЗИВНО, приоритет:              */
/*   repaint > spot > other                                              */
/*   Сумма spot + repaint + other = NOK                                   */
/*                                                                        */
/* Таблицы — ИНКЛЮЗИВНО:                                                  */
/*   spotDefectVins / repaintDefectVins — по наличию хоть одного дефекта   */
/*   нужной категории (VIN может быть в обеих)                            */
/* ---------------------------------------------------------------------- */
async function classifyCp6VinsExtended(psoutRows, psinRows) {
  const okSet = new Set();
  const nokSet = new Set();

  const spotSet = new Set();
  const repaintSet = new Set();
  const otherSet = new Set();

  const spotDefectVins = new Set();
  const repaintDefectVins = new Set();

  const psoutVins = psoutRows.map(r => r.vin);
  const psinVins  = psinRows.map(r => r.vin);

  psoutVins.forEach(v => okSet.add(v));

  const allVins = [...new Set([...psoutVins, ...psinVins])];
  if (allVins.length === 0) {
    return { okSet, nokSet, spotSet, repaintSet, otherSet, spotDefectVins, repaintDefectVins };
  }

  const ph = allVins.map(() => '?').join(',');
  const [defectRows] = await pool.query(`
    SELECT VIN, STATUS, REPAIR_MEASURE, REPAIR_MEASURE1
    FROM at_paint_qm_defect_info
    WHERE VIN IN (${ph})
  `, allVins);

  defectRows.forEach(d => {
    const status = (d.STATUS || '').toUpperCase();
    if (CP6_DEFECT_CLOSED_STATUSES.has(status)) return;

    nokSet.add(d.VIN);
    okSet.delete(d.VIN);

    const cat = classifyCp6DefectCategory(d);
    if (cat === 'spot') spotDefectVins.add(d.VIN);
    else if (cat === 'repaint') repaintDefectVins.add(d.VIN);
  });

  // Блоки — эксклюзивно, приоритет repaint > spot > other
  nokSet.forEach(v => {
    const hasSpot    = spotDefectVins.has(v);
    const hasRepaint = repaintDefectVins.has(v);

    if (hasRepaint) repaintSet.add(v);
    else if (hasSpot) spotSet.add(v);
    else otherSet.add(v);
  });

  console.log(
    `[DRR CP6 classify] psout=${psoutVins.length} psin=${psinVins.length} defects=${defectRows.length} ` +
    `ok=${okSet.size} nok=${nokSet.size} ` +
    `blocks: spot=${spotSet.size} repaint=${repaintSet.size} other=${otherSet.size} | ` +
    `tables: spotVins=${spotDefectVins.size} repaintVins=${repaintDefectVins.size}`
  );

  return { okSet, nokSet, spotSet, repaintSet, otherSet, spotDefectVins, repaintDefectVins };
}

/* ---------------------------------------------------------------------- */
/* Хелпер: обогащение VIN метаданными                                     */
/* ---------------------------------------------------------------------- */
async function enrichCp6Vins(vins, psoutTimeByVin, psinTimeByVin) {
  if (vins.length === 0) return [];
  const ph = vins.map(() => '?').join(',');

  const [mesRows] = await mesPool.query(`
    SELECT
      too.vin,
      too.material_no      AS material_code,
      tvv.sequence_number  AS sequence_number,
      too.product          AS model,
      tbmr.material_desc   AS material_desc
    FROM tm_ofm_order too
      LEFT JOIN tm_vhc_vehicle tvv ON tvv.vin = too.vin
      LEFT JOIN tm_bas_material_relation tbmr
        ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
    WHERE too.is_deleted = 0 AND too.vin IN (${ph})
  `, vins);

  const mesByVin = new Map();
  mesRows.forEach(r => mesByVin.set(r.vin, r));

  const [iotRows] = await pool.query(`
    SELECT vin, batch_num FROM work_order WHERE vin IN (${ph})
  `, vins);
  const batchByVin = new Map();
  iotRows.forEach(r => batchByVin.set(r.vin, r.batch_num));

  return vins.map(vin => {
    const m = mesByVin.get(vin) || {};
    return {
      vin,
      batch_num:       batchByVin.get(vin) || '—',
      sequence_number: m.sequence_number || '—',
      model:           m.model || '—',
      material_code:   m.material_code || '—',
      material_desc:   m.material_desc || '—',
      psout_time:      psoutTimeByVin?.get(vin) || null,
      psin_time:       psinTimeByVin?.get(vin) || null,
    };
  }).sort((a, b) => {
    const ta = a.psout_time || a.psin_time;
    const tb = b.psout_time || b.psin_time;
    return new Date(ta || 0) - new Date(tb || 0);
  });
}

/* ====================================================================== */
/* ЭНДПОИНТ 1: главные цифры                                              */
/* ====================================================================== */
app.get('/api/drr-cp6-dashboard', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const [{ vins: psoutRows, totalRecords }, psinRows, activeRows, transitRows] = await Promise.all([
      getCp6PsoutVins(startTime, endTime),
      getCp6PsinVins(startTime, endTime),
      getCp6ActiveAtPaint(),
      getCp6TransitVins(),
    ]);

    const totalVins = psoutRows.length;
    const activeAtPaint = activeRows.length;
    const transitCount = transitRows.length;
    const psinVins = psinRows.length;

    if (totalVins === 0 && psinVins === 0) {
      return res.json({
        totalRecords,
        totalVins: 0,
        okVins: 0,
        nokVins: 0,
        drrPercent: 0,
        spotVins: 0,
        repaintVins: 0,
        otherVins: 0,
        activeAtPaint,
        transitCount,
        psinVins: 0,
      });
    }

    const { okSet, nokSet, spotSet, repaintSet, otherSet } =
      await classifyCp6VinsExtended(psoutRows, psinRows);

    const okVins = okSet.size;
    const nokVins = nokSet.size;
    const drrPercent = totalVins > 0 ? (okVins / totalVins) * 100 : 0;

    res.json({
      totalRecords,
      totalVins,
      okVins,
      nokVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
      spotVins:    spotSet.size,
      repaintVins: repaintSet.size,
      otherVins:   otherSet.size,
      activeAtPaint,
      transitCount,
      psinVins,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 2: список VIN для модалки (ALL | OK | NOK)                    */
/* ====================================================================== */
app.get('/api/drr-cp6-vins', async (req, res) => {
  try {
    const { startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    const [{ vins: psoutRows }, psinRows] = await Promise.all([
      getCp6PsoutVins(startTime, endTime),
      getCp6PsinVins(startTime, endTime),
    ]);

    const psoutTimeByVin = new Map(psoutRows.map(r => [r.vin, r.psout_last_time]));
    const psinTimeByVin  = new Map(psinRows.map(r => [r.vin, r.psin_last_time]));

    const { okSet, nokSet } = await classifyCp6VinsExtended(psoutRows, psinRows);

    let vins;
    if (status === 'ALL') vins = [...new Set([...psoutRows.map(r => r.vin), ...psinRows.map(r => r.vin)])];
    else if (status === 'OK') vins = [...okSet];
    else if (status === 'NOK') vins = [...nokSet];
    else return res.status(400).json({ error: 'Неизвестный status' });

    if (vins.length === 0) return res.json([]);

    const result = await enrichCp6Vins(vins, psoutTimeByVin, psinTimeByVin);
    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 3: топ дефектов у NOK VIN                                     */
/* ====================================================================== */
app.get('/api/drr-cp6-top-defects', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const [{ vins: psoutRows }, psinRows] = await Promise.all([
      getCp6PsoutVins(startTime, endTime),
      getCp6PsinVins(startTime, endTime),
    ]);

    const { nokSet } = await classifyCp6VinsExtended(psoutRows, psinRows);
    const nokVins = [...nokSet];
    if (nokVins.length === 0) return res.json([]);

    const ph = nokVins.map(() => '?').join(',');
    const [defectRows] = await pool.query(`
      SELECT d.VIN, wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE, d.STATUS
      FROM at_paint_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.VIN IN (${ph})
    `, nokVins);

    const map = new Map();
    defectRows.forEach(d => {
      const status = (d.STATUS || '').toUpperCase();
      if (CP6_DEFECT_CLOSED_STATUSES.has(status)) return;

      const mpp = `${d.MODEL || '—'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`
        .replace(/\s+/g, ' ').trim();
      const grade = d.PROBLEM_GRADE || '—';
      const key = `${mpp}|${grade}`;
      if (!map.has(key)) map.set(key, { mpp, grade, defectCount: 0 });
      map.get(key).defectCount += 1;
    });

    const result = [...map.values()]
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-top-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 4: дефекты для таблиц Spot / Перекрас                         */
/* Время захода — последний PSIN (AGMPS01001) или PBSIN (AGMPS01003)       */
/* без ограничения по периоду                                              */
/* ====================================================================== */
app.get('/api/drr-cp6-spot-repaint-vins', async (req, res) => {
  try {
    const { startTime, endTime, category } = req.query;
    if (!startTime || !endTime || !category) {
      return res.status(400).json({ error: 'startTime, endTime и category обязательны' });
    }
    if (category !== 'spot' && category !== 'repaint') {
      return res.status(400).json({ error: 'category: spot | repaint' });
    }

    const [{ vins: psoutRows }, psinRows] = await Promise.all([
      getCp6PsoutVins(startTime, endTime),
      getCp6PsinVins(startTime, endTime),
    ]);

    if (psinRows.length === 0) return res.json([]);

    const { spotDefectVins, repaintDefectVins } = await classifyCp6VinsExtended(psoutRows, psinRows);
    const targetSet = category === 'spot' ? spotDefectVins : repaintDefectVins;
    const targetVins = [...targetSet];
    if (targetVins.length === 0) return res.json([]);

    const ph = targetVins.map(() => '?').join(',');

    const [psinHistoryRows] = await mesPool.query(`
      SELECT vin, uloc_no, MAX(scan_time) AS last_time
      FROM ti_mes_movement
      WHERE vin IN (${ph})
        AND uloc_no IN (?, ?)
        AND is_deleted = 0
      GROUP BY vin, uloc_no
    `, [...targetVins, CP6_PSIN_ULOC, CP6_BUFFER_ENTER]);

    const psinTimeByVin = new Map();
    const pbsinTimeByVin = new Map();
    psinHistoryRows.forEach(r => {
      if (r.uloc_no === CP6_PSIN_ULOC) psinTimeByVin.set(r.vin, r.last_time);
      else if (r.uloc_no === CP6_BUFFER_ENTER) pbsinTimeByVin.set(r.vin, r.last_time);
    });
    targetVins.forEach(v => {
      if (!psinTimeByVin.has(v) && pbsinTimeByVin.has(v)) {
        psinTimeByVin.set(v, pbsinTimeByVin.get(v));
      }
    });

    const [defectRows] = await pool.query(`
      SELECT
        d.VIN, wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE, d.STATUS,
        d.REPAIR_MEASURE, d.REPAIR_MEASURE1
      FROM at_paint_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.VIN IN (${ph})
    `, targetVins);

    const nowMs = Date.now();

    const rows = [];
    defectRows.forEach(d => {
      const status = (d.STATUS || '').toUpperCase();
      if (CP6_DEFECT_CLOSED_STATUSES.has(status)) return;

      const cat = classifyCp6DefectCategory(d);
      if (cat !== category) return;

      const psinTime = psinTimeByVin.get(d.VIN) || null;
      const durationSec = psinTime
        ? Math.max(0, Math.floor((nowMs - new Date(psinTime).getTime()) / 1000))
        : null;

      const mpp = `${d.MODEL || '—'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`
        .replace(/\s+/g, ' ').trim();

      rows.push({
        vin: d.VIN,
        model: d.MODEL || '—',
        mpp,
        part_name: d.PART_NAME || '',
        problem_type: d.PROBLEM_TYPE || '',
        grade: d.PROBLEM_GRADE || '—',
        status: d.STATUS || '—',
        psin_time: psinTime,
        duration_sec: durationSec,
      });
    });

    rows.sort((a, b) => (b.duration_sec || 0) - (a.duration_sec || 0));

    res.json(rows);
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-spot-repaint-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 5: список VIN в переходе «PBSOUT → TRIMIN»                     */
/* (для зелёного блока Buffer)                                             */
/* ====================================================================== */
app.get('/api/drr-cp6-transit-vins', async (req, res) => {
  try {
    const rows = await getCp6TransitVins();
    if (rows.length === 0) return res.json([]);

    const vins = rows.map(r => r.vin);
    const ph = vins.map(() => '?').join(',');

    const [mesRows] = await mesPool.query(`
      SELECT
        too.vin,
        too.material_no      AS material_code,
        tvv.sequence_number  AS sequence_number,
        too.product          AS model,
        tbmr.material_desc   AS material_desc
      FROM tm_ofm_order too
        LEFT JOIN tm_vhc_vehicle tvv ON tvv.vin = too.vin
        LEFT JOIN tm_bas_material_relation tbmr
          ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
      WHERE too.is_deleted = 0 AND too.vin IN (${ph})
    `, vins);

    const mesByVin = new Map();
    mesRows.forEach(r => mesByVin.set(r.vin, r));

    const [iotRows] = await pool.query(`
      SELECT vin, batch_num FROM work_order WHERE vin IN (${ph})
    `, vins);
    const batchByVin = new Map();
    iotRows.forEach(r => batchByVin.set(r.vin, r.batch_num));

    const result = rows.map(r => {
      const m = mesByVin.get(r.vin) || {};
      return {
        vin: r.vin,
        pbsout_time: r.pbsout_time,
        batch_num:       batchByVin.get(r.vin) || '—',
        sequence_number: m.sequence_number || '—',
        model:           m.model || '—',
        material_code:   m.material_code || '—',
        material_desc:   m.material_desc || '—',
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-transit-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ================== DRR CP6 — СНИМКИ СМЕН ============================= */
/* ====================================================================== */

function getWeekNumberForDateCp6(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}

function getShiftLetterForSnapshotCp6(shift, weekNumber) {
  if (shift === 'night') return 'C';
  if (shift === 'all') return 'ALL';
  const isEven = weekNumber % 2 === 0;
  if (shift === 'day') return isEven ? 'B' : 'A';
  if (shift === 'evening') return isEven ? 'A' : 'B';
  return null;
}

function getLastCompletedShiftCp6() {
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

function getCompletedDayDateCp6() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  if (mins >= 1439) return fmt(now);
  const yest = new Date(now);
  yest.setUTCDate(yest.getUTCDate() - 1);
  return fmt(yest);
}

function getShiftRangeCp6(shiftDate, shift) {
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

/* Копия логики эндпоинтов в виде функций — нужна для сохранения снимка */
async function computeCp6Dashboard(startTime, endTime) {
  const [{ vins: psoutRows, totalRecords }, psinRows, activeRows, transitRows] = await Promise.all([
    getCp6PsoutVins(startTime, endTime),
    getCp6PsinVins(startTime, endTime),
    getCp6ActiveAtPaint(),
    getCp6TransitVins(),
  ]);

  const totalVins = psoutRows.length;
  const activeAtPaint = activeRows.length;
  const transitCount = transitRows.length;
  const psinVins = psinRows.length;

  if (totalVins === 0 && psinVins === 0) {
    return {
      totalRecords, totalVins: 0, okVins: 0, nokVins: 0,
      drrPercent: 0, spotVins: 0, repaintVins: 0, otherVins: 0,
      activeAtPaint, transitCount, psinVins: 0,
    };
  }

  const { okSet, nokSet, spotSet, repaintSet, otherSet } =
    await classifyCp6VinsExtended(psoutRows, psinRows);

  const okVins = okSet.size;
  const nokVins = nokSet.size;
  const drrPercent = totalVins > 0 ? (okVins / totalVins) * 100 : 0;

  return {
    totalRecords, totalVins, okVins, nokVins,
    drrPercent: Math.round(drrPercent * 10) / 10,
    spotVins: spotSet.size,
    repaintVins: repaintSet.size,
    otherVins: otherSet.size,
    activeAtPaint, transitCount, psinVins,
  };
}

async function computeCp6SpotRepaintRows(startTime, endTime, category) {
  const [{ vins: psoutRows }, psinRows] = await Promise.all([
    getCp6PsoutVins(startTime, endTime),
    getCp6PsinVins(startTime, endTime),
  ]);
  if (psinRows.length === 0) return [];

  const { spotDefectVins, repaintDefectVins } = await classifyCp6VinsExtended(psoutRows, psinRows);
  const targetSet = category === 'spot' ? spotDefectVins : repaintDefectVins;
  const targetVins = [...targetSet];
  if (targetVins.length === 0) return [];

  const ph = targetVins.map(() => '?').join(',');

  const [psinHistoryRows] = await mesPool.query(`
    SELECT vin, uloc_no, MAX(scan_time) AS last_time
    FROM ti_mes_movement
    WHERE vin IN (${ph})
      AND uloc_no IN (?, ?)
      AND is_deleted = 0
    GROUP BY vin, uloc_no
  `, [...targetVins, CP6_PSIN_ULOC, CP6_BUFFER_ENTER]);

  const psinTimeByVin = new Map();
  const pbsinTimeByVin = new Map();
  psinHistoryRows.forEach(r => {
    if (r.uloc_no === CP6_PSIN_ULOC) psinTimeByVin.set(r.vin, r.last_time);
    else if (r.uloc_no === CP6_BUFFER_ENTER) pbsinTimeByVin.set(r.vin, r.last_time);
  });
  targetVins.forEach(v => {
    if (!psinTimeByVin.has(v) && pbsinTimeByVin.has(v)) {
      psinTimeByVin.set(v, pbsinTimeByVin.get(v));
    }
  });

  const [defectRows] = await pool.query(`
    SELECT d.VIN, wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE, d.STATUS,
           d.REPAIR_MEASURE, d.REPAIR_MEASURE1
    FROM at_paint_qm_defect_info d
    LEFT JOIN work_order wo ON wo.VIN = d.VIN
    WHERE d.VIN IN (${ph})
  `, targetVins);

  const nowMs = Date.now();
  const rows = [];
  defectRows.forEach(d => {
    const status = (d.STATUS || '').toUpperCase();
    if (CP6_DEFECT_CLOSED_STATUSES.has(status)) return;
    const cat = classifyCp6DefectCategory(d);
    if (cat !== category) return;

    const psinTime = psinTimeByVin.get(d.VIN) || null;
    const durationSec = psinTime
      ? Math.max(0, Math.floor((nowMs - new Date(psinTime).getTime()) / 1000))
      : null;
    const mpp = `${d.MODEL || '—'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`
      .replace(/\s+/g, ' ').trim();

    rows.push({
      vin: d.VIN,
      model: d.MODEL || '—',
      mpp,
      part_name: d.PART_NAME || '',
      problem_type: d.PROBLEM_TYPE || '',
      grade: d.PROBLEM_GRADE || '—',
      status: d.STATUS || '—',
      psin_time: psinTime,
      duration_sec: durationSec,
    });
  });

  rows.sort((a, b) => (b.duration_sec || 0) - (a.duration_sec || 0));
  return rows;
}

async function saveDrrCp6Snapshot(shiftDate, shift) {
  try {
    const range = getShiftRangeCp6(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDateCp6(shiftDate);
    const shiftLetter = getShiftLetterForSnapshotCp6(shift, weekNumber);

    const [dash, spotRows, repaintRows] = await Promise.all([
      computeCp6Dashboard(range.start, range.end),
      computeCp6SpotRepaintRows(range.start, range.end, 'spot'),
      computeCp6SpotRepaintRows(range.start, range.end, 'repaint'),
    ]);

    // === РАСЧЕТ TOP DEFECTS ДЛЯ СОХРАНЕНИЯ ===
    let topDefects = [];
    if (dash.nokVins > 0) {
      const [{ vins: psoutRows }, psinRows] = await Promise.all([
        getCp6PsoutVins(range.start, range.end),
        getCp6PsinVins(range.start, range.end),
      ]);
      const { nokSet } = await classifyCp6VinsExtended(psoutRows, psinRows);
      const nokVins = [...nokSet];

      if (nokVins.length > 0) {
        const ph = nokVins.map(() => '?').join(',');
        const [defectRows] = await pool.query(`
          SELECT d.VIN, wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE, d.STATUS
          FROM at_paint_qm_defect_info d
          LEFT JOIN work_order wo ON wo.VIN = d.VIN
          WHERE d.VIN IN (${ph})
        `, nokVins);

        const map = new Map();
        defectRows.forEach(d => {
          const status = (d.STATUS || '').toUpperCase();
          if (CP6_DEFECT_CLOSED_STATUSES.has(status)) return;

          const mpp = `${d.MODEL || '—'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`
            .replace(/\s+/g, ' ').trim();
          const grade = d.PROBLEM_GRADE || '—';
          const key = `${mpp}|${grade}`;
          if (!map.has(key)) map.set(key, { mpp, grade, defectCount: 0 });
          map.get(key).defectCount += 1;
        });
        topDefects = [...map.values()].sort((a, b) => b.defectCount - a.defectCount);
      }
    }
    // =========================================

    await notesPool.query(`
      INSERT INTO drr_cp6_snapshots
        (shift_date, week_number, shift, shift_letter,
         total_records, total_vins, ok_vins, nok_vins, drr_percent,
         spot_vins, repaint_vins, other_vins,
         active_at_paint, transit_count, psin_vins,
         spot_rows, repaint_rows, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_records = VALUES(total_records),
        total_vins = VALUES(total_vins),
        ok_vins = VALUES(ok_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        spot_vins = VALUES(spot_vins),
        repaint_vins = VALUES(repaint_vins),
        other_vins = VALUES(other_vins),
        active_at_paint = VALUES(active_at_paint),
        transit_count = VALUES(transit_count),
        psin_vins = VALUES(psin_vins),
        spot_rows = VALUES(spot_rows),
        repaint_rows = VALUES(repaint_rows),
        top_defects = VALUES(top_defects)
    `, [
      shiftDate, weekNumber, shift, shiftLetter,
      dash.totalRecords, dash.totalVins, dash.okVins, dash.nokVins, dash.drrPercent,
      dash.spotVins, dash.repaintVins, dash.otherVins,
      dash.activeAtPaint, dash.transitCount, dash.psinVins,
      JSON.stringify(spotRows), JSON.stringify(repaintRows), JSON.stringify(topDefects),
    ]);

    console.log(`[DRR CP6 snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) → ${dash.drrPercent}% (${dash.okVins}/${dash.totalVins})`);
  } catch (err) {
    console.error('[DRR CP6 snapshot] ошибка сохранения:', err.message);
  }
}

async function checkAndSaveDrrCp6Snapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShiftCp6();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_cp6_snapshots WHERE shift_date = ? AND shift = ?`,
      [shiftDate, shift]
    );
    if (Number(existing[0]?.cnt || 0) < 1) {
      await saveDrrCp6Snapshot(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR CP6 snapshot] ошибка проверки смены:', err.message);
  }
}

async function checkAndSaveDrrCp6DailySnapshot() {
  try {
    const dayDate = getCompletedDayDateCp6();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_cp6_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (Number(existing[0]?.cnt || 0) < 1) {
      await saveDrrCp6Snapshot(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR CP6 snapshot] ошибка проверки суток:', err.message);
  }
}

setInterval(() => {
  checkAndSaveDrrCp6Snapshot();
  checkAndSaveDrrCp6DailySnapshot();
}, 60 * 1000);
checkAndSaveDrrCp6Snapshot();
checkAndSaveDrrCp6DailySnapshot();

function enrichCp6Snapshot(r) {
  const shiftDate = String(r.shift_date).slice(0, 10);
  const weekNumber = r.week_number != null ? r.week_number : getWeekNumberForDateCp6(shiftDate);
  const shiftLetter = r.shift_letter != null ? r.shift_letter : getShiftLetterForSnapshotCp6(r.shift, weekNumber);
  return {
    id: r.id,
    shiftDate, weekNumber,
    shift: r.shift,
    shiftLetter,
    snapshotTime: r.snapshot_time,
    totalRecords: r.total_records,
    totalVins: r.total_vins,
    okVins: r.ok_vins,
    nokVins: r.nok_vins,
    drrPercent: Number(r.drr_percent),
    spotVins: r.spot_vins,
    repaintVins: r.repaint_vins,
    otherVins: r.other_vins,
    activeAtPaint: r.active_at_paint,
    transitCount: r.transit_count,
    psinVins: r.psin_vins,
  };
}

app.get('/api/drr-cp6-snapshots', async (req, res) => {
  try {
    const { days = 14 } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);
    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, snapshot_time,
             total_records, total_vins, ok_vins, nok_vins, drr_percent,
             spot_vins, repaint_vins, other_vins,
             active_at_paint, transit_count, psin_vins
      FROM drr_cp6_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY shift_date DESC,
        FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays]);
    res.json(rows.map(enrichCp6Snapshot));
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-cp6-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query('SELECT * FROM drr_cp6_snapshots WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Снимок не найден' });

    const r = rows[0];
    let spotRows = [], repaintRows = [], topDefects = [];
    
    try {
      spotRows = r.spot_rows ? (typeof r.spot_rows === 'string' ? JSON.parse(r.spot_rows) : r.spot_rows) : [];
    } catch { spotRows = []; }
    
    try {
      repaintRows = r.repaint_rows ? (typeof r.repaint_rows === 'string' ? JSON.parse(r.repaint_rows) : r.repaint_rows) : [];
    } catch { repaintRows = []; }

    try {
      topDefects = r.top_defects ? (typeof r.top_defects === 'string' ? JSON.parse(r.top_defects) : r.top_defects) : [];
    } catch { topDefects = []; }

    res.json({
      ...enrichCp6Snapshot(r),
      spotRows,
      repaintRows,
      topDefects, // Отдаем сохраненные данные
    });
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});
