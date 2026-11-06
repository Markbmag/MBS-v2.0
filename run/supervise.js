// Сторож: запускает сервер или клиент, пишет их вывод в файлы журнала и перезапускает
// процесс, если он остановился (сбой, БД недоступна при старте и т.п.).
//
//   node run/supervise.js server   — сервер API (server/server.js, порт 40000)
//   node run/supervise.js client   — страницы (client/serve.js, порт 30000; нужна сборка client/dist)
//
// Журналы: logs/server-ГГГГ-ММ-ДД.log, logs/client-ГГГГ-ММ-ДД.log (хранятся LOG_KEEP_DAYS дней, по умолчанию 30).
// Перезапуск: через 2 с, 5 с, 10 с, затем каждые 30 с; если процесс проработал больше минуты,
// отсчёт начинается заново. Остановить: закрыть окно или Ctrl+C.
// Внешних пакетов не требует.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = {
  server: { cwd: path.join(ROOT, 'server'), script: 'server.js' },
  client: { cwd: path.join(ROOT, 'client'), script: 'serve.js' },
};
const name = process.argv[2];
const target = TARGETS[name];
if (!target) {
  console.error('Использование: node run/supervise.js server|client');
  process.exit(2);
}

const LOG_DIR = path.join(ROOT, 'logs');
const KEEP_DAYS = Number(process.env.LOG_KEEP_DAYS) > 0 ? Number(process.env.LOG_KEEP_DAYS) : 30;
const DELAYS_SEC = [2, 5, 10, 30];
const STABLE_MS = 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = (d) => `${day(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

fs.mkdirSync(LOG_DIR, { recursive: true });
let logDay = null;
let logStream = null;

function removeOldLogs() {
  const limit = Date.now() - KEEP_DAYS * 86400000;
  for (const f of fs.readdirSync(LOG_DIR)) {
    if (!new RegExp(`^${name}-\\d{4}-\\d{2}-\\d{2}\\.log$`).test(f)) continue;
    const p = path.join(LOG_DIR, f);
    try { if (fs.statSync(p).mtimeMs < limit) fs.unlinkSync(p); } catch { /* занят или уже удалён */ }
  }
}

function log(line) {
  const now = new Date();
  if (day(now) !== logDay) {
    if (logStream) logStream.end();
    logDay = day(now);
    logStream = fs.createWriteStream(path.join(LOG_DIR, `${name}-${logDay}.log`), { flags: 'a' });
    logStream.on('error', (e) => console.error('[сторож] не удаётся писать журнал:', e.message));
    removeOldLogs();
  }
  const text = `${stamp(now)} ${line}`;
  logStream.write(`${text}\n`);
  console.log(text);
}

// Вывод процесса приходит кусками — собираем целые строки.
function lineReader() {
  let rest = '';
  return (chunk) => {
    rest += chunk.toString('utf8');
    const lines = rest.split(/\r?\n/);
    rest = lines.pop();
    lines.forEach((l) => log(l));
  };
}

let child = null;
let stopping = false;
let attempt = 0;

function start() {
  const startedAt = Date.now();
  log(`[сторож] запуск ${name}: node ${target.script} (папка ${target.cwd})`);
  child = spawn(process.execPath, [target.script], { cwd: target.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', lineReader());
  child.stderr.on('data', lineReader());
  child.on('error', (err) => log(`[сторож] не удалось запустить: ${err.message}`));
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return;
    if (Date.now() - startedAt > STABLE_MS) attempt = 0;
    const delay = DELAYS_SEC[Math.min(attempt, DELAYS_SEC.length - 1)];
    attempt++;
    log(`[сторож] ${name} остановился (код ${code}${signal ? `, сигнал ${signal}` : ''}), перезапуск через ${delay} с`);
    setTimeout(start, delay * 1000);
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  log(`[сторож] остановка ${name}`);
  if (child) {
    child.once('exit', () => process.exit(0));
    child.kill();
    setTimeout(() => process.exit(0), 5000);
  } else process.exit(0);
}
['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'].forEach((s) => process.on(s, stop));

start();
