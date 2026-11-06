import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ALL_CARDS } from './pagesCatalog';

// Страница администратора (/admin, по специальному паролю): состояние системы,
// резервные копии, статистика использования страниц, медленные запросы,
// последние ошибки сервера, блокировки ввода пароля. Только просмотр.

const PW_KEY = 'admin_password';
const REFRESH_MS = 30 * 1000;

const DB_NAMES = { main: 'Основная (IoT)', les: 'LES', mes: 'MES', notes: 'Своя (notes)', bms: 'BMS' };
const SNAP_NAMES = { cp6: 'CP6', cp7: 'CP7', cp7_tup: 'CP7 TUP', adas: 'ADAS', pip: 'PIP', cpfinal: 'CPFinal', electronics: 'Электроника' };

const EXTRA_PAGES = { '/': { caption: 'Главная', ru: '' }, '/admin': { caption: 'Администрирование', ru: '' } };
const pageInfo = (path) => EXTRA_PAGES[path] || ALL_CARDS.find((c) => c.to === path);
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDay = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '—');
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} с` : `${ms} мс`);

const CSS = `
.ad { max-width: 1300px; margin: 0 auto; padding: 8px 12px 48px; font-family: Inter, 'Segoe UI', Arial, sans-serif; color: #1F2937; }
.ad-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.ad-title { font-size: 26px; font-weight: 800; margin: 0; }
.ad-sub { color: #6B7280; font-size: 13px; margin-top: 4px; }
.ad-panel { background: #FFFFFF; border: 1px solid #F0F0F5; border-radius: 18px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.04); padding: 20px 22px; margin-bottom: 20px; }
.ad-h2 { font-size: 18px; font-weight: 700; margin: 0 0 14px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ad-h2 .hint { color: #9CA3AF; font-size: 13px; font-weight: 500; }
.ad-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.ad-badges { display: flex; flex-wrap: wrap; gap: 8px; }
.ad-badge { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 10px; font-size: 13.5px; font-weight: 600; border: 1px solid; max-width: 100%; box-sizing: border-box; white-space: nowrap; }
.ad-badge.ok { background: #ECFDF5; border-color: #A7F3D0; color: #065F46; }
.ad-badge.bad { background: #FEF2F2; border-color: #FECACA; color: #991B1B; }
.ad-badge .m { font-weight: 500; opacity: .75; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.ad-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.ad-table th { text-align: left; color: #6B7280; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; padding: 6px 8px; border-bottom: 1px solid #F0F0F5; }
.ad-table td { padding: 7px 8px; border-bottom: 1px solid #F7F7FA; vertical-align: top; }
.ad-table td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ad-table th.n { text-align: right; }
.ad-bar { height: 6px; border-radius: 3px; background: #DBEAFE; margin-top: 4px; }
.ad-bar > div { height: 100%; border-radius: 3px; background: #3B82F6; }
.ad-ru { color: #9CA3AF; font-size: 12px; }
.ad-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ad-chip { padding: 4px 10px; border-radius: 8px; background: #F3F4F6; font-size: 12.5px; color: #374151; text-decoration: none; }
.ad-log { max-height: 380px; overflow: auto; font-family: Consolas, 'Courier New', monospace; font-size: 12.5px; background: #FAFBFC; border: 1px solid #F0F0F5; border-radius: 10px; }
.ad-log div { padding: 5px 10px; border-bottom: 1px solid #F0F0F5; white-space: pre-wrap; word-break: break-word; }
.ad-log .error { color: #991B1B; }
.ad-log .warn { color: #92400E; }
.ad-seg { display: inline-flex; background: #E5E7EB; border-radius: 10px; padding: 4px; gap: 4px; }
.ad-seg button { border: none; background: transparent; padding: 5px 12px; border-radius: 7px; font-weight: 600; font-size: 13px; color: #6B7280; cursor: pointer; }
.ad-seg button.on { background: #FFFFFF; color: #111827; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
.ad-days { display: flex; align-items: flex-end; gap: 3px; height: 60px; margin: 6px 0 14px; }
.ad-days > div { flex: 1; background: #BFDBFE; border-radius: 3px 3px 0 0; min-height: 2px; }
.ad-empty { color: #9CA3AF; font-size: 14px; }
.ad-gate { max-width: 380px; margin: 60px auto; text-align: center; }
.ad-gate input { width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 12px; border: 1px solid #E5E7EB; font-size: 15px; margin: 14px 0 10px; outline: none; }
.ad-btn { padding: 11px 24px; border-radius: 10px; border: none; background: #35384F; color: #FFFFFF; font-weight: 700; font-size: 15px; cursor: pointer; }
.ad-err { color: #DC2626; font-size: 14px; min-height: 20px; }
@media (max-width: 900px) { .ad-cols { grid-template-columns: 1fr; } }
`;

function Badge({ ok, label, detail }) {
  return <span className={`ad-badge ${ok ? 'ok' : 'bad'}`} title={detail ? `${label}: ${detail}` : label}>{ok ? '✓' : '✕'} {label}{detail && <span className="m">{detail}</span>}</span>;
}

function SystemPanel({ data }) {
  const h = data.health;
  return (
    <section className="ad-panel">
      <h2 className="ad-h2">Состояние системы <span className="hint">проверено {fmtDateTime(h.time)}</span></h2>
      <div style={{ fontWeight: 600, fontSize: 13, color: '#6B7280', margin: '0 0 6px' }}>Базы данных</div>
      <div className="ad-badges">
        {Object.entries(h.databases).map(([k, v]) => <Badge key={k} ok={v.ok} label={DB_NAMES[k] || k} detail={v.ok ? `${v.ms} мс` : v.error} />)}
        <Badge ok={h.opc.ok} label="ПЛК (OPC UA)" detail={h.opc.ok ? '' : (h.opc.error || 'нет данных')} />
      </div>
      <div style={{ fontWeight: 600, fontSize: 13, color: '#6B7280', margin: '14px 0 6px' }}>Снимки DRR (последнее сохранение)</div>
      <div className="ad-badges">
        {Object.keys(h.snapshots).length === 0 && <span className="ad-empty">нет данных (своя БД недоступна)</span>}
        {Object.entries(h.snapshots).map(([k, v]) => (
          <Badge key={k} ok={v.ok} label={SNAP_NAMES[k] || k} detail={v.lastSaved ? `${v.lastSaved.slice(8, 10)}.${v.lastSaved.slice(5, 7)} ${v.lastSaved.slice(11, 16)}` : (v.error || 'нет')} />
        ))}
      </div>
      <div style={{ color: '#9CA3AF', fontSize: 12.5, marginTop: 12 }}>
        Сервер запущен {fmtDateTime(data.server.startedAt)} · Node {data.server.node} · память {data.server.memoryMb} МБ
      </div>
    </section>
  );
}

function BackupPanel({ backup }) {
  const last = backup.lastRun;
  return (
    <section className="ad-panel">
      <h2 className="ad-h2">Резервные копии</h2>
      {!backup.enabled && <div className="ad-empty">Не включены. Добавьте в server/.env строку <b>BACKUP_DIR=</b>папка (см. docs/DEPLOY.md).</div>}
      {backup.enabled && (
        <div style={{ fontSize: 14, lineHeight: 1.7 }}>
          <div>Папка: <b>{backup.dir}</b></div>
          <div>Каждый день в {backup.time}, хранится {backup.keepDays} дн.{backup.uploads ? ', вместе с фото' : ''}</div>
          {!last && <div className="ad-empty">Копий ещё не было (первая — в ближайшую минуту после запуска или в {backup.time}).</div>}
          {last && last.ok && <div><Badge ok label="Последняя копия" detail={`${fmtDateTime(last.finishedAt)} · ${(last.sizeBytes / 1048576).toFixed(1)} МБ · ${last.tables} табл.`} /></div>}
          {last && !last.ok && <div><Badge ok={false} label="Ошибка копии" detail={`${fmtDateTime(last.finishedAt)} · ${last.error}`} /></div>}
        </div>
      )}
    </section>
  );
}

function UsagePanel({ usage, days, setDays }) {
  const max = Math.max(1, ...usage.pages.map((p) => p.views));
  const maxDay = Math.max(1, ...usage.perDay.map((d) => d.views));
  const opened = new Set(usage.pages.map((p) => p.path));
  const neverOpened = ALL_CARDS.filter((c) => c.to.startsWith('/') && !opened.has(c.to));
  return (
    <section className="ad-panel">
      <h2 className="ad-h2">
        Использование страниц
        <span className="ad-seg">
          {[7, 30, 90].map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d} дн</button>)}
        </span>
        <span className="hint">
          {usage.totalViews} открытий · {usage.computers} компьютеров
          {usage.collectingSince ? ` · статистика собирается с ${fmtDay(usage.collectingSince)}` : ' · статистика ещё не собиралась'}
        </span>
      </h2>
      {usage.perDay.length > 1 && (
        <div className="ad-days" title="Открытий по дням">
          {usage.perDay.map((d) => <div key={d.day} style={{ height: `${(d.views / maxDay) * 100}%` }} title={`${fmtDay(d.day)}: ${d.views} открытий, ${d.computers} компьютеров`} />)}
        </div>
      )}
      <div className="ad-cols">
        <div>
          <table className="ad-table">
            <thead><tr><th>Страница</th><th className="n">Открытий</th><th className="n">Компьютеров</th><th className="n">Последний раз</th></tr></thead>
            <tbody>
              {usage.pages.length === 0 && <tr><td colSpan={4} className="ad-empty">Пока нет данных</td></tr>}
              {usage.pages.map((p) => {
                const info = pageInfo(p.path);
                return (
                  <tr key={p.path}>
                    <td>
                      <Link to={p.path} style={{ color: '#1F2937', fontWeight: 600, textDecoration: 'none' }}>{info ? info.caption : p.path}</Link>
                      {info && info.ru && <div className="ad-ru">{info.ru}</div>}
                      <div className="ad-bar"><div style={{ width: `${(p.views / max) * 100}%` }} /></div>
                    </td>
                    <td className="n">{p.views}</td>
                    <td className="n">{p.computers}</td>
                    <td className="n">{fmtDay(p.lastDay)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Не открывались за {days} дн: {neverOpened.length}</div>
          <div className="ad-ru" style={{ marginBottom: 10 }}>
            Кандидаты на удаление или доработку. Учитываются только открытия после начала сбора статистики;
            страница, которая весь день открыта на ТВ, считается одним открытием.
          </div>
          <div className="ad-chips">
            {neverOpened.map((c) => <Link key={c.to} to={c.to} className="ad-chip" title={c.ru}>{c.caption}</Link>)}
          </div>
        </div>
      </div>
    </section>
  );
}

function RequestsPanel({ requests }) {
  const routes = [...requests.routes].filter((r) => !r.route.includes('/api/admin/')).sort((a, b) => b.maxMs - a.maxMs).slice(0, 15);
  return (
    <section className="ad-panel">
      <h2 className="ad-h2">Медленные запросы <span className="hint">с {fmtDateTime(requests.since)} · медленный — дольше {fmtMs(requests.slowThresholdMs)}</span></h2>
      <div className="ad-cols">
        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Самые долгие маршруты</div>
          <table className="ad-table">
            <thead><tr><th>Маршрут</th><th className="n">Вызовов</th><th className="n">Среднее</th><th className="n">Максимум</th><th className="n">Медл.</th></tr></thead>
            <tbody>
              {routes.length === 0 && <tr><td colSpan={5} className="ad-empty">Пока нет данных</td></tr>}
              {routes.map((r) => (
                <tr key={r.route}>
                  <td style={{ fontFamily: 'Consolas, monospace', fontSize: 12.5 }}>{r.route}{r.errors > 0 && <span style={{ color: '#DC2626' }}> · ошибок {r.errors}</span>}</td>
                  <td className="n">{r.count}</td>
                  <td className="n">{fmtMs(r.avgMs)}</td>
                  <td className="n" style={{ color: r.maxMs >= requests.slowThresholdMs ? '#B45309' : undefined, fontWeight: r.maxMs >= requests.slowThresholdMs ? 700 : 400 }}>{fmtMs(r.maxMs)}</td>
                  <td className="n">{r.slow || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Последние медленные</div>
          {requests.recentSlow.length === 0 && <div className="ad-empty">Медленных запросов не было</div>}
          <table className="ad-table">
            <tbody>
              {requests.recentSlow.slice(0, 15).map((s, i) => (
                <tr key={i}>
                  <td className="n">{fmtDateTime(s.time)}</td>
                  <td style={{ fontFamily: 'Consolas, monospace', fontSize: 12, wordBreak: 'break-all' }}>{s.method} {s.url}</td>
                  <td className="n" style={{ fontWeight: 700 }}>{fmtMs(s.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function LogPanel({ log, locks }) {
  return (
    <section className="ad-panel">
      <h2 className="ad-h2">Ошибки и предупреждения сервера <span className="hint">последние {log.length}, новые сверху</span></h2>
      {log.length === 0 ? <div className="ad-empty">Ошибок нет</div> : (
        <div className="ad-log">
          {log.map((e, i) => <div key={i} className={e.level}>{fmtDateTime(e.time)} {e.text}</div>)}
        </div>
      )}
      <div style={{ fontWeight: 700, margin: '16px 0 6px' }}>Блокировки ввода пароля</div>
      {locks.length === 0 ? <div className="ad-empty">Нет — никто не подбирал пароль</div> : (
        <div className="ad-badges">{locks.map((l) => <Badge key={l.computer} ok={false} label={l.computer} detail={`до ${fmtDateTime(l.until)}`} />)}</div>
      )}
    </section>
  );
}

export default function AdminPage() {
  const [password, setPassword] = useState(() => { try { return sessionStorage.getItem(PW_KEY) || ''; } catch { return ''; } });
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async (pw, d) => {
    try {
      const res = await fetch('/api/admin/overview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw, days: d }) });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        setData(json); setError(''); setUpdatedAt(new Date());
        try { sessionStorage.setItem(PW_KEY, pw); } catch { /* ничего */ }
        setPassword(pw);
        return true;
      }
      if (res.status === 403) { setPassword(''); setData(null); try { sessionStorage.removeItem(PW_KEY); } catch { /* ничего */ } }
      setError(json.error || 'Не удалось получить данные');
      return false;
    } catch {
      setError('Сервер не отвечает');
      return false;
    }
  }, []);

  useEffect(() => {
    if (!password) return undefined;
    load(password, days);
    const t = setInterval(() => load(password, days), REFRESH_MS);
    return () => clearInterval(t);
  }, [password, days, load]);

  const gate = useMemo(() => !password, [password]);

  return (
    <div className="ad">
      <style>{CSS}</style>
      {gate ? (
        <div className="ad-panel ad-gate">
          <div style={{ fontSize: 22, fontWeight: 800 }}>Администрирование</div>
          <div style={{ color: '#6B7280', fontSize: 14, marginTop: 6 }}>Введите специальный пароль</div>
          <form onSubmit={(e) => { e.preventDefault(); load(input, days); }}>
            <input type="password" value={input} onChange={(e) => setInput(e.target.value)} autoFocus placeholder="Пароль" />
            <div className="ad-err">{error}</div>
            <button type="submit" className="ad-btn">Войти</button>
          </form>
        </div>
      ) : (
        <>
          <div className="ad-top">
            <div>
              <h1 className="ad-title">Администрирование</h1>
              <div className="ad-sub">
                {updatedAt ? `Обновлено ${updatedAt.toLocaleTimeString('ru-RU')} · обновляется каждые 30 с` : 'Загрузка…'}
                {error && <span style={{ color: '#DC2626' }}> · {error}</span>}
              </div>
            </div>
            <button className="ad-btn" style={{ background: '#E5E7EB', color: '#374151' }} onClick={() => { try { sessionStorage.removeItem(PW_KEY); } catch { /* ничего */ } setPassword(''); setData(null); }}>Выйти</button>
          </div>
          {data && (
            <>
              <div className="ad-cols">
                <SystemPanel data={data} />
                <BackupPanel backup={data.health.backup} />
              </div>
              <UsagePanel usage={data.usage} days={days} setDays={setDays} />
              <RequestsPanel requests={data.requests} />
              <LogPanel log={data.log} locks={data.locks} />
            </>
          )}
        </>
      )}
    </div>
  );
}
