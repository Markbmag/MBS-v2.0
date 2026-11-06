// Маршруты: ретроспектива DRR и DPU OFF, оценки проблем.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { mesPool, pool } = require('../db');

app.get('/api/drr-retrospective', async (req, res) => {
  try {
    const { period = 'all', count, fromDate, toDate } = req.query;

    // Функция получения DRR для одного периода
    const getDrr = async (startDate, endDate, label, type) => {
      const sql = `
        SELECT
          all_cars.MODEL,
          COALESCE(all_cars.TOTAL, 0) AS TOTAL,
          COALESCE(remzone.REMZONE_COUNT, 0) AS REMZONE_COUNT,
          ROUND(100 - COALESCE(remzone.REMZONE_COUNT, 0) * 100.0 / NULLIF(all_cars.TOTAL, 0), 1) AS DRR_PERCENT
        FROM (
          SELECT
            too.product AS MODEL,
            COUNT(DISTINCT tvv.VIN) AS TOTAL
          FROM tm_vhc_vehicle tvv
          JOIN tm_ofm_order too ON too.VIN = tvv.VIN
          JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
          WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
            AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) BETWEEN ? AND ?
          GROUP BY MODEL
        ) all_cars
        LEFT JOIN (
          SELECT
            too.product AS MODEL,
            COUNT(DISTINCT tvv.VIN) AS REMZONE_COUNT
          FROM tm_vhc_vehicle tvv
          JOIN tm_ofm_order too ON too.VIN = tvv.VIN
          JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
          JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN AND tvtlm.node_nature LIKE 'REP%'
          WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
            AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) BETWEEN ? AND ?
          GROUP BY MODEL
        ) remzone ON all_cars.MODEL = remzone.MODEL
        ORDER BY all_cars.MODEL
      `;

      const [rows] = await mesPool.query(sql, [startDate, endDate, startDate, endDate]);
      const result = { label, type };
      let totalSum = 0, cnt = 0;
      rows.forEach(row => {
        result[row.MODEL] = row.DRR_PERCENT;
        if (row.DRR_PERCENT !== null) {
          totalSum += row.DRR_PERCENT;
          cnt++;
        }
      });
      result.total = cnt > 0 ? +(totalSum / cnt).toFixed(1) : 0;
      return result;
    };

    // Вспомогательные функции
    const formatDate = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const getISOWeek = (date) => {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };

    const pad = (num) => String(num).padStart(2, '0');

    const now = new Date();
    const periods = [];

    const typeOrder = { year: 0, month: 1, week: 2, day: 3 };

    if (period === 'all') {
      // существующая логика для всех периодов
      for (let i = 1; i >= 0; i--) {
        const y = now.getFullYear() - i;
        periods.push({ label: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31`, type: 'year' });
      }
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
        periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${String(lastDay).padStart(2, '0')}`, type: 'month' });
      }
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      for (let i = 3; i >= 0; i--) {
        const start = new Date(monday);
        start.setDate(monday.getDate() - i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        const weekNum = getISOWeek(start);
        periods.push({ label: `W${weekNum} ${start.getFullYear()}`, startDate: formatDate(start), endDate: formatDate(end), type: 'week' });
      }
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: formatDate(d), endDate: formatDate(d), type: 'day' });
      }
    } else {
      if (fromDate && toDate) {
        // Генерация периодов на основе заданного диапазона
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
              label: `W${getISOWeek(start)} ${start.getFullYear()}`,
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
        // Существующая логика на основе count
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
            const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
            const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
            periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${String(lastDay).padStart(2, '0')}`, type: 'month' });
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
            const weekNum = getISOWeek(start);
            periods.push({ label: `W${weekNum} ${start.getFullYear()}`, startDate: formatDate(start), endDate: formatDate(end), type: 'week' });
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

    const result = [];
    for (const p of periods) {
      result.push(await getDrr(p.startDate, p.endDate, p.label, p.type));
    }

    res.json({ dataPoints: result });
  } catch (err) {
    console.error('Ошибка drr-retrospective:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/problem-grades', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT PROBLEM_GRADE
      FROM (
        SELECT PROBLEM_GRADE FROM at_biw_qm_defect_info
        UNION ALL
        SELECT PROBLEM_GRADE FROM at_paint_qm_defect_info
        UNION ALL
        SELECT PROBLEM_GRADE FROM at_qm_defect_info
      ) t
      WHERE PROBLEM_GRADE IS NOT NULL AND TRIM(PROBLEM_GRADE) <> ''
      ORDER BY PROBLEM_GRADE
    `);
    const grades = rows.map(r => r.PROBLEM_GRADE).filter(Boolean);
    res.json(grades);
  } catch (err) {
    console.error('Ошибка получения классов дефектов:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ================== DPU OFF РЕТРОСПЕКТИВА ==================
app.get('/api/dpu-off-retrospective', async (req, res) => {
  try {
    const { period = 'all', count, fromDate, toDate } = req.query;

    // ===== Расчёт DPU OFF для одного периода =====
    const getDpuOff = async (startDate, endDate, label, type) => {
      // 1. Получаем VIN'ы, прошедшие CPFINAL за период, с их моделями
      const [carsRows] = await mesPool.query(`
        SELECT DISTINCT tvv.VIN, too.product AS MODEL
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
          AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) BETWEEN ? AND ?
      `, [startDate, endDate]);

      // 2. Группируем VIN'ы по моделям
      const modelVins = {};
      carsRows.forEach(r => {
        if (!modelVins[r.MODEL]) modelVins[r.MODEL] = [];
        modelVins[r.MODEL].push(r.VIN);
      });

      const result = { label, type };
      const modelValues = []; // для простого среднего

      // 3. Для каждой модели считаем офлайн-дефекты её VIN'ов
      for (const model of Object.keys(modelVins)) {
        const vins = modelVins[model];
        if (vins.length === 0) continue;

        const ph = vins.map(() => '?').join(',');
        const [defRows] = await pool.query(`
          SELECT COUNT(*) AS DEFECTS
          FROM (
            SELECT VIN FROM at_biw_qm_defect_info
              WHERE VIN IN (${ph})
                AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
            UNION ALL
            SELECT VIN FROM at_paint_qm_defect_info
              WHERE VIN IN (${ph})
                AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
            UNION ALL
            SELECT VIN FROM at_qm_defect_info
              WHERE VIN IN (${ph})
                AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
          ) t
        `, [...vins, ...vins, ...vins]);

        const defects = Number(defRows[0]?.DEFECTS) || 0;
        const dpu = +(defects / vins.length).toFixed(2);
        result[model] = dpu;
        modelValues.push(dpu);
      }

      // Total = простое среднее по моделям (как в DRR-ретро)
      result.total = modelValues.length > 0
        ? +(modelValues.reduce((a, b) => a + b, 0) / modelValues.length).toFixed(2)
        : 0;

      return result;
    };

    // ===== Генерация периодов — идентична DRR =====
    const formatDate = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const getISOWeek = (date) => {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };

    const pad = (num) => String(num).padStart(2, '0');
    const now = new Date();
    const periods = [];
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
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
        periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${String(lastDay).padStart(2, '0')}`, type: 'month' });
      }
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      for (let i = 3; i >= 0; i--) {
        const start = new Date(monday);
        start.setDate(monday.getDate() - i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        const weekNum = getISOWeek(start);
        periods.push({ label: `W${weekNum} ${start.getFullYear()}`, startDate: formatDate(start), endDate: formatDate(end), type: 'week' });
      }
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: formatDate(d), endDate: formatDate(d), type: 'day' });
      }
    } else {
      if (fromDate && toDate) {
        let from = new Date(fromDate + 'T00:00:00');
        let to = new Date(toDate + 'T00:00:00');
        if (from > to) [from, to] = [to, from];

        if (period === 'day') {
          for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
            const dateStr = formatDate(d);
            periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: dateStr, endDate: dateStr, type: 'day' });
          }
        } else if (period === 'month') {
          let d = new Date(from.getFullYear(), from.getMonth(), 1);
          while (d <= to) {
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            const lastDay = new Date(y, m, 0).getDate();
            const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
            periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${pad(m)}-01`, endDate: `${y}-${pad(m)}-${lastDay}`, type: 'month' });
            d.setMonth(d.getMonth() + 1);
          }
        } else if (period === 'week') {
          const day = from.getDay();
          const monday = new Date(from);
          monday.setDate(from.getDate() - (day === 0 ? 6 : day - 1));
          for (let start = new Date(monday); start <= to; start.setDate(start.getDate() + 7)) {
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            periods.push({ label: `W${getISOWeek(start)} ${start.getFullYear()}`, startDate: formatDate(start), endDate: formatDate(end), type: 'week' });
          }
        } else if (period === 'year') {
          for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
            periods.push({ label: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31`, type: 'year' });
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
            const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
            const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
            periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${String(lastDay).padStart(2, '0')}`, type: 'month' });
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
            const weekNum = getISOWeek(start);
            periods.push({ label: `W${weekNum} ${start.getFullYear()}`, startDate: formatDate(start), endDate: formatDate(end), type: 'week' });
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

    const result = [];
    for (const p of periods) {
      result.push(await getDpuOff(p.startDate, p.endDate, p.label, p.type));
    }

    res.json({ dataPoints: result });
  } catch (err) {
    console.error('Ошибка dpu-off-retrospective:', err.message);
    res.status(500).json({ error: err.message });
  }
});
