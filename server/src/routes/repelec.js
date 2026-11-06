// Маршруты: REP ELEC отчёт.
// Код перенесён из server.js без изменений.

const { buildReelecPeriods } = require('../lib/shared');
const { app } = require('../app');
const { bmsPool, mesPool, notesPool, pool } = require('../db');

// Хелпер: определение смены по времени CP72 (с учетом ротации недель)
function getShiftInfoByDate(dateStr) {
  const d = new Date(dateStr);
  const moscow = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const mins = moscow.getUTCHours() * 60 + moscow.getUTCMinutes();

  let shiftType;
  let shiftDate = new Date(moscow);
  if (mins >= 7 * 60 + 50 && mins <= 16 * 60 + 40) {
    shiftType = 'day';
  } else if (mins >= 16 * 60 + 41 || mins <= 1 * 60 + 30) {
    shiftType = 'evening';
    if (mins <= 1 * 60 + 30) shiftDate.setUTCDate(shiftDate.getUTCDate() - 1);
  } else {
    shiftType = 'night';
  }

  const tmp = new Date(Date.UTC(shiftDate.getUTCFullYear(), shiftDate.getUTCMonth(), shiftDate.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  const isEven = weekNumber % 2 === 0;

  if (shiftType === 'night') return 'C';
  if (shiftType === 'day') return isEven ? 'B' : 'A';
  return isEven ? 'A' : 'B';
}

// =======================================================================
// ЭНДПОИНТ 1: Данные для графика
// =======================================================================
app.get('/api/repelec-report', async (req, res) => {
  try {
    const { period = 'all', count = 3, fromDate, toDate } = req.query;

    const [maxDateRows] = await mesPool.query(`
      SELECT MAX(gmt_create) AS max_time 
      FROM tm_vhc_test_line_movement 
      WHERE node_nature = 'REPELEC' AND (is_deleted = 0 OR is_deleted IS NULL)
    `);
    
    let baseDate = maxDateRows[0]?.max_time ? new Date(maxDateRows[0].max_time) : new Date();
    const periods = buildReelecPeriods({ period, count, fromDate, toDate, baseDate: baseDate.toISOString() });
    
    if (periods.length === 0) return res.json({ dataPoints: [] });

    const ALL_MODELS = ['ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];
    const dataPoints = [];

    for (const p of periods) {
      // Формируем границы для поиска CP72 (с учетом смен: с 01:31 текущего дня до 01:30 следующего)
      const sDate = p.startDate.split(' ')[0];
      const eDate = p.endDate.split(' ')[0];
      const endDateObj = new Date(eDate + 'T00:00:00');
      endDateObj.setDate(endDateObj.getDate() + 1);
      const eDateNext = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, '0')}-${String(endDateObj.getDate()).padStart(2, '0')}`;

      const [cp72Rows] = await mesPool.query(`
        SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
        FROM ti_mes_movement
        WHERE uloc_no = 'CP72' AND (is_deleted = 0 OR is_deleted IS NULL)
          AND scan_time >= ? AND scan_time <= ?
        GROUP BY vin
      `, [`${sDate} 01:31:00`, `${eDateNext} 01:30:00`]);

      const vins = cp72Rows.map(r => r.VIN);
      const point = { type: p.type, label: p.label, startDate: p.startDate, endDate: p.endDate, shiftA: 0, shiftB: 0, total: 0 };
      ALL_MODELS.forEach(m => { point[`${m}_A`] = 0; point[`${m}_B`] = 0; });

      if (vins.length > 0) {
        const ph = vins.map(() => '?').join(',');
        
        // Проверяем, есть ли эти машины в REPELEC
        const [repelecRows] = await mesPool.query(`
          SELECT DISTINCT UPPER(vin) AS VIN
          FROM tm_vhc_test_line_movement
          WHERE node_nature = 'REPELEC' AND (is_deleted = 0 OR is_deleted IS NULL) AND vin IN (${ph})
        `, [...vins]);
        const hasRepelec = new Set(repelecRows.map(r => r.VIN));

        // Модели
        const [modelRows] = await pool.query(`SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})`, vins);
        const modelMap = new Map(modelRows.map(r => [r.VIN, r.MODEL]));

        cp72Rows.forEach(r => {
          if (!hasRepelec.has(r.VIN)) return; // Если нет в REPELEC, не считаем

          const shiftLetter = getShiftInfoByDate(r.CP72_TIME); 
          const model = modelMap.get(r.VIN) || 'UNKNOWN';

          if (shiftLetter === 'A') {
            point.shiftA++;
            if (point[`${model}_A`] !== undefined) point[`${model}_A`]++;
          } else if (shiftLetter === 'B') {
            point.shiftB++;
            if (point[`${model}_B`] !== undefined) point[`${model}_B`]++;
          }
        });
      }
      point.total = point.shiftA + point.shiftB;
      dataPoints.push(point);
    }
    res.json({ dataPoints });
  } catch (err) {
    console.error('Ошибка /api/repelec-report:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================================
// ЭНДПОИНТ 2: Детализация модального окна
// =======================================================================
app.get('/api/repelec-vins', async (req, res) => {
  try {
    const { dateFrom, dateTo, shift, model } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom, dateTo обязательны' });

    const sDate = dateFrom.split(' ')[0];
    const eDate = dateTo.split(' ')[0];
    const endDateObj = new Date(eDate + 'T00:00:00');
    endDateObj.setDate(endDateObj.getDate() + 1);
    const eDateNext = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, '0')}-${String(endDateObj.getDate()).padStart(2, '0')}`;

    // 1. Ищем машины с CP72 за этот период
    const [cp72Rows] = await mesPool.query(`
      SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72' AND (is_deleted = 0 OR is_deleted IS NULL)
        AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [`${sDate} 01:31:00`, `${eDateNext} 01:30:00`]);

    if (cp72Rows.length === 0) return res.json([]);
    let vins = cp72Rows.map(r => r.VIN);
    const cp72Map = new Map(cp72Rows.map(r => [r.VIN, r.CP72_TIME]));
    const ph = vins.map(() => '?').join(',');

    // 2. Проверяем наличие в REPELEC
    const [repelecRows] = await mesPool.query(`
      SELECT UPPER(vin) AS VIN, MIN(gmt_create) AS REPELEC_TIME
      FROM tm_vhc_test_line_movement
      WHERE node_nature = 'REPELEC' AND (is_deleted = 0 OR is_deleted IS NULL)
        AND vin IN (${ph})
      GROUP BY vin
    `, [...vins]);
    const repelecMap = new Map(repelecRows.map(r => [r.VIN, r.REPELEC_TIME]));

    // 3. Модели
    const [modelRows] = await pool.query(`SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})`, vins);
    const modelMap = new Map(modelRows.map(r => [r.VIN, r.MODEL || '—']));

    // 4. Фильтрация
    let filteredVins = [];
    vins.forEach(v => {
      if (!repelecMap.has(v)) return;
      const cp72Time = cp72Map.get(v);
      const shiftLetter = getShiftInfoByDate(cp72Time);
      if (shiftLetter !== shift) return;
      const vModel = modelMap.get(v) || '—';
      if (model && model !== 'ALL' && vModel !== model) return;
      filteredVins.push(v);
    });

    if (filteredVins.length === 0) return res.json([]);
    const vinsPh = filteredVins.map(() => '?').join(',');

    // 5. Дефекты IOT
    const [defectRows] = await pool.query(`
      SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_DESCRIPTION, PROBLEM_REPLENISH, POST_NAME, MISS_PART
      FROM at_qm_defect_info 
      WHERE VIN IN (${vinsPh})
    `, filteredVins);

    const iotByVin = new Map();
    defectRows.forEach(r => {
      if (!iotByVin.has(r.VIN)) iotByVin.set(r.VIN, []);
      iotByVin.get(r.VIN).push({
        time: r.CREATION_TIME, part_name: r.PART_NAME || '—', problem_type: r.PROBLEM_TYPE || '—',
        description: r.PROBLEM_DESCRIPTION || '—', comment: r.PROBLEM_REPLENISH || '—',
        post: r.POST_NAME || '—', miss_part: r.MISS_PART || '—'
      });
    });

    // 6. Дефекты BMS (Добавлен DISTINCT для предотвращения дубликатов)
    let bmsDefectsRows = [];
    try {
      const [bmsRows] = await bmsPool.query(`
        SELECT DISTINCT UPPER(vin) AS VIN, test_station, module_name, result, fault_content 
        FROM qr_test_details 
        WHERE result != 'OK' AND vin IN (${vinsPh})
      `, filteredVins);
      bmsDefectsRows = bmsRows;
    } catch (bmsErr) {
      console.error('⚠️ Ошибка загрузки BMS:', bmsErr.message);
    }

    // 7. Заметки BMS из БД
    const [notesRows] = await notesPool.query(`
      SELECT vin, test_station, module_name, fault_content, note_text 
      FROM repelec_bms_notes WHERE vin IN (${vinsPh})
    `, filteredVins);
    
    const notesMap = new Map();
    notesRows.forEach(r => {
      const key = `${r.vin}|${r.test_station}|${r.module_name}|${r.fault_content}`;
      notesMap.set(key, r.note_text);
    });

    // 8. Сборка BMS с заметками
    const bmsByVin = new Map();
    bmsDefectsRows.forEach(r => {
      if (!bmsByVin.has(r.VIN)) bmsByVin.set(r.VIN, []);
      
      const key = `${r.VIN}|${r.test_station}|${r.module_name}|${r.fault_content}`;
      bmsByVin.get(r.VIN).push({
        test_station: r.test_station || '—',
        module_name: r.module_name || '—',
        result: r.result || '—',
        fault_content: r.fault_content || '—',
        note: notesMap.get(key) || '' // Привязываем заметку
      });
    });

    // 9. Итог
    const uniqueVins = [...new Set(filteredVins)];
    const result = uniqueVins.map(v => ({
      vin: v,
      model: modelMap.get(v) || '—',
      repelec_time: repelecMap.get(v),
      cp72_time: cp72Map.get(v) || null,
      iot_defects: iotByVin.get(v) || [],
      bms_defects: bmsByVin.get(v) || []
    }));

    result.sort((a, b) => new Date(a.repelec_time) - new Date(b.repelec_time));
    res.json(result);

  } catch (err) {
    console.error('Ошибка /api/repelec-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Сохранение заметки к конкретному дефекту BMS
app.post('/api/repelec-bms-notes', async (req, res) => {
  try {
    const { vin, test_station, module_name, fault_content, note } = req.body;
    if (!vin || !test_station || !module_name || !fault_content) {
      return res.status(400).json({ error: 'Не все обязательные поля переданы' });
    }
    
    await notesPool.query(`
      INSERT INTO repelec_bms_notes (vin, test_station, module_name, fault_content, note_text) 
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE note_text = VALUES(note_text)
    `, [vin, test_station, module_name, fault_content, note || '']);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения заметки BMS:', err);
    res.status(500).json({ error: err.message });
  }
});
