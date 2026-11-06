// «Недавно открытые» страницы — хранятся только в браузере этого компьютера
// (localStorage), без входа в систему. Ничего не показывает и не отправляет на сервер.

const KEY = 'recent_pages';
const MAX = 12;
const SKIP = new Set(['/', '/home-new']);

export function rememberPage(pathname) {
  if (!pathname || SKIP.has(pathname)) return;
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]').filter((x) => x && x.path !== pathname);
    list.unshift({ path: pathname, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch { /* хранилище недоступно — просто не запоминаем */ }
}

export function recentPages() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((x) => x && typeof x.path === 'string') : [];
  } catch {
    return [];
  }
}
