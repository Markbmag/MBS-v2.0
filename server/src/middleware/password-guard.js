// Защита от подбора паролей страниц.
//
// Считает неверные пароли (ответ 403 на запрос, в теле которого есть поле password)
// отдельно для каждого компьютера. После PASSWORD_MAX_ATTEMPTS ошибок за 10 минут
// запросы с паролем с этого компьютера отклоняются (429) на 10 минут.
// Верный пароль сбрасывает счётчик. Запросы без пароля (все страницы на ТВ) не затрагиваются.
//
// Настройки в .env (необязательные):
//   PASSWORD_MAX_ATTEMPTS=10   — сколько ошибок допускается
//   PASSWORD_GUARD=off         — выключить защиту

const { app } = require('../app');

const MAX_FAILS = Number(process.env.PASSWORD_MAX_ATTEMPTS) || 10;
const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 10 * 60 * 1000;
const MAX_TRACKED = 5000;

const failures = new Map(); // ip -> { times: number[], lockedUntil: number }

function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// Адрес компьютера. Если запрос пришёл через прокси клиента на этом же сервере
// (Vite или client/serve.js), настоящий адрес передаётся в X-Forwarded-For.
// Берётся последний адрес: его добавил наш прокси (первые может подставить сам браузер).
function clientAddress(req) {
  const remote = req.socket.remoteAddress || 'unknown';
  const fwd = req.headers['x-forwarded-for'];
  if (fwd && isLoopback(remote)) return String(fwd).split(',').pop().trim();
  return remote;
}

function prune(now) {
  if (failures.size < MAX_TRACKED) return;
  for (const [ip, s] of failures) {
    if (s.lockedUntil <= now && (s.times.length === 0 || now - s.times[s.times.length - 1] > WINDOW_MS)) failures.delete(ip);
  }
}

app.use((req, res, next) => {
  if (process.env.PASSWORD_GUARD === 'off') return next();
  if (req.method === 'GET' || !req.body || typeof req.body !== 'object' || !('password' in req.body)) return next();

  const ip = clientAddress(req);
  const now = Date.now();
  const state = failures.get(ip);
  if (state && state.lockedUntil > now) {
    const minutes = Math.ceil((state.lockedUntil - now) / 60000);
    return res.status(429).json({ success: false, error: `Слишком много неверных паролей. Попробуйте через ${minutes} мин.` });
  }

  res.on('finish', () => {
    const t = Date.now();
    if (res.statusCode === 403) {
      const s = failures.get(ip) || { times: [], lockedUntil: 0 };
      s.times = s.times.filter((x) => t - x < WINDOW_MS);
      s.times.push(t);
      if (s.times.length >= MAX_FAILS) {
        s.lockedUntil = t + LOCK_MS;
        s.times = [];
        console.warn(`[ПАРОЛИ] ${ip}: ${MAX_FAILS} неверных паролей — ввод пароля заблокирован на ${LOCK_MS / 60000} мин.`);
      }
      failures.set(ip, s);
      prune(t);
    } else if (res.statusCode < 400) {
      failures.delete(ip);
    }
  });
  next();
});
