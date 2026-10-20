import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, ButtonGroup, Checkbox, Collapse, Flex, HStack, IconButton, Input, Spinner, Switch, Text, Tooltip,
  VStack, Wrap, WrapItem, useBreakpointValue,
} from '@chakra-ui/react';
import { useQueries } from '@tanstack/react-query';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { apiErrorMessage, http } from '../api';
import type { FederationInfo } from '../api';
import { ResultView } from '../components/data/ResultView';
import { Split } from '../components/layout/Split';
import { CustomColumnsEditor } from '../components/query/CustomColumnsEditor';
import { FilterEditor } from '../components/query/FilterEditor';
import { SortEditor } from '../components/query/SortEditor';
import { Step } from '../components/query/Step';
import { SummarizeEditor } from '../components/query/SummarizeEditor';
import { TransformsEditor } from '../components/query/TransformsEditor';
import { CodeEditor } from '../components/sql/CodeEditor';
import { locale, t, tn } from '../i18n/index.ts';
import { ChartIcon, CodeIcon, MergeIcon, PencilIcon, PlusIcon, RefreshIcon, TableIcon, UploadIcon, XIcon } from '../icons';
import { libraryKeys, useQuestion } from '../library/api';
import type { SavedQuestion } from '../library/api';
import { ParametersBar } from '../library/ParametersBar';
import { shapeOf, specParams, valuesFromSearch, valuesToSearch } from '../library/params';
import type { ParamShape, ParamValues, ParameterDef } from '../library/params';
import { QuestionHeader } from '../library/QuestionHeader';
import { loadJson, saveJson } from '../lib/storage';
import { columnOptions, isSummarised, summaryOutputs } from '../query/draft';
import type { FilterGroup, QuerySpec } from '../query/types';
import { START_WAIT_MS, useQueryRun } from '../query/useQueryRun';
import type { TaskSnapshot } from '../query/useQueryRun';
import { DEFAULT_VIZ } from '../viz/state';
import type { VizState } from '../viz/state';
import { useWorkspace } from '../workspace/useWorkspace';
import { previewQuery, useDataset } from '../federation/api';
import { JoinStep } from '../federation/JoinStep';
import {
  MAX_SOURCES, aliasFor, emptySpec, federatedParams, fromPostQuery, matchSummary, postQuery, prepareFederated, resultSchema, sourceProblems,
} from '../federation/logic';
import { MatchReport } from '../federation/MatchReport';
import { SourceDialog } from '../federation/SourceDialog';
import type { ColumnHint, FederatedSpec, Source } from '../federation/types';

const EMPTY_GROUP: FilterGroup = { op: 'and', rules: [] };
const DRAFT_KEY = 'ncode_combine_draft';

/** /combine: a new multi-source question (one draft per browser tab); ?dataset=ID starts one with that file. */
export default function CombinePage() {
  const [search] = useSearchParams();
  const dataset = Number(search.get('dataset')) || null;
  const questionId = Number(search.get('question')) || null;
  const file = useDataset(dataset);
  const question = useQuestion(questionId ?? 0, !!questionId);
  if ((dataset && file.isPending) || (questionId && question.isPending)) return <Spinner />;
  const start: FederatedSpec | null = file.data
    ? { ...emptySpec(), sources: [{ alias: aliasFor(file.data.name, []), label: file.data.name, type: 'dataset', dataset_id: file.data.id }] }
    : question.data
      ? { ...emptySpec(), sources: [{ alias: aliasFor(question.data.name, []), label: question.data.name, type: 'question', question_id: question.data.id }] }
      : null;
  return <CombineWorkspace key={dataset ?? questionId ?? 'draft'} start={start} />;
}

function loadDraft(): FederatedSpec {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as FederatedSpec) : emptySpec();
  } catch {
    return emptySpec();
  }
}

/** The multi-source editor, for a new question or (with `saved`) a saved one. */
export function CombineWorkspace({ saved = null, start = null }: { saved?: SavedQuestion | null; start?: FederatedSpec | null }) {
  const ws = useWorkspace();
  const [draft, setDraft] = useState<FederatedSpec>(() => (saved ? (saved.spec as FederatedSpec) : start ?? loadDraft()));
  const [viz, setViz] = useState<VizState>(() => saved?.viz ?? loadJson<VizState>(`${DRAFT_KEY}_viz`, DEFAULT_VIZ));
  const [defs, setDefs] = useState<ParameterDef[]>(() => saved?.parameters ?? []);
  const [searchParams, setSearchParams] = useSearchParams();
  const [paramValues, setParamValuesState] = useState<ParamValues>(() => valuesFromSearch(searchParams));
  const setParamValues = (values: ParamValues) => {
    setParamValuesState(values);
    setSearchParams((prev) => valuesToSearch(values, prev), { replace: true });
  };
  const [autoRun, setAutoRun] = useState(() => loadJson('ncode_combine_auto', true));
  const [smartDates, setSmartDates] = useState(() => loadJson('ncode_smart_dates', false));
  const [editing, setEditing] = useState<{ index: number | null; source: Partial<Source> } | null>(null);
  const [view, setView] = useState<'result' | 'report'>('result');
  const [showFields, setShowFields] = useState(false);
  const { state, run, cancel } = useQueryRun();
  const vertical = useBreakpointValue({ base: true, lg: false }) ?? false;
  const canEdit = !saved || saved.access === 'edit';

  useEffect(() => {
    if (saved) return; // a saved question is its own draft
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // a convenience only
    }
  }, [draft, saved]);
  useEffect(() => {
    if (!saved) saveJson(`${DRAFT_KEY}_viz`, viz);
  }, [viz, saved]);
  useEffect(() => saveJson('ncode_combine_auto', autoRun), [autoRun]);
  useEffect(() => saveJson('ncode_smart_dates', smartDates), [smartDates]);

  const labels = useMemo(() => Object.fromEntries(draft.sources.map((s) => [s.alias, s.label || s.alias])), [draft.sources]);

  // Saved questions used as sources: their parameters become parameters of this question.
  const questionIds = draft.sources.filter((s) => s.type === 'question' && s.question_id).map((s) => s.question_id as number);
  const sourceQuestions = useQueries({
    queries: questionIds.map((id) => ({
      queryKey: libraryKeys.question(id),
      queryFn: async () => (await http.get<SavedQuestion>(`/api/questions/${id}`)).data,
      retry: false,
    })),
  });
  const sourceParams = sourceQuestions.map((q) => q.data?.parameters ?? []);
  const sourceParamsJson = JSON.stringify(sourceParams);

  // The combined columns as of the last successful run (saved with the question, for dashboards too).
  const combined: ColumnHint[] = useMemo(() => draft.result_columns ?? [], [draft.result_columns]);
  const schema = useMemo(() => resultSchema(combined), [combined]);
  const postSpec = useMemo(() => postQuery(draft.post), [draft.post]);
  const options = useMemo(() => columnOptions(postSpec, schema), [postSpec, schema]);
  const typeOf = useMemo(() => (ref: string) => options.find((o) => o.ref === ref || o.column === ref)?.type ?? 'unknown', [options]);
  const paramDefs = useMemo(
    () => federatedParams(draft, defs, typeOf, JSON.parse(sourceParamsJson) as ParameterDef[][]),
    [draft, defs, typeOf, sourceParamsJson],
  );
  const paramShapes = useMemo(() => {
    const out: Record<string, ParamShape> = {};
    for (const use of specParams(postSpec)) out[use.name] ??= shapeOf(use.op);
    return out;
  }, [postSpec]);

  // Each source read on its own (first rows): its columns feed the join form.
  const previews = useQueries({ queries: draft.sources.filter((s) => !sourceProblems(s)).map((s) => previewQuery(s, paramValues, paramDefs)) });
  const previewBySource = useMemo(() => {
    const ready = draft.sources.filter((s) => !sourceProblems(s));
    return Object.fromEntries(ready.map((s, i) => [s.alias, previews[i]]));
  }, [draft.sources, previews]);
  const sourceColumns = useMemo(
    () => Object.fromEntries(Object.entries(previewBySource).map(([a, p]) => [a, p?.data?.federation?.combined_columns ?? []])),
    [previewBySource],
  );

  const prepared = useMemo(() => prepareFederated(draft, combined), [draft, combined]);
  const runnable = prepared.problems.length === 0;
  // What runs (the column hint is not part of it, so learning the columns does not trigger another run).
  const runBody = useMemo(() => {
    if (!runnable) return '';
    const spec = { ...prepared.spec };
    delete spec.result_columns;
    return JSON.stringify({ spec, parameters: paramDefs, params: paramValues });
  }, [runnable, prepared.spec, paramDefs, paramValues]);

  const startRun = useCallback(
    (body: string) => {
      if (!body) return;
      const payload = JSON.parse(body) as object;
      void run(
        async () => (await http.post<TaskSnapshot>('/api/federated/run', { ...payload, wait_ms: START_WAIT_MS })).data,
        true,
        (result) => {
          const cols = result.federation?.combined_columns;
          if (cols) setDraft((d) => (JSON.stringify(d.result_columns ?? []) === JSON.stringify(cols) ? d : { ...d, result_columns: cols }));
        },
      );
    },
    [run],
  );
  const runNow = () => startRun(runBody);

  useEffect(() => {
    if (!autoRun || !runBody) return;
    const timer = window.setTimeout(() => startRun(runBody), 900);
    return () => window.clearTimeout(timer);
  }, [runBody, autoRun, startRun]);

  // A saved question shows its result when opened, even without live preview.
  const openedRun = useRef(false);
  useEffect(() => {
    if (!saved || autoRun || openedRun.current || !runBody) return;
    openedRun.current = true;
    startRun(runBody);
  }, [saved, autoRun, runBody, startRun]);

  // Ctrl/Cmd+Enter runs now
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        startRun(runBody);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [runBody, startRun]);

  const baseline = useMemo(() => {
    if (!saved) return null;
    const spec = saved.spec as FederatedSpec;
    const p = prepareFederated(spec, spec.result_columns ?? []).spec;
    delete p.result_columns;
    return JSON.stringify({ spec: p, viz: saved.viz ?? DEFAULT_VIZ, params: saved.parameters });
  }, [saved]);
  const current = useMemo(() => {
    const p = { ...prepared.spec };
    delete p.result_columns;
    return JSON.stringify({ spec: p, viz, params: paramDefs });
  }, [prepared.spec, viz, paramDefs]);
  const dirty = !!saved && baseline !== current;

  const update = (patch: Partial<FederatedSpec>) => setDraft((d) => ({ ...d, ...patch }));
  const updatePost = (patch: Partial<QuerySpec>) => setDraft((d) => ({ ...d, post: fromPostQuery({ ...postQuery(d.post), ...patch }) }));
  const taken = (except: string | null) => draft.sources.map((s) => s.alias).filter((a) => a !== except);
  const saveSource = (source: Source) => {
    if (!editing) return;
    setDraft((d) => {
      const sources = [...d.sources];
      if (editing.index === null) sources.push(source);
      else sources[editing.index] = source;
      return { ...d, sources };
    });
  };
  const removeSource = (alias: string) =>
    setDraft((d) => ({ ...d, sources: d.sources.filter((s) => s.alias !== alias), joins: (d.joins ?? []).filter((j) => j.source !== alias) }));

  const summarised = isSummarised(postSpec);
  const outputs = summarised ? summaryOutputs(postSpec, options) : [];
  const outputOptions = outputs.map((o) => ({ ref: o.name, label: o.name, type: o.type }));
  const baseOptions = columnOptions({ ...postSpec, expressions: [] }, schema);
  const mode = draft.mode ?? 'join';
  const report = state.result?.federation;

  const steps = (
    <Box h="100%" overflowY="auto" pr={{ base: 0, lg: 3 }} pb={6} data-testid="combine-steps">
      <VStack align="stretch" spacing={4}>
        <Step
          title={t('Sources')}
          color="brand.300"
          testId="step-sources"
          actions={
            <Button
              size="xs"
              variant="ghost"
              leftIcon={<PlusIcon boxSize={3} />}
              onClick={() => setEditing({ index: null, source: {} })}
              isDisabled={draft.sources.length >= MAX_SOURCES || !canEdit}
              data-testid="add-source"
            >
              {t('Add source')}
            </Button>
          }
        >
          {draft.sources.length === 0 ? (
            <Text fontSize="sm" color="mutedText">
              {t('Add up to {max} sources: saved questions, tables, SQL on any of your databases, or uploaded files.', { max: MAX_SOURCES })}
            </Text>
          ) : (
            <VStack align="stretch" spacing={1.5}>
              {draft.sources.map((s, i) => (
                <SourceRow
                  key={s.alias}
                  source={s}
                  first={i === 0}
                  preview={previewBySource[s.alias]}
                  onEdit={canEdit ? () => setEditing({ index: i, source: s }) : undefined}
                  onRemove={canEdit ? () => removeSource(s.alias) : undefined}
                />
              ))}
            </VStack>
          )}
        </Step>

        {draft.sources.length > 0 && (
          <Step
            title={mode === 'sql' ? t('Combine with SQL') : t('Join')}
            color="teal.300"
            testId="step-join"
            actions={
              <Button
                size="xs"
                variant="ghost"
                leftIcon={mode === 'sql' ? <MergeIcon boxSize={3} /> : <CodeIcon boxSize={3} />}
                onClick={() => update(mode === 'sql' ? { mode: 'join' } : { mode: 'sql', sql: draft.sql || defaultSql(draft) })}
                data-testid="toggle-sql"
              >
                {mode === 'sql' ? t('Use the join form') : t('Write SQL instead')}
              </Button>
            }
            hint={mode === 'sql' ? t('DuckDB SQL over the sources, by their names. Read-only; files and settings cannot be reached.') : undefined}
          >
            {mode === 'sql' ? (
              <Box h="200px" border="1px solid" borderColor="lineColor" borderRadius="md" overflow="hidden" data-testid="combine-sql">
                <CodeEditor
                  value={draft.sql ?? ''}
                  onChange={(sql) => update({ sql })}
                  onRun={() => runNow()}
                  engine="postgresql"
                  schema={Object.fromEntries(Object.entries(sourceColumns).map(([a, cols]) => [a, cols.map((c) => c.name)]))}
                />
              </Box>
            ) : (
              <JoinStep spec={draft} columns={sourceColumns} labels={labels} onChange={(joins) => update({ joins })} />
            )}
          </Step>
        )}

        {draft.sources.length > 0 && combined.length === 0 && (
          <Text fontSize="sm" color="mutedText" px={1}>
            {t('Run once to filter, summarise and sort the combined rows.')}
          </Text>
        )}

        {combined.length > 0 && (
          <>
            <Step title={t('Custom columns')} color="cyan.300" hint={t('Formulas such as [planned] - [built].')}>
              <CustomColumnsEditor columns={postSpec.expressions ?? []} onChange={(expressions) => updatePost({ expressions })} options={baseOptions} />
            </Step>
            <Step title={t('Filter')} color="purple.300" testId="step-filter">
              <FilterEditor
                group={postSpec.filters ?? EMPTY_GROUP}
                onChange={(filters) => updatePost({ filters })}
                options={options}
                params={{ names: paramDefs.map((d) => d.name), label: (name) => paramDefs.find((d) => d.name === name)?.label || name }}
              />
            </Step>
            <Step title={t('Summarise')} color="green.300" testId="step-summarise">
              <SummarizeEditor
                aggregations={postSpec.aggregations ?? []}
                breakouts={postSpec.breakouts ?? []}
                options={options}
                onChange={(aggregations, breakouts) =>
                  updatePost({ aggregations, breakouts, ...(isSummarised({ ...postSpec, aggregations, breakouts }) ? {} : { having: null }) })
                }
              />
            </Step>
            {summarised ? (
              <Step title={t('Filter the summary')} color="pink.300">
                <FilterEditor group={postSpec.having ?? EMPTY_GROUP} onChange={(having) => updatePost({ having })} options={outputOptions} emptyText={t('Every group is shown.')} />
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
                  {postSpec.fields?.length ? t('{n} chosen', { n: postSpec.fields.length }) : t('All columns')}
                </Text>
                <Collapse in={showFields} animateOpacity>
                  <Wrap spacing={2} pt={2}>
                    {options.map((o) => {
                      const chosen = (postSpec.fields ?? []).some((f) => f.ref === o.ref);
                      return (
                        <WrapItem key={o.ref}>
                          <Checkbox
                            size="sm"
                            isChecked={chosen}
                            onChange={(e) =>
                              updatePost({ fields: e.target.checked ? [...(postSpec.fields ?? []), { ref: o.ref }] : (postSpec.fields ?? []).filter((f) => f.ref !== o.ref) })
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
              <SortEditor order={postSpec.order ?? []} options={summarised ? outputOptions : options} onChange={(order) => updatePost({ order })} />
            </Step>
            <Step title={t('Calculate')} color="teal.200" hint={t('On the rows returned: vs. last year, running totals, shares, ranks, outliers.')}>
              <TransformsEditor transforms={draft.transforms ?? []} columns={state.result?.columns ?? []} onChange={(transforms) => update({ transforms })} />
            </Step>
            <Step title={t('Row limit')} color="gray.400">
              <HStack>
                <Input
                  size="sm"
                  type="number"
                  min={1}
                  max={ws.limits.query_max_rows}
                  maxW="140px"
                  placeholder={String(ws.limits.query_default_rows ?? 2000)}
                  value={draft.limit ?? ''}
                  onChange={(e) => update({ limit: e.target.value ? Math.min(Number(e.target.value), ws.limits.query_max_rows ?? 10000) : null })}
                  aria-label={t('Row limit')}
                />
                <Text fontSize="xs" color="faintText">
                  {t('rows shown · each source reads up to {limit}', { limit: (ws.limits.federation_source_rows ?? 100_000).toLocaleString(locale()) })}
                </Text>
              </HStack>
            </Step>
          </>
        )}
      </VStack>
    </Box>
  );

  const results = (
    <Flex direction="column" h="100%" bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden">
      {!runnable && draft.sources.length > 0 && (
        <Alert status="info" fontSize="sm" py={2}>
          <AlertIcon />
          {prepared.problems.join(' · ')}
        </Alert>
      )}
      <ParametersBar defs={paramDefs} shapes={paramShapes} values={paramValues} onValues={setParamValues} onDefs={canEdit ? setDefs : null} typeEditable />
      {report && (
        <Flex px={3} py={1.5} borderBottom="1px solid" borderColor="lineColor" align="center" gap={2}>
          <ButtonGroup size="xs" isAttached variant="outline">
            <Button onClick={() => setView('result')} isActive={view === 'result'} leftIcon={<TableIcon boxSize={3} />} data-testid="view-result">
              {t('Result')}
            </Button>
            <Button onClick={() => setView('report')} isActive={view === 'report'} leftIcon={<MergeIcon boxSize={3} />} data-testid="view-report">
              {t('Match report')}
            </Button>
          </ButtonGroup>
          <MatchHeadline report={report} labels={labels} />
        </Flex>
      )}
      <Box flex={1} minH={0} overflowY={view === 'report' && report ? 'auto' : undefined}>
        {view === 'report' && report ? (
          <MatchReport info={report} labels={labels} />
        ) : (
          <ResultView
            state={state}
            onCancel={cancel}
            smartDates={smartDates}
            onSmartDates={setSmartDates}
            filename={saved ? saved.name : 'combined'}
            viz={viz}
            onVizChange={setViz}
            empty={
              <Flex h="100%" align="center" justify="center" p={6} color="mutedText" fontSize="sm" textAlign="center">
                {draft.sources.length === 0
                  ? t('Add the sources to combine. Each one is read on its database, then they are joined here.')
                  : t('Run to see the combined rows (Ctrl/Cmd + Enter).')}
              </Flex>
            }
          />
        )}
      </Box>
    </Flex>
  );

  return (
    <Flex direction="column" h="100%" gap={3}>
      <QuestionHeader
        title={t('Combine sources')}
        subtitle={draft.sources.length ? draft.sources.map((s) => s.label || s.alias).join(' + ') : t('Join results from several databases and files')}
        saved={saved}
        dirty={dirty}
        defaultName={draft.sources.map((s) => s.label || s.alias).join(' + ') || t('Combined')}
        payload={() => (runnable ? { kind: 'federated', spec: prepared.spec, viz, parameters: paramDefs } : null)}
        onRevert={() => {
          if (!saved) return;
          setDraft(saved.spec as FederatedSpec);
          setViz(saved.viz ?? DEFAULT_VIZ);
          setDefs(saved.parameters);
        }}
        onSaved={() => {
          if (saved) return;
          try {
            sessionStorage.removeItem(DRAFT_KEY);
          } catch {
            // nothing to clean up
          }
        }}
      >
        <Tooltip label={t('Run automatically after each change')} hasArrow>
          <HStack spacing={1.5}>
            <Switch size="sm" id="combine-auto" isChecked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
            <Text as="label" htmlFor="combine-auto" fontSize="xs" color="mutedText">
              {t('Live preview')}
            </Text>
          </HStack>
        </Tooltip>
        <Button size="sm" leftIcon={<RefreshIcon boxSize={4} />} onClick={runNow} isDisabled={!runnable} data-testid="run-combined">
          {t('Run')}
        </Button>
        {!saved && (
          <Button size="sm" variant="ghost" onClick={() => setDraft(emptySpec())} isDisabled={draft.sources.length === 0}>
            {t('Start over')}
          </Button>
        )}
      </QuestionHeader>

      <Box flex={1} minH={0}>
        {vertical ? (
          <VStack align="stretch" spacing={4}>
            {steps}
            <Box h="70vh">{results}</Box>
          </VStack>
        ) : (
          <Split id="combine-split" first={steps} second={results} defaultFirst="42%" minFirst="28%" minSecond="30%" />
        )}
      </Box>

      <SourceDialog
        source={editing?.source ?? null}
        taken={taken(editing?.source.alias ?? null)}
        onClose={() => setEditing(null)}
        onSave={saveSource}
      />
    </Flex>
  );
}

function defaultSql(spec: FederatedSpec): string {
  const [first, ...rest] = spec.sources;
  if (!first) return '';
  return `SELECT *\nFROM ${first.alias}${rest.map((s) => `\n-- JOIN ${s.alias} ON ${first.alias}.key = ${s.alias}.key`).join('')}`;
}

function MatchHeadline({ report, labels }: { report: FederationInfo; labels: Record<string, string> }) {
  const worst = report.joins
    .map((j) => ({ j, pct: matchSummary(j, '', '').leftPct }))
    .sort((a, b) => b.pct - a.pct)[0];
  if (!worst) return null;
  return (
    <Badge colorScheme={worst.pct > 20 ? 'orange' : 'green'} fontSize="2xs" textTransform="none" data-testid="match-headline">
      {t('{pct} % of keys without a match in {source}', { pct: worst.pct, source: labels[worst.j.source] || worst.j.source })}
    </Badge>
  );
}

const ICONS = { question: ChartIcon, builder: TableIcon, sql: CodeIcon, dataset: UploadIcon };

function SourceRow({ source, first, preview, onEdit, onRemove }: {
  source: Source;
  first: boolean;
  preview?: { isPending: boolean; isError: boolean; error: unknown; data?: { federation?: { combined_columns: ColumnHint[]; sources: { rows: number }[] } | null } };
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const Icon = ICONS[source.type];
  const cols = preview?.data?.federation?.combined_columns ?? [];
  const what =
    source.type === 'question' ? t('saved question') : source.type === 'dataset' ? t('uploaded file') : source.type === 'sql' ? t('SQL on {connection}', { connection: source.connection }) : `${source.spec?.connection}: ${source.spec?.source.table}`;
  return (
    <Flex align="center" gap={2.5} border="1px solid" borderColor="lineColor" borderRadius="md" px={2.5} py={1.5} data-testid="source-row">
      <Icon boxSize={4} color="brand.400" flexShrink={0} />
      <Box flex={1} minW={0}>
        <HStack spacing={1.5}>
          <Text fontSize="sm" fontWeight={600} noOfLines={1}>
            {source.label || source.alias}
          </Text>
          <Badge fontSize="2xs" fontFamily="mono" textTransform="none">
            {source.alias}
          </Badge>
          {first && (
            <Badge fontSize="2xs" colorScheme="brand">
              {t('first')}
            </Badge>
          )}
        </HStack>
        <Text as="div" fontSize="xs" color={preview?.isError ? 'red.400' : 'mutedText'} noOfLines={1}>
          {what}
          {' · '}
          {!preview ? '' : preview.isPending ? <Spinner size="xs" /> : preview.isError ? apiErrorMessage(preview.error, t('Could not read it')) : tn(cols.length, '{n} column: {names}', '{n} columns: {names}', { names: cols.map((c) => c.name).join(', ') })}
        </Text>
      </Box>
      {source.type === 'question' && source.question_id && (
        <Button as={RouterLink} to={`/questions/${source.question_id}`} size="xs" variant="ghost">
          {t('Open')}
        </Button>
      )}
      {onEdit && <IconButton aria-label={t('Change {name}', { name: source.alias })} size="xs" variant="ghost" icon={<PencilIcon boxSize={3.5} />} onClick={onEdit} />}
      {onRemove && <IconButton aria-label={t('Remove {name}', { name: source.alias })} size="xs" variant="ghost" icon={<XIcon boxSize={3.5} />} onClick={onRemove} />}
    </Flex>
  );
}
