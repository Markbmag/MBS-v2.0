// Маршруты: Vehicle on wheels.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { mesPool } = require('../db');

// ================== VEHICLE ON WHEELS ==================
// ================== VEHICLE ON WHEELS ==================
// ================== VEHICLE ON WHEELS ==================
app.get('/api/vehicle-on-wheels', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const TEST_LINE_ZONES = ['TLWA', 'TLRT', 'TLADAS', 'TLTT', 'CPA'];
    const REPAIR_ZONES = ['REPASS', 'REPPS', 'REPWS', 'REPLK', 'REPSHORT', 'REPELEC', 'REPNOISE'];
    const ALL_ZONES = [...TEST_LINE_ZONES, ...REPAIR_ZONES];
    const placeholders = ALL_ZONES.map(() => '?').join(',');

    // ---------- 1. Зелёные цифры (для pie chart и карточки «Ремонт ОК») ----------
    const [greenRows] = await mesPool.query(`
      SELECT
        node_nature,
        COUNT(*) AS cnt,
        COUNT(DISTINCT vin) AS uniq
      FROM tm_vhc_test_line_movement
      WHERE node_nature IN (${placeholders})
        AND gmt_create >= ? AND gmt_create <= ?
        AND is_deleted = 0
      GROUP BY node_nature
    `, [...ALL_ZONES, startTime, endTime]);

    const greenCounts = {};
    const greenUnique = {};
    greenRows.forEach(r => {
      greenCounts[r.node_nature] = Number(r.cnt || 0);
      greenUnique[r.node_nature] = Number(r.uniq || 0);
    });

    const cpaCount = greenCounts['CPA'] || 0;
    const cpaUnique = greenUnique['CPA'] || 0;

    // ---------- 2. Таблица: CP72 → REP (ВСЕ, включая ушедших в CPA) ----------
    // Флаг went_to_cpa = 1, если VIN в этом же окне был в CPA.
    const [rows] = await mesPool.query(`
      SELECT
        cp.vin,
        z.zone,
        cp.model,
        cp.TIME_CP72,
        TIMESTAMPDIFF(SECOND, cp.TIME_CP72, NOW()) AS elapsed_cp72_sec,
        z.TIME_ZONE,
        TIMESTAMPDIFF(SECOND, z.TIME_ZONE, NOW()) AS elapsed_zone_sec,
        CASE WHEN cpa.vin IS NULL THEN 0 ELSE 1 END AS went_to_cpa
      FROM (
        SELECT
          tvv.vin,
          MIN(vm.scan_time) AS TIME_CP72,
          MAX(too.product) AS model
        FROM tm_vhc_vehicle_movement vm
        INNER JOIN tm_vhc_vehicle tvv ON vm.tm_vhc_vehicle_id = tvv.id
        LEFT JOIN tm_ofm_order too ON too.vin = tvv.vin
        WHERE vm.tm_bas_uloc_id = '1990320932460523522'
          AND vm.scan_time >= ? AND vm.scan_time <= ?
        GROUP BY tvv.vin
      ) AS cp
      INNER JOIN (
        SELECT tvtlm.node_nature AS zone, tvtlm.vin, tvtlm.gmt_create AS TIME_ZONE
        FROM tm_vhc_test_line_movement tvtlm
        WHERE tvtlm.node_nature IN ('REPASS','REPPS','REPWS','REPLK','REPSHORT','REPELEC','REPNOISE')
          AND tvtlm.is_deleted = 0
          AND tvtlm.gmt_create >= ? AND tvtlm.gmt_create <= ?
      ) AS z ON cp.vin = z.vin
      LEFT JOIN (
        SELECT DISTINCT vin FROM tm_vhc_test_line_movement
        WHERE node_nature = 'CPA'
          AND gmt_create >= ? AND gmt_create <= ?
          AND is_deleted = 0
      ) AS cpa ON cpa.vin = cp.vin
      ORDER BY z.zone, cp.vin
    `, [startTime, endTime, startTime, endTime, startTime, endTime]);

    // ---------- 3. Считаем показатели ----------
    // Тёмная карточка «CP72 → Ремзона» — ВСЕ, кто прошёл CP72 и попал в REP
    const allVinsSet = new Set(rows.map(r => r.vin));
    const uniqueVins = allVinsSet.size;

    // Красная карточка «Записей в ремзону» — те, кто ещё НЕ ушёл в CPA
    const stillInRepairVins = new Set(
      rows.filter(r => Number(r.went_to_cpa) === 0).map(r => r.vin)
    );
    const repairTotal = stillInRepairVins.size;
    const repairUnique = stillInRepairVins.size;

    // ---------- 4. Ответ ----------
    res.json({
      rows: rows.map(r => ({
        vin: r.vin,
        zone: r.zone,
        model: r.model || '—',
        time_cp72: r.TIME_CP72,
        elapsed_cp72_sec: r.elapsed_cp72_sec,
        time_zone: r.TIME_ZONE,
        elapsed_zone_sec: r.elapsed_zone_sec,
        went_to_cpa: Number(r.went_to_cpa) === 1,
      })),

      // Тёмная карточка: ВСЕ CP72 → REP
      uniqueVins,

      // Карточка «Ремонт ОК» + pie chart
      cpaCount,
      cpaUnique,

      // Красная карточка: CP72 → REP, ещё не ушли в CPA
      repairTotal,
      repairUnique,

      greenCounts,
      greenUnique,
      cpaTarget: 160,
    });
  } catch (err) {
    console.error('Ошибка /api/vehicle-on-wheels:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// VIN в CPA (для карточки «Ремонт ОК»)
app.get('/api/vehicle-on-wheels/details/cpa', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) return res.status(400).json({ error: 'startTime и endTime обязательны' });

    const [rows] = await mesPool.query(`
      SELECT
        tvtlm.vin,
        tvtlm.node_nature AS zone,
        tvtlm.vhc_model AS model,
        tvtlm.gmt_create AS event_time,
        (
          SELECT MAX(t2.gmt_create)
          FROM tm_vhc_test_line_movement t2
          WHERE t2.vin = tvtlm.vin
            AND t2.node_nature IN ('REPASS','REPPS','REPWS','REPLK','REPSHORT','REPELEC','REPNOISE')
            AND t2.is_deleted = 0
            AND t2.gmt_create <= tvtlm.gmt_create
        ) AS rep_enter_time
      FROM tm_vhc_test_line_movement tvtlm
      WHERE tvtlm.node_nature = 'CPA'
        AND tvtlm.gmt_create >= ? AND tvtlm.gmt_create <= ?
        AND tvtlm.is_deleted = 0
      ORDER BY tvtlm.gmt_create
    `, [startTime, endTime]);

    res.json({
      rows: rows.map(r => ({
        vin: r.vin,
        model: r.model || '—',
        zone: r.zone || 'CPA',
        event_time: r.event_time,
        zone_enter_time: r.rep_enter_time,   // ← новое поле: время входа в ремзону
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// VIN в REP (для карточки «Записей в ремзону»)
app.get('/api/vehicle-on-wheels/details/rep', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) return res.status(400).json({ error: 'startTime и endTime обязательны' });

    const [rows] = await mesPool.query(`
      SELECT
        tvtlm.vin,
        tvtlm.node_nature AS zone,
        tvtlm.vhc_model AS model,
        tvtlm.gmt_create AS event_time
      FROM tm_vhc_test_line_movement tvtlm
      WHERE tvtlm.node_nature IN ('REPASS','REPPS','REPWS','REPLK','REPSHORT','REPELEC','REPNOISE')
        AND tvtlm.gmt_create >= ? AND tvtlm.gmt_create <= ?
        AND tvtlm.is_deleted = 0
        AND tvtlm.vin IN (
          SELECT tvv.vin
          FROM tm_vhc_vehicle_movement vm
          INNER JOIN tm_vhc_vehicle tvv ON vm.tm_vhc_vehicle_id = tvv.id
          WHERE vm.tm_bas_uloc_id = '1990320932460523522'
            AND vm.scan_time >= ? AND vm.scan_time <= ?
        )
        AND tvtlm.vin NOT IN (
          SELECT DISTINCT vin FROM tm_vhc_test_line_movement
          WHERE node_nature = 'CPA'
            AND gmt_create >= ? AND gmt_create <= ?
            AND is_deleted = 0
        )
      ORDER BY tvtlm.gmt_create
    `, [startTime, endTime, startTime, endTime, startTime, endTime]);

    res.json({
      rows: rows.map(r => ({
        vin: r.vin,
        model: r.model || '—',
        zone: r.zone,
        event_time: r.event_time,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
