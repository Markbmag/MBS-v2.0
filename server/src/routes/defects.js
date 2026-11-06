// Маршруты: количество машин, дашборд дефектов, тренд дефектов (ReportPage).
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { pool } = require('../db');

// =======================================================


// Старые эндпоинты
app.get('/api/cars-count', async (req, res) => {
  try {
    const { model, date } = req.query;
    if (!date) return res.json({ CARS_COUNT: 0 });

    let sql;
    let params;

    if (model) {
      sql = `SELECT COUNT(DISTINCT VIN) AS CARS_COUNT FROM at_om_wiptrackinghistory WHERE WC_NAME IN ('CP72') AND MODEL = ? AND DATE(CREATION_TIME) = ?`;
      params = [model, date];
    } else {
      sql = `SELECT COUNT(DISTINCT VIN) AS CARS_COUNT FROM at_om_wiptrackinghistory WHERE WC_NAME IN ('CP72') AND DATE(CREATION_TIME) = ?`;
      params = [date];
    }

    const [rows] = await pool.query(sql, params);
    res.json({ CARS_COUNT: rows[0]?.CARS_COUNT || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 2. Основная таблица (с учетом смен и костылем "Отсутствие")
app.get('/api/defects-dashboard', async (req, res) => {
  try {
    const { checkpoint, defectType, shift = 'all' } = req.query;
    const type = defectType || 'default';

    // Списки постов
    const cp7Posts = [
      'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
      'REPAIR', 'REPAIR_Final',
      'EXT1', 'PIP2', 'PIP4', 'PIP9'
    ];
    const cp8Posts = [
      'CP8', 'CP8 Gate', 'CP8-gate',
      '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT'
    ];
    const pipPosts = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
    const tlPosts  = ['360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'];

    let postList = [];
    if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else if (checkpoint === 'PIP') postList = pipPosts;
    else if (checkpoint === 'TL') postList = tlPosts;
    else postList = [...new Set([...cp7Posts, ...cp8Posts])];

    const postListStr = postList.map(p => `'${p}'`).join(',');

    // ФИКС: Добавлен костыль "Отсутствие" для оффлайн
    let whereClause = ` AND QM_DEF.POST_NAME IN (${postListStr})`;
    if (type === 'offline') {
      whereClause += ` AND (QM_DEF.S_OFFLINE = 1 OR QM_DEF.PROBLEM_TYPE = 'Отсутствие')`;
    } else if (type === 'online') {
      whereClause += ` AND QM_DEF.S_OFFLINE = 0 AND QM_DEF.PROBLEM_TYPE <> 'Отсутствие'`;
    }

    // ---------- ЛОГИКА СМЕН ----------
    const minutesExpr = `(HOUR(QM_DEF.CREATION_TIME) * 60 + MINUTE(QM_DEF.CREATION_TIME))`;

    let shiftDateExpr;
    if (shift === 'all') {
      shiftDateExpr = `DATE(QM_DEF.CREATION_TIME)`;
    } else if (shift === 'C') {
      shiftDateExpr = `CASE WHEN ${minutesExpr} BETWEEN 91 AND 469 THEN DATE(QM_DEF.CREATION_TIME) END`;
    } else if (shift === 'A') {
      shiftDateExpr = `
        CASE
          WHEN WEEKOFYEAR(QM_DEF.CREATION_TIME) % 2 = 0 THEN
            CASE
              WHEN ${minutesExpr} BETWEEN 1001 AND 1439 THEN DATE(QM_DEF.CREATION_TIME)
              WHEN ${minutesExpr} BETWEEN 0 AND 90 THEN DATE_SUB(DATE(QM_DEF.CREATION_TIME), INTERVAL 1 DAY)
            END
          ELSE
            CASE WHEN ${minutesExpr} BETWEEN 470 AND 1000 THEN DATE(QM_DEF.CREATION_TIME) END
        END
      `;
    } else if (shift === 'B') {
      shiftDateExpr = `
        CASE
          WHEN WEEKOFYEAR(QM_DEF.CREATION_TIME) % 2 = 0 THEN
            CASE WHEN ${minutesExpr} BETWEEN 470 AND 1000 THEN DATE(QM_DEF.CREATION_TIME) END
          ELSE
            CASE
              WHEN ${minutesExpr} BETWEEN 1001 AND 1439 THEN DATE(QM_DEF.CREATION_TIME)
              WHEN ${minutesExpr} BETWEEN 0 AND 90 THEN DATE_SUB(DATE(QM_DEF.CREATION_TIME), INTERVAL 1 DAY)
            END
        END
      `;
    } else {
      shiftDateExpr = `DATE(QM_DEF.CREATION_TIME)`;
    }

    const query = `
      SELECT
        t.PART_NAME,
        t.PROBLEM_TYPE,
        CONCAT(t.PART_NAME, ' ', t.PROBLEM_TYPE) AS PP,
        t.SHIFT_DATE AS CREATION_TIME,
        t.MODEL,
        t.VIN,
        t.POST_NAME,
        COUNT(*) AS QTY_DEF
      FROM (
        SELECT
          QM_DEF.PART_NAME,
          QM_DEF.PROBLEM_TYPE,
          QM_DEF.VIN,
          QM_DEF.POST_NAME,
          wo.MODEL,
          (${shiftDateExpr}) AS SHIFT_DATE
        FROM (
          SELECT VIN, CREATION_TIME, CHECK_POINT, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
                 PART_NAME, PROBLEM_TYPE
          FROM at_biw_qm_defect_info
          WHERE CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
          UNION ALL
          SELECT VIN, CREATION_TIME, CHECK_POINT, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
                 PART_NAME, PROBLEM_TYPE
          FROM at_paint_qm_defect_info
          WHERE CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
          UNION ALL
          SELECT VIN, CREATION_TIME, CHECK_POINT, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
                 PART_NAME, PROBLEM_TYPE
          FROM at_qm_defect_info
          WHERE CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        ) QM_DEF
        JOIN work_order wo ON wo.VIN = QM_DEF.VIN
        WHERE 1=1 ${whereClause}
          AND QM_DEF.PART_NAME IS NOT NULL AND TRIM(QM_DEF.PART_NAME) <> ''
          AND QM_DEF.PROBLEM_TYPE IS NOT NULL AND TRIM(QM_DEF.PROBLEM_TYPE) <> ''
      ) t
      WHERE t.SHIFT_DATE IS NOT NULL
      GROUP BY t.PART_NAME, t.PROBLEM_TYPE, t.SHIFT_DATE, t.MODEL, t.VIN, t.POST_NAME
      ORDER BY t.SHIFT_DATE DESC
    `;

    const [rows] = await pool.query(query);

    const result = rows.map(row => ({
      CREATION_TIME: row.CREATION_TIME,
      MODEL: row.MODEL || 'UNKNOWN',
      PART_NAME: row.PART_NAME || '',
      PROBLEM_TYPE: row.PROBLEM_TYPE || '',
      MPP: `${row.MODEL || 'UNKNOWN'} ${row.PP}`,
      VIN: row.VIN,
      POST_NAME: row.POST_NAME,
      DEFECTS_COUNT: Number(row.QTY_DEF) || 0,
    }));

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА defects-dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. Динамика дефекта для графиков (с поддержкой поиска, моделей и костыля "Отсутствие")
app.get('/api/report-page-defect-trend', async (req, res) => {
  try {
    const { partName, problemType, model, checkpoint, periodType, shift = 'all', defectType = 'default', searchPart, searchDefect } = req.query;
    if (!periodType) return res.status(400).json({ error: 'periodType обязателен' });

    const cp7Posts = ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'REPAIR', 'REPAIR_Final', 'EXT1', 'PIP2', 'PIP4', 'PIP9'];
    const cp8Posts = ['CP8', 'CP8 Gate', 'CP8-gate', '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'];
    const pipPosts = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
    const tlPosts  = ['360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'];

    let postList = [];
    if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else if (checkpoint === 'PIP') postList = pipPosts;
    else if (checkpoint === 'TL') postList = tlPosts;
    else postList = [...new Set([...cp7Posts, ...cp8Posts])];

    const postListStr = postList.map(p => `'${p}'`).join(',');

    // ФИКС: Добавлен костыль "Отсутствие"
    let whereClause = ` AND QM_DEF.POST_NAME IN (${postListStr})`;
    if (defectType === 'offline') {
      whereClause += ` AND (QM_DEF.S_OFFLINE = 1 OR QM_DEF.PROBLEM_TYPE = 'Отсутствие')`;
    } else if (defectType === 'online') {
      whereClause += ` AND QM_DEF.S_OFFLINE = 0 AND QM_DEF.PROBLEM_TYPE <> 'Отсутствие'`;
    }

    // ФИКС 1: Исключаем пустые детали и дефекты, как в основном дашборде
    whereClause += ` AND QM_DEF.PART_NAME IS NOT NULL AND TRIM(QM_DEF.PART_NAME) <> ''`;
    whereClause += ` AND QM_DEF.PROBLEM_TYPE IS NOT NULL AND TRIM(QM_DEF.PROBLEM_TYPE) <> ''`;

    const queryParams = [];
    
    // Обработка поиска по детали
    if (searchPart) {
      whereClause += ` AND QM_DEF.PART_NAME LIKE ?`;
      queryParams.push(`%${searchPart}%`);
    } else if (partName && partName !== 'ALL') {
      whereClause += ` AND QM_DEF.PART_NAME = ?`;
      queryParams.push(partName);
    }

    // Обработка поиска по дефекту
    if (searchDefect) {
      whereClause += ` AND QM_DEF.PROBLEM_TYPE LIKE ?`;
      queryParams.push(`%${searchDefect}%`);
    } else if (problemType && problemType !== 'ALL') {
      whereClause += ` AND QM_DEF.PROBLEM_TYPE = ?`;
      queryParams.push(problemType);
    }

    // Обработка множественного выбора моделей
    const modelList = (model && model !== 'ALL') ? model.split(',') : [];
    if (modelList.length > 0) {
      whereClause += ` AND wo.MODEL IN (${modelList.map(() => '?').join(',')})`;
      queryParams.push(...modelList);
    }

    // Логика смен
    const minutesExpr = `(HOUR(QM_DEF.CREATION_TIME) * 60 + MINUTE(QM_DEF.CREATION_TIME))`;
    let shiftDateExpr;
    if (shift === 'all') shiftDateExpr = `DATE(QM_DEF.CREATION_TIME)`;
    else if (shift === 'C') {
      shiftDateExpr = `CASE WHEN ${minutesExpr} BETWEEN 91 AND 469 THEN DATE(QM_DEF.CREATION_TIME) END`;
    } else if (shift === 'A') {
      shiftDateExpr = `CASE WHEN WEEKOFYEAR(QM_DEF.CREATION_TIME) % 2 = 0 THEN CASE WHEN ${minutesExpr} BETWEEN 1001 AND 1439 THEN DATE(QM_DEF.CREATION_TIME) WHEN ${minutesExpr} BETWEEN 0 AND 90 THEN DATE_SUB(DATE(QM_DEF.CREATION_TIME), INTERVAL 1 DAY) END ELSE CASE WHEN ${minutesExpr} BETWEEN 470 AND 1000 THEN DATE(QM_DEF.CREATION_TIME) END END`;
    } else if (shift === 'B') {
      shiftDateExpr = `CASE WHEN WEEKOFYEAR(QM_DEF.CREATION_TIME) % 2 = 0 THEN CASE WHEN ${minutesExpr} BETWEEN 470 AND 1000 THEN DATE(QM_DEF.CREATION_TIME) END ELSE CASE WHEN ${minutesExpr} BETWEEN 1001 AND 1439 THEN DATE(QM_DEF.CREATION_TIME) WHEN ${minutesExpr} BETWEEN 0 AND 90 THEN DATE_SUB(DATE(QM_DEF.CREATION_TIME), INTERVAL 1 DAY) END END`;
    } else shiftDateExpr = `DATE(QM_DEF.CREATION_TIME)`;

    function getISOWeekInfo(date) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      return { year: d.getUTCFullYear(), week: weekNo };
    }

    const generatePeriods = () => {
      const now = new Date();
      const periods = [];
      if (periodType === 'month') {
        for (let i = 2; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
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
          periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        }
      }
      return periods;
    };

    const periods = generatePeriods();
    if (periods.length === 0) return res.json([]);

    let dateCondition = '';
    if (periodType === 'month') {
      dateCondition = `AND DATE_FORMAT(${shiftDateExpr}, '%Y-%m') IN (${periods.map(() => '?').join(',')})`;
    } else if (periodType === 'week') {
      dateCondition = `AND DATE_FORMAT(${shiftDateExpr}, '%x-W%v') IN (${periods.map(() => '?').join(',')})`;
    } else {
      dateCondition = `AND ${shiftDateExpr} IN (${periods.map(() => '?').join(',')})`;
    }

    const sql = `
      SELECT 
        ${periodType === 'month' ? `DATE_FORMAT(${shiftDateExpr}, '%Y-%m')` :
          periodType === 'week' ? `DATE_FORMAT(${shiftDateExpr}, '%x-W%v')` :
          shiftDateExpr} AS period,
        COUNT(*) AS defect_count
      FROM (
        SELECT VIN, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE 1=1
        ${whereClause}
        ${dateCondition}
      GROUP BY period
      ORDER BY period
    `;

    const [rows] = await pool.query(sql, [...queryParams, ...periods]);
    const defectMap = {};
    rows.forEach(r => { defectMap[r.period] = r.defect_count; });

    const result = [];
    for (const period of periods) {
      let carCondition = '';
      if (periodType === 'month') carCondition = `DATE_FORMAT(DATE(CREATION_TIME), '%Y-%m') = ?`;
      else if (periodType === 'week') carCondition = `DATE_FORMAT(DATE(CREATION_TIME), '%x-W%v') = ?`;
      else carCondition = `DATE(CREATION_TIME) = ?`;

      // ФИКС 2: Считаем машины только по CP72, как в основном дашборде
      let carSql = `
        SELECT COUNT(DISTINCT VIN) AS total
        FROM at_om_wiptrackinghistory
        WHERE WC_NAME IN ('CP72')
          AND ${carCondition}
      `;
      const carParams = [period];
      if (modelList.length > 0) {
        carSql += ` AND MODEL IN (${modelList.map(() => '?').join(',')})`;
        carParams.push(...modelList);
      }
      const [carRows] = await pool.query(carSql, carParams);
      const totalCars = carRows[0]?.total || 0;

      result.push({
        period,
        defect_count: defectMap[period] || 0,
        total_cars: totalCars,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Ошибка report-page-defect-trend:', err.message);
    res.status(500).json({ error: err.message });
  }
});
