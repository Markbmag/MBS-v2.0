// Маршруты: статус работы ремзоны.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { pool } = require('../db');

// ================== REMZONE WORK STATUS ==================
// ================== REMZONE WORK STATUS ==================

// Фильтр: оставляем только RE-аккаунты (REP%, rep%, repXX|)
// Проверяем и REPAIR_ACCOUNT, и левую часть REPAIR_PERSON до знака "|"
const REMZONE_FILTER = `
  AND (
    UPPER(REPAIR_ACCOUNT) LIKE 'REP%'
    OR UPPER(SUBSTRING_INDEX(REPAIR_PERSON, '|', 1)) LIKE 'REP%'
  )
`;

// ---------- 1. Ежедневный режим: по дням за период ----------
app.get('/api/remzone-work-status/daily', async (req, res) => {
  try {
    const { dateFrom, dateTo, withPartNumber } = req.query;
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });
    }

    const partNumberCondition = withPartNumber === 'true'
      ? ` AND MISS_PART IS NOT NULL AND TRIM(MISS_PART) <> ''`
      : '';

    const [rows] = await pool.query(`
      SELECT
        DATE(REPAIR_TIME) AS repair_date,
        REPAIR_PERSON,
        REPAIR_ACCOUNT,
        COUNT(*) AS cnt
      FROM at_qm_defect_info
      WHERE REPAIR_TIME IS NOT NULL
        AND REPAIR_TIME >= ? AND REPAIR_TIME <= ?
        AND REPAIR_PERSON IS NOT NULL AND TRIM(REPAIR_PERSON) <> ''
        ${REMZONE_FILTER}
        ${partNumberCondition}
      GROUP BY repair_date, REPAIR_PERSON, REPAIR_ACCOUNT
      ORDER BY repair_date
    `, [`${dateFrom} 00:00:00`, `${dateTo} 23:59:59`]);

    const personsMap = new Map();

    for (const row of rows) {
      const key = row.REPAIR_PERSON;

      if (!personsMap.has(key)) {
        const raw = String(row.REPAIR_PERSON || '');
        const parts = raw.split('|');
        const acc = (parts[0] || '').trim();
        const name = (parts[1] || '').trim();

        personsMap.set(key, {
          repair_person: raw,
          repair_account: row.REPAIR_ACCOUNT || acc || '',
          person_account: acc || row.REPAIR_ACCOUNT || '',
          person_name: name || acc || raw || '—',
          days: {},
          total: 0,
        });
      }

      const person = personsMap.get(key);
      const dateStr = String(row.repair_date).slice(0, 10);
      const cnt = Number(row.cnt || 0);

      person.days[dateStr] = (person.days[dateStr] || 0) + cnt;
      person.total += cnt;
    }

    const result = Array.from(personsMap.values())
      .sort((a, b) => b.total - a.total);

    res.json({ rows: result });
  } catch (err) {
    console.error('Ошибка /api/remzone-work-status/daily:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- 2. Часовой режим: по часам за конкретный день ----------
app.get('/api/remzone-work-status/hourly', async (req, res) => {
  try {
    const { date, withPartNumber } = req.query;
    if (!date) {
      return res.status(400).json({ error: 'date обязателен' });
    }

    const partNumberCondition = withPartNumber === 'true'
      ? ` AND MISS_PART IS NOT NULL AND TRIM(MISS_PART) <> ''`
      : '';

    const [rows] = await pool.query(`
      SELECT
        HOUR(REPAIR_TIME) AS hour,
        REPAIR_PERSON,
        REPAIR_ACCOUNT,
        COUNT(*) AS cnt
      FROM at_qm_defect_info
      WHERE REPAIR_TIME IS NOT NULL
        AND DATE(REPAIR_TIME) = ?
        AND REPAIR_PERSON IS NOT NULL AND TRIM(REPAIR_PERSON) <> ''
        ${REMZONE_FILTER}
        ${partNumberCondition}
      GROUP BY hour, REPAIR_PERSON, REPAIR_ACCOUNT
    `, [date]);

    const personsMap = new Map();

    for (const row of rows) {
      const key = row.REPAIR_PERSON;

      if (!personsMap.has(key)) {
        const raw = String(row.REPAIR_PERSON || '');
        const parts = raw.split('|');
        const acc = (parts[0] || '').trim();
        const name = (parts[1] || '').trim();

        personsMap.set(key, {
          repair_person: raw,
          repair_account: row.REPAIR_ACCOUNT || acc || '',
          person_account: acc || row.REPAIR_ACCOUNT || '',
          person_name: name || acc || raw || '—',
          hours: Array(24).fill(0),
          total: 0,
        });
      }

      const person = personsMap.get(key);
      const h = Number(row.hour);
      const cnt = Number(row.cnt || 0);

      if (h >= 0 && h <= 23) {
        person.hours[h] += cnt;
        person.total += cnt;
      }
    }

    const result = Array.from(personsMap.values())
      .sort((a, b) => b.total - a.total);

    res.json({ rows: result });
  } catch (err) {
    console.error('Ошибка /api/remzone-work-status/hourly:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- 3. Детали: список дефектов сотрудника за день (или за час) ----------
app.get('/api/remzone-work-status/details', async (req, res) => {
  try {
    const { repair_person, date, hour, withPartNumber } = req.query;
    if (!repair_person || !date) {
      return res.status(400).json({ error: 'repair_person и date обязательны' });
    }

    const partNumberCondition = withPartNumber === 'true'
      ? ` AND d.MISS_PART IS NOT NULL AND TRIM(d.MISS_PART) <> ''`
      : '';

    const params = [repair_person, date];
    let hourFilter = '';
    if (hour !== undefined && hour !== null && hour !== '') {
      hourFilter = ' AND HOUR(d.REPAIR_TIME) = ?';
      params.push(Number(hour));
    }

    const [rows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.POST_NAME,
        d.CHECK_POINT,
        d.REPAIR_TIME,
        d.MISS_PART
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.REPAIR_PERSON = ?
        AND d.REPAIR_TIME IS NOT NULL
        AND DATE(d.REPAIR_TIME) = ?
        ${hourFilter}
        ${partNumberCondition}
      ORDER BY d.REPAIR_TIME ASC
    `, params);

    res.json({
      rows: rows.map(r => ({
        vin: r.VIN,
        model: r.MODEL || '—',
        part_name: r.PART_NAME || '—',
        problem_type: r.PROBLEM_TYPE || '—',
        post_name: r.POST_NAME || '—',
        checkpoint: r.CHECK_POINT || '—',
        repair_time: r.REPAIR_TIME,
        miss_part: r.MISS_PART || '',
      })),
    });
  } catch (err) {
    console.error('Ошибка /api/remzone-work-status/details:', err.message);
    res.status(500).json({ error: err.message });
  }
});
