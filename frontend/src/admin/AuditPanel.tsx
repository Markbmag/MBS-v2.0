import { useState } from 'react';
import {
  Badge, Box, Button, Code, Flex, HStack, Input, Select, Skeleton, Table, Tbody, Td, Text, Th, Thead, Tooltip, Tr,
} from '@chakra-ui/react';
import { http } from '../api';
import { DownloadIcon } from '../icons';
import { saveBlob } from '../lib/csv';
import { Panel } from './Panel';
import { PAGE, useAudit } from './peopleApi';
import type { AuditFilters } from './peopleApi';
import { locale, t, tn } from '../i18n/index.ts';

const day = (value: string, end = false) => (value ? new Date(`${value}T00:00:00`).getTime() / 1000 + (end ? 86400 : 0) : undefined);

/** Admin → Audit: who did what and when - sign-ins, searches, queries, exports, changes. */
export function AuditPanel() {
  const [user, setUser] = useState('');
  const [action, setAction] = useState('');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const filters: AuditFilters = {
    ...(user ? { user } : {}), ...(action ? { action } : {}), ...(text.trim() ? { q: text.trim() } : {}),
    ...(from ? { since: day(from) } : {}), ...(to ? { until: day(to, true) } : {}),
  };
  const audit = useAudit(filters, page);
  const data = audit.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const set = (fn: () => void) => {
    fn();
    setPage(0);
  };
  const download = async () => {
    const res = await http.get<Blob>('/api/admin/audit.csv', { params: filters, responseType: 'blob' });
    saveBlob('ncode-audit.csv', res.data);
  };
  return (
    <Panel
      title={t('Audit log')}
      subtitle={t('Every sign-in, search, query, export and change, newest first. Search phrases and SQL are recorded.')}
      actions={
        <Button size="sm" leftIcon={<DownloadIcon boxSize={4} />} onClick={() => void download()} data-testid="audit-csv">
          CSV
        </Button>
      }
    >
      <Flex gap={2} wrap="wrap" mb={3}>
        <Select size="sm" w="160px" placeholder={t('Everyone')} value={user} onChange={(e) => set(() => setUser(e.target.value))} data-testid="audit-user">
          {data?.users.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </Select>
        <Select size="sm" w="170px" placeholder={t('Every action')} value={action} onChange={(e) => set(() => setAction(e.target.value))} data-testid="audit-action">
          {data?.actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Input size="sm" w="220px" placeholder={t('Text in phrase / SQL / details')} value={text} onChange={(e) => set(() => setText(e.target.value))} data-testid="audit-text" />
        <HStack spacing={1}>
          <Input size="sm" type="date" w="150px" value={from} onChange={(e) => set(() => setFrom(e.target.value))} aria-label={t('From')} />
          <Text fontSize="sm">–</Text>
          <Input size="sm" type="date" w="150px" value={to} onChange={(e) => set(() => setTo(e.target.value))} aria-label={t('To')} />
        </HStack>
      </Flex>
      {!data && <Skeleton h="200px" />}
      {data && (
        <>
          <Box overflowX="auto">
            <Table size="sm" data-testid="audit-table">
              <Thead>
                <Tr>
                  <Th textTransform="none">{t('When')}</Th>
                  <Th textTransform="none">{t('Who')}</Th>
                  <Th textTransform="none">{t('Action')}</Th>
                  <Th textTransform="none">{t('What')}</Th>
                  <Th textTransform="none" isNumeric>
                    {t('Result')}
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {data.entries.map((e) => (
                  <Tr key={e.id} verticalAlign="top">
                    <Td fontSize="xs" whiteSpace="nowrap">
                      {new Date(e.ts * 1000).toLocaleString(locale())}
                    </Td>
                    <Td fontSize="xs">{e.username ?? '—'}</Td>
                    <Td>
                      <Badge fontSize="2xs" colorScheme={e.status === 'denied' || e.status === 'error' ? 'red' : undefined}>
                        {e.action}
                      </Badge>
                    </Td>
                    <Td fontSize="xs" maxW="520px">
                      {e.connection && (
                        <Badge fontSize="2xs" variant="outline" mr={1}>
                          {e.connection}
                        </Badge>
                      )}
                      <Tooltip label={e.options || undefined} hasArrow placement="top-start" openDelay={400}>
                        <Code fontSize="2xs" bg="transparent" p={0} whiteSpace="pre-wrap" color="mutedText">
                          {e.phrase ?? ''}
                        </Code>
                      </Tooltip>
                    </Td>
                    <Td isNumeric fontSize="xs" whiteSpace="nowrap">
                      {e.status ?? ''}
                      {e.found !== null && e.found !== undefined ? ` · ${e.found}` : ''}
                      {e.duration_sec !== null && e.duration_sec !== undefined ? ` · ${t('{s} s', { s: e.duration_sec.toFixed(2) })}` : ''}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
          <HStack justify="space-between" mt={3} fontSize="sm">
            <Text color="mutedText">
              {tn(data.total, '{n} entry', '{n} entries')}
            </Text>
            <HStack>
              <Button size="xs" onClick={() => setPage((p) => Math.max(0, p - 1))} isDisabled={page === 0}>
                {t('Newer')}
              </Button>
              <Text>
                {page + 1} / {pages}
              </Text>
              <Button size="xs" onClick={() => setPage((p) => p + 1)} isDisabled={page + 1 >= pages} data-testid="audit-older">
                {t('Older')}
              </Button>
            </HStack>
          </HStack>
        </>
      )}
    </Panel>
  );
}
