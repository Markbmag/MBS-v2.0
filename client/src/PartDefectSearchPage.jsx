import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const API_BASE = '';

const inputStyle = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: 14,
  background: '#F9FAFB',
};

const timeInputStyle = {
  ...inputStyle,
  width: '90px',
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
  boxShadow: '0 2px 6px rgba(37,99,235,0.3)',
};

const cardStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  padding: 24,
  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
  border: '1px solid #F0F0F5',
  flex: 1,
  minWidth: 0,
};

const tabStyle = (active) => ({
  padding: '10px 28px',
  borderRadius: 10,
  border: 'none',
  fontWeight: 600,
  fontSize: 15,
  background: active ? '#2563EB' : '#F3F4F6',
  color: active ? '#FFFFFF' : '#6B7280',
  cursor: 'pointer',
  boxShadow: active ? '0 4px 12px rgba(37,99,235,0.25)' : 'none',
  transition: 'all 0.2s',
});

const thStyle = {
  padding: '12px 14px',
  textAlign: 'left',
  fontWeight: 600,
  color: '#374151',
  borderBottom: '2px solid #E5E7EB',
  background: '#F9FAFB',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '10px 14px',
  borderBottom: '1px solid #F0F0F5',
  color: '#1F2937',
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
  minWidth: 200,
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

// Анимация загрузки (мигающие точки)
const loadingAnimation = `
  @keyframes blink {
    0% { opacity: 0.2; }
    20% { opacity: 1; }
    100% { opacity: 0.2; }
  }
  .loading-dots span {
    animation: blink 1.4s infinite both;
  }
  .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
  .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
`;

export default function PartDefectSearchPage() {
  const [activeTab, setActiveTab] = useState('part');

  // Поиск по детали/модели
  const [leftPart, setLeftPart] = useState('');
  const [leftDefect, setLeftDefect] = useState('');
  const [leftModel, setLeftModel] = useState('ALL');
  const [leftDateFrom, setLeftDateFrom] = useState('');
  const [leftTimeFrom, setLeftTimeFrom] = useState('00:00');
  const [leftDateTo, setLeftDateTo] = useState('');
  const [leftTimeTo, setLeftTimeTo] = useState('23:59');
  const [leftAllData, setLeftAllData] = useState([]);
  const [leftLoading, setLeftLoading] = useState(false);
  const [leftError, setLeftError] = useState(null);
  const [leftUniqueMode, setLeftUniqueMode] = useState(false);
  const [leftPage, setLeftPage] = useState(0);
  const [leftColumnFilters, setLeftColumnFilters] = useState({});

  // Поиск по VIN/модели
  const [rightVin, setRightVin] = useState('');
  const [rightModel, setRightModel] = useState('ALL');
  const [rightDateFrom, setRightDateFrom] = useState('');
  const [rightTimeFrom, setRightTimeFrom] = useState('00:00');
  const [rightDateTo, setRightDateTo] = useState('');
  const [rightTimeTo, setRightTimeTo] = useState('23:59');
  const [rightAllData, setRightAllData] = useState([]);
  const [rightLoading, setRightLoading] = useState(false);
  const [rightError, setRightError] = useState(null);
  const [rightUniqueMode, setRightUniqueMode] = useState(false);
  const [rightPage, setRightPage] = useState(0);
  const [rightColumnFilters, setRightColumnFilters] = useState({});

  const [activeFilterColumn, setActiveFilterColumn] = useState(null);
  const [filterDropdownPos, setFilterDropdownPos] = useState({ top: 0, left: 0 });

  const availableModels = ['ALL', 'ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];
  const pageSize = 50;

  // Колонки таблицы (добавлен Комментарий)
  const timePointColumns = [
    { key: 'vin', label: 'VIN', filterable: true },
    { key: 'part_name', label: 'Деталь', filterable: true },
    { key: 'problem_type', label: 'Дефект', filterable: true },
    { key: 'problem_replenish', label: 'Комментарий', filterable: false },
    { key: 'defect_creation_time', label: 'Дата дефекта', isTime: true, filterable: false },
    { key: 'material_code', label: 'Material Code', filterable: true },
    { key: 'sequence_number', label: 'Sequence', filterable: true },
    { key: 'kd_material_no', label: 'KD', filterable: true },
    { key: 'model', label: 'Model', filterable: true },
    { key: 'material_desc', label: 'Комплектация', filterable: true },
    { key: 'colour', label: 'Цвет', filterable: true },
    { key: 'CP5', label: 'CP5', isTime: true, filterable: false },
    { key: 'CP6', label: 'CP6', isTime: true, filterable: false },
    { key: 'TRIMIN', label: 'TRIMIN', isTime: true, filterable: false },
    { key: 'CP7', label: 'CP7', isTime: true, filterable: false },
    { key: 'CP72', label: 'CP72', isTime: true, filterable: false },
    { key: 'TLWA', label: 'TLWA', isTime: true, filterable: false },
    { key: 'TLRT', label: 'TLRT', isTime: true, filterable: false },
    { key: 'TLADAS', label: 'TLADAS', isTime: true, filterable: false },
    { key: 'TLTT', label: 'TLTT', isTime: true, filterable: false },
    { key: 'CPFINAL', label: 'CPFINAL', isTime: true, filterable: false },
    { key: 'CP8', label: 'CP8', isTime: true, filterable: false },
    { key: 'in_storage_time', label: 'Inbound', isTime: true, filterable: false },
    { key: 'out_storage_time', label: 'Outbound', isTime: true, filterable: false },
    { key: 'current_zone', label: 'Текущее расположение', filterable: true },
  ];

  // Убираем точные дубликаты (одинаковые vin + part_name + problem_type)
  const getUniqueRows = (data) => {
    const seen = new Set();
    return data.filter(row => {
      const key = `${row.vin}|${row.part_name}|${row.problem_type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const getFilteredData = (allData, columnFilters, uniqueMode) => {
    let data = uniqueMode ? getUniqueRows(allData) : allData;
    if (Object.keys(columnFilters).length === 0) return data;
    return data.filter(row => {
      for (const [column, selectedValues] of Object.entries(columnFilters)) {
        if (selectedValues.length > 0 && !selectedValues.includes(row[column])) {
          return false;
        }
      }
      return true;
    });
  };

  const filteredLeftData = useMemo(() => getFilteredData(leftAllData, leftColumnFilters, leftUniqueMode), [leftAllData, leftColumnFilters, leftUniqueMode]);
  const filteredRightData = useMemo(() => getFilteredData(rightAllData, rightColumnFilters, rightUniqueMode), [rightAllData, rightColumnFilters, rightUniqueMode]);

  const paginatedLeftData = useMemo(() => filteredLeftData.slice(leftPage * pageSize, (leftPage + 1) * pageSize), [filteredLeftData, leftPage]);
  const paginatedRightData = useMemo(() => filteredRightData.slice(rightPage * pageSize, (rightPage + 1) * pageSize), [filteredRightData, rightPage]);

  useEffect(() => { setLeftPage(0); }, [leftUniqueMode, leftColumnFilters, leftAllData]);
  useEffect(() => { setRightPage(0); }, [rightUniqueMode, rightColumnFilters, rightAllData]);

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
    const handleScroll = () => setActiveFilterColumn(null);
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, []);

  const handleFilterHeaderClick = (column, event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setFilterDropdownPos({ top: rect.bottom + 4, left: rect.left });
    setActiveFilterColumn(activeFilterColumn === column ? null : column);
  };

  const handleFilterToggle = (column, value) => {
    const setter = activeTab === 'part' ? setLeftColumnFilters : setRightColumnFilters;
    setter(prev => {
      const currentValues = prev[column] || [];
      const newValues = currentValues.includes(value)
        ? currentValues.filter(v => v !== value)
        : [...currentValues, value];
      const newFilters = { ...prev };
      if (newValues.length > 0) newFilters[column] = newValues;
      else delete newFilters[column];
      return newFilters;
    });
  };

  const handleFilterClear = (column) => {
    const setter = activeTab === 'part' ? setLeftColumnFilters : setRightColumnFilters;
    setter(prev => {
      const newPrev = { ...prev };
      delete newPrev[column];
      return newPrev;
    });
    setActiveFilterColumn(null);
  };

  const getUniqueValues = (column, allData) => {
    if (!allData) return [];
    const values = [...new Set(allData.map(d => d[column]).filter(v => v !== null && v !== undefined && v !== ''))];
    return values.sort();
  };

  const exportToExcel = (data, filename) => {
    if (!data || data.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${filename}.xlsx`);
  };

  const searchLeft = async () => {
    if (!leftPart.trim() && !leftDefect.trim() && leftModel === 'ALL') {
      alert('Заполните хотя бы одно поле');
      return;
    }
    setLeftLoading(true);
    setLeftError(null);
    try {
      const params = new URLSearchParams();
      if (leftPart.trim()) params.append('part', leftPart.trim());
      if (leftDefect.trim()) params.append('defect', leftDefect.trim());
      if (leftModel !== 'ALL') params.append('model', leftModel);
      if (leftDateFrom) params.append('dateFrom', `${leftDateFrom} ${leftTimeFrom}:00`);
      if (leftDateTo) params.append('dateTo', `${leftDateTo} ${leftTimeTo}:59`);
      const res = await fetch(`${API_BASE}/api/part-defect-search?${params.toString()}`);
      if (!res.ok) throw new Error(`Ошибка ${res.status}`);
      const json = await res.json();
      setLeftAllData(Array.isArray(json) ? json : []);
      setLeftColumnFilters({});
      setLeftPage(0);
    } catch (err) {
      setLeftError(err.message);
    } finally {
      setLeftLoading(false);
    }
  };

  const searchRight = async () => {
    if (!rightVin.trim() && rightModel === 'ALL') {
      alert('Заполните VIN или модель');
      return;
    }
    setRightLoading(true);
    setRightError(null);
    try {
      const params = new URLSearchParams();
      if (rightVin.trim()) params.append('vin', rightVin.trim());
      if (rightModel !== 'ALL') params.append('model', rightModel);
      if (rightDateFrom) params.append('dateFrom', `${rightDateFrom} ${rightTimeFrom}:00`);
      if (rightDateTo) params.append('dateTo', `${rightDateTo} ${rightTimeTo}:59`);
      const res = await fetch(`${API_BASE}/api/vin-defect-search?${params.toString()}`);
      if (!res.ok) throw new Error(`Ошибка ${res.status}`);
      const json = await res.json();
      setRightAllData(Array.isArray(json) ? json : []);
      setRightColumnFilters({});
      setRightPage(0);
    } catch (err) {
      setRightError(err.message);
    } finally {
      setRightLoading(false);
    }
  };

  const renderDateFilter = (dateFrom, setDateFrom, timeFrom, setTimeFrom, dateTo, setDateTo, timeTo, setTimeTo) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#4B5563' }}>Дата внесения дефекта:</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13, color: '#4B5563' }}>С:</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
        <input type="time" value={timeFrom} onChange={e => setTimeFrom(e.target.value)} style={timeInputStyle} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13, color: '#4B5563' }}>По:</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
        <input type="time" value={timeTo} onChange={e => setTimeTo(e.target.value)} style={timeInputStyle} />
      </div>
    </div>
  );

  const renderTable = (
    data,
    columns,
    loading,
    error,
    exportName,
    exportData,
    columnFilters,
    allData,
    activeFilterColumn,
    filterDropdownPos,
    uniqueMode,
    setUniqueMode,
    page,
    setPage,
    totalItems,
    totalPages
  ) => {
    if (loading) {
      return (
        <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>
          <style>{loadingAnimation}</style>
          <div className="loading-dots" style={{ display: 'inline-block' }}>
            <span>Загрузка данных</span>
            <span>.</span><span>.</span><span>.</span>
          </div>
        </div>
      );
    }
    if (error) return <div style={{ textAlign: 'center', padding: 40, color: '#DC2626' }}>❌ {error}</div>;
    if (data.length === 0) return <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Нет данных</div>;

    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Найдено: {totalItems}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={uniqueMode}
                onChange={(e) => setUniqueMode(e.target.checked)}
              />
              <span style={{ fontSize: 13 }}>Уникальные VIN</span>
            </label>
            <button onClick={() => exportToExcel(exportData, exportName)} style={{ ...buttonStyle, background: '#059669', padding: '6px 12px', fontSize: 12 }}>
              📊 Excel
            </button>
          </div>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 400px)', borderRadius: 8, border: '1px solid #E5E7EB' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 2800 }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                {columns.map(col => (
                  <th
                    key={col.key}
                    style={{
                      ...thStyle,
                      cursor: col.filterable ? 'pointer' : 'default',
                      background: columnFilters[col.key]?.length > 0 ? '#DBEAFE' : '#F9FAFB',
                    }}
                    onClick={col.filterable ? (e) => handleFilterHeaderClick(col.key, e) : undefined}
                  >
                    {col.label}
                    {columnFilters[col.key]?.length > 0 && ` (${columnFilters[col.key].length})`}
                    {col.filterable && ' ▼'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                  {columns.map(col => (
                    <td key={col.key} style={tdStyle}>
                      {col.isTime ? (row[col.key] ? new Date(row[col.key]).toLocaleString('ru-RU') : '-') : (row[col.key] || '-')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 16 }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ ...buttonStyle, background: '#9CA3AF' }}>
              ← Назад
            </button>
            <span style={{ alignSelf: 'center', fontWeight: 500 }}>{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} style={{ ...buttonStyle, background: '#9CA3AF' }}>
              Вперёд →
            </button>
          </div>
        )}
        {activeFilterColumn && allData.length > 0 && (
          <div
            className="filter-dropdown"
            style={{ ...filterDropdownStyle, top: filterDropdownPos.top, left: filterDropdownPos.left }}
          >
            <div
              style={{ ...filterOptionStyle, fontWeight: 700, borderBottom: '1px solid #E5E7EB', marginBottom: 4 }}
              onClick={() => handleFilterClear(activeFilterColumn)}
            >
              ✕ Очистить фильтр
            </div>
            {getUniqueValues(activeFilterColumn, allData).map(val => {
              const isChecked = columnFilters[activeFilterColumn]?.includes(val);
              return (
                <div
                  key={val}
                  style={{ ...filterOptionStyle, background: isChecked ? '#EFF6FF' : 'transparent' }}
                  onClick={() => handleFilterToggle(activeFilterColumn, val)}
                >
                  <input type="checkbox" checked={isChecked} readOnly />
                  {val}
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  };

  return (
    <div style={{ padding: 30, fontFamily: 'Inter, Segoe UI, Arial, sans-serif', maxWidth: 1400, margin: '0 auto' }}>
      <h1 style={{ color: '#111827', fontSize: 28, fontWeight: 800, marginBottom: 30 }}>Part/Defect Search</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 30 }}>
        <button style={tabStyle(activeTab === 'part')} onClick={() => setActiveTab('part')}>
          🔍 Поиск дефектов по детали/модели
        </button>
        <button style={tabStyle(activeTab === 'vin')} onClick={() => setActiveTab('vin')}>
          🔍 Поиск дефектов по VIN/модели
        </button>
      </div>

      {activeTab === 'part' && (
        <div style={cardStyle}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1F2937', marginBottom: 20 }}>
            Поиск по детали или дефекту
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            <input type="text" placeholder="Деталь (часть названия)" value={leftPart} onChange={e => setLeftPart(e.target.value)} style={inputStyle} />
            <input type="text" placeholder="Дефект (часть названия)" value={leftDefect} onChange={e => setLeftDefect(e.target.value)} style={inputStyle} />
            <select value={leftModel} onChange={e => setLeftModel(e.target.value)} style={inputStyle}>
              {availableModels.map(m => <option key={m} value={m}>{m === 'ALL' ? 'Все модели' : m}</option>)}
            </select>
            {renderDateFilter(leftDateFrom, setLeftDateFrom, leftTimeFrom, setLeftTimeFrom, leftDateTo, setLeftDateTo, leftTimeTo, setLeftTimeTo)}
            <button onClick={searchLeft} disabled={leftLoading} style={buttonStyle}>
              {leftLoading ? '⏳ Поиск...' : '🔎 Найти'}
            </button>
          </div>
          {renderTable(
            paginatedLeftData,
            timePointColumns,
            leftLoading,
            leftError,
            'part_defect_search',
            filteredLeftData,
            leftColumnFilters,
            leftAllData,
            activeFilterColumn,
            filterDropdownPos,
            leftUniqueMode,
            setLeftUniqueMode,
            leftPage,
            setLeftPage,
            filteredLeftData.length,
            Math.ceil(filteredLeftData.length / pageSize)
          )}
        </div>
      )}

      {activeTab === 'vin' && (
        <div style={cardStyle}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1F2937', marginBottom: 20 }}>
            Поиск по VIN или модели
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            <input type="text" placeholder="VIN (или часть)" value={rightVin} onChange={e => setRightVin(e.target.value)} style={inputStyle} />
            <select value={rightModel} onChange={e => setRightModel(e.target.value)} style={inputStyle}>
              {availableModels.map(m => <option key={m} value={m}>{m === 'ALL' ? 'Все модели' : m}</option>)}
            </select>
            {renderDateFilter(rightDateFrom, setRightDateFrom, rightTimeFrom, setRightTimeFrom, rightDateTo, setRightDateTo, rightTimeTo, setRightTimeTo)}
            <button onClick={searchRight} disabled={rightLoading} style={buttonStyle}>
              {rightLoading ? '⏳ Поиск...' : '🔎 Найти'}
            </button>
          </div>
          {renderTable(
            paginatedRightData,
            timePointColumns,
            rightLoading,
            rightError,
            'vin_defect_search',
            filteredRightData,
            rightColumnFilters,
            rightAllData,
            activeFilterColumn,
            filterDropdownPos,
            rightUniqueMode,
            setRightUniqueMode,
            rightPage,
            setRightPage,
            filteredRightData.length,
            Math.ceil(filteredRightData.length / pageSize)
          )}
        </div>
      )}
    </div>
  );
}