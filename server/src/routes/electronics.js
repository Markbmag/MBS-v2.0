// Маршруты: топ дефектов электроники.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { mesPool, pool } = require('../db');

app.get('/api/drr-electronics-top-defects', async (req, res) => {
  try {
    const { dateFrom, dateTo, model, grades, posts } = req.query;
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });
    }

    const start = new Date(`${dateFrom}T00:00:00`);
    const end = new Date(`${dateTo}T23:59:59`);

    const electronicsPosts = [
      'CP7', 'CP7 Gate', 'CP78', 'CP79', 'EXT1',
      'PIP2', 'PIP4', 'PIP9',
      '360', 'ADAS+RB', 'CP8', 'CP8 Gate', 'REPAIR', 'REPAIR_Final',
      'TEST TRACK', 'T-UP', 'WA', 'WT', 'CP8 Touch Up',
      'REPAIR VERIFICATION', 'TRACK', 'ROLL'
    ];

    const selected = (!posts || posts === 'ALL') ? ['ALL'] : posts.split(',').map(s => s.trim());
    const useRobot = selected.includes('ALL') || selected.includes('ROBOT');
    const useRegular = selected.includes('ALL') || selected.some(p => electronicsPosts.includes(p));

    const allRows = [];

    // ─── РОБОТЫ ───
    if (useRobot) {
      const [refuelRows] = await pool.query(`
        SELECT VIN, CREATION_TIME,
          CASE
            WHEN OIL_TYPE = 'BK' THEN 'Заправка тормозов – NG'
            WHEN OIL_TYPE = 'AC' THEN 'Заправка кондиционера – NG'
            WHEN OIL_TYPE = 'CL1' THEN 'Заправка антифриза - NG'
            WHEN OIL_TYPE = 'WW' THEN 'Заправка омывайки - NG'
            WHEN OIL_TYPE = 'PREAC' THEN 'Тест утечки кондиц. – NG'
            WHEN OIL_TYPE = 'PREBK' THEN 'Тест утечки тормозной – NG'
            WHEN OIL_TYPE = 'E7' THEN 'Заправка трансмиссионного – NG'
          END AS PART_NAME,
          '' AS PROBLEM_TYPE,
          'A' AS PROBLEM_GRADE,
          'ROBOT' AS POST_NAME
        FROM at_im_refuel_log
        WHERE FILL_RESULT IN ('NOK','NG')
          AND OIL_TYPE IN ('WW','PREAC','BK','CL1','AC','PREBK','E7')
      `);
      allRows.push(...refuelRows);

      const [electricalRows] = await pool.query(`
        SELECT VIN, CREATION_TIME,
          CASE
            WHEN \`TYPE\` = '03' THEN 'Прошивка EOL - NG'
            WHEN \`TYPE\` = '05' THEN 'ЭП4К - Проверка TMPS – NG'
            WHEN \`TYPE\` = '17' THEN 'Запись - Прошивка FLASH – NG'
            WHEN \`TYPE\` = '21' THEN 'МДВШ - Прошивка TMPS - NG'
            WHEN \`TYPE\` = '26' THEN 'ERA - Прошивка ERA - NG'
            WHEN \`TYPE\` = '27' THEN 'APK - Блок управления программируемых специальных функций - Запись кода, не в норме'
          END AS PART_NAME,
          '' AS PROBLEM_TYPE,
          'A' AS PROBLEM_GRADE,
          'ROBOT' AS POST_NAME
        FROM at_im_electrical_check_info
        WHERE RESULT IN ('NOK','NG')
          AND \`TYPE\` IN ('03','05','17','21','26','27')
      `);
      allRows.push(...electricalRows);

      const [executeRows] = await pool.query(`
        SELECT VIN, CREATION_TIME,
          CASE
            WHEN EQP_NUM = 'AGMADAS01' THEN 'Проверка ADAS - NG'
            WHEN EQP_NUM = 'AGMFL01' THEN 'Тест утечки бензобак - NG'
            WHEN EQP_NUM = 'AGMRB01' THEN 'Проверка R&B - NG'
            WHEN EQP_NUM = 'AGMTPMS01' THEN 'Проверка TMPS – NG'
            WHEN EQP_NUM = 'AGMWAHA01' THEN 'Проверка WA - NG'
          END AS PART_NAME,
          '' AS PROBLEM_TYPE,
          'A' AS PROBLEM_GRADE,
          'ROBOT' AS POST_NAME
        FROM at_im_execute_result
        WHERE FINAL_RESULT IN ('NOK','NG')
          AND EQP_NUM IN ('AGMADAS01','AGMFL01','AGMRB01','AGMTPMS01','AGMWAHA01')
      `);
      allRows.push(...executeRows);
    }

    // ─── ОБЫЧНЫЕ ДЕФЕКТЫ (только оффлайн) ───
    if (useRegular) {
      const postListStr = electronicsPosts.map(p => `'${p}'`).join(',');
      const [regularRows] = await pool.query(`
        SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, POST_NAME
        FROM (
          SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, POST_NAME
          FROM at_biw_qm_defect_info
          WHERE POST_NAME IN (${postListStr})
            AND (OFFLINE OR OFFLINE1 OR OFFLINE2) = 1
            AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
            AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          UNION ALL
          SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, POST_NAME
          FROM at_paint_qm_defect_info
          WHERE POST_NAME IN (${postListStr})
            AND (OFFLINE OR OFFLINE1 OR OFFLINE2) = 1
            AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
            AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          UNION ALL
          SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, POST_NAME
          FROM at_qm_defect_info
          WHERE POST_NAME IN (${postListStr})
            AND (OFFLINE OR OFFLINE1 OR OFFLINE2) = 1
            AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
            AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        ) t
      `);
      allRows.push(...regularRows);
    }

    // ─── Фильтр по дате ───
    let filteredRows = allRows.filter(r => {
      const t = new Date(r.CREATION_TIME);
      return t >= start && t <= end;
    });

    // ─── Модели для VIN (через pool, где лежит work_order) ───
    const vins = [...new Set(filteredRows.map(r => r.VIN))];
    const modelMap = {};
    if (vins.length) {
      const placeholders = vins.map(() => '?').join(',');
      const [modelRows] = await pool.query(
        `SELECT VIN, MODEL FROM work_order WHERE VIN IN (${placeholders})`,
        vins
      );
      modelRows.forEach(r => { modelMap[r.VIN] = r.MODEL; });
    }

    // ─── Фильтр по модели (если выбран конкретный) ───
    if (model && model !== 'ALL') {
      const modelList = model.split(',').map(m => m.trim());
      filteredRows = filteredRows.filter(r => modelList.includes(modelMap[r.VIN]));
    }

    // ─── Фильтр по классам ───
    if (grades && grades !== 'ALL') {
      const gradeList = grades.split(',').map(g => g.trim());
      filteredRows = filteredRows.filter(r => gradeList.includes(r.PROBLEM_GRADE));
    }

    // ─── ВАЖНО: убираем записи без модели (VIN не найден в work_order) ───
    filteredRows = filteredRows.filter(r => modelMap[r.VIN] && modelMap[r.VIN] !== '-');

    // ─── Группировка ───
    const groupMap = new Map();
    filteredRows.forEach(r => {
      // key без знака '-' для модели
      const key = `${modelMap[r.VIN]}|${r.PART_NAME}|${r.PROBLEM_TYPE}|${r.POST_NAME}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          model: modelMap[r.VIN],
          part_name: r.PART_NAME,
          problem_type: r.PROBLEM_TYPE,
          post_name: r.POST_NAME,
          vins: new Set(),
          defects: 0,
        });
      }
      const item = groupMap.get(key);
      item.vins.add(r.VIN);
      item.defects += 1;
    });

    // ─── DPU: VIN, прошедшие CP72 (БЕЗ JOIN между разными пулами) ───
    const [cp72VinRows] = await mesPool.query(
      `SELECT DISTINCT tm.vin AS VIN
       FROM ti_mes_movement tm
       WHERE tm.uloc_no = 'CP72'
         AND tm.scan_time >= ? AND tm.scan_time <= ?`,
      [dateFrom + ' 00:00:00', dateTo + ' 23:59:59']
    );
    let cp72Vins = cp72VinRows.map(r => r.VIN);

    let totalCp72 = cp72Vins.length;
    if (model && model !== 'ALL' && cp72Vins.length > 0) {
      const modelList = model.split(',').map(m => m.trim());
      const vinPlaceholders = cp72Vins.map(() => '?').join(',');
      const modelPlaceholders = modelList.map(() => '?').join(',');
      const [filteredCp72] = await pool.query(
        `SELECT COUNT(DISTINCT VIN) AS cnt
         FROM work_order
         WHERE VIN IN (${vinPlaceholders})
           AND MODEL IN (${modelPlaceholders})`,
        [...cp72Vins, ...modelList]
      );
      totalCp72 = filteredCp72[0]?.cnt || 0;
    }

    // ─── Итог ───
    const result = Array.from(groupMap.values()).map(item => ({
      MPP: `${item.model} ${item.part_name} ${item.problem_type}`.trim(),
      MODEL: item.model,
      PART_NAME: item.part_name,
      PROBLEM_TYPE: item.problem_type,
      VIN_COUNT: item.vins.size,
      DEFECT_COUNT: item.defects,
      DPU: totalCp72 > 0 ? Number((item.defects * 1000 / totalCp72).toFixed(2)) : 0,
      POST_NAME: item.post_name,
      TOTAL_CP72_VINS: totalCp72,
    }));

    result.sort((a, b) => b.DEFECT_COUNT - a.DEFECT_COUNT);
    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-electronics-top-defects:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-electronics-vins-top-mpp', async (req, res) => {
  try {
    const { partName, problemType, model, dateFrom, dateTo } = req.query;
    if (!partName || !model || !dateFrom || !dateTo) {
      return res.status(400).json({ error: 'Недостаточно параметров' });
    }

    const finalProblemType = problemType || '';

    const electronicsPosts = [
      'CP7', 'CP7 Gate', 'CP78', 'CP79', 'EXT1',
      'PIP2', 'PIP4', 'PIP9',
      '360', 'ADAS+RB', 'CP8', 'CP8 Gate', 'REPAIR', 'REPAIR_Final',
      'TEST TRACK', 'T-UP', 'WA', 'WT', 'CP8 Touch Up',
      'REPAIR VERIFICATION', 'TRACK', 'ROLL'
    ];
    const postListStr = electronicsPosts.map(p => `'${p}'`).join(',');

    // Шаг 1: VIN с заданным электронным дефектом

    // 1.1 Роботы: refuel_log
    const [refuelVins] = await pool.query(`
      SELECT r.VIN
      FROM at_im_refuel_log r
      JOIN work_order wo ON wo.VIN = r.VIN
      WHERE r.FILL_RESULT IN ('NOK','NG')
        AND r.OIL_TYPE IN ('WW','PREAC','BK','CL1','AC','PREBK','E7')
        AND CASE
          WHEN r.OIL_TYPE = 'BK' THEN 'Заправка тормозов – NG'
          WHEN r.OIL_TYPE = 'AC' THEN 'Заправка кондиционера – NG'
          WHEN r.OIL_TYPE = 'CL1' THEN 'Заправка антифриза - NG'
          WHEN r.OIL_TYPE = 'WW' THEN 'Заправка омывайки - NG'
          WHEN r.OIL_TYPE = 'PREAC' THEN 'Тест утечки кондиц. – NG'
          WHEN r.OIL_TYPE = 'PREBK' THEN 'Тест утечки тормозной – NG'
          WHEN r.OIL_TYPE = 'E7' THEN 'Заправка трансмиссионного – NG'
        END = ?
        AND '' = ?
        AND wo.MODEL = ?
        AND DATE(r.CREATION_TIME) BETWEEN ? AND ?
    `, [partName, finalProblemType, model, dateFrom, dateTo]);

    // 1.2 Роботы: electrical_check_info
    const [electricalVins] = await pool.query(`
      SELECT e.VIN
      FROM at_im_electrical_check_info e
      JOIN work_order wo ON wo.VIN = e.VIN
      WHERE e.RESULT IN ('NOK','NG')
        AND e.\`TYPE\` IN ('03','05','17','21','26','27')
        AND CASE
          WHEN e.\`TYPE\` = '03' THEN 'Прошивка EOL - NG'
          WHEN e.\`TYPE\` = '05' THEN 'ЭП4К - Проверка TMPS – NG'
          WHEN e.\`TYPE\` = '17' THEN 'Запись - Прошивка FLASH – NG'
          WHEN e.\`TYPE\` = '21' THEN 'МДВШ - Прошивка TMPS - NG'
          WHEN e.\`TYPE\` = '26' THEN 'ERA - Прошивка ERA - NG'
          WHEN e.\`TYPE\` = '27' THEN 'APK - Блок управления программируемых специальных функций - Запись кода, не в норме'
        END = ?
        AND '' = ?
        AND wo.MODEL = ?
        AND DATE(e.CREATION_TIME) BETWEEN ? AND ?
    `, [partName, finalProblemType, model, dateFrom, dateTo]);

    // 1.3 Роботы: execute_result
    const [executeVins] = await pool.query(`
      SELECT ex.VIN
      FROM at_im_execute_result ex
      JOIN work_order wo ON wo.VIN = ex.VIN
      WHERE ex.FINAL_RESULT IN ('NOK','NG')
        AND ex.EQP_NUM IN ('AGMADAS01','AGMFL01','AGMRB01','AGMTPMS01','AGMWAHA01')
        AND CASE
          WHEN ex.EQP_NUM = 'AGMADAS01' THEN 'Проверка ADAS - NG'
          WHEN ex.EQP_NUM = 'AGMFL01' THEN 'Тест утечки бензобак - NG'
          WHEN ex.EQP_NUM = 'AGMRB01' THEN 'Проверка R&B - NG'
          WHEN ex.EQP_NUM = 'AGMTPMS01' THEN 'Проверка TMPS – NG'
          WHEN ex.EQP_NUM = 'AGMWAHA01' THEN 'Проверка WA - NG'
        END = ?
        AND '' = ?
        AND wo.MODEL = ?
        AND DATE(ex.CREATION_TIME) BETWEEN ? AND ?
    `, [partName, finalProblemType, model, dateFrom, dateTo]);

    // 1.4 Обычные оффлайн‑дефекты
    const [regularVins] = await pool.query(`
      SELECT reg.VIN
      FROM (
        SELECT VIN, CREATION_TIME, PART_NAME AS part_name, PROBLEM_TYPE AS problem_type
        FROM at_biw_qm_defect_info
        WHERE POST_NAME IN (${postListStr})
          AND (OFFLINE OR OFFLINE1 OR OFFLINE2) = 1
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        UNION ALL
        SELECT VIN, CREATION_TIME, PART_NAME AS part_name, PROBLEM_TYPE AS problem_type
        FROM at_paint_qm_defect_info
        WHERE POST_NAME IN (${postListStr})
          AND (OFFLINE OR OFFLINE1 OR OFFLINE2) = 1
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        UNION ALL
        SELECT VIN, CREATION_TIME, PART_NAME AS part_name, PROBLEM_TYPE AS problem_type
        FROM at_qm_defect_info
        WHERE POST_NAME IN (${postListStr})
          AND (OFFLINE OR OFFLINE1 OR OFFLINE2) = 1
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
      ) reg
      JOIN work_order wo ON wo.VIN = reg.VIN
      WHERE reg.part_name = ? AND reg.problem_type = ?
        AND wo.MODEL = ?
        AND DATE(reg.CREATION_TIME) BETWEEN ? AND ?
    `, [partName, finalProblemType, model, dateFrom, dateTo]);

    // Собираем уникальные VIN
    const vinsSet = new Set();
    [...refuelVins, ...electricalVins, ...executeVins, ...regularVins].forEach(row => vinsSet.add(row.VIN));
    const vins = Array.from(vinsSet);
    if (vins.length === 0) return res.json([]);

    const placeholders = vins.map(() => '?').join(',');

    // Шаг 2: все дефекты (онлайн/оффлайн) для этих VIN
    const defectsSql = `
      SELECT 
        wo.MODEL,
        CONCAT(wo.MODEL, ' ', d.PART_NAME, ' ', d.PROBLEM_TYPE) AS MPP,
        COUNT(*) AS CNT,
        MAX(d.is_offline) AS IS_OFFLINE
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS is_offline
        FROM at_biw_qm_defect_info
        WHERE VIN IN (${placeholders})
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          AND DATE(CREATION_TIME) BETWEEN ? AND ?
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS is_offline
        FROM at_paint_qm_defect_info
        WHERE VIN IN (${placeholders})
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          AND DATE(CREATION_TIME) BETWEEN ? AND ?
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS is_offline
        FROM at_qm_defect_info
        WHERE VIN IN (${placeholders})
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          AND DATE(CREATION_TIME) BETWEEN ? AND ?
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      GROUP BY wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE
      ORDER BY CNT DESC
    `;

    // Параметры: сначала все VIN, затем dateFrom, dateTo для каждого из трёх UNION блоков
    const defectsParams = [...vins, dateFrom, dateTo, ...vins, dateFrom, dateTo, ...vins, dateFrom, dateTo];
    const [defectRows] = await pool.query(defectsSql, defectsParams);

    const result = defectRows.map(r => ({
      MPP: r.MPP.trim(),
      MODEL: r.MODEL,
      DEFECT_COUNT: r.CNT,
      IS_OFFLINE: r.IS_OFFLINE ? 'Оффлайн' : 'Онлайн',
    }));

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-electronics-vins-top-mpp:', err);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/drr-electronics-elec-vins', async (req, res) => {
  try {
    const { typeCode, model, dateFrom, dateTo } = req.query;
    if (!model || !dateFrom || !dateTo) {
      return res.status(400).json({ error: 'model, dateFrom, dateTo обязательны' });
    }
    const types = (typeCode && typeCode !== 'ALL') ? typeCode.split(',') : ['03', '26', '17'];
    const typePlaceholders = types.map(() => '?').join(',');
    const [rows] = await pool.query(`
      SELECT DISTINCT e.VIN, wo.MODEL
      FROM at_im_electrical_check_info e
      JOIN work_order wo ON wo.VIN = e.VIN
      WHERE e.\`TYPE\` IN (${typePlaceholders})
        AND e.RESULT IN ('NG','NOK')
        AND wo.MODEL = ?
        AND e.CREATION_TIME BETWEEN ? AND ?
    `, [...types, model, `${dateFrom} 00:00:00`, `${dateTo} 23:59:59`]);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка drr-electronics-elec-vins:', err);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/drr-electronics-vin-defects', async (req, res) => {
  try {
    const { vin } = req.query; // только VIN, без дат
    if (!vin) return res.status(400).json({ error: 'vin обязателен' });

    // Получаем модель VIN
    const [modelRows] = await pool.query(
      `SELECT MODEL FROM work_order WHERE VIN = ?`,
      [vin]
    );
    if (modelRows.length === 0) return res.json([]);

    // Все дефекты из трёх обычных таблиц (без фильтра по дате и статусу)
    const defectSql = `
      SELECT 
        wo.MODEL,
        CONCAT(wo.MODEL, ' ', d.PART_NAME, ' ', d.PROBLEM_TYPE) AS MPP,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        COUNT(*) AS CNT,
        MAX(d.PROBLEM_REPLENISH) AS COMMENT,
        MAX(d.is_offline) AS IS_OFFLINE
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS is_offline
        FROM at_biw_qm_defect_info
        WHERE VIN = ?
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS is_offline
        FROM at_paint_qm_defect_info
        WHERE VIN = ?
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS is_offline
        FROM at_qm_defect_info
        WHERE VIN = ?
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      GROUP BY wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE
      ORDER BY CNT DESC
    `;

    const [rows] = await pool.query(defectSql, [vin, vin, vin]);

    const result = rows.map(r => ({
      MPP: r.MPP.trim(),
      MODEL: r.MODEL,
      DEFECT_COUNT: r.CNT,
      COMMENT: r.COMMENT || '',
      IS_OFFLINE: r.IS_OFFLINE ? 'Оффлайн' : 'Онлайн',
    }));

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-electronics-vin-defects:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-electronics-defect-trend', async (req, res) => {
  try {
    const { partName, problemType, model, postName, periodType } = req.query;
    if (!partName || model === undefined || !periodType) {
      return res.status(400).json({ error: 'partName, model, periodType обязательны' });
    }
    const finalProblemType = problemType || '';
    const isRobot = postName === 'ROBOT';
    const hasModelFilter = !!(model && model !== 'ALL');
    const modelList = hasModelFilter ? model.split(',').map(m => m.trim()).filter(Boolean) : [];

    // ─── Генерация периодов ───
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
          const ws = new Date(thisMonday);
          ws.setDate(thisMonday.getDate() - i * 7);
          const iso = getISOWeekInfo(ws);
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

    // ─── Общие шаблоны ───
    const makePeriodExpr = (col) => periodType === 'month'
      ? `DATE_FORMAT(DATE(${col}), '%Y-%m')`
      : periodType === 'week'
        ? `DATE_FORMAT(DATE(${col}), '%x-W%v')`
        : `DATE(${col})`;

    const makePeriodIn = (col) => {
      const ph = periods.map(() => '?').join(',');
      return periodType === 'month'
        ? `DATE_FORMAT(DATE(${col}), '%Y-%m') IN (${ph})`
        : periodType === 'week'
          ? `DATE_FORMAT(DATE(${col}), '%x-W%v') IN (${ph})`
          : `DATE(${col}) IN (${ph})`;
    };

    const modelFilterSql = hasModelFilter
      ? ` AND wo.MODEL IN (${modelList.map(() => '?').join(',')})`
      : '';
    const modelParams = hasModelFilter ? modelList : [];

    const electronicsPosts = [
      'CP7', 'CP7 Gate', 'CP78', 'CP79', 'EXT1',
      'PIP2', 'PIP4', 'PIP9',
      '360', 'ADAS+RB', 'CP8', 'CP8 Gate', 'REPAIR', 'REPAIR_Final',
      'TEST TRACK', 'T-UP', 'WA', 'WT', 'CP8 Touch Up',
      'REPAIR VERIFICATION', 'TRACK', 'ROLL'
    ];
    const postListStr = electronicsPosts.map(p => `'${p}'`).join(',');

    let defectRows = [];

    // ============ РОБОТЫ ============
    if (isRobot) {
      // 1) refuel_log
      const [refuelRows] = await pool.query(`
        SELECT ${makePeriodExpr('r.CREATION_TIME')} AS period, COUNT(*) AS cnt
        FROM at_im_refuel_log r
        JOIN work_order wo ON wo.VIN = r.VIN
        WHERE r.FILL_RESULT IN ('NOK','NG')
          AND r.OIL_TYPE IN ('WW','PREAC','BK','CL1','AC','PREBK','E7')
          AND (CASE
            WHEN r.OIL_TYPE = 'BK' THEN 'Заправка тормозов – NG'
            WHEN r.OIL_TYPE = 'AC' THEN 'Заправка кондиционера – NG'
            WHEN r.OIL_TYPE = 'CL1' THEN 'Заправка антифриза - NG'
            WHEN r.OIL_TYPE = 'WW' THEN 'Заправка омывайки - NG'
            WHEN r.OIL_TYPE = 'PREAC' THEN 'Тест утечки кондиц. – NG'
            WHEN r.OIL_TYPE = 'PREBK' THEN 'Тест утечки тормозной – NG'
            WHEN r.OIL_TYPE = 'E7' THEN 'Заправка трансмиссионного – NG'
          END) = ?
          AND '' = ?
          AND ${makePeriodIn('r.CREATION_TIME')}
          ${modelFilterSql}
        GROUP BY period
      `, [partName, finalProblemType, ...periods, ...modelParams]);

      // 2) electrical_check_info
      const [electricalRows] = await pool.query(`
        SELECT ${makePeriodExpr('e.CREATION_TIME')} AS period, COUNT(*) AS cnt
        FROM at_im_electrical_check_info e
        JOIN work_order wo ON wo.VIN = e.VIN
        WHERE e.RESULT IN ('NOK','NG') AND \`TYPE\` IN ('03','05','17','21','26','27')
          AND (CASE
            WHEN \`TYPE\` = '03' THEN 'Прошивка EOL - NG'
            WHEN e.\`TYPE\` = '05' THEN 'ЭП4К - Проверка TMPS – NG'
            WHEN e.\`TYPE\` = '17' THEN 'Запись - Прошивка FLASH – NG'
            WHEN e.\`TYPE\` = '21' THEN 'МДВШ - Прошивка TMPS - NG'
            WHEN e.\`TYPE\` = '26' THEN 'ERA - Прошивка ERA - NG'
            WHEN e.\`TYPE\` = '27' THEN 'APK - Блок управления программируемых специальных функций - Запись кода, не в норме'
          END) = ?
          AND '' = ?
          AND ${makePeriodIn('e.CREATION_TIME')}
          ${modelFilterSql}
        GROUP BY period
      `, [partName, finalProblemType, ...periods, ...modelParams]);

      // 3) execute_result
      const [executeRows] = await pool.query(`
        SELECT ${makePeriodExpr('ex.CREATION_TIME')} AS period, COUNT(*) AS cnt
        FROM at_im_execute_result ex
        JOIN work_order wo ON wo.VIN = ex.VIN
        WHERE ex.FINAL_RESULT IN ('NOK','NG')
          AND ex.EQP_NUM IN ('AGMADAS01','AGMFL01','AGMRB01','AGMTPMS01','AGMWAHA01')
          AND (CASE
            WHEN ex.EQP_NUM = 'AGMADAS01' THEN 'Проверка ADAS - NG'
            WHEN ex.EQP_NUM = 'AGMFL01' THEN 'Тест утечки бензобак - NG'
            WHEN ex.EQP_NUM = 'AGMRB01' THEN 'Проверка R&B - NG'
            WHEN ex.EQP_NUM = 'AGMTPMS01' THEN 'Проверка TMPS – NG'
            WHEN ex.EQP_NUM = 'AGMWAHA01' THEN 'Проверка WA - NG'
          END) = ?
          AND '' = ?
          AND ${makePeriodIn('ex.CREATION_TIME')}
          ${modelFilterSql}
        GROUP BY period
      `, [partName, finalProblemType, ...periods, ...modelParams]);

      defectRows = [...refuelRows, ...electricalRows, ...executeRows];
    } else {
      // ============ ОБЫЧНЫЕ ОФФЛАЙН-ДЕФЕКТЫ ============
      const [regularRows] = await pool.query(`
        SELECT period, COUNT(*) AS cnt
        FROM (
          SELECT ${makePeriodExpr('CREATION_TIME')} AS period, VIN, PART_NAME, PROBLEM_TYPE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_biw_qm_defect_info
          UNION ALL
          SELECT ${makePeriodExpr('CREATION_TIME')} AS period, VIN, PART_NAME, PROBLEM_TYPE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_paint_qm_defect_info
          UNION ALL
          SELECT ${makePeriodExpr('CREATION_TIME')} AS period, VIN, PART_NAME, PROBLEM_TYPE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_qm_defect_info
        ) QM_DEF
        JOIN work_order wo ON wo.VIN = QM_DEF.VIN
        WHERE S_OFFLINE = 1
          AND PART_NAME = ? AND PROBLEM_TYPE = ? AND POST_NAME = ?
          AND ${makePeriodIn('period')}
          ${modelFilterSql}
        GROUP BY period
      `, [partName, finalProblemType, postName, ...periods, ...modelParams]);
      defectRows = regularRows;
    }

    // period → count
    const defectMap = {};
    defectRows.forEach(r => {
      defectMap[r.period] = (defectMap[r.period] || 0) + Number(r.cnt);
    });

    // ─── total_cars по CP72 (уже фильтруется по модели) ───
    const result = [];
    for (const period of periods) {
      const carCondition = periodType === 'month'
        ? `DATE_FORMAT(DATE(t.CREATION_TIME), '%Y-%m') = ?`
        : periodType === 'week'
          ? `DATE_FORMAT(DATE(t.CREATION_TIME), '%x-W%v') = ?`
          : `DATE(t.CREATION_TIME) = ?`;

      let carSql = `
        SELECT COUNT(DISTINCT t.VIN) AS total
        FROM at_om_wiptrackinghistory t
        ${hasModelFilter ? 'JOIN work_order wo ON wo.VIN = t.VIN' : ''}
        WHERE t.WC_NAME = 'CP72'
          AND ${carCondition}
          ${hasModelFilter ? `AND wo.MODEL IN (${modelList.map(() => '?').join(',')})` : ''}
      `;
      const carParams = [period, ...modelParams];
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
    console.error('Ошибка drr-electronics-defect-trend:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-electronics-top-elec-defects', async (req, res) => {
  try {
    const { dateFrom, dateTo, models, categories } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });

    const TYPE_TO_CATEGORY = { '03': 'Прошивка EOL NG', '26': 'Прошивка ERA NG', '17': 'Прошивка Запись/FLASH NG' };
    const CATEGORY_TO_TYPES = {
      'Прошивка EOL NG': ['03'],
      'Прошивка ERA NG': ['26'],
      'Прошивка Запись/FLASH NG': ['17'],
    };
    const ALL_CATEGORIES = Object.keys(CATEGORY_TO_TYPES);

    const selectedCategories = (!categories || categories === 'ALL')
      ? ALL_CATEGORIES
      : categories.split(',').map(s => s.trim()).filter(c => CATEGORY_TO_TYPES[c]);
    const typesToQuery = selectedCategories.flatMap(c => CATEGORY_TO_TYPES[c]);
    if (!typesToQuery.length) return res.json([]);

    const typePlaceholders = typesToQuery.map(() => '?').join(',');
    const params = [...typesToQuery, `${dateFrom} 00:00:00`, `${dateTo} 23:59:59`];

    let modelCondition = '';
    if (models && models !== 'ALL') {
      const modelList = models.split(',').map(s => s.trim()).filter(Boolean);
      if (modelList.length) {
        modelCondition = ` AND wo.MODEL IN (${modelList.map(() => '?').join(',')})`;
        params.push(...modelList);
      }
    }

    // ── 1. Категорийная разбивка: MODEL × TYPE ──
    const [rows] = await pool.query(`
      SELECT
        wo.MODEL,
        e.\`TYPE\` AS TYPE_CODE,
        SUM(CASE WHEN e.RESULT IN ('NG','NOK') THEN 1 ELSE 0 END) AS NG_COUNT,
        SUM(CASE WHEN e.RESULT = 'OK' THEN 1 ELSE 0 END) AS OK_COUNT,
        COUNT(DISTINCT CASE WHEN e.RESULT IN ('NG','NOK') THEN e.VIN END) AS VIN_NG_COUNT,
        COUNT(DISTINCT e.VIN) AS VIN_TOTAL_COUNT
      FROM at_im_electrical_check_info e
      JOIN work_order wo ON wo.VIN = e.VIN
      WHERE e.\`TYPE\` IN (${typePlaceholders})
        AND e.CREATION_TIME BETWEEN ? AND ?
        AND wo.MODEL IS NOT NULL AND wo.MODEL <> '-'
        ${modelCondition}
      GROUP BY wo.MODEL, e.\`TYPE\`
    `, params);

    // ── 2. Агрегат по моделям: DISTINCT VIN без разбивки по типу ──
    const [aggRows] = await pool.query(`
      SELECT
        wo.MODEL,
        SUM(CASE WHEN e.RESULT IN ('NG','NOK') THEN 1 ELSE 0 END) AS NG_COUNT,
        SUM(CASE WHEN e.RESULT = 'OK' THEN 1 ELSE 0 END) AS OK_COUNT,
        COUNT(DISTINCT CASE WHEN e.RESULT IN ('NG','NOK') THEN e.VIN END) AS VIN_NG_COUNT,
        COUNT(DISTINCT e.VIN) AS VIN_TOTAL_COUNT
      FROM at_im_electrical_check_info e
      JOIN work_order wo ON wo.VIN = e.VIN
      WHERE e.\`TYPE\` IN (${typePlaceholders})
        AND e.CREATION_TIME BETWEEN ? AND ?
        AND wo.MODEL IS NOT NULL AND wo.MODEL <> '-'
        ${modelCondition}
      GROUP BY wo.MODEL
    `, params);

    const buildRow = (category, r) => {
      const ng = Number(r.NG_COUNT) || 0;
      const ok = Number(r.OK_COUNT) || 0;
      const total = ng + ok;
      return {
        CATEGORY: category,
        MODEL: r.MODEL,
        DEFECT_COUNT: ng,
        VIN_COUNT: Number(r.VIN_NG_COUNT) || 0,          // VIN с NG
        VIN_TOTAL_COUNT: Number(r.VIN_TOTAL_COUNT) || 0, // VIN всего
        OK_COUNT: ok,
        TOTAL_COUNT: total,
        NG_SHARE: total > 0 ? Number((ng * 100 / total).toFixed(1)) : 0,
      };
    };

    const aggregateRows = aggRows.map(r => buildRow('Агрегат по моделям', r));

    const categoriesMap = new Map();
    rows.forEach(r => {
      const category = TYPE_TO_CATEGORY[r.TYPE_CODE];
      if (!category || !selectedCategories.includes(category)) return;
      if (!categoriesMap.has(category)) categoriesMap.set(category, []);
      categoriesMap.get(category).push(buildRow(category, r));
    });

    const result = [...aggregateRows];
    selectedCategories.forEach(cat => {
      const list = categoriesMap.get(cat) || [];
      list.sort((a, b) => b.DEFECT_COUNT - a.DEFECT_COUNT);
      result.push(...list);
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-electronics-top-elec-defects:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-electronics-elec-defect-trend', async (req, res) => {
  try {
    const { typeCode, model, periodType } = req.query;
    if (!typeCode || !periodType) {
      return res.status(400).json({ error: 'typeCode и periodType обязательны' });
    }

    function getISOWeekInfo(date) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      return { year: d.getUTCFullYear(), week: weekNo };
    }

    const now = new Date();
    const periods = [];
    if (periodType === 'month') {
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }
    } else if (periodType === 'week') {
      const day = now.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const thisMonday = new Date(now);
      thisMonday.setDate(now.getDate() + mondayOffset);
      thisMonday.setHours(0, 0, 0, 0);
      for (let i = 3; i >= 0; i--) {
        const ws = new Date(thisMonday);
        ws.setDate(thisMonday.getDate() - i * 7);
        const iso = getISOWeekInfo(ws);
        periods.push(`${iso.year}-W${String(iso.week).padStart(2, '0')}`);
      }
    } else if (periodType === 'day') {
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      }
    }
    if (periods.length === 0) return res.json([]);

    const periodExpr = periodType === 'month'
      ? "DATE_FORMAT(DATE(e.CREATION_TIME), '%Y-%m')"
      : periodType === 'week'
        ? "DATE_FORMAT(DATE(e.CREATION_TIME), '%x-W%v')"
        : "DATE(e.CREATION_TIME)";

    const types = typeCode.split(',').map(s => s.trim());
    const typePlaceholders = types.map(() => '?').join(',');
    const periodPlaceholders = periods.map(() => '?').join(',');

    let modelCondition = '';
    const defectParams = [...types];
    if (model && model !== 'ALL') {
      modelCondition = ' AND wo.MODEL = ?';
      defectParams.push(model);
    }
    defectParams.push(...periods);

    const [defectRows] = await pool.query(`
      SELECT ${periodExpr} AS period, COUNT(*) AS cnt
      FROM at_im_electrical_check_info e
      JOIN work_order wo ON wo.VIN = e.VIN
      WHERE e.RESULT IN ('NOK','NG')
        AND e.\`TYPE\` IN (${typePlaceholders})
        ${modelCondition}
        AND ${periodExpr} IN (${periodPlaceholders})
      GROUP BY period
    `, defectParams);

    const defectMap = {};
    defectRows.forEach(r => {
      defectMap[r.period] = (defectMap[r.period] || 0) + Number(r.cnt);
    });

    // total_cars по CP72
    const modelList = (model && model !== 'ALL') ? model.split(',').map(m => m.trim()) : [];
    const result = [];

    for (const period of periods) {
      const carCondition = periodType === 'month'
        ? "DATE_FORMAT(DATE(t.CREATION_TIME), '%Y-%m') = ?"
        : periodType === 'week'
          ? "DATE_FORMAT(DATE(t.CREATION_TIME), '%x-W%v') = ?"
          : "DATE(t.CREATION_TIME) = ?";

      let carSql = `
        SELECT COUNT(DISTINCT t.VIN) AS total
        FROM at_om_wiptrackinghistory t
        ${modelList.length > 0 ? 'JOIN work_order wo ON wo.VIN = t.VIN' : ''}
        WHERE t.WC_NAME = 'CP72' AND ${carCondition}
      `;
      const carParams = [period];
      if (modelList.length > 0) {
        carSql += ` AND wo.MODEL IN (${modelList.map(() => '?').join(',')})`;
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
    console.error('Ошибка drr-electronics-elec-defect-trend:', err);
    res.status(500).json({ error: err.message });
  }
});
