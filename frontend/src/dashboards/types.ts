/** Dashboards (mirrors backend/app/content/dashboards.py and dashboard_routes.py). */
import type { ParameterDef } from '../library/params.ts';
import type { VizState } from '../viz/state.ts';
import { t } from '../i18n/index.ts';

export type FilterType = 'date_range' | 'date' | 'text' | 'category' | 'number';

export interface DashFilter {
  id: string;
  label: string;
  type: FilterType;
  default?: unknown;
  required?: boolean;
}

export interface Tab {
  id: string;
  name: string;
}

export interface CardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Mapping {
  param?: string;
  field?: string;
}

export interface CardQuestion {
  state: 'ok' | 'archived' | 'hidden' | 'deleted';
  id?: number;
  name?: string;
  kind?: 'builder' | 'sql' | 'federated';
  connection?: string;
  parameters?: ParameterDef[];
  viz?: VizState | null;
  tables?: string[];
  fields?: { name: string; type: string }[]; // multi-source questions: the combined columns
}

export interface DashCard {
  key: string;
  kind: 'question' | 'text' | 'heading';
  question_id?: number | null;
  tab?: string | null;
  layout: CardLayout;
  viz?: VizState | null; // overrides the question's chart on this dashboard
  title?: string | null;
  text?: string | null;
  mappings?: Record<string, Mapping>;
  question?: CardQuestion; // from the server, not saved
}

export interface DashboardSettings {
  refresh?: 0 | 30 | 60 | 300 | 900;
}

export interface Definition {
  filters: DashFilter[];
  tabs: Tab[];
  cards: DashCard[];
  settings: DashboardSettings;
}

export interface DashboardSummary {
  id: number;
  name: string;
  description: string | null;
  collection_id: number;
  collection: { id: number; name: string } | null;
  owner: string | null;
  archived: boolean;
  favorite: boolean;
  access: 'view' | 'edit' | null;
  imported: boolean;
  created_at: number;
  updated_at: number;
  updated_by: string | null;
}

export interface Dashboard extends DashboardSummary, Definition {
  path: { id: number; name: string }[];
}

export const FILTER_TYPES: { type: FilterType; label: string }[] = [
  { type: 'date_range', label: t('Date range') },
  { type: 'date', label: t('Single date') },
  { type: 'category', label: t('List of values') },
  { type: 'text', label: t('Text (contains)') },
  { type: 'number', label: t('Number') },
];

export const REFRESH_CHOICES: { value: NonNullable<DashboardSettings['refresh']>; label: string }[] = [
  { value: 0, label: t('Off') },
  { value: 30, label: t('30 s') },
  { value: 60, label: t('1 min') },
  { value: 300, label: t('5 min') },
  { value: 900, label: t('15 min') },
];
