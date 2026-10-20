/**
 * QuerySpec v1, as accepted by POST /api/query (mirrors backend/app/query/spec.py).
 * The visual builder edits one of these directly; it is also what M4 will save.
 */

export type Literal = string | number | boolean | null;

export type Expr =
  | { ref: string }
  | { value: Literal }
  | { op: '+' | '-' | '*' | '/'; args: [Expr, Expr] }
  | { fn: FunctionName; args: Expr[]; digits?: number }
  | { case: { when: FilterNode; then: Expr }[]; else?: Expr };

export type FunctionName = 'coalesce' | 'lower' | 'upper' | 'trim' | 'length' | 'abs' | 'round' | 'concat' | 'nullif';

export type FilterOp =
  | '=' | '!=' | '>' | '>=' | '<' | '<=' | 'between' | 'in' | 'not_in'
  | 'is_null' | 'not_null' | 'is_empty' | 'not_empty'
  | 'contains' | 'not_contains' | 'starts_with' | 'ends_with'
  | 'is_true' | 'is_false' | 'last' | 'current';

export type DateUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface RelativeDate {
  amount?: number;
  unit: DateUnit;
  include_current?: boolean;
}

export interface Condition {
  ref?: string;
  expr?: Expr;
  op: FilterOp;
  value?: unknown;
  case_sensitive?: boolean;
  param?: string; // saved questions: the value comes from this parameter (src/library/params.ts)
}

export interface FilterGroup {
  op: 'and' | 'or';
  rules: FilterNode[];
}

export type FilterNode = FilterGroup | Condition;

export const isGroup = (node: FilterNode): node is FilterGroup => 'rules' in node;

export type JoinType = 'inner' | 'left' | 'full';
export type AggregateFn = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max' | 'metric';
export type Bucket = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface Join {
  table: string;
  alias?: string;
  type: JoinType;
  on?: { left: string; right: string }[]; // empty or missing = follow foreign keys
}

export interface CustomColumn {
  name: string;
  expr: Expr;
}

export interface FieldSel {
  ref: string;
  alias?: string;
}

export interface Aggregation {
  fn: AggregateFn;
  ref?: string;
  alias?: string;
  metric?: number;              // fn "metric": a saved metric (data model, M7)
  where?: FilterGroup | null;   // only the matching rows count
}

export type TransformType = 'running_total' | 'moving_average' | 'pct_change' | 'previous_period' | 'rank' | 'pct_of_total' | 'outliers';

/** A calculation on the result rows (backend/app/query/transforms.py). */
export interface Transform {
  type: TransformType;
  column: string;
  by?: string | null;
  window?: number;
  period?: 'day' | 'week' | 'month' | 'quarter' | 'year' | null;
  method?: 'iqr' | 'zscore';
  alias?: string | null;
}

export interface Breakout {
  ref: string;
  bucket?: Bucket;
  bin_width?: number;
  alias?: string;
}

export interface OrderBy {
  ref: string;
  dir: 'asc' | 'desc';
}

export interface QuerySpec {
  version: 1;
  connection: string;
  source: { table: string; alias?: string };
  joins?: Join[];
  expressions?: CustomColumn[];
  fields?: FieldSel[];
  aggregations?: Aggregation[];
  breakouts?: Breakout[];
  filters?: FilterGroup | null;
  having?: FilterGroup | null;
  order?: OrderBy[];
  limit?: number | null;
  transforms?: Transform[];
}
