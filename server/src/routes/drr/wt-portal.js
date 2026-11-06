// Маршруты: DRR WT Portal (старая версия).
// Код перенесён из server.js без изменений.

const { app } = require('../../app');
const { mesPool, pool } = require('../../db');

/* ==================================================================== */
/* ============ DRR WT PORTAL — ХЕЛПЕРЫ И ЭНДПОИНТЫ =================== */
/* ==================================================================== */

/* ---------------------------------------------------------------------- */
/* Посты, релевантные DRR WT (TLTT + WT-зоны)                             */
/* ---------------------------------------------------------------------- */
const WT_DEFECT_POSTS = [
  'TLTT', 'CP8', 'TLADAS', 'TLWA', 'TLRT', 'CPA',
  'CP8 Gate', 'CP8-gate',
  'TEST TRACK', 'TRACK', 'WT', 'REPAIR VERIFICATION'
];
const WT_DEFECT_POSTS_STR = WT_DEFECT_POSTS.map(p => `'${p}'`).join(',');

/* ---------------------------------------------------------------------- */
/* Хелпер 1: TS16 — уникальные VIN, прошедшие TLTT в окне                  */
/* Возвращает [{ vin, latest_time }] — время самого позднего прохождения   */
/* ---------------------------------------------------------------------- */
async function getTs16Vins(startTime, endTime) {
  const [rows] = await mesPool.query(`
    SELECT vin, MAX(gmt_create) AS latest_time
    FROM tm_vhc_test_line_movement
    WHERE node_nature = 'TLTT'
      AND is_deleted = 0
      AND gmt_create >= ? AND gmt_create <= ?
    GROUP BY vin
  `, [startTime, endTime]);
  return rows.map(r => ({ vin: r.vin, latest_time: r.latest_time }));
}

/* ---------------------------------------------------------------------- */
/* Хелпер 2: сколько ОТКРЫТЫХ дефектов у каждого VIN                      */
/* Возвращает Map<VIN, open_count>                                        */
/* VIN без дефектов вообще → отсутствуют в map (трактуется как 0)         */
/* ---------------------------------------------------------------------- */
async function getVinsOpenDefectCount(vins) {
  const map = new Map();
  if (!vins || vins.length === 0) return map;

  const ph = vins.map(() => '?').join(',');
  const [rows] = await pool.query(`
    SELECT
      VIN,
      SUM(CASE WHEN STATUS IS NOT NULL AND LOWER(STATUS) = 'closed' THEN 0 ELSE 1 END) AS open_count
    FROM at_qm_defect_info
    WHERE VIN IN (${ph})
      AND POST_NAME IN (${WT_DEFECT_POSTS_STR})
    GROUP BY VIN
  `, vins);

  rows.forEach(r => map.set(r.VIN, Number(r.open_count) || 0));
  return map;
}

/* ====================================================================== */
/* ЭНДПОИНТ 1: основной дашборд                                            */
/* ====================================================================== */
app.get('/api/drr-wt-portal', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    // 1. TS16 — уникальные VIN, прошедшие TLTT в окне
    const ts16Rows = await getTs16Vins(startTime, endTime);
    const ts16Vins = ts16Rows.map(r => r.vin);
    const totalVins = ts16Vins.length;

    if (totalVins === 0) {
      return res.json({ totalVins: 0, tlttVins: 0, repVins: 0, tlttPercent: 0 });
    }

    // 2. Для каждого VIN — сколько открытых дефектов
    const openMap = await getVinsOpenDefectCount(ts16Vins);

    // 3. Классификация
    let drrCount = 0;   // все дефекты closed (или дефектов нет) → «Ушли на TLTT»
    let repCount = 0;   // есть хоть один открытый дефект       → «Ушли в REP»
    ts16Vins.forEach(vin => {
      const open = openMap.get(vin) || 0;
      if (open === 0) drrCount++;
      else repCount++;
    });

    const tlttPercent = totalVins > 0 ? (drrCount / totalVins) * 100 : 0;

    res.json({
      totalVins,                          // «Прошли TS16»
      tlttVins: drrCount,                 // «Ушли на TLTT»
      repVins: repCount,                  // «Ушли в REP»
      tlttPercent: Math.round(tlttPercent * 10) / 10,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-wt-portal:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 2: список VIN для модалки                                      */
/* status: TS16 | DRR | TLTT | REP                                        */
/* ====================================================================== */
app.get('/api/drr-wt-portal-vins', async (req, res) => {
  try {
    const { startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    // Общий TS16-набор
    const ts16Rows = await getTs16Vins(startTime, endTime);
    if (ts16Rows.length === 0) return res.json([]);

    // timeByVin — самое позднее время прохождения TLTT
    const timeByVin = new Map();
    ts16Rows.forEach(r => timeByVin.set(r.vin, r.latest_time));

    const allVins = ts16Rows.map(r => r.vin);

    let vins;
    if (status === 'TS16') {
      // все, кто прошёл TLTT
      vins = allVins;
    } else if (status === 'DRR' || status === 'TLTT') {
      // все дефекты закрыты
      const openMap = await getVinsOpenDefectCount(allVins);
      vins = allVins.filter(v => (openMap.get(v) || 0) === 0);
    } else if (status === 'REP') {
      // есть хотя бы один открытый дефект
      const openMap = await getVinsOpenDefectCount(allVins);
      vins = allVins.filter(v => (openMap.get(v) || 0) > 0);
    } else {
      return res.status(400).json({ error: 'Неизвестный status' });
    }

    if (vins.length === 0) return res.json([]);

    // Модель для каждого VIN
    const ph = vins.map(() => '?').join(',');
    const [modelRows] = await pool.query(`
      SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})
    `, vins);
    const modelByVin = new Map();
    modelRows.forEach(r => modelByVin.set(r.VIN, r.MODEL || '—'));

    const result = vins.map(vin => ({
      vin,
      model: modelByVin.get(vin) || '—',
      zone: status,
      event_time: timeByVin.get(vin) || null,
    }));

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-wt-portal-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 3: все дефекты у VIN, ушедших в REP                            */
/* ====================================================================== */
app.get('/api/drr-wt-portal-defects', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    // VIN из TS16 с хотя бы одним открытым дефектом
    const ts16Rows = await getTs16Vins(startTime, endTime);
    if (ts16Rows.length === 0) return res.json([]);

    const openMap = await getVinsOpenDefectCount(ts16Rows.map(r => r.vin));
    const repVins = ts16Rows
      .map(r => r.vin)
      .filter(v => (openMap.get(v) || 0) > 0);

    if (repVins.length === 0) return res.json([]);

    const placeholders = repVins.map(() => '?').join(',');

    // Тот же список постов, что и у хелпера getVinsOpenDefectCount
    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${WT_DEFECT_POSTS_STR})
        AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
    `, [...repVins, startTime, endTime]);

    if (defectRows.length === 0) return res.json([]);

    const defectMap = new Map();
    defectRows.forEach(r => {
      const mpp = `${r.MODEL || '—'} ${r.PART_NAME || ''} ${r.PROBLEM_TYPE || ''}`
        .replace(/\s+/g, ' ')
        .trim();
      const grade = r.PROBLEM_GRADE || '—';
      const key = `${mpp}|${grade}`;
      if (!defectMap.has(key)) defectMap.set(key, { mpp, grade, defectCount: 0 });
      defectMap.get(key).defectCount += 1;
    });

    const result = [...defectMap.values()]
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-wt-portal-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});
