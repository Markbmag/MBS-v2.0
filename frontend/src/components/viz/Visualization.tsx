import { useMemo } from 'react';
import type { Ref } from 'react';
import { Flex, Text, useColorMode } from '@chakra-ui/react';
import type { ResultEnvelope } from '../../api';
import { ResultsTable } from '../data/ResultsTable';
import { buildOption, scaleWarning } from '../../viz/options';
import { chartTheme } from '../../viz/palette';
import type { VizSpec } from '../../viz/types';
import { EChart } from './EChart';
import type { EChartHandle } from './EChart';
import { KpiTile } from './KpiTile';
import { PivotTable } from './PivotTable';
import { t } from '../../i18n/index.ts';

interface VisualizationProps {
  result: Pick<ResultEnvelope, 'columns' | 'rows'>;
  viz: VizSpec;
  smartDates?: boolean;
  chartRef?: Ref<EChartHandle>;
}

/** Draws a result the way the VizSpec says (ECharts for charts, React for table / number / pivot). */
export function Visualization({ result, viz, smartDates, chartRef }: VisualizationProps) {
  const { colorMode } = useColorMode();
  const theme = useMemo(() => chartTheme(colorMode === 'dark' ? 'dark' : 'light'), [colorMode]);
  const option = useMemo(() => buildOption(result, viz, theme), [result, viz, theme]);
  const warning = useMemo(() => scaleWarning(result, viz), [result, viz]);

  if (viz.type === 'table') return <ResultsTable columns={result.columns} rows={result.rows} smartDates={smartDates} />;
  if (viz.type === 'kpi') return <KpiTile table={result} viz={viz} theme={theme} />;
  if (viz.type === 'pivot') return <PivotTable table={result} viz={viz} />;
  if (!option) {
    return (
      <Flex h="100%" align="center" justify="center">
        <Text color="mutedText">{t('This chart type cannot show this result.')}</Text>
      </Flex>
    );
  }
  return (
    <Flex h="100%" direction="column" p={3}>
      {warning && (
        <Text fontSize="xs" color="mutedText" mb={1} data-testid="scale-warning">
          {warning}
        </Text>
      )}
      <EChart option={option} chartRef={chartRef} ariaLabel={t('{type} chart', { type: viz.type })} />
    </Flex>
  );
}
