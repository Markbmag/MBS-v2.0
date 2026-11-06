// Адрес компьютера, с которого пришёл запрос.
// Если запрос пришёл через прокси клиента на этом же сервере (Vite или client/serve.js),
// настоящий адрес передаётся в X-Forwarded-For. Берётся последний адрес: его добавил наш
// прокси (первые может подставить сам браузер).

function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function clientAddress(req) {
  const remote = req.socket.remoteAddress || 'unknown';
  const fwd = req.headers['x-forwarded-for'];
  if (fwd && isLoopback(remote)) return String(fwd).split(',').pop().trim();
  return remote;
}

module.exports = { clientAddress };
