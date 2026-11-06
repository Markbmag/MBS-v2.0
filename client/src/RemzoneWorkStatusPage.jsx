import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';

const API_BASE = '';

/* ===================== ХЕЛПЕРЫ ===================== */
function toLocalDateStr(d) {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}
function formatDateDDMM(date) {
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function getDayOfWeekShort(date) {
  return ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][new Date(date).getDay()];
}
function getTodayStr() { return toLocalDateStr(new Date()); }
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
}
function formatDateTime(str) {
  if (!str) return '—';
  const s = String(str).replace('T', ' ');
  return s.slice(0, 19);
}

/* ===================== СТИЛИ ===================== */
const containerStyle = {
  padding: '16px',
  fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
  width: '100%',
  height: '100vh',
  boxSizing: 'border-box',
  backgroundColor: '#FFFFFF',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '12px',
  flexWrap: 'wrap',
  gap: 10,
  flexShrink: 0,
};

const titleStyle = {
  fontSize: '1.6rem',
  fontWeight: 900,
  color: '#0F172A',
  margin: 0,
  letterSpacing: '-0.02em',
};

const cardStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 12,
  padding: 12,
  border: '1px solid #E2E8F0',
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

const inputStyle = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid #CBD5E1',
  fontSize: 13,
  background: '#FFFFFF',
  outline: 'none',
};

const mainTabStyle = (active) => ({
  padding: '8px 16px',
  borderRadius: 10,
  border: 'none',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  background: active ? 'linear-gradient(135deg,#2563EB,#1D4ED8)' : '#F1F5F9',
  color: active ? '#FFFFFF' : '#475569',
  transition: 'all 0.15s',
  boxShadow: active ? '0 4px 10px rgba(37,99,235,0.25)' : 'none',
});

const filterBarStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center',
  marginBottom: 10,
  padding: 10,
  backgroundColor: '#F8FAFC',
  borderRadius: 10,
  flexShrink: 0,
};

const filterLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  color: '#475569',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const navBtnStyle = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  color: '#334155',
};

const tableWrapStyle = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  border: '1px solid #E2E8F0',
  borderRadius: 10,
  background: '#FFFFFF',
};

/* ---------- Единая синяя палитра для шапки ---------- */
const HEADER_BG_DARK   = 'linear-gradient(180deg,#1E40AF 0%,#1E3A8A 100%)';
const HEADER_BG_MAIN   = 'linear-gradient(180deg,#2563EB 0%,#1D4ED8 100%)';
const HEADER_BG_ACCENT = 'linear-gradient(180deg,#1D4ED8 0%,#1E3A8A 100%)';
const HEADER_BG_ACTIVE = 'linear-gradient(180deg,#0EA5E9 0%,#0284C7 100%)';

/* ---------- Базовые th ---------- */
const thBaseStyle = {
  padding: '6px 5px',
  textAlign: 'center',
  fontWeight: 700,
  color: '#FFFFFF',
  fontSize: 11,
  position: 'sticky',
  top: 0,
  zIndex: 5,
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  borderRight: '1px solid rgba(255,255,255,0.15)',
  borderBottom: '1px solid rgba(0,0,0,0.15)',
};

const thMainLeftStyle = {
  ...thBaseStyle,
  textAlign: 'left',
  background: HEADER_BG_DARK,
  minWidth: 90,
  paddingLeft: 10,
};

const thDayStyle = {
  ...thBaseStyle,
  background: HEADER_BG_MAIN,
  minWidth: 58,
  padding: '5px 3px',
};

const thCWStyle = {
  ...thBaseStyle,
  background: HEADER_BG_ACCENT,
  minWidth: 58,
  padding: '5px 4px',
};

const thTotalStyle = {
  ...thBaseStyle,
  background: HEADER_BG_ACCENT,
  minWidth: 56,
  padding: '6px 8px',
};

const thHourStyle = {
  padding: '4px 2px',
  textAlign: 'center',
  fontWeight: 700,
  color: '#FFFFFF',
  background: HEADER_BG_MAIN,
  fontSize: 9,
  position: 'sticky',
  top: 0,
  zIndex: 5,
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  borderRight: '1px solid rgba(255,255,255,0.15)',
  borderBottom: '1px solid rgba(0,0,0,0.15)',
  minWidth: 32,
  cursor: 'pointer',
  userSelect: 'none',
};

/* ---------- td ---------- */
const tdBaseStyle = {
  padding: '5px 6px',
  borderBottom: '1px solid #F1F5F9',
  borderRight: '1px solid #F1F5F9',
  color: '#1E293B',
  fontSize: 12,
  textAlign: 'center',
  whiteSpace: 'nowrap',
};
const tdLeftStyle = { ...tdBaseStyle, textAlign: 'left', fontWeight: 600 };
const tdTotalCellStyle = {
  ...tdBaseStyle,
  fontWeight: 800,
  background: '#EFF6FF',
  color: '#1D4ED8',
};
const tdCWCellStyle = {
  ...tdBaseStyle,
  fontWeight: 700,
  background: '#F8FAFC',
  color: '#1E40AF',
};

const tdClickableStyle = {
  cursor: 'pointer',
  textDecoration: 'underline dotted',
  textDecorationColor: 'rgba(29,78,216,0.35)',
  textUnderlineOffset: 2,
};

/* ---------- Кнопка часов ---------- */
const hoursBtnStyle = {
  fontSize: 9,
  padding: '1px 5px',
  marginTop: 1,
  borderRadius: 5,
  border: '1px solid rgba(255,255,255,0.35)',
  background: 'rgba(255,255,255,0.12)',
  color: '#FFFFFF',
  cursor: 'pointer',
  fontWeight: 600,
  lineHeight: 1.2,
};

const hourlyBtnActiveStyle = {
  padding: '4px 9px',
  borderRadius: 6,
  border: '1px solid #1D4ED8',
  background: 'linear-gradient(135deg,#2563EB,#1D4ED8)',
  color: '#FFFFFF',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};
const hourlyBtnStyle = {
  padding: '4px 9px',
  borderRadius: 6,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#334155',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

/* ---------- Модалка ---------- */
const modalOverlayStyle = {
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(15,23,42,0.6)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2000,
  padding: 20,
};

const modalStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
  width: '100%',
  maxWidth: 1000,
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const modalHeaderStyle = {
  padding: '16px 20px',
  borderBottom: '1px solid #E2E8F0',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  background: 'linear-gradient(180deg,#F8FAFC,#FFFFFF)',
};

const modalTitleStyle = {
  margin: 0,
  fontSize: '1.1rem',
  fontWeight: 800,
  color: '#0F172A',
};

const modalCloseStyle = {
  background: 'transparent',
  border: 'none',
  fontSize: 22,
  cursor: 'pointer',
  color: '#64748B',
  lineHeight: 1,
};

const modalBodyStyle = {
  padding: 0,
  overflow: 'auto',
  flex: 1,
  minHeight: 0,
};

const detailThStyle = {
  padding: '10px 12px',
  textAlign: 'left',
  fontWeight: 700,
  color: '#FFFFFF',
  background: HEADER_BG_MAIN,
  fontSize: 12,
  position: 'sticky',
  top: 0,
  zIndex: 3,
  whiteSpace: 'nowrap',
  borderRight: '1px solid rgba(255,255,255,0.15)',
};

const detailTdStyle = {
  padding: '8px 12px',
  borderBottom: '1px solid #F1F5F9',
  borderRight: '1px solid #F1F5F9',
  color: '#1E293B',
  fontSize: 13,
  whiteSpace: 'nowrap',
};

/* ===================== КОМПОНЕНТ ===================== */
export default function RemzoneWorkStatusPage() {
  const [mode, setMode] = useState('daily');
  const [hourlyDate, setHourlyDate] = useState(getTodayStr());
  const [sortDay, setSortDay] = useState(null);
  const [sortWeek, setSortWeek] = useState(null);
  const [sortTotal, setSortTotal] = useState('desc');
  const [sortHour, setSortHour] = useState(null);

  const [periodStart, setPeriodStart] = useState(() => {
    const mondayThisWeek = getMonday(new Date());
    const mondayPrev = new Date(mondayThisWeek);
    mondayPrev.setDate(mondayPrev.getDate() - 7);
    return toLocalDateStr(mondayPrev);
  });

  const dateFrom = periodStart;
  const dateTo = useMemo(() => addDays(periodStart, 13), [periodStart]);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // Фильтр «Только с партномером» (MISS_PART). По умолчанию выключен.
  const [withPartNumber, setWithPartNumber] = useState(false);

  // Модалка с деталями
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsContext, setDetailsContext] = useState(null);
  const [detailsList, setDetailsList] = useState([]);

  const daysList = useMemo(() => {
    const days = [];
    for (let i = 0; i < 14; i++) days.push(addDays(periodStart, i));
    return days;
  }, [periodStart]);

  const prevWeekDays = daysList.slice(0, 7);
  const currWeekDays = daysList.slice(7, 14);
  const prevWeekNum = prevWeekDays[0] ? getWeekNumber(new Date(prevWeekDays[0] + 'T12:00:00')) : 0;
  const currWeekNum = currWeekDays[0] ? getWeekNumber(new Date(currWeekDays[0] + 'T12:00:00')) : 0;

  /* ================ ЗАГРУЗКА ================ */
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const pnParam = withPartNumber ? '&withPartNumber=true' : '';
        const url = mode === 'daily'
          ? `${API_BASE}/api/remzone-work-status/daily?dateFrom=${dateFrom}&dateTo=${dateTo}${pnParam}`
          : `${API_BASE}/api/remzone-work-status/hourly?date=${hourlyDate}${pnParam}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Ошибка загрузки');
        const json = await res.json();
        if (!cancelled) setRows(json.rows || []);
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [mode, dateFrom, dateTo, hourlyDate, withPartNumber]);

  /* ================ ФИЛЬТР + СОРТИРОВКА ================ */
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.person_name || '').toLowerCase().includes(q) ||
      (r.person_account || '').toLowerCase().includes(q) ||
      (r.repair_account || '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  const sortedRows = useMemo(() => {
    const copy = [...filteredRows];

    if (mode === 'daily') {
      if (sortDay) {
        copy.sort((a, b) => (b.days?.[sortDay] || 0) - (a.days?.[sortDay] || 0));
      } else if (sortWeek) {
        const days = sortWeek === 'prev' ? prevWeekDays : currWeekDays;
        copy.sort((a, b) => {
          const sa = days.reduce((s, d) => s + (a.days?.[d] || 0), 0);
          const sb = days.reduce((s, d) => s + (b.days?.[d] || 0), 0);
          return sb - sa;
        });
      } else {
        copy.sort((a, b) => sortTotal === 'desc'
          ? (b.total || 0) - (a.total || 0)
          : (a.total || 0) - (b.total || 0));
      }
    } else {
      if (sortHour !== null) {
        copy.sort((a, b) => (b.hours?.[sortHour] || 0) - (a.hours?.[sortHour] || 0));
      } else {
        copy.sort((a, b) => sortTotal === 'desc'
          ? (b.total || 0) - (a.total || 0)
          : (a.total || 0) - (b.total || 0));
      }
    }
    return copy;
  }, [filteredRows, mode, sortDay, sortWeek, sortTotal, sortHour, prevWeekDays, currWeekDays]);

  /* ================ ЭКСПОРТ ================ */
  const handleExport = () => {
    if (sortedRows.length === 0) return;
    let exportData;

    if (mode === 'daily') {
      exportData = sortedRows.map(r => {
        const obj = {
          'Акк. сотр.': r.person_account || r.repair_account || '',
          'Сотрудник': r.person_name || r.repair_person || '',
        };
        daysList.forEach(d => { obj[formatDateDDMM(d)] = r.days?.[d] || 0; });
        obj['Итого'] = r.total;
        return obj;
      });
    } else {
      exportData = sortedRows.map(r => {
        const obj = {
          'Акк. сотр.': r.person_account || r.repair_account || '',
          'Сотрудник': r.person_name || r.repair_person || '',
        };
        for (let h = 0; h < 24; h++) {
          const lbl = `${String(h).padStart(2, '0')}:00-${String(h + 1).padStart(2, '0')}:00`;
          obj[lbl] = r.hours?.[h] || 0;
        }
        obj['Итого'] = r.total;
        return obj;
      });
    }

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Remzone');
    XLSX.writeFile(wb, `Remzone_${mode}${withPartNumber ? '_PN' : ''}_${toLocalDateStr(new Date())}.xlsx`);
  };

  /* ================ ОТКРЫТИЕ ДЕТАЛЕЙ ================ */
  const openDetails = async (row, date, hour) => {
    const person = row.repair_person;
    if (!person) return;

    setDetailsContext({
      person,
      name: row.person_name || row.repair_person || '—',
      account: row.person_account || row.repair_account || '—',
      date,
      hour,
    });
    setDetailsList([]);
    setDetailsLoading(true);
    setDetailsOpen(true);

    try {
      const params = new URLSearchParams({ repair_person: person, date });
      if (hour !== undefined && hour !== null) params.append('hour', hour);
      if (withPartNumber) params.append('withPartNumber', 'true');
      const res = await fetch(`${API_BASE}/api/remzone-work-status/details?${params}`);
      if (!res.ok) throw new Error('Ошибка загрузки деталей');
      const json = await res.json();
      setDetailsList(json.rows || []);
    } catch (err) {
      console.error(err);
      setDetailsList([]);
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeDetails = () => {
    setDetailsOpen(false);
    setDetailsContext(null);
    setDetailsList([]);
  };

  /* ================ СОРТИРОВКА / НАВИГАЦИЯ ================ */
  const handleDayHeaderClick = (dateStr) => {
    setSortWeek(null);
    setSortDay(prev => (prev === dateStr ? null : dateStr));
  };
  const handleWeekHeaderClick = (week) => {
    setSortDay(null);
    setSortWeek(prev => (prev === week ? null : week));
  };
  const handleTotalHeaderClick = () => {
    setSortDay(null);
    setSortWeek(null);
    setSortHour(null);
    setSortTotal(prev => (prev === 'desc' ? 'asc' : 'desc'));
  };
  const handleHourHeaderClick = (h) => {
    setSortTotal('desc');
    setSortHour(prev => (prev === h ? null : h));
  };
  const handleOpenHourly = (dateStr, e) => {
    e.stopPropagation();
    setHourlyDate(dateStr);
    setMode('hourly');
  };

  /* ================ РЕНДЕР ================ */
  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>Remzone Work Status</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={mainTabStyle(mode === 'daily')} onClick={() => setMode('daily')}>📅 По дням</button>
          <button style={mainTabStyle(mode === 'hourly')} onClick={() => setMode('hourly')}>🕐 По часам (за день)</button>
          <button
            style={{ ...mainTabStyle(false), background: 'linear-gradient(135deg,#059669,#10B981)', color: '#FFF' }}
            onClick={handleExport}
          >📊 Экспорт</button>
        </div>
      </div>

      <div style={cardStyle}>
        {/* Фильтр-бар */}
        <div style={filterBarStyle}>
          {mode === 'daily' ? (
            <>
              <button style={navBtnStyle} onClick={() => setPeriodStart(addDays(periodStart, -14))}>◀ 2 недели</button>
              <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 13 }}>
                {formatDateDDMM(new Date(periodStart + 'T12:00:00'))} — {formatDateDDMM(new Date(dateTo + 'T12:00:00'))}
                <span style={{ marginLeft: 8, fontWeight: 500, color: '#64748B' }}>(CW{prevWeekNum} – CW{currWeekNum})</span>
              </div>
              <button style={navBtnStyle} onClick={() => setPeriodStart(addDays(periodStart, 14))}>2 недели ▶</button>
              <button
                style={{ ...navBtnStyle, background: '#EFF6FF', borderColor: '#93C5FD', color: '#1D4ED8' }}
                onClick={() => {
                  const mondayThisWeek = getMonday(new Date());
                  const mondayPrev = new Date(mondayThisWeek);
                  mondayPrev.setDate(mondayPrev.getDate() - 7);
                  setPeriodStart(toLocalDateStr(mondayPrev));
                }}
              >Текущие 2 недели</button>
            </>
          ) : (
            <>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#0F172A', marginRight: 4 }}>День:</span>
              {daysList.map(d => (
                <button
                  key={d}
                  onClick={() => setHourlyDate(d)}
                  style={hourlyDate === d ? hourlyBtnActiveStyle : hourlyBtnStyle}
                  title={d}
                >
                  {formatDateDDMM(new Date(d + 'T12:00:00'))} {getDayOfWeekShort(new Date(d + 'T12:00:00'))}
                </button>
              ))}
            </>
          )}

          {/* ФИЛЬТР: только с партномером (MISS_PART) */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              padding: '4px 10px',
              borderRadius: 8,
              background: withPartNumber ? '#EFF6FF' : '#FFFFFF',
              border: `1px solid ${withPartNumber ? '#93C5FD' : '#CBD5E1'}`,
              fontSize: 13,
              fontWeight: 600,
              color: withPartNumber ? '#1D4ED8' : '#475569',
              userSelect: 'none',
            }}
            title="Считать только дефекты, у которых заполнен партномер (MISS_PART)"
          >
            <input
              type="checkbox"
              checked={withPartNumber}
              onChange={e => setWithPartNumber(e.target.checked)}
              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#2563EB' }}
            />
            Только с партномером
          </label>

          <label style={{ ...filterLabelStyle, marginLeft: 'auto' }}>
            Поиск:
            <input
              type="text"
              placeholder="ФИО, аккаунт"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...inputStyle, minWidth: 180 }}
            />
          </label>
          <div style={{ fontSize: 12, color: '#64748B' }}>
            Сотрудников: <b>{sortedRows.length}</b>
          </div>
        </div>

        {/* Таблица */}
        <div style={tableWrapStyle}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>Загрузка...</div>
          ) : sortedRows.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>Нет данных за выбранный период</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                {mode === 'daily' ? (
                  <tr>
                    <th style={thMainLeftStyle}>Акк. сотр. дораб.</th>
                    <th style={thMainLeftStyle}>Сотрудник дораб. в линии</th>

                    {prevWeekDays.map(d => {
                      const isSorted = sortDay === d;
                      return (
                        <th key={d} style={{ ...thDayStyle, background: isSorted ? HEADER_BG_ACTIVE : HEADER_BG_MAIN }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                            <div
                              style={{ cursor: 'pointer', userSelect: 'none', fontWeight: 800, fontSize: 11 }}
                              onClick={() => handleDayHeaderClick(d)}
                            >
                              {formatDateDDMM(new Date(d + 'T12:00:00'))} {isSorted && '▼'}
                            </div>
                            <div style={{ fontSize: 9, fontWeight: 500, opacity: 0.9 }}>
                              {getDayOfWeekShort(new Date(d + 'T12:00:00'))}
                            </div>
                            <button
                              style={hoursBtnStyle}
                              onClick={(e) => handleOpenHourly(d, e)}
                              title="Показать по часам"
                            >🕐</button>
                          </div>
                        </th>
                      );
                    })}

                    <th
                      style={{
                        ...thCWStyle,
                        cursor: 'pointer',
                        background: sortWeek === 'prev' ? HEADER_BG_ACTIVE : HEADER_BG_ACCENT,
                      }}
                      onClick={() => handleWeekHeaderClick('prev')}
                    >
                      CW{prevWeekNum} {sortWeek === 'prev' && '▼'}
                    </th>

                    {currWeekDays.map(d => {
                      const isSorted = sortDay === d;
                      return (
                        <th key={d} style={{ ...thDayStyle, background: isSorted ? HEADER_BG_ACTIVE : HEADER_BG_MAIN }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                            <div
                              style={{ cursor: 'pointer', userSelect: 'none', fontWeight: 800, fontSize: 11 }}
                              onClick={() => handleDayHeaderClick(d)}
                            >
                              {formatDateDDMM(new Date(d + 'T12:00:00'))} {isSorted && '▼'}
                            </div>
                            <div style={{ fontSize: 9, fontWeight: 500, opacity: 0.9 }}>
                              {getDayOfWeekShort(new Date(d + 'T12:00:00'))}
                            </div>
                            <button
                              style={hoursBtnStyle}
                              onClick={(e) => handleOpenHourly(d, e)}
                              title="Показать по часам"
                            >🕐</button>
                          </div>
                        </th>
                      );
                    })}

                    <th
                      style={{
                        ...thCWStyle,
                        cursor: 'pointer',
                        background: sortWeek === 'curr' ? HEADER_BG_ACTIVE : HEADER_BG_ACCENT,
                      }}
                      onClick={() => handleWeekHeaderClick('curr')}
                    >
                      CW{currWeekNum} {sortWeek === 'curr' && '▼'}
                    </th>

                    <th
                      style={{ ...thTotalStyle, cursor: 'pointer', background: (sortDay || sortWeek) ? HEADER_BG_ACCENT : HEADER_BG_ACTIVE }}
                      onClick={handleTotalHeaderClick}
                      title="Сортировать по итогу"
                    >
                      Итого {!sortDay && !sortWeek && (sortTotal === 'desc' ? '▼' : '▲')}
                    </th>
                  </tr>
                ) : (
                  <tr>
                    <th style={{ ...thMainLeftStyle, rowSpan: 2, minWidth: 80 }}>Акк. сотр. дораб.</th>
                    <th style={{ ...thMainLeftStyle, rowSpan: 2, minWidth: 130 }}>Сотрудник дораб. в линии</th>

                    {Array.from({ length: 24 }, (_, h) => {
                      const isSorted = sortHour === h;
                      return (
                        <th
                          key={h}
                          style={{ ...thHourStyle, background: isSorted ? HEADER_BG_ACTIVE : HEADER_BG_MAIN }}
                          onClick={() => handleHourHeaderClick(h)}
                          title="Сортировать по этому часу"
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.05 }}>
                            <div>{String(h).padStart(2, '0')}:00-</div>
                            <div>
                              {String(h + 1).padStart(2, '0')}:00 {isSorted && '▼'}
                            </div>
                          </div>
                        </th>
                      );
                    })}

                    <th
                      style={{
                        ...thTotalStyle,
                        rowSpan: 2,
                        cursor: 'pointer',
                        background: sortHour !== null ? HEADER_BG_ACCENT : HEADER_BG_ACTIVE,
                      }}
                      onClick={handleTotalHeaderClick}
                      title="Сортировать по итогу"
                    >
                      Итого {sortHour === null && (sortTotal === 'desc' ? '▼' : '▲')}
                    </th>
                  </tr>
                )}
              </thead>

              <tbody>
                {sortedRows.map((row, idx) => {
                  const account = row.person_account || row.repair_account || '—';
                  const name = row.person_name || row.repair_person || '—';
                  const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';

                  if (mode === 'daily') {
                    return (
                      <tr key={idx} style={{ backgroundColor: bg }}>
                        <td style={tdLeftStyle}>{account}</td>
                        <td style={tdLeftStyle}>{name}</td>

                        {prevWeekDays.map(d => {
                          const val = row.days?.[d] || 0;
                          return (
                            <td
                              key={d}
                              style={{
                                ...tdBaseStyle,
                                ...(val > 0 ? tdClickableStyle : {}),
                                color: val > 0 ? '#1D4ED8' : '#CBD5E1',
                                fontWeight: val > 0 ? 700 : 400,
                              }}
                              onClick={() => val > 0 && openDetails(row, d, null)}
                              title={val > 0 ? 'Показать детали' : ''}
                            >
                              {val > 0 ? val : '·'}
                            </td>
                          );
                        })}

                        <td style={tdCWCellStyle}>
                          {prevWeekDays.reduce((s, d) => s + (row.days?.[d] || 0), 0) || '·'}
                        </td>

                        {currWeekDays.map(d => {
                          const val = row.days?.[d] || 0;
                          return (
                            <td
                              key={d}
                              style={{
                                ...tdBaseStyle,
                                ...(val > 0 ? tdClickableStyle : {}),
                                color: val > 0 ? '#1D4ED8' : '#CBD5E1',
                                fontWeight: val > 0 ? 700 : 400,
                              }}
                              onClick={() => val > 0 && openDetails(row, d, null)}
                              title={val > 0 ? 'Показать детали' : ''}
                            >
                              {val > 0 ? val : '·'}
                            </td>
                          );
                        })}

                        <td style={tdCWCellStyle}>
                          {currWeekDays.reduce((s, d) => s + (row.days?.[d] || 0), 0) || '·'}
                        </td>

                        <td style={tdTotalCellStyle}>{row.total || 0}</td>
                      </tr>
                    );
                  } else {
                    return (
                      <tr key={idx} style={{ backgroundColor: bg }}>
                        <td style={tdLeftStyle}>{account}</td>
                        <td style={tdLeftStyle}>{name}</td>
                        {Array.from({ length: 24 }, (_, h) => {
                          const val = row.hours?.[h] || 0;
                          return (
                            <td
                              key={h}
                              style={{
                                ...tdBaseStyle,
                                ...(val > 0 ? tdClickableStyle : {}),
                                padding: '5px 2px',
                                color: val > 0 ? '#1D4ED8' : '#CBD5E1',
                                fontWeight: val > 0 ? 700 : 400,
                                minWidth: 32,
                                fontSize: 11,
                              }}
                              onClick={() => val > 0 && openDetails(row, hourlyDate, h)}
                              title={val > 0 ? 'Показать детали' : ''}
                            >
                              {val > 0 ? val : '·'}
                            </td>
                          );
                        })}
                        <td style={tdTotalCellStyle}>{row.total || 0}</td>
                      </tr>
                    );
                  }
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Модальное окно с деталями */}
      {detailsOpen && detailsContext && (
        <div style={modalOverlayStyle} onClick={closeDetails}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={modalTitleStyle}>
                  {detailsContext.name}
                  <span style={{ marginLeft: 10, fontWeight: 500, color: '#64748B', fontSize: 13 }}>
                    ({detailsContext.account})
                  </span>
                </h3>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
                  {detailsContext.date}
                  {detailsContext.hour !== null && detailsContext.hour !== undefined && (
                    <> · {String(detailsContext.hour).padStart(2, '0')}:00–{String(detailsContext.hour + 1).padStart(2, '0')}:00</>
                  )}
                  {' · '}
                  Всего: <b>{detailsList.length}</b>
                </div>
              </div>
              <button style={modalCloseStyle} onClick={closeDetails} title="Закрыть">✕</button>
            </div>

            <div style={modalBodyStyle}>
              {detailsLoading ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>Загрузка...</div>
              ) : detailsList.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>Нет данных</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...detailThStyle, width: 60, textAlign: 'center' }}>№</th>
                      <th style={detailThStyle}>Время ремонта</th>
                      <th style={detailThStyle}>Модель</th>
                      <th style={detailThStyle}>Деталь</th>
                      <th style={detailThStyle}>Дефект</th>
                      {withPartNumber && <th style={detailThStyle}>Партномер</th>}
                      <th style={detailThStyle}>VIN</th>
                      <th style={detailThStyle}>Пост</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailsList.map((d, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                        <td style={{ ...detailTdStyle, textAlign: 'center', color: '#94A3B8' }}>{i + 1}</td>
                        <td style={{ ...detailTdStyle, fontFamily: 'monospace' }}>{formatDateTime(d.repair_time)}</td>
                        <td style={detailTdStyle}>{d.model}</td>
                        <td style={detailTdStyle}>{d.part_name}</td>
                        <td style={detailTdStyle}>{d.problem_type}</td>
                        {withPartNumber && (
                          <td style={{ ...detailTdStyle, fontFamily: 'monospace', color: '#1D4ED8', fontWeight: 600 }}>
                            {d.miss_part || '—'}
                          </td>
                        )}
                        <td style={{ ...detailTdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{d.vin}</td>
                        <td style={detailTdStyle}>{d.post_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}