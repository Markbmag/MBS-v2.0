import type { MatchMode } from '../api';

/** What the table explorer should open: a table and, optionally, a filter coming from a search. */
export interface ExplorerTarget {
  table: string | null;
  q: string;
  mode: MatchMode;
  caseSensitive: boolean;
  includeNumbers: boolean;
  nonce: number; // changes every time the explorer is opened from elsewhere
}

export const EMPTY_TARGET: ExplorerTarget = {
  table: null,
  q: '',
  mode: 'contains',
  caseSensitive: false,
  includeNumbers: false,
  nonce: 0,
};
