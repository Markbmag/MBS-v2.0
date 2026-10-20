/** Data model (backend/app/semantic): column metadata, manual relationships, metrics. */
import { useQuery } from '@tanstack/react-query';
import { http } from '../api';
import { queryClient, queryKeys } from '../lib/queryClient';
import type { Aggregation, FilterGroup } from '../query/types';
import type { ColumnFormat } from '../viz/types';

export const SEMANTIC_TYPES: { value: string; label: string }[] = [
  { value: 'category', label: 'Category' },
  { value: 'id', label: 'Identifier' },
  { value: 'name', label: 'Name' },
  { value: 'description', label: 'Description / long text' },
  { value: 'email', label: 'E-mail' },
  { value: 'url', label: 'Link' },
  { value: 'currency', label: 'Money' },
  { value: 'percent', label: 'Percentage' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'score', label: 'Score / rating' },
  { value: 'created', label: 'Created (date)' },
  { value: 'updated', label: 'Updated (date)' },
  { value: 'latitude', label: 'Latitude' },
  { value: 'longitude', label: 'Longitude' },
];

export interface FieldMeta {
  display_name?: string | null;
  description?: string | null;
  semantic_type?: string | null;
  format?: ColumnFormat | null;
  hidden?: boolean;
  parse_as_date?: boolean;
}

export interface MetricDefinition {
  fn: Exclude<Aggregation['fn'], 'metric'>;
  ref?: string;
  where?: FilterGroup | null;
}

export interface Metric {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  connection: string;
  table: string;
  definition: MetricDefinition;
  format: ColumnFormat | null;
  archived: boolean;
  updated_at: number;
  updated_by: string | null;
}

export const metricKeys = { list: (connection: string) => ['metrics', connection] as const };

export function useMetrics(connection: string) {
  return useQuery({
    queryKey: metricKeys.list(connection),
    enabled: connection !== '',
    staleTime: 60_000,
    queryFn: async () => (await http.get<{ metrics: Metric[] }>('/api/metrics', { params: { connection } })).data.metrics,
  });
}

/** The schema carries the metadata: after a change, read it again (and the metrics). */
async function refresh(connection: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.schema(connection) }),
    queryClient.invalidateQueries({ queryKey: metricKeys.list(connection) }),
  ]);
}

export const semantic = {
  setField: async (connection: string, table: string, column: string, meta: FieldMeta) => {
    const body: FieldMeta = { ...meta };
    for (const k of ['display_name', 'description'] as const) if (!body[k]?.trim()) body[k] = null;
    if (!body.semantic_type) body.semantic_type = null;
    if (!body.format || Object.keys(body.format).length === 0) body.format = null;
    await http.put(`/api/semantic/${encodeURIComponent(connection)}/fields/${encodeURIComponent(table)}/${encodeURIComponent(column)}`, body);
    await refresh(connection);
  },
  addRelationship: async (connection: string, rel: { from_table: string; from_columns: string[]; to_table: string; to_columns: string[] }) => {
    const res = await http.post<{ id: number }>(`/api/semantic/${encodeURIComponent(connection)}/relationships`, rel);
    await refresh(connection);
    return res.data;
  },
  relationships: async (connection: string) =>
    (await http.get<{ relationships: ({ id: number } & Record<string, unknown>)[] }>(`/api/semantic/${encodeURIComponent(connection)}/relationships`)).data
      .relationships,
  deleteRelationship: async (connection: string, id: number) => {
    await http.delete(`/api/semantic/${encodeURIComponent(connection)}/relationships/${id}`);
    await refresh(connection);
  },
  saveMetric: async (
    body: { name: string; description: string | null; connection: string; table: string; definition: MetricDefinition; format: ColumnFormat | null },
    id?: number,
  ) => {
    const res = id ? await http.put<Metric>(`/api/metrics/${id}`, body) : await http.post<Metric>('/api/metrics', body);
    await refresh(body.connection);
    return res.data;
  },
  archiveMetric: async (m: Metric) => {
    await http.patch(`/api/metrics/${m.id}`, { archived: true });
    await refresh(m.connection);
  },
};
