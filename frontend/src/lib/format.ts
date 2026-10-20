/**
 * How result values are shown. The raw value is never changed (copy and CSV use it);
 * only the display is.
 */
import type { ColumnType } from '../api';

const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
const PLAIN_NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4, useGrouping: false });

export interface FormatOptions {
  smartDates?: boolean; // recognise dates stored as text or unix time (MES/LES data)
}

export function formatValue(value: unknown, type: ColumnType, role: 'dimension' | 'measure' = 'dimension', opts: FormatOptions = {}): string {
  if (value === null || value === undefined) return '';
  if (opts.smartDates && (type === 'string' || type === 'number' || type === 'unknown')) {
    const date = normalizeDate(value);
    if (date) return date;
  }
  switch (type) {
    case 'number':
      if (typeof value !== 'number') return String(value);
      // ids, codes, years: no thousands separators
      return role === 'measure' ? NUMBER.format(value) : PLAIN_NUMBER.format(value);
    case 'datetime':
      return typeof value === 'string' ? value.replace('T', ' ').replace(/\.\d+$/, '').replace(/ 00:00:00$/, '') : String(value);
    case 'boolean':
      return value === true || value === 1 ? 'true' : value === false || value === 0 ? 'false' : String(value);
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value);
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

function isoFromDate(d: Date, withTime: boolean): string {
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (!withTime) return date;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * Dates written in different ways inside one column (DataDesk's tryNormalizeDate):
 * ISO 2026-01-31[ 10:00[:00]], 31.01.2026[ 10:00[:00]], unix seconds or
 * milliseconds. Returns "YYYY-MM-DD[ HH:MM:SS]" or null when it is not a date.
 * Unix times are shown in UTC.
 */
export function normalizeDate(value: unknown): string | null {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10}(\d{3})?$/.test(value.trim()))) {
    const n = Number(value);
    let ms: number | null = null;
    if (n >= 946684800 && n < 4102444800) ms = n * 1000; // seconds, 2000-2100
    else if (n >= 946684800000 && n < 4102444800000) ms = n; // milliseconds
    return ms === null ? null : isoFromDate(new Date(ms), true);
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (!m) {
    const d = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
    if (d) m = [d[0], d[3], pad(Number(d[2])), pad(Number(d[1])), d[4] && pad(Number(d[4])), d[5], d[6]] as unknown as RegExpExecArray;
  }
  if (!m) return null;
  const [, y, mo, da, h, mi, s] = m;
  const month = Number(mo);
  const day = Number(da);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = `${y}-${mo}-${da}`;
  if (h === undefined) return date;
  return `${date} ${h}:${mi}:${s ?? '00'}`;
}

export const isNumericType = (type: ColumnType) => type === 'number';
