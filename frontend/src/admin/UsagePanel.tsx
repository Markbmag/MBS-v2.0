import { useMemo, useState } from 'react';
import {
  Badge, Box, Code, HStack, Link, Select, SimpleGrid, Skeleton, Stat, StatLabel, StatNumber, Tab, TabList, TabPanel, TabPanels, Table, Tabs,
  Tbody, Td, Text, Th, Thead, Tr, VStack,
} from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import type { ResultEnvelope } from '../api';
import { Visualization } from '../components/viz/Visualization';
import type { VizSpec } from '../viz/types';
import { useQueryLog, useUsage } from './api';
import type { LoggedQuery } from './api';
import { Panel } from './Panel';
import { locale, t, tc, tn } from '../i18n/index.ts';

const sec = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v < 10 ? t('{s} s', { s: v.toFixed(2) }) : t('{s} s', { s: Math.round(v) }));

/** Admin → Usage: how much Ncode is used, by whom, for what, and which queries are slow or fail. */
export function UsagePanel() {
  const [days, setDays] = useState(30);
  const usage = useUsage(days);
  const u = usage.data;
  const perDay: ResultEnvelope | null = useMemo(
    () =>
      u
        ? {
            columns: [
              { name: 'day', type: 'date', role: 'dimension' },
              { name: t('queries'), type: 'number', role: 'measure' },
              { name: t('errors'), type: 'number', role: 'measure' },
            ],
            rows: u.per_day.map((d) => [d.day, d.queries, d.errors]),
            stats: { duration_ms: 0, row_count: u.per_day.length, truncated: false, cached: false },
            sql: null,
          }
        : null,
    [u],
  );
  const chart: VizSpec = { version: 1, type: 'bar', x: 'day', series: [{ y: t('queries') }, { y: t('errors') }] };
  return (
    <VStack align="stretch" spacing={6}>
      <HStack>
        <Text fontSize="sm">{t('Last')}</Text>
        <Select size="sm" w="120px" value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="usage-days">
          {[7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>
              {tn(d, '{n} day', '{n} days')}
            </option>
          ))}
        </Select>
      </HStack>
      {usage.isPending && <Skeleton h="300px" borderRadius="2xl" />}
      {u && (
        <>
          <SimpleGrid columns={{ base: 2, md: 3, xl: 6 }} spacing={3} data-testid="usage-totals">
            <Tile label={t('Queries')} value={u.totals.queries.toLocaleString(locale())} />
            <Tile label={t('People')} value={u.totals.people.toLocaleString(locale())} />
            <Tile label={t('Sign-ins')} value={u.totals.logins.toLocaleString(locale())} />
            <Tile label={t('Failed')} value={(u.totals.errors ?? 0).toLocaleString(locale())} />
            <Tile label={t('Slower than {s} s', { s: u.slow_query_sec })} value={(u.totals.slow ?? 0).toLocaleString(locale())} />
            <Tile label={t('Average time')} value={sec(u.totals.avg_sec)} />
          </SimpleGrid>
          {perDay && perDay.rows.length > 0 && (
            <Panel title={t('Queries per day')}>
              <Box h="240px">
                <Visualization result={perDay} viz={chart} />
              </Box>
            </Panel>
          )}
          <SimpleGrid columns={{ base: 1, xl: 2 }} spacing={6}>
            <Panel title={t('Most used questions')}>
              <Small
                head={[t('Question'), t('Runs'), t('Avg'), t('Failed')]}
                rows={u.questions.map((q) => [
                  <Link key="n" as={RouterLink} to={`/questions/${q.id}`}>
                    {q.name ?? t('#{id} (deleted)', { id: q.id })}
                  </Link>,
                  q.runs,
                  sec(q.avg_sec),
                  q.errors || '',
                ])}
              />
            </Panel>
            <Panel title={t('Most used dashboards')}>
              <Small
                head={[t('Dashboard'), t('Card runs'), t('People')]}
                rows={u.dashboards.map((d) => [
                  <Link key="n" as={RouterLink} to={`/dashboards/${d.id}`}>
                    {d.name ?? t('#{id} (deleted)', { id: d.id })}
                  </Link>,
                  d.card_runs,
                  d.people,
                ])}
              />
            </Panel>
            <Panel title={t('People')}>
              <Small head={[tc('person', 'Name'), t('Queries'), t('Avg'), t('Last seen')]} rows={u.people.map((p) => [p.username, p.queries, sec(p.avg_sec), new Date(p.last_seen * 1000).toLocaleDateString(locale())])} />
            </Panel>
            <Panel title={t('Where queries come from')}>
              <Small head={[t('Source'), t('Queries')]} rows={u.sources.map((s) => [s.source, s.queries])} />
            </Panel>
          </SimpleGrid>
        </>
      )}
      <Panel title={t('Query log')} subtitle={t('The slowest and the failed queries. A slow question may need a filter, a smaller date range or an index in the database.')}>
        <Tabs size="sm" variant="soft-rounded" colorScheme="purple" isLazy>
          <TabList mb={3}>
            <Tab data-testid="slow-tab">{t('Slow')}</Tab>
            <Tab data-testid="errors-tab">{t('Failed')}</Tab>
          </TabList>
          <TabPanels>
            <TabPanel p={0}>
              <Log kind="slow" days={days} />
            </TabPanel>
            <TabPanel p={0}>
              <Log kind="errors" days={days} />
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Panel>
    </VStack>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Stat bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" px={4} py={3}>
      <StatLabel fontSize="xs" color="mutedText">
        {label}
      </StatLabel>
      <StatNumber fontSize="xl">{value}</StatNumber>
    </Stat>
  );
}

function Small({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length)
    return (
      <Text fontSize="sm" color="mutedText">
        {t('Nothing yet.')}
      </Text>
    );
  return (
    <Box overflowX="auto">
      <Table size="sm">
        <Thead>
          <Tr>
            {head.map((h, i) => (
              <Th key={h} isNumeric={i > 0} textTransform="none">
                {h}
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r, i) => (
            <Tr key={i}>
              {r.map((c, j) => (
                <Td key={j} isNumeric={j > 0} fontSize="sm">
                  {c}
                </Td>
              ))}
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>
  );
}

function Log({ kind, days }: { kind: 'slow' | 'errors'; days: number }) {
  const log = useQueryLog(kind, days);
  if (log.isPending) return <Skeleton h="80px" />;
  const rows: LoggedQuery[] = log.data?.queries ?? [];
  if (!rows.length)
    return (
      <Text fontSize="sm" color="mutedText">
        {kind === 'slow' ? t('No query took longer than {s} s.', { s: log.data?.min_sec ?? 5 }) : t('No query failed.')}
      </Text>
    );
  return (
    <Box overflowX="auto">
      <Table size="sm" data-testid={`log-${kind}`}>
        <Thead>
          <Tr>
            <Th textTransform="none">{t('When')}</Th>
            <Th textTransform="none">{t('Who')}</Th>
            <Th textTransform="none">{t('What')}</Th>
            <Th textTransform="none" isNumeric>
              {t('Time')}
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => (
            <Tr key={r.id} verticalAlign="top">
              <Td fontSize="xs" whiteSpace="nowrap">
                {new Date(r.ts * 1000).toLocaleString(locale())}
              </Td>
              <Td fontSize="xs">
                {r.username}
                <Text color="faintText">{r.source}</Text>
              </Td>
              <Td fontSize="xs" maxW="560px">
                <HStack spacing={2} mb={1}>
                  <Badge fontSize="2xs">{r.action}</Badge>
                  {r.connection && <Badge fontSize="2xs" variant="outline">{r.connection}</Badge>}
                  {r.question_id && (
                    <Link as={RouterLink} to={`/questions/${r.question_id}`}>
                      {r.question_name ?? t('question {id}', { id: r.question_id })}
                    </Link>
                  )}
                  {r.dashboard_id && (
                    <Link as={RouterLink} to={`/dashboards/${r.dashboard_id}`} color="mutedText">
                      {t('on {name}', { name: r.dashboard_name ?? t('dashboard {id}', { id: r.dashboard_id }) })}
                    </Link>
                  )}
                </HStack>
                {r.sql && (
                  <Code fontSize="2xs" whiteSpace="pre-wrap" display="block" bg="transparent" p={0} color="mutedText">
                    {r.sql}
                  </Code>
                )}
              </Td>
              <Td isNumeric fontSize="xs" whiteSpace="nowrap" color={r.status === 'error' ? 'red.400' : undefined}>
                {sec(r.duration_sec)}
                {r.status !== 'completed' && <Text>{r.status}</Text>}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>
  );
}
