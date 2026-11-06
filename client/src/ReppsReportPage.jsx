import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts';

const API_BASE = '';

/* ===================== ЦВЕТА ===================== */
const reppsBarTypeColors = {
  year: '#7C3AED',
  month: '#0EA5E9',
  week: '#14B8A6',
  day: '#F59E0B',
};

const reppsTypeBgColors = {
  year: '#F3E8FF',
  month: '#E0F2FE',
  week: '#CCFBF1',
  day: '#FEF3C7',
};

const stackColors = {
  no_paint:          '#DC2626',
  paint_closed_only: '#10B981',
  paint_open:        '#F59E0B',
};

const SPOT_COLOR    = '#F59E0B';
const REPAINT_COLOR = '#DC2626';

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
  'total': 'Total',
};

const H_SECTION_TITLE = 26;
const H_CHART_2 = 260;

const cardStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  padding: 20,
  marginBottom: 20,
  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
  border: '1px solid #F0F0F5',
};

const sectionCardStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 14,
  padding: 14,
  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
  border: '1px solid #F0F0F5',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};

const tabStyle = (active) => ({
  padding: '10px 28px',
  borderRadius: 10,
  border: 'none',
  fontWeight: 600,
  fontSize: 15,
  background: active ? '#7C3AED' : '#F3F4F6',
  color: active ? '#FFFFFF' : '#6B7280',
  cursor: 'pointer',
  boxShadow: active ? '0 4px 12px rgba(124,58,237,0.25)' : 'none',
  transition: 'all 0.2s',
});

const inputStyle = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: 14,
  background: '#F9FAFB',
};

const thStyle = {
  textAlign: 'center',
  fontWeight: 600,
  color: '#374151',
  borderBottom: '2px solid #E5E7EB',
  background: '#F9FAFB',
  whiteSpace: 'nowrap',
  padding: '5px 4px',
  fontSize: '10px',
};

const tdStyle = {
  textAlign: 'center',
  borderBottom: '1px solid #F0F0F5',
  color: '#1F2937',
  whiteSpace: 'nowrap',
  padding: '3px 4px',
  fontSize: '11px',
};

const clickableTdStyle = {
  ...tdStyle,
  cursor: 'pointer',
  transition: 'background-color 0.15s',
};

const sectionTitleStyle = {
  fontSize: 15,
  fontWeight: 700,
  color: '#111827',
  margin: '0 0 10px 0',
  paddingBottom: 6,
  borderBottom: '2px solid #E5E7EB',
  height: H_SECTION_TITLE,
  boxSizing: 'border-box',
};

const reportHeaderStyle = {
  fontSize: 20,
  fontWeight: 700,
  color: '#111827',
  margin: '0 0 14px 0',
  paddingBottom: 10,
  borderBottom: '2px solid #E5E7EB',
};

const tableHeaderStyle = {
  fontSize: 12,
  fontWeight: 700,
  color: '#374151',
  margin: '10px 0 6px 0',
};

const tableWrapStyle = {
  marginTop: 4,
  border: '1px solid #E5E7EB',
  borderRadius: 6,
  overflow: 'hidden',
};

const dashDividerStyle = {
  borderTop: '2px dashed #CBD5E1',
  marginTop: 12,
  marginBottom: 8,
};

const modalThStyle = {
  padding: '10px 12px',
  textAlign: 'left',
  background: '#F9FAFB',
  borderBottom: '2px solid #E5E7EB',
  position: 'sticky',
  top: 0,
  zIndex: 2,
  whiteSpace: 'nowrap',
};

const modalTdStyle = {
  padding: '8px 12px',
  borderBottom: '1px solid #F0F0F5',
  verticalAlign: 'top',
};

/* ===================== Хелперы ===================== */
const shortenLabel = (label, type) => {
  if (!label) return '';

  if (type === 'day') {
    const m = String(label).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}.${m[2]}`;
    return label;
  }

  if (type === 'month') {
    const [m, y] = String(label).split(' ');
    return y ? `${m}'${y.slice(2)}` : m;
  }

  if (type === 'week') {
    return String(label).split(' ')[0];
  }

  return label;
};

const formatDateTime = (str) => {
  if (!str) return '—';
  try { return new Date(str).toLocaleString('ru-RU'); } catch { return String(str); }
};

/* ===================== ПОДТАБЫ ===================== */
const subTabBarStyle = {
  display: 'flex',
  gap: 4,
  marginBottom: 20,
  borderBottom: '2px solid #E5E7EB',
};

const subTabStyle = (active) => ({
  padding: '12px 26px',
  border: 'none',
  background: 'transparent',
  fontSize: 16,
  fontWeight: 700,
  color: active ? '#7C3AED' : '#6B7280',
  cursor: 'pointer',
  borderBottom: active ? '3px solid #7C3AED' : '3px solid transparent',
  marginBottom: -2,
  transition: 'all 0.15s',
});

/* ====================================================================== */
/* ===================== SPOT-ПЕРЕКРАС ОТЧЁТ =========================== */
/* ====================================================================== */
function SpotRepaintReport() {
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
  const [modalMeta, setModalMeta] = useState({ label: '', category: '', model: '' });

  const availableModels = ['ALL', 'ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];
  const modelKeys = ['ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];

  useEffect(() => {
    if (modalOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [modalOpen]);

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

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ period });
    if (period !== 'all' && count) params.append('count', count);
    if (period !== 'all' && fromDate && toDate) {
      params.append('fromDate', fromDate);
      params.append('toDate', toDate);
    }
    fetch(`${API_BASE}/api/repps-spot-repaint?${params.toString()}`)
      .then(res => res.json())
      .then(json => {
        setDataPoints(json.dataPoints || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Ошибка загрузки Spot-Перекрас:', err);
        setLoading(false);
      });
  }, [period, count, fromDate, toDate]);

  const chartData = useMemo(() => dataPoints.map(p => ({ ...p })), [dataPoints]);

  const groupedByType = useMemo(() => {
    if (period !== 'all') return null;
    return {
      months: chartData.filter(p => p.type === 'month'),
      weeks:  chartData.filter(p => p.type === 'week'),
      days:   chartData.filter(p => p.type === 'day'),
    };
  }, [chartData, period]);

  const stackKeySpot    = selectedModel === 'ALL' ? 'spot'    : `${selectedModel}_spot`;
  const stackKeyRepaint = selectedModel === 'ALL' ? 'repaint' : `${selectedModel}_repaint`;

  const openVinsModal = (startDate, endDate, category, model, label) => {
    setModalOpen(true);
    setModalLoading(true);
    setModalVins([]);
    setModalMeta({ label, category, model });

    const params = new URLSearchParams({ dateFrom: startDate, dateTo: endDate, category });
    if (model && model !== 'ALL') params.append('model', model);

    fetch(`${API_BASE}/api/repps-spot-repaint-vins?${params.toString()}`)
      .then(res => res.json())
      .then(json => { setModalVins(json || []); setModalLoading(false); })
      .catch(() => { setModalVins([]); setModalLoading(false); });
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalVins([]);
  };

  /* ---------- CHART ---------- */
  const renderStackChart = (points) => {
    if (!points.length) return <p style={{ padding: 16, color: '#6B7280', textAlign: 'center', fontSize: 13 }}>Нет данных</p>;

    const displayData = points.map(p => {
      const repaintVal = Number(p[stackKeyRepaint]) || 0;
      return {
        ...p,
        displayLabel: shortenLabel(p.label, p.type),
        [stackKeyRepaint]: repaintVal > 0 ? repaintVal : 0.001,
      };
    });

    return (
      <ResponsiveContainer width="100%" height={H_CHART_2}>
        <BarChart data={displayData} margin={{ top: 20, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="displayLabel" tick={{ fontSize: 10 }} interval={0} height={28} />
          <YAxis domain={[0, 'auto']} tick={{ fontSize: 10 }} allowDecimals={false} width={30} />
          <Bar dataKey={stackKeySpot} stackId="s" fill={SPOT_COLOR} barSize={22} />
          <Bar
            dataKey={stackKeyRepaint}
            stackId="s"
            fill={REPAINT_COLOR}
            barSize={22}
            radius={[4, 4, 0, 0]}
          >
            <LabelList
              dataKey="total"
              position="top"
              style={{ fontSize: 10, fontWeight: 700, fill: '#111827' }}
              formatter={(v) => (v !== null && v !== undefined && v > 0 ? v : '')}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  };

  /* ---------- ТАБЛИЦА КАТЕГОРИЙ ---------- */
  const renderCategoryTable = (points) => {
    if (!points.length) return null;
    const displayLabels = points.map(p => shortenLabel(p.label, p.type));

    const rows = [
      { key: stackKeySpot,    label: 'Spot',     color: SPOT_COLOR,    category: 'spot' },
      { key: stackKeyRepaint, label: 'Перекрас', color: REPAINT_COLOR, category: 'repaint' },
    ];

    return (
      <>
        <h4 style={tableHeaderStyle}>По категориям</h4>
        <div style={tableWrapStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ ...thStyle, width: 90, paddingLeft: 6, textAlign: 'left' }}>Кат.</th>
                {points.map((point, idx) => (
                  <th key={idx} style={{ ...thStyle, backgroundColor: reppsTypeBgColors[point.type] || '#F9FAFB' }}>
                    {displayLabels[idx]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key} style={{ backgroundColor: 'white' }}>
                  <td style={{ ...tdStyle, paddingLeft: 6, textAlign: 'left', color: row.color, fontWeight: 700 }}>
                    {row.label}
                  </td>
                  {points.map((point, idx) => {
                    const val = point[row.key];
                    return (
                      <td
                        key={idx}
                        style={{
                          ...clickableTdStyle,
                          backgroundColor: reppsTypeBgColors[point.type] || '#F9FAFB',
                          fontWeight: 700, color: row.color,
                        }}
                        onClick={() => val > 0 && openVinsModal(point.startDate, point.endDate, row.category, selectedModel, point.label)}
                        onMouseEnter={(e) => { if (val > 0) e.currentTarget.style.backgroundColor = '#BFDBFE'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = reppsTypeBgColors[point.type] || '#F9FAFB'; }}
                        title={val > 0 ? 'Клик — показать VIN' : ''}
                      >
                        {val !== null && val !== undefined ? val : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr style={{ backgroundColor: '#F3F4F6', fontWeight: 700 }}>
                <td style={{ ...tdStyle, paddingLeft: 6, textAlign: 'left' }}>Всего</td>
                {points.map((point, idx) => {
                  const val = point.total;
                  return (
                    <td
                      key={idx}
                      style={{ ...clickableTdStyle, fontWeight: 700 }}
                      onClick={() => val > 0 && openVinsModal(point.startDate, point.endDate, 'total', selectedModel, point.label)}
                      onMouseEnter={(e) => { if (val > 0) e.currentTarget.style.backgroundColor = '#BFDBFE'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      {val !== null && val !== undefined ? val : ''}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </>
    );
  };

  /* ---------- ТАБЛИЦА ПО МОДЕЛЯМ ---------- */
  const renderModelTable = (points) => {
    if (!points.length) return null;
    const displayLabels = points.map(p => shortenLabel(p.label, p.type));
    const modelsToShow = selectedModel === 'ALL' ? [...modelKeys, 'total'] : [selectedModel];

    return (
      <>
        <h4 style={tableHeaderStyle}>По моделям</h4>
        <div style={tableWrapStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ ...thStyle, width: 60, paddingLeft: 6, textAlign: 'left' }}>Мод.</th>
                {points.map((point, idx) => (
                  <th key={idx} style={{ ...thStyle, backgroundColor: reppsTypeBgColors[point.type] || '#F9FAFB' }}>
                    {displayLabels[idx]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modelsToShow.map(modelKey => {
                const isTotal = modelKey === 'total';
                return (
                  <tr key={modelKey} style={{
                    backgroundColor: isTotal ? '#F3F4F6' : 'white',
                    fontWeight: isTotal ? 700 : 400,
                  }}>
                    <td style={{ ...tdStyle, paddingLeft: 6, textAlign: 'left', fontWeight: 600 }}>
                      {modelShortNames[modelKey] || modelKey}
                    </td>
                    {points.map((point, idx) => {
                      const val = isTotal ? point.total : point[modelKey];
                      const modelParam = isTotal ? 'ALL' : modelKey;
                      return (
                        <td
                          key={idx}
                          style={{
                            ...clickableTdStyle,
                            backgroundColor: reppsTypeBgColors[point.type] || '#F9FAFB',
                            color: val !== null && val !== undefined && val > 0 ? '#1F2937' : '#9CA3AF',
                            fontWeight: val > 0 ? 600 : 400,
                          }}
                          onClick={() => val > 0 && openVinsModal(point.startDate, point.endDate, 'total', modelParam, point.label)}
                          onMouseEnter={(e) => { if (val > 0) e.currentTarget.style.backgroundColor = '#BFDBFE'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = reppsTypeBgColors[point.type] || '#F9FAFB'; }}
                        >
                          {val !== null && val !== undefined ? val : ''}
                        </td>
                      );
                    })}
                  </tr>
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

  const categoryLabels = {
    spot:    'Spot',
    repaint: 'Перекрас',
    total:   'всего (Spot + Перекрас)',
  };

  return (
    <div>
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
                    style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#9CA3AF', color: '#FFF', cursor: 'pointer' }}
                  >✕</button>
                )}
              </div>
            </>
          )}

          <label style={{ fontSize: 14, color: '#4B5563', display: 'flex', alignItems: 'center', gap: 6 }}>
            Модель:
            <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} style={inputStyle}>
              {availableModels.map(m => <option key={m} value={m}>{m === 'ALL' ? 'Все' : m}</option>)}
            </select>
          </label>

          <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#4B5563', marginLeft: 'auto', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, backgroundColor: SPOT_COLOR, borderRadius: 3, display: 'inline-block' }} />
              Spot
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, backgroundColor: REPAINT_COLOR, borderRadius: 3, display: 'inline-block' }} />
              Перекрас
            </span>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={cardStyle}>
          <p style={{ textAlign: 'center', color: '#6B7280', padding: 40 }}>Загрузка данных...</p>
        </div>
      ) : period === 'all' ? (
        <div style={cardStyle}>
          <h2 style={reportHeaderStyle}>Авто со Spot / Перекрасом</h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 2.3fr)',
            gap: 16,
            alignItems: 'start',
          }}>
            {renderSection('📅 3 месяца', groupedByType.months, '#0EA5E9')}
            {renderSection('📆 4 недели',  groupedByType.weeks,  '#14B8A6')}
            {renderSection('📊 14 дней',   groupedByType.days,   '#F59E0B')}
          </div>
        </div>
      ) : (
        <div style={cardStyle}>
          <h2 style={reportHeaderStyle}>Авто со Spot / Перекрасом</h2>
          {renderStackChart(chartData)}
          {renderCategoryTable(chartData)}
          <div style={dashDividerStyle} />
          {renderModelTable(chartData)}
        </div>
      )}

      {modalOpen && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15,23,42,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2000, padding: 20,
          }}
          onClick={closeModal}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF', borderRadius: 14, padding: 20,
              width: '100%', maxWidth: 1200, maxHeight: '85vh',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111827' }}>
                  {modalMeta.label} · {categoryLabels[modalMeta.category] || modalMeta.category}
                  {modalMeta.model !== 'ALL' && ` · ${modalMeta.model}`}
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6B7280' }}>
                  Всего VIN: {modalVins.length}
                </p>
              </div>
              <button
                onClick={closeModal}
                style={{ border: 'none', background: 'none', fontSize: 24, cursor: 'pointer', color: '#6B7280', lineHeight: 1 }}
              >×</button>
            </div>

            {modalLoading ? (
              <p style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Загрузка...</p>
            ) : modalVins.length === 0 ? (
              <p style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Нет данных</p>
            ) : (
              <div style={{ overflowY: 'auto', flex: 1, border: '1px solid #E5E7EB', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={modalThStyle}>VIN</th>
                      <th style={modalThStyle}>Модель</th>
                      <th style={modalThStyle}>Категория</th>
                      <th style={modalThStyle}>Дефекты (Spot / Перекрас)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalVins.map((item, idx) => (
                      <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                        <td style={{ ...modalTdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{item.vin}</td>
                        <td style={modalTdStyle}>{item.model}</td>
                        <td style={{
                          ...modalTdStyle,
                          fontWeight: 700,
                          color: item.category === 'repaint' ? REPAINT_COLOR : SPOT_COLOR,
                        }}>
                          {item.category === 'repaint' ? 'Перекрас' : 'Spot'}
                        </td>
                        <td style={modalTdStyle}>
                          {item.defects && item.defects.length > 0 ? (
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                              {item.defects.map((d, i) => (
                                <li key={i} style={{
                                  color: d.category === 'repaint' ? REPAINT_COLOR : SPOT_COLOR,
                                  fontWeight: 600,
                                }}>
                                  <span style={{
                                    display: 'inline-block',
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    background: d.category === 'repaint' ? '#FEE2E2' : '#FEF3C7',
                                    marginRight: 6,
                                    fontSize: 11,
                                  }}>
                                    {d.category === 'repaint' ? 'Перекрас' : 'Spot'}
                                  </span>
                                  {d.part_name} · {d.problem_type}
                                  {d.grade ? ` · ${d.grade}` : ''}
                                  {' · '}<span style={{ fontStyle: 'italic' }}>{d.status || '—'}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span style={{ color: '#9CA3AF', fontSize: 12 }}>Нет дефектов</span>
                          )}
                        </td>
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

/* ====================================================================== */
/* ===================== ОСНОВНАЯ СТРАНИЦА ============================== */
/* ====================================================================== */
export default function ReppsReportPage() {
  const [activeSubTab, setActiveSubTab] = useState('repps');

  const [period, setPeriod] = useState('all');
  const [count, setCount] = useState(3);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedModel, setSelectedModel] = useState('ALL');
  const [hideAssembly, setHideAssembly] = useState(true); // ВКЛЮЧЕН ПО УМОЛЧАНИЮ
  const [dataPoints, setDataPoints] = useState([]);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalVins, setModalVins] = useState([]);
  const [modalMeta, setModalMeta] = useState({ label: '', category: '', model: '' });

  const availableModels = ['ALL', 'ESTEO MX', 'JELAND J6', 'JELAND J7', 'JELAND J8', 'TENET A8'];

  useEffect(() => {
    if (modalOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prevOverflow; };
    }
  }, [modalOpen]);

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

  useEffect(() => {
    if (activeSubTab !== 'repps') return;
    setLoading(true);
    const params = new URLSearchParams({ period });
    if (period !== 'all' && count) params.append('count', count);
    if (period !== 'all' && fromDate && toDate) {
      params.append('fromDate', fromDate);
      params.append('toDate', toDate);
    }
    
    if (hideAssembly) params.append('hideAssembly', 'true');

    fetch(`${API_BASE}/api/repps-retrospective?${params.toString()}`)
      .then(res => res.json())
      .then(json => {
        setDataPoints(json.dataPoints || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Ошибка загрузки REPPS:', err);
        setLoading(false);
      });
  }, [period, count, fromDate, toDate, activeSubTab, hideAssembly]);

  const chartData = useMemo(() => dataPoints.map(p => ({ ...p })), [dataPoints]);

  const groupedByType = useMemo(() => {
    if (period !== 'all') return null;
    return {
      months: chartData.filter(p => p.type === 'month'),
      weeks:  chartData.filter(p => p.type === 'week'),
      days:   chartData.filter(p => p.type === 'day'),
    };
  }, [chartData, period]);

  const stackKeyNoPaint = selectedModel === 'ALL' ? 'no_paint'          : `${selectedModel}_no_paint`;
  const stackKeyClosed  = selectedModel === 'ALL' ? 'paint_closed_only' : `${selectedModel}_paint_closed_only`;
  const stackKeyOpen    = selectedModel === 'ALL' ? 'paint_open'        : `${selectedModel}_paint_open`;

  const modelKeys = Object.keys(modelColors);

  const openVinsModal = (startDate, endDate, category, model, label) => {
    setModalOpen(true);
    setModalLoading(true);
    setModalVins([]);
    setModalMeta({ label, category, model });

    const params = new URLSearchParams({ dateFrom: startDate, dateTo: endDate, category });
    if (model && model !== 'ALL') params.append('model', model);
    
    if (hideAssembly) params.append('hideAssembly', 'true');

    fetch(`${API_BASE}/api/repps-vins-details?${params.toString()}`)
      .then(res => res.json())
      .then(json => { setModalVins(json || []); setModalLoading(false); })
      .catch(() => { setModalVins([]); setModalLoading(false); });
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalVins([]);
  };

  /* ===================== CHART 2 — 3-стек ===================== */
  const renderStackChart = (points) => {
    if (!points.length) return <p style={{ padding: 16, color: '#6B7280', textAlign: 'center', fontSize: 13 }}>Нет данных</p>;

    const displayData = points.map(p => {
      const openVal = Number(p[stackKeyOpen]) || 0;
      return {
        ...p,
        displayLabel: shortenLabel(p.label, p.type),
        [stackKeyOpen]: openVal > 0 ? openVal : 0.001,
      };
    });

    return (
      <ResponsiveContainer width="100%" height={H_CHART_2}>
        <BarChart data={displayData} margin={{ top: 20, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="displayLabel" tick={{ fontSize: 10 }} interval={0} height={28} />
          <YAxis domain={[0, 'auto']} tick={{ fontSize: 10 }} allowDecimals={false} width={30} />
          <Bar dataKey={stackKeyNoPaint} stackId="split" fill={stackColors.no_paint} barSize={22} />
          <Bar dataKey={stackKeyClosed}  stackId="split" fill={stackColors.paint_closed_only} barSize={22} />
          <Bar
            dataKey={stackKeyOpen}
            stackId="split"
            fill={stackColors.paint_open}
            barSize={22}
            radius={[4, 4, 0, 0]}
          >
            <LabelList
              dataKey="total"
              position="top"
              style={{ fontSize: 10, fontWeight: 700, fill: '#111827' }}
              formatter={(v) => (v !== null && v !== undefined && v > 0 ? v : '')}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  };

  /* ===================== Таблица категорий ===================== */
  const renderCategoryTable = (points) => {
    if (!points.length) return null;
    const displayLabels = points.map(p => shortenLabel(p.label, p.type));

    const rows = [
      { key: stackKeyNoPaint, label: 'Без PS',      color: stackColors.no_paint,          category: 'no_paint' },
      { key: stackKeyClosed,  label: 'PS закрыты',  color: stackColors.paint_closed_only, category: 'paint_closed_only' },
      { key: stackKeyOpen,    label: 'PS открыты',  color: stackColors.paint_open,        category: 'paint_open' },
    ];

    return (
      <>
        <h4 style={tableHeaderStyle}>По категориям</h4>
        <div style={tableWrapStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ ...thStyle, width: 90, paddingLeft: 6, textAlign: 'left' }}>Кат.</th>
                {points.map((point, idx) => (
                  <th key={idx} style={{ ...thStyle, backgroundColor: reppsTypeBgColors[point.type] }}>
                    {displayLabels[idx]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key} style={{ backgroundColor: 'white' }}>
                  <td style={{ ...tdStyle, paddingLeft: 6, textAlign: 'left', color: row.color, fontWeight: 700 }}>
                    {row.label}
                  </td>
                  {points.map((point, idx) => {
                    const val = point[row.key];
                    return (
                      <td
                        key={idx}
                        style={{
                          ...clickableTdStyle,
                          backgroundColor: reppsTypeBgColors[point.type],
                          fontWeight: 700, color: row.color,
                        }}
                        onClick={() => val > 0 && openVinsModal(point.startDate, point.endDate, row.category, selectedModel, point.label)}
                        onMouseEnter={(e) => { if (val > 0) e.currentTarget.style.backgroundColor = '#BFDBFE'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = reppsTypeBgColors[point.type]; }}
                        title={val > 0 ? 'Клик — показать VIN' : ''}
                      >
                        {val !== null && val !== undefined ? val : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr style={{ backgroundColor: '#F3F4F6', fontWeight: 700 }}>
                <td style={{ ...tdStyle, paddingLeft: 6, textAlign: 'left' }}>Всего</td>
                {points.map((point, idx) => {
                  const val = selectedModel === 'ALL' ? point.total : point[selectedModel];
                  return (
                    <td
                      key={idx}
                      style={{ ...clickableTdStyle, fontWeight: 700 }}
                      onClick={() => val > 0 && openVinsModal(point.startDate, point.endDate, 'total', selectedModel, point.label)}
                      onMouseEnter={(e) => { if (val > 0) e.currentTarget.style.backgroundColor = '#BFDBFE'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      {val !== null && val !== undefined ? val : ''}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </>
    );
  };

  /* ===================== Таблица по моделям ===================== */
  const renderModelTable = (points) => {
    if (!points.length) return null;
    const displayLabels = points.map(p => shortenLabel(p.label, p.type));

    return (
      <>
        <h4 style={tableHeaderStyle}>По моделям (все зашло в REPPS)</h4>
        <div style={tableWrapStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ ...thStyle, width: 60, paddingLeft: 6, textAlign: 'left' }}>Мод.</th>
                {points.map((point, idx) => (
                  <th key={idx} style={{ ...thStyle, backgroundColor: reppsTypeBgColors[point.type] }}>
                    {displayLabels[idx]}
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
                  <td style={{ ...tdStyle, paddingLeft: 6, textAlign: 'left', fontWeight: 600 }}>
                    {modelShortNames[modelKey] || modelKey}
                  </td>
                  {points.map((point, idx) => {
                    const val = modelKey === 'total' ? point.total : point[modelKey];
                    const modelParam = modelKey === 'total' ? 'ALL' : modelKey;
                    return (
                      <td
                        key={idx}
                        style={{
                          ...clickableTdStyle,
                          backgroundColor: reppsTypeBgColors[point.type],
                          color: val !== null && val !== undefined && val > 0 ? '#1F2937' : '#9CA3AF',
                          fontWeight: val > 0 ? 600 : 400,
                        }}
                        onClick={() => val > 0 && openVinsModal(point.startDate, point.endDate, 'total', modelParam, point.label)}
                        onMouseEnter={(e) => { if (val > 0) e.currentTarget.style.backgroundColor = '#BFDBFE'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = reppsTypeBgColors[point.type]; }}
                      >
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

  const categoryLabels = {
    total: 'всего зашло',
    no_paint: 'без дефектов окраски',
    paint_closed_only: 'дефекты окраски закрыты',
    paint_open: 'незакрытые дефекты окраски',
  };

  const showPostPs = modalMeta.category === 'no_paint';

  return (
    <div style={{ padding: '20px 30px 20px 16px', fontFamily: 'Inter, Segoe UI, Arial, sans-serif', maxWidth: 1500, margin: '0 auto' }}>
      <h1 style={{ color: '#111827', fontSize: 28, fontWeight: 800, marginBottom: 20 }}>REPPS Report</h1>

      <div style={subTabBarStyle}>
        <button
          style={subTabStyle(activeSubTab === 'repps')}
          onClick={() => setActiveSubTab('repps')}
        >
          Отчет REPPS
        </button>
        <button
          style={subTabStyle(activeSubTab === 'spot-repaint')}
          onClick={() => setActiveSubTab('spot-repaint')}
        >
          Отчет Spot-Перекрас
        </button>
      </div>

      {activeSubTab === 'spot-repaint' ? (
        <SpotRepaintReport />
      ) : (
        <>
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
                        style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#9CA3AF', color: '#FFF', cursor: 'pointer' }}
                      >✕</button>
                    )}
                  </div>
                </>
              )}

              <label style={{ fontSize: 14, color: '#4B5563', display: 'flex', alignItems: 'center', gap: 6 }}>
                Модель:
                <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} style={inputStyle}>
                  {availableModels.map(m => <option key={m} value={m}>{m === 'ALL' ? 'Все' : m}</option>)}
                </select>
              </label>

              {/* ИСПРАВЛЕННЫЙ ФИЛЬТР */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#4B5563', cursor: 'pointer', marginLeft: 12 }}>
                <input 
                  type="checkbox" 
                  checked={hideAssembly} 
                  onChange={e => setHideAssembly(e.target.checked)} 
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                REPPS без дефектов сборки
              </label>

              <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#4B5563', marginLeft: 'auto', flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, backgroundColor: stackColors.no_paint, borderRadius: 3, display: 'inline-block' }} />
                  Без PS
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, backgroundColor: stackColors.paint_closed_only, borderRadius: 3, display: 'inline-block' }} />
                  PS закрыты
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, backgroundColor: stackColors.paint_open, borderRadius: 3, display: 'inline-block' }} />
                  PS открыты
                </span>
              </div>
            </div>
          </div>

          {loading ? (
            <div style={cardStyle}>
              <p style={{ textAlign: 'center', color: '#6B7280', padding: 40 }}>Загрузка данных...</p>
            </div>
          ) : period === 'all' ? (
            <div style={cardStyle}>
              <h2 style={reportHeaderStyle}>Статус дефектов окраски у авто в REPPS</h2>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 2.3fr)',
                gap: 16,
                alignItems: 'start',
              }}>
                {renderSection('📅 3 месяца', groupedByType.months, '#0EA5E9')}
                {renderSection('📆 4 недели',  groupedByType.weeks,  '#14B8A6')}
                {renderSection('📊 14 дней',   groupedByType.days,   '#F59E0B')}
              </div>
            </div>
          ) : (
            <div style={cardStyle}>
              <h2 style={reportHeaderStyle}>Статус дефектов окраски у авто в REPPS</h2>
              {renderStackChart(chartData)}
              {renderCategoryTable(chartData)}
              <div style={dashDividerStyle} />
              {renderModelTable(chartData)}
            </div>
          )}

          {modalOpen && (
            <div
              style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(15,23,42,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 2000, padding: 20,
              }}
              onClick={closeModal}
            >
              <div
                style={{
                  backgroundColor: '#FFFFFF', borderRadius: 14, padding: 20,
                  width: '100%', maxWidth: 1400, maxHeight: '85vh',
                  display: 'flex', flexDirection: 'column',
                  boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111827' }}>
                      {modalMeta.label} · {categoryLabels[modalMeta.category] || modalMeta.category}
                      {modalMeta.model !== 'ALL' && ` · ${modalMeta.model}`}
                    </h3>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6B7280' }}>
                      Всего VIN: {modalVins.length}
                    </p>
                  </div>
                  <button
                    onClick={closeModal}
                    style={{ border: 'none', background: 'none', fontSize: 24, cursor: 'pointer', color: '#6B7280', lineHeight: 1 }}
                  >×</button>
                </div>

                {modalLoading ? (
                  <p style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Загрузка...</p>
                ) : modalVins.length === 0 ? (
                  <p style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Нет данных</p>
                ) : (
                  <div style={{ overflowY: 'auto', flex: 1, border: '1px solid #E5E7EB', borderRadius: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th style={modalThStyle}>VIN</th>
                          <th style={modalThStyle}>Модель</th>
                          <th style={modalThStyle}>Время REPPS</th>
                          <th style={modalThStyle}>Время PSOUT</th>
                          <th style={modalThStyle}>Дефекты окраски</th>
                          {showPostPs && (
                            <th style={modalThStyle}>Дефекты окраски после PS</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {modalVins.map((item, idx) => (
                          <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                            <td style={{ ...modalTdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{item.vin}</td>
                            <td style={modalTdStyle}>{item.model}</td>
                            <td style={{ ...modalTdStyle, fontSize: 12 }}>{formatDateTime(item.repps_time)}</td>
                            <td style={{ ...modalTdStyle, fontSize: 12, color: item.psout_time ? '#1F2937' : '#9CA3AF' }}>
                              {formatDateTime(item.psout_time)}
                            </td>
                            <td style={modalTdStyle}>
                              {item.defects && item.defects.length > 0 ? (
                                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                                  {item.defects.map((d, i) => (
                                    <li key={i} style={{
                                      color: d.is_open ? '#DC2626' : '#6B7280',
                                      fontWeight: d.is_open ? 600 : 400,
                                    }}>
                                      {d.part_name} · {d.problem_type}
                                      {d.grade ? ` · ${d.grade}` : ''}
                                      {' · '}<span style={{ fontStyle: 'italic' }}>{d.status || '—'}</span>
                                      {d.is_open && <span style={{ marginLeft: 4 }}>🔴</span>}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span style={{ color: '#9CA3AF', fontSize: 12 }}>Нет дефектов</span>
                              )}
                            </td>
                            {showPostPs && (
                              <td style={modalTdStyle}>
                                {item.post_ps_defects && item.post_ps_defects.length > 0 ? (
                                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                                    {item.post_ps_defects.map((d, i) => (
                                      <li key={i} style={{
                                        color: d.is_open ? '#DC2626' : '#6B7280',
                                        fontWeight: d.is_open ? 600 : 400,
                                      }}>
                                        {d.part_name} · {d.problem_type}
                                        {d.grade ? ` · ${d.grade}` : ''}
                                        {' · '}<span style={{ fontStyle: 'italic' }}>{d.status || '—'}</span>
                                        {d.is_open && <span style={{ marginLeft: 4 }}>🔴</span>}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span style={{ color: '#9CA3AF', fontSize: 12 }}>—</span>
                                )}
                              </td>
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
        </>
      )}
    </div>
  );
}