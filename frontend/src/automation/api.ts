/** Subscriptions, alerts and delivery settings API (backend/app/automation/routes.py). */
import { useQuery } from '@tanstack/react-query';
import { http } from '../api';
import { queryClient } from '../lib/queryClient';
import type { Preview, Subscription, SubscriptionBody, SubscriptionOptions, TargetType } from './types';

export const automationKeys = {
  all: ['automation'] as const,
  list: (params: Record<string, unknown>) => [...automationKeys.all, 'list', params] as const,
  one: (id: number) => [...automationKeys.all, 'one', id] as const,
  options: () => [...automationKeys.all, 'options'] as const,
  admin: () => [...automationKeys.all, 'admin'] as const,
};

// after "Send now", lists refresh until the send is done (it runs in the background)
let sentAt = 0;
const recentlySent = () => Date.now() - sentAt < 60_000;

export function useSubscriptions(params: { target_type?: TargetType; target_id?: number; all?: boolean }, enabled = true) {
  return useQuery({
    queryKey: automationKeys.list(params),
    enabled,
    refetchInterval: (q) => (q.state.data?.some((s) => s.running) || recentlySent() ? 1500 : false),
    queryFn: async () => (await http.get<{ subscriptions: Subscription[] }>('/api/subscriptions', { params })).data.subscriptions,
  });
}

export function useSubscription(id: number | null, poll = false) {
  return useQuery({
    queryKey: automationKeys.one(id ?? 0),
    enabled: id !== null,
    refetchInterval: poll ? 1500 : false,
    queryFn: async () => (await http.get<Subscription>(`/api/subscriptions/${id}`)).data,
  });
}

export function useSubscriptionOptions() {
  return useQuery({
    queryKey: automationKeys.options(),
    queryFn: async () => (await http.get<SubscriptionOptions>('/api/subscriptions/options')).data,
  });
}

const refresh = () => queryClient.invalidateQueries({ queryKey: automationKeys.all });

export const subscriptions = {
  create: async (body: SubscriptionBody) => {
    const s = (await http.post<Subscription>('/api/subscriptions', body)).data;
    await refresh();
    return s;
  },
  replace: async (id: number, body: SubscriptionBody) => {
    const s = (await http.put<Subscription>(`/api/subscriptions/${id}`, body)).data;
    await refresh();
    return s;
  },
  setEnabled: async (id: number, enabled: boolean) => {
    await http.patch(`/api/subscriptions/${id}`, { enabled });
    await refresh();
  },
  remove: async (id: number) => {
    await http.delete(`/api/subscriptions/${id}`);
    await refresh();
  },
  sendNow: async (id: number) => {
    await http.post(`/api/subscriptions/${id}/send`);
    sentAt = Date.now();
    await refresh();
  },
  unsubscribe: async (id: number) => {
    await http.post(`/api/subscriptions/${id}/unsubscribe`);
    await refresh();
  },
  preview: async (body: SubscriptionBody) => (await http.post<Preview>('/api/subscriptions/preview', body)).data,
  setMyEmail: async (email: string) => {
    const out = (await http.put<{ email: string | null }>('/api/account/email', { email })).data;
    await refresh();
    return out.email;
  },
};
