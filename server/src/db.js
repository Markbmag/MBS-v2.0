// Пулы подключений к БД (основная, notes, MES, LES, BMS), доступность БД notes, проверки подключений.
// Код перенесён из server.js без изменений.

const mysql = require('mysql2/promise');

// ================== БД ==================
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectTimeout: 10000,
  dateStrings: true,
});

const notesPool = mysql.createPool({
  host: process.env.NOTES_HOST,
  port: parseInt(process.env.NOTES_PORT) || 3306,
  user: process.env.NOTES_USER,
  password: process.env.NOTES_PASSWORD,
  database: process.env.NOTES_NAME,
  waitForConnections: true,
  connectTimeout: 10000,
  dateStrings: true,
});

const mesPool = mysql.createPool({
  host: process.env.MES_HOST,
  port: parseInt(process.env.MES_PORT) || 3306,
  user: process.env.MES_USER,
  password: process.env.MES_PASSWORD,
  database: process.env.MES_NAME,
  waitForConnections: true,
  connectTimeout: 10000,
  dateStrings: true,
});

const lesPool = mysql.createPool({
  host: process.env.LES_HOST,
  port: parseInt(process.env.LES_PORT) || 3306,
  user: process.env.LES_USER,
  password: process.env.LES_PASSWORD,
  database: process.env.LES_NAME,
  waitForConnections: true,
  connectTimeout: 10000,
  dateStrings: true,
});

const bmsPool = mysql.createPool({
  host: process.env.BMS_HOST,
  port: parseInt(process.env.BMS_PORT) || 3306,
  user: process.env.BMS_USER,
  password: process.env.BMS_PASSWORD,
  database: process.env.BMS_NAME,
  waitForConnections: true,
  connectTimeout: 10000,
  dateStrings: true,
});

// ================== NOTES AVAILABILITY ==================
let notesAvailable = false;

async function pingNotes() {
  try {
    const conn = await notesPool.getConnection();
    conn.release();
    if (!notesAvailable) {
      console.log('[NOTES] Соединение восстановлено — snapshot DRR, метки/фото смен и справочники снова работают.');
    }
    notesAvailable = true;
  } catch (err) {
    if (notesAvailable) {
      console.warn(`[NOTES] Соединение потеряно: ${err.code || ''} ${err.message}`);
    }
    notesAvailable = false;
  }
}

// Первый пинг сразу, потом каждые 15 секунд
pingNotes();
setInterval(pingNotes, 15 * 1000);

// Middleware для эндпоинтов, зависящих от notes
function requireNotes(req, res, next) {
  if (!notesAvailable) {
    return res.status(503).json({
      error: 'notes_database_unavailable',
      message: 'БД заметок временно недоступна. Данные появятся автоматически, как только соединение восстановится.',
    });
  }
  next();
}

console.log('DB_USER:', process.env.DB_USER);
console.log('MES_HOST:', process.env.MES_HOST);
console.log('LES_HOST:', process.env.LES_HOST);

async function checkDatabaseConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('Основная БД: OK');
    connection.release();
    return true;
  } catch (err) {
    console.error('Основная БД ОШИБКА:', err.message);
    return false;
  }
}

async function checkNotesDatabaseConnection() {
  await pingNotes();
  return notesAvailable;
}

async function checkLesDatabaseConnection() {
  try {
    const connection = await lesPool.getConnection();
    console.log('БД LES: OK');
    connection.release();
    return true;
  } catch (err) {
    console.error('БД LES ОШИБКА:', err.message);
    return false;
  }
}

async function checkBmsDatabaseConnection() {
  try {
    const connection = await bmsPool.getConnection();
    console.log('✅ БД BMS (launch_db): Подключение успешно!');
    connection.release();
    return true;
  } catch (err) {
    console.error('❌ БД BMS (launch_db) ОШИБКА:', err.message);
    return false;
  }
}

module.exports = { bmsPool, checkBmsDatabaseConnection, checkDatabaseConnection, checkLesDatabaseConnection, checkNotesDatabaseConnection, lesPool, mesPool, notesPool, pool };
