import React, { useState, useEffect, useMemo } from 'react';

const API_BASE = '';

/* ===================== ERROR BOUNDARY ===================== */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 50, color: '#DC2626', fontFamily: 'monospace', backgroundColor: '#FEF2F2', borderRadius: 12 }}>
          <h1 style={{ fontSize: 24, marginBottom: 20 }}>Ошибка рендера</h1>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error && this.state.error.toString()}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ===================== СТИЛИ ===================== */
const cardStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  padding: 20,
  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
  border: '1px solid #F0F0F5',
  marginBottom: 20,
};

const thStyle = {
  padding: '10px 12px',
  textAlign: 'center',
  fontWeight: 700,
  color: '#374151',
  borderBottom: '2px solid #E5E7EB',
  background: '#F9FAFB',
  whiteSpace: 'nowrap',
  fontSize: '0.85rem',
};

const tdStyle = {
  padding: '10px 12px',
  textAlign: 'center',
  borderBottom: '1px solid #F0F0F5',
  color: '#1F2937',
  fontSize: '0.9rem',
};

const tdRowHeaderStyle = {
  ...tdStyle,
  textAlign: 'left',
  fontWeight: 600,
  backgroundColor: '#F8FAFC',
  borderRight: '1px solid #E2E8F0',
  whiteSpace: 'nowrap',
};

const inputStyle = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: 14,
  outline: 'none',
};

const tabButtonStyle = (active) => ({
  padding: '10px 24px',
  borderRadius: '12px',
  border: 'none',
  fontWeight: 800,
  fontSize: '1rem',
  cursor: 'pointer',
  background: active ? 'linear-gradient(135deg,#2563EB,#1D4ED8)' : '#FFFFFF',
  color: active ? '#FFFFFF' : '#64748B',
  boxShadow: active ? '0 4px 12px rgba(37,99,235,0.25)' : '0 2px 6px rgba(0,0,0,0.05)',
  transition: 'all 0.2s',
});

const thStyleIot = {
  padding: '10px 12px',
  textAlign: 'center',
  fontWeight: 600,
  color: '#374151',
  borderBottom: '2px solid #E5E7EB',
  background: '#F9FAFB',
  whiteSpace: 'nowrap',
};

const tdStyleIot = {
  padding: '8px 12px',
  textAlign: 'center',
  borderBottom: '1px solid #F0F0F5',
  color: '#1F2937',
};

const inputStyleIot = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #D1D5DB',
  fontSize: 13,
};

/* ===================== ХЕЛПЕРЫ ===================== */
const translationCache = new Map();
async function translateText(text, from = 'ru', to = 'en') {
  if (!text || !text.trim()) return text;
  const cacheKey = `${from}:${to}:${text}`;
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
    const res = await fetch(url);
    const json = await res.json();
    const translated = json.responseData?.translatedText || text;
    translationCache.set(cacheKey, translated);
    return translated;
  } catch {
    return text;
  }
}

const getISOWeek = (dateStr) => {
  try {
    const d = new Date(dateStr + 'T12:00:00Z');
    if (isNaN(d.getTime())) return 0;
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  } catch (e) { return 0; }
};

const formatDateDDMM = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const toLocalDateStr = (d) => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fetchSnapshotDetails = async (snap, type) => {
  if (!snap) return null;
  const url = type === 'cp6' ? `/api/drr-cp6-snapshot/${snap.id}`
            : type === 'cp7' ? `/api/drr-cp7-snapshot/${snap.id}`
            : type === 'adas' ? `/api/drr-tl-snapshot/${snap.id}`
            : `/api/drr-cpfinal-snapshot/${snap.id}`;
  try {
    const res = await fetch(API_BASE + url);
    if (!res.ok) return snap;
    const json = await res.json();
    if (!json) return snap;
    
    let top = json.topDefects || json.top_defects;
    if (typeof top === 'string') {
      try { top = JSON.parse(top); } catch(e) { top = []; }
    }
    if (!Array.isArray(top)) {
      top = [];
    } else {
      top = top.filter(Boolean);
    }
    return { ...snap, ...json, topDefects: top };
  } catch (e) {
    return { ...snap, topDefects: [] };
  }
};

/* ===================== ОСНОВНОЙ КОМПОНЕНТ ===================== */
export default function DailyDashboardPage() {
  const [activeMainTab, setActiveMainTab] = useState('mbs');

  return (
    <div style={{ width: '100%', minHeight: '100vh', backgroundColor: '#F8FAFC', fontFamily: 'Inter, Segoe UI, Arial, sans-serif' }}>
      <div style={{ padding: 30, maxWidth: 1500, margin: '0 auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
          <h1 style={{ color: '#1E293B', fontSize: 32, fontWeight: 900, margin: 0 }}>QUALITY DAILY REPORT</h1>
          <div style={{ display: 'flex', gap: 12 }}>
            <button style={tabButtonStyle(activeMainTab === 'mbs')} onClick={() => setActiveMainTab('mbs')}>
              DAILY REPORT MBS
            </button>
            <button style={tabButtonStyle(activeMainTab === 'iot')} onClick={() => setActiveMainTab('iot')}>
              DAILY REPORT IOT
            </button>
          </div>
        </div>

        <ErrorBoundary>
          {activeMainTab === 'mbs' ? <DailyReportMBS /> : <DailyReportIOT />}
        </ErrorBoundary>
        
      </div>
    </div>
  );
}

/* ===================== НОВЫЙ ОТЧЕТ (MBS) ===================== */
function DailyReportMBS() {
  const [selectedWeekOffset, setSelectedWeekOffset] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    return toLocalDateStr(new Date()).slice(0, 7); // YYYY-MM
  });
  const [loading, setLoading] = useState(true);
  const [rawData, setRawData] = useState([]);

  // Генерируем список месяцев (текущий и 3 предыдущих)
  const monthOptions = useMemo(() => {
    const options = [];
    const today = new Date();
    for (let i = 0; i < 4; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const val = toLocalDateStr(d).slice(0, 7);
      const label = d.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
      options.push({ value: val, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
    return options;
  }, []);

  const weekOptions = useMemo(() => {
    const options = [];
    const today = new Date();
    for (let i = 0; i < 8; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * 7);
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      
      options.push({
        value: i,
        label: `CW${getISOWeek(toLocalDateStr(monday))} (${formatDateDDMM(toLocalDateStr(monday))} – ${formatDateDDMM(toLocalDateStr(sunday))})`,
        start: toLocalDateStr(monday),
        end: toLocalDateStr(sunday),
        days: Array.from({length: 7}, (_, idx) => {
            const dd = new Date(monday);
            dd.setDate(monday.getDate() + idx);
            return toLocalDateStr(dd);
        })
      });
    }
    return options;
  }, []);

  const currentWeek = weekOptions[selectedWeekOffset] || weekOptions[0] || { days: [], start: '', end: '' };
  const daysOfWeek = Array.isArray(currentWeek.days) ? currentWeek.days : [];

  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      setLoading(true);
      try {
        const [cp6Res, cp7Res, adasRes, cpfinalRes] = await Promise.all([
          fetch(`${API_BASE}/api/drr-cp6-snapshots?days=90&filter=all`).then(r => r.json()).catch(() => []),
          fetch(`${API_BASE}/api/drr-cp7-snapshots?days=90&filter=all`).then(r => r.json()).catch(() => []),
          fetch(`${API_BASE}/api/drr-tl-snapshots?days=90`).then(r => r.json()).catch(() => []),
          fetch(`${API_BASE}/api/drr-cpfinal-snapshots?days=90`).then(r => r.json()).catch(() => []),
        ]);
        
        if (cancelled) return;

        const cp6List = Array.isArray(cp6Res) ? cp6Res : [];
        const cp7List = Array.isArray(cp7Res) ? cp7Res : [];
        const adasList = Array.isArray(adasRes) ? adasRes : [];
        const cpfinalList = Array.isArray(cpfinalRes) ? cpfinalRes : [];

        const findSnap = (list, dateStr) => list.find(s => s && s.shiftDate === dateStr && s.shift === 'all');
        
        // Собираем дни для недели + все дни месяца
        const allDaysToFetch = new Set([...daysOfWeek]);
        const [year, month] = selectedMonth.split('-');
        const daysInMonth = new Date(Number(year), Number(month), 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
          allDaysToFetch.add(`${year}-${month}-${String(d).padStart(2, '0')}`);
        }

        const results = [];
        for (const day of Array.from(allDaysToFetch)) {
          const idCp6 = findSnap(cp6List, day);
          const idCp7 = findSnap(cp7List, day);
          const idAdas = findSnap(adasList, day);
          const idCpFinal = findSnap(cpfinalList, day);

          if (!idCp6 && !idCp7 && !idAdas && !idCpFinal) {
            results.push({ day, dCp6: null, dCp7: null, dAdas: null, dCpFinal: null });
            continue;
          }

          const [dCp6, dCp7, dAdas, dCpFinal] = await Promise.all([
            fetchSnapshotDetails(idCp6, 'cp6'),
            fetchSnapshotDetails(idCp7, 'cp7'),
            fetchSnapshotDetails(idAdas, 'adas'),
            fetchSnapshotDetails(idCpFinal, 'cpfinal'),
          ]);

          results.push({ day, dCp6, dCp7, dAdas, dCpFinal });
        }
        
        if (!cancelled) setRawData(results);
      } catch (err) {
        console.error('Ошибка загрузки MBS отчета:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadData();
    return () => { cancelled = true; };
  }, [daysOfWeek, selectedMonth]);

  // === ЕЖЕДНЕВНЫЕ МЕТРИКИ ===
  const daysMetrics = useMemo(() => {
    if (!daysOfWeek.length) return [];
    return daysOfWeek.map(day => {
      const dayData = rawData.find(r => r && r.day === day);
      if (!dayData || (!dayData.dCp6 && !dayData.dCp7 && !dayData.dAdas && !dayData.dCpFinal)) return null;
      
      const { dCp6, dCp7, dAdas, dCpFinal } = dayData;
      
      const getVals = (d) => {
        if (!d) return { def: 0, tot: 0, ok: 0, drr: 0 };
        // Защита: у CP6 поле okVins, у CP7 - closedVins, у CPFinal - okVins
        const def = d.topDefects?.reduce((s, x) => s + (Number(x?.defectCount) || 0), 0) || 0;
        return { 
          def, 
          tot: Number(d.totalVins) || 0, 
          ok: Number(d.closedVins || d.okVins) || 0, 
          drr: Number(d.drrPercent) || 0 
        };
      };

      const v6 = getVals(dCp6);
      const v7 = getVals(dCp7);
      const vA = getVals(dAdas);
      const vF = getVals(dCpFinal);

      const dpuCp6 = v6.tot ? v6.def / v6.tot : 0;
      const dpuCp7 = v7.tot ? v7.def / v7.tot : 0;
      const dpuAdas = vA.tot ? vA.def / vA.tot : 0;
      const dpuCpFinal = vF.tot ? vF.def / vF.tot : 0;

      return {
        drr: { cp6: v6.drr, cp7: v7.drr, adas: vA.drr, cpfinal: vF.drr },
        dpu: { cp6: dpuCp6, cp7: dpuCp7, adas: dpuAdas, cpfinal: dpuCpFinal },
        drrAvg: (v6.drr + v7.drr + vA.drr + vF.drr) / 4,
        drrMult: (v6.drr / 100) * (v7.drr / 100) * (vA.drr / 100) * (vF.drr / 100) * 100,
        drrSummed: (v6.tot + v7.tot + vA.tot + vF.tot) > 0 
          ? ((v6.ok + v7.ok + vA.ok + vF.ok) / (v6.tot + v7.tot + vA.tot + vF.tot)) * 100 
          : 0,
        dpuTotal: dpuCp6 + dpuCp7 + dpuAdas + dpuCpFinal,
        _raw: { 
          totCp6: v6.tot, totCp7: v7.tot, totAdas: vA.tot, totCpFinal: vF.tot,
          okCp6: v6.ok, okCp7: v7.ok, okAdas: vA.ok, okCpFinal: vF.ok,
          defCp6: v6.def, defCp7: v7.def, defAdas: vA.def, defCpFinal: vF.def
        }
      };
    });
  }, [rawData, daysOfWeek]);

  // === НЕДЕЛЬНЫЕ МЕТРИКИ ===
  const weekMetrics = useMemo(() => {
    const validDays = daysMetrics.filter(Boolean);
    const empty = { drr: { cp6: 0, cp7: 0, adas: 0, cpfinal: 0 }, dpu: { cp6: 0, cp7: 0, adas: 0, cpfinal: 0 }, drrAvg: 0, drrMult: 0, drrSummed: 0, dpuTotal: 0 };
    if (validDays.length === 0) return empty;

    let sums = {
      drr: { cp6: 0, cp7: 0, adas: 0, cpfinal: 0 },
      tot: { cp6: 0, cp7: 0, adas: 0, cpfinal: 0 },
      ok: { cp6: 0, cp7: 0, adas: 0, cpfinal: 0 },
      def: { cp6: 0, cp7: 0, adas: 0, cpfinal: 0 }
    };

    validDays.forEach(d => {
      sums.drr.cp6 += d.drr.cp6; sums.drr.cp7 += d.drr.cp7; sums.drr.adas += d.drr.adas; sums.drr.cpfinal += d.drr.cpfinal;
      sums.tot.cp6 += d._raw.totCp6; sums.tot.cp7 += d._raw.totCp7; sums.tot.adas += d._raw.totAdas; sums.tot.cpfinal += d._raw.totCpFinal;
      sums.ok.cp6 += d._raw.okCp6; sums.ok.cp7 += d._raw.okCp7; sums.ok.adas += d._raw.okAdas; sums.ok.cpfinal += d._raw.okCpFinal;
      sums.def.cp6 += d._raw.defCp6; sums.def.cp7 += d._raw.defCp7; sums.def.adas += d._raw.defAdas; sums.def.cpfinal += d._raw.defCpFinal;
    });

    const cnt = validDays.length;
    return {
      drr: { cp6: sums.drr.cp6/cnt, cp7: sums.drr.cp7/cnt, adas: sums.drr.adas/cnt, cpfinal: sums.drr.cpfinal/cnt },
      dpu: { 
        cp6: sums.tot.cp6 > 0 ? (sums.def.cp6 / sums.tot.cp6) : 0, 
        cp7: sums.tot.cp7 > 0 ? (sums.def.cp7 / sums.tot.cp7) : 0, 
        adas: sums.tot.adas > 0 ? (sums.def.adas / sums.tot.adas) : 0, 
        cpfinal: sums.tot.cpfinal > 0 ? (sums.def.cpfinal / sums.tot.cpfinal) : 0 
      },
      drrAvg: ((sums.drr.cp6 + sums.drr.cp7 + sums.drr.adas + sums.drr.cpfinal) / cnt) / 4,
      drrMult: ((sums.drr.cp6/cnt)/100) * ((sums.drr.cp7/cnt)/100) * ((sums.drr.adas/cnt)/100) * ((sums.drr.cpfinal/cnt)/100) * 100,
      drrSummed: (sums.tot.cp6 + sums.tot.cp7 + sums.tot.adas + sums.tot.cpfinal) > 0 
        ? ((sums.ok.cp6 + sums.ok.cp7 + sums.ok.adas + sums.ok.cpfinal) / (sums.tot.cp6 + sums.tot.cp7 + sums.tot.adas + sums.tot.cpfinal)) * 100 
        : 0,
      dpuTotal: (sums.tot.cp6 > 0 ? (sums.def.cp6 / sums.tot.cp6) : 0) + (sums.tot.cp7 > 0 ? (sums.def.cp7 / sums.tot.cp7) : 0) + (sums.tot.adas > 0 ? (sums.def.adas / sums.tot.adas) : 0) + (sums.tot.cpfinal > 0 ? (sums.def.cpfinal / sums.tot.cpfinal) : 0)
    };
  }, [daysMetrics]);

  // === МЕТРИКИ ЗА МЕСЯЦ ===
  const monthMetrics = useMemo(() => {
    const monthData = rawData.filter(r => r.day.startsWith(selectedMonth));
    const validDays = monthData.filter(r => r.dCp6 || r.dCp7 || r.dAdas || r.dCpFinal);
    
    const empty = { drr: { cp6: 0, cp7: 0, adas: 0, cpfinal: 0 }, dpu: { cp6: 0, cp7: 0, adas: 0, cpfinal: 0 }, drrAvg: 0, drrMult: 0, drrSummed: 0, dpuTotal: 0 };
    if (validDays.length === 0) return empty;

    let sums = {
      drr: { cp6: 0, cp7: 0, adas: 0, cpfinal: 0 },
      tot: { cp6: 0, cp7: 0, adas: 0, cpfinal: 0 },
      ok: { cp6: 0, cp7: 0, adas: 0, cpfinal: 0 },
      def: { cp6: 0, cp7: 0, adas: 0, cpfinal: 0 }
    };

    validDays.forEach(r => {
      const getVals = (d) => {
        if (!d) return { def: 0, tot: 0, ok: 0, drr: 0 };
        return { 
          def: d.topDefects?.reduce((s, x) => s + (Number(x?.defectCount) || 0), 0) || 0,
          tot: Number(d.totalVins) || 0, 
          ok: Number(d.closedVins || d.okVins) || 0, 
          drr: Number(d.drrPercent) || 0 
        };
      };
      
      const v6 = getVals(r.dCp6);
      const v7 = getVals(r.dCp7);
      const vA = getVals(r.dAdas);
      const vF = getVals(r.dCpFinal);

      sums.drr.cp6 += v6.drr; sums.drr.cp7 += v7.drr; sums.drr.adas += vA.drr; sums.drr.cpfinal += vF.drr;
      sums.tot.cp6 += v6.tot; sums.tot.cp7 += v7.tot; sums.tot.adas += vA.tot; sums.tot.cpfinal += vF.tot;
      sums.ok.cp6 += v6.ok; sums.ok.cp7 += v7.ok; sums.ok.adas += vA.ok; sums.ok.cpfinal += vF.ok;
      sums.def.cp6 += v6.def; sums.def.cp7 += v7.def; sums.def.adas += vA.def; sums.def.cpfinal += vF.def;
    });

    const cnt = validDays.length;
    return {
      drr: { cp6: sums.drr.cp6/cnt, cp7: sums.drr.cp7/cnt, adas: sums.drr.adas/cnt, cpfinal: sums.drr.cpfinal/cnt },
      dpu: { 
        cp6: sums.tot.cp6 > 0 ? (sums.def.cp6 / sums.tot.cp6) : 0, 
        cp7: sums.tot.cp7 > 0 ? (sums.def.cp7 / sums.tot.cp7) : 0, 
        adas: sums.tot.adas > 0 ? (sums.def.adas / sums.tot.adas) : 0, 
        cpfinal: sums.tot.cpfinal > 0 ? (sums.def.cpfinal / sums.tot.cpfinal) : 0 
      },
      drrAvg: ((sums.drr.cp6 + sums.drr.cp7 + sums.drr.adas + sums.drr.cpfinal) / cnt) / 4,
      drrMult: ((sums.drr.cp6/cnt)/100) * ((sums.drr.cp7/cnt)/100) * ((sums.drr.adas/cnt)/100) * ((sums.drr.cpfinal/cnt)/100) * 100,
      drrSummed: (sums.tot.cp6 + sums.tot.cp7 + sums.tot.adas + sums.tot.cpfinal) > 0 
        ? ((sums.ok.cp6 + sums.ok.cp7 + sums.ok.adas + sums.ok.cpfinal) / (sums.tot.cp6 + sums.tot.cp7 + sums.tot.adas + sums.tot.cpfinal)) * 100 
        : 0,
      dpuTotal: (sums.tot.cp6 > 0 ? (sums.def.cp6 / sums.tot.cp6) : 0) + (sums.tot.cp7 > 0 ? (sums.def.cp7 / sums.tot.cp7) : 0) + (sums.tot.adas > 0 ? (sums.def.adas / sums.tot.adas) : 0) + (sums.tot.cpfinal > 0 ? (sums.def.cpfinal / sums.tot.cpfinal) : 0)
    };
  }, [rawData, selectedMonth]);

  const allDefects = useMemo(() => {
    const defectsList = [];
    
    rawData.forEach(({ dCp6, dCp7, dAdas, dCpFinal }) => {
      // === ДОБАВЛЕН CP6 ===
      if (Array.isArray(dCp6?.topDefects)) {
        dCp6.topDefects.forEach(item => {
          if (!item) return;
          defectsList.push({ circle: 'CP6', mpp: item.mpp || '—', count: Number(item.defectCount) || 0 });
        });
      }
      if (Array.isArray(dCp7?.topDefects)) {
        dCp7.topDefects.forEach(item => {
          if (!item) return;
          defectsList.push({ circle: 'CP7', mpp: item.mpp || '—', count: Number(item.defectCount) || 0 });
        });
      }
      if (Array.isArray(dAdas?.topDefects)) {
        dAdas.topDefects.forEach(item => {
          if (!item) return;
          defectsList.push({ circle: 'ADAS', mpp: item.mpp || '—', count: Number(item.defectCount) || 0 });
        });
      }
      if (Array.isArray(dCpFinal?.topDefects)) {
        dCpFinal.topDefects.forEach(item => {
          if (!item) return;
          defectsList.push({ circle: 'CPFinal', mpp: item.mpp || '—', count: Number(item.defectCount) || 0 });
        });
      }
    });

    const grouped = Object.values(defectsList.reduce((acc, curr) => {
      const key = `${curr.circle}_${curr.mpp}`;
      if (!acc[key]) acc[key] = { ...curr };
      else acc[key].count += curr.count;
      return acc;
    }, {}));
    
    return grouped.sort((a, b) => b.count - a.count);
  }, [rawData]);

  const fmt = (val, isDpu = false) => {
    if (val === undefined || val === null || isNaN(val)) return '—';
    if (isDpu) return Number(val).toFixed(2);
    return `${Number(val).toFixed(1)}%`;
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#64748B', fontSize: '1.2rem' }}>Загрузка данных снапшотов...</div>;
  }

  return (
    <div>
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, color: '#475569' }}>Неделя:</span>
          <select 
            value={selectedWeekOffset} 
            onChange={e => setSelectedWeekOffset(Number(e.target.value))} 
            style={{ ...inputStyle, minWidth: 200, fontWeight: 600, color: '#1E293B' }}
          >
            {weekOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, color: '#475569' }}>Месяц:</span>
          <select 
            value={selectedMonth} 
            onChange={e => setSelectedMonth(e.target.value)} 
            style={{ ...inputStyle, minWidth: 150, fontWeight: 600, color: '#1E293B' }}
          >
            {monthOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 16, color: '#1E293B' }}>Показатели за неделю и месяц</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left' }}>Показатель</th>
                <th style={thStyle}>Месяц</th>
                <th style={thStyle}>Неделя</th>
                {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day, i) => (
                  <th key={day} style={thStyle}>
                    {day}<br/><span style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 500 }}>{formatDateDDMM(daysOfWeek[i])}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={tdRowHeaderStyle}>DRR CP6</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#7C3AED', backgroundColor: '#F3E8FF' }}>{fmt(monthMetrics.drr.cp6)}</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#7C3AED', backgroundColor: '#F3E8FF' }}>{fmt(weekMetrics.drr.cp6)}</td>
                {daysMetrics.map((m, i) => <td key={i} style={tdStyle}>{m ? fmt(m.drr.cp6) : '—'}</td>)}
              </tr>
              <tr>
                <td style={tdRowHeaderStyle}>DRR CP7</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#2563EB', backgroundColor: '#EFF6FF' }}>{fmt(monthMetrics.drr.cp7)}</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#2563EB', backgroundColor: '#EFF6FF' }}>{fmt(weekMetrics.drr.cp7)}</td>
                {daysMetrics.map((m, i) => <td key={i} style={tdStyle}>{m ? fmt(m.drr.cp7) : '—'}</td>)}
              </tr>
              <tr>
                <td style={tdRowHeaderStyle}>DRR ADAS</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#2563EB', backgroundColor: '#EFF6FF' }}>{fmt(monthMetrics.drr.adas)}</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#2563EB', backgroundColor: '#EFF6FF' }}>{fmt(weekMetrics.drr.adas)}</td>
                {daysMetrics.map((m, i) => <td key={i} style={tdStyle}>{m ? fmt(m.drr.adas) : '—'}</td>)}
              </tr>
              <tr>
                <td style={tdRowHeaderStyle}>DRR CPFinal</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#2563EB', backgroundColor: '#EFF6FF' }}>{fmt(monthMetrics.drr.cpfinal)}</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#2563EB', backgroundColor: '#EFF6FF' }}>{fmt(weekMetrics.drr.cpfinal)}</td>
                {daysMetrics.map((m, i) => <td key={i} style={tdStyle}>{m ? fmt(m.drr.cpfinal) : '—'}</td>)}
              </tr>
              <tr>
                <td style={tdRowHeaderStyle}>DPU CP6</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#D97706', backgroundColor: '#FEF3C7' }}>{fmt(monthMetrics.dpu.cp6, true)}</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#D97706', backgroundColor: '#FEF3C7' }}>{fmt(weekMetrics.dpu.cp6, true)}</td>
                {daysMetrics.map((m, i) => <td key={i} style={tdStyle}>{m ? fmt(m.dpu.cp6, true) : '—'}</td>)}
              </tr>
              <tr>
                <td style={tdRowHeaderStyle}>DPU CP7</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#D97706', backgroundColor: '#FEF3C7' }}>{fmt(monthMetrics.dpu.cp7, true)}</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#D97706', backgroundColor: '#FEF3C7' }}>{fmt(weekMetrics.dpu.cp7, true)}</td>
                {daysMetrics.map((m, i) => <td key={i} style={tdStyle}>{m ? fmt(m.dpu.cp7, true) : '—'}</td>)}
              </tr>
              <tr>
                <td style={tdRowHeaderStyle}>DPU ADAS</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#D97706', backgroundColor: '#FEF3C7' }}>{fmt(monthMetrics.dpu.adas, true)}</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#D97706', backgroundColor: '#FEF3C7' }}>{fmt(weekMetrics.dpu.adas, true)}</td>
                {daysMetrics.map((m, i) => <td key={i} style={tdStyle}>{m ? fmt(m.dpu.adas, true) : '—'}</td>)}
              </tr>
              <tr>
                <td style={tdRowHeaderStyle}>DPU CPFinal</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#D97706', backgroundColor: '#FEF3C7' }}>{fmt(monthMetrics.dpu.cpfinal, true)}</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#D97706', backgroundColor: '#FEF3C7' }}>{fmt(weekMetrics.dpu.cpfinal, true)}</td>
                {daysMetrics.map((m, i) => <td key={i} style={tdStyle}>{m ? fmt(m.dpu.cpfinal, true) : '—'}</td>)}
              </tr>
              <tr style={{ backgroundColor: '#FFF7ED' }}>
                <td style={{ ...tdRowHeaderStyle, backgroundColor: '#FFEDD5' }}>DPU Общий (Сумма)</td>
                <td style={{ ...tdStyle, fontWeight: 800, color: '#C2410C' }}>{fmt(monthMetrics.dpuTotal, true)}</td>
                <td style={{ ...tdStyle, fontWeight: 800, color: '#C2410C' }}>{fmt(weekMetrics.dpuTotal, true)}</td>
                {daysMetrics.map((m, i) => <td key={i} style={{ ...tdStyle, fontWeight: 600, color: '#C2410C' }}>{m ? fmt(m.dpuTotal, true) : '—'}</td>)}
              </tr>
              <tr style={{ backgroundColor: '#F8FAFC' }}>
                <td style={{ ...tdRowHeaderStyle, borderTop: '2px solid #E2E8F0' }}>DRR Усредненный</td>
                <td style={{ ...tdStyle, fontWeight: 800, color: '#059669', borderTop: '2px solid #E2E8F0' }}>{fmt(monthMetrics.drrAvg)}</td>
                <td style={{ ...tdStyle, fontWeight: 800, color: '#059669', borderTop: '2px solid #E2E8F0' }}>{fmt(weekMetrics.drrAvg)}</td>
                {daysMetrics.map((m, i) => <td key={i} style={{ ...tdStyle, borderTop: '2px solid #E2E8F0', fontWeight: 600 }}>{m ? fmt(m.drrAvg) : '—'}</td>)}
              </tr>
              <tr style={{ backgroundColor: '#F8FAFC' }}>
                <td style={tdRowHeaderStyle}>DRR Перемноженный</td>
                <td style={{ ...tdStyle, fontWeight: 800, color: '#059669' }}>{fmt(monthMetrics.drrMult)}</td>
                <td style={{ ...tdStyle, fontWeight: 800, color: '#059669' }}>{fmt(weekMetrics.drrMult)}</td>
                {daysMetrics.map((m, i) => <td key={i} style={{ ...tdStyle, fontWeight: 600 }}>{m ? fmt(m.drrMult) : '—'}</td>)}
              </tr>
              <tr style={{ backgroundColor: '#F8FAFC' }}>
                <td style={tdRowHeaderStyle}>DRR Суммированный</td>
                <td style={{ ...tdStyle, fontWeight: 800, color: '#059669' }}>{fmt(monthMetrics.drrSummed)}</td>
                <td style={{ ...tdStyle, fontWeight: 800, color: '#059669' }}>{fmt(weekMetrics.drrSummed)}</td>
                {daysMetrics.map((m, i) => <td key={i} style={{ ...tdStyle, fontWeight: 600 }}>{m ? fmt(m.drrSummed) : '—'}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1E293B', margin: 0 }}>Топ дефектов за неделю</h2>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: '20%' }}>Кружок</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>MPP</th>
              <th style={{ ...thStyle, width: '15%' }}>Кол-во</th>
            </tr>
          </thead>
          <tbody>
            {allDefects.length === 0 ? (
              <tr><td colSpan={3} style={{ ...tdStyle, padding: 20, color: '#94A3B8' }}>Нет данных о дефектах</td></tr>
            ) : (
              allDefects.map((item, idx) => (
                <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                  <td style={{ ...tdStyle, fontWeight: 700, color: item.circle === 'CP6' ? '#7C3AED' : item.circle === 'CP7' ? '#2563EB' : item.circle === 'ADAS' ? '#8B5CF6' : '#10B981' }}>
                    {item.circle}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'left' }}>{item.mpp}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{item.count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===================== СТАРЫЙ ОТЧЕТ (IOT) ===================== */
function DailyReportIOT() {
  const [useEnglish, setUseEnglish] = useState(false);
  const [weekData, setWeekData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedWeekOffset, setSelectedWeekOffset] = useState(0);
  const [shiftFilter, setShiftFilter] = useState('all');

  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }, []);

  const [showTop3Filter, setShowTop3Filter] = useState(false);
  const [top3DateFrom, setTop3DateFrom] = useState(yesterday);
  const [top3DateTo, setTop3DateTo] = useState(yesterday);
  const [top3RawData, setTop3RawData] = useState([]);
  const [top3Translated, setTop3Translated] = useState([]);
  const [top3Loading, setTop3Loading] = useState(false);

  const [selectedGrades, setSelectedGrades] = useState(['A', 'B', 'A1', 'B1']);
  const [availableGrades, setAvailableGrades] = useState([]);
  const [showGradeFilter, setShowGradeFilter] = useState(false);
  const [showTop5Filter, setShowTop5Filter] = useState(false);
  const [top5DateFrom, setTop5DateFrom] = useState(yesterday);
  const [top5DateTo, setTop5DateTo] = useState(yesterday);
  const [top5RawData, setTop5RawData] = useState([]);
  const [top5Translated, setTop5Translated] = useState([]);
  const [top5Loading, setTop5Loading] = useState(false);

  const [weekTop3Data, setWeekTop3Data] = useState([]);
  const [weekTop3Loading, setWeekTop3Loading] = useState(false);

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
      });
    }
    return options;
  }, []);

  const currentWeek = weekOptions[selectedWeekOffset] || weekOptions[0] || { start: '', end: '' };

  useEffect(() => {
    fetch(`${API_BASE}/api/problem-grades`)
      .then(res => res.json())
      .then(grades => setAvailableGrades(Array.isArray(grades) ? grades : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      weekStart: currentWeek.start || '',
      weekEnd: currentWeek.end || '',
      shift: shiftFilter,
    });
    fetch(`${API_BASE}/api/daily-dashboard-week?${params.toString()}`)
      .then(res => res.json())
      .then(json => {
        setWeekData(json);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [selectedWeekOffset, currentWeek.start, currentWeek.end, shiftFilter]);

  const loadTop3 = () => {
    setTop3Loading(true);
    const params = new URLSearchParams({
      dateFrom: top3DateFrom,
      dateTo: top3DateTo,
    });
    fetch(`${API_BASE}/api/daily-dashboard-top3?${params.toString()}`)
      .then(res => res.json())
      .then(json => {
        setTop3RawData(Array.isArray(json) ? json : []);
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
        setTop5RawData(Array.isArray(json) ? json : []);
        setTop5Loading(false);
      })
      .catch(() => setTop5Loading(false));
  };

  useEffect(() => {
    if (!currentWeek.start || !currentWeek.end) return;
    setWeekTop3Loading(true);
    const params = new URLSearchParams({
      dateFrom: currentWeek.start,
      dateTo: currentWeek.end,
      shift: shiftFilter,
    });
    fetch(`${API_BASE}/api/daily-dashboard-week-top3?${params.toString()}`)
      .then(res => res.json())
      .then(json => setWeekTop3Data(Array.isArray(json) ? json : []))
      .catch(() => setWeekTop3Data([]))
      .finally(() => setWeekTop3Loading(false));
  }, [currentWeek.start, currentWeek.end, shiftFilter]);

  useEffect(() => {
    if (weekData) {
      loadTop3();
      loadTop5();
    }
  }, [weekData]);

  useEffect(() => {
    if (useEnglish && top3RawData.length > 0) {
      Promise.all(top3RawData.map(async (item) => ({ ...item, defect: (await translateText(item.defect)).toUpperCase() })))
        .then(setTop3Translated);
    } else setTop3Translated([]);
  }, [useEnglish, top3RawData]);

  useEffect(() => {
    if (useEnglish && top5RawData.length > 0) {
      Promise.all(top5RawData.map(async (item) => ({ ...item, defect: (await translateText(item.defect)).toUpperCase() })))
        .then(setTop5Translated);
    } else setTop5Translated([]);
  }, [useEnglish, top5RawData]);

  useEffect(() => { loadTop3(); }, [top3DateFrom, top3DateTo]);
  useEffect(() => { loadTop5(); }, [top5DateFrom, top5DateTo, selectedGrades]);

  const handleGradeToggle = (grade) => {
    setSelectedGrades(prev => prev.includes(grade) ? prev.filter(g => g !== grade) : [...prev, grade]);
  };

  const top3Data = useEnglish && top3Translated.length > 0 ? top3Translated : top3RawData;
  const top5Data = useEnglish && top5Translated.length > 0 ? top5Translated : top5RawData;

  if (loading) {
    return <p style={{ color: '#6B7280' }}>Загрузка...</p>;
  }

  if (!weekData || typeof weekData !== 'object') {
    return <div style={cardStyle}><p style={{ color: '#6B7280', textAlign: 'center' }}>Нет данных</p></div>;
  }

  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const daysArr = Array.isArray(weekData.days) ? weekData.days : [];
  const drrArr = Array.isArray(weekData.drr) ? weekData.drr : [];
  const dpuArr = Array.isArray(weekData.dpuOff) ? weekData.dpuOff : [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={shiftFilter} onChange={e => setShiftFilter(e.target.value)} style={{ ...inputStyleIot, padding: '8px 16px', fontSize: 14 }}>
            <option value="all">Сутки</option>
            <option value="day">День</option>
            <option value="evening">Вечер</option>
            <option value="night">Ночь</option>
          </select>
          <button onClick={() => setUseEnglish(!useEnglish)} style={{
            padding: '8px 16px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14,
            background: useEnglish ? '#2563EB' : '#FFFFFF', color: useEnglish ? '#FFFFFF' : '#374151',
            fontWeight: 500, cursor: 'pointer',
          }}>{useEnglish ? 'EN' : 'RU'}</button>
          <select value={selectedWeekOffset} onChange={e => setSelectedWeekOffset(Number(e.target.value))} style={{ ...inputStyleIot, padding: '8px 16px', fontSize: 14 }}>
            {weekOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: '#1F2937' }}>
          CW{weekData.weekNumber || ''}{' '}
          <span style={{ fontSize: 14, fontWeight: 400, color: '#6B7280' }}>({weekData.weekStart || ''} – {weekData.weekEnd || ''})</span>
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                <th style={thStyleIot}></th>
                <th style={thStyleIot}>CW{weekData.weekNumber || ''}</th>
                {dayLabels.map((day, i) => (
                  <th key={day} style={thStyleIot}>{day}<br/>{daysArr[i]?.slice(5) || ''}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ ...tdStyleIot, fontWeight: 600 }}>DRR</td>
                <td style={tdStyleIot}>{weekData.weekDrr || '—'}</td>
                {drrArr.map((val, i) => <td key={i} style={tdStyleIot}>{val}</td>)}
              </tr>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <td style={{ ...tdStyleIot, fontWeight: 600 }}>Target DRR</td>
                <td style={tdStyleIot}>60</td>
                {dayLabels.map((_, i) => <td key={i} style={tdStyleIot}>60</td>)}
              </tr>
              <tr>
                <td style={{ ...tdStyleIot, fontWeight: 600 }}>DPU</td>
                <td style={tdStyleIot}>{weekData.weekDpuOff || '—'}</td>
                {dpuArr.map((val, i) => <td key={i} style={tdStyleIot}>{val}</td>)}
              </tr>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <td style={{ ...tdStyleIot, fontWeight: 600 }}>Target DPU</td>
                <td style={tdStyleIot}>0.4</td>
                {dayLabels.map((_, i) => <td key={i} style={tdStyleIot}>0.4</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ ...cardStyle, flex: 1, minWidth: 300 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1F2937', margin: 0 }}>DRR TOP 3</h2>
            <button onClick={() => setShowTop3Filter(!showTop3Filter)} style={{
              background: showTop3Filter ? '#2563EB' : '#F3F4F6', color: showTop3Filter ? '#FFFFFF' : '#374151',
              border: 'none', padding: '6px 14px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}>{showTop3Filter ? 'Скрыть фильтр' : 'Фильтр'}</button>
          </div>
          {showTop3Filter && (
            <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#6B7280' }}>с</span>
              <input type="date" value={top3DateFrom} onChange={e => setTop3DateFrom(e.target.value)} style={inputStyleIot} />
              <span style={{ fontSize: 12, color: '#6B7280' }}>по</span>
              <input type="date" value={top3DateTo} onChange={e => setTop3DateTo(e.target.value)} style={inputStyleIot} />
            </div>
          )}
          {top3Loading ? <p style={{ color: '#6B7280', textAlign: 'center', padding: 10 }}>Загрузка...</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr><th style={thStyleIot}>DEFECT</th><th style={thStyleIot}>COUNT</th></tr></thead>
              <tbody>
                {Array.isArray(top3Data) && top3Data.map((item, idx) => (
                  <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#F9FAFB' : 'white' }}>
                    <td style={tdStyleIot}>{item.defect}</td>
                    <td style={tdStyleIot}>{item.count}</td>
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
                background: showTop5Filter ? '#2563EB' : '#F3F4F6', color: showTop5Filter ? '#FFFFFF' : '#374151',
                border: 'none', padding: '6px 14px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
              }}>{showTop5Filter ? 'Скрыть фильтр' : 'Фильтр'}</button>
              <button onClick={() => setShowGradeFilter(!showGradeFilter)} style={{
                background: showGradeFilter ? '#2563EB' : '#F3F4F6', color: showGradeFilter ? '#FFFFFF' : '#374151',
                border: 'none', padding: '6px 14px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
              }}>{showGradeFilter ? 'Скрыть классы' : 'Классы дефектов'}</button>
            </div>
          </div>
          {showTop5Filter && (
            <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#6B7280' }}>с</span>
              <input type="date" value={top5DateFrom} onChange={e => setTop5DateFrom(e.target.value)} style={inputStyleIot} />
              <span style={{ fontSize: 12, color: '#6B7280' }}>по</span>
              <input type="date" value={top5DateTo} onChange={e => setTop5DateTo(e.target.value)} style={inputStyleIot} />
            </div>
          )}
          {showGradeFilter && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {Array.isArray(availableGrades) && availableGrades.map(grade => (
                <label key={grade} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={selectedGrades.includes(grade)} onChange={() => handleGradeToggle(grade)} />
                  {grade}
                </label>
              ))}
            </div>
          )}
          {top5Loading ? <p style={{ color: '#6B7280', textAlign: 'center', padding: 10 }}>Загрузка...</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr><th style={thStyleIot}>DEFECT</th><th style={thStyleIot}>COUNT</th></tr></thead>
              <tbody>
                {Array.isArray(top5Data) && top5Data.map((item, idx) => (
                  <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#F9FAFB' : 'white' }}>
                    <td style={tdStyleIot}>{item.defect}</td>
                    <td style={tdStyleIot}>{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{ ...cardStyle }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1F2937', margin: '0 0 12px 0' }}>
          DRR TOP 3 — неделя CW{weekData.weekNumber || ''}
          <span style={{ fontSize: 14, fontWeight: 400, color: '#6B7280', marginLeft: 8 }}>
            ({weekData.weekStart || ''} – {weekData.weekEnd || ''})
          </span>
        </h2>
        {weekTop3Loading ? <p style={{ color: '#6B7280', textAlign: 'center', padding: 10 }}>Загрузка...</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                <th style={thStyleIot}>DEFECT</th>
                <th style={{ ...thStyleIot, width: 120 }}>COUNT</th>
              </tr>
            </thead>
            <tbody>
              {!Array.isArray(weekTop3Data) || weekTop3Data.length === 0 ? (
                <tr><td colSpan={2} style={{ ...tdStyleIot, color: '#94A3B8' }}>Нет данных</td></tr>
              ) : weekTop3Data.map((item, idx) => (
                <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#F9FAFB' : 'white' }}>
                  <td style={{ ...tdStyleIot, textAlign: 'left' }}>{item.defect}</td>
                  <td style={tdStyleIot}>{item.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}