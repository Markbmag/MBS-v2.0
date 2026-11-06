// Маршруты: DRR CP5.
// Код перенесён из server.js без изменений.

const { app } = require('../../app');
const { mesPool, pool } = require('../../db');

/* ====================================================================== */
/* ===================== DRR CP5 ======================================== */
/* ====================================================================== */

// Фильтр → список точек CP5 в MES
const CP5_FILTER_POINTS = {
  all:    ['AGMBS02002', 'AGMBS01002'],
  BSP100: ['AGMBS02002'],
  BS:     ['AGMBS01002'],
};

function getCp5PointsForFilter(filter) {
  return CP5_FILTER_POINTS[filter] || CP5_FILTER_POINTS.all;
}

/* ---------------------------------------------------------------------- */
/* Хелпер: VIN + времена CP5 + общее число записей CP5                    */
/* ---------------------------------------------------------------------- */
async function getCp5Vins(startTime, endTime, filter = 'all') {
  const points = getCp5PointsForFilter(filter);
  const placeholders = points.map(() => '?').join(',');

  const [rows] = await mesPool.query(`
    SELECT vin, MIN(scan_time) AS cp5_first_time, MAX(scan_time) AS cp5_last_time
    FROM ti_mes_movement
    WHERE uloc_no IN (${placeholders})
      AND is_deleted = 0
      AND scan_time >= ? AND scan_time <= ?
    GROUP BY vin
  `, [...points, startTime, endTime]);

  const [countRows] = await mesPool.query(`
    SELECT COUNT(*) AS total_records
    FROM ti_mes_movement
    WHERE uloc_no IN (${placeholders})
      AND is_deleted = 0
      AND scan_time >= ? AND scan_time <= ?
  `, [...points, startTime, endTime]);

  return {
    vins: rows.map(r => ({
      vin: r.vin,
      cp5_first_time: r.cp5_first_time,
      cp5_last_time:  r.cp5_last_time,
    })),
    totalRecords: Number(countRows[0]?.total_records) || 0,
  };
}

/* ---------------------------------------------------------------------- */
/* Хелпер: классификация VIN (OK / NOK) по дефектам at_biw_qm_defect_info  */
/*   - нет дефектов           → OK                                        */
/*   - все дефекты CLOSED     → OK                                        */
/*   - хотя бы один не CLOSED → NOK                                       */
/* ---------------------------------------------------------------------- */
async function classifyCp5Vins(cp5Rows) {
  const okSet = new Set();
  const nokSet = new Set();
  const vins = cp5Rows.map(r => r.vin);
  vins.forEach(v => okSet.add(v));
  if (vins.length === 0) return { okSet, nokSet };

  const ph = vins.map(() => '?').join(',');
  const [defectRows] = await pool.query(`
    SELECT VIN, STATUS
    FROM at_biw_qm_defect_info
    WHERE VIN IN (${ph})
  `, vins);

  defectRows.forEach(d => {
    const status = (d.STATUS || '').toUpperCase();
    const isClosed = status === 'CLOSED';
    if (!isClosed) {
      nokSet.add(d.VIN);
      okSet.delete(d.VIN);
    }
  });

  return { okSet, nokSet };
}

/* ---------------------------------------------------------------------- */
/* Хелпер: обогащение VIN метаданными                                     */
/* ---------------------------------------------------------------------- */
async function enrichCp5Vins(vins, lastCp5ByVin) {
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
      cp5_time:        lastCp5ByVin.get(vin) || null,
    };
  }).sort((a, b) => new Date(a.cp5_time) - new Date(b.cp5_time));
}

/* ====================================================================== */
/* ЭНДПОИНТ 1: главные цифры                                              */
/* ====================================================================== */
app.get('/api/drr-cp5-dashboard', async (req, res) => {
  try {
    const { startTime, endTime, filter = 'all' } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const { vins: cp5Rows, totalRecords } = await getCp5Vins(startTime, endTime, filter);
    const totalVins = cp5Rows.length;

    if (totalVins === 0) {
      return res.json({ totalRecords, totalVins: 0, okVins: 0, nokVins: 0, drrPercent: 0 });
    }

    const { okSet, nokSet } = await classifyCp5Vins(cp5Rows);
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
    console.error('Ошибка /api/drr-cp5-dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 2: список VIN для модалки (status: ALL | OK | NOK)            */
/* ====================================================================== */
app.get('/api/drr-cp5-vins', async (req, res) => {
  try {
    const { startTime, endTime, status, filter = 'all' } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    const { vins: cp5Rows } = await getCp5Vins(startTime, endTime, filter);
    if (cp5Rows.length === 0) return res.json([]);

    const lastCp5ByVin = new Map(cp5Rows.map(r => [r.vin, r.cp5_last_time]));
    const { okSet, nokSet } = await classifyCp5Vins(cp5Rows);

    let vins;
    if (status === 'ALL') vins = cp5Rows.map(r => r.vin);
    else if (status === 'OK') vins = [...okSet];
    else if (status === 'NOK') vins = [...nokSet];
    else return res.status(400).json({ error: 'Неизвестный status' });

    if (vins.length === 0) return res.json([]);

    const result = await enrichCp5Vins(vins, lastCp5ByVin);
    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cp5-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 3: топ дефектов у NOK VIN                                     */
/* ====================================================================== */
app.get('/api/drr-cp5-top-defects', async (req, res) => {
  try {
    const { startTime, endTime, filter = 'all' } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const { vins: cp5Rows } = await getCp5Vins(startTime, endTime, filter);
    if (cp5Rows.length === 0) return res.json([]);

    const { nokSet } = await classifyCp5Vins(cp5Rows);
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
        d.STATUS
      FROM at_biw_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.VIN IN (${ph})
    `, nokVins);

    const map = new Map();
    defectRows.forEach(d => {
      const status = (d.STATUS || '').toUpperCase();
      if (status === 'CLOSED') return;

      const model = d.MODEL || '—';
      const part = (d.PART_NAME || '').trim();
      const problem = (d.PROBLEM_TYPE || '').trim();

      const mpp = (!part && !problem)
        ? `${model} TS02 WA EC Tool - NG`
        : `${model} ${part} ${problem}`.replace(/\s+/g, ' ').trim();

      const grade = d.PROBLEM_GRADE || '—';
      const key = `${mpp}|${grade}`;
      if (!map.has(key)) map.set(key, { mpp, grade, defectCount: 0 });
      map.get(key).defectCount += 1;
    });

    const result = [...map.values()]
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cp5-top-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});
