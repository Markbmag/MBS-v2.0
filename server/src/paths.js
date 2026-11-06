// Пути на диске.
const path = require('path');

// Папка server/ — раньше весь код был в server/server.js и использовал __dirname,
// поэтому папки uploads/ ищутся относительно неё, как и раньше.
const SERVER_DIR = path.join(__dirname, '..');

module.exports = { SERVER_DIR };
