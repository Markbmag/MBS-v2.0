/**
 * VizSpec + result -> ECharts option. Pure (no DOM), so every chart type is
 * unit-tested from fixtures. Mark specs follow the data-viz rules: bars <= 24 px
 * with 4 px rounded data ends, 2 px lines, >= 8 px markers with a 2 px surface ring,
 * 10 % area wash, a 2 px surface gap between stacked segments, hairline solid grid,
 * one y-axis only, a legend only for two or more series.
 */
import type { EChartsOption } from 'echarts';
import { colIndex, histogram, pieSlices, seriesData, toNumber, topCategories } from './data.ts';
import type { SeriesData, Table } from './data.ts';
import { dateStyleFromName, formatAxisNumber, formatCell, formatDate, formatNumber } from './format.ts';
import { MAX_SCATTER_SERIES, OTHER, assignColors } from './palette.ts';
import type { ChartTheme } from './palette.ts';
import { nextDates, trendValues } from './stats.ts';
import type { ColumnFormat, VizSpec } from './types.ts';
import { t as tr } from '../i18n/index.ts';

type AnyRecord = Record<string, unknown>;

const BAR_MAX = 24;
const RADIUS = 4;

function fmtOf(viz: VizSpec, column: string | undefined): ColumnFormat {
  return (column && viz.format?.[column]) || {};
}

function categoryLabel(t: Table, viz: VizSpec, raw: string): string {
  const xi = colIndex(t, viz.x);
  const col = t.columns[xi];
  if (!col || raw === OTHER) return raw;
  if (col.type === 'date' || col.type === 'datetime') {
    const f = fmtOf(viz, col.name);
    return formatDate(raw, f.date && f.date !== 'auto' ? f.date : dateStyleFromName(col.name));
  }
  return raw;
}

function base(theme: ChartTheme): EChartsOption {
  return {
    backgroundColor: 'transparent',
    animationDuration: 300,
    textStyle: { fontFamily: theme.font, color: theme.textSecondary, fontSize: 12 },
    tooltip: {
      backgroundColor: theme.surface,
      borderColor: theme.axis,
      borderWidth: 1,
      textStyle: { color: theme.text, fontSize: 12 },
      extraCssText: 'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.18);',
      confine: true,
    },
  };
}

function legendOf(viz: VizSpec, theme: ChartTheme, count: number): EChartsOption['legend'] {
  const where = viz.legend ?? 'auto';
  if (where === 'none' || count < 2) return { show: false };
  return {
    show: true,
    type: 'scroll',
    [where === 'bottom' ? 'bottom' : 'top']: 0,
    left: 0,
    icon: 'roundRect',
    itemWidth: 10,
    itemHeight: 10,
    textStyle: { color: theme.textSecondary },
    pageTextStyle: { color: theme.textSecondary },
  };
}

function axisStyle(theme: ChartTheme): AnyRecord {
  return {
    axisLine: { lineStyle: { color: theme.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: theme.muted, hideOverlap: true },
    splitLine: { lineStyle: { color: theme.grid, width: 1, type: 'solid' } },
    nameTextStyle: { color: theme.textSecondary },
  };
}

// ---------------------------------------------------------------- bar / line / area / combo

function cartesian(t: Table, viz: VizSpec, theme: ChartTheme): EChartsOption {
  let data: SeriesData = seriesData(t, viz);
  if (viz.topN && viz.type === 'bar') data = topCategories(data, viz.topN);
  const percent = viz.stack === 'percent';
  const stacked = viz.stack === 'stacked' || percent;
  const horizontal = viz.type === 'bar' && !!viz.horizontal;
  const colors = assignColors(data.series.map((s) => s.name), viz.colors, theme);
  const measureFmt = fmtOf(viz, data.series[0]?.column);

  let values = data.series.map((s) => s.values);
  if (percent) {
    const totals = data.categories.map((_, c) => values.reduce((a, v) => a + Math.abs(v[c] ?? 0), 0));
    values = values.map((v) => v.map((x, c) => (x === null || totals[c] === 0 ? null : (x / totals[c]) * 100)));
  }

  const kindOf = (i: number): 'bar' | 'line' | 'area' => {
    if (viz.type === 'combo') return viz.series?.[i]?.kind ?? (i === 0 ? 'bar' : 'line');
    if (viz.type === 'area') return 'area';
    if (viz.type === 'line') return 'line';
    return 'bar';
  };
  const showSymbols = data.categories.length <= 40;
  const last = data.series.length - 1;

  const series = data.series.map((s, i) => {
    const kind = viz.breakout ? kindOf(0) : kindOf(i);
    const color = viz.highlight && viz.highlight !== s.name ? theme.deemphasis : colors[s.name];
    const common = {
      name: s.name,
      data: values[i],
      itemStyle: { color },
      emphasis: { focus: 'series' },
      ...(stacked && kind !== 'line' ? { stack: 'total' } : {}),
    };
    if (kind === 'bar') {
      const end = horizontal ? [0, RADIUS, RADIUS, 0] : [RADIUS, RADIUS, 0, 0];
      // In a stack only the outermost segment gets the rounded end; segments are separated by a surface gap.
      const radius = stacked && i !== last ? 0 : end;
      return {
        ...common,
        type: 'bar',
        barMaxWidth: BAR_MAX,
        barGap: '15%',
        itemStyle: { color, borderRadius: radius, borderColor: stacked ? theme.surface : undefined, borderWidth: stacked ? 1 : 0 },
        label: viz.labels && (!stacked || i === last)
          ? { show: true, position: horizontal ? 'right' : 'top', color: theme.textSecondary, fontSize: 11, formatter: (p: { value: number }) => (p.value === null ? '' : percent ? `${Math.round(p.value)}%` : formatAxisNumber(p.value, measureFmt)) }
          : undefined,
      };
    }
    return {
      ...common,
      type: 'line',
      smooth: false,
      connectNulls: false,
      lineStyle: { width: 2, color, cap: 'round', join: 'round' },
      symbol: 'circle',
      symbolSize: 8,
      showSymbol: showSymbols,
      itemStyle: { color, borderColor: theme.surface, borderWidth: 2 },
      ...(kind === 'area' ? { areaStyle: { color, opacity: stacked ? 0.25 : 0.1 } } : {}),
      // a value at the end of the line, not on every point
      endLabel: viz.labels
        ? { show: true, color: theme.textSecondary, fontSize: 11, formatter: (p: { value: number }) => (p.value === null ? '' : formatAxisNumber(p.value, measureFmt)) }
        : undefined,
    };
  });

  if (viz.goal && series.length > 0) {
    (series[0] as AnyRecord).markLine = {
      silent: true,
      symbol: 'none',
      lineStyle: { color: theme.textSecondary, width: 1, type: 'dashed' },
      label: { color: theme.textSecondary, formatter: viz.goal.label || tr('Goal {value}', { value: formatAxisNumber(viz.goal.value, measureFmt) }), position: 'insideEndTop' },
      data: [horizontal ? { xAxis: viz.goal.value } : { yAxis: viz.goal.value }],
    };
  }

  const xType = t.columns[colIndex(t, viz.x)]?.type;
  const timeAxis = xType === 'date' || xType === 'datetime';

  // Trend line (and forecast along it) for one measure, M7
  let categories = data.categories;
  if ((viz.trend || (viz.forecast ?? 0) > 0) && !viz.breakout && !percent && !horizontal && series.length > 0) {
    const future = timeAxis && viz.forecast ? nextDates(data.categories, Math.min(viz.forecast, 36)) ?? [] : [];
    const trend = trendValues(values[0], future.length);
    if (trend) {
      if (future.length) {
        categories = [...categories, ...future];
        for (const s of series as AnyRecord[]) s.data = [...(s.data as unknown[]), ...future.map(() => null)];
      }
      (series as AnyRecord[]).push({
        name: future.length ? tr('Trend and forecast') : tr('Trend'),
        type: 'line',
        data: trend,
        symbol: 'none',
        silent: true,
        z: 1,
        lineStyle: { width: 1.5, type: 'dashed', color: theme.textSecondary },
        itemStyle: { color: theme.textSecondary },
        ...(future.length
          ? { markArea: { silent: true, itemStyle: { color: theme.axis, opacity: 0.15 }, data: [[{ xAxis: data.categories.length - 0.5 }, { xAxis: categories.length - 0.5 }]] } }
          : {}),
      });
    }
  }
  const labels = categories.map((c) => categoryLabel(t, viz, c));
  const longest = Math.max(0, ...labels.map((l) => l.length));
  const categoryAxis = {
    type: 'category',
    data: labels,
    name: viz.axis?.xTitle,
    nameLocation: 'middle',
    nameGap: 28,
    boundaryGap: series.some((s) => s.type === 'bar'),
    ...axisStyle(theme),
    // Text categories: show each label when there are few (rotated if long); dates and many
    // categories: ECharts thins them out so they never overlap.
    axisLabel: {
      color: theme.muted,
      hideOverlap: true,
      interval: labels.length <= 12 && !timeAxis ? 0 : 'auto',
      rotate: !horizontal && !timeAxis && labels.length <= 12 && labels.length * Math.min(longest, 14) > 40 ? 30 : 0,
      width: horizontal ? 110 : 90,
      overflow: 'truncate',
    },
    splitLine: { show: false },
  };
  const valueAxis = {
    type: 'value',
    name: viz.axis?.yTitle,
    nameLocation: 'middle',
    nameGap: 48,
    min: percent ? 0 : (viz.axis?.yMin ?? undefined),
    max: percent ? 100 : (viz.axis?.yMax ?? undefined),
    ...axisStyle(theme),
    axisLine: { show: false },
    axisLabel: { color: theme.muted, formatter: (v: number) => (percent ? `${v}%` : formatAxisNumber(v, measureFmt)) },
  };

  const lineLike = series.every((s) => s.type === 'line');
  const option: EChartsOption = {
    ...base(theme),
    legend: legendOf(viz, theme, series.length),
    grid: { left: 8, right: viz.labels ? 48 : 16, top: series.length > 1 && viz.legend !== 'bottom' ? 36 : 16, bottom: viz.legend === 'bottom' ? 36 : 8, containLabel: true },
    xAxis: (horizontal ? valueAxis : categoryAxis) as EChartsOption['xAxis'],
    yAxis: (horizontal ? { ...categoryAxis, inverse: true } : valueAxis) as EChartsOption['yAxis'],
    series: series as EChartsOption['series'],
  };
  option.tooltip = {
    ...(option.tooltip as AnyRecord),
    trigger: lineLike ? 'axis' : 'item',
    axisPointer: lineLike ? { type: 'line', lineStyle: { color: theme.axis, width: 1 } } : undefined,
    valueFormatter: (v: unknown) => (typeof v === 'number' ? (percent ? `${v.toFixed(1)}%` : formatNumber(v, measureFmt)) : '—'),
  } as EChartsOption['tooltip'];
  return option;
}

// ---------------------------------------------------------------- pie

function pie(t: Table, viz: VizSpec, theme: ChartTheme): EChartsOption {
  const slices = pieSlices(t, viz);
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const colors = assignColors(slices.map((s) => s.name), viz.colors, theme);
  const fmt = fmtOf(viz, viz.value ?? viz.series?.[0]?.y);
  return {
    ...base(theme),
    legend: legendOf({ ...viz, legend: viz.legend === 'auto' || !viz.legend ? 'bottom' : viz.legend }, theme, slices.length),
    tooltip: { ...(base(theme).tooltip as AnyRecord), trigger: 'item', valueFormatter: (v: unknown) => (typeof v === 'number' ? formatNumber(v, fmt) : '—') },
    series: [
      {
        type: 'pie',
        radius: viz.donut === false ? ['0%', '58%'] : ['38%', '58%'],
        center: ['50%', '45%'],
        percentPrecision: 0,
        avoidLabelOverlap: true,
        itemStyle: { borderColor: theme.surface, borderWidth: 2, borderRadius: 4 },
        label: { color: theme.textSecondary, formatter: '{b}\n{d}%', fontSize: 11, alignTo: 'labelLine', edgeDistance: '12%', overflow: 'truncate', width: 80 },
        labelLine: { lineStyle: { color: theme.axis } },
        // Direct labels only on slices big enough to carry one; the legend and tooltip cover the rest.
        data: slices.map((s) => {
          const big = s.value / total >= 0.08;
          return { ...s, name: categoryLabel(t, viz, s.name), itemStyle: { color: colors[s.name] }, label: { show: big }, labelLine: { show: big } };
        }),
      },
    ],
  };
}

// ---------------------------------------------------------------- scatter / bubble

function scatter(t: Table, viz: VizSpec, theme: ChartTheme): EChartsOption {
  const xi = colIndex(t, viz.x);
  const ys = (viz.series ?? []).map((s) => s.y).filter((y) => colIndex(t, y) >= 0).slice(0, MAX_SCATTER_SERIES);
  const si = colIndex(t, viz.size);
  const sizes = si >= 0 ? t.rows.map((r) => toNumber(r[si]) ?? 0) : [];
  const maxSize = Math.max(1, ...sizes.map(Math.abs));
  const colors = assignColors(ys, viz.colors, theme);
  const xFmt = fmtOf(viz, viz.x);
  return {
    ...base(theme),
    legend: legendOf(viz, theme, ys.length),
    grid: { left: 8, right: 16, top: ys.length > 1 ? 36 : 16, bottom: 8, containLabel: true },
    tooltip: { ...(base(theme).tooltip as AnyRecord), trigger: 'item' },
    xAxis: { type: 'value', scale: true, name: viz.axis?.xTitle ?? viz.x, nameLocation: 'middle', nameGap: 28, ...axisStyle(theme), axisLabel: { color: theme.muted, formatter: (v: number) => formatAxisNumber(v, xFmt) } },
    yAxis: { type: 'value', scale: true, name: viz.axis?.yTitle, ...axisStyle(theme), axisLine: { show: false }, axisLabel: { color: theme.muted, formatter: (v: number) => formatAxisNumber(v, fmtOf(viz, ys[0])) } },
    series: ys.map((y) => {
      const yi = colIndex(t, y);
      return {
        type: 'scatter',
        name: y,
        data: t.rows.map((r, k) => [toNumber(r[xi]), toNumber(r[yi]), sizes[k] ?? null]),
        // bubble area proportional to the value; at least 8 px so it stays visible and hoverable
        symbolSize: (v: (number | null)[]) => (si >= 0 ? Math.max(8, Math.sqrt(Math.abs(v[2] ?? 0) / maxSize) * 48) : 9),
        itemStyle: { color: colors[y], borderColor: theme.surface, borderWidth: 2, opacity: si >= 0 ? 0.8 : 1 },
        emphasis: { focus: 'series' },
      };
    }) as EChartsOption['series'],
  };
}

// ---------------------------------------------------------------- histogram

function histogramChart(t: Table, viz: VizSpec, theme: ChartTheme): EChartsOption {
  const column = viz.x ?? viz.value;
  const bins = histogram(t, column, viz.bins ?? 10);
  const fmt = fmtOf(viz, column);
  return {
    ...base(theme),
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: { ...(base(theme).tooltip as AnyRecord), trigger: 'item' },
    xAxis: { type: 'category', data: bins.map((b) => `${formatAxisNumber(b.from, fmt)} – ${formatAxisNumber(b.to, fmt)}`), name: viz.axis?.xTitle ?? column, nameLocation: 'middle', nameGap: 28, ...axisStyle(theme), splitLine: { show: false } },
    yAxis: { type: 'value', name: viz.axis?.yTitle ?? tr('rows'), nameLocation: 'middle', nameGap: 40, ...axisStyle(theme), axisLine: { show: false } },
    series: [
      {
        type: 'bar',
        name: tr('rows'),
        data: bins.map((b) => b.count),
        barCategoryGap: '2px', // bins touch, separated by the 2 px surface gap
        itemStyle: { color: theme.series[0], borderRadius: [RADIUS, RADIUS, 0, 0] },
      },
    ],
  };
}

// ---------------------------------------------------------------- heatmap

function heatmap(t: Table, viz: VizSpec, theme: ChartTheme): EChartsOption {
  const xi = colIndex(t, viz.x);
  const yi = colIndex(t, viz.y2);
  const vi = colIndex(t, viz.value ?? viz.series?.[0]?.y);
  const xs: string[] = [];
  const ys: string[] = [];
  const cells = new Map<string, number>();
  for (const r of t.rows) {
    const x = String(r[xi] ?? tr('(empty)'));
    const y = String(r[yi] ?? tr('(empty)'));
    if (!xs.includes(x)) xs.push(x);
    if (!ys.includes(y)) ys.push(y);
    const v = toNumber(r[vi]);
    if (v !== null) cells.set(`${x}\u0000${y}`, (cells.get(`${x}\u0000${y}`) ?? 0) + v);
  }
  const values = [...cells.values()];
  const fmt = fmtOf(viz, t.columns[vi]?.name);
  return {
    ...base(theme),
    grid: { left: 8, right: 16, top: 16, bottom: 56, containLabel: true },
    tooltip: { ...(base(theme).tooltip as AnyRecord), trigger: 'item', valueFormatter: (v: unknown) => (typeof v === 'number' ? formatNumber(v, fmt) : '—') },
    xAxis: { type: 'category', data: xs.map((x) => categoryLabel(t, viz, x)), ...axisStyle(theme), splitLine: { show: false } },
    yAxis: { type: 'category', data: ys, ...axisStyle(theme), splitLine: { show: false } },
    visualMap: {
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 1,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemHeight: 160,
      itemWidth: 10,
      inRange: { color: theme.heat },
      textStyle: { color: theme.textSecondary },
      formatter: (v: unknown) => formatAxisNumber(Number(v), fmt),
    },
    series: [
      {
        type: 'heatmap',
        name: t.columns[vi]?.name,
        data: [...cells.entries()].map(([k, v]) => {
          const [x, y] = k.split('\u0000');
          return [xs.indexOf(x), ys.indexOf(y), v];
        }),
        itemStyle: { borderColor: theme.surface, borderWidth: 2, borderRadius: 2 },
        emphasis: { itemStyle: { borderColor: theme.text, borderWidth: 1 } },
      },
    ],
  };
}

// ---------------------------------------------------------------- funnel

function funnel(t: Table, viz: VizSpec, theme: ChartTheme): EChartsOption {
  const xi = colIndex(t, viz.x);
  const vi = colIndex(t, viz.value ?? viz.series?.[0]?.y);
  const stages = t.rows
    .map((r) => ({ name: categoryLabel(t, viz, String(r[xi] ?? tr('(empty)'))), value: toNumber(r[vi]) ?? 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, theme.ordinal.length);
  const first = stages[0]?.value || 1;
  const fmt = fmtOf(viz, t.columns[vi]?.name);
  return {
    ...base(theme),
    tooltip: { ...(base(theme).tooltip as AnyRecord), trigger: 'item', valueFormatter: (v: unknown) => (typeof v === 'number' ? formatNumber(v, fmt) : '—') },
    series: [
      {
        type: 'funnel',
        left: '6%',
        right: '40%',
        top: 8,
        bottom: 8,
        minSize: '8%',
        gap: 2,
        sort: 'descending',
        label: {
          position: 'right',
          color: theme.textSecondary,
          formatter: (p: { name: string; value?: unknown }) => {
            const value = Number(p.value ?? 0);
            return `${p.name}  ${formatNumber(value, fmt)} · ${Math.round((value / first) * 100)}%`;
          },
        },
        labelLine: { lineStyle: { color: theme.axis } },
        itemStyle: { borderWidth: 0, borderRadius: 2 },
        data: stages.map((s, i) => ({ ...s, itemStyle: { color: theme.ordinal[i] } })),
      },
    ],
  };
}

// ---------------------------------------------------------------- gauge

function gauge(t: Table, viz: VizSpec, theme: ChartTheme): EChartsOption {
  const vi = colIndex(t, viz.value ?? viz.series?.[0]?.y);
  const values = t.rows.map((r) => toNumber(r[vi])).filter((v): v is number => v !== null);
  const value = values.at(-1) ?? 0;
  const min = viz.min ?? 0;
  const max = viz.max ?? niceMax(Math.max(value, viz.goal?.value ?? 0));
  const fmt = fmtOf(viz, t.columns[vi]?.name);
  return {
    ...base(theme),
    series: [
      {
        type: 'gauge',
        min,
        max,
        startAngle: 210,
        endAngle: -30,
        radius: '90%',
        center: ['50%', '58%'],
        progress: { show: true, width: 14, roundCap: true, itemStyle: { color: theme.series[0] } },
        axisLine: { roundCap: true, lineStyle: { width: 14, color: [[1, theme.track]] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        title: { show: true, offsetCenter: [0, '32%'], color: theme.textSecondary, fontSize: 12 },
        detail: { valueAnimation: true, offsetCenter: [0, '0%'], color: theme.text, fontSize: 30, fontWeight: 600, formatter: (v: number) => formatNumber(v, fmt) },
        data: [{ value, name: tr('of {max}', { max: formatNumber(max, fmt) }) }],
      },
    ],
  };
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((m) => m >= v) ?? v);
}

/**
 * One axis only (no dual axes), so measures of very different size flatten each
 * other. Returns a short note for the user when that happens (> 20x apart).
 */
export function scaleWarning(t: Table, viz: VizSpec): string | null {
  if (!['bar', 'line', 'area', 'combo'].includes(viz.type) || viz.breakout || (viz.series?.length ?? 0) < 2 || viz.stack === 'percent') return null;
  const data = seriesData(t, viz);
  const peaks = data.series.map((s) => Math.max(0, ...s.values.map((v) => Math.abs(v ?? 0))));
  const lo = Math.min(...peaks.filter((p) => p > 0));
  const hi = Math.max(...peaks);
  if (!Number.isFinite(lo) || hi / lo <= 20) return null;
  return tr('These series differ a lot in size and share one axis, so the small one looks flat. Two separate charts show both better.');
}

/** Formats from the data model (sent with the result columns) under the chart's own formats. */
export function withColumnFormats(viz: VizSpec, t: Table): VizSpec {
  const defaults: Record<string, ColumnFormat> = {};
  for (const c of t.columns) if (c.format) defaults[c.name] = c.format as ColumnFormat;
  if (Object.keys(defaults).length === 0) return viz;
  return { ...viz, format: { ...defaults, ...(viz.format ?? {}) } };
}

/** null for the types rendered by React (table, kpi, pivot). */
export function buildOption(t: Table, spec: VizSpec, theme: ChartTheme): EChartsOption | null {
  const viz = withColumnFormats(spec, t);
  switch (viz.type) {
    case 'bar':
    case 'line':
    case 'area':
    case 'combo':
      return cartesian(t, viz, theme);
    case 'pie':
      return pie(t, viz, theme);
    case 'scatter':
      return scatter(t, viz, theme);
    case 'histogram':
      return histogramChart(t, viz, theme);
    case 'heatmap':
      return heatmap(t, viz, theme);
    case 'funnel':
      return funnel(t, viz, theme);
    case 'gauge':
      return gauge(t, viz, theme);
    default:
      return null;
  }
}

export { formatCell };
