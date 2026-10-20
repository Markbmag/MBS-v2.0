import { useMemo, useState } from 'react';
import {
  Box, Button, Flex, FormControl, FormHelperText, FormLabel, Input, InputGroup, InputLeftElement, Select, Skeleton, Tab, TabList,
  TabPanel, TabPanels, Tabs, Text, useDisclosure,
} from '@chakra-ui/react';
import { CodeEditor } from '../components/sql/CodeEditor';
import { locale, t, tn } from '../i18n/index.ts';
import { ChartIcon, CodeIcon, SearchIcon, TableIcon, UploadIcon } from '../icons';
import { useQuestions } from '../library/api';
import { DialogShell } from '../library/dialogs';
import { humanize } from '../query/draft';
import { useSchema } from '../query/useSchema';
import { useWorkspace } from '../workspace/useWorkspace';
import { formatBytes, useDatasets } from './api';
import { aliasFor } from './logic';
import type { Source, SourceType } from './types';
import { UploadDialog } from './UploadDialog';

const TYPES: SourceType[] = ['question', 'builder', 'sql', 'dataset'];

interface Props {
  /** null = closed; {} = a new source */
  source: Partial<Source> | null;
  taken: string[];                 // aliases used by the other sources
  onClose: () => void;
  onSave: (source: Source) => void;
}

/** Add or change one source: a saved question, a table, SQL on a database, or an uploaded file. */
export function SourceDialog({ source, taken, onClose, onSave }: Props) {
  return source ? <SourceForm initial={source} taken={taken} onClose={onClose} onSave={onSave} /> : null;
}

function SourceForm({ initial, taken, onClose, onSave }: { initial: Partial<Source>; taken: string[]; onClose: () => void; onSave: (s: Source) => void }) {
  const ws = useWorkspace();
  const isNew = !initial.alias;
  const [type, setType] = useState<SourceType>(initial.type ?? 'question');
  const [label, setLabel] = useState(initial.label ?? '');
  const [alias, setAlias] = useState(initial.alias ?? '');
  const [questionId, setQuestionId] = useState<number | undefined>(initial.question_id);
  const [questionName, setQuestionName] = useState('');
  const [connection, setConnection] = useState(initial.connection ?? initial.spec?.connection ?? ws.activeKey ?? ws.connections[0]?.key ?? '');
  const [table, setTable] = useState(initial.spec?.source?.table ?? '');
  const [sql, setSql] = useState(initial.sql ?? '');
  const [datasetId, setDatasetId] = useState<number | undefined>(initial.dataset_id);
  const [datasetName, setDatasetName] = useState('');
  const upload = useDisclosure();

  const fallbackLabel =
    type === 'question' ? questionName : type === 'dataset' ? datasetName : type === 'builder' ? humanize(table) : `SQL on ${connection}`;
  const finalLabel = label.trim() || fallbackLabel || 'Source';
  const finalAlias = alias.trim() || aliasFor(finalLabel, taken);
  const aliasOk = /^[a-z_][a-z0-9_]{0,31}$/.test(finalAlias) && !taken.includes(finalAlias) && finalAlias !== 'result';

  const build = (): Source | null => {
    const base = { alias: finalAlias, label: finalLabel, limit: initial.limit ?? null };
    if (type === 'question') return questionId ? { ...base, type, question_id: questionId } : null;
    if (type === 'dataset') return datasetId ? { ...base, type, dataset_id: datasetId } : null;
    if (type === 'builder') return connection && table ? { ...base, type, spec: { version: 1, connection, source: { table } } } : null;
    return connection && sql.trim() ? { ...base, type, connection, sql } : null;
  };
  const built = build();

  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title={isNew ? t('Add a source') : t('Change “{name}”', { name: initial.label || initial.alias })}
      submitLabel={isNew ? t('Add') : t('Save')}
      size="2xl"
      canSubmit={!!built && aliasOk}
      onSubmit={async () => {
        if (built) onSave(built);
      }}
    >
      <Tabs size="sm" variant="soft-rounded" colorScheme="brand" index={TYPES.indexOf(type)} onChange={(i) => setType(TYPES[i])} isLazy>
        <TabList flexWrap="wrap" gap={1}>
          <Tab gap={1.5} data-testid="source-tab-question">
            <ChartIcon boxSize={3.5} /> {t('Saved question')}
          </Tab>
          <Tab gap={1.5} data-testid="source-tab-table">
            <TableIcon boxSize={3.5} /> {t('Table')}
          </Tab>
          <Tab gap={1.5} data-testid="source-tab-sql">
            <CodeIcon boxSize={3.5} /> SQL
          </Tab>
          <Tab gap={1.5} data-testid="source-tab-dataset">
            <UploadIcon boxSize={3.5} /> {t('Uploaded file')}
          </Tab>
        </TabList>
        <TabPanels>
          <TabPanel px={0}>
            <QuestionPicker value={questionId} onPick={(id, name) => {
              setQuestionId(id);
              setQuestionName(name);
            }} />
          </TabPanel>
          <TabPanel px={0}>
            <Flex gap={3} direction={{ base: 'column', md: 'row' }}>
              <ConnectionSelect value={connection} onChange={(c) => {
                setConnection(c);
                setTable('');
              }} />
              <TableSelect connection={connection} value={table} onChange={setTable} />
            </Flex>
            <Text fontSize="xs" color="faintText" mt={2}>
              {t('Every column of the table, up to the row limit for sources ({limit} rows). To read less, save a question with filters and use it instead.', { limit: (ws.limits.federation_source_rows ?? 100_000).toLocaleString(locale()) })}
            </Text>
          </TabPanel>
          <TabPanel px={0}>
            <ConnectionSelect value={connection} onChange={setConnection} />
            <SqlBox connection={connection} value={sql} onChange={setSql} />
          </TabPanel>
          <TabPanel px={0}>
            <DatasetPicker value={datasetId} onPick={(id, name) => {
              setDatasetId(id);
              setDatasetName(name);
            }} onUpload={upload.onOpen} />
          </TabPanel>
        </TabPanels>
      </Tabs>
      <Flex gap={3} direction={{ base: 'column', md: 'row' }}>
        <FormControl>
          <FormLabel fontSize="sm">{t('Label')}</FormLabel>
          <Input size="sm" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={fallbackLabel || t('e.g. MES builds')} maxLength={120} data-testid="source-label" />
        </FormControl>
        <FormControl isInvalid={!aliasOk}>
          <FormLabel fontSize="sm">{t('Name in SQL')}</FormLabel>
          <Input size="sm" fontFamily="mono" value={alias} onChange={(e) => setAlias(e.target.value.toLowerCase())} placeholder={finalAlias} isDisabled={!isNew} maxLength={32} />
          <FormHelperText fontSize="xs">{isNew ? t('Lower case letters, digits and _') : t('Fixed once added (joins and SQL use it)')}</FormHelperText>
        </FormControl>
      </Flex>
      <UploadDialog isOpen={upload.isOpen} onClose={upload.onClose} onUploaded={(d) => {
        setDatasetId(d.id);
        setDatasetName(d.name);
      }} />
    </DialogShell>
  );
}

function ConnectionSelect({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const ws = useWorkspace();
  return (
    <FormControl mb={2}>
      <FormLabel fontSize="sm">{t('Database')}</FormLabel>
      <Select size="sm" value={value} onChange={(e) => onChange(e.target.value)} data-testid="source-connection">
        {ws.connections.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label || c.key}
          </option>
        ))}
      </Select>
    </FormControl>
  );
}

function TableSelect({ connection, value, onChange }: { connection: string; value: string; onChange: (table: string) => void }) {
  const schema = useSchema(connection);
  const names = useMemo(() => (schema.data?.tables ?? []).map((tb) => tb.name).sort((a, b) => a.localeCompare(b)), [schema.data]);
  return (
    <FormControl>
      <FormLabel fontSize="sm">{t('Table')}</FormLabel>
      {schema.isPending ? (
        <Skeleton h="32px" />
      ) : (
        <Select size="sm" value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('Pick a table…')} data-testid="source-table">
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      )}
    </FormControl>
  );
}

function SqlBox({ connection, value, onChange }: { connection: string; value: string; onChange: (sql: string) => void }) {
  const ws = useWorkspace();
  const schema = useSchema(connection);
  const autocomplete = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const tb of schema.data?.tables ?? []) out[tb.name] = tb.columns.map((c) => c.name);
    return out;
  }, [schema.data]);
  const engine = ws.connections.find((c) => c.key === connection)?.engine;
  return (
    <Box h="200px" border="1px solid" borderColor="lineColor" borderRadius="md" overflow="hidden" data-testid="source-sql">
      <CodeEditor value={value} onChange={onChange} onRun={() => undefined} engine={engine} schema={autocomplete} />
    </Box>
  );
}

function QuestionPicker({ value, onPick }: { value?: number; onPick: (id: number, name: string) => void }) {
  const [text, setText] = useState('');
  const found = useQuestions({ q: text.trim() || undefined, limit: 50 });
  const usable = (found.data ?? []).filter((q) => q.kind !== 'federated');
  return (
    <>
      <InputGroup size="sm" mb={2}>
        <InputLeftElement pointerEvents="none">
          <SearchIcon boxSize={3.5} color="faintText" />
        </InputLeftElement>
        <Input placeholder={t('Find a saved question…')} value={text} onChange={(e) => setText(e.target.value)} data-testid="source-question-search" />
      </InputGroup>
      <Box maxH="240px" overflowY="auto" border="1px solid" borderColor="lineColor" borderRadius="md">
        {found.isPending && <Skeleton h="60px" />}
        {found.data && usable.length === 0 && (
          <Text fontSize="sm" color="faintText" p={3}>
            {t('No saved questions found. Multi-source questions cannot be used as sources.')}
          </Text>
        )}
        {usable.map((q) => (
          <PickRow key={q.id} active={value === q.id} onClick={() => onPick(q.id, q.name)} testId="source-question-row">
            <Text fontSize="sm" fontWeight={600} noOfLines={1}>
              {q.name}
            </Text>
            <Text fontSize="xs" color="mutedText" noOfLines={1}>
              {q.kind === 'sql' ? 'SQL' : t('Question')} · {q.connection} · {q.collection?.name}
            </Text>
          </PickRow>
        ))}
      </Box>
    </>
  );
}

function DatasetPicker({ value, onPick, onUpload }: { value?: number; onPick: (id: number, name: string) => void; onUpload: () => void }) {
  const list = useDatasets();
  return (
    <>
      <Box maxH="240px" overflowY="auto" border="1px solid" borderColor="lineColor" borderRadius="md" mb={2}>
        {list.isPending && <Skeleton h="60px" />}
        {list.data?.length === 0 && (
          <Text fontSize="sm" color="faintText" p={3}>
            {t('No uploaded files yet.')}
          </Text>
        )}
        {list.data?.map((d) => (
          <PickRow key={d.id} active={value === d.id} onClick={() => onPick(d.id, d.name)} testId="source-dataset-row">
            <Text fontSize="sm" fontWeight={600} noOfLines={1}>
              {d.name}
            </Text>
            <Text fontSize="xs" color="mutedText" noOfLines={1}>
              {tn(d.row_count, '{n} row', '{n} rows')} · {tn(d.columns.length, '{n} column', '{n} columns')} · {formatBytes(d.size_bytes)} · {d.collection?.name}
            </Text>
          </PickRow>
        ))}
      </Box>
      <Button size="sm" variant="subtle" leftIcon={<UploadIcon boxSize={4} />} onClick={onUpload} data-testid="source-upload">
        {t('Upload a file…')}
      </Button>
    </>
  );
}

function PickRow({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId: string }) {
  return (
    <Box
      as="button"
      type="button"
      w="100%"
      textAlign="left"
      px={3}
      py={2}
      bg={active ? 'rgba(99,102,241,0.14)' : undefined}
      _hover={{ bg: active ? undefined : 'panelHover' }}
      borderBottom="1px solid"
      borderColor="lineColor"
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </Box>
  );
}
