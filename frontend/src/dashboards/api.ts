/** Dashboard API (backend/app/content/dashboard_routes.py): hooks and mutations. */
import { createContext, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { apiErrorMessage, http } from '../api';
import type { ResultEnvelope } from '../api';
import { libraryKeys, refreshLibrary } from '../library/api';
import { queryClient } from '../lib/queryClient';
import type { TaskSnapshot } from '../query/useQueryRun';
import { RunQueue } from './logic';
import type { Dashboard, DashboardSummary, DashCard, Definition } from './types';
import { t } from '../i18n/index.ts';

/**
 * Where cards run. Inside Ncode: the signed-in API (null). On a public link or an embed (M8):
 * /api/public/{token} or /api/embed/{jwt}, with no editor and downloads only when allowed.
 */
export interface CardEndpoints {
  run: (card: DashCard) => string;
  tasks: string; // base of /tasks/{id}
  headers?: Record<string, string>;
  download: boolean;
}
export const CardEndpointsContext = createContext<CardEndpoints | null>(null);

export const dashboardKeys = {
  list: (params: Record<string, unknown>) => [...libraryKeys.all, 'dashboards', params] as const,
  one: (id: number) => [...libraryKeys.all, 'dashboard', id] as const,
};

export function useDashboards(params: { q?: string; favorites?: boolean; limit?: number }, enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.list(params),
    enabled,
    queryFn: async () => (await http.get<{ dashboards: DashboardSummary[] }>('/api/dashboards', { params })).data.dashboards,
  });
}

export function useDashboard(id: number) {
  return useQuery({
    queryKey: dashboardKeys.one(id),
    queryFn: async () => (await http.get<Dashboard>(`/api/dashboards/${id}`)).data,
  });
}

async function after<T>(promise: Promise<{ data: T }>): Promise<T> {
  const { data } = await promise;
  await refreshLibrary();
  return data;
}

export const dashboards = {
  create: (body: { name: string; description?: string | null; collection_id: number | null }) => after(http.post<Dashboard>('/api/dashboards', body)),
  save: async (id: number, def: Definition) => {
    const d = (await http.put<Dashboard>(`/api/dashboards/${id}`, def)).data;
    queryClient.setQueryData(dashboardKeys.one(id), d);
    await refreshLibrary();
    return d;
  },
  update: (id: number, body: Partial<{ name: string; description: string | null; collection_id: number; archived: boolean }>) =>
    after(http.patch<Dashboard>(`/api/dashboards/${id}`, body)),
  remove: (id: number) => after(http.delete(`/api/dashboards/${id}`)),
  duplicate: (id: number) => after(http.post<Dashboard>(`/api/dashboards/${id}/duplicate`, {})),
  favorite: (id: number, on: boolean) => after(on ? http.put(`/api/dashboards/${id}/favorite`) : http.delete(`/api/dashboards/${id}/favorite`)),
};

// ---------------------------------------------------------------- running one card

/** Shared by every card on screen: card runs stay below the server's per-user limit. */
export const cardQueue = new RunQueue(3);

export interface CardRunState {
  status: 'idle' | 'queued' | 'running' | 'completed' | 'error' | 'cancelled';
  result: ResultEnvelope | null;
  error: string | null;
  taskId: string | null;
  finishedAt: number | null;
}

const IDLE: CardRunState = { status: 'idle', result: null, error: null, taskId: null, finishedAt: null };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs a dashboard card whenever the request or `trigger` changes (filters, refresh ticks); a newer run
 * or leaving the page cancels the older one. The last result stays visible while the
 * next one loads.
 */
export function useCardRun(
  url: string, bodyJson: string, trigger: number, refresh: boolean, enabled: boolean, tasks = '/api/query', headersJson = '{}',
): CardRunState {
  const [state, setState] = useState<CardRunState>(IDLE);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let task: string | null = null;
    const run = async () => {
      setState((prev) => ({ ...prev, status: 'queued', error: null }));
      const release = await cardQueue.acquire();
      try {
        if (!alive) return;
        setState((prev) => ({ ...prev, status: 'running' }));
        // public links and embeds allow shorter waits (they hold server threads)
        const shared = tasks !== '/api/query';
        const body = { ...(JSON.parse(bodyJson) as object), wait_ms: shared ? 2000 : 4000, refresh };
        const headers = JSON.parse(headersJson) as Record<string, string>;
        let snap: TaskSnapshot | null = null;
        for (let attempt = 0; snap === null; attempt++) {
          try {
            snap = (await http.post<TaskSnapshot>(url, body, { headers })).data;
          } catch (error) {
            // too many queries at once (other tabs, other pages): wait and try again
            if (axios.isAxiosError(error) && error.response?.status === 429 && attempt < 20 && alive) await sleep(1000 + attempt * 250);
            else throw error;
          }
          if (!alive) return;
        }
        task = snap.task_id;
        while (snap.status === 'running') {
          snap = (await http.get<TaskSnapshot>(`${tasks}/tasks/${snap.task_id}`, { params: { wait_ms: shared ? 2000 : 10000 }, headers })).data;
          if (!alive) return;
        }
        task = null;
        const done = snap;
        setState((prev) => ({
          status: done.status === 'completed' ? 'completed' : done.status === 'cancelled' ? 'cancelled' : 'error',
          result: done.status === 'completed' ? done.result : prev.result,
          error: done.error,
          taskId: done.task_id,
          finishedAt: Date.now(),
        }));
      } catch (error) {
        if (!alive) return;
        setState({ ...IDLE, status: 'error', error: apiErrorMessage(error, t('This card could not be loaded')), finishedAt: Date.now() });
      } finally {
        release();
      }
    };
    void run();
    return () => {
      alive = false;
      if (task) http.delete(`${tasks}/tasks/${task}`, { headers: JSON.parse(headersJson) as Record<string, string> }).catch(() => undefined);
    };
  }, [url, bodyJson, trigger, refresh, enabled, tasks, headersJson]);

  return state;
}
