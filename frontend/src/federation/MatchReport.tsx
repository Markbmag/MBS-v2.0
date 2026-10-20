import { Badge, Box, Flex, HStack, Progress, Text, Tooltip, VStack } from '@chakra-ui/react';
import type { FederationInfo } from '../api';
import { t, tn } from '../i18n/index.ts';
import { AlertIcon } from '../icons';
import { matchSummary } from './logic';
import { JOIN_TYPES } from './types';

const sample = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '∅')).join(' · ') : String(v ?? '∅'));

/** What each source returned and how well every join matched (the "37 % have no match" report). */
export function MatchReport({ info, labels }: { info: FederationInfo; labels: Record<string, string> }) {
  const label = (alias: string) => labels[alias] || alias;
  const cut = info.sources.filter((s) => s.truncated);
  return (
    <VStack align="stretch" spacing={3} p={3} data-testid="match-report">
      <Flex gap={2} wrap="wrap">
        {info.sources.map((s) => (
          <Tooltip key={s.alias} label={s.connection ? t('{kind} on {connection} · read in {ms} ms', { kind: s.kind, connection: s.connection, ms: s.duration_ms }) : t('{kind} · read in {ms} ms', { kind: s.kind, ms: s.duration_ms })} hasArrow>
            <Badge colorScheme={s.truncated ? 'orange' : 'gray'} fontSize="2xs" px={2} py={0.5} textTransform="none">
              {label(s.alias)}: {s.truncated ? tn(s.rows, '{n} row (cut off)', '{n} rows (cut off)') : tn(s.rows, '{n} row', '{n} rows')}
            </Badge>
          </Tooltip>
        ))}
        <Badge colorScheme="brand" fontSize="2xs" px={2} py={0.5} textTransform="none">
          {tn(info.combined_rows, 'combined: {n} row', 'combined: {n} rows')}
        </Badge>
      </Flex>
      {cut.length > 0 && (
        <HStack fontSize="xs" color="orange.400" align="flex-start">
          <AlertIcon boxSize={3.5} mt={0.5} />
          <Text>
            {t('{sources} returned more rows than a source may read, so only the first ones are combined. Filter the source (e.g. save a question with filters) for complete results.', { sources: cut.map((s) => label(s.alias)).join(', ') })}
          </Text>
        </HStack>
      )}
      {info.joins.map((j) => {
        const left = j.keys[0]?.split('=')[0]?.trim().split('.')[0] ?? 'left';
        const s = matchSummary(j, label(left), label(j.source));
        const type = JOIN_TYPES.find((jt) => jt.value === j.type);
        return (
          <Box key={j.source} border="1px solid" borderColor="lineColor" borderRadius="lg" p={3} data-testid="join-stats">
            <Flex justify="space-between" align="baseline" gap={2} wrap="wrap" mb={2}>
              <Text fontSize="sm" fontWeight={700}>
                {t('{source} joined on {keys}', { source: label(j.source), keys: j.keys.join(t(' and ')) })}
              </Text>
              <Text fontSize="xs" color="faintText">
                {t('{type} · compared {match}', { type: type ? t(type.label) : '', match: j.match.join(', ') })}
              </Text>
            </Flex>
            {[
              { text: s.lines[0], pct: s.leftPct, samples: j.left_samples },
              { text: s.lines[1], pct: s.rightPct, samples: j.right_samples },
            ].map((row, i) => (
              <Box key={i} mb={2}>
                <Flex justify="space-between" fontSize="xs" mb={1} gap={2}>
                  <Text data-testid="unmatched-line">{row.text}</Text>
                </Flex>
                <Progress value={100 - row.pct} size="xs" borderRadius="full" colorScheme={row.pct > 20 ? 'orange' : 'green'} bg="lineColor" />
                {row.samples.length > 0 && (
                  <Text fontSize="2xs" color="faintText" mt={1} fontFamily="mono" noOfLines={1}>
                    {t('e.g. {samples}', { samples: row.samples.map(sample).join(', ') })}
                  </Text>
                )}
              </Box>
            ))}
            {s.warnings.map((w) => (
              <HStack key={w} fontSize="xs" color="orange.400" align="flex-start" spacing={1.5}>
                <AlertIcon boxSize={3.5} mt={0.5} />
                <Text>{w}</Text>
              </HStack>
            ))}
          </Box>
        );
      })}
    </VStack>
  );
}
