// Маршруты: заметки к дефектам.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { notesPool } = require('../db');

// ================== /LINE DEFECTS CAPTURE ===================



// ================== ЗАМЕТКИ ==================

// Получение всех заметок
app.get('/api/defect-notes', async (req, res) => {
  try {
    const [rows] = await notesPool.query(
      'SELECT * FROM defect_user_notes ORDER BY updated_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения заметок:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Сохранение или обновление заметки
app.post('/api/defect-notes', async (req, res) => {
  try {
    const { mpp, responsible, action } = req.body;
    if (!mpp) return res.status(400).json({ error: 'mpp обязателен' });

    // Проверяем существует ли запись
    const [existing] = await notesPool.query(
      'SELECT id FROM defect_user_notes WHERE mpp = ? LIMIT 1',
      [mpp]
    );

    if (existing.length > 0) {
      // Обновляем существующую
      await notesPool.query(
        'UPDATE defect_user_notes SET responsible = ?, action = ?, updated_at = CURRENT_TIMESTAMP WHERE mpp = ?',
        [responsible || '', action || '', mpp]
      );
    } else {
      // Вставляем новую
      await notesPool.query(
        'INSERT INTO defect_user_notes (mpp, responsible, action) VALUES (?, ?, ?)',
        [mpp, responsible || '', action || '']
      );
    }

    // Возвращаем обновленную запись
    const [updated] = await notesPool.query(
      'SELECT * FROM defect_user_notes WHERE mpp = ? LIMIT 1',
      [mpp]
    );

    res.json({ success: true, note: updated[0] || null });
  } catch (err) {
    console.error('Ошибка сохранения заметки:', err.message);
    res.status(500).json({ error: err.message });
  }
});
