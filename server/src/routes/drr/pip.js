// Маршруты: DRR PIP — основные.
// Код перенесён из server.js без изменений.

const { app } = require('../../app');
const { mesPool, pool } = require('../../db');

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

module.exports = { PIP_DEFECT_POSTS_STR };
