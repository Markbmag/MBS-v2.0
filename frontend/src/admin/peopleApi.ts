/** Users, groups, row-level rules, audit, backups (backend/app/admin_routes.py, app/ops_routes.py). */
import { useQuery } from '@tanstack/react-query';
import { http } from '../api';
import { queryClient } from '../lib/queryClient';

export interface AdminUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
  is_active: boolean;
  email: string | null;
  connections: '*' | string[];
  groups: string[];
  effective_connections: string[];
  row_rules: number;
  last_login_at: number | null;
}

export interface Group {
  id: number;
  name: string;
  description: string | null;
  connections: string; // "*", "" or "a,b"
  members: string[];
  row_rules: number;
  created_at: number;
}

export interface RowRule {
  id: number;
  group_id: number;
  group: string | null;
  connection: string;
  table: string;
  column: string;
  values: string[];
}

export interface AuditEntry {
  id: number;
  ts: number;
  username: string | null;
  action: string;
  connection: string | null;
  phrase: string | null;
  status: string | null;
  found: number | null;
  error_count: number | null;
  duration_sec: number | null;
  options: string;
}

export interface AuditFilters {
  user?: string;
  action?: string;
  q?: string;
  since?: number;
  until?: number;
}

export interface Backup {
  name: string;
  size: number;
  created_at: number;
  auto: boolean;
}

export const peopleKeys = {
  users: ['admin', 'users'] as const,
  groups: ['admin', 'groups'] as const,
  rules: ['admin', 'row-rules'] as const,
  audit: (f: AuditFilters, page: number) => ['admin', 'audit', f, page] as const,
  backups: ['admin', 'backups'] as const,
  ready: ['admin', 'ready'] as const,
};

export const useAdminUsers = () => useQuery({ queryKey: peopleKeys.users, queryFn: async () => (await http.get<{ users: AdminUser[] }>('/api/admin/users')).data.users });
export const useGroups = () => useQuery({ queryKey: peopleKeys.groups, queryFn: async () => (await http.get<{ groups: Group[] }>('/api/admin/groups')).data.groups });
export const useRowRules = () => useQuery({ queryKey: peopleKeys.rules, queryFn: async () => (await http.get<{ rules: RowRule[] }>('/api/admin/row-rules')).data.rules });

export const PAGE = 50;
export const useAudit = (filters: AuditFilters, page: number) =>
  useQuery({
    queryKey: peopleKeys.audit(filters, page),
    placeholderData: (prev) => prev,
    queryFn: async () =>
      (await http.get<{ entries: AuditEntry[]; total: number; actions: string[]; users: string[] }>('/api/admin/audit', {
        params: { ...filters, limit: PAGE, offset: page * PAGE },
      })).data,
  });

export const useBackups = () =>
  useQuery({ queryKey: peopleKeys.backups, queryFn: async () => (await http.get<{ backups: Backup[]; folder: string; disk_free: number }>('/api/admin/backups')).data });

export const useReady = () =>
  useQuery({
    queryKey: peopleKeys.ready,
    refetchInterval: 30_000,
    queryFn: async () => (await http.get<{ status: string; checks: Record<string, unknown>; uptime_sec: number }>('/api/health/ready', { validateStatus: () => true })).data,
  });

const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

export const people = {
  createUser: async (body: { username: string; password: string; role: string; email: string | null; connections: '*' | string[]; groups: string[] }) => {
    await http.post('/api/admin/users', body);
    await refresh();
  },
  updateUser: async (name: string, body: Partial<{ role: string; is_active: boolean; email: string | null; connections: '*' | string[]; groups: string[]; password: string }>) => {
    await http.patch(`/api/admin/users/${encodeURIComponent(name)}`, body);
    await refresh();
  },
  deleteUser: async (name: string) => {
    await http.delete(`/api/admin/users/${encodeURIComponent(name)}`);
    await refresh();
  },
  saveGroup: async (id: number | null, body: { name: string; description: string | null; connections: '*' | string[]; members: string[] }) => {
    if (id) await http.put(`/api/admin/groups/${id}`, body);
    else await http.post('/api/admin/groups', body);
    await refresh();
  },
  deleteGroup: async (id: number) => {
    await http.delete(`/api/admin/groups/${id}`);
    await refresh();
  },
  addRule: async (body: { group_id: number; connection: string; table: string; column: string; values: string[] }) => {
    await http.post('/api/admin/row-rules', body);
    await refresh();
  },
  deleteRule: async (id: number) => {
    await http.delete(`/api/admin/row-rules/${id}`);
    await refresh();
  },
  backupNow: async () => {
    await http.post('/api/admin/backups');
    await refresh();
  },
  deleteBackup: async (name: string) => {
    await http.delete(`/api/admin/backups/${encodeURIComponent(name)}`);
    await refresh();
  },
};

/** "*" | "" | "a,b" from the server, as the editor's value. */
export const connectionsValue = (raw: string | string[]): '*' | string[] =>
  raw === '*' ? '*' : Array.isArray(raw) ? raw : raw.split(',').map((s) => s.trim()).filter(Boolean);
