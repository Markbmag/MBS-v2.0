import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx'; 
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, LabelList, ComposedChart, Line, Tooltip, Legend
} from 'recharts';

const API_BASE = '';

const reppsTypeBgColors = { year: '#F3E8FF', month: '#E0F2FE', week: '#CCFBF1', day: '#FEF3C7' };
const SHIFT_A_COLOR = '#F59E0B';
const SHIFT_B_COLOR = '#10B981';

const modelShortNames = { 
  'ESTEO MX': 'MX', 'JELAND J6': 'J6', 'JELAND J7': 'J7', 'TENET A8': 'A8', 'JELAND J8': 'J8', 'total': 'Total' 
};
const H_CHART_2 = 260;

// Анимация загрузки
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

const cardStyle = { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, marginBottom: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.04)', border: '1px solid #F0F0F5' };
const sectionCardStyle = { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, boxShadow: '0 4px 12px rgba(0,0,0,0.04)', border: '1px solid #F0F0F5', display: 'flex', flexDirection: 'column', minWidth: 0 };
const tabStyle = (active, color = '#7C3AED') => ({ padding: '10px 28px', borderRadius: 10, border: 'none', fontWeight: 600, fontSize: 15, background: active ? color : '#F3F4F6', color: active ? '#FFFFFF' : '#6B7280', cursor: 'pointer', boxShadow: active ? `0 4px 12px ${color}40` : 'none', transition: 'all 0.2s' });
const inputStyle = { padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, background: '#F9FAFB', outline: 'none' };

const thStyle = { textAlign: 'center', fontWeight: 600, color: '#374151', borderBottom: '2px solid #E5E7EB', background: '#F9FAFB', whiteSpace: 'nowrap', padding: '5px 4px', fontSize: '10px' };
const tdStyle = { textAlign: 'center', borderBottom: '1px solid #F0F0F5', color: '#1F2937', whiteSpace: 'nowrap', padding: '3px 4px', fontSize: '11px', transition: 'background-color 0.2s' };

const sectionTitleStyle = { fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 10px 0', paddingBottom: 6, borderBottom: '2px solid #E5E7EB', height: 26, boxSizing: 'border-box' };
const reportHeaderStyle = { fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 14px 0', paddingBottom: 10, borderBottom: '2px solid #E5E7EB' };
const tableHeaderStyle = { fontSize: 12, fontWeight: 700, color: '#374151', margin: '10px 0 6px 0' };
const tableWrapStyle = { marginTop: 4, border: '1px solid #E5E7EB', borderRadius: 6, overflow: 'hidden' };
const dashDividerStyle = { borderTop: '2px dashed #CBD5E1', marginTop: 12, marginBottom: 8 };
const modalThStyle = { padding: '10px 12px', textAlign: 'left', background: '#F9FAFB', borderBottom: '2px solid #E5E7EB', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' };
const modalTdStyle = { padding: '8px 12px', borderBottom: '1px solid #F0F0F5', verticalAlign: 'top', whiteSpace: 'normal', wordBreak: 'break-word' };

const shortenLabel = (label, type) => {
  if (type === 'month') { const [m, y] = label.split(' '); return y ? `${m}'${y.slice(2)}` : m; }
  if (type === 'week') return label.split(' ')[0];
  return label;
};

const formatDateTime = (str) => {
  if (!str) return '—';
  try { return new Date(str).toLocaleString('ru-RU'); } catch { return String(str); }
};

export default function RepelecReportPage() {
  const [activeTab, setActiveTab] = useState('repelec'); // 'repelec' | 'bms'

  // ================= REPELEC СОСТОЯНИЯ =================
  const [period, setPeriod] = useState('all');
  const [count, setCount] = useState(3);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedModel, setSelectedModel] = useState('ALL');
  const [dataPoints, setDataPoints] = useState([]);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalVins, setModalVins] = useState([]);
  const [modalMeta, setModalMeta] = useState({ label: '', shift: '', model: '' });
  const [activeModalTab, setActiveModalTab] = useState('bms');
  const [notesState, setNotesState] = useState({});
  const [savingNotes, setSavingNotes] = useState(false);
  const saveTimeoutRef = useRef(null);

  // ================= BMS СОСТОЯНИЯ =================
  const [bmsPeriod, setBmsPeriod] = useState('week');
  const [bmsChartData, setBmsChartData] = useState({ general: [], models: {} });
  const [bmsLoading, setBmsLoading] = useState(false);
  
  // Даты для нижних таблиц (Реестр и Топ)
  const [bmsTableDateFrom, setBmsTableDateFrom] = useState('');
  const [bmsTableDateTo, setBmsTableDateTo] = useState('');

  const [bmsNokVins, setBmsNokVins] = useState([]);
  const [bmsNokLoading, setBmsNokLoading] = useState(false);
  const [bmsTopErrors, setBmsTopErrors] = useState([]);
  const [bmsNotesState, setBmsNotesState] = useState({});
  const bmsSaveTimeoutRef = useRef(null);

  // Фильтры для таблицы BMS NOK
  const [searchVin, setSearchVin] = useState('');
  const [filterModule, setFilterModule] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 20;

  const availableModels = ['ALL', 'ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];
  const modelKeys = ['ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];

  // Инициализация дат для нижних таблиц (по умолчанию 7 дней)
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    setBmsTableDateFrom(weekAgo);
    setBmsTableDateTo(today);
  }, []);

  useEffect(() => {
    if (modalOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [modalOpen]);

  // ================= REPELEC ЛОГИКА =================
  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    if (newPeriod === 'all') { setFromDate(''); setToDate(''); }
    else { const defaults = { year: 2, month: 3, week: 4, day: 14 }; setCount(defaults[newPeriod] || 3); }
  };

  useEffect(() => {
    if (activeTab !== 'repelec') return;
    setLoading(true);
    const params = new URLSearchParams({ period });
    if (period !== 'all' && count) params.append('count', count);
    if (period !== 'all' && fromDate && toDate) { params.append('fromDate', fromDate); params.append('toDate', toDate); }
    fetch(`${API_BASE}/api/repelec-report?${params.toString()}`)
      .then(res => res.json())
      .then(json => { setDataPoints(json.dataPoints || []); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  }, [period, count, fromDate, toDate, activeTab]);

  const chartData = useMemo(() => dataPoints.map(p => ({ ...p })), [dataPoints]);
  const groupedByType = useMemo(() => {
    if (period !== 'all') return null;
    return { months: chartData.filter(p => p.type === 'month'), weeks: chartData.filter(p => p.type === 'week'), days: chartData.filter(p => p.type === 'day') };
  }, [chartData, period]);

  const stackKeyA = selectedModel === 'ALL' ? 'shiftA' : `${selectedModel}_A`;
  const stackKeyB = selectedModel === 'ALL' ? 'shiftB' : `${selectedModel}_B`;

  const openVinsModal = (startDate, endDate, shift, model, label) => {
    setModalOpen(true);
    setModalLoading(true);
    setActiveModalTab('bms');
    setModalVins([]);
    setNotesState({});
    setModalMeta({ label, shift, model });

    const params = new URLSearchParams({ dateFrom: startDate, dateTo: endDate, shift });
    if (model && model !== 'ALL') params.append('model', model);

    fetch(`${API_BASE}/api/repelec-vins?${params.toString()}`)
      .then(res => res.json())
      .then(json => { 
        setModalVins(json || []); 
        const initialNotes = {};
        (json || []).forEach(v => {
          (v.bms_defects || []).forEach(b => {
            const key = `${v.vin}|${b.test_station}|${b.module_name}|${b.fault_content}`;
            if (b.note) initialNotes[key] = b.note;
          });
        });
        setNotesState(initialNotes);
        setModalLoading(false); 
      })
      .catch(() => { setModalVins([]); setModalLoading(false); });
  };

  const saveSingleNote = async (vin, bms, text) => {
    try {
      await fetch(`${API_BASE}/api/repelec-bms-notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vin, test_station: bms.test_station, module_name: bms.module_name, fault_content: bms.fault_content, note: text })
      });
    } catch (err) { console.error('Ошибка сохранения заметки', err); }
  };

  const saveAllNotes = async () => {
    setSavingNotes(true);
    try {
      const promises = Object.entries(notesState).map(([key, text]) => {
        const [vin, test_station, module_name, fault_content] = key.split('|');
        return fetch(`${API_BASE}/api/repelec-bms-notes`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vin, test_station, module_name, fault_content, note: text })
        });
      });
      await Promise.all(promises);
      alert('✅ Все заметки успешно сохранены!');
    } catch (err) { alert('❌ Ошибка при сохранении заметок'); } finally { setSavingNotes(false); }
  };

  const handleNoteChange = (vin, bms, text) => {
    const noteKey = `${vin}|${bms.test_station}|${bms.module_name}|${bms.fault_content}`;
    setNotesState(prev => ({ ...prev, [noteKey]: text }));
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => { saveSingleNote(vin, bms, text); }, 1000);
  };

  const closeModal = async () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (Object.keys(notesState).length > 0) {
       const promises = Object.entries(notesState).map(([key, text]) => {
        const [vin, test_station, module_name, fault_content] = key.split('|');
        return fetch(`${API_BASE}/api/repelec-bms-notes`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vin, test_station, module_name, fault_content, note: text })
        }).catch(() => {}); 
      });
      Promise.all(promises); 
    }
    setModalOpen(false); setModalVins([]); 
  };

  const exportErrorsToExcel = () => {
    const exportData = [];
    if (activeModalTab === 'bms') {
      modalVins.forEach(item => {
        const bmsList = item.bms_defects || [];
        if (bmsList.length === 0) {
          exportData.push({ 'VIN': item.vin, 'Модель': item.model, 'Время REPELEC': formatDateTime(item.repelec_time), 'Время CP72': formatDateTime(item.cp72_time), 'Станция BMS': '—', 'Модуль BMS': '—', 'Результат BMS': '—', 'Описание ошибки BMS': '—', 'Заметка': '—' });
        } else {
          bmsList.forEach(b => {
            const key = `${item.vin}|${b.test_station}|${b.module_name}|${b.fault_content}`;
            exportData.push({ 'VIN': item.vin, 'Модель': item.model, 'Время REPELEC': formatDateTime(item.repelec_time), 'Время CP72': formatDateTime(item.cp72_time), 'Станция BMS': b.test_station, 'Модуль BMS': b.module_name, 'Результат BMS': b.result, 'Описание ошибки BMS': b.fault_content, 'Заметка': notesState[key] || '' });
          });
        }
      });
    } else {
      modalVins.forEach(item => {
        const iotList = item.iot_defects || [];
        if (iotList.length === 0) {
          exportData.push({ 'VIN': item.vin, 'Модель': item.model, 'Время REPELEC': formatDateTime(item.repelec_time), 'Время CP72': formatDateTime(item.cp72_time), 'Пост': '—', 'Деталь': '—', 'Дефект': '—', 'Описание': '—', 'Комментарий': '—' });
        } else {
          iotList.forEach(i => {
            exportData.push({ 'VIN': item.vin, 'Модель': item.model, 'Время REPELEC': formatDateTime(item.repelec_time), 'Время CP72': formatDateTime(item.cp72_time), 'Пост': i.post, 'Деталь': i.part_name, 'Дефект': i.problem_type, 'Описание': i.description, 'Комментарий': i.comment });
          });
        }
      });
    }
    if (exportData.length === 0) return alert('Нет данных для экспорта');
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, activeModalTab === 'bms' ? 'Ошибки BMS' : 'Дефекты IoT');
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `REPELEC_${activeModalTab.toUpperCase()}_${dateStr}.xlsx`);
  };

  // ================= BMS ЛОГИКА =================
  useEffect(() => {
    if (activeTab !== 'bms') return;
    
    // Загрузка графиков
    setBmsLoading(true);
    const params = new URLSearchParams({ period: bmsPeriod, count: 7 });
    fetch(`${API_BASE}/api/bms-dynamics-chart?${params.toString()}`)
      .then(res => res.json())
      .then(json => { 
        if (json.error) throw new Error(json.error);
        setBmsChartData({ general: Array.isArray(json.general) ? json.general : [], models: json.models || {} }); 
        setBmsLoading(false); 
      })
      .catch(err => { setBmsChartData({ general: [], models: {} }); setBmsLoading(false); });

    // Загрузка нижних таблиц (используют bmsTableDateFrom / To)
    if (!bmsTableDateFrom || !bmsTableDateTo) return;

    setBmsNokLoading(true);
    const nokParams = new URLSearchParams({ dateFrom: `${bmsTableDateFrom} 00:00:00`, dateTo: `${bmsTableDateTo} 23:59:59`, model: 'ALL' });
    fetch(`${API_BASE}/api/bms-cp7-nok-vins?${nokParams.toString()}`)
      .then(res => res.json())
      .then(json => { 
        if (!Array.isArray(json)) { setBmsNokVins([]); return; }
        setBmsNokVins(json); 
        const initialNotes = {};
        json.forEach(v => {
          const key = `${v.vin}|${v.test_station}|${v.module_name}|${v.fault_content}`;
          if (v.note) initialNotes[key] = v.note;
        });
        setBmsNotesState(initialNotes);
        setCurrentPage(1);
      })
      .catch(() => setBmsNokVins([]))
      .finally(() => setBmsNokLoading(false));

    fetch(`${API_BASE}/api/bms-top-errors?dateFrom=${bmsTableDateFrom} 00:00:00&dateTo=${bmsTableDateTo} 23:59:59`)
      .then(res => res.json())
      .then(json => setBmsTopErrors(Array.isArray(json) ? json : []))
      .catch(err => { setBmsTopErrors([]); });

  }, [activeTab, bmsPeriod, bmsTableDateFrom, bmsTableDateTo]);

  const handleBmsNoteChange = (vin, r, text) => {
    const key = `${vin}|${r.test_station}|${r.module_name}|${r.fault_content}`;
    setBmsNotesState(prev => ({ ...prev, [key]: text }));
    if (bmsSaveTimeoutRef.current) clearTimeout(bmsSaveTimeoutRef.current);
    bmsSaveTimeoutRef.current = setTimeout(() => {
      fetch(`${API_BASE}/api/repelec-bms-notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vin, test_station: r.test_station, module_name: r.module_name, fault_content: r.fault_content, note: text })
      }).catch(() => {});
    }, 1000);
  };

  const saveBmsNotes = async () => {
    setSavingNotes(true);
    try {
      const promises = Object.entries(bmsNotesState).map(([key, text]) => {
        const [vin, test_station, module_name, fault_content] = key.split('|');
        return fetch(`${API_BASE}/api/repelec-bms-notes`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vin, test_station, module_name, fault_content, note: text })
        });
      });
      await Promise.all(promises);
      alert('✅ Все заметки сохранены!');
    } catch (err) { alert('❌ Ошибка при сохранении'); } finally { setSavingNotes(false); }
  };

  const exportBmsNokToExcel = () => {
    const exportData = filteredNokVins.map(v => {
      const key = `${v.vin}|${v.test_station}|${v.module_name}|${v.fault_content}`;
      return { 'VIN': v.vin, 'Модель': v.model, 'Время': formatDateTime(v.created_at), 'Станция': v.test_station, 'Модуль': v.module_name, 'Ошибка': v.fault_content, 'Заметка': bmsNotesState[key] || '' };
    });
    if (exportData.length === 0) return alert('Нет данных');
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'CP7_FLASH_NOK');
    XLSX.writeFile(wb, `BMS_NOK_${bmsTableDateFrom}_${bmsTableDateTo}.xlsx`);
  };

  // ================= ФУНКЦИИ РЕНДЕРА (REPELEC) =================
  const renderStackChart = (points) => {
    if (!points.length) return <p style={{ padding: 16, color: '#6B7280', textAlign: 'center', fontSize: 13 }}>Нет данных</p>;
    const displayData = points.map(p => {
      const aVal = Number(p[stackKeyA]) || 0;
      const bVal = Number(p[stackKeyB]) || 0;
      return { ...p, displayLabel: shortenLabel(p.label, p.type), displayTotal: aVal + bVal, [stackKeyA]: aVal > 0 ? aVal : 0.001, [stackKeyB]: bVal > 0 ? bVal : 0.001 };
    });
    return (
      <ResponsiveContainer width="100%" height={H_CHART_2}>
        <BarChart data={displayData} margin={{ top: 20, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="displayLabel" tick={{ fontSize: 10 }} interval={0} height={28} />
          <YAxis domain={[0, 'auto']} tick={{ fontSize: 10 }} allowDecimals={false} width={30} />
          <Bar dataKey={stackKeyA} stackId="s" fill={SHIFT_A_COLOR} barSize={22} />
          <Bar dataKey={stackKeyB} stackId="s" fill={SHIFT_B_COLOR} barSize={22} radius={[4, 4, 0, 0]}>
            <LabelList dataKey="displayTotal" position="top" style={{ fontSize: 10, fontWeight: 700, fill: '#111827' }} formatter={v => v > 0.001 ? v : ''} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  };

  const renderCategoryTable = (points) => {
    if (!points.length) return null;
    const displayLabels = points.map(p => shortenLabel(p.label, p.type));
    const rows = [ { key: stackKeyA, label: 'Смена А', color: SHIFT_A_COLOR, shiftCode: 'A' }, { key: stackKeyB, label: 'Смена B', color: SHIFT_B_COLOR, shiftCode: 'B' } ];
    return (
      <>
        <h4 style={tableHeaderStyle}>По сменам</h4>
        <div style={tableWrapStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ ...thStyle, width: 90, paddingLeft: 6, textAlign: 'left' }}>Смена</th>
                {points.map((point, idx) => (<th key={idx} style={{ ...thStyle, backgroundColor: reppsTypeBgColors[point.type] }}>{displayLabels[idx]}</th>))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key} style={{ backgroundColor: 'white' }}>
                  <td style={{ ...tdStyle, paddingLeft: 6, textAlign: 'left', color: row.color, fontWeight: 700 }}>{row.label}</td>
                  {points.map((point, idx) => {
                    const val = point[row.key];
                    return (
                      <td key={idx} style={{ ...tdStyle, cursor: 'pointer', backgroundColor: reppsTypeBgColors[point.type], fontWeight: 700, color: row.color }} onClick={() => val > 0 && openVinsModal(point.startDate, point.endDate, row.shiftCode, selectedModel, point.label)} onMouseEnter={(e) => { if (val > 0) e.currentTarget.style.backgroundColor = '#BFDBFE'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = reppsTypeBgColors[point.type]; }} title={val > 0 ? 'Клик — показать VIN' : ''}>
                        {val || 0}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr style={{ backgroundColor: '#F3F4F6', fontWeight: 700 }}>
                <td style={{ ...tdStyle, paddingLeft: 6, textAlign: 'left' }}>Всего</td>
                {points.map((point, idx) => (<td key={idx} style={{ ...tdStyle, fontWeight: 700 }}>{((Number(point[stackKeyA]) || 0) + (Number(point[stackKeyB]) || 0)) || 0}</td>))}
              </tr>
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const renderModelTable = (points) => {
    if (!points.length) return null;
    const displayLabels = points.map(p => shortenLabel(p.label, p.type));
    const modelsToShow = selectedModel === 'ALL' ? [...modelKeys, 'total'] : [selectedModel];
    return (
      <>
        <h4 style={tableHeaderStyle}>По моделям и сменам</h4>
        <div style={tableWrapStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ ...thStyle, width: 60, paddingLeft: 6, textAlign: 'left' }}>Мод.</th>
                <th style={{ ...thStyle, width: 30 }}>См.</th>
                {points.map((point, idx) => (<th key={idx} style={{ ...thStyle, backgroundColor: reppsTypeBgColors[point.type] }}>{displayLabels[idx]}</th>))}
              </tr>
            </thead>
            <tbody>
              {modelsToShow.map(modelKey => {
                const isTotal = modelKey === 'total';
                return (
                  <React.Fragment key={modelKey}>
                    <tr style={{ backgroundColor: isTotal ? '#F3F4F6' : 'white' }}>
                      <td rowSpan={2} style={{ ...tdStyle, paddingLeft: 6, textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #E5E7EB' }}>{modelShortNames[modelKey] || modelKey}</td>
                      <td style={{ ...tdStyle, color: SHIFT_A_COLOR, fontWeight: 700, borderBottom: 'none' }}>А</td>
                      {points.map((point, idx) => {
                        const val = isTotal ? point.shiftA : point[`${modelKey}_A`];
                        const modelParam = isTotal ? 'ALL' : modelKey;
                        return (
                          <td key={idx} style={{ ...tdStyle, cursor: 'pointer', color: SHIFT_A_COLOR, borderBottom: 'none', backgroundColor: reppsTypeBgColors[point.type] }} onClick={() => val > 0 && openVinsModal(point.startDate, point.endDate, 'A', modelParam, point.label)} onMouseEnter={(e) => { if (val > 0) e.currentTarget.style.backgroundColor = '#BFDBFE'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = reppsTypeBgColors[point.type]; }} title={val > 0 ? 'Клик — показать VIN' : ''}>
                            {val || 0}
                          </td>
                        );
                      })}
                    </tr>
                    <tr style={{ backgroundColor: isTotal ? '#F3F4F6' : 'white' }}>
                      <td style={{ ...tdStyle, color: SHIFT_B_COLOR, fontWeight: 700, borderTop: '1px solid #E5E7EB', borderBottom: '1px solid #E5E7EB' }}>B</td>
                      {points.map((point, idx) => {
                        const val = isTotal ? point.shiftB : point[`${modelKey}_B`];
                        const modelParam = isTotal ? 'ALL' : modelKey;
                        return (
                          <td key={idx} style={{ ...tdStyle, cursor: 'pointer', color: SHIFT_B_COLOR, borderTop: '1px solid #E5E7EB', borderBottom: '1px solid #E5E7EB', backgroundColor: reppsTypeBgColors[point.type] }} onClick={() => val > 0 && openVinsModal(point.startDate, point.endDate, 'B', modelParam, point.label)} onMouseEnter={(e) => { if (val > 0) e.currentTarget.style.backgroundColor = '#BFDBFE'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = reppsTypeBgColors[point.type]; }} title={val > 0 ? 'Клик — показать VIN' : ''}>
                            {val || 0}
                          </td>
                        );
                      })}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const renderSection = (title, points, accent) => (
    <div key={title} style={sectionCardStyle}>
      <h3 style={{ ...sectionTitleStyle, color: accent }}>{title}</h3>
      {renderStackChart(points)}
      {renderCategoryTable(points)}
      <div style={dashDividerStyle} />
      {renderModelTable(points)}
    </div>
  );

  const renderBmsComposedChart = (title, data) => {
    if (!data || !Array.isArray(data) || data.length === 0) return null;
    return (
      <div style={sectionCardStyle}>
        <h3 style={{ ...sectionTitleStyle, color: '#3B82F6' }}>{title}</h3>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            {/* ФИКС ОСИ X: Берем только первый элемент строки (W38) */}
            <XAxis 
              dataKey="label" 
              tick={{ fontSize: 11 }} 
              tickFormatter={(val) => val.split(' ')[0]} 
            />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" unit="%" tick={{ fontSize: 11 }} domain={[0, 100]} />
            <Tooltip contentStyle={{ borderRadius: 8, fontSize: 13 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="left" dataKey="machines" fill="#3B82F6" name="Машины" barSize={24} radius={[4, 4, 0, 0]}>
              <LabelList dataKey="machines" position="top" style={{ fontSize: 10, fill: '#1E3A8A' }} />
            </Bar>
            <Bar yAxisId="left" dataKey="defects" fill="#F59E0B" name="Дефекты" barSize={24} radius={[4, 4, 0, 0]}>
              <LabelList dataKey="defects" position="top" style={{ fontSize: 10, fill: '#92400E' }} />
            </Bar>
            <Line yAxisId="right" type="monotone" dataKey="percent" stroke="#EF4444" strokeWidth={2} name="% Дефектов" dot={{ r: 4 }}>
              <LabelList dataKey="percent" position="top" formatter={(v) => `${v}%`} style={{ fontSize: 10, fill: '#B91C1C', fontWeight: 700 }} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // Фильтрация и пагинация BMS NOK
  const uniqueModules = useMemo(() => {
    return ['ALL', ...Array.from(new Set(bmsNokVins.map(v => v.module_name).filter(Boolean)))].sort();
  }, [bmsNokVins]);

  const filteredNokVins = useMemo(() => {
    let result = bmsNokVins;
    if (searchVin.trim()) result = result.filter(v => v.vin.toLowerCase().includes(searchVin.trim().toLowerCase()));
    if (filterModule !== 'ALL') result = result.filter(v => v.module_name === filterModule);
    return result;
  }, [bmsNokVins, searchVin, filterModule]);

  const paginatedNokVins = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filteredNokVins.slice(start, start + rowsPerPage);
  }, [filteredNokVins, currentPage]);

  const totalPages = Math.ceil(filteredNokVins.length / rowsPerPage);

  return (
    <div style={{ padding: '20px 30px 20px 16px', fontFamily: 'Inter, Segoe UI, Arial, sans-serif', maxWidth: 1500, margin: '0 auto' }}>
      
      {/* ГЛАВНЫЕ ТАБЫ */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <button onClick={() => setActiveTab('repelec')} style={tabStyle(activeTab === 'repelec', '#7C3AED')}>REPELEC Report</button>
        <button onClick={() => setActiveTab('bms')} style={tabStyle(activeTab === 'bms', '#2563EB')}>Динамика по BMS</button>
      </div>

      {/* ================= REPELEC TAB ================= */}
      {activeTab === 'repelec' && (
        <>
          <h1 style={{ color: '#111827', fontSize: 28, fontWeight: 800, marginBottom: 20 }}>REPELEC Report</h1>
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#4B5563' }}>Период:</span>
                <button onClick={() => handlePeriodChange('all')} style={tabStyle(period === 'all')}>Все</button>
                <button onClick={() => handlePeriodChange('year')} style={tabStyle(period === 'year')}>Год</button>
                <button onClick={() => handlePeriodChange('month')} style={tabStyle(period === 'month')}>Месяц</button>
                <button onClick={() => handlePeriodChange('week')} style={tabStyle(period === 'week')}>Неделя</button>
                <button onClick={() => handlePeriodChange('day')} style={tabStyle(period === 'day')}>День</button>
              </div>
              {period !== 'all' && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563' }}>
                    Кол-во: <input type="number" min="1" max="50" value={count} onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)} style={{ ...inputStyle, width: 80 }} />
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#4B5563' }}>От:</span>
                    <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} />
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#4B5563' }}>По:</span>
                    <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputStyle} />
                  </div>
                </>
              )}
              <label style={{ fontSize: 14, color: '#4B5563', display: 'flex', alignItems: 'center', gap: 6 }}>
                Модель:
                <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} style={inputStyle}>
                  {availableModels.map(m => <option key={m} value={m}>{m === 'ALL' ? 'Все' : m}</option>)}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#4B5563', marginLeft: 'auto' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, backgroundColor: SHIFT_A_COLOR, borderRadius: 3 }} /> Смена A</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, backgroundColor: SHIFT_B_COLOR, borderRadius: 3 }} /> Смена B</span>
              </div>
            </div>
          </div>

          {loading ? (
            <div style={cardStyle}>
              <style>{loadingAnimation}</style>
              <div className="loading-dots" style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>
                <span>Загрузка данных</span>
                <span>.</span><span>.</span><span>.</span>
              </div>
            </div>
          ) : period === 'all' ? (
            <div style={cardStyle}>
              <h2 style={reportHeaderStyle}>Авто в REPELEC по сменам</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 2.3fr)', gap: 16, alignItems: 'start' }}>
                {renderSection('📅 3 месяца', groupedByType.months, '#0EA5E9')}
                {renderSection('📆 4 недели',  groupedByType.weeks,  '#14B8A6')}
                {renderSection('📊 14 дней',   groupedByType.days,   '#F59E0B')}
              </div>
            </div>
          ) : (
            <div style={cardStyle}>
              <h2 style={reportHeaderStyle}>Авто в REPELEC по сменам</h2>
              {renderStackChart(chartData)}
              {renderCategoryTable(chartData)}
              <div style={dashDividerStyle} />
              {renderModelTable(chartData)}
            </div>
          )}
        </>
      )}

      {/* ================= BMS TAB ================= */}
      {activeTab === 'bms' && (
        <>
          <h1 style={{ color: '#111827', fontSize: 28, fontWeight: 800, marginBottom: 20 }}>Динамика по BMS (CP7 / Flash)</h1>
          
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#4B5563' }}>Период графиков:</span>
              <button onClick={() => setBmsPeriod('week')} style={tabStyle(bmsPeriod === 'week', '#2563EB')}>Неделя</button>
              <button onClick={() => setBmsPeriod('month')} style={tabStyle(bmsPeriod === 'month', '#2563EB')}>Месяц</button>
            </div>
          </div>

          {bmsLoading ? (
             <div style={cardStyle}>
               <style>{loadingAnimation}</style>
               <div className="loading-dots" style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>
                 <span>Загрузка графиков</span>
                 <span>.</span><span>.</span><span>.</span>
               </div>
             </div>
          ) : !bmsChartData || bmsChartData.general.length === 0 ? (
             <div style={cardStyle}><p style={{ textAlign: 'center', padding: 40, color: '#ef4444' }}>Нет данных для отображения</p></div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>
              {renderBmsComposedChart('Все модели', bmsChartData.general)}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {modelKeys.map(m => (
                  <div key={m}>{bmsChartData.models && bmsChartData.models[m] && renderBmsComposedChart(`Модель ${m}`, bmsChartData.models[m])}</div>
                ))}
              </div>
            </div>
          )}

          {/* БЛОК ФИЛЬТРОВ ДЛЯ НИЖНИХ ТАБЛИЦ */}
          <div style={{ ...cardStyle, marginTop: 30, marginBottom: 15, padding: '15px 20px', display: 'flex', alignItems: 'center', gap: 15, background: '#F8FAFC' }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1E293B' }}>Период для таблиц ниже:</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="date" value={bmsTableDateFrom} onChange={(e) => setBmsTableDateFrom(e.target.value)} style={inputStyle} />
              <span style={{ fontSize: 14, fontWeight: 600, color: '#4B5563' }}>—</span>
              <input type="date" value={bmsTableDateTo} onChange={(e) => setBmsTableDateTo(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 20 }}>
            
            {/* РЕЕСТР NOK VIN'ОВ С ПОИСКОМ И ПАГИНАЦИЕЙ */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                <div>
                  <h2 style={{ ...reportHeaderStyle, margin: 0, border: 'none', paddingBottom: 0 }}>Реестр NOK (с заметками)</h2>
                  <span style={{ fontSize: 13, color: '#6B7280' }}>Данные за период: {bmsTableDateFrom} — {bmsTableDateTo}</span>
                </div>
                <button onClick={saveBmsNotes} disabled={savingNotes} style={{ background: '#2563EB', color: '#FFF', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: savingNotes ? 'not-allowed' : 'pointer' }}>
                  {savingNotes ? '⏳...' : '💾 Сохранить заметки'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
                <input 
                  type="text" 
                  placeholder="Поиск по VIN..." 
                  value={searchVin} 
                  onChange={e => { setSearchVin(e.target.value); setCurrentPage(1); }} 
                  style={{ ...inputStyle, flex: 1 }} 
                />
                <select 
                  value={filterModule} 
                  onChange={e => { setFilterModule(e.target.value); setCurrentPage(1); }} 
                  style={{ ...inputStyle, width: 200 }}
                >
                  {uniqueModules.map(m => <option key={m} value={m}>{m === 'ALL' ? 'Все модули' : m}</option>)}
                </select>
                <button onClick={exportBmsNokToExcel} style={{ background: '#059669', color: '#FFF', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  📊 Экспорт
                </button>
              </div>

              {bmsNokLoading ? (
                <div style={{ padding: 20 }}>
                  <style>{loadingAnimation}</style>
                  <div className="loading-dots" style={{ textAlign: 'center', color: '#6B7280' }}>
                    <span>Загрузка</span>
                    <span>.</span><span>.</span><span>.</span>
                  </div>
                </div>
              ) : filteredNokVins.length === 0 ? (
                <p style={{ textAlign: 'center', padding: 20, color: '#6B7280' }}>Ничего не найдено</p>
              ) : (
                <>
                  <div style={{ maxHeight: '600px', overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th style={{ ...modalThStyle, width: 140 }}>VIN</th>
                          <th style={{ ...modalThStyle, width: 80 }}>Модель</th>
                          <th style={{ ...modalThStyle, width: 100 }}>Модуль</th>
                          <th style={{ ...modalThStyle }}>Ошибка</th>
                          <th style={{ ...modalThStyle, width: 180 }}>Заметка</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedNokVins.map((r, idx) => {
                          const key = `${r.vin}|${r.test_station}|${r.module_name}|${r.fault_content}`;
                          return (
                            <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                              <td style={{ ...modalTdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{r.vin}</td>
                              <td style={modalTdStyle}>{r.model}</td>
                              <td style={{ ...modalTdStyle, color: '#6B21A8', fontWeight: 600 }}>{r.module_name}</td>
                              <td style={{ ...modalTdStyle, color: '#DC2626' }}>{r.fault_content}</td>
                              <td style={{ ...modalTdStyle, backgroundColor: '#FFFBEB' }}>
                                <textarea
                                  value={bmsNotesState[key] || ''}
                                  onChange={(e) => handleBmsNoteChange(r.vin, r, e.target.value)}
                                  placeholder="Заметка..."
                                  style={{ width: '100%', minHeight: 30, padding: 4, borderRadius: 4, border: '1px solid #FDE68A', fontSize: 12, resize: 'vertical', fontFamily: 'inherit' }}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  
                  {totalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 15 }}>
                      <span style={{ fontSize: 13, color: '#6B7280' }}>Найдено: {filteredNokVins.length} записей</span>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ ...inputStyle, cursor: currentPage === 1 ? 'not-allowed' : 'pointer', padding: '4px 12px' }}>← Назад</button>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{currentPage} / {totalPages}</span>
                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={{ ...inputStyle, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', padding: '4px 12px' }}>Вперёд →</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* УЛУЧШЕННЫЙ ТОП ОШИБОК */}
            <div style={cardStyle}>
              <h2 style={{ ...reportHeaderStyle, marginBottom: 15, border: 'none', paddingBottom: 0 }}>
                Топ ошибок за период: {bmsTableDateFrom} — {bmsTableDateTo}
              </h2>
              
              {bmsTopErrors.length === 0 ? (
                <p style={{ textAlign: 'center', padding: 20, color: '#6B7280' }}>Нет данных</p>
              ) : (
                <div style={{ maxHeight: '650px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ ...modalThStyle }}>Модуль / Ошибка</th>
                        <th style={{ ...modalThStyle, width: 80, textAlign: 'center' }}>Кол-во авто</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bmsTopErrors.map((e, i) => (
                        <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                          <td style={{ ...modalTdStyle, whiteSpace: 'normal' }}>
                            <div style={{ fontWeight: 700, color: '#6B21A8' }}>{e.module_name}</div>
                            <div style={{ fontSize: 12, color: '#4B5563' }}>{e.fault_content}</div>
                          </td>
                          <td style={{ ...modalTdStyle, textAlign: 'center', fontWeight: 700, color: '#DC2626' }}>{e.defect_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ================= МОДАЛЬНОЕ ОКНО REPELEC ================= */}
      {modalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '10px' }} onClick={closeModal}>
          <div style={{ backgroundColor: '#FFFFFF', borderRadius: 14, padding: 20, width: '100%', maxWidth: '98vw', maxHeight: '95vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px rgba(0,0,0,0.25)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111827' }}>
                  {modalMeta.label} · {modalMeta.shift === 'A' ? 'Смена A' : 'Смена B'}
                  {modalMeta.model !== 'ALL' && ` · ${modalMeta.model}`}
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6B7280' }}>Всего VIN: {modalVins.length}</p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {activeModalTab === 'bms' && (
                  <button onClick={saveAllNotes} disabled={savingNotes} style={{ background: '#2563EB', color: '#FFF', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: savingNotes ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: savingNotes ? 0.7 : 1 }}>
                    {savingNotes ? '⏳ Сохранение...' : '💾 Сохранить заметки'}
                  </button>
                )}
                <button onClick={exportErrorsToExcel} style={{ background: '#059669', color: '#FFF', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  📊 Экспорт в Excel
                </button>
                <button onClick={closeModal} style={{ border: 'none', background: 'none', fontSize: 24, cursor: 'pointer', color: '#6B7280', lineHeight: 1 }}>×</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, borderBottom: '2px solid #E5E7EB', marginBottom: 15 }}>
              <button onClick={() => setActiveModalTab('bms')} style={{ padding: '8px 20px', border: 'none', background: 'transparent', fontSize: 15, fontWeight: 600, color: activeModalTab === 'bms' ? '#6B21A8' : '#6B7280', borderBottom: activeModalTab === 'bms' ? '3px solid #6B21A8' : '3px solid transparent', cursor: 'pointer', transition: 'all 0.2s' }}>
                BMS
              </button>
              <button onClick={() => setActiveModalTab('iot')} style={{ padding: '8px 20px', border: 'none', background: 'transparent', fontSize: 15, fontWeight: 600, color: activeModalTab === 'iot' ? '#2563EB' : '#6B7280', borderBottom: activeModalTab === 'iot' ? '3px solid #2563EB' : '3px solid transparent', cursor: 'pointer', transition: 'all 0.2s' }}>
                IoT и Заметки
              </button>
            </div>

            {modalLoading ? (
              <div style={{ padding: 40 }}>
                <style>{loadingAnimation}</style>
                <div className="loading-dots" style={{ textAlign: 'center', color: '#6B7280' }}>
                  <span>Загрузка</span>
                  <span>.</span><span>.</span><span>.</span>
                </div>
              </div>
            ) : modalVins.length === 0 ? (
              <p style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Нет данных</p>
            ) : (
              <div style={{ overflowY: 'auto', flex: 1, border: '1px solid #E5E7EB', borderRadius: 8 }}>
                {activeModalTab === 'bms' ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'auto' }}>
                    <thead>
                      <tr>
                        <th style={{ ...modalThStyle, width: 150 }}>VIN</th>
                        <th style={{ ...modalThStyle, width: 90 }}>Модель</th>
                        <th style={{ ...modalThStyle, width: 120 }}>Время REPELEC</th>
                        <th style={{ ...modalThStyle, width: 120 }}>Время CP72</th>
                        <th style={{ ...modalThStyle, background: '#F3E8FF', color: '#6B21A8', width: 100 }}>Станция</th>
                        <th style={{ ...modalThStyle, background: '#F3E8FF', color: '#6B21A8', width: 120 }}>Модуль</th>
                        <th style={{ ...modalThStyle, background: '#F3E8FF', color: '#6B21A8', width: 80 }}>Результат</th>
                        <th style={{ ...modalThStyle, background: '#F3E8FF', color: '#6B21A8', width: 250 }}>Описание ошибки</th>
                        <th style={{ ...modalThStyle, background: '#FEF3C7', color: '#92400E', width: 250 }}>Заметка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modalVins.map((item, idx) => {
                        const bmsList = item.bms_defects || [];
                        const rowCount = Math.max(bmsList.length, 1);
                        return Array.from({ length: rowCount }).map((_, i) => {
                          const bms = bmsList[i];
                          const noteKey = bms ? `${item.vin}|${bms.test_station}|${bms.module_name}|${bms.fault_content}` : '';
                          return (
                            <tr key={`${idx}-${i}`} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB', borderBottom: i === rowCount - 1 ? '2px solid #E5E7EB' : '1px solid #F0F0F5' }}>
                              {i === 0 && (
                                <>
                                  <td rowSpan={rowCount} style={{ ...modalTdStyle, fontFamily: 'monospace', fontWeight: 600, verticalAlign: 'middle' }}>{item.vin}</td>
                                  <td rowSpan={rowCount} style={{ ...modalTdStyle, verticalAlign: 'middle' }}>{item.model}</td>
                                  <td rowSpan={rowCount} style={{ ...modalTdStyle, fontSize: 12, verticalAlign: 'middle' }}>{formatDateTime(item.repelec_time)}</td>
                                  <td rowSpan={rowCount} style={{ ...modalTdStyle, fontSize: 12, verticalAlign: 'middle', fontWeight: 600 }}>{formatDateTime(item.cp72_time)}</td>
                                </>
                              )}
                              {bms ? (
                                <>
                                  <td style={{ ...modalTdStyle, color: '#6B21A8', fontWeight: 600, backgroundColor: '#FAF5FF' }}>{bms.test_station}</td>
                                  <td style={{ ...modalTdStyle, color: '#6B21A8', backgroundColor: '#FAF5FF' }}>{bms.module_name}</td>
                                  <td style={{ ...modalTdStyle, color: '#DC2626', fontWeight: 700, backgroundColor: '#FAF5FF' }}>{bms.result}</td>
                                  <td style={{ ...modalTdStyle, color: '#6B21A8', backgroundColor: '#FAF5FF', whiteSpace: 'normal' }}>{bms.fault_content}</td>
                                  <td style={{ ...modalTdStyle, backgroundColor: '#FFFBEB' }}>
                                    <textarea value={notesState[noteKey] || ''} onChange={(e) => handleNoteChange(item.vin, bms, e.target.value)} onBlur={(e) => saveSingleNote(item.vin, bms, e.target.value)} placeholder="Заметка к дефекту..." style={{ width: '100%', minHeight: 40, padding: 4, borderRadius: 4, border: '1px solid #FDE68A', fontSize: 12, resize: 'vertical', fontFamily: 'inherit' }} />
                                  </td>
                                </>
                              ) : (<td colSpan={5} style={{ ...modalTdStyle, textAlign: 'center', color: '#94A3B8', fontStyle: 'italic' }}>Нет данных BMS</td>)}
                            </tr>
                          );
                        });
                      })}
                    </tbody>
                  </table>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'auto' }}>
                    <thead>
                      <tr>
                        <th style={{ ...modalThStyle, width: 150 }}>VIN</th>
                        <th style={{ ...modalThStyle, width: 90 }}>Модель</th>
                        <th style={{ ...modalThStyle, width: 120 }}>Время REPELEC</th>
                        <th style={{ ...modalThStyle, width: 120 }}>Время CP72</th>
                        <th style={{ ...modalThStyle, background: '#EFF6FF', color: '#1E40AF', width: 100 }}>Пост</th>
                        <th style={{ ...modalThStyle, background: '#EFF6FF', color: '#1E40AF', width: 120 }}>Деталь</th>
                        <th style={{ ...modalThStyle, background: '#EFF6FF', color: '#1E40AF', width: 120 }}>Дефект</th>
                        <th style={{ ...modalThStyle, background: '#EFF6FF', color: '#1E40AF', width: 250 }}>Описание</th>
                        <th style={{ ...modalThStyle, background: '#EFF6FF', color: '#1E40AF', width: 150 }}>Комментарий</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modalVins.map((item, idx) => {
                        const iotList = item.iot_defects || [];
                        const rowCount = Math.max(iotList.length, 1);
                        return Array.from({ length: rowCount }).map((_, i) => {
                          const iot = iotList[i];
                          return (
                            <tr key={`${idx}-${i}`} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB', borderBottom: i === rowCount - 1 ? '2px solid #E5E7EB' : '1px solid #F0F0F5' }}>
                              {i === 0 && (
                                <>
                                  <td rowSpan={rowCount} style={{ ...modalTdStyle, fontFamily: 'monospace', fontWeight: 600, verticalAlign: 'middle' }}>{item.vin}</td>
                                  <td rowSpan={rowCount} style={{ ...modalTdStyle, verticalAlign: 'middle' }}>{item.model}</td>
                                  <td rowSpan={rowCount} style={{ ...modalTdStyle, fontSize: 12, verticalAlign: 'middle' }}>{formatDateTime(item.repelec_time)}</td>
                                  <td rowSpan={rowCount} style={{ ...modalTdStyle, fontSize: 12, verticalAlign: 'middle', fontWeight: 600 }}>{formatDateTime(item.cp72_time)}</td>
                                </>
                              )}
                              {iot ? (
                                <>
                                  <td style={{ ...modalTdStyle, backgroundColor: '#F8FAFC', fontWeight: 600 }}>{iot.post}</td>
                                  <td style={{ ...modalTdStyle, backgroundColor: '#F8FAFC' }}>{iot.part_name}</td>
                                  <td style={{ ...modalTdStyle, backgroundColor: '#F8FAFC', color: '#DC2626' }}>{iot.problem_type}</td>
                                  <td style={{ ...modalTdStyle, backgroundColor: '#F8FAFC', whiteSpace: 'normal' }}>{iot.description}</td>
                                  <td style={{ ...modalTdStyle, backgroundColor: '#F8FAFC', whiteSpace: 'normal' }}>{iot.comment}</td>
                                </>
                              ) : (<td colSpan={5} style={{ ...modalTdStyle, textAlign: 'center', color: '#94A3B8', fontStyle: 'italic' }}>Нет дефектов IoT</td>)}
                            </tr>
                          );
                        });
                      })}
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