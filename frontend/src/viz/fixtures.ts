/** Sample results and settings for every chart type (unit tests and the Admin -> Chart gallery). */
import type { ResultColumn } from '../api';
import type { Table } from './data.ts';
import type { VizSpec } from './types.ts';

const c = (name: string, type: ResultColumn['type'], role: ResultColumn['role'] = 'dimension'): ResultColumn => ({ name, type, role });

const MONTHS = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'];
const REGIONS = ['EU', 'US', 'APAC'];

export const revenueByMonth: Table = {
  columns: [c('created_at_month', 'date'), c('revenue', 'number', 'measure'), c('orders', 'number', 'measure'), c('target', 'number', 'measure')],
  rows: MONTHS.map((m, i) => [m, 12000 + i * 1800 + (i % 2) * 900, 140 + i * 9, 13000 + i * 1500]),
};

export const revenueByMonthRegion: Table = {
  columns: [c('created_at_month', 'date'), c('region', 'string'), c('revenue', 'number', 'measure')],
  rows: MONTHS.flatMap((m, i) => REGIONS.map((r, k) => [m, r, 3000 + i * 400 + k * 1500 + ((i + k) % 3) * 300])),
};

export const ordersByStatus: Table = {
  columns: [c('status', 'string'), c('orders', 'number', 'measure')],
  rows: [['delivered', 812], ['shipped', 240], ['paid', 133], ['refunded', 41], ['cancelled', 27], ['on hold', 9], ['lost', 3]],
};

export const sizes: Table = {
  columns: [c('weight', 'number', 'measure'), c('price', 'number', 'measure'), c('sold', 'number', 'measure')],
  rows: Array.from({ length: 40 }, (_, i) => [1 + ((i * 37) % 50) / 5, 5 + ((i * 53) % 90), 10 + ((i * 29) % 200)]),
};

export const oneNumber: Table = { columns: [c('revenue', 'number', 'measure')], rows: [[128400.5]] };

export const durations: Table = {
  columns: [c('order_id', 'number'), c('minutes', 'number', 'measure')],
  rows: Array.from({ length: 300 }, (_, i) => [i + 1, Math.round(20 + 40 * Math.abs(Math.sin(i * 1.7)) + (i % 7) * 3)]),
};

export const weekdayHour: Table = {
  columns: [c('weekday', 'string'), c('hour', 'string'), c('orders', 'number', 'measure')],
  rows: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].flatMap((d, i) => ['08', '10', '12', '14', '16', '18'].map((h, k) => [d, h, 5 + ((i * 7 + k * 11) % 30)])),
};

export const funnelSteps: Table = {
  columns: [c('step', 'string'), c('users', 'number', 'measure')],
  rows: [['Visited', 10000], ['Signed up', 3200], ['Added to cart', 1400], ['Paid', 620], ['Came back', 210]],
};

export interface Fixture {
  name: string;
  table: Table;
  viz: VizSpec;
}

const v = (viz: Omit<VizSpec, 'version'>): VizSpec => ({ version: 1, ...viz });

export const FIXTURES: Fixture[] = [
  { name: 'Table', table: revenueByMonth, viz: v({ type: 'table' }) },
  { name: 'Bar', table: ordersByStatus, viz: v({ type: 'bar', x: 'status', series: [{ y: 'orders' }], labels: true }) },
  { name: 'Bar · horizontal, top 4 + other', table: ordersByStatus, viz: v({ type: 'bar', x: 'status', series: [{ y: 'orders' }], horizontal: true, topN: 4 }) },
  { name: 'Bar · grouped', table: revenueByMonthRegion, viz: v({ type: 'bar', x: 'created_at_month', breakout: 'region', series: [{ y: 'revenue' }] }) },
  { name: 'Bar · stacked', table: revenueByMonthRegion, viz: v({ type: 'bar', x: 'created_at_month', breakout: 'region', series: [{ y: 'revenue' }], stack: 'stacked', format: { revenue: { style: 'currency', currency: 'EUR', compact: true } } }) },
  { name: 'Bar · 100 %', table: revenueByMonthRegion, viz: v({ type: 'bar', x: 'created_at_month', breakout: 'region', series: [{ y: 'revenue' }], stack: 'percent' }) },
  { name: 'Line · goal', table: revenueByMonth, viz: v({ type: 'line', x: 'created_at_month', series: [{ y: 'revenue' }], goal: { value: 20000, label: 'Target' }, labels: true }) },
  { name: 'Line · by region', table: revenueByMonthRegion, viz: v({ type: 'line', x: 'created_at_month', breakout: 'region', series: [{ y: 'revenue' }], labels: true }) },
  { name: 'Area · stacked', table: revenueByMonthRegion, viz: v({ type: 'area', x: 'created_at_month', breakout: 'region', series: [{ y: 'revenue' }], stack: 'stacked' }) },
  { name: 'Area · one series', table: revenueByMonth, viz: v({ type: 'area', x: 'created_at_month', series: [{ y: 'revenue' }] }) },
  { name: 'Combo · bars + line, one axis', table: revenueByMonth, viz: v({ type: 'combo', x: 'created_at_month', series: [{ y: 'revenue', kind: 'bar' }, { y: 'target', kind: 'line' }] }) },
  { name: 'Emphasis · one region highlighted', table: revenueByMonthRegion, viz: v({ type: 'line', x: 'created_at_month', breakout: 'region', series: [{ y: 'revenue' }], highlight: 'US' }) },
  { name: 'Donut', table: ordersByStatus, viz: v({ type: 'pie', x: 'status', value: 'orders' }) },
  { name: 'Pie', table: ordersByStatus, viz: v({ type: 'pie', x: 'status', value: 'orders', donut: false, topN: 4 }) },
  { name: 'Scatter', table: sizes, viz: v({ type: 'scatter', x: 'weight', series: [{ y: 'price' }] }) },
  { name: 'Bubble', table: sizes, viz: v({ type: 'scatter', x: 'weight', series: [{ y: 'price' }], size: 'sold' }) },
  { name: 'Number · delta + sparkline', table: revenueByMonth, viz: v({ type: 'kpi', value: 'revenue', x: 'created_at_month', kpi: { compare: true, sparkline: true, upIsGood: true }, format: { revenue: { style: 'currency', currency: 'USD' } } }) },
  { name: 'Number · single', table: oneNumber, viz: v({ type: 'kpi', value: 'revenue', format: { revenue: { compact: true, prefix: '€ ' } } }) },
  { name: 'Gauge', table: oneNumber, viz: v({ type: 'gauge', value: 'revenue', max: 200000, format: { revenue: { compact: true } } }) },
  { name: 'Pivot table', table: revenueByMonthRegion, viz: v({ type: 'pivot', pivot: { rows: ['created_at_month'], columns: ['region'], values: [{ column: 'revenue', agg: 'sum' }], totals: true } }) },
  { name: 'Histogram', table: durations, viz: v({ type: 'histogram', x: 'minutes', bins: 12 }) },
  { name: 'Heatmap', table: weekdayHour, viz: v({ type: 'heatmap', x: 'hour', y2: 'weekday', value: 'orders' }) },
  { name: 'Funnel', table: funnelSteps, viz: v({ type: 'funnel', x: 'step', value: 'users' }) },
];
