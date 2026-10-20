import { QueryClient } from '@tanstack/react-query';
import axios from 'axios';

/** Server state (connections, table lists, schemas ...) lives in this cache. Cleared on sign-out. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Refetching hits the user's databases; only do it when asked.
      refetchOnWindowFocus: false,
      // 4xx answers (no access, unknown table, signed out) will not change on a retry.
      retry: (failureCount, error) => {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status !== undefined && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

export const queryKeys = {
  connections: ['connections'] as const,
  engines: ['engines'] as const,
  limits: ['limits'] as const,
  tables: (key: string) => ['tables', key] as const,
  schema: (key: string) => ['schema', key] as const,
};
