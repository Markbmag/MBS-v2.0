// Run with: npm test   (Node's built-in test runner; Node 22+ runs TypeScript directly)
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Relationship, SchemaTable } from '../src/api.ts';
import { columnOptions, prepareSpec, queryTables, summaryOutputs } from '../src/query/draft.ts';
import { FormulaError, formatFormula, formulaRefs, parseFormula } from '../src/query/expression.ts';
import { findJoinPath, joinSuggestions } from '../src/query/joins.ts';
import { operatorsFor, valueComplete } from '../src/query/operators.ts';
import type { QuerySpec } from '../src/query/types.ts';
import { formatValue, normalizeDate } from '../src/lib/format.ts';

const col = (name: string, type: SchemaTable['columns'][number]['type'], pk = false) => ({
  name, type, db_type: type, nullable: true, primary_key: pk, foreign_key: null,
});

const TABLES: SchemaTable[] = [
  { name: 'customers', primary_key: ['id'], columns: [col('id', 'number', true), col('name', 'string'), col('region', 'string')] },
  { name: 'orders', primary_key: ['id'], columns: [col('id', 'number', true), col('customer_id', 'number'), col('total', 'number'), col('created_at', 'datetime'), col('photo', 'binary')] },
  { name: 'order_items', primary_key: [], columns: [col('order_id', 'number'), col('sku', 'string'), col('qty', 'number')] },
  { name: 'products', primary_key: ['sku'], columns: [col('sku', 'string', true), col('title', 'string')] },
  { name: 'notes', primary_key: [], columns: [col('body', 'string')] },
];
const RELS: Relationship[] = [
  { from_table: 'orders', from_columns: ['customer_id'], to_table: 'customers', to_columns: ['id'] },
  { from_table: 'order_items', from_columns: ['order_id'], to_table: 'orders', to_columns: ['id'] },
  { from_table: 'order_items', from_columns: ['sku'], to_table: 'products', to_columns: ['sku'] },
];
const SCHEMA = { tables: TABLES, relationships: RELS };

describe('join paths', () => {
  test('shortest path in both directions', () => {
    const path = findJoinPath(RELS, 'customers', 'products');
    assert.deepEqual(path?.map((s) => s.table), ['orders', 'order_items', 'products']);
    assert.deepEqual(path?.[0].on, [['customers.id', 'orders.customer_id']]);
    assert.equal(findJoinPath(RELS, 'orders', 'notes'), null);
    assert.deepEqual(findJoinPath(RELS, 'orders', 'orders'), []);
  });

  test('suggestions list reachable tables with the tables in between', () => {
    const s = joinSuggestions(RELS, TABLES.map((t) => t.name), ['customers']);
    assert.deepEqual(s, [
      { table: 'orders', via: [], hops: 1 },
      { table: 'order_items', via: ['orders'], hops: 2 },
      { table: 'products', via: ['orders', 'order_items'], hops: 3 },
    ]);
  });

  test('a foreign-key join brings its in-between tables into the question', () => {
    const spec: QuerySpec = { version: 1, connection: 'c', source: { table: 'customers' }, joins: [{ table: 'products', type: 'inner' }] };
    assert.deepEqual(queryTables(spec, SCHEMA), [
      { alias: 'customers', table: 'customers' },
      { alias: 'orders', table: 'orders', via: true },
      { alias: 'order_items', table: 'order_items', via: true },
      { alias: 'products', table: 'products' },
    ]);
  });
});

describe('formulas', () => {
  test('arithmetic with precedence and brackets', () => {
    assert.deepEqual(parseFormula('[Orders.total] - [tax] * 2'), {
      op: '-', args: [{ ref: 'Orders.total' }, { op: '*', args: [{ ref: 'tax' }, { value: 2 }] }],
    });
    assert.deepEqual(parseFormula('(total - tax) / qty'), {
      op: '/', args: [{ op: '-', args: [{ ref: 'total' }, { ref: 'tax' }] }, { ref: 'qty' }],
    });
    assert.deepEqual(parseFormula('-5 + -[x]'), { op: '+', args: [{ value: -5 }, { op: '-', args: [{ value: 0 }, { ref: 'x' }] }] });
  });

  test('functions, strings and round digits', () => {
    assert.deepEqual(parseFormula("coalesce([status], 'it''s none')"), { fn: 'coalesce', args: [{ ref: 'status' }, { value: "it's none" }] });
    assert.deepEqual(parseFormula('ROUND([total] / 3, 2)'), { fn: 'round', args: [{ op: '/', args: [{ ref: 'total' }, { value: 3 }] }], digits: 2 });
    assert.deepEqual(parseFormula('upper([first name])'), { fn: 'upper', args: [{ ref: 'first name' }] });
  });

  test('case with conditions and an otherwise value', () => {
    assert.deepEqual(parseFormula("case([total] >= 100, 'big', [total] <> 0, 'small', 'zero')"), {
      case: [
        { when: { ref: 'total', op: '>=', value: 100 }, then: { value: 'big' } },
        { when: { ref: 'total', op: '!=', value: 0 }, then: { value: 'small' } },
      ],
      else: { value: 'zero' },
    });
  });

  test('errors say what is wrong', () => {
    assert.throws(() => parseFormula('sum([x])'), /Unknown function sum/);
    assert.throws(() => parseFormula('[x] +'), /ends too early/);
    assert.throws(() => parseFormula("'open"), /not closed/);
    assert.throws(() => parseFormula('round([x], 1.5)'), /whole number/);
    assert.throws(() => parseFormula('case([x] > [y], 1)'), /fixed value/);
    assert.throws(() => parseFormula('[x] [y]'), FormulaError);
  });

  test('printing round-trips', () => {
    for (const text of ["[a] - [b] * 2", "([a] - [b]) / [c]", "round([t] / 3, 2)", "case([t] >= 100, 'big', 'small')", "coalesce([s], 'n/a')"]) {
      const expr = parseFormula(text);
      assert.deepEqual(parseFormula(formatFormula(expr)), expr, text);
    }
    assert.deepEqual(formulaRefs(parseFormula("case([a] > 1, [b], [c]) + [a]")), ['a', 'b', 'c']);
  });
});

describe('question helpers', () => {
  const base: QuerySpec = { version: 1, connection: 'shop', source: { table: 'orders' }, joins: [{ table: 'customers', type: 'left' }] };

  test('column options cover joined tables, skip blobs, include custom columns', () => {
    const spec = { ...base, expressions: [{ name: 'net', expr: parseFormula('[orders.total] * 0.8') }] };
    const opts = columnOptions(spec, SCHEMA);
    assert.ok(opts.some((o) => o.ref === 'customers.region' && o.label === 'Customers → Region'));
    assert.ok(!opts.some((o) => o.column === 'photo'));
    assert.deepEqual(opts.find((o) => o.ref === 'net')?.type, 'number');
  });

  test('summary outputs are named like the backend names them', () => {
    const spec: QuerySpec = {
      ...base,
      breakouts: [{ ref: 'orders.created_at', bucket: 'month' }, { ref: 'customers.region' }],
      aggregations: [{ fn: 'sum', ref: 'orders.total' }, { fn: 'count' }, { fn: 'count_distinct', ref: 'orders.customer_id' }, { fn: 'sum', ref: 'orders.total' }],
    };
    const names = summaryOutputs(spec, columnOptions(spec, SCHEMA)).map((o) => `${o.name}:${o.type}`);
    assert.deepEqual(names, ['created_at_month:date', 'region:string', 'sum_total:number', 'count:number', 'distinct_customer_id:number', 'sum_total_2:number']);
  });

  test('prepareSpec drops half-written parts and names summaries', () => {
    const spec: QuerySpec = {
      ...base,
      breakouts: [{ ref: 'customers.region' }],
      aggregations: [{ fn: 'sum', ref: 'orders.total' }, { fn: 'avg' }],
      filters: { op: 'and', rules: [
        { ref: 'orders.total', op: '>', value: '' },
        { ref: 'customers.region', op: 'in', value: ['EU'] },
        { op: 'or', rules: [] },
      ] },
      order: [{ ref: 'sum_total', dir: 'desc' }, { ref: 'gone', dir: 'asc' }],
    };
    const { spec: out, problems } = prepareSpec(spec, SCHEMA);
    assert.deepEqual(problems, []);
    assert.deepEqual(out.aggregations, [{ fn: 'sum', ref: 'orders.total', alias: 'sum_total' }]);
    assert.deepEqual(out.breakouts, [{ ref: 'customers.region', alias: 'region' }]);
    assert.deepEqual(out.filters, { op: 'and', rules: [{ ref: 'customers.region', op: 'in', value: ['EU'] }] });
    assert.deepEqual(out.order, [{ ref: 'sum_total', dir: 'desc' }]);
  });

  test('unknown columns in custom formulas are reported', () => {
    const spec = { ...base, expressions: [{ name: 'x', expr: parseFormula('[nope] + 1') }] };
    assert.deepEqual(prepareSpec(spec, SCHEMA).problems, ['Custom column "x" uses unknown column [nope]']);
  });

  test('operators depend on the column type', () => {
    assert.ok(operatorsFor('string').some((o) => o.op === 'contains'));
    assert.ok(!operatorsFor('number').some((o) => o.op === 'contains'));
    assert.equal(operatorsFor('datetime')[0].op, 'last');
    assert.equal(valueComplete('pair', ['1', '']), false);
    assert.equal(valueComplete('list', ['a']), true);
  });
});

describe('formatting', () => {
  test('numbers, dates, booleans', () => {
    assert.equal(formatValue(null, 'number'), '');
    assert.equal(formatValue(2024, 'number', 'dimension'), '2024');
    assert.equal(formatValue(1234.5, 'number', 'measure').replace(/\s|,/g, ''), '1234.5');
    assert.equal(formatValue('2026-01-05T10:00:00', 'datetime'), '2026-01-05 10:00:00');
    assert.equal(formatValue('2026-01-05T00:00:00', 'datetime'), '2026-01-05');
    assert.equal(formatValue(1, 'boolean'), 'true');
  });

  test('messy dates (DataDesk normaliser)', () => {
    assert.equal(normalizeDate('31.01.2026'), '2026-01-31');
    assert.equal(normalizeDate('5.3.2026 7:05'), '2026-03-05 07:05:00');
    assert.equal(normalizeDate('2026-01-31T10:20:30.123Z'), '2026-01-31 10:20:30');
    assert.equal(normalizeDate(1767225600), '2026-01-01 00:00:00');
    assert.equal(normalizeDate('1767225600000'), '2026-01-01 00:00:00');
    assert.equal(normalizeDate(42), null);
    assert.equal(normalizeDate('31.13.2026'), null);
    assert.equal(normalizeDate('hello'), null);
    assert.equal(formatValue('31.01.2026', 'string', 'dimension', { smartDates: true }), '2026-01-31');
  });
});
