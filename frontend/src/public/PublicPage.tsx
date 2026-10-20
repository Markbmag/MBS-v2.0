import { useEffect, useMemo, useState } from 'react';
import {
  Alert, AlertIcon as ChakraAlertIcon, Box, Button, Flex, FormControl, FormLabel, HStack, Input, Link, Skeleton, Text, useBreakpointValue,
  useColorMode,
} from '@chakra-ui/react';
import { useParams } from 'react-router-dom';
import ReactGridLayout, { useContainerWidth, verticalCompactor } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import axios from 'axios';
import { apiErrorMessage, http } from '../api';
import { t } from '../i18n/index.ts';
import { Visualization } from '../components/viz/Visualization';
import { CardEndpointsContext, useCardRun } from '../dashboards/api';
import type { CardEndpoints } from '../dashboards/api';
import { DashboardCard } from '../dashboards/DashboardCard';
import { FilterBar } from '../dashboards/FilterBar';
import { cardsOnTab, runValues } from '../dashboards/logic';
import type { FilterValues } from '../dashboards/logic';
import type { DashCard, DashFilter, Definition, Tab } from '../dashboards/types';
import { LockIcon } from '../icons';
import { ParametersBar } from '../library/ParametersBar';
import type { ParameterDef, ParamValues } from '../library/params';
import { buildCsvFromArrays, downloadText, safeFilename, saveBlob } from '../lib/csv';
import { DEFAULT_VIZ, effectiveViz } from '../viz/state';
import type { VizState } from '../viz/state';

type Mode = 'public' | 'embed';

interface SharedDashboard {
  type: 'dashboard';
  name: string;
  description: string | null;
  filters: DashFilter[];
  tabs: Tab[];
  settings: Definition['settings'];
  cards: DashCard[];
  download: boolean;
}

interface SharedQuestion {
  type: 'question';
  name: string;
  description: string | null;
  viz: VizState | null;
  parameters: ParameterDef[];
  download: boolean;
}

type View = { password_required: true } | ({ password_required: false } & (SharedDashboard | SharedQuestion));

const ROW_HEIGHT = 40;
const MARGIN = 12;

/** Options an embedding website puts after the #: titled=false, bordered=false, theme=dark|light. */
function hashOptions(): { titled: boolean; bordered: boolean; theme: string | null } {
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return { titled: h.get('titled') !== 'false', bordered: h.get('bordered') !== 'false', theme: h.get('theme') };
}

/** /public/:token and /embed/:token - read-only, no sign-in. */
export default function PublicPage({ mode }: { mode: Mode }) {
  const token = useParams().token ?? '';
  const base = `/api/${mode}/${encodeURIComponent(token)}`;
  const [access, setAccess] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => hashOptions(), []);
  const { setColorMode } = useColorMode();

  useEffect(() => {
    if (options.theme === 'dark' || options.theme === 'light') setColorMode(options.theme);
  }, [options.theme, setColorMode]);

  useEffect(() => {
    let alive = true;
    http
      .get<View>(base, { headers: access ? { 'X-Ncode-Access': access } : {} })
      .then((res) => alive && setView(res.data))
      .catch((e: unknown) => {
        if (!alive) return;
        const status = axios.isAxiosError(e) ? e.response?.status : undefined;
        setError(status === 404 ? t('This link does not exist or no longer works.') : apiErrorMessage(e, t('This could not be opened.')));
      });
    return () => {
      alive = false;
    };
  }, [base, access]);

  useEffect(() => {
    if (view && !view.password_required) document.title = `${view.name} · Ncode`;
  }, [view]);

  const headers = access ? { 'X-Ncode-Access': access } : undefined;

  let body: React.ReactNode;
  if (error)
    body = (
      <Alert status="warning" borderRadius="xl" maxW="520px" mx="auto" mt={16}>
        <ChakraAlertIcon />
        {error}
      </Alert>
    );
  else if (!view) body = <Skeleton h="420px" borderRadius="2xl" />;
  else if (view.password_required)
    body = (
      <PasswordForm
        base={base}
        onAccess={(a) => {
          setError(null);
          setAccess(a);
        }}
      />
    );
  else if (view.type === 'dashboard') body = <SharedDashboardView base={base} d={view} headers={headers} titled={options.titled} />;
  else body = <SharedQuestionView base={base} q={view} headers={headers} titled={options.titled} />;

  return (
    <Box minH="100vh" bg="appBg" p={mode === 'embed' && !options.bordered ? 0 : { base: 3, md: 6 }} data-testid={`${mode}-page`}>
      {body}
      {mode === 'public' && (
        <Text fontSize="xs" color="faintText" textAlign="center" mt={8}>
          {t('Shared with Ncode')}
        </Text>
      )}
    </Box>
  );
}

function PasswordForm({ base, onAccess }: { base: string; onAccess: (a: string) => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onAccess((await http.post<{ access: string }>(`${base}/unlock`, { password })).data.access);
    } catch (e) {
      setError(apiErrorMessage(e, t('That did not work')));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box
      as="form"
      maxW="380px"
      mx="auto"
      mt={20}
      p={6}
      bg="panelBg"
      border="1px solid"
      borderColor="lineColor"
      borderRadius="2xl"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void submit();
      }}
    >
      <HStack mb={4}>
        <LockIcon boxSize={5} />
        <Text fontWeight={700}>{t('This link is protected')}</Text>
      </HStack>
      <FormControl>
        <FormLabel fontSize="sm">{t('Password')}</FormLabel>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus data-testid="public-password" />
      </FormControl>
      {error && (
        <Text fontSize="sm" color="red.400" mt={2}>
          {error}
        </Text>
      )}
      <Button type="submit" variant="brand" mt={4} w="100%" isLoading={busy} isDisabled={!password}>
        {t('Open')}
      </Button>
    </Box>
  );
}

function Title({ name, description }: { name: string; description: string | null }) {
  return (
    <Box mb={3}>
      <Text as="h1" fontSize="2xl" fontWeight={700} letterSpacing="-0.02em" data-testid="public-title">
        {name}
      </Text>
      {description && (
        <Text fontSize="sm" color="mutedText">
          {description}
        </Text>
      )}
    </Box>
  );
}

function SharedDashboardView({ base, d, headers, titled }: { base: string; d: SharedDashboard; headers?: Record<string, string>; titled: boolean }) {
  const [values, setValues] = useState<FilterValues>({});
  const [tab, setTab] = useState<string | null>(d.tabs[0]?.id ?? null);
  const runJson = useMemo(() => JSON.stringify(runValues(d.filters, values)), [d.filters, values]);
  const endpoints: CardEndpoints = useMemo(
    () => ({ run: (c: DashCard) => `${base}/cards/${encodeURIComponent(c.key)}/run`, tasks: base, headers, download: d.download }),
    [base, headers, d.download],
  );
  const def: Definition = { filters: d.filters, tabs: d.tabs, cards: d.cards, settings: d.settings };
  const cards = cardsOnTab(def, tab);
  const { width, containerRef, mounted } = useContainerWidth();
  const stacked = useBreakpointValue({ base: true, md: false }, { ssr: false }) ?? false;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const every = d.settings.refresh ?? 0;
    if (!every) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), every * 1000);
    return () => window.clearInterval(timer);
  }, [d.settings.refresh]);
  const layout: Layout = cards.map((c) => ({ i: c.key, x: c.layout.x, y: c.layout.y, w: c.layout.w, h: c.layout.h, static: true }));
  const render = (c: DashCard) => (
    <DashboardCard dashboardId={0} card={c} filters={d.filters} values={values} runValuesJson={runJson} saved trigger={tick} refresh={tick > 0} editing={false} />
  );
  return (
    <CardEndpointsContext.Provider value={endpoints}>
      {titled && <Title name={d.name} description={d.description} />}
      {d.filters.length > 0 && (
        <Box mb={3}>
          <FilterBar filters={d.filters} values={values} onChange={setValues} />
        </Box>
      )}
      {d.tabs.length > 0 && (
        <HStack spacing={1} mb={3} borderBottom="1px solid" borderColor="lineColor" overflowX="auto">
          {d.tabs.map((t) => (
            <Button key={t.id} size="sm" variant="ghost" borderRadius="0" fontWeight={t.id === tab ? 700 : 500} borderBottom="2px solid" borderColor={t.id === tab ? 'brand.400' : 'transparent'} onClick={() => setTab(t.id)}>
              {t.name}
            </Button>
          ))}
        </HStack>
      )}
      <Box ref={containerRef} mx={stacked ? 0 : `-${MARGIN}px`}>
        {stacked ? (
          <Flex direction="column" gap={3}>
            {[...cards].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x).map((c) => (
              <Box key={c.key} h={c.kind === 'heading' ? 'auto' : `${Math.max(c.layout.h, 4) * ROW_HEIGHT}px`}>
                {render(c)}
              </Box>
            ))}
          </Flex>
        ) : (
          mounted &&
          cards.length > 0 && (
            <ReactGridLayout
              width={width}
              layout={layout}
              gridConfig={{ cols: 12, rowHeight: ROW_HEIGHT, margin: [MARGIN, MARGIN] }}
              dragConfig={{ enabled: false }}
              resizeConfig={{ enabled: false }}
              compactor={verticalCompactor}
            >
              {cards.map((c) => (
                <div key={c.key}>{render(c)}</div>
              ))}
            </ReactGridLayout>
          )
        )}
      </Box>
    </CardEndpointsContext.Provider>
  );
}

function SharedQuestionView({ base, q, headers, titled }: { base: string; q: SharedQuestion; headers?: Record<string, string>; titled: boolean }) {
  const [values, setValues] = useState<ParamValues>({});
  const request = useMemo(() => JSON.stringify({ params: values }), [values]);
  const headersJson = JSON.stringify(headers ?? {});
  const run = useCardRun(`${base}/run`, request, 0, false, true, base, headersJson);
  const vizState = q.viz ?? DEFAULT_VIZ;
  const spec = useMemo(() => {
    if (!run.result) return null;
    if (vizState.mode === 'table') return { version: 1 as const, type: 'table' as const };
    return effectiveViz(vizState, run.result).spec;
  }, [run.result, vizState]);
  const name = safeFilename(q.name);
  const xlsx = async () => {
    if (!run.taskId) return;
    const res = await http.get<Blob>(`${base}/tasks/${run.taskId}/export.xlsx`, { responseType: 'blob', headers });
    saveBlob(`${name}.xlsx`, res.data);
  };
  return (
    <Box>
      {titled && <Title name={q.name} description={q.description} />}
      {q.parameters.length > 0 && (
        <Box mb={3} bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl">
          <ParametersBar defs={q.parameters} values={values} onValues={setValues} onDefs={null} />
        </Box>
      )}
      <Box h={{ base: '420px', md: '560px' }} bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden">
        {run.status === 'error' ? (
          <Flex h="100%" align="center" justify="center" color="red.400" fontSize="sm" p={4} textAlign="center">
            {run.error}
          </Flex>
        ) : run.result && spec ? (
          <Visualization result={run.result} viz={spec} />
        ) : (
          <Skeleton h="100%" />
        )}
      </Box>
      {q.download && run.result && (
        <HStack mt={3} spacing={3} fontSize="sm">
          <Link onClick={() => run.result && downloadText(`${name}.csv`, buildCsvFromArrays(run.result.columns.map((c) => c.name), run.result.rows, ';'))}>
            {t('Download CSV')}
          </Link>
          <Link onClick={() => void xlsx()}>{t('Download Excel')}</Link>
        </HStack>
      )}
    </Box>
  );
}
