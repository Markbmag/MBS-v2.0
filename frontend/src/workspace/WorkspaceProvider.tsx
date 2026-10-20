import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useDisclosure, useToast } from '@chakra-ui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiErrorMessage, http } from '../api';
import type { Connection, ConnectionDetails, EngineOption, Limits, TableInfo, User } from '../api';
import { ConnectionModal } from '../components/ConnectionModal';
import { useSearch } from '../hooks/useSearch';
import { EMPTY_TARGET } from '../lib/explorer';
import type { ExplorerTarget } from '../lib/explorer';
import { queryKeys } from '../lib/queryClient';
import { loadJson, saveJson } from '../lib/storage';
import { WorkspaceContext } from './context';
import type { Prefs, Scope, WorkspaceValue } from './context';
import { t } from '../i18n/index.ts';

const DEFAULT_PREFS: Prefs = { matchMode: 'contains', caseSensitive: false, includeNumbers: false, rowLimit: 25 };
const EMPTY_SCOPE: Scope = { tables: [], exclude: '' };
const DEFAULT_LIMITS: Limits = { max_row_limit: 200, max_export_rows: 50000 };
const NO_CONNECTIONS: Connection[] = [];
const NO_ENGINES: EngineOption[] = [];

const splitPatterns = (text: string): string[] =>
  text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

interface WorkspaceProviderProps {
  user: User;
  onLogout: () => void;
  children: ReactNode;
}

export function WorkspaceProvider({ user, onLogout, children }: WorkspaceProviderProps) {
  const isAdmin = user.role === 'admin';
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ---------------------------------------------------------------- server state
  const connectionsQuery = useQuery({
    queryKey: queryKeys.connections,
    queryFn: async () => (await http.get<Connection[]>('/api/connections')).data,
  });
  const enginesQuery = useQuery({
    queryKey: queryKeys.engines,
    queryFn: async () => (await http.get<EngineOption[]>('/api/engines')).data,
  });
  const limitsQuery = useQuery({
    queryKey: queryKeys.limits,
    queryFn: async () => (await http.get<Limits>('/api/limits')).data,
  });
  const connections = connectionsQuery.data ?? NO_CONNECTIONS;
  const loaded = !connectionsQuery.isPending;

  useEffect(() => {
    if (connectionsQuery.isError) {
      toast({ title: t('Could not load your databases'), description: apiErrorMessage(connectionsQuery.error, ''), status: 'error' });
    }
  }, [connectionsQuery.isError, connectionsQuery.error, toast]);

  // ---------------------------------------------------------------- local preferences
  const [storedKey, setStoredKey] = useState<string>(() => loadJson<string>('ncode_active', ''));
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...loadJson<Partial<Prefs>>('ncode_prefs', {}) }));
  const [scopes, setScopes] = useState<Record<string, Scope>>(() => loadJson<Record<string, Scope>>('ncode_scopes', {}));
  const [phrase, setPhrase] = useState('');
  const [searchCount, setSearchCount] = useState(0);
  const [explorerTarget, setExplorerTarget] = useState<ExplorerTarget>(EMPTY_TARGET);
  const [editKey, setEditKey] = useState<string | null>(null);
  const connectionModal = useDisclosure();
  const { state: search, start, cancel, reset } = useSearch(onLogout);

  // The remembered database, or the first one when it is gone / not allowed any more.
  const activeKey = connections.some((c) => c.key === storedKey) ? storedKey : (connections[0]?.key ?? '');
  const active = connections.find((c) => c.key === activeKey);

  const connectionsOk = connectionsQuery.isSuccess;
  useEffect(() => {
    if (connectionsOk) saveJson('ncode_active', activeKey); // not after a failed load: keep the remembered one
  }, [activeKey, connectionsOk]);
  useEffect(() => saveJson('ncode_prefs', prefs), [prefs]);
  useEffect(() => saveJson('ncode_scopes', scopes), [scopes]);

  // ---------------------------------------------------------------- tables of the active database
  const tablesQuery = useQuery({
    queryKey: queryKeys.tables(activeKey),
    queryFn: async () => (await http.get<{ tables: TableInfo[] }>(`/api/connections/${activeKey}/tables`)).data.tables,
    enabled: activeKey !== '',
    staleTime: Infinity, // the server caches the schema; "reload" asks again explicitly
  });
  const tables = tablesQuery.data ?? null;
  const tablesError = tablesQuery.isError ? apiErrorMessage(tablesQuery.error, t('Could not read the database structure')) : null;

  const forgetTables = useCallback(
    (key: string) => {
      void queryClient.resetQueries({ queryKey: queryKeys.tables(key) });
      queryClient.removeQueries({ queryKey: queryKeys.schema(key) });
    },
    [queryClient],
  );

  // ---------------------------------------------------------------- handlers
  const selectConnection = useCallback(
    (key: string) => {
      if (key === activeKey) return;
      setStoredKey(key);
      setExplorerTarget((prev) => ({ ...EMPTY_TARGET, nonce: prev.nonce + 1 }));
      reset();
    },
    [activeKey, reset],
  );

  // "Open in table view" from the search results: same phrase and options, only that table.
  const openInExplorer = useCallback(
    (table: string) => {
      const params = search.params;
      setExplorerTarget((prev) => ({
        table,
        q: params?.phrase ?? '',
        mode: params?.matchMode ?? 'contains',
        caseSensitive: params?.caseSensitive ?? false,
        includeNumbers: params?.includeNumbers ?? false,
        nonce: prev.nonce + 1,
      }));
      navigate('/browse');
    },
    [search.params, navigate],
  );

  const openAddConnection = useCallback(() => {
    setEditKey(null);
    void queryClient.invalidateQueries({ queryKey: queryKeys.engines }); // a driver may have been installed
    connectionModal.onOpen();
  }, [queryClient, connectionModal]);

  const openEditConnection = useCallback(
    (key: string) => {
      setEditKey(key);
      connectionModal.onOpen();
    },
    [connectionModal],
  );

  const refreshConnections = async (failTitle: string) => {
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.connections }, { throwOnError: true });
    } catch (error) {
      toast({ title: failTitle, description: apiErrorMessage(error, ''), status: 'warning' });
    }
  };

  const handleSaved = async (details: ConnectionDetails) => {
    forgetTables(details.key);
    reset();
    setStoredKey(details.key);
    await refreshConnections(t('Saved, but the list could not be refreshed'));
  };

  const handleDeleted = async (key: string) => {
    forgetTables(key);
    setScopes((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    reset();
    await refreshConnections(t('Removed, but the list could not be refreshed'));
  };

  const scope = scopes[activeKey] ?? EMPTY_SCOPE;
  const excludePatterns = useMemo(() => splitPatterns(scope.exclude), [scope.exclude]);

  const applyScope = useCallback(
    (tableNames: string[], exclude: string) => {
      setScopes((prev) => ({ ...prev, [activeKey]: { tables: tableNames, exclude } }));
    },
    [activeKey],
  );

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  }, []);

  const startSearch = useCallback(() => {
    const trimmed = phrase.trim();
    if (!trimmed || !activeKey) return;
    setSearchCount((count) => count + 1);
    void start({
      connection: activeKey,
      phrase: trimmed,
      matchMode: prefs.matchMode,
      caseSensitive: prefs.caseSensitive,
      includeNumbers: prefs.includeNumbers,
      rowLimit: prefs.rowLimit,
      tables: scope.tables,
      excludePatterns,
    });
  }, [phrase, activeKey, prefs, scope.tables, excludePatterns, start]);

  const value: WorkspaceValue = {
    user,
    isAdmin,
    onLogout,
    connections,
    loaded,
    activeKey,
    active,
    selectConnection,
    engines: enginesQuery.data ?? NO_ENGINES,
    limits: limitsQuery.data ?? DEFAULT_LIMITS,
    tables,
    tablesError,
    reloadTables: () => forgetTables(activeKey),
    openAddConnection,
    openEditConnection,
    search,
    startSearch,
    cancelSearch: () => void cancel(),
    searchCount,
    phrase,
    setPhrase,
    prefs,
    setPref,
    scope,
    applyScope,
    excludePatterns,
    explorerTarget,
    openInExplorer,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      <ConnectionModal
        isOpen={connectionModal.isOpen}
        onClose={connectionModal.onClose}
        engines={value.engines}
        editKey={editKey}
        onSaved={(details) => void handleSaved(details)}
        onDeleted={(key) => void handleDeleted(key)}
      />
    </WorkspaceContext.Provider>
  );
}
