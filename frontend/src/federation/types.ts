/** Multi-source questions and uploaded files (mirrors backend/app/federation/spec.py and datasets.py). */
import type { ColumnType } from '../api.ts';
import type { Aggregation, Breakout, CustomColumn, FieldSel, FilterGroup, OrderBy, QuerySpec, Transform } from '../query/types.ts';

export type SourceType = 'question' | 'builder' | 'sql' | 'dataset';
export type JoinType = 'inner' | 'left' | 'right' | 'full';
export type KeyMatch = 'auto' | 'exact' | 'text' | 'text_ci' | 'number';

export interface Source {
  alias: string;
  label?: string | null;
  type: SourceType;
  question_id?: number;
  spec?: QuerySpec;
  connection?: string;
  sql?: string;
  dataset_id?: number;
  limit?: number | null;
}

export interface KeyPair {
  left: string;   // "alias.column" of a source already joined
  right: string;  // "alias.column" of the source being joined
  match?: KeyMatch;
}

export interface Join {
  source: string;
  type: JoinType;
  on: KeyPair[];
}

/** A builder question over the combined rows (the table "result"). */
export interface PostSpec {
  expressions?: CustomColumn[];
  fields?: FieldSel[];
  aggregations?: Aggregation[];
  breakouts?: Breakout[];
  filters?: FilterGroup | null;
  having?: FilterGroup | null;
  order?: OrderBy[];
}

export interface ColumnHint {
  name: string;
  type: ColumnType;
}

export interface FederatedSpec {
  version: 1;
  sources: Source[];
  mode?: 'join' | 'sql';
  joins?: Join[];
  sql?: string | null;
  post?: PostSpec | null;
  limit?: number | null;
  result_columns?: ColumnHint[];
  transforms?: Transform[];
}

export interface Dataset {
  id: number;
  name: string;
  description: string | null;
  collection_id: number;
  collection: { id: number; name: string } | null;
  owner: string | null;
  archived: boolean;
  columns: ColumnHint[];
  row_count: number;
  size_bytes: number;
  source_name: string | null;
  source_format: 'csv' | 'xlsx' | 'parquet';
  access: 'view' | 'edit' | null;
  created_at: number;
  updated_at: number;
  updated_by: string | null;
}

export const JOIN_TYPES: { value: JoinType; label: string; hint: string }[] = [
  { value: 'left', label: 'Keep all rows on the left', hint: 'LEFT JOIN: rows without a partner get empty columns' },
  { value: 'inner', label: 'Only rows with a match', hint: 'INNER JOIN' },
  { value: 'full', label: 'Keep all rows on both sides', hint: 'FULL JOIN' },
  { value: 'right', label: 'Keep all rows on the right', hint: 'RIGHT JOIN' },
];

export const MATCHES: { value: KeyMatch; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'text', label: 'As text (trimmed)' },
  { value: 'text_ci', label: 'As text, ignore case' },
  { value: 'number', label: 'As numbers' },
  { value: 'exact', label: 'Exactly as stored' },
];
