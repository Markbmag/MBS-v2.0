import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@chakra-ui/react';
import axios from 'axios';
import { apiErrorMessage, getToken, http, WS_URL } from '../api';
import type { MatchMode, Progress, SearchHit, TableError, TaskMessage } from '../api';
import { t } from '../i18n/index.ts';

export interface SearchParams {
  connection: string;
  phrase: string;
  matchMode: MatchMode;
  caseSensitive: boolean;
  includeNumbers: boolean;
  rowLimit: number;
  tables: string[]; // exact names; empty = every table
  excludePatterns: string[]; // glob patterns such as log_*
}

export interface SearchState {
  phase: 'idle' | 'running' | 'done';
  status: string;
  progress: Progress;
  results: SearchHit[];
  errors: TableError[];
  truncatedTables: string[];
  resultsCapped: boolean;
  elapsedSec: number | null;
  skipped: number;
  message: string | null;
  params: SearchParams | null; // what produced these results
}

const EMPTY_PROGRESS: Progress = { status: '', total: 0, processed: 0, found: 0 };

export const INITIAL_SEARCH: SearchState = {
  phase: 'idle',
  status: '',
  progress: EMPTY_PROGRESS,
  results: [],
  errors: [],
  truncatedTables: [],
  resultsCapped: false,
  elapsedSec: null,
  skipped: 0,
  message: null,
  params: null,
};

const FINAL_STATUSES = ['completed', 'cancelled', 'error'];

/** Starts a search, follows its progress over a WebSocket and exposes the outcome. */
export function useSearch(onUnauthorized: () => void) {
  const [state, setState] = useState<SearchState>(INITIAL_SEARCH);
  const wsRef = useRef<WebSocket | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const toast = useToast();

  const closeSocket = useCallback(() => {
    const socket = wsRef.current;
    wsRef.current = null; // detach first so the socket's onclose knows it is stale
    socket?.close();
  }, []);

  useEffect(() => closeSocket, [closeSocket]);

  const start = useCallback(
    async (params: SearchParams) => {
      closeSocket();
      taskIdRef.current = null;
      setState({ ...INITIAL_SEARCH, phase: 'running', status: 'starting', params });

      try {
        const res = await http.post<{ task_id: string }>('/api/search', {
          connection: params.connection,
          phrase: params.phrase,
          match_mode: params.matchMode,
          case_sensitive: params.caseSensitive,
          include_numeric: params.includeNumbers,
          include_dates: params.includeNumbers,
          row_limit: params.rowLimit,
          tables: params.tables,
          exclude_tables: params.excludePatterns,
        });
        taskIdRef.current = res.data.task_id;

        const socket = new WebSocket(`${WS_URL}/ws/${res.data.task_id}`);
        wsRef.current = socket;
        let finished = false;

        // The server expects the session token as the first message.
        socket.onopen = () => socket.send(JSON.stringify({ token: getToken() ?? '' }));

        socket.onmessage = (event: MessageEvent<string>) => {
          const data = JSON.parse(event.data) as TaskMessage;

          if (data.status === 'unauthorized') {
            finished = true;
            socket.close();
            setState((prev) => ({ ...prev, phase: 'idle', status: '' }));
            onUnauthorized();
            return;
          }
          if (data.status === 'unknown') {
            finished = true;
            socket.close();
            setState((prev) => ({ ...prev, phase: 'idle', status: '' }));
            toast({ title: t('This search no longer exists'), status: 'error' });
            return;
          }
          if (FINAL_STATUSES.includes(data.status)) {
            finished = true;
            socket.close();
            setState((prev) => ({
              ...prev,
              phase: 'done',
              status: data.status,
              progress: {
                status: data.status,
                total: data.total ?? prev.progress.total,
                processed: data.processed ?? prev.progress.processed,
                found: data.found ?? 0,
              },
              results: data.results ?? [],
              errors: data.errors ?? [],
              truncatedTables: data.truncated_tables ?? [],
              resultsCapped: Boolean(data.results_capped),
              elapsedSec: data.elapsed_sec ?? null,
              skipped: data.skipped ?? 0,
              message: data.message ?? null,
            }));
            if (data.status === 'error') {
              toast({ title: t('Search failed'), description: data.message ?? undefined, status: 'error' });
            }
            return;
          }
          setState((prev) => ({
            ...prev,
            status: data.status,
            progress: {
              status: data.status,
              total: data.total ?? 0,
              processed: data.processed ?? 0,
              found: data.found ?? 0,
            },
          }));
        };

        socket.onerror = () => {
          if (wsRef.current === socket) toast({ title: t('Connection to the server was lost'), status: 'error' });
        };

        socket.onclose = () => {
          // Ignore sockets we closed ourselves (new search, unmount, finished).
          if (wsRef.current !== socket || finished) return;
          wsRef.current = null;
          setState((prev) => (prev.phase === 'running' ? { ...prev, phase: 'idle', status: '' } : prev));
        };
      } catch (error) {
        const tooMany = axios.isAxiosError(error) && error.response?.status === 429;
        toast({
          title: tooMany ? t('Too many searches at once') : t('Could not start the search'),
          description: tooMany
            ? t('Wait for a running search to finish or cancel it.')
            : apiErrorMessage(error, t('Unexpected error')),
          status: tooMany ? 'warning' : 'error',
        });
        setState((prev) => ({ ...prev, phase: 'idle', status: '' }));
      }
    },
    [closeSocket, onUnauthorized, toast],
  );

  const cancel = useCallback(async () => {
    const taskId = taskIdRef.current;
    if (!taskId) return;
    try {
      await http.delete(`/api/search/${taskId}`);
    } catch {
      // the search will end by itself; nothing to tell the user
    }
  }, []);

  const reset = useCallback(() => {
    closeSocket();
    taskIdRef.current = null;
    setState(INITIAL_SEARCH);
  }, [closeSocket]);

  return { state, start, cancel, reset };
}
