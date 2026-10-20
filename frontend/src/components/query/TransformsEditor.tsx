import { Button, Flex, IconButton, Input, Select, Text, VStack } from '@chakra-ui/react';
import type { ResultColumn } from '../../api';
import { PlusIcon, XIcon } from '../../icons';
import type { Transform, TransformType } from '../../query/types';
import { t } from '../../i18n/index.ts';

const TRANSFORMS: { type: TransformType; label: string; hint: string }[] = [
  { type: 'previous_period', label: t('Compare with previous'), hint: t('The value one period earlier (matched by date) and the change') },
  { type: 'pct_change', label: t('% change of'), hint: t('Change against the previous row') },
  { type: 'running_total', label: t('Running total of'), hint: t('Adds up along the time (per series)') },
  { type: 'moving_average', label: t('Moving average of'), hint: t('Average of the last N rows (per series)') },
  { type: 'pct_of_total', label: t('% of total of'), hint: t('Share of the total, overall or within a group') },
  { type: 'rank', label: t('Rank by'), hint: t('1 = largest, overall or within a group') },
  { type: 'outliers', label: t('Flag outliers in'), hint: t('Marks values far from the rest') },
];
const PERIODS = ['day', 'week', 'month', 'quarter', 'year'] as const;
const PERIOD_LABELS: Record<(typeof PERIODS)[number], string> = {
  day: t('yesterday'),
  week: t('last week'),
  month: t('last month'),
  quarter: t('last quarter'),
  year: t('last year'),
};

interface Props {
  transforms: Transform[];
  columns: ResultColumn[]; // of the last result
  onChange: (transforms: Transform[]) => void;
}

/** Calculations on the result: previous period, running total, % of total ... (applied after the query). */
export function TransformsEditor({ transforms, columns, onChange }: Props) {
  const base = columns.filter((c) => !c.generated);
  const numbers = base.filter((c) => c.type === 'number');
  const dims = base.filter((c) => c.role === 'dimension');
  const dates = base.filter((c) => c.type === 'date' || c.type === 'datetime');
  const set = (i: number, next: Transform | null) => onChange(next === null ? transforms.filter((_, k) => k !== i) : transforms.map((x, k) => (k === i ? next : x)));
  const label = (c: ResultColumn) => c.display_name || c.name;

  if (base.length === 0 && transforms.length === 0)
    return (
      <Text fontSize="sm" color="faintText">
        {t('Run the question once to add calculations such as “vs. last year” or a running total.')}
      </Text>
    );
  return (
    <VStack align="stretch" spacing={2} data-testid="transforms">
      {transforms.map((tf, i) => {
        const info = TRANSFORMS.find((x) => x.type === tf.type)!;
        return (
          <Flex key={i} gap={2} align="center" wrap="wrap" data-testid="transform-row">
            <Select size="sm" maxW="210px" value={tf.type} onChange={(e) => set(i, { type: e.target.value as TransformType, column: tf.column })} aria-label={t('Calculation')} title={info.hint}>
              {TRANSFORMS.map((x) => (
                <option key={x.type} value={x.type}>
                  {x.label}
                </option>
              ))}
            </Select>
            <Select size="sm" maxW="180px" value={tf.column} onChange={(e) => set(i, { ...tf, column: e.target.value })} aria-label={t('Value column')}>
              {!numbers.some((c) => c.name === tf.column) && <option value={tf.column}>{tf.column || t('Pick…')}</option>}
              {numbers.map((c) => (
                <option key={c.name} value={c.name}>
                  {label(c)}
                </option>
              ))}
            </Select>
            {tf.type === 'previous_period' && (
              <Select size="sm" maxW="150px" value={tf.period ?? ''} onChange={(e) => set(i, { ...tf, period: (e.target.value || null) as Transform['period'] })} aria-label={t('Period')}>
                <option value="">{t('previous step')}</option>
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {PERIOD_LABELS[p]}
                  </option>
                ))}
              </Select>
            )}
            {tf.type === 'moving_average' && (
              <Input size="sm" type="number" min={2} max={365} maxW="90px" value={tf.window ?? 3} onChange={(e) => set(i, { ...tf, window: Math.max(2, Number(e.target.value) || 3) })} aria-label={t('Rows')} />
            )}
            {(tf.type === 'rank' || tf.type === 'pct_of_total') && (
              <Select size="sm" maxW="180px" value={tf.by ?? ''} onChange={(e) => set(i, { ...tf, by: e.target.value || null })} aria-label={t('Within')}>
                <option value="">{t('overall')}</option>
                {dims.map((c) => (
                  <option key={c.name} value={c.name}>
                    {t('within each {name}', { name: label(c) })}
                  </option>
                ))}
              </Select>
            )}
            {['running_total', 'moving_average', 'pct_change', 'previous_period'].includes(tf.type) && dates.length > 1 && (
              <Select size="sm" maxW="160px" value={tf.by ?? ''} onChange={(e) => set(i, { ...tf, by: e.target.value || null })} aria-label={t('Along')}>
                <option value="">{t('along {name}', { name: label(dates[0]) })}</option>
                {dates.slice(1).map((c) => (
                  <option key={c.name} value={c.name}>
                    {t('along {name}', { name: label(c) })}
                  </option>
                ))}
              </Select>
            )}
            {tf.type === 'outliers' && (
              <Select size="sm" maxW="170px" value={tf.method ?? 'iqr'} onChange={(e) => set(i, { ...tf, method: e.target.value as 'iqr' | 'zscore' })} aria-label={t('Method')}>
                <option value="iqr">{t('beyond 1.5 × IQR')}</option>
                <option value="zscore">{t('more than 3 σ')}</option>
              </Select>
            )}
            <IconButton aria-label={t('Remove calculation')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => set(i, null)} />
          </Flex>
        );
      })}
      <Button
        size="xs"
        variant="subtle"
        leftIcon={<PlusIcon boxSize={3} />}
        alignSelf="flex-start"
        isDisabled={numbers.length === 0 || transforms.length >= 20}
        onClick={() => onChange([...transforms, { type: dates.length ? 'previous_period' : 'pct_of_total', column: numbers[numbers.length - 1]?.name ?? '' }])}
        data-testid="add-transform"
      >
        {t('Calculation')}
      </Button>
    </VStack>
  );
}
