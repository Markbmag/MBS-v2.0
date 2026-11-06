// Маршруты: спот-перекрас (REPPS).
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { mesPool, pool } = require('../db');

/* ====================================================================== */
/* ================= SPOT-ПЕРЕКРАС — САМОДОСТАТОЧНЫЙ БЛОК =============== */
/* ====================================================================== */

const SR_PSOUT_ULOC = 'AGMPS01002';

function srChunk(arr, size = 1000) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ISO-неделя — своя, без внешних зависимостей */
function srGetIsoWeek(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}

/* PSOUT-VIN за диапазон */
async function srGetPsoutVins(startTime, endTime) {
  const [rows] = await mesPool.query(`
    SELECT vin, MIN(scan_time) AS psout_first_time, MAX(scan_time) AS psout_last_time
    FROM ti_mes_movement
    WHERE uloc_no = ?
      AND is_deleted = 0
      AND scan_time >= ? AND scan_time <= ?
    GROUP BY vin
  `, [SR_PSOUT_ULOC, startTime, endTime]);
  return rows.map(r => ({
    vin: r.vin,
    psout_first_time: r.psout_first_time,
    psout_last_time:  r.psout_last_time,
  }));
}

/* Классификация VIN */
async function srClassifyVins(psoutRows) {
  const allVins = psoutRows.map(r => r.vin);
  const spotSet = new Set();
  const repaintSet = new Set();
  const modelsByVin = new Map();

  if (allVins.length === 0) return { spotSet, repaintSet, modelsByVin };

  const spotDefectVins = new Set();
  const repaintDefectVins = new Set();
  const chunks = srChunk(allVins, 1000);

  for (const chunk of chunks) {
    const ph = chunk.map(() => '?').join(',');
    const [defectRows] = await pool.query(`
      SELECT VIN, REPAIR_MEASURE, REPAIR_MEASURE1
      FROM at_paint_qm_defect_info
      WHERE VIN IN (${ph})
    `, chunk);

    defectRows.forEach(d => {
      const m1 = Buffer.isBuffer(d.REPAIR_MEASURE)  ? d.REPAIR_MEASURE.toString('utf8')  : d.REPAIR_MEASURE;
      const m2 = Buffer.isBuffer(d.REPAIR_MEASURE1) ? d.REPAIR_MEASURE1.toString('utf8') : d.REPAIR_MEASURE1;
      const s = `${m1 || ''} ${m2 || ''}`.toLowerCase().trim();
      if (!s) return;
      if (s.includes('перекрас') || s.includes('repaint') || s.includes('re-paint')) repaintDefectVins.add(d.VIN);
      else if (s.includes('spot')) spotDefectVins.add(d.VIN);
    });
  }

  allVins.forEach(v => {
    if (repaintDefectVins.has(v))   repaintSet.add(v);
    else if (spotDefectVins.has(v)) spotSet.add(v);
  });

  for (const chunk of chunks) {
    const ph = chunk.map(() => '?').join(',');
    const [modelRows] = await pool.query(`
      SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})
    `, chunk);
    modelRows.forEach(r => modelsByVin.set(r.VIN, r.MODEL));
  }

  return { spotSet, repaintSet, modelsByVin };
}

/* Генерация периодов — использует srGetIsoWeek */
function srBuildPeriods({ period, count, fromDate, toDate }) {
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();

  if (fromDate && toDate) {
    const out = [];
    const start = new Date(fromDate + 'T00:00:00');
    const end   = new Date(toDate   + 'T00:00:00');
    if (isNaN(start) || isNaN(end) || start > end) return [];
    const cur = new Date(start);
    while (cur <= end) {
      const ds = fmt(cur);
      out.push({ type: 'day', label: ds, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  if (period === 'all') {
    const months = [], weeks = [], days = [];

    const curM = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < 3; i++) {
      const s = new Date(curM.getFullYear(), curM.getMonth() - i, 1);
      const e = new Date(curM.getFullYear(), curM.getMonth() - i + 1, 0);
      months.push({
        type: 'month',
        label: `${s.toLocaleString('en-US', { month: 'short' })} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`,
        endDate:   `${fmt(e)} 23:59:59`,
      });
    }
    months.reverse();

    const curW = new Date(now);
    curW.setDate(curW.getDate() - ((curW.getDay() + 6) % 7));
    for (let i = 0; i < 4; i++) {
      const s = new Date(curW); s.setDate(s.getDate() - i * 7);
      const e = new Date(s);    e.setDate(e.getDate() + 6);
      weeks.push({
        type: 'week',
        label: `W${srGetIsoWeek(s)} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`,
        endDate:   `${fmt(e)} 23:59:59`,
      });
    }
    weeks.reverse();

    for (let i = 0; i < 14; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const ds = fmt(d);
      days.push({ type: 'day', label: ds, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
    }
    days.reverse();

    return [...months, ...weeks, ...days];
  }

  const n = Math.max(1, Math.min(parseInt(count, 10) || 3, 50));
  const out = [];
  const cur = new Date(now);

  if (period === 'year') {
    for (let i = 0; i < n; i++) {
      const y = cur.getFullYear() - i;
      out.push({ type: 'year', label: String(y), startDate: `${y}-01-01 00:00:00`, endDate: `${y}-12-31 23:59:59` });
    }
  } else if (period === 'month') {
    for (let i = 0; i < n; i++) {
      const s = new Date(cur.getFullYear(), cur.getMonth() - i, 1);
      const e = new Date(cur.getFullYear(), cur.getMonth() - i + 1, 0);
      out.push({
        type: 'month',
        label: `${s.toLocaleString('en-US', { month: 'short' })} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`,
        endDate:   `${fmt(e)} 23:59:59`,
      });
    }
  } else if (period === 'week') {
    const startW = new Date(cur);
    startW.setDate(startW.getDate() - ((startW.getDay() + 6) % 7));
    for (let i = 0; i < n; i++) {
      const s = new Date(startW); s.setDate(s.getDate() - i * 7);
      const e = new Date(s);      e.setDate(e.getDate() + 6);
      out.push({
        type: 'week',
        label: `W${srGetIsoWeek(s)} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`,
        endDate:   `${fmt(e)} 23:59:59`,
      });
    }
  } else {
    for (let i = 0; i < n; i++) {
      const d = new Date(cur); d.setDate(d.getDate() - i);
      const ds = fmt(d);
      out.push({ type: 'day', label: ds, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
    }
  }

  return out.reverse();
}

/* ====================================================================== */
/* ЭНДПОИНТ 1                                                             */
/* ====================================================================== */
app.get('/api/repps-spot-repaint', async (req, res) => {
  try {
    const { period = 'all', count = 3, fromDate, toDate } = req.query;

    const periods = srBuildPeriods({ period, count, fromDate, toDate });
    console.log('[spot-repaint] periods=', periods.length, 'period=', period);

    if (periods.length === 0) return res.json({ dataPoints: [] });

    const minStart = periods.reduce((a, p) => a < p.startDate ? a : p.startDate, periods[0].startDate);
    const maxEnd   = periods.reduce((a, p) => a > p.endDate   ? a : p.endDate,   periods[0].endDate);
    console.log('[spot-repaint] range:', minStart, '..', maxEnd);

    const psoutRows = await srGetPsoutVins(minStart, maxEnd);
    console.log('[spot-repaint] psout vins:', psoutRows.length);

    const ALL_MODELS = ['ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];

    if (psoutRows.length === 0) {
      const empty = periods.map(p => {
        const pt = { type: p.type, label: p.label, startDate: p.startDate, endDate: p.endDate, spot: 0, repaint: 0, total: 0 };
        for (const m of ALL_MODELS) { pt[m] = 0; pt[`${m}_spot`] = 0; pt[`${m}_repaint`] = 0; }
        return pt;
      });
      return res.json({ dataPoints: empty });
    }

    const { spotSet, repaintSet, modelsByVin } = await srClassifyVins(psoutRows);
    console.log('[spot-repaint] spot=', spotSet.size, 'repaint=', repaintSet.size);

    const psoutTimeByVin = new Map(psoutRows.map(r => [r.vin, r.psout_last_time]));

    const dataPoints = periods.map(p => {
      const pStart = new Date(p.startDate);
      const pEnd   = new Date(p.endDate);

      const inRange = (v) => {
        const t = psoutTimeByVin.get(v);
        if (!t) return false;
        const d = new Date(t);
        return d >= pStart && d <= pEnd;
      };

      const spotInPeriod    = [...spotSet].filter(inRange);
      const repaintInPeriod = [...repaintSet].filter(inRange);

      const pt = {
        type: p.type, label: p.label,
        startDate: p.startDate, endDate: p.endDate,
        spot: spotInPeriod.length,
        repaint: repaintInPeriod.length,
      };
      pt.total = pt.spot + pt.repaint;

      for (const m of ALL_MODELS) {
        const s = spotInPeriod.filter(v => (modelsByVin.get(v) || 'UNKNOWN') === m).length;
        const r = repaintInPeriod.filter(v => (modelsByVin.get(v) || 'UNKNOWN') === m).length;
        pt[m]              = s + r;
        pt[`${m}_spot`]    = s;
        pt[`${m}_repaint`] = r;
      }

      return pt;
    });

    res.json({ dataPoints });
  } catch (err) {
    console.error('[spot-repaint] FATAL:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 2                                                             */
/* ====================================================================== */
app.get('/api/repps-spot-repaint-vins', async (req, res) => {
  try {
    const { dateFrom, dateTo, category, model } = req.query;
    if (!dateFrom || !dateTo || !category) {
      return res.status(400).json({ error: 'dateFrom, dateTo, category обязательны' });
    }

    const psoutRows = await srGetPsoutVins(dateFrom, dateTo);
    const { spotSet, repaintSet, modelsByVin } = await srClassifyVins(psoutRows);

    let vins;
    if (category === 'spot')         vins = [...spotSet];
    else if (category === 'repaint') vins = [...repaintSet];
    else if (category === 'total')   vins = [...new Set([...spotSet, ...repaintSet])];
    else return res.status(400).json({ error: 'category: spot | repaint | total' });

    if (model && model !== 'ALL') {
      vins = vins.filter(v => (modelsByVin.get(v) || 'UNKNOWN') === model);
    }

    if (vins.length === 0) return res.json([]);

    const defectsByVin = new Map();
    for (const chunk of srChunk(vins, 1000)) {
      const ph = chunk.map(() => '?').join(',');
      const [defects] = await pool.query(`
        SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, STATUS,
               REPAIR_MEASURE, REPAIR_MEASURE1
        FROM at_paint_qm_defect_info
        WHERE VIN IN (${ph})
      `, chunk);

      defects.forEach(d => {
        const m1 = Buffer.isBuffer(d.REPAIR_MEASURE)  ? d.REPAIR_MEASURE.toString('utf8')  : d.REPAIR_MEASURE;
        const m2 = Buffer.isBuffer(d.REPAIR_MEASURE1) ? d.REPAIR_MEASURE1.toString('utf8') : d.REPAIR_MEASURE1;
        const s = `${m1 || ''} ${m2 || ''}`.toLowerCase();

        let cat = 'other';
        if (s.includes('перекрас') || s.includes('repaint') || s.includes('re-paint')) cat = 'repaint';
        else if (s.includes('spot')) cat = 'spot';
        if (cat === 'other') return;

        if (!defectsByVin.has(d.VIN)) defectsByVin.set(d.VIN, []);
        defectsByVin.get(d.VIN).push({
          part_name: d.PART_NAME,
          problem_type: d.PROBLEM_TYPE,
          grade: d.PROBLEM_GRADE,
          status: d.STATUS,
          category: cat,
        });
      });
    }

    const result = vins.map(v => ({
      vin: v,
      model: modelsByVin.get(v) || '—',
      category: repaintSet.has(v) ? 'repaint' : 'spot',
      defects: defectsByVin.get(v) || [],
    }));

    result.sort((a, b) => {
      if (a.category !== b.category) return a.category === 'repaint' ? -1 : 1;
      return a.vin.localeCompare(b.vin);
    });

    res.json(result);
  } catch (err) {
    console.error('[spot-repaint-vins] FATAL:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});
