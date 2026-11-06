// Проверка пароля на сервере. Сами пароли хранятся только в server/.env.
//   kind: 'main'   — основной пароль
//         'import' — специальный пароль (импорт справочников, управление)
// Возвращает 'ok', 'wrong' (пароль неверный) или 'error' (сервер недоступен).
const API_BASE = '';

export async function checkPassword(kind, password) {
  try {
    const res = await fetch(`${API_BASE}/api/check-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, password }),
    });
    if (res.ok) return 'ok';
    if (res.status === 403) return 'wrong';
    return 'error';
  } catch {
    return 'error';
  }
}

export const PASSWORD_CHECK_ERROR = 'Не удалось проверить пароль';
