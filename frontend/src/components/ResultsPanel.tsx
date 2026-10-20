import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert, AlertDescription, AlertIcon, Badge, Box, Button, Flex, HStack, Menu, MenuButton, MenuDivider, MenuItem,
  MenuList, Table, Tbody, Td, Text, Th, Thead, Tr, VStack, useToast,
} from '@chakra-ui/react';
import type { SearchHit } from '../api';
import type { SearchState } from '../hooks/useSearch';
import { buildCsv, downloadText, safeFilename } from '../lib/csv';
import type { CsvDelimiter } from '../lib/csv';
import { ChevronDownIcon, DownloadIcon, TableIcon } from '../icons';
import { Highlight } from './Highlight';
import { RowDrawer } from './RowDrawer';
import { t, tn } from '../i18n/index.ts';

const MAX_COLUMNS = 10;
const CELL_PREVIEW_CHARS = 300;

interface Group {
  table: string;
  hits: SearchHit[];
}

function groupHits(results: SearchHit[]): Group[] {
  const byTable = new Map<string, SearchHit[]>();
  for (const hit of results) {
    const list = byTable.get(hit.table);
    if (list) list.push(hit);
    else byTable.set(hit.table, [hit]);
  }
  return Array.from(byTable, ([table, hits]) => ({ table, hits })).sort(
    (a, b) => b.hits.length - a.hits.length || a.table.localeCompare(b.table),
  );
}

/** Identifier columns first, then the columns that matched, then the rest. */
function displayColumns(group: Group): { visible: string[]; hidden: number; matched: Set<string> } {
  const matched = new Set<string>();
  const ids = new Set<string>();
  for (const hit of group.hits) {
    hit.matched_columns.forEach((c) => matched.add(c));
    if (hit.id_column) ids.add(hit.id_column);
  }
  const all = group.hits[0].cols;
  const ordered = [
    ...Array.from(ids),
    ...Array.from(matched).filter((c) => !ids.has(c)),
    ...all.filter((c) => !ids.has(c) && !matched.has(c)),
  ];
  return { visible: ordered.slice(0, MAX_COLUMNS), hidden: Math.max(0, ordered.length - MAX_COLUMNS), matched };
}

function cellText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

interface ResultsPanelProps {
  state: SearchState;
  connectionLabel: string;
  onOpenTable: (table: string) => void;
}

export function ResultsPanel({ state, connectionLabel, onOpenTable }: ResultsPanelProps) {
  const toast = useToast();
  const params = state.params;
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [drawerHit, setDrawerHit] = useState<SearchHit | null>(null);

  const groups = useMemo(() => groupHits(state.results), [state.results]);
  const group = groups.find((g) => g.table === selectedTable) ?? groups[0];
  const columns = useMemo(() => (group ? displayColumns(group) : null), [group]);

  if (!params) return null;
  const { phrase, matchMode, caseSensitive } = params;
  const fileBase = ['ncode', connectionLabel, phrase];

  const exportTable = (delimiter: CsvDelimiter) => {
    if (!group) return;
    const csv = buildCsv(group.hits[0].cols, group.hits.map((h) => h.row), delimiter);
    downloadText(`${safeFilename(...fileBase, group.table)}.csv`, csv);
    toast({ title: tn(group.hits.length, 'Exported {n} row from {table}', 'Exported {n} rows from {table}', { table: group.table }), status: 'success', duration: 2500 });
  };

  const exportAll = (delimiter: CsvDelimiter) => {
    const header = ['_table', '_matched'];
    const seen = new Set(header);
    for (const hit of state.results) {
      for (const column of hit.cols) {
        if (!seen.has(column)) {
          seen.add(column);
          header.push(column);
        }
      }
    }
    const rows = state.results.map((h) => ({ ...h.row, _table: h.table, _matched: h.matched_columns.join(', ') }));
    downloadText(`${safeFilename(...fileBase)}.csv`, buildCsv(header, rows, delimiter));
    toast({ title: t('Exported {rows} from {tables}', { rows: tn(rows.length, '{n} row', '{n} rows'), tables: tn(groups.length, '{n} table', '{n} tables') }), status: 'success', duration: 2500 });
  };

  return (
    <VStack align="stretch" spacing={4}>
      <Flex justify="space-between" align="center" gap={3} wrap="wrap">
        <Box>
          <Text fontSize="xl" fontWeight={650}>
            {tn(state.results.length, '{n} match', '{n} matches')} {tn(groups.length, 'in {n} table', 'in {n} tables')}
          </Text>
          <Text fontSize="sm" color="mutedText">
            {t('Scanned {processed} of {total} tables', { processed: state.progress.processed, total: state.progress.total })}
            {state.elapsedSec !== null && t(' in {s}s', { s: state.elapsedSec.toFixed(1) })} · “{phrase}”
          </Text>
        </Box>
        {groups.length > 0 && (
          <Menu placement="bottom-end">
            <MenuButton as={Button} variant="subtle" leftIcon={<DownloadIcon boxSize={4} />} rightIcon={<ChevronDownIcon boxSize={4} />}>
              {t('Export CSV')}
            </MenuButton>
            <MenuList minW="260px">
              <Text px={3} pb={1} fontSize="xs" color="faintText" fontWeight={600}>
                {t('THIS TABLE ({table})', { table: group?.table })}
              </Text>
              <MenuItem onClick={() => exportTable(';')}>{t('For Excel (semicolon)')}</MenuItem>
              <MenuItem onClick={() => exportTable(',')}>{t('Standard (comma)')}</MenuItem>
              <MenuDivider />
              <Text px={3} pb={1} fontSize="xs" color="faintText" fontWeight={600}>
                {tn(state.results.length, 'ALL RESULTS ({n} row)', 'ALL RESULTS ({n} rows)')}
              </Text>
              <MenuItem onClick={() => exportAll(';')}>{t('For Excel (semicolon)')}</MenuItem>
              <MenuItem onClick={() => exportAll(',')}>{t('Standard (comma)')}</MenuItem>
            </MenuList>
          </Menu>
        )}
      </Flex>

      {state.status === 'cancelled' && (
        <Notice status="warning">{t('The search was stopped. These are the results found before that.')}</Notice>
      )}
      {state.status === 'error' && <Notice status="error">{state.message ? t('The search failed: {message}', { message: state.message }) : t('The search failed.')}</Notice>}
      {state.errors.length > 0 && (
        <Notice status="error">
          {tn(state.errors.length, '{n} table could not be searched, so results may be incomplete.', '{n} tables could not be searched, so results may be incomplete.')}
          <Box mt={1} fontSize="xs">
            {state.errors.slice(0, 4).map((e) => (
              <Text key={e.table}>
                <b>{e.table}</b>: {e.error}
              </Text>
            ))}
            {state.errors.length > 4 && <Text>{t('…and {n} more', { n: state.errors.length - 4 })}</Text>}
          </Box>
        </Notice>
      )}
      {(state.truncatedTables.length > 0 || state.resultsCapped) && (
        <Notice status="info">
          {state.resultsCapped && t('The overall result limit was reached. ')}
          {state.truncatedTables.length > 0 &&
            tn(state.truncatedTables.length, '{n} table has more matches than shown ({limit} per table). ', '{n} tables have more matches than shown ({limit} per table). ', { limit: params.rowLimit })}
          {t('Narrow the phrase or the tables, or raise “rows / table”.')}
        </Notice>
      )}

      {group && columns && (
        <Flex gap={4} direction={{ base: 'column', lg: 'row' }} align="stretch">
          <VStack
            align="stretch"
            spacing={1}
            w={{ base: '100%', lg: '250px' }}
            flexShrink={0}
            maxH={{ base: '200px', lg: '640px' }}
            overflowY="auto"
            bg="panelBg"
            border="1px solid"
            borderColor="lineColor"
            borderRadius="xl"
            p={2}
          >
            {groups.map((g) => {
              const active = g.table === group.table;
              return (
                <Flex
                  key={g.table}
                  as="button"
                  type="button"
                  align="center"
                  gap={2}
                  px={3}
                  py={2}
                  borderRadius="lg"
                  textAlign="left"
                  bg={active ? 'rgba(99,102,241,0.16)' : 'transparent'}
                  color={active ? 'bodyText' : 'mutedText'}
                  _hover={{ bg: active ? 'rgba(99,102,241,0.16)' : 'panelHover' }}
                  onClick={() => setSelectedTable(g.table)}
                >
                  <TableIcon boxSize={4} color={active ? 'brand.300' : 'faintText'} flexShrink={0} />
                  <Text flex={1} fontFamily="mono" fontSize="sm" noOfLines={1} fontWeight={active ? 600 : 400}>
                    {g.table}
                  </Text>
                  <Badge colorScheme={active ? 'brand' : undefined} bg={active ? undefined : 'chipBg'} color={active ? undefined : 'mutedText'}>
                    {g.hits.length}
                    {state.truncatedTables.includes(g.table) ? '+' : ''}
                  </Badge>
                </Flex>
              );
            })}
          </VStack>

          <Box flex={1} minW={0} bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden">
            <Flex px={4} py={3} borderBottom="1px solid" borderColor="lineColor" justify="space-between" align="center" gap={3}>
              <HStack spacing={3} minW={0}>
                <Text fontFamily="mono" fontWeight={600} noOfLines={1}>
                  {group.table}
                </Text>
                <Text fontSize="xs" color="mutedText" whiteSpace="nowrap">
                  {tn(group.hits.length, '{n} row', '{n} rows')}
                  {columns.hidden > 0 && tn(columns.hidden, ' · {n} more column in the record view', ' · {n} more columns in the record view')}
                </Text>
              </HStack>
              <HStack spacing={3}>
                <Text fontSize="xs" color="faintText" display={{ base: 'none', xl: 'block' }}>
                  {t('Click a row to open the full record')}
                </Text>
                <Button size="xs" variant="subtle" onClick={() => onOpenTable(group.table)}>
                  {state.truncatedTables.includes(group.table) ? t('See all matches →') : t('Open in table view →')}
                </Button>
              </HStack>
            </Flex>
            <Box overflow="auto" maxH="580px">
              <Table size="sm" variant="simple">
                <Thead position="sticky" top={0} zIndex={1} bg="panelBg">
                  <Tr>
                    {columns.visible.map((column) => (
                      <Th key={column} fontFamily="mono" textTransform="none" letterSpacing="normal" fontSize="xs" color={columns.matched.has(column) ? 'brand.300' : 'mutedText'} borderColor="lineColor" whiteSpace="nowrap">
                        {column}
                        {columns.matched.has(column) && ' ●'}
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {group.hits.map((hit, index) => (
                    <Tr key={index} cursor="pointer" _hover={{ bg: 'panelHover' }} onClick={() => setDrawerHit(hit)}>
                      {columns.visible.map((column) => {
                        const value = hit.row[column];
                        const isMatch = hit.matched_columns.includes(column);
                        return (
                          <Td key={column} maxW="300px" fontSize="sm" borderColor="lineColor" verticalAlign="top">
                            {value === null || value === undefined ? (
                              <Text as="i" color="faintText">
                                NULL
                              </Text>
                            ) : (
                              <Text noOfLines={2} wordBreak="break-word">
                                {isMatch ? (
                                  <Highlight text={cellText(value).slice(0, CELL_PREVIEW_CHARS)} phrase={phrase} mode={matchMode} caseSensitive={caseSensitive} />
                                ) : (
                                  cellText(value).slice(0, CELL_PREVIEW_CHARS)
                                )}
                              </Text>
                            )}
                          </Td>
                        );
                      })}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>
          </Box>
        </Flex>
      )}

      <RowDrawer hit={drawerHit} onClose={() => setDrawerHit(null)} phrase={phrase} matchMode={matchMode} caseSensitive={caseSensitive} />
    </VStack>
  );
}

function Notice({ status, children }: { status: 'info' | 'warning' | 'error'; children: ReactNode }) {
  return (
    <Alert status={status} borderRadius="xl" alignItems="flex-start" variant="subtle">
      <AlertIcon mt="2px" />
      <AlertDescription fontSize="sm">{children}</AlertDescription>
    </Alert>
  );
}
