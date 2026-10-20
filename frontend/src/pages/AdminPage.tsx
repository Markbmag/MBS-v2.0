import { useMemo, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Flex, HStack, IconButton, Input, InputGroup, InputLeftElement, Select,
  SimpleGrid, Skeleton, Tab, TabList, TabPanel, TabPanels, Table, Tabs, Tbody, Td, Text, Th, Thead, Tooltip, Tr, VStack,
} from '@chakra-ui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Panel } from '../admin/Panel';
import { DeliverySettings } from '../admin/DeliverySettings';
import { SharingSettings } from '../admin/SharingSettings';
import { UsagePanel } from '../admin/UsagePanel';
import { PeopleSettings } from '../admin/PeopleSettings';
import { AuditPanel } from '../admin/AuditPanel';
import { SystemPanel } from '../admin/SystemPanel';
import { apiErrorMessage, http } from '../api';
import type { SchemaColumn, SchemaTable, SchemaV2 } from '../api';
import { EditableColumns, FieldDialog, ManualRelationships, MetricsPanel } from '../semantic/DataModelEditor';
import { EngineBadge } from '../components/EngineBadge';
import { PageHeader } from '../components/PageHeader';
import { LockIcon, PencilIcon, PlusIcon, RefreshIcon, SearchIcon } from '../icons';
import { engineMeta } from '../lib/engines';
import { queryKeys } from '../lib/queryClient';
import { useWorkspace } from '../workspace/useWorkspace';
import { t, tn, tc } from '../i18n/index.ts';

function TableCard({ table, connection }: { table: SchemaTable; connection: string }) {
  const [editing, setEditing] = useState<SchemaColumn | null>(null);
  return (
    <Box border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden" data-testid="model-table">
      <Flex px={3} py={2} bg="chipBg" align="center" justify="space-between">
        <Text fontWeight={700} fontSize="sm" noOfLines={1}>
          {table.name}
        </Text>
        <HStack spacing={2}>
          <Text fontSize="xs" color="mutedText">
            {tn(table.columns.length, '{n} column', '{n} columns')}
          </Text>
          <Button as={RouterLink} to={`/xray?connection=${encodeURIComponent(connection)}&table=${encodeURIComponent(table.name)}`} size="xs" variant="ghost">
            {t('X-ray')}
          </Button>
        </HStack>
      </Flex>
      <Box maxH="320px" overflowY="auto">
        <EditableColumns connection={connection} table={table.name} columns={table.columns} onEdit={setEditing} />
      </Box>
      <FieldDialog connection={connection} table={table.name} column={editing} onClose={() => setEditing(null)} />
    </Box>
  );
}

function DataModel({ connectionKey }: { connectionKey: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const schemaQuery = useQuery({
    queryKey: queryKeys.schema(connectionKey),
    queryFn: async () => (await http.get<SchemaV2>(`/api/connections/${connectionKey}/schema`)).data,
    enabled: connectionKey !== '',
  });

  const reload = async () => {
    // refresh=true makes the server read the structure again instead of using its cache
    const fresh = (await http.get<SchemaV2>(`/api/connections/${connectionKey}/schema`, { params: { refresh: true } })).data;
    queryClient.setQueryData(queryKeys.schema(connectionKey), fresh);
    void queryClient.resetQueries({ queryKey: queryKeys.tables(connectionKey) });
  };

  const data = schemaQuery.data;
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (data?.tables ?? []).filter((tb) => !needle || tb.name.toLowerCase().includes(needle)).slice(0, 60);
  }, [data, filter]);

  if (schemaQuery.isPending) return <Skeleton h="240px" borderRadius="xl" />;
  if (schemaQuery.isError)
    return (
      <Alert status="error" borderRadius="xl">
        <AlertIcon />
        {apiErrorMessage(schemaQuery.error, t('Could not read the database structure'))}
      </Alert>
    );

  const total = data?.tables.length ?? 0;
  return (
    <VStack align="stretch" spacing={4}>
      <Flex gap={3} wrap="wrap" align="center">
        <InputGroup size="sm" maxW="280px">
          <InputLeftElement pointerEvents="none" color="faintText">
            <SearchIcon boxSize={3.5} />
          </InputLeftElement>
          <Input placeholder={t('Filter tables')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </InputGroup>
        <Text fontSize="sm" color="mutedText" flex={1}>
          {tn(total, '{n} table', '{n} tables')} · {tn(data?.relationships.length ?? 0, '{n} relationship', '{n} relationships')}
          {shown.length < total && !filter && ` · ${t('showing the first {n}', { n: shown.length })}`}
        </Text>
        <Tooltip label={t('Read the structure from the database again')} hasArrow>
          <IconButton aria-label={t('Reload structure')} size="sm" icon={<RefreshIcon boxSize={4} />} onClick={() => void reload()} />
        </Tooltip>
      </Flex>

      {data && data.relationships.length > 0 && (
        <Box>
          <Text fontSize="xs" fontWeight={700} letterSpacing="0.08em" color="faintText" mb={2}>
            {t('RELATIONSHIPS (FOREIGN KEYS)')}
          </Text>
          <Box maxH="220px" overflowY="auto" border="1px solid" borderColor="lineColor" borderRadius="xl">
            <Table size="sm">
              <Thead>
                <Tr>
                  <Th>{tc('relationship', 'From')}</Th>
                  <Th>{tc('relationship', 'To')}</Th>
                </Tr>
              </Thead>
              <Tbody fontFamily="mono" fontSize="xs">
                {data.relationships.map((r) => (
                  <Tr key={`${r.from_table}.${r.from_columns.join(',')}->${r.to_table}`}>
                    <Td>
                      {r.from_table}.{r.from_columns.join(', ')}
                      {r.manual && (
                        <Badge ml={2} fontSize="0.6rem" colorScheme="teal">
                          {t('added by hand')}
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      {r.to_table}.{r.to_columns.join(', ')}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        </Box>
      )}
      {data && (
        <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4}>
          <ManualRelationships connection={connectionKey} schema={data} />
          <MetricsPanel connection={connectionKey} schema={data} />
        </SimpleGrid>
      )}

      <Text fontSize="xs" fontWeight={700} letterSpacing="0.08em" color="faintText">
        {t('TABLES · click a column to name, describe, format, hide it or read it as dates')}
      </Text>
      <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={3}>
        {shown.map((tb) => (
          <TableCard key={tb.name} table={tb} connection={connectionKey} />
        ))}
      </SimpleGrid>
    </VStack>
  );
}

export default function AdminPage() {
  const ws = useWorkspace();
  const [modelKey, setModelKey] = useState('');
  const [search, setSearch] = useSearchParams();
  if (!ws.isAdmin) return <Navigate to="/" replace />;
  const tabIndex = Math.max(0, TABS.indexOf(search.get('tab') ?? 'databases'));
  const setTab = (i: number) => setSearch((prev) => {
    const next = new URLSearchParams(prev);
    next.set('tab', TABS[i]);
    return next;
  }, { replace: true });
  const selected = ws.connections.some((c) => c.key === modelKey) ? modelKey : ws.activeKey;

  return (
    <VStack align="stretch" spacing={6}>
      <PageHeader
        title={t('Admin')}
        subtitle={t('Databases and their data model, people and groups, delivery, sharing, usage, the audit log and backups.')}
        actions={
          <Button as={RouterLink} to="/admin/charts" size="sm" variant="subtle">
            {t('Chart gallery')}
          </Button>
        }
      />

      <Tabs index={tabIndex} onChange={setTab} size="sm" variant="soft-rounded" colorScheme="purple" isLazy>
        <TabList flexWrap="wrap" gap={1}>
          <Tab data-testid="admin-tab-databases">{t('Databases')}</Tab>
          <Tab data-testid="admin-tab-people">{t('People')}</Tab>
          <Tab data-testid="admin-tab-delivery">{t('Delivery')}</Tab>
          <Tab data-testid="admin-tab-sharing">{t('Sharing')}</Tab>
          <Tab data-testid="admin-tab-usage">{t('Usage')}</Tab>
          <Tab data-testid="admin-tab-audit">{t('Audit')}</Tab>
          <Tab data-testid="admin-tab-system">{t('System')}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel px={0} pt={5}>
            <VStack align="stretch" spacing={6}>
                <Panel
                  title={t('Databases')}
                  actions={
                    <Button size="sm" leftIcon={<PlusIcon boxSize={4} />} onClick={ws.openAddConnection}>
                      {t('Add a database')}
                    </Button>
                  }
                >
                  {ws.connections.length === 0 ? (
                    <Text fontSize="sm" color="mutedText">
                      {t('No databases yet.')}
                    </Text>
                  ) : (
                    <VStack align="stretch" spacing={2}>
                      {ws.connections.map((c) => (
                        <Flex key={c.key} align="center" gap={3} px={3} py={2} borderRadius="xl" bg="chipBg">
                          <EngineBadge engine={c.engine} size={30} />
                          <Box flex={1} minW={0}>
                            <Text fontSize="sm" fontWeight={600} noOfLines={1}>
                              {c.label}{' '}
                              <Text as="span" color="faintText" fontWeight={400} fontFamily="mono" fontSize="xs">
                                {c.key}
                              </Text>
                            </Text>
                            <Text fontSize="xs" color="mutedText" noOfLines={1}>
                              {engineMeta(c.engine).label} · {c.database}
                            </Text>
                          </Box>
                          {c.editable ? (
                            <IconButton
                              aria-label={t('Edit {name}', { name: c.label })}
                              size="sm"
                              icon={<PencilIcon boxSize={3.5} />}
                              onClick={() => ws.openEditConnection(c.key)}
                            />
                          ) : (
                            <Tooltip label={t('Defined in the .env file — edit it there')} hasArrow>
                              <Box color="faintText" px={2}>
                                <LockIcon boxSize={3.5} />
                              </Box>
                            </Tooltip>
                          )}
                        </Flex>
                      ))}
                    </VStack>
                  )}
                </Panel>

                {ws.connections.length > 0 && (
                  <Panel
                    title={t('Data model')}
                    actions={
                      <Select size="sm" maxW="260px" value={selected} onChange={(e) => setModelKey(e.target.value)}>
                        {ws.connections.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </Select>
                    }
                  >
                    <DataModel key={selected} connectionKey={selected} />
                  </Panel>
                )}
            </VStack>
          </TabPanel>
          <TabPanel px={0} pt={5}>
            <PeopleSettings />
          </TabPanel>
          <TabPanel px={0} pt={5}>
            <DeliverySettings />
          </TabPanel>
          <TabPanel px={0} pt={5}>
            <SharingSettings />
          </TabPanel>
          <TabPanel px={0} pt={5}>
            <UsagePanel />
          </TabPanel>
          <TabPanel px={0} pt={5}>
            <AuditPanel />
          </TabPanel>
          <TabPanel px={0} pt={5}>
            <SystemPanel />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </VStack>
  );
}

const TABS = ['databases', 'people', 'delivery', 'sharing', 'usage', 'audit', 'system'];
