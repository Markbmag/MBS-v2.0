// Маршруты: инспекция.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { pool } = require('../db');

/* ====================================================================== */
/* удалить ЭНДПОИНТ: /api/inspection-defects                                       */
/* Дефекты с «AGM» в описании, статус != PASS                              */
/* ====================================================================== */
app.get('/api/inspection-defects', async (req, res) => {
  try {
    const { vin, dateFrom, dateTo, recheckPerson, limit = 5000 } = req.query;

    const conditions = [
      `PROBLEM_DESCRIPTION LIKE '%AGM%'`,
      `(STATUS IS NULL OR UPPER(STATUS) <> 'PASS')`,
    ];
    const params = [];

    if (vin && String(vin).trim()) {
      conditions.push(`VIN LIKE ?`);
      params.push(`%${String(vin).trim()}%`);
    }

    if (dateFrom) {
      conditions.push(`CREATION_TIME >= ?`);
      params.push(`${dateFrom} 00:00:00`);
    }
    if (dateTo) {
      conditions.push(`CREATION_TIME <= ?`);
      params.push(`${dateTo} 23:59:59`);
    }

    if (recheckPerson && String(recheckPerson).trim()) {
      conditions.push(`COALESCE(RECHECK_PERSON, RECHECK_PERSON1) = ?`);
      params.push(String(recheckPerson).trim());
    }

    const where = conditions.join(' AND ');
    const lim = Math.min(parseInt(limit, 10) || 5000, 20000);

    const [rows] = await pool.query(`
      SELECT
        ID,
        VIN,
        PROBLEM_DESCRIPTION,
        CREATION_TIME,
        COALESCE(REPAIR_TIME,  REPAIR_TIME1)  AS REPAIR_TIME,
        COALESCE(REPAIR_PERSON, REPAIR_PERSON1) AS REPAIR_PERSON,
        COALESCE(REPAIR_ACCOUNT, REPAIR_ACCOUNT1) AS REPAIR_ACCOUNT,
        COALESCE(RECHECK_TIME,  RECHECK_TIME1)  AS RECHECK_TIME,
        COALESCE(RECHECK_PERSON, RECHECK_PERSON1) AS RECHECK_PERSON,
        COALESCE(RECHECK_ACCOUNT, RECHECK_ACCOUNT1) AS RECHECK_ACCOUNT,
        STATUS,
        POST_NAME,
        PROBLEM_GRADE
      FROM at_qm_defect_info
      WHERE ${where}
      ORDER BY CREATION_TIME DESC
      LIMIT ?
    `, [...params, lim]);

    res.json(rows);
  } catch (err) {
    console.error('Ошибка /api/inspection-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});
