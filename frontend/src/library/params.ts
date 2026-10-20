/**
 * Question parameters (mirrors backend/app/content/params.py).
 *
 * SQL questions use {{name}}; builder questions mark a filter condition with
 * `param`. While editing, the values typed into the parameter bar are filled in
 * here before the question runs; a builder condition without a value is left out.
 * Pure functions, unit-tested in tests/library.test.ts.
 */
import type { ColumnType } from '../api';
import type { Condition, FilterGroup, FilterNode, FilterOp, QuerySpec } from '../query/types.ts';
import { isGroup } from '../query/types.ts';

export type ParamType = 'text' | 'number' | 'date';

export interface ParameterDef {
  name: string;
  label?: string | null;
  type: ParamType;
  default?: unknown;
  required?: boolean;
}

/** What the user typed: one value, or several (in-lists, between). */
export type ParamValue = string | string[];
export type ParamValues = Record<string, ParamValue>;

/** How many values a parameter takes, from the filter operator it feeds. */
export type ParamShape = 'single' | 'list' | 'pair';

export const PARAM_OPS: FilterOp[] = ['=', '!=', '>', '>=', '<', '<=', 'between', 'in', 'not_in', 'contains', 'not_contains', 'starts_with', 'ends_with'];

export const shapeOf = (op: FilterOp): ParamShape => (op === 'between' ? 'pair' : op === 'in' || op === 'not_in' ? 'list' : 'single');

export const paramTypeFor = (type: ColumnType): ParamType => (type === 'number' ? 'number' : type === 'date' || type === 'datetime' ? 'date' : 'text');

export interface ParamUse {
  name: string;
  op: FilterOp;
  ref?: string;
}

function walk(group: FilterGroup | null | undefined, out: ParamUse[]): void {
  if (!group) return;
  for (const rule of group.rules) {
    if (isGroup(rule)) walk(rule, out);
    else if (rule.param) out.push({ name: rule.param, op: rule.op, ref: rule.ref });
  }
}

/** Every condition that takes its value from a parameter. */
export function specParams(spec: QuerySpec): ParamUse[] {
  const out: ParamUse[] = [];
  walk(spec.filters, out);
  walk(spec.having, out);
  return out;
}

/** A parameter name for a column ("orders.created_at" -> "created_at", then created_at_2 ...). */
export function paramName(ref: string, taken: string[]): string {
  const base = (ref.split('.').pop() ?? 'value').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d)/, 'p_').slice(0, 60) || 'value';
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

const humanLabel = (name: string) => name.replace(/_+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Declarations for a builder question: one per used parameter, typed by its column. */
export function syncBuilderParams(spec: QuerySpec, defs: ParameterDef[], typeOf: (ref: string) => ColumnType): ParameterDef[] {
  const out: ParameterDef[] = [];
  for (const use of specParams(spec)) {
    if (out.some((d) => d.name === use.name)) continue;
    const existing = defs.find((d) => d.name === use.name);
    const type = use.ref ? paramTypeFor(typeOf(use.ref)) : existing?.type ?? 'text';
    out.push(existing ? { ...existing, type } : { name: use.name, label: humanLabel(use.name), type, default: null, required: false });
  }
  return out;
}

/** Declarations for a SQL question: one per {{name}}, in SQL order; undeclared ones are text. */
export function syncSqlParams(names: string[], defs: ParameterDef[]): ParameterDef[] {
  return names.map((name) => defs.find((d) => d.name === name) ?? { name, label: humanLabel(name), type: 'text', default: null, required: false });
}

function blank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.every(blank));
}

function scalar(def: ParameterDef, raw: unknown): string | number {
  if (def.type === 'number' && typeof raw !== 'number') {
    const n = Number(String(raw).trim());
    return Number.isNaN(n) ? String(raw) : n; // the server explains what is wrong
  }
  return typeof raw === 'number' ? raw : String(raw).trim();
}

/** The value a parameter runs with: what was typed, else its default, else null. */
export function effectiveValue(def: ParameterDef, values: ParamValues, shape: ParamShape = 'single'): unknown {
  let raw: unknown = values[def.name];
  if (blank(raw)) raw = def.default;
  if (blank(raw)) return null;
  if (shape === 'single') return scalar(def, Array.isArray(raw) ? raw[0] : raw);
  const list = Array.isArray(raw)
    ? raw
    : String(raw)
        .split(',')
        .map((s) => s.trim());
  if (shape === 'pair') return list.length === 2 && !list.some(blank) ? list.map((v) => scalar(def, v)) : null;
  const items = list.filter((v) => !blank(v)).map((v) => scalar(def, v));
  return items.length ? items : null;
}

export interface Bound<T> {
  value: T;
  missing: string[]; // labels of required parameters without a value
}

const labelOf = (def: ParameterDef) => def.label || def.name;

/** The builder spec with values filled in; conditions without one are dropped. */
export function bindSpec(spec: QuerySpec, defs: ParameterDef[], values: ParamValues): Bound<QuerySpec> {
  const missing: string[] = [];
  const bindGroup = (group: FilterGroup | null | undefined): FilterGroup | null => {
    if (!group) return null;
    const rules: FilterNode[] = [];
    for (const rule of group.rules) {
      if (isGroup(rule)) {
        const inner = bindGroup(rule);
        if (inner) rules.push(inner);
        continue;
      }
      if (!rule.param) {
        rules.push(rule);
        continue;
      }
      const def = defs.find((d) => d.name === rule.param) ?? { name: rule.param, type: 'text' as const };
      const value = effectiveValue(def, values, shapeOf(rule.op));
      if (value === null) {
        if (def.required && !missing.includes(labelOf(def))) missing.push(labelOf(def));
        continue;
      }
      const bound: Condition = { ...rule, value };
      delete bound.param;
      rules.push(bound);
    }
    return rules.length ? { op: group.op, rules } : null;
  };
  const out: QuerySpec = { ...spec };
  const filters = bindGroup(spec.filters);
  const having = bindGroup(spec.having);
  if (filters) out.filters = filters;
  else delete out.filters;
  if (having) out.having = having;
  else delete out.having;
  return { value: out, missing };
}

/** Values for a SQL question; every {{name}} needs one. */
export function sqlValues(defs: ParameterDef[], values: ParamValues): Bound<Record<string, string | number | null>> {
  const out: Record<string, string | number | null> = {};
  const missing: string[] = [];
  for (const def of defs) {
    const value = effectiveValue(def, values) as string | number | null;
    if (value === null) missing.push(labelOf(def));
    out[def.name] = value;
  }
  return { value: out, missing };
}

// ---------------------------------------------------------------- values in the URL (?p.region=EU)

export function valuesFromSearch(search: URLSearchParams): ParamValues {
  const out: ParamValues = {};
  for (const key of new Set(search.keys())) {
    if (!key.startsWith('p.')) continue;
    const all = search.getAll(key);
    out[key.slice(2)] = all.length > 1 ? all : all[0];
  }
  return out;
}

export function valuesToSearch(values: ParamValues, search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  for (const [k, v] of search) if (!k.startsWith('p.')) next.append(k, v);
  for (const [name, value] of Object.entries(values)) {
    if (blank(value)) continue;
    for (const v of Array.isArray(value) ? value : [value]) next.append(`p.${name}`, v);
  }
  return next;
}
