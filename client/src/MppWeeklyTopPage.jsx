import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, LabelList
} from 'recharts';

const API_BASE = '';

const inputStyle = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: 14,
  background: '#F9FAFB',
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
};

const cardStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  padding: 28,
  marginBottom: 30,
  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
  border: '1px solid #F0F0F5',
};

const COLORS = ['#3B82F6', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6', '#F97316', '#84CC16'];

const formatHours = (value) =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const truncate = (str, maxLen = 28) =>
  str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;

// ====== МУЛЬТИСЕЛЕКТ ======
function MultiSelect({ options, selected, onChange, placeholder }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const nonAllOptions = options.filter(o => o !== 'ALL');
  const allSelected = selected.length === nonAllOptions.length && nonAllOptions.length > 0;

  const handleToggle = (value) => {
    if (value === 'ALL') {
      if (allSelected) {
        onChange([]);
      } else {
        onChange(nonAllOptions);
      }
    } else {
      const updated = selected.includes(value)
        ? selected.filter(v => v !== value)
        : [...selected, value];
      onChange(updated);
    }
  };

  const displayText = selected.length === 0 || allSelected
    ? placeholder
    : selected.join(', ');

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          ...inputStyle,
          width: 120,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
          cursor: 'pointer',
          textAlign: 'left',
          padding: '8px 10px',
        }}
      >
        <span style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 80,
          fontSize: 13,
        }}>
          {displayText}
        </span>
        <span style={{ fontSize: 10, color: '#6B7280' }}>▼</span>
      </button>
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: 4,
          background: '#FFFFFF',
          borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          padding: 12,
          minWidth: 200,
          zIndex: 100,
          border: '1px solid #F0F0F5',
          maxHeight: 300,
          overflowY: 'auto',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => handleToggle('ALL')}
            />
            Все
          </label>
          {nonAllOptions.map(option => (
            <label key={option} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer', fontSize: 14 }}>
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => handleToggle(option)}
              />
              {option}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MppWeeklyTopPage() {
  const [activeTab, setActiveTab] = useState('report');

  // Фильтры
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedCheckpoints, setSelectedCheckpoints] = useState([]);
  const [selectedModels, setSelectedModels] = useState([]);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedMpp, setExpandedMpp] = useState(null);
  const [vinData, setVinData] = useState([]);
  const [vinLoading, setVinLoading] = useState(false);

  // Аналитика
  const [analyticsData, setAnalyticsData] = useState([]);
  const [analyticsSummary, setAnalyticsSummary] = useState({ totalVins: 0, totalRemVins: 0 });
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(null);

  // Скрытие строк дефектов
  const [hiddenRows, setHiddenRows] = useState({});
  const hiddenCount = Object.values(hiddenRows).filter(Boolean).length;

  // Для графика динамики
  const [trendModalOpen, setTrendModalOpen] = useState(false);
  const [trendData, setTrendData] = useState(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendMpp, setTrendMpp] = useState('');
  const [trendMetric, setTrendMetric] = useState('defects'); // 'defects' или 'dpu'

  const availableModels = ['ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];
  const availableCheckpoints = ['CP7', 'CP8', 'PIP', 'TL'];

  // Установка дат по умолчанию (вчера)
  useEffect(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];
    setDateFrom(yStr);
    setDateTo(yStr);
  }, []);

  // ====== ЗАГРУЗКА ДАННЫХ С МНОЖЕСТВЕННЫМ ВЫБОРОМ ======
  const loadData = async () => {
    setLoading(true);
    try {
      const allCheckpointsSelected = selectedCheckpoints.length === availableCheckpoints.length;
      const allModelsSelected = selectedModels.length === availableModels.length;
      
      const checkpointList = (selectedCheckpoints.length === 0 || allCheckpointsSelected) 
        ? ['ALL'] 
        : selectedCheckpoints;
      
      const modelList = (selectedModels.length === 0 || allModelsSelected) 
        ? ['ALL'] 
        : selectedModels;
      
      const allResults = [];
      
      for (const cp of checkpointList) {
        for (const mdl of modelList) {
          const params = new URLSearchParams({
            dateFrom,
            dateTo,
            checkpoint: cp,
            model: mdl,
            defectType: 'offline',
          });
          
          const res = await fetch(`${API_BASE}/api/mpp-weekly-top?${params.toString()}`);
          if (!res.ok) throw new Error('Ошибка загрузки данных');
          const json = await res.json();
          
          if (Array.isArray(json)) {
            allResults.push(...json);
          }
        }
      }
      
      // Объединяем дубликаты MPP
      const uniqueMap = {};
      allResults.forEach(row => {
        if (!uniqueMap[row.MPP]) {
          uniqueMap[row.MPP] = { ...row };
        } else {
          uniqueMap[row.MPP].DEFECT_COUNT += row.DEFECT_COUNT;
          uniqueMap[row.MPP].VIN_COUNT += row.VIN_COUNT;
          uniqueMap[row.MPP].TOTAL_VINS += row.TOTAL_VINS || 0;
          uniqueMap[row.MPP].REMZONE_VINS += row.REMZONE_VINS || 0;
        }
      });
      
      // Пересчитываем REMZONE_PERCENT
      Object.values(uniqueMap).forEach(row => {
        if (row.TOTAL_VINS > 0) {
          row.REMZONE_PERCENT = ((row.REMZONE_VINS * 100) / row.TOTAL_VINS).toFixed(2);
        }
      });
      
      setData(Object.values(uniqueMap));
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadVins = async (row) => {
    setVinLoading(true);
    try {
      const params = new URLSearchParams({
        partName: row.PART_NAME,
        problemType: row.PROBLEM_TYPE,
        dateFrom,
        dateTo,
        model: row.MODEL,
      });
      const res = await fetch(`${API_BASE}/api/mpp-vins?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки VIN');
      const json = await res.json();
      setVinData(json);
    } catch (err) {
      alert(err.message);
    } finally {
      setVinLoading(false);
    }
  };

  const handleToggleMpp = (row) => {
    if (expandedMpp === row.MPP) {
      setExpandedMpp(null);
      setVinData([]);
    } else {
      setExpandedMpp(row.MPP);
      loadVins(row);
    }
  };

  const exportVins = () => {
    if (vinData.length === 0) return;
    const exportData = vinData.map(v => ({
      VIN: v.VIN,
      Модель: v.MODEL,
      В_ремзоне: v.IN_REMZONE ? 'Да' : 'Нет',
      Время_дефекта: v.DEFECT_TIME || '',
      Зашёл: v.REM_IN || '',
      Вышел: v.REM_OUT || '',
      Время_в_ремзоне: v.REM_DURATION || '',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'VINs');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `VIN_${expandedMpp}.xlsx`);
  };

  const exportFullReport = async () => {
    if (data.length === 0) return;
    setLoading(true);
    try {
      const wb = XLSX.utils.book_new();
      const summary = data.map(row => ({
        MPP: row.MPP,
        Модель: row.MODEL,
        'Кол-во авто': row.VIN_COUNT || 0,
        'Кол-во дефектов': row.DEFECT_COUNT,
        'DPU per 1000': row.DPU,
        'Доля в ремзоне, %': row.REMZONE_PERCENT || '0.00',
      }));
      const wsSummary = XLSX.utils.json_to_sheet(summary);
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Топ MPP');

      for (let row of data) {
        try {
          const params = new URLSearchParams({
            partName: row.PART_NAME,
            problemType: row.PROBLEM_TYPE,
            dateFrom,
            dateTo,
            model: row.MODEL,
          });
          const res = await fetch(`${API_BASE}/api/mpp-vins?${params.toString()}`);
          if (res.ok) {
            const vins = await res.json();
            if (vins.length > 0) {
              const vinExport = vins.map(v => ({
                VIN: v.VIN,
                Модель: v.MODEL,
                В_ремзоне: v.IN_REMZONE ? 'Да' : 'Нет',
                Время_дефекта: v.DEFECT_TIME || '',
                Зашёл: v.REM_IN || '',
                Вышел: v.REM_OUT || '',
                Время_в_ремзоне: v.REM_DURATION || '',
              }));
              const wsVin = XLSX.utils.json_to_sheet(vinExport);
              let sheetName = `VIN ${row.MPP}`.substring(0, 31);
              XLSX.utils.book_append_sheet(wb, wsVin, sheetName);
            }
          }
        } catch (err) {
          console.warn(`Не удалось загрузить VIN для ${row.MPP}`);
        }
      }

      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([buf], { type: 'application/octet-stream' }), 'Топ_MPP_за_неделю.xlsx');
    } catch (err) {
      alert('Ошибка при экспорте: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ====== ЗАГРУЗКА АНАЛИТИКИ С МНОЖЕСТВЕННЫМ ВЫБОРОМ ======
  const loadAnalytics = async () => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const allCheckpointsSelected = selectedCheckpoints.length === availableCheckpoints.length;
      const allModelsSelected = selectedModels.length === availableModels.length;
      
      const checkpointList = (selectedCheckpoints.length === 0 || allCheckpointsSelected) 
        ? ['ALL'] 
        : selectedCheckpoints;
      
      const modelList = (selectedModels.length === 0 || allModelsSelected) 
        ? ['ALL'] 
        : selectedModels;
      
      let allData = [];
      let totalVinsSum = 0;
      let totalRemVinsSum = 0;
      
      for (const cp of checkpointList) {
        for (const mdl of modelList) {
          const params = new URLSearchParams({
            dateFrom,
            dateTo,
            checkpoint: cp,
            model: mdl,
          });
          
          const res = await fetch(`${API_BASE}/api/mpp-drr-analytics?${params.toString()}`);
          if (!res.ok) throw new Error('Ошибка загрузки аналитики');
          const json = await res.json();
          
          if (json.data) {
            allData.push(...json.data);
          }
          if (json.summary) {
            totalVinsSum += json.summary.totalVins || 0;
            totalRemVinsSum += json.summary.totalRemVins || 0;
          }
        }
      }
      
      // Объединяем дубликаты MPP
      const uniqueMap = {};
      allData.forEach(row => {
        if (!uniqueMap[row.MPP]) {
          uniqueMap[row.MPP] = { ...row };
        } else {
          uniqueMap[row.MPP].DEFECT_COUNT += row.DEFECT_COUNT;
          uniqueMap[row.MPP].REMZONE_COUNT += row.REMZONE_COUNT;
          uniqueMap[row.MPP].TOTAL_HOURS += row.TOTAL_HOURS;
        }
      });
      
      setAnalyticsData(Object.values(uniqueMap));
      setAnalyticsSummary({
        totalVins: totalVinsSum,
        totalRemVins: totalRemVinsSum,
      });
    } catch (err) {
      setAnalyticsError(err.message);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  // Загрузка при открытии вкладки и когда даты готовы
  useEffect(() => {
    if (activeTab === 'report' && dateFrom && dateTo) loadData();
  }, [activeTab, dateFrom, dateTo]);

  // Группировка по моделям для круговой диаграммы
  const modelData = useMemo(() => {
    if (!analyticsData.length) return [];
    const map = {};
    analyticsData.forEach(d => {
      const model = d.MODEL || 'Неизвестно';
      map[model] = (map[model] || 0) + d.TOTAL_HOURS;
    });
    return Object.entries(map)
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours);
  }, [analyticsData]);

  const handleToggleRow = (mpp) => {
    setHiddenRows(prev => ({ ...prev, [mpp]: !prev[mpp] }));
  };

  const showAllRows = () => {
    setHiddenRows({});
  };

  // Функция открытия модального окна с трендом
  const openTrend = async (row) => {
    setTrendMpp(row.MPP);
    setTrendModalOpen(true);
    setTrendLoading(true);
    try {
      const checkpointParam = (selectedCheckpoints.length === 0 || selectedCheckpoints.length === availableCheckpoints.length) 
        ? 'ALL' 
        : selectedCheckpoints.join(',');
      
      const fetchTrend = (periodType) => {
        const params = new URLSearchParams({
          partName: row.PART_NAME,
          problemType: row.PROBLEM_TYPE,
          model: row.MODEL,
          checkpoint: checkpointParam,
          periodType,
        });
        return fetch(`${API_BASE}/api/mpp-defect-trend?${params.toString()}`).then(r => r.json());
      };
      
      const [monthData, weekData, dayData] = await Promise.all([
        fetchTrend('month'),
        fetchTrend('week'),
        fetchTrend('day'),
      ]);
      
      setTrendData({ month: monthData, week: weekData, day: dayData });
    } catch (err) {
      alert('Ошибка загрузки тренда: ' + err.message);
    } finally {
      setTrendLoading(false);
    }
  };

  // Подготовка данных для отображения в зависимости от метрики
  const prepareDisplayData = (data) => {
    if (!data) return [];
    return data.map(d => ({
      period: d.period,
      value: trendMetric === 'dpu' 
        ? (d.total_cars > 0 ? Number(((d.defect_count * 1000) / d.total_cars).toFixed(2)) : 0)
        : d.defect_count,
    }));
  };

  return (
    <div style={{ padding: 30, fontFamily: 'Inter, Segoe UI, Arial, sans-serif', maxWidth: 1300, margin: '0 auto' }}>
      <h1 style={{ color: '#111827', fontSize: 28, fontWeight: 800, marginBottom: 30 }}>Топ дефектов по DRR</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 30 }}>
        <button onClick={() => setActiveTab('report')} style={{
          padding: '10px 28px', borderRadius: 10, border: 'none', fontWeight: 600, fontSize: 15,
          background: activeTab === 'report' ? '#2563EB' : '#F3F4F6',
          color: activeTab === 'report' ? '#FFFFFF' : '#6B7280', cursor: 'pointer',
        }}>Отчёт</button>
        <button onClick={() => setActiveTab('analytics')} style={{
          padding: '10px 28px', borderRadius: 10, border: 'none', fontWeight: 600, fontSize: 15,
          background: activeTab === 'analytics' ? '#2563EB' : '#F3F4F6',
          color: activeTab === 'analytics' ? '#FFFFFF' : '#6B7280', cursor: 'pointer',
        }}>Аналитика по DRR</button>
      </div>

      {activeTab === 'report' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, whiteSpace: 'nowrap' }}>
              Начало:
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, whiteSpace: 'nowrap' }}>
              Конец:
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, whiteSpace: 'nowrap' }}>
              Чекпоинты:
              <MultiSelect
                options={['ALL', ...availableCheckpoints]}
                selected={selectedCheckpoints}
                onChange={setSelectedCheckpoints}
                placeholder="Все"
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, whiteSpace: 'nowrap' }}>
              Модели:
              <MultiSelect
                options={['ALL', ...availableModels]}
                selected={selectedModels}
                onChange={setSelectedModels}
                placeholder="Все"
              />
            </label>
            
            <div style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap', flexShrink: 0 }}>
              <button onClick={loadData} disabled={loading} style={buttonStyle}>
                {loading ? '⏳ Загрузка...' : '▶ Загрузить'}
              </button>
              <button onClick={exportFullReport} disabled={data.length === 0 || loading} style={{ ...buttonStyle, background: '#059669' }}>
                📊 Экспорт
              </button>
            </div>
          </div>

          {data.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ backgroundColor: '#F9FAFB' }}>
                    <th style={thStyle}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>MPP</span>
                        {hiddenCount > 0 && (
                          <button
                            onClick={showAllRows}
                            title="Показать все скрытые строки"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#60A5FA',
                              cursor: 'pointer',
                              fontSize: 12,
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <span>👁️</span> {hiddenCount}
                          </button>
                        )}
                      </div>
                    </th>
                    <th style={thStyle}>Модель</th>
                    <th style={thStyle}>Кол-во авто</th>
                    <th style={thStyle}>Кол-во дефектов</th>
                    <th style={thStyle}>DPU per 1000</th>
                    <th style={thStyle}>Доля в ремзоне, %</th>
                    <th style={thStyle}>Пост внесения</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, idx) => {
                    if (hiddenRows[row.MPP]) return null;
                    return (
                      <React.Fragment key={row.MPP}>
                        <tr style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleRow(row.MPP);
                                }}
                                title="Свернуть строку"
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#D1D5DB',
                                  cursor: 'pointer',
                                  fontSize: 14,
                                  padding: 0,
                                  lineHeight: 1,
                                  width: 18,
                                  textAlign: 'center',
                                }}
                              >
                                ▾
                              </button>
                              <span>{row.MPP}</span>
                            </div>
                          </td>
                          <td style={{ ...tdStyle, fontSize: '10px' }}>{row.MODEL}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>{row.VIN_COUNT}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>{row.DEFECT_COUNT}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>{row.DPU}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>{row.REMZONE_PERCENT || '0.00'}</td>
                          <td style={tdStyle}>{row.POST_NAME}</td>
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <button
                                onClick={() => openTrend(row)}
                                title="Динамика дефекта"
                                style={{ ...buttonStyle, background: '#8B5CF6', padding: '4px 10px', fontSize: 12 }}
                              >
                                📈
                              </button>
                              <button onClick={() => handleToggleMpp(row)} style={{ ...buttonStyle, background: '#6B7280', padding: '4px 10px', fontSize: 12 }}>
                                {expandedMpp === row.MPP ? 'Скрыть VIN' : 'VIN'}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {expandedMpp === row.MPP && (
                          <tr>
                            <td colSpan={8} style={{ padding: 0 }}>
                              <div style={{ padding: 12, backgroundColor: '#F3F4F6', borderRadius: 8, margin: '8px 0' }}>
                                {vinLoading ? (
                                  <p>Загрузка VIN...</p>
                                ) : (
                                  <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                      <span style={{ fontWeight: 600 }}>VIN для "{row.MPP}" ({vinData.length} шт.)</span>
                                      <button onClick={exportVins} style={{ ...buttonStyle, background: '#059669', padding: '4px 10px', fontSize: 12 }}>📊 Экспорт VIN</button>
                                    </div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                      <thead>
                                        <tr style={{ backgroundColor: '#E5E7EB' }}>
                                          <th style={thStyle}>VIN</th>
                                          <th style={thStyle}>Модель</th>
                                          <th style={thStyle}>В ремзоне</th>
                                          <th style={thStyle}>Время дефекта</th>
                                          <th style={thStyle}>Зашёл</th>
                                          <th style={thStyle}>Вышел</th>
                                          <th style={thStyle}>Время в ремзоне</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {vinData.map((v, i) => (
                                          <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                                            <td style={tdStyle}>{v.VIN}</td>
                                            <td style={tdStyle}>{v.MODEL}</td>
                                            <td style={{ ...tdStyle, textAlign: 'center', color: v.IN_REMZONE ? '#DC2626' : '#059669', fontWeight: 600 }}>
                                              {v.IN_REMZONE ? 'Да' : 'Нет'}
                                            </td>
                                            <td style={tdStyle}>{v.DEFECT_TIME || '—'}</td>
                                            <td style={tdStyle}>{v.REM_IN || '—'}</td>
                                            <td style={tdStyle}>{v.REM_OUT || '—'}</td>
                                            <td style={tdStyle}>{v.REM_DURATION || '—'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'analytics' && (
        <div style={cardStyle}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1F2937', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ background: '#EEF2FF', padding: '4px 12px', borderRadius: 6, color: '#2563EB', fontSize: 16 }}>📈</span>
            Аналитика по DRR
          </h2>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, whiteSpace: 'nowrap' }}>
              Начало:
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, whiteSpace: 'nowrap' }}>
              Конец:
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, whiteSpace: 'nowrap' }}>
              Чекпоинты:
              <MultiSelect
                options={['ALL', ...availableCheckpoints]}
                selected={selectedCheckpoints}
                onChange={setSelectedCheckpoints}
                placeholder="Все"
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, whiteSpace: 'nowrap' }}>
              Модели:
              <MultiSelect
                options={['ALL', ...availableModels]}
                selected={selectedModels}
                onChange={setSelectedModels}
                placeholder="Все"
              />
            </label>
            
            <div style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap', flexShrink: 0 }}>
              <button onClick={loadAnalytics} disabled={analyticsLoading} style={buttonStyle}>
                {analyticsLoading ? '⏳ Загрузка...' : '▶ Загрузить аналитику'}
              </button>
            </div>
          </div>

          {analyticsError && <p style={{ color: '#DC2626' }}>❌ {analyticsError}</p>}

          {analyticsData.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 16, marginBottom: 30 }}>
                <div style={{
                  backgroundColor: '#FFFFFF', borderRadius: 16, padding: '24px',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.08)', borderLeft: '4px solid #3B82F6',
                  textAlign: 'center', transition: 'transform 0.2s',
                }}>
                  <div style={{ fontSize: 15, color: '#6B7280', marginBottom: 10 }}>Всего авто</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: '#1F2937' }}>{analyticsSummary.totalVins}</div>
                </div>
                <div style={{
                  backgroundColor: '#FFFFFF', borderRadius: 16, padding: '24px',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.08)', borderLeft: '4px solid #10B981',
                  textAlign: 'center', transition: 'transform 0.2s',
                }}>
                  <div style={{ fontSize: 15, color: '#6B7280', marginBottom: 10 }}>Авто в ремзоне</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: '#1F2937' }}>{analyticsSummary.totalRemVins}</div>
                </div>
                <div style={{
                  backgroundColor: '#FFFFFF', borderRadius: 16, padding: '24px',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.08)', borderLeft: '4px solid #F59E0B',
                  textAlign: 'center', transition: 'transform 0.2s',
                }}>
                  <div style={{ fontSize: 15, color: '#6B7280', marginBottom: 10 }}>Общее время в ремзоне</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: '#1F2937' }}>
                    {formatHours(analyticsData.reduce((sum, d) => sum + d.TOTAL_HOURS, 0))} ч
                  </div>
                  <div style={{ fontSize: 14, color: '#6B7280', marginTop: 4 }}>
                    ({(analyticsData.reduce((sum, d) => sum + d.TOTAL_HOURS, 0) / 24).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} дн)
                  </div>
                </div>
              </div>

              <div style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, boxShadow: '0 4px 12px rgba(0,0,0,0.04)', marginBottom: 30 }}>
                <h3 style={{ fontWeight: 600, color: '#1F2937', marginBottom: 20 }}>Суммарное время в ремзоне по дефектам</h3>
                <ResponsiveContainer width="100%" height={800}>
                  <BarChart data={[...analyticsData].sort((a, b) => b.TOTAL_HOURS - a.TOTAL_HOURS)} layout="vertical" margin={{ top: 20, right: 60, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F5" />
                    <XAxis type="number" tickFormatter={formatHours} />
                    <YAxis type="category" dataKey="MPP" tick={{ fontSize: 8 }} width={450} interval={0} />
                    <Tooltip formatter={formatHours} />
                    <Bar dataKey="TOTAL_HOURS" fill="#3B82F6" barSize={48} radius={[0, 8, 8, 0]}>
                      <LabelList dataKey="TOTAL_HOURS" position="right" formatter={formatHours} style={{ fill: '#1F2937', fontSize: 13 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{ display: 'flex', gap: 20, marginBottom: 30, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 300, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, boxShadow: '0 4px 12px rgba(0,0,0,0.04)' }}>
                  <h3 style={{ fontWeight: 600, color: '#1F2937', marginBottom: 20 }}>Доля времени по дефектам</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={analyticsData.slice(0, 10)}
                          dataKey="TOTAL_HOURS"
                          nameKey="MPP"
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          label={({ MPP, percent }) => `${(percent * 100).toFixed(1)}%`}
                          labelLine={{ stroke: '#9CA3AF', strokeWidth: 1 }}
                        >
                          {analyticsData.slice(0, 10).map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={formatHours} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px 16px', marginTop: 16 }}>
                      {analyticsData.slice(0, 10).map((d, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151' }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS[i % COLORS.length], display: 'inline-block' }} />
                          {truncate(d.MPP, 20)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ flex: 1, minWidth: 300, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, boxShadow: '0 4px 12px rgba(0,0,0,0.04)' }}>
                  <h3 style={{ fontWeight: 600, color: '#1F2937', marginBottom: 20 }}>Доля времени по моделям</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={modelData}
                          dataKey="hours"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          label={({ name, percent }) => `${(percent * 100).toFixed(1)}%`}
                          labelLine={{ stroke: '#9CA3AF', strokeWidth: 1 }}
                        >
                          {modelData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={formatHours} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px 16px', marginTop: 16 }}>
                      {modelData.map((d, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151' }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS[i % COLORS.length], display: 'inline-block' }} />
                          {d.name}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, boxShadow: '0 4px 12px rgba(0,0,0,0.04)' }}>
                <h3 style={{ fontWeight: 600, color: '#1F2937', marginBottom: 20 }}>Детализация</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ backgroundColor: '#F9FAFB' }}>
                      <th style={thStyle}>MPP</th>
                      <th style={thStyle}>Часы</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...analyticsData].sort((a, b) => b.TOTAL_HOURS - a.TOTAL_HOURS).slice(0, 20).map((row, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                        <td style={tdStyle}>{row.MPP}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatHours(row.TOTAL_HOURS)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {trendModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }} onClick={() => setTrendModalOpen(false)}>
          <div style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 16,
            padding: 24,
            width: '96%',
            maxWidth: 1600,
            maxHeight: '95vh',
            overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1F2937' }}>
                Динамика дефекта: {trendMpp}
              </h3>
              <button
                onClick={() => setTrendModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#6B7280' }}
              >
                ✕
              </button>
            </div>
            {/* Переключатель метрики */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <button
                onClick={() => setTrendMetric('defects')}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                  background: trendMetric === 'defects' ? '#2563EB' : '#E5E7EB',
                  color: trendMetric === 'defects' ? '#FFFFFF' : '#374151',
                }}
              >
                Шт. дефектов
              </button>
              <button
                onClick={() => setTrendMetric('dpu')}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                  background: trendMetric === 'dpu' ? '#2563EB' : '#E5E7EB',
                  color: trendMetric === 'dpu' ? '#FFFFFF' : '#374151',
                }}
              >
                DPU per 1000
              </button>
            </div>

            {trendLoading ? (
              <p>Загрузка...</p>
            ) : (
              trendData && (
                <div style={{ display: 'flex', flexDirection: 'row', gap: 20, flexWrap: 'nowrap' }}>
                  {/* Месяцы */}
                  <div style={{ flex: '1 1 0', minWidth: 250 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px' }}>Последние 3 месяца</h4>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={prepareDisplayData(trendData.month)} margin={{ top: 30, right: 10, left: 0, bottom: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis 
                          dataKey="period" 
                          tick={{ fontSize: 12, fill: '#1F2937' }} 
                          tickFormatter={(val) => {
                            const [y, m] = val.split('-');
                            const monthNames = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
                            return monthNames[parseInt(m,10)-1];
                          }}
                        />
                        <YAxis tick={{ fontSize: 12, fill: '#1F2937' }} allowDecimals={false} />
                        <Bar dataKey="value" fill="#3B82F6" radius={[4,4,0,0]}>
                          <LabelList dataKey="value" position="top" style={{ fontSize: 14, fill: '#1F2937', fontWeight: 700 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Недели */}
                  <div style={{ flex: '1 1 0', minWidth: 250 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px' }}>Последние 4 недели</h4>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={prepareDisplayData(trendData.week)} margin={{ top: 30, right: 10, left: 0, bottom: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis 
                          dataKey="period" 
                          tick={{ fontSize: 12, fill: '#1F2937' }} 
                          tickFormatter={(val) => val.split('-W')[1] ? `W${val.split('-W')[1]}` : val}
                        />
                        <YAxis tick={{ fontSize: 12, fill: '#1F2937' }} allowDecimals={false} />
                        <Bar dataKey="value" fill="#F59E0B" radius={[4,4,0,0]}>
                          <LabelList dataKey="value" position="top" style={{ fontSize: 14, fill: '#1F2937', fontWeight: 700 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Дни */}
                  <div style={{ flex: '2 1 0', minWidth: 350 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px' }}>Последние 14 дней</h4>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={prepareDisplayData(trendData.day)} margin={{ top: 30, right: 10, left: 0, bottom: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis 
                          dataKey="period" 
                          interval={0} 
                          tick={{ fontSize: 11, fill: '#1F2937' }} 
                          tickFormatter={(val) => {
                            const [, m, d] = val.split('-');
                            return `${d}.${m}`;
                          }}
                        />
                        <YAxis tick={{ fontSize: 12, fill: '#1F2937' }} allowDecimals={false} />
                        <Bar dataKey="value" fill="#10B981" radius={[4,4,0,0]}>
                          <LabelList dataKey="value" position="top" style={{ fontSize: 13, fill: '#1F2937', fontWeight: 700 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  padding: '12px 10px',
  textAlign: 'left',
  fontWeight: 600,
  color: '#374151',
  borderBottom: '2px solid #E5E7EB',
  background: '#F9FAFB',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '10px',
  borderBottom: '1px solid #F0F0F5',
  color: '#1F2937',
};