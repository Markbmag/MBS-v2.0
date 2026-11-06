// Маршруты: управление СГП.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { lesPool, mesPool } = require('../db');

// Хелпер для построения условий поиска по полным и коротким VIN
const buildVinClause = (vinList, column = 'vin') => {
  if (!vinList || vinList.length === 0) return { clause: '1=0', params: [] };
  const conditions = [];
  const params = [];
  vinList.forEach(v => {
    const trimmed = String(v).trim();
    if (!trimmed) return;
    if (trimmed.length === 6) {
      conditions.push(`${column} LIKE ?`);
      params.push(`%${trimmed}`);
    } else {
      conditions.push(`${column} = ?`);
      params.push(trimmed);
    }
  });
  return { 
    clause: conditions.length > 0 ? conditions.join(' OR ') : '1=0', 
    params 
  };
};

// SGP Management - данные по всем моделям
app.get('/api/sgp-management', async (req, res) => {
  try {
    const sql = `
      SELECT
        s.vin,
        s.vehicle_type AS model,
        IF(s.block_msg IS NOT NULL AND s.block_msg <> '', 'Блок', 'Не блок') AS block_status,
        q.issue_desc AS reason,
        q.gmt_create AS hold_date,
        CASE 
            WHEN q.status = 1 THEN 'Устранено'
            WHEN q.status = 0 THEN 'Не устранено'
            ELSE '—'
        END AS resolution_status,
        CASE
            WHEN s.in_storage_status = 'Key_Car_In_Storage_Status_3' THEN 'Outbound'
            WHEN s.in_storage_status = 'Key_Car_In_Storage_Status_1' THEN 'In stock'
            WHEN s.in_storage_status = 'Key_Car_In_Storage_Status_2' THEN 'In stock'
            ELSE 'Unknown'
        END AS storage_status,
        CONCAT_WS('-', COALESCE(s.ck_no, ''), COALESCE(s.kq_no, ''), COALESCE(s.kw_no, '')) AS location
      FROM tv_biz_storage_car s
      LEFT JOIN tv_quality_issue_detail q ON q.vin = s.vin
        AND q.is_deleted = 0
      ORDER BY s.vehicle_type, s.vin, q.gmt_create DESC
    `;
    
    const [rows] = await lesPool.query(sql);
    
    // Собираем уникальные VIN
    const vins = [...new Set(rows.map(r => r.vin).filter(Boolean))];
    
    // Получаем комплектацию из MES
    let complectMap = {};
    if (vins.length > 0) {
      const placeholders = vins.map(() => '?').join(',');
      const [complectRows] = await mesPool.query(`
        SELECT too.vin, tbmr.material_desc AS complectation
        FROM tm_ofm_order too
        LEFT JOIN tm_vhc_vehicle tvv ON too.vin = tvv.vin
        LEFT JOIN tm_bas_material_relation tbmr ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
        WHERE too.vin IN (${placeholders})
      `, vins);
      complectRows.forEach(r => { complectMap[r.vin] = r.complectation || ''; });
    }
    
    const result = rows.map(row => ({
      vin: row.vin,
      model: row.model,
      complectation: complectMap[row.vin] || '—',
      block_status: row.block_status,
      reason: row.reason || '',
      hold_date: row.hold_date || null,
      resolution_status: row.resolution_status || '—',
      storage_status: row.storage_status,
      location: row.location || '—',
    }));
    
    res.json(result);
  } catch (err) {
    console.error('Ошибка SGP Management:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/sgp-management-reasons', async (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT 
        SUBSTRING_INDEX(issue_desc, ' - ', 1) AS reason
      FROM tv_quality_issue_detail
      WHERE issue_desc IS NOT NULL AND issue_desc != ''
        AND is_deleted = 0
      ORDER BY reason
    `;
    const [rows] = await lesPool.query(sql);
    res.json(rows.map(r => r.reason).filter(Boolean));
  } catch (err) {
    console.error('Ошибка получения причин:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { buildVinClause };
