// Маршруты: недельная аналитика DRR и фото.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { notesPool } = require('../db');

// ================== DRR WEEKLY ANALYTICS ==================
// Агрегация snapshot-таблиц по ISO-неделям.
// Средний DRR = SUM(closed_vins) / SUM(total_vins) — взвешенное среднее.
// Фильтр shiftLetter: ALL (по умолчанию) | A | B | C
app.get('/api/drr-weekly-analytics/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { weeks = 12, shiftLetter = 'ALL' } = req.query;
    const weeksCount = Math.min(Math.max(parseInt(weeks, 10) || 12, 1), 104);

    const validLetters = ['ALL', 'A', 'B', 'C'];
    const safeLetter = validLetters.includes(String(shiftLetter).toUpperCase())
      ? String(shiftLetter).toUpperCase()
      : 'ALL';

    const config = {
      cp7:     { table: 'drr_cp7_snapshots',     extraWhere: " AND filter_name = 'all'", closedCol: 'closed_vins', label: 'DRR CP7' },
      adas:    { table: 'drr_adas_snapshots',    extraWhere: '',                          closedCol: 'closed_vins', label: 'DRR ADAS' },
      cpfinal: { table: 'drr_cpfinal_snapshots', extraWhere: '',                          closedCol: 'ok_vins',     label: 'DRR CPFinal' },
      pip:     { table: 'drr_pip_snapshots',     extraWhere: '',                          closedCol: 'closed_vins', label: 'DRR PIP' },
    };

    const cfg = config[type];
    if (!cfg) return res.status(400).json({ error: 'Неизвестный тип отчёта' });

    // ВАЖНО: не фильтруем по week_number IS NOT NULL — у старых снапшотов он NULL.
    // Неделя вычисляется из shift_date через YEARWEEK(..., 3).
    // Учитываем все строки, где total_vins > 0 (дни без машин в расчёт не идут).
    const sql = `
      SELECT
        YEARWEEK(shift_date, 3) AS iso_year_week,
        COUNT(*) AS total_records,
        SUM(CASE WHEN total_vins > 0 THEN 1 ELSE 0 END) AS days_with_cars,
        SUM(total_vins) AS total_vins,
        SUM(${cfg.closedCol}) AS closed_vins,
        SUM(nok_vins) AS nok_vins,
        MIN(CASE WHEN drr_percent > 0 THEN drr_percent END) AS min_drr,
        MAX(drr_percent) AS max_drr
      FROM ${cfg.table}
      WHERE shift_letter = ?
        AND shift_date >= DATE_SUB(CURDATE(), INTERVAL ${weeksCount} WEEK)
        ${cfg.extraWhere}
      GROUP BY YEARWEEK(shift_date, 3)
      ORDER BY iso_year_week DESC
      LIMIT ${weeksCount}
    `;

    const [rows] = await notesPool.query(sql, [safeLetter]);

    function getISOWeekRange(year, weekNumber) {
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const jan4Day = jan4.getUTCDay() || 7;
      const week1Monday = new Date(jan4);
      week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
      const monday = new Date(week1Monday);
      monday.setUTCDate(week1Monday.getUTCDate() + (weekNumber - 1) * 7);
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      return { start: fmt(monday), end: fmt(sunday) };
    }

    const result = rows.map(r => {
      const yw = Number(r.iso_year_week);
      const year = Math.floor(yw / 100);
      const week = yw % 100;
      const range = getISOWeekRange(year, week);

      const totalVins = Number(r.total_vins) || 0;
      const closedVins = Number(r.closed_vins) || 0;
      const nokVins = Number(r.nok_vins) || 0;

      const avgDrr = totalVins > 0
        ? Number(((closedVins / totalVins) * 100).toFixed(1))
        : null;

      return {
        weekNumber: week,
        year,
        weekStart: range.start,
        weekEnd: range.end,
        totalDays: 7,
        validDays: Number(r.days_with_cars),
        totalRecords: Number(r.total_records),
        totalVins,
        closedVins,
        nokVins,
        avgDrr,
        minDrr: r.min_drr !== null ? Number(Number(r.min_drr).toFixed(1)) : null,
        maxDrr: r.max_drr !== null ? Number(Number(r.max_drr).toFixed(1)) : null,
        label: cfg.label,
      };
    }).reverse();

    res.json({ type, weeks: weeksCount, shiftLetter: safeLetter, data: result });
  } catch (err) {
    console.error('Ошибка /api/drr-weekly-analytics:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== DRR WEEKLY PHOTOS ==================
// Возвращает последние N фото из drr_shift_photos за диапазон дат (неделя) по конкретному чекпоинту.
// Формат photo_key: YYYY-MM-DD_<letter>_<checkpoint>, например 2026-10-05_A_cp7
app.get('/api/drr-weekly-photos', async (req, res) => {
  try {
    const { checkpoint, weekStart, weekEnd, limit = 10 } = req.query;
    if (!checkpoint || !weekStart || !weekEnd) {
      return res.status(400).json({ error: 'checkpoint, weekStart, weekEnd обязательны' });
    }
    const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);

    const [rows] = await notesPool.query(`
      SELECT id, photo_key, filename, mime, uploaded_at
      FROM drr_shift_photos
      WHERE LEFT(photo_key, 10) BETWEEN ? AND ?
        AND SUBSTRING_INDEX(photo_key, '_', -1) = ?
      ORDER BY uploaded_at DESC
      LIMIT ?
    `, [weekStart, weekEnd, checkpoint, lim]);

    res.json({
      photos: rows.map(r => ({
        id: r.id,
        url: `/api/drr-shift-photos/file/${r.filename}`,
        mime: r.mime,
        uploadedAt: r.uploaded_at,
        photoKey: r.photo_key,
      })),
      total: rows.length,
      limit: lim,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-weekly-photos:', err.message);
    res.status(500).json({ error: err.message });
  }
});
