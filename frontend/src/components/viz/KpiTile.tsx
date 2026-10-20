import { Box, Flex, HStack, Text } from '@chakra-ui/react';
import { kpiValues } from '../../viz/data';
import type { Table } from '../../viz/data';
import { formatNumber } from '../../viz/format';
import type { ChartTheme } from '../../viz/palette';
import type { VizSpec } from '../../viz/types';
import { t } from '../../i18n/index.ts';

/** Stat tile: label, value, change against the previous row, and a 24-point sparkline. */
export function KpiTile({ table, viz, theme }: { table: Table; viz: VizSpec; theme: ChartTheme }) {
  const column = viz.value ?? viz.series?.[0]?.y ?? table.columns.find((c) => c.type === 'number')?.name;
  const fmt = (column && viz.format?.[column]) || {};
  const { value, previous, trend } = kpiValues(table, column);
  const opts = { compare: true, sparkline: true, upIsGood: true, ...viz.kpi };
  const delta = value !== null && previous !== null && previous !== 0 ? (value - previous) / Math.abs(previous) : null;
  const good = delta === null ? null : (delta >= 0) === opts.upIsGood;

  return (
    <Flex h="100%" direction="column" justify="center" align="center" gap={2} p={4} data-testid="kpi">
      <Text fontSize="sm" color="mutedText">
        {column ?? t('No number column')}
      </Text>
      <Text fontSize={{ base: '4xl', md: '5xl' }} fontWeight={600} lineHeight="1.05" color="bodyText" data-testid="kpi-value">
        {value === null ? '—' : formatNumber(value, { compact: Math.abs(value) >= 1e6, ...fmt })}
      </Text>
      {opts.compare && delta !== null && (
        <HStack spacing={1.5} fontSize="sm">
          <Text fontWeight={600} color={good ? theme.good : theme.bad} aria-label={good ? t('better') : t('worse')}>
            {delta >= 0 ? '▲' : '▼'} {formatNumber(Math.abs(delta), { style: 'percent' })}
          </Text>
          <Text color="mutedText">{t('vs previous ({value})', { value: previous === null ? '—' : formatNumber(previous, fmt) })}</Text>
        </HStack>
      )}
      {opts.sparkline && trend.length > 2 && <Sparkline values={trend} color={theme.series[0]} muted={theme.deemphasis} />}
    </Flex>
  );
}

function Sparkline({ values, color, muted }: { values: number[]; color: string; muted: string }) {
  const w = 160;
  const h = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 8) + 4, h - 4 - ((v - min) / span) * (h - 8)]);
  const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <Box as="svg" width={`${w}px`} height={`${h}px`} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={path} fill="none" stroke={muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={4} fill={color} />
    </Box>
  );
}
