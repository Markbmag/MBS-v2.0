// Маршруты: настройки рассылки.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { notesPool } = require('../db');

// ================== EMAIL SETTINGS ==================

// Создание таблицы, если её ещё нет
async function initEmailSettingsTable() {
  try {
    await notesPool.query(`
      CREATE TABLE IF NOT EXISTS email_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        to_email VARCHAR(1000) NOT NULL DEFAULT '',
        cc_email VARCHAR(1000) NOT NULL DEFAULT '',
        subject VARCHAR(500) NOT NULL DEFAULT '',
        body TEXT,
        signature_text TEXT,
        signature_image LONGTEXT,
        sender_name VARCHAR(255) DEFAULT 'MBS Quality System',
        schedule_days VARCHAR(100) DEFAULT '1,2,3,4,5',
        schedule_times VARCHAR(500) DEFAULT '08:00,12:00,16:00',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('Таблица email_settings готова');
  } catch (err) {
    console.error('Ошибка создания таблицы email_settings:', err.message);
  }
}

// Вызываем при старте сервера (можно в startServer перед app.listen)
initEmailSettingsTable();

// Получить настройки
app.get('/api/email-settings', async (req, res) => {
  try {
    const [rows] = await notesPool.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1');
    if (rows.length === 0) {
      return res.json({
        to: '',
        cc: '',
        subject: '',
        body: '',
        signature_text: '',
        signature_image: '',
        sender_name: 'MBS Quality System',
        schedule: { days: [1,2,3,4,5], times: ['08:00','12:00','16:00'] },
      });
    }
    const row = rows[0];
    res.json({
      to: row.to_email,
      cc: row.cc_email,
      subject: row.subject,
      body: row.body,
      signature_text: row.signature_text,
      signature_image: row.signature_image,
      sender_name: row.sender_name,
      schedule: {
        days: row.schedule_days ? row.schedule_days.split(',').map(Number) : [],
        times: row.schedule_times ? row.schedule_times.split(',') : [],
      },
    });
  } catch (err) {
    console.error('Ошибка получения email-settings:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Сохранить настройки
app.post('/api/email-settings', async (req, res) => {
  try {
    const {
      to, cc, subject, body,
      signature_text, signature_image, sender_name, schedule,
    } = req.body;

    const daysStr = Array.isArray(schedule?.days) ? schedule.days.join(',') : '';
    const timesStr = Array.isArray(schedule?.times) ? schedule.times.join(',') : '';

    // Удаляем старые записи и вставляем новую (одна строка настроек)
    await notesPool.query('DELETE FROM email_settings');
    await notesPool.query(`
      INSERT INTO email_settings 
        (to_email, cc_email, subject, body, signature_text, signature_image, sender_name, schedule_days, schedule_times)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [to, cc, subject, body, signature_text, signature_image, sender_name, daysStr, timesStr]);

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения email-settings:', err.message);
    res.status(500).json({ error: err.message });
  }
});
