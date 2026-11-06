import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ReferenceLine, Label, ResponsiveContainer, Cell, LabelList
} from 'recharts';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const API_BASE = '';

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

const topThStyle = {
  padding: '10px 12px',
  textAlign: 'center',
  fontWeight: 600,
  color: '#374151',
  borderBottom: '2px solid #E5E7EB',
  background: '#F9FAFB',
  whiteSpace: 'nowrap',
};

const topTdStyle = {
  padding: '8px 12px',
  textAlign: 'center',
  borderBottom: '1px solid #F0F0F5',
  color: '#1F2937',
};

const typeColors = {
  year: '#065F46',
  month: '#10B981',
  week: '#6EE7B7',
  day: '#84CC16',
};

const typeBgColors = {
  year: 'rgba(6, 95, 70, 0.1)',
  month: 'rgba(16, 185, 129, 0.1)',
  week: 'rgba(110, 231, 183, 0.1)',
  day: 'rgba(132, 204, 22, 0.1)',
};

const modelShortNames = {
  'ESTEO MX': 'MX',
  'JELAND J6': 'J6',
  'JELAND J7': 'J7',
  'TENET A8': 'A8',
  'JELAND J8': 'J8',
};

const allModelKeys = Object.keys(modelShortNames);

const getDateDaysAgo = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
};

const getToday = () => {
  return new Date().toISOString().split('T')[0];
};

export default function DrrCp7HistoryPage() {
  const [filter, setFilter] = useState('all');
  const [period, setPeriod] = useState('all');
  const [count, setCount] = useState(3);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [abData, setAbData] = useState([]);
  const [cData, setCData] = useState([]);
  const [abLoading, setAbLoading] = useState(false);
  const [cLoading, setCLoading] = useState(false);

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

  // Вычисляем диапазон дат для топов на основе периода
  const getTopDateRange = () => {
    const today = new Date();
    const format = (d) => d.toISOString().split('T')[0];
    if (period !== 'all') {
      if (fromDate && toDate) {
        return { dateFrom: fromDate, dateTo: toDate };
      }
      const countNum = parseInt(count, 10) || 1;
      if (period === 'day') {
        const start = new Date();
        start.setDate(today.getDate() - (countNum - 1));
        return { dateFrom: format(start), dateTo: format(today) };
      } else if (period === 'week') {
        const day = today.getDay();
        const mondayOffset = day === 0 ? -6 : 1 - day;
        const currentMonday = new Date(today);
        currentMonday.setDate(today.getDate() + mondayOffset);
        const start = new Date(currentMonday);
        start.setDate(currentMonday.getDate() - 7 * (countNum - 1));
        const end = new Date(currentMonday);
        end.setDate(currentMonday.getDate() + 6);
        return { dateFrom: format(start), dateTo: format(end) };
      } else if (period === 'month') {
        const start = new Date(today.getFullYear(), today.getMonth() - (countNum - 1), 1);
        const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        return { dateFrom: format(start), dateTo: format(end) };
      } else if (period === 'year') {
        const start = new Date(today.getFullYear() - (countNum - 1), 0, 1);
        const end = new Date(today.getFullYear(), 11, 31);
        return { dateFrom: format(start), dateTo: format(end) };
      }
    }
    // period === 'all' или fallback
    const start = new Date();
    start.setDate(today.getDate() - 13);
    return { dateFrom: format(start), dateTo: format(today) };
  };

  const loadHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ filter, period });
      if (period !== 'all' && count) params.append('count', count);
      if (period !== 'all' && fromDate && toDate) {
        params.append('fromDate', fromDate);
        params.append('toDate', toDate);
      }
      const res = await fetch(`${API_BASE}/api/drr-cp7-history?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки данных');
      const json = await res.json();
      setData(json.periods || []);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadAbTop = async (dateFrom, dateTo) => {
    setAbLoading(true);
    try {
      const params = new URLSearchParams({
        dateFrom,
        dateTo,
        grades: 'A,B,A1,B1'
      });
      const res = await fetch(`${API_BASE}/api/drr-cp7-history-top-mpp?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки A/B топа');
      const json = await res.json();
      setAbData(json);
    } catch (err) {
      console.error(err);
    } finally {
      setAbLoading(false);
    }
  };

  const loadCTop = async (dateFrom, dateTo) => {
    setCLoading(true);
    try {
      const params = new URLSearchParams({
        dateFrom,
        dateTo,
        grades: 'C'
      });
      const res = await fetch(`${API_BASE}/api/drr-cp7-history-top-mpp?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки C топа');
      const json = await res.json();
      setCData(json);
    } catch (err) {
      console.error(err);
    } finally {
      setCLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
    const { dateFrom, dateTo } = getTopDateRange();
    loadAbTop(dateFrom, dateTo);
    loadCTop(dateFrom, dateTo);
  }, [filter, period, count, fromDate, toDate]);

  const chartData = useMemo(() => {
    return data.map(d => ({
      label: d.label,
      type: d.type,
      drr: d.drr,
    }));
  }, [data]);

  const tableData = useMemo(() => {
    const rows = allModelKeys.map(key => ({
      model: modelShortNames[key],
      fullModel: key,
      cells: data.map(p => {
        const modelData = p.models && p.models[key];
        return modelData ? modelData.drr : '';
      }),
    }));
    const totalRow = {
      model: 'Total',
      fullModel: 'Total',
      cells: data.map(p => p.drr),
    };
    return [...rows, totalRow];
  }, [data]);

  const exportToExcel = () => {
    const exportData = tableData.map(row => {
      const rowObj = { 'Модель': row.model };
      data.forEach((p, idx) => {
        rowObj[p.label] = row.cells[idx] !== '' ? `${row.cells[idx]}%` : '';
      });
      return rowObj;
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DRR CP7 History');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `drr_cp7_history_${period}.xlsx`);
  };

  return (
    <div style={{ padding: '20px 30px 20px 16px', fontFamily: 'Inter, Segoe UI, Arial, sans-serif', maxWidth: 1300, margin: '0 auto' }}>
      <h1 style={{ color: '#111827', fontSize: 28, fontWeight: 800, marginBottom: 30 }}>DRR CP7 History</h1>

      {/* Фильтры */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 30, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setFilter('all')} style={tabStyle(filter === 'all')}>Все</button>
        <button onClick={() => setFilter('cp7')} style={tabStyle(filter === 'cp7')}>CP7</button>
        <button onClick={() => setFilter('pip')} style={tabStyle(filter === 'pip')}>PIP</button>

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
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                style={inputStyle}
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: '#4B5563' }}>По:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                style={inputStyle}
              />
              {(fromDate || toDate) && (
                <button
                  onClick={() => { setFromDate(''); setToDate(''); }}
                  style={{ ...buttonStyle, background: '#9CA3AF', padding: '4px 10px' }}
                >
                  ✕
                </button>
              )}
            </div>
          </>
        )}

        <button onClick={loadHistory} style={buttonStyle}>🔄 Обновить</button>
        <button onClick={exportToExcel} style={{ ...buttonStyle, background: '#059669' }}>📥 Экспорт</button>
      </div>

      {/* Карточка с графиком и таблицей */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1F2937', marginBottom: 20 }}>Динамика DRR CP7</h2>

        {loading ? (
          <p style={{ textAlign: 'center', color: '#6B7280', padding: 20 }}>Загрузка данных...</p>
        ) : error ? (
          <p style={{ textAlign: 'center', color: '#DC2626', padding: 20 }}>❌ {error}</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={chartData} margin={{ top: 20, right: 60, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                <ReferenceLine y={80} stroke="#EF4444" strokeDasharray="5 5">
                  <Label value="80%" position="right" style={{ fill: '#EF4444', fontSize: 14, fontWeight: 700 }} />
                </ReferenceLine>
                <Bar dataKey="drr" barSize={25} radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={typeColors[entry.type] || '#10B981'} />
                  ))}
                  <LabelList dataKey="drr" position="top" formatter={(v) => `${v}%`} style={{ fill: '#1F2937', fontSize: 11, fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div style={{ overflowX: 'auto', marginTop: 12, paddingRight: 60 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: '8%', paddingLeft: 12 }}>Модель</th>
                    {data.map((p, idx) => (
                      <th key={idx} style={{ ...thStyle, backgroundColor: typeBgColors[p.type] || '#F9FAFB' }}>
                        {p.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, rowIdx) => (
                    <tr key={rowIdx} style={{ backgroundColor: rowIdx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                      <td style={{ ...tdStyle, fontWeight: 700, paddingLeft: 12 }}>{row.model}</td>
                      {data.map((p, colIdx) => (
                        <td key={colIdx} style={{ ...tdStyle, backgroundColor: typeBgColors[p.type] || 'transparent' }}>
                          {row.cells[colIdx] !== '' ? `${row.cells[colIdx]}%` : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Две таблицы с топами дефектов */}
      <div style={{ display: 'flex', gap: 20, marginTop: 20 }}>
        {/* Топ A/B */}
        <div style={{ ...cardStyle, flex: 1, marginBottom: 30 }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 700, color: '#1F2937' }}>Топ A/B дефектов</h3>
          {abLoading ? (
            <p style={{ color: '#6B7280', textAlign: 'center', padding: 10 }}>Загрузка...</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={topThStyle}>Дефекты</th>
                  <th style={topThStyle}>Количество</th>
                </tr>
              </thead>
              <tbody>
                {abData.map((item, idx) => (
                  <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#F9FAFB' : 'white' }}>
                    <td style={topTdStyle}>{item.defect}</td>
                    <td style={topTdStyle}>{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Топ C */}
        <div style={{ ...cardStyle, flex: 1, marginBottom: 30 }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 700, color: '#1F2937' }}>Топ C дефектов</h3>
          {cLoading ? (
            <p style={{ color: '#6B7280', textAlign: 'center', padding: 10 }}>Загрузка...</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={topThStyle}>Дефекты</th>
                  <th style={topThStyle}>Количество</th>
                </tr>
              </thead>
              <tbody>
                {cData.map((item, idx) => (
                  <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#F9FAFB' : 'white' }}>
                    <td style={topTdStyle}>{item.defect}</td>
                    <td style={topTdStyle}>{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}