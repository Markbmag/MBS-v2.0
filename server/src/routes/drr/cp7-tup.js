// DRR CP7 Touch Up (QC-TUP): маршруты и снимки смен.
// Код перенесён из server.js без изменений.

const { getWeekNumberForDate } = require('../../lib/shared');
const { app } = require('../../app');
const { notesPool, pool } = require('../../db');
const { CP7_GRACE_MS, getCp72TimesMap, isDefectNokCp7 } = require('./cp7');
const { CP7_SNAPSHOT_POST_LISTS, getCompletedDayDate, getLastCompletedShiftCp7, getShiftLetterForSnapshot, getShiftRangeCp7 } = require('./cp7-snapshots');

/* ====================================================================== */
/* ================== DRR CP7 — TOUCH UP (QC-TUP) ======================= */
/* ====================================================================== */

// 1. Дашборд (расчет OK/NOK только по дефектам QC-TUP)
app.get('/api/drr-cp7-tup-dashboard', async (req, res) => {
  try {
    const { filter = 'all', startTime, endTime } = req.query;

    let rangeStart, rangeEnd;
    if (startTime && endTime) {
      rangeStart = startTime;
      rangeEnd = endTime;
    } else {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      rangeStart = `${y}-${m}-${d} 00:00:00`;
      rangeEnd = `${y}-${m}-${d} 23:59:59`;
    }

    const postLists = {
      all: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
      cp7: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP9'],
      pip: ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9']
    };
    const postList = postLists[filter] || postLists.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(rangeStart, rangeEnd);

    const totalVins = cp72Rows.length;
    if (totalVins === 0) {
      return res.json({ totalVins: 0, closedVins: 0, drrPercent: 0 });
    }

    const vins = cp72Rows.map(r => r.VIN);
    const placeholders = vins.map(() => '?').join(',');

    // ВАЖНО: Берем ТОЛЬКО дефекты, созданные пользователем 'QC-TUP'
    const [defectRows] = await pool.query(`
      SELECT
        d.VIN, d.STATUS, d.CREATION_TIME,
        d.REPAIR_TIME, d.REPAIR_TIME1
      FROM at_qm_defect_info d
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${postListStr})
        AND d.CREATION_USER = 'QC-TUP'
    `, vins);

    const vinHasNok = new Map();

    defectRows.forEach(row => {
      const cp72TimeStr = cp72TimeMap.get(row.VIN);
      if (!cp72TimeStr) return;

      const cp72Ms = new Date(cp72TimeStr).getTime();
      const defectTimeMs = new Date(row.CREATION_TIME).getTime();
      if (defectTimeMs > cp72Ms + CP7_GRACE_MS) return;

      // Логика 20 минут (isDefectNokCp7)
      if (isDefectNokCp7(row, cp72Ms)) {
        vinHasNok.set(row.VIN, true);
      }
    });

    let closedVins = 0;
    cp72Rows.forEach(row => {
      if (!vinHasNok.get(row.VIN)) closedVins += 1;
    });

    const drrPercent = totalVins > 0 ? (closedVins / totalVins) * 100 : 0;

    res.json({
      totalVins,
      closedVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
    });
  } catch (err) {
    console.error('Ошибка DRR CP7 TUP Dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. Топ дефектов (ТОЛЬКО QC-TUP)
app.get('/api/drr-cp7-tup-top-defects', async (req, res) => {
  try {
    const { filter = 'all', startTime, endTime } = req.query;

    let rangeStart, rangeEnd;
    if (startTime && endTime) {
      rangeStart = startTime;
      rangeEnd = endTime;
    } else {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      rangeStart = `${y}-${m}-${d} 00:00:00`;
      rangeEnd = `${y}-${m}-${d} 23:59:59`;
    }

    const postLists = {
      all: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
      cp7: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP9'],
      pip: ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9']
    };
    const postList = postLists[filter] || postLists.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(rangeStart, rangeEnd);
    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.VIN);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE,
        d.STATUS,
        d.CREATION_TIME,
        d.REPAIR_TIME,
        d.REPAIR_TIME1
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr})
        AND d.VIN IN (${placeholders})
        AND d.CREATION_USER = 'QC-TUP'
    `, [...vins]);

    const nokDefects = [];
    defectRows.forEach(row => {
      const cp72TimeStr = cp72TimeMap.get(row.VIN);
      if (!cp72TimeStr) return;
      const cp72Ms = new Date(cp72TimeStr).getTime();
      const defectTimeMs = new Date(row.CREATION_TIME).getTime();
      if (defectTimeMs > cp72Ms + CP7_GRACE_MS) return;

      if (isDefectNokCp7(row, cp72Ms)) {
        nokDefects.push(row);
      }
    });

    const defectGroupMap = new Map();
    nokDefects.forEach(row => {
      const mpp = `${row.MODEL || '-'} ${row.PART_NAME || ''} ${row.PROBLEM_TYPE || ''}`.trim();
      if (!defectGroupMap.has(mpp)) {
        defectGroupMap.set(mpp, {
          mpp,
          model: row.MODEL || '',
          part_name: row.PART_NAME || '',
          problem_type: row.PROBLEM_TYPE || '',
          grade: row.PROBLEM_GRADE || '-',
          defectCount: 0,
        });
      }
      defectGroupMap.get(mpp).defectCount += 1;
    });

    const topDefects = Array.from(defectGroupMap.values())
      .map(d => ({
        mpp: d.mpp,
        model: d.model,
        part_name: d.part_name,
        problem_type: d.problem_type,
        grade: d.grade,
        defectCount: d.defectCount,
      }))
      .sort((a, b) => b.defectCount - a.defectCount);

    res.json(topDefects);
  } catch (err) {
    console.error('Ошибка DRR CP7 TUP Top Defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. Список VIN по OK/NOK (копия логики DRR CP7)
app.get('/api/drr-cp7-tup-vins', async (req, res) => {
  try {
    const { filter = 'all', startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    const postLists = {
      all: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
      cp7: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP9'],
      pip: ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9']
    };
    const postList = postLists[filter] || postLists.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(startTime, endTime);
    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.VIN);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT d.VIN, d.STATUS, d.CREATION_TIME,
             d.REPAIR_TIME, d.REPAIR_TIME1
      FROM at_qm_defect_info d
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${postListStr})
        AND d.CREATION_USER = 'QC-TUP'
    `, vins);

    const nokSet = new Set();

    defectRows.forEach(row => {
      const cp72TimeStr = cp72TimeMap.get(row.VIN);
      if (!cp72TimeStr) return;
      const cp72Ms = new Date(cp72TimeStr).getTime();
      const defectTimeMs = new Date(row.CREATION_TIME).getTime();
      if (defectTimeMs > cp72Ms + CP7_GRACE_MS) return;

      if (isDefectNokCp7(row, cp72Ms)) nokSet.add(row.VIN);
    });

    const [modelRows] = await pool.query(`
      SELECT VIN, MODEL FROM work_order WHERE VIN IN (${placeholders})
    `, vins);
    const modelMap = new Map(modelRows.map(r => [r.VIN, r.MODEL]));

    const result = cp72Rows
      .filter(row => {
        const isNok = nokSet.has(row.VIN);
        if (status === 'NOK') return isNok;
        if (status === 'OK') return !isNok;
        return false;
      })
      .map(row => ({
        vin: row.VIN,
        model: modelMap.get(row.VIN) || '-',
        cp72_time: row.CP72_TIME,
      }))
      .sort((a, b) => new Date(a.cp72_time) - new Date(b.cp72_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-cp7-tup-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// 4. VIN'ы по конкретному MPP (ТОЛЬКО ТЕ ДЕФЕКТЫ QC-TUP, ИЗ-ЗА КОТОРЫХ МАШИНА СТАЛА NOK)
app.get('/api/drr-cp7-tup-mpp-vins', async (req, res) => {
  try {
    const { filter = 'all', startTime, endTime, model, part_name, problem_type } = req.query;

    if (!startTime || !endTime || !model || !part_name || !problem_type) {
      return res.status(400).json({ error: 'startTime, endTime, model, part_name, problem_type обязательны' });
    }

    const postLists = {
      all: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
      cp7: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP9'],
      pip: ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9']
    };
    const postList = postLists[filter] || postLists.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(startTime, endTime);
    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.VIN);
    const placeholders = vins.map(() => '?').join(',');

    // Вернули фильтр d.CREATION_USER = 'QC-TUP' и убрали is_tup
    const [defectRows] = await pool.query(`
      SELECT
        d.VIN, wo.MODEL,
        d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE,
        d.STATUS, d.CREATION_TIME,
        d.REPAIR_TIME, d.REPAIR_TIME1,
        d.POST_NAME AS post_name,
        d.REPAIR_POST_NAME AS repair_post_name,
        d.CREATION_USER
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr})
        AND d.VIN IN (${placeholders})
        AND wo.MODEL = ?
        AND d.PART_NAME = ?
        AND d.PROBLEM_TYPE = ?
        AND d.CREATION_USER = 'QC-TUP'
    `, [...vins, model, part_name, problem_type]);

    const resultList = [];

    defectRows.forEach(row => {
      const cp72TimeStr = cp72TimeMap.get(row.VIN);
      if (!cp72TimeStr) return;
      
      const cp72Ms = new Date(cp72TimeStr).getTime();
      
      // ДОБАВЛЕНО: проверяем, что дефект реально NOK (не закрыт вовремя)
      if (!isDefectNokCp7(row, cp72Ms)) return;

      const repairTimes = [row.REPAIR_TIME, row.REPAIR_TIME1]
        .filter(t => t != null && t !== '')
        .map(t => new Date(t).getTime())
        .filter(t => !Number.isNaN(t));
      const repairMs = repairTimes.length > 0 ? Math.min(...repairTimes) : null;

      resultList.push({
        vin: row.VIN,
        model: row.MODEL || '—',
        grade: row.PROBLEM_GRADE || '—',
        status: row.STATUS || '',
        defect_time: row.CREATION_TIME,
        repair_time: repairMs ? new Date(repairMs).toISOString() : null,
        cp72_time: cp72TimeMap.get(row.VIN),
        post_name: row.post_name || '—',
        repair_post_name: row.repair_post_name || '—',
        creation_user: row.CREATION_USER || '—'
      });
    });

    resultList.sort((a, b) => new Date(a.cp72_time) - new Date(b.cp72_time));

    res.json(resultList);
  } catch (err) {
    console.error('Ошибка /api/drr-cp7-tup-mpp-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ================== DRR CP7 TUP — СНИМКИ СМЕН ========================= */
/* ====================================================================== */

// Используем хелперы, которые уже есть в коде (getShiftRangeCp7, getWeekNumberForDate и т.д.)

async function saveDrrCp7TupSnapshot(shiftDate, shift, filterName) {
  try {
    const range = getShiftRangeCp7(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDate(shiftDate);
    const shiftLetter = getShiftLetterForSnapshot(shift, weekNumber);

    const postList = CP7_SNAPSHOT_POST_LISTS[filterName] || CP7_SNAPSHOT_POST_LISTS.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(range.start, range.end);

    const totalVins = cp72Rows.length;
    let closedVins = 0;
    let nokVins = 0;
    let drrPercent = 0;
    let topDefects = [];

    if (totalVins > 0) {
      const vins = cp72Rows.map(r => r.VIN);
      const ph = vins.map(() => '?').join(',');

      // Только дефекты QC-TUP
      const [defectRows] = await pool.query(`
        SELECT
          d.VIN, d.STATUS, d.CREATION_TIME,
          d.REPAIR_TIME, d.REPAIR_TIME1,
          wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE
        FROM at_qm_defect_info d
        LEFT JOIN work_order wo ON wo.VIN = d.VIN
        WHERE d.VIN IN (${ph})
          AND d.POST_NAME IN (${postListStr})
          AND d.CREATION_USER = 'QC-TUP'
      `, vins);

      const vinHasNok = new Map();
      const defectGroupMap = new Map();

      defectRows.forEach(d => {
        const cp72TimeStr = cp72TimeMap.get(d.VIN);
        if (!cp72TimeStr) return;
        const cp72Ms = new Date(cp72TimeStr).getTime();
        const defectMs = new Date(d.CREATION_TIME).getTime();
        if (defectMs > cp72Ms + CP7_GRACE_MS) return;

        if (isDefectNokCp7(d, cp72Ms)) {
          vinHasNok.set(d.VIN, true);

          const mpp = `${d.MODEL || '-'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`.trim();
          const key = `${mpp}|${d.PROBLEM_GRADE || '-'}`;
          if (!defectGroupMap.has(key)) {
            defectGroupMap.set(key, {
              mpp,
              model: d.MODEL || '',
              part_name: d.PART_NAME || '',
              problem_type: d.PROBLEM_TYPE || '',
              grade: d.PROBLEM_GRADE || '-',
              defectCount: 0,
            });
          }
          defectGroupMap.get(key).defectCount += 1;
        }
      });

      let okCount = 0;
      cp72Rows.forEach(r => {
        if (!vinHasNok.get(r.VIN)) okCount++;
      });
      closedVins = okCount;
      nokVins = totalVins - closedVins;
      drrPercent = totalVins > 0 ? Math.round((closedVins / totalVins) * 1000) / 10 : 0;

      topDefects = Array.from(defectGroupMap.values())
        .sort((a, b) => b.defectCount - a.defectCount);
    }

    await notesPool.query(`
      INSERT INTO drr_cp7_tup_snapshots
        (shift_date, week_number, shift, shift_letter, filter_name,
         total_vins, closed_vins, nok_vins, drr_percent, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_vins = VALUES(total_vins),
        closed_vins = VALUES(closed_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        top_defects = VALUES(top_defects)
    `, [shiftDate, weekNumber, shift, shiftLetter, filterName,
        totalVins, closedVins, nokVins, drrPercent, JSON.stringify(topDefects)]);

    console.log(`[DRR CP7 TUP snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) ${filterName} → ${drrPercent}% (${closedVins}/${totalVins})`);
  } catch (err) {
    console.error('[DRR CP7 TUP snapshot] ошибка сохранения:', err.message);
  }
}

async function saveAllDrrCp7TupSnapshots(shiftDate, shift) {
  await saveDrrCp7TupSnapshot(shiftDate, shift, 'all');
  await saveDrrCp7TupSnapshot(shiftDate, shift, 'cp7');
  await saveDrrCp7TupSnapshot(shiftDate, shift, 'pip');
}

async function checkAndSaveDrrCp7TupSnapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShiftCp7();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_cp7_tup_snapshots WHERE shift_date = ? AND shift = ?`,
      [shiftDate, shift]
    );
    if (Number(existing[0]?.cnt || 0) < 3) {
      await saveAllDrrCp7TupSnapshots(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR CP7 TUP snapshot] ошибка проверки смены:', err.message);
  }
}

async function checkAndSaveDrrCp7TupDailySnapshot() {
  try {
    const dayDate = getCompletedDayDate();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_cp7_tup_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (Number(existing[0]?.cnt || 0) < 3) {
      await saveAllDrrCp7TupSnapshots(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR CP7 TUP snapshot] ошибка проверки суток:', err.message);
  }
}

// Запускаем интервалы
setInterval(() => {
  checkAndSaveDrrCp7TupSnapshot();
  checkAndSaveDrrCp7TupDailySnapshot();
}, 60 * 1000);
checkAndSaveDrrCp7TupSnapshot();
checkAndSaveDrrCp7TupDailySnapshot();

function enrichCp7TupSnapshot(r) {
  const shiftDate = String(r.shift_date).slice(0, 10);
  const weekNumber = r.week_number != null
    ? r.week_number
    : getWeekNumberForDate(shiftDate);
  const shiftLetter = r.shift_letter != null
    ? r.shift_letter
    : getShiftLetterForSnapshot(r.shift, weekNumber);

  return {
    id: r.id,
    shiftDate,
    weekNumber,
    shift: r.shift,
    shiftLetter,
    filter: r.filter_name,
    snapshotTime: r.snapshot_time,
    totalVins: r.total_vins,
    closedVins: r.closed_vins,
    nokVins: r.nok_vins,
    drrPercent: Number(r.drr_percent),
  };
}

// 5. Получение списка снимков
app.get('/api/drr-cp7-tup-snapshots', async (req, res) => {
  try {
    const { days = 14, filter = 'all' } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);

    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, filter_name, snapshot_time,
             total_vins, closed_vins, nok_vins, drr_percent
      FROM drr_cp7_tup_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND filter_name = ?
      ORDER BY shift_date DESC,
        FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays, filter]);

    res.json(rows.map(enrichCp7TupSnapshot));
  } catch (err) {
    console.error('Ошибка /api/drr-cp7-tup-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 6. Получение конкретного снимка
app.get('/api/drr-cp7-tup-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query(
      'SELECT * FROM drr_cp7_tup_snapshots WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Снимок не найден' });

    const r = rows[0];
    let topDefects = [];
    try {
      topDefects = r.top_defects
        ? (typeof r.top_defects === 'string' ? JSON.parse(r.top_defects) : r.top_defects)
        : [];
    } catch { topDefects = []; }

    res.json({
      ...enrichCp7TupSnapshot(r),
      topDefects,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-cp7-tup-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});
