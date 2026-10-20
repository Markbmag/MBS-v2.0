/**
 * Suggest a chart from the shape of a result:
 *   one number                       -> Number (KPI)
 *   a date + numbers                 -> Line (a second text column -> one line per value)
 *   a category + numbers             -> Bar (pie is never the default: bars compare better)
 *   two text columns + one number    -> Bar split by the second (few values) or Heatmap
 *   two or three numbers, no labels  -> Scatter
 *   anything else                    -> Table
 */
import type { ResultColumn } from '../api';
import { MAX_SERIES } from './palette.ts';
import type { Table } from './data.ts';
import type { VizSpec } from './types.ts';

const isTime = (c: ResultColumn) => c.type === 'date' || c.type === 'datetime';
const isNum = (c: ResultColumn) => c.type === 'number';

function distinct(t: Table, name: string): number {
  const i = t.columns.findIndex((c) => c.name === name);
  return new Set(t.rows.map((r) => String(r[i]))).size;
}

export function suggestViz(t: Table): VizSpec {
  const base = { version: 1 as const };
  if (t.rows.length === 0 || t.columns.length === 0) return { ...base, type: 'table' };
  const measures = t.columns.filter((c) => isNum(c) && c.role === 'measure');
  const numbers = measures.length > 0 ? measures : t.columns.filter(isNum);
  const dims = t.columns.filter((c) => !numbers.includes(c));

  if (t.rows.length === 1 && numbers.length === 1 && dims.length <= 1) return { ...base, type: 'kpi', value: numbers[0].name };
  if (numbers.length === 0) return { ...base, type: 'table' };

  const time = dims.find(isTime);
  const text = dims.filter((c) => !isTime(c));

  if (time && dims.length === 1) {
    return { ...base, type: 'line', x: time.name, series: numbers.slice(0, MAX_SERIES).map((c) => ({ y: c.name })) };
  }
  if (time && dims.length === 2 && text.length === 1 && distinct(t, text[0].name) <= MAX_SERIES) {
    return { ...base, type: 'line', x: time.name, breakout: text[0].name, series: [{ y: numbers[0].name }] };
  }
  if (dims.length === 1 && t.rows.length <= 200) {
    return { ...base, type: 'bar', x: dims[0].name, series: numbers.slice(0, MAX_SERIES).map((c) => ({ y: c.name })) };
  }
  if (dims.length === 2 && numbers.length === 1) {
    const [a, b] = dims;
    if (distinct(t, b.name) <= MAX_SERIES && t.rows.length <= 400) {
      return { ...base, type: 'bar', x: a.name, breakout: b.name, series: [{ y: numbers[0].name }], stack: 'stacked' };
    }
    if (distinct(t, a.name) <= 60 && distinct(t, b.name) <= 60) {
      return { ...base, type: 'heatmap', x: a.name, y2: b.name, value: numbers[0].name };
    }
  }
  if (dims.length === 0 && numbers.length >= 2) {
    return { ...base, type: 'scatter', x: numbers[0].name, series: [{ y: numbers[1].name }], size: numbers[2]?.name };
  }
  return { ...base, type: 'table' };
}

/** Does this spec still fit the result (after the question changed)? */
export function vizFits(viz: VizSpec, t: Table): boolean {
  const names = new Set(t.columns.map((c) => c.name));
  const refs = [viz.x, viz.breakout, viz.size, viz.y2, viz.value, ...(viz.series ?? []).map((s) => s.y),
    ...(viz.pivot ? [...viz.pivot.rows, ...viz.pivot.columns, ...viz.pivot.values.map((v) => v.column)] : [])];
  return refs.every((r) => r === undefined || r === null || r === '' || names.has(r));
}
