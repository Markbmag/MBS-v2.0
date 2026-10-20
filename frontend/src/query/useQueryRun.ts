import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { apiErrorMessage, http } from '../api';
import type { ResultEnvelope } from '../api';
import { t } from '../i18n/index.ts';

/** What POST /api/query, /api/query/sql and GET /api/query/tasks/{id} answer. */
export interface TaskSnapshot {
  task_id: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  result: ResultEnvelope | null;
  error: string | null;
  elapsed_ms: number;
}

export interface RunState {
  phase: 'idle' | 'running' | 'done';
  status: TaskSnapshot['status'] | 'failed' | null; // failed = the request itself was refused (400, 429 ...)
  result: ResultEnvelope | null;
  error: string | null;
  taskId: string | null;
  startedAt: number | null;
}

const IDLE: RunState = { phase: 'idle', status: null, result: null, error: null, taskId: null, startedAt: null };

/**
 * Runs a question or SQL, follows the task until it ends, and cancels it when a
 * newer run starts, when asked, or when the page goes away.
 *
 * Callers should start with a short wait_ms (the server answers with the task id
 * at once if the query is slow) so that Stop works right away; polling then
 * long-polls up to 10 s per request.
 */
export const START_WAIT_MS = 400;
export function useQueryRun() {
  const [state, setState] = useState<RunState>(IDLE);
  const runId = useRef(0);
  const taskId = useRef<string | null>(null);
  const stopRequested = useRef(false); // Stop pressed before the server told us the task id

  const cancelTask = useCallback((id: string | null) => {
    if (id) http.delete(`/api/query/tasks/${id}`).catch(() => undefined);
  }, []);

  const run = useCallback(
    async (request: () => Promise<TaskSnapshot>, keepResult = true, onCompleted?: (result: ResultEnvelope) => void) => {
      const id = ++runId.current;
      cancelTask(taskId.current);
      taskId.current = null;
      stopRequested.current = false;
      setState((prev) => ({
        ...IDLE,
        phase: 'running',
        status: 'running',
        startedAt: Date.now(),
        result: keepResult ? prev.result : null, // keep the old table visible while the new one loads
      }));
      try {
        let snap = await request();
        if (id !== runId.current) return cancelTask(snap.task_id);
        taskId.current = snap.task_id;
        if (stopRequested.current && snap.status === 'running') cancelTask(snap.task_id);
        setState((prev) => ({ ...prev, taskId: snap.task_id }));
        while (snap.status === 'running') {
          snap = (await http.get<TaskSnapshot>(`/api/query/tasks/${snap.task_id}`, { params: { wait_ms: 10000 } })).data;
          if (id !== runId.current) return;
        }
        taskId.current = null;
        if (snap.status === 'completed' && snap.result) onCompleted?.(snap.result);
        setState((prev) => ({
          ...prev,
          phase: 'done',
          status: snap.status,
          result: snap.status === 'completed' ? snap.result : snap.status === 'cancelled' ? prev.result : null,
          error: snap.error,
        }));
      } catch (error) {
        if (id !== runId.current) return;
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        setState((prev) => ({
          ...prev,
          phase: 'done',
          status: 'failed',
          result: status === 400 || status === 422 ? null : prev.result,
          error: apiErrorMessage(error, t('The query could not be started')),
        }));
      }
    },
    [cancelTask],
  );

  const cancel = useCallback(() => {
    stopRequested.current = true;
    cancelTask(taskId.current); // the poll loop then sees "cancelled"
  }, [cancelTask]);

  const reset = useCallback(() => {
    runId.current++;
    cancelTask(taskId.current);
    taskId.current = null;
    setState(IDLE);
  }, [cancelTask]);

  // Leaving the page stops what is still running there.
  useEffect(() => () => cancelTask(taskId.current), [cancelTask]);

  return { state, run, cancel, reset };
}
