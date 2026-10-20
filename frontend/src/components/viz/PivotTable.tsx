import { Box, Table as CTable, Tbody, Td, Text, Th, Thead, Tr } from '@chakra-ui/react';
import { pivot } from '../../viz/data';
import type { Table } from '../../viz/data';
import { formatCell, formatNumber } from '../../viz/format';
import type { VizSpec } from '../../viz/types';
import { t } from '../../i18n/index.ts';

const MAX_COLS = 60;
const MAX_ROWS = 500;

/** Rows x columns with sums (or other aggregates) and totals, computed in the browser. */
export function PivotTable({ table, viz }: { table: Table; viz: VizSpec }) {
  const spec = viz.pivot;
  if (!spec || spec.values.length === 0) {
    return (
      <Text p={4} fontSize="sm" color="mutedText">
        {t('Choose rows, columns and values in the chart settings.')}
      </Text>
    );
  }
  const p = pivot(table, spec);
  const totals = spec.totals !== false;
  const cols = p.colKeys.slice(0, MAX_COLS);
  const rows = p.rowKeys.slice(0, MAX_ROWS);
  const multi = spec.values.length > 1;
  const typeOf = (name: string) => table.columns.find((c) => c.name === name)?.type ?? 'string';
  const label = (names: string[], values: string[]) => values.map((v, i) => formatCell(v, typeOf(names[i]), names[i])).join(' · ') || t('All');
  const fmtValue = (v: number | null, k: number) => (v === null ? '' : formatNumber(v, viz.format?.[spec.values[k].column] ?? {}));

  return (
    <Box h="100%" overflow="auto" data-testid="pivot">
      <CTable size="sm" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        <Thead position="sticky" top={0} bg="chipBg" zIndex={1}>
          <Tr>
            <Th>{spec.rows.join(' · ') || ''}</Th>
            {cols.map((ck, c) =>
              spec.values.map((_v, k) => (
                <Th key={`${c}-${k}`} isNumeric>
                  {label(spec.columns, ck)}
                  {multi && <Text as="span" color="faintText" textTransform="none"> {p.valueLabels[k]}</Text>}
                </Th>
              )),
            )}
            {totals && spec.values.map((_, k) => <Th key={`t${k}`} isNumeric>{t('Total')}{multi ? ` ${p.valueLabels[k]}` : ''}</Th>)}
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((rk, r) => (
            <Tr key={r}>
              <Td fontWeight={600}>{label(spec.rows, rk)}</Td>
              {cols.map((_, c) => spec.values.map((__, k) => <Td key={`${c}-${k}`} isNumeric>{fmtValue(p.cell(r, c, k), k)}</Td>))}
              {totals && spec.values.map((_, k) => <Td key={`t${k}`} isNumeric fontWeight={600}>{fmtValue(p.rowTotal(r, k), k)}</Td>)}
            </Tr>
          ))}
          {totals && (
            <Tr>
              <Td fontWeight={700}>{t('Total')}</Td>
              {cols.map((_, c) => spec.values.map((__, k) => <Td key={`${c}-${k}`} isNumeric fontWeight={700}>{fmtValue(p.colTotal(c, k), k)}</Td>))}
              {spec.values.map((_, k) => <Td key={`g${k}`} isNumeric fontWeight={700}>{fmtValue(p.grandTotal(k), k)}</Td>)}
            </Tr>
          )}
        </Tbody>
      </CTable>
      {(p.colKeys.length > MAX_COLS || p.rowKeys.length > MAX_ROWS) && (
        <Text p={2} fontSize="xs" color="faintText">
          {t('Showing {rows} of {rowTotal} rows and {cols} of {colTotal} columns.', { rows: rows.length, rowTotal: p.rowKeys.length, cols: cols.length, colTotal: p.colKeys.length })}
        </Text>
      )}
    </Box>
  );
}
