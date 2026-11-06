import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList
} from 'recharts';
import * as XLSX from 'xlsx';

const API_BASE = '';

/* ===================== БРЕНДБУК ===================== */
const BRAND = {
  bg: '#FFFFFF', cardBg: '#FFFFFF', primary: '#2563EB', accent: '#F59E0B',
  text: '#1E293B', textSecondary: '#64748B', border: '#E2E8F0',
  shadow: '0 4px 12px rgba(0,0,0,0.04)', radius: 16, radiusSmall: 8,
  fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
};

/* ===================== ОБЩИЕ СТИЛИ ===================== */
const containerStyle = {
  padding: '20px', fontFamily: BRAND.fontFamily, width: '100%', height: '100vh',
  boxSizing: 'border-box', backgroundColor: BRAND.bg, display: 'flex',
  flexDirection: 'column', overflow: 'hidden',
};
const headerStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  marginBottom: '20px', flexShrink: 0, flexWrap: 'wrap', gap: '10px',
};
const titleStyle = {
  fontSize: '2.5rem', fontWeight: 900, color: BRAND.text, margin: 0,
};
const tabBarStyle = {
  display: 'flex', gap: '6px', background: '#E2E8F0', borderRadius: 12,
  padding: '6px', width: 'fit-content', flexWrap: 'wrap',
};
const tabStyle = (active) => ({
  padding: '10px 28px', borderRadius: 10, border: 'none', fontWeight: 700,
  fontSize: '1.4rem', background: active ? '#FFFFFF' : 'transparent',
  color: active ? BRAND.text : BRAND.textSecondary, cursor: 'pointer',
  boxShadow: active ? '0 2px 8px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.2s',
});
const subTabStyle = (active) => ({
  padding: '8px 20px', borderRadius: 8, border: 'none', fontWeight: 600,
  fontSize: '1.2rem', background: active ? BRAND.primary : '#E2E8F0',
  color: active ? '#FFFFFF' : BRAND.textSecondary, cursor: 'pointer', transition: 'all 0.2s',
});
const cardStyle = {
  backgroundColor: BRAND.cardBg, borderRadius: BRAND.radius, padding: 20,
  boxShadow: BRAND.shadow, border: `1px solid ${BRAND.border}`, flex: 1,
  minHeight: 0, display: 'flex', flexDirection: 'column',
};
const inputStyle = {
  padding: '8px 12px', borderRadius: BRAND.radiusSmall,
  border: `1px solid ${BRAND.border}`, fontSize: 14, background: '#F9FAFB', outline: 'none',
};
const buttonStyle = {
  padding: '8px 20px', borderRadius: BRAND.radiusSmall, border: 'none',
  background: BRAND.primary, color: 'white', fontWeight: 600, fontSize: 14, cursor: 'pointer',
};
const thStyle = {
  padding: '14px 16px', textAlign: 'left', fontWeight: 700, color: '#FFFFFF',
  background: BRAND.primary, fontSize: '1.1rem', textTransform: 'uppercase',
  position: 'sticky', top: 0, zIndex: 10, whiteSpace: 'nowrap',
};
const tdStyle = {
  padding: '10px 16px', borderBottom: `1px solid ${BRAND.border}`,
  color: BRAND.text, fontSize: '1rem',
};
const modalOverlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 2000, padding: '20px',
};
const modalStyle = {
  backgroundColor: '#FFFFFF', borderRadius: '24px',
  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', width: '100%',
  maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto', padding: '32px',
  fontFamily: BRAND.fontFamily, color: BRAND.text, boxSizing: 'border-box',
  border: '1px solid rgba(255,255,255,0.5)',
};
const wideModalStyle = { ...modalStyle, maxWidth: '720px' };

/* ===================== ХЕЛПЕРЫ ===================== */
const toLocalDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const getTodayStr = () => toLocalDateStr(new Date());

const getDefectColor = (v) =>
  v === 0 ? '#00B050' : v <= 4 ? '#92D050' : v <= 8 ? '#FFFF00' : v <= 15 ? '#FFC000' : '#FF0000';
const getDPUColor = (v) =>
  v === 0 ? '#00B050' : v <= 100 ? '#92D050' : v <= 200 ? '#FFFF00' : v <= 300 ? '#FFC000' : '#FF0000';

const getWeekNumber = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};
const getMonday = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
};
const formatDateDDMM = (date) => {
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const getDayOfWeekFromDate = (date) =>
  ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][new Date(date).getDay()];

/* ===================== МУЛЬТИСЕЛЕКТ ===================== */
function MultiSelect({ options, selected, onChange, placeholder, width = 140 }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const nonAllOptions = options.filter((o) => o !== 'ALL');
  const allSelected = selected.length === nonAllOptions.length && nonAllOptions.length > 0;

  const handleToggle = (value) => {
    if (value === 'ALL') onChange(allSelected ? [] : nonAllOptions);
    else onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const displayText = selected.length === 0 || allSelected ? placeholder : selected.join(', ');

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          ...inputStyle, width, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 4, cursor: 'pointer',
          textAlign: 'left', padding: '8px 10px',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: width - 40, fontSize: 13 }}>
          {displayText}
        </span>
        <span style={{ fontSize: 10, color: BRAND.textSecondary }}>▼</span>
      </button>
      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#FFFFFF',
          borderRadius: BRAND.radiusSmall, boxShadow: BRAND.shadow, padding: 12,
          minWidth: 220, zIndex: 100, border: `1px solid ${BRAND.border}`,
          maxHeight: 300, overflowY: 'auto',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
            <input type="checkbox" checked={allSelected} onChange={() => handleToggle('ALL')} /> Все
          </label>
          {nonAllOptions.map((option) => (
            <label key={option} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer', fontSize: 14 }}>
              <input type="checkbox" checked={selected.includes(option)} onChange={() => handleToggle(option)} /> {option}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===================== МОДАЛКА ПАРОЛЯ ===================== */
function PasswordModal({ isOpen, onClose, onSubmit, error, title = 'Введите пароль', subtitle = '' }) {
  const [passwordInput, setPasswordInput] = useState('');
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);
  if (!isOpen) return null;
  const handleSubmit = () => { onSubmit(passwordInput); setPasswordInput(''); };
  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 48, height: 48, backgroundColor: '#EFF6FF', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, marginBottom: 16, color: BRAND.primary }}>🔒</div>
        <h3 style={{ margin: '0 0 8px 0', fontWeight: 700, fontSize: '1.5rem' }}>{title}</h3>
        <p style={{ margin: '0 0 20px 0', color: BRAND.textSecondary, fontSize: '0.9rem' }}>{subtitle}</p>
        {error && <p style={{ color: '#EF4444', marginBottom: 10, fontSize: '0.9rem' }}>{error}</p>}
        <input
          type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSubmit()} placeholder="Пароль"
          style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: `1px solid ${BRAND.border}`, fontSize: '0.95rem', marginBottom: 16, boxSizing: 'border-box' }}
          autoFocus
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '12px 24px', borderRadius: 10, border: `1px solid ${BRAND.border}`, background: '#FFFFFF', color: BRAND.text, fontWeight: 600, cursor: 'pointer' }}>Отмена</button>
          <button onClick={handleSubmit} style={{ padding: '12px 24px', borderRadius: 10, border: 'none', background: BRAND.primary, color: '#FFFFFF', fontWeight: 600, cursor: 'pointer' }}>Войти</button>
        </div>
      </div>
    </div>
  );
}

/* ===================== МОДАЛКА VIN ===================== */
function VINModal({ defect, vins, loading, onClose }) {
  const [exporting, setExporting] = useState(false);
  if (!defect) return null;

  const handleExport = () => {
    if (vins.length === 0) return;
    setExporting(true);
    const data = vins.map((vin) => ({ VIN: vin }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'VIN');
    const fileName = `VIN_${(defect.mpp || '').replace(/[^a-zа-яё0-9]/gi, '_')}_${getTodayStr()}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    setTimeout(() => setExporting(false), 2000);
  };

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: BRAND.text, fontSize: '1.2rem' }}>VIN для дефекта: {defect.mpp}</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer', color: BRAND.textSecondary }}>✕</button>
        </div>
        {loading ? (
          <div style={{ color: BRAND.textSecondary }}>Загрузка...</div>
        ) : vins.length === 0 ? (
          <div style={{ color: BRAND.textSecondary }}>Нет данных</div>
        ) : (
          <>
            <div style={{ color: BRAND.textSecondary, marginBottom: 12 }}>
              Всего уникальных VIN: <b>{vins.length}</b>
            </div>
            <button onClick={handleExport} disabled={exporting} style={{ padding: '8px 16px', backgroundColor: '#2563EB', color: '#FFF', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 14, marginBottom: 12, cursor: exporting ? 'not-allowed' : 'pointer', opacity: exporting ? 0.6 : 1 }}>
              {exporting ? 'Выгружается...' : 'Экспорт в Excel'}
            </button>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${BRAND.border}`, borderRadius: BRAND.radiusSmall }}>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {vins.map((vin, idx) => (
                  <li key={idx} style={{ padding: '6px 12px', borderBottom: `1px solid ${BRAND.border}`, color: BRAND.text, fontSize: 14 }}>{vin}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ===================== ТАБЛИЦА ТОП MPP ПО VRT (14 ДНЕЙ) ===================== */
function VRTMPPTable({ allMpps, onCellClick, metric, userNotes = {}, onNoteSave }) {
  const responsibleOptions = ['', 'Сварка', 'Окраска', 'Сборка', 'Качество'];
  const actionOptions = ['', 'На контроле', 'Устранено', 'Требует проверки'];

  const [sortDay, setSortDay] = useState(null);
  const [sortCW, setSortCW] = useState(null);
  const [carsCounts, setCarsCounts] = useState({});

  const isDPU = metric === 'dpu';
  const colorFunc = isDPU ? getDPUColor : getDefectColor;
  const formatDPU = (v) => Number(v).toFixed(1);

  const { prevWeekDays, currWeekDays, prevWeekNum, currWeekNum } = useMemo(() => {
    const today = new Date();
    const mondayThisWeek = getMonday(today);
    const mondayPrevWeek = new Date(mondayThisWeek);
    mondayPrevWeek.setDate(mondayPrevWeek.getDate() - 7);
    const prevDays = []; const currDays = [];
    for (let i = 0; i < 7; i++) {
      prevDays.push(new Date(mondayPrevWeek.getTime() + i * 86400000));
      currDays.push(new Date(mondayThisWeek.getTime() + i * 86400000));
    }
    return {
      prevWeekDays: prevDays, currWeekDays: currDays,
      prevWeekNum: getWeekNumber(mondayPrevWeek), currWeekNum: getWeekNumber(mondayThisWeek),
    };
  }, []);

  useEffect(() => {
    const allDays = [...prevWeekDays, ...currWeekDays];
    const fetches = allDays.map(date => {
      const ds = toLocalDateStr(date);
      return fetch(`${API_BASE}/api/cars-count?date=${ds}`)
        .then(res => res.json()).catch(() => ({ CARS_COUNT: 0 }));
    });
    Promise.all(fetches).then(results => {
      const counts = {};
      allDays.forEach((date, i) => { counts[toLocalDateStr(date)] = results[i]?.CARS_COUNT || 0; });
      setCarsCounts(counts);
    }).catch(() => {});
  }, [prevWeekDays, currWeekDays]);

  const rows = useMemo(() => {
    const grouped = {};
    (allMpps || []).forEach((item) => {
      const key = `${item.model}|${item.bom_name}|${item.defect_name}|${item.zone || ''}`;
      if (!grouped[key]) {
        grouped[key] = {
          model: item.model, bom_name: item.bom_name, defect_name: item.defect_name,
          zone: item.zone || '', days: {},
          mpp: `${item.model} ${item.bom_name} ${item.defect_name}${item.zone ? ' (' + item.zone + ')' : ''}`,
        };
      }
      grouped[key].days[item.date] = (grouped[key].days[item.date] || 0) + item.count;
    });

    const rowsArr = Object.values(grouped).map((g) => {
      const countsPrev = prevWeekDays.map(d => g.days[toLocalDateStr(d)] || 0);
      const countsCurr = currWeekDays.map(d => g.days[toLocalDateStr(d)] || 0);
      const totalPrevCount = countsPrev.reduce((s, v) => s + v, 0);
      const totalCurrCount = countsCurr.reduce((s, v) => s + v, 0);

      const carsPrevSum = prevWeekDays.reduce((s, d) => s + (carsCounts[toLocalDateStr(d)] || 0), 0);
      const carsCurrSum = currWeekDays.reduce((s, d) => s + (carsCounts[toLocalDateStr(d)] || 0), 0);

      const dpuPrev = carsPrevSum > 0 ? (totalPrevCount * 1000) / carsPrevSum : 0;
      const dpuCurr = carsCurrSum > 0 ? (totalCurrCount * 1000) / carsCurrSum : 0;

      // Без обрезки на 1000 — показываем реальные значения
      const cellsPrev = countsPrev.map((count, i) => {
        if (!isDPU) return count;
        const ds = toLocalDateStr(prevWeekDays[i]);
        const cars = carsCounts[ds] || 0;
        if (cars === 0) return 0;
        return (count * 1000) / cars;
      });
      const cellsCurr = countsCurr.map((count, i) => {
        if (!isDPU) return count;
        const ds = toLocalDateStr(currWeekDays[i]);
        const cars = carsCounts[ds] || 0;
        if (cars === 0) return 0;
        return (count * 1000) / cars;
      });

      return {
        ...g, countsPrev, countsCurr, cellsPrev, cellsCurr,
        totalPrev: isDPU ? dpuPrev : totalPrevCount,
        totalCurr: isDPU ? dpuCurr : totalCurrCount,
        totalPrevCount, totalCurrCount,
      };
    });

    let filtered = rowsArr.filter(r => (r.totalPrevCount + r.totalCurrCount) > 0);
    if (sortCW) {
      filtered.sort((a, b) => sortCW === 'prev' ? b.totalPrev - a.totalPrev : b.totalCurr - a.totalCurr);
    } else if (sortDay) {
      filtered.sort((a, b) => {
        const va = sortDay.week === 'prev' ? a.cellsPrev[sortDay.index] : a.cellsCurr[sortDay.index];
        const vb = sortDay.week === 'prev' ? b.cellsPrev[sortDay.index] : b.cellsCurr[sortDay.index];
        return vb - va;
      });
    } else {
      filtered.sort((a, b) => (b.totalPrevCount + b.totalCurrCount) - (a.totalPrevCount + a.totalCurrCount));
    }
    return filtered;
  }, [allMpps, prevWeekDays, currWeekDays, sortDay, sortCW, carsCounts, isDPU]);

  const handleDayHeaderClick = (week, index) => {
    setSortCW(null);
    setSortDay((prev) => prev?.week === week && prev?.index === index ? null : { week, index });
  };
  const handleCWHeaderClick = (week) => {
    setSortDay(null);
    setSortCW((prev) => prev === week ? null : week);
  };

  const mppTableStyles = {
    dark: { background: '#1F2937', padding: '6px 8px', fontWeight: 600, border: '1px solid #4B5563', display: 'flex', alignItems: 'center', fontSize: 11, color: '#FFF' },
    hdr: { background: '#374151', padding: '4px 3px', fontWeight: 600, border: '1px solid #4B5563', textAlign: 'center', fontSize: 11, color: '#FFF' },
    name: { background: '#1F2937', padding: '6px 8px', fontWeight: 600, border: '1px solid #4B5563', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12, color: '#FFF' },
    val: { padding: '6px 4px', border: '1px solid #4B5563', textAlign: 'center', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' },
    total: { padding: '6px 4px', border: '1px solid #4B5563', textAlign: 'center', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' },
    noteCell: { background: '#1F2937', padding: '2px 4px', border: '1px solid #4B5563', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 },
    noteSelect: { width: '100%', padding: '2px 4px', borderRadius: 4, border: '1px solid #4B5563', background: '#374151', color: '#FFF', fontSize: 11, cursor: 'pointer' },
    noteDate: { fontSize: 9, color: '#9CA3AF', textAlign: 'center' },
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: BRAND.text, margin: 0 }}>
          📋 Топ дефектов по VRT (14 дней)
        </h3>
        {(sortDay || sortCW) && (
          <button onClick={() => { setSortDay(null); setSortCW(null); }} style={{ padding: '4px 10px', background: '#E5E7EB', color: '#374151', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Сбросить сортировку ✕
          </button>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(260px, 2fr) 130px 130px repeat(7, 60px) 60px repeat(7, 60px) 60px',
        border: '1px solid #4B5563', fontSize: 13, background: '#111827',
        borderRadius: 6, overflowX: 'auto',
      }}>
        <div style={mppTableStyles.dark}>Дефект (Модель / BOM / Дефект / Зона)</div>
        <div style={mppTableStyles.dark}>Ответственный</div>
        <div style={mppTableStyles.dark}>Действие</div>

        {prevWeekDays.map((d, i) => {
          const isSorted = sortDay?.week === 'prev' && sortDay?.index === i;
          return (
            <div key={`ph${i}`} style={{ ...mppTableStyles.hdr, cursor: 'pointer', background: isSorted ? '#2563EB' : '#374151', userSelect: 'none' }}
              onClick={() => handleDayHeaderClick('prev', i)} title="Сортировать по этому дню">
              <span style={{ display: 'block' }}>{formatDateDDMM(d)}</span>
              <span style={{ display: 'block', color: isSorted ? '#FFF' : '#9CA3AF' }}>{getDayOfWeekFromDate(d)}</span>
            </div>
          );
        })}
        <div style={{ ...mppTableStyles.hdr, cursor: 'pointer', background: sortCW === 'prev' ? '#2563EB' : '#374151', userSelect: 'none' }}
          onClick={() => handleCWHeaderClick('prev')} title="Сортировать по сумме недели">
          <span style={{ fontWeight: 700 }}>CW{prevWeekNum}</span>
        </div>

        {currWeekDays.map((d, i) => {
          const isSorted = sortDay?.week === 'curr' && sortDay?.index === i;
          return (
            <div key={`ch${i}`} style={{ ...mppTableStyles.hdr, cursor: 'pointer', background: isSorted ? '#2563EB' : '#374151', userSelect: 'none' }}
              onClick={() => handleDayHeaderClick('curr', i)} title="Сортировать по этому дню">
              <span style={{ display: 'block' }}>{formatDateDDMM(d)}</span>
              <span style={{ display: 'block', color: isSorted ? '#FFF' : '#9CA3AF' }}>{getDayOfWeekFromDate(d)}</span>
            </div>
          );
        })}
        <div style={{ ...mppTableStyles.hdr, cursor: 'pointer', background: sortCW === 'curr' ? '#2563EB' : '#374151', userSelect: 'none' }}
          onClick={() => handleCWHeaderClick('curr')} title="Сортировать по сумме недели">
          <span style={{ fontWeight: 700 }}>CW{currWeekNum}</span>
        </div>

        {rows.length === 0 ? (
          <div style={{ ...mppTableStyles.dark, gridColumn: '1 / -1', textAlign: 'center', padding: 12, color: '#9CA3AF' }}>
            Нет данных за 14 дней
          </div>
        ) : rows.map((row) => {
          const noteKey = row.mpp;
          const note = userNotes[noteKey] || { responsible: '', action: '' };
          return (
            <React.Fragment key={noteKey}>
              <div style={mppTableStyles.name} title={row.mpp}>{row.mpp}</div>

              <div style={mppTableStyles.noteCell}>
                <select value={note.responsible}
                  onChange={e => onNoteSave && onNoteSave(noteKey, 'responsible', e.target.value)}
                  style={mppTableStyles.noteSelect}>
                  {responsibleOptions.map(opt => <option key={opt} value={opt}>{opt || '—'}</option>)}
                </select>
                {note.updated_at && (
                  <div style={mppTableStyles.noteDate}>{new Date(note.updated_at).toLocaleDateString('ru-RU')}</div>
                )}
              </div>

              <div style={mppTableStyles.noteCell}>
                <select value={note.action}
                  onChange={e => onNoteSave && onNoteSave(noteKey, 'action', e.target.value)}
                  style={mppTableStyles.noteSelect}>
                  {actionOptions.map(opt => <option key={opt} value={opt}>{opt || '—'}</option>)}
                </select>
                {note.updated_at && (
                  <div style={mppTableStyles.noteDate}>{new Date(note.updated_at).toLocaleDateString('ru-RU')}</div>
                )}
              </div>

              {row.cellsPrev.map((val, ci) => {
                const ds = toLocalDateStr(prevWeekDays[ci]);
                const count = row.countsPrev[ci];
                const bg = colorFunc(val);
                const textColor = isDPU ? (val > 300 ? '#FFF' : '#000') : (val > 15 ? '#FFF' : '#000');
                return (
                  <div key={`cp${ci}`} style={{ ...mppTableStyles.val, background: bg, color: textColor, cursor: count > 0 ? 'pointer' : 'default' }}
                    onClick={() => count > 0 && onCellClick(row, ds)}>
                    {isDPU ? formatDPU(val) : val}
                  </div>
                );
              })}
              <div style={{ ...mppTableStyles.total, background: colorFunc(row.totalPrev), color: (isDPU ? row.totalPrev > 300 : row.totalPrev > 15) ? '#FFF' : '#000' }}>
                {isDPU ? formatDPU(row.totalPrev) : row.totalPrev}
              </div>

              {row.cellsCurr.map((val, ci) => {
                const ds = toLocalDateStr(currWeekDays[ci]);
                const count = row.countsCurr[ci];
                const bg = colorFunc(val);
                const textColor = isDPU ? (val > 300 ? '#FFF' : '#000') : (val > 15 ? '#FFF' : '#000');
                return (
                  <div key={`cc${ci}`} style={{ ...mppTableStyles.val, background: bg, color: textColor, cursor: count > 0 ? 'pointer' : 'default' }}
                    onClick={() => count > 0 && onCellClick(row, ds)}>
                    {isDPU ? formatDPU(val) : val}
                  </div>
                );
              })}
              <div style={{ ...mppTableStyles.total, background: colorFunc(row.totalCurr), color: (isDPU ? row.totalCurr > 300 : row.totalCurr > 15) ? '#FFF' : '#000' }}>
                {isDPU ? formatDPU(row.totalCurr) : row.totalCurr}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

/* ===================== ОБЩИЙ ОТЧЕТ ===================== */
function VRTGeneralReport() {
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(toLocalDateStr(today));
  const [dateTo, setDateTo] = useState(toLocalDateStr(today));
  const [selectedCheckpoints, setSelectedCheckpoints] = useState([]);
  const [selectedZones, setSelectedZones] = useState([]);
  const [availableZones, setAvailableZones] = useState([]);
  const [defectType, setDefectType] = useState('all');
  const [metric, setMetric] = useState('count');
  const [shiftFilter, setShiftFilter] = useState('all');
  const [histogramData, setHistogramData] = useState([]);
  const [totalCars, setTotalCars] = useState(0);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [totalDefects, setTotalDefects] = useState(0);
  const [topVrts, setTopVrts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [totalCarsShift, setTotalCarsShift] = useState(0);

  const availableCheckpoints = ['CP7', 'CP8', 'PIP', 'TL'];

  useEffect(() => {
    fetch(`${API_BASE}/api/vrt-report/zones`).then(r => r.json()).then(setAvailableZones).catch(() => {});
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const allSelected = selectedCheckpoints.length === 0 || selectedCheckpoints.length === availableCheckpoints.length;
      const checkpointParam = allSelected ? 'ALL' : selectedCheckpoints.join(',');
      const params = new URLSearchParams({ dateFrom, dateTo, checkpoint: checkpointParam, metric, defectType, shift: shiftFilter });
      if (selectedZones.length > 0) params.append('zones', selectedZones.join(','));

      const res = await fetch(`${API_BASE}/api/vrt-report/data?${params}`);
      if (!res.ok) throw new Error('Ошибка загрузки данных');
      const data = await res.json();
      setHistogramData(data.histogram);
      setTotalCars(data.totalCars);
      setTotalCarsShift(data.totalCarsShift || 0);
      setUnassignedCount(data.unassignedCount);
      setTotalDefects(data.totalDefects);
      setTopVrts(data.topVrts || []);
    } catch (err) { alert(err.message); } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [dateFrom, dateTo, selectedCheckpoints, metric, defectType, shiftFilter, selectedZones]);

  const formatDpu = (v) => Number(v).toFixed(2);
  const top3 = useMemo(() => {
    return [...topVrts].sort((a, b) => metric === 'dpu' ? b.dpu - a.dpu : b.count - a.count).slice(0, 3);
  }, [topVrts, metric]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 15 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: 15, backgroundColor: '#F8FAFC', borderRadius: BRAND.radius }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500 }}>
          Начало: <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500 }}>
          Конец: <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500 }}>
          Смена:
          <select value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)} style={inputStyle}>
            <option value="all">Сутки</option><option value="A">A</option><option value="B">B</option><option value="C">C</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500 }}>
          Чекпоинты: <MultiSelect options={['ALL', ...availableCheckpoints]} selected={selectedCheckpoints} onChange={setSelectedCheckpoints} placeholder="Все" />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500 }}>
          Зона детали: <MultiSelect options={['ALL', ...availableZones]} selected={selectedZones} onChange={setSelectedZones} placeholder="Все зоны" width={160} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500 }}>
          Тип дефекта:
          <select value={defectType} onChange={(e) => setDefectType(e.target.value)} style={inputStyle}>
            <option value="all">Все</option><option value="offline">Offline</option><option value="online">Online</option>
          </select>
        </label>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button onClick={() => setMetric('count')} style={{ ...buttonStyle, background: metric === 'count' ? BRAND.primary : '#E5E7EB', color: metric === 'count' ? '#FFFFFF' : '#374151' }}>Шт</button>
          <button onClick={() => setMetric('dpu')} style={{ ...buttonStyle, background: metric === 'dpu' ? BRAND.primary : '#E5E7EB', color: metric === 'dpu' ? '#FFFFFF' : '#374151' }}>DPU per 1000</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0, gap: 15 }}>
        <div style={{ ...cardStyle, flex: 7 }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: BRAND.text, marginBottom: 10 }}>
            Дефекты по VRT {metric === 'dpu' ? '(DPU per 1000)' : '(шт)'}
          </h2>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {loading ? <div style={{ textAlign: 'center', padding: 30 }}>Загрузка...</div>
              : histogramData.length > 0 ? (
                <div style={{ height: Math.max(400, histogramData.length * 45) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histogramData} layout="vertical" margin={{ top: 20, right: 70, left: 40, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 'dataMax']} tick={{ fontSize: 13 }} />
                      <YAxis type="category" dataKey="category" tick={{ fontSize: 13 }} width={160} />
                      <Tooltip formatter={(value) => metric === 'dpu' ? formatDpu(value) : value} />
                      <Bar dataKey="value" fill={BRAND.primary} barSize={32}>
                        <LabelList dataKey="value" position="right" formatter={(value) => metric === 'dpu' ? formatDpu(value) : value} style={{ fontSize: '1.1rem', fontWeight: 700, fill: BRAND.text }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <p style={{ textAlign: 'center', padding: 30, color: BRAND.textSecondary }}>Нет данных</p>}
          </div>
          <div style={{ display: 'flex', gap: 20, marginTop: 10, justifyContent: 'center', fontSize: '1.1rem' }}>
            <div>Всего авто: <b>{totalCarsShift}</b>{shiftFilter !== 'all' && <> (за сутки: <b>{totalCars}</b>)</>}</div>
            <div>Всего дефектов: <b>{totalDefects}</b></div>
            <div>Без владельца: <b>{unassignedCount}</b></div>
          </div>
        </div>

        <div style={{ ...cardStyle, flex: 3 }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: BRAND.text, marginBottom: 10 }}>
            Топ 3 VRT по {metric === 'dpu' ? 'DPU' : 'количеству'}
          </h2>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {top3.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left' }}>VRT / Дефект</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>{metric === 'dpu' ? 'DPU' : 'Шт'}</th>
                  </tr>
                </thead>
                <tbody>
                  {top3.map((v) => {
                    const totalValue = metric === 'dpu' ? formatDpu(v.dpu) : v.count;
                    return (
                      <React.Fragment key={v.vrt}>
                        <tr style={{ backgroundColor: '#F0F5FF', fontWeight: 700 }}>
                          <td style={{ ...tdStyle, fontWeight: 700, color: BRAND.primary }}>{v.vrt}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, textAlign: 'center', color: BRAND.primary }}>{totalValue}</td>
                        </tr>
                        {v.mpps.slice(0, 5).map((mpp, idx) => (
                          <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                            <td style={{ ...tdStyle, paddingLeft: 30 }}>
                              {mpp.model} {mpp.bom_name} {mpp.defect_name} {mpp.zone ? `(${mpp.zone})` : ''}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                              {metric === 'dpu' ? formatDpu(mpp.dpu) : mpp.count}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : <p style={{ textAlign: 'center', padding: 10, color: BRAND.textSecondary }}>Нет данных</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================== ОТЧЕТ ПО VRT (ТРЕНДЫ) ===================== */
function VRTTrendReport() {
  const [selectedCheckpoints, setSelectedCheckpoints] = useState(['CP7', 'CP8']);
  const [selectedZones, setSelectedZones] = useState([]);
  const [availableZones, setAvailableZones] = useState([]);
  const [defectType, setDefectType] = useState('all');
  const [selectedVrts, setSelectedVrts] = useState([]);
  const [metric, setMetric] = useState('count');
  const [shiftFilter, setShiftFilter] = useState('all');
  const [trendsByVrt, setTrendsByVrt] = useState({});
  const [topMppsByVrt, setTopMppsByVrt] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedDefect, setSelectedDefect] = useState(null);
  const [vins, setVins] = useState([]);
  const [vinsLoading, setVinsLoading] = useState(false);
  const [userNotes, setUserNotes] = useState({});
  const [vrtList, setVrtList] = useState([]);

  const availableCheckpoints = ['CP7', 'CP8', 'PIP', 'TL'];

  useEffect(() => {
    fetch(`${API_BASE}/api/vrt-report/vrts`).then(r => r.json())
      .then((data) => setVrtList(data.map(v => v.name).filter(n => n !== 'VRT не найдена')))
      .catch(() => {});
    fetch(`${API_BASE}/api/vrt-report/zones`).then(r => r.json()).then(setAvailableZones).catch(() => {});
    fetch(`${API_BASE}/api/defect-notes`).then(r => r.json()).then((data) => {
      const map = {};
      data.forEach(n => { map[n.mpp] = n; });
      setUserNotes(map);
    }).catch(() => {});
  }, []);

  const formatValue = (v) => metric === 'dpu' ? Number(v).toFixed(2) : v;

  const buildCommonParams = () => {
    const allSelected = selectedCheckpoints.length === 0 || selectedCheckpoints.length === availableCheckpoints.length;
    const checkpointParam = allSelected ? 'ALL' : selectedCheckpoints.join(',');
    const params = new URLSearchParams({ checkpoint: checkpointParam, defectType });
    if (shiftFilter !== 'all') params.append('shift', shiftFilter);
    if (selectedZones.length > 0) params.append('zones', selectedZones.join(','));
    return params;
  };

  const fetchTrend = async (vrt) => {
    const params = buildCommonParams();
    params.append('vrts', vrt);
    params.append('metric', metric);
    const res = await fetch(`${API_BASE}/api/vrt-report/trend?${params}`);
    if (!res.ok) throw new Error(`Ошибка трендов для ${vrt}`);
    return await res.json();
  };
  const fetchTopMpps = async (vrt) => {
    const params = buildCommonParams();
    params.append('vrt', vrt);
    const res = await fetch(`${API_BASE}/api/vrt-report/top-mpp?${params}`);
    if (!res.ok) throw new Error(`Ошибка top-mpp для ${vrt}`);
    return await res.json();
  };

  const loadAllData = async () => {
    if (selectedVrts.length === 0) { setTrendsByVrt({}); setTopMppsByVrt({}); return; }
    setLoading(true);
    try {
      const newTrends = {}; const newTopMpps = {};
      await Promise.all(selectedVrts.map(async (vrt) => {
        try {
          const [t, m] = await Promise.all([fetchTrend(vrt), fetchTopMpps(vrt)]);
          newTrends[vrt] = t; newTopMpps[vrt] = m;
        } catch (err) { console.error(err); }
      }));
      setTrendsByVrt(newTrends); setTopMppsByVrt(newTopMpps);
    } catch (err) { alert(err.message); } finally { setLoading(false); }
  };

  useEffect(() => { loadAllData(); }, [selectedCheckpoints, selectedVrts, defectType, shiftFilter, metric, selectedZones]);

  const handleCellClick = (row, date) => {
    setSelectedDefect({
      model: row.model, bom_name: row.bom_name, defect_name: row.defect_name,
      zone: row.zone, mpp: row.mpp, date,
    });
    setVins([]); setVinsLoading(true);

    const params = buildCommonParams();
    params.append('model', row.model);
    params.append('bom_name', row.bom_name);
    params.append('defect_name', row.defect_name);
    params.append('date', date);
    if (row.zone) params.append('zone', row.zone);

    fetch(`${API_BASE}/api/vrt-report/top-mpp-vins?${params}`)
      .then(res => { if (!res.ok) throw new Error('Ошибка VIN'); return res.json(); })
      .then(data => { setVins(Array.isArray(data) ? data : []); setVinsLoading(false); })
      .catch(() => { setVins([]); setVinsLoading(false); });
  };

  const closeModal = () => { setSelectedDefect(null); setVins([]); };

  const handleNoteSave = async (mpp, field, value) => {
    const current = userNotes[mpp] || { responsible: '', action: '' };
    const updated = { ...current, [field]: value };
    setUserNotes((prev) => ({ ...prev, [mpp]: updated }));
    try {
      const res = await fetch(`${API_BASE}/api/defect-notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mpp, responsible: updated.responsible || '', action: updated.action || '' }),
      });
      const json = await res.json();
      if (json.success && json.note) {
        setUserNotes((prev) => ({ ...prev, [mpp]: { ...prev[mpp], updated_at: json.note.updated_at } }));
      }
    } catch (err) { console.error('Ошибка сохранения:', err); }
  };

  const renderVrtCard = (vrtName, data) => {
    if (!data) return null;
    const monthData = data.month || [];
    const weekData = data.week || [];
    const dayData = data.day || [];
    const topMpps = topMppsByVrt[vrtName] || [];

    return (
      <div key={vrtName} style={{ backgroundColor: '#FFFFFF', borderRadius: BRAND.radius, padding: 24, marginBottom: 20, boxShadow: BRAND.shadow, border: `1px solid ${BRAND.border}` }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: BRAND.primary, marginBottom: 16 }}>🏷️ {vrtName}</h2>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px', minWidth: 250 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8, color: '#3B82F6' }}>📅 Последние 3 месяца</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthData} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="period" tick={{ fontSize: 12 }} tickFormatter={(val) => {
                  const [, m] = val.split('-');
                  const monthNames = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
                  return monthNames[parseInt(m,10)-1];
                }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip formatter={(v) => formatValue(v)} />
                <Bar dataKey="value" fill="#3B82F6" radius={[6,6,0,0]}>
                  <LabelList dataKey="value" position="top" formatter={(v) => formatValue(v)} style={{ fontSize: 14, fontWeight: 700, fill: BRAND.text }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: '1 1 300px', minWidth: 250 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8, color: '#F59E0B' }}>📆 Последние 4 недели</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={weekData} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="period" tick={{ fontSize: 12 }} tickFormatter={(val) => val.split('-W')[1] ? `W${val.split('-W')[1]}` : val} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip formatter={(v) => formatValue(v)} />
                <Bar dataKey="value" fill="#F59E0B" radius={[6,6,0,0]}>
                  <LabelList dataKey="value" position="top" formatter={(v) => formatValue(v)} style={{ fontSize: 14, fontWeight: 700, fill: BRAND.text }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: '2 1 350px', minWidth: 300 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8, color: '#10B981' }}>📊 Последние 14 дней</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={dayData} margin={{ top: 20, right: 20, left: 0, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="period" interval={0} tick={{ fontSize: 11 }} tickFormatter={(val) => {
                  const [, m, d] = val.split('-');
                  return `${d}.${m}`;
                }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip formatter={(v) => formatValue(v)} />
                <Bar dataKey="value" fill="#10B981" radius={[6,6,0,0]}>
                  <LabelList dataKey="value" position="top" formatter={(v) => formatValue(v)} style={{ fontSize: 13, fontWeight: 700, fill: BRAND.text }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <VRTMPPTable allMpps={topMpps} onCellClick={handleCellClick} metric={metric} userNotes={userNotes} onNoteSave={handleNoteSave} />
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 15 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: 15, backgroundColor: '#F8FAFC', borderRadius: BRAND.radius }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500 }}>
          Смена:
          <select value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)} style={inputStyle}>
            <option value="all">Сутки</option><option value="A">A</option><option value="B">B</option><option value="C">C</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500 }}>
          Чекпоинты: <MultiSelect options={['ALL', ...availableCheckpoints]} selected={selectedCheckpoints} onChange={setSelectedCheckpoints} placeholder="Все" />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500 }}>
          Зона детали: <MultiSelect options={['ALL', ...availableZones]} selected={selectedZones} onChange={setSelectedZones} placeholder="Все зоны" width={160} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500 }}>
          Тип дефекта:
          <select value={defectType} onChange={(e) => setDefectType(e.target.value)} style={inputStyle}>
            <option value="all">Все</option><option value="offline">Offline</option><option value="online">Online</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500 }}>
          VRT: <MultiSelect options={['ALL', ...vrtList]} selected={selectedVrts} onChange={setSelectedVrts} placeholder="Выберите..." width={180} />
        </label>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button onClick={() => setMetric('count')} style={{ ...buttonStyle, background: metric === 'count' ? BRAND.primary : '#E5E7EB', color: metric === 'count' ? '#FFFFFF' : '#374151' }}>Шт</button>
          <button onClick={() => setMetric('dpu')} style={{ ...buttonStyle, background: metric === 'dpu' ? BRAND.primary : '#E5E7EB', color: metric === 'dpu' ? '#FFFFFF' : '#374151' }}>DPU per 1000</button>
        </div>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 30, fontSize: '1.5rem' }}>Загрузка...</div>
        : selectedVrts.length === 0 ? <div style={{ textAlign: 'center', padding: 30, color: BRAND.textSecondary, fontSize: '1.3rem' }}>Выберите VRT для отображения графиков</div>
        : <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
            {selectedVrts.map(vrt => renderVrtCard(vrt, trendsByVrt[vrt]))}
          </div>
      }

      <VINModal defect={selectedDefect} vins={vins} loading={vinsLoading} onClose={closeModal} />
    </div>
  );
}

/* ===================== УПРАВЛЕНИЕ ВЛАДЕЛЬЦАМИ ===================== */
function VRTOwnersManager({ executeWithPassword, manageUnlocked, onRequestPassword }) {
  const [subTab, setSubTab] = useState('assign');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [dictionaryData, setDictionaryData] = useState([]);
  const [models, setModels] = useState([]);
  const [vrtList, setVrtList] = useState([]);
  const [zones, setZones] = useState([]);
  const [unassignedDefects, setUnassignedDefects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rowVrts, setRowVrts] = useState({});
  const [rowZones, setRowZones] = useState({});

  const [filterModel, setFilterModel] = useState('ALL');
  const [filterVrt, setFilterVrt] = useState('ALL');
  const [search, setSearch] = useState('');
  const [newEntry, setNewEntry] = useState({ model: '', bom_name: '', defect_name: '', zone: '', vrtName: '' });
  const [editEntry, setEditEntry] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMethod, setImportMethod] = useState('text');
  const [importText, setImportText] = useState('');
  const [newVrtName, setNewVrtName] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 100;

  const loadDictionary = async () => {
    try { const r = await fetch(`${API_BASE}/api/vrt-report/dictionary`); if (r.ok) setDictionaryData(await r.json()); } catch {}
  };
  const loadModels = async () => {
    try { const r = await fetch(`${API_BASE}/api/vrt-report/models`); if (r.ok) setModels(await r.json()); } catch {}
  };
  const loadVrts = async () => {
    try { const r = await fetch(`${API_BASE}/api/vrt-report/vrts`); if (r.ok) setVrtList(await r.json()); } catch {}
  };
  const loadZones = async () => {
    try { const r = await fetch(`${API_BASE}/api/vrt-report/zones`); if (r.ok) setZones(await r.json()); } catch {}
  };

  const loadUnassigned = async () => {
    setLoading(true);
    try {
      const today = toLocalDateStr(new Date());
      const params = new URLSearchParams({ dateFrom: today, dateTo: today, checkpoint: 'ALL', defectType: 'all' });
      const r = await fetch(`${API_BASE}/api/vrt-report/unassigned-defects?${params}`);
      if (r.ok) setUnassignedDefects(await r.json());
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { loadDictionary(); loadModels(); loadVrts(); loadZones(); loadUnassigned(); }, []);
  useEffect(() => { loadDictionary(); loadModels(); loadVrts(); loadZones(); }, [refreshTrigger]);

  const handleRefresh = () => { setRefreshTrigger(p => p + 1); loadUnassigned(); };

  const handleAssign = (defect) => {
    const key = `${defect.model}|${defect.bom_name}|${defect.defect_name}`;
    const vrtName = rowVrts[key] || '';
    const zone = (rowZones[key] || '').trim();
    if (!vrtName) { alert('Выберите VRT из списка'); return; }
    if (!zone) { alert('Выберите зону детали'); return; }
    executeWithPassword(async (pwd) => {
      try {
        const res = await fetch(`${API_BASE}/api/vrt-report/assign-owner`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: defect.model,
            bom_name: defect.bom_name,
            defect_name: defect.defect_name,
            vrtName,
            zone,
            password: pwd,
          }),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Ошибка назначения'); }
        handleRefresh();
      } catch (err) { alert(err.message); }
    });
  };

  const filteredDictionary = useMemo(() => {
    return dictionaryData.filter(entry => {
      const matchModel = filterModel === 'ALL' || entry.model === filterModel;
      const matchVrt = filterVrt === 'ALL' || entry.vrt_name === filterVrt;
      const s = search.toLowerCase();
      const matchSearch = !search || (entry.bom_name || '').toLowerCase().includes(s) || (entry.defect_name || '').toLowerCase().includes(s) || (entry.zone || '').toLowerCase().includes(s) || (entry.model || '').toLowerCase().includes(s);
      return matchModel && matchVrt && matchSearch;
    });
  }, [dictionaryData, filterModel, filterVrt, search]);

  useEffect(() => { setCurrentPage(1); }, [filterModel, filterVrt, search]);
  const pageCount = Math.ceil(filteredDictionary.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const visibleEntries = filteredDictionary.slice(startIndex, startIndex + pageSize);

  const handleSaveEntry = (entry) => {
    executeWithPassword(async (pwd) => {
      try {
        const res = await fetch(`${API_BASE}/api/vrt-report/dictionary`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...entry, password: pwd }),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Ошибка'); }
        handleRefresh();
        setNewEntry({ model: '', bom_name: '', defect_name: '', zone: '', vrtName: '' });
        setEditEntry(null);
      } catch (err) { alert(err.message); }
    });
  };

  const handleDeleteEntry = (id) => {
    executeWithPassword(async (pwd) => {
      try {
        const res = await fetch(`${API_BASE}/api/vrt-report/dictionary/${id}`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd }),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Ошибка'); }
        handleRefresh();
      } catch (err) { alert(err.message); }
    });
  };

  const handleAddVrt = () => {
    const name = newVrtName.trim();
    if (!name) { alert('Введите название'); return; }
    executeWithPassword(async (pwd) => {
      try {
        const res = await fetch(`${API_BASE}/api/vrt-report/vrts`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, password: pwd }),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Ошибка'); }
        setNewVrtName(''); handleRefresh();
      } catch (err) { alert(err.message); }
    });
  };

  const handleDeleteVrt = (id, name) => {
    if (!window.confirm(`Удалить VRT "${name}"?`)) return;
    executeWithPassword(async (pwd) => {
      try {
        const res = await fetch(`${API_BASE}/api/vrt-report/vrts/${id}`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd }),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Ошибка'); }
        handleRefresh();
      } catch (err) { alert(err.message); }
    });
  };

  const executeImport = (entries) => {
    if (entries.length === 0) { alert('Нет данных'); return; }
    fetch(`${API_BASE}/api/vrt-report/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries, password: '4002' }),
    }).then(res => {
      if (!res.ok) return res.json().then(e => { throw new Error(e.error); });
      return res.json();
    }).then(() => {
      alert(`Импортировано ${entries.length} записей`);
      setShowImportModal(false); setImportText(''); handleRefresh();
    }).catch(e => alert(e.message));
  };

  const handleImportFromText = () => {
    const lines = importText.split('\n').filter(l => l.trim());
    const entries = lines.map(line => {
      const p = line.split('\t');
      if (p.length >= 5) return { model: p[0].trim(), bom_name: p[1].trim(), defect_name: p[2].trim(), vrtName: p[3].trim(), zone: p[4].trim() };
      return null;
    }).filter(e => e && e.model && e.bom_name && e.defect_name && e.vrtName && e.zone);
    executeImport(entries);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const sh = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sh, { header: 1 });
        const entries = json.slice(1).map(row => ({
          model: row[0]?.toString().trim(), bom_name: row[1]?.toString().trim(),
          defect_name: row[2]?.toString().trim(), vrtName: row[3]?.toString().trim(),
          zone: row[4]?.toString().trim(),
        })).filter(e => e.model && e.bom_name && e.defect_name && e.vrtName && e.zone);
        executeImport(entries);
      } catch { alert('Ошибка чтения файла'); }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleExportExcel = () => {
    if (filteredDictionary.length === 0) { alert('Нет данных'); return; }
    const exportData = filteredDictionary.map(e => ({
      'Модель': e.model, 'Название BOM': e.bom_name, 'Дефект': e.defect_name,
      'VRT': e.vrt_name || '—', 'Зона детали': e.zone || '—',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Справочник VRT');
    XLSX.writeFile(wb, `Справочник_VRT_${getTodayStr()}.xlsx`);
  };

  const vrtOptions = useMemo(() => Array.from(new Set(dictionaryData.map(e => e.vrt_name).filter(Boolean))).sort(), [dictionaryData]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 15 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => setSubTab('assign')} style={subTabStyle(subTab === 'assign')}>🎯 Назначение VRT</button>
        <button onClick={() => { if (!manageUnlocked) onRequestPassword(); else setSubTab('dictionary'); }} style={subTabStyle(subTab === 'dictionary')}>📚 Справочник</button>
        <button onClick={() => setSubTab('vrts')} style={subTabStyle(subTab === 'vrts')}>🏷️ Управление VRT</button>
      </div>

      {subTab === 'assign' && (
        <div style={cardStyle}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: BRAND.text, marginBottom: 10 }}>Дефекты без владельца (сегодня)</h2>
          <p style={{ fontSize: '0.9rem', color: BRAND.textSecondary, marginTop: 0, marginBottom: 10 }}>Выберите зону, VRT для каждого дефекта и нажмите «Назначить».</p>
          <div style={{ flex: 1, overflowY: 'auto', border: `1px solid ${BRAND.border}`, borderRadius: BRAND.radiusSmall }}>
            {loading ? <p style={{ textAlign: 'center', padding: 20 }}>Загрузка...</p>
              : unassignedDefects.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Модель</th>
                      <th style={thStyle}>BOM</th>
                      <th style={thStyle}>Дефект</th>
                      <th style={thStyle}>Кол-во</th>
                      <th style={thStyle}>Зона детали</th>
                      <th style={thStyle}>VRT</th>
                      <th style={thStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {unassignedDefects.map((d, idx) => {
                      const key = `${d.model}|${d.bom_name}|${d.defect_name}`;
                      return (
                        <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                          <td style={tdStyle}>{d.model}</td>
                          <td style={tdStyle}>{d.bom_name}</td>
                          <td style={tdStyle}>{d.defect_name}</td>
                          <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>{d.count}</td>
                          <td style={tdStyle}>
                            <select value={rowZones[key] || ''} onChange={(e) => setRowZones((p) => ({ ...p, [key]: e.target.value }))}
                              style={{ width: '100%', maxWidth: 160, padding: 6, fontSize: '0.9rem', borderRadius: BRAND.radiusSmall, border: `1px solid ${BRAND.border}` }}>
                              <option value="">Выберите...</option>
                              {zones.map(z => (
                                <option key={z} value={z}>{z}</option>
                              ))}
                            </select>
                          </td>
                          <td style={tdStyle}>
                            <select value={rowVrts[key] || ''} onChange={(e) => setRowVrts((p) => ({ ...p, [key]: e.target.value }))}
                              style={{ width: '100%', maxWidth: 200, padding: 6, fontSize: '0.9rem', borderRadius: BRAND.radiusSmall, border: `1px solid ${BRAND.border}` }}>
                              <option value="">Выберите...</option>
                              {vrtList.filter(v => v.name !== 'VRT не найдена').map(v => (
                                <option key={v.id} value={v.name}>{v.name}</option>
                              ))}
                            </select>
                          </td>
                          <td style={tdStyle}>
                            <button onClick={() => handleAssign(d)} style={{ padding: '8px 16px', fontSize: '0.9rem', background: '#10B981', color: '#FFFFFF', border: 'none', borderRadius: BRAND.radiusSmall, cursor: 'pointer', whiteSpace: 'nowrap' }}>Назначить</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <p style={{ textAlign: 'center', padding: 30, color: BRAND.textSecondary }}>Все дефекты имеют владельца 🎉</p>}
          </div>
        </div>
      )}

      {subTab === 'dictionary' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: 15, backgroundColor: '#FFFFFF', borderRadius: BRAND.radius, border: `1px solid ${BRAND.border}` }}>
            <span style={{ fontWeight: 600, color: BRAND.textSecondary, fontSize: '1rem' }}>Фильтры:</span>
            <select value={filterModel} onChange={(e) => setFilterModel(e.target.value)} style={{ ...inputStyle, minWidth: 150 }}>
              <option value="ALL">Все модели</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={filterVrt} onChange={(e) => setFilterVrt(e.target.value)} style={{ ...inputStyle, minWidth: 180 }}>
              <option value="ALL">Все VRT</option>
              {vrtOptions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <input type="text" placeholder="Поиск..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200, ...inputStyle }} />
            <button onClick={() => setShowImportModal(true)} style={{ ...buttonStyle, background: '#8B5CF6' }}>📥 Импорт</button>
            <button onClick={handleExportExcel} style={{ ...buttonStyle, background: '#059669' }}>📊 Экспорт</button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: 15, backgroundColor: '#FFFFFF', borderRadius: BRAND.radius, border: `1px solid ${BRAND.border}` }}>
            <span style={{ fontWeight: 600, color: BRAND.textSecondary, fontSize: '1rem' }}>Добавить:</span>
            <select value={newEntry.model} onChange={(e) => setNewEntry({ ...newEntry, model: e.target.value })} style={{ ...inputStyle, minWidth: 130 }}>
              <option value="">Модель</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input type="text" placeholder="BOM" value={newEntry.bom_name} onChange={(e) => setNewEntry({ ...newEntry, bom_name: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 130 }} />
            <input type="text" placeholder="Дефект" value={newEntry.defect_name} onChange={(e) => setNewEntry({ ...newEntry, defect_name: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 130 }} />
            <input type="text" placeholder="Зона" value={newEntry.zone} onChange={(e) => setNewEntry({ ...newEntry, zone: e.target.value })} style={{ ...inputStyle, minWidth: 100 }} />
            <select value={newEntry.vrtName} onChange={(e) => setNewEntry({ ...newEntry, vrtName: e.target.value })} style={{ ...inputStyle, minWidth: 150 }}>
              <option value="">VRT</option>
              {vrtList.filter(v => v.name !== 'VRT не найдена').map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
            </select>
            <button onClick={() => handleSaveEntry(newEntry)} style={{ ...buttonStyle }}>Добавить</button>
          </div>

          <div style={cardStyle}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: BRAND.text, marginBottom: 10 }}>Справочник VRT ({filteredDictionary.length})</h2>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: `1px solid ${BRAND.border}`, borderRadius: BRAND.radiusSmall }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Модель</th><th style={thStyle}>Название BOM</th><th style={thStyle}>Дефект</th>
                    <th style={thStyle}>Зона детали</th><th style={thStyle}>VRT</th><th style={thStyle}>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map(entry => (
                    <tr key={entry.id} style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                      <td style={tdStyle}>{entry.model}</td>
                      <td style={tdStyle}>{entry.bom_name}</td>
                      <td style={tdStyle}>{entry.defect_name}</td>
                      <td style={tdStyle}>{entry.zone || '—'}</td>
                      <td style={tdStyle}>
                        {editEntry && editEntry.id === entry.id ? (
                          <select value={editEntry.vrtName} onChange={(e) => setEditEntry({ ...editEntry, vrtName: e.target.value })} style={{ padding: 5, borderRadius: BRAND.radiusSmall, border: `1px solid ${BRAND.border}` }}>
                            {vrtList.filter(v => v.name !== 'VRT не найдена').map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                          </select>
                        ) : (entry.vrt_name || '—')}
                      </td>
                      <td style={tdStyle}>
                        {editEntry && editEntry.id === entry.id ? (
                          <>
                            <button onClick={() => handleSaveEntry(editEntry)} style={{ marginRight: 5, padding: '5px 10px', background: '#10B981', color: '#FFF', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.9rem' }}>Сохранить</button>
                            <button onClick={() => setEditEntry(null)} style={{ padding: '5px 10px', background: '#6B7280', color: '#FFF', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.9rem' }}>Отмена</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => setEditEntry({ id: entry.id, model: entry.model, bom_name: entry.bom_name, defect_name: entry.defect_name, zone: entry.zone, vrtName: entry.vrt_name })} style={{ marginRight: 5, padding: '5px 10px', background: '#F59E0B', color: '#FFF', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.9rem' }}>Изменить</button>
                            <button onClick={() => handleDeleteEntry(entry.id)} style={{ padding: '5px 10px', background: '#EF4444', color: '#FFF', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.9rem' }}>Удалить</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ ...buttonStyle, background: currentPage === 1 ? '#CBD5E1' : BRAND.primary }}>←</button>
                <span>Страница {currentPage} из {pageCount}</span>
                <button onClick={() => setCurrentPage(p => Math.min(pageCount, p + 1))} disabled={currentPage === pageCount} style={{ ...buttonStyle, background: currentPage === pageCount ? '#CBD5E1' : BRAND.primary }}>→</button>
              </div>
            )}
          </div>
        </>
      )}

      {subTab === 'vrts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 15, backgroundColor: '#FFFFFF', borderRadius: BRAND.radius, border: `1px solid ${BRAND.border}` }}>
            <span style={{ fontWeight: 600, color: BRAND.textSecondary }}>Добавить VRT:</span>
            <input type="text" placeholder="Название VRT" value={newVrtName} onChange={(e) => setNewVrtName(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
            <button onClick={handleAddVrt} style={{ ...buttonStyle, background: '#10B981' }}>Добавить</button>
          </div>
          <div style={cardStyle}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: BRAND.text, marginBottom: 10 }}>Список VRT</h2>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: `1px solid ${BRAND.border}`, borderRadius: BRAND.radiusSmall }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr><th style={thStyle}>ID</th><th style={thStyle}>Название</th><th style={thStyle}>Действия</th></tr>
                </thead>
                <tbody>
                  {vrtList.map(v => (
                    <tr key={v.id} style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                      <td style={tdStyle}>{v.id}</td>
                      <td style={tdStyle}>{v.name}</td>
                      <td style={tdStyle}>
                        {v.name !== 'VRT не найдена' && (
                          <button onClick={() => handleDeleteVrt(v.id, v.name)} style={{ padding: '5px 10px', background: '#EF4444', color: '#FFF', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.9rem' }}>Удалить</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div style={modalOverlayStyle} onClick={() => setShowImportModal(false)}>
          <div style={wideModalStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '1.8rem', fontWeight: 700 }}>Импорт справочника VRT</h2>
            <p style={{ fontSize: '0.9rem', color: BRAND.textSecondary, marginBottom: 15 }}>
              Формат: <b>Модель[Tab]Название BOM[Tab]Дефект[Tab]VRT[Tab]Зона детали</b>
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
              <button onClick={() => setImportMethod('text')} style={{ ...buttonStyle, background: importMethod === 'text' ? BRAND.primary : '#E2E8F0', color: importMethod === 'text' ? '#FFF' : '#374151' }}>Вставить текст</button>
              <button onClick={() => setImportMethod('file')} style={{ ...buttonStyle, background: importMethod === 'file' ? BRAND.primary : '#E2E8F0', color: importMethod === 'file' ? '#FFF' : '#374151' }}>Загрузить Excel</button>
            </div>
            {importMethod === 'text' ? (
              <>
                <textarea value={importText} onChange={(e) => setImportText(e.target.value)} style={{ width: '100%', height: 250, fontSize: '0.9rem', padding: 10, borderRadius: BRAND.radiusSmall, border: `1px solid ${BRAND.border}`, fontFamily: 'monospace', boxSizing: 'border-box' }}
                  placeholder={'JELAND J6\tБампер\tПовреждение\tF08\tЭкстерьер'} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 15, gap: 10 }}>
                  <button onClick={() => setShowImportModal(false)} style={{ ...buttonStyle, background: '#6B7280' }}>Отмена</button>
                  <button onClick={handleImportFromText} style={{ ...buttonStyle, background: '#8B5CF6' }}>Импортировать</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: '0.85rem', color: BRAND.textSecondary }}>Excel: <b>Модель, Название BOM, Дефект, VRT, Зона детали</b> (первая строка — заголовки).</p>
                <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} style={{ fontSize: '0.9rem', marginBottom: 15 }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button onClick={() => setShowImportModal(false)} style={{ ...buttonStyle, background: '#6B7280' }}>Отмена</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== ГЛАВНЫЙ КОМПОНЕНТ ===================== */
export default function VrtReportPage() {
  const [activeTab, setActiveTab] = useState('general');
  const [password, setPassword] = useState(sessionStorage.getItem('vrt_password') || '');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [pendingAction, setPendingAction] = useState(null);
  const [manageUnlocked, setManageUnlocked] = useState(sessionStorage.getItem('vrt_manage_unlocked') === 'true');
  const [showManagePasswordModal, setShowManagePasswordModal] = useState(false);
  const [managePasswordError, setManagePasswordError] = useState('');

  const executeWithPassword = (action) => {
    if (password) action(password);
    else { setPendingAction(() => action); setShowPasswordModal(true); }
  };

  const handlePasswordSubmit = (pwd) => {
    if (pwd === '1234561') {
      sessionStorage.setItem('vrt_password', pwd);
      setPassword(pwd);
      setShowPasswordModal(false);
      if (pendingAction) { pendingAction(pwd); setPendingAction(null); }
      setPasswordError('');
    } else setPasswordError('Неверный пароль');
  };

  const handleManagePasswordSubmit = (pwd) => {
    if (pwd === '4002') {
      sessionStorage.setItem('vrt_manage_unlocked', 'true');
      setManageUnlocked(true);
      setShowManagePasswordModal(false);
      setManagePasswordError('');
    } else setManagePasswordError('Неверный пароль');
  };

  const handleTabChange = (tab) => {
    if (tab === 'owners' && !password) {
      setPendingAction(() => (pwd) => { setPassword(pwd); setActiveTab('owners'); });
      setShowPasswordModal(true);
    } else setActiveTab(tab);
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>Отчет VRT</h1>
        <div style={tabBarStyle}>
          <button style={tabStyle(activeTab === 'general')} onClick={() => handleTabChange('general')}>Общий отчет</button>
          <button style={tabStyle(activeTab === 'vrt')} onClick={() => handleTabChange('vrt')}>📊 Отчет по VRT</button>
          <button style={tabStyle(activeTab === 'owners')} onClick={() => handleTabChange('owners')}>👥 Владельцы дефектов</button>
        </div>
      </div>

      {activeTab === 'general' && <VRTGeneralReport />}
      {activeTab === 'vrt' && <VRTTrendReport />}
      {activeTab === 'owners' && (
        <VRTOwnersManager
          executeWithPassword={executeWithPassword}
          manageUnlocked={manageUnlocked}
          onRequestPassword={() => setShowManagePasswordModal(true)}
        />
      )}

      {showPasswordModal && (
        <PasswordModal isOpen={showPasswordModal} onClose={() => setShowPasswordModal(false)}
          onSubmit={handlePasswordSubmit} error={passwordError}
          title="Введите пароль" subtitle="Для доступа к вкладке «Владельцы дефектов»" />
      )}
      {showManagePasswordModal && (
        <PasswordModal isOpen={showManagePasswordModal} onClose={() => setShowManagePasswordModal(false)}
          onSubmit={handleManagePasswordSubmit} error={managePasswordError}
          title="Пароль" subtitle="Для доступа к справочнику" />
      )}
    </div>
  );
}