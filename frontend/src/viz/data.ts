/**
 * Turning a result (columns + rows as arrays) into what a chart needs.
 * Pure functions; tested in tests/viz.test.ts.
 */
import type { ResultColumn } from '../api';
import { MAX_PIE_SLICES, MAX_SERIES, OTHER } from './palette.ts';
import type { AggregateFn, PivotSpec, VizSpec } from './types.ts';
import { t as tr } from '../i18n/index.ts';

const EMPTY = tr('(empty)');

export interface Table {
  columns: ResultColumn[];
  rows: unknown[][];
}

export const colIndex = (t: Table, name: string | undefined): number => (name ? t.columns.findIndex((c) => c.name === name) : -1);

export const toNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
};

const key = (v: unknown): string => (v === null || v === undefined ? EMPTY : typeof v === 'object' ? JSON.stringify(v) : String(v));

export interface SeriesData {
  categories: string[];                 // x values in data order (raw text)
  series: { name: string; column: string; values: (number | null)[] }[];
  folded: number;                       // how many categories/series went into "Other"
}

/**
 * x + measures (one series per measure), or x + one measure + breakout (one series
 * per breakout value: long -> wide). At most MAX_SERIES series: the smallest fold
 * into "Other". Categories keep their order of appearance (the query's ORDER BY).
 */
export function seriesData(t: Table, viz: VizSpec): SeriesData {
  const xi = colIndex(t, viz.x);
  const ys = (viz.series ?? []).map((s) => s.y).filter((y) => colIndex(t, y) >= 0);
  const categories: string[] = [];
  const catIndex = new Map<string, number>();
  const catOf = (row: unknown[]) => {
    const k = xi >= 0 ? key(row[xi]) : '';
    if (!catIndex.has(k)) {
      catIndex.set(k, categories.length);
      categories.push(k);
    }
    return catIndex.get(k)!;
  };

  const bi = colIndex(t, viz.breakout);
  if (bi >= 0 && ys.length > 0) {
    const yi = colIndex(t, ys[0]);
    const byName = new Map<string, Map<number, number>>();
    for (const row of t.rows) {
      const c = catOf(row);
      const name = key(row[bi]);
      if (!byName.has(name)) byName.set(name, new Map());
      const cell = byName.get(name)!;
      const v = toNumber(row[yi]);
      if (v !== null) cell.set(c, (cell.get(c) ?? 0) + v);
    }
    let names = [...byName.keys()];
    let folded = 0;
    if (names.length > MAX_SERIES) {
      const total = (n: string) => [...byName.get(n)!.values()].reduce((a, b) => a + Math.abs(b), 0);
      const keep = [...names].sort((a, b) => total(b) - total(a)).slice(0, MAX_SERIES - 1);
      const other = new Map<number, number>();
      for (const n of names) {
        if (keep.includes(n)) continue;
        folded++;
        for (const [c, v] of byName.get(n)!) other.set(c, (other.get(c) ?? 0) + v);
      }
      names = names.filter((n) => keep.includes(n));
      byName.set(OTHER, other);
      names.push(OTHER);
    }
    return {
      categories,
      series: names.map((name) => ({ name, column: ys[0], values: categories.map((_, c) => byName.get(name)!.get(c) ?? null) })),
      folded,
    };
  }

  const sums = ys.map(() => new Map<number, number>());
  for (const row of t.rows) {
    const c = catOf(row);
    ys.forEach((y, s) => {
      const v = toNumber(row[colIndex(t, y)]);
      if (v !== null) sums[s].set(c, (sums[s].get(c) ?? 0) + v);
    });
  }
  return {
    categories,
    series: ys.slice(0, MAX_SERIES).map((y, s) => ({ name: y, column: y, values: categories.map((_, c) => sums[s].get(c) ?? null) })),
    folded: Math.max(0, ys.length - MAX_SERIES),
  };
}

/** Keep the n largest categories (by the first series), fold the rest into "Other". */
export function topCategories(data: SeriesData, n: number): SeriesData {
  if (n <= 0 || data.categories.length <= n) return data;
  const first = data.series[0]?.values ?? [];
  const order = data.categories.map((_, i) => i).sort((a, b) => Math.abs(first[b] ?? 0) - Math.abs(first[a] ?? 0));
  const keep = new Set(order.slice(0, n));
  const idx = data.categories.map((_, i) => i).filter((i) => keep.has(i));
  const sumRest = (values: (number | null)[]) =>
    values.reduce<number>((acc, v, i) => (keep.has(i) ? acc : acc + (v ?? 0)), 0);
  return {
    categories: [...idx.map((i) => data.categories[i]), OTHER],
    series: data.series.map((s) => ({ ...s, values: [...idx.map((i) => s.values[i]), sumRest(s.values)] })),
    folded: data.categories.length - n,
  };
}

/** Pie slices: at most MAX_PIE_SLICES, largest first, the rest as "Other". */
export function pieSlices(t: Table, viz: VizSpec): { name: string; value: number }[] {
  const xi = colIndex(t, viz.x);
  const vi = colIndex(t, viz.value ?? viz.series?.[0]?.y);
  if (vi < 0) return [];
  const sums = new Map<string, number>();
  for (const row of t.rows) {
    const v = toNumber(row[vi]);
    if (v === null || v <= 0) continue; // a pie cannot show negative or zero parts
    const k = xi >= 0 ? key(row[xi]) : t.columns[vi].name;
    sums.set(k, (sums.get(k) ?? 0) + v);
  }
  const sorted = [...sums.entries()].sort((a, b) => b[1] - a[1]);
  const limit = Math.min(viz.topN ?? MAX_PIE_SLICES, MAX_PIE_SLICES);
  if (sorted.length <= limit) return sorted.map(([name, value]) => ({ name, value }));
  const head = sorted.slice(0, limit - 1).map(([name, value]) => ({ name, value }));
  return [...head, { name: OTHER, value: sorted.slice(limit - 1).reduce((a, [, v]) => a + v, 0) }];
}

/** "Nice" histogram bins over a numeric column. */
export function histogram(t: Table, column: string | undefined, bins = 10): { from: number; to: number; count: number }[] {
  const i = colIndex(t, column);
  const values = t.rows.map((r) => toNumber(r[i])).filter((v): v is number => v !== null);
  if (i < 0 || values.length === 0) return [];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }
  const raw = (max - min) / Math.max(1, bins);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const count = Math.max(1, Math.ceil((max - start) / step + 1e-9));
  const out = Array.from({ length: count }, (_, k) => ({ from: round(start + k * step), to: round(start + (k + 1) * step), count: 0 }));
  for (const v of values) {
    const k = Math.min(count - 1, Math.floor((v - start) / step + 1e-9));
    out[k].count++;
  }
  return out;
}

const round = (v: number) => Math.round(v * 1e9) / 1e9;

/** KPI: the last value of the column, the one before it, and all values for a sparkline. */
export function kpiValues(t: Table, column: string | undefined): { value: number | null; previous: number | null; trend: number[] } {
  const i = colIndex(t, column);
  if (i < 0) return { value: null, previous: null, trend: [] };
  const values = t.rows.map((r) => toNumber(r[i]));
  const present = values.filter((v): v is number => v !== null);
  return { value: present.at(-1) ?? null, previous: present.length > 1 ? present.at(-2)! : null, trend: present.slice(-24) };
}

// ---------------------------------------------------------------- pivot table

export interface PivotResult {
  rowKeys: string[][];
  colKeys: string[][];
  valueLabels: string[];
  cell: (r: number, c: number, v: number) => number | null;
  rowTotal: (r: number, v: number) => number | null;
  colTotal: (c: number, v: number) => number | null;
  grandTotal: (v: number) => number | null;
}

function aggregate(values: number[], agg: AggregateFn): number | null {
  if (agg === 'count') return values.length;
  if (values.length === 0) return null;
  if (agg === 'sum') return values.reduce((a, b) => a + b, 0);
  if (agg === 'avg') return values.reduce((a, b) => a + b, 0) / values.length;
  if (agg === 'min') return Math.min(...values);
  return Math.max(...values);
}

export function pivot(t: Table, spec: PivotSpec): PivotResult {
  const ri = spec.rows.map((r) => colIndex(t, r)).filter((i) => i >= 0);
  const ci = spec.columns.map((c) => colIndex(t, c)).filter((i) => i >= 0);
  const vi = spec.values.map((v) => colIndex(t, v.column));
  const rowKeys = new Map<string, string[]>();
  const colKeys = new Map<string, string[]>();
  const buckets = new Map<string, number[][]>(); // "r|c" -> per value list
  const add = (k: string, row: unknown[]) => {
    if (!buckets.has(k)) buckets.set(k, spec.values.map(() => []));
    const b = buckets.get(k)!;
    vi.forEach((i, v) => {
      const n = spec.values[v].agg === 'count' ? 1 : toNumber(row[i]);
      if (n !== null && i >= 0) b[v].push(n);
    });
  };
  for (const row of t.rows) {
    const rk = ri.map((i) => key(row[i]));
    const ck = ci.map((i) => key(row[i]));
    const rks = JSON.stringify(rk);
    const cks = JSON.stringify(ck);
    if (!rowKeys.has(rks)) rowKeys.set(rks, rk);
    if (!colKeys.has(cks)) colKeys.set(cks, ck);
    add(`${rks}|${cks}`, row);
    add(`${rks}|*`, row);
    add(`*|${cks}`, row);
    add('*|*', row);
  }
  const rList = [...rowKeys.keys()];
  const cList = [...colKeys.keys()];
  const get = (k: string, v: number) => {
    const b = buckets.get(k);
    return b ? aggregate(b[v], spec.values[v].agg) : null;
  };
  return {
    rowKeys: [...rowKeys.values()],
    colKeys: [...colKeys.values()],
    valueLabels: spec.values.map((v) => tr('{agg} of {column}', { agg: tr(v.agg), column: v.column })),
    cell: (r, c, v) => get(`${rList[r]}|${cList[c]}`, v),
    rowTotal: (r, v) => get(`${rList[r]}|*`, v),
    colTotal: (c, v) => get(`*|${cList[c]}`, v),
    grandTotal: (v) => get('*|*', v),
  };
}
