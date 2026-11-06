require('dotenv').config();

// Модули загружаются строго в том порядке, в котором код шёл в прежнем
// едином server.js: от этого зависят порядок маршрутов Express и порядок
// запуска фоновых задач.
require('./mailer'); // как и раньше, загружается первым (пишет в лог, если почта не настроена)
require('./src/app');
require('./src/middleware/password-guard'); // до маршрутов: ограничение попыток ввода пароля
require('./src/config/passwords');
require('./src/db');
require('./src/services/opc');
require('./src/routes/opc');
require('./src/routes/defects');
require('./src/routes/daily-top');
require('./src/routes/model-status');
require('./src/routes/cpa-scores');
require('./src/routes/checkpoint-map');
require('./src/routes/sgp-audit');
require('./src/routes/mpp');
require('./src/routes/defect-search');
require('./src/routes/retrospective');
require('./src/routes/daily-dashboard');
require('./src/routes/warranty');
require('./src/routes/tl-map');
require('./src/routes/holds-sgp');
require('./src/routes/shops');
require('./src/routes/sgp-management');
require('./src/routes/time-points');
require('./src/routes/drr/cp7');
require('./src/routes/drr/cp7-snapshots');
require('./src/routes/drr/cp7-history');
require('./src/routes/drr/cp7-tup');
require('./src/routes/drr/cp7-tup-snapshots');
require('./src/routes/email-settings');
require('./src/routes/drr/cp8');
require('./src/routes/drr/adas');
require('./src/routes/drr/adas-snapshots');
require('./src/routes/drr/pip');
require('./src/routes/drr/pip-snapshots');
require('./src/routes/electronics');
require('./src/routes/brigade-report');
require('./src/routes/remzone-work-status');
require('./src/routes/vehicle-on-wheels');
require('./src/routes/drr/wt-portal');
require('./src/routes/drr/cpfinal');
require('./src/routes/drr/cpfinal-snapshots');
require('./src/routes/drr/cp6');
require('./src/routes/drr/cp6-snapshots');
require('./src/routes/spot-repaint');
require('./src/routes/drr/cp5');
require('./src/routes/email-test');
require('./src/routes/vrt-report');
require('./src/routes/line-defects');
require('./src/routes/defect-notes');
require('./src/routes/repps');
require('./src/routes/drr-shift');
require('./src/routes/drr-weekly');
require('./src/routes/voltage-spc');
require('./src/routes/repelec');
require('./src/routes/bms');
require('./src/routes/drr/electronics-bms');
require('./src/routes/drr/electronics-bms-snapshots');
require('./src/routes/inspection');
require('./src/routes/check-password');
require('./src/routes/health');

// Ночное резервное копирование (включается настройкой BACKUP_DIR в .env)
require('./src/jobs/backup').start();
require('./src/start');
