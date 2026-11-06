// Маршруты: топ MPP за неделю, VIN по MPP, аналитика DRR, динамика дефекта.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { mesPool, pool } = require('../db');

// ================== ТОП MPP ЗА НЕДЕЛЮ ==================
app.get('/api/mpp-weekly-top', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, model, defectType } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });

    const type = defectType || 'offline';

    const pipPosts = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
    const cp7Posts = ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'REPAIR', 'REPAIR_Final', 'EXT1', 'PIP2', 'PIP4', 'PIP9'];
    const cp8Posts = ['CP8', 'CP8 Gate', 'CP8-gate', '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT'];
    const tlPosts  = ['360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'];

    let postList = [];
    if (!checkpoint || checkpoint === 'ALL') {
      postList = [...new Set([...pipPosts, ...cp7Posts, ...cp8Posts])];
    } else if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else if (checkpoint === 'PIP') postList = pipPosts;
    else if (checkpoint === 'TL')  postList = tlPosts;
    else postList = [...new Set([...pipPosts, ...cp7Posts, ...cp8Posts])];

    const postListStr = postList.map(p => `'${p}'`).join(',');

    let typeCondition = '';
    if (type === 'offline') {
      typeCondition = " AND (QM_DEF.S_OFFLINE = 1 OR QM_DEF.PROBLEM_TYPE = 'Отсутствие')";
    } else if (type === 'online') {
      typeCondition = " AND QM_DEF.S_OFFLINE = 0 AND QM_DEF.PROBLEM_TYPE <> 'Отсутствие'";
    }

    const params = [dateFrom, dateTo];
    let modelCondition = '';
    if (model && model !== 'ALL') {
      modelCondition = ' AND wo.MODEL = ?';
      params.push(model);
    }

    const sql = `
      SELECT
        CONCAT(wo.MODEL, ' ', QM_DEF.PART_NAME, ' ', QM_DEF.PROBLEM_TYPE) AS MPP,
        QM_DEF.PART_NAME,
        QM_DEF.PROBLEM_TYPE,
        wo.MODEL,
        MIN(QM_DEF.POST_NAME) AS POST_NAME,
        COUNT(*) AS DEFECT_COUNT,
        COUNT(DISTINCT wo.VIN) AS VIN_COUNT,
        GROUP_CONCAT(DISTINCT wo.VIN) AS VIN_LIST
      FROM (
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE QM_DEF.POST_NAME IN (${postListStr})
        ${typeCondition}
        AND QM_DEF.CREATION_DATE BETWEEN ? AND ?
        ${modelCondition}
        AND QM_DEF.PART_NAME IS NOT NULL AND TRIM(QM_DEF.PART_NAME) <> ''
        AND QM_DEF.PROBLEM_TYPE IS NOT NULL AND TRIM(QM_DEF.PROBLEM_TYPE) <> ''
      GROUP BY MPP, QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE, wo.MODEL
      ORDER BY DEFECT_COUNT DESC
      LIMIT 100
    `;

    const [rows] = await pool.query(sql, params);

    // Подсчёт общего количества уникальных VIN (для DPU)
    let totalCars = 0;
    if (postList.length > 0) {
      const carsSql = `
        SELECT COUNT(DISTINCT VIN) AS TOTAL
        FROM at_om_wiptrackinghistory
        WHERE WC_NAME IN (${postListStr})
          AND DATE(CREATION_TIME) BETWEEN ? AND ?
      `;
      const carsParams = [dateFrom, dateTo];
      const [[{ TOTAL }]] = await pool.query(carsSql, carsParams);
      totalCars = TOTAL || 0;
    }

    // Расчёт доли ремзоны для каждого MPP
    const result = [];
    for (let row of rows) {
      const vins = row.VIN_LIST ? row.VIN_LIST.split(',') : [];
      let remzoneCount = 0;
      if (vins.length > 0) {
        const placeholders = vins.map(() => '?').join(',');
        const remSql = `
          SELECT COUNT(DISTINCT tvv.VIN) AS CNT
          FROM tm_vhc_vehicle tvv
          JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN
          WHERE tvv.VIN IN (${placeholders})
            AND tvtlm.node_nature LIKE 'REP%'
        `;
        const [remRows] = await mesPool.query(remSql, vins);
        remzoneCount = remRows[0]?.CNT || 0;
      }

      const totalVins = vins.length;
      const remzonePercent = totalVins > 0 ? ((remzoneCount * 100) / totalVins).toFixed(2) : '0.00';

      result.push({
        MPP: row.MPP,
        MODEL: row.MODEL,
        PART_NAME: row.PART_NAME,
        PROBLEM_TYPE: row.PROBLEM_TYPE,
        POST_NAME: row.POST_NAME,
        DEFECT_COUNT: row.DEFECT_COUNT,
        VIN_COUNT: row.VIN_COUNT,
        DPU: totalCars > 0 ? ((row.DEFECT_COUNT * 1000) / totalCars).toFixed(2) : '0.00',
        TOTAL_VINS: totalVins,
        REMZONE_VINS: remzoneCount,
        REMZONE_PERCENT: remzonePercent,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Ошибка mpp-weekly-top:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// VIN для конкретного MPP
app.get('/api/mpp-vins', async (req, res) => {
  try {
    const { mpp, partName, problemType, dateFrom, dateTo, model } = req.query;
    if (!partName || !problemType || !dateFrom || !dateTo) {
      return res.status(400).json({ error: 'partName, problemType, dateFrom, dateTo обязательны' });
    }

    let where = `QM_DEF.PART_NAME = ? AND QM_DEF.PROBLEM_TYPE = ? AND (QM_DEF.S_OFFLINE = 1 OR QM_DEF.PROBLEM_TYPE = 'Отсутствие') AND QM_DEF.CREATION_DATE BETWEEN ? AND ?`;
    const params = [partName, problemType, dateFrom, dateTo];

    if (model && model !== 'ALL') {
      where += ' AND wo.MODEL = ?';
      params.push(model);
    }

    const sql = `
      SELECT wo.VIN, wo.MODEL, MIN(QM_DEF.CREATION_TIME) AS DEFECT_TIME
      FROM (
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, CREATION_TIME,
               PART_NAME, PROBLEM_TYPE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, CREATION_TIME,
               PART_NAME, PROBLEM_TYPE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, CREATION_TIME,
               PART_NAME, PROBLEM_TYPE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE ${where}
      GROUP BY wo.VIN, wo.MODEL
      ORDER BY wo.VIN
    `;

    const [rows] = await pool.query(sql, params);
    const vins = rows.map(r => r.VIN);

    const remzoneMap = new Map();
    if (vins.length > 0) {
      const placeholders = vins.map(() => '?').join(',');
      const remSql = `
        SELECT tvv.VIN, 
               MIN(tvtlm.gmt_create) AS REM_IN,
               MAX(tvtlm.gmt_create) AS REM_OUT
        FROM tm_vhc_vehicle tvv
        JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN
        WHERE tvv.VIN IN (${placeholders})
          AND tvtlm.node_nature LIKE 'REP%'
          AND tvtlm.gmt_create IS NOT NULL
        GROUP BY tvv.VIN
      `;
      const [remRows] = await mesPool.query(remSql, vins);
      remRows.forEach(r => {
        const remIn = r.REM_IN ? new Date(r.REM_IN) : null;
        const remOut = r.REM_OUT ? new Date(r.REM_OUT) : null;
        let durationStr = '—';
        if (remIn && remOut) {
          const diffMs = remOut - remIn;
          if (diffMs <= 0) {
            durationStr = 'В ремзоне';
          } else {
            const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
            durationStr = `${days}д ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
          }
        }
        remzoneMap.set(r.VIN, {
          in: r.REM_IN ? r.REM_IN.replace('T', ' ').slice(0, 19) : null,
          out: r.REM_OUT ? r.REM_OUT.replace('T', ' ').slice(0, 19) : null,
          duration: durationStr,
        });
      });
    }

    const result = rows.map(row => {
      const rem = remzoneMap.get(row.VIN);
      return {
        VIN: row.VIN,
        MODEL: row.MODEL,
        DEFECT_TIME: row.DEFECT_TIME ? row.DEFECT_TIME.replace('T', ' ').slice(0, 19) : null,
        IN_REMZONE: !!rem,
        REM_IN: rem ? rem.in : null,
        REM_OUT: rem ? rem.out : null,
        REM_DURATION: rem ? rem.duration : '—',
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка mpp-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== АНАЛИТИКА ПО DRR (ВРЕМЯ В РЕМЗОНЕ) ==================
app.get('/api/mpp-drr-analytics', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, model } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom, dateTo обязательны' });

    // ========== 1. Список постов для дефектов (зависит от фильтра чекпоинтов) ==========
    const pipPosts = ['EXT1','PIP1','PIP2','PIP4','PIP5','PIP6','PIP8','PIP9'];
    const cp7Posts = ['CP7','CP7 Audit','CP7 Gate','CP7-gate','REPAIR','REPAIR_Final','EXT1','PIP2','PIP4','PIP9'];
    const cp8Posts = ['CP8','CP8 Gate','CP8-gate','360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT','CP8 Touch Up'];

    let defectPostList = [];
    if (!checkpoint || checkpoint === 'ALL') defectPostList = [...new Set([...pipPosts, ...cp7Posts, ...cp8Posts])];
    else if (checkpoint === 'CP7') defectPostList = cp7Posts;
    else if (checkpoint === 'CP8') defectPostList = cp8Posts;
    else if (checkpoint === 'PIP') defectPostList = pipPosts;
    else defectPostList = [...new Set([...pipPosts, ...cp7Posts, ...cp8Posts])];

    const defectPostListStr = defectPostList.map(p => `'${p}'`).join(',');

    // ========== 2. Общее количество машин и в ремзоне – ВСЕГДА по CP72 ==========
    const cp72PostList = ['CP72'];
    const cp72PostListStr = cp72PostList.map(p => `'${p}'`).join(',');

    const days = [];
    let current = new Date(dateFrom);
    const end = new Date(dateTo);
    while (current <= end) {
      days.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }

    let totalVins = 0;
    let totalRemVins = 0;

    for (const day of days) {
      // Параметры для CP72
      const carsParams = [day];
      if (model && model !== 'ALL') carsParams.push(model);

      // Количество уникальных VIN за день по CP72
      const [[{ CNT }]] = await pool.query(`
        SELECT COUNT(DISTINCT VIN) AS CNT
        FROM at_om_wiptrackinghistory
        WHERE WC_NAME IN (${cp72PostListStr})
          AND DATE(CREATION_TIME) = ?
          ${model && model !== 'ALL' ? ' AND MODEL = ?' : ''}
      `, carsParams);

      totalVins += CNT || 0;

      if (CNT > 0) {
        // Список VIN за день для проверки ремзоны
        const [vinsRows] = await pool.query(`
          SELECT DISTINCT VIN
          FROM at_om_wiptrackinghistory
          WHERE WC_NAME IN (${cp72PostListStr})
            AND DATE(CREATION_TIME) = ?
            ${model && model !== 'ALL' ? ' AND MODEL = ?' : ''}
        `, carsParams);

        const vinsList = vinsRows.map(r => r.VIN);
        const placeholders = vinsList.map(() => '?').join(',');

        const [remRows] = await mesPool.query(`
          SELECT COUNT(DISTINCT tvv.VIN) AS CNT
          FROM tm_vhc_vehicle tvv
          JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN
          WHERE tvv.VIN IN (${placeholders})
            AND tvtlm.node_nature LIKE 'REP%'
        `, vinsList);

        totalRemVins += remRows[0]?.CNT || 0;
      }
    }

    // ========== 3. Данные по дефектам (с фильтром чекпоинтов) ==========
    let modelCondition = '';
    const params = [dateFrom, dateTo];
    if (model && model !== 'ALL') {
      modelCondition = ' AND wo.MODEL = ?';
      params.push(model);
    }

    const sqlDefects = `
      SELECT
        CONCAT(wo.MODEL, ' ', QM_DEF.PART_NAME, ' ', QM_DEF.PROBLEM_TYPE) AS MPP,
        QM_DEF.PART_NAME,
        QM_DEF.PROBLEM_TYPE,
        wo.MODEL,
        COUNT(*) AS DEFECT_COUNT,
        GROUP_CONCAT(DISTINCT wo.VIN) AS VIN_LIST
      FROM (
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE, POST_NAME
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE, POST_NAME
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE, POST_NAME
        FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE QM_DEF.POST_NAME IN (${defectPostListStr})
        AND (QM_DEF.S_OFFLINE = 1 OR QM_DEF.PROBLEM_TYPE = 'Отсутствие')
        AND QM_DEF.CREATION_DATE BETWEEN ? AND ?
        ${modelCondition}
        AND QM_DEF.PART_NAME IS NOT NULL AND TRIM(QM_DEF.PART_NAME) <> ''
        AND QM_DEF.PROBLEM_TYPE IS NOT NULL AND TRIM(QM_DEF.PROBLEM_TYPE) <> ''
      GROUP BY MPP, QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE, wo.MODEL
      ORDER BY DEFECT_COUNT DESC
      LIMIT 50
    `;
    const [defectRows] = await pool.query(sqlDefects, params);

    const result = [];
    for (let row of defectRows) {
      const vins = row.VIN_LIST ? row.VIN_LIST.split(',') : [];
      let totalHours = 0;
      let remzoneCount = 0;

      if (vins.length > 0) {
        const placeholders = vins.map(() => '?').join(',');
        const [remRows] = await mesPool.query(`
          SELECT tvv.VIN, 
                 MIN(tvtlm.gmt_create) AS REM_IN,
                 MAX(tvtlm.gmt_create) AS REM_OUT
          FROM tm_vhc_vehicle tvv
          JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN
          WHERE tvv.VIN IN (${placeholders})
            AND tvtlm.node_nature LIKE 'REP%'
          GROUP BY tvv.VIN
        `, vins);

        remRows.forEach(r => {
          if (r.REM_IN && r.REM_OUT) {
            const diffMs = new Date(r.REM_OUT) - new Date(r.REM_IN);
            if (diffMs > 0) {
              totalHours += diffMs / (1000 * 60 * 60);
              remzoneCount++;
            }
          }
        });
      }

      result.push({
        MPP: row.MPP,
        MODEL: row.MODEL,
        DEFECT_COUNT: row.DEFECT_COUNT,
        REMZONE_COUNT: remzoneCount,
        TOTAL_HOURS: totalHours,
      });
    }

    res.json({
      data: result,
      summary: {
        totalVins: totalVins,       // сумма дневных уникальных VIN по CP72
        totalRemVins: totalRemVins, // из них в ремзоне
      }
    });
  } catch (err) {
    console.error('Ошибка mpp-drr-analytics:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ДИНАМИКА ДЕФЕКТА (MPP TREND) ==================
// ================== ДИНАМИКА ДЕФЕКТА (MPP TREND) ==================
app.get('/api/mpp-defect-trend', async (req, res) => {
  try {
    const { partName, problemType, model, checkpoint, periodType } = req.query;
    if (!partName || !problemType || !model || !periodType) {
      return res.status(400).json({ error: 'partName, problemType, model, periodType обязательны' });
    }

    // Списки постов (как в mpp-weekly-top)
    const pipPosts = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
    const cp7Posts = ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'REPAIR', 'REPAIR_Final', 'EXT1', 'PIP2', 'PIP4', 'PIP9'];
    const cp8Posts = ['CP8', 'CP8 Gate', 'CP8-gate', '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT'];
    const tlPosts  = ['360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'];

    let postList = [];
    if (!checkpoint || checkpoint === 'ALL') {
      postList = [...new Set([...pipPosts, ...cp7Posts, ...cp8Posts])];
    } else {
      const checkpoints = checkpoint.split(',');
      checkpoints.forEach(cp => {
        if (cp === 'CP7') postList.push(...cp7Posts);
        else if (cp === 'CP8') postList.push(...cp8Posts);
        else if (cp === 'PIP') postList.push(...pipPosts);
        else if (cp === 'TL')  postList.push(...tlPosts);
      });
      postList = [...new Set(postList)];
    }
    if (postList.length === 0) {
      return res.json([]);
    }
    const postListStr = postList.map(p => `'${p}'`).join(',');

    // Вспомогательная функция для ISO недели
    function getISOWeekInfo(date) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      return { year: d.getUTCFullYear(), week: weekNo };
    }

    // Генерация полного списка периодов
    const generatePeriods = () => {
      const now = new Date();
      const periods = [];
      if (periodType === 'month') {
        for (let i = 2; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          periods.push(`${y}-${m}`);
        }
      } else if (periodType === 'week') {
        const current = new Date(now);
        const day = current.getDay();
        const mondayOffset = day === 0 ? -6 : 1 - day;
        const thisMonday = new Date(current);
        thisMonday.setDate(current.getDate() + mondayOffset);
        thisMonday.setHours(0, 0, 0, 0);
        for (let i = 3; i >= 0; i--) {
          const weekStart = new Date(thisMonday);
          weekStart.setDate(thisMonday.getDate() - i * 7);
          const iso = getISOWeekInfo(weekStart);
          periods.push(`${iso.year}-W${String(iso.week).padStart(2, '0')}`);
        }
      } else if (periodType === 'day') {
        for (let i = 13; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(now.getDate() - i);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          periods.push(`${y}-${m}-${day}`);
        }
      }
      return periods;
    };

    const periods = generatePeriods();
    if (periods.length === 0) return res.json([]);

    // Условие для SQL в зависимости от типа периода
    let dateCondition = '';
    if (periodType === 'month') {
      dateCondition = `AND DATE_FORMAT(QM_DEF.CREATION_DATE, '%Y-%m') IN (${periods.map(() => '?').join(',')})`;
    } else if (periodType === 'week') {
      dateCondition = `AND DATE_FORMAT(QM_DEF.CREATION_DATE, '%x-W%v') IN (${periods.map(() => '?').join(',')})`;
    } else if (periodType === 'day') {
      dateCondition = `AND QM_DEF.CREATION_DATE IN (${periods.map(() => '?').join(',')})`;
    }

    const sql = `
      SELECT 
        ${periodType === 'month' ? "DATE_FORMAT(QM_DEF.CREATION_DATE, '%Y-%m')" :
          periodType === 'week' ? "DATE_FORMAT(QM_DEF.CREATION_DATE, '%x-W%v')" :
          "DATE(QM_DEF.CREATION_DATE)"} AS period,
        COUNT(*) AS defect_count
      FROM (
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE QM_DEF.PART_NAME = ? 
        AND QM_DEF.PROBLEM_TYPE = ?
        AND wo.MODEL = ?
        AND (QM_DEF.S_OFFLINE = 1 OR QM_DEF.PROBLEM_TYPE = 'Отсутствие')
        AND QM_DEF.POST_NAME IN (${postListStr})
        ${dateCondition}
      GROUP BY period
      ORDER BY period
    `;

    const queryParams = [partName, problemType, model, ...periods];
    const [rows] = await pool.query(sql, queryParams);

    // Словарь: период -> defect_count
    const defectMap = {};
    rows.forEach(r => { defectMap[r.period] = r.defect_count; });

    // Для каждого периода вычисляем total_cars (количество уникальных VIN, прошедших посты)
    const result = [];
    for (const period of periods) {
      let totalCars = 0;
      // Условие для подсчёта автомобилей
      let carCondition = '';
      if (periodType === 'month') {
        carCondition = `DATE_FORMAT(DATE(CREATION_TIME), '%Y-%m') = ?`;
      } else if (periodType === 'week') {
        carCondition = `DATE_FORMAT(DATE(CREATION_TIME), '%x-W%v') = ?`;
      } else {
        carCondition = `DATE(CREATION_TIME) = ?`;
      }

      const carSql = `
        SELECT COUNT(DISTINCT VIN) AS total
        FROM at_om_wiptrackinghistory
        WHERE WC_NAME IN (${postListStr})
          AND ${carCondition}
      `;
      const [carRows] = await pool.query(carSql, [period]);
      totalCars = carRows[0]?.total || 0;

      result.push({
        period,
        defect_count: defectMap[period] || 0,
        total_cars: totalCars,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Ошибка mpp-defect-trend:', err.message);
    res.status(500).json({ error: err.message });
  }
});
