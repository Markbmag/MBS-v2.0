// Маршрут: тестовое письмо.
// Код перенесён из server.js без изменений.

const { sendEmail } = require('../../mailer');
const { app } = require('../app');

// ТЕСТ: отправить письмо самому себе (или указанному адресу)
app.post('/api/email/test', async (req, res) => {
  try {
    // если в body не передали "to" — шлём на SMTP_USER
    const to = req.body?.to || process.env.SMTP_USER;
    if (!to) return res.status(400).json({ error: 'Не указан получатель (to)' });

    const ok = await sendEmail({
      to,
      subject: `MBS Quality System — тест ${new Date().toLocaleString('ru-RU')}`,
      text: `Тестовое письмо.\n\nЕсли ты его получил — SMTP работает.\nВремя: ${new Date().toLocaleString('ru-RU')}`,
    });

    res.json({ success: ok, to });
  } catch (err) {
    console.error('email/test:', err.message);
    res.status(500).json({ error: err.message });
  }
});
