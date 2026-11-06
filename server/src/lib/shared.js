// Общие вспомогательные функции и константы без побочных эффектов,
// которые используются в нескольких модулях.
// Код перенесён из server.js без изменений.

// Вспомогательная функция
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}




/* ====================================================================== */
/* ===================== REP ELEC REPORT ================================ */
/* ====================================================================== */

// Хелпер: безопасный расчет номера недели
function getWeekNumberForDate(dateStr) {
  const cleanDate = String(dateStr).split('T')[0];
  const d = new Date(cleanDate + 'T12:00:00Z');
  if (isNaN(d.getTime())) return 0;
  
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}

// Хелпер для генерации периодов (День/Неделя/Месяц)
function buildReelecPeriods({ period, count, fromDate, toDate, baseDate }) {
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = baseDate ? new Date(baseDate) : new Date(); 

  // Если задан кастомный диапазон
  if (fromDate && toDate) {
    const out = [];
    const start = new Date(fromDate + 'T00:00:00');
    const end = new Date(toDate + 'T00:00:00');
    if (isNaN(start) || isNaN(end) || start > end) return [];
    const cur = new Date(start);
    while (cur <= end) {
      const ds = fmt(cur);
      out.push({ type: 'day', label: ds, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  // Если период "все" (3 месяца, 4 недели, 14 дней)
  if (period === 'all') {
    const months = [], weeks = [], days = [];
    const curM = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < 3; i++) {
      const s = new Date(curM.getFullYear(), curM.getMonth() - i, 1);
      const e = new Date(curM.getFullYear(), curM.getMonth() - i + 1, 0);
      months.push({
        type: 'month',
        label: `${s.toLocaleString('en-US', { month: 'short' })} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`, endDate: `${fmt(e)} 23:59:59`,
      });
    }
    months.reverse();

    const curW = new Date(now);
    curW.setDate(curW.getDate() - ((curW.getDay() + 6) % 7));
    for (let i = 0; i < 4; i++) {
      const s = new Date(curW); s.setDate(s.getDate() - i * 7);
      const e = new Date(s); e.setDate(e.getDate() + 6);
      weeks.push({
        type: 'week',
        label: `W${Math.ceil((((s - new Date(s.getFullYear(), 0, 1)) / 86400000) + 1) / 7)} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`, endDate: `${fmt(e)} 23:59:59`,
      });
    }
    weeks.reverse();

    for (let i = 0; i < 14; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const ds = fmt(d);
      days.push({ type: 'day', label: `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
    }
    days.reverse();

    return [...months, ...weeks, ...days];
  }

  // Стандартные периоды (Неделя, Месяц)
  const n = Math.max(1, Math.min(parseInt(count, 10) || 3, 50));
  const out = [];
  const cur = new Date(now);

  if (period === 'month') {
    for (let i = 0; i < n; i++) {
      const s = new Date(cur.getFullYear(), cur.getMonth() - i, 1);
      const e = new Date(cur.getFullYear(), cur.getMonth() - i + 1, 0);
      out.push({
        type: 'month',
        label: `${s.toLocaleString('en-US', { month: 'short' })} ${String(s.getFullYear()).slice(-2)}`,
        startDate: `${fmt(s)} 00:00:00`, endDate: `${fmt(e)} 23:59:59`,
      });
    }
  } else if (period === 'week') {
    const startW = new Date(cur);
    startW.setDate(startW.getDate() - ((startW.getDay() + 6) % 7));
    for (let i = 0; i < n; i++) {
      const s = new Date(startW); s.setDate(s.getDate() - i * 7);
      const e = new Date(s); e.setDate(e.getDate() + 6);
      out.push({
        type: 'week',
        label: `W${Math.ceil((((s - new Date(s.getFullYear(), 0, 1)) / 86400000) + 1) / 7)} ${s.getFullYear()}`,
        startDate: `${fmt(s)} 00:00:00`, endDate: `${fmt(e)} 23:59:59`,
      });
    }
  } else {
    for (let i = 0; i < n; i++) {
      const d = new Date(cur); d.setDate(d.getDate() - i);
      const ds = fmt(d);
      out.push({ type: 'day', label: `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`, startDate: `${ds} 00:00:00`, endDate: `${ds} 23:59:59` });
    }
  }
  return out.reverse();
}

module.exports = { buildReelecPeriods, getISOWeek, getWeekNumberForDate };
