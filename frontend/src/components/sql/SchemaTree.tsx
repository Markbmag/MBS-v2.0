import { useMemo, useState } from 'react';
import { Box, Button, Flex, IconButton, Input, InputGroup, InputLeftElement, Skeleton, Text, Tooltip, VStack } from '@chakra-ui/react';
import type { SchemaTable } from '../../api';
import { ChevronDownIcon, KeyIcon, LinkIcon, RefreshIcon, SearchIcon, TableIcon } from '../../icons';
import { t } from '../../i18n/index.ts';

const TYPE_MARK: Record<string, string> = {
  string: 'Aa', number: '#', boolean: '✓', date: 'D', datetime: 'DT', time: 'T', json: '{}', binary: '01', unknown: '?',
};
const MAX_TABLES = 300;

interface SchemaTreeProps {
  tables: SchemaTable[] | undefined;
  loading: boolean;
  error: string | null;
  onInsert: (text: string) => void;
  onInsertSelect: (table: string) => void;
  onReload: () => void;
  quote: (name: string) => string;
}

/** Tables and columns of the database. Click a name to insert it; SELECT (on hover) inserts a query. */
export function SchemaTree({ tables, loading, error, onInsert, onInsertSelect, onReload, quote }: SchemaTreeProps) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = [...(tables ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    if (!needle) return all;
    return all.filter((t) => t.name.toLowerCase().includes(needle) || t.columns.some((c) => c.name.toLowerCase().includes(needle)));
  }, [tables, filter]);

  return (
    <Flex direction="column" h="100%" minH={0} data-testid="schema-tree">
      <Flex gap={2} p={2} borderBottom="1px solid" borderColor="lineColor">
        <InputGroup size="sm">
          <InputLeftElement pointerEvents="none" color="faintText">
            <SearchIcon boxSize={3.5} />
          </InputLeftElement>
          <Input placeholder={t('Tables and columns')} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('Filter tables')} />
        </InputGroup>
        <Tooltip label={t('Read the structure again')} hasArrow>
          <IconButton aria-label={t('Reload structure')} size="sm" icon={<RefreshIcon boxSize={3.5} />} onClick={onReload} />
        </Tooltip>
      </Flex>
      <Box flex={1} overflowY="auto" px={1} py={1} fontSize="sm">
        {loading && (
          <VStack align="stretch" p={2} spacing={2}>
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} h="18px" />
            ))}
          </VStack>
        )}
        {error && (
          <Text color="red.300" fontSize="xs" p={2}>
            {error}
          </Text>
        )}
        {shown.slice(0, MAX_TABLES).map((tbl) => {
          const expanded = open[tbl.name] ?? (filter.trim() !== '' && shown.length <= 5);
          return (
            <Box key={tbl.name}>
              <Flex
                align="center"
                gap={1.5}
                px={1.5}
                py={1}
                borderRadius="md"
                cursor="pointer"
                _hover={{ bg: 'panelHover' }}
                role="group"
              >
                <IconButton
                  aria-label={expanded ? t('Collapse {name}', { name: tbl.name }) : t('Expand {name}', { name: tbl.name })}
                  size="xs"
                  variant="ghost"
                  minW="18px"
                  h="18px"
                  icon={<ChevronDownIcon boxSize={3} transform={expanded ? undefined : 'rotate(-90deg)'} />}
                  onClick={() => setOpen((o) => ({ ...o, [tbl.name]: !expanded }))}
                />
                <TableIcon boxSize={3.5} color="brand.300" />
                <Tooltip label={t('Insert the table name')} hasArrow openDelay={600}>
                  <Text flex={1} noOfLines={1} fontWeight={600} onClick={() => onInsert(quote(tbl.name))} data-testid={`tree-table-${tbl.name}`}>
                    {tbl.name}
                  </Text>
                </Tooltip>
                <Button
                  size="xs"
                  variant="ghost"
                  h="18px"
                  px={1.5}
                  fontSize="2xs"
                  opacity={0}
                  _groupHover={{ opacity: 1 }}
                  _focus={{ opacity: 1 }}
                  onClick={() => onInsertSelect(tbl.name)}
                  aria-label={t('Insert SELECT from {name}', { name: tbl.name })}
                  data-testid={`tree-select-${tbl.name}`}
                >
                  SELECT
                </Button>
                <Text fontSize="2xs" color="faintText" minW="16px" textAlign="right">
                  {tbl.columns.length}
                </Text>
              </Flex>
              {expanded &&
                tbl.columns.map((c) => (
                  <Flex
                    key={c.name}
                    align="center"
                    gap={1.5}
                    pl={8}
                    pr={1.5}
                    py={0.5}
                    borderRadius="md"
                    cursor="pointer"
                    _hover={{ bg: 'panelHover' }}
                    onClick={() => onInsert(quote(c.name))}
                    title={`${c.db_type}${c.foreign_key ? ` → ${c.foreign_key.table}.${c.foreign_key.column}` : ''}`}
                  >
                    <Text as="span" w="18px" fontSize="2xs" color="faintText" fontFamily="mono">
                      {TYPE_MARK[c.type] ?? '?'}
                    </Text>
                    <Text flex={1} noOfLines={1} fontFamily="mono" fontSize="xs">
                      {c.name}
                    </Text>
                    {c.primary_key && <KeyIcon boxSize={3} color="yellow.400" />}
                    {c.foreign_key && <LinkIcon boxSize={3} color="brand.300" />}
                  </Flex>
                ))}
            </Box>
          );
        })}
        {shown.length > MAX_TABLES && (
          <Text fontSize="xs" color="faintText" p={2}>
            {t('{n} more — type to narrow the list.', { n: shown.length - MAX_TABLES })}
          </Text>
        )}
        {!loading && !error && shown.length === 0 && (
          <Text fontSize="xs" color="faintText" p={2}>
            {t('Nothing matches.')}
          </Text>
        )}
      </Box>
    </Flex>
  );
}
