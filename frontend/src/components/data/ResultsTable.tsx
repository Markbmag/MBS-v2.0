import { useCallback, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Box, Flex, Text, Tooltip, useToast } from '@chakra-ui/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ColumnType, ResultColumn } from '../../api';
import { formatValue } from '../../lib/format';
import { formatNumber } from '../../viz/format';
import type { ColumnFormat } from '../../viz/types';
import { cellToString } from '../../lib/csv';
import { t } from '../../i18n/index.ts';

const ROW_HEIGHT = 32;
const NUMBER_COL_WIDTH = 56;
const TYPE_MARK: Record<ColumnType, string> = {
  string: 'Aa', number: '#', boolean: '✓', date: '📅', datetime: '🕒', time: '🕒', json: '{}', binary: '01', unknown: '?',
};

function defaultWidth(col: ResultColumn): number {
  const byType: Partial<Record<ColumnType, number>> = { number: 120, boolean: 90, date: 120, datetime: 170, time: 110 };
  const forName = col.name.length * 8 + 48;
  return Math.min(320, Math.max(byType[col.type] ?? 180, forName));
}

interface ResultsTableProps {
  columns: ResultColumn[];
  rows: unknown[][];
  smartDates?: boolean;
  height?: string | number;
}

/**
 * Virtualised result grid: only the visible rows are in the page, so 10,000 rows
 * scroll smoothly. Drag a header edge to resize; click a cell to select it,
 * Ctrl/Cmd+C or double-click copies the raw value; arrow keys move.
 */
export function ResultsTable({ columns, rows, smartDates = false, height = '100%' }: ResultsTableProps) {
  const toast = useToast();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [widths, setWidths] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);

  const colWidths = useMemo(() => columns.map((c, i) => widths[i] ?? defaultWidth(c)), [columns, widths]);
  const totalWidth = NUMBER_COL_WIDTH + colWidths.reduce((a, b) => a + b, 0);

  // The virtualizer is mutable by design (it re-renders on scroll); the React compiler leaves this component alone.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const copy = useCallback(
    (row: number, col: number) => {
      const text = cellToString(rows[row]?.[col]).replace(/^'/, '');
      void navigator.clipboard
        ?.writeText(text)
        .then(() => toast({ title: t('Copied'), description: text.slice(0, 80) || t('(empty)'), status: 'success', duration: 1200 }))
        .catch(() => toast({ title: t('The browser did not allow copying'), status: 'warning', duration: 2000 }));
    },
    [rows, toast],
  );

  const startResize = (index: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = colWidths[index];
    const move = (e: PointerEvent) => setWidths((prev) => ({ ...prev, [index]: Math.max(60, startWidth + e.clientX - startX) }));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!selected) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copy(selected.row, selected.col);
      return;
    }
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const row = Math.min(rows.length - 1, Math.max(0, selected.row + move[0]));
    const col = Math.min(columns.length - 1, Math.max(0, selected.col + move[1]));
    setSelected({ row, col });
    virtualizer.scrollToIndex(row);
  };

  return (
    <Box
      ref={scrollRef}
      h={height}
      overflow="auto"
      position="relative"
      tabIndex={0}
      onKeyDown={onKeyDown}
      fontSize="sm"
      outline="none"
      data-testid="results-table"
      role="grid"
      aria-rowcount={rows.length}
    >
      <Box minW={`${totalWidth}px`} position="relative">
        <Flex position="sticky" top={0} zIndex={2} bg="chipBg" borderBottom="1px solid" borderColor="lineColor" backdropFilter="blur(8px)">
          <Box w={`${NUMBER_COL_WIDTH}px`} flexShrink={0} px={2} py={2} color="faintText" fontSize="xs" textAlign="right">
            #
          </Box>
          {columns.map((col, i) => (
            <Flex
              key={`${col.name}-${i}`}
              role="columnheader"
              w={`${colWidths[i]}px`}
              flexShrink={0}
              align="center"
              gap={1.5}
              px={2}
              py={2}
              position="relative"
              justify={col.type === 'number' ? 'flex-end' : 'flex-start'}
            >
              <Tooltip
                label={`${col.display_name ? `${col.name} · ` : ''}${col.type}${col.role === 'measure' ? ` · ${t('measure')}` : ''}${col.description ? ` — ${col.description}` : ''}`}
                hasArrow
                openDelay={400}
              >
                <Text as="span" fontSize="2xs" color="faintText" fontFamily="mono">
                  {TYPE_MARK[col.type] ?? '?'}
                </Text>
              </Tooltip>
              <Text as="span" fontWeight={700} fontSize="xs" noOfLines={1} title={col.name} color={col.generated ? 'teal.300' : undefined}>
                {col.display_name || col.name}
              </Text>
              <Box
                position="absolute"
                right={0}
                top={0}
                bottom={0}
                w="6px"
                cursor="col-resize"
                _hover={{ bg: 'brand.400' }}
                onPointerDown={startResize(i)}
                aria-label={t('Resize {name}', { name: col.name })}
              />
            </Flex>
          ))}
        </Flex>

        <Box h={`${virtualizer.getTotalSize()}px`} position="relative">
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <Flex
                key={item.key}
                role="row"
                position="absolute"
                top={0}
                left={0}
                w="100%"
                h={`${ROW_HEIGHT}px`}
                transform={`translateY(${item.start}px)`}
                borderBottom="1px solid"
                borderColor="lineColor"
                _hover={{ bg: 'panelHover' }}
              >
                <Box w={`${NUMBER_COL_WIDTH}px`} flexShrink={0} px={2} lineHeight={`${ROW_HEIGHT}px`} color="faintText" fontSize="xs" textAlign="right">
                  {item.index + 1}
                </Box>
                {columns.map((col, c) => {
                  const value = row[c];
                  const isSelected = selected?.row === item.index && selected.col === c;
                  return (
                    <Box
                      key={c}
                      role="gridcell"
                      w={`${colWidths[c]}px`}
                      flexShrink={0}
                      px={2}
                      lineHeight={`${ROW_HEIGHT - 2}px`}
                      whiteSpace="nowrap"
                      overflow="hidden"
                      textOverflow="ellipsis"
                      textAlign={col.type === 'number' ? 'right' : 'left'}
                      fontFamily={col.type === 'number' ? 'mono' : undefined}
                      sx={{ fontVariantNumeric: 'tabular-nums' }}
                      cursor="default"
                      outline={isSelected ? '2px solid' : undefined}
                      outlineColor="brand.400"
                      outlineOffset="-2px"
                      onClick={() => setSelected({ row: item.index, col: c })}
                      onDoubleClick={() => copy(item.index, c)}
                      title={value === null || value === undefined ? undefined : String(typeof value === 'object' ? JSON.stringify(value) : value)}
                    >
                      {value === null || value === undefined ? (
                        <Text as="span" color="faintText" fontStyle="italic" fontSize="xs">
                          null
                        </Text>
                      ) : (
                        typeof value === 'number' && col.format
                          ? formatNumber(value, col.format as ColumnFormat)
                          : formatValue(value, col.type, col.role, { smartDates })
                      )}
                    </Box>
                  );
                })}
              </Flex>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
