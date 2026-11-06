// Маршруты: DRR электроники (BMS) — основные.
// Код перенесён из server.js без изменений.

const { app } = require('../../app');
const { bmsPool, mesPool } = require('../../db');

/* ====================================================================== */
/* ================== DRR ELECTRONICS (BMS) ============================= */
/* ====================================================================== */

// 1. Главный дашборд (Ватрушка)
app.get('/api/drr-electronics-bms-dashboard', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const sTime = startTime || `${todayStr} 00:00:00`;
    const eTime = endTime || `${todayStr} 23:59:59`;

    // 1. Прошли CP72 (из MES)
    const [cp72Rows] = await mesPool.query(`
      SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72'
        AND is_deleted = 0
        AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [sTime, eTime]);

    const totalVins = cp72Rows.length;
    const cp72Map = new Map(cp72Rows.map(r => [r.VIN, r.CP72_TIME]));

    if (totalVins === 0) {
      return res.json({ totalVins: 0, closedVins: 0, nokVins: 0, drrPercent: 0 });
    }

    const vins = cp72Rows.map(r => r.VIN);
    const ph = vins.map(() => '?').join(',');

    // 2. Последний ОК по трем станциям (CP7, Flash, ERA Write Vin) из BMS
    const [bmsOkRows] = await bmsPool.query(`
      SELECT UPPER(vin) AS VIN, MAX(test_time) AS MAX_OK_TIME
      FROM qr_test_result
      WHERE result = 'OK'
        AND test_station IN ('CP7', 'Flash', 'ERA Write Vin')
        AND vin IN (${ph})
      GROUP BY vin
      HAVING COUNT(DISTINCT test_station) = 3
    `, vins);

    const okSet = new Set();
    bmsOkRows.forEach(row => {
      const cp72TimeStr = cp72Map.get(row.VIN);
      if (!cp72TimeStr) return;

      const cp72Ms = new Date(cp72TimeStr).getTime();
      const okMs = new Date(row.MAX_OK_TIME).getTime();

      // Условие: CP72 + 5 минут > последний ОК
      if (cp72Ms + 5 * 60 * 1000 > okMs) {
        okSet.add(row.VIN);
      }
    });

    const closedVins = okSet.size;
    const nokVins = totalVins - closedVins;
    const drrPercent = totalVins > 0 ? (closedVins / totalVins) * 100 : 0;

    res.json({
      totalVins,
      closedVins,
      nokVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
    });
  } catch (err) {
    console.error('❌ Ошибка DRR Electronics Dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. Топ дефектов (ТОЛЬКО ПО NOK АВТО)
app.get('/api/drr-electronics-bms-top-defects', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const sTime = startTime || `${todayStr} 00:00:00`;
    const eTime = endTime || `${todayStr} 23:59:59`;

    // 1. Получаем NOK VIN'ы (та же логика, что и в дашборде)
    const [cp72Rows] = await mesPool.query(`
      SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72' AND is_deleted = 0 AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [sTime, eTime]);

    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.VIN);
    const cp72Map = new Map(cp72Rows.map(r => [r.VIN, new Date(r.CP72_TIME).getTime()]));
    const ph = vins.map(() => '?').join(',');

    const [bmsOkRows] = await bmsPool.query(`
      SELECT UPPER(vin) AS VIN, MAX(test_time) AS MAX_OK_TIME
      FROM qr_test_result
      WHERE result = 'OK' AND test_station IN ('CP7', 'Flash', 'ERA Write Vin') AND vin IN (${ph})
      GROUP BY vin
      HAVING COUNT(DISTINCT test_station) = 3
    `, vins);

    const okSet = new Set();
    bmsOkRows.forEach(row => {
      const cp72Ms = cp72Map.get(row.VIN);
      if (cp72Ms && (cp72Ms + 5 * 60 * 1000 > new Date(row.MAX_OK_TIME).getTime())) {
        okSet.add(row.VIN);
      }
    });

    const nokVins = vins.filter(v => !okSet.has(v));
    if (nokVins.length === 0) return res.json([]);

    // 2. Ищем дефекты ТОЛЬКО у этих NOK VIN'ов
    const nokPh = nokVins.map(() => '?').join(',');
    const [rows] = await bmsPool.query(`
      SELECT 
        test_station, 
        module_name, 
        COUNT(DISTINCT vin) AS defectCount
      FROM qr_test_details
      WHERE test_time >= ? AND test_time <= ?
        AND vin IN (${nokPh})
        AND result != 'OK'
        AND test_station NOT LIKE 'R%' 
        AND test_station NOT LIKE 'CP8%'
      GROUP BY test_station, module_name
      ORDER BY defectCount DESC
      LIMIT 50
    `, [sTime, eTime, ...nokVins]);

    res.json(rows);
  } catch (err) {
    console.error('❌ Ошибка DRR Electronics Top Defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. Детализация по MPP (с показом времени и фильтрацией по NOK)
app.get('/api/drr-electronics-bms-mpp-vins', async (req, res) => {
  try {
    const { startTime, endTime, test_station, module_name } = req.query;

    if (!startTime || !endTime || !test_station || !module_name) {
      return res.status(400).json({ error: 'Недостаточно параметров для детализации' });
    }

    // 1. Получаем машины, прошедшие CP72 (из MES)
    const [cp72Rows] = await mesPool.query(`
      SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72' AND is_deleted = 0 
        AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [startTime, endTime]);

    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.VIN);
    // Сохраняем время CP72 в миллисекундах для точного сравнения
    const cp72Map = new Map(cp72Rows.map(r => [r.VIN, new Date(r.CP72_TIME).getTime()]));
    const ph = vins.map(() => '?').join(',');

    // 2. Вычисляем NOK VIN'ы (только те, у кого нет всех 3-х ОК или они старые)
    const [bmsOkRows] = await bmsPool.query(`
      SELECT UPPER(vin) AS VIN, MAX(test_time) AS MAX_OK_TIME
      FROM qr_test_result
      WHERE result = 'OK' AND test_station IN ('CP7', 'Flash', 'ERA Write Vin') AND vin IN (${ph})
      GROUP BY vin
      HAVING COUNT(DISTINCT test_station) = 3
    `, vins);

    const okSet = new Set();
    bmsOkRows.forEach(row => {
      const cp72Ms = cp72Map.get(row.VIN);
      if (cp72Ms && (cp72Ms + 5 * 60 * 1000 > new Date(row.MAX_OK_TIME).getTime())) {
        okSet.add(row.VIN);
      }
    });

    const nokVins = vins.filter(v => !okSet.has(v));
    if (nokVins.length === 0) return res.json([]);

    const nokPh = nokVins.map(() => '?').join(',');

    // 3. Получаем ошибки ТОЛЬКО для NOK VIN'ов
    const [defectRows] = await bmsPool.query(`
      SELECT 
        UPPER(vin) AS vin, 
        test_time, 
        fault_content
      FROM qr_test_details
      WHERE test_time >= ? AND test_time <= ?
        AND vin IN (${nokPh})
        AND result != 'OK'
        AND test_station = ? 
        AND module_name = ?
      ORDER BY test_time ASC
    `, [startTime, endTime, ...nokVins, test_station, module_name]);

    if (defectRows.length === 0) return res.json([]);

    const filteredVins = [...new Set(defectRows.map(r => r.vin))];
    const fPh = filteredVins.map(() => '?').join(',');

    // 4. Получаем время ПОСЛЕДНЕГО ОК для каждой из 3 станций отдельно (для этих NOK VIN)
    const [lastOkRows] = await bmsPool.query(`
      SELECT 
        UPPER(vin) AS VIN,
        MAX(CASE WHEN test_station = 'CP7' AND result = 'OK' THEN test_time END) AS CP7_OK,
        MAX(CASE WHEN test_station = 'Flash' AND result = 'OK' THEN test_time END) AS FLASH_OK,
        MAX(CASE WHEN test_station = 'ERA Write Vin' AND result = 'OK' THEN test_time END) AS ERA_OK
      FROM qr_test_result
      WHERE vin IN (${fPh}) 
        AND test_station IN ('CP7', 'Flash', 'ERA Write Vin')
      GROUP BY vin
    `, filteredVins);
    
    const lastOkMap = new Map(lastOkRows.map(r => [r.VIN, r]));

    // 5. Формируем ответ с расчетом порогового времени (CP72 + 5 мин)
    const result = defectRows.map(row => {
      const okData = lastOkMap.get(row.vin) || {};
      const cp72Ms = cp72Map.get(row.vin);
      
      // Вычисляем порог: CP72 + 5 минут
      const cp72Plus5m = cp72Ms ? new Date(cp72Ms + 5 * 60 * 1000).toISOString() : null;

      return {
        vin: row.vin,
        test_time: row.test_time,
        module_name: module_name,
        fault_content: row.fault_content || '—',
        cp72_time: cp72Ms ? new Date(cp72Ms).toISOString() : null,
        cp72_plus_5m: cp72Plus5m, 
        cp7_ok: okData.CP7_OK || null,
        flash_ok: okData.FLASH_OK || null,
        era_ok: okData.ERA_OK || null
      };
    });

    res.json(result);
  } catch (err) {
    console.error('❌ Ошибка DRR Electronics MPP Vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. Список VIN по OK/NG для модального окна
app.get('/api/drr-electronics-bms-vins', async (req, res) => {
  try {
    const { startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'Недостаточно параметров' });
    }

    const [cp72Rows] = await mesPool.query(`
      SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72' AND is_deleted = 0 
        AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [startTime, endTime]);

    if (cp72Rows.length === 0) return res.json([]);
    
    const vins = cp72Rows.map(r => r.VIN);
    const cp72Map = new Map(cp72Rows.map(r => [r.VIN, r.CP72_TIME]));
    const ph = vins.map(() => '?').join(',');

    const [bmsOkRows] = await bmsPool.query(`
      SELECT UPPER(vin) AS VIN, MAX(test_time) AS MAX_OK_TIME
      FROM qr_test_result
      WHERE result = 'OK'
        AND test_station IN ('CP7', 'Flash', 'ERA Write Vin')
        AND vin IN (${ph})
      GROUP BY vin
      HAVING COUNT(DISTINCT test_station) = 3
    `, vins);

    const okSet = new Set();
    bmsOkRows.forEach(row => {
      const cp72TimeStr = cp72Map.get(row.VIN);
      if (!cp72TimeStr) return;
      const cp72Ms = new Date(cp72TimeStr).getTime();
      const okMs = new Date(row.MAX_OK_TIME).getTime();
      
      if (cp72Ms + 5 * 60 * 1000 > okMs) {
        okSet.add(row.VIN);
      }
    });

    const result = [];
    cp72Rows.forEach(row => {
      const isOk = okSet.has(row.VIN);
      if (status === 'OK' && isOk) {
        result.push({ vin: row.VIN, cp72_time: row.CP72_TIME });
      } else if (status === 'NOK' && !isOk) {
        result.push({ vin: row.VIN, cp72_time: row.CP72_TIME });
      }
    });

    result.sort((a, b) => new Date(a.cp72_time) - new Date(b.cp72_time));
    res.json(result);

  } catch (err) {
    console.error('❌ Ошибка DRR Electronics BMS Vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});
