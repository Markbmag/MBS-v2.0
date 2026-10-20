/**
 * Helpers around the question being built: which columns can be picked, what the
 * output columns will be called, and the clean spec that is sent to the server.
 * Pure functions, unit-tested in tests/query.test.ts.
 */
import type { ColumnType, Relationship, SchemaTable } from '../api';
import { formulaRefs } from './expression.ts';
import { bestPath } from './joins.ts';
import { operatorInfo, valueComplete } from './operators.ts';
import type { Aggregation, Breakout, Expr, FilterGroup, FilterNode, QuerySpec } from './types.ts';
import { isGroup } from './types.ts';
import { t } from '../i18n/index.ts';

export interface SchemaInfo {
  tables: SchemaTable[];
  relationships: Relationship[];
}

export interface ColumnOption {
  ref: string;          // what goes into the spec: "alias.column" or a custom column name
  label: string;        // "Orders → Total"
  table: string;        // alias (or "Custom")
  column: string;
  type: ColumnType;
}

export interface QueryTable {
  alias: string;
  table: string;
  via?: boolean; // added automatically by a foreign-key join
}

export const AGGREGATES: { fn: Aggregation['fn']; label: string; needsColumn: boolean }[] = [
  { fn: 'count', label: t('Count of rows'), needsColumn: false },
  { fn: 'count_distinct', label: t('Number of distinct'), needsColumn: true },
  { fn: 'sum', label: t('Sum of'), needsColumn: true },
  { fn: 'avg', label: t('Average of'), needsColumn: true },
  { fn: 'min', label: t('Minimum of'), needsColumn: true },
  { fn: 'max', label: t('Maximum of'), needsColumn: true },
];

export const BUCKETS: { value: NonNullable<Breakout['bucket']>; label: string }[] = [
  { value: 'minute', label: t('Minute') },
  { value: 'hour', label: t('Hour') },
  { value: 'day', label: t('Day') },
  { value: 'week', label: t('Week') },
  { value: 'month', label: t('Month') },
  { value: 'quarter', label: t('Quarter') },
  { value: 'year', label: t('Year') },
];

export function newSpec(connection: string, table: string): QuerySpec {
  return { version: 1, connection, source: { table } };
}

export function isSummarised(spec: QuerySpec): boolean {
  return (spec.aggregations?.length ?? 0) > 0 || (spec.breakouts?.length ?? 0) > 0;
}

export const humanize = (name: string): string =>
  name
    .replace(/[_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());

/** Tables in the question, including the ones a foreign-key join passes through. */
export function queryTables(spec: QuerySpec, schema: SchemaInfo): QueryTable[] {
  const out: QueryTable[] = [{ alias: spec.source.alias || spec.source.table, table: spec.source.table }];
  for (const join of spec.joins ?? []) {
    if (!join.table) continue;
    if (join.on && join.on.length > 0) {
      out.push({ alias: join.alias || join.table, table: join.table });
      continue;
    }
    const best = bestPath(schema.relationships, out.map((t) => t.table), join.table);
    if (!best) {
      out.push({ alias: join.alias || join.table, table: join.table }); // the server will explain
      continue;
    }
    best.path.forEach((step, i) => {
      const last = i === best.path.length - 1;
      if (last) out.push({ alias: join.alias || join.table, table: join.table });
      else if (!out.some((t) => t.table === step.table)) out.push({ alias: step.table, table: step.table, via: true });
    });
  }
  return out;
}

/** Every column that can be picked (filters, summaries, fields), plus custom columns. */
export function columnOptions(spec: QuerySpec, schema: SchemaInfo, upToCustom?: number): ColumnOption[] {
  const byName = new Map(schema.tables.map((t) => [t.name, t]));
  const tables = queryTables(spec, schema);
  const multi = tables.length > 1;
  const out: ColumnOption[] = [];
  for (const qt of tables) {
    const table = byName.get(qt.table);
    if (!table) continue;
    for (const col of table.columns) {
      if (col.type === 'binary' || col.hidden) continue; // hidden in the data model
      const name = col.display_name || humanize(col.name);
      out.push({
        ref: `${qt.alias}.${col.name}`,
        label: multi ? `${humanize(qt.alias)} → ${name}` : name,
        table: qt.alias,
        column: col.name,
        type: col.type,
      });
    }
  }
  const customs = (spec.expressions ?? []).slice(0, upToCustom);
  for (const custom of customs) {
    out.push({
      ref: custom.name,
      label: custom.name,
      table: t('Custom'),
      column: custom.name,
      type: inferType(custom.expr, (ref) => out.find((o) => o.ref === ref || o.column === ref)?.type ?? 'unknown'),
    });
  }
  return out;
}

export function inferType(expr: Expr, typeOf: (ref: string) => ColumnType): ColumnType {
  if ('ref' in expr) return typeOf(expr.ref);
  if ('value' in expr) {
    const v = expr.value;
    return v === null ? 'unknown' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string';
  }
  if ('op' in expr) return 'number';
  if ('fn' in expr) {
    if (['lower', 'upper', 'trim', 'concat'].includes(expr.fn)) return 'string';
    if (['length', 'abs', 'round'].includes(expr.fn)) return 'number';
    return expr.args.map((a) => inferType(a, typeOf)).find((t) => t !== 'unknown') ?? 'unknown';
  }
  const thens = expr.case.map((b) => inferType(b.then, typeOf));
  return thens.find((t) => t !== 'unknown') ?? (expr.else ? inferType(expr.else, typeOf) : 'unknown');
}

// ---------------------------------------------------------------- output names (mirror the backend)

const lastPart = (ref: string) => ref.split('.').pop() ?? ref;

export function breakoutName(b: Breakout): string {
  if (b.alias) return b.alias;
  const base = lastPart(b.ref);
  if (b.bucket) return `${base}_${b.bucket}`;
  if (b.bin_width) return `${base}_bin`;
  return base;
}

export function aggregationName(a: Aggregation): string {
  if (a.alias) return a.alias;
  if (a.fn === 'metric') return `metric_${a.metric ?? ''}`;
  if (!a.ref) return 'count';
  const base = lastPart(a.ref);
  if (a.fn === 'count_distinct') return `distinct_${base}`;
  return `${a.fn}_${base}`;
}

function unique(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  let n = 2;
  while (taken.includes(`${name}_${n}`)) n++;
  return `${name}_${n}`;
}

export interface OutputColumn {
  name: string;
  type: ColumnType;
  kind: 'breakout' | 'aggregation' | 'field';
}

/** Names and types of the result columns of a summarised question (sorting, having). */
export function summaryOutputs(spec: QuerySpec, options: ColumnOption[]): OutputColumn[] {
  const taken: string[] = [];
  const out: OutputColumn[] = [];
  const typeOf = (ref?: string) => options.find((o) => o.ref === ref)?.type ?? 'unknown';
  for (const b of spec.breakouts ?? []) {
    const name = unique(breakoutName(b), taken);
    taken.push(name);
    const type: ColumnType = b.bucket ? (['minute', 'hour'].includes(b.bucket) ? 'datetime' : 'date') : b.bin_width ? 'number' : typeOf(b.ref);
    out.push({ name, type, kind: 'breakout' });
  }
  for (const a of spec.aggregations ?? []) {
    const name = unique(aggregationName(a), taken);
    taken.push(name);
    const type: ColumnType = ['min', 'max'].includes(a.fn) ? typeOf(a.ref) : 'number';
    out.push({ name, type, kind: 'aggregation' });
  }
  return out;
}

// ---------------------------------------------------------------- the spec that is sent

export interface Prepared {
  spec: QuerySpec;
  problems: string[]; // shown instead of running
}

function cleanGroup(group: FilterGroup | null | undefined, typeOf: (ref: string) => ColumnType): FilterGroup | null {
  if (!group) return null;
  const rules: FilterNode[] = [];
  for (const rule of group.rules) {
    if (isGroup(rule)) {
      const inner = cleanGroup(rule, typeOf);
      if (inner && inner.rules.length > 0) rules.push(inner);
      continue;
    }
    if (!rule.ref) continue;
    if (rule.param) {
      rules.push({ ref: rule.ref, op: rule.op, param: rule.param }); // the value is filled in when it runs
      continue;
    }
    const info = operatorInfo(typeOf(rule.ref), rule.op);
    if (!valueComplete(info.value, rule.value)) continue; // half-typed filters are ignored, not errors
    rules.push(info.value === 'none' ? { ref: rule.ref, op: rule.op } : rule);
  }
  return rules.length > 0 ? { op: group.op, rules } : null;
}

/**
 * The spec as it is sent: incomplete filter rows dropped, summaries named
 * explicitly (so sort and "having" refer to stable names), empty parts removed.
 */
export function prepareSpec(spec: QuerySpec, schema: SchemaInfo): Prepared {
  const problems: string[] = [];
  const options = columnOptions(spec, schema);
  const typeOf = (ref: string) => options.find((o) => o.ref === ref)?.type ?? 'unknown';
  const known = new Set(options.map((o) => o.ref));

  for (const custom of spec.expressions ?? []) {
    for (const ref of formulaRefs(custom.expr)) {
      if (!known.has(ref) && !options.some((o) => o.column === ref)) problems.push(t('Custom column "{name}" uses unknown column [{ref}]', { name: custom.name, ref }));
    }
  }

  // Summary rows still missing their column are left out until they are complete.
  const usedBreakouts = (spec.breakouts ?? []).filter((b) => b.ref);
  const usedAggregations = (spec.aggregations ?? []).filter((a) => a.fn === 'count' || a.fn === 'metric' || a.ref);
  const summarised = usedBreakouts.length + usedAggregations.length > 0;
  const outputs = summaryOutputs({ ...spec, breakouts: usedBreakouts, aggregations: usedAggregations }, options);
  let i = 0;
  const breakouts = usedBreakouts.map((b) => ({ ...b, alias: outputs[i++].name }));
  const aggregations = usedAggregations.map((a) => ({ ...a, alias: outputs[i++].name }));
  const outputType = (ref: string) => outputs.find((o) => o.name === ref)?.type ?? typeOf(ref);

  const out: QuerySpec = { version: 1, connection: spec.connection, source: spec.source };
  if (spec.joins?.length) out.joins = spec.joins.filter((j) => j.table).map((j) => (j.on?.length ? j : { table: j.table, type: j.type, ...(j.alias ? { alias: j.alias } : {}) }));
  if (spec.expressions?.length) out.expressions = spec.expressions;
  if (summarised) {
    if (breakouts.length) out.breakouts = breakouts;
    if (aggregations.length) out.aggregations = aggregations;
    const having = cleanGroup(spec.having, outputType);
    if (having) out.having = having;
  } else if (spec.fields?.length) {
    out.fields = spec.fields;
  }
  if (spec.transforms?.length) out.transforms = spec.transforms;
  const filters = cleanGroup(spec.filters, typeOf);
  if (filters) out.filters = filters;
  const validOrder = (spec.order ?? []).filter((o) => (summarised ? outputs.some((x) => x.name === o.ref) : known.has(o.ref)));
  if (validOrder.length) out.order = validOrder;
  if (spec.limit) out.limit = spec.limit;
  return { spec: out, problems };
}
