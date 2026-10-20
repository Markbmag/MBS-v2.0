import { useMemo, useState } from 'react';
import {
  Badge, Box, Button, Checkbox, Flex, FormControl, FormLabel, HStack, IconButton, Input, Select, SimpleGrid, Text,
  Textarea, Tooltip, VStack, useToast,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { apiErrorMessage } from '../api';
import type { SchemaColumn, SchemaV2 } from '../api';
import { FilterEditor } from '../components/query/FilterEditor';
import { ColumnSelect } from '../components/query/ColumnSelect';
import { t } from '../i18n/index.ts';
import { PencilIcon, PlusIcon, TrashIcon } from '../icons';
import { ConfirmDialog, DialogShell } from '../library/dialogs';
import { AGGREGATES, humanize } from '../query/draft';
import type { FilterGroup } from '../query/types';
import type { ColumnFormat, NumberStyle } from '../viz/types';
import { SEMANTIC_TYPES, semantic, useMetrics } from './api';
import type { FieldMeta, Metric, MetricDefinition } from './api';

// ---------------------------------------------------------------- a column

function FormatFields({ format, onChange }: { format: ColumnFormat; onChange: (f: ColumnFormat) => void }) {
  return (
    <SimpleGrid columns={3} spacing={2}>
      <FormControl>
        <FormLabel fontSize="xs">{t('Numbers as')}</FormLabel>
        <Select size="sm" value={format.style ?? 'auto'} onChange={(e) => onChange({ ...format, style: e.target.value as NumberStyle })}>
          <option value="auto">{t('Automatic')}</option>
          <option value="number">{t('Number')}</option>
          <option value="currency">{t('Money')}</option>
          <option value="percent">{t('Percent (0.12 = 12 %)')}</option>
          <option value="plain">{t('Plain (no separators)')}</option>
        </Select>
      </FormControl>
      <FormControl isDisabled={format.style !== 'currency'}>
        <FormLabel fontSize="xs">{t('Currency')}</FormLabel>
        <Input size="sm" value={format.currency ?? ''} placeholder="EUR" maxLength={3} onChange={(e) => onChange({ ...format, currency: e.target.value.toUpperCase() || undefined })} />
      </FormControl>
      <FormControl>
        <FormLabel fontSize="xs">{t('Decimals')}</FormLabel>
        <Input size="sm" type="number" min={0} max={10} value={format.decimals ?? ''} placeholder={t('auto')} onChange={(e) => onChange({ ...format, decimals: e.target.value === '' ? null : Number(e.target.value) })} />
      </FormControl>
    </SimpleGrid>
  );
}

function cleanFormat(f: ColumnFormat): ColumnFormat | null {
  const out: ColumnFormat = {};
  if (f.style && f.style !== 'auto') out.style = f.style;
  if (f.style === 'currency' && f.currency) out.currency = f.currency;
  if (f.decimals !== null && f.decimals !== undefined) out.decimals = f.decimals;
  return Object.keys(out).length ? out : null;
}

export function FieldDialog({ connection, table, column, onClose }: { connection: string; table: string; column: SchemaColumn | null; onClose: () => void }) {
  return column ? <FieldForm connection={connection} table={table} column={column} onClose={onClose} /> : null;
}

function FieldForm({ connection, table, column, onClose }: { connection: string; table: string; column: SchemaColumn; onClose: () => void }) {
  const [meta, setMeta] = useState<FieldMeta>({
    display_name: column.display_name ?? '',
    description: column.description ?? '',
    semantic_type: column.semantic_type ?? '',
    hidden: !!column.hidden,
    parse_as_date: !!column.parse_as_date,
  });
  const [format, setFormat] = useState<ColumnFormat>((column.format as ColumnFormat) ?? {});
  const text = /char|text|string|clob/i.test(column.db_type) || column.parse_as_date;
  const set = (patch: Partial<FieldMeta>) => setMeta((m) => ({ ...m, ...patch }));
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title={`${table}.${column.name}`}
      submitLabel={t('Save')}
      size="lg"
      onSubmit={() => semantic.setField(connection, table, column.name, { ...meta, format: cleanFormat(format) })}
    >
      <Text fontSize="xs" color="mutedText" mt={-2}>
        {t('{dbType} · shown as {type}', { dbType: column.db_type, type: column.type })}
      </Text>
      <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={3}>
        <FormControl>
          <FormLabel fontSize="sm">{t('Display name')}</FormLabel>
          <Input size="sm" value={meta.display_name ?? ''} placeholder={humanize(column.name)} onChange={(e) => set({ display_name: e.target.value })} maxLength={200} data-testid="field-display-name" />
        </FormControl>
        <FormControl>
          <FormLabel fontSize="sm">{t('What it is')}</FormLabel>
          <Select size="sm" value={meta.semantic_type ?? ''} onChange={(e) => set({ semantic_type: e.target.value || null })} data-testid="field-semantic-type">
            <option value="">—</option>
            {SEMANTIC_TYPES.map((st) => (
              <option key={st.value} value={st.value}>
                {t(st.label)}
              </option>
            ))}
          </Select>
        </FormControl>
      </SimpleGrid>
      <FormControl>
        <FormLabel fontSize="sm">{t('Description')}</FormLabel>
        <Textarea size="sm" rows={2} value={meta.description ?? ''} onChange={(e) => set({ description: e.target.value })} maxLength={5000} placeholder={t('Shown as a tooltip on the column')} />
      </FormControl>
      <FormatFields format={format} onChange={setFormat} />
      <VStack align="stretch" spacing={2}>
        <Checkbox size="sm" isChecked={!!meta.hidden} onChange={(e) => set({ hidden: e.target.checked })} data-testid="field-hidden">
          {t('Hidden — not offered in the question builder and left out of “all columns” (still usable by name; not a permission)')}
        </Checkbox>
        <Checkbox size="sm" isChecked={!!meta.parse_as_date} isDisabled={!text && !meta.parse_as_date} onChange={(e) => set({ parse_as_date: e.target.checked })} data-testid="field-parse-date">
          {t('Read as dates — text like 2026-01-31, 31.01.2026 or unix time becomes a date-time (filters, “by month”); other values become empty')}
        </Checkbox>
      </VStack>
    </DialogShell>
  );
}

/** The columns of one table with their data-model settings; click a column to change them. */
export function EditableColumns({ connection, table, columns, onEdit }: { connection: string; table: string; columns: SchemaColumn[]; onEdit: (c: SchemaColumn) => void }) {
  void connection;
  void table;
  return (
    <VStack align="stretch" spacing={0}>
      {columns.map((col) => (
        <Flex
          key={col.name}
          as="button"
          type="button"
          onClick={() => onEdit(col)}
          align="center"
          gap={2}
          px={3}
          py={1.5}
          textAlign="left"
          borderTop="1px solid"
          borderColor="lineColor"
          _hover={{ bg: 'panelHover' }}
          opacity={col.hidden ? 0.55 : 1}
          data-testid="model-column"
        >
          <Box flex={1} minW={0}>
            <Text fontFamily="mono" fontSize="xs" noOfLines={1}>
              {col.name}
            </Text>
            {col.display_name && (
              <Text fontSize="xs" color="mutedText" noOfLines={1}>
                {col.display_name}
              </Text>
            )}
          </Box>
          {col.parse_as_date && <Badge fontSize="0.6rem" colorScheme="teal">{t('as date')}</Badge>}
          {col.hidden && <Badge fontSize="0.6rem">{t('hidden')}</Badge>}
          {col.semantic_type && <Badge fontSize="0.6rem" colorScheme="purple" textTransform="none">{col.semantic_type}</Badge>}
          <Tooltip label={col.db_type} hasArrow>
            <Badge fontSize="0.6rem" bg="chipBg" color="mutedText" textTransform="none">
              {col.type}
            </Badge>
          </Tooltip>
          <PencilIcon boxSize={3} color="faintText" />
        </Flex>
      ))}
    </VStack>
  );
}

// ---------------------------------------------------------------- relationships

export function ManualRelationships({ connection, schema }: { connection: string; schema: SchemaV2 }) {
  const toast = useToast();
  const list = useQuery({ queryKey: ['semantic', 'relationships', connection], queryFn: () => semantic.relationships(connection) });
  const [adding, setAdding] = useState(false);
  const remove = async (id: number) => {
    try {
      await semantic.deleteRelationship(connection, id);
      await list.refetch();
    } catch (e) {
      toast({ status: 'error', title: t('Could not remove it'), description: apiErrorMessage(e, t('Please try again')) });
    }
  };
  return (
    <Box>
      <Flex align="center" justify="space-between" mb={2}>
        <Text fontSize="xs" fontWeight={700} letterSpacing="0.08em" color="faintText">
          {t('RELATIONSHIPS ADDED BY HAND')}
        </Text>
        <Button size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} onClick={() => setAdding(true)} data-testid="add-relationship">
          {t('Relationship')}
        </Button>
      </Flex>
      {(list.data ?? []).length === 0 ? (
        <Text fontSize="sm" color="mutedText">
          {t('None. For tables without foreign keys, add how they relate (orders.customer_ref → customers.id): the question builder then joins them by itself.')}
        </Text>
      ) : (
        <VStack align="stretch" spacing={1}>
          {list.data!.map((r) => (
            <Flex key={r.id} align="center" gap={2} fontFamily="mono" fontSize="xs" border="1px solid" borderColor="lineColor" borderRadius="md" px={2} py={1}>
              <Text flex={1}>
                {String(r.from_table)}.{(r.from_columns as string[]).join(', ')} → {String(r.to_table)}.{(r.to_columns as string[]).join(', ')}
              </Text>
              <IconButton aria-label={t('Remove relationship')} size="xs" variant="ghost" icon={<TrashIcon boxSize={3} />} onClick={() => void remove(r.id)} />
            </Flex>
          ))}
        </VStack>
      )}
      {adding && <RelationshipDialog connection={connection} schema={schema} onClose={() => { setAdding(false); void list.refetch(); }} />}
    </Box>
  );
}

function RelationshipDialog({ connection, schema, onClose }: { connection: string; schema: SchemaV2; onClose: () => void }) {
  const tables = schema.tables.map((tb) => tb.name);
  const [from, setFrom] = useState({ table: '', column: '' });
  const [to, setTo] = useState({ table: '', column: '' });
  const colsOf = (name: string) => schema.tables.find((x) => x.name === name)?.columns.map((c) => c.name) ?? [];
  const side = (label: string, v: { table: string; column: string }, set: (v: { table: string; column: string }) => void, testId: string) => (
    <FormControl>
      <FormLabel fontSize="sm">{label}</FormLabel>
      <HStack>
        <Select size="sm" value={v.table} placeholder={t('Table…')} onChange={(e) => set({ table: e.target.value, column: '' })} data-testid={`${testId}-table`}>
          {tables.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        <Select size="sm" value={v.column} placeholder={t('Column…')} onChange={(e) => set({ ...v, column: e.target.value })} isDisabled={!v.table} data-testid={`${testId}-column`}>
          {colsOf(v.table).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </HStack>
    </FormControl>
  );
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title={t('Add a relationship')}
      submitLabel={t('Add')}
      canSubmit={!!(from.table && from.column && to.table && to.column)}
      onSubmit={() => semantic.addRelationship(connection, { from_table: from.table, from_columns: [from.column], to_table: to.table, to_columns: [to.column] })}
    >
      {side(t('Column that refers (many rows)'), from, setFrom, 'rel-from')}
      {side(t('Column it refers to (usually the id)'), to, setTo, 'rel-to')}
      <Text fontSize="xs" color="mutedText">
        {t('Works like a foreign key for the question builder (joins and suggestions). The database is not changed.')}
      </Text>
    </DialogShell>
  );
}

// ---------------------------------------------------------------- metrics

export function MetricsPanel({ connection, schema }: { connection: string; schema: SchemaV2 }) {
  const metrics = useMetrics(connection);
  const [editing, setEditing] = useState<Metric | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Metric | null>(null);
  return (
    <Box>
      <Flex align="center" justify="space-between" mb={2}>
        <Text fontSize="xs" fontWeight={700} letterSpacing="0.08em" color="faintText">
          {t('METRICS')}
        </Text>
        <Button size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} onClick={() => setEditing('new')} data-testid="new-metric">
          {t('Metric')}
        </Button>
      </Flex>
      {(metrics.data ?? []).length === 0 ? (
        <Text fontSize="sm" color="mutedText">
          {t('None yet. A metric is a named calculation (e.g. “Revenue” = sum of total of paid orders) that everyone picks in Summarise, so it is computed the same way everywhere.')}
        </Text>
      ) : (
        <VStack align="stretch" spacing={1}>
          {metrics.data!.map((m) => (
            <Flex key={m.id} align="center" gap={2} border="1px solid" borderColor="lineColor" borderRadius="md" px={3} py={1.5} data-testid="metric-item">
              <Box flex={1} minW={0}>
                <Text fontSize="sm" fontWeight={600}>
                  ★ {m.name}
                </Text>
                <Text fontSize="xs" color="mutedText" noOfLines={1}>
                  {AGGREGATES.find((a) => a.fn === m.definition.fn)?.label ?? m.definition.fn} {m.definition.ref ?? ''} · {m.table}
                  {m.definition.where ? t(' · with a condition') : ''}
                  {m.description ? ` · ${m.description}` : ''}
                </Text>
              </Box>
              <IconButton aria-label={t('Change {name}', { name: m.name })} size="xs" variant="ghost" icon={<PencilIcon boxSize={3} />} onClick={() => setEditing(m)} />
              <IconButton aria-label={t('Archive {name}', { name: m.name })} size="xs" variant="ghost" icon={<TrashIcon boxSize={3} />} onClick={() => setArchiving(m)} />
            </Flex>
          ))}
        </VStack>
      )}
      {editing && <MetricDialog connection={connection} schema={schema} metric={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        isOpen={archiving !== null}
        onClose={() => setArchiving(null)}
        title={t('Archive this metric?')}
        confirmLabel={t('Archive')}
        body={t('“{name}” disappears from Summarise. Saved questions that use it keep working.', { name: archiving?.name })}
        onConfirm={async () => {
          if (archiving) await semantic.archiveMetric(archiving);
        }}
      />
    </Box>
  );
}

function MetricDialog({ connection, schema, metric, onClose }: { connection: string; schema: SchemaV2; metric: Metric | null; onClose: () => void }) {
  const [name, setName] = useState(metric?.name ?? '');
  const [description, setDescription] = useState(metric?.description ?? '');
  const [table, setTable] = useState(metric?.table ?? '');
  const [fn, setFn] = useState<MetricDefinition['fn']>(metric?.definition.fn ?? 'sum');
  const [ref, setRef] = useState<string | undefined>(metric?.definition.ref ? (metric.definition.ref.includes('.') ? metric.definition.ref : `${metric.table}.${metric.definition.ref}`) : undefined);
  const [where, setWhere] = useState<FilterGroup>(metric?.definition.where ?? { op: 'and', rules: [] });
  const [format, setFormat] = useState<ColumnFormat>(metric?.format ?? {});
  const options = useMemo(
    () =>
      (schema.tables.find((tb) => tb.name === table)?.columns ?? [])
        .filter((c) => c.type !== 'binary')
        .map((c) => ({ ref: `${table}.${c.name}`, label: c.display_name || humanize(c.name), type: c.type })),
    [schema, table],
  );
  const needsColumn = AGGREGATES.find((a) => a.fn === fn)?.needsColumn ?? true;
  const cleanWhere = (g: FilterGroup): FilterGroup | null => {
    const rules = g.rules.filter((r) => ('rules' in r ? r.rules.length > 0 : !!r.ref));
    return rules.length ? { ...g, rules } : null;
  };
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title={metric ? t('Change “{name}”', { name: metric.name }) : t('New metric')}
      submitLabel={t('Save')}
      size="xl"
      canSubmit={!!name.trim() && !!table && (!needsColumn || !!ref)}
      onSubmit={() =>
        semantic.saveMetric(
          {
            name: name.trim(),
            description: description.trim() || null,
            connection,
            table,
            definition: { fn, ...(needsColumn && ref ? { ref } : {}), where: cleanWhere(where) },
            format: cleanFormat(format),
          },
          metric?.id,
        )
      }
    >
      <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={3}>
        <FormControl isRequired>
          <FormLabel fontSize="sm">{t('Name')}</FormLabel>
          <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t('Revenue')} data-testid="metric-name" />
        </FormControl>
        <FormControl isRequired>
          <FormLabel fontSize="sm">{t('Table')}</FormLabel>
          <Select size="sm" value={table} placeholder={t('Pick a table…')} onChange={(e) => { setTable(e.target.value); setRef(undefined); setWhere({ op: 'and', rules: [] }); }} data-testid="metric-table">
            {schema.tables.map((tb) => (
              <option key={tb.name} value={tb.name}>
                {tb.name}
              </option>
            ))}
          </Select>
        </FormControl>
      </SimpleGrid>
      <HStack align="flex-end">
        <FormControl maxW="200px">
          <FormLabel fontSize="sm">{t('Calculation')}</FormLabel>
          <Select size="sm" value={fn} onChange={(e) => setFn(e.target.value as MetricDefinition['fn'])} data-testid="metric-fn">
            {AGGREGATES.map((a) => (
              <option key={a.fn} value={a.fn}>
                {a.label}
              </option>
            ))}
          </Select>
        </FormControl>
        {needsColumn && (
          <FormControl>
            <FormLabel fontSize="sm">{t('Column')}</FormLabel>
            <ColumnSelect options={options} value={ref} onChange={setRef} types={fn === 'sum' || fn === 'avg' ? ['number'] : undefined} data-testid="metric-column" />
          </FormControl>
        )}
      </HStack>
      {table && (
        <Box>
          <Text fontSize="sm" fontWeight={500} mb={1}>
            {t('Only rows where…')}
          </Text>
          <FilterEditor group={where} onChange={setWhere} options={options} emptyText={t('Every row counts.')} testId="metric-where" />
        </Box>
      )}
      <FormatFields format={format} onChange={setFormat} />
      <FormControl>
        <FormLabel fontSize="sm">{t('Description')}</FormLabel>
        <Textarea size="sm" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} placeholder={t('How it is defined, who owns it')} />
      </FormControl>
    </DialogShell>
  );
}
