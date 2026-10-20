import { Badge, Button, Flex, HStack, IconButton, Input, Menu, MenuButton, MenuDivider, MenuGroup, MenuItem, MenuList, Select, Text, Tooltip, VStack } from '@chakra-ui/react';
import { LinkIcon, PlusIcon, XIcon } from '../../icons';
import { columnOptions, humanize, queryTables } from '../../query/draft';
import type { SchemaInfo } from '../../query/draft';
import { joinSuggestions } from '../../query/joins';
import type { Join, JoinType, QuerySpec } from '../../query/types';
import { ColumnSelect } from './ColumnSelect';
import { t } from '../../i18n/index.ts';

const TYPES: { value: JoinType; label: string; hint: string }[] = [
  { value: 'left', label: t('Left join'), hint: t('Keep every row of the data so far, add matches where they exist') },
  { value: 'inner', label: t('Inner join'), hint: t('Only rows that have a match on both sides') },
  { value: 'full', label: t('Full join'), hint: t('Every row from both sides (not on MySQL / MariaDB)') },
];

interface JoinEditorProps {
  spec: QuerySpec;
  schema: SchemaInfo;
  onChange: (joins: Join[]) => void;
}

export function JoinEditor({ spec, schema, onChange }: JoinEditorProps) {
  const joins = spec.joins ?? [];
  const inQuery = queryTables(spec, schema);
  const suggestions = joinSuggestions(
    schema.relationships,
    schema.tables.map((t) => t.name),
    inQuery.map((t) => t.table),
  );
  const suggested = new Set(suggestions.map((s) => s.table));
  const others = schema.tables.map((t) => t.name).filter((n) => !suggested.has(n));

  const update = (i: number, join: Join | null) => {
    const next = [...joins];
    if (join === null) next.splice(i, 1);
    else next[i] = join;
    onChange(next);
  };

  const addAuto = (table: string) => onChange([...joins, { table, type: 'left' }]);
  const addCustom = (table: string) => {
    const taken = new Set(inQuery.map((t) => t.alias));
    let alias = table;
    for (let n = 2; taken.has(alias); n++) alias = `${table}_${n}`;
    onChange([...joins, { table, type: 'left', alias, on: [{ left: '', right: '' }] }]);
  };

  return (
    <VStack align="stretch" spacing={2}>
      {joins.map((join, i) => {
        const before = columnOptions({ ...spec, joins: joins.slice(0, i), expressions: [] }, schema);
        const alias = join.alias || join.table;
        const target = schema.tables.find((t) => t.name === join.table);
        const rightOptions = (target?.columns ?? []).map((c) => ({ ref: `${alias}.${c.name}`, label: humanize(c.name), type: c.type }));
        const via = queryTables({ ...spec, joins: joins.slice(0, i + 1) }, schema).filter((t) => t.via && !inQueryBefore(spec, schema, i).includes(t.table));
        const custom = (join.on?.length ?? 0) > 0;
        return (
          <Flex key={i} direction="column" gap={2} p={2} borderRadius="lg" bg="chipBg" data-testid="join-row">
            <Flex gap={2} align="center" wrap="wrap">
              <LinkIcon boxSize={3.5} color="brand.300" />
              <Text fontWeight={700} fontSize="sm">
                {humanize(join.table)}
                {join.alias && join.alias !== join.table && (
                  <Text as="span" color="faintText" fontWeight={400}>
                    {' '}
                    {t('as {alias}', { alias: join.alias })}
                  </Text>
                )}
              </Text>
              <Select size="xs" maxW="120px" value={join.type} onChange={(e) => update(i, { ...join, type: e.target.value as JoinType })} aria-label={t('Join type')}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value} title={t.hint}>
                    {t.label}
                  </option>
                ))}
              </Select>
              {!custom && (
                <Tooltip label={t('The join follows the foreign keys declared in the database')} hasArrow>
                  <Badge bg="panelBg" color="mutedText" textTransform="none">
                    {via.length > 0 ? t('automatic · via {tables}', { tables: via.map((v) => humanize(v.table)).join(', ') }) : t('automatic')}
                  </Badge>
                </Tooltip>
              )}
              <IconButton aria-label={t('Remove join')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => update(i, null)} ml="auto" />
            </Flex>
            {custom && (
              <VStack align="stretch" spacing={1} pl={6}>
                {(join.on ?? []).map((pair, p) => (
                  <HStack key={p} spacing={2}>
                    <ColumnSelect options={before} value={pair.left || undefined} onChange={(left) => update(i, { ...join, on: join.on!.map((x, k) => (k === p ? { ...x, left } : x)) })} aria-label={t('Column so far')} />
                    <Text fontSize="sm">=</Text>
                    <ColumnSelect options={rightOptions} value={pair.right || undefined} onChange={(right) => update(i, { ...join, on: join.on!.map((x, k) => (k === p ? { ...x, right } : x)) })} aria-label={t('Column of the joined table')} />
                    {join.on!.length > 1 && (
                      <IconButton aria-label={t('Remove condition')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => update(i, { ...join, on: join.on!.filter((_, k) => k !== p) })} />
                    )}
                  </HStack>
                ))}
                <HStack spacing={2}>
                  <Button size="xs" variant="ghost" leftIcon={<PlusIcon boxSize={3} />} onClick={() => update(i, { ...join, on: [...(join.on ?? []), { left: '', right: '' }] })}>
                    {t('Another condition')}
                  </Button>
                  <Input size="xs" maxW="140px" value={join.alias ?? ''} placeholder={t('alias')} onChange={(e) => update(i, { ...join, alias: e.target.value.replace(/[^A-Za-z0-9_]/g, '') || undefined })} aria-label={t('Alias')} />
                </HStack>
              </VStack>
            )}
          </Flex>
        );
      })}

      <Menu isLazy>
        <MenuButton as={Button} size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} alignSelf="flex-start" data-testid="add-join">
          {t('Join data')}
        </MenuButton>
        <MenuList maxH="360px" overflowY="auto" fontSize="sm">
          {suggestions.length > 0 && (
            <MenuGroup title={t('Related (foreign keys)')}>
              {suggestions.map((s) => (
                <MenuItem key={s.table} onClick={() => addAuto(s.table)} data-testid={`join-suggestion-${s.table}`}>
                  <Flex direction="column">
                    <Text>{humanize(s.table)}</Text>
                    {s.via.length > 0 && (
                      <Text fontSize="xs" color="faintText">
                        {t('via {tables}', { tables: s.via.map(humanize).join(' → ') })}
                      </Text>
                    )}
                  </Flex>
                </MenuItem>
              ))}
            </MenuGroup>
          )}
          {suggestions.length > 0 && others.length > 0 && <MenuDivider />}
          {others.length > 0 && (
            <MenuGroup title={t('Other tables (you give the condition)')}>
              {others.map((t) => (
                <MenuItem key={t} onClick={() => addCustom(t)}>
                  {humanize(t)}
                </MenuItem>
              ))}
            </MenuGroup>
          )}
        </MenuList>
      </Menu>
    </VStack>
  );
}

function inQueryBefore(spec: QuerySpec, schema: SchemaInfo, index: number): string[] {
  return queryTables({ ...spec, joins: (spec.joins ?? []).slice(0, index) }, schema).map((t) => t.table);
}
