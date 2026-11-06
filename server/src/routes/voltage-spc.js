// Маршруты: Voltage SPC.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { mesPool, pool } = require('../db');

/* ====================================================================== */
/* 1. VOLTAGE SPC REPORT (Основная выборка)                               */
/* ====================================================================== */
app.get('/api/voltage-spc', async (req, res) => {
  try {
    const { vin, dateFrom, dateTo, cp8Start, cp8End } = req.query;

    // 1. Получаем VINs, прошедшие CP8
    let cp8Vins = new Set();
    let cp8DateMap = new Map();

    if (cp8Start && cp8End) {
      const [cp8Rows] = await mesPool.query(`
        SELECT vin, MAX(scan_time) AS CP8_DATE
        FROM ti_mes_movement
        WHERE uloc_no = 'AGMAS01004'
          AND is_deleted = 0
          AND scan_time >= ? AND scan_time <= ?
        GROUP BY vin
      `, [cp8Start.replace('T', ' ') + ':00', cp8End.replace('T', ' ') + ':59']);

      cp8Rows.forEach(r => {
        cp8Vins.add(r.vin);
        cp8DateMap.set(r.vin, r.CP8_DATE);
      });
    }

    // 2. Получаем VINs с NOK тестами (строго < 12.6 или строго > 13)
    let nokVins = new Set();

    if (dateFrom && dateTo) {
      const [nokRows] = await pool.query(`
        SELECT DISTINCT i.VIN
        FROM at_im_electrical_check_dtl d
        JOIN at_im_electrical_check_info i ON i.ID = d.MAIN_ID
        WHERE d.ITEMNAME = 'VehicleDataDetail-EMS-Battery_Voltage'
          AND (
            CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) < 12.6 
            OR 
            CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) > 13
          )
          AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
      `, [`${dateFrom} 00:00:00`, `${dateTo} 23:59:59`]);
      
      nokRows.forEach(r => nokVins.add(r.VIN));
    }

    // 3. Объединяем списки VIN
    let allVins = new Set([...cp8Vins, ...nokVins]);

    if (vin && String(vin).trim()) {
      const search = String(vin).trim();
      allVins = new Set([...allVins].filter(v => v.includes(search)));
    }

    if (allVins.size === 0) return res.json([]);
    const vins = [...allVins];
    const placeholders = vins.map(() => '?').join(',');

    // 4. Модели
    const [modelRows] = await pool.query(`SELECT VIN, MODEL FROM work_order WHERE VIN IN (${placeholders})`, vins);
    const modelMap = new Map(modelRows.map(r => [r.VIN, r.MODEL]));

    // 5. Последний NOK замер (строго < 12.6 или строго > 13)
    const [lastNokRows] = await pool.query(`
      SELECT t.VIN, t.CREATION_TIME AS MEASURE_DATE, t.VOLTAGE
      FROM (
        SELECT i.VIN, d.CREATION_TIME, CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) AS VOLTAGE,
               ROW_NUMBER() OVER(PARTITION BY i.VIN ORDER BY d.CREATION_TIME DESC) as rn
        FROM at_im_electrical_check_dtl d
        JOIN at_im_electrical_check_info i ON i.ID = d.MAIN_ID
        WHERE d.ITEMNAME = 'VehicleDataDetail-EMS-Battery_Voltage'
          AND i.VIN IN (${placeholders})
          AND (
            CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) < 12.6 
            OR 
            CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) > 13
          )
      ) t WHERE t.rn = 1
    `, vins);
    const lastNokMap = new Map(lastNokRows.map(r => [r.VIN, r]));

    // 6. Последний OK замер (>= 12.6 и <= 13)
    const [lastOkRows] = await pool.query(`
      SELECT t.VIN, t.CREATION_TIME AS LAST_OK_DATE, t.VOLTAGE AS LAST_OK_VOLTAGE
      FROM (
        SELECT i.VIN, d.CREATION_TIME, CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) AS VOLTAGE,
               ROW_NUMBER() OVER(PARTITION BY i.VIN ORDER BY d.CREATION_TIME DESC) as rn
        FROM at_im_electrical_check_dtl d
        JOIN at_im_electrical_check_info i ON i.ID = d.MAIN_ID
        WHERE d.ITEMNAME = 'VehicleDataDetail-EMS-Battery_Voltage'
          AND i.VIN IN (${placeholders})
          AND CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) >= 12.6
          AND CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) <= 13
      ) t WHERE t.rn = 1
    `, vins);
    const lastOkMap = new Map(lastOkRows.map(r => [r.VIN, r]));

    // 7. Формируем результат
    const result = vins.map(v => {
      const cp8Date = cp8DateMap.get(v) || null;
      const lastNok = lastNokMap.get(v);
      const lastOk = lastOkMap.get(v);

      let tenMinNg = '+';
      if (cp8Date) {
        const cp8Time = new Date(cp8Date).getTime();
        const tenMinBeforeCp8 = cp8Time - (10 * 60 * 1000);

        const cond1 = !lastOk || (new Date(lastOk.LAST_OK_DATE).getTime() < tenMinBeforeCp8);
        const cond2 = lastNok && (new Date(lastNok.MEASURE_DATE).getTime() > cp8Time);

        if (cond1 || cond2) {
          tenMinNg = '-';
        }
      }

      return {
        VIN: v,
        MODEL: modelMap.get(v) || '—',
        VOLTAGE: lastNok ? lastNok.VOLTAGE : null,
        MEASURE_DATE: lastNok ? lastNok.MEASURE_DATE : null,
        CP8_DATE: cp8Date,
        LAST_OK_DATE: lastOk ? lastOk.LAST_OK_DATE : null,
        LAST_OK_VOLTAGE: lastOk ? lastOk.LAST_OK_VOLTAGE : null,
        TEN_MIN_NG: tenMinNg
      };
    });

    result.sort((a, b) => {
      if (a.VOLTAGE && !b.VOLTAGE) return -1;
      if (!a.VOLTAGE && b.VOLTAGE) return 1;
      if (a.CP8_DATE && b.CP8_DATE) return new Date(b.CP8_DATE) - new Date(a.CP8_DATE);
      if (a.CP8_DATE) return -1;
      if (b.CP8_DATE) return 1;
      return 0;
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/voltage-spc:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* 2. VOLTAGE SPC: Заряд АКБ после CP7 (Детальная таблица)                */
/* ====================================================================== */
app.get('/api/voltage-spc-after-cp7', async (req, res) => {
  try {
    const { vin, dateFrom, dateTo } = req.query;

    let cp7Query = `
      SELECT vin, MIN(scan_time) AS cp7_time
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72' AND is_deleted = 0
    `;
    const cp7Params = [];
    if (dateFrom && dateTo) {
      cp7Query += ` AND scan_time >= ? AND scan_time <= ?`;
      cp7Params.push(`${dateFrom} 00:00:00`, `${dateTo} 23:59:59`);
    }
    cp7Query += ` GROUP BY vin`;

    const [cp7Rows] = await mesPool.query(cp7Query, cp7Params);
    if (cp7Rows.length === 0) return res.json([]);

    let vins = cp7Rows.map(r => r.vin);
    if (vin && String(vin).trim()) {
      const search = String(vin).trim().toUpperCase();
      vins = vins.filter(v => v.toUpperCase().includes(search));
    }
    if (vins.length === 0) return res.json([]);

    const cp7TimeMap = new Map(cp7Rows.map(r => [r.vin, r.cp7_time]));
    const placeholders = vins.map(() => '?').join(',');

    const [voltageRows] = await pool.query(`
      SELECT i.VIN, d.CREATION_TIME, CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) AS VOLTAGE
      FROM at_im_electrical_check_dtl d
      JOIN at_im_electrical_check_info i ON i.ID = d.MAIN_ID
      WHERE d.ITEMNAME = 'VehicleDataDetail-EMS-Battery_Voltage' AND i.VIN IN (${placeholders})
      ORDER BY i.VIN, d.CREATION_TIME ASC
    `, vins);

    const [woRows] = await mesPool.query(`
      SELECT too.vin, too.product AS model, tbmr.material_desc AS complectation
      FROM tm_ofm_order too
      LEFT JOIN tm_bas_material_relation tbmr ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
      WHERE too.vin IN (${placeholders})
    `, vins);
    const infoMap = new Map(woRows.map(r => [r.vin, r]));

    const voltageByVin = new Map();
    voltageRows.forEach(r => {
      if (!voltageByVin.has(r.VIN)) voltageByVin.set(r.VIN, []);
      voltageByVin.get(r.VIN).push({
        time: new Date(r.CREATION_TIME).getTime(),
        voltage: parseFloat(r.VOLTAGE),
        dateStr: r.CREATION_TIME
      });
    });

    const result = [];

    vins.forEach(v => {
      const cp7DateStr = cp7TimeMap.get(v);
      const cp7Ms = new Date(cp7DateStr).getTime();
      const checks = voltageByVin.get(v) || [];
      const info = infoMap.get(v) || {};

      if (checks.length === 0) {
        result.push({
          VIN: v, MODEL: info.model || '—', COMPLECTATION: info.complectation || '—',
          CP7_DATE: cp7DateStr, CP7_VOLTAGE: null,
          FIRST_NOK_DATE: null, FIRST_NOK_VOLTAGE: null,
          FIRST_OK_DATE: null, FIRST_OK_VOLTAGE: null,
          TEN_MIN_DATE: null, TEN_MIN_RESULT: '—',
          DIFF_NOK_CP7_MINUTES: null
        });
        return;
      }

      const windowMs = 10 * 60 * 1000;
      const inWindow = checks.filter(c => Math.abs(c.time - cp7Ms) <= windowMs);
      
      let closestCheck = null;
      if (inWindow.length > 0) {
        closestCheck = inWindow.reduce((prev, curr) => (Math.abs(curr.time - cp7Ms) < Math.abs(prev.time - cp7Ms) ? curr : prev), inWindow[0]);
      } else {
        closestCheck = checks[0];
      }

      // ИЗМЕНЕНО: NG только если < 12.6
      const firstNok = checks.find(c => c.voltage < 12.6) || null;
      const firstOk = checks.find(c => c.voltage >= 12.6) || null;

      const tenMinTargetMs = cp7Ms + (10 * 60 * 1000);
      const tenMinCheck = checks.reduce((prev, curr) => (Math.abs(curr.time - tenMinTargetMs) < Math.abs(prev.time - tenMinTargetMs) ? curr : prev), checks[0]);
      
      let tenMinResult = '—';
      if (tenMinCheck) {
        // ИЗМЕНЕНО: + если >= 12.6
        tenMinResult = (tenMinCheck.voltage >= 12.6) ? '+' : '-';
      }

      let diffMinutes = null;
      if (firstNok && closestCheck) {
        diffMinutes = Math.abs(Math.floor((cp7Ms - firstNok.time) / 60000));
      }

      result.push({
        VIN: v,
        MODEL: info.model || '—',
        COMPLECTATION: info.complectation || '—',
        CP7_DATE: cp7DateStr,
        CP7_VOLTAGE: closestCheck ? closestCheck.voltage : null,
        FIRST_NOK_DATE: firstNok ? firstNok.dateStr : null,
        FIRST_NOK_VOLTAGE: firstNok ? firstNok.voltage : null,
        FIRST_OK_DATE: firstOk ? firstOk.dateStr : null,
        FIRST_OK_VOLTAGE: firstOk ? firstOk.voltage : null,
        TEN_MIN_DATE: tenMinCheck ? tenMinCheck.dateStr : null,
        TEN_MIN_RESULT: tenMinResult,
        DIFF_NOK_CP7_MINUTES: diffMinutes
      });
    });

    result.sort((a, b) => new Date(b.CP7_DATE) - new Date(a.CP7_DATE));
    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/voltage-spc-after-cp7:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* 3. VOLTAGE SPC: Дашборд по постам (CP7 -> TLADAS -> CP8)               */
/* ====================================================================== */
app.get('/api/voltage-spc-checkpoints-dashboard', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const dateStart = `${dateFrom} 00:00:00`;
    const dateEnd = `${dateTo} 23:59:59`;

    const [cp7Rows] = await mesPool.query(`
      SELECT UPPER(vin) AS vin, MIN(scan_time) AS time_val
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72' AND is_deleted = 0
        AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [dateStart, dateEnd]);
    const cp7Map = new Map(cp7Rows.map(r => [r.vin, new Date(r.time_val).getTime()]));

    const [tladasRows] = await mesPool.query(`
      SELECT UPPER(vin) AS vin, MIN(gmt_create) AS time_val
      FROM tm_vhc_test_line_movement
      WHERE node_nature = 'TLADAS' AND is_deleted = 0
        AND gmt_create >= ? AND gmt_create <= ?
      GROUP BY vin
    `, [dateStart, dateEnd]);
    const tladasMap = new Map(tladasRows.map(r => [r.vin, new Date(r.time_val).getTime()]));

    const [cp8Rows] = await mesPool.query(`
      SELECT UPPER(vin) AS vin, MAX(scan_time) AS time_val
      FROM ti_mes_movement
      WHERE uloc_no = 'AGMAS01004' AND is_deleted = 0
        AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [dateStart, dateEnd]);
    const cp8Map = new Map(cp8Rows.map(r => [r.vin, new Date(r.time_val).getTime()]));

    const allVinsSet = new Set([
      ...cp7Rows.map(r => r.vin),
      ...tladasRows.map(r => r.vin),
      ...cp8Rows.map(r => r.vin)
    ]);
    const vins = Array.from(allVinsSet);
    if (vins.length === 0) return res.json([]);

    const placeholders = vins.map(() => '?').join(',');

    const [voltageRows] = await pool.query(`
      SELECT UPPER(i.VIN) AS VIN, d.CREATION_TIME, CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) AS VOLTAGE
      FROM at_im_electrical_check_dtl d
      JOIN at_im_electrical_check_info i ON i.ID = d.MAIN_ID
      WHERE d.ITEMNAME = 'VehicleDataDetail-EMS-Battery_Voltage' AND i.VIN IN (${placeholders})
      ORDER BY i.VIN, d.CREATION_TIME ASC
    `, vins);

    const [woRows] = await mesPool.query(`
      SELECT UPPER(too.vin) AS vin, too.product AS model, tbmr.material_desc AS complectation
      FROM tm_ofm_order too
      LEFT JOIN tm_bas_material_relation tbmr ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
      WHERE too.vin IN (${placeholders})
    `, vins);
    const infoMap = new Map(woRows.map(r => [r.vin, r]));

    const voltageByVin = new Map();
    voltageRows.forEach(r => {
      if (!voltageByVin.has(r.VIN)) voltageByVin.set(r.VIN, []);
      voltageByVin.get(r.VIN).push({
        time: new Date(r.CREATION_TIME).getTime(),
        voltage: parseFloat(r.VOLTAGE),
        dateStr: r.CREATION_TIME
      });
    });

    const result = [];

    vins.forEach(v => {
      const cp7Ms = cp7Map.get(v) || null;
      const tladasMs = tladasMap.get(v) || null;
      const cp8Ms = cp8Map.get(v) || null;
      const checks = voltageByVin.get(v) || [];
      const info = infoMap.get(v) || {};

      // --- 1. CP7 (NG < 12.6, верхней границы нет) ---
      let cp7Val = null, cp7Ok = null;
      if (cp7Ms) {
        const inWindow = checks.filter(c => Math.abs(c.time - cp7Ms) <= 10 * 60 * 1000);
        const check = inWindow.length ? inWindow[0] : (checks.length ? checks[0] : null);
        if (check) {
          cp7Val = check.voltage;
          cp7Ok = cp7Val >= 12.6; // ИЗМЕНЕНО
        }
      }

      // --- 2. TLADAS (NG < 12.6, верхней границы нет) ---
      let tladasVal = null, tladasOk = null, tladasStatus = null;
      if (tladasMs) {
        if (cp7Ms) {
          const diff = tladasMs - cp7Ms;
          tladasStatus = (diff <= 60 * 60 * 1000) ? 'under1h' : 'over1h';
        } else {
          tladasStatus = 'over1h';
        }

        const inWindow = checks.filter(c => Math.abs(c.time - tladasMs) <= 10 * 60 * 1000);
        const check = inWindow.length ? inWindow[inWindow.length - 1] : (checks.length ? checks[checks.length - 1] : null);
        if (check) {
          tladasVal = check.voltage;
          tladasOk = tladasVal >= 12.6; // ИЗМЕНЕНО
        }
      }

      // --- 3. CP8 (ОСТАЕТСЯ БЕЗ ИЗМЕНЕНИЙ, с верхней границей 13.0) ---
      let cp8Val = null, cp8Ok = null;
      if (cp8Ms) {
        const validOk = checks.filter(c => c.voltage >= 12.6 && c.voltage <= 13);
        const validNok = checks.filter(c => c.voltage < 12.6 || c.voltage > 13);
        
        const lastOk = validOk.length ? validOk[validOk.length - 1] : null;
        const lastNok = validNok.length ? validNok[validNok.length - 1] : null;

        const tenMinBeforeCp8 = cp8Ms - 10 * 60 * 1000;
        const cond1 = !lastOk || lastOk.time < tenMinBeforeCp8;
        const cond2 = lastNok && lastNok.time > cp8Ms;

        cp8Ok = (cond1 || cond2) ? false : true;

        const inWindow = checks.filter(c => Math.abs(c.time - cp8Ms) <= 10 * 60 * 1000);
        let closestCheck = null;
        if (inWindow.length > 0) {
          closestCheck = inWindow.reduce((prev, curr) => (Math.abs(curr.time - cp8Ms) < Math.abs(prev.time - cp8Ms) ? curr : prev), inWindow[0]);
        } else {
          closestCheck = checks.length ? checks[checks.length - 1] : null;
        }
        cp8Val = closestCheck ? closestCheck.voltage : null;
      }

      result.push({
        VIN: v,
        MODEL: info.model || '—',
        COMPLECTATION: info.complectation || '—',
        CP7_DATE: cp7Ms ? new Date(cp7Ms).toISOString() : null,
        CP7_VOLTAGE: cp7Val,
        CP7_OK: cp7Ok,
        TLADAS_DATE: tladasMs ? new Date(tladasMs).toISOString() : null,
        TLADAS_VOLTAGE: tladasVal,
        TLADAS_OK: tladasOk,
        TLADAS_STATUS: tladasStatus,
        CP8_DATE: cp8Ms ? new Date(cp8Ms).toISOString() : null,
        CP8_VOLTAGE: cp8Val,
        CP8_OK: cp8Ok,
      });
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка voltage-spc-checkpoints-dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* 4. История замеров (Модалка по клику на VIN)                           */
/* ====================================================================== */
app.get('/api/voltage-spc-vin-history', async (req, res) => {
  try {
    const { vin } = req.query;
    if (!vin) return res.status(400).json({ error: 'Параметр vin обязателен' });

    const [rows] = await pool.query(`
      SELECT 
        CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) AS VOLTAGE,
        d.CREATION_TIME,
        i.TYPE,
        i.RESULT
      FROM at_im_electrical_check_dtl d
      JOIN at_im_electrical_check_info i ON i.ID = d.MAIN_ID
      WHERE d.ITEMNAME = 'VehicleDataDetail-EMS-Battery_Voltage'
        AND i.VIN = ?
      ORDER BY d.CREATION_TIME DESC
    `, [vin]);

    res.json(rows);
  } catch (err) {
    console.error('Ошибка /api/voltage-spc-vin-history:', err.message);
    res.status(500).json({ error: err.message });
  }
});
