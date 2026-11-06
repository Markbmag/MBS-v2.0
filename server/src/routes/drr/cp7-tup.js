// Маршруты: DRR CP7 Touch Up (QC-TUP) — основные.
// Код перенесён из server.js без изменений.

const { app } = require('../../app');
const { pool } = require('../../db');
const { CP7_GRACE_MS, getCp72TimesMap, isDefectNokCp7 } = require('./cp7');

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
