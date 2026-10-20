import { Badge, Box, Flex, HStack, SimpleGrid, Table, Tbody, Td, Text, Th, Thead, Tooltip, Tr, VStack } from '@chakra-ui/react';
import { locale, t, tn } from '../i18n/index.ts';
import { AlertIcon } from '../icons';
import { humanize } from '../query/draft';
import { formatNumber } from '../viz/format';
import type { ColumnProfile, Profile } from './types';

const num = (v: unknown) => (typeof v === 'number' ? formatNumber(v, { compact: Math.abs(v) >= 100_000 }) : v === null || v === undefined ? '—' : String(v));
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 1000) / 10} %` : '—');

/** A column-by-column profile: completeness, distinct values, distributions, top values, correlations. */
export function ProfileView({ profile, onParseAsDate }: { profile: Profile; onParseAsDate?: (column: string) => void }) {
  return (
    <VStack align="stretch" spacing={4} data-testid="profile">
      <Text fontSize="sm" color="mutedText">
        {profile.total_rows !== null && profile.total_rows !== undefined
          ? tn(profile.rows_profiled, '{n} row profiled of {total}', '{n} rows profiled of {total}', { total: profile.total_rows.toLocaleString(locale()) })
          : tn(profile.rows_profiled, '{n} row profiled', '{n} rows profiled')}
        {profile.sampled && t(' (the first rows of the table: a sample, so the numbers are estimates)')}
        {profile.truncated && t(' (the result was cut off at the row limit)')}
        {' · '}
        {tn(profile.columns.length, '{n} column', '{n} columns')}
      </Text>
      <SimpleGrid columns={{ base: 1, md: 2, '2xl': 3 }} spacing={3}>
        {profile.columns.map((c) => (
          <ColumnCard key={c.name} c={c} onParseAsDate={onParseAsDate} />
        ))}
      </SimpleGrid>
      {profile.correlations && <Correlations data={profile.correlations} />}
    </VStack>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Box minW={0}>
      <Text fontSize="2xs" color="faintText" textTransform="uppercase" letterSpacing="0.05em" title={hint}>
        {label}
      </Text>
      <Text fontSize="sm" fontWeight={600} noOfLines={1}>
        {value}
      </Text>
    </Box>
  );
}

function ColumnCard({ c, onParseAsDate }: { c: ColumnProfile; onParseAsDate?: (column: string) => void }) {
  const filled = c.rows - c.nulls;
  return (
    <Box border="1px solid" borderColor="lineColor" borderRadius="lg" p={3} bg="panelBg" data-testid="profile-column">
      <Flex justify="space-between" align="baseline" gap={2} mb={2}>
        <Tooltip label={c.description || c.name} hasArrow openDelay={300}>
          <Text fontWeight={700} fontSize="sm" noOfLines={1}>
            {c.display_name || humanize(c.name)}
          </Text>
        </Tooltip>
        <HStack spacing={1}>
          {c.unique && <Badge fontSize="2xs">{t('unique')}</Badge>}
          <Badge fontSize="2xs" textTransform="none">
            {c.type}
          </Badge>
        </HStack>
      </Flex>
      <Box h="4px" bg="lineColor" borderRadius="full" overflow="hidden" mb={2} title={t('{pct} filled', { pct: pct(filled, c.rows) })}>
        <Box h="100%" w={c.rows ? `${(filled / c.rows) * 100}%` : 0} bg={c.nulls / Math.max(c.rows, 1) > 0.2 ? 'orange.400' : 'green.400'} />
      </Box>
      <SimpleGrid columns={3} spacing={2} mb={2}>
        <Stat label={t('Empty')} value={`${c.nulls.toLocaleString(locale())} (${pct(c.nulls, c.rows)})`} />
        <Stat label={t('Distinct')} value={c.distinct.toLocaleString(locale())} />
        {c.type === 'number' && <Stat label={t('Outliers')} value={c.outliers ?? 0} hint={t('Outside 1.5 × the interquartile range')} />}
        {(c.type === 'string' || c.type === 'unknown') && <Stat label={t('Length')} value={`${c.min_length ?? '—'}–${c.max_length ?? '—'}`} />}
        {(c.type === 'date' || c.type === 'datetime') && <Stat label={t('Per')} value={c.unit ?? '—'} />}
      </SimpleGrid>
      {c.type === 'number' && c.min !== undefined && (
        <SimpleGrid columns={4} spacing={2} mb={2}>
          <Stat label={t('Min')} value={num(c.min)} />
          <Stat label={t('Median')} value={num(c.median)} />
          <Stat label={t('Mean')} value={num(c.mean)} />
          <Stat label={t('Max')} value={num(c.max)} />
        </SimpleGrid>
      )}
      {(c.type === 'date' || c.type === 'datetime') && c.min !== undefined && (
        <Text fontSize="xs" color="mutedText" mb={2}>
          {String(c.min).slice(0, 10)} → {String(c.max).slice(0, 10)}
        </Text>
      )}
      {c.histogram && c.histogram.length > 1 && <Histogram bins={c.histogram} />}
      {c.top && c.top.length > 0 && !c.unique && c.type !== 'date' && c.type !== 'datetime' && !(c.type === 'number' && c.histogram) && (
        <TopValues top={c.top} rows={c.rows} />
      )}
      {c.type === 'boolean' && c.true !== undefined && (
        <Text fontSize="xs" color="mutedText">
          {t('true {yes} · false {no}', { yes: pct(c.true, filled), no: pct(c.false ?? 0, filled) })}
        </Text>
      )}
      {c.looks_like_dates && (
        <HStack fontSize="xs" color="teal.300" mt={2} spacing={1.5} align="flex-start">
          <AlertIcon boxSize={3.5} mt={0.5} />
          <Text>
            {t('{pct} of the values look like dates.', { pct: pct(c.date_like ?? 0, filled) })}{' '}
            {onParseAsDate ? (
              <Text as="button" textDecoration="underline" onClick={() => onParseAsDate(c.name)}>
                {t('Read them as dates')}
              </Text>
            ) : (
              t('An admin can switch on “Read as dates” in the data model.')
            )}
          </Text>
        </HStack>
      )}
    </Box>
  );
}

function Histogram({ bins }: { bins: { start: number | string; end?: number; count: number }[] }) {
  const max = Math.max(...bins.map((b) => b.count), 1);
  return (
    <Box>
      <Flex align="flex-end" h="48px" gap="1px" data-testid="histogram">
        {bins.map((b, i) => (
          <Tooltip key={i} label={`${typeof b.start === 'number' ? num(b.start) : String(b.start).slice(0, 10)}${b.end !== undefined ? ` – ${num(b.end)}` : ''}: ${b.count}`} hasArrow openDelay={100}>
            <Box flex={1} minW="2px" h={`${Math.max(4, (b.count / max) * 100)}%`} bg="brand.400" opacity={0.85} borderTopRadius="2px" />
          </Tooltip>
        ))}
      </Flex>
    </Box>
  );
}

function TopValues({ top, rows }: { top: { value: unknown; count: number }[]; rows: number }) {
  const max = Math.max(...top.map((tv) => tv.count), 1);
  return (
    <VStack align="stretch" spacing={0.5}>
      {top.slice(0, 6).map((tv, i) => (
        <Flex key={i} align="center" gap={2} fontSize="xs">
          <Text flex="0 0 45%" noOfLines={1} title={String(tv.value)}>
            {String(tv.value)}
          </Text>
          <Box flex={1} h="6px" bg="lineColor" borderRadius="full" overflow="hidden">
            <Box h="100%" w={`${(tv.count / max) * 100}%`} bg="teal.400" />
          </Box>
          <Text w="52px" textAlign="right" color="mutedText">
            {pct(tv.count, rows)}
          </Text>
        </Flex>
      ))}
    </VStack>
  );
}

function cellColor(v: number | null): string | undefined {
  if (v === null) return undefined;
  const a = Math.min(1, Math.abs(v)) * 0.75;
  return v >= 0 ? `rgba(234, 120, 50, ${a})` : `rgba(66, 133, 244, ${a})`;
}

function Correlations({ data }: { data: { columns: string[]; matrix: (number | null)[][] } }) {
  return (
    <Box>
      <Text fontWeight={700} fontSize="sm" mb={1}>
        {t('How the numbers move together')}
      </Text>
      <Text fontSize="xs" color="mutedText" mb={2}>
        {t('Correlation from −1 (one goes up when the other goes down, blue) to +1 (they rise together, orange). It shows a link, not a cause.')}
      </Text>
      <Box overflowX="auto" border="1px solid" borderColor="lineColor" borderRadius="lg">
        <Table size="sm" data-testid="correlations">
          <Thead>
            <Tr>
              <Th />
              {data.columns.map((c) => (
                <Th key={c} textTransform="none" fontSize="2xs">
                  {c}
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {data.columns.map((row, i) => (
              <Tr key={row}>
                <Td fontSize="xs" fontWeight={600}>
                  {row}
                </Td>
                {data.matrix[i].map((v, j) => (
                  <Td key={j} fontSize="xs" textAlign="center" bg={i === j ? undefined : cellColor(v)}>
                    {i === j ? '' : v === null ? '—' : v.toFixed(2)}
                  </Td>
                ))}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>
    </Box>
  );
}
