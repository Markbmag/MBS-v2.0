import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';   // для экспорта в Excel

const API_BASE = '';

function getTodayStr() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

function formatDateShort(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}`;
}

function getDayOfWeekShort(dateStr) {
  const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const d = new Date(dateStr);
  return days[d.getDay()];
}

function getDefectColor(value) {
  if (value === 0) return '#00B050';
  if (value <= 4)  return '#92D050';
  if (value <= 8)  return '#FFFF00';
  if (value <= 15) return '#FFC000';
  return '#FF0000';
}

// Модальное окно с VIN и кнопкой экспорта
function VINModal({ defect, vins, loading, onClose }) {
  const [exporting, setExporting] = useState(false);

  if (!defect) return null;

  const handleExport = () => {
    if (vins.length === 0) return;
    setExporting(true);

    // Создаём массив объектов для xlsx (каждый VIN в строке)
    const data = vins.map(vin => ({ VIN: vin }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'VIN');

    // Имя файла: VIN_<MPP>_<дата>.xlsx
    const fileName = `VIN_${defect.MPP.replace(/[^a-zа-яё0-9]/gi, '_')}_${getTodayStr()}.xlsx`;
    XLSX.writeFile(workbook, fileName);

    // Кнопка остаётся неактивной (можно сбросить через таймаут, но пока оставим так)
    setTimeout(() => setExporting(false), 2000);
  };

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={modalContentStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ color: '#FFF', margin: 0 }}>
            VIN для дефекта: {defect.MPP}
          </h3>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>
        {loading ? (
          <div style={{ color: '#D1D5DB' }}>Загрузка...</div>
        ) : vins.length === 0 ? (
          <div style={{ color: '#D1D5DB' }}>Нет данных</div>
        ) : (
          <>
            <div style={{ color: '#D1D5DB', marginBottom: 8 }}>
              Всего уникальных VIN: <b>{vins.length}</b>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting}
              style={{
                ...exportBtnStyle,
                opacity: exporting ? 0.6 : 1,
                cursor: exporting ? 'not-allowed' : 'pointer',
              }}
            >
              {exporting ? 'Выгружается...' : 'Экспорт в Excel'}
            </button>
            <div className="custom-scroll" style={{ maxHeight: '300px', overflowY: 'auto', marginTop: 10 }}>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {vins.map((vin, idx) => (
                  <li key={idx} style={{ padding: '4px 8px', borderBottom: '1px solid #4B5563', color: '#FFF' }}>
                    {vin}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DefectTable({ checkpoint, defects, carsCount, onDefectClick }) {
  const todayStr = getTodayStr();
  const filtered = defects.filter(d => d.CREATION_TIME === todayStr);
  const sorted = [...filtered].sort((a, b) => b.DEFECTS_COUNT - a.DEFECTS_COUNT);

  if (sorted.length === 0) {
    return (
      <div style={{ flex: 1, minWidth: '300px', margin: '0 10px' }}>
        <h3 style={{ color: '#FFF', marginBottom: 8 }}>Дефект ({checkpoint})</h3>
        <div style={{ backgroundColor: '#1F2937', borderRadius: 6, padding: 8, color: '#D1D5DB' }}>
          Нет данных за сегодня
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minWidth: '300px', margin: '0 10px' }}>
      <h3 style={{ color: '#FFF', marginBottom: 8 }}>Дефект ({checkpoint})</h3>
      <div style={{ backgroundColor: '#1F2937', borderRadius: 6, padding: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#FFF', marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {formatDateShort(todayStr)} {getDayOfWeekShort(todayStr)}
          </span>
        </div>
        <div style={{ color: '#D1D5DB', fontSize: 12, marginBottom: 8 }}>
          Кол-во машин: {carsCount}
        </div>
        <div className="custom-scroll" style={{ maxHeight: '500px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', color: '#FFF', fontSize: 12 }}>
            <thead>
              <tr style={{ backgroundColor: '#374151' }}>
                <th style={thStyle}>Дефект</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Шт.</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item, idx) => (
                <tr
                  key={idx}
                  style={{
                    backgroundColor: idx % 2 === 0 ? '#1F2937' : '#111827',
                    cursor: 'pointer',
                  }}
                  onClick={() => onDefectClick(checkpoint, item)}
                >
                  <td style={tdStyle}>{item.MPP}</td>
                  <td
                    style={{
                      ...tdStyle,
                      backgroundColor: getDefectColor(item.DEFECTS_COUNT),
                      color: item.DEFECTS_COUNT > 15 ? '#FFF' : '#000',
                      fontWeight: 600,
                      textAlign: 'center',
                    }}
                  >
                    {item.DEFECTS_COUNT}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function DailyTopPage() {
  const [model, setModel] = useState('ALL');
  const [models, setModels] = useState(['ALL']);
  const [defectType, setDefectType] = useState('default');
  const [shift, setShift] = useState('all');
  const [defectsCP7, setDefectsCP7] = useState([]);
  const [defectsCP8, setDefectsCP8] = useState([]);
  const [carsCount, setCarsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedDefect, setSelectedDefect] = useState(null);
  const [vins, setVins] = useState([]);
  const [vinsLoading, setVinsLoading] = useState(false);

  const todayStr = getTodayStr();

  useEffect(() => {
    setLoading(true);
    setError(null);
    const fetchData = async () => {
      try {
        const buildUrl = (checkpoint) => {
          const params = new URLSearchParams({ checkpoint });
          if (defectType !== 'default') params.append('defectType', defectType);
          params.append('shift', shift);
          return `${API_BASE}/api/daily-top?${params.toString()}`;
        };

        const [cp7Res, cp8Res] = await Promise.all([
          fetch(buildUrl('CP7')).then(r => r.json()),
          fetch(buildUrl('CP8')).then(r => r.json())
        ]);

        if (!Array.isArray(cp7Res) || !Array.isArray(cp8Res)) {
          throw new Error('Ответ сервера не является массивом');
        }

        const allModels = new Set([...cp7Res, ...cp8Res].map(d => d.MODEL));
        setModels(['ALL', ...Array.from(allModels).sort()]);
        setDefectsCP7(cp7Res);
        setDefectsCP8(cp8Res);
      } catch (err) {
        console.error('Ошибка загрузки:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [defectType, shift]);

  useEffect(() => {
    const url =
      model === 'ALL'
        ? `${API_BASE}/api/cars-count?date=${todayStr}`
        : `${API_BASE}/api/cars-count?date=${todayStr}&model=${encodeURIComponent(model)}`;
    fetch(url)
      .then(r => r.json())
      .then(data => setCarsCount(data.CARS_COUNT || 0))
      .catch(() => setCarsCount(0));
  }, [model, todayStr]);

  const handleDefectClick = (checkpoint, defect) => {
    setSelectedDefect({ ...defect, checkpoint });
    setVins([]);
    setVinsLoading(true);

    const defectModel = defect.MODEL || defect.MPP?.split(' ')[0] || '';

    const params = new URLSearchParams({
      checkpoint,
      partName: defect.PART_NAME,
      problemType: defect.PROBLEM_TYPE,
      model: defectModel,
    });
    if (defectType !== 'default') params.append('defectType', defectType);
    if (shift !== 'all') params.append('shift', shift);

    const url = `${API_BASE}/api/daily-top-vins?${params.toString()}`;
    console.log('Запрос VIN:', url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    fetch(url, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
        return res.json();
      })
      .then(data => {
        setVins(Array.isArray(data) ? data : []);
        setVinsLoading(false);
      })
      .catch(err => {
        console.error('Ошибка загрузки VIN:', err);
        setVins([]);
        setVinsLoading(false);
      })
      .finally(() => clearTimeout(timeoutId));
  };

  const closeModal = () => {
    setSelectedDefect(null);
    setVins([]);
  };

  const filterByModel = (defects) =>
    model === 'ALL' ? defects : defects.filter(d => d.MODEL === model);

  const containerStyle = {
    backgroundColor: '#111827',
    minHeight: '100vh',
    padding: 20,
    color: '#FFF',
    fontFamily: 'Segoe UI, Arial, sans-serif',
  };

  if (loading) {
    return <div style={containerStyle}>Загрузка...</div>;
  }

  if (error) {
    return <div style={containerStyle}>Ошибка: {error}</div>;
  }

  return (
    <div style={containerStyle}>
      <h1 style={{ fontSize: 20, marginBottom: 15 }}>Контроль качества — Топ дефектов за сегодня</h1>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, color: '#D1D5DB' }}>Модель:</span>
        <select value={model} onChange={e => setModel(e.target.value)} style={filterSelectStyle}>
          {models.map(m => (
            <option key={m} value={m}>{m === 'ALL' ? 'Все модели' : m}</option>
          ))}
        </select>

        <span style={{ fontSize: 14, color: '#D1D5DB' }}>Тип:</span>
        <select value={defectType} onChange={e => setDefectType(e.target.value)} style={filterSelectStyle}>
          <option value="default">Default</option>
          <option value="offline">Offline</option>
          <option value="online">Online</option>
        </select>

        <span style={{ fontSize: 14, color: '#D1D5DB' }}>Смена:</span>
        <select value={shift} onChange={e => setShift(e.target.value)} style={filterSelectStyle}>
          <option value="all">Сутки</option>
          <option value="day">Дневная (7:50–16:40)</option>
          <option value="night">Вечерняя (16:40–1:30)</option>
        </select>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <DefectTable
          checkpoint="CP7"
          defects={filterByModel(defectsCP7)}
          carsCount={carsCount}
          onDefectClick={handleDefectClick}
        />
        <DefectTable
          checkpoint="CP8"
          defects={filterByModel(defectsCP8)}
          carsCount={carsCount}
          onDefectClick={handleDefectClick}
        />
      </div>

      <VINModal
        defect={selectedDefect}
        vins={vins}
        loading={vinsLoading}
        onClose={closeModal}
      />
    </div>
  );
}

// ==================== СТИЛИ ====================
const modalOverlayStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modalContentStyle = {
  backgroundColor: '#1F2937',
  borderRadius: 8,
  padding: 20,
  maxWidth: '600px',
  width: '90%',
  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
};

const closeBtnStyle = {
  background: 'transparent',
  border: 'none',
  color: '#FFF',
  fontSize: 18,
  cursor: 'pointer',
};

const exportBtnStyle = {
  padding: '8px 16px',
  backgroundColor: '#2563EB',
  color: '#FFF',
  border: 'none',
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 14,
  marginBottom: 8,
};

const filterSelectStyle = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid #4B5563',
  background: '#1F2937',
  color: '#FFF',
  fontSize: 14,
  cursor: 'pointer',
};

const thStyle = {
  padding: '6px 8px',
  textAlign: 'left',
  borderBottom: '1px solid #4B5563',
  fontWeight: 600,
};

const tdStyle = {
  padding: '6px 8px',
  borderBottom: '1px solid #4B5563',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '220px',
};