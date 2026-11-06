import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';

const API_BASE = '';

// ====== ХЕЛПЕРЫ ======
const parseVinList = (input) => {
  if (!input) return [];
  return input
    .split(/[\s,;\n\r]+/)
    .map(v => v.trim().toUpperCase())
    .filter(v => v.length > 0);
};

// ====== СТИЛИ ======
const containerStyle = {
  padding: 30,
  fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
  maxWidth: 1600,
  margin: '0 auto',
  background: '#FFFFFF',
  minHeight: 'calc(100vh - 60px)',
  boxSizing: 'border-box',
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 24,
  flexWrap: 'wrap',
  gap: 12,
};

const titleStyle = {
  fontSize: 26,
  fontWeight: 800,
  color: '#111827',
  margin: 0,
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

const exportButtonStyle = {
  padding: '8px 20px',
  borderRadius: 8,
  border: 'none',
  background: '#8B5CF6',
  color: 'white',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  boxShadow: '0 2px 6px rgba(139,92,246,0.3)',
  transition: 'background 0.2s, transform 0.1s',
};

const modelChipStyle = (active) => ({
  padding: '8px 16px',
  borderRadius: 20,
  border: active ? '2px solid #3B82F6' : '1px solid #E5E7EB',
  fontWeight: 600,
  fontSize: 13,
  background: active ? '#EFF6FF' : '#FFFFFF',
  color: active ? '#1D4ED8' : '#6B7280',
  cursor: 'pointer',
  boxShadow: active ? '0 2px 8px rgba(59,130,246,0.2)' : '0 1px 2px rgba(0,0,0,0.05)',
  transition: 'all 0.2s',
  whiteSpace: 'nowrap',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
});

const filterButtonStyle = (active) => ({
  padding: '6px 14px',
  borderRadius: 8,
  border: active ? '2px solid #3B82F6' : '1px solid #D1D5DB',
  fontWeight: 600,
  fontSize: 12,
  background: active ? '#EFF6FF' : '#FFFFFF',
  color: active ? '#1D4ED8' : '#6B7280',
  cursor: 'pointer',
  transition: 'all 0.2s',
  whiteSpace: 'nowrap',
});

const cardStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  padding: 20,
  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
  border: '1px solid #F0F0F5',
  marginBottom: 20,
  overflow: 'hidden',
};

const tableWrapperStyle = {
  maxHeight: 'calc(100vh - 500px)',
  overflowY: 'auto',
  overflowX: 'hidden',
  borderRadius: 8,
  position: 'relative',
};

const thStyle = {
  padding: '10px 8px',
  textAlign: 'left',
  fontWeight: 700,
  color: '#374151',
  borderBottom: '2px solid #E5E7EB',
  background: '#F9FAFB',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 10,
  fontSize: 12,
};

const tdStyle = {
  padding: '8px 8px',
  textAlign: 'left',
  borderBottom: '1px solid #F3F4F6',
  color: '#1F2937',
  fontSize: 12,
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const totalRowStyle = {
  backgroundColor: '#F9FAFB',
  fontWeight: 800,
  borderTop: '2px solid #E5E7EB',
  position: 'sticky',
  bottom: 0,
  zIndex: 10,
  boxShadow: '0 -4px 6px -2px rgba(0,0,0,0.05)',
};

const statsContainerStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  marginBottom: 20,
};

const statsRowStyle = {
  display: 'flex',
  gap: 12,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const statCardStyle = (borderColor, bgColor) => ({
  padding: '12px 20px',
  borderRadius: 12,
  backgroundColor: bgColor || '#F9FAFB',
  border: `2px solid ${borderColor}`,
  fontSize: 14,
  fontWeight: 600,
  color: '#374151',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});

const filterContainerStyle = {
  display: 'flex',
  gap: 16,
  marginBottom: 20,
  flexWrap: 'wrap',
};

const filterGroupStyle = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'wrap',
};

const filterLabelStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: '#374151',
  marginRight: 4,
};

const inputStyle = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: 14,
  background: '#F9FAFB',
};

const labelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 14,
  color: '#4B5563',
  fontWeight: 500,
};

export default function SgpManagementPage() {
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeModel, setActiveModel] = useState('ALL');

  const [blockStatusFilter, setBlockStatusFilter] = useState([]);
  const [resolutionStatusFilter, setResolutionStatusFilter] = useState([]);
  const [storageStatusFilter, setStorageStatusFilter] = useState(['In stock']);

  const [highlightedVin, setHighlightedVin] = useState(null);
  const [searchVin, setSearchVin] = useState('');
  const [complectFilter, setComplectFilter] = useState('');

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportReasons, setExportReasons] = useState([]);
  const [exportSearch, setExportSearch] = useState('');
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [exportReasonLoading, setExportReasonLoading] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (highlightedVin && !event.target.closest('td[data-vin]')) {
        setHighlightedVin(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [highlightedVin]);

  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        setShowExportModal(false);
        setSelectedReason('');
        setCustomReason('');
        setExportSearch('');
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, []);

  const formatDateTime = (dt) => {
    if (!dt) return '—';
    const d = new Date(dt);
    if (isNaN(d.getTime())) return dt;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/sgp-management`);
      if (!res.ok) throw new Error('Ошибка загрузки данных');
      const json = await res.json();
      const normalizedData = json.map(row => ({
        ...row,
        storage_status: row.storage_status === 'In stock (blocked)' ? 'In stock' : row.storage_status,
      }));
      setRawData(normalizedData);
      setError(null);
    } catch (err) {
      console.error('Ошибка SGP Management:', err);
      setError('Нет данных');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const allModels = useMemo(() => {
    const models = [...new Set(rawData.map(d => d.model))].filter(Boolean).sort();
    return models;
  }, [rawData]);

  const getInStockCount = (model) => {
    const data = model === 'ALL' ? rawData : rawData.filter(d => d.model === model);
    return new Set(data.filter(d => d.storage_status === 'In stock').map(d => d.vin)).size;
  };

  const filteredByModel = useMemo(() => {
    if (activeModel === 'ALL') return rawData;
    return rawData.filter(d => d.model === activeModel);
  }, [rawData, activeModel]);

  // Применяем фильтры статусов и поиска по VIN (обновлено для списков и 6 символов)
  const filteredByStatuses = useMemo(() => {
    let result = filteredByModel;
    if (blockStatusFilter.length > 0) {
      result = result.filter(d => blockStatusFilter.includes(d.block_status));
    }
    if (resolutionStatusFilter.length > 0) {
      result = result.filter(d => resolutionStatusFilter.includes(d.resolution_status));
    }
    if (storageStatusFilter.length > 0) {
      result = result.filter(d => storageStatusFilter.includes(d.storage_status));
    }
    if (searchVin.trim()) {
      const searchTokens = parseVinList(searchVin);
      if (searchTokens.length > 0) {
        result = result.filter(d => {
          if (!d.vin) return false;
          const upperVin = d.vin.toUpperCase();
          return searchTokens.some(token => {
            // Если ровно 6 символов - ищем совпадение с конца
            if (token.length === 6) return upperVin.endsWith(token);
            // Иначе ищем вхождение
            return upperVin.includes(token);
          });
        });
      }
    }
    return result;
  }, [filteredByModel, blockStatusFilter, resolutionStatusFilter, storageStatusFilter, searchVin]);

  // Динамический список комплектаций на основе уже отфильтрованных данных (без учёта complectFilter)
  const complectOptions = useMemo(() => {
    const unique = [...new Set(filteredByStatuses.map(d => d.complectation).filter(Boolean))].sort();
    return unique;
  }, [filteredByStatuses]);

  // Если выбранная комплектация больше не доступна, сбрасываем
  useEffect(() => {
    if (complectFilter && !complectOptions.includes(complectFilter)) {
      setComplectFilter('');
    }
  }, [complectOptions, complectFilter]);

  // Окончательная фильтрация с учётом выбранной комплектации
  const filteredData = useMemo(() => {
    if (complectFilter) {
      return filteredByStatuses.filter(d => d.complectation === complectFilter);
    }
    return filteredByStatuses;
  }, [filteredByStatuses, complectFilter]);

  useEffect(() => {
    setBlockStatusFilter([]);
    setResolutionStatusFilter([]);
    setStorageStatusFilter(['In stock']);
    setHighlightedVin(null);
    setSearchVin('');
    setComplectFilter('');
  }, [activeModel]);

  const stats = useMemo(() => {
    const uniqueVins = (arr) => new Set(arr.map(d => d.vin)).size;
    const inStockRows = filteredByModel.filter(d => d.storage_status === 'In stock');
    const outboundRows = filteredByModel.filter(d => d.storage_status === 'Outbound');
    const totalInStock = uniqueVins(inStockRows);
    const totalOutbound = uniqueVins(outboundRows);
    const inStockBlock = uniqueVins(inStockRows.filter(d => d.block_status === 'Блок'));
    const inStockNotBlock = uniqueVins(inStockRows.filter(d => d.block_status === 'Не блок'));
    return { totalInStock, totalOutbound, inStockBlock, inStockNotBlock };
  }, [filteredByModel]);

  const toggleFilter = (filterType, value) => {
    if (filterType === 'block') {
      setBlockStatusFilter(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
    } else if (filterType === 'resolution') {
      setResolutionStatusFilter(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
    } else if (filterType === 'storage') {
      setStorageStatusFilter(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
    }
  };

  const handleVinClick = (vin) => {
    setHighlightedVin(prev => prev === vin ? null : vin);
  };

  const handleExportCurrent = () => {
    const exportData = filteredData.map(d => ({
      'VIN': d.vin,
      'Модель': d.model,
      'Комплектация': d.complectation || '—',
      'Статус блок': d.block_status,
      'Причина': d.reason || '',
      'Дата постановки': d.hold_date ? formatDateTime(d.hold_date) : '—',
      'Статус устранения': d.resolution_status || '',
      'Статус хранения': d.storage_status || '',
      'Расположение': d.location || '',
    }));
    exportData.push({
      'VIN': 'ИТОГО',
      'Модель': '',
      'Комплектация': '',
      'Статус блок': '',
      'Причина': '',
      'Дата постановки': '',
      'Статус устранения': '',
      'Статус хранения': '',
      'Расположение': filteredData.length,
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    const sheetName = activeModel === 'ALL' ? 'Все модели' : activeModel;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    ws['!cols'] = [
      { wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 45 },
      { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 15 },
    ];
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `SGP_Management_${activeModel === 'ALL' ? 'All' : activeModel}_${dateStr}.xlsx`);
  };

  const openExportModal = async () => {
    setShowExportModal(true);
    setExportReasonLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/sgp-management-reasons`);
      if (res.ok) {
        const reasons = await res.json();
        setExportReasons(reasons);
      }
    } catch (err) {
      console.error('Ошибка загрузки причин:', err);
    } finally {
      setExportReasonLoading(false);
    }
  };

  const closeExportModal = () => {
    setShowExportModal(false);
    setSelectedReason('');
    setCustomReason('');
    setExportSearch('');
  };

  const handleSelectReason = (reason) => {
    setSelectedReason(reason);
    setCustomReason('');
  };

  const handleCustomReasonChange = (e) => {
    const val = e.target.value;
    setCustomReason(val);
    if (val) setSelectedReason('');
  };

  const filteredReasons = useMemo(() => {
    if (!exportSearch.trim()) return exportReasons;
    return exportReasons.filter(r => r.toLowerCase().includes(exportSearch.toLowerCase()));
  }, [exportReasons, exportSearch]);

  const handleExportToHoldsWithReason = () => {
    const finalReason = selectedReason || customReason;
    if (!finalReason) return;
    const uniqueVins = [...new Set(filteredData.map(d => d.vin))];
    const exportData = uniqueVins.map(vin => ({
      'VIN': vin,
      'Причина': finalReason,
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Холды');
    ws['!cols'] = [
      { wch: 20 },
      { wch: 60 },
    ];
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `Холды_${dateStr}.xlsx`);
    closeExportModal();
  };

  const handleExportAll = () => {
    const exportData = rawData.map(d => ({
      'VIN': d.vin,
      'Модель': d.model,
      'Комплектация': d.complectation || '—',
      'Статус блок': d.block_status,
      'Причина': d.reason || '',
      'Дата постановки': d.hold_date ? formatDateTime(d.hold_date) : '—',
      'Статус устранения': d.resolution_status || '',
      'Статус хранения': d.storage_status || '',
      'Расположение': d.location || '',
    }));
    exportData.push({
      'VIN': 'ИТОГО',
      'Модель': '',
      'Комплектация': '',
      'Статус блок': '',
      'Причина': '',
      'Дата постановки': '',
      'Статус устранения': '',
      'Статус хранения': '',
      'Расположение': rawData.length,
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Все модели');
    ws['!cols'] = [
      { wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 45 },
      { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 15 },
    ];
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `SGP_Management_All_${dateStr}.xlsx`);
  };

  if (loading && rawData.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 16, padding: 40 }}>
          Загрузка данных...
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>🚗 СГП Management</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <button style={exportButtonStyle} onClick={handleExportAll}>
            📥 Экспорт всех
          </button>
          <button style={buttonStyle} onClick={fetchData}>
            🔄 Обновить
          </button>
        </div>
      </div>

      {/* Переключатель моделей */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={modelChipStyle(activeModel === 'ALL')} onClick={() => setActiveModel('ALL')}>
          <span style={{ fontWeight: 800 }}>Все модели</span>
          <span style={{ 
            background: activeModel === 'ALL' ? '#10B981' : '#D1FAE5',
            color: activeModel === 'ALL' ? '#FFFFFF' : '#065F46',
            borderRadius: 10,
            padding: '1px 8px',
            fontSize: 11,
            fontWeight: 700,
          }}>
            {getInStockCount('ALL')}
          </span>
        </div>
        {allModels.map(model => {
          const inStockCount = getInStockCount(model);
          return (
            <div 
              key={model} 
              style={modelChipStyle(activeModel === model)}
              onClick={() => setActiveModel(model)}
            >
              <span>{model}</span>
              <span style={{ 
                background: activeModel === model ? '#10B981' : '#D1FAE5',
                color: activeModel === model ? '#FFFFFF' : '#065F46',
                borderRadius: 10,
                padding: '1px 8px',
                fontSize: 11,
                fontWeight: 700,
              }}>
                {inStockCount}
              </span>
            </div>
          );
        })}
      </div>

      {/* Статистика */}
      <div style={statsContainerStyle}>
        <div style={statsRowStyle}>
          <div style={statCardStyle('#10B981', '#F0FDF4')}>
            📦 In stock: <span style={{ color: '#10B981', fontSize: 20, fontWeight: 800 }}>{stats.totalInStock}</span>
          </div>
          <div style={statCardStyle('#3B82F6', '#EFF6FF')}>
            📤 Outbound: <span style={{ color: '#3B82F6', fontSize: 20, fontWeight: 800 }}>{stats.totalOutbound}</span>
          </div>
        </div>
        <div style={{ ...statsRowStyle, paddingLeft: 20, borderLeft: '3px solid #10B981' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#10B981' }}>Из In stock:</span>
          <div style={statCardStyle('#DC2626', '#FEF2F2')}>
            🔴 Блок: <span style={{ color: '#DC2626', fontSize: 18, fontWeight: 800 }}>{stats.inStockBlock}</span>
          </div>
          <div style={statCardStyle('#059669', '#ECFDF5')}>
            🟢 Не блок: <span style={{ color: '#059669', fontSize: 18, fontWeight: 800 }}>{stats.inStockNotBlock}</span>
          </div>
        </div>
      </div>

        {/* Фильтры */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
        {/* Первая строка: статусы */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={filterGroupStyle}>
            <span style={filterLabelStyle}>Статус блок:</span>
            <button 
                style={filterButtonStyle(blockStatusFilter.includes('Блок'))}
                onClick={() => toggleFilter('block', 'Блок')}
            >
                Блок
            </button>
            <button 
                style={filterButtonStyle(blockStatusFilter.includes('Не блок'))}
                onClick={() => toggleFilter('block', 'Не блок')}
            >
                Не блок
            </button>
            </div>
            
            <div style={filterGroupStyle}>
            <span style={filterLabelStyle}>Статус устранения:</span>
            <button 
                style={filterButtonStyle(resolutionStatusFilter.includes('Устранено'))}
                onClick={() => toggleFilter('resolution', 'Устранено')}
            >
                Устранено
            </button>
            <button 
                style={filterButtonStyle(resolutionStatusFilter.includes('Не устранено'))}
                onClick={() => toggleFilter('resolution', 'Не устранено')}
            >
                Не устранено
            </button>
            </div>
            
            <div style={filterGroupStyle}>
            <span style={filterLabelStyle}>Статус хранения:</span>
            <button 
                style={filterButtonStyle(storageStatusFilter.includes('In stock'))}
                onClick={() => toggleFilter('storage', 'In stock')}
            >
                In stock
            </button>
            <button 
                style={filterButtonStyle(storageStatusFilter.includes('Outbound'))}
                onClick={() => toggleFilter('storage', 'Outbound')}
            >
                Outbound
            </button>
            <button 
                style={filterButtonStyle(storageStatusFilter.includes('Unknown'))}
                onClick={() => toggleFilter('storage', 'Unknown')}
            >
                Unknown
            </button>
            </div>
        </div>

        {/* Вторая строка: поиск VIN и комплектация */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#374151', paddingTop: 10 }}>VIN:</span>
            <textarea
                value={searchVin}
                onChange={(e) => setSearchVin(e.target.value)}
                placeholder="Введите или вставьте VIN (через запятую или с новой строки)..."
                style={{ 
                  ...inputStyle, 
                  width: 300, 
                  minHeight: 40, 
                  resize: 'vertical', 
                  fontFamily: 'inherit', 
                  lineHeight: '1.4' 
                }}
            />
            {searchVin && (
                <button
                onClick={() => setSearchVin('')}
                style={{ ...buttonStyle, background: '#9CA3AF', padding: '6px 12px', marginTop: 4 }}
                >
                ✕
                </button>
            )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Комплектация:</span>
            <select
                value={complectFilter}
                onChange={(e) => setComplectFilter(e.target.value)}
                style={{ ...inputStyle, minWidth: 150 }}
            >
                <option value="">Все</option>
                {complectOptions.map((comp, idx) => (
                <option key={idx} value={comp}>{comp}</option>
                ))}
            </select>
            {complectFilter && (
                <button
                onClick={() => setComplectFilter('')}
                style={{ ...buttonStyle, background: '#9CA3AF', padding: '4px 10px' }}
                >
                ✕
                </button>
            )}
            </div>
        </div>
        </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={exportButtonStyle} onClick={handleExportCurrent}>
            📥 Экспорт текущей таблицы ({filteredData.length})
          </button>
          <button style={{ ...buttonStyle, background: '#F59E0B' }} onClick={openExportModal}>
            📥 Экспорт на холды
          </button>
        </div>

        <div style={tableWrapperStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: '14%' }}>VIN</th>
                <th style={{ ...thStyle, width: '9%' }}>Модель</th>
                <th style={{ ...thStyle, width: '16%' }}>Комплектация</th>
                <th style={{ ...thStyle, width: '7%' }}>Статус блок</th>
                <th style={{ ...thStyle, width: '18%' }}>Причина</th>
                <th style={{ ...thStyle, width: '12%' }}>Дата постановки</th>
                <th style={{ ...thStyle, width: '10%' }}>Статус устранения</th>
                <th style={{ ...thStyle, width: '10%' }}>Статус хранения</th>
                <th style={{ ...thStyle, width: '10%' }}>Расположение</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((row, idx) => {
                const isHighlighted = highlightedVin === row.vin;
                return (
                  <tr 
                    key={idx} 
                    style={{ 
                      backgroundColor: isHighlighted ? '#DCFCE7' : (idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB'),
                      cursor: 'pointer',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={e => {
                      if (!isHighlighted) e.currentTarget.style.backgroundColor = '#EEF2FF';
                    }}
                    onMouseLeave={e => {
                      if (!isHighlighted) e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
                    }}
                  >
                    <td 
                      data-vin={row.vin}
                      style={{ ...tdStyle, fontWeight: 600, fontSize: 12 }}
                      onClick={() => handleVinClick(row.vin)}
                    >
                      {row.vin}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 700, fontSize: 12 }}>{row.model}</td>
                    <td style={{ ...tdStyle, fontSize: 12 }}>{row.complectation || '—'}</td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        backgroundColor: row.block_status === 'Блок' ? '#FEE2E2' : '#D1FAE5',
                        color: row.block_status === 'Блок' ? '#991B1B' : '#065F46',
                        whiteSpace: 'nowrap',
                      }}>
                        {row.block_status}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, lineHeight: '1.4', whiteSpace: 'normal' }}>{row.reason || '—'}</td>
                    <td style={{ ...tdStyle, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {row.hold_date ? formatDateTime(row.hold_date) : '—'}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        backgroundColor: row.resolution_status === 'Устранено' ? '#F0FDF4' : '#FEF3C7',
                        color: row.resolution_status === 'Устранено' ? '#065F46' : '#92400E',
                        whiteSpace: 'nowrap',
                      }}>
                        {row.resolution_status || '—'}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12 }}>{row.storage_status || '—'}</td>
                    <td style={{ ...tdStyle, fontSize: 12 }}>{row.location || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={totalRowStyle}>
                <td style={{ ...tdStyle, fontWeight: 800 }}>ИТОГО</td>
                <td style={tdStyle}></td>
                <td style={tdStyle}></td>
                <td style={tdStyle}></td>
                <td style={tdStyle}></td>
                <td style={tdStyle}></td>
                <td style={tdStyle}></td>
                <td style={tdStyle}></td>
                <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 800 }}>{filteredData.length}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Модальное окно экспорта на холды */}
      {showExportModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000,
        }}>
          <div style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 16,
            padding: 24,
            width: '90%',
            maxWidth: 600,
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1F2937' }}>
                Экспорт на холды
              </h3>
              <button 
                onClick={closeExportModal}
                style={{
                  border: 'none',
                  background: 'none',
                  fontSize: 24,
                  cursor: 'pointer',
                  color: '#DC2626',
                  padding: '0 4px',
                  fontWeight: '700',
                }}
              >
                ×
              </button>
            </div>

            <p style={{ fontSize: 14, color: '#4B5563', marginBottom: 16 }}>
              Выберите причину или введите свою
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ ...labelStyle, marginBottom: 8 }}>
                Поиск причины:
                <input
                  type="text"
                  value={exportSearch}
                  onChange={(e) => setExportSearch(e.target.value)}
                  placeholder="Начните вводить..."
                  style={{ ...inputStyle, flex: 1 }}
                  disabled={!!customReason}
                />
              </label>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 8 }}>
                {exportReasonLoading ? (
                  <div style={{ padding: 20, textAlign: 'center', color: '#6B7280' }}>Загрузка...</div>
                ) : filteredReasons.length > 0 ? (
                  filteredReasons.map(reason => (
                    <div 
                      key={reason}
                      onClick={() => handleSelectReason(reason)}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        backgroundColor: selectedReason === reason ? '#EFF6FF' : 'transparent',
                        borderBottom: '1px solid #F0F0F5',
                        fontSize: 14,
                      }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#F3F4F6'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = selectedReason === reason ? '#EFF6FF' : 'transparent'}
                    >
                      {reason}
                    </div>
                  ))
                ) : (
                  <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF' }}>Нет причин</div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ ...labelStyle, marginBottom: 8 }}>
                Своя причина:
                <input
                  type="text"
                  value={customReason}
                  onChange={handleCustomReasonChange}
                  placeholder="Введите причину..."
                  style={{ ...inputStyle, flex: 1 }}
                  disabled={!!selectedReason}
                />
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button style={{ ...buttonStyle, background: '#9CA3AF' }} onClick={closeExportModal}>
                Отмена
              </button>
              <button 
                style={{ ...buttonStyle, background: '#F59E0B', opacity: (selectedReason || customReason) ? 1 : 0.6, pointerEvents: (selectedReason || customReason) ? 'auto' : 'none' }}
                onClick={handleExportToHoldsWithReason}
                disabled={!selectedReason && !customReason}
              >
                📥 Экспорт
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}