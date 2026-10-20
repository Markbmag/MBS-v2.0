// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ColumnType } from '../src/api.ts';
import {
  bindSpec, effectiveValue, paramName, specParams, sqlValues, syncBuilderParams, syncSqlParams, valuesFromSearch, valuesToSearch,
} from '../src/library/params.ts';
import type { ParameterDef } from '../src/library/params.ts';
import { flattenTree } from '../src/library/tree.ts';
import type { QuerySpec } from '../src/query/types.ts';

const SPEC: QuerySpec = {
  version: 1,
  connection: 'shop',
  source: { table: 'orders' },
  filters: {
    op: 'and',
    rules: [
      { ref: 'orders.status', op: '=', param: 'status' },
      { ref: 'orders.total', op: '>', value: 10 },
      { op: 'or', rules: [{ ref: 'orders.paid_on', op: 'between', param: 'period' }, { ref: 'orders.region', op: 'in', param: 'region' }] },
    ],
  },
};
const TYPES: Record<string, ColumnType> = { 'orders.status': 'string', 'orders.paid_on': 'date', 'orders.region': 'string', 'orders.total': 'number' };
const typeOf = (ref: string) => TYPES[ref] ?? 'unknown';

describe('builder parameters', () => {
  test('finds every asked filter, nested ones too', () => {
    assert.deepEqual(specParams(SPEC).map((u) => [u.name, u.op]), [['status', '='], ['period', 'between'], ['region', 'in']]);
  });

  test('declarations follow the filters and their column types', () => {
    const defs = syncBuilderParams(SPEC, [{ name: 'status', label: 'Order status', type: 'number', default: 'paid' }, { name: 'unused', type: 'text' }], typeOf);
    assert.deepEqual(defs.map((d) => [d.name, d.type, d.label]), [['status', 'text', 'Order status'], ['period', 'date', 'Period'], ['region', 'text', 'Region']]);
    assert.equal(defs[0].default, 'paid'); // kept from the saved declaration
  });

  test('values replace the condition; missing ones drop it', () => {
    const defs = syncBuilderParams(SPEC, [], typeOf);
    const { value, missing } = bindSpec(SPEC, defs, { status: 'paid', region: 'EU, US' });
    assert.deepEqual(missing, []);
    assert.deepEqual(value.filters, {
      op: 'and',
      rules: [
        { ref: 'orders.status', op: '=', value: 'paid' },
        { ref: 'orders.total', op: '>', value: 10 },
        { op: 'or', rules: [{ ref: 'orders.region', op: 'in', value: ['EU', 'US'] }] },
      ],
    });
  });

  test('nothing given: only fixed filters remain; required ones are reported', () => {
    const defs: ParameterDef[] = syncBuilderParams(SPEC, [{ name: 'status', type: 'text', required: true, label: 'Status' }], typeOf);
    const { value, missing } = bindSpec(SPEC, defs, {});
    assert.deepEqual(value.filters, { op: 'and', rules: [{ ref: 'orders.total', op: '>', value: 10 }] });
    assert.deepEqual(missing, ['Status']);
    const onlyAsked: QuerySpec = { ...SPEC, filters: { op: 'and', rules: [{ ref: 'orders.status', op: '=', param: 'status' }] } };
    assert.equal(bindSpec(onlyAsked, [], {}).value.filters, undefined);
  });

  test('defaults and pairs', () => {
    const period: ParameterDef = { name: 'period', type: 'date', default: '2026-01-01, 2026-01-31' };
    assert.deepEqual(effectiveValue(period, {}, 'pair'), ['2026-01-01', '2026-01-31']);
    assert.equal(effectiveValue(period, { period: ['2026-02-01', ''] }, 'pair'), null);
    assert.deepEqual(effectiveValue(period, { period: ['2026-02-01', '2026-02-28'] }, 'pair'), ['2026-02-01', '2026-02-28']);
    assert.equal(effectiveValue({ name: 'n', type: 'number' }, { n: ' 42 ' }), 42);
  });

  test('parameter names come from the column and stay unique', () => {
    assert.equal(paramName('orders.created_at', []), 'created_at');
    assert.equal(paramName('orders.created_at', ['created_at']), 'created_at_2');
    assert.equal(paramName('t.2nd value', []), 'p_2nd_value');
  });
});

describe('SQL parameters', () => {
  test('one declaration per {{name}}, in order, text by default', () => {
    const defs = syncSqlParams(['region', 'since'], [{ name: 'since', type: 'date', default: '2026-01-01' }]);
    assert.deepEqual(defs.map((d) => [d.name, d.type]), [['region', 'text'], ['since', 'date']]);
    const { value, missing } = sqlValues(defs, { region: 'EU' });
    assert.deepEqual(value, { region: 'EU', since: '2026-01-01' });
    assert.deepEqual(missing, []);
    assert.deepEqual(sqlValues(defs, {}).missing, ['Region']);
  });
});

describe('values in the URL', () => {
  test('round trip, other query keys kept', () => {
    const search = valuesToSearch({ region: ['EU', 'US'], status: 'paid', empty: '' }, new URLSearchParams('tab=1'));
    assert.equal(search.toString(), 'tab=1&p.region=EU&p.region=US&p.status=paid');
    assert.deepEqual(valuesFromSearch(search), { region: ['EU', 'US'], status: 'paid' });
  });
});

describe('collection tree', () => {
  test('depth-first order; a hidden parent puts the child at the top', () => {
    const nodes = flattenTree([
      { id: 1, parent_id: null, name: 'A' },
      { id: 2, parent_id: 1, name: 'A1' },
      { id: 3, parent_id: null, name: 'B' },
      { id: 4, parent_id: 2, name: 'A1a' },
      { id: 5, parent_id: 99, name: 'Shared alone' },
    ]);
    assert.deepEqual(nodes.map((n) => [n.name, n.depth]), [['A', 0], ['A1', 1], ['A1a', 2], ['B', 0], ['Shared alone', 0]]);
  });
});
