// Маршруты: холды СГП.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { lesPool, mesPool, pool } = require('../db');

app.get('/api/holds-sgp', async (req, res) => {
  try {
    const sql = `
      SELECT 
        qid.model AS model,
        qid.issue_desc AS issue_desc,
        COUNT(DISTINCT qid.vin) AS quantity,
        MIN(qid.gmt_create) AS hold_date,
        DATEDIFF(CURDATE(), MIN(qid.gmt_create)) AS days_waiting,
        COALESCE(qid.clear_man, qid.create_man) AS responsible,
        '' AS actions,
        DATE_ADD(MIN(qid.gmt_create), INTERVAL 7 DAY) AS planned_date,
        'В процессе' AS status,
        '' AS comment
      FROM higoplat_fusion_les.tv_quality_issue_detail qid
      WHERE qid.is_deleted = 0
        AND qid.status = 0
        AND qid.clear_time IS NULL
      GROUP BY 
        qid.model,
        qid.issue_desc,
        COALESCE(qid.clear_man, qid.create_man)
      ORDER BY 
        qid.model,
        MIN(qid.gmt_create) DESC
    `;
    
    const [rows] = await lesPool.query(sql);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка Holds SGP:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/holds-sgp-all-vins', async (req, res) => {
  try {
    const { models } = req.query;

    let sql = `
      SELECT
        qid.vin                                 AS vin,
        qid.model                               AS model,
        qid.issue_desc                          AS issue_desc,
        COALESCE(qid.clear_man, qid.create_man) AS responsible,
        qid.gmt_create                          AS hold_date,
        'В процессе'                            AS status
      FROM higoplat_fusion_les.tv_quality_issue_detail qid
      WHERE qid.is_deleted = 0
        AND qid.status = 0
        AND qid.clear_time IS NULL
    `;
    const params = [];

    if (models && models !== '') {
      const list = models.split(',').map(m => m.trim()).filter(Boolean);
      if (list.length) {
        sql += ` AND qid.model IN (${list.map(() => '?').join(',')})`;
        params.push(...list);
      }
    }

    sql += ` ORDER BY qid.model, qid.issue_desc, qid.vin, qid.gmt_create`;

    const [rows] = await lesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка holds-sgp-all-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/holds-sgp-retrospective', async (req, res) => {
  try {
    const { models } = req.query;

    // 15 дней: первый — «предыдущий» для расчёта дельты,
    // остальные 14 — отображаемые
    const dates = [];
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    for (let i = 14; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      d.setHours(23, 59, 59, 999);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push({
        dateStr: `${year}-${month}-${day}`,
        endOfDay: d,
      });
    }

    // Отображаемые дни — последние 14 (первый — «до» диапазона)
    const displayDates = dates.slice(1);

    let sql = `
      SELECT 
        qid.model AS model,
        qid.issue_desc AS issue_desc,
        qid.vin,
        qid.gmt_create,
        qid.clear_time
      FROM higoplat_fusion_les.tv_quality_issue_detail qid
      WHERE qid.is_deleted = 0
        AND qid.gmt_create <= ?
    `;

    const params = [dates[dates.length - 1].endOfDay];

    if (models && models !== '') {
      const modelList = models.split(',').map(m => m.trim()).filter(Boolean);
      if (modelList.length > 0) {
        sql += ` AND qid.model IN (${modelList.map(() => '?').join(',')})`;
        params.push(...modelList);
      }
    }

    sql += ` ORDER BY qid.model, qid.issue_desc, qid.gmt_create`;

    const [rows] = await lesPool.query(sql, params);

    // Группировка по model + issue_desc (как было)
    const groupedMap = {};
    rows.forEach(row => {
      const key = `${row.model}_|_${row.issue_desc}`;
      if (!groupedMap[key]) {
        groupedMap[key] = {
          model: row.model,
          issue_desc: row.issue_desc,
          vins: [],
        };
      }
      groupedMap[key].vins.push({
        vin: row.vin,
        gmt_create: row.gmt_create ? new Date(row.gmt_create) : null,
        clear_time: row.clear_time ? new Date(row.clear_time) : null,
      });
    });

    const result = [];
    Object.values(groupedMap).forEach(group => {
      const rowResult = {
        model: group.model,
        issue_desc: group.issue_desc,
      };

      displayDates.forEach(({ dateStr, endOfDay }) => {
        const activeVins = new Set();
        group.vins.forEach(v => {
          if (!v.gmt_create) return;
          const created = v.gmt_create <= endOfDay;
          const notCleared = !v.clear_time || v.clear_time > endOfDay;
          if (created && notCleared) {
            activeVins.add(v.vin);
          }
        });
        if (activeVins.size > 0) {
          rowResult[dateStr] = activeVins.size;
        }
      });

      if (displayDates.some(({ dateStr }) => rowResult[dateStr] > 0)) {
        result.push(rowResult);
      }
    });

    // Уникальные VIN на конец дня (по всем записям, без группировки)
    const uniqueVinsByDate = {};
    dates.forEach(({ dateStr, endOfDay }) => {
      const activeVins = new Set();
      rows.forEach(r => {
        const created = r.gmt_create && new Date(r.gmt_create) <= endOfDay;
        const notCleared = !r.clear_time || new Date(r.clear_time) > endOfDay;
        if (created && notCleared) activeVins.add(r.vin);
      });
      uniqueVinsByDate[dateStr] = activeVins.size;
    });

    // Сортировка (по последнему отображаемому дню, как было)
    const lastDate = displayDates[displayDates.length - 1].dateStr;
    result.sort((a, b) => {
      const aLast = a[lastDate] || 0;
      const bLast = b[lastDate] || 0;
      if (bLast !== aLast) return bLast - aLast;
      return a.model.localeCompare(b.model);
    });

    res.json({ rows: result, uniqueVinsByDate });
  } catch (err) {
    console.error('Ошибка Holds SGP retrospective:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Получение VIN для конкретного холда на конкретную дату
// Поддерживает два режима:
//   issue_desc — точное совпадение (режим «Холды по батчам»)
//   reason     — агрегированная причина (режим «Агрегированные причины»)
app.get('/api/holds-sgp-retrospective-vins', async (req, res) => {
  try {
    const { model, issue_desc, issue_descs, reason, date } = req.query;
    if (!model || !date) {
      return res.status(400).json({ error: 'model и date обязательны' });
    }

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    let whereIssue = '';
    const params = [model];

    if (issue_desc) {
      whereIssue = ` AND qid.issue_desc = ? `;
      params.push(issue_desc);
    } else if (reason) {
      // Поиск по агрегированной причине (с учетом хвостов)
      whereIssue = ` AND (
        qid.issue_desc = ? 
        OR qid.issue_desc LIKE CONCAT(?, ' - по%') 
        OR qid.issue_desc LIKE CONCAT(?, ' по%')
        OR qid.issue_desc LIKE CONCAT(?, '- по%')
        OR qid.issue_desc LIKE CONCAT(?, '-по%')
      ) `;
      params.push(reason, reason, reason, reason, reason);
    } else if (issue_descs) {
      try {
        const descList = JSON.parse(issue_descs);
        if (Array.isArray(descList) && descList.length > 0) {
          whereIssue = ` AND qid.issue_desc IN (${descList.map(() => '?').join(',')}) `;
          params.push(...descList);
        } else {
          return res.json([]);
        }
      } catch (e) {
        return res.status(400).json({ error: 'Неверный формат issue_descs' });
      }
    } else {
      return res.status(400).json({ error: 'Не передан ни issue_desc, ни issue_descs, ни reason' });
    }

    params.push(endOfDay, endOfDay);

    const sql = `
      SELECT DISTINCT qid.vin
      FROM higoplat_fusion_les.tv_quality_issue_detail qid
      WHERE qid.is_deleted = 0
        AND qid.model = ?
        ${whereIssue}
        AND qid.gmt_create <= ?
        AND (qid.clear_time > ? OR qid.clear_time IS NULL)
      ORDER BY qid.vin
    `;

    const [rows] = await lesPool.query(sql, params);
    res.json(rows.map(r => r.vin));
  } catch (err) {
    console.error('Ошибка получения VIN для ретроспективы:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/holds-sgp-retrospective-all-vins', async (req, res) => {
  try {
    const { date, models } = req.query;
    if (!date) return res.status(400).json({ error: 'date обязателен' });

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // 1. Все активные VIN на конец дня
    let sql = `
      SELECT DISTINCT
        qid.model       AS model,
        qid.issue_desc  AS issue_desc,
        qid.vin         AS vin
      FROM higoplat_fusion_les.tv_quality_issue_detail qid
      WHERE qid.is_deleted = 0
        AND qid.gmt_create <= ?
        AND (qid.clear_time > ? OR qid.clear_time IS NULL)
    `;
    const params = [endOfDay, endOfDay];

    if (models && models !== '') {
      const list = models.split(',').map(m => m.trim()).filter(Boolean);
      if (list.length) {
        sql += ` AND qid.model IN (${list.map(() => '?').join(',')})`;
        params.push(...list);
      }
    }

    sql += ` ORDER BY qid.model, qid.issue_desc, qid.vin`;

    const [rows] = await lesPool.query(sql, params);
    if (!rows.length) return res.json([]);

    const vinList = [...new Set(rows.map(r => r.vin))];
    const placeholders = vinList.map(() => '?').join(',');

    // 2. MES: времена прохождения точек
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
       WHERE vin IN (${placeholders}) AND is_deleted = 0
       GROUP BY vin`,
      vinList
    );

    // 3. IOT: TL-точки
    const [iotRows] = await pool.query(
      `SELECT wo.vin,
              MAX(IF(aow.WC_NAME = 'TLWA', aow.CREATION_TIME, NULL)) AS TLWA,
              MAX(IF(aow.WC_NAME = 'TLRT', aow.CREATION_TIME, NULL)) AS TLRT,
              MAX(IF(aow.WC_NAME = 'TLADAS', aow.CREATION_TIME, NULL)) AS TLADAS,
              MAX(IF(aow.WC_NAME = 'TLTT', aow.CREATION_TIME, NULL)) AS TLTT
       FROM work_order wo
       LEFT JOIN at_om_wiptrackinghistory aow ON wo.vin = aow.vin
       WHERE wo.vin IN (${placeholders})
       GROUP BY wo.vin`,
      vinList
    );

    // 4. LES: складские данные
    const [storageRows] = await lesPool.query(
      `SELECT vin, ck_no, kq_no, kw_no, out_storage_time, in_storage_status
       FROM tv_biz_storage_car
       WHERE vin IN (${placeholders})`,
      vinList
    );

    const mesMap = new Map(mesRows.map(r => [r.vin, r]));
    const iotMap = new Map(iotRows.map(r => [r.vin, r]));
    const storageMap = new Map(storageRows.map(r => [r.vin, r]));

    const checkpoints = ['CP5','CP6','TRIMIN','CP7','CP72','TLWA','TLRT','TLADAS','TLTT','CPFINAL','CP8'];

    const locationMap = new Map();
    vinList.forEach(vin => {
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
      const hasStorageData =
        s && s.ck_no && s.kq_no && s.kw_no &&
        s.ck_no !== 'N/A' && s.kq_no !== 'N/A' && s.kw_no !== 'N/A';
      const isInStorage = !isSold && hasStorageData;

      let location = '';
      if (isSold) {
        location = 'Продан';
      } else if (isInStorage) {
        location = `${s.ck_no}-${s.kq_no}-${s.kw_no}`;
      } else if (latestCheckpoint) {
        location = latestCheckpoint;
      }

      locationMap.set(vin, location);
    });

    // 5. Склеиваем: одна запись на пару (model, issue_desc, vin)
    const result = rows.map(r => ({
      model: r.model,
      issue_desc: r.issue_desc,
      vin: r.vin,
      location: locationMap.get(r.vin) || '',
    }));

    res.json(result);
  } catch (err) {
    console.error('Ошибка holds-sgp-retrospective-all-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/holds-sgp-history', async (req, res) => {
  try {
    const { period = 'all', count, fromDate, toDate, model } = req.query;

    const periods = [];
    const now = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    const formatDateStr = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const getISOWeek = (date) => {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };

    if (period === 'all') {
      // 3 месяца
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${pad(lastDay)}`, type: 'month' });
      }
      // 4 недели (УБРАЛИ ГОД)
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      for (let i = 3; i >= 0; i--) {
        const start = new Date(monday);
        start.setDate(monday.getDate() - i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        periods.push({ label: `W${getISOWeek(start)}`, startDate: formatDateStr(start), endDate: formatDateStr(end), type: 'week' });
      }
      // 14 дней
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: formatDateStr(d), endDate: formatDateStr(d), type: 'day' });
      }
    } else {
      const limit = parseInt(count, 10) || { month: 3, week: 4, day: 14, year: 2 }[period];
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
          periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${pad(lastDay)}`, type: 'month' });
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
          // УБРАЛИ ГОД
          periods.push({ label: `W${getISOWeek(start)}`, startDate: formatDateStr(start), endDate: formatDateStr(end), type: 'week' });
        }
      } else if (period === 'day') {
        for (let i = limit - 1; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(now.getDate() - i);
          periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: formatDateStr(d), endDate: formatDateStr(d), type: 'day' });
        }
      }
    }

    const fetchCount = async (startDate, endDate) => {
      let sql = `
        SELECT COUNT(DISTINCT vin) AS count
        FROM higoplat_fusion_les.tv_quality_issue_detail
        WHERE is_deleted = 0
          AND gmt_create <= ? 
          AND (clear_time > ? OR clear_time IS NULL)
      `;
      const params = [`${endDate} 23:59:59`, `${endDate} 23:59:59`];
      
      if (model && model !== 'ALL') {
        sql += ` AND model = ?`;
        params.push(model);
      }
      const [rows] = await lesPool.query(sql, params);
      return rows[0]?.count || 0;
    };

    const results = [];
    for (const p of periods) {
      const count = await fetchCount(p.startDate, p.endDate);
      results.push({ ...p, count });
    }

    if (period === 'all') {
      res.json({
        months: results.filter(r => r.type === 'month'),
        weeks: results.filter(r => r.type === 'week'),
        days: results.filter(r => r.type === 'day')
      });
    } else {
      res.json({ data: results });
    }
  } catch (err) {
    console.error('Ошибка holds-sgp-history:', err.message);
    res.status(500).json({ error: err.message });
  }
});
