import React, { useState, useEffect, useCallback } from 'react';

const API_BASE = '';
const PAGE_SIZE = 40;

const LOCATIONS = [
  { code: 'CP7',    label: 'CP7',                  color: '#2563EB' },
  { code: 'CP8',    label: 'CP8',                  color: '#7C3AED' },
  { code: 'SGP',    label: 'СГП (Парковка/Склад)', color: '#059669' },
  { code: 'REPAIR', label: 'Ремзона',              color: '#DC2626' },
];
const LOCATION_BY_CODE = Object.fromEntries(LOCATIONS.map(l => [l.code, l]));

const useIsMobile = () => {
  const [m, setM] = useState(typeof window !== 'undefined' && window.innerWidth < 900);
  useEffect(() => {
    const h = () => setM(window.innerWidth < 900);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return m;
};

const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const toISO = (dateStr, endOfDay = false) => {
  if (!dateStr) return '';
  return endOfDay ? `${dateStr} 23:59:59` : `${dateStr} 00:00:00`;
};

const todayStr = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/* Бейдж локации — если code пустой, возвращаем null */
function LocationBadge({ code }) {
  const loc = LOCATION_BY_CODE[code];
  if (!loc) return null;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 6,
      background: loc.color, color: '#FFFFFF', fontSize: 11, fontWeight: 800,
      letterSpacing: 0.3, whiteSpace: 'nowrap',
    }}>{loc.label}</span>
  );
}

/* ================= Password modal ================= */
function PasswordModal({ text, error, busy, onConfirm, onCancel }) {
  const [pwd, setPwd] = useState('');
  return (
    <div
      onClick={busy ? undefined : onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 9800,
        background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFF', borderRadius: 16, padding: 24, maxWidth: 380, width: '100%' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', marginBottom: 8 }}>Подтвердите удаление</div>
        <div style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>{text}</div>
        <input
          type="password" value={pwd} onChange={(e) => setPwd(e.target.value)}
          autoFocus placeholder="Пароль"
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) onConfirm(pwd); }}
          style={{
            width: '100%', padding: '12px 14px', fontSize: 16,
            borderRadius: 10, border: '1px solid #E2E8F0', outline: 'none',
            boxSizing: 'border-box', marginBottom: 10,
          }}
        />
        {error && <div style={{ color: '#DC2626', fontSize: 13, marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} disabled={busy} style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#FFF', color: '#475569', fontSize: 14, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>Отмена</button>
          <button onClick={() => onConfirm(pwd)} disabled={busy} style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', background: '#DC2626', color: '#FFF', fontSize: 14, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>{busy ? '…' : 'Удалить'}</button>
        </div>
      </div>
    </div>
  );
}

/* ================= Main ================= */
export default function LineDefectsArchivePage() {
  const isMobile = useIsMobile();
  const today = todayStr();

  const [filters, setFilters] = useState({
    from: today, to: today,
    vin: '', model: '', part_name: '', problem_type: '',
    capture_location: '',
    search: '',
  });
  const [filterOptions, setFilterOptions] = useState({ models: [], parts: [], problems: [], locations: [] });
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [detail, setDetail] = useState(null);

  const [deletePhotoTarget, setDeletePhotoTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/line-defects/filters`);
        const json = await res.json();
        setFilterOptions({
          models: json.models || [],
          parts: json.parts || [],
          problems: json.problems || [],
          locations: json.locations || [],
        });
      } catch {}
    })();
  }, []);

  const buildQuery = useCallback((p = 0) => {
    const qs = new URLSearchParams();
    if (filters.from) qs.set('from', toISO(filters.from, false));
    if (filters.to)   qs.set('to',   toISO(filters.to, true));
    if (filters.vin)  qs.set('vin',  filters.vin.trim());
    if (filters.model && filters.model !== 'ALL') qs.set('model', filters.model);
    if (filters.part_name)    qs.set('part_name', filters.part_name);
    if (filters.problem_type) qs.set('problem_type', filters.problem_type);
    if (filters.capture_location) qs.set('capture_location', filters.capture_location);
    if (filters.search) qs.set('search', filters.search.trim());
    qs.set('limit', PAGE_SIZE);
    qs.set('offset', p * PAGE_SIZE);
    return qs.toString();
  }, [filters]);

  const load = useCallback(async (p = 0) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/line-defects?${buildQuery(p)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка загрузки');
      setItems(json.items || []);
      setTotal(json.total || 0);
      setPage(p);
    } catch (e) {
      setError(e.message);
      setItems([]);
      setTotal(0);
    } finally { setLoading(false); }
  }, [buildQuery]);

  useEffect(() => { load(0); }, [load]);

  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  const openDetail = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/line-defects/${id}`);
      const json = await res.json();
      if (res.ok) setDetail(json);
    } catch {}
  };

  const askDeletePhoto = (photoId) => { setDeletePhotoTarget({ photoId }); setDeleteError(''); };
  const cancelDelete = () => { setDeletePhotoTarget(null); setDeleteError(''); };

  const confirmDelete = async (password) => {
    if (!deletePhotoTarget) return;
    setDeleting(true); setDeleteError('');
    try {
      const res = await fetch(`${API_BASE}/api/line-defects/photo/${deletePhotoTarget.photoId}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 401) { setDeleteError('Введите пароль'); return; }
        if (res.status === 403) { setDeleteError('Неверный пароль'); return; }
        throw new Error(json.error || 'Ошибка удаления');
      }
      const deletedId = deletePhotoTarget.photoId;
      setDeletePhotoTarget(null);
      if (detail) setDetail({ ...detail, photos: detail.photos.filter(p => p.id !== deletedId) });
      load(page);
    } catch (e) { setDeleteError(e.message); }
    finally { setDeleting(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const cardStyle = {
    background: '#FFFFFF', borderRadius: 14, padding: isMobile ? 12 : 16,
    boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #F1F5F9',
    marginBottom: isMobile ? 12 : 20,
  };
  const inputStyle = {
    padding: isMobile ? '10px 12px' : '11px 14px',
    fontSize: 14, borderRadius: 9, border: '1px solid #E2E8F0',
    outline: 'none', background: '#FFF', boxSizing: 'border-box', width: '100%',
  };
  const labelStyle = {
    fontSize: 11, fontWeight: 700, color: '#64748B',
    textTransform: 'uppercase', marginBottom: 5, display: 'block', letterSpacing: 0.4,
  };

  return (
    /* ВНЕШНИЙ КОНТЕЙНЕР — на всю ширину, серый фон */
    <div style={{ width: '100%', minHeight: '100vh', background: '#F8FAFC' }}>
      {/* ВНУТРЕННИЙ КОНТЕЙНЕР — с ограничением ширины и центрированием */}
      <div style={{
        padding: isMobile ? 12 : 28,
        maxWidth: 1440, margin: '0 auto',
        fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: isMobile ? 12 : 20 }}>
          <h1 style={{ fontSize: isMobile ? 20 : 30, fontWeight: 900, color: '#0F172A', margin: 0 }}>
            Архив фото дефектов
          </h1>
          <span style={{ fontSize: isMobile ? 12 : 14, color: '#64748B', fontWeight: 500 }}>
            {total > 0 ? `${total} записей` : ''}
          </span>
        </div>

        {/* ---- Фильтры ---- */}
        <div style={cardStyle}>
          {/* Место занесения — большие кнопки */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Место занесения</label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, 1fr)',
              gap: 8,
            }}>
              <button
                onClick={() => set('capture_location', '')}
                style={{
                  padding: '10px 8px', borderRadius: 9,
                  border: filters.capture_location === '' ? '2px solid #1E293B' : '1px solid #E2E8F0',
                  background: filters.capture_location === '' ? '#1E293B' : '#FFF',
                  color: filters.capture_location === '' ? '#FFF' : '#475569',
                  fontSize: 13, fontWeight: 800, cursor: 'pointer', minHeight: 42,
                }}
              >Все</button>
              {LOCATIONS.map(loc => {
                const active = filters.capture_location === loc.code;
                return (
                  <button
                    key={loc.code}
                    onClick={() => set('capture_location', loc.code)}
                    style={{
                      padding: '10px 8px', borderRadius: 9,
                      border: active ? `2px solid ${loc.color}` : '1px solid #E2E8F0',
                      background: active ? loc.color : '#FFF',
                      color: active ? '#FFF' : '#475569',
                      fontSize: 12, fontWeight: 800, cursor: 'pointer', minHeight: 42,
                      lineHeight: 1.2, whiteSpace: 'nowrap',
                    }}
                  >{loc.label}</button>
                );
              })}
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
          }}>
            <div>
              <label style={labelStyle}>Дата с</label>
              <input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Дата по</label>
              <input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Модель</label>
              <select value={filters.model} onChange={(e) => set('model', e.target.value)} style={inputStyle}>
                <option value="">Все</option>
                {filterOptions.models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>VIN (можно последние 6)</label>
              <input
                value={filters.vin}
                onChange={(e) => set('vin', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17))}
                placeholder="напр. 044448 или полный"
                style={{ ...inputStyle, fontFamily: 'monospace', letterSpacing: '0.5px' }}
              />
            </div>
            <div>
              <label style={labelStyle}>Деталь</label>
              <input
                value={filters.part_name}
                onChange={(e) => set('part_name', e.target.value)}
                placeholder="часть названия"
                list="parts-list"
                style={inputStyle}
              />
              <datalist id="parts-list">
                {filterOptions.parts.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div>
              <label style={labelStyle}>Дефект</label>
              <input
                value={filters.problem_type}
                onChange={(e) => set('problem_type', e.target.value)}
                placeholder="часть названия"
                list="problems-list"
                style={inputStyle}
              />
              <datalist id="problems-list">
                {filterOptions.problems.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div style={{ gridColumn: isMobile ? 'span 2' : 'span 2' }}>
              <label style={labelStyle}>Общий поиск</label>
              <input
                value={filters.search}
                onChange={(e) => set('search', e.target.value)}
                placeholder="VIN, модель, деталь, дефект, комментарий…"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button onClick={() => load(0)} style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: '#2563EB', color: '#FFF', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Применить</button>
            <button
              onClick={() => setFilters({
                from: today, to: today,
                vin: '', model: '', part_name: '', problem_type: '',
                capture_location: '', search: '',
              })}
              style={{ padding: '10px 22px', borderRadius: 9, border: '1px solid #E2E8F0', background: '#FFF', color: '#475569', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
            >Сегодня</button>
            <button
              onClick={() => {
                const weekAgo = new Date(Date.now() - 7 * 86400000);
                const pad = (n) => String(n).padStart(2, '0');
                const w = `${weekAgo.getFullYear()}-${pad(weekAgo.getMonth() + 1)}-${pad(weekAgo.getDate())}`;
                setFilters(f => ({ ...f, from: w, to: today }));
              }}
              style={{ padding: '10px 22px', borderRadius: 9, border: '1px solid #E2E8F0', background: '#FFF', color: '#475569', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
            >7 дней</button>
          </div>
        </div>

        {error && (
          <div style={{ padding: 14, background: '#FEF2F2', color: '#991B1B', borderRadius: 10, marginBottom: 16, fontSize: 14, border: '1px solid #FECACA' }}>
            ⚠ {error}
          </div>
        )}

        {/* ---- Сетка ---- */}
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#64748B', fontSize: 15 }}>Загрузка…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94A3B8', fontSize: 15 }}>Ничего не найдено</div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: isMobile ? 12 : 18,
          }}>
            {items.map(it => {
              const firstPhoto = it.photos?.find(p => !p.deleted && p.url);
              return (
                <div
                  key={it.id}
                  onClick={() => openDetail(it.id)}
                  style={{
                    ...cardStyle, marginBottom: 0, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: 12,
                    transition: 'transform 0.15s, box-shadow 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.05)';
                  }}
                >
                  <div style={{ display: 'flex', gap: 14 }}>
                    <div style={{
                      width: isMobile ? 96 : 120, height: isMobile ? 96 : 120,
                      borderRadius: 10, overflow: 'hidden', background: '#F1F5F9', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#94A3B8', fontSize: 11, textAlign: 'center',
                    }}>
                      {firstPhoto ? (
                        <img src={`${API_BASE}${firstPhoto.url}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : 'нет фото'}
                    </div>
                    <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <LocationBadge code={it.capture_location} />
                        <span style={{ fontSize: 13, fontFamily: 'monospace', color: '#2563EB', fontWeight: 700, letterSpacing: 0.5 }}>
                          {it.vin}
                        </span>
                      </div>
                      <div style={{ fontSize: 14, color: '#1E293B', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.model}
                      </div>
                      <div style={{ fontSize: 13, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        🔧 {it.part_name}
                      </div>
                      <div style={{ fontSize: 13, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        ⚠ {it.problem_type}
                      </div>
                      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 'auto', paddingTop: 4 }}>
                        🕐 {fmtDate(it.created_at)}
                        {it.photos?.length > 1 && <span style={{ marginLeft: 10 }}>📷 {it.photos.length}</span>}
                      </div>
                    </div>
                  </div>
                  {it.comment && (
                    <div style={{ fontSize: 12, color: '#475569', fontStyle: 'italic', padding: '8px 10px', background: '#F8FAFC', borderRadius: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      «{it.comment}»
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ---- Пагинация ---- */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 24, paddingBottom: 24 }}>
            <button onClick={() => load(Math.max(0, page - 1))} disabled={page === 0 || loading}
              style={{ padding: '10px 20px', borderRadius: 9, border: '1px solid #E2E8F0', background: '#FFF', color: '#475569', fontWeight: 700, fontSize: 14, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>← Назад</button>
            <span style={{ fontSize: 14, color: '#475569', fontWeight: 600 }}>{page + 1} / {totalPages}</span>
            <button onClick={() => load(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1 || loading}
              style={{ padding: '10px 20px', borderRadius: 9, border: '1px solid #E2E8F0', background: '#FFF', color: '#475569', fontWeight: 700, fontSize: 14, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', opacity: page >= totalPages - 1 ? 0.4 : 1 }}>Вперёд →</button>
          </div>
        )}

        {/* ---- Модалка деталей ---- */}
        {detail && (
          <div onClick={() => setDetail(null)} style={{
            position: 'fixed', inset: 0, zIndex: 9600,
            background: 'rgba(15,23,42,0.75)',
            display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
            padding: isMobile ? 0 : 20,
          }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              background: '#FFF', borderRadius: isMobile ? '16px 16px 0 0' : 16,
              width: '100%', maxWidth: isMobile ? '100%' : 720,
              maxHeight: isMobile ? '92vh' : '90vh',
              overflow: 'auto', padding: isMobile ? 18 : 28,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div style={{ fontSize: isMobile ? 17 : 22, fontWeight: 900, color: '#0F172A' }}>
                  Дефект #{detail.id}
                </div>
                <button onClick={() => setDetail(null)} style={{ border: 'none', background: 'transparent', fontSize: 26, cursor: 'pointer', color: '#94A3B8', lineHeight: 1, padding: 0 }}>×</button>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                gap: '10px 24px', fontSize: 14, color: '#475569',
                marginBottom: 20, lineHeight: 1.6,
              }}>
                {detail.capture_location && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, gridColumn: '1 / -1' }}>
                    <b>Место:</b> <LocationBadge code={detail.capture_location} />
                  </div>
                )}
                <div><b>VIN:</b> <span style={{ fontFamily: 'monospace', color: '#2563EB', fontWeight: 700 }}>{detail.vin}</span></div>
                <div><b>Модель:</b> {detail.model}</div>
                <div><b>Деталь:</b> {detail.part_name}</div>
                <div><b>Дефект:</b> {detail.problem_type}</div>
                <div><b>Создан:</b> {fmtDate(detail.created_at)}</div>
                <div><b>Способ:</b> {detail.entry_mode === 'barcode' ? '📷 сканер' : '✍️ вручную'}</div>
                {detail.comment && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <b>Комментарий:</b> {detail.comment}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {detail.photos?.map(p => (
                  <div key={p.id} style={{ position: 'relative', width: 130, height: 130 }}>
                    <div style={{ width: '100%', height: '100%', borderRadius: 10, overflow: 'hidden', background: '#F1F5F9' }}>
                      {p.deleted || !p.url ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 11, padding: 8, textAlign: 'center' }}>
                          фото удалено<br />(9 мес)
                        </div>
                      ) : (
                        <img src={`${API_BASE}${p.url}`} alt="" onClick={() => setLightbox(`${API_BASE}${p.url}`)} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }} />
                      )}
                    </div>
                    {!p.deleted && p.url && (
                      <button onClick={() => askDeletePhoto(p.id)} title="Удалить фото" style={{
                        position: 'absolute', top: -6, right: -6, width: 26, height: 26, borderRadius: '50%',
                        border: '2px solid #FFF', background: '#DC2626', color: '#FFF',
                        fontSize: 14, fontWeight: 800, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0,
                      }}>×</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Lightbox */}
        {lightbox && (
          <div onClick={() => setLightbox(null)} style={{
            position: 'fixed', inset: 0, zIndex: 9700,
            background: 'rgba(15,23,42,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}>
            <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '95vw', maxHeight: '95vh', borderRadius: 12 }} />
            <button onClick={() => setLightbox(null)} style={{
              position: 'fixed', top: 20, right: 24, width: 44, height: 44, borderRadius: '50%',
              border: 'none', background: 'rgba(255,255,255,0.15)', color: '#FFF', fontSize: 24, cursor: 'pointer',
            }}>×</button>
          </div>
        )}

        {deletePhotoTarget && (
          <PasswordModal
            text="Удаление фото дефекта. Действие необратимо."
            error={deleteError}
            busy={deleting}
            onConfirm={confirmDelete}
            onCancel={cancelDelete}
          />
        )}
      </div>
    </div>
  );
}