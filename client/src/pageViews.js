// Отметка об открытии страницы для статистики использования (страница администратора).
// Отправляется в фоне и никак не влияет на работу страницы, даже если сервер недоступен.

export function sendPageView(path) {
  try {
    const body = JSON.stringify({ path });
    if (navigator.sendBeacon && navigator.sendBeacon('/api/usage', new Blob([body], { type: 'application/json' }))) return;
    fetch('/api/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* статистика необязательна */ }
}
