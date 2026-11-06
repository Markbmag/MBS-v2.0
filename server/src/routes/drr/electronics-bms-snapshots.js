// DRR электроники (BMS) — снимки смен (фоновое сохранение и маршруты).
// Код перенесён из server.js без изменений.

const { getCompletedDayDate, getLastCompletedShiftCp7, getShiftLetterForSnapshot, getShiftRangeCp7 } = require('../../lib/shifts');
const { getWeekNumberForDate } = require('../../lib/shared');
const { app } = require('../../app');
const { bmsPool, mesPool, notesPool } = require('../../db');

/* ====================================================================== */
/* ============== DRR ELECTRONICS — СНИМКИ СМЕН ========================= */
/* ====================================================================== */

// Хелпер: расчет DRR для снимка
async function calculateElectronicsDrr(startTime, endTime) {
  const [cp72Rows] = await mesPool.query(`
    SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
    FROM ti_mes_movement
    WHERE uloc_no = 'CP72' AND is_deleted = 0 AND scan_time >= ? AND scan_time <= ?
    GROUP BY vin
  `, [startTime, endTime]);

  const totalVins = cp72Rows.length;
  const cp72Map = new Map(cp72Rows.map(r => [r.VIN, r.CP72_TIME]));

  if (totalVins === 0) {
    return { totalVins: 0, closedVins: 0, nokVins: 0, drrPercent: 0 };
  }

  const vins = cp72Rows.map(r => r.VIN);
  const ph = vins.map(() => '?').join(',');

  const [bmsOkRows] = await bmsPool.query(`
    SELECT UPPER(vin) AS VIN, MAX(test_time) AS MAX_OK_TIME
    FROM qr_test_result
    WHERE result = 'OK' AND test_station IN ('CP7', 'Flash', 'ERA Write Vin') AND vin IN (${ph})
    GROUP BY vin
    HAVING COUNT(DISTINCT test_station) = 3
  `, vins);

  const okSet = new Set();
  bmsOkRows.forEach(row => {
    const cp72TimeStr = cp72Map.get(row.VIN);
    if (!cp72TimeStr) return;
    const cp72Ms = new Date(cp72TimeStr).getTime();
    const okMs = new Date(row.MAX_OK_TIME).getTime();
    if (cp72Ms + 5 * 60 * 1000 > okMs) {
      okSet.add(row.VIN);
    }
  });

  const closedVins = okSet.size;
  const nokVins = totalVins - closedVins;
  const drrPercent = totalVins > 0 ? Math.round((closedVins / totalVins) * 1000) / 10 : 0;

  return { totalVins, closedVins, nokVins, drrPercent };
}

// Хелпер: расчет топа дефектов для снимка
async function calculateElectronicsTopDefects(startTime, endTime, nokVins) {
  if (nokVins.length === 0) return [];
  
  const nokPh = nokVins.map(() => '?').join(',');
  const [rows] = await bmsPool.query(`
    SELECT 
      test_station, 
      module_name, 
      COUNT(DISTINCT vin) AS defectCount
    FROM qr_test_details
    WHERE test_time >= ? AND test_time <= ?
      AND vin IN (${nokPh})
      AND result != 'OK'
      AND test_station NOT LIKE 'R%' 
      AND test_station NOT LIKE 'CP8%'
    GROUP BY test_station, module_name
    ORDER BY defectCount DESC
    LIMIT 50
  `, [startTime, endTime, ...nokVins]);

  return rows;
}

// Функция сохранения снимка
async function saveDrrElectronicsSnapshot(shiftDate, shift) {
  try {
    // Используем функцию getShiftRangeCp7, так как логика смен идентична
    const range = getShiftRangeCp7(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDate(shiftDate);
    const shiftLetter = getShiftLetterForSnapshot(shift, weekNumber);

    // 1. Считаем DRR
    const dash = await calculateElectronicsDrr(range.start, range.end);
    
    // 2. Получаем список NOK VIN для топа дефектов
    let nokVins = [];
    if (dash.totalVins > 0) {
      const [cp72Rows] = await mesPool.query(`
        SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
        FROM ti_mes_movement WHERE uloc_no = 'CP72' AND is_deleted = 0 AND scan_time >= ? AND scan_time <= ? GROUP BY vin
      `, [range.start, range.end]);
      const cp72Map = new Map(cp72Rows.map(r => [r.VIN, r.CP72_TIME]));
      const vins = cp72Rows.map(r => r.VIN);
      const ph = vins.map(() => '?').join(',');
      
      const [bmsOkRows] = await bmsPool.query(`
        SELECT UPPER(vin) AS VIN, MAX(test_time) AS MAX_OK_TIME
        FROM qr_test_result WHERE result = 'OK' AND test_station IN ('CP7', 'Flash', 'ERA Write Vin') AND vin IN (${ph}) GROUP BY vin HAVING COUNT(DISTINCT test_station) = 3
      `, vins);

      const okSet = new Set();
      bmsOkRows.forEach(row => {
        const cp72Ms = new Date(cp72Map.get(row.VIN)).getTime();
        if (cp72Ms + 5 * 60 * 1000 > new Date(row.MAX_OK_TIME).getTime()) okSet.add(row.VIN);
      });
      nokVins = vins.filter(v => !okSet.has(v));
    }

    // 3. Считаем топ дефектов
    const topDefects = await calculateElectronicsTopDefects(range.start, range.end, nokVins);

    // 4. Сохраняем
    await notesPool.query(`
      INSERT INTO drr_electronics_snapshots
        (shift_date, week_number, shift, shift_letter, total_vins, closed_vins, nok_vins, drr_percent, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_vins = VALUES(total_vins),
        closed_vins = VALUES(closed_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        top_defects = VALUES(top_defects)
    `, [shiftDate, weekNumber, shift, shiftLetter, dash.totalVins, dash.closedVins, dash.nokVins, dash.drrPercent, JSON.stringify(topDefects)]);

    console.log(`[DRR Electronics snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) → ${dash.drrPercent}%`);
  } catch (err) {
    console.error('[DRR Electronics snapshot] ошибка сохранения:', err.message);
  }
}

// Проверка и сохранение
async function checkAndSaveDrrElectronicsSnapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShiftCp7();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_electronics_snapshots WHERE shift_date = ? AND shift = ?`,
      [shiftDate, shift]
    );
    if (Number(existing[0]?.cnt || 0) < 1) {
      await saveDrrElectronicsSnapshot(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR Electronics snapshot] ошибка проверки смены:', err.message);
  }
}

async function checkAndSaveDrrElectronicsDailySnapshot() {
  try {
    const dayDate = getCompletedDayDate();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_electronics_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (Number(existing[0]?.cnt || 0) < 1) {
      await saveDrrElectronicsSnapshot(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR Electronics snapshot] ошибка проверки суток:', err.message);
  }
}

setInterval(() => {
  checkAndSaveDrrElectronicsSnapshot();
  checkAndSaveDrrElectronicsDailySnapshot();
}, 60 * 1000);
checkAndSaveDrrElectronicsSnapshot();
checkAndSaveDrrElectronicsDailySnapshot();

// Эндпоинты для получения снимков
app.get('/api/drr-electronics-snapshots', async (req, res) => {
  try {
    const { days = 14 } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);

    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, snapshot_time,
             total_vins, closed_vins, nok_vins, drr_percent
      FROM drr_electronics_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY shift_date DESC, FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays]);

    const result = rows.map(r => {
      const shiftDate = String(r.shift_date).slice(0, 10);
      const weekNumber = r.week_number != null ? r.week_number : getWeekNumberForDate(shiftDate);
      const shiftLetter = r.shift_letter != null ? r.shift_letter : getShiftLetterForSnapshot(r.shift, weekNumber);
      return {
        id: r.id,
        shiftDate,
        weekNumber,
        shift: r.shift,
        shiftLetter,
        snapshotTime: r.snapshot_time,
        totalVins: r.total_vins,
        closedVins: r.closed_vins,
        nokVins: r.nok_vins,
        drrPercent: Number(r.drr_percent),
      };
    });
    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-electronics-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-electronics-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query('SELECT * FROM drr_electronics_snapshots WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Снимок не найден' });

    const r = rows[0];
    let topDefects = [];
    try {
      topDefects = r.top_defects ? (typeof r.top_defects === 'string' ? JSON.parse(r.top_defects) : r.top_defects) : [];
    } catch { topDefects = []; }

    const shiftDate = String(r.shift_date).slice(0, 10);
    const weekNumber = r.week_number != null ? r.week_number : getWeekNumberForDate(shiftDate);
    const shiftLetter = r.shift_letter != null ? r.shift_letter : getShiftLetterForSnapshot(r.shift, weekNumber);

    res.json({
      id: r.id,
      shiftDate,
      weekNumber,
      shift: r.shift,
      shiftLetter,
      snapshotTime: r.snapshot_time,
      totalVins: r.total_vins,
      closedVins: r.closed_vins,
      nokVins: r.nok_vins,
      drrPercent: Number(r.drr_percent),
      topDefects
    });
  } catch (err) {
    console.error('Ошибка /api/drr-electronics-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});
