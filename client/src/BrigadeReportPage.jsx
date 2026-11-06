import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList
} from 'recharts';
import * as XLSX from 'xlsx';

const API_BASE = '';

/* ===================== БРЕНДБУК ===================== */
const BRAND = {
  bg: '#FFFFFF',
  cardBg: '#FFFFFF',
  primary: '#2563EB',
  accent: '#F59E0B',
  text: '#1E293B',
  textSecondary: '#64748B',
  border: '#E2E8F0',
  shadow: '0 4px 12px rgba(0,0,0,0.04)',
  radius: 16,
  radiusSmall: 8,
  fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
};

/* ===================== ОБЩИЕ СТИЛИ ===================== */
const containerStyle = {
  padding: '20px',
  fontFamily: BRAND.fontFamily,
  width: '100%',
  height: '100vh',
  boxSizing: 'border-box',
  backgroundColor: BRAND.bg,
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
  gap: '10px',
};

const titleStyle = {
  fontSize: '2.5rem',
  fontWeight: 900,
  color: BRAND.text,
  margin: 0,
};

const tabBarStyle = {
  display: 'flex',
  gap: '6px',
  background: '#E2E8F0',
  borderRadius: 12,
  padding: '6px',
  width: 'fit-content',
  flexWrap: 'wrap',
};

const tabStyle = (active) => ({
  padding: '10px 28px',
  borderRadius: 10,
  border: 'none',
  fontWeight: 700,
  fontSize: '1.4rem',
  background: active ? '#FFFFFF' : 'transparent',
  color: active ? BRAND.text : BRAND.textSecondary,
  cursor: 'pointer',
  boxShadow: active ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
  transition: 'all 0.2s',
});

const subTabStyle = (active) => ({
  padding: '8px 20px',
  borderRadius: 8,
  border: 'none',
  fontWeight: 600,
  fontSize: '1.2rem',
  background: active ? BRAND.primary : '#E2E8F0',
  color: active ? '#FFFFFF' : BRAND.textSecondary,
  cursor: 'pointer',
  transition: 'all 0.2s',
});

const cardStyle = {
  backgroundColor: BRAND.cardBg,
  borderRadius: BRAND.radius,
  padding: 20,
  boxShadow: BRAND.shadow,
  border: `1px solid ${BRAND.border}`,
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};

const inputStyle = {
  padding: '8px 12px',
  borderRadius: BRAND.radiusSmall,
  border: `1px solid ${BRAND.border}`,
  fontSize: 14,
  background: '#F9FAFB',
  outline: 'none',
};

const buttonStyle = {
  padding: '8px 20px',
  borderRadius: BRAND.radiusSmall,
  border: 'none',
  background: BRAND.primary,
  color: 'white',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};

const thStyle = {
  padding: '14px 16px',
  textAlign: 'left',
  fontWeight: 700,
  color: '#FFFFFF',
  background: BRAND.primary,
  fontSize: '1.1rem',
  textTransform: 'uppercase',
  position: 'sticky',
  top: 0,
  zIndex: 10,
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '10px 16px',
  borderBottom: `1px solid ${BRAND.border}`,
  color: BRAND.text,
  fontSize: '1rem',
};

const modalOverlayStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(15, 23, 42, 0.7)',
  backdropFilter: 'blur(6px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2000,
  padding: '20px',
};

const modalStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: '24px',
  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
  width: '100%',
  maxWidth: '480px',
  maxHeight: '90vh',
  overflowY: 'auto',
  padding: '32px',
  fontFamily: BRAND.fontFamily,
  color: BRAND.text,
  boxSizing: 'border-box',
  border: '1px solid rgba(255,255,255,0.5)',
};

const wideModalStyle = {
  ...modalStyle,
  maxWidth: '720px',
};

const ALL_MODELS_VALUE = '__ALL_MODELS__';

/* ===================== ХЕЛПЕРЫ ДЛЯ ДАТ И ЦВЕТА ===================== */
function toLocalDateStr(d) {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getTodayStr() {
  return toLocalDateStr(new Date());
}

function getDefectColor(value) {
  if (value === 0) return '#00B050';
  if (value <= 4)  return '#92D050';
  if (value <= 8)  return '#FFFF00';
  if (value <= 15) return '#FFC000';
  return '#FF0000';
}

function getDPUColor(value) {
  if (value === 0) return '#00B050';
  if (value <= 100) return '#92D050';
  if (value <= 200) return '#FFFF00';
  if (value <= 300) return '#FFC000';
  return '#FF0000';
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function formatDateDDMM(date) {
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getDayOfWeekFromDate(date) {
  return ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][new Date(date).getDay()];
}

/* ===================== СТИЛИ ДЛЯ MPP-ТАБЛИЦЫ ===================== */
const mppTableStyles = {
  dark: {
    background: '#1F2937',
    padding: '6px 8px',
    fontWeight: 600,
    border: '1px solid #4B5563',
    display: 'flex',
    alignItems: 'center',
    fontSize: 11,
    color: '#FFF',
  },
  hdr: {
    background: '#374151',
    padding: '4px 3px',
    fontWeight: 600,
    border: '1px solid #4B5563',
    textAlign: 'center',
    fontSize: 11,
    color: '#FFF',
  },
  name: {
    background: '#1F2937',
    padding: '6px 8px',
    fontWeight: 600,
    border: '1px solid #4B5563',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontSize: 12,
    color: '#FFF',
  },
  val: {
    padding: '6px 4px',
    border: '1px solid #4B5563',
    textAlign: 'center',
    fontWeight: 600,
    fontSize: 13,
    whiteSpace: 'nowrap',
  },
  total: {
    padding: '6px 4px',
    border: '1px solid #4B5563',
    textAlign: 'center',
    fontWeight: 700,
    fontSize: 13,
    whiteSpace: 'nowrap',
  },
  noteCell: {
    background: '#1F2937',
    padding: '2px 4px',
    border: '1px solid #4B5563',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  noteSelect: {
    width: '100%',
    padding: '2px 4px',
    borderRadius: 4,
    border: '1px solid #4B5563',
    background: '#374151',
    color: '#FFF',
    fontSize: 11,
    cursor: 'pointer',
  },
  noteDate: {
    fontSize: 9,
    color: '#9CA3AF',
    textAlign: 'center',
  },
};

/* ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ СМЕН ===================== */
const getMoscowTime = () => new Date(Date.now() + 3 * 60 * 60 * 1000);
const getMoscowMinutes = () => {
  const moscow = getMoscowTime();
  return moscow.getUTCHours() * 60 + moscow.getUTCMinutes();
};
const getWeekNumberMoscow = (date) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};

const getShiftTimeRange = (shiftFilter, baseDate) => {
  if (!baseDate) return null;

  let dateObj;
  if (typeof baseDate === 'string') {
    dateObj = new Date(`${baseDate}T12:00:00`);
  } else {
    dateObj = new Date(baseDate);
  }
  if (isNaN(dateObj.getTime())) return null;

  const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;

  if (shiftFilter === 'all') {
    return { start: `${dateStr} 00:00:00`, end: `${dateStr} 23:59:59` };
  }

  const weekNumber = getWeekNumber(dateObj);
  const isEvenWeek = weekNumber % 2 === 0;

  let shiftType;
  if (shiftFilter === 'C') {
    shiftType = 'night';
  } else if (shiftFilter === 'A') {
    shiftType = isEvenWeek ? 'evening' : 'day';
  } else if (shiftFilter === 'B') {
    shiftType = isEvenWeek ? 'day' : 'evening';
  } else {
    return { start: `${dateStr} 00:00:00`, end: `${dateStr} 23:59:59` };
  }

  if (shiftType === 'night') {
    return { start: `${dateStr} 01:31:00`, end: `${dateStr} 07:50:00` };
  }
  if (shiftType === 'day') {
    return { start: `${dateStr} 07:50:00`, end: `${dateStr} 16:40:00` };
  }
  if (shiftType === 'evening') {
    const nextDay = new Date(dateObj);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
    return { start: `${dateStr} 16:41:00`, end: `${nextStr} 01:30:00` };
  }

  return null;
};

/* ===================== МУЛЬТИСЕЛЕКТ ===================== */
function MultiSelect({ options, selected, onChange, placeholder }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const nonAllOptions = options.filter(o => o !== 'ALL');
  const allSelected = selected.length === nonAllOptions.length && nonAllOptions.length > 0;

  const handleToggle = (value) => {
    if (value === 'ALL') {
      if (allSelected) {
        onChange([]);
      } else {
        onChange(nonAllOptions);
      }
    } else {
      const updated = selected.includes(value)
        ? selected.filter(v => v !== value)
        : [...selected, value];
      onChange(updated);
    }
  };

  const displayText = selected.length === 0 || allSelected
    ? placeholder
    : selected.join(', ');

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          ...inputStyle,
          width: 120,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
          cursor: 'pointer',
          textAlign: 'left',
          padding: '8px 10px',
        }}
      >
        <span style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 80,
          fontSize: 13,
        }}>
          {displayText}
        </span>
        <span style={{ fontSize: 10, color: BRAND.textSecondary }}>▼</span>
      </button>
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: 4,
          background: '#FFFFFF',
          borderRadius: BRAND.radiusSmall,
          boxShadow: BRAND.shadow,
          padding: 12,
          minWidth: 200,
          zIndex: 100,
          border: `1px solid ${BRAND.border}`,
          maxHeight: 300,
          overflowY: 'auto',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => handleToggle('ALL')}
            />
            Все
          </label>
          {nonAllOptions.map(option => (
            <label key={option} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer', fontSize: 14 }}>
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => handleToggle(option)}
              />
              {option}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===================== МОДАЛЬНОЕ ОКНО ПАРОЛЯ ===================== */
function PasswordModal({ isOpen, onClose, onSubmit, error, title = 'Введите пароль', subtitle = '' }) {
  const [passwordInput, setPasswordInput] = useState('');

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    onSubmit(passwordInput);
    setPasswordInput('');
  };

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{
          width: '48px',
          height: '48px',
          backgroundColor: '#EFF6FF',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '24px',
          marginBottom: '16px',
          color: BRAND.primary,
        }}>
          🔒
        </div>
        <h3 style={{ margin: '0 0 8px 0', fontWeight: 700, fontSize: '1.5rem' }}>{title}</h3>
        <p style={{ margin: '0 0 20px 0', color: BRAND.textSecondary, fontSize: '0.9rem' }}>{subtitle}</p>

        {error && <p style={{ color: '#EF4444', marginBottom: 10, fontSize: '0.9rem' }}>{error}</p>}
        <input
          type="password"
          value={passwordInput}
          onChange={(e) => setPasswordInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="Пароль"
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: '10px',
            border: `1px solid ${BRAND.border}`,
            fontSize: '0.95rem',
            fontFamily: BRAND.fontFamily,
            color: BRAND.text,
            backgroundColor: '#F8FAFC',
            outline: 'none',
            transition: 'all 0.2s',
            boxSizing: 'border-box',
            marginBottom: '16px',
          }}
          autoFocus
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              padding: '12px 24px',
              borderRadius: '10px',
              border: `1px solid ${BRAND.border}`,
              background: '#FFFFFF',
              color: BRAND.text,
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '0.95rem',
            }}
          >
            Отмена
          </button>
          <button
            onClick={handleSubmit}
            style={{
              padding: '12px 24px',
              borderRadius: '10px',
              border: 'none',
              background: BRAND.primary,
              color: '#FFFFFF',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '0.95rem',
              boxShadow: '0 4px 12px rgba(37,99,235,0.2)',
            }}
          >
            Войти
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===================== ОБУЧЕНИЕ ===================== */
function HelpModal({ isOpen, onClose }) {
  const [activeSection, setActiveSection] = useState('assign');

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={{ ...wideModalStyle, maxWidth: '800px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 700, color: BRAND.text }}>❓ Как пользоваться</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 28, cursor: 'pointer', color: BRAND.textSecondary, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <button
            onClick={() => setActiveSection('assign')}
            style={{ ...subTabStyle(activeSection === 'assign'), flex: 1 }}
          >
            🎯 Назначение бригад
          </button>
          <button
            onClick={() => setActiveSection('dictionary')}
            style={{ ...subTabStyle(activeSection === 'dictionary'), flex: 1 }}
          >
            📚 Справочник
          </button>
        </div>

        {activeSection === 'assign' ? (
          <div style={{ fontSize: '1.1rem', lineHeight: 1.6, color: BRAND.text }}>
            <p style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 10 }}>Что это?</p>
            <p>Здесь показаны <b>дефекты без владельца</b> за выбранный период.</p>
            <div style={{ backgroundColor: '#F8FAFC', borderRadius: 12, padding: 16, marginTop: 16 }}>
              <p style={{ fontWeight: 700, marginBottom: 8 }}>Пошагово:</p>
              <ol style={{ paddingLeft: 20, margin: 0 }}>
                <li>Выберите даты и чекпоинты.</li>
                <li>В таблице найдите дефект.</li>
                <li>В колонке «Бригада» выберите бригаду.</li>
                <li>Нажмите «Назначить».</li>
              </ol>
            </div>
            <p style={{ marginTop: 16, color: BRAND.textSecondary }}>💡 Совет: сначала импортируйте справочник.</p>
          </div>
        ) : (
          <div style={{ fontSize: '1.1rem', lineHeight: 1.6, color: BRAND.text }}>
            <p style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 10 }}>Что это?</p>
            <p>Здесь вы можете <b>добавлять, редактировать и удалять</b> записи справочника.</p>
            <div style={{ backgroundColor: '#F8FAFC', borderRadius: 12, padding: 16, marginTop: 16 }}>
              <p style={{ fontWeight: 700, marginBottom: 8 }}>Как добавить вручную:</p>
              <ol style={{ paddingLeft: 20, margin: 0 }}>
                <li>Выберите модель.</li>
                <li>Введите деталь.</li>
                <li>Введите дефект.</li>
                <li>Выберите бригаду и нажмите «Добавить».</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===================== МОДАЛЬНОЕ ОКНО VIN ===================== */
function VINModal({ defect, vins, loading, onClose }) {
  const [exporting, setExporting] = useState(false);
  if (!defect) return null;

  const handleExport = () => {
    if (vins.length === 0) return;
    setExporting(true);
    const data = vins.map(vin => ({ VIN: vin }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'VIN');
    const fileName = `VIN_${(defect.mpp || '').replace(/[^a-zа-яё0-9]/gi, '_')}_${getTodayStr()}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    setTimeout(() => setExporting(false), 2000);
  };

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: BRAND.text, fontSize: '1.2rem' }}>
            VIN для дефекта: {defect.mpp}
          </h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer', color: BRAND.textSecondary }}>✕</button>
        </div>
        {loading ? (
          <div style={{ color: BRAND.textSecondary }}>Загрузка...</div>
        ) : vins.length === 0 ? (
          <div style={{ color: BRAND.textSecondary }}>Нет данных</div>
        ) : (
          <>
            <div style={{ color: BRAND.textSecondary, marginBottom: 12 }}>
              Всего уникальных VIN: <b>{vins.length}</b>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting}
              style={{
                padding: '8px 16px',
                backgroundColor: '#2563EB',
                color: '#FFF',
                border: 'none',
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 14,
                marginBottom: 12,
                cursor: exporting ? 'not-allowed' : 'pointer',
                opacity: exporting ? 0.6 : 1,
              }}
            >
              {exporting ? 'Выгружается...' : 'Экспорт в Excel'}
            </button>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${BRAND.border}`, borderRadius: BRAND.radiusSmall }}>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {vins.map((vin, idx) => (
                  <li key={idx} style={{ padding: '6px 12px', borderBottom: `1px solid ${BRAND.border}`, color: BRAND.text, fontSize: 14 }}>
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

/* ===================== ТАБЛИЦА ТОП MPP ПО БРИГАДЕ (14 ДНЕЙ) ===================== */
function BrigadeMPPTable({ allMpps, onCellClick, metric, userNotes = {}, onNoteSave }) {
  const responsibleOptions = ['', 'Сварка', 'Окраска', 'Сборка', 'Качество'];
  const actionOptions = ['', 'На контроле', 'Устранено', 'Требует проверки'];

  const [sortDay, setSortDay] = useState(null);
  const [sortCW, setSortCW] = useState(null);
  const [carsCounts, setCarsCounts] = useState({});

  const isDPU = metric === 'dpu';
  const colorFunc = isDPU ? getDPUColor : getDefectColor;
  const formatDPU = (v) => Number(v).toFixed(1);

  const { prevWeekDays, currWeekDays, prevWeekNum, currWeekNum } = useMemo(() => {
    const today = new Date();
    const mondayThisWeek = getMonday(today);
    const mondayPrevWeek = new Date(mondayThisWeek);
    mondayPrevWeek.setDate(mondayPrevWeek.getDate() - 7);

    const prevDays = [];
    const currDays = [];
    for (let i = 0; i < 7; i++) {
      prevDays.push(new Date(mondayPrevWeek.getTime() + i * 86400000));
      currDays.push(new Date(mondayThisWeek.getTime() + i * 86400000));
    }

    return {
      prevWeekDays: prevDays,
      currWeekDays: currDays,
      prevWeekNum: getWeekNumber(mondayPrevWeek),
      currWeekNum: getWeekNumber(mondayThisWeek),
    };
  }, []);

  useEffect(() => {
    const allDays = [...prevWeekDays, ...currWeekDays];
    const fetches = allDays.map(date => {
      const ds = toLocalDateStr(date);
      return fetch(`${API_BASE}/api/cars-count?date=${ds}`)
        .then(res => res.json())
        .catch(() => ({ CARS_COUNT: 0 }));
    });
    Promise.all(fetches).then(results => {
      const counts = {};
      allDays.forEach((date, i) => {
        const ds = toLocalDateStr(date);
        counts[ds] = results[i]?.CARS_COUNT || 0;
      });
      setCarsCounts(counts);
    }).catch(() => {});
  }, [prevWeekDays, currWeekDays]);

  const rows = useMemo(() => {
    const grouped = {};
    (allMpps || []).forEach(item => {
      const key = item.mpp;
      if (!grouped[key]) {
        grouped[key] = {
          mpp: item.mpp,
          model: item.model,
          part_name: item.part_name,
          problem_type: item.problem_type,
          days: {},
        };
      }
      grouped[key].days[item.date] = (grouped[key].days[item.date] || 0) + item.count;
    });

    const rowsArr = Object.values(grouped).map(g => {
      const countsPrev = prevWeekDays.map(d => {
        const ds = toLocalDateStr(d);
        return g.days[ds] || 0;
      });
      const countsCurr = currWeekDays.map(d => {
        const ds = toLocalDateStr(d);
        return g.days[ds] || 0;
      });

      const totalPrevCount = countsPrev.reduce((s, v) => s + v, 0);
      const totalCurrCount = countsCurr.reduce((s, v) => s + v, 0);

      const carsPrevSum = prevWeekDays.reduce((s, d) => {
        const ds = toLocalDateStr(d);
        return s + (carsCounts[ds] || 0);
      }, 0);
      const carsCurrSum = currWeekDays.reduce((s, d) => {
        const ds = toLocalDateStr(d);
        return s + (carsCounts[ds] || 0);
      }, 0);

      const dpuPrev = carsPrevSum > 0 ? (totalPrevCount * 1000) / carsPrevSum : 0;
      const dpuCurr = carsCurrSum > 0 ? (totalCurrCount * 1000) / carsCurrSum : 0;

      const cellsPrev = countsPrev.map((count, i) => {
        if (!isDPU) return count;
        const ds = toLocalDateStr(prevWeekDays[i]);
        const cars = carsCounts[ds] || 0;
        if (cars === 0) return 0;
        let v = (count * 1000) / cars;
        if (v > 1000) v = 980;
        return v;
      });
      const cellsCurr = countsCurr.map((count, i) => {
        if (!isDPU) return count;
        const ds = toLocalDateStr(currWeekDays[i]);
        const cars = carsCounts[ds] || 0;
        if (cars === 0) return 0;
        let v = (count * 1000) / cars;
        if (v > 1000) v = 980;
        return v;
      });

      return {
        mpp: g.mpp,
        model: g.model,
        part_name: g.part_name,
        problem_type: g.problem_type,
        days: g.days,
        countsPrev,
        countsCurr,
        cellsPrev,
        cellsCurr,
        totalPrev: isDPU ? dpuPrev : totalPrevCount,
        totalCurr: isDPU ? dpuCurr : totalCurrCount,
        totalPrevCount,
        totalCurrCount,
      };
    });

    let filtered = rowsArr.filter(r => (r.totalPrevCount + r.totalCurrCount) > 0);

    if (sortCW) {
      filtered.sort((a, b) => sortCW === 'prev'
        ? b.totalPrev - a.totalPrev
        : b.totalCurr - a.totalCurr);
    } else if (sortDay) {
      filtered.sort((a, b) => {
        const va = sortDay.week === 'prev' ? a.cellsPrev[sortDay.index] : a.cellsCurr[sortDay.index];
        const vb = sortDay.week === 'prev' ? b.cellsPrev[sortDay.index] : b.cellsCurr[sortDay.index];
        return vb - va;
      });
    } else {
      filtered.sort((a, b) => (b.totalPrevCount + b.totalCurrCount) - (a.totalPrevCount + a.totalCurrCount));
    }

    return filtered;
  }, [allMpps, prevWeekDays, currWeekDays, sortDay, sortCW, carsCounts, isDPU]);

  const handleDayHeaderClick = (week, index) => {
    setSortCW(null);
    setSortDay(prev =>
      prev?.week === week && prev?.index === index ? null : { week, index }
    );
  };

  const handleCWHeaderClick = (week) => {
    setSortDay(null);
    setSortCW(prev => (prev === week ? null : week));
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: BRAND.text, margin: 0 }}>
          📋 Топ дефектов по бригаде (14 дней)
        </h3>
        {(sortDay || sortCW) && (
          <button
            onClick={() => { setSortDay(null); setSortCW(null); }}
            style={{
              padding: '4px 10px',
              background: '#E5E7EB',
              color: '#374151',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Сбросить сортировку ✕
          </button>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(260px, 2fr) 130px 130px repeat(7, 60px) 60px repeat(7, 60px) 60px',
        border: '1px solid #4B5563',
        fontSize: 13,
        background: '#111827',
        borderRadius: 6,
        overflowX: 'auto',
      }}>
        <div style={mppTableStyles.dark}>Дефект (MPP)</div>
        <div style={mppTableStyles.dark}>Ответственный</div>
        <div style={mppTableStyles.dark}>Действие</div>

        {prevWeekDays.map((d, i) => {
          const isSorted = sortDay?.week === 'prev' && sortDay?.index === i;
          return (
            <div
              key={`ph${i}`}
              style={{
                ...mppTableStyles.hdr,
                cursor: 'pointer',
                background: isSorted ? '#2563EB' : '#374151',
                userSelect: 'none',
              }}
              onClick={() => handleDayHeaderClick('prev', i)}
              title="Сортировать по этому дню"
            >
              <span style={{ display: 'block' }}>{formatDateDDMM(d)}</span>
              <span style={{ display: 'block', color: isSorted ? '#FFF' : '#9CA3AF' }}>
                {getDayOfWeekFromDate(d)}
              </span>
            </div>
          );
        })}
        <div
          style={{
            ...mppTableStyles.hdr,
            cursor: 'pointer',
            background: sortCW === 'prev' ? '#2563EB' : '#374151',
            userSelect: 'none',
          }}
          onClick={() => handleCWHeaderClick('prev')}
          title="Сортировать по сумме недели"
        >
          <span style={{ fontWeight: 700 }}>CW{prevWeekNum}</span>
        </div>

        {currWeekDays.map((d, i) => {
          const isSorted = sortDay?.week === 'curr' && sortDay?.index === i;
          return (
            <div
              key={`ch${i}`}
              style={{
                ...mppTableStyles.hdr,
                cursor: 'pointer',
                background: isSorted ? '#2563EB' : '#374151',
                userSelect: 'none',
              }}
              onClick={() => handleDayHeaderClick('curr', i)}
              title="Сортировать по этому дню"
            >
              <span style={{ display: 'block' }}>{formatDateDDMM(d)}</span>
              <span style={{ display: 'block', color: isSorted ? '#FFF' : '#9CA3AF' }}>
                {getDayOfWeekFromDate(d)}
              </span>
            </div>
          );
        })}
        <div
          style={{
            ...mppTableStyles.hdr,
            cursor: 'pointer',
            background: sortCW === 'curr' ? '#2563EB' : '#374151',
            userSelect: 'none',
          }}
          onClick={() => handleCWHeaderClick('curr')}
          title="Сортировать по сумме недели"
        >
          <span style={{ fontWeight: 700 }}>CW{currWeekNum}</span>
        </div>

        {rows.length === 0 ? (
          <div style={{
            ...mppTableStyles.dark,
            gridColumn: '1 / -1',
            textAlign: 'center',
            padding: 12,
            color: '#9CA3AF',
          }}>
            Нет данных за 14 дней
          </div>
        ) : rows.map(row => {
          const note = userNotes[row.mpp] || { responsible: '', action: '' };
          return (
          <React.Fragment key={row.mpp}>
            <div style={mppTableStyles.name} title={row.mpp}>{row.mpp}</div>

            <div style={mppTableStyles.noteCell}>
              <select
                value={note.responsible}
                onChange={e => onNoteSave && onNoteSave(row.mpp, 'responsible', e.target.value)}
                style={mppTableStyles.noteSelect}
              >
                {responsibleOptions.map(opt => <option key={opt} value={opt}>{opt || '—'}</option>)}
              </select>
              {note.updated_at && (
                <div style={mppTableStyles.noteDate}>
                  {new Date(note.updated_at).toLocaleDateString('ru-RU')}
                </div>
              )}
            </div>

            <div style={mppTableStyles.noteCell}>
              <select
                value={note.action}
                onChange={e => onNoteSave && onNoteSave(row.mpp, 'action', e.target.value)}
                style={mppTableStyles.noteSelect}
              >
                {actionOptions.map(opt => <option key={opt} value={opt}>{opt || '—'}</option>)}
              </select>
              {note.updated_at && (
                <div style={mppTableStyles.noteDate}>
                  {new Date(note.updated_at).toLocaleDateString('ru-RU')}
                </div>
              )}
            </div>

            {row.cellsPrev.map((val, ci) => {
              const ds = toLocalDateStr(prevWeekDays[ci]);
              const count = row.countsPrev[ci];
              const bg = colorFunc(val);
              const textColor = isDPU
                ? (val > 300 ? '#FFF' : '#000')
                : (val > 15 ? '#FFF' : '#000');
              return (
                <div
                  key={`cp${ci}`}
                  style={{
                    ...mppTableStyles.val,
                    background: bg,
                    color: textColor,
                    cursor: count > 0 ? 'pointer' : 'default',
                  }}
                  onClick={() => count > 0 && onCellClick(row, ds)}
                >
                  {isDPU ? formatDPU(val) : val}
                </div>
              );
            })}
            <div style={{
              ...mppTableStyles.total,
              background: colorFunc(row.totalPrev),
              color: (isDPU ? row.totalPrev > 300 : row.totalPrev > 15) ? '#FFF' : '#000',
            }}>
              {isDPU ? formatDPU(row.totalPrev) : row.totalPrev}
            </div>

            {row.cellsCurr.map((val, ci) => {
              const ds = toLocalDateStr(currWeekDays[ci]);
              const count = row.countsCurr[ci];
              const bg = colorFunc(val);
              const textColor = isDPU
                ? (val > 300 ? '#FFF' : '#000')
                : (val > 15 ? '#FFF' : '#000');
              return (
                <div
                  key={`cc${ci}`}
                  style={{
                    ...mppTableStyles.val,
                    background: bg,
                    color: textColor,
                    cursor: count > 0 ? 'pointer' : 'default',
                  }}
                  onClick={() => count > 0 && onCellClick(row, ds)}
                >
                  {isDPU ? formatDPU(val) : val}
                </div>
              );
            })}
            <div style={{
              ...mppTableStyles.total,
              background: colorFunc(row.totalCurr),
              color: (isDPU ? row.totalCurr > 300 : row.totalCurr > 15) ? '#FFF' : '#000',
            }}>
              {isDPU ? formatDPU(row.totalCurr) : row.totalCurr}
            </div>
          </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// Определяем текущую активную смену (A / B / C) по московскому времени
const getCurrentShiftLetter = () => {
  const nowMoscow = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const totalMinutes = nowMoscow.getUTCHours() * 60 + nowMoscow.getUTCMinutes();

  let shiftType;
  let shiftDate = new Date(nowMoscow);

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

  if (shiftType === 'night') return 'C';

  const d = new Date(Date.UTC(shiftDate.getUTCFullYear(), shiftDate.getUTCMonth(), shiftDate.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  const isEven = weekNumber % 2 === 0;

  if (shiftType === 'day') return isEven ? 'B' : 'A';
  if (shiftType === 'evening') return isEven ? 'A' : 'B';
  return 'C';
};

/* ===================== ОБЩИЙ ОТЧЕТ (ГИСТОГРАММА) ===================== */
function BrigadeReport({ brigades, password, executeWithPassword }) {
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(today.toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(today.toISOString().split('T')[0]);
  const [selectedCheckpoints, setSelectedCheckpoints] = useState([]);
  const [defectType, setDefectType] = useState('all');
  const [metric, setMetric] = useState('count');
  const [shiftFilter, setShiftFilter] = useState(() => getCurrentShiftLetter());
  const [histogramData, setHistogramData] = useState([]);
  const [totalCars, setTotalCars] = useState(0);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [totalDefects, setTotalDefects] = useState(0);
  const [topBrigades, setTopBrigades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [totalCarsShift, setTotalCarsShift] = useState(0);

  const availableCheckpoints = ['CP7', 'CP8', 'PIP', 'TL'];

  const loadData = async () => {
    setLoading(true);
    try {
      const allSelected = selectedCheckpoints.length === 0 || selectedCheckpoints.length === availableCheckpoints.length;
      const checkpointParam = allSelected ? 'ALL' : selectedCheckpoints.join(',');

      const params = new URLSearchParams({
        dateFrom,
        dateTo,
        checkpoint: checkpointParam,
        metric,
        defectType,
        shift: shiftFilter,
      });

      const res = await fetch(`${API_BASE}/api/brigade-report/data?${params}`);
      if (!res.ok) throw new Error('Ошибка загрузки данных');
      const data = await res.json();
      setHistogramData(data.histogram);
      setTotalCars(data.totalCars);
      setTotalCarsShift(data.totalCarsShift || 0);
      setUnassignedCount(data.unassignedCount);
      setTotalDefects(data.totalDefects);
      setTopBrigades(data.topBrigades || []);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo, selectedCheckpoints, metric, defectType, shiftFilter]);

  const top3Brigades = useMemo(() => {
    if (!topBrigades.length) return [];
    const sorted = [...topBrigades].sort((a, b) => {
      const valA = metric === 'dpu' ? a.dpu : a.count;
      const valB = metric === 'dpu' ? b.dpu : b.count;
      return valB - valA;
    });
    return sorted.slice(0, 3);
  }, [topBrigades, metric]);

  const topMppsByBrigade = (brigade) => {
    const mpps = [...brigade.mpps].sort((a, b) => {
      const valA = metric === 'dpu' ? a.dpu : a.count;
      const valB = metric === 'dpu' ? b.dpu : b.count;
      return valB - valA;
    });
    return mpps.slice(0, 5);
  };

  const formatDpu = (value) => Number(value).toFixed(2);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 15 }}>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
        padding: '15px',
        backgroundColor: '#F8FAFC',
        borderRadius: BRAND.radius,
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Начало:
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Конец:
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Смена:
          <select value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)} style={inputStyle}>
            <option value="all">Сутки</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Чекпоинты:
          <MultiSelect
            options={['ALL', ...availableCheckpoints]}
            selected={selectedCheckpoints}
            onChange={setSelectedCheckpoints}
            placeholder="Все"
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Тип дефекта:
          <select value={defectType} onChange={(e) => setDefectType(e.target.value)} style={inputStyle}>
            <option value="all">Все</option>
            <option value="offline">Offline</option>
            <option value="online">Online</option>
          </select>
        </label>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button
            onClick={() => setMetric('count')}
            style={{
              ...buttonStyle,
              background: metric === 'count' ? BRAND.primary : '#E5E7EB',
              color: metric === 'count' ? '#FFFFFF' : '#374151',
            }}
          >
            Шт
          </button>
          <button
            onClick={() => setMetric('dpu')}
            style={{
              ...buttonStyle,
              background: metric === 'dpu' ? BRAND.primary : '#E5E7EB',
              color: metric === 'dpu' ? '#FFFFFF' : '#374151',
            }}
          >
            DPU per 1000
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0, gap: 15 }}>
        <div style={{ ...cardStyle, flex: 7 }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: BRAND.text, marginBottom: '10px' }}>
            Дефекты по бригадам {metric === 'dpu' ? '(DPU per 1000)' : '(шт)'}
          </h2>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '30px', fontSize: '1.5rem' }}>Загрузка...</div>
            ) : histogramData.length > 0 ? (
              <div style={{ height: Math.max(400, histogramData.length * 45) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={histogramData}
                    layout="vertical"
                    margin={{ top: 20, right: 70, left: 40, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 'dataMax']} tick={{ fontSize: 13 }} />
                    <YAxis type="category" dataKey="category" tick={{ fontSize: 13 }} width={160} />
                    <Tooltip
                      contentStyle={{ fontSize: '1.2rem' }}
                      formatter={(value) => metric === 'dpu' ? formatDpu(value) : value}
                    />
                    <Bar dataKey="value" fill={BRAND.primary} barSize={32}>
                      <LabelList
                        dataKey="value"
                        position="right"
                        formatter={(value) => metric === 'dpu' ? formatDpu(value) : value}
                        style={{ fontSize: '1.1rem', fontWeight: 700, fill: BRAND.text }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p style={{ textAlign: 'center', padding: '30px', color: BRAND.textSecondary, fontSize: '1.3rem' }}>
                Нет данных
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '20px', marginTop: '10px', justifyContent: 'center', fontSize: '1.1rem' }}>
            <div>Всего авто: <b>{totalCarsShift}</b>{shiftFilter !== 'all' && <> (за сутки: <b>{totalCars}</b>)</>}</div>
            <div>Всего дефектов: <b>{totalDefects}</b></div>
            <div>Дефектов без владельца: <b>{unassignedCount}</b></div>
          </div>
        </div>

        <div style={{ ...cardStyle, flex: 3, display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: BRAND.text, marginBottom: '10px', flexShrink: 0 }}>
            Топ 3 бригады по {metric === 'dpu' ? 'DPU' : 'количеству'}
          </h2>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {loading ? (
              <p style={{ textAlign: 'center', padding: '10px' }}>Загрузка...</p>
            ) : top3Brigades.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left' }}>Бригада / Дефект (MPP)</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>{metric === 'dpu' ? 'DPU' : 'Шт'}</th>
                  </tr>
                </thead>
                <tbody>
                  {top3Brigades.map((brigade) => {
                    const totalValue = metric === 'dpu' ? formatDpu(brigade.dpu) : brigade.count;
                    const mpps = topMppsByBrigade(brigade);
                    return (
                      <React.Fragment key={brigade.brigade}>
                        <tr style={{ backgroundColor: '#F0F5FF', fontWeight: 700 }}>
                          <td style={{ ...tdStyle, fontWeight: 700, color: BRAND.primary }}>
                            {brigade.brigade}
                          </td>
                          <td style={{ ...tdStyle, fontWeight: 700, textAlign: 'center', color: BRAND.primary }}>
                            {totalValue}
                          </td>
                        </tr>
                        {mpps.map((mpp, idx) => (
                          <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                            <td style={{ ...tdStyle, paddingLeft: '30px' }}>
                              {mpp.model} {mpp.part_name} {mpp.problem_type}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                              {metric === 'dpu' ? formatDpu(mpp.dpu) : mpp.count}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p style={{ textAlign: 'center', padding: '10px', color: BRAND.textSecondary }}>
                Нет данных
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================== ОБЩИЙ ОТЧЕТ ПО БРИГАДАМ (по сменам A / B) ===================== */
function BrigadeReportByShift({ brigades, password, executeWithPassword }) {
  const [dateFrom, setDateFrom] = useState(toLocalDateStr(new Date()));
  const [dateTo, setDateTo] = useState(toLocalDateStr(new Date()));
  const [selectedCheckpoints, setSelectedCheckpoints] = useState([]);
  const [defectType, setDefectType] = useState('all');
  const [metric, setMetric] = useState('count');
  const [dataA, setDataA] = useState(null);
  const [dataB, setDataB] = useState(null);
  const [loading, setLoading] = useState(false);

  const availableCheckpoints = ['CP7', 'CP8', 'PIP', 'TL'];

  const loadBoth = async () => {
    setLoading(true);
    try {
      const allSelected = selectedCheckpoints.length === 0 || selectedCheckpoints.length === availableCheckpoints.length;
      const checkpointParam = allSelected ? 'ALL' : selectedCheckpoints.join(',');

      const baseParams = () => {
        const p = new URLSearchParams({
          dateFrom,
          dateTo,
          checkpoint: checkpointParam,
          metric,
          defectType,
        });
        return p;
      };

      const [resA, resB] = await Promise.all([
        fetch(`${API_BASE}/api/brigade-report/data?${baseParams().toString()}&shift=A`).then(r => r.json()),
        fetch(`${API_BASE}/api/brigade-report/data?${baseParams().toString()}&shift=B`).then(r => r.json()),
      ]);
      setDataA(resA);
      setDataB(resB);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBoth();
  }, [dateFrom, dateTo, selectedCheckpoints, metric, defectType]);

  const formatDpu = (value) => Number(value).toFixed(2);

  const getTop3 = (topBrigades) => {
    if (!topBrigades || !topBrigades.length) return [];
    return [...topBrigades].sort((a, b) => {
      const va = metric === 'dpu' ? a.dpu : a.count;
      const vb = metric === 'dpu' ? b.dpu : b.count;
      return vb - va;
    }).slice(0, 3);
  };

  const getTopMpps = (brigade) => {
    return [...brigade.mpps].sort((a, b) => {
      const va = metric === 'dpu' ? a.dpu : a.count;
      const vb = metric === 'dpu' ? b.dpu : b.count;
      return vb - va;
    }).slice(0, 5);
  };

  const renderShiftBlock = (title, accentColor, data) => {
    if (!data) {
      return (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND.textSecondary, fontSize: '1.2rem' }}>
          Загрузка...
        </div>
      );
    }

    const histogramData = data.histogram || [];
    const top3Brigades = getTop3(data.topBrigades);

    return (
      <div style={{ flex: 1, minWidth: 0, minHeight: 800, display: 'flex', flexDirection: 'column', gap: 15 }}>
        <h2 style={{
          fontSize: '1.6rem',
          fontWeight: 900,
          color: accentColor,
          margin: 0,
          padding: '10px 0',
          borderBottom: `3px solid ${accentColor}`,
          textAlign: 'center',
        }}>
          {title}
        </h2>

        <div style={{ ...cardStyle, flex: 1, minHeight: 400 }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: BRAND.text, marginBottom: '10px' }}>
            Дефекты по бригадам {metric === 'dpu' ? '(DPU per 1000)' : '(шт)'}
          </h3>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {histogramData.length > 0 ? (
              <div style={{ height: Math.max(300, histogramData.length * 40) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={histogramData}
                    layout="vertical"
                    margin={{ top: 10, right: 60, left: 20, bottom: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 'dataMax']} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={130} />
                    <Tooltip contentStyle={{ fontSize: '1rem' }} formatter={(value) => metric === 'dpu' ? formatDpu(value) : value} />
                    <Bar dataKey="value" fill={accentColor} barSize={22}>
                      <LabelList
                        dataKey="value"
                        position="right"
                        formatter={(value) => metric === 'dpu' ? formatDpu(value) : value}
                        style={{ fontSize: '0.9rem', fontWeight: 700, fill: BRAND.text }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p style={{ textAlign: 'center', padding: '30px', color: BRAND.textSecondary }}>
                Нет данных
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '15px', marginTop: '10px', justifyContent: 'center', fontSize: '0.95rem', flexWrap: 'wrap' }}>
            <div>Всего авто: <b>{data.totalCarsShift ?? data.totalCars}</b></div>
            <div>Всего дефектов: <b>{data.totalDefects}</b></div>
            <div>Без владельца: <b>{data.unassignedCount}</b></div>
          </div>
        </div>

        <div style={{ ...cardStyle, flex: 1, minHeight: 300 }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: BRAND.text, marginBottom: '10px' }}>
            Топ 3 бригады по {metric === 'dpu' ? 'DPU' : 'количеству'}
          </h3>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {top3Brigades.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left' }}>Бригада / Дефект (MPP)</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>{metric === 'dpu' ? 'DPU' : 'Шт'}</th>
                  </tr>
                </thead>
                <tbody>
                  {top3Brigades.map((brigade) => {
                    const totalValue = metric === 'dpu' ? formatDpu(brigade.dpu) : brigade.count;
                    const mpps = getTopMpps(brigade);
                    return (
                      <React.Fragment key={brigade.brigade}>
                        <tr style={{ backgroundColor: '#F0F5FF', fontWeight: 700 }}>
                          <td style={{ ...tdStyle, fontWeight: 700, color: accentColor }}>{brigade.brigade}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, textAlign: 'center', color: accentColor }}>{totalValue}</td>
                        </tr>
                        {mpps.map((mpp, idx) => (
                          <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                            <td style={{ ...tdStyle, paddingLeft: '30px' }}>
                              {mpp.model} {mpp.part_name} {mpp.problem_type}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                              {metric === 'dpu' ? formatDpu(mpp.dpu) : mpp.count}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p style={{ textAlign: 'center', padding: '20px', color: BRAND.textSecondary }}>Нет данных</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 15 }}>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
        padding: '15px',
        backgroundColor: '#F8FAFC',
        borderRadius: BRAND.radius,
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Начало:
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Конец:
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Чекпоинты:
          <MultiSelect
            options={['ALL', ...availableCheckpoints]}
            selected={selectedCheckpoints}
            onChange={setSelectedCheckpoints}
            placeholder="Все"
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Тип дефекта:
          <select value={defectType} onChange={(e) => setDefectType(e.target.value)} style={inputStyle}>
            <option value="all">Все</option>
            <option value="offline">Offline</option>
            <option value="online">Online</option>
          </select>
        </label>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button
            onClick={() => setMetric('count')}
            style={{
              ...buttonStyle,
              background: metric === 'count' ? BRAND.primary : '#E5E7EB',
              color: metric === 'count' ? '#FFFFFF' : '#374151',
            }}
          >
            Шт
          </button>
          <button
            onClick={() => setMetric('dpu')}
            style={{
              ...buttonStyle,
              background: metric === 'dpu' ? BRAND.primary : '#E5E7EB',
              color: metric === 'dpu' ? '#FFFFFF' : '#374151',
            }}
          >
            DPU per 1000
          </button>
        </div>
      </div>

      {loading && !dataA && !dataB ? (
        <div style={{ textAlign: 'center', padding: '30px', fontSize: '1.5rem' }}>Загрузка...</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            gap: 15,
            minHeight: '100%',
          }}>
            {renderShiftBlock('Смена A', '#2563EB', dataA)}
            <div style={{ width: 1, background: BRAND.border, flexShrink: 0 }} />
            {renderShiftBlock('Смена B', '#F59E0B', dataB)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== ОТЧЕТ ПО БРИГАДАМ (ТРЕНДЫ + 14-ДНЕВНАЯ ТАБЛИЦА) ===================== */
function BrigadeTrendReport({ brigades, password, executeWithPassword }) {
  const [selectedCheckpoints, setSelectedCheckpoints] = useState(['CP7', 'CP8']);
  const [defectType, setDefectType] = useState('all');
  const [selectedBrigades, setSelectedBrigades] = useState([]);
  const [metric, setMetric] = useState('count');
  const [shiftFilter, setShiftFilter] = useState('all');
  const [trendsByBrigade, setTrendsByBrigade] = useState({});
  const [topMppsByBrigade, setTopMppsByBrigade] = useState({});
  const [loading, setLoading] = useState(false);

  const [selectedDefect, setSelectedDefect] = useState(null);
  const [vins, setVins] = useState([]);
  const [vinsLoading, setVinsLoading] = useState(false);

  const [userNotes, setUserNotes] = useState({});

  const availableCheckpoints = ['CP7', 'CP8', 'PIP', 'TL'];
  const brigadesOptions = brigades.map(b => b.name).filter(name => name !== 'Бригада не найдена');

  const formatValue = (value) => metric === 'dpu' ? Number(value).toFixed(2) : value;

  useEffect(() => {
    fetch(`${API_BASE}/api/defect-notes`)
      .then(res => res.json())
      .then(data => {
        const map = {};
        data.forEach(n => { map[n.mpp] = n; });
        setUserNotes(map);
      })
      .catch(() => {});
  }, []);

  const buildCommonParams = () => {
    const allSelected = selectedCheckpoints.length === 0 || selectedCheckpoints.length === availableCheckpoints.length;
    const checkpointParam = allSelected ? 'ALL' : selectedCheckpoints.join(',');
    const params = new URLSearchParams({
      checkpoint: checkpointParam,
      defectType,
    });
    if (shiftFilter !== 'all') params.append('shift', shiftFilter);
    return params;
  };

  const fetchTrendForBrigade = async (brigadeName) => {
    const params = buildCommonParams();
    params.append('brigades', brigadeName);
    params.append('metric', metric);
    const res = await fetch(`${API_BASE}/api/brigade-report/trend?${params}`);
    if (!res.ok) throw new Error(`Ошибка загрузки трендов для бригады ${brigadeName}`);
    return await res.json();
  };

  const fetchTopMppsForBrigade = async (brigadeName) => {
    const params = buildCommonParams();
    params.append('brigade', brigadeName);
    const res = await fetch(`${API_BASE}/api/brigade-report/top-mpp?${params}`);
    if (!res.ok) throw new Error(`Ошибка загрузки топ MPP для бригады ${brigadeName}`);
    return await res.json();
  };

  const loadAllData = async () => {
    if (selectedBrigades.length === 0) {
      setTrendsByBrigade({});
      setTopMppsByBrigade({});
      return;
    }
    setLoading(true);
    try {
      const newTrends = {};
      const newTopMpps = {};
      await Promise.all(
        selectedBrigades.map(async (brigadeName) => {
          try {
            const [trendData, mppData] = await Promise.all([
              fetchTrendForBrigade(brigadeName),
              fetchTopMppsForBrigade(brigadeName),
            ]);
            newTrends[brigadeName] = trendData;
            newTopMpps[brigadeName] = mppData;
          } catch (err) {
            console.error(err);
          }
        })
      );
      setTrendsByBrigade(newTrends);
      setTopMppsByBrigade(newTopMpps);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, [selectedCheckpoints, selectedBrigades, defectType, shiftFilter]);

  const handleCellClick = (row, date) => {
    setSelectedDefect({
      model: row.model,
      part_name: row.part_name,
      problem_type: row.problem_type,
      mpp: row.mpp,
      date,
    });
    setVins([]);
    setVinsLoading(true);

    const params = buildCommonParams();
    params.append('model', row.model);
    params.append('part_name', row.part_name);
    params.append('problem_type', row.problem_type);
    params.append('date', date);

    fetch(`${API_BASE}/api/brigade-report/top-mpp-vins?${params}`)
      .then(res => {
        if (!res.ok) throw new Error('Ошибка загрузки VIN');
        return res.json();
      })
      .then(data => {
        setVins(Array.isArray(data) ? data : []);
        setVinsLoading(false);
      })
      .catch(err => {
        console.error(err);
        setVins([]);
        setVinsLoading(false);
      });
  };

  const closeModal = () => {
    setSelectedDefect(null);
    setVins([]);
  };

  const handleNoteSave = async (mpp, field, value) => {
    const current = userNotes[mpp] || { responsible: '', action: '' };
    const updated = { ...current, [field]: value };
    setUserNotes(prev => ({ ...prev, [mpp]: updated }));

    try {
      const res = await fetch(`${API_BASE}/api/defect-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mpp,
          responsible: updated.responsible || '',
          action: updated.action || ''
        }),
      });
      const json = await res.json();
      if (json.success && json.note) {
        setUserNotes(prev => ({
          ...prev,
          [mpp]: { ...prev[mpp], updated_at: json.note.updated_at }
        }));
      }
    } catch (err) {
      console.error('Ошибка сохранения:', err);
    }
  };

  const renderBrigadeCard = (brigadeName, data) => {
    if (!data) return null;

    const monthData = data.month || [];
    const weekData = data.week || [];
    const dayData = data.day || [];
    const topMpps = topMppsByBrigade[brigadeName] || [];

    return (
      <div key={brigadeName} style={{
        backgroundColor: '#FFFFFF',
        borderRadius: BRAND.radius,
        padding: 24,
        marginBottom: 20,
        boxShadow: BRAND.shadow,
        border: `1px solid ${BRAND.border}`,
      }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: BRAND.primary, marginBottom: 16 }}>
          👷 {brigadeName}
        </h2>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px', minWidth: 250 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8, color: '#3B82F6' }}>
              📅 Последние 3 месяца
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthData} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(val) => {
                    const [, m] = val.split('-');
                    const monthNames = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
                    return monthNames[parseInt(m,10)-1];
                  }}
                />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip formatter={(value) => formatValue(value)} />
                <Bar dataKey="value" fill="#3B82F6" radius={[6,6,0,0]}>
                  <LabelList dataKey="value" position="top" formatter={(value) => formatValue(value)} style={{ fontSize: 14, fontWeight: 700, fill: BRAND.text }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ flex: '1 1 300px', minWidth: 250 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8, color: '#F59E0B' }}>
              📆 Последние 4 недели
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={weekData} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(val) => val.split('-W')[1] ? `W${val.split('-W')[1]}` : val}
                />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip formatter={(value) => formatValue(value)} />
                <Bar dataKey="value" fill="#F59E0B" radius={[6,6,0,0]}>
                  <LabelList dataKey="value" position="top" formatter={(value) => formatValue(value)} style={{ fontSize: 14, fontWeight: 700, fill: BRAND.text }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ flex: '2 1 350px', minWidth: 300 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8, color: '#10B981' }}>
              📊 Последние 14 дней
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={dayData} margin={{ top: 20, right: 20, left: 0, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis
                  dataKey="period"
                  interval={0}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(val) => {
                    const [, m, d] = val.split('-');
                    return `${d}.${m}`;
                  }}
                />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip formatter={(value) => formatValue(value)} />
                <Bar dataKey="value" fill="#10B981" radius={[6,6,0,0]}>
                  <LabelList dataKey="value" position="top" formatter={(value) => formatValue(value)} style={{ fontSize: 13, fontWeight: 700, fill: BRAND.text }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <BrigadeMPPTable
          allMpps={topMpps}
          onCellClick={handleCellClick}
          metric={metric}
          userNotes={userNotes}
          onNoteSave={handleNoteSave}
        />
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 15 }}>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
        padding: '15px',
        backgroundColor: '#F8FAFC',
        borderRadius: BRAND.radius,
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Смена:
          <select value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)} style={inputStyle}>
            <option value="all">Сутки</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Чекпоинты:
          <MultiSelect
            options={['ALL', ...availableCheckpoints]}
            selected={selectedCheckpoints}
            onChange={setSelectedCheckpoints}
            placeholder="Все"
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Тип дефекта:
          <select value={defectType} onChange={(e) => setDefectType(e.target.value)} style={inputStyle}>
            <option value="all">Все</option>
            <option value="offline">Offline</option>
            <option value="online">Online</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Бригады:
          <MultiSelect
            options={['ALL', ...brigadesOptions]}
            selected={selectedBrigades}
            onChange={setSelectedBrigades}
            placeholder="Выберите..."
          />
        </label>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button
            onClick={() => setMetric('count')}
            style={{
              ...buttonStyle,
              background: metric === 'count' ? BRAND.primary : '#E5E7EB',
              color: metric === 'count' ? '#FFFFFF' : '#374151',
            }}
          >
            Шт
          </button>
          <button
            onClick={() => setMetric('dpu')}
            style={{
              ...buttonStyle,
              background: metric === 'dpu' ? BRAND.primary : '#E5E7EB',
              color: metric === 'dpu' ? '#FFFFFF' : '#374151',
            }}
          >
            DPU per 1000
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px', fontSize: '1.5rem' }}>Загрузка...</div>
      ) : selectedBrigades.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px', color: BRAND.textSecondary, fontSize: '1.3rem' }}>
          Выберите бригады для отображения графиков
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
          {selectedBrigades.map(brigadeName => renderBrigadeCard(brigadeName, trendsByBrigade[brigadeName]))}
        </div>
      )}

      <VINModal
        defect={selectedDefect}
        vins={vins}
        loading={vinsLoading}
        onClose={closeModal}
      />
    </div>
  );
}

/* ===================== НАЗНАЧЕНИЕ БРИГАД ===================== */
function AssignBrigadesPanel({ brigades, password, executeWithPassword, refreshTrigger }) {
  const [dateFrom, setDateFrom] = useState(toLocalDateStr(new Date()));
  const [dateTo, setDateTo] = useState(toLocalDateStr(new Date()));
  const [selectedCheckpoints, setSelectedCheckpoints] = useState([]);
  const [defectType, setDefectType] = useState('all');
  const [unassignedDefects, setUnassignedDefects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rowBrigades, setRowBrigades] = useState({});

  const availableCheckpoints = ['CP7', 'CP8', 'PIP', 'TL'];

  const loadUnassigned = async () => {
    setLoading(true);
    try {
      const allSelected = selectedCheckpoints.length === 0 || selectedCheckpoints.length === availableCheckpoints.length;
      const checkpointParam = allSelected ? 'ALL' : selectedCheckpoints.join(',');
      const params = new URLSearchParams({
        dateFrom,
        dateTo,
        checkpoint: checkpointParam,
        defectType,
      });
      const res = await fetch(`${API_BASE}/api/brigade-report/unassigned-defects?${params}`);
      if (!res.ok) throw new Error('Ошибка загрузки данных');
      const data = await res.json();
      setUnassignedDefects(data);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUnassigned();
  }, [dateFrom, dateTo, selectedCheckpoints, defectType, refreshTrigger]);

  const handleAssign = (defect) => {
    const key = `${defect.model}|${defect.part_name}|${defect.problem_type}`;
    const brigadeName = rowBrigades[key] || '';
    if (!brigadeName) {
      alert('Выберите бригаду из списка');
      return;
    }
    executeWithPassword(async (pwd) => {
      try {
        const res = await fetch(`${API_BASE}/api/brigade-report/assign-owner`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: defect.model,
            part_name: defect.part_name,
            problem_type: defect.problem_type,
            brigadeName,
            password: pwd,
          }),
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'Ошибка назначения');
        }
        loadUnassigned();
      } catch (err) {
        alert(err.message);
      }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 15 }}>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
        padding: '15px',
        backgroundColor: '#F8FAFC',
        borderRadius: BRAND.radius,
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Начало:
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Конец:
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Чекпоинты:
          <MultiSelect
            options={['ALL', ...availableCheckpoints]}
            selected={selectedCheckpoints}
            onChange={setSelectedCheckpoints}
            placeholder="Все"
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
          Тип дефекта:
          <select value={defectType} onChange={(e) => setDefectType(e.target.value)} style={inputStyle}>
            <option value="all">Все</option>
            <option value="offline">Offline</option>
            <option value="online">Online</option>
          </select>
        </label>
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: BRAND.text, marginBottom: '10px' }}>
          Дефекты без владельца
        </h2>
        <p style={{ fontSize: '0.9rem', color: BRAND.textSecondary, marginTop: 0, marginBottom: 10 }}>
          Выберите бригаду для каждого дефекта и нажмите «Назначить».
        </p>
        <div style={{ flex: 1, overflowY: 'auto', border: `1px solid ${BRAND.border}`, borderRadius: BRAND.radiusSmall }}>
          {loading ? (
            <p style={{ textAlign: 'center', padding: '20px', fontSize: '1.2rem' }}>Загрузка...</p>
          ) : unassignedDefects.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Модель</th>
                  <th style={thStyle}>Деталь</th>
                  <th style={thStyle}>Дефект</th>
                  <th style={thStyle}>Кол-во</th>
                  <th style={thStyle}>Бригада</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {unassignedDefects.map((defect, idx) => {
                  const key = `${defect.model}|${defect.part_name}|${defect.problem_type}`;
                  const selectedBrigade = rowBrigades[key] || '';
                  return (
                    <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
                      <td style={tdStyle}>{defect.model}</td>
                      <td style={tdStyle}>{defect.part_name}</td>
                      <td style={tdStyle}>{defect.problem_type}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>{defect.count}</td>
                      <td style={tdStyle}>
                        <select
                          value={selectedBrigade}
                          onChange={(e) => setRowBrigades(prev => ({ ...prev, [key]: e.target.value }))}
                          style={{ width: '100%', maxWidth: '200px', padding: '6px', fontSize: '0.9rem', borderRadius: BRAND.radiusSmall, border: `1px solid ${BRAND.border}` }}
                        >
                          <option value="">Выберите...</option>
                          {brigades.filter(b => b.name !== 'Бригада не найдена').map(b => (
                            <option key={b.id} value={b.name}>{b.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={tdStyle}>
                        <button
                          onClick={() => handleAssign(defect)}
                          style={{
                            padding: '8px 16px',
                            fontSize: '0.9rem',
                            background: '#10B981',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: BRAND.radiusSmall,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Назначить
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p style={{ textAlign: 'center', padding: '30px', color: BRAND.textSecondary, fontSize: '1.2rem' }}>
              Все дефекты имеют владельца 🎉
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===================== СПРАВОЧНИК ===================== */
function DictionaryPanel({
  dictionaryData,
  models,
  brigades,
  password,
  executeWithPassword,
  onDataChanged,
  manageUnlocked,
  onRequestBrigadePassword
}) {
  const [filterModel, setFilterModel] = useState('ALL');
  const [filterBrigade, setFilterBrigade] = useState('ALL');
  const [search, setSearch] = useState('');
  const [newEntry, setNewEntry] = useState({ model: '', part_name: '', problem_type: '', brigadeName: '' });
  const [editEntry, setEditEntry] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMethod, setImportMethod] = useState('text');
  const [importText, setImportText] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [importPasswordModal, setImportPasswordModal] = useState(false);
  const [importError, setImportError] = useState('');
  const [activeSection, setActiveSection] = useState('defects');
  const [newBrigadeName, setNewBrigadeName] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 100;

  // === ИСКЛЮЧАЕМ МОДЕЛИ JAECOO ИЗ СПРАВОЧНИКА (НЕ УДАЛЯЯ ИЗ БД) ===
  const EXCLUDED_MODELS = ['JAECOO J6', 'JAECOO J7', 'JAECOO J8'];

  // Формируем список моделей для выпадающих списков без исключенных
  const availableModels = useMemo(() => {
    return models.filter(m => !EXCLUDED_MODELS.includes(m));
  }, [models]);

  const filteredDictionary = useMemo(() => {
    return dictionaryData.filter(entry => {
      // Скрываем записи с исключенными моделями
      if (EXCLUDED_MODELS.includes(entry.model)) return false;

      const matchModel = filterModel === 'ALL' || entry.model === filterModel;
      const matchBrigade = filterBrigade === 'ALL' || entry.brigade_name === filterBrigade;
      const searchLower = search.toLowerCase();
      const matchSearch = !search || entry.part_name.toLowerCase().includes(searchLower) || entry.problem_type.toLowerCase().includes(searchLower) || entry.model.toLowerCase().includes(searchLower);
      return matchModel && matchBrigade && matchSearch;
    });
  }, [dictionaryData, filterModel, filterBrigade, search]);

  const brigadeOptions = useMemo(() => {
    const set = new Set(dictionaryData.map(e => e.brigade_name).filter(Boolean));
    return Array.from(set).sort();
  }, [dictionaryData]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterModel, filterBrigade, search]);

  const pageCount = Math.ceil(filteredDictionary.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const visibleEntries = filteredDictionary.slice(startIndex, endIndex);

  const handleSaveEntry = (entry) => {
        if (!entry.part_name || !entry.problem_type) {
            alert('Заполните «Деталь» и «Дефект»');
            return;
        }
        if (!entry.brigadeName) {
            alert('Выберите бригаду');
            return;
        }
        if (!entry.model) {
            alert('Выберите модель или «Все модели»');
            return;
        }

        const isAllModels = entry.model === ALL_MODELS_VALUE;

        executeWithPassword(async (pwd) => {
            try {
            const url = isAllModels
                ? `${API_BASE}/api/brigade-report/assign-all-models`
                : `${API_BASE}/api/brigade-report/dictionary`;

            const body = isAllModels
                ? {
                    part_name: entry.part_name,
                    problem_type: entry.problem_type,
                    brigadeName: entry.brigadeName,
                    password: pwd,
                }
                : {
                    model: entry.model,
                    part_name: entry.part_name,
                    problem_type: entry.problem_type,
                    brigadeName: entry.brigadeName,
                    password: pwd,
                };

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Ошибка сохранения');
            }

            const data = await res.json();
            if (isAllModels) {
                alert(`Связка добавлена для ${data.models} моделей ✅`);
            }

            onDataChanged();
            setNewEntry({ model: '', part_name: '', problem_type: '', brigadeName: '' });
            setEditEntry(null);
            } catch (err) {
            alert(err.message);
            }
        });
    };

  const handleDeleteEntry = (id) => {
    executeWithPassword(async (pwd) => {
      try {
        const res = await fetch(`${API_BASE}/api/brigade-report/dictionary/${id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd }),
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'Ошибка удаления');
        }
        onDataChanged();
      } catch (err) {
        alert(err.message);
      }
    });
  };

  const handleAddBrigade = () => {
    const name = newBrigadeName.trim();
    if (!name) {
      alert('Введите название бригады');
      return;
    }
    executeWithPassword(async (pwd) => {
      try {
        const res = await fetch(`${API_BASE}/api/brigade-report/brigades`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, password: pwd }),
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'Ошибка добавления');
        }
        setNewBrigadeName('');
        onDataChanged();
      } catch (err) {
        alert(err.message);
      }
    });
  };

  const handleDeleteBrigade = (id, name) => {
    if (!window.confirm(`Удалить бригаду "${name}"? Все связанные дефекты будут назначены "Бригада не найдена".`)) {
      return;
    }
    executeWithPassword(async (pwd) => {
      try {
        const res = await fetch(`${API_BASE}/api/brigade-report/brigades/${id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd }),
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'Ошибка удаления');
        }
        onDataChanged();
      } catch (err) {
        alert(err.message);
      }
    });
  };

  const executeImport = (entries) => {
    if (entries.length === 0) {
      alert('Нет данных для импорта');
      return;
    }
    fetch(`${API_BASE}/api/brigade-report/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries, password: '4002' }),
    })
      .then(res => {
        if (!res.ok) return res.json().then(err => { throw new Error(err.error || 'Ошибка импорта'); });
        return res.json();
      })
      .then(() => {
        alert(`Импортировано ${entries.length} записей`);
        setShowImportModal(false);
        setImportText('');
        setImportFile(null);
        onDataChanged();
      })
      .catch(err => alert(err.message));
  };

  const handleImportFromText = () => {
    const lines = importText.split('\n').filter(line => line.trim());
    const entries = lines.map(line => {
      const parts = line.split('\t');
      if (parts.length >= 4) {
        return {
          model: parts[0].trim(),
          part_name: parts[1].trim(),
          problem_type: parts[2].trim(),
          brigadeName: parts[3].trim(),
        };
      }
      return null;
    }).filter(e => e && e.model && e.part_name && e.problem_type && e.brigadeName);
    executeImport(entries);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const entries = json.slice(1).map(row => ({
          model: row[0]?.trim(),
          part_name: row[1]?.trim(),
          problem_type: row[2]?.trim(),
          brigadeName: row[3]?.trim(),
        })).filter(e => e.model && e.part_name && e.problem_type && e.brigadeName);
        executeImport(entries);
      } catch (err) {
        alert('Ошибка чтения файла');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleExportExcel = () => {
    if (filteredDictionary.length === 0) {
      alert('Нет данных для экспорта');
      return;
    }
    const exportData = filteredDictionary.map(entry => ({
      'Модель': entry.model,
      'Деталь': entry.part_name,
      'Дефект': entry.problem_type,
      'Бригада': entry.brigade_name || '—',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Справочник');
    XLSX.writeFile(wb, `Справочник_дефектов_${getTodayStr()}.xlsx`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 15 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => setActiveSection('defects')}
          style={subTabStyle(activeSection === 'defects')}
        >
          🔧 Дефекты
        </button>
        <button
          onClick={() => {
            if (!manageUnlocked) {
              onRequestBrigadePassword();
            } else {
              setActiveSection('brigades');
            }
          }}
          style={subTabStyle(activeSection === 'brigades')}
        >
          👷 Управление бригадами
        </button>
      </div>

      {activeSection === 'defects' ? (
        <>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            padding: '15px',
            backgroundColor: '#FFFFFF',
            borderRadius: BRAND.radius,
            border: `1px solid ${BRAND.border}`,
          }}>
            <span style={{ fontWeight: 600, color: BRAND.textSecondary, fontSize: '1rem' }}>Фильтры и поиск:</span>
            <select
              value={filterModel}
              onChange={(e) => setFilterModel(e.target.value)}
              style={{ ...inputStyle, minWidth: '150px' }}
            >
              <option value="ALL">Все модели</option>
              {/* === ИСПОЛЬЗУЕМ ОТФИЛЬТРОВАННЫЙ СПИСОК === */}
              {availableModels.map(model => <option key={model} value={model}>{model}</option>)}
            </select>
            <select
              value={filterBrigade}
              onChange={(e) => setFilterBrigade(e.target.value)}
              style={{ ...inputStyle, minWidth: '180px' }}
            >
              <option value="ALL">Все бригады</option>
              {brigadeOptions.map(brigade => <option key={brigade} value={brigade}>{brigade}</option>)}
            </select>
            <input
              type="text"
              placeholder="Поиск по детали, дефекту, модели"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: '200px', ...inputStyle }}
            />
            <button
              onClick={() => setImportPasswordModal(true)}
              style={{ ...buttonStyle, background: '#8B5CF6' }}
            >
              📥 Импорт
            </button>
            <button
              onClick={handleExportExcel}
              style={{ ...buttonStyle, background: '#059669' }}
            >
              📊 Экспорт
            </button>
          </div>

          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            padding: '15px',
            backgroundColor: '#FFFFFF',
            borderRadius: BRAND.radius,
            border: `1px solid ${BRAND.border}`,
          }}>
            <span style={{ fontWeight: 600, color: BRAND.textSecondary, fontSize: '1rem' }}>Новая связка дефект-бригада:</span>
            <select
                value={newEntry.model}
                onChange={(e) => setNewEntry({ ...newEntry, model: e.target.value })}
                style={{ ...inputStyle, minWidth: '180px' }}
            >
                <option value="">Модель</option>
                <option value={ALL_MODELS_VALUE}>⭐ Все модели</option>
                {/* === ИСПОЛЬЗУЕМ ОТФИЛЬТРОВАННЫЙ СПИСОК === */}
                {availableModels.map(model => (
                    <option key={model} value={model}>{model}</option>
                ))}
            </select>
            <input
              type="text"
              placeholder="Деталь"
              value={newEntry.part_name}
              onChange={(e) => setNewEntry({ ...newEntry, part_name: e.target.value })}
              style={{ ...inputStyle, flex: 1, minWidth: '150px' }}
            />
            <input
              type="text"
              placeholder="Дефект"
              value={newEntry.problem_type}
              onChange={(e) => setNewEntry({ ...newEntry, problem_type: e.target.value })}
              style={{ ...inputStyle, flex: 1, minWidth: '150px' }}
            />
            <select
              value={newEntry.brigadeName}
              onChange={(e) => setNewEntry({ ...newEntry, brigadeName: e.target.value })}
              style={{ ...inputStyle, minWidth: '150px' }}
            >
              <option value="">Бригада</option>
              {brigades.filter(b => b.name !== 'Бригада не найдена').map(b => (
                <option key={b.id} value={b.name}>{b.name}</option>
              ))}
            </select>
            <button
              onClick={() => handleSaveEntry(newEntry)}
              style={{ ...buttonStyle, background: BRAND.primary }}
            >
              Добавить
            </button>
          </div>

          <div style={cardStyle}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: BRAND.text, marginBottom: '10px', flexShrink: 0 }}>
              Справочник дефектов и бригад
            </h2>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: `1px solid ${BRAND.border}`, borderRadius: BRAND.radiusSmall }}>
              {visibleEntries.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Модель</th>
                      <th style={thStyle}>Деталь</th>
                      <th style={thStyle}>Дефект</th>
                      <th style={thStyle}>Бригада</th>
                      <th style={thStyle}>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEntries.map(entry => (
                      <tr key={entry.id} style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                        <td style={tdStyle}>{entry.model}</td>
                        <td style={tdStyle}>{entry.part_name}</td>
                        <td style={tdStyle}>{entry.problem_type}</td>
                        <td style={tdStyle}>
                          {editEntry && editEntry.id === entry.id ? (
                            <select
                              value={editEntry.brigadeName}
                              onChange={(e) => setEditEntry({ ...editEntry, brigadeName: e.target.value })}
                              style={{ padding: '5px', fontSize: '0.9rem', borderRadius: BRAND.radiusSmall, border: `1px solid ${BRAND.border}` }}
                            >
                              {brigades.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                            </select>
                          ) : (
                            entry.brigade_name || '—'
                          )}
                        </td>
                        <td style={tdStyle}>
                          {editEntry && editEntry.id === entry.id ? (
                            <>
                              <button
                                onClick={() => handleSaveEntry(editEntry)}
                                style={{ marginRight: 5, padding: '5px 10px', background: '#10B981', color: '#FFF', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.9rem' }}
                              >
                                Сохранить
                              </button>
                              <button
                                onClick={() => setEditEntry(null)}
                                style={{ padding: '5px 10px', background: '#6B7280', color: '#FFF', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.9rem' }}
                              >
                                Отмена
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => setEditEntry({ id: entry.id, model: entry.model, part_name: entry.part_name, problem_type: entry.problem_type, brigadeName: entry.brigade_name })}
                                style={{ marginRight: 5, padding: '5px 10px', background: '#F59E0B', color: '#FFF', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.9rem' }}
                              >
                                Изменить
                              </button>
                              <button
                                onClick={() => handleDeleteEntry(entry.id)}
                                style={{ padding: '5px 10px', background: '#EF4444', color: '#FFF', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.9rem' }}
                              >
                                Удалить
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ backgroundColor: '#F0F5FF', fontWeight: 700 }}>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>Итого:</td>
                      <td style={{ ...tdStyle }} colSpan={3}></td>
                      <td style={{ ...tdStyle, fontWeight: 700, textAlign: 'center' }}>{filteredDictionary.length}</td>
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <p style={{ textAlign: 'center', padding: '30px', color: BRAND.textSecondary, fontSize: '1.2rem' }}>
                  Нет записей
                </p>
              )}
            </div>

            {pageCount > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  style={{ ...buttonStyle, background: currentPage === 1 ? '#CBD5E1' : BRAND.primary }}
                >
                  ←
                </button>
                <span style={{ fontSize: '1rem' }}>
                  Страница {currentPage} из {pageCount}
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(pageCount, prev + 1))}
                  disabled={currentPage === pageCount}
                  style={{ ...buttonStyle, background: currentPage === pageCount ? '#CBD5E1' : BRAND.primary }}
                >
                  →
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 15 }}>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            padding: '15px',
            backgroundColor: '#FFFFFF',
            borderRadius: BRAND.radius,
            border: `1px solid ${BRAND.border}`,
          }}>
            <span style={{ fontWeight: 600, color: BRAND.textSecondary, fontSize: '1rem' }}>Добавить бригаду:</span>
            <input
              type="text"
              placeholder="Название бригады"
              value={newBrigadeName}
              onChange={(e) => setNewBrigadeName(e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: '200px' }}
            />
            <button
              onClick={handleAddBrigade}
              style={{ ...buttonStyle, background: '#10B981' }}
            >
              Добавить
            </button>
          </div>

          <div style={{ ...cardStyle, flex: 1 }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: BRAND.text, marginBottom: '10px' }}>Список бригад</h2>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: `1px solid ${BRAND.border}`, borderRadius: BRAND.radiusSmall }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>ID</th>
                    <th style={thStyle}>Название</th>
                    <th style={thStyle}>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {brigades.map(brigade => (
                    <tr key={brigade.id} style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                      <td style={tdStyle}>{brigade.id}</td>
                      <td style={tdStyle}>{brigade.name}</td>
                      <td style={tdStyle}>
                        {brigade.name !== 'Бригада не найдена' && (
                          <button
                            onClick={() => handleDeleteBrigade(brigade.id, brigade.name)}
                            style={{ padding: '5px 10px', background: '#EF4444', color: '#FFF', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.9rem' }}
                          >
                            Удалить
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {importPasswordModal && (
        <PasswordModal
          isOpen={importPasswordModal}
          onClose={() => setImportPasswordModal(false)}
          onSubmit={(pwd) => {
            if (pwd === '4002') {
              setImportPasswordModal(false);
              setShowImportModal(true);
              setImportError('');
            } else {
              setImportError('Неверный пароль');
            }
          }}
          error={importError}
          title="Пароль для импорта"
          subtitle="Введите специальный пароль для импорта справочника"
        />
      )}

      {showImportModal && (
        <div style={modalOverlayStyle} onClick={() => setShowImportModal(false)}>
          <div style={wideModalStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '1.8rem', fontWeight: 700 }}>Импорт справочника</h2>
            <p style={{ fontSize: '0.9rem', color: BRAND.textSecondary, marginBottom: 15 }}>
              Выберите способ импорта: загрузите файл Excel или вставьте текст.
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
              <button
                onClick={() => setImportMethod('text')}
                style={{ ...buttonStyle, background: importMethod === 'text' ? BRAND.primary : '#E2E8F0', color: importMethod === 'text' ? '#FFF' : '#374151' }}
              >
                Вставить текст
              </button>
              <button
                onClick={() => setImportMethod('file')}
                style={{ ...buttonStyle, background: importMethod === 'file' ? BRAND.primary : '#E2E8F0', color: importMethod === 'file' ? '#FFF' : '#374151' }}
              >
                Загрузить файл
              </button>
            </div>

            {importMethod === 'text' ? (
              <>
                <p style={{ fontSize: '0.85rem', color: BRAND.textSecondary }}>
                  Каждая строка: <b>Модель[Tab]Деталь[Tab]Дефект[Tab]Бригада</b><br/>
                  Пример: <code>JELAND J6[Tab]Бампер[Tab]Повреждение[Tab]EG/SUB</code>
                </p>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  style={{ width: '100%', height: '250px', fontSize: '0.9rem', padding: '10px', borderRadius: BRAND.radiusSmall, border: `1px solid ${BRAND.border}`, fontFamily: 'monospace' }}
                  placeholder={'JELAND J6\tБампер\tПовреждение\tEG/SUB\nJELAND J7\tДверь\tВмятина\tBS Final Line'}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 15, gap: 10 }}>
                  <button onClick={() => setShowImportModal(false)} style={{ ...buttonStyle, background: '#6B7280' }}>Отмена</button>
                  <button onClick={handleImportFromText} style={{ ...buttonStyle, background: '#8B5CF6' }}>Импортировать</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: '0.85rem', color: BRAND.textSecondary }}>
                  Файл Excel должен иметь столбцы: <b>Модель, Деталь, Дефект, Бригада</b> (первая строка — заголовки).
                </p>
                <input
                  type="file"
                  accept=".xlsx, .xls"
                  onChange={handleFileUpload}
                  style={{ fontSize: '0.9rem', marginBottom: 15 }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button onClick={() => setShowImportModal(false)} style={{ ...buttonStyle, background: '#6B7280' }}>Отмена</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== ВКЛАДКА ВЛАДЕЛЬЦЫ ДЕФЕКТОВ ===================== */
function DefectOwnersManager({ brigades, password, executeWithPassword }) {
  const [subTab, setSubTab] = useState('assign');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  const [dictionaryData, setDictionaryData] = useState([]);
  const [models, setModels] = useState([]);
  const [brigadeList, setBrigadeList] = useState(brigades);
  const [brigadeManageUnlocked, setBrigadeManageUnlocked] = useState(
    sessionStorage.getItem('brigade_manage_unlocked') === 'true'
  );
  const [showBrigadePasswordModal, setShowBrigadePasswordModal] = useState(false);
  const [brigadePasswordError, setBrigadePasswordError] = useState('');

  const loadDictionary = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/brigade-report/dictionary`);
      if (res.ok) {
        const data = await res.json();
        setDictionaryData(data);
      }
    } catch (err) {
      console.error('Ошибка загрузки словаря', err);
    }
  };

  const loadModels = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/brigade-report/models`);
      if (res.ok) {
        const data = await res.json();
        setModels(data);
      }
    } catch (err) {
      console.error('Ошибка загрузки моделей', err);
    }
  };

  const loadBrigades = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/brigade-report/brigades`);
      if (res.ok) {
        const data = await res.json();
        setBrigadeList(data);
      }
    } catch (err) {
      console.error('Ошибка загрузки бригад', err);
    }
  };

  useEffect(() => {
    loadDictionary();
    loadModels();
    loadBrigades();
  }, []);

  useEffect(() => {
    setBrigadeList(brigades);
  }, [brigades]);

  const handleRefresh = () => {
    loadDictionary();
    loadModels();
    loadBrigades();
    setRefreshTrigger(prev => prev + 1);
  };

  const handleBrigadePasswordSubmit = (pwd) => {
    if (pwd === '4002') {
      sessionStorage.setItem('brigade_manage_unlocked', 'true');
      setBrigadeManageUnlocked(true);
      setShowBrigadePasswordModal(false);
      setBrigadePasswordError('');
    } else {
      setBrigadePasswordError('Неверный пароль');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 15, alignItems: 'center' }}>
        <button
          onClick={() => setSubTab('assign')}
          style={subTabStyle(subTab === 'assign')}
        >
          🎯 Назначение бригад
        </button>
        <button
          onClick={() => setSubTab('dictionary')}
          style={subTabStyle(subTab === 'dictionary')}
        >
          📚 Справочник
        </button>
        <button
          onClick={() => setShowHelp(true)}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: `2px solid ${BRAND.primary}`,
            background: '#FFFFFF',
            color: BRAND.primary,
            fontSize: '1.2rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Помощь"
        >
          ?
        </button>
      </div>

      {subTab === 'assign' ? (
        <AssignBrigadesPanel
          brigades={brigadeList}
          password={password}
          executeWithPassword={executeWithPassword}
          refreshTrigger={refreshTrigger}
        />
      ) : (
        <DictionaryPanel
          dictionaryData={dictionaryData}
          models={models}
          brigades={brigadeList}
          password={password}
          executeWithPassword={executeWithPassword}
          onDataChanged={handleRefresh}
          manageUnlocked={brigadeManageUnlocked}
          onRequestBrigadePassword={() => setShowBrigadePasswordModal(true)}
        />
      )}

      {showHelp && <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />}

      {showBrigadePasswordModal && (
        <PasswordModal
          isOpen={showBrigadePasswordModal}
          onClose={() => setShowBrigadePasswordModal(false)}
          onSubmit={handleBrigadePasswordSubmit}
          error={brigadePasswordError}
          title="Введите пароль"
          subtitle="Для доступа к управлению бригадами"
        />
      )}
    </div>
  );
}

/* ===================== ГЛАВНЫЙ КОМПОНЕНТ СТРАНИЦЫ ===================== */
export default function BrigadeReportPage() {
  const [activeTab, setActiveTab] = useState('general');
  const [brigades, setBrigades] = useState([]);
  const [password, setPassword] = useState(sessionStorage.getItem('brigade_password') || '');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [pendingAction, setPendingAction] = useState(null);

  const loadBrigades = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/brigade-report/brigades`);
      if (!res.ok) throw new Error('Ошибка загрузки бригад');
      const data = await res.json();
      setBrigades(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadBrigades();
  }, []);

  const executeWithPassword = (action) => {
    if (password) {
      action(password);
    } else {
      setPendingAction(() => action);
      setShowPasswordModal(true);
    }
  };

  const handlePasswordSubmit = (pwd) => {
    if (pwd === '1234561') {
      sessionStorage.setItem('brigade_password', pwd);
      setPassword(pwd);
      setShowPasswordModal(false);
      if (pendingAction) {
        pendingAction(pwd);
        setPendingAction(null);
      }
      setPasswordError('');
    } else {
      setPasswordError('Неверный пароль');
    }
  };

  const handleTabChange = (tab) => {
    if (tab === 'owners' && !password) {
      setPendingAction(() => (pwd) => {
        setPassword(pwd);
        setActiveTab('owners');
      });
      setShowPasswordModal(true);
    } else {
      setActiveTab(tab);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>Бригадный отчет</h1>
        <div style={tabBarStyle}>
          <button
            style={tabStyle(activeTab === 'general')}
            onClick={() => handleTabChange('general')}
          >
            Общий отчет
          </button>
          <button
            style={tabStyle(activeTab === 'generalByShift')}
            onClick={() => handleTabChange('generalByShift')}
          >
            📊 Общий отчет по сменам
          </button>
          <button
            style={tabStyle(activeTab === 'brigade')}
            onClick={() => handleTabChange('brigade')}
          >
            📊 Отчет по бригадам
          </button>
          <button
            style={tabStyle(activeTab === 'owners')}
            onClick={() => handleTabChange('owners')}
          >
            👥 Владельцы дефектов
          </button>
        </div>
      </div>

      {activeTab === 'general' ? (
        <BrigadeReport
          brigades={brigades}
          password={password}
          executeWithPassword={executeWithPassword}
        />
      ) : activeTab === 'generalByShift' ? (
        <BrigadeReportByShift
          brigades={brigades}
          password={password}
          executeWithPassword={executeWithPassword}
        />
      ) : activeTab === 'brigade' ? (
        <BrigadeTrendReport
          brigades={brigades}
          password={password}
          executeWithPassword={executeWithPassword}
        />
      ) : (
        <DefectOwnersManager
          brigades={brigades}
          password={password}
          executeWithPassword={executeWithPassword}
        />
      )}

      {showPasswordModal && (
        <PasswordModal
          isOpen={showPasswordModal}
          onClose={() => setShowPasswordModal(false)}
          onSubmit={handlePasswordSubmit}
          error={passwordError}
          title="Введите пароль"
          subtitle="Для доступа к вкладке «Владельцы дефектов»"
        />
      )}
    </div>
  );
}