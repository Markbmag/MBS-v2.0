// Маршруты: динамика BMS (CP7 / прошивка).
// Код перенесён из server.js без изменений.

const { buildReelecPeriods } = require('../lib/shared');
const { app } = require('../app');
const { bmsPool, notesPool, pool } = require('../db');

/* ====================================================================== */
/* ===================== BMS DYNAMICS (CP7 / FLASH) ===================== */
/* ====================================================================== */

// Колонка времени в BMS (varchar)
const BMS_TIME_COLUMN = 'create_time';


/* ---------------------------------------------------------------------- */
/* 1. ГРАФИКИ (Composed Chart: Машины, Дефекты, %)                        */
/* ---------------------------------------------------------------------- */
app.get('/api/bms-dynamics-chart', async (req, res) => {
  try {
    const { period = 'week', count = 7, fromDate, toDate } = req.query;

    // Берем максимальную дату из BMS для базы расчета
    const [maxDateRows] = await bmsPool.query(`SELECT MAX(${BMS_TIME_COLUMN}) AS max_time FROM qr_test_details`);
    let baseDate = maxDateRows[0]?.max_time ? new Date(maxDateRows[0].max_time) : new Date();
    
    // Генерируем периоды
    const periods = buildReelecPeriods({ period, count, fromDate, toDate, baseDate: baseDate.toISOString() });
    const models = ['ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];
    
    const result = { general: [], models: {} };
    models.forEach(m => { result.models[m] = []; });

    for (const p of periods) {
      // Ищем только станции CP7 и Flash
      const [bmsRows] = await bmsPool.query(`
        SELECT UPPER(vin) AS VIN, result 
        FROM qr_test_details
        WHERE (test_station LIKE '%CP7%' OR test_station LIKE '%Flash%')
          AND ${BMS_TIME_COLUMN} >= ? AND ${BMS_TIME_COLUMN} <= ?
      `, [p.startDate, p.endDate]);

      const uniqueVins = [...new Set(bmsRows.map(r => r.VIN))];
      let modelMap = {};
      if (uniqueVins.length > 0) {
        const ph = uniqueVins.map(() => '?').join(',');
        const [wRows] = await pool.query(`SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})`, uniqueVins);
        wRows.forEach(r => modelMap[r.VIN] = r.MODEL);
      }

      // Статистика: 1 NOK = 1 Машина
      const stats = {
        totalVins: new Set(),
        nokVins: new Set(),
        modelStats: {}
      };
      models.forEach(m => { stats.modelStats[m] = { totalVins: new Set(), nokVins: new Set() }; });

      bmsRows.forEach(r => {
        const isNok = r.result && r.result.toUpperCase() !== 'OK';
        const vin = r.VIN;
        const vModel = modelMap[vin] || 'UNKNOWN';

        stats.totalVins.add(vin);
        if (isNok) stats.nokVins.add(vin);

        if (stats.modelStats[vModel]) {
          stats.modelStats[vModel].totalVins.add(vin);
          if (isNok) stats.modelStats[vModel].nokVins.add(vin);
        }
      });

      // Общая точка
      result.general.push({
        label: p.label,
        machines: stats.totalVins.size,
        defects: stats.nokVins.size,
        percent: stats.totalVins.size > 0 ? Number(((stats.nokVins.size / stats.totalVins.size) * 100).toFixed(1)) : 0
      });

      // Точки по моделям
      models.forEach(m => {
        const mStats = stats.modelStats[m];
        result.models[m].push({
          label: p.label,
          machines: mStats.totalVins.size,
          defects: mStats.nokVins.size,
          percent: mStats.totalVins.size > 0 ? Number(((mStats.nokVins.size / mStats.totalVins.size) * 100).toFixed(1)) : 0
        });
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Ошибка bms-dynamics-chart:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* 2. ТАБЛИЦА NOK VIN'ОВ (С возможностью писать комменты)                 */
/* ---------------------------------------------------------------------- */
app.get('/api/bms-cp7-nok-vins', async (req, res) => {
  try {
    const { dateFrom, dateTo, model } = req.query;

    // 1. Получаем все NOK детали по CP7/Flash
    const [rows] = await bmsPool.query(`
      SELECT UPPER(vin) AS VIN, test_station, module_name, fault_content, ${BMS_TIME_COLUMN} AS event_time
      FROM qr_test_details
      WHERE (test_station LIKE '%CP7%' OR test_station LIKE '%Flash%')
        AND result != 'OK' 
        AND ${BMS_TIME_COLUMN} >= ? AND ${BMS_TIME_COLUMN} <= ?
    `, [dateFrom, dateTo]);

    if (rows.length === 0) return res.json([]);

    const uniqueVins = [...new Set(rows.map(r => r.VIN))];
    const ph = uniqueVins.map(() => '?').join(',');

    // 2. Модели
    const [wRows] = await pool.query(`SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})`, uniqueVins);
    const modelMap = new Map(wRows.map(r => [r.VIN, r.MODEL]));

    // 3. Существующие заметки (сохраняем в той же таблице, что и REPELEC)
    const [notesRows] = await notesPool.query(`
      SELECT vin, test_station, module_name, fault_content, note_text 
      FROM repelec_bms_notes WHERE vin IN (${ph})
    `, uniqueVins);
    const notesMap = new Map();
    notesRows.forEach(r => {
      notesMap.set(`${r.vin}|${r.test_station}|${r.module_name}|${r.fault_content}`, r.note_text);
    });

    // 4. Сборка с удалением дублей
    const uniqueMap = new Map();
    rows.forEach(r => {
      const key = `${r.VIN}|${r.test_station}|${r.module_name}|${r.fault_content}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          vin: r.VIN,
          model: modelMap.get(r.VIN) || '—',
          test_station: r.test_station,
          module_name: r.module_name,
          fault_content: r.fault_content,
          created_at: r.event_time, // Отдаем как created_at для фронта
          note: notesMap.get(key) || ''
        });
      }
    });

    let result = Array.from(uniqueMap.values());
    if (model && model !== 'ALL') {
      result = result.filter(r => r.model === model);
    }

    res.json(result);
  } catch (err) {
    console.error('Ошибка bms-cp7-nok-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. ТОП ПОВТОРЕНИЙ ОШИБОК (Модуль + Ошибка)
app.get('/api/bms-top-errors', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const [rows] = await bmsPool.query(`
      SELECT 
        module_name,
        fault_content,
        COUNT(DISTINCT vin) as defect_count
      FROM qr_test_details
      WHERE (test_station LIKE '%CP7%' OR test_station LIKE '%Flash%')
        AND result != 'OK'
        AND ${BMS_TIME_COLUMN} >= ? AND ${BMS_TIME_COLUMN} <= ?
      GROUP BY module_name, fault_content
      ORDER BY defect_count DESC
      LIMIT 15
    `, [dateFrom, dateTo]);

    // Считаем общее количество уникальных VIN с ошибками для расчета процента
    const [totalRows] = await bmsPool.query(`
      SELECT COUNT(DISTINCT vin) as total
      FROM qr_test_details
      WHERE (test_station LIKE '%CP7%' OR test_station LIKE '%Flash%')
        AND result != 'OK'
        AND ${BMS_TIME_COLUMN} >= ? AND ${BMS_TIME_COLUMN} <= ?
    `, [dateFrom, dateTo]);
    
    const totalNokVins = totalRows[0]?.total || 1;

    const result = rows.map(r => ({
      module_name: r.module_name || '—',
      fault_content: r.fault_content || '—',
      defect_count: Number(r.defect_count),
      percent: Number(((r.defect_count / totalNokVins) * 100).toFixed(1))
    }));

    res.json(result);
  } catch (err) {
    console.error('Ошибка bms-top-errors:', err.message);
    res.status(500).json({ error: err.message });
  }
});
