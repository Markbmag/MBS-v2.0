require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const { sendEmail } = require('./mailer');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

// Вспомогательная функция
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}


const app = express();
app.use(cors({
  origin: 'http://localhost:30000',
  credentials: true
}));
app.use(express.json({ limit: '256mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// ================== ПАРОЛИ ==================
const BRIGADE_PASSWORD        = process.env.BRIGADE_PASSWORD        || '1234561';
const IMPORT_PASSWORD         = process.env.IMPORT_PASSWORD         || '4002';
const BRIGADE_MANAGE_PASSWORD = process.env.BRIGADE_MANAGE_PASSWORD || '4002';


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


// ================== OPC UA ЧТЕНИЕ ПЛК ==================
const { OPCUAClient, MessageSecurityMode, SecurityPolicy } = require('node-opcua');

const OPC_ENDPOINT        = process.env.OPC_ENDPOINT || 'opc.tcp://10.203.46.10:4840';
const OPC_NODE_ID         = process.env.OPC_NODE_ID  || 'ns=3;s="IOT_设备交互数据"."Overhead Process Section"."PLC_TO_IOT"."备用"';
const OPC_POLL_INTERVAL   = parseInt(process.env.OPC_POLL_INTERVAL)   || 3000;
const OPC_MAX_READ_ERRORS = parseInt(process.env.OPC_MAX_READ_ERRORS) || 5;
const OPC_RECONNECT_DELAY = parseInt(process.env.OPC_RECONNECT_DELAY) || 5000;

// Общее состояние — отдаётся по HTTP
const opcState = {
  value: null,
  ts: null,
  error: null,
  connected: false,
};

async function startOpcPolling() {
  while (true) {
    let client = null;
    let session = null;

    try {
      console.log(`[OPC UA] Подключение к ${OPC_ENDPOINT}...`);

      client = OPCUAClient.create({
        endpointMustExist: false,
        securityMode: MessageSecurityMode.None,
        securityPolicy: SecurityPolicy.None,
        connectionStrategy: {
          initialDelay: 2000,
          maxRetry: 3,
          maxDelay: 5000,
        },
      });

      await client.connect(OPC_ENDPOINT);
      console.log('[OPC UA] Подключено');

      session = await client.createSession();
      console.log('[OPC UA] Сессия создана');

      opcState.connected = true;
      opcState.error = null;

      let readErrors = 0;

      while (true) {
        try {
          const dataValue = await session.readVariableValue(OPC_NODE_ID);
          opcState.value = dataValue.value.value;
          opcState.ts = Date.now();
          opcState.error = null;
          readErrors = 0;
          console.log(`[OPC UA] Значение: ${opcState.value}`);
        } catch (readErr) {
          readErrors++;
          console.error(
            `[OPC UA] Ошибка чтения (${readErrors}/${OPC_MAX_READ_ERRORS}):`,
            readErr.message
          );
          opcState.error = `read: ${readErr.message}`;

          // Если ошибки идут подряд — рвём цикл и переподключаемся
          if (readErrors >= OPC_MAX_READ_ERRORS) {
            console.error('[OPC UA] Слишком много ошибок чтения — переподключение');
            break;
          }
        }

        await new Promise((r) => setTimeout(r, OPC_POLL_INTERVAL));
      }
    } catch (connErr) {
      console.error('[OPC UA] Ошибка подключения:', connErr.message);
      opcState.error = `connect: ${connErr.message}`;
    } finally {
      opcState.connected = false;

      // ВАЖНО: сначала сессия, потом клиент
      try {
        if (session) await session.close();
      } catch (e) {
        // молча: сессия могла уже умереть вместе с соединением
      }
      try {
        if (client) await client.disconnect();
      } catch (e) {
        // молча
      }

      console.log(`[OPC UA] Отключено, повтор через ${OPC_RECONNECT_DELAY / 1000} с`);
      await new Promise((r) => setTimeout(r, OPC_RECONNECT_DELAY));
    }
  }
}

// Запускаем поллинг и ловим необработанные ошибки, чтобы не уронить процесс
startOpcPolling().catch((e) => {
  console.error('[OPC UA] Фатальная ошибка поллинга:', e);
});

// HTTP-эндпоинт для фронта
app.get('/api/opc-value', (req, res) => {
  res.json(opcState);
});
// =======================================================


// Старые эндпоинты
app.get('/api/tables', async (req, res) => {
  try {
    const [rows] = await pool.query('SHOW TABLES');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/defects', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM at_qm_defect_info LIMIT 100');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cars-count', async (req, res) => {
  try {
    const { model, date } = req.query;
    if (!date) return res.json({ CARS_COUNT: 0 });

    let sql;
    let params;

    if (model) {
      sql = `SELECT COUNT(DISTINCT VIN) AS CARS_COUNT FROM at_om_wiptrackinghistory WHERE WC_NAME IN ('CP72') AND MODEL = ? AND DATE(CREATION_TIME) = ?`;
      params = [model, date];
    } else {
      sql = `SELECT COUNT(DISTINCT VIN) AS CARS_COUNT FROM at_om_wiptrackinghistory WHERE WC_NAME IN ('CP72') AND DATE(CREATION_TIME) = ?`;
      params = [date];
    }

    const [rows] = await pool.query(sql, params);
    res.json({ CARS_COUNT: rows[0]?.CARS_COUNT || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 2. Основная таблица (с учетом смен и костылем "Отсутствие")
app.get('/api/defects-dashboard', async (req, res) => {
  try {
    const { checkpoint, defectType, shift = 'all' } = req.query;
    const type = defectType || 'default';

    // Списки постов
    const cp7Posts = [
      'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
      'REPAIR', 'REPAIR_Final',
      'EXT1', 'PIP2', 'PIP4', 'PIP9'
    ];
    const cp8Posts = [
      'CP8', 'CP8 Gate', 'CP8-gate',
      '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT'
    ];
    const pipPosts = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
    const tlPosts  = ['360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'];

    let postList = [];
    if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else if (checkpoint === 'PIP') postList = pipPosts;
    else if (checkpoint === 'TL') postList = tlPosts;
    else postList = [...new Set([...cp7Posts, ...cp8Posts])];

    const postListStr = postList.map(p => `'${p}'`).join(',');

    // ФИКС: Добавлен костыль "Отсутствие" для оффлайн
    let whereClause = ` AND QM_DEF.POST_NAME IN (${postListStr})`;
    if (type === 'offline') {
      whereClause += ` AND (QM_DEF.S_OFFLINE = 1 OR QM_DEF.PROBLEM_TYPE = 'Отсутствие')`;
    } else if (type === 'online') {
      whereClause += ` AND QM_DEF.S_OFFLINE = 0 AND QM_DEF.PROBLEM_TYPE <> 'Отсутствие'`;
    }

    // ---------- ЛОГИКА СМЕН ----------
    const minutesExpr = `(HOUR(QM_DEF.CREATION_TIME) * 60 + MINUTE(QM_DEF.CREATION_TIME))`;

    let shiftDateExpr;
    if (shift === 'all') {
      shiftDateExpr = `DATE(QM_DEF.CREATION_TIME)`;
    } else if (shift === 'C') {
      shiftDateExpr = `CASE WHEN ${minutesExpr} BETWEEN 91 AND 469 THEN DATE(QM_DEF.CREATION_TIME) END`;
    } else if (shift === 'A') {
      shiftDateExpr = `
        CASE
          WHEN WEEKOFYEAR(QM_DEF.CREATION_TIME) % 2 = 0 THEN
            CASE
              WHEN ${minutesExpr} BETWEEN 1001 AND 1439 THEN DATE(QM_DEF.CREATION_TIME)
              WHEN ${minutesExpr} BETWEEN 0 AND 90 THEN DATE_SUB(DATE(QM_DEF.CREATION_TIME), INTERVAL 1 DAY)
            END
          ELSE
            CASE WHEN ${minutesExpr} BETWEEN 470 AND 1000 THEN DATE(QM_DEF.CREATION_TIME) END
        END
      `;
    } else if (shift === 'B') {
      shiftDateExpr = `
        CASE
          WHEN WEEKOFYEAR(QM_DEF.CREATION_TIME) % 2 = 0 THEN
            CASE WHEN ${minutesExpr} BETWEEN 470 AND 1000 THEN DATE(QM_DEF.CREATION_TIME) END
          ELSE
            CASE
              WHEN ${minutesExpr} BETWEEN 1001 AND 1439 THEN DATE(QM_DEF.CREATION_TIME)
              WHEN ${minutesExpr} BETWEEN 0 AND 90 THEN DATE_SUB(DATE(QM_DEF.CREATION_TIME), INTERVAL 1 DAY)
            END
        END
      `;
    } else {
      shiftDateExpr = `DATE(QM_DEF.CREATION_TIME)`;
    }

    const query = `
      SELECT
        t.PART_NAME,
        t.PROBLEM_TYPE,
        CONCAT(t.PART_NAME, ' ', t.PROBLEM_TYPE) AS PP,
        t.SHIFT_DATE AS CREATION_TIME,
        t.MODEL,
        t.VIN,
        t.POST_NAME,
        COUNT(*) AS QTY_DEF
      FROM (
        SELECT
          QM_DEF.PART_NAME,
          QM_DEF.PROBLEM_TYPE,
          QM_DEF.VIN,
          QM_DEF.POST_NAME,
          wo.MODEL,
          (${shiftDateExpr}) AS SHIFT_DATE
        FROM (
          SELECT VIN, CREATION_TIME, CHECK_POINT, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
                 PART_NAME, PROBLEM_TYPE
          FROM at_biw_qm_defect_info
          WHERE CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
          UNION ALL
          SELECT VIN, CREATION_TIME, CHECK_POINT, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
                 PART_NAME, PROBLEM_TYPE
          FROM at_paint_qm_defect_info
          WHERE CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
          UNION ALL
          SELECT VIN, CREATION_TIME, CHECK_POINT, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
                 PART_NAME, PROBLEM_TYPE
          FROM at_qm_defect_info
          WHERE CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        ) QM_DEF
        JOIN work_order wo ON wo.VIN = QM_DEF.VIN
        WHERE 1=1 ${whereClause}
          AND QM_DEF.PART_NAME IS NOT NULL AND TRIM(QM_DEF.PART_NAME) <> ''
          AND QM_DEF.PROBLEM_TYPE IS NOT NULL AND TRIM(QM_DEF.PROBLEM_TYPE) <> ''
      ) t
      WHERE t.SHIFT_DATE IS NOT NULL
      GROUP BY t.PART_NAME, t.PROBLEM_TYPE, t.SHIFT_DATE, t.MODEL, t.VIN, t.POST_NAME
      ORDER BY t.SHIFT_DATE DESC
    `;

    const [rows] = await pool.query(query);

    const result = rows.map(row => ({
      CREATION_TIME: row.CREATION_TIME,
      MODEL: row.MODEL || 'UNKNOWN',
      PART_NAME: row.PART_NAME || '',
      PROBLEM_TYPE: row.PROBLEM_TYPE || '',
      MPP: `${row.MODEL || 'UNKNOWN'} ${row.PP}`,
      VIN: row.VIN,
      POST_NAME: row.POST_NAME,
      DEFECTS_COUNT: Number(row.QTY_DEF) || 0,
    }));

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА defects-dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. Динамика дефекта для графиков (с поддержкой поиска, моделей и костыля "Отсутствие")
app.get('/api/report-page-defect-trend', async (req, res) => {
  try {
    const { partName, problemType, model, checkpoint, periodType, shift = 'all', defectType = 'default', searchPart, searchDefect } = req.query;
    if (!periodType) return res.status(400).json({ error: 'periodType обязателен' });

    const cp7Posts = ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'REPAIR', 'REPAIR_Final', 'EXT1', 'PIP2', 'PIP4', 'PIP9'];
    const cp8Posts = ['CP8', 'CP8 Gate', 'CP8-gate', '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'];
    const pipPosts = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
    const tlPosts  = ['360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'];

    let postList = [];
    if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else if (checkpoint === 'PIP') postList = pipPosts;
    else if (checkpoint === 'TL') postList = tlPosts;
    else postList = [...new Set([...cp7Posts, ...cp8Posts])];

    const postListStr = postList.map(p => `'${p}'`).join(',');

    // ФИКС: Добавлен костыль "Отсутствие"
    let whereClause = ` AND QM_DEF.POST_NAME IN (${postListStr})`;
    if (defectType === 'offline') {
      whereClause += ` AND (QM_DEF.S_OFFLINE = 1 OR QM_DEF.PROBLEM_TYPE = 'Отсутствие')`;
    } else if (defectType === 'online') {
      whereClause += ` AND QM_DEF.S_OFFLINE = 0 AND QM_DEF.PROBLEM_TYPE <> 'Отсутствие'`;
    }

    // ФИКС 1: Исключаем пустые детали и дефекты, как в основном дашборде
    whereClause += ` AND QM_DEF.PART_NAME IS NOT NULL AND TRIM(QM_DEF.PART_NAME) <> ''`;
    whereClause += ` AND QM_DEF.PROBLEM_TYPE IS NOT NULL AND TRIM(QM_DEF.PROBLEM_TYPE) <> ''`;

    const queryParams = [];
    
    // Обработка поиска по детали
    if (searchPart) {
      whereClause += ` AND QM_DEF.PART_NAME LIKE ?`;
      queryParams.push(`%${searchPart}%`);
    } else if (partName && partName !== 'ALL') {
      whereClause += ` AND QM_DEF.PART_NAME = ?`;
      queryParams.push(partName);
    }

    // Обработка поиска по дефекту
    if (searchDefect) {
      whereClause += ` AND QM_DEF.PROBLEM_TYPE LIKE ?`;
      queryParams.push(`%${searchDefect}%`);
    } else if (problemType && problemType !== 'ALL') {
      whereClause += ` AND QM_DEF.PROBLEM_TYPE = ?`;
      queryParams.push(problemType);
    }

    // Обработка множественного выбора моделей
    const modelList = (model && model !== 'ALL') ? model.split(',') : [];
    if (modelList.length > 0) {
      whereClause += ` AND wo.MODEL IN (${modelList.map(() => '?').join(',')})`;
      queryParams.push(...modelList);
    }

    // Логика смен
    const minutesExpr = `(HOUR(QM_DEF.CREATION_TIME) * 60 + MINUTE(QM_DEF.CREATION_TIME))`;
    let shiftDateExpr;
    if (shift === 'all') shiftDateExpr = `DATE(QM_DEF.CREATION_TIME)`;
    else if (shift === 'C') {
      shiftDateExpr = `CASE WHEN ${minutesExpr} BETWEEN 91 AND 469 THEN DATE(QM_DEF.CREATION_TIME) END`;
    } else if (shift === 'A') {
      shiftDateExpr = `CASE WHEN WEEKOFYEAR(QM_DEF.CREATION_TIME) % 2 = 0 THEN CASE WHEN ${minutesExpr} BETWEEN 1001 AND 1439 THEN DATE(QM_DEF.CREATION_TIME) WHEN ${minutesExpr} BETWEEN 0 AND 90 THEN DATE_SUB(DATE(QM_DEF.CREATION_TIME), INTERVAL 1 DAY) END ELSE CASE WHEN ${minutesExpr} BETWEEN 470 AND 1000 THEN DATE(QM_DEF.CREATION_TIME) END END`;
    } else if (shift === 'B') {
      shiftDateExpr = `CASE WHEN WEEKOFYEAR(QM_DEF.CREATION_TIME) % 2 = 0 THEN CASE WHEN ${minutesExpr} BETWEEN 470 AND 1000 THEN DATE(QM_DEF.CREATION_TIME) END ELSE CASE WHEN ${minutesExpr} BETWEEN 1001 AND 1439 THEN DATE(QM_DEF.CREATION_TIME) WHEN ${minutesExpr} BETWEEN 0 AND 90 THEN DATE_SUB(DATE(QM_DEF.CREATION_TIME), INTERVAL 1 DAY) END END`;
    } else shiftDateExpr = `DATE(QM_DEF.CREATION_TIME)`;

    function getISOWeekInfo(date) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      return { year: d.getUTCFullYear(), week: weekNo };
    }

    const generatePeriods = () => {
      const now = new Date();
      const periods = [];
      if (periodType === 'month') {
        for (let i = 2; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
      } else if (periodType === 'week') {
        const current = new Date(now);
        const day = current.getDay();
        const mondayOffset = day === 0 ? -6 : 1 - day;
        const thisMonday = new Date(current);
        thisMonday.setDate(current.getDate() + mondayOffset);
        thisMonday.setHours(0, 0, 0, 0);
        for (let i = 3; i >= 0; i--) {
          const weekStart = new Date(thisMonday);
          weekStart.setDate(thisMonday.getDate() - i * 7);
          const iso = getISOWeekInfo(weekStart);
          periods.push(`${iso.year}-W${String(iso.week).padStart(2, '0')}`);
        }
      } else if (periodType === 'day') {
        for (let i = 13; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(now.getDate() - i);
          periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        }
      }
      return periods;
    };

    const periods = generatePeriods();
    if (periods.length === 0) return res.json([]);

    let dateCondition = '';
    if (periodType === 'month') {
      dateCondition = `AND DATE_FORMAT(${shiftDateExpr}, '%Y-%m') IN (${periods.map(() => '?').join(',')})`;
    } else if (periodType === 'week') {
      dateCondition = `AND DATE_FORMAT(${shiftDateExpr}, '%x-W%v') IN (${periods.map(() => '?').join(',')})`;
    } else {
      dateCondition = `AND ${shiftDateExpr} IN (${periods.map(() => '?').join(',')})`;
    }

    const sql = `
      SELECT 
        ${periodType === 'month' ? `DATE_FORMAT(${shiftDateExpr}, '%Y-%m')` :
          periodType === 'week' ? `DATE_FORMAT(${shiftDateExpr}, '%x-W%v')` :
          shiftDateExpr} AS period,
        COUNT(*) AS defect_count
      FROM (
        SELECT VIN, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE 1=1
        ${whereClause}
        ${dateCondition}
      GROUP BY period
      ORDER BY period
    `;

    const [rows] = await pool.query(sql, [...queryParams, ...periods]);
    const defectMap = {};
    rows.forEach(r => { defectMap[r.period] = r.defect_count; });

    const result = [];
    for (const period of periods) {
      let carCondition = '';
      if (periodType === 'month') carCondition = `DATE_FORMAT(DATE(CREATION_TIME), '%Y-%m') = ?`;
      else if (periodType === 'week') carCondition = `DATE_FORMAT(DATE(CREATION_TIME), '%x-W%v') = ?`;
      else carCondition = `DATE(CREATION_TIME) = ?`;

      // ФИКС 2: Считаем машины только по CP72, как в основном дашборде
      let carSql = `
        SELECT COUNT(DISTINCT VIN) AS total
        FROM at_om_wiptrackinghistory
        WHERE WC_NAME IN ('CP72')
          AND ${carCondition}
      `;
      const carParams = [period];
      if (modelList.length > 0) {
        carSql += ` AND MODEL IN (${modelList.map(() => '?').join(',')})`;
        carParams.push(...modelList);
      }
      const [carRows] = await pool.query(carSql, carParams);
      const totalCars = carRows[0]?.total || 0;

      result.push({
        period,
        defect_count: defectMap[period] || 0,
        total_cars: totalCars,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Ошибка report-page-defect-trend:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ================== DAILY TOP – с новыми списками постов ==================
app.get('/api/daily-top', async (req, res) => {
  try {
    const { checkpoint, defectType, shift } = req.query;
    const type = defectType || 'default';
    const shiftMode = shift || 'all';

    const cp7Posts = [
      'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
      'REPAIR', 'REPAIR_Final',
      'EXT1', 'PIP2', 'PIP4', 'PIP9'
    ];
    const cp8Posts = [
      'CP8', 'CP8 Gate', 'CP8-gate',
      '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT','CP8 Touch Up'
    ];

    let postList = [];
    if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else postList = [...new Set([...cp7Posts, ...cp8Posts])];

    const postListStr = postList.map(p => `'${p}'`).join(',');

    let whereClause = '';
    if (type === 'offline') {
      whereClause = ` AND QM_DEF.POST_NAME IN (${postListStr}) AND QM_DEF.S_OFFLINE = 1`;
    } else if (type === 'online') {
      whereClause = ` AND QM_DEF.POST_NAME IN (${postListStr}) AND QM_DEF.S_OFFLINE = 0`;
    } else {
      whereClause = ` AND QM_DEF.POST_NAME IN (${postListStr})`;
    }

    let shiftCondition = '';
    if (shiftMode === 'day') {
      shiftCondition = `AND TIME(QM_DEF.CREATION_TIME) BETWEEN '07:50:00' AND '16:40:00'`;
    } else if (shiftMode === 'night') {
      shiftCondition = `AND (TIME(QM_DEF.CREATION_TIME) >= '16:40:00' OR TIME(QM_DEF.CREATION_TIME) < '01:30:00')`;
    }

    const query = `
      SELECT 
        QM_DEF.PART_NAME,
        QM_DEF.PROBLEM_TYPE,
        CONCAT(QM_DEF.PART_NAME, ' ', QM_DEF.PROBLEM_TYPE) AS PP,
        DATE(QM_DEF.CREATION_TIME) AS CREATION_TIME,
        wo.MODEL,
        COUNT(*) AS QTY_DEF
      FROM (
        SELECT VIN, CREATION_TIME, CHECK_POINT, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_biw_qm_defect_info
        WHERE CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        UNION ALL
        SELECT VIN, CREATION_TIME, CHECK_POINT, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_paint_qm_defect_info
        WHERE CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        UNION ALL
        SELECT VIN, CREATION_TIME, CHECK_POINT, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_qm_defect_info
        WHERE CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE 1=1 ${whereClause} ${shiftCondition}
        AND QM_DEF.PART_NAME IS NOT NULL AND TRIM(QM_DEF.PART_NAME) <> ''
        AND QM_DEF.PROBLEM_TYPE IS NOT NULL AND TRIM(QM_DEF.PROBLEM_TYPE) <> ''
        AND DATE(QM_DEF.CREATION_TIME) = CURDATE()
      GROUP BY QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE, DATE(QM_DEF.CREATION_TIME), wo.MODEL
      ORDER BY CREATION_TIME DESC
      LIMIT 5000
    `;

    const [rows] = await pool.query(query);
    const result = rows.map(row => ({
      CREATION_TIME: row.CREATION_TIME,
      MODEL: row.MODEL || 'UNKNOWN',
      PART_NAME: row.PART_NAME || '',
      PROBLEM_TYPE: row.PROBLEM_TYPE || '',
      MPP: `${row.MODEL || 'UNKNOWN'} ${row.PP}`,
      DEFECTS_COUNT: Number(row.QTY_DEF) || 0,
    }));

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА DAILY TOP:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== VIN ДЛЯ ДЕФЕКТА В DAILY TOP – с новыми списками постов ==================
app.get('/api/daily-top-vins', async (req, res) => {
  try {
    const { checkpoint, defectType, shift, partName, problemType, model } = req.query;
    if (!partName || !problemType) return res.status(400).json({ error: 'partName и problemType обязательны' });

    const type = defectType || 'default';
    const shiftMode = shift || 'all';
    const carModel = model || null;

    const cp7Posts = [
      'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
      'REPAIR', 'REPAIR_Final',
      'EXT1', 'PIP2', 'PIP4', 'PIP9'
    ];
    const cp8Posts = [
      'CP8', 'CP8 Gate', 'CP8-gate',
      '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'
    ];

    let postList = [];
    if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else postList = [...new Set([...cp7Posts, ...cp8Posts])];

    const postListStr = postList.map(p => `'${p}'`).join(',');

    let whereClause = ` AND QM_DEF.POST_NAME IN (${postListStr})`;
    if (type === 'offline') whereClause += ` AND QM_DEF.S_OFFLINE = 1`;
    else if (type === 'online') whereClause += ` AND QM_DEF.S_OFFLINE = 0`;

    let shiftCondition = '';
    if (shiftMode === 'day') {
      shiftCondition = `AND TIME(QM_DEF.CREATION_TIME) BETWEEN '07:50:00' AND '16:40:00'`;
    } else if (shiftMode === 'night') {
      shiftCondition = `AND (TIME(QM_DEF.CREATION_TIME) >= '16:40:00' OR TIME(QM_DEF.CREATION_TIME) < '01:30:00')`;
    }

    const query = `
      SELECT DISTINCT wo.VIN
      FROM (
        SELECT VIN, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_biw_qm_defect_info
        WHERE PART_NAME = ? AND PROBLEM_TYPE = ? AND DATE(CREATION_TIME) = CURDATE()
        UNION ALL
        SELECT VIN, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_paint_qm_defect_info
        WHERE PART_NAME = ? AND PROBLEM_TYPE = ? AND DATE(CREATION_TIME) = CURDATE()
        UNION ALL
        SELECT VIN, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_qm_defect_info
        WHERE PART_NAME = ? AND PROBLEM_TYPE = ? AND DATE(CREATION_TIME) = CURDATE()
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE 1=1 ${whereClause} ${shiftCondition}
        ${carModel ? `AND wo.MODEL = ?` : ''}
      ORDER BY wo.VIN
    `;

    const params = [partName, problemType, partName, problemType, partName, problemType];
    if (carModel) params.push(carModel);

    const [rows] = await pool.query(query, params);
    res.json(rows.map(r => r.VIN));
  } catch (err) {
    console.error('ОШИБКА VIN:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== MODEL STATUS – DRR (MES) ==================
app.get('/api/model-status-drr', async (req, res) => {
  try {
    const { period, count } = req.query;
    if (!period) return res.status(400).json({ error: 'period обязателен' });

    let dateFormat;
    if (period === 'month') dateFormat = '%Y-%m';
    else if (period === 'week') dateFormat = '%Y-%u';
    else if (period === 'day') dateFormat = '%Y-%m-%d';

    const defaultCount = period === 'month' ? 3 : period === 'week' ? 4 : 7;
    const limit = parseInt(count, 10) || defaultCount;

    const sql = `
      SELECT
        all_cars.MODEL,
        all_cars.PERIOD,
        all_cars.TOTAL,
        COALESCE(remzone.REMZONE_COUNT, 0) AS REMZONE_COUNT,
        ROUND(100 - COALESCE(remzone.REMZONE_COUNT, 0) * 100.0 / all_cars.TOTAL, 1) AS DRR_PERCENT
      FROM (
        SELECT
          too.product AS MODEL,
          DATE_FORMAT(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE), ?) AS PERIOD,
          COUNT(DISTINCT tvv.VIN) AS TOTAL
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
        GROUP BY MODEL, PERIOD
      ) all_cars
      LEFT JOIN (
        SELECT
          too.product AS MODEL,
          DATE_FORMAT(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE), ?) AS PERIOD,
          COUNT(DISTINCT tvv.VIN) AS REMZONE_COUNT
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN AND tvtlm.node_nature LIKE 'REP%'
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
        GROUP BY MODEL, PERIOD
      ) remzone ON all_cars.MODEL = remzone.MODEL AND all_cars.PERIOD = remzone.PERIOD
      WHERE all_cars.TOTAL > 0
      ORDER BY all_cars.PERIOD, all_cars.MODEL
    `;

    const [rows] = await mesPool.query(sql, [dateFormat, dateFormat]);

    const periodsMap = {};
    rows.forEach(row => {
      const p = row.PERIOD;
      if (!periodsMap[p]) {
        periodsMap[p] = { period: p, target: 80, values: {} };
      }
      periodsMap[p].values[row.MODEL] = row.DRR_PERCENT;
    });

    const sortedPeriods = Object.keys(periodsMap).sort();
    const recentPeriods = sortedPeriods.slice(-limit);
    const result = recentPeriods.map(p => periodsMap[p]);

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА DRR (MES):', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== MODEL STATUS – DPU CP8 (OFFLINE, CPFINAL) ==================
app.get('/api/model-status-dpu-cp8', async (req, res) => {
  try {
    const { period, count } = req.query;
    if (!period) return res.status(400).json({ error: 'period обязателен' });

    let dateFormat;
    if (period === 'month') dateFormat = '%Y-%m';
    else if (period === 'week') dateFormat = '%Y-%u';
    else if (period === 'day') dateFormat = '%Y-%m-%d';

    const defaultCount = period === 'month' ? 3 : period === 'week' ? 4 : 7;
    const limit = parseInt(count, 10) || defaultCount;

    // Посты CP8 + Test Line (офлайн-дефекты и учёт авто)
    const cp8tlPosts = [
      'CP8', 'CP8 Gate', 'CP8-gate',
      '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT'
    ];
    const postListStr = cp8tlPosts.map(p => `'${p}'`).join(',');

    const sql = `
      SELECT 
        MODEL,
        DATE_FORMAT(CREATION_TIME, ?) AS PERIOD,
        SUM(VIN_C) AS TOTAL_CARS,
        SUM(DEF_C) AS TOTAL_DEFECTS,
        ROUND(SUM(DEF_C) / SUM(VIN_C), 2) AS DPU
      FROM (
        SELECT 
          aowth.MODEL,
          DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)) AS CREATION_TIME,
          COUNT(DISTINCT aowth.VIN) AS VIN_C,
          COUNT(QM_DEF.VIN) AS DEF_C
        FROM at_om_wiptrackinghistory aowth
        JOIN (
          SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_qm_defect_info
        ) QM_DEF ON QM_DEF.VIN = aowth.VIN AND QM_DEF.S_OFFLINE = 1
        WHERE aowth.WC_NAME IN (${postListStr})
        GROUP BY aowth.MODEL, CREATION_TIME
      ) CARS
      GROUP BY MODEL, PERIOD
      ORDER BY PERIOD, MODEL
    `;

    const [rows] = await pool.query(sql, [dateFormat]);

    const allModels = [...new Set(rows.map(r => r.MODEL))].sort();
    const periodsMap = {};
    rows.forEach(row => {
      const p = row.PERIOD;
      if (!periodsMap[p]) {
        periodsMap[p] = { period: p, target: 2, values: {} };
      }
      periodsMap[p].values[row.MODEL] = row.DPU;
    });

    Object.values(periodsMap).forEach(entry => {
      allModels.forEach(m => {
        if (!(m in entry.values)) entry.values[m] = 0;
      });
    });

    const sortedPeriods = Object.keys(periodsMap).sort();
    const recentPeriods = sortedPeriods.slice(-limit);
    const result = recentPeriods.map(p => periodsMap[p]);

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА DPU CP8:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== MODEL STATUS – DRR CP7 ==================
app.get('/api/model-status-drr-cp7', async (req, res) => {
  try {
    const { period, count } = req.query;
    if (!period) return res.status(400).json({ error: 'period обязателен' });

    let dateFormat;
    if (period === 'month') dateFormat = '%Y-%m';
    else if (period === 'week') dateFormat = '%Y-%u';
    else if (period === 'day') dateFormat = '%Y-%m-%d';

    const defaultCount = period === 'month' ? 3 : period === 'week' ? 4 : 7;
    const limit = parseInt(count, 10) || defaultCount;

    const sql = `
      SELECT
        all_cars.MODEL,
        all_cars.PERIOD,
        all_cars.TOTAL,
        COALESCE(remzone.REMZONE_COUNT, 0) AS REMZONE_COUNT,
        ROUND(100 - COALESCE(remzone.REMZONE_COUNT, 0) * 100.0 / all_cars.TOTAL, 1) AS DRR_PERCENT
      FROM (
        SELECT
          too.product AS MODEL,
          DATE_FORMAT(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE), ?) AS PERIOD,
          COUNT(DISTINCT tvv.VIN) AS TOTAL
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CP7'
        GROUP BY MODEL, PERIOD
      ) all_cars
      LEFT JOIN (
        SELECT
          too.product AS MODEL,
          DATE_FORMAT(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE), ?) AS PERIOD,
          COUNT(DISTINCT tvv.VIN) AS REMZONE_COUNT
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CP7'
          AND tvv.VIN IN (
            SELECT DISTINCT tvtlm.VIN
            FROM tm_vhc_test_line_movement tvtlm
            WHERE tvtlm.node_nature LIKE 'REP%'
          )
        GROUP BY MODEL, PERIOD
      ) remzone ON all_cars.MODEL = remzone.MODEL AND all_cars.PERIOD = remzone.PERIOD
      WHERE all_cars.TOTAL > 0
      ORDER BY all_cars.PERIOD, all_cars.MODEL
    `;

    const [rows] = await mesPool.query(sql, [dateFormat, dateFormat]);

    const allModels = [...new Set(rows.map(r => r.MODEL))].sort();
    const periodsMap = {};
    rows.forEach(row => {
      const p = row.PERIOD;
      if (!periodsMap[p]) {
        periodsMap[p] = { period: p, target: 80, values: {} };
      }
      periodsMap[p].values[row.MODEL] = row.DRR_PERCENT;
    });

    Object.values(periodsMap).forEach(entry => {
      allModels.forEach(m => {
        if (!(m in entry.values)) entry.values[m] = 0;
      });
    });

    const sortedPeriods = Object.keys(periodsMap).sort();
    const recentPeriods = sortedPeriods.slice(-limit);
    const result = recentPeriods.map(p => periodsMap[p]);

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА DRR CP7:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== MODEL STATUS – DPU CP7 (OFFLINE, посты CP7) ==================
app.get('/api/model-status-dpu-cp7', async (req, res) => {
  try {
    const { period, count } = req.query;
    if (!period) return res.status(400).json({ error: 'period обязателен' });

    let dateFormat;
    if (period === 'month') dateFormat = '%Y-%m';
    else if (period === 'week') dateFormat = '%Y-%u';
    else if (period === 'day') dateFormat = '%Y-%m-%d';

    const defaultCount = period === 'month' ? 3 : period === 'week' ? 4 : 7;
    const limit = parseInt(count, 10) || defaultCount;

    // Посты CP7 + PIP (офлайн-дефекты и учёт авто)
    const cp7pipPosts = [
      'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
      'PIP1', 'PIP2', 'PIP9',
    ];
    const postListStr = cp7pipPosts.map(p => `'${p}'`).join(',');

    const sql = `
      SELECT 
        MODEL,
        DATE_FORMAT(CREATION_TIME, ?) AS PERIOD,
        SUM(VIN_C) AS TOTAL_CARS,
        SUM(DEF_C) AS TOTAL_DEFECTS,
        ROUND(SUM(DEF_C) / SUM(VIN_C), 2) AS DPU
      FROM (
        SELECT 
          aowth.MODEL,
          DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)) AS CREATION_TIME,
          COUNT(DISTINCT aowth.VIN) AS VIN_C,
          COUNT(QM_DEF.VIN) AS DEF_C
        FROM at_om_wiptrackinghistory aowth
        JOIN (
          SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_qm_defect_info
          UNION ALL
          SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_biw_qm_defect_info
          UNION ALL
          SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_paint_qm_defect_info
        ) QM_DEF ON QM_DEF.VIN = aowth.VIN AND QM_DEF.S_OFFLINE = 1
        WHERE aowth.WC_NAME IN (${postListStr})
        GROUP BY aowth.MODEL, CREATION_TIME
      ) CARS
      GROUP BY MODEL, PERIOD
      ORDER BY PERIOD, MODEL
    `;

    const [rows] = await pool.query(sql, [dateFormat]);

    const allModels = [...new Set(rows.map(r => r.MODEL))].sort();
    const periodsMap = {};
    rows.forEach(row => {
      const p = row.PERIOD;
      if (!periodsMap[p]) {
        periodsMap[p] = { period: p, target: 2, values: {} };
      }
      periodsMap[p].values[row.MODEL] = row.DPU;
    });

    Object.values(periodsMap).forEach(entry => {
      allModels.forEach(m => {
        if (!(m in entry.values)) entry.values[m] = 0;
      });
    });

    const sortedPeriods = Object.keys(periodsMap).sort();
    const recentPeriods = sortedPeriods.slice(-limit);
    const result = recentPeriods.map(p => periodsMap[p]);

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА DPU CP7:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ДЕТАЛИ DPU CP7 ==================
app.get('/api/model-status-dpu-cp7-details', async (req, res) => {
  try {
    const { model, periods, periodType } = req.query;
    if (!periods) return res.status(400).json({ error: 'periods обязателен' });

    const periodList = periods.split(',').map(p => p.trim()).filter(Boolean);
    if (periodList.length === 0) return res.status(400).json({ error: 'periods пуст' });

    let dateCondition;
    if (periodType === 'month') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)), '%Y-%m') IN (${periodList.map(() => '?').join(',')})`;
    } else if (periodType === 'week') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)), '%Y-%u') IN (${periodList.map(() => '?').join(',')})`;
    } else {
      dateCondition = `DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)) IN (${periodList.map(() => '?').join(',')})`;
    }

    // Новый список постов CP7
    const cp7Posts = [
      'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
      'REPAIR', 'REPAIR_Final',
      'EXT1', 'PIP2', 'PIP4', 'PIP9'
    ];
    const postListStr = cp7Posts.map(p => `'${p}'`).join(',');

    let sql = `
      SELECT DISTINCT aowth.VIN, aowth.MODEL, DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)) AS DATE,
             QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE
      FROM at_om_wiptrackinghistory aowth
      JOIN (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_paint_qm_defect_info
      ) QM_DEF ON QM_DEF.VIN = aowth.VIN AND QM_DEF.S_OFFLINE = 1
      WHERE ${dateCondition}
        AND aowth.WC_NAME IN (${postListStr})
    `;
    const params = [...periodList];

    if (model) {
      sql += ` AND aowth.MODEL = ?`;
      params.push(model);
    }

    sql += ` ORDER BY aowth.VIN`;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('DPU CP7 Details:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ДЕТАЛИ DRR CP7 ==================
app.get('/api/model-status-drr-cp7-details', async (req, res) => {
  try {
    const { model, periods, periodType } = req.query;
    if (!periods) return res.status(400).json({ error: 'periods обязателен' });

    const periodList = periods.split(',').map(p => p.trim()).filter(Boolean);
    if (periodList.length === 0) return res.status(400).json({ error: 'periods пуст' });

    let dateCondition;
    if (periodType === 'month') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)), '%Y-%m') IN (${periodList.map(() => '?').join(',')})`;
    } else if (periodType === 'week') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)), '%Y-%u') IN (${periodList.map(() => '?').join(',')})`;
    } else {
      dateCondition = `DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) IN (${periodList.map(() => '?').join(',')})`;
    }

    let sql = `
      SELECT tvv.VIN, too.product AS MODEL, DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) AS DATE,
             IF(MAX(tvtlm.id) IS NOT NULL, 'В ремзоне', 'Без ремзоны') AS REMZONE_STATUS
      FROM tm_vhc_vehicle tvv
      JOIN tm_ofm_order too ON too.VIN = tvv.VIN
      JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
      LEFT JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN AND tvtlm.node_nature LIKE 'REP%'
      WHERE tvvm.node_nature = 'Key_Uloc_Type_CP7'
        AND ${dateCondition}
    `;
    const params = [...periodList];

    if (model) {
      sql += ` AND too.product = ?`;
      params.push(model);
    }

    sql += ` GROUP BY tvv.VIN, too.product, DATE ORDER BY tvv.VIN`;

    const [rows] = await mesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('DRR CP7 Details:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ДЕТАЛИ DPU CP8 ==================
app.get('/api/model-status-dpu-cp8-details', async (req, res) => {
  try {
    const { model, periods, periodType } = req.query;
    if (!periods) return res.status(400).json({ error: 'periods обязателен' });

    const periodList = periods.split(',').map(p => p.trim()).filter(Boolean);
    if (periodList.length === 0) return res.status(400).json({ error: 'periods пуст' });

    let dateCondition;
    if (periodType === 'month') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)), '%Y-%m') IN (${periodList.map(() => '?').join(',')})`;
    } else if (periodType === 'week') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)), '%Y-%u') IN (${periodList.map(() => '?').join(',')})`;
    } else {
      dateCondition = `DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)) IN (${periodList.map(() => '?').join(',')})`;
    }

    let sql = `
      SELECT DISTINCT aowth.VIN, aowth.MODEL, DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)) AS DATE,
             QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE
      FROM at_om_wiptrackinghistory aowth
      JOIN (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_qm_defect_info
      ) QM_DEF ON QM_DEF.VIN = aowth.VIN AND QM_DEF.S_OFFLINE = 1
      WHERE ${dateCondition}
        AND aowth.WC_NAME = 'CPFINAL'
    `;
    const params = [...periodList];

    if (model) {
      sql += ` AND aowth.MODEL = ?`;
      params.push(model);
    }

    sql += ` ORDER BY aowth.VIN`;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('DPU CP8 Details:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ДЕТАЛИ DRR CP8 ==================
app.get('/api/model-status-drr-cp8-details', async (req, res) => {
  try {
    const { model, periods, periodType } = req.query;
    if (!periods) return res.status(400).json({ error: 'periods обязателен' });

    const periodList = periods.split(',').map(p => p.trim()).filter(Boolean);
    if (periodList.length === 0) return res.status(400).json({ error: 'periods пуст' });

    let dateCondition;
    if (periodType === 'month') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)), '%Y-%m') IN (${periodList.map(() => '?').join(',')})`;
    } else if (periodType === 'week') {
      dateCondition = `DATE_FORMAT(DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)), '%Y-%u') IN (${periodList.map(() => '?').join(',')})`;
    } else {
      dateCondition = `DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) IN (${periodList.map(() => '?').join(',')})`;
    }

    let sql = `
      SELECT tvv.VIN, too.product AS MODEL, DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) AS DATE,
             IF(MAX(tvtlm.id) IS NOT NULL, 'В ремзоне', 'Без ремзоны') AS REMZONE_STATUS
      FROM tm_vhc_vehicle tvv
      JOIN tm_ofm_order too ON too.VIN = tvv.VIN
      JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
      LEFT JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN AND tvtlm.node_nature LIKE 'REP%'
      WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
        AND ${dateCondition}
    `;
    const params = [...periodList];

    if (model) {
      sql += ` AND too.product = ?`;
      params.push(model);
    }

    sql += ` GROUP BY tvv.VIN, too.product, DATE ORDER BY tvv.VIN`;

    const [rows] = await mesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('DRR CP8 Details:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ДАННЫЕ ПО КОМПЛЕКТАЦИЯМ (DPU & DRR) ==================
// ================== ДАННЫЕ ПО КОМПЛЕКТАЦИЯМ (DPU & DRR) ==================
app.get('/api/model-status-complectations-daily', async (req, res) => {
  // --- DRR по комплектациям (всё в MES через mesPool) ---
  const fetchDrrComplectations = async (nodeNature) => {
    const [rows] = await mesPool.query(`
      SELECT
        TRIM(all_cars.MODEL) AS model,
        IFNULL(TRIM(tbmr.material_desc), 'Не указана') AS complectation,
        DATE_FORMAT(all_cars.PERIOD_DATE, '%Y-%m-%d') AS period,
        ROUND(100 - IFNULL(remzone.REMZONE_COUNT, 0) * 100.0 / NULLIF(all_cars.TOTAL, 0), 1) AS value
      FROM (
        SELECT too.product AS MODEL, too.material_no,
               DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) AS PERIOD_DATE,
               COUNT(DISTINCT tvv.VIN) AS TOTAL
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = ?
          AND tvvm.scan_time >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        GROUP BY too.product, too.material_no, PERIOD_DATE
      ) all_cars
      LEFT JOIN (
        SELECT too.product AS MODEL, too.material_no,
               DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) AS PERIOD_DATE,
               COUNT(DISTINCT tvv.VIN) AS REMZONE_COUNT
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = ?
          AND tvvm.scan_time >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
          AND tvv.VIN IN (SELECT DISTINCT VIN FROM tm_vhc_test_line_movement WHERE node_nature LIKE 'REP%')
        GROUP BY too.product, too.material_no, PERIOD_DATE
      ) remzone ON all_cars.MODEL = remzone.MODEL
               AND all_cars.material_no = remzone.material_no
               AND all_cars.PERIOD_DATE = remzone.PERIOD_DATE
      LEFT JOIN tm_bas_material_relation tbmr
        ON tbmr.material_no = all_cars.material_no AND tbmr.is_deleted = 0
      WHERE all_cars.TOTAL > 0
    `, [nodeNature, nodeNature]);
    return rows;
  };

  // --- DPU по комплектациям (pool для фактов + mesPool для complectation + склейка) ---
  const fetchDpuComplectations = async (wcList, includeAllSources) => {
    const wcStr = wcList.map(w => `'${w}'`).join(',');
    const defectUnion = includeAllSources
      ? `SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_qm_defect_info
         UNION ALL SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) FROM at_biw_qm_defect_info
         UNION ALL SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) FROM at_paint_qm_defect_info`
      : `SELECT VIN, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE FROM at_qm_defect_info`;

    const [facts] = await pool.query(`
      SELECT
        aowth.VIN,
        TRIM(aowth.MODEL) AS model,
        DATE_FORMAT(DATE(DATE_SUB(aowth.CREATION_TIME, INTERVAL 470 MINUTE)), '%Y-%m-%d') AS d,
        COUNT(QM_DEF.VIN) AS DEF_C
      FROM at_om_wiptrackinghistory aowth
      JOIN (${defectUnion}) QM_DEF ON QM_DEF.VIN = aowth.VIN AND QM_DEF.S_OFFLINE = 1
      WHERE aowth.WC_NAME IN (${wcStr})
        AND aowth.CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
      GROUP BY aowth.VIN, aowth.MODEL, d
    `);

    if (facts.length === 0) return [];

    const vins = [...new Set(facts.map(r => r.VIN))];
    const chunkSize = 2000;
    const vinToComp = {};
    for (let i = 0; i < vins.length; i += chunkSize) {
      const chunk = vins.slice(i, i + chunkSize);
      const [mats] = await mesPool.query(`
        SELECT tvv.VIN,
               IFNULL(TRIM(tbmr.material_desc), 'Не указана') AS complectation
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        LEFT JOIN tm_bas_material_relation tbmr
          ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
        WHERE tvv.VIN IN (?)
      `, [chunk]);
      mats.forEach(m => { vinToComp[m.VIN] = m.complectation; });
    }

    const agg = {};
    facts.forEach(f => {
      const comp = vinToComp[f.VIN] || 'Не указана';
      const key = `${f.model}|${comp}|${f.d}`;
      if (!agg[key]) {
        agg[key] = { model: f.model, complectation: comp, period: f.d, vinCount: 0, defSum: 0 };
      }
      agg[key].vinCount += 1;
      agg[key].defSum += Number(f.DEF_C) || 0;
    });

    return Object.values(agg).map(a => ({
      model: a.model,
      complectation: a.complectation,
      period: a.period,
      value: a.vinCount > 0 ? +(a.defSum / a.vinCount).toFixed(2) : 0,
    }));
  };

  try {
    let cp7Dpu = [], cp8Dpu = [], cp7Drr = [], cp8Drr = [];

    try {
      cp7Dpu = await fetchDpuComplectations(
        ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'PIP1', 'PIP2', 'PIP9'], true
      );
    } catch (e) { console.error('CP7 DPU ERROR:', e.message); }

    try {
      cp8Dpu = await fetchDpuComplectations(
        ['CP8', 'CP8 Gate', 'CP8-gate', '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT'], false
      );
    } catch (e) { console.error('CP8 DPU ERROR:', e.message); }

    try { cp7Drr = await fetchDrrComplectations('Key_Uloc_Type_CP7'); }
    catch (e) { console.error('CP7 DRR ERROR:', e.message); }

    try { cp8Drr = await fetchDrrComplectations('Key_Uloc_Type_CPFINAL'); }
    catch (e) { console.error('CP8 DRR ERROR:', e.message); }

    res.json({ cp7Dpu, cp8Dpu, cp7Drr, cp8Drr });
  } catch (err) {
    console.error('Общая ошибка комплектаций:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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


// ================== CHECKPOINT MAP – СТАТИСТИКА ==================
app.get('/api/checkpoint-stats', async (req, res) => {
  try {
    const { dateFrom, dateTo, model, defectType } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });

    const type = defectType || 'all';

    const pipPostsAll = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
    const cp7PostsAll = ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'REPAIR', 'REPAIR_Final', 'EXT1', 'PIP2', 'PIP4', 'PIP9'];
    const tlPostsAll  = ['360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT','CP8 Touch Up'];
    const cp8PostsAll = ['CP8', 'CP8 Gate', 'CP8-gate'];

    const checkpoints = [
      { id: 'PIP', posts: pipPostsAll },
      { id: 'CP7', posts: cp7PostsAll },
      { id: 'TL',  posts: tlPostsAll  },
      { id: 'CP8', posts: cp8PostsAll }
    ];

    const results = [];

    for (const cp of checkpoints) {
      const postListStr = cp.posts.map(p => `'${p}'`).join(',');

      // Общее количество VIN, прошедших посты (для информации)
      let totalSql = `
        SELECT COUNT(DISTINCT VIN) AS TOTAL
        FROM at_om_wiptrackinghistory
        WHERE WC_NAME IN (${postListStr})
          AND DATE(CREATION_TIME) BETWEEN ? AND ?
      `;
      const totalParams = [dateFrom, dateTo];
      if (model) { totalSql += ` AND MODEL = ?`; totalParams.push(model); }
      const [[{ TOTAL }]] = await pool.query(totalSql, totalParams);
      const totalVins = TOTAL || 0;

      // Офлайн VIN (независимый подсчёт)
      let offlineSql = `
        SELECT COUNT(DISTINCT QM_DEF.VIN) AS OFFLINE
        FROM (
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_biw_qm_defect_info
          UNION ALL
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_paint_qm_defect_info
          UNION ALL
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_qm_defect_info
        ) QM_DEF
        JOIN work_order wo ON wo.VIN = QM_DEF.VIN
        WHERE QM_DEF.POST_NAME IN (${postListStr})
          AND QM_DEF.S_OFFLINE = 1
          AND QM_DEF.CREATION_DATE BETWEEN ? AND ?
      `;
      const offlineParams = [dateFrom, dateTo];
      if (model) { offlineSql += ` AND wo.MODEL = ?`; offlineParams.push(model); }
      const [[{ OFFLINE }]] = await pool.query(offlineSql, offlineParams);
      let offlineVins = OFFLINE || 0;

      // Онлайн VIN (независимый подсчёт)
      let onlineSql = `
        SELECT COUNT(DISTINCT QM_DEF.VIN) AS ONLINE
        FROM (
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_biw_qm_defect_info
          UNION ALL
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_paint_qm_defect_info
          UNION ALL
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_qm_defect_info
        ) QM_DEF
        JOIN work_order wo ON wo.VIN = QM_DEF.VIN
        WHERE QM_DEF.POST_NAME IN (${postListStr})
          AND QM_DEF.S_OFFLINE = 0
          AND QM_DEF.CREATION_DATE BETWEEN ? AND ?
      `;
      const onlineParams = [dateFrom, dateTo];
      if (model) { onlineSql += ` AND wo.MODEL = ?`; onlineParams.push(model); }
      const [[{ ONLINE }]] = await pool.query(onlineSql, onlineParams);
      let onlineVins = ONLINE || 0;

      // Применяем фильтр типа дефектов
      if (type === 'offline') {
        onlineVins = 0;
      } else if (type === 'online') {
        offlineVins = 0;
      }

      results.push({
        checkpoint: cp.id,
        posts: cp.posts,
        totalVins,
        offlineVins,
        onlineVins
      });
    }

    res.json(results);
  } catch (err) {
    console.error('ОШИБКА checkpoint-stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ================== CHECKPOINT DEFECTS (для Checkpoint Map) ==================
app.get('/api/checkpoint-stats', async (req, res) => {
  try {
    const { dateFrom, dateTo, model, defectType } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });

    const type = defectType || 'all';

    // Списки постов
    const pipPostsPure = ['EXT1', 'PIP1', 'PIP5', 'PIP6', 'PIP8'];
    const pipPostsAll  = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
    const cp7PostsAll  = ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'REPAIR', 'REPAIR_Final', 'EXT1', 'PIP2', 'PIP4', 'PIP9'];
    const tlPostsAll   = ['360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT','CP8 Touch Up'];
    const cp8PostsAll  = ['CP8', 'CP8 Gate', 'CP8-gate'];

    // Вспомогательная функция: подсчёт уникальных VIN с офлайн-дефектами на заданном списке постов
    async function getOfflineVins(postList) {
      if (!postList.length) return 0;
      const postStr = postList.map(p => `'${p}'`).join(',');
      let sql = `
        SELECT COUNT(DISTINCT QM_DEF.VIN) AS OFFLINE
        FROM (
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_biw_qm_defect_info
          UNION ALL
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_paint_qm_defect_info
          UNION ALL
          SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_qm_defect_info
        ) QM_DEF
        JOIN work_order wo ON wo.VIN = QM_DEF.VIN
        WHERE QM_DEF.POST_NAME IN (${postStr})
          AND QM_DEF.S_OFFLINE = 1
          AND QM_DEF.CREATION_DATE BETWEEN ? AND ?
      `;
      const params = [dateFrom, dateTo];
      if (model) { sql += ` AND wo.MODEL = ?`; params.push(model); }
      const [[{ OFFLINE }]] = await pool.query(sql, params);
      return OFFLINE || 0;
    }

    // Общее количество VIN, прошедших посты чекпоинта (для онлайн)
    async function getTotalVins(postList) {
      if (!postList.length) return 0;
      const postStr = postList.map(p => `'${p}'`).join(',');
      let sql = `
        SELECT COUNT(DISTINCT VIN) AS TOTAL
        FROM at_om_wiptrackinghistory
        WHERE WC_NAME IN (${postStr})
          AND DATE(CREATION_TIME) BETWEEN ? AND ?
      `;
      const params = [dateFrom, dateTo];
      if (model) { sql += ` AND MODEL = ?`; params.push(model); }
      const [[{ TOTAL }]] = await pool.query(sql, params);
      return TOTAL || 0;
    }

    // Специальный подсчёт для CP8 – только авто, прошедшие ремзону
    async function getCp8RemzoneOffline() {
      const cp8Str = cp8PostsAll.map(p => `'${p}'`).join(',');
      let sql = `
        SELECT COUNT(DISTINCT cp8.VIN) AS OFFLINE
        FROM (
          SELECT DISTINCT QM_DEF.VIN
          FROM (
            SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                   (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
            FROM at_biw_qm_defect_info
            UNION ALL
            SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                   (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
            FROM at_paint_qm_defect_info
            UNION ALL
            SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
                   (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
            FROM at_qm_defect_info
          ) QM_DEF
          JOIN work_order wo ON wo.VIN = QM_DEF.VIN
          JOIN at_om_wiptrackinghistory aowth ON aowth.VIN = wo.VIN
          WHERE QM_DEF.POST_NAME IN (${cp8Str})
            AND QM_DEF.S_OFFLINE = 1
            AND QM_DEF.CREATION_DATE BETWEEN ? AND ?
            AND aowth.WC_NAME IN (${cp8Str})
            AND DATE(aowth.CREATION_TIME) BETWEEN ? AND ?
        ) cp8
        WHERE cp8.VIN IN (
          SELECT DISTINCT tvtlm.VIN
          FROM tm_vhc_test_line_movement tvtlm
          WHERE tvtlm.node_nature LIKE 'REP%'
        )
      `;
      const params = [dateFrom, dateTo, dateFrom, dateTo];
      const [[{ OFFLINE }]] = await mesPool.query(sql, params);
      return OFFLINE || 0;
    }

    // Накопительный подсчёт офлайн-авто
    const pipOffline = await getOfflineVins(pipPostsPure);
    const cp7Offline = await getOfflineVins([...pipPostsPure, ...cp7PostsAll]);
    const tlOffline = await getOfflineVins([...pipPostsPure, ...cp7PostsAll, ...tlPostsAll]);
    const cp8Offline = await getCp8RemzoneOffline();

    // Общие количества для онлайн
    const pipTotal = await getTotalVins(pipPostsAll);
    const cp7Total = await getTotalVins(cp7PostsAll);
    const tlTotal = await getTotalVins(tlPostsAll);
    const cp8Total = await getTotalVins(cp8PostsAll);

    let result = [
      {
        checkpoint: 'PIP',
        posts: pipPostsAll,
        totalVins: pipTotal,
        offlineVins: pipOffline,
        onlineVins: Math.max(pipTotal - pipOffline, 0),
        inheritedOffline: 0
      },
      {
        checkpoint: 'CP7',
        posts: cp7PostsAll,
        totalVins: cp7Total,
        offlineVins: cp7Offline,
        onlineVins: Math.max(cp7Total - cp7Offline, 0),
        inheritedOffline: pipOffline   // пришло с PIP
      },
      {
        checkpoint: 'TL',
        posts: tlPostsAll,
        totalVins: tlTotal,
        offlineVins: tlOffline,
        onlineVins: Math.max(tlTotal - tlOffline, 0),
        inheritedOffline: cp7Offline   // пришло с CP7
      },
      {
        checkpoint: 'CP8',
        posts: cp8PostsAll,
        totalVins: cp8Total,
        offlineVins: cp8Offline,
        onlineVins: Math.max(cp8Total - cp8Offline, 0),
        inheritedOffline: 0            // все новые, из ремзоны
      }
    ];

    // Применяем фильтр по типу дефектов для отображения
    if (type === 'offline') {
      result = result.map(r => ({ ...r, onlineVins: 0 }));
    } else if (type === 'online') {
      result = result.map(r => ({ ...r, offlineVins: 0, inheritedOffline: 0 }));
    }

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА checkpoint-stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/checkpoint-defects', async (req, res) => {
  try {
    const { checkpoint, defectType, dateFrom, dateTo, model } = req.query;
    if (!checkpoint || !dateFrom || !dateTo) return res.status(400).json({ error: 'checkpoint, dateFrom, dateTo обязательны' });

    const type = defectType || 'all';

    // Базовые списки
    const pipPostsAll   = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
    const pipPostsPure  = ['EXT1', 'PIP1', 'PIP5', 'PIP6', 'PIP8'];
    const cp7PostsAll   = ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'REPAIR', 'REPAIR_Final', 'EXT1', 'PIP2', 'PIP4', 'PIP9'];
    const tlPostsAll    = ['360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT','CP8 Touch Up'];
    const cp8PostsAll   = ['CP8', 'CP8 Gate', 'CP8-gate'];

    let postList;
    if (checkpoint === 'PIP') {
      // Для PIP: при 'offline' исключаем общие посты, при 'online' и 'all' – полный список
      if (type === 'offline') postList = pipPostsPure;
      else postList = pipPostsAll;
    } else if (checkpoint === 'CP7') postList = cp7PostsAll;
    else if (checkpoint === 'TL')  postList = tlPostsAll;
    else if (checkpoint === 'CP8') postList = cp8PostsAll;
    else return res.status(400).json({ error: 'Неверный checkpoint' });

    const postListStr = postList.map(p => `'${p}'`).join(',');

    let typeCondition = '';
    if (type === 'offline') typeCondition = ' AND QM_DEF.S_OFFLINE = 1';
    else if (type === 'online') typeCondition = ' AND QM_DEF.S_OFFLINE = 0';

    const params = [dateFrom, dateTo];
    let modelCondition = '';
    if (model && model !== 'ALL') {
      modelCondition = ' AND wo.MODEL = ?';
      params.push(model);
    }

    const query = `
      SELECT 
        QM_DEF.PART_NAME,
        QM_DEF.PROBLEM_TYPE,
        CONCAT(QM_DEF.PART_NAME, ' ', QM_DEF.PROBLEM_TYPE) AS PP,
        wo.MODEL,
        COUNT(*) AS QTY_DEF
      FROM (
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE QM_DEF.POST_NAME IN (${postListStr})
        ${typeCondition}
        AND QM_DEF.CREATION_DATE BETWEEN ? AND ?
        ${modelCondition}
        AND QM_DEF.PART_NAME IS NOT NULL AND TRIM(QM_DEF.PART_NAME) <> ''
        AND QM_DEF.PROBLEM_TYPE IS NOT NULL AND TRIM(QM_DEF.PROBLEM_TYPE) <> ''
      GROUP BY QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE, wo.MODEL
      ORDER BY QTY_DEF DESC
      LIMIT 10
    `;

    const [rows] = await pool.query(query, params);
    const result = rows.map(row => ({
      MPP: `${row.MODEL || 'UNKNOWN'} ${row.PP}`,
      DEFECTS_COUNT: Number(row.QTY_DEF) || 0,
    }));

    res.json(result);
  } catch (err) {
    console.error('ОШИБКА checkpoint-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/remzone-stats', async (req, res) => {
  try {
    const { dateFrom, dateTo, model } = req.query;
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });
    }

    // 1. Все VIN, прошедшие CP7 за период (без лишних преобразований времени)
    // При необходимости поправьте часовой пояс (470 минут), если tvvm.scan_time в UTC.
    // Пока используем простое условие по дате.
    const baseQuery = `
      SELECT tvv.VIN, too.product AS MODEL
      FROM tm_vhc_vehicle tvv
      JOIN tm_ofm_order too ON too.VIN = tvv.VIN
      JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
      WHERE tvvm.node_nature = 'Key_Uloc_Type_CP7'
        AND DATE(tvvm.scan_time) BETWEEN ? AND ?
    `;

    // 2. Считаем, сколько из них были в ремзоне (есть запись в tm_vhc_test_line_movement с 'REP%')
    const query = `
      SELECT cp7.MODEL, COUNT(DISTINCT cp7.VIN) AS REMZONE_COUNT
      FROM (${baseQuery}) cp7
      WHERE cp7.VIN IN (
        SELECT DISTINCT tvtlm.VIN
        FROM tm_vhc_test_line_movement tvtlm
        WHERE tvtlm.node_nature LIKE 'REP%'
      )
      ${model && model !== 'ALL' ? 'AND cp7.MODEL = ?' : ''}
      GROUP BY cp7.MODEL
      ORDER BY cp7.MODEL
    `;

    const params = [dateFrom, dateTo];
    if (model && model !== 'ALL') {
      // Параметр для модели добавляется в WHERE после IN, поэтому он третий
      // Лучше перестроить, чтобы было безопасно:
      // Используем параметризованный запрос с явным условием
    }

    // Для простоты перепишем с явной подстановкой параметров
    let finalQuery = `
      SELECT cp7.MODEL, COUNT(DISTINCT cp7.VIN) AS REMZONE_COUNT
      FROM (
        SELECT tvv.VIN, too.product AS MODEL
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CP7'
          AND DATE(tvvm.scan_time) BETWEEN ? AND ?
      ) cp7
      WHERE cp7.VIN IN (
        SELECT DISTINCT tvtlm.VIN
        FROM tm_vhc_test_line_movement tvtlm
        WHERE tvtlm.node_nature LIKE 'REP%'
      )
    `;
    const finalParams = [dateFrom, dateTo];

    if (model && model !== 'ALL') {
      finalQuery += ' AND cp7.MODEL = ?';
      finalParams.push(model);
    }

    finalQuery += ' GROUP BY cp7.MODEL ORDER BY cp7.MODEL';

    const [rows] = await mesPool.query(finalQuery, finalParams);
    res.json(rows);
  } catch (err) {
    console.error('ОШИБКА remzone-stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/remzone-tl-stats', async (req, res) => {
  try {
    const { dateFrom, dateTo, model } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });

    // Авто, прошедшие TL и попавшие в ремзону
    const query = `
      SELECT cp.MODEL, COUNT(DISTINCT cp.VIN) AS REMZONE_COUNT
      FROM (
        SELECT tvv.VIN, too.product AS MODEL
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_TL'
          AND DATE(tvvm.scan_time) BETWEEN ? AND ?
      ) cp
      WHERE cp.VIN IN (
        SELECT DISTINCT tvtlm.VIN
        FROM tm_vhc_test_line_movement tvtlm
        WHERE tvtlm.node_nature LIKE 'REP%'
      )
      ${model && model !== 'ALL' ? 'AND cp.MODEL = ?' : ''}
      GROUP BY cp.MODEL
      ORDER BY cp.MODEL
    `;
    const params = [dateFrom, dateTo];
    if (model && model !== 'ALL') params.push(model);
    const [rows] = await mesPool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('ОШИБКА remzone-tl-stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== НОВЫЕ ЭНДПОИНТЫ ДЛЯ СГП АУДИТ ==================

// Получить список VIN, прошедших чекпоинт (упрощённый вариант)
app.get('/api/sgp-audit-vins', async (req, res) => {
  try {
    const { checkpoint, dateFrom, dateTo, model } = req.query;
    if (!checkpoint || !dateFrom || !dateTo) {
      return res.status(400).json({ error: 'checkpoint, dateFrom, dateTo обязательны' });
    }

    const allNodes = [
      'Key_Uloc_Type_TRIMIN',
      'Key_Uloc_Type_CP7',
      'Key_Uloc_Type_CP72',
      'Key_Uloc_Type_CPFINAL',
      'Key_Uloc_Type_CP8'
    ];
    
    if (!allNodes.includes(checkpoint)) {
      return res.status(400).json({ error: 'Неверный checkpoint' });
    }

    // Для TRIMIN используем ti_mes_movement (AGMAS01001)
    if (checkpoint === 'Key_Uloc_Type_TRIMIN') {
      let sql = `
        SELECT DISTINCT m.vin
        FROM ti_mes_movement m
        JOIN tm_ofm_order o ON o.vin = m.vin
        WHERE m.uloc_no = 'AGMAS01001'
          AND m.is_deleted = 0
          AND m.scan_time BETWEEN ? AND ?
      `;
      const params = [dateFrom, dateTo];
      
      if (model && model !== 'ALL') {
        sql += ' AND o.product = ?';
        params.push(model);
      }
      
      const [rows] = await mesPool.query(sql, params);
      const vins = rows.map(r => r.vin);
      return res.json(vins);
    }

    // Для CP7, CP72, CPFINAL, CP8 - обычный запрос
    let sql = `
      SELECT DISTINCT v.vin
      FROM tm_vhc_vehicle_movement m
      JOIN tm_vhc_vehicle v ON v.id = m.tm_vhc_vehicle_id
      LEFT JOIN tm_ofm_order o ON o.vin = v.vin
      WHERE m.node_nature = ?
        AND m.scan_time BETWEEN ? AND ?
    `;
    const params = [checkpoint, dateFrom, dateTo];
    
    if (model && model !== 'ALL') {
      sql += ' AND o.product = ?';
      params.push(model);
    }

    const [rows] = await mesPool.query(sql, params);
    const vins = rows.map(r => r.vin);
    res.json(vins);
  } catch (err) {
    console.error('Ошибка sgp-audit-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Получить данные tv_biz_storage_car для списка VIN (из БД LES)
app.get('/api/sgp-audit-storage', async (req, res) => {
  try {
    const { vins, vin } = req.query;
    let vinList = [];
    if (vins) {
      vinList = vins.split(',').map(v => v.trim()).filter(v => v.length > 0);
    } else if (vin) {
      vinList = [vin.trim()];
    }
    if (vinList.length === 0) return res.json([]);

    const placeholders = vinList.map(() => '?').join(',');
    const sql = `
      SELECT
        s.vin AS VIN,
        s.vehicle_type AS Модель,
        s.ck_no AS Склад,
        s.kq_no AS Локация,
        s.kw_no AS Ячейка,
        '' AS "Результат проверки"
      FROM tv_biz_storage_car s
      WHERE s.vin IN (${placeholders})
      ORDER BY s.vin
    `;
    const [rows] = await lesPool.query(sql, vinList);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка sgp-audit-storage:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sgp-audit-vins-detail', async (req, res) => {
  try {
    const { checkpoint, dateFrom, dateTo, model, vin } = req.query;

    // --- Режим поиска по конкретному VIN ---
    if (vin) {
      const sqlDetail = `
        WITH movement AS (
            SELECT 
                v.vin,
                o.product AS model,
                m.node_nature,
                m.scan_time
            FROM tm_vhc_vehicle_movement m
            JOIN tm_vhc_vehicle v ON v.id = m.tm_vhc_vehicle_id
            LEFT JOIN tm_ofm_order o ON o.vin = v.vin
            WHERE v.vin = ?
              AND m.node_nature IN ('Key_Uloc_Type_CP7', 'Key_Uloc_Type_CP72', 'Key_Uloc_Type_CPFINAL', 'Key_Uloc_Type_CP8')
        ),
        trimin_movement AS (
            SELECT 
                m.vin,
                o.product AS model,
                'Key_Uloc_Type_TRIMIN' AS node_nature,
                m.scan_time
            FROM ti_mes_movement m
            LEFT JOIN tm_ofm_order o ON o.vin = m.vin
            WHERE m.vin = ?
              AND m.uloc_no = 'AGMAS01001'
              AND m.is_deleted = 0
        ),
        all_movement AS (
            SELECT * FROM movement
            UNION ALL
            SELECT * FROM trimin_movement
        ),
        aggregated AS (
            SELECT
                vin,
                MAX(model) AS model,
                node_nature,
                MIN(scan_time) AS in_time,
                MAX(scan_time) AS out_time
            FROM all_movement
            GROUP BY vin, node_nature
        )
        SELECT
            vin AS VIN,
            MAX(model) AS Модель,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_TRIMIN' THEN in_time END) AS TRIMIN_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_TRIMIN' THEN out_time END) AS TRIMIN_out,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP7' THEN in_time END) AS CP7_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP7' THEN out_time END) AS CP7_out,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP72' THEN in_time END) AS CP72_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP72' THEN out_time END) AS CP72_out,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CPFINAL' THEN in_time END) AS CPFINAL_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CPFINAL' THEN out_time END) AS CPFINAL_out,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP8' THEN in_time END) AS CP8_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP8' THEN out_time END) AS CP8_out
        FROM aggregated
        GROUP BY vin
        ORDER BY vin
      `;
      const [rows] = await mesPool.query(sqlDetail, [vin.trim(), vin.trim()]);
      return res.json(rows);
    }

    // --- Обычный режим ---
    if (!checkpoint || !dateFrom || !dateTo) {
      return res.status(400).json({ error: 'checkpoint, dateFrom, dateTo обязательны' });
    }

    // Добавляем TRIMIN в список
    const allNodes = [
      'Key_Uloc_Type_TRIMIN',
      'Key_Uloc_Type_CP7',
      'Key_Uloc_Type_CP72',
      'Key_Uloc_Type_CPFINAL',
      'Key_Uloc_Type_CP8'
    ];
    
    if (!allNodes.includes(checkpoint)) {
      return res.status(400).json({ error: 'Неверный checkpoint' });
    }

    const idx = allNodes.indexOf(checkpoint);
    const nodesAfter = allNodes.slice(idx + 1);

    // Для TRIMIN - получаем VIN из ti_mes_movement
    let sqlVins;
    let paramsVins;
    
    if (checkpoint === 'Key_Uloc_Type_TRIMIN') {
      sqlVins = `
        SELECT m.vin, MAX(m.scan_time) AS last_cp_time
        FROM ti_mes_movement m
        LEFT JOIN tm_ofm_order o ON o.vin = m.vin
        WHERE m.uloc_no = 'AGMAS01001'
          AND m.is_deleted = 0
          AND m.scan_time BETWEEN ? AND ?
      `;
      paramsVins = [dateFrom, dateTo];
      if (model && model !== 'ALL') {
        sqlVins += ' AND o.product = ?';
        paramsVins.push(model);
      }
      sqlVins += ' GROUP BY m.vin';
    } else {
      sqlVins = `
        SELECT v.vin, MAX(m.scan_time) AS last_cp_time
        FROM tm_vhc_vehicle_movement m
        JOIN tm_vhc_vehicle v ON v.id = m.tm_vhc_vehicle_id
        LEFT JOIN tm_ofm_order o ON o.vin = v.vin
        WHERE m.node_nature = ?
          AND m.scan_time BETWEEN ? AND ?
      `;
      paramsVins = [checkpoint, dateFrom, dateTo];
      if (model && model !== 'ALL') {
        sqlVins += ' AND o.product = ?';
        paramsVins.push(model);
      }
      sqlVins += ' GROUP BY v.vin';
    }
    
    const [vinsRows] = await mesPool.query(sqlVins, paramsVins);
    if (vinsRows.length === 0) {
      return res.json([]);
    }

    const vinsWithTimes = vinsRows.map(r => ({ vin: r.vin, lastCpTime: r.last_cp_time }));
    const vinList = vinsWithTimes.map(v => v.vin);

    if (nodesAfter.length > 0) {
      const placeholders = vinList.map(() => '?').join(',');
      
      // Исключаем VIN которые прошли следующие чекпоинты
      let sqlNext;
      let paramsNext;
      
      if (checkpoint === 'Key_Uloc_Type_TRIMIN') {
        // Для TRIMIN - следующие CP7, CP72, CPFINAL, CP8 в tm_vhc_vehicle_movement
        sqlNext = `
          SELECT DISTINCT v.vin
          FROM tm_vhc_vehicle_movement m
          JOIN tm_vhc_vehicle v ON v.id = m.tm_vhc_vehicle_id
          WHERE v.vin IN (${placeholders})
            AND m.node_nature IN (${nodesAfter.map(() => '?').join(',')})
            AND m.scan_time > (
              SELECT MAX(m2.scan_time)
              FROM ti_mes_movement m2
              WHERE m2.vin = v.vin AND m2.uloc_no = 'AGMAS01001'
                AND m2.is_deleted = 0
                AND m2.scan_time BETWEEN ? AND ?
            )
        `;
        paramsNext = [...vinList, ...nodesAfter, dateFrom, dateTo];
      } else {
        sqlNext = `
          SELECT DISTINCT v.vin
          FROM tm_vhc_vehicle_movement m
          JOIN tm_vhc_vehicle v ON v.id = m.tm_vhc_vehicle_id
          WHERE v.vin IN (${placeholders})
            AND m.node_nature IN (${nodesAfter.map(() => '?').join(',')})
            AND m.scan_time > (
              SELECT MAX(m2.scan_time)
              FROM tm_vhc_vehicle_movement m2
              JOIN tm_vhc_vehicle v2 ON v2.id = m2.tm_vhc_vehicle_id
              WHERE v2.vin = v.vin AND m2.node_nature = ?
                AND m2.scan_time BETWEEN ? AND ?
            )
        `;
        paramsNext = [...vinList, ...nodesAfter, checkpoint, dateFrom, dateTo];
      }
      
      const [nextRows] = await mesPool.query(sqlNext, paramsNext);
      const nextVins = new Set(nextRows.map(r => r.vin));
      
      const filteredVins = vinList.filter(vin => !nextVins.has(vin));
      
      if (filteredVins.length === 0) {
        return res.json([]);
      }

      const filteredPlaceholders = filteredVins.map(() => '?').join(',');
      const sqlDetail = `
        WITH movement AS (
            SELECT 
                v.vin,
                o.product AS model,
                m.node_nature,
                m.scan_time
            FROM tm_vhc_vehicle_movement m
            JOIN tm_vhc_vehicle v ON v.id = m.tm_vhc_vehicle_id
            LEFT JOIN tm_ofm_order o ON o.vin = v.vin
            WHERE v.vin IN (${filteredPlaceholders})
              AND m.node_nature IN ('Key_Uloc_Type_CP7', 'Key_Uloc_Type_CP72', 'Key_Uloc_Type_CPFINAL', 'Key_Uloc_Type_CP8')
        ),
        trimin_movement AS (
            SELECT 
                m.vin,
                o.product AS model,
                'Key_Uloc_Type_TRIMIN' AS node_nature,
                m.scan_time
            FROM ti_mes_movement m
            LEFT JOIN tm_ofm_order o ON o.vin = m.vin
            WHERE m.vin IN (${filteredPlaceholders})
              AND m.uloc_no = 'AGMAS01001'
              AND m.is_deleted = 0
        ),
        all_movement AS (
            SELECT * FROM movement
            UNION ALL
            SELECT * FROM trimin_movement
        ),
        aggregated AS (
            SELECT
                vin,
                MAX(model) AS model,
                node_nature,
                MIN(scan_time) AS in_time,
                MAX(scan_time) AS out_time
            FROM all_movement
            GROUP BY vin, node_nature
        )
        SELECT
            vin AS VIN,
            MAX(model) AS Модель,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_TRIMIN' THEN in_time END) AS TRIMIN_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_TRIMIN' THEN out_time END) AS TRIMIN_out,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP7' THEN in_time END) AS CP7_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP7' THEN out_time END) AS CP7_out,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP72' THEN in_time END) AS CP72_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP72' THEN out_time END) AS CP72_out,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CPFINAL' THEN in_time END) AS CPFINAL_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CPFINAL' THEN out_time END) AS CPFINAL_out,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP8' THEN in_time END) AS CP8_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP8' THEN out_time END) AS CP8_out
        FROM aggregated
        GROUP BY vin
        ORDER BY vin
      `;

      const [detailRows] = await mesPool.query(sqlDetail, [...filteredVins, ...filteredVins]);
      return res.json(detailRows);
    } else {
      // Если выбран последний чекпоинт (CP8)
      const vinListOnly = vinsWithTimes.map(v => v.vin);
      const placeholders = vinListOnly.map(() => '?').join(',');
      const sqlDetail = `
        WITH movement AS (
            SELECT 
                v.vin,
                o.product AS model,
                m.node_nature,
                m.scan_time
            FROM tm_vhc_vehicle_movement m
            JOIN tm_vhc_vehicle v ON v.id = m.tm_vhc_vehicle_id
            LEFT JOIN tm_ofm_order o ON o.vin = v.vin
            WHERE v.vin IN (${placeholders})
              AND m.node_nature IN ('Key_Uloc_Type_CP7', 'Key_Uloc_Type_CP72', 'Key_Uloc_Type_CPFINAL', 'Key_Uloc_Type_CP8')
        ),
        trimin_movement AS (
            SELECT 
                m.vin,
                o.product AS model,
                'Key_Uloc_Type_TRIMIN' AS node_nature,
                m.scan_time
            FROM ti_mes_movement m
            LEFT JOIN tm_ofm_order o ON o.vin = m.vin
            WHERE m.vin IN (${placeholders})
              AND m.uloc_no = 'AGMAS01001'
              AND m.is_deleted = 0
        ),
        all_movement AS (
            SELECT * FROM movement
            UNION ALL
            SELECT * FROM trimin_movement
        ),
        aggregated AS (
            SELECT
                vin,
                MAX(model) AS model,
                node_nature,
                MIN(scan_time) AS in_time,
                MAX(scan_time) AS out_time
            FROM all_movement
            GROUP BY vin, node_nature
        )
        SELECT
            vin AS VIN,
            MAX(model) AS Модель,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_TRIMIN' THEN in_time END) AS TRIMIN_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_TRIMIN' THEN out_time END) AS TRIMIN_out,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP7' THEN in_time END) AS CP7_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP7' THEN out_time END) AS CP7_out,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP72' THEN in_time END) AS CP72_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP72' THEN out_time END) AS CP72_out,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CPFINAL' THEN in_time END) AS CPFINAL_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CPFINAL' THEN out_time END) AS CPFINAL_out,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP8' THEN in_time END) AS CP8_in,
            MAX(CASE WHEN node_nature = 'Key_Uloc_Type_CP8' THEN out_time END) AS CP8_out
        FROM aggregated
        GROUP BY vin
        ORDER BY vin
      `;
      const [detailRows] = await mesPool.query(sqlDetail, [...vinListOnly, ...vinListOnly]);
      return res.json(detailRows);
    }
  } catch (err) {
    console.error('Ошибка sgp-audit-vins-detail:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Загрузка данных аудита (из Excel)
app.post('/api/audit-results/upload', express.json(), async (req, res) => {
  try {
    const { rows } = req.body; // массив { vin, result, date_uploaded }
    if (!rows || !rows.length) return res.status(400).json({ error: 'Нет данных' });

    const sql = 'INSERT IGNORE INTO audit_results (vin, result, date_uploaded) VALUES ?';
    const values = rows.map(r => [r.vin, r.result, r.date_uploaded]);
    const [result] = await notesPool.query(sql, [values]);
    res.json({ success: true, inserted: result.affectedRows });
  } catch (err) {
    console.error('Ошибка загрузки аудита:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Получение всех записей аудита
app.get('/api/audit-results', async (req, res) => {
  try {
    const { dateFrom, dateTo, result } = req.query;
    let sql = 'SELECT vin, result, date_uploaded FROM audit_results WHERE 1=1';
    const params = [];

    if (dateFrom) { sql += ' AND date_uploaded >= ?'; params.push(dateFrom); }
    if (dateTo)   { sql += ' AND date_uploaded <= ?'; params.push(dateTo); }
    if (result && result !== 'ALL') { sql += ' AND result = ?'; params.push(result); }

    sql += ' ORDER BY date_uploaded, vin';
    const [rows] = await notesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения аудита:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ТОП MPP ЗА НЕДЕЛЮ ==================
app.get('/api/mpp-weekly-top', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, model, defectType } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });

    const type = defectType || 'offline';

    const pipPosts = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
    const cp7Posts = ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'REPAIR', 'REPAIR_Final', 'EXT1', 'PIP2', 'PIP4', 'PIP9'];
    const cp8Posts = ['CP8', 'CP8 Gate', 'CP8-gate', '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT'];
    const tlPosts  = ['360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'];

    let postList = [];
    if (!checkpoint || checkpoint === 'ALL') {
      postList = [...new Set([...pipPosts, ...cp7Posts, ...cp8Posts])];
    } else if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else if (checkpoint === 'PIP') postList = pipPosts;
    else if (checkpoint === 'TL')  postList = tlPosts;
    else postList = [...new Set([...pipPosts, ...cp7Posts, ...cp8Posts])];

    const postListStr = postList.map(p => `'${p}'`).join(',');

    let typeCondition = '';
    if (type === 'offline') {
      typeCondition = " AND (QM_DEF.S_OFFLINE = 1 OR QM_DEF.PROBLEM_TYPE = 'Отсутствие')";
    } else if (type === 'online') {
      typeCondition = " AND QM_DEF.S_OFFLINE = 0 AND QM_DEF.PROBLEM_TYPE <> 'Отсутствие'";
    }

    const params = [dateFrom, dateTo];
    let modelCondition = '';
    if (model && model !== 'ALL') {
      modelCondition = ' AND wo.MODEL = ?';
      params.push(model);
    }

    const sql = `
      SELECT
        CONCAT(wo.MODEL, ' ', QM_DEF.PART_NAME, ' ', QM_DEF.PROBLEM_TYPE) AS MPP,
        QM_DEF.PART_NAME,
        QM_DEF.PROBLEM_TYPE,
        wo.MODEL,
        MIN(QM_DEF.POST_NAME) AS POST_NAME,
        COUNT(*) AS DEFECT_COUNT,
        COUNT(DISTINCT wo.VIN) AS VIN_COUNT,
        GROUP_CONCAT(DISTINCT wo.VIN) AS VIN_LIST
      FROM (
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE QM_DEF.POST_NAME IN (${postListStr})
        ${typeCondition}
        AND QM_DEF.CREATION_DATE BETWEEN ? AND ?
        ${modelCondition}
        AND QM_DEF.PART_NAME IS NOT NULL AND TRIM(QM_DEF.PART_NAME) <> ''
        AND QM_DEF.PROBLEM_TYPE IS NOT NULL AND TRIM(QM_DEF.PROBLEM_TYPE) <> ''
      GROUP BY MPP, QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE, wo.MODEL
      ORDER BY DEFECT_COUNT DESC
      LIMIT 100
    `;

    const [rows] = await pool.query(sql, params);

    // Подсчёт общего количества уникальных VIN (для DPU)
    let totalCars = 0;
    if (postList.length > 0) {
      const carsSql = `
        SELECT COUNT(DISTINCT VIN) AS TOTAL
        FROM at_om_wiptrackinghistory
        WHERE WC_NAME IN (${postListStr})
          AND DATE(CREATION_TIME) BETWEEN ? AND ?
      `;
      const carsParams = [dateFrom, dateTo];
      const [[{ TOTAL }]] = await pool.query(carsSql, carsParams);
      totalCars = TOTAL || 0;
    }

    // Расчёт доли ремзоны для каждого MPP
    const result = [];
    for (let row of rows) {
      const vins = row.VIN_LIST ? row.VIN_LIST.split(',') : [];
      let remzoneCount = 0;
      if (vins.length > 0) {
        const placeholders = vins.map(() => '?').join(',');
        const remSql = `
          SELECT COUNT(DISTINCT tvv.VIN) AS CNT
          FROM tm_vhc_vehicle tvv
          JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN
          WHERE tvv.VIN IN (${placeholders})
            AND tvtlm.node_nature LIKE 'REP%'
        `;
        const [remRows] = await mesPool.query(remSql, vins);
        remzoneCount = remRows[0]?.CNT || 0;
      }

      const totalVins = vins.length;
      const remzonePercent = totalVins > 0 ? ((remzoneCount * 100) / totalVins).toFixed(2) : '0.00';

      result.push({
        MPP: row.MPP,
        MODEL: row.MODEL,
        PART_NAME: row.PART_NAME,
        PROBLEM_TYPE: row.PROBLEM_TYPE,
        POST_NAME: row.POST_NAME,
        DEFECT_COUNT: row.DEFECT_COUNT,
        VIN_COUNT: row.VIN_COUNT,
        DPU: totalCars > 0 ? ((row.DEFECT_COUNT * 1000) / totalCars).toFixed(2) : '0.00',
        TOTAL_VINS: totalVins,
        REMZONE_VINS: remzoneCount,
        REMZONE_PERCENT: remzonePercent,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Ошибка mpp-weekly-top:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// VIN для конкретного MPP
app.get('/api/mpp-vins', async (req, res) => {
  try {
    const { mpp, partName, problemType, dateFrom, dateTo, model } = req.query;
    if (!partName || !problemType || !dateFrom || !dateTo) {
      return res.status(400).json({ error: 'partName, problemType, dateFrom, dateTo обязательны' });
    }

    let where = `QM_DEF.PART_NAME = ? AND QM_DEF.PROBLEM_TYPE = ? AND (QM_DEF.S_OFFLINE = 1 OR QM_DEF.PROBLEM_TYPE = 'Отсутствие') AND QM_DEF.CREATION_DATE BETWEEN ? AND ?`;
    const params = [partName, problemType, dateFrom, dateTo];

    if (model && model !== 'ALL') {
      where += ' AND wo.MODEL = ?';
      params.push(model);
    }

    const sql = `
      SELECT wo.VIN, wo.MODEL, MIN(QM_DEF.CREATION_TIME) AS DEFECT_TIME
      FROM (
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, CREATION_TIME,
               PART_NAME, PROBLEM_TYPE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, CREATION_TIME,
               PART_NAME, PROBLEM_TYPE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, CREATION_TIME,
               PART_NAME, PROBLEM_TYPE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE ${where}
      GROUP BY wo.VIN, wo.MODEL
      ORDER BY wo.VIN
    `;

    const [rows] = await pool.query(sql, params);
    const vins = rows.map(r => r.VIN);

    const remzoneMap = new Map();
    if (vins.length > 0) {
      const placeholders = vins.map(() => '?').join(',');
      const remSql = `
        SELECT tvv.VIN, 
               MIN(tvtlm.gmt_create) AS REM_IN,
               MAX(tvtlm.gmt_create) AS REM_OUT
        FROM tm_vhc_vehicle tvv
        JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN
        WHERE tvv.VIN IN (${placeholders})
          AND tvtlm.node_nature LIKE 'REP%'
          AND tvtlm.gmt_create IS NOT NULL
        GROUP BY tvv.VIN
      `;
      const [remRows] = await mesPool.query(remSql, vins);
      remRows.forEach(r => {
        const remIn = r.REM_IN ? new Date(r.REM_IN) : null;
        const remOut = r.REM_OUT ? new Date(r.REM_OUT) : null;
        let durationStr = '—';
        if (remIn && remOut) {
          const diffMs = remOut - remIn;
          if (diffMs <= 0) {
            durationStr = 'В ремзоне';
          } else {
            const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
            durationStr = `${days}д ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
          }
        }
        remzoneMap.set(r.VIN, {
          in: r.REM_IN ? r.REM_IN.replace('T', ' ').slice(0, 19) : null,
          out: r.REM_OUT ? r.REM_OUT.replace('T', ' ').slice(0, 19) : null,
          duration: durationStr,
        });
      });
    }

    const result = rows.map(row => {
      const rem = remzoneMap.get(row.VIN);
      return {
        VIN: row.VIN,
        MODEL: row.MODEL,
        DEFECT_TIME: row.DEFECT_TIME ? row.DEFECT_TIME.replace('T', ' ').slice(0, 19) : null,
        IN_REMZONE: !!rem,
        REM_IN: rem ? rem.in : null,
        REM_OUT: rem ? rem.out : null,
        REM_DURATION: rem ? rem.duration : '—',
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка mpp-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== СУММАРНОЕ ВРЕМЯ В РЕМЗОНЕ ПО MPP ==================
app.get('/api/mpp-remzone-duration', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, model } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });

    // Списки постов (аналогично mpp-weekly-top)
    const pipPosts = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
    const cp7Posts = ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'REPAIR', 'REPAIR_Final', 'EXT1', 'PIP2', 'PIP4', 'PIP9'];
    const cp8Posts = ['CP8', 'CP8 Gate', 'CP8-gate', '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT'];
    const tlPosts  = ['360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT',, 'CP8 Touch Up'];

    let postList = [];
    if (!checkpoint || checkpoint === 'ALL') {
      postList = [...new Set([...pipPosts, ...cp7Posts, ...cp8Posts])];
    } else if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else if (checkpoint === 'PIP') postList = pipPosts;
    else if (checkpoint === 'TL')  postList = tlPosts;
    else postList = [...new Set([...pipPosts, ...cp7Posts, ...cp8Posts])];

    const postListStr = postList.map(p => `'${p}'`).join(',');

    // Получаем все дефекты (офлайн) с их VIN и MPP
    const params = [dateFrom, dateTo];
    let modelCondition = '';
    if (model && model !== 'ALL') {
      modelCondition = ' AND wo.MODEL = ?';
      params.push(model);
    }

    const defectsSql = `
      SELECT
        CONCAT(wo.MODEL, ' ', QM_DEF.PART_NAME, ' ', QM_DEF.PROBLEM_TYPE) AS MPP,
        wo.MODEL,
        wo.VIN
      FROM (
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE QM_DEF.POST_NAME IN (${postListStr})
        AND (QM_DEF.S_OFFLINE = 1 OR QM_DEF.PROBLEM_TYPE = 'Отсутствие')
        AND QM_DEF.CREATION_DATE BETWEEN ? AND ?
        ${modelCondition}
        AND QM_DEF.PART_NAME IS NOT NULL AND TRIM(QM_DEF.PART_NAME) <> ''
        AND QM_DEF.PROBLEM_TYPE IS NOT NULL AND TRIM(QM_DEF.PROBLEM_TYPE) <> ''
      GROUP BY MPP, wo.MODEL, wo.VIN
    `;

    const [defectRows] = await pool.query(defectsSql, params);

    // Для каждого VIN получаем суммарное время в ремзоне (из MES)
    const vins = [...new Set(defectRows.map(r => r.VIN))];
    const remDurationMap = new Map(); // vin -> total duration in hours

    if (vins.length > 0) {
      const placeholders = vins.map(() => '?').join(',');
      const remSql = `
        SELECT tvv.VIN, 
               MIN(tvtlm.gmt_create) AS REM_IN,
               MAX(tvtlm.gmt_create) AS REM_OUT
        FROM tm_vhc_vehicle tvv
        JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN
        WHERE tvv.VIN IN (${placeholders})
          AND tvtlm.node_nature LIKE 'REP%'
          AND tvtlm.gmt_create IS NOT NULL
        GROUP BY tvv.VIN
      `;
      const [remRows] = await mesPool.query(remSql, vins);
      remRows.forEach(r => {
        if (r.REM_IN && r.REM_OUT) {
          const diffMs = new Date(r.REM_OUT) - new Date(r.REM_IN);
          if (diffMs > 0) {
            remDurationMap.set(r.VIN, diffMs / (1000 * 60 * 60)); // часы
          }
        }
      });
    }

    // Группируем по MPP и модели, суммируем время
    const mppDurationMap = {};
    defectRows.forEach(row => {
      const key = row.MPP;
      if (!mppDurationMap[key]) {
        mppDurationMap[key] = {
          MPP: key,
          MODEL: row.MODEL,
          totalDurationHours: 0,
          vinCount: 0,
        };
      }
      const duration = remDurationMap.get(row.VIN) || 0;
      if (duration > 0) {
        mppDurationMap[key].totalDurationHours += duration;
        mppDurationMap[key].vinCount += 1;
      }
    });

    const result = Object.values(mppDurationMap)
      .filter(item => item.totalDurationHours > 0)
      .sort((a, b) => b.totalDurationHours - a.totalDurationHours)
      .map(item => ({
        ...item,
        totalDurationDays: (item.totalDurationHours / 24).toFixed(2),
        totalDurationHours: item.totalDurationHours.toFixed(2),
      }));

    // Общая сумма времени по всем дефектам
    const totalHours = result.reduce((sum, item) => sum + parseFloat(item.totalDurationHours), 0);

    res.json({
      items: result,
      totalHours: totalHours.toFixed(2),
      totalDays: (totalHours / 24).toFixed(2),
    });
  } catch (err) {
    console.error('Ошибка mpp-remzone-duration:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== АНАЛИТИКА ПО DRR (ВРЕМЯ В РЕМЗОНЕ) ==================
app.get('/api/mpp-drr-analytics', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, model } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom, dateTo обязательны' });

    // ========== 1. Список постов для дефектов (зависит от фильтра чекпоинтов) ==========
    const pipPosts = ['EXT1','PIP1','PIP2','PIP4','PIP5','PIP6','PIP8','PIP9'];
    const cp7Posts = ['CP7','CP7 Audit','CP7 Gate','CP7-gate','REPAIR','REPAIR_Final','EXT1','PIP2','PIP4','PIP9'];
    const cp8Posts = ['CP8','CP8 Gate','CP8-gate','360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT','CP8 Touch Up'];

    let defectPostList = [];
    if (!checkpoint || checkpoint === 'ALL') defectPostList = [...new Set([...pipPosts, ...cp7Posts, ...cp8Posts])];
    else if (checkpoint === 'CP7') defectPostList = cp7Posts;
    else if (checkpoint === 'CP8') defectPostList = cp8Posts;
    else if (checkpoint === 'PIP') defectPostList = pipPosts;
    else defectPostList = [...new Set([...pipPosts, ...cp7Posts, ...cp8Posts])];

    const defectPostListStr = defectPostList.map(p => `'${p}'`).join(',');

    // ========== 2. Общее количество машин и в ремзоне – ВСЕГДА по CP72 ==========
    const cp72PostList = ['CP72'];
    const cp72PostListStr = cp72PostList.map(p => `'${p}'`).join(',');

    const days = [];
    let current = new Date(dateFrom);
    const end = new Date(dateTo);
    while (current <= end) {
      days.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }

    let totalVins = 0;
    let totalRemVins = 0;

    for (const day of days) {
      // Параметры для CP72
      const carsParams = [day];
      if (model && model !== 'ALL') carsParams.push(model);

      // Количество уникальных VIN за день по CP72
      const [[{ CNT }]] = await pool.query(`
        SELECT COUNT(DISTINCT VIN) AS CNT
        FROM at_om_wiptrackinghistory
        WHERE WC_NAME IN (${cp72PostListStr})
          AND DATE(CREATION_TIME) = ?
          ${model && model !== 'ALL' ? ' AND MODEL = ?' : ''}
      `, carsParams);

      totalVins += CNT || 0;

      if (CNT > 0) {
        // Список VIN за день для проверки ремзоны
        const [vinsRows] = await pool.query(`
          SELECT DISTINCT VIN
          FROM at_om_wiptrackinghistory
          WHERE WC_NAME IN (${cp72PostListStr})
            AND DATE(CREATION_TIME) = ?
            ${model && model !== 'ALL' ? ' AND MODEL = ?' : ''}
        `, carsParams);

        const vinsList = vinsRows.map(r => r.VIN);
        const placeholders = vinsList.map(() => '?').join(',');

        const [remRows] = await mesPool.query(`
          SELECT COUNT(DISTINCT tvv.VIN) AS CNT
          FROM tm_vhc_vehicle tvv
          JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN
          WHERE tvv.VIN IN (${placeholders})
            AND tvtlm.node_nature LIKE 'REP%'
        `, vinsList);

        totalRemVins += remRows[0]?.CNT || 0;
      }
    }

    // ========== 3. Данные по дефектам (с фильтром чекпоинтов) ==========
    let modelCondition = '';
    const params = [dateFrom, dateTo];
    if (model && model !== 'ALL') {
      modelCondition = ' AND wo.MODEL = ?';
      params.push(model);
    }

    const sqlDefects = `
      SELECT
        CONCAT(wo.MODEL, ' ', QM_DEF.PART_NAME, ' ', QM_DEF.PROBLEM_TYPE) AS MPP,
        QM_DEF.PART_NAME,
        QM_DEF.PROBLEM_TYPE,
        wo.MODEL,
        COUNT(*) AS DEFECT_COUNT,
        GROUP_CONCAT(DISTINCT wo.VIN) AS VIN_LIST
      FROM (
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE, POST_NAME
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE, POST_NAME
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE, POST_NAME
        FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE QM_DEF.POST_NAME IN (${defectPostListStr})
        AND (QM_DEF.S_OFFLINE = 1 OR QM_DEF.PROBLEM_TYPE = 'Отсутствие')
        AND QM_DEF.CREATION_DATE BETWEEN ? AND ?
        ${modelCondition}
        AND QM_DEF.PART_NAME IS NOT NULL AND TRIM(QM_DEF.PART_NAME) <> ''
        AND QM_DEF.PROBLEM_TYPE IS NOT NULL AND TRIM(QM_DEF.PROBLEM_TYPE) <> ''
      GROUP BY MPP, QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE, wo.MODEL
      ORDER BY DEFECT_COUNT DESC
      LIMIT 50
    `;
    const [defectRows] = await pool.query(sqlDefects, params);

    const result = [];
    for (let row of defectRows) {
      const vins = row.VIN_LIST ? row.VIN_LIST.split(',') : [];
      let totalHours = 0;
      let remzoneCount = 0;

      if (vins.length > 0) {
        const placeholders = vins.map(() => '?').join(',');
        const [remRows] = await mesPool.query(`
          SELECT tvv.VIN, 
                 MIN(tvtlm.gmt_create) AS REM_IN,
                 MAX(tvtlm.gmt_create) AS REM_OUT
          FROM tm_vhc_vehicle tvv
          JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN
          WHERE tvv.VIN IN (${placeholders})
            AND tvtlm.node_nature LIKE 'REP%'
          GROUP BY tvv.VIN
        `, vins);

        remRows.forEach(r => {
          if (r.REM_IN && r.REM_OUT) {
            const diffMs = new Date(r.REM_OUT) - new Date(r.REM_IN);
            if (diffMs > 0) {
              totalHours += diffMs / (1000 * 60 * 60);
              remzoneCount++;
            }
          }
        });
      }

      result.push({
        MPP: row.MPP,
        MODEL: row.MODEL,
        DEFECT_COUNT: row.DEFECT_COUNT,
        REMZONE_COUNT: remzoneCount,
        TOTAL_HOURS: totalHours,
      });
    }

    res.json({
      data: result,
      summary: {
        totalVins: totalVins,       // сумма дневных уникальных VIN по CP72
        totalRemVins: totalRemVins, // из них в ремзоне
      }
    });
  } catch (err) {
    console.error('Ошибка mpp-drr-analytics:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ДИНАМИКА ДЕФЕКТА (MPP TREND) ==================
// ================== ДИНАМИКА ДЕФЕКТА (MPP TREND) ==================
app.get('/api/mpp-defect-trend', async (req, res) => {
  try {
    const { partName, problemType, model, checkpoint, periodType } = req.query;
    if (!partName || !problemType || !model || !periodType) {
      return res.status(400).json({ error: 'partName, problemType, model, periodType обязательны' });
    }

    // Списки постов (как в mpp-weekly-top)
    const pipPosts = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
    const cp7Posts = ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'REPAIR', 'REPAIR_Final', 'EXT1', 'PIP2', 'PIP4', 'PIP9'];
    const cp8Posts = ['CP8', 'CP8 Gate', 'CP8-gate', '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT'];
    const tlPosts  = ['360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'];

    let postList = [];
    if (!checkpoint || checkpoint === 'ALL') {
      postList = [...new Set([...pipPosts, ...cp7Posts, ...cp8Posts])];
    } else {
      const checkpoints = checkpoint.split(',');
      checkpoints.forEach(cp => {
        if (cp === 'CP7') postList.push(...cp7Posts);
        else if (cp === 'CP8') postList.push(...cp8Posts);
        else if (cp === 'PIP') postList.push(...pipPosts);
        else if (cp === 'TL')  postList.push(...tlPosts);
      });
      postList = [...new Set(postList)];
    }
    if (postList.length === 0) {
      return res.json([]);
    }
    const postListStr = postList.map(p => `'${p}'`).join(',');

    // Вспомогательная функция для ISO недели
    function getISOWeekInfo(date) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      return { year: d.getUTCFullYear(), week: weekNo };
    }

    // Генерация полного списка периодов
    const generatePeriods = () => {
      const now = new Date();
      const periods = [];
      if (periodType === 'month') {
        for (let i = 2; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          periods.push(`${y}-${m}`);
        }
      } else if (periodType === 'week') {
        const current = new Date(now);
        const day = current.getDay();
        const mondayOffset = day === 0 ? -6 : 1 - day;
        const thisMonday = new Date(current);
        thisMonday.setDate(current.getDate() + mondayOffset);
        thisMonday.setHours(0, 0, 0, 0);
        for (let i = 3; i >= 0; i--) {
          const weekStart = new Date(thisMonday);
          weekStart.setDate(thisMonday.getDate() - i * 7);
          const iso = getISOWeekInfo(weekStart);
          periods.push(`${iso.year}-W${String(iso.week).padStart(2, '0')}`);
        }
      } else if (periodType === 'day') {
        for (let i = 13; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(now.getDate() - i);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          periods.push(`${y}-${m}-${day}`);
        }
      }
      return periods;
    };

    const periods = generatePeriods();
    if (periods.length === 0) return res.json([]);

    // Условие для SQL в зависимости от типа периода
    let dateCondition = '';
    if (periodType === 'month') {
      dateCondition = `AND DATE_FORMAT(QM_DEF.CREATION_DATE, '%Y-%m') IN (${periods.map(() => '?').join(',')})`;
    } else if (periodType === 'week') {
      dateCondition = `AND DATE_FORMAT(QM_DEF.CREATION_DATE, '%x-W%v') IN (${periods.map(() => '?').join(',')})`;
    } else if (periodType === 'day') {
      dateCondition = `AND QM_DEF.CREATION_DATE IN (${periods.map(() => '?').join(',')})`;
    }

    const sql = `
      SELECT 
        ${periodType === 'month' ? "DATE_FORMAT(QM_DEF.CREATION_DATE, '%Y-%m')" :
          periodType === 'week' ? "DATE_FORMAT(QM_DEF.CREATION_DATE, '%x-W%v')" :
          "DATE(QM_DEF.CREATION_DATE)"} AS period,
        COUNT(*) AS defect_count
      FROM (
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, DATE(CREATION_TIME) AS CREATION_DATE, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE,
               PART_NAME, PROBLEM_TYPE
        FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE QM_DEF.PART_NAME = ? 
        AND QM_DEF.PROBLEM_TYPE = ?
        AND wo.MODEL = ?
        AND (QM_DEF.S_OFFLINE = 1 OR QM_DEF.PROBLEM_TYPE = 'Отсутствие')
        AND QM_DEF.POST_NAME IN (${postListStr})
        ${dateCondition}
      GROUP BY period
      ORDER BY period
    `;

    const queryParams = [partName, problemType, model, ...periods];
    const [rows] = await pool.query(sql, queryParams);

    // Словарь: период -> defect_count
    const defectMap = {};
    rows.forEach(r => { defectMap[r.period] = r.defect_count; });

    // Для каждого периода вычисляем total_cars (количество уникальных VIN, прошедших посты)
    const result = [];
    for (const period of periods) {
      let totalCars = 0;
      // Условие для подсчёта автомобилей
      let carCondition = '';
      if (periodType === 'month') {
        carCondition = `DATE_FORMAT(DATE(CREATION_TIME), '%Y-%m') = ?`;
      } else if (periodType === 'week') {
        carCondition = `DATE_FORMAT(DATE(CREATION_TIME), '%x-W%v') = ?`;
      } else {
        carCondition = `DATE(CREATION_TIME) = ?`;
      }

      const carSql = `
        SELECT COUNT(DISTINCT VIN) AS total
        FROM at_om_wiptrackinghistory
        WHERE WC_NAME IN (${postListStr})
          AND ${carCondition}
      `;
      const [carRows] = await pool.query(carSql, [period]);
      totalCars = carRows[0]?.total || 0;

      result.push({
        period,
        defect_count: defectMap[period] || 0,
        total_cars: totalCars,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Ошибка mpp-defect-trend:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/part-defect-search', async (req, res) => {
  try {
    const { part, defect, model, dateFrom, dateTo } = req.query;
    if (!part && !defect && !model) {
      return res.status(400).json({ error: 'Укажите хотя бы один параметр' });
    }

    let where = '1=1';
    const params = [];

    if (part) {
      where += ' AND QM_DEF.PART_NAME LIKE ?';
      params.push(`%${part}%`);
    }
    if (defect) {
      where += ' AND QM_DEF.PROBLEM_TYPE LIKE ?';
      params.push(`%${defect}%`);
    }
    if (model && model !== 'ALL') {
      where += ' AND wo.MODEL = ?';
      params.push(model);
    }
    if (dateFrom) {
      where += ' AND QM_DEF.CREATION_TIME >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ' AND QM_DEF.CREATION_TIME <= ?';
      params.push(dateTo);
    }

    const defectSql = `
      SELECT QM_DEF.VIN, QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE, QM_DEF.PROBLEM_REPLENISH, QM_DEF.CREATION_TIME
      FROM (
        SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE ${where}
      ORDER BY QM_DEF.CREATION_TIME DESC
    `;

    const [defectRows] = await pool.query(defectSql, params);
    if (defectRows.length === 0) return res.json([]);

    const vins = [...new Set(defectRows.map(r => r.VIN))];
    const placeholders = vins.map(() => '?').join(',');

    const timePointsSql = `
      SELECT
        too.vin,
        too.material_no AS material_code,
        tvv.sequence_number,
        uvkmm.kd_material_no,
        too.product AS model,
        tbmr.material_desc,
        tbmr.ps_material_desc AS colour,
        t.CP5, t.CP6, t.TRIMIN, t.CP7, t.CP72, t.CPFINAL, t.CP8
      FROM tm_ofm_order too
      LEFT JOIN tm_vhc_vehicle tvv ON too.vin = tvv.vin
      LEFT JOIN tm_bas_material_relation tbmr 
        ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
      LEFT JOIN udt_vsp_kd_material_mapping uvkmm 
        ON CONCAT(LEFT(tbmr.material_no, 7), '**', RIGHT(tbmr.material_no, 6)) = uvkmm.material_no 
        AND uvkmm.kd_material_no = tbmr.kd_material_no
      LEFT JOIN (
        SELECT vin,
               MAX(IF(uloc_no = 'AGMBS01002', scan_time, NULL)) AS CP5,
               MAX(IF(uloc_no = 'AGMPS01002', scan_time, NULL)) AS CP6,
               MAX(IF(uloc_no = 'AGMAS01001', scan_time, NULL)) AS TRIMIN,
               MAX(IF(uloc_no = 'AGMAS01003', scan_time, NULL)) AS CP7,
               MAX(IF(uloc_no = 'CP72', scan_time, NULL)) AS CP72,
               MAX(IF(uloc_no = 'CPFINAL', scan_time, NULL)) AS CPFINAL,
               MAX(IF(uloc_no = 'AGMAS01004', scan_time, NULL)) AS CP8
        FROM ti_mes_movement
        WHERE is_deleted = 0
        GROUP BY vin
      ) t ON t.vin = too.vin
      WHERE too.vin IN (${placeholders})
    `;
    const [vehicles] = await mesPool.query(timePointsSql, vins);
    const vehicleMap = new Map(vehicles.map(v => [v.vin, v]));

    const [storageRows] = await lesPool.query(`
      SELECT vin, in_storage_time, out_storage_time,
             in_storage_status,
             ck_no, kq_no, kw_no
      FROM tv_biz_storage_car
      WHERE vin IN (${placeholders})
    `, vins);
    const storageMap = new Map(storageRows.map(r => [r.vin, r]));

    const [iotRows] = await pool.query(`
      SELECT wo.vin,
             MAX(IF(aow.wc_name = 'TLWA', aow.creation_time, NULL)) AS TLWA,
             MAX(IF(aow.wc_name = 'TLRT', aow.creation_time, NULL)) AS TLRT,
             MAX(IF(aow.wc_name = 'TLADAS', aow.creation_time, NULL)) AS TLADAS,
             MAX(IF(aow.wc_name = 'TLTT', aow.creation_time, NULL)) AS TLTT
      FROM work_order wo
      LEFT JOIN at_om_wiptrackinghistory aow ON wo.vin = aow.vin
      WHERE wo.vin IN (${placeholders})
      GROUP BY wo.vin
    `, vins);
    const iotMap = new Map(iotRows.map(r => [r.vin, r]));

    const result = defectRows.map(defect => {
      const v = vehicleMap.get(defect.VIN);
      if (!v) return null;

      const les = storageMap.get(defect.VIN) || {};
      const iot = iotMap.get(defect.VIN) || {};

      const times = {
        CP5: v.CP5, CP6: v.CP6, TRIMIN: v.TRIMIN, CP7: v.CP7, CP72: v.CP72,
        TLWA: iot.TLWA, TLRT: iot.TLRT, TLADAS: iot.TLADAS, TLTT: iot.TLTT,
        CPFINAL: v.CPFINAL, CP8: v.CP8
      };

      const checkpoints = ['CP5','CP6','TRIMIN','CP7','CP72','TLWA','TLRT','TLADAS','TLTT','CPFINAL','CP8'];
      let latestCheckpoint = null;
      let latestTime = null;
      for (const cp of checkpoints) {
        if (times[cp]) {
          const t = new Date(times[cp]);
          if (!latestTime || t > latestTime) {
            latestTime = t;
            latestCheckpoint = cp;
          }
        }
      }

      const storageStatus = les.in_storage_status || '';
      const isSold = storageStatus === 'Key_Car_In_Storage_Status_3';
      const hasStorageData = les.ck_no && les.kq_no && les.kw_no &&
                             les.ck_no !== 'N/A' && les.kq_no !== 'N/A' && les.kw_no !== 'N/A';
      const isInStorage = !isSold && hasStorageData;

      let currentZone;
      if (isSold) currentZone = 'Продан';
      else if (isInStorage) currentZone = `${les.ck_no}-${les.kq_no}-${les.kw_no}`;
      else currentZone = latestCheckpoint || 'Планирование';

      return {
        vin: defect.VIN,
        part_name: defect.PART_NAME || '',
        problem_type: defect.PROBLEM_TYPE || '',
        problem_replenish: defect.PROBLEM_REPLENISH || '',
        defect_creation_time: defect.CREATION_TIME,
        material_code: v.material_code,
        sequence_number: v.sequence_number,
        kd_material_no: v.kd_material_no,
        model: v.model,
        material_desc: v.material_desc,
        colour: v.colour,
        CP5: v.CP5, CP6: v.CP6, TRIMIN: v.TRIMIN, CP7: v.CP7, CP72: v.CP72,
        TLWA: iot.TLWA || null, TLRT: iot.TLRT || null, TLADAS: iot.TLADAS || null, TLTT: iot.TLTT || null,
        CPFINAL: v.CPFINAL, CP8: v.CP8,
        in_storage_time: les.in_storage_time || null,
        out_storage_time: les.out_storage_time || null,
        location: currentZone,
        current_zone: currentZone,
      };
    }).filter(Boolean);

    res.json(result);
  } catch (err) {
    console.error('Ошибка part-defect-search:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vin-defect-search', async (req, res) => {
  try {
    const { vin, model, dateFrom, dateTo } = req.query;
    if (!vin && !model) {
      return res.status(400).json({ error: 'Укажите VIN или модель' });
    }

    let where = '1=1';
    const params = [];

    if (vin) {
      where += ' AND QM_DEF.VIN LIKE ?';
      params.push(`%${vin}%`);
    }
    if (model && model !== 'ALL') {
      where += ' AND wo.MODEL = ?';
      params.push(model);
    }
    if (dateFrom) {
      where += ' AND QM_DEF.CREATION_TIME >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ' AND QM_DEF.CREATION_TIME <= ?';
      params.push(dateTo);
    }

    const defectSql = `
      SELECT QM_DEF.VIN, QM_DEF.PART_NAME, QM_DEF.PROBLEM_TYPE, QM_DEF.PROBLEM_REPLENISH, QM_DEF.CREATION_TIME
      FROM (
        SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH FROM at_qm_defect_info
      ) QM_DEF
      JOIN work_order wo ON wo.VIN = QM_DEF.VIN
      WHERE ${where}
      ORDER BY QM_DEF.CREATION_TIME DESC
    `;

    const [defectRows] = await pool.query(defectSql, params);
    if (defectRows.length === 0) return res.json([]);

    const vins = [...new Set(defectRows.map(r => r.VIN))];
    const placeholders = vins.map(() => '?').join(',');

    // Получаем time-points из MES
    const timePointsSql = `
      SELECT
        too.vin,
        too.material_no AS material_code,
        tvv.sequence_number,
        uvkmm.kd_material_no,
        too.product AS model,
        tbmr.material_desc,
        tbmr.ps_material_desc AS colour,
        t.CP5, t.CP6, t.TRIMIN, t.CP7, t.CP72, t.CPFINAL, t.CP8
      FROM tm_ofm_order too
      LEFT JOIN tm_vhc_vehicle tvv ON too.vin = tvv.vin
      LEFT JOIN tm_bas_material_relation tbmr 
        ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
      LEFT JOIN udt_vsp_kd_material_mapping uvkmm 
        ON CONCAT(LEFT(tbmr.material_no, 7), '**', RIGHT(tbmr.material_no, 6)) = uvkmm.material_no 
        AND uvkmm.kd_material_no = tbmr.kd_material_no
      LEFT JOIN (
        SELECT vin,
               MAX(IF(uloc_no = 'AGMBS01002', scan_time, NULL)) AS CP5,
               MAX(IF(uloc_no = 'AGMPS01002', scan_time, NULL)) AS CP6,
               MAX(IF(uloc_no = 'AGMAS01001', scan_time, NULL)) AS TRIMIN,
               MAX(IF(uloc_no = 'AGMAS01003', scan_time, NULL)) AS CP7,
               MAX(IF(uloc_no = 'CP72', scan_time, NULL)) AS CP72,
               MAX(IF(uloc_no = 'CPFINAL', scan_time, NULL)) AS CPFINAL,
               MAX(IF(uloc_no = 'AGMAS01004', scan_time, NULL)) AS CP8
        FROM ti_mes_movement
        WHERE is_deleted = 0
        GROUP BY vin
      ) t ON t.vin = too.vin
      WHERE too.vin IN (${placeholders})
    `;
    const [vehicles] = await mesPool.query(timePointsSql, vins);
    const vehicleMap = new Map(vehicles.map(v => [v.vin, v]));

    // Получаем складские данные (LES)
    const [storageRows] = await lesPool.query(`
      SELECT vin, in_storage_time, out_storage_time,
             in_storage_status,
             ck_no, kq_no, kw_no
      FROM tv_biz_storage_car
      WHERE vin IN (${placeholders})
    `, vins);
    const storageMap = new Map(storageRows.map(r => [r.vin, r]));

    // Получаем TL времена из IoT
    const [iotRows] = await pool.query(`
      SELECT wo.vin,
             MAX(IF(aow.wc_name = 'TLWA', aow.creation_time, NULL)) AS TLWA,
             MAX(IF(aow.wc_name = 'TLRT', aow.creation_time, NULL)) AS TLRT,
             MAX(IF(aow.wc_name = 'TLADAS', aow.creation_time, NULL)) AS TLADAS,
             MAX(IF(aow.wc_name = 'TLTT', aow.creation_time, NULL)) AS TLTT
      FROM work_order wo
      LEFT JOIN at_om_wiptrackinghistory aow ON wo.vin = aow.vin
      WHERE wo.vin IN (${placeholders})
      GROUP BY wo.vin
    `, vins);
    const iotMap = new Map(iotRows.map(r => [r.vin, r]));

    // Формируем результат
    const result = defectRows.map(defect => {
      const v = vehicleMap.get(defect.VIN);
      if (!v) return null;

      const les = storageMap.get(defect.VIN) || {};
      const iot = iotMap.get(defect.VIN) || {};

      const times = {
        CP5: v.CP5,
        CP6: v.CP6,
        TRIMIN: v.TRIMIN,
        CP7: v.CP7,
        CP72: v.CP72,
        TLWA: iot.TLWA,
        TLRT: iot.TLRT,
        TLADAS: iot.TLADAS,
        TLTT: iot.TLTT,
        CPFINAL: v.CPFINAL,
        CP8: v.CP8,
      };

      const checkpoints = ['CP5','CP6','TRIMIN','CP7','CP72','TLWA','TLRT','TLADAS','TLTT','CPFINAL','CP8'];
      let latestCheckpoint = null;
      let latestTime = null;
      for (const cp of checkpoints) {
        if (times[cp]) {
          const t = new Date(times[cp]);
          if (!latestTime || t > latestTime) {
            latestTime = t;
            latestCheckpoint = cp;
          }
        }
      }

      const storageStatus = les.in_storage_status || '';
      const isSold = storageStatus === 'Key_Car_In_Storage_Status_3';
      const hasStorageData = les.ck_no && les.kq_no && les.kw_no &&
                             les.ck_no !== 'N/A' && les.kq_no !== 'N/A' && les.kw_no !== 'N/A';
      const isInStorage = !isSold && hasStorageData;

      let currentZone;
      if (isSold) currentZone = 'Продан';
      else if (isInStorage) currentZone = `${les.ck_no}-${les.kq_no}-${les.kw_no}`;
      else currentZone = latestCheckpoint || 'Планирование';

      return {
        vin: defect.VIN,
        part_name: defect.PART_NAME || '',
        problem_type: defect.PROBLEM_TYPE || '',
        problem_replenish: defect.PROBLEM_REPLENISH || '',
        defect_creation_time: defect.CREATION_TIME,
        material_code: v.material_code,
        sequence_number: v.sequence_number,
        kd_material_no: v.kd_material_no,
        model: v.model,
        material_desc: v.material_desc,
        colour: v.colour,
        CP5: v.CP5,
        CP6: v.CP6,
        TRIMIN: v.TRIMIN,
        CP7: v.CP7,
        CP72: v.CP72,
        TLWA: iot.TLWA || null,
        TLRT: iot.TLRT || null,
        TLADAS: iot.TLADAS || null,
        TLTT: iot.TLTT || null,
        CPFINAL: v.CPFINAL,
        CP8: v.CP8,
        in_storage_time: les.in_storage_time || null,
        out_storage_time: les.out_storage_time || null,
        location: currentZone,
        current_zone: currentZone,
      };
    }).filter(Boolean);

    res.json(result);
  } catch (err) {
    console.error('Ошибка vin-defect-search:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-retrospective', async (req, res) => {
  try {
    const { period = 'all', count, fromDate, toDate } = req.query;

    // Функция получения DRR для одного периода
    const getDrr = async (startDate, endDate, label, type) => {
      const sql = `
        SELECT
          all_cars.MODEL,
          COALESCE(all_cars.TOTAL, 0) AS TOTAL,
          COALESCE(remzone.REMZONE_COUNT, 0) AS REMZONE_COUNT,
          ROUND(100 - COALESCE(remzone.REMZONE_COUNT, 0) * 100.0 / NULLIF(all_cars.TOTAL, 0), 1) AS DRR_PERCENT
        FROM (
          SELECT
            too.product AS MODEL,
            COUNT(DISTINCT tvv.VIN) AS TOTAL
          FROM tm_vhc_vehicle tvv
          JOIN tm_ofm_order too ON too.VIN = tvv.VIN
          JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
          WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
            AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) BETWEEN ? AND ?
          GROUP BY MODEL
        ) all_cars
        LEFT JOIN (
          SELECT
            too.product AS MODEL,
            COUNT(DISTINCT tvv.VIN) AS REMZONE_COUNT
          FROM tm_vhc_vehicle tvv
          JOIN tm_ofm_order too ON too.VIN = tvv.VIN
          JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
          JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN AND tvtlm.node_nature LIKE 'REP%'
          WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
            AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) BETWEEN ? AND ?
          GROUP BY MODEL
        ) remzone ON all_cars.MODEL = remzone.MODEL
        ORDER BY all_cars.MODEL
      `;

      const [rows] = await mesPool.query(sql, [startDate, endDate, startDate, endDate]);
      const result = { label, type };
      let totalSum = 0, cnt = 0;
      rows.forEach(row => {
        result[row.MODEL] = row.DRR_PERCENT;
        if (row.DRR_PERCENT !== null) {
          totalSum += row.DRR_PERCENT;
          cnt++;
        }
      });
      result.total = cnt > 0 ? +(totalSum / cnt).toFixed(1) : 0;
      return result;
    };

    // Вспомогательные функции
    const formatDate = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const getISOWeek = (date) => {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };

    const pad = (num) => String(num).padStart(2, '0');

    const now = new Date();
    const periods = [];

    const typeOrder = { year: 0, month: 1, week: 2, day: 3 };

    if (period === 'all') {
      // существующая логика для всех периодов
      for (let i = 1; i >= 0; i--) {
        const y = now.getFullYear() - i;
        periods.push({ label: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31`, type: 'year' });
      }
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
        periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${String(lastDay).padStart(2, '0')}`, type: 'month' });
      }
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      for (let i = 3; i >= 0; i--) {
        const start = new Date(monday);
        start.setDate(monday.getDate() - i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        const weekNum = getISOWeek(start);
        periods.push({ label: `W${weekNum} ${start.getFullYear()}`, startDate: formatDate(start), endDate: formatDate(end), type: 'week' });
      }
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: formatDate(d), endDate: formatDate(d), type: 'day' });
      }
    } else {
      if (fromDate && toDate) {
        // Генерация периодов на основе заданного диапазона
        let from = new Date(fromDate + 'T00:00:00');
        let to = new Date(toDate + 'T00:00:00');
        if (from > to) [from, to] = [to, from];

        if (period === 'day') {
          for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
            const dateStr = formatDate(d);
            periods.push({
              label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`,
              startDate: dateStr,
              endDate: dateStr,
              type: 'day'
            });
          }
        } else if (period === 'month') {
          let d = new Date(from.getFullYear(), from.getMonth(), 1);
          while (d <= to) {
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            const lastDay = new Date(y, m, 0).getDate();
            const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
            periods.push({
              label: `${monthName} ${y}`,
              startDate: `${y}-${pad(m)}-01`,
              endDate: `${y}-${pad(m)}-${lastDay}`,
              type: 'month'
            });
            d.setMonth(d.getMonth() + 1);
          }
        } else if (period === 'week') {
          const day = from.getDay();
          const monday = new Date(from);
          monday.setDate(from.getDate() - (day === 0 ? 6 : day - 1));
          for (let start = new Date(monday); start <= to; start.setDate(start.getDate() + 7)) {
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            periods.push({
              label: `W${getISOWeek(start)} ${start.getFullYear()}`,
              startDate: formatDate(start),
              endDate: formatDate(end),
              type: 'week'
            });
          }
        } else if (period === 'year') {
          for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
            periods.push({
              label: String(y),
              startDate: `${y}-01-01`,
              endDate: `${y}-12-31`,
              type: 'year'
            });
          }
        }
      } else {
        // Существующая логика на основе count
        const defaultCount = { year: 2, month: 3, week: 4, day: 14 }[period] || 7;
        const limit = parseInt(count, 10) || defaultCount;

        if (period === 'year') {
          for (let i = limit - 1; i >= 0; i--) {
            const y = now.getFullYear() - i;
            periods.push({ label: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31`, type: 'year' });
          }
        } else if (period === 'month') {
          for (let i = limit - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
            const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
            periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${String(lastDay).padStart(2, '0')}`, type: 'month' });
          }
        } else if (period === 'week') {
          const dayOfWeek = now.getDay();
          const monday = new Date(now);
          monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
          for (let i = limit - 1; i >= 0; i--) {
            const start = new Date(monday);
            start.setDate(monday.getDate() - i * 7);
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            const weekNum = getISOWeek(start);
            periods.push({ label: `W${weekNum} ${start.getFullYear()}`, startDate: formatDate(start), endDate: formatDate(end), type: 'week' });
          }
        } else if (period === 'day') {
          for (let i = limit - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: formatDate(d), endDate: formatDate(d), type: 'day' });
          }
        }
      }
    }

    periods.sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || a.startDate.localeCompare(b.startDate));

    const result = [];
    for (const p of periods) {
      result.push(await getDrr(p.startDate, p.endDate, p.label, p.type));
    }

    res.json({ dataPoints: result });
  } catch (err) {
    console.error('Ошибка drr-retrospective:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/problem-grades', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT PROBLEM_GRADE
      FROM (
        SELECT PROBLEM_GRADE FROM at_biw_qm_defect_info
        UNION ALL
        SELECT PROBLEM_GRADE FROM at_paint_qm_defect_info
        UNION ALL
        SELECT PROBLEM_GRADE FROM at_qm_defect_info
      ) t
      WHERE PROBLEM_GRADE IS NOT NULL AND TRIM(PROBLEM_GRADE) <> ''
      ORDER BY PROBLEM_GRADE
    `);
    const grades = rows.map(r => r.PROBLEM_GRADE).filter(Boolean);
    res.json(grades);
  } catch (err) {
    console.error('Ошибка получения классов дефектов:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ================== DPU OFF РЕТРОСПЕКТИВА ==================
app.get('/api/dpu-off-retrospective', async (req, res) => {
  try {
    const { period = 'all', count, fromDate, toDate } = req.query;

    // ===== Расчёт DPU OFF для одного периода =====
    const getDpuOff = async (startDate, endDate, label, type) => {
      // 1. Получаем VIN'ы, прошедшие CPFINAL за период, с их моделями
      const [carsRows] = await mesPool.query(`
        SELECT DISTINCT tvv.VIN, too.product AS MODEL
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
          AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) BETWEEN ? AND ?
      `, [startDate, endDate]);

      // 2. Группируем VIN'ы по моделям
      const modelVins = {};
      carsRows.forEach(r => {
        if (!modelVins[r.MODEL]) modelVins[r.MODEL] = [];
        modelVins[r.MODEL].push(r.VIN);
      });

      const result = { label, type };
      const modelValues = []; // для простого среднего

      // 3. Для каждой модели считаем офлайн-дефекты её VIN'ов
      for (const model of Object.keys(modelVins)) {
        const vins = modelVins[model];
        if (vins.length === 0) continue;

        const ph = vins.map(() => '?').join(',');
        const [defRows] = await pool.query(`
          SELECT COUNT(*) AS DEFECTS
          FROM (
            SELECT VIN FROM at_biw_qm_defect_info
              WHERE VIN IN (${ph})
                AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
            UNION ALL
            SELECT VIN FROM at_paint_qm_defect_info
              WHERE VIN IN (${ph})
                AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
            UNION ALL
            SELECT VIN FROM at_qm_defect_info
              WHERE VIN IN (${ph})
                AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
          ) t
        `, [...vins, ...vins, ...vins]);

        const defects = Number(defRows[0]?.DEFECTS) || 0;
        const dpu = +(defects / vins.length).toFixed(2);
        result[model] = dpu;
        modelValues.push(dpu);
      }

      // Total = простое среднее по моделям (как в DRR-ретро)
      result.total = modelValues.length > 0
        ? +(modelValues.reduce((a, b) => a + b, 0) / modelValues.length).toFixed(2)
        : 0;

      return result;
    };

    // ===== Генерация периодов — идентична DRR =====
    const formatDate = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const getISOWeek = (date) => {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };

    const pad = (num) => String(num).padStart(2, '0');
    const now = new Date();
    const periods = [];
    const typeOrder = { year: 0, month: 1, week: 2, day: 3 };

    if (period === 'all') {
      for (let i = 1; i >= 0; i--) {
        const y = now.getFullYear() - i;
        periods.push({ label: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31`, type: 'year' });
      }
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
        periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${String(lastDay).padStart(2, '0')}`, type: 'month' });
      }
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      for (let i = 3; i >= 0; i--) {
        const start = new Date(monday);
        start.setDate(monday.getDate() - i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        const weekNum = getISOWeek(start);
        periods.push({ label: `W${weekNum} ${start.getFullYear()}`, startDate: formatDate(start), endDate: formatDate(end), type: 'week' });
      }
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: formatDate(d), endDate: formatDate(d), type: 'day' });
      }
    } else {
      if (fromDate && toDate) {
        let from = new Date(fromDate + 'T00:00:00');
        let to = new Date(toDate + 'T00:00:00');
        if (from > to) [from, to] = [to, from];

        if (period === 'day') {
          for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
            const dateStr = formatDate(d);
            periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: dateStr, endDate: dateStr, type: 'day' });
          }
        } else if (period === 'month') {
          let d = new Date(from.getFullYear(), from.getMonth(), 1);
          while (d <= to) {
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            const lastDay = new Date(y, m, 0).getDate();
            const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
            periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${pad(m)}-01`, endDate: `${y}-${pad(m)}-${lastDay}`, type: 'month' });
            d.setMonth(d.getMonth() + 1);
          }
        } else if (period === 'week') {
          const day = from.getDay();
          const monday = new Date(from);
          monday.setDate(from.getDate() - (day === 0 ? 6 : day - 1));
          for (let start = new Date(monday); start <= to; start.setDate(start.getDate() + 7)) {
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            periods.push({ label: `W${getISOWeek(start)} ${start.getFullYear()}`, startDate: formatDate(start), endDate: formatDate(end), type: 'week' });
          }
        } else if (period === 'year') {
          for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
            periods.push({ label: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31`, type: 'year' });
          }
        }
      } else {
        const defaultCount = { year: 2, month: 3, week: 4, day: 14 }[period] || 7;
        const limit = parseInt(count, 10) || defaultCount;

        if (period === 'year') {
          for (let i = limit - 1; i >= 0; i--) {
            const y = now.getFullYear() - i;
            periods.push({ label: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31`, type: 'year' });
          }
        } else if (period === 'month') {
          for (let i = limit - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
            const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
            periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${String(lastDay).padStart(2, '0')}`, type: 'month' });
          }
        } else if (period === 'week') {
          const dayOfWeek = now.getDay();
          const monday = new Date(now);
          monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
          for (let i = limit - 1; i >= 0; i--) {
            const start = new Date(monday);
            start.setDate(monday.getDate() - i * 7);
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            const weekNum = getISOWeek(start);
            periods.push({ label: `W${weekNum} ${start.getFullYear()}`, startDate: formatDate(start), endDate: formatDate(end), type: 'week' });
          }
        } else if (period === 'day') {
          for (let i = limit - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: formatDate(d), endDate: formatDate(d), type: 'day' });
          }
        }
      }
    }

    periods.sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || a.startDate.localeCompare(b.startDate));

    const result = [];
    for (const p of periods) {
      result.push(await getDpuOff(p.startDate, p.endDate, p.label, p.type));
    }

    res.json({ dataPoints: result });
  } catch (err) {
    console.error('Ошибка dpu-off-retrospective:', err.message);
    res.status(500).json({ error: err.message });
  }
});


/* ============ Хелпер: фильтр по смене (SQL-фрагмент) ============ */
function getShiftTimeCondition(dateField, shift) {
  if (!shift || shift === 'all') return '';
  const m = `(HOUR(${dateField}) * 60 + MINUTE(${dateField}))`;
  if (shift === 'day')     return ` AND ${m} BETWEEN 470 AND 1000`;
  if (shift === 'evening') return ` AND (${m} >= 1001 OR ${m} <= 90)`;
  if (shift === 'night')   return ` AND ${m} BETWEEN 91 AND 469`;
  return '';
}

app.get('/api/daily-dashboard-week', async (req, res) => {
  try {
    const { weekStart, weekEnd, shift = 'all' } = req.query;

    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);          // ← было +5, теперь +6 (воскресенье)

    const start = weekStart || monday.toISOString().split('T')[0];
    const end   = weekEnd   || sunday.toISOString().split('T')[0];

    const days = [];
    for (let d = new Date(start); d <= new Date(end); d.setDate(d.getDate() + 1)) {
      days.push(d.toISOString().split('T')[0]);
    }

    const cp7Posts = ['CP7','CP7 Audit','CP7 Gate','CP7-gate','CP8 Touch Up','REPAIR','REPAIR_Final','EXT1','PIP2','PIP4','PIP9','REPAIR VERIFICATION','Topcoat preparation'];
    const cp8Posts = ['CP8','CP8 Gate','CP8-gate','360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT'];
    const allCpPosts = [...cp7Posts, ...cp8Posts];
    const postListStr = allCpPosts.map(p => `'${p}'`).join(',');

    const shiftCarsCond   = getShiftTimeCondition('tvvm.scan_time', shift);
    const shiftDefectsCond = getShiftTimeCondition('CREATION_TIME', shift);

    // DRR за день (max по моделям)
    const getMaxDrrForDay = async (date) => {
      const [rows] = await mesPool.query(`
        SELECT
          ROUND(100 - COALESCE(remzone.REMZONE_COUNT, 0) * 100.0 / NULLIF(all_cars.TOTAL, 0), 1) AS DRR
        FROM (
          SELECT too.product AS MODEL, COUNT(DISTINCT tvv.VIN) AS TOTAL
          FROM tm_vhc_vehicle tvv
          JOIN tm_ofm_order too ON too.VIN = tvv.VIN
          JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
          WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
            AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) = ?
            ${shiftCarsCond}
          GROUP BY too.product
        ) all_cars
        LEFT JOIN (
          SELECT too.product AS MODEL, COUNT(DISTINCT tvv.VIN) AS REMZONE_COUNT
          FROM tm_vhc_vehicle tvv
          JOIN tm_ofm_order too ON too.VIN = tvv.VIN
          JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
          JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN AND tvtlm.node_nature LIKE 'REP%'
          WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
            AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) = ?
            ${shiftCarsCond}
          GROUP BY too.product
        ) remzone ON all_cars.MODEL = remzone.MODEL
      `, [date, date]);
      const values = rows.map(r => r.DRR).filter(v => v !== null);
      return values.length > 0 ? Math.max(...values) : 0;
    };

    // DPU (существующий, не трогаем формулу)
    const getDpu = async (date) => {
      const [carsRows] = await pool.query(`
        SELECT COUNT(DISTINCT VIN) AS CARS
        FROM at_om_wiptrackinghistory
        WHERE WC_NAME IN (${postListStr}) AND DATE(CREATION_TIME) = ?
          ${shiftDefectsCond}
      `, [date]);
      const CARS = Number(carsRows?.[0]?.CARS) || 0;

      const [defRows] = await pool.query(`
        SELECT COUNT(*) AS DEFECTS
        FROM (
          SELECT VIN FROM at_biw_qm_defect_info   WHERE DATE(CREATION_TIME) = ? AND (OFFLINE OR OFFLINE1 OR OFFLINE2) AND POST_NAME IN (${postListStr}) ${shiftDefectsCond}
          UNION ALL
          SELECT VIN FROM at_paint_qm_defect_info WHERE DATE(CREATION_TIME) = ? AND (OFFLINE OR OFFLINE1 OR OFFLINE2) AND POST_NAME IN (${postListStr}) ${shiftDefectsCond}
          UNION ALL
          SELECT VIN FROM at_qm_defect_info       WHERE DATE(CREATION_TIME) = ? AND (OFFLINE OR OFFLINE1 OR OFFLINE2) AND POST_NAME IN (${postListStr}) ${shiftDefectsCond}
        ) t
      `, [date, date, date]);
      const DEFECTS = Number(defRows?.[0]?.DEFECTS) || 0;
      return CARS > 0 ? (DEFECTS / CARS).toFixed(1) : '0.0';
    };

    // DPU OFF (новый): оффлайн-дефекты VIN'ов, прошедших CPFinal / количество таких VIN'ов
    const getDpuOff = async (date) => {
      const [carsRows] = await mesPool.query(`
        SELECT DISTINCT tvv.VIN
        FROM tm_vhc_vehicle tvv
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
          AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) = ?
          ${shiftCarsCond}
      `, [date]);

      const vins = [...new Set(carsRows.map(c => c.VIN))];
      if (vins.length === 0) return '0.0';

      const ph = vins.map(() => '?').join(',');
      const [defRows] = await pool.query(`
        SELECT COUNT(*) AS DEFECTS
        FROM (
          SELECT VIN FROM at_biw_qm_defect_info   
            WHERE VIN IN (${ph}) 
              AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
              ${shiftDefectsCond}
          UNION ALL
          SELECT VIN FROM at_paint_qm_defect_info 
            WHERE VIN IN (${ph}) 
              AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
              ${shiftDefectsCond}
          UNION ALL
          SELECT VIN FROM at_qm_defect_info       
            WHERE VIN IN (${ph}) 
              AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
              ${shiftDefectsCond}
        ) t
      `, [...vins, ...vins, ...vins]);

      const DEFECTS = Number(defRows?.[0]?.DEFECTS) || 0;
      return (DEFECTS / vins.length).toFixed(2);
    };

    // Недельный DRR
    const [weekDrrRows] = await mesPool.query(`
      SELECT
        ROUND(100 - COALESCE(remzone.REMZONE_COUNT, 0) * 100.0 / NULLIF(all_cars.TOTAL, 0), 1) AS DRR
      FROM (
        SELECT too.product AS MODEL, COUNT(DISTINCT tvv.VIN) AS TOTAL
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
          AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) BETWEEN ? AND ?
          ${shiftCarsCond}
        GROUP BY too.product
      ) all_cars
      LEFT JOIN (
        SELECT too.product AS MODEL, COUNT(DISTINCT tvv.VIN) AS REMZONE_COUNT
        FROM tm_vhc_vehicle tvv
        JOIN tm_ofm_order too ON too.VIN = tvv.VIN
        JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
        JOIN tm_vhc_test_line_movement tvtlm ON tvtlm.VIN = tvv.VIN AND tvtlm.node_nature LIKE 'REP%'
        WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
          AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) BETWEEN ? AND ?
          ${shiftCarsCond}
        GROUP BY too.product
      ) remzone ON all_cars.MODEL = remzone.MODEL
    `, [start, end, start, end]);
    const weekDrrValues = weekDrrRows.map(r => r.DRR).filter(v => v !== null);
    const weekDrr = weekDrrValues.length > 0 ? Math.max(...weekDrrValues) : 0;

    // Недельный DPU
    const [weekCarsRows] = await pool.query(`
      SELECT COUNT(DISTINCT VIN) AS CARS
      FROM at_om_wiptrackinghistory
      WHERE WC_NAME IN (${postListStr}) AND DATE(CREATION_TIME) BETWEEN ? AND ?
        ${shiftDefectsCond}
    `, [start, end]);
    const weekCars = Number(weekCarsRows?.[0]?.CARS) || 0;

    const [weekDefRows] = await pool.query(`
      SELECT COUNT(*) AS DEFECTS
      FROM (
        SELECT VIN FROM at_biw_qm_defect_info   WHERE DATE(CREATION_TIME) BETWEEN ? AND ? AND (OFFLINE OR OFFLINE1 OR OFFLINE2) AND POST_NAME IN (${postListStr}) ${shiftDefectsCond}
        UNION ALL
        SELECT VIN FROM at_paint_qm_defect_info WHERE DATE(CREATION_TIME) BETWEEN ? AND ? AND (OFFLINE OR OFFLINE1 OR OFFLINE2) AND POST_NAME IN (${postListStr}) ${shiftDefectsCond}
        UNION ALL
        SELECT VIN FROM at_qm_defect_info       WHERE DATE(CREATION_TIME) BETWEEN ? AND ? AND (OFFLINE OR OFFLINE1 OR OFFLINE2) AND POST_NAME IN (${postListStr}) ${shiftDefectsCond}
      ) t
    `, [start, end, start, end, start, end]);
    const weekDefects = Number(weekDefRows?.[0]?.DEFECTS) || 0;
    const weekDpu = weekCars > 0 ? (weekDefects / weekCars).toFixed(1) : '0.0';

    // Недельный DPU OFF
    const [weekCpFinalRows] = await mesPool.query(`
      SELECT DISTINCT tvv.VIN
      FROM tm_vhc_vehicle tvv
      JOIN tm_vhc_vehicle_movement tvvm ON tvv.id = tvvm.tm_vhc_vehicle_id
      WHERE tvvm.node_nature = 'Key_Uloc_Type_CPFINAL'
        AND DATE(DATE_SUB(tvvm.scan_time, INTERVAL 470 MINUTE)) BETWEEN ? AND ?
        ${shiftCarsCond}
    `, [start, end]);
    const weekCpFinalVins = [...new Set(weekCpFinalRows.map(r => r.VIN))];

    let weekDpuOff = '0.0';
    if (weekCpFinalVins.length > 0) {
      const ph = weekCpFinalVins.map(() => '?').join(',');
      const [weekDefOffRows] = await pool.query(`
        SELECT COUNT(*) AS DEFECTS
        FROM (
          SELECT VIN FROM at_biw_qm_defect_info   
            WHERE VIN IN (${ph}) 
              AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
              ${shiftDefectsCond}
          UNION ALL
          SELECT VIN FROM at_paint_qm_defect_info 
            WHERE VIN IN (${ph}) 
              AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
              ${shiftDefectsCond}
          UNION ALL
          SELECT VIN FROM at_qm_defect_info       
            WHERE VIN IN (${ph}) 
              AND ((OFFLINE OR OFFLINE1 OR OFFLINE2) = 1 OR PROBLEM_TYPE = 'Отсутствие')
              ${shiftDefectsCond}
        ) t
      `, [...weekCpFinalVins, ...weekCpFinalVins, ...weekCpFinalVins]);
      const weekDefectsOff = Number(weekDefOffRows?.[0]?.DEFECTS) || 0;
      weekDpuOff = (weekDefectsOff / weekCpFinalVins.length).toFixed(2);
    }

    // Дневные значения
    const drrValues = [];
    const dpuValues = [];
    const dpuOffValues = [];
    for (const day of days) {
      drrValues.push(await getMaxDrrForDay(day));
      dpuValues.push(await getDpu(day));
      dpuOffValues.push(await getDpuOff(day));
    }

    const weekNum = (() => {
      const target = new Date(start);
      const dayNr = (target.getDay() + 6) % 7;
      target.setDate(target.getDate() - dayNr + 3);
      const firstThursday = target.valueOf();
      target.setMonth(0, 1);
      if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
      return 1 + Math.ceil((firstThursday - target) / 604800000);
    })();

    res.json({
      weekNumber: weekNum,
      weekStart: start,
      weekEnd: end,
      days,
      drr: drrValues,
      dpu: dpuValues,
      dpuOff: dpuOffValues,
      weekDrr,
      weekDpu,
      weekDpuOff,
    });
  } catch (err) {
    console.error('Ошибка daily-dashboard-week:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/daily-dashboard-top3', async (req, res) => {
  try {
    const { date, dateFrom, dateTo } = req.query;

    let startDate = dateFrom;
    let endDate = dateTo;
    if (!startDate && !endDate) {
      if (date) { startDate = date; endDate = date; }
      else {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        startDate = endDate = d.toISOString().split('T')[0];
      }
    }
    if (!startDate) startDate = endDate;
    if (!endDate) endDate = startDate;

    const cp7Posts = ['CP7','CP7 Audit','CP7 Gate','CP7-gate','CP8 Touch Up','REPAIR','REPAIR_Final','EXT1','PIP2','PIP4','PIP9','REPAIR VERIFICATION','Topcoat preparation'];
    const cp8Posts = ['CP8','CP8 Gate','CP8-gate','360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT'];
    const allCpPosts = [...cp7Posts, ...cp8Posts];
    const postListStr = allCpPosts.map(p => `'${p}'`).join(',');

    const [rows] = await pool.query(`
      SELECT CONCAT(wo.MODEL, ' - ', d.PART_NAME, ' - ', d.PROBLEM_TYPE) AS DEFECT, COUNT(*) AS CNT
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_qm_defect_info
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr}) AND (d.OFFLINE = 1 OR d.PROBLEM_TYPE = 'Отсутствие')
        AND DATE(d.CREATION_TIME) BETWEEN ? AND ?
      GROUP BY DEFECT
      ORDER BY CNT DESC
      LIMIT 3
    `, [startDate, endDate]);

    res.json(rows.map(r => ({ defect: r.DEFECT, count: r.CNT })));
  } catch (err) {
    console.error('Ошибка daily-dashboard-top3:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/daily-dashboard-top5', async (req, res) => {
  try {
    const { date, dateFrom, dateTo, grades } = req.query;

    let startDate = dateFrom;
    let endDate = dateTo;
    if (!startDate && !endDate) {
      if (date) { startDate = date; endDate = date; }
      else {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        startDate = endDate = d.toISOString().split('T')[0];
      }
    }
    if (!startDate) startDate = endDate;
    if (!endDate) endDate = startDate;

    const cp7Posts = ['CP7','CP7 Audit','CP7 Gate','CP7-gate','CP8 Touch Up','REPAIR','REPAIR_Final','EXT1','PIP2','PIP4','PIP9','REPAIR VERIFICATION','Topcoat preparation'];
    const cp8Posts = ['CP8','CP8 Gate','CP8-gate','360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT'];
    const allCpPosts = [...cp7Posts, ...cp8Posts];
    const postListStr = allCpPosts.map(p => `'${p}'`).join(',');

    let where = `WHERE d.POST_NAME IN (${postListStr}) AND (d.OFFLINE = 1 OR d.PROBLEM_TYPE = 'Отсутствие') AND DATE(d.CREATION_TIME) BETWEEN ? AND ?`;
    const params = [startDate, endDate];

    if (grades) {
      const gradesList = grades.split(',').map(g => g.trim()).filter(Boolean);
      if (gradesList.length > 0) {
        where += ` AND d.PROBLEM_GRADE IN (${gradesList.map(() => '?').join(',')})`;
        params.push(...gradesList);
      }
    }

    const [rows] = await pool.query(`
      SELECT CONCAT(wo.MODEL, ' - ', d.PART_NAME, ' - ', d.PROBLEM_TYPE) AS DEFECT, COUNT(*) AS CNT
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, PROBLEM_GRADE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, PROBLEM_GRADE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, PROBLEM_GRADE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_qm_defect_info
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      ${where}
      GROUP BY DEFECT
      ORDER BY CNT DESC
      LIMIT 5
    `, params);

    res.json(rows.map(r => ({ defect: r.DEFECT, count: r.CNT })));
  } catch (err) {
    console.error('Ошибка daily-dashboard-top5:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== DRR TOP 3 за неделю ==================
app.get('/api/daily-dashboard-week-top3', async (req, res) => {
  try {
    const { dateFrom, dateTo, shift = 'all' } = req.query;
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });
    }

    const cp7Posts = ['CP7','CP7 Audit','CP7 Gate','CP7-gate','CP8 Touch Up','REPAIR','REPAIR_Final','EXT1','PIP2','PIP4','PIP9','REPAIR VERIFICATION','Topcoat preparation'];
    const cp8Posts = ['CP8','CP8 Gate','CP8-gate','360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT'];
    const allCpPosts = [...cp7Posts, ...cp8Posts];
    const postListStr = allCpPosts.map(p => `'${p}'`).join(',');

    const shiftCond = getShiftTimeCondition('d.CREATION_TIME', shift);

    const [rows] = await pool.query(`
      SELECT CONCAT(wo.MODEL, ' - ', d.PART_NAME, ' - ', d.PROBLEM_TYPE) AS DEFECT, COUNT(*) AS CNT
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_qm_defect_info
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr})
        AND (d.OFFLINE = 1 OR d.PROBLEM_TYPE = 'Отсутствие')
        AND DATE(d.CREATION_TIME) BETWEEN ? AND ?
        ${shiftCond}
      GROUP BY DEFECT
      ORDER BY CNT DESC
      LIMIT 3
    `, [dateFrom, dateTo]);

    res.json(rows.map(r => ({ defect: r.DEFECT, count: r.CNT })));
  } catch (err) {
    console.error('Ошибка daily-dashboard-week-top3:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== WARRANTY ==================

// Проверка пароля
app.post('/api/warranty/check-password', (req, res) => {
  const { password } = req.body;
  const correctPassword = BRIGADE_PASSWORD;
  if (password === correctPassword) {
    res.json({ success: true });
  } else {
    res.status(403).json({ success: false, error: 'Неверный пароль' });
  }
});

// Загрузка Excel-данных
app.post('/api/warranty/upload', express.json({ limit: '100mb' }), async (req, res) => {
  try {
    const { rows } = req.body;
    if (!rows || !rows.length) return res.status(400).json({ error: 'Нет данных' });

    const normalizeKey = (str) => String(str).trim().toLowerCase().replace(/\s+/g, ' ');
    const getVal = (row, ...possibleNames) => {
      for (const name of possibleNames) {
        if (row[name] !== undefined) return row[name];
      }
      const rowNormalized = {};
      Object.keys(row).forEach(key => { rowNormalized[normalizeKey(key)] = row[key]; });
      for (const name of possibleNames) {
        const normName = normalizeKey(name);
        if (rowNormalized[normName] !== undefined) return rowNormalized[normName];
      }
      return undefined;
    };

    const parseDate = (val) => {
      if (val === undefined || val === null || val === '') return null;
      if (typeof val === 'number') {
        const date = new Date((val - 25569) * 86400 * 1000);
        return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
      }
      if (typeof val === 'string') {
        let d = new Date(val);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        const parts = val.split('.');
        if (parts.length === 3) {
          d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
          if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        }
        return null;
      }
      return null;
    };

    const dayDiff = (d1, d2) => {
      if (!d1 || !d2) return 0;
      return Math.round((new Date(d1) - new Date(d2)) / 86400000);
    };

    // Формируем значения (без batch_number)
    const allValues = rows.map(row => {
      const vin_id = getVal(row, 'vin_id', 'VIN', 'vin', 'Vin ID') || '';
      const brand = getVal(row, 'brand', 'Brand', 'Марка') || '';
      const model = getVal(row, 'model', 'Model', 'Модель') || '';
      const production_date = parseDate(getVal(row, 'production_date', 'Production Date', 'Дата производства'));
      const sold_date = parseDate(getVal(row, 'sold date', 'sold_date', 'Sold Date', 'Дата продажи'));
      const claim_id = getVal(row, 'Claim ID', 'claim_id', 'ClaimID') || '';
      const document_number = getVal(row, 'Document Number', 'document_number', 'Doc Number') || '';
      const warranty_start_date = parseDate(getVal(row, 'warranty start date', 'warranty_start_date', 'Warranty Start'));
      const customer_complain_date = parseDate(getVal(row, 'Customer complain date', 'customer_complain_date', 'Complain Date'));
      const claims_qty = parseInt(getVal(row, 'Claims qty', 'claims_qty', 'Claims Qty')) || 0;
      const diagnostic_result = getVal(row, 'Diagnostic result', 'diagnostic_result', 'Diagnostic') || '';
      const main_part = getVal(row, 'Main part', 'main_part', 'Main Part') || '';
      const main_part_name = getVal(row, 'Main part name', 'main_part_name', 'Part Name') || '';
      const category = getVal(row, 'Категория', 'category', 'Category') || '';
      const totalPaid = parseFloat(getVal(row, 'Total amount paid to dealers RUR', 'total_amount_paid_dealers_rur', 'Стоимость', 'cost', 'Cost')) || 0;

      const qty_sell = vin_id ? 1 : 0;
      const delta = customer_complain_date && warranty_start_date ? dayDiff(customer_complain_date, warranty_start_date) : 0;
      const mis_0 = customer_complain_date && warranty_start_date ? (delta >= -60 && delta <= 7 ? 1 : 0) : 0;
      const mis_3 = customer_complain_date && warranty_start_date ? (delta >= -60 && delta <= 90 ? 1 : 0) : 0;
      const mis_0_count = mis_0 * claims_qty;
      const mis_3_count = mis_3 * claims_qty;
      const sold_cars_qty = vin_id ? 1 : 0;
      const unique_vin_by_qr = vin_id ? 1 : 0;

      return [
        vin_id, sold_cars_qty, unique_vin_by_qr, brand, model,
        production_date, sold_date, claim_id, document_number,
        warranty_start_date, customer_complain_date, claims_qty,
        diagnostic_result, main_part, main_part_name, mis_0, mis_3,
        qty_sell, delta, mis_0_count, mis_3_count, category, totalPaid
      ];
    });

    const sql = `
      INSERT INTO warranty_claims 
        (vin_id, sold_cars_qty, unique_vin_by_qr, brand, model, production_date, sold_date,
         claim_id, document_number, warranty_start_date, customer_complain_date, claims_qty,
         diagnostic_result, main_part, main_part_name, mis_0, mis_3, qty_sell, delta,
         mis_0_count, mis_3_count, category, total_amount_paid_dealers_rur)
      VALUES ?
    `;

    // Разбивка на батчи по 10000 строк
    const batchSize = 10000;
    let insertedCount = 0;

    for (let i = 0; i < allValues.length; i += batchSize) {
      const batch = allValues.slice(i, i + batchSize);
      await notesPool.query(sql, [batch]);
      insertedCount += batch.length;
    }

    res.json({ success: true, inserted: insertedCount });
  } catch (err) {
    console.error('Ошибка загрузки warranty:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Получение списка загрузок (по uploaded_at)
app.get('/api/warranty/upload-times', async (req, res) => {
  try {
    const [rows] = await notesPool.query(`
      SELECT DISTINCT DATE_FORMAT(uploaded_at, '%Y-%m-%d %H:%i:%s') AS uploaded_at
      FROM warranty_claims
      WHERE uploaded_at IS NOT NULL
      ORDER BY uploaded_at DESC
    `);
    res.json(rows.map(r => r.uploaded_at));
  } catch (err) {
    console.error('Ошибка получения upload times:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Получение загруженных записей
app.get('/api/warranty/claims', async (req, res) => {
  try {
    const { uploadedAt } = req.query;
    let sql = 'SELECT * FROM warranty_claims';
    const params = [];
    if (uploadedAt) {
      sql += ' WHERE uploaded_at = ?';
      params.push(uploadedAt);
    }
    sql += ' ORDER BY id DESC LIMIT 1000';
    const [rows] = await notesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения warranty claims:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Аналитика Total (Prod Related)
app.get('/api/warranty/analytics', async (req, res) => {
  try {
    const { uploadedAt } = req.query;
    let sql = `
      SELECT 
        DATE_FORMAT(production_date, '%Y-%m') AS month,
        model,
        SUM(qty_sell) AS qty_sell,
        SUM(mis_0_count) AS mis_0,
        SUM(mis_3_count) AS mis_3
      FROM warranty_claims
      WHERE production_date >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
        AND production_date IS NOT NULL
    `;
    const params = [];
    if (uploadedAt && uploadedAt !== '') {
      sql += ' AND DATE_FORMAT(uploaded_at, "%Y-%m-%d %H:%i:%s") = ?';
      params.push(uploadedAt);
    }
    sql += ' GROUP BY month, model ORDER BY month, model';
    const [rows] = await notesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка warranty аналитики:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Аналитика Model Based (Prod Related)
app.get('/api/warranty/analytics-by-model', async (req, res) => {
  try {
    const { uploadedAt } = req.query;
    let sql = `
      SELECT 
        DATE_FORMAT(production_date, '%Y-%m') AS month,
        model,
        SUM(qty_sell) AS qty_sell,
        SUM(mis_3_count) AS mis_3_count
      FROM warranty_claims
      WHERE production_date >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
        AND production_date IS NOT NULL
    `;
    const params = [];
    if (uploadedAt && uploadedAt !== '') {
      sql += ' AND DATE_FORMAT(uploaded_at, "%Y-%m-%d %H:%i:%s") = ?';
      params.push(uploadedAt);
    }
    sql += ' GROUP BY month, model ORDER BY month, model';
    const [rows] = await notesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка аналитики по моделям:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Аналитика 0 MIS/3MIS by sales date
app.get('/api/warranty/analytics-by-sales-date', async (req, res) => {
  try {
    const { uploadedAt } = req.query;
    let sql = `
      SELECT 
        DATE_FORMAT(warranty_start_date, '%Y-%m') AS month,
        model,
        SUM(qty_sell) AS qty_sell,
        SUM(mis_0_count) AS mis_0_count,
        SUM(mis_3_count) AS mis_3_count
      FROM warranty_claims
      WHERE warranty_start_date IS NOT NULL
    `;
    const params = [];
    if (uploadedAt && uploadedAt !== '') {
      sql += ' AND DATE_FORMAT(uploaded_at, "%Y-%m-%d %H:%i:%s") = ?';
      params.push(uploadedAt);
    }
    sql += ' GROUP BY month, model ORDER BY month, model';
    const [rows] = await notesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка аналитики по sales date:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Топ категорий
app.get('/api/warranty/categories-summary', async (req, res) => {
  try {
    const { model, uploadedAt } = req.query;
    let sql = `
      SELECT model, category, SUM(claims_qty) AS total_claims
      FROM warranty_claims
      WHERE category IS NOT NULL AND category != ''
    `;
    const params = [];
    if (model && model !== 'ALL') {
      sql += ' AND model = ?';
      params.push(model);
    }
    if (uploadedAt && uploadedAt !== '') {
      sql += ' AND DATE_FORMAT(uploaded_at, "%Y-%m-%d %H:%i:%s") = ?';
      params.push(uploadedAt);
    }
    sql += ' GROUP BY model, category ORDER BY model, total_claims DESC';
    const [rows] = await notesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения категорий:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Эндпоинт для TL Map
app.get('/api/tl-map', async (req, res) => {
  try {
    const sql = `
      SELECT 
        tlo.vin,
        tlo.node_nature AS vehicle_status,
        SUBSTRING_INDEX(ord.product, ' ', -1) AS model,
        IFNULL(LEFT(SUBSTRING_INDEX(mat.material_desc, '_', 1), 5), '???') AS spec,
        RIGHT(ord.plan_unit_code, 4) AS lot,
        SUBSTR(vh.material_no, 8, 2) AS color,
        vh.sequence_number AS seq,
        MAX(mv.gmt_create) AS entry_time
      FROM tm_vhc_test_line_online tlo
      INNER JOIN tm_vhc_vehicle vh ON tlo.vin = vh.vin
      LEFT JOIN tm_bas_material_relation mat ON mat.material_no = vh.material_no AND mat.is_deleted = 0
      INNER JOIN tm_ofm_order ord ON tlo.vin = ord.vin
      LEFT JOIN tm_vhc_test_line_movement mv ON mv.vin = tlo.vin AND mv.node_nature = tlo.node_nature AND mv.is_deleted = 0
      WHERE tlo.node_nature IN ('TLWA','TLRT','TLADAS','TLTT','CPA')
        AND vh.vehicle_status IN ('Key_Uloc_Type_CP72', 'Key_Uloc_Type_CP7')
      GROUP BY tlo.vin, tlo.node_nature, ord.product, mat.material_desc, ord.plan_unit_code, vh.material_no, vh.sequence_number
      ORDER BY tlo.node_nature, tlo.vin
    `;
    const [rows] = await mesPool.query(sql);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка TL Map:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 1. Количество уникальных машин, прошедших через посты за сегодня
app.get('/api/tl-map-passed-today', async (req, res) => {
  try {
    const sql = `
      SELECT 
        node_nature AS zone_name,
        COUNT(DISTINCT vin) AS passed_count
      FROM tm_vhc_test_line_movement
      WHERE node_nature IN ('TLWA','TLRT','TLADAS','TLTT','CPA')
        AND DATE(gmt_create) = CURDATE()
        AND is_deleted = 0
      GROUP BY node_nature
    `;
    const [rows] = await mesPool.query(sql);
    const result = {};
    rows.forEach(row => {
      result[row.zone_name] = row.passed_count;
    });
    res.json(result);
  } catch (err) {
    console.error('Ошибка TL Map passed today:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. Список ВСЕХ записей прохождения через пост за сегодня (для таблицы)
app.get('/api/tl-map-passed-today-details', async (req, res) => {
  try {
    const { zone } = req.query;
    if (!zone) return res.status(400).json({ error: 'Не указана зона' });

    // Определяем следующий узел для выхода из зоны
    const nextZoneMap = {
      'TLWA': 'TLRT',
      'TLRT': 'TLADAS',
      'TLADAS': 'TLTT',
      'TLTT': 'CPFINAL',
    };
    const nextZone = nextZoneMap[zone] || null;

    // Получаем все записи входов в выбранную зону за сегодня
    const sql = `
      SELECT 
        tvtlm.vin,
        tvtlm.vhc_model AS model,
        tvtlm.material_no,
        tvtlm.sequence_number AS seq,
        tvtlm.gmt_create AS pass_time
      FROM tm_vhc_test_line_movement tvtlm
      WHERE tvtlm.node_nature = ?
        AND DATE(tvtlm.gmt_create) = CURDATE()
        AND tvtlm.is_deleted = 0
      ORDER BY tvtlm.vin, tvtlm.gmt_create ASC
    `;
    const [rows] = await mesPool.query(sql, [zone]);

    if (rows.length === 0 || !nextZone) {
      // Для зон без следующего (например, CPA) выход и длительность не считаем
      const result = rows.map(r => ({ ...r, exit_time: null, duration: null }));
      return res.json(result);
    }

    const vins = [...new Set(rows.map(r => r.vin))];
    const placeholders = vins.map(() => '?').join(',');

    let exitsByVin = {};

    if (nextZone === 'CPFINAL') {
      // Выход из TLTT ищем в ti_mes_movement (uloc_no = 'CPFINAL')
      const cpfinalSql = `
        SELECT vin, scan_time AS gmt_create
        FROM ti_mes_movement
        WHERE vin IN (${placeholders})
          AND uloc_no = 'CPFINAL'
          AND is_deleted = 0
        ORDER BY vin, scan_time ASC
      `;
      const [cpfinalRows] = await mesPool.query(cpfinalSql, vins);
      cpfinalRows.forEach(r => {
        if (!exitsByVin[r.vin]) exitsByVin[r.vin] = [];
        exitsByVin[r.vin].push(new Date(r.gmt_create));
      });
    } else {
      // Выход для TLWA, TLRT, TLADAS ищем в tm_vhc_test_line_movement
      const exitsAllSql = `
        SELECT vin, gmt_create
        FROM tm_vhc_test_line_movement
        WHERE vin IN (${placeholders})
          AND node_nature = ?
          AND is_deleted = 0
        ORDER BY vin, gmt_create ASC
      `;
      const [exitRows] = await mesPool.query(exitsAllSql, [...vins, nextZone]);
      exitRows.forEach(e => {
        if (!exitsByVin[e.vin]) exitsByVin[e.vin] = [];
        exitsByVin[e.vin].push(new Date(e.gmt_create));
      });
    }

    // Для каждой записи входа находим первый выход после входа
    const enriched = rows.map(r => {
      const vinExits = exitsByVin[r.vin] || [];
      const passDate = new Date(r.pass_time);
      let exitTime = null;
      for (const exit of vinExits) {
        if (exit > passDate) {
          exitTime = exit;
          break;
        }
      }
      let duration = null;
      if (exitTime) {
        const diffSec = Math.floor((exitTime - passDate) / 1000);
        if (diffSec >= 0) duration = diffSec;
      }
      return {
        ...r,
        exit_time: exitTime ? exitTime.toISOString() : null,
        duration,
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('Ошибка TL Map passed today details:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tl-map-analytics', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;

    // ---------- 1. VIN, прошедшие CP72 за период ----------
    let cp72Condition = '';
    const cp72Params = [];
    if (startTime) {
      cp72Condition += ' AND cp72.scan_time >= ?';
      cp72Params.push(startTime);
    }
    if (endTime) {
      cp72Condition += ' AND cp72.scan_time <= ?';
      cp72Params.push(endTime);
    }

    const cp72Sql = `
      SELECT DISTINCT vin
      FROM ti_mes_movement AS cp72
      WHERE uloc_no = 'CP72'
        AND is_deleted = 0
        ${cp72Condition}
    `;
    const [cp72Rows] = await mesPool.query(cp72Sql, cp72Params);
    const vins = cp72Rows.map(r => r.vin);
    if (vins.length === 0) return res.json([]);

    const placeholders = vins.map(() => '?').join(',');

    // ---------- 2. Получаем времена CP72 и CPFINAL ----------
    const cp72TimesSql = `
      SELECT vin, MIN(scan_time) AS cp72_time
      FROM ti_mes_movement
      WHERE vin IN (${placeholders})
        AND uloc_no = 'CP72'
        AND is_deleted = 0
      GROUP BY vin
    `;
    const [cp72TimesRows] = await mesPool.query(cp72TimesSql, vins);
    const cp72TimeMap = {};
    cp72TimesRows.forEach(r => { cp72TimeMap[r.vin] = r.cp72_time; });

    const cpfinalTimesSql = `
      SELECT vin, MIN(scan_time) AS cpfinal_time
      FROM ti_mes_movement
      WHERE vin IN (${placeholders})
        AND uloc_no = 'CPFINAL'
        AND is_deleted = 0
      GROUP BY vin
    `;
    const [cpfinalTimesRows] = await mesPool.query(cpfinalTimesSql, vins);
    const cpfinalTimeMap = {};
    cpfinalTimesRows.forEach(r => { cpfinalTimeMap[r.vin] = r.cpfinal_time; });

    // ---------- 3. Все движения TL/REP/CPA из tm_vhc_test_line_movement ----------
    const movementSql = `
      SELECT vin, node_nature, gmt_create
      FROM tm_vhc_test_line_movement
      WHERE vin IN (${placeholders})
        AND is_deleted = 0
      ORDER BY vin, gmt_create ASC
    `;
    const [movementRows] = await mesPool.query(movementSql, vins);

    const movementsByVin = {};
    vins.forEach(vin => { movementsByVin[vin] = []; });
    movementRows.forEach(row => {
      if (movementsByVin[row.vin]) {
        movementsByVin[row.vin].push({ zone: row.node_nature, time: new Date(row.gmt_create) });
      }
    });

    // ---------- 4. Все MES-точки (CP5..CP8, CP72, CPFINAL) ----------
    const mesAllSql = `
      SELECT vin, uloc_no, scan_time
      FROM ti_mes_movement
      WHERE vin IN (${placeholders})
        AND is_deleted = 0
      ORDER BY vin, scan_time ASC
    `;
    const [mesAllRows] = await mesPool.query(mesAllSql, vins);
    const mesPointsByVin = {};
    vins.forEach(vin => { mesPointsByVin[vin] = []; });
    mesAllRows.forEach(r => {
      if (mesPointsByVin[r.vin]) {
        mesPointsByVin[r.vin].push({
          zone: r.uloc_no === 'AGMBS01002' ? 'CP5' :
                r.uloc_no === 'AGMPS01002' ? 'CP6' :
                r.uloc_no === 'AGMAS01001' ? 'TRIMIN' :
                r.uloc_no === 'AGMAS01003' ? 'CP7' :
                r.uloc_no === 'CP72' ? 'CP72' :
                r.uloc_no === 'CPFINAL' ? 'CPFINAL' :
                r.uloc_no === 'AGMAS01004' ? 'CP8' : r.uloc_no,
          time: new Date(r.scan_time)
        });
      }
    });

    // ---------- 5. Складские точки (Inbound/Outbound) ----------
    const [lesRows] = await lesPool.query(
      `SELECT tbs.vin, tbs.in_storage_time, tbs.out_storage_time
       FROM tv_biz_storage_car tbs
       WHERE tbs.vin IN (${placeholders})`,
      vins
    );
    const lesMap = new Map(lesRows.map(r => [r.vin, r]));

    // ---------- 6. Обработка каждого VIN ----------
    const result = [];

    for (const vin of vins) {
      const moves = movementsByVin[vin] || [];
      const mesPoints = mesPointsByVin[vin] || [];
      const les = lesMap.get(vin);

      const cp72Time = cp72TimeMap[vin] ? new Date(cp72TimeMap[vin]) : null;
      const cpfinalTime = cpfinalTimeMap[vin] ? new Date(cpfinalTimeMap[vin]) : null;

      // --- Все точки после CP72 ---
      const allPointsAfterCp72 = [];
      if (cp72Time) {
        mesPoints.forEach(p => {
          if (p.time > cp72Time) allPointsAfterCp72.push(p);
        });
        moves.forEach(m => {
          if (m.time > cp72Time) allPointsAfterCp72.push(m);
        });
        if (les) {
          if (les.in_storage_time && new Date(les.in_storage_time) > cp72Time) {
            allPointsAfterCp72.push({ zone: 'Inbound', time: new Date(les.in_storage_time) });
          }
          if (les.out_storage_time && new Date(les.out_storage_time) > cp72Time) {
            allPointsAfterCp72.push({ zone: 'Outbound', time: new Date(les.out_storage_time) });
          }
        }
      }

      // --- Суммарное время на TL: CPFINAL - CP72, либо последняя точка после CP72 ---
      let totalSec = 0;
      if (cp72Time && cpfinalTime) {
        totalSec = Math.floor((cpfinalTime - cp72Time) / 1000);
        if (totalSec < 0) totalSec = 0;
      } else if (cp72Time && allPointsAfterCp72.length > 0) {
        const lastTime = allPointsAfterCp72.reduce((max, p) => p.time > max ? p.time : max, allPointsAfterCp72[0].time);
        totalSec = Math.floor((lastTime - cp72Time) / 1000);
        if (totalSec < 0) totalSec = 0;
      }

      // --- Ремзоны: суммируем все завершённые сессии + текущая, если есть ---
      let totalRemSeconds = 0;
      let inRem = false;
      let currentRemStart = null;
      let lastRemStart = null;
      let lastRemExit = null;

      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        if (m.zone.startsWith('REP')) {
          if (!inRem) {
            inRem = true;
            currentRemStart = m.time;
            lastRemStart = m.time;
            lastRemExit = null;
          }
        } else {
          if (inRem) {
            const exitTime = m.time;
            const diffMs = exitTime - currentRemStart;
            if (diffMs > 0) {
              totalRemSeconds += Math.floor(diffMs / 1000);
              lastRemExit = exitTime;
            }
            inRem = false;
            currentRemStart = null;
          }
        }
      }

      // Если последняя сессия не завершена (сейчас в ремзоне), добавляем время до текущего момента
      const stillInRem = inRem;
      if (stillInRem && currentRemStart) {
        const now = new Date();
        const diffMs = now - currentRemStart;
        if (diffMs > 0) {
          totalRemSeconds += Math.floor(diffMs / 1000);
        }
      }

      // --- Текущее расположение: самая поздняя точка среди всех источников ---
      const allPointsForLocation = [
        ...mesPoints,
        ...moves,
      ];
      if (les) {
        if (les.in_storage_time) allPointsForLocation.push({ zone: 'Inbound', time: new Date(les.in_storage_time) });
        if (les.out_storage_time) allPointsForLocation.push({ zone: 'Outbound', time: new Date(les.out_storage_time) });
      }

      let currentZone = 'Планирование';
      let maxTime = null;
      allPointsForLocation.forEach(p => {
        if (!maxTime || p.time > maxTime) {
          maxTime = p.time;
          currentZone = p.zone;
        }
      });

      result.push({
        vin,
        current_zone: currentZone,
        total_stay_seconds: totalSec,
        rem_in: lastRemStart ? lastRemStart.toISOString() : null,
        rem_out: stillInRem ? null : (lastRemExit ? lastRemExit.toISOString() : null),
        rem_duration_seconds: totalRemSeconds > 0 ? totalRemSeconds : null,
        in_rem: stillInRem,
      });
    }

    // Сортировка по убыванию суммарного времени
    result.sort((a, b) => b.total_stay_seconds - a.total_stay_seconds);

    // Кумулятивный процент
    const totalAllSeconds = result.reduce((sum, r) => sum + r.total_stay_seconds, 0);
    let cumSum = 0;
    const enriched = result.map(r => {
      cumSum += r.total_stay_seconds;
      r.cum_percent = totalAllSeconds > 0 ? +((cumSum / totalAllSeconds) * 100).toFixed(2) : 0;
      return r;
    });

    res.json(enriched);
  } catch (err) {
    console.error('Ошибка TL Map Analytics:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tl-map-vin-history', async (req, res) => {
  try {
    const { vin } = req.query;
    if (!vin) return res.status(400).json({ error: 'VIN не указан' });

    // 1. TL и REP зоны из tm_vhc_test_line_movement
    const [tlRows] = await mesPool.query(
      `SELECT 
         vin,
         node_nature AS zone,
         gmt_create AS event_time
       FROM tm_vhc_test_line_movement
       WHERE vin = ? AND is_deleted = 0
       ORDER BY gmt_create ASC`,
      [vin]
    );

    // 2. MES чекпоинты из ti_mes_movement
    const [mesRows] = await mesPool.query(
      `SELECT 
         vin,
         CASE 
           WHEN uloc_no = 'AGMBS01002' THEN 'CP5'
           WHEN uloc_no = 'AGMPS01002' THEN 'CP6'
           WHEN uloc_no = 'AGMAS01001' THEN 'TRIMIN'
           WHEN uloc_no = 'AGMAS01003' THEN 'CP7'
           WHEN uloc_no = 'CP72' THEN 'CP72'
           WHEN uloc_no = 'CPFINAL' THEN 'CPFINAL'
           WHEN uloc_no = 'AGMAS01004' THEN 'CP8'
           ELSE uloc_no
         END AS zone,
         scan_time AS event_time
       FROM ti_mes_movement
       WHERE vin = ? AND is_deleted = 0
       ORDER BY scan_time ASC`,
      [vin]
    );

    // 3. Складские события Inbound/Outbound из tv_biz_storage_car
    const [lesRows] = await lesPool.query(
      `SELECT 
         vin,
         'Inbound' AS zone,
         in_storage_time AS event_time
       FROM tv_biz_storage_car
       WHERE vin = ? AND in_storage_time IS NOT NULL
       UNION ALL
       SELECT 
         vin,
         'Outbound' AS zone,
         out_storage_time AS event_time
       FROM tv_biz_storage_car
       WHERE vin = ? AND out_storage_time IS NOT NULL`,
      [vin, vin]
    );

    // Формируем единый массив с указанием источника
    const history = [
      ...tlRows.map(r => ({
        vin: r.vin,
        zone: r.zone,
        event_time: r.event_time,
        source: 'TL Movement'
      })),
      ...mesRows.map(r => ({
        vin: r.vin,
        zone: r.zone,
        event_time: r.event_time,
        source: 'MES Movement'
      })),
      ...lesRows.map(r => ({
        vin: r.vin,
        zone: r.zone,
        event_time: r.event_time,
        source: 'LES Storage'
      }))
    ];

    // Сортируем по времени
    history.sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

    res.json(history);
  } catch (err) {
    console.error('Ошибка TL Map VIN history:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/holds-sgp', async (req, res) => {
  try {
    const sql = `
      SELECT 
        qid.model AS model,
        qid.issue_desc AS issue_desc,
        COUNT(DISTINCT qid.vin) AS quantity,
        MIN(qid.gmt_create) AS hold_date,
        DATEDIFF(CURDATE(), MIN(qid.gmt_create)) AS days_waiting,
        COALESCE(qid.clear_man, qid.create_man) AS responsible,
        '' AS actions,
        DATE_ADD(MIN(qid.gmt_create), INTERVAL 7 DAY) AS planned_date,
        'В процессе' AS status,
        '' AS comment
      FROM higoplat_fusion_les.tv_quality_issue_detail qid
      WHERE qid.is_deleted = 0
        AND qid.status = 0
        AND qid.clear_time IS NULL
      GROUP BY 
        qid.model,
        qid.issue_desc,
        COALESCE(qid.clear_man, qid.create_man)
      ORDER BY 
        qid.model,
        MIN(qid.gmt_create) DESC
    `;
    
    const [rows] = await lesPool.query(sql);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка Holds SGP:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/holds-sgp-all-vins', async (req, res) => {
  try {
    const { models } = req.query;

    let sql = `
      SELECT
        qid.vin                                 AS vin,
        qid.model                               AS model,
        qid.issue_desc                          AS issue_desc,
        COALESCE(qid.clear_man, qid.create_man) AS responsible,
        qid.gmt_create                          AS hold_date,
        'В процессе'                            AS status
      FROM higoplat_fusion_les.tv_quality_issue_detail qid
      WHERE qid.is_deleted = 0
        AND qid.status = 0
        AND qid.clear_time IS NULL
    `;
    const params = [];

    if (models && models !== '') {
      const list = models.split(',').map(m => m.trim()).filter(Boolean);
      if (list.length) {
        sql += ` AND qid.model IN (${list.map(() => '?').join(',')})`;
        params.push(...list);
      }
    }

    sql += ` ORDER BY qid.model, qid.issue_desc, qid.vin, qid.gmt_create`;

    const [rows] = await lesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка holds-sgp-all-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/holds-sgp-retrospective', async (req, res) => {
  try {
    const { models } = req.query;

    // 15 дней: первый — «предыдущий» для расчёта дельты,
    // остальные 14 — отображаемые
    const dates = [];
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    for (let i = 14; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      d.setHours(23, 59, 59, 999);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push({
        dateStr: `${year}-${month}-${day}`,
        endOfDay: d,
      });
    }

    // Отображаемые дни — последние 14 (первый — «до» диапазона)
    const displayDates = dates.slice(1);

    let sql = `
      SELECT 
        qid.model AS model,
        qid.issue_desc AS issue_desc,
        qid.vin,
        qid.gmt_create,
        qid.clear_time
      FROM higoplat_fusion_les.tv_quality_issue_detail qid
      WHERE qid.is_deleted = 0
        AND qid.gmt_create <= ?
    `;

    const params = [dates[dates.length - 1].endOfDay];

    if (models && models !== '') {
      const modelList = models.split(',').map(m => m.trim()).filter(Boolean);
      if (modelList.length > 0) {
        sql += ` AND qid.model IN (${modelList.map(() => '?').join(',')})`;
        params.push(...modelList);
      }
    }

    sql += ` ORDER BY qid.model, qid.issue_desc, qid.gmt_create`;

    const [rows] = await lesPool.query(sql, params);

    // Группировка по model + issue_desc (как было)
    const groupedMap = {};
    rows.forEach(row => {
      const key = `${row.model}_|_${row.issue_desc}`;
      if (!groupedMap[key]) {
        groupedMap[key] = {
          model: row.model,
          issue_desc: row.issue_desc,
          vins: [],
        };
      }
      groupedMap[key].vins.push({
        vin: row.vin,
        gmt_create: row.gmt_create ? new Date(row.gmt_create) : null,
        clear_time: row.clear_time ? new Date(row.clear_time) : null,
      });
    });

    const result = [];
    Object.values(groupedMap).forEach(group => {
      const rowResult = {
        model: group.model,
        issue_desc: group.issue_desc,
      };

      displayDates.forEach(({ dateStr, endOfDay }) => {
        const activeVins = new Set();
        group.vins.forEach(v => {
          if (!v.gmt_create) return;
          const created = v.gmt_create <= endOfDay;
          const notCleared = !v.clear_time || v.clear_time > endOfDay;
          if (created && notCleared) {
            activeVins.add(v.vin);
          }
        });
        if (activeVins.size > 0) {
          rowResult[dateStr] = activeVins.size;
        }
      });

      if (displayDates.some(({ dateStr }) => rowResult[dateStr] > 0)) {
        result.push(rowResult);
      }
    });

    // Уникальные VIN на конец дня (по всем записям, без группировки)
    const uniqueVinsByDate = {};
    dates.forEach(({ dateStr, endOfDay }) => {
      const activeVins = new Set();
      rows.forEach(r => {
        const created = r.gmt_create && new Date(r.gmt_create) <= endOfDay;
        const notCleared = !r.clear_time || new Date(r.clear_time) > endOfDay;
        if (created && notCleared) activeVins.add(r.vin);
      });
      uniqueVinsByDate[dateStr] = activeVins.size;
    });

    // Сортировка (по последнему отображаемому дню, как было)
    const lastDate = displayDates[displayDates.length - 1].dateStr;
    result.sort((a, b) => {
      const aLast = a[lastDate] || 0;
      const bLast = b[lastDate] || 0;
      if (bLast !== aLast) return bLast - aLast;
      return a.model.localeCompare(b.model);
    });

    res.json({ rows: result, uniqueVinsByDate });
  } catch (err) {
    console.error('Ошибка Holds SGP retrospective:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Получение VIN для конкретного холда на конкретную дату
// Поддерживает два режима:
//   issue_desc — точное совпадение (режим «Холды по батчам»)
//   reason     — агрегированная причина (режим «Агрегированные причины»)
app.get('/api/holds-sgp-retrospective-vins', async (req, res) => {
  try {
    const { model, issue_desc, issue_descs, reason, date } = req.query;
    if (!model || !date) {
      return res.status(400).json({ error: 'model и date обязательны' });
    }

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    let whereIssue = '';
    const params = [model];

    if (issue_desc) {
      whereIssue = ` AND qid.issue_desc = ? `;
      params.push(issue_desc);
    } else if (reason) {
      // Поиск по агрегированной причине (с учетом хвостов)
      whereIssue = ` AND (
        qid.issue_desc = ? 
        OR qid.issue_desc LIKE CONCAT(?, ' - по%') 
        OR qid.issue_desc LIKE CONCAT(?, ' по%')
        OR qid.issue_desc LIKE CONCAT(?, '- по%')
        OR qid.issue_desc LIKE CONCAT(?, '-по%')
      ) `;
      params.push(reason, reason, reason, reason, reason);
    } else if (issue_descs) {
      try {
        const descList = JSON.parse(issue_descs);
        if (Array.isArray(descList) && descList.length > 0) {
          whereIssue = ` AND qid.issue_desc IN (${descList.map(() => '?').join(',')}) `;
          params.push(...descList);
        } else {
          return res.json([]);
        }
      } catch (e) {
        return res.status(400).json({ error: 'Неверный формат issue_descs' });
      }
    } else {
      return res.status(400).json({ error: 'Не передан ни issue_desc, ни issue_descs, ни reason' });
    }

    params.push(endOfDay, endOfDay);

    const sql = `
      SELECT DISTINCT qid.vin
      FROM higoplat_fusion_les.tv_quality_issue_detail qid
      WHERE qid.is_deleted = 0
        AND qid.model = ?
        ${whereIssue}
        AND qid.gmt_create <= ?
        AND (qid.clear_time > ? OR qid.clear_time IS NULL)
      ORDER BY qid.vin
    `;

    const [rows] = await lesPool.query(sql, params);
    res.json(rows.map(r => r.vin));
  } catch (err) {
    console.error('Ошибка получения VIN для ретроспективы:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/holds-sgp-retrospective-all-vins', async (req, res) => {
  try {
    const { date, models } = req.query;
    if (!date) return res.status(400).json({ error: 'date обязателен' });

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // 1. Все активные VIN на конец дня
    let sql = `
      SELECT DISTINCT
        qid.model       AS model,
        qid.issue_desc  AS issue_desc,
        qid.vin         AS vin
      FROM higoplat_fusion_les.tv_quality_issue_detail qid
      WHERE qid.is_deleted = 0
        AND qid.gmt_create <= ?
        AND (qid.clear_time > ? OR qid.clear_time IS NULL)
    `;
    const params = [endOfDay, endOfDay];

    if (models && models !== '') {
      const list = models.split(',').map(m => m.trim()).filter(Boolean);
      if (list.length) {
        sql += ` AND qid.model IN (${list.map(() => '?').join(',')})`;
        params.push(...list);
      }
    }

    sql += ` ORDER BY qid.model, qid.issue_desc, qid.vin`;

    const [rows] = await lesPool.query(sql, params);
    if (!rows.length) return res.json([]);

    const vinList = [...new Set(rows.map(r => r.vin))];
    const placeholders = vinList.map(() => '?').join(',');

    // 2. MES: времена прохождения точек
    const [mesRows] = await mesPool.query(
      `SELECT vin,
              MAX(IF(uloc_no = 'AGMBS01002', scan_time, NULL)) AS CP5,
              MAX(IF(uloc_no = 'AGMPS01002', scan_time, NULL)) AS CP6,
              MAX(IF(uloc_no = 'AGMAS01001', scan_time, NULL)) AS TRIMIN,
              MAX(IF(uloc_no = 'AGMAS01003', scan_time, NULL)) AS CP7,
              MAX(IF(uloc_no = 'CP72', scan_time, NULL)) AS CP72,
              MAX(IF(uloc_no = 'CPFINAL', scan_time, NULL)) AS CPFINAL,
              MAX(IF(uloc_no = 'AGMAS01004', scan_time, NULL)) AS CP8
       FROM ti_mes_movement
       WHERE vin IN (${placeholders}) AND is_deleted = 0
       GROUP BY vin`,
      vinList
    );

    // 3. IOT: TL-точки
    const [iotRows] = await pool.query(
      `SELECT wo.vin,
              MAX(IF(aow.WC_NAME = 'TLWA', aow.CREATION_TIME, NULL)) AS TLWA,
              MAX(IF(aow.WC_NAME = 'TLRT', aow.CREATION_TIME, NULL)) AS TLRT,
              MAX(IF(aow.WC_NAME = 'TLADAS', aow.CREATION_TIME, NULL)) AS TLADAS,
              MAX(IF(aow.WC_NAME = 'TLTT', aow.CREATION_TIME, NULL)) AS TLTT
       FROM work_order wo
       LEFT JOIN at_om_wiptrackinghistory aow ON wo.vin = aow.vin
       WHERE wo.vin IN (${placeholders})
       GROUP BY wo.vin`,
      vinList
    );

    // 4. LES: складские данные
    const [storageRows] = await lesPool.query(
      `SELECT vin, ck_no, kq_no, kw_no, out_storage_time, in_storage_status
       FROM tv_biz_storage_car
       WHERE vin IN (${placeholders})`,
      vinList
    );

    const mesMap = new Map(mesRows.map(r => [r.vin, r]));
    const iotMap = new Map(iotRows.map(r => [r.vin, r]));
    const storageMap = new Map(storageRows.map(r => [r.vin, r]));

    const checkpoints = ['CP5','CP6','TRIMIN','CP7','CP72','TLWA','TLRT','TLADAS','TLTT','CPFINAL','CP8'];

    const locationMap = new Map();
    vinList.forEach(vin => {
      const m = mesMap.get(vin) || {};
      const i = iotMap.get(vin) || {};
      const s = storageMap.get(vin);

      const times = {
        CP5: m.CP5, CP6: m.CP6, TRIMIN: m.TRIMIN, CP7: m.CP7, CP72: m.CP72,
        TLWA: i.TLWA, TLRT: i.TLRT, TLADAS: i.TLADAS, TLTT: i.TLTT,
        CPFINAL: m.CPFINAL, CP8: m.CP8,
      };

      let latestCheckpoint = null;
      let latestTime = null;
      for (const cp of checkpoints) {
        if (times[cp]) {
          const t = new Date(times[cp]);
          if (!latestTime || t > latestTime) {
            latestTime = t;
            latestCheckpoint = cp;
          }
        }
      }

      const isSold = s && s.in_storage_status === 'Key_Car_In_Storage_Status_3';
      const hasStorageData =
        s && s.ck_no && s.kq_no && s.kw_no &&
        s.ck_no !== 'N/A' && s.kq_no !== 'N/A' && s.kw_no !== 'N/A';
      const isInStorage = !isSold && hasStorageData;

      let location = '';
      if (isSold) {
        location = 'Продан';
      } else if (isInStorage) {
        location = `${s.ck_no}-${s.kq_no}-${s.kw_no}`;
      } else if (latestCheckpoint) {
        location = latestCheckpoint;
      }

      locationMap.set(vin, location);
    });

    // 5. Склеиваем: одна запись на пару (model, issue_desc, vin)
    const result = rows.map(r => ({
      model: r.model,
      issue_desc: r.issue_desc,
      vin: r.vin,
      location: locationMap.get(r.vin) || '',
    }));

    res.json(result);
  } catch (err) {
    console.error('Ошибка holds-sgp-retrospective-all-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/holds-sgp-history', async (req, res) => {
  try {
    const { period = 'all', count, fromDate, toDate, model } = req.query;

    const periods = [];
    const now = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    const formatDateStr = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const getISOWeek = (date) => {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };

    if (period === 'all') {
      // 3 месяца
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${pad(lastDay)}`, type: 'month' });
      }
      // 4 недели (УБРАЛИ ГОД)
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      for (let i = 3; i >= 0; i--) {
        const start = new Date(monday);
        start.setDate(monday.getDate() - i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        periods.push({ label: `W${getISOWeek(start)}`, startDate: formatDateStr(start), endDate: formatDateStr(end), type: 'week' });
      }
      // 14 дней
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: formatDateStr(d), endDate: formatDateStr(d), type: 'day' });
      }
    } else {
      const limit = parseInt(count, 10) || { month: 3, week: 4, day: 14, year: 2 }[period];
      if (period === 'year') {
        for (let i = limit - 1; i >= 0; i--) {
          const y = now.getFullYear() - i;
          periods.push({ label: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31`, type: 'year' });
        }
      } else if (period === 'month') {
        for (let i = limit - 1; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
          const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
          periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${pad(lastDay)}`, type: 'month' });
        }
      } else if (period === 'week') {
        const dayOfWeek = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        for (let i = limit - 1; i >= 0; i--) {
          const start = new Date(monday);
          start.setDate(monday.getDate() - i * 7);
          const end = new Date(start);
          end.setDate(start.getDate() + 6);
          // УБРАЛИ ГОД
          periods.push({ label: `W${getISOWeek(start)}`, startDate: formatDateStr(start), endDate: formatDateStr(end), type: 'week' });
        }
      } else if (period === 'day') {
        for (let i = limit - 1; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(now.getDate() - i);
          periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: formatDateStr(d), endDate: formatDateStr(d), type: 'day' });
        }
      }
    }

    const fetchCount = async (startDate, endDate) => {
      let sql = `
        SELECT COUNT(DISTINCT vin) AS count
        FROM higoplat_fusion_les.tv_quality_issue_detail
        WHERE is_deleted = 0
          AND gmt_create <= ? 
          AND (clear_time > ? OR clear_time IS NULL)
      `;
      const params = [`${endDate} 23:59:59`, `${endDate} 23:59:59`];
      
      if (model && model !== 'ALL') {
        sql += ` AND model = ?`;
        params.push(model);
      }
      const [rows] = await lesPool.query(sql, params);
      return rows[0]?.count || 0;
    };

    const results = [];
    for (const p of periods) {
      const count = await fetchCount(p.startDate, p.endDate);
      results.push({ ...p, count });
    }

    if (period === 'all') {
      res.json({
        months: results.filter(r => r.type === 'month'),
        weeks: results.filter(r => r.type === 'week'),
        days: results.filter(r => r.type === 'day')
      });
    } else {
      res.json({ data: results });
    }
  } catch (err) {
    console.error('Ошибка holds-sgp-history:', err.message);
    res.status(500).json({ error: err.message });
  }
});





// Хелпер для форматирования даты без сдвига UTC
const formatLocalDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Справочник дефектов по цехам
app.get('/api/part-defect-shop-mapping', async (req, res) => {
  try {
    const [rows] = await notesPool.query('SELECT * FROM part_defect_shop_mapping ORDER BY part_name, defect_type');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения справочника:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Обновление справочника
app.post('/api/part-defect-shop-mapping', async (req, res) => {
  try {
    const { mappings } = req.body;
    if (!mappings || !mappings.length) return res.status(400).json({ error: 'Нет данных' });
    
    const sql = 'INSERT INTO part_defect_shop_mapping (part_name, defect_type, shop) VALUES ? ON DUPLICATE KEY UPDATE shop = VALUES(shop)';
    const values = mappings.map(m => [m.part_name, m.defect_type, m.shop]);
    
    await notesPool.query(sql, [values]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка обновления справочника:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DRR по цехам
// DRR по цехам
app.get('/api/drr-by-shop', async (req, res) => {
  try {
    const { weeks = 10 } = req.query;

    const [mappingRows] = await notesPool.query('SELECT * FROM part_defect_shop_mapping');
    if (!mappingRows.length) return res.json({ weeks: [], AS: [], BS: [], PS: [], LS: [], hasMapping: false });

    const shopMapping = { AS: [], BS: [], PS: [], LS: [] };
    mappingRows.forEach(m => {
      if (shopMapping[m.shop]) {
        shopMapping[m.shop].push({
          part_name: String(m.part_name).trim(),
          defect_type: String(m.defect_type).trim(),
        });
      }
    });

    const today = new Date();
    const currentMonday = new Date(today);
    const dayOfWeek = today.getDay();
    currentMonday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

    const result = { weeks: [], AS: [], BS: [], PS: [], LS: [], hasMapping: true };

    for (let i = 0; i < weeks; i++) {
      const monday = new Date(currentMonday);
      monday.setDate(currentMonday.getDate() - i * 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const weekStart = formatLocalDate(monday);
      const weekEnd = formatLocalDate(sunday);
      const weekNum = getISOWeek(monday);

      result.weeks.unshift(`CW${weekNum}`);

      // LS добавлен в цикл наравне с AS/BS/PS
      for (const shop of ['AS', 'BS', 'PS', 'LS']) {
        const parts = shopMapping[shop];

        if (!parts.length) {
          result[shop].unshift(0);
          continue;
        }

        const [carsRows] = await pool.query(`
          SELECT COUNT(DISTINCT VIN) AS TOTAL
          FROM at_om_wiptrackinghistory
          WHERE DATE(CREATION_TIME) BETWEEN ? AND ?
        `, [weekStart, weekEnd]);
        const totalCars = carsRows[0]?.TOTAL || 0;

        const conditions = [];
        const params = [];
        parts.forEach(p => {
          conditions.push('(TRIM(PART_NAME) = ? AND TRIM(PROBLEM_TYPE) = ?)');
          params.push(p.part_name, p.defect_type);
        });
        const whereClause = conditions.join(' OR ');

        // УМНЫЙ КОСТЫЛЬ ПО ЦЕХАМ
        // AS, PS, LS — все дефекты (операторы путают онлайн/оффлайн)
        // BS — оффлайн + только серьёзные онлайн (A/B/A1/B1 или есть replenish)
        let offlineCondition = '';
        if (shop === 'AS' || shop === 'PS' || shop === 'LS') {
          offlineCondition = '1 = 1';
        } else {
          offlineCondition = `
            IS_OFF = 1 
            OR (IS_OFF = 0 AND (PROBLEM_GRADE IN ('A', 'B', 'A1', 'B1') OR (PROBLEM_REPLENISH IS NOT NULL AND TRIM(PROBLEM_REPLENISH) <> '')))
          `;
        }

        const [defectRows] = await pool.query(`
          SELECT COUNT(DISTINCT VIN) AS DEFECT_VINS
          FROM (
            SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, PROBLEM_REPLENISH,
                   (OFFLINE OR OFFLINE1 OR OFFLINE2) AS IS_OFF
            FROM at_biw_qm_defect_info
            WHERE DATE(CREATION_TIME) BETWEEN ? AND ?
            UNION ALL
            SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, PROBLEM_REPLENISH,
                   (OFFLINE OR OFFLINE1 OR OFFLINE2) AS IS_OFF
            FROM at_paint_qm_defect_info
            WHERE DATE(CREATION_TIME) BETWEEN ? AND ?
            UNION ALL
            SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, PROBLEM_REPLENISH,
                   (OFFLINE OR OFFLINE1 OR OFFLINE2) AS IS_OFF
            FROM at_qm_defect_info
            WHERE DATE(CREATION_TIME) BETWEEN ? AND ?
          ) QM_DEF
          WHERE (${whereClause})
            AND (${offlineCondition})
        `, [weekStart, weekEnd, weekStart, weekEnd, weekStart, weekEnd, ...params]);

        const defectVins = defectRows[0]?.DEFECT_VINS || 0;
        let drr = 0;
        if (totalCars > 0) drr = (1 - (defectVins / totalCars)) * 100;

        result[shop].unshift(parseFloat(drr.toFixed(2)));
      }
    }
    res.json(result);
  } catch (err) {
    console.error('Ошибка DRR по цехам:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ТОП ДЕФЕКТОВ ПО ЦЕХУ ==================
app.get('/api/shop-top-defects', async (req, res) => {
  try {
    const { shop, model } = req.query;
    if (!shop) return res.status(400).json({ error: 'shop обязателен' });
    
    const [mappingRows] = await notesPool.query(
      'SELECT part_name, defect_type FROM part_defect_shop_mapping WHERE shop = ?',
      [shop]
    );
    
    if (!mappingRows.length) return res.json({ weeks: [], data: [], hasMapping: false });
    
    const today = new Date();
    const currentMonday = new Date(today);
    const dayOfWeek = today.getDay();
    currentMonday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    
    const weeks = [];
    for (let i = 4; i >= 0; i--) {
      const monday = new Date(currentMonday);
      monday.setDate(currentMonday.getDate() - i * 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      weeks.push({
        weekNum: getISOWeek(monday),
        start: formatLocalDate(monday),
        end: formatLocalDate(sunday),
      });
    }
    
    const conditions = [];
    const mappingParams = [];
    mappingRows.forEach(m => {
      conditions.push('(TRIM(PART_NAME) = ? AND TRIM(PROBLEM_TYPE) = ?)');
      mappingParams.push(String(m.part_name).trim(), String(m.defect_type).trim());
    });
    const whereClause = conditions.join(' OR ');
    
    const allResults = {};
    
    for (const week of weeks) {
      const params = [
        week.start, week.end,
        week.start, week.end,
        week.start, week.end,
        ...mappingParams,
      ];
      
      let joinClause = '';
      let modelCondition = '';
      if (model && model !== 'ALL') {
        joinClause = 'JOIN work_order wo ON wo.VIN = QM_DEF.VIN';
        modelCondition = ' AND wo.MODEL = ?';
        params.push(model);
      }
      
      // ТОТ ЖЕ УМНЫЙ КОСТЫЛЬ
      const sql = `
        SELECT 
          CONCAT(QM_DEF.PART_NAME, '_', QM_DEF.PROBLEM_TYPE) AS defect_name,
          COUNT(DISTINCT QM_DEF.VIN) AS defect_count
        FROM (
          SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, PROBLEM_REPLENISH,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS IS_OFF
          FROM at_biw_qm_defect_info
          WHERE DATE(CREATION_TIME) BETWEEN ? AND ?
          UNION ALL
          SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, PROBLEM_REPLENISH,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS IS_OFF
          FROM at_paint_qm_defect_info
          WHERE DATE(CREATION_TIME) BETWEEN ? AND ?
          UNION ALL
          SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, PROBLEM_REPLENISH,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS IS_OFF
          FROM at_qm_defect_info
          WHERE DATE(CREATION_TIME) BETWEEN ? AND ?
        ) QM_DEF
        ${joinClause}
        WHERE (${whereClause})
          AND (
            IS_OFF = 1 
            OR 
            (IS_OFF = 0 AND (PROBLEM_GRADE IN ('A', 'B', 'A1', 'B1') OR (PROBLEM_REPLENISH IS NOT NULL AND TRIM(PROBLEM_REPLENISH) <> '')))
          )
          ${modelCondition}
        GROUP BY defect_name
        ORDER BY defect_count DESC
      `;
      
      const [rows] = await pool.query(sql, params);
      
      rows.forEach(row => {
        if (!allResults[row.defect_name]) {
          allResults[row.defect_name] = {};
        }
        allResults[row.defect_name][`CW${week.weekNum}`] = row.defect_count;
      });
    }
    
    const data = Object.entries(allResults).map(([name, counts]) => ({
      name,
      ...counts,
    }));
    
    const lastWeekKey = `CW${weeks[weeks.length - 1].weekNum}`;
    data.sort((a, b) => (b[lastWeekKey] || 0) - (a[lastWeekKey] || 0));
    
    res.json({ weeks: weeks.map(w => `CW${w.weekNum}`), data, hasMapping: true });
  } catch (err) {
    console.error('Ошибка shop-top-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// Хелпер для построения условий поиска по полным и коротким VIN
const buildVinClause = (vinList, column = 'vin') => {
  if (!vinList || vinList.length === 0) return { clause: '1=0', params: [] };
  const conditions = [];
  const params = [];
  vinList.forEach(v => {
    const trimmed = String(v).trim();
    if (!trimmed) return;
    if (trimmed.length === 6) {
      conditions.push(`${column} LIKE ?`);
      params.push(`%${trimmed}`);
    } else {
      conditions.push(`${column} = ?`);
      params.push(trimmed);
    }
  });
  return { 
    clause: conditions.length > 0 ? conditions.join(' OR ') : '1=0', 
    params 
  };
};

// SGP Management - данные по всем моделям
app.get('/api/sgp-management', async (req, res) => {
  try {
    const sql = `
      SELECT
        s.vin,
        s.vehicle_type AS model,
        IF(s.block_msg IS NOT NULL AND s.block_msg <> '', 'Блок', 'Не блок') AS block_status,
        q.issue_desc AS reason,
        q.gmt_create AS hold_date,
        CASE 
            WHEN q.status = 1 THEN 'Устранено'
            WHEN q.status = 0 THEN 'Не устранено'
            ELSE '—'
        END AS resolution_status,
        CASE
            WHEN s.in_storage_status = 'Key_Car_In_Storage_Status_3' THEN 'Outbound'
            WHEN s.in_storage_status = 'Key_Car_In_Storage_Status_1' THEN 'In stock'
            WHEN s.in_storage_status = 'Key_Car_In_Storage_Status_2' THEN 'In stock'
            ELSE 'Unknown'
        END AS storage_status,
        CONCAT_WS('-', COALESCE(s.ck_no, ''), COALESCE(s.kq_no, ''), COALESCE(s.kw_no, '')) AS location
      FROM tv_biz_storage_car s
      LEFT JOIN tv_quality_issue_detail q ON q.vin = s.vin
        AND q.is_deleted = 0
      ORDER BY s.vehicle_type, s.vin, q.gmt_create DESC
    `;
    
    const [rows] = await lesPool.query(sql);
    
    // Собираем уникальные VIN
    const vins = [...new Set(rows.map(r => r.vin).filter(Boolean))];
    
    // Получаем комплектацию из MES
    let complectMap = {};
    if (vins.length > 0) {
      const placeholders = vins.map(() => '?').join(',');
      const [complectRows] = await mesPool.query(`
        SELECT too.vin, tbmr.material_desc AS complectation
        FROM tm_ofm_order too
        LEFT JOIN tm_vhc_vehicle tvv ON too.vin = tvv.vin
        LEFT JOIN tm_bas_material_relation tbmr ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
        WHERE too.vin IN (${placeholders})
      `, vins);
      complectRows.forEach(r => { complectMap[r.vin] = r.complectation || ''; });
    }
    
    const result = rows.map(row => ({
      vin: row.vin,
      model: row.model,
      complectation: complectMap[row.vin] || '—',
      block_status: row.block_status,
      reason: row.reason || '',
      hold_date: row.hold_date || null,
      resolution_status: row.resolution_status || '—',
      storage_status: row.storage_status,
      location: row.location || '—',
    }));
    
    res.json(result);
  } catch (err) {
    console.error('Ошибка SGP Management:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/sgp-management-reasons', async (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT 
        SUBSTRING_INDEX(issue_desc, ' - ', 1) AS reason
      FROM tv_quality_issue_detail
      WHERE issue_desc IS NOT NULL AND issue_desc != ''
        AND is_deleted = 0
      ORDER BY reason
    `;
    const [rows] = await lesPool.query(sql);
    res.json(rows.map(r => r.reason).filter(Boolean));
  } catch (err) {
    console.error('Ошибка получения причин:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== TIME POINTS (ВРЕМЯ ПРОХОЖДЕНИЯ ТОЧЕК) ==================

app.get('/api/time-points', async (req, res) => {
  try {
    const {
      vin, materialCode, seqFrom, seqTo, batchNum, partNo,
      kdMaterialNo, model, materialDesc, colour,
      cp5From, cp5To, cp6From, cp6To, trimInFrom, trimInTo,
      cp7From, cp7To, cp72From, cp72To, cpFinalFrom, cpFinalTo, cp8From, cp8To,
      tlwaFrom, tlwaTo, tlrtFrom, tlrtTo, tladasFrom, tladasTo, tlttFrom, tlttTo,
      inboundFrom, inboundTo, outboundFrom, outboundTo,
      currentLocations, excludeLocations,
    } = req.query;

    const kdArray = kdMaterialNo ? kdMaterialNo.split(',').map(s => s.trim()).filter(Boolean) : [];
    const modelArray = model ? model.split(',').map(s => s.trim()).filter(Boolean) : [];
    const complectArray = materialDesc ? materialDesc.split(',').map(s => s.trim()).filter(Boolean) : [];

    const hasLesFilters = inboundFrom || inboundTo || outboundFrom || outboundTo;
    const hasIotFilters = batchNum;

    // --- MES запрос (CP5, CP6, TRIMIN, CP7, CP72, CPFINAL, CP8) ---
    let mesQuery = `
      WITH times AS (
        SELECT
          vin,
          MAX(IF(uloc_no = 'AGMBS01002', scan_time, NULL)) AS CP5,
          MAX(IF(uloc_no = 'AGMPS01002', scan_time, NULL)) AS CP6,
          MAX(IF(uloc_no = 'AGMAS01001', scan_time, NULL)) AS TRIMIN,
          MAX(IF(uloc_no = 'AGMAS01003', scan_time, NULL)) AS CP7,
          MAX(IF(uloc_no = 'CP72', scan_time, NULL)) AS CP72,
          MAX(IF(uloc_no = 'CPFINAL', scan_time, NULL)) AS CPFINAL,
          MAX(IF(uloc_no = 'AGMAS01004', scan_time, NULL)) AS CP8
        FROM ti_mes_movement
        WHERE uloc_no IN ('AGMBS01002','AGMPS01002','AGMAS01001','AGMAS01003','CP72','CPFINAL','AGMAS01004')
          AND is_deleted = 0
        GROUP BY vin
      )
      SELECT
        too.vin,
        too.material_no AS material_code,
        tvv.sequence_number,
        uvkmm.kd_material_no,
        too.product AS model,
        tbmr.material_desc,
        tbmr.ps_material_desc AS colour,
        t.CP5, t.CP6, t.TRIMIN, t.CP7, t.CP72, t.CPFINAL, t.CP8
      FROM tm_ofm_order too 
        LEFT JOIN tm_vhc_vehicle tvv ON too.vin = tvv.vin 
        LEFT JOIN (SELECT DISTINCT material_no, kd_material_no, material_desc, vehicle_type, ps_material_desc FROM tm_bas_material_relation WHERE is_deleted = 0) tbmr ON tbmr.material_no = too.material_no 
        LEFT JOIN (SELECT DISTINCT material_no, kd_material_no FROM udt_vsp_kd_material_mapping WHERE is_deleted = 0) uvkmm ON CONCAT(LEFT(tbmr.material_no, 7), '**', RIGHT(tbmr.material_no, 6)) = uvkmm.material_no AND uvkmm.kd_material_no = tbmr.kd_material_no
        LEFT JOIN times t ON t.vin = too.vin
      WHERE too.is_deleted = 0
    `;
    const mesParams = [];

    // ОБНОВЛЕНО: Поддержка списка VIN и неполных VIN (6 знаков)
    if (vin) {
      const vinArray = vin.split(',').map(v => v.trim()).filter(Boolean);
      const { clause: vinClause, params: vinParams } = buildVinClause(vinArray, 'too.vin');
      mesQuery += ` AND (${vinClause})`;
      mesParams.push(...vinParams);
    }

    if (materialCode) {
      mesQuery += ' AND too.material_no LIKE ?';
      mesParams.push(`%${materialCode}%`);
    }
    if (colour) {
      mesQuery += ' AND tbmr.ps_material_desc = ?';
      mesParams.push(colour);
    }
    if (seqFrom && seqTo) {
      mesQuery += ' AND CAST(tvv.sequence_number AS UNSIGNED) BETWEEN ? AND ?';
      mesParams.push(seqFrom, seqTo);
    } else if (seqFrom) {
      mesQuery += ' AND CAST(tvv.sequence_number AS UNSIGNED) >= ?';
      mesParams.push(seqFrom);
    } else if (seqTo) {
      mesQuery += ' AND CAST(tvv.sequence_number AS UNSIGNED) <= ?';
      mesParams.push(seqTo);
    }
    if (partNo) {
      mesQuery += ` AND EXISTS (
        SELECT 1 FROM r_mat_scanning_records rmsr 
          JOIN r_mat_scanning_detail rmsd ON rmsr.id = rmsd.r_mat_scanning_records_id
        WHERE rmsr.vin = too.vin
          AND rmsd.is_deleted = 0
          AND rmsd.material_code = ?
      )`;
      mesParams.push(partNo);
    }
    if (kdArray.length > 0) {
      mesQuery += ` AND uvkmm.kd_material_no IN (${kdArray.map(() => '?').join(',')})`;
      mesParams.push(...kdArray);
    }
    if (modelArray.length > 0) {
      mesQuery += ` AND too.product IN (${modelArray.map(() => '?').join(',')})`;
      mesParams.push(...modelArray);
    }
    if (complectArray.length > 0) {
      mesQuery += ` AND tbmr.material_desc IN (${complectArray.map(() => '?').join(',')})`;
      mesParams.push(...complectArray);
    }
    if (cp5From) { mesQuery += ' AND t.CP5 >= ?'; mesParams.push(cp5From); }
    if (cp5To) { mesQuery += ' AND t.CP5 <= ?'; mesParams.push(cp5To); }
    if (cp6From) { mesQuery += ' AND t.CP6 >= ?'; mesParams.push(cp6From); }
    if (cp6To) { mesQuery += ' AND t.CP6 <= ?'; mesParams.push(cp6To); }
    if (trimInFrom) { mesQuery += ' AND t.TRIMIN >= ?'; mesParams.push(trimInFrom); }
    if (trimInTo) { mesQuery += ' AND t.TRIMIN <= ?'; mesParams.push(trimInTo); }
    if (cp7From) { mesQuery += ' AND t.CP7 >= ?'; mesParams.push(cp7From); }
    if (cp7To) { mesQuery += ' AND t.CP7 <= ?'; mesParams.push(cp7To); }
    if (cp72From) { mesQuery += ' AND t.CP72 >= ?'; mesParams.push(cp72From); }
    if (cp72To) { mesQuery += ' AND t.CP72 <= ?'; mesParams.push(cp72To); }
    if (cpFinalFrom) { mesQuery += ' AND t.CPFINAL >= ?'; mesParams.push(cpFinalFrom); }
    if (cpFinalTo) { mesQuery += ' AND t.CPFINAL <= ?'; mesParams.push(cpFinalTo); }
    if (cp8From) { mesQuery += ' AND t.CP8 >= ?'; mesParams.push(cp8From); }
    if (cp8To) { mesQuery += ' AND t.CP8 <= ?'; mesParams.push(cp8To); }

    mesQuery += ' ORDER BY t.CP5 DESC';

    const [mesRows] = await mesPool.query(mesQuery, mesParams);
    
    if (mesRows.length === 0) {
      return res.json([]);
    }

    let vehicles = mesRows;
    const vins = vehicles.map(v => v.vin);

    // --- LES фильтр (Inbound/Outbound) ---
    if (hasLesFilters) {
      const lesFilterQuery = `SELECT DISTINCT tbs.vin FROM tv_biz_storage_car tbs WHERE 1=1` +
        (inboundFrom ? ' AND tbs.in_storage_time >= ?' : '') +
        (inboundTo ? ' AND tbs.in_storage_time <= ?' : '') +
        (outboundFrom ? ' AND tbs.out_storage_time >= ?' : '') +
        (outboundTo ? ' AND tbs.out_storage_time <= ?' : '');
      const lesFilterParams = [
        ...(inboundFrom ? [inboundFrom] : []),
        ...(inboundTo ? [inboundTo] : []),
        ...(outboundFrom ? [outboundFrom] : []),
        ...(outboundTo ? [outboundTo] : [])
      ];
      const [lesFilterRows] = await lesPool.query(lesFilterQuery, lesFilterParams);
      const lesVins = new Set(lesFilterRows.map(r => r.vin));
      vehicles = vehicles.filter(v => lesVins.has(v.vin));
    }

    // --- IOT фильтр (batch_num) ---
    if (hasIotFilters) {
      const iotFilterQuery = `SELECT DISTINCT wo.vin FROM work_order wo WHERE 1=1` +
        (batchNum ? ' AND wo.batch_num = ?' : '');
      const iotFilterParams = batchNum ? [batchNum] : [];
      const [iotFilterRows] = await pool.query(iotFilterQuery, iotFilterParams);
      const iotVins = new Set(iotFilterRows.map(r => r.vin));
      vehicles = vehicles.filter(v => iotVins.has(v.vin));
    }

    if (vehicles.length === 0) {
      return res.json([]);
    }

    const filteredVins = vehicles.map(v => v.vin);
    const placeholders = filteredVins.map(() => '?').join(',');

    // --- Обогащение LES (in_storage_time, out_storage_time, складские поля) ---
    const lesDataPromise = lesPool.query(
      `SELECT tbs.vin, tbs.in_storage_time, tbs.out_storage_time,
              tbs.ck_no, tbs.kq_no, tbs.kw_no
       FROM tv_biz_storage_car tbs
       WHERE tbs.vin IN (${placeholders})`,
      [...filteredVins]
    );

    // --- Обогащение IOT (batch_num, TLWA, TLRT, TLADAS, TLTT) ---
    const iotDataPromise = pool.query(
      `SELECT wo.vin, wo.batch_num,
              MAX(IF(aow.wc_name = 'TLWA', aow.creation_time, NULL)) AS TLWA,
              MAX(IF(aow.wc_name = 'TLRT', aow.creation_time, NULL)) AS TLRT,
              MAX(IF(aow.wc_name = 'TLADAS', aow.creation_time, NULL)) AS TLADAS,
              MAX(IF(aow.wc_name = 'TLTT', aow.creation_time, NULL)) AS TLTT
       FROM work_order wo
       LEFT JOIN at_om_wiptrackinghistory aow ON wo.vin = aow.vin
       WHERE wo.vin IN (${placeholders})
       GROUP BY wo.vin, wo.batch_num`,
      [...filteredVins]
    );

    const [[lesRows], [iotRows]] = await Promise.all([lesDataPromise, iotDataPromise]);

    // Слияние LES + добавление storage_location
    const lesMap = new Map(lesRows.map(r => [r.vin, r]));
    vehicles = vehicles.map(v => {
      const les = lesMap.get(v.vin);
      const storageLocation = les 
        ? [les.ck_no, les.kq_no, les.kw_no].filter(Boolean).join('-') 
        : '';
      return {
        ...v,
        in_storage_time: les?.in_storage_time || null,
        out_storage_time: les?.out_storage_time || null,
        storage_location: storageLocation || null,
      };
    });

    // Слияние IoT
    const iotMap = new Map(iotRows.map(r => [r.vin, r]));
    vehicles = vehicles.map(v => ({
      ...v,
      batch_num: iotMap.get(v.vin)?.batch_num || null,
      TLWA: iotMap.get(v.vin)?.TLWA || null,
      TLRT: iotMap.get(v.vin)?.TLRT || null,
      TLADAS: iotMap.get(v.vin)?.TLADAS || null,
      TLTT: iotMap.get(v.vin)?.TLTT || null,
    }));

    // Вычисление location
    vehicles = vehicles.map(v => {
      let location = 'Планирование';
      if (v.out_storage_time) location = 'Продан';
      else if (v.in_storage_time) location = 'На складе';
      else if (v.CP8) location = 'CP8';
      else if (v.CPFINAL) location = 'CPFINAL';
      else if (v.TLWA || v.TLRT || v.TLADAS || v.TLTT) location = 'На тестах';
      else if (v.CP72) location = 'CP72';
      else if (v.CP7) location = 'CP7';
      else if (v.TRIMIN) location = 'TRIMIN';
      else if (v.CP6) location = 'CP6';
      else if (v.CP5) location = 'CP5';
      return { ...v, location };
    });

    // Фильтрация по расположению
    if (currentLocations) {
      const curArr = currentLocations.split(',').map(s => s.trim()).filter(Boolean);
      vehicles = vehicles.filter(v => curArr.includes(v.location));
    }
    if (excludeLocations) {
      const excArr = excludeLocations.split(',').map(s => s.trim()).filter(Boolean);
      vehicles = vehicles.filter(v => !excArr.includes(v.location));
    }

    // Фильтры TLWA/TLRT/TLADAS/TLTT
    if (tlwaFrom) vehicles = vehicles.filter(v => v.TLWA && new Date(v.TLWA) >= new Date(tlwaFrom));
    if (tlwaTo) vehicles = vehicles.filter(v => v.TLWA && new Date(v.TLWA) <= new Date(tlwaTo));
    if (tlrtFrom) vehicles = vehicles.filter(v => v.TLRT && new Date(v.TLRT) >= new Date(tlrtFrom));
    if (tlrtTo) vehicles = vehicles.filter(v => v.TLRT && new Date(v.TLRT) <= new Date(tlrtTo));
    if (tladasFrom) vehicles = vehicles.filter(v => v.TLADAS && new Date(v.TLADAS) >= new Date(tladasFrom));
    if (tladasTo) vehicles = vehicles.filter(v => v.TLADAS && new Date(v.TLADAS) <= new Date(tladasTo));
    if (tlttFrom) vehicles = vehicles.filter(v => v.TLTT && new Date(v.TLTT) >= new Date(tlttFrom));
    if (tlttTo) vehicles = vehicles.filter(v => v.TLTT && new Date(v.TLTT) <= new Date(tlttTo));

    res.json(vehicles);
  } catch (err) {
    console.error('Ошибка time-points:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Компоненты автомобиля
app.get('/api/time-points/:vin/components', async (req, res) => {
  try {
    const { vin } = req.params;
    const materialCode = req.query.materialCode;
    if (!materialCode) return res.status(400).json({ error: 'materialCode required' });

    const query = `
      SELECT *
      FROM (
        SELECT t.material_desc, t.material, d.code_value
        FROM b_tra_m_s_relation t
        LEFT JOIN (
          SELECT rmsd.material_code, rmsd.code_value, rmsr.vin
          FROM r_mat_scanning_detail rmsd
          JOIN r_mat_scanning_records rmsr ON rmsd.r_mat_scanning_records_id = rmsr.id
          WHERE rmsr.vin = ? AND rmsd.material_code IS NOT NULL AND rmsd.is_deleted = 0
        ) d ON t.material = d.material_code
        WHERE t.material_code = ? AND t.is_deleted = 0
        UNION ALL
        SELECT btmsr.material_desc, rmsd.material_code, rmsd.code_value
        FROM r_mat_scanning_detail rmsd
        JOIN r_mat_scanning_records rmsr ON rmsd.r_mat_scanning_records_id = rmsr.id
        LEFT JOIN b_tra_m_s_relation btmsr ON btmsr.material = rmsd.material_code AND btmsr.is_deleted = 0
        WHERE rmsr.vin = ? AND rmsd.material_code IS NOT NULL AND btmsr.material_desc IS NULL
      ) main
      ORDER BY material_desc
    `;
    const [rows] = await mesPool.query(query, [vin, materialCode, vin]);
    
    res.json(rows.map(r => ({
      material: r.material,
      material_desc: r.material_desc,
      code_value: r.code_value,
    })));
  } catch (err) {
    console.error('Ошибка компонентов:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Фильтры
app.get('/api/filters/kd-material-nos', async (req, res) => {
  try {
    const [rows] = await mesPool.query(`
      SELECT DISTINCT kd_material_no
      FROM udt_vsp_kd_material_mapping
      WHERE kd_material_no IS NOT NULL AND kd_material_no != ''
        AND is_deleted = 0
      ORDER BY kd_material_no
      LIMIT 500
    `);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка kd-material-nos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/filters/vehicle-types', async (req, res) => {
  try {
    const [rows] = await mesPool.query(`
      SELECT DISTINCT product AS vehicle_type
      FROM tm_ofm_order
      WHERE product IS NOT NULL AND product != ''
        AND is_deleted = 0
      ORDER BY product
    `);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка vehicle-types:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/filters/material-descs', async (req, res) => {
  try {
    const [rows] = await mesPool.query(`
      SELECT DISTINCT material_desc
      FROM tm_bas_material_relation
      WHERE material_desc IS NOT NULL AND material_desc != ''
        AND is_deleted = 0
      ORDER BY material_desc
      LIMIT 500
    `);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка material-descs:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/filters/colours', async (req, res) => {
  try {
    const [rows] = await mesPool.query(`
      SELECT DISTINCT ps_material_desc AS colour
      FROM tm_bas_material_relation
      WHERE ps_material_desc IS NOT NULL AND ps_material_desc != ''
        AND is_deleted = 0
      ORDER BY ps_material_desc
    `);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка colours:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/time-point-neighbors', async (req, res) => {
  try {
    const { checkpoint, vin, limitBefore = 100, limitAfter = 100 } = req.query;
    if (!vin || !checkpoint) return res.status(400).json({ error: 'vin и checkpoint обязательны' });

    const beforeLimit = parseInt(limitBefore, 10) || 100;
    const afterLimit = parseInt(limitAfter, 10) || 100;
    const targetVin = vin.trim();

    // Используем хелпер для поиска (поддержка 6 символов)
    const { clause: vinClause, params: vinParams } = buildVinClause([targetVin]);

    const mesPoints = {
      CP5: 'AGMBS01002',
      CP6: 'AGMPS01002',
      TRIMIN: 'AGMAS01001',
      CP7: 'AGMAS01003',
      CP72: 'CP72',
      CPFINAL: 'CPFINAL',
      CP8: 'AGMAS01004',
    };
    const iotPoints = ['TLWA', 'TLRT', 'TLADAS', 'TLTT'];
    const lesPoints = ['Inbound', 'Outbound'];

    let rows;
    let targetTime = null;

    if (mesPoints[checkpoint]) {
      const uloc = mesPoints[checkpoint];
      // Ищем время точки по полному или короткому VIN
      const [targetRows] = await mesPool.query(
        `SELECT MAX(scan_time) AS point_time FROM ti_mes_movement WHERE (${vinClause}) AND uloc_no = ? AND is_deleted = 0`,
        [...vinParams, uloc]
      );
      targetTime = targetRows[0]?.point_time;
      if (!targetTime) return res.json({ data: [], targetTime: null });

      const sql = `
        WITH all_points AS (
          SELECT vin, MAX(scan_time) AS point_time
          FROM ti_mes_movement
          WHERE uloc_no = ? AND is_deleted = 0
          GROUP BY vin
        )
        SELECT vin, point_time FROM (
          (SELECT vin, point_time FROM all_points WHERE point_time <= ? ORDER BY point_time DESC LIMIT ?)
          UNION ALL
          (SELECT vin, point_time FROM all_points WHERE point_time > ? ORDER BY point_time ASC LIMIT ?)
        ) AS neighbors
        ORDER BY point_time ASC
      `;
      const [resultRows] = await mesPool.query(sql, [uloc, targetTime, beforeLimit, targetTime, afterLimit]);
      rows = resultRows;
    } else if (iotPoints.includes(checkpoint)) {
      const [targetRows] = await pool.query(
        `SELECT MAX(CREATION_TIME) AS point_time FROM at_om_wiptrackinghistory WHERE (${vinClause}) AND WC_NAME = ?`,
        [...vinParams, checkpoint]
      );
      targetTime = targetRows[0]?.point_time;
      if (!targetTime) return res.json({ data: [], targetTime: null });

      const sql = `
        WITH all_points AS (
          SELECT vin, MAX(CREATION_TIME) AS point_time
          FROM at_om_wiptrackinghistory
          WHERE WC_NAME = ?
          GROUP BY vin
        )
        SELECT vin, point_time FROM (
          (SELECT vin, point_time FROM all_points WHERE point_time <= ? ORDER BY point_time DESC LIMIT ?)
          UNION ALL
          (SELECT vin, point_time FROM all_points WHERE point_time > ? ORDER BY point_time ASC LIMIT ?)
        ) AS neighbors
        ORDER BY point_time ASC
      `;
      const [resultRows] = await pool.query(sql, [checkpoint, targetTime, beforeLimit, targetTime, afterLimit]);
      rows = resultRows;
    } else if (lesPoints.includes(checkpoint)) {
      const column = checkpoint === 'Inbound' ? 'in_storage_time' : 'out_storage_time';
      const [targetRows] = await lesPool.query(
        `SELECT ${column} AS point_time FROM tv_biz_storage_car WHERE (${vinClause}) LIMIT 1`,
        [...vinParams]
      );
      targetTime = targetRows[0]?.point_time;
      if (!targetTime) return res.json({ data: [], targetTime: null });

      const sql = `
        SELECT vin, ${column} AS point_time FROM (
          (SELECT vin, ${column} FROM tv_biz_storage_car WHERE ${column} <= ? ORDER BY ${column} DESC LIMIT ?)
          UNION ALL
          (SELECT vin, ${column} FROM tv_biz_storage_car WHERE ${column} > ? ORDER BY ${column} ASC LIMIT ?)
        ) AS neighbors
        ORDER BY point_time ASC
      `;
      const [resultRows] = await lesPool.query(sql, [targetTime, beforeLimit, targetTime, afterLimit]);
      rows = resultRows;
    } else {
      return res.status(400).json({ error: 'Неверный checkpoint' });
    }

    res.json({ data: rows, targetTime });
  } catch (err) {
    console.error('Ошибка time-point-neighbors:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vehicles-current-location', async (req, res) => {
  try {
    const { vins } = req.query;
    if (!vins) return res.status(400).json({ error: 'vins обязателен' });
    const vinList = vins.split(',').map(v => v.trim()).filter(Boolean);
    if (vinList.length === 0) return res.json([]);

    // 1. MES
    const { clause: vinClauseMes, params: vinParamsMes } = buildVinClause(vinList, 'vin');
    const [mesRows] = await mesPool.query(
      `SELECT vin,
              MAX(IF(uloc_no = 'AGMBS01002', scan_time, NULL)) AS CP5,
              MAX(IF(uloc_no = 'AGMPS01002', scan_time, NULL)) AS CP6,
              MAX(IF(uloc_no = 'AGMAS01001', scan_time, NULL)) AS TRIMIN,
              MAX(IF(uloc_no = 'AGMAS01003', scan_time, NULL)) AS CP7,
              MAX(IF(uloc_no = 'CP72', scan_time, NULL)) AS CP72,
              MAX(IF(uloc_no = 'CPFINAL', scan_time, NULL)) AS CPFINAL,
              MAX(IF(uloc_no = 'AGMAS01004', scan_time, NULL)) AS CP8
       FROM ti_mes_movement
       WHERE (${vinClauseMes}) AND is_deleted = 0
       GROUP BY vin`,
      vinParamsMes
    );

    // 2. IOT (ТУТ БЫЛА ОШИБКА: теперь используем wo.vin)
    const { clause: vinClauseIot, params: vinParamsIot } = buildVinClause(vinList, 'wo.vin');
    const [iotRows] = await pool.query(
      `SELECT wo.vin,
              MAX(IF(aow.WC_NAME = 'TLWA', aow.CREATION_TIME, NULL)) AS TLWA,
              MAX(IF(aow.WC_NAME = 'TLRT', aow.CREATION_TIME, NULL)) AS TLRT,
              MAX(IF(aow.WC_NAME = 'TLADAS', aow.CREATION_TIME, NULL)) AS TLADAS,
              MAX(IF(aow.WC_NAME = 'TLTT', aow.CREATION_TIME, NULL)) AS TLTT
       FROM work_order wo
       LEFT JOIN at_om_wiptrackinghistory aow ON wo.vin = aow.vin
       WHERE (${vinClauseIot})
       GROUP BY wo.vin`,
      vinParamsIot
    );

    // 3. LES
    const { clause: vinClauseLes, params: vinParamsLes } = buildVinClause(vinList, 'vin');
    const [storageRows] = await lesPool.query(
      `SELECT vin, ck_no, kq_no, kw_no, out_storage_time, in_storage_status
       FROM tv_biz_storage_car
       WHERE (${vinClauseLes})`,
      vinParamsLes
    );

    const mesMap = new Map(mesRows.map(r => [r.vin, r]));
    const iotMap = new Map(iotRows.map(r => [r.vin, r]));
    const storageMap = new Map(storageRows.map(r => [r.vin, r]));

    // Собираем ВСЕ полные VIN, которые нашлись в базах
    const foundVins = new Set([
      ...mesRows.map(r => r.vin),
      ...iotRows.map(r => r.vin),
      ...storageRows.map(r => r.vin)
    ]);

    if (foundVins.size === 0) return res.json([]);

    const checkpoints = ['CP5','CP6','TRIMIN','CP7','CP72','TLWA','TLRT','TLADAS','TLTT','CPFINAL','CP8'];

    // Проходимся по найденным полным VIN
    const result = Array.from(foundVins).map(vin => {
      const m = mesMap.get(vin) || {};
      const i = iotMap.get(vin) || {};
      const s = storageMap.get(vin);

      const times = {
        CP5: m.CP5, CP6: m.CP6, TRIMIN: m.TRIMIN, CP7: m.CP7, CP72: m.CP72,
        TLWA: i.TLWA, TLRT: i.TLRT, TLADAS: i.TLADAS, TLTT: i.TLTT,
        CPFINAL: m.CPFINAL, CP8: m.CP8,
      };

      let latestCheckpoint = null;
      let latestTime = null;
      for (const cp of checkpoints) {
        if (times[cp]) {
          const t = new Date(times[cp]);
          if (!latestTime || t > latestTime) {
            latestTime = t;
            latestCheckpoint = cp;
          }
        }
      }

      const isSold = s && s.in_storage_status === 'Key_Car_In_Storage_Status_3';
      const hasStorageData = s && s.ck_no && s.kq_no && s.kw_no &&
                             s.ck_no !== 'N/A' && s.kq_no !== 'N/A' && s.kw_no !== 'N/A';
      const isInStorage = !isSold && hasStorageData;
      const storageString = hasStorageData ? `${s.ck_no}-${s.kq_no}-${s.kw_no}` : null;

      return {
        vin,
        isInStorage,
        isSold,
        storageString,
        checkpoint: isSold ? 'Продан' : (isInStorage ? null : latestCheckpoint),
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка vehicles-current-location:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vehicles-models', async (req, res) => {
  try {
    const { vins } = req.query;
    if (!vins) return res.status(400).json({ error: 'vins обязателен' });
    const vinList = vins.split(',').map(v => v.trim()).filter(Boolean);
    if (vinList.length === 0) return res.json({});

    const { clause: vinClause, params: vinParams } = buildVinClause(vinList);

    const [rows] = await mesPool.query(
      `SELECT vin, product AS model
       FROM tm_ofm_order
       WHERE (${vinClause})`,
      vinParams
    );

    const map = {};
    rows.forEach(r => { map[r.vin] = r.model; });

    res.json(map);
  } catch (err) {
    console.error('Ошибка vehicles-models:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vehicles-model-complect', async (req, res) => {
  try {
    const { vins } = req.query;
    if (!vins) return res.status(400).json({ error: 'vins обязателен' });
    const vinList = vins.split(',').map(v => v.trim()).filter(Boolean);
    if (vinList.length === 0) return res.json({});

    const { clause: vinClause, params: vinParams } = buildVinClause(vinList, 'too.vin');

    const [rows] = await mesPool.query(
      `SELECT 
         too.vin,
         too.product AS model,
         tbmr.material_desc AS material_desc
       FROM tm_ofm_order too
       LEFT JOIN tm_vhc_vehicle tvv ON too.vin = tvv.vin
       LEFT JOIN tm_bas_material_relation tbmr 
         ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
       WHERE (${vinClause})`,
      vinParams
    );

    const map = {};
    rows.forEach(r => { 
      map[r.vin] = { 
        model: r.model || '-', 
        material_desc: r.material_desc || '-' 
      }; 
    });

    res.json(map);
  } catch (err) {
    console.error('Ошибка vehicles-model-complect:', err.message);
    res.status(500).json({ error: err.message });
  }
});


/* ====================================================================== */
/* ================== DRR CP7 — ОСНОВНЫЕ ЭНДПОИНТЫ ====================== */
/* ====================================================================== */

// Хелпер: определить NOK дефекта.
// Смотрим только на REPAIR_TIME / REPAIR_TIME1 (самое раннее).
// - есть время: NOK, если время > CP72 + 20 мин; иначе OK
// - нет времени: NOK, если статус != closed; иначе OK
// LAST_MODIFIED_TIME НЕ используем.
const CP7_GRACE_MS = 20 * 60 * 1000;

function isDefectNokCp7(defectRow, cp72Ms) {
  const repairTimes = [defectRow.REPAIR_TIME, defectRow.REPAIR_TIME1]
    .filter(t => t != null && t !== '')
    .map(t => new Date(t).getTime())
    .filter(t => !Number.isNaN(t));

  const threshold = cp72Ms + CP7_GRACE_MS;

  if (repairTimes.length > 0) {
    const earliestRepairMs = Math.min(...repairTimes);
    return earliestRepairMs > threshold;
  }

  const isClosed = defectRow.STATUS && defectRow.STATUS.toLowerCase() === 'closed';
  return !isClosed;
}

// Хелпер: получить время CP72 для списка VIN из MES-базы
async function getCp72TimesMap(startTime, endTime) {
  const [rows] = await mesPool.query(`
    SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
    FROM ti_mes_movement
    WHERE uloc_no = 'CP72'
      AND is_deleted = 0
      AND scan_time >= ? AND scan_time <= ?
    GROUP BY vin
  `, [startTime, endTime]);

  const map = new Map();
  rows.forEach(r => map.set(r.VIN, r.CP72_TIME));
  return { rows, map };
}

app.get('/api/drr-cp7-dashboard', async (req, res) => {
  try {
    const { filter = 'all', startTime, endTime } = req.query;

    let rangeStart, rangeEnd;
    if (startTime && endTime) {
      rangeStart = startTime;
      rangeEnd = endTime;
    } else {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      rangeStart = `${y}-${m}-${d} 00:00:00`;
      rangeEnd = `${y}-${m}-${d} 23:59:59`;
    }

    const postLists = {
      all: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
      cp7: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP9'],
      pip: ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9']
    };
    const postList = postLists[filter] || postLists.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    // CP72 — из MES
    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(rangeStart, rangeEnd);

    const totalVins = cp72Rows.length;
    if (totalVins === 0) {
      return res.json({ totalVins: 0, closedVins: 0, drrPercent: 0 });
    }

    const vins = cp72Rows.map(r => r.VIN);
    const placeholders = vins.map(() => '?').join(',');

    // Дефекты — из IOT
    const [defectRows] = await pool.query(`
      SELECT
        d.VIN, d.STATUS, d.CREATION_TIME,
        d.REPAIR_TIME, d.REPAIR_TIME1
      FROM at_qm_defect_info d
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${postListStr})
    `, vins);

    const vinHasNok = new Map();

    defectRows.forEach(row => {
      const cp72TimeStr = cp72TimeMap.get(row.VIN);
      if (!cp72TimeStr) return;

      const cp72Ms = new Date(cp72TimeStr).getTime();
      const defectTimeMs = new Date(row.CREATION_TIME).getTime();
      if (defectTimeMs > cp72Ms + CP7_GRACE_MS) return;

      if (isDefectNokCp7(row, cp72Ms)) {
        vinHasNok.set(row.VIN, true);
      }
    });

    let closedVins = 0;
    cp72Rows.forEach(row => {
      if (!vinHasNok.get(row.VIN)) closedVins += 1;
    });

    const drrPercent = totalVins > 0 ? (closedVins / totalVins) * 100 : 0;

    res.json({
      totalVins,
      closedVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
    });
  } catch (err) {
    console.error('Ошибка DRR CP7 Dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-cp7-top-defects', async (req, res) => {
  try {
    const { filter = 'all', startTime, endTime } = req.query;

    let rangeStart, rangeEnd;
    if (startTime && endTime) {
      rangeStart = startTime;
      rangeEnd = endTime;
    } else {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      rangeStart = `${y}-${m}-${d} 00:00:00`;
      rangeEnd = `${y}-${m}-${d} 23:59:59`;
    }

    const postLists = {
      all: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
      cp7: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP9'],
      pip: ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9']
    };
    const postList = postLists[filter] || postLists.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(rangeStart, rangeEnd);
    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.VIN);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE,
        d.STATUS,
        d.CREATION_TIME,
        d.REPAIR_TIME,
        d.REPAIR_TIME1
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr})
        AND d.VIN IN (${placeholders})
    `, [...vins]);

    const nokDefects = [];
    defectRows.forEach(row => {
      const cp72TimeStr = cp72TimeMap.get(row.VIN);
      if (!cp72TimeStr) return;
      const cp72Ms = new Date(cp72TimeStr).getTime();
      const defectTimeMs = new Date(row.CREATION_TIME).getTime();
      if (defectTimeMs > cp72Ms + CP7_GRACE_MS) return;

      if (isDefectNokCp7(row, cp72Ms)) {
        nokDefects.push(row);
      }
    });

    const defectGroupMap = new Map();
    nokDefects.forEach(row => {
      const mpp = `${row.MODEL || '-'} ${row.PART_NAME || ''} ${row.PROBLEM_TYPE || ''}`.trim();
      if (!defectGroupMap.has(mpp)) {
        defectGroupMap.set(mpp, {
          mpp,
          model: row.MODEL || '',
          part_name: row.PART_NAME || '',
          problem_type: row.PROBLEM_TYPE || '',
          grade: row.PROBLEM_GRADE || '-',
          defectCount: 0,
        });
      }
      defectGroupMap.get(mpp).defectCount += 1;
    });

    const topDefects = Array.from(defectGroupMap.values())
      .map(d => ({
        mpp: d.mpp,
        model: d.model,
        part_name: d.part_name,
        problem_type: d.problem_type,
        grade: d.grade,
        defectCount: d.defectCount,
      }))
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(topDefects);
  } catch (err) {
    console.error('Ошибка DRR CP7 Top Defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-cp7-vins', async (req, res) => {
  try {
    const { filter = 'all', startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    const postLists = {
      all: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
      cp7: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP9'],
      pip: ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9']
    };
    const postList = postLists[filter] || postLists.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(startTime, endTime);
    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.VIN);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT d.VIN, d.STATUS, d.CREATION_TIME,
             d.REPAIR_TIME, d.REPAIR_TIME1
      FROM at_qm_defect_info d
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${postListStr})
    `, vins);

    const nokSet = new Set();

    defectRows.forEach(row => {
      const cp72TimeStr = cp72TimeMap.get(row.VIN);
      if (!cp72TimeStr) return;
      const cp72Ms = new Date(cp72TimeStr).getTime();
      const defectTimeMs = new Date(row.CREATION_TIME).getTime();
      if (defectTimeMs > cp72Ms + CP7_GRACE_MS) return;

      if (isDefectNokCp7(row, cp72Ms)) nokSet.add(row.VIN);
    });

    const [modelRows] = await pool.query(`
      SELECT VIN, MODEL FROM work_order WHERE VIN IN (${placeholders})
    `, vins);
    const modelMap = new Map(modelRows.map(r => [r.VIN, r.MODEL]));

    const result = cp72Rows
      .filter(row => {
        const isNok = nokSet.has(row.VIN);
        if (status === 'NOK') return isNok;
        if (status === 'OK') return !isNok;
        return false;
      })
      .map(row => ({
        vin: row.VIN,
        model: modelMap.get(row.VIN) || '-',
        cp72_time: row.CP72_TIME,
      }))
      .sort((a, b) => new Date(a.cp72_time) - new Date(b.cp72_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-cp7-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ: VIN'ы по конкретному MPP                                     */
/* ====================================================================== */
app.get('/api/drr-cp7-mpp-vins', async (req, res) => {
  try {
    const { filter = 'all', startTime, endTime, model, part_name, problem_type } = req.query;

    if (!startTime || !endTime || !model || !part_name || !problem_type) {
      return res.status(400).json({ error: 'startTime, endTime, model, part_name, problem_type обязательны' });
    }

    const postLists = {
      all: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
      cp7: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP9'],
      pip: ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9']
    };
    const postList = postLists[filter] || postLists.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(startTime, endTime);
    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.VIN);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT
        d.VIN, wo.MODEL,
        d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE,
        d.STATUS, d.CREATION_TIME,
        d.REPAIR_TIME, d.REPAIR_TIME1,
        d.POST_NAME AS post_name,
        d.REPAIR_POST_NAME AS repair_post_name
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr})
        AND d.VIN IN (${placeholders})
        AND wo.MODEL = ?
        AND d.PART_NAME = ?
        AND d.PROBLEM_TYPE = ?
    `, [...vins, model, part_name, problem_type]);

    const resultList = []; // <--- ИЗМЕНЕНО: используем массив вместо Map
    
    defectRows.forEach(row => {
      const cp72TimeStr = cp72TimeMap.get(row.VIN);
      if (!cp72TimeStr) return;
      const cp72Ms = new Date(cp72TimeStr).getTime();
      const defectTimeMs = new Date(row.CREATION_TIME).getTime();
      if (defectTimeMs > cp72Ms + CP7_GRACE_MS) return;

      if (!isDefectNokCp7(row, cp72Ms)) return;

      const repairTimes = [row.REPAIR_TIME, row.REPAIR_TIME1]
        .filter(t => t != null && t !== '')
        .map(t => new Date(t).getTime())
        .filter(t => !Number.isNaN(t));
      const repairMs = repairTimes.length > 0 ? Math.min(...repairTimes) : null;

      // <--- ИЗМЕНЕНО: просто пушим все записи в массив
      resultList.push({
        vin: row.VIN,
        model: row.MODEL || '—',
        grade: row.PROBLEM_GRADE || '—',
        status: row.STATUS || '',
        defect_time: row.CREATION_TIME,
        repair_time: repairMs ? new Date(repairMs).toISOString() : null,
        cp72_time: cp72TimeMap.get(row.VIN),
        post_name: row.post_name || '—',
        repair_post_name: row.repair_post_name || '—',
      });
    });

    resultList.sort((a, b) => new Date(a.cp72_time) - new Date(b.cp72_time));

    res.json(resultList);
  } catch (err) {
    console.error('Ошибка /api/drr-cp7-mpp-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});


/* ====================================================================== */
/* ================== DRR CP7 — СНИМКИ СМЕН ============================= */
/* ====================================================================== */

const CP7_SNAPSHOT_POST_LISTS = {
  all: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
  cp7: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP9'],
  pip: ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
};

function getWeekNumberForDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}

function getShiftLetterForSnapshot(shift, weekNumber) {
  if (shift === 'night') return 'C';
  if (shift === 'all') return 'ALL';
  const isEven = weekNumber % 2 === 0;
  if (shift === 'day') return isEven ? 'B' : 'A';
  if (shift === 'evening') return isEven ? 'A' : 'B';
  return null;
}

function getLastCompletedShiftCp7() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();

  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const todayStr = fmt(now);
  const yest = new Date(now);
  yest.setUTCDate(yest.getUTCDate() - 1);
  const yesterdayStr = fmt(yest);

  if (mins < 91) return { shiftDate: yesterdayStr, shift: 'day' };
  if (mins < 470) return { shiftDate: yesterdayStr, shift: 'evening' };
  if (mins < 1001) return { shiftDate: todayStr, shift: 'night' };
  return { shiftDate: todayStr, shift: 'day' };
}

function getCompletedDayDate() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  if (mins >= 1439) return fmt(now);
  const yest = new Date(now);
  yest.setUTCDate(yest.getUTCDate() - 1);
  return fmt(yest);
}

function getShiftRangeCp7(shiftDate, shift) {
  if (shift === 'all')     return { start: `${shiftDate} 00:00:00`, end: `${shiftDate} 23:59:59` };
  if (shift === 'day')     return { start: `${shiftDate} 07:50:00`, end: `${shiftDate} 16:40:00` };
  if (shift === 'night')   return { start: `${shiftDate} 01:31:00`, end: `${shiftDate} 07:50:00` };
  if (shift === 'evening') {
    const next = new Date(`${shiftDate}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    return { start: `${shiftDate} 16:41:00`, end: `${nextStr} 01:30:00` };
  }
  return null;
}

async function saveDrrCp7Snapshot(shiftDate, shift, filterName) {
  try {
    const range = getShiftRangeCp7(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDate(shiftDate);
    const shiftLetter = getShiftLetterForSnapshot(shift, weekNumber);

    const postList = CP7_SNAPSHOT_POST_LISTS[filterName] || CP7_SNAPSHOT_POST_LISTS.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    // CP72 — из MES
    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(range.start, range.end);

    const totalVins = cp72Rows.length;
    let closedVins = 0;
    let nokVins = 0;
    let drrPercent = 0;
    let topDefects = [];

    if (totalVins > 0) {
      const vins = cp72Rows.map(r => r.VIN);
      const ph = vins.map(() => '?').join(',');

      const [defectRows] = await pool.query(`
        SELECT
          d.VIN, d.STATUS, d.CREATION_TIME,
          d.REPAIR_TIME, d.REPAIR_TIME1,
          wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE
        FROM at_qm_defect_info d
        LEFT JOIN work_order wo ON wo.VIN = d.VIN
        WHERE d.VIN IN (${ph})
          AND d.POST_NAME IN (${postListStr})
      `, vins);

      const vinHasNok = new Map();
      const defectGroupMap = new Map();

      defectRows.forEach(d => {
        const cp72TimeStr = cp72TimeMap.get(d.VIN);
        if (!cp72TimeStr) return;
        const cp72Ms = new Date(cp72TimeStr).getTime();
        const defectMs = new Date(d.CREATION_TIME).getTime();
        if (defectMs > cp72Ms + CP7_GRACE_MS) return;

        if (isDefectNokCp7(d, cp72Ms)) {
          vinHasNok.set(d.VIN, true);

          const mpp = `${d.MODEL || '-'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`.trim();
          const key = `${mpp}|${d.PROBLEM_GRADE || '-'}`;
          if (!defectGroupMap.has(key)) {
            defectGroupMap.set(key, {
              mpp,
              model: d.MODEL || '',
              part_name: d.PART_NAME || '',
              problem_type: d.PROBLEM_TYPE || '',
              grade: d.PROBLEM_GRADE || '-',
              defectCount: 0,
            });
          }
          defectGroupMap.get(key).defectCount += 1;
        }
      });

      let okCount = 0;
      cp72Rows.forEach(r => {
        if (!vinHasNok.get(r.VIN)) okCount++;
      });
      closedVins = okCount;
      nokVins = totalVins - closedVins;
      drrPercent = totalVins > 0 ? Math.round((closedVins / totalVins) * 1000) / 10 : 0;

      topDefects = Array.from(defectGroupMap.values())
        .sort((a, b) => b.defectCount - a.defectCount);

    }

    await notesPool.query(`
      INSERT INTO drr_cp7_snapshots
        (shift_date, week_number, shift, shift_letter, filter_name,
         total_vins, closed_vins, nok_vins, drr_percent, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_vins = VALUES(total_vins),
        closed_vins = VALUES(closed_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        top_defects = VALUES(top_defects)
    `, [shiftDate, weekNumber, shift, shiftLetter, filterName,
        totalVins, closedVins, nokVins, drrPercent, JSON.stringify(topDefects)]);

    console.log(`[DRR CP7 snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) ${filterName} → ${drrPercent}% (${closedVins}/${totalVins})`);
  } catch (err) {
    console.error('[DRR CP7 snapshot] ошибка сохранения:', err.message);
  }
}

async function saveAllDrrCp7Snapshots(shiftDate, shift) {
  await saveDrrCp7Snapshot(shiftDate, shift, 'all');
  await saveDrrCp7Snapshot(shiftDate, shift, 'cp7');
  await saveDrrCp7Snapshot(shiftDate, shift, 'pip');
}

async function checkAndSaveDrrCp7Snapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShiftCp7();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_cp7_snapshots WHERE shift_date = ? AND shift = ?`,
      [shiftDate, shift]
    );
    if (Number(existing[0]?.cnt || 0) < 3) {
      await saveAllDrrCp7Snapshots(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR CP7 snapshot] ошибка проверки смены:', err.message);
  }
}

async function checkAndSaveDrrCp7DailySnapshot() {
  try {
    const dayDate = getCompletedDayDate();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_cp7_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (Number(existing[0]?.cnt || 0) < 3) {
      await saveAllDrrCp7Snapshots(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR CP7 snapshot] ошибка проверки суток:', err.message);
  }
}

setInterval(() => {
  checkAndSaveDrrCp7Snapshot();
  checkAndSaveDrrCp7DailySnapshot();
}, 60 * 1000);
checkAndSaveDrrCp7Snapshot();
checkAndSaveDrrCp7DailySnapshot();

function enrichCp7Snapshot(r) {
  const shiftDate = String(r.shift_date).slice(0, 10);
  const weekNumber = r.week_number != null
    ? r.week_number
    : getWeekNumberForDate(shiftDate);
  const shiftLetter = r.shift_letter != null
    ? r.shift_letter
    : getShiftLetterForSnapshot(r.shift, weekNumber);

  return {
    id: r.id,
    shiftDate,
    weekNumber,
    shift: r.shift,
    shiftLetter,
    filter: r.filter_name,
    snapshotTime: r.snapshot_time,
    totalVins: r.total_vins,
    closedVins: r.closed_vins,
    nokVins: r.nok_vins,
    drrPercent: Number(r.drr_percent),
  };
}

app.get('/api/drr-cp7-snapshots', async (req, res) => {
  try {
    const { days = 14, filter = 'all' } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);

    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, filter_name, snapshot_time,
             total_vins, closed_vins, nok_vins, drr_percent
      FROM drr_cp7_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND filter_name = ?
      ORDER BY shift_date DESC,
        FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays, filter]);

    res.json(rows.map(enrichCp7Snapshot));
  } catch (err) {
    console.error('Ошибка /api/drr-cp7-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-cp7-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query(
      'SELECT * FROM drr_cp7_snapshots WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Снимок не найден' });

    const r = rows[0];
    let topDefects = [];
    try {
      topDefects = r.top_defects
        ? (typeof r.top_defects === 'string' ? JSON.parse(r.top_defects) : r.top_defects)
        : [];
    } catch { topDefects = []; }

    res.json({
      ...enrichCp7Snapshot(r),
      topDefects,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-cp7-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});






app.get('/api/drr-cp7-history', async (req, res) => {
  try {
    const { filter = 'all', period = 'all', count, fromDate, toDate } = req.query;

    const postLists = {
      all: [
        'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
        'REPAIR', 'REPAIR_Final',
        'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'
      ],
      cp7: [
        'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
        'REPAIR', 'REPAIR_Final',
        'EXT1', 'PIP2', 'PIP4', 'PIP9'
      ],
      pip: [
        'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'
      ]
    };
    const postList = postLists[filter] || postLists.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const calcModelsForRange = async (startDate, endDate) => {
      const sql = `
        WITH cp72_vins AS (
            SELECT a.VIN, MIN(a.CREATION_TIME) AS CP72_TIME, wo.MODEL
            FROM at_om_wiptrackinghistory a
            JOIN work_order wo ON wo.VIN = a.VIN
            WHERE a.WC_NAME = 'CP72'
              AND DATE(a.CREATION_TIME) BETWEEN ? AND ?
            GROUP BY a.VIN, wo.MODEL
        ),
        defect_status AS (
            SELECT 
                d.VIN,
                COALESCE(d.REPAIR_TIME, d.REPAIR_TIME1) AS repair_time,
                cp.CP72_TIME,
                DATE_ADD(cp.CP72_TIME, INTERVAL 17 MINUTE) AS ADJUSTED_CP72_TIME,
                CASE 
                    WHEN (d.PART_NAME IS NULL OR TRIM(d.PART_NAME) = '') 
                         AND (d.PROBLEM_TYPE IS NULL OR TRIM(d.PROBLEM_TYPE) = '') 
                    THEN 'CLOSED'
                    WHEN COALESCE(d.REPAIR_TIME, d.REPAIR_TIME1) IS NULL THEN 'CLOSED'
                    WHEN COALESCE(d.REPAIR_TIME, d.REPAIR_TIME1) < DATE_ADD(cp.CP72_TIME, INTERVAL 17 MINUTE) THEN 'CLOSED'
                    ELSE 'OFF'
                END AS calculated_status
            FROM at_qm_defect_info d
            JOIN cp72_vins cp ON d.VIN = cp.VIN
            WHERE d.POST_NAME IN (${postListStr})
              AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
        ),
        vin_summary AS (
            SELECT VIN, MAX(CASE WHEN calculated_status = 'OFF' THEN 1 ELSE 0 END) AS has_off
            FROM defect_status
            GROUP BY VIN
        )
        SELECT 
            cp.VIN,
            cp.MODEL,
            CASE WHEN vs.has_off = 0 OR vs.has_off IS NULL THEN 1 ELSE 0 END AS all_closed
        FROM cp72_vins cp
        LEFT JOIN vin_summary vs ON vs.VIN = cp.VIN
      `;
      const [rows] = await pool.query(sql, [
        startDate, endDate,
        startDate + ' 00:00:00', endDate + ' 23:59:59'
      ]);

      const models = {};
      rows.forEach(r => {
        const model = r.MODEL || '-';
        if (!models[model]) models[model] = { totalVins: 0, closedVins: 0 };
        models[model].totalVins += 1;
        models[model].closedVins += r.all_closed;
      });

      const totalVins = rows.length;
      const closedVins = rows.reduce((sum, r) => sum + r.all_closed, 0);
      const drr = totalVins > 0 ? (closedVins / totalVins) * 100 : 0;

      Object.keys(models).forEach(model => {
        const m = models[model];
        m.drr = m.totalVins > 0 ? (m.closedVins / m.totalVins) * 100 : 0;
        m.drr = Math.round(m.drr * 10) / 10;
      });

      return { totalVins, closedVins, drr: Math.round(drr * 10) / 10, models };
    };

    const calcModelsForToday = async () => {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const start = `${y}-${m}-${d} 00:00:00`;
      const end = `${y}-${m}-${d} 23:59:59`;

      const [cp72Rows] = await pool.query(`
        SELECT a.VIN, wo.MODEL
        FROM at_om_wiptrackinghistory a
        JOIN work_order wo ON wo.VIN = a.VIN
        WHERE a.WC_NAME = 'CP72'
          AND a.CREATION_TIME >= ? AND a.CREATION_TIME <= ?
        GROUP BY a.VIN, wo.MODEL
      `, [start, end]);

      const totalVins = cp72Rows.length;
      if (totalVins === 0) return { totalVins: 0, closedVins: 0, drr: 0, models: {} };

      const [defectRows] = await pool.query(`
        SELECT d.VIN, d.STATUS
        FROM at_qm_defect_info d
        WHERE d.POST_NAME IN (${postListStr})
          AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
          AND d.VIN IN (
            SELECT a.VIN FROM at_om_wiptrackinghistory a
            WHERE a.WC_NAME = 'CP72' AND a.CREATION_TIME >= ? AND a.CREATION_TIME <= ?
          )
      `, [start, end, start, end]);

      const vinDefectMap = new Map();
      defectRows.forEach(row => {
        if (!vinDefectMap.has(row.VIN)) vinDefectMap.set(row.VIN, { total: 0, closed: 0 });
        const stat = vinDefectMap.get(row.VIN);
        stat.total += 1;
        if (row.STATUS && row.STATUS.toLowerCase() === 'closed') stat.closed += 1;
      });

      const models = {};
      let closedVins = 0;
      cp72Rows.forEach(row => {
        const stat = vinDefectMap.get(row.VIN);
        const allClosed = !stat || stat.total === stat.closed;
        if (allClosed) closedVins += 1;
        const model = row.MODEL || '-';
        if (!models[model]) models[model] = { totalVins: 0, closedVins: 0 };
        models[model].totalVins += 1;
        if (allClosed) models[model].closedVins += 1;
      });

      Object.keys(models).forEach(model => {
        const m = models[model];
        m.drr = m.totalVins > 0 ? (m.closedVins / m.totalVins) * 100 : 0;
        m.drr = Math.round(m.drr * 10) / 10;
      });

      const drr = totalVins > 0 ? (closedVins / totalVins) * 100 : 0;
      return { totalVins, closedVins, drr: Math.round(drr * 10) / 10, models };
    };

    const getISOWeek = (date) => {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
      return Math.ceil((((d - yearStart) / 86400000) + 1)/7);
    };

    const formatDate = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const pad = (num) => String(num).padStart(2, '0');

    const now = new Date();
    let periods = [];

    const typeOrder = { year: 0, month: 1, week: 2, day: 3 };

    if (period === 'all') {
      for (let i = 1; i >= 0; i--) {
        const y = now.getFullYear() - i;
        periods.push({ label: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31`, type: 'year' });
      }
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${lastDay}`, type: 'month' });
      }
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      for (let i = 3; i >= 0; i--) {
        const start = new Date(monday);
        start.setDate(monday.getDate() - i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        periods.push({ label: `W${getISOWeek(start)}`, startDate: formatDate(start), endDate: formatDate(end), type: 'week' });
      }
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: formatDate(d), endDate: formatDate(d), type: 'day' });
      }
    } else {
      if (fromDate && toDate && period !== 'all') {
        let from = new Date(fromDate + 'T00:00:00');
        let to = new Date(toDate + 'T00:00:00');
        if (from > to) [from, to] = [to, from];

        if (period === 'day') {
          for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
            const dateStr = formatDate(d);
            periods.push({
              label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`,
              startDate: dateStr,
              endDate: dateStr,
              type: 'day'
            });
          }
        } else if (period === 'month') {
          let d = new Date(from.getFullYear(), from.getMonth(), 1);
          while (d <= to) {
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            const lastDay = new Date(y, m, 0).getDate();
            const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
            periods.push({
              label: `${monthName} ${y}`,
              startDate: `${y}-${pad(m)}-01`,
              endDate: `${y}-${pad(m)}-${lastDay}`,
              type: 'month'
            });
            d.setMonth(d.getMonth() + 1);
          }
        } else if (period === 'week') {
          const day = from.getDay();
          const monday = new Date(from);
          monday.setDate(from.getDate() - (day === 0 ? 6 : day - 1));
          for (let start = new Date(monday); start <= to; start.setDate(start.getDate() + 7)) {
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            periods.push({
              label: `W${getISOWeek(start)}`,
              startDate: formatDate(start),
              endDate: formatDate(end),
              type: 'week'
            });
          }
        } else if (period === 'year') {
          for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
            periods.push({
              label: String(y),
              startDate: `${y}-01-01`,
              endDate: `${y}-12-31`,
              type: 'year'
            });
          }
        }
      } else {
        const defaultCount = { year: 2, month: 3, week: 4, day: 14 }[period] || 7;
        const limit = parseInt(count, 10) || defaultCount;
        if (period === 'year') {
          for (let i = limit - 1; i >= 0; i--) {
            const y = now.getFullYear() - i;
            periods.push({ label: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31`, type: 'year' });
          }
        } else if (period === 'month') {
          for (let i = limit - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
            const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
            periods.push({ label: `${monthName} ${y}`, startDate: `${y}-${m}-01`, endDate: `${y}-${m}-${lastDay}`, type: 'month' });
          }
        } else if (period === 'week') {
          const dayOfWeek = now.getDay();
          const monday = new Date(now);
          monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
          for (let i = limit - 1; i >= 0; i--) {
            const start = new Date(monday);
            start.setDate(monday.getDate() - i * 7);
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            periods.push({ label: `W${getISOWeek(start)}`, startDate: formatDate(start), endDate: formatDate(end), type: 'week' });
          }
        } else if (period === 'day') {
          for (let i = limit - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            periods.push({ label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`, startDate: formatDate(d), endDate: formatDate(d), type: 'day' });
          }
        }
      }
    }

    periods.sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || a.startDate.localeCompare(b.startDate));

    const results = [];
    for (const p of periods) {
      let calcResult;
      if (p.type === 'day' && p.startDate === formatDate(new Date())) {
        calcResult = await calcModelsForToday();
      } else {
        calcResult = await calcModelsForRange(p.startDate, p.endDate);
      }
      results.push({
        label: p.label,
        type: p.type,
        drr: calcResult.drr,
        totalVins: calcResult.totalVins,
        closedVins: calcResult.closedVins,
        models: calcResult.models
      });
    }

    res.json({ periods: results });
  } catch (err) {
    console.error('Ошибка DRR CP7 History:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/drr-cp7-history-top-mpp', async (req, res) => {
  try {
    const { dateFrom, dateTo, grades } = req.query;

    let startDate, endDate;
    if (dateFrom && dateTo) {
      startDate = dateFrom;
      endDate = dateTo;
    } else {
      const today = new Date();
      const start = new Date();
      start.setDate(today.getDate() - 13);
      startDate = start.toISOString().split('T')[0];
      endDate = today.toISOString().split('T')[0];
    }

    const cp7Posts = [
      'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
      'REPAIR', 'REPAIR_Final',
      'EXT1', 'PIP2', 'PIP4', 'PIP9',
      'REPAIR VERIFICATION', 'Topcoat preparation'
    ];
    const postListStr = cp7Posts.map(p => `'${p}'`).join(',');

    let where = `WHERE d.POST_NAME IN (${postListStr}) AND d.OFFLINE = 1 AND DATE(d.CREATION_TIME) BETWEEN ? AND ?`;
    const params = [startDate, endDate];

    if (grades) {
      const gradesList = grades.split(',').map(g => g.trim()).filter(Boolean);
      if (gradesList.length > 0) {
        where += ` AND d.PROBLEM_GRADE IN (${gradesList.map(() => '?').join(',')})`;
        params.push(...gradesList);
      }
    }

    const [rows] = await pool.query(`
      SELECT CONCAT(wo.MODEL, ' - ', d.PART_NAME, ' - ', d.PROBLEM_TYPE) AS DEFECT, COUNT(*) AS CNT
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, PROBLEM_GRADE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_biw_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, PROBLEM_GRADE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_paint_qm_defect_info
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, PROBLEM_GRADE,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS OFFLINE
        FROM at_qm_defect_info
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      ${where}
      GROUP BY DEFECT
      ORDER BY CNT DESC
      LIMIT 5
    `, params);

    res.json(rows.map(r => ({ defect: r.DEFECT, count: r.CNT })));
  } catch (err) {
    console.error('Ошибка drr-cp7-history-top-mpp:', err.message);
    res.status(500).json({ error: err.message });
  }
});


/* ====================================================================== */
/* ================== DRR CP7 — TOUCH UP (QC-TUP) ======================= */
/* ====================================================================== */

// 1. Дашборд (расчет OK/NOK только по дефектам QC-TUP)
app.get('/api/drr-cp7-tup-dashboard', async (req, res) => {
  try {
    const { filter = 'all', startTime, endTime } = req.query;

    let rangeStart, rangeEnd;
    if (startTime && endTime) {
      rangeStart = startTime;
      rangeEnd = endTime;
    } else {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      rangeStart = `${y}-${m}-${d} 00:00:00`;
      rangeEnd = `${y}-${m}-${d} 23:59:59`;
    }

    const postLists = {
      all: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
      cp7: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP9'],
      pip: ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9']
    };
    const postList = postLists[filter] || postLists.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(rangeStart, rangeEnd);

    const totalVins = cp72Rows.length;
    if (totalVins === 0) {
      return res.json({ totalVins: 0, closedVins: 0, drrPercent: 0 });
    }

    const vins = cp72Rows.map(r => r.VIN);
    const placeholders = vins.map(() => '?').join(',');

    // ВАЖНО: Берем ТОЛЬКО дефекты, созданные пользователем 'QC-TUP'
    const [defectRows] = await pool.query(`
      SELECT
        d.VIN, d.STATUS, d.CREATION_TIME,
        d.REPAIR_TIME, d.REPAIR_TIME1
      FROM at_qm_defect_info d
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${postListStr})
        AND d.CREATION_USER = 'QC-TUP'
    `, vins);

    const vinHasNok = new Map();

    defectRows.forEach(row => {
      const cp72TimeStr = cp72TimeMap.get(row.VIN);
      if (!cp72TimeStr) return;

      const cp72Ms = new Date(cp72TimeStr).getTime();
      const defectTimeMs = new Date(row.CREATION_TIME).getTime();
      if (defectTimeMs > cp72Ms + CP7_GRACE_MS) return;

      // Логика 20 минут (isDefectNokCp7)
      if (isDefectNokCp7(row, cp72Ms)) {
        vinHasNok.set(row.VIN, true);
      }
    });

    let closedVins = 0;
    cp72Rows.forEach(row => {
      if (!vinHasNok.get(row.VIN)) closedVins += 1;
    });

    const drrPercent = totalVins > 0 ? (closedVins / totalVins) * 100 : 0;

    res.json({
      totalVins,
      closedVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
    });
  } catch (err) {
    console.error('Ошибка DRR CP7 TUP Dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. Топ дефектов (ТОЛЬКО QC-TUP)
app.get('/api/drr-cp7-tup-top-defects', async (req, res) => {
  try {
    const { filter = 'all', startTime, endTime } = req.query;

    let rangeStart, rangeEnd;
    if (startTime && endTime) {
      rangeStart = startTime;
      rangeEnd = endTime;
    } else {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      rangeStart = `${y}-${m}-${d} 00:00:00`;
      rangeEnd = `${y}-${m}-${d} 23:59:59`;
    }

    const postLists = {
      all: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
      cp7: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP9'],
      pip: ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9']
    };
    const postList = postLists[filter] || postLists.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(rangeStart, rangeEnd);
    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.VIN);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE,
        d.STATUS,
        d.CREATION_TIME,
        d.REPAIR_TIME,
        d.REPAIR_TIME1
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr})
        AND d.VIN IN (${placeholders})
        AND d.CREATION_USER = 'QC-TUP'
    `, [...vins]);

    const nokDefects = [];
    defectRows.forEach(row => {
      const cp72TimeStr = cp72TimeMap.get(row.VIN);
      if (!cp72TimeStr) return;
      const cp72Ms = new Date(cp72TimeStr).getTime();
      const defectTimeMs = new Date(row.CREATION_TIME).getTime();
      if (defectTimeMs > cp72Ms + CP7_GRACE_MS) return;

      if (isDefectNokCp7(row, cp72Ms)) {
        nokDefects.push(row);
      }
    });

    const defectGroupMap = new Map();
    nokDefects.forEach(row => {
      const mpp = `${row.MODEL || '-'} ${row.PART_NAME || ''} ${row.PROBLEM_TYPE || ''}`.trim();
      if (!defectGroupMap.has(mpp)) {
        defectGroupMap.set(mpp, {
          mpp,
          model: row.MODEL || '',
          part_name: row.PART_NAME || '',
          problem_type: row.PROBLEM_TYPE || '',
          grade: row.PROBLEM_GRADE || '-',
          defectCount: 0,
        });
      }
      defectGroupMap.get(mpp).defectCount += 1;
    });

    const topDefects = Array.from(defectGroupMap.values())
      .map(d => ({
        mpp: d.mpp,
        model: d.model,
        part_name: d.part_name,
        problem_type: d.problem_type,
        grade: d.grade,
        defectCount: d.defectCount,
      }))
      .sort((a, b) => b.defectCount - a.defectCount);

    res.json(topDefects);
  } catch (err) {
    console.error('Ошибка DRR CP7 TUP Top Defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. Список VIN по OK/NOK (копия логики DRR CP7)
app.get('/api/drr-cp7-tup-vins', async (req, res) => {
  try {
    const { filter = 'all', startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    const postLists = {
      all: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
      cp7: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP9'],
      pip: ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9']
    };
    const postList = postLists[filter] || postLists.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(startTime, endTime);
    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.VIN);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT d.VIN, d.STATUS, d.CREATION_TIME,
             d.REPAIR_TIME, d.REPAIR_TIME1
      FROM at_qm_defect_info d
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${postListStr})
        AND d.CREATION_USER = 'QC-TUP'
    `, vins);

    const nokSet = new Set();

    defectRows.forEach(row => {
      const cp72TimeStr = cp72TimeMap.get(row.VIN);
      if (!cp72TimeStr) return;
      const cp72Ms = new Date(cp72TimeStr).getTime();
      const defectTimeMs = new Date(row.CREATION_TIME).getTime();
      if (defectTimeMs > cp72Ms + CP7_GRACE_MS) return;

      if (isDefectNokCp7(row, cp72Ms)) nokSet.add(row.VIN);
    });

    const [modelRows] = await pool.query(`
      SELECT VIN, MODEL FROM work_order WHERE VIN IN (${placeholders})
    `, vins);
    const modelMap = new Map(modelRows.map(r => [r.VIN, r.MODEL]));

    const result = cp72Rows
      .filter(row => {
        const isNok = nokSet.has(row.VIN);
        if (status === 'NOK') return isNok;
        if (status === 'OK') return !isNok;
        return false;
      })
      .map(row => ({
        vin: row.VIN,
        model: modelMap.get(row.VIN) || '-',
        cp72_time: row.CP72_TIME,
      }))
      .sort((a, b) => new Date(a.cp72_time) - new Date(b.cp72_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-cp7-tup-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// 4. VIN'ы по конкретному MPP (ТОЛЬКО ТЕ ДЕФЕКТЫ QC-TUP, ИЗ-ЗА КОТОРЫХ МАШИНА СТАЛА NOK)
app.get('/api/drr-cp7-tup-mpp-vins', async (req, res) => {
  try {
    const { filter = 'all', startTime, endTime, model, part_name, problem_type } = req.query;

    if (!startTime || !endTime || !model || !part_name || !problem_type) {
      return res.status(400).json({ error: 'startTime, endTime, model, part_name, problem_type обязательны' });
    }

    const postLists = {
      all: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'],
      cp7: ['CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate', 'EXT1', 'PIP9'],
      pip: ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9']
    };
    const postList = postLists[filter] || postLists.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(startTime, endTime);
    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.VIN);
    const placeholders = vins.map(() => '?').join(',');

    // Вернули фильтр d.CREATION_USER = 'QC-TUP' и убрали is_tup
    const [defectRows] = await pool.query(`
      SELECT
        d.VIN, wo.MODEL,
        d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE,
        d.STATUS, d.CREATION_TIME,
        d.REPAIR_TIME, d.REPAIR_TIME1,
        d.POST_NAME AS post_name,
        d.REPAIR_POST_NAME AS repair_post_name,
        d.CREATION_USER
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr})
        AND d.VIN IN (${placeholders})
        AND wo.MODEL = ?
        AND d.PART_NAME = ?
        AND d.PROBLEM_TYPE = ?
        AND d.CREATION_USER = 'QC-TUP'
    `, [...vins, model, part_name, problem_type]);

    const resultList = [];

    defectRows.forEach(row => {
      const cp72TimeStr = cp72TimeMap.get(row.VIN);
      if (!cp72TimeStr) return;
      
      const cp72Ms = new Date(cp72TimeStr).getTime();
      
      // ДОБАВЛЕНО: проверяем, что дефект реально NOK (не закрыт вовремя)
      if (!isDefectNokCp7(row, cp72Ms)) return;

      const repairTimes = [row.REPAIR_TIME, row.REPAIR_TIME1]
        .filter(t => t != null && t !== '')
        .map(t => new Date(t).getTime())
        .filter(t => !Number.isNaN(t));
      const repairMs = repairTimes.length > 0 ? Math.min(...repairTimes) : null;

      resultList.push({
        vin: row.VIN,
        model: row.MODEL || '—',
        grade: row.PROBLEM_GRADE || '—',
        status: row.STATUS || '',
        defect_time: row.CREATION_TIME,
        repair_time: repairMs ? new Date(repairMs).toISOString() : null,
        cp72_time: cp72TimeMap.get(row.VIN),
        post_name: row.post_name || '—',
        repair_post_name: row.repair_post_name || '—',
        creation_user: row.CREATION_USER || '—'
      });
    });

    resultList.sort((a, b) => new Date(a.cp72_time) - new Date(b.cp72_time));

    res.json(resultList);
  } catch (err) {
    console.error('Ошибка /api/drr-cp7-tup-mpp-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ================== DRR CP7 TUP — СНИМКИ СМЕН ========================= */
/* ====================================================================== */

// Используем хелперы, которые уже есть в коде (getShiftRangeCp7, getWeekNumberForDate и т.д.)

async function saveDrrCp7TupSnapshot(shiftDate, shift, filterName) {
  try {
    const range = getShiftRangeCp7(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDate(shiftDate);
    const shiftLetter = getShiftLetterForSnapshot(shift, weekNumber);

    const postList = CP7_SNAPSHOT_POST_LISTS[filterName] || CP7_SNAPSHOT_POST_LISTS.all;
    const postListStr = postList.map(p => `'${p}'`).join(',');

    const { rows: cp72Rows, map: cp72TimeMap } = await getCp72TimesMap(range.start, range.end);

    const totalVins = cp72Rows.length;
    let closedVins = 0;
    let nokVins = 0;
    let drrPercent = 0;
    let topDefects = [];

    if (totalVins > 0) {
      const vins = cp72Rows.map(r => r.VIN);
      const ph = vins.map(() => '?').join(',');

      // Только дефекты QC-TUP
      const [defectRows] = await pool.query(`
        SELECT
          d.VIN, d.STATUS, d.CREATION_TIME,
          d.REPAIR_TIME, d.REPAIR_TIME1,
          wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE
        FROM at_qm_defect_info d
        LEFT JOIN work_order wo ON wo.VIN = d.VIN
        WHERE d.VIN IN (${ph})
          AND d.POST_NAME IN (${postListStr})
          AND d.CREATION_USER = 'QC-TUP'
      `, vins);

      const vinHasNok = new Map();
      const defectGroupMap = new Map();

      defectRows.forEach(d => {
        const cp72TimeStr = cp72TimeMap.get(d.VIN);
        if (!cp72TimeStr) return;
        const cp72Ms = new Date(cp72TimeStr).getTime();
        const defectMs = new Date(d.CREATION_TIME).getTime();
        if (defectMs > cp72Ms + CP7_GRACE_MS) return;

        if (isDefectNokCp7(d, cp72Ms)) {
          vinHasNok.set(d.VIN, true);

          const mpp = `${d.MODEL || '-'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`.trim();
          const key = `${mpp}|${d.PROBLEM_GRADE || '-'}`;
          if (!defectGroupMap.has(key)) {
            defectGroupMap.set(key, {
              mpp,
              model: d.MODEL || '',
              part_name: d.PART_NAME || '',
              problem_type: d.PROBLEM_TYPE || '',
              grade: d.PROBLEM_GRADE || '-',
              defectCount: 0,
            });
          }
          defectGroupMap.get(key).defectCount += 1;
        }
      });

      let okCount = 0;
      cp72Rows.forEach(r => {
        if (!vinHasNok.get(r.VIN)) okCount++;
      });
      closedVins = okCount;
      nokVins = totalVins - closedVins;
      drrPercent = totalVins > 0 ? Math.round((closedVins / totalVins) * 1000) / 10 : 0;

      topDefects = Array.from(defectGroupMap.values())
        .sort((a, b) => b.defectCount - a.defectCount);
    }

    await notesPool.query(`
      INSERT INTO drr_cp7_tup_snapshots
        (shift_date, week_number, shift, shift_letter, filter_name,
         total_vins, closed_vins, nok_vins, drr_percent, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_vins = VALUES(total_vins),
        closed_vins = VALUES(closed_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        top_defects = VALUES(top_defects)
    `, [shiftDate, weekNumber, shift, shiftLetter, filterName,
        totalVins, closedVins, nokVins, drrPercent, JSON.stringify(topDefects)]);

    console.log(`[DRR CP7 TUP snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) ${filterName} → ${drrPercent}% (${closedVins}/${totalVins})`);
  } catch (err) {
    console.error('[DRR CP7 TUP snapshot] ошибка сохранения:', err.message);
  }
}

async function saveAllDrrCp7TupSnapshots(shiftDate, shift) {
  await saveDrrCp7TupSnapshot(shiftDate, shift, 'all');
  await saveDrrCp7TupSnapshot(shiftDate, shift, 'cp7');
  await saveDrrCp7TupSnapshot(shiftDate, shift, 'pip');
}

async function checkAndSaveDrrCp7TupSnapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShiftCp7();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_cp7_tup_snapshots WHERE shift_date = ? AND shift = ?`,
      [shiftDate, shift]
    );
    if (Number(existing[0]?.cnt || 0) < 3) {
      await saveAllDrrCp7TupSnapshots(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR CP7 TUP snapshot] ошибка проверки смены:', err.message);
  }
}

async function checkAndSaveDrrCp7TupDailySnapshot() {
  try {
    const dayDate = getCompletedDayDate();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_cp7_tup_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (Number(existing[0]?.cnt || 0) < 3) {
      await saveAllDrrCp7TupSnapshots(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR CP7 TUP snapshot] ошибка проверки суток:', err.message);
  }
}

// Запускаем интервалы
setInterval(() => {
  checkAndSaveDrrCp7TupSnapshot();
  checkAndSaveDrrCp7TupDailySnapshot();
}, 60 * 1000);
checkAndSaveDrrCp7TupSnapshot();
checkAndSaveDrrCp7TupDailySnapshot();

function enrichCp7TupSnapshot(r) {
  const shiftDate = String(r.shift_date).slice(0, 10);
  const weekNumber = r.week_number != null
    ? r.week_number
    : getWeekNumberForDate(shiftDate);
  const shiftLetter = r.shift_letter != null
    ? r.shift_letter
    : getShiftLetterForSnapshot(r.shift, weekNumber);

  return {
    id: r.id,
    shiftDate,
    weekNumber,
    shift: r.shift,
    shiftLetter,
    filter: r.filter_name,
    snapshotTime: r.snapshot_time,
    totalVins: r.total_vins,
    closedVins: r.closed_vins,
    nokVins: r.nok_vins,
    drrPercent: Number(r.drr_percent),
  };
}

// 5. Получение списка снимков
app.get('/api/drr-cp7-tup-snapshots', async (req, res) => {
  try {
    const { days = 14, filter = 'all' } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);

    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, filter_name, snapshot_time,
             total_vins, closed_vins, nok_vins, drr_percent
      FROM drr_cp7_tup_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND filter_name = ?
      ORDER BY shift_date DESC,
        FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays, filter]);

    res.json(rows.map(enrichCp7TupSnapshot));
  } catch (err) {
    console.error('Ошибка /api/drr-cp7-tup-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 6. Получение конкретного снимка
app.get('/api/drr-cp7-tup-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query(
      'SELECT * FROM drr_cp7_tup_snapshots WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Снимок не найден' });

    const r = rows[0];
    let topDefects = [];
    try {
      topDefects = r.top_defects
        ? (typeof r.top_defects === 'string' ? JSON.parse(r.top_defects) : r.top_defects)
        : [];
    } catch { topDefects = []; }

    res.json({
      ...enrichCp7TupSnapshot(r),
      topDefects,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-cp7-tup-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});



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

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}





app.get('/api/drr-cp8-dashboard', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;

    let rangeStart, rangeEnd;
    if (startTime && endTime) {
      rangeStart = startTime;
      rangeEnd = endTime;
    } else {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      rangeStart = `${y}-${m}-${d} 00:00:00`;
      rangeEnd = `${y}-${m}-${d} 23:59:59`;
    }

    // 1. VIN, прошедшие CP72 за период (MES)
    const [cp72Rows] = await mesPool.query(`
      SELECT DISTINCT vin
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72'
        AND scan_time >= ?
        AND scan_time < ?
    `, [rangeStart, rangeEnd]);

    if (cp72Rows.length === 0) {
      return res.json({ totalVins: 0, closedVins: 0, drrPercent: 0 });
    }

    const vins = cp72Rows.map(r => r.vin);
    const placeholders = vins.map(() => '?').join(',');

    // 2. Дефекты по расширенному списку постов для этих VIN
    const defectPosts = [
      'TLTT','CP8','TLADAS','TLWA','TLRT','CPA',
      'CP8 Gate','CP8-gate','360','ADAS','ADAS+RB',
      'TEST TRACK','TRACK','WA','WT','CP8 Touch Up'
    ];
    const defectPostsStr = defectPosts.map(p => `'${p}'`).join(',');

    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        d.STATUS
      FROM at_qm_defect_info d
      WHERE d.POST_NAME IN (${defectPostsStr})
        AND d.CREATION_TIME >= ?
        AND d.CREATION_TIME < ?
        AND d.VIN IN (${placeholders})
    `, [rangeStart, rangeEnd, ...vins]);

    // 3. Для каждого VIN определяем, есть ли хотя бы один не closed дефект
    const vinHasOpenDefect = new Set();
    defectRows.forEach(row => {
      if (!row.STATUS || row.STATUS.toLowerCase() !== 'closed') {
        vinHasOpenDefect.add(row.VIN);
      }
    });

    // 4. Подсчёт closedVins (OK) – автомобиль OK, если нет открытых дефектов
    let closedVins = 0;
    cp72Rows.forEach(row => {
      if (!vinHasOpenDefect.has(row.vin)) closedVins += 1;
    });

    const drrPercent = (closedVins / cp72Rows.length) * 100;
    res.json({
      totalVins: cp72Rows.length,
      closedVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
    });
  } catch (err) {
    console.error('Ошибка DRR CP8 Dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-cp8-top-defects', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const defectPosts = [
      'TLTT','CP8','TLADAS','TLWA','TLRT','CPA',
      'CP8 Gate','CP8-gate','360','ADAS','ADAS+RB',
      'TEST TRACK','TRACK','WA','WT','CP8 Touch Up'
    ];
    const defectPostsStr = defectPosts.map(p => `'${p}'`).join(',');

    // Все незакрытые дефекты на этих постах за окно — без привязки к CP72
    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${defectPostsStr})
        AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
        AND (d.STATUS IS NULL OR LOWER(d.STATUS) != 'closed')
    `, [startTime, endTime]);

    if (defectRows.length === 0) return res.json([]);

    // Группировка по MODEL + PART_NAME + PROBLEM_TYPE + grade
    const defectGroupMap = new Map();
    defectRows.forEach(row => {
      const mpp = `${row.MODEL || '—'} ${row.PART_NAME || ''} ${row.PROBLEM_TYPE || ''}`
        .replace(/\s+/g, ' ')
        .trim();
      const grade = row.PROBLEM_GRADE || '—';
      const key = `${mpp}|${grade}`;
      if (!defectGroupMap.has(key)) {
        defectGroupMap.set(key, { mpp, grade, defectCount: 0 });
      }
      defectGroupMap.get(key).defectCount += 1;
    });

    const topDefects = [...defectGroupMap.values()]
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(topDefects);
  } catch (err) {
    console.error('Ошибка DRR CP8 Top Defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-cp8-vins', async (req, res) => {
  try {
    const { startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    // 1. VIN, прошедшие CP72 за период (MES)
    const [cp72Rows] = await mesPool.query(`
      SELECT vin, MIN(scan_time) AS cp72_time
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72'
        AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [startTime, endTime]);

    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.vin);
    const placeholders = vins.map(() => '?').join(',');

    // 2. Дефекты на указанных постах
    const defectPosts = [
      'TLTT','CP8','TLADAS','TLWA','TLRT','CPA',
      'CP8 Gate','CP8-gate','360','ADAS','ADAS+RB',
      'TEST TRACK','TRACK','WA','WT','CP8 Touch Up'
    ];
    const defectPostsStr = defectPosts.map(p => `'${p}'`).join(',');

    const [defectRows] = await pool.query(`
      SELECT d.VIN, d.STATUS
      FROM at_qm_defect_info d
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${defectPostsStr})
        AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
    `, [...vins, startTime, endTime]);

    // 3. NOK VIN
    const nokSet = new Set();
    defectRows.forEach(row => {
      if (!row.STATUS || row.STATUS.toLowerCase() !== 'closed') {
        nokSet.add(row.VIN);
      }
    });

    // 4. Получаем модели из work_order
    const [modelRows] = await pool.query(`
      SELECT VIN, MODEL
      FROM work_order
      WHERE VIN IN (${placeholders})
    `, vins);
    const modelMap = new Map(modelRows.map(r => [r.VIN, r.MODEL]));

    // 5. Формируем итоговый список
    const result = cp72Rows
      .filter(row => {
        const isNok = nokSet.has(row.vin);
        if (status === 'NOK') return isNok;
        if (status === 'OK') return !isNok;
        return false;
      })
      .map(row => ({
        vin: row.vin,
        model: modelMap.get(row.vin) || '-',
        cp72_time: row.cp72_time,
      }))
      .sort((a, b) => new Date(a.cp72_time) - new Date(b.cp72_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-cp8-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});


/* ====================================================================== */
/* ===================== DRR ADAS (TLADAS) ============================== */
/* ====================================================================== */

const ADAS_DEFECT_POSTS = [
  '360', 'ADAS', 'ADAS+RB', 'WA'
];
const ADAS_DEFECT_POSTS_STR = ADAS_DEFECT_POSTS.map(p => `'${p}'`).join(',');

/* ---------------------------------------------------------------------- */
/* Хелпер: VIN + два времени TLADAS + общее число записей TLADAS          */
/* ---------------------------------------------------------------------- */
async function getAdasTladasVins(startTime, endTime) {
  const [rows] = await mesPool.query(`
    SELECT
      vin,
      MIN(gmt_create) AS tlad_first_time,
      MAX(gmt_create) AS tlad_last_time
    FROM tm_vhc_test_line_movement
    WHERE node_nature = 'TLADAS'
      AND is_deleted = 0
      AND gmt_create >= ? AND gmt_create <= ?
    GROUP BY vin
  `, [startTime, endTime]);

  const [countRows] = await mesPool.query(`
    SELECT COUNT(*) AS total_records
    FROM tm_vhc_test_line_movement
    WHERE node_nature = 'TLADAS'
      AND is_deleted = 0
      AND gmt_create >= ? AND gmt_create <= ?
  `, [startTime, endTime]);

  const totalRecords = Number(countRows[0]?.total_records) || 0;

  const vins = rows.map(r => ({
    vin: r.vin,
    tlad_first_time: r.tlad_first_time,
    tlad_last_time:  r.tlad_last_time,
  }));

  return { vins, totalRecords };
}

/* ---------------------------------------------------------------------- */
/* Хелпер: классификация VIN (OK / NOK) по LAST_MODIFIED_TIME             */
/* ---------------------------------------------------------------------- */
async function classifyAdasVins(tladRows) {
  const okSet = new Set();
  const nokSet = new Set();
  const vins = tladRows.map(r => r.vin);

  vins.forEach(v => okSet.add(v));

  if (vins.length === 0) return { okSet, nokSet };

  const firstTladByVin = new Map(tladRows.map(r => [r.vin, r.tlad_first_time]));
  const ph = vins.map(() => '?').join(',');

  const [defectRows] = await pool.query(`
    SELECT VIN, STATUS, LAST_MODIFIED_TIME
    FROM at_qm_defect_info
    WHERE VIN IN (${ph})
      AND POST_NAME IN (${ADAS_DEFECT_POSTS_STR})
  `, vins);

  defectRows.forEach(d => {
    const firstTlad = firstTladByVin.get(d.VIN);
    if (!firstTlad) return;

    const tladMs = new Date(firstTlad).getTime();
    const reworkMs = d.LAST_MODIFIED_TIME ? new Date(d.LAST_MODIFIED_TIME).getTime() : null;
    const isClosed = d.STATUS && d.STATUS.toUpperCase() === 'CLOSED';

    let isNok = false;
    if (reworkMs !== null) {
      if (reworkMs > tladMs) isNok = true;
    } else {
      if (!isClosed) isNok = true;
    }

    if (isNok) {
      nokSet.add(d.VIN);
      okSet.delete(d.VIN);
    }
  });

  return { okSet, nokSet };
}

/* ====================================================================== */
/* ЭНДПОИНТ 1: главные цифры                                              */
/* ====================================================================== */
app.get('/api/drr-tl-dashboard', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const { vins: tladRows, totalRecords } = await getAdasTladasVins(startTime, endTime);
    const totalVins = tladRows.length;

    if (totalVins === 0) {
      return res.json({
        totalRecords,
        totalVins: 0,
        closedVins: 0,
        nokVins: 0,
        drrPercent: 0,
      });
    }

    const { okSet, nokSet } = await classifyAdasVins(tladRows);
    const closedVins = okSet.size;
    const nokVins = nokSet.size;
    const drrPercent = totalVins > 0 ? (closedVins / totalVins) * 100 : 0;

    res.json({
      totalRecords,
      totalVins,
      closedVins,
      nokVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-tl-dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 2: список VIN для модалки (status: OK | NOK | ALL)            */
/* ====================================================================== */
app.get('/api/drr-tl-vins', async (req, res) => {
  try {
    const { startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    const { vins: tladRows } = await getAdasTladasVins(startTime, endTime);
    if (tladRows.length === 0) return res.json([]);

    const lastTladByVin = new Map(tladRows.map(r => [r.vin, r.tlad_last_time]));

    const { okSet, nokSet } = await classifyAdasVins(tladRows);

    let vins;
    if (status === 'OK') {
      vins = [...okSet];
    } else if (status === 'NOK') {
      vins = [...nokSet];
    } else if (status === 'ALL') {
      vins = tladRows.map(r => r.vin);
    } else {
      return res.status(400).json({ error: 'Неизвестный status' });
    }

    if (vins.length === 0) return res.json([]);

    const ph = vins.map(() => '?').join(',');
    const [modelRows] = await pool.query(`
      SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})
    `, vins);
    const modelByVin = new Map(modelRows.map(r => [r.VIN, r.MODEL || '—']));

    const result = vins.map(vin => ({
      vin,
      model: modelByVin.get(vin) || '—',
      tlad_time: lastTladByVin.get(vin) || null,
    })).sort((a, b) => new Date(a.tlad_time) - new Date(b.tlad_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-tl-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 3: топ дефектов у NOK VIN                                     */
/* — теперь возвращаем model / part_name / problem_type                   */
/* ====================================================================== */
app.get('/api/drr-tl-top-defects', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const { vins: tladRows } = await getAdasTladasVins(startTime, endTime);
    if (tladRows.length === 0) return res.json([]);

    const firstTladByVin = new Map(tladRows.map(r => [r.vin, r.tlad_first_time]));
    const { nokSet } = await classifyAdasVins(tladRows);
    const nokVins = [...nokSet];

    if (nokVins.length === 0) return res.json([]);

    const ph = nokVins.map(() => '?').join(',');
    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE,
        d.STATUS,
        d.LAST_MODIFIED_TIME
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.VIN IN (${ph})
        AND d.POST_NAME IN (${ADAS_DEFECT_POSTS_STR})
    `, nokVins);

    const map = new Map();
    defectRows.forEach(d => {
      const firstTlad = firstTladByVin.get(d.VIN);
      if (!firstTlad) return;
      const tladMs = new Date(firstTlad).getTime();
      const reworkMs = d.LAST_MODIFIED_TIME ? new Date(d.LAST_MODIFIED_TIME).getTime() : null;
      const isClosed = d.STATUS && d.STATUS.toUpperCase() === 'CLOSED';

      let isNok = false;
      if (reworkMs !== null) {
        if (reworkMs > tladMs) isNok = true;
      } else {
        if (!isClosed) isNok = true;
      }
      if (!isNok) return;

      const mpp = `${d.MODEL || '—'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`
        .replace(/\s+/g, ' ').trim();

      if (!map.has(mpp)) {
        map.set(mpp, {
          mpp,
          model: d.MODEL || '',
          part_name: d.PART_NAME || '',
          problem_type: d.PROBLEM_TYPE || '',
          defectCount: 0,
        });
      }
      map.get(mpp).defectCount += 1;
    });

    const result = [...map.values()]
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-tl-top-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 4: VIN'ы по конкретному MPP                                   */
/* ====================================================================== */
app.get('/api/drr-tl-mpp-vins', async (req, res) => {
  try {
    const { startTime, endTime, model, part_name = '', problem_type = '' } = req.query;

    if (!startTime || !endTime || !model) {
      return res.status(400).json({ error: 'startTime, endTime и model обязательны' });
    }

    const { vins: tladRows } = await getAdasTladasVins(startTime, endTime);
    if (tladRows.length === 0) return res.json([]);

    const firstTladByVin = new Map(tladRows.map(r => [r.vin, r.tlad_first_time]));
    const lastTladByVin = new Map(tladRows.map(r => [r.vin, r.tlad_last_time]));
    const { nokSet } = await classifyAdasVins(tladRows);
    const nokVins = [...nokSet];

    if (nokVins.length === 0) return res.json([]);

    const ph = nokVins.map(() => '?').join(',');

    let whereClause = `d.VIN IN (${ph}) AND d.POST_NAME IN (${ADAS_DEFECT_POSTS_STR}) AND wo.MODEL = ?`;
    const params = [...nokVins, model];

    if (part_name !== '' || problem_type !== '') {
      whereClause += ` AND d.PART_NAME = ? AND d.PROBLEM_TYPE = ?`;
      params.push(part_name, problem_type);
    } else {
      whereClause += ` AND (d.PART_NAME IS NULL OR TRIM(d.PART_NAME) = '') AND (d.PROBLEM_TYPE IS NULL OR TRIM(d.PROBLEM_TYPE) = '')`;
    }

    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE,
        d.STATUS,
        d.LAST_MODIFIED_TIME
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE ${whereClause}
    `, params);

    const vinMap = new Map();
    defectRows.forEach(d => {
      const firstTlad = firstTladByVin.get(d.VIN);
      if (!firstTlad) return;
      const tladMs = new Date(firstTlad).getTime();
      const reworkMs = d.LAST_MODIFIED_TIME ? new Date(d.LAST_MODIFIED_TIME).getTime() : null;
      const isClosed = d.STATUS && d.STATUS.toUpperCase() === 'CLOSED';

      let isNok = false;
      if (reworkMs !== null) { if (reworkMs > tladMs) isNok = true; }
      else { if (!isClosed) isNok = true; }
      if (!isNok) return;

      const existing = vinMap.get(d.VIN);
      const reworkTimeMs = reworkMs || 0;
      if (!existing || reworkTimeMs > existing._reworkMs) {
        vinMap.set(d.VIN, {
          vin: d.VIN,
          model: d.MODEL || '—',
          grade: d.PROBLEM_GRADE || '—',
          status: d.STATUS || '',
          last_modified: d.LAST_MODIFIED_TIME || null,
          tlad_time: lastTladByVin.get(d.VIN) || null,
          _reworkMs: reworkTimeMs,
        });
      }
    });

    const result = Array.from(vinMap.values())
      .map(({ _reworkMs, ...v }) => v)
      .sort((a, b) => new Date(a.tlad_time) - new Date(b.tlad_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-tl-mpp-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ================== DRR ADAS — СНИМКИ СМЕН ============================ */
/* ====================================================================== */

function getLastCompletedShiftAdas() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();

  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const todayStr = fmt(now);
  const yest = new Date(now);
  yest.setUTCDate(yest.getUTCDate() - 1);
  const yesterdayStr = fmt(yest);

  if (mins < 91) return { shiftDate: yesterdayStr, shift: 'day' };
  if (mins < 470) return { shiftDate: yesterdayStr, shift: 'evening' };
  if (mins < 1001) return { shiftDate: todayStr, shift: 'night' };
  return { shiftDate: todayStr, shift: 'day' };
}

function getShiftRangeAdas(shiftDate, shift) {
  if (shift === 'all')     return { start: `${shiftDate} 00:00:00`, end: `${shiftDate} 23:59:59` };
  if (shift === 'day')     return { start: `${shiftDate} 07:50:00`, end: `${shiftDate} 16:40:00` };
  if (shift === 'night')   return { start: `${shiftDate} 01:31:00`, end: `${shiftDate} 07:50:00` };
  if (shift === 'evening') {
    const next = new Date(`${shiftDate}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    return { start: `${shiftDate} 16:41:00`, end: `${nextStr} 01:30:00` };
  }
  return null;
}

async function saveDrrAdasSnapshot(shiftDate, shift) {
  try {
    const range = getShiftRangeAdas(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDate(shiftDate);
    const shiftLetter = getShiftLetterForSnapshot(shift, weekNumber);

    const { vins: tladRows, totalRecords } = await getAdasTladasVins(range.start, range.end);
    const totalVins = tladRows.length;

    let closedVins = 0, nokVins = 0, drrPercent = 0, topDefects = [];

    if (totalVins > 0) {
      const { okSet, nokSet } = await classifyAdasVins(tladRows);
      closedVins = okSet.size;
      nokVins = nokSet.size;
      drrPercent = Math.round((closedVins / totalVins) * 1000) / 10;

      const firstTladByVin = new Map(tladRows.map(r => [r.vin, r.tlad_first_time]));
      const nokVinsList = [...nokSet];

      if (nokVinsList.length > 0) {
        const ph = nokVinsList.map(() => '?').join(',');
        const [defectRows] = await pool.query(`
          SELECT d.VIN, wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE, d.STATUS, d.LAST_MODIFIED_TIME
          FROM at_qm_defect_info d
          LEFT JOIN work_order wo ON wo.VIN = d.VIN
          WHERE d.VIN IN (${ph})
            AND d.POST_NAME IN (${ADAS_DEFECT_POSTS_STR})
        `, nokVinsList);

        const map = new Map();
        defectRows.forEach(d => {
          const firstTlad = firstTladByVin.get(d.VIN);
          if (!firstTlad) return;
          const tladMs = new Date(firstTlad).getTime();
          const reworkMs = d.LAST_MODIFIED_TIME ? new Date(d.LAST_MODIFIED_TIME).getTime() : null;
          const isClosed = d.STATUS && d.STATUS.toUpperCase() === 'CLOSED';

          let isNok = false;
          if (reworkMs !== null) { if (reworkMs > tladMs) isNok = true; }
          else { if (!isClosed) isNok = true; }
          if (!isNok) return;

          const mpp = `${d.MODEL || '—'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`
            .replace(/\s+/g, ' ').trim();

          if (!map.has(mpp)) {
            map.set(mpp, {
              mpp,
              model: d.MODEL || '',
              part_name: d.PART_NAME || '',
              problem_type: d.PROBLEM_TYPE || '',
              defectCount: 0,
            });
          }
          map.get(mpp).defectCount += 1;
        });

        topDefects = [...map.values()]
          .sort((a, b) => b.defectCount - a.defectCount);
          
      }
    }

    await notesPool.query(`
      INSERT INTO drr_adas_snapshots
        (shift_date, week_number, shift, shift_letter,
         total_records, total_vins, closed_vins, nok_vins, drr_percent, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_records = VALUES(total_records),
        total_vins = VALUES(total_vins),
        closed_vins = VALUES(closed_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        top_defects = VALUES(top_defects)
    `, [shiftDate, weekNumber, shift, shiftLetter,
        totalRecords, totalVins, closedVins, nokVins, drrPercent, JSON.stringify(topDefects)]);

    console.log(`[DRR ADAS snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) → ${drrPercent}% (${closedVins}/${totalVins})`);
  } catch (err) {
    console.error('[DRR ADAS snapshot] ошибка сохранения:', err.message);
  }
}

async function checkAndSaveDrrAdasSnapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShiftAdas();
    const [existing] = await notesPool.query(
      'SELECT id FROM drr_adas_snapshots WHERE shift_date = ? AND shift = ?',
      [shiftDate, shift]
    );
    if (existing.length === 0) {
      await saveDrrAdasSnapshot(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR ADAS snapshot] ошибка проверки смены:', err.message);
  }
}

async function checkAndSaveDrrAdasDailySnapshot() {
  try {
    const dayDate = getCompletedDayDate();
    const [existing] = await notesPool.query(
      `SELECT id FROM drr_adas_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (existing.length === 0) {
      await saveDrrAdasSnapshot(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR ADAS snapshot] ошибка проверки суток:', err.message);
  }
}

setInterval(() => {
  checkAndSaveDrrAdasSnapshot();
  checkAndSaveDrrAdasDailySnapshot();
}, 60 * 1000);
checkAndSaveDrrAdasSnapshot();
checkAndSaveDrrAdasDailySnapshot();

/* ====================================================================== */
/* ХЕЛПЕР: дозаполнить week_number / shift_letter, если их нет в БД       */
/* ====================================================================== */
function enrichAdasSnapshot(r) {
  const shiftDate = String(r.shift_date).slice(0, 10);
  const weekNumber = r.week_number != null
    ? r.week_number
    : getWeekNumberForDate(shiftDate);
  const shiftLetter = r.shift_letter != null
    ? r.shift_letter
    : getShiftLetterForSnapshot(r.shift, weekNumber);

  return {
    id: r.id,
    shiftDate,
    weekNumber,
    shift: r.shift,
    shiftLetter,
    snapshotTime: r.snapshot_time,
    totalRecords: r.total_records,
    totalVins: r.total_vins,
    closedVins: r.closed_vins,
    nokVins: r.nok_vins,
    drrPercent: Number(r.drr_percent),
  };
}

/* ====================================================================== */
/* ЭНДПОИНТ: список снимков                                               */
/* ====================================================================== */
app.get('/api/drr-tl-snapshots', async (req, res) => {
  try {
    const { days = 14 } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);

    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, snapshot_time,
             total_records, total_vins, closed_vins, nok_vins, drr_percent
      FROM drr_adas_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY shift_date DESC,
        FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays]);

    res.json(rows.map(enrichAdasSnapshot));
  } catch (err) {
    console.error('Ошибка /api/drr-tl-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ: один снимок с top_defects                                    */
/* ====================================================================== */
app.get('/api/drr-tl-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query(
      'SELECT * FROM drr_adas_snapshots WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Снимок не найден' });

    const r = rows[0];
    let topDefects = [];
    try {
      topDefects = r.top_defects
        ? (typeof r.top_defects === 'string' ? JSON.parse(r.top_defects) : r.top_defects)
        : [];
    } catch { topDefects = []; }

    res.json({
      ...enrichAdasSnapshot(r),
      topDefects,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-tl-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});




// ================== PIP DRR DASHBOARD ==================

const PIP_DEFECT_POSTS = ['EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'];
const PIP_DEFECT_POSTS_STR = PIP_DEFECT_POSTS.map(p => `'${p}'`).join(',');

// 1. Основной DRR
app.get('/api/drr-pip-dashboard', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const [pip9Rows] = await mesPool.query(`
      SELECT DISTINCT vin
      FROM ti_mes_movement
      WHERE uloc_no = 'AGMAS01003'
        AND scan_time >= ? AND scan_time <= ?
        AND is_deleted = 0
    `, [startTime, endTime]);

    if (pip9Rows.length === 0) {
      return res.json({ totalVins: 0, closedVins: 0, drrPercent: 0 });
    }

    const vins = pip9Rows.map(r => r.vin);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT d.VIN, d.STATUS
      FROM at_qm_defect_info d
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${PIP_DEFECT_POSTS_STR})
    `, vins);

    const nokSet = new Set();
    defectRows.forEach(row => {
      if (!row.STATUS || row.STATUS.toLowerCase() !== 'closed') {
        nokSet.add(row.VIN);
      }
    });

    const closedVins = vins.length - nokSet.size;
    const drrPercent = vins.length > 0 ? (closedVins / vins.length) * 100 : 0;

    res.json({
      totalVins: vins.length,
      closedVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
    });
  } catch (err) {
    console.error('Ошибка DRR PIP Dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. Топ дефектов — теперь с model / part_name / problem_type
app.get('/api/drr-pip-top-defects', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const [pip9Rows] = await mesPool.query(`
      SELECT DISTINCT vin
      FROM ti_mes_movement
      WHERE uloc_no = 'AGMAS01003'
        AND scan_time >= ? AND scan_time <= ?
        AND is_deleted = 0
    `, [startTime, endTime]);

    if (pip9Rows.length === 0) return res.json([]);

    const vins = pip9Rows.map(r => r.vin);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE,
        d.STATUS
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${PIP_DEFECT_POSTS_STR})
    `, vins);

    const nokSet = new Set();
    defectRows.forEach(row => {
      if (!row.STATUS || row.STATUS.toLowerCase() !== 'closed') {
        nokSet.add(row.VIN);
      }
    });

    if (nokSet.size === 0) return res.json([]);

    const defectGroupMap = new Map();
    defectRows.forEach(row => {
      if (!nokSet.has(row.VIN)) return;
      if (row.STATUS && row.STATUS.toLowerCase() === 'closed') return;

      const mpp = `${row.MODEL || '-'} ${row.PART_NAME || ''} ${row.PROBLEM_TYPE || ''}`.trim();
      if (!defectGroupMap.has(mpp)) {
        defectGroupMap.set(mpp, {
          mpp,
          model: row.MODEL || '',
          part_name: row.PART_NAME || '',
          problem_type: row.PROBLEM_TYPE || '',
          grade: row.PROBLEM_GRADE || '-',
          defectCount: 0,
        });
      }
      defectGroupMap.get(mpp).defectCount += 1;
    });

    const topDefects = Array.from(defectGroupMap.values())
      .map(d => ({
        mpp: d.mpp,
        model: d.model,
        part_name: d.part_name,
        problem_type: d.problem_type,
        grade: d.grade,
        defectCount: d.defectCount,
      }))
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(topDefects);
  } catch (err) {
    console.error('Ошибка DRR PIP Top Defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. Список VIN OK/NOK
app.get('/api/drr-pip-vins', async (req, res) => {
  try {
    const { startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    const [pip9Rows] = await mesPool.query(`
      SELECT vin, MIN(scan_time) AS pip9_time
      FROM ti_mes_movement
      WHERE uloc_no = 'AGMAS01003'
        AND scan_time >= ? AND scan_time <= ?
        AND is_deleted = 0
      GROUP BY vin
    `, [startTime, endTime]);

    if (pip9Rows.length === 0) return res.json([]);

    const vins = pip9Rows.map(r => r.vin);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT d.VIN, d.STATUS
      FROM at_qm_defect_info d
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${PIP_DEFECT_POSTS_STR})
    `, vins);

    const nokSet = new Set();
    defectRows.forEach(row => {
      if (!row.STATUS || row.STATUS.toLowerCase() !== 'closed') {
        nokSet.add(row.VIN);
      }
    });

    const selectedVins = pip9Rows.filter(row => {
      const isNok = nokSet.has(row.vin);
      if (status === 'NOK') return isNok;
      if (status === 'OK') return !isNok;
      return false;
    });

    const modelMap = new Map();
    if (selectedVins.length > 0) {
      const selPlaceholders = selectedVins.map(() => '?').join(',');
      const [modelRows] = await pool.query(`
        SELECT VIN, MODEL FROM work_order WHERE VIN IN (${selPlaceholders})
      `, selectedVins.map(r => r.vin));
      modelRows.forEach(r => modelMap.set(r.VIN, r.MODEL));
    }

    const result = selectedVins.map(r => ({
      vin: r.vin,
      model: modelMap.get(r.vin) || '-',
      pip9_time: r.pip9_time,
    })).sort((a, b) => new Date(a.pip9_time) - new Date(b.pip9_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-pip-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. VIN'ы по конкретному MPP
app.get('/api/drr-pip-mpp-vins', async (req, res) => {
  try {
    const { startTime, endTime, model, part_name = '', problem_type = '' } = req.query;

    if (!startTime || !endTime || !model) {
      return res.status(400).json({ error: 'startTime, endTime и model обязательны' });
    }

    const [pip9Rows] = await mesPool.query(`
      SELECT vin, MIN(scan_time) AS pip9_time
      FROM ti_mes_movement
      WHERE uloc_no = 'AGMAS01003'
        AND scan_time >= ? AND scan_time <= ?
        AND is_deleted = 0
      GROUP BY vin
    `, [startTime, endTime]);

    if (pip9Rows.length === 0) return res.json([]);

    const pip9TimeByVin = new Map(pip9Rows.map(r => [r.vin, r.pip9_time]));
    const vins = pip9Rows.map(r => r.vin);
    const placeholders = vins.map(() => '?').join(',');

    const [defectRows] = await pool.query(`
      SELECT d.VIN, d.STATUS
      FROM at_qm_defect_info d
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${PIP_DEFECT_POSTS_STR})
    `, vins);

    const nokSet = new Set();
    defectRows.forEach(row => {
      if (!row.STATUS || row.STATUS.toLowerCase() !== 'closed') {
        nokSet.add(row.VIN);
      }
    });

    const nokVins = [...nokSet];
    if (nokVins.length === 0) return res.json([]);

    const ph = nokVins.map(() => '?').join(',');
    let whereClause = `d.VIN IN (${ph}) AND d.POST_NAME IN (${PIP_DEFECT_POSTS_STR}) AND wo.MODEL = ?`;
    const params = [...nokVins, model];

    if (part_name !== '' || problem_type !== '') {
      whereClause += ` AND d.PART_NAME = ? AND d.PROBLEM_TYPE = ?`;
      params.push(part_name, problem_type);
    } else {
      whereClause += ` AND (d.PART_NAME IS NULL OR TRIM(d.PART_NAME) = '') AND (d.PROBLEM_TYPE IS NULL OR TRIM(d.PROBLEM_TYPE) = '')`;
    }

    const [matchedDefects] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE,
        d.STATUS
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE ${whereClause}
    `, params);

    const vinMap = new Map();
    matchedDefects.forEach(d => {
      if (!nokSet.has(d.VIN)) return; // только NOK
      if (!vinMap.has(d.VIN)) {
        vinMap.set(d.VIN, {
          vin: d.VIN,
          model: d.MODEL || '—',
          grade: d.PROBLEM_GRADE || '—',
          status: d.STATUS || '',
          pip9_time: pip9TimeByVin.get(d.VIN) || null,
        });
      }
    });

    const result = Array.from(vinMap.values())
      .sort((a, b) => new Date(a.pip9_time) - new Date(b.pip9_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-pip-mpp-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ================== DRR PIP — СНИМКИ СМЕН ============================= */
/* ====================================================================== */

/* Определение последней ЗАВЕРШЁННОЙ смены (МСК) */
function getLastCompletedShift() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();

  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const todayStr = fmt(now);
  const yest = new Date(now);
  yest.setUTCDate(yest.getUTCDate() - 1);
  const yesterdayStr = fmt(yest);

  if (mins < 91) return { shiftDate: yesterdayStr, shift: 'day' };
  if (mins < 470) return { shiftDate: yesterdayStr, shift: 'evening' };
  if (mins < 1001) return { shiftDate: todayStr, shift: 'night' };
  return { shiftDate: todayStr, shift: 'day' };
}

/* Временные границы смены (+ 'all') */
function getShiftRange(shiftDate, shift) {
  if (shift === 'all')     return { start: `${shiftDate} 00:00:00`, end: `${shiftDate} 23:59:59` };
  if (shift === 'day')     return { start: `${shiftDate} 07:50:00`, end: `${shiftDate} 16:40:00` };
  if (shift === 'night')   return { start: `${shiftDate} 01:31:00`, end: `${shiftDate} 07:50:00` };
  if (shift === 'evening') {
    const next = new Date(`${shiftDate}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    return { start: `${shiftDate} 16:41:00`, end: `${nextStr} 01:30:00` };
  }
  return null;
}

/* Сохранение снимка — с week_number и shift_letter */
async function saveDrrPipSnapshot(shiftDate, shift) {
  try {
    const range = getShiftRange(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDate(shiftDate);
    const shiftLetter = getShiftLetterForSnapshot(shift, weekNumber);

    const [pip9Rows] = await mesPool.query(`
      SELECT DISTINCT vin
      FROM ti_mes_movement
      WHERE uloc_no = 'AGMAS01003'
        AND scan_time >= ? AND scan_time <= ?
        AND is_deleted = 0
    `, [range.start, range.end]);

    const vins = pip9Rows.map(r => r.vin);
    const totalVins = vins.length;

    let closedVins = 0;
    let nokVins = 0;
    let drrPercent = 0;
    let topDefects = [];

    if (totalVins > 0) {
      const ph = vins.map(() => '?').join(',');
      const [defectRows] = await pool.query(`
        SELECT
          d.VIN,
          d.STATUS,
          wo.MODEL,
          d.PART_NAME,
          d.PROBLEM_TYPE,
          d.PROBLEM_GRADE
        FROM at_qm_defect_info d
        LEFT JOIN work_order wo ON wo.VIN = d.VIN
        WHERE d.VIN IN (${ph})
          AND d.POST_NAME IN (${PIP_DEFECT_POSTS_STR})
      `, vins);

      const nokSet = new Set();
      const defectGroupMap = new Map();

      defectRows.forEach(d => {
        const isClosed = d.STATUS && d.STATUS.toLowerCase() === 'closed';
        if (!isClosed) {
          nokSet.add(d.VIN);
          const mpp = `${d.MODEL || '-'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`.trim();
          if (!defectGroupMap.has(mpp)) {
            defectGroupMap.set(mpp, {
              mpp,
              model: d.MODEL || '',
              part_name: d.PART_NAME || '',
              problem_type: d.PROBLEM_TYPE || '',
              grade: d.PROBLEM_GRADE || '-',
              defectCount: 0,
            });
          }
          defectGroupMap.get(mpp).defectCount += 1;
        }
      });

      nokVins = nokSet.size;
      closedVins = totalVins - nokVins;
      drrPercent = totalVins > 0 ? Math.round((closedVins / totalVins) * 1000) / 10 : 0;

      topDefects = Array.from(defectGroupMap.values())
        .sort((a, b) => b.defectCount - a.defectCount);
        
    }

    await notesPool.query(`
      INSERT INTO drr_pip_snapshots
        (shift_date, week_number, shift, shift_letter,
         total_vins, closed_vins, nok_vins, drr_percent, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_vins = VALUES(total_vins),
        closed_vins = VALUES(closed_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        top_defects = VALUES(top_defects)
    `, [shiftDate, weekNumber, shift, shiftLetter,
        totalVins, closedVins, nokVins, drrPercent, JSON.stringify(topDefects)]);

    console.log(`[DRR PIP snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) → ${drrPercent}% (${closedVins}/${totalVins})`);
  } catch (err) {
    console.error('[DRR PIP snapshot] ошибка сохранения:', err.message);
  }
}

/* Проверка и сохранение смены */
async function checkAndSaveDrrPipSnapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShift();
    const [existing] = await notesPool.query(
      'SELECT id FROM drr_pip_snapshots WHERE shift_date = ? AND shift = ?',
      [shiftDate, shift]
    );
    if (existing.length === 0) {
      await saveDrrPipSnapshot(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR PIP snapshot] ошибка проверки смены:', err.message);
  }
}

/* Проверка и сохранение суток */
async function checkAndSaveDrrPipDailySnapshot() {
  try {
    const dayDate = getCompletedDayDate();
    const [existing] = await notesPool.query(
      `SELECT id FROM drr_pip_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (existing.length === 0) {
      await saveDrrPipSnapshot(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR PIP snapshot] ошибка проверки суток:', err.message);
  }
}

setInterval(() => {
  checkAndSaveDrrPipSnapshot();
  checkAndSaveDrrPipDailySnapshot();
}, 60 * 1000);
checkAndSaveDrrPipSnapshot();
checkAndSaveDrrPipDailySnapshot();

/* Хелпер: дозаполнить week_number / shift_letter */
function enrichPipSnapshot(r) {
  const shiftDate = String(r.shift_date).slice(0, 10);
  const weekNumber = r.week_number != null
    ? r.week_number
    : getWeekNumberForDate(shiftDate);
  const shiftLetter = r.shift_letter != null
    ? r.shift_letter
    : getShiftLetterForSnapshot(r.shift, weekNumber);

  return {
    id: r.id,
    shiftDate,
    weekNumber,
    shift: r.shift,
    shiftLetter,
    snapshotTime: r.snapshot_time,
    totalVins: r.total_vins,
    closedVins: r.closed_vins,
    nokVins: r.nok_vins,
    drrPercent: Number(r.drr_percent),
  };
}

/* ЭНДПОИНТ: список снимков */
app.get('/api/drr-pip-snapshots', async (req, res) => {
  try {
    const { days = 14 } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);

    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, snapshot_time,
             total_vins, closed_vins, nok_vins, drr_percent
      FROM drr_pip_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY shift_date DESC,
        FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays]);

    res.json(rows.map(enrichPipSnapshot));
  } catch (err) {
    console.error('Ошибка /api/drr-pip-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ЭНДПОИНТ: один снимок с top_defects */
app.get('/api/drr-pip-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query(
      'SELECT * FROM drr_pip_snapshots WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Снимок не найден' });

    const r = rows[0];
    let topDefects = [];
    try {
      topDefects = r.top_defects
        ? (typeof r.top_defects === 'string' ? JSON.parse(r.top_defects) : r.top_defects)
        : [];
    } catch { topDefects = []; }

    res.json({
      ...enrichPipSnapshot(r),
      topDefects,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-pip-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});







app.get('/api/drr-electronics-top-defects', async (req, res) => {
  try {
    const { dateFrom, dateTo, model, grades, posts } = req.query;
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });
    }

    const start = new Date(`${dateFrom}T00:00:00`);
    const end = new Date(`${dateTo}T23:59:59`);

    const electronicsPosts = [
      'CP7', 'CP7 Gate', 'CP78', 'CP79', 'EXT1',
      'PIP2', 'PIP4', 'PIP9',
      '360', 'ADAS+RB', 'CP8', 'CP8 Gate', 'REPAIR', 'REPAIR_Final',
      'TEST TRACK', 'T-UP', 'WA', 'WT', 'CP8 Touch Up',
      'REPAIR VERIFICATION', 'TRACK', 'ROLL'
    ];

    const selected = (!posts || posts === 'ALL') ? ['ALL'] : posts.split(',').map(s => s.trim());
    const useRobot = selected.includes('ALL') || selected.includes('ROBOT');
    const useRegular = selected.includes('ALL') || selected.some(p => electronicsPosts.includes(p));

    const allRows = [];

    // ─── РОБОТЫ ───
    if (useRobot) {
      const [refuelRows] = await pool.query(`
        SELECT VIN, CREATION_TIME,
          CASE
            WHEN OIL_TYPE = 'BK' THEN 'Заправка тормозов – NG'
            WHEN OIL_TYPE = 'AC' THEN 'Заправка кондиционера – NG'
            WHEN OIL_TYPE = 'CL1' THEN 'Заправка антифриза - NG'
            WHEN OIL_TYPE = 'WW' THEN 'Заправка омывайки - NG'
            WHEN OIL_TYPE = 'PREAC' THEN 'Тест утечки кондиц. – NG'
            WHEN OIL_TYPE = 'PREBK' THEN 'Тест утечки тормозной – NG'
            WHEN OIL_TYPE = 'E7' THEN 'Заправка трансмиссионного – NG'
          END AS PART_NAME,
          '' AS PROBLEM_TYPE,
          'A' AS PROBLEM_GRADE,
          'ROBOT' AS POST_NAME
        FROM at_im_refuel_log
        WHERE FILL_RESULT IN ('NOK','NG')
          AND OIL_TYPE IN ('WW','PREAC','BK','CL1','AC','PREBK','E7')
      `);
      allRows.push(...refuelRows);

      const [electricalRows] = await pool.query(`
        SELECT VIN, CREATION_TIME,
          CASE
            WHEN \`TYPE\` = '03' THEN 'Прошивка EOL - NG'
            WHEN \`TYPE\` = '05' THEN 'ЭП4К - Проверка TMPS – NG'
            WHEN \`TYPE\` = '17' THEN 'Запись - Прошивка FLASH – NG'
            WHEN \`TYPE\` = '21' THEN 'МДВШ - Прошивка TMPS - NG'
            WHEN \`TYPE\` = '26' THEN 'ERA - Прошивка ERA - NG'
            WHEN \`TYPE\` = '27' THEN 'APK - Блок управления программируемых специальных функций - Запись кода, не в норме'
          END AS PART_NAME,
          '' AS PROBLEM_TYPE,
          'A' AS PROBLEM_GRADE,
          'ROBOT' AS POST_NAME
        FROM at_im_electrical_check_info
        WHERE RESULT IN ('NOK','NG')
          AND \`TYPE\` IN ('03','05','17','21','26','27')
      `);
      allRows.push(...electricalRows);

      const [executeRows] = await pool.query(`
        SELECT VIN, CREATION_TIME,
          CASE
            WHEN EQP_NUM = 'AGMADAS01' THEN 'Проверка ADAS - NG'
            WHEN EQP_NUM = 'AGMFL01' THEN 'Тест утечки бензобак - NG'
            WHEN EQP_NUM = 'AGMRB01' THEN 'Проверка R&B - NG'
            WHEN EQP_NUM = 'AGMTPMS01' THEN 'Проверка TMPS – NG'
            WHEN EQP_NUM = 'AGMWAHA01' THEN 'Проверка WA - NG'
          END AS PART_NAME,
          '' AS PROBLEM_TYPE,
          'A' AS PROBLEM_GRADE,
          'ROBOT' AS POST_NAME
        FROM at_im_execute_result
        WHERE FINAL_RESULT IN ('NOK','NG')
          AND EQP_NUM IN ('AGMADAS01','AGMFL01','AGMRB01','AGMTPMS01','AGMWAHA01')
      `);
      allRows.push(...executeRows);
    }

    // ─── ОБЫЧНЫЕ ДЕФЕКТЫ (только оффлайн) ───
    if (useRegular) {
      const postListStr = electronicsPosts.map(p => `'${p}'`).join(',');
      const [regularRows] = await pool.query(`
        SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, POST_NAME
        FROM (
          SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, POST_NAME
          FROM at_biw_qm_defect_info
          WHERE POST_NAME IN (${postListStr})
            AND (OFFLINE OR OFFLINE1 OR OFFLINE2) = 1
            AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
            AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          UNION ALL
          SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, POST_NAME
          FROM at_paint_qm_defect_info
          WHERE POST_NAME IN (${postListStr})
            AND (OFFLINE OR OFFLINE1 OR OFFLINE2) = 1
            AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
            AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          UNION ALL
          SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, POST_NAME
          FROM at_qm_defect_info
          WHERE POST_NAME IN (${postListStr})
            AND (OFFLINE OR OFFLINE1 OR OFFLINE2) = 1
            AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
            AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        ) t
      `);
      allRows.push(...regularRows);
    }

    // ─── Фильтр по дате ───
    let filteredRows = allRows.filter(r => {
      const t = new Date(r.CREATION_TIME);
      return t >= start && t <= end;
    });

    // ─── Модели для VIN (через pool, где лежит work_order) ───
    const vins = [...new Set(filteredRows.map(r => r.VIN))];
    const modelMap = {};
    if (vins.length) {
      const placeholders = vins.map(() => '?').join(',');
      const [modelRows] = await pool.query(
        `SELECT VIN, MODEL FROM work_order WHERE VIN IN (${placeholders})`,
        vins
      );
      modelRows.forEach(r => { modelMap[r.VIN] = r.MODEL; });
    }

    // ─── Фильтр по модели (если выбран конкретный) ───
    if (model && model !== 'ALL') {
      const modelList = model.split(',').map(m => m.trim());
      filteredRows = filteredRows.filter(r => modelList.includes(modelMap[r.VIN]));
    }

    // ─── Фильтр по классам ───
    if (grades && grades !== 'ALL') {
      const gradeList = grades.split(',').map(g => g.trim());
      filteredRows = filteredRows.filter(r => gradeList.includes(r.PROBLEM_GRADE));
    }

    // ─── ВАЖНО: убираем записи без модели (VIN не найден в work_order) ───
    filteredRows = filteredRows.filter(r => modelMap[r.VIN] && modelMap[r.VIN] !== '-');

    // ─── Группировка ───
    const groupMap = new Map();
    filteredRows.forEach(r => {
      // key без знака '-' для модели
      const key = `${modelMap[r.VIN]}|${r.PART_NAME}|${r.PROBLEM_TYPE}|${r.POST_NAME}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          model: modelMap[r.VIN],
          part_name: r.PART_NAME,
          problem_type: r.PROBLEM_TYPE,
          post_name: r.POST_NAME,
          vins: new Set(),
          defects: 0,
        });
      }
      const item = groupMap.get(key);
      item.vins.add(r.VIN);
      item.defects += 1;
    });

    // ─── DPU: VIN, прошедшие CP72 (БЕЗ JOIN между разными пулами) ───
    const [cp72VinRows] = await mesPool.query(
      `SELECT DISTINCT tm.vin AS VIN
       FROM ti_mes_movement tm
       WHERE tm.uloc_no = 'CP72'
         AND tm.scan_time >= ? AND tm.scan_time <= ?`,
      [dateFrom + ' 00:00:00', dateTo + ' 23:59:59']
    );
    let cp72Vins = cp72VinRows.map(r => r.VIN);

    let totalCp72 = cp72Vins.length;
    if (model && model !== 'ALL' && cp72Vins.length > 0) {
      const modelList = model.split(',').map(m => m.trim());
      const vinPlaceholders = cp72Vins.map(() => '?').join(',');
      const modelPlaceholders = modelList.map(() => '?').join(',');
      const [filteredCp72] = await pool.query(
        `SELECT COUNT(DISTINCT VIN) AS cnt
         FROM work_order
         WHERE VIN IN (${vinPlaceholders})
           AND MODEL IN (${modelPlaceholders})`,
        [...cp72Vins, ...modelList]
      );
      totalCp72 = filteredCp72[0]?.cnt || 0;
    }

    // ─── Итог ───
    const result = Array.from(groupMap.values()).map(item => ({
      MPP: `${item.model} ${item.part_name} ${item.problem_type}`.trim(),
      MODEL: item.model,
      PART_NAME: item.part_name,
      PROBLEM_TYPE: item.problem_type,
      VIN_COUNT: item.vins.size,
      DEFECT_COUNT: item.defects,
      DPU: totalCp72 > 0 ? Number((item.defects * 1000 / totalCp72).toFixed(2)) : 0,
      POST_NAME: item.post_name,
      TOTAL_CP72_VINS: totalCp72,
    }));

    result.sort((a, b) => b.DEFECT_COUNT - a.DEFECT_COUNT);
    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-electronics-top-defects:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-electronics-vins-top-mpp', async (req, res) => {
  try {
    const { partName, problemType, model, dateFrom, dateTo } = req.query;
    if (!partName || !model || !dateFrom || !dateTo) {
      return res.status(400).json({ error: 'Недостаточно параметров' });
    }

    const finalProblemType = problemType || '';

    const electronicsPosts = [
      'CP7', 'CP7 Gate', 'CP78', 'CP79', 'EXT1',
      'PIP2', 'PIP4', 'PIP9',
      '360', 'ADAS+RB', 'CP8', 'CP8 Gate', 'REPAIR', 'REPAIR_Final',
      'TEST TRACK', 'T-UP', 'WA', 'WT', 'CP8 Touch Up',
      'REPAIR VERIFICATION', 'TRACK', 'ROLL'
    ];
    const postListStr = electronicsPosts.map(p => `'${p}'`).join(',');

    // Шаг 1: VIN с заданным электронным дефектом

    // 1.1 Роботы: refuel_log
    const [refuelVins] = await pool.query(`
      SELECT r.VIN
      FROM at_im_refuel_log r
      JOIN work_order wo ON wo.VIN = r.VIN
      WHERE r.FILL_RESULT IN ('NOK','NG')
        AND r.OIL_TYPE IN ('WW','PREAC','BK','CL1','AC','PREBK','E7')
        AND CASE
          WHEN r.OIL_TYPE = 'BK' THEN 'Заправка тормозов – NG'
          WHEN r.OIL_TYPE = 'AC' THEN 'Заправка кондиционера – NG'
          WHEN r.OIL_TYPE = 'CL1' THEN 'Заправка антифриза - NG'
          WHEN r.OIL_TYPE = 'WW' THEN 'Заправка омывайки - NG'
          WHEN r.OIL_TYPE = 'PREAC' THEN 'Тест утечки кондиц. – NG'
          WHEN r.OIL_TYPE = 'PREBK' THEN 'Тест утечки тормозной – NG'
          WHEN r.OIL_TYPE = 'E7' THEN 'Заправка трансмиссионного – NG'
        END = ?
        AND '' = ?
        AND wo.MODEL = ?
        AND DATE(r.CREATION_TIME) BETWEEN ? AND ?
    `, [partName, finalProblemType, model, dateFrom, dateTo]);

    // 1.2 Роботы: electrical_check_info
    const [electricalVins] = await pool.query(`
      SELECT e.VIN
      FROM at_im_electrical_check_info e
      JOIN work_order wo ON wo.VIN = e.VIN
      WHERE e.RESULT IN ('NOK','NG')
        AND e.\`TYPE\` IN ('03','05','17','21','26','27')
        AND CASE
          WHEN e.\`TYPE\` = '03' THEN 'Прошивка EOL - NG'
          WHEN e.\`TYPE\` = '05' THEN 'ЭП4К - Проверка TMPS – NG'
          WHEN e.\`TYPE\` = '17' THEN 'Запись - Прошивка FLASH – NG'
          WHEN e.\`TYPE\` = '21' THEN 'МДВШ - Прошивка TMPS - NG'
          WHEN e.\`TYPE\` = '26' THEN 'ERA - Прошивка ERA - NG'
          WHEN e.\`TYPE\` = '27' THEN 'APK - Блок управления программируемых специальных функций - Запись кода, не в норме'
        END = ?
        AND '' = ?
        AND wo.MODEL = ?
        AND DATE(e.CREATION_TIME) BETWEEN ? AND ?
    `, [partName, finalProblemType, model, dateFrom, dateTo]);

    // 1.3 Роботы: execute_result
    const [executeVins] = await pool.query(`
      SELECT ex.VIN
      FROM at_im_execute_result ex
      JOIN work_order wo ON wo.VIN = ex.VIN
      WHERE ex.FINAL_RESULT IN ('NOK','NG')
        AND ex.EQP_NUM IN ('AGMADAS01','AGMFL01','AGMRB01','AGMTPMS01','AGMWAHA01')
        AND CASE
          WHEN ex.EQP_NUM = 'AGMADAS01' THEN 'Проверка ADAS - NG'
          WHEN ex.EQP_NUM = 'AGMFL01' THEN 'Тест утечки бензобак - NG'
          WHEN ex.EQP_NUM = 'AGMRB01' THEN 'Проверка R&B - NG'
          WHEN ex.EQP_NUM = 'AGMTPMS01' THEN 'Проверка TMPS – NG'
          WHEN ex.EQP_NUM = 'AGMWAHA01' THEN 'Проверка WA - NG'
        END = ?
        AND '' = ?
        AND wo.MODEL = ?
        AND DATE(ex.CREATION_TIME) BETWEEN ? AND ?
    `, [partName, finalProblemType, model, dateFrom, dateTo]);

    // 1.4 Обычные оффлайн‑дефекты
    const [regularVins] = await pool.query(`
      SELECT reg.VIN
      FROM (
        SELECT VIN, CREATION_TIME, PART_NAME AS part_name, PROBLEM_TYPE AS problem_type
        FROM at_biw_qm_defect_info
        WHERE POST_NAME IN (${postListStr})
          AND (OFFLINE OR OFFLINE1 OR OFFLINE2) = 1
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        UNION ALL
        SELECT VIN, CREATION_TIME, PART_NAME AS part_name, PROBLEM_TYPE AS problem_type
        FROM at_paint_qm_defect_info
        WHERE POST_NAME IN (${postListStr})
          AND (OFFLINE OR OFFLINE1 OR OFFLINE2) = 1
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        UNION ALL
        SELECT VIN, CREATION_TIME, PART_NAME AS part_name, PROBLEM_TYPE AS problem_type
        FROM at_qm_defect_info
        WHERE POST_NAME IN (${postListStr})
          AND (OFFLINE OR OFFLINE1 OR OFFLINE2) = 1
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
      ) reg
      JOIN work_order wo ON wo.VIN = reg.VIN
      WHERE reg.part_name = ? AND reg.problem_type = ?
        AND wo.MODEL = ?
        AND DATE(reg.CREATION_TIME) BETWEEN ? AND ?
    `, [partName, finalProblemType, model, dateFrom, dateTo]);

    // Собираем уникальные VIN
    const vinsSet = new Set();
    [...refuelVins, ...electricalVins, ...executeVins, ...regularVins].forEach(row => vinsSet.add(row.VIN));
    const vins = Array.from(vinsSet);
    if (vins.length === 0) return res.json([]);

    const placeholders = vins.map(() => '?').join(',');

    // Шаг 2: все дефекты (онлайн/оффлайн) для этих VIN
    const defectsSql = `
      SELECT 
        wo.MODEL,
        CONCAT(wo.MODEL, ' ', d.PART_NAME, ' ', d.PROBLEM_TYPE) AS MPP,
        COUNT(*) AS CNT,
        MAX(d.is_offline) AS IS_OFFLINE
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS is_offline
        FROM at_biw_qm_defect_info
        WHERE VIN IN (${placeholders})
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          AND DATE(CREATION_TIME) BETWEEN ? AND ?
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS is_offline
        FROM at_paint_qm_defect_info
        WHERE VIN IN (${placeholders})
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          AND DATE(CREATION_TIME) BETWEEN ? AND ?
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS is_offline
        FROM at_qm_defect_info
        WHERE VIN IN (${placeholders})
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          AND DATE(CREATION_TIME) BETWEEN ? AND ?
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      GROUP BY wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE
      ORDER BY CNT DESC
    `;

    // Параметры: сначала все VIN, затем dateFrom, dateTo для каждого из трёх UNION блоков
    const defectsParams = [...vins, dateFrom, dateTo, ...vins, dateFrom, dateTo, ...vins, dateFrom, dateTo];
    const [defectRows] = await pool.query(defectsSql, defectsParams);

    const result = defectRows.map(r => ({
      MPP: r.MPP.trim(),
      MODEL: r.MODEL,
      DEFECT_COUNT: r.CNT,
      IS_OFFLINE: r.IS_OFFLINE ? 'Оффлайн' : 'Онлайн',
    }));

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-electronics-vins-top-mpp:', err);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/drr-electronics-elec-vins', async (req, res) => {
  try {
    const { typeCode, model, dateFrom, dateTo } = req.query;
    if (!model || !dateFrom || !dateTo) {
      return res.status(400).json({ error: 'model, dateFrom, dateTo обязательны' });
    }
    const types = (typeCode && typeCode !== 'ALL') ? typeCode.split(',') : ['03', '26', '17'];
    const typePlaceholders = types.map(() => '?').join(',');
    const [rows] = await pool.query(`
      SELECT DISTINCT e.VIN, wo.MODEL
      FROM at_im_electrical_check_info e
      JOIN work_order wo ON wo.VIN = e.VIN
      WHERE e.\`TYPE\` IN (${typePlaceholders})
        AND e.RESULT IN ('NG','NOK')
        AND wo.MODEL = ?
        AND e.CREATION_TIME BETWEEN ? AND ?
    `, [...types, model, `${dateFrom} 00:00:00`, `${dateTo} 23:59:59`]);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка drr-electronics-elec-vins:', err);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/drr-electronics-vin-defects', async (req, res) => {
  try {
    const { vin } = req.query; // только VIN, без дат
    if (!vin) return res.status(400).json({ error: 'vin обязателен' });

    // Получаем модель VIN
    const [modelRows] = await pool.query(
      `SELECT MODEL FROM work_order WHERE VIN = ?`,
      [vin]
    );
    if (modelRows.length === 0) return res.json([]);

    // Все дефекты из трёх обычных таблиц (без фильтра по дате и статусу)
    const defectSql = `
      SELECT 
        wo.MODEL,
        CONCAT(wo.MODEL, ' ', d.PART_NAME, ' ', d.PROBLEM_TYPE) AS MPP,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        COUNT(*) AS CNT,
        MAX(d.PROBLEM_REPLENISH) AS COMMENT,
        MAX(d.is_offline) AS IS_OFFLINE
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS is_offline
        FROM at_biw_qm_defect_info
        WHERE VIN = ?
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS is_offline
        FROM at_paint_qm_defect_info
        WHERE VIN = ?
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_REPLENISH,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS is_offline
        FROM at_qm_defect_info
        WHERE VIN = ?
          AND PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      GROUP BY wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE
      ORDER BY CNT DESC
    `;

    const [rows] = await pool.query(defectSql, [vin, vin, vin]);

    const result = rows.map(r => ({
      MPP: r.MPP.trim(),
      MODEL: r.MODEL,
      DEFECT_COUNT: r.CNT,
      COMMENT: r.COMMENT || '',
      IS_OFFLINE: r.IS_OFFLINE ? 'Оффлайн' : 'Онлайн',
    }));

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-electronics-vin-defects:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-electronics-defect-trend', async (req, res) => {
  try {
    const { partName, problemType, model, postName, periodType } = req.query;
    if (!partName || model === undefined || !periodType) {
      return res.status(400).json({ error: 'partName, model, periodType обязательны' });
    }
    const finalProblemType = problemType || '';
    const isRobot = postName === 'ROBOT';
    const hasModelFilter = !!(model && model !== 'ALL');
    const modelList = hasModelFilter ? model.split(',').map(m => m.trim()).filter(Boolean) : [];

    // ─── Генерация периодов ───
    function getISOWeekInfo(date) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      return { year: d.getUTCFullYear(), week: weekNo };
    }

    const generatePeriods = () => {
      const now = new Date();
      const periods = [];
      if (periodType === 'month') {
        for (let i = 2; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
      } else if (periodType === 'week') {
        const current = new Date(now);
        const day = current.getDay();
        const mondayOffset = day === 0 ? -6 : 1 - day;
        const thisMonday = new Date(current);
        thisMonday.setDate(current.getDate() + mondayOffset);
        thisMonday.setHours(0, 0, 0, 0);
        for (let i = 3; i >= 0; i--) {
          const ws = new Date(thisMonday);
          ws.setDate(thisMonday.getDate() - i * 7);
          const iso = getISOWeekInfo(ws);
          periods.push(`${iso.year}-W${String(iso.week).padStart(2, '0')}`);
        }
      } else if (periodType === 'day') {
        for (let i = 13; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(now.getDate() - i);
          periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        }
      }
      return periods;
    };

    const periods = generatePeriods();
    if (periods.length === 0) return res.json([]);

    // ─── Общие шаблоны ───
    const makePeriodExpr = (col) => periodType === 'month'
      ? `DATE_FORMAT(DATE(${col}), '%Y-%m')`
      : periodType === 'week'
        ? `DATE_FORMAT(DATE(${col}), '%x-W%v')`
        : `DATE(${col})`;

    const makePeriodIn = (col) => {
      const ph = periods.map(() => '?').join(',');
      return periodType === 'month'
        ? `DATE_FORMAT(DATE(${col}), '%Y-%m') IN (${ph})`
        : periodType === 'week'
          ? `DATE_FORMAT(DATE(${col}), '%x-W%v') IN (${ph})`
          : `DATE(${col}) IN (${ph})`;
    };

    const modelFilterSql = hasModelFilter
      ? ` AND wo.MODEL IN (${modelList.map(() => '?').join(',')})`
      : '';
    const modelParams = hasModelFilter ? modelList : [];

    const electronicsPosts = [
      'CP7', 'CP7 Gate', 'CP78', 'CP79', 'EXT1',
      'PIP2', 'PIP4', 'PIP9',
      '360', 'ADAS+RB', 'CP8', 'CP8 Gate', 'REPAIR', 'REPAIR_Final',
      'TEST TRACK', 'T-UP', 'WA', 'WT', 'CP8 Touch Up',
      'REPAIR VERIFICATION', 'TRACK', 'ROLL'
    ];
    const postListStr = electronicsPosts.map(p => `'${p}'`).join(',');

    let defectRows = [];

    // ============ РОБОТЫ ============
    if (isRobot) {
      // 1) refuel_log
      const [refuelRows] = await pool.query(`
        SELECT ${makePeriodExpr('r.CREATION_TIME')} AS period, COUNT(*) AS cnt
        FROM at_im_refuel_log r
        JOIN work_order wo ON wo.VIN = r.VIN
        WHERE r.FILL_RESULT IN ('NOK','NG')
          AND r.OIL_TYPE IN ('WW','PREAC','BK','CL1','AC','PREBK','E7')
          AND (CASE
            WHEN r.OIL_TYPE = 'BK' THEN 'Заправка тормозов – NG'
            WHEN r.OIL_TYPE = 'AC' THEN 'Заправка кондиционера – NG'
            WHEN r.OIL_TYPE = 'CL1' THEN 'Заправка антифриза - NG'
            WHEN r.OIL_TYPE = 'WW' THEN 'Заправка омывайки - NG'
            WHEN r.OIL_TYPE = 'PREAC' THEN 'Тест утечки кондиц. – NG'
            WHEN r.OIL_TYPE = 'PREBK' THEN 'Тест утечки тормозной – NG'
            WHEN r.OIL_TYPE = 'E7' THEN 'Заправка трансмиссионного – NG'
          END) = ?
          AND '' = ?
          AND ${makePeriodIn('r.CREATION_TIME')}
          ${modelFilterSql}
        GROUP BY period
      `, [partName, finalProblemType, ...periods, ...modelParams]);

      // 2) electrical_check_info
      const [electricalRows] = await pool.query(`
        SELECT ${makePeriodExpr('e.CREATION_TIME')} AS period, COUNT(*) AS cnt
        FROM at_im_electrical_check_info e
        JOIN work_order wo ON wo.VIN = e.VIN
        WHERE e.RESULT IN ('NOK','NG') AND \`TYPE\` IN ('03','05','17','21','26','27')
          AND (CASE
            WHEN \`TYPE\` = '03' THEN 'Прошивка EOL - NG'
            WHEN e.\`TYPE\` = '05' THEN 'ЭП4К - Проверка TMPS – NG'
            WHEN e.\`TYPE\` = '17' THEN 'Запись - Прошивка FLASH – NG'
            WHEN e.\`TYPE\` = '21' THEN 'МДВШ - Прошивка TMPS - NG'
            WHEN e.\`TYPE\` = '26' THEN 'ERA - Прошивка ERA - NG'
            WHEN e.\`TYPE\` = '27' THEN 'APK - Блок управления программируемых специальных функций - Запись кода, не в норме'
          END) = ?
          AND '' = ?
          AND ${makePeriodIn('e.CREATION_TIME')}
          ${modelFilterSql}
        GROUP BY period
      `, [partName, finalProblemType, ...periods, ...modelParams]);

      // 3) execute_result
      const [executeRows] = await pool.query(`
        SELECT ${makePeriodExpr('ex.CREATION_TIME')} AS period, COUNT(*) AS cnt
        FROM at_im_execute_result ex
        JOIN work_order wo ON wo.VIN = ex.VIN
        WHERE ex.FINAL_RESULT IN ('NOK','NG')
          AND ex.EQP_NUM IN ('AGMADAS01','AGMFL01','AGMRB01','AGMTPMS01','AGMWAHA01')
          AND (CASE
            WHEN ex.EQP_NUM = 'AGMADAS01' THEN 'Проверка ADAS - NG'
            WHEN ex.EQP_NUM = 'AGMFL01' THEN 'Тест утечки бензобак - NG'
            WHEN ex.EQP_NUM = 'AGMRB01' THEN 'Проверка R&B - NG'
            WHEN ex.EQP_NUM = 'AGMTPMS01' THEN 'Проверка TMPS – NG'
            WHEN ex.EQP_NUM = 'AGMWAHA01' THEN 'Проверка WA - NG'
          END) = ?
          AND '' = ?
          AND ${makePeriodIn('ex.CREATION_TIME')}
          ${modelFilterSql}
        GROUP BY period
      `, [partName, finalProblemType, ...periods, ...modelParams]);

      defectRows = [...refuelRows, ...electricalRows, ...executeRows];
    } else {
      // ============ ОБЫЧНЫЕ ОФФЛАЙН-ДЕФЕКТЫ ============
      const [regularRows] = await pool.query(`
        SELECT period, COUNT(*) AS cnt
        FROM (
          SELECT ${makePeriodExpr('CREATION_TIME')} AS period, VIN, PART_NAME, PROBLEM_TYPE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_biw_qm_defect_info
          UNION ALL
          SELECT ${makePeriodExpr('CREATION_TIME')} AS period, VIN, PART_NAME, PROBLEM_TYPE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_paint_qm_defect_info
          UNION ALL
          SELECT ${makePeriodExpr('CREATION_TIME')} AS period, VIN, PART_NAME, PROBLEM_TYPE, POST_NAME,
                 (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
          FROM at_qm_defect_info
        ) QM_DEF
        JOIN work_order wo ON wo.VIN = QM_DEF.VIN
        WHERE S_OFFLINE = 1
          AND PART_NAME = ? AND PROBLEM_TYPE = ? AND POST_NAME = ?
          AND ${makePeriodIn('period')}
          ${modelFilterSql}
        GROUP BY period
      `, [partName, finalProblemType, postName, ...periods, ...modelParams]);
      defectRows = regularRows;
    }

    // period → count
    const defectMap = {};
    defectRows.forEach(r => {
      defectMap[r.period] = (defectMap[r.period] || 0) + Number(r.cnt);
    });

    // ─── total_cars по CP72 (уже фильтруется по модели) ───
    const result = [];
    for (const period of periods) {
      const carCondition = periodType === 'month'
        ? `DATE_FORMAT(DATE(t.CREATION_TIME), '%Y-%m') = ?`
        : periodType === 'week'
          ? `DATE_FORMAT(DATE(t.CREATION_TIME), '%x-W%v') = ?`
          : `DATE(t.CREATION_TIME) = ?`;

      let carSql = `
        SELECT COUNT(DISTINCT t.VIN) AS total
        FROM at_om_wiptrackinghistory t
        ${hasModelFilter ? 'JOIN work_order wo ON wo.VIN = t.VIN' : ''}
        WHERE t.WC_NAME = 'CP72'
          AND ${carCondition}
          ${hasModelFilter ? `AND wo.MODEL IN (${modelList.map(() => '?').join(',')})` : ''}
      `;
      const carParams = [period, ...modelParams];
      const [carRows] = await pool.query(carSql, carParams);
      const totalCars = carRows[0]?.total || 0;

      result.push({
        period,
        defect_count: defectMap[period] || 0,
        total_cars: totalCars,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-electronics-defect-trend:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-electronics-top-elec-defects', async (req, res) => {
  try {
    const { dateFrom, dateTo, models, categories } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });

    const TYPE_TO_CATEGORY = { '03': 'Прошивка EOL NG', '26': 'Прошивка ERA NG', '17': 'Прошивка Запись/FLASH NG' };
    const CATEGORY_TO_TYPES = {
      'Прошивка EOL NG': ['03'],
      'Прошивка ERA NG': ['26'],
      'Прошивка Запись/FLASH NG': ['17'],
    };
    const ALL_CATEGORIES = Object.keys(CATEGORY_TO_TYPES);

    const selectedCategories = (!categories || categories === 'ALL')
      ? ALL_CATEGORIES
      : categories.split(',').map(s => s.trim()).filter(c => CATEGORY_TO_TYPES[c]);
    const typesToQuery = selectedCategories.flatMap(c => CATEGORY_TO_TYPES[c]);
    if (!typesToQuery.length) return res.json([]);

    const typePlaceholders = typesToQuery.map(() => '?').join(',');
    const params = [...typesToQuery, `${dateFrom} 00:00:00`, `${dateTo} 23:59:59`];

    let modelCondition = '';
    if (models && models !== 'ALL') {
      const modelList = models.split(',').map(s => s.trim()).filter(Boolean);
      if (modelList.length) {
        modelCondition = ` AND wo.MODEL IN (${modelList.map(() => '?').join(',')})`;
        params.push(...modelList);
      }
    }

    // ── 1. Категорийная разбивка: MODEL × TYPE ──
    const [rows] = await pool.query(`
      SELECT
        wo.MODEL,
        e.\`TYPE\` AS TYPE_CODE,
        SUM(CASE WHEN e.RESULT IN ('NG','NOK') THEN 1 ELSE 0 END) AS NG_COUNT,
        SUM(CASE WHEN e.RESULT = 'OK' THEN 1 ELSE 0 END) AS OK_COUNT,
        COUNT(DISTINCT CASE WHEN e.RESULT IN ('NG','NOK') THEN e.VIN END) AS VIN_NG_COUNT,
        COUNT(DISTINCT e.VIN) AS VIN_TOTAL_COUNT
      FROM at_im_electrical_check_info e
      JOIN work_order wo ON wo.VIN = e.VIN
      WHERE e.\`TYPE\` IN (${typePlaceholders})
        AND e.CREATION_TIME BETWEEN ? AND ?
        AND wo.MODEL IS NOT NULL AND wo.MODEL <> '-'
        ${modelCondition}
      GROUP BY wo.MODEL, e.\`TYPE\`
    `, params);

    // ── 2. Агрегат по моделям: DISTINCT VIN без разбивки по типу ──
    const [aggRows] = await pool.query(`
      SELECT
        wo.MODEL,
        SUM(CASE WHEN e.RESULT IN ('NG','NOK') THEN 1 ELSE 0 END) AS NG_COUNT,
        SUM(CASE WHEN e.RESULT = 'OK' THEN 1 ELSE 0 END) AS OK_COUNT,
        COUNT(DISTINCT CASE WHEN e.RESULT IN ('NG','NOK') THEN e.VIN END) AS VIN_NG_COUNT,
        COUNT(DISTINCT e.VIN) AS VIN_TOTAL_COUNT
      FROM at_im_electrical_check_info e
      JOIN work_order wo ON wo.VIN = e.VIN
      WHERE e.\`TYPE\` IN (${typePlaceholders})
        AND e.CREATION_TIME BETWEEN ? AND ?
        AND wo.MODEL IS NOT NULL AND wo.MODEL <> '-'
        ${modelCondition}
      GROUP BY wo.MODEL
    `, params);

    const buildRow = (category, r) => {
      const ng = Number(r.NG_COUNT) || 0;
      const ok = Number(r.OK_COUNT) || 0;
      const total = ng + ok;
      return {
        CATEGORY: category,
        MODEL: r.MODEL,
        DEFECT_COUNT: ng,
        VIN_COUNT: Number(r.VIN_NG_COUNT) || 0,          // VIN с NG
        VIN_TOTAL_COUNT: Number(r.VIN_TOTAL_COUNT) || 0, // VIN всего
        OK_COUNT: ok,
        TOTAL_COUNT: total,
        NG_SHARE: total > 0 ? Number((ng * 100 / total).toFixed(1)) : 0,
      };
    };

    const aggregateRows = aggRows.map(r => buildRow('Агрегат по моделям', r));

    const categoriesMap = new Map();
    rows.forEach(r => {
      const category = TYPE_TO_CATEGORY[r.TYPE_CODE];
      if (!category || !selectedCategories.includes(category)) return;
      if (!categoriesMap.has(category)) categoriesMap.set(category, []);
      categoriesMap.get(category).push(buildRow(category, r));
    });

    const result = [...aggregateRows];
    selectedCategories.forEach(cat => {
      const list = categoriesMap.get(cat) || [];
      list.sort((a, b) => b.DEFECT_COUNT - a.DEFECT_COUNT);
      result.push(...list);
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-electronics-top-elec-defects:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-electronics-elec-defect-trend', async (req, res) => {
  try {
    const { typeCode, model, periodType } = req.query;
    if (!typeCode || !periodType) {
      return res.status(400).json({ error: 'typeCode и periodType обязательны' });
    }

    function getISOWeekInfo(date) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      return { year: d.getUTCFullYear(), week: weekNo };
    }

    const now = new Date();
    const periods = [];
    if (periodType === 'month') {
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }
    } else if (periodType === 'week') {
      const day = now.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const thisMonday = new Date(now);
      thisMonday.setDate(now.getDate() + mondayOffset);
      thisMonday.setHours(0, 0, 0, 0);
      for (let i = 3; i >= 0; i--) {
        const ws = new Date(thisMonday);
        ws.setDate(thisMonday.getDate() - i * 7);
        const iso = getISOWeekInfo(ws);
        periods.push(`${iso.year}-W${String(iso.week).padStart(2, '0')}`);
      }
    } else if (periodType === 'day') {
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      }
    }
    if (periods.length === 0) return res.json([]);

    const periodExpr = periodType === 'month'
      ? "DATE_FORMAT(DATE(e.CREATION_TIME), '%Y-%m')"
      : periodType === 'week'
        ? "DATE_FORMAT(DATE(e.CREATION_TIME), '%x-W%v')"
        : "DATE(e.CREATION_TIME)";

    const types = typeCode.split(',').map(s => s.trim());
    const typePlaceholders = types.map(() => '?').join(',');
    const periodPlaceholders = periods.map(() => '?').join(',');

    let modelCondition = '';
    const defectParams = [...types];
    if (model && model !== 'ALL') {
      modelCondition = ' AND wo.MODEL = ?';
      defectParams.push(model);
    }
    defectParams.push(...periods);

    const [defectRows] = await pool.query(`
      SELECT ${periodExpr} AS period, COUNT(*) AS cnt
      FROM at_im_electrical_check_info e
      JOIN work_order wo ON wo.VIN = e.VIN
      WHERE e.RESULT IN ('NOK','NG')
        AND e.\`TYPE\` IN (${typePlaceholders})
        ${modelCondition}
        AND ${periodExpr} IN (${periodPlaceholders})
      GROUP BY period
    `, defectParams);

    const defectMap = {};
    defectRows.forEach(r => {
      defectMap[r.period] = (defectMap[r.period] || 0) + Number(r.cnt);
    });

    // total_cars по CP72
    const modelList = (model && model !== 'ALL') ? model.split(',').map(m => m.trim()) : [];
    const result = [];

    for (const period of periods) {
      const carCondition = periodType === 'month'
        ? "DATE_FORMAT(DATE(t.CREATION_TIME), '%Y-%m') = ?"
        : periodType === 'week'
          ? "DATE_FORMAT(DATE(t.CREATION_TIME), '%x-W%v') = ?"
          : "DATE(t.CREATION_TIME) = ?";

      let carSql = `
        SELECT COUNT(DISTINCT t.VIN) AS total
        FROM at_om_wiptrackinghistory t
        ${modelList.length > 0 ? 'JOIN work_order wo ON wo.VIN = t.VIN' : ''}
        WHERE t.WC_NAME = 'CP72' AND ${carCondition}
      `;
      const carParams = [period];
      if (modelList.length > 0) {
        carSql += ` AND wo.MODEL IN (${modelList.map(() => '?').join(',')})`;
        carParams.push(...modelList);
      }
      const [carRows] = await pool.query(carSql, carParams);
      const totalCars = carRows[0]?.total || 0;

      result.push({
        period,
        defect_count: defectMap[period] || 0,
        total_cars: totalCars,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Ошибка drr-electronics-elec-defect-trend:', err);
    res.status(500).json({ error: err.message });
  }
});


// =========================================================================
// ЕДИНЫЙ ХЕЛПЕР: списки постов — ТОЧНО как в /api/brigade-report/data
// (ALL = CP7 + CP8 + PIP, БЕЗ TL)
// =========================================================================
function getPostsForCheckpoints(checkpoint) {
  const cp7Posts = [
    'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
    'REPAIR', 'REPAIR_Final',
    'EXT1', 'PIP2', 'PIP4', 'PIP9'
  ];
  const cp8Posts = [
    'CP8', 'CP8 Gate', 'CP8-gate',
    '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'
  ];
  const pipPosts = [
    'EXT1', 'PIP1', 'PIP2', 'PIP4', 'PIP5', 'PIP6', 'PIP8', 'PIP9'
  ];
  const tlPosts = [
    '360', 'ADAS', 'ADAS+RB', 'TEST TRACK', 'TRACK', 'WA', 'WT', 'CP8 Touch Up'
  ];

  if (!checkpoint || checkpoint === 'ALL') {
    return [...new Set([...cp7Posts, ...cp8Posts, ...pipPosts])];
  }

  const cps = checkpoint.split(',').map(c => c.trim()).filter(Boolean);
  let postList = [];
  for (const cp of cps) {
    if (cp === 'CP7') postList.push(...cp7Posts);
    else if (cp === 'CP8') postList.push(...cp8Posts);
    else if (cp === 'PIP') postList.push(...pipPosts);
    else if (cp === 'TL') postList.push(...tlPosts);
  }
  return [...new Set(postList)];
}

// =========================================================================
// ЕДИНЫЙ ХЕЛПЕР: online/offline
// =========================================================================
function getOfflineCondition(defectType) {
  if (defectType === 'offline') {
    return '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 1';
  }
  if (defectType === 'online') {
    return '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 0';
  }
  return '1=1';
}

// =========================================================================
// ЕДИНЫЙ ХЕЛПЕР: получить сырые дефекты за период
// IDENTICNO /api/brigade-report/data — без GROUP BY, без LIMIT.
// =========================================================================
async function fetchRawDefects(sqlStart, sqlEnd, checkpoint, defectType) {
  const postList = getPostsForCheckpoints(checkpoint);
  if (postList.length === 0) return [];
  const postListStr = postList.map(p => `'${p.replace(/'/g, "''")}'`).join(',');

  const offlineCondition = getOfflineCondition(defectType);

  const sql = `
    SELECT
      d.VIN,
      d.PART_NAME,
      d.PROBLEM_TYPE,
      d.CREATION_TIME,
      d.POST_NAME,
      wo.MODEL
    FROM (
      SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
             OFFLINE, OFFLINE1, OFFLINE2
      FROM at_biw_qm_defect_info
      WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
        AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        AND ${offlineCondition}
      UNION ALL
      SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
             OFFLINE, OFFLINE1, OFFLINE2
      FROM at_paint_qm_defect_info
      WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
        AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        AND ${offlineCondition}
      UNION ALL
      SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
             OFFLINE, OFFLINE1, OFFLINE2
      FROM at_qm_defect_info
      WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
        AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
        AND ${offlineCondition}
    ) d
    JOIN work_order wo ON wo.VIN = d.VIN
    WHERE d.POST_NAME IN (${postListStr})
      AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
  `;

  const [rows] = await pool.query(sql, [sqlStart, sqlEnd]);
  return rows;
}

// =========================================================================
// ЕДИНЫЙ ХЕЛПЕР: буква смены по UTC-времени
// =========================================================================
function getShiftLetterFromDate(creationTime) {
  const utc = new Date(creationTime);
  const moscow = new Date(utc.getTime() + 3 * 60 * 60 * 1000);
  const totalMinutes = moscow.getUTCHours() * 60 + moscow.getUTCMinutes();
  const year = moscow.getUTCFullYear();
  const month = moscow.getUTCMonth();
  const day = moscow.getUTCDate();

  const dateObj = new Date(Date.UTC(year, month, day));
  const dayNum = dateObj.getUTCDay() || 7;
  dateObj.setUTCDate(dateObj.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dateObj.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((dateObj - yearStart) / 86400000) + 1) / 7);
  const isEvenWeek = weekNumber % 2 === 0;

  let shiftType;
  if (totalMinutes >= 7 * 60 + 50 && totalMinutes <= 16 * 60 + 40) {
    shiftType = 'day';
  } else if (totalMinutes >= 16 * 60 + 41 || totalMinutes <= 1 * 60 + 30) {
    shiftType = 'evening';
  } else {
    shiftType = 'night';
  }

  if (shiftType === 'night') return 'C';
  if (shiftType === 'day') return isEvenWeek ? 'B' : 'A';
  return isEvenWeek ? 'A' : 'B';
}

// =========================================================================
// ЕДИНЫЙ ХЕЛПЕР: локальная дата Node в формате YYYY-MM-DD
// =========================================================================
function getLocalDateStr(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// =========================================================================
// ЕДИНЫЙ ХЕЛПЕР: формат SQL-даты из объекта Date (локальное время)
// =========================================================================
function formatSqlDateTime(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

// ================== БРИГАДНЫЙ ОТЧЁТ ==================

// Получение списка бригад
app.get('/api/brigade-report/brigades', async (req, res) => {
  try {
    const [rows] = await notesPool.query('SELECT id, name FROM brigades ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения списка бригад:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Получение данных для отчёта (гистограмма + топ дефектов без владельца)
// ================== БРИГАДНЫЙ ОТЧЁТ – ДАННЫЕ ДЛЯ ГИСТОГРАММЫ И ТАБЛИЦЫ ==================
app.get('/api/brigade-report/data', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      checkpoint,
      metric = 'count',
      defectType = 'all',
      shift = 'all',
    } = req.query;

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });
    }

    // ---------- Списки постов ----------
    const cp7Posts = ['CP7','CP7 Audit','CP7 Gate','CP7-gate','REPAIR','REPAIR_Final','EXT1','PIP2','PIP4','PIP9'];
    const cp8Posts = ['CP8','CP8 Gate','CP8-gate','360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT','CP8 Touch Up'];
    const pipPosts = ['EXT1','PIP1','PIP2','PIP4','PIP5','PIP6','PIP8','PIP9'];
    const tlPosts  = ['360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT','CP8 Touch Up'];

    let postList = [];
    if (!checkpoint || checkpoint === 'ALL') {
      postList = [...new Set([...cp7Posts, ...cp8Posts, ...pipPosts, ...tlPosts])];
    } else if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else if (checkpoint === 'PIP') postList = pipPosts;
    else if (checkpoint === 'TL')  postList = tlPosts;
    else return res.status(400).json({ error: 'Неверный checkpoint' });

    const postListStr = postList.map(p => `'${p.replace(/'/g, "''")}'`).join(',');

    let offlineCondition = '1=1';
    if (defectType === 'offline') {
      offlineCondition = '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 1';
    } else if (defectType === 'online') {
      offlineCondition = '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 0';
    }

    // ---------- Хелперы смен ----------
    const getISOWeek = (dateObj) => {
      const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };

    const toDateStr = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const getShiftType = (dateObj) => {
      const total = dateObj.getHours() * 60 + dateObj.getMinutes();
      if (total <= 90) return 'evening';
      if (total >= 91 && total < 470) return 'night';
      if (total <= 1000) return 'day';
      return 'evening';
    };

    const getShiftLetter = (shiftStartDate, shiftType) => {
      if (shiftType === 'night') return 'C';
      const week = getISOWeek(shiftStartDate);
      const isEven = week % 2 === 0;
      if (shiftType === 'day') return isEven ? 'B' : 'A';
      if (shiftType === 'evening') return isEven ? 'A' : 'B';
      return null;
    };

    const matchesShiftAndPeriod = (dateObj) => {
      const shiftType = getShiftType(dateObj);
      if (!shiftType) return false;

      const shiftStart = new Date(dateObj);
      if (shiftType === 'evening' && (dateObj.getHours() * 60 + dateObj.getMinutes()) <= 90) {
        shiftStart.setDate(shiftStart.getDate() - 1);
      }

      const shiftStartStr = toDateStr(shiftStart);
      if (shiftStartStr < dateFrom || shiftStartStr > dateTo) return false;

      if (shift !== 'all') {
        const letter = getShiftLetter(shiftStart, shiftType);
        if (letter !== shift) return false;
      }
      return true;
    };

    // ---------- 1. Все VIN с CP72_TIME ----------
    const nextDayObj = new Date(`${dateTo}T12:00:00`);
    nextDayObj.setDate(nextDayObj.getDate() + 1);
    const nextDayStr = `${nextDayObj.getFullYear()}-${String(nextDayObj.getMonth() + 1).padStart(2, '0')}-${String(nextDayObj.getDate()).padStart(2, '0')}`;

    const [cp72Rows] = await pool.query(`
      SELECT VIN, MIN(CREATION_TIME) AS CP72_TIME
      FROM at_om_wiptrackinghistory
      WHERE WC_NAME = 'CP72'
        AND CREATION_TIME >= ? AND CREATION_TIME <= ?
      GROUP BY VIN
    `, [`${dateFrom} 00:00:00`, `${nextDayStr} 23:59:59`]);

    // ---------- 2. Два знаменателя ----------
    // totalCars      = все VIN за период (знаменатель DPU, НЕ зависит от смены)
    // totalCarsShift = VIN, попавшие в окно смены (для отображения «Всего авто»)
    const periodStartStr = dateFrom;
    const periodEndStr = dateTo;
    let totalCars = 0;
    let totalCarsShift = 0;

    for (const row of cp72Rows) {
      if (!row.CP72_TIME) continue;
      const d = new Date(row.CP72_TIME);
      const dStr = toDateStr(d);

      // Все авто за период
      if (dStr >= periodStartStr && dStr <= periodEndStr) {
        totalCars += 1;
      }

      // Авто за выбранную смену
      if (matchesShiftAndPeriod(d)) {
        totalCarsShift += 1;
      }
    }

    // ---------- 3. Дефекты ----------
    const defectsSql = `
      SELECT
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.CREATION_TIME,
        wo.MODEL
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_biw_qm_defect_info
        WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          AND ${offlineCondition}
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_paint_qm_defect_info
        WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          AND ${offlineCondition}
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME,
               (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_qm_defect_info
        WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> ''
          AND ${offlineCondition}
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr})
        AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
    `;

    const [defectRows] = await pool.query(defectsSql, [
      `${dateFrom} 00:00:00`,
      `${nextDayStr} 23:59:59`,
    ]);

    // ---------- 4. Справочник владельцев ----------
    const [owners] = await notesPool.query(`
      SELECT do.model, do.part_name, do.problem_type, b.name AS brigade_name
      FROM defect_owners do
      LEFT JOIN brigades b ON do.brigade_id = b.id
    `);
    const ownerMap = new Map();
    owners.forEach(o => ownerMap.set(
      `${o.model}|${o.part_name}|${o.problem_type}`,
      o.brigade_name
    ));

    // ---------- 5. Фильтрация + группировка ----------
    const brigadeDataMap = new Map();
    let totalDefects = 0;

    for (const r of defectRows) {
      const d = new Date(r.CREATION_TIME);
      if (!matchesShiftAndPeriod(d)) continue;

      totalDefects += 1;

      const key = `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;
      const brigade = ownerMap.get(key) || 'Бригада не найдена';

      if (!brigadeDataMap.has(brigade)) {
        brigadeDataMap.set(brigade, {
          brigade, count: 0, dpu: 0,
          mppsMap: new Map(), mpps: [],
        });
      }
      const brigadeData = brigadeDataMap.get(brigade);
      brigadeData.count += 1;

      const mppKey = `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;
      if (!brigadeData.mppsMap.has(mppKey)) {
        brigadeData.mppsMap.set(mppKey, {
          model: r.MODEL, part_name: r.PART_NAME, problem_type: r.PROBLEM_TYPE,
          count: 0, dpu: 0,
        });
      }
      brigadeData.mppsMap.get(mppKey).count += 1;
    }

    // ---------- 6. DPU (знаменатель = totalCars за период) ----------
    const calculateDpu = (count) => {
      if (totalCars === 0) return 0;
      const raw = count / totalCars * 1000;
      return Number(Math.min(raw, 1000).toFixed(2));
    };

    for (const [, brigadeData] of brigadeDataMap) {
      brigadeData.dpu = calculateDpu(brigadeData.count);
      brigadeData.mpps = Array.from(brigadeData.mppsMap.values()).map(mpp => ({
        ...mpp,
        dpu: calculateDpu(mpp.count),
      }));
      brigadeData.mpps.sort((a, b) => b.count - a.count);
    }

    // ---------- 7. Ответ ----------
    const histogram = Array.from(brigadeDataMap.entries())
      .map(([name, data]) => ({
        category: name,
        value: metric === 'dpu' ? data.dpu : data.count,
        count: data.count,
        dpu: data.dpu,
      }))
      .sort((a, b) => b.count - a.count);

    const unassignedData = brigadeDataMap.get('Бригада не найдена');
    const unassignedCount = unassignedData ? unassignedData.count : 0;

    const topBrigades = Array.from(brigadeDataMap.entries())
      .filter(([name]) => name !== 'Бригада не найдена')
      .map(([name, data]) => ({
        brigade: name,
        count: data.count,
        dpu: data.dpu,
        mpps: data.mpps,
      }))
      .sort((a, b) => b.count - a.count);

    res.json({
      histogram,
      totalCars,           // все авто за период (знаменатель DPU)
      totalCarsShift,      // авто в окне смены (для UI «Всего авто»)
      unassignedCount,
      totalDefects,
      topBrigades,
    });
  } catch (err) {
    console.error('Ошибка brigade-report/data:', err.message);
    res.status(500).json({ error: err.message });
  }
});



// ================== БРИГАДНЫЙ ОТЧЁТ – ТОП ДЕФЕКТОВ БЕЗ ВЛАДЕЛЬЦА ==================
app.get('/api/brigade-report/unassigned-defects', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      startTime,
      endTime,
      checkpoint,
      defectType = 'all'
    } = req.query;

    // Определяем точное начало и конец периода
    let sqlStart, sqlEnd;
    if (startTime && endTime) {
      sqlStart = startTime;
      sqlEnd = endTime;
    } else {
      if (!dateFrom || !dateTo) {
        return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });
      }
      sqlStart = `${dateFrom} 00:00:00`;
      sqlEnd = `${dateTo} 23:59:59`;
    }

    // Списки постов (как в data)
    const cp7Posts = [
      'CP7', 'CP7 Audit', 'CP7 Gate', 'CP7-gate',
      'REPAIR', 'REPAIR_Final',
      'EXT1', 'PIP2', 'PIP4', 'PIP9'
    ];

    const cp8Posts = [
      'CP8', 'CP8 Gate', 'CP8-gate',
      '360', 'ADAS', 'ADAS+RB', 'TEST TRACK',
      'TRACK', 'WA', 'WT', 'CP8 Touch Up'
    ];

    const pipPosts = [
      'EXT1', 'PIP1', 'PIP2', 'PIP4',
      'PIP5', 'PIP6', 'PIP8', 'PIP9'
    ];

    const tlPosts = [
      '360', 'ADAS', 'ADAS+RB', 'TEST TRACK',
      'TRACK', 'WA', 'WT', 'CP8 Touch Up'
    ];

    let postList = [];

    if (!checkpoint || checkpoint === 'ALL') {
      postList = [
        ...new Set([
          ...cp7Posts,
          ...cp8Posts,
          ...pipPosts
        ])
      ];
    } else if (checkpoint === 'CP7') {
      postList = cp7Posts;
    } else if (checkpoint === 'CP8') {
      postList = cp8Posts;
    } else if (checkpoint === 'PIP') {
      postList = pipPosts;
    } else if (checkpoint === 'TL') {
      postList = tlPosts;
    } else {
      return res.status(400).json({
        error: 'Неверный checkpoint'
      });
    }

    const postListStr = postList
      .map(p => `'${p.replace(/'/g, "''")}'`)
      .join(',');

    // Фильтр типа дефекта
    let offlineCondition = '1=1';

    if (defectType === 'offline') {
      offlineCondition = '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 1';
    } else if (defectType === 'online') {
      offlineCondition = '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 0';
    }

    // Получаем все дефекты (те же, что и в data)
    const defectsSql = `
      SELECT
        d.VIN,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.CREATION_TIME,
        d.POST_NAME,
        wo.MODEL
      FROM (
        SELECT
          VIN,
          PART_NAME,
          PROBLEM_TYPE,
          CREATION_TIME,
          POST_NAME
        FROM at_biw_qm_defect_info
        WHERE PART_NAME IS NOT NULL
          AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL
          AND TRIM(PROBLEM_TYPE) <> ''
          AND ${offlineCondition}

        UNION ALL

        SELECT
          VIN,
          PART_NAME,
          PROBLEM_TYPE,
          CREATION_TIME,
          POST_NAME
        FROM at_paint_qm_defect_info
        WHERE PART_NAME IS NOT NULL
          AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL
          AND TRIM(PROBLEM_TYPE) <> ''
          AND ${offlineCondition}

        UNION ALL

        SELECT
          VIN,
          PART_NAME,
          PROBLEM_TYPE,
          CREATION_TIME,
          POST_NAME
        FROM at_qm_defect_info
        WHERE PART_NAME IS NOT NULL
          AND TRIM(PART_NAME) <> ''
          AND PROBLEM_TYPE IS NOT NULL
          AND TRIM(PROBLEM_TYPE) <> ''
          AND ${offlineCondition}
      ) d
      JOIN work_order wo
        ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr})
        AND d.CREATION_TIME >= ?
        AND d.CREATION_TIME <= ?
    `;

    const [defectRows] = await pool.query(
      defectsSql,
      [sqlStart, sqlEnd]
    );

    // Загружаем справочник владельцев
    const [owners] = await notesPool.query(`
      SELECT
        do.model,
        do.part_name,
        do.problem_type,
        b.name AS brigade_name
      FROM defect_owners do
      LEFT JOIN brigades b
        ON do.brigade_id = b.id
    `);

    const ownerMap = new Map();

    owners.forEach(o => {
      const key = `${o.model}|${o.part_name}|${o.problem_type}`;
      ownerMap.set(key, o.brigade_name);
    });

    // Определяем нераспределённые дефекты
    const unassignedRows = [];

    for (const r of defectRows) {
      const key = `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;
      const brigade = ownerMap.get(key) || 'Бригада не найдена';

      if (brigade === 'Бригада не найдена') {
        unassignedRows.push(r);
      }
    }

    // Группируем по MPP
    const groups = new Map();

    for (const r of unassignedRows) {
      const key = `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;

      if (!groups.has(key)) {
        groups.set(key, {
          mpp: `${r.MODEL || 'UNKNOWN'} ${r.PART_NAME || ''} ${r.PROBLEM_TYPE || ''}`,
          model: r.MODEL,
          part_name: r.PART_NAME,
          problem_type: r.PROBLEM_TYPE,
          count: 0
        });
      }

      groups.get(key).count++;
    }

    const unassigned = Array.from(groups.values())
      .sort((a, b) => b.count - a.count);

    const totalUnassigned = unassignedRows.length;

    console.log(
      `[brigade-report] unassigned defects: ${totalUnassigned}, groups: ${unassigned.length}`
    );

    res.json(unassigned);

  } catch (err) {
    console.error('Ошибка unassigned-defects:', err);
    res.status(500).json({ error: err.message });
  }
});




// Назначение владельца дефекту (бригаде)
app.post('/api/brigade-report/assign-owner', async (req, res) => {
  try {
    const { model, part_name, problem_type, brigadeName, password } = req.body;
    if (!model || !part_name || !problem_type || !brigadeName || !password) {
      return res.status(400).json({ error: 'Не все обязательные поля заполнены' });
    }

    // Проверка пароля
    if (password !== BRIGADE_PASSWORD) {
      return res.status(403).json({ error: 'Неверный пароль' });
    }

    // Находим id бригады
    const [brigadeRows] = await notesPool.query('SELECT id FROM brigades WHERE name = ?', [brigadeName]);
    if (brigadeRows.length === 0) {
      return res.status(404).json({ error: 'Бригада не найдена' });
    }
    const brigadeId = brigadeRows[0].id;

    // Вставляем или обновляем запись о владельце
    await notesPool.query(`
      INSERT INTO defect_owners (model, part_name, problem_type, brigade_id)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE brigade_id = VALUES(brigade_id)
    `, [model, part_name, problem_type, brigadeId]);

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка назначения владельца:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Получение всего справочника
app.get('/api/brigade-report/dictionary', async (req, res) => {
  try {
    const [rows] = await notesPool.query(`
      SELECT do.id, do.model, do.part_name, do.problem_type, b.name AS brigade_name
      FROM defect_owners do
      LEFT JOIN brigades b ON do.brigade_id = b.id
      ORDER BY do.model, do.part_name, do.problem_type
    `);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка получения справочника:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Добавление/обновление записи в справочнике
app.post('/api/brigade-report/dictionary', async (req, res) => {
  try {
    const { model, part_name, problem_type, brigadeName, password } = req.body;
    if (!model || !part_name || !problem_type || !brigadeName || !password) {
      return res.status(400).json({ error: 'Не все обязательные поля заполнены' });
    }
    if (password !== BRIGADE_PASSWORD) {
      return res.status(403).json({ error: 'Неверный пароль' });
    }

    const [brigadeRows] = await notesPool.query('SELECT id FROM brigades WHERE name = ?', [brigadeName]);
    if (brigadeRows.length === 0) {
      return res.status(404).json({ error: 'Бригада не найдена' });
    }
    const brigadeId = brigadeRows[0].id;

    await notesPool.query(`
      INSERT INTO defect_owners (model, part_name, problem_type, brigade_id)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE brigade_id = VALUES(brigade_id)
    `, [model, part_name, problem_type, brigadeId]);

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения записи справочника:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Удаление записи из справочника
app.delete('/api/brigade-report/dictionary/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Пароль обязателен' });
    if (password !== BRIGADE_PASSWORD) return res.status(403).json({ error: 'Неверный пароль' });

    await notesPool.query('DELETE FROM defect_owners WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления записи справочника:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Вспомогательная функция временного диапазона
function getTimeRangeForBrigade(timeFilter) {
  const nowMoscow = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const totalMinutes = nowMoscow.getUTCHours() * 60 + nowMoscow.getUTCMinutes();
  const todayStr = nowMoscow.toISOString().slice(0, 10);
  const yesterday = new Date(nowMoscow);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  if (timeFilter === 'all') {
    return { start: `${todayStr} 00:00:00`, end: `${todayStr} 23:59:59` };
  }
  if (timeFilter === 'day') {
    const dateToUse = totalMinutes >= 7 * 60 + 50 ? todayStr : yesterdayStr;
    return { start: `${dateToUse} 07:50:00`, end: `${dateToUse} 16:40:00` };
  }
  if (timeFilter === 'evening') {
    const dateToUse = totalMinutes >= 16 * 60 + 41 ? todayStr : yesterdayStr;
    const startDate = new Date(`${dateToUse}T16:41:00Z`);
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const endStr = endDate.toISOString().slice(0, 10);
    return { start: `${dateToUse} 16:41:00`, end: `${endStr} 01:30:00` };
  }
  if (timeFilter === 'night') {
    const dateToUse = totalMinutes >= 1 * 60 + 31 ? todayStr : yesterdayStr;
    return { start: `${dateToUse} 01:31:00`, end: `${dateToUse} 07:50:00` };
  }
  return { start: `${todayStr} 00:00:00`, end: `${todayStr} 23:59:59` };
}

app.get('/api/brigade-report/models', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT MODEL
      FROM work_order
      WHERE MODEL IS NOT NULL AND TRIM(MODEL) <> ''
      ORDER BY MODEL
    `);
    res.json(rows.map(r => r.MODEL));
  } catch (err) {
    console.error('Ошибка получения списка моделей:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== ИМПОРТ СПРАВОЧНИКА ==================
app.post('/api/brigade-report/import', async (req, res) => {
  try {
    const { entries, password } = req.body;
    if (!entries || !Array.isArray(entries) || entries.length === 0 || !password) {
      return res.status(400).json({ error: 'Не переданы данные или пароль' });
    }
    // Пароль для импорта — 4002 (отдельный от основного)
    if (password !== IMPORT_PASSWORD) {
      return res.status(403).json({ error: 'Неверный пароль для импорта' });
    }

    const brigadeCache = new Map();
    let imported = 0;
    for (const entry of entries) {
      const { model, part_name, problem_type, brigadeName } = entry;
      if (!model || !part_name || !problem_type || !brigadeName) continue;

      let brigadeId = brigadeCache.get(brigadeName);
      if (!brigadeId) {
        const [rows] = await notesPool.query('SELECT id FROM brigades WHERE name = ?', [brigadeName]);
        if (rows.length === 0) continue;
        brigadeId = rows[0].id;
        brigadeCache.set(brigadeName, brigadeId);
      }

      await notesPool.query(`
        INSERT INTO defect_owners (model, part_name, problem_type, brigade_id)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE brigade_id = VALUES(brigade_id)
      `, [model, part_name, problem_type, brigadeId]);

      imported++;
    }

    res.json({ success: true, imported });
  } catch (err) {
    console.error('Ошибка импорта справочника:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/brigade-report/assign-all-models', async (req, res) => {
  try {
    const { part_name, problem_type, brigadeName, password } = req.body;
    if (!part_name || !problem_type || !brigadeName || !password) {
      return res.status(400).json({ error: 'Не все обязательные поля заполнены' });
    }
    if (password !== BRIGADE_PASSWORD) {
      return res.status(403).json({ error: 'Неверный пароль' });
    }

    const [brigadeRows] = await notesPool.query('SELECT id FROM brigades WHERE name = ?', [brigadeName]);
    if (brigadeRows.length === 0) {
      return res.status(404).json({ error: 'Бригада не найдена' });
    }
    const brigadeId = brigadeRows[0].id;

    // Получаем все модели
    const [models] = await pool.query(`SELECT DISTINCT MODEL FROM work_order WHERE MODEL IS NOT NULL AND TRIM(MODEL) <> ''`);
    for (const { MODEL } of models) {
      await notesPool.query(`
        INSERT INTO defect_owners (model, part_name, problem_type, brigade_id)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE brigade_id = VALUES(brigade_id)
      `, [MODEL, part_name, problem_type, brigadeId]);
    }

    res.json({ success: true, models: models.length });
  } catch (err) {
    console.error('Ошибка назначения на все модели:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== УПРАВЛЕНИЕ БРИГАДАМИ ==================

// Добавление новой бригады
app.post('/api/brigade-report/brigades', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) {
      return res.status(400).json({ error: 'name и password обязательны' });
    }
    if (password !== BRIGADE_PASSWORD) {
      return res.status(403).json({ error: 'Неверный пароль' });
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'Название не может быть пустым' });
    }

    // Проверяем на дубликат
    const [existing] = await notesPool.query('SELECT id FROM brigades WHERE name = ?', [trimmedName]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Бригада с таким названием уже существует' });
    }

    await notesPool.query('INSERT INTO brigades (name) VALUES (?)', [trimmedName]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка добавления бригады:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Удаление бригады (дефекты автоматически перейдут к "Бригада не найдена" через триггер)
app.delete('/api/brigade-report/brigades/:id', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'password обязателен' });
    }
    if (password !== BRIGADE_PASSWORD) {
      return res.status(403).json({ error: 'Неверный пароль' });
    }

    // Запрещаем удалять специальную бригаду
    const [brigade] = await notesPool.query('SELECT name FROM brigades WHERE id = ?', [req.params.id]);
    if (brigade.length === 0) {
      return res.status(404).json({ error: 'Бригада не найдена' });
    }
    if (brigade[0].name === 'Бригада не найдена') {
      return res.status(400).json({ error: 'Нельзя удалить системную бригаду "Бригада не найдена"' });
    }

    await notesPool.query('DELETE FROM brigades WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления бригады:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ================== БРИГАДНЫЙ ОТЧЁТ – ТРЕНДЫ (МЕСЯЦЫ/НЕДЕЛИ/ДНИ) ==================
app.get('/api/brigade-report/trend', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      startTime,
      endTime,
      checkpoint,
      defectType = 'all',
      brigades,
      metric = 'count',
      shift
    } = req.query;

    // 1. Определяем диапазон — идентично /api/brigade-report/data
    let sqlStart, sqlEnd;
    if (startTime && endTime) {
      sqlStart = startTime;
      sqlEnd = endTime;
    } else if (dateFrom && dateTo) {
      sqlStart = `${dateFrom} 00:00:00`;
      sqlEnd = `${dateTo} 23:59:59`;
    } else {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setMonth(start.getMonth() - 3);
      start.setHours(0, 0, 0, 0);
      sqlStart = formatSqlDateTime(start);
      sqlEnd = formatSqlDateTime(end);
    }

    // 2. Сырые дефекты — та же выборка, что в data
    let defectRows = await fetchRawDefects(sqlStart, sqlEnd, checkpoint, defectType);

    // 3. Фильтр по смене
    if (shift && shift !== 'all') {
      defectRows = defectRows.filter(
        d => getShiftLetterFromDate(d.CREATION_TIME) === shift
      );
    }

    // 4. Справочник владельцев
    const [owners] = await notesPool.query(`
      SELECT do.model, do.part_name, do.problem_type, b.name AS brigade_name
      FROM defect_owners do
      LEFT JOIN brigades b ON do.brigade_id = b.id
    `);
    const ownerMap = new Map();
    owners.forEach(o => ownerMap.set(
      `${o.model}|${o.part_name}|${o.problem_type}`,
      o.brigade_name
    ));

    // 5. Выбранные бригады
    let selectedBrigadesSet = null;
    if (brigades && brigades !== 'ALL') {
      selectedBrigadesSet = new Set(
        brigades.split(',').map(b => b.trim()).filter(Boolean)
      );
    }

    // 6. Периоды
    function getPeriodKey(date, type) {
      const d = new Date(date);
      if (type === 'month') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      } else if (type === 'week') {
        const mon = new Date(d);
        const dayNum = mon.getDay() || 7;
        mon.setDate(mon.getDate() + 4 - dayNum);
        const yearStart = new Date(mon.getFullYear(), 0, 1);
        const weekNo = Math.ceil((((mon - yearStart) / 86400000) + 1) / 7);
        return `${mon.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
      }
      return getLocalDateStr(d);
    }

    function generatePeriods(type, count, endDate) {
      const periods = [];
      const current = new Date(endDate);
      while (periods.length < count) {
        const key = getPeriodKey(current, type);
        if (!periods.includes(key)) periods.push(key);
        if (type === 'month') current.setMonth(current.getMonth() - 1);
        else if (type === 'week') current.setDate(current.getDate() - 7);
        else current.setDate(current.getDate() - 1);
      }
      return periods;
    }

    const endDateObj = new Date(sqlEnd.replace(' ', 'T'));
    const monthPeriods = generatePeriods('month', 3, endDateObj);
    const weekPeriods = generatePeriods('week', 4, endDateObj);
    const dayPeriods = generatePeriods('day', 14, endDateObj);

    // 7. Счётчики
    const monthCounts = new Map(monthPeriods.map(p => [p, 0]));
    const weekCounts = new Map(weekPeriods.map(p => [p, 0]));
    const dayCounts = new Map(dayPeriods.map(p => [p, 0]));
    const monthCars = new Map(monthPeriods.map(p => [p, new Set()]));
    const weekCars = new Map(weekPeriods.map(p => [p, new Set()]));
    const dayCars = new Map(dayPeriods.map(p => [p, new Set()]));

    // 8. Дефекты
    for (const defect of defectRows) {
      const brigade = ownerMap.get(
        `${defect.MODEL}|${defect.PART_NAME}|${defect.PROBLEM_TYPE}`
      ) || 'Бригада не найдена';
      if (selectedBrigadesSet && !selectedBrigadesSet.has(brigade)) continue;

      const defDate = new Date(defect.CREATION_TIME);

      const mKey = getPeriodKey(defDate, 'month');
      if (monthCounts.has(mKey)) monthCounts.set(mKey, monthCounts.get(mKey) + 1);

      const wKey = getPeriodKey(defDate, 'week');
      if (weekCounts.has(wKey)) weekCounts.set(wKey, weekCounts.get(wKey) + 1);

      const dKey = getPeriodKey(defDate, 'day');
      if (dayCounts.has(dKey)) dayCounts.set(dKey, dayCounts.get(dKey) + 1);
    }

    // 9. CP72 для DPU
    const [cp72Rows] = await pool.query(`
      SELECT VIN, CREATION_TIME
      FROM at_om_wiptrackinghistory
      WHERE WC_NAME = 'CP72'
        AND CREATION_TIME >= ? AND CREATION_TIME <= ?
    `, [sqlStart, sqlEnd]);

    let cp72Filtered = cp72Rows;
    if (shift && shift !== 'all') {
      cp72Filtered = cp72Rows.filter(
        c => getShiftLetterFromDate(c.CREATION_TIME) === shift
      );
    }

    for (const car of cp72Filtered) {
      const carDate = new Date(car.CREATION_TIME);

      const mKey = getPeriodKey(carDate, 'month');
      if (monthCars.has(mKey)) monthCars.get(mKey).add(car.VIN);

      const wKey = getPeriodKey(carDate, 'week');
      if (weekCars.has(wKey)) weekCars.get(wKey).add(car.VIN);

      const dKey = getPeriodKey(carDate, 'day');
      if (dayCars.has(dKey)) dayCars.get(dKey).add(car.VIN);
    }

    // 10. Результат
    function buildResult(countsMap, carsMap) {
      const result = [];
      for (const period of countsMap.keys()) {
        const defects = countsMap.get(period);
        const totalCars = carsMap.get(period).size;
        let value;
        if (metric === 'dpu') {
          value = totalCars > 0 ? Math.min(defects / totalCars * 1000, 1000) : 0;
          value = Number(value.toFixed(2));
        } else {
          value = defects;
        }
        result.push({ period, value });
      }
      return result.sort((a, b) => a.period.localeCompare(b.period));
    }

    res.json({
      month: buildResult(monthCounts, monthCars),
      week: buildResult(weekCounts, weekCars),
      day: buildResult(dayCounts, dayCars)
    });
  } catch (err) {
    console.error('Ошибка /api/brigade-report/trend:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ================== ТОП MPP ПО БРИГАДЕ (для таблицы под графиками) ==================


// =========================================================================
// ЭНДПОИНТ: /api/brigade-report/top-mpp
// SQL максимально приближен к /api/defects-dashboard:
//   - фильтр CREATION_TIME >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) внутри каждого подзапроса
//   - GROUP BY PART_NAME, PROBLEM_TYPE, DATE(CREATION_TIME), MODEL, VIN, POST_NAME
//   - ORDER BY CREATION_TIME DESC
//   - LIMIT 5000
// =========================================================================
app.get('/api/brigade-report/top-mpp', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      startTime,
      endTime,
      checkpoint,
      defectType = 'all',
      brigade,
      shift
    } = req.query;

    if (!brigade) {
      return res.status(400).json({ error: 'brigade обязателен' });
    }

    // Тот же диапазон, что в trend
    let sqlStart, sqlEnd;
    if (startTime && endTime) {
      sqlStart = startTime;
      sqlEnd = endTime;
    } else if (dateFrom && dateTo) {
      sqlStart = `${dateFrom} 00:00:00`;
      sqlEnd = `${dateTo} 23:59:59`;
    } else {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(start.getDate() - 13);
      start.setHours(0, 0, 0, 0);
      sqlStart = formatSqlDateTime(start);
      sqlEnd = formatSqlDateTime(end);
    }

    // ТА ЖЕ выборка, что в data и trend
    let defectRows = await fetchRawDefects(sqlStart, sqlEnd, checkpoint, defectType);

    if (shift && shift !== 'all') {
      defectRows = defectRows.filter(
        d => getShiftLetterFromDate(d.CREATION_TIME) === shift
      );
    }

    // Справочник владельцев
    const [owners] = await notesPool.query(`
      SELECT do.model, do.part_name, do.problem_type, b.name AS brigade_name
      FROM defect_owners do
      LEFT JOIN brigades b ON do.brigade_id = b.id
    `);
    const ownerMap = new Map();
    owners.forEach(o => ownerMap.set(
      `${o.model}|${o.part_name}|${o.problem_type}`,
      o.brigade_name
    ));

    // Группировка по локальной дате Node — как в trend
    const groups = new Map();
    for (const r of defectRows) {
      const owner = ownerMap.get(
        `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`
      ) || 'Бригада не найдена';
      if (owner !== brigade) continue;

      const dateStr = getLocalDateStr(r.CREATION_TIME);
      const key = `${dateStr}|${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;

      if (!groups.has(key)) {
        groups.set(key, {
          date: dateStr,
          model: r.MODEL,
          part_name: r.PART_NAME,
          problem_type: r.PROBLEM_TYPE,
          mpp: `${r.MODEL || ''} ${r.PART_NAME || ''} ${r.PROBLEM_TYPE || ''}`.trim(),
          count: 0,
        });
      }
      groups.get(key).count++;
    }

    const result = Array.from(groups.values()).sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.count - a.count;
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка top-mpp:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// ЭНДПОИНТ: /api/brigade-report/top-mpp-vins
// Уникальные VIN'ы по конкретному MPP за конкретный день
// (дата — серверная, как в /api/defects-dashboard), с учётом фильтра смены.
// =========================================================================
app.get('/api/brigade-report/top-mpp-vins', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      checkpoint,
      defectType = 'all',
      shift,
      model,
      part_name,
      problem_type,
      date
    } = req.query;

    if (!model || !part_name || !problem_type || !date) {
      return res.status(400).json({
        error: 'model, part_name, problem_type, date обязательны'
      });
    }

    let sqlStart, sqlEnd;
    if (dateFrom && dateTo) {
      sqlStart = `${dateFrom} 00:00:00`;
      sqlEnd = `${dateTo} 23:59:59`;
    } else {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(start.getDate() - 13);
      start.setHours(0, 0, 0, 0);
      sqlStart = formatSqlDateTime(start);
      sqlEnd = formatSqlDateTime(end);
    }

    // ТА ЖЕ выборка
    let defectRows = await fetchRawDefects(sqlStart, sqlEnd, checkpoint, defectType);

    // Фильтр по конкретному MPP и локальной дате Node
    defectRows = defectRows.filter(r => {
      if (r.MODEL !== model) return false;
      if (r.PART_NAME !== part_name) return false;
      if (r.PROBLEM_TYPE !== problem_type) return false;
      return getLocalDateStr(r.CREATION_TIME) === date;
    });

    // Фильтр по смене
    if (shift && shift !== 'all') {
      defectRows = defectRows.filter(
        r => getShiftLetterFromDate(r.CREATION_TIME) === shift
      );
    }

    const vinSet = new Set(defectRows.map(r => r.VIN));
    res.json([...vinSet]);
  } catch (err) {
    console.error('Ошибка top-mpp-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== REMZONE WORK STATUS ==================
// ================== REMZONE WORK STATUS ==================

// Фильтр: оставляем только RE-аккаунты (REP%, rep%, repXX|)
// Проверяем и REPAIR_ACCOUNT, и левую часть REPAIR_PERSON до знака "|"
const REMZONE_FILTER = `
  AND (
    UPPER(REPAIR_ACCOUNT) LIKE 'REP%'
    OR UPPER(SUBSTRING_INDEX(REPAIR_PERSON, '|', 1)) LIKE 'REP%'
  )
`;

// ---------- 1. Ежедневный режим: по дням за период ----------
app.get('/api/remzone-work-status/daily', async (req, res) => {
  try {
    const { dateFrom, dateTo, withPartNumber } = req.query;
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });
    }

    const partNumberCondition = withPartNumber === 'true'
      ? ` AND MISS_PART IS NOT NULL AND TRIM(MISS_PART) <> ''`
      : '';

    const [rows] = await pool.query(`
      SELECT
        DATE(REPAIR_TIME) AS repair_date,
        REPAIR_PERSON,
        REPAIR_ACCOUNT,
        COUNT(*) AS cnt
      FROM at_qm_defect_info
      WHERE REPAIR_TIME IS NOT NULL
        AND REPAIR_TIME >= ? AND REPAIR_TIME <= ?
        AND REPAIR_PERSON IS NOT NULL AND TRIM(REPAIR_PERSON) <> ''
        ${REMZONE_FILTER}
        ${partNumberCondition}
      GROUP BY repair_date, REPAIR_PERSON, REPAIR_ACCOUNT
      ORDER BY repair_date
    `, [`${dateFrom} 00:00:00`, `${dateTo} 23:59:59`]);

    const personsMap = new Map();

    for (const row of rows) {
      const key = row.REPAIR_PERSON;

      if (!personsMap.has(key)) {
        const raw = String(row.REPAIR_PERSON || '');
        const parts = raw.split('|');
        const acc = (parts[0] || '').trim();
        const name = (parts[1] || '').trim();

        personsMap.set(key, {
          repair_person: raw,
          repair_account: row.REPAIR_ACCOUNT || acc || '',
          person_account: acc || row.REPAIR_ACCOUNT || '',
          person_name: name || acc || raw || '—',
          days: {},
          total: 0,
        });
      }

      const person = personsMap.get(key);
      const dateStr = String(row.repair_date).slice(0, 10);
      const cnt = Number(row.cnt || 0);

      person.days[dateStr] = (person.days[dateStr] || 0) + cnt;
      person.total += cnt;
    }

    const result = Array.from(personsMap.values())
      .sort((a, b) => b.total - a.total);

    res.json({ rows: result });
  } catch (err) {
    console.error('Ошибка /api/remzone-work-status/daily:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- 2. Часовой режим: по часам за конкретный день ----------
app.get('/api/remzone-work-status/hourly', async (req, res) => {
  try {
    const { date, withPartNumber } = req.query;
    if (!date) {
      return res.status(400).json({ error: 'date обязателен' });
    }

    const partNumberCondition = withPartNumber === 'true'
      ? ` AND MISS_PART IS NOT NULL AND TRIM(MISS_PART) <> ''`
      : '';

    const [rows] = await pool.query(`
      SELECT
        HOUR(REPAIR_TIME) AS hour,
        REPAIR_PERSON,
        REPAIR_ACCOUNT,
        COUNT(*) AS cnt
      FROM at_qm_defect_info
      WHERE REPAIR_TIME IS NOT NULL
        AND DATE(REPAIR_TIME) = ?
        AND REPAIR_PERSON IS NOT NULL AND TRIM(REPAIR_PERSON) <> ''
        ${REMZONE_FILTER}
        ${partNumberCondition}
      GROUP BY hour, REPAIR_PERSON, REPAIR_ACCOUNT
    `, [date]);

    const personsMap = new Map();

    for (const row of rows) {
      const key = row.REPAIR_PERSON;

      if (!personsMap.has(key)) {
        const raw = String(row.REPAIR_PERSON || '');
        const parts = raw.split('|');
        const acc = (parts[0] || '').trim();
        const name = (parts[1] || '').trim();

        personsMap.set(key, {
          repair_person: raw,
          repair_account: row.REPAIR_ACCOUNT || acc || '',
          person_account: acc || row.REPAIR_ACCOUNT || '',
          person_name: name || acc || raw || '—',
          hours: Array(24).fill(0),
          total: 0,
        });
      }

      const person = personsMap.get(key);
      const h = Number(row.hour);
      const cnt = Number(row.cnt || 0);

      if (h >= 0 && h <= 23) {
        person.hours[h] += cnt;
        person.total += cnt;
      }
    }

    const result = Array.from(personsMap.values())
      .sort((a, b) => b.total - a.total);

    res.json({ rows: result });
  } catch (err) {
    console.error('Ошибка /api/remzone-work-status/hourly:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- 3. Детали: список дефектов сотрудника за день (или за час) ----------
app.get('/api/remzone-work-status/details', async (req, res) => {
  try {
    const { repair_person, date, hour, withPartNumber } = req.query;
    if (!repair_person || !date) {
      return res.status(400).json({ error: 'repair_person и date обязательны' });
    }

    const partNumberCondition = withPartNumber === 'true'
      ? ` AND d.MISS_PART IS NOT NULL AND TRIM(d.MISS_PART) <> ''`
      : '';

    const params = [repair_person, date];
    let hourFilter = '';
    if (hour !== undefined && hour !== null && hour !== '') {
      hourFilter = ' AND HOUR(d.REPAIR_TIME) = ?';
      params.push(Number(hour));
    }

    const [rows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.POST_NAME,
        d.CHECK_POINT,
        d.REPAIR_TIME,
        d.MISS_PART
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.REPAIR_PERSON = ?
        AND d.REPAIR_TIME IS NOT NULL
        AND DATE(d.REPAIR_TIME) = ?
        ${hourFilter}
        ${partNumberCondition}
      ORDER BY d.REPAIR_TIME ASC
    `, params);

    res.json({
      rows: rows.map(r => ({
        vin: r.VIN,
        model: r.MODEL || '—',
        part_name: r.PART_NAME || '—',
        problem_type: r.PROBLEM_TYPE || '—',
        post_name: r.POST_NAME || '—',
        checkpoint: r.CHECK_POINT || '—',
        repair_time: r.REPAIR_TIME,
        miss_part: r.MISS_PART || '',
      })),
    });
  } catch (err) {
    console.error('Ошибка /api/remzone-work-status/details:', err.message);
    res.status(500).json({ error: err.message });
  }
});



// ================== VEHICLE ON WHEELS ==================
// ================== VEHICLE ON WHEELS ==================
// ================== VEHICLE ON WHEELS ==================
app.get('/api/vehicle-on-wheels', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const TEST_LINE_ZONES = ['TLWA', 'TLRT', 'TLADAS', 'TLTT', 'CPA'];
    const REPAIR_ZONES = ['REPASS', 'REPPS', 'REPWS', 'REPLK', 'REPSHORT', 'REPELEC', 'REPNOISE'];
    const ALL_ZONES = [...TEST_LINE_ZONES, ...REPAIR_ZONES];
    const placeholders = ALL_ZONES.map(() => '?').join(',');

    // ---------- 1. Зелёные цифры (для pie chart и карточки «Ремонт ОК») ----------
    const [greenRows] = await mesPool.query(`
      SELECT
        node_nature,
        COUNT(*) AS cnt,
        COUNT(DISTINCT vin) AS uniq
      FROM tm_vhc_test_line_movement
      WHERE node_nature IN (${placeholders})
        AND gmt_create >= ? AND gmt_create <= ?
        AND is_deleted = 0
      GROUP BY node_nature
    `, [...ALL_ZONES, startTime, endTime]);

    const greenCounts = {};
    const greenUnique = {};
    greenRows.forEach(r => {
      greenCounts[r.node_nature] = Number(r.cnt || 0);
      greenUnique[r.node_nature] = Number(r.uniq || 0);
    });

    const cpaCount = greenCounts['CPA'] || 0;
    const cpaUnique = greenUnique['CPA'] || 0;

    // ---------- 2. Таблица: CP72 → REP (ВСЕ, включая ушедших в CPA) ----------
    // Флаг went_to_cpa = 1, если VIN в этом же окне был в CPA.
    const [rows] = await mesPool.query(`
      SELECT
        cp.vin,
        z.zone,
        cp.model,
        cp.TIME_CP72,
        TIMESTAMPDIFF(SECOND, cp.TIME_CP72, NOW()) AS elapsed_cp72_sec,
        z.TIME_ZONE,
        TIMESTAMPDIFF(SECOND, z.TIME_ZONE, NOW()) AS elapsed_zone_sec,
        CASE WHEN cpa.vin IS NULL THEN 0 ELSE 1 END AS went_to_cpa
      FROM (
        SELECT
          tvv.vin,
          MIN(vm.scan_time) AS TIME_CP72,
          MAX(too.product) AS model
        FROM tm_vhc_vehicle_movement vm
        INNER JOIN tm_vhc_vehicle tvv ON vm.tm_vhc_vehicle_id = tvv.id
        LEFT JOIN tm_ofm_order too ON too.vin = tvv.vin
        WHERE vm.tm_bas_uloc_id = '1990320932460523522'
          AND vm.scan_time >= ? AND vm.scan_time <= ?
        GROUP BY tvv.vin
      ) AS cp
      INNER JOIN (
        SELECT tvtlm.node_nature AS zone, tvtlm.vin, tvtlm.gmt_create AS TIME_ZONE
        FROM tm_vhc_test_line_movement tvtlm
        WHERE tvtlm.node_nature IN ('REPASS','REPPS','REPWS','REPLK','REPSHORT','REPELEC','REPNOISE')
          AND tvtlm.is_deleted = 0
          AND tvtlm.gmt_create >= ? AND tvtlm.gmt_create <= ?
      ) AS z ON cp.vin = z.vin
      LEFT JOIN (
        SELECT DISTINCT vin FROM tm_vhc_test_line_movement
        WHERE node_nature = 'CPA'
          AND gmt_create >= ? AND gmt_create <= ?
          AND is_deleted = 0
      ) AS cpa ON cpa.vin = cp.vin
      ORDER BY z.zone, cp.vin
    `, [startTime, endTime, startTime, endTime, startTime, endTime]);

    // ---------- 3. Считаем показатели ----------
    // Тёмная карточка «CP72 → Ремзона» — ВСЕ, кто прошёл CP72 и попал в REP
    const allVinsSet = new Set(rows.map(r => r.vin));
    const uniqueVins = allVinsSet.size;

    // Красная карточка «Записей в ремзону» — те, кто ещё НЕ ушёл в CPA
    const stillInRepairVins = new Set(
      rows.filter(r => Number(r.went_to_cpa) === 0).map(r => r.vin)
    );
    const repairTotal = stillInRepairVins.size;
    const repairUnique = stillInRepairVins.size;

    // ---------- 4. Ответ ----------
    res.json({
      rows: rows.map(r => ({
        vin: r.vin,
        zone: r.zone,
        model: r.model || '—',
        time_cp72: r.TIME_CP72,
        elapsed_cp72_sec: r.elapsed_cp72_sec,
        time_zone: r.TIME_ZONE,
        elapsed_zone_sec: r.elapsed_zone_sec,
        went_to_cpa: Number(r.went_to_cpa) === 1,
      })),

      // Тёмная карточка: ВСЕ CP72 → REP
      uniqueVins,

      // Карточка «Ремонт ОК» + pie chart
      cpaCount,
      cpaUnique,

      // Красная карточка: CP72 → REP, ещё не ушли в CPA
      repairTotal,
      repairUnique,

      greenCounts,
      greenUnique,
      cpaTarget: 160,
    });
  } catch (err) {
    console.error('Ошибка /api/vehicle-on-wheels:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// VIN в CPA (для карточки «Ремонт ОК»)
app.get('/api/vehicle-on-wheels/details/cpa', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) return res.status(400).json({ error: 'startTime и endTime обязательны' });

    const [rows] = await mesPool.query(`
      SELECT
        tvtlm.vin,
        tvtlm.node_nature AS zone,
        tvtlm.vhc_model AS model,
        tvtlm.gmt_create AS event_time,
        (
          SELECT MAX(t2.gmt_create)
          FROM tm_vhc_test_line_movement t2
          WHERE t2.vin = tvtlm.vin
            AND t2.node_nature IN ('REPASS','REPPS','REPWS','REPLK','REPSHORT','REPELEC','REPNOISE')
            AND t2.is_deleted = 0
            AND t2.gmt_create <= tvtlm.gmt_create
        ) AS rep_enter_time
      FROM tm_vhc_test_line_movement tvtlm
      WHERE tvtlm.node_nature = 'CPA'
        AND tvtlm.gmt_create >= ? AND tvtlm.gmt_create <= ?
        AND tvtlm.is_deleted = 0
      ORDER BY tvtlm.gmt_create
    `, [startTime, endTime]);

    res.json({
      rows: rows.map(r => ({
        vin: r.vin,
        model: r.model || '—',
        zone: r.zone || 'CPA',
        event_time: r.event_time,
        zone_enter_time: r.rep_enter_time,   // ← новое поле: время входа в ремзону
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// VIN в REP (для карточки «Записей в ремзону»)
app.get('/api/vehicle-on-wheels/details/rep', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) return res.status(400).json({ error: 'startTime и endTime обязательны' });

    const [rows] = await mesPool.query(`
      SELECT
        tvtlm.vin,
        tvtlm.node_nature AS zone,
        tvtlm.vhc_model AS model,
        tvtlm.gmt_create AS event_time
      FROM tm_vhc_test_line_movement tvtlm
      WHERE tvtlm.node_nature IN ('REPASS','REPPS','REPWS','REPLK','REPSHORT','REPELEC','REPNOISE')
        AND tvtlm.gmt_create >= ? AND tvtlm.gmt_create <= ?
        AND tvtlm.is_deleted = 0
        AND tvtlm.vin IN (
          SELECT tvv.vin
          FROM tm_vhc_vehicle_movement vm
          INNER JOIN tm_vhc_vehicle tvv ON vm.tm_vhc_vehicle_id = tvv.id
          WHERE vm.tm_bas_uloc_id = '1990320932460523522'
            AND vm.scan_time >= ? AND vm.scan_time <= ?
        )
        AND tvtlm.vin NOT IN (
          SELECT DISTINCT vin FROM tm_vhc_test_line_movement
          WHERE node_nature = 'CPA'
            AND gmt_create >= ? AND gmt_create <= ?
            AND is_deleted = 0
        )
      ORDER BY tvtlm.gmt_create
    `, [startTime, endTime, startTime, endTime, startTime, endTime]);

    res.json({
      rows: rows.map(r => ({
        vin: r.vin,
        model: r.model || '—',
        zone: r.zone,
        event_time: r.event_time,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// VIN «CP72 → Ремзона» (все из таблицы, включая тех, кто ушёл в CPA)
app.get('/api/vehicle-on-wheels/details/cp72-remzone', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) return res.status(400).json({ error: 'startTime и endTime обязательны' });

    const [rows] = await mesPool.query(`
      SELECT
        cp.vin,
        z.zone,
        too.product AS model,
        cp.TIME_CP72 AS cp72_time,
        z.TIME_ZONE AS zone_time
      FROM (
        SELECT tvv.vin, MIN(vm.scan_time) AS TIME_CP72
        FROM tm_vhc_vehicle_movement vm
        INNER JOIN tm_vhc_vehicle tvv ON vm.tm_vhc_vehicle_id = tvv.id
        WHERE vm.tm_bas_uloc_id = '1990320932460523522'
          AND vm.scan_time >= ? AND vm.scan_time <= ?
        GROUP BY tvv.vin
      ) AS cp
      INNER JOIN (
        SELECT tvtlm.node_nature AS zone, tvtlm.vin, tvtlm.gmt_create AS TIME_ZONE
        FROM tm_vhc_test_line_movement tvtlm
        WHERE tvtlm.node_nature IN ('REPASS','REPPS','REPWS','REPLK','REPSHORT','REPELEC','REPNOISE')
          AND tvtlm.is_deleted = 0
          AND tvtlm.gmt_create >= ? AND tvtlm.gmt_create <= ?
      ) AS z ON cp.vin = z.vin
      LEFT JOIN tm_ofm_order too ON too.vin = cp.vin
      WHERE cp.vin NOT IN (
        SELECT DISTINCT vin FROM tm_vhc_test_line_movement
        WHERE node_nature = 'CPA'
          AND gmt_create >= ? AND gmt_create <= ?
          AND is_deleted = 0
      )
      ORDER BY z.TIME_ZONE
    `, [startTime, endTime, startTime, endTime, startTime, endTime]);

    res.json({
      rows: rows.map(r => ({
        vin: r.vin,
        model: r.model || '—',
        zone: r.zone,
        cp72_time: r.cp72_time,
        zone_time: r.zone_time,
      })),
    });
  } catch (err) {
    console.error('Ошибка details/cp72-remzone:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ==================================================================== */
/* ============ DRR WT PORTAL — ХЕЛПЕРЫ И ЭНДПОИНТЫ =================== */
/* ==================================================================== */

/* ---------------------------------------------------------------------- */
/* Посты, релевантные DRR WT (TLTT + WT-зоны)                             */
/* ---------------------------------------------------------------------- */
const WT_DEFECT_POSTS = [
  'TLTT', 'CP8', 'TLADAS', 'TLWA', 'TLRT', 'CPA',
  'CP8 Gate', 'CP8-gate',
  'TEST TRACK', 'TRACK', 'WT', 'REPAIR VERIFICATION'
];
const WT_DEFECT_POSTS_STR = WT_DEFECT_POSTS.map(p => `'${p}'`).join(',');

/* ---------------------------------------------------------------------- */
/* Хелпер 1: TS16 — уникальные VIN, прошедшие TLTT в окне                  */
/* Возвращает [{ vin, latest_time }] — время самого позднего прохождения   */
/* ---------------------------------------------------------------------- */
async function getTs16Vins(startTime, endTime) {
  const [rows] = await mesPool.query(`
    SELECT vin, MAX(gmt_create) AS latest_time
    FROM tm_vhc_test_line_movement
    WHERE node_nature = 'TLTT'
      AND is_deleted = 0
      AND gmt_create >= ? AND gmt_create <= ?
    GROUP BY vin
  `, [startTime, endTime]);
  return rows.map(r => ({ vin: r.vin, latest_time: r.latest_time }));
}

/* ---------------------------------------------------------------------- */
/* Хелпер 2: сколько ОТКРЫТЫХ дефектов у каждого VIN                      */
/* Возвращает Map<VIN, open_count>                                        */
/* VIN без дефектов вообще → отсутствуют в map (трактуется как 0)         */
/* ---------------------------------------------------------------------- */
async function getVinsOpenDefectCount(vins) {
  const map = new Map();
  if (!vins || vins.length === 0) return map;

  const ph = vins.map(() => '?').join(',');
  const [rows] = await pool.query(`
    SELECT
      VIN,
      SUM(CASE WHEN STATUS IS NOT NULL AND LOWER(STATUS) = 'closed' THEN 0 ELSE 1 END) AS open_count
    FROM at_qm_defect_info
    WHERE VIN IN (${ph})
      AND POST_NAME IN (${WT_DEFECT_POSTS_STR})
    GROUP BY VIN
  `, vins);

  rows.forEach(r => map.set(r.VIN, Number(r.open_count) || 0));
  return map;
}

/* ====================================================================== */
/* ЭНДПОИНТ 1: основной дашборд                                            */
/* ====================================================================== */
app.get('/api/drr-wt-portal', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    // 1. TS16 — уникальные VIN, прошедшие TLTT в окне
    const ts16Rows = await getTs16Vins(startTime, endTime);
    const ts16Vins = ts16Rows.map(r => r.vin);
    const totalVins = ts16Vins.length;

    if (totalVins === 0) {
      return res.json({ totalVins: 0, tlttVins: 0, repVins: 0, tlttPercent: 0 });
    }

    // 2. Для каждого VIN — сколько открытых дефектов
    const openMap = await getVinsOpenDefectCount(ts16Vins);

    // 3. Классификация
    let drrCount = 0;   // все дефекты closed (или дефектов нет) → «Ушли на TLTT»
    let repCount = 0;   // есть хоть один открытый дефект       → «Ушли в REP»
    ts16Vins.forEach(vin => {
      const open = openMap.get(vin) || 0;
      if (open === 0) drrCount++;
      else repCount++;
    });

    const tlttPercent = totalVins > 0 ? (drrCount / totalVins) * 100 : 0;

    res.json({
      totalVins,                          // «Прошли TS16»
      tlttVins: drrCount,                 // «Ушли на TLTT»
      repVins: repCount,                  // «Ушли в REP»
      tlttPercent: Math.round(tlttPercent * 10) / 10,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-wt-portal:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 2: список VIN для модалки                                      */
/* status: TS16 | DRR | TLTT | REP                                        */
/* ====================================================================== */
app.get('/api/drr-wt-portal-vins', async (req, res) => {
  try {
    const { startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    // Общий TS16-набор
    const ts16Rows = await getTs16Vins(startTime, endTime);
    if (ts16Rows.length === 0) return res.json([]);

    // timeByVin — самое позднее время прохождения TLTT
    const timeByVin = new Map();
    ts16Rows.forEach(r => timeByVin.set(r.vin, r.latest_time));

    const allVins = ts16Rows.map(r => r.vin);

    let vins;
    if (status === 'TS16') {
      // все, кто прошёл TLTT
      vins = allVins;
    } else if (status === 'DRR' || status === 'TLTT') {
      // все дефекты закрыты
      const openMap = await getVinsOpenDefectCount(allVins);
      vins = allVins.filter(v => (openMap.get(v) || 0) === 0);
    } else if (status === 'REP') {
      // есть хотя бы один открытый дефект
      const openMap = await getVinsOpenDefectCount(allVins);
      vins = allVins.filter(v => (openMap.get(v) || 0) > 0);
    } else {
      return res.status(400).json({ error: 'Неизвестный status' });
    }

    if (vins.length === 0) return res.json([]);

    // Модель для каждого VIN
    const ph = vins.map(() => '?').join(',');
    const [modelRows] = await pool.query(`
      SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})
    `, vins);
    const modelByVin = new Map();
    modelRows.forEach(r => modelByVin.set(r.VIN, r.MODEL || '—'));

    const result = vins.map(vin => ({
      vin,
      model: modelByVin.get(vin) || '—',
      zone: status,
      event_time: timeByVin.get(vin) || null,
    }));

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-wt-portal-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 3: все дефекты у VIN, ушедших в REP                            */
/* ====================================================================== */
app.get('/api/drr-wt-portal-defects', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    // VIN из TS16 с хотя бы одним открытым дефектом
    const ts16Rows = await getTs16Vins(startTime, endTime);
    if (ts16Rows.length === 0) return res.json([]);

    const openMap = await getVinsOpenDefectCount(ts16Rows.map(r => r.vin));
    const repVins = ts16Rows
      .map(r => r.vin)
      .filter(v => (openMap.get(v) || 0) > 0);

    if (repVins.length === 0) return res.json([]);

    const placeholders = repVins.map(() => '?').join(',');

    // Тот же список постов, что и у хелпера getVinsOpenDefectCount
    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.VIN IN (${placeholders})
        AND d.POST_NAME IN (${WT_DEFECT_POSTS_STR})
        AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
    `, [...repVins, startTime, endTime]);

    if (defectRows.length === 0) return res.json([]);

    const defectMap = new Map();
    defectRows.forEach(r => {
      const mpp = `${r.MODEL || '—'} ${r.PART_NAME || ''} ${r.PROBLEM_TYPE || ''}`
        .replace(/\s+/g, ' ')
        .trim();
      const grade = r.PROBLEM_GRADE || '—';
      const key = `${mpp}|${grade}`;
      if (!defectMap.has(key)) defectMap.set(key, { mpp, grade, defectCount: 0 });
      defectMap.get(key).defectCount += 1;
    });

    const result = [...defectMap.values()]
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-wt-portal-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});









/* ====================================================================== */
/* ===================== DRR CPFinal ==================================== */
/* ====================================================================== */

const CPFINAL_DEFECT_POSTS = [
  'TLTT', 'CP8', 'TLADAS', 'TLWA', 'TLRT', 'CPA',
  'CP8 Gate', 'CP8-gate',
  'TEST TRACK', 'TRACK', 'WT', 'REPAIR VERIFICATION'
];
const CPFINAL_DEFECT_POSTS_STR = CPFINAL_DEFECT_POSTS.map(p => `'${p}'`).join(',');

const CPFINAL_GRACE_MS = 20 * 60 * 1000;

/* Хелпер: NOK дефекта для CPFinal.
   - есть REPAIR_TIME / REPAIR_TIME1 (берём самое раннее):
     NOK, если оно > TLTT + 20 мин; иначе OK
   - нет времени: NOK, если статус != closed; иначе OK
   LAST_MODIFIED_TIME НЕ используем. */
function isDefectNokCpFinal(defectRow, tlttMs) {
  const repairTimes = [defectRow.REPAIR_TIME, defectRow.REPAIR_TIME1]
    .filter(t => t != null && t !== '')
    .map(t => new Date(t).getTime())
    .filter(t => !Number.isNaN(t));

  const threshold = tlttMs + CPFINAL_GRACE_MS;

  if (repairTimes.length > 0) {
    return Math.min(...repairTimes) > threshold;
  }

  const isClosed = defectRow.STATUS && defectRow.STATUS.toUpperCase() === 'CLOSED';
  return !isClosed;
}

/* ---------------------------------------------------------------------- */
/* Хелпер: VIN + два времени TLTT + общее число записей TLTT              */
/* ---------------------------------------------------------------------- */
async function getCpFinalTlttVins(startTime, endTime) {
  const [rows] = await mesPool.query(`
    SELECT
      vin,
      MIN(gmt_create) AS tltt_first_time,
      MAX(gmt_create) AS tltt_last_time
    FROM tm_vhc_test_line_movement
    WHERE node_nature = 'TLTT'
      AND is_deleted = 0
      AND gmt_create >= ? AND gmt_create <= ?
    GROUP BY vin
  `, [startTime, endTime]);

  const [countRows] = await mesPool.query(`
    SELECT COUNT(*) AS total_records
    FROM tm_vhc_test_line_movement
    WHERE node_nature = 'TLTT'
      AND is_deleted = 0
      AND gmt_create >= ? AND gmt_create <= ?
  `, [startTime, endTime]);

  const totalRecords = Number(countRows[0]?.total_records) || 0;

  const vins = rows.map(r => ({
    vin: r.vin,
    tltt_first_time: r.tltt_first_time,
    tltt_last_time:  r.tltt_last_time,
  }));

  return { vins, totalRecords };
}

/* ---------------------------------------------------------------------- */
/* Хелпер: классификация VIN (OK / NOK) — новая логика                    */
/* ---------------------------------------------------------------------- */
async function classifyCpFinalVins(tlttRows) {
  const okSet = new Set();
  const nokSet = new Set();
  const vins = tlttRows.map(r => r.vin);

  vins.forEach(v => okSet.add(v));
  if (vins.length === 0) return { okSet, nokSet };

  const firstTlttByVin = new Map(tlttRows.map(r => [r.vin, r.tltt_first_time]));
  const ph = vins.map(() => '?').join(',');

  const [defectRows] = await pool.query(`
    SELECT
      VIN, STATUS,
      REPAIR_TIME, REPAIR_TIME1
    FROM at_qm_defect_info
    WHERE VIN IN (${ph})
      AND POST_NAME IN (${CPFINAL_DEFECT_POSTS_STR})
  `, vins);

  defectRows.forEach(d => {
    const tlttFirst = firstTlttByVin.get(d.VIN);
    if (!tlttFirst) return;

    const tlttMs = new Date(tlttFirst).getTime();
    if (isDefectNokCpFinal(d, tlttMs)) {
      nokSet.add(d.VIN);
      okSet.delete(d.VIN);
    }
  });

  return { okSet, nokSet };
}

/* ====================================================================== */
/* ЭНДПОИНТ 1: главные цифры                                              */
/* ====================================================================== */
app.get('/api/drr-cpfinal-dashboard', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const { vins: tlttRows, totalRecords } = await getCpFinalTlttVins(startTime, endTime);
    const totalVins = tlttRows.length;

    if (totalVins === 0) {
      return res.json({ totalRecords, totalVins: 0, okVins: 0, nokVins: 0, drrPercent: 0 });
    }

    const { okSet, nokSet } = await classifyCpFinalVins(tlttRows);
    const okVins = okSet.size;
    const nokVins = nokSet.size;
    const drrPercent = totalVins > 0 ? (okVins / totalVins) * 100 : 0;

    res.json({
      totalRecords,
      totalVins,
      okVins,
      nokVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-cpfinal-dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 2: список VIN для модалки                                     */
/* ====================================================================== */
app.get('/api/drr-cpfinal-vins', async (req, res) => {
  try {
    const { startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    const { vins: tlttRows } = await getCpFinalTlttVins(startTime, endTime);
    if (tlttRows.length === 0) return res.json([]);

    const lastTlttByVin = new Map(tlttRows.map(r => [r.vin, r.tltt_last_time]));
    const { okSet, nokSet } = await classifyCpFinalVins(tlttRows);

    let vins;
    if (status === 'ALL') vins = tlttRows.map(r => r.vin);
    else if (status === 'OK') vins = [...okSet];
    else if (status === 'NOK') vins = [...nokSet];
    else return res.status(400).json({ error: 'Неизвестный status' });

    if (vins.length === 0) return res.json([]);

    const ph = vins.map(() => '?').join(',');
    const [modelRows] = await pool.query(`
      SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})
    `, vins);
    const modelByVin = new Map(modelRows.map(r => [r.VIN, r.MODEL || '—']));

    const result = vins.map(vin => ({
      vin,
      model: modelByVin.get(vin) || '—',
      tltt_time: lastTlttByVin.get(vin) || null,
    })).sort((a, b) => new Date(a.tltt_time) - new Date(b.tltt_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cpfinal-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 3: топ дефектов                                               */
/* ====================================================================== */
app.get('/api/drr-cpfinal-top-defects', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const { vins: tlttRows } = await getCpFinalTlttVins(startTime, endTime);
    if (tlttRows.length === 0) return res.json([]);

    const firstTlttByVin = new Map(tlttRows.map(r => [r.vin, r.tltt_first_time]));
    const { nokSet } = await classifyCpFinalVins(tlttRows);
    const nokVins = [...nokSet];
    if (nokVins.length === 0) return res.json([]);

    const ph = nokVins.map(() => '?').join(',');
    const [defectRows] = await pool.query(`
      SELECT
        d.VIN, wo.MODEL,
        d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE,
        d.PROBLEM_DESCRIPTION,
        d.STATUS,
        d.REPAIR_TIME, d.REPAIR_TIME1
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.VIN IN (${ph})
        AND d.POST_NAME IN (${CPFINAL_DEFECT_POSTS_STR})
    `, nokVins);

    const map = new Map();
    defectRows.forEach(d => {
      const tlttFirst = firstTlttByVin.get(d.VIN);
      if (!tlttFirst) return;
      const tlttMs = new Date(tlttFirst).getTime();
      if (!isDefectNokCpFinal(d, tlttMs)) return;

      const model = d.MODEL || '—';
      const part = (d.PART_NAME || '').trim();
      const problem = (d.PROBLEM_TYPE || '').trim();
      const desc = (d.PROBLEM_DESCRIPTION || '').trim();

      let mpp;
      if (!part && !problem) {
        mpp = desc ? `${model} ${desc}`.replace(/\s+/g, ' ').trim() : `${model} (Без описания)`;
      } else {
        mpp = `${model} ${part} ${problem}`.replace(/\s+/g, ' ').trim();
      }

      // Ключ для группировки, чтобы разные описания не склеивались
      const mppKey = `${model}|${part}|${problem}|${desc}`;

      if (!map.has(mppKey)) {
        map.set(mppKey, {
          mpp,
          model: model,
          part_name: part,
          problem_type: problem,
          problem_description: desc, // <-- Добавили в ответ
          defectCount: 0,
        });
      }
      map.get(mppKey).defectCount += 1;
    });

    const result = [...map.values()]
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cpfinal-top-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 4: VIN'ы по конкретному MPP                                   */
/* ====================================================================== */
app.get('/api/drr-cpfinal-mpp-vins', async (req, res) => {
  try {
    const { startTime, endTime, model, part_name = '', problem_type = '', problem_description = '' } = req.query;

    if (!startTime || !endTime || !model) {
      return res.status(400).json({ error: 'startTime, endTime и model обязательны' });
    }

    const { vins: tlttRows } = await getCpFinalTlttVins(startTime, endTime);
    if (tlttRows.length === 0) return res.json([]);

    const firstTlttByVin = new Map(tlttRows.map(r => [r.vin, r.tltt_first_time]));
    const lastTlttByVin = new Map(tlttRows.map(r => [r.vin, r.tltt_last_time]));
    const { nokSet } = await classifyCpFinalVins(tlttRows);
    const nokVins = [...nokSet];

    if (nokVins.length === 0) return res.json([]);

    const ph = nokVins.map(() => '?').join(',');

    let whereClause = `d.VIN IN (${ph}) AND d.POST_NAME IN (${CPFINAL_DEFECT_POSTS_STR}) AND wo.MODEL = ?`;
    const params = [...nokVins, model];

    if (part_name === '' && problem_type === '') {
      whereClause += ` AND (d.PART_NAME IS NULL OR TRIM(d.PART_NAME) = '') AND (d.PROBLEM_TYPE IS NULL OR TRIM(d.PROBLEM_TYPE) = '')`;
      if (problem_description !== '') {
        whereClause += ` AND d.PROBLEM_DESCRIPTION = ?`;
        params.push(problem_description);
      } else {
        whereClause += ` AND (d.PROBLEM_DESCRIPTION IS NULL OR TRIM(d.PROBLEM_DESCRIPTION) = '')`;
      }
    } else {
      whereClause += ` AND d.PART_NAME = ? AND d.PROBLEM_TYPE = ?`;
      params.push(part_name, problem_type);
    }

    const [defectRows] = await pool.query(`
      SELECT
        d.VIN, wo.MODEL,
        d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE,
        d.PROBLEM_DESCRIPTION,
        d.STATUS, d.CREATION_TIME,
        d.REPAIR_TIME, d.REPAIR_TIME1
      FROM at_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE ${whereClause}
    `, params);

    const vinMap = new Map();
    defectRows.forEach(d => {
      const tlttFirst = firstTlttByVin.get(d.VIN);
      if (!tlttFirst) return;
      const tlttMs = new Date(tlttFirst).getTime();
      if (!isDefectNokCpFinal(d, tlttMs)) return;

      const repairTimes = [d.REPAIR_TIME, d.REPAIR_TIME1]
        .filter(t => t != null && t !== '')
        .map(t => new Date(t).getTime())
        .filter(t => !Number.isNaN(t));
      const repairMs = repairTimes.length > 0 ? Math.min(...repairTimes) : null;

      const existing = vinMap.get(d.VIN);
      const defectTimeMs = new Date(d.CREATION_TIME).getTime();
      if (!existing || defectTimeMs > existing._defectTimeMs) {
        vinMap.set(d.VIN, {
          vin: d.VIN,
          model: d.MODEL || '—',
          grade: d.PROBLEM_GRADE || '—',
          status: d.STATUS || '',
          defect_time: d.CREATION_TIME,
          repair_time: repairMs ? new Date(repairMs).toISOString() : null,
          tltt_time: lastTlttByVin.get(d.VIN) || null,
          _defectTimeMs: defectTimeMs,
        });
      }
    });

    const result = Array.from(vinMap.values())
      .map(({ _defectTimeMs, ...v }) => v)
      .sort((a, b) => new Date(a.tltt_time) - new Date(b.tltt_time));

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cpfinal-mpp-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ============== DRR CPFINAL — СНИМКИ СМЕН ============================ */
/* ====================================================================== */

function getLastCompletedShiftCpFinal() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();

  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const todayStr = fmt(now);
  const yest = new Date(now);
  yest.setUTCDate(yest.getUTCDate() - 1);
  const yesterdayStr = fmt(yest);

  if (mins < 91) return { shiftDate: yesterdayStr, shift: 'day' };
  if (mins < 470) return { shiftDate: yesterdayStr, shift: 'evening' };
  if (mins < 1001) return { shiftDate: todayStr, shift: 'night' };
  return { shiftDate: todayStr, shift: 'day' };
}

function getShiftRangeCpFinal(shiftDate, shift) {
  if (shift === 'all')     return { start: `${shiftDate} 00:00:00`, end: `${shiftDate} 23:59:59` };
  if (shift === 'day')     return { start: `${shiftDate} 07:50:00`, end: `${shiftDate} 16:40:00` };
  if (shift === 'night')   return { start: `${shiftDate} 01:31:00`, end: `${shiftDate} 07:50:00` };
  if (shift === 'evening') {
    const next = new Date(`${shiftDate}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    return { start: `${shiftDate} 16:41:00`, end: `${nextStr} 01:30:00` };
  }
  return null;
}

async function saveDrrCpFinalSnapshot(shiftDate, shift) {
  try {
    const range = getShiftRangeCpFinal(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDate(shiftDate);
    const shiftLetter = getShiftLetterForSnapshot(shift, weekNumber);

    const { vins: tlttRows, totalRecords } = await getCpFinalTlttVins(range.start, range.end);
    const totalVins = tlttRows.length;

    let okVins = 0, nokVins = 0, drrPercent = 0, topDefects = [];

    if (totalVins > 0) {
      const { okSet, nokSet } = await classifyCpFinalVins(tlttRows);
      okVins = okSet.size;
      nokVins = nokSet.size;
      drrPercent = Math.round((okVins / totalVins) * 1000) / 10;

      const firstTlttByVin = new Map(tlttRows.map(r => [r.vin, r.tltt_first_time]));
      const nokVinsList = [...nokSet];

      if (nokVinsList.length > 0) {
        const ph = nokVinsList.map(() => '?').join(',');
        
        // 1. ДОБАВЛЕНО: d.PROBLEM_DESCRIPTION в SELECT
        const [defectRows] = await pool.query(`
          SELECT
            d.VIN, wo.MODEL,
            d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE,
            d.PROBLEM_DESCRIPTION,
            d.STATUS, d.REPAIR_TIME, d.REPAIR_TIME1
          FROM at_qm_defect_info d
          LEFT JOIN work_order wo ON wo.VIN = d.VIN
          WHERE d.VIN IN (${ph})
            AND d.POST_NAME IN (${CPFINAL_DEFECT_POSTS_STR})
        `, nokVinsList);

        const map = new Map();
        defectRows.forEach(d => {
          const tlttFirst = firstTlttByVin.get(d.VIN);
          if (!tlttFirst) return;
          const tlttMs = new Date(tlttFirst).getTime();
          if (!isDefectNokCpFinal(d, tlttMs)) return;

          const model = d.MODEL || '—';
          const part = (d.PART_NAME || '').trim();
          const problem = (d.PROBLEM_TYPE || '').trim();
          const desc = (d.PROBLEM_DESCRIPTION || '').trim(); // 2. ДОБАВЛЕНО: читаем описание

          // 3. ИЗМЕНЕНО: убрали костыль TS02 WA EC Tool
          let mpp;
          if (!part && !problem) {
            mpp = desc ? `${model} ${desc}`.replace(/\s+/g, ' ').trim() : `${model} (Без описания)`;
          } else {
            mpp = `${model} ${part} ${problem}`.replace(/\s+/g, ' ').trim();
          }

          // Ключ для Map, чтобы разные описания не склеивались в одну строку
          const mppKey = `${model}|${part}|${problem}|${desc}`;

          if (!map.has(mppKey)) {
            map.set(mppKey, { 
              mpp, 
              model, 
              part_name: part, 
              problem_type: problem, 
              problem_description: desc, // 4. ДОБАВЛЕНО: сохраняем в JSON
              defectCount: 0 
            });
          }
          map.get(mppKey).defectCount += 1;
        });

        topDefects = [...map.values()]
          .sort((a, b) => b.defectCount - a.defectCount);
          
      }
    }

    await notesPool.query(`
      INSERT INTO drr_cpfinal_snapshots
        (shift_date, week_number, shift, shift_letter,
         total_records, total_vins, ok_vins, nok_vins, drr_percent, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_records = VALUES(total_records),
        total_vins = VALUES(total_vins),
        ok_vins = VALUES(ok_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        top_defects = VALUES(top_defects)
    `, [shiftDate, weekNumber, shift, shiftLetter,
        totalRecords, totalVins, okVins, nokVins, drrPercent, JSON.stringify(topDefects)]);

    console.log(`[DRR CPFinal snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) → ${drrPercent}% (${okVins}/${totalVins})`);
  } catch (err) {
    console.error('[DRR CPFinal snapshot] ошибка сохранения:', err.message);
  }
}

async function checkAndSaveDrrCpFinalSnapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShiftCpFinal();
    const [existing] = await notesPool.query(
      'SELECT id FROM drr_cpfinal_snapshots WHERE shift_date = ? AND shift = ?',
      [shiftDate, shift]
    );
    if (existing.length === 0) {
      await saveDrrCpFinalSnapshot(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR CPFinal snapshot] ошибка проверки смены:', err.message);
  }
}

async function checkAndSaveDrrCpFinalDailySnapshot() {
  try {
    const dayDate = getCompletedDayDate();
    const [existing] = await notesPool.query(
      `SELECT id FROM drr_cpfinal_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (existing.length === 0) {
      await saveDrrCpFinalSnapshot(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR CPFinal snapshot] ошибка проверки суток:', err.message);
  }
}

setInterval(() => {
  checkAndSaveDrrCpFinalSnapshot();
  checkAndSaveDrrCpFinalDailySnapshot();
}, 60 * 1000);
checkAndSaveDrrCpFinalSnapshot();
checkAndSaveDrrCpFinalDailySnapshot();

/* Хелпер: дозаполнить week_number / shift_letter */
function enrichCpFinalSnapshot(r) {
  const shiftDate = String(r.shift_date).slice(0, 10);
  const weekNumber = r.week_number != null
    ? r.week_number
    : getWeekNumberForDate(shiftDate);
  const shiftLetter = r.shift_letter != null
    ? r.shift_letter
    : getShiftLetterForSnapshot(r.shift, weekNumber);

  return {
    id: r.id,
    shiftDate,
    weekNumber,
    shift: r.shift,
    shiftLetter,
    snapshotTime: r.snapshot_time,
    totalRecords: r.total_records,
    totalVins: r.total_vins,
    okVins: r.ok_vins,
    nokVins: r.nok_vins,
    drrPercent: Number(r.drr_percent),
  };
}

app.get('/api/drr-cpfinal-snapshots', async (req, res) => {
  try {
    const { days = 14 } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);

    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, snapshot_time,
             total_records, total_vins, ok_vins, nok_vins, drr_percent
      FROM drr_cpfinal_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY shift_date DESC,
        FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays]);

    res.json(rows.map(enrichCpFinalSnapshot));
  } catch (err) {
    console.error('Ошибка /api/drr-cpfinal-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-cpfinal-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query(
      'SELECT * FROM drr_cpfinal_snapshots WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Снимок не найден' });

    const r = rows[0];
    let topDefects = [];
    try {
      topDefects = r.top_defects
        ? (typeof r.top_defects === 'string' ? JSON.parse(r.top_defects) : r.top_defects)
        : [];
    } catch { topDefects = []; }

    res.json({
      ...enrichCpFinalSnapshot(r),
      topDefects,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-cpfinal-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});







/* ====================================================================== */
/* ===================== DRR CP6 (PSIN/PSOUT/TRANSIT) =================== */
/* ====================================================================== */

// Точки
const CP6_PSIN_ULOC    = 'AGMPS01001';   // PSIN — вход в покраску (база NOK)
const CP6_PSOUT_ULOC   = 'AGMPS01002';   // PSOUT — выход из покраски (база OK/DRR)
const CP6_BUFFER_ENTER = 'AGMPS01003';   // PBSIN — вход в буфер
const CP6_BUFFER_EXIT  = 'AGMPS01004';   // PBSOUT — выход из буфера
const CP6_TRIMIN_ULOC  = 'AGMAS01001';   // TRIMIN — вход на сборку

// Окно для «активных на покраске» (System Fill) и для «в переходе PBSOUT → TRIMIN»
const BUFFER_MAX_AGE_DAYS   = 14;
const TRANSIT_MAX_AGE_DAYS  = 30;

const CP6_DEFECT_CLOSED_STATUSES = new Set(['CLOSED']);

/* ---------------------------------------------------------------------- */
/* Хелпер: VIN + времена PSOUT за период (база для OK / DRR)               */
/* ---------------------------------------------------------------------- */
async function getCp6PsoutVins(startTime, endTime) {
  const [rows] = await mesPool.query(`
    SELECT vin, MIN(scan_time) AS psout_first_time, MAX(scan_time) AS psout_last_time
    FROM ti_mes_movement
    WHERE uloc_no = ?
      AND is_deleted = 0
      AND scan_time >= ? AND scan_time <= ?
    GROUP BY vin
  `, [CP6_PSOUT_ULOC, startTime, endTime]);

  const [countRows] = await mesPool.query(`
    SELECT COUNT(*) AS total_records
    FROM ti_mes_movement
    WHERE uloc_no = ?
      AND is_deleted = 0
      AND scan_time >= ? AND scan_time <= ?
  `, [CP6_PSOUT_ULOC, startTime, endTime]);

  return {
    vins: rows.map(r => ({
      vin: r.vin,
      psout_first_time: r.psout_first_time,
      psout_last_time:  r.psout_last_time,
    })),
    totalRecords: Number(countRows[0]?.total_records) || 0,
  };
}

/* ---------------------------------------------------------------------- */
/* Хелпер: VIN + времена PSIN за период (база для NOK)                     */
/* ---------------------------------------------------------------------- */
async function getCp6PsinVins(startTime, endTime) {
  const [rows] = await mesPool.query(`
    SELECT vin, MIN(scan_time) AS psin_first_time, MAX(scan_time) AS psin_last_time
    FROM ti_mes_movement
    WHERE uloc_no = ?
      AND is_deleted = 0
      AND scan_time >= ? AND scan_time <= ?
    GROUP BY vin
  `, [CP6_PSIN_ULOC, startTime, endTime]);
  return rows.map(r => ({
    vin: r.vin,
    psin_first_time: r.psin_first_time,
    psin_last_time:  r.psin_last_time,
  }));
}

/* ---------------------------------------------------------------------- */
/* Хелпер: активные на покраске (System Fill)                              */
/* Последний PSIN > последнего PSOUT, PSIN не старше 14 дней               */
/* ---------------------------------------------------------------------- */
async function getCp6ActiveAtPaint() {
  const [rows] = await mesPool.query(`
    SELECT psin.vin, psin.last_psin AS active_enter_time
    FROM (
      SELECT vin, MAX(scan_time) AS last_psin
      FROM ti_mes_movement
      WHERE uloc_no = ? AND is_deleted = 0
      GROUP BY vin
    ) psin
    LEFT JOIN (
      SELECT vin, MAX(scan_time) AS last_psout
      FROM ti_mes_movement
      WHERE uloc_no = ? AND is_deleted = 0
      GROUP BY vin
    ) psout ON psout.vin = psin.vin
    WHERE (psout.vin IS NULL OR psin.last_psin > psout.last_psout)
      AND psin.last_psin >= DATE_SUB(NOW(), INTERVAL ? DAY)
    ORDER BY psin.last_psin DESC
  `, [CP6_PSIN_ULOC, CP6_PSOUT_ULOC, BUFFER_MAX_AGE_DAYS]);
  return rows;
}

/* ---------------------------------------------------------------------- */
/* Хелпер: VIN в переходе «PBSOUT → TRIMIN» (зелёный блок Buffer)          */
/* Прошли AGMPS01004 за 30 дней, ещё не прошли AGMAS01001                   */
/* ---------------------------------------------------------------------- */
async function getCp6TransitVins() {
  const [rows] = await mesPool.query(`
    SELECT psout.vin, psout.last_psout AS pbsout_time
    FROM (
      SELECT vin, MAX(scan_time) AS last_psout
      FROM ti_mes_movement
      WHERE uloc_no = ? AND is_deleted = 0
        AND scan_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY vin
    ) psout
    LEFT JOIN (
      SELECT vin, MAX(scan_time) AS last_trimin
      FROM ti_mes_movement
      WHERE uloc_no = ? AND is_deleted = 0
      GROUP BY vin
    ) trimin ON trimin.vin = psout.vin
    WHERE (trimin.vin IS NULL OR psout.last_psout > trimin.last_trimin)
    ORDER BY psout.last_psout DESC
  `, [CP6_BUFFER_EXIT, TRANSIT_MAX_AGE_DAYS, CP6_TRIMIN_ULOC]);
  return rows;
}

/* ---------------------------------------------------------------------- */
/* Хелпер: классификация дефекта (Spot / Перекрас / other)                 */
/* Только REPAIR_MEASURE и REPAIR_MEASURE1. Buffer-safe + Unicode-safe.   */
/* ---------------------------------------------------------------------- */
function classifyCp6DefectCategory(d) {
  const toStr = (v) => {
    if (v === null || v === undefined) return '';
    if (Buffer.isBuffer(v)) return v.toString('utf8').trim();
    return String(v).trim();
  };

  const measure  = toStr(d.REPAIR_MEASURE);
  const measure1 = toStr(d.REPAIR_MEASURE1);
  const combined = `${measure} ${measure1}`.toLowerCase();

  if (!combined.trim()) return 'other';
  if (combined.includes('spot')) return 'spot';
  if (combined.includes('перекрас') || combined.includes('repaint') || combined.includes('re-paint')) return 'repaint';
  return 'other';
}

/* ---------------------------------------------------------------------- */
/* Хелпер: расширенная классификация VIN                                  */
/*                                                                        */
/* OK  — PSOUT VIN'ы без открытых дефектов                                */
/* NOK — PSIN VIN'ы с хотя бы одним открытым дефектом                     */
/*                                                                        */
/* Блоки Spot / Перекрас / Остальные — ЭКСКЛЮЗИВНО, приоритет:              */
/*   repaint > spot > other                                              */
/*   Сумма spot + repaint + other = NOK                                   */
/*                                                                        */
/* Таблицы — ИНКЛЮЗИВНО:                                                  */
/*   spotDefectVins / repaintDefectVins — по наличию хоть одного дефекта   */
/*   нужной категории (VIN может быть в обеих)                            */
/* ---------------------------------------------------------------------- */
async function classifyCp6VinsExtended(psoutRows, psinRows) {
  const okSet = new Set();
  const nokSet = new Set();

  const spotSet = new Set();
  const repaintSet = new Set();
  const otherSet = new Set();

  const spotDefectVins = new Set();
  const repaintDefectVins = new Set();

  const psoutVins = psoutRows.map(r => r.vin);
  const psinVins  = psinRows.map(r => r.vin);

  psoutVins.forEach(v => okSet.add(v));

  const allVins = [...new Set([...psoutVins, ...psinVins])];
  if (allVins.length === 0) {
    return { okSet, nokSet, spotSet, repaintSet, otherSet, spotDefectVins, repaintDefectVins };
  }

  const ph = allVins.map(() => '?').join(',');
  const [defectRows] = await pool.query(`
    SELECT VIN, STATUS, REPAIR_MEASURE, REPAIR_MEASURE1
    FROM at_paint_qm_defect_info
    WHERE VIN IN (${ph})
  `, allVins);

  defectRows.forEach(d => {
    const status = (d.STATUS || '').toUpperCase();
    if (CP6_DEFECT_CLOSED_STATUSES.has(status)) return;

    nokSet.add(d.VIN);
    okSet.delete(d.VIN);

    const cat = classifyCp6DefectCategory(d);
    if (cat === 'spot') spotDefectVins.add(d.VIN);
    else if (cat === 'repaint') repaintDefectVins.add(d.VIN);
  });

  // Блоки — эксклюзивно, приоритет repaint > spot > other
  nokSet.forEach(v => {
    const hasSpot    = spotDefectVins.has(v);
    const hasRepaint = repaintDefectVins.has(v);

    if (hasRepaint) repaintSet.add(v);
    else if (hasSpot) spotSet.add(v);
    else otherSet.add(v);
  });

  console.log(
    `[DRR CP6 classify] psout=${psoutVins.length} psin=${psinVins.length} defects=${defectRows.length} ` +
    `ok=${okSet.size} nok=${nokSet.size} ` +
    `blocks: spot=${spotSet.size} repaint=${repaintSet.size} other=${otherSet.size} | ` +
    `tables: spotVins=${spotDefectVins.size} repaintVins=${repaintDefectVins.size}`
  );

  return { okSet, nokSet, spotSet, repaintSet, otherSet, spotDefectVins, repaintDefectVins };
}

/* ---------------------------------------------------------------------- */
/* Хелпер: обогащение VIN метаданными                                     */
/* ---------------------------------------------------------------------- */
async function enrichCp6Vins(vins, psoutTimeByVin, psinTimeByVin) {
  if (vins.length === 0) return [];
  const ph = vins.map(() => '?').join(',');

  const [mesRows] = await mesPool.query(`
    SELECT
      too.vin,
      too.material_no      AS material_code,
      tvv.sequence_number  AS sequence_number,
      too.product          AS model,
      tbmr.material_desc   AS material_desc
    FROM tm_ofm_order too
      LEFT JOIN tm_vhc_vehicle tvv ON tvv.vin = too.vin
      LEFT JOIN tm_bas_material_relation tbmr
        ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
    WHERE too.is_deleted = 0 AND too.vin IN (${ph})
  `, vins);

  const mesByVin = new Map();
  mesRows.forEach(r => mesByVin.set(r.vin, r));

  const [iotRows] = await pool.query(`
    SELECT vin, batch_num FROM work_order WHERE vin IN (${ph})
  `, vins);
  const batchByVin = new Map();
  iotRows.forEach(r => batchByVin.set(r.vin, r.batch_num));

  return vins.map(vin => {
    const m = mesByVin.get(vin) || {};
    return {
      vin,
      batch_num:       batchByVin.get(vin) || '—',
      sequence_number: m.sequence_number || '—',
      model:           m.model || '—',
      material_code:   m.material_code || '—',
      material_desc:   m.material_desc || '—',
      psout_time:      psoutTimeByVin?.get(vin) || null,
      psin_time:       psinTimeByVin?.get(vin) || null,
    };
  }).sort((a, b) => {
    const ta = a.psout_time || a.psin_time;
    const tb = b.psout_time || b.psin_time;
    return new Date(ta || 0) - new Date(tb || 0);
  });
}

/* ====================================================================== */
/* ЭНДПОИНТ 1: главные цифры                                              */
/* ====================================================================== */
app.get('/api/drr-cp6-dashboard', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const [{ vins: psoutRows, totalRecords }, psinRows, activeRows, transitRows] = await Promise.all([
      getCp6PsoutVins(startTime, endTime),
      getCp6PsinVins(startTime, endTime),
      getCp6ActiveAtPaint(),
      getCp6TransitVins(),
    ]);

    const totalVins = psoutRows.length;
    const activeAtPaint = activeRows.length;
    const transitCount = transitRows.length;
    const psinVins = psinRows.length;

    if (totalVins === 0 && psinVins === 0) {
      return res.json({
        totalRecords,
        totalVins: 0,
        okVins: 0,
        nokVins: 0,
        drrPercent: 0,
        spotVins: 0,
        repaintVins: 0,
        otherVins: 0,
        activeAtPaint,
        transitCount,
        psinVins: 0,
      });
    }

    const { okSet, nokSet, spotSet, repaintSet, otherSet } =
      await classifyCp6VinsExtended(psoutRows, psinRows);

    const okVins = okSet.size;
    const nokVins = nokSet.size;
    const drrPercent = totalVins > 0 ? (okVins / totalVins) * 100 : 0;

    res.json({
      totalRecords,
      totalVins,
      okVins,
      nokVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
      spotVins:    spotSet.size,
      repaintVins: repaintSet.size,
      otherVins:   otherSet.size,
      activeAtPaint,
      transitCount,
      psinVins,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 2: список VIN для модалки (ALL | OK | NOK)                    */
/* ====================================================================== */
app.get('/api/drr-cp6-vins', async (req, res) => {
  try {
    const { startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    const [{ vins: psoutRows }, psinRows] = await Promise.all([
      getCp6PsoutVins(startTime, endTime),
      getCp6PsinVins(startTime, endTime),
    ]);

    const psoutTimeByVin = new Map(psoutRows.map(r => [r.vin, r.psout_last_time]));
    const psinTimeByVin  = new Map(psinRows.map(r => [r.vin, r.psin_last_time]));

    const { okSet, nokSet } = await classifyCp6VinsExtended(psoutRows, psinRows);

    let vins;
    if (status === 'ALL') vins = [...new Set([...psoutRows.map(r => r.vin), ...psinRows.map(r => r.vin)])];
    else if (status === 'OK') vins = [...okSet];
    else if (status === 'NOK') vins = [...nokSet];
    else return res.status(400).json({ error: 'Неизвестный status' });

    if (vins.length === 0) return res.json([]);

    const result = await enrichCp6Vins(vins, psoutTimeByVin, psinTimeByVin);
    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 3: топ дефектов у NOK VIN                                     */
/* ====================================================================== */
app.get('/api/drr-cp6-top-defects', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const [{ vins: psoutRows }, psinRows] = await Promise.all([
      getCp6PsoutVins(startTime, endTime),
      getCp6PsinVins(startTime, endTime),
    ]);

    const { nokSet } = await classifyCp6VinsExtended(psoutRows, psinRows);
    const nokVins = [...nokSet];
    if (nokVins.length === 0) return res.json([]);

    const ph = nokVins.map(() => '?').join(',');
    const [defectRows] = await pool.query(`
      SELECT d.VIN, wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE, d.STATUS
      FROM at_paint_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.VIN IN (${ph})
    `, nokVins);

    const map = new Map();
    defectRows.forEach(d => {
      const status = (d.STATUS || '').toUpperCase();
      if (CP6_DEFECT_CLOSED_STATUSES.has(status)) return;

      const mpp = `${d.MODEL || '—'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`
        .replace(/\s+/g, ' ').trim();
      const grade = d.PROBLEM_GRADE || '—';
      const key = `${mpp}|${grade}`;
      if (!map.has(key)) map.set(key, { mpp, grade, defectCount: 0 });
      map.get(key).defectCount += 1;
    });

    const result = [...map.values()]
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-top-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 4: дефекты для таблиц Spot / Перекрас                         */
/* Время захода — последний PSIN (AGMPS01001) или PBSIN (AGMPS01003)       */
/* без ограничения по периоду                                              */
/* ====================================================================== */
app.get('/api/drr-cp6-spot-repaint-vins', async (req, res) => {
  try {
    const { startTime, endTime, category } = req.query;
    if (!startTime || !endTime || !category) {
      return res.status(400).json({ error: 'startTime, endTime и category обязательны' });
    }
    if (category !== 'spot' && category !== 'repaint') {
      return res.status(400).json({ error: 'category: spot | repaint' });
    }

    const [{ vins: psoutRows }, psinRows] = await Promise.all([
      getCp6PsoutVins(startTime, endTime),
      getCp6PsinVins(startTime, endTime),
    ]);

    if (psinRows.length === 0) return res.json([]);

    const { spotDefectVins, repaintDefectVins } = await classifyCp6VinsExtended(psoutRows, psinRows);
    const targetSet = category === 'spot' ? spotDefectVins : repaintDefectVins;
    const targetVins = [...targetSet];
    if (targetVins.length === 0) return res.json([]);

    const ph = targetVins.map(() => '?').join(',');

    const [psinHistoryRows] = await mesPool.query(`
      SELECT vin, uloc_no, MAX(scan_time) AS last_time
      FROM ti_mes_movement
      WHERE vin IN (${ph})
        AND uloc_no IN (?, ?)
        AND is_deleted = 0
      GROUP BY vin, uloc_no
    `, [...targetVins, CP6_PSIN_ULOC, CP6_BUFFER_ENTER]);

    const psinTimeByVin = new Map();
    const pbsinTimeByVin = new Map();
    psinHistoryRows.forEach(r => {
      if (r.uloc_no === CP6_PSIN_ULOC) psinTimeByVin.set(r.vin, r.last_time);
      else if (r.uloc_no === CP6_BUFFER_ENTER) pbsinTimeByVin.set(r.vin, r.last_time);
    });
    targetVins.forEach(v => {
      if (!psinTimeByVin.has(v) && pbsinTimeByVin.has(v)) {
        psinTimeByVin.set(v, pbsinTimeByVin.get(v));
      }
    });

    const [defectRows] = await pool.query(`
      SELECT
        d.VIN, wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE, d.STATUS,
        d.REPAIR_MEASURE, d.REPAIR_MEASURE1
      FROM at_paint_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.VIN IN (${ph})
    `, targetVins);

    const nowMs = Date.now();

    const rows = [];
    defectRows.forEach(d => {
      const status = (d.STATUS || '').toUpperCase();
      if (CP6_DEFECT_CLOSED_STATUSES.has(status)) return;

      const cat = classifyCp6DefectCategory(d);
      if (cat !== category) return;

      const psinTime = psinTimeByVin.get(d.VIN) || null;
      const durationSec = psinTime
        ? Math.max(0, Math.floor((nowMs - new Date(psinTime).getTime()) / 1000))
        : null;

      const mpp = `${d.MODEL || '—'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`
        .replace(/\s+/g, ' ').trim();

      rows.push({
        vin: d.VIN,
        model: d.MODEL || '—',
        mpp,
        part_name: d.PART_NAME || '',
        problem_type: d.PROBLEM_TYPE || '',
        grade: d.PROBLEM_GRADE || '—',
        status: d.STATUS || '—',
        psin_time: psinTime,
        duration_sec: durationSec,
      });
    });

    rows.sort((a, b) => (b.duration_sec || 0) - (a.duration_sec || 0));

    res.json(rows);
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-spot-repaint-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 5: список VIN в переходе «PBSOUT → TRIMIN»                     */
/* (для зелёного блока Buffer)                                             */
/* ====================================================================== */
app.get('/api/drr-cp6-transit-vins', async (req, res) => {
  try {
    const rows = await getCp6TransitVins();
    if (rows.length === 0) return res.json([]);

    const vins = rows.map(r => r.vin);
    const ph = vins.map(() => '?').join(',');

    const [mesRows] = await mesPool.query(`
      SELECT
        too.vin,
        too.material_no      AS material_code,
        tvv.sequence_number  AS sequence_number,
        too.product          AS model,
        tbmr.material_desc   AS material_desc
      FROM tm_ofm_order too
        LEFT JOIN tm_vhc_vehicle tvv ON tvv.vin = too.vin
        LEFT JOIN tm_bas_material_relation tbmr
          ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
      WHERE too.is_deleted = 0 AND too.vin IN (${ph})
    `, vins);

    const mesByVin = new Map();
    mesRows.forEach(r => mesByVin.set(r.vin, r));

    const [iotRows] = await pool.query(`
      SELECT vin, batch_num FROM work_order WHERE vin IN (${ph})
    `, vins);
    const batchByVin = new Map();
    iotRows.forEach(r => batchByVin.set(r.vin, r.batch_num));

    const result = rows.map(r => {
      const m = mesByVin.get(r.vin) || {};
      return {
        vin: r.vin,
        pbsout_time: r.pbsout_time,
        batch_num:       batchByVin.get(r.vin) || '—',
        sequence_number: m.sequence_number || '—',
        model:           m.model || '—',
        material_code:   m.material_code || '—',
        material_desc:   m.material_desc || '—',
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-transit-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* DEBUG: по конкретному VIN                                              */
/* ====================================================================== */
app.get('/api/drr-cp6-debug-vin/:vin', async (req, res) => {
  try {
    const { vin } = req.params;
    if (!vin) return res.status(400).json({ error: 'vin обязателен' });

    const info = { vin };

    const [movements] = await mesPool.query(`
      SELECT uloc_no, scan_time
      FROM ti_mes_movement
      WHERE vin = ?
        AND uloc_no IN (?, ?, ?, ?, ?)
        AND is_deleted = 0
      ORDER BY scan_time
    `, [vin, CP6_PSIN_ULOC, CP6_PSOUT_ULOC, CP6_BUFFER_ENTER, CP6_BUFFER_EXIT, CP6_TRIMIN_ULOC]);
    info.movements = movements;

    info.hasPSIN    = movements.some(m => m.uloc_no === CP6_PSIN_ULOC);
    info.hasPSOUT   = movements.some(m => m.uloc_no === CP6_PSOUT_ULOC);
    info.hasBufferEnter = movements.some(m => m.uloc_no === CP6_BUFFER_ENTER);
    info.hasBufferExit  = movements.some(m => m.uloc_no === CP6_BUFFER_EXIT);
    info.hasTrimin      = movements.some(m => m.uloc_no === CP6_TRIMIN_ULOC);

    const [defects] = await pool.query(`
      SELECT
        ID, STATUS, CREATION_TIME,
        REPAIR_MEASURE, REPAIR_MEASURE1,
        HEX(REPAIR_MEASURE)  AS hex_measure,
        HEX(REPAIR_MEASURE1) AS hex_measure1
      FROM at_paint_qm_defect_info
      WHERE VIN = ?
      ORDER BY CREATION_TIME DESC
    `, [vin]);

    info.defects = defects.map(d => {
      const toStr = (v) => {
        if (v === null || v === undefined) return '';
        if (Buffer.isBuffer(v)) return v.toString('utf8');
        return String(v);
      };
      const classKey = { ...d };
      return {
        ID: d.ID,
        STATUS: d.STATUS,
        CREATION_TIME: d.CREATION_TIME,
        REPAIR_MEASURE: {
          value: toStr(d.REPAIR_MEASURE),
          typeof: typeof d.REPAIR_MEASURE,
          isBuffer: Buffer.isBuffer(d.REPAIR_MEASURE),
          hex: d.hex_measure,
        },
        REPAIR_MEASURE1: {
          value: toStr(d.REPAIR_MEASURE1),
          typeof: typeof d.REPAIR_MEASURE1,
          isBuffer: Buffer.isBuffer(d.REPAIR_MEASURE1),
          hex: d.hex_measure1,
        },
        classified: classifyCp6DefectCategory(classKey),
      };
    });

    const openDefects = defects.filter(d => {
      const s = (d.STATUS || '').toUpperCase();
      return !CP6_DEFECT_CLOSED_STATUSES.has(s);
    });

    info.openDefectsCount = openDefects.length;

    const categories = new Set(openDefects.map(d => classifyCp6DefectCategory(d)));
    info.categories = [...categories];
    info.block =
      categories.has('repaint') ? 'Перекрас' :
      categories.has('spot') ? 'Spot' :
      openDefects.length > 0 ? 'Остальные' : null;

    info.willBeInNOK = info.hasPSIN && openDefects.length > 0;
    info.willBeInOK  = info.hasPSOUT && openDefects.length === 0;

    res.json(info);
  } catch (err) {
    console.error('Ошибка debug-vin:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* DEBUG: статистика классификации за период                              */
/* ====================================================================== */
app.get('/api/drr-cp6-classify-debug', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime, endTime обязательны' });
    }

    const [{ vins: psoutRows }, psinRows] = await Promise.all([
      getCp6PsoutVins(startTime, endTime),
      getCp6PsinVins(startTime, endTime),
    ]);

    const allVins = [...new Set([...psoutRows.map(r => r.vin), ...psinRows.map(r => r.vin)])];
    if (allVins.length === 0) {
      return res.json({
        psoutVins: 0, psinVins: 0, totalVins: 0, totalDefects: 0,
        distribution: {}, byCategory: {}, rawValuesTop: [],
      });
    }

    const ph = allVins.map(() => '?').join(',');
    const [defectRows] = await pool.query(`
      SELECT VIN, STATUS, REPAIR_MEASURE, REPAIR_MEASURE1
      FROM at_paint_qm_defect_info
      WHERE VIN IN (${ph})
    `, allVins);

    const distribution = { spot: 0, repaint: 0, other: 0, closed: 0 };
    const byCategory = { spot: [], repaint: [], other: [] };

    defectRows.forEach(d => {
      const status = (d.STATUS || '').toUpperCase();
      if (CP6_DEFECT_CLOSED_STATUSES.has(status)) {
        distribution.closed += 1;
        return;
      }
      const cat = classifyCp6DefectCategory(d);
      distribution[cat] = (distribution[cat] || 0) + 1;
      if (byCategory[cat] && byCategory[cat].length < 30) {
        byCategory[cat].push({
          VIN: d.VIN,
          STATUS: d.STATUS,
          REPAIR_MEASURE_RAW:  d.REPAIR_MEASURE,
          REPAIR_MEASURE1_RAW: d.REPAIR_MEASURE1,
          isBufferME: Buffer.isBuffer(d.REPAIR_MEASURE),
          isBufferME1: Buffer.isBuffer(d.REPAIR_MEASURE1),
          classified_as: cat,
        });
      }
    });

    const rawValues = {};
    defectRows.forEach(d => {
      const key = `${d.REPAIR_MEASURE ?? '∅'} || ${d.REPAIR_MEASURE1 ?? '∅'}`;
      rawValues[key] = (rawValues[key] || 0) + 1;
    });

    res.json({
      psoutVins: psoutRows.length,
      psinVins: psinRows.length,
      totalVins: allVins.length,
      totalDefects: defectRows.length,
      distribution,
      byCategory,
      rawValuesTop: Object.entries(rawValues)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([key, cnt]) => ({ key, cnt })),
    });
  } catch (err) {
    console.error('Ошибка classify-debug:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ================== DRR CP6 — СНИМКИ СМЕН ============================= */
/* ====================================================================== */

function getWeekNumberForDateCp6(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}

function getShiftLetterForSnapshotCp6(shift, weekNumber) {
  if (shift === 'night') return 'C';
  if (shift === 'all') return 'ALL';
  const isEven = weekNumber % 2 === 0;
  if (shift === 'day') return isEven ? 'B' : 'A';
  if (shift === 'evening') return isEven ? 'A' : 'B';
  return null;
}

function getLastCompletedShiftCp6() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const todayStr = fmt(now);
  const yest = new Date(now);
  yest.setUTCDate(yest.getUTCDate() - 1);
  const yesterdayStr = fmt(yest);

  if (mins < 91) return { shiftDate: yesterdayStr, shift: 'day' };
  if (mins < 470) return { shiftDate: yesterdayStr, shift: 'evening' };
  if (mins < 1001) return { shiftDate: todayStr, shift: 'night' };
  return { shiftDate: todayStr, shift: 'day' };
}

function getCompletedDayDateCp6() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  if (mins >= 1439) return fmt(now);
  const yest = new Date(now);
  yest.setUTCDate(yest.getUTCDate() - 1);
  return fmt(yest);
}

function getShiftRangeCp6(shiftDate, shift) {
  if (shift === 'all')     return { start: `${shiftDate} 00:00:00`, end: `${shiftDate} 23:59:59` };
  if (shift === 'day')     return { start: `${shiftDate} 07:50:00`, end: `${shiftDate} 16:40:00` };
  if (shift === 'night')   return { start: `${shiftDate} 01:31:00`, end: `${shiftDate} 07:50:00` };
  if (shift === 'evening') {
    const next = new Date(`${shiftDate}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    return { start: `${shiftDate} 16:41:00`, end: `${nextStr} 01:30:00` };
  }
  return null;
}

/* Копия логики эндпоинтов в виде функций — нужна для сохранения снимка */
async function computeCp6Dashboard(startTime, endTime) {
  const [{ vins: psoutRows, totalRecords }, psinRows, activeRows, transitRows] = await Promise.all([
    getCp6PsoutVins(startTime, endTime),
    getCp6PsinVins(startTime, endTime),
    getCp6ActiveAtPaint(),
    getCp6TransitVins(),
  ]);

  const totalVins = psoutRows.length;
  const activeAtPaint = activeRows.length;
  const transitCount = transitRows.length;
  const psinVins = psinRows.length;

  if (totalVins === 0 && psinVins === 0) {
    return {
      totalRecords, totalVins: 0, okVins: 0, nokVins: 0,
      drrPercent: 0, spotVins: 0, repaintVins: 0, otherVins: 0,
      activeAtPaint, transitCount, psinVins: 0,
    };
  }

  const { okSet, nokSet, spotSet, repaintSet, otherSet } =
    await classifyCp6VinsExtended(psoutRows, psinRows);

  const okVins = okSet.size;
  const nokVins = nokSet.size;
  const drrPercent = totalVins > 0 ? (okVins / totalVins) * 100 : 0;

  return {
    totalRecords, totalVins, okVins, nokVins,
    drrPercent: Math.round(drrPercent * 10) / 10,
    spotVins: spotSet.size,
    repaintVins: repaintSet.size,
    otherVins: otherSet.size,
    activeAtPaint, transitCount, psinVins,
  };
}

async function computeCp6SpotRepaintRows(startTime, endTime, category) {
  const [{ vins: psoutRows }, psinRows] = await Promise.all([
    getCp6PsoutVins(startTime, endTime),
    getCp6PsinVins(startTime, endTime),
  ]);
  if (psinRows.length === 0) return [];

  const { spotDefectVins, repaintDefectVins } = await classifyCp6VinsExtended(psoutRows, psinRows);
  const targetSet = category === 'spot' ? spotDefectVins : repaintDefectVins;
  const targetVins = [...targetSet];
  if (targetVins.length === 0) return [];

  const ph = targetVins.map(() => '?').join(',');

  const [psinHistoryRows] = await mesPool.query(`
    SELECT vin, uloc_no, MAX(scan_time) AS last_time
    FROM ti_mes_movement
    WHERE vin IN (${ph})
      AND uloc_no IN (?, ?)
      AND is_deleted = 0
    GROUP BY vin, uloc_no
  `, [...targetVins, CP6_PSIN_ULOC, CP6_BUFFER_ENTER]);

  const psinTimeByVin = new Map();
  const pbsinTimeByVin = new Map();
  psinHistoryRows.forEach(r => {
    if (r.uloc_no === CP6_PSIN_ULOC) psinTimeByVin.set(r.vin, r.last_time);
    else if (r.uloc_no === CP6_BUFFER_ENTER) pbsinTimeByVin.set(r.vin, r.last_time);
  });
  targetVins.forEach(v => {
    if (!psinTimeByVin.has(v) && pbsinTimeByVin.has(v)) {
      psinTimeByVin.set(v, pbsinTimeByVin.get(v));
    }
  });

  const [defectRows] = await pool.query(`
    SELECT d.VIN, wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE, d.STATUS,
           d.REPAIR_MEASURE, d.REPAIR_MEASURE1
    FROM at_paint_qm_defect_info d
    LEFT JOIN work_order wo ON wo.VIN = d.VIN
    WHERE d.VIN IN (${ph})
  `, targetVins);

  const nowMs = Date.now();
  const rows = [];
  defectRows.forEach(d => {
    const status = (d.STATUS || '').toUpperCase();
    if (CP6_DEFECT_CLOSED_STATUSES.has(status)) return;
    const cat = classifyCp6DefectCategory(d);
    if (cat !== category) return;

    const psinTime = psinTimeByVin.get(d.VIN) || null;
    const durationSec = psinTime
      ? Math.max(0, Math.floor((nowMs - new Date(psinTime).getTime()) / 1000))
      : null;
    const mpp = `${d.MODEL || '—'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`
      .replace(/\s+/g, ' ').trim();

    rows.push({
      vin: d.VIN,
      model: d.MODEL || '—',
      mpp,
      part_name: d.PART_NAME || '',
      problem_type: d.PROBLEM_TYPE || '',
      grade: d.PROBLEM_GRADE || '—',
      status: d.STATUS || '—',
      psin_time: psinTime,
      duration_sec: durationSec,
    });
  });

  rows.sort((a, b) => (b.duration_sec || 0) - (a.duration_sec || 0));
  return rows;
}

async function saveDrrCp6Snapshot(shiftDate, shift) {
  try {
    const range = getShiftRangeCp6(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDateCp6(shiftDate);
    const shiftLetter = getShiftLetterForSnapshotCp6(shift, weekNumber);

    const [dash, spotRows, repaintRows] = await Promise.all([
      computeCp6Dashboard(range.start, range.end),
      computeCp6SpotRepaintRows(range.start, range.end, 'spot'),
      computeCp6SpotRepaintRows(range.start, range.end, 'repaint'),
    ]);

    // === РАСЧЕТ TOP DEFECTS ДЛЯ СОХРАНЕНИЯ ===
    let topDefects = [];
    if (dash.nokVins > 0) {
      const [{ vins: psoutRows }, psinRows] = await Promise.all([
        getCp6PsoutVins(range.start, range.end),
        getCp6PsinVins(range.start, range.end),
      ]);
      const { nokSet } = await classifyCp6VinsExtended(psoutRows, psinRows);
      const nokVins = [...nokSet];

      if (nokVins.length > 0) {
        const ph = nokVins.map(() => '?').join(',');
        const [defectRows] = await pool.query(`
          SELECT d.VIN, wo.MODEL, d.PART_NAME, d.PROBLEM_TYPE, d.PROBLEM_GRADE, d.STATUS
          FROM at_paint_qm_defect_info d
          LEFT JOIN work_order wo ON wo.VIN = d.VIN
          WHERE d.VIN IN (${ph})
        `, nokVins);

        const map = new Map();
        defectRows.forEach(d => {
          const status = (d.STATUS || '').toUpperCase();
          if (CP6_DEFECT_CLOSED_STATUSES.has(status)) return;

          const mpp = `${d.MODEL || '—'} ${d.PART_NAME || ''} ${d.PROBLEM_TYPE || ''}`
            .replace(/\s+/g, ' ').trim();
          const grade = d.PROBLEM_GRADE || '—';
          const key = `${mpp}|${grade}`;
          if (!map.has(key)) map.set(key, { mpp, grade, defectCount: 0 });
          map.get(key).defectCount += 1;
        });
        topDefects = [...map.values()].sort((a, b) => b.defectCount - a.defectCount);
      }
    }
    // =========================================

    await notesPool.query(`
      INSERT INTO drr_cp6_snapshots
        (shift_date, week_number, shift, shift_letter,
         total_records, total_vins, ok_vins, nok_vins, drr_percent,
         spot_vins, repaint_vins, other_vins,
         active_at_paint, transit_count, psin_vins,
         spot_rows, repaint_rows, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_records = VALUES(total_records),
        total_vins = VALUES(total_vins),
        ok_vins = VALUES(ok_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        spot_vins = VALUES(spot_vins),
        repaint_vins = VALUES(repaint_vins),
        other_vins = VALUES(other_vins),
        active_at_paint = VALUES(active_at_paint),
        transit_count = VALUES(transit_count),
        psin_vins = VALUES(psin_vins),
        spot_rows = VALUES(spot_rows),
        repaint_rows = VALUES(repaint_rows),
        top_defects = VALUES(top_defects)
    `, [
      shiftDate, weekNumber, shift, shiftLetter,
      dash.totalRecords, dash.totalVins, dash.okVins, dash.nokVins, dash.drrPercent,
      dash.spotVins, dash.repaintVins, dash.otherVins,
      dash.activeAtPaint, dash.transitCount, dash.psinVins,
      JSON.stringify(spotRows), JSON.stringify(repaintRows), JSON.stringify(topDefects),
    ]);

    console.log(`[DRR CP6 snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) → ${dash.drrPercent}% (${dash.okVins}/${dash.totalVins})`);
  } catch (err) {
    console.error('[DRR CP6 snapshot] ошибка сохранения:', err.message);
  }
}

async function checkAndSaveDrrCp6Snapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShiftCp6();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_cp6_snapshots WHERE shift_date = ? AND shift = ?`,
      [shiftDate, shift]
    );
    if (Number(existing[0]?.cnt || 0) < 1) {
      await saveDrrCp6Snapshot(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR CP6 snapshot] ошибка проверки смены:', err.message);
  }
}

async function checkAndSaveDrrCp6DailySnapshot() {
  try {
    const dayDate = getCompletedDayDateCp6();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_cp6_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (Number(existing[0]?.cnt || 0) < 1) {
      await saveDrrCp6Snapshot(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR CP6 snapshot] ошибка проверки суток:', err.message);
  }
}

setInterval(() => {
  checkAndSaveDrrCp6Snapshot();
  checkAndSaveDrrCp6DailySnapshot();
}, 60 * 1000);
checkAndSaveDrrCp6Snapshot();
checkAndSaveDrrCp6DailySnapshot();

function enrichCp6Snapshot(r) {
  const shiftDate = String(r.shift_date).slice(0, 10);
  const weekNumber = r.week_number != null ? r.week_number : getWeekNumberForDateCp6(shiftDate);
  const shiftLetter = r.shift_letter != null ? r.shift_letter : getShiftLetterForSnapshotCp6(r.shift, weekNumber);
  return {
    id: r.id,
    shiftDate, weekNumber,
    shift: r.shift,
    shiftLetter,
    snapshotTime: r.snapshot_time,
    totalRecords: r.total_records,
    totalVins: r.total_vins,
    okVins: r.ok_vins,
    nokVins: r.nok_vins,
    drrPercent: Number(r.drr_percent),
    spotVins: r.spot_vins,
    repaintVins: r.repaint_vins,
    otherVins: r.other_vins,
    activeAtPaint: r.active_at_paint,
    transitCount: r.transit_count,
    psinVins: r.psin_vins,
  };
}

app.get('/api/drr-cp6-snapshots', async (req, res) => {
  try {
    const { days = 14 } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);
    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, snapshot_time,
             total_records, total_vins, ok_vins, nok_vins, drr_percent,
             spot_vins, repaint_vins, other_vins,
             active_at_paint, transit_count, psin_vins
      FROM drr_cp6_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY shift_date DESC,
        FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays]);
    res.json(rows.map(enrichCp6Snapshot));
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-cp6-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query('SELECT * FROM drr_cp6_snapshots WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Снимок не найден' });

    const r = rows[0];
    let spotRows = [], repaintRows = [], topDefects = [];
    
    try {
      spotRows = r.spot_rows ? (typeof r.spot_rows === 'string' ? JSON.parse(r.spot_rows) : r.spot_rows) : [];
    } catch { spotRows = []; }
    
    try {
      repaintRows = r.repaint_rows ? (typeof r.repaint_rows === 'string' ? JSON.parse(r.repaint_rows) : r.repaint_rows) : [];
    } catch { repaintRows = []; }

    try {
      topDefects = r.top_defects ? (typeof r.top_defects === 'string' ? JSON.parse(r.top_defects) : r.top_defects) : [];
    } catch { topDefects = []; }

    res.json({
      ...enrichCp6Snapshot(r),
      spotRows,
      repaintRows,
      topDefects, // Отдаем сохраненные данные
    });
  } catch (err) {
    console.error('Ошибка /api/drr-cp6-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ================= SPOT-ПЕРЕКРАС — САМОДОСТАТОЧНЫЙ БЛОК =============== */
/* ====================================================================== */

const SR_PSOUT_ULOC = 'AGMPS01002';

function srChunk(arr, size = 1000) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ISO-неделя — своя, без внешних зависимостей */
function srGetIsoWeek(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}

/* PSOUT-VIN за диапазон */
async function srGetPsoutVins(startTime, endTime) {
  const [rows] = await mesPool.query(`
    SELECT vin, MIN(scan_time) AS psout_first_time, MAX(scan_time) AS psout_last_time
    FROM ti_mes_movement
    WHERE uloc_no = ?
      AND is_deleted = 0
      AND scan_time >= ? AND scan_time <= ?
    GROUP BY vin
  `, [SR_PSOUT_ULOC, startTime, endTime]);
  return rows.map(r => ({
    vin: r.vin,
    psout_first_time: r.psout_first_time,
    psout_last_time:  r.psout_last_time,
  }));
}

/* Классификация VIN */
async function srClassifyVins(psoutRows) {
  const allVins = psoutRows.map(r => r.vin);
  const spotSet = new Set();
  const repaintSet = new Set();
  const modelsByVin = new Map();

  if (allVins.length === 0) return { spotSet, repaintSet, modelsByVin };

  const spotDefectVins = new Set();
  const repaintDefectVins = new Set();
  const chunks = srChunk(allVins, 1000);

  for (const chunk of chunks) {
    const ph = chunk.map(() => '?').join(',');
    const [defectRows] = await pool.query(`
      SELECT VIN, REPAIR_MEASURE, REPAIR_MEASURE1
      FROM at_paint_qm_defect_info
      WHERE VIN IN (${ph})
    `, chunk);

    defectRows.forEach(d => {
      const m1 = Buffer.isBuffer(d.REPAIR_MEASURE)  ? d.REPAIR_MEASURE.toString('utf8')  : d.REPAIR_MEASURE;
      const m2 = Buffer.isBuffer(d.REPAIR_MEASURE1) ? d.REPAIR_MEASURE1.toString('utf8') : d.REPAIR_MEASURE1;
      const s = `${m1 || ''} ${m2 || ''}`.toLowerCase().trim();
      if (!s) return;
      if (s.includes('перекрас') || s.includes('repaint') || s.includes('re-paint')) repaintDefectVins.add(d.VIN);
      else if (s.includes('spot')) spotDefectVins.add(d.VIN);
    });
  }

  allVins.forEach(v => {
    if (repaintDefectVins.has(v))   repaintSet.add(v);
    else if (spotDefectVins.has(v)) spotSet.add(v);
  });

  for (const chunk of chunks) {
    const ph = chunk.map(() => '?').join(',');
    const [modelRows] = await pool.query(`
      SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})
    `, chunk);
    modelRows.forEach(r => modelsByVin.set(r.VIN, r.MODEL));
  }

  return { spotSet, repaintSet, modelsByVin };
}

/* Генерация периодов — использует srGetIsoWeek */
function srBuildPeriods({ period, count, fromDate, toDate }) {
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();

  if (fromDate && toDate) {
    const out = [];
    const start = new Date(fromDate + 'T00:00:00');
    const end   = new Date(toDate   + 'T00:00:00');
    if (isNaN(start) || isNaN(end) || start > end) return [];
    const cur = new Date(start);
    while (cur <= end) {
      const ds = fmt(cur);
      out.push({ type: 'day', label: ds, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  if (period === 'all') {
    const months = [], weeks = [], days = [];

    const curM = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < 3; i++) {
      const s = new Date(curM.getFullYear(), curM.getMonth() - i, 1);
      const e = new Date(curM.getFullYear(), curM.getMonth() - i + 1, 0);
      months.push({
        type: 'month',
        label: `${s.toLocaleString('en-US', { month: 'short' })} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`,
        endDate:   `${fmt(e)} 23:59:59`,
      });
    }
    months.reverse();

    const curW = new Date(now);
    curW.setDate(curW.getDate() - ((curW.getDay() + 6) % 7));
    for (let i = 0; i < 4; i++) {
      const s = new Date(curW); s.setDate(s.getDate() - i * 7);
      const e = new Date(s);    e.setDate(e.getDate() + 6);
      weeks.push({
        type: 'week',
        label: `W${srGetIsoWeek(s)} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`,
        endDate:   `${fmt(e)} 23:59:59`,
      });
    }
    weeks.reverse();

    for (let i = 0; i < 14; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const ds = fmt(d);
      days.push({ type: 'day', label: ds, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
    }
    days.reverse();

    return [...months, ...weeks, ...days];
  }

  const n = Math.max(1, Math.min(parseInt(count, 10) || 3, 50));
  const out = [];
  const cur = new Date(now);

  if (period === 'year') {
    for (let i = 0; i < n; i++) {
      const y = cur.getFullYear() - i;
      out.push({ type: 'year', label: String(y), startDate: `${y}-01-01 00:00:00`, endDate: `${y}-12-31 23:59:59` });
    }
  } else if (period === 'month') {
    for (let i = 0; i < n; i++) {
      const s = new Date(cur.getFullYear(), cur.getMonth() - i, 1);
      const e = new Date(cur.getFullYear(), cur.getMonth() - i + 1, 0);
      out.push({
        type: 'month',
        label: `${s.toLocaleString('en-US', { month: 'short' })} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`,
        endDate:   `${fmt(e)} 23:59:59`,
      });
    }
  } else if (period === 'week') {
    const startW = new Date(cur);
    startW.setDate(startW.getDate() - ((startW.getDay() + 6) % 7));
    for (let i = 0; i < n; i++) {
      const s = new Date(startW); s.setDate(s.getDate() - i * 7);
      const e = new Date(s);      e.setDate(e.getDate() + 6);
      out.push({
        type: 'week',
        label: `W${srGetIsoWeek(s)} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`,
        endDate:   `${fmt(e)} 23:59:59`,
      });
    }
  } else {
    for (let i = 0; i < n; i++) {
      const d = new Date(cur); d.setDate(d.getDate() - i);
      const ds = fmt(d);
      out.push({ type: 'day', label: ds, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
    }
  }

  return out.reverse();
}

/* ====================================================================== */
/* ЭНДПОИНТ 1                                                             */
/* ====================================================================== */
app.get('/api/repps-spot-repaint', async (req, res) => {
  try {
    const { period = 'all', count = 3, fromDate, toDate } = req.query;

    const periods = srBuildPeriods({ period, count, fromDate, toDate });
    console.log('[spot-repaint] periods=', periods.length, 'period=', period);

    if (periods.length === 0) return res.json({ dataPoints: [] });

    const minStart = periods.reduce((a, p) => a < p.startDate ? a : p.startDate, periods[0].startDate);
    const maxEnd   = periods.reduce((a, p) => a > p.endDate   ? a : p.endDate,   periods[0].endDate);
    console.log('[spot-repaint] range:', minStart, '..', maxEnd);

    const psoutRows = await srGetPsoutVins(minStart, maxEnd);
    console.log('[spot-repaint] psout vins:', psoutRows.length);

    const ALL_MODELS = ['ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];

    if (psoutRows.length === 0) {
      const empty = periods.map(p => {
        const pt = { type: p.type, label: p.label, startDate: p.startDate, endDate: p.endDate, spot: 0, repaint: 0, total: 0 };
        for (const m of ALL_MODELS) { pt[m] = 0; pt[`${m}_spot`] = 0; pt[`${m}_repaint`] = 0; }
        return pt;
      });
      return res.json({ dataPoints: empty });
    }

    const { spotSet, repaintSet, modelsByVin } = await srClassifyVins(psoutRows);
    console.log('[spot-repaint] spot=', spotSet.size, 'repaint=', repaintSet.size);

    const psoutTimeByVin = new Map(psoutRows.map(r => [r.vin, r.psout_last_time]));

    const dataPoints = periods.map(p => {
      const pStart = new Date(p.startDate);
      const pEnd   = new Date(p.endDate);

      const inRange = (v) => {
        const t = psoutTimeByVin.get(v);
        if (!t) return false;
        const d = new Date(t);
        return d >= pStart && d <= pEnd;
      };

      const spotInPeriod    = [...spotSet].filter(inRange);
      const repaintInPeriod = [...repaintSet].filter(inRange);

      const pt = {
        type: p.type, label: p.label,
        startDate: p.startDate, endDate: p.endDate,
        spot: spotInPeriod.length,
        repaint: repaintInPeriod.length,
      };
      pt.total = pt.spot + pt.repaint;

      for (const m of ALL_MODELS) {
        const s = spotInPeriod.filter(v => (modelsByVin.get(v) || 'UNKNOWN') === m).length;
        const r = repaintInPeriod.filter(v => (modelsByVin.get(v) || 'UNKNOWN') === m).length;
        pt[m]              = s + r;
        pt[`${m}_spot`]    = s;
        pt[`${m}_repaint`] = r;
      }

      return pt;
    });

    res.json({ dataPoints });
  } catch (err) {
    console.error('[spot-repaint] FATAL:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 2                                                             */
/* ====================================================================== */
app.get('/api/repps-spot-repaint-vins', async (req, res) => {
  try {
    const { dateFrom, dateTo, category, model } = req.query;
    if (!dateFrom || !dateTo || !category) {
      return res.status(400).json({ error: 'dateFrom, dateTo, category обязательны' });
    }

    const psoutRows = await srGetPsoutVins(dateFrom, dateTo);
    const { spotSet, repaintSet, modelsByVin } = await srClassifyVins(psoutRows);

    let vins;
    if (category === 'spot')         vins = [...spotSet];
    else if (category === 'repaint') vins = [...repaintSet];
    else if (category === 'total')   vins = [...new Set([...spotSet, ...repaintSet])];
    else return res.status(400).json({ error: 'category: spot | repaint | total' });

    if (model && model !== 'ALL') {
      vins = vins.filter(v => (modelsByVin.get(v) || 'UNKNOWN') === model);
    }

    if (vins.length === 0) return res.json([]);

    const defectsByVin = new Map();
    for (const chunk of srChunk(vins, 1000)) {
      const ph = chunk.map(() => '?').join(',');
      const [defects] = await pool.query(`
        SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, STATUS,
               REPAIR_MEASURE, REPAIR_MEASURE1
        FROM at_paint_qm_defect_info
        WHERE VIN IN (${ph})
      `, chunk);

      defects.forEach(d => {
        const m1 = Buffer.isBuffer(d.REPAIR_MEASURE)  ? d.REPAIR_MEASURE.toString('utf8')  : d.REPAIR_MEASURE;
        const m2 = Buffer.isBuffer(d.REPAIR_MEASURE1) ? d.REPAIR_MEASURE1.toString('utf8') : d.REPAIR_MEASURE1;
        const s = `${m1 || ''} ${m2 || ''}`.toLowerCase();

        let cat = 'other';
        if (s.includes('перекрас') || s.includes('repaint') || s.includes('re-paint')) cat = 'repaint';
        else if (s.includes('spot')) cat = 'spot';
        if (cat === 'other') return;

        if (!defectsByVin.has(d.VIN)) defectsByVin.set(d.VIN, []);
        defectsByVin.get(d.VIN).push({
          part_name: d.PART_NAME,
          problem_type: d.PROBLEM_TYPE,
          grade: d.PROBLEM_GRADE,
          status: d.STATUS,
          category: cat,
        });
      });
    }

    const result = vins.map(v => ({
      vin: v,
      model: modelsByVin.get(v) || '—',
      category: repaintSet.has(v) ? 'repaint' : 'spot',
      defects: defectsByVin.get(v) || [],
    }));

    result.sort((a, b) => {
      if (a.category !== b.category) return a.category === 'repaint' ? -1 : 1;
      return a.vin.localeCompare(b.vin);
    });

    res.json(result);
  } catch (err) {
    console.error('[spot-repaint-vins] FATAL:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});





/* ====================================================================== */
/* ===================== DRR CP5 ======================================== */
/* ====================================================================== */

// Фильтр → список точек CP5 в MES
const CP5_FILTER_POINTS = {
  all:    ['AGMBS02002', 'AGMBS01002'],
  BSP100: ['AGMBS02002'],
  BS:     ['AGMBS01002'],
};

function getCp5PointsForFilter(filter) {
  return CP5_FILTER_POINTS[filter] || CP5_FILTER_POINTS.all;
}

/* ---------------------------------------------------------------------- */
/* Хелпер: VIN + времена CP5 + общее число записей CP5                    */
/* ---------------------------------------------------------------------- */
async function getCp5Vins(startTime, endTime, filter = 'all') {
  const points = getCp5PointsForFilter(filter);
  const placeholders = points.map(() => '?').join(',');

  const [rows] = await mesPool.query(`
    SELECT vin, MIN(scan_time) AS cp5_first_time, MAX(scan_time) AS cp5_last_time
    FROM ti_mes_movement
    WHERE uloc_no IN (${placeholders})
      AND is_deleted = 0
      AND scan_time >= ? AND scan_time <= ?
    GROUP BY vin
  `, [...points, startTime, endTime]);

  const [countRows] = await mesPool.query(`
    SELECT COUNT(*) AS total_records
    FROM ti_mes_movement
    WHERE uloc_no IN (${placeholders})
      AND is_deleted = 0
      AND scan_time >= ? AND scan_time <= ?
  `, [...points, startTime, endTime]);

  return {
    vins: rows.map(r => ({
      vin: r.vin,
      cp5_first_time: r.cp5_first_time,
      cp5_last_time:  r.cp5_last_time,
    })),
    totalRecords: Number(countRows[0]?.total_records) || 0,
  };
}

/* ---------------------------------------------------------------------- */
/* Хелпер: классификация VIN (OK / NOK) по дефектам at_biw_qm_defect_info  */
/*   - нет дефектов           → OK                                        */
/*   - все дефекты CLOSED     → OK                                        */
/*   - хотя бы один не CLOSED → NOK                                       */
/* ---------------------------------------------------------------------- */
async function classifyCp5Vins(cp5Rows) {
  const okSet = new Set();
  const nokSet = new Set();
  const vins = cp5Rows.map(r => r.vin);
  vins.forEach(v => okSet.add(v));
  if (vins.length === 0) return { okSet, nokSet };

  const ph = vins.map(() => '?').join(',');
  const [defectRows] = await pool.query(`
    SELECT VIN, STATUS
    FROM at_biw_qm_defect_info
    WHERE VIN IN (${ph})
  `, vins);

  defectRows.forEach(d => {
    const status = (d.STATUS || '').toUpperCase();
    const isClosed = status === 'CLOSED';
    if (!isClosed) {
      nokSet.add(d.VIN);
      okSet.delete(d.VIN);
    }
  });

  return { okSet, nokSet };
}

/* ---------------------------------------------------------------------- */
/* Хелпер: обогащение VIN метаданными                                     */
/* ---------------------------------------------------------------------- */
async function enrichCp5Vins(vins, lastCp5ByVin) {
  if (vins.length === 0) return [];
  const ph = vins.map(() => '?').join(',');

  const [mesRows] = await mesPool.query(`
    SELECT
      too.vin,
      too.material_no      AS material_code,
      tvv.sequence_number  AS sequence_number,
      too.product          AS model,
      tbmr.material_desc   AS material_desc
    FROM tm_ofm_order too
      LEFT JOIN tm_vhc_vehicle tvv ON tvv.vin = too.vin
      LEFT JOIN tm_bas_material_relation tbmr
        ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
    WHERE too.is_deleted = 0 AND too.vin IN (${ph})
  `, vins);

  const mesByVin = new Map();
  mesRows.forEach(r => mesByVin.set(r.vin, r));

  const [iotRows] = await pool.query(`
    SELECT vin, batch_num FROM work_order WHERE vin IN (${ph})
  `, vins);

  const batchByVin = new Map();
  iotRows.forEach(r => batchByVin.set(r.vin, r.batch_num));

  return vins.map(vin => {
    const m = mesByVin.get(vin) || {};
    return {
      vin,
      batch_num:       batchByVin.get(vin) || '—',
      sequence_number: m.sequence_number || '—',
      model:           m.model || '—',
      material_code:   m.material_code || '—',
      material_desc:   m.material_desc || '—',
      cp5_time:        lastCp5ByVin.get(vin) || null,
    };
  }).sort((a, b) => new Date(a.cp5_time) - new Date(b.cp5_time));
}

/* ====================================================================== */
/* ЭНДПОИНТ 1: главные цифры                                              */
/* ====================================================================== */
app.get('/api/drr-cp5-dashboard', async (req, res) => {
  try {
    const { startTime, endTime, filter = 'all' } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const { vins: cp5Rows, totalRecords } = await getCp5Vins(startTime, endTime, filter);
    const totalVins = cp5Rows.length;

    if (totalVins === 0) {
      return res.json({ totalRecords, totalVins: 0, okVins: 0, nokVins: 0, drrPercent: 0 });
    }

    const { okSet, nokSet } = await classifyCp5Vins(cp5Rows);
    const okVins = okSet.size;
    const nokVins = nokSet.size;
    const drrPercent = totalVins > 0 ? (okVins / totalVins) * 100 : 0;

    res.json({
      totalRecords,
      totalVins,
      okVins,
      nokVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-cp5-dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 2: список VIN для модалки (status: ALL | OK | NOK)            */
/* ====================================================================== */
app.get('/api/drr-cp5-vins', async (req, res) => {
  try {
    const { startTime, endTime, status, filter = 'all' } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'startTime, endTime и status обязательны' });
    }

    const { vins: cp5Rows } = await getCp5Vins(startTime, endTime, filter);
    if (cp5Rows.length === 0) return res.json([]);

    const lastCp5ByVin = new Map(cp5Rows.map(r => [r.vin, r.cp5_last_time]));
    const { okSet, nokSet } = await classifyCp5Vins(cp5Rows);

    let vins;
    if (status === 'ALL') vins = cp5Rows.map(r => r.vin);
    else if (status === 'OK') vins = [...okSet];
    else if (status === 'NOK') vins = [...nokSet];
    else return res.status(400).json({ error: 'Неизвестный status' });

    if (vins.length === 0) return res.json([]);

    const result = await enrichCp5Vins(vins, lastCp5ByVin);
    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cp5-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ЭНДПОИНТ 3: топ дефектов у NOK VIN                                     */
/* ====================================================================== */
app.get('/api/drr-cp5-top-defects', async (req, res) => {
  try {
    const { startTime, endTime, filter = 'all' } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime и endTime обязательны' });
    }

    const { vins: cp5Rows } = await getCp5Vins(startTime, endTime, filter);
    if (cp5Rows.length === 0) return res.json([]);

    const { nokSet } = await classifyCp5Vins(cp5Rows);
    const nokVins = [...nokSet];
    if (nokVins.length === 0) return res.json([]);

    const ph = nokVins.map(() => '?').join(',');
    const [defectRows] = await pool.query(`
      SELECT
        d.VIN,
        wo.MODEL,
        d.PART_NAME,
        d.PROBLEM_TYPE,
        d.PROBLEM_GRADE,
        d.STATUS
      FROM at_biw_qm_defect_info d
      LEFT JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.VIN IN (${ph})
    `, nokVins);

    const map = new Map();
    defectRows.forEach(d => {
      const status = (d.STATUS || '').toUpperCase();
      if (status === 'CLOSED') return;

      const model = d.MODEL || '—';
      const part = (d.PART_NAME || '').trim();
      const problem = (d.PROBLEM_TYPE || '').trim();

      const mpp = (!part && !problem)
        ? `${model} TS02 WA EC Tool - NG`
        : `${model} ${part} ${problem}`.replace(/\s+/g, ' ').trim();

      const grade = d.PROBLEM_GRADE || '—';
      const key = `${mpp}|${grade}`;
      if (!map.has(key)) map.set(key, { mpp, grade, defectCount: 0 });
      map.get(key).defectCount += 1;
    });

    const result = [...map.values()]
      .sort((a, b) => b.defectCount - a.defectCount);
      

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-cp5-top-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});






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




// =====================================================
// ==================== VRT ОТЧЁТ =======================
// =====================================================

// Список VRT
app.get('/api/vrt-report/vrts', async (req, res) => {
  try {
    const [rows] = await notesPool.query('SELECT id, name FROM vrts ORDER BY name');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Добавить VRT
app.post('/api/vrt-report/vrts', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) return res.status(400).json({ error: 'name и password обязательны' });
    if (password !== BRIGADE_PASSWORD) return res.status(403).json({ error: 'Неверный пароль' });
    const trimmedName = name.trim();
    if (!trimmedName) return res.status(400).json({ error: 'Название не может быть пустым' });
    const [existing] = await notesPool.query('SELECT id FROM vrts WHERE name = ?', [trimmedName]);
    if (existing.length > 0) return res.status(409).json({ error: 'VRT с таким названием уже существует' });
    await notesPool.query('INSERT INTO vrts (name) VALUES (?)', [trimmedName]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Удалить VRT
app.delete('/api/vrt-report/vrts/:id', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== BRIGADE_PASSWORD) return res.status(403).json({ error: 'Неверный пароль' });
    const [vrt] = await notesPool.query('SELECT name FROM vrts WHERE id = ?', [req.params.id]);
    if (vrt.length === 0) return res.status(404).json({ error: 'VRT не найдена' });
    if (vrt[0].name === 'VRT не найдена') return res.status(400).json({ error: 'Нельзя удалить системную VRT' });
    await notesPool.query('DELETE FROM vrts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Список зон
app.get('/api/vrt-report/zones', async (req, res) => {
  try {
    const [rows] = await notesPool.query(`
      SELECT DISTINCT zone FROM vrt_owners
      WHERE zone IS NOT NULL AND TRIM(zone) <> ''
      ORDER BY zone
    `);
    res.json(rows.map(r => r.zone));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Список моделей
app.get('/api/vrt-report/models', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT MODEL FROM work_order
      WHERE MODEL IS NOT NULL AND TRIM(MODEL) <> ''
      ORDER BY MODEL
    `);
    res.json(rows.map(r => r.MODEL));
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Главный отчёт (гистограмма + топ + счётчики)
app.get('/api/vrt-report/data', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, metric = 'count', defectType = 'all', shift = 'all', zones } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });

    const cp7Posts = ['CP7','CP7 Audit','CP7 Gate','CP7-gate','REPAIR','REPAIR_Final','EXT1','PIP2','PIP4','PIP9'];
    const cp8Posts = ['CP8','CP8 Gate','CP8-gate','360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT','CP8 Touch Up'];
    const pipPosts = ['EXT1','PIP1','PIP2','PIP4','PIP5','PIP6','PIP8','PIP9'];
    const tlPosts  = ['360','ADAS','ADAS+RB','TEST TRACK','TRACK','WA','WT','CP8 Touch Up'];

    let postList = [];
    if (!checkpoint || checkpoint === 'ALL') postList = [...new Set([...cp7Posts, ...cp8Posts, ...pipPosts, ...tlPosts])];
    else if (checkpoint === 'CP7') postList = cp7Posts;
    else if (checkpoint === 'CP8') postList = cp8Posts;
    else if (checkpoint === 'PIP') postList = pipPosts;
    else if (checkpoint === 'TL')  postList = tlPosts;
    else return res.status(400).json({ error: 'Неверный checkpoint' });

    const postListStr = postList.map(p => `'${p.replace(/'/g, "''")}'`).join(',');

    let offlineCondition = '1=1';
    if (defectType === 'offline') offlineCondition = '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 1';
    else if (defectType === 'online') offlineCondition = '(OFFLINE OR OFFLINE1 OR OFFLINE2) = 0';

    const getISOWeek = (dateObj) => {
      const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };
    const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const getShiftType = (dateObj) => {
      const total = dateObj.getHours() * 60 + dateObj.getMinutes();
      if (total <= 90) return 'evening';
      if (total >= 91 && total < 470) return 'night';
      if (total <= 1000) return 'day';
      return 'evening';
    };
    const getShiftLetter = (shiftStartDate, shiftType) => {
      if (shiftType === 'night') return 'C';
      const week = getISOWeek(shiftStartDate);
      const isEven = week % 2 === 0;
      if (shiftType === 'day') return isEven ? 'B' : 'A';
      if (shiftType === 'evening') return isEven ? 'A' : 'B';
      return null;
    };
    const matchesShiftAndPeriod = (dateObj) => {
      const shiftType = getShiftType(dateObj);
      if (!shiftType) return false;
      const shiftStart = new Date(dateObj);
      if (shiftType === 'evening' && (dateObj.getHours() * 60 + dateObj.getMinutes()) <= 90) {
        shiftStart.setDate(shiftStart.getDate() - 1);
      }
      const shiftStartStr = toDateStr(shiftStart);
      if (shiftStartStr < dateFrom || shiftStartStr > dateTo) return false;
      if (shift !== 'all') {
        const letter = getShiftLetter(shiftStart, shiftType);
        if (letter !== shift) return false;
      }
      return true;
    };

    const nextDayObj = new Date(`${dateTo}T12:00:00`);
    nextDayObj.setDate(nextDayObj.getDate() + 1);
    const nextDayStr = toDateStr(nextDayObj);

    const [cp72Rows] = await pool.query(`
      SELECT VIN, MIN(CREATION_TIME) AS CP72_TIME
      FROM at_om_wiptrackinghistory
      WHERE WC_NAME = 'CP72'
        AND CREATION_TIME >= ? AND CREATION_TIME <= ?
      GROUP BY VIN
    `, [`${dateFrom} 00:00:00`, `${nextDayStr} 23:59:59`]);

    let totalCars = 0, totalCarsShift = 0;
    for (const row of cp72Rows) {
      if (!row.CP72_TIME) continue;
      const d = new Date(row.CP72_TIME);
      const dStr = toDateStr(d);
      if (dStr >= dateFrom && dStr <= dateTo) totalCars += 1;
      if (matchesShiftAndPeriod(d)) totalCarsShift += 1;
    }

    const defectsSql = `
      SELECT d.PART_NAME, d.PROBLEM_TYPE, d.CREATION_TIME, wo.MODEL
      FROM (
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_biw_qm_defect_info
        WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> '' AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> '' AND ${offlineCondition}
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_paint_qm_defect_info
        WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> '' AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> '' AND ${offlineCondition}
        UNION ALL
        SELECT VIN, PART_NAME, PROBLEM_TYPE, CREATION_TIME, POST_NAME, (OFFLINE OR OFFLINE1 OR OFFLINE2) AS S_OFFLINE
        FROM at_qm_defect_info
        WHERE PART_NAME IS NOT NULL AND TRIM(PART_NAME) <> '' AND PROBLEM_TYPE IS NOT NULL AND TRIM(PROBLEM_TYPE) <> '' AND ${offlineCondition}
      ) d
      JOIN work_order wo ON wo.VIN = d.VIN
      WHERE d.POST_NAME IN (${postListStr}) AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
    `;
    const [defectRows] = await pool.query(defectsSql, [`${dateFrom} 00:00:00`, `${nextDayStr} 23:59:59`]);

    const [owners] = await notesPool.query(`
      SELECT do.model, do.bom_name, do.defect_name, do.zone, v.name AS vrt_name
      FROM vrt_owners do LEFT JOIN vrts v ON do.vrt_id = v.id
    `);
    const ownerMap = new Map();
    const zoneMap = new Map();
    owners.forEach(o => {
      const key = `${o.model}|${o.bom_name}|${o.defect_name}`;
      ownerMap.set(key, o.vrt_name);
      zoneMap.set(key, o.zone);
    });

    const selectedZones = zones ? zones.split(',').map(z => z.trim()).filter(Boolean) : null;

    const vrtDataMap = new Map();
    let totalDefects = 0;

    for (const r of defectRows) {
      const d = new Date(r.CREATION_TIME);
      if (!matchesShiftAndPeriod(d)) continue;

      const key = `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;
      const zone = zoneMap.get(key);

      if (selectedZones && selectedZones.length > 0) {
        if (!zone || !selectedZones.includes(zone)) continue;
      }

      totalDefects += 1;
      const vrt = ownerMap.get(key) || 'VRT не найдена';

      if (!vrtDataMap.has(vrt)) {
        vrtDataMap.set(vrt, { vrt, count: 0, dpu: 0, mppsMap: new Map(), mpps: [] });
      }
      const vrtData = vrtDataMap.get(vrt);
      vrtData.count += 1;

      const mppKey = key + '|' + (zone || '');
      if (!vrtData.mppsMap.has(mppKey)) {
        vrtData.mppsMap.set(mppKey, {
          model: r.MODEL, bom_name: r.PART_NAME, defect_name: r.PROBLEM_TYPE,
          zone: zone || '', count: 0, dpu: 0,
        });
      }
      vrtData.mppsMap.get(mppKey).count += 1;
    }

    // Без обрезки на 1000
    const calculateDpu = (count) => totalCars === 0 ? 0 : Number(((count / totalCars) * 1000).toFixed(2));

    for (const [, v] of vrtDataMap) {
      v.dpu = calculateDpu(v.count);
      v.mpps = Array.from(v.mppsMap.values()).map(m => ({ ...m, dpu: calculateDpu(m.count) }));
      v.mpps.sort((a, b) => b.count - a.count);
    }

    const histogram = Array.from(vrtDataMap.entries())
      .map(([name, data]) => ({
        category: name,
        value: metric === 'dpu' ? data.dpu : data.count,
        count: data.count, dpu: data.dpu,
      })).sort((a, b) => b.count - a.count);

    const unassignedCount = vrtDataMap.get('VRT не найдена')?.count || 0;

    const topVrts = Array.from(vrtDataMap.entries())
      .filter(([name]) => name !== 'VRT не найдена')
      .map(([name, data]) => ({ vrt: name, count: data.count, dpu: data.dpu, mpps: data.mpps }))
      .sort((a, b) => metric === 'dpu' ? b.dpu - a.dpu : b.count - a.count);

    res.json({ histogram, totalCars, totalCarsShift, unassignedCount, totalDefects, topVrts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Дефекты без владельца
app.get('/api/vrt-report/unassigned-defects', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, defectType = 'all' } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });

    const nextDayObj = new Date(`${dateTo}T12:00:00`);
    nextDayObj.setDate(nextDayObj.getDate() + 1);
    const nextDayStr = `${nextDayObj.getFullYear()}-${String(nextDayObj.getMonth()+1).padStart(2,'0')}-${String(nextDayObj.getDate()).padStart(2,'0')}`;

    const raw = await fetchRawDefects(`${dateFrom} 00:00:00`, `${nextDayStr} 23:59:59`, checkpoint, defectType);

    const [owners] = await notesPool.query(`
      SELECT do.model, do.bom_name, do.defect_name, v.name AS vrt_name
      FROM vrt_owners do LEFT JOIN vrts v ON do.vrt_id = v.id
    `);
    const ownerMap = new Map();
    owners.forEach(o => ownerMap.set(`${o.model}|${o.bom_name}|${o.defect_name}`, o.vrt_name));

    const groups = new Map();
    for (const r of raw) {
      const key = `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;
      const vrt = ownerMap.get(key) || 'VRT не найдена';
      if (vrt !== 'VRT не найдена') continue;

      if (!groups.has(key)) {
        groups.set(key, {
          model: r.MODEL, bom_name: r.PART_NAME, defect_name: r.PROBLEM_TYPE,
          mpp: `${r.MODEL || 'UNKNOWN'} ${r.PART_NAME || ''} ${r.PROBLEM_TYPE || ''}`.trim(),
          count: 0,
        });
      }
      groups.get(key).count++;
    }

    res.json(Array.from(groups.values()).sort((a, b) => b.count - a.count));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Назначить VRT дефекту
app.post('/api/vrt-report/assign-owner', async (req, res) => {
  try {
    const { model, bom_name, defect_name, vrtName, password } = req.body;
    if (!model || !bom_name || !defect_name || !vrtName || !password)
      return res.status(400).json({ error: 'Не все обязательные поля заполнены' });
    if (password !== BRIGADE_PASSWORD) return res.status(403).json({ error: 'Неверный пароль' });

    const [vrtRows] = await notesPool.query('SELECT id FROM vrts WHERE name = ?', [vrtName]);
    if (vrtRows.length === 0) return res.status(404).json({ error: 'VRT не найдена' });

    // При назначении зона = 'Не указана' (если пользователь не создал запись в справочнике вручную)
    // Можно расширить: передавать zone с фронта
    const { zone = '' } = req.body;

    await notesPool.query(`
      INSERT INTO vrt_owners (model, bom_name, defect_name, zone, vrt_id)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE vrt_id = VALUES(vrt_id)
    `, [model, bom_name, defect_name, zone, vrtRows[0].id]);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Справочник — GET
app.get('/api/vrt-report/dictionary', async (req, res) => {
  try {
    const [rows] = await notesPool.query(`
      SELECT do.id, do.model, do.bom_name, do.defect_name, do.zone, v.name AS vrt_name
      FROM vrt_owners do LEFT JOIN vrts v ON do.vrt_id = v.id
      ORDER BY do.model, do.bom_name, do.defect_name
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Справочник — POST (добавить/обновить)
app.post('/api/vrt-report/dictionary', async (req, res) => {
  try {
    const { model, bom_name, defect_name, zone, vrtName, password } = req.body;
    if (!model || !bom_name || !defect_name || !zone || !vrtName || !password)
      return res.status(400).json({ error: 'Не все поля заполнены' });
    if (password !== BRIGADE_PASSWORD) return res.status(403).json({ error: 'Неверный пароль' });

    const [vrtRows] = await notesPool.query('SELECT id FROM vrts WHERE name = ?', [vrtName]);
    if (vrtRows.length === 0) return res.status(404).json({ error: 'VRT не найдена' });

    await notesPool.query(`
      INSERT INTO vrt_owners (model, bom_name, defect_name, zone, vrt_id)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE vrt_id = VALUES(vrt_id)
    `, [model, bom_name, defect_name, zone, vrtRows[0].id]);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Справочник — DELETE
app.delete('/api/vrt-report/dictionary/:id', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== BRIGADE_PASSWORD) return res.status(403).json({ error: 'Неверный пароль' });
    await notesPool.query('DELETE FROM vrt_owners WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Импорт справочника (5 колонок)
app.post('/api/vrt-report/import', async (req, res) => {
  try {
    const { entries, password } = req.body;
    if (!entries || !Array.isArray(entries) || entries.length === 0 || !password)
      return res.status(400).json({ error: 'Не переданы данные или пароль' });
    if (password !== IMPORT_PASSWORD) return res.status(403).json({ error: 'Неверный пароль для импорта' });

    const vrtCache = new Map();
    let imported = 0;

    for (const entry of entries) {
      const { model, bom_name, defect_name, vrtName, zone } = entry;
      if (!model || !bom_name || !defect_name || !vrtName || !zone) continue;

      let vrtId = vrtCache.get(vrtName);
      if (!vrtId) {
        const [rows] = await notesPool.query('SELECT id FROM vrts WHERE name = ?', [vrtName]);
        if (rows.length === 0) {
          const [ins] = await notesPool.query('INSERT INTO vrts (name) VALUES (?)', [vrtName]);
          vrtId = ins.insertId;
        } else {
          vrtId = rows[0].id;
        }
        vrtCache.set(vrtName, vrtId);
      }

      await notesPool.query(`
        INSERT INTO vrt_owners (model, bom_name, defect_name, zone, vrt_id)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE vrt_id = VALUES(vrt_id)
      `, [model, bom_name, defect_name, zone, vrtId]);
      imported++;
    }

    res.json({ success: true, imported });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Тренды
// Тренды
app.get('/api/vrt-report/trend', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, defectType = 'all', vrts, metric = 'count', shift, zones } = req.query;
    let sqlStart = dateFrom ? `${dateFrom} 00:00:00` : formatSqlDateTime(new Date(Date.now() - 90*86400000));
    let sqlEnd = dateTo ? `${dateTo} 23:59:59` : formatSqlDateTime(new Date());

    let defectRows = await fetchRawDefects(sqlStart, sqlEnd, checkpoint, defectType);
    if (shift && shift !== 'all') defectRows = defectRows.filter(d => getShiftLetterFromDate(d.CREATION_TIME) === shift);

    const [owners] = await notesPool.query(`
      SELECT do.model, do.bom_name, do.defect_name, do.zone, v.name AS vrt_name
      FROM vrt_owners do LEFT JOIN vrts v ON do.vrt_id = v.id
    `);
    const ownerMap = new Map();
    const zoneMap = new Map();
    owners.forEach(o => {
      const key = `${o.model}|${o.bom_name}|${o.defect_name}`;
      ownerMap.set(key, o.vrt_name);
      zoneMap.set(key, o.zone);
    });

    const selectedZones = zones ? zones.split(',').map(z => z.trim()).filter(Boolean) : null;
    let selectedVrtsSet = null;
    if (vrts && vrts !== 'ALL') selectedVrtsSet = new Set(vrts.split(',').map(b => b.trim()).filter(Boolean));

    function getPeriodKey(date, type) {
      const d = new Date(date);
      if (type === 'month') return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if (type === 'week') {
        const mon = new Date(d);
        const dayNum = mon.getDay() || 7;
        mon.setDate(mon.getDate() + 4 - dayNum);
        const yearStart = new Date(mon.getFullYear(), 0, 1);
        const weekNo = Math.ceil((((mon - yearStart) / 86400000) + 1) / 7);
        return `${mon.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
      }
      return getLocalDateStr(d);
    }
    function generatePeriods(type, count, endDate) {
      const periods = [];
      const current = new Date(endDate);
      while (periods.length < count) {
        const key = getPeriodKey(current, type);
        if (!periods.includes(key)) periods.push(key);
        if (type === 'month') current.setMonth(current.getMonth() - 1);
        else if (type === 'week') current.setDate(current.getDate() - 7);
        else current.setDate(current.getDate() - 1);
      }
      return periods;
    }

    const endDateObj = new Date(sqlEnd.replace(' ', 'T'));
    const monthPeriods = generatePeriods('month', 3, endDateObj);
    const weekPeriods = generatePeriods('week', 4, endDateObj);
    const dayPeriods = generatePeriods('day', 14, endDateObj);

    // period -> count (общий по всем MPP выбранных VRT)
    const monthCounts = new Map(monthPeriods.map(p => [p, 0]));
    const weekCounts = new Map(weekPeriods.map(p => [p, 0]));
    const dayCounts = new Map(dayPeriods.map(p => [p, 0]));
    const monthCars = new Map(monthPeriods.map(p => [p, new Set()]));
    const weekCars = new Map(weekPeriods.map(p => [p, new Set()]));
    const dayCars = new Map(dayPeriods.map(p => [p, new Set()]));

    for (const defect of defectRows) {
      const key = `${defect.MODEL}|${defect.PART_NAME}|${defect.PROBLEM_TYPE}`;
      const vrt = ownerMap.get(key) || 'VRT не найдена';
      if (selectedVrtsSet && !selectedVrtsSet.has(vrt)) continue;
      const zone = zoneMap.get(key);
      if (selectedZones && selectedZones.length > 0 && (!zone || !selectedZones.includes(zone))) continue;

      const defDate = new Date(defect.CREATION_TIME);
      const mKey = getPeriodKey(defDate, 'month');
      if (monthCounts.has(mKey)) monthCounts.set(mKey, monthCounts.get(mKey) + 1);
      const wKey = getPeriodKey(defDate, 'week');
      if (weekCounts.has(wKey)) weekCounts.set(wKey, weekCounts.get(wKey) + 1);
      const dKey = getPeriodKey(defDate, 'day');
      if (dayCounts.has(dKey)) dayCounts.set(dKey, dayCounts.get(dKey) + 1);
    }

    const [cp72Rows] = await pool.query(`
      SELECT VIN, CREATION_TIME FROM at_om_wiptrackinghistory
      WHERE WC_NAME = 'CP72' AND CREATION_TIME >= ? AND CREATION_TIME <= ?
    `, [sqlStart, sqlEnd]);
    let cp72Filtered = cp72Rows;
    if (shift && shift !== 'all') cp72Filtered = cp72Rows.filter(c => getShiftLetterFromDate(c.CREATION_TIME) === shift);

    for (const car of cp72Filtered) {
      const carDate = new Date(car.CREATION_TIME);
      const mKey = getPeriodKey(carDate, 'month');
      if (monthCars.has(mKey)) monthCars.get(mKey).add(car.VIN);
      const wKey = getPeriodKey(carDate, 'week');
      if (weekCars.has(wKey)) weekCars.get(wKey).add(car.VIN);
      const dKey = getPeriodKey(carDate, 'day');
      if (dayCars.has(dKey)) dayCars.get(dKey).add(car.VIN);
    }

    // Без обрезки на 1000
    function buildResult(countsMap, carsMap) {
      const result = [];
      for (const period of countsMap.keys()) {
        const defects = countsMap.get(period);
        const totalCars = carsMap.get(period).size;
        let value;
        if (metric === 'dpu') value = totalCars > 0 ? Number(((defects / totalCars) * 1000).toFixed(2)) : 0;
        else value = defects;
        result.push({ period, value });
      }
      return result.sort((a, b) => a.period.localeCompare(b.period));
    }

    res.json({
      month: buildResult(monthCounts, monthCars),
      week: buildResult(weekCounts, weekCars),
      day: buildResult(dayCounts, dayCars),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Топ MPP по VRT
app.get('/api/vrt-report/top-mpp', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, defectType = 'all', vrt, shift, zones } = req.query;
    if (!vrt) return res.status(400).json({ error: 'vrt обязателен' });

    let sqlStart, sqlEnd;
    if (dateFrom && dateTo) { sqlStart = `${dateFrom} 00:00:00`; sqlEnd = `${dateTo} 23:59:59`; }
    else {
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const start = new Date(end); start.setDate(start.getDate() - 13); start.setHours(0,0,0,0);
      sqlStart = formatSqlDateTime(start); sqlEnd = formatSqlDateTime(end);
    }

    let defectRows = await fetchRawDefects(sqlStart, sqlEnd, checkpoint, defectType);
    if (shift && shift !== 'all') defectRows = defectRows.filter(d => getShiftLetterFromDate(d.CREATION_TIME) === shift);

    const [owners] = await notesPool.query(`
      SELECT do.model, do.bom_name, do.defect_name, do.zone, v.name AS vrt_name
      FROM vrt_owners do LEFT JOIN vrts v ON do.vrt_id = v.id
    `);
    const ownerMap = new Map();
    const zoneMap = new Map();
    owners.forEach(o => {
      const key = `${o.model}|${o.bom_name}|${o.defect_name}`;
      ownerMap.set(key, o.vrt_name);
      zoneMap.set(key, o.zone);
    });

    const selectedZones = zones ? zones.split(',').map(z => z.trim()).filter(Boolean) : null;

    const groups = new Map();
    for (const r of defectRows) {
      const key = `${r.MODEL}|${r.PART_NAME}|${r.PROBLEM_TYPE}`;
      const owner = ownerMap.get(key) || 'VRT не найдена';
      if (owner !== vrt) continue;

      const zone = zoneMap.get(key) || '';
      if (selectedZones && selectedZones.length > 0 && (!zone || !selectedZones.includes(zone))) continue;

      const dateStr = getLocalDateStr(r.CREATION_TIME);
      const groupKey = `${dateStr}|${key}|${zone}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          date: dateStr,
          model: r.MODEL, bom_name: r.PART_NAME, defect_name: r.PROBLEM_TYPE, zone,
          mpp: `${r.MODEL || ''} ${r.PART_NAME || ''} ${r.PROBLEM_TYPE || ''} ${zone ? '('+zone+')' : ''}`.trim(),
          count: 0,
        });
      }
      groups.get(groupKey).count++;
    }

    const result = Array.from(groups.values()).sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.count - a.count;
    });

    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// VIN'ы по конкретному MPP + зоне + дате
app.get('/api/vrt-report/top-mpp-vins', async (req, res) => {
  try {
    const { dateFrom, dateTo, checkpoint, defectType = 'all', shift, model, bom_name, defect_name, zone, date } = req.query;
    if (!model || !bom_name || !defect_name || !date) return res.status(400).json({ error: 'model, bom_name, defect_name, date обязательны' });

    let sqlStart, sqlEnd;
    if (dateFrom && dateTo) { sqlStart = `${dateFrom} 00:00:00`; sqlEnd = `${dateTo} 23:59:59`; }
    else {
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const start = new Date(end); start.setDate(start.getDate() - 13); start.setHours(0,0,0,0);
      sqlStart = formatSqlDateTime(start); sqlEnd = formatSqlDateTime(end);
    }

    let defectRows = await fetchRawDefects(sqlStart, sqlEnd, checkpoint, defectType);

    defectRows = defectRows.filter(r => {
      if (r.MODEL !== model) return false;
      if (r.PART_NAME !== bom_name) return false;
      if (r.PROBLEM_TYPE !== defect_name) return false;
      return getLocalDateStr(r.CREATION_TIME) === date;
    });

    if (shift && shift !== 'all') defectRows = defectRows.filter(r => getShiftLetterFromDate(r.CREATION_TIME) === shift);

    const vinSet = new Set(defectRows.map(r => r.VIN));
    res.json([...vinSet]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});



// ============================================================
// ================== LINE DEFECTS CAPTURE ====================
// ============================================================

const LINE_DEFECTS_DIR              = path.join(__dirname, 'uploads', 'line-defects');
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

// Удаление заметки (опционально)
app.delete('/api/defect-notes/:mpp', async (req, res) => {
  try {
    const { mpp } = req.params;
    if (!mpp) return res.status(400).json({ error: 'mpp обязателен' });

    await notesPool.query(
      'DELETE FROM defect_user_notes WHERE mpp = ?',
      [mpp]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления заметки:', err.message);
    res.status(500).json({ error: err.message });
  }
});


/* ====================================================================== */
/* ===================== REPPS REPORT =================================== */
/* ====================================================================== */

const REPPS_NODE = 'REPPS';

// Эндпоинт 1: Данные для графиков
app.get('/api/repps-retrospective', async (req, res) => {
  try {
    const { period = 'all', count, fromDate, toDate, hideAssembly } = req.query;

    // 1. Загружаем справочник PS (один раз для всего запроса)
    let psKeySet = new Set();
    try {
      const [psRows] = await notesPool.query(
        "SELECT part_name, defect_type FROM part_defect_shop_mapping WHERE shop = 'PS'"
      );
      psKeySet = new Set(psRows.map(r =>
        `${String(r.part_name || '').trim().toLowerCase()}|${String(r.defect_type || '').trim().toLowerCase()}`
      ));
    } catch (e) {
      console.error('[repps-retrospective] Ошибка загрузки справочника PS:', e.message);
    }

    /* ------------------------------------------------------------------ */
    /* Хелпер: посчитать данные за один период                            */
    /* ------------------------------------------------------------------ */
    const getReps = async (startDate, endDate, label, type) => {
      // 2. Уникальные VIN + их РАННЕЕ время захода в REPPS.
      const [rows] = await mesPool.query(`
        SELECT t.vin, t.first_repps, too.product AS MODEL
        FROM (
          SELECT vin, MIN(gmt_create) AS first_repps
          FROM tm_vhc_test_line_movement
          WHERE node_nature = ? AND is_deleted = 0
          GROUP BY vin
        ) t
        LEFT JOIN tm_ofm_order too ON too.vin = t.vin
        WHERE DATE(t.first_repps) BETWEEN ? AND ?
      `, [REPPS_NODE, startDate, endDate]);

      let filteredRows = rows;

      // 3. ФИЛЬТР "REPPS БЕЗ ДЕФЕКТОВ СБОРКИ" (оставляем только тех, у кого есть дефекты PS)
      if (hideAssembly === 'true' && rows.length > 0) {
        const vins = [...new Set(rows.map(r => r.vin))];
        const ph = vins.map(() => '?').join(',');
        
        // Берем все дефекты из всех трех таблиц
        const [paintDefects] = await pool.query(`SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_paint_qm_defect_info WHERE VIN IN (${ph})`, vins);
        const [qmDefects] = await pool.query(`SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_qm_defect_info WHERE VIN IN (${ph})`, vins);
        const [biwDefects] = await pool.query(`SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_biw_qm_defect_info WHERE VIN IN (${ph})`, vins);
        
        const vinsWithPsDefects = new Set();
        const allDefects = [...paintDefects, ...qmDefects, ...biwDefects];
        
        // Проверяем каждый дефект по справочнику
        allDefects.forEach(d => {
          const key = `${String(d.PART_NAME || '').trim().toLowerCase()}|${String(d.PROBLEM_TYPE || '').trim().toLowerCase()}`;
          if (psKeySet.has(key)) {
            vinsWithPsDefects.add(d.VIN);
          }
        });
        
        // Оставляем только машины, у которых найден хотя бы один дефект из PS
        filteredRows = rows.filter(r => vinsWithPsDefects.has(r.vin));
      }

      const vinModel = new Map();
      filteredRows.forEach(r => {
        if (!vinModel.has(r.vin)) {
          vinModel.set(r.vin, r.MODEL || 'UNKNOWN');
        }
      });

      const total = vinModel.size;

      let paintAll = 0;
      let paintOpen = 0;
      let paintClosedOnly = 0;

      const modelTotal = {};
      const modelPaintOpen = {};
      const modelPaintClosedOnly = {};

      if (total > 0) {
        const vins = [...vinModel.keys()];
        const ph = vins.map(() => '?').join(',');
        const [paintRows] = await pool.query(`
          SELECT VIN, STATUS
          FROM at_paint_qm_defect_info
          WHERE VIN IN (${ph})
        `, vins);

        const vinHasPaint = new Set();
        const vinHasOpenPaint = new Set();

        paintRows.forEach(r => {
          vinHasPaint.add(r.VIN);
          const s = (r.STATUS || '').toUpperCase();
          if (s !== 'CLOSED') vinHasOpenPaint.add(r.VIN);
        });

        paintAll = vinHasPaint.size;
        paintOpen = vinHasOpenPaint.size;
        paintClosedOnly = paintAll - paintOpen;

        vinModel.forEach((m, vin) => {
          modelTotal[m] = (modelTotal[m] || 0) + 1;
          if (vinHasOpenPaint.has(vin)) {
            modelPaintOpen[m] = (modelPaintOpen[m] || 0) + 1;
          } else if (vinHasPaint.has(vin)) {
            modelPaintClosedOnly[m] = (modelPaintClosedOnly[m] || 0) + 1;
          }
        });
      }

      const result = {
        label, type, startDate, endDate, total,
        paint_all: paintAll,
        paint_open: paintOpen,
        paint_closed_only: paintClosedOnly,
        no_paint: total - paintAll,
      };

      Object.keys(modelTotal).forEach(m => {
        const totalM = modelTotal[m];
        const openM = modelPaintOpen[m] || 0;
        const closedM = modelPaintClosedOnly[m] || 0;
        result[m] = totalM;
        result[`${m}_paint_open`] = openM;
        result[`${m}_paint_closed_only`] = closedM;
        result[`${m}_no_paint`] = totalM - openM - closedM;
      });

      return result;
    };

    /* ------------------------------------------------------------------ */
    /* Генерация периодов                                                 */
    /* ------------------------------------------------------------------ */
    const formatDate = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    const pad = (num) => String(num).padStart(2, '0');
    const getISOWeek = (date) => {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };

    const now = new Date();
    const periods = [];
    const typeOrder = { year: 0, month: 1, week: 2, day: 3 };

    if (period === 'all') {
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        periods.push({
          label: `${monthName} ${y}`,
          startDate: `${y}-${m}-01`,
          endDate: `${y}-${m}-${pad(lastDay)}`,
          type: 'month',
        });
      }
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      for (let i = 3; i >= 0; i--) {
        const start = new Date(monday);
        start.setDate(monday.getDate() - i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        periods.push({
          label: `W${getISOWeek(start)} ${start.getFullYear()}`,
          startDate: formatDate(start),
          endDate: formatDate(end),
          type: 'week',
        });
      }
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        periods.push({
          label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`,
          startDate: formatDate(d),
          endDate: formatDate(d),
          type: 'day',
        });
      }
    } else if (fromDate && toDate) {
      let from = new Date(fromDate + 'T00:00:00');
      let to = new Date(toDate + 'T00:00:00');
      if (from > to) [from, to] = [to, from];

      if (period === 'day') {
        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
          const dateStr = formatDate(d);
          periods.push({
            label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`,
            startDate: dateStr,
            endDate: dateStr,
            type: 'day',
          });
        }
      } else if (period === 'month') {
        let d = new Date(from.getFullYear(), from.getMonth(), 1);
        while (d <= to) {
          const y = d.getFullYear();
          const m = d.getMonth() + 1;
          const lastDay = new Date(y, m, 0).getDate();
          const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
          periods.push({
            label: `${monthName} ${y}`,
            startDate: `${y}-${pad(m)}-01`,
            endDate: `${y}-${pad(m)}-${lastDay}`,
            type: 'month',
          });
          d.setMonth(d.getMonth() + 1);
        }
      } else if (period === 'week') {
        const day = from.getDay();
        const monday = new Date(from);
        monday.setDate(from.getDate() - (day === 0 ? 6 : day - 1));
        for (let start = new Date(monday); start <= to; start.setDate(start.getDate() + 7)) {
          const end = new Date(start);
          end.setDate(start.getDate() + 6);
          periods.push({
            label: `W${getISOWeek(start)} ${start.getFullYear()}`,
            startDate: formatDate(start),
            endDate: formatDate(end),
            type: 'week',
          });
        }
      } else if (period === 'year') {
        for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
          periods.push({
            label: String(y),
            startDate: `${y}-01-01`,
            endDate: `${y}-12-31`,
            type: 'year',
          });
        }
      }
    } else {
      const defaultCount = { year: 2, month: 3, week: 4, day: 14 }[period] || 7;
      const limit = parseInt(count, 10) || defaultCount;
      if (period === 'year') {
        for (let i = limit - 1; i >= 0; i--) {
          const y = now.getFullYear() - i;
          periods.push({
            label: String(y),
            startDate: `${y}-01-01`,
            endDate: `${y}-12-31`,
            type: 'year',
          });
        }
      } else if (period === 'month') {
        for (let i = limit - 1; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
          const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
          periods.push({
            label: `${monthName} ${y}`,
            startDate: `${y}-${m}-01`,
            endDate: `${y}-${m}-${pad(lastDay)}`,
            type: 'month',
          });
        }
      } else if (period === 'week') {
        const dayOfWeek = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        for (let i = limit - 1; i >= 0; i--) {
          const start = new Date(monday);
          start.setDate(monday.getDate() - i * 7);
          const end = new Date(start);
          end.setDate(start.getDate() + 6);
          periods.push({
            label: `W${getISOWeek(start)} ${start.getFullYear()}`,
            startDate: formatDate(start),
            endDate: formatDate(end),
            type: 'week',
          });
        }
      } else if (period === 'day') {
        for (let i = limit - 1; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(now.getDate() - i);
          periods.push({
            label: `${pad(d.getDate())}.${pad(d.getMonth()+1)}`,
            startDate: formatDate(d),
            endDate: formatDate(d),
            type: 'day',
          });
        }
      }
    }

    periods.sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || a.startDate.localeCompare(b.startDate));

    const result = [];
    for (const p of periods) {
      result.push(await getReps(p.startDate, p.endDate, p.label, p.type));
    }

    res.json({ dataPoints: result });
  } catch (err) {
    console.error('Ошибка /api/repps-retrospective:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// Эндпоинт 2: Данные для модального окна (список VIN и их дефекты)
app.get('/api/repps-vins-details', async (req, res) => {
  try {
    const { dateFrom, dateTo, category = 'total', model, hideAssembly } = req.query;
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom и dateTo обязательны' });
    }

    // 1. Загружаем справочник PS
    let psKeySet = new Set();
    try {
      const [psRows] = await notesPool.query(
        "SELECT part_name, defect_type FROM part_defect_shop_mapping WHERE shop = 'PS'"
      );
      psKeySet = new Set(psRows.map(r =>
        `${String(r.part_name || '').trim().toLowerCase()}|${String(r.defect_type || '').trim().toLowerCase()}`
      ));
    } catch (e) {
      console.error('[repps-vins-details] Ошибка загрузки справочника PS:', e.message);
    }

    // 2. VIN + первое время REPPS
    let sql = `
      SELECT t.vin, t.first_repps, too.product AS MODEL
      FROM (
        SELECT vin, MIN(gmt_create) AS first_repps
        FROM tm_vhc_test_line_movement
        WHERE node_nature = ? AND is_deleted = 0
        GROUP BY vin
      ) t
      LEFT JOIN tm_ofm_order too ON too.vin = t.vin
      WHERE DATE(t.first_repps) BETWEEN ? AND ?
    `;
    const params = [REPPS_NODE, dateFrom, dateTo];
    if (model && model !== 'ALL') {
      sql += ' AND too.product = ?';
      params.push(model);
    }

    const [rows] = await mesPool.query(sql, params);
    if (rows.length === 0) return res.json([]);

    let filteredRows = rows;

    // 3. ФИЛЬТР "REPPS БЕЗ ДЕФЕКТОВ СБОРКИ" ДЛЯ МОДАЛКИ
    if (hideAssembly === 'true') {
      const vins = rows.map(r => r.vin);
      const ph = vins.map(() => '?').join(',');
      
      const [paintDefects] = await pool.query(`SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_paint_qm_defect_info WHERE VIN IN (${ph})`, vins);
      const [qmDefects] = await pool.query(`SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_qm_defect_info WHERE VIN IN (${ph})`, vins);
      const [biwDefects] = await pool.query(`SELECT VIN, PART_NAME, PROBLEM_TYPE FROM at_biw_qm_defect_info WHERE VIN IN (${ph})`, vins);
      
      const vinsWithPsDefects = new Set();
      [...paintDefects, ...qmDefects, ...biwDefects].forEach(d => {
        const key = `${String(d.PART_NAME || '').trim().toLowerCase()}|${String(d.PROBLEM_TYPE || '').trim().toLowerCase()}`;
        if (psKeySet.has(key)) vinsWithPsDefects.add(d.VIN);
      });
      
      // Оставляем только машины, у которых есть совпадение
      filteredRows = rows.filter(r => vinsWithPsDefects.has(r.vin));
    }

    if (filteredRows.length === 0) return res.json([]);

    const vins = filteredRows.map(r => r.vin);
    const ph = vins.map(() => '?').join(',');

    // 4. Время PSOUT (AGMPS01002)
    const [psoutRows] = await mesPool.query(`
      SELECT vin, MAX(scan_time) AS psout_time
      FROM ti_mes_movement
      WHERE uloc_no = 'AGMPS01002' AND is_deleted = 0 AND vin IN (${ph})
      GROUP BY vin
    `, vins);
    const psoutByVin = new Map(psoutRows.map(r => [r.vin, r.psout_time]));

    // 5. Дефекты из Paint (для колонки "Дефекты окраски" и классификации)
    const [paintDefects] = await pool.query(`
      SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, STATUS, CREATION_TIME
      FROM at_paint_qm_defect_info
      WHERE VIN IN (${ph})
      ORDER BY VIN, CREATION_TIME DESC
    `, vins);

    // 6. Дефекты из QM и BIW (для колонки "Дефекты окраски после PS")
    const [qmDefects] = await pool.query(`
      SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, STATUS, CREATION_TIME
      FROM at_qm_defect_info
      WHERE VIN IN (${ph})
    `, vins);

    const [biwDefects] = await pool.query(`
      SELECT VIN, PART_NAME, PROBLEM_TYPE, PROBLEM_GRADE, STATUS, CREATION_TIME
      FROM at_biw_qm_defect_info
      WHERE VIN IN (${ph})
    `, vins);

    // 7. Обработка "Дефекты окраски" (только Paint)
    const defectsByVin = new Map();
    const vinHasPaint = new Set();
    const vinHasOpenPaint = new Set();

    paintDefects.forEach(d => {
      vinHasPaint.add(d.VIN);
      const isOpen = (d.STATUS || '').toUpperCase() !== 'CLOSED';
      if (isOpen) vinHasOpenPaint.add(d.VIN);

      if (!defectsByVin.has(d.VIN)) defectsByVin.set(d.VIN, []);
      defectsByVin.get(d.VIN).push({
        part_name: d.PART_NAME || '',
        problem_type: d.PROBLEM_TYPE || '',
        grade: d.PROBLEM_GRADE || '',
        status: d.STATUS || '',
        is_open: isOpen,
        creation_time: d.CREATION_TIME,
      });
    });

    // 8. Обработка "Дефекты окраски после PS"
    const postPsDefectsByVin = new Map();
    const allDefects = [...paintDefects, ...qmDefects, ...biwDefects];

    allDefects.forEach(d => {
      const key = `${String(d.PART_NAME || '').trim().toLowerCase()}|${String(d.PROBLEM_TYPE || '').trim().toLowerCase()}`;
      const isPs = psKeySet.has(key);

      if (isPs) {
        if (!postPsDefectsByVin.has(d.VIN)) postPsDefectsByVin.set(d.VIN, []);
        postPsDefectsByVin.get(d.VIN).push({
          part_name: d.PART_NAME || '',
          problem_type: d.PROBLEM_TYPE || '',
          grade: d.PROBLEM_GRADE || '',
          status: d.STATUS || '',
          is_open: (d.STATUS || '').toUpperCase() !== 'CLOSED',
          creation_time: d.CREATION_TIME,
        });
      }
    });

    // 9. Фильтр по категории
    let filteredCategory = filteredRows;
    if (category === 'no_paint') {
      filteredCategory = filteredRows.filter(r => !vinHasPaint.has(r.vin));
    } else if (category === 'paint_closed_only') {
      filteredCategory = filteredRows.filter(r => vinHasPaint.has(r.vin) && !vinHasOpenPaint.has(r.vin));
    } else if (category === 'paint_open') {
      filteredCategory = filteredRows.filter(r => vinHasOpenPaint.has(r.vin) && psoutByVin.has(r.vin));
    } else if (category === 'paint_all') {
      filteredCategory = filteredRows.filter(r => vinHasPaint.has(r.vin));
    }

    // 10. Формирование ответа
    const result = filteredCategory.map(r => {
      const defects = (defectsByVin.get(r.vin) || [])
        .sort((a, b) => (b.is_open ? 1 : 0) - (a.is_open ? 1 : 0));

      const rawPostPs = postPsDefectsByVin.get(r.vin) || [];
      const uniquePostPsMap = new Map();
      rawPostPs.forEach(d => {
        const key = `${d.part_name}|${d.problem_type}|${d.creation_time}`;
        if (!uniquePostPsMap.has(key)) {
          uniquePostPsMap.set(key, d);
        }
      });
      const postPsDefects = Array.from(uniquePostPsMap.values())
        .sort((a, b) => (b.is_open ? 1 : 0) - (a.is_open ? 1 : 0));

      return {
        vin: r.vin,
        model: r.MODEL || '—',
        repps_time: r.first_repps,
        psout_time: psoutByVin.get(r.vin) || null,
        defects,
        post_ps_defects: postPsDefects,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/repps-vins-details:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ============ DRR SHIFT — ФОТОГРАФИИ И МЕТКИ ========================== */
/* ====================================================================== */

const DRR_SHIFT_UPLOAD_DIR = path.join(__dirname, 'uploads', 'drr-shift');
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

// ================== DRR WEEKLY ANALYTICS ==================
// Агрегация snapshot-таблиц по ISO-неделям.
// Средний DRR = SUM(closed_vins) / SUM(total_vins) — взвешенное среднее.
// Фильтр shiftLetter: ALL (по умолчанию) | A | B | C
app.get('/api/drr-weekly-analytics/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { weeks = 12, shiftLetter = 'ALL' } = req.query;
    const weeksCount = Math.min(Math.max(parseInt(weeks, 10) || 12, 1), 104);

    const validLetters = ['ALL', 'A', 'B', 'C'];
    const safeLetter = validLetters.includes(String(shiftLetter).toUpperCase())
      ? String(shiftLetter).toUpperCase()
      : 'ALL';

    const config = {
      cp7:     { table: 'drr_cp7_snapshots',     extraWhere: " AND filter_name = 'all'", closedCol: 'closed_vins', label: 'DRR CP7' },
      adas:    { table: 'drr_adas_snapshots',    extraWhere: '',                          closedCol: 'closed_vins', label: 'DRR ADAS' },
      cpfinal: { table: 'drr_cpfinal_snapshots', extraWhere: '',                          closedCol: 'ok_vins',     label: 'DRR CPFinal' },
      pip:     { table: 'drr_pip_snapshots',     extraWhere: '',                          closedCol: 'closed_vins', label: 'DRR PIP' },
    };

    const cfg = config[type];
    if (!cfg) return res.status(400).json({ error: 'Неизвестный тип отчёта' });

    // ВАЖНО: не фильтруем по week_number IS NOT NULL — у старых снапшотов он NULL.
    // Неделя вычисляется из shift_date через YEARWEEK(..., 3).
    // Учитываем все строки, где total_vins > 0 (дни без машин в расчёт не идут).
    const sql = `
      SELECT
        YEARWEEK(shift_date, 3) AS iso_year_week,
        COUNT(*) AS total_records,
        SUM(CASE WHEN total_vins > 0 THEN 1 ELSE 0 END) AS days_with_cars,
        SUM(total_vins) AS total_vins,
        SUM(${cfg.closedCol}) AS closed_vins,
        SUM(nok_vins) AS nok_vins,
        MIN(CASE WHEN drr_percent > 0 THEN drr_percent END) AS min_drr,
        MAX(drr_percent) AS max_drr
      FROM ${cfg.table}
      WHERE shift_letter = ?
        AND shift_date >= DATE_SUB(CURDATE(), INTERVAL ${weeksCount} WEEK)
        ${cfg.extraWhere}
      GROUP BY YEARWEEK(shift_date, 3)
      ORDER BY iso_year_week DESC
      LIMIT ${weeksCount}
    `;

    const [rows] = await notesPool.query(sql, [safeLetter]);

    function getISOWeekRange(year, weekNumber) {
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const jan4Day = jan4.getUTCDay() || 7;
      const week1Monday = new Date(jan4);
      week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
      const monday = new Date(week1Monday);
      monday.setUTCDate(week1Monday.getUTCDate() + (weekNumber - 1) * 7);
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      return { start: fmt(monday), end: fmt(sunday) };
    }

    const result = rows.map(r => {
      const yw = Number(r.iso_year_week);
      const year = Math.floor(yw / 100);
      const week = yw % 100;
      const range = getISOWeekRange(year, week);

      const totalVins = Number(r.total_vins) || 0;
      const closedVins = Number(r.closed_vins) || 0;
      const nokVins = Number(r.nok_vins) || 0;

      const avgDrr = totalVins > 0
        ? Number(((closedVins / totalVins) * 100).toFixed(1))
        : null;

      return {
        weekNumber: week,
        year,
        weekStart: range.start,
        weekEnd: range.end,
        totalDays: 7,
        validDays: Number(r.days_with_cars),
        totalRecords: Number(r.total_records),
        totalVins,
        closedVins,
        nokVins,
        avgDrr,
        minDrr: r.min_drr !== null ? Number(Number(r.min_drr).toFixed(1)) : null,
        maxDrr: r.max_drr !== null ? Number(Number(r.max_drr).toFixed(1)) : null,
        label: cfg.label,
      };
    }).reverse();

    res.json({ type, weeks: weeksCount, shiftLetter: safeLetter, data: result });
  } catch (err) {
    console.error('Ошибка /api/drr-weekly-analytics:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================== DRR WEEKLY PHOTOS ==================
// Возвращает последние N фото из drr_shift_photos за диапазон дат (неделя) по конкретному чекпоинту.
// Формат photo_key: YYYY-MM-DD_<letter>_<checkpoint>, например 2026-10-05_A_cp7
app.get('/api/drr-weekly-photos', async (req, res) => {
  try {
    const { checkpoint, weekStart, weekEnd, limit = 10 } = req.query;
    if (!checkpoint || !weekStart || !weekEnd) {
      return res.status(400).json({ error: 'checkpoint, weekStart, weekEnd обязательны' });
    }
    const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);

    const [rows] = await notesPool.query(`
      SELECT id, photo_key, filename, mime, uploaded_at
      FROM drr_shift_photos
      WHERE LEFT(photo_key, 10) BETWEEN ? AND ?
        AND SUBSTRING_INDEX(photo_key, '_', -1) = ?
      ORDER BY uploaded_at DESC
      LIMIT ?
    `, [weekStart, weekEnd, checkpoint, lim]);

    res.json({
      photos: rows.map(r => ({
        id: r.id,
        url: `/api/drr-shift-photos/file/${r.filename}`,
        mime: r.mime,
        uploadedAt: r.uploaded_at,
        photoKey: r.photo_key,
      })),
      total: rows.length,
      limit: lim,
    });
  } catch (err) {
    console.error('Ошибка /api/drr-weekly-photos:', err.message);
    res.status(500).json({ error: err.message });
  }
});



/* ====================================================================== */
/* 1. VOLTAGE SPC REPORT (Основная выборка)                               */
/* ====================================================================== */
app.get('/api/voltage-spc', async (req, res) => {
  try {
    const { vin, dateFrom, dateTo, cp8Start, cp8End } = req.query;

    // 1. Получаем VINs, прошедшие CP8
    let cp8Vins = new Set();
    let cp8DateMap = new Map();

    if (cp8Start && cp8End) {
      const [cp8Rows] = await mesPool.query(`
        SELECT vin, MAX(scan_time) AS CP8_DATE
        FROM ti_mes_movement
        WHERE uloc_no = 'AGMAS01004'
          AND is_deleted = 0
          AND scan_time >= ? AND scan_time <= ?
        GROUP BY vin
      `, [cp8Start.replace('T', ' ') + ':00', cp8End.replace('T', ' ') + ':59']);

      cp8Rows.forEach(r => {
        cp8Vins.add(r.vin);
        cp8DateMap.set(r.vin, r.CP8_DATE);
      });
    }

    // 2. Получаем VINs с NOK тестами (строго < 12.6 или строго > 13)
    let nokVins = new Set();

    if (dateFrom && dateTo) {
      const [nokRows] = await pool.query(`
        SELECT DISTINCT i.VIN
        FROM at_im_electrical_check_dtl d
        JOIN at_im_electrical_check_info i ON i.ID = d.MAIN_ID
        WHERE d.ITEMNAME = 'VehicleDataDetail-EMS-Battery_Voltage'
          AND (
            CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) < 12.6 
            OR 
            CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) > 13
          )
          AND d.CREATION_TIME >= ? AND d.CREATION_TIME <= ?
      `, [`${dateFrom} 00:00:00`, `${dateTo} 23:59:59`]);
      
      nokRows.forEach(r => nokVins.add(r.VIN));
    }

    // 3. Объединяем списки VIN
    let allVins = new Set([...cp8Vins, ...nokVins]);

    if (vin && String(vin).trim()) {
      const search = String(vin).trim();
      allVins = new Set([...allVins].filter(v => v.includes(search)));
    }

    if (allVins.size === 0) return res.json([]);
    const vins = [...allVins];
    const placeholders = vins.map(() => '?').join(',');

    // 4. Модели
    const [modelRows] = await pool.query(`SELECT VIN, MODEL FROM work_order WHERE VIN IN (${placeholders})`, vins);
    const modelMap = new Map(modelRows.map(r => [r.VIN, r.MODEL]));

    // 5. Последний NOK замер (строго < 12.6 или строго > 13)
    const [lastNokRows] = await pool.query(`
      SELECT t.VIN, t.CREATION_TIME AS MEASURE_DATE, t.VOLTAGE
      FROM (
        SELECT i.VIN, d.CREATION_TIME, CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) AS VOLTAGE,
               ROW_NUMBER() OVER(PARTITION BY i.VIN ORDER BY d.CREATION_TIME DESC) as rn
        FROM at_im_electrical_check_dtl d
        JOIN at_im_electrical_check_info i ON i.ID = d.MAIN_ID
        WHERE d.ITEMNAME = 'VehicleDataDetail-EMS-Battery_Voltage'
          AND i.VIN IN (${placeholders})
          AND (
            CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) < 12.6 
            OR 
            CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) > 13
          )
      ) t WHERE t.rn = 1
    `, vins);
    const lastNokMap = new Map(lastNokRows.map(r => [r.VIN, r]));

    // 6. Последний OK замер (>= 12.6 и <= 13)
    const [lastOkRows] = await pool.query(`
      SELECT t.VIN, t.CREATION_TIME AS LAST_OK_DATE, t.VOLTAGE AS LAST_OK_VOLTAGE
      FROM (
        SELECT i.VIN, d.CREATION_TIME, CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) AS VOLTAGE,
               ROW_NUMBER() OVER(PARTITION BY i.VIN ORDER BY d.CREATION_TIME DESC) as rn
        FROM at_im_electrical_check_dtl d
        JOIN at_im_electrical_check_info i ON i.ID = d.MAIN_ID
        WHERE d.ITEMNAME = 'VehicleDataDetail-EMS-Battery_Voltage'
          AND i.VIN IN (${placeholders})
          AND CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) >= 12.6
          AND CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) <= 13
      ) t WHERE t.rn = 1
    `, vins);
    const lastOkMap = new Map(lastOkRows.map(r => [r.VIN, r]));

    // 7. Формируем результат
    const result = vins.map(v => {
      const cp8Date = cp8DateMap.get(v) || null;
      const lastNok = lastNokMap.get(v);
      const lastOk = lastOkMap.get(v);

      let tenMinNg = '+';
      if (cp8Date) {
        const cp8Time = new Date(cp8Date).getTime();
        const tenMinBeforeCp8 = cp8Time - (10 * 60 * 1000);

        const cond1 = !lastOk || (new Date(lastOk.LAST_OK_DATE).getTime() < tenMinBeforeCp8);
        const cond2 = lastNok && (new Date(lastNok.MEASURE_DATE).getTime() > cp8Time);

        if (cond1 || cond2) {
          tenMinNg = '-';
        }
      }

      return {
        VIN: v,
        MODEL: modelMap.get(v) || '—',
        VOLTAGE: lastNok ? lastNok.VOLTAGE : null,
        MEASURE_DATE: lastNok ? lastNok.MEASURE_DATE : null,
        CP8_DATE: cp8Date,
        LAST_OK_DATE: lastOk ? lastOk.LAST_OK_DATE : null,
        LAST_OK_VOLTAGE: lastOk ? lastOk.LAST_OK_VOLTAGE : null,
        TEN_MIN_NG: tenMinNg
      };
    });

    result.sort((a, b) => {
      if (a.VOLTAGE && !b.VOLTAGE) return -1;
      if (!a.VOLTAGE && b.VOLTAGE) return 1;
      if (a.CP8_DATE && b.CP8_DATE) return new Date(b.CP8_DATE) - new Date(a.CP8_DATE);
      if (a.CP8_DATE) return -1;
      if (b.CP8_DATE) return 1;
      return 0;
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/voltage-spc:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* 2. VOLTAGE SPC: Заряд АКБ после CP7 (Детальная таблица)                */
/* ====================================================================== */
app.get('/api/voltage-spc-after-cp7', async (req, res) => {
  try {
    const { vin, dateFrom, dateTo } = req.query;

    let cp7Query = `
      SELECT vin, MIN(scan_time) AS cp7_time
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72' AND is_deleted = 0
    `;
    const cp7Params = [];
    if (dateFrom && dateTo) {
      cp7Query += ` AND scan_time >= ? AND scan_time <= ?`;
      cp7Params.push(`${dateFrom} 00:00:00`, `${dateTo} 23:59:59`);
    }
    cp7Query += ` GROUP BY vin`;

    const [cp7Rows] = await mesPool.query(cp7Query, cp7Params);
    if (cp7Rows.length === 0) return res.json([]);

    let vins = cp7Rows.map(r => r.vin);
    if (vin && String(vin).trim()) {
      const search = String(vin).trim().toUpperCase();
      vins = vins.filter(v => v.toUpperCase().includes(search));
    }
    if (vins.length === 0) return res.json([]);

    const cp7TimeMap = new Map(cp7Rows.map(r => [r.vin, r.cp7_time]));
    const placeholders = vins.map(() => '?').join(',');

    const [voltageRows] = await pool.query(`
      SELECT i.VIN, d.CREATION_TIME, CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) AS VOLTAGE
      FROM at_im_electrical_check_dtl d
      JOIN at_im_electrical_check_info i ON i.ID = d.MAIN_ID
      WHERE d.ITEMNAME = 'VehicleDataDetail-EMS-Battery_Voltage' AND i.VIN IN (${placeholders})
      ORDER BY i.VIN, d.CREATION_TIME ASC
    `, vins);

    const [woRows] = await mesPool.query(`
      SELECT too.vin, too.product AS model, tbmr.material_desc AS complectation
      FROM tm_ofm_order too
      LEFT JOIN tm_bas_material_relation tbmr ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
      WHERE too.vin IN (${placeholders})
    `, vins);
    const infoMap = new Map(woRows.map(r => [r.vin, r]));

    const voltageByVin = new Map();
    voltageRows.forEach(r => {
      if (!voltageByVin.has(r.VIN)) voltageByVin.set(r.VIN, []);
      voltageByVin.get(r.VIN).push({
        time: new Date(r.CREATION_TIME).getTime(),
        voltage: parseFloat(r.VOLTAGE),
        dateStr: r.CREATION_TIME
      });
    });

    const result = [];

    vins.forEach(v => {
      const cp7DateStr = cp7TimeMap.get(v);
      const cp7Ms = new Date(cp7DateStr).getTime();
      const checks = voltageByVin.get(v) || [];
      const info = infoMap.get(v) || {};

      if (checks.length === 0) {
        result.push({
          VIN: v, MODEL: info.model || '—', COMPLECTATION: info.complectation || '—',
          CP7_DATE: cp7DateStr, CP7_VOLTAGE: null,
          FIRST_NOK_DATE: null, FIRST_NOK_VOLTAGE: null,
          FIRST_OK_DATE: null, FIRST_OK_VOLTAGE: null,
          TEN_MIN_DATE: null, TEN_MIN_RESULT: '—',
          DIFF_NOK_CP7_MINUTES: null
        });
        return;
      }

      const windowMs = 10 * 60 * 1000;
      const inWindow = checks.filter(c => Math.abs(c.time - cp7Ms) <= windowMs);
      
      let closestCheck = null;
      if (inWindow.length > 0) {
        closestCheck = inWindow.reduce((prev, curr) => (Math.abs(curr.time - cp7Ms) < Math.abs(prev.time - cp7Ms) ? curr : prev), inWindow[0]);
      } else {
        closestCheck = checks[0];
      }

      // ИЗМЕНЕНО: NG только если < 12.6
      const firstNok = checks.find(c => c.voltage < 12.6) || null;
      const firstOk = checks.find(c => c.voltage >= 12.6) || null;

      const tenMinTargetMs = cp7Ms + (10 * 60 * 1000);
      const tenMinCheck = checks.reduce((prev, curr) => (Math.abs(curr.time - tenMinTargetMs) < Math.abs(prev.time - tenMinTargetMs) ? curr : prev), checks[0]);
      
      let tenMinResult = '—';
      if (tenMinCheck) {
        // ИЗМЕНЕНО: + если >= 12.6
        tenMinResult = (tenMinCheck.voltage >= 12.6) ? '+' : '-';
      }

      let diffMinutes = null;
      if (firstNok && closestCheck) {
        diffMinutes = Math.abs(Math.floor((cp7Ms - firstNok.time) / 60000));
      }

      result.push({
        VIN: v,
        MODEL: info.model || '—',
        COMPLECTATION: info.complectation || '—',
        CP7_DATE: cp7DateStr,
        CP7_VOLTAGE: closestCheck ? closestCheck.voltage : null,
        FIRST_NOK_DATE: firstNok ? firstNok.dateStr : null,
        FIRST_NOK_VOLTAGE: firstNok ? firstNok.voltage : null,
        FIRST_OK_DATE: firstOk ? firstOk.dateStr : null,
        FIRST_OK_VOLTAGE: firstOk ? firstOk.voltage : null,
        TEN_MIN_DATE: tenMinCheck ? tenMinCheck.dateStr : null,
        TEN_MIN_RESULT: tenMinResult,
        DIFF_NOK_CP7_MINUTES: diffMinutes
      });
    });

    result.sort((a, b) => new Date(b.CP7_DATE) - new Date(a.CP7_DATE));
    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/voltage-spc-after-cp7:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* 3. VOLTAGE SPC: Дашборд по постам (CP7 -> TLADAS -> CP8)               */
/* ====================================================================== */
app.get('/api/voltage-spc-checkpoints-dashboard', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const dateStart = `${dateFrom} 00:00:00`;
    const dateEnd = `${dateTo} 23:59:59`;

    const [cp7Rows] = await mesPool.query(`
      SELECT UPPER(vin) AS vin, MIN(scan_time) AS time_val
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72' AND is_deleted = 0
        AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [dateStart, dateEnd]);
    const cp7Map = new Map(cp7Rows.map(r => [r.vin, new Date(r.time_val).getTime()]));

    const [tladasRows] = await mesPool.query(`
      SELECT UPPER(vin) AS vin, MIN(gmt_create) AS time_val
      FROM tm_vhc_test_line_movement
      WHERE node_nature = 'TLADAS' AND is_deleted = 0
        AND gmt_create >= ? AND gmt_create <= ?
      GROUP BY vin
    `, [dateStart, dateEnd]);
    const tladasMap = new Map(tladasRows.map(r => [r.vin, new Date(r.time_val).getTime()]));

    const [cp8Rows] = await mesPool.query(`
      SELECT UPPER(vin) AS vin, MAX(scan_time) AS time_val
      FROM ti_mes_movement
      WHERE uloc_no = 'AGMAS01004' AND is_deleted = 0
        AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [dateStart, dateEnd]);
    const cp8Map = new Map(cp8Rows.map(r => [r.vin, new Date(r.time_val).getTime()]));

    const allVinsSet = new Set([
      ...cp7Rows.map(r => r.vin),
      ...tladasRows.map(r => r.vin),
      ...cp8Rows.map(r => r.vin)
    ]);
    const vins = Array.from(allVinsSet);
    if (vins.length === 0) return res.json([]);

    const placeholders = vins.map(() => '?').join(',');

    const [voltageRows] = await pool.query(`
      SELECT UPPER(i.VIN) AS VIN, d.CREATION_TIME, CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) AS VOLTAGE
      FROM at_im_electrical_check_dtl d
      JOIN at_im_electrical_check_info i ON i.ID = d.MAIN_ID
      WHERE d.ITEMNAME = 'VehicleDataDetail-EMS-Battery_Voltage' AND i.VIN IN (${placeholders})
      ORDER BY i.VIN, d.CREATION_TIME ASC
    `, vins);

    const [woRows] = await mesPool.query(`
      SELECT UPPER(too.vin) AS vin, too.product AS model, tbmr.material_desc AS complectation
      FROM tm_ofm_order too
      LEFT JOIN tm_bas_material_relation tbmr ON tbmr.material_no = too.material_no AND tbmr.is_deleted = 0
      WHERE too.vin IN (${placeholders})
    `, vins);
    const infoMap = new Map(woRows.map(r => [r.vin, r]));

    const voltageByVin = new Map();
    voltageRows.forEach(r => {
      if (!voltageByVin.has(r.VIN)) voltageByVin.set(r.VIN, []);
      voltageByVin.get(r.VIN).push({
        time: new Date(r.CREATION_TIME).getTime(),
        voltage: parseFloat(r.VOLTAGE),
        dateStr: r.CREATION_TIME
      });
    });

    const result = [];

    vins.forEach(v => {
      const cp7Ms = cp7Map.get(v) || null;
      const tladasMs = tladasMap.get(v) || null;
      const cp8Ms = cp8Map.get(v) || null;
      const checks = voltageByVin.get(v) || [];
      const info = infoMap.get(v) || {};

      // --- 1. CP7 (NG < 12.6, верхней границы нет) ---
      let cp7Val = null, cp7Ok = null;
      if (cp7Ms) {
        const inWindow = checks.filter(c => Math.abs(c.time - cp7Ms) <= 10 * 60 * 1000);
        const check = inWindow.length ? inWindow[0] : (checks.length ? checks[0] : null);
        if (check) {
          cp7Val = check.voltage;
          cp7Ok = cp7Val >= 12.6; // ИЗМЕНЕНО
        }
      }

      // --- 2. TLADAS (NG < 12.6, верхней границы нет) ---
      let tladasVal = null, tladasOk = null, tladasStatus = null;
      if (tladasMs) {
        if (cp7Ms) {
          const diff = tladasMs - cp7Ms;
          tladasStatus = (diff <= 60 * 60 * 1000) ? 'under1h' : 'over1h';
        } else {
          tladasStatus = 'over1h';
        }

        const inWindow = checks.filter(c => Math.abs(c.time - tladasMs) <= 10 * 60 * 1000);
        const check = inWindow.length ? inWindow[inWindow.length - 1] : (checks.length ? checks[checks.length - 1] : null);
        if (check) {
          tladasVal = check.voltage;
          tladasOk = tladasVal >= 12.6; // ИЗМЕНЕНО
        }
      }

      // --- 3. CP8 (ОСТАЕТСЯ БЕЗ ИЗМЕНЕНИЙ, с верхней границей 13.0) ---
      let cp8Val = null, cp8Ok = null;
      if (cp8Ms) {
        const validOk = checks.filter(c => c.voltage >= 12.6 && c.voltage <= 13);
        const validNok = checks.filter(c => c.voltage < 12.6 || c.voltage > 13);
        
        const lastOk = validOk.length ? validOk[validOk.length - 1] : null;
        const lastNok = validNok.length ? validNok[validNok.length - 1] : null;

        const tenMinBeforeCp8 = cp8Ms - 10 * 60 * 1000;
        const cond1 = !lastOk || lastOk.time < tenMinBeforeCp8;
        const cond2 = lastNok && lastNok.time > cp8Ms;

        cp8Ok = (cond1 || cond2) ? false : true;

        const inWindow = checks.filter(c => Math.abs(c.time - cp8Ms) <= 10 * 60 * 1000);
        let closestCheck = null;
        if (inWindow.length > 0) {
          closestCheck = inWindow.reduce((prev, curr) => (Math.abs(curr.time - cp8Ms) < Math.abs(prev.time - cp8Ms) ? curr : prev), inWindow[0]);
        } else {
          closestCheck = checks.length ? checks[checks.length - 1] : null;
        }
        cp8Val = closestCheck ? closestCheck.voltage : null;
      }

      result.push({
        VIN: v,
        MODEL: info.model || '—',
        COMPLECTATION: info.complectation || '—',
        CP7_DATE: cp7Ms ? new Date(cp7Ms).toISOString() : null,
        CP7_VOLTAGE: cp7Val,
        CP7_OK: cp7Ok,
        TLADAS_DATE: tladasMs ? new Date(tladasMs).toISOString() : null,
        TLADAS_VOLTAGE: tladasVal,
        TLADAS_OK: tladasOk,
        TLADAS_STATUS: tladasStatus,
        CP8_DATE: cp8Ms ? new Date(cp8Ms).toISOString() : null,
        CP8_VOLTAGE: cp8Val,
        CP8_OK: cp8Ok,
      });
    });

    res.json(result);
  } catch (err) {
    console.error('Ошибка voltage-spc-checkpoints-dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* 4. История замеров (Модалка по клику на VIN)                           */
/* ====================================================================== */
app.get('/api/voltage-spc-vin-history', async (req, res) => {
  try {
    const { vin } = req.query;
    if (!vin) return res.status(400).json({ error: 'Параметр vin обязателен' });

    const [rows] = await pool.query(`
      SELECT 
        CAST(REPLACE(d.ITEMVALUE, ',', '.') AS DECIMAL(10,2)) AS VOLTAGE,
        d.CREATION_TIME,
        i.TYPE,
        i.RESULT
      FROM at_im_electrical_check_dtl d
      JOIN at_im_electrical_check_info i ON i.ID = d.MAIN_ID
      WHERE d.ITEMNAME = 'VehicleDataDetail-EMS-Battery_Voltage'
        AND i.VIN = ?
      ORDER BY d.CREATION_TIME DESC
    `, [vin]);

    res.json(rows);
  } catch (err) {
    console.error('Ошибка /api/voltage-spc-vin-history:', err.message);
    res.status(500).json({ error: err.message });
  }
});




/* ====================================================================== */
/* ===================== REP ELEC REPORT ================================ */
/* ====================================================================== */

// Хелпер: безопасный расчет номера недели
function getWeekNumberForDate(dateStr) {
  const cleanDate = String(dateStr).split('T')[0];
  const d = new Date(cleanDate + 'T12:00:00Z');
  if (isNaN(d.getTime())) return 0;
  
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}

// Хелпер: определение смены по времени CP72 (с учетом ротации недель)
function getShiftInfoByDate(dateStr) {
  const d = new Date(dateStr);
  const moscow = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const mins = moscow.getUTCHours() * 60 + moscow.getUTCMinutes();

  let shiftType;
  let shiftDate = new Date(moscow);
  if (mins >= 7 * 60 + 50 && mins <= 16 * 60 + 40) {
    shiftType = 'day';
  } else if (mins >= 16 * 60 + 41 || mins <= 1 * 60 + 30) {
    shiftType = 'evening';
    if (mins <= 1 * 60 + 30) shiftDate.setUTCDate(shiftDate.getUTCDate() - 1);
  } else {
    shiftType = 'night';
  }

  const tmp = new Date(Date.UTC(shiftDate.getUTCFullYear(), shiftDate.getUTCMonth(), shiftDate.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  const isEven = weekNumber % 2 === 0;

  if (shiftType === 'night') return 'C';
  if (shiftType === 'day') return isEven ? 'B' : 'A';
  return isEven ? 'A' : 'B';
}

// Хелпер: генерация периодов для графика
function buildReelecPeriods({ period, count, fromDate, toDate, baseDate }) {
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = baseDate ? new Date(baseDate) : new Date(); 

  if (fromDate && toDate) {
    const out = [];
    const start = new Date(fromDate + 'T00:00:00');
    const end = new Date(toDate + 'T00:00:00');
    if (isNaN(start) || isNaN(end) || start > end) return [];
    const cur = new Date(start);
    while (cur <= end) {
      const ds = fmt(cur);
      out.push({ type: 'day', label: ds, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  if (period === 'all') {
    const months = [], weeks = [], days = [];
    const curM = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < 3; i++) {
      const s = new Date(curM.getFullYear(), curM.getMonth() - i, 1);
      const e = new Date(curM.getFullYear(), curM.getMonth() - i + 1, 0);
      months.push({
        type: 'month',
        label: `${s.toLocaleString('en-US', { month: 'short' })} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`, endDate: `${fmt(e)} 23:59:59`,
      });
    }
    months.reverse();

    const curW = new Date(now);
    curW.setDate(curW.getDate() - ((curW.getDay() + 6) % 7));
    for (let i = 0; i < 4; i++) {
      const s = new Date(curW); s.setDate(s.getDate() - i * 7);
      const e = new Date(s); e.setDate(e.getDate() + 6);
      weeks.push({
        type: 'week',
        label: `W${getWeekNumberForDate(fmt(s))} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`, endDate: `${fmt(e)} 23:59:59`,
      });
    }
    weeks.reverse();

    for (let i = 0; i < 14; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const ds = fmt(d);
      days.push({ type: 'day', label: `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
    }
    days.reverse();

    return [...months, ...weeks, ...days];
  }

  const n = Math.max(1, Math.min(parseInt(count, 10) || 3, 50));
  const out = [];
  const cur = new Date(now);

  if (period === 'year') {
    for (let i = 0; i < n; i++) {
      const y = cur.getFullYear() - i;
      out.push({ type: 'year', label: String(y), startDate: `${y}-01-01 00:00:00`, endDate: `${y}-12-31 23:59:59` });
    }
  } else if (period === 'month') {
    for (let i = 0; i < n; i++) {
      const s = new Date(cur.getFullYear(), cur.getMonth() - i, 1);
      const e = new Date(cur.getFullYear(), cur.getMonth() - i + 1, 0);
      out.push({
        type: 'month',
        label: `${s.toLocaleString('en-US', { month: 'short' })} ${String(s.getFullYear()).slice(-2)}`,
        startDate: `${fmt(s)} 00:00:00`, endDate: `${fmt(e)} 23:59:59`,
      });
    }
  } else if (period === 'week') {
    const startW = new Date(cur);
    startW.setDate(startW.getDate() - ((startW.getDay() + 6) % 7));
    for (let i = 0; i < n; i++) {
      const s = new Date(startW); s.setDate(s.getDate() - i * 7);
      const e = new Date(s); e.setDate(e.getDate() + 6);
      out.push({
        type: 'week',
        label: `W${getWeekNumberForDate(fmt(s))} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`, endDate: `${fmt(e)} 23:59:59`,
      });
    }
  } else {
    for (let i = 0; i < n; i++) {
      const d = new Date(cur); d.setDate(d.getDate() - i);
      const ds = fmt(d);
      out.push({ type: 'day', label: `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
    }
  }
  return out.reverse();
}

// =======================================================================
// ЭНДПОИНТ 1: Данные для графика
// =======================================================================
app.get('/api/repelec-report', async (req, res) => {
  try {
    const { period = 'all', count = 3, fromDate, toDate } = req.query;

    const [maxDateRows] = await mesPool.query(`
      SELECT MAX(gmt_create) AS max_time 
      FROM tm_vhc_test_line_movement 
      WHERE node_nature = 'REPELEC' AND (is_deleted = 0 OR is_deleted IS NULL)
    `);
    
    let baseDate = maxDateRows[0]?.max_time ? new Date(maxDateRows[0].max_time) : new Date();
    const periods = buildReelecPeriods({ period, count, fromDate, toDate, baseDate: baseDate.toISOString() });
    
    if (periods.length === 0) return res.json({ dataPoints: [] });

    const ALL_MODELS = ['ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];
    const dataPoints = [];

    for (const p of periods) {
      // Формируем границы для поиска CP72 (с учетом смен: с 01:31 текущего дня до 01:30 следующего)
      const sDate = p.startDate.split(' ')[0];
      const eDate = p.endDate.split(' ')[0];
      const endDateObj = new Date(eDate + 'T00:00:00');
      endDateObj.setDate(endDateObj.getDate() + 1);
      const eDateNext = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, '0')}-${String(endDateObj.getDate()).padStart(2, '0')}`;

      const [cp72Rows] = await mesPool.query(`
        SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
        FROM ti_mes_movement
        WHERE uloc_no = 'CP72' AND (is_deleted = 0 OR is_deleted IS NULL)
          AND scan_time >= ? AND scan_time <= ?
        GROUP BY vin
      `, [`${sDate} 01:31:00`, `${eDateNext} 01:30:00`]);

      const vins = cp72Rows.map(r => r.VIN);
      const point = { type: p.type, label: p.label, startDate: p.startDate, endDate: p.endDate, shiftA: 0, shiftB: 0, total: 0 };
      ALL_MODELS.forEach(m => { point[`${m}_A`] = 0; point[`${m}_B`] = 0; });

      if (vins.length > 0) {
        const ph = vins.map(() => '?').join(',');
        
        // Проверяем, есть ли эти машины в REPELEC
        const [repelecRows] = await mesPool.query(`
          SELECT DISTINCT UPPER(vin) AS VIN
          FROM tm_vhc_test_line_movement
          WHERE node_nature = 'REPELEC' AND (is_deleted = 0 OR is_deleted IS NULL) AND vin IN (${ph})
        `, [...vins]);
        const hasRepelec = new Set(repelecRows.map(r => r.VIN));

        // Модели
        const [modelRows] = await pool.query(`SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})`, vins);
        const modelMap = new Map(modelRows.map(r => [r.VIN, r.MODEL]));

        cp72Rows.forEach(r => {
          if (!hasRepelec.has(r.VIN)) return; // Если нет в REPELEC, не считаем

          const shiftLetter = getShiftInfoByDate(r.CP72_TIME); 
          const model = modelMap.get(r.VIN) || 'UNKNOWN';

          if (shiftLetter === 'A') {
            point.shiftA++;
            if (point[`${model}_A`] !== undefined) point[`${model}_A`]++;
          } else if (shiftLetter === 'B') {
            point.shiftB++;
            if (point[`${model}_B`] !== undefined) point[`${model}_B`]++;
          }
        });
      }
      point.total = point.shiftA + point.shiftB;
      dataPoints.push(point);
    }
    res.json({ dataPoints });
  } catch (err) {
    console.error('Ошибка /api/repelec-report:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================================
// ЭНДПОИНТ 2: Детализация модального окна
// =======================================================================
app.get('/api/repelec-vins', async (req, res) => {
  try {
    const { dateFrom, dateTo, shift, model } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom, dateTo обязательны' });

    const sDate = dateFrom.split(' ')[0];
    const eDate = dateTo.split(' ')[0];
    const endDateObj = new Date(eDate + 'T00:00:00');
    endDateObj.setDate(endDateObj.getDate() + 1);
    const eDateNext = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, '0')}-${String(endDateObj.getDate()).padStart(2, '0')}`;

    // 1. Ищем машины с CP72 за этот период
    const [cp72Rows] = await mesPool.query(`
      SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72' AND (is_deleted = 0 OR is_deleted IS NULL)
        AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [`${sDate} 01:31:00`, `${eDateNext} 01:30:00`]);

    if (cp72Rows.length === 0) return res.json([]);
    let vins = cp72Rows.map(r => r.VIN);
    const cp72Map = new Map(cp72Rows.map(r => [r.VIN, r.CP72_TIME]));
    const ph = vins.map(() => '?').join(',');

    // 2. Проверяем наличие в REPELEC
    const [repelecRows] = await mesPool.query(`
      SELECT UPPER(vin) AS VIN, MIN(gmt_create) AS REPELEC_TIME
      FROM tm_vhc_test_line_movement
      WHERE node_nature = 'REPELEC' AND (is_deleted = 0 OR is_deleted IS NULL)
        AND vin IN (${ph})
      GROUP BY vin
    `, [...vins]);
    const repelecMap = new Map(repelecRows.map(r => [r.VIN, r.REPELEC_TIME]));

    // 3. Модели
    const [modelRows] = await pool.query(`SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})`, vins);
    const modelMap = new Map(modelRows.map(r => [r.VIN, r.MODEL || '—']));

    // 4. Фильтрация
    let filteredVins = [];
    vins.forEach(v => {
      if (!repelecMap.has(v)) return;
      const cp72Time = cp72Map.get(v);
      const shiftLetter = getShiftInfoByDate(cp72Time);
      if (shiftLetter !== shift) return;
      const vModel = modelMap.get(v) || '—';
      if (model && model !== 'ALL' && vModel !== model) return;
      filteredVins.push(v);
    });

    if (filteredVins.length === 0) return res.json([]);
    const vinsPh = filteredVins.map(() => '?').join(',');

    // 5. Дефекты IOT
    const [defectRows] = await pool.query(`
      SELECT VIN, CREATION_TIME, PART_NAME, PROBLEM_TYPE, PROBLEM_DESCRIPTION, PROBLEM_REPLENISH, POST_NAME, MISS_PART
      FROM at_qm_defect_info 
      WHERE VIN IN (${vinsPh})
    `, filteredVins);

    const iotByVin = new Map();
    defectRows.forEach(r => {
      if (!iotByVin.has(r.VIN)) iotByVin.set(r.VIN, []);
      iotByVin.get(r.VIN).push({
        time: r.CREATION_TIME, part_name: r.PART_NAME || '—', problem_type: r.PROBLEM_TYPE || '—',
        description: r.PROBLEM_DESCRIPTION || '—', comment: r.PROBLEM_REPLENISH || '—',
        post: r.POST_NAME || '—', miss_part: r.MISS_PART || '—'
      });
    });

    // 6. Дефекты BMS (Добавлен DISTINCT для предотвращения дубликатов)
    let bmsDefectsRows = [];
    try {
      const [bmsRows] = await bmsPool.query(`
        SELECT DISTINCT UPPER(vin) AS VIN, test_station, module_name, result, fault_content 
        FROM qr_test_details 
        WHERE result != 'OK' AND vin IN (${vinsPh})
      `, filteredVins);
      bmsDefectsRows = bmsRows;
    } catch (bmsErr) {
      console.error('⚠️ Ошибка загрузки BMS:', bmsErr.message);
    }

    // 7. Заметки BMS из БД
    const [notesRows] = await notesPool.query(`
      SELECT vin, test_station, module_name, fault_content, note_text 
      FROM repelec_bms_notes WHERE vin IN (${vinsPh})
    `, filteredVins);
    
    const notesMap = new Map();
    notesRows.forEach(r => {
      const key = `${r.vin}|${r.test_station}|${r.module_name}|${r.fault_content}`;
      notesMap.set(key, r.note_text);
    });

    // 8. Сборка BMS с заметками
    const bmsByVin = new Map();
    bmsDefectsRows.forEach(r => {
      if (!bmsByVin.has(r.VIN)) bmsByVin.set(r.VIN, []);
      
      const key = `${r.VIN}|${r.test_station}|${r.module_name}|${r.fault_content}`;
      bmsByVin.get(r.VIN).push({
        test_station: r.test_station || '—',
        module_name: r.module_name || '—',
        result: r.result || '—',
        fault_content: r.fault_content || '—',
        note: notesMap.get(key) || '' // Привязываем заметку
      });
    });

    // 9. Итог
    const uniqueVins = [...new Set(filteredVins)];
    const result = uniqueVins.map(v => ({
      vin: v,
      model: modelMap.get(v) || '—',
      repelec_time: repelecMap.get(v),
      cp72_time: cp72Map.get(v) || null,
      iot_defects: iotByVin.get(v) || [],
      bms_defects: bmsByVin.get(v) || []
    }));

    result.sort((a, b) => new Date(a.repelec_time) - new Date(b.repelec_time));
    res.json(result);

  } catch (err) {
    console.error('Ошибка /api/repelec-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Сохранение заметки к конкретному дефекту BMS
app.post('/api/repelec-bms-notes', async (req, res) => {
  try {
    const { vin, test_station, module_name, fault_content, note } = req.body;
    if (!vin || !test_station || !module_name || !fault_content) {
      return res.status(400).json({ error: 'Не все обязательные поля переданы' });
    }
    
    await notesPool.query(`
      INSERT INTO repelec_bms_notes (vin, test_station, module_name, fault_content, note_text) 
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE note_text = VALUES(note_text)
    `, [vin, test_station, module_name, fault_content, note || '']);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения заметки BMS:', err);
    res.status(500).json({ error: err.message });
  }
});


/* ====================================================================== */
/* ===================== BMS DYNAMICS (CP7 / FLASH) ===================== */
/* ====================================================================== */

// Колонка времени в BMS (varchar)
const BMS_TIME_COLUMN = 'create_time';

// Хелпер для генерации периодов (День/Неделя/Месяц)
function buildReelecPeriods({ period, count, fromDate, toDate, baseDate }) {
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = baseDate ? new Date(baseDate) : new Date(); 

  // Если задан кастомный диапазон
  if (fromDate && toDate) {
    const out = [];
    const start = new Date(fromDate + 'T00:00:00');
    const end = new Date(toDate + 'T00:00:00');
    if (isNaN(start) || isNaN(end) || start > end) return [];
    const cur = new Date(start);
    while (cur <= end) {
      const ds = fmt(cur);
      out.push({ type: 'day', label: ds, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  // Если период "все" (3 месяца, 4 недели, 14 дней)
  if (period === 'all') {
    const months = [], weeks = [], days = [];
    const curM = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < 3; i++) {
      const s = new Date(curM.getFullYear(), curM.getMonth() - i, 1);
      const e = new Date(curM.getFullYear(), curM.getMonth() - i + 1, 0);
      months.push({
        type: 'month',
        label: `${s.toLocaleString('en-US', { month: 'short' })} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`, endDate: `${fmt(e)} 23:59:59`,
      });
    }
    months.reverse();

    const curW = new Date(now);
    curW.setDate(curW.getDate() - ((curW.getDay() + 6) % 7));
    for (let i = 0; i < 4; i++) {
      const s = new Date(curW); s.setDate(s.getDate() - i * 7);
      const e = new Date(s); e.setDate(e.getDate() + 6);
      weeks.push({
        type: 'week',
        label: `W${Math.ceil((((s - new Date(s.getFullYear(), 0, 1)) / 86400000) + 1) / 7)} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`, endDate: `${fmt(e)} 23:59:59`,
      });
    }
    weeks.reverse();

    for (let i = 0; i < 14; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const ds = fmt(d);
      days.push({ type: 'day', label: `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
    }
    days.reverse();

    return [...months, ...weeks, ...days];
  }

  // Стандартные периоды (Неделя, Месяц)
  const n = Math.max(1, Math.min(parseInt(count, 10) || 3, 50));
  const out = [];
  const cur = new Date(now);

  if (period === 'month') {
    for (let i = 0; i < n; i++) {
      const s = new Date(cur.getFullYear(), cur.getMonth() - i, 1);
      const e = new Date(cur.getFullYear(), cur.getMonth() - i + 1, 0);
      out.push({
        type: 'month',
        label: `${s.toLocaleString('en-US', { month: 'short' })} ${String(s.getFullYear()).slice(-2)}`,
        startDate: `${fmt(s)} 00:00:00`, endDate: `${fmt(e)} 23:59:59`,
      });
    }
  } else if (period === 'week') {
    const startW = new Date(cur);
    startW.setDate(startW.getDate() - ((startW.getDay() + 6) % 7));
    for (let i = 0; i < n; i++) {
      const s = new Date(startW); s.setDate(s.getDate() - i * 7);
      const e = new Date(s); e.setDate(e.getDate() + 6);
      out.push({
        type: 'week',
        label: `W${Math.ceil((((s - new Date(s.getFullYear(), 0, 1)) / 86400000) + 1) / 7)} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`, endDate: `${fmt(e)} 23:59:59`,
      });
    }
  } else {
    for (let i = 0; i < n; i++) {
      const d = new Date(cur); d.setDate(d.getDate() - i);
      const ds = fmt(d);
      out.push({ type: 'day', label: `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
    }
  }
  return out.reverse();
}


/* ---------------------------------------------------------------------- */
/* 1. ГРАФИКИ (Composed Chart: Машины, Дефекты, %)                        */
/* ---------------------------------------------------------------------- */
app.get('/api/bms-dynamics-chart', async (req, res) => {
  try {
    const { period = 'week', count = 7, fromDate, toDate } = req.query;

    // Берем максимальную дату из BMS для базы расчета
    const [maxDateRows] = await bmsPool.query(`SELECT MAX(${BMS_TIME_COLUMN}) AS max_time FROM qr_test_details`);
    let baseDate = maxDateRows[0]?.max_time ? new Date(maxDateRows[0].max_time) : new Date();
    
    // Генерируем периоды
    const periods = buildReelecPeriods({ period, count, fromDate, toDate, baseDate: baseDate.toISOString() });
    const models = ['ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];
    
    const result = { general: [], models: {} };
    models.forEach(m => { result.models[m] = []; });

    for (const p of periods) {
      // Ищем только станции CP7 и Flash
      const [bmsRows] = await bmsPool.query(`
        SELECT UPPER(vin) AS VIN, result 
        FROM qr_test_details
        WHERE (test_station LIKE '%CP7%' OR test_station LIKE '%Flash%')
          AND ${BMS_TIME_COLUMN} >= ? AND ${BMS_TIME_COLUMN} <= ?
      `, [p.startDate, p.endDate]);

      const uniqueVins = [...new Set(bmsRows.map(r => r.VIN))];
      let modelMap = {};
      if (uniqueVins.length > 0) {
        const ph = uniqueVins.map(() => '?').join(',');
        const [wRows] = await pool.query(`SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})`, uniqueVins);
        wRows.forEach(r => modelMap[r.VIN] = r.MODEL);
      }

      // Статистика: 1 NOK = 1 Машина
      const stats = {
        totalVins: new Set(),
        nokVins: new Set(),
        modelStats: {}
      };
      models.forEach(m => { stats.modelStats[m] = { totalVins: new Set(), nokVins: new Set() }; });

      bmsRows.forEach(r => {
        const isNok = r.result && r.result.toUpperCase() !== 'OK';
        const vin = r.VIN;
        const vModel = modelMap[vin] || 'UNKNOWN';

        stats.totalVins.add(vin);
        if (isNok) stats.nokVins.add(vin);

        if (stats.modelStats[vModel]) {
          stats.modelStats[vModel].totalVins.add(vin);
          if (isNok) stats.modelStats[vModel].nokVins.add(vin);
        }
      });

      // Общая точка
      result.general.push({
        label: p.label,
        machines: stats.totalVins.size,
        defects: stats.nokVins.size,
        percent: stats.totalVins.size > 0 ? Number(((stats.nokVins.size / stats.totalVins.size) * 100).toFixed(1)) : 0
      });

      // Точки по моделям
      models.forEach(m => {
        const mStats = stats.modelStats[m];
        result.models[m].push({
          label: p.label,
          machines: mStats.totalVins.size,
          defects: mStats.nokVins.size,
          percent: mStats.totalVins.size > 0 ? Number(((mStats.nokVins.size / mStats.totalVins.size) * 100).toFixed(1)) : 0
        });
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Ошибка bms-dynamics-chart:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* 2. ТАБЛИЦА NOK VIN'ОВ (С возможностью писать комменты)                 */
/* ---------------------------------------------------------------------- */
app.get('/api/bms-cp7-nok-vins', async (req, res) => {
  try {
    const { dateFrom, dateTo, model } = req.query;

    // 1. Получаем все NOK детали по CP7/Flash
    const [rows] = await bmsPool.query(`
      SELECT UPPER(vin) AS VIN, test_station, module_name, fault_content, ${BMS_TIME_COLUMN} AS event_time
      FROM qr_test_details
      WHERE (test_station LIKE '%CP7%' OR test_station LIKE '%Flash%')
        AND result != 'OK' 
        AND ${BMS_TIME_COLUMN} >= ? AND ${BMS_TIME_COLUMN} <= ?
    `, [dateFrom, dateTo]);

    if (rows.length === 0) return res.json([]);

    const uniqueVins = [...new Set(rows.map(r => r.VIN))];
    const ph = uniqueVins.map(() => '?').join(',');

    // 2. Модели
    const [wRows] = await pool.query(`SELECT VIN, MODEL FROM work_order WHERE VIN IN (${ph})`, uniqueVins);
    const modelMap = new Map(wRows.map(r => [r.VIN, r.MODEL]));

    // 3. Существующие заметки (сохраняем в той же таблице, что и REPELEC)
    const [notesRows] = await notesPool.query(`
      SELECT vin, test_station, module_name, fault_content, note_text 
      FROM repelec_bms_notes WHERE vin IN (${ph})
    `, uniqueVins);
    const notesMap = new Map();
    notesRows.forEach(r => {
      notesMap.set(`${r.vin}|${r.test_station}|${r.module_name}|${r.fault_content}`, r.note_text);
    });

    // 4. Сборка с удалением дублей
    const uniqueMap = new Map();
    rows.forEach(r => {
      const key = `${r.VIN}|${r.test_station}|${r.module_name}|${r.fault_content}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          vin: r.VIN,
          model: modelMap.get(r.VIN) || '—',
          test_station: r.test_station,
          module_name: r.module_name,
          fault_content: r.fault_content,
          created_at: r.event_time, // Отдаем как created_at для фронта
          note: notesMap.get(key) || ''
        });
      }
    });

    let result = Array.from(uniqueMap.values());
    if (model && model !== 'ALL') {
      result = result.filter(r => r.model === model);
    }

    res.json(result);
  } catch (err) {
    console.error('Ошибка bms-cp7-nok-vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. ТОП ПОВТОРЕНИЙ ОШИБОК (Модуль + Ошибка)
app.get('/api/bms-top-errors', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const [rows] = await bmsPool.query(`
      SELECT 
        module_name,
        fault_content,
        COUNT(DISTINCT vin) as defect_count
      FROM qr_test_details
      WHERE (test_station LIKE '%CP7%' OR test_station LIKE '%Flash%')
        AND result != 'OK'
        AND ${BMS_TIME_COLUMN} >= ? AND ${BMS_TIME_COLUMN} <= ?
      GROUP BY module_name, fault_content
      ORDER BY defect_count DESC
      LIMIT 15
    `, [dateFrom, dateTo]);

    // Считаем общее количество уникальных VIN с ошибками для расчета процента
    const [totalRows] = await bmsPool.query(`
      SELECT COUNT(DISTINCT vin) as total
      FROM qr_test_details
      WHERE (test_station LIKE '%CP7%' OR test_station LIKE '%Flash%')
        AND result != 'OK'
        AND ${BMS_TIME_COLUMN} >= ? AND ${BMS_TIME_COLUMN} <= ?
    `, [dateFrom, dateTo]);
    
    const totalNokVins = totalRows[0]?.total || 1;

    const result = rows.map(r => ({
      module_name: r.module_name || '—',
      fault_content: r.fault_content || '—',
      defect_count: Number(r.defect_count),
      percent: Number(((r.defect_count / totalNokVins) * 100).toFixed(1))
    }));

    res.json(result);
  } catch (err) {
    console.error('Ошибка bms-top-errors:', err.message);
    res.status(500).json({ error: err.message });
  }
});


/* ====================================================================== */
/* ================== DRR ELECTRONICS (BMS) ============================= */
/* ====================================================================== */

// 1. Главный дашборд (Ватрушка)
app.get('/api/drr-electronics-bms-dashboard', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const sTime = startTime || `${todayStr} 00:00:00`;
    const eTime = endTime || `${todayStr} 23:59:59`;

    // 1. Прошли CP72 (из MES)
    const [cp72Rows] = await mesPool.query(`
      SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72'
        AND is_deleted = 0
        AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [sTime, eTime]);

    const totalVins = cp72Rows.length;
    const cp72Map = new Map(cp72Rows.map(r => [r.VIN, r.CP72_TIME]));

    if (totalVins === 0) {
      return res.json({ totalVins: 0, closedVins: 0, nokVins: 0, drrPercent: 0 });
    }

    const vins = cp72Rows.map(r => r.VIN);
    const ph = vins.map(() => '?').join(',');

    // 2. Последний ОК по трем станциям (CP7, Flash, ERA Write Vin) из BMS
    const [bmsOkRows] = await bmsPool.query(`
      SELECT UPPER(vin) AS VIN, MAX(test_time) AS MAX_OK_TIME
      FROM qr_test_result
      WHERE result = 'OK'
        AND test_station IN ('CP7', 'Flash', 'ERA Write Vin')
        AND vin IN (${ph})
      GROUP BY vin
      HAVING COUNT(DISTINCT test_station) = 3
    `, vins);

    const okSet = new Set();
    bmsOkRows.forEach(row => {
      const cp72TimeStr = cp72Map.get(row.VIN);
      if (!cp72TimeStr) return;

      const cp72Ms = new Date(cp72TimeStr).getTime();
      const okMs = new Date(row.MAX_OK_TIME).getTime();

      // Условие: CP72 + 5 минут > последний ОК
      if (cp72Ms + 5 * 60 * 1000 > okMs) {
        okSet.add(row.VIN);
      }
    });

    const closedVins = okSet.size;
    const nokVins = totalVins - closedVins;
    const drrPercent = totalVins > 0 ? (closedVins / totalVins) * 100 : 0;

    res.json({
      totalVins,
      closedVins,
      nokVins,
      drrPercent: Math.round(drrPercent * 10) / 10,
    });
  } catch (err) {
    console.error('❌ Ошибка DRR Electronics Dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. Топ дефектов (ТОЛЬКО ПО NOK АВТО)
app.get('/api/drr-electronics-bms-top-defects', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const sTime = startTime || `${todayStr} 00:00:00`;
    const eTime = endTime || `${todayStr} 23:59:59`;

    // 1. Получаем NOK VIN'ы (та же логика, что и в дашборде)
    const [cp72Rows] = await mesPool.query(`
      SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72' AND is_deleted = 0 AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [sTime, eTime]);

    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.VIN);
    const cp72Map = new Map(cp72Rows.map(r => [r.VIN, new Date(r.CP72_TIME).getTime()]));
    const ph = vins.map(() => '?').join(',');

    const [bmsOkRows] = await bmsPool.query(`
      SELECT UPPER(vin) AS VIN, MAX(test_time) AS MAX_OK_TIME
      FROM qr_test_result
      WHERE result = 'OK' AND test_station IN ('CP7', 'Flash', 'ERA Write Vin') AND vin IN (${ph})
      GROUP BY vin
      HAVING COUNT(DISTINCT test_station) = 3
    `, vins);

    const okSet = new Set();
    bmsOkRows.forEach(row => {
      const cp72Ms = cp72Map.get(row.VIN);
      if (cp72Ms && (cp72Ms + 5 * 60 * 1000 > new Date(row.MAX_OK_TIME).getTime())) {
        okSet.add(row.VIN);
      }
    });

    const nokVins = vins.filter(v => !okSet.has(v));
    if (nokVins.length === 0) return res.json([]);

    // 2. Ищем дефекты ТОЛЬКО у этих NOK VIN'ов
    const nokPh = nokVins.map(() => '?').join(',');
    const [rows] = await bmsPool.query(`
      SELECT 
        test_station, 
        module_name, 
        COUNT(DISTINCT vin) AS defectCount
      FROM qr_test_details
      WHERE test_time >= ? AND test_time <= ?
        AND vin IN (${nokPh})
        AND result != 'OK'
        AND test_station NOT LIKE 'R%' 
        AND test_station NOT LIKE 'CP8%'
      GROUP BY test_station, module_name
      ORDER BY defectCount DESC
      LIMIT 50
    `, [sTime, eTime, ...nokVins]);

    res.json(rows);
  } catch (err) {
    console.error('❌ Ошибка DRR Electronics Top Defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. Детализация по MPP (с показом времени и фильтрацией по NOK)
app.get('/api/drr-electronics-bms-mpp-vins', async (req, res) => {
  try {
    const { startTime, endTime, test_station, module_name } = req.query;

    if (!startTime || !endTime || !test_station || !module_name) {
      return res.status(400).json({ error: 'Недостаточно параметров для детализации' });
    }

    // 1. Получаем машины, прошедшие CP72 (из MES)
    const [cp72Rows] = await mesPool.query(`
      SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72' AND is_deleted = 0 
        AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [startTime, endTime]);

    if (cp72Rows.length === 0) return res.json([]);

    const vins = cp72Rows.map(r => r.VIN);
    // Сохраняем время CP72 в миллисекундах для точного сравнения
    const cp72Map = new Map(cp72Rows.map(r => [r.VIN, new Date(r.CP72_TIME).getTime()]));
    const ph = vins.map(() => '?').join(',');

    // 2. Вычисляем NOK VIN'ы (только те, у кого нет всех 3-х ОК или они старые)
    const [bmsOkRows] = await bmsPool.query(`
      SELECT UPPER(vin) AS VIN, MAX(test_time) AS MAX_OK_TIME
      FROM qr_test_result
      WHERE result = 'OK' AND test_station IN ('CP7', 'Flash', 'ERA Write Vin') AND vin IN (${ph})
      GROUP BY vin
      HAVING COUNT(DISTINCT test_station) = 3
    `, vins);

    const okSet = new Set();
    bmsOkRows.forEach(row => {
      const cp72Ms = cp72Map.get(row.VIN);
      if (cp72Ms && (cp72Ms + 5 * 60 * 1000 > new Date(row.MAX_OK_TIME).getTime())) {
        okSet.add(row.VIN);
      }
    });

    const nokVins = vins.filter(v => !okSet.has(v));
    if (nokVins.length === 0) return res.json([]);

    const nokPh = nokVins.map(() => '?').join(',');

    // 3. Получаем ошибки ТОЛЬКО для NOK VIN'ов
    const [defectRows] = await bmsPool.query(`
      SELECT 
        UPPER(vin) AS vin, 
        test_time, 
        fault_content
      FROM qr_test_details
      WHERE test_time >= ? AND test_time <= ?
        AND vin IN (${nokPh})
        AND result != 'OK'
        AND test_station = ? 
        AND module_name = ?
      ORDER BY test_time ASC
    `, [startTime, endTime, ...nokVins, test_station, module_name]);

    if (defectRows.length === 0) return res.json([]);

    const filteredVins = [...new Set(defectRows.map(r => r.vin))];
    const fPh = filteredVins.map(() => '?').join(',');

    // 4. Получаем время ПОСЛЕДНЕГО ОК для каждой из 3 станций отдельно (для этих NOK VIN)
    const [lastOkRows] = await bmsPool.query(`
      SELECT 
        UPPER(vin) AS VIN,
        MAX(CASE WHEN test_station = 'CP7' AND result = 'OK' THEN test_time END) AS CP7_OK,
        MAX(CASE WHEN test_station = 'Flash' AND result = 'OK' THEN test_time END) AS FLASH_OK,
        MAX(CASE WHEN test_station = 'ERA Write Vin' AND result = 'OK' THEN test_time END) AS ERA_OK
      FROM qr_test_result
      WHERE vin IN (${fPh}) 
        AND test_station IN ('CP7', 'Flash', 'ERA Write Vin')
      GROUP BY vin
    `, filteredVins);
    
    const lastOkMap = new Map(lastOkRows.map(r => [r.VIN, r]));

    // 5. Формируем ответ с расчетом порогового времени (CP72 + 5 мин)
    const result = defectRows.map(row => {
      const okData = lastOkMap.get(row.vin) || {};
      const cp72Ms = cp72Map.get(row.vin);
      
      // Вычисляем порог: CP72 + 5 минут
      const cp72Plus5m = cp72Ms ? new Date(cp72Ms + 5 * 60 * 1000).toISOString() : null;

      return {
        vin: row.vin,
        test_time: row.test_time,
        module_name: module_name,
        fault_content: row.fault_content || '—',
        cp72_time: cp72Ms ? new Date(cp72Ms).toISOString() : null,
        cp72_plus_5m: cp72Plus5m, 
        cp7_ok: okData.CP7_OK || null,
        flash_ok: okData.FLASH_OK || null,
        era_ok: okData.ERA_OK || null
      };
    });

    res.json(result);
  } catch (err) {
    console.error('❌ Ошибка DRR Electronics MPP Vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. Список VIN по OK/NG для модального окна
app.get('/api/drr-electronics-bms-vins', async (req, res) => {
  try {
    const { startTime, endTime, status } = req.query;
    if (!startTime || !endTime || !status) {
      return res.status(400).json({ error: 'Недостаточно параметров' });
    }

    const [cp72Rows] = await mesPool.query(`
      SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
      FROM ti_mes_movement
      WHERE uloc_no = 'CP72' AND is_deleted = 0 
        AND scan_time >= ? AND scan_time <= ?
      GROUP BY vin
    `, [startTime, endTime]);

    if (cp72Rows.length === 0) return res.json([]);
    
    const vins = cp72Rows.map(r => r.VIN);
    const cp72Map = new Map(cp72Rows.map(r => [r.VIN, r.CP72_TIME]));
    const ph = vins.map(() => '?').join(',');

    const [bmsOkRows] = await bmsPool.query(`
      SELECT UPPER(vin) AS VIN, MAX(test_time) AS MAX_OK_TIME
      FROM qr_test_result
      WHERE result = 'OK'
        AND test_station IN ('CP7', 'Flash', 'ERA Write Vin')
        AND vin IN (${ph})
      GROUP BY vin
      HAVING COUNT(DISTINCT test_station) = 3
    `, vins);

    const okSet = new Set();
    bmsOkRows.forEach(row => {
      const cp72TimeStr = cp72Map.get(row.VIN);
      if (!cp72TimeStr) return;
      const cp72Ms = new Date(cp72TimeStr).getTime();
      const okMs = new Date(row.MAX_OK_TIME).getTime();
      
      if (cp72Ms + 5 * 60 * 1000 > okMs) {
        okSet.add(row.VIN);
      }
    });

    const result = [];
    cp72Rows.forEach(row => {
      const isOk = okSet.has(row.VIN);
      if (status === 'OK' && isOk) {
        result.push({ vin: row.VIN, cp72_time: row.CP72_TIME });
      } else if (status === 'NOK' && !isOk) {
        result.push({ vin: row.VIN, cp72_time: row.CP72_TIME });
      }
    });

    result.sort((a, b) => new Date(a.cp72_time) - new Date(b.cp72_time));
    res.json(result);

  } catch (err) {
    console.error('❌ Ошибка DRR Electronics BMS Vins:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ====================================================================== */
/* ============== DRR ELECTRONICS — СНИМКИ СМЕН ========================= */
/* ====================================================================== */

// Хелпер: расчет DRR для снимка
async function calculateElectronicsDrr(startTime, endTime) {
  const [cp72Rows] = await mesPool.query(`
    SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
    FROM ti_mes_movement
    WHERE uloc_no = 'CP72' AND is_deleted = 0 AND scan_time >= ? AND scan_time <= ?
    GROUP BY vin
  `, [startTime, endTime]);

  const totalVins = cp72Rows.length;
  const cp72Map = new Map(cp72Rows.map(r => [r.VIN, r.CP72_TIME]));

  if (totalVins === 0) {
    return { totalVins: 0, closedVins: 0, nokVins: 0, drrPercent: 0 };
  }

  const vins = cp72Rows.map(r => r.VIN);
  const ph = vins.map(() => '?').join(',');

  const [bmsOkRows] = await bmsPool.query(`
    SELECT UPPER(vin) AS VIN, MAX(test_time) AS MAX_OK_TIME
    FROM qr_test_result
    WHERE result = 'OK' AND test_station IN ('CP7', 'Flash', 'ERA Write Vin') AND vin IN (${ph})
    GROUP BY vin
    HAVING COUNT(DISTINCT test_station) = 3
  `, vins);

  const okSet = new Set();
  bmsOkRows.forEach(row => {
    const cp72TimeStr = cp72Map.get(row.VIN);
    if (!cp72TimeStr) return;
    const cp72Ms = new Date(cp72TimeStr).getTime();
    const okMs = new Date(row.MAX_OK_TIME).getTime();
    if (cp72Ms + 5 * 60 * 1000 > okMs) {
      okSet.add(row.VIN);
    }
  });

  const closedVins = okSet.size;
  const nokVins = totalVins - closedVins;
  const drrPercent = totalVins > 0 ? Math.round((closedVins / totalVins) * 1000) / 10 : 0;

  return { totalVins, closedVins, nokVins, drrPercent };
}

// Хелпер: расчет топа дефектов для снимка
async function calculateElectronicsTopDefects(startTime, endTime, nokVins) {
  if (nokVins.length === 0) return [];
  
  const nokPh = nokVins.map(() => '?').join(',');
  const [rows] = await bmsPool.query(`
    SELECT 
      test_station, 
      module_name, 
      COUNT(DISTINCT vin) AS defectCount
    FROM qr_test_details
    WHERE test_time >= ? AND test_time <= ?
      AND vin IN (${nokPh})
      AND result != 'OK'
      AND test_station NOT LIKE 'R%' 
      AND test_station NOT LIKE 'CP8%'
    GROUP BY test_station, module_name
    ORDER BY defectCount DESC
    LIMIT 50
  `, [startTime, endTime, ...nokVins]);

  return rows;
}

// Функция сохранения снимка
async function saveDrrElectronicsSnapshot(shiftDate, shift) {
  try {
    // Используем функцию getShiftRangeCp7, так как логика смен идентична
    const range = getShiftRangeCp7(shiftDate, shift);
    if (!range) return;

    const weekNumber = getWeekNumberForDate(shiftDate);
    const shiftLetter = getShiftLetterForSnapshot(shift, weekNumber);

    // 1. Считаем DRR
    const dash = await calculateElectronicsDrr(range.start, range.end);
    
    // 2. Получаем список NOK VIN для топа дефектов
    let nokVins = [];
    if (dash.totalVins > 0) {
      const [cp72Rows] = await mesPool.query(`
        SELECT UPPER(vin) AS VIN, MIN(scan_time) AS CP72_TIME
        FROM ti_mes_movement WHERE uloc_no = 'CP72' AND is_deleted = 0 AND scan_time >= ? AND scan_time <= ? GROUP BY vin
      `, [range.start, range.end]);
      const cp72Map = new Map(cp72Rows.map(r => [r.VIN, r.CP72_TIME]));
      const vins = cp72Rows.map(r => r.VIN);
      const ph = vins.map(() => '?').join(',');
      
      const [bmsOkRows] = await bmsPool.query(`
        SELECT UPPER(vin) AS VIN, MAX(test_time) AS MAX_OK_TIME
        FROM qr_test_result WHERE result = 'OK' AND test_station IN ('CP7', 'Flash', 'ERA Write Vin') AND vin IN (${ph}) GROUP BY vin HAVING COUNT(DISTINCT test_station) = 3
      `, vins);

      const okSet = new Set();
      bmsOkRows.forEach(row => {
        const cp72Ms = new Date(cp72Map.get(row.VIN)).getTime();
        if (cp72Ms + 5 * 60 * 1000 > new Date(row.MAX_OK_TIME).getTime()) okSet.add(row.VIN);
      });
      nokVins = vins.filter(v => !okSet.has(v));
    }

    // 3. Считаем топ дефектов
    const topDefects = await calculateElectronicsTopDefects(range.start, range.end, nokVins);

    // 4. Сохраняем
    await notesPool.query(`
      INSERT INTO drr_electronics_snapshots
        (shift_date, week_number, shift, shift_letter, total_vins, closed_vins, nok_vins, drr_percent, top_defects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        snapshot_time = CURRENT_TIMESTAMP,
        week_number = VALUES(week_number),
        shift_letter = VALUES(shift_letter),
        total_vins = VALUES(total_vins),
        closed_vins = VALUES(closed_vins),
        nok_vins = VALUES(nok_vins),
        drr_percent = VALUES(drr_percent),
        top_defects = VALUES(top_defects)
    `, [shiftDate, weekNumber, shift, shiftLetter, dash.totalVins, dash.closedVins, dash.nokVins, dash.drrPercent, JSON.stringify(topDefects)]);

    console.log(`[DRR Electronics snapshot] ${shiftDate} W${weekNumber} ${shift}(${shiftLetter}) → ${dash.drrPercent}%`);
  } catch (err) {
    console.error('[DRR Electronics snapshot] ошибка сохранения:', err.message);
  }
}

// Проверка и сохранение
async function checkAndSaveDrrElectronicsSnapshot() {
  try {
    const { shiftDate, shift } = getLastCompletedShiftCp7();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_electronics_snapshots WHERE shift_date = ? AND shift = ?`,
      [shiftDate, shift]
    );
    if (Number(existing[0]?.cnt || 0) < 1) {
      await saveDrrElectronicsSnapshot(shiftDate, shift);
    }
  } catch (err) {
    console.error('[DRR Electronics snapshot] ошибка проверки смены:', err.message);
  }
}

async function checkAndSaveDrrElectronicsDailySnapshot() {
  try {
    const dayDate = getCompletedDayDate();
    const [existing] = await notesPool.query(
      `SELECT COUNT(*) AS cnt FROM drr_electronics_snapshots WHERE shift_date = ? AND shift = 'all'`,
      [dayDate]
    );
    if (Number(existing[0]?.cnt || 0) < 1) {
      await saveDrrElectronicsSnapshot(dayDate, 'all');
    }
  } catch (err) {
    console.error('[DRR Electronics snapshot] ошибка проверки суток:', err.message);
  }
}

setInterval(() => {
  checkAndSaveDrrElectronicsSnapshot();
  checkAndSaveDrrElectronicsDailySnapshot();
}, 60 * 1000);
checkAndSaveDrrElectronicsSnapshot();
checkAndSaveDrrElectronicsDailySnapshot();

// Эндпоинты для получения снимков
app.get('/api/drr-electronics-snapshots', async (req, res) => {
  try {
    const { days = 14 } = req.query;
    const limitDays = Math.min(parseInt(days, 10) || 14, 60);

    const [rows] = await notesPool.query(`
      SELECT id, shift_date, week_number, shift, shift_letter, snapshot_time,
             total_vins, closed_vins, nok_vins, drr_percent
      FROM drr_electronics_snapshots
      WHERE shift_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY shift_date DESC, FIELD(shift, 'all', 'evening', 'day', 'night')
    `, [limitDays]);

    const result = rows.map(r => {
      const shiftDate = String(r.shift_date).slice(0, 10);
      const weekNumber = r.week_number != null ? r.week_number : getWeekNumberForDate(shiftDate);
      const shiftLetter = r.shift_letter != null ? r.shift_letter : getShiftLetterForSnapshot(r.shift, weekNumber);
      return {
        id: r.id,
        shiftDate,
        weekNumber,
        shift: r.shift,
        shiftLetter,
        snapshotTime: r.snapshot_time,
        totalVins: r.total_vins,
        closedVins: r.closed_vins,
        nokVins: r.nok_vins,
        drrPercent: Number(r.drr_percent),
      };
    });
    res.json(result);
  } catch (err) {
    console.error('Ошибка /api/drr-electronics-snapshots:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drr-electronics-snapshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await notesPool.query('SELECT * FROM drr_electronics_snapshots WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Снимок не найден' });

    const r = rows[0];
    let topDefects = [];
    try {
      topDefects = r.top_defects ? (typeof r.top_defects === 'string' ? JSON.parse(r.top_defects) : r.top_defects) : [];
    } catch { topDefects = []; }

    const shiftDate = String(r.shift_date).slice(0, 10);
    const weekNumber = r.week_number != null ? r.week_number : getWeekNumberForDate(shiftDate);
    const shiftLetter = r.shift_letter != null ? r.shift_letter : getShiftLetterForSnapshot(r.shift, weekNumber);

    res.json({
      id: r.id,
      shiftDate,
      weekNumber,
      shift: r.shift,
      shiftLetter,
      snapshotTime: r.snapshot_time,
      totalVins: r.total_vins,
      closedVins: r.closed_vins,
      nokVins: r.nok_vins,
      drrPercent: Number(r.drr_percent),
      topDefects
    });
  } catch (err) {
    console.error('Ошибка /api/drr-electronics-snapshot/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});








/* ====================================================================== */
/* удалить ЭНДПОИНТ: /api/inspection-defects                                       */
/* Дефекты с «AGM» в описании, статус != PASS                              */
/* ====================================================================== */
app.get('/api/inspection-defects', async (req, res) => {
  try {
    const { vin, dateFrom, dateTo, recheckPerson, limit = 5000 } = req.query;

    const conditions = [
      `PROBLEM_DESCRIPTION LIKE '%AGM%'`,
      `(STATUS IS NULL OR UPPER(STATUS) <> 'PASS')`,
    ];
    const params = [];

    if (vin && String(vin).trim()) {
      conditions.push(`VIN LIKE ?`);
      params.push(`%${String(vin).trim()}%`);
    }

    if (dateFrom) {
      conditions.push(`CREATION_TIME >= ?`);
      params.push(`${dateFrom} 00:00:00`);
    }
    if (dateTo) {
      conditions.push(`CREATION_TIME <= ?`);
      params.push(`${dateTo} 23:59:59`);
    }

    if (recheckPerson && String(recheckPerson).trim()) {
      conditions.push(`COALESCE(RECHECK_PERSON, RECHECK_PERSON1) = ?`);
      params.push(String(recheckPerson).trim());
    }

    const where = conditions.join(' AND ');
    const lim = Math.min(parseInt(limit, 10) || 5000, 20000);

    const [rows] = await pool.query(`
      SELECT
        ID,
        VIN,
        PROBLEM_DESCRIPTION,
        CREATION_TIME,
        COALESCE(REPAIR_TIME,  REPAIR_TIME1)  AS REPAIR_TIME,
        COALESCE(REPAIR_PERSON, REPAIR_PERSON1) AS REPAIR_PERSON,
        COALESCE(REPAIR_ACCOUNT, REPAIR_ACCOUNT1) AS REPAIR_ACCOUNT,
        COALESCE(RECHECK_TIME,  RECHECK_TIME1)  AS RECHECK_TIME,
        COALESCE(RECHECK_PERSON, RECHECK_PERSON1) AS RECHECK_PERSON,
        COALESCE(RECHECK_ACCOUNT, RECHECK_ACCOUNT1) AS RECHECK_ACCOUNT,
        STATUS,
        POST_NAME,
        PROBLEM_GRADE
      FROM at_qm_defect_info
      WHERE ${where}
      ORDER BY CREATION_TIME DESC
      LIMIT ?
    `, [...params, lim]);

    res.json(rows);
  } catch (err) {
    console.error('Ошибка /api/inspection-defects:', err.message);
    res.status(500).json({ error: err.message });
  }
});







const PORT = process.env.PORT || 40000;

async function startServer() {
  console.log('--- Проверка подключений к БД ---');
  
  const dbOk = await checkDatabaseConnection();
  const lesOk = await checkLesDatabaseConnection();
  
  // Проверка BMS (выведет лог "✅ БД BMS (launch_db): Подключение успешно!")
  const bmsOk = await checkBmsDatabaseConnection(); 
  const notesOk = await checkNotesDatabaseConnection();

  // Если основная БД или LES недоступны — останавливаем сервер (как было)
  if (!dbOk || !lesOk) {
    console.log('Сервер НЕ запущен — основная БД или LES недоступны.');
    process.exit(1);
  }

  // Если хотите, чтобы сервер не стартовал без BMS, добавьте || !bmsOk в условие выше.
  if (!bmsOk) {
    console.log('⚠️  Внимание: БД BMS недоступна. Функции, зависящие от BMS, будут выдавать ошибку.');
  }

  if (!notesOk) {
    console.log('⚠️  БД заметок недоступна. Сервер стартует в деградированном режиме.');
    console.log('    Snapshot DRR, метки/фото смен и справочники включатся автоматически при восстановлении связи.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();