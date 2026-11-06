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
  padding: '18px 24px',
  textAlign: 'left',
  fontWeight: 800,
  color: '#475569',
  borderBottom: '3px solid #E2E8F0',
  background: '#F8FAFC',
  fontSize: '1.6rem',
  textTransform: 'uppercase',
  position: 'sticky',
  top: 0,
  zIndex: 10,
};

const tdStyle = {
  padding: '14px 24px',
  borderBottom: '1px solid #F1F5F9',
  color: '#1E293B',
  fontSize: '1.6rem',
};

const PIE_COLORS = ['#10B981', '#EF4444'];

/* ===================== ХЕЛПЕРЫ ВРЕМЕНИ ===================== */
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

/* ===================== КОМПОНЕНТ ===================== */
export default function DrrCp5Page() {
  const [timeFilter, setTimeFilter] = useState(getDefaultTimeFilter());
  const [isManualFilter, setIsManualFilter] = useState(false);
  const [shiftInfo, setShiftInfo] = useState(getCurrentShiftInfo());

  // === НОВЫЙ ФИЛЬТР ===
  const [lineFilter, setLineFilter] = useState('all'); // all | BSP100 | BS

  const [data, setData] = useState({
    totalRecords: 0,
    totalVins: 0,
    okVins: 0,
    nokVins: 0,
    drrPercent: 0,
  });
  const [topDefects, setTopDefects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [vinList, setVinList] = useState([]);
  const [vinListStatus, setVinListStatus] = useState('');
  const [showVinModal, setShowVinModal] = useState(false);
  const [vinModalLoading, setVinModalLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const { start, end } = getTimeRange(timeFilter);
      const params = new URLSearchParams({
        startTime: start,
        endTime: end,
        filter: lineFilter,
      });

      const mainRes = await fetch(`${API_BASE}/api/drr-cp5-dashboard?${params.toString()}`);
      if (!mainRes.ok) throw new Error('Ошибка загрузки DRR CP5');
      const mainJson = await mainRes.json();
      setData({
        totalRecords: mainJson.totalRecords || 0,
        totalVins: mainJson.totalVins || 0,
        okVins: mainJson.okVins || 0,
        nokVins: mainJson.nokVins || 0,
        drrPercent: mainJson.drrPercent || 0,
      });

      const defectsRes = await fetch(`${API_BASE}/api/drr-cp5-top-defects?${params.toString()}`);
      if (!defectsRes.ok) throw new Error('Ошибка загрузки топ дефектов');
      const defectsJson = await defectsRes.json();
      setTopDefects(defectsJson);
    } catch (err) {
      setError(err.message);
      setTopDefects([]);
    } finally {
      setLoading(false);
    }
  };

  const loadVinList = async (status) => {
    setVinModalLoading(true);
    try {
      const { start, end } = getTimeRange(timeFilter);
      const params = new URLSearchParams({
        startTime: start,
        endTime: end,
        status,
        filter: lineFilter,
      });
      const res = await fetch(`${API_BASE}/api/drr-cp5-vins?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки списка VIN');
      const json = await res.json();
      setVinList(json);
      setVinListStatus(status);
      setShowVinModal(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setVinModalLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [timeFilter, lineFilter]);

  useEffect(() => {
    const interval = setInterval(() => {
      setShiftInfo(getCurrentShiftInfo());
      if (!isManualFilter) setTimeFilter(getDefaultTimeFilter());
    }, 60000);
    return () => clearInterval(interval);
  }, [isManualFilter]);

  useEffect(() => {
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [timeFilter, lineFilter]);

  const pieData = [
    { name: 'DRR (OK)', value: data.drrPercent },
    { name: 'NOK', value: Math.max(0, 100 - data.drrPercent) },
  ];

  const handleFilterClick = (filter) => {
    setIsManualFilter(true);
    setTimeFilter(filter);
  };

  const formatDateTime = (str) => {
    if (!str) return '—';
    try {
      const d = new Date(str);
      if (isNaN(d.getTime())) return String(str);
      return d.toLocaleString('ru-RU');
    } catch {
      return String(str);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>DRR CP5</h1>
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

          {/* === Фильтры даты === */}
          <div style={{ width: '1px', height: '60px', backgroundColor: '#D1D5DB' }} />
          <div style={filterGroupStyle}>
            <button style={timeFilterButtonStyle(timeFilter === 'all', '#6B7280')} onClick={() => handleFilterClick('all')}>Сутки</button>
            <button style={timeFilterButtonStyle(timeFilter === 'day', '#F59E0B')} onClick={() => handleFilterClick('day')}>День</button>
            <button style={timeFilterButtonStyle(timeFilter === 'evening', '#3B82F6')} onClick={() => handleFilterClick('evening')}>Вечер</button>
            <button style={timeFilterButtonStyle(timeFilter === 'night', '#1F2937')} onClick={() => handleFilterClick('night')}>Ночь</button>
          </div>

          {/* === НОВЫЙ ФИЛЬТР ЛИНИИ === */}
          <div style={{ width: '1px', height: '60px', backgroundColor: '#D1D5DB' }} />
          <div style={filterGroupStyle}>
            <button
              style={timeFilterButtonStyle(lineFilter === 'all', '#6B7280')}
              onClick={() => setLineFilter('all')}
            >Все</button>
            <button
              style={timeFilterButtonStyle(lineFilter === 'BSP100', '#8B5CF6')}
              onClick={() => setLineFilter('BSP100')}
            >BSP100</button>
            <button
              style={timeFilterButtonStyle(lineFilter === 'BS', '#EC4899')}
              onClick={() => setLineFilter('BS')}
            >BS</button>
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
            <div style={{ position: 'relative', width: '100%', height: '600px' }}>
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
                    contentStyle={{ fontSize: '1.8rem', borderRadius: '16px' }}
                  />
                </PieChart>
              </ResponsiveContainer>

              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none',
              }}>
                <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#1E293B', marginBottom: '8px' }}>DRR</div>
                <div style={{ fontSize: '6.2rem', fontWeight: 900, color: '#1E293B', lineHeight: 1 }}>
                  {data.drrPercent.toFixed(1)}%
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '15px', marginTop: '20px', flexWrap: 'wrap' }}>
              <div
                style={{ flex: 1, backgroundColor: '#1E293B', borderRadius: '12px', padding: '16px', textAlign: 'center', color: '#FFFFFF', minHeight: '140px', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer' }}
                onClick={() => loadVinList('ALL')}
              >
                <div style={{ fontSize: '1.2rem', fontWeight: 600, opacity: 0.9 }}>Прошли CP5</div>
                <div style={{ width: '70%', height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', margin: '10px auto' }} />
                <div style={{ fontSize: '4rem', fontWeight: 900, lineHeight: 1 }}>{data.totalRecords}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.75, marginTop: 6 }}>
                  Уник. VIN: {data.totalVins}
                </div>
              </div>

              <div
                style={{ flex: 1, backgroundColor: '#059669', borderRadius: '12px', padding: '16px', textAlign: 'center', color: '#FFFFFF', minHeight: '140px', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer' }}
                onClick={() => loadVinList('OK')}
              >
                <div style={{ fontSize: '1.2rem', fontWeight: 600, opacity: 0.9 }}>OK</div>
                <div style={{ width: '70%', height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', margin: '10px auto' }} />
                <div style={{ fontSize: '4rem', fontWeight: 900, lineHeight: 1 }}>{data.okVins}</div>
              </div>

              <div
                style={{ flex: 1, backgroundColor: '#DC2626', borderRadius: '12px', padding: '16px', textAlign: 'center', color: '#FFFFFF', minHeight: '140px', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer' }}
                onClick={() => loadVinList('NOK')}
              >
                <div style={{ fontSize: '1.2rem', fontWeight: 600, opacity: 0.9 }}>NOK</div>
                <div style={{ width: '70%', height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', margin: '10px auto' }} />
                <div style={{ fontSize: '4rem', fontWeight: 900, lineHeight: 1 }}>{data.nokVins}</div>
              </div>
            </div>
          </div>

          <div style={rightColumnStyle}>
            <div style={tableCardStyle}>
              <h2 style={tableTitleStyle}>Топ дефектов, повлиявших на DRR CP5</h2>
              <div style={tableScrollStyle}>
                {topDefects.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Описание дефекта (MPP)</th>
                        <th style={thStyle}>Класс</th>
                        <th style={thStyle}>Кол-во</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topDefects.map((defect, idx) => (
                        <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                          <td style={{ ...tdStyle, boxShadow: idx < 3 ? 'inset 10px 0 0 #EF4444' : 'none' }}>{defect.mpp}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, color: '#475569' }}>{defect.grade}</td>
                          <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 900, fontSize: '2rem', color: idx < 3 ? '#DC2626' : '#1E293B' }}>
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
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #E5E7EB' }}>Время CP5</th>
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
                        <td style={{ padding: '8px', borderBottom: '1px solid #F0F0F5' }}>{formatDateTime(item.cp5_time)}</td>
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