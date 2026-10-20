/** Admin settings for delivery, sharing and usage (backend/app/automation, app/sharing, app/usage.py). */
import { useQuery } from '@tanstack/react-query';
import { http } from '../api';
import { queryClient } from '../lib/queryClient';
import { automationKeys } from '../automation/api';
import { shareKeys } from '../sharing/api';

export interface EmailSettings {
  host: string;
  port: number;
  security: 'starttls' | 'ssl' | 'none';
  username: string;
  from_address: string;
  from_name: string;
  reply_to: string;
  allowed_domains: string[];
  password_set?: boolean;
}

export interface AdminSettings {
  email: EmailSettings & { password_set: boolean };
  general: { site_url: string };
  sharing: { public_links: boolean; embedding: boolean; embedding_key_set: boolean };
}

export interface Destination {
  id: number;
  name: string;
  kind: 'slack' | 'teams' | 'telegram' | 'webhook';
  config: { chat_id?: string };
  secret_hint: string;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface Usage {
  days: number;
  slow_query_sec: number;
  totals: { queries: number; people: number; errors: number | null; slow: number | null; avg_sec: number | null; logins: number; people_signed_in: number };
  per_day: { day: string; queries: number; errors: number; people: number }[];
  people: { username: string; queries: number; avg_sec: number | null; last_seen: number }[];
  questions: { id: number; name: string | null; runs: number; avg_sec: number | null; errors: number }[];
  dashboards: { id: number; name: string | null; card_runs: number; people: number }[];
  sources: { source: string; queries: number }[];
}

export interface LoggedQuery {
  id: number;
  ts: number;
  username: string;
  action: string;
  connection: string | null;
  sql: string | null;
  duration_sec: number | null;
  status: string;
  rows: number | null;
  question_id: number | null;
  question_name: string | null;
  dashboard_id: number | null;
  dashboard_name: string | null;
  source: string;
}

const keys = {
  settings: ['admin', 'settings'] as const,
  destinations: ['admin', 'destinations'] as const,
  usage: (days: number) => ['admin', 'usage', days] as const,
  log: (kind: string, days: number) => ['admin', 'query-log', kind, days] as const,
};

export const useAdminSettings = () =>
  useQuery({ queryKey: keys.settings, queryFn: async () => (await http.get<AdminSettings>('/api/admin/settings')).data });

export const useDestinations = () =>
  useQuery({ queryKey: keys.destinations, queryFn: async () => (await http.get<{ destinations: Destination[] }>('/api/admin/destinations')).data.destinations });

export const useUsage = (days: number) =>
  useQuery({ queryKey: keys.usage(days), queryFn: async () => (await http.get<Usage>('/api/admin/usage', { params: { days } })).data });

export const useQueryLog = (kind: 'slow' | 'errors', days: number) =>
  useQuery({
    queryKey: keys.log(kind, days),
    queryFn: async () => (await http.get<{ queries: LoggedQuery[]; min_sec: number }>('/api/admin/query-log', { params: { kind, days } })).data,
  });

const refresh = async () => {
  await queryClient.invalidateQueries({ queryKey: ['admin'] });
  await queryClient.invalidateQueries({ queryKey: automationKeys.all });
  await queryClient.invalidateQueries({ queryKey: shareKeys.all });
};

export const admin = {
  saveEmail: async (body: EmailSettings & { password: string | null }) => {
    await http.put('/api/admin/settings/email', body);
    await refresh();
  },
  testEmail: async (to: string) => (await http.post<{ ok: boolean; error: string | null }>('/api/admin/settings/email/test', { to })).data,
  saveGeneral: async (site_url: string) => {
    await http.put('/api/admin/settings/general', { site_url });
    await refresh();
  },
  saveSharing: async (body: { public_links: boolean; embedding: boolean }) => {
    await http.put('/api/admin/settings/sharing', body);
    await refresh();
  },
  embeddingKey: async () => (await http.get<{ key: string | null }>('/api/admin/settings/embedding-key')).data.key,
  newEmbeddingKey: async () => {
    const key = (await http.post<{ key: string }>('/api/admin/settings/embedding-key')).data.key;
    await refresh();
    return key;
  },
  saveDestination: async (id: number | null, body: { name: string; kind: string; secret: string; chat_id: string }) => {
    if (id) await http.put(`/api/admin/destinations/${id}`, body);
    else await http.post('/api/admin/destinations', body);
    await refresh();
  },
  deleteDestination: async (id: number) => {
    await http.delete(`/api/admin/destinations/${id}`);
    await refresh();
  },
  testDestination: async (id: number) => (await http.post<{ ok: boolean; error: string | null }>(`/api/admin/destinations/${id}/test`)).data,
};
