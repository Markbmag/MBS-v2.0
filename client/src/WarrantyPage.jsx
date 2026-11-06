import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  ResponsiveContainer, Line, ReferenceLine, LabelList, Label
} from 'recharts';

const API_BASE = '';

// ====== СТИЛИ ======
const cardStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  padding: 24,
  marginBottom: 30,
  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
  border: '1px solid #F0F0F5',
};

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
  boxShadow: '0 2px 6px rgba(37,99,235,0.3)',
  transition: 'background 0.2s, transform 0.1s',
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

const subTabStyle = (active) => ({
  padding: '8px 20px',
  borderRadius: 8,
  border: 'none',
  fontWeight: 600,
  fontSize: 13,
  background: active ? '#3B82F6' : '#F3F4F6',
  color: active ? '#FFFFFF' : '#6B7280',
  cursor: 'pointer',
  boxShadow: active ? '0 2px 8px rgba(59,130,246,0.25)' : 'none',
  transition: 'all 0.2s',
  whiteSpace: 'nowrap',
});

// ====== КОНСТАНТЫ ======
const FIELDS = [
  'vin_id', 'sold_cars_qty', 'unique_vin_by_qr', 'brand', 'model',
  'production_date', 'sold_date', 'claim_id', 'document_number',
  'warranty_start_date', 'customer_complain_date', 'claims_qty',
  'diagnostic_result', 'main_part', 'main_part_name', 'mis_0', 'mis_3',
  'qty_sell', 'delta', 'mis_0_count', 'mis_3_count', 'category',
  'total_amount_paid_dealers_rur'
];

const excelDateToString = (val) => {
  if (val === undefined || val === null || val === '') return '';
  if (typeof val === 'number') {
    const date = new Date((val - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
    return val;
  }
  if (typeof val === 'string') {
    let d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    const parts = val.split('.');
    if (parts.length === 3) {
      d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    return val;
  }
  return val;
};

const isDateColumn = (header) => {
  const lower = String(header).toLowerCase();
  const numericKeywords = ['qty', 'count', 'quantity', 'amount', 'cost', 'price', 'total', 'number'];
  if (numericKeywords.some(keyword => lower.includes(keyword))) return false;
  const dateKeywords = ['date', 'дата', 'warranty start', 'complain', 'production', 'sold'];
  return dateKeywords.some(keyword => lower.includes(keyword));
};

const ALL_MODELS = ['J6', 'J7', 'J8', 'MX', 'A8'];

const CustomTick = ({ x, y, payload }) => {
  const [model, month, year] = payload.value.split('-');
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="middle" fill="#000" fontSize={10} fontWeight="bold">{model}</text>
      <text x={0} y={18} dy={8} textAnchor="middle" fill="#000" fontSize={10}>{month}</text>
      <text x={0} y={40} dy={8} textAnchor="middle" fill="#666" fontSize={10}>{year}</text>
    </g>
  );
};

const renderBlueLabel = (props) => {
  const { x, y, width, height, value } = props;
  if (!value || value === 0) return null;
  return (
    <text x={x + width / 2} y={y + height / 2} dy={4} textAnchor="middle" fill="#000000" fontWeight="bold" fontSize={14}>
      {value}
    </text>
  );
};

const formatNumber = (val) => {
  if (val === null || val === undefined) return '';
  const num = Number(val);
  if (isNaN(num)) return val;
  if (num % 1 === 0) return num.toString();
  return num.toFixed(1);
};

// Улучшенный рендер для числовых меток на линиях
const renderLineLabel = (props) => {
  const { x, y, value, fill } = props;
  if (value === null || value === undefined) return null;
  
  // Белый фон для читаемости
  return (
    <g>
      <rect 
        x={x - 20} 
        y={y - 22} 
        width={40} 
        height={18} 
        rx={4} 
        fill="white" 
        stroke={fill} 
        strokeWidth={1}
        opacity={0.95}
      />
      <text 
        x={x} 
        y={y - 8} 
        textAnchor="middle" 
        fill={fill} 
        fontSize={13} 
        fontWeight="bold"
      >
        {formatNumber(value)}
      </text>
    </g>
  );
};

const formatUploadTime = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
};

export default function WarrantyPage() {
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const [activeTab, setActiveTab] = useState('upload');
  const [activeSubTab, setActiveSubTab] = useState('total'); // 'total' | 'model' | 'sales' | 'categories'

  const [fileData, setFileData] = useState([]);
  const [preview, setPreview] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [claims, setClaims] = useState([]);

  const [selectedModels1, setSelectedModels1] = useState(ALL_MODELS);
  const [showModelFilter1, setShowModelFilter1] = useState(false);
  const [data1Raw, setData1Raw] = useState([]);
  const [loading1, setLoading1] = useState(false);

  const [selectedModels2, setSelectedModels2] = useState(ALL_MODELS);
  const [showModelFilter2, setShowModelFilter2] = useState(false);
  const [data2Raw, setData2Raw] = useState([]);
  const [loading2, setLoading2] = useState(false);

  const [selectedModels3, setSelectedModels3] = useState(ALL_MODELS);
  const [showModelFilter3, setShowModelFilter3] = useState(false);
  const [data3Raw, setData3Raw] = useState([]);
  const [loading3, setLoading3] = useState(false);

  const [categoriesData, setCategoriesData] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(false);

  const [uploadTimes, setUploadTimes] = useState([]);
  const [selectedUploadTime, setSelectedUploadTime] = useState('');

  const handlePasswordSubmit = async (e) => {
    if (e) e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/warranty/check-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (json.success) {
        setAuthenticated(true);
        setPasswordError('');
      } else {
        setPasswordError('Неверный пароль');
      }
    } catch (err) {
      setPasswordError('Ошибка соединения');
    }
  };

  const fetchClaims = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/warranty/claims`);
      const json = await res.json();
      setClaims(Array.isArray(json) ? json : []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (json.length < 2) { alert('Файл пуст'); return; }
      const headers = json[0];
      const rows = json.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
        return obj;
      });
      setFileData(rows);
      setPreview(rows.slice(0, 10));
    };
    reader.readAsArrayBuffer(file);
  };

  const handleUpload = async () => {
    if (!fileData.length) return;
    setUploading(true);
    setUploadStatus(null);
    
    try {
      const batchSize = 10000;
      let totalInserted = 0;
      
      for (let i = 0; i < fileData.length; i += batchSize) {
        const batch = fileData.slice(i, i + batchSize);
        
        const res = await fetch(`${API_BASE}/api/warranty/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: batch }),
        });
        
        const json = await res.json();
        if (json.success) {
          totalInserted += json.inserted;
        } else {
          throw new Error(json.error || 'Ошибка загрузки батча');
        }
      }
      
      setUploadStatus({ type: 'success', message: `Загружено ${totalInserted} записей` });
      setFileData([]);
      setPreview([]);
      fetchClaims();
      loadUploadTimes();
    } catch (err) {
      setUploadStatus({ type: 'error', message: `Ошибка загрузки: ${err.message}` });
    } finally {
      setUploading(false);
    }
  };

  const loadUploadTimes = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/warranty/upload-times`);
      if (!res.ok) {
        setUploadTimes([]);
        return;
      }
      const data = await res.json();
      if (Array.isArray(data)) {
        setUploadTimes(data);
        if (data.length > 0 && !selectedUploadTime) {
          setSelectedUploadTime(data[0]);
        }
      } else {
        setUploadTimes([]);
      }
    } catch (err) {
      setUploadTimes([]);
    }
  };

  useEffect(() => {
    if (authenticated && activeTab === 'analytics') {
      loadUploadTimes();
    }
  }, [authenticated, activeTab]);

  const loadAnalytics1 = async (uploadedAt) => {
    setLoading1(true);
    try {
      const params = new URLSearchParams();
      if (uploadedAt) params.append('uploadedAt', uploadedAt);
      const res = await fetch(`${API_BASE}/api/warranty/analytics?${params.toString()}`);
      const json = await res.json();
      setData1Raw(Array.isArray(json) ? json : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading1(false);
    }
  };

  const loadAnalytics2 = async (uploadedAt) => {
    setLoading2(true);
    try {
      const params = new URLSearchParams();
      if (uploadedAt) params.append('uploadedAt', uploadedAt);
      const res = await fetch(`${API_BASE}/api/warranty/analytics-by-model?${params.toString()}`);
      const json = await res.json();
      setData2Raw(Array.isArray(json) ? json : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading2(false);
    }
  };

  const loadAnalytics3 = async (uploadedAt) => {
    setLoading3(true);
    try {
      const params = new URLSearchParams();
      if (uploadedAt) params.append('uploadedAt', uploadedAt);
      const res = await fetch(`${API_BASE}/api/warranty/analytics-by-sales-date?${params.toString()}`);
      const json = await res.json();
      setData3Raw(Array.isArray(json) ? json : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading3(false);
    }
  };

  const loadCategories = async (uploadedAt) => {
    setLoadingCategories(true);
    try {
      const params = new URLSearchParams();
      if (uploadedAt) params.append('uploadedAt', uploadedAt);
      const res = await fetch(`${API_BASE}/api/warranty/categories-summary?${params.toString()}`);
      const json = await res.json();
      setCategoriesData(Array.isArray(json) ? json : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingCategories(false);
    }
  };

  // Загрузка данных при выборе времени загрузки
  useEffect(() => {
    if (selectedUploadTime && activeTab === 'analytics') {
      // Загружаем только активную подвкладку
      if (activeSubTab === 'total') {
        loadAnalytics1(selectedUploadTime);
      } else if (activeSubTab === 'model') {
        loadAnalytics2(selectedUploadTime);
      } else if (activeSubTab === 'sales') {
        loadAnalytics3(selectedUploadTime);
      } else if (activeSubTab === 'categories') {
        loadCategories(selectedUploadTime);
      }
    }
  }, [selectedUploadTime, activeSubTab, activeTab]);

  const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  const chartData1 = useMemo(() => {
    const filtered = data1Raw.filter(d => selectedModels1.includes(d.model));
    const grouped = {};
    filtered.forEach(d => {
      if (!grouped[d.month]) {
        grouped[d.month] = { month: d.month, qty_sell: 0, mis_0_count: 0, mis_3_count: 0 };
      }
      grouped[d.month].qty_sell += Number(d.qty_sell) || 0;
      grouped[d.month].mis_0_count += Number(d.mis_0) || 0;
      grouped[d.month].mis_3_count += Number(d.mis_3) || 0;
    });
    return Object.values(grouped)
      .map(d => ({
        month: d.month,
        qty_sell: d.qty_sell,
        mis_0: d.qty_sell > 0 ? ((d.mis_0_count / d.qty_sell) * 1000).toFixed(1) : 0,
        mis_3: d.qty_sell > 0 ? ((d.mis_3_count / d.qty_sell) * 1000).toFixed(1) : 0,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [data1Raw, selectedModels1]);

  const chartData2 = useMemo(() => {
    const filtered = data2Raw.filter(d => selectedModels2.includes(d.model));
    return filtered.map(d => {
      const [year, monthNum] = d.month.split('-');
      const month = monthNames[parseInt(monthNum, 10) - 1] || monthNum;
      return {
        id: `${d.model}-${month}-${year}`,
        model: d.model,
        month,
        year: parseInt(year, 10),
        sold: d.qty_sell,
        repairs: d.mis_3_count,
      };
    });
  }, [data2Raw, selectedModels2]);

  const chartData3 = useMemo(() => {
    const filtered = data3Raw.filter(d => selectedModels3.includes(d.model));
    const grouped = {};
    filtered.forEach(d => {
      if (!grouped[d.month]) {
        grouped[d.month] = { month: d.month, qty: 0, mis0Count: 0, mis3Count: 0 };
      }
      grouped[d.month].qty += Number(d.qty_sell) || 0;
      grouped[d.month].mis0Count += Number(d.mis_0_count) || 0;
      grouped[d.month].mis3Count += Number(d.mis_3_count) || 0;
    });
    return Object.values(grouped)
      .map(d => ({
        ...d,
        mis0per1000: d.qty > 0 ? (d.mis0Count / d.qty) * 1000 : 0,
        mis3per1000: d.qty > 0 ? (d.mis3Count / d.qty) * 1000 : 0,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [data3Raw, selectedModels3]);

  const handleModelToggle1 = (model) => {
    setSelectedModels1(prev => prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]);
  };
  const handleModelToggle2 = (model) => {
    setSelectedModels2(prev => prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]);
  };
  const handleModelToggle3 = (model) => {
    setSelectedModels3(prev => prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]);
  };

  if (!authenticated) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#E5E7EB', margin: 0, padding: 0 }}>
        <div style={{ ...cardStyle, width: 400 }}>
          <h2 style={{ marginBottom: 20, textAlign: 'center' }}>🔐 Доступ к Warranty</h2>
          <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input type="password" placeholder="Введите пароль" value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
            <button type="submit" style={{ ...buttonStyle, width: '100%', justifyContent: 'center', boxSizing: 'border-box', padding: '10px 0' }}>
              Войти
            </button>
          </form>
          <p style={{ color: '#DC2626', marginTop: 12, textAlign: 'center', minHeight: 20 }}>{passwordError || ' '}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 30, fontFamily: 'Inter, Segoe UI, Arial, sans-serif', maxWidth: 1300, margin: '0 auto' }}>
      <h1 style={{ color: '#111827', fontSize: 28, fontWeight: 800, marginBottom: 30 }}>🛡️ Warranty</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 30 }}>
        <button onClick={() => setActiveTab('upload')} style={tabStyle(activeTab === 'upload')}>
          Загрузка данных
        </button>
        <button onClick={() => setActiveTab('analytics')} style={tabStyle(activeTab === 'analytics')}>
          Аналитика
        </button>
      </div>

      {activeTab === 'upload' && (
        <>
          <div style={cardStyle}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Загрузка Excel-файла</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <label style={{ ...buttonStyle, background: '#10B981', boxShadow: '0 2px 6px rgba(16,185,129,0.3)', cursor: 'pointer' }}>
                📁 Выбрать файл
                <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>
              {preview.length > 0 && (
                <>
                  <span style={{ fontSize: 14, color: '#4B5563' }}>Выбрано строк: {fileData.length}</span>
                  <button onClick={handleUpload} disabled={uploading}
                    style={{ ...buttonStyle, background: '#2563EB', opacity: uploading ? 0.6 : 1, pointerEvents: uploading ? 'none' : 'auto' }}>
                    {uploading ? '⏳ Загрузка...' : '📤 Загрузить в базу'}
                  </button>
                </>
              )}
            </div>

            {uploadStatus && (
              <div style={{
                padding: '10px 16px', borderRadius: 8, marginBottom: 16,
                background: uploadStatus.type === 'success' ? '#ECFDF5' : '#FEF2F2',
                color: uploadStatus.type === 'success' ? '#065F46' : '#991B1B',
                fontSize: 14, fontWeight: 500
              }}>
                {uploadStatus.message}
              </div>
            )}

            {preview.length > 0 && (
              <div>
                <h4 style={{ marginBottom: 8, color: '#374151' }}>Предпросмотр (первые 10 строк)</h4>
                <div style={{ overflowX: 'auto', maxHeight: 300, borderRadius: 8, border: '1px solid #E5E7EB' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ backgroundColor: '#F3F4F6' }}>
                        {Object.keys(preview[0]).map(h => (
                          <th key={h} style={{ padding: '6px 8px', borderBottom: '2px solid #E5E7EB', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, idx) => (
                        <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                          {Object.keys(row).map(h => {
                            const val = row[h];
                            if (isDateColumn(h)) {
                              return <td key={h} style={{ padding: '6px 8px', borderBottom: '1px solid #F0F0F5', whiteSpace: 'nowrap' }}>{excelDateToString(val)}</td>;
                            }
                            return <td key={h} style={{ padding: '6px 8px', borderBottom: '1px solid #F0F0F5', whiteSpace: 'nowrap' }}>{val}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Ранее загруженные записи</h2>
            {claims.length > 0 ? (
              <div style={{ overflowX: 'auto', maxHeight: 500, borderRadius: 8, border: '1px solid #E5E7EB' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ backgroundColor: '#F3F4F6' }}>
                      {FIELDS.map(h => <th key={h} style={{ padding: '6px 8px', borderBottom: '2px solid #E5E7EB', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((row, idx) => (
                      <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                        {FIELDS.map(h => {
                          const val = row[h];
                          if (['production_date','sold_date','warranty_start_date','customer_complain_date'].includes(h)) {
                            return <td key={h} style={{ padding: '6px 8px', borderBottom: '1px solid #F0F0F5', whiteSpace: 'nowrap' }}>
                              {val && val !== '0000-00-00' ? new Date(val).toISOString().split('T')[0] : ''}
                            </td>;
                          }
                          return <td key={h} style={{ padding: '6px 8px', borderBottom: '1px solid #F0F0F5', whiteSpace: 'nowrap' }}>
                            {val !== null && val !== undefined ? String(val) : ''}
                          </td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: '#6B7280', textAlign: 'center', padding: 20 }}>Нет загруженных данных</p>
            )}
          </div>
        </>
      )}

      {activeTab === 'analytics' && (
        <>
          <div style={{ ...cardStyle, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
                Время загрузки данных:
              </label>
              <select
                value={selectedUploadTime}
                onChange={(e) => setSelectedUploadTime(e.target.value)}
                style={{ ...inputStyle, minWidth: 200 }}
              >
                {(Array.isArray(uploadTimes) ? uploadTimes : []).map(timestamp => (
                  <option key={timestamp} value={timestamp}>
                    {formatUploadTime(timestamp)}
                  </option>
                ))}
              </select>
              {(!Array.isArray(uploadTimes) || uploadTimes.length === 0) && (
                <span style={{ color: '#9CA3AF', fontSize: 14 }}>Нет данных о загрузках</span>
              )}
            </div>
          </div>

          {/* Подвкладки аналитики */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            <button onClick={() => setActiveSubTab('total')} style={subTabStyle(activeSubTab === 'total')}>
              📊 Total (Prod Related)
            </button>
            <button onClick={() => setActiveSubTab('model')} style={subTabStyle(activeSubTab === 'model')}>
              📊 Model Based (Prod Related)
            </button>
            <button onClick={() => setActiveSubTab('sales')} style={subTabStyle(activeSubTab === 'sales')}>
              📊 0 MIS/3MIS by sales date
            </button>
            <button onClick={() => setActiveSubTab('categories')} style={subTabStyle(activeSubTab === 'categories')}>
              🏆 Топ категорий
            </button>
          </div>

          {/* Total (Prod Related) */}
          {activeSubTab === 'total' && (
            <div style={cardStyle}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1F2937', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ background: '#EEF2FF', padding: '4px 12px', borderRadius: 6, color: '#2563EB', fontSize: 16 }}>📊</span>
                Total (Prod Related)
              </h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 20 }}>
                <button onClick={() => setShowModelFilter1(!showModelFilter1)} style={buttonStyle}>
                  {showModelFilter1 ? 'Скрыть фильтр' : 'Модели'}
                </button>
              </div>

              {showModelFilter1 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {ALL_MODELS.map(model => (
                    <label key={model} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={selectedModels1.includes(model)} onChange={() => handleModelToggle1(model)} />
                      {model}
                    </label>
                  ))}
                </div>
              )}

              {chartData1.length > 0 ? (
                <ResponsiveContainer width="100%" height={500}>
                  <ComposedChart data={chartData1} margin={{ top: 40, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="month" tick={{ fontSize: 13, fontWeight: 600 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 13 }} label={{ value: 'Qty Sold', angle: -90, position: 'insideLeft', fontSize: 14, fontWeight: 'bold' }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 13 }} label={{ value: 'MIS per 1000', angle: 90, position: 'insideRight', fontSize: 14, fontWeight: 'bold' }} />
                    <Legend wrapperStyle={{ fontSize: 14, fontWeight: 600 }} />
                    <Bar yAxisId="left" dataKey="qty_sell" fill="#3B82F6" name="Qty Sold" barSize={30}>
                      <LabelList dataKey="qty_sell" position="top" style={{ fill: '#1F2937', fontSize: 14, fontWeight: 'bold' }} />
                    </Bar>
                    <Line yAxisId="right" type="monotone" dataKey="mis_0" stroke="#F59E0B" strokeWidth={4} name="0mis per 1000" dot={{ r: 8, fill: '#F59E0B', stroke: '#FFFFFF', strokeWidth: 2 }}>
                      <LabelList dataKey="mis_0" content={renderLineLabel} fill="#F59E0B" />
                    </Line>
                    <Line yAxisId="right" type="monotone" dataKey="mis_3" stroke="#10B981" strokeWidth={4} name="3mis per 1000" dot={{ r: 8, fill: '#10B981', stroke: '#FFFFFF', strokeWidth: 2 }}>
                      <LabelList dataKey="mis_3" content={renderLineLabel} fill="#10B981" />
                    </Line>
                    <ReferenceLine yAxisId="right" y={5} stroke="#EF4444" strokeWidth={3} strokeDasharray="5 5">
                      <Label value="0mis Target (5)" position="right" style={{ fill: '#EF4444', fontSize: 11, fontWeight: 'bold' }} />
                    </ReferenceLine>
                    <ReferenceLine yAxisId="right" y={25} stroke="#8B5CF6" strokeWidth={3} strokeDasharray="5 5">
                      <Label value="3mis Target (25)" position="right" style={{ fill: '#8B5CF6', fontSize: 11, fontWeight: 'bold' }} />
                    </ReferenceLine>
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ color: '#6B7280', textAlign: 'center', padding: 40 }}>Нет данных для отображения</p>
              )}
            </div>
          )}

          {/* Model Based (Prod Related) */}
          {activeSubTab === 'model' && (
            <div style={cardStyle}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1F2937', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ background: '#EEF2FF', padding: '4px 12px', borderRadius: 6, color: '#2563EB', fontSize: 16 }}>📊</span>
                Model Based (Prod Related)
              </h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 20 }}>
                <button onClick={() => setShowModelFilter2(!showModelFilter2)} style={buttonStyle}>
                  {showModelFilter2 ? 'Скрыть фильтр' : 'Модели'}
                </button>
              </div>

              {showModelFilter2 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {ALL_MODELS.map(model => (
                    <label key={model} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={selectedModels2.includes(model)} onChange={() => handleModelToggle2(model)} />
                      {model}
                    </label>
                  ))}
                </div>
              )}

              {chartData2.length > 0 ? (
                <div style={{ width: '100%', height: 600, backgroundColor: '#fff', fontFamily: 'Arial, sans-serif' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData2} margin={{ top: 40, right: 20, bottom: 60, left: 10 }}>
                      <CartesianGrid stroke="#d9d9d9" vertical={true} horizontal={true} />
                      <YAxis yAxisId="left" domain={[0, 'auto']} tickCount={9}
                        tick={{ fill: '#000', fontSize: 14, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} tickCount={9}
                        tick={{ fill: '#000', fontSize: 14, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                      <XAxis type="category" dataKey="id" tick={CustomTick}
                        axisLine={{ stroke: '#ccc' }} tickLine={false} interval={0} height={60} />
                      <Legend verticalAlign="bottom" align="center" iconType="square" iconSize={14}
                        wrapperStyle={{ padding: '10px 0', fontSize: 14, fontWeight: 'bold' }}
                        payload={[
                          { value: '3mis Repairs', type: 'square', color: '#ED7D31' },
                          { value: 'qty Sold by Prod', type: 'square', color: '#4472C4' },
                        ]} />
                      <Bar yAxisId="left" dataKey="sold" fill="#4472C4" barSize={24} name="qty Sold by Prod" stackId="a">
                        <LabelList content={renderBlueLabel} />
                      </Bar>
                      <Bar yAxisId="left" dataKey="repairs" fill="#ED7D31" barSize={24} name="3mis Repairs" stackId="a">
                        <LabelList dataKey="repairs" position="top" style={{ fontSize: 16, fill: '#FFC000', fontWeight: 'bold' }} />
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p style={{ color: '#6B7280', textAlign: 'center', padding: 40 }}>Нет данных для отображения</p>
              )}
            </div>
          )}

          {/* 0 MIS/3MIS by sales date */}
          {activeSubTab === 'sales' && (
            <div style={cardStyle}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1F2937', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ background: '#EEF2FF', padding: '4px 12px', borderRadius: 6, color: '#2563EB', fontSize: 16 }}>📊</span>
                0 MIS/3MIS by sales date
              </h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 20 }}>
                <button onClick={() => setShowModelFilter3(!showModelFilter3)} style={buttonStyle}>
                  {showModelFilter3 ? 'Скрыть фильтр' : 'Модели'}
                </button>
              </div>
              {showModelFilter3 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {ALL_MODELS.map(model => (
                    <label key={model} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={selectedModels3.includes(model)} onChange={() => handleModelToggle3(model)} />
                      {model}
                    </label>
                  ))}
                </div>
              )}

              {chartData3.length > 0 ? (
                <div style={{ width: '100%', backgroundColor: '#fff', fontFamily: 'Arial, sans-serif' }}>
                  <div style={{ width: '100%', height: 600, marginBottom: 100 }}>
                    <h3 style={{ color: '#333', fontSize: 18, marginLeft: 10, fontWeight: 'bold' }}>0 MIS/3MIS per 1000 by sales date</h3>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData3} margin={{ top: 40, right: 20, bottom: 80, left: 0 }}>
                        <CartesianGrid stroke="#ddd" vertical={false} horizontal={true} />
                        <YAxis yAxisId="left" domain={[0, 'auto']} tick={{ fill: '#666', fontSize: 14, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} tick={{ fill: '#666', fontSize: 14, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                        <XAxis dataKey="month" axisLine={{ stroke: '#ccc' }} tickLine={false} tick={{ fill: '#333', fontSize: 13, fontWeight: 'bold' }} />
                        <Legend verticalAlign="bottom" align="center" iconType="rect" iconSize={14} wrapperStyle={{ fontSize: 14, color: '#555', paddingTop: 20, fontWeight: 'bold' }}
                          payload={[
                            { value: 'qty Sold', type: 'rect', color: '#BCD0EF' },
                            { value: '0mis per 1000', type: 'line', color: '#F48F45' },
                            { value: '3mis per 1000', type: 'line', color: '#A9A9A9' },
                          ]} />
                        <ReferenceLine yAxisId="right" y={5} stroke="#FF0000" strokeDasharray="3 3" strokeWidth={2} />
                        <ReferenceLine yAxisId="right" y={25} stroke="#000000" strokeDasharray="3 3" strokeWidth={2} />
                        <Bar yAxisId="left" dataKey="qty" fill="#BCD0EF" barSize={40} name="qty Sold">
                          <LabelList dataKey="qty" position="top" style={{ fill: '#3464A4', fontSize: 14, fontWeight: 'bold' }} formatter={formatNumber} />
                        </Bar>
                        <Line yAxisId="right" type="linear" dataKey="mis0per1000" stroke="#F48F45" strokeWidth={4} dot={{ r: 8, fill: '#F48F45', stroke: '#FFFFFF', strokeWidth: 2 }} name="0mis per 1000">
                          <LabelList dataKey="mis0per1000" content={renderLineLabel} fill="#F48F45" />
                        </Line>
                        <Line yAxisId="right" type="linear" dataKey="mis3per1000" stroke="#A9A9A9" strokeWidth={4} dot={{ r: 8, fill: '#A9A9A9', stroke: '#FFFFFF', strokeWidth: 2 }} name="3mis per 1000">
                          <LabelList dataKey="mis3per1000" content={renderLineLabel} fill="#A9A9A9" />
                        </Line>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  <div style={{ width: '100%', height: 600 }}>
                    <h3 style={{ color: '#333', fontSize: 18, marginLeft: 10, fontWeight: 'bold' }}>REPAIR Counts by Sales date</h3>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData3} margin={{ top: 40, right: 20, bottom: 80, left: 0 }}>
                        <CartesianGrid stroke="#ddd" vertical={false} horizontal={true} />
                        <YAxis yAxisId="left" domain={[0, 'auto']} tick={{ fill: '#666', fontSize: 14, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} tick={{ fill: '#666', fontSize: 14, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                        <XAxis dataKey="month" axisLine={{ stroke: '#ccc' }} tickLine={false} tick={{ fill: '#333', fontSize: 13, fontWeight: 'bold' }} />
                        <Legend verticalAlign="bottom" align="center" iconType="rect" iconSize={14} wrapperStyle={{ fontSize: 14, color: '#555', paddingTop: 20, fontWeight: 'bold' }}
                          payload={[
                            { value: 'qty Sold', type: 'rect', color: '#BCD0EF' },
                            { value: '0mis repairs', type: 'line', color: '#F48F45' },
                            { value: '3mis repairs', type: 'line', color: '#A9A9A9' },
                          ]} />
                        <Bar yAxisId="left" dataKey="qty" fill="#BCD0EF" barSize={40} name="qty Sold">
                          <LabelList dataKey="qty" position="top" style={{ fill: '#3464A4', fontSize: 14, fontWeight: 'bold' }} formatter={formatNumber} />
                        </Bar>
                        <Line yAxisId="right" type="linear" dataKey="mis0Count" stroke="#F48F45" strokeWidth={4} dot={{ r: 8, fill: '#F48F45', stroke: '#FFFFFF', strokeWidth: 2 }} name="0mis repairs">
                          <LabelList dataKey="mis0Count" content={renderLineLabel} fill="#F48F45" />
                        </Line>
                        <Line yAxisId="right" type="linear" dataKey="mis3Count" stroke="#A9A9A9" strokeWidth={4} dot={{ r: 8, fill: '#A9A9A9', stroke: '#FFFFFF', strokeWidth: 2 }} name="3mis repairs">
                          <LabelList dataKey="mis3Count" content={renderLineLabel} fill="#A9A9A9" />
                        </Line>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <p style={{ color: '#6B7280', textAlign: 'center', padding: 40 }}>Нет данных для отображения</p>
              )}
            </div>
          )}

          {/* Топ категорий */}
          {activeSubTab === 'categories' && (
            <div style={cardStyle}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1F2937', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ background: '#EEF2FF', padding: '4px 12px', borderRadius: 6, color: '#2563EB', fontSize: 16 }}>🏆</span>
                Топ категорий по количеству рекламаций
              </h2>

              {categoriesData.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
                  {['ALL', ...ALL_MODELS].map(modelFilter => {
                    const filtered = modelFilter === 'ALL'
                      ? categoriesData
                      : categoriesData.filter(d => d.model === modelFilter);
                    const sorted = [...filtered].sort((a, b) => b.total_claims - a.total_claims);
                    
                    return (
                      <div key={modelFilter} style={{
                        backgroundColor: '#FAFBFC',
                        borderRadius: 12,
                        padding: 16,
                        border: '1px solid #E5E7EB',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
                      }}>
                        <h3 style={{
                          margin: '0 0 12px 0',
                          fontSize: 18,
                          fontWeight: 700,
                          color: '#1F2937',
                          borderBottom: '2px solid #2563EB',
                          paddingBottom: 6,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8
                        }}>
                          <span style={{
                            background: '#2563EB',
                            color: 'white',
                            borderRadius: 8,
                            padding: '2px 12px',
                            fontSize: 14
                          }}>
                            {modelFilter === 'ALL' ? 'Все модели' : modelFilter}
                          </span>
                        </h3>
                        
                        {sorted.length > 0 ? (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                              <tr style={{ backgroundColor: '#F3F4F6' }}>
                                <th style={{ padding: '8px 6px', textAlign: 'left', borderBottom: '2px solid #D1D5DB', fontWeight: 600 }}>Категория</th>
                                <th style={{ padding: '8px 6px', textAlign: 'right', borderBottom: '2px solid #D1D5DB', fontWeight: 600 }}>Кол-во рекламаций</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sorted.map((row, idx) => (
                                <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #E5E7EB' }}>{row.category}</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB', fontWeight: 600 }}>
                                    {row.total_claims}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p style={{ color: '#9CA3AF', textAlign: 'center', padding: '12px 0', margin: 0 }}>Нет данных</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={{ color: '#6B7280', textAlign: 'center', padding: 40 }}>Нет загруженных данных</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}