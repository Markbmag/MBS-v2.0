import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, LabelList
} from 'recharts';

const API_BASE = '';

// ============================================================
//  СТИЛИ
// ============================================================
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

const tabBarStyle = {
  display: 'flex',
  gap: 6,
  marginBottom: 24,
  backgroundColor: '#E5E7EB',
  borderRadius: 14,
  padding: 6,
  width: 'fit-content',
};

const tabStyle = (active) => ({
  padding: '10px 28px',
  borderRadius: 10,
  border: 'none',
  fontWeight: 600,
  fontSize: 15,
  background: active ? '#FFFFFF' : 'transparent',
  color: active ? '#111827' : '#6B7280',
  cursor: 'pointer',
  boxShadow: active ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  whiteSpace: 'nowrap',
});

// ============================================================
//  КОНСТАНТЫ
// ============================================================
// ВАЖНО: TYPE='18' — технический дубликат '03'. В топ берём ТОЛЬКО '03'.
const ELEC_CATEGORY_TO_TYPE = {
  'Прошивка EOL NG': '03',
  'Прошивка ERA NG': '26',
  'Прошивка Запись/FLASH NG': '17',
};
const ELEC_ALL_CATEGORIES = Object.keys(ELEC_CATEGORY_TO_TYPE);
const ELEC_CATEGORY_COLORS = {
  'Прошивка EOL NG': '#EF4444',
  'Прошивка ERA NG': '#F59E0B',
  'Прошивка Запись/FLASH NG': '#8B5CF6',
};

// Без «неудачная прошивка блока» — только что за проверка + TYPE
const ELEC_CATEGORY_DESC = {
  'Агрегат по моделям': 'Сводные данные по всем трём категориям: EOL + ERA + FLASH. Общая картина по каждой модели.',
  'Прошивка EOL NG': 'Проверка прошивки в конце линии (End of Line). Тип проверки в системе — TYPE=03.',
  'Прошивка ERA NG': 'Прошивка блока ERA. Тип проверки в системе — TYPE=26.',
  'Прошивка Запись/FLASH NG': 'Запись / прошивка FLASH. Тип проверки в системе — TYPE=17.',
};

const AVAILABLE_MODELS = ['ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];
const AVAILABLE_GRADES = ['A', 'B', 'C'];
const AVAILABLE_POSTS = ['ROBOT', 'CP7', 'CP8', 'PIP', 'TL', 'REPAIR', 'TEST TRACK'];

// ============================================================
//  ХЕЛПЕРЫ
// ============================================================
const formatPeriodLabel = (period) => {
  if (!period) return '';
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [, m] = period.split('-');
    const monthNames = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
    return monthNames[parseInt(m, 10) - 1];
  }
  if (/^\d{4}-W\d{2}$/.test(period)) {
    const [, w] = period.split('-W');
    return `W${w}`;
  }
  const parts = period.split('-');
  if (parts.length === 3) {
    const [, m, d] = parts;
    return `${d}.${m}`;
  }
  return period;
};

const getPeriodRange = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  const first = formatPeriodLabel(arr[0].period);
  const last = formatPeriodLabel(arr[arr.length - 1].period);
  return first === last ? first : `${first} — ${last}`;
};

const calcVinNgShare = (vinNg, vinTotal) => {
  if (!vinTotal || vinTotal <= 0) return 0;
  return Number(((vinNg * 100) / vinTotal).toFixed(1));
};

// ============================================================
//  MULTISELECT
// ============================================================
function MultiSelect({ options, selected, onChange, placeholder, width = 120 }) {
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
      if (allSelected) onChange([]);
      else onChange(nonAllOptions);
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
          width,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
          cursor: 'pointer',
          textAlign: 'left',
          padding: '8px 10px',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: width - 40, fontSize: 13 }}>
          {displayText}
        </span>
        <span style={{ fontSize: 10, color: '#6B7280' }}>▼</span>
      </button>
      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          background: '#FFFFFF', borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 12,
          minWidth: 220, zIndex: 100, border: '1px solid #F0F0F5',
          maxHeight: 300, overflowY: 'auto',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
            <input type="checkbox" checked={allSelected} onChange={() => handleToggle('ALL')} />
            Все
          </label>
          {nonAllOptions.map(option => (
            <label key={option} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer', fontSize: 14 }}>
              <input type="checkbox" checked={selected.includes(option)} onChange={() => handleToggle(option)} />
              {option}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
//  ОСНОВНОЙ КОМПОНЕНТ
// ============================================================
export default function DefectElectronicsTopPage() {
  const [activeTab, setActiveTab] = useState('elec');
  const [showHelp, setShowHelp] = useState(false);

  // ─── Старый отчёт ───
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedModels, setSelectedModels] = useState([]);
  const [selectedGrades, setSelectedGrades] = useState([]);
  const [selectedPosts, setSelectedPosts] = useState(['ROBOT']);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedMppKey, setExpandedMppKey] = useState(null);
  const [vinData, setVinData] = useState([]);
  const [vinTopMpps, setVinTopMpps] = useState([]);
  const [vinLoading, setVinLoading] = useState(false);
  const [showVinDefectsModal, setShowVinDefectsModal] = useState(false);
  const [vinDefectsData, setVinDefectsData] = useState([]);
  const [vinDefectsLoading, setVinDefectsLoading] = useState(false);
  const [selectedVin, setSelectedVin] = useState('');
  const [topMppFilter, setTopMppFilter] = useState('all');
  const [trendModalOpen, setTrendModalOpen] = useState(false);
  const [trendData, setTrendData] = useState(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendMpp, setTrendMpp] = useState('');
  const [trendMetric, setTrendMetric] = useState('defects');

  // ─── Новый отчёт Elec top defect ───
  const [elecDateFrom, setElecDateFrom] = useState('');
  const [elecDateTo, setElecDateTo] = useState('');
  const [elecSelectedModels, setElecSelectedModels] = useState([]);
  const [elecSelectedCategories, setElecSelectedCategories] = useState([]);
  const [elecData, setElecData] = useState([]);
  const [elecLoading, setElecLoading] = useState(false);
  const [elecExpandedKey, setElecExpandedKey] = useState(null);
  const [elecVinData, setElecVinData] = useState([]);
  const [elecVinLoading, setElecVinLoading] = useState(false);

  // ============================================================
  //  ИНИЦИАЛИЗАЦИЯ ДАТ
  // ============================================================
  useEffect(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];
    setDateFrom(yStr);
    setDateTo(yStr);
    setElecDateFrom(yStr);
    setElecDateTo(yStr);
  }, []);

  // ============================================================
  //  СТАРЫЙ ОТЧЁТ
  // ============================================================
  useEffect(() => {
    if (activeTab === 'top' && dateFrom && dateTo) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, dateFrom, dateTo, selectedModels, selectedGrades, selectedPosts]);

  const loadData = async () => {
    setLoading(true);
    try {
      const modelsParam = (selectedModels.length === 0 || selectedModels.length === AVAILABLE_MODELS.length) ? 'ALL' : selectedModels.join(',');
      const gradesParam = (selectedGrades.length === 0 || selectedGrades.length === AVAILABLE_GRADES.length) ? 'ALL' : selectedGrades.join(',');
      const postsParam = (selectedPosts.length === 0 || selectedPosts.length === AVAILABLE_POSTS.length) ? 'ALL' : selectedPosts.join(',');

      const params = new URLSearchParams({
        dateFrom, dateTo,
        model: modelsParam,
        grades: gradesParam,
        posts: postsParam,
      });
      const res = await fetch(`${API_BASE}/api/drr-electronics-top-defects?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки данных');
      setData(await res.json());
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadVinsAndTopMpps = async (row, idx) => {
    const key = `${row.MPP}_${row.POST_NAME}_${idx}`;
    setExpandedMppKey(key);
    setVinLoading(true);
    setVinData([]);
    setVinTopMpps([]);
    try {
      const params = new URLSearchParams({
        partName: row.PART_NAME,
        problemType: row.PROBLEM_TYPE || '',
        model: row.MODEL,
        dateFrom,
        dateTo,
      });

      const vinsRes = await fetch(`${API_BASE}/api/drr-electronics-vins?${params.toString()}`);
      if (!vinsRes.ok) throw new Error('Ошибка загрузки VIN');
      setVinData(await vinsRes.json());

      const topMppRes = await fetch(`${API_BASE}/api/drr-electronics-vins-top-mpp?${params.toString()}`);
      if (!topMppRes.ok) throw new Error('Ошибка загрузки топ MPP');
      setVinTopMpps(await topMppRes.json());
    } catch (err) {
      alert(err.message);
      setVinData([]);
      setVinTopMpps([]);
    } finally {
      setVinLoading(false);
    }
  };

  const handleToggleMpp = (row, idx) => {
    const key = `${row.MPP}_${row.POST_NAME}_${idx}`;
    if (expandedMppKey === key) {
      setExpandedMppKey(null);
      setVinData([]);
      setVinTopMpps([]);
    } else {
      loadVinsAndTopMpps(row, idx);
    }
  };

  const exportVins = () => {
    if (vinData.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(vinData.map(v => ({ VIN: v.VIN, Модель: v.MODEL })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'VINs');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `VIN_${expandedMppKey}.xlsx`);
  };

  const exportFullReport = async () => {
    if (data.length === 0) return;
    setLoading(true);
    try {
      const wb = XLSX.utils.book_new();
      const summary = data.map(row => ({
        MPP: row.MPP,
        Модель: row.MODEL,
        'Кол-во авто': row.VIN_COUNT,
        'Кол-во дефектов': row.DEFECT_COUNT,
        'DPU per 1000': row.DPU,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Топ MPP');

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const params = new URLSearchParams({
          partName: row.PART_NAME,
          problemType: row.PROBLEM_TYPE || '',
          model: row.MODEL,
          dateFrom, dateTo,
        });

        const vinsRes = await fetch(`${API_BASE}/api/drr-electronics-vins?${params.toString()}`);
        if (vinsRes.ok) {
          const vins = await vinsRes.json();
          if (vins.length > 0) {
            XLSX.utils.book_append_sheet(
              wb,
              XLSX.utils.json_to_sheet(vins.map(v => ({ VIN: v.VIN, Модель: v.MODEL }))),
              `VIN_${i + 1}_${row.MPP.substring(0, 20)}`
            );
          }
        }

        const topMppRes = await fetch(`${API_BASE}/api/drr-electronics-vins-top-mpp?${params.toString()}`);
        if (topMppRes.ok) {
          const topMpps = await topMppRes.json();
          if (topMpps.length > 0) {
            XLSX.utils.book_append_sheet(
              wb,
              XLSX.utils.json_to_sheet(topMpps.map(m => ({
                MPP: m.MPP,
                Модель: m.MODEL,
                'Кол-во': m.DEFECT_COUNT,
                'Онлайн/Оффлайн': m.IS_OFFLINE,
              }))),
              `TopMPP_${i + 1}_${row.MPP.substring(0, 15)}`
            );
          }
        }
      }

      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([buf], { type: 'application/octet-stream' }), 'Топ_дефектов_электроники_полный.xlsx');
    } catch (err) {
      alert('Ошибка при экспорте: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const openTrend = async (row) => {
    setTrendMpp(row.MPP);
    setTrendModalOpen(true);
    setTrendLoading(true);
    try {
      const fetchTrend = (periodType) => {
        const params = new URLSearchParams({
          partName: row.PART_NAME,
          problemType: row.PROBLEM_TYPE || '',
          model: row.MODEL,
          postName: row.POST_NAME,
          periodType,
        });
        return fetch(`${API_BASE}/api/drr-electronics-defect-trend?${params.toString()}`).then(r => r.json());
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

  const prepareDisplayData = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr.map(d => ({
      period: d.period,
      value: trendMetric === 'dpu'
        ? (d.total_cars > 0 ? Number(((d.defect_count * 1000) / d.total_cars).toFixed(2)) : 0)
        : d.defect_count,
    }));
  };

  const filteredTopMpps = vinTopMpps.filter(mpp => {
    if (topMppFilter === 'offline') return mpp.IS_OFFLINE === 'Оффлайн';
    if (topMppFilter === 'online') return mpp.IS_OFFLINE === 'Онлайн';
    return true;
  });

  const loadVinDefects = async (vin) => {
    setSelectedVin(vin);
    setShowVinDefectsModal(true);
    setVinDefectsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/drr-electronics-vin-defects?vin=${encodeURIComponent(vin)}`);
      if (!res.ok) throw new Error('Ошибка загрузки дефектов VIN');
      setVinDefectsData(await res.json());
    } catch (err) {
      alert(err.message);
      setVinDefectsData([]);
    } finally {
      setVinDefectsLoading(false);
    }
  };

  // ============================================================
  //  ELE TOP DEFECT
  // ============================================================
  useEffect(() => {
    if (activeTab === 'elec' && elecDateFrom && elecDateTo) loadElecData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, elecDateFrom, elecDateTo, elecSelectedModels, elecSelectedCategories]);

  const loadElecData = async () => {
    setElecLoading(true);
    try {
      const modelsParam = (!elecSelectedModels.length || elecSelectedModels.length === AVAILABLE_MODELS.length)
        ? 'ALL' : elecSelectedModels.join(',');
      const catsParam = (!elecSelectedCategories.length || elecSelectedCategories.length === ELEC_ALL_CATEGORIES.length)
        ? 'ALL' : elecSelectedCategories.join(',');

      const params = new URLSearchParams({
        dateFrom: elecDateFrom,
        dateTo: elecDateTo,
        models: modelsParam,
        categories: catsParam,
      });
      const res = await fetch(`${API_BASE}/api/drr-electronics-top-elec-defects?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки данных');
      setElecData(await res.json());
    } catch (err) {
      alert(err.message);
      setElecData([]);
    } finally {
      setElecLoading(false);
    }
  };

  const loadElecVins = async (row) => {
    const key = `${row.CATEGORY}__${row.MODEL}`;
    setElecExpandedKey(key);
    setElecVinLoading(true);
    setElecVinData([]);
    try {
      const typeCode = ELEC_CATEGORY_TO_TYPE[row.CATEGORY];
      const params = new URLSearchParams({
        model: row.MODEL,
        dateFrom: elecDateFrom,
        dateTo: elecDateTo,
      });
      params.set('typeCode', typeCode || 'ALL');

      const res = await fetch(`${API_BASE}/api/drr-electronics-elec-vins?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки VIN');
      setElecVinData(await res.json());
    } catch (err) {
      alert(err.message);
      setElecVinData([]);
    } finally {
      setElecVinLoading(false);
    }
  };

  const handleElecToggle = (row) => {
    const key = `${row.CATEGORY}__${row.MODEL}`;
    if (elecExpandedKey === key) {
      setElecExpandedKey(null);
      setElecVinData([]);
    } else {
      loadElecVins(row);
    }
  };

  const openElecTrend = async (row) => {
    setTrendMpp(`${row.CATEGORY} — ${row.MODEL}`);
    setTrendModalOpen(true);
    setTrendLoading(true);
    try {
      const typeCode = ELEC_CATEGORY_TO_TYPE[row.CATEGORY]
        || Object.values(ELEC_CATEGORY_TO_TYPE).join(',');

      const fetchTrend = (periodType) => {
        const p = new URLSearchParams({ typeCode, model: row.MODEL, periodType });
        return fetch(`${API_BASE}/api/drr-electronics-elec-defect-trend?${p.toString()}`).then(r => r.json());
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

  const exportElecReport = () => {
    if (!elecData.length) return;
    const wb = XLSX.utils.book_new();

    const ws = XLSX.utils.json_to_sheet(elecData.map(r => {
      const vinShare = calcVinNgShare(r.VIN_COUNT, r.VIN_TOTAL_COUNT);
      return {
        Категория: r.CATEGORY,
        Модель: r.MODEL,
        'Дефектов NG': r.DEFECT_COUNT,
        'VIN с NG': r.VIN_COUNT,
        'VIN всего': r.VIN_TOTAL_COUNT,
        'VIN % NG': vinShare,
        'OK': r.OK_COUNT,
        'Всего проверок': r.TOTAL_COUNT,
        '% NG попыток': r.NG_SHARE,
        'DPU per 1000': r.TOTAL_COUNT > 0 ? Number(((r.DEFECT_COUNT * 1000) / r.TOTAL_COUNT).toFixed(2)) : 0,
      };
    }));
    XLSX.utils.book_append_sheet(wb, ws, 'Elec top defect');

    const summary = ELEC_ALL_CATEGORIES.map(cat => {
      const rows = elecData.filter(r => r.CATEGORY === cat);
      const ng = rows.reduce((s, r) => s + r.DEFECT_COUNT, 0);
      const ok = rows.reduce((s, r) => s + r.OK_COUNT, 0);
      const total = ng + ok;
      return {
        Категория: cat,
        NG: ng,
        OK: ok,
        Всего: total,
        '% NG': total > 0 ? Number((ng * 100 / total).toFixed(1)) : 0,
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Сводка NG-OK');

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), 'Elec_top_defect.xlsx');
  };

  // ─── Группировка Elec ───
  const elecGrouped = [];
  const seenCats = new Set();
  elecData.forEach(r => {
    if (!seenCats.has(r.CATEGORY)) {
      seenCats.add(r.CATEGORY);
      elecGrouped.push({ category: r.CATEGORY, rows: [] });
    }
    elecGrouped[elecGrouped.length - 1].rows.push(r);
  });

  const elecOkNgSummary = ELEC_ALL_CATEGORIES.map(cat => {
    const rows = elecData.filter(r => r.CATEGORY === cat);
    const ng = rows.reduce((s, r) => s + r.DEFECT_COUNT, 0);
    const ok = rows.reduce((s, r) => s + r.OK_COUNT, 0);
    const total = ng + ok;
    return {
      category: cat,
      NG: ng,
      OK: ok,
      total,
      ngShare: total > 0 ? Number((ng * 100 / total).toFixed(1)) : 0,
    };
  });

  const elecTotals = elecOkNgSummary.reduce(
    (acc, c) => ({ NG: acc.NG + c.NG, OK: acc.OK + c.OK, total: acc.total + c.total }),
    { NG: 0, OK: 0, total: 0 }
  );
  const elecTotalNgShare = elecTotals.total > 0
    ? Number((elecTotals.NG * 100 / elecTotals.total).toFixed(1))
    : 0;

  // ============================================================
  //  РЕНДЕР
  // ============================================================
  return (
    <div style={{ padding: 30, fontFamily: 'Inter, Segoe UI, Arial, sans-serif', maxWidth: 1300, margin: '0 auto' }}>
      <h1 style={{ color: '#111827', fontSize: 28, fontWeight: 800, marginBottom: 20 }}>
        Отчёт по дефектам электроники
      </h1>

      {/* ─── Табы ─── */}
      <div style={tabBarStyle}>
        <button onClick={() => setActiveTab('elec')} style={tabStyle(activeTab === 'elec')}>
          ⚡ Elec top defect
        </button>
        <button onClick={() => setActiveTab('top')} style={tabStyle(activeTab === 'top')}>
          📊 Топ дефектов электроники
        </button>
      </div>

      {/* ============================================================
          ТАБ 1: ELE TOP DEFECT
      ============================================================ */}
      {activeTab === 'elec' && (
        <>
          <div style={cardStyle}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, whiteSpace: 'nowrap' }}>
                Начало:
                <input type="date" value={elecDateFrom} onChange={e => setElecDateFrom(e.target.value)} style={inputStyle} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, whiteSpace: 'nowrap' }}>
                Конец:
                <input type="date" value={elecDateTo} onChange={e => setElecDateTo(e.target.value)} style={inputStyle} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, whiteSpace: 'nowrap' }}>
                Модели:
                <MultiSelect
                  options={['ALL', ...AVAILABLE_MODELS]}
                  selected={elecSelectedModels}
                  onChange={setElecSelectedModels}
                  placeholder="Все"
                  width={140}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, whiteSpace: 'nowrap' }}>
                Категории:
                <MultiSelect
                  options={['ALL', ...ELEC_ALL_CATEGORIES]}
                  selected={elecSelectedCategories}
                  onChange={setElecSelectedCategories}
                  placeholder="Все"
                  width={210}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap', flexShrink: 0 }}>
                <button onClick={loadElecData} disabled={elecLoading} style={buttonStyle}>
                  {elecLoading ? '⏳ Загрузка...' : '▶ Загрузить'}
                </button>
                <button onClick={exportElecReport} disabled={elecData.length === 0 || elecLoading} style={{ ...buttonStyle, background: '#059669' }}>
                  📊 Экспорт
                </button>
              </div>
            </div>
          </div>

          {/* KPI + График NG/OK */}
          <div style={cardStyle}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 16, color: '#1F2937' }}>
              Доля NG / OK по категориям
            </h2>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
              <div style={{ flex: '1 1 220px', padding: 16, borderRadius: 12, background: '#FEF2F2', border: '1px solid #FECACA' }}>
                <div style={{ fontSize: 13, color: '#991B1B', fontWeight: 600, marginBottom: 4 }}>Дефекты NG (всего)</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: '#DC2626' }}>{elecTotals.NG.toLocaleString()}</div>
              </div>
              <div style={{ flex: '1 1 220px', padding: 16, borderRadius: 12, background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                <div style={{ fontSize: 13, color: '#166534', fontWeight: 600, marginBottom: 4 }}>Успешные OK (всего)</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: '#16A34A' }}>{elecTotals.OK.toLocaleString()}</div>
              </div>
              <div style={{ flex: '1 1 220px', padding: 16, borderRadius: 12, background: '#FEF2F2', border: '1px solid #FECACA' }}>
                <div style={{ fontSize: 13, color: '#991B1B', fontWeight: 600, marginBottom: 4 }}>Общий % NG</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: '#DC2626' }}>{elecTotalNgShare}%</div>
              </div>
            </div>

            {/* Stacked bar по категориям */}
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                layout="vertical"
                data={elecOkNgSummary}
                margin={{ top: 10, right: 80, left: 20, bottom: 10 }}
                barCategoryGap={20}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" tick={{ fontSize: 12, fill: '#374151' }} />
                <YAxis
                  type="category"
                  dataKey="category"
                  width={180}
                  tick={{ fontSize: 13, fill: '#1F2937', fontWeight: 600 }}
                />
                <Tooltip
                  formatter={(value, name) => [Number(value).toLocaleString(), name]}
                  contentStyle={{ borderRadius: 10, border: '1px solid #E5E7EB', fontSize: 13 }}
                />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Bar dataKey="NG" stackId="a" fill="#EF4444" name="NG">
                  <LabelList dataKey="NG" position="inside" style={{ fontSize: 12, fill: '#fff', fontWeight: 700 }} />
                </Bar>
                <Bar
                  dataKey="OK"
                  stackId="a"
                  fill="#10B981"
                  name="OK"
                  label={({ x, y, width, height, index }) => {
                    if (index == null) return null;
                    const total = elecOkNgSummary[index]?.total;
                    if (!total) return null;
                    return (
                      <text
                        x={x + width + 10}
                        y={y + height / 2}
                        dy={5}
                        textAnchor="start"
                        style={{ fontSize: 14, fontWeight: 800, fill: '#111827' }}
                      >
                        {total.toLocaleString()}
                      </text>
                    );
                  }}
                >
                  <LabelList dataKey="OK" position="inside" style={{ fontSize: 12, fill: '#fff', fontWeight: 700 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Donut NG/OK + таблица-легенда */}
            <div style={{ display: 'flex', gap: 32, marginTop: 24, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', width: 320, height: 320, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'OK', value: elecTotals.OK },
                        { name: 'NG', value: elecTotals.NG },
                      ]}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius="72%"
                      outerRadius="98%"
                      paddingAngle={3}
                      stroke="#FFFFFF"
                      strokeWidth={4}
                      startAngle={90}
                      endAngle={-270}
                    >
                      <Cell fill="#10B981" />
                      <Cell fill="#EF4444" />
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [
                        Number(value).toLocaleString(),
                        name === 'NG' ? 'NG' : 'OK',
                      ]}
                      contentStyle={{ fontSize: 14, borderRadius: 12, border: '1px solid #E5E7EB' }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  pointerEvents: 'none',
                  width: '60%',
                }}>
                  <div style={{
                    fontSize: 13, fontWeight: 700, color: '#64748B',
                    letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4,
                  }}>
                    % NG
                  </div>
                  <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1, color: '#DC2626' }}>
                    {elecTotalNgShare}%
                  </div>
                  <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6, fontWeight: 600 }}>
                    всего {elecTotals.total.toLocaleString()}
                  </div>
                </div>
              </div>

              <div style={{ flex: '1 1 320px', minWidth: 300 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ backgroundColor: '#F9FAFB' }}>
                      <th style={thStyle}>Категория</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>NG</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>OK</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>% NG</th>
                    </tr>
                  </thead>
                  <tbody>
                    {elecOkNgSummary.map(s => (
                      <tr key={s.category}>
                        <td style={{ ...tdStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{
                            display: 'inline-block', width: 10, height: 10,
                            borderRadius: '50%', background: ELEC_CATEGORY_COLORS[s.category] || '#999',
                          }} />
                          {s.category}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: '#DC2626' }}>{s.NG.toLocaleString()}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: '#16A34A' }}>{s.OK.toLocaleString()}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#DC2626' }}>{s.ngShare}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ backgroundColor: '#F3F4F6', borderTop: '2px solid #D1D5DB' }}>
                      <td style={{ ...tdStyle, fontWeight: 800, color: '#111827' }}>Всего</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#DC2626' }}>{elecTotals.NG.toLocaleString()}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#16A34A' }}>{elecTotals.OK.toLocaleString()}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#DC2626' }}>{elecTotalNgShare}%</td>
                    </tr>
                  </tfoot>
                </table>

                <div style={{ display: 'flex', gap: 20, marginTop: 16, fontSize: 13, color: '#475569' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#10B981' }} />
                    OK — {elecTotals.OK.toLocaleString()}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#EF4444' }} />
                    NG — {elecTotals.NG.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Таблицы по категориям */}
          <div style={cardStyle}>
            {/* Кнопка-тоггл для пояснения */}
            <button
              onClick={() => setShowHelp(!showHelp)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                marginBottom: showHelp ? 14 : 24,
                background: showHelp ? '#DBEAFE' : '#F1F5F9',
                color: showHelp ? '#1E40AF' : '#475569',
                border: 'none',
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <span style={{
                display: 'inline-block',
                transition: 'transform 0.2s',
                transform: showHelp ? 'rotate(90deg)' : 'rotate(0)',
                fontSize: 11,
              }}>▶</span>
              ℹ️ Как читать отчёт
            </button>

            {/* Пояснение (раскрывается) */}
            {showHelp && (
              <div style={{
                padding: '14px 18px',
                background: '#EFF6FF',
                borderLeft: '4px solid #2563EB',
                borderRadius: 8,
                marginBottom: 24,
                fontSize: 13,
                color: '#1E3A8A',
                lineHeight: 1.6,
              }}>
                <div style={{ marginBottom: 4 }}>
                  Каждая строка таблицы — это <b>одна модель</b> в рамках <b>одной категории проверки</b>.
                </div>
                <div style={{ fontWeight: 700, marginTop: 12, marginBottom: 4, color: '#1E3A8A' }}>
                  Блок «ПОПЫТКИ ПРОВЕРКИ»
                </div>
                <ul style={{ margin: '0 0 0 20px', padding: 0 }}>
                  <li>Сколько раз запускалась проверка: <span style={{ color: '#DC2626', fontWeight: 600 }}>NG</span> (неуспех), <span style={{ color: '#16A34A', fontWeight: 600 }}>OK</span> (успех), <b>Всего</b>.</li>
                  <li><b>% NG</b> = NG / Всего × 100% — доля неудачных <i>попыток</i>.</li>
                  <li>Один автомобиль может проходить проверку несколько раз (перепрошивка, retry) — поэтому попыток обычно больше, чем машин.</li>
                </ul>
                <div style={{ fontWeight: 700, marginTop: 12, marginBottom: 4, color: '#166534' }}>
                  Блок «УНИКАЛЬНЫЕ VIN»
                </div>
                <ul style={{ margin: '0 0 0 20px', padding: 0 }}>
                  <li><b>VIN с NG</b> — сколько <i>разных машин</i> имели хотя бы одну неудачу.</li>
                  <li><b>VIN всего</b> — все машины, прошедшие проверку.</li>
                  <li><b>VIN % NG</b> = VIN с NG / VIN всего × 100% — доля <i>машин</i> с дефектом (может отличаться от % NG попыток).</li>
                </ul>
                <div style={{ fontWeight: 700, marginTop: 12, marginBottom: 4, color: '#1E3A8A' }}>
                  DPU / 1000
                </div>
                <div>Сколько NG приходится на 1000 проверок — «плотность» дефектов. Чем выше, тем чаще сбой.</div>
              </div>
            )}

            {elecLoading && <p style={{ textAlign: 'center', color: '#6B7280' }}>Загрузка...</p>}
            {!elecLoading && elecGrouped.length === 0 && (
              <p style={{ textAlign: 'center', color: '#6B7280', padding: 20 }}>Нет данных</p>
            )}

            {elecGrouped.map(group => (
              <div key={group.category} style={{ marginBottom: 36 }}>
                <h3 style={{
                  fontSize: 17, fontWeight: 700, color: '#1F2937',
                  margin: '0 0 4px', paddingBottom: 6,
                  borderBottom: `2px solid ${ELEC_CATEGORY_COLORS[group.category] || '#2563EB'}`,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{
                    display: 'inline-block', width: 12, height: 12,
                    borderRadius: '50%', background: ELEC_CATEGORY_COLORS[group.category] || '#999',
                  }} />
                  {group.category}
                </h3>
                {ELEC_CATEGORY_DESC[group.category] && (
                  <div style={{ fontSize: 13, color: '#64748B', marginBottom: 14, lineHeight: 1.5 }}>
                    {ELEC_CATEGORY_DESC[group.category]}
                  </div>
                )}

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ backgroundColor: '#F9FAFB' }}>
                        <th rowSpan={2} style={{ ...thStyle, verticalAlign: 'bottom' }}>Модель</th>
                        <th colSpan={4} style={{
                          ...thStyle, textAlign: 'center',
                          background: '#EEF2FF', color: '#1E40AF',
                          borderBottom: '1px solid #C7D2FE', fontSize: 12, letterSpacing: '0.5px',
                        }}>
                          ПОПЫТКИ ПРОВЕРКИ
                        </th>
                        <th colSpan={3} style={{
                          ...thStyle, textAlign: 'center',
                          background: '#F0FDF4', color: '#166534',
                          borderBottom: '1px solid #BBF7D0', fontSize: 12, letterSpacing: '0.5px',
                        }}>
                          УНИКАЛЬНЫЕ VIN
                        </th>
                        <th rowSpan={2} style={{ ...thStyle, textAlign: 'center', verticalAlign: 'bottom' }}>DPU / 1000</th>
                        <th rowSpan={2} style={{ ...thStyle, verticalAlign: 'bottom' }}></th>
                      </tr>
                      <tr style={{ backgroundColor: '#F9FAFB' }}>
                        <th style={{ ...thStyle, textAlign: 'center', background: '#EEF2FF', color: '#DC2626' }}>NG</th>
                        <th style={{ ...thStyle, textAlign: 'center', background: '#EEF2FF', color: '#16A34A' }}>OK</th>
                        <th style={{ ...thStyle, textAlign: 'center', background: '#EEF2FF', color: '#1E40AF' }}>Всего</th>
                        <th style={{ ...thStyle, textAlign: 'center', background: '#EEF2FF', color: '#1E40AF', minWidth: 140 }}>% NG</th>
                        <th style={{ ...thStyle, textAlign: 'center', background: '#F0FDF4', color: '#166534' }}>VIN с NG</th>
                        <th style={{ ...thStyle, textAlign: 'center', background: '#F0FDF4', color: '#166534' }}>VIN всего</th>
                        <th style={{ ...thStyle, textAlign: 'center', background: '#F0FDF4', color: '#166534', minWidth: 140 }}>VIN % NG</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row, idx) => {
                        const key = `${row.CATEGORY}__${row.MODEL}`;
                        const dpu = row.TOTAL_COUNT > 0
                          ? ((row.DEFECT_COUNT * 1000) / row.TOTAL_COUNT).toFixed(1)
                          : '—';
                        const vinShare = calcVinNgShare(row.VIN_COUNT, row.VIN_TOTAL_COUNT);
                        return (
                          <React.Fragment key={key}>
                            <tr style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                              <td style={{ ...tdStyle, fontWeight: 600 }}>{row.MODEL}</td>
                              <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700, color: '#DC2626' }}>{row.DEFECT_COUNT}</td>
                              <td style={{ ...tdStyle, textAlign: 'center', color: '#16A34A', fontWeight: 600 }}>{row.OK_COUNT}</td>
                              <td style={{ ...tdStyle, textAlign: 'center', color: '#6B7280' }}>{row.TOTAL_COUNT}</td>

                              {/* % NG попыток */}
                              <td style={{ ...tdStyle, minWidth: 140 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ flex: 1, height: 6, background: '#F1F5F9', borderRadius: 3, overflow: 'hidden', minWidth: 50 }}>
                                    <div style={{
                                      width: `${Math.min(100, row.NG_SHARE)}%`,
                                      height: '100%',
                                      background: '#DC2626',
                                      transition: 'width 0.3s ease',
                                    }} />
                                  </div>
                                  <span style={{ fontWeight: 700, minWidth: 46, textAlign: 'right', color: '#DC2626', fontSize: 13 }}>
                                    {row.NG_SHARE}%
                                  </span>
                                </div>
                              </td>

                              <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>{row.VIN_COUNT}</td>
                              <td style={{ ...tdStyle, textAlign: 'center', color: '#6B7280' }}>{row.VIN_TOTAL_COUNT}</td>

                              {/* VIN % NG — новый столбец */}
                              <td style={{ ...tdStyle, minWidth: 140 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ flex: 1, height: 6, background: '#F1F5F9', borderRadius: 3, overflow: 'hidden', minWidth: 50 }}>
                                    <div style={{
                                      width: `${Math.min(100, vinShare)}%`,
                                      height: '100%',
                                      background: '#DC2626',
                                      transition: 'width 0.3s ease',
                                    }} />
                                  </div>
                                  <span style={{ fontWeight: 700, minWidth: 46, textAlign: 'right', color: '#DC2626', fontSize: 13 }}>
                                    {vinShare}%
                                  </span>
                                </div>
                              </td>

                              <td style={{ ...tdStyle, textAlign: 'center' }}>{dpu}</td>
                              <td style={tdStyle}>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button
                                    onClick={() => openElecTrend(row)}
                                    title="Динамика"
                                    style={{ ...buttonStyle, background: '#8B5CF6', padding: '4px 10px', fontSize: 12 }}
                                  >📈</button>
                                  <button
                                    onClick={() => handleElecToggle(row)}
                                    style={{ ...buttonStyle, background: '#6B7280', padding: '4px 10px', fontSize: 12 }}
                                  >
                                    {elecExpandedKey === key ? 'Скрыть VIN' : 'VIN'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {elecExpandedKey === key && (
                              <tr>
                                <td colSpan={10} style={{ padding: 0 }}>
                                  <div style={{ padding: 12, backgroundColor: '#F3F4F6', borderRadius: 8, margin: '8px 0' }}>
                                    {elecVinLoading ? (
                                      <p style={{ margin: 0 }}>Загрузка VIN...</p>
                                    ) : (
                                      <>
                                        <div style={{ fontWeight: 600, marginBottom: 8 }}>
                                          VIN с NG ({elecVinData.length} шт.)
                                        </div>
                                        <div style={{ maxHeight: 300, overflowY: 'auto', background: '#FFF', borderRadius: 8 }}>
                                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                            <thead>
                                              <tr style={{ backgroundColor: '#E5E7EB' }}>
                                                <th style={thStyle}>VIN</th>
                                                <th style={thStyle}>Модель</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {elecVinData.map((v, i) => (
                                                <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                                                  <td
                                                    onClick={() => loadVinDefects(v.VIN)}
                                                    style={{ ...tdStyle, cursor: 'pointer', color: '#2563EB', textDecoration: 'underline' }}
                                                  >{v.VIN}</td>
                                                  <td style={tdStyle}>{v.MODEL}</td>
                                                </tr>
                                              ))}
                                              {!elecVinData.length && (
                                                <tr>
                                                  <td colSpan={2} style={{ ...tdStyle, textAlign: 'center', color: '#6B7280' }}>
                                                    Нет VIN с NG
                                                  </td>
                                                </tr>
                                              )}
                                            </tbody>
                                          </table>
                                        </div>
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
              </div>
            ))}
          </div>
        </>
      )}

      {/* ============================================================
          ТАБ 2: СТАРЫЙ ТОП ДЕФЕКТОВ
      ============================================================ */}
      {activeTab === 'top' && (
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
              Модели:
              <MultiSelect options={['ALL', ...AVAILABLE_MODELS]} selected={selectedModels} onChange={setSelectedModels} placeholder="Все" />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, whiteSpace: 'nowrap' }}>
              Классы:
              <MultiSelect options={['ALL', ...AVAILABLE_GRADES]} selected={selectedGrades} onChange={setSelectedGrades} placeholder="Все" />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500, whiteSpace: 'nowrap' }}>
              Посты:
              <MultiSelect options={['ALL', ...AVAILABLE_POSTS]} selected={selectedPosts} onChange={setSelectedPosts} placeholder="Все" />
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
                    <th style={thStyle}>MPP</th>
                    <th style={thStyle}>Модель</th>
                    <th style={thStyle}>Кол-во авто</th>
                    <th style={thStyle}>Кол-во дефектов</th>
                    <th style={thStyle}>DPU per 1000</th>
                    <th style={thStyle}>Пост внесения</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, idx) => (
                    <React.Fragment key={`${row.MPP}_${row.POST_NAME}_${idx}`}>
                      <tr style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                        <td style={tdStyle}>{row.MPP}</td>
                        <td style={{ ...tdStyle, fontSize: '10px' }}>{row.MODEL}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{row.VIN_COUNT}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{row.DEFECT_COUNT}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{row.DPU}</td>
                        <td style={tdStyle}>{row.POST_NAME}</td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <button onClick={() => openTrend(row)} title="Динамика дефекта"
                              style={{ ...buttonStyle, background: '#8B5CF6', padding: '4px 10px', fontSize: 12 }}>📈</button>
                            <button onClick={() => handleToggleMpp(row, idx)}
                              style={{ ...buttonStyle, background: '#6B7280', padding: '4px 10px', fontSize: 12 }}>
                              {expandedMppKey === `${row.MPP}_${row.POST_NAME}_${idx}` ? 'Скрыть VIN' : 'VIN'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedMppKey === `${row.MPP}_${row.POST_NAME}_${idx}` && (
                        <tr>
                          <td colSpan={7} style={{ padding: 0 }}>
                            <div style={{ padding: 12, backgroundColor: '#F3F4F6', borderRadius: 8, margin: '8px 0' }}>
                              {vinLoading ? (
                                <p>Загрузка VIN...</p>
                              ) : (
                                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                                  <div style={{ flex: '0 0 50%', maxWidth: '50%' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                      <span style={{ fontWeight: 600 }}>VIN для "{row.MPP}" ({vinData.length} шт.)</span>
                                      <button onClick={exportVins} style={{ ...buttonStyle, background: '#059669', padding: '4px 10px', fontSize: 12 }}>📊 Экспорт VIN</button>
                                    </div>
                                    <div style={{ overflowX: 'auto' }}>
                                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, margin: '0 auto' }}>
                                        <thead>
                                          <tr style={{ backgroundColor: '#E5E7EB' }}>
                                            <th style={thStyle}>VIN</th>
                                            <th style={thStyle}>Модель</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {vinData.map((v, i) => (
                                            <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                                              <td onClick={() => loadVinDefects(v.VIN)}
                                                style={{ ...tdStyle, cursor: 'pointer', color: '#2563EB', textDecoration: 'underline' }}>
                                                {v.VIN}
                                              </td>
                                              <td style={tdStyle}>{v.MODEL}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                  <div style={{ flex: '0 0 50%', maxWidth: '50%' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                      <span style={{ fontWeight: 600 }}>Топ MPP для этих VIN</span>
                                      <select value={topMppFilter} onChange={(e) => setTopMppFilter(e.target.value)}
                                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12 }}>
                                        <option value="all">Все</option>
                                        <option value="offline">Оффлайн</option>
                                        <option value="online">Онлайн</option>
                                      </select>
                                    </div>
                                    <div style={{ overflowX: 'auto' }}>
                                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, margin: '0 auto', tableLayout: 'fixed' }}>
                                        <thead>
                                          <tr style={{ backgroundColor: '#E5E7EB' }}>
                                            <th style={{ ...thStyle, width: '55%', whiteSpace: 'normal', wordBreak: 'break-word' }}>MPP</th>
                                            <th style={{ ...thStyle, width: '20%' }}>Модель</th>
                                            <th style={{ ...thStyle, width: '10%' }}>Кол-во</th>
                                            <th style={{ ...thStyle, width: '15%' }}>Тип</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {filteredTopMpps.map((mpp, i) => (
                                            <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                                              <td style={{ ...tdStyle, whiteSpace: 'normal', wordBreak: 'break-word' }}>{mpp.MPP}</td>
                                              <td style={tdStyle}>{mpp.MODEL}</td>
                                              <td style={{ ...tdStyle, textAlign: 'center' }}>{mpp.DEFECT_COUNT}</td>
                                              <td style={tdStyle}>{mpp.IS_OFFLINE}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && data.length === 0 && (
            <p style={{ textAlign: 'center', color: '#6B7280', padding: 20 }}>Нет данных</p>
          )}
        </div>
      )}

      {/* ============================================================
          МОДАЛКА: ДЕФЕКТЫ VIN
      ============================================================ */}
      {showVinDefectsModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2000,
        }} onClick={() => setShowVinDefectsModal(false)}>
          <div style={{
            backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24,
            width: '90%', maxWidth: 700, maxHeight: '80vh',
            display: 'flex', flexDirection: 'column',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                Дефекты VIN: {selectedVin}
              </h3>
              <button onClick={() => setShowVinDefectsModal(false)} style={{ border: 'none', background: 'none', fontSize: 24, cursor: 'pointer' }}>×</button>
            </div>
            {vinDefectsLoading ? (
              <p>Загрузка...</p>
            ) : (
              <div style={{ overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ backgroundColor: '#F9FAFB' }}>
                      <th style={thStyle}>MPP</th>
                      <th style={thStyle}>Модель</th>
                      <th style={thStyle}>Кол-во</th>
                      <th style={thStyle}>Онлайн/Оффлайн</th>
                      <th style={thStyle}>Комментарий</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vinDefectsData.map((d, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                        <td style={tdStyle}>{d.MPP}</td>
                        <td style={tdStyle}>{d.MODEL}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{d.DEFECT_COUNT}</td>
                        <td style={tdStyle}>{d.IS_OFFLINE}</td>
                        <td style={tdStyle}>{d.COMMENT}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================
          МОДАЛКА: ТРЕНД
      ============================================================ */}
      {trendModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2500,
        }} onClick={() => setTrendModalOpen(false)}>
          <div style={{
            backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24,
            width: '96%', maxWidth: 1600, maxHeight: '95vh',
            overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1F2937' }}>
                Динамика: {trendMpp}
              </h3>
              <button onClick={() => setTrendModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#6B7280' }}>✕</button>
            </div>

            <div style={{
              padding: '10px 14px',
              background: '#FEF3C7',
              borderLeft: '4px solid #F59E0B',
              borderRadius: 8,
              fontSize: 13,
              color: '#92400E',
              marginBottom: 16,
              lineHeight: 1.5,
            }}>
              ⓘ <b>Периоды тренда не зависят от фильтра таблицы.</b>{' '}
              Каждый график показывает последние N периодов от текущей даты.
              <div style={{ marginTop: 6, fontSize: 12, color: '#78350F' }}>
                Фильтр таблицы:{' '}
                <b>{activeTab === 'elec' ? elecDateFrom : dateFrom}</b> — <b>{activeTab === 'elec' ? elecDateTo : dateTo}</b>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <button onClick={() => setTrendMetric('defects')} style={{
                padding: '8px 16px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                background: trendMetric === 'defects' ? '#2563EB' : '#E5E7EB',
                color: trendMetric === 'defects' ? '#FFFFFF' : '#374151',
              }}>Шт. дефектов</button>
              <button onClick={() => setTrendMetric('dpu')} style={{
                padding: '8px 16px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                background: trendMetric === 'dpu' ? '#2563EB' : '#E5E7EB',
                color: trendMetric === 'dpu' ? '#FFFFFF' : '#374151',
              }}>DPU per 1000</button>
            </div>

            {trendLoading ? (
              <p>Загрузка...</p>
            ) : (
              trendData && (
                <div style={{ display: 'flex', flexDirection: 'row', gap: 20, flexWrap: 'nowrap' }}>
                  <div style={{ flex: '1 1 0', minWidth: 250 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>Последние 3 месяца</h4>
                    <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>
                      {getPeriodRange(trendData.month)}
                    </div>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={prepareDisplayData(trendData.month)} margin={{ top: 30, right: 10, left: 0, bottom: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="period" tick={{ fontSize: 12, fill: '#1F2937' }}
                          tickFormatter={(val) => formatPeriodLabel(val)} />
                        <YAxis tick={{ fontSize: 12, fill: '#1F2937' }} allowDecimals={trendMetric === 'dpu'} />
                        <Bar dataKey="value" fill="#3B82F6" radius={[4, 4, 0, 0]}>
                          <LabelList dataKey="value" position="top" style={{ fontSize: 14, fill: '#1F2937', fontWeight: 700 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div style={{ flex: '1 1 0', minWidth: 250 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>Последние 4 недели</h4>
                    <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>
                      {getPeriodRange(trendData.week)}
                    </div>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={prepareDisplayData(trendData.week)} margin={{ top: 30, right: 10, left: 0, bottom: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="period" tick={{ fontSize: 12, fill: '#1F2937' }}
                          tickFormatter={(val) => formatPeriodLabel(val)} />
                        <YAxis tick={{ fontSize: 12, fill: '#1F2937' }} allowDecimals={trendMetric === 'dpu'} />
                        <Bar dataKey="value" fill="#F59E0B" radius={[4, 4, 0, 0]}>
                          <LabelList dataKey="value" position="top" style={{ fontSize: 14, fill: '#1F2937', fontWeight: 700 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div style={{ flex: '2 1 0', minWidth: 350 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>Последние 14 дней</h4>
                    <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>
                      {getPeriodRange(trendData.day)}
                    </div>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={prepareDisplayData(trendData.day)} margin={{ top: 30, right: 10, left: 0, bottom: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="period" interval={0} tick={{ fontSize: 11, fill: '#1F2937' }}
                          tickFormatter={(val) => formatPeriodLabel(val)} />
                        <YAxis tick={{ fontSize: 12, fill: '#1F2937' }} allowDecimals={trendMetric === 'dpu'} />
                        <Bar dataKey="value" fill="#10B981" radius={[4, 4, 0, 0]}>
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