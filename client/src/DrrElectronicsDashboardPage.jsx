import React, { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const API_BASE = '';

// ====== СТИЛИ ======
const containerStyle = {
  padding: '20px',
  fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
  width: '100%',
  height: '125vh',
  boxSizing: 'border-box',
  backgroundColor: '#F8FAFC',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  zoom: 0.8,
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '20px',
  flexShrink: 0,
};

const titleStyle = {
  fontSize: '2.5rem',
  fontWeight: 900,
  color: '#1E293B',
  margin: 0,
};

const filterGroupStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
};

const filterButtonStyle = (active) => ({
  padding: '12px 24px',
  borderRadius: '12px',
  border: 'none',
  fontWeight: 700,
  fontSize: '1.4rem',
  background: active ? '#2563EB' : '#FFFFFF',
  color: active ? '#FFFFFF' : '#64748B',
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  transition: 'all 0.2s',
});

const timeFilterButtonStyle = (active, activeColor) => ({
  ...filterButtonStyle(active),
  background: active ? activeColor : '#FFFFFF',
  color: active ? '#FFFFFF' : '#64748B',
});

const dashboardGridStyle = {
  display: 'flex',
  gap: '20px',
  flex: 1,
  minHeight: 0,
};

const chartColumnStyle = {
  flex: '0 0 40%',
  backgroundColor: '#FFFFFF',
  borderRadius: '24px',
  padding: '24px',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
  minHeight: 0,
};

const rightColumnStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const tableCardStyle = {
  flex: 1,
  backgroundColor: '#FFFFFF',
  borderRadius: '24px',
  padding: '24px',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
  minHeight: 0,
};

const tableTitleStyle = {
  fontSize: '2rem',
  fontWeight: 800,
  color: '#1E293B',
  margin: '0 0 16px 0',
};

const tableScrollStyle = {
  flex: 1,
  overflowY: 'auto',
  border: '1px solid #E2E8F0',
  borderRadius: '12px',
};

const thStyle = {
  padding: '16px 24px',
  textAlign: 'left',
  fontWeight: 800,
  color: '#475569',
  borderBottom: '3px solid #E2E8F0',
  background: '#F8FAFC',
  fontSize: '1.3rem',
  textTransform: 'uppercase',
  position: 'sticky',
  top: 0,
  zIndex: 10,
};

const tdStyle = {
  padding: '16px 24px',
  borderBottom: '1px solid #F1F5F9',
  color: '#1E293B',
  fontSize: '1.6rem',
};

const PIE_COLORS = ['#10B981', '#EF4444'];

// ====== ХЕЛПЕРЫ ДЛЯ ВРЕМЕНИ ======
const getMoscowTime = () => new Date(Date.now() + 3 * 60 * 60 * 1000);

const getMoscowMinutes = () => {
  const moscow = getMoscowTime();
  return moscow.getUTCHours() * 60 + moscow.getUTCMinutes();
};

const getDefaultTimeFilter = () => {
  const totalMinutes = getMoscowMinutes();
  if (totalMinutes >= 1 * 60 + 31 && totalMinutes < 7 * 60 + 50) return 'night';
  if (totalMinutes >= 7 * 60 + 50 && totalMinutes < 16 * 60 + 41) return 'day';
  return 'evening';
};

const getTimeRange = (timeFilter) => {
  const nowMoscow = getMoscowTime();
  const year = nowMoscow.getUTCFullYear();
  const month = String(nowMoscow.getUTCMonth() + 1).padStart(2, '0');
  const day = String(nowMoscow.getUTCDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  const yesterday = new Date(nowMoscow);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yestYear = yesterday.getUTCFullYear();
  const yestMonth = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
  const yestDay = String(yesterday.getUTCDate()).padStart(2, '0');
  const yesterdayStr = `${yestYear}-${yestMonth}-${yestDay}`;

  const totalMinutes = getMoscowMinutes();

  if (timeFilter === 'all') {
    return { start: `${todayStr} 00:00:00`, end: `${todayStr} 23:59:59` };
  }
  if (timeFilter === 'day') {
    const dateToUse = totalMinutes >= 7 * 60 + 50 ? todayStr : yesterdayStr;
    return { start: `${dateToUse} 07:50:00`, end: `${dateToUse} 16:40:00` };
  }
  if (timeFilter === 'evening') {
    const dateToUse = totalMinutes >= 16 * 60 + 41 ? todayStr : yesterdayStr;
    const startDateObj = new Date(`${dateToUse}T00:00:00Z`);
    const endDateObj = new Date(startDateObj);
    endDateObj.setUTCDate(endDateObj.getUTCDate() + 1);
    const endStr = `${endDateObj.getUTCFullYear()}-${String(endDateObj.getUTCMonth() + 1).padStart(2, '0')}-${String(endDateObj.getUTCDate()).padStart(2, '0')}`;
    return { start: `${dateToUse} 16:41:00`, end: `${endStr} 01:30:00` };
  }
  if (timeFilter === 'night') {
    const dateToUse = totalMinutes >= 1 * 60 + 31 ? todayStr : yesterdayStr;
    return { start: `${dateToUse} 01:31:00`, end: `${dateToUse} 07:50:00` };
  }
  return { start: `${todayStr} 00:00:00`, end: `${todayStr} 23:59:59` };
};

const getArchiveRange = (shiftDate, shift) => {
  if (shift === 'all')     return { start: `${shiftDate} 00:00:00`, end: `${shiftDate} 23:59:59` };
  if (shift === 'day')     return { start: `${shiftDate} 07:50:00`, end: `${shiftDate} 16:40:00` };
  if (shift === 'night')   return { start: `${shiftDate} 01:31:00`, end: `${shiftDate} 07:50:00` };
  if (shift === 'evening') {
    const next = new Date(`${shiftDate}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    return { start: `${shiftDate} 16:41:00`, end: `${nextStr} 01:30:00` };
  }
  return null;
};

const getWeekNumber = (date) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};

const getCurrentShiftInfo = () => {
  const nowMoscow = getMoscowTime();
  const totalMinutes = getMoscowMinutes();
  let shiftDate = new Date(nowMoscow);
  let shiftType = 'night';

  if (totalMinutes >= 7 * 60 + 50 && totalMinutes <= 16 * 60 + 40) {
    shiftType = 'day';
  } else if (totalMinutes >= 16 * 60 + 41 || totalMinutes <= 1 * 60 + 30) {
    shiftType = 'evening';
    if (totalMinutes <= 1 * 60 + 30) {
      shiftDate.setUTCDate(shiftDate.getUTCDate() - 1);
    }
  } else {
    shiftType = 'night';
  }

  const weekNumber = getWeekNumber(shiftDate);
  const isEvenWeek = weekNumber % 2 === 0;
  let shiftLetter = 'C';
  if (shiftType === 'night') shiftLetter = 'C';
  else if (shiftType === 'day') shiftLetter = isEvenWeek ? 'B' : 'A';
  else if (shiftType === 'evening') shiftLetter = isEvenWeek ? 'A' : 'B';

  return { weekNumber, shiftLetter, shiftType };
};

export default function DrrElectronicsDashboardPage() {
  const [timeFilter, setTimeFilter] = useState(getDefaultTimeFilter());
  const [isManualFilter, setIsManualFilter] = useState(false);
  const [shiftInfo, setShiftInfo] = useState(getCurrentShiftInfo());
  
  const [drrData, setDrrData] = useState({ totalVins: 0, closedVins: 0, nokVins: 0, drrPercent: 0 });
  const [topDefects, setTopDefects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // === ИСТОРИЯ ===
  const [snapshots, setSnapshots] = useState([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('live');
  const [archiveShift, setArchiveShift] = useState(null);
  const isArchive = selectedSnapshotId !== 'live';

  const [vinList, setVinList] = useState([]);
  const [vinListStatus, setVinListStatus] = useState('');
  const [showVinModal, setShowVinModal] = useState(false);
  const [vinModalLoading, setVinModalLoading] = useState(false);

  const [mppVins, setMppVins] = useState([]);
  const [mppModalTitle, setMppModalTitle] = useState('');
  const [showMppModal, setShowMppModal] = useState(false);
  const [mppModalLoading, setMppModalLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const { start, end } = getTimeRange(timeFilter);
      const params = new URLSearchParams({ startTime: start, endTime: end });
      const qs = params.toString();

      const [drrRes, defectsRes] = await Promise.all([
        fetch(`${API_BASE}/api/drr-electronics-bms-dashboard?${qs}`),
        fetch(`${API_BASE}/api/drr-electronics-bms-top-defects?${qs}`)
      ]);

      if (!drrRes.ok) throw new Error('Ошибка загрузки DRR');
      if (!defectsRes.ok) throw new Error('Ошибка загрузки топа дефектов');

      const [drrJson, defectsJson] = await Promise.all([
        drrRes.json(),
        defectsRes.json()
      ]);

      setDrrData(drrJson);
      setTopDefects(Array.isArray(defectsJson) ? defectsJson : []);
      setShiftInfo(getCurrentShiftInfo());
      setArchiveShift(null);
    } catch (err) {
      setError(err.message);
      setTopDefects([]);
    } finally {
      setLoading(false);
    }
  };

  const loadSnapshot = async (id) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/drr-electronics-snapshot/${id}`);
      if (!res.ok) throw new Error('Ошибка загрузки снимка');
      const json = await res.json();
      
      setDrrData({
        totalVins: json.totalVins || 0,
        closedVins: json.closedVins || 0,
        nokVins: json.nokVins || 0,
        drrPercent: json.drrPercent || 0,
      });
      setTopDefects(Array.isArray(json.topDefects) ? json.topDefects : []);

      setShiftInfo({
        weekNumber: json.weekNumber != null ? json.weekNumber : '—',
        shiftLetter: json.shiftLetter != null ? json.shiftLetter : '—',
        shiftType: json.shift || 'all',
      });
      setArchiveShift({ shiftDate: json.shiftDate, shift: json.shift });
    } catch (err) {
      setError(err.message);
      setTopDefects([]);
    } finally {
      setLoading(false);
    }
  };

  // Загрузка списка снимков
  useEffect(() => {
    fetch(`${API_BASE}/api/drr-electronics-snapshots?days=14`)
      .then(res => res.json())
      .then(json => {
        const list = Array.isArray(json) ? json : [];
        setSnapshots(list);
        if (selectedSnapshotId !== 'live' && !list.some(s => String(s.id) === String(selectedSnapshotId))) {
          setSelectedSnapshotId('live');
        }
      })
      .catch(() => setSnapshots([]));
  }, []);

  useEffect(() => {
    if (selectedSnapshotId === 'live') {
      loadData();
    } else {
      loadSnapshot(selectedSnapshotId);
    }
  }, [selectedSnapshotId, timeFilter]);

  useEffect(() => {
    if (selectedSnapshotId === 'live') {
      setShiftInfo(getCurrentShiftInfo());
      setArchiveShift(null);
    }
  }, [selectedSnapshotId]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (selectedSnapshotId === 'live') {
        setShiftInfo(getCurrentShiftInfo());
        if (!isManualFilter) setTimeFilter(getDefaultTimeFilter());
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [isManualFilter, selectedSnapshotId]);

  useEffect(() => {
    if (selectedSnapshotId !== 'live') return;
    const interval = setInterval(loadData, 180000);
    return () => clearInterval(interval);
  }, [timeFilter, selectedSnapshotId]);

  const loadVinList = async (status) => {
    if (selectedSnapshotId !== 'live') {
      alert('В архиве список VIN недоступен — переключитесь на «Сейчас (live)».');
      return;
    }
    setVinModalLoading(true);
    setVinListStatus(status);
    setShowVinModal(true);
    setVinList([]);
    try {
      const { start, end } = getTimeRange(timeFilter);
      const params = new URLSearchParams({ startTime: start, endTime: end, status });
      const res = await fetch(`${API_BASE}/api/drr-electronics-bms-vins?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки');
      setVinList(await res.json() || []);
    } catch (err) {
      alert(err.message);
    } finally {
      setVinModalLoading(false);
    }
  };

  const loadMppVins = async (defect) => {
    let range;
    if (selectedSnapshotId === 'live') {
      range = getTimeRange(timeFilter);
    } else {
      if (!archiveShift) {
        alert('Не удалось определить период снимка');
        return;
      }
      range = getArchiveRange(archiveShift.shiftDate, archiveShift.shift);
    }
    if (!range) { alert('Некорректный период'); return; }

    setMppModalTitle(`${defect.test_station} / ${defect.module_name}`);
    setMppVins([]);
    setShowMppModal(true);
    setMppModalLoading(true);
    try {
      const params = new URLSearchParams({ startTime: range.start, endTime: range.end, test_station: defect.test_station, module_name: defect.module_name });
      const res = await fetch(`${API_BASE}/api/drr-electronics-bms-mpp-vins?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки');
      setMppVins(await res.json() || []);
    } catch (err) {
      alert(err.message);
    } finally {
      setMppModalLoading(false);
    }
  };

  const pieData = [
    { name: 'DRR', value: drrData.drrPercent },
    { name: 'Не прямой сход', value: Math.max(0, 100 - drrData.drrPercent) },
  ];

  const handleFilterClick = (filter) => {
    setIsManualFilter(true);
    setTimeFilter(filter);
  };

  const displayLetter = shiftInfo.shiftLetter || '—';

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>DRR Electronics</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginRight: '20px' }}>
            <div style={{ background: '#FFFFFF', borderRadius: '20px', padding: '12px 28px', boxShadow: '0 6px 18px rgba(0,0,0,0.12)', border: '3px solid #fdfeff', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '1.8rem', color: '#64748B', fontWeight: 800 }}>CW</span>
              <span style={{ fontSize: '3rem', fontWeight: 900, color: '#1E293B', letterSpacing: '2px', lineHeight: 1 }}>{shiftInfo.weekNumber}</span>
            </div>
            <div style={{ width: '80px', height: '80px', borderRadius: '20px', background: '#ffffff', color: '#1E293B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '3.5rem', lineHeight: 1, boxShadow: '0 8px 20px rgba(0,0,0,0.2)', border: '4px solid #FFFFFF' }}>
              {displayLetter}
            </div>
          </div>
          <div style={{ width: '1px', height: '60px', backgroundColor: '#D1D5DB' }} />
          
          <div style={filterGroupStyle}>
            {['all', 'day', 'evening', 'night'].map(f => (
              <button 
                key={f} 
                style={{ ...timeFilterButtonStyle(timeFilter === f, f === 'all' ? '#6B7280' : f === 'day' ? '#F59E0B' : f === 'evening' ? '#3B82F6' : '#1F2937'), opacity: isArchive ? 0.5 : 1, cursor: isArchive ? 'not-allowed' : 'pointer' }} 
                onClick={() => { if (!isArchive) handleFilterClick(f); }}
                disabled={isArchive}
              >
                {f === 'all' ? 'Сутки' : f === 'day' ? 'День' : f === 'evening' ? 'Вечер' : 'Ночь'}
              </button>
            ))}

            {/* ВЫПАДАЮЩИЙ СПИСОК ИСТОРИИ */}
            <select
              value={selectedSnapshotId}
              onChange={(e) => setSelectedSnapshotId(e.target.value)}
              style={{
                padding: '12px 24px',
                borderRadius: '12px',
                border: 'none',
                fontWeight: 700,
                fontSize: '1.4rem',
                background: '#FFFFFF',
                color: '#64748B',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                minWidth: 220,
                appearance: 'none',
                WebkitAppearance: 'none',
                MozAppearance: 'none',
                backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 16px center',
                paddingRight: '44px',
                transition: 'all 0.2s',
              }}
            >
              <option value="live">Сейчас (live)</option>
              {snapshots.map(s => {
                const shiftLabel =
                  s.shift === 'all' ? 'Сутки' :
                  s.shift === 'day' ? 'День' :
                  s.shift === 'evening' ? 'Вечер' :
                  'Ночь';
                const dateObj = new Date(s.shiftDate + 'T12:00:00');
                const dd = String(dateObj.getDate()).padStart(2, '0');
                const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                return (
                  <option key={s.id} value={s.id}>
                    {dd}.{mm} · {shiftLabel} ({s.drrPercent}%)
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: '2.5rem', textAlign: 'center', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}>Загрузка данных...</div>
      ) : error ? (
        <div style={{ fontSize: '2.5rem', textAlign: 'center', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626', padding: '0 40px' }}>❌ {error}</div>
      ) : (
        <div style={dashboardGridStyle}>
          <div style={chartColumnStyle}>
            <div style={{ position: 'relative', width: '100%', height: '550px', marginTop: '10px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="75%" outerRadius="98%" paddingAngle={4} stroke="#FFFFFF" strokeWidth={4}>
                    {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value) => `${value.toFixed(1)}%`} contentStyle={{ fontSize: '1.8rem', borderRadius: '16px' }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#1E293B', marginBottom: '8px' }}>DRR{isArchive && ' · архив'}</div>
                <div style={{ fontSize: '6.2rem', fontWeight: 900, color: '#1E293B', lineHeight: 1 }}>{drrData.drrPercent.toFixed(1)}%</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '15px', marginTop: '20px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, backgroundColor: '#1E293B', borderRadius: '12px', padding: '16px', textAlign: 'center', color: '#FFFFFF', minHeight: '140px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 600, opacity: 0.9 }}>Всего авто</div>
                <div style={{ width: '70%', height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', margin: '10px auto' }}></div>
                <div style={{ fontSize: '4rem', fontWeight: 900, lineHeight: 1 }}>{drrData.totalVins}</div>
              </div>
              <div style={{ flex: 1, backgroundColor: '#059669', borderRadius: '12px', padding: '16px', textAlign: 'center', color: '#FFFFFF', minHeight: '140px', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: isArchive ? 'not-allowed' : 'pointer', opacity: isArchive ? 0.6 : 1 }} onClick={() => loadVinList('OK')}>
                <div style={{ fontSize: '1.2rem', fontWeight: 600, opacity: 0.9 }}>OK Авто</div>
                <div style={{ width: '70%', height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', margin: '10px auto' }}></div>
                <div style={{ fontSize: '4rem', fontWeight: 900, lineHeight: 1 }}>{drrData.closedVins}</div>
              </div>
              <div style={{ flex: 1, backgroundColor: '#DC2626', borderRadius: '12px', padding: '16px', textAlign: 'center', color: '#FFFFFF', minHeight: '140px', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: isArchive ? 'not-allowed' : 'pointer', opacity: isArchive ? 0.6 : 1 }} onClick={() => loadVinList('NOK')}>
                <div style={{ fontSize: '1.2rem', fontWeight: 600, opacity: 0.9 }}>NOK Авто</div>
                <div style={{ width: '70%', height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', margin: '10px auto' }}></div>
                <div style={{ fontSize: '4rem', fontWeight: 900, lineHeight: 1 }}>{drrData.nokVins}</div>
              </div>
            </div>
          </div>

          <div style={rightColumnStyle}>
            <div style={tableCardStyle}>
              <h2 style={tableTitleStyle}>Топ незакрытых дефектов электроники BMS{isArchive && ' (архив)'}</h2>
              <div style={tableScrollStyle}>
                {topDefects.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, padding: '16px 24px' }}>Станция / Модуль</th>
                        <th style={{ ...thStyle, width: '140px', textAlign: 'center', padding: '16px 24px' }}>NOK Авто</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topDefects.map((defect, idx) => (
                        <tr 
                          key={idx} 
                          style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', cursor: 'pointer' }}
                          onClick={() => loadMppVins(defect)}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#E2E8F0'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC'}
                        >
                          <td style={{ 
                            ...tdStyle, 
                            boxShadow: idx < 3 ? 'inset 10px 0 0 #EF4444' : 'none',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}>
                            <span style={{ fontWeight: 900, color: '#1E293B' }}>{defect.test_station}</span>
                            <span style={{ color: '#94A3B8', margin: '0 10px', fontWeight: 300 }}>|</span>
                            <span style={{ color: '#475569', fontWeight: 600 }}>{defect.module_name}</span>
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 900, fontSize: '2.6rem', color: idx < 3 ? '#DC2626' : '#1E293B' }}>
                            {defect.defectCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ textAlign: 'center', padding: '40px', color: '#64748B', fontSize: '2rem' }}>Нет данных</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модалка VIN по OK/NOK */}
      {showVinModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }} onClick={() => setShowVinModal(false)}>
          <div style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, width: '95%', maxWidth: 800, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>VIN ({vinListStatus}) — {vinList.length} шт.</h3>
              <button onClick={() => setShowVinModal(false)} style={{ border: 'none', background: 'none', fontSize: 24, cursor: 'pointer' }}>×</button>
            </div>
            {vinModalLoading ? <p>Загрузка...</p> : vinList.length === 0 ? (
              <p style={{ color: '#64748B' }}>Нет VIN'ов</p>
            ) : (
              <div style={{ overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '10px', borderBottom: '2px solid #E5E7EB', position: 'sticky', top: 0, background: '#FFF' }}>VIN</th>
                      <th style={{ textAlign: 'left', padding: '10px', borderBottom: '2px solid #E5E7EB', position: 'sticky', top: 0, background: '#FFF' }}>Время CP72</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vinList.map((item, idx) => (
                      <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                        <td style={{ padding: '10px', borderBottom: '1px solid #F0F0F5', whiteSpace: 'nowrap', fontWeight: 600, fontFamily: 'monospace' }}>{item.vin}</td>
                        <td style={{ padding: '10px', borderBottom: '1px solid #F0F0F5', whiteSpace: 'nowrap' }}>{item.cp72_time ? new Date(item.cp72_time).toLocaleString('ru-RU') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Модалка VIN по дефекту (BMS) */}
      {showMppModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }} onClick={() => setShowMppModal(false)}>
          <div style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, width: '98%', maxWidth: 1600, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>VIN'ы по дефекту: {mppModalTitle}</h3>
              <button onClick={() => setShowMppModal(false)} style={{ border: 'none', background: 'none', fontSize: 24, cursor: 'pointer' }}>×</button>
            </div>
            {mppModalLoading ? (
              <p style={{ fontSize: 16 }}>Загрузка...</p>
            ) : mppVins.length === 0 ? (
              <p style={{ fontSize: 16, color: '#64748B' }}>Нет VIN'ов по этому дефекту за выбранный период</p>
            ) : (
              <>
                <div style={{ marginBottom: 12, fontSize: 15, color: '#475569' }}>Всего: <b>{mppVins.length}</b></div>
                <div style={{ overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #E5E7EB', position: 'sticky', top: 0, background: '#FFF', whiteSpace: 'nowrap' }}>VIN</th>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #E5E7EB', position: 'sticky', top: 0, background: '#FFF', whiteSpace: 'nowrap' }}>Время CP72</th>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #E5E7EB', position: 'sticky', top: 0, background: '#FFF', whiteSpace: 'nowrap' }}>Порог NOK (CP72 + 5м)</th>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #E5E7EB', position: 'sticky', top: 0, background: '#FFF', whiteSpace: 'nowrap' }}>ОК CP7</th>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #E5E7EB', position: 'sticky', top: 0, background: '#FFF', whiteSpace: 'nowrap' }}>ОК Flash</th>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #E5E7EB', position: 'sticky', top: 0, background: '#FFF', whiteSpace: 'nowrap' }}>ОК ERA</th>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #E5E7EB', position: 'sticky', top: 0, background: '#FFF', whiteSpace: 'nowrap' }}>Время ошибки</th>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #E5E7EB', position: 'sticky', top: 0, background: '#FFF', whiteSpace: 'nowrap' }}>Модуль</th>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #E5E7EB', position: 'sticky', top: 0, background: '#FFF', whiteSpace: 'nowrap' }}>Описание ошибки</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mppVins.map((item, idx) => (
                        <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                          <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5', whiteSpace: 'nowrap', fontWeight: 600, fontFamily: 'monospace' }}>{item.vin}</td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5', whiteSpace: 'nowrap' }}>
                            {item.cp72_time ? new Date(item.cp72_time).toLocaleString('ru-RU') : '—'}
                          </td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5', whiteSpace: 'nowrap', fontWeight: 900, color: '#DC2626' }}>
                            {item.cp72_plus_5m ? new Date(item.cp72_plus_5m).toLocaleString('ru-RU') : '—'}
                          </td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5', color: item.cp7_ok ? '#059669' : '#DC2626', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {item.cp7_ok ? new Date(item.cp7_ok).toLocaleString('ru-RU') : '—'}
                          </td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5', color: item.flash_ok ? '#059669' : '#DC2626', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {item.flash_ok ? new Date(item.flash_ok).toLocaleString('ru-RU') : '—'}
                          </td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5', color: item.era_ok ? '#059669' : '#DC2626', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {item.era_ok ? new Date(item.era_ok).toLocaleString('ru-RU') : '—'}
                          </td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5', whiteSpace: 'nowrap' }}>
                            {item.test_time ? new Date(item.test_time).toLocaleString('ru-RU') : '—'}
                          </td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5', color: '#6B21A8', fontWeight: 600 }}>{item.module_name}</td>
                          <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5', color: '#475569' }}>{item.fault_content}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}