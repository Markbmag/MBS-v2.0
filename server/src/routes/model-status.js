// Маршруты: Model Status (DRR/DPU CP7, CP8, комплектации).
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { mesPool, pool } = require('../db');

// ================== MODEL STATUS – DRR (MES) ==================
app.get('/api/model-status-drr', async (req, res) => {
  try {
    const { period, count } = req.query;
    if (!period) return res.status(400).json({ error: 'period обязателен' });

    let dateFormat;
    if (period === 'month') dateFormat = '%Y-%m';
    else if (period === 'week') dateFormat = '%Y-%u';
    else if (period === 'day') dateFormat = '%Y-%m-%d';

    const defaultCount = period === 'month' ? 3 : period === 'week' ? 4 : 7;
    const limit = parseInt(count, 10) || defaultCount;

    const sql = `
      SELECT
        all_cars.MODEL,
        all_cars.PERIOD,
        all_cars.TOTAL,
        COALESCE(remzone.REMZONE_COUNT, 0) AS REMZONE_COUNT,
        ROUND(100 - COALESCE(remzone.REMZONE_COUNT, 0) * 100.0 / all_cars.TOTAL, 1) AS DRR_PERCENT
      FROM (
        SELECT
          too.product AS MODEL,
          DATE_FORMAT(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE), ?) AS PERIOD,
          COUNT(DISTINCT tvv.VIN) AS TOTAL
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
        GROUP BY MODEL, PERIOD
      ) all_cars
      LEFT JOIN (
        SELECT
          too.product AS MODEL,
          DATE_FORMAT(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE), ?) AS PERIOD,
          COUNT(DISTINCT tvv.VIN) AS REMZONE_COUNT
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN AND tvtlm.node_nature LIKE 'REP%'
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
        GROUP BY MODEL, PERIOD
      ) remzone ON all_cars.MODEL = remzone.MODEL AND all_cars.PERIOD = remzone.PERIOD
      WHERE all_cars.TOTAL > 0
      ORDER BY all_cars.PERIOD, all_cars.MODEL
    `;

    const [rows] = await mesPool.query(sql, [dateFormat, dateFormat]);

    const periodsMap = {};
    rows.forEach(row => {
      const p = row.PERIOD;
      if (!periodsMap[p]) {
        periodsMap[p] = { period: p, target: 80, values: {} };
      }
      periodsMap[p].values[row.MODEL] = row.DRR_PERCENT;
    });

    const sortedPeriods = Object.keys(periodsMap).sort();
    const recentPeriods = sortedPeriods.slice(-limit);
    const result = recentPeriods.map(p => periodsMap[p]);

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА DRR (MES):', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== MODEL STATUS – DPU CP8 (OFFLINE, CPFINAL) ==================
app.get('/api/model-status-dpu-cp8', async (req, res) => {
  try {
    const { period, count } = req.query;
    if (!period) return res.status(400).json({ error: 'period обязателен' });

    let dateFormat;
    if (period === 'month') dateFormat = '%Y-%m';
    else if (period === 'week') dateFormat = '%Y-%u';
    else if (period === 'day') dateFormat = '%Y-%m-%d';

    const defaultCount = period === 'month' ? 3 : period === 'week' ? 4 : 7;
    const limit = parseInt(count, 10) || defaultCount;

    // Посты CP8 + Test Line (офлайн-дефекты и учёт авто)
    const cp8tlPosts = [
      'CP8', 'CP8 Gate', 'CP8-gate',
      '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT'
    ];
    const postListStr = cp8tlPosts.map(p => `'${p}'`).join(',');

    const sql = `
      SELECT 
        MODEL,
        DATE_FORMAT(CREATION_TIME, ?) AS PERIOD,
        SUM(VIN_C) AS TOTAL_CARS,
        SUM(DEF_C) AS TOTAL_DEFECTS,
        ROUND(SUM(DEF_C) / SUM(VIN_C), 2) AS DPU
      FROM (
        SELECT 
          aowth.MODEL,
          DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)) AS CREATION_TIME,
          COUNT(DISTINCT aowth.VIN) AS VIN_C,
          COUNT(QM_DEF.VIN) AS DEF_C
        FROM at_om_wiptrackinghistory aowth
        JOIN (
          SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_qm_defect_info
        ) QM_DEF ON QM_DEF.VIN = aowth.VIN AND QM_DEF.S_OFFLINE = 1
        WHERE aowth.WC_NAME IN (${postListStr})
        GROUP BY aowth.MODEL, CREATION_TIME
      ) CARS
      GROUP BY MODEL, PERIOD
      ORDER BY PERIOD, MODEL
    `;

    const [rows] = await pool.query(sql, [dateFormat]);

    const allModels = [...new Set(rows.map(r => r.MODEL))].sort();
    const periodsMap = {};
    rows.forEach(row => {
      const p = row.PERIOD;
      if (!periodsMap[p]) {
        periodsMap[p] = { period: p, target: 2, values: {} };
      }
      periodsMap[p].values[row.MODEL] = row.DPU;
    });

    Object.values(periodsMap).forEach(entry => {
      allModels.forEach(m => {
        if (!(m in entry.values)) entry.values[m] = 0;
      });
    });

    const sortedPeriods = Object.keys(periodsMap).sort();
    const recentPeriods = sortedPeriods.slice(-limit);
    const result = recentPeriods.map(p => periodsMap[p]);

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА DPU CP8:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== MODEL STATUS – DRR CP7 ==================
app.get('/api/model-status-drr-cp7', async (req, res) => {
  try {
    const { period, count } = req.query;
    if (!period) return res.status(400).json({ error: 'period обязателен' });

    let dateFormat;
    if (period === 'month') dateFormat = '%Y-%m';
    else if (period === 'week') dateFormat = '%Y-%u';
    else if (period === 'day') dateFormat = '%Y-%m-%d';

    const defaultCount = period === 'month' ? 3 : period === 'week' ? 4 : 7;
    const limit = parseInt(count, 10) || defaultCount;

    const sql = `
      SELECT
        all_cars.MODEL,
        all_cars.PERIOD,
        all_cars.TOTAL,
        COALESCE(remzone.REMZONE_COUNT, 0) AS REMZONE_COUNT,
        ROUND(100 - COALESCE(remzone.REMZONE_COUNT, 0) * 100.0 / all_cars.TOTAL, 1) AS DRR_PERCENT
      FROM (
        SELECT
          too.product AS MODEL,
          DATE_FORMAT(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE), ?) AS PERIOD,
          COUNT(DISTINCT tvv.VIN) AS TOTAL
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CP7'
        GROUP BY MODEL, PERIOD
      ) all_cars
      LEFT JOIN (
        SELECT
          too.product AS MODEL,
          DATE_FORMAT(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE), ?) AS PERIOD,
          COUNT(DISTINCT tvv.VIN) AS REMZONE_COUNT
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CP7'
          AND tvv.VIN IN (
            SELECT DISTINCT tvtlm.VIN
            FROM tm_vhc_test_line_movement tvtlm
            WHERE tvtlm.node_nature LIKE 'REP%'
          )
        GROUP BY MODEL, PERIOD
      ) remzone ON all_cars.MODEL = remzone.MODEL AND all_cars.PERIOD = remzone.PERIOD
      WHERE all_cars.TOTAL > 0
      ORDER BY all_cars.PERIOD, all_cars.MODEL
    `;

    const [rows] = await mesPool.query(sql, [dateFormat, dateFormat]);

    const allModels = [...new Set(rows.map(r => r.MODEL))].sort();
    const periodsMap = {};
    rows.forEach(row => {
      const p = row.PERIOD;
      if (!periodsMap[p]) {
        periodsMap[p] = { period: p, target: 80, values: {} };
      }
      periodsMap[p].values[row.MODEL] = row.DRR_PERCENT;
    });

    Object.values(periodsMap).forEach(entry => {
      allModels.forEach(m => {
        if (!(m in entry.values)) entry.values[m] = 0;
      });
    });

    const sortedPeriods = Object.keys(periodsMap).sort();
    const recentPeriods = sortedPeriods.slice(-limit);
    const result = recentPeriods.map(p => periodsMap[p]);

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА DRR CP7:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== MODEL STATUS – DPU CP7 (OFFLINE, посты CP7) ==================
app.get('/api/model-status-dpu-cp7', async (req, res) => {
  try {
    const { period, count } = req.query;
    if (!period) return res.status(400).json({ error: 'period обязателен' });

    let dateFormat;
    if (period === 'month') dateFormat = '%Y-%m';
    else if (period === 'week') dateFormat = '%Y-%u';
    else if (period === 'day') dateFormat = '%Y-%m-%d';

    const defaultCount = period === 'month' ? 3 : period === 'week' ? 4 : 7;
    const limit = parseInt(count, 10) || defaultCount;

    // Посты CP7 + PIP (офлайн-дефекты и учёт авто)
    const cp7pipPosts = [
      'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
      'PIP1', 'PIP2', 'PIP9',
    ];
    const postListStr = cp7pipPosts.map(p => `'${p}'`).join(',');

    const sql = `
      SELECT 
        MODEL,
        DATE_FORMAT(CREATION_TIME, ?) AS PERIOD,
        SUM(VIN_C) AS TOTAL_CARS,
        SUM(DEF_C) AS TOTAL_DEFECTS,
        ROUND(SUM(DEF_C) / SUM(VIN_C), 2) AS DPU
      FROM (
        SELECT 
          aowth.MODEL,
          DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)) AS CREATION_TIME,
          COUNT(DISTINCT aowth.VIN) AS VIN_C,
          COUNT(QM_DEF.VIN) AS DEF_C
        FROM at_om_wiptrackinghistory aowth
        JOIN (
          SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_qm_defect_info
          UNION ALL
          SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_biw_qm_defect_info
          UNION ALL
          SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_paint_qm_defect_info
        ) QM_DEF ON QM_DEF.VIN = aowth.VIN AND QM_DEF.S_OFFLINE = 1
        WHERE aowth.WC_NAME IN (${postListStr})
        GROUP BY aowth.MODEL, CREATION_TIME
      ) CARS
      GROUP BY MODEL, PERIOD
      ORDER BY PERIOD, MODEL
    `;

    const [rows] = await pool.query(sql, [dateFormat]);

    const allModels = [...new Set(rows.map(r => r.MODEL))].sort();
    const periodsMap = {};
    rows.forEach(row => {
      const p = row.PERIOD;
      if (!periodsMap[p]) {
        periodsMap[p] = { period: p, target: 2, values: {} };
      }
      periodsMap[p].values[row.MODEL] = row.DPU;
    });

    Object.values(periodsMap).forEach(entry => {
      allModels.forEach(m => {
        if (!(m in entry.values)) entry.values[m] = 0;
      });
    });

    const sortedPeriods = Object.keys(periodsMap).sort();
    const recentPeriods = sortedPeriods.slice(-limit);
    const result = recentPeriods.map(p => periodsMap[p]);

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА DPU CP7:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ДЕТАЛИ DPU CP7 ==================
app.get('/api/model-status-dpu-cp7-details', async (req, res) => {
  try {
    const { model, periods, periodType } = req.query;
    if (!periods) return res.status(400).json({ error: 'periods обязателен' });

    const periodList = periods.split(',').map(p => p.trim()).filter(Boolean);
    if (periodList.length === 0) return res.status(400).json({ error: 'periods пуст' });

    let dateCondition;
    if (periodType === 'month') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)), '%Y-%m') IN (${periodList.map(() => '?').join(',')})`;
    } else if (periodType === 'week') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)), '%Y-%u') IN (${periodList.map(() => '?').join(',')})`;
    } else {
      dateCondition = `DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)) IN (${periodList.map(() => '?').join(',')})`;
    }

    // Новый список постов CP7
    const cp7Posts = [
      'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
      'REPAIR', 'REPAIR_Final',
      'EXT1', 'PIP2', 'PIP4', 'PIP9'
    ];
    const postListStr = cp7Posts.map(p => `'${p}'`).join(',');

    let sql = `
      SELECT DISTINCT aowth.VIN, aowth.MODEL, DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)) AS DATE,
             QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE
      FROM at_om_wiptrackinghistory aowth
      JOIN (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_paint_qm_defect_info
      ) QM_DEF ON QM_DEF.VIN = aowth.VIN AND QM_DEF.S_OFFLINE = 1
      WHERE ${dateCondition}
        AND aowth.WC_NAME IN (${postListStr})
    `;
    const params = [...periodList];

    if (model) {
      sql += ` AND aowth.MODEL = ?`;
      params.push(model);
    }

    sql += ` ORDER BY aowth.VIN`;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('DPU CP7 Details:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ДЕТАЛИ DRR CP7 ==================
app.get('/api/model-status-drr-cp7-details', async (req, res) => {
  try {
    const { model, periods, periodType } = req.query;
    if (!periods) return res.status(400).json({ error: 'periods обязателен' });

    const periodList = periods.split(',').map(p => p.trim()).filter(Boolean);
    if (periodList.length === 0) return res.status(400).json({ error: 'periods пуст' });

    let dateCondition;
    if (periodType === 'month') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)), '%Y-%m') IN (${periodList.map(() => '?').join(',')})`;
    } else if (periodType === 'week') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)), '%Y-%u') IN (${periodList.map(() => '?').join(',')})`;
    } else {
      dateCondition = `DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) IN (${periodList.map(() => '?').join(',')})`;
    }

    let sql = `
      SELECT tvv.VIN, too.product AS MODEL, DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) AS DATE,
             IF(MAX(tvtlm.id) IS NOT NULL, 'В ремзоне', 'Без ремзоны') AS REMZONE_STATUS
      FROM tm_vhc_vehicle tvv
      JOIN tm_ofm_order too ON too.VIN = tvv.VIN
      JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
      LEFT JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN AND tvtlm.node_nature LIKE 'REP%'
      WHERE tvvm.node_nature = 'Key_Uloc_Type_CP7'
        AND ${dateCondition}
    `;
    const params = [...periodList];

    if (model) {
      sql += ` AND too.product = ?`;
      params.push(model);
    }

    sql += ` GROUP BY tvv.VIN, too.product, DATE ORDER BY tvv.VIN`;

    const [rows] = await mesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('DRR CP7 Details:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ДЕТАЛИ DPU CP8 ==================
app.get('/api/model-status-dpu-cp8-details', async (req, res) => {
  try {
    const { model, periods, periodType } = req.query;
    if (!periods) return res.status(400).json({ error: 'periods обязателен' });

    const periodList = periods.split(',').map(p => p.trim()).filter(Boolean);
    if (periodList.length === 0) return res.status(400).json({ error: 'periods пуст' });

    let dateCondition;
    if (periodType === 'month') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)), '%Y-%m') IN (${periodList.map(() => '?').join(',')})`;
    } else if (periodType === 'week') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)), '%Y-%u') IN (${periodList.map(() => '?').join(',')})`;
    } else {
      dateCondition = `DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)) IN (${periodList.map(() => '?').join(',')})`;
    }

    let sql = `
      SELECT DISTINCT aowth.VIN, aowth.MODEL, DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)) AS DATE,
             QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE
      FROM at_om_wiptrackinghistory aowth
      JOIN (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_qm_defect_info
      ) QM_DEF ON QM_DEF.VIN = aowth.VIN AND QM_DEF.S_OFFLINE = 1
      WHERE ${dateCondition}
        AND aowth.WC_NAME = 'CPFINAL'
    `;
    const params = [...periodList];

    if (model) {
      sql += ` AND aowth.MODEL = ?`;
      params.push(model);
    }

    sql += ` ORDER BY aowth.VIN`;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('DPU CP8 Details:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ДЕТАЛИ DRR CP8 ==================
app.get('/api/model-status-drr-cp8-details', async (req, res) => {
  try {
    const { model, periods, periodType } = req.query;
    if (!periods) return res.status(400).json({ error: 'periods обязателен' });

    const periodList = periods.split(',').map(p => p.trim()).filter(Boolean);
    if (periodList.length === 0) return res.status(400).json({ error: 'periods пуст' });

    let dateCondition;
    if (periodType === 'month') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)), '%Y-%m') IN (${periodList.map(() => '?').join(',')})`;
    } else if (periodType === 'week') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)), '%Y-%u') IN (${periodList.map(() => '?').join(',')})`;
    } else {
      dateCondition = `DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) IN (${periodList.map(() => '?').join(',')})`;
    }

    let sql = `
      SELECT tvv.VIN, too.product AS MODEL, DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) AS DATE,
             IF(MAX(tvtlm.id) IS NOT NULL, 'В ремзоне', 'Без ремзоны') AS REMZONE_STATUS
      FROM tm_vhc_vehicle tvv
      JOIN tm_ofm_order too ON too.VIN = tvv.VIN
      JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
      LEFT JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN AND tvtlm.node_nature LIKE 'REP%'
      WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
        AND ${dateCondition}
    `;
    const params = [...periodList];

    if (model) {
      sql += ` AND too.product = ?`;
      params.push(model);
    }

    sql += ` GROUP BY tvv.VIN, too.product, DATE ORDER BY tvv.VIN`;

    const [rows] = await mesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('DRR CP8 Details:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ДАННЫЕ ПО КОМПЛЕКТАЦИЯМ (DPU & DRR) ==================
// ================== ДАННЫЕ ПО КОМПЛЕКТАЦИЯМ (DPU & DRR) ==================
app.get('/api/model-status-complectations-daily', async (req, res) => {
  // --- DRR по комплектациям (всё в MES через mesPool) ---
  const fetchDrrComplectations = async (nodeNature) => {
    const [rows] = await mesPool.query(`
      SELECT
        TRIM(all_cars.MODEL) AS model,
        IFNULL(TRIM(tbmr.material_desc), 'Не указана') AS complectation,
        DATE_FORMAT(all_cars.PERIOD_DATE, '%Y-%m-%d') AS period,
        ROUND(100 - IFNULL(remzone.REMZONE_COUNT, 0) * 100.0 / NULLIF(all_cars.TOTAL, 0), 1) AS value
      FROM (
        SELECT too.product AS MODEL, too.material_no,
               DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) AS PERIOD_DATE,
               COUNT(DISTINCT tvv.VIN) AS TOTAL
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = ?
          AND tvvm.scan_time >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        GROUP BY too.product, too.material_no, PERIOD_DATE
      ) all_cars
      LEFT JOIN (
        SELECT too.product AS MODEL, too.material_no,
               DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) AS PERIOD_DATE,
               COUNT(DISTINCT tvv.VIN) AS REMZONE_COUNT
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = ?
          AND tvvm.scan_time >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
          AND tvv.VIN IN (SELECT DISTINCT VIN FROM tm_vhc_test_line_movement WHERE node_nature LIKE 'REP%')
        GROUP BY too.product, too.material_no, PERIOD_DATE
      ) remzone ON all_cars.MODEL = remzone.MODEL
               AND all_cars.material_no = remzone.material_no
               AND all_cars.PERIOD_DATE = remzone.PERIOD_DATE
      LEFT JOIN tm_bas_material_relation tbmr
        ON tbmr.material_no = all_cars.material_no AND tbmr.is_deleted = 0
      WHERE all_cars.TOTAL > 0
    `, [nodeNature, nodeNature]);
    return rows;
  };

  // --- DPU по комплектациям (pool для фактов + mesPool для complectation + склейка) ---
  const fetchDpuComplectations = async (wcList, includeAllSources) => {
    const wcStr = wcList.map(w => `'${w}'`).join(',');
    const defectUnion = includeAllSources
      ? `SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_qm_defect_info
         UNION ALL SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) FROM at_biw_qm_defect_info
         UNION ALL SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) FROM at_paint_qm_defect_info`
      : `SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_qm_defect_info`;

    const [facts] = await pool.query(`
      SELECT
        aowth.VIN,
        TRIM(aowth.MODEL) AS model,
        DATE_FORMAT(DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)), '%Y-%m-%d') AS d,
        COUNT(QM_DEF.VIN) AS DEF_C
      FROM at_om_wiptrackinghistory aowth
      JOIN (${defectUnion}) QM_DEF ON QM_DEF.VIN = aowth.VIN AND QM_DEF.S_OFFLINE = 1
      WHERE aowth.WC_NAME IN (${wcStr})
        AND aowth.CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
      GROUP BY aowth.VIN, aowth.MODEL, d
    `);

    if (facts.length === 0) return [];

    const vins = [...new Set(facts.map(r => r.VIN))];
    const chunkSize = 2000;
    const vinToComp = {};
    for (let i = 0; i < vins.length; i += chunkSize) {
      const chunk = vins.slice(i, i + chunkSize);
      const [mats] = await mesPool.query(`
        SELECT tvv.VIN,
               IFNULL(TRIM(tbmr.material_desc), 'Не указана') AS complectation
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        LEFT JOIN tm_bas_material_relation tbmr
          ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
        WHERE tvv.VIN IN (?)
      `, [chunk]);
      mats.forEach(m => { vinToComp[m.VIN] = m.complectation; });
    }

    const agg = {};
    facts.forEach(f => {
      const comp = vinToComp[f.VIN] || 'Не указана';
      const key = `${f.model}|${comp}|${f.d}`;
      if (!agg[key]) {
        agg[key] = { model: f.model, complectation: comp, period: f.d, vinCount: 0, defSum: 0 };
      }
      agg[key].vinCount += 1;
      agg[key].defSum += Number(f.DEF_C) || 0;
    });

    return Object.values(agg).map(a => ({
      model: a.model,
      complectation: a.complectation,
      period: a.period,
      value: a.vinCount > 0 ? +(a.defSum / a.vinCount).toFixed(2) : 0,
    }));
  };

  try {
    let cp7Dpu = [], cp8Dpu = [], cp7Drr = [], cp8Drr = [];

    try {
      cp7Dpu = await fetchDpuComplectations(
        ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'PIP1', 'PIP2', 'PIP9'], true
      );
    } catch (e) { console.error('CP7 DPU ERROR:', e.message); }

    try {
      cp8Dpu = await fetchDpuComplectations(
        ['CP8', 'CP8 Gate', 'CP8-gate', '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT'], false
      );
    } catch (e) { console.error('CP8 DPU ERROR:', e.message); }

    try { cp7Drr = await fetchDrrComplectations('Key_Uloc_Type_CP7'); }
    catch (e) { console.error('CP7 DRR ERROR:', e.message); }

    try { cp8Drr = await fetchDrrComplectations('Key_Uloc_Type_CPFINAL'); }
    catch (e) { console.error('CP8 DRR ERROR:', e.message); }

    res.json({ cp7Dpu, cp8Dpu, cp7Drr, cp8Drr });
  } catch (err) {
    console.error('Общая ошибка комплектаций:', err.message);
    res.status(500).json({ error: err.message });
  }
});
