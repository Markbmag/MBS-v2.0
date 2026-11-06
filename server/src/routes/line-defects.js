// Фиксация дефектов на линии: фото, очистка, маршруты.
// Код перенесён из server.js без изменений.

const express = require('express');
const path = require('path');
const fs = require('fs');
const { SERVER_DIR } = require('../paths');
const { app } = require('../app');
const { IMPORT_PASSWORD } = require('../config/passwords');
const { notesPool, pool } = require('../db');

// ============================================================
// ================== LINE DEFECTS CAPTURE ====================
// ============================================================

const LINE_DEFECTS_DIR              = path.join(SERVER_DIR, 'uploads', 'line-defects');
const LINE_DEFECTS_PHOTO_TTL_DAYS   = 270;   // 9 месяцев — удаление файла
const LINE_DEFECTS_ORPHAN_TTL_HOURS = 24;    // фото без записи — 24 часа
const LINE_DEFECTS_MAX_PHOTOS       = 3;
const LINE_DEFECTS_MAX_COMMENT      = 500;
const LINE_DEFECTS_MAX_PHOTO_BYTES  = 5 * 1024 * 1024;
const VIN_REGEX                     = /^[A-HJ-NPR-Z0-9]{17}$/;
const LINE_DEFECT_LOCATIONS         = ['CP7', 'CP8', 'SGP', 'REPAIR'];

if (!fs.existsSync(LINE_DEFECTS_DIR)) {
  fs.mkdirSync(LINE_DEFECTS_DIR, { recursive: true });
}

// ============================================================
// очистка: непривязанные фото (24ч) + старые файлы (9 мес) + файлы без БД
// ============================================================
async function cleanupLineDefectPhotos() {
  try {
    // 1) непривязанные фото старше 24ч — удаляем файл И строку
    const orphanCutoff = new Date(Date.now() - LINE_DEFECTS_ORPHAN_TTL_HOURS * 3600 * 1000);
    const [orphans] = await notesPool.query(
      `SELECT id, filename FROM line_defect_photos
       WHERE line_defect_id IS NULL AND uploaded_at < ?`,
      [orphanCutoff]
    );
    for (const o of orphans) {
      const fp = path.join(LINE_DEFECTS_DIR, o.filename);
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {
        console.error(`[LINE DEFECTS] unlink ${o.filename}:`, e.message);
      }
    }
    if (orphans.length > 0) {
      const ids = orphans.map(o => o.id);
      await notesPool.query(
        `DELETE FROM line_defect_photos WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      console.log(`[LINE DEFECTS] Непривязанных фото очищено: ${orphans.length}`);
    }

    // 2) файлы к дефектам старше 9 мес — удаляем файл, строку помечаем
    const oldCutoff = new Date(Date.now() - LINE_DEFECTS_PHOTO_TTL_DAYS * 24 * 3600 * 1000);
    const [oldPhotos] = await notesPool.query(
      `SELECT id, filename FROM line_defect_photos
       WHERE line_defect_id IS NOT NULL
         AND file_deleted_at IS NULL
         AND uploaded_at < ?`,
      [oldCutoff]
    );
    let deletedFiles = 0;
    const okIds = [];
    for (const p of oldPhotos) {
      const fp = path.join(LINE_DEFECTS_DIR, p.filename);
      try {
        if (fs.existsSync(fp)) { fs.unlinkSync(fp); deletedFiles++; }
        okIds.push(p.id);
      } catch (e) {
        console.error(`[LINE DEFECTS] unlink ${p.filename}:`, e.message);
      }
    }
    if (okIds.length > 0) {
      await notesPool.query(
        `UPDATE line_defect_photos SET file_deleted_at = NOW()
         WHERE id IN (${okIds.map(() => '?').join(',')})`,
        okIds
      );
      console.log(`[LINE DEFECTS] Старых фото: файлов ${deletedFiles}, помечено ${okIds.length}`);
    }

    // 3) файлы на диске без записи в БД (старше 24ч)
    const files = fs.readdirSync(LINE_DEFECTS_DIR);
    if (files.length > 0) {
      const [knownRows] = await notesPool.query(
        `SELECT filename FROM line_defect_photos
         WHERE filename IN (${files.map(() => '?').join(',')})`,
        files
      );
      const knownSet = new Set(knownRows.map(r => r.filename));
      const now = Date.now();
      let extraDeleted = 0;
      for (const f of files) {
        if (knownSet.has(f)) continue;
        const fp = path.join(LINE_DEFECTS_DIR, f);
        try {
          const stat = fs.statSync(fp);
          if (now - stat.mtimeMs < 24 * 3600 * 1000) continue;
          fs.unlinkSync(fp);
          extraDeleted++;
        } catch {}
      }
      if (extraDeleted > 0) {
        console.log(`[LINE DEFECTS] Файлов без записи в БД удалено: ${extraDeleted}`);
      }
    }
  } catch (err) {
    console.error('[LINE DEFECTS] Ошибка очистки:', err.message);
  }
}
cleanupLineDefectPhotos();
setInterval(cleanupLineDefectPhotos, 60 * 60 * 1000);

// ============================================================
// rate-limit (in-memory, по IP)
// ============================================================
const _ldRateMap = new Map();
function ldRateLimit(ip, max = 60, windowMs = 60 * 1000) {
  const now = Date.now();
  const rec = _ldRateMap.get(ip);
  if (!rec || now - rec.start > windowMs) {
    _ldRateMap.set(ip, { start: now, count: 1 });
    return true;
  }
  rec.count++;
  return rec.count <= max;
}

/* ============================================================
 * POST /api/line-defects/lookup-vin
 * body: { vin }
 * - 17 символов → точное совпадение в work_order
 * - 6..16 символов → поиск по суффиксу (последние N символов), LIMIT 20
 * ============================================================ */
app.post('/api/line-defects/lookup-vin', async (req, res) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!ldRateLimit(ip, 180)) {
      return res.json({ valid: false, reason: 'Слишком много запросов, подождите минуту' });
    }

    let vin = String(req.body?.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!vin) return res.json({ valid: false, reason: 'VIN пустой' });

    // ---- 17 символов: точное совпадение ----
    if (vin.length === 17) {
      if (!VIN_REGEX.test(vin)) {
        return res.json({ valid: false, reason: 'VIN содержит недопустимые символы (I, O, Q запрещены)' });
      }
      const [rows] = await pool.query(
        'SELECT VIN, MODEL FROM work_order WHERE VIN = ? LIMIT 1',
        [vin]
      );
      if (rows.length === 0) return res.json({ valid: false, reason: 'VIN не найден в базе' });
      return res.json({ valid: true, vin: rows[0].VIN, model: rows[0].MODEL || '', matched: 'exact' });
    }

    // ---- короткий запрос: suffix-поиск ----
    if (vin.length < 6) {
      return res.json({
        valid: false,
        reason: `Минимум 6 символов для поиска (сейчас ${vin.length})`,
      });
    }

    // suffix-поиск: без ORDER BY, LIMIT 20 — защита от full scan большого объёма
    const [rows] = await pool.query(
      'SELECT VIN, MODEL FROM work_order WHERE VIN LIKE ? LIMIT 20',
      [`%${vin}`]
    );

    if (rows.length === 0) {
      return res.json({ valid: false, reason: 'По этим символам ничего не найдено' });
    }

    if (rows.length === 1) {
      return res.json({
        valid: true,
        vin: rows[0].VIN,
        model: rows[0].MODEL || '',
        matched: 'suffix',
      });
    }

    return res.json({
      valid: false,
      multiple: true,
      reason: `Найдено ${rows.length} VIN — выберите нужный`,
      matches: rows.map(r => ({ vin: r.VIN, model: r.MODEL || '' })),
    });
  } catch (err) {
    console.error('[LINE DEFECTS] lookup-vin:', err.message);
    res.json({ valid: false, reason: 'Ошибка сервера: ' + err.message });
  }
});

/* ============================================================
 * GET /api/line-defects/suggest-parts?model=&q=
 * Автокомплит деталей: каталог + своя история + IOT + fallback
 * ============================================================ */
app.get('/api/line-defects/suggest-parts', async (req, res) => {
  try {
    const model = String(req.query.model || '').trim();
    const q     = String(req.query.q     || '').trim();
    const like  = `%${q}%`;

    // 1. Каталог (part_defect_shop_mapping)
    const [catalog] = await notesPool.query(
      `SELECT DISTINCT part_name FROM part_defect_shop_mapping
       WHERE part_name LIKE ? LIMIT 50`,
      [like]
    );

    // 2. Собственная история line_defects
    let own = [];
    if (model) {
      const [rows] = await notesPool.query(
        `SELECT DISTINCT part_name FROM line_defects
         WHERE TRIM(model) = TRIM(?) AND part_name LIKE ?
         ORDER BY part_name LIMIT 50`,
        [model, like]
      );
      own = rows;
    }

    // 3. История IOT (at_*_qm_defect_info)
    let iot = [];
    if (model) {
      const [rows] = await pool.query(
        `SELECT DISTINCT d.PART_NAME AS part_name
         FROM (
           SELECT VIN, PART_NAME FROM at_qm_defect_info
           UNION ALL SELECT VIN, PART_NAME FROM at_biw_qm_defect_info
           UNION ALL SELECT VIN, PART_NAME FROM at_paint_qm_defect_info
         ) d
         JOIN work_order wo ON wo.VIN = d.VIN
         WHERE TRIM(wo.MODEL) = TRIM(?)
           AND d.PART_NAME IS NOT NULL AND TRIM(d.PART_NAME) <> ''
           AND d.PART_NAME LIKE ?
         LIMIT 50`,
        [model, like]
      );
      iot = rows;
    }

    const map = new Map();
    catalog.forEach(r => map.set(r.part_name, { part_name: r.part_name, source: 'catalog' }));
    own.forEach(r => {
      if (!map.has(r.part_name)) map.set(r.part_name, { part_name: r.part_name, source: 'own' });
    });
    iot.forEach(r => {
      if (!map.has(r.part_name)) map.set(r.part_name, { part_name: r.part_name, source: 'actual' });
    });

    // 4. Fallback без привязки к модели
    if (map.size === 0 && q.length >= 1) {
      const [fallback] = await pool.query(
        `SELECT DISTINCT d.PART_NAME AS part_name
         FROM (
           SELECT VIN, PART_NAME FROM at_qm_defect_info
           UNION ALL SELECT VIN, PART_NAME FROM at_biw_qm_defect_info
           UNION ALL SELECT VIN, PART_NAME FROM at_paint_qm_defect_info
         ) d
         WHERE d.PART_NAME IS NOT NULL AND TRIM(d.PART_NAME) <> ''
           AND d.PART_NAME LIKE ?
         LIMIT 30`,
        [like]
      );
      fallback.forEach(r => {
        if (!map.has(r.part_name)) map.set(r.part_name, { part_name: r.part_name, source: 'global' });
      });
    }

    const list = [...map.values()].sort((a, b) => a.part_name.localeCompare(b.part_name, 'ru'));
    res.json(list.slice(0, 30));
  } catch (err) {
    console.error('[LINE DEFECTS] suggest-parts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
 * GET /api/line-defects/suggest-defects?model=&part=&q=
 * Автокомплит дефектов для выбранной детали
 * ============================================================ */
app.get('/api/line-defects/suggest-defects', async (req, res) => {
  try {
    const model = String(req.query.model || '').trim();
    const part  = String(req.query.part  || '').trim();
    const q     = String(req.query.q     || '').trim();
    if (!part) return res.json([]);
    const like = `%${q}%`;

    // 1. Каталог
    const [catalog] = await notesPool.query(
      `SELECT DISTINCT defect_type FROM part_defect_shop_mapping
       WHERE part_name = ? AND defect_type LIKE ? LIMIT 50`,
      [part, like]
    );

    // 2. Собственная история
    let own = [];
    if (model) {
      const [rows] = await notesPool.query(
        `SELECT DISTINCT problem_type FROM line_defects
         WHERE TRIM(model) = TRIM(?) AND part_name = ? AND problem_type LIKE ?
         ORDER BY problem_type LIMIT 50`,
        [model, part, like]
      );
      own = rows;
    }

    // 3. IOT-история
    let iot = [];
    if (model) {
      const [rows] = await pool.query(
        `SELECT DISTINCT d.PROBLEM_TYPE AS problem_type
         FROM (
           SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_qm_defect_info
           UNION ALL SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_biw_qm_defect_info
           UNION ALL SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_paint_qm_defect_info
         ) d
         JOIN work_order wo ON wo.VIN = d.VIN
         WHERE TRIM(wo.MODEL) = TRIM(?)
           AND d.PART_NAME = ?
           AND d.PROBLEM_TYPE IS NOT NULL AND TRIM(d.PROBLEM_TYPE) <> ''
           AND d.PROBLEM_TYPE LIKE ?
         LIMIT 50`,
        [model, part, like]
      );
      iot = rows;
    }

    const map = new Map();
    catalog.forEach(r => map.set(r.defect_type, { problem_type: r.defect_type, source: 'catalog' }));
    own.forEach(r => {
      if (!map.has(r.problem_type)) map.set(r.problem_type, { problem_type: r.problem_type, source: 'own' });
    });
    iot.forEach(r => {
      if (!map.has(r.problem_type)) map.set(r.problem_type, { problem_type: r.problem_type, source: 'actual' });
    });

    // Fallback
    if (map.size === 0 && q.length >= 1) {
      const [fallback] = await pool.query(
        `SELECT DISTINCT d.PROBLEM_TYPE AS problem_type
         FROM (
           SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_qm_defect_info
           UNION ALL SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_biw_qm_defect_info
           UNION ALL SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_paint_qm_defect_info
         ) d
         WHERE d.PART_NAME = ?
           AND d.PROBLEM_TYPE IS NOT NULL AND TRIM(d.PROBLEM_TYPE) <> ''
           AND d.PROBLEM_TYPE LIKE ?
         LIMIT 30`,
        [part, like]
      );
      fallback.forEach(r => {
        if (!map.has(r.problem_type)) map.set(r.problem_type, { problem_type: r.problem_type, source: 'global' });
      });
    }

    const list = [...map.values()].sort((a, b) => a.problem_type.localeCompare(b.problem_type, 'ru'));
    res.json(list.slice(0, 30));
  } catch (err) {
    console.error('[LINE DEFECTS] suggest-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
 * GET /api/line-defects/filters
 * Уникальные значения для фильтров архива
 * ⚠️ ВАЖНО: до /api/line-defects/:id
 * ============================================================ */
app.get('/api/line-defects/filters', async (req, res) => {
  try {
    const [models] = await notesPool.query(
      `SELECT model, COUNT(*) AS cnt FROM line_defects
       WHERE model <> '' GROUP BY model ORDER BY cnt DESC LIMIT 100`
    );
    const [parts] = await notesPool.query(
      `SELECT part_name, COUNT(*) AS cnt FROM line_defects
       GROUP BY part_name ORDER BY cnt DESC LIMIT 300`
    );
    const [problems] = await notesPool.query(
      `SELECT problem_type, COUNT(*) AS cnt FROM line_defects
       GROUP BY problem_type ORDER BY cnt DESC LIMIT 300`
    );
    const [locations] = await notesPool.query(
      `SELECT capture_location AS loc, COUNT(*) AS cnt
       FROM line_defects
       WHERE capture_location IS NOT NULL
       GROUP BY capture_location
       ORDER BY cnt DESC`
    );

    res.json({
      models:    models.map(r => r.model),
      parts:     parts.map(r => r.part_name),
      problems:  problems.map(r => r.problem_type),
      locations: locations.map(r => r.loc),
    });
  } catch (err) {
    console.error('[LINE DEFECTS] filters:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
 * GET /api/line-defects/photos-by-session/:client_id
 * Восстановление фото после перезагрузки страницы
 * ⚠️ ВАЖНО: до /api/line-defects/:id
 * ============================================================ */
app.get('/api/line-defects/photos-by-session/:client_id', async (req, res) => {
  try {
    const [rows] = await notesPool.query(
      `SELECT id, filename, mime FROM line_defect_photos
       WHERE client_id = ? AND line_defect_id IS NULL
       ORDER BY id ASC`,
      [req.params.client_id]
    );
    res.json(rows.map(p => ({
      id: p.id,
      url: `/api/line-defects/file/${p.filename}`,
      mime: p.mime,
    })));
  } catch (err) {
    console.error('[LINE DEFECTS] photos-by-session:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
 * POST /api/line-defects/photo
 * body: { data: "data:image/jpeg;base64,...", client_id }
 * Загрузка одного фото к ещё не созданной записи
 * ============================================================ */
app.post('/api/line-defects/photo', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!ldRateLimit(ip, 180)) {
      return res.status(429).json({ error: 'Слишком много запросов' });
    }

    const { data, client_id } = req.body || {};
    if (!data || !client_id) {
      return res.status(400).json({ error: 'data и client_id обязательны' });
    }

    const [[{ cnt }]] = await notesPool.query(
      'SELECT COUNT(*) AS cnt FROM line_defect_photos WHERE client_id = ?',
      [client_id]
    );
    if (Number(cnt) >= LINE_DEFECTS_MAX_PHOTOS) {
      return res.status(400).json({ error: `Максимум ${LINE_DEFECTS_MAX_PHOTOS} фото на дефект` });
    }

    let base64 = data;
    let mime = 'image/jpeg';
    const m = String(data).match(/^data:(.+?);base64,(.*)$/);
    if (m) { mime = m[1]; base64 = m[2]; }

    const buf = Buffer.from(base64, 'base64');
    if (buf.length === 0) {
      return res.status(400).json({ error: 'Пустой файл' });
    }
    if (buf.length > LINE_DEFECTS_MAX_PHOTO_BYTES) {
      return res.status(413).json({ error: 'Файл больше 5 МБ' });
    }

    // ---- magic bytes: реально ли это картинка ----
    const isJpeg = buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    const isPng  = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50
                && buf[2] === 0x4E && buf[3] === 0x47;
    const isWebp = buf.length > 12
                && buf.slice(0, 4).toString('ascii') === 'RIFF'
                && buf.slice(8, 12).toString('ascii') === 'WEBP';

    if (!isJpeg && !isPng && !isWebp) {
      return res.status(400).json({ error: 'Файл не является изображением (JPEG/PNG/WebP)' });
    }

    if (isJpeg) mime = 'image/jpeg';
    else if (isPng) mime = 'image/png';
    else if (isWebp) mime = 'image/webp';

    const ext = isPng ? 'png' : isWebp ? 'webp' : 'jpg';
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    fs.writeFileSync(path.join(LINE_DEFECTS_DIR, filename), buf);

    const [result] = await notesPool.query(
      'INSERT INTO line_defect_photos (client_id, filename, mime, size_bytes) VALUES (?, ?, ?, ?)',
      [client_id, filename, mime, buf.length]
    );

    res.json({
      id: result.insertId,
      url: `/api/line-defects/file/${filename}`,
      size_bytes: buf.length,
    });
  } catch (err) {
    console.error('[LINE DEFECTS] photo upload:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
 * DELETE /api/line-defects/photo/:id
 * - непривязанное фото (в форме) — удаляем без пароля
 * - привязанное к дефекту (в архиве) — требуется пароль
 * ============================================================ */
app.delete('/api/line-defects/photo/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body || {};

    const [rows] = await notesPool.query(
      'SELECT id, filename, line_defect_id FROM line_defect_photos WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Фото не найдено' });

    const photo = rows[0];

    if (photo.line_defect_id !== null) {
      if (!password) {
        return res.status(401).json({ error: 'Нужен пароль', needPassword: true });
      }
      if (String(password) !== String(IMPORT_PASSWORD)) {
        return res.status(403).json({ error: 'Неверный пароль' });
      }
    }

    const fp = path.join(LINE_DEFECTS_DIR, photo.filename);
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}

    await notesPool.query('DELETE FROM line_defect_photos WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[LINE DEFECTS] delete photo:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
 * POST /api/line-defects
 * body: { vin, capture_location, part_name, problem_type, comment,
 *         entry_mode, barcode_raw, photo_ids, client_id }
 * Создание записи о дефекте + привязка фото
 * ============================================================ */
app.post('/api/line-defects', async (req, res) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!ldRateLimit(ip, 60)) return res.status(429).json({ error: 'Слишком много запросов' });

    const {
      vin: vinRaw, part_name, problem_type, capture_location,
      comment = '', entry_mode = 'manual', barcode_raw = null,
      photo_ids = [], client_id,
    } = req.body || {};

    // ---- VIN ----
    const vin = String(vinRaw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!VIN_REGEX.test(vin)) return res.status(400).json({ error: 'Некорректный VIN' });

    // ---- обязательные поля ----
    if (!part_name || !String(part_name).trim()) {
      return res.status(400).json({ error: 'Не выбрана деталь' });
    }
    if (!problem_type || !String(problem_type).trim()) {
      return res.status(400).json({ error: 'Не выбран дефект' });
    }
    if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
      return res.status(400).json({ error: 'Нужно хотя бы 1 фото' });
    }
    if (photo_ids.length > LINE_DEFECTS_MAX_PHOTOS) {
      return res.status(400).json({ error: `Максимум ${LINE_DEFECTS_MAX_PHOTOS} фото` });
    }

    // ---- валидация места занесения ----
    const safeLocation = LINE_DEFECT_LOCATIONS.includes(capture_location) ? capture_location : null;
    if (!safeLocation) {
      return res.status(400).json({
        error: 'Не указано место занесения (CP7 / CP8 / СГП / Ремзона)',
      });
    }

    const trimmedPart    = String(part_name).trim();
    const trimmedProblem = String(problem_type).trim();

    // ---- дедупликация по client_id ----
    if (client_id) {
      const [exist] = await notesPool.query(
        'SELECT id FROM line_defects WHERE client_id = ? LIMIT 1',
        [client_id]
      );
      if (exist.length > 0) {
        return res.json({ id: exist[0].id, duplicate: true });
      }
    }

    // ---- модель берём С СЕРВЕРА ----
    const [wo] = await pool.query(
      'SELECT VIN, MODEL FROM work_order WHERE VIN = ? LIMIT 1',
      [vin]
    );
    if (wo.length === 0) return res.status(400).json({ error: 'VIN не найден в базе' });
    const model = wo[0].MODEL || '';

    // ---- валидация part + problem против каталога и истории ----
    let allowed = false;

    const [catalogHit] = await notesPool.query(
      `SELECT 1 FROM part_defect_shop_mapping
       WHERE part_name = ? AND defect_type = ? LIMIT 1`,
      [trimmedPart, trimmedProblem]
    );
    if (catalogHit.length > 0) allowed = true;

    if (!allowed) {
      const [historyHit] = await pool.query(
        `SELECT 1
         FROM (
           SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_qm_defect_info
           UNION ALL SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_biw_qm_defect_info
           UNION ALL SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_paint_qm_defect_info
         ) d
         JOIN work_order wo ON wo.VIN = d.VIN
         WHERE wo.MODEL = ?
           AND d.PART_NAME = ?
           AND d.PROBLEM_TYPE = ?
         LIMIT 1`,
        [model, trimmedPart, trimmedProblem]
      );
      if (historyHit.length > 0) allowed = true;
    }

    if (!allowed) {
      return res.status(400).json({
        error: 'Такая пара «деталь + дефект» не найдена в справочнике или истории для этой модели',
      });
    }

    // ---- комментарий ----
    const cleanComment = String(comment || '').trim().slice(0, LINE_DEFECTS_MAX_COMMENT);

    // ---- проверка фото ----
    const ph = photo_ids.map(() => '?').join(',');
    const [photoRows] = await notesPool.query(
      `SELECT id, client_id FROM line_defect_photos
       WHERE id IN (${ph}) AND line_defect_id IS NULL`,
      photo_ids
    );
    if (photoRows.length !== photo_ids.length) {
      return res.status(400).json({ error: 'Некоторые фото не найдены или уже привязаны' });
    }
    const cids = new Set(photoRows.map(r => r.client_id));
    if (client_id && cids.size > 0 && !cids.has(client_id)) {
      return res.status(400).json({ error: 'Фото не принадлежат текущей сессии' });
    }

    // ---- entry_mode ----
    const validModes = ['barcode', 'manual', 'photo_ocr'];
    const safeMode = validModes.includes(entry_mode) ? entry_mode : 'manual';

    // ---- запись ----
    const [ins] = await notesPool.query(
      `INSERT INTO line_defects
         (vin, model, part_name, problem_type, capture_location,
          comment, barcode_raw, entry_mode, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vin,
        model,
        trimmedPart,
        trimmedProblem,
        safeLocation,
        cleanComment || null,
        barcode_raw ? String(barcode_raw).slice(0, 255) : null,
        safeMode,
        client_id || null,
      ]
    );
    const defectId = ins.insertId;

    // ---- привязка фото ----
    await notesPool.query(
      `UPDATE line_defect_photos SET line_defect_id = ? WHERE id IN (${ph})`,
      [defectId, ...photo_ids]
    );

    res.json({ id: defectId, created_at: new Date().toISOString() });
  } catch (err) {
    console.error('[LINE DEFECTS] create:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
 * GET /api/line-defects/file/:filename
 * Раздача файла фото
 * ============================================================ */
app.get('/api/line-defects/file/:filename', (req, res) => {
  try {
    const safe = path.basename(req.params.filename);
    const fp = path.join(LINE_DEFECTS_DIR, safe);
    if (!fs.existsSync(fp)) return res.status(404).end();
    res.sendFile(fp);
  } catch (err) {
    res.status(500).end();
  }
});

/* ============================================================
 * GET /api/line-defects
 * Список записей с фото и пагинацией
 * Параметры: from, to, vin, model, part_name, problem_type,
 *            capture_location, search, limit, offset
 * ============================================================ */
app.get('/api/line-defects', async (req, res) => {
  try {
    const {
      from, to, vin, model, part_name, problem_type,
      capture_location,
      search, limit = 200, offset = 0,
    } = req.query;

    const where = [];
    const params = [];

    if (from) { where.push('created_at >= ?'); params.push(from); }
    if (to)   { where.push('created_at <= ?'); params.push(to); }

    if (vin) {
      const v = String(vin).toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
      if (v.length === 17) {
        where.push('vin = ?');
        params.push(v);
      } else if (v.length > 0) {
        // короткий запрос — ищем по суффиксу (последние N символов)
        where.push('vin LIKE ?');
        params.push(`%${v}`);
      }
    }

    if (model && model !== 'ALL') { where.push('model = ?'); params.push(model); }
    if (part_name)    { where.push('part_name LIKE ?');    params.push(`%${part_name}%`); }
    if (problem_type) { where.push('problem_type LIKE ?'); params.push(`%${problem_type}%`); }

    if (capture_location && capture_location !== 'ALL') {
      where.push('capture_location = ?');
      params.push(capture_location);
    }

    if (search) {
      where.push('(vin LIKE ? OR model LIKE ? OR part_name LIKE ? OR problem_type LIKE ? OR comment LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const lim = Math.min(Number(limit) || 200, 1000);
    const off = Math.max(Number(offset) || 0, 0);

    const [[{ total }]] = await notesPool.query(
      `SELECT COUNT(*) AS total FROM line_defects ${whereSql}`,
      params
    );

    const [rows] = await notesPool.query(
      `SELECT * FROM line_defects ${whereSql}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, lim, off]
    );

    const ids = rows.map(r => r.id);
    const photosByDefect = {};
    if (ids.length > 0) {
      const ph = ids.map(() => '?').join(',');
      const [phRows] = await notesPool.query(
        `SELECT id, line_defect_id, filename, mime, file_deleted_at
         FROM line_defect_photos
         WHERE line_defect_id IN (${ph})
         ORDER BY id ASC`,
        ids
      );
      phRows.forEach(p => {
        const deleted = !!p.file_deleted_at;
        if (!photosByDefect[p.line_defect_id]) photosByDefect[p.line_defect_id] = [];
        photosByDefect[p.line_defect_id].push({
          id: p.id,
          url: deleted ? null : `/api/line-defects/file/${p.filename}`,
          mime: p.mime,
          deleted,
          file_deleted_at: p.file_deleted_at,
        });
      });
    }

    res.json({
      items: rows.map(r => ({ ...r, photos: photosByDefect[r.id] || [] })),
      total,
      limit: lim,
      offset: off,
    });
  } catch (err) {
    console.error('[LINE DEFECTS] list:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
 * GET /api/line-defects/:id
 * Одна запись с фото
 * ⚠️ ВАЖНО: идёт ПОСЛЕ всех статических роутов /api/line-defects/<word>,
 *          иначе "filters", "suggest-parts", "photos-by-session" будут
 *          перехвачены :id и вернут 404.
 * ============================================================ */
app.get('/api/line-defects/:id', async (req, res) => {
  try {
    const [rows] = await notesPool.query(
      'SELECT * FROM line_defects WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Запись не найдена' });

    const [phRows] = await notesPool.query(
      `SELECT id, filename, mime, file_deleted_at
       FROM line_defect_photos
       WHERE line_defect_id = ? ORDER BY id ASC`,
      [req.params.id]
    );

    res.json({
      ...rows[0],
      photos: phRows.map(p => {
        const deleted = !!p.file_deleted_at;
        return {
          id: p.id,
          url: deleted ? null : `/api/line-defects/file/${p.filename}`,
          mime: p.mime,
          deleted,
          file_deleted_at: p.file_deleted_at,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
