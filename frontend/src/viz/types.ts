/**
 * VizSpec: how a result is shown. Renderer-independent JSON, saved with the
 * question from M4 on. Column references are result column names.
 */

import { t } from '../i18n/index.ts';

export type ChartType =
  | 'table' | 'bar' | 'line' | 'area' | 'combo' | 'pie' | 'scatter'
  | 'kpi' | 'gauge' | 'pivot' | 'histogram' | 'heatmap' | 'funnel';

export interface SeriesSpec {
  y: string;
  kind?: 'bar' | 'line' | 'area'; // combo only
}

export type NumberStyle = 'auto' | 'number' | 'currency' | 'percent' | 'plain';
export type DateStyle = 'auto' | 'day' | 'week' | 'month' | 'quarter' | 'year' | 'datetime';

export interface ColumnFormat {
  style?: NumberStyle;
  decimals?: number | null;     // fixed number of decimals
  compact?: boolean;            // 1.2K, 3.4M
  currency?: string;            // ISO code, e.g. EUR
  percentIsFraction?: boolean;  // 0.12 means 12 % (default true)
  prefix?: string;
  suffix?: string;
  date?: DateStyle;
}

export type AggregateFn = 'sum' | 'avg' | 'count' | 'min' | 'max';

export interface PivotSpec {
  rows: string[];
  columns: string[];
  values: { column: string; agg: AggregateFn }[];
  totals?: boolean;
}

export interface VizSpec {
  version: 1;
  type: ChartType;
  x?: string;                         // category / time axis
  series?: SeriesSpec[];              // measures
  breakout?: string;                  // a second dimension split into series (one measure)
  stack?: 'none' | 'stacked' | 'percent';
  horizontal?: boolean;
  labels?: boolean;                   // selective value labels (bar tips, line ends)
  legend?: 'auto' | 'top' | 'bottom' | 'none';
  goal?: { value: number; label?: string } | null;
  topN?: number | null;               // keep the N largest categories, fold the rest into "Other"
  donut?: boolean;
  size?: string;                      // scatter: bubble size column
  y2?: string;                        // heatmap: second dimension
  value?: string;                     // pie / heatmap / funnel / gauge / kpi measure
  min?: number | null;                // gauge
  max?: number | null;                // gauge
  bins?: number;                      // histogram
  pivot?: PivotSpec;
  kpi?: { compare?: boolean; sparkline?: boolean; upIsGood?: boolean };
  axis?: { xTitle?: string; yTitle?: string; yMin?: number | null; yMax?: number | null };
  highlight?: string | null;          // emphasis: this series in colour, the others grey
  colors?: Record<string, number>;    // series name -> palette slot (colour follows the entity)
  format?: Record<string, ColumnFormat>;
  trend?: boolean;                    // line / bar / area: a straight trend line (M7)
  forecast?: number;                  // ... continued this many periods ahead (dates on the x axis)
}

export const CHART_TYPES: { type: ChartType; label: string; hint: string }[] = [
  { type: 'table', label: t('Table'), hint: t('The rows as they are') },
  { type: 'bar', label: t('Bar'), hint: t('Compare categories; grouped, stacked or 100 %') },
  { type: 'line', label: t('Line'), hint: t('Trend over time') },
  { type: 'area', label: t('Area'), hint: t('Trend of one total, or stacked parts') },
  { type: 'combo', label: t('Combo'), hint: t('Bars and lines on one axis') },
  { type: 'pie', label: t('Pie / donut'), hint: t('Share of a whole (up to 6 parts)') },
  { type: 'scatter', label: t('Scatter'), hint: t('Two numbers against each other; bubbles for a third') },
  { type: 'kpi', label: t('Number'), hint: t('One headline value with change and trend') },
  { type: 'gauge', label: t('Gauge'), hint: t('One value against a range') },
  { type: 'pivot', label: t('Pivot table'), hint: t('Rows × columns with totals') },
  { type: 'histogram', label: t('Histogram'), hint: t('How values are distributed') },
  { type: 'heatmap', label: t('Heatmap'), hint: t('A value for each pair of two dimensions') },
  { type: 'funnel', label: t('Funnel'), hint: t('Steps that get smaller') },
];
