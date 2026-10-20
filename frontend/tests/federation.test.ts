// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { JoinStats } from '../src/api.ts';
import {
  aliasFor, federatedParams, fromPostQuery, matchSummary, postQuery, prepareFederated, resultSchema, sqlParamNames, suggestKey,
  syncJoins,
} from '../src/federation/logic.ts';
import type { FederatedSpec } from '../src/federation/types.ts';

const MES = { alias: 'mes', type: 'sql' as const, connection: 'mes', sql: 'SELECT vin, plant FROM builds WHERE day >= {{since}}' };
const LES = { alias: 'les', type: 'dataset' as const, dataset_id: 3 };
const COLUMNS = [
  { name: 'vin', type: 'string' as const },
  { name: 'plant', type: 'string' as const },
  { name: 'shipped', type: 'date' as const },
];

describe('source names', () => {
  test('are slugs, unique and never reserved', () => {
    assert.equal(aliasFor('MES orders 2026', []), 'mes_orders_2026');
    assert.equal(aliasFor('MES orders 2026', ['mes_orders_2026']), 'mes_orders_2026_2');
    assert.equal(aliasFor('2026 plan', []), 's_2026_plan');
    assert.equal(aliasFor('Result', []), 'result_2');
    assert.equal(aliasFor('???', []), 'source');
  });
});

describe('joins', () => {
  test('one join per source after the first, keys to removed sources dropped', () => {
    const spec: FederatedSpec = {
      version: 1,
      sources: [MES, LES],
      joins: [
        { source: 'les', type: 'inner', on: [{ left: 'mes.vin', right: 'les.vin' }, { left: 'gone.x', right: 'les.y' }] },
        { source: 'gone', type: 'left', on: [] },
      ],
    };
    assert.deepEqual(syncJoins(spec), [{ source: 'les', type: 'inner', on: [{ left: 'mes.vin', right: 'les.vin' }] }]);
    assert.deepEqual(syncJoins({ ...spec, joins: [] }), [{ source: 'les', type: 'left', on: [{ left: '', right: '', match: 'auto' }] }]);
  });

  test('suggests a key: same name, key-like names first, foreign-key style names', () => {
    const left = { mes: [{ name: 'id', type: 'number' as const }, { name: 'VIN', type: 'string' as const }] };
    assert.deepEqual(suggestKey(left, [{ name: 'id', type: 'number' }, { name: 'vin', type: 'string' }], 'les'), {
      left: 'mes.VIN', right: 'les.vin', match: 'auto',
    });
    const orders = { orders: [{ name: 'customer_id', type: 'number' as const }] };
    assert.deepEqual(suggestKey(orders, [{ name: 'id', type: 'number' }], 'customers')?.left, 'orders.customer_id');
    assert.equal(suggestKey(left, [{ name: 'other', type: 'string' }], 'les'), null);
  });
});

describe('the spec that is sent', () => {
  test('incomplete keys and sources are problems; the post step is cleaned', () => {
    const draft: FederatedSpec = {
      version: 1,
      sources: [MES, { alias: 'x', type: 'dataset' }],
      joins: [{ source: 'x', type: 'left', on: [{ left: 'mes.vin', right: '' }] }],
      post: { filters: { op: 'and', rules: [{ ref: 'result.plant', op: '=', value: '' }] }, aggregations: [{ fn: 'count' }] },
    };
    const { spec, problems } = prepareFederated(draft, COLUMNS);
    assert.deepEqual(problems, ['x: Pick an uploaded file', 'Pick the key columns to join x']);
    assert.deepEqual(spec.post, { aggregations: [{ fn: 'count', alias: 'count' }] }); // the half-typed filter is left out
    assert.deepEqual(spec.result_columns, COLUMNS);
  });

  test('sql mode sends the SQL and no joins', () => {
    const { spec, problems } = prepareFederated({ version: 1, sources: [MES, LES], mode: 'sql', sql: 'SELECT * FROM mes' }, []);
    assert.deepEqual(problems, []);
    assert.equal(spec.joins, undefined);
    assert.equal(spec.sql, 'SELECT * FROM mes');
  });

  test('post step <-> builder question over "result"', () => {
    const q = postQuery({ order: [{ ref: 'vin', dir: 'asc' }] });
    assert.deepEqual(q.source, { table: 'result' });
    assert.deepEqual(fromPostQuery({ ...q, filters: null, breakouts: [] }), { order: [{ ref: 'vin', dir: 'asc' }] });
    assert.equal(fromPostQuery(postQuery(null)), null);
    assert.deepEqual(resultSchema(COLUMNS).tables[0].columns.map((c) => c.name), ['vin', 'plant', 'shipped']);
  });
});

describe('parameters', () => {
  test('asked filters, SQL {{names}} and the parameters of source questions', () => {
    const spec: FederatedSpec = {
      version: 1,
      sources: [MES, LES],
      mode: 'join',
      post: { filters: { op: 'and', rules: [{ ref: 'result.shipped', op: 'between', param: 'period' }] } },
    };
    assert.deepEqual(sqlParamNames({ ...spec, mode: 'sql', sql: 'SELECT * FROM mes WHERE plant = {{plant}}' }), ['since', 'plant']);
    const defs = federatedParams(spec, [{ name: 'since', label: 'Built since', type: 'date' }], () => 'date', [
      [{ name: 'status', type: 'text', default: 'paid' }],
    ]);
    assert.deepEqual(defs.map((d) => [d.name, d.type, d.label]), [
      ['period', 'date', 'Period'],
      ['since', 'date', 'Built since'],
      ['status', 'text', undefined],
    ]);
  });
});

describe('match report', () => {
  const stats: JoinStats = {
    source: 'les', type: 'inner', keys: ['mes.vin = les.vin'], match: ['text'],
    left_rows: 100, right_rows: 90, left_unmatched_rows: 37, right_unmatched_rows: 5, left_null_keys: 2, right_null_keys: 0,
    left_keys: 100, right_keys: 80, left_unmatched_keys: 37, right_unmatched_keys: 5, left_repeated_keys: 0, right_repeated_keys: 4,
    left_samples: ['V1'], right_samples: [],
  };
  test('says how many keys have no partner and what to watch out for', () => {
    const s = matchSummary(stats, 'MES', 'LES');
    assert.equal(s.leftPct, 37);
    assert.equal(s.rightPct, 6.3);
    assert.equal(s.lines[0], '37 % of MES keys have no match in LES (37 of 100)');
    assert.deepEqual(s.warnings, [
      '4 keys repeat in LES: matching MES rows appear once per match (totals can grow)',
      '2 MES rows have an empty key and cannot match',
      'Only matching rows are kept: 42 rows were left out',
    ]);
  });
});
