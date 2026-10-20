/** Pure helpers for subscriptions and alerts: describing schedules, defaults, validation. */
import { lang, t } from '../i18n/index.ts';
import type { AlertCondition, Recipients, Schedule, SubscriptionBody, TargetType } from './types';

export const DAY_NAMES = [t('Monday'), t('Tuesday'), t('Wednesday'), t('Thursday'), t('Friday'), t('Saturday'), t('Sunday')];
export const DAY_SHORT = [t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), t('Sun')];
/** "Mondays" as used in "Mondays at 07:30" (Russian: "по понедельникам"). */
const DAY_PLURAL = [t('Mondays'), t('Tuesdays'), t('Wednesdays'), t('Thursdays'), t('Fridays'), t('Saturdays'), t('Sundays')];
const WEEKDAYS = [0, 1, 2, 3, 4];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const clock = (hour: number, minute: number) => `${pad2(hour)}:${pad2(minute)}`;

const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d, i) => d === b[i]);

type DayList = { kind: 'all' } | { kind: 'weekdays' } | { kind: 'weekends' } | { kind: 'some'; text: string };

function dayList(days: number[]): DayList {
  const sorted = [...days].sort((a, b) => a - b);
  if (sameDays(sorted, ALL_DAYS)) return { kind: 'all' };
  if (sameDays(sorted, WEEKDAYS)) return { kind: 'weekdays' };
  if (sameDays(sorted, [5, 6])) return { kind: 'weekends' };
  if (sorted.length === 1) return { kind: 'some', text: DAY_PLURAL[sorted[0]] };
  return { kind: 'some', text: sorted.map((d) => DAY_SHORT[d]).join(', ') };
}

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const ordinal = (n: number) => {
  if (lang() === 'ru') return `${n}-го`;
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
};

/** "Weekdays at 08:00", "Every hour at :15 on weekends", "On the last day of the month at 06:00 (Europe/Berlin)". */
export function describeSchedule(s: Schedule, localZone = browserTimeZone()): string {
  const zone = s.timezone && s.timezone !== localZone ? ` (${s.timezone})` : '';
  const time = clock(s.hour, s.minute);
  let text: string;
  if (s.every === 'hour') {
    const days = dayList(s.days);
    const minute = pad2(s.minute);
    if (days.kind === 'all') text = t('Every hour at :{minute}', { minute });
    else if (days.kind === 'weekdays') text = t('Every hour at :{minute} on weekdays', { minute });
    else if (days.kind === 'weekends') text = t('Every hour at :{minute} on weekends', { minute });
    else text = t('Every hour at :{minute} on {days}', { minute, days: days.text });
  } else if (s.every === 'month') {
    text = s.monthday === -1
      ? t('On the last day of every month at {time}', { time })
      : t('On the {day} of every month at {time}', { day: ordinal(s.monthday), time });
  } else {
    const days = dayList(s.days);
    if (days.kind === 'all') text = t('Every day at {time}', { time });
    else if (days.kind === 'weekdays') text = t('Weekdays at {time}', { time });
    else if (days.kind === 'weekends') text = t('Weekends at {time}', { time });
    else text = capitalize(t('{days} at {time}', { days: days.text, time }));
  }
  return text + zone;
}

export function defaultSchedule(): Schedule {
  return { every: 'day', hour: 8, minute: 0, days: WEEKDAYS, monthday: 1, timezone: browserTimeZone() };
}

/** Switching the frequency keeps sensible days: a weekly schedule starts on Monday. */
export function changeEvery(s: Schedule, every: Schedule['every']): Schedule {
  if (every === 'week') return { ...s, every, days: s.days.length === 1 ? s.days : [0] };
  if ((every === 'day' || every === 'hour') && s.every === 'week') return { ...s, every, days: every === 'hour' ? ALL_DAYS : WEEKDAYS };
  return { ...s, every };
}

export function emptyRecipients(): Recipients {
  return { users: [], emails: [], destinations: [] };
}

export function newSubscription(target_type: TargetType, target_id: number, me: string | null, alert = false): SubscriptionBody {
  return {
    name: '',
    target_type,
    target_id,
    schedule: alert ? { ...defaultSchedule(), every: 'hour', minute: 0, days: ALL_DAYS } : defaultSchedule(),
    recipients: { ...emptyRecipients(), users: me ? [me] : [] },
    options: { filters: {}, attach: 'none', rows: 10, skip_empty: false, message: '' },
    alert: alert ? { type: 'rows', column: null, value: null, once: false } : null,
    enabled: true,
  };
}

export function describeAlert(a: AlertCondition): string {
  const once = a.once ? t(', then stop') : '';
  if (a.type === 'rows') return t('When there are results') + once;
  const value = a.value ?? '?';
  const column = a.column;
  let text: string;
  if (a.type === 'above') text = column ? t('When {column} goes above {value}', { column, value }) : t('When goes above {value}', { value });
  else text = column ? t('When {column} drops below {value}', { column, value }) : t('When drops below {value}', { value });
  return text + once;
}

export function recipientCount(r: Recipients): number {
  return r.users.length + r.emails.length + r.destinations.length;
}

/** Splits what someone typed into addresses: commas, semicolons, spaces and new lines all separate. */
export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const parts = text.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) (/^[^@\s<>,;"']+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(p) ? valid : invalid).push(p);
  return { valid: [...new Set(valid)], invalid };
}

export function domainAllowed(email: string, domains: string[]): boolean {
  if (!domains.length) return true;
  return domains.includes(email.split('@').pop()!.toLowerCase());
}

/** Why the form cannot be saved yet, or null. */
export function problem(body: SubscriptionBody): string | null {
  if (recipientCount(body.recipients) === 0) return t('Add at least one recipient');
  if ((body.schedule.every === 'day' || body.schedule.every === 'week' || body.schedule.every === 'hour') && !body.schedule.days.length)
    return t('Choose at least one day');
  if (body.alert && body.alert.type !== 'rows' && (body.alert.value === null || Number.isNaN(body.alert.value)))
    return t('Give the value to compare with');
  return null;
}

export function timeAgo(ts: number | null, now = Date.now() / 1000): string {
  if (!ts) return t('never');
  const d = now - ts;
  const future = d < 0;
  const a = Math.abs(d);
  if (a < 60) return future ? t('in a moment') : t('just now');
  if (a < 3600) {
    const n = Math.round(a / 60);
    return future ? t('in {n} min', { n }) : t('{n} min ago', { n });
  }
  if (a < 86400) {
    const n = Math.round(a / 3600);
    return future ? t('in {n} h', { n }) : t('{n} h ago', { n });
  }
  const n = Math.round(a / 86400);
  return future ? t('in {n} days', { n }) : t('{n} days ago', { n });
}

export const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  running: { label: t('sending…'), color: 'blue' },
  sent: { label: t('sent'), color: 'green' },
  skipped: { label: t('not sent'), color: 'gray' },
  partial: { label: t('partly sent'), color: 'orange' },
  error: { label: t('failed'), color: 'red' },
};
