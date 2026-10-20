import { useState } from 'react';
import {
  Alert, AlertIcon as ChakraAlertIcon, Badge, Box, Button, Checkbox, Code, Flex, FormControl, FormLabel, HStack, IconButton, Input, Link,
  Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Select, Skeleton, Switch, Tab, TabList, TabPanel, TabPanels,
  Tabs, Text, Tooltip, VStack, useToast,
} from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { locale, t, tn } from '../i18n/index.ts';
import type { TargetType } from '../automation/types';
import { CopyIcon, GlobeIcon, LockIcon, TrashIcon } from '../icons';
import { absolute, embedSnippet, sharing, useItemSharing } from './api';
import type { ParamMode, ShareLink } from './api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  target: { type: TargetType; id: number; name: string; params: { name: string; label: string }[] };
}

const EXPIRY = [
  { label: t('Never expires'), days: 0 },
  { label: t('1 day'), days: 1 },
  { label: t('7 days'), days: 7 },
  { label: t('30 days'), days: 30 },
  { label: t('90 days'), days: 90 },
];

async function copy(text: string, toast: ReturnType<typeof useToast>) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ status: 'success', title: t('Copied'), duration: 1200 });
  } catch {
    toast({ status: 'warning', title: t('Copy it by hand'), description: text, duration: 8000, isClosable: true });
  }
}

/** Admins: a public link anyone can open, and signed embedding into another website. */
export function ShareDialog({ isOpen, onClose, target }: Props) {
  const info = useItemSharing(target.type, target.id, isOpen);
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent data-testid="share-dialog">
        <ModalHeader fontSize="md">
          {t('Share “{name}” outside Ncode', { name: target.name })}
          <Text fontSize="xs" color="mutedText" fontWeight={400}>
            {t('Visitors see the results only: no SQL, no tables, no editing. It runs with your permissions.')}
          </Text>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={5}>
          {info.isPending && <Skeleton h="160px" borderRadius="lg" />}
          {info.isError && (
            <Alert status="error" borderRadius="md" fontSize="sm">
              <ChakraAlertIcon />
              {apiErrorMessage(info.error, t('Could not load the sharing settings'))}
            </Alert>
          )}
          {info.data && (
            <Tabs size="sm" variant="soft-rounded" colorScheme="purple">
              <TabList mb={3}>
                <Tab>{t('Public link')}</Tab>
                <Tab>{t('Embed')}</Tab>
              </TabList>
              <TabPanels>
                <TabPanel p={0}>
                  <PublicLinks target={target} links={info.data.public_links} enabled={info.data.settings.public_links} siteUrl={info.data.settings.site_url} />
                </TabPanel>
                <TabPanel p={0}>
                  <Embed key={info.data.embed ? `${info.data.embed.id}:${JSON.stringify(info.data.embed.params)}` : 'off'} target={target} embed={info.data.embed} settings={info.data.settings} />
                </TabPanel>
              </TabPanels>
            </Tabs>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

function Off({ message }: { message: string }) {
  return (
    <Alert status="info" borderRadius="md" fontSize="sm">
      <ChakraAlertIcon />
      <Box>
        {message}{' '}
        <Link as={RouterLink} to="/admin?tab=sharing" textDecoration="underline">
          {t('Admin → Sharing')}
        </Link>
      </Box>
    </Alert>
  );
}

function PublicLinks({ target, links, enabled, siteUrl }: { target: Props['target']; links: ShareLink[]; enabled: boolean; siteUrl: string }) {
  const toast = useToast();
  const [days, setDays] = useState(0);
  const [password, setPassword] = useState('');
  const [download, setDownload] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!enabled) return <Off message={t('Public links are switched off.')} />;
  const create = async () => {
    setBusy(true);
    try {
      const link = await sharing.createPublic({
        target_type: target.type, target_id: target.id, expires_at: days ? Date.now() / 1000 + days * 86400 : null,
        password: password || null, allow_download: download,
      });
      setPassword('');
      if (link.path) await copy(absolute(link.path, siteUrl), toast);
    } catch (e) {
      toast({ status: 'error', title: t('Could not create the link'), description: apiErrorMessage(e, t('Please try again')) });
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: number) => {
    try {
      await sharing.revoke(id);
      toast({ status: 'info', title: t('The link stopped working'), duration: 2000 });
    } catch (e) {
      toast({ status: 'error', title: t('Could not revoke'), description: apiErrorMessage(e, t('Please try again')) });
    }
  };
  return (
    <VStack align="stretch" spacing={4}>
      {links.map((l) => {
        const url = l.path ? absolute(l.path, siteUrl) : null;
        return (
          <Box key={l.id} border="1px solid" borderColor="lineColor" borderRadius="lg" p={3} data-testid="public-link">
            <HStack>
              <GlobeIcon boxSize={4} color={l.active ? 'green.400' : 'faintText'} />
              <Input size="sm" value={url ?? t('(cannot be shown: was the secret key changed?)')} isReadOnly fontFamily="mono" fontSize="xs" onFocus={(e) => e.target.select()} data-testid="public-url" />
              <Tooltip label={t('Copy')} hasArrow>
                <IconButton aria-label={t('Copy the link')} size="sm" icon={<CopyIcon boxSize={4} />} onClick={() => url && void copy(url, toast)} isDisabled={!url} />
              </Tooltip>
              <Tooltip label={t('Stop this link')} hasArrow>
                <IconButton aria-label={t('Revoke')} size="sm" variant="ghost" colorScheme="red" icon={<TrashIcon boxSize={4} />} onClick={() => void revoke(l.id)} data-testid="revoke-link" />
              </Tooltip>
            </HStack>
            <HStack spacing={2} mt={2} fontSize="xs" color="mutedText" wrap="wrap">
              {!l.active && <Badge colorScheme="red">{t('expired')}</Badge>}
              {l.has_password && (
                <Badge colorScheme="purple">
                  <LockIcon boxSize={2.5} mr={1} />
                  {t('password')}
                </Badge>
              )}
              {l.allow_download && <Badge>{t('downloads')}</Badge>}
              <Text>{l.expires_at ? t('expires {date}', { date: new Date(l.expires_at * 1000).toLocaleString(locale()) }) : t('never expires')}</Text>
              <Text>· {tn(l.views, '{n} view', '{n} views')}</Text>
              <Text>· {t('by {owner}', { owner: l.created_by })}</Text>
            </HStack>
          </Box>
        );
      })}
      <Box border="1px dashed" borderColor="lineColor" borderRadius="lg" p={3}>
        <Text fontSize="sm" fontWeight={600} mb={2}>
          {links.length ? t('Another link') : t('Create a public link')}
        </Text>
        <HStack spacing={3} wrap="wrap" align="flex-end">
          <FormControl w="auto">
            <FormLabel fontSize="xs">{t('Expiry')}</FormLabel>
            <Select size="sm" w="150px" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {EXPIRY.map((x) => (
                <option key={x.days} value={x.days}>
                  {x.label}
                </option>
              ))}
            </Select>
          </FormControl>
          <FormControl w="auto">
            <FormLabel fontSize="xs">{t('Password (optional)')}</FormLabel>
            <Input size="sm" w="180px" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </FormControl>
          <Checkbox size="sm" isChecked={download} onChange={(e) => setDownload(e.target.checked)} pb={1.5}>
            {t('Allow downloads')}
          </Checkbox>
          <Button size="sm" variant="brand" onClick={() => void create()} isLoading={busy} data-testid="create-public-link">
            {t('Create and copy')}
          </Button>
        </HStack>
        <Text fontSize="xs" color="mutedText" mt={2}>
          {t('Anyone with the link sees the current results, and can change the filters. Stop a link at any time; turning public links off in Admin → Sharing stops all of them.')}
        </Text>
      </Box>
    </VStack>
  );
}

function Embed({ target, embed, settings }: { target: Props['target']; embed: ShareLink | null; settings: { embedding: boolean; embedding_key_set: boolean; site_url: string } }) {
  const toast = useToast();
  const [on, setOn] = useState(!!embed);
  const [modes, setModes] = useState<Record<string, ParamMode>>(embed?.params ?? {});
  const [lang, setLang] = useState<'python' | 'node'>('python');
  const [busy, setBusy] = useState(false);
  if (!settings.embedding) return <Off message={t('Embedding is switched off.')} />;
  if (!settings.embedding_key_set)
    return (
      <Alert status="info" borderRadius="md" fontSize="sm">
        <ChakraAlertIcon />
        <Box>
          {t('Create the embedding key first:')}{' '}
          <Link as={RouterLink} to="/admin?tab=sharing" textDecoration="underline">
            {t('Admin → Sharing')}
          </Link>
        </Box>
      </Alert>
    );
  const save = async () => {
    setBusy(true);
    try {
      await sharing.setEmbed({ target_type: target.type, target_id: target.id, enabled: on, params: modes });
      toast({ status: 'success', title: on ? t('Embedding allowed') : t('Embedding switched off'), duration: 1500 });
    } catch (e) {
      toast({ status: 'error', title: t('Could not save'), description: apiErrorMessage(e, t('Please try again')) });
    } finally {
      setBusy(false);
    }
  };
  const preview = async () => {
    try {
      const locked = Object.fromEntries(Object.entries(modes).filter(([, m]) => m === 'locked').map(([k]) => [k, '']));
      const { path } = await sharing.previewToken({ target_type: target.type, target_id: target.id, params: locked });
      window.open(`${path}#titled=true&bordered=true`, '_blank', 'noopener');
    } catch (e) {
      toast({ status: 'error', title: t('No preview'), description: apiErrorMessage(e, t('Please try again')) });
    }
  };
  const locked = Object.entries(modes).filter(([, m]) => m === 'locked').map(([k]) => k);
  return (
    <VStack align="stretch" spacing={4}>
      <HStack>
        <Switch isChecked={on} onChange={(e) => setOn(e.target.checked)} data-testid="embed-switch" />
        <Text fontSize="sm">
          {target.type === 'dashboard'
            ? t('Allow embedding this dashboard in other websites (with a signed token)')
            : t('Allow embedding this question in other websites (with a signed token)')}
        </Text>
      </HStack>
      {on && target.params.length > 0 && (
        <Box>
          <Text fontSize="xs" color="mutedText" mb={2}>
            {t('What each filter does in the embed:')} <b>{t('Locked')}</b> {t('= your website sets it in the token (e.g. the customer who is signed in),')} <b>{t('Editable')}</b>{' '}
            {t('= the visitor may change it,')} <b>{t('Off')}</b> {t('= not used.')}
          </Text>
          <VStack align="stretch" spacing={1}>
            {target.params.map((p) => (
              <Flex key={p.name} align="center" gap={3}>
                <Text fontSize="sm" flex={1}>
                  {p.label} <Code fontSize="2xs">{p.name}</Code>
                </Text>
                <Select size="sm" w="140px" value={modes[p.name] ?? 'disabled'} onChange={(e) => setModes({ ...modes, [p.name]: e.target.value as ParamMode })} data-testid={`embed-param-${p.name}`}>
                  <option value="disabled">{t('Off')}</option>
                  <option value="editable">{t('Editable')}</option>
                  <option value="locked">{t('Locked')}</option>
                </Select>
              </Flex>
            ))}
          </VStack>
        </Box>
      )}
      <HStack>
        <Button size="sm" variant="brand" onClick={() => void save()} isLoading={busy} data-testid="save-embed">
          {t('Save')}
        </Button>
        {embed && (
          <Button size="sm" variant="subtle" onClick={() => void preview()}>
            {t('Preview (10 minutes)')}
          </Button>
        )}
      </HStack>
      {embed && (
        <Box>
          <HStack mb={1}>
            <Text fontSize="xs" fontWeight={600}>
              {t("On your website's server:")}
            </Text>
            <Select size="xs" w="110px" value={lang} onChange={(e) => setLang(e.target.value as 'python')}>
              <option value="python">Python</option>
              <option value="node">Node.js</option>
            </Select>
            <IconButton aria-label={t('Copy the code')} size="xs" icon={<CopyIcon boxSize={3} />} onClick={() => void copy(embedSnippet(lang, target.type, target.id, locked, settings.site_url), toast)} />
          </HStack>
          <Box as="pre" fontSize="xs" p={3} bg="chipBg" borderRadius="md" overflowX="auto" whiteSpace="pre" data-testid="embed-snippet">
            {embedSnippet(lang, target.type, target.id, locked, settings.site_url)}
          </Box>
          <Text fontSize="xs" color="mutedText" mt={2}>
            {t('Never put the embedding key in a web page: sign the token on your server. Tokens must expire (at most 30 days).')}
          </Text>
        </Box>
      )}
    </VStack>
  );
}
