/** Uploaded files and multi-source runs (backend/app/federation/routes.py). */
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { http } from '../api';
import type { ResultEnvelope } from '../api';
import { refreshLibrary } from '../library/api';
import type { ParameterDef, ParamValues } from '../library/params';
import { queryClient } from '../lib/queryClient';
import type { TaskSnapshot } from '../query/useQueryRun';
import type { Dataset, FederatedSpec, Source } from './types';

export const datasetKeys = {
  all: ['datasets'] as const,
  list: (params: Record<string, unknown>) => ['datasets', 'list', params] as const,
  one: (id: number) => ['datasets', 'one', id] as const,
};

export function useDatasets(params: { q?: string; collection?: number } = {}) {
  return useQuery({
    queryKey: datasetKeys.list(params),
    queryFn: async () => (await http.get<{ datasets: Dataset[] }>('/api/datasets', { params })).data.datasets,
  });
}

export function useDataset(id: number | null | undefined) {
  return useQuery({
    queryKey: datasetKeys.one(id ?? 0),
    enabled: !!id,
    queryFn: async () => (await http.get<Dataset>(`/api/datasets/${id}`)).data,
  });
}

async function refreshDatasets() {
  await Promise.all([queryClient.invalidateQueries({ queryKey: datasetKeys.all }), refreshLibrary()]);
}

export interface UploadOptions {
  name?: string;
  collection_id?: number | null;
  delimiter?: 'auto' | 'comma' | 'semicolon' | 'tab' | 'pipe';
  header?: boolean;
  encoding?: 'utf-8' | 'latin-1' | 'utf-16';
  sheet?: string;
}

export const datasets = {
  upload: async (file: File, options: UploadOptions, onProgress?: (share: number) => void) => {
    const params: Record<string, unknown> = { filename: file.name };
    for (const [k, v] of Object.entries(options)) if (v !== undefined && v !== null && v !== '') params[k] = v;
    const res = await http.post<Dataset>('/api/datasets', file, {
      params,
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: 0, // big files take a while
      onUploadProgress: (e) => onProgress?.(e.total ? e.loaded / e.total : 0),
    });
    await refreshDatasets();
    return res.data;
  },
  update: async (id: number, body: Partial<{ name: string; description: string | null; collection_id: number; archived: boolean }>) => {
    const res = await http.patch<Dataset>(`/api/datasets/${id}`, body);
    await refreshDatasets();
    return res.data;
  },
  remove: async (id: number) => {
    await http.delete(`/api/datasets/${id}`);
    await refreshDatasets();
  },
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Start a multi-source run and follow it to the end (for previews; the editor uses useQueryRun). */
export async function runToEnd(body: { spec: FederatedSpec; parameters?: ParameterDef[]; params?: ParamValues }): Promise<ResultEnvelope> {
  let snap: TaskSnapshot | null = null;
  for (let attempt = 0; snap === null; attempt++) {
    try {
      snap = (await http.post<TaskSnapshot>('/api/federated/run', { ...body, wait_ms: 8000 })).data;
    } catch (error) {
      // the per-user query limit: wait for a slot (previews of several sources start together)
      if (axios.isAxiosError(error) && error.response?.status === 429 && attempt < 20) await sleep(700 + attempt * 300);
      else throw error;
    }
  }
  while (snap.status === 'running') snap = (await http.get<TaskSnapshot>(`/api/query/tasks/${snap.task_id}`, { params: { wait_ms: 10000 } })).data;
  if (snap.status !== 'completed' || !snap.result) throw new Error(snap.error ?? `The preview was ${snap.status}`);
  return snap.result;
}

export const PREVIEW_ROWS = 20;

/** Query options for the columns and first rows of one source, read on its own (use with useQuery / useQueries). */
export function previewQuery(source: Source, values: ParamValues, defs: ParameterDef[]) {
  const key = JSON.stringify({ ...source, label: null, alias: 'preview' });
  return {
    queryKey: ['federation', 'preview', key, values, defs] as const,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () =>
      runToEnd({
        spec: { version: 1, sources: [{ ...source, alias: 'preview', limit: PREVIEW_ROWS }], limit: PREVIEW_ROWS },
        parameters: defs,
        params: values,
      }),
  };
}

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} kB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
