import { Box, HStack, Select, Text } from '@chakra-ui/react';
import { engineMeta } from '../lib/engines';
import { useWorkspace } from '../workspace/useWorkspace';
import { EngineBadge } from './EngineBadge';
import { tn } from '../i18n/index.ts';

/** The active database: a title on wide screens, a picker on phones (where the sidebar is hidden). */
export function ConnectionHeader() {
  const { connections, activeKey, active, selectConnection, tables } = useWorkspace();
  return (
    <>
      {connections.length > 0 && (
        <Select display={{ base: 'block', md: 'none' }} value={activeKey} onChange={(e) => selectConnection(e.target.value)}>
          {connections.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </Select>
      )}
      {active && (
        <HStack spacing={3} display={{ base: 'none', md: 'flex' }}>
          <EngineBadge engine={active.engine} size={40} />
          <Box>
            <Text fontSize="2xl" fontWeight={700} letterSpacing="-0.02em" lineHeight="1.1">
              {active.label}
            </Text>
            <Text fontSize="sm" color="mutedText">
              {engineMeta(active.engine).label} · {active.database}
              {tables && ` · ${tn(tables.length, '{n} table', '{n} tables')}`}
            </Text>
          </Box>
        </HStack>
      )}
    </>
  );
}
