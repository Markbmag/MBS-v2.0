import React, { useState, useEffect, useRef } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const API_BASE = '';
const PIE_COLORS = ['#10B981', '#EF4444'];
const MAX_PHOTOS_PER_BLOCK = 4;

/* ===================== СТИЛИ ===================== */
const containerStyle = {
  padding: '20px',
  fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
  width: '100%',
  minHeight: '100vh',
  boxSizing: 'border-box',
  backgroundColor: '#F8FAFC',
  display: 'flex',
  flexDirection: 'column',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '20px',
  flexShrink: 0,
  flexWrap: 'wrap',
  gap: '12px',
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
  gap: '8px',
  flexWrap: 'wrap',
};

const filterButtonStyle = (active, activeColor = '#2563EB') => ({
  padding: '10px 22px',
  borderRadius: '12px',
  border: 'none',
  fontWeight: 700,
  fontSize: '1rem',
  background: active ? activeColor : '#FFFFFF',
  color: active ? '#FFFFFF' : '#64748B',
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  transition: 'all 0.2s',
});

const dateSelectStyle = {
  padding: '10px 22px',
  borderRadius: '12px',
  border: 'none',
  fontWeight: 700,
  fontSize: '1rem',
  background: '#FFFFFF',
  color: '#1E293B',
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  outline: 'none',
};

const twoColStyle = {
  display: 'flex',
  gap: '16px',
  flex: 1,
  alignItems: 'flex-start',
};

const columnStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  minWidth: 0,
};

const columnHeaderStyle = (isDark) => ({
  background: isDark ? '#1E293B' : '#FFFFFF',
  color: isDark ? '#FFFFFF' : '#1E293B',
  padding: '14px 20px',
  borderRadius: '12px',
  fontWeight: 900,
  fontSize: '1.4rem',
  textAlign: 'center',
  letterSpacing: '1px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  border: isDark ? '1px solid #1E293B' : '1px solid #E2E8F0',
});

const reportBlockStyle = {
  background: '#FFFFFF',
  borderRadius: '16px',
  padding: '16px',
  boxShadow: '0 4px 16px rgba(0,0,0,0.05)',
  border: '1px solid #F1F5F9',
};

const reportTitleStyle = {
  fontSize: '1.1rem',
  fontWeight: 800,
  color: '#1E293B',
  marginBottom: '10px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const thStyleSmall = {
  padding: '6px 10px',
  textAlign: 'left',
  fontWeight: 700,
  color: '#475569',
  background: '#F8FAFC',
  fontSize: '0.8rem',
  textTransform: 'uppercase',
  borderBottom: '2px solid #E2E8F0',
  position: 'sticky',
  top: 0,
  zIndex: 5,
};

const tdStyleSmall = {
  padding: '6px 10px',
  borderBottom: '1px solid #F1F5F9',
  color: '#1E293B',
  fontSize: '0.85rem',
};

const addPhotoButtonStyle = {
  padding: '8px 14px',
  borderRadius: '8px',
  border: '1px dashed #CBD5E1',
  background: '#F8FAFC',
  color: '#475569',
  fontWeight: 600,
  fontSize: '0.8rem',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  transition: 'all 0.2s',
};

/* ===================== ХЕЛПЕРЫ ===================== */
const toLocalDateStr = (d) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getMoscowTime = () => new Date(Date.now() + 3 * 60 * 60 * 1000);
const todayMoscowStr = () => toLocalDateStr(getMoscowTime());

const nowMoscowStr = () => {
  const d = getMoscowTime();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
};

const getISOWeek = (dateStr) => {
  const d = new Date(dateStr + 'T12:00:00Z');
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
};

const getShiftRange = (dateStr, shiftType) => {
  if (shiftType === 'day') return { start: `${dateStr} 07:50:00`, end: `${dateStr} 16:40:00` };
  if (shiftType === 'night') return { start: `${dateStr} 01:31:00`, end: `${dateStr} 07:50:00` };
  if (shiftType === 'evening') {
    const next = new Date(dateStr + 'T12:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    return { start: `${dateStr} 16:41:00`, end: `${nextStr} 01:30:00` };
  }
  return null;
};

const getShiftsForDate = (dateStr) => {
  const weekNum = getISOWeek(dateStr);
  const isEven = weekNum % 2 === 0;
  const aType = isEven ? 'evening' : 'day';
  const bType = isEven ? 'day' : 'evening';
  return {
    weekNumber: weekNum,
    a: { letter: 'A', type: aType, ...getShiftRange(dateStr, aType) },
    b: { letter: 'B', type: bType, ...getShiftRange(dateStr, bType) },
    c: { letter: 'C', type: 'night', ...getShiftRange(dateStr, 'night') } 
  };
};

const normalizeReport = (reportName, dash) => {
  if (!dash) return { drrPercent: 0, okVins: 0, nokVins: 0, totalVins: 0 };
  if (reportName === 'cpfinal') {
    return {
      drrPercent: dash.drrPercent || 0,
      okVins: dash.okVins || 0,
      nokVins: dash.nokVins || 0,
      totalVins: dash.totalVins || 0,
    };
  }
  return {
    drrPercent: dash.drrPercent || 0,
    okVins: dash.closedVins || 0,
    nokVins: dash.nokVins || ((dash.totalVins || 0) - (dash.closedVins || 0)),
    totalVins: dash.totalVins || 0,
  };
};

const loadAllReportsLive = async (start, end) => {
  const params = new URLSearchParams({ startTime: start, endTime: end });
  const [cp7, cp7top, adas, adasTop, cpfinal, cpfinalTop] = await Promise.all([
    fetch(`${API_BASE}/api/drr-cp7-dashboard?${params}`).then(r => r.json()),
    fetch(`${API_BASE}/api/drr-cp7-top-defects?${params}`).then(r => r.json()),
    fetch(`${API_BASE}/api/drr-tl-dashboard?${params}`).then(r => r.json()),
    fetch(`${API_BASE}/api/drr-tl-top-defects?${params}`).then(r => r.json()),
    fetch(`${API_BASE}/api/drr-cpfinal-dashboard?${params}`).then(r => r.json()),
    fetch(`${API_BASE}/api/drr-cpfinal-top-defects?${params}`).then(r => r.json()),
  ]);
  return {
    cp7: { dash: normalizeReport('cp7', cp7), top: Array.isArray(cp7top) ? cp7top : [] },
    adas: { dash: normalizeReport('adas', adas), top: Array.isArray(adasTop) ? adasTop : [] },
    cpfinal: { dash: normalizeReport('cpfinal', cpfinal), top: Array.isArray(cpfinalTop) ? cpfinalTop : [] },
  };
};

const fetchSnapshotFromList = async (listUrl, detailUrl, dateStr, shiftType) => {
  try {
    const res = await fetch(`${API_BASE}${listUrl}`);
    if (!res.ok) return null;
    const list = await res.json();
    if (!Array.isArray(list)) return null;
    const found = list.find(s => s.shiftDate === dateStr && s.shift === shiftType);
    if (!found) return null;
    const detRes = await fetch(`${API_BASE}${detailUrl}/${found.id}`);
    if (!detRes.ok) return null;
    return await detRes.json();
  } catch {
    return null;
  }
};

const loadAllReportsArchive = async (dateStr, shiftType) => {
  const [cp7, adas, cpfinal] = await Promise.all([
    fetchSnapshotFromList(
      '/api/drr-cp7-snapshots?days=60&filter=all',
      '/api/drr-cp7-snapshot',
      dateStr,
      shiftType
    ),
    fetchSnapshotFromList(
      '/api/drr-tl-snapshots?days=60',
      '/api/drr-tl-snapshot',
      dateStr,
      shiftType
    ),
    fetchSnapshotFromList(
      '/api/drr-cpfinal-snapshots?days=60',
      '/api/drr-cpfinal-snapshot',
      dateStr,
      shiftType
    ),
  ]);

  return {
    cp7: {
      dash: normalizeReport('cp7', cp7),
      top: Array.isArray(cp7?.topDefects) ? cp7.topDefects : [],
    },
    adas: {
      dash: normalizeReport('adas', adas),
      top: Array.isArray(adas?.topDefects) ? adas.topDefects : [],
    },
    cpfinal: {
      dash: normalizeReport('cpfinal', cpfinal),
      top: Array.isArray(cpfinal?.topDefects) ? cpfinal.topDefects : [],
    },
  };
};

const formatDateShort = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
};

const parsePhotoKey = (key) => {
  if (!key) return { date: '', letter: '', checkpoint: '' };
  const parts = String(key).split('_');
  if (parts.length < 3) return { date: parts[0] || '', letter: '', checkpoint: '' };
  return {
    date: parts[0],
    letter: parts[1],
    checkpoint: parts.slice(2).join('_'),
  };
};

const weekKeyOf = (w) => `CW${String(w.weekNumber).padStart(2, '0')} ${w.year}`;

const compressImage = (file, maxWidth = 900) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = reject;
    img.src = ev.target.result;
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

/* ===================== КОМПОНЕНТЫ ===================== */

function PieBlock({ drrPercent, okVins, totalVins }) {
  const safePercent = Number.isFinite(drrPercent) ? drrPercent : 0;
  const data = [
    { name: 'DRR', value: safePercent },
    { name: 'NOK', value: Math.max(0, 100 - safePercent) },
  ];
  return (
    <div style={{ position: 'relative', width: 220, height: 220, flexShrink: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            cx="50%"
            cy="50%"
            innerRadius="72%"
            outerRadius="98%"
            paddingAngle={3}
            stroke="#FFFFFF"
            strokeWidth={3}
          >
            {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => `${v.toFixed(1)}%`} contentStyle={{ fontSize: '1rem' }} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#1E293B', lineHeight: 1 }}>
          {safePercent.toFixed(1)}%
        </div>
        <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 4 }}>
          {okVins}/{totalVins}
        </div>
      </div>
    </div>
  );
}

function DefectsTable({ topDefects, markKeyPrefix, marks, onToggleMark }) {
  if (!topDefects || topDefects.length === 0) {
    return (
      <p style={{ textAlign: 'center', padding: '20px 0', color: '#94A3B8', fontSize: '0.85rem' }}>
        Нет дефектов
      </p>
    );
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={thStyleSmall}>MPP</th>
          <th style={{ ...thStyleSmall, textAlign: 'center', width: 70 }}>Кол-во</th>
        </tr>
      </thead>
      <tbody>
        {topDefects.map((d, i) => {
          const key = `${markKeyPrefix}_${d.mpp}`;
          const marked = !!marks[key];
          return (
            <tr
              key={i}
              onClick={() => onToggleMark && onToggleMark(key)}
              style={{
                cursor: onToggleMark ? 'pointer' : 'default',
                backgroundColor: marked ? '#FEF3C7' : (i % 2 === 0 ? '#FFFFFF' : '#F8FAFC'),
                transition: 'background-color 0.15s',
              }}
              title={onToggleMark ? 'Нажмите, чтобы выделить/снять выделение' : ''}
            >
              <td style={tdStyleSmall}>{d.mpp}</td>
              <td style={{ ...tdStyleSmall, textAlign: 'center', fontWeight: 700, color: i < 3 ? '#DC2626' : '#1E293B' }}>
                {d.defectCount}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PhotoLightbox({ url, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.85)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 5000, padding: 24,
      }}
    >
      <img
        src={url}
        alt="Просмотр"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '95vw', maxHeight: '95vh',
          borderRadius: 12,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6)',
          objectFit: 'contain',
        }}
      />
      <button
        onClick={onClose}
        style={{
          position: 'fixed', top: 20, right: 24,
          width: 44, height: 44, borderRadius: '50%',
          border: 'none',
          background: 'rgba(255,255,255,0.15)',
          color: '#FFFFFF', fontSize: 24,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title="Закрыть (Esc)"
      >×</button>
    </div>
  );
}

function PhotoArea({ photoKey, photos, onPhotosChange }) {
  const fileInputRef = useRef(null);
  const items = photos[photoKey] || [];
  const canAdd = items.length < MAX_PHOTOS_PER_BLOCK;
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);

  const uploadFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      let currentItems = photos[photoKey] || [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        if (currentItems.length >= MAX_PHOTOS_PER_BLOCK) break;
        const dataUrl = await compressImage(file);
        const res = await fetch(`${API_BASE}/api/drr-shift-photos/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photo_key: photoKey, data: dataUrl }),
        });
        if (!res.ok) throw new Error('Ошибка загрузки');
        const json = await res.json();
        currentItems = [
          ...currentItems,
          { id: json.id, url: json.url, mime: 'image/jpeg', uploadedAt: new Date().toISOString() },
        ];
        onPhotosChange(photoKey, currentItems);
      }
    } catch (err) {
      alert('Не удалось загрузить фото: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleFile = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    uploadFiles(files);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    uploadFiles(files);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Удалить фото?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/drr-shift-photos/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Ошибка удаления');
      onPhotosChange(photoKey, (photos[photoKey] || []).filter(it => it.id !== id));
    } catch (err) {
      alert('Не удалось удалить: ' + err.message);
    }
  };

  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: '1px solid #F1F5F9',
        background: dragging ? '#F0F9FF' : 'transparent',
        borderRadius: 8,
        transition: 'background 0.2s',
      }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase' }}>
          Фото ({items.length}/{MAX_PHOTOS_PER_BLOCK})
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!canAdd || uploading}
          style={{ ...addPhotoButtonStyle, opacity: (canAdd && !uploading) ? 1 : 0.4, cursor: (canAdd && !uploading) ? 'pointer' : 'not-allowed' }}
        >
          {uploading ? '⏳ Загрузка...' : '📷 Добавить фото'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleFile}
        />
      </div>

      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {items.map((it) => (
            <div
              key={it.id}
              onClick={() => setLightboxUrl(`${API_BASE}${it.url}`)}
              style={{
                position: 'relative',
                width: 140,
                height: 140,
                borderRadius: 12,
                overflow: 'hidden',
                border: '1px solid #E2E8F0',
                background: '#F1F5F9',
                cursor: 'zoom-in',
                transition: 'transform 0.15s, box-shadow 0.15s',
                boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.03)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)';
              }}
              title="Нажмите для увеличения"
            >
              <img
                src={`${API_BASE}${it.url}`}
                alt="Фото"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(it.id); }}
                title="Удалить фото"
                style={{
                  position: 'absolute', top: 6, right: 6,
                  width: 24, height: 24, borderRadius: '50%',
                  border: 'none',
                  background: 'rgba(220,38,38,0.9)',
                  color: '#FFFFFF',
                  fontWeight: 700, fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {lightboxUrl && (
        <PhotoLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </div>
  );
}

function ReportBlock({
  title, blockData, markKeyPrefix, photoKey, marks, onToggleMark, photos, onPhotosChange, emptyMessage,
}) {
  const isEmpty = !blockData || blockData.dash.totalVins === 0;

  if (isEmpty) {
    return (
      <div style={reportBlockStyle}>
        <div style={reportTitleStyle}>{title}</div>
        <div style={{ padding: '20px 0', textAlign: 'center', color: '#94A3B8', fontSize: '0.9rem' }}>
          {emptyMessage || 'Нет данных'}
        </div>
        <PhotoArea photoKey={photoKey} photos={photos} onPhotosChange={onPhotosChange} />
      </div>
    );
  }

  return (
    <div style={reportBlockStyle}>
      <div style={reportTitleStyle}><span>{title}</span></div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <PieBlock
          drrPercent={blockData.dash.drrPercent}
          okVins={blockData.dash.okVins}
          totalVins={blockData.dash.totalVins}
        />
        <div style={{
          flex: 1, minWidth: 0, height: 320, overflowY: 'auto',
          border: '1px solid #F1F5F9', borderRadius: 8,
        }}>
          <DefectsTable
            topDefects={blockData.top}
            markKeyPrefix={markKeyPrefix}
            marks={marks}
            onToggleMark={onToggleMark}
          />
        </div>
      </div>
      <PhotoArea photoKey={photoKey} photos={photos} onPhotosChange={onPhotosChange} />
    </div>
  );
}

function ShiftColumn({ shiftInfo, columnLabel, isDark, marks, onToggleMark, photos, onPhotosChange, baseDate }) {
  const isEmptyColumn = !shiftInfo || !shiftInfo.started || !shiftInfo.data;
  const letterKey = shiftInfo?.letter || columnLabel;

  return (
    <div style={columnStyle}>
      <div style={columnHeaderStyle(isDark)}>{columnLabel}</div>
      {isEmptyColumn ? (
        <div style={{ ...reportBlockStyle, padding: '40px 20px', textAlign: 'center', color: '#94A3B8' }}>
          Нет данных — смена ещё не началась
        </div>
      ) : (
        <>
          <ReportBlock
            title="DRR CP7"
            blockData={shiftInfo.data.cp7}
            markKeyPrefix={`${baseDate}_${letterKey}_cp7`}
            photoKey={`${baseDate}_${letterKey}_cp7`}
            marks={marks}
            onToggleMark={onToggleMark}
            photos={photos}
            onPhotosChange={onPhotosChange}
          />
          <ReportBlock
            title="DRR ADAS"
            blockData={shiftInfo.data.adas}
            markKeyPrefix={`${baseDate}_${letterKey}_adas`}
            photoKey={`${baseDate}_${letterKey}_adas`}
            marks={marks}
            onToggleMark={onToggleMark}
            photos={photos}
            onPhotosChange={onPhotosChange}
          />
          <ReportBlock
            title="DRR CPFinal"
            blockData={shiftInfo.data.cpfinal}
            markKeyPrefix={`${baseDate}_${letterKey}_cpfinal`}
            photoKey={`${baseDate}_${letterKey}_cpfinal`}
            marks={marks}
            onToggleMark={onToggleMark}
            photos={photos}
            onPhotosChange={onPhotosChange}
          />
        </>
      )}
    </div>
  );
}

/* ===================== НЕДЕЛЬНАЯ АНАЛИТИКА ===================== */

function WeeklyPhotosBlock({ photos, loading, shiftLetter }) {
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const MAX_PHOTOS = 10;

  const filteredPhotos = (
    shiftLetter === 'ALL'
      ? photos
      : photos.filter(p => {
          const parsed = parsePhotoKey(p.photoKey);
          return parsed.letter === shiftLetter;
        })
  ).slice(0, MAX_PHOTOS);

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase' }}>
          Фото периода ({filteredPhotos.length}/{MAX_PHOTOS})
        </span>
        <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Только для просмотра</span>
      </div>

      {loading ? (
        <p style={{ textAlign: 'center', padding: '20px 0', color: '#94A3B8', fontSize: '0.85rem' }}>
          Загрузка фото...
        </p>
      ) : filteredPhotos.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '20px 0', color: '#94A3B8', fontSize: '0.85rem' }}>
          За выбранный период фото не прикреплено
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {filteredPhotos.map((it) => {
            const parsed = parsePhotoKey(it.photoKey);
            const dateLabel = parsed.date ? formatDateShort(parsed.date) : '';
            const shiftLabel = parsed.letter === 'ALL' ? 'сутки' : parsed.letter ? `смена ${parsed.letter}` : '';
            return (
              <div
                key={it.id}
                onClick={() => setLightboxUrl(`${API_BASE}${it.url}`)}
                style={{
                  position: 'relative',
                  width: 140, height: 140, borderRadius: 12,
                  overflow: 'hidden', border: '1px solid #E2E8F0',
                  background: '#F1F5F9', cursor: 'zoom-in',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.03)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.12)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)';
                }}
              >
                <img
                  src={`${API_BASE}${it.url}`}
                  alt="Фото"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  padding: '4px 8px',
                  background: 'linear-gradient(to top, rgba(15,23,42,0.9), rgba(15,23,42,0))',
                  color: '#FFFFFF', fontSize: '0.7rem', fontWeight: 700,
                  pointerEvents: 'none', lineHeight: 1.2,
                }}>
                  <div>{dateLabel}</div>
                  <div style={{ opacity: 0.8, fontWeight: 500 }}>{shiftLabel}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lightboxUrl && (
        <PhotoLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </div>
  );
}

function WeeklyCheckpointBlock({ type, title, periodLabel, weeks, shiftLetter, filterShortage }) {
  const [matrix, setMatrix] = useState({ weeks: [], rows: [], shortageCount: 0 });
  const [loadingTop, setLoadingTop] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  const weekKey = weeks.map(w => w.weekStart).join('|');

  const periodTotalVins = weeks.reduce((s, w) => s + (w.totalVins || 0), 0);
  const periodClosedVins = weeks.reduce((s, w) => s + (w.closedVins || 0), 0);
  
  // Логика "Без shortage": знаменатель не меняется, а числитель (OK) увеличивается на кол-во shortage
  const shortage = matrix.shortageCount || 0;
  const adjustedClosedVins = periodClosedVins + (filterShortage ? shortage : 0);
  
  const avgDrr = periodTotalVins > 0
    ? +((adjustedClosedVins / periodTotalVins) * 100).toFixed(1)
    : 0;

  useEffect(() => {
    if (weeks.length === 0) {
      setMatrix({ weeks: [], rows: [], shortageCount: 0 });
      return;
    }
    setLoadingTop(true);

    const endpointMap = {
      cp7: '/api/drr-cp7-top-defects',
      adas: '/api/drr-tl-top-defects',
      cpfinal: '/api/drr-cpfinal-top-defects',
    };
    const endpoint = endpointMap[type];

    // ФОРМИРУЕМ ЗАПРОСЫ ПО ДНЯМ С УЧЕТОМ СМЕНЫ
    const requests = [];
    weeks.forEach(w => {
      for (let i = 0; i < 7; i++) {
        const d = new Date(w.weekStart + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + i);
        const dayStr = d.toISOString().split('T')[0]; // YYYY-MM-DD

        let startTime, endTime;
        if (shiftLetter === 'ALL') {
          startTime = `${dayStr} 00:00:00`;
          endTime = `${dayStr} 23:59:59`;
        } else {
          const shifts = getShiftsForDate(dayStr);
          const target = shiftLetter === 'A' ? shifts.a : shiftLetter === 'B' ? shifts.b : shifts.c;
          if (target) {
            startTime = target.start;
            endTime = target.end;
          } else {
            continue; // Пропускаем, если вдруг смена не определилась
          }
        }

        const params = new URLSearchParams({ startTime, endTime });
        requests.push(
          fetch(`${API_BASE}${endpoint}?${params}`)
            .then(r => r.json())
            .then(arr => ({ week: w, list: Array.isArray(arr) ? arr : [] }))
            .catch(() => ({ week: w, list: [] }))
        );
      }
    });

    Promise.all(requests)
      .then(results => {
        const mppMap = new Map();
        let localShortageCount = 0;

        results.forEach(({ week, list }) => {
          const key = weekKeyOf(week);
          list.forEach(item => {
            // Проверяем на "отсутствие"
            const isShortage = item.mpp && item.mpp.toLowerCase().includes('отсутствие');
            
            if (isShortage) {
              localShortageCount += item.defectCount;
              if (filterShortage) return; // Пропускаем добавление в таблицу, если включен фильтр
            }

            if (!mppMap.has(item.mpp)) mppMap.set(item.mpp, { mpp: item.mpp, counts: {} });
            // Суммируем дефекты за все дни этой недели
            mppMap.get(item.mpp).counts[key] = (mppMap.get(item.mpp).counts[key] || 0) + item.defectCount;
          });
        });
        
        const rows = Array.from(mppMap.values())
          .map(r => ({ ...r, total: Object.values(r.counts).reduce((s, v) => s + v, 0) }))
          .sort((a, b) => b.total - a.total);

        const weeksOrder = weeks.map(w => ({
          key: weekKeyOf(w),
          label: `CW${w.weekNumber}`,
          year: w.year,
        }));

        setMatrix({ weeks: weeksOrder, rows, shortageCount: localShortageCount });
      })
      .finally(() => setLoadingTop(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, weekKey, shiftLetter, filterShortage]);

  useEffect(() => {
    if (weeks.length === 0) {
      setPhotos([]);
      return;
    }
    const weekStart = weeks[0].weekStart;
    const weekEnd = weeks[weeks.length - 1].weekEnd;
    const params = new URLSearchParams({ checkpoint: type, weekStart, weekEnd, limit: 60 });
    setLoadingPhotos(true);
    fetch(`${API_BASE}/api/drr-weekly-photos?${params}`)
      .then(r => r.json())
      .then(json => setPhotos(json.photos || []))
      .catch(() => setPhotos([]))
      .finally(() => setLoadingPhotos(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, weekKey]);

  return (
    <div style={reportBlockStyle}>
      <div style={reportTitleStyle}>
        <span>{title} — {periodLabel}</span>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <PieBlock drrPercent={avgDrr} okVins={adjustedClosedVins} totalVins={periodTotalVins} />

        <div style={{
          flex: 1, minWidth: 0, height: 320, overflow: 'auto',
          border: '1px solid #F1F5F9', borderRadius: 8,
        }}>
          {loadingTop ? (
            <p style={{ textAlign: 'center', padding: '20px 0', color: '#94A3B8', fontSize: '0.85rem' }}>Загрузка...</p>
          ) : matrix.rows.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '20px 0', color: '#94A3B8', fontSize: '0.85rem' }}>Нет данных</p>
          ) : matrix.weeks.length === 1 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyleSmall}>MPP</th>
                  <th style={{ ...thStyleSmall, textAlign: 'center', width: 70 }}>Кол-во</th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row, i) => (
                  <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                    <td style={tdStyleSmall}>{row.mpp}</td>
                    <td style={{ ...tdStyleSmall, textAlign: 'center', fontWeight: 700, color: i < 3 ? '#DC2626' : '#1E293B' }}>
                      {row.counts[matrix.weeks[0].key] || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th style={thStyleSmall}>MPP</th>
                  {matrix.weeks.map(w => (
                    <th key={w.key} style={{ ...thStyleSmall, textAlign: 'center', width: 55, padding: '6px 4px' }}>
                      {w.label}
                    </th>
                  ))}
                  <th style={{ ...thStyleSmall, textAlign: 'center', width: 65 }}>Всего</th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row, i) => (
                  <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                    <td style={{ ...tdStyleSmall, fontSize: '0.8rem' }}>{row.mpp}</td>
                    {matrix.weeks.map(w => (
                      <td key={w.key} style={{ ...tdStyleSmall, textAlign: 'center', padding: '6px 4px' }}>
                        {row.counts[w.key] || ''}
                      </td>
                    ))}
                    <td style={{ ...tdStyleSmall, textAlign: 'center', fontWeight: 700, color: i < 3 ? '#DC2626' : '#1E293B' }}>
                      {row.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <WeeklyPhotosBlock photos={photos} loading={loadingPhotos} shiftLetter={shiftLetter} />
    </div>
  );
}

function WeeklyAnalyticsView() {
  const [weeksList, setWeeksList] = useState([]);
  
  const [cp7Data, setCp7Data] = useState([]);
  const [adasData, setAdasData] = useState([]);
  const [cpFinalData, setCpFinalData] = useState([]);

  const [cp7DataA, setCp7DataA] = useState([]);
  const [adasDataA, setAdasDataA] = useState([]);
  const [cpFinalDataA, setCpFinalDataA] = useState([]);

  const [cp7DataB, setCp7DataB] = useState([]);
  const [adasDataB, setAdasDataB] = useState([]);
  const [cpFinalDataB, setCpFinalDataB] = useState([]);

  const [loading, setLoading] = useState(false);
  const [viewType, setViewType] = useState('all'); // 'all' | 'shifts'
  
  // Стейт для кнопки "Без shortage"
  const [filterShortage, setFilterShortage] = useState(false);

  const [fromWeekStart, setFromWeekStart] = useState('');
  const [toWeekStart, setToWeekStart] = useState('');

  useEffect(() => {
    setLoading(true);
    if (viewType === 'all') {
      const q = `weeks=52&shiftLetter=ALL`;
      Promise.all([
        fetch(`${API_BASE}/api/drr-weekly-analytics/cp7?${q}`).then(r => r.json()),
        fetch(`${API_BASE}/api/drr-weekly-analytics/adas?${q}`).then(r => r.json()),
        fetch(`${API_BASE}/api/drr-weekly-analytics/cpfinal?${q}`).then(r => r.json()),
      ])
        .then(([cp7, adas, cpfinal]) => {
          const weeks = cp7.data || [];
          setWeeksList(weeks);
          setCp7Data(cp7.data || []);
          setAdasData(adas.data || []);
          setCpFinalData(cpfinal.data || []);

          if (weeks.length > 0) {
            const lastStart = weeks[weeks.length - 1].weekStart;
            setFromWeekStart(lastStart);
            setToWeekStart(lastStart);
          } else {
            setFromWeekStart('');
            setToWeekStart('');
          }
        })
        .catch(err => console.error('Ошибка загрузки недель:', err))
        .finally(() => setLoading(false));
    } else {
      const qa = `weeks=52&shiftLetter=A`;
      const qb = `weeks=52&shiftLetter=B`;
      Promise.all([
        fetch(`${API_BASE}/api/drr-weekly-analytics/cp7?${qa}`).then(r => r.json()),
        fetch(`${API_BASE}/api/drr-weekly-analytics/adas?${qa}`).then(r => r.json()),
        fetch(`${API_BASE}/api/drr-weekly-analytics/cpfinal?${qa}`).then(r => r.json()),
        fetch(`${API_BASE}/api/drr-weekly-analytics/cp7?${qb}`).then(r => r.json()),
        fetch(`${API_BASE}/api/drr-weekly-analytics/adas?${qb}`).then(r => r.json()),
        fetch(`${API_BASE}/api/drr-weekly-analytics/cpfinal?${qb}`).then(r => r.json()),
      ])
        .then(([cp7A, adasA, cpFinalA, cp7B, adasB, cpFinalB]) => {
          const weeks = cp7A.data || [];
          setWeeksList(weeks);
          
          setCp7DataA(cp7A.data || []);
          setAdasDataA(adasA.data || []);
          setCpFinalDataA(cpFinalA.data || []);

          setCp7DataB(cp7B.data || []);
          setAdasDataB(adasB.data || []);
          setCpFinalDataB(cpFinalB.data || []);

          if (weeks.length > 0) {
            const lastStart = weeks[weeks.length - 1].weekStart;
            setFromWeekStart(lastStart);
            setToWeekStart(lastStart);
          } else {
            setFromWeekStart('');
            setToWeekStart('');
          }
        })
        .catch(err => console.error('Ошибка загрузки недель:', err))
        .finally(() => setLoading(false));
    }
  }, [viewType]);

  const fromIdx = weeksList.findIndex(w => w.weekStart === fromWeekStart);
  const toIdx = weeksList.findIndex(w => w.weekStart === toWeekStart);
  const safeFrom = Math.min(fromIdx, toIdx);
  const safeTo = Math.max(fromIdx, toIdx);

  const selectedWeeks = (safeFrom >= 0 && safeTo >= 0 && safeTo >= safeFrom)
    ? weeksList.slice(safeFrom, safeTo + 1)
    : (weeksList.length > 0 ? [weeksList[weeksList.length - 1]] : []);

  const selectedWeekStartsSet = new Set(selectedWeeks.map(w => w.weekStart));
  const filterByWeeks = (arr) => arr.filter(w => selectedWeekStartsSet.has(w.weekStart));

  const cp7Filtered = filterByWeeks(cp7Data);
  const adasFiltered = filterByWeeks(adasData);
  const cpFinalFiltered = filterByWeeks(cpFinalData);

  const cp7FilteredA = filterByWeeks(cp7DataA);
  const adasFilteredA = filterByWeeks(adasDataA);
  const cpFinalFilteredA = filterByWeeks(cpFinalDataA);

  const cp7FilteredB = filterByWeeks(cp7DataB);
  const adasFilteredB = filterByWeeks(adasDataB);
  const cpFinalFilteredB = filterByWeeks(cpFinalDataB);

  const periodLabel = selectedWeeks.length === 0
    ? '—'
    : selectedWeeks.length === 1
      ? `CW${selectedWeeks[0].weekNumber} ${selectedWeeks[0].year}`
      : `CW${selectedWeeks[0].weekNumber} ${selectedWeeks[0].year} – CW${selectedWeeks[selectedWeeks.length - 1].weekNumber} ${selectedWeeks[selectedWeeks.length - 1].year}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...reportBlockStyle, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        
        <div style={{ display: 'flex', gap: 8 }}>
          <button 
            style={filterButtonStyle(viewType === 'all', '#2563EB')} 
            onClick={() => setViewType('all')}
          >
            Сутки
          </button>
          <button 
            style={filterButtonStyle(viewType === 'shifts', '#7C3AED')} 
            onClick={() => setViewType('shifts')}
          >
            Смены
          </button>
          
          <button 
            style={{
              ...filterButtonStyle(filterShortage, '#EF4444'),
              border: filterShortage ? 'none' : '1px solid #EF4444',
              color: filterShortage ? '#FFFFFF' : '#EF4444',
              background: filterShortage ? '#EF4444' : '#FFFFFF'
            }} 
            onClick={() => setFilterShortage(!filterShortage)}
            title="Убрать дефекты 'Отсутствие' из таблицы (влияет на расчет DRR)"
          >
            🚫 Без shortage
          </button>
        </div>

        <label style={{ fontSize: '1rem', fontWeight: 700, color: '#475569', display: 'flex', alignItems: 'center', gap: 8 }}>
          С недели:
          <select value={fromWeekStart} onChange={(e) => setFromWeekStart(e.target.value)} style={{ ...dateSelectStyle, padding: '8px 14px', minWidth: 220 }} disabled={weeksList.length === 0}>
            {weeksList.length === 0 && <option value="">Нет данных</option>}
            {weeksList.map(w => (
              <option key={w.weekStart} value={w.weekStart}>
                CW{w.weekNumber} {w.year} ({formatDateShort(w.weekStart)})
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: '1rem', fontWeight: 700, color: '#475569', display: 'flex', alignItems: 'center', gap: 8 }}>
          По неделю:
          <select value={toWeekStart} onChange={(e) => setToWeekStart(e.target.value)} style={{ ...dateSelectStyle, padding: '8px 14px', minWidth: 220 }} disabled={weeksList.length === 0}>
            {weeksList.length === 0 && <option value="">Нет данных</option>}
            {weeksList.map(w => (
              <option key={w.weekStart} value={w.weekStart}>
                CW{w.weekNumber} {w.year} ({formatDateShort(w.weekStart)})
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748B', fontSize: '1.2rem' }}>Загрузка...</div>
      ) : selectedWeeks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#94A3B8', fontSize: '1.2rem' }}>Нет данных</div>
      ) : (
        viewType === 'all' ? (
          <>
            <WeeklyCheckpointBlock type="cp7" title="DRR CP7" periodLabel={periodLabel} weeks={cp7Filtered} shiftLetter="ALL" filterShortage={filterShortage} />
            <WeeklyCheckpointBlock type="adas" title="DRR ADAS" periodLabel={periodLabel} weeks={adasFiltered} shiftLetter="ALL" filterShortage={filterShortage} />
            <WeeklyCheckpointBlock type="cpfinal" title="DRR CPFinal" periodLabel={periodLabel} weeks={cpFinalFiltered} shiftLetter="ALL" filterShortage={filterShortage} />
          </>
        ) : (
          <div style={twoColStyle}>
            <div style={columnStyle}>
              <div style={columnHeaderStyle(false)}>СМЕНА A</div>
              <WeeklyCheckpointBlock type="cp7" title="DRR CP7" periodLabel={periodLabel} weeks={cp7FilteredA} shiftLetter="A" filterShortage={filterShortage} />
              <WeeklyCheckpointBlock type="adas" title="DRR ADAS" periodLabel={periodLabel} weeks={adasFilteredA} shiftLetter="A" filterShortage={filterShortage} />
              <WeeklyCheckpointBlock type="cpfinal" title="DRR CPFinal" periodLabel={periodLabel} weeks={cpFinalFilteredA} shiftLetter="A" filterShortage={filterShortage} />
            </div>
            <div style={columnStyle}>
              <div style={columnHeaderStyle(true)}>СМЕНА B</div>
              <WeeklyCheckpointBlock type="cp7" title="DRR CP7" periodLabel={periodLabel} weeks={cp7FilteredB} shiftLetter="B" filterShortage={filterShortage} />
              <WeeklyCheckpointBlock type="adas" title="DRR ADAS" periodLabel={periodLabel} weeks={adasFilteredB} shiftLetter="B" filterShortage={filterShortage} />
              <WeeklyCheckpointBlock type="cpfinal" title="DRR CPFinal" periodLabel={periodLabel} weeks={cpFinalFilteredB} shiftLetter="B" filterShortage={filterShortage} />
            </div>
          </div>
        )
      )}
    </div>
  );
}

/* ===================== ГЛАВНЫЙ КОМПОНЕНТ ===================== */
export default function DrrShiftDashboardPage() {
  const [pageMode, setPageMode] = useState('shift');

  const [periodMode, setPeriodMode] = useState('live');
  const [selectedDate, setSelectedDate] = useState(todayMoscowStr());
  const [viewType, setViewType] = useState('shifts');

  const [shiftData, setShiftData] = useState({ a: null, b: null });
  const [allData, setAllData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [marks, setMarks] = useState({});
  const [photos, setPhotos] = useState({});

  const loadMarks = async (baseDate) => {
    try {
      const res = await fetch(`${API_BASE}/api/drr-shift-marks?prefix=${encodeURIComponent(baseDate + '_')}`);
      if (!res.ok) return;
      const list = await res.json();
      const map = {};
      list.forEach(k => { map[k] = true; });
      setMarks(map);
    } catch (err) {
      console.error('Ошибка загрузки меток:', err.message);
    }
  };

  const onToggleMark = async (key) => {
    setMarks(prev => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
    try {
      await fetch(`${API_BASE}/api/drr-shift-marks/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark_key: key }),
      });
    } catch (err) {
      console.error('Ошибка сохранения метки:', err.message);
    }
  };

  const onPhotosChange = (key, newItems) => {
    setPhotos(prev => ({ ...prev, [key]: newItems }));
  };

  const loadPhotos = async (baseDate) => {
    try {
      const res = await fetch(`${API_BASE}/api/drr-shift-photos/all?prefix=${encodeURIComponent(baseDate + '_')}`);
      if (!res.ok) return;
      const grouped = await res.json();
      setPhotos(grouped || {});
    } catch (err) {
      console.error('Ошибка загрузки фото:', err.message);
    }
  };

  useEffect(() => {
    if (pageMode !== 'shift') return;
    const bd = periodMode === 'live' ? todayMoscowStr() : selectedDate;
    loadMarks(bd);
    loadPhotos(bd);
  }, [periodMode, selectedDate, pageMode]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const baseDate = periodMode === 'live' ? todayMoscowStr() : selectedDate;

      if (viewType === 'all') {
        let data;
        if (periodMode === 'archive') {
          data = await loadAllReportsArchive(baseDate, 'all');
        } else {
          const start = `${baseDate} 00:00:00`;
          const end = `${baseDate} 23:59:59`;
          data = await loadAllReportsLive(start, end);
        }
        setAllData({ date: baseDate, ...data });
      } else {
        const shifts = getShiftsForDate(baseDate);
        let aData = null;
        let bData = null;

        if (periodMode === 'archive') {
          const [a, b] = await Promise.all([
            shifts.a.type ? loadAllReportsArchive(baseDate, shifts.a.type) : Promise.resolve(null),
            shifts.b.type ? loadAllReportsArchive(baseDate, shifts.b.type) : Promise.resolve(null),
          ]);
          aData = a;
          bData = b;
        } else {
          const now = nowMoscowStr();
          const aStarted = now >= shifts.a.start;
          const bStarted = now >= shifts.b.start;

          [aData, bData] = await Promise.all([
            aStarted ? loadAllReportsLive(shifts.a.start, shifts.a.end) : Promise.resolve(null),
            bStarted ? loadAllReportsLive(shifts.b.start, shifts.b.end) : Promise.resolve(null),
          ]);
        }

        setShiftData({
          a: { ...shifts.a, started: periodMode === 'archive' ? !!aData : (nowMoscowStr() >= shifts.a.start), data: aData },
          b: { ...shifts.b, started: periodMode === 'archive' ? !!bData : (nowMoscowStr() >= shifts.b.start), data: bData },
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (pageMode !== 'shift') return;
    loadData();
  }, [periodMode, selectedDate, viewType, pageMode]);

  useEffect(() => {
    if (pageMode !== 'shift' || periodMode !== 'live') return;
    const id = setInterval(loadData, 60000);
    return () => clearInterval(id);
  }, [periodMode, viewType, pageMode]);

  const dateOptions = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(getMoscowTime());
    d.setUTCDate(d.getUTCDate() - i);
    dateOptions.push(toLocalDateStr(d));
  }

  const baseDate = periodMode === 'live' ? todayMoscowStr() : selectedDate;

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>DRR Shift Dashboard</h1>

        <div style={filterGroupStyle}>
          <button style={filterButtonStyle(pageMode === 'shift', '#2563EB')} onClick={() => setPageMode('shift')}>Смены</button>
          <button style={filterButtonStyle(pageMode === 'weekly', '#10B981')} onClick={() => setPageMode('weekly')}>📊 Недельная аналитика</button>

          {pageMode === 'shift' && (
            <>
              <div style={{ width: 1, height: 32, background: '#E2E8F0', margin: '0 4px' }} />

              <button style={filterButtonStyle(periodMode === 'live', '#2563EB')} onClick={() => setPeriodMode('live')}>Live</button>
              <button style={filterButtonStyle(periodMode === 'archive', '#2563EB')} onClick={() => setPeriodMode('archive')}>Архив</button>

              {periodMode === 'archive' && (
                <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={dateSelectStyle}>
                  {dateOptions.map(d => (
                    <option key={d} value={d}>{formatDateShort(d)}</option>
                  ))}
                </select>
              )}

              <div style={{ width: 1, height: 32, background: '#E2E8F0', margin: '0 4px' }} />

              <button style={filterButtonStyle(viewType === 'shifts', '#7C3AED')} onClick={() => setViewType('shifts')}>Смены A / B</button>
              <button style={filterButtonStyle(viewType === 'all', '#6B7280')} onClick={() => setViewType('all')}>Сутки</button>
            </>
          )}
        </div>
      </div>

      {pageMode === 'weekly' && <WeeklyAnalyticsView />}

      {pageMode === 'shift' && (
        <>
          {loading ? (
            <div style={{ fontSize: '1.5rem', textAlign: 'center', padding: '60px', color: '#64748B' }}>Загрузка данных...</div>
          ) : error ? (
            <div style={{ fontSize: '1.5rem', textAlign: 'center', padding: '60px', color: '#DC2626' }}>❌ {error}</div>
          ) : viewType === 'all' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {allData && (
                <>
                  <ReportBlock
                    title="DRR CP7"
                    blockData={allData.cp7}
                    markKeyPrefix={`${allData.date}_ALL_cp7`}
                    photoKey={`${allData.date}_ALL_cp7`}
                    marks={marks}
                    onToggleMark={onToggleMark}
                    photos={photos}
                    onPhotosChange={onPhotosChange}
                  />
                  <ReportBlock
                    title="DRR ADAS"
                    blockData={allData.adas}
                    markKeyPrefix={`${allData.date}_ALL_adas`}
                    photoKey={`${allData.date}_ALL_adas`}
                    marks={marks}
                    onToggleMark={onToggleMark}
                    photos={photos}
                    onPhotosChange={onPhotosChange}
                  />
                  <ReportBlock
                    title="DRR CPFinal"
                    blockData={allData.cpfinal}
                    markKeyPrefix={`${allData.date}_ALL_cpfinal`}
                    photoKey={`${allData.date}_ALL_cpfinal`}
                    marks={marks}
                    onToggleMark={onToggleMark}
                    photos={photos}
                    onPhotosChange={onPhotosChange}
                  />
                </>
              )}
            </div>
          ) : (
            <div style={twoColStyle}>
              <ShiftColumn
                shiftInfo={shiftData.a}
                columnLabel="СМЕНА A"
                isDark={false}
                marks={marks}
                onToggleMark={onToggleMark}
                photos={photos}
                onPhotosChange={onPhotosChange}
                baseDate={baseDate}
              />
              <ShiftColumn
                shiftInfo={shiftData.b}
                columnLabel="СМЕНА B"
                isDark={true}
                marks={marks}
                onToggleMark={onToggleMark}
                photos={photos}
                onPhotosChange={onPhotosChange}
                baseDate={baseDate}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}