// Маршруты: Daily Top.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { pool } = require('../db');

// ================== DAILY TOP – с новыми списками постов ==================
app.get('/api/daily-top', async (req, res) => {
  try {
    const { checkpoint, defectType, shift } = req.query;
    const type = defectType || 'default';
    const shiftMode = shift || 'all';

    const cp7Posts = [
      'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
      'REPAIR', 'REPAIR_Final',
      'EXT1', 'PIP2', 'PIP4', 'PIP9'
    ];
    const cp8Posts = [
      'CP8', 'CP8 Gate', 'CP8-gate',
      '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT','CP8 Touch Up'
    ];

    let postList = [];
    if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else postList = [...new Set([...cp7Posts, ...cp8Posts])];

    const postListStr = postList.map(p => `'${p}'`).join(',');

    let whereClause = '';
    if (type === 'offline') {
      whereClause = ` AND QM_DEF.POST_NAME IN (${postListStr}) AND QM_DEF.S_OFFLINE = 1`;
    } else if (type === 'online') {
      whereClause = ` AND QM_DEF.POST_NAME IN (${postListStr}) AND QM_DEF.S_OFFLINE = 0`;
    } else {
      whereClause = ` AND QM_DEF.POST_NAME IN (${postListStr})`;
    }

    let shiftCondition = '';
    if (shiftMode === 'day') {
      shiftCondition = `AND TIME(QM_DEF.CREATION_TIME) BETWEEN '07:50:00' AND '16:40:00'`;
    } else if (shiftMode === 'night') {
      shiftCondition = `AND (TIME(QM_DEF.CREATION_TIME) >= '16:40:00' OR TIME(QM_DEF.CREATION_TIME) < '01:30:00')`;
    }

    const query = `
      SELECT 
        QM_DEF.PART_NAME,
        QM_DEF.PROBLEM_TYPE,
        CONCAT(QM_DEF.PART_NAME, ' ', QM_DEF.PROBLEM_TYPE) AS PP,
        DATE(QM_DEF.CREATION_TIME) AS CREATION_TIME,
        wo.MODEL,
        COUNT(*) AS QTY_DEF
      FROM (
        SELECT VIN, CREATION_TIME, CHECK_POINT, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_biw_qm_defect_info
        WHERE CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        UNION ALL
        SELECT VIN, CREATION_TIME, CHECK_POINT, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_paint_qm_defect_info
        WHERE CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        UNION ALL
        SELECT VIN, CREATION_TIME, CHECK_POINT, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_qm_defect_info
        WHERE CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE 1=1 ${whereClause} ${shiftCondition}
        AND QM_DEF.PART_NAME IS NOT NULL AND TRIM(QM_DEF.PART_NAME) <> ''
        AND QM_DEF.PROBLEM_TYPE IS NOT NULL AND TRIM(QM_DEF.PROBLEM_TYPE) <> ''
        AND DATE(QM_DEF.CREATION_TIME) = CURDATE()
      GROUP BY QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE, DATE(QM_DEF.CREATION_TIME), wo.MODEL
      ORDER BY CREATION_TIME DESC
      LIMIT 5000
    `;

    const [rows] = await pool.query(query);
    const result = rows.map(row => ({
      CREATION_TIME: row.CREATION_TIME,
      MODEL: row.MODEL || 'UNKNOWN',
      PART_NAME: row.PART_NAME || '',
      PROBLEM_TYPE: row.PROBLEM_TYPE || '',
      MPP: `${row.MODEL || 'UNKNOWN'} ${row.PP}`,
      DEFECTS_COUNT: Number(row.QTY_DEF) || 0,
    }));

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА DAILY TOP:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== VIN ДЛЯ ДЕФЕКТА В DAILY TOP – с новыми списками постов ==================
app.get('/api/daily-top-vins', async (req, res) => {
  try {
    const { checkpoint, defectType, shift, partName, problemType, model } = req.query;
    if (!partName || !problemType) return res.status(400).json({ error: 'partName и problemType обязательны' });

    const type = defectType || 'default';
    const shiftMode = shift || 'all';
    const carModel = model || null;

    const cp7Posts = [
      'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
      'REPAIR', 'REPAIR_Final',
      'EXT1', 'PIP2', 'PIP4', 'PIP9'
    ];
    const cp8Posts = [
      'CP8', 'CP8 Gate', 'CP8-gate',
      '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'
    ];

    let postList = [];
    if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else postList = [...new Set([...cp7Posts, ...cp8Posts])];

    const postListStr = postList.map(p => `'${p}'`).join(',');

    let whereClause = ` AND QM_DEF.POST_NAME IN (${postListStr})`;
    if (type === 'offline') whereClause += ` AND QM_DEF.S_OFFLINE = 1`;
    else if (type === 'online') whereClause += ` AND QM_DEF.S_OFFLINE = 0`;

    let shiftCondition = '';
    if (shiftMode === 'day') {
      shiftCondition = `AND TIME(QM_DEF.CREATION_TIME) BETWEEN '07:50:00' AND '16:40:00'`;
    } else if (shiftMode === 'night') {
      shiftCondition = `AND (TIME(QM_DEF.CREATION_TIME) >= '16:40:00' OR TIME(QM_DEF.CREATION_TIME) < '01:30:00')`;
    }

    const query = `
      SELECT DISTINCT wo.VIN
      FROM (
        SELECT VIN, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_biw_qm_defect_info
        WHERE PART_NAME = ? AND PROBLEM_TYPE = ? AND DATE(CREATION_TIME) = CURDATE()
        UNION ALL
        SELECT VIN, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_paint_qm_defect_info
        WHERE PART_NAME = ? AND PROBLEM_TYPE = ? AND DATE(CREATION_TIME) = CURDATE()
        UNION ALL
        SELECT VIN, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_qm_defect_info
        WHERE PART_NAME = ? AND PROBLEM_TYPE = ? AND DATE(CREATION_TIME) = CURDATE()
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE 1=1 ${whereClause} ${shiftCondition}
        ${carModel ? `AND wo.MODEL = ?` : ''}
      ORDER BY wo.VIN
    `;

    const params = [partName, problemType, partName, problemType, partName, problemType];
    if (carModel) params.push(carModel);

    const [rows] = await pool.query(query, params);
    res.json(rows.map(r => r.VIN));
  } catch (err) {
    console.error('ОШИБКА VIN:', err.message);
    res.status(500).json({ error: err.message });
  }
});
