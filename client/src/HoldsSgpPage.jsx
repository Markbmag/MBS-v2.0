import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList
} from 'recharts';

const API_BASE = '';

// ====== СТИЛИ ======
const containerStyle = { padding: 30, fontFamily: 'Inter, Segoe UI, Arial, sans-serif', maxWidth: 1400, margin: '0 auto', background: '#FFFFFF', minHeight: 'calc(100vh - 60px)', boxSizing: 'border-box' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 };
const titleStyle = { fontSize: 26, fontWeight: 800, color: '#111827', margin: 0 };
const headerButtonsStyle = { display: 'flex', gap: 12, alignItems: 'center' };
const buttonStyle = { padding: '8px 20px', borderRadius: 8, border: 'none', background: '#2563EB', color: 'white', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 6px rgba(37,99,235,0.3)', transition: 'background 0.2s, transform 0.1s' };
const refreshButtonStyle = { ...buttonStyle, background: '#10B981', boxShadow: '0 2px 6px rgba(16,185,129,0.3)' };
const exportButtonStyle = { ...buttonStyle, background: '#8B5CF6', boxShadow: '0 2px 6px rgba(139,92,246,0.3)' };
const tabStyle = (active) => ({ padding: '10px 28px', borderRadius: 10, border: 'none', fontWeight: 600, fontSize: 15, background: active ? '#2563EB' : '#F3F4F6', color: active ? '#FFFFFF' : '#6B7280', cursor: 'pointer', boxShadow: active ? '0 4px 12px rgba(37,99,235,0.25)' : 'none', transition: 'all 0.2s' });
const subTabStyle = (active) => ({ padding: '8px 18px', borderRadius: 8, border: active ? '1px solid #2563EB' : '1px solid #E5E7EB', fontWeight: 600, fontSize: 13, background: active ? '#EEF2FF' : '#FFFFFF', color: active ? '#1E40AF' : '#6B7280', cursor: 'pointer', transition: 'all 0.2s' });
const cardStyle = { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.04)', border: '1px solid #F0F0F5', marginBottom: 20, overflow: 'hidden' };
const filterContainerStyle = { display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20, padding: 16, backgroundColor: '#F9FAFB', borderRadius: 12, border: '1px solid #E5E7EB' };
const filterCheckboxStyle = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer', padding: '4px 12px', borderRadius: 6, backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', transition: 'all 0.2s' };
const tableWrapperStyle = { maxHeight: 'calc(100vh - 300px)', overflowY: 'auto', borderRadius: 8, position: 'relative' };
const thStyle = { padding: '10px 10px', textAlign: 'left', fontWeight: 700, color: '#374151', borderBottom: '2px solid #E5E7EB', background: '#F9FAFB', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 10, fontSize: 12 };
const tdStyle = { padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #F3F4F6', color: '#1F2937', fontSize: 13 };
const statusBadgeStyle = { padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, display: 'inline-block', backgroundColor: '#FEF3C7', color: '#92400E', whiteSpace: 'nowrap' };
const loadingStyle = { textAlign: 'center', color: '#6B7280', fontSize: 16, padding: 40 };
const lastUpdateStyle = { fontSize: 12, color: '#6B7280', fontWeight: 500 };

// ====== УТИЛИТЫ ======
const formatDate = (dateStr) => { if (!dateStr) return ''; const d = new Date(dateStr); if (isNaN(d.getTime())) return dateStr; return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };
const formatShortDate = (dateStr) => { if (!dateStr) return ''; const d = new Date(dateStr); if (isNaN(d.getTime())) return dateStr; return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`; };
const getPlannedDate = () => { const now = new Date(); now.setDate(now.getDate() + 3); return now; };
const aggregateReason = (desc) => {
  if (!desc) return '';
  let text = desc.trim();
  const suffixMatch = text.match(/\s*-?\s*(по\s+(?:запросу|письму|обращению|звонку|указанию|просьбе)).*$/i);
  if (suffixMatch && suffixMatch.index > 0) text = text.substring(0, suffixMatch.index).trim();
  else if (suffixMatch && suffixMatch.index === 0) {
    const dateExtract = text.match(/^по\s+(?:запросу|письму|обращению|звонку|указанию|просьбе)\s+.*?\d{2}\.\d{2}\.\d{2,4}(?:\s*\(\d{2}:\d{2}\))?\s+(.+)$/i);
    if (dateExtract) text = dateExtract[1].trim();
  }
  return text.replace(/[-\s]+$/, '').trim().replace(/\s+/g, ' ') || desc.trim();
};
const pluralize = (n, one, few, many) => { const mod10 = n % 10; const mod100 = n % 100; if (mod10 === 1 && mod100 !== 11) return one; if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few; return many; };
const formatVinsGroup = (vins, viewType) => {
  if (!vins || !vins.length) return 'нет';
  const groups = {};
  vins.forEach(v => {
    const reason = viewType === 'aggregated' ? aggregateReason(v.issue_desc) : v.issue_desc;
    const key = `${v.model}_|_${reason}`;
    if (!groups[key]) groups[key] = { model: v.model, reason, count: 0, vins: new Set() };
    groups[key].vins.add(v.vin);
  });
  return Object.values(groups).map(g => `${g.vins.size} ${g.model} (${g.reason})`).join(', ');
};

// ====== КАСКАДНАЯ ДИАГРАММА ======
const DailyChangeChart = ({ dates, values, baseline }) => {
  const width = 1000;
  const height = 380;
  const padding = { top: 40, right: 30, bottom: 50, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = [];
  let acc = baseline;
  values.forEach((v) => { points.push({ start: acc, end: acc + v, delta: v }); acc += v; });

  const allValues = [baseline, 60];
  points.forEach((p) => allValues.push(p.start, p.end));
  const maxVal = Math.max(...allValues, 1);
  const minVal = Math.min(...allValues, 0);
  const range = Math.max(maxVal - minVal, 1);

  const yScale = (v) => padding.top + chartHeight - ((v - minVal) / range) * chartHeight;
  const slotWidth = chartWidth / Math.max(points.length + 1, 1);
  const barWidth = slotWidth * 0.55;
  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  
  const startX = padding.left + (slotWidth - barWidth) / 2 + barWidth / 2;
  const startY = yScale(baseline);
  const lastPoint = points[points.length - 1];
  const endX = padding.left + points.length * slotWidth + (slotWidth - barWidth) / 2 + barWidth / 2;
  const endY = lastPoint ? yScale(lastPoint.end) : startY;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Сетка */}
      {gridLines.map((r, i) => {
        const y = padding.top + chartHeight * r;
        const val = Math.round(maxVal - (maxVal - minVal) * r);
        return (
          <g key={i}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#F3F4F6" strokeWidth="1" />
            <text x={padding.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#9CA3AF">{val}</text>
          </g>
        );
      })}

      <line x1={padding.left} y1={yScale(60)} x2={width - padding.right} y2={yScale(60)} stroke="#FCA5A5" strokeDasharray="4,4" strokeWidth="1.5" />
      <text x={width - padding.right + 5} y={yScale(60) + 4} textAnchor="start" fontSize="10" fontWeight="700" fill="#EF4444">60</text>

      {/* Стартовая плашка */}
      <line x1={startX - barWidth / 2} y1={startY} x2={startX + barWidth / 2} y2={startY} stroke="#111827" strokeWidth="4" strokeLinecap="round" />
      <text x={startX} y={startY - 8} textAnchor="middle" fontSize="11" fontWeight="800" fill="#111827">{baseline}</text>

      {/* Линия тренда */}
      {points.length > 0 && <line x1={startX} y1={startY} x2={endX} y2={endY} stroke="#60A5FA" strokeWidth="2" opacity={0.6} />}

      {/* Соединители */}
      {points.slice(0, -1).map((p, i) => {
        const x1 = padding.left + (i + 1) * slotWidth + (slotWidth + barWidth) / 2;
        const x2 = padding.left + (i + 2) * slotWidth + (slotWidth - barWidth) / 2;
        return <line key={`c-${i}`} x1={x1} y1={yScale(p.end)} x2={x2} y2={yScale(p.end)} stroke="#D1D5DB" strokeDasharray="3,3" strokeWidth="1" />;
      })}

      {/* Столбцы и последняя плашка */}
      {points.map((p, i) => {
        const x = padding.left + (i + 1) * slotWidth + (slotWidth - barWidth) / 2;
        const y1 = yScale(p.start);
        const y2 = yScale(p.end);
        const top = Math.min(y1, y2);
        const barH = Math.max(Math.abs(y2 - y1), 2);
        const isLast = i === points.length - 1;
        const isZero = p.delta === 0;
        const color = p.delta > 0 ? '#F87171' : p.delta < 0 ? '#34D399' : '#E5E7EB';

        // Если это последний день и изменений нет, рисуем ТОЛЬКО черную плашку
        if (isLast && isZero) {
          return (
            <g key={i}>
              <line x1={x} y1={y2} x2={x + barWidth} y2={y2} stroke="#111827" strokeWidth="4" strokeLinecap="round" />
              <text x={x + barWidth / 2} y={y2 - 8} textAnchor="middle" fontSize="11" fontWeight="800" fill="#111827">{p.end}</text>
              <text x={x + barWidth / 2} y={height - padding.bottom + 16} textAnchor="middle" fontSize="10" fill="#9CA3AF">{formatShortDate(dates[i])}</text>
            </g>
          );
        }

        // В остальных случаях рисуем цветной столбец
        return (
          <g key={i}>
            <rect x={x} y={top} width={barWidth} height={barH} fill={color} rx={3} />
            <text x={x + barWidth / 2} y={top - 16} textAnchor="middle" fontSize="11" fontWeight="500" fill="#6B7280">{p.end}</text>
            {p.delta !== 0 && (
              <text x={x + barWidth / 2} y={p.delta > 0 ? top + barH + 14 : top - 4} textAnchor="middle" fontSize="10" fontWeight="700" fill={p.delta > 0 ? '#DC2626' : '#059669'}>
                {p.delta > 0 ? `+${p.delta}` : p.delta}
              </text>
            )}
            <text x={x + barWidth / 2} y={height - padding.bottom + 16} textAnchor="middle" fontSize="10" fill="#9CA3AF">{formatShortDate(dates[i])}</text>
          </g>
        );
      })}
    </svg>
  );
};

// ====== ОСНОВНОЙ КОМПОНЕНТ ======
export default function HoldsSgpPage() {
  const [activeTab, setActiveTab] = useState('analytics');

  // Отчет
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModelFilter, setShowModelFilter] = useState(false);
  const [selectedModels, setSelectedModels] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [reportView, setReportView] = useState('batch');

  // Аналитика
  const [retroData, setRetroData] = useState([]);
  const [uniqueVinsByDate, setUniqueVinsByDate] = useState({});
  const [retroLoading, setRetroLoading] = useState(false);
  const [showRetroModelFilter, setShowRetroModelFilter] = useState(false);
  const [selectedRetroModels, setSelectedRetroModels] = useState([]);
  const [retroDates, setRetroDates] = useState([]);
  const [analyticsView, setAnalyticsView] = useState('aggregated'); 
  
  // Стейты для фильтров и графиков
  const [chartPeriod, setChartPeriod] = useState('all');
  const [chartCount, setChartCount] = useState(3);
  const [chartFromDate, setChartFromDate] = useState('');
  const [chartToDate, setChartToDate] = useState('');
  const [chartModel, setChartModel] = useState('ALL');
  const [trendsData, setTrendsData] = useState({ months: [], weeks: [], days: [], data: [] });

  const [showChart, setShowChart] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryData, setSummaryData] = useState(null);
  const [summaryError, setSummaryError] = useState(null);

  // Модалка VIN
  const [showVinModal, setShowVinModal] = useState(false);
  const [vinModalTitle, setVinModalTitle] = useState('');
  const [vinList, setVinList] = useState([]);
  const [vinLoading, setVinLoading] = useState(false);

  const allModels = useMemo(() => {
    const models = [...new Set(rawData.map(d => d.model))].filter(Boolean);
    return models.sort();
  }, [rawData]);

  useEffect(() => {
    if (allModels.length > 0 && selectedModels.length === 0) setSelectedModels(allModels);
  }, [allModels]);

  const generateDates = () => {
    const dates = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    return dates;
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/holds-sgp`);
      if (!res.ok) throw new Error('Ошибка загрузки данных');
      const json = await res.json();
      setRawData(json);
      setError(null);
      setLastUpdate(new Date());
    } catch (err) {
      setError('Нет данных');
    } finally {
      setLoading(false);
    }
  };

  const loadTrends = async () => {
    try {
      const params = new URLSearchParams({ period: chartPeriod });
      if (chartPeriod !== 'all') {
        if (chartCount) params.append('count', chartCount);
        if (chartFromDate && chartToDate) {
          params.append('fromDate', chartFromDate);
          params.append('toDate', chartToDate);
        }
      }
      if (chartModel !== 'ALL') params.append('model', chartModel);

      const res = await fetch(`${API_BASE}/api/holds-sgp-history?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setTrendsData(prev => ({ ...prev, ...json }));
      }
    } catch (err) {
      console.warn('Ошибка загрузки графиков истории:', err);
    }
  };

  const loadRetrospective = async () => {
    setRetroLoading(true);
    setSummaryLoading(true);
    setSummaryData(null);
    setSummaryError(null);

    try {
      const dates = generateDates();
      setRetroDates(dates);

      const params = new URLSearchParams();
      if (selectedRetroModels.length > 0 && selectedRetroModels.length < allModels.length) params.append('models', selectedRetroModels.join(','));

      const res = await fetch(`${API_BASE}/api/holds-sgp-retrospective?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки');
      const json = await res.json();

      if (Array.isArray(json)) { setRetroData(json); setUniqueVinsByDate({}); }
      else { setRetroData(json.rows || []); setUniqueVinsByDate(json.uniqueVinsByDate || {}); }

      const lastDate = dates[dates.length - 1];
      const prevDate = dates[dates.length - 2];
      
      const todayParams = new URLSearchParams(params.toString());
      todayParams.set('date', lastDate);
      const yesterdayParams = new URLSearchParams(params.toString());
      yesterdayParams.set('date', prevDate);

      const [todayRes, yesterdayRes] = await Promise.all([
        fetch(`${API_BASE}/api/holds-sgp-retrospective-all-vins?${todayParams.toString()}`),
        fetch(`${API_BASE}/api/holds-sgp-retrospective-all-vins?${yesterdayParams.toString()}`)
      ]);

      if (!todayRes.ok || !yesterdayRes.ok) throw new Error(`Ошибка API (сегодня: ${todayRes.status}, вчера: ${yesterdayRes.status}). Проверьте сервер.`);

      const todayVins = await todayRes.json();
      const yesterdayVins = await yesterdayRes.json();

      if (!Array.isArray(todayVins) || !Array.isArray(yesterdayVins)) throw new Error('Неверный формат данных от эндпоинта all-vins');

      const todayMap = new Map(todayVins.map(v => [v.vin, v]));
      const yesterdayMap = new Map(yesterdayVins.map(v => [v.vin, v]));

      const addedVins = []; const removedVins = [];
      todayMap.forEach((v, vin) => { if (!yesterdayMap.has(vin)) addedVins.push(v); });
      yesterdayMap.forEach((v, vin) => { if (!todayMap.has(vin)) removedVins.push(v); });

      setSummaryData({ addedVins, removedVins, currentCount: todayMap.size, change: todayMap.size - yesterdayMap.size, prevDate });
    } catch (err) {
      setSummaryError(err.message);
      if (err.message.includes('ретроспективы')) { setRetroData([]); setUniqueVinsByDate({}); }
    } finally {
      setRetroLoading(false);
      setSummaryLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { if (activeTab === 'analytics') { loadRetrospective(); } }, [activeTab]);
  useEffect(() => { if (activeTab === 'analytics') { loadTrends(); } }, [chartPeriod, chartCount, chartFromDate, chartToDate, chartModel, activeTab]);

  // ====== ИСПРАВЛЕННАЯ ФУНКЦИЯ ЗАГРУЗКИ VIN ======
  const handleVinClick = async (model, label, date, opts = {}) => {
    const { reason } = opts;
    setVinLoading(true);
    setShowVinModal(true);
    setVinModalTitle(`${model} - ${label} (${formatShortDate(date)})`);

    try {
      const params = new URLSearchParams({ model: String(model).trim(), date });
      
      if (reason) {
        const rReason = reason.trim();
        // Ищем точные совпадения с учетом пробелов
        const matchingDescs = [
          ...new Set(
            retroData
              .filter(r => String(r.model).trim() === String(model).trim() && aggregateReason(r.issue_desc).trim() === rReason)
              .map(r => r.issue_desc)
          )
        ];
        
        if (matchingDescs.length > 0) {
          params.set('issue_descs', JSON.stringify(matchingDescs));
        } else {
          // Страховка: если массив пуст, передаем саму причину для поиска по LIKE на бэке
          params.set('reason', rReason);
        }
      } else {
        params.set('issue_desc', label);
      }

      const res = await fetch(`${API_BASE}/api/holds-sgp-retrospective-vins?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки VIN');
      setVinList(await res.json());
    } catch (err) {
      setVinList([]);
    } finally {
      setVinLoading(false);
    }
  };

  const filteredData = useMemo(() => {
    const filtered = selectedModels.length === 0 ? rawData : rawData.filter(d => selectedModels.includes(d.model));
    const plannedDate = getPlannedDate();
    return filtered.map(d => ({ ...d, planned_date: plannedDate })).sort((a, b) => b.quantity - a.quantity);
  }, [rawData, selectedModels]);

  const filteredDataAggregated = useMemo(() => {
    const map = new Map();
    filteredData.forEach((row) => {
      const reason = aggregateReason(row.issue_desc);
      const key = `${row.model}_|_${reason}`;
      if (!map.has(key)) map.set(key, { model: row.model, issue_desc: reason, quantity: 0, hold_date: row.hold_date, days_waiting: row.days_waiting, responsible: '', planned_date: row.planned_date, status: row.status || 'В процессе' });
      const item = map.get(key);
      item.quantity += row.quantity || 0;
      if (row.hold_date) {
        const cur = item.hold_date ? new Date(item.hold_date) : null;
        if (!cur || new Date(row.hold_date) < cur) item.hold_date = row.hold_date;
      }
    });
    const arr = Array.from(map.values());
    arr.forEach(item => { if (item.hold_date) item.days_waiting = Math.max(0, Math.floor((Date.now() - new Date(item.hold_date).getTime()) / (1000 * 60 * 60 * 24))); });
    return arr.sort((a, b) => b.quantity - a.quantity);
  }, [filteredData]);

  const retroDataAggregated = useMemo(() => {
    if (!retroData.length || !retroDates.length) return [];
    const map = new Map();
    retroData.forEach((row) => {
      const reason = aggregateReason(row.issue_desc);
      const key = `${row.model}_|_${reason}`;
      if (!map.has(key)) map.set(key, { model: row.model, issue_desc: reason });
      const item = map.get(key);
      retroDates.forEach(date => { if (row[date]) item[date] = (item[date] || 0) + row[date]; });
    });
    const arr = Array.from(map.values());
    const lastDate = retroDates[retroDates.length - 1];
    return arr.sort((a, b) => (b[lastDate] || 0) - (a[lastDate] || 0));
  }, [retroData, retroDates]);

  const dailyChange = useMemo(() => {
    if (!retroDates.length || !Object.keys(uniqueVinsByDate).length) return {};
    const first = new Date(retroDates[0]); first.setDate(first.getDate() - 1);
    const beforeKey = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(first.getDate()).padStart(2, '0')}`;
    const result = {}; let prev = uniqueVinsByDate[beforeKey] || 0;
    retroDates.forEach(date => { const cur = uniqueVinsByDate[date] || 0; result[date] = cur - prev; prev = cur; });
    return result;
  }, [retroDates, uniqueVinsByDate]);

  const baselineUniqueVins = useMemo(() => {
    if (!retroDates.length || !Object.keys(uniqueVinsByDate).length) return 0;
    const first = new Date(retroDates[0]); first.setDate(first.getDate() - 1);
    return uniqueVinsByDate[`${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(first.getDate()).padStart(2, '0')}`] || 0;
  }, [retroDates, uniqueVinsByDate]);

  const daysDataToRender = (trendsData.days && trendsData.days.length > 0) 
    ? trendsData.days 
    : retroDates.map(date => ({ label: formatShortDate(date), count: uniqueVinsByDate[date] || 0 }));

  const handleModelToggle = (model) => setSelectedModels(prev => prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]);
  const handleSelectAll = () => setSelectedModels(selectedModels.length === allModels.length ? [] : allModels);
  const handleRetroModelToggle = (model) => setSelectedRetroModels(prev => prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]);

  const handlePeriodChange = (newPeriod) => {
    setChartPeriod(newPeriod);
    if (newPeriod === 'all') { setChartFromDate(''); setChartToDate(''); setChartCount(3); }
    else { const defaults = { year: 2, month: 3, week: 4, day: 14 }; setChartCount(defaults[newPeriod] || 3); }
  };

  const handleExport = async () => {
    const data = reportView === 'batch' ? filteredData : filteredDataAggregated;
    const exportData = data.map(d => ({
      'Модель': d.model, 'Описание': d.issue_desc, 'Количество': d.quantity, 'Дата постановки на Холд': formatDate(d.hold_date),
      'Дней ожидания': d.days_waiting, 'Ответственный': '', 'Действия': '', 'Плановая дата': formatDate(d.planned_date),
      'Статус': d.status || 'В процессе', 'Комментарий': '',
    }));
    const totalQuantity = data.reduce((sum, d) => sum + (d.quantity || 0), 0);
    exportData.push({ 'Модель': 'Общий итог', 'Описание': '', 'Количество': totalQuantity, 'Дата постановки на Холд': '', 'Дней ожидания': '', 'Ответственный': '', 'Действия': '', 'Плановая дата': '', 'Статус': '', 'Комментарий': '' });
    
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, reportView === 'batch' ? 'Холды по батчам' : 'Агрегированные холды');
    ws['!cols'] = [{ wch: 20 }, { wch: 70 }, { wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 22 }];

    try {
      const params = new URLSearchParams();
      if (selectedModels.length > 0 && selectedModels.length < allModels.length) params.set('models', selectedModels.join(','));
      const res = await fetch(`${API_BASE}/api/holds-sgp-all-vins?${params.toString()}`);
      if (res.ok) {
        const allVins = await res.json();
        const vinsSheetData = allVins.map(r => ({ 'VIN': r.vin, 'Модель': r.model, 'Причина холда': r.issue_desc, 'Статус': r.status || 'В процессе', 'Дата постановки': formatDate(r.hold_date), 'Ответственный': r.responsible || '' }));
        const ws2 = XLSX.utils.json_to_sheet(vinsSheetData);
        ws2['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 70 }, { wch: 14 }, { wch: 18 }, { wch: 16 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'VIN список');
      }
    } catch (err) { console.error('Ошибка выгрузки VIN списка:', err); }

    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][now.getMonth()]}`;
    XLSX.writeFile(wb, reportView === 'batch' ? `Holds SGP (по батчам)_${dateStr}.xlsx` : `Compound Quality Holds_${dateStr}.xlsx`);
  };

  const handleExportRetrospective = async () => {
    const data = analyticsView === 'batch' ? retroData : retroDataAggregated;
    if (!data.length || !retroDates.length) return;
    const exportData = [];
    const reasonsRow = { 'Модель': 'К-во причин холдов', 'Описание': '' };
    retroDates.forEach(date => { reasonsRow[formatShortDate(date)] = data.reduce((sum, row) => sum + (row[date] || 0), 0) || ''; });
    exportData.push(reasonsRow);

    const carsRow = { 'Модель': 'К-во захолдированных машин', 'Описание': '' };
    retroDates.forEach(date => { carsRow[formatShortDate(date)] = uniqueVinsByDate[date] || ''; });
    exportData.push(carsRow);

    const deltaRow = { 'Модель': 'Изменение к прошлому дню, шт.', 'Описание': '' };
    retroDates.forEach(date => { deltaRow[formatShortDate(date)] = dailyChange[date] || 0; });
    exportData.push(deltaRow);

    data.forEach(row => {
      const dataRow = { 'Модель': row.model, 'Описание': row.issue_desc };
      retroDates.forEach(date => { dataRow[formatShortDate(date)] = row[date] || ''; });
      exportData.push(dataRow);
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, analyticsView === 'batch' ? 'Ретроспектива' : 'Агрегированная ретроспектива');
    ws['!cols'] = [{ wch: 28 }, { wch: 60 }, ...retroDates.map(() => ({ wch: 8 }))];

    try {
      const lastDate = retroDates[retroDates.length - 1];
      const params = new URLSearchParams({ date: lastDate });
      if (selectedRetroModels.length > 0 && selectedRetroModels.length < allModels.length) params.set('models', selectedRetroModels.join(','));
      const res = await fetch(`${API_BASE}/api/holds-sgp-retrospective-all-vins?${params.toString()}`);
      if (res.ok) {
        const vins = await res.json();
        const vinsSheetData = vins.map((r, i) => ({
          '№': i + 1, 'VIN': r.vin, 'Модель': r.model,
          'Причина холда': analyticsView === 'aggregated' ? aggregateReason(r.issue_desc) : r.issue_desc,
          'Текущее расположение': r.location || '',
        }));
        const finalVinsData = analyticsView === 'aggregated' ? Object.values(vinsSheetData.reduce((acc, row) => { const key = `${row['VIN']}_|_${row['Модель']}_|_${row['Причина холда']}`; if (!acc[key]) acc[key] = { ...row }; return acc; }, {})).map((row, i) => ({ ...row, '№': i + 1 })) : vinsSheetData;
        const ws2 = XLSX.utils.json_to_sheet(finalVinsData);
        ws2['!cols'] = [{ wch: 6 }, { wch: 22 }, { wch: 14 }, { wch: 60 }, { wch: 24 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'VIN и причины холдов');
      }
    } catch (err) { console.error('Ошибка выгрузки VIN во второй лист:', err); }

    const now = new Date();
    XLSX.writeFile(wb, `Ретроспектива_холдов_${analyticsView === 'batch' ? 'batches' : 'aggregated'}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.xlsx`);
  };

  const currentReportData = reportView === 'batch' ? filteredData : filteredDataAggregated;
  const totalQuantity = currentReportData.reduce((sum, d) => sum + (d.quantity || 0), 0);
  const currentRetroData = analyticsView === 'batch' ? retroData : retroDataAggregated;

  if (loading && rawData.length === 0) return <div style={containerStyle}><div style={loadingStyle}>Загрузка данных...</div></div>;

  const footerCellStyle = { ...tdStyle, fontWeight: 800, fontSize: 10, whiteSpace: 'nowrap' };

  const renderTrendChart = (title, data, color) => (
    <div style={{ backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, border: '1px solid #E5E7EB', boxShadow: '0 2px 6px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 12, textAlign: 'center' }}>{title}</h3>
      {data && data.length > 0 ? (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} height={28} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: '#F9FAFB' }} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
            <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} barSize={20}>
              <LabelList dataKey="count" position="top" style={{ fontSize: 10, fontWeight: 700, fill: '#374151' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: 13 }}>Нет данных</div>
      )}
    </div>
  );

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>🚗 Holds СГП</h1>
        <div style={headerButtonsStyle}>
          {lastUpdate && <span style={lastUpdateStyle}>Обновлено: {lastUpdate.toLocaleTimeString('ru-RU')}</span>}
          <button style={refreshButtonStyle} onClick={fetchData} disabled={loading}>{loading ? '⏳ Загрузка...' : '🔄 Обновить'}</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <button onClick={() => setActiveTab('report')} style={tabStyle(activeTab === 'report')}>Отчет</button>
        <button onClick={() => setActiveTab('analytics')} style={tabStyle(activeTab === 'analytics')}>Аналитика</button>
      </div>

      {activeTab === 'report' && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <button style={{ ...buttonStyle, background: showModelFilter ? '#1E40AF' : '#2563EB' }} onClick={() => setShowModelFilter(!showModelFilter)}>
              {showModelFilter ? 'Скрыть фильтр' : '🔍 Модели'}
            </button>
            <button style={exportButtonStyle} onClick={handleExport}>📥 Экспорт</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <button onClick={() => setReportView('batch')} style={subTabStyle(reportView === 'batch')}>Холды по батчам</button>
            <button onClick={() => setReportView('aggregated')} style={subTabStyle(reportView === 'aggregated')}>Агрегированные причины холдов</button>
          </div>

          {showModelFilter && (
            <div style={filterContainerStyle}>
              <label style={{ ...filterCheckboxStyle, backgroundColor: '#EEF2FF', border: '1px solid #2563EB' }}>
                <input type="checkbox" checked={selectedModels.length === allModels.length} onChange={handleSelectAll} /> Все модели
              </label>
              {allModels.map(model => (
                <label key={model} style={{ ...filterCheckboxStyle, backgroundColor: selectedModels.includes(model) ? '#EEF2FF' : '#FFFFFF', border: selectedModels.includes(model) ? '1px solid #2563EB' : '1px solid #E5E7EB' }}>
                  <input type="checkbox" checked={selectedModels.includes(model)} onChange={() => handleModelToggle(model)} /> {model}
                </label>
              ))}
            </div>
          )}

          <div style={cardStyle}>
            <div style={tableWrapperStyle}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: '15%' }}>Модель</th>
                    <th style={{ ...thStyle, width: '32%' }}>Описание</th>
                    <th style={{ ...thStyle, width: '7%', textAlign: 'center' }}>Кол-во</th>
                    <th style={{ ...thStyle, width: '12%' }}>Дата постановки</th>
                    <th style={{ ...thStyle, width: '7%', textAlign: 'center' }}>Дней</th>
                    <th style={{ ...thStyle, width: '12%' }}>Ответственный</th>
                    <th style={{ ...thStyle, width: '12%' }}>Плановая дата</th>
                    <th style={{ ...thStyle, width: '10%' }}>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {currentReportData.map((row, idx) => (
                    <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                      <td style={{ ...tdStyle, fontWeight: 700, fontSize: 12 }}>{row.model}</td>
                      <td style={{ ...tdStyle, fontSize: 12, lineHeight: '1.4' }}>{row.issue_desc}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>{row.quantity}</td>
                      <td style={{ ...tdStyle, fontSize: 12 }}>{formatDate(row.hold_date)}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700, color: row.days_waiting > 30 ? '#DC2626' : row.days_waiting > 14 ? '#F59E0B' : '#10B981' }}>{row.days_waiting}</td>
                      <td style={{ ...tdStyle, fontSize: 12 }}></td>
                      <td style={{ ...tdStyle, fontSize: 12 }}>{formatDate(row.planned_date)}</td>
                      <td style={tdStyle}><span style={statusBadgeStyle}>{row.status || 'В процессе'}</span></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ backgroundColor: '#F9FAFB', fontWeight: 800, borderTop: '2px solid #E5E7EB' }}>
                    <td style={{ ...tdStyle, fontWeight: 800 }}>Общий итог</td>
                    <td style={tdStyle}></td>
                    <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 800 }}>{totalQuantity}</td>
                    <td style={tdStyle}></td>
                    <td style={tdStyle}></td>
                    <td style={tdStyle}></td>
                    <td style={tdStyle}></td>
                    <td style={tdStyle}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === 'analytics' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <button onClick={() => setAnalyticsView('batch')} style={subTabStyle(analyticsView === 'batch')}>Холды по батчам</button>
            <button onClick={() => setAnalyticsView('aggregated')} style={subTabStyle(analyticsView === 'aggregated')}>Агрегированные причины холдов</button>
          </div>

          <div style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.04)', border: '1px solid #F0F0F5' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#4B5563' }}>Период:</span>
                <button onClick={() => handlePeriodChange('all')} style={tabStyle(chartPeriod === 'all')}>Все</button>
                <button onClick={() => handlePeriodChange('year')} style={tabStyle(chartPeriod === 'year')}>Год</button>
                <button onClick={() => handlePeriodChange('month')} style={tabStyle(chartPeriod === 'month')}>Месяц</button>
                <button onClick={() => handlePeriodChange('week')} style={tabStyle(chartPeriod === 'week')}>Неделя</button>
                <button onClick={() => handlePeriodChange('day')} style={tabStyle(chartPeriod === 'day')}>День</button>
              </div>
              
              {chartPeriod !== 'all' && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563' }}>
                    Кол-во: <input type="number" min="1" max="50" value={chartCount} onChange={(e) => setChartCount(parseInt(e.target.value, 10) || 1)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D1D5DB', width: 80 }} />
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#4B5563' }}>От:</span>
                    <input type="date" value={chartFromDate} onChange={(e) => setChartFromDate(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D1D5DB' }} />
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#4B5563' }}>По:</span>
                    <input type="date" value={chartToDate} onChange={(e) => setChartToDate(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D1D5DB' }} />
                  </div>
                </>
              )}

              <label style={{ fontSize: 14, color: '#4B5563', display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                Модель:
                <select value={chartModel} onChange={e => setChartModel(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D1D5DB' }}>
                  <option value="ALL">Все</option>
                  {allModels.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            </div>
          </div>

          {chartPeriod === 'all' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 2.3fr)', gap: 16, marginBottom: 20, alignItems: 'start' }}>
              {renderTrendChart('📅 3 месяца', trendsData.months, '#60A5FA')}
              {renderTrendChart('📆 4 недели', trendsData.weeks, '#34D399')}
              {renderTrendChart('📊 14 дней', daysDataToRender, '#FBBF24')}
            </div>
          ) : (
            <div style={{ marginBottom: 20 }}>
              {renderTrendChart(`📊 Выбранный период (${chartPeriod === 'year' ? 'Год' : chartPeriod === 'month' ? 'Месяц' : chartPeriod === 'week' ? 'Неделя' : 'День'})`, trendsData.data, '#FBBF24')}
            </div>
          )}

          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1F2937', margin: 0 }}>📈 Ретроспектива причин холдов (14 дней)</h2>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <button style={exportButtonStyle} onClick={handleExportRetrospective}>📥 Экспорт таблицы</button>
                <button style={{ ...buttonStyle, background: showRetroModelFilter ? '#1E40AF' : '#2563EB' }} onClick={() => setShowRetroModelFilter(!showRetroModelFilter)}>
                  {showRetroModelFilter ? 'Скрыть фильтр' : '🔍 Модели'}
                </button>
                <button style={refreshButtonStyle} onClick={loadRetrospective} disabled={retroLoading}>
                  {retroLoading ? '⏳ Загрузка...' : '🔄 Обновить'}
                </button>
              </div>
            </div>

            {showRetroModelFilter && (
              <div style={filterContainerStyle}>
                {allModels.map(model => (
                  <label key={model} style={{ ...filterCheckboxStyle, backgroundColor: selectedRetroModels.includes(model) ? '#EEF2FF' : '#FFFFFF', border: selectedRetroModels.includes(model) ? '1px solid #2563EB' : '1px solid #E5E7EB' }}>
                    <input type="checkbox" checked={selectedRetroModels.includes(model)} onChange={() => handleRetroModelToggle(model)} /> {model}
                  </label>
                ))}
              </div>
            )}

            {!retroLoading && currentRetroData.length > 0 && retroDates.length > 0 ? (
              <>
                <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 400px)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, width: '12%', fontSize: 10, position: 'sticky', top: 0, zIndex: 30 }}>Модель</th>
                        <th style={{ ...thStyle, width: '25%', fontSize: 10, position: 'sticky', top: 0, zIndex: 30 }}>Описание</th>
                        {retroDates.map(date => (
                          <th key={date} style={{ ...thStyle, textAlign: 'center', width: '4.5%', fontSize: 9, padding: '6px 2px', position: 'sticky', top: 0, zIndex: 30 }}>
                            {formatShortDate(date)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {currentRetroData.map((row, idx) => (
                        <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                          <td style={{ ...tdStyle, fontWeight: 700, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.model}</td>
                          <td style={{ ...tdStyle, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.issue_desc}>{row.issue_desc}</td>
                          {retroDates.map(date => {
                            const val = row[date];
                            return (
                              <td
                                key={date}
                                style={{
                                  ...tdStyle, textAlign: 'center', fontWeight: 700, fontSize: 10, padding: '6px 2px',
                                  backgroundColor: val > 0 ? '#FEF3C7' : idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB',
                                  color: val > 0 ? '#92400E' : '#D1D5DB',
                                  cursor: val > 0 ? 'pointer' : 'default',
                                }}
                                onClick={() => {
                                  if (val > 0) {
                                    if (analyticsView === 'batch') handleVinClick(row.model, row.issue_desc, date);
                                    else handleVinClick(row.model, row.issue_desc, date, { reason: row.issue_desc });
                                  }
                                }}
                                title={val > 0 ? 'Нажмите для просмотра VIN' : ''}
                              >
                                {val || ''}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot style={{ position: 'sticky', bottom: 0, zIndex: 10, boxShadow: '0 -4px 6px -2px rgba(0,0,0,0.05)' }}>
                      <tr>
                        <td style={{ ...footerCellStyle, backgroundColor: '#F9FAFB', borderTop: '2px solid #E5E7EB', borderBottom: 'none' }}>К-во причин холдов</td>
                        <td style={{ ...tdStyle, backgroundColor: '#F9FAFB', borderTop: '2px solid #E5E7EB', borderBottom: 'none' }} />
                        {retroDates.map(date => {
                          const daySum = currentRetroData.reduce((sum, row) => sum + (row[date] || 0), 0);
                          return <td key={date} style={{ ...footerCellStyle, backgroundColor: '#F9FAFB', borderTop: '2px solid #E5E7EB', borderBottom: 'none', textAlign: 'center' }}>{daySum > 0 ? daySum : ''}</td>;
                        })}
                      </tr>
                      <tr>
                        <td style={{ ...footerCellStyle, backgroundColor: '#EFF6FF', borderBottom: 'none' }}>К-во захолдированных машин</td>
                        <td style={{ ...tdStyle, backgroundColor: '#EFF6FF', borderBottom: 'none' }} />
                        {retroDates.map(date => <td key={date} style={{ ...footerCellStyle, backgroundColor: '#EFF6FF', borderBottom: 'none', textAlign: 'center', color: '#1D4ED8' }}>{uniqueVinsByDate[date] || ''}</td>)}
                      </tr>
                      <tr>
                        <td style={{ ...footerCellStyle, backgroundColor: '#FFFFFF', borderBottom: 'none' }}>Изменение к прошлому дню, шт.</td>
                        <td style={{ ...tdStyle, backgroundColor: '#FFFFFF', borderBottom: 'none' }} />
                        {retroDates.map(date => {
                          const v = dailyChange[date] || 0;
                          return <td key={date} style={{ ...footerCellStyle, backgroundColor: '#FFFFFF', borderBottom: 'none', textAlign: 'center', color: v > 0 ? '#EF4444' : v < 0 ? '#10B981' : '#6B7280' }}>{v > 0 ? `+${v}` : v}</td>;
                        })}
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #E5E7EB' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1F2937', margin: 0 }}>
                      📊 Изменение количества захолдированных машин по дням <span style={{ fontSize: 12, fontWeight: 500, color: '#6B7280', marginLeft: 12 }}>(красный — рост, зелёный — снижение)</span>
                    </h3>
                    <button onClick={() => setShowChart(!showChart)} style={{ ...buttonStyle, background: '#9CA3AF', padding: '6px 12px', fontSize: 12 }}>
                      {showChart ? 'Скрыть график' : 'Показать график'}
                    </button>
                  </div>
                  {showChart && <DailyChangeChart dates={retroDates} values={retroDates.map(d => dailyChange[d] || 0)} baseline={baselineUniqueVins} />}
                </div>

                <div style={{ marginTop: 24, padding: 20, backgroundColor: '#F9FAFB', borderRadius: 12, border: '1px solid #E5E7EB', fontSize: 14, lineHeight: 1.6, color: '#1F2937' }}>
                  {summaryLoading ? (
                    <div style={{ color: '#6B7280', fontStyle: 'italic' }}>Формирование отчета...</div>
                  ) : summaryError ? (
                    <div style={{ color: '#DC2626', fontSize: 13, fontWeight: 500 }}>⚠️ {summaryError}</div>
                  ) : summaryData ? (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Отчет по заблокированным автомобилям на СГП, состояние на {new Date().toLocaleTimeString('ru-RU')}.</div>
                      <ul style={{ paddingLeft: 20, margin: 0 }}>
                        <li>Количество авто на hold – <span style={{ fontWeight: 700 }}>{summaryData.currentCount}</span> {pluralize(summaryData.currentCount, 'шт', 'шт', 'шт')}.</li>
                        <li>
                          Изменения по сравнению с <span style={{ fontWeight: 600 }}>{formatDate(summaryData.prevDate)}</span>:
                          <ul style={{ paddingLeft: 20, marginTop: 6, marginBottom: 6 }}>
                            <li>
                              Количество заблокированных автомобилей {summaryData.change > 0 ? <span style={{ color: '#EF4444', fontWeight: 700 }}>увеличилось</span> : summaryData.change < 0 ? <span style={{ color: '#10B981', fontWeight: 700 }}>уменьшилось</span> : 'не изменилось'}{' '}
                              {summaryData.change !== 0 && <>на <span style={{ fontWeight: 700 }}>{Math.abs(summaryData.change)}</span> {pluralize(Math.abs(summaryData.change), 'шт', 'шт', 'шт')}</>}
                            </li>
                            <li>Добавлено на холд <span style={{ fontWeight: 700 }}>{summaryData.addedVins.length}</span> авто: {formatVinsGroup(summaryData.addedVins, analyticsView)}</li>
                            <li>Снято с холда <span style={{ fontWeight: 700 }}>{summaryData.removedVins.length}</span> авто: {formatVinsGroup(summaryData.removedVins, analyticsView)}</li>
                          </ul>
                        </li>
                      </ul>
                    </>
                  ) : (
                    <div style={{ color: '#6B7280', fontStyle: 'italic' }}>Нет данных для формирования отчета.</div>
                  )}
                </div>
              </>
            ) : (
              !retroLoading && <p style={{ color: '#6B7280', textAlign: 'center', padding: 40 }}>Нажмите «Обновить» для загрузки данных</p>
            )}
          </div>

          <div style={cardStyle}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1F2937', marginBottom: 20 }}>📊 Холды по моделям</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
              {allModels.map(modelFilter => {
                const source = analyticsView === 'batch' ? filteredData : filteredDataAggregated;
                const filtered = source.filter(d => d.model === modelFilter).sort((a, b) => b.quantity - a.quantity);
                if (filtered.length === 0) return null;
                const totalCount = filtered.reduce((sum, d) => sum + (d.quantity || 0), 0);

                return (
                  <div key={modelFilter} style={{ backgroundColor: '#FAFBFC', borderRadius: 12, padding: 16, border: '1px solid #E5E7EB', boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 700, color: '#1F2937', borderBottom: '2px solid #2563EB', paddingBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ background: '#2563EB', color: 'white', borderRadius: 8, padding: '2px 12px', fontSize: 14 }}>{modelFilter}</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: '#2563EB' }}>{totalCount}</span>
                    </h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ backgroundColor: '#F3F4F6' }}>
                          <th style={{ padding: '6px', textAlign: 'left', borderBottom: '2px solid #D1D5DB', fontWeight: 600 }}>Описание</th>
                          <th style={{ padding: '6px', textAlign: 'center', borderBottom: '2px solid #D1D5DB', fontWeight: 600 }}>Кол-во</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((row, idx) => (
                          <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                            <td style={{ padding: '6px', borderBottom: '1px solid #E5E7EB' }}>{row.issue_desc}</td>
                            <td style={{ padding: '6px', textAlign: 'center', borderBottom: '1px solid #E5E7EB', fontWeight: 700 }}>{row.quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {showVinModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, maxWidth: 600, width: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1F2937' }}>VIN номера</h3>
              <button onClick={() => setShowVinModal(false)} style={{ border: 'none', background: 'none', fontSize: 24, cursor: 'pointer', color: '#6B7280', padding: '0 4px' }}>×</button>
            </div>
            <div style={{ fontSize: 14, color: '#4B5563', marginBottom: 16, wordBreak: 'break-word' }}>{vinModalTitle}</div>
            {vinLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Загрузка VIN...</div>
            ) : vinList.length > 0 ? (
              <div style={{ overflowY: 'auto', flex: 1 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, textAlign: 'center' }}>№</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>VIN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vinList.map((vin, idx) => (
                      <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                        <td style={{ ...tdStyle, textAlign: 'center', width: 50 }}>{idx + 1}</td>
                        <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600, letterSpacing: '0.5px' }}>{vin}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Нет данных</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}