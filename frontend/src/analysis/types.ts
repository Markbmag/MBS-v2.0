/** Profiles and X-rays (backend/app/analysis). */
import type { ColumnType } from '../api';
import type { QuerySpec } from '../query/types';
import type { VizState } from '../viz/state';

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  rows: number;
  nulls: number;
  distinct: number;
  unique: boolean;
  id_like: boolean;
  display_name?: string;
  description?: string;
  semantic_type?: string;
  hidden?: boolean;
  // numbers
  min?: number | string | null;
  max?: number | string | null;
  mean?: number | null;
  median?: number | null;
  stddev?: number | null;
  p05?: number | null;
  p25?: number | null;
  p75?: number | null;
  p95?: number | null;
  zeros?: number;
  negatives?: number;
  outliers?: number;
  outlier_range?: [number, number];
  histogram?: { start: number | string; end?: number; count: number }[];
  unit?: string; // dates: histogram step
  // text
  min_length?: number;
  max_length?: number;
  avg_length?: number;
  empty?: number;
  date_like?: number;
  looks_like_dates?: boolean;
  // booleans
  true?: number;
  false?: number;
  top?: { value: unknown; count: number }[];
}

export interface Profile {
  rows_profiled: number;
  total_rows?: number | null;
  sampled?: boolean;
  truncated?: boolean;
  columns: ColumnProfile[];
  correlations: { columns: string[]; matrix: (number | null)[][] } | null;
}

export interface XrayCard {
  key: string;
  title: string;
  spec: QuerySpec;
  viz: VizState;
  layout: { x: number; y: number; w: number; h: number };
}

export interface Analysis {
  kind: 'table' | 'question';
  title: string;
  profile: Profile;
  cards?: XrayCard[];
}
