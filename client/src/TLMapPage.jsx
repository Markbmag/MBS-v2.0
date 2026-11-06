import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';

const API_BASE = '';

const containerStyle = {
  padding: '20px',
  fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
  width: '100%',
  margin: '0 auto',
  background: '#E5E7EB',
  minHeight: 'calc(100vh - 60px)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 16,
  flexWrap: 'wrap',
  gap: 12,
  flexShrink: 0,
};

const titleStyle = {
  fontSize: 24,
  fontWeight: 800,
  color: '#111827',
  margin: 0,
};

const headerButtonsStyle = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
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
};

const exportButtonStyle = {
  padding: '8px 20px',
  borderRadius: 8,
  border: 'none',
  background: '#10B981',
  color: 'white',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  boxShadow: '0 2px 6px rgba(16,185,129,0.3)',
};

const lastUpdateStyle = {
  fontSize: 12,
  color: '#6B7280',
  fontWeight: 500,
};

const totalsRowStyle = {
  display: 'flex',
  gap: 12,
  marginBottom: 16,
  flexWrap: 'nowrap',
  flexShrink: 0,
};

const totalCardStyle = {
  flex: '1 1 0',
  minWidth: 0,
  backgroundColor: '#FFFFFF',
  borderRadius: 12,
  padding: '10px 8px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
  border: '1px solid #F0F0F5',
  textAlign: 'center',
};

const totalLabelStyle = {
  fontSize: 12,
  fontWeight: 600,
  color: '#6B7280',
  marginBottom: 4,
};

const totalValueStyle = {
  fontSize: 24,
  fontWeight: 800,
  color: '#1F2937',
};

const kanbanContainerStyle = {
  display: 'flex',
  gap: 12,
  alignItems: 'stretch',
  flex: 1,
  minHeight: 0,
};

const zoneColumnStyle = {
  flex: '1 1 0',
  minWidth: 0,
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  padding: 14,
  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
  border: '1px solid #F0F0F5',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  height: 'calc(100vh - 280px)',
  minHeight: 300,
};

const zoneTitleStyle = {
  textAlign: 'center',
  fontSize: 16,
  fontWeight: 800,
  color: '#1F2937',
  marginBottom: 10,
  paddingBottom: 8,
  borderBottom: '2px solid #F3F4F6',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

const zoneTotalBadgeStyle = {
  backgroundColor: '#FFFFFF',
  border: '2px dashed #9CA3AF',
  borderRadius: '50%',
  minWidth: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  fontWeight: 800,
  color: '#374151',
  padding: '0 6px',
  cursor: 'pointer',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  zIndex: 5,
  transition: 'transform 0.15s, background 0.15s',
};

const itemsScrollStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  overflowY: 'auto',
  paddingRight: 4,
  flex: 1,
  minHeight: 0,
};

const emptyZoneStyle = {
  textAlign: 'center',
  color: '#9CA3AF',
  fontSize: 13,
  padding: '20px 0',
  fontWeight: 500,
};

const getColorByFirstLetter = (label) => {
  if (!label) return '#D1D5DB';
  const firstLetter = label.charAt(0).toUpperCase();
  switch (firstLetter) {
    case 'A': return '#86EFAC';
    case 'J': return '#FDBA74';
    case 'M': return '#C4B5FD';
    case 'G': return '#A7F3D0';
    default: return '#D1D5DB';
  }
};

const itemCardStyle = (color) => ({
  backgroundColor: color,
  borderRadius: 3,
  padding: '5px 8px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  minHeight: 28,
  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
  flexShrink: 0,
  cursor: 'pointer',
  transition: 'opacity 0.15s',
  border: 'none',
  width: '100%',
});

const itemLabelStyle = {
  color: '#000000',
  fontWeight: 900,
  fontSize: 15,
  letterSpacing: '0.3px',
};

const itemCountStyle = {
  color: '#000000',
  fontWeight: 900,
  fontSize: 17,
};

const filterContainerStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 12,
  padding: 10,
  backgroundColor: '#FFFFFF',
  borderRadius: 12,
  border: '1px solid #E5E7EB',
  flexShrink: 0,
};

const filterCheckboxStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 13,
  cursor: 'pointer',
};

const MODEL_ORDER = ['A8', 'J6', 'J7', 'J8', 'MX'];
const ZONE_ORDER = ['TLWA', 'TLRT', 'TLADAS', 'TLTT', 'CPA'];

const sortByModelAndVersion = (a, b) => {
  const [modelA, versionA] = a.label.split('.');
  const [modelB, versionB] = b.label.split('.');
  const modelIndexA = MODEL_ORDER.indexOf(modelA);
  const modelIndexB = MODEL_ORDER.indexOf(modelB);
  if (modelIndexA !== modelIndexB) return modelIndexA - modelIndexB;
  const versionNumA = parseInt(versionA, 10) || 0;
  const versionNumB = parseInt(versionB, 10) || 0;
  return versionNumA - versionNumB;
};

const formatSpec = (spec) => {
  if (!spec || spec === '???') return '???';
  const match = spec.match(/([A-Z]+\d*)[._\s]?(\d+)?/i);
  if (match) {
    const model = match[1].toUpperCase();
    const version = match[2] || '';
    return version ? `${model}.${version}` : model;
  }
  return spec;
};

const formatDuration = (seconds) => {
  if (seconds === null || seconds === undefined) return '';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${days}:${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const useLockBodyScroll = () => {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);
};

function DetailsModal({ zoneName, label, count, details, onClose }) {
  useLockBodyScroll();
  const modalOverlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  };
  const modalContentStyle = {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24,
    maxWidth: 1000, width: '90%', maxHeight: '80vh',
    boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
    display: 'flex', flexDirection: 'column',
  };
  const modalHeaderStyle = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16, gap: 12, flexWrap: 'wrap',
  };
  const modalTitleStyle = {
    fontSize: 20, fontWeight: 800, color: '#1F2937', margin: 0,
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  };
  const closeButtonStyle = {
    padding: '8px 12px', borderRadius: 8, border: 'none',
    background: '#F3F4F6', color: '#374151', fontSize: 16,
    fontWeight: 700, cursor: 'pointer',
  };
  const tableContainerStyle = { overflowY: 'auto', flex: 1 };
  const thStyle = {
    padding: '10px 12px', textAlign: 'left', fontWeight: 600,
    color: '#374151', borderBottom: '2px solid #E5E7EB',
    background: '#F9FAFB', whiteSpace: 'nowrap',
    position: 'sticky', top: 0, zIndex: 5,
  };
  const tdStyle = {
    padding: '8px 12px', textAlign: 'left',
    borderBottom: '1px solid #F0F0F5', color: '#1F2937', fontSize: 13,
  };
  const recordsCountStyle = { fontSize: 13, color: '#6B7280', fontWeight: 500 };

  const handleExportDetails = () => {
    const exportData = details.map(d => ({
      'VIN': d.vin, 'MODEL': d.model, 'SPEC': d.spec,
      'LOT': d.lot, 'COLOR': d.color, 'SEQ': d.seq,
      'Время входа': d.entry_time ? new Date(d.entry_time).toLocaleString('ru-RU') : '',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${zoneName}_${label}`);
    ws['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 20 }];
    XLSX.writeFile(wb, `TL_Map_${zoneName}_${label}.xlsx`);
  };

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 style={modalTitleStyle}>
            {zoneName} — {label} — {count} шт.
            <span style={recordsCountStyle}>Найдено записей: {details.length}</span>
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...exportButtonStyle, padding: '8px 16px', fontSize: 13 }} onClick={handleExportDetails}>📥 Экспорт</button>
            <button style={closeButtonStyle} onClick={onClose}>✕</button>
          </div>
        </div>
        <div style={tableContainerStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle}>VIN</th>
                <th style={thStyle}>MODEL</th>
                <th style={thStyle}>SPEC</th>
                <th style={thStyle}>LOT</th>
                <th style={thStyle}>COLOR</th>
                <th style={thStyle}>SEQ</th>
                <th style={thStyle}>Время входа (ДД.ММ.ГГГГ, ЧЧ:ММ:СС)</th>
              </tr>
            </thead>
            <tbody>
              {details.map((detail, idx) => (
                <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                  <td style={tdStyle}>{detail.vin}</td>
                  <td style={tdStyle}>{detail.model}</td>
                  <td style={tdStyle}>{detail.spec}</td>
                  <td style={tdStyle}>{detail.lot}</td>
                  <td style={tdStyle}>{detail.color}</td>
                  <td style={tdStyle}>{detail.seq}</td>
                  <td style={tdStyle}>{detail.entry_time ? new Date(detail.entry_time).toLocaleString('ru-RU') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PassedTodayModal({ zoneName, uniqueCount, totalRecords, details, onClose }) {
  useLockBodyScroll();
  const modalOverlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  };
  const modalContentStyle = {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24,
    maxWidth: 1200, width: '90%', maxHeight: '80vh',
    boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
    display: 'flex', flexDirection: 'column',
  };
  const modalHeaderStyle = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16, gap: 12, flexWrap: 'wrap',
  };
  const modalTitleStyle = {
    fontSize: 20, fontWeight: 800, color: '#1F2937', margin: 0,
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  };
  const closeButtonStyle = {
    padding: '8px 12px', borderRadius: 8, border: 'none',
    background: '#F3F4F6', color: '#374151', fontSize: 16,
    fontWeight: 700, cursor: 'pointer',
  };
  const tableContainerStyle = { overflowY: 'auto', flex: 1 };
  const thStyle = {
    padding: '10px 12px', textAlign: 'left', fontWeight: 600,
    color: '#374151', borderBottom: '2px solid #E5E7EB',
    background: '#F9FAFB', whiteSpace: 'nowrap',
    position: 'sticky', top: 0, zIndex: 5,
  };
  const tdStyle = {
    padding: '8px 12px', textAlign: 'left',
    borderBottom: '1px solid #F0F0F5', color: '#1F2937', fontSize: 13,
  };

  const handleExportDetails = () => {
    const exportData = details.map(d => ({
      'VIN': d.vin,
      'MODEL': d.model,
      'SEQ': d.seq,
      'Время входа': d.pass_time ? new Date(d.pass_time).toLocaleString('ru-RU') : '',
      'Время выхода': d.exit_time ? new Date(d.exit_time).toLocaleString('ru-RU') : '',
      'Время на посту': d.duration !== null && d.duration !== undefined ? formatDuration(d.duration) : '',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${zoneName}_passed_today`);
    ws['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 15 }];
    XLSX.writeFile(wb, `TL_Map_${zoneName}_passed_today.xlsx`);
  };

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 style={modalTitleStyle}>
            {zoneName} — Прошло за сегодня
            <span style={{ fontSize: 13, color: '#6B7280', fontWeight: 500 }}>
              Уникальных VIN: {uniqueCount} | Всего записей: {totalRecords}
            </span>
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...exportButtonStyle, padding: '8px 16px', fontSize: 13 }} onClick={handleExportDetails}>📥 Экспорт</button>
            <button style={closeButtonStyle} onClick={onClose}>✕</button>
          </div>
        </div>
        <div style={tableContainerStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle}>VIN</th>
                <th style={thStyle}>MODEL</th>
                <th style={thStyle}>SEQ</th>
                <th style={thStyle}>Время входа (ДД.ММ.ГГГГ, ЧЧ:ММ:СС)</th>
                <th style={thStyle}>Время выхода (ДД.ММ.ГГГГ, ЧЧ:ММ:СС)</th>
                <th style={thStyle}>Время на посту (Д:Ч:М:С)</th>
              </tr>
            </thead>
            <tbody>
              {details.map((detail, idx) => (
                <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                  <td style={tdStyle}>{detail.vin}</td>
                  <td style={tdStyle}>{detail.model}</td>
                  <td style={tdStyle}>{detail.seq}</td>
                  <td style={tdStyle}>{detail.pass_time ? new Date(detail.pass_time).toLocaleString('ru-RU') : ''}</td>
                  <td style={tdStyle}>{detail.exit_time ? new Date(detail.exit_time).toLocaleString('ru-RU') : ''}</td>
                  <td style={tdStyle}>{detail.duration !== null && detail.duration !== undefined ? formatDuration(detail.duration) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AnalyticsModal({ data, onClose, onApplyFilter, onVinClick }) {
  useLockBodyScroll();
  const modalOverlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  };
  const modalContentStyle = {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16,
    maxWidth: '95vw', width: '95vw', maxHeight: '90vh',
    boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
    display: 'flex', flexDirection: 'column',
  };
  const modalHeaderStyle = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16, gap: 12, flexWrap: 'wrap',
  };
  const modalTitleStyle = {
    fontSize: 22, fontWeight: 800, color: '#1F2937', margin: 0,
  };
  const closeButtonStyle = {
    padding: '8px 12px', borderRadius: 8, border: 'none',
    background: '#F3F4F6', color: '#374151', fontSize: 16,
    fontWeight: 700, cursor: 'pointer',
  };
  const filterRowStyle = {
    display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
    marginBottom: 16,
  };
  const inputStyle = {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #D1D5DB',
    fontSize: 14,
    background: '#F9FAFB',
  };
  const tableContainerStyle = { overflowY: 'auto', overflowX: 'hidden', flex: 1 };
  const thStyle = {
    padding: '8px 10px', textAlign: 'left', fontWeight: 600,
    color: '#374151', borderBottom: '2px solid #E5E7EB',
    background: '#F9FAFB', whiteSpace: 'nowrap',
    position: 'sticky', top: 0, zIndex: 5,
  };
  const tdStyle = {
    padding: '6px 10px', textAlign: 'left',
    borderBottom: '1px solid #F0F0F5', color: '#1F2937', fontSize: 12,
  };

  const [dateFrom, setDateFrom] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00`;
  });
  const [dateTo, setDateTo] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${mi}`;
  });

  const allZones = useMemo(() => [...new Set(data.map(r => r.current_zone))], [data]);
  const [selectedZones, setSelectedZones] = useState(() => allZones.filter(z => z !== 'Inbound' && z !== 'Outbound' && z !== 'CP8'));

  useEffect(() => {
    if (allZones.length > 0 && selectedZones.length === 0) {
      setSelectedZones(allZones.filter(z => z !== 'Inbound' && z !== 'Outbound' && z !== 'CP8'));
    }
  }, [allZones, selectedZones]);

  const handleApply = () => {
    onApplyFilter(dateFrom, dateTo);
  };

  const toggleZone = (zone) => {
    setSelectedZones(prev =>
      prev.includes(zone) ? prev.filter(z => z !== zone) : [...prev, zone]
    );
  };

  const filteredData = useMemo(() => {
    const filtered = data.filter(row => selectedZones.includes(row.current_zone));
    const totalAll = filtered.reduce((sum, r) => sum + (r.total_stay_seconds || 0), 0);
    let cum = 0;
    return filtered.map(r => {
      cum += (r.total_stay_seconds || 0);
      return { ...r, cum_percent: totalAll > 0 ? +((cum / totalAll) * 100).toFixed(2) : 0 };
    });
  }, [data, selectedZones]);

  const handleExport = () => {
    const exportData = filteredData.map((row, idx) => ({
      '№': idx + 1,
      'VIN': row.vin,
      'Текущее расположение': row.current_zone,
      'Суммарное время на TL': formatDuration(row.total_stay_seconds),
      'Накопительный %': row.cum_percent,
      'Ремзона вход': row.rem_in ? new Date(row.rem_in).toLocaleString('ru-RU') : '',
      'Ремзона выход': row.in_rem ? 'Сейчас в ремзоне' : (row.rem_out ? new Date(row.rem_out).toLocaleString('ru-RU') : ''),
      'Время в ремзоне': row.rem_duration_seconds ? formatDuration(row.rem_duration_seconds) : '—',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Analytics');
    XLSX.writeFile(wb, 'TL_Map_Analytics.xlsx');
  };

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 style={modalTitleStyle}>Аналитика (Парето) по времени на TL-постах</h2>
          <button style={closeButtonStyle} onClick={onClose}>✕</button>
        </div>
        <div style={filterRowStyle}>
          <span>Период прохождения CP72:</span>
          <input type="datetime-local" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
          <span>—</span>
          <input type="datetime-local" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
          <button style={{ ...buttonStyle, padding: '8px 16px' }} onClick={handleApply}>Применить</button>
          <button style={{ ...exportButtonStyle, padding: '8px 16px' }} onClick={handleExport}>Экспорт</button>
        </div>
        <div style={{ ...filterContainerStyle, marginBottom: 12 }}>
          <span style={{ fontWeight: 600, marginRight: 8 }}>Текущее расположение:</span>
          {allZones.map(zone => (
            <label key={zone} style={filterCheckboxStyle}>
              <input
                type="checkbox"
                checked={selectedZones.includes(zone)}
                onChange={() => toggleZone(zone)}
              />
              {zone}
            </label>
          ))}
        </div>
        <div style={tableContainerStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle}>№</th>
                <th style={thStyle}>VIN</th>
                <th style={thStyle}>Текущее расположение</th>
                <th style={thStyle}>Суммарное время на TL (Д:Ч:М:С)</th>
                <th style={thStyle}>Накопительный %</th>
                <th style={thStyle}>Ремзона вход (ДД.ММ.ГГГГ, ЧЧ:ММ:СС)</th>
                <th style={thStyle}>Ремзона выход (ДД.ММ.ГГГГ, ЧЧ:ММ:СС)</th>
                <th style={thStyle}>Время в ремзоне (Д:Ч:М:С)</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((row, idx) => {
                const isTop20 = row.cum_percent <= 80;
                return (
                  <tr key={idx} style={{
                    backgroundColor: isTop20 ? '#FEF9C3' : (idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB'),
                  }}>
                    <td style={tdStyle}>{idx + 1}</td>
                    <td style={{ ...tdStyle, cursor: 'pointer', color: '#2563EB', textDecoration: 'underline' }} onClick={() => onVinClick(row.vin)}>{row.vin}</td>
                    <td style={tdStyle}>{row.current_zone}</td>
                    <td style={tdStyle}>{formatDuration(row.total_stay_seconds)}</td>
                    <td style={tdStyle}>{row.cum_percent}%</td>
                    <td style={tdStyle}>{row.rem_in ? new Date(row.rem_in).toLocaleString('ru-RU') : '—'}</td>
                    <td style={tdStyle}>
                      {row.in_rem ? 'Сейчас в ремзоне' : (row.rem_out ? new Date(row.rem_out).toLocaleString('ru-RU') : '—')}
                    </td>
                    <td style={tdStyle}>
                      {row.rem_duration_seconds ? formatDuration(row.rem_duration_seconds) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function VINHistoryModal({ vin, onClose }) {
  useLockBodyScroll();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const modalOverlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1100,
  };
  const modalContentStyle = {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24,
    maxWidth: 900, width: '90%', maxHeight: '85vh',
    boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
    display: 'flex', flexDirection: 'column',
  };
  const modalHeaderStyle = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16, gap: 12, flexWrap: 'wrap',
  };
  const modalTitleStyle = {
    fontSize: 20, fontWeight: 800, color: '#1F2937', margin: 0,
  };
  const closeButtonStyle = {
    padding: '8px 12px', borderRadius: 8, border: 'none',
    background: '#F3F4F6', color: '#374151', fontSize: 16,
    fontWeight: 700, cursor: 'pointer',
  };
  const tableContainerStyle = { overflowY: 'auto', flex: 1 };
  const thStyle = {
    padding: '10px 12px', textAlign: 'left', fontWeight: 600,
    color: '#374151', borderBottom: '2px solid #E5E7EB',
    background: '#F9FAFB', whiteSpace: 'nowrap',
    position: 'sticky', top: 0, zIndex: 5,
  };
  const tdStyle = {
    padding: '8px 12px', textAlign: 'left',
    borderBottom: '1px solid #F0F0F5', color: '#1F2937', fontSize: 13,
  };

  const getZoneColor = (zone) => {
    if (zone.startsWith('REP')) return '#FCA5A5';
    if (zone === 'TLWA' || zone === 'TLRT' || zone === 'TLADAS' || zone === 'TLTT') return '#86EFAC';
    return '#FFFFFF';
  };

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tl-map-vin-history?vin=${vin}`);
        if (!res.ok) throw new Error('Ошибка загрузки истории');
        const data = await res.json();
        setHistory(data);
      } catch (err) {
        console.error('Ошибка истории VIN:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [vin]);

  const handleExport = () => {
    const exportData = history.map((event, idx) => ({
      '№': idx + 1,
      'Время': new Date(event.event_time).toLocaleString('ru-RU'),
      'Зона': event.zone,
      'Источник': event.source,
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `История_${vin}`);
    XLSX.writeFile(wb, `История_${vin}.xlsx`);
  };

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 style={modalTitleStyle}>История перемещений VIN: {vin}</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...exportButtonStyle, padding: '8px 16px', fontSize: 13 }} onClick={handleExport}>📥 Экспорт</button>
            <button style={closeButtonStyle} onClick={onClose}>✕</button>
          </div>
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 20 }}>Загрузка...</div>
        ) : (
          <div style={tableContainerStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thStyle}>№</th>
                  <th style={thStyle}>Время (ДД.ММ.ГГГГ, ЧЧ:ММ:СС)</th>
                  <th style={thStyle}>Зона</th>
                  <th style={thStyle}>Источник</th>
                </tr>
              </thead>
              <tbody>
                {history.map((event, idx) => (
                  <tr
                    key={idx}
                    style={{
                      backgroundColor: getZoneColor(event.zone),
                      fontWeight: event.zone === 'CPFINAL' ? 'bold' : 'normal'
                    }}
                  >
                    <td style={tdStyle}>{idx + 1}</td>
                    <td style={tdStyle}>{new Date(event.event_time).toLocaleString('ru-RU')}</td>
                    <td style={tdStyle}>{event.zone}</td>
                    <td style={tdStyle}>{event.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TLMapPage() {
  const [rawData, setRawData] = useState([]);
  const [passedTodayData, setPassedTodayData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModelFilter, setShowModelFilter] = useState(false);
  const [selectedModels, setSelectedModels] = useState(['A8', 'J6', 'J7', 'J8', 'MX']);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedPassedToday, setSelectedPassedToday] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analyticsData, setAnalyticsData] = useState([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const [selectedVinHistory, setSelectedVinHistory] = useState(null);

  const ALL_MODELS = ['A8', 'J6', 'J7', 'J8', 'MX'];

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tl-map`);
      if (!res.ok) throw new Error('Ошибка загрузки данных');
      const json = await res.json();
      setRawData(json);
      setError(null);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Ошибка TL Map:', err);
      setError('Нет данных');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPassedToday = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tl-map-passed-today`);
      if (!res.ok) throw new Error('Ошибка загрузки');
      const json = await res.json();
      setPassedTodayData(json);
    } catch (err) {
      console.error('Ошибка passed today:', err);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchPassedToday();
  }, [fetchData, fetchPassedToday]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
      fetchPassedToday();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchData, fetchPassedToday]);

  const loadAnalytics = async (dateFrom, dateTo) => {
    setAnalyticsLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append('startTime', dateFrom);
      if (dateTo) params.append('endTime', dateTo);
      const res = await fetch(`${API_BASE}/api/tl-map-analytics?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки аналитики');
      const json = await res.json();
      setAnalyticsData(json);
    } catch (err) {
      console.error('Ошибка аналитики:', err);
      setAnalyticsData([]);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const handleOpenAnalytics = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const firstDay = `${y}-${m}-01T00:00`;
    const current = `${y}-${m}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setShowAnalytics(true);
    loadAnalytics(firstDay, current);
  };

  const handleApplyAnalyticsFilter = (from, to) => {
    loadAnalytics(from, to);
  };

  const handleVinClick = (vin) => {
    setSelectedVinHistory(vin);
  };

  const handleCloseVinHistory = () => {
    setSelectedVinHistory(null);
  };

  const processedData = useMemo(() => {
    const zonesMap = {};
    const detailsMap = {};

    rawData.forEach(row => {
      const zone = row.vehicle_status;
      const spec = formatSpec(row.spec);
      const model = row.model || spec.split('.')[0];

      if (!zone || !ZONE_ORDER.includes(zone)) return;

      const detailsKey = `${zone}_${spec}`;
      if (!detailsMap[detailsKey]) detailsMap[detailsKey] = [];
      detailsMap[detailsKey].push({
        vin: row.vin, model, spec, lot: row.lot, color: row.color, seq: row.seq,
        entry_time: row.entry_time,
      });

      if (!zonesMap[zone]) zonesMap[zone] = {};
      if (!zonesMap[zone][spec]) zonesMap[zone][spec] = 0;
      zonesMap[zone][spec]++;
    });

    const zones = ZONE_ORDER.map(zoneName => ({
      zoneName,
      items: zonesMap[zoneName]
        ? Object.keys(zonesMap[zoneName]).map(spec => ({
            label: spec,
            count: zonesMap[zoneName][spec],
          }))
        : [],
    }));

    return { zones, detailsMap };
  }, [rawData]);

  const handleModelToggle = (model) => {
    setSelectedModels(prev => prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]);
  };

  const handleExportAll = () => {
    const exportData = [];
    zonesWithTotal.forEach(zone => {
      zone.items.forEach(item => {
        exportData.push({ 'Zone': zone.zoneName, 'Model': item.label, 'Count': item.count });
      });
      exportData.push({ 'Zone': zone.zoneName, 'Model': 'ИТОГО', 'Count': zone.total });
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'TL Map');
    ws['!cols'] = [{ wch: 12 }, { wch: 15 }, { wch: 10 }];
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `TL_Map_${dateStr}.xlsx`);
  };

  const handlePassedTodayClick = async (zoneName) => {
    try {
      const res = await fetch(`${API_BASE}/api/tl-map-passed-today-details?zone=${zoneName}`);
      if (!res.ok) throw new Error('Ошибка загрузки');
      const json = await res.json();

      setSelectedPassedToday({
        zoneName,
        uniqueCount: passedTodayData[zoneName] || 0,
        totalRecords: json.length,
        details: json,
      });
    } catch (err) {
      console.error('Ошибка загрузки деталей:', err);
    }
  };

  const filteredZones = processedData.zones.map(zone => ({
    ...zone,
    items: zone.items.filter(item => selectedModels.includes(item.label.split('.')[0]))
  }));

  const sortedZones = filteredZones.map(zone => ({
    ...zone,
    items: [...zone.items].sort(sortByModelAndVersion),
  }));

  const zonesWithTotal = sortedZones.map(zone => ({
    ...zone,
    total: zone.items.reduce((sum, item) => sum + (item.count || 0), 0),
  }));

  const handleItemClick = (zoneName, label, count) => {
    const detailsKey = `${zoneName}_${label}`;
    setSelectedItem({
      zoneName, label, count,
      details: processedData.detailsMap[detailsKey] || [],
    });
  };

  const handleCloseModal = () => setSelectedItem(null);
  const handleClosePassedToday = () => setSelectedPassedToday(null);
  const handleCloseAnalytics = () => setShowAnalytics(false);

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 16, padding: 40 }}>Загрузка данных...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', color: '#DC2626', fontSize: 16, padding: 40 }}>{error}</div>
      </div>
    );
  }

  return (
    <div style={{ ...containerStyle, position: 'relative' }}>
      <style>{`
        .items-scroll::-webkit-scrollbar { width: 6px; }
        .items-scroll::-webkit-scrollbar-track { background: transparent; }
        .items-scroll::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 8px; }
        .items-scroll::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
        .items-scroll { scrollbar-width: thin; scrollbar-color: #d1d5db transparent; }
      `}</style>

      <div style={headerStyle}>
        <h1 style={titleStyle}>Наполнение постов Testline</h1>
        <div style={headerButtonsStyle}>
          {lastUpdate && <span style={lastUpdateStyle}>Обновлено: {lastUpdate.toLocaleTimeString('ru-RU')}</span>}
          <button style={{ ...buttonStyle, background: '#7C3AED' }} onClick={handleOpenAnalytics}>📊 Аналитика</button>
          <button style={{ ...buttonStyle, background: showModelFilter ? '#1E40AF' : '#2563EB' }} onClick={() => setShowModelFilter(!showModelFilter)}>
            {showModelFilter ? 'Скрыть фильтр' : 'Модели'}
          </button>
          <button style={exportButtonStyle} onClick={handleExportAll}>📥 Экспорт</button>
        </div>
      </div>

      {showModelFilter && (
        <div style={filterContainerStyle}>
          {ALL_MODELS.map(model => (
            <label key={model} style={filterCheckboxStyle}>
              <input type="checkbox" checked={selectedModels.includes(model)} onChange={() => handleModelToggle(model)} />
              {model}
            </label>
          ))}
        </div>
      )}

      <div style={totalsRowStyle}>
        {zonesWithTotal.map(zone => (
          <div key={`total-${zone.zoneName}`} style={totalCardStyle}>
            <div style={totalLabelStyle}>{zone.zoneName}</div>
            <div style={totalValueStyle}>{zone.total}</div>
          </div>
        ))}
      </div>

      <div style={kanbanContainerStyle}>
        {zonesWithTotal.map(zone => (
          <div key={zone.zoneName} style={zoneColumnStyle}>
            <div style={zoneTitleStyle}>
              <span>{zone.zoneName}</span>
              <span
                style={zoneTotalBadgeStyle}
                onClick={() => handlePassedTodayClick(zone.zoneName)}
                title={`Прошло за сегодня: ${passedTodayData[zone.zoneName] || 0}. Нажмите для просмотра`}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.background = '#F3F4F6'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = '#FFFFFF'; }}
              >
                {passedTodayData[zone.zoneName] || 0}
              </span>
            </div>
            <div className="items-scroll" style={itemsScrollStyle}>
              {zone.items.length > 0 ? (
                zone.items.map((item, idx) => (
                  <button
                    key={`${zone.zoneName}-${item.label}-${idx}`}
                    style={itemCardStyle(getColorByFirstLetter(item.label))}
                    onClick={() => handleItemClick(zone.zoneName, item.label, item.count)}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                  >
                    <span style={itemLabelStyle}>{item.label}</span>
                    <span style={itemCountStyle}>{item.count}</span>
                  </button>
                ))
              ) : (
                <div style={emptyZoneStyle}>Нет данных</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {selectedItem && (
        <DetailsModal
          zoneName={selectedItem.zoneName}
          label={selectedItem.label}
          count={selectedItem.count}
          details={selectedItem.details}
          onClose={handleCloseModal}
        />
      )}

      {selectedPassedToday && (
        <PassedTodayModal
          zoneName={selectedPassedToday.zoneName}
          uniqueCount={selectedPassedToday.uniqueCount}
          totalRecords={selectedPassedToday.totalRecords}
          details={selectedPassedToday.details}
          onClose={handleClosePassedToday}
        />
      )}

      {showAnalytics && (
        <AnalyticsModal
          data={analyticsData}
          onClose={handleCloseAnalytics}
          onApplyFilter={handleApplyAnalyticsFilter}
          onVinClick={handleVinClick}
        />
      )}

      {selectedVinHistory && (
        <VINHistoryModal
          vin={selectedVinHistory}
          onClose={handleCloseVinHistory}
        />
      )}
    </div>
  );
}