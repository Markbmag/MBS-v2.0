import { useEffect, useMemo, useState } from 'react';
import {
  Alert, AlertDescription, AlertIcon, Badge, Box, Button, ButtonGroup, Flex, HStack, Input, InputGroup,
  InputLeftElement, Menu, MenuButton, MenuItem, MenuList, Select, Skeleton, Spinner, Switch, Table, Tbody, Td, Text,
  Th, Thead, Tr, VStack, useToast,
} from '@chakra-ui/react';
import { apiErrorMessage, apiErrorMessageAsync, http } from '../api';
import type { BrowseResponse, BrowseRow, ColumnInfo, Limits, MatchMode, SearchHit, TableInfo } from '../api';
import { saveBlob, safeFilename } from '../lib/csv';
import type { ExplorerTarget } from '../lib/explorer';
import { ChevronDownIcon, DownloadIcon, SearchIcon, TableIcon } from '../icons';
import { Link as RouterLink } from 'react-router-dom';
import { TableProfile } from '../analysis/TableProfile';
import { Highlight } from './Highlight';
import { RowDrawer } from './RowDrawer';
import { locale, t, tn } from '../i18n/index.ts';

interface FilterState {
  q: string;
  mode: MatchMode;
  caseSensitive: boolean;
  includeNumbers: boolean;
}

interface SortState {
  column: string;
  desc: boolean;
}

interface BrowseResult {
  key: string;
  data?: BrowseResponse;
  error?: string;
}

interface StructureResult {
  table: string;
  columns?: ColumnInfo[];
  error?: string;
}

const PAGE_SIZES = [25, 50, 100, 200];
const MODES: { value: MatchMode; label: string }[] = [
  { value: 'contains', label: t('Contains') },
  { value: 'starts_with', label: t('Starts with') },
  { value: 'exact', label: t('Exact') },
];

function cellText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

interface TableExplorerProps {
  connectionKey: string;
  connectionLabel: string;
  tables: TableInfo[] | null;
  tablesError: string | null;
  onReloadTables: () => void;
  target: ExplorerTarget;
  limits: Limits;
}

export function TableExplorer({
  connectionKey, connectionLabel, tables, tablesError, onReloadTables, target, limits,
}: TableExplorerProps) {
  const toast = useToast();
  const [table, setTable] = useState<string | null>(target.table);
  const [tab, setTab] = useState<'data' | 'structure' | 'profile'>('data');
  const [listFilter, setListFilter] = useState('');
  const [filterText, setFilterText] = useState(target.q);
  const [applied, setApplied] = useState<FilterState>({
    q: target.q.trim(),
    mode: target.mode,
    caseSensitive: target.caseSensitive,
    includeNumbers: target.includeNumbers,
  });
  const pageSizes = PAGE_SIZES.filter((n) => n <= limits.max_row_limit);
  const [pageSize, setPageSize] = useState(pageSizes.includes(50) ? 50 : (pageSizes[pageSizes.length - 1] ?? 25));
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SortState | null>(null);
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [structure, setStructure] = useState<StructureResult | null>(null);
  const [drawerRow, setDrawerRow] = useState<BrowseRow | null>(null);
  const [exporting, setExporting] = useState(false);

  // The request that the current state describes.
  const query = useMemo(
    () =>
      table
        ? {
            table,
            limit: pageSize,
            offset,
            sort: sort?.column,
            desc: sort?.desc ?? false,
            q: applied.q || undefined,
            mode: applied.mode,
            case_sensitive: applied.caseSensitive,
            include_numeric: applied.includeNumbers,
          }
        : null,
    [table, pageSize, offset, sort, applied],
  );
  const queryKey = query ? JSON.stringify(query) : '';

  useEffect(() => {
    if (!query || tab !== 'data') return;
    let cancelled = false;
    const key = JSON.stringify(query);
    http
      .get<BrowseResponse>(`/api/connections/${connectionKey}/browse`, { params: query })
      .then((res) => {
        if (!cancelled) setResult({ key, data: res.data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setResult({ key, error: apiErrorMessage(error, t('Could not load this table')) });
      });
    return () => {
      cancelled = true;
    };
  }, [connectionKey, query, tab]);

  useEffect(() => {
    if (!table || tab !== 'structure') return;
    let cancelled = false;
    http
      .get<{ columns: ColumnInfo[] }>(`/api/connections/${connectionKey}/structure`, { params: { table } })
      .then((res) => {
        if (!cancelled) setStructure({ table, columns: res.data.columns });
      })
      .catch((error: unknown) => {
        if (!cancelled) setStructure({ table, error: apiErrorMessage(error, t('Could not read the table structure')) });
      });
    return () => {
      cancelled = true;
    };
  }, [connectionKey, table, tab]);

  const visibleTables = useMemo(() => {
    if (!tables) return [];
    const needle = listFilter.trim().toLowerCase();
    return needle ? tables.filter((t) => t.name.toLowerCase().includes(needle)) : tables;
  }, [tables, listFilter]);

  const loading = query !== null && tab === 'data' && result?.key !== queryKey;
  const data = result?.data;
  const error = result && result.key === queryKey ? result.error : undefined;

  // ------------------------------------------------------------------ actions
  const selectTable = (name: string) => {
    setTable(name);
    setOffset(0);
    setSort(null);
    setResult(null);
    setStructure(null);
  };

  const changeFilter = (patch: Partial<FilterState>) => {
    setApplied((prev) => ({ ...prev, q: filterText.trim(), ...patch }));
    setOffset(0);
  };

  const toggleSort = (column: string) => {
    setOffset(0);
    setSort((prev) => {
      if (!prev || prev.column !== column) return { column, desc: false };
      return prev.desc ? null : { column, desc: true };
    });
  };

  const exportCsv = async (delimiter: ';' | ',') => {
    if (!table) return;
    setExporting(true);
    try {
      const res = await http.get<Blob>(`/api/connections/${connectionKey}/export`, {
        params: {
          table,
          delimiter,
          sort: sort?.column,
          desc: sort?.desc ?? false,
          q: applied.q || undefined,
          mode: applied.mode,
          case_sensitive: applied.caseSensitive,
          include_numeric: applied.includeNumbers,
        },
        responseType: 'blob',
      });
      saveBlob(`${safeFilename('ncode', connectionLabel, table, applied.q)}.csv`, res.data);
      toast({
        title: t('Export ready'),
        description: t('Up to {n} rows are included.', { n: limits.max_export_rows.toLocaleString(locale()) }),
        status: 'success',
        duration: 3500,
      });
    } catch (err) {
      toast({ title: t('Export failed'), description: await apiErrorMessageAsync(err, t('Unexpected error')), status: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const drawerHit: SearchHit | null =
    drawerRow && data
      ? { table: data.table, row: drawerRow.values, cols: data.columns, matched_columns: drawerRow.matched, id_column: null }
      : null;

  const rowsFrom = data && data.rows.length > 0 ? data.offset + 1 : 0;
  const rowsTo = data ? data.offset + data.rows.length : 0;
  const filtering = applied.q !== '';

  // ------------------------------------------------------------------ render
  return (
    <Flex gap={4} direction={{ base: 'column', lg: 'row' }} align="stretch">
      {/* ------------------------------------------------ table list */}
      <VStack
        align="stretch"
        spacing={2}
        w={{ base: '100%', lg: '260px' }}
        flexShrink={0}
        bg="panelBg"
        border="1px solid"
        borderColor="lineColor"
        borderRadius="xl"
        p={2}
        maxH={{ base: '260px', lg: '720px' }}
      >
        <InputGroup size="sm">
          <InputLeftElement pointerEvents="none" color="faintText">
            <SearchIcon boxSize={4} />
          </InputLeftElement>
          <Input placeholder={t('Filter tables…')} value={listFilter} onChange={(e) => setListFilter(e.target.value)} />
        </InputGroup>
        <VStack align="stretch" spacing={1} overflowY="auto" flex={1}>
          {tablesError && (
            <Box p={2}>
              <Text fontSize="sm" color="red.300">
                {tablesError}
              </Text>
              <Button size="xs" mt={2} variant="subtle" onClick={onReloadTables}>
                {t('Try again')}
              </Button>
            </Box>
          )}
          {!tables && !tablesError && (
            <Flex justify="center" py={6}>
              <Spinner color="brand.300" />
            </Flex>
          )}
          {tables && visibleTables.length === 0 && (
            <Text fontSize="sm" color="mutedText" p={2}>
              {t('No tables match.')}
            </Text>
          )}
          {visibleTables.slice(0, 400).map((t) => {
            const active = t.name === table;
            return (
              <Flex
                key={t.name}
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
                onClick={() => selectTable(t.name)}
              >
                <TableIcon boxSize={4} color={active ? 'brand.300' : 'faintText'} flexShrink={0} />
                <Text flex={1} fontFamily="mono" fontSize="sm" noOfLines={1} fontWeight={active ? 600 : 400}>
                  {t.name}
                </Text>
                <Text fontSize="xs" color="faintText">
                  {t.columns}
                </Text>
              </Flex>
            );
          })}
          {visibleTables.length > 400 && (
            <Text fontSize="xs" color="faintText" p={2}>
              {t('Showing 400 of {total}. Type to narrow the list.', { total: visibleTables.length })}
            </Text>
          )}
        </VStack>
      </VStack>

      {/* ------------------------------------------------ viewer */}
      <Box flex={1} minW={0}>
        {!table ? (
          <Flex
            direction="column"
            align="center"
            justify="center"
            textAlign="center"
            gap={3}
            py={20}
            px={6}
            bg="panelBg"
            border="1px dashed"
            borderColor="lineColor"
            borderRadius="2xl"
          >
            <TableIcon boxSize={8} color="brand.300" />
            <Text fontWeight={600}>{t('Pick a table to see its rows')}</Text>
            <Text fontSize="sm" color="mutedText" maxW="380px">
              {t('Browse the data, sort by any column, filter by a phrase and export the result to CSV.')}
            </Text>
          </Flex>
        ) : (
          <VStack align="stretch" spacing={3}>
            <Flex justify="space-between" align="center" gap={3} wrap="wrap">
              <HStack spacing={3} minW={0}>
                <Text fontFamily="mono" fontSize="lg" fontWeight={650} noOfLines={1}>
                  {table}
                </Text>
                <ButtonGroup isAttached size="xs">
                  <Button variant={tab === 'data' ? 'brand' : 'subtle'} onClick={() => setTab('data')}>
                    {t('Data')}
                  </Button>
                  <Button variant={tab === 'structure' ? 'brand' : 'subtle'} onClick={() => setTab('structure')}>
                    {t('Structure')}
                  </Button>
                  <Button variant={tab === 'profile' ? 'brand' : 'subtle'} onClick={() => setTab('profile')} data-testid="tab-profile">
                    {t('Profile')}
                  </Button>
                </ButtonGroup>
                <Button as={RouterLink} to={`/xray?connection=${encodeURIComponent(connectionKey)}&table=${encodeURIComponent(table)}`} size="xs" variant="ghost" data-testid="xray-table">
                  X-ray
                </Button>
              </HStack>
              {tab === 'data' && (
                <Menu placement="bottom-end">
                  <MenuButton
                    as={Button}
                    size="sm"
                    variant="subtle"
                    isLoading={exporting}
                    leftIcon={<DownloadIcon boxSize={4} />}
                    rightIcon={<ChevronDownIcon boxSize={4} />}
                  >
                    {t('Export CSV')}
                  </MenuButton>
                  <MenuList minW="270px">
                    <Text px={3} pb={1} fontSize="xs" color="faintText" fontWeight={600}>
                      {filtering ? t('ALL MATCHES') : t('WHOLE TABLE')} · {t('UP TO {n} ROWS', { n: limits.max_export_rows.toLocaleString(locale()) })}
                    </Text>
                    <MenuItem onClick={() => void exportCsv(';')}>{t('For Excel (semicolon)')}</MenuItem>
                    <MenuItem onClick={() => void exportCsv(',')}>{t('Standard (comma)')}</MenuItem>
                  </MenuList>
                </Menu>
              )}
            </Flex>

            {tab === 'data' && (
              <>
                {/* filter bar */}
                <Flex
                  gap={3}
                  wrap="wrap"
                  align="center"
                  bg="panelBg"
                  border="1px solid"
                  borderColor="lineColor"
                  borderRadius="xl"
                  p={3}
                >
                  <InputGroup size="sm" flex="1 1 240px">
                    <InputLeftElement pointerEvents="none" color="faintText">
                      <SearchIcon boxSize={4} />
                    </InputLeftElement>
                    <Input
                      placeholder={t('Filter rows in this table…')}
                      value={filterText}
                      onChange={(e) => setFilterText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') changeFilter({});
                      }}
                    />
                  </InputGroup>
                  <Button size="sm" onClick={() => changeFilter({})}>
                    {t('Apply')}
                  </Button>
                  <ButtonGroup isAttached size="xs">
                    {MODES.map((m) => (
                      <Button
                        key={m.value}
                        variant={applied.mode === m.value ? 'brand' : 'subtle'}
                        onClick={() => changeFilter({ mode: m.value })}
                      >
                        {m.label}
                      </Button>
                    ))}
                  </ButtonGroup>
                  <HStack spacing={2}>
                    <Switch
                      size="sm"
                      colorScheme="brand"
                      isChecked={applied.caseSensitive}
                      onChange={(e) => changeFilter({ caseSensitive: e.target.checked })}
                    />
                    <Text fontSize="xs" color="mutedText">
                      {t('Match case')}
                    </Text>
                  </HStack>
                  <HStack spacing={2}>
                    <Switch
                      size="sm"
                      colorScheme="brand"
                      isChecked={applied.includeNumbers}
                      onChange={(e) => changeFilter({ includeNumbers: e.target.checked })}
                    />
                    <Text fontSize="xs" color="mutedText">
                      {t('Numbers & dates')}
                    </Text>
                  </HStack>
                  {filtering && (
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => {
                        setFilterText('');
                        changeFilter({ q: '' });
                      }}
                    >
                      {t('Clear filter')}
                    </Button>
                  )}
                </Flex>

                {error && (
                  <Alert status="error" borderRadius="xl" alignItems="flex-start">
                    <AlertIcon />
                    <AlertDescription fontSize="sm">{error}</AlertDescription>
                  </Alert>
                )}
                {data?.note && (
                  <Alert status="info" borderRadius="xl">
                    <AlertIcon />
                    <AlertDescription fontSize="sm">{data.note}</AlertDescription>
                  </Alert>
                )}

                {/* data grid */}
                <Box
                  position="relative"
                  bg="panelBg"
                  border="1px solid"
                  borderColor="lineColor"
                  borderRadius="xl"
                  overflow="hidden"
                >
                  {!data && !error && <Skeleton h="320px" />}
                  {data && (
                    <Box overflow="auto" maxH="560px" opacity={loading ? 0.5 : 1} transition="opacity 0.15s">
                      <Table size="sm">
                        <Thead position="sticky" top={0} zIndex={1} bg="panelBg">
                          <Tr>
                            {data.columns.map((column) => {
                              const sorted = data.sort === column;
                              return (
                                <Th
                                  key={column}
                                  cursor="pointer"
                                  userSelect="none"
                                  fontFamily="mono"
                                  textTransform="none"
                                  letterSpacing="normal"
                                  fontSize="xs"
                                  whiteSpace="nowrap"
                                  borderColor="lineColor"
                                  color={sorted ? 'brand.300' : 'mutedText'}
                                  _hover={{ color: 'brand.200' }}
                                  onClick={() => toggleSort(column)}
                                >
                                  {column}
                                  {sorted && (data.descending ? ' ▼' : ' ▲')}
                                </Th>
                              );
                            })}
                          </Tr>
                        </Thead>
                        <Tbody>
                          {data.rows.map((row, index) => (
                            <Tr key={index} cursor="pointer" _hover={{ bg: 'panelHover' }} onClick={() => setDrawerRow(row)}>
                              {data.columns.map((column) => {
                                const value = row.values[column];
                                const isMatch = row.matched.includes(column);
                                return (
                                  <Td key={column} maxW="280px" fontSize="sm" borderColor="lineColor" verticalAlign="top">
                                    {value === null || value === undefined ? (
                                      <Text as="i" color="faintText">
                                        NULL
                                      </Text>
                                    ) : (
                                      <Text noOfLines={2} wordBreak="break-word">
                                        {isMatch ? (
                                          <Highlight
                                            text={cellText(value).slice(0, 300)}
                                            phrase={applied.q}
                                            mode={applied.mode}
                                            caseSensitive={applied.caseSensitive}
                                          />
                                        ) : (
                                          cellText(value).slice(0, 300)
                                        )}
                                      </Text>
                                    )}
                                  </Td>
                                );
                              })}
                            </Tr>
                          ))}
                          {data.rows.length === 0 && !data.note && (
                            <Tr>
                              <Td colSpan={Math.max(1, data.columns.length)} textAlign="center" py={10} color="mutedText" borderColor="lineColor">
                                {filtering ? t('No rows match this filter.') : t('This table is empty.')}
                              </Td>
                            </Tr>
                          )}
                        </Tbody>
                      </Table>
                    </Box>
                  )}
                  {loading && data && (
                    <Flex position="absolute" inset={0} align="center" justify="center" pointerEvents="none">
                      <Spinner color="brand.300" />
                    </Flex>
                  )}
                </Box>

                {/* pager */}
                {data && (
                  <Flex justify="space-between" align="center" gap={3} wrap="wrap">
                    <HStack spacing={3}>
                      <Text fontSize="sm" color="mutedText">
                        {data.rows.length > 0 ? t('Rows {from}–{to}', { from: rowsFrom, to: rowsTo }) : t('No rows')}
                        {data.has_more && t(' · more available')}
                      </Text>
                      {data.omitted.length > 0 && (
                        <Badge bg="chipBg" color="faintText" textTransform="none">
                          {tn(data.omitted.length, '{n} binary column hidden', '{n} binary columns hidden')}
                        </Badge>
                      )}
                    </HStack>
                    <HStack spacing={2}>
                      <Select
                        size="sm"
                        w="auto"
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setOffset(0);
                        }}
                      >
                        {pageSizes.map((n) => (
                          <option key={n} value={n}>
                            {t('{n} per page', { n })}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" variant="subtle" isDisabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
                        {t('Previous')}
                      </Button>
                      <Button size="sm" variant="subtle" isDisabled={!data.has_more || loading} onClick={() => setOffset(offset + pageSize)}>
                        {t('Next')}
                      </Button>
                    </HStack>
                  </Flex>
                )}
              </>
            )}

            {tab === 'profile' && <TableProfile key={table} connection={connectionKey} table={table} />}

            {tab === 'structure' && (
              <Box bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="auto" maxH="640px">
                {!structure || structure.table !== table ? (
                  <Skeleton h="240px" />
                ) : structure.error ? (
                  <Alert status="error" borderRadius="xl">
                    <AlertIcon />
                    <AlertDescription fontSize="sm">{structure.error}</AlertDescription>
                  </Alert>
                ) : (
                  <Table size="sm">
                    <Thead position="sticky" top={0} bg="panelBg">
                      <Tr>
                        {[t('Column'), t('Type'), t('Nullable'), t('Key')].map((h) => (
                          <Th key={h} borderColor="lineColor" color="mutedText">
                            {h}
                          </Th>
                        ))}
                      </Tr>
                    </Thead>
                    <Tbody>
                      {(structure.columns ?? []).map((c) => (
                        <Tr key={c.name}>
                          <Td fontFamily="mono" fontSize="sm" borderColor="lineColor">
                            {c.name}
                          </Td>
                          <Td fontFamily="mono" fontSize="sm" color="mutedText" borderColor="lineColor">
                            {c.type}
                          </Td>
                          <Td fontSize="sm" color="mutedText" borderColor="lineColor">
                            {c.nullable ? t('yes') : t('no')}
                          </Td>
                          <Td borderColor="lineColor">
                            {c.primary_key && (
                              <Badge colorScheme="brand" textTransform="none">
                                {t('primary key')}
                              </Badge>
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
              </Box>
            )}
          </VStack>
        )}
      </Box>

      <RowDrawer
        hit={drawerHit}
        onClose={() => setDrawerRow(null)}
        phrase={applied.q}
        matchMode={applied.mode}
        caseSensitive={applied.caseSensitive}
      />
    </Flex>
  );
}
