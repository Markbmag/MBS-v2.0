// Маршрут: проверка пароля для страниц (пароли хранятся только на сервере, в .env).
//
// POST /api/check-password   { kind: 'main' | 'import', password }
//   200 { success: true }                              — пароль верный
//   403 { success: false, error: 'Неверный пароль' }   — пароль неверный
//   400 { success: false, error: ... }                 — неизвестный kind
// Формат ответа такой же, как у /api/warranty/check-password.

const { app } = require('../app');
const { BRIGADE_PASSWORD, IMPORT_PASSWORD } = require('../config/passwords');

const PASSWORDS_BY_KIND = {
  main: BRIGADE_PASSWORD,
  import: IMPORT_PASSWORD,
};

app.post('/api/check-password', (req, res) => {
  const { kind, password } = req.body || {};
  if (!Object.prototype.hasOwnProperty.call(PASSWORDS_BY_KIND, kind)) {
    return res.status(400).json({ success: false, error: 'Неизвестный тип пароля' });
  }
  if (typeof password === 'string' && password === PASSWORDS_BY_KIND[kind]) {
    return res.json({ success: true });
  }
  return res.status(403).json({ success: false, error: 'Неверный пароль' });
});
