// Маршруты: CPA score.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { notesPool } = require('../db');

// ================== CPA SCORE ==================
app.get('/api/cpa-scores', async (req, res) => {
  try {
    const [rows] = await notesPool.query('SELECT model, score FROM cpa_scores');
    const map = {};
    rows.forEach(r => { map[r.model] = r.score; });
    res.json(map);
  } catch (err) {
    console.error('Ошибка получения CPA:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cpa-scores', async (req, res) => {
  try {
    const { model, score } = req.body;
    if (!model) return res.status(400).json({ error: 'model обязателен' });

    await notesPool.query(`
      INSERT INTO cpa_scores (model, score) 
      VALUES (?, ?) 
      ON DUPLICATE KEY UPDATE score = VALUES(score), updated_at = CURRENT_TIMESTAMP
    `, [model, score || '']);

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения CPA:', err.message);
    res.status(500).json({ error: err.message });
  }
});
