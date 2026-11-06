// Маршруты: DRR CP6 (PSIN/PSOUT/транзит) — основные.
// Код перенесён из server.js без изменений.

const { app } = require('../../app');
const { mesPool, pool } = require('../../db');

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

module.exports = { CP6_BUFFER_ENTER, CP6_DEFECT_CLOSED_STATUSES, CP6_PSIN_ULOC, classifyCp6DefectCategory, classifyCp6VinsExtended, getCp6ActiveAtPaint, getCp6PsinVins, getCp6PsoutVins, getCp6TransitVins };
