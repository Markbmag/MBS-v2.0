import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
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

// Новая главная страница (предпросмотр по адресу /home-new; текущая главная не меняется).
// Тот же стиль и те же разделы, плюс: DRR последней смены по чекпоинтам, состояние системы,
// компактные карточки, работа на телефоне. Избранное общее с прежней главной.

const API_BASE = '';
const FAVORITES_KEY = 'home_favorites';

// ---------------------------------------------------------------- каталог
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
const SECTIONS = [
  { id: 'drr', title: 'Отчеты DRR', icon: '⚙️', iconBg: '#E0F2FE', cards: DRR_CARDS },
  { id: 'reports', title: 'Отчёты', icon: '📊', iconBg: '#EEF2FF', cards: REPORT_CARDS },
  { id: 'services', title: 'Сервисы', icon: '🛠️', iconBg: '#ECFDF5', cards: SERVICE_CARDS },
];
const TABS = [
  { id: 'all', label: 'Все' },
  { id: 'reports', label: '📊 Отчеты' },
  { id: 'services', label: '🛠️ Сервисы' },
  { id: 'drr', label: '⚙️ Отчеты DRR' },
];

// DRR по чекпоинтам (по снимкам смен из своей БД — не нагружает заводские БД).
const DRR_TILES = [
  { name: 'CP5', to: '/drr-cp5', api: null },
  { name: 'CP6', to: '/drr-cp6', api: '/api/drr-cp6-snapshots?days=3' },
  { name: 'CP7', to: '/drr-cp7-dashboard', api: '/api/drr-cp7-snapshots?days=3&filter=all' },
  { name: 'CP7 TUP', to: '/drr-cp7-tup', api: '/api/drr-cp7-tup-snapshots?days=3&filter=all' },
  { name: 'ADAS', to: '/drr-tl-dashboard', api: '/api/drr-tl-snapshots?days=3' },
  { name: 'PIP', to: '/drr-pip-dashboard', api: '/api/drr-pip-snapshots?days=3' },
  { name: 'CPFinal', to: '/drr-wt-portal', api: '/api/drr-cpfinal-snapshots?days=3' },
  { name: 'Электроника', to: '/drr-electronics-dashboard', api: '/api/drr-electronics-snapshots?days=3' },
];
const SHIFT_NAMES = { day: 'день', evening: 'вечер', night: 'ночь' };

const favKeyOf = (c) => c.favKey || c.to;
const fmtDate = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}` : '');

// ---------------------------------------------------------------- данные
function useDrrStrip() {
  const [tiles, setTiles] = useState(() => DRR_TILES.map((t) => ({ ...t, loading: Boolean(t.api) })));
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const result = await Promise.all(DRR_TILES.map(async (t) => {
        if (!t.api) return { ...t, loading: false };
        try {
          const res = await fetch(API_BASE + t.api);
          if (!res.ok) throw new Error(String(res.status));
          const rows = await res.json();
          const shifts = (Array.isArray(rows) ? rows : []).filter((r) => r && r.shift && r.shift !== 'all' && Number.isFinite(Number(r.drrPercent)));
          const last = shifts[0];
          const prev = shifts[1];
          if (!last) return { ...t, loading: false, empty: true };
          return {
            ...t, loading: false,
            drr: Number(last.drrPercent),
            delta: prev ? Number(last.drrPercent) - Number(prev.drrPercent) : null,
            shiftLabel: `${last.shiftLetter ? `${last.shiftLetter} · ` : ''}${SHIFT_NAMES[last.shift] || last.shift} · ${fmtDate(last.shiftDate)}`,
            nok: last.nokVins, total: last.totalVins,
          };
        } catch {
          return { ...t, loading: false, error: true };
        }
      }));
      if (!cancelled) setTiles(result);
    };
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  return tiles;
}

function useHealth() {
  const [health, setHealth] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/health`);
        const json = await res.json();
        if (!cancelled) setHealth(json);
      } catch {
        if (!cancelled) setHealth({ status: 'unreachable' });
      }
    };
    load();
    const timer = setInterval(load, 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  return health;
}

function healthProblems(h) {
  if (!h) return [];
  if (h.status === 'unreachable') return ['Сервер не отвечает'];
  const out = [];
  const dbNames = { main: 'Основная БД (IoT)', les: 'БД LES', mes: 'БД MES', notes: 'Своя БД (заметки, снимки)', bms: 'БД BMS' };
  Object.entries(h.databases || {}).forEach(([k, v]) => { if (!v.ok) out.push(`${dbNames[k] || k}: недоступна`); });
  if (h.opc && !h.opc.ok) out.push('Связь с ПЛК (OPC UA): нет данных');
  Object.entries(h.snapshots || {}).forEach(([k, v]) => {
    if (!v.ok) out.push(`Снимки DRR ${k.toUpperCase().replace('_', ' ')}: ${v.lastSaved ? `последний ${v.lastSaved.slice(0, 16)}` : 'нет'}`);
  });
  if (h.backup && h.backup.enabled && h.backup.lastRun && !h.backup.lastRun.ok) out.push('Резервное копирование: ошибка');
  return out;
}

// ---------------------------------------------------------------- стили
const CSS = `
.hn { max-width: 1440px; margin: 0 auto; padding: 28px 32px 48px; font-family: Inter, 'Segoe UI', Arial, sans-serif; color: #1F2937; }
.hn-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.hn-title { font-size: 26px; font-weight: 800; margin: 0; letter-spacing: -0.01em; }
.hn-sub { color: #6B7280; font-size: 14px; margin-top: 4px; }
.hn-status { position: relative; }
.hn-pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; border: 1px solid #E5E7EB; background: #FFFFFF; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.04); color: #374151; }
.hn-dot { width: 10px; height: 10px; border-radius: 50%; }
.hn-pop { position: absolute; right: 0; top: calc(100% + 8px); z-index: 20; width: 340px; max-width: 86vw; background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 14px; box-shadow: 0 20px 30px -10px rgba(0,0,0,0.15); padding: 14px 16px; font-size: 14px; }
.hn-pop li { margin: 4px 0; }
.hn-panel { background: #FFFFFF; border: 1px solid #F0F0F5; border-radius: 20px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.04); padding: 22px 24px; margin-bottom: 24px; }
.hn-h2 { display: flex; align-items: center; gap: 10px; font-size: 19px; font-weight: 700; margin: 0 0 16px; }
.hn-h2 .ic { padding: 6px 10px; border-radius: 8px; font-size: 16px; }
.hn-h2 .cnt { color: #9CA3AF; font-weight: 600; font-size: 15px; }
.hn-h2 .hint { margin-left: auto; color: #9CA3AF; font-size: 13px; font-weight: 500; }
.hn-tiles { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 12px; }
.hn-tile { display: block; text-decoration: none; color: inherit; border: 1px solid #EEF0F4; border-radius: 14px; padding: 12px 14px; background: #FAFBFC; transition: border-color .2s, transform .2s, box-shadow .2s; min-width: 0; }
.hn-tile:hover { border-color: #93C5FD; transform: translateY(-2px); box-shadow: 0 8px 18px -8px rgba(0,0,0,0.15); }
.hn-tile .nm { font-size: 13px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: .03em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hn-tile .val { font-size: 28px; font-weight: 800; margin-top: 4px; line-height: 1.1; }
.hn-tile .dl { font-size: 13px; font-weight: 700; margin-left: 6px; }
.hn-tile .meta { font-size: 12px; color: #6B7280; margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hn-skel { display: inline-block; width: 64px; height: 26px; border-radius: 6px; background: linear-gradient(90deg,#EEF0F4,#F7F8FA,#EEF0F4); }
.hn-controls { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 22px; }
.hn-tabs { display: flex; gap: 6px; background: #E5E7EB; border-radius: 14px; padding: 6px; overflow-x: auto; max-width: 100%; }
.hn-tab { padding: 9px 22px; border-radius: 10px; border: none; font-weight: 600; font-size: 15px; cursor: pointer; white-space: nowrap; background: transparent; color: #6B7280; transition: all .25s; }
.hn-tab.on { background: #FFFFFF; color: #111827; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.hn-search { position: relative; flex: 1; min-width: 220px; max-width: 520px; }
.hn-search input { width: 100%; box-sizing: border-box; padding: 12px 40px 12px 44px; border-radius: 14px; border: 1px solid #E5E7EB; font-size: 15px; background: #FFFFFF; outline: none; box-shadow: 0 2px 6px rgba(0,0,0,0.04); }
.hn-search input:focus { border-color: #93C5FD; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
.hn-search .lens { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); color: #9CA3AF; pointer-events: none; }
.hn-search .key { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); border: 1px solid #E5E7EB; border-radius: 6px; padding: 1px 7px; font-size: 12px; color: #9CA3AF; background: #F9FAFB; }
.hn-search .clr { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); border: none; background: transparent; color: #9CA3AF; font-size: 16px; cursor: pointer; padding: 4px 8px; }
.hn-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
.hn-card { position: relative; display: block; text-decoration: none; color: inherit; border-radius: 14px; overflow: hidden; background: #FFFFFF; border: 1px solid #F3F4F6; box-shadow: 0 4px 10px rgba(0,0,0,0.04); transition: transform .25s cubic-bezier(.25,.8,.25,1.2), box-shadow .25s, border-color .25s; }
.hn-card:hover { transform: translateY(-4px); box-shadow: 0 16px 26px -10px rgba(0,0,0,0.14); border-color: var(--accent); }
.hn-thumb { height: 108px; background: #F9FAFB; overflow: hidden; }
.hn-thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top; transition: transform .4s; display: block; }
.hn-card:hover .hn-thumb img { transform: scale(1.04); }
.hn-cap { background: #35384F; color: #FFFFFF; font-weight: 600; font-size: 13.5px; padding: 10px 12px; display: flex; align-items: center; gap: 6px; border-top: 3px solid var(--accent); }
.hn-cap .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hn-ext { flex: none; }
.hn-ext { opacity: .7; font-size: 12px; flex: none; }
.hn-star { position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; border-radius: 50%; border: none; cursor: pointer; font-size: 16px; line-height: 30px; background: rgba(255,255,255,0.92); color: #D1D5DB; box-shadow: 0 2px 6px rgba(0,0,0,0.12); opacity: 0; transition: opacity .2s, color .2s; }
.hn-card:hover .hn-star, .hn-star.on { opacity: 1; }
.hn-star.on { color: #F59E0B; }
.hn-empty { color: #6B7280; text-align: center; padding: 30px 0; }
@media (max-width: 1200px) { .hn-tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 700px) {
  .hn { padding: 16px 12px 32px; }
  .hn-title { font-size: 21px; }
  .hn-panel { padding: 16px 14px; border-radius: 16px; }
  .hn-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hn-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .hn-thumb { height: 84px; }
  .hn-search .key { display: none; }
  .hn-star { opacity: 1; }
  .hn-h2 .hint { display: none; }
  .hn-cap .t { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
}
`;

// ---------------------------------------------------------------- части страницы
function StatusPill({ health }) {
  const [open, setOpen] = useState(false);
  const problems = healthProblems(health);
  let color = '#9CA3AF'; let text = 'Проверка…';
  if (health) {
    if (health.status === 'ok') { color = '#10B981'; text = 'Система работает'; }
    else if (health.status === 'degraded') { color = '#F59E0B'; text = `Есть неполадки: ${problems.length}`; }
    else { color = '#EF4444'; text = health.status === 'unreachable' ? 'Сервер не отвечает' : 'Сбой основной БД'; }
  }
  return (
    <div className="hn-status">
      <button className="hn-pill" onClick={() => setOpen((o) => !o)} title="Состояние системы">
        <span className="hn-dot" style={{ background: color, boxShadow: `0 0 0 4px ${color}22` }} />
        {text}
      </button>
      {open && (
        <div className="hn-pop" onMouseLeave={() => setOpen(false)}>
          {problems.length === 0
            ? <div>Все базы данных, связь с ПЛК и снимки DRR работают.</div>
            : <ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          {health && health.time && (
            <div style={{ color: '#9CA3AF', fontSize: 12, marginTop: 10 }}>
              Проверено {new Date(health.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DrrStrip({ tiles }) {
  return (
    <section className="hn-panel">
      <h2 className="hn-h2">
        <span className="ic" style={{ background: '#E0F2FE' }}>⚙️</span>
        DRR — последняя завершённая смена
        <span className="hint">по снимкам смен · нажмите, чтобы открыть дашборд</span>
      </h2>
      <div className="hn-tiles">
        {tiles.map((t) => (
          <Link key={t.name} to={t.to} className="hn-tile">
            <div className="nm">{t.name}</div>
            {t.loading && <div className="val"><span className="hn-skel" /></div>}
            {!t.loading && t.drr != null && (
              <>
                <div className="val">
                  {t.drr.toFixed(1)}%
                  {t.delta != null && Math.abs(t.delta) >= 0.05 && (
                    <span className="dl" style={{ color: t.delta > 0 ? '#059669' : '#DC2626' }}>
                      {t.delta > 0 ? '▲' : '▼'}{Math.abs(t.delta).toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="meta" title={t.shiftLabel}>{t.shiftLabel}</div>
                <div className="meta">NOK {t.nok ?? '—'} из {t.total ?? '—'}</div>
              </>
            )}
            {!t.loading && t.drr == null && (
              <>
                <div className="val" style={{ color: '#9CA3AF', fontSize: 22 }}>—</div>
                <div className="meta">{t.api ? (t.error ? 'нет связи' : 'нет снимков') : 'онлайн-дашборд'}</div>
              </>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}

function Card({ card, isFavorite, onToggleFavorite }) {
  const external = card.to.startsWith('http');
  const inner = (
    <>
      <button
        className={`hn-star${isFavorite ? ' on' : ''}`}
        title={isFavorite ? 'Убрать из избранного' : 'В избранное'}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(favKeyOf(card)); }}
      >★</button>
      <div className="hn-thumb"><img src={card.img} alt="" loading="lazy" /></div>
      <div className="hn-cap"><span className="t" title={card.caption}>{card.caption}</span>{external && <span className="hn-ext" title="Открывается в новой вкладке">↗</span>}</div>
    </>
  );
  const style = { '--accent': card.accent };
  return external
    ? <a href={card.to} target="_blank" rel="noopener noreferrer" className="hn-card" style={style}>{inner}</a>
    : <Link to={card.to} className="hn-card" style={style}>{inner}</Link>;
}

function Section({ title, icon, iconBg, cards, favorites, onToggleFavorite }) {
  return (
    <section className="hn-panel">
      <h2 className="hn-h2"><span className="ic" style={{ background: iconBg }}>{icon}</span>{title}<span className="cnt">{cards.length}</span></h2>
      <div className="hn-grid">
        {cards.map((c) => <Card key={c.to} card={c} isFavorite={favorites.includes(favKeyOf(c))} onToggleFavorite={onToggleFavorite} />)}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- страница
export default function HomePageNew() {
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch { return []; }
  });
  const searchRef = useRef(null);
  const tiles = useDrrStrip();
  const health = useHealth();

  useEffect(() => {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); } catch { /* недоступно */ }
  }, [favorites]);

  // «/» — перейти к поиску; Esc — очистить поиск
  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement && document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current && searchRef.current.focus(); }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) { setSearch(''); searchRef.current.blur(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleFavorite = useCallback((key) => {
    setFavorites((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  }, []);

  const q = search.trim().toLowerCase();
  const match = (c) => !q || c.caption.toLowerCase().includes(q);
  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => tab === 'all' || tab === s.id).map((s) => ({ ...s, cards: s.cards.filter(match) })).filter((s) => s.cards.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, q],
  );
  const favoriteCards = useMemo(
    () => SECTIONS.flatMap((s) => s.cards).filter((c) => favorites.includes(favKeyOf(c)) && match(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [favorites, q],
  );

  return (
    <div className="hn">
      <style>{CSS}</style>
      <div className="hn-top">
        <div>
          <h1 className="hn-title">Панель качества</h1>
          <div className="hn-sub">Отчёты, DRR-дашборды и сервисы MBS Quality</div>
        </div>
        <StatusPill health={health} />
      </div>

      {!q && (tab === 'all' || tab === 'drr') && <DrrStrip tiles={tiles} />}

      <div className="hn-controls">
        <div className="hn-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`hn-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="hn-search">
          <span className="lens">🔍</span>
          <input ref={searchRef} type="text" placeholder="Поиск отчёта или сервиса..." value={search} onChange={(e) => setSearch(e.target.value)} />
          {search ? <button className="clr" onClick={() => setSearch('')} title="Очистить">✕</button> : <span className="key" title="Нажмите / для поиска">/</span>}
        </div>
      </div>

      {favoriteCards.length > 0 && (
        <Section title="Избранное" icon="⭐" iconBg="#FEF3C7" cards={favoriteCards} favorites={favorites} onToggleFavorite={toggleFavorite} />
      )}
      {visibleSections.map((s) => (
        <Section key={s.id} {...s} favorites={favorites} onToggleFavorite={toggleFavorite} />
      ))}
      {visibleSections.length === 0 && <div className="hn-panel hn-empty">Ничего не найдено по запросу «{search}»</div>}
    </div>
  );
}
