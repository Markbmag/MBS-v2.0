// Маршруты: СГП аудит.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { lesPool, mesPool } = require('../db');

// ================== НОВЫЕ ЭНДПОИНТЫ ДЛЯ СГП АУДИТ ==================

// Получить список VIN, прошедших чекпоинт (упрощённый вариант)
app.get('/api/sgp-audit-vins', async (req, res) => {
  try {
    const { checkpoint, dateFrom, dateTo, model } = req.query;
    if (!checkpoint || !dateFrom || !dateTo) {
      return res.status(400).json({ error: 'checkpoint, dateFrom, dateTo обязательны' });
    }

    const allNodes = [
      'Key_Uloc_Type_TRIMIN',
      'Key_Uloc_Type_CP7',
      'Key_Uloc_Type_CP72',
      'Key_Uloc_Type_CPFINAL',
      'Key_Uloc_Type_CP8'
    ];
    
    if (!allNodes.includes(checkpoint)) {
      return res.status(400).json({ error: 'Неверный checkpoint' });
    }

    // Для TRIMIN используем ti_mes_movement (AGMAS01001)
    if (checkpoint === 'Key_Uloc_Type_TRIMIN') {
      let sql = `
        SELECT DISTINCT m.vin
        FROM ti_mes_movement m
        JOIN tm_ofm_order o ON o.vin = m.vin
        WHERE m.uloc_no = 'AGMAS01001'
          AND m.is_deleted = 0
          AND m.scan_time BETWEEN ? AND ?
      `;
      const params = [dateFrom, dateTo];
      
      if (model && model !== 'ALL') {
        sql += ' AND o.product = ?';
        params.push(model);
      }
      
      const [rows] = await mesPool.query(sql, params);
      const vins = rows.map(r => r.vin);
      return res.json(vins);
    }

    // Для CP7, CP72, CPFINAL, CP8 - обычный запрос
    let sql = `
      SELECT DISTINCT v.vin
      FROM tm_vhc_vehicle_movement m
      JOIN tm_vhc_vehicle v ON v.id = m.tm_vhc_vehicle_id
      LEFT JOIN tm_ofm_order o ON o.vin = v.vin
      WHERE m.node_nature = ?
        AND m.scan_time BETWEEN ? AND ?
    `;
    const params = [checkpoint, dateFrom, dateTo];
    
    if (model && model !== 'ALL') {
      sql += ' AND o.product = ?';
      params.push(model);
    }

    const [rows] = await mesPool.query(sql, params);
    const vins = rows.map(r => r.vin);
    res.json(vins);
  } catch (err) {
    console.error('Ошибка sgp-audit-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Получить данные tv_biz_storage_car для списка VIN (из БД LES)
app.get('/api/sgp-audit-storage', async (req, res) => {
  try {
    const { vins, vin } = req.query;
    let vinList = [];
    if (vins) {
      vinList = vins.split(',').map(v => v.trim()).filter(v => v.length > 0);
    } else if (vin) {
      vinList = [vin.trim()];
    }
    if (vinList.length === 0) return res.json([]);

    const placeholders = vinList.map(() => '?').join(',');
    const sql = `
      SELECT
        s.vin AS VIN,
        s.vehicle_type AS Модель,
        s.ck_no AS Склад,
        s.kq_no AS Локация,
        s.kw_no AS Ячейка,
        '' AS "Результат проверки"
      FROM tv_biz_storage_car s
      WHERE s.vin IN (${placeholders})
      ORDER BY s.vin
    `;
    const [rows] = await lesPool.query(sql, vinList);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка sgp-audit-storage:', err.message);
    res.status(500).json({ error: err.message });
  }
});
