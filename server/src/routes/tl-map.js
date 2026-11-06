// Маршруты: карта тестовой линии (TL Map).
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { lesPool, mesPool } = require('../db');

// Эндпоинт для TL Map
app.get('/api/tl-map', async (req, res) => {
  try {
    const sql = `
      SELECT 
        tlo.vin,
        tlo.node_nature AS vehicle_status,
        SUBSTRING_INDEX(ord.product, ' ', -1) AS model,
        IFNULL(LEFT(SUBSTRING_INDEX(mat.material_desc, '_', 1), 5), '???') AS spec,
        RIGHT(ord.plan_unit_code, 4) AS lot,
        SUBSTR(vh.material_no, 8, 2) AS color,
        vh.sequence_number AS seq,
        MAX(mv.gmt_create) AS entry_time
      FROM tm_vhc_test_line_online tlo
      INNER JOIN tm_vhc_vehicle vh ON tlo.vin = vh.vin
      LEFT JOIN tm_bas_material_relation mat ON mat.material_no = vh.material_no AND mat.is_deleted = 0
      INNER JOIN tm_ofm_order ord ON tlo.vin = ord.vin
      LEFT JOIN tm_vhc_test_line_movement mv ON mv.vin = tlo.vin AND mv.node_nature = tlo.node_nature AND mv.is_deleted = 0
      WHERE tlo.node_nature IN ('TLWA','TLRT','TLADAS','TLTT','CPA')
        AND vh.vehicle_status IN ('Key_Uloc_Type_CP72', 'Key_Uloc_Type_CP7')
      GROUP BY tlo.vin, tlo.node_nature, ord.product, mat.material_desc, ord.plan_unit_code, vh.material_no, vh.sequence_number
      ORDER BY tlo.node_nature, tlo.vin
    `;
    const [rows] = await mesPool.query(sql);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка TL Map:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 1. Количество уникальных машин, прошедших через посты за сегодня
app.get('/api/tl-map-passed-today', async (req, res) => {
  try {
    const sql = `
      SELECT 
        node_nature AS zone_name,
        COUNT(DISTINCT vin) AS passed_count
      FROM tm_vhc_test_line_movement
      WHERE node_nature IN ('TLWA','TLRT','TLADAS','TLTT','CPA')
        AND DATE(gmt_create) = CURDATE()
        AND is_deleted = 0
      GROUP BY node_nature
    `;
    const [rows] = await mesPool.query(sql);
    const result = {};
    rows.forEach(row => {
      result[row.zone_name] = row.passed_count;
    });
    res.json(result);
  } catch (err) {
    console.error('Ошибка TL Map passed today:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. Список ВСЕХ записей прохождения через пост за сегодня (для таблицы)
app.get('/api/tl-map-passed-today-details', async (req, res) => {
  try {
    const { zone } = req.query;
    if (!zone) return res.status(400).json({ error: 'Не указана зона' });

    // Определяем следующий узел для выхода из зоны
    const nextZoneMap = {
      'TLWA': 'TLRT',
      'TLRT': 'TLADAS',
      'TLADAS': 'TLTT',
      'TLTT': 'CPFINAL',
    };
    const nextZone = nextZoneMap[zone] || null;

    // Получаем все записи входов в выбранную зону за сегодня
    const sql = `
      SELECT 
        tvtlm.vin,
        tvtlm.vhc_model AS model,
        tvtlm.material_no,
        tvtlm.sequence_number AS seq,
        tvtlm.gmt_create AS pass_time
      FROM tm_vhc_test_line_movement tvtlm
      WHERE tvtlm.node_nature = ?
        AND DATE(tvtlm.gmt_create) = CURDATE()
        AND tvtlm.is_deleted = 0
      ORDER BY tvtlm.vin, tvtlm.gmt_create ASC
    `;
    const [rows] = await mesPool.query(sql, [zone]);

    if (rows.length === 0 || !nextZone) {
      // Для зон без следующего (например, CPA) выход и длительность не считаем
      const result = rows.map(r => ({ ...r, exit_time: null, duration: null }));
      return res.json(result);
    }

    const vins = [...new Set(rows.map(r => r.vin))];
    const placeholders = vins.map(() => '?').join(',');

    let exitsByVin = {};

    if (nextZone === 'CPFINAL') {
      // Выход из TLTT ищем в ti_mes_movement (uloc_no = 'CPFINAL')
      const cpfinalSql = `
        SELECT vin, scan_time AS gmt_create
        FROM ti_mes_movement
        WHERE vin IN (${placeholders})
          AND uloc_no = 'CPFINAL'
          AND is_deleted = 0
        ORDER BY vin, scan_time ASC
      `;
      const [cpfinalRows] = await mesPool.query(cpfinalSql, vins);
      cpfinalRows.forEach(r => {
        if (!exitsByVin[r.vin]) exitsByVin[r.vin] = [];
        exitsByVin[r.vin].push(new Date(r.gmt_create));
      });
    } else {
      // Выход для TLWA, TLRT, TLADAS ищем в tm_vhc_test_line_movement
      const exitsAllSql = `
        SELECT vin, gmt_create
        FROM tm_vhc_test_line_movement
        WHERE vin IN (${placeholders})
          AND node_nature = ?
          AND is_deleted = 0
        ORDER BY vin, gmt_create ASC
      `;
      const [exitRows] = await mesPool.query(exitsAllSql, [...vins, nextZone]);
      exitRows.forEach(e => {
        if (!exitsByVin[e.vin]) exitsByVin[e.vin] = [];
        exitsByVin[e.vin].push(new Date(e.gmt_create));
      });
    }

    // Для каждой записи входа находим первый выход после входа
    const enriched = rows.map(r => {
      const vinExits = exitsByVin[r.vin] || [];
      const passDate = new Date(r.pass_time);
      let exitTime = null;
      for (const exit of vinExits) {
        if (exit > passDate) {
          exitTime = exit;
          break;
        }
      }
      let duration = null;
      if (exitTime) {
        const diffSec = Math.floor((exitTime - passDate) / 1000);
        if (diffSec >= 0) duration = diffSec;
      }
      return {
        ...r,
        exit_time: exitTime ? exitTime.toISOString() : null,
        duration,
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('Ошибка TL Map passed today details:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tl-map-analytics', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;

    // ---------- 1. VIN, прошедшие CP72 за период ----------
    let cp72Condition = '';
    const cp72Params = [];
    if (startTime) {
      cp72Condition += ' AND cp72.scan_time >= ?';
      cp72Params.push(startTime);
    }
    if (endTime) {
      cp72Condition += ' AND cp72.scan_time <= ?';
      cp72Params.push(endTime);
    }

    const cp72Sql = `
      SELECT DISTINCT vin
      FROM ti_mes_movement AS cp72
      WHERE uloc_no = 'CP72'
        AND is_deleted = 0
        ${cp72Condition}
    `;
    const [cp72Rows] = await mesPool.query(cp72Sql, cp72Params);
    const vins = cp72Rows.map(r => r.vin);
    if (vins.length === 0) return res.json([]);

    const placeholders = vins.map(() => '?').join(',');

    // ---------- 2. Получаем времена CP72 и CPFINAL ----------
    const cp72TimesSql = `
      SELECT vin, MIN(scan_time) AS cp72_time
      FROM ti_mes_movement
      WHERE vin IN (${placeholders})
        AND uloc_no = 'CP72'
        AND is_deleted = 0
      GROUP BY vin
    `;
    const [cp72TimesRows] = await mesPool.query(cp72TimesSql, vins);
    const cp72TimeMap = {};
    cp72TimesRows.forEach(r => { cp72TimeMap[r.vin] = r.cp72_time; });

    const cpfinalTimesSql = `
      SELECT vin, MIN(scan_time) AS cpfinal_time
      FROM ti_mes_movement
      WHERE vin IN (${placeholders})
        AND uloc_no = 'CPFINAL'
        AND is_deleted = 0
      GROUP BY vin
    `;
    const [cpfinalTimesRows] = await mesPool.query(cpfinalTimesSql, vins);
    const cpfinalTimeMap = {};
    cpfinalTimesRows.forEach(r => { cpfinalTimeMap[r.vin] = r.cpfinal_time; });

    // ---------- 3. Все движения TL/REP/CPA из tm_vhc_test_line_movement ----------
    const movementSql = `
      SELECT vin, node_nature, gmt_create
      FROM tm_vhc_test_line_movement
      WHERE vin IN (${placeholders})
        AND is_deleted = 0
      ORDER BY vin, gmt_create ASC
    `;
    const [movementRows] = await mesPool.query(movementSql, vins);

    const movementsByVin = {};
    vins.forEach(vin => { movementsByVin[vin] = []; });
    movementRows.forEach(row => {
      if (movementsByVin[row.vin]) {
        movementsByVin[row.vin].push({ zone: row.node_nature, time: new Date(row.gmt_create) });
      }
    });

    // ---------- 4. Все MES-точки (CP5..CP8, CP72, CPFINAL) ----------
    const mesAllSql = `
      SELECT vin, uloc_no, scan_time
      FROM ti_mes_movement
      WHERE vin IN (${placeholders})
        AND is_deleted = 0
      ORDER BY vin, scan_time ASC
    `;
    const [mesAllRows] = await mesPool.query(mesAllSql, vins);
    const mesPointsByVin = {};
    vins.forEach(vin => { mesPointsByVin[vin] = []; });
    mesAllRows.forEach(r => {
      if (mesPointsByVin[r.vin]) {
        mesPointsByVin[r.vin].push({
          zone: r.uloc_no === 'AGMBS01002' ? 'CP5' :
                r.uloc_no === 'AGMPS01002' ? 'CP6' :
                r.uloc_no === 'AGMAS01001' ? 'TRIMIN' :
                r.uloc_no === 'AGMAS01003' ? 'CP7' :
                r.uloc_no === 'CP72' ? 'CP72' :
                r.uloc_no === 'CPFINAL' ? 'CPFINAL' :
                r.uloc_no === 'AGMAS01004' ? 'CP8' : r.uloc_no,
          time: new Date(r.scan_time)
        });
      }
    });

    // ---------- 5. Складские точки (Inbound/Outbound) ----------
    const [lesRows] = await lesPool.query(
      `SELECT tbs.vin, tbs.in_storage_time, tbs.out_storage_time
       FROM tv_biz_storage_car tbs
       WHERE tbs.vin IN (${placeholders})`,
      vins
    );
    const lesMap = new Map(lesRows.map(r => [r.vin, r]));

    // ---------- 6. Обработка каждого VIN ----------
    const result = [];

    for (const vin of vins) {
      const moves = movementsByVin[vin] || [];
      const mesPoints = mesPointsByVin[vin] || [];
      const les = lesMap.get(vin);

      const cp72Time = cp72TimeMap[vin] ? new Date(cp72TimeMap[vin]) : null;
      const cpfinalTime = cpfinalTimeMap[vin] ? new Date(cpfinalTimeMap[vin]) : null;

      // --- Все точки после CP72 ---
      const allPointsAfterCp72 = [];
      if (cp72Time) {
        mesPoints.forEach(p => {
          if (p.time > cp72Time) allPointsAfterCp72.push(p);
        });
        moves.forEach(m => {
          if (m.time > cp72Time) allPointsAfterCp72.push(m);
        });
        if (les) {
          if (les.in_storage_time && new Date(les.in_storage_time) > cp72Time) {
            allPointsAfterCp72.push({ zone: 'Inbound', time: new Date(les.in_storage_time) });
          }
          if (les.out_storage_time && new Date(les.out_storage_time) > cp72Time) {
            allPointsAfterCp72.push({ zone: 'Outbound', time: new Date(les.out_storage_time) });
          }
        }
      }

      // --- Суммарное время на TL: CPFINAL - CP72, либо последняя точка после CP72 ---
      let totalSec = 0;
      if (cp72Time && cpfinalTime) {
        totalSec = Math.floor((cpfinalTime - cp72Time) / 1000);
        if (totalSec < 0) totalSec = 0;
      } else if (cp72Time && allPointsAfterCp72.length > 0) {
        const lastTime = allPointsAfterCp72.reduce((max, p) => p.time > max ? p.time : max, allPointsAfterCp72[0].time);
        totalSec = Math.floor((lastTime - cp72Time) / 1000);
        if (totalSec < 0) totalSec = 0;
      }

      // --- Ремзоны: суммируем все завершённые сессии + текущая, если есть ---
      let totalRemSeconds = 0;
      let inRem = false;
      let currentRemStart = null;
      let lastRemStart = null;
      let lastRemExit = null;

      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        if (m.zone.startsWith('REP')) {
          if (!inRem) {
            inRem = true;
            currentRemStart = m.time;
            lastRemStart = m.time;
            lastRemExit = null;
          }
        } else {
          if (inRem) {
            const exitTime = m.time;
            const diffMs = exitTime - currentRemStart;
            if (diffMs > 0) {
              totalRemSeconds += Math.floor(diffMs / 1000);
              lastRemExit = exitTime;
            }
            inRem = false;
            currentRemStart = null;
          }
        }
      }

      // Если последняя сессия не завершена (сейчас в ремзоне), добавляем время до текущего момента
      const stillInRem = inRem;
      if (stillInRem && currentRemStart) {
        const now = new Date();
        const diffMs = now - currentRemStart;
        if (diffMs > 0) {
          totalRemSeconds += Math.floor(diffMs / 1000);
        }
      }

      // --- Текущее расположение: самая поздняя точка среди всех источников ---
      const allPointsForLocation = [
        ...mesPoints,
        ...moves,
      ];
      if (les) {
        if (les.in_storage_time) allPointsForLocation.push({ zone: 'Inbound', time: new Date(les.in_storage_time) });
        if (les.out_storage_time) allPointsForLocation.push({ zone: 'Outbound', time: new Date(les.out_storage_time) });
      }

      let currentZone = 'Планирование';
      let maxTime = null;
      allPointsForLocation.forEach(p => {
        if (!maxTime || p.time > maxTime) {
          maxTime = p.time;
          currentZone = p.zone;
        }
      });

      result.push({
        vin,
        current_zone: currentZone,
        total_stay_seconds: totalSec,
        rem_in: lastRemStart ? lastRemStart.toISOString() : null,
        rem_out: stillInRem ? null : (lastRemExit ? lastRemExit.toISOString() : null),
        rem_duration_seconds: totalRemSeconds > 0 ? totalRemSeconds : null,
        in_rem: stillInRem,
      });
    }

    // Сортировка по убыванию суммарного времени
    result.sort((a, b) => b.total_stay_seconds - a.total_stay_seconds);

    // Кумулятивный процент
    const totalAllSeconds = result.reduce((sum, r) => sum + r.total_stay_seconds, 0);
    let cumSum = 0;
    const enriched = result.map(r => {
      cumSum += r.total_stay_seconds;
      r.cum_percent = totalAllSeconds > 0 ? +((cumSum / totalAllSeconds) * 100).toFixed(2) : 0;
      return r;
    });

    res.json(enriched);
  } catch (err) {
    console.error('Ошибка TL Map Analytics:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tl-map-vin-history', async (req, res) => {
  try {
    const { vin } = req.query;
    if (!vin) return res.status(400).json({ error: 'VIN не указан' });

    // 1. TL и REP зоны из tm_vhc_test_line_movement
    const [tlRows] = await mesPool.query(
      `SELECT 
         vin,
         node_nature AS zone,
         gmt_create AS event_time
       FROM tm_vhc_test_line_movement
       WHERE vin = ? AND is_deleted = 0
       ORDER BY gmt_create ASC`,
      [vin]
    );

    // 2. MES чекпоинты из ti_mes_movement
    const [mesRows] = await mesPool.query(
      `SELECT 
         vin,
         CASE 
           WHEN uloc_no = 'AGMBS01002' THEN 'CP5'
           WHEN uloc_no = 'AGMPS01002' THEN 'CP6'
           WHEN uloc_no = 'AGMAS01001' THEN 'TRIMIN'
           WHEN uloc_no = 'AGMAS01003' THEN 'CP7'
           WHEN uloc_no = 'CP72' THEN 'CP72'
           WHEN uloc_no = 'CPFINAL' THEN 'CPFINAL'
           WHEN uloc_no = 'AGMAS01004' THEN 'CP8'
           ELSE uloc_no
         END AS zone,
         scan_time AS event_time
       FROM ti_mes_movement
       WHERE vin = ? AND is_deleted = 0
       ORDER BY scan_time ASC`,
      [vin]
    );

    // 3. Складские события Inbound/Outbound из tv_biz_storage_car
    const [lesRows] = await lesPool.query(
      `SELECT 
         vin,
         'Inbound' AS zone,
         in_storage_time AS event_time
       FROM tv_biz_storage_car
       WHERE vin = ? AND in_storage_time IS NOT NULL
       UNION ALL
       SELECT 
         vin,
         'Outbound' AS zone,
         out_storage_time AS event_time
       FROM tv_biz_storage_car
       WHERE vin = ? AND out_storage_time IS NOT NULL`,
      [vin, vin]
    );

    // Формируем единый массив с указанием источника
    const history = [
      ...tlRows.map(r => ({
        vin: r.vin,
        zone: r.zone,
        event_time: r.event_time,
        source: 'TL Movement'
      })),
      ...mesRows.map(r => ({
        vin: r.vin,
        zone: r.zone,
        event_time: r.event_time,
        source: 'MES Movement'
      })),
      ...lesRows.map(r => ({
        vin: r.vin,
        zone: r.zone,
        event_time: r.event_time,
        source: 'LES Storage'
      }))
    ];

    // Сортируем по времени
    history.sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

    res.json(history);
  } catch (err) {
    console.error('Ошибка TL Map VIN history:', err.message);
    res.status(500).json({ error: err.message });
  }
});
