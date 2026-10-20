/**
 * Multi-source questions: the draft being edited, the clean spec that is sent, the
 * parameters it asks for and the wording of the match report.
 * Pure functions, unit-tested in tests/federation.test.ts.
 *
 * The step after the join (filter, summarise, sort) is an ordinary builder question
 * over one table, "result": the builder's own helpers and editors work on it.
 */
import type { ColumnType, JoinStats } from '../api.ts';
import { locale, t, tn } from '../i18n/index.ts';
import type { ParameterDef } from '../library/params.ts';
import { syncBuilderParams, syncSqlParams } from '../library/params.ts';
import { findParams } from '../query/dialect.ts';
import { prepareSpec } from '../query/draft.ts';
import type { SchemaInfo } from '../query/draft.ts';
import type { QuerySpec } from '../query/types.ts';
import type { ColumnHint, FederatedSpec, Join, KeyPair, PostSpec, Source } from './types.ts';

export const RESULT = 'result';
export const POST_CONNECTION = '__federated__';
export const MAX_SOURCES = 6;
const RESERVED = new Set([RESULT, 'main', 'temp', 'information_schema', 'pg_catalog', 'system']);

export function emptySpec(): FederatedSpec {
  return { version: 1, sources: [], mode: 'join', joins: [] };
}

/** A source name: lower case letters, digits and _, unique, not reserved ("MES orders" -> mes_orders). */
export function aliasFor(label: string, taken: string[]): string {
  let base = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  if (!base) base = 'source';
  if (/^\d/.test(base)) base = `s_${base}`.slice(0, 28);
  let name = base;
  let n = 2;
  while (taken.includes(name) || RESERVED.has(name)) name = `${base}_${n++}`;
  return name;
}

// ---------------------------------------------------------------- the step after the join

export function postQuery(post: PostSpec | null | undefined): QuerySpec {
  return { version: 1, connection: POST_CONNECTION, source: { table: RESULT }, ...(post ?? {}) } as QuerySpec;
}

const NOT_POST = new Set(['version', 'connection', 'source', 'joins', 'limit']);

export function fromPostQuery(q: QuerySpec): PostSpec | null {
  const out: PostSpec = {};
  for (const [k, v] of Object.entries(q)) {
    if (NOT_POST.has(k)) continue;
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** The combined rows as a one-table schema, for the builder's editors. */
export function resultSchema(columns: ColumnHint[]): SchemaInfo {
  return {
    tables: [{
      name: RESULT,
      primary_key: [],
      columns: columns.map((c) => ({ name: c.name, type: c.type, db_type: '', nullable: true, primary_key: false, foreign_key: null })),
    }],
    relationships: [],
  };
}

// ---------------------------------------------------------------- joins

/** Sources available on the left of join number `index` (the first source and those joined before). */
export function joinedBefore(spec: FederatedSpec, alias: string): string[] {
  const order = spec.sources.map((s) => s.alias);
  return order.slice(0, Math.max(0, order.indexOf(alias)));
}

/** One join per source after the first, in source order; keys that point at a removed source are dropped. */
export function syncJoins(spec: FederatedSpec): Join[] {
  const out: Join[] = [];
  for (const s of spec.sources.slice(1)) {
    const before = joinedBefore(spec, s.alias);
    const existing = spec.joins?.find((j) => j.source === s.alias);
    const on = (existing?.on ?? []).filter((k) => {
      const [l] = k.left.split('.');
      const [r] = k.right.split('.');
      return (!k.left || before.includes(l)) && (!k.right || r === s.alias);
    });
    out.push({ source: s.alias, type: existing?.type ?? 'left', on: on.length ? on : [{ left: '', right: '', match: 'auto' }] });
  }
  return out;
}

const KEY_HINT = /(^|_)(vin|id|key|code|no|number|nr)$/i;

/** A likely key pair: the same column name on both sides, key-like names first ("vin", "*_id"). */
export function suggestKey(left: Record<string, ColumnHint[]>, right: ColumnHint[], rightAlias: string): KeyPair | null {
  const candidates: { pair: KeyPair; score: number }[] = [];
  for (const [alias, cols] of Object.entries(left)) {
    for (const lc of cols) {
      for (const rc of right) {
        const same = lc.name.toLowerCase() === rc.name.toLowerCase();
        // orders.customer_id = customers.id
        const fk = rc.name.toLowerCase() === 'id' && [`${rightAlias}_id`, `${rightAlias.replace(/s$/, '')}_id`].includes(lc.name.toLowerCase());
        if (!same && !fk) continue;
        const score = (fk ? 3 : 0) + (KEY_HINT.test(lc.name) ? 2 : 0) + (lc.type === rc.type ? 1 : 0) - (lc.name.toLowerCase() === 'id' ? 2 : 0);
        candidates.push({ pair: { left: `${alias}.${lc.name}`, right: `${rightAlias}.${rc.name}`, match: 'auto' }, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.pair ?? null;
}

// ---------------------------------------------------------------- the spec that is sent

export interface PreparedFederated {
  spec: FederatedSpec;
  problems: string[];
}

export function sourceProblems(s: Source): string | null {
  if (s.type === 'question' && !s.question_id) return t('Pick a saved question');
  if (s.type === 'dataset' && !s.dataset_id) return t('Pick an uploaded file');
  if (s.type === 'sql' && (!s.connection || !s.sql?.trim())) return t('Write the SQL');
  if (s.type === 'builder' && !s.spec?.source?.table) return t('Pick a table');
  return null;
}

/** The spec as it is sent: complete key pairs only, the post step cleaned like a builder question. */
export function prepareFederated(draft: FederatedSpec, columns: ColumnHint[]): PreparedFederated {
  const problems: string[] = [];
  if (draft.sources.length === 0) problems.push(t('Add a source'));
  for (const s of draft.sources) {
    const p = sourceProblems(s);
    if (p) problems.push(`${s.label || s.alias}: ${p}`);
  }
  const spec: FederatedSpec = { version: 1, sources: draft.sources.map((s) => ({ ...s })), mode: draft.mode ?? 'join' };
  if (spec.mode === 'sql') {
    spec.sql = draft.sql ?? '';
    if (!spec.sql.trim()) problems.push(t('Write the SQL that combines the sources'));
  } else {
    spec.joins = syncJoins(draft).map((j) => ({ ...j, on: j.on.filter((k) => k.left && k.right) }));
    for (const j of spec.joins) {
      if (j.on.length === 0) {
        const label = draft.sources.find((s) => s.alias === j.source)?.label || j.source;
        problems.push(t('Pick the key columns to join {label}', { label }));
      }
    }
  }
  if (draft.post) {
    spec.post = columns.length ? fromPostQuery(prepareSpec(postQuery(draft.post), resultSchema(columns)).spec) : draft.post;
    if (!spec.post) delete spec.post;
  }
  if (draft.limit) spec.limit = draft.limit;
  if (draft.transforms?.length) spec.transforms = draft.transforms;
  if (columns.length) spec.result_columns = columns;
  return { spec, problems };
}

// ---------------------------------------------------------------- parameters

/** {{names}} in the SQL of the sources and of the combining SQL. */
export function sqlParamNames(spec: FederatedSpec): string[] {
  const out: string[] = [];
  const add = (sql?: string | null) => {
    for (const n of findParams(sql ?? '')) if (!out.includes(n)) out.push(n);
  };
  for (const s of spec.sources) if (s.type === 'sql') add(s.sql);
  if (spec.mode === 'sql') add(spec.sql);
  return out;
}

/**
 * The parameters of a multi-source question: filters asked for after the join,
 * {{names}} in SQL, and the parameters of saved questions used as sources (a value
 * is passed on to every source question with a parameter of that name).
 */
export function federatedParams(
  spec: FederatedSpec,
  defs: ParameterDef[],
  typeOf: (ref: string) => ColumnType,
  sourceParams: ParameterDef[][],
): ParameterDef[] {
  const out: ParameterDef[] = [];
  const add = (d: ParameterDef) => {
    if (!out.some((x) => x.name === d.name)) out.push(d);
  };
  syncBuilderParams(postQuery(spec.post), defs, typeOf).forEach(add);
  syncSqlParams(sqlParamNames(spec), defs).forEach(add);
  for (const list of sourceParams) for (const p of list) add(defs.find((d) => d.name === p.name) ?? { ...p });
  return out;
}

// ---------------------------------------------------------------- the match report

export interface MatchSummary {
  leftPct: number;   // share of distinct left keys without a partner
  rightPct: number;
  lines: string[];
  warnings: string[];
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);


export function matchSummary(j: JoinStats, left: string, right: string): MatchSummary {
  const leftPct = pct(j.left_unmatched_keys, j.left_keys);
  const rightPct = pct(j.right_unmatched_keys, j.right_keys);
  const noMatch = (p: number, a: string, b: string, part: number, whole: number) =>
    t('{pct} % of {a} keys have no match in {b} ({part} of {whole})', { pct: p, a, b, part: part.toLocaleString(locale()), whole: whole.toLocaleString(locale()) });
  const lines = [
    noMatch(leftPct, left, right, j.left_unmatched_keys, j.left_keys),
    noMatch(rightPct, right, left, j.right_unmatched_keys, j.right_keys),
  ];
  const warnings: string[] = [];
  if (j.right_repeated_keys > 0)
    warnings.push(tn(j.right_repeated_keys, '{n} key repeats in {right}: matching {left} rows appear once per match (totals can grow)', '{n} keys repeat in {right}: matching {left} rows appear once per match (totals can grow)', { left, right }));
  if (j.left_repeated_keys > 0 && j.right_repeated_keys > 0)
    warnings.push(t('Keys repeat on both sides: each repeated pair multiplies rows'));
  const empty = (n: number, side: string) =>
    tn(n, '{n} {side} row has an empty key and cannot match', '{n} {side} rows have an empty key and cannot match', { side });
  if (j.left_null_keys > 0) warnings.push(empty(j.left_null_keys, left));
  if (j.right_null_keys > 0) warnings.push(empty(j.right_null_keys, right));
  if (j.type === 'inner' && (j.left_unmatched_rows > 0 || j.right_unmatched_rows > 0))
    warnings.push(tn(j.left_unmatched_rows + j.right_unmatched_rows, 'Only matching rows are kept: {n} row was left out', 'Only matching rows are kept: {n} rows were left out'));
  return { leftPct, rightPct, lines, warnings };
}
