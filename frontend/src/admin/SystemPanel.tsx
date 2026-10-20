import { Alert, AlertIcon, Badge, Box, Button, Code, Flex, HStack, IconButton, SimpleGrid, Skeleton, Text, VStack, useToast } from '@chakra-ui/react';
import { apiErrorMessage, http } from '../api';
import { DownloadIcon, PlusIcon, TrashIcon } from '../icons';
import { saveBlob } from '../lib/csv';
import { Panel } from './Panel';
import { people, useBackups, useReady } from './peopleApi';
import { locale, t } from '../i18n/index.ts';

const size = (bytes: number) =>
  bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes > 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Admin → System: backups of Ncode's own data and the server's health. */
export function SystemPanel() {
  const toast = useToast();
  const backups = useBackups();
  const ready = useReady();
  const fail = (what: string) => (e: unknown) => toast({ status: 'error', title: what, description: apiErrorMessage(e, t('Please try again')), duration: 6000, isClosable: true });
  const download = async (name: string) => {
    try {
      const res = await http.get<Blob>(`/api/admin/backups/${encodeURIComponent(name)}`, { responseType: 'blob' });
      saveBlob(name, res.data);
    } catch (e) {
      fail(t('Download failed'))(e);
    }
  };
  const checks = ready.data?.checks ?? {};
  return (
    <VStack align="stretch" spacing={6}>
      <Panel
        title={t('Backups')}
        subtitle={t("A backup holds Ncode's own database (users, library, dashboards, settings) and the uploaded files - not the databases you connect to. One is made automatically every night (NCODE_BACKUP_HOUR) and the last NCODE_BACKUP_KEEP are kept.")}
        actions={
          <Button size="sm" leftIcon={<PlusIcon boxSize={4} />} onClick={() => void people.backupNow().then(() => toast({ status: 'success', title: t('Backup made'), duration: 1500 })).catch(fail(t('The backup failed')))} data-testid="backup-now">
            {t('Back up now')}
          </Button>
        }
      >
        <Alert status="warning" borderRadius="md" fontSize="sm" mb={3}>
          <AlertIcon />
          <Box>
            {t('The encryption key is not in the backups. Keep a copy of {file} (or {env}) somewhere safe: without it, saved database and email passwords cannot be read after a restore.').split(/(\{file\}|\{env\})/).map((part, i) =>
              part === '{file}' ? <Code key={i} fontSize="xs">backend/data/secret.key</Code> : part === '{env}' ? <Code key={i} fontSize="xs">NCODE_SECRET_KEY</Code> : part,
            )}
          </Box>
        </Alert>
        {backups.isPending && <Skeleton h="60px" />}
        {backups.data?.backups.length === 0 && (
          <Text fontSize="sm" color="mutedText">
            {t('No backups yet.')}
          </Text>
        )}
        <VStack align="stretch" spacing={2}>
          {backups.data?.backups.map((b) => (
            <Flex key={b.name} align="center" gap={3} px={3} py={2} borderRadius="xl" bg="chipBg" data-testid="backup-row">
              <Box flex={1} minW={0}>
                <Text fontSize="sm" fontFamily="mono" noOfLines={1}>
                  {b.name}
                </Text>
                <Text fontSize="xs" color="mutedText">
                  {new Date(b.created_at * 1000).toLocaleString(locale())} · {size(b.size)}
                </Text>
              </Box>
              <Badge>{b.auto ? t('automatic') : t('by hand')}</Badge>
              <IconButton aria-label={t('Download')} size="sm" icon={<DownloadIcon boxSize={4} />} onClick={() => void download(b.name)} />
              <IconButton aria-label={t('Delete')} size="sm" variant="ghost" colorScheme="red" icon={<TrashIcon boxSize={4} />}
                onClick={() => window.confirm(t('Delete {name}?', { name: b.name })) && void people.deleteBackup(b.name).catch(fail(t('Could not delete')))} />
            </Flex>
          ))}
        </VStack>
        <Text fontSize="xs" color="mutedText" mt={3}>
          {t('Folder on the server:')} <Code fontSize="xs">{backups.data?.folder}</Code>
          {backups.data ? ` · ${t('{size} free', { size: size(backups.data.disk_free) })}` : ''}. {t('To restore: stop the server, then')}{' '}
          <Code fontSize="xs">python -m app.manage restore &lt;file.zip&gt;</Code> {t('(in Docker: see the README).')}
        </Text>
      </Panel>

      <Panel title={t('Health')} subtitle={t('What load balancers and monitoring see: /api/health (alive), /api/health/ready (ready), /metrics (Prometheus, admins or NCODE_METRICS_TOKEN).')}>
        {!ready.data && <Skeleton h="60px" />}
        {ready.data && (
          <SimpleGrid columns={{ base: 2, md: 4 }} spacing={3} data-testid="health">
            <Tile label={t('Status')} value={ready.data.status === 'ok' ? t('ready') : t('not ready')} good={ready.data.status === 'ok'} />
            <Tile label={t('App database')} value={checks.app_db === 'ok' ? t('ok') : String(checks.app_db ?? '?')} good={checks.app_db === 'ok'} />
            <Tile label={t('Scheduler')} value={checks.scheduler === 'running' ? t('running') : checks.scheduler === 'off' ? t('off') : String(checks.scheduler ?? '?')} good={checks.scheduler === 'running'} />
            <Tile label={t('Disk free')} value={checks.disk_free_mb !== undefined ? size(Number(checks.disk_free_mb) * 1024 * 1024) : '?'} good={Number(checks.disk_free_mb) > 1024} />
            <Tile label={t('Up for')} value={t('{h} h {m} min', { h: Math.floor(ready.data.uptime_sec / 3600), m: Math.floor((ready.data.uptime_sec % 3600) / 60) })} good />
            <Tile label={t('Last backup')} value={checks.last_backup_at ? new Date(Number(checks.last_backup_at) * 1000).toLocaleString(locale()) : t('none')} good={!!checks.last_backup_at} />
          </SimpleGrid>
        )}
        <HStack mt={3}>
          <Button size="xs" variant="ghost" onClick={() => void ready.refetch()}>
            {t('Check again')}
          </Button>
        </HStack>
      </Panel>
    </VStack>
  );
}

function Tile({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <Box border="1px solid" borderColor="lineColor" borderRadius="xl" px={3} py={2}>
      <Text fontSize="xs" color="mutedText">
        {label}
      </Text>
      <Text fontSize="sm" fontWeight={700} color={good ? undefined : 'orange.400'} noOfLines={1}>
        {value}
      </Text>
    </Box>
  );
}
