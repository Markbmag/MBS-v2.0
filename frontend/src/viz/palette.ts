/**
 * Chart colours (validated with the dataviz palette validator against Ncode's own
 * panel colours: light #ffffff, dark #131b30; all checks pass, light-mode contrast
 * relief = every chart has a table view one click away).
 *
 * The order is part of the colour-blind safety: slots are assigned in this order,
 * never cycled. More than 8 series fold into "Other".
 */
import { t } from '../i18n/index.ts';

export type Mode = 'light' | 'dark';

export const CATEGORICAL: Record<Mode, string[]> = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

export const MAX_SERIES = 8;
export const MAX_SCATTER_SERIES = 3; // every pair must stay distinguishable
export const MAX_PIE_SLICES = 6;

/** One-hue blue ramp, light -> dark (steps 100..700). */
export const SEQUENTIAL = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];

export interface ChartTheme {
  mode: Mode;
  surface: string;
  text: string;
  textSecondary: string;
  muted: string;
  grid: string;
  axis: string;
  series: string[];
  deemphasis: string;
  good: string;
  bad: string;
  heat: string[];   // sequential, "near zero" end recedes toward the surface
  ordinal: string[]; // funnel stages, largest first; the step nearest the surface keeps >= 2:1
  track: string;    // gauge track: a lighter step of the fill's ramp
  font: string;
}

const FONT = "'Inter', 'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif";

export function chartTheme(mode: Mode): ChartTheme {
  if (mode === 'dark') {
    return {
      mode,
      surface: '#131b30',
      text: '#e6e9f5',
      textSecondary: '#9aa3c2',
      muted: '#6b7494',
      grid: 'rgba(255,255,255,0.08)',
      axis: 'rgba(255,255,255,0.18)',
      series: CATEGORICAL.dark,
      deemphasis: '#4a5272',
      good: '#0ca30c',
      bad: '#e66767',
      heat: [...SEQUENTIAL].reverse().slice(1, 11), // dark: low = dark blue near the surface
      ordinal: ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95'],
      track: '#184f95',
      font: FONT,
    };
  }
  return {
    mode,
    surface: '#ffffff',
    text: '#1b2036',
    textSecondary: '#5b6280',
    muted: '#8a91ad',
    grid: '#e9eaf2',
    axis: '#c9ccdc',
    series: CATEGORICAL.light,
    deemphasis: '#c3c6d6',
    good: '#006300',
    bad: '#d03b3b',
    heat: SEQUENTIAL,
    ordinal: ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef'],
    track: '#cde2fb',
    font: FONT,
  };
}

/** Colour of a series: a saved slot for this entity, else the next free slot in order. */
export function assignColors(names: string[], saved: Record<string, number> | undefined, theme: ChartTheme): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<number>();
  for (const name of names) {
    const slot = saved?.[name];
    if (slot !== undefined && slot >= 0 && slot < theme.series.length) {
      out[name] = theme.series[slot];
      used.add(slot);
    }
  }
  let next = 0;
  for (const name of names) {
    if (out[name]) continue;
    if (name === OTHER) {
      out[name] = theme.deemphasis;
      continue;
    }
    while (used.has(next) && next < theme.series.length) next++;
    out[name] = theme.series[next % theme.series.length];
    used.add(next);
  }
  return out;
}

export const OTHER = t('Other');
