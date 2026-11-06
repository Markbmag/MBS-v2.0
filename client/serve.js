// Рабочий запуск клиента: раздаёт собранные страницы (client/dist) и передаёт запросы
// /api на сервер. Заменяет «npm run dev» (сервер разработки Vite) для постоянной работы:
// страницы открываются быстрее и не зависят от сервера разработки.
//
//   1) собрать:   npm run prod:build      (создаёт client/dist; повторять после обновления кода)
//   2) запустить: npm run prod:serve      (или node serve.js)
//
// Настройки (переменные окружения, необязательные):
//   CLIENT_PORT=30000                 — порт страниц (как у Vite)
//   API_URL=http://127.0.0.1:40000    — адрес сервера API
// Внешних пакетов не требует.

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = Number(process.env.CLIENT_PORT) || 30000;
const API = new URL(process.env.API_URL || 'http://127.0.0.1:40000');
const DIST = path.join(__dirname, 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.map']);
const gzCache = new Map(); // путь -> { mtimeMs, buf }

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`[client] Нет собранных страниц в ${DIST}. Сначала выполните: npm run prod:build`);
  process.exit(1);
}

function sendFile(req, res, file) {
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream' };
  // Файлы в assets/ имеют хэш в имени и не меняются — их можно кэшировать надолго.
  // index.html всегда проверяется заново, чтобы ТВ получали новую версию после обновления.
  headers['Cache-Control'] = file.startsWith(path.join(DIST, 'assets') + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache';
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    let c = gzCache.get(file);
    if (!c || c.mtimeMs !== stat.mtimeMs) { c = { mtimeMs: stat.mtimeMs, buf: zlib.gzipSync(fs.readFileSync(file)) }; gzCache.set(file, c); }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': c.buf.length, Vary: 'Accept-Encoding' });
    return res.end(req.method === 'HEAD' ? undefined : c.buf);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function proxyApi(req, res) {
  const remote = req.socket.remoteAddress || '';
  const headers = { ...req.headers, host: API.host };
  // Сервер ограничивает попытки ввода пароля по компьютеру — передаём его адрес.
  headers['x-forwarded-for'] = req.headers['x-forwarded-for'] ? `${req.headers['x-forwarded-for']},${remote}` : remote;
  const upstream = http.request({ hostname: API.hostname, port: API.port || 80, method: req.method, path: req.url, headers }, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Сервер API недоступен', detail: err.code || err.message }));
    } else res.destroy();
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  try {
    if (req.url.startsWith('/api/') || req.url === '/api') return proxyApi(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = path.resolve(DIST, `.${urlPath}`);
    if (file.startsWith(DIST + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(req, res, file);
    if (urlPath.startsWith('/assets/')) { res.writeHead(404); return res.end(); } // нет такого файла (старая версия) — не подменять страницей
    return sendFile(req, res, path.join(DIST, 'index.html')); // адреса страниц (/drr-cp7-dashboard и т.д.)
  } catch (err) {
    console.error('[client] Ошибка запроса', req.url, err.message);
    if (!res.headersSent) { res.writeHead(500); res.end(); }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[client] Страницы: http://0.0.0.0:${PORT}  (API: ${API.origin})`);
});
