import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';

const API_BASE = '';

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getTodayStart = () => `${getTodayStr()}T00:00`;
const getTodayEnd = () => `${getTodayStr()}T23:59`;

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

const modalOverlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(15,23,42,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 2000, padding: 20,
};

const modalStyle = {
  backgroundColor: '#FFFFFF', borderRadius: 14, padding: 24,
  width: '100%', maxWidth: 1200, maxHeight: '90vh',
  display: 'flex', flexDirection: 'column',
  boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
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

const tabStyle = (active) => ({
  padding: '12px 24px',
  border: 'none',
  background: active ? '#2563EB' : '#F3F4F6',
  color: active ? '#FFFFFF' : '#6B7280',
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
  borderRadius: 10,
  transition: 'all 0.2s',
  boxShadow: active ? '0 4px 12px rgba(37,99,235,0.25)' : 'none',
});

const FlowArrow = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 10px', flexShrink: 0 }}>
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"></line>
      <polyline points="12 5 19 12 12 19"></polyline>
    </svg>
  </div>
);

export default function VoltageSpcPage() {
  const [activeTab, setActiveTab] = useState('spc'); // 'spc' | 'cp7'

  // --- Состояния для вкладки SPC ---
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const pageSize = 100;
  const [filters, setFilters] = useState({});
  const [vinSearch, setVinSearch] = useState('');
  const [useMeasureDate, setUseMeasureDate] = useState(false);
  const [dateFrom, setDateFrom] = useState(getTodayStr());
  const [dateTo, setDateTo] = useState(getTodayStr());
  const [cp8Start, setCp8Start] = useState(getTodayStart());
  const [cp8End, setCp8End] = useState(getTodayEnd());

  // --- Состояния для вкладки CP7 ---
  const [cp7Data, setCp7Data] = useState([]);
  const [cp7Loading, setCp7Loading] = useState(false);
  const [cp7Error, setCp7Error] = useState(null);
  const [cp7Page, setCp7Page] = useState(0);
  const [cp7VinSearch, setCp7VinSearch] = useState('');
  const [cp7DateFrom, setCp7DateFrom] = useState(getTodayStr());
  const [cp7DateTo, setCp7DateTo] = useState(getTodayStr());
  const [cp7Filters, setCp7Filters] = useState({});

  // --- Состояния для дашборда ---
  const [dashData, setDashData] = useState([]);
  const [dashLoading, setDashLoading] = useState(false);

  // --- Общие состояния ---
  const [activeFilterColumn, setActiveFilterColumn] = useState(null);
  const [filterDropdownPos, setFilterDropdownPos] = useState({ top: 0, left: 0 });
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalData, setModalData] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);

  const formatDateTime = (dt) => {
    if (!dt) return '—';
    const d = new Date(dt);
    if (isNaN(d.getTime())) return String(dt);
    return d.toLocaleString('ru-RU');
  };

  /* ================= API ЗАГРУЗКИ ================= */
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (vinSearch.trim()) params.append('vin', vinSearch.trim());
      if (useMeasureDate) {
        if (dateFrom) params.append('dateFrom', dateFrom);
        if (dateTo) params.append('dateTo', dateTo);
      }
      if (cp8Start) params.append('cp8Start', cp8Start);
      if (cp8End) params.append('cp8End', cp8End);

      const res = await fetch(`${API_BASE}/api/voltage-spc?${params.toString()}`);
      if (!res.ok) throw new Error(`Ошибка загрузки (${res.status})`);
      const json = await res.json();
      setData(Array.isArray(json) ? json : []);
      setPage(0);
    } catch (err) {
      setError(err.message);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  const loadCp7Data = async () => {
    setCp7Loading(true);
    setDashLoading(true);
    setCp7Error(null);
    try {
      const params = new URLSearchParams();
      if (cp7VinSearch.trim()) params.append('vin', cp7VinSearch.trim());
      if (cp7DateFrom) params.append('dateFrom', cp7DateFrom);
      if (cp7DateTo) params.append('dateTo', cp7DateTo);

      const dashParams = new URLSearchParams();
      if (cp7DateFrom) dashParams.append('dateFrom', cp7DateFrom);
      if (cp7DateTo) dashParams.append('dateTo', cp7DateTo);

      const [resCp7, resDash] = await Promise.all([
        fetch(`${API_BASE}/api/voltage-spc-after-cp7?${params.toString()}`),
        fetch(`${API_BASE}/api/voltage-spc-checkpoints-dashboard?${dashParams.toString()}`)
      ]);

      if (!resCp7.ok) throw new Error(`Ошибка загрузки (${resCp7.status})`);
      const jsonCp7 = await resCp7.json();
      
      if (!resDash.ok) throw new Error(`Ошибка загрузки дашборда (${resDash.status})`);
      const jsonDash = await resDash.json();

      setCp7Data(Array.isArray(jsonCp7) ? jsonCp7 : []);
      setDashData(Array.isArray(jsonDash) ? jsonDash : []);
      setCp7Page(0);
    } catch (err) {
      setCp7Error(err.message);
      setCp7Data([]);
      setDashData([]);
    } finally {
      setCp7Loading(false);
      setDashLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'spc') loadData();
    else if (activeTab === 'cp7') loadCp7Data();
  }, [activeTab]);

  /* ================= ОБЩИЕ ОБРАБОТЧИКИ ================= */
  const openVinHistory = async (vin) => {
    setModalTitle(`История замеров: ${vin}`);
    setModalOpen(true);
    setModalLoading(true);
    setModalData([]);
    try {
      const res = await fetch(`${API_BASE}/api/voltage-spc-vin-history?vin=${encodeURIComponent(vin)}`);
      if (!res.ok) throw new Error('Ошибка загрузки истории');
      const json = await res.json();
      setModalData(json || []);
    } catch (err) {
      console.error(err);
    } finally {
      setModalLoading(false);
    }
  };

  const openDashDetail = (title, filteredList) => {
    setModalTitle(title);
    setModalData(filteredList || []);
    setModalOpen(true);
  };

  const handleFilterHeaderClick = (column, event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setFilterDropdownPos({ top: rect.bottom + 4, left: rect.left });
    setActiveFilterColumn(activeFilterColumn === column ? null : column);
  };

  const handleFilterToggle = (column, value, isCp7 = false) => {
    const setter = isCp7 ? setCp7Filters : setFilters;
    setter(prev => {
      const current = prev[column] || [];
      const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
      const newFilters = { ...prev };
      if (next.length > 0) newFilters[column] = next;
      else delete newFilters[column];
      return newFilters;
    });
  };

  const handleFilterClear = (column, isCp7 = false) => {
    const setter = isCp7 ? setCp7Filters : setFilters;
    setter(prev => {
      const copy = { ...prev };
      delete copy[column];
      return copy;
    });
    setActiveFilterColumn(null);
  };

  const clearAll = () => {
    if (activeTab === 'spc') {
      setFilters({}); setVinSearch(''); setUseMeasureDate(false);
      setDateFrom(getTodayStr()); setDateTo(getTodayStr());
      setCp8Start(getTodayStart()); setCp8End(getTodayEnd());
      setTimeout(loadData, 0);
    } else if (activeTab === 'cp7') {
      setCp7Filters({}); setCp7VinSearch('');
      setCp7DateFrom(getTodayStr()); setCp7DateTo(getTodayStr());
      setTimeout(loadCp7Data, 0);
    }
    setActiveFilterColumn(null);
  };

  /* ================= ФИЛЬТРАЦИЯ И РАСЧЕТЫ ================= */
  const filteredData = useMemo(() => {
    let result = data;
    if (vinSearch.trim()) {
      const q = vinSearch.trim().toLowerCase();
      result = result.filter(d => d.VIN && String(d.VIN).toLowerCase().includes(q));
    }
    if (Object.keys(filters).length > 0) {
      result = result.filter(row => {
        for (const [col, values] of Object.entries(filters)) {
          if (values.length > 0 && !values.includes(String(row[col] ?? ''))) return false;
        }
        return true;
      });
    }
    return result;
  }, [data, filters, vinSearch]);

  const filteredCp7Data = useMemo(() => {
    let result = cp7Data;
    if (cp7VinSearch.trim()) {
      const q = cp7VinSearch.trim().toLowerCase();
      result = result.filter(d => d.VIN && String(d.VIN).toLowerCase().includes(q));
    }
    if (Object.keys(cp7Filters).length > 0) {
      result = result.filter(row => {
        for (const [col, values] of Object.entries(cp7Filters)) {
          if (values.length > 0 && !values.includes(String(row[col] ?? ''))) return false;
        }
        return true;
      });
    }
    return result;
  }, [cp7Data, cp7Filters, cp7VinSearch]);

  /* ================= ДАШБОРД ================= */
  const dashKpi = useMemo(() => {
    const cp7Passed = dashData.filter(d => d.CP7_DATE);
    const cp7Ok = cp7Passed.filter(d => d.CP7_OK === true);
    const cp7Ng = cp7Passed.filter(d => d.CP7_OK === false);
    const cp7NoMeasure = cp7Passed.filter(d => d.CP7_OK === null);

    const tldasPassed = dashData.filter(d => d.TLADAS_DATE);
    const tldasOk = tldasPassed.filter(d => d.TLADAS_OK === true);
    const tldasNg = tldasPassed.filter(d => d.TLADAS_OK === false);
    const tldasNoMeasure = tldasPassed.filter(d => d.TLADAS_OK === null);

    const under1h = tldasPassed.filter(d => d.TLADAS_STATUS === 'under1h');
    const under1hOk = under1h.filter(d => d.TLADAS_OK === true);
    const under1hNg = under1h.filter(d => d.TLADAS_OK === false);
    const under1hNoMeasure = under1h.filter(d => d.TLADAS_OK === null);

    const over1h = tldasPassed.filter(d => d.TLADAS_STATUS === 'over1h');
    const over1hOk = over1h.filter(d => d.TLADAS_OK === true);
    const over1hNg = over1h.filter(d => d.TLADAS_OK === false);
    const over1hNoMeasure = over1h.filter(d => d.TLADAS_OK === null);

    const cp8Passed = dashData.filter(d => d.CP8_DATE);
    const cp8Ok = cp8Passed.filter(d => d.CP8_OK === true);
    const cp8Ng = cp8Passed.filter(d => d.CP8_OK === false);
    const cp8NoMeasure = cp8Passed.filter(d => d.CP8_OK === null);
    
    return {
      cp7: { total: cp7Passed.length, ok: cp7Ok.length, ng: cp7Ng.length, no: cp7NoMeasure.length, list: cp7Passed, listOk: cp7Ok, listNg: cp7Ng, listNo: cp7NoMeasure },
      tldas: { 
        total: tldasPassed.length, ok: tldasOk.length, ng: tldasNg.length, no: tldasNoMeasure.length, list: tldasPassed, listOk: tldasOk, listNg: tldasNg, listNo: tldasNoMeasure,
        under1h: { total: under1h.length, ok: under1hOk.length, ng: under1hNg.length, no: under1hNoMeasure.length, list: under1h, listOk: under1hOk, listNg: under1hNg, listNo: under1hNoMeasure },
        over1h: { total: over1h.length, ok: over1hOk.length, ng: over1hNg.length, no: over1hNoMeasure.length, list: over1h, listOk: over1hOk, listNg: over1hNg, listNo: over1hNoMeasure },
      },
      cp8: { total: cp8Passed.length, ok: cp8Ok.length, ng: cp8Ng.length, no: cp8NoMeasure.length, list: cp8Passed, listOk: cp8Ok, listNg: cp8Ng, listNo: cp8NoMeasure },
    };
  }, [dashData]);

  /* ================= ЭКСПОРТ EXCEL ================= */
  const exportExcel = () => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    if (activeTab === 'spc') {
      if (!filteredData.length) return;
      const rows = filteredData.map(d => ({
        'VIN': d.VIN, 'Модель': d.MODEL || '—', 'Voltage (NG)': d.VOLTAGE || '—',
        'Дата NOK замера': formatDateTime(d.MEASURE_DATE), 'Volt посл. OK': d.LAST_OK_VOLTAGE || '—',
        'Дата посл. OK': formatDateTime(d.LAST_OK_DATE), '10 min NG': d.TEN_MIN_NG, 'Дата CP8': formatDateTime(d.CP8_DATE),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Voltage SPC');
      XLSX.writeFile(wb, `Voltage_SPC_${dateStr}.xlsx`);
    } else if (activeTab === 'cp7') {
      if (!filteredCp7Data.length) return;
      const rows = filteredCp7Data.map(d => ({
        'VIN': d.VIN, 'Модель': d.MODEL, 'Комплектация': d.COMPLECTATION,
        'Дата CP7': formatDateTime(d.CP7_DATE), 'Вольтаж CP7': d.CP7_VOLTAGE,
        'Первый NOK (дата)': formatDateTime(d.FIRST_NOK_DATE), 'Первый NOK (V)': d.FIRST_NOK_VOLTAGE,
        'Первый OK (дата)': formatDateTime(d.FIRST_OK_DATE), 'Первый OK (V)': d.FIRST_OK_VOLTAGE,
        'Дата +10 мин': formatDateTime(d.TEN_MIN_DATE), 'Результат +10 мин': d.TEN_MIN_RESULT,
        'Разница NOK - CP7 (мин)': d.DIFF_NOK_CP7_MINUTES
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'After CP7');
      XLSX.writeFile(wb, `Voltage_CP7_${dateStr}.xlsx`);
    }
  };

  /* ================= КОЛОНКИ ================= */
  const spcColumns = [
    { key: 'VIN', label: 'VIN', filterable: true, width: 180, mono: true },
    { key: 'MODEL', label: 'Модель', filterable: true, width: 110 },
    { key: 'VOLTAGE', label: 'Voltage (NG)', filterable: false, width: 110, groupColor: '#FEF2F2' },
    { key: 'MEASURE_DATE', label: 'Дата NOK замера', filterable: false, isTime: true, width: 140, groupColor: '#FEF2F2' },
    { key: 'LAST_OK_VOLTAGE', label: 'Volt посл. OK', filterable: false, width: 110, groupColor: '#F0FDF4' },
    { key: 'LAST_OK_DATE', label: 'Дата посл. OK', filterable: false, isTime: true, width: 140, groupColor: '#F0FDF4' },
    { key: 'TEN_MIN_NG', label: '10 min NG', filterable: true, width: 90, align: 'center' },
    { key: 'CP8_DATE', label: 'Дата CP8', filterable: false, isTime: true, width: 140 },
  ];

  const cp7Columns = [
    { key: 'VIN', label: 'ВИН', filterable: true, width: 170, mono: true },
    { key: 'MODEL', label: 'Модель', filterable: true, width: 100 },
    { key: 'COMPLECTATION', label: 'Комплектация', filterable: true, width: 150 },
    { key: 'CP7_DATE', label: 'Дата CP7', filterable: false, isTime: true, width: 140, groupColor: '#EFF6FF' },
    { key: 'CP7_VOLTAGE', label: 'Вольтаж CP7', filterable: false, width: 110, groupColor: '#EFF6FF', isVoltage: true, title: 'Ближайший замер (в обе стороны от времени CP7)' },
    { key: 'FIRST_NOK_DATE', label: 'Дата 1-го NOK', filterable: false, isTime: true, width: 140, groupColor: '#FEF2F2' },
    { key: 'FIRST_NOK_VOLTAGE', label: '1-й NOK (V)', filterable: false, width: 100, groupColor: '#FEF2F2', isVoltage: true },
    { key: 'FIRST_OK_DATE', label: 'Дата 1-го OK', filterable: false, isTime: true, width: 140, groupColor: '#F0FDF4' },
    { key: 'FIRST_OK_VOLTAGE', label: '1-й OK (V)', filterable: false, width: 100, groupColor: '#F0FDF4', isVoltage: true },
    { key: 'TEN_MIN_DATE', label: 'Дата +10 мин', filterable: false, isTime: true, width: 140, title: 'Ближайший замер (в обе стороны от CP7 + 10 минут)' },
    { key: 'TEN_MIN_RESULT', label: 'Рез. +10 мин', filterable: true, width: 100, align: 'center' },
    { key: 'DIFF_NOK_CP7_MINUTES', label: 'Разница (мин)', filterable: true, width: 120, align: 'center', isDiff: true, title: 'Разница между CP7 и 1-м NOK' },
  ];

  const currentColumns = activeTab === 'spc' ? spcColumns : cp7Columns;
  const groupEndKeys = activeTab === 'spc' ? ['MODEL', 'MEASURE_DATE', 'LAST_OK_DATE'] : ['COMPLECTATION', 'CP7_VOLTAGE', 'FIRST_NOK_VOLTAGE', 'FIRST_OK_VOLTAGE'];

  const getUniqueValues = (column) => {
    const sourceData = activeTab === 'spc' ? data : cp7Data;
    const values = [...new Set(sourceData.map(d => d[column]).filter(v => v !== null && v !== undefined && v !== ''))];
    return values.map(String).sort();
  };

  const thStyle = {
    padding: '12px 14px', textAlign: 'left', fontWeight: 700, color: '#374151',
    borderBottom: '2px solid #E5E7EB', whiteSpace: 'nowrap',
    fontSize: 12, position: 'sticky', top: 0, zIndex: 10,
  };
  const tdStyle = {
    padding: '10px 14px', borderBottom: '1px solid #F0F0F5', color: '#1F2937',
    fontSize: 13, verticalAlign: 'top',
  };

  const ClickableNum = ({ value, color, onClick, subtext }) => (
    <div 
      onClick={onClick}
      style={{ 
        cursor: 'pointer', padding: '8px 4px', borderRadius: 8, transition: 'background 0.2s',
        textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.6)'
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,1)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.6)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{ fontSize: 28, fontWeight: 800, color: color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>{subtext}</div>
    </div>
  );

  return (
    <div style={{ padding: 30, fontFamily: 'Inter, Segoe UI, Arial, sans-serif', maxWidth: 1600, margin: '0 auto' }}>
      <h1 style={{ color: '#1F2937', fontSize: 28, fontWeight: 700, marginBottom: 16 }}>
        Voltage SPC Report
      </h1>

      {/* Вкладки */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <button style={tabStyle(activeTab === 'spc')} onClick={() => setActiveTab('spc')}>Отчет SPC</button>
        <button style={tabStyle(activeTab === 'cp7')} onClick={() => setActiveTab('cp7')}>Заряд АКБ после CP7</button>
      </div>

      {/* Фильтры для таблиц */}
      {activeTab !== 'dashboard' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <button style={{ ...buttonStyle, background: '#059669' }} onClick={exportExcel}>Экспорт Excel</button>
            <button style={{ ...buttonStyle, background: '#9CA3AF' }} onClick={clearAll}>Сбросить</button>
          </div>
        </div>
      )}

      {/* KPI Cards SPC */}
      {activeTab === 'spc' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          <div style={{ ...cardStyle, padding: 20, marginBottom: 0, borderTop: '4px solid #3B82F6' }}>
            <div style={{ fontSize: 13, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>Всего VIN</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#111827', marginTop: 8 }}>{new Set(filteredData.map(d => d.VIN)).size}</div>
          </div>
          <div style={{ ...cardStyle, padding: 20, marginBottom: 0, borderTop: '4px solid #8B5CF6' }}>
            <div style={{ fontSize: 13, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>Прошли CP8</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#111827', marginTop: 8 }}>{filteredData.filter(d => d.CP8_DATE).length}</div>
          </div>
          <div style={{ ...cardStyle, padding: 20, marginBottom: 0, borderTop: '4px solid #EF4444' }}>
            <div style={{ fontSize: 13, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>NG по вольтажу</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#111827', marginTop: 8 }}>{filteredData.filter(d => d.VOLTAGE !== null).length}</div>
          </div>
          <div style={{ ...cardStyle, padding: 20, marginBottom: 0, borderTop: '4px solid #F59E0B' }}>
            <div style={{ fontSize: 13, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>10 min NG</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#111827', marginTop: 8 }}>{filteredData.filter(d => d.TEN_MIN_NG === '-').length}</div>
          </div>
        </div>
      )}

      {/* ОСНОВНОЙ БЛОК */}
      <div style={cardStyle}>
        
        {/* ================== ВКЛАДКА CP7 (ДАШБОРД + ТАБЛИЦА) ================== */}
        {activeTab === 'cp7' && (
          <>
            {/* Фильтры даты и VIN */}
            <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12, background: '#F9FAFB', padding: 16, borderRadius: 12, border: '1px solid #E5E7EB' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F0FDF4', padding: '6px 12px', borderRadius: 8, border: '1px solid #DCFCE7' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#166534', width: 90 }}>Дата:</span>
                  <input type="date" value={cp7DateFrom} onChange={(e) => setCp7DateFrom(e.target.value)} style={{ ...inputStyle, width: 125, padding: '6px 8px' }} />
                  <span style={{ fontSize: 13, color: '#6B7280' }}>—</span>
                  <input type="date" value={cp7DateTo} onChange={(e) => setCp7DateTo(e.target.value)} style={{ ...inputStyle, width: 125, padding: '6px 8px' }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, flex: 1, maxWidth: 400 }}>
                  VIN: <input type="text" value={cp7VinSearch} onChange={(e) => setCp7VinSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadCp7Data()} placeholder="Введите VIN..." style={{ ...inputStyle, width: '100%', padding: '8px 12px' }} />
                </label>
                <button style={buttonStyle} onClick={loadCp7Data}>Применить</button>
              </div>
            </div>

            {/* ДАШБОРД (Стрелки) */}
            {dashLoading ? (
               <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>
                 <style>{loadingAnimation}</style>
                 <div className="loading-dots"><span>Загрузка данных постов</span><span>.</span><span>.</span><span>.</span></div>
               </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', flexWrap: 'wrap', gap: 10, marginBottom: 32 }}>
                
                {/* 1. Блок CP7 */}
                <div style={{ flex: 1, minWidth: 250, background: '#EFF6FF', border: '2px solid #BFDBFE', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 18, color: '#1E40AF', marginBottom: 16 }}>Пост CP7</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, justifyContent: 'center' }}>
                    <ClickableNum value={dashKpi.cp7.total} color="#2563EB" subtext="Всего прошло" onClick={() => openDashDetail('CP7: Все прошедшие', dashKpi.cp7.list)} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <ClickableNum value={dashKpi.cp7.ok} color="#059669" subtext="Замер OK" onClick={() => openDashDetail('CP7: OK', dashKpi.cp7.listOk)} />
                      <ClickableNum value={dashKpi.cp7.ng} color="#DC2626" subtext="Замер NG" onClick={() => openDashDetail('CP7: NG', dashKpi.cp7.listNg)} />
                      <ClickableNum value={dashKpi.cp7.no} color="#6B7280" subtext="Нет замера" onClick={() => openDashDetail('CP7: Нет замера', dashKpi.cp7.listNo)} />
                    </div>
                  </div>
                  {/* ИЗМЕНЕНА ПОДПИСЬ CP7 (верхней границы нет) */}
                  <div style={{ marginTop: 16, paddingTop: 10, textAlign: 'center', fontSize: 11, color: '#1E40AF', borderTop: '1px dashed #BFDBFE' }}>
                    NG: &lt; 12.60 В
                  </div>
                </div>

                <FlowArrow />

                {/* 2. Блок TLADAS */}
                <div style={{ flex: 1.5, minWidth: 300, background: '#F8FAFC', border: '2px solid #E2E8F0', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 18, color: '#334155', marginBottom: 16 }}>Пост TLADAS</div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                    <ClickableNum value={dashKpi.tldas.total} color="#2563EB" subtext="Всего прошло TLADAS" onClick={() => openDashDetail('TLADAS: Все прошедшие', dashKpi.tldas.list)} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <ClickableNum value={dashKpi.tldas.ok} color="#059669" subtext="Замер OK" onClick={() => openDashDetail('TLADAS: OK', dashKpi.tldas.listOk)} />
                      <ClickableNum value={dashKpi.tldas.ng} color="#DC2626" subtext="Замер NG" onClick={() => openDashDetail('TLADAS: NG', dashKpi.tldas.listNg)} />
                      <ClickableNum value={dashKpi.tldas.no} color="#6B7280" subtext="Нет замера" onClick={() => openDashDetail('TLADAS: Нет замера', dashKpi.tldas.listNo)} />
                    </div>
                  </div>

                  {/* Разделение по времени */}
                  <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ background: '#F0FDF4', borderRadius: 8, padding: 10, border: '1px solid #DCFCE7' }}>
                      <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 8 }}>В течение 1ч</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, textAlign: 'center' }}>
                        <div style={{ cursor: 'pointer' }} onClick={() => openDashDetail('TLADAS (<1ч): Все', dashKpi.tldas.under1h.list)}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#1E293B' }}>{dashKpi.tldas.under1h.total}</div>
                          <div style={{ fontSize: 10, color: '#6B7280' }}>Всего</div>
                        </div>
                        <div style={{ cursor: 'pointer' }} onClick={() => openDashDetail('TLADAS (<1ч): OK', dashKpi.tldas.under1h.listOk)}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#059669' }}>{dashKpi.tldas.under1h.ok}</div>
                          <div style={{ fontSize: 10, color: '#6B7280' }}>OK</div>
                        </div>
                        <div style={{ cursor: 'pointer' }} onClick={() => openDashDetail('TLADAS (<1ч): NG', dashKpi.tldas.under1h.listNg)}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#DC2626' }}>{dashKpi.tldas.under1h.ng}</div>
                          <div style={{ fontSize: 10, color: '#6B7280' }}>NG</div>
                        </div>
                      </div>
                    </div>
                    <div style={{ background: '#FEF2F2', borderRadius: 8, padding: 10, border: '1px solid #FEE2E2' }}>
                      <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#991B1B', marginBottom: 8 }}>Более 1ч</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, textAlign: 'center' }}>
                        <div style={{ cursor: 'pointer' }} onClick={() => openDashDetail('TLADAS (>1ч): Все', dashKpi.tldas.over1h.list)}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#1E293B' }}>{dashKpi.tldas.over1h.total}</div>
                          <div style={{ fontSize: 10, color: '#6B7280' }}>Всего</div>
                        </div>
                        <div style={{ cursor: 'pointer' }} onClick={() => openDashDetail('TLADAS (>1ч): OK', dashKpi.tldas.over1h.listOk)}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#059669' }}>{dashKpi.tldas.over1h.ok}</div>
                          <div style={{ fontSize: 10, color: '#6B7280' }}>OK</div>
                        </div>
                        <div style={{ cursor: 'pointer' }} onClick={() => openDashDetail('TLADAS (>1ч): NG', dashKpi.tldas.over1h.listNg)}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#DC2626' }}>{dashKpi.tldas.over1h.ng}</div>
                          <div style={{ fontSize: 10, color: '#6B7280' }}>NG</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* ИЗМЕНЕНА ПОДПИСЬ TLADAS (верхней границы нет) */}
                  <div style={{ marginTop: 16, paddingTop: 10, textAlign: 'center', fontSize: 11, color: '#334155', borderTop: '1px dashed #E2E8F0' }}>
                    NG: &lt; 12.60 В
                  </div>
                </div>

                <FlowArrow />

                {/* 3. Блок CP8 */}
                <div style={{ flex: 1, minWidth: 250, background: '#F0FDF4', border: '2px solid #DCFCE7', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 18, color: '#166534', marginBottom: 16 }}>Пост CP8</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, justifyContent: 'center' }}>
                    <ClickableNum value={dashKpi.cp8.total} color="#2563EB" subtext="Всего прошло" onClick={() => openDashDetail('CP8: Все прошедшие', dashKpi.cp8.list)} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <ClickableNum value={dashKpi.cp8.ok} color="#059669" subtext="Замер OK" onClick={() => openDashDetail('CP8: OK', dashKpi.cp8.listOk)} />
                      <ClickableNum value={dashKpi.cp8.ng} color="#DC2626" subtext="Замер NG" onClick={() => openDashDetail('CP8: NG', dashKpi.cp8.listNg)} />
                      <ClickableNum value={dashKpi.cp8.no} color="#6B7280" subtext="Нет замера" onClick={() => openDashDetail('CP8: Нет замера', dashKpi.cp8.listNo)} />
                    </div>
                  </div>
                  {/* ПОДПИСЬ CP8 ОСТАЕТСЯ С ДВУМЯ ГРАНИЦАМИ */}
                  <div style={{ marginTop: 16, paddingTop: 10, textAlign: 'center', fontSize: 11, color: '#166534', borderTop: '1px dashed #DCFCE7' }}>
                    NG: &lt; 12.60 В или &gt; 13.00 В
                  </div>
                </div>

              </div>
            )}

            <hr style={{ border: 'none', borderTop: '2px dashed #CBD5E1', margin: '20px 0 30px 0' }} />

            {/* ТАБЛИЦА CP7 */}
            {cp7Loading ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>
                <style>{loadingAnimation}</style>
                <div className="loading-dots"><span>Загрузка детальной таблицы</span><span>.</span><span>.</span><span>.</span></div>
              </div>
            ) : cp7Error ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#DC2626' }}>Ошибка: {cp7Error}</div>
            ) : (
              <>
                <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 450px)', borderRadius: 8, border: '1px solid #E5E7EB' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1100 }}>
                    <thead>
                      <tr>
                        {currentColumns.map(col => {
                          const filtersData = cp7Filters;
                          const hasFilter = col.filterable && filtersData[col.key]?.length > 0;
                          const isGroupEnd = groupEndKeys.includes(col.key);
                          return (
                            <th key={col.key} 
                                title={col.title}
                                style={{ 
                                  ...thStyle, 
                                  width: col.width, 
                                  textAlign: col.align || 'left', 
                                  background: hasFilter ? '#DBEAFE' : (col.groupColor || '#F9FAFB'), 
                                  cursor: col.filterable ? 'pointer' : 'default',
                                  borderRight: isGroupEnd ? '3px solid #E5E7EB' : '1px solid #F3F4F6'
                                }}
                                onClick={col.filterable ? (e) => handleFilterHeaderClick(col.key, e) : undefined}>
                              {col.label}{hasFilter && ` (${filtersData[col.key].length})`}{col.filterable && ' ▼'}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCp7Data.length > 0 ? filteredCp7Data.slice(cp7Page * pageSize, (cp7Page + 1) * pageSize).map((row, idx) => (
                        <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#EEF2FF'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB'}>
                          <td style={{...tdStyle, fontFamily: 'monospace', fontWeight: 600}}>
                             <span style={{ color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => openVinHistory(row.VIN)}>{row.VIN}</span>
                          </td>
                          <td style={tdStyle}>{row.MODEL || '—'}</td>
                          <td style={{ ...tdStyle, borderRight: '3px solid #E5E7EB' }}>{row.COMPLECTATION || '—'}</td>
                          <td style={{ ...tdStyle, background: 'rgba(239, 246, 255, 0.4)' }}>{formatDateTime(row.CP7_DATE)}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, background: 'rgba(239, 246, 255, 0.4)', borderRight: '3px solid #E5E7EB', color: (row.CP7_VOLTAGE >= 12.6) ? '#059669' : '#DC2626' }}>
                            {row.CP7_VOLTAGE !== null ? `${row.CP7_VOLTAGE} V` : '—'}
                          </td>
                          <td style={{ ...tdStyle, background: 'rgba(254, 242, 242, 0.4)' }}>{formatDateTime(row.FIRST_NOK_DATE)}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, background: 'rgba(254, 242, 242, 0.4)', borderRight: '3px solid #E5E7EB', color: '#DC2626' }}>
                            {row.FIRST_NOK_VOLTAGE !== null ? `${row.FIRST_NOK_VOLTAGE} V` : '—'}
                          </td>
                          <td style={{ ...tdStyle, background: 'rgba(240, 253, 244, 0.4)' }}>{formatDateTime(row.FIRST_OK_DATE)}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, background: 'rgba(240, 253, 244, 0.4)', borderRight: '3px solid #E5E7EB', color: '#059669' }}>
                            {row.FIRST_OK_VOLTAGE !== null ? `${row.FIRST_OK_VOLTAGE} V` : '—'}
                          </td>
                          <td style={tdStyle}>{formatDateTime(row.TEN_MIN_DATE)}</td>
                          
                          <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 900, fontSize: 16, color: row.TEN_MIN_RESULT === '+' ? '#059669' : (row.TEN_MIN_RESULT === '-' ? '#DC2626' : '#6B7280') }}>
                            {row.TEN_MIN_RESULT}
                          </td>
                          
                          <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>
                            {row.DIFF_NOK_CP7_MINUTES !== null ? `${row.DIFF_NOK_CP7_MINUTES} мин` : '—'}
                          </td>
                        </tr>
                      )) : <tr><td colSpan={currentColumns.length} style={{ textAlign: 'center', padding: 30, color: '#6B7280' }}>Нет данных за выбранный период</td></tr>}
                    </tbody>
                  </table>
                </div>

                {/* Пагинация */}
                {filteredCp7Data.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                    <span style={{ fontSize: 14, color: '#6B7280' }}>Всего строк: {filteredCp7Data.length}</span>
                    {Math.ceil(filteredCp7Data.length / pageSize) > 1 && (
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <button onClick={() => setCp7Page(p => Math.max(0, p - 1))} disabled={cp7Page === 0} style={{ ...buttonStyle, background: cp7Page === 0 ? '#CBD5E1' : '#9CA3AF' }}>Назад</button>
                        <span style={{ fontWeight: 500 }}>{cp7Page + 1} / {Math.ceil(filteredCp7Data.length / pageSize)}</span>
                        <button onClick={() => setCp7Page(p => Math.min(Math.ceil(filteredCp7Data.length / pageSize) - 1, p + 1))} disabled={cp7Page === Math.ceil(filteredCp7Data.length / pageSize) - 1} style={{ ...buttonStyle, background: cp7Page === Math.ceil(filteredCp7Data.length / pageSize) - 1 ? '#CBD5E1' : '#9CA3AF' }}>Вперёд</button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ================== ВКЛАДКА SPC ================== */}
        {activeTab === 'spc' && (
          <>
            <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12, background: '#F9FAFB', padding: 16, borderRadius: 12, border: '1px solid #E5E7EB' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: useMeasureDate ? 1 : 0.5, background: useMeasureDate ? '#F0FDF4' : 'transparent', padding: '6px 12px', borderRadius: 8, border: `1px solid ${useMeasureDate ? '#DCFCE7' : 'transparent'}` }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#166534', width: 135 }}>
                    <input type="checkbox" checked={useMeasureDate} onChange={(e) => setUseMeasureDate(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} /> Дата замера:
                  </label>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} disabled={!useMeasureDate} style={{ ...inputStyle, width: 125, padding: '6px 8px' }} />
                  <span style={{ fontSize: 13, color: '#6B7280' }}>—</span>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} disabled={!useMeasureDate} style={{ ...inputStyle, width: 125, padding: '6px 8px' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#EFF6FF', padding: '6px 12px', borderRadius: 8, border: '1px solid #DBEAFE' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1E40AF', width: 90 }}>Дата CP8:</span>
                  <input type="datetime-local" value={cp8Start} onChange={(e) => setCp8Start(e.target.value)} style={{ ...inputStyle, width: 165, padding: '6px 8px' }} />
                  <span style={{ fontSize: 13, color: '#6B7280' }}>—</span>
                  <input type="datetime-local" value={cp8End} onChange={(e) => setCp8End(e.target.value)} style={{ ...inputStyle, width: 165, padding: '6px 8px' }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, flex: 1, maxWidth: 400 }}>
                  VIN: <input type="text" value={vinSearch} onChange={(e) => setVinSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadData()} placeholder="Введите VIN..." style={{ ...inputStyle, width: '100%', padding: '8px 12px' }} />
                </label>
                <button style={buttonStyle} onClick={loadData}>Применить</button>
              </div>
            </div>

            {/* ТАБЛИЦА SPC */}
            {loading ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>
                <style>{loadingAnimation}</style>
                <div className="loading-dots"><span>Загрузка данных</span><span>.</span><span>.</span><span>.</span></div>
              </div>
            ) : error ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#DC2626' }}>Ошибка: {error}</div>
            ) : (
              <>
                <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 450px)', borderRadius: 8, border: '1px solid #E5E7EB' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1100 }}>
                    <thead>
                      <tr>
                        {currentColumns.map(col => {
                          const filtersData = filters;
                          const hasFilter = col.filterable && filtersData[col.key]?.length > 0;
                          const isGroupEnd = groupEndKeys.includes(col.key);
                          return (
                            <th key={col.key} 
                                title={col.title}
                                style={{ 
                                  ...thStyle, 
                                  width: col.width, 
                                  textAlign: col.align || 'left', 
                                  background: hasFilter ? '#DBEAFE' : (col.groupColor || '#F9FAFB'), 
                                  cursor: col.filterable ? 'pointer' : 'default',
                                  borderRight: isGroupEnd ? '3px solid #E5E7EB' : '1px solid #F3F4F6'
                                }}
                                onClick={col.filterable ? (e) => handleFilterHeaderClick(col.key, e) : undefined}>
                              {col.label}{hasFilter && ` (${filtersData[col.key].length})`}{col.filterable && ' ▼'}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredData.length > 0 ? filteredData.slice(page * pageSize, (page + 1) * pageSize).map((row, idx) => (
                        <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#EEF2FF'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB'}>
                          <td style={{...tdStyle, fontFamily: 'monospace', fontWeight: 600}}>
                            <span style={{ color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => openVinHistory(row.VIN)}>{row.VIN}</span>
                          </td>
                          <td style={{ ...tdStyle, borderRight: '3px solid #E5E7EB' }}>{row.MODEL || '—'}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, color: '#DC2626', background: 'rgba(254, 242, 242, 0.4)' }}>{row.VOLTAGE || '—'}</td>
                          <td style={{ ...tdStyle, background: 'rgba(254, 242, 242, 0.4)', borderRight: '3px solid #E5E7EB' }}>{formatDateTime(row.MEASURE_DATE)}</td>
                          <td style={{ ...tdStyle, fontWeight: 600, color: '#059669', background: 'rgba(240, 253, 244, 0.4)' }}>{row.LAST_OK_VOLTAGE || '—'}</td>
                          <td style={{ ...tdStyle, background: 'rgba(240, 253, 244, 0.4)', borderRight: '3px solid #E5E7EB' }}>{formatDateTime(row.LAST_OK_DATE)}</td>
                          <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 900, fontSize: 16, color: row.TEN_MIN_NG === '+' ? '#059669' : '#DC2626' }}>{row.TEN_MIN_NG}</td>
                          <td style={tdStyle}>{formatDateTime(row.CP8_DATE)}</td>
                        </tr>
                      )) : <tr><td colSpan={currentColumns.length} style={{ textAlign: 'center', padding: 30, color: '#6B7280' }}>Нет данных за выбранный период</td></tr>}
                    </tbody>
                  </table>
                </div>

                {/* Пагинация */}
                {filteredData.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                    <span style={{ fontSize: 14, color: '#6B7280' }}>Всего строк: {filteredData.length}</span>
                    {Math.ceil(filteredData.length / pageSize) > 1 && (
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ ...buttonStyle, background: page === 0 ? '#CBD5E1' : '#9CA3AF' }}>Назад</button>
                        <span style={{ fontWeight: 500 }}>{page + 1} / {Math.ceil(filteredData.length / pageSize)}</span>
                        <button onClick={() => setPage(p => Math.min(Math.ceil(filteredData.length / pageSize) - 1, p + 1))} disabled={page === Math.ceil(filteredData.length / pageSize) - 1} style={{ ...buttonStyle, background: page === Math.ceil(filteredData.length / pageSize) - 1 ? '#CBD5E1' : '#9CA3AF' }}>Вперёд</button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* Dropdown фильтра */}
        {activeFilterColumn && (
          <div className="filter-dropdown" style={{ ...filterDropdownStyle, top: filterDropdownPos.top, left: filterDropdownPos.left }}>
            <div style={{ ...filterOptionStyle, fontWeight: 700, borderBottom: '1px solid #E5E7EB', marginBottom: 4 }}
                 onClick={() => handleFilterClear(activeFilterColumn, activeTab === 'cp7')}
                 onMouseEnter={(e) => e.currentTarget.style.background = '#F3F4F6'}
                 onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              Очистить фильтр
            </div>
            {getUniqueValues(activeFilterColumn).map(val => {
              const filterSource = activeTab === 'spc' ? filters : cp7Filters;
              const isChecked = filterSource[activeFilterColumn]?.includes(val);
              return (
                <div key={val} style={{ ...filterOptionStyle, background: isChecked ? '#EFF6FF' : 'transparent' }}
                     onClick={() => handleFilterToggle(activeFilterColumn, val, activeTab === 'cp7')}
                     onMouseEnter={(e) => e.currentTarget.style.background = '#F3F4F6'}
                     onMouseLeave={(e) => e.currentTarget.style.background = isChecked ? '#EFF6FF' : 'transparent'}>
                  <input type="checkbox" checked={!!isChecked} readOnly /> {val}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ================= МОДАЛКА ================= */}
      {modalOpen && (
        <div style={modalOverlayStyle} onClick={() => setModalOpen(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 20, color: '#1F2937', fontWeight: 700 }}>
                {modalTitle}
              </h3>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#6B7280', lineHeight: 1 }}>×</button>
            </div>
            
            {modalLoading ? (
              <p style={{ textAlign: 'center', padding: 20 }}>Загрузка...</p>
            ) : modalData.length === 0 ? (
              <p style={{ textAlign: 'center', padding: 20, color: '#6B7280' }}>Нет данных</p>
            ) : (
              <div style={{ overflowY: 'auto', flex: 1, border: '1px solid #E5E7EB', borderRadius: 8 }}>
                {modalTitle.startsWith('История замеров') ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#F9FAFB', position: 'sticky', top: 0, zIndex: 1 }}>
                        <th style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>Время замера</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>Вольтаж</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>Тип проверки</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>Результат (расчет)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modalData.map((m, i) => {
                        const isOk = m.VOLTAGE >= 12.6; // ОБНОВЛЕНО: верхней границы нет
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid #F0F0F5', backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                            <td style={{ padding: '10px 14px' }}>{formatDateTime(m.CREATION_TIME)}</td>
                            <td style={{ padding: '10px 14px', fontWeight: 'bold', color: isOk ? '#059669' : '#DC2626' }}>
                              {m.VOLTAGE} V
                            </td>
                            <td style={{ padding: '10px 14px' }}>{m.TYPE || '—'}</td>
                            <td style={{ padding: '10px 14px' }}>
                              <span style={{
                                padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                                background: isOk ? '#DCFCE7' : '#FEE2E2',
                                color: isOk ? '#166534' : '#991B1B'
                              }}>
                                {isOk ? 'OK' : 'NG'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#F9FAFB', position: 'sticky', top: 0, zIndex: 1 }}>
                        <th style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>VIN</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>Модель</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>CP7 Время / V</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>TLADAS Время / V / &lt;1ч</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>CP8 Время / V</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modalData.map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #F0F0F5', backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 'bold' }}>{row.VIN}</td>
                          <td style={{ padding: '10px 14px' }}>{row.MODEL}</td>
                          
                          <td style={{ padding: '10px 14px' }}>
                            <div>{formatDateTime(row.CP7_DATE)}</div>
                            <div style={{ fontWeight: 'bold', color: row.CP7_OK === true ? '#059669' : row.CP7_OK === false ? '#DC2626' : '#6B7280' }}>
                              {row.CP7_VOLTAGE ? `${row.CP7_VOLTAGE} V` : '—'}
                            </div>
                          </td>

                          <td style={{ padding: '10px 14px' }}>
                            <div>{row.TLADAS_DATE ? formatDateTime(row.TLADAS_DATE) : 'Не проходил'}</div>
                            {row.TLADAS_DATE && (
                              <>
                                <div style={{ fontWeight: 'bold', color: row.TLADAS_OK === true ? '#059669' : row.TLADAS_OK === false ? '#DC2626' : '#6B7280' }}>
                                  {row.TLADAS_VOLTAGE ? `${row.TLADAS_VOLTAGE} V` : '—'}
                                </div>
                                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                                  {row.TLADAS_STATUS === 'under1h' ? 'В течение 1ч' : row.TLADAS_STATUS === 'over1h' ? 'Более 1ч' : ''}
                                </div>
                              </>
                            )}
                          </td>

                          <td style={{ padding: '10px 14px' }}>
                            <div>{row.CP8_DATE ? formatDateTime(row.CP8_DATE) : 'Не проходил'}</div>
                            {row.CP8_DATE && (
                              <div style={{ fontWeight: 'bold', color: row.CP8_OK === true ? '#059669' : row.CP8_OK === false ? '#DC2626' : '#6B7280' }}>
                                {row.CP8_VOLTAGE ? `${row.CP8_VOLTAGE} V` : '—'}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}