// Пароли страниц (из .env, иначе значения по умолчанию).
// Код перенесён из server.js без изменений.

// ================== ПАРОЛИ ==================
const BRIGADE_PASSWORD        = process.env.BRIGADE_PASSWORD        || '1234561';
const IMPORT_PASSWORD         = process.env.IMPORT_PASSWORD         || '4002';
const BRIGADE_MANAGE_PASSWORD = process.env.BRIGADE_MANAGE_PASSWORD || '4002';

module.exports = { BRIGADE_PASSWORD, IMPORT_PASSWORD };
