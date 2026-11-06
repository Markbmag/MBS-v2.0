// Маршруты: VRT отчёт.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { BRIGADE_PASSWORD, IMPORT_PASSWORD } = require('../config/passwords');
const { notesPool, pool } = require('../db');
const { fetchRawDefects, formatSqlDateTime, getLocalDateStr, getShiftLetterFromDate } = require('./brigade-report');

// =====================================================
// ==================== VRT ОТЧЁТ =======================
// =====================================================

// Список VRT
app.get('/api/vrt-report/vrts', async (req, res) => {
  try {
    const [rows] = await notesPool.query('SELECT id, name FROM vrts ORDER BY name');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Добавить VRT
app.post('/api/vrt-report/vrts', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) return res.status(400).json({ error: 'name и password обязательны' });
    if (password !== BRIGADE_PASSWORD) return res.status(403).json({ error: 'Неверный пароль' });
    const trimmedName = name.trim();
    if (!trimmedName) return res.status(400).json({ error: 'Название не может быть пустым' });
    const [existing] = await notesPool.query('SELECT id FROM vrts WHERE name = ?', [trimmedName]);
    if (existing.length > 0) return res.status(409).json({ error: 'VRT с таким названием уже существует' });
    await notesPool.query('INSERT INTO vrts (name) VALUES (?)', [trimmedName]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Удалить VRT
app.delete('/api/vrt-report/vrts/:id', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== BRIGADE_PASSWORD) return res.status(403).json({ error: 'Неверный пароль' });
    const [vrt] = await notesPool.query('SELECT name FROM vrts WHERE id = ?', [req.params.id]);
    if (vrt.length === 0) return res.status(404).json({ error: 'VRT не найдена' });
    if (vrt[0].name === 'VRT не найдена') return res.status(400).json({ error: 'Нельзя удалить системную VRT' });
    await notesPool.query('DELETE FROM vrts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Список зон
app.get('/api/vrt-report/zones', async (req, res) => {
  try {
    const [rows] = await notesPool.query(`
      SELECT DISTINCT zone FROM vrt_owners
      WHERE zone IS NOT NULL AND TRIM(zone) <> ''
      ORDER BY zone
    `);
    res.json(rows.map(r => r.zone));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Список моделей
app.get('/api/vrt-report/models', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT MODEL FROM work_order
      WHERE MODEL IS NOT NULL AND TRIM(MODEL) <> ''
      ORDER BY MODEL
    `);
    res.json(rows.map(r => r.MODEL));
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Главный отчёт (гистограмма + топ + счётчики)
app.get('/api/vrt-report/data', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, metric = 'count', defectType = 'all', shift = 'all', zones } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });

    const cp7Posts = ['CP7','CP7 Audit','CP7 Gate','CP7-gate','REPAIR','REPAIR_Final','EXT1','PIP2','PIP4','PIP9'];
    const cp8Posts = ['CP8','CP8 Gate','CP8-gate','360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT','CP8 Touch Up'];
    const pipPosts = ['EXT1','PIP1','PIP2','PIP4','PIP5','PIP6','PIP8','PIP9'];
    const tlPosts  = ['360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT','CP8 Touch Up'];

    let postList = [];
    if (!checkpoint || checkpoint === 'ALL') postList = [...new Set([...cp7Posts, ...cp8Posts, ...pipPosts, ...tlPosts])];
    else if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else if (checkpoint === 'PIP') postList = pipPosts;
    else if (checkpoint === 'TL')  postList = tlPosts;
    else return res.status(400).json({ error: 'Неверный checkpoint' });

    const postListStr = postList.map(p => `'${p.replace(/'/g, "''")}'`).join(',');

    let offlineCondition = '1=1';
    if (defectType === 'offline') offlineCondition = '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 1';
    else if (defectType === 'online') offlineCondition = '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 0';

    const getISOWeek = (dateObj) => {
      const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };
    const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const getShiftType = (dateObj) => {
      const total = dateObj.getHours() * 60 + dateObj.getMinutes();
      if (total <= 90) return 'evening';
      if (total >= 91 && total < 470) return 'night';
      if (total <= 1000) return 'day';
      return 'evening';
    };
    const getShiftLetter = (shiftStartDate, shiftType) => {
      if (shiftType === 'night') return 'C';
      const week = getISOWeek(shiftStartDate);
      const isEven = week % 2 === 0;
      if (shiftType === 'day') return isEven ? 'B' : 'A';
      if (shiftType === 'evening') return isEven ? 'A' : 'B';
      return null;
    };
    const matchesShiftAndPeriod = (dateObj) => {
      const shiftType = getShiftType(dateObj);
      if (!shiftType) return false;
      const shiftStart = new Date(dateObj);
      if (shiftType === 'evening' && (dateObj.getHours() * 60 + dateObj.getMinutes()) <= 90) {
        shiftStart.setDate(shiftStart.getDate() - 1);
      }
      const shiftStartStr = toDateStr(shiftStart);
      if (shiftStartStr < dateFrom || shiftStartStr > dateTo) return false;
      if (shift !== 'all') {
        const letter = getShiftLetter(shiftStart, shiftType);
        if (letter !== shift) return false;
      }
      return true;
    };

    const nextDayObj = new Date(`${dateTo}T12:00:00`);
    nextDayObj.setDate(nextDayObj.getDate() + 1);
    const nextDayStr = toDateStr(nextDayObj);

    const [cp72Rows] = await pool.query(`
      SELECT VIN, MIN(CREATION_TIME) AS CP72_TIME
      FROM at_om_wiptrackinghistory
      WHERE WC_NAME = 'CP72'
        AND CREATION_TIME >= ? AND CREATION_TIME <= ?
      GROUP BY VIN
    `, [`${dateFrom} 00:00:00`, `${nextDayStr} 23:59:59`]);

    let totalCars = 0, totalCarsShift = 0;
    for (const row of cp72Rows) {
      if (!row.CP72_TIME) continue;
      const d = new Date(row.CP72_TIME);
      const dStr = toDateStr(d);
      if (dStr >= dateFrom && dStr <= dateTo) totalCars += 1;
      if (matchesShiftAndPeriod(d)) totalCarsShift += 1;
    }

    const defectsSql = `
      SELECT d.PART_NAME, d.PROBLEM_TYPE, d.CREATION_TIME, wo.MODEL
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_biw_qm_defect_info
        WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> '' AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> '' AND ${offlineCondition}
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_paint_qm_defect_info
        WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> '' AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> '' AND ${offlineCondition}
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_qm_defect_info
        WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> '' AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> '' AND ${offlineCondition}
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr}) AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
    `;
    const [defectRows] = await pool.query(defectsSql, [`${dateFrom} 00:00:00`, `${nextDayStr} 23:59:59`]);

    const [owners] = await notesPool.query(`
      SELECT do.model, do.bom_name, do.defect_name, do.zone, v.name AS vrt_name
      FROM vrt_owners do LEFT JOIN vrts v ON do.vrt_id = v.id
    `);
    const ownerMap = new Map();
    const zoneMap = new Map();
    owners.forEach(o => {
      const key = `${o.model}|${o.bom_name}|${o.defect_name}`;
      ownerMap.set(key, o.vrt_name);
      zoneMap.set(key, o.zone);
    });

    const selectedZones = zones ? zones.split(',').map(z => z.trim()).filter(Boolean) : null;

    const vrtDataMap = new Map();
    let totalDefects = 0;

    for (const r of defectRows) {
      const d = new Date(r.CREATION_TIME);
      if (!matchesShiftAndPeriod(d)) continue;

      const key = `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;
      const zone = zoneMap.get(key);

      if (selectedZones && selectedZones.length > 0) {
        if (!zone || !selectedZones.includes(zone)) continue;
      }

      totalDefects += 1;
      const vrt = ownerMap.get(key) || 'VRT не найдена';

      if (!vrtDataMap.has(vrt)) {
        vrtDataMap.set(vrt, { vrt, count: 0, dpu: 0, mppsMap: new Map(), mpps: [] });
      }
      const vrtData = vrtDataMap.get(vrt);
      vrtData.count += 1;

      const mppKey = key + '|' + (zone || '');
      if (!vrtData.mppsMap.has(mppKey)) {
        vrtData.mppsMap.set(mppKey, {
          model: r.MODEL, bom_name: r.PART_NAME, defect_name: r.PROBLEM_TYPE,
          zone: zone || '', count: 0, dpu: 0,
        });
      }
      vrtData.mppsMap.get(mppKey).count += 1;
    }

    // Без обрезки на 1000
    const calculateDpu = (count) => totalCars === 0 ? 0 : Number(((count / totalCars) * 1000).toFixed(2));

    for (const [, v] of vrtDataMap) {
      v.dpu = calculateDpu(v.count);
      v.mpps = Array.from(v.mppsMap.values()).map(m => ({ ...m, dpu: calculateDpu(m.count) }));
      v.mpps.sort((a, b) => b.count - a.count);
    }

    const histogram = Array.from(vrtDataMap.entries())
      .map(([name, data]) => ({
        category: name,
        value: metric === 'dpu' ? data.dpu : data.count,
        count: data.count, dpu: data.dpu,
      })).sort((a, b) => b.count - a.count);

    const unassignedCount = vrtDataMap.get('VRT не найдена')?.count || 0;

    const topVrts = Array.from(vrtDataMap.entries())
      .filter(([name]) => name !== 'VRT не найдена')
      .map(([name, data]) => ({ vrt: name, count: data.count, dpu: data.dpu, mpps: data.mpps }))
      .sort((a, b) => metric === 'dpu' ? b.dpu - a.dpu : b.count - a.count);

    res.json({ histogram, totalCars, totalCarsShift, unassignedCount, totalDefects, topVrts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Дефекты без владельца
app.get('/api/vrt-report/unassigned-defects', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, defectType = 'all' } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });

    const nextDayObj = new Date(`${dateTo}T12:00:00`);
    nextDayObj.setDate(nextDayObj.getDate() + 1);
    const nextDayStr = `${nextDayObj.getFullYear()}-${String(nextDayObj.getMonth()+1).padStart(2,'0')}-${String(nextDayObj.getDate()).padStart(2,'0')}`;

    const raw = await fetchRawDefects(`${dateFrom} 00:00:00`, `${nextDayStr} 23:59:59`, checkpoint, defectType);

    const [owners] = await notesPool.query(`
      SELECT do.model, do.bom_name, do.defect_name, v.name AS vrt_name
      FROM vrt_owners do LEFT JOIN vrts v ON do.vrt_id = v.id
    `);
    const ownerMap = new Map();
    owners.forEach(o => ownerMap.set(`${o.model}|${o.bom_name}|${o.defect_name}`, o.vrt_name));

    const groups = new Map();
    for (const r of raw) {
      const key = `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;
      const vrt = ownerMap.get(key) || 'VRT не найдена';
      if (vrt !== 'VRT не найдена') continue;

      if (!groups.has(key)) {
        groups.set(key, {
          model: r.MODEL, bom_name: r.PART_NAME, defect_name: r.PROBLEM_TYPE,
          mpp: `${r.MODEL || 'UNKNOWN'} ${r.PART_NAME || ''} ${r.PROBLEM_TYPE || ''}`.trim(),
          count: 0,
        });
      }
      groups.get(key).count++;
    }

    res.json(Array.from(groups.values()).sort((a, b) => b.count - a.count));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Назначить VRT дефекту
app.post('/api/vrt-report/assign-owner', async (req, res) => {
  try {
    const { model, bom_name, defect_name, vrtName, password } = req.body;
    if (!model || !bom_name || !defect_name || !vrtName || !password)
      return res.status(400).json({ error: 'Не все обязательные поля заполнены' });
    if (password !== BRIGADE_PASSWORD) return res.status(403).json({ error: 'Неверный пароль' });

    const [vrtRows] = await notesPool.query('SELECT id FROM vrts WHERE name = ?', [vrtName]);
    if (vrtRows.length === 0) return res.status(404).json({ error: 'VRT не найдена' });

    // При назначении зона = 'Не указана' (если пользователь не создал запись в справочнике вручную)
    // Можно расширить: передавать zone с фронта
    const { zone = '' } = req.body;

    await notesPool.query(`
      INSERT INTO vrt_owners (model, bom_name, defect_name, zone, vrt_id)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE vrt_id = VALUES(vrt_id)
    `, [model, bom_name, defect_name, zone, vrtRows[0].id]);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Справочник — GET
app.get('/api/vrt-report/dictionary', async (req, res) => {
  try {
    const [rows] = await notesPool.query(`
      SELECT do.id, do.model, do.bom_name, do.defect_name, do.zone, v.name AS vrt_name
      FROM vrt_owners do LEFT JOIN vrts v ON do.vrt_id = v.id
      ORDER BY do.model, do.bom_name, do.defect_name
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Справочник — POST (добавить/обновить)
app.post('/api/vrt-report/dictionary', async (req, res) => {
  try {
    const { model, bom_name, defect_name, zone, vrtName, password } = req.body;
    if (!model || !bom_name || !defect_name || !zone || !vrtName || !password)
      return res.status(400).json({ error: 'Не все поля заполнены' });
    if (password !== BRIGADE_PASSWORD) return res.status(403).json({ error: 'Неверный пароль' });

    const [vrtRows] = await notesPool.query('SELECT id FROM vrts WHERE name = ?', [vrtName]);
    if (vrtRows.length === 0) return res.status(404).json({ error: 'VRT не найдена' });

    await notesPool.query(`
      INSERT INTO vrt_owners (model, bom_name, defect_name, zone, vrt_id)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE vrt_id = VALUES(vrt_id)
    `, [model, bom_name, defect_name, zone, vrtRows[0].id]);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Справочник — DELETE
app.delete('/api/vrt-report/dictionary/:id', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== BRIGADE_PASSWORD) return res.status(403).json({ error: 'Неверный пароль' });
    await notesPool.query('DELETE FROM vrt_owners WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Импорт справочника (5 колонок)
app.post('/api/vrt-report/import', async (req, res) => {
  try {
    const { entries, password } = req.body;
    if (!entries || !Array.isArray(entries) || entries.length === 0 || !password)
      return res.status(400).json({ error: 'Не переданы данные или пароль' });
    if (password !== IMPORT_PASSWORD) return res.status(403).json({ error: 'Неверный пароль для импорта' });

    const vrtCache = new Map();
    let imported = 0;

    for (const entry of entries) {
      const { model, bom_name, defect_name, vrtName, zone } = entry;
      if (!model || !bom_name || !defect_name || !vrtName || !zone) continue;

      let vrtId = vrtCache.get(vrtName);
      if (!vrtId) {
        const [rows] = await notesPool.query('SELECT id FROM vrts WHERE name = ?', [vrtName]);
        if (rows.length === 0) {
          const [ins] = await notesPool.query('INSERT INTO vrts (name) VALUES (?)', [vrtName]);
          vrtId = ins.insertId;
        } else {
          vrtId = rows[0].id;
        }
        vrtCache.set(vrtName, vrtId);
      }

      await notesPool.query(`
        INSERT INTO vrt_owners (model, bom_name, defect_name, zone, vrt_id)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE vrt_id = VALUES(vrt_id)
      `, [model, bom_name, defect_name, zone, vrtId]);
      imported++;
    }

    res.json({ success: true, imported });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Тренды
// Тренды
app.get('/api/vrt-report/trend', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, defectType = 'all', vrts, metric = 'count', shift, zones } = req.query;
    let sqlStart = dateFrom ? `${dateFrom} 00:00:00` : formatSqlDateTime(new Date(Date.now() - 90*86400000));
    let sqlEnd = dateTo ? `${dateTo} 23:59:59` : formatSqlDateTime(new Date());

    let defectRows = await fetchRawDefects(sqlStart, sqlEnd, checkpoint, defectType);
    if (shift && shift !== 'all') defectRows = defectRows.filter(d => getShiftLetterFromDate(d.CREATION_TIME) === shift);

    const [owners] = await notesPool.query(`
      SELECT do.model, do.bom_name, do.defect_name, do.zone, v.name AS vrt_name
      FROM vrt_owners do LEFT JOIN vrts v ON do.vrt_id = v.id
    `);
    const ownerMap = new Map();
    const zoneMap = new Map();
    owners.forEach(o => {
      const key = `${o.model}|${o.bom_name}|${o.defect_name}`;
      ownerMap.set(key, o.vrt_name);
      zoneMap.set(key, o.zone);
    });

    const selectedZones = zones ? zones.split(',').map(z => z.trim()).filter(Boolean) : null;
    let selectedVrtsSet = null;
    if (vrts && vrts !== 'ALL') selectedVrtsSet = new Set(vrts.split(',').map(b => b.trim()).filter(Boolean));

    function getPeriodKey(date, type) {
      const d = new Date(date);
      if (type === 'month') return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if (type === 'week') {
        const mon = new Date(d);
        const dayNum = mon.getDay() || 7;
        mon.setDate(mon.getDate() + 4 - dayNum);
        const yearStart = new Date(mon.getFullYear(), 0, 1);
        const weekNo = Math.ceil((((mon - yearStart) / 86400000) + 1) / 7);
        return `${mon.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
      }
      return getLocalDateStr(d);
    }
    function generatePeriods(type, count, endDate) {
      const periods = [];
      const current = new Date(endDate);
      while (periods.length < count) {
        const key = getPeriodKey(current, type);
        if (!periods.includes(key)) periods.push(key);
        if (type === 'month') current.setMonth(current.getMonth() - 1);
        else if (type === 'week') current.setDate(current.getDate() - 7);
        else current.setDate(current.getDate() - 1);
      }
      return periods;
    }

    const endDateObj = new Date(sqlEnd.replace(' ', 'T'));
    const monthPeriods = generatePeriods('month', 3, endDateObj);
    const weekPeriods = generatePeriods('week', 4, endDateObj);
    const dayPeriods = generatePeriods('day', 14, endDateObj);

    // period -> count (общий по всем MPP выбранных VRT)
    const monthCounts = new Map(monthPeriods.map(p => [p, 0]));
    const weekCounts = new Map(weekPeriods.map(p => [p, 0]));
    const dayCounts = new Map(dayPeriods.map(p => [p, 0]));
    const monthCars = new Map(monthPeriods.map(p => [p, new Set()]));
    const weekCars = new Map(weekPeriods.map(p => [p, new Set()]));
    const dayCars = new Map(dayPeriods.map(p => [p, new Set()]));

    for (const defect of defectRows) {
      const key = `${defect.MODEL}|${defect.PART_NAME}|${defect.PROBLEM_TYPE}`;
      const vrt = ownerMap.get(key) || 'VRT не найдена';
      if (selectedVrtsSet && !selectedVrtsSet.has(vrt)) continue;
      const zone = zoneMap.get(key);
      if (selectedZones && selectedZones.length > 0 && (!zone || !selectedZones.includes(zone))) continue;

      const defDate = new Date(defect.CREATION_TIME);
      const mKey = getPeriodKey(defDate, 'month');
      if (monthCounts.has(mKey)) monthCounts.set(mKey, monthCounts.get(mKey) + 1);
      const wKey = getPeriodKey(defDate, 'week');
      if (weekCounts.has(wKey)) weekCounts.set(wKey, weekCounts.get(wKey) + 1);
      const dKey = getPeriodKey(defDate, 'day');
      if (dayCounts.has(dKey)) dayCounts.set(dKey, dayCounts.get(dKey) + 1);
    }

    const [cp72Rows] = await pool.query(`
      SELECT VIN, CREATION_TIME FROM at_om_wiptrackinghistory
      WHERE WC_NAME = 'CP72' AND CREATION_TIME >= ? AND CREATION_TIME <= ?
    `, [sqlStart, sqlEnd]);
    let cp72Filtered = cp72Rows;
    if (shift && shift !== 'all') cp72Filtered = cp72Rows.filter(c => getShiftLetterFromDate(c.CREATION_TIME) === shift);

    for (const car of cp72Filtered) {
      const carDate = new Date(car.CREATION_TIME);
      const mKey = getPeriodKey(carDate, 'month');
      if (monthCars.has(mKey)) monthCars.get(mKey).add(car.VIN);
      const wKey = getPeriodKey(carDate, 'week');
      if (weekCars.has(wKey)) weekCars.get(wKey).add(car.VIN);
      const dKey = getPeriodKey(carDate, 'day');
      if (dayCars.has(dKey)) dayCars.get(dKey).add(car.VIN);
    }

    // Без обрезки на 1000
    function buildResult(countsMap, carsMap) {
      const result = [];
      for (const period of countsMap.keys()) {
        const defects = countsMap.get(period);
        const totalCars = carsMap.get(period).size;
        let value;
        if (metric === 'dpu') value = totalCars > 0 ? Number(((defects / totalCars) * 1000).toFixed(2)) : 0;
        else value = defects;
        result.push({ period, value });
      }
      return result.sort((a, b) => a.period.localeCompare(b.period));
    }

    res.json({
      month: buildResult(monthCounts, monthCars),
      week: buildResult(weekCounts, weekCars),
      day: buildResult(dayCounts, dayCars),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Топ MPP по VRT
app.get('/api/vrt-report/top-mpp', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, defectType = 'all', vrt, shift, zones } = req.query;
    if (!vrt) return res.status(400).json({ error: 'vrt обязателен' });

    let sqlStart, sqlEnd;
    if (dateFrom && dateTo) { sqlStart = `${dateFrom} 00:00:00`; sqlEnd = `${dateTo} 23:59:59`; }
    else {
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const start = new Date(end); start.setDate(start.getDate() - 13); start.setHours(0,0,0,0);
      sqlStart = formatSqlDateTime(start); sqlEnd = formatSqlDateTime(end);
    }

    let defectRows = await fetchRawDefects(sqlStart, sqlEnd, checkpoint, defectType);
    if (shift && shift !== 'all') defectRows = defectRows.filter(d => getShiftLetterFromDate(d.CREATION_TIME) === shift);

    const [owners] = await notesPool.query(`
      SELECT do.model, do.bom_name, do.defect_name, do.zone, v.name AS vrt_name
      FROM vrt_owners do LEFT JOIN vrts v ON do.vrt_id = v.id
    `);
    const ownerMap = new Map();
    const zoneMap = new Map();
    owners.forEach(o => {
      const key = `${o.model}|${o.bom_name}|${o.defect_name}`;
      ownerMap.set(key, o.vrt_name);
      zoneMap.set(key, o.zone);
    });

    const selectedZones = zones ? zones.split(',').map(z => z.trim()).filter(Boolean) : null;

    const groups = new Map();
    for (const r of defectRows) {
      const key = `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;
      const owner = ownerMap.get(key) || 'VRT не найдена';
      if (owner !== vrt) continue;

      const zone = zoneMap.get(key) || '';
      if (selectedZones && selectedZones.length > 0 && (!zone || !selectedZones.includes(zone))) continue;

      const dateStr = getLocalDateStr(r.CREATION_TIME);
      const groupKey = `${dateStr}|${key}|${zone}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          date: dateStr,
          model: r.MODEL, bom_name: r.PART_NAME, defect_name: r.PROBLEM_TYPE, zone,
          mpp: `${r.MODEL || ''} ${r.PART_NAME || ''} ${r.PROBLEM_TYPE || ''} ${zone ? '('+zone+')' : ''}`.trim(),
          count: 0,
        });
      }
      groups.get(groupKey).count++;
    }

    const result = Array.from(groups.values()).sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.count - a.count;
    });

    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// VIN'ы по конкретному MPP + зоне + дате
app.get('/api/vrt-report/top-mpp-vins', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, defectType = 'all', shift, model, bom_name, defect_name, zone, date } = req.query;
    if (!model || !bom_name || !defect_name || !date) return res.status(400).json({ error: 'model, bom_name, defect_name, date обязательны' });

    let sqlStart, sqlEnd;
    if (dateFrom && dateTo) { sqlStart = `${dateFrom} 00:00:00`; sqlEnd = `${dateTo} 23:59:59`; }
    else {
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const start = new Date(end); start.setDate(start.getDate() - 13); start.setHours(0,0,0,0);
      sqlStart = formatSqlDateTime(start); sqlEnd = formatSqlDateTime(end);
    }

    let defectRows = await fetchRawDefects(sqlStart, sqlEnd, checkpoint, defectType);

    defectRows = defectRows.filter(r => {
      if (r.MODEL !== model) return false;
      if (r.PART_NAME !== bom_name) return false;
      if (r.PROBLEM_TYPE !== defect_name) return false;
      return getLocalDateStr(r.CREATION_TIME) === date;
    });

    if (shift && shift !== 'all') defectRows = defectRows.filter(r => getShiftLetterFromDate(r.CREATION_TIME) === shift);

    const vinSet = new Set(defectRows.map(r => r.VIN));
    res.json([...vinSet]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
