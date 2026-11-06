// Маршрут: текущее значение OPC UA.
// Код перенесён из server.js без изменений.

const { app } = require('../app');
const { opcState } = require('../services/opc');

// HTTP-эндпоинт для фронта
app.get('/api/opc-value', (req, res) => {
  res.json(opcState);
});
