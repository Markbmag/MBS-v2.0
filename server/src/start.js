// Запуск: проверка БД и старт HTTP-сервера.
// Код перенесён из server.js без изменений.

const { app } = require('./app');
const { checkBmsDatabaseConnection, checkDatabaseConnection, checkLesDatabaseConnection, checkNotesDatabaseConnection } = require('./db');

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
