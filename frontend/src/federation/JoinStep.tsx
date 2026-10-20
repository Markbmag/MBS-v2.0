import { Box, Button, Flex, HStack, IconButton, Select, Text, Tooltip, VStack } from '@chakra-ui/react';
import { t } from '../i18n/index.ts';
import { PlusIcon, SparklesIcon, XIcon } from '../icons';
import { joinedBefore, suggestKey, syncJoins } from './logic';
import { JOIN_TYPES, MATCHES } from './types';
import type { ColumnHint, FederatedSpec, Join, JoinType, KeyMatch, KeyPair } from './types';

interface Props {
  spec: FederatedSpec;
  columns: Record<string, ColumnHint[]>;   // per source alias (from its preview)
  labels: Record<string, string>;
  onChange: (joins: Join[]) => void;
}

/** One block per source after the first: how it is joined, on which key columns. */
export function JoinStep({ spec, columns, labels, onChange }: Props) {
  const joins = syncJoins(spec);
  if (joins.length === 0)
    return (
      <Text fontSize="sm" color="mutedText">
        {t('Add a second source to join it to the first.')}
      </Text>
    );
  const set = (i: number, j: Join) => onChange(joins.map((x, k) => (k === i ? j : x)));
  return (
    <VStack align="stretch" spacing={3}>
      {joins.map((j, i) => {
        const before = joinedBefore(spec, j.source);
        const leftOptions = before.flatMap((a) => (columns[a] ?? []).map((c) => ({ ref: `${a}.${c.name}`, label: c.name, group: labels[a] || a })));
        const rightOptions = (columns[j.source] ?? []).map((c) => ({ ref: `${j.source}.${c.name}`, label: c.name, group: labels[j.source] || j.source }));
        const setKey = (k: number, pair: KeyPair | null) =>
          set(i, { ...j, on: pair === null ? j.on.filter((_, x) => x !== k) : j.on.map((p, x) => (x === k ? pair : p)) });
        const suggestion = suggestKey(Object.fromEntries(before.map((a) => [a, columns[a] ?? []])), columns[j.source] ?? [], j.source);
        const empty = j.on.every((p) => !p.left || !p.right);
        return (
          <Box key={j.source} border="1px solid" borderColor="lineColor" borderRadius="lg" p={3} data-testid="join-block">
            <Flex align="center" gap={2} wrap="wrap" mb={2}>
              <Text fontSize="sm" fontWeight={700}>
                {labels[j.source] || j.source}
              </Text>
              <Select size="xs" maxW="230px" value={j.type} onChange={(e) => set(i, { ...j, type: e.target.value as JoinType })} aria-label={t('How to join {source}', { source: j.source })}>
                {JOIN_TYPES.map((jt) => (
                  <option key={jt.value} value={jt.value}>
                    {t(jt.label)}
                  </option>
                ))}
              </Select>
              {empty && suggestion && (
                <Button size="xs" variant="ghost" leftIcon={<SparklesIcon boxSize={3} />} onClick={() => set(i, { ...j, on: [suggestion] })} data-testid="suggest-key">
                  {t('Use {left} = {right}', { left: suggestion.left.split('.')[1], right: suggestion.right.split('.')[1] })}
                </Button>
              )}
            </Flex>
            <VStack align="stretch" spacing={1.5}>
              {j.on.map((pair, k) => (
                <Flex key={k} gap={1.5} align="center" wrap={{ base: 'wrap', md: 'nowrap' }}>
                  <KeySelect options={leftOptions} value={pair.left} onChange={(left) => setKey(k, { ...pair, left })} label={t('Key on the left')} testId="key-left" />
                  <Text fontSize="sm" color="faintText">
                    =
                  </Text>
                  <KeySelect options={rightOptions} value={pair.right} onChange={(right) => setKey(k, { ...pair, right })} label={t('Key of {source}', { source: j.source })} testId="key-right" />
                  <Tooltip label={t('How the key values are compared. Automatic: numbers as numbers, text trimmed.')} hasArrow openDelay={300}>
                    <Select size="xs" w="auto" minW="120px" maxW="190px" value={pair.match ?? 'auto'} onChange={(e) => setKey(k, { ...pair, match: e.target.value as KeyMatch })} aria-label={t('Compare keys')}>
                      {MATCHES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {t(m.label)}
                        </option>
                      ))}
                    </Select>
                  </Tooltip>
                  {j.on.length > 1 && (
                    <IconButton aria-label={t('Remove key')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => setKey(k, null)} />
                  )}
                </Flex>
              ))}
            </VStack>
            {j.on.length < 4 && (
              <HStack mt={2}>
                <Button size="xs" variant="ghost" leftIcon={<PlusIcon boxSize={3} />} onClick={() => set(i, { ...j, on: [...j.on, { left: '', right: '', match: 'auto' }] })}>
                  {t('Another key column')}
                </Button>
              </HStack>
            )}
          </Box>
        );
      })}
    </VStack>
  );
}

function KeySelect({ options, value, onChange, label, testId }: {
  options: { ref: string; label: string; group: string }[];
  value: string;
  onChange: (ref: string) => void;
  label: string;
  testId: string;
}) {
  const groups = new Map<string, typeof options>();
  for (const o of options) {
    if (!groups.has(o.group)) groups.set(o.group, []);
    groups.get(o.group)!.push(o);
  }
  const missing = value && !options.some((o) => o.ref === value);
  return (
    <Select size="xs" flex={1} minW="140px" value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('Pick a column…')} aria-label={label} data-testid={testId}>
      {missing && <option value={value}>{value}</option>}
      {[...groups.entries()].map(([group, items]) => (
        <optgroup key={group} label={group}>
          {items.map((o) => (
            <option key={o.ref} value={o.ref}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
