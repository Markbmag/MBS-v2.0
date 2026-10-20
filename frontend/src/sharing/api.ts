/** Public links and embedding (backend/app/sharing/routes.py). */
import { useQuery } from '@tanstack/react-query';
import { http } from '../api';
import { queryClient } from '../lib/queryClient';
import type { TargetType } from '../automation/types';

export type ParamMode = 'locked' | 'editable' | 'disabled';

export interface ShareLink {
  id: number;
  kind: 'public' | 'embed';
  target_type: TargetType;
  target_id: number;
  target_name: string | null;
  token: string | null;
  path: string | null;
  url: string | null;
  expires_at: number | null;
  has_password: boolean;
  allow_download: boolean;
  params: Record<string, ParamMode> | null;
  created_by: string | null;
  created_at: number;
  revoked_at: number | null;
  last_used_at: number | null;
  views: number;
  active: boolean;
}

export interface ItemSharing {
  public_links: ShareLink[];
  embed: ShareLink | null;
  settings: { public_links: boolean; embedding: boolean; embedding_key_set: boolean; site_url: string };
}

export const shareKeys = {
  all: ['sharing'] as const,
  item: (t: TargetType, id: number) => [...shareKeys.all, t, id] as const,
  links: () => [...shareKeys.all, 'links'] as const,
};

export function useItemSharing(target_type: TargetType, target_id: number, enabled: boolean) {
  return useQuery({
    queryKey: shareKeys.item(target_type, target_id),
    enabled,
    queryFn: async () => (await http.get<ItemSharing>('/api/share', { params: { target_type, target_id } })).data,
  });
}

export function useAllLinks(enabled = true) {
  return useQuery({
    queryKey: shareKeys.links(),
    enabled,
    queryFn: async () => (await http.get<{ links: ShareLink[] }>('/api/admin/share')).data.links,
  });
}

const refresh = () => queryClient.invalidateQueries({ queryKey: shareKeys.all });

export const sharing = {
  createPublic: async (body: { target_type: TargetType; target_id: number; expires_at: number | null; password: string | null; allow_download: boolean }) => {
    const link = (await http.post<ShareLink>('/api/share/public', body)).data;
    await refresh();
    return link;
  },
  updatePublic: async (id: number, body: { expires_at?: number | null; clear_expiry?: boolean; password?: string; allow_download?: boolean }) => {
    await http.patch(`/api/share/public/${id}`, body);
    await refresh();
  },
  revoke: async (id: number) => {
    await http.delete(`/api/share/public/${id}`);
    await refresh();
  },
  setEmbed: async (body: { target_type: TargetType; target_id: number; enabled: boolean; params: Record<string, ParamMode> }) => {
    await http.put('/api/share/embed', body);
    await refresh();
  },
  previewToken: async (body: { target_type: TargetType; target_id: number; params: Record<string, unknown> }) =>
    (await http.post<{ token: string; path: string }>('/api/share/embed/token', body)).data,
};

/** The address to hand out: the configured site address, else the one this browser uses. */
export function absolute(path: string, siteUrl: string): string {
  const base = siteUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base.replace(/\/$/, '')}${path}`;
}

/** The snippet a website uses to sign an embedding token (Python and Node). */
export function embedSnippet(lang: 'python' | 'node', target: TargetType, id: number, locked: string[], siteUrl: string): string {
  const params = locked.length ? locked.map((p) => `"${p}": "…"`).join(', ') : '';
  const site = siteUrl || '<your Ncode address>';
  if (lang === 'python')
    return [
      '# pip install pyjwt',
      'import time, jwt',
      'NCODE_EMBEDDING_KEY = "…"  # Admin → Sharing; keep it on your server',
      `payload = {"resource": {"${target}": ${id}}, "params": {${params}}, "exp": int(time.time()) + 10 * 60}`,
      'token = jwt.encode(payload, NCODE_EMBEDDING_KEY, algorithm="HS256")',
      `iframe_url = f"${site}/embed/{token}#titled=true&bordered=true"`,
    ].join('\n');
  return [
    '// npm install jsonwebtoken',
    "const jwt = require('jsonwebtoken');",
    "const NCODE_EMBEDDING_KEY = '…'; // Admin → Sharing; keep it on your server",
    `const payload = { resource: { ${target}: ${id} }, params: { ${params.replace(/"/g, '')} }, exp: Math.round(Date.now() / 1000) + 10 * 60 };`,
    "const token = jwt.sign(payload, NCODE_EMBEDDING_KEY, { algorithm: 'HS256' });",
    `const iframeUrl = \`${site}/embed/\${token}#titled=true&bordered=true\`;`,
  ].join('\n');
}
