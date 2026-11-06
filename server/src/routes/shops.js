// Маршруты: соответствие деталь/дефект → цех, DRR и топ дефектов по цеху.
// Код перенесён из server.js без изменений.

const { getISOWeek } = require('../lib/shared');
const { app } = require('../app');
const { notesPool, pool } = require('../db');

// Хелпер для форматирования даты без сдвига UTC
const formatLocalDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Справочник дефектов по цехам
app.get('/api/part-defect-shop-mapping', async (req, res) => {
  try {
    const [rows] = await notesPool.query('SELECT * FROM part_defect_shop_mapping ORDER BY part_name, defect_type');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения справочника:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Обновление справочника
app.post('/api/part-defect-shop-mapping', async (req, res) => {
  try {
    const { mappings } = req.body;
    if (!mappings || !mappings.length) return res.status(400).json({ error: 'Нет данных' });
    
    const sql = 'INSERT INTO part_defect_shop_mapping (part_name, defect_type, shop) VALUES ? ON DUPLICATE KEY UPDATE shop = VALUES(shop)';
    const values = mappings.map(m => [m.part_name, m.defect_type, m.shop]);
    
    await notesPool.query(sql, [values]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка обновления справочника:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DRR по цехам
// DRR по цехам
app.get('/api/drr-by-shop', async (req, res) => {
  try {
    const { weeks = 10 } = req.query;

    const [mappingRows] = await notesPool.query('SELECT * FROM part_defect_shop_mapping');
    if (!mappingRows.length) return res.json({ weeks: [], AS: [], BS: [], PS: [], LS: [], hasMapping: false });

    const shopMapping = { AS: [], BS: [], PS: [], LS: [] };
    mappingRows.forEach(m => {
      if (shopMapping[m.shop]) {
        shopMapping[m.shop].push({
          part_name: String(m.part_name).trim(),
          defect_type: String(m.defect_type).trim(),
        });
      }
    });

    const today = new Date();
    const currentMonday = new Date(today);
    const dayOfWeek = today.getDay();
    currentMonday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

    const result = { weeks: [], AS: [], BS: [], PS: [], LS: [], hasMapping: true };

    for (let i = 0; i < weeks; i++) {
      const monday = new Date(currentMonday);
      monday.setDate(currentMonday.getDate() - i * 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const weekStart = formatLocalDate(monday);
      const weekEnd = formatLocalDate(sunday);
      const weekNum = getISOWeek(monday);

      result.weeks.unshift(`CW${weekNum}`);

      // LS добавлен в цикл наравне с AS/BS/PS
      for (const shop of ['AS', 'BS', 'PS', 'LS']) {
        const parts = shopMapping[shop];

        if (!parts.length) {
          result[shop].unshift(0);
          continue;
        }

        const [carsRows] = await pool.query(`
          SELECT COUNT(DISTINCT VIN) AS TOTAL
          FROM at_om_wiptrackinghistory
          WHERE DATE(CREATION_TIME) BETWEEN ? AND ?
        `, [weekStart, weekEnd]);
        const totalCars = carsRows[0]?.TOTAL || 0;

        const conditions = [];
        const params = [];
        parts.forEach(p => {
          conditions.push('(TRIM(PART_NAME) = ? AND TRIM(PROBLEM_TYPE) = ?)');
          params.push(p.part_name, p.defect_type);
        });
        const whereClause = conditions.join(' OR ');

        // УМНЫЙ КОСТЫЛЬ ПО ЦЕХАМ
        // AS, PS, LS — все дефекты (операторы путают онлайн/оффлайн)
        // BS — оффлайн + только серьёзные онлайн (A/B/A1/B1 или есть replenish)
        let offlineCondition = '';
        if (shop === 'AS' || shop === 'PS' || shop === 'LS') {
          offlineCondition = '1 = 1';
        } else {
          offlineCondition = `
            IS_OFF = 1 
            OR (IS_OFF = 0 AND (PROBLEM_GRADE IN ('A', 'B', 'A1', 'B1') OR (PROBLEM_REPLENISH IS NOT NULL AND TRIM(PROBLEM_REPLENISH) <> '')))
          `;
        }

        const [defectRows] = await pool.query(`
          SELECT COUNT(DISTINCT VIN) AS DEFECT_VINS
          FROM (
            SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, PROBLEM_REPLENISH,
                   (OFFLINE OR OFFLINE1 OR OFFLINE2) AS IS_OFF
            FROM at_biw_qm_defect_info
            WHERE DATE(CREATION_TIME) BETWEEN ? AND ?
            UNION ALL
            SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, PROBLEM_REPLENISH,
                   (OFFLINE OR OFFLINE1 OR OFFLINE2) AS IS_OFF
            FROM at_paint_qm_defect_info
            WHERE DATE(CREATION_TIME) BETWEEN ? AND ?
            UNION ALL
            SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, PROBLEM_REPLENISH,
                   (OFFLINE OR OFFLINE1 OR OFFLINE2) AS IS_OFF
            FROM at_qm_defect_info
            WHERE DATE(CREATION_TIME) BETWEEN ? AND ?
          ) QM_DEF
          WHERE (${whereClause})
            AND (${offlineCondition})
        `, [weekStart, weekEnd, weekStart, weekEnd, weekStart, weekEnd, ...params]);

        const defectVins = defectRows[0]?.DEFECT_VINS || 0;
        let drr = 0;
        if (totalCars > 0) drr = (1 - (defectVins / totalCars)) * 100;

        result[shop].unshift(parseFloat(drr.toFixed(2)));
      }
    }
    res.json(result);
  } catch (err) {
    console.error('Ошибка DRR по цехам:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ТОП ДЕФЕКТОВ ПО ЦЕХУ ==================
app.get('/api/shop-top-defects', async (req, res) => {
  try {
    const { shop, model } = req.query;
    if (!shop) return res.status(400).json({ error: 'shop обязателен' });
    
    const [mappingRows] = await notesPool.query(
      'SELECT part_name, defect_type FROM part_defect_shop_mapping WHERE shop = ?',
      [shop]
    );
    
    if (!mappingRows.length) return res.json({ weeks: [], data: [], hasMapping: false });
    
    const today = new Date();
    const currentMonday = new Date(today);
    const dayOfWeek = today.getDay();
    currentMonday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    
    const weeks = [];
    for (let i = 4; i >= 0; i--) {
      const monday = new Date(currentMonday);
      monday.setDate(currentMonday.getDate() - i * 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      weeks.push({
        weekNum: getISOWeek(monday),
        start: formatLocalDate(monday),
        end: formatLocalDate(sunday),
      });
    }
    
    const conditions = [];
    const mappingParams = [];
    mappingRows.forEach(m => {
      conditions.push('(TRIM(PART_NAME) = ? AND TRIM(PROBLEM_TYPE) = ?)');
      mappingParams.push(String(m.part_name).trim(), String(m.defect_type).trim());
    });
    const whereClause = conditions.join(' OR ');
    
    const allResults = {};
    
    for (const week of weeks) {
      const params = [
        week.start, week.end,
        week.start, week.end,
        week.start, week.end,
        ...mappingParams,
      ];
      
      let joinClause = '';
      let modelCondition = '';
      if (model && model !== 'ALL') {
        joinClause = 'JOIN work_order wo ON wo.VIN = QM_DEF.VIN';
        modelCondition = ' AND wo.MODEL = ?';
        params.push(model);
      }
      
      // ТОТ ЖЕ УМНЫЙ КОСТЫЛЬ
      const sql = `
        SELECT 
          CONCAT(QM_DEF.PART_NAME, '_', QM_DEF.PROBLEM_TYPE) AS defect_name,
          COUNT(DISTINCT QM_DEF.VIN) AS defect_count
        FROM (
          SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, PROBLEM_REPLENISH,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS IS_OFF
          FROM at_biw_qm_defect_info
          WHERE DATE(CREATION_TIME) BETWEEN ? AND ?
          UNION ALL
          SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, PROBLEM_REPLENISH,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS IS_OFF
          FROM at_paint_qm_defect_info
          WHERE DATE(CREATION_TIME) BETWEEN ? AND ?
          UNION ALL
          SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, PROBLEM_REPLENISH,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS IS_OFF
          FROM at_qm_defect_info
          WHERE DATE(CREATION_TIME) BETWEEN ? AND ?
        ) QM_DEF
        ${joinClause}
        WHERE (${whereClause})
          AND (
            IS_OFF = 1 
            OR 
            (IS_OFF = 0 AND (PROBLEM_GRADE IN ('A', 'B', 'A1', 'B1') OR (PROBLEM_REPLENISH IS NOT NULL AND TRIM(PROBLEM_REPLENISH) <> '')))
          )
          ${modelCondition}
        GROUP BY defect_name
        ORDER BY defect_count DESC
      `;
      
      const [rows] = await pool.query(sql, params);
      
      rows.forEach(row => {
        if (!allResults[row.defect_name]) {
          allResults[row.defect_name] = {};
        }
        allResults[row.defect_name][`CW${week.weekNum}`] = row.defect_count;
      });
    }
    
    const data = Object.entries(allResults).map(([name, counts]) => ({
      name,
      ...counts,
    }));
    
    const lastWeekKey = `CW${weeks[weeks.length - 1].weekNum}`;
    data.sort((a, b) => (b[lastWeekKey] || 0) - (a[lastWeekKey] || 0));
    
    res.json({ weeks: weeks.map(w => `CW${w.weekNum}`), data, hasMapping: true });
  } catch (err) {
    console.error('Ошибка shop-top-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});
