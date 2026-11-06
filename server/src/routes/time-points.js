// Маршруты: время прохождения точек, фильтры, местоположение машин.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { lesPool, mesPool, pool } = require('../db');
const { buildVinClause } = require('./sgp-management');

// ================== TIME POINTS (ВРЕМЯ ПРОХОЖДЕНИЯ ТОЧЕК) ==================

app.get('/api/time-points', async (req, res) => {
  try {
    const {
      vin, materialCode, seqFrom, seqTo, batchNum, partNo,
      kdMaterialNo, model, materialDesc, colour,
      cp5From, cp5To, cp6From, cp6To, trimInFrom, trimInTo,
      cp7From, cp7To, cp72From, cp72To, cpFinalFrom, cpFinalTo, cp8From, cp8To,
      tlwaFrom, tlwaTo, tlrtFrom, tlrtTo, tladasFrom, tladasTo, tlttFrom, tlttTo,
      inboundFrom, inboundTo, outboundFrom, outboundTo,
      currentLocations, excludeLocations,
    } = req.query;

    const kdArray = kdMaterialNo ? kdMaterialNo.split(',').map(s => s.trim()).filter(Boolean) : [];
    const modelArray = model ? model.split(',').map(s => s.trim()).filter(Boolean) : [];
    const complectArray = materialDesc ? materialDesc.split(',').map(s => s.trim()).filter(Boolean) : [];

    const hasLesFilters = inboundFrom || inboundTo || outboundFrom || outboundTo;
    const hasIotFilters = batchNum;

    // --- MES запрос (CP5, CP6, TRIMIN, CP7, CP72, CPFINAL, CP8) ---
    let mesQuery = `
      WITH times AS (
        SELECT
          vin,
          MAX(IF(uloc_no = 'AGMBS01002', scan_time, NULL)) AS CP5,
          MAX(IF(uloc_no = 'AGMPS01002', scan_time, NULL)) AS CP6,
          MAX(IF(uloc_no = 'AGMAS01001', scan_time, NULL)) AS TRIMIN,
          MAX(IF(uloc_no = 'AGMAS01003', scan_time, NULL)) AS CP7,
          MAX(IF(uloc_no = 'CP72', scan_time, NULL)) AS CP72,
          MAX(IF(uloc_no = 'CPFINAL', scan_time, NULL)) AS CPFINAL,
          MAX(IF(uloc_no = 'AGMAS01004', scan_time, NULL)) AS CP8
        FROM ti_mes_movement
        WHERE uloc_no IN ('AGMBS01002','AGMPS01002','AGMAS01001','AGMAS01003','CP72','CPFINAL','AGMAS01004')
          AND is_deleted = 0
        GROUP BY vin
      )
      SELECT
        too.vin,
        too.material_no AS material_code,
        tvv.sequence_number,
        uvkmm.kd_material_no,
        too.product AS model,
        tbmr.material_desc,
        tbmr.ps_material_desc AS colour,
        t.CP5, t.CP6, t.TRIMIN, t.CP7, t.CP72, t.CPFINAL, t.CP8
      FROM tm_ofm_order too 
        LEFT JOIN tm_vhc_vehicle tvv ON too.vin = tvv.vin 
        LEFT JOIN (SELECT DISTINCT material_no, kd_material_no, material_desc, vehicle_type, ps_material_desc FROM tm_bas_material_relation WHERE is_deleted = 0) tbmr ON tbmr.material_no = too.material_no 
        LEFT JOIN (SELECT DISTINCT material_no, kd_material_no FROM udt_vsp_kd_material_mapping WHERE is_deleted = 0) uvkmm ON CONCAT(LEFT(tbmr.material_no, 7), '**', RIGHT(tbmr.material_no, 6)) = uvkmm.material_no AND uvkmm.kd_material_no = tbmr.kd_material_no
        LEFT JOIN times t ON t.vin = too.vin
      WHERE too.is_deleted = 0
    `;
    const mesParams = [];

    // ОБНОВЛЕНО: Поддержка списка VIN и неполных VIN (6 знаков)
    if (vin) {
      const vinArray = vin.split(',').map(v => v.trim()).filter(Boolean);
      const { clause: vinClause, params: vinParams } = buildVinClause(vinArray, 'too.vin');
      mesQuery += ` AND (${vinClause})`;
      mesParams.push(...vinParams);
    }

    if (materialCode) {
      mesQuery += ' AND too.material_no LIKE ?';
      mesParams.push(`%${materialCode}%`);
    }
    if (colour) {
      mesQuery += ' AND tbmr.ps_material_desc = ?';
      mesParams.push(colour);
    }
    if (seqFrom && seqTo) {
      mesQuery += ' AND CAST(tvv.sequence_number AS UNSIGNED) BETWEEN ? AND ?';
      mesParams.push(seqFrom, seqTo);
    } else if (seqFrom) {
      mesQuery += ' AND CAST(tvv.sequence_number AS UNSIGNED) >= ?';
      mesParams.push(seqFrom);
    } else if (seqTo) {
      mesQuery += ' AND CAST(tvv.sequence_number AS UNSIGNED) <= ?';
      mesParams.push(seqTo);
    }
    if (partNo) {
      mesQuery += ` AND EXISTS (
        SELECT 1 FROM r_mat_scanning_records rmsr 
          JOIN r_mat_scanning_detail rmsd ON rmsr.id = rmsd.r_mat_scanning_records_id
        WHERE rmsr.vin = too.vin
          AND rmsd.is_deleted = 0
          AND rmsd.material_code = ?
      )`;
      mesParams.push(partNo);
    }
    if (kdArray.length > 0) {
      mesQuery += ` AND uvkmm.kd_material_no IN (${kdArray.map(() => '?').join(',')})`;
      mesParams.push(...kdArray);
    }
    if (modelArray.length > 0) {
      mesQuery += ` AND too.product IN (${modelArray.map(() => '?').join(',')})`;
      mesParams.push(...modelArray);
    }
    if (complectArray.length > 0) {
      mesQuery += ` AND tbmr.material_desc IN (${complectArray.map(() => '?').join(',')})`;
      mesParams.push(...complectArray);
    }
    if (cp5From) { mesQuery += ' AND t.CP5 >= ?'; mesParams.push(cp5From); }
    if (cp5To) { mesQuery += ' AND t.CP5 <= ?'; mesParams.push(cp5To); }
    if (cp6From) { mesQuery += ' AND t.CP6 >= ?'; mesParams.push(cp6From); }
    if (cp6To) { mesQuery += ' AND t.CP6 <= ?'; mesParams.push(cp6To); }
    if (trimInFrom) { mesQuery += ' AND t.TRIMIN >= ?'; mesParams.push(trimInFrom); }
    if (trimInTo) { mesQuery += ' AND t.TRIMIN <= ?'; mesParams.push(trimInTo); }
    if (cp7From) { mesQuery += ' AND t.CP7 >= ?'; mesParams.push(cp7From); }
    if (cp7To) { mesQuery += ' AND t.CP7 <= ?'; mesParams.push(cp7To); }
    if (cp72From) { mesQuery += ' AND t.CP72 >= ?'; mesParams.push(cp72From); }
    if (cp72To) { mesQuery += ' AND t.CP72 <= ?'; mesParams.push(cp72To); }
    if (cpFinalFrom) { mesQuery += ' AND t.CPFINAL >= ?'; mesParams.push(cpFinalFrom); }
    if (cpFinalTo) { mesQuery += ' AND t.CPFINAL <= ?'; mesParams.push(cpFinalTo); }
    if (cp8From) { mesQuery += ' AND t.CP8 >= ?'; mesParams.push(cp8From); }
    if (cp8To) { mesQuery += ' AND t.CP8 <= ?'; mesParams.push(cp8To); }

    mesQuery += ' ORDER BY t.CP5 DESC';

    const [mesRows] = await mesPool.query(mesQuery, mesParams);
    
    if (mesRows.length === 0) {
      return res.json([]);
    }

    let vehicles = mesRows;
    const vins = vehicles.map(v => v.vin);

    // --- LES фильтр (Inbound/Outbound) ---
    if (hasLesFilters) {
      const lesFilterQuery = `SELECT DISTINCT tbs.vin FROM tv_biz_storage_car tbs WHERE 1=1` +
        (inboundFrom ? ' AND tbs.in_storage_time >= ?' : '') +
        (inboundTo ? ' AND tbs.in_storage_time <= ?' : '') +
        (outboundFrom ? ' AND tbs.out_storage_time >= ?' : '') +
        (outboundTo ? ' AND tbs.out_storage_time <= ?' : '');
      const lesFilterParams = [
        ...(inboundFrom ? [inboundFrom] : []),
        ...(inboundTo ? [inboundTo] : []),
        ...(outboundFrom ? [outboundFrom] : []),
        ...(outboundTo ? [outboundTo] : [])
      ];
      const [lesFilterRows] = await lesPool.query(lesFilterQuery, lesFilterParams);
      const lesVins = new Set(lesFilterRows.map(r => r.vin));
      vehicles = vehicles.filter(v => lesVins.has(v.vin));
    }

    // --- IOT фильтр (batch_num) ---
    if (hasIotFilters) {
      const iotFilterQuery = `SELECT DISTINCT wo.vin FROM work_order wo WHERE 1=1` +
        (batchNum ? ' AND wo.batch_num = ?' : '');
      const iotFilterParams = batchNum ? [batchNum] : [];
      const [iotFilterRows] = await pool.query(iotFilterQuery, iotFilterParams);
      const iotVins = new Set(iotFilterRows.map(r => r.vin));
      vehicles = vehicles.filter(v => iotVins.has(v.vin));
    }

    if (vehicles.length === 0) {
      return res.json([]);
    }

    const filteredVins = vehicles.map(v => v.vin);
    const placeholders = filteredVins.map(() => '?').join(',');

    // --- Обогащение LES (in_storage_time, out_storage_time, складские поля) ---
    const lesDataPromise = lesPool.query(
      `SELECT tbs.vin, tbs.in_storage_time, tbs.out_storage_time,
              tbs.ck_no, tbs.kq_no, tbs.kw_no
       FROM tv_biz_storage_car tbs
       WHERE tbs.vin IN (${placeholders})`,
      [...filteredVins]
    );

    // --- Обогащение IOT (batch_num, TLWA, TLRT, TLADAS, TLTT) ---
    const iotDataPromise = pool.query(
      `SELECT wo.vin, wo.batch_num,
              MAX(IF(aow.wc_name = 'TLWA', aow.creation_time, NULL)) AS TLWA,
              MAX(IF(aow.wc_name = 'TLRT', aow.creation_time, NULL)) AS TLRT,
              MAX(IF(aow.wc_name = 'TLADAS', aow.creation_time, NULL)) AS TLADAS,
              MAX(IF(aow.wc_name = 'TLTT', aow.creation_time, NULL)) AS TLTT
       FROM work_order wo
       LEFT JOIN at_om_wiptrackinghistory aow ON wo.vin = aow.vin
       WHERE wo.vin IN (${placeholders})
       GROUP BY wo.vin, wo.batch_num`,
      [...filteredVins]
    );

    const [[lesRows], [iotRows]] = await Promise.all([lesDataPromise, iotDataPromise]);

    // Слияние LES + добавление storage_location
    const lesMap = new Map(lesRows.map(r => [r.vin, r]));
    vehicles = vehicles.map(v => {
      const les = lesMap.get(v.vin);
      const storageLocation = les 
        ? [les.ck_no, les.kq_no, les.kw_no].filter(Boolean).join('-') 
        : '';
      return {
        ...v,
        in_storage_time: les?.in_storage_time || null,
        out_storage_time: les?.out_storage_time || null,
        storage_location: storageLocation || null,
      };
    });

    // Слияние IoT
    const iotMap = new Map(iotRows.map(r => [r.vin, r]));
    vehicles = vehicles.map(v => ({
      ...v,
      batch_num: iotMap.get(v.vin)?.batch_num || null,
      TLWA: iotMap.get(v.vin)?.TLWA || null,
      TLRT: iotMap.get(v.vin)?.TLRT || null,
      TLADAS: iotMap.get(v.vin)?.TLADAS || null,
      TLTT: iotMap.get(v.vin)?.TLTT || null,
    }));

    // Вычисление location
    vehicles = vehicles.map(v => {
      let location = 'Планирование';
      if (v.out_storage_time) location = 'Продан';
      else if (v.in_storage_time) location = 'На складе';
      else if (v.CP8) location = 'CP8';
      else if (v.CPFINAL) location = 'CPFINAL';
      else if (v.TLWA || v.TLRT || v.TLADAS || v.TLTT) location = 'На тестах';
      else if (v.CP72) location = 'CP72';
      else if (v.CP7) location = 'CP7';
      else if (v.TRIMIN) location = 'TRIMIN';
      else if (v.CP6) location = 'CP6';
      else if (v.CP5) location = 'CP5';
      return { ...v, location };
    });

    // Фильтрация по расположению
    if (currentLocations) {
      const curArr = currentLocations.split(',').map(s => s.trim()).filter(Boolean);
      vehicles = vehicles.filter(v => curArr.includes(v.location));
    }
    if (excludeLocations) {
      const excArr = excludeLocations.split(',').map(s => s.trim()).filter(Boolean);
      vehicles = vehicles.filter(v => !excArr.includes(v.location));
    }

    // Фильтры TLWA/TLRT/TLADAS/TLTT
    if (tlwaFrom) vehicles = vehicles.filter(v => v.TLWA && new Date(v.TLWA) >= new Date(tlwaFrom));
    if (tlwaTo) vehicles = vehicles.filter(v => v.TLWA && new Date(v.TLWA) <= new Date(tlwaTo));
    if (tlrtFrom) vehicles = vehicles.filter(v => v.TLRT && new Date(v.TLRT) >= new Date(tlrtFrom));
    if (tlrtTo) vehicles = vehicles.filter(v => v.TLRT && new Date(v.TLRT) <= new Date(tlrtTo));
    if (tladasFrom) vehicles = vehicles.filter(v => v.TLADAS && new Date(v.TLADAS) >= new Date(tladasFrom));
    if (tladasTo) vehicles = vehicles.filter(v => v.TLADAS && new Date(v.TLADAS) <= new Date(tladasTo));
    if (tlttFrom) vehicles = vehicles.filter(v => v.TLTT && new Date(v.TLTT) >= new Date(tlttFrom));
    if (tlttTo) vehicles = vehicles.filter(v => v.TLTT && new Date(v.TLTT) <= new Date(tlttTo));

    res.json(vehicles);
  } catch (err) {
    console.error('Ошибка time-points:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Компоненты автомобиля
app.get('/api/time-points/:vin/components', async (req, res) => {
  try {
    const { vin } = req.params;
    const materialCode = req.query.materialCode;
    if (!materialCode) return res.status(400).json({ error: 'materialCode required' });

    const query = `
      SELECT *
      FROM (
        SELECT t.material_desc, t.material, d.code_value
        FROM b_tra_m_s_relation t
        LEFT JOIN (
          SELECT rmsd.material_code, rmsd.code_value, rmsr.vin
          FROM r_mat_scanning_detail rmsd
          JOIN r_mat_scanning_records rmsr ON rmsd.r_mat_scanning_records_id = rmsr.id
          WHERE rmsr.vin = ? AND rmsd.material_code IS NOT NULL AND rmsd.is_deleted = 0
        ) d ON t.material = d.material_code
        WHERE t.material_code = ? AND t.is_deleted = 0
        UNION ALL
        SELECT btmsr.material_desc, rmsd.material_code, rmsd.code_value
        FROM r_mat_scanning_detail rmsd
        JOIN r_mat_scanning_records rmsr ON rmsd.r_mat_scanning_records_id = rmsr.id
        LEFT JOIN b_tra_m_s_relation btmsr ON btmsr.material = rmsd.material_code AND btmsr.is_deleted = 0
        WHERE rmsr.vin = ? AND rmsd.material_code IS NOT NULL AND btmsr.material_desc IS NULL
      ) main
      ORDER BY material_desc
    `;
    const [rows] = await mesPool.query(query, [vin, materialCode, vin]);
    
    res.json(rows.map(r => ({
      material: r.material,
      material_desc: r.material_desc,
      code_value: r.code_value,
    })));
  } catch (err) {
    console.error('Ошибка компонентов:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Фильтры
app.get('/api/filters/kd-material-nos', async (req, res) => {
  try {
    const [rows] = await mesPool.query(`
      SELECT DISTINCT kd_material_no
      FROM udt_vsp_kd_material_mapping
      WHERE kd_material_no IS NOT NULL AND kd_material_no != ''
        AND is_deleted = 0
      ORDER BY kd_material_no
      LIMIT 500
    `);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка kd-material-nos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/filters/vehicle-types', async (req, res) => {
  try {
    const [rows] = await mesPool.query(`
      SELECT DISTINCT product AS vehicle_type
      FROM tm_ofm_order
      WHERE product IS NOT NULL AND product != ''
        AND is_deleted = 0
      ORDER BY product
    `);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка vehicle-types:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/filters/material-descs', async (req, res) => {
  try {
    const [rows] = await mesPool.query(`
      SELECT DISTINCT material_desc
      FROM tm_bas_material_relation
      WHERE material_desc IS NOT NULL AND material_desc != ''
        AND is_deleted = 0
      ORDER BY material_desc
      LIMIT 500
    `);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка material-descs:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/filters/colours', async (req, res) => {
  try {
    const [rows] = await mesPool.query(`
      SELECT DISTINCT ps_material_desc AS colour
      FROM tm_bas_material_relation
      WHERE ps_material_desc IS NOT NULL AND ps_material_desc != ''
        AND is_deleted = 0
      ORDER BY ps_material_desc
    `);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка colours:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/time-point-neighbors', async (req, res) => {
  try {
    const { checkpoint, vin, limitBefore = 100, limitAfter = 100 } = req.query;
    if (!vin || !checkpoint) return res.status(400).json({ error: 'vin и checkpoint обязательны' });

    const beforeLimit = parseInt(limitBefore, 10) || 100;
    const afterLimit = parseInt(limitAfter, 10) || 100;
    const targetVin = vin.trim();

    // Используем хелпер для поиска (поддержка 6 символов)
    const { clause: vinClause, params: vinParams } = buildVinClause([targetVin]);

    const mesPoints = {
      CP5: 'AGMBS01002',
      CP6: 'AGMPS01002',
      TRIMIN: 'AGMAS01001',
      CP7: 'AGMAS01003',
      CP72: 'CP72',
      CPFINAL: 'CPFINAL',
      CP8: 'AGMAS01004',
    };
    const iotPoints = ['TLWA', 'TLRT', 'TLADAS', 'TLTT'];
    const lesPoints = ['Inbound', 'Outbound'];

    let rows;
    let targetTime = null;

    if (mesPoints[checkpoint]) {
      const uloc = mesPoints[checkpoint];
      // Ищем время точки по полному или короткому VIN
      const [targetRows] = await mesPool.query(
        `SELECT MAX(scan_time) AS point_time FROM ti_mes_movement WHERE (${vinClause}) AND uloc_no = ? AND is_deleted = 0`,
        [...vinParams, uloc]
      );
      targetTime = targetRows[0]?.point_time;
      if (!targetTime) return res.json({ data: [], targetTime: null });

      const sql = `
        WITH all_points AS (
          SELECT vin, MAX(scan_time) AS point_time
          FROM ti_mes_movement
          WHERE uloc_no = ? AND is_deleted = 0
          GROUP BY vin
        )
        SELECT vin, point_time FROM (
          (SELECT vin, point_time FROM all_points WHERE point_time <= ? ORDER BY point_time DESC LIMIT ?)
          UNION ALL
          (SELECT vin, point_time FROM all_points WHERE point_time > ? ORDER BY point_time ASC LIMIT ?)
        ) AS neighbors
        ORDER BY point_time ASC
      `;
      const [resultRows] = await mesPool.query(sql, [uloc, targetTime, beforeLimit, targetTime, afterLimit]);
      rows = resultRows;
    } else if (iotPoints.includes(checkpoint)) {
      const [targetRows] = await pool.query(
        `SELECT MAX(CREATION_TIME) AS point_time FROM at_om_wiptrackinghistory WHERE (${vinClause}) AND WC_NAME = ?`,
        [...vinParams, checkpoint]
      );
      targetTime = targetRows[0]?.point_time;
      if (!targetTime) return res.json({ data: [], targetTime: null });

      const sql = `
        WITH all_points AS (
          SELECT vin, MAX(CREATION_TIME) AS point_time
          FROM at_om_wiptrackinghistory
          WHERE WC_NAME = ?
          GROUP BY vin
        )
        SELECT vin, point_time FROM (
          (SELECT vin, point_time FROM all_points WHERE point_time <= ? ORDER BY point_time DESC LIMIT ?)
          UNION ALL
          (SELECT vin, point_time FROM all_points WHERE point_time > ? ORDER BY point_time ASC LIMIT ?)
        ) AS neighbors
        ORDER BY point_time ASC
      `;
      const [resultRows] = await pool.query(sql, [checkpoint, targetTime, beforeLimit, targetTime, afterLimit]);
      rows = resultRows;
    } else if (lesPoints.includes(checkpoint)) {
      const column = checkpoint === 'Inbound' ? 'in_storage_time' : 'out_storage_time';
      const [targetRows] = await lesPool.query(
        `SELECT ${column} AS point_time FROM tv_biz_storage_car WHERE (${vinClause}) LIMIT 1`,
        [...vinParams]
      );
      targetTime = targetRows[0]?.point_time;
      if (!targetTime) return res.json({ data: [], targetTime: null });

      const sql = `
        SELECT vin, ${column} AS point_time FROM (
          (SELECT vin, ${column} FROM tv_biz_storage_car WHERE ${column} <= ? ORDER BY ${column} DESC LIMIT ?)
          UNION ALL
          (SELECT vin, ${column} FROM tv_biz_storage_car WHERE ${column} > ? ORDER BY ${column} ASC LIMIT ?)
        ) AS neighbors
        ORDER BY point_time ASC
      `;
      const [resultRows] = await lesPool.query(sql, [targetTime, beforeLimit, targetTime, afterLimit]);
      rows = resultRows;
    } else {
      return res.status(400).json({ error: 'Неверный checkpoint' });
    }

    res.json({ data: rows, targetTime });
  } catch (err) {
    console.error('Ошибка time-point-neighbors:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vehicles-current-location', async (req, res) => {
  try {
    const { vins } = req.query;
    if (!vins) return res.status(400).json({ error: 'vins обязателен' });
    const vinList = vins.split(',').map(v => v.trim()).filter(Boolean);
    if (vinList.length === 0) return res.json([]);

    // 1. MES
    const { clause: vinClauseMes, params: vinParamsMes } = buildVinClause(vinList, 'vin');
    const [mesRows] = await mesPool.query(
      `SELECT vin,
              MAX(IF(uloc_no = 'AGMBS01002', scan_time, NULL)) AS CP5,
              MAX(IF(uloc_no = 'AGMPS01002', scan_time, NULL)) AS CP6,
              MAX(IF(uloc_no = 'AGMAS01001', scan_time, NULL)) AS TRIMIN,
              MAX(IF(uloc_no = 'AGMAS01003', scan_time, NULL)) AS CP7,
              MAX(IF(uloc_no = 'CP72', scan_time, NULL)) AS CP72,
              MAX(IF(uloc_no = 'CPFINAL', scan_time, NULL)) AS CPFINAL,
              MAX(IF(uloc_no = 'AGMAS01004', scan_time, NULL)) AS CP8
       FROM ti_mes_movement
       WHERE (${vinClauseMes}) AND is_deleted = 0
       GROUP BY vin`,
      vinParamsMes
    );

    // 2. IOT (ТУТ БЫЛА ОШИБКА: теперь используем wo.vin)
    const { clause: vinClauseIot, params: vinParamsIot } = buildVinClause(vinList, 'wo.vin');
    const [iotRows] = await pool.query(
      `SELECT wo.vin,
              MAX(IF(aow.WC_NAME = 'TLWA', aow.CREATION_TIME, NULL)) AS TLWA,
              MAX(IF(aow.WC_NAME = 'TLRT', aow.CREATION_TIME, NULL)) AS TLRT,
              MAX(IF(aow.WC_NAME = 'TLADAS', aow.CREATION_TIME, NULL)) AS TLADAS,
              MAX(IF(aow.WC_NAME = 'TLTT', aow.CREATION_TIME, NULL)) AS TLTT
       FROM work_order wo
       LEFT JOIN at_om_wiptrackinghistory aow ON wo.vin = aow.vin
       WHERE (${vinClauseIot})
       GROUP BY wo.vin`,
      vinParamsIot
    );

    // 3. LES
    const { clause: vinClauseLes, params: vinParamsLes } = buildVinClause(vinList, 'vin');
    const [storageRows] = await lesPool.query(
      `SELECT vin, ck_no, kq_no, kw_no, out_storage_time, in_storage_status
       FROM tv_biz_storage_car
       WHERE (${vinClauseLes})`,
      vinParamsLes
    );

    const mesMap = new Map(mesRows.map(r => [r.vin, r]));
    const iotMap = new Map(iotRows.map(r => [r.vin, r]));
    const storageMap = new Map(storageRows.map(r => [r.vin, r]));

    // Собираем ВСЕ полные VIN, которые нашлись в базах
    const foundVins = new Set([
      ...mesRows.map(r => r.vin),
      ...iotRows.map(r => r.vin),
      ...storageRows.map(r => r.vin)
    ]);

    if (foundVins.size === 0) return res.json([]);

    const checkpoints = ['CP5','CP6','TRIMIN','CP7','CP72','TLWA','TLRT','TLADAS','TLTT','CPFINAL','CP8'];

    // Проходимся по найденным полным VIN
    const result = Array.from(foundVins).map(vin => {
      const m = mesMap.get(vin) || {};
      const i = iotMap.get(vin) || {};
      const s = storageMap.get(vin);

      const times = {
        CP5: m.CP5, CP6: m.CP6, TRIMIN: m.TRIMIN, CP7: m.CP7, CP72: m.CP72,
        TLWA: i.TLWA, TLRT: i.TLRT, TLADAS: i.TLADAS, TLTT: i.TLTT,
        CPFINAL: m.CPFINAL, CP8: m.CP8,
      };

      let latestCheckpoint = null;
      let latestTime = null;
      for (const cp of checkpoints) {
        if (times[cp]) {
          const t = new Date(times[cp]);
          if (!latestTime || t > latestTime) {
            latestTime = t;
            latestCheckpoint = cp;
          }
        }
      }

      const isSold = s && s.in_storage_status === 'Key_Car_In_Storage_Status_3';
      const hasStorageData = s && s.ck_no && s.kq_no && s.kw_no &&
                             s.ck_no !== 'N/A' && s.kq_no !== 'N/A' && s.kw_no !== 'N/A';
      const isInStorage = !isSold && hasStorageData;
      const storageString = hasStorageData ? `${s.ck_no}-${s.kq_no}-${s.kw_no}` : null;

      return {
        vin,
        isInStorage,
        isSold,
        storageString,
        checkpoint: isSold ? 'Продан' : (isInStorage ? null : latestCheckpoint),
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка vehicles-current-location:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vehicles-models', async (req, res) => {
  try {
    const { vins } = req.query;
    if (!vins) return res.status(400).json({ error: 'vins обязателен' });
    const vinList = vins.split(',').map(v => v.trim()).filter(Boolean);
    if (vinList.length === 0) return res.json({});

    const { clause: vinClause, params: vinParams } = buildVinClause(vinList);

    const [rows] = await mesPool.query(
      `SELECT vin, product AS model
       FROM tm_ofm_order
       WHERE (${vinClause})`,
      vinParams
    );

    const map = {};
    rows.forEach(r => { map[r.vin] = r.model; });

    res.json(map);
  } catch (err) {
    console.error('Ошибка vehicles-models:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vehicles-model-complect', async (req, res) => {
  try {
    const { vins } = req.query;
    if (!vins) return res.status(400).json({ error: 'vins обязателен' });
    const vinList = vins.split(',').map(v => v.trim()).filter(Boolean);
    if (vinList.length === 0) return res.json({});

    const { clause: vinClause, params: vinParams } = buildVinClause(vinList, 'too.vin');

    const [rows] = await mesPool.query(
      `SELECT 
         too.vin,
         too.product AS model,
         tbmr.material_desc AS material_desc
       FROM tm_ofm_order too
       LEFT JOIN tm_vhc_vehicle tvv ON too.vin = tvv.vin
       LEFT JOIN tm_bas_material_relation tbmr 
         ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
       WHERE (${vinClause})`,
      vinParams
    );

    const map = {};
    rows.forEach(r => { 
      map[r.vin] = { 
        model: r.model || '-', 
        material_desc: r.material_desc || '-' 
      }; 
    });

    res.json(map);
  } catch (err) {
    console.error('Ошибка vehicles-model-complect:', err.message);
    res.status(500).json({ error: err.message });
  }
});
