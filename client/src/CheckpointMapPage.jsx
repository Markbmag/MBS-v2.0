import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  ResponsiveContainer
} from 'recharts';

const API_BASE = '';

const checkpointColors = {
  PIP: '#F59E0B',
  CP7: '#6EE7B7',
  TL: '#8B5CF6',
  CP8: '#3B82F6',
};

const CHECKPOINTS = ['PIP', 'CP7', 'TL', 'CP8'];

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

export default function CheckpointMapPage() {
  const [dateFrom, setDateFrom] = useState(getTodayStr());
  const [dateTo, setDateTo] = useState(getTodayStr());
  const [model, setModel] = useState('ALL');
  const [defectType, setDefectType] = useState('all');
  const [availableModels] = useState(['ALL', 'ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8']);
  const [stats, setStats] = useState([]);
  const [defectData, setDefectData] = useState([]);
  const [remzoneCp7, setRemzoneCp7] = useState([]);
  const [remzoneTl, setRemzoneTl] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hoveredCp, setHoveredCp] = useState(null);

  const mainContainerRef = useRef(null);
  const [arrowCoords, setArrowCoords] = useState([]);

  // Загрузка данных (оставлено без изменений)
  useEffect(() => {
    const params = new URLSearchParams({ dateFrom, dateTo, defectType });
    if (model !== 'ALL') params.append('model', model);
    fetch(`${API_BASE}/api/checkpoint-stats?${params.toString()}`)
      .then(res => res.json())
      .then(data => setStats(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [dateFrom, dateTo, model, defectType]);

  useEffect(() => {
    const promises = CHECKPOINTS.map(cp => {
      const params = new URLSearchParams({ checkpoint: cp, defectType, dateFrom, dateTo });
      if (model !== 'ALL') params.append('model', model);
      return fetch(`${API_BASE}/api/checkpoint-defects?${params.toString()}`)
        .then(res => res.json())
        .then(data => {
          const arr = Array.isArray(data) ? data : [];
          arr.forEach(item => item.CHECKPOINT = cp);
          return arr;
        });
    });
    Promise.all(promises).then(results => setDefectData(results.flat()));
  }, [dateFrom, dateTo, model, defectType]);

  useEffect(() => {
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (model !== 'ALL') params.append('model', model);
    fetch(`${API_BASE}/api/remzone-stats?${params.toString()}`)
      .then(res => res.json())
      .then(data => setRemzoneCp7(Array.isArray(data) ? data : []));
  }, [dateFrom, dateTo, model]);

  useEffect(() => {
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (model !== 'ALL') params.append('model', model);
    fetch(`${API_BASE}/api/remzone-tl-stats?${params.toString()}`)
      .then(res => res.json())
      .then(data => setRemzoneTl(Array.isArray(data) ? data : []));
  }, [dateFrom, dateTo, model]);

  // График данных с накоплением
  const chartData = useMemo(() => {
    return CHECKPOINTS.map(cp => {
      const stat = stats.find(s => s.checkpoint === cp) || { offlineVins: 0, onlineVins: 0, inheritedOffline: 0 };
      const inherited = stat.inheritedOffline || 0;
      return {
        checkpoint: cp,
        offlineBase: stat.offlineVins - inherited,
        offlineInherited: inherited,
        online: stat.onlineVins,
      };
    });
  }, [stats]);

  const maxTotal = useMemo(() => {
    const maxVal = Math.max(...chartData.map(d => d.offlineBase + d.offlineInherited + d.online), 0);
    return Math.max(200, maxVal + 20);
  }, [chartData]);

  // Таблицы MPP (без изменений)
  const tableData = useMemo(() => {
    const grouped = {};
    CHECKPOINTS.forEach(cp => {
      const cpData = defectData.filter(d => d.CHECKPOINT === cp);
      const mppCount = {};
      cpData.forEach(d => {
        const mpp = d.MPP;
        if (!mppCount[mpp]) mppCount[mpp] = 0;
        mppCount[mpp] += d.DEFECTS_COUNT || 0;
      });
      const sorted = Object.entries(mppCount)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      grouped[cp] = sorted;
    });
    return grouped;
  }, [defectData]);

  const periodLabel = useMemo(() => {
    if (dateFrom === dateTo) return dateFrom.split('-').reverse().join('.');
    const from = dateFrom.split('-');
    const to = dateTo.split('-');
    return `${from[2]}.${from[1]}.${from[0]} – ${to[2]}.${to[1]}.${to[0]}`;
  }, [dateFrom, dateTo]);

  // Рендереры label'ов
  const renderOfflineLabel = useCallback((props) => {
    const { x, y, width, index } = props;
    const item = chartData[index];
    const total = (item.offlineBase || 0) + (item.offlineInherited || 0);
    if (!total) return null;
    return (
      <g>
        <text x={x + width + 5} y={y + 12} fill="#EF4444" fontSize={15} fontWeight={700} textDecoration="underline" textAnchor="start">
          {total}
        </text>
        {item.offlineInherited > 0 && (
          <text x={x + width + 5} y={y + 30} fill="#6B7280" fontSize={11} textAnchor="start">
            {item.checkpoint === 'CP8' ? `из ремзоны: ${item.offlineInherited}` : `из них с пред.: ${item.offlineInherited}`}
          </text>
        )}
      </g>
    );
  }, [chartData]);

  const renderOnlineLabel = useCallback((props) => {
    const { x, y, width, value } = props;
    if (!value) return null;
    return (
      <text x={x + width + 5} y={y + 12} fill="#3B82F6" fontSize={15} fontWeight={700} textDecoration="underline" textAnchor="start">
        {value}
      </text>
    );
  }, []);

  // Вычисление стрелок
  const updateArrows = useCallback(() => {
    const container = mainContainerRef.current;
    if (!container) return;
    const chartArea = container.querySelector('.chart-area');
    const cp7Card = document.getElementById('remzone-cp7-card');
    const tlCard = document.getElementById('remzone-tl-card');
    if (!chartArea || !cp7Card || !tlCard) return;

    const containerRect = container.getBoundingClientRect();
    const chartRect = chartArea.getBoundingClientRect();
    const cp7CardRect = cp7Card.getBoundingClientRect();
    const tlCardRect = tlCard.getBoundingClientRect();

    // Позиции столбцов относительно контейнера
    const getBarRightCenter = (index) => {
      const barWidth = chartRect.width / CHECKPOINTS.length;
      const x = chartRect.left - containerRect.left + barWidth * (index + 0.5) + 15; // правый край
      const y = chartRect.top - containerRect.top + chartRect.height / 2;
      return { x, y };
    };

    const cp7Bar = getBarRightCenter(1);
    const tlBar = getBarRightCenter(2);

    const cp7Target = {
      x: cp7CardRect.left - containerRect.left,
      y: cp7CardRect.top - containerRect.top + cp7CardRect.height / 2,
    };
    const tlTarget = {
      x: tlCardRect.left - containerRect.left,
      y: tlCardRect.top - containerRect.top + tlCardRect.height / 2,
    };

    setArrowCoords([ 
      { from: cp7Bar, to: cp7Target },
      { from: tlBar, to: tlTarget }
    ]);
  }, []);

  useEffect(() => {
    updateArrows();
    window.addEventListener('resize', updateArrows);
    return () => window.removeEventListener('resize', updateArrows);
  }, [updateArrows, chartData, remzoneCp7, remzoneTl]);

  useEffect(() => {
    if (stats.length > 0) setLoading(false);
  }, [stats]);

  if (loading) return <div style={styles.loading}>Загрузка...</div>;

  return (
    <div style={styles.container} ref={mainContainerRef}>
      <h1 style={styles.title}>Checkpoint Map</h1>

      <div style={styles.filterBar}>
        <label style={filterLabelStyle}>Период с: <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={filterInputStyle} /></label>
        <label style={filterLabelStyle}>по: <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={filterInputStyle} /></label>
        <label style={filterLabelStyle}>
          Модель:
          <select value={model} onChange={e => setModel(e.target.value)} style={filterSelectStyle}>
            {availableModels.map(m => <option key={m} value={m}>{m === 'ALL' ? 'Все модели' : m}</option>)}
          </select>
        </label>
        <label style={filterLabelStyle}>
          Тип дефектов:
          <select value={defectType} onChange={e => setDefectType(e.target.value)} style={filterSelectStyle}>
            <option value="all">Все</option>
            <option value="offline">Офлайн</option>
            <option value="online">Онлайн</option>
          </select>
        </label>
      </div>

      {/* Основная область с графиком и карточками */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', position: 'relative' }}>
        <div className="chart-area" style={{ ...styles.chartSection, flex: 2 }}>
          <h2 style={styles.chartTitle}>К‑во авто с офлайн‑дефектами по постам за {periodLabel}</h2>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 20, right: 80, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="checkpoint" stroke="#374151" />
              <YAxis stroke="#374151" allowDecimals={false} domain={[0, maxTotal]} />
              <Legend wrapperStyle={{ paddingTop: 10 }} />
              <Bar dataKey="offlineBase" name="Офлайн" fill="#EF4444" stackId="stack" barSize={50} label={renderOfflineLabel} />
              <Bar dataKey="offlineInherited" name="Офлайн (с пред.)" fill="#EF4444" stackId="stack" barSize={50}
                   fillOpacity={0.4} stroke="#EF4444" strokeWidth={1.5} strokeDasharray="4 2" />
              <Bar dataKey="online" name="Онлайн" fill="#3B82F6" stackId="stack" barSize={50} label={renderOnlineLabel} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>
          <div id="remzone-cp7-card" style={styles.remzoneCard}>
            <h3 style={styles.remzoneTitle}>⬅️ Ремзона с CP7</h3>
            {remzoneCp7.length > 0 ? (
              <table style={styles.table}>
                <thead><tr style={styles.tableHeader}><th style={styles.th}>Модель</th><th style={styles.th}>Кол-во</th></tr></thead>
                <tbody>{remzoneCp7.map((row, idx) => (
                  <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#F9FAFB' : '#FFFFFF' }}>
                    <td style={styles.td}>{row.MODEL}</td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>{row.REMZONE_COUNT}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <p style={{ color: '#6B7280', fontSize: 13 }}>Нет данных</p>}
          </div>
          <div id="remzone-tl-card" style={styles.remzoneCard}>
            <h3 style={styles.remzoneTitle}>⬅️ Ремзона с TL</h3>
            {remzoneTl.length > 0 ? (
              <table style={styles.table}>
                <thead><tr style={styles.tableHeader}><th style={styles.th}>Модель</th><th style={styles.th}>Кол-во</th></tr></thead>
                <tbody>{remzoneTl.map((row, idx) => (
                  <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#F9FAFB' : '#FFFFFF' }}>
                    <td style={styles.td}>{row.MODEL}</td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>{row.REMZONE_COUNT}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <p style={{ color: '#6B7280', fontSize: 13 }}>Нет данных</p>}
          </div>
        </div>        
      </div>

      {/* Таблицы дефектов */}
      <div style={styles.tablesSection}>
        {CHECKPOINTS.map(cp => {
          const stat = stats.find(s => s.checkpoint === cp) || { posts: [] };
          return (
            <div key={cp} style={styles.cpTableBlock}
              onMouseEnter={() => setHoveredCp(cp)}
              onMouseLeave={() => setHoveredCp(null)}>
              <h3 style={{ ...styles.cpTableTitle, color: checkpointColors[cp] || '#374151' }}>{cp}</h3>
              {hoveredCp === cp && <div style={styles.postsBlock}>Посты: {stat.posts.join(', ')}</div>}
              {tableData[cp]?.length > 0 ? (
                <table style={styles.table}>
                  <thead><tr style={styles.tableHeader}><th style={styles.th}>Дефект (MPP)</th><th style={styles.th}>Кол.</th></tr></thead>
                  <tbody>{tableData[cp].map((row, idx) => (
                    <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#F9FAFB' : '#FFFFFF' }}>
                      <td style={styles.td}>{row.name}</td>
                      <td style={{ ...styles.td, textAlign: 'center' }}>{row.count}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p style={{ color: '#6B7280', fontSize: 13 }}>Нет дефектов</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const filterInputStyle = { padding: '4px 8px', borderRadius: 4, border: '1px solid #D1D5DB' };
const filterSelectStyle = { padding: '4px 8px', borderRadius: 4, border: '1px solid #D1D5DB' };
const filterLabelStyle = { display: 'flex', alignItems: 'center', gap: 8, color: '#374151', fontSize: 14 };

const styles = {
  container: { backgroundColor: '#F3F4F6', minHeight: '100vh', padding: 20, color: '#111827', fontFamily: 'Segoe UI, Arial, sans-serif', position: 'relative' },
  title: { fontSize: 26, fontWeight: 700, color: '#1F2937', marginBottom: 24 },
  filterBar: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  chartSection: {
    backgroundColor: '#FFFFFF', borderRadius: 8, padding: 20,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  chartTitle: { fontSize: 18, fontWeight: 600, color: '#1F2937', marginBottom: 10 },
  remzoneCard: {
    backgroundColor: '#FFFFFF', borderRadius: 8, padding: 16,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  remzoneTitle: { fontSize: 16, fontWeight: 700, color: '#B91C1C', marginBottom: 8, borderBottom: '2px solid #FECACA', paddingBottom: 4 },
  tablesSection: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, marginTop: 30 },
  cpTableBlock: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', cursor: 'default' },
  cpTableTitle: { fontSize: 18, fontWeight: 700, marginBottom: 8, borderBottom: '2px solid', paddingBottom: 4 },
  postsBlock: { fontSize: 13, color: '#4B5563', marginBottom: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  tableHeader: { backgroundColor: '#F3F4F6' },
  th: { padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '2px solid #E5E7EB' },
  td: { padding: '6px 8px', borderBottom: '1px solid #E5E7EB', color: '#1F2937' },
  loading: { textAlign: 'center', padding: 50, fontSize: 18, color: '#6B7280' },
};