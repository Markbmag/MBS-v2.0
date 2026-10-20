/** Profiles and X-rays run as query tasks (backend/app/analysis/routes.py). */
import axios from 'axios';
import { http } from '../api';
import type { TaskSnapshot } from '../query/useQueryRun';
import type { Analysis } from './types';

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Start an analysis and follow its task to the end (waits for a free slot on 429). */
export async function runAnalysis(path: '/api/profile/table' | '/api/xray', body: Record<string, unknown>, signal?: AbortSignal): Promise<Analysis> {
  let snap: TaskSnapshot | null = null;
  for (let attempt = 0; snap === null; attempt++) {
    try {
      snap = (await http.post<TaskSnapshot>(path, { ...body, wait_ms: 8000 }, { signal })).data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 429 && attempt < 20) await sleep(700 + attempt * 300);
      else throw error;
    }
  }
  while (snap.status === 'running') snap = (await http.get<TaskSnapshot>(`/api/query/tasks/${snap.task_id}`, { params: { wait_ms: 10000 }, signal })).data;
  if (snap.status !== 'completed' || !snap.result?.analysis) throw new Error(snap.error ?? `The analysis was ${snap.status}`);
  return snap.result.analysis as unknown as Analysis;
}
