// Express-приложение и общие middleware (CORS, разбор JSON/форм).
// Код перенесён из server.js без изменений.


const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({
  origin: 'http://localhost:30000',
  credentials: true
}));
app.use(express.json({ limit: '256mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

module.exports = { app };
