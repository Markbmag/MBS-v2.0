/** Subscriptions and alerts (backend/app/automation). */

export type Every = 'hour' | 'day' | 'week' | 'month';

export interface Schedule {
  every: Every;
  minute: number;
  hour: number;
  days: number[]; // 0 = Monday ... 6 = Sunday
  monthday: number; // 1-28, -1 = the last day
  timezone: string;
}

export interface Recipients {
  users: string[];
  emails: string[];
  destinations: number[];
}

export interface SubOptions {
  filters: Record<string, unknown>;
  attach: 'none' | 'csv' | 'xlsx';
  rows: number;
  skip_empty: boolean;
  message: string;
}

export interface AlertCondition {
  type: 'rows' | 'above' | 'below';
  column: string | null;
  value: number | null;
  once: boolean;
}

export type TargetType = 'dashboard' | 'question';

export interface SubscriptionBody {
  name: string;
  target_type: TargetType;
  target_id: number;
  schedule: Schedule;
  recipients: Recipients;
  options: SubOptions;
  alert: AlertCondition | null;
  enabled: boolean;
}

export type RunStatus = 'running' | 'sent' | 'skipped' | 'partial' | 'error';

export interface SubscriptionRun {
  id: number;
  trigger: 'schedule' | 'manual';
  started_at: number;
  finished_at: number | null;
  status: RunStatus;
  detail: {
    cards?: { title: string; rows: number | null; error: string | null }[];
    channels?: { channel: string; status: string }[];
    condition?: string;
    reason?: string;
    error?: string;
  } | null;
}

export interface Subscription extends SubscriptionBody {
  id: number;
  target_name: string | null;
  owner: string | null;
  can_manage: boolean;
  next_run_at: number | null;
  last_run_at: number | null;
  last_status: RunStatus | null;
  last_error: string | null;
  running: boolean;
  created_at: number;
  updated_at: number;
  runs?: SubscriptionRun[];
}

export interface DestinationRef {
  id: number;
  name: string;
  kind: 'slack' | 'teams' | 'telegram' | 'webhook';
}

export interface SubscriptionOptions {
  email_configured: boolean;
  allowed_domains: string[];
  site_url: string;
  my_email: string | null;
  destinations: DestinationRef[];
  people: { username: string; has_email: boolean }[];
  scheduler: boolean;
}

export interface Preview {
  html: string;
  text: string;
  alert: { met: boolean; note: string } | null;
  empty: boolean;
  cards: { title: string; rows: number | null; error: string | null }[];
}
