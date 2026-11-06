// DRR по сменам: фото и метки (с очисткой).
// Код перенесён из server.js без изменений.

const path = require('path');
const fs = require('fs');
const { SERVER_DIR } = require('../paths');
const { app } = require('../app');
const { notesPool } = require('../db');

/* ====================================================================== */
/* ============ DRR SHIFT — ФОТОГРАФИИ И МЕТКИ ========================== */
/* ====================================================================== */

const DRR_SHIFT_UPLOAD_DIR = path.join(SERVER_DIR, 'uploads', 'drr-shift');
if (!fs.existsSync(DRR_SHIFT_UPLOAD_DIR)) {
  fs.mkdirSync(DRR_SHIFT_UPLOAD_DIR, { recursive: true });
}

const DRR_SHIFT_PHOTO_TTL_MS = 2 * 24 * 60 * 60 * 1000;   // 2 дня
const DRR_SHIFT_MARK_TTL_MS  = 24 * 60 * 60 * 1000;       // 1 сутки

/* ---------- ФОТО ---------- */

// Раздача файла по имени через API (надёжнее express.static)
app.get('/api/drr-shift-photos/file/:filename', (req, res) => {
  try {
    const safeName = path.basename(req.params.filename);
    const filePath = path.join(DRR_SHIFT_UPLOAD_DIR, safeName);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).end();
  }
});

// Периодическая очистка старых фото
async function cleanupOldDrrShiftPhotos() {
  try {
    const cutoff = new Date(Date.now() - DRR_SHIFT_PHOTO_TTL_MS);
    const [old] = await notesPool.query(
      'SELECT id, filename FROM drr_shift_photos WHERE uploaded_at < ?',
      [cutoff]
    );
    for (const row of old) {
      const filePath = path.join(DRR_SHIFT_UPLOAD_DIR, row.filename);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    }
    if (old.length > 0) {
      await notesPool.query('DELETE FROM drr_shift_photos WHERE uploaded_at < ?', [cutoff]);
      console.log(`[DRR SHIFT PHOTOS] Очищено ${old.length} старых фото`);
    }
  } catch (err) {
    console.error('[DRR SHIFT PHOTOS] Ошибка очистки:', err.message);
  }
}
cleanupOldDrrShiftPhotos();
setInterval(cleanupOldDrrShiftPhotos, 60 * 60 * 1000);

/* Загрузка фото */
app.post('/api/drr-shift-photos/upload', async (req, res) => {
  try {
    const { photo_key, data, mime = 'image/jpeg', uploaded_by = null } = req.body;
    if (!photo_key || !data) {
      return res.status(400).json({ error: 'photo_key и data обязательны' });
    }

    let base64 = data;
    let detectedMime = mime;
    const m = data.match(/^data:(.+?);base64,(.*)$/);
    if (m) {
      detectedMime = m[1];
      base64 = m[2];
    }

    const buf = Buffer.from(base64, 'base64');
    if (buf.length > 5 * 1024 * 1024) {
      return res.status(413).json({ error: 'Файл больше 5 МБ' });
    }

    const ext = detectedMime.includes('png') ? 'png'
              : detectedMime.includes('webp') ? 'webp'
              : 'jpg';
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.join(DRR_SHIFT_UPLOAD_DIR, filename);

    fs.writeFileSync(filePath, buf);
    console.log(`[DRR SHIFT PHOTOS] Сохранено: ${filename} (${buf.length} байт)`);

    const [result] = await notesPool.query(
      'INSERT INTO drr_shift_photos (photo_key, filename, mime, uploaded_by) VALUES (?, ?, ?, ?)',
      [photo_key, filename, detectedMime, uploaded_by]
    );

    res.json({
      success: true,
      id: result.insertId,
      url: `/api/drr-shift-photos/file/${filename}`,
    });
  } catch (err) {
    console.error('Ошибка загрузки фото DRR SHIFT:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* Все фото по префиксу ключа (одним запросом) */
app.get('/api/drr-shift-photos/all', async (req, res) => {
  try {
    const { prefix } = req.query;
    let sql = 'SELECT id, photo_key, filename, mime, uploaded_at, uploaded_by FROM drr_shift_photos';
    const params = [];
    if (prefix) {
      sql += ' WHERE photo_key LIKE ?';
      params.push(`${prefix}%`);
    }
    sql += ' ORDER BY uploaded_at ASC';
    const [rows] = await notesPool.query(sql, params);

    const grouped = {};
    rows.forEach(r => {
      const url = `/api/drr-shift-photos/file/${r.filename}`;
      if (!grouped[r.photo_key]) grouped[r.photo_key] = [];
      grouped[r.photo_key].push({
        id: r.id,
        url,
        mime: r.mime,
        uploadedAt: r.uploaded_at,
        uploadedBy: r.uploaded_by,
      });
    });

    res.json(grouped);
  } catch (err) {
    console.error('Ошибка получения всех фото DRR SHIFT:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* Удаление фото */
app.delete('/api/drr-shift-photos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query('SELECT filename FROM drr_shift_photos WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Фото не найдено' });

    const filePath = path.join(DRR_SHIFT_UPLOAD_DIR, rows[0].filename);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}

    await notesPool.query('DELETE FROM drr_shift_photos WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления фото DRR SHIFT:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ---------- МЕТКИ (жёлтые строки) ---------- */

// Очистка меток старше суток
async function cleanupOldDrrShiftMarks() {
  try {
    const cutoff = new Date(Date.now() - DRR_SHIFT_MARK_TTL_MS);
    const [result] = await notesPool.query(
      'DELETE FROM drr_shift_marks WHERE created_at < ?',
      [cutoff]
    );
    if (result.affectedRows > 0) {
      console.log(`[DRR SHIFT MARKS] Очищено ${result.affectedRows} старых меток`);
    }
  } catch (err) {
    console.error('[DRR SHIFT MARKS] Ошибка очистки:', err.message);
  }
}
cleanupOldDrrShiftMarks();
setInterval(cleanupOldDrrShiftMarks, 60 * 60 * 1000);

// Список меток по префиксу
app.get('/api/drr-shift-marks', async (req, res) => {
  try {
    const { prefix } = req.query;
    const cutoff = new Date(Date.now() - DRR_SHIFT_MARK_TTL_MS);
    let sql = 'SELECT mark_key FROM drr_shift_marks WHERE created_at >= ?';
    const params = [cutoff];
    if (prefix) {
      sql += ' AND mark_key LIKE ?';
      params.push(`${prefix}%`);
    }
    const [rows] = await notesPool.query(sql, params);
    res.json(rows.map(r => r.mark_key));
  } catch (err) {
    console.error('Ошибка получения меток DRR SHIFT:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Toggle метки (если есть — удалить, если нет — создать)
app.post('/api/drr-shift-marks/toggle', async (req, res) => {
  try {
    const { mark_key } = req.body;
    if (!mark_key) return res.status(400).json({ error: 'mark_key обязателен' });

    const [existing] = await notesPool.query(
      'SELECT id FROM drr_shift_marks WHERE mark_key = ?',
      [mark_key]
    );

    if (existing.length > 0) {
      await notesPool.query('DELETE FROM drr_shift_marks WHERE mark_key = ?', [mark_key]);
      return res.json({ success: true, marked: false });
    } else {
      await notesPool.query('INSERT INTO drr_shift_marks (mark_key) VALUES (?)', [mark_key]);
      return res.json({ success: true, marked: true });
    }
  } catch (err) {
    console.error('Ошибка toggle метки DRR SHIFT:', err.message);
    res.status(500).json({ error: err.message });
  }
});
