import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList
} from 'recharts';

const API_BASE = '';

// ===== ФУНКЦИИ ЦВЕТОВ =====
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function formatDate(date) {
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getDayOfWeek(date) {
  return ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][new Date(date).getDay()];
}

function getDefectColor(value) {
  if (value === 0) return '#00B050';
  if (value <= 4)  return '#92D050';
  if (value <= 8)  return '#FFFF00';
  if (value <= 15) return '#FFC000';
  return '#FF0000';
}

function getDPUColor(value) {
  if (value === 0) return '#00B050';
  if (value <= 100) return '#92D050';
  if (value <= 200) return '#FFFF00';
  if (value <= 300) return '#FFC000';
  return '#FF0000';
}

function CarCell({ count, sticky }) {
  return (
    <div style={{ ...styles.cars, ...(sticky ? { position: 'sticky', top: 36, zIndex: 9 } : {}) }}>
      {count !== null ? count : '...'}
    </div>
  );
}

function CarsWeekSum({ sum, sticky }) {
  return (
    <div style={{ ...styles.cars, ...(sticky ? { position: 'sticky', top: 36, zIndex: 9 } : {}) }}>
      {sum !== null ? sum : '...'}
    </div>
  );
}

// ===== МУЛЬТИСЕЛЕКТ ДЛЯ МОДЕЛЕЙ =====
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
          ...styles.filterSelect,
          width: 160,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
          cursor: 'pointer',
          textAlign: 'left',
          padding: '8px 10px',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110, fontSize: 13 }}>
          {displayText}
        </span>
        <span style={{ fontSize: 10, color: '#9CA3AF' }}>▼</span>
      </button>
      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          background: '#1F2937', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          padding: 12, minWidth: 200, zIndex: 100, border: '1px solid #374151', maxHeight: 300, overflowY: 'auto',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#FFF' }}>
            <input type="checkbox" checked={allSelected} onChange={() => handleToggle('ALL')} />
            Все
          </label>
          {nonAllOptions.map(option => (
            <label key={option} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer', fontSize: 14, color: '#D1D5DB' }}>
              <input type="checkbox" checked={selected.includes(option)} onChange={() => handleToggle(option)} />
              {option}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== ПОИСК =====
function SearchBar({ uniqueDefects, onSearchChange }) {
  const [partQuery, setPartQuery] = useState('');
  const [defectQuery, setDefectQuery] = useState('');
  
  const [showPartSug, setShowPartSug] = useState(false);
  const [showDefectSug, setShowDefectSug] = useState(false);
  
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowPartSug(false);
        setShowDefectSug(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = () => {
    onSearchChange(partQuery, defectQuery);
    setShowPartSug(false);
    setShowDefectSug(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleClear = () => {
    setPartQuery('');
    setDefectQuery('');
    setShowPartSug(false);
    setShowDefectSug(false);
    onSearchChange('', '');
  };

  const uniqueParts = useMemo(() => {
    const parts = new Set(uniqueDefects.map(d => d.part).filter(Boolean));
    return Array.from(parts).sort((a, b) => a.localeCompare(b));
  }, [uniqueDefects]);

  const uniqueDefectTypes = useMemo(() => {
    const defects = new Set(uniqueDefects.map(d => d.defect).filter(Boolean));
    return Array.from(defects).sort((a, b) => a.localeCompare(b));
  }, [uniqueDefects]);

  const partSuggestions = useMemo(() => {
    if (!partQuery.trim()) return [];
    const q = partQuery.toLowerCase();
    return uniqueParts.filter(p => p.toLowerCase().includes(q)).slice(0, 50);
  }, [partQuery, uniqueParts]);

  const defectSuggestions = useMemo(() => {
    if (!defectQuery.trim()) return [];
    const q = defectQuery.toLowerCase();
    return uniqueDefectTypes.filter(d => d.toLowerCase().includes(q)).slice(0, 50);
  }, [defectQuery, uniqueDefectTypes]);

  const hasInput = partQuery || defectQuery;

  return (
    <div ref={containerRef} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
      {/* Блок Деталь */}
      <div style={{ position: 'relative', width: 200 }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: 10, color: '#9CA3AF', fontSize: 14 }}>🔍</span>
          <input
            type="text" placeholder="Деталь..." value={partQuery}
            onChange={(e) => { setPartQuery(e.target.value); setShowPartSug(true); }}
            onFocus={() => setShowPartSug(true)} onKeyDown={handleKeyDown}
            style={{ ...styles.filterSelect, paddingLeft: 32, width: '100%' }}
          />
        </div>
        {showPartSug && partSuggestions.length > 0 && (
          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#1F2937', border: '1px solid #374151', borderRadius: 8, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)', zIndex: 100, maxHeight: 200, overflowY: 'auto' }}>
            {partSuggestions.map((item, idx) => (
              <div key={idx} onClick={() => { setPartQuery(item); setShowPartSug(false); }} style={{ padding: '8px 12px', cursor: 'pointer', color: '#E5E7EB', fontSize: 13, borderBottom: '1px solid #374151' }} onMouseEnter={(e) => e.currentTarget.style.background = '#374151'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                {item}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Блок Дефект */}
      <div style={{ position: 'relative', width: 200 }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: 10, color: '#9CA3AF', fontSize: 14 }}>🔍</span>
          <input
            type="text" placeholder="Дефект..." value={defectQuery}
            onChange={(e) => { setDefectQuery(e.target.value); setShowDefectSug(true); }}
            onFocus={() => setShowDefectSug(true)} onKeyDown={handleKeyDown}
            style={{ ...styles.filterSelect, paddingLeft: 32, width: '100%' }}
          />
        </div>
        {showDefectSug && defectSuggestions.length > 0 && (
          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#1F2937', border: '1px solid #374151', borderRadius: 8, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)', zIndex: 100, maxHeight: 200, overflowY: 'auto' }}>
            {defectSuggestions.map((item, idx) => (
              <div key={idx} onClick={() => { setDefectQuery(item); setShowDefectSug(false); }} style={{ padding: '8px 12px', cursor: 'pointer', color: '#E5E7EB', fontSize: 13, borderBottom: '1px solid #374151' }} onMouseEnter={(e) => e.currentTarget.style.background = '#374151'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                {item}
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={handleSearch}
        style={{ padding: '8px 16px', borderRadius: 8, background: '#60A5FA', color: '#FFFFFF', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', height: '36px', transition: 'background 0.2s', whiteSpace: 'nowrap' }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#3B82F6'}
        onMouseLeave={(e) => e.currentTarget.style.background = '#60A5FA'}
      >
        Найти
      </button>

      {hasInput && (
        <button onClick={handleClear} style={{ padding: '8px 12px', borderRadius: 8, background: '#374151', color: '#FFFFFF', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', height: '36px' }} title="Очистить поиск">✕</button>
      )}
    </div>
  );
}

// ===== ОСНОВНОЙ КОМПОНЕНТ =====
export default function ReportPage() {
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [checkpoint, setCheckpoint] = useState('CP7');
  const [defectType, setDefectType] = useState('default');
  const [selectedModels, setSelectedModels] = useState([]); 
  const [unit, setUnit] = useState('defects');
  const [shift, setShift] = useState('all');

  const [sortDay, setSortDay] = useState(null);
  const [sortCW, setSortCW] = useState(null);

  const [carsCounts, setCarsCounts] = useState({});
  const [carsLoading, setCarsLoading] = useState(false);

  const [userNotes, setUserNotes] = useState({});
  const loadDataRef = useRef();

  const [hiddenRows, setHiddenRows] = useState({});
  const [selectedRow, setSelectedRow] = useState(null);
  
  const [searchPart, setSearchPart] = useState('');
  const [searchDefect, setSearchDefect] = useState('');

  const [trendModalOpen, setTrendModalOpen] = useState(false);
  const [trendData, setTrendData] = useState(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendMpp, setTrendMpp] = useState('');
  const [trendMetric, setTrendMetric] = useState('defects');

  const availableModels = ['ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];

  useEffect(() => {
    fetch(`${API_BASE}/api/defect-notes`)
      .then(res => res.json())
      .then(data => {
        const map = {};
        data.forEach(n => { map[n.mpp] = n; });
        setUserNotes(map);
      })
      .catch(() => {});
  }, []);

  const handleNoteSave = async (mpp, field, value) => {
    const current = userNotes[mpp] || { responsible: '', action: '' };
    const updated = { ...current, [field]: value };
    setUserNotes(prev => ({ ...prev, [mpp]: updated }));

    try {
      const res = await fetch(`${API_BASE}/api/defect-notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mpp, responsible: updated.responsible || '', action: updated.action || '' }),
      });
      const json = await res.json();
      if (json.success && json.note) {
        setUserNotes(prev => ({ ...prev, [mpp]: { ...prev[mpp], updated_at: json.note.updated_at } }));
      }
    } catch (err) { console.error('Ошибка сохранения:', err); }
  };

  const { prevWeekDays, currWeekDays, prevWeekNum, currWeekNum, isMonday } = useMemo(() => {
    const today = new Date();
    const mondayThisWeek = getMonday(today);
    const mondayPrevWeek = new Date(mondayThisWeek);
    mondayPrevWeek.setDate(mondayPrevWeek.getDate() - 7);
    const prevDays = [], currDays = [];
    for (let i = 0; i < 7; i++) {
      prevDays.push(new Date(mondayPrevWeek.getTime() + i * 86400000));
      currDays.push(new Date(mondayThisWeek.getTime() + i * 86400000));
    }
    return { prevWeekDays: prevDays, currWeekDays: currDays, prevWeekNum: getWeekNumber(mondayPrevWeek), currWeekNum: getWeekNumber(mondayThisWeek), isMonday: today.getDay() === 1 };
  }, []);

  const allDays = useMemo(() => [...prevWeekDays, ...currWeekDays], [prevWeekDays, currWeekDays]);

  const loadAllData = useCallback(() => {
    const params = new URLSearchParams();
    if (checkpoint !== 'ALL') params.append('checkpoint', checkpoint);
    if (defectType !== 'default') params.append('defectType', defectType);
    if (shift !== 'all') params.append('shift', shift);

    const defectsUrl = `${API_BASE}/api/defects-dashboard${params.toString() ? '?' + params.toString() : ''}`;

    setLoading(true);
    setError(null);

    fetch(defectsUrl)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setRawData(data);
          const today = new Date();
          const todayStr = today.toISOString().split('T')[0];
          const prevIndex = prevWeekDays.findIndex(d => d.toISOString().split('T')[0] === todayStr);
          const currIndex = currWeekDays.findIndex(d => d.toISOString().split('T')[0] === todayStr);
          if (prevIndex !== -1) setSortDay({ week: 'prev', index: prevIndex });
          else if (currIndex !== -1) setSortDay({ week: 'curr', index: currIndex });
        } else {
          setError('Неверный формат данных от сервера');
        }
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });

    if (!allDays.length) return;
    setCarsLoading(true);
    
    const fetches = allDays.map(async (date) => {
      const ds = date.toISOString().split('T')[0];
      if (selectedModels.length === 0 || selectedModels.length === availableModels.length) {
        const res = await fetch(`${API_BASE}/api/cars-count?date=${ds}`);
        const json = await res.json();
        return { date: ds, count: json.CARS_COUNT || 0 };
      } else {
        let total = 0;
        for (const m of selectedModels) {
          const res = await fetch(`${API_BASE}/api/cars-count?model=${encodeURIComponent(m)}&date=${ds}`);
          const json = await res.json();
          total += json.CARS_COUNT || 0;
        }
        return { date: ds, count: total };
      }
    });

    Promise.all(fetches)
      .then(results => {
        const counts = {};
        results.forEach(r => { counts[r.date] = r.count; });
        setCarsCounts(counts);
        setCarsLoading(false);
      })
      .catch(() => setCarsLoading(false));
  }, [checkpoint, defectType, selectedModels, shift, allDays, prevWeekDays, currWeekDays]);

  useEffect(() => { loadDataRef.current = loadAllData; }, [loadAllData]);
  useEffect(() => { loadAllData(); }, [loadAllData]);

  useEffect(() => {
    const interval = setInterval(() => { if (loadDataRef.current) loadDataRef.current(); }, 300000);
    return () => clearInterval(interval);
  }, []);

  const uniqueDefects = useMemo(() => {
    if (!Array.isArray(rawData)) return [];
    const map = new Map();
    rawData.forEach(d => {
      const key = `${d.PART_NAME}|||${d.PROBLEM_TYPE}`;
      if (!map.has(key)) map.set(key, { part: d.PART_NAME, defect: d.PROBLEM_TYPE, label: `${d.PART_NAME} ${d.PROBLEM_TYPE}`.trim() });
    });
    return Array.from(map.values());
  }, [rawData]);

  const { models, rows, headerCarsPrev, headerCarsCurr, sumCarsPrev, sumCarsCurr } = useMemo(() => {
    if (!Array.isArray(rawData)) return { models: ['ALL'], rows: [], headerCarsPrev: [], headerCarsCurr: [], sumCarsPrev: 0, sumCarsCurr: 0 };

    const modelSet = new Set(rawData.map(d => d.MODEL));
    const modelsArr = ['ALL', ...Array.from(modelSet).sort()];
    
    let filtered = selectedModels.length === 0 
      ? rawData 
      : rawData.filter(d => selectedModels.includes(d.MODEL));
    
    if (searchPart.trim()) {
      const qPart = searchPart.trim().toLowerCase();
      filtered = filtered.filter(d => d.PART_NAME && d.PART_NAME.toLowerCase().includes(qPart));
    }
    if (searchDefect.trim()) {
      const qDef = searchDefect.trim().toLowerCase();
      filtered = filtered.filter(d => d.PROBLEM_TYPE && d.PROBLEM_TYPE.toLowerCase().includes(qDef));
    }

    const grouped = {};
    filtered.forEach(item => {
      if (!grouped[item.MPP]) {
        grouped[item.MPP] = { 
          MPP: item.MPP, PART_NAME: item.PART_NAME, PROBLEM_TYPE: item.PROBLEM_TYPE, MODEL: item.MODEL, days: {} 
        };
      }
      if (!grouped[item.MPP].days[item.CREATION_TIME]) grouped[item.MPP].days[item.CREATION_TIME] = 0;
      grouped[item.MPP].days[item.CREATION_TIME] += item.DEFECTS_COUNT;
    });

    let resultRows = Object.values(grouped).map(g => {
      const row = { 
        MPP: g.MPP, PART_NAME: g.PART_NAME, PROBLEM_TYPE: g.PROBLEM_TYPE, MODEL: g.MODEL,
        cellsPrev: [], cellsCurr: [], totalPrevDef: 0, totalCurrDef: 0 
      };
      prevWeekDays.forEach(date => {
        const ds = date.toISOString().split('T')[0];
        const v = g.days[ds] || 0;
        row.cellsPrev.push(v); row.totalPrevDef += v;
      });
      currWeekDays.forEach((date, i) => {
        const ds = date.toISOString().split('T')[0];
        const v = (isMonday && i > 0) ? 0 : (g.days[ds] || 0);
        row.cellsCurr.push(v); row.totalCurrDef += v;
      });
      return row;
    });

    if (sortCW) resultRows.sort((a, b) => sortCW === 'prev' ? b.totalPrevDef - a.totalPrevDef : b.totalCurrDef - a.totalCurrDef);
    else if (sortDay) {
      resultRows.sort((a, b) => {
        const va = sortDay.week === 'prev' ? a.cellsPrev[sortDay.index] : a.cellsCurr[sortDay.index];
        const vb = sortDay.week === 'prev' ? b.cellsPrev[sortDay.index] : b.cellsCurr[sortDay.index];
        return vb - va;
      });
    } else resultRows.sort((a, b) => (b.totalPrevDef + b.totalCurrDef) - (a.totalPrevDef + a.totalCurrDef));

    const carsPrev = prevWeekDays.map(d => carsCounts[d.toISOString().split('T')[0]] ?? 0);
    const carsCurr = currWeekDays.map((d, i) => (isMonday && i > 0) ? 0 : (carsCounts[d.toISOString().split('T')[0]] ?? 0));

    return {
      models: modelsArr, rows: resultRows,
      headerCarsPrev: carsPrev, headerCarsCurr: carsCurr,
      sumCarsPrev: carsPrev.reduce((s, v) => s + v, 0),
      sumCarsCurr: carsCurr.reduce((s, v) => s + v, 0)
    };
  }, [rawData, selectedModels, prevWeekDays, currWeekDays, isMonday, sortDay, sortCW, carsCounts, searchPart, searchDefect]);

  const totalDailyDefectsPrev = useMemo(() => {
    const arr = Array(7).fill(0);
    rows.forEach(r => r.cellsPrev.forEach((val, i) => { arr[i] += val; }));
    return arr;
  }, [rows]);

  const totalDailyDefectsCurr = useMemo(() => {
    const arr = Array(7).fill(0);
    rows.forEach(r => r.cellsCurr.forEach((val, i) => { arr[i] += val; }));
    return arr;
  }, [rows]);

  // Синхронизировано с выпадающим списком
  const defectTypeText = useMemo(() => {
    if (defectType === 'online') return 'Online';
    if (defectType === 'offline') return 'Offline';
    return 'Все';
  }, [defectType]);

  const totalRow = useMemo(() => {
    if (rows.length === 0) return null;
    let totalPrevDef = 0;
    let totalCurrDef = 0;
    rows.forEach(r => { totalPrevDef += r.totalPrevDef; totalCurrDef += r.totalCurrDef; });
    return {
      isTotal: true,
      MPP: `Итого дефектов по фильтру: ${defectTypeText}`,
      MODEL: '—',
      cellsPrev: totalDailyDefectsPrev,
      cellsCurr: totalDailyDefectsCurr,
      totalPrevDef,
      totalCurrDef,
      dpuPrev: sumCarsPrev > 0 ? (totalPrevDef * 1000) / sumCarsPrev : 0,
      dpuCurr: sumCarsCurr > 0 ? (totalCurrDef * 1000) / sumCarsCurr : 0
    };
  }, [rows, sumCarsPrev, sumCarsCurr, totalDailyDefectsPrev, totalDailyDefectsCurr, defectTypeText]);

  const displayRows = totalRow ? [totalRow, ...rows] : rows;

  const handleToggleRow = (mpp) => { setHiddenRows(prev => ({ ...prev, [mpp]: !prev[mpp] })); };
  const showAllRows = () => { setHiddenRows({}); };
  const hiddenCount = Object.values(hiddenRows).filter(Boolean).length;

  const isDPU = unit === 'dpu';
  const colorFunc = isDPU ? getDPUColor : getDefectColor;
  const formatDPU = (value) => value.toFixed(1);

  const responsibleOptions = ['', 'Сварка', 'Окраска', 'Сборка', 'Качество'];
  const actionOptions = ['', 'На контроле', 'Устранено', 'Требует проверки'];

  const stickyTop1 = 0;
  const stickyTop2 = 36;

  const openTrend = async (row) => {
    setTrendMpp(row.isTotal ? `Итого (${defectTypeText})` : row.MPP);
    setTrendModalOpen(true);
    setTrendLoading(true);
    try {
      const fetchTrend = (periodType) => {
        // ИСПРАВЛЕНИЕ: передаем все выбранные модели и поиск
        let modelParam = 'ALL';
        if (row.isTotal) {
          if (selectedModels.length > 0 && selectedModels.length < availableModels.length) {
            modelParam = selectedModels.join(',');
          }
        } else {
          modelParam = row.MODEL;
        }

        const params = new URLSearchParams({
          partName: row.isTotal ? 'ALL' : row.PART_NAME,
          problemType: row.isTotal ? 'ALL' : row.PROBLEM_TYPE,
          model: modelParam,
          checkpoint,
          defectType,
          shift,
          periodType,
          searchPart: row.isTotal ? searchPart : '',
          searchDefect: row.isTotal ? searchDefect : ''
        });
        return fetch(`${API_BASE}/api/report-page-defect-trend?${params.toString()}`).then(r => r.json());
      };

      const [monthData, weekData, dayData] = await Promise.all([
        fetchTrend('month'), fetchTrend('week'), fetchTrend('day'),
      ]);
      setTrendData({ month: monthData, week: weekData, day: dayData });
    } catch (err) {
      alert('Ошибка загрузки тренда: ' + err.message);
    } finally {
      setTrendLoading(false);
    }
  };

  const prepareDisplayData = (data) => {
    if (!data) return [];
    return data.map(d => ({
      period: d.period,
      value: trendMetric === 'dpu' ? (d.total_cars > 0 ? Number(((d.defect_count * 1000) / d.total_cars).toFixed(2)) : 0) : d.defect_count,
    }));
  };

  if (loading || carsLoading) return <div style={styles.loading}>Загрузка...</div>;
  if (error) return <div style={styles.error}>Ошибка: {error}</div>;

  return (
    <div style={styles.app}>
      <h1 style={styles.title}>Контроль качества</h1>
      
      <div style={styles.filterBar}>
        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>Чекпоинт:</span>
          <select value={checkpoint} onChange={e => setCheckpoint(e.target.value)} style={styles.filterSelect}>
            <option value="ALL">Все</option>
            <option value="CP7">CP7</option>
            <option value="CP8">CP8</option>
          </select>
        </div>
        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>Тип:</span>
          <select value={defectType} onChange={e => setDefectType(e.target.value)} style={styles.filterSelect}>
            <option value="default">Все</option>
            <option value="offline">Offline</option>
            <option value="online">Online</option>
          </select>
        </div>
        
        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>Модель:</span>
          <MultiSelect 
            options={['ALL', ...availableModels]} 
            selected={selectedModels} 
            onChange={setSelectedModels} 
            placeholder="Все модели" 
          />
        </div>

        <div style={{ width: 1, height: 24, background: '#374151', margin: '0 8px' }} />

        <div style={{ display: 'flex', alignItems: 'center' }}>
          <SearchBar uniqueDefects={uniqueDefects} onSearchChange={(part, defect) => { setSearchPart(part); setSearchDefect(defect); }} />
        </div>

        <div style={{ width: 1, height: 24, background: '#374151', margin: '0 8px' }} />

        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>Единицы:</span>
          <select value={unit} onChange={e => setUnit(e.target.value)} style={styles.filterSelect}>
            <option value="defects">Штуки</option>
            <option value="dpu">DPU per 1000</option>
          </select>
        </div>
        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>Смена:</span>
          <select value={shift} onChange={e => setShift(e.target.value)} style={styles.filterSelect}>
            <option value="all">Сутки</option>
            <option value="A">Смена A</option>
            <option value="B">Смена B</option>
            <option value="C">Смена C</option>
          </select>
        </div>

        {sortDay && <span style={styles.sortInfo}>Сорт: день {sortDay.week==='prev'?'прошл':'тек'} {sortDay.index+1} <button onClick={()=>setSortDay(null)} style={styles.clearBtn}>✕</button></span>}
        {sortCW && <span style={styles.sortInfo}>Сорт: CW{sortCW==='prev'?prevWeekNum:currWeekNum} <button onClick={()=>setSortCW(null)} style={styles.clearBtn}>✕</button></span>}
      </div>

      <div style={{ overflowX: 'auto', width: '100%', paddingBottom: 20 }}>
        <div style={styles.grid}>
          {/* 1-я строка заголовков */}
          <div style={{ ...styles.dark, position: 'sticky', top: stickyTop1, zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Дефект</span>
            {hiddenCount > 0 && (
              <button onClick={showAllRows} title="Показать все скрытые строки" style={{ background: 'transparent', border: 'none', color: '#60A5FA', cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>👁️</span> {hiddenCount}
              </button>
            )}
          </div>
          <div style={{ ...styles.dark, position: 'sticky', top: stickyTop1, zIndex: 10 }}>Ответственный</div>
          <div style={{ ...styles.dark, position: 'sticky', top: stickyTop1, zIndex: 10 }}>Действие</div>

          {prevWeekDays.map((d, i) => (
            <div key={`ph${i}`} style={{ ...styles.hdr, position: 'sticky', top: stickyTop1, zIndex: 10 }}>
              <button onClick={() => { setSortCW(null); setSortDay(p => p?.week==='prev'&&p?.index===i?null:{week:'prev',index:i}); }} style={{ ...styles.sortBtn, background: sortDay?.week==='prev'&&sortDay?.index===i ? '#2563EB' : 'transparent', color: sortDay?.week==='prev'&&sortDay?.index===i ? '#FFF' : '#D1D5DB', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.2 }}>
                <span>{formatDate(d)}</span><span>{getDayOfWeek(d)}</span>
              </button>
            </div>
          ))}
          <div style={{ ...styles.hdr, position: 'sticky', top: stickyTop1, zIndex: 10 }}>
            <button onClick={() => { setSortDay(null); setSortCW(p => p==='prev'?null:'prev'); }} style={{...styles.sortBtn, background: sortCW==='prev'?'#2563EB':'transparent', color: sortCW==='prev'?'#FFF':'#D1D5DB'}}>CW{prevWeekNum}</button>
          </div>

          {currWeekDays.map((d, i) => (
            <div key={`ch${i}`} style={{ ...styles.hdr, position: 'sticky', top: stickyTop1, zIndex: 10 }}>
              <button onClick={() => { setSortCW(null); setSortDay(p => p?.week==='curr'&&p?.index===i?null:{week:'curr',index:i}); }} style={{ ...styles.sortBtn, background: sortDay?.week==='curr'&&sortDay?.index===i ? '#2563EB' : 'transparent', color: sortDay?.week==='curr'&&sortDay?.index===i ? '#FFF' : '#D1D5DB', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.2 }}>
                <span>{formatDate(d)}</span><span>{getDayOfWeek(d)}</span>
              </button>
            </div>
          ))}
          <div style={{ ...styles.hdr, position: 'sticky', top: stickyTop1, zIndex: 10 }}>
            <button onClick={() => { setSortDay(null); setSortCW(p => p==='curr'?null:'curr'); }} style={{...styles.sortBtn, background: sortCW==='curr'?'#2563EB':'transparent', color: sortCW==='curr'?'#FFF':'#D1D5DB'}}>CW{currWeekNum}</button>
          </div>

          {/* 2-я строка заголовков */}
          <div style={{ ...styles.dark, position: 'sticky', top: stickyTop2, zIndex: 9 }}>Кол-во машин</div>
          <div style={{ ...styles.dark, position: 'sticky', top: stickyTop2, zIndex: 9 }}></div>
          <div style={{ ...styles.dark, position: 'sticky', top: stickyTop2, zIndex: 9 }}></div>
          {headerCarsPrev.map((v, i) => <CarCell key={`hcp${i}`} count={v} sticky />)}
          <CarsWeekSum sum={sumCarsPrev} sticky />
          {headerCarsCurr.map((v, i) => <CarCell key={`hcc${i}`} count={v} sticky />)}
          <CarsWeekSum sum={sumCarsCurr} sticky />

          {/* Строки данных */}
          {displayRows.map((row) => {
            if (!row.isTotal && hiddenRows[row.MPP]) return null;
            const rowDpuPrev = row.isTotal ? row.dpuPrev : (sumCarsPrev > 0 ? (row.totalPrevDef * 1000) / sumCarsPrev : 0);
            const rowDpuCurr = row.isTotal ? row.dpuCurr : (sumCarsCurr > 0 ? (row.totalCurrDef * 1000) / sumCarsCurr : 0);
            const note = row.isTotal ? { responsible: '', action: '' } : (userNotes[row.MPP] || { responsible: '', action: '' });
            const isSelected = selectedRow === row.MPP;
            const selectedBoxShadow = isSelected ? 'inset 0 0 0 2px #FFFFFF' : undefined;
            
            // Стили для строки ИТОГО (глубокий синий)
            const totalBg = '#1E3A8A';
            const totalBorder = '#3B82F6';
            const rowBg = row.isTotal ? totalBg : '#1F2937';
            const rowBorder = row.isTotal ? totalBorder : '#4B5563';

            return (
              <React.Fragment key={row.isTotal ? 'TOTAL' : row.MPP}>
                <div
                  style={{ ...styles.name, background: rowBg, border: `1px solid ${rowBorder}`, position: 'relative', overflow: 'visible', boxShadow: selectedBoxShadow, cursor: row.isTotal ? 'default' : 'pointer', display: 'flex', alignItems: 'center', color: row.isTotal ? '#FFFFFF' : '#FFF', fontWeight: row.isTotal ? 900 : 600 }}
                  onClick={() => !row.isTotal && setSelectedRow(isSelected ? null : row.MPP)}
                >
                  {!row.isTotal && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleRow(row.MPP); }}
                      title="Свернуть строку"
                      style={{ position: 'absolute', left: -20, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#D1D5DB', cursor: 'pointer', fontSize: 14, width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, zIndex: 1 }}
                    >
                      ▾
                    </button>
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {row.MPP}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); openTrend(row); }}
                    title="Динамика дефекта"
                    style={{ marginLeft: 8, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, color: '#FFF' }}
                  >
                    📈
                  </button>
                </div>

                <div style={{ ...styles.noteCell, background: rowBg, border: `1px solid ${rowBorder}`, boxShadow: selectedBoxShadow }}>
                  {!row.isTotal && (
                    <>
                      <select value={note.responsible} onChange={e => handleNoteSave(row.MPP, 'responsible', e.target.value)} style={styles.noteSelect}>
                        {responsibleOptions.map(opt => <option key={opt} value={opt}>{opt || '—'}</option>)}
                      </select>
                      {note.updated_at && <div style={styles.noteDate}>{new Date(note.updated_at).toLocaleDateString('ru-RU')}</div>}
                    </>
                  )}
                </div>

                <div style={{ ...styles.noteCell, background: rowBg, border: `1px solid ${rowBorder}`, boxShadow: selectedBoxShadow }}>
                  {!row.isTotal && (
                    <>
                      <select value={note.action} onChange={e => handleNoteSave(row.MPP, 'action', e.target.value)} style={styles.noteSelect}>
                        {actionOptions.map(opt => <option key={opt} value={opt}>{opt || '—'}</option>)}
                      </select>
                      {note.updated_at && <div style={styles.noteDate}>{new Date(note.updated_at).toLocaleDateString('ru-RU')}</div>}
                    </>
                  )}
                </div>

                {row.cellsPrev.map((defects, ci) => {
                  const dateStr = prevWeekDays[ci].toISOString().split('T')[0];
                  const cars = carsCounts[dateStr] || 0;
                  let value = isDPU ? (cars > 0 ? (defects * 1000) / cars : 0) : defects;
                  if (isDPU && value > 1000) value = 980;
                  
                  const bg = row.isTotal ? totalBg : colorFunc(value);
                  const textColor = row.isTotal ? '#FFFFFF' : (isDPU ? (value > 300 ? '#FFF' : '#000') : (value > 15 ? '#FFF' : '#000'));
                  
                  return (
                    <div key={`cp${row.MPP}${ci}`} style={{ ...styles.val, border: `1px solid ${rowBorder}`, background: bg, color: textColor, boxShadow: selectedBoxShadow, fontWeight: row.isTotal ? 800 : 600 }}>
                      {isDPU ? formatDPU(value) : value}
                    </div>
                  );
                })}
                <div style={{ ...styles.total, border: `1px solid ${rowBorder}`, background: row.isTotal ? totalBg : colorFunc(isDPU ? rowDpuPrev : row.totalPrevDef), color: row.isTotal ? '#FFFFFF' : ((isDPU ? rowDpuPrev : row.totalPrevDef) > (isDPU ? 300 : 15) ? '#FFF' : '#000'), boxShadow: selectedBoxShadow, fontWeight: row.isTotal ? 800 : 700 }}>
                  {isDPU ? formatDPU(rowDpuPrev) : row.totalPrevDef}
                </div>

                {row.cellsCurr.map((defects, ci) => {
                  const dateStr = currWeekDays[ci].toISOString().split('T')[0];
                  const cars = carsCounts[dateStr] || 0;
                  let value = isDPU ? (cars > 0 ? (defects * 1000) / cars : 0) : defects;
                  if (isDPU && value > 1000) value = 980;
                  
                  const bg = row.isTotal ? totalBg : colorFunc(value);
                  const textColor = row.isTotal ? '#FFFFFF' : (isDPU ? (value > 300 ? '#FFF' : '#000') : (value > 15 ? '#FFF' : '#000'));

                  return (
                    <div key={`cc${row.MPP}${ci}`} style={{ ...styles.val, border: `1px solid ${rowBorder}`, background: bg, color: textColor, boxShadow: selectedBoxShadow, fontWeight: row.isTotal ? 800 : 600 }}>
                      {isDPU ? formatDPU(value) : value}
                    </div>
                  );
                })}
                <div style={{ ...styles.total, border: `1px solid ${rowBorder}`, background: row.isTotal ? totalBg : colorFunc(isDPU ? rowDpuCurr : row.totalCurrDef), color: row.isTotal ? '#FFFFFF' : ((isDPU ? rowDpuCurr : row.totalCurrDef) > (isDPU ? 300 : 15) ? '#FFF' : '#000'), boxShadow: selectedBoxShadow, fontWeight: row.isTotal ? 800 : 700 }}>
                  {isDPU ? formatDPU(rowDpuCurr) : row.totalCurrDef}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Модалка графиков */}
      {trendModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2000,
        }} onClick={() => setTrendModalOpen(false)}>
          <div style={{
            backgroundColor: '#1F2937', borderRadius: 16, padding: 24,
            width: '96%', maxWidth: 1600, maxHeight: '95vh', overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)', color: '#FFF',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                Динамика дефекта: {trendMpp}
              </h3>
              <button onClick={() => setTrendModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#9CA3AF' }}>✕</button>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <button onClick={() => setTrendMetric('defects')} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', background: trendMetric === 'defects' ? '#2563EB' : '#374151', color: '#FFF' }}>Шт. дефектов</button>
              <button onClick={() => setTrendMetric('dpu')} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', background: trendMetric === 'dpu' ? '#2563EB' : '#374151', color: '#FFF' }}>DPU per 1000</button>
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
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="period" tick={{ fontSize: 12, fill: '#9CA3AF' }} tickFormatter={(val) => { const [y, m] = val.split('-'); const monthNames = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']; return monthNames[parseInt(m,10)-1]; }} />
                        <YAxis tick={{ fontSize: 12, fill: '#9CA3AF' }} allowDecimals={trendMetric === 'dpu'} />
                        <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8, color: '#FFF' }} />
                        <Bar dataKey="value" fill="#3B82F6" radius={[4,4,0,0]}>
                          <LabelList dataKey="value" position="top" style={{ fontSize: 14, fill: '#FFF', fontWeight: 700 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Недели */}
                  <div style={{ flex: '1 1 0', minWidth: 250 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px' }}>Последние 4 недели</h4>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={prepareDisplayData(trendData.week)} margin={{ top: 30, right: 10, left: 0, bottom: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="period" tick={{ fontSize: 12, fill: '#9CA3AF' }} tickFormatter={(val) => val.split('-W')[1] ? `W${val.split('-W')[1]}` : val} />
                        <YAxis tick={{ fontSize: 12, fill: '#9CA3AF' }} allowDecimals={trendMetric === 'dpu'} />
                        <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8, color: '#FFF' }} />
                        <Bar dataKey="value" fill="#F59E0B" radius={[4,4,0,0]}>
                          <LabelList dataKey="value" position="top" style={{ fontSize: 14, fill: '#FFF', fontWeight: 700 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Дни */}
                  <div style={{ flex: '2 1 0', minWidth: 350 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px' }}>Последние 14 дней</h4>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={prepareDisplayData(trendData.day)} margin={{ top: 30, right: 10, left: 0, bottom: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="period" interval={0} tick={{ fontSize: 11, fill: '#9CA3AF' }} tickFormatter={(val) => { const [, m, d] = val.split('-'); return `${d}.${m}`; }} />
                        <YAxis tick={{ fontSize: 12, fill: '#9CA3AF' }} allowDecimals={trendMetric === 'dpu'} />
                        <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8, color: '#FFF' }} />
                        <Bar dataKey="value" fill="#10B981" radius={[4,4,0,0]}>
                          <LabelList dataKey="value" position="top" style={{ fontSize: 13, fill: '#FFF', fontWeight: 700 }} />
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

// === СТИЛИ ===
const styles = {
  app: { background: '#111827', minHeight: '100vh', padding: 20, fontFamily: 'Segoe UI, Arial, sans-serif', color: '#FFF' },
  title: { marginBottom: 20, fontSize: 22, fontWeight: 600 },
  filterBar: { display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 20, flexWrap: 'wrap', background: '#1F2937', padding: '16px 20px', borderRadius: 12, border: '1px solid #374151' },
  filterGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  filterLabel: { fontSize: 12, color: '#9CA3AF', fontWeight: 600 },
  filterSelect: { padding: '8px 12px', borderRadius: 8, border: '1px solid #4B5563', background: '#111827', color: '#FFF', fontSize: 13, cursor: 'pointer', outline: 'none', minWidth: 100 },
  sortInfo: { fontSize: 12, color: '#60A5FA', display: 'flex', alignItems: 'center', gap: 5, background: '#1E3A8A', padding: '4px 10px', borderRadius: 6, marginLeft: 'auto' },
  clearBtn: { background: '#EF4444', color: '#FFF', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 10, padding: '1px 5px' },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(300px, 2fr) 110px 110px repeat(7, 60px) 60px repeat(7, 60px) 60px', border: '1px solid #4B5563', fontSize: 13, minWidth: 1100 },
  dark: { background: '#1F2937', padding: '6px 8px', fontWeight: 600, border: '1px solid #4B5563', display: 'flex', alignItems: 'center', fontSize: 11 },
  hdr: { background: '#374151', padding: 4, fontWeight: 600, border: '1px solid #4B5563', textAlign: 'center', fontSize: 11 },
  sortBtn: { border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '4px 6px', borderRadius: 4, width: '100%' },
  cars: { background: '#374151', padding: '4px 3px', border: '1px solid #4B5563', textAlign: 'center', fontSize: 11, color: '#D1D5DB', minHeight: 19, whiteSpace: 'nowrap' },
  name: { background: '#1F2937', padding: '6px 8px', fontWeight: 600, border: '1px solid #4B5563', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12 },
  noteCell: { background: '#1F2937', padding: '2px 4px', border: '1px solid #4B5563', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 },
  noteSelect: { width: '100%', padding: '2px 4px', borderRadius: 4, border: '1px solid #4B5563', background: '#374151', color: '#FFF', fontSize: 11, cursor: 'pointer' },
  noteDate: { fontSize: 9, color: '#9CA3AF', textAlign: 'center' },
  val: { padding: '6px 4px', border: '1px solid #4B5563', textAlign: 'center', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' },
  total: { padding: '6px 4px', border: '1px solid #4B5563', textAlign: 'center', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' },
  loading: { textAlign: 'center', padding: 50, fontSize: 18, color: '#9CA3AF' },
  error: { textAlign: 'center', padding: 50, fontSize: 18, color: '#EF4444' },
};