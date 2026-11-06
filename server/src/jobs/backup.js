// Ночная резервная копия своей БД (notes / mbs) и папки uploads/.
//
// Включается только если в .env задан BACKUP_DIR (папка на этом сервере или сетевая
// папка, например \\server\share\mbs-backup). Без него ничего не делается и не пишется.
//
//   BACKUP_DIR=D:\mbs-backup     — куда сохранять (обязательно для включения)
//   BACKUP_TIME=03:30            — время запуска (по часам сервера)
//   BACKUP_KEEP_DAYS=14          — сколько дней хранить копии БД
//   BACKUP_UPLOADS=true          — копировать ли фото (uploads/); false — не копировать
//
// Что получается в BACKUP_DIR:
//   mbs_2026-11-07_0330.sql   — все таблицы БД notes: структура и данные (обычный SQL,
//                               открывается/восстанавливается любым клиентом MySQL, напр. HeidiSQL)
//   uploads/                  — зеркало server/uploads (новые фото докопируются каждую ночь;
//                               фото, удалённые программой, удаляются из копии через BACKUP_KEEP_DAYS дней)
//
// БД только читается. Ошибки пишутся в лог и в /api/health, работу сервера они не прерывают.

const fs = require('fs');
const path = require('path');
const { notesPool } = require('../db');
const { SERVER_DIR } = require('../paths');

const DIR = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : null;
const TIME = /^\d{1,2}:\d{2}$/.test(process.env.BACKUP_TIME || '') ? process.env.BACKUP_TIME : '03:30';
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS) > 0 ? Number(process.env.BACKUP_KEEP_DAYS) : 14;
const WITH_UPLOADS = process.env.BACKUP_UPLOADS !== 'false';
const UPLOADS_DIR = path.join(SERVER_DIR, 'uploads');
const ROWS_PER_INSERT = 200;

const state = { running: false, lastRun: null, lastRunDate: null };

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function status() {
  if (!DIR) return { enabled: false, note: 'BACKUP_DIR не задан в .env' };
  return { enabled: true, dir: DIR, time: TIME, keepDays: KEEP_DAYS, uploads: WITH_UPLOADS, running: state.running, lastRun: state.lastRun };
}

// Значение для INSERT. JSON-столбцы mysql2 отдаёт объектами — их нужно сохранить как текст JSON.
function sqlValue(conn, v) {
  if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Date)) return conn.escape(JSON.stringify(v));
  return conn.escape(v);
}

function writeLine(out, text) {
  if (out.writeError) return Promise.reject(out.writeError);
  return out.write(text) ? Promise.resolve() : new Promise((resolve) => out.once('drain', resolve));
}

async function dumpTable(conn, out, table) {
  const [[create]] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
  await writeLine(out, `\n-- Таблица ${table}\nDROP TABLE IF EXISTS \`${table}\`;\n${create['Create Table']};\n`);
  let rows = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    await writeLine(out, `INSERT INTO \`${table}\` VALUES\n${batch.join(',\n')};\n`);
    batch = [];
  };
  // Строки читаются потоком, чтобы большие таблицы не занимали память целиком.
  const stream = conn.connection.query(`SELECT * FROM \`${table}\``).stream();
  for await (const row of stream) {
    batch.push(`(${Object.values(row).map((v) => sqlValue(conn, v)).join(', ')})`);
    rows++;
    if (batch.length >= ROWS_PER_INSERT) await flush();
  }
  await flush();
  return rows;
}

async function dumpDatabase(started) {
  const stamp = `${localDate(started)}_${pad(started.getHours())}${pad(started.getMinutes())}`;
  const file = path.join(DIR, `mbs_${stamp}.sql`);
  const tmp = `${file}.part`;
  const conn = await notesPool.getConnection();
  const out = fs.createWriteStream(tmp, { encoding: 'utf8' });
  out.on('error', (e) => { out.writeError = e; });
  let tables = 0;
  let rows = 0;
  try {
    const [list] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
    await writeLine(out, `-- Резервная копия БД notes (MBS Quality), ${started.toString()}\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n`);
    for (const r of list) {
      rows += await dumpTable(conn, out, Object.values(r)[0]);
      tables++;
    }
    // Представления (VIEW) — после таблиц; без DEFINER, чтобы восстанавливались под любым пользователем.
    const [views] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'VIEW'");
    for (const r of views) {
      const name = Object.values(r)[0];
      const [[v]] = await conn.query(`SHOW CREATE VIEW \`${name}\``);
      const ddl = v['Create View'].replace(/DEFINER=\S+\s+/, '').replace(/SQL SECURITY DEFINER\s+/, '');
      await writeLine(out, `\n-- Представление ${name}\nDROP VIEW IF EXISTS \`${name}\`;\n${ddl};\n`);
    }
    await writeLine(out, '\nSET FOREIGN_KEY_CHECKS = 1;\n');
  } catch (err) {
    out.failed = true;
    throw err;
  } finally {
    conn.release();
    await new Promise((resolve) => out.end(resolve));
    if (out.failed || out.writeError) { try { fs.unlinkSync(tmp); } catch { /* уже нет */ } }
  }
  if (out.writeError) throw out.writeError;
  fs.renameSync(tmp, file);
  return { file, tables, rows, sizeBytes: fs.statSync(file).size };
}

function removeOldDumps() {
  const limit = Date.now() - KEEP_DAYS * 86400000;
  let removed = 0;
  for (const name of fs.readdirSync(DIR)) {
    if (!/^mbs_\d{4}-\d{2}-\d{2}_\d{4}\.sql(\.part)?$/.test(name)) continue;
    const p = path.join(DIR, name);
    if (fs.statSync(p).mtimeMs < limit) { fs.unlinkSync(p); removed++; }
  }
  return removed;
}

// Зеркало uploads/: копирует новые и изменённые файлы. Копии файлов, которых больше нет
// в uploads/ (их удалила программа по сроку хранения), удаляются спустя KEEP_DAYS дней.
function mirrorUploads() {
  const target = path.join(DIR, 'uploads');
  let copied = 0;
  let removed = 0;
  const limit = Date.now() - KEEP_DAYS * 86400000;
  (function walk(rel) {
    const src = path.join(UPLOADS_DIR, rel);
    const dst = path.join(target, rel);
    const srcNames = fs.existsSync(src) ? fs.readdirSync(src, { withFileTypes: true }) : [];
    if (srcNames.length) fs.mkdirSync(dst, { recursive: true });
    for (const e of srcNames) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) { walk(r); continue; }
      const s = path.join(UPLOADS_DIR, r);
      const d = path.join(target, r);
      const ss = fs.statSync(s);
      if (!fs.existsSync(d) || fs.statSync(d).size !== ss.size) { fs.copyFileSync(s, d); copied++; }
    }
    if (fs.existsSync(dst)) {
      for (const e of fs.readdirSync(dst, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!fs.existsSync(path.join(src, e.name))) walk(path.join(rel, e.name)); continue; }
        const d = path.join(dst, e.name);
        if (!fs.existsSync(path.join(src, e.name)) && fs.statSync(d).mtimeMs < limit) { fs.unlinkSync(d); removed++; }
      }
    }
  })('');
  return { copied, removed };
}

async function runBackup() {
  if (!DIR || state.running) return state.lastRun;
  state.running = true;
  const started = new Date();
  const result = { startedAt: started.toISOString(), ok: false };
  try {
    fs.mkdirSync(DIR, { recursive: true });
    Object.assign(result, await dumpDatabase(started));
    result.oldDumpsRemoved = removeOldDumps();
    if (WITH_UPLOADS) result.uploads = mirrorUploads();
    result.ok = true;
    console.log(`[BACKUP] Готово: ${result.file} (${result.tables} таблиц, ${result.rows} строк, ${(result.sizeBytes / 1048576).toFixed(1)} МБ)` +
      (result.uploads ? `; фото: скопировано ${result.uploads.copied}, удалено старых ${result.uploads.removed}` : ''));
  } catch (err) {
    result.error = err.code || err.message;
    console.error('[BACKUP] Ошибка резервного копирования:', err.message);
  } finally {
    result.finishedAt = new Date().toISOString();
    state.lastRun = result;
    state.lastRunDate = localDate(started);
    state.running = false;
  }
  return result;
}

function start() {
  if (!DIR) return;
  console.log(`[BACKUP] Резервное копирование включено: ${DIR}, ежедневно в ${TIME}, хранить ${KEEP_DAYS} дн.`);
  const [h, m] = TIME.split(':').map(Number);
  setInterval(() => {
    const now = new Date();
    const due = now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
    if (due && state.lastRunDate !== localDate(now)) runBackup();
  }, 60 * 1000);
}

module.exports = { start, status, runBackup };
