import React, { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const API_BASE = '';

/* ===================== СТИЛИ ===================== */
const containerStyle = {
  padding: '20px',
  fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
  width: '100%',
  height: '100vh',
  boxSizing: 'border-box',
  backgroundColor: '#F8FAFC',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
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

const timeFilterButtonStyle = (active, activeColor, disabled = false) => ({
  padding: '12px 24px',
  borderRadius: '12px',
  border: 'none',
  fontWeight: 700,
  fontSize: '1.4rem',
  background: active ? activeColor : '#FFFFFF',
  color: active ? '#FFFFFF' : '#64748B',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  transition: 'all 0.2s',
});

const snapshotSelectStyle = {
  padding: '12px 44px 12px 24px',
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
  transition: 'all 0.2s',
};

const dashboardGridStyle = {
  display: 'flex',
  gap: '20px',
  flex: 1,
  minHeight: 0,
};

const chartColumnStyle = {
  flex: '0 0 42%',
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
  gap: 14,
};

const tableCardStyle = {
  flex: 1,
  backgroundColor: '#FFFFFF',
  borderRadius: '20px',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
  minHeight: 0,
};

const tableTitleStyle = {
  fontSize: '1.3rem',
  fontWeight: 800,
  color: '#1E293B',
  margin: '0 0 10px 0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexShrink: 0,
};

const tableScrollStyle = {
  flex: 1,
  overflowY: 'auto',
  border: '1px solid #E2E8F0',
  borderRadius: '10px',
  minHeight: 0,
};

const thStyle = {
  padding: '8px 10px',
  textAlign: 'left',
  fontWeight: 700,
  color: '#475569',
  borderBottom: '2px solid #E2E8F0',
  background: '#F8FAFC',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  position: 'sticky',
  top: 0,
  zIndex: 10,
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '6px 10px',
  borderBottom: '1px solid #F1F5F9',
  color: '#1E293B',
  fontSize: '0.82rem',
};

const PIE_COLORS = ['#10B981', '#EF4444'];

const LABEL_SECTION_HEIGHT = 42;
const VALUE_SECTION_HEIGHT = 62;

const subBlockStyle = {
  backgroundColor: 'rgba(255,255,255,0.20)',
  borderRadius: 8,
  padding: '6px 4px',
  textAlign: 'center',
  border: '1px solid rgba(255,255,255,0.18)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
};

/* ===================== ХЕЛПЕРЫ ===================== */
const getMoscowTime = () => new Date(Date.now() + 3 * 60 * 60 * 1000);

const getMoscowMinutes = () => {
  const m = getMoscowTime();
  return m.getUTCHours() * 60 + m.getUTCMinutes();
};

const getDefaultTimeFilter = () => {
  const t = getMoscowMinutes();
  if (t >= 1 * 60 + 31 && t < 7 * 60 + 50) return 'night';
  if (t >= 7 * 60 + 50 && t < 16 * 60 + 41) return 'day';
  return 'evening';
};

const getTimeRange = (timeFilter) => {
  const now = getMoscowTime();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;

  const yest = new Date(now);
  yest.setUTCDate(yest.getUTCDate() - 1);
  const yesterdayStr = `${yest.getUTCFullYear()}-${String(yest.getUTCMonth() + 1).padStart(2, '0')}-${String(yest.getUTCDate()).padStart(2, '0')}`;

  const t = getMoscowMinutes();

  if (timeFilter === 'all') return { start: `${todayStr} 00:00:00`, end: `${todayStr} 23:59:59` };
  if (timeFilter === 'day') {
    const dateToUse = t >= 7 * 60 + 50 ? todayStr : yesterdayStr;
    return { start: `${dateToUse} 07:50:00`, end: `${dateToUse} 16:40:00` };
  }
  if (timeFilter === 'evening') {
    const dateToUse = t >= 16 * 60 + 41 ? todayStr : yesterdayStr;
    const startDateObj = new Date(`${dateToUse}T00:00:00Z`);
    const endDateObj = new Date(startDateObj);
    endDateObj.setUTCDate(endDateObj.getUTCDate() + 1);
    const endStr = `${endDateObj.getUTCFullYear()}-${String(endDateObj.getUTCMonth() + 1).padStart(2, '0')}-${String(endDateObj.getUTCDate()).padStart(2, '0')}`;
    return { start: `${dateToUse} 16:41:00`, end: `${endStr} 01:30:00` };
  }
  if (timeFilter === 'night') {
    const dateToUse = t >= 1 * 60 + 31 ? todayStr : yesterdayStr;
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
  const t = getMoscowMinutes();
  let shiftDate = new Date(nowMoscow);
  let shiftType = 'night';

  if (t >= 7 * 60 + 50 && t <= 16 * 60 + 40) shiftType = 'day';
  else if (t >= 16 * 60 + 41 || t <= 1 * 60 + 30) {
    shiftType = 'evening';
    if (t <= 1 * 60 + 30) shiftDate.setUTCDate(shiftDate.getUTCDate() - 1);
  } else shiftType = 'night';

  const weekNumber = getWeekNumber(shiftDate);
  const isEvenWeek = weekNumber % 2 === 0;
  let shiftLetter = 'C';
  if (shiftType === 'night') shiftLetter = 'C';
  else if (shiftType === 'day') shiftLetter = isEvenWeek ? 'B' : 'A';
  else if (shiftType === 'evening') shiftLetter = isEvenWeek ? 'A' : 'B';

  return { weekNumber, shiftLetter, shiftType };
};

const formatDuration = (sec) => {
  if (sec === null || sec === undefined || sec < 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}д ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const formatDateTime = (str) => {
  if (!str) return '—';
  try {
    return new Date(str).toLocaleString('ru-RU');
  } catch {
    return String(str);
  }
};

/* ===================== КОМПОНЕНТ ===================== */
export default function DrrCp6Page() {
  const [timeFilter, setTimeFilter] = useState(getDefaultTimeFilter());
  const [isManualFilter, setIsManualFilter] = useState(false);
  const [shiftInfo, setShiftInfo] = useState(getCurrentShiftInfo());

  const [data, setData] = useState({
    totalRecords: 0,
    totalVins: 0,
    okVins: 0,
    nokVins: 0,
    drrPercent: 0,
    spotVins: 0,
    repaintVins: 0,
    otherVins: 0,
    transitCount: 0,
    activeAtPaint: 0,
  });
  const [spotRows, setSpotRows] = useState([]);
  const [repaintRows, setRepaintRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [snapshots, setSnapshots] = useState([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('live');
  const [archiveMeta, setArchiveMeta] = useState(null); // { shiftDate, shift }

  const [vinList, setVinList] = useState([]);
  const [vinListStatus, setVinListStatus] = useState('');
  const [showVinModal, setShowVinModal] = useState(false);
  const [vinModalLoading, setVinModalLoading] = useState(false);

  const isArchive = selectedSnapshotId !== 'live';

  /* ===================== Загрузка live-данных ===================== */
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const { start, end } = getTimeRange(timeFilter);
      const params = new URLSearchParams({ startTime: start, endTime: end });

      const [mainRes, spotRes, repaintRes] = await Promise.all([
        fetch(`${API_BASE}/api/drr-cp6-dashboard?${params.toString()}`).then(r => r.json()),
        fetch(`${API_BASE}/api/drr-cp6-spot-repaint-vins?${params.toString()}&category=spot`).then(r => r.json()),
        fetch(`${API_BASE}/api/drr-cp6-spot-repaint-vins?${params.toString()}&category=repaint`).then(r => r.json()),
      ]);

      setData({
        totalRecords: mainRes.totalRecords || 0,
        totalVins: mainRes.totalVins || 0,
        okVins: mainRes.okVins || 0,
        nokVins: mainRes.nokVins || 0,
        drrPercent: mainRes.drrPercent || 0,
        spotVins: mainRes.spotVins || 0,
        repaintVins: mainRes.repaintVins || 0,
        otherVins: mainRes.otherVins || 0,
        transitCount: mainRes.transitCount || 0,
        activeAtPaint: mainRes.activeAtPaint || 0,
      });

      setSpotRows(Array.isArray(spotRes) ? spotRes : []);
      setRepaintRows(Array.isArray(repaintRes) ? repaintRes : []);
      setArchiveMeta(null);
    } catch (err) {
      setError(err.message);
      setSpotRows([]);
      setRepaintRows([]);
    } finally {
      setLoading(false);
    }
  };

  /* ===================== Загрузка снимка ===================== */
  const loadSnapshot = async (id) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/drr-cp6-snapshot/${id}`);
      if (!res.ok) throw new Error('Ошибка загрузки снимка');
      const json = await res.json();

      setData({
        totalRecords: json.totalRecords || 0,
        totalVins: json.totalVins || 0,
        okVins: json.okVins || 0,
        nokVins: json.nokVins || 0,
        drrPercent: json.drrPercent || 0,
        spotVins: json.spotVins || 0,
        repaintVins: json.repaintVins || 0,
        otherVins: json.otherVins || 0,
        transitCount: json.transitCount || 0,
        activeAtPaint: json.activeAtPaint || 0,
      });

      setSpotRows(Array.isArray(json.spotRows) ? json.spotRows : []);
      setRepaintRows(Array.isArray(json.repaintRows) ? json.repaintRows : []);

      setShiftInfo({
        weekNumber: json.weekNumber != null ? json.weekNumber : '—',
        shiftLetter: json.shiftLetter != null ? json.shiftLetter : '—',
        shiftType: json.shift || 'all',
      });
      setArchiveMeta({ shiftDate: json.shiftDate, shift: json.shift });
    } catch (err) {
      setError(err.message);
      setSpotRows([]);
      setRepaintRows([]);
    } finally {
      setLoading(false);
    }
  };

  /* ===================== Загрузка списка снимков ===================== */
  useEffect(() => {
    fetch(`${API_BASE}/api/drr-cp6-snapshots?days=14`)
      .then(res => res.json())
      .then(json => {
        const list = Array.isArray(json) ? json : [];
        setSnapshots(list);
        if (selectedSnapshotId !== 'live' && !list.some(s => String(s.id) === String(selectedSnapshotId))) {
          setSelectedSnapshotId('live');
        }
      })
      .catch(() => setSnapshots([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===================== Главный эффект: live vs архив ===================== */
  useEffect(() => {
    if (selectedSnapshotId === 'live') {
      loadData();
    } else {
      loadSnapshot(selectedSnapshotId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSnapshotId, timeFilter]);

  /* ===================== Обновление смены и авто-refresh ===================== */
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
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeFilter, selectedSnapshotId]);

  /* ===================== Модалка VIN ===================== */
  const loadVinList = async (status) => {
    if (isArchive) {
      alert('В архиве список VIN недоступен — переключитесь на «Сейчас (live)».');
      return;
    }
    setVinModalLoading(true);
    try {
      const { start, end } = getTimeRange(timeFilter);
      const params = new URLSearchParams({ startTime: start, endTime: end, status });
      const res = await fetch(`${API_BASE}/api/drr-cp6-vins?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки списка VIN');
      const json = await res.json();
      setVinList(Array.isArray(json) ? json : []);
      setVinListStatus(status);
      setShowVinModal(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setVinModalLoading(false);
    }
  };

  const loadTransitList = async () => {
    if (isArchive) {
      alert('В архиве список VIN недоступен — переключитесь на «Сейчас (live)».');
      return;
    }
    setVinModalLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/drr-cp6-transit-vins`);
      if (!res.ok) throw new Error('Ошибка загрузки списка VIN (переход)');
      const json = await res.json();
      setVinList(Array.isArray(json) ? json : []);
      setVinListStatus('TRANSIT');
      setShowVinModal(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setVinModalLoading(false);
    }
  };

  const pieData = [
    { name: 'DRR (OK)', value: data.drrPercent },
    { name: 'NOK', value: Math.max(0, 100 - data.drrPercent) },
  ];

  const handleFilterClick = (filter) => {
    if (isArchive) return;
    setIsManualFilter(true);
    setTimeFilter(filter);
  };

  const uniqueSpotVins = new Set(spotRows.map(r => r.vin)).size;
  const uniqueRepaintVins = new Set(repaintRows.map(r => r.vin)).size;
  const spotDefects = spotRows.length;
  const repaintDefects = repaintRows.length;

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>DRR CP6{isArchive && ' · архив'}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginRight: '20px' }}>
            <div style={{
              background: '#FFFFFF', borderRadius: '20px', padding: '12px 28px',
              boxShadow: '0 6px 18px rgba(0,0,0,0.12)', border: '3px solid #fdfeff',
              display: 'flex', alignItems: 'center', gap: '12px',
            }}>
              <span style={{ fontSize: '1.8rem', color: '#64748B', fontWeight: 800 }}>CW</span>
              <span style={{ fontSize: '3rem', fontWeight: 900, color: '#1E293B', letterSpacing: '2px', lineHeight: 1 }}>
                {shiftInfo.weekNumber}
              </span>
            </div>
            <div style={{
              width: '80px', height: '80px', borderRadius: '20px',
              background: '#FFFFFF', color: '#1E293B',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 900, fontSize: '3.5rem', lineHeight: 1,
              boxShadow: '0 8px 20px rgba(0,0,0,0.2)', border: '4px solid #FFFFFF',
            }}>
              {shiftInfo.shiftLetter}
            </div>
          </div>

          <div style={{ width: '1px', height: '60px', backgroundColor: '#D1D5DB' }} />

          <div style={filterGroupStyle}>
            <button
              style={timeFilterButtonStyle(timeFilter === 'all', '#6B7280', isArchive)}
              onClick={() => handleFilterClick('all')}
              disabled={isArchive}
            >Сутки</button>
            <button
              style={timeFilterButtonStyle(timeFilter === 'day', '#F59E0B', isArchive)}
              onClick={() => handleFilterClick('day')}
              disabled={isArchive}
            >День</button>
            <button
              style={timeFilterButtonStyle(timeFilter === 'evening', '#3B82F6', isArchive)}
              onClick={() => handleFilterClick('evening')}
              disabled={isArchive}
            >Вечер</button>
            <button
              style={timeFilterButtonStyle(timeFilter === 'night', '#1F2937', isArchive)}
              onClick={() => handleFilterClick('night')}
              disabled={isArchive}
            >Ночь</button>

            <select
              value={selectedSnapshotId}
              onChange={(e) => setSelectedSnapshotId(e.target.value)}
              style={snapshotSelectStyle}
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
        <div style={{ fontSize: '2.5rem', textAlign: 'center', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}>
          Загрузка данных...
        </div>
      ) : error ? (
        <div style={{ fontSize: '2.5rem', textAlign: 'center', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626' }}>
          ❌ {error}
        </div>
      ) : (
        <div style={dashboardGridStyle}>
          <div style={chartColumnStyle}>
            <div style={{ position: 'relative', width: '100%', height: '440px', flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value" nameKey="name"
                    cx="50%" cy="50%"
                    innerRadius="75%" outerRadius="98%"
                    paddingAngle={4} stroke="#FFFFFF" strokeWidth={4}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => {
                      const count = name === 'DRR (OK)' ? data.okVins : data.nokVins;
                      return [`${value.toFixed(1)}% (${count} VIN)`, name];
                    }}
                    contentStyle={{ fontSize: '1.5rem', borderRadius: '16px' }}
                  />
                </PieChart>
              </ResponsiveContainer>

              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none',
              }}>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#1E293B', marginBottom: '6px' }}>
                  DRR{isArchive && ' · архив'}
                </div>
                <div style={{ fontSize: '5.4rem', fontWeight: 900, color: '#1E293B', lineHeight: 1 }}>
                  {data.drrPercent.toFixed(1)}%
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'nowrap', alignItems: 'stretch' }}>
              {/* System Fill */}
              <div style={{
                flex: '0 0 20%', backgroundColor: '#1E293B',
                borderRadius: 12, padding: '14px 12px', color: '#FFFFFF',
                minHeight: 150, display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
              }}>
                <div style={{ textAlign: 'center', height: LABEL_SECTION_HEIGHT, flexShrink: 0 }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, opacity: 0.95, marginBottom: 6 }}>System Fill</div>
                  <div style={{ width: '55%', height: 2, backgroundColor: 'rgba(255,255,255,0.3)', margin: '0 auto', borderRadius: 1 }} />
                </div>
                <div style={{ height: VALUE_SECTION_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ fontSize: '3rem', fontWeight: 900, lineHeight: 1 }}>
                    {Math.max(0, data.activeAtPaint - 4)}
                  </div>
                </div>
                <div style={{ fontSize: '0.68rem', opacity: 0.75, fontWeight: 600, textAlign: 'center', marginTop: 'auto' }}>
                  Прошли PSOUT: {data.totalVins}
                </div>
              </div>

              {/* Buffer */}
              <div
                style={{
                  flex: '0 0 20%', backgroundColor: '#059669',
                  borderRadius: 12, padding: '14px 12px', color: '#FFFFFF',
                  minHeight: 150, display: 'flex', flexDirection: 'column',
                  cursor: isArchive ? 'not-allowed' : 'pointer',
                  opacity: isArchive ? 0.7 : 1,
                  boxSizing: 'border-box',
                }}
                onClick={loadTransitList}
              >
                <div style={{ textAlign: 'center', height: LABEL_SECTION_HEIGHT, flexShrink: 0 }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, opacity: 0.95, marginBottom: 6 }}>Buffer</div>
                  <div style={{ width: '55%', height: 2, backgroundColor: 'rgba(255,255,255,0.3)', margin: '0 auto', borderRadius: 1 }} />
                </div>
                <div style={{ height: VALUE_SECTION_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ fontSize: '3rem', fontWeight: 900, lineHeight: 1 }}>{data.transitCount}</div>
                </div>
                <div style={{ fontSize: '0.68rem', opacity: 0.85, fontWeight: 600, textAlign: 'center', marginTop: 'auto' }}>
                  Прошли OK: {data.okVins}
                </div>
              </div>

              {/* NOK */}
              <div
                style={{
                  flex: 1, backgroundColor: '#DC2626',
                  borderRadius: 12, padding: '14px 16px', color: '#FFFFFF',
                  minHeight: 150, display: 'flex', flexDirection: 'column',
                  cursor: isArchive ? 'not-allowed' : 'pointer',
                  opacity: isArchive ? 0.7 : 1,
                  boxSizing: 'border-box',
                }}
                onClick={() => loadVinList('NOK')}
              >
                <div style={{ textAlign: 'center', height: LABEL_SECTION_HEIGHT, flexShrink: 0 }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, opacity: 0.95, marginBottom: 6 }}>NOK</div>
                  <div style={{ width: '30%', height: 2, backgroundColor: 'rgba(255,255,255,0.3)', margin: '0 auto', borderRadius: 1 }} />
                </div>
                <div style={{ height: VALUE_SECTION_HEIGHT, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: '3rem', fontWeight: 900, lineHeight: 1, minWidth: 60, textAlign: 'center' }}>
                    {data.nokVins}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, flex: 1 }}>
                    <div style={subBlockStyle}>
                      <div style={{ fontSize: '0.68rem', fontWeight: 700, opacity: 0.95, letterSpacing: 0.2, lineHeight: 1.1 }}>Spot</div>
                      <div style={{ fontSize: '1.35rem', fontWeight: 900, lineHeight: 1.1 }}>{data.spotVins}</div>
                    </div>
                    <div style={subBlockStyle}>
                      <div style={{ fontSize: '0.68rem', fontWeight: 700, opacity: 0.95, letterSpacing: 0.2, lineHeight: 1.1 }}>Перекрас</div>
                      <div style={{ fontSize: '1.35rem', fontWeight: 900, lineHeight: 1.1 }}>{data.repaintVins}</div>
                    </div>
                    <div style={subBlockStyle}>
                      <div style={{ fontSize: '0.68rem', fontWeight: 700, opacity: 0.95, letterSpacing: 0.2, lineHeight: 1.1 }}>Остальные</div>
                      <div style={{ fontSize: '1.35rem', fontWeight: 900, lineHeight: 1.1 }}>{data.otherVins}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={rightColumnStyle}>
            {/* Spot */}
            <div style={tableCardStyle}>
              <h2 style={tableTitleStyle}>
                <span>Spot{isArchive && ' · архив'}</span>
                <span style={{ fontSize: '0.85rem', color: '#64748B', fontWeight: 600 }}>
                  Уник. VIN: {uniqueSpotVins} · Дефектов незакрытых: {spotDefects}
                </span>
              </h2>
              <div style={tableScrollStyle}>
                {spotRows.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>VIN</th>
                        <th style={thStyle}>MPP</th>
                        <th style={thStyle}>Статус</th>
                        <th style={thStyle}>PSIN</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Продолжительность (д чч:мм)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spotRows.map((r, idx) => (
                        <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                          <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{r.vin}</td>
                          <td style={tdStyle}>{r.mpp}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, color: '#DC2626', fontSize: '0.72rem' }}>{r.status}</td>
                          <td style={{ ...tdStyle, fontSize: '0.75rem' }}>{formatDateTime(r.psin_time)}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, textAlign: 'right' }}>{formatDuration(r.duration_sec)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ textAlign: 'center', padding: '20px', color: '#64748B' }}>Нет данных</p>
                )}
              </div>
            </div>

            {/* Перекрас */}
            <div style={tableCardStyle}>
              <h2 style={tableTitleStyle}>
                <span>Перекрас{isArchive && ' · архив'}</span>
                <span style={{ fontSize: '0.85rem', color: '#64748B', fontWeight: 600 }}>
                  Уник. VIN: {uniqueRepaintVins} · Дефектов незакрытых: {repaintDefects}
                </span>
              </h2>
              <div style={tableScrollStyle}>
                {repaintRows.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>VIN</th>
                        <th style={thStyle}>MPP</th>
                        <th style={thStyle}>Статус</th>
                        <th style={thStyle}>PSIN</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Продолжительность (д чч:мм)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repaintRows.map((r, idx) => (
                        <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                          <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{r.vin}</td>
                          <td style={tdStyle}>{r.mpp}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, color: '#DC2626', fontSize: '0.72rem' }}>{r.status}</td>
                          <td style={{ ...tdStyle, fontSize: '0.75rem' }}>{formatDateTime(r.psin_time)}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, textAlign: 'right' }}>{formatDuration(r.duration_sec)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ textAlign: 'center', padding: '20px', color: '#64748B' }}>Нет данных</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ Модалка VIN ============ */}
      {showVinModal && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2000,
          }}
          onClick={() => setShowVinModal(false)}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24,
              width: '90%', maxWidth: 1200, maxHeight: '85vh',
              display: 'flex', flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
                VIN ({vinListStatus}) — {vinList.length} шт.
              </h3>
              <button onClick={() => setShowVinModal(false)} style={{ border: 'none', background: 'none', fontSize: 24, cursor: 'pointer' }}>×</button>
            </div>
            {vinModalLoading ? (
              <p>Загрузка...</p>
            ) : (
              <div style={{ overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #E5E7EB' }}>VIN</th>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #E5E7EB' }}>Номер Лота</th>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #E5E7EB' }}>Seq</th>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #E5E7EB' }}>Модель</th>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #E5E7EB' }}>Код материала</th>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #E5E7EB' }}>Описание материала</th>
                      {vinListStatus === 'TRANSIT' ? (
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #E5E7EB' }} colSpan={2}>PBSOUT (выход из покраски)</th>
                      ) : (
                        <>
                          <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #E5E7EB' }}>PSIN</th>
                          <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #E5E7EB' }}>PSOUT</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {vinList.map((item, idx) => (
                      <tr key={idx}>
                        <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5', fontFamily: 'monospace' }}>{item.vin}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5' }}>{item.batch_num}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5' }}>{item.sequence_number}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5' }}>{item.model}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5' }}>{item.material_code}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5' }}>{item.material_desc}</td>
                        {vinListStatus === 'TRANSIT' ? (
                          <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5', fontSize: '0.85rem' }} colSpan={2}>
                            {formatDateTime(item.pbsout_time)}
                          </td>
                        ) : (
                          <>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5', fontSize: '0.85rem' }}>{formatDateTime(item.psin_time)}</td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5', fontSize: '0.85rem' }}>{formatDateTime(item.psout_time)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}