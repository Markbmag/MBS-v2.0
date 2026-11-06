// DRR CP6 — снимки смен (фоновое сохранение и маршруты).
// Код перенесён из server.js без изменений.

const { app } = require('../../app');
const { mesPool, notesPool, pool } = require('../../db');
const { CP6_BUFFER_ENTER, CP6_DEFECT_CLOSED_STATUSES, CP6_PSIN_ULOC, classifyCp6DefectCategory, classifyCp6VinsExtended, getCp6ActiveAtPaint, getCp6PsinVins, getCp6PsoutVins, getCp6TransitVins } = require('./cp6');

/* ====================================================================== */
/* ================== DRR CP6 — СНИМКИ СМЕН ============================= */
/* ====================================================================== */

function getWeekNumberForDateCp6(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}

function getShiftLetterForSnapshotCp6(shift, weekNumber) {
  if (shift === 'night') return 'C';
  if (shift === 'all') return 'ALL';
  const isEven = weekNumber % 2 === 0;
  if (shift === 'day') return isEven ? 'B' : 'A';
  if (shift === 'evening') return isEven ? 'A' : 'B';
  return null;
}

function getLastCompletedShiftCp6() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const todayStr = fmt(now);
  const yest = new Date(now);
  yest.setUTCDate(yest.getUTCDate() - 1);
  const yesterdayStr = fmt(yest);

  if (mins < 91) return { shiftDate: yesterdayStr, shift: 'day' };
  if (mins < 470) return { shiftDate: yesterdayStr, shift: 'evening' };
  if (mins < 1001) return { shiftDate: todayStr, shift: 'night' };
  return { shiftDate: todayStr, shift: 'day' };
}

function getCompletedDayDateCp6() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  if (mins >= 1439) return fmt(now);
  const yest = new Date(now);
  yest.setUTCDate(yest.getUTCDate() - 1);
  return fmt(yest);
}

function getShiftRangeCp6(shiftDate, shift) {
  if (shift === 'all')     return { start: `${shiftDate} 00:00:00`, end: `${shiftDate} 23:59:59` };
  if (shift === 'day')     return { start: `${shiftDate} 07:50:00`, end: `${shiftDate} 16:40:00` };
  if (shift === 'night')   return { start: `${shiftDate} 01:31:00`, end: `${shiftDate} 07:50:00` };
  if (shift === 'evening') {
    const next = new Date(`${shiftDate}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    return { start: `${shiftDate} 16:41:00`, end: `${nextStr} 01:30:00` };
  }
  return null;
}

/* Копия логики эндпоинтов в виде функций — нужна для сохранения снимка */
async function computeCp6Dashboard(startTime, endTime) {
  const [{ vins: psoutRows, totalRecords }, psinRows, activeRows, transitRows] = await Promise.all([
    getCp6PsoutVins(startTime, endTime),
    getCp6PsinVins(startTime, endTime),
    getCp6ActiveAtPaint(),
    getCp6TransitVins(),
  ]);

  const totalVins = psoutRows.length;
  const activeAtPaint = activeRows.length;
  const transitCount = transitRows.length;
  const psinVins = psinRows.length;

  if (totalVins === 0 && psinVins === 0) {
    return {
      totalRecords, totalVins: 0, okVins: 0, nokVins: 0,
      drrPercent: 0, spotVins: 0, repaintVins: 0, otherVins: 0,
      activeAtPaint, transitCount, psinVins: 0,
    };
  }

  const { okSet, nokSet, spotSet, repaintSet, otherSet } =
    await classifyCp6VinsExtended(psoutRows, psinRows);

  const okVins = okSet.size;
  const nokVins = nokSet.size;
  const drrPercent = totalVins > 0 ? (okVins / totalVins) * 100 : 0;

  return {
    totalRecords, totalVins, okVins, nokVins,
    drrPercent: Math.round(drrPercent * 10) / 10,
    spotVins: spotSet.size,
    repaintVins: repaintSet.size,
    otherVins: otherSet.size,
    activeAtPaint, transitCount, psinVins,
  };
}

async function computeCp6SpotRepaintRows(startTime, endTime, category) {
  const [{ vins: psoutRows }, psinRows] = await Promise.all([
    getCp6PsoutVins(startTime, endTime),
    getCp6PsinVins(startTime, endTime),
  ]);
  if (psinRows.length === 0) return [];

  const { spotDefectVins, repaintDefectVins } = await classifyCp6VinsExtended(psoutRows, psinRows);
  const targetSet = category === 'spot' ? spotDefectVins : repaintDefectVins;
  const targetVins = [...targetSet];
  if (targetVins.length === 0) return [];

  const ph = targetVins.map(() => '?').join(',');

  const [psinHistoryRows] = await mesPool.query(`
    SELECT vin, uloc_no, MAX(scan_time) AS last_time
    FROM ti_mes_movement
    WHERE vin IN (${ph})
      AND uloc_no IN (?, ?)
      AND is_deleted = 0
    GROUP BY vin, uloc_no
  `, [...targetVins, CP6_PSIN_ULOC, CP6_BUFFER_ENTER]);

  const psinTimeByVin = new Map();
  const pbsinTimeByVin = new Map();
  psinHistoryRows.forEach(r => {
    if (r.uloc_no === CP6_PSIN_ULOC) psinTimeByVin.set(r.vin, r.last_time);
    else if (r.uloc_no === CP6_BUFFER_ENTER) pbsinTimeByVin.set(r.vin, r.last_time);
  });
  targetVins.forEach(v => {
    if (!psinTimeByVin.has(v) && pbsinTimeByVin.has(v)) {
      psinTimeByVin.set(v, pbsinTimeByVin.get(v));
    }
  });

  const [defectRows] = await pool.query(`
    SELECT d.VIN, wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE, d.STATUS,
           d.REPAIR_MEASURE, d.REPAIR_MEASURE1
    FROM at_paint_qm_defect_info d
    LEFT JOIN work_order wo ON wo.VIN = d.VIN
    WHERE d.VIN IN (${ph})
  `, targetVins);

  const nowMs = Date.now();
  const rows = [];
  defectRows.forEach(d => {
    const status = (d.STATUS || '').toUpperCase();
    if (CP6_DEFECT_CLOSED_STATUSES.has(status)) return;
    const cat = classifyCp6DefectCategory(d);
    if (cat !== category) return;

    const psinTime = psinTimeByVin.get(d.VIN) || null;
    const durationSec = psinTime
      ? Math.max(0, Math.floor((nowMs - new Date(psinTime).getTime()) / 1000))
      : null;
    const mpp = `${d.MODEL || '—'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`
      .replace(/\s+/g, ' ').trim();

    rows.push({
      vin: d.VIN,
      model: d.MODEL || '—',
      mpp,
      part_name: d.PART_NAME || '',
      problem_type: d.PROBLEM_TYPE || '',
      grade: d.PROBLEM_GRADE || '—',
      status: d.STATUS || '—',
      psin_time: psinTime,
      duration_sec: durationSec,
    });
  });

  rows.sort((a, b) => (b.duration_sec || 0) - (a.duration_sec || 0));
  return rows;
}

async function saveDrrCp6Snapshot(shiftDate, shift) {
  try {
    const range = getShiftRangeCp6(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDateCp6(shiftDate);
    const shiftLetter = getShiftLetterForSnapshotCp6(shift, weekNumber);

    const [dash, spotRows, repaintRows] = await Promise.all([
      computeCp6Dashboard(range.start, range.end),
      computeCp6SpotRepaintRows(range.start, range.end, 'spot'),
      computeCp6SpotRepaintRows(range.start, range.end, 'repaint'),
    ]);

    // === РАСЧЕТ TOP DEFECTS ДЛЯ СОХРАНЕНИЯ ===
    let topDefects = [];
    if (dash.nokVins > 0) {
      const [{ vins: psoutRows }, psinRows] = await Promise.all([
        getCp6PsoutVins(range.start, range.end),
        getCp6PsinVins(range.start, range.end),
      ]);
      const { nokSet } = await classifyCp6VinsExtended(psoutRows, psinRows);
      const nokVins = [...nokSet];

      if (nokVins.length > 0) {
        const ph = nokVins.map(() => '?').join(',');
        const [defectRows] = await pool.query(`
          SELECT d.VIN, wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE, d.STATUS
          FROM at_paint_qm_defect_info d
          LEFT JOIN work_order wo ON wo.VIN = d.VIN
          WHERE d.VIN IN (${ph})
        `, nokVins);

        const map = new Map();
        defectRows.forEach(d => {
          const status = (d.STATUS || '').toUpperCase();
          if (CP6_DEFECT_CLOSED_STATUSES.has(status)) return;

          const mpp = `${d.MODEL || '—'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`
            .replace(/\s+/g, ' ').trim();
          const grade = d.PROBLEM_GRADE || '—';
          const key = `${mpp}|${grade}`;
          if (!map.has(key)) map.set(key, { mpp, grade, defectCount: 0 });
          map.get(key).defectCount += 1;
        });
        topDefects = [...map.values()].sort((a, b) => b.defectCount - a.defectCount);
      }
    }
    // =========================================

    await notesPool.query(`
      INSERT INTO drr_cp6_snapshots
        (shift_date, week_number, shift, shift_letter,
         total_records, total_vins, ok_vins, nok_vins, drr_percent,
         spot_vins, repaint_vins, other_vins,
         active_at_paint, transit_count, psin_vins,
         spot_rows, repaint_rows, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_records = VALUES(total_records),
        total_vins = VALUES(total_vins),
        ok_vins = VALUES(ok_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        spot_vins = VALUES(spot_vins),
        repaint_vins = VALUES(repaint_vins),
        other_vins = VALUES(other_vins),
        active_at_paint = VALUES(active_at_paint),
        transit_count = VALUES(transit_count),
        psin_vins = VALUES(psin_vins),
        spot_rows = VALUES(spot_rows),
        repaint_rows = VALUES(repaint_rows),
        top_defects = VALUES(top_defects)
    `, [
      shiftDate, weekNumber, shift, shiftLetter,
      dash.totalRecords, dash.totalVins, dash.okVins, dash.nokVins, dash.drrPercent,
      dash.spotVins, dash.repaintVins, dash.otherVins,
      dash.activeAtPaint, dash.transitCount, dash.psinVins,
      JSON.stringify(spotRows), JSON.stringify(repaintRows), JSON.stringify(topDefects),
    ]);

    console.log(`[DRR CP6 snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) → ${dash.drrPercent}% (${dash.okVins}/${dash.totalVins})`);
  } catch (err) {
    console.error('[DRR CP6 snapshot] ошибка сохранения:', err.message);
  }
}

async function checkAndSaveDrrCp6Snapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShiftCp6();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_cp6_snapshots WHERE shift_date = ? AND shift = ?`,
      [shiftDate, shift]
    );
    if (Number(existing[0]?.cnt || 0) < 1) {
      await saveDrrCp6Snapshot(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR CP6 snapshot] ошибка проверки смены:', err.message);
  }
}

async function checkAndSaveDrrCp6DailySnapshot() {
  try {
    const dayDate = getCompletedDayDateCp6();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_cp6_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (Number(existing[0]?.cnt || 0) < 1) {
      await saveDrrCp6Snapshot(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR CP6 snapshot] ошибка проверки суток:', err.message);
  }
}

setInterval(() => {
  checkAndSaveDrrCp6Snapshot();
  checkAndSaveDrrCp6DailySnapshot();
}, 60 * 1000);
checkAndSaveDrrCp6Snapshot();
checkAndSaveDrrCp6DailySnapshot();

function enrichCp6Snapshot(r) {
  const shiftDate = String(r.shift_date).slice(0, 10);
  const weekNumber = r.week_number != null ? r.week_number : getWeekNumberForDateCp6(shiftDate);
  const shiftLetter = r.shift_letter != null ? r.shift_letter : getShiftLetterForSnapshotCp6(r.shift, weekNumber);
  return {
    id: r.id,
    shiftDate, weekNumber,
    shift: r.shift,
    shiftLetter,
    snapshotTime: r.snapshot_time,
    totalRecords: r.total_records,
    totalVins: r.total_vins,
    okVins: r.ok_vins,
    nokVins: r.nok_vins,
    drrPercent: Number(r.drr_percent),
    spotVins: r.spot_vins,
    repaintVins: r.repaint_vins,
    otherVins: r.other_vins,
    activeAtPaint: r.active_at_paint,
    transitCount: r.transit_count,
    psinVins: r.psin_vins,
  };
}

app.get('/api/drr-cp6-snapshots', async (req, res) => {
  try {
    const { days = 14 } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);
    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, snapshot_time,
             total_records, total_vins, ok_vins, nok_vins, drr_percent,
             spot_vins, repaint_vins, other_vins,
             active_at_paint, transit_count, psin_vins
      FROM drr_cp6_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY shift_date DESC,
        FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays]);
    res.json(rows.map(enrichCp6Snapshot));
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-cp6-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query('SELECT * FROM drr_cp6_snapshots WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Снимок не найден' });

    const r = rows[0];
    let spotRows = [], repaintRows = [], topDefects = [];
    
    try {
      spotRows = r.spot_rows ? (typeof r.spot_rows === 'string' ? JSON.parse(r.spot_rows) : r.spot_rows) : [];
    } catch { spotRows = []; }
    
    try {
      repaintRows = r.repaint_rows ? (typeof r.repaint_rows === 'string' ? JSON.parse(r.repaint_rows) : r.repaint_rows) : [];
    } catch { repaintRows = []; }

    try {
      topDefects = r.top_defects ? (typeof r.top_defects === 'string' ? JSON.parse(r.top_defects) : r.top_defects) : [];
    } catch { topDefects = []; }

    res.json({
      ...enrichCp6Snapshot(r),
      spotRows,
      repaintRows,
      topDefects, // Отдаем сохраненные данные
    });
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});
