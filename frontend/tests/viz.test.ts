import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { suggestViz, vizFits } from '../src/viz/autoViz.ts';
import { histogram, kpiValues, pieSlices, pivot, seriesData, topCategories } from '../src/viz/data.ts';
import { FIXTURES, ordersByStatus, revenueByMonth, revenueByMonthRegion, sizes, oneNumber, weekdayHour } from '../src/viz/fixtures.ts';
import { formatCell, formatDate, formatNumber } from '../src/viz/format.ts';
import { buildOption, scaleWarning } from '../src/viz/options.ts';
import { assignColors, chartTheme, CATEGORICAL, MAX_SERIES, OTHER } from '../src/viz/palette.ts';
import type { VizSpec } from '../src/viz/types.ts';

const light = chartTheme('light');
const dark = chartTheme('dark');

describe('every chart type renders from fixtures', () => {
  for (const f of FIXTURES) {
    test(f.name, () => {
      for (const theme of [light, dark]) {
        const option = buildOption(f.table, f.viz, theme);
        if (['table', 'kpi', 'pivot'].includes(f.viz.type)) {
          assert.equal(option, null); // drawn by React components
          continue;
        }
        assert.ok(option && Array.isArray(option.series) && option.series.length > 0, 'has series');
        const json = JSON.stringify(option);
        assert.ok(!json.includes('NaN'), 'no NaN in the option');
      }
    });
  }

  test('VizSpec round-trips through JSON', () => {
    for (const f of FIXTURES) assert.deepEqual(JSON.parse(JSON.stringify(f.viz)), f.viz);
  });
});

describe('mark specs', () => {
  test('bars are thin with rounded data ends; one value axis only', () => {
    const o = buildOption(ordersByStatus, { version: 1, type: 'bar', x: 'status', series: [{ y: 'orders' }] }, light)!;
    const s = (o.series as Record<string, unknown>[])[0] as { barMaxWidth: number; itemStyle: { borderRadius: number[] } };
    assert.equal(s.barMaxWidth, 24);
    assert.deepEqual(s.itemStyle.borderRadius, [4, 4, 0, 0]);
    assert.ok(!Array.isArray(o.yAxis), 'a single y-axis');
  });

  test('lines are 2 px with ringed 8 px markers; legend only for 2+ series', () => {
    const one = buildOption(revenueByMonth, { version: 1, type: 'line', x: 'created_at_month', series: [{ y: 'revenue' }] }, dark)!;
    const s = (one.series as Record<string, unknown>[])[0] as { lineStyle: { width: number }; symbolSize: number; itemStyle: { borderColor: string; borderWidth: number } };
    assert.equal(s.lineStyle.width, 2);
    assert.equal(s.symbolSize, 8);
    assert.deepEqual([s.itemStyle.borderColor, s.itemStyle.borderWidth], [dark.surface, 2]);
    assert.equal((one.legend as { show: boolean }).show, false);
    const many = buildOption(revenueByMonthRegion, { version: 1, type: 'line', x: 'created_at_month', breakout: 'region', series: [{ y: 'revenue' }] }, dark)!;
    assert.equal((many.legend as { show: boolean }).show, true);
  });

  test('stacked: only the outer segment is rounded, segments separated by the surface', () => {
    const o = buildOption(revenueByMonthRegion, { version: 1, type: 'bar', x: 'created_at_month', breakout: 'region', series: [{ y: 'revenue' }], stack: 'stacked' }, light)!;
    const ss = o.series as { itemStyle: { borderRadius: unknown; borderColor: string } }[];
    assert.equal(ss[0].itemStyle.borderRadius, 0);
    assert.deepEqual(ss[2].itemStyle.borderRadius, [4, 4, 0, 0]);
    assert.equal(ss[0].itemStyle.borderColor, light.surface);
  });

  test('100 % stack sums to 100 per category', () => {
    const o = buildOption(revenueByMonthRegion, { version: 1, type: 'bar', x: 'created_at_month', breakout: 'region', series: [{ y: 'revenue' }], stack: 'percent' }, light)!;
    const ss = o.series as { data: number[] }[];
    for (let c = 0; c < 6; c++) assert.ok(Math.abs(ss.reduce((a, s) => a + s.data[c], 0) - 100) < 1e-9);
  });
});

describe('colours', () => {
  test('slots in fixed order, colour follows the entity, Other is grey', () => {
    const a = assignColors(['EU', 'US', 'APAC'], undefined, light);
    assert.deepEqual(Object.values(a), CATEGORICAL.light.slice(0, 3));
    const saved = assignColors(['US', 'APAC'], { US: 1, APAC: 2 }, light); // EU filtered out: survivors keep their colour
    assert.deepEqual(saved, { US: CATEGORICAL.light[1], APAC: CATEGORICAL.light[2] });
    assert.equal(assignColors(['x', OTHER], undefined, dark)[OTHER], dark.deemphasis);
  });

  test('more than 8 series fold into Other', () => {
    const t = { columns: revenueByMonthRegion.columns, rows: Array.from({ length: 12 }, (_, i) => ['2026-01-01', `R${i}`, i + 1]) };
    const d = seriesData(t, { version: 1, type: 'bar', x: 'created_at_month', breakout: 'region', series: [{ y: 'revenue' }] });
    assert.equal(d.series.length, MAX_SERIES);
    assert.equal(d.series.at(-1)!.name, OTHER);
    assert.equal(d.series.at(-1)!.values[0], 1 + 2 + 3 + 4 + 5); // the five smallest
  });
});

describe('data shaping', () => {
  test('breakout pivots long to wide, keeping row order', () => {
    const d = seriesData(revenueByMonthRegion, { version: 1, type: 'line', x: 'created_at_month', breakout: 'region', series: [{ y: 'revenue' }] });
    assert.deepEqual(d.series.map((s) => s.name), ['EU', 'US', 'APAC']);
    assert.equal(d.categories[0], '2026-01-01');
    assert.equal(d.series[1].values[0], 4800); // US, January: 3000 + 1500 + 300
  });

  test('top N + Other, pie slices capped at 6', () => {
    const d = topCategories(seriesData(ordersByStatus, { version: 1, type: 'bar', x: 'status', series: [{ y: 'orders' }] }), 3);
    assert.deepEqual(d.categories, ['delivered', 'shipped', 'paid', OTHER]);
    assert.equal(d.series[0].values[3], 41 + 27 + 9 + 3);
    const slices = pieSlices(ordersByStatus, { version: 1, type: 'pie', x: 'status', value: 'orders' });
    assert.equal(slices.length, 6);
    assert.deepEqual(slices.at(-1), { name: OTHER, value: 9 + 3 });
  });

  test('histogram bins have nice edges and count every row', () => {
    const t = { columns: sizes.columns, rows: [[1, 0, 0], [2, 0, 0], [9.5, 0, 0], [10, 0, 0]] };
    const bins = histogram(t, 'weight', 5);
    assert.equal(bins.reduce((a, b) => a + b.count, 0), 4);
    assert.equal(bins[0].from, 0);
    assert.ok(bins.every((b) => Number.isInteger(b.to - b.from) || (b.to - b.from) % 0.5 === 0));
  });

  test('pivot with totals', () => {
    const p = pivot(revenueByMonthRegion, { rows: ['created_at_month'], columns: ['region'], values: [{ column: 'revenue', agg: 'sum' }] });
    assert.equal(p.rowKeys.length, 6);
    assert.deepEqual(p.colKeys, [['EU'], ['US'], ['APAC']]);
    assert.equal(p.cell(0, 1, 0), 4800);
    const total = revenueByMonthRegion.rows.reduce((a, r) => a + (r[2] as number), 0);
    assert.equal(p.grandTotal(0), total);
    assert.equal(p.colKeys.reduce((a, _, c) => a + (p.colTotal(c, 0) ?? 0), 0), total);
  });

  test('kpi: last value, previous, trend', () => {
    const k = kpiValues(revenueByMonth, 'revenue');
    assert.equal(k.value, revenueByMonth.rows.at(-1)![1]);
    assert.equal(k.previous, revenueByMonth.rows.at(-2)![1]);
    assert.equal(k.trend.length, 6);
  });
});

describe('automatic chart choice', () => {
  const pick = (t: Parameters<typeof suggestViz>[0]): Partial<VizSpec> => {
    const v = suggestViz(t);
    return { type: v.type, x: v.x, breakout: v.breakout };
  };
  test('by result shape', () => {
    assert.deepEqual(pick(oneNumber), { type: 'kpi', x: undefined, breakout: undefined });
    assert.deepEqual(pick(revenueByMonth), { type: 'line', x: 'created_at_month', breakout: undefined });
    assert.deepEqual(pick(revenueByMonthRegion), { type: 'line', x: 'created_at_month', breakout: 'region' });
    assert.deepEqual(pick(ordersByStatus), { type: 'bar', x: 'status', breakout: undefined });
    assert.deepEqual(pick(weekdayHour), { type: 'bar', x: 'weekday', breakout: 'hour' });
    assert.equal(pick(sizes).type, 'scatter');
    assert.equal(pick({ columns: [{ name: 'name', type: 'string', role: 'dimension' }], rows: [['a']] }).type, 'table');
  });
  test('a spec that no longer fits is detected', () => {
    assert.equal(vizFits({ version: 1, type: 'bar', x: 'status', series: [{ y: 'orders' }] }, ordersByStatus), true);
    assert.equal(vizFits({ version: 1, type: 'bar', x: 'gone', series: [{ y: 'orders' }] }, ordersByStatus), false);
  });
});

describe('formatting', () => {
  test('numbers', () => {
    assert.equal(formatNumber(1234.5, { style: 'currency', currency: 'EUR' }, 'en-US'), '€1,234.50');
    assert.equal(formatNumber(0.125, { style: 'percent' }, 'en-US'), '12.5%');
    assert.equal(formatNumber(12.5, { style: 'percent', percentIsFraction: false }, 'en-US'), '12.5%');
    assert.equal(formatNumber(1534000, { compact: true }, 'en-US'), '1.5M');
    assert.equal(formatNumber(3, { decimals: 2, prefix: '~', suffix: ' kg' }, 'en-US'), '~3.00 kg');
    assert.equal(formatNumber(2024, { style: 'plain' }, 'en-US'), '2024');
    assert.equal(formatNumber(5, { style: 'currency', currency: 'NOPE!' }, 'en-US'), '5');
  });
  test('dates by bucket', () => {
    assert.equal(formatDate('2026-04-01', 'quarter'), 'Q2 2026');
    assert.equal(formatDate('2026-04-01', 'month'), 'Apr 2026');
    assert.equal(formatDate('2026-04-01T10:30:00', 'datetime'), '1 Apr 2026 10:30');
    assert.equal(formatCell('2026-04-01', 'date', 'created_at_month'), 'Apr 2026');
    assert.equal(formatCell(null, 'number', 'x'), '—');
  });
});

describe('one axis only', () => {
  test('warns when measures differ more than 20x', () => {
    const spec: VizSpec = { version: 1, type: 'combo', x: 'created_at_month', series: [{ y: 'revenue' }, { y: 'orders' }] };
    assert.match(scaleWarning(revenueByMonth, spec) ?? '', /share one axis/);
    assert.equal(scaleWarning(revenueByMonth, { ...spec, series: [{ y: 'revenue' }, { y: 'target' }] }), null);
  });
});
