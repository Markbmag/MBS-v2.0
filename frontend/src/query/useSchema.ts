import { useQuery } from '@tanstack/react-query';
import { http } from '../api';
import type { SchemaV2 } from '../api';
import { queryKeys } from '../lib/queryClient';

/** Schema v2 of a connection (typed columns, keys, relationships), cached per connection. */
export function useSchema(connection: string) {
  return useQuery({
    queryKey: queryKeys.schema(connection),
    queryFn: async () => (await http.get<SchemaV2>(`/api/connections/${connection}/schema`)).data,
    enabled: connection !== '',
    staleTime: 5 * 60_000,
  });
}
