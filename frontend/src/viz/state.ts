import { suggestViz, vizFits } from './autoViz.ts';
import type { Table } from './data.ts';
import type { VizSpec } from './types.ts';

/** What a results panel shows: the table, or a chart (spec null = chosen automatically). */
export interface VizState {
  mode: 'table' | 'chart';
  spec: VizSpec | null;
}

export const DEFAULT_VIZ: VizState = { mode: 'table', spec: null };

/** The spec to draw: the saved one if it still fits the result, otherwise the automatic choice. */
export function effectiveViz(state: VizState, table: Table): { spec: VizSpec; auto: boolean; stale: boolean } {
  if (state.spec && vizFits(state.spec, table)) return { spec: state.spec, auto: false, stale: false };
  return { spec: suggestViz(table), auto: true, stale: state.spec !== null };
}
