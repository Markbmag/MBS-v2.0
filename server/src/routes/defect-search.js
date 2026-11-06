// Маршруты: поиск дефектов по детали и по VIN.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { lesPool, mesPool, pool } = require('../db');

app.get('/api/part-defect-search', async (req, res) => {
  try {
    const { part, defect, model, dateFrom, dateTo } = req.query;
    if (!part && !defect && !model) {
      return res.status(400).json({ error: 'Укажите хотя бы один параметр' });
    }

    let where = '1=1';
    const params = [];

    if (part) {
      where += ' AND QM_DEF.PART_NAME LIKE ?';
      params.push(`%${part}%`);
    }
    if (defect) {
      where += ' AND QM_DEF.PROBLEM_TYPE LIKE ?';
      params.push(`%${defect}%`);
    }
    if (model && model !== 'ALL') {
      where += ' AND wo.MODEL = ?';
      params.push(model);
    }
    if (dateFrom) {
      where += ' AND QM_DEF.CREATION_TIME >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ' AND QM_DEF.CREATION_TIME <= ?';
      params.push(dateTo);
    }

    const defectSql = `
      SELECT QM_DEF.VIN, QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE, QM_DEF.PROBLEM_REPLENISH, QM_DEF.CREATION_TIME
      FROM (
        SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE ${where}
      ORDER BY QM_DEF.CREATION_TIME DESC
    `;

    const [defectRows] = await pool.query(defectSql, params);
    if (defectRows.length === 0) return res.json([]);

    const vins = [...new Set(defectRows.map(r => r.VIN))];
    const placeholders = vins.map(() => '?').join(',');

    const timePointsSql = `
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
      LEFT JOIN tm_bas_material_relation tbmr 
        ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
      LEFT JOIN udt_vsp_kd_material_mapping uvkmm 
        ON CONCAT(LEFT(tbmr.material_no, 7), '**', RIGHT(tbmr.material_no, 6)) = uvkmm.material_no 
        AND uvkmm.kd_material_no = tbmr.kd_material_no
      LEFT JOIN (
        SELECT vin,
               MAX(IF(uloc_no = 'AGMBS01002', scan_time, NULL)) AS CP5,
               MAX(IF(uloc_no = 'AGMPS01002', scan_time, NULL)) AS CP6,
               MAX(IF(uloc_no = 'AGMAS01001', scan_time, NULL)) AS TRIMIN,
               MAX(IF(uloc_no = 'AGMAS01003', scan_time, NULL)) AS CP7,
               MAX(IF(uloc_no = 'CP72', scan_time, NULL)) AS CP72,
               MAX(IF(uloc_no = 'CPFINAL', scan_time, NULL)) AS CPFINAL,
               MAX(IF(uloc_no = 'AGMAS01004', scan_time, NULL)) AS CP8
        FROM ti_mes_movement
        WHERE is_deleted = 0
        GROUP BY vin
      ) t ON t.vin = too.vin
      WHERE too.vin IN (${placeholders})
    `;
    const [vehicles] = await mesPool.query(timePointsSql, vins);
    const vehicleMap = new Map(vehicles.map(v => [v.vin, v]));

    const [storageRows] = await lesPool.query(`
      SELECT vin, in_storage_time, out_storage_time,
             in_storage_status,
             ck_no, kq_no, kw_no
      FROM tv_biz_storage_car
      WHERE vin IN (${placeholders})
    `, vins);
    const storageMap = new Map(storageRows.map(r => [r.vin, r]));

    const [iotRows] = await pool.query(`
      SELECT wo.vin,
             MAX(IF(aow.wc_name = 'TLWA', aow.creation_time, NULL)) AS TLWA,
             MAX(IF(aow.wc_name = 'TLRT', aow.creation_time, NULL)) AS TLRT,
             MAX(IF(aow.wc_name = 'TLADAS', aow.creation_time, NULL)) AS TLADAS,
             MAX(IF(aow.wc_name = 'TLTT', aow.creation_time, NULL)) AS TLTT
      FROM work_order wo
      LEFT JOIN at_om_wiptrackinghistory aow ON wo.vin = aow.vin
      WHERE wo.vin IN (${placeholders})
      GROUP BY wo.vin
    `, vins);
    const iotMap = new Map(iotRows.map(r => [r.vin, r]));

    const result = defectRows.map(defect => {
      const v = vehicleMap.get(defect.VIN);
      if (!v) return null;

      const les = storageMap.get(defect.VIN) || {};
      const iot = iotMap.get(defect.VIN) || {};

      const times = {
        CP5: v.CP5, CP6: v.CP6, TRIMIN: v.TRIMIN, CP7: v.CP7, CP72: v.CP72,
        TLWA: iot.TLWA, TLRT: iot.TLRT, TLADAS: iot.TLADAS, TLTT: iot.TLTT,
        CPFINAL: v.CPFINAL, CP8: v.CP8
      };

      const checkpoints = ['CP5','CP6','TRIMIN','CP7','CP72','TLWA','TLRT','TLADAS','TLTT','CPFINAL','CP8'];
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

      const storageStatus = les.in_storage_status || '';
      const isSold = storageStatus === 'Key_Car_In_Storage_Status_3';
      const hasStorageData = les.ck_no && les.kq_no && les.kw_no &&
                             les.ck_no !== 'N/A' && les.kq_no !== 'N/A' && les.kw_no !== 'N/A';
      const isInStorage = !isSold && hasStorageData;

      let currentZone;
      if (isSold) currentZone = 'Продан';
      else if (isInStorage) currentZone = `${les.ck_no}-${les.kq_no}-${les.kw_no}`;
      else currentZone = latestCheckpoint || 'Планирование';

      return {
        vin: defect.VIN,
        part_name: defect.PART_NAME || '',
        problem_type: defect.PROBLEM_TYPE || '',
        problem_replenish: defect.PROBLEM_REPLENISH || '',
        defect_creation_time: defect.CREATION_TIME,
        material_code: v.material_code,
        sequence_number: v.sequence_number,
        kd_material_no: v.kd_material_no,
        model: v.model,
        material_desc: v.material_desc,
        colour: v.colour,
        CP5: v.CP5, CP6: v.CP6, TRIMIN: v.TRIMIN, CP7: v.CP7, CP72: v.CP72,
        TLWA: iot.TLWA || null, TLRT: iot.TLRT || null, TLADAS: iot.TLADAS || null, TLTT: iot.TLTT || null,
        CPFINAL: v.CPFINAL, CP8: v.CP8,
        in_storage_time: les.in_storage_time || null,
        out_storage_time: les.out_storage_time || null,
        location: currentZone,
        current_zone: currentZone,
      };
    }).filter(Boolean);

    res.json(result);
  } catch (err) {
    console.error('Ошибка part-defect-search:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vin-defect-search', async (req, res) => {
  try {
    const { vin, model, dateFrom, dateTo } = req.query;
    if (!vin && !model) {
      return res.status(400).json({ error: 'Укажите VIN или модель' });
    }

    let where = '1=1';
    const params = [];

    if (vin) {
      where += ' AND QM_DEF.VIN LIKE ?';
      params.push(`%${vin}%`);
    }
    if (model && model !== 'ALL') {
      where += ' AND wo.MODEL = ?';
      params.push(model);
    }
    if (dateFrom) {
      where += ' AND QM_DEF.CREATION_TIME >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ' AND QM_DEF.CREATION_TIME <= ?';
      params.push(dateTo);
    }

    const defectSql = `
      SELECT QM_DEF.VIN, QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE, QM_DEF.PROBLEM_REPLENISH, QM_DEF.CREATION_TIME
      FROM (
        SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE ${where}
      ORDER BY QM_DEF.CREATION_TIME DESC
    `;

    const [defectRows] = await pool.query(defectSql, params);
    if (defectRows.length === 0) return res.json([]);

    const vins = [...new Set(defectRows.map(r => r.VIN))];
    const placeholders = vins.map(() => '?').join(',');

    // Получаем time-points из MES
    const timePointsSql = `
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
      LEFT JOIN tm_bas_material_relation tbmr 
        ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
      LEFT JOIN udt_vsp_kd_material_mapping uvkmm 
        ON CONCAT(LEFT(tbmr.material_no, 7), '**', RIGHT(tbmr.material_no, 6)) = uvkmm.material_no 
        AND uvkmm.kd_material_no = tbmr.kd_material_no
      LEFT JOIN (
        SELECT vin,
               MAX(IF(uloc_no = 'AGMBS01002', scan_time, NULL)) AS CP5,
               MAX(IF(uloc_no = 'AGMPS01002', scan_time, NULL)) AS CP6,
               MAX(IF(uloc_no = 'AGMAS01001', scan_time, NULL)) AS TRIMIN,
               MAX(IF(uloc_no = 'AGMAS01003', scan_time, NULL)) AS CP7,
               MAX(IF(uloc_no = 'CP72', scan_time, NULL)) AS CP72,
               MAX(IF(uloc_no = 'CPFINAL', scan_time, NULL)) AS CPFINAL,
               MAX(IF(uloc_no = 'AGMAS01004', scan_time, NULL)) AS CP8
        FROM ti_mes_movement
        WHERE is_deleted = 0
        GROUP BY vin
      ) t ON t.vin = too.vin
      WHERE too.vin IN (${placeholders})
    `;
    const [vehicles] = await mesPool.query(timePointsSql, vins);
    const vehicleMap = new Map(vehicles.map(v => [v.vin, v]));

    // Получаем складские данные (LES)
    const [storageRows] = await lesPool.query(`
      SELECT vin, in_storage_time, out_storage_time,
             in_storage_status,
             ck_no, kq_no, kw_no
      FROM tv_biz_storage_car
      WHERE vin IN (${placeholders})
    `, vins);
    const storageMap = new Map(storageRows.map(r => [r.vin, r]));

    // Получаем TL времена из IoT
    const [iotRows] = await pool.query(`
      SELECT wo.vin,
             MAX(IF(aow.wc_name = 'TLWA', aow.creation_time, NULL)) AS TLWA,
             MAX(IF(aow.wc_name = 'TLRT', aow.creation_time, NULL)) AS TLRT,
             MAX(IF(aow.wc_name = 'TLADAS', aow.creation_time, NULL)) AS TLADAS,
             MAX(IF(aow.wc_name = 'TLTT', aow.creation_time, NULL)) AS TLTT
      FROM work_order wo
      LEFT JOIN at_om_wiptrackinghistory aow ON wo.vin = aow.vin
      WHERE wo.vin IN (${placeholders})
      GROUP BY wo.vin
    `, vins);
    const iotMap = new Map(iotRows.map(r => [r.vin, r]));

    // Формируем результат
    const result = defectRows.map(defect => {
      const v = vehicleMap.get(defect.VIN);
      if (!v) return null;

      const les = storageMap.get(defect.VIN) || {};
      const iot = iotMap.get(defect.VIN) || {};

      const times = {
        CP5: v.CP5,
        CP6: v.CP6,
        TRIMIN: v.TRIMIN,
        CP7: v.CP7,
        CP72: v.CP72,
        TLWA: iot.TLWA,
        TLRT: iot.TLRT,
        TLADAS: iot.TLADAS,
        TLTT: iot.TLTT,
        CPFINAL: v.CPFINAL,
        CP8: v.CP8,
      };

      const checkpoints = ['CP5','CP6','TRIMIN','CP7','CP72','TLWA','TLRT','TLADAS','TLTT','CPFINAL','CP8'];
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

      const storageStatus = les.in_storage_status || '';
      const isSold = storageStatus === 'Key_Car_In_Storage_Status_3';
      const hasStorageData = les.ck_no && les.kq_no && les.kw_no &&
                             les.ck_no !== 'N/A' && les.kq_no !== 'N/A' && les.kw_no !== 'N/A';
      const isInStorage = !isSold && hasStorageData;

      let currentZone;
      if (isSold) currentZone = 'Продан';
      else if (isInStorage) currentZone = `${les.ck_no}-${les.kq_no}-${les.kw_no}`;
      else currentZone = latestCheckpoint || 'Планирование';

      return {
        vin: defect.VIN,
        part_name: defect.PART_NAME || '',
        problem_type: defect.PROBLEM_TYPE || '',
        problem_replenish: defect.PROBLEM_REPLENISH || '',
        defect_creation_time: defect.CREATION_TIME,
        material_code: v.material_code,
        sequence_number: v.sequence_number,
        kd_material_no: v.kd_material_no,
        model: v.model,
        material_desc: v.material_desc,
        colour: v.colour,
        CP5: v.CP5,
        CP6: v.CP6,
        TRIMIN: v.TRIMIN,
        CP7: v.CP7,
        CP72: v.CP72,
        TLWA: iot.TLWA || null,
        TLRT: iot.TLRT || null,
        TLADAS: iot.TLADAS || null,
        TLTT: iot.TLTT || null,
        CPFINAL: v.CPFINAL,
        CP8: v.CP8,
        in_storage_time: les.in_storage_time || null,
        out_storage_time: les.out_storage_time || null,
        location: currentZone,
        current_zone: currentZone,
      };
    }).filter(Boolean);

    res.json(result);
  } catch (err) {
    console.error('Ошибка vin-defect-search:', err.message);
    res.status(500).json({ error: err.message });
  }
});
