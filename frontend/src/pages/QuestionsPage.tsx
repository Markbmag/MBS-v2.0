import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Checkbox, Collapse, Flex, HStack, Input, Select, Skeleton, Switch, Text, Tooltip,
  VStack, Wrap, WrapItem, useBreakpointValue, useDisclosure,
} from '@chakra-ui/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiErrorMessage, http } from '../api';
import { ResultView } from '../components/data/ResultView';
import { NoConnectionsState } from '../components/EmptyStates';
import { Split } from '../components/layout/Split';
import { CustomColumnsEditor } from '../components/query/CustomColumnsEditor';
import { FilterEditor } from '../components/query/FilterEditor';
import { JoinEditor } from '../components/query/JoinEditor';
import { SortEditor } from '../components/query/SortEditor';
import { SqlPreviewModal } from '../components/query/SqlPreviewModal';
import { Step } from '../components/query/Step';
import { SummarizeEditor } from '../components/query/SummarizeEditor';
import { TransformsEditor } from '../components/query/TransformsEditor';
import { useMetrics } from '../semantic/api';
import { CodeIcon, RefreshIcon } from '../icons';
import { loadJson, saveJson } from '../lib/storage';
import { columnOptions, humanize, isSummarised, newSpec, prepareSpec, queryTables, summaryOutputs } from '../query/draft';
import type { SchemaInfo } from '../query/draft';
import type { FilterGroup, QuerySpec } from '../query/types';
import { START_WAIT_MS, useQueryRun } from '../query/useQueryRun';
import type { TaskSnapshot } from '../query/useQueryRun';
import { useSchema } from '../query/useSchema';
import { DEFAULT_VIZ } from '../viz/state';
import type { VizState } from '../viz/state';
import { useWorkspace } from '../workspace/useWorkspace';
import { useQuestions } from '../library/api';
import type { SavedQuestion } from '../library/api';
import { ParametersBar } from '../library/ParametersBar';
import { bindSpec, shapeOf, specParams, syncBuilderParams, valuesFromSearch, valuesToSearch } from '../library/params';
import type { ParamShape, ParamValues, ParameterDef } from '../library/params';
import { QuestionHeader } from '../library/QuestionHeader';
import { locale, t, tn } from '../i18n/index.ts';

const EMPTY_GROUP: FilterGroup = { op: 'and', rules: [] };
const draftKey = (connection: string) => `ncode_question_${connection}`;

/** Questions: the notebook-style builder (one draft per database, kept in this browser tab). */
export default function QuestionsPage() {
  const ws = useWorkspace();
  if (!ws.loaded) return <Skeleton h="400px" borderRadius="2xl" />;
  if (!ws.active) return <NoConnectionsState isAdmin={ws.isAdmin} onAdd={ws.openAddConnection} />;
  return <Builder key={ws.activeKey} connection={ws.activeKey} />;
}

/** The builder, for a new question or (with `saved`) a saved one. */
export function Builder({ connection, saved = null }: { connection: string; saved?: SavedQuestion | null }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const schemaQuery = useSchema(connection);
  const [searchParams, setSearchParams] = useSearchParams();
  const conn = ws.connections.find((c) => c.key === connection); // this editor's database (a saved question's own)
  const [draft, setDraft] = useState<QuerySpec | null>(() => {
    if (saved) return saved.spec as QuerySpec;
    try {
      const raw = sessionStorage.getItem(draftKey(connection));
      return raw ? (JSON.parse(raw) as QuerySpec) : null;
    } catch {
      return null;
    }
  });
  const [autoPreview, setAutoPreview] = useState(() => loadJson('ncode_auto_preview', true));
  const [smartDates, setSmartDates] = useState(() => loadJson('ncode_smart_dates', false));
  const [showFields, setShowFields] = useState(false);
  const [viz, setViz] = useState<VizState>(() => {
    if (saved) return saved.viz ?? DEFAULT_VIZ;
    try {
      const raw = sessionStorage.getItem(`${draftKey(connection)}_viz`);
      return raw ? (JSON.parse(raw) as VizState) : DEFAULT_VIZ;
    } catch {
      return DEFAULT_VIZ;
    }
  });
  const [defs, setDefs] = useState<ParameterDef[]>(() => saved?.parameters ?? []);
  const [paramValues, setParamValuesState] = useState<ParamValues>(() => valuesFromSearch(searchParams));
  const setParamValues = (values: ParamValues) => {
    setParamValuesState(values);
    setSearchParams((prev) => valuesToSearch(values, prev), { replace: true }); // shareable link with the values
  };
  const sqlModal = useDisclosure();
  const { state, run, cancel } = useQueryRun();
  const metricsQuery = useMetrics(connection);
  const vertical = useBreakpointValue({ base: true, lg: false }) ?? false;

  useEffect(() => saveJson('ncode_auto_preview', autoPreview), [autoPreview]);
  useEffect(() => {
    if (saved) return;
    try {
      sessionStorage.setItem(`${draftKey(connection)}_viz`, JSON.stringify(viz));
    } catch {
      // a convenience only
    }
  }, [viz, connection, saved]);
  useEffect(() => saveJson('ncode_smart_dates', smartDates), [smartDates]);
  useEffect(() => {
    if (saved) return; // a saved question is its own draft
    try {
      if (draft) sessionStorage.setItem(draftKey(connection), JSON.stringify(draft));
      else sessionStorage.removeItem(draftKey(connection));
    } catch {
      // the draft is a convenience
    }
  }, [draft, connection, saved]);

  const schema: SchemaInfo | null = useMemo(
    () => (schemaQuery.data ? { tables: schemaQuery.data.tables, relationships: schemaQuery.data.relationships } : null),
    [schemaQuery.data],
  );
  const tableNames = useMemo(() => (schema ? schema.tables.map((t) => t.name).sort((a, b) => a.localeCompare(b)) : []), [schema]);
  const validDraft = draft && schema && tableNames.includes(draft.source.table) ? draft : null;

  const prepared0 = useMemo(() => (validDraft && schema ? prepareSpec(validDraft, schema) : null), [validDraft, schema]);
  // Parameters: one declaration per filter marked "ask", typed by its column.
  const typeOfRef = useMemo(() => {
    const opts = validDraft && schema ? columnOptions(validDraft, schema) : [];
    return (ref: string) => opts.find((o) => o.ref === ref)?.type ?? 'unknown';
  }, [validDraft, schema]);
  const paramDefs = useMemo(() => (validDraft ? syncBuilderParams(validDraft, defs, typeOfRef) : []), [validDraft, defs, typeOfRef]);
  const paramShapes = useMemo(() => {
    const out: Record<string, ParamShape> = {};
    if (validDraft) for (const use of specParams(validDraft)) out[use.name] ??= shapeOf(use.op);
    return out;
  }, [validDraft]);
  // What runs: the prepared spec with the parameter values filled in.
  const prepared = useMemo(() => {
    if (!prepared0) return null;
    const bound = bindSpec(prepared0.spec, paramDefs, paramValues);
    const problems = [...prepared0.problems, ...bound.missing.map((m) => t('Give a value for “{name}”', { name: m }))];
    return { spec: bound.value, problems };
  }, [prepared0, paramDefs, paramValues]);
  const preparedJson = prepared ? JSON.stringify(prepared.spec) : '';

  // Unsaved changes: compare with the saved question, normalised the same way.
  const baseline = useMemo(() => {
    if (!saved || !schema) return null;
    const spec = saved.spec as QuerySpec;
    if (!schema.tables.some((t) => t.name === spec.source?.table)) return null;
    const opts = columnOptions(spec, schema);
    const typeOf = (ref: string) => opts.find((o) => o.ref === ref)?.type ?? 'unknown';
    return JSON.stringify({ spec: prepareSpec(spec, schema).spec, viz: saved.viz ?? DEFAULT_VIZ, params: syncBuilderParams(spec, saved.parameters, typeOf) });
  }, [saved, schema]);
  const current = prepared0 ? JSON.stringify({ spec: prepared0.spec, viz, params: paramDefs }) : null;
  const dirty = !!saved && baseline !== null && current !== baseline;

  const runNow = () => {
    if (!prepared || prepared.problems.length > 0) return;
    const spec = prepared.spec;
    void run(async () => (await http.post<TaskSnapshot>('/api/query', { spec, wait_ms: START_WAIT_MS })).data);
  };

  // Live preview: run shortly after the question stops changing.
  useEffect(() => {
    if (!autoPreview || !preparedJson || (prepared?.problems.length ?? 0) > 0) return;
    const timer = window.setTimeout(() => {
      const spec = JSON.parse(preparedJson) as QuerySpec;
      void run(async () => (await http.post<TaskSnapshot>('/api/query', { spec, wait_ms: START_WAIT_MS })).data);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [preparedJson, autoPreview, prepared?.problems.length, run]);

  // A saved question shows its result when opened, even without live preview.
  const openedRun = useRef(false);
  useEffect(() => {
    if (!saved || autoPreview || openedRun.current || !preparedJson || (prepared?.problems.length ?? 0) > 0) return;
    openedRun.current = true;
    const spec = JSON.parse(preparedJson) as QuerySpec;
    void run(async () => (await http.post<TaskSnapshot>('/api/query', { spec, wait_ms: START_WAIT_MS })).data);
  }, [saved, autoPreview, preparedJson, prepared?.problems.length, run]);

  // Ctrl/Cmd+Enter runs now
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runNow();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  if (schemaQuery.isPending) return <Skeleton h="400px" borderRadius="2xl" />;
  if (schemaQuery.isError || !schema)
    return (
      <Alert status="error" borderRadius="xl">
        <AlertIcon />
        {apiErrorMessage(schemaQuery.error, t('Could not read the database structure'))}
      </Alert>
    );

  const update = (patch: Partial<QuerySpec>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const pickSource = (table: string) => setDraft(table ? { ...newSpec(connection, table), limit: draft?.limit } : null);

  const options = validDraft ? columnOptions(validDraft, schema) : [];
  const summarised = validDraft ? isSummarised(validDraft) : false;
  const outputs = validDraft && summarised ? summaryOutputs(validDraft, options) : [];
  const outputOptions = outputs.map((o) => ({ ref: o.name, label: o.name, type: o.type }));
  const baseOptions = validDraft ? columnOptions({ ...validDraft, expressions: [] }, schema) : [];
  const inQuery = validDraft ? new Set(queryTables(validDraft, schema).map((t) => t.table)) : new Set<string>();
  const metrics = (metricsQuery.data ?? []).filter((m) => inQuery.has(m.table));

  const builder = (
    <Box h="100%" overflowY="auto" pr={{ base: 0, lg: 3 }} pb={6} data-testid="builder">
      <VStack align="stretch" spacing={4}>
        <Step title={t('Data')} color="brand.300" testId="step-data">
          <Select size="sm" value={validDraft?.source.table ?? ''} onChange={(e) => pickSource(e.target.value)} placeholder={t('Pick a table…')} aria-label={t('Table')}>
            {tableNames.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
          {!saved && <ModelPicker onPick={(id) => navigate(`/combine?question=${id}`)} />}
        </Step>

        {validDraft && (
          <>
            <Step title={t('Join')} color="teal.300" testId="step-join">
              <JoinEditor spec={validDraft} schema={schema} onChange={(joins) => update({ joins })} />
            </Step>

            <Step title={t('Custom columns')} color="cyan.300" hint={t('Formulas such as [total] - [discount] or round([total] / [qty], 2).')}>
              <CustomColumnsEditor columns={validDraft.expressions ?? []} onChange={(expressions) => update({ expressions })} options={baseOptions} />
            </Step>

            <Step title={t('Filter')} color="purple.300" testId="step-filter">
              <FilterEditor
                group={validDraft.filters ?? EMPTY_GROUP}
                onChange={(filters) => update({ filters })}
                options={options}
                params={{ names: paramDefs.map((d) => d.name), label: (name) => paramDefs.find((d) => d.name === name)?.label || name }}
              />
            </Step>

            <Step title={t('Summarise')} color="green.300" testId="step-summarise">
              <SummarizeEditor
                aggregations={validDraft.aggregations ?? []}
                breakouts={validDraft.breakouts ?? []}
                options={options}
                metrics={metrics}
                onChange={(aggregations, breakouts) => update({ aggregations, breakouts, ...(isSummarised({ ...validDraft, aggregations, breakouts }) ? {} : { having: null }) })}
              />
            </Step>

            {summarised ? (
              <Step title={t('Filter the summary')} color="pink.300" hint={t('Like HAVING in SQL: e.g. only groups whose total is above 1000.')}>
                <FilterEditor group={validDraft.having ?? EMPTY_GROUP} onChange={(having) => update({ having })} options={outputOptions} emptyText={t('Every group is shown.')} />
              </Step>
            ) : (
              <Step
                title={t('Columns')}
                color="blue.300"
                actions={
                  <Button size="xs" variant="ghost" onClick={() => setShowFields((v) => !v)}>
                    {showFields ? t('Done') : t('Choose')}
                  </Button>
                }
              >
                <Text fontSize="sm" color="mutedText">
                  {validDraft.fields?.length ? tn(validDraft.fields.length, '{n} chosen', '{n} chosen') : t('All columns')}
                </Text>
                <Collapse in={showFields} animateOpacity>
                  <Wrap spacing={2} pt={2}>
                    {options.map((o) => {
                      const chosen = (validDraft.fields ?? []).some((f) => f.ref === o.ref);
                      return (
                        <WrapItem key={o.ref}>
                          <Checkbox
                            size="sm"
                            isChecked={chosen}
                            onChange={(e) =>
                              update({ fields: e.target.checked ? [...(validDraft.fields ?? []), { ref: o.ref }] : (validDraft.fields ?? []).filter((f) => f.ref !== o.ref) })
                            }
                          >
                            <Text fontSize="xs">{o.label}</Text>
                          </Checkbox>
                        </WrapItem>
                      );
                    })}
                  </Wrap>
                </Collapse>
              </Step>
            )}

            <Step title={t('Sort')} color="orange.300">
              <SortEditor order={validDraft.order ?? []} options={summarised ? outputOptions : options} onChange={(order) => update({ order })} />
            </Step>

            <Step title={t('Calculate')} color="teal.200" testId="step-calculate" hint={t('On the rows returned: vs. last year, running totals, shares, ranks, outliers.')}>
              <TransformsEditor transforms={validDraft.transforms ?? []} columns={state.result?.columns ?? []} onChange={(transforms) => update({ transforms })} />
            </Step>

            <Step title={t('Row limit')} color="gray.400">
              <HStack>
                <Input
                  size="sm"
                  type="number"
                  min={1}
                  max={ws.limits.query_max_rows}
                  maxW="140px"
                  placeholder={String(ws.limits.query_default_rows)}
                  value={validDraft.limit ?? ''}
                  onChange={(e) => update({ limit: e.target.value ? Math.min(Number(e.target.value), ws.limits.query_max_rows ?? 10000) : null })}
                  aria-label={t('Row limit')}
                />
                <Text fontSize="xs" color="faintText">
                  {t('at most {n}', { n: (ws.limits.query_max_rows ?? 10000).toLocaleString(locale()) })}
                </Text>
              </HStack>
            </Step>
          </>
        )}
      </VStack>
    </Box>
  );

  const results = (
    <Box h="100%" bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden">
      {prepared && prepared.problems.length > 0 && (
        <Alert status="warning" fontSize="sm">
          <AlertIcon />
          {prepared.problems.join(' · ')}
        </Alert>
      )}
      <ParametersBar defs={paramDefs} shapes={paramShapes} values={paramValues} onValues={setParamValues} onDefs={!saved || saved.access === 'edit' ? setDefs : null} />
      <ResultView
        state={state}
        onCancel={cancel}
        smartDates={smartDates}
        onSmartDates={setSmartDates}
        filename={saved ? saved.name : `${conn?.label ?? connection}_${validDraft?.source.table ?? 'question'}`}
        viz={viz}
        onVizChange={setViz}
        empty={
          <Flex h="100%" align="center" justify="center" p={6} color="mutedText" fontSize="sm" textAlign="center">
            {validDraft ? t('Run the question to see the result (Ctrl/Cmd + Enter).') : t('Pick a table to start. The result appears here while you build.')}
          </Flex>
        }
      />
    </Box>
  );

  return (
    <Flex direction="column" h="100%" gap={3}>
      <QuestionHeader
        engine={conn?.engine}
        title={t('New question')}
        subtitle={
          <>
            {conn?.label}
            {validDraft && ` · ${humanize(validDraft.source.table)}`}
          </>
        }
        saved={saved}
        dirty={dirty}
        defaultName={validDraft ? humanize(validDraft.source.table) : t('Question')}
        payload={() => (prepared0 && prepared0.problems.length === 0 ? { kind: 'builder', spec: prepared0.spec, viz, parameters: paramDefs } : null)}
        onRevert={() => {
          if (!saved) return;
          setDraft(saved.spec as QuerySpec);
          setViz(saved.viz ?? DEFAULT_VIZ);
          setDefs(saved.parameters);
        }}
        onSaved={() => {
          if (saved) return;
          try {
            sessionStorage.removeItem(draftKey(connection));
            sessionStorage.removeItem(`${draftKey(connection)}_viz`);
          } catch {
            // nothing to clean up
          }
        }}
      >
        <Tooltip label={t('Run automatically after each change')} hasArrow>
          <HStack spacing={1.5}>
            <Switch size="sm" id="auto-preview" isChecked={autoPreview} onChange={(e) => setAutoPreview(e.target.checked)} />
            <Text as="label" htmlFor="auto-preview" fontSize="xs" color="mutedText">
              {t('Live preview')}
            </Text>
          </HStack>
        </Tooltip>
        {summarised && <Badge colorScheme="green">{t('summarised')}</Badge>}
        <Button size="sm" variant="subtle" leftIcon={<CodeIcon boxSize={4} />} onClick={sqlModal.onOpen} isDisabled={!prepared || prepared.problems.length > 0} data-testid="view-sql">
          {t('View SQL')}
        </Button>
        <Button size="sm" leftIcon={<RefreshIcon boxSize={4} />} onClick={runNow} isDisabled={!prepared || prepared.problems.length > 0} data-testid="run-question">
          {t('Run')}
        </Button>
        {!saved && (
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)} isDisabled={!draft}>
            {t('Start over')}
          </Button>
        )}
      </QuestionHeader>

      <Box flex={1} minH={0} h={{ base: 'auto', lg: undefined }}>
        {vertical ? (
          <VStack align="stretch" spacing={4}>
            {builder}
            <Box h="70vh">{results}</Box>
          </VStack>
        ) : (
          <Split id="question-split" first={builder} second={results} defaultFirst="42%" minFirst="28%" minSecond="30%" />
        )}
      </Box>

      {prepared && (
        <SqlPreviewModal
          isOpen={sqlModal.isOpen}
          onClose={sqlModal.onClose}
          spec={prepared.spec}
          engine={conn?.engine}
          onOpenInEditor={(sql) => navigate('/sql', { state: { connection, sql } })}
        />
      )}
    </Flex>
  );
}

/** "or start from a model": a saved question marked as a model, opened as a source in Combine. */
function ModelPicker({ onPick }: { onPick: (id: number) => void }) {
  const models = useQuestions({ models: true, limit: 100 });
  if (!models.data?.length) return null;
  return (
    <Select size="sm" mt={2} value="" onChange={(e) => e.target.value && onPick(Number(e.target.value))} aria-label={t('Start from a model')} data-testid="model-picker">
      <option value="">{t('… or start from a model')}</option>
      {models.data.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </Select>
  );
}
