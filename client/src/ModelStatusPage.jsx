import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  ReferenceLine, LabelList, ResponsiveContainer
} from 'recharts';
import * as XLSX from 'xlsx';
import { checkPassword, passwordErrorText } from './checkPassword';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const API_BASE = '';

/* ===================== БРЕНДБУК ===================== */
const BRAND = {
  bg: '#F8FAFC',
  cardBg: '#FFFFFF',
  primary: '#2563EB',
  accent: '#F59E0B',
  text: '#1E293B',
  textSecondary: '#64748B',
  border: '#E2E8F0',
  shadow: '0 8px 30px rgba(0,0,0,0.08)',
  radius: 16,
  radiusSmall: 8,
  fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
};

const modelColors = {
  'ESTEO MX': '#F59E0B',
  'JELAND J6': '#6EE7B7',
  'JELAND J7': '#8B5CF6',
  'TENET A8': '#3B82F6',
  'JELAND J8': '#EC4899',
};

function formatPeriodLabel(period, periodType) {
  if (!period) return '';
  if (periodType === 'month') {
    const [year, month] = period.split('-');
    const monthNames = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
    return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
  } else if (periodType === 'week') {
    const week = period.split('-')[1];
    return `W${week}`;
  } else if (periodType === 'day') {
    const [y, m, d] = period.split('-');
    return `${d}.${m}`;
  }
  return period;
}

/* ============ УНИВЕРСАЛЬНЫЙ КОМПОНЕНТ АВТОРАССЫЛКИ ============ */
const EmailSenderButton = ({ targetRef, pageTitle }) => {
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [emailForm, setEmailForm] = useState({
    to: '', cc: '', subject: pageTitle || 'Отчёт', body: '', signatureText: '', signatureImage: '', senderName: 'MBS Quality System',
  });
  const [schedule, setSchedule] = useState({ days: [1, 2, 3, 4, 5], times: ['08:00', '12:00', '16:00'] });
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    if (passwordModalOpen || settingsModalOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [passwordModalOpen, settingsModalOpen]);

  const loadSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/email-settings`);
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setEmailForm(prev => ({
            ...prev, to: data.to || '', cc: data.cc || '', subject: data.subject || pageTitle || 'Отчёт',
            body: data.body || '', signatureText: data.signature_text || '', signatureImage: data.signature_image || '',
            senderName: data.sender_name || 'MBS Quality System',
          }));
          if (data.schedule) setSchedule(prev => ({ ...prev, days: data.schedule.days || prev.days, times: data.schedule.times || prev.times }));
        }
      }
    } catch (err) { console.error(err); }
  };

  const saveSettings = async () => {
    try {
      await fetch(`${API_BASE}/api/email-settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emailForm.to, cc: emailForm.cc, subject: emailForm.subject, body: emailForm.body,
          signature_text: emailForm.signatureText, signature_image: emailForm.signatureImage,
          sender_name: emailForm.senderName, schedule: schedule,
        }),
      });
      setSavedMessage('Настройки сохранены');
      setTimeout(() => setSavedMessage(''), 3000);
    } catch (err) { console.error(err); alert('Ошибка сохранения'); }
  };

  const handlePasswordSubmit = async () => {
    const result = await checkPassword('main', password);
    if (result === 'ok') {
      setPasswordModalOpen(false); setSettingsModalOpen(true); setPassword(''); setError(''); loadSettings();
    } else setError(passwordErrorText(result));
  };

  const generatePdf = async () => {
    const canvas = await html2canvas(targetRef.current, { scale: 2, useCORS: true, logging: false, windowWidth: targetRef.current.scrollWidth, windowHeight: targetRef.current.scrollHeight });
    const imgData = canvas.toDataURL('image/jpeg', 0.85);
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    const pageHeight = pdf.internal.pageSize.getHeight();
    let heightLeft = pdfHeight; let position = 0;
    pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position -= pageHeight; pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;
    }
    return pdf;
  };

  const handleSendNow = async () => {
    try {
      await saveSettings();
      const pdf = await generatePdf();
      const pdfUrl = URL.createObjectURL(pdf.output('blob'));
      const link = document.createElement('a'); link.href = pdfUrl; link.download = `${pageTitle || 'report'}.pdf`; link.click(); URL.revokeObjectURL(pdfUrl);
      window.location.href = `mailto:${emailForm.to}?cc=${emailForm.cc}&subject=${encodeURIComponent(emailForm.subject)}&body=${encodeURIComponent(emailForm.body)}`;
      setSettingsModalOpen(false);
    } catch (err) { alert('Ошибка: ' + err.message); }
  };

  const handleSignatureUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setEmailForm(prev => ({ ...prev, signatureImage: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const toggleDay = (day) => setSchedule(prev => ({ ...prev, days: prev.days.includes(day) ? prev.days.filter(d => d !== day) : [...prev.days, day] }));
  const toggleTime = (time) => setSchedule(prev => ({ ...prev, times: prev.times.includes(time) ? prev.times.filter(t => t !== time) : [...prev.times, time] }));

  const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const timeOptions = ['00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00'];

  const overlayStyle = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px' };
  const modalStyle = { backgroundColor: '#FFFFFF', borderRadius: '24px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto', padding: '32px', fontFamily: BRAND.fontFamily, color: BRAND.text, boxSizing: 'border-box', margin: '0 auto', border: '1px solid rgba(255,255,255,0.5)', position: 'relative' };
  const modalWideStyle = { ...modalStyle, maxWidth: '720px' };
  const inputStyle = { width: '100%', padding: '12px 16px', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '0.95rem', fontFamily: BRAND.fontFamily, color: BRAND.text, backgroundColor: '#F8FAFC', outline: 'none', transition: 'all 0.2s', boxSizing: 'border-box', marginBottom: '16px' };
  const labelStyle = { display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '0.85rem', color: '#475569', letterSpacing: '0.02em' };
  const buttonPrimary = { padding: '12px 24px', borderRadius: '10px', border: 'none', background: BRAND.primary, color: '#FFFFFF', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem', transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(37,99,235,0.2)' };
  const buttonSecondary = { padding: '12px 24px', borderRadius: '10px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: BRAND.text, fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem', transition: 'all 0.2s' };

  return (
    <>
      <button onClick={() => setPasswordModalOpen(true)} style={{ padding: '12px 24px', borderRadius: '10px', border: 'none', fontWeight: 700, fontSize: '1rem', background: BRAND.accent, color: '#FFFFFF', cursor: 'pointer', boxShadow: BRAND.shadow, transition: 'all 0.2s', fontFamily: BRAND.fontFamily }}>
        ⚙️ Настройка авторассылки
      </button>

      {passwordModalOpen && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <div style={{ width: '48px', height: '48px', backgroundColor: '#EFF6FF', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', marginBottom: '16px', color: BRAND.primary }}>🔒</div>
            <h3 style={{ margin: '0 0 8px 0', color: BRAND.text, fontWeight: 700, fontSize: '1.5rem' }}>Введите пароль</h3>
            <p style={{ margin: '0 0 20px 0', color: BRAND.textSecondary, fontSize: '0.9rem' }}>Для доступа к настройкам авторассылки</p>
            {error && <p style={{ color: '#EF4444', marginBottom: 10, fontSize: '0.9rem' }}>{error}</p>}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handlePasswordSubmit()} placeholder="Пароль" style={inputStyle} autoFocus />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: '8px' }}>
              <button onClick={() => setPasswordModalOpen(false)} style={buttonSecondary}>Отмена</button>
              <button onClick={handlePasswordSubmit} style={buttonPrimary}>Войти</button>
            </div>
          </div>
        </div>
      )}

      {settingsModalOpen && (
        <div style={overlayStyle}>
          <div style={modalWideStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid #E2E8F0', paddingBottom: '16px' }}>
              <h3 style={{ margin: 0, color: BRAND.text, fontWeight: 700, fontSize: '1.5rem' }}>⚙️ Настройка авторассылки</h3>
              <button onClick={() => setSettingsModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: BRAND.textSecondary, lineHeight: 1 }}>×</button>
            </div>
            {savedMessage && <p style={{ color: '#10B981', marginBottom: 12, fontWeight: 600, fontSize: '0.9rem' }}>{savedMessage}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div><label style={labelStyle}>Кому:</label><input type="text" value={emailForm.to} onChange={(e) => setEmailForm({ ...emailForm, to: e.target.value })} style={inputStyle} /></div>
              <div><label style={labelStyle}>Копия:</label><input type="text" value={emailForm.cc} onChange={(e) => setEmailForm({ ...emailForm, cc: e.target.value })} style={inputStyle} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div><label style={labelStyle}>Отправитель (имя):</label><input type="text" value={emailForm.senderName} onChange={(e) => setEmailForm({ ...emailForm, senderName: e.target.value })} style={inputStyle} /></div>
              <div><label style={labelStyle}>Тема:</label><input type="text" value={emailForm.subject} onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })} style={inputStyle} /></div>
            </div>
            <div><label style={labelStyle}>Текст письма:</label><textarea rows={4} value={emailForm.body} onChange={(e) => setEmailForm({ ...emailForm, body: e.target.value })} style={{ ...inputStyle, resize: 'vertical' }} /></div>
            <div><label style={labelStyle}>Подпись (текст):</label><textarea rows={3} value={emailForm.signatureText} onChange={(e) => setEmailForm({ ...emailForm, signatureText: e.target.value })} style={{ ...inputStyle, resize: 'vertical' }} /></div>
            <div>
              <label style={labelStyle}>Изображение подписи (логотип):</label>
              <input type="file" accept="image/*" onChange={handleSignatureUpload} style={{ marginBottom: 12, fontSize: '0.9rem', color: BRAND.textSecondary }} />
              {emailForm.signatureImage && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '12px' }}>
                  <img src={emailForm.signatureImage} alt="Подпись" style={{ maxWidth: '180px', maxHeight: '80px', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '4px', backgroundColor: '#FFFFFF' }} />
                  <button onClick={() => setEmailForm({ ...emailForm, signatureImage: '' })} style={{ padding: '6px 12px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid #FCA5A5', borderRadius: '6px', background: '#FEF2F2', color: '#DC2626', fontWeight: 600 }}>Удалить</button>
                </div>
              )}
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>Дни недели:</label>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: '16px' }}>
                {dayNames.map((name, idx) => (
                  <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.9rem', padding: '6px 12px', borderRadius: '8px', backgroundColor: schedule.days.includes(idx) ? '#EFF6FF' : '#F8FAFC', border: '1px solid ' + (schedule.days.includes(idx) ? '#93C5FD' : '#E2E8F0') }}>
                    <input type="checkbox" checked={schedule.days.includes(idx)} onChange={() => toggleDay(idx)} style={{ accentColor: BRAND.primary }} />
                    {name}
                  </label>
                ))}
              </div>
              <label style={labelStyle}>Время отправки (можно несколько):</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', maxHeight: '160px', overflowY: 'auto', border: '1px solid #E2E8F0', padding: '12px', borderRadius: '10px', backgroundColor: '#F8FAFC' }}>
                {timeOptions.map(time => (
                  <label key={time} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem', padding: '6px 8px', borderRadius: '6px', backgroundColor: schedule.times.includes(time) ? '#EFF6FF' : '#FFFFFF', border: '1px solid ' + (schedule.times.includes(time) ? '#93C5FD' : '#E2E8F0') }}>
                    <input type="checkbox" checked={schedule.times.includes(time)} onChange={() => toggleTime(time)} style={{ accentColor: BRAND.primary }} />
                    {time}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: '24px', borderTop: '1px solid #E2E8F0', paddingTop: '20px' }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={saveSettings} style={buttonSecondary}>💾 Сохранить</button>
                <button onClick={() => setSettingsModalOpen(false)} style={buttonSecondary}>Закрыть</button>
              </div>
              <button onClick={handleSendNow} style={buttonPrimary}>📧 Отправить сейчас</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/* ============ ДРОПДАУН МОДЕЛЕЙ ============ */
const ModelFilterDropdown = ({ allModels, selectedModels, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const handleToggle = (model) => {
    const updated = selectedModels.includes(model)
      ? selectedModels.filter(m => m !== model)
      : [...selectedModels, model];
    onChange(updated);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{ padding: '12px 24px', borderRadius: BRAND.radiusSmall, border: `1px solid ${BRAND.border}`, background: '#FFFFFF', fontWeight: 700, fontSize: '1rem', color: BRAND.textSecondary, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', transition: 'all 0.2s', fontFamily: BRAND.fontFamily }}
      >
        <span>🏷️ Модели</span>
        <span style={{ color: BRAND.textSecondary, fontSize: '0.9rem', fontWeight: 400 }}>
          {selectedModels.length === allModels.length ? 'Все' : selectedModels.length}
        </span>
      </button>
      {isOpen && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#FFFFFF', borderRadius: BRAND.radiusSmall, boxShadow: BRAND.shadow, padding: 12, minWidth: 220, zIndex: 20, border: `1px solid ${BRAND.border}` }}>
          {allModels.map(model => (
            <label key={model} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer', fontSize: 14 }}>
              <input type="checkbox" checked={selectedModels.includes(model)} onChange={() => handleToggle(model)} />
              <span style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: modelColors[model], display: 'inline-block' }} />
              {model}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

/* ============ БЛОК ГРАФИКА ============ */
const BarChartBlock = ({ title, data, periodType, isLoading, visibleModels, yAxisDomain, onDetailsClick, metricType }) => {
  if (isLoading) return <div style={styles.loading}>Загрузка...</div>;
  if (!data || data.length === 0) return <div style={styles.loading}>Нет данных</div>;

  const allModels = Object.keys(modelColors);
  const modelsToShow = allModels.filter(m => visibleModels.includes(m));
  const [activeModel, setActiveModel] = useState(null);

  const chartData = data.map(d => {
    const entry = { name: formatPeriodLabel(d.period, periodType) };
    modelsToShow.forEach(m => { entry[m] = d.values?.[m] || 0; });
    entry.target = d.target || 0;
    return entry;
  });

  const targetValue = chartData[0]?.target || 0;
  const allPeriods = [...new Set(data.map(d => d.period).filter(Boolean))].sort();

  let detailPeriodType = 'day';
  if (title.includes('Месяцы')) detailPeriodType = 'month';
  else if (title.includes('Недели')) detailPeriodType = 'week';

  const handleDetailsClick = () => {
    if (onDetailsClick && allPeriods.length > 0) onDetailsClick(allPeriods, metricType, detailPeriodType);
  };

  return (
    <div style={{ flex: 1, minWidth: '260px', margin: '0 6px', backgroundColor: BRAND.cardBg, borderRadius: BRAND.radiusSmall, padding: 10, boxShadow: BRAND.shadow }} onMouseLeave={() => setActiveModel(null)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: BRAND.text }}>{title}</h3>
        <button onClick={handleDetailsClick} title="Детали" style={{ background: 'none', border: `1px solid ${BRAND.border}`, borderRadius: 6, cursor: 'pointer', fontSize: 16, padding: '2px 8px', color: BRAND.textSecondary }}>📋</button>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={BRAND.border} />
          <XAxis dataKey="name" stroke={BRAND.textSecondary} fontSize={11} interval={0} />
          <YAxis domain={yAxisDomain || ['auto', 'auto']} stroke={BRAND.textSecondary} fontSize={11} />
          <Legend wrapperStyle={{ color: BRAND.textSecondary, fontSize: 12 }} />
          {modelsToShow.map(model => (
            <Bar key={model} dataKey={model} fill={modelColors[model]} barSize={14} opacity={activeModel ? (activeModel === model ? 1 : 0.3) : 1} onMouseEnter={() => setActiveModel(model)} isAnimationActive={false}>
              <LabelList dataKey={model} position="top" style={{ fill: BRAND.textSecondary, fontSize: 10, opacity: activeModel ? (activeModel === model ? 1 : 0.3) : 1 }} />
            </Bar>
          ))}
          <ReferenceLine y={targetValue} stroke="#EF4444" strokeDasharray="5 5" label={{ value: targetValue, position: 'right', style: { fill: '#EF4444', fontSize: 12, fontWeight: 600, textDecoration: 'underline' } }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

/* ============ ТАБЛИЦА CPA С РАСШИРЕНИЕМ ============ */
const EditableTable = ({ visibleModels, cp7DpuDays, cp7DrrDays, cp8DpuDays, cp8DrrDays, selectedDate, expandComplectations, complectMetrics }) => {
  const headers = ['Model', 'CP7 DPU OFF', 'CP7 DRR', 'CP8 DPU OFF', 'CP8 DRR', 'CPA Score'];
  const [cpaValues, setCpaValues] = useState({});
  const [cpaLoaded, setCpaLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/cpa-scores`).then(res => res.json()).then(data => { setCpaValues(data || {}); setCpaLoaded(true); }).catch(() => setCpaLoaded(true));
  }, []);

  const handleSaveAllCpa = () => {
    const promises = Object.entries(cpaValues).map(([model, score]) => fetch(`${API_BASE}/api/cpa-scores`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, score }) }));
    Promise.all(promises).then(() => alert('CPA сохранены')).catch(err => console.error(err));
  };

  const handleCpaChange = (model, value) => setCpaValues(prev => ({ ...prev, [model]: value }));

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}.${parts[1]}`;
  };

  // РАСЧЕТ ОСНОВНЫХ СТРОК
  const rows = useMemo(() => {
    const normalizeDate = (str) => (str || '').trim().slice(0, 10);
    const todayStr = new Date().toISOString().split('T')[0];

    const getLastNonZero = (daysArray, model, excludeToday = false) => {
      if (!Array.isArray(daysArray) || daysArray.length === 0) return { value: 0, date: '' };
      const valid = daysArray.filter(e => e && e.values && model in e.values).sort((a, b) => (b.period || '').localeCompare(a.period || ''));
      for (let entry of valid) {
        const dateStr = normalizeDate(entry.period);
        if (excludeToday && dateStr === todayStr) continue;
        const num = Number(entry.values[model]);
        if (!isNaN(num) && num !== 0) return { value: num, date: dateStr };
      }
      return { value: 0, date: '' };
    };

    const getValueForDate = (daysArray, model, targetDate) => {
      if (!Array.isArray(daysArray) || daysArray.length === 0) return { value: 0, date: '' };
      const entry = daysArray.find(d => normalizeDate(d.period) === targetDate && d.values && model in d.values);
      if (entry) {
        const num = Number(entry.values[model]);
        if (!isNaN(num) && num !== 0) return { value: num, date: targetDate };
      }
      return { value: 0, date: '' };
    };

    const isDefault = selectedDate === 'default';
    return visibleModels.map(model => {
      let cp7Dpu, cp7Drr, cp8Dpu, cp8Drr;
      if (isDefault) {
        cp7Dpu = getLastNonZero(cp7DpuDays, model, true); cp7Drr = getLastNonZero(cp7DrrDays, model, true);
        cp8Dpu = getLastNonZero(cp8DpuDays, model, false); cp8Drr = getLastNonZero(cp8DrrDays, model, false);
      } else {
        cp7Dpu = getValueForDate(cp7DpuDays, model, selectedDate); cp7Drr = getValueForDate(cp7DrrDays, model, selectedDate);
        cp8Dpu = getValueForDate(cp8DpuDays, model, selectedDate); cp8Drr = getValueForDate(cp8DrrDays, model, selectedDate);
      }
      return {
        model,
        cp7DpuOff: cp7Dpu.value !== 0 ? cp7Dpu.value.toFixed(2) : '',
        cp7DpuDate: cp7Dpu.date ? formatDate(cp7Dpu.date) : '',
        cp7Drr: cp7Drr.value !== 0 ? cp7Drr.value.toFixed(1) : '',
        cp7DrrDate: cp7Drr.date ? formatDate(cp7Drr.date) : '',
        cp8DpuOff: cp8Dpu.value !== 0 ? cp8Dpu.value.toFixed(2) : '',
        cp8DpuDate: cp8Dpu.date ? formatDate(cp8Dpu.date) : '',
        cp8DrrMes: cp8Drr.value !== 0 ? cp8Drr.value.toFixed(1) : '',
        cp8DrrDate: cp8Drr.date ? formatDate(cp8Drr.date) : '',
        cpaScore: cpaValues[model] || '',
      };
    });
  }, [visibleModels, cp7DpuDays, cp7DrrDays, cp8DpuDays, cp8DrrDays, selectedDate, cpaValues]);

  // РАСЧЕТ СТРОК КОМПЛЕКТАЦИЙ (с приведением value к числу)
  const complectationRows = useMemo(() => {
    if (!expandComplectations) return {};
    const result = {};
    const normalizeDate = (str) => (str || '').trim().slice(0, 10);
    const todayStr = new Date().toISOString().split('T')[0];

    const getLastNonZeroComp = (daysArray, model, comp) => {
      const valid = daysArray
        .filter(e => (e.model || '').trim() === (model || '').trim() && (e.complectation || '').trim() === (comp || '').trim())
        .sort((a, b) => (b.period || '').localeCompare(a.period || ''));
      for (let entry of valid) {
        if (normalizeDate(entry.period) === todayStr) continue;
        const num = Number(entry.value);          // ← фикс: DECIMAL приходит строкой
        if (!isNaN(num) && num !== 0) return { value: num, date: normalizeDate(entry.period) };
      }
      return { value: 0, date: '' };
    };

    const getValueForDateComp = (daysArray, model, comp, targetDate) => {
      const entry = daysArray.find(
        e => (e.model || '').trim() === (model || '').trim()
          && (e.complectation || '').trim() === (comp || '').trim()
          && normalizeDate(e.period) === targetDate
      );
      if (entry) {
        const num = Number(entry.value);          // ← фикс: DECIMAL приходит строкой
        if (!isNaN(num) && num !== 0) return { value: num, date: targetDate };
      }
      return { value: 0, date: '' };
    };

    visibleModels.forEach(model => {
      const comps = new Set();
      ['cp7Dpu', 'cp7Drr', 'cp8Dpu', 'cp8Drr'].forEach(key => {
        (complectMetrics[key] || []).forEach(d => {
          if ((d.model || '').trim() === (model || '').trim()) comps.add(d.complectation || 'Не указана');
        });
      });

      const compRows = [];
      Array.from(comps).sort().forEach(comp => {
        let cp7Dpu, cp7Drr, cp8Dpu, cp8Drr;
        const isDefault = selectedDate === 'default';
        if (isDefault) {
          cp7Dpu = getLastNonZeroComp(complectMetrics.cp7Dpu || [], model, comp);
          cp7Drr = getLastNonZeroComp(complectMetrics.cp7Drr || [], model, comp);
          cp8Dpu = getLastNonZeroComp(complectMetrics.cp8Dpu || [], model, comp);
          cp8Drr = getLastNonZeroComp(complectMetrics.cp8Drr || [], model, comp);
        } else {
          cp7Dpu = getValueForDateComp(complectMetrics.cp7Dpu || [], model, comp, selectedDate);
          cp7Drr = getValueForDateComp(complectMetrics.cp7Drr || [], model, comp, selectedDate);
          cp8Dpu = getValueForDateComp(complectMetrics.cp8Dpu || [], model, comp, selectedDate);
          cp8Drr = getValueForDateComp(complectMetrics.cp8Drr || [], model, comp, selectedDate);
        }
        compRows.push({
          complectation: comp,
          cp7DpuOff: cp7Dpu.value !== 0 ? cp7Dpu.value.toFixed(2) : '',
          cp7DpuDate: cp7Dpu.date ? formatDate(cp7Dpu.date) : '',
          cp7Drr: cp7Drr.value !== 0 ? cp7Drr.value.toFixed(1) : '',
          cp7DrrDate: cp7Drr.date ? formatDate(cp7Drr.date) : '',
          cp8DpuOff: cp8Dpu.value !== 0 ? cp8Dpu.value.toFixed(2) : '',
          cp8DpuDate: cp8Dpu.date ? formatDate(cp8Dpu.date) : '',
          cp8DrrMes: cp8Drr.value !== 0 ? cp8Drr.value.toFixed(1) : '',
          cp8DrrDate: cp8Drr.date ? formatDate(cp8Drr.date) : '',
        });
      });
      result[model] = compRows;
    });
    return result;
  }, [expandComplectations, complectMetrics, visibleModels, selectedDate]);

  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ borderRadius: BRAND.radiusSmall, overflow: 'hidden', boxShadow: BRAND.shadow, backgroundColor: BRAND.cardBg }}>
        <table style={styles.table}>
          <colgroup>{headers.map((_, i) => <col key={i} style={{ width: `${100 / headers.length}%` }} />)}</colgroup>
          <thead>
            <tr style={styles.tableHeaderRow}>{headers.map(h => <th key={h} style={styles.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <React.Fragment key={row.model}>
                {/* Основная строка */}
                <tr style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : BRAND.bg, borderBottom: expandComplectations ? 'none' : `1px solid ${BRAND.border}` }}>
                  <td style={styles.td}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontWeight: 600 }}>{row.model}</span></div></td>
                  <td style={styles.td}><span style={{ fontWeight: 600 }}>{row.cp7DpuOff}</span>{row.cp7DpuDate && <div style={{ fontSize: 10, color: BRAND.textSecondary }}>{row.cp7DpuDate}</div>}</td>
                  <td style={styles.td}><span style={{ fontWeight: 600 }}>{row.cp7Drr}</span>{row.cp7DrrDate && <div style={{ fontSize: 10, color: BRAND.textSecondary }}>{row.cp7DrrDate}</div>}</td>
                  <td style={styles.td}><span style={{ fontWeight: 600 }}>{row.cp8DpuOff}</span>{row.cp8DpuDate && <div style={{ fontSize: 10, color: BRAND.textSecondary }}>{row.cp8DpuDate}</div>}</td>
                  <td style={styles.td}><span style={{ fontWeight: 600 }}>{row.cp8DrrMes}</span>{row.cp8DrrDate && <div style={{ fontSize: 10, color: BRAND.textSecondary }}>{row.cp8DrrDate}</div>}</td>
                  <td style={{ ...styles.td, padding: '4px' }}><input type="text" value={row.cpaScore} onChange={(e) => handleCpaChange(row.model, e.target.value)} style={styles.input} /></td>
                </tr>

                {/* Вложенные строки комплектаций */}
                {expandComplectations && (
                  complectationRows[row.model] && complectationRows[row.model].length > 0 ? (
                    complectationRows[row.model].map((compRow, cIdx) => (
                      <tr key={`${row.model}_${compRow.complectation}`} style={{ backgroundColor: cIdx % 2 === 0 ? '#F1F5F9' : '#E2E8F0', borderBottom: cIdx === complectationRows[row.model].length - 1 ? `1px solid ${BRAND.border}` : 'none' }}>
                        <td style={{ ...styles.td, paddingLeft: 24, textAlign: 'left', fontSize: 14 }}><span style={{ color: BRAND.textSecondary }}>└ {compRow.complectation}</span></td>
                        <td style={styles.td}><span style={{ fontWeight: 600 }}>{compRow.cp7DpuOff}</span>{compRow.cp7DpuDate && <div style={{ fontSize: 10, color: BRAND.textSecondary }}>{compRow.cp7DpuDate}</div>}</td>
                        <td style={styles.td}><span style={{ fontWeight: 600 }}>{compRow.cp7Drr}</span>{compRow.cp7DrrDate && <div style={{ fontSize: 10, color: BRAND.textSecondary }}>{compRow.cp7DrrDate}</div>}</td>
                        <td style={styles.td}><span style={{ fontWeight: 600 }}>{compRow.cp8DpuOff}</span>{compRow.cp8DpuDate && <div style={{ fontSize: 10, color: BRAND.textSecondary }}>{compRow.cp8DpuDate}</div>}</td>
                        <td style={styles.td}><span style={{ fontWeight: 600 }}>{compRow.cp8DrrMes}</span>{compRow.cp8DrrDate && <div style={{ fontSize: 10, color: BRAND.textSecondary }}>{compRow.cp8DrrDate}</div>}</td>
                        <td style={styles.td}></td>
                      </tr>
                    ))
                  ) : (
                    <tr style={{ backgroundColor: '#F8FAFC', borderBottom: `1px solid ${BRAND.border}` }}>
                      <td colSpan={6} style={{ padding: '16px', textAlign: 'center', color: BRAND.textSecondary, fontSize: 14, fontStyle: 'italic' }}>
                        Нет данных о комплектациях для этой модели
                      </td>
                    </tr>
                  )
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, textAlign: 'right' }}>
        <button onClick={handleSaveAllCpa} style={{ padding: '8px 16px', fontSize: '0.9rem', backgroundColor: BRAND.primary, color: '#FFF', border: 'none', borderRadius: BRAND.radiusSmall, cursor: 'pointer', fontWeight: 600, fontFamily: BRAND.fontFamily }}>Сохранить CPA</button>
      </div>
    </div>
  );
};

/* ============ МОДАЛЬНОЕ ОКНО ДЕТАЛЕЙ ============ */
const FilterableDetailsModal = ({ isOpen, onClose, data, loading, title, error, periodType, metricType }) => {
  const [modelFilter, setModelFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const models = useMemo(() => {
    if (!data || data.length === 0) return [];
    const unique = [...new Set(data.map(row => row.MODEL).filter(Boolean))];
    return ['ALL', ...unique.sort()];
  }, [data]);

  const filteredData = useMemo(() => {
    if (!data) return [];
    let result = data;
    if (modelFilter !== 'ALL') result = result.filter(row => row.MODEL === modelFilter);
    if (dateFrom) result = result.filter(row => row.DATE >= dateFrom);
    if (dateTo) result = result.filter(row => row.DATE <= dateTo);
    return result;
  }, [data, modelFilter, dateFrom, dateTo]);

  const summary = useMemo(() => {
    if (!filteredData.length) return null;
    const uniqueVins = new Set(filteredData.map(row => row.VIN)).size;
    if (metricType === 'DPU') return { uniqueVins, totalDefects: filteredData.length };
    else return { uniqueVins, inRemzone: filteredData.filter(row => row.REMZONE_STATUS === 'В ремзоне').length, total: filteredData.length };
  }, [filteredData, metricType]);

  if (!isOpen) return null;

  const handleExport = () => {
    if (filteredData.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(filteredData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Details');
    XLSX.writeFile(wb, `Details_${title || 'export'}.xlsx`);
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ color: BRAND.text, margin: 0 }}>{title || 'Детали'}</h3>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>
        {error && <div style={{ color: '#EF4444', marginBottom: 8 }}>Ошибка: {error}</div>}
        {loading ? <div style={{ color: BRAND.textSecondary }}>Загрузка...</div> : !data || data.length === 0 ? <div style={{ color: BRAND.textSecondary }}>Нет данных</div> : (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ color: BRAND.textSecondary, fontSize: 13 }}>Модель:<select value={modelFilter} onChange={e => setModelFilter(e.target.value)} style={{ marginLeft: 4, padding: '2px 4px', borderRadius: 4, border: `1px solid ${BRAND.border}`, background: '#FFFFFF', color: BRAND.text }}>{models.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
              <label style={{ color: BRAND.textSecondary, fontSize: 13 }}>С даты:<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ marginLeft: 4, padding: '2px 4px', borderRadius: 4, border: `1px solid ${BRAND.border}`, background: '#FFFFFF', color: BRAND.text }} /></label>
              <label style={{ color: BRAND.textSecondary, fontSize: 13 }}>По дату:<input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ marginLeft: 4, padding: '2px 4px', borderRadius: 4, border: `1px solid ${BRAND.border}`, background: '#FFFFFF', color: BRAND.text }} /></label>
              <button onClick={handleExport} style={styles.exportBtn}>Экспорт в Excel</button>
            </div>
            {summary && (
              <div style={{ color: BRAND.textSecondary, marginBottom: 8, fontSize: 13, display: 'flex', gap: 15 }}>
                <span>Уникальных VIN: <b>{summary.uniqueVins}</b></span>
                {metricType === 'DPU' ? <span>Всего дефектов: <b>{summary.totalDefects}</b></span> : <><span>Всего записей: <b>{summary.total}</b></span><span>В ремзоне: <b>{summary.inRemzone}</b></span></>}
              </div>
            )}
            <div className="custom-scroll" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', color: BRAND.text, fontSize: 13 }}>
                <thead><tr style={{ backgroundColor: BRAND.bg }}>{Object.keys(data[0]).map(col => <th key={col} style={styles.detailTh}>{col}</th>)}</tr></thead>
                <tbody>{filteredData.map((row, idx) => (<tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : BRAND.bg }}>{Object.keys(data[0]).map(col => <td key={col} style={styles.detailTd}>{row[col]}</td>)}</tr>))}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/* ============ ТОП-10 ДЕФЕКТОВ ============ */
const TodayTopDefects = ({ checkpoint, defectType, onDefectTypeChange, dateFrom, onDateFromChange, dateTo, onDateToChange }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    const params = new URLSearchParams({ checkpoint });
    if (defectType !== 'default') params.append('defectType', defectType);
    fetch(`${API_BASE}/api/defects-dashboard?${params.toString()}`)
      .then(res => res.json())
      .then(json => {
        const filtered = Array.isArray(json) ? json.filter(item => {
          const itemDate = item.CREATION_TIME;
          if (!itemDate) return false;
          if (dateFrom && itemDate < dateFrom) return false;
          if (dateTo && itemDate > dateTo) return false;
          return true;
        }) : [];
        setData(filtered); setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [checkpoint, defectType, dateFrom, dateTo]);

  const filterBar = (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
      <label style={{ fontSize: 13, color: BRAND.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}>Тип:<select value={defectType} onChange={e => onDefectTypeChange(e.target.value)} style={{ padding: '6px 10px', borderRadius: BRAND.radiusSmall, border: `1px solid ${BRAND.border}`, fontSize: 13, background: '#fff' }}><option value="offline">Offline</option><option value="online">Online</option><option value="default">Default</option></select></label>
      <label style={{ fontSize: 13, color: BRAND.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}>с<input type="date" value={dateFrom} onChange={e => onDateFromChange(e.target.value)} style={{ padding: '6px 10px', borderRadius: BRAND.radiusSmall, border: `1px solid ${BRAND.border}`, fontSize: 13, width: 140, background: '#fff' }} /></label>
      <label style={{ fontSize: 13, color: BRAND.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}>по<input type="date" value={dateTo} onChange={e => onDateToChange(e.target.value)} style={{ padding: '6px 10px', borderRadius: BRAND.radiusSmall, border: `1px solid ${BRAND.border}`, fontSize: 13, width: 140, background: '#fff' }} /></label>
    </div>
  );

  if (loading) return <div style={{ marginTop: 20, color: BRAND.textSecondary }}><h3 style={{ color: BRAND.text, marginBottom: 12 }}>Топ‑10 дефектов ({checkpoint})</h3>{filterBar}<p>Загрузка...</p></div>;
  if (!data || data.length === 0) return <div style={{ marginTop: 20, color: BRAND.textSecondary }}><h3 style={{ color: BRAND.text, marginBottom: 12 }}>Топ‑10 дефектов ({checkpoint})</h3>{filterBar}<p>Нет данных за выбранный период</p></div>;

  const grouped = {};
  data.forEach(item => {
    const model = item.MODEL || 'UNKNOWN';
    const defectKey = (item.PART_NAME || '') + ' – ' + (item.PROBLEM_TYPE || '');
    if (!grouped[model]) grouped[model] = {};
    if (!grouped[model][defectKey]) grouped[model][defectKey] = 0;
    grouped[model][defectKey] += item.DEFECTS_COUNT || 0;
  });

  const topByModel = {};
  Object.entries(grouped).forEach(([model, defectMap]) => {
    const arr = Object.entries(defectMap).map(([name, count]) => ({ name, count }));
    arr.sort((a, b) => b.count - a.count);
    topByModel[model] = arr.slice(0, 10);
  });

  const modelOrder = ['JELAND J6', 'JELAND J7', 'JELAND J8', 'ESTEO MX', 'TENET A8'];

  return (
    <div style={{ marginTop: 40 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12, marginBottom: 16, borderBottom: `2px solid ${BRAND.border}`, paddingBottom: 8 }}>
        <h3 style={{ color: BRAND.text, fontSize: 20, fontWeight: 700, margin: 0 }}>Топ‑10 дефектов ({checkpoint})</h3>
        {filterBar}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {modelOrder.map(model => {
          const items = topByModel[model];
          if (!items || items.length === 0) return <div key={model} style={{ backgroundColor: BRAND.cardBg, borderRadius: BRAND.radiusSmall, boxShadow: BRAND.shadow, padding: 12, flex: '1 1 220px', minWidth: '200px' }}><h4 style={{ color: modelColors[model] || BRAND.textSecondary, fontSize: 16, fontWeight: 700, marginBottom: 8, borderBottom: `2px solid ${modelColors[model] || BRAND.textSecondary}`, paddingBottom: 4 }}>{model}</h4><p style={{ color: BRAND.textSecondary, fontSize: 13, textAlign: 'center' }}>Нет данных за выбранный период</p></div>;
          return (
            <div key={model} style={{ backgroundColor: BRAND.cardBg, borderRadius: BRAND.radiusSmall, boxShadow: BRAND.shadow, padding: 12, flex: '1 1 220px', minWidth: '200px' }}>
              <h4 style={{ color: modelColors[model], fontSize: 16, fontWeight: 700, marginBottom: 8, borderBottom: `2px solid ${modelColors[model]}`, paddingBottom: 4 }}>{model}</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ backgroundColor: BRAND.bg }}><th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600, color: BRAND.textSecondary }}>Деталь – Дефект</th><th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, color: BRAND.textSecondary, width: 40 }}>Кол.</th></tr></thead>
                <tbody>{items.map((item, idx) => (<tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#FFFFFF' : BRAND.bg }}><td style={{ padding: '4px 6px', color: BRAND.text }}>{item.name}</td><td style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 600, color: BRAND.text }}>{item.count}</td></tr>))}</tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ============ ГРУППА ГРАФИКОВ ============ */
const ChartsGroup = ({ title, checkpoint, visibleModels, cpDpuDays, cpDrrDays, dpuEndpoint, drrEndpoint, onDetailsClick }) => {
  const [blockCollapsed, setBlockCollapsed] = useState(false);
  const [dpuCollapsed, setDpuCollapsed] = useState(false);
  const [drrCollapsed, setDrrCollapsed] = useState(false);

  const [drrMonths, setDrrMonths] = useState(null);
  const [drrWeeks, setDrrWeeks] = useState(null);
  const [drrLoading, setDrrLoading] = useState(true);

  const [dpuMonths, setDpuMonths] = useState(null);
  const [dpuWeeks, setDpuWeeks] = useState(null);
  const [dpuLoading, setDpuLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetch(`${API_BASE}${drrEndpoint}?period=month`).then(r => r.json()), fetch(`${API_BASE}${drrEndpoint}?period=week`).then(r => r.json())])
      .then(([months, weeks]) => { setDrrMonths(months?.slice(-3) || []); setDrrWeeks(weeks?.slice(-4) || []); setDrrLoading(false); }).catch(() => setDrrLoading(false));
  }, [drrEndpoint]);

  useEffect(() => {
    Promise.all([fetch(`${API_BASE}${dpuEndpoint}?period=month`).then(r => r.json()), fetch(`${API_BASE}${dpuEndpoint}?period=week`).then(r => r.json())])
      .then(([months, weeks]) => { setDpuMonths(months?.slice(-3) || []); setDpuWeeks(weeks?.slice(-4) || []); setDpuLoading(false); }).catch(() => setDpuLoading(false));
  }, [dpuEndpoint]);

  const dpuDays = (cpDpuDays || []).slice(-7);
  const drrDays = (cpDrrDays || []).slice(-7);

  const toggleBlock = () => setBlockCollapsed(!blockCollapsed);
  const toggleDpu = () => setDpuCollapsed(!dpuCollapsed);
  const toggleDrr = () => setDrrCollapsed(!drrCollapsed);

  const handleDetailsClick = (periods, metricType, periodType) => {
    if (onDetailsClick) onDetailsClick(checkpoint, periods, metricType, periodType);
  };

  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <h2 style={{ color: BRAND.text, fontSize: 22, fontWeight: 700, margin: 0 }}>{title}</h2>
        <button onClick={toggleBlock} style={styles.collapseBtn}>{blockCollapsed ? '▼' : '▲'}</button>
      </div>
      {!blockCollapsed && (
        <>
          <div style={{ backgroundColor: BRAND.cardBg, borderRadius: BRAND.radiusSmall, padding: 16, boxShadow: BRAND.shadow, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><h3 style={{ color: BRAND.textSecondary, fontSize: 15, fontWeight: 600, margin: 0 }}>DPU</h3><button onClick={toggleDpu} style={styles.collapseBtn}>{dpuCollapsed ? '▼' : '▲'}</button></div>
            {!dpuCollapsed && <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' }}><BarChartBlock title="Месяцы" data={dpuMonths} periodType="month" isLoading={dpuLoading} visibleModels={visibleModels} onDetailsClick={handleDetailsClick} metricType="DPU" /><BarChartBlock title="Недели" data={dpuWeeks} periodType="week" isLoading={dpuLoading} visibleModels={visibleModels} onDetailsClick={handleDetailsClick} metricType="DPU" /><BarChartBlock title="Дни" data={dpuDays} periodType="day" isLoading={false} visibleModels={visibleModels} onDetailsClick={handleDetailsClick} metricType="DPU" /></div>}
          </div>
          <div style={{ backgroundColor: BRAND.cardBg, borderRadius: BRAND.radiusSmall, padding: 16, boxShadow: BRAND.shadow }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><h3 style={{ color: BRAND.textSecondary, fontSize: 15, fontWeight: 600, margin: 0 }}>DRR</h3><button onClick={toggleDrr} style={styles.collapseBtn}>{drrCollapsed ? '▼' : '▲'}</button></div>
            {!drrCollapsed && <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' }}><BarChartBlock title="Месяцы" data={drrMonths} periodType="month" isLoading={drrLoading} visibleModels={visibleModels} yAxisDomain={[0, 100]} onDetailsClick={handleDetailsClick} metricType="DRR" /><BarChartBlock title="Недели" data={drrWeeks} periodType="week" isLoading={drrLoading} visibleModels={visibleModels} yAxisDomain={[0, 100]} onDetailsClick={handleDetailsClick} metricType="DRR" /><BarChartBlock title="Дни" data={drrDays} periodType="day" isLoading={false} visibleModels={visibleModels} yAxisDomain={[0, 100]} onDetailsClick={handleDetailsClick} metricType="DRR" /></div>}
          </div>
        </>
      )}
    </div>
  );
};

/* ============ ОСНОВНОЙ КОМПОНЕНТ СТРАНИЦЫ ============ */
export default function ModelStatusPage() {
  const allModels = Object.keys(modelColors);
  const [selectedModels, setSelectedModels] = useState(allModels);
  const [selectedDate, setSelectedDate] = useState('default');

  const [cp7DpuDays, setCp7DpuDays] = useState([]);
  const [cp7DrrDays, setCp7DrrDays] = useState([]);
  const [cp8DpuDays, setCp8DpuDays] = useState([]);
  const [cp8DrrDays, setCp8DrrDays] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  const [expandComplectations, setExpandComplectations] = useState(false);
  const [complectMetrics, setComplectMetrics] = useState({ cp7Dpu: [], cp7Drr: [], cp8Dpu: [], cp8Drr: [] });

  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const [defectTypeCP7, setDefectTypeCP7] = useState('offline');
  const [dateFromCP7, setDateFromCP7] = useState(yesterday);
  const [dateToCP7, setDateToCP7] = useState(yesterday);
  const [defectTypeCP8, setDefectTypeCP8] = useState('offline');
  const [dateFromCP8, setDateFromCP8] = useState(yesterday);
  const [dateToCP8, setDateToCP8] = useState(yesterday);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalData, setModalData] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState(null);
  const [modalPeriodType, setModalPeriodType] = useState('day');
  const [modalMetricType, setModalMetricType] = useState('DPU');

  const pageRef = useRef(null);

  useEffect(() => {
    const fetchAllDaily = async () => {
      try {
        const [cp7Dpu, cp7Drr, cp8Dpu, cp8Drr, complectData] = await Promise.all([
          fetch(`${API_BASE}/api/model-status-dpu-cp7?period=day&count=90`).then(r => r.json()),
          fetch(`${API_BASE}/api/model-status-drr-cp7?period=day&count=90`).then(r => r.json()),
          fetch(`${API_BASE}/api/model-status-dpu-cp8?period=day&count=90`).then(r => r.json()),
          fetch(`${API_BASE}/api/model-status-drr?period=day&count=90`).then(r => r.json()),
          fetch(`${API_BASE}/api/model-status-complectations-daily`).then(r => r.json()).catch(() => null),
        ]);
        setCp7DpuDays(Array.isArray(cp7Dpu) ? cp7Dpu : []);
        setCp7DrrDays(Array.isArray(cp7Drr) ? cp7Drr : []);
        setCp8DpuDays(Array.isArray(cp8Dpu) ? cp8Dpu : []);
        setCp8DrrDays(Array.isArray(cp8Drr) ? cp8Drr : []);

        if (complectData && !complectData.error) {
          setComplectMetrics({
            cp7Dpu: complectData.cp7Dpu || [],
            cp7Drr: complectData.cp7Drr || [],
            cp8Dpu: complectData.cp8Dpu || [],
            cp8Drr: complectData.cp8Drr || [],
          });
        }
      } catch (err) {
        console.error('Ошибка загрузки дневных данных', err);
      } finally {
        setDataLoaded(true);
      }
    };
    fetchAllDaily();
  }, []);

  const handleDetailsClick = (checkpoint, periods, metricType, periodType) => {
    const isDpu = metricType === 'DPU';
    let endpoint = '';
    if (checkpoint === 'CP7' && isDpu) endpoint = '/api/model-status-dpu-cp7-details';
    else if (checkpoint === 'CP7' && !isDpu) endpoint = '/api/model-status-drr-cp7-details';
    else if (checkpoint === 'CP8' && isDpu) endpoint = '/api/model-status-dpu-cp8-details';
    else if (checkpoint === 'CP8' && !isDpu) endpoint = '/api/model-status-drr-cp8-details';

    if (!endpoint) { setModalError('Неизвестный эндпоинт'); return; }

    const sortedPeriods = [...periods].sort();
    const startLabel = formatPeriodLabel(sortedPeriods[0], periodType);
    const endLabel = formatPeriodLabel(sortedPeriods[sortedPeriods.length - 1], periodType);
    const rangeLabel = sortedPeriods.length === 1 ? startLabel : `${startLabel} – ${endLabel}`;

    setModalTitle(`${checkpoint} – ${metricType} (${rangeLabel})`);
    setModalPeriodType(periodType);
    setModalMetricType(metricType);
    setModalOpen(true); setModalLoading(true); setModalError(null); setModalData([]);

    const periodsParam = sortedPeriods.join(',');
    fetch(`${API_BASE}${endpoint}?periods=${encodeURIComponent(periodsParam)}&periodType=${periodType}`)
      .then(r => { if (!r.ok) throw new Error(`Ошибка сервера: ${r.status}`); return r.json(); })
      .then(data => { setModalData(Array.isArray(data) ? data : []); setModalLoading(false); })
      .catch(err => { console.error(err); setModalError(err.message); setModalLoading(false); });
  };

  const closeModal = () => { setModalOpen(false); setModalData([]); setModalError(null); };

  const handleExportPdf = async () => {
    try {
      const canvas = await html2canvas(pageRef.current, { scale: 2, useCORS: true, logging: false, windowWidth: pageRef.current.scrollWidth, windowHeight: pageRef.current.scrollHeight });
      const imgData = canvas.toDataURL('image/jpeg', 0.85);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      const pageHeight = pdf.internal.pageSize.getHeight();
      let heightLeft = pdfHeight; let position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position -= pageHeight; pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
      }
      pdf.save('ModelStatus.pdf');
    } catch (err) { alert('Не удалось сгенерировать PDF'); }
  };

  if (!dataLoaded) return <div style={styles.loading}>Загрузка данных...</div>;

  return (
    <div ref={pageRef} style={styles.container}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={styles.mainTitle}>Model Status</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={handleExportPdf} style={{ padding: '12px 24px', borderRadius: BRAND.radiusSmall, border: 'none', fontWeight: 700, fontSize: '1rem', background: BRAND.primary, color: '#FFFFFF', cursor: 'pointer', boxShadow: BRAND.shadow, transition: 'all 0.2s', fontFamily: BRAND.fontFamily }}>📄 Выгрузка в PDF</button>
          <EmailSenderButton targetRef={pageRef} pageTitle="Model Status" />
        </div>
      </div>

      <div style={{ backgroundColor: BRAND.cardBg, borderRadius: BRAND.radius, padding: 24, marginBottom: 30, boxShadow: BRAND.shadow, border: `1px solid ${BRAND.border}` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <ModelFilterDropdown allModels={allModels} selectedModels={selectedModels} onChange={setSelectedModels} />

          <button
            onClick={() => setExpandComplectations(!expandComplectations)}
            style={{
              padding: '12px 24px', borderRadius: BRAND.radiusSmall, border: `1px solid ${expandComplectations ? '#93C5FD' : BRAND.border}`,
              background: expandComplectations ? '#EFF6FF' : '#FFFFFF', fontWeight: 700, fontSize: '1rem',
              color: expandComplectations ? BRAND.primary : BRAND.textSecondary,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)', transition: 'all 0.2s', fontFamily: BRAND.fontFamily,
            }}
          >
            <span>📦 Комплектации</span>
          </button>

          <span style={{ fontSize: 14, color: BRAND.textSecondary, fontWeight: 500 }}>Режим таблицы:</span>
          <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={{ padding: '10px 15px', borderRadius: BRAND.radiusSmall, border: `1px solid ${BRAND.border}`, fontSize: 14, background: '#FFFFFF', color: BRAND.textSecondary, fontWeight: 500, fontFamily: BRAND.fontFamily }}>
            <option value="default">По умолчанию</option>
            {[...new Set([...cp7DpuDays, ...cp7DrrDays, ...cp8DpuDays, ...cp8DrrDays].map(d => (d.period || '').trim().slice(0, 10)))].filter(Boolean).sort().reverse().map(date => (<option key={date} value={date}>{date.split('-').reverse().join('.')}</option>))}
          </select>
        </div>

        <EditableTable
          visibleModels={selectedModels}
          cp7DpuDays={cp7DpuDays}
          cp7DrrDays={cp7DrrDays}
          cp8DpuDays={cp8DpuDays}
          cp8DrrDays={cp8DrrDays}
          selectedDate={selectedDate}
          expandComplectations={expandComplectations}
          complectMetrics={complectMetrics}
        />
      </div>

      <ChartsGroup title="CP7" checkpoint="CP7" visibleModels={selectedModels} cpDpuDays={cp7DpuDays} cpDrrDays={cp7DrrDays} dpuEndpoint="/api/model-status-dpu-cp7" drrEndpoint="/api/model-status-drr-cp7" onDetailsClick={handleDetailsClick} />
      <ChartsGroup title="CP8" checkpoint="CP8" visibleModels={selectedModels} cpDpuDays={cp8DpuDays} cpDrrDays={cp8DrrDays} dpuEndpoint="/api/model-status-dpu-cp8" drrEndpoint="/api/model-status-drr" onDetailsClick={handleDetailsClick} />

      <TodayTopDefects checkpoint="CP7" defectType={defectTypeCP7} onDefectTypeChange={setDefectTypeCP7} dateFrom={dateFromCP7} onDateFromChange={setDateFromCP7} dateTo={dateToCP7} onDateToChange={setDateToCP7} />
      <TodayTopDefects checkpoint="CP8" defectType={defectTypeCP8} onDefectTypeChange={setDefectTypeCP8} dateFrom={dateFromCP8} onDateFromChange={setDateFromCP8} dateTo={dateToCP8} onDateToChange={setDateToCP8} />

      <FilterableDetailsModal isOpen={modalOpen} onClose={closeModal} data={modalData} loading={modalLoading} title={modalTitle} error={modalError} periodType={modalPeriodType} metricType={modalMetricType} />
    </div>
  );
}

/* ============ СТИЛИ ============ */
const styles = {
  container: { backgroundColor: BRAND.bg, minHeight: '100vh', padding: 20, color: BRAND.text, fontFamily: BRAND.fontFamily },
  mainTitle: { fontSize: '2.5rem', marginBottom: 24, fontWeight: 900, color: BRAND.text },
  collapseBtn: { background: 'none', border: `1px solid ${BRAND.border}`, borderRadius: BRAND.radiusSmall, cursor: 'pointer', fontSize: 14, padding: '2px 8px', color: BRAND.textSecondary, lineHeight: 1 },
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' },
  tableHeaderRow: { backgroundColor: BRAND.bg },
  th: { padding: '10px 8px', borderBottom: `2px solid ${BRAND.border}`, textAlign: 'center', fontWeight: 600, color: BRAND.textSecondary, fontSize: 16 },
  td: { padding: '8px', borderBottom: `1px solid ${BRAND.border}`, textAlign: 'center', color: BRAND.text, fontSize: 16, fontWeight: 500 },
  input: { width: '80px', padding: '6px', border: `1px solid ${BRAND.border}`, borderRadius: BRAND.radiusSmall, backgroundColor: '#FFFFFF', color: BRAND.text, textAlign: 'center', fontSize: 15 },
  modalOverlay: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0, 0, 0, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalContent: { backgroundColor: '#FFFFFF', borderRadius: BRAND.radius, padding: 20, maxWidth: '850px', width: '95%', boxShadow: BRAND.shadow },
  closeBtn: { background: 'transparent', border: 'none', color: BRAND.text, fontSize: 18, cursor: 'pointer' },
  exportBtn: { padding: '6px 14px', backgroundColor: BRAND.primary, color: '#FFF', border: 'none', borderRadius: BRAND.radiusSmall, fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  detailTh: { padding: '6px 8px', textAlign: 'left', borderBottom: `1px solid ${BRAND.border}`, fontWeight: 600, color: BRAND.textSecondary },
  detailTd: { padding: '6px 8px', borderBottom: `1px solid ${BRAND.border}`, whiteSpace: 'nowrap', color: BRAND.text },
  loading: { textAlign: 'center', padding: 20, fontSize: 18, color: BRAND.textSecondary },
};