import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ReferenceLine, Label, ResponsiveContainer, Cell,
  PieChart, Pie, Tooltip, LabelList
} from 'recharts';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const API_BASE = '';

const modelColors = {
  'ESTEO MX': '#F59E0B',
  'JELAND J6': '#6EE7B7',
  'JELAND J7': '#8B5CF6',
  'TENET A8': '#3B82F6',
  'JELAND J8': '#EC4899',
};

const modelShortNames = {
  'ESTEO MX': 'MX',
  'JELAND J6': 'J6',
  'JELAND J7': 'J7',
  'TENET A8': 'A8',
  'JELAND J8': 'J8',
  'total': 'Total'
};

const typeColors = {
  year: '#F0F9FF',
  month: '#F0FFF4',
  week: '#FFF7ED',
  day: '#FEF2F2',
};

const barTypeColors = {
  year: '#0284C7',
  month: '#16A34A',
  week: '#EA580C',
  day: '#DC2626',
};

const cardStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  padding: 24,
  marginBottom: 30,
  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
  border: '1px solid #F0F0F5',
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

const PIE_COLORS = ['#3B82F6', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6', '#F97316', '#84CC16', '#DC2626', '#059669'];

const shopNames = {
  AS: 'Цех сборки (AS)',
  BS: 'Цех сварки (BS)',
  PS: 'Цех окраски (PS)',
  LS: 'Логистика (LS)',
};

const shopColors = {
  AS: '#F59E0B',
  BS: '#3B82F6',
  PS: '#10B981',
  LS: '#8B5CF6',
};

export default function DrrReportPage() {
  const [activeTab, setActiveTab] = useState('factory');
  const [selectedModel, setSelectedModel] = useState('ALL');
  const [period, setPeriod] = useState('all');
  const [count, setCount] = useState(3);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dataPoints, setDataPoints] = useState([]);
  const [loading, setLoading] = useState(false);

  // ==== DPU OFF retro ====
  const [dpuOffDataPoints, setDpuOffDataPoints] = useState([]);
  const [dpuOffLoading, setDpuOffLoading] = useState(false);

  const [shopTab, setShopTab] = useState('graphs');
  const [drrData, setDrrData] = useState(null);
  const [drrLoading, setDrrLoading] = useState(false);
  const [shopData, setShopData] = useState(null);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopModel, setShopModel] = useState('ALL');
  const [importingMapping, setImportingMapping] = useState(false);
  const [exportingMapping, setExportingMapping] = useState(false);
  const [showHelpMapping, setShowHelpMapping] = useState(false);

  // ==== ТАБЛИЦЫ ИЗ DAILY DASHBOARD ====
  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }, []);

  // DRR TOP 3
  const [showTop3Filter, setShowTop3Filter] = useState(false);
  const [top3DateFrom, setTop3DateFrom] = useState(yesterday);
  const [top3DateTo, setTop3DateTo] = useState(yesterday);
  const [top3Data, setTop3Data] = useState([]);
  const [top3Loading, setTop3Loading] = useState(false);

  // TOP 5 A/B
  const [showTop5Filter, setShowTop5Filter] = useState(false);
  const [showGradeFilter, setShowGradeFilter] = useState(false);
  const [top5DateFrom, setTop5DateFrom] = useState(yesterday);
  const [top5DateTo, setTop5DateTo] = useState(yesterday);
  const [selectedGrades, setSelectedGrades] = useState(['A', 'B', 'A1', 'B1']);
  const [availableGrades, setAvailableGrades] = useState([]);
  const [top5Data, setTop5Data] = useState([]);
  const [top5Loading, setTop5Loading] = useState(false);

  // DRR TOP 3 — неделя
  const [weekTop3Data, setWeekTop3Data] = useState([]);
  const [weekTop3Loading, setWeekTop3Loading] = useState(false);
  const [selectedWeekOffset, setSelectedWeekOffset] = useState(0);
  const [shiftFilter, setShiftFilter] = useState('all');

  // Список последних 4 недель
  const weekOptions = useMemo(() => {
    const options = [];
    const today = new Date();
    for (let i = 0; i < 4; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * 7);
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const weekNum = (() => {
        const target = new Date(monday);
        const dayNr = (target.getDay() + 6) % 7;
        target.setDate(target.getDate() - dayNr + 3);
        const firstThursday = target.valueOf();
        target.setMonth(0, 1);
        if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
        return 1 + Math.ceil((firstThursday - target) / 604800000);
      })();
      options.push({
        value: i,
        label: `CW${weekNum} (${monday.toISOString().split('T')[0]} – ${sunday.toISOString().split('T')[0]})`,
        start: monday.toISOString().split('T')[0],
        end: sunday.toISOString().split('T')[0],
        weekNum,
      });
    }
    return options;
  }, []);

  const currentWeek = weekOptions[selectedWeekOffset];

  const availableModels = ['ALL', 'ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];

  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    if (newPeriod === 'all') {
      setFromDate('');
      setToDate('');
    } else {
      const defaults = { year: 2, month: 3, week: 4, day: 14 };
      setCount(defaults[newPeriod] || 3);
    }
  };

  // Блокируем прокрутку страницы, пока открыта справка
  useEffect(() => {
    if (showHelpMapping) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [showHelpMapping]);

  // ==== DRR загрузка ====
  useEffect(() => {
    if (activeTab !== 'factory') return;
    setLoading(true);
    const params = new URLSearchParams({ period });
    if (period !== 'all' && count) params.append('count', count);
    if (period !== 'all' && fromDate && toDate) {
      params.append('fromDate', fromDate);
      params.append('toDate', toDate);
    }
    fetch(`${API_BASE}/api/drr-retrospective?${params.toString()}`)
      .then(res => res.json())
      .then(json => {
        setDataPoints(json.dataPoints || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Ошибка загрузки DRR:', err);
        setLoading(false);
      });
  }, [activeTab, period, count, fromDate, toDate]);

  // ==== DPU OFF загрузка ====
  useEffect(() => {
    if (activeTab !== 'factory') return;
    setDpuOffLoading(true);
    const params = new URLSearchParams({ period });
    if (period !== 'all' && count) params.append('count', count);
    if (period !== 'all' && fromDate && toDate) {
      params.append('fromDate', fromDate);
      params.append('toDate', toDate);
    }
    fetch(`${API_BASE}/api/dpu-off-retrospective?${params.toString()}`)
      .then(res => res.json())
      .then(json => {
        setDpuOffDataPoints(json.dataPoints || []);
        setDpuOffLoading(false);
      })
      .catch(err => {
        console.error('Ошибка загрузки DPU OFF:', err);
        setDpuOffLoading(false);
      });
  }, [activeTab, period, count, fromDate, toDate]);

  // ==== Загрузка таблиц из Daily Dashboard ====
  const loadTop3 = () => {
    setTop3Loading(true);
    const params = new URLSearchParams({
      dateFrom: top3DateFrom,
      dateTo: top3DateTo,
    });
    fetch(`${API_BASE}/api/daily-dashboard-top3?${params.toString()}`)
      .then(res => res.json())
      .then(json => {
        setTop3Data(json || []);
        setTop3Loading(false);
      })
      .catch(() => setTop3Loading(false));
  };

  const loadTop5 = () => {
    setTop5Loading(true);
    const params = new URLSearchParams({
      dateFrom: top5DateFrom,
      dateTo: top5DateTo,
    });
    if (selectedGrades.length > 0) {
      params.append('grades', selectedGrades.join(','));
    }
    fetch(`${API_BASE}/api/daily-dashboard-top5?${params.toString()}`)
      .then(res => res.json())
      .then(json => {
        setTop5Data(json || []);
        setTop5Loading(false);
      })
      .catch(() => setTop5Loading(false));
  };

  const handleGradeToggle = (grade) => {
    setSelectedGrades(prev => prev.includes(grade) ? prev.filter(g => g !== grade) : [...prev, grade]);
  };

  // Список классов дефектов
  useEffect(() => {
    if (activeTab !== 'factory') return;
    fetch(`${API_BASE}/api/problem-grades`)
      .then(res => res.json())
      .then(grades => setAvailableGrades(grades || []))
      .catch(() => {});
  }, [activeTab]);

  // Загрузка TOP 3 и TOP 5
  useEffect(() => {
    if (activeTab !== 'factory') return;
    loadTop3();
  }, [activeTab, top3DateFrom, top3DateTo]);

  useEffect(() => {
    if (activeTab !== 'factory') return;
    loadTop5();
  }, [activeTab, top5DateFrom, top5DateTo, selectedGrades]);

  // Загрузка недельного TOP 3
  useEffect(() => {
    if (activeTab !== 'factory' || !currentWeek) return;
    setWeekTop3Loading(true);
    const params = new URLSearchParams({
      dateFrom: currentWeek.start,
      dateTo: currentWeek.end,
      shift: shiftFilter,
    });
    fetch(`${API_BASE}/api/daily-dashboard-week-top3?${params.toString()}`)
      .then(res => res.json())
      .then(json => setWeekTop3Data(json || []))
      .catch(() => setWeekTop3Data([]))
      .finally(() => setWeekTop3Loading(false));
  }, [activeTab, currentWeek.start, currentWeek.end, shiftFilter]);

  const loadDrrByShop = async () => {
    setDrrLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/drr-by-shop?weeks=10`);
      if (!res.ok) throw new Error('Ошибка загрузки DRR по цехам');
      const json = await res.json();
      setDrrData(json);
    } catch (err) {
      console.error(err);
    } finally {
      setDrrLoading(false);
    }
  };

  const loadShopData = async (shop) => {
    setShopLoading(true);
    try {
      const params = new URLSearchParams({ shop, model: shopModel });
      const res = await fetch(`${API_BASE}/api/shop-top-defects?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки данных цеха');
      const json = await res.json();
      setShopData(json);
    } catch (err) {
      console.error(err);
    } finally {
      setShopLoading(false);
    }
  };

  const handleMappingImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        setImportingMapping(true);
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

        if (!json.length) {
          alert('Файл пуст или не содержит строк');
          return;
        }

        const headers = Object.keys(json[0] || {});
        console.log('📋 Колонки файла:', headers);
        console.log('📋 Первая строка:', json[0]);

        const norm = (s) =>
          String(s ?? '')
            .replace(/^\uFEFF/, '')
            .trim()
            .toLowerCase()
            .replace(/[\s_\-]+/g, '');

        const findHeader = (aliases) => {
          for (const h of headers) {
            if (aliases.includes(norm(h))) return h;
          }
          return null;
        };

        const partKey = findHeader([
          'partdefect', 'partname', 'part', 'part_name', 'partn',
          'деталь', 'наименованиедетали', 'названиедетали', 'наименование',
        ]);
        const defectKey = findHeader([
          'defecttype', 'defect_type', 'type', 'defect',
          'problemtype', 'problem_type', 'defectname',
          'тип', 'типдефекта', 'названиедефекта', 'дефект',
        ]);
        const shopKey = findHeader([
          'shop', 'workshop', 'цех', 'workshopname', 'подразделение',
        ]);

        if (!partKey || !defectKey || !shopKey) {
          alert(
            'Не найдены нужные колонки.\n\n' +
            'В файле есть: ' + headers.join(', ') + '\n\n' +
            'Ожидаются:\n' +
            '• Деталь: PartDefect / part_name / Деталь\n' +
            '• Дефект: defect_type / Тип / PROBLEM_TYPE\n' +
            '• Цех: shop / Цех / Workshop'
          );
          return;
        }

        const shopMap = {
          // EN
          'body': 'BS', 'bodyshop': 'BS',
          'assembly': 'AS', 'assemblyshop': 'AS',
          'paint': 'PS', 'paintshop': 'PS',
          'logistics': 'LS', 'logistic': 'LS',
          'bs': 'BS', 'as': 'AS', 'ps': 'PS', 'ls': 'LS',
          // RU
          'сборка': 'AS', 'сборочный': 'AS', 'цехсборки': 'AS',
          'сварка': 'BS', 'сварочный': 'BS', 'цехсварки': 'BS',
          'окраска': 'PS', 'окрасочный': 'PS', 'цехокраски': 'PS',
          'логистика': 'LS', 'цехлогистики': 'LS', 'логистический': 'LS',
          // ИСКЛЮЧЕНИЕ из всех цехов — сохраняется в БД как '0'
          '0': '0',
          'none': '0',
          'no': '0',
          'excluded': '0',
          'exclude': '0',
          'неотносится': '0',
          'исключить': '0',
          'исключено': '0',
          'нет': '0',
        };

        const skipped = [];
        const mappings = [];

        json.forEach((row, i) => {
          const rawPart = String(row[partKey] ?? '').trim();
          const rawDefect = String(row[defectKey] ?? '').trim();
          const rawShop = String(row[shopKey] ?? '').trim();
          const mappedShop = shopMap[norm(rawShop)] || null;

          if (!rawPart || !rawDefect || !mappedShop) {
            if (rawPart || rawDefect || rawShop) {
              skipped.push({
                row: i + 2,
                part: rawPart,
                defect: rawDefect,
                shop: rawShop,
                reason: !mappedShop ? `shop "${rawShop}" не распознан` : 'пустое поле',
              });
            }
            return;
          }

          mappings.push({
            part_name: rawPart,
            defect_type: rawDefect,
            shop: mappedShop,
          });
        });

        // Дедупликация внутри файла. Побеждает последняя строка.
        const byKey = new Map();
        const dupes = [];
        mappings.forEach(m => {
          const k = `${m.part_name}|${m.defect_type}`;
          if (byKey.has(k)) {
            dupes.push({
              part: m.part_name,
              defect: m.defect_type,
              replacedShop: byKey.get(k).shop,
              keptShop: m.shop,
            });
          }
          byKey.set(k, m);
        });
        const dedupedMappings = Array.from(byKey.values());

        console.log('✅ К отправке (уникальных):', dedupedMappings.length);
        console.log('🔁 Дублей в файле:', dupes.length);
        console.log('⚠️ Пропущено:', skipped.length);
        if (skipped.length) console.table(skipped.slice(0, 20));
        if (dupes.length) console.table(dupes.slice(0, 20));

        if (!dedupedMappings.length) {
          alert(
            'Ни одна строка не распознана.\n\n' +
            'Первая строка файла:\n' + JSON.stringify(json[0], null, 2) + '\n\n' +
            'В колонке shop допустимы: AS / BS / PS / LS / 0 (исключить) / пусто или - (пропустить).\n' +
            'Точные причины — в консоли (F12).'
          );
          return;
        }

        const res = await fetch(`${API_BASE}/api/part-defect-shop-mapping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mappings: dedupedMappings }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        await res.json();

        let msg = `✅ Загружено ${dedupedMappings.length} записей`;
        if (dupes.length) {
          msg += `\n🔁 В файле было ${dupes.length} дублей (оставлено последнее значение shop)`;
        }
        if (skipped.length) {
          msg += `\n⚠️ Пропущено ${skipped.length}:\n` +
            skipped.slice(0, 5).map(s => `• стр.${s.row}: ${s.reason}`).join('\n');
          if (skipped.length > 5) msg += `\n… и ещё ${skipped.length - 5}`;
        }
        alert(msg);
        loadDrrByShop();
      } catch (err) {
        console.error(err);
        alert('Ошибка импорта: ' + err.message);
      } finally {
        setImportingMapping(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleMappingExport = async () => {
    try {
      setExportingMapping(true);
      const res = await fetch(`${API_BASE}/api/part-defect-shop-mapping`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();

      if (!Array.isArray(rows) || rows.length === 0) {
        alert('Справочник пуст — нечего экспортировать');
        return;
      }

      const exportData = rows.map(r => ({
        shop: r.shop || '',
        part_name: r.part_name || '',
        defect_type: r.defect_type || '',
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      ws['!cols'] = [
        { wch: 10 },
        { wch: 45 },
        { wch: 35 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Mapping');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

      const today = new Date().toISOString().slice(0, 10);
      saveAs(
        new Blob([buf], { type: 'application/octet-stream' }),
        `Справочник_дефектов_${today}.xlsx`
      );
    } catch (err) {
      console.error('Ошибка экспорта справочника:', err);
      alert('Ошибка экспорта: ' + err.message);
    } finally {
      setExportingMapping(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'workshops') {
      loadDrrByShop();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'workshops' && ['AS', 'BS', 'PS', 'LS'].includes(shopTab)) {
      loadShopData(shopTab);
    }
  }, [shopTab, shopModel, activeTab]);

  const chartData = useMemo(() => {
    return dataPoints.map(point => {
      const modelValues = Object.entries(point)
        .filter(([key]) => key !== 'label' && key !== 'type' && key !== 'total')
        .map(([, val]) => val)
        .filter(v => v !== null && v !== undefined);
      const max = modelValues.length > 0 ? Math.max(...modelValues) : 0;
      return { ...point, maxValue: max };
    });
  }, [dataPoints]);

  const barDataKey = selectedModel === 'ALL' ? 'maxValue' : selectedModel;
  const modelKeys = Object.keys(modelColors);

  const dpuOffChartData = useMemo(() => {
    return dpuOffDataPoints.map(point => {
      const modelValues = Object.entries(point)
        .filter(([key]) => key !== 'label' && key !== 'type' && key !== 'total')
        .map(([, val]) => val)
        .filter(v => v !== null && v !== undefined);
      const max = modelValues.length > 0 ? Math.max(...modelValues) : 0;
      return { ...point, maxValue: max };
    });
  }, [dpuOffDataPoints]);

  const dpuOffBarDataKey = selectedModel === 'ALL' ? 'total' : selectedModel;

  const totalCols = chartData.length + 1;
  const colWidth = `${100 / totalCols}%`;

  const shopChartData = useMemo(() => {
    if (!drrData) return [];
    return drrData.weeks.map((week, idx) => {
      const asValue = parseFloat(drrData.AS?.[idx]) || 0;
      const bsValue = parseFloat(drrData.BS?.[idx]) || 0;
      const psValue = parseFloat(drrData.PS?.[idx]) || 0;
      const lsValue = parseFloat(drrData.LS?.[idx]) || 0;

      return {
        week,
        AS: Math.max(0, Math.min(100, 100 - asValue)),
        BS: bsValue,
        PS: psValue,
        LS: lsValue,
      };
    });
  }, [drrData]);

  const pieData = useMemo(() => {
    if (!shopData || !shopData.data.length) return [];
    const lastWeek = shopData.weeks[shopData.weeks.length - 1];
    return shopData.data
      .map(d => ({ name: d.name, value: d[lastWeek] || 0 }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [shopData]);

  const exportShopTable = () => {
    if (!shopData || !shopData.data.length) return;
    const exportData = shopData.data.map(d => ({
      'Дефект': d.name,
      ...shopData.weeks.reduce((acc, w) => ({ ...acc, [w]: d[w] || 0 }), {}),
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Топ дефектов');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `Топ_дефектов_${shopTab}.xlsx`);
  };

  return (
    <div style={{ padding: '20px 30px 20px 16px', fontFamily: 'Inter, Segoe UI, Arial, sans-serif', maxWidth: 1300, margin: '0 auto' }}>
      <h1 style={{ color: '#111827', fontSize: 28, fontWeight: 800, marginBottom: 30 }}>DRR Report</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 30 }}>
        <button onClick={() => setActiveTab('factory')} style={tabStyle(activeTab === 'factory')}>По заводу</button>
        <button onClick={() => setActiveTab('workshops')} style={tabStyle(activeTab === 'workshops')}>По цехам</button>
        <button onClick={() => setActiveTab('cp78')} style={tabStyle(activeTab === 'cp78')}>По CP7/СР8</button>
      </div>

      {activeTab === 'factory' && (
        <>
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1F2937' }}>Выход годной продукции с первого раза - Ретроспектива</h2>
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
                      Кол-во периодов:
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={count}
                        onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)}
                        style={{ ...inputStyle, width: 80 }}
                      />
                    </label>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#4B5563' }}>От:</span>
                      <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} />
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#4B5563' }}>По:</span>
                      <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputStyle} />
                      {(fromDate || toDate) && (
                        <button
                          onClick={() => { setFromDate(''); setToDate(''); }}
                          style={{ ...buttonStyle, background: '#9CA3AF', padding: '4px 10px' }}
                        >✕</button>
                      )}
                    </div>
                  </>
                )}
                <label style={{ fontSize: 14, color: '#4B5563', display: 'flex', alignItems: 'center', gap: 6 }}>
                  Модель:
                  <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} style={inputStyle}>
                    <option value="ALL">Все</option>
                    {modelKeys.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              </div>
            </div>

            {loading ? (
              <p style={{ textAlign: 'center', color: '#6B7280', padding: 20 }}>Загрузка данных...</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={chartData} margin={{ top: 20, right: 48, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                    <ReferenceLine y={80} stroke="#EF4444" strokeDasharray="5 5">
                      <Label value="80%" position="right" style={{ fill: '#EF4444', fontSize: 14, fontWeight: 700 }} />
                    </ReferenceLine>
                    <Bar
                      dataKey={barDataKey}
                      barSize={28}
                      radius={[6, 6, 0, 0]}
                      label={{
                        fill: '#DC2626', fontSize: 12, fontWeight: 600, position: 'top',
                        formatter: (v) => v !== null && v !== undefined ? `${v}%` : '',
                      }}
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={barTypeColors[entry.type]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                <div style={{ overflowX: 'auto', marginTop: 12, paddingRight: 45 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#F9FAFB' }}>
                        <th style={{ ...thStyle, width: colWidth, paddingLeft: 16 }}>Модель</th>
                        {chartData.map((point, idx) => (
                          <th key={idx} style={{ ...thStyle, width: colWidth, backgroundColor: typeColors[point.type] }}>
                            {point.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedModel === 'ALL' ? [...modelKeys, 'total'] : [selectedModel]).map(modelKey => (
                        <tr key={modelKey} style={{
                          backgroundColor: modelKey === 'total' ? '#F3F4F6' : 'white',
                          fontWeight: modelKey === 'total' ? 700 : 400,
                          display: (selectedModel !== 'ALL' && modelKey === 'total') ? 'none' : undefined,
                        }}>
                          <td style={{ ...tdStyle, width: colWidth, paddingLeft: 16 }}>
                            {modelShortNames[modelKey] || modelKey}
                          </td>
                          {chartData.map((point, idx) => {
                            const val = modelKey === 'total' ? point.maxValue : point[modelKey];
                            return (
                              <td key={idx} style={{
                                ...tdStyle, width: colWidth, backgroundColor: typeColors[point.type],
                                color: val !== null && val !== undefined ? '#1F2937' : '#9CA3AF'
                              }}>
                                {val !== null && val !== undefined ? `${val}%` : ''}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1F2937' }}>DPU OFF - Ретроспектива</h2>
            </div>
            {dpuOffLoading ? (
              <p style={{ textAlign: 'center', color: '#6B7280', padding: 20 }}>Загрузка данных...</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={dpuOffChartData} margin={{ top: 20, right: 48, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 'auto']} tick={{ fontSize: 12 }} />
                    <ReferenceLine y={2} stroke="#EF4444" strokeDasharray="5 5">
                      <Label value="2" position="right" style={{ fill: '#EF4444', fontSize: 14, fontWeight: 700 }} />
                    </ReferenceLine>
                    <Bar
                      dataKey={dpuOffBarDataKey}
                      barSize={28}
                      radius={[6, 6, 0, 0]}
                      label={{
                        fill: '#DC2626', fontSize: 12, fontWeight: 600, position: 'top',
                        formatter: (v) => v !== null && v !== undefined ? `${v}` : '',
                      }}
                    >
                      {dpuOffChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={barTypeColors[entry.type]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                <div style={{ overflowX: 'auto', marginTop: 12, paddingRight: 45 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#F9FAFB' }}>
                        <th style={{ ...thStyle, width: colWidth, paddingLeft: 16 }}>Модель</th>
                        {dpuOffChartData.map((point, idx) => (
                          <th key={idx} style={{ ...thStyle, width: colWidth, backgroundColor: typeColors[point.type] }}>
                            {point.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedModel === 'ALL' ? [...modelKeys, 'total'] : [selectedModel]).map(modelKey => (
                        <tr key={modelKey} style={{
                          backgroundColor: modelKey === 'total' ? '#F3F4F6' : 'white',
                          fontWeight: modelKey === 'total' ? 700 : 400,
                          display: (selectedModel !== 'ALL' && modelKey === 'total') ? 'none' : undefined,
                        }}>
                          <td style={{ ...tdStyle, width: colWidth, paddingLeft: 16 }}>
                            {modelShortNames[modelKey] || modelKey}
                          </td>
                          {dpuOffChartData.map((point, idx) => {
                            const val = modelKey === 'total' ? point.total : point[modelKey];
                            return (
                              <td key={idx} style={{
                                ...tdStyle, width: colWidth, backgroundColor: typeColors[point.type],
                                color: val !== null && val !== undefined ? '#1F2937' : '#9CA3AF'
                              }}>
                                {val !== null && val !== undefined ? val : ''}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
            <div style={{ ...cardStyle, flex: 1, minWidth: 300 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1F2937', margin: 0 }}>DRR TOP 3</h2>
                <button onClick={() => setShowTop3Filter(!showTop3Filter)} style={{
                  background: showTop3Filter ? '#2563EB' : '#F3F4F6',
                  color: showTop3Filter ? '#FFFFFF' : '#374151',
                  border: 'none', padding: '6px 14px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
                }}>{showTop3Filter ? 'Скрыть фильтр' : 'Фильтр'}</button>
              </div>
              {showTop3Filter && (
                <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#6B7280' }}>с</span>
                  <input type="date" value={top3DateFrom} onChange={e => setTop3DateFrom(e.target.value)} style={inputStyle} />
                  <span style={{ fontSize: 12, color: '#6B7280' }}>по</span>
                  <input type="date" value={top3DateTo} onChange={e => setTop3DateTo(e.target.value)} style={inputStyle} />
                </div>
              )}
              {top3Loading ? <p style={{ color: '#6B7280', textAlign: 'center', padding: 10 }}>Загрузка...</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>DEFECT</th>
                      <th style={thStyle}>COUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top3Data.length === 0 ? (
                      <tr><td colSpan={2} style={{ ...tdStyle, color: '#94A3B8' }}>Нет данных</td></tr>
                    ) : top3Data.map((item, idx) => (
                      <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#F9FAFB' : 'white' }}>
                        <td style={tdStyle}>{item.defect}</td>
                        <td style={tdStyle}>{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ ...cardStyle, flex: 1, minWidth: 300 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1F2937', margin: 0 }}>TOP 5 A/B дефектов на CP7 и CP8</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setShowTop5Filter(!showTop5Filter)} style={{
                    background: showTop5Filter ? '#2563EB' : '#F3F4F6',
                    color: showTop5Filter ? '#FFFFFF' : '#374151',
                    border: 'none', padding: '6px 14px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
                  }}>{showTop5Filter ? 'Скрыть фильтр' : 'Фильтр'}</button>
                  <button onClick={() => setShowGradeFilter(!showGradeFilter)} style={{
                    background: showGradeFilter ? '#2563EB' : '#F3F4F6',
                    color: showGradeFilter ? '#FFFFFF' : '#374151',
                    border: 'none', padding: '6px 14px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
                  }}>{showGradeFilter ? 'Скрыть классы' : 'Классы дефектов'}</button>
                </div>
              </div>
              {showTop5Filter && (
                <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#6B7280' }}>с</span>
                  <input type="date" value={top5DateFrom} onChange={e => setTop5DateFrom(e.target.value)} style={inputStyle} />
                  <span style={{ fontSize: 12, color: '#6B7280' }}>по</span>
                  <input type="date" value={top5DateTo} onChange={e => setTop5DateTo(e.target.value)} style={inputStyle} />
                </div>
              )}
              {showGradeFilter && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {availableGrades.map(grade => (
                    <label key={grade} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={selectedGrades.includes(grade)} onChange={() => handleGradeToggle(grade)} />
                      {grade}
                    </label>
                  ))}
                </div>
              )}
              {top5Loading ? <p style={{ color: '#6B7280', textAlign: 'center', padding: 10 }}>Загрузка...</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>DEFECT</th>
                      <th style={thStyle}>COUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top5Data.length === 0 ? (
                      <tr><td colSpan={2} style={{ ...tdStyle, color: '#94A3B8' }}>Нет данных</td></tr>
                    ) : top5Data.map((item, idx) => (
                      <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#F9FAFB' : 'white' }}>
                        <td style={tdStyle}>{item.defect}</td>
                        <td style={tdStyle}>{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1F2937', margin: 0 }}>
                DRR TOP 3 — неделя CW{currentWeek?.weekNum}
                <span style={{ fontSize: 14, fontWeight: 400, color: '#6B7280', marginLeft: 8 }}>
                  ({currentWeek?.start} – {currentWeek?.end})
                </span>
              </h2>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={selectedWeekOffset} onChange={e => setSelectedWeekOffset(Number(e.target.value))} style={{ ...inputStyle, fontWeight: 500 }}>
                  {weekOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
                <select value={shiftFilter} onChange={e => setShiftFilter(e.target.value)} style={{ ...inputStyle, fontWeight: 500 }}>
                  <option value="all">Сутки</option>
                  <option value="day">День</option>
                  <option value="evening">Вечер</option>
                  <option value="night">Ночь</option>
                </select>
              </div>
            </div>
            {weekTop3Loading ? <p style={{ color: '#6B7280', textAlign: 'center', padding: 10 }}>Загрузка...</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>DEFECT</th>
                    <th style={{ ...thStyle, width: 120 }}>COUNT</th>
                  </tr>
                </thead>
                <tbody>
                  {weekTop3Data.length === 0 ? (
                    <tr><td colSpan={2} style={{ ...tdStyle, color: '#94A3B8' }}>Нет данных</td></tr>
                  ) : weekTop3Data.map((item, idx) => (
                    <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#F9FAFB' : 'white' }}>
                      <td style={{ ...tdStyle, textAlign: 'left' }}>{item.defect}</td>
                      <td style={tdStyle}>{item.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {activeTab === 'workshops' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => setShopTab('graphs')} style={{
              ...tabStyle(shopTab === 'graphs'),
              background: shopTab === 'graphs' ? '#2563EB' : '#F3F4F6',
            }}>📊 Графики</button>
            <button onClick={() => setShopTab('AS')} style={{
              ...tabStyle(shopTab === 'AS'),
              background: shopTab === 'AS' ? '#F59E0B' : '#F3F4F6',
            }}>🔧 Цех сборки</button>
            <button onClick={() => setShopTab('BS')} style={{
              ...tabStyle(shopTab === 'BS'),
              background: shopTab === 'BS' ? '#3B82F6' : '#F3F4F6',
            }}>🔩 Цех сварки</button>
            <button onClick={() => setShopTab('PS')} style={{
              ...tabStyle(shopTab === 'PS'),
              background: shopTab === 'PS' ? '#10B981' : '#F3F4F6',
            }}>🎨 Цех окраски</button>
            <button onClick={() => setShopTab('LS')} style={{
              ...tabStyle(shopTab === 'LS'),
              background: shopTab === 'LS' ? '#8B5CF6' : '#F3F4F6',
            }}>🚚 Логистика</button>

            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              <button
                onClick={handleMappingExport}
                disabled={exportingMapping}
                style={{
                  ...buttonStyle,
                  background: '#0891B2',
                  cursor: exportingMapping ? 'wait' : 'pointer',
                  opacity: exportingMapping ? 0.7 : 1,
                }}
              >
                {exportingMapping ? '⏳ Экспорт...' : '📤 Экспорт справочника'}
              </button>

              <label style={{ ...buttonStyle, background: '#8B5CF6', cursor: 'pointer' }}>
                {importingMapping ? '⏳ Импорт...' : '📋 Импорт справочника'}
                <input
                  type="file"
                  accept=".xlsx, .xls"
                  onChange={handleMappingImport}
                  style={{ display: 'none' }}
                />
              </label>

              <button
                onClick={() => setShowHelpMapping(true)}
                title="Как заполнять справочник"
                style={{
                  ...buttonStyle,
                  background: '#0F172A',
                  padding: '8px 14px',
                  fontSize: 16,
                  minWidth: 40,
                  justifyContent: 'center',
                }}
              >
                ?
              </button>
            </div>
          </div>

          {shopTab === 'graphs' && (
            <>
              {drrLoading ? (
                <p style={{ textAlign: 'center', padding: 40 }}>Загрузка...</p>
              ) : shopChartData.length > 0 ? (
                <>
                  <div style={cardStyle}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, color: '#F59E0B', marginBottom: 20 }}>🔧 Цех сборки (AS) — % дефектов</h2>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={shopChartData} margin={{ top: 20, right: 20, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F5" />
                        <XAxis dataKey="week" />
                        <YAxis domain={[0, 100]} />
                        <Tooltip formatter={(v) => `${v}%`} />
                        <Bar dataKey="AS" fill="#F59E0B" barSize={40} radius={[8, 8, 0, 0]}>
                          <LabelList dataKey="AS" position="top" formatter={(v) => `${parseFloat(v).toFixed(2)}%`} style={{ fill: '#1F2937', fontSize: 11, fontWeight: 600 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div style={cardStyle}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, color: '#3B82F6', marginBottom: 20 }}>🔩 Цех сварки (BS) — DRR %</h2>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={shopChartData} margin={{ top: 20, right: 20, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F5" />
                        <XAxis dataKey="week" />
                        <YAxis domain={['dataMin - 3', 'dataMax + 3']} />
                        <Tooltip formatter={(v) => `${v}%`} />
                        <Bar dataKey="BS" fill="#3B82F6" barSize={40} radius={[8, 8, 0, 0]}>
                          <LabelList dataKey="BS" position="top" formatter={(v) => `${parseFloat(v).toFixed(2)}%`} style={{ fill: '#1F2937', fontSize: 11, fontWeight: 600 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div style={cardStyle}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, color: '#10B981', marginBottom: 20 }}>🎨 Цех окраски (PS) — DRR %</h2>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={shopChartData} margin={{ top: 20, right: 20, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F5" />
                        <XAxis dataKey="week" />
                        <YAxis domain={['dataMin - 3', 'dataMax + 3']} />
                        <Tooltip formatter={(v) => `${v}%`} />
                        <Bar dataKey="PS" fill="#10B981" barSize={40} radius={[8, 8, 0, 0]}>
                          <LabelList dataKey="PS" position="top" formatter={(v) => `${parseFloat(v).toFixed(2)}%`} style={{ fill: '#1F2937', fontSize: 11, fontWeight: 600 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : (
                <p style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Нет данных. Загрузите справочник.</p>
              )}
            </>
          )}

          {['AS', 'BS', 'PS', 'LS'].includes(shopTab) && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: shopColors[shopTab], margin: 0 }}>
                  {shopNames[shopTab]}
                </h2>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#4B5563', fontWeight: 500 }}>
                    Модель:
                    <select value={shopModel} onChange={e => setShopModel(e.target.value)} style={inputStyle}>
                      {availableModels.map(m => <option key={m} value={m}>{m === 'ALL' ? 'Все' : m}</option>)}
                    </select>
                  </label>
                  <button onClick={exportShopTable} style={{ ...buttonStyle, background: '#059669' }}>
                    📊 Экспорт
                  </button>
                </div>
              </div>

              {shopLoading ? (
                <p style={{ textAlign: 'center', padding: 40 }}>Загрузка...</p>
              ) : shopData && shopData.data.length > 0 ? (
                <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                  <div style={{ flex: '0 0 40%', maxWidth: '40%' }}>
                    <h3 style={{ fontWeight: 600, color: '#1F2937', marginBottom: 16, fontSize: 18 }}>
                      Доля дефектов {shopTab}
                    </h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={120}
                          label={{ fill: '#1F2937', fontSize: 12, formatter: (value) => `${value}` }}
                          labelLine={{ stroke: '#6B7280', strokeWidth: 1 }}
                        >
                          {pieData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16, alignItems: 'flex-start' }}>
                      {pieData.map((d, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, color: '#1F2937', textAlign: 'left' }}>
                          <span style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: PIE_COLORS[i % PIE_COLORS.length], display: 'inline-block', flexShrink: 0, marginTop: 3 }} />
                          <span style={{ lineHeight: 1.3 }}>{d.name} ({d.value})</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ flex: '0 0 60%', maxWidth: '60%', overflowX: 'auto' }}>
                    <h3 style={{ fontWeight: 600, color: '#1F2937', marginBottom: 16, fontSize: 18 }}>
                      Топы дефектов {shopTab}
                    </h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                      <thead>
                        <tr style={{ backgroundColor: '#F9FAFB' }}>
                          <th style={{ ...thStyle, textAlign: 'left', paddingLeft: 12 }}>Дефект</th>
                          {shopData.weeks.map(week => (
                            <th key={week} style={{ ...thStyle, textAlign: 'center' }}>{week}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shopData.data.map((row, idx) => (
                          <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                            <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 12, whiteSpace: 'normal', wordBreak: 'break-word', minWidth: 150 }}>{row.name}</td>
                            {shopData.weeks.map(week => (
                              <td key={week} style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>
                                {row[week] || ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Нет данных. Загрузите справочник.</p>
              )}
            </div>
          )}
        </>
      )}

      {activeTab === 'cp78' && (
        <div style={cardStyle}>
          <p style={{ fontSize: 16, color: '#374151', marginBottom: 20, textAlign: 'center' }}>
            Отчёт по дефектам CP7/CP8 (DRR Defects Top).
          </p>
          <div style={{ textAlign: 'center' }}>
            <a
              href="/mpp-weekly-top"
              style={{
                display: 'inline-block',
                padding: '12px 28px',
                backgroundColor: '#2563EB',
                color: '#FFFFFF',
                borderRadius: 8,
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: 16,
                boxShadow: '0 2px 6px rgba(37,99,235,0.3)',
              }}
            >
              Перейти к DRR Defects Top CP7/СP8
            </a>
          </div>
        </div>
      )}

      {/* ===== МОДАЛКА-СПРАВКА ПО СПРАВОЧНИКУ ===== */}
      {showHelpMapping && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.72)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3000,
            padding: 20,
          }}
          onClick={() => setShowHelpMapping(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 20,
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
              width: '100%',
              maxWidth: 880,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
              color: '#1E293B',
            }}
          >
            <div style={{
              padding: '20px 28px',
              borderBottom: '1px solid #E2E8F0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0,
            }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1E293B' }}>
                📋 Как заполнять справочник дефектов
              </h2>
              <button
                onClick={() => setShowHelpMapping(false)}
                style={{
                  background: 'none', border: 'none',
                  fontSize: 26, cursor: 'pointer', color: '#64748B',
                  lineHeight: 1, padding: 4,
                }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: '24px 28px', overflowY: 'auto', fontSize: 14, lineHeight: 1.6 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', margin: '0 0 10px 0' }}>
                🔄 Как это работает
              </h3>
              <ol style={{ paddingLeft: 20, margin: '0 0 20px 0' }}>
                <li>Нажмите <b>📤 Экспорт справочника</b> — скачается файл со всеми текущими записями.</li>
                <li>Откройте его в Excel, отредактируйте или добавьте строки.</li>
                <li>Сохраните файл в формате <b>.xlsx</b>.</li>
                <li>Нажмите <b>📋 Импорт справочника</b> и выберите файл.</li>
              </ol>

              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', margin: '0 0 10px 0' }}>
                📊 Три колонки файла
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20, fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: '#F1F5F9' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #CBD5E1', width: 140 }}>Колонка</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #CBD5E1' }}>Что писать</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', fontWeight: 600 }}>shop</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>Код цеха (см. таблицу ниже)</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', fontWeight: 600 }}>part_name</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>Название детали — как в MES (без пробелов в начале/конце)</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', fontWeight: 600 }}>defect_type</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>Тип дефекта — как в MES</td>
                  </tr>
                </tbody>
              </table>

              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', margin: '0 0 10px 0' }}>
                🏭 Значения колонки <code style={{ background: '#F1F5F9', padding: '2px 6px', borderRadius: 4 }}>shop</code>
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20, fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: '#F1F5F9' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #CBD5E1', width: 140 }}>Значение</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #CBD5E1' }}>Что произойдёт</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', fontWeight: 700, color: '#F59E0B' }}>AS</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>Пара учитывается в <b>цехе сборки</b></td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', fontWeight: 700, color: '#3B82F6' }}>BS</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>Пара учитывается в <b>цехе сварки</b></td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', fontWeight: 700, color: '#10B981' }}>PS</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>Пара учитывается в <b>цехе окраски</b></td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', fontWeight: 700, color: '#8B5CF6' }}>LS</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>Пара учитывается в <b>цехе логистики</b></td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', fontWeight: 700, color: '#64748B' }}>0</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>
                      <b>Исключить из всех цехов</b> — пара остаётся в БД, но не учитывается ни в AS, ни в BS, ни в PS, ни в LS.
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', fontWeight: 700, color: '#94A3B8' }}>пусто или —</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>
                      <b>Пропустить строку</b> — ничего не изменится в БД для этой пары.
                    </td>
                  </tr>
                </tbody>
              </table>

              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', margin: '0 0 10px 0' }}>
                🔤 Распознаваемые синонимы
              </h3>
              <ul style={{ paddingLeft: 20, margin: '0 0 20px 0' }}>
                <li><b>AS</b> → также <code>Assembly</code>, <code>Сборка</code>, <code>Сборочный</code>, <code>Цех сборки</code></li>
                <li><b>BS</b> → также <code>Body</code>, <code>Сварка</code>, <code>Сварочный</code>, <code>Цех сварки</code></li>
                <li><b>PS</b> → также <code>Paint</code>, <code>Окраска</code>, <code>Окрасочный</code>, <code>Цех окраски</code></li>
                <li><b>LS</b> → также <code>Logistics</code>, <code>Логистика</code>, <code>Цех логистики</code></li>
                <li><b>0</b> → также <code>none</code>, <code>no</code>, <code>excluded</code>, <code>исключить</code>, <code>не относится</code>, <code>нет</code></li>
              </ul>

              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', margin: '0 0 10px 0' }}>
                ⚠️ Важные правила
              </h3>
              <div style={{ backgroundColor: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                <ul style={{ paddingLeft: 20, margin: 0 }}>
                  <li style={{ marginBottom: 6 }}>
                    <b>Одна пара = один цех.</b> Нельзя, чтобы «BDM + Нарушена работа» была одновременно и в AS, и в BS, и в LS. Если попытаетесь — победит последняя строка в файле.
                  </li>
                  <li style={{ marginBottom: 6 }}>
                    <b>Правка part_name или defect_type = новая строка.</b> Импорт обновляет только <code>shop</code> для существующей пары. Если изменить название детали или дефекта — добавится новая запись, а старая останется в БД (для чистки нужен SQL).
                  </li>
                  <li style={{ marginBottom: 6 }}>
                    <b>Удаление строки из Excel не удаляет из БД.</b> Если строку нужно убрать — сначала экспорт, потом SQL DELETE, потом импорт.
                  </li>
                  <li>
                    <b>Регистр не важен при сравнении.</b> Но <code>part_name</code> и <code>defect_type</code> в БД останутся в том виде, в каком попали туда в первый раз.
                  </li>
                </ul>
              </div>

              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', margin: '0 0 10px 0' }}>
                🔁 Дубли в файле
              </h3>
              <p style={{ margin: '0 0 16px 0' }}>
                Если в Excel окажутся две строки с одинаковой парой <code>(part_name, defect_type)</code>, применится значение <b>последней</b> строки. Импорт предупредит об этом в алерте после завершения.
              </p>

              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', margin: '0 0 10px 0' }}>
                ✅ Пример
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: '#F1F5F9' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #CBD5E1' }}>shop</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #CBD5E1' }}>part_name</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #CBD5E1' }}>defect_type</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #CBD5E1' }}>Результат</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', color: '#F59E0B', fontWeight: 700 }}>AS</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>BDM</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>Нарушена работа</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', color: '#16A34A' }}>→ в цехе сборки</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', color: '#8B5CF6', fontWeight: 700 }}>LS</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>Упаковка</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>Повреждение</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', color: '#16A34A' }}>→ в цехе логистики</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 700 }}>0</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>BDM</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>Сбой программирования</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', color: '#64748B' }}>→ нигде не учитывается</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', color: '#94A3B8', fontStyle: 'italic' }}>—</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>Капот</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0' }}>Вмятина</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', color: '#94A3B8' }}>→ пропущено</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{
              padding: '16px 28px',
              borderTop: '1px solid #E2E8F0',
              display: 'flex',
              justifyContent: 'flex-end',
              flexShrink: 0,
            }}>
              <button
                onClick={() => setShowHelpMapping(false)}
                style={{
                  padding: '10px 24px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(37,99,235,0.25)',
                }}
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  textAlign: 'center',
  fontWeight: 600,
  color: '#374151',
  borderBottom: '2px solid #E5E7EB',
  background: '#F9FAFB',
  whiteSpace: 'nowrap',
  padding: '6px 4px',
  fontSize: '11px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const tdStyle = {
  textAlign: 'center',
  borderBottom: '1px solid #F0F0F5',
  color: '#1F2937',
  whiteSpace: 'nowrap',
  padding: '4px 4px',
  fontSize: '14px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};