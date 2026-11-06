import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';

const API_BASE = '';

/* ===================== ХЕЛПЕРЫ ===================== */
const getYesterdayStr = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DEFAULT_RECHECK_PERSON = 'qc-gate14|Maxim Zykin';

/* ===================== СТИЛИ ===================== */
const cardStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  padding: 28,
  marginBottom: 24,
  boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
  border: '1px solid #F0F0F5',
};

const buttonStyle = {
  padding: '8px 20px',
  borderRadius: 8,
  border: 'none',
  background: '#2563EB',
  color: 'white',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  transition: 'background 0.2s, transform 0.1s',
  boxShadow: '0 2px 6px rgba(37,99,235,0.3)',
};

const inputStyle = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: 14,
  background: '#F9FAFB',
};

const filterDropdownStyle = {
  position: 'fixed',
  zIndex: 1000,
  backgroundColor: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderRadius: 8,
  boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
  maxHeight: 300,
  overflowY: 'auto',
  minWidth: 220,
  padding: 8,
};

const filterOptionStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  cursor: 'pointer',
  borderRadius: 4,
  fontSize: 13,
  transition: 'background 0.15s',
};

const loadingAnimation = `
  @keyframes blink {
    0% { opacity: 0.2; }
    20% { opacity: 1; }
    100% { opacity: 0.2; }
  }
  .loading-dots span { animation: blink 1.4s infinite both; }
  .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
  .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
`;

/* ===================== КОМПОНЕНТ ===================== */
export default function InspectionPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const pageSize = 100;

  const [filters, setFilters] = useState({
    RECHECK_PERSON: [DEFAULT_RECHECK_PERSON],
  });
  const [vinSearch, setVinSearch] = useState('');
  const [dateFrom, setDateFrom] = useState(getYesterdayStr());
  const [dateTo, setDateTo]     = useState(getYesterdayStr());

  const [activeFilterColumn, setActiveFilterColumn] = useState(null);
  const [filterDropdownPos, setFilterDropdownPos] = useState({ top: 0, left: 0 });

  /* ---- columns ---- */
  const columns = [
    { key: 'VIN',                 label: 'VIN',               filterable: true,  width: 200, mono: true },
    { key: 'PROBLEM_DESCRIPTION', label: 'Описание дефекта',  filterable: false, width: 420 },
    { key: 'CREATION_TIME',       label: 'Время регистрации', filterable: false, isTime: true, width: 150 },
    { key: 'REPAIR_TIME',         label: 'Время доработки',   filterable: false, isTime: true, width: 150 },
    { key: 'REPAIR_PERSON',       label: 'ФИО ремонтника',    filterable: true,  width: 180 },
    { key: 'RECHECK_PERSON',      label: 'ФИО качества',      filterable: true,  width: 180 },
    { key: 'STATUS',              label: 'Статус',            filterable: true,  width: 110 },
    { key: 'POST_NAME',           label: 'Пост',              filterable: true,  width: 110 },
  ];

  /* ---- effects ---- */
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (activeFilterColumn && !event.target.closest('.filter-dropdown') && !event.target.closest('th')) {
        setActiveFilterColumn(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [activeFilterColumn]);

  useEffect(() => {
    const handleScroll = (event) => {
      if (event.target.closest && event.target.closest('.filter-dropdown')) return;
      setActiveFilterColumn(null);
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, []);

  /* ---- fetch ---- */
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (vinSearch.trim()) params.append('vin', vinSearch.trim());
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo)   params.append('dateTo',   dateTo);

      // Фильтр по RECHECK_PERSON отправляем на бэк, если в нём ровно одно значение
      const rp = filters.RECHECK_PERSON;
      if (Array.isArray(rp) && rp.length === 1) {
        params.append('recheckPerson', rp[0]);
      }

      const res = await fetch(`${API_BASE}/api/inspection-defects?${params.toString()}`);
      if (!res.ok) throw new Error(`Ошибка загрузки (${res.status})`);
      const json = await res.json();
      setData(Array.isArray(json) ? json : []);
      setPage(0);
    } catch (err) {
      console.error('Ошибка Inspection:', err);
      setError(err.message);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  // Первичная загрузка
  useEffect(() => { loadData(); }, []);

  // Автоподгрузка при смене дат
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  /* ---- formatting ---- */
  const formatDateTime = (dt) => {
    if (!dt) return '—';
    const d = new Date(dt);
    if (isNaN(d.getTime())) return String(dt);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${dd}.${mm}.${yyyy} ${hh}:${min}:${ss}`;
  };

  /* ---- filters ---- */
  const getUniqueValues = (column) => {
    const values = [...new Set(data.map(d => d[column]).filter(v => v !== null && v !== undefined && v !== ''))];
    return values.map(String).sort();
  };

  const handleFilterHeaderClick = (column, event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setFilterDropdownPos({ top: rect.bottom + 4, left: rect.left });
    setActiveFilterColumn(activeFilterColumn === column ? null : column);
  };

  const handleFilterToggle = (column, value) => {
    setFilters(prev => {
      const current = prev[column] || [];
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      const newFilters = { ...prev };
      if (next.length > 0) newFilters[column] = next;
      else delete newFilters[column];
      return newFilters;
    });
  };

  const handleFilterClear = (column) => {
    setFilters(prev => {
      const copy = { ...prev };
      delete copy[column];
      return copy;
    });
    setActiveFilterColumn(null);
  };

  const clearAll = () => {
    setFilters({ RECHECK_PERSON: [DEFAULT_RECHECK_PERSON] });
    setVinSearch('');
    setDateFrom(getYesterdayStr());
    setDateTo(getYesterdayStr());
    setActiveFilterColumn(null);
    setTimeout(loadData, 0);
  };

  const filtered = useMemo(() => {
    let result = data;

    if (vinSearch.trim()) {
      const q = vinSearch.trim().toLowerCase();
      result = result.filter(d => d.VIN && String(d.VIN).toLowerCase().includes(q));
    }

    if (Object.keys(filters).length === 0) return result;

    return result.filter(row => {
      for (const [col, values] of Object.entries(filters)) {
        if (values.length > 0 && !values.includes(String(row[col] ?? ''))) return false;
      }
      return true;
    });
  }, [data, filters, vinSearch]);

  useEffect(() => { setPage(0); }, [filters, vinSearch]);

  /* ---- export ---- */
  const exportExcel = () => {
    if (!filtered.length) return;
    const rows = filtered.map(d => ({
      'VIN': d.VIN,
      'Описание дефекта': d.PROBLEM_DESCRIPTION,
      'Время регистрации': formatDateTime(d.CREATION_TIME),
      'Время доработки': formatDateTime(d.REPAIR_TIME),
      'ФИО ремонтника': d.REPAIR_PERSON || '—',
      'ФИО качества': d.RECHECK_PERSON || '—',
      'Статус': d.STATUS || '—',
      'Пост': d.POST_NAME || '—',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Проверка');
    ws['!cols'] = [
      { wch: 22 }, { wch: 60 }, { wch: 20 },
      { wch: 20 }, { wch: 22 }, { wch: 22 }, { wch: 12 }, { wch: 12 },
    ];
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `Проверка_${dateStr}.xlsx`);
  };

  /* ---- table styles ---- */
  const thStyle = {
    padding: '12px 14px',
    textAlign: 'left',
    fontWeight: 700,
    color: '#374151',
    borderBottom: '2px solid #E5E7EB',
    background: '#F9FAFB',
    whiteSpace: 'nowrap',
    fontSize: 12,
    position: 'sticky',
    top: 0,
    zIndex: 10,
  };

  const tdStyle = {
    padding: '10px 14px',
    borderBottom: '1px solid #F0F0F5',
    color: '#1F2937',
    fontSize: 13,
    verticalAlign: 'top',
  };

  /* ---- render ---- */
  return (
    <div style={{ padding: 30, fontFamily: 'Inter, Segoe UI, Arial, sans-serif', maxWidth: 1600, margin: '0 auto' }}>
      <h1 style={{ color: '#1F2937', fontSize: 28, fontWeight: 700, marginBottom: 24, letterSpacing: '-0.5px' }}>
        🔎 Проверка дефектов
      </h1>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1F2937', margin: 0 }}>
            Список дефектов (AGM)
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={{ ...buttonStyle, background: '#059669' }} onClick={exportExcel}>
              📊 Excel
            </button>
            <button style={{ ...buttonStyle, background: '#9CA3AF' }} onClick={clearAll}>
              ✕ Очистить фильтры
            </button>
          </div>
        </div>

        {/* ===== ФИЛЬТРЫ ===== */}
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500 }}>
            📅 С:
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500 }}>
            По:
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500 }}>
            🔍 VIN:
            <input
              type="text"
              value={vinSearch}
              onChange={(e) => setVinSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadData(); }}
              placeholder="Введите VIN..."
              style={{ ...inputStyle, width: 220 }}
            />
          </label>

          <button style={buttonStyle} onClick={loadData}>
            Применить
          </button>
        </div>

        {/* ===== ТАБЛИЦА ===== */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>
            <style>{loadingAnimation}</style>
            <div className="loading-dots" style={{ display: 'inline-block' }}>
              <span>Загрузка данных</span>
              <span>.</span><span>.</span><span>.</span>
            </div>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#DC2626' }}>❌ {error}</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 400px)', borderRadius: 8, border: '1px solid #E5E7EB' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1500 }}>
                <thead>
                  <tr>
                    {columns.map(col => {
                      const hasFilter = col.filterable && filters[col.key]?.length > 0;
                      return (
                        <th
                          key={col.key}
                          style={{
                            ...thStyle,
                            width: col.width,
                            background: hasFilter ? '#DBEAFE' : '#F9FAFB',
                            cursor: col.filterable ? 'pointer' : 'default',
                            userSelect: 'none',
                          }}
                          onClick={col.filterable ? (e) => handleFilterHeaderClick(col.key, e) : undefined}
                        >
                          {col.label}
                          {hasFilter && ` (${filters[col.key].length})`}
                          {col.filterable && ' ▼'}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length > 0 ? (
                    filtered.slice(page * pageSize, (page + 1) * pageSize).map((row, idx) => (
                      <tr
                        key={row.ID || idx}
                        style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = '#EEF2FF'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB'}
                      >
                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{row.VIN || '—'}</td>
                        <td style={tdStyle}>{row.PROBLEM_DESCRIPTION || '—'}</td>
                        <td style={tdStyle}>{formatDateTime(row.CREATION_TIME)}</td>
                        <td style={tdStyle}>{formatDateTime(row.REPAIR_TIME)}</td>
                        <td style={tdStyle}>{row.REPAIR_PERSON || '—'}</td>
                        <td style={tdStyle}>{row.RECHECK_PERSON || '—'}</td>
                        <td style={tdStyle}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 700,
                            background: row.STATUS === 'CLOSED' ? '#DCFCE7' : '#FEF3C7',
                            color: row.STATUS === 'CLOSED' ? '#166534' : '#92400E',
                          }}>
                            {row.STATUS || '—'}
                          </span>
                        </td>
                        <td style={tdStyle}>{row.POST_NAME || '—'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={columns.length} style={{ textAlign: 'center', padding: 30, color: '#6B7280', fontSize: 14 }}>
                        Нет данных по выбранным фильтрам
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {filtered.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                <span style={{ fontSize: 14, color: '#6B7280' }}>
                  Всего записей: {filtered.length}
                </span>
                {Math.ceil(filtered.length / pageSize) > 1 && (
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      style={{ ...buttonStyle, background: page === 0 ? '#CBD5E1' : '#9CA3AF' }}
                    >
                      ← Назад
                    </button>
                    <span style={{ fontWeight: 500 }}>
                      {page + 1} / {Math.ceil(filtered.length / pageSize)}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(Math.ceil(filtered.length / pageSize) - 1, p + 1))}
                      disabled={page === Math.ceil(filtered.length / pageSize) - 1}
                      style={{ ...buttonStyle, background: page === Math.ceil(filtered.length / pageSize) - 1 ? '#CBD5E1' : '#9CA3AF' }}
                    >
                      Вперёд →
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ===== dropdown фильтра ===== */}
        {activeFilterColumn && (
          <div
            className="filter-dropdown"
            style={{
              ...filterDropdownStyle,
              top: filterDropdownPos.top,
              left: filterDropdownPos.left,
            }}
          >
            <div
              style={{ ...filterOptionStyle, fontWeight: 700, borderBottom: '1px solid #E5E7EB', marginBottom: 4 }}
              onClick={() => handleFilterClear(activeFilterColumn)}
              onMouseEnter={(e) => e.currentTarget.style.background = '#F3F4F6'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              ✕ Очистить фильтр
            </div>
            {getUniqueValues(activeFilterColumn).map(val => {
              const isChecked = filters[activeFilterColumn]?.includes(val);
              return (
                <div
                  key={val}
                  style={{
                    ...filterOptionStyle,
                    background: isChecked ? '#EFF6FF' : 'transparent',
                  }}
                  onClick={() => handleFilterToggle(activeFilterColumn, val)}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#F3F4F6'}
                  onMouseLeave={(e) => e.currentTarget.style.background = isChecked ? '#EFF6FF' : 'transparent'}
                >
                  <input type="checkbox" checked={!!isChecked} readOnly />
                  {val}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}