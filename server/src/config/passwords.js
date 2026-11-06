// Пароли страниц. Задаются только в server/.env — значений по умолчанию в коде нет.
//
//   BRIGADE_PASSWORD — основной пароль (бригадный отчёт, VRT, гарантия, настройки рассылки)
//   IMPORT_PASSWORD  — специальный пароль (импорт справочников, управление бригадами/VRT,
//                      удаление фото дефектов линии)
//
// Если пароль не задан, сервер всё равно запускается (остальные страницы работают),
// пишет предупреждение в лог, а действия с этим паролем отклоняются как «неверный пароль».
const crypto = require('crypto');

function passwordFromEnv(name) {
  const value = process.env[name];
  if (value) return value;
  console.warn(`[ПАРОЛИ] ${name} не задан в server/.env — действия, которые требуют этот пароль, будут отклоняться.`);
  // Случайное значение, которое невозможно угадать: с ним не совпадёт ни один введённый пароль.
  return crypto.randomBytes(32).toString('hex');
}

const BRIGADE_PASSWORD = passwordFromEnv('BRIGADE_PASSWORD');
const IMPORT_PASSWORD = passwordFromEnv('IMPORT_PASSWORD');

module.exports = { BRIGADE_PASSWORD, IMPORT_PASSWORD };
