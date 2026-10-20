import axios from 'axios';
import { t } from './i18n/index.ts';

const TOKEN_KEY = 'ncode_token';
export const UNAUTHORIZED_EVENT = 'ncode:unauthorized';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null): void => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
};

// Development: the API runs on its own port. Docker / behind a proxy: build with VITE_API_URL="" and the
// API is the same address as the page (https://ncode.company.local/api/...).
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
export const WS_URL: string = API_URL
  ? API_URL.replace(/^http/, 'ws')
  : typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    : '';

export const http = axios.create({ baseURL: API_URL });

// Attach the session token to every request.
http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

// An expired/invalid session anywhere sends the user back to the login screen.
http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && getToken()) {
      setToken(null);
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return Promise.reject(error);
  },
);

/** Pulls a readable message out of an API error (FastAPI puts it in `detail`). */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail: unknown = error.response?.data?.detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first: unknown = detail[0];
      if (typeof first === 'object' && first !== null && 'msg' in first) return String((first as { msg: unknown }).msg);
    }
    if (!error.response) return t('The server is not reachable. Make sure the backend is running.');
  }
  return fallback;
}

/** Like apiErrorMessage, but also understands errors of requests made with responseType "blob". */
export async function apiErrorMessageAsync(error: unknown, fallback: string): Promise<string> {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const parsed: unknown = JSON.parse(await error.response.data.text());
      if (typeof parsed === 'object' && parsed !== null && 'detail' in parsed) {
        const detail = (parsed as { detail: unknown }).detail;
        if (typeof detail === 'string' && detail) return detail;
      }
    } catch {
      // not JSON - fall through to the generic message
    }
  }
  return apiErrorMessage(error, fallback);
}

// ---------------------------------------------------------------- types

export type MatchMode = 'contains' | 'exact' | 'starts_with';

export interface User {
  username: string;
  role: string;
  email?: string | null;
}

export interface LoginResponse {
  token: string;
  expires_at: number;
  user: User;
}

export interface Connection {
  key: string;
  label: string;
  engine: string;
  database: string;
  id_hints: string[];
  source: string; // "env" (from .env) | "ui" (managed in the interface)
  editable: boolean;
}

export interface EngineOption {
  name: string;
  label: string;
  default_port: number | null;
  available: boolean;
  pip: string | null;
  file_based: boolean;
}

export interface ConnectionDetails {
  key: string;
  label: string;
  engine: string;
  host: string | null;
  port: number | null;
  username: string | null;
  has_password: boolean;
  database: string;
  schema_name: string | null;
  id_hints: string[];
  source: string;
  editable: boolean;
}

export interface ConnectionPayload {
  label: string;
  engine: string;
  host: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
  database: string;
  schema_name: string | null;
  id_hints: string[];
  key?: string | null;
}

export interface DraftTestResult {
  ok: boolean;
  tables?: number;
  error?: string;
}

export interface TableInfo {
  name: string;
  columns: number;
  searchable: number;
}

export interface SearchHit {
  table: string;
  row: Record<string, unknown>;
  cols: string[];
  matched_columns: string[];
  id_column: string | null;
}

export interface TableError {
  table: string;
  error: string;
}

export interface Progress {
  status: string;
  total: number;
  processed: number;
  found: number;
}

export interface TaskMessage extends Partial<Progress> {
  status: string;
  message?: string | null;
  results?: SearchHit[];
  errors?: TableError[];
  truncated_tables?: string[];
  results_capped?: boolean;
  skipped?: number;
  elapsed_sec?: number;
}

export interface BrowseRow {
  values: Record<string, unknown>;
  matched: string[];
}

export interface BrowseResponse {
  table: string;
  columns: string[];
  omitted: string[]; // binary columns that are not shown
  rows: BrowseRow[];
  has_more: boolean;
  offset: number;
  limit: number;
  sort: string | null;
  descending: boolean;
  note: string | null;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primary_key: boolean;
}

export interface Limits {
  max_row_limit: number;
  max_export_rows: number;
  query_default_rows?: number;
  query_max_rows?: number;
  max_concurrent_queries?: number;
  federation_source_rows?: number;
  uploads_enabled?: boolean;
  dataset_max_mb?: number;
  dataset_max_rows?: number;
}

// ---------------------------------------------------------------- schema v2

/** Column types normalised by the backend (app/schema_graph.py). */
export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'time' | 'json' | 'binary' | 'unknown';

export interface SchemaColumn {
  name: string;
  type: ColumnType;
  db_type: string;
  nullable: boolean;
  primary_key: boolean;
  foreign_key: { table: string; column: string } | null;
  // data model (M7), present when an admin set something
  display_name?: string | null;
  description?: string | null;
  semantic_type?: string | null;
  format?: Record<string, unknown> | null;
  hidden?: boolean;
  parse_as_date?: boolean;
}

export interface SchemaTable {
  name: string;
  primary_key: string[];
  columns: SchemaColumn[];
}

export interface Relationship {
  from_table: string;
  from_columns: string[];
  to_table: string;
  to_columns: string[];
  manual?: boolean; // added in the data model (M7)
}

export interface SchemaV2 {
  connection: string;
  version: 2;
  tables: SchemaTable[];
  relationships: Relationship[];
}

// ---------------------------------------------------------------- result envelope (used from M1 on)

export interface ResultColumn {
  name: string;
  type: ColumnType;
  role: 'dimension' | 'measure';
  // from the data model (M7)
  display_name?: string | null;
  description?: string | null;
  semantic_type?: string | null;
  format?: Record<string, unknown> | null;
  generated?: boolean; // added by a calculation (running total ...)
}

export interface ResultEnvelope {
  columns: ResultColumn[];
  rows: unknown[][];
  stats: { duration_ms: number; row_count: number; truncated: boolean; cached: boolean };
  sql: string | null;
  federation?: FederationInfo | null; // multi-source questions (M6)
  analysis?: Record<string, unknown> | null; // profiles and X-rays (M7)
}

/** What a multi-source run reports besides the rows (backend/app/federation/engine.py). */
export interface FederationInfo {
  sources: { alias: string; label: string; kind: string; connection: string | null; rows: number; truncated: boolean; duration_ms: number }[];
  joins: JoinStats[];
  combined_rows: number;
  combined_columns: { name: string; type: ColumnType }[];
}

export interface JoinStats {
  source: string;
  type: 'inner' | 'left' | 'right' | 'full';
  keys: string[];
  match: string[];
  left_rows: number;
  right_rows: number;
  left_unmatched_rows: number;
  right_unmatched_rows: number;
  left_null_keys: number;
  right_null_keys: number;
  left_keys: number;
  right_keys: number;
  left_unmatched_keys: number;
  right_unmatched_keys: number;
  left_repeated_keys: number;
  right_repeated_keys: number;
  left_samples: unknown[];
  right_samples: unknown[];
}
