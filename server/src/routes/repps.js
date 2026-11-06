// Маршруты: REPPS отчёт.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { mesPool, notesPool, pool } = require('../db');

/* ====================================================================== */
/* ===================== REPPS REPORT =================================== */
/* ====================================================================== */

const REPPS_NODE = 'REPPS';

// Эндпоинт 1: Данные для графиков
app.get('/api/repps-retrospective', async (req, res) => {
  try {
    const { period = 'all', count, fromDate, toDate, hideAssembly } = req.query;

    // 1. Загружаем справочник PS (один раз для всего запроса)
    let psKeySet = new Set();
    try {
      const [psRows] = await notesPool.query(
        "SELECT part_name, defect_type FROM part_defect_shop_mapping WHERE shop = 'PS'"
      );
      psKeySet = new Set(psRows.map(r =>
        `${String(r.part_name || '').trim().toLowerCase()}|${String(r.defect_type || '').trim().toLowerCase()}`
      ));
    } catch (e) {
      console.error('[repps-retrospective] Ошибка загрузки справочника PS:', e.message);
    }

    /* ------------------------------------------------------------------ */
    /* Хелпер: посчитать данные за один период                            */
    /* ------------------------------------------------------------------ */
    const getReps = async (startDate, endDate, label, type) => {
      // 2. Уникальные VIN + их РАННЕЕ время захода в REPPS.
      const [rows] = await mesPool.query(`
        SELECT t.vin, t.first_repps, too.product AS MODEL
        FROM (
          SELECT vin, MIN(gmt_create) AS first_repps
          FROM tm_vhc_test_line_movement
          WHERE node_nature = ? AND is_deleted = 0
          GROUP BY vin
        ) t
        LEFT JOIN tm_ofm_order too ON too.vin = t.vin
        WHERE DATE(t.first_repps) BETWEEN ? AND ?
      `, [REPPS_NODE, startDate, endDate]);

      let filteredRows = rows;

      // 3. ФИЛЬТР "REPPS БЕЗ ДЕФЕКТОВ СБОРКИ" (оставляем только тех, у кого есть дефекты PS)
      if (hideAssembly === 'true' && rows.length > 0) {
        const vins = [...new Set(rows.map(r => r.vin))];
        const ph = vins.map(() => '?').join(',');
        
        // Берем все дефекты из всех трех таблиц
        const [paintDefects] = await pool.query(`SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_paint_qm_defect_info WHERE VIN IN (${ph})`, vins);
        const [qmDefects] = await pool.query(`SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_qm_defect_info WHERE VIN IN (${ph})`, vins);
        const [biwDefects] = await pool.query(`SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_biw_qm_defect_info WHERE VIN IN (${ph})`, vins);
        
        const vinsWithPsDefects = new Set();
        const allDefects = [...paintDefects, ...qmDefects, ...biwDefects];
        
        // Проверяем каждый дефект по справочнику
        allDefects.forEach(d => {
          const key = `${String(d.PART_NAME || '').trim().toLowerCase()}|${String(d.PROBLEM_TYPE || '').trim().toLowerCase()}`;
          if (psKeySet.has(key)) {
            vinsWithPsDefects.add(d.VIN);
          }
        });
        
        // Оставляем только машины, у которых найден хотя бы один дефект из PS
        filteredRows = rows.filter(r => vinsWithPsDefects.has(r.vin));
      }

      const vinModel = new Map();
      filteredRows.forEach(r => {
        if (!vinModel.has(r.vin)) {
          vinModel.set(r.vin, r.MODEL || 'UNKNOWN');
        }
      });

      const total = vinModel.size;

      let paintAll = 0;
      let paintOpen = 0;
      let paintClosedOnly = 0;

      const modelTotal = {};
      const modelPaintOpen = {};
      const modelPaintClosedOnly = {};

      if (total > 0) {
        const vins = [...vinModel.keys()];
        const ph = vins.map(() => '?').join(',');
        const [paintRows] = await pool.query(`
          SELECT VIN, STATUS
          FROM at_paint_qm_defect_info
          WHERE VIN IN (${ph})
        `, vins);

        const vinHasPaint = new Set();
        const vinHasOpenPaint = new Set();

        paintRows.forEach(r => {
          vinHasPaint.add(r.VIN);
          const s = (r.STATUS || '').toUpperCase();
          if (s !== 'CLOSED') vinHasOpenPaint.add(r.VIN);
        });

        paintAll = vinHasPaint.size;
        paintOpen = vinHasOpenPaint.size;
        paintClosedOnly = paintAll - paintOpen;

        vinModel.forEach((m, vin) => {
          modelTotal[m] = (modelTotal[m] || 0) + 1;
          if (vinHasOpenPaint.has(vin)) {
            modelPaintOpen[m] = (modelPaintOpen[m] || 0) + 1;
          } else if (vinHasPaint.has(vin)) {
            modelPaintClosedOnly[m] = (modelPaintClosedOnly[m] || 0) + 1;
          }
        });
      }

      const result = {
        label, type, startDate, endDate, total,
        paint_all: paintAll,
        paint_open: paintOpen,
        paint_closed_only: paintClosedOnly,
        no_paint: total - paintAll,
      };

      Object.keys(modelTotal).forEach(m => {
        const totalM = modelTotal[m];
        const openM = modelPaintOpen[m] || 0;
        const closedM = modelPaintClosedOnly[m] || 0;
        result[m] = totalM;
        result[`${m}_paint_open`] = openM;
        result[`${m}_paint_closed_only`] = closedM;
        result[`${m}_no_paint`] = totalM - openM - closedM;
      });

      return result;
    };

    /* ------------------------------------------------------------------ */
    /* Генерация периодов                                                 */
    /* ------------------------------------------------------------------ */
    const formatDate = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    const pad = (num) => String(num).padStart(2, '0');
    const getISOWeek = (date) => {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };

    const now = new Date();
    const periods = [];
    const typeOrder = { year: 0, month: 1, week: 2, day: 3 };

    if (period === 'all') {
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        periods.push({
          label: `${monthName} ${y}`,
          startDate: `${y}-${m}-01`,
          endDate: `${y}-${m}-${pad(lastDay)}`,
          type: 'month',
        });
      }
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      for (let i = 3; i >= 0; i--) {
        const start = new Date(monday);
        start.setDate(monday.getDate() - i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        periods.push({
          label: `W${getISOWeek(start)} ${start.getFullYear()}`,
          startDate: formatDate(start),
          endDate: formatDate(end),
          type: 'week',
        });
      }
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        periods.push({
          label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`,
          startDate: formatDate(d),
          endDate: formatDate(d),
          type: 'day',
        });
      }
    } else if (fromDate && toDate) {
      let from = new Date(fromDate + 'T00:00:00');
      let to = new Date(toDate + 'T00:00:00');
      if (from > to) [from, to] = [to, from];

      if (period === 'day') {
        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
          const dateStr = formatDate(d);
          periods.push({
            label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`,
            startDate: dateStr,
            endDate: dateStr,
            type: 'day',
          });
        }
      } else if (period === 'month') {
        let d = new Date(from.getFullYear(), from.getMonth(), 1);
        while (d <= to) {
          const y = d.getFullYear();
          const m = d.getMonth() + 1;
          const lastDay = new Date(y, m, 0).getDate();
          const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
          periods.push({
            label: `${monthName} ${y}`,
            startDate: `${y}-${pad(m)}-01`,
            endDate: `${y}-${pad(m)}-${lastDay}`,
            type: 'month',
          });
          d.setMonth(d.getMonth() + 1);
        }
      } else if (period === 'week') {
        const day = from.getDay();
        const monday = new Date(from);
        monday.setDate(from.getDate() - (day === 0 ? 6 : day - 1));
        for (let start = new Date(monday); start <= to; start.setDate(start.getDate() + 7)) {
          const end = new Date(start);
          end.setDate(start.getDate() + 6);
          periods.push({
            label: `W${getISOWeek(start)} ${start.getFullYear()}`,
            startDate: formatDate(start),
            endDate: formatDate(end),
            type: 'week',
          });
        }
      } else if (period === 'year') {
        for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
          periods.push({
            label: String(y),
            startDate: `${y}-01-01`,
            endDate: `${y}-12-31`,
            type: 'year',
          });
        }
      }
    } else {
      const defaultCount = { year: 2, month: 3, week: 4, day: 14 }[period] || 7;
      const limit = parseInt(count, 10) || defaultCount;
      if (period === 'year') {
        for (let i = limit - 1; i >= 0; i--) {
          const y = now.getFullYear() - i;
          periods.push({
            label: String(y),
            startDate: `${y}-01-01`,
            endDate: `${y}-12-31`,
            type: 'year',
          });
        }
      } else if (period === 'month') {
        for (let i = limit - 1; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
          const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
          periods.push({
            label: `${monthName} ${y}`,
            startDate: `${y}-${m}-01`,
            endDate: `${y}-${m}-${pad(lastDay)}`,
            type: 'month',
          });
        }
      } else if (period === 'week') {
        const dayOfWeek = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        for (let i = limit - 1; i >= 0; i--) {
          const start = new Date(monday);
          start.setDate(monday.getDate() - i * 7);
          const end = new Date(start);
          end.setDate(start.getDate() + 6);
          periods.push({
            label: `W${getISOWeek(start)} ${start.getFullYear()}`,
            startDate: formatDate(start),
            endDate: formatDate(end),
            type: 'week',
          });
        }
      } else if (period === 'day') {
        for (let i = limit - 1; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(now.getDate() - i);
          periods.push({
            label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`,
            startDate: formatDate(d),
            endDate: formatDate(d),
            type: 'day',
          });
        }
      }
    }

    periods.sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || a.startDate.localeCompare(b.startDate));

    const result = [];
    for (const p of periods) {
      result.push(await getReps(p.startDate, p.endDate, p.label, p.type));
    }

    res.json({ dataPoints: result });
  } catch (err) {
    console.error('Ошибка /api/repps-retrospective:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// Эндпоинт 2: Данные для модального окна (список VIN и их дефекты)
app.get('/api/repps-vins-details', async (req, res) => {
  try {
    const { dateFrom, dateTo, category = 'total', model, hideAssembly } = req.query;
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });
    }

    // 1. Загружаем справочник PS
    let psKeySet = new Set();
    try {
      const [psRows] = await notesPool.query(
        "SELECT part_name, defect_type FROM part_defect_shop_mapping WHERE shop = 'PS'"
      );
      psKeySet = new Set(psRows.map(r =>
        `${String(r.part_name || '').trim().toLowerCase()}|${String(r.defect_type || '').trim().toLowerCase()}`
      ));
    } catch (e) {
      console.error('[repps-vins-details] Ошибка загрузки справочника PS:', e.message);
    }

    // 2. VIN + первое время REPPS
    let sql = `
      SELECT t.vin, t.first_repps, too.product AS MODEL
      FROM (
        SELECT vin, MIN(gmt_create) AS first_repps
        FROM tm_vhc_test_line_movement
        WHERE node_nature = ? AND is_deleted = 0
        GROUP BY vin
      ) t
      LEFT JOIN tm_ofm_order too ON too.vin = t.vin
      WHERE DATE(t.first_repps) BETWEEN ? AND ?
    `;
    const params = [REPPS_NODE, dateFrom, dateTo];
    if (model && model !== 'ALL') {
      sql += ' AND too.product = ?';
      params.push(model);
    }

    const [rows] = await mesPool.query(sql, params);
    if (rows.length === 0) return res.json([]);

    let filteredRows = rows;

    // 3. ФИЛЬТР "REPPS БЕЗ ДЕФЕКТОВ СБОРКИ" ДЛЯ МОДАЛКИ
    if (hideAssembly === 'true') {
      const vins = rows.map(r => r.vin);
      const ph = vins.map(() => '?').join(',');
      
      const [paintDefects] = await pool.query(`SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_paint_qm_defect_info WHERE VIN IN (${ph})`, vins);
      const [qmDefects] = await pool.query(`SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_qm_defect_info WHERE VIN IN (${ph})`, vins);
      const [biwDefects] = await pool.query(`SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_biw_qm_defect_info WHERE VIN IN (${ph})`, vins);
      
      const vinsWithPsDefects = new Set();
      [...paintDefects, ...qmDefects, ...biwDefects].forEach(d => {
        const key = `${String(d.PART_NAME || '').trim().toLowerCase()}|${String(d.PROBLEM_TYPE || '').trim().toLowerCase()}`;
        if (psKeySet.has(key)) vinsWithPsDefects.add(d.VIN);
      });
      
      // Оставляем только машины, у которых есть совпадение
      filteredRows = rows.filter(r => vinsWithPsDefects.has(r.vin));
    }

    if (filteredRows.length === 0) return res.json([]);

    const vins = filteredRows.map(r => r.vin);
    const ph = vins.map(() => '?').join(',');

    // 4. Время PSOUT (AGMPS01002)
    const [psoutRows] = await mesPool.query(`
      SELECT vin, MAX(scan_time) AS psout_time
      FROM ti_mes_movement
      WHERE uloc_no = 'AGMPS01002' AND is_deleted = 0 AND vin IN (${ph})
      GROUP BY vin
    `, vins);
    const psoutByVin = new Map(psoutRows.map(r => [r.vin, r.psout_time]));

    // 5. Дефекты из Paint (для колонки "Дефекты окраски" и классификации)
    const [paintDefects] = await pool.query(`
      SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, STATUS, CREATION_TIME
      FROM at_paint_qm_defect_info
      WHERE VIN IN (${ph})
      ORDER BY VIN, CREATION_TIME DESC
    `, vins);

    // 6. Дефекты из QM и BIW (для колонки "Дефекты окраски после PS")
    const [qmDefects] = await pool.query(`
      SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, STATUS, CREATION_TIME
      FROM at_qm_defect_info
      WHERE VIN IN (${ph})
    `, vins);

    const [biwDefects] = await pool.query(`
      SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, STATUS, CREATION_TIME
      FROM at_biw_qm_defect_info
      WHERE VIN IN (${ph})
    `, vins);

    // 7. Обработка "Дефекты окраски" (только Paint)
    const defectsByVin = new Map();
    const vinHasPaint = new Set();
    const vinHasOpenPaint = new Set();

    paintDefects.forEach(d => {
      vinHasPaint.add(d.VIN);
      const isOpen = (d.STATUS || '').toUpperCase() !== 'CLOSED';
      if (isOpen) vinHasOpenPaint.add(d.VIN);

      if (!defectsByVin.has(d.VIN)) defectsByVin.set(d.VIN, []);
      defectsByVin.get(d.VIN).push({
        part_name: d.PART_NAME || '',
        problem_type: d.PROBLEM_TYPE || '',
        grade: d.PROBLEM_GRADE || '',
        status: d.STATUS || '',
        is_open: isOpen,
        creation_time: d.CREATION_TIME,
      });
    });

    // 8. Обработка "Дефекты окраски после PS"
    const postPsDefectsByVin = new Map();
    const allDefects = [...paintDefects, ...qmDefects, ...biwDefects];

    allDefects.forEach(d => {
      const key = `${String(d.PART_NAME || '').trim().toLowerCase()}|${String(d.PROBLEM_TYPE || '').trim().toLowerCase()}`;
      const isPs = psKeySet.has(key);

      if (isPs) {
        if (!postPsDefectsByVin.has(d.VIN)) postPsDefectsByVin.set(d.VIN, []);
        postPsDefectsByVin.get(d.VIN).push({
          part_name: d.PART_NAME || '',
          problem_type: d.PROBLEM_TYPE || '',
          grade: d.PROBLEM_GRADE || '',
          status: d.STATUS || '',
          is_open: (d.STATUS || '').toUpperCase() !== 'CLOSED',
          creation_time: d.CREATION_TIME,
        });
      }
    });

    // 9. Фильтр по категории
    let filteredCategory = filteredRows;
    if (category === 'no_paint') {
      filteredCategory = filteredRows.filter(r => !vinHasPaint.has(r.vin));
    } else if (category === 'paint_closed_only') {
      filteredCategory = filteredRows.filter(r => vinHasPaint.has(r.vin) && !vinHasOpenPaint.has(r.vin));
    } else if (category === 'paint_open') {
      filteredCategory = filteredRows.filter(r => vinHasOpenPaint.has(r.vin) && psoutByVin.has(r.vin));
    } else if (category === 'paint_all') {
      filteredCategory = filteredRows.filter(r => vinHasPaint.has(r.vin));
    }

    // 10. Формирование ответа
    const result = filteredCategory.map(r => {
      const defects = (defectsByVin.get(r.vin) || [])
        .sort((a, b) => (b.is_open ? 1 : 0) - (a.is_open ? 1 : 0));

      const rawPostPs = postPsDefectsByVin.get(r.vin) || [];
      const uniquePostPsMap = new Map();
      rawPostPs.forEach(d => {
        const key = `${d.part_name}|${d.problem_type}|${d.creation_time}`;
        if (!uniquePostPsMap.has(key)) {
          uniquePostPsMap.set(key, d);
        }
      });
      const postPsDefects = Array.from(uniquePostPsMap.values())
        .sort((a, b) => (b.is_open ? 1 : 0) - (a.is_open ? 1 : 0));

      return {
        vin: r.vin,
        model: r.MODEL || '—',
        repps_time: r.first_repps,
        psout_time: psoutByVin.get(r.vin) || null,
        defects,
        post_ps_defects: postPsDefects,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/repps-vins-details:', err.message);
    res.status(500).json({ error: err.message });
  }
});
