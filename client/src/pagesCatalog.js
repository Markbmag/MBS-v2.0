// Каталог страниц сайта: название, русское название, слова для поиска, картинка-превью.
// Используется на главной странице и на странице администратора (статистика по страницам).
import tablePreview from './assets/table-preview.png';
import dailyTopPreview from './assets/daily-top-preview.png';
import modelStatusPreview from './assets/123.png';
import sgpAuditPreview from './assets/sgp.png';
import mppWeeklyPreview from './assets/mppweek.png';
import partDefectPreview from './assets/search.png';
import externalReportPreview from './assets/kulik.png';
import drrReportPreview from './assets/drrall.png';
import dailyDashboardPreview from './assets/dailyq.png';
import externalDReportPreview from './assets/dim.png';
import warrantyPreview from './assets/waran.png';
import tlMapPreview from './assets/tlmap.png';
import holdsSgpPreview from './assets/hold.png';
import sgpManagementPreview from './assets/cp8.png';
import cp7DashboardPreview from './assets/cp7drr.png';
import cp7historyPreview from './assets/cp7hist.png';
import drrTestlinePreview from './assets/tldrr.png';
import drrPipPreview from './assets/drrpip.png';
import electronicsPreview from './assets/elec.png';
import brigPreview from './assets/briga.png';
import remPreview from './assets/remzs.png';
import vehPreview from './assets/repai.png';
import drrCpFinalPreview from './assets/cp8drr.png';
import drrCp6Preview from './assets/drrcp6.png';
import drrCp5Preview from './assets/drrcp5.png';
import allDrrPreview from './assets/alldrrcomp.png';
import vrtPreview from './assets/vrt.png';
import drrShiftPreview from './assets/drrshift.png';
import defectCapturePreview from './assets/defph.png';
import lineDefectsArchivePreview from './assets/archph.png';
import reppsPreview from './assets/repps.png';
import voltageSpcPreview from './assets/volt.png';
import repelecPreview from './assets/repelec.png';
import drrElectronicsPreview from './assets/dshelec.png';

// favKey — ключ избранного как на прежней главной (чтобы избранное сохранилось).
const DRR_CARDS = [ // в порядке потока производства
  { to: '/drr-cp5', img: drrCp5Preview, caption: 'DRR CP5 Dashboard', accent: '#8B5CF6' },
  { to: '/drr-cp6', img: drrCp6Preview, caption: 'DRR CP6 Dashboard', accent: '#0EA5E9' },
  { to: '/drr-cp7-dashboard', img: cp7DashboardPreview, caption: 'DRR CP7 Dashboard', accent: '#6366F1' },
  { to: '/drr-cp7-tup', img: cp7DashboardPreview, caption: 'DRR CP7 (Touch Up)', accent: '#F59E0B' },
  { to: '/drr-tl-dashboard', img: drrTestlinePreview, caption: 'DRR ADAS Dashboard', accent: '#0EA5E9' },
  { to: '/drr-pip-dashboard', img: drrPipPreview, caption: 'DRR PIP Dashboard', accent: '#0EA5E9' },
  { to: '/drr-wt-portal', img: drrCpFinalPreview, caption: 'DRR CPFinal Dashboard', accent: '#0EA5E9' },
  { to: '/drr-electronics-dashboard', img: drrElectronicsPreview, caption: 'DRR Electronics Dashboard', accent: '#8B5CF6' },
  { to: '/all-drr-dashboard', img: allDrrPreview, caption: 'All DRR Dashboard', accent: '#0EA5E9' },
  { to: '/drr-shift-dashboard', img: drrShiftPreview, caption: 'DRR Shift Dashboard', accent: '#7C3AED' },
  { to: '/vehicle-on-wheels', img: vehPreview, caption: 'Vehicle on Wheels', accent: '#E22910' },
];
const REPORT_CARDS = [
  { to: '/report', img: tablePreview, caption: 'Top DRR Board', accent: '#3B82F6' },
  { to: '/daily-top', img: dailyTopPreview, caption: 'Daily Top CP7/CP8', accent: '#8B5CF6' },
  { to: '/model-status', img: modelStatusPreview, caption: 'Model Status', accent: '#F59E0B' },
  { to: '/mpp-weekly-top', img: mppWeeklyPreview, caption: 'DRR Defects Top CP7/CP8', accent: '#10B981' },
  { to: '/drr-report', img: drrReportPreview, caption: 'DRR Report', accent: '#3B82F6' },
  { to: '/daily-dashboard', img: dailyDashboardPreview, caption: 'Daily Dashboard', accent: '#F59E0B' },
  { to: '/tl-map', img: tlMapPreview, caption: 'TL Map', accent: '#14B8A6' },
  { to: '/drr-cp7-history', img: cp7historyPreview, caption: 'DRR CP7 History', accent: '#6366F1' },
  { to: '/defect-electronics-top', img: electronicsPreview, caption: 'Electronics Defects Top', accent: '#8B5CF6' },
  { to: '/remzone-work-status', img: remPreview, caption: 'Remzone Work Status', accent: '#8B5CF6' },
  { to: '/repps-report', img: reppsPreview, caption: 'REPPS Report', accent: '#EC4899' },
  { to: '/voltage-spc', img: voltageSpcPreview, caption: 'Voltage SPC Report', accent: '#F59E0B' },
  { to: '/repelec-report', img: repelecPreview, caption: 'REPELEC Report', accent: '#F59E0B' },
];
const SERVICE_CARDS = [
  { to: '/sgp-audit', img: sgpAuditPreview, caption: 'СГП Audit', accent: '#10B981' },
  { to: '/sgp-management', img: sgpManagementPreview, caption: 'СГП Management', accent: '#10B981' },
  { to: '/part-defect-search', img: partDefectPreview, caption: 'Part/Defect Search', accent: '#3B82F6' },
  { to: 'http://10.27.195.25:5174/time-at-points', img: externalDReportPreview, caption: 'Checkpoint Passage', accent: '#F59E0B' },
  { to: '/warranty', img: warrantyPreview, caption: 'Warranty', accent: '#10B981' },
  { to: '/holds-sgp', img: holdsSgpPreview, caption: 'Holds СГП', accent: '#EF4444' },
  { to: 'http://10.27.195.16/reports/024', img: externalReportPreview, caption: 'DRR по заводу', accent: '#EF4444' },
  { to: '/brigade-report', img: brigPreview, caption: 'Brigade Report Service', accent: '#3B82F6' },
  { to: '/vrt-report', img: vrtPreview, caption: 'VRT Report Service', accent: '#7C3AED' },
  { to: '/defect-capture', favKey: 'http://10.27.195.25:30000/defect-capture', img: defectCapturePreview, caption: 'Defect Capture', accent: '#10B981' },
  { to: '/line-defects-archive', favKey: 'http://10.27.195.25:30000/line-defects-archive', img: lineDefectsArchivePreview, caption: 'Line Defects Archive', accent: '#10B981' },
];
// Русское название (видно на карточке) и слова для поиска.
const INFO = {
  '/drr-cp5': ['DRR CP5 — кузов', 'чекпоинт cp5 дашборд кузов'],
  '/drr-cp6': ['DRR CP6 — покраска', 'чекпоинт cp6 дашборд покраска psin psout транзит буфер'],
  '/drr-cp7-dashboard': ['DRR CP7 — сборка', 'чекпоинт cp7 дашборд сборка'],
  '/drr-cp7-tup': ['DRR CP7 — подкраска (Touch Up)', 'чекпоинт cp7 tup подкраска touch up'],
  '/drr-tl-dashboard': ['DRR ADAS — тестовая линия', 'чекпоинт adas tladas тест линия testline'],
  '/drr-pip-dashboard': ['DRR PIP', 'чекпоинт pip дашборд'],
  '/drr-wt-portal': ['DRR CPFinal — финальный контроль', 'чекпоинт cpfinal финал tltt wt'],
  '/drr-electronics-dashboard': ['DRR электроника (BMS)', 'электроника bms прошивка дашборд'],
  '/all-drr-dashboard': ['Все DRR на одном экране', 'сводный все чекпоинты'],
  '/drr-shift-dashboard': ['DRR по сменам', 'смена смены фото отметки неделя'],
  '/vehicle-on-wheels': ['Ремонты после CP72', 'ремонт ремзона cp72 cpa repairs колёса'],
  '/report': ['Контроль качества — доска DRR', 'топ доска дефекты дпу dpu'],
  '/daily-top': ['Топ дефектов за сегодня', 'сегодня день топ дефекты cp7 cp8 контроль качества'],
  '/model-status': ['Статус по моделям', 'модели модель комплектации dpu drr рассылка pdf'],
  '/mpp-weekly-top': ['Топ дефектов по DRR', 'неделя топ mpp дефекты cp7 cp8'],
  '/drr-report': ['Отчёт DRR — выход годных', 'выход годной продукции первого предъявления динамика'],
  '/daily-dashboard': ['Ежедневный отчёт качества', 'daily report день ежедневный топ'],
  '/tl-map': ['Тестовая линия — посты и время', 'testline тест линия посты время парето история vin'],
  '/drr-cp7-history': ['История DRR CP7', 'история динамика cp7 снимки'],
  '/defect-electronics-top': ['Топ дефектов электроники', 'электроника дефекты динамика'],
  '/remzone-work-status': ['Статус работ ремзоны', 'ремзона ремонт работы статус'],
  '/repps-report': ['Спот и перекрас (REPPS)', 'спот перекрас покраска repps'],
  '/voltage-spc': ['Напряжение — SPC', 'напряжение вольтаж spc контрольная карта'],
  '/repelec-report': ['Ремонт электроники (REPELEC)', 'ремонт электроника repelec bms смены'],
  '/sgp-audit': ['Аудит СГП', 'сгп склад готовой продукции аудит sgp'],
  '/sgp-management': ['Управление СГП', 'сгп склад готовой продукции sgp управление причины'],
  '/part-defect-search': ['Поиск по детали, дефекту, VIN', 'поиск деталь дефект vin найти'],
  'http://10.27.195.25:5174/time-at-points': ['Прохождение точек', 'время точки прохождение местоположение машина checkpoint'],
  '/warranty': ['Гарантия', 'гарантия рекламации претензии warranty'],
  '/holds-sgp': ['Холды СГП', 'холд холды задержка блокировка сгп'],
  'http://10.27.195.16/reports/024': ['DRR по заводу (внешний отчёт)', 'завод drr внешний'],
  '/brigade-report': ['Бригадный отчёт', 'бригады бригада владельцы дефектов справочник'],
  '/vrt-report': ['Отчёт VRT', 'vrt владельцы дефектов зоны справочник'],
  '/defect-capture': ['Фото дефекта на линии', 'фото фотография фиксация дефект линия телефон'],
  '/line-defects-archive': ['Архив фото дефектов', 'архив фото дефекты линия'],
};
[DRR_CARDS, REPORT_CARDS, SERVICE_CARDS].forEach((list) => list.forEach((c) => {
  const [ru, keywords] = INFO[c.to] || ['', ''];
  c.ru = ru;
  c.search = `${c.caption} ${ru} ${keywords}`.toLowerCase();
}));
const ALL_CARDS = [...DRR_CARDS, ...REPORT_CARDS, ...SERVICE_CARDS];

// Поиск: каждое слово запроса должно найтись; выше — совпадения в названии.
function searchScore(card, words) {
  if (!words.length) return 1;
  if (!words.every((w) => card.search.includes(w))) return 0;
  const names = `${card.caption} ${card.ru}`.toLowerCase();
  return words.reduce((sum, w) => sum + (names.startsWith(w) ? 4 : names.includes(w) ? 2 : 1), 0);
}

const SECTIONS = [
  { id: 'drr', title: 'Отчеты DRR', icon: '⚙️', iconBg: '#E0F2FE', cards: DRR_CARDS },
  { id: 'reports', title: 'Отчёты', icon: '📊', iconBg: '#EEF2FF', cards: REPORT_CARDS },
  { id: 'services', title: 'Сервисы', icon: '🛠️', iconBg: '#ECFDF5', cards: SERVICE_CARDS },
];

const favKeyOf = (c) => c.favKey || c.to;

export { DRR_CARDS, REPORT_CARDS, SERVICE_CARDS, ALL_CARDS, SECTIONS, favKeyOf, searchScore };
