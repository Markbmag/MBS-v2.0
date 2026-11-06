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
  flexWrap: 'wrap',
  gap: 10,
};

const titleStyle = {
  fontSize: '2.2rem',
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
  padding: '10px 20px',
  borderRadius: '12px',
  border: 'none',
  fontWeight: 700,
  fontSize: '1.2rem',
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
  minWidth: 0,
};

const chartColumnStyle = {
  flex: '0 0 40%',
  minWidth: 0,
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
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const tableCardStyle = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  backgroundColor: '#FFFFFF',
  borderRadius: '24px',
  padding: '24px',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
};

const tableTitleStyle = {
  fontSize: 'clamp(1.1rem, 1.4vw, 1.6rem)',
  fontWeight: 800,
  color: '#1E293B',
  margin: '0 0 16px 0',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flexShrink: 0,
};

const tableScrollStyle = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  width: '100%',
  overflowY: 'auto',
  overflowX: 'auto',
  border: '1px solid #E2E8F0',
  borderRadius: '12px',
};

const thStyle = {
  padding: 'clamp(5px, 0.5vw, 10px) clamp(6px, 0.7vw, 14px)',
  textAlign: 'left',
  fontWeight: 800,
  color: '#475569',
  borderBottom: '3px solid #E2E8F0',
  background: '#F8FAFC',
  fontSize: 'clamp(0.72rem, 0.85vw, 1rem)',
  textTransform: 'uppercase',
  position: 'sticky',
  top: 0,
  zIndex: 10,
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: 'clamp(4px, 0.5vw, 10px) clamp(6px, 0.7vw, 14px)',
  borderBottom: '1px solid #F1F5F9',
  color: '#1E293B',
  fontSize: 'clamp(0.68rem, 0.8vw, 0.95rem)',
  whiteSpace: 'nowrap',
};

const PIE_COLORS = ['#10B981', '#EF4444'];

/* ===================== ХЕЛПЕРЫ ДЛЯ ВРЕМЕНИ ===================== */
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

const formatElapsed = (sec) => {
  if (sec === null || sec === undefined || sec < 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const formatDateTime = (str) => {
  if (!str) return '—';
  return String(str).replace('T', ' ').slice(0, 19);
};

/* ===================== КОМПОНЕНТ ===================== */
export default function VehicleOnWheelsPage() {
  const [timeFilter, setTimeFilter] = useState(getDefaultTimeFilter());
  const [isManualFilter, setIsManualFilter] = useState(false);
  const [shiftInfo, setShiftInfo] = useState(getCurrentShiftInfo());
  const [data, setData] = useState({
    rows: [],
    uniqueVins: 0,
    cpaCount: 0,
    cpaUnique: 0,
    repairTotal: 0,
    repairUnique: 0,
    greenCounts: {},
    greenUnique: {},
    cpaTarget: 160,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ---------- Стейт модалки ----------
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalType, setModalType] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalRows, setModalRows] = useState([]);
  const [modalCount, setModalCount] = useState(0);
  const [modalUnique, setModalUnique] = useState(0);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const { start, end } = getTimeRange(timeFilter);
      const params = new URLSearchParams({ startTime: start, endTime: end });
      const res = await fetch(`${API_BASE}/api/vehicle-on-wheels?${params}`);
      if (!res.ok) throw new Error('Ошибка загрузки данных');
      const json = await res.json();
      setData({
        rows: json.rows || [],
        uniqueVins: json.uniqueVins || 0,
        cpaCount: json.cpaCount || 0,
        cpaUnique: json.cpaUnique || 0,
        repairTotal: json.repairTotal || 0,
        repairUnique: json.repairUnique || 0,
        greenCounts: json.greenCounts || {},
        greenUnique: json.greenUnique || {},
        cpaTarget: json.cpaTarget || 160,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [timeFilter]);

  useEffect(() => {
    const interval = setInterval(() => {
      const newShiftInfo = getCurrentShiftInfo();
      setShiftInfo(newShiftInfo);
      if (!isManualFilter) {
        setTimeFilter(getDefaultTimeFilter());
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [isManualFilter]);

  useEffect(() => {
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [timeFilter]);

  const cpaPercent = data.cpaTarget > 0
    ? Math.min(100, (data.cpaCount / data.cpaTarget) * 100)
    : 0;

  const pieData = [
    { name: 'CPA', value: cpaPercent },
    { name: 'Остаток', value: Math.max(0, 100 - cpaPercent) },
  ];

  const handleFilterClick = (filter) => {
    setIsManualFilter(true);
    setTimeFilter(filter);
  };

  // ---------- Открытие модалки ----------
  const openDetails = async (type) => {
    const titleMap = {
      cp72: 'CP72 → Ремзона',
      cpa: 'Ремонт ОК',
      rep: 'Записей в ремзону (без CPA)',
    };

    setModalOpen(true);
    setModalTitle(titleMap[type]);
    setModalType(type);
    setModalRows([]);
    setModalCount(0);
    setModalUnique(0);

    if (type === 'cp72') {
      const rows = (data.rows || []).map(r => ({
        vin: r.vin,
        model: r.model || '—',
        zone: r.zone,
        cp72_time: r.time_cp72,
        zone_time: r.time_zone,
      }));
      setModalRows(rows);
      setModalCount(rows.length);
      setModalUnique(new Set(rows.map(r => r.vin)).size);
      return;
    }

    setModalLoading(true);
    try {
      const { start, end } = getTimeRange(timeFilter);
      const urlMap = {
        cpa: `${API_BASE}/api/vehicle-on-wheels/details/cpa`,
        rep: `${API_BASE}/api/vehicle-on-wheels/details/rep`,
      };
      const params = new URLSearchParams({ startTime: start, endTime: end });
      const res = await fetch(`${urlMap[type]}?${params}`);
      if (!res.ok) throw new Error('Ошибка загрузки деталей');
      const json = await res.json();
      const rows = json.rows || [];
      setModalRows(rows);
      setModalCount(rows.length);
      setModalUnique(new Set(rows.map(r => r.vin)).size);
    } catch (err) {
      console.error(err);
      setModalRows([]);
    } finally {
      setModalLoading(false);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalRows([]);
    setModalTitle('');
    setModalType('');
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>Repairs</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginRight: '20px' }}>
            <div style={{
              background: '#FFFFFF',
              borderRadius: '20px',
              padding: '10px 24px',
              boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}>
              <span style={{ fontSize: '1.6rem', color: '#64748B', fontWeight: 800 }}>CW</span>
              <span style={{ fontSize: '2.5rem', fontWeight: 900, color: '#1E293B', letterSpacing: '2px', lineHeight: 1 }}>
                {shiftInfo.weekNumber}
              </span>
            </div>
            <div style={{
              width: '70px',
              height: '70px',
              borderRadius: '20px',
              background: '#FFFFFF',
              color: '#1E293B',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 900,
              fontSize: '3rem',
              lineHeight: 1,
              boxShadow: '0 8px 20px rgba(0,0,0,0.2)',
            }}>
              {shiftInfo.shiftLetter}
            </div>
          </div>

          <div style={{ width: '1px', height: '60px', backgroundColor: '#D1D5DB' }} />

          <div style={filterGroupStyle}>
            <button
              style={timeFilterButtonStyle(timeFilter === 'all', '#6B7280')}
              onClick={() => handleFilterClick('all')}
            >Сутки</button>
            <button
              style={timeFilterButtonStyle(timeFilter === 'day', '#F59E0B')}
              onClick={() => handleFilterClick('day')}
            >День</button>
            <button
              style={timeFilterButtonStyle(timeFilter === 'evening', '#3B82F6')}
              onClick={() => handleFilterClick('evening')}
            >Вечер</button>
            <button
              style={timeFilterButtonStyle(timeFilter === 'night', '#1F2937')}
              onClick={() => handleFilterClick('night')}
            >Ночь</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: '2rem', textAlign: 'center', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}>
          Загрузка данных...
        </div>
      ) : error ? (
        <div style={{ fontSize: '2rem', textAlign: 'center', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626' }}>
          ❌ {error}
        </div>
      ) : (
        <div style={dashboardGridStyle}>
          <div style={chartColumnStyle}>
            <div style={{ position: 'relative', width: '100%', height: '380px', flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius="75%"
                    outerRadius="98%"
                    paddingAngle={4}
                    stroke="#FFFFFF"
                    strokeWidth={4}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => `${value.toFixed(1)}%`}
                    contentStyle={{ fontSize: '1.4rem', borderRadius: '16px' }}
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
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}>
                <div style={{ fontSize: '4rem', fontWeight: 900, color: '#1E293B', lineHeight: 1 }}>
                  {cpaPercent.toFixed(1)}%
                </div>
                <div style={{ fontSize: '0.95rem', color: '#64748B', lineHeight: 1 }}>
                  {data.cpaCount} / {data.cpaTarget}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#94A3B8', lineHeight: 1 }}>
                  уникальных VIN: {data.cpaUnique}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
              <div
                onClick={() => openDetails('cp72')}
                style={{
                  flex: 1,
                  backgroundColor: '#1E293B',
                  borderRadius: '12px',
                  padding: '14px',
                  textAlign: 'center',
                  color: '#FFFFFF',
                  minHeight: '110px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'transform 0.15s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                <div style={{ fontSize: '0.9rem', fontWeight: 600, opacity: 0.9, lineHeight: 1.2 }}>CP72 → Ремзона</div>
                <div style={{ width: '70%', height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', margin: '8px auto' }} />
                <div style={{ fontSize: '2.8rem', fontWeight: 900, lineHeight: 1 }}>{data.uniqueVins}</div>
              </div>

              <div
                onClick={() => openDetails('cpa')}
                style={{
                  flex: 1,
                  backgroundColor: '#059669',
                  borderRadius: '12px',
                  padding: '14px',
                  textAlign: 'center',
                  color: '#FFFFFF',
                  minHeight: '110px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'transform 0.15s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                <div style={{ fontSize: '0.9rem', fontWeight: 600, opacity: 0.9, lineHeight: 1.2 }}>Ремонт ОК</div>
                <div style={{ width: '70%', height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', margin: '8px auto' }} />
                <div style={{ fontSize: '2.8rem', fontWeight: 900, lineHeight: 1 }}>{data.cpaCount}</div>
                <div style={{ fontSize: '0.7rem', opacity: 0.75, marginTop: 4 }}>
                  уникальных VIN: {data.cpaUnique}
                </div>
              </div>

              <div
                onClick={() => openDetails('rep')}
                style={{
                  flex: 1,
                  backgroundColor: '#DC2626',
                  borderRadius: '12px',
                  padding: '14px',
                  textAlign: 'center',
                  color: '#FFFFFF',
                  minHeight: '110px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'transform 0.15s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                <div style={{ fontSize: '0.9rem', fontWeight: 600, opacity: 0.9, lineHeight: 1.2 }}>Записей в ремзону</div>
                <div style={{ width: '70%', height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', margin: '8px auto' }} />
                <div style={{ fontSize: '2.8rem', fontWeight: 900, lineHeight: 1 }}>{data.repairTotal}</div>
                <div style={{ fontSize: '0.7rem', opacity: 0.75, marginTop: 4 }}>
                  уникальных VIN: {data.repairUnique}
                </div>
              </div>
            </div>
          </div>

          <div style={rightColumnStyle}>
            <div style={tableCardStyle}>
              <h2 style={tableTitleStyle}>Авто прошедшие CP72 и попавшие в ремзону</h2>
              <div style={tableScrollStyle}>
                {data.rows.length > 0 ? (
                  <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>VIN</th>
                        <th style={thStyle}>Зона</th>
                        <th style={thStyle}>Время CP72</th>
                        <th style={thStyle}>Прошло с CP72</th>
                        <th style={thStyle}>Время в зоне</th>
                        <th style={thStyle}>Прошло в зоне</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, idx) => (
                        <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                          <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{row.vin}</td>
                          <td style={tdStyle}>
                            <span style={{
                              display: 'inline-block',
                              padding: '2px 10px',
                              borderRadius: 8,
                              background: '#EEF2FF',
                              color: '#1D4ED8',
                              fontWeight: 700,
                              fontSize: 'clamp(0.68rem, 0.8vw, 1rem)',
                            }}>
                              {row.zone}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{formatDateTime(row.time_cp72)}</td>
                          <td style={tdStyle}>{formatElapsed(row.elapsed_cp72_sec)}</td>
                          <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{formatDateTime(row.time_zone)}</td>
                          <td style={tdStyle}>{formatElapsed(row.elapsed_zone_sec)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ textAlign: 'center', padding: '40px', color: '#64748B', fontSize: '1.6rem' }}>Нет данных</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div
          onClick={closeModal}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2000, padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#FFFFFF', borderRadius: 16,
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
              width: '100%', maxWidth: 1100, maxHeight: '85vh',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid #E2E8F0',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: 'linear-gradient(180deg,#F8FAFC,#FFFFFF)',
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0F172A' }}>
                  {modalTitle}
                </h3>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
                  Всего записей: <b>{modalCount}</b> · уникальных VIN: <b>{modalUnique}</b>
                </div>
              </div>
              <button
                onClick={closeModal}
                style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748B' }}
              >✕</button>
            </div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              {modalLoading ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>Загрузка...</div>
              ) : modalRows.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>Нет данных</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>№</th>
                      <th style={thStyle}>VIN</th>
                      <th style={thStyle}>Модель</th>
                      <th style={thStyle}>Зона</th>
                      {modalType === 'cp72' ? (
                        <>
                          <th style={thStyle}>Время CP72</th>
                          <th style={thStyle}>Время в зоне</th>
                        </>
                      ) : (
                        <>
                          <th style={thStyle}>Время события</th>
                          {modalType === 'cpa' && <th style={thStyle}>Время в зоне</th>}
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {modalRows.map((r, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                        <td style={{ ...tdStyle, color: '#94A3B8', textAlign: 'center' }}>{i + 1}</td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{r.vin}</td>
                        <td style={tdStyle}>{r.model}</td>
                        <td style={tdStyle}>
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 10px',
                            borderRadius: 8,
                            background: '#EEF2FF',
                            color: '#1D4ED8',
                            fontWeight: 700,
                            fontSize: '0.85rem',
                          }}>
                            {r.zone}
                          </span>
                        </td>
                        {modalType === 'cp72' ? (
                          <>
                            <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{formatDateTime(r.cp72_time)}</td>
                            <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{formatDateTime(r.zone_time)}</td>
                          </>
                        ) : (
                          <>
                            <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{formatDateTime(r.event_time)}</td>
                            {modalType === 'cpa' && (
                              <td style={{ ...tdStyle, fontFamily: 'monospace' }}>
                                {formatDateTime(r.zone_enter_time)}
                              </td>
                            )}
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}