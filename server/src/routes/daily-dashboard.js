// Маршруты: Daily Dashboard.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { mesPool, pool } = require('../db');

/* ============ Хелпер: фильтр по смене (SQL-фрагмент) ============ */
function getShiftTimeCondition(dateField, shift) {
  if (!shift || shift === 'all') return '';
  const m = `(HOUR(${dateField}) * 60 + MINUTE(${dateField}))`;
  if (shift === 'day')     return ` AND ${m} BETWEEN 470 AND 1000`;
  if (shift === 'evening') return ` AND (${m} >= 1001 OR ${m} <= 90)`;
  if (shift === 'night')   return ` AND ${m} BETWEEN 91 AND 469`;
  return '';
}

app.get('/api/daily-dashboard-week', async (req, res) => {
  try {
    const { weekStart, weekEnd, shift = 'all' } = req.query;

    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);          // ← было +5, теперь +6 (воскресенье)

    const start = weekStart || monday.toISOString().split('T')[0];
    const end   = weekEnd   || sunday.toISOString().split('T')[0];

    const days = [];
    for (let d = new Date(start); d <= new Date(end); d.setDate(d.getDate() + 1)) {
      days.push(d.toISOString().split('T')[0]);
    }

    const cp7Posts = ['CP7','CP7 Audit','CP7 Gate','CP7-gate','CP8 Touch Up','REPAIR','REPAIR_Final','EXT1','PIP2','PIP4','PIP9','REPAIR VERIFICATION','Topcoat preparation'];
    const cp8Posts = ['CP8','CP8 Gate','CP8-gate','360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT'];
    const allCpPosts = [...cp7Posts, ...cp8Posts];
    const postListStr = allCpPosts.map(p => `'${p}'`).join(',');

    const shiftCarsCond   = getShiftTimeCondition('tvvm.scan_time', shift);
    const shiftDefectsCond = getShiftTimeCondition('CREATION_TIME', shift);

    // DRR за день (max по моделям)
    const getMaxDrrForDay = async (date) => {
      const [rows] = await mesPool.query(`
        SELECT
          ROUND(100 - COALESCE(remzone.REMZONE_COUNT, 0) * 100.0 / NULLIF(all_cars.TOTAL, 0), 1) AS DRR
        FROM (
          SELECT too.product AS MODEL, COUNT(DISTINCT tvv.VIN) AS TOTAL
          FROM tm_vhc_vehicle tvv
          JOIN tm_ofm_order too ON too.VIN = tvv.VIN
          JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
          WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
            AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) = ?
            ${shiftCarsCond}
          GROUP BY too.product
        ) all_cars
        LEFT JOIN (
          SELECT too.product AS MODEL, COUNT(DISTINCT tvv.VIN) AS REMZONE_COUNT
          FROM tm_vhc_vehicle tvv
          JOIN tm_ofm_order too ON too.VIN = tvv.VIN
          JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
          JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN AND tvtlm.node_nature LIKE 'REP%'
          WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
            AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) = ?
            ${shiftCarsCond}
          GROUP BY too.product
        ) remzone ON all_cars.MODEL = remzone.MODEL
      `, [date, date]);
      const values = rows.map(r => r.DRR).filter(v => v !== null);
      return values.length > 0 ? Math.max(...values) : 0;
    };

    // DPU (существующий, не трогаем формулу)
    const getDpu = async (date) => {
      const [carsRows] = await pool.query(`
        SELECT COUNT(DISTINCT VIN) AS CARS
        FROM at_om_wiptrackinghistory
        WHERE WC_NAME IN (${postListStr}) AND DATE(CREATION_TIME) = ?
          ${shiftDefectsCond}
      `, [date]);
      const CARS = Number(carsRows?.[0]?.CARS) || 0;

      const [defRows] = await pool.query(`
        SELECT COUNT(*) AS DEFECTS
        FROM (
          SELECT VIN FROM at_biw_qm_defect_info   WHERE DATE(CREATION_TIME) = ? AND (OFFLINE OR OFFLINE1 OR OFFLINE2) AND POST_NAME IN (${postListStr}) ${shiftDefectsCond}
          UNION ALL
          SELECT VIN FROM at_paint_qm_defect_info WHERE DATE(CREATION_TIME) = ? AND (OFFLINE OR OFFLINE1 OR OFFLINE2) AND POST_NAME IN (${postListStr}) ${shiftDefectsCond}
          UNION ALL
          SELECT VIN FROM at_qm_defect_info       WHERE DATE(CREATION_TIME) = ? AND (OFFLINE OR OFFLINE1 OR OFFLINE2) AND POST_NAME IN (${postListStr}) ${shiftDefectsCond}
        ) t
      `, [date, date, date]);
      const DEFECTS = Number(defRows?.[0]?.DEFECTS) || 0;
      return CARS > 0 ? (DEFECTS / CARS).toFixed(1) : '0.0';
    };

    // DPU OFF (новый): оффлайн-дефекты VIN'ов, прошедших CPFinal / количество таких VIN'ов
    const getDpuOff = async (date) => {
      const [carsRows] = await mesPool.query(`
        SELECT DISTINCT tvv.VIN
        FROM tm_vhc_vehicle tvv
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
          AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) = ?
          ${shiftCarsCond}
      `, [date]);

      const vins = [...new Set(carsRows.map(c => c.VIN))];
      if (vins.length === 0) return '0.0';

      const ph = vins.map(() => '?').join(',');
      const [defRows] = await pool.query(`
        SELECT COUNT(*) AS DEFECTS
        FROM (
          SELECT VIN FROM at_biw_qm_defect_info   
            WHERE VIN IN (${ph}) 
              AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
              ${shiftDefectsCond}
          UNION ALL
          SELECT VIN FROM at_paint_qm_defect_info 
            WHERE VIN IN (${ph}) 
              AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
              ${shiftDefectsCond}
          UNION ALL
          SELECT VIN FROM at_qm_defect_info       
            WHERE VIN IN (${ph}) 
              AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
              ${shiftDefectsCond}
        ) t
      `, [...vins, ...vins, ...vins]);

      const DEFECTS = Number(defRows?.[0]?.DEFECTS) || 0;
      return (DEFECTS / vins.length).toFixed(2);
    };

    // Недельный DRR
    const [weekDrrRows] = await mesPool.query(`
      SELECT
        ROUND(100 - COALESCE(remzone.REMZONE_COUNT, 0) * 100.0 / NULLIF(all_cars.TOTAL, 0), 1) AS DRR
      FROM (
        SELECT too.product AS MODEL, COUNT(DISTINCT tvv.VIN) AS TOTAL
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
          AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) BETWEEN ? AND ?
          ${shiftCarsCond}
        GROUP BY too.product
      ) all_cars
      LEFT JOIN (
        SELECT too.product AS MODEL, COUNT(DISTINCT tvv.VIN) AS REMZONE_COUNT
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN AND tvtlm.node_nature LIKE 'REP%'
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
          AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) BETWEEN ? AND ?
          ${shiftCarsCond}
        GROUP BY too.product
      ) remzone ON all_cars.MODEL = remzone.MODEL
    `, [start, end, start, end]);
    const weekDrrValues = weekDrrRows.map(r => r.DRR).filter(v => v !== null);
    const weekDrr = weekDrrValues.length > 0 ? Math.max(...weekDrrValues) : 0;

    // Недельный DPU
    const [weekCarsRows] = await pool.query(`
      SELECT COUNT(DISTINCT VIN) AS CARS
      FROM at_om_wiptrackinghistory
      WHERE WC_NAME IN (${postListStr}) AND DATE(CREATION_TIME) BETWEEN ? AND ?
        ${shiftDefectsCond}
    `, [start, end]);
    const weekCars = Number(weekCarsRows?.[0]?.CARS) || 0;

    const [weekDefRows] = await pool.query(`
      SELECT COUNT(*) AS DEFECTS
      FROM (
        SELECT VIN FROM at_biw_qm_defect_info   WHERE DATE(CREATION_TIME) BETWEEN ? AND ? AND (OFFLINE OR OFFLINE1 OR OFFLINE2) AND POST_NAME IN (${postListStr}) ${shiftDefectsCond}
        UNION ALL
        SELECT VIN FROM at_paint_qm_defect_info WHERE DATE(CREATION_TIME) BETWEEN ? AND ? AND (OFFLINE OR OFFLINE1 OR OFFLINE2) AND POST_NAME IN (${postListStr}) ${shiftDefectsCond}
        UNION ALL
        SELECT VIN FROM at_qm_defect_info       WHERE DATE(CREATION_TIME) BETWEEN ? AND ? AND (OFFLINE OR OFFLINE1 OR OFFLINE2) AND POST_NAME IN (${postListStr}) ${shiftDefectsCond}
      ) t
    `, [start, end, start, end, start, end]);
    const weekDefects = Number(weekDefRows?.[0]?.DEFECTS) || 0;
    const weekDpu = weekCars > 0 ? (weekDefects / weekCars).toFixed(1) : '0.0';

    // Недельный DPU OFF
    const [weekCpFinalRows] = await mesPool.query(`
      SELECT DISTINCT tvv.VIN
      FROM tm_vhc_vehicle tvv
      JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
      WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
        AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) BETWEEN ? AND ?
        ${shiftCarsCond}
    `, [start, end]);
    const weekCpFinalVins = [...new Set(weekCpFinalRows.map(r => r.VIN))];

    let weekDpuOff = '0.0';
    if (weekCpFinalVins.length > 0) {
      const ph = weekCpFinalVins.map(() => '?').join(',');
      const [weekDefOffRows] = await pool.query(`
        SELECT COUNT(*) AS DEFECTS
        FROM (
          SELECT VIN FROM at_biw_qm_defect_info   
            WHERE VIN IN (${ph}) 
              AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
              ${shiftDefectsCond}
          UNION ALL
          SELECT VIN FROM at_paint_qm_defect_info 
            WHERE VIN IN (${ph}) 
              AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
              ${shiftDefectsCond}
          UNION ALL
          SELECT VIN FROM at_qm_defect_info       
            WHERE VIN IN (${ph}) 
              AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
              ${shiftDefectsCond}
        ) t
      `, [...weekCpFinalVins, ...weekCpFinalVins, ...weekCpFinalVins]);
      const weekDefectsOff = Number(weekDefOffRows?.[0]?.DEFECTS) || 0;
      weekDpuOff = (weekDefectsOff / weekCpFinalVins.length).toFixed(2);
    }

    // Дневные значения
    const drrValues = [];
    const dpuValues = [];
    const dpuOffValues = [];
    for (const day of days) {
      drrValues.push(await getMaxDrrForDay(day));
      dpuValues.push(await getDpu(day));
      dpuOffValues.push(await getDpuOff(day));
    }

    const weekNum = (() => {
      const target = new Date(start);
      const dayNr = (target.getDay() + 6) % 7;
      target.setDate(target.getDate() - dayNr + 3);
      const firstThursday = target.valueOf();
      target.setMonth(0, 1);
      if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
      return 1 + Math.ceil((firstThursday - target) / 604800000);
    })();

    res.json({
      weekNumber: weekNum,
      weekStart: start,
      weekEnd: end,
      days,
      drr: drrValues,
      dpu: dpuValues,
      dpuOff: dpuOffValues,
      weekDrr,
      weekDpu,
      weekDpuOff,
    });
  } catch (err) {
    console.error('Ошибка daily-dashboard-week:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/daily-dashboard-top3', async (req, res) => {
  try {
    const { date, dateFrom, dateTo } = req.query;

    let startDate = dateFrom;
    let endDate = dateTo;
    if (!startDate && !endDate) {
      if (date) { startDate = date; endDate = date; }
      else {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        startDate = endDate = d.toISOString().split('T')[0];
      }
    }
    if (!startDate) startDate = endDate;
    if (!endDate) endDate = startDate;

    const cp7Posts = ['CP7','CP7 Audit','CP7 Gate','CP7-gate','CP8 Touch Up','REPAIR','REPAIR_Final','EXT1','PIP2','PIP4','PIP9','REPAIR VERIFICATION','Topcoat preparation'];
    const cp8Posts = ['CP8','CP8 Gate','CP8-gate','360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT'];
    const allCpPosts = [...cp7Posts, ...cp8Posts];
    const postListStr = allCpPosts.map(p => `'${p}'`).join(',');

    const [rows] = await pool.query(`
      SELECT CONCAT(wo.MODEL, ' - ', d.PART_NAME, ' - ', d.PROBLEM_TYPE) AS DEFECT, COUNT(*) AS CNT
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_qm_defect_info
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr}) AND (d.OFFLINE = 1 OR d.PROBLEM_TYPE = 'Отсутствие')
        AND DATE(d.CREATION_TIME) BETWEEN ? AND ?
      GROUP BY DEFECT
      ORDER BY CNT DESC
      LIMIT 3
    `, [startDate, endDate]);

    res.json(rows.map(r => ({ defect: r.DEFECT, count: r.CNT })));
  } catch (err) {
    console.error('Ошибка daily-dashboard-top3:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/daily-dashboard-top5', async (req, res) => {
  try {
    const { date, dateFrom, dateTo, grades } = req.query;

    let startDate = dateFrom;
    let endDate = dateTo;
    if (!startDate && !endDate) {
      if (date) { startDate = date; endDate = date; }
      else {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        startDate = endDate = d.toISOString().split('T')[0];
      }
    }
    if (!startDate) startDate = endDate;
    if (!endDate) endDate = startDate;

    const cp7Posts = ['CP7','CP7 Audit','CP7 Gate','CP7-gate','CP8 Touch Up','REPAIR','REPAIR_Final','EXT1','PIP2','PIP4','PIP9','REPAIR VERIFICATION','Topcoat preparation'];
    const cp8Posts = ['CP8','CP8 Gate','CP8-gate','360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT'];
    const allCpPosts = [...cp7Posts, ...cp8Posts];
    const postListStr = allCpPosts.map(p => `'${p}'`).join(',');

    let where = `WHERE d.POST_NAME IN (${postListStr}) AND (d.OFFLINE = 1 OR d.PROBLEM_TYPE = 'Отсутствие') AND DATE(d.CREATION_TIME) BETWEEN ? AND ?`;
    const params = [startDate, endDate];

    if (grades) {
      const gradesList = grades.split(',').map(g => g.trim()).filter(Boolean);
      if (gradesList.length > 0) {
        where += ` AND d.PROBLEM_GRADE IN (${gradesList.map(() => '?').join(',')})`;
        params.push(...gradesList);
      }
    }

    const [rows] = await pool.query(`
      SELECT CONCAT(wo.MODEL, ' - ', d.PART_NAME, ' - ', d.PROBLEM_TYPE) AS DEFECT, COUNT(*) AS CNT
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, PROBLEM_GRADE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, PROBLEM_GRADE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, PROBLEM_GRADE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_qm_defect_info
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      ${where}
      GROUP BY DEFECT
      ORDER BY CNT DESC
      LIMIT 5
    `, params);

    res.json(rows.map(r => ({ defect: r.DEFECT, count: r.CNT })));
  } catch (err) {
    console.error('Ошибка daily-dashboard-top5:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== DRR TOP 3 за неделю ==================
app.get('/api/daily-dashboard-week-top3', async (req, res) => {
  try {
    const { dateFrom, dateTo, shift = 'all' } = req.query;
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });
    }

    const cp7Posts = ['CP7','CP7 Audit','CP7 Gate','CP7-gate','CP8 Touch Up','REPAIR','REPAIR_Final','EXT1','PIP2','PIP4','PIP9','REPAIR VERIFICATION','Topcoat preparation'];
    const cp8Posts = ['CP8','CP8 Gate','CP8-gate','360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT'];
    const allCpPosts = [...cp7Posts, ...cp8Posts];
    const postListStr = allCpPosts.map(p => `'${p}'`).join(',');

    const shiftCond = getShiftTimeCondition('d.CREATION_TIME', shift);

    const [rows] = await pool.query(`
      SELECT CONCAT(wo.MODEL, ' - ', d.PART_NAME, ' - ', d.PROBLEM_TYPE) AS DEFECT, COUNT(*) AS CNT
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_qm_defect_info
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr})
        AND (d.OFFLINE = 1 OR d.PROBLEM_TYPE = 'Отсутствие')
        AND DATE(d.CREATION_TIME) BETWEEN ? AND ?
        ${shiftCond}
      GROUP BY DEFECT
      ORDER BY CNT DESC
      LIMIT 3
    `, [dateFrom, dateTo]);

    res.json(rows.map(r => ({ defect: r.DEFECT, count: r.CNT })));
  } catch (err) {
    console.error('Ошибка daily-dashboard-week-top3:', err.message);
    res.status(500).json({ error: err.message });
  }
});
