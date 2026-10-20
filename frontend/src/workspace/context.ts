import { createContext } from 'react';
import type { Connection, EngineOption, Limits, MatchMode, TableInfo, User } from '../api';
import type { SearchState } from '../hooks/useSearch';
import type { ExplorerTarget } from '../lib/explorer';

export interface Prefs {
  matchMode: MatchMode;
  caseSensitive: boolean;
  includeNumbers: boolean;
  rowLimit: number;
}

export interface Scope {
  tables: string[]; // exact names; empty = every table
  exclude: string; // comma-separated glob patterns
}

/**
 * Everything the pages share. It lives above the router outlet, so a running or
 * finished search survives a trip to Browse and back, as it did before routing.
 */
export interface WorkspaceValue {
  user: User;
  isAdmin: boolean;
  onLogout: () => void;

  connections: Connection[];
  loaded: boolean;
  activeKey: string;
  active: Connection | undefined;
  selectConnection: (key: string) => void;
  engines: EngineOption[];
  limits: Limits;

  tables: TableInfo[] | null;
  tablesError: string | null;
  reloadTables: () => void;

  openAddConnection: () => void;
  openEditConnection: (key: string) => void;

  search: SearchState;
  startSearch: () => void;
  cancelSearch: () => void;
  searchCount: number;
  phrase: string;
  setPhrase: (value: string) => void;
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  scope: Scope;
  applyScope: (tables: string[], exclude: string) => void;
  excludePatterns: string[];

  explorerTarget: ExplorerTarget;
  openInExplorer: (table: string) => void;
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);
