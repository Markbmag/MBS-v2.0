// Маршруты: Checkpoint Map, статистика ремзоны.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { mesPool, pool } = require('../db');

// ================== CHECKPOINT MAP – СТАТИСТИКА ==================
app.get('/api/checkpoint-stats', async (req, res) => {
  try {
    const { dateFrom, dateTo, model, defectType } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });

    const type = defectType || 'all';

    const pipPostsAll = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
    const cp7PostsAll = ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'REPAIR', 'REPAIR_Final', 'EXT1', 'PIP2', 'PIP4', 'PIP9'];
    const tlPostsAll  = ['360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT','CP8 Touch Up'];
    const cp8PostsAll = ['CP8', 'CP8 Gate', 'CP8-gate'];

    const checkpoints = [
      { id: 'PIP', posts: pipPostsAll },
      { id: 'CP7', posts: cp7PostsAll },
      { id: 'TL',  posts: tlPostsAll  },
      { id: 'CP8', posts: cp8PostsAll }
    ];

    const results = [];

    for (const cp of checkpoints) {
      const postListStr = cp.posts.map(p => `'${p}'`).join(',');

      // Общее количество VIN, прошедших посты (для информации)
      let totalSql = `
        SELECT COUNT(DISTINCT VIN) AS TOTAL
        FROM at_om_wiptrackinghistory
        WHERE WC_NAME IN (${postListStr})
          AND DATE(CREATION_TIME) BETWEEN ? AND ?
      `;
      const totalParams = [dateFrom, dateTo];
      if (model) { totalSql += ` AND MODEL = ?`; totalParams.push(model); }
      const [[{ TOTAL }]] = await pool.query(totalSql, totalParams);
      const totalVins = TOTAL || 0;

      // Офлайн VIN (независимый подсчёт)
      let offlineSql = `
        SELECT COUNT(DISTINCT QM_DEF.VIN) AS OFFLINE
        FROM (
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_biw_qm_defect_info
          UNION ALL
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_paint_qm_defect_info
          UNION ALL
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_qm_defect_info
        ) QM_DEF
        JOIN work_order wo ON wo.VIN = QM_DEF.VIN
        WHERE QM_DEF.POST_NAME IN (${postListStr})
          AND QM_DEF.S_OFFLINE = 1
          AND QM_DEF.CREATION_DATE BETWEEN ? AND ?
      `;
      const offlineParams = [dateFrom, dateTo];
      if (model) { offlineSql += ` AND wo.MODEL = ?`; offlineParams.push(model); }
      const [[{ OFFLINE }]] = await pool.query(offlineSql, offlineParams);
      let offlineVins = OFFLINE || 0;

      // Онлайн VIN (независимый подсчёт)
      let onlineSql = `
        SELECT COUNT(DISTINCT QM_DEF.VIN) AS ONLINE
        FROM (
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_biw_qm_defect_info
          UNION ALL
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_paint_qm_defect_info
          UNION ALL
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_qm_defect_info
        ) QM_DEF
        JOIN work_order wo ON wo.VIN = QM_DEF.VIN
        WHERE QM_DEF.POST_NAME IN (${postListStr})
          AND QM_DEF.S_OFFLINE = 0
          AND QM_DEF.CREATION_DATE BETWEEN ? AND ?
      `;
      const onlineParams = [dateFrom, dateTo];
      if (model) { onlineSql += ` AND wo.MODEL = ?`; onlineParams.push(model); }
      const [[{ ONLINE }]] = await pool.query(onlineSql, onlineParams);
      let onlineVins = ONLINE || 0;

      // Применяем фильтр типа дефектов
      if (type === 'offline') {
        onlineVins = 0;
      } else if (type === 'online') {
        offlineVins = 0;
      }

      results.push({
        checkpoint: cp.id,
        posts: cp.posts,
        totalVins,
        offlineVins,
        onlineVins
      });
    }

    res.json(results);
  } catch (err) {
    console.error('ОШИБКА checkpoint-stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== CHECKPOINT DEFECTS (для Checkpoint Map) ==================
app.get('/api/checkpoint-defects', async (req, res) => {
  try {
    const { checkpoint, defectType, dateFrom, dateTo, model } = req.query;
    if (!checkpoint || !dateFrom || !dateTo) return res.status(400).json({ error: 'checkpoint, dateFrom, dateTo обязательны' });

    const type = defectType || 'all';

    // Базовые списки
    const pipPostsAll   = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
    const pipPostsPure  = ['EXT1', 'PIP1', 'PIP5', 'PIP6', 'PIP8'];
    const cp7PostsAll   = ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'REPAIR', 'REPAIR_Final', 'EXT1', 'PIP2', 'PIP4', 'PIP9'];
    const tlPostsAll    = ['360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT','CP8 Touch Up'];
    const cp8PostsAll   = ['CP8', 'CP8 Gate', 'CP8-gate'];

    let postList;
    if (checkpoint === 'PIP') {
      // Для PIP: при 'offline' исключаем общие посты, при 'online' и 'all' – полный список
      if (type === 'offline') postList = pipPostsPure;
      else postList = pipPostsAll;
    } else if (checkpoint === 'CP7') postList = cp7PostsAll;
    else if (checkpoint === 'TL')  postList = tlPostsAll;
    else if (checkpoint === 'CP8') postList = cp8PostsAll;
    else return res.status(400).json({ error: 'Неверный checkpoint' });

    const postListStr = postList.map(p => `'${p}'`).join(',');

    let typeCondition = '';
    if (type === 'offline') typeCondition = ' AND QM_DEF.S_OFFLINE = 1';
    else if (type === 'online') typeCondition = ' AND QM_DEF.S_OFFLINE = 0';

    const params = [dateFrom, dateTo];
    let modelCondition = '';
    if (model && model !== 'ALL') {
      modelCondition = ' AND wo.MODEL = ?';
      params.push(model);
    }

    const query = `
      SELECT 
        QM_DEF.PART_NAME,
        QM_DEF.PROBLEM_TYPE,
        CONCAT(QM_DEF.PART_NAME, ' ', QM_DEF.PROBLEM_TYPE) AS PP,
        wo.MODEL,
        COUNT(*) AS QTY_DEF
      FROM (
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE QM_DEF.POST_NAME IN (${postListStr})
        ${typeCondition}
        AND QM_DEF.CREATION_DATE BETWEEN ? AND ?
        ${modelCondition}
        AND QM_DEF.PART_NAME IS NOT NULL AND TRIM(QM_DEF.PART_NAME) <> ''
        AND QM_DEF.PROBLEM_TYPE IS NOT NULL AND TRIM(QM_DEF.PROBLEM_TYPE) <> ''
      GROUP BY QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE, wo.MODEL
      ORDER BY QTY_DEF DESC
      LIMIT 10
    `;

    const [rows] = await pool.query(query, params);
    const result = rows.map(row => ({
      MPP: `${row.MODEL || 'UNKNOWN'} ${row.PP}`,
      DEFECTS_COUNT: Number(row.QTY_DEF) || 0,
    }));

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА checkpoint-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/remzone-stats', async (req, res) => {
  try {
    const { dateFrom, dateTo, model } = req.query;
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });
    }

    // 1. Все VIN, прошедшие CP7 за период (без лишних преобразований времени)
    // При необходимости поправьте часовой пояс (470 минут), если tvvm.scan_time в UTC.
    // Пока используем простое условие по дате.
    const baseQuery = `
      SELECT tvv.VIN, too.product AS MODEL
      FROM tm_vhc_vehicle tvv
      JOIN tm_ofm_order too ON too.VIN = tvv.VIN
      JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
      WHERE tvvm.node_nature = 'Key_Uloc_Type_CP7'
        AND DATE(tvvm.scan_time) BETWEEN ? AND ?
    `;

    // 2. Считаем, сколько из них были в ремзоне (есть запись в tm_vhc_test_line_movement с 'REP%')
    const query = `
      SELECT cp7.MODEL, COUNT(DISTINCT cp7.VIN) AS REMZONE_COUNT
      FROM (${baseQuery}) cp7
      WHERE cp7.VIN IN (
        SELECT DISTINCT tvtlm.VIN
        FROM tm_vhc_test_line_movement tvtlm
        WHERE tvtlm.node_nature LIKE 'REP%'
      )
      ${model && model !== 'ALL' ? 'AND cp7.MODEL = ?' : ''}
      GROUP BY cp7.MODEL
      ORDER BY cp7.MODEL
    `;

    const params = [dateFrom, dateTo];
    if (model && model !== 'ALL') {
      // Параметр для модели добавляется в WHERE после IN, поэтому он третий
      // Лучше перестроить, чтобы было безопасно:
      // Используем параметризованный запрос с явным условием
    }

    // Для простоты перепишем с явной подстановкой параметров
    let finalQuery = `
      SELECT cp7.MODEL, COUNT(DISTINCT cp7.VIN) AS REMZONE_COUNT
      FROM (
        SELECT tvv.VIN, too.product AS MODEL
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CP7'
          AND DATE(tvvm.scan_time) BETWEEN ? AND ?
      ) cp7
      WHERE cp7.VIN IN (
        SELECT DISTINCT tvtlm.VIN
        FROM tm_vhc_test_line_movement tvtlm
        WHERE tvtlm.node_nature LIKE 'REP%'
      )
    `;
    const finalParams = [dateFrom, dateTo];

    if (model && model !== 'ALL') {
      finalQuery += ' AND cp7.MODEL = ?';
      finalParams.push(model);
    }

    finalQuery += ' GROUP BY cp7.MODEL ORDER BY cp7.MODEL';

    const [rows] = await mesPool.query(finalQuery, finalParams);
    res.json(rows);
  } catch (err) {
    console.error('ОШИБКА remzone-stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/remzone-tl-stats', async (req, res) => {
  try {
    const { dateFrom, dateTo, model } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });

    // Авто, прошедшие TL и попавшие в ремзону
    const query = `
      SELECT cp.MODEL, COUNT(DISTINCT cp.VIN) AS REMZONE_COUNT
      FROM (
        SELECT tvv.VIN, too.product AS MODEL
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_TL'
          AND DATE(tvvm.scan_time) BETWEEN ? AND ?
      ) cp
      WHERE cp.VIN IN (
        SELECT DISTINCT tvtlm.VIN
        FROM tm_vhc_test_line_movement tvtlm
        WHERE tvtlm.node_nature LIKE 'REP%'
      )
      ${model && model !== 'ALL' ? 'AND cp.MODEL = ?' : ''}
      GROUP BY cp.MODEL
      ORDER BY cp.MODEL
    `;
    const params = [dateFrom, dateTo];
    if (model && model !== 'ALL') params.push(model);
    const [rows] = await mesPool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('ОШИБКА remzone-tl-stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});
