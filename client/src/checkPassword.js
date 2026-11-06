// Проверка пароля на сервере. Сами пароли хранятся только в server/.env.
//   kind: 'main'   — основной пароль
//         'import' — специальный пароль (импорт справочников, управление)
// Возвращает 'ok', 'wrong' (пароль неверный), 'locked' (слишком много неверных
// попыток — сервер временно не принимает пароль) или 'error' (сервер недоступен).
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
    if (res.status === 429) return 'locked';
    return 'error';
  } catch {
    return 'error';
  }
}

// Текст ошибки для окна пароля по результату checkPassword.
export function passwordErrorText(result) {
  if (result === 'wrong') return 'Неверный пароль';
  if (result === 'locked') return 'Слишком много неверных паролей. Попробуйте через 10 мин.';
  return 'Не удалось проверить пароль';
}
