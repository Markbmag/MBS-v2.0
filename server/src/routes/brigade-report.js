// Маршруты: бригадный отчёт.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { BRIGADE_PASSWORD, IMPORT_PASSWORD } = require('../config/passwords');
const { notesPool, pool } = require('../db');

// =========================================================================
// ЕДИНЫЙ ХЕЛПЕР: списки постов — ТОЧНО как в /api/brigade-report/data
// (ALL = CP7 + CP8 + PIP, БЕЗ TL)
// =========================================================================
function getPostsForCheckpoints(checkpoint) {
  const cp7Posts = [
    'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
    'REPAIR', 'REPAIR_Final',
    'EXT1', 'PIP2', 'PIP4', 'PIP9'
  ];
  const cp8Posts = [
    'CP8', 'CP8 Gate', 'CP8-gate',
    '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'
  ];
  const pipPosts = [
    'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'
  ];
  const tlPosts = [
    '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'
  ];

  if (!checkpoint || checkpoint === 'ALL') {
    return [...new Set([...cp7Posts, ...cp8Posts, ...pipPosts])];
  }

  const cps = checkpoint.split(',').map(c => c.trim()).filter(Boolean);
  let postList = [];
  for (const cp of cps) {
    if (cp === 'CP7') postList.push(...cp7Posts);
    else if (cp === 'CP8') postList.push(...cp8Posts);
    else if (cp === 'PIP') postList.push(...pipPosts);
    else if (cp === 'TL') postList.push(...tlPosts);
  }
  return [...new Set(postList)];
}

// =========================================================================
// ЕДИНЫЙ ХЕЛПЕР: online/offline
// =========================================================================
function getOfflineCondition(defectType) {
  if (defectType === 'offline') {
    return '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 1';
  }
  if (defectType === 'online') {
    return '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 0';
  }
  return '1=1';
}

// =========================================================================
// ЕДИНЫЙ ХЕЛПЕР: получить сырые дефекты за период
// IDENTICNO /api/brigade-report/data — без GROUP BY, без LIMIT.
// =========================================================================
async function fetchRawDefects(sqlStart, sqlEnd, checkpoint, defectType) {
  const postList = getPostsForCheckpoints(checkpoint);
  if (postList.length === 0) return [];
  const postListStr = postList.map(p => `'${p.replace(/'/g, "''")}'`).join(',');

  const offlineCondition = getOfflineCondition(defectType);

  const sql = `
    SELECT
      d.VIN,
      d.PART_NAME,
      d.PROBLEM_TYPE,
      d.CREATION_TIME,
      d.POST_NAME,
      wo.MODEL
    FROM (
      SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
             OFFLINE, OFFLINE1, OFFLINE2
      FROM at_biw_qm_defect_info
      WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
        AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        AND ${offlineCondition}
      UNION ALL
      SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
             OFFLINE, OFFLINE1, OFFLINE2
      FROM at_paint_qm_defect_info
      WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
        AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        AND ${offlineCondition}
      UNION ALL
      SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
             OFFLINE, OFFLINE1, OFFLINE2
      FROM at_qm_defect_info
      WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
        AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        AND ${offlineCondition}
    ) d
    JOIN work_order wo ON wo.VIN = d.VIN
    WHERE d.POST_NAME IN (${postListStr})
      AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
  `;

  const [rows] = await pool.query(sql, [sqlStart, sqlEnd]);
  return rows;
}

// =========================================================================
// ЕДИНЫЙ ХЕЛПЕР: буква смены по UTC-времени
// =========================================================================
function getShiftLetterFromDate(creationTime) {
  const utc = new Date(creationTime);
  const moscow = new Date(utc.getTime() + 3 * 60 * 60 * 1000);
  const totalMinutes = moscow.getUTCHours() * 60 + moscow.getUTCMinutes();
  const year = moscow.getUTCFullYear();
  const month = moscow.getUTCMonth();
  const day = moscow.getUTCDate();

  const dateObj = new Date(Date.UTC(year, month, day));
  const dayNum = dateObj.getUTCDay() || 7;
  dateObj.setUTCDate(dateObj.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dateObj.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((dateObj - yearStart) / 86400000) + 1) / 7);
  const isEvenWeek = weekNumber % 2 === 0;

  let shiftType;
  if (totalMinutes >= 7 * 60 + 50 && totalMinutes <= 16 * 60 + 40) {
    shiftType = 'day';
  } else if (totalMinutes >= 16 * 60 + 41 || totalMinutes <= 1 * 60 + 30) {
    shiftType = 'evening';
  } else {
    shiftType = 'night';
  }

  if (shiftType === 'night') return 'C';
  if (shiftType === 'day') return isEvenWeek ? 'B' : 'A';
  return isEvenWeek ? 'A' : 'B';
}

// =========================================================================
// ЕДИНЫЙ ХЕЛПЕР: локальная дата Node в формате YYYY-MM-DD
// =========================================================================
function getLocalDateStr(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// =========================================================================
// ЕДИНЫЙ ХЕЛПЕР: формат SQL-даты из объекта Date (локальное время)
// =========================================================================
function formatSqlDateTime(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

// ================== БРИГАДНЫЙ ОТЧЁТ ==================

// Получение списка бригад
app.get('/api/brigade-report/brigades', async (req, res) => {
  try {
    const [rows] = await notesPool.query('SELECT id, name FROM brigades ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения списка бригад:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Получение данных для отчёта (гистограмма + топ дефектов без владельца)
// ================== БРИГАДНЫЙ ОТЧЁТ – ДАННЫЕ ДЛЯ ГИСТОГРАММЫ И ТАБЛИЦЫ ==================
app.get('/api/brigade-report/data', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      checkpoint,
      metric = 'count',
      defectType = 'all',
      shift = 'all',
    } = req.query;

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });
    }

    // ---------- Списки постов ----------
    const cp7Posts = ['CP7','CP7 Audit','CP7 Gate','CP7-gate','REPAIR','REPAIR_Final','EXT1','PIP2','PIP4','PIP9'];
    const cp8Posts = ['CP8','CP8 Gate','CP8-gate','360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT','CP8 Touch Up'];
    const pipPosts = ['EXT1','PIP1','PIP2','PIP4','PIP5','PIP6','PIP8','PIP9'];
    const tlPosts  = ['360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT','CP8 Touch Up'];

    let postList = [];
    if (!checkpoint || checkpoint === 'ALL') {
      postList = [...new Set([...cp7Posts, ...cp8Posts, ...pipPosts, ...tlPosts])];
    } else if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else if (checkpoint === 'PIP') postList = pipPosts;
    else if (checkpoint === 'TL')  postList = tlPosts;
    else return res.status(400).json({ error: 'Неверный checkpoint' });

    const postListStr = postList.map(p => `'${p.replace(/'/g, "''")}'`).join(',');

    let offlineCondition = '1=1';
    if (defectType === 'offline') {
      offlineCondition = '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 1';
    } else if (defectType === 'online') {
      offlineCondition = '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 0';
    }

    // ---------- Хелперы смен ----------
    const getISOWeek = (dateObj) => {
      const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };

    const toDateStr = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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

    // ---------- 1. Все VIN с CP72_TIME ----------
    const nextDayObj = new Date(`${dateTo}T12:00:00`);
    nextDayObj.setDate(nextDayObj.getDate() + 1);
    const nextDayStr = `${nextDayObj.getFullYear()}-${String(nextDayObj.getMonth() + 1).padStart(2, '0')}-${String(nextDayObj.getDate()).padStart(2, '0')}`;

    const [cp72Rows] = await pool.query(`
      SELECT VIN, MIN(CREATION_TIME) AS CP72_TIME
      FROM at_om_wiptrackinghistory
      WHERE WC_NAME = 'CP72'
        AND CREATION_TIME >= ? AND CREATION_TIME <= ?
      GROUP BY VIN
    `, [`${dateFrom} 00:00:00`, `${nextDayStr} 23:59:59`]);

    // ---------- 2. Два знаменателя ----------
    // totalCars      = все VIN за период (знаменатель DPU, НЕ зависит от смены)
    // totalCarsShift = VIN, попавшие в окно смены (для отображения «Всего авто»)
    const periodStartStr = dateFrom;
    const periodEndStr = dateTo;
    let totalCars = 0;
    let totalCarsShift = 0;

    for (const row of cp72Rows) {
      if (!row.CP72_TIME) continue;
      const d = new Date(row.CP72_TIME);
      const dStr = toDateStr(d);

      // Все авто за период
      if (dStr >= periodStartStr && dStr <= periodEndStr) {
        totalCars += 1;
      }

      // Авто за выбранную смену
      if (matchesShiftAndPeriod(d)) {
        totalCarsShift += 1;
      }
    }

    // ---------- 3. Дефекты ----------
    const defectsSql = `
      SELECT
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.CREATION_TIME,
        wo.MODEL
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_biw_qm_defect_info
        WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          AND ${offlineCondition}
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_paint_qm_defect_info
        WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          AND ${offlineCondition}
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_qm_defect_info
        WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          AND ${offlineCondition}
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr})
        AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
    `;

    const [defectRows] = await pool.query(defectsSql, [
      `${dateFrom} 00:00:00`,
      `${nextDayStr} 23:59:59`,
    ]);

    // ---------- 4. Справочник владельцев ----------
    const [owners] = await notesPool.query(`
      SELECT do.model, do.part_name, do.problem_type, b.name AS brigade_name
      FROM defect_owners do
      LEFT JOIN brigades b ON do.brigade_id = b.id
    `);
    const ownerMap = new Map();
    owners.forEach(o => ownerMap.set(
      `${o.model}|${o.part_name}|${o.problem_type}`,
      o.brigade_name
    ));

    // ---------- 5. Фильтрация + группировка ----------
    const brigadeDataMap = new Map();
    let totalDefects = 0;

    for (const r of defectRows) {
      const d = new Date(r.CREATION_TIME);
      if (!matchesShiftAndPeriod(d)) continue;

      totalDefects += 1;

      const key = `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;
      const brigade = ownerMap.get(key) || 'Бригада не найдена';

      if (!brigadeDataMap.has(brigade)) {
        brigadeDataMap.set(brigade, {
          brigade, count: 0, dpu: 0,
          mppsMap: new Map(), mpps: [],
        });
      }
      const brigadeData = brigadeDataMap.get(brigade);
      brigadeData.count += 1;

      const mppKey = `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;
      if (!brigadeData.mppsMap.has(mppKey)) {
        brigadeData.mppsMap.set(mppKey, {
          model: r.MODEL, part_name: r.PART_NAME, problem_type: r.PROBLEM_TYPE,
          count: 0, dpu: 0,
        });
      }
      brigadeData.mppsMap.get(mppKey).count += 1;
    }

    // ---------- 6. DPU (знаменатель = totalCars за период) ----------
    const calculateDpu = (count) => {
      if (totalCars === 0) return 0;
      const raw = count / totalCars * 1000;
      return Number(Math.min(raw, 1000).toFixed(2));
    };

    for (const [, brigadeData] of brigadeDataMap) {
      brigadeData.dpu = calculateDpu(brigadeData.count);
      brigadeData.mpps = Array.from(brigadeData.mppsMap.values()).map(mpp => ({
        ...mpp,
        dpu: calculateDpu(mpp.count),
      }));
      brigadeData.mpps.sort((a, b) => b.count - a.count);
    }

    // ---------- 7. Ответ ----------
    const histogram = Array.from(brigadeDataMap.entries())
      .map(([name, data]) => ({
        category: name,
        value: metric === 'dpu' ? data.dpu : data.count,
        count: data.count,
        dpu: data.dpu,
      }))
      .sort((a, b) => b.count - a.count);

    const unassignedData = brigadeDataMap.get('Бригада не найдена');
    const unassignedCount = unassignedData ? unassignedData.count : 0;

    const topBrigades = Array.from(brigadeDataMap.entries())
      .filter(([name]) => name !== 'Бригада не найдена')
      .map(([name, data]) => ({
        brigade: name,
        count: data.count,
        dpu: data.dpu,
        mpps: data.mpps,
      }))
      .sort((a, b) => b.count - a.count);

    res.json({
      histogram,
      totalCars,           // все авто за период (знаменатель DPU)
      totalCarsShift,      // авто в окне смены (для UI «Всего авто»)
      unassignedCount,
      totalDefects,
      topBrigades,
    });
  } catch (err) {
    console.error('Ошибка brigade-report/data:', err.message);
    res.status(500).json({ error: err.message });
  }
});



// ================== БРИГАДНЫЙ ОТЧЁТ – ТОП ДЕФЕКТОВ БЕЗ ВЛАДЕЛЬЦА ==================
app.get('/api/brigade-report/unassigned-defects', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      startTime,
      endTime,
      checkpoint,
      defectType = 'all'
    } = req.query;

    // Определяем точное начало и конец периода
    let sqlStart, sqlEnd;
    if (startTime && endTime) {
      sqlStart = startTime;
      sqlEnd = endTime;
    } else {
      if (!dateFrom || !dateTo) {
        return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });
      }
      sqlStart = `${dateFrom} 00:00:00`;
      sqlEnd = `${dateTo} 23:59:59`;
    }

    // Списки постов (как в data)
    const cp7Posts = [
      'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
      'REPAIR', 'REPAIR_Final',
      'EXT1', 'PIP2', 'PIP4', 'PIP9'
    ];

    const cp8Posts = [
      'CP8', 'CP8 Gate', 'CP8-gate',
      '360', 'ADAS', 'ADAS+RB', 'TEST TRACK',
      'TRACK', 'WA', 'WT', 'CP8 Touch Up'
    ];

    const pipPosts = [
      'EXT1', 'PIP1', 'PIP2', 'PIP4',
      'PIP5', 'PIP6', 'PIP8', 'PIP9'
    ];

    const tlPosts = [
      '360', 'ADAS', 'ADAS+RB', 'TEST TRACK',
      'TRACK', 'WA', 'WT', 'CP8 Touch Up'
    ];

    let postList = [];

    if (!checkpoint || checkpoint === 'ALL') {
      postList = [
        ...new Set([
          ...cp7Posts,
          ...cp8Posts,
          ...pipPosts
        ])
      ];
    } else if (checkpoint === 'CP7') {
      postList = cp7Posts;
    } else if (checkpoint === 'CP8') {
      postList = cp8Posts;
    } else if (checkpoint === 'PIP') {
      postList = pipPosts;
    } else if (checkpoint === 'TL') {
      postList = tlPosts;
    } else {
      return res.status(400).json({
        error: 'Неверный checkpoint'
      });
    }

    const postListStr = postList
      .map(p => `'${p.replace(/'/g, "''")}'`)
      .join(',');

    // Фильтр типа дефекта
    let offlineCondition = '1=1';

    if (defectType === 'offline') {
      offlineCondition = '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 1';
    } else if (defectType === 'online') {
      offlineCondition = '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 0';
    }

    // Получаем все дефекты (те же, что и в data)
    const defectsSql = `
      SELECT
        d.VIN,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.CREATION_TIME,
        d.POST_NAME,
        wo.MODEL
      FROM (
        SELECT
          VIN,
          PART_NAME,
          PROBLEM_TYPE,
          CREATION_TIME,
          POST_NAME
        FROM at_biw_qm_defect_info
        WHERE PART_NAME IS NOT NULL
          AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL
          AND TRIM(PROBLEM_TYPE) <> ''
          AND ${offlineCondition}

        UNION ALL

        SELECT
          VIN,
          PART_NAME,
          PROBLEM_TYPE,
          CREATION_TIME,
          POST_NAME
        FROM at_paint_qm_defect_info
        WHERE PART_NAME IS NOT NULL
          AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL
          AND TRIM(PROBLEM_TYPE) <> ''
          AND ${offlineCondition}

        UNION ALL

        SELECT
          VIN,
          PART_NAME,
          PROBLEM_TYPE,
          CREATION_TIME,
          POST_NAME
        FROM at_qm_defect_info
        WHERE PART_NAME IS NOT NULL
          AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL
          AND TRIM(PROBLEM_TYPE) <> ''
          AND ${offlineCondition}
      ) d
      JOIN work_order wo
        ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr})
        AND d.CREATION_TIME >= ?
        AND d.CREATION_TIME <= ?
    `;

    const [defectRows] = await pool.query(
      defectsSql,
      [sqlStart, sqlEnd]
    );

    // Загружаем справочник владельцев
    const [owners] = await notesPool.query(`
      SELECT
        do.model,
        do.part_name,
        do.problem_type,
        b.name AS brigade_name
      FROM defect_owners do
      LEFT JOIN brigades b
        ON do.brigade_id = b.id
    `);

    const ownerMap = new Map();

    owners.forEach(o => {
      const key = `${o.model}|${o.part_name}|${o.problem_type}`;
      ownerMap.set(key, o.brigade_name);
    });

    // Определяем нераспределённые дефекты
    const unassignedRows = [];

    for (const r of defectRows) {
      const key = `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;
      const brigade = ownerMap.get(key) || 'Бригада не найдена';

      if (brigade === 'Бригада не найдена') {
        unassignedRows.push(r);
      }
    }

    // Группируем по MPP
    const groups = new Map();

    for (const r of unassignedRows) {
      const key = `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;

      if (!groups.has(key)) {
        groups.set(key, {
          mpp: `${r.MODEL || 'UNKNOWN'} ${r.PART_NAME || ''} ${r.PROBLEM_TYPE || ''}`,
          model: r.MODEL,
          part_name: r.PART_NAME,
          problem_type: r.PROBLEM_TYPE,
          count: 0
        });
      }

      groups.get(key).count++;
    }

    const unassigned = Array.from(groups.values())
      .sort((a, b) => b.count - a.count);

    const totalUnassigned = unassignedRows.length;

    console.log(
      `[brigade-report] unassigned defects: ${totalUnassigned}, groups: ${unassigned.length}`
    );

    res.json(unassigned);

  } catch (err) {
    console.error('Ошибка unassigned-defects:', err);
    res.status(500).json({ error: err.message });
  }
});




// Назначение владельца дефекту (бригаде)
app.post('/api/brigade-report/assign-owner', async (req, res) => {
  try {
    const { model, part_name, problem_type, brigadeName, password } = req.body;
    if (!model || !part_name || !problem_type || !brigadeName || !password) {
      return res.status(400).json({ error: 'Не все обязательные поля заполнены' });
    }

    // Проверка пароля
    if (password !== BRIGADE_PASSWORD) {
      return res.status(403).json({ error: 'Неверный пароль' });
    }

    // Находим id бригады
    const [brigadeRows] = await notesPool.query('SELECT id FROM brigades WHERE name = ?', [brigadeName]);
    if (brigadeRows.length === 0) {
      return res.status(404).json({ error: 'Бригада не найдена' });
    }
    const brigadeId = brigadeRows[0].id;

    // Вставляем или обновляем запись о владельце
    await notesPool.query(`
      INSERT INTO defect_owners (model, part_name, problem_type, brigade_id)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE brigade_id = VALUES(brigade_id)
    `, [model, part_name, problem_type, brigadeId]);

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка назначения владельца:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Получение всего справочника
app.get('/api/brigade-report/dictionary', async (req, res) => {
  try {
    const [rows] = await notesPool.query(`
      SELECT do.id, do.model, do.part_name, do.problem_type, b.name AS brigade_name
      FROM defect_owners do
      LEFT JOIN brigades b ON do.brigade_id = b.id
      ORDER BY do.model, do.part_name, do.problem_type
    `);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения справочника:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Добавление/обновление записи в справочнике
app.post('/api/brigade-report/dictionary', async (req, res) => {
  try {
    const { model, part_name, problem_type, brigadeName, password } = req.body;
    if (!model || !part_name || !problem_type || !brigadeName || !password) {
      return res.status(400).json({ error: 'Не все обязательные поля заполнены' });
    }
    if (password !== BRIGADE_PASSWORD) {
      return res.status(403).json({ error: 'Неверный пароль' });
    }

    const [brigadeRows] = await notesPool.query('SELECT id FROM brigades WHERE name = ?', [brigadeName]);
    if (brigadeRows.length === 0) {
      return res.status(404).json({ error: 'Бригада не найдена' });
    }
    const brigadeId = brigadeRows[0].id;

    await notesPool.query(`
      INSERT INTO defect_owners (model, part_name, problem_type, brigade_id)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE brigade_id = VALUES(brigade_id)
    `, [model, part_name, problem_type, brigadeId]);

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения записи справочника:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Удаление записи из справочника
app.delete('/api/brigade-report/dictionary/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Пароль обязателен' });
    if (password !== BRIGADE_PASSWORD) return res.status(403).json({ error: 'Неверный пароль' });

    await notesPool.query('DELETE FROM defect_owners WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления записи справочника:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Вспомогательная функция временного диапазона
function getTimeRangeForBrigade(timeFilter) {
  const nowMoscow = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const totalMinutes = nowMoscow.getUTCHours() * 60 + nowMoscow.getUTCMinutes();
  const todayStr = nowMoscow.toISOString().slice(0, 10);
  const yesterday = new Date(nowMoscow);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  if (timeFilter === 'all') {
    return { start: `${todayStr} 00:00:00`, end: `${todayStr} 23:59:59` };
  }
  if (timeFilter === 'day') {
    const dateToUse = totalMinutes >= 7 * 60 + 50 ? todayStr : yesterdayStr;
    return { start: `${dateToUse} 07:50:00`, end: `${dateToUse} 16:40:00` };
  }
  if (timeFilter === 'evening') {
    const dateToUse = totalMinutes >= 16 * 60 + 41 ? todayStr : yesterdayStr;
    const startDate = new Date(`${dateToUse}T16:41:00Z`);
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const endStr = endDate.toISOString().slice(0, 10);
    return { start: `${dateToUse} 16:41:00`, end: `${endStr} 01:30:00` };
  }
  if (timeFilter === 'night') {
    const dateToUse = totalMinutes >= 1 * 60 + 31 ? todayStr : yesterdayStr;
    return { start: `${dateToUse} 01:31:00`, end: `${dateToUse} 07:50:00` };
  }
  return { start: `${todayStr} 00:00:00`, end: `${todayStr} 23:59:59` };
}

app.get('/api/brigade-report/models', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT MODEL
      FROM work_order
      WHERE MODEL IS NOT NULL AND TRIM(MODEL) <> ''
      ORDER BY MODEL
    `);
    res.json(rows.map(r => r.MODEL));
  } catch (err) {
    console.error('Ошибка получения списка моделей:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ИМПОРТ СПРАВОЧНИКА ==================
app.post('/api/brigade-report/import', async (req, res) => {
  try {
    const { entries, password } = req.body;
    if (!entries || !Array.isArray(entries) || entries.length === 0 || !password) {
      return res.status(400).json({ error: 'Не переданы данные или пароль' });
    }
    // Пароль для импорта — 4002 (отдельный от основного)
    if (password !== IMPORT_PASSWORD) {
      return res.status(403).json({ error: 'Неверный пароль для импорта' });
    }

    const brigadeCache = new Map();
    let imported = 0;
    for (const entry of entries) {
      const { model, part_name, problem_type, brigadeName } = entry;
      if (!model || !part_name || !problem_type || !brigadeName) continue;

      let brigadeId = brigadeCache.get(brigadeName);
      if (!brigadeId) {
        const [rows] = await notesPool.query('SELECT id FROM brigades WHERE name = ?', [brigadeName]);
        if (rows.length === 0) continue;
        brigadeId = rows[0].id;
        brigadeCache.set(brigadeName, brigadeId);
      }

      await notesPool.query(`
        INSERT INTO defect_owners (model, part_name, problem_type, brigade_id)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE brigade_id = VALUES(brigade_id)
      `, [model, part_name, problem_type, brigadeId]);

      imported++;
    }

    res.json({ success: true, imported });
  } catch (err) {
    console.error('Ошибка импорта справочника:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/brigade-report/assign-all-models', async (req, res) => {
  try {
    const { part_name, problem_type, brigadeName, password } = req.body;
    if (!part_name || !problem_type || !brigadeName || !password) {
      return res.status(400).json({ error: 'Не все обязательные поля заполнены' });
    }
    if (password !== BRIGADE_PASSWORD) {
      return res.status(403).json({ error: 'Неверный пароль' });
    }

    const [brigadeRows] = await notesPool.query('SELECT id FROM brigades WHERE name = ?', [brigadeName]);
    if (brigadeRows.length === 0) {
      return res.status(404).json({ error: 'Бригада не найдена' });
    }
    const brigadeId = brigadeRows[0].id;

    // Получаем все модели
    const [models] = await pool.query(`SELECT DISTINCT MODEL FROM work_order WHERE MODEL IS NOT NULL AND TRIM(MODEL) <> ''`);
    for (const { MODEL } of models) {
      await notesPool.query(`
        INSERT INTO defect_owners (model, part_name, problem_type, brigade_id)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE brigade_id = VALUES(brigade_id)
      `, [MODEL, part_name, problem_type, brigadeId]);
    }

    res.json({ success: true, models: models.length });
  } catch (err) {
    console.error('Ошибка назначения на все модели:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== УПРАВЛЕНИЕ БРИГАДАМИ ==================

// Добавление новой бригады
app.post('/api/brigade-report/brigades', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) {
      return res.status(400).json({ error: 'name и password обязательны' });
    }
    if (password !== BRIGADE_PASSWORD) {
      return res.status(403).json({ error: 'Неверный пароль' });
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'Название не может быть пустым' });
    }

    // Проверяем на дубликат
    const [existing] = await notesPool.query('SELECT id FROM brigades WHERE name = ?', [trimmedName]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Бригада с таким названием уже существует' });
    }

    await notesPool.query('INSERT INTO brigades (name) VALUES (?)', [trimmedName]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка добавления бригады:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Удаление бригады (дефекты автоматически перейдут к "Бригада не найдена" через триггер)
app.delete('/api/brigade-report/brigades/:id', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'password обязателен' });
    }
    if (password !== BRIGADE_PASSWORD) {
      return res.status(403).json({ error: 'Неверный пароль' });
    }

    // Запрещаем удалять специальную бригаду
    const [brigade] = await notesPool.query('SELECT name FROM brigades WHERE id = ?', [req.params.id]);
    if (brigade.length === 0) {
      return res.status(404).json({ error: 'Бригада не найдена' });
    }
    if (brigade[0].name === 'Бригада не найдена') {
      return res.status(400).json({ error: 'Нельзя удалить системную бригаду "Бригада не найдена"' });
    }

    await notesPool.query('DELETE FROM brigades WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления бригады:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ================== БРИГАДНЫЙ ОТЧЁТ – ТРЕНДЫ (МЕСЯЦЫ/НЕДЕЛИ/ДНИ) ==================
app.get('/api/brigade-report/trend', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      startTime,
      endTime,
      checkpoint,
      defectType = 'all',
      brigades,
      metric = 'count',
      shift
    } = req.query;

    // 1. Определяем диапазон — идентично /api/brigade-report/data
    let sqlStart, sqlEnd;
    if (startTime && endTime) {
      sqlStart = startTime;
      sqlEnd = endTime;
    } else if (dateFrom && dateTo) {
      sqlStart = `${dateFrom} 00:00:00`;
      sqlEnd = `${dateTo} 23:59:59`;
    } else {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setMonth(start.getMonth() - 3);
      start.setHours(0, 0, 0, 0);
      sqlStart = formatSqlDateTime(start);
      sqlEnd = formatSqlDateTime(end);
    }

    // 2. Сырые дефекты — та же выборка, что в data
    let defectRows = await fetchRawDefects(sqlStart, sqlEnd, checkpoint, defectType);

    // 3. Фильтр по смене
    if (shift && shift !== 'all') {
      defectRows = defectRows.filter(
        d => getShiftLetterFromDate(d.CREATION_TIME) === shift
      );
    }

    // 4. Справочник владельцев
    const [owners] = await notesPool.query(`
      SELECT do.model, do.part_name, do.problem_type, b.name AS brigade_name
      FROM defect_owners do
      LEFT JOIN brigades b ON do.brigade_id = b.id
    `);
    const ownerMap = new Map();
    owners.forEach(o => ownerMap.set(
      `${o.model}|${o.part_name}|${o.problem_type}`,
      o.brigade_name
    ));

    // 5. Выбранные бригады
    let selectedBrigadesSet = null;
    if (brigades && brigades !== 'ALL') {
      selectedBrigadesSet = new Set(
        brigades.split(',').map(b => b.trim()).filter(Boolean)
      );
    }

    // 6. Периоды
    function getPeriodKey(date, type) {
      const d = new Date(date);
      if (type === 'month') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      } else if (type === 'week') {
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

    // 7. Счётчики
    const monthCounts = new Map(monthPeriods.map(p => [p, 0]));
    const weekCounts = new Map(weekPeriods.map(p => [p, 0]));
    const dayCounts = new Map(dayPeriods.map(p => [p, 0]));
    const monthCars = new Map(monthPeriods.map(p => [p, new Set()]));
    const weekCars = new Map(weekPeriods.map(p => [p, new Set()]));
    const dayCars = new Map(dayPeriods.map(p => [p, new Set()]));

    // 8. Дефекты
    for (const defect of defectRows) {
      const brigade = ownerMap.get(
        `${defect.MODEL}|${defect.PART_NAME}|${defect.PROBLEM_TYPE}`
      ) || 'Бригада не найдена';
      if (selectedBrigadesSet && !selectedBrigadesSet.has(brigade)) continue;

      const defDate = new Date(defect.CREATION_TIME);

      const mKey = getPeriodKey(defDate, 'month');
      if (monthCounts.has(mKey)) monthCounts.set(mKey, monthCounts.get(mKey) + 1);

      const wKey = getPeriodKey(defDate, 'week');
      if (weekCounts.has(wKey)) weekCounts.set(wKey, weekCounts.get(wKey) + 1);

      const dKey = getPeriodKey(defDate, 'day');
      if (dayCounts.has(dKey)) dayCounts.set(dKey, dayCounts.get(dKey) + 1);
    }

    // 9. CP72 для DPU
    const [cp72Rows] = await pool.query(`
      SELECT VIN, CREATION_TIME
      FROM at_om_wiptrackinghistory
      WHERE WC_NAME = 'CP72'
        AND CREATION_TIME >= ? AND CREATION_TIME <= ?
    `, [sqlStart, sqlEnd]);

    let cp72Filtered = cp72Rows;
    if (shift && shift !== 'all') {
      cp72Filtered = cp72Rows.filter(
        c => getShiftLetterFromDate(c.CREATION_TIME) === shift
      );
    }

    for (const car of cp72Filtered) {
      const carDate = new Date(car.CREATION_TIME);

      const mKey = getPeriodKey(carDate, 'month');
      if (monthCars.has(mKey)) monthCars.get(mKey).add(car.VIN);

      const wKey = getPeriodKey(carDate, 'week');
      if (weekCars.has(wKey)) weekCars.get(wKey).add(car.VIN);

      const dKey = getPeriodKey(carDate, 'day');
      if (dayCars.has(dKey)) dayCars.get(dKey).add(car.VIN);
    }

    // 10. Результат
    function buildResult(countsMap, carsMap) {
      const result = [];
      for (const period of countsMap.keys()) {
        const defects = countsMap.get(period);
        const totalCars = carsMap.get(period).size;
        let value;
        if (metric === 'dpu') {
          value = totalCars > 0 ? Math.min(defects / totalCars * 1000, 1000) : 0;
          value = Number(value.toFixed(2));
        } else {
          value = defects;
        }
        result.push({ period, value });
      }
      return result.sort((a, b) => a.period.localeCompare(b.period));
    }

    res.json({
      month: buildResult(monthCounts, monthCars),
      week: buildResult(weekCounts, weekCars),
      day: buildResult(dayCounts, dayCars)
    });
  } catch (err) {
    console.error('Ошибка /api/brigade-report/trend:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ================== ТОП MPP ПО БРИГАДЕ (для таблицы под графиками) ==================


// =========================================================================
// ЭНДПОИНТ: /api/brigade-report/top-mpp
// SQL максимально приближен к /api/defects-dashboard:
//   - фильтр CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) внутри каждого подзапроса
//   - GROUP BY PART_NAME, PROBLEM_TYPE, DATE(CREATION_TIME), MODEL, VIN, POST_NAME
//   - ORDER BY CREATION_TIME DESC
//   - LIMIT 5000
// =========================================================================
app.get('/api/brigade-report/top-mpp', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      startTime,
      endTime,
      checkpoint,
      defectType = 'all',
      brigade,
      shift
    } = req.query;

    if (!brigade) {
      return res.status(400).json({ error: 'brigade обязателен' });
    }

    // Тот же диапазон, что в trend
    let sqlStart, sqlEnd;
    if (startTime && endTime) {
      sqlStart = startTime;
      sqlEnd = endTime;
    } else if (dateFrom && dateTo) {
      sqlStart = `${dateFrom} 00:00:00`;
      sqlEnd = `${dateTo} 23:59:59`;
    } else {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(start.getDate() - 13);
      start.setHours(0, 0, 0, 0);
      sqlStart = formatSqlDateTime(start);
      sqlEnd = formatSqlDateTime(end);
    }

    // ТА ЖЕ выборка, что в data и trend
    let defectRows = await fetchRawDefects(sqlStart, sqlEnd, checkpoint, defectType);

    if (shift && shift !== 'all') {
      defectRows = defectRows.filter(
        d => getShiftLetterFromDate(d.CREATION_TIME) === shift
      );
    }

    // Справочник владельцев
    const [owners] = await notesPool.query(`
      SELECT do.model, do.part_name, do.problem_type, b.name AS brigade_name
      FROM defect_owners do
      LEFT JOIN brigades b ON do.brigade_id = b.id
    `);
    const ownerMap = new Map();
    owners.forEach(o => ownerMap.set(
      `${o.model}|${o.part_name}|${o.problem_type}`,
      o.brigade_name
    ));

    // Группировка по локальной дате Node — как в trend
    const groups = new Map();
    for (const r of defectRows) {
      const owner = ownerMap.get(
        `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`
      ) || 'Бригада не найдена';
      if (owner !== brigade) continue;

      const dateStr = getLocalDateStr(r.CREATION_TIME);
      const key = `${dateStr}|${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;

      if (!groups.has(key)) {
        groups.set(key, {
          date: dateStr,
          model: r.MODEL,
          part_name: r.PART_NAME,
          problem_type: r.PROBLEM_TYPE,
          mpp: `${r.MODEL || ''} ${r.PART_NAME || ''} ${r.PROBLEM_TYPE || ''}`.trim(),
          count: 0,
        });
      }
      groups.get(key).count++;
    }

    const result = Array.from(groups.values()).sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.count - a.count;
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка top-mpp:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// ЭНДПОИНТ: /api/brigade-report/top-mpp-vins
// Уникальные VIN'ы по конкретному MPP за конкретный день
// (дата — серверная, как в /api/defects-dashboard), с учётом фильтра смены.
// =========================================================================
app.get('/api/brigade-report/top-mpp-vins', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      checkpoint,
      defectType = 'all',
      shift,
      model,
      part_name,
      problem_type,
      date
    } = req.query;

    if (!model || !part_name || !problem_type || !date) {
      return res.status(400).json({
        error: 'model, part_name, problem_type, date обязательны'
      });
    }

    let sqlStart, sqlEnd;
    if (dateFrom && dateTo) {
      sqlStart = `${dateFrom} 00:00:00`;
      sqlEnd = `${dateTo} 23:59:59`;
    } else {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(start.getDate() - 13);
      start.setHours(0, 0, 0, 0);
      sqlStart = formatSqlDateTime(start);
      sqlEnd = formatSqlDateTime(end);
    }

    // ТА ЖЕ выборка
    let defectRows = await fetchRawDefects(sqlStart, sqlEnd, checkpoint, defectType);

    // Фильтр по конкретному MPP и локальной дате Node
    defectRows = defectRows.filter(r => {
      if (r.MODEL !== model) return false;
      if (r.PART_NAME !== part_name) return false;
      if (r.PROBLEM_TYPE !== problem_type) return false;
      return getLocalDateStr(r.CREATION_TIME) === date;
    });

    // Фильтр по смене
    if (shift && shift !== 'all') {
      defectRows = defectRows.filter(
        r => getShiftLetterFromDate(r.CREATION_TIME) === shift
      );
    }

    const vinSet = new Set(defectRows.map(r => r.VIN));
    res.json([...vinSet]);
  } catch (err) {
    console.error('Ошибка top-mpp-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { fetchRawDefects, formatSqlDateTime, getLocalDateStr, getShiftLetterFromDate };
