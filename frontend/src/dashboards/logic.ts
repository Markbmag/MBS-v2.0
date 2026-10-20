/**
 * Dashboard helpers without React: filter values (and the URL), card placement, which
 * filters a card can use, the definition that is saved, a tiny Markdown parser and the
 * queue that keeps card runs under the server's per-user limit.
 * Unit-tested in tests/dashboards.test.ts.
 */
import type { ParameterDef } from '../library/params.ts';
import type { CardLayout, CardQuestion, DashCard, DashFilter, Definition, FilterType, Mapping, Tab } from './types.ts';
import { t } from '../i18n/index.ts';

export const GRID_COLS = 12;

// ---------------------------------------------------------------- filter values

/** What a filter holds: one text, or several (category, date range). */
export type FilterValue = string | string[];
export type FilterValues = Record<string, FilterValue>;

const blank = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.every(blank));

export const isMulti = (type: FilterType) => type === 'category' || type === 'date_range';

/** The values sent with a card run: what was chosen, else nothing (the server applies defaults). */
export function runValues(filters: DashFilter[], values: FilterValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of filters) {
    const v = values[f.id];
    if (blank(v)) continue;
    if (f.type === 'date_range') out[f.id] = Array.isArray(v) ? [v[0] ?? '', v[1] ?? ''] : [v, ''];
    else if (f.type === 'category') out[f.id] = (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean);
    else out[f.id] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

/** The value a filter shows: chosen, else its default. */
export function shownValue(f: DashFilter, values: FilterValues): FilterValue {
  const v = values[f.id];
  if (!blank(v)) return v;
  const d = f.default;
  if (blank(d)) return isMulti(f.type) ? [] : '';
  return Array.isArray(d) ? d.map(String) : String(d);
}

export function valuesFromSearch(search: URLSearchParams): FilterValues {
  const out: FilterValues = {};
  for (const key of new Set(search.keys())) {
    if (!key.startsWith('f.')) continue;
    const all = search.getAll(key);
    out[key.slice(2)] = all.length > 1 ? all : all[0];
  }
  return out;
}

export function valuesToSearch(values: FilterValues, search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  for (const [k, v] of search) if (!k.startsWith('f.')) next.append(k, v);
  for (const [id, value] of Object.entries(values)) {
    if (blank(value)) continue;
    // a date range keeps both positions (an open start is an empty first entry)
    for (const v of Array.isArray(value) ? value : [value]) next.append(`f.${id}`, v);
  }
  return next;
}

// ---------------------------------------------------------------- cards and layout

export function newKey(prefix: string, taken: string[]): string {
  let n = taken.length + 1;
  while (taken.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export const cardsOnTab = (def: Pick<Definition, 'cards' | 'tabs'>, tab: string | null): DashCard[] =>
  def.tabs.length === 0 ? def.cards : def.cards.filter((c) => c.tab === tab);

/** Where a new card goes: the first free spot, left to right and top to bottom (like reading). */
export function placeNew(cards: DashCard[], w: number, h: number): CardLayout {
  w = Math.min(w, GRID_COLS);
  const bottom = cards.reduce((max, c) => Math.max(max, c.layout.y + c.layout.h), 0);
  const free = (x: number, y: number) =>
    cards.every((c) => x + w <= c.layout.x || c.layout.x + c.layout.w <= x || y + h <= c.layout.y || c.layout.y + c.layout.h <= y);
  for (let y = 0; y <= bottom; y++) for (let x = 0; x + w <= GRID_COLS; x++) if (free(x, y)) return { x, y, w, h };
  return { x: 0, y: bottom, w, h };
}

export const DEFAULT_SIZE: Record<DashCard['kind'], { w: number; h: number }> = {
  question: { w: 6, h: 8 },
  text: { w: 6, h: 3 },
  heading: { w: 12, h: 1 },
};

/** Apply positions from the grid to the cards of one tab. */
export function applyLayout(cards: DashCard[], layout: { i: string; x: number; y: number; w: number; h: number }[]): DashCard[] {
  const byKey = new Map(layout.map((l) => [l.i, l]));
  let changed = false;
  const out = cards.map((c) => {
    const l = byKey.get(c.key);
    if (!l || (l.x === c.layout.x && l.y === c.layout.y && l.w === c.layout.w && l.h === c.layout.h)) return c;
    changed = true;
    return { ...c, layout: { x: l.x, y: l.y, w: l.w, h: l.h } };
  });
  return changed ? out : cards;
}

/** What is saved: the server's extra card fields ("question") are left out. */
export function toDefinition(def: Definition): Definition {
  return {
    filters: def.filters.map((f) => ({ id: f.id, label: f.label, type: f.type, default: blank(f.default) ? null : f.default, required: !!f.required })),
    tabs: def.tabs,
    settings: def.settings,
    cards: def.cards.map((c) => {
      const out: DashCard = { key: c.key, kind: c.kind, layout: c.layout, tab: def.tabs.length ? (c.tab ?? def.tabs[0].id) : null };
      if (c.kind === 'question') {
        out.question_id = c.question_id ?? null;
        const mappings = Object.fromEntries(Object.entries(c.mappings ?? {}).filter(([fid]) => def.filters.some((f) => f.id === fid)));
        if (Object.keys(mappings).length) out.mappings = mappings;
        if (c.viz) out.viz = c.viz;
      } else {
        out.text = c.text ?? '';
      }
      if (c.title) out.title = c.title;
      return out;
    }),
  };
}

/** Adding the first tab puts every card on it; removing a tab moves its cards to the first remaining one. */
export function addTab(def: Definition, name: string): Definition {
  const id = newKey('t', def.tabs.map((t) => t.id));
  if (def.tabs.length === 0) {
    const first: Tab = { id: newKey('t', [id]), name: t('Overview') };
    return { ...def, tabs: [first, { id, name }], cards: def.cards.map((c) => ({ ...c, tab: first.id })) };
  }
  return { ...def, tabs: [...def.tabs, { id, name }] };
}

export function removeTab(def: Definition, id: string): Definition {
  const tabs = def.tabs.filter((t) => t.id !== id);
  if (tabs.length <= 1) return { ...def, tabs: [], cards: def.cards.map((c) => ({ ...c, tab: null })) };
  const target = tabs[0].id;
  const bottom = def.cards.filter((c) => c.tab === target).reduce((m, c) => Math.max(m, c.layout.y + c.layout.h), 0);
  return {
    ...def,
    tabs,
    cards: def.cards.map((c) => (c.tab === id ? { ...c, tab: target, layout: { ...c.layout, y: c.layout.y + bottom } } : c)),
  };
}

// ---------------------------------------------------------------- filters on cards

const PARAM_TYPE: Record<FilterType, ParameterDef['type'][]> = {
  date_range: ['date'],
  date: ['date'],
  number: ['number'],
  text: ['text'],
  category: ['text', 'number'],
};

/** Parameters of the card's question that a filter of this type fits. */
export function fittingParams(type: FilterType, question: CardQuestion | undefined): ParameterDef[] {
  return (question?.parameters ?? []).filter((p) => PARAM_TYPE[type].includes(p.type));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A sensible first mapping for a new filter: a parameter with the same name. */
export function suggestMapping(filter: DashFilter, question: CardQuestion | undefined): Mapping | null {
  if (!question || question.state === 'hidden' || question.state === 'deleted') return null;
  const names = [norm(filter.id), norm(filter.label)];
  const param = fittingParams(filter.type, question).find((p) => names.includes(norm(p.name)) || names.includes(norm(p.label ?? '')));
  return param ? { param: param.name } : null;
}

export function filterId(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'filter';
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Filters that change what a card shows (used for "filtered by" hints). */
export const activeMappings = (card: DashCard, filters: DashFilter[], values: FilterValues): DashFilter[] =>
  filters.filter((f) => card.mappings?.[f.id] && !blank(shownValue(f, values)));

/** Parameter values to open a card's question with, from the filters mapped to parameters. */
export function editorParams(card: DashCard, filters: DashFilter[], values: FilterValues): URLSearchParams {
  const search = new URLSearchParams();
  for (const f of filters) {
    const m = card.mappings?.[f.id];
    if (!m?.param) continue;
    const v = shownValue(f, values);
    if (blank(v)) continue;
    for (const item of Array.isArray(v) ? v : [v]) search.append(`p.${m.param}`, item);
  }
  return search;
}

// ---------------------------------------------------------------- markdown (a safe subset)

export type Inline = { t: 'text' | 'b' | 'i' | 'code'; v: string } | { t: 'link'; v: string; href: string };
export type Block = { t: 'h'; level: 1 | 2 | 3; v: Inline[] } | { t: 'p'; v: Inline[] } | { t: 'ul' | 'ol'; items: Inline[][] };

const SAFE_URL = /^(https?:\/\/|mailto:|\/)/i;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ t: 'b', v: m[2] });
    else if (m[3] !== undefined) out.push({ t: 'i', v: m[3] });
    else if (m[4] !== undefined) out.push({ t: 'code', v: m[4] });
    else if (SAFE_URL.test(m[6])) out.push({ t: 'link', v: m[5], href: m[6] });
    else out.push({ t: 'text', v: m[5] }); // javascript: and friends become plain text
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; items: Inline[][] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', v: parseInline(para.join(' ')) });
    para = [];
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (heading) {
      flush();
      blocks.push({ t: 'h', level: heading[1].length as 1 | 2 | 3, v: parseInline(heading[2]) });
    } else if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (para.length || (list && list.t !== kind)) flush();
      list ??= { t: kind, items: [] };
      list.items.push(parseInline((bullet ?? numbered)![1]));
    } else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}

// ---------------------------------------------------------------- run queue

/** At most `limit` card runs at once; the others wait their turn (in order). */
export class RunQueue {
  private running = 0;
  private waiting: (() => void)[] = [];
  limit: number;

  constructor(limit: number) {
    this.limit = Math.max(1, limit);
  }

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const start = () => {
        this.running++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.running--;
          this.waiting.shift()?.();
        });
      };
      if (this.running < this.limit) start();
      else this.waiting.push(start);
    });
  }

  get active(): number {
    return this.running;
  }

  get queued(): number {
    return this.waiting.length;
  }
}
