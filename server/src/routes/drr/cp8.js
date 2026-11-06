// Маршруты: DRR CP8.
// Код перенесён из server.js без изменений.

const { app } = require('../../app');
const { mesPool, pool } = require('../../db');

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}





app.get('/api/drr-cp8-dashboard', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;

    let rangeStart, rangeEnd;
    if (startTime && endTime) {
      rangeStart = startTime;
      rangeEnd = endTime;
    } else {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      rangeStart = `${y}-${m}-${d} 00:00:00`;
      rangeEnd = `${y}-${m}-${d} 23:59:59`;
    }

    // 1. VIN, прошедшие CP72 за период (MES)
    const [cp72Rows] = await mesPool.query(`
      SELECT DISTINCT vin
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72'
        AND scan_time >= ?
        AND scan_time < ?
    `, [rangeStart, rangeEnd]);

    if (cp72Rows.length === 0) {
      return res.json({ totalVins: 0, closedVins: 0, drrPercent: 0 });
    }

    const vins = cp72Rows.map(r => r.vin);
    const placeholders = vins.map(() => '?').join(',');

    // 2. Дефекты по расширенному списку постов для этих VIN
    const defectPosts = [
      'TLTT','CP8','TLADAS','TLWA','TLRT','CPA',
      'CP8 Gate','CP8-gate','360','ADAS','ADAS+RB',
      'TEST TRACK','TRACK','WA','WT','CP8 Touch Up'
    ];
    const defectPostsStr = defectPosts.map(p => `'${p}'`).join(',');

    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        d.STATUS
      FROM at_qm_defect_info d
      WHERE d.POST_NAME IN (${defectPostsStr})
        AND d.CREATION_TIME >= ?
        AND d.CREATION_TIME < ?
        AND d.VIN IN (${placeholders})
    `, [rangeStart, rangeEnd, ...vins]);

    // 3. Для каждого VIN определяем, есть ли хотя бы один не closed дефект
    const vinHasOpenDefect = new Set();
    defectRows.forEach(row => {
      if (!row.STATUS || row.STATUS.toLowerCase() !== 'closed') {
        vinHasOpenDefect.add(row.VIN);
      }
    });

    // 4. Подсчёт closedVins (OK) – автомобиль OK, если нет открытых дефектов
    let closedVins = 0;
    cp72Rows.forEach(row => {
      if (!vinHasOpenDefect.has(row.vin)) closedVins += 1;
    });

    const drrPercent = (closedVins / cp72Rows.length) * 100;
    res.json({
      totalVins: cp72Rows.length,
      closedVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
    });
  } catch (err) {
    console.error('Ошибка DRR CP8 Dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-cp8-top-defects', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const defectPosts = [
      'TLTT','CP8','TLADAS','TLWA','TLRT','CPA',
      'CP8 Gate','CP8-gate','360','ADAS','ADAS+RB',
      'TEST TRACK','TRACK','WA','WT','CP8 Touch Up'
    ];
    const defectPostsStr = defectPosts.map(p => `'${p}'`).join(',');

    // Все незакрытые дефекты на этих постах за окно — без привязки к CP72
    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${defectPostsStr})
        AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
        AND (d.STATUS IS NULL OR LOWER(d.STATUS) != 'closed')
    `, [startTime, endTime]);

    if (defectRows.length === 0) return res.json([]);

    // Группировка по MODEL + PART_NAME + PROBLEM_TYPE + grade
    const defectGroupMap = new Map();
    defectRows.forEach(row => {
      const mpp = `${row.MODEL || '—'} ${row.PART_NAME || ''} ${row.PROBLEM_TYPE || ''}`
        .replace(/\s+/g, ' ')
        .trim();
      const grade = row.PROBLEM_GRADE || '—';
      const key = `${mpp}|${grade}`;
      if (!defectGroupMap.has(key)) {
        defectGroupMap.set(key, { mpp, grade, defectCount: 0 });
      }
      defectGroupMap.get(key).defectCount += 1;
    });

    const topDefects = [...defectGroupMap.values()]
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(topDefects);
  } catch (err) {
    console.error('Ошибка DRR CP8 Top Defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-cp8-vins', async (req, res) => {
  try {
    const { startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    // 1. VIN, прошедшие CP72 за период (MES)
    const [cp72Rows] = await mesPool.query(`
      SELECT vin, MIN(scan_time) AS cp72_time
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72'
        AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [startTime, endTime]);

    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.vin);
    const placeholders = vins.map(() => '?').join(',');

    // 2. Дефекты на указанных постах
    const defectPosts = [
      'TLTT','CP8','TLADAS','TLWA','TLRT','CPA',
      'CP8 Gate','CP8-gate','360','ADAS','ADAS+RB',
      'TEST TRACK','TRACK','WA','WT','CP8 Touch Up'
    ];
    const defectPostsStr = defectPosts.map(p => `'${p}'`).join(',');

    const [defectRows] = await pool.query(`
      SELECT d.VIN, d.STATUS
      FROM at_qm_defect_info d
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${defectPostsStr})
        AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
    `, [...vins, startTime, endTime]);

    // 3. NOK VIN
    const nokSet = new Set();
    defectRows.forEach(row => {
      if (!row.STATUS || row.STATUS.toLowerCase() !== 'closed') {
        nokSet.add(row.VIN);
      }
    });

    // 4. Получаем модели из work_order
    const [modelRows] = await pool.query(`
      SELECT VIN, MODEL
      FROM work_order
      WHERE VIN IN (${placeholders})
    `, vins);
    const modelMap = new Map(modelRows.map(r => [r.VIN, r.MODEL]));

    // 5. Формируем итоговый список
    const result = cp72Rows
      .filter(row => {
        const isNok = nokSet.has(row.vin);
        if (status === 'NOK') return isNok;
        if (status === 'OK') return !isNok;
        return false;
      })
      .map(row => ({
        vin: row.vin,
        model: modelMap.get(row.vin) || '-',
        cp72_time: row.cp72_time,
      }))
      .sort((a, b) => new Date(a.cp72_time) - new Date(b.cp72_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-cp8-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});
