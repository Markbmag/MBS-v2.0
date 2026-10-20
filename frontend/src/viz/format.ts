/**
 * Number and date formatting for charts, KPI tiles and tables, with per-column
 * overrides from VizSpec.format.
 */
import type { ColumnType } from '../api';
import type { ColumnFormat, DateStyle } from './types.ts';

import { t } from '../i18n/index.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m) => t(m));

export function formatNumber(value: number, fmt: ColumnFormat = {}, locale?: string): string {
  if (!Number.isFinite(value)) return String(value);
  const style = fmt.style ?? 'auto';
  const options: Intl.NumberFormatOptions = {};
  let v = value;
  if (style === 'currency') {
    options.style = 'currency';
    options.currency = (fmt.currency || 'USD').toUpperCase();
  } else if (style === 'percent') {
    options.style = 'percent';
    if (fmt.percentIsFraction === false) v = value / 100;
  } else if (style === 'plain') {
    options.useGrouping = false;
  }
  if (fmt.compact) {
    options.notation = 'compact';
    options.maximumFractionDigits = fmt.decimals ?? 1;
  } else if (fmt.decimals !== undefined && fmt.decimals !== null) {
    options.minimumFractionDigits = fmt.decimals;
    options.maximumFractionDigits = fmt.decimals;
  } else if (style !== 'currency') {
    options.maximumFractionDigits = style === 'percent' ? 1 : Math.abs(v) >= 100 ? 1 : 4;
  }
  let text: string;
  try {
    text = new Intl.NumberFormat(locale, options).format(v);
  } catch {
    text = String(v); // unknown currency code
  }
  return `${fmt.prefix ?? ''}${text}${fmt.suffix ?? ''}`;
}

/** Axis ticks: clean and short (0 / 1K / 2.5M), keeping the column's prefix/suffix/percent. */
export function formatAxisNumber(value: number, fmt: ColumnFormat = {}): string {
  const big = Math.abs(value) >= 1000;
  return formatNumber(value, { ...fmt, compact: fmt.compact || big, decimals: big ? 1 : fmt.decimals });
}

/** Guess the date granularity from a column name the builder made (created_at_month ...). */
export function dateStyleFromName(name: string): DateStyle {
  const m = /_(minute|hour|day|week|month|quarter|year)$/.exec(name);
  if (!m) return 'auto';
  if (m[1] === 'minute' || m[1] === 'hour') return 'datetime';
  return m[1] as DateStyle;
}

export function formatDate(value: string, style: DateStyle): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!m) return value;
  const [, y, mo, d, h, mi] = m;
  const month = MONTHS[Number(mo) - 1] ?? mo;
  switch (style) {
    case 'year':
      return y;
    case 'quarter':
      return t('Q{q} {year}', { q: Math.floor((Number(mo) - 1) / 3) + 1, year: y });
    case 'month':
      return `${month} ${y}`;
    case 'week':
      return t('Week of {date}', { date: `${Number(d)} ${month} ${y}` });
    case 'day':
      return `${Number(d)} ${month} ${y}`;
    case 'datetime':
      return h !== undefined ? `${Number(d)} ${month} ${y} ${h}:${mi}` : `${Number(d)} ${month} ${y}`;
    default:
      return h !== undefined && !(h === '00' && mi === '00') ? `${y}-${mo}-${d} ${h}:${mi}` : `${y}-${mo}-${d}`;
  }
}

/** One value of a result column, as shown in charts, tooltips and KPI tiles. */
export function formatCell(value: unknown, type: ColumnType, name: string, fmt: ColumnFormat = {}): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return formatNumber(value, fmt);
  if ((type === 'date' || type === 'datetime') && typeof value === 'string') {
    return formatDate(value, fmt.date && fmt.date !== 'auto' ? fmt.date : dateStyleFromName(name));
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
