// Маршруты: история DRR CP7.
// Код перенесён из server.js без изменений.

const { app } = require('../../app');
const { pool } = require('../../db');

app.get('/api/drr-cp7-history', async (req, res) => {
  try {
    const { filter = 'all', period = 'all', count, fromDate, toDate } = req.query;

    const postLists = {
      all: [
        'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
        'REPAIR', 'REPAIR_Final',
        'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'
      ],
      cp7: [
        'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
        'REPAIR', 'REPAIR_Final',
        'EXT1', 'PIP2', 'PIP4', 'PIP9'
      ],
      pip: [
        'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'
      ]
    };
    const postList = postLists[filter] || postLists.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const calcModelsForRange = async (startDate, endDate) => {
      const sql = `
        WITH cp72_vins AS (
            SELECT a.VIN, MIN(a.CREATION_TIME) AS CP72_TIME, wo.MODEL
            FROM at_om_wiptrackinghistory a
            JOIN work_order wo ON wo.VIN = a.VIN
            WHERE a.WC_NAME = 'CP72'
              AND DATE(a.CREATION_TIME) BETWEEN ? AND ?
            GROUP BY a.VIN, wo.MODEL
        ),
        defect_status AS (
            SELECT 
                d.VIN,
                COALESCE(d.REPAIR_TIME, d.REPAIR_TIME1) AS repair_time,
                cp.CP72_TIME,
                DATE_ADD(cp.CP72_TIME, INTERVAL 17 MINUTE) AS ADJUSTED_CP72_TIME,
                CASE 
                    WHEN (d.PART_NAME IS NULL OR TRIM(d.PART_NAME) = '') 
                         AND (d.PROBLEM_TYPE IS NULL OR TRIM(d.PROBLEM_TYPE) = '') 
                    THEN 'CLOSED'
                    WHEN COALESCE(d.REPAIR_TIME, d.REPAIR_TIME1) IS NULL THEN 'CLOSED'
                    WHEN COALESCE(d.REPAIR_TIME, d.REPAIR_TIME1) < DATE_ADD(cp.CP72_TIME, INTERVAL 17 MINUTE) THEN 'CLOSED'
                    ELSE 'OFF'
                END AS calculated_status
            FROM at_qm_defect_info d
            JOIN cp72_vins cp ON d.VIN = cp.VIN
            WHERE d.POST_NAME IN (${postListStr})
              AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
        ),
        vin_summary AS (
            SELECT VIN, MAX(CASE WHEN calculated_status = 'OFF' THEN 1 ELSE 0 END) AS has_off
            FROM defect_status
            GROUP BY VIN
        )
        SELECT 
            cp.VIN,
            cp.MODEL,
            CASE WHEN vs.has_off = 0 OR vs.has_off IS NULL THEN 1 ELSE 0 END AS all_closed
        FROM cp72_vins cp
        LEFT JOIN vin_summary vs ON vs.VIN = cp.VIN
      `;
      const [rows] = await pool.query(sql, [
        startDate, endDate,
        startDate + ' 00:00:00', endDate + ' 23:59:59'
      ]);

      const models = {};
      rows.forEach(r => {
        const model = r.MODEL || '-';
        if (!models[model]) models[model] = { totalVins: 0, closedVins: 0 };
        models[model].totalVins += 1;
        models[model].closedVins += r.all_closed;
      });

      const totalVins = rows.length;
      const closedVins = rows.reduce((sum, r) => sum + r.all_closed, 0);
      const drr = totalVins > 0 ? (closedVins / totalVins) * 100 : 0;

      Object.keys(models).forEach(model => {
        const m = models[model];
        m.drr = m.totalVins > 0 ? (m.closedVins / m.totalVins) * 100 : 0;
        m.drr = Math.round(m.drr * 10) / 10;
      });

      return { totalVins, closedVins, drr: Math.round(drr * 10) / 10, models };
    };

    const calcModelsForToday = async () => {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const start = `${y}-${m}-${d} 00:00:00`;
      const end = `${y}-${m}-${d} 23:59:59`;

      const [cp72Rows] = await pool.query(`
        SELECT a.VIN, wo.MODEL
        FROM at_om_wiptrackinghistory a
        JOIN work_order wo ON wo.VIN = a.VIN
        WHERE a.WC_NAME = 'CP72'
          AND a.CREATION_TIME >= ? AND a.CREATION_TIME <= ?
        GROUP BY a.VIN, wo.MODEL
      `, [start, end]);

      const totalVins = cp72Rows.length;
      if (totalVins === 0) return { totalVins: 0, closedVins: 0, drr: 0, models: {} };

      const [defectRows] = await pool.query(`
        SELECT d.VIN, d.STATUS
        FROM at_qm_defect_info d
        WHERE d.POST_NAME IN (${postListStr})
          AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
          AND d.VIN IN (
            SELECT a.VIN FROM at_om_wiptrackinghistory a
            WHERE a.WC_NAME = 'CP72' AND a.CREATION_TIME >= ? AND a.CREATION_TIME <= ?
          )
      `, [start, end, start, end]);

      const vinDefectMap = new Map();
      defectRows.forEach(row => {
        if (!vinDefectMap.has(row.VIN)) vinDefectMap.set(row.VIN, { total: 0, closed: 0 });
        const stat = vinDefectMap.get(row.VIN);
        stat.total += 1;
        if (row.STATUS && row.STATUS.toLowerCase() === 'closed') stat.closed += 1;
      });

      const models = {};
      let closedVins = 0;
      cp72Rows.forEach(row => {
        const stat = vinDefectMap.get(row.VIN);
        const allClosed = !stat || stat.total === stat.closed;
        if (allClosed) closedVins += 1;
        const model = row.MODEL || '-';
        if (!models[model]) models[model] = { totalVins: 0, closedVins: 0 };
        models[model].totalVins += 1;
        if (allClosed) models[model].closedVins += 1;
      });

      Object.keys(models).forEach(model => {
        const m = models[model];
        m.drr = m.totalVins > 0 ? (m.closedVins / m.totalVins) * 100 : 0;
        m.drr = Math.round(m.drr * 10) / 10;
      });

      const drr = totalVins > 0 ? (closedVins / totalVins) * 100 : 0;
      return { totalVins, closedVins, drr: Math.round(drr * 10) / 10, models };
    };

    const getISOWeek = (date) => {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
      return Math.ceil((((d - yearStart) / 86400000) + 1)/7);
    };

    const formatDate = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const pad = (num) => String(num).padStart(2, '0');

    const now = new Date();
    let periods = [];

    const typeOrder = { year: 0, month: 1, week: 2, day: 3 };

    if (period === 'all') {
      for (let i = 1; i >= 0; i--) {
        const y = now.getFullYear() - i;
        periods.push({ label: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31`, type: 'year' });
      }
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${lastDay}`, type: 'month' });
      }
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      for (let i = 3; i >= 0; i--) {
        const start = new Date(monday);
        start.setDate(monday.getDate() - i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        periods.push({ label: `W${getISOWeek(start)}`, startDate: formatDate(start), endDate: formatDate(end), type: 'week' });
      }
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: formatDate(d), endDate: formatDate(d), type: 'day' });
      }
    } else {
      if (fromDate && toDate && period !== 'all') {
        let from = new Date(fromDate + 'T00:00:00');
        let to = new Date(toDate + 'T00:00:00');
        if (from > to) [from, to] = [to, from];

        if (period === 'day') {
          for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
            const dateStr = formatDate(d);
            periods.push({
              label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`,
              startDate: dateStr,
              endDate: dateStr,
              type: 'day'
            });
          }
        } else if (period === 'month') {
          let d = new Date(from.getFullYear(), from.getMonth(), 1);
          while (d <= to) {
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            const lastDay = new Date(y, m, 0).getDate();
            const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
            periods.push({
              label: `${monthName} ${y}`,
              startDate: `${y}-${pad(m)}-01`,
              endDate: `${y}-${pad(m)}-${lastDay}`,
              type: 'month'
            });
            d.setMonth(d.getMonth() + 1);
          }
        } else if (period === 'week') {
          const day = from.getDay();
          const monday = new Date(from);
          monday.setDate(from.getDate() - (day === 0 ? 6 : day - 1));
          for (let start = new Date(monday); start <= to; start.setDate(start.getDate() + 7)) {
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            periods.push({
              label: `W${getISOWeek(start)}`,
              startDate: formatDate(start),
              endDate: formatDate(end),
              type: 'week'
            });
          }
        } else if (period === 'year') {
          for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
            periods.push({
              label: String(y),
              startDate: `${y}-01-01`,
              endDate: `${y}-12-31`,
              type: 'year'
            });
          }
        }
      } else {
        const defaultCount = { year: 2, month: 3, week: 4, day: 14 }[period] || 7;
        const limit = parseInt(count, 10) || defaultCount;
        if (period === 'year') {
          for (let i = limit - 1; i >= 0; i--) {
            const y = now.getFullYear() - i;
            periods.push({ label: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31`, type: 'year' });
          }
        } else if (period === 'month') {
          for (let i = limit - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
            const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
            periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${lastDay}`, type: 'month' });
          }
        } else if (period === 'week') {
          const dayOfWeek = now.getDay();
          const monday = new Date(now);
          monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
          for (let i = limit - 1; i >= 0; i--) {
            const start = new Date(monday);
            start.setDate(monday.getDate() - i * 7);
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            periods.push({ label: `W${getISOWeek(start)}`, startDate: formatDate(start), endDate: formatDate(end), type: 'week' });
          }
        } else if (period === 'day') {
          for (let i = limit - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: formatDate(d), endDate: formatDate(d), type: 'day' });
          }
        }
      }
    }

    periods.sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || a.startDate.localeCompare(b.startDate));

    const results = [];
    for (const p of periods) {
      let calcResult;
      if (p.type === 'day' && p.startDate === formatDate(new Date())) {
        calcResult = await calcModelsForToday();
      } else {
        calcResult = await calcModelsForRange(p.startDate, p.endDate);
      }
      results.push({
        label: p.label,
        type: p.type,
        drr: calcResult.drr,
        totalVins: calcResult.totalVins,
        closedVins: calcResult.closedVins,
        models: calcResult.models
      });
    }

    res.json({ periods: results });
  } catch (err) {
    console.error('Ошибка DRR CP7 History:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/drr-cp7-history-top-mpp', async (req, res) => {
  try {
    const { dateFrom, dateTo, grades } = req.query;

    let startDate, endDate;
    if (dateFrom && dateTo) {
      startDate = dateFrom;
      endDate = dateTo;
    } else {
      const today = new Date();
      const start = new Date();
      start.setDate(today.getDate() - 13);
      startDate = start.toISOString().split('T')[0];
      endDate = today.toISOString().split('T')[0];
    }

    const cp7Posts = [
      'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
      'REPAIR', 'REPAIR_Final',
      'EXT1', 'PIP2', 'PIP4', 'PIP9',
      'REPAIR VERIFICATION', 'Topcoat preparation'
    ];
    const postListStr = cp7Posts.map(p => `'${p}'`).join(',');

    let where = `WHERE d.POST_NAME IN (${postListStr}) AND d.OFFLINE = 1 AND DATE(d.CREATION_TIME) BETWEEN ? AND ?`;
    const params = [startDate, endDate];

    if (grades) {
      const gradesList = grades.split(',').map(g => g.trim()).filter(Boolean);
      if (gradesList.length > 0) {
        where += ` AND d.PROBLEM_GRADE IN (${gradesList.map(() => '?').join(',')})`;
        params.push(...gradesList);
      }
    }

    const [rows] = await pool.query(`
      SELECT CONCAT(wo.MODEL, ' - ', d.PART_NAME, ' - ', d.PROBLEM_TYPE) AS DEFECT, COUNT(*) AS CNT
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, PROBLEM_GRADE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, PROBLEM_GRADE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, PROBLEM_GRADE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_qm_defect_info
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      ${where}
      GROUP BY DEFECT
      ORDER BY CNT DESC
      LIMIT 5
    `, params);

    res.json(rows.map(r => ({ defect: r.DEFECT, count: r.CNT })));
  } catch (err) {
    console.error('Ошибка drr-cp7-history-top-mpp:', err.message);
    res.status(500).json({ error: err.message });
  }
});
