import { useState } from 'react';
import {
  Badge, Box, Button, Checkbox, Flex, FormControl, FormHelperText, FormLabel, HStack, IconButton, Input, NumberInput, NumberInputField,
  Select, SimpleGrid, Skeleton, Text, Tooltip, VStack, useToast,
} from '@chakra-ui/react';
import { apiErrorMessage } from '../api';
import { PencilIcon, PlusIcon, SendIcon, TrashIcon } from '../icons';
import { admin, useAdminSettings, useDestinations } from './api';
import type { Destination, EmailSettings } from './api';
import { Panel } from './Panel';
import { t } from '../i18n/index.ts';

const KIND_HELP: Record<string, { label: string; secret: string; help: string }> = {
  slack: {
    label: 'Slack',
    secret: t('Webhook URL (https://hooks.slack.com/services/…)'),
    help: t('In Slack: Apps → Incoming Webhooks → Add to a channel, then copy the Webhook URL.'),
  },
  teams: {
    label: 'Microsoft Teams',
    secret: t('Workflow URL (https://…logic.azure.com/… or …/powerautomate/…)'),
    help: t('In the Teams channel: ⋯ → Workflows → "Post to a channel when a webhook request is received", then copy its URL.'),
  },
  telegram: {
    label: 'Telegram',
    secret: t('Bot token (123456789:AA…)'),
    help: t('Create a bot with @BotFather, add it to the group or channel, and enter the chat id (groups start with -100…, or @channelname).'),
  },
  webhook: {
    label: t('Webhook (JSON)'),
    secret: t('URL (https://…)'),
    help: t('Ncode posts JSON: the title, a link and every card with its columns and first rows. Use it for n8n, Zapier, your own service…'),
  },
};

/** Admin → Delivery: the site address, the email server and the chat / webhook destinations. */
export function DeliverySettings() {
  const settings = useAdminSettings();
  if (settings.isPending) return <Skeleton h="300px" borderRadius="2xl" />;
  if (!settings.data) return <Text color="red.400">{apiErrorMessage(settings.error, t('Could not load the settings'))}</Text>;
  return (
    <VStack align="stretch" spacing={6}>
      <SiteAddress key={settings.data.general.site_url} current={settings.data.general.site_url} />
      <EmailServer current={settings.data.email} />
      <Destinations />
    </VStack>
  );
}

function SiteAddress({ current }: { current: string }) {
  const toast = useToast();
  const [url, setUrl] = useState(current);
  const save = async () => {
    try {
      await admin.saveGeneral(url.trim());
      toast({ status: 'success', title: t('Saved'), duration: 1200 });
    } catch (e) {
      toast({ status: 'error', title: t('Could not save'), description: apiErrorMessage(e, t('Please try again')) });
    }
  };
  return (
    <Panel title={t('Site address')} subtitle={t('How people reach Ncode, e.g. https://ncode.company.local. Links in emails and public links start with it.')}>
      <HStack maxW="640px">
        <Input size="sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={window.location.origin} data-testid="site-url" />
        <Button size="sm" variant="brand" onClick={() => void save()} isDisabled={url.trim() === current}>
          {t('Save')}
        </Button>
        {!current && (
          <Button size="sm" variant="ghost" onClick={() => setUrl(window.location.origin)}>
            {t('Use this one')}
          </Button>
        )}
      </HStack>
    </Panel>
  );
}

function EmailServer({ current }: { current: EmailSettings & { password_set: boolean } }) {
  const toast = useToast();
  const [form, setForm] = useState<EmailSettings>(current);
  const [domains, setDomains] = useState(current.allowed_domains.join(', '));
  const [password, setPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<EmailSettings>) => setForm((f) => ({ ...f, ...patch }));
  const save = async () => {
    setBusy(true);
    try {
      const { password_set: _ignored, ...rest } = form;
      void _ignored;
      await admin.saveEmail({
        ...rest,
        allowed_domains: domains.split(/[\s,;]+/).map((d) => d.trim()).filter(Boolean),
        password: removePassword ? '' : password ? password : null,
      });
      setPassword('');
      setRemovePassword(false);
      toast({ status: 'success', title: t('Email settings saved'), duration: 1500 });
    } catch (e) {
      toast({ status: 'error', title: t('Could not save'), description: apiErrorMessage(e, t('Please try again')), duration: 6000, isClosable: true });
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    try {
      const out = await admin.testEmail(testTo.trim());
      toast(out.ok
        ? { status: 'success', title: t('Test email sent to {to}', { to: testTo }), duration: 3000 }
        : { status: 'error', title: t('The test email was not sent'), description: out.error, duration: 9000, isClosable: true });
    } catch (e) {
      toast({ status: 'error', title: t('The test email was not sent'), description: apiErrorMessage(e, t('Please try again')) });
    }
  };
  return (
    <Panel
      title={t('Email server (SMTP)')}
      subtitle={t('Subscriptions and alerts are sent through it. The password is stored encrypted and never shown again.')}
      actions={current.host && current.from_address ? <Badge colorScheme="green">{t('set up')}</Badge> : <Badge>{t('not set up')}</Badge>}
    >
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={3} maxW="900px">
        <FormControl gridColumn={{ md: 'span 2' }}>
          <FormLabel fontSize="xs">{t('Server')}</FormLabel>
          <Input size="sm" value={form.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.office365.com" data-testid="smtp-host" />
        </FormControl>
        <HStack align="flex-end">
          <FormControl>
            <FormLabel fontSize="xs">{t('Port')}</FormLabel>
            <NumberInput size="sm" value={form.port} min={1} max={65535} onChange={(_t, n) => set({ port: Number.isNaN(n) ? 587 : n })}>
              <NumberInputField />
            </NumberInput>
          </FormControl>
          <FormControl>
            <FormLabel fontSize="xs">{t('Security')}</FormLabel>
            <Select
              size="sm"
              value={form.security}
              onChange={(e) => {
                const security = e.target.value as EmailSettings['security'];
                set({ security, port: security === 'ssl' ? 465 : security === 'starttls' ? 587 : 25 });
              }}
            >
              <option value="starttls">STARTTLS</option>
              <option value="ssl">SSL/TLS</option>
              <option value="none">{t('None')}</option>
            </Select>
          </FormControl>
        </HStack>
        <FormControl>
          <FormLabel fontSize="xs">{t('User name')}</FormLabel>
          <Input size="sm" value={form.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" />
        </FormControl>
        <FormControl>
          <FormLabel fontSize="xs">{t('Password')}</FormLabel>
          <Input
            size="sm"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={current.password_set ? t('•••••••• (unchanged)') : ''}
            autoComplete="new-password"
            isDisabled={removePassword}
          />
          {current.password_set && (
            <Checkbox size="sm" mt={1} isChecked={removePassword} onChange={(e) => setRemovePassword(e.target.checked)}>
              {t('Remove the password')}
            </Checkbox>
          )}
        </FormControl>
        <Box />
        <FormControl>
          <FormLabel fontSize="xs">{t('From address')}</FormLabel>
          <Input size="sm" value={form.from_address} onChange={(e) => set({ from_address: e.target.value })} placeholder="reports@company.com" data-testid="smtp-from" />
        </FormControl>
        <FormControl>
          <FormLabel fontSize="xs">{t('From name')}</FormLabel>
          <Input size="sm" value={form.from_name} onChange={(e) => set({ from_name: e.target.value })} />
        </FormControl>
        <FormControl>
          <FormLabel fontSize="xs">{t('Reply-to (optional)')}</FormLabel>
          <Input size="sm" value={form.reply_to} onChange={(e) => set({ reply_to: e.target.value })} />
        </FormControl>
        <FormControl gridColumn={{ md: 'span 3' }}>
          <FormLabel fontSize="xs">{t('Allowed domains for typed-in addresses (optional)')}</FormLabel>
          <Input size="sm" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="company.com, partner.com" />
          <FormHelperText fontSize="xs">{t('Empty: any address. Otherwise people (not admins) may only send to these domains, so reports do not leave the company by mistake.')}</FormHelperText>
        </FormControl>
      </SimpleGrid>
      <Flex mt={4} gap={3} wrap="wrap" align="center">
        <Button size="sm" variant="brand" onClick={() => void save()} isLoading={busy} data-testid="save-email">
          {t('Save')}
        </Button>
        <Box flex={1} />
        <Input size="sm" maxW="240px" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={t('send a test to…')} />
        <Button size="sm" variant="subtle" leftIcon={<SendIcon boxSize={3.5} />} onClick={() => void test()} isDisabled={!testTo.includes('@') || !current.host}>
          {t('Send test')}
        </Button>
      </Flex>
    </Panel>
  );
}

function Destinations() {
  const toast = useToast();
  const list = useDestinations();
  const [editing, setEditing] = useState<Destination | 'new' | null>(null);
  const test = async (d: Destination) => {
    try {
      const out = await admin.testDestination(d.id);
      toast(out.ok ? { status: 'success', title: t('Test message sent to {name}', { name: d.name }), duration: 2500 } : { status: 'error', title: t('Not sent'), description: out.error, duration: 9000, isClosable: true });
    } catch (e) {
      toast({ status: 'error', title: t('Not sent'), description: apiErrorMessage(e, t('Please try again')) });
    }
  };
  const remove = async (d: Destination) => {
    try {
      await admin.deleteDestination(d.id);
    } catch (e) {
      toast({ status: 'error', title: t('Could not delete'), description: apiErrorMessage(e, t('Please try again')) });
    }
  };
  return (
    <Panel
      title={t('Chats and webhooks')}
      subtitle={t('Places subscriptions and alerts can post to. Everyone can choose them; only admins see their addresses (and only the last characters).')}
      actions={
        <Button size="sm" leftIcon={<PlusIcon boxSize={4} />} onClick={() => setEditing('new')} data-testid="add-destination">
          {t('Add')}
        </Button>
      }
    >
      <VStack align="stretch" spacing={2}>
        {list.data?.length === 0 && !editing && (
          <Text fontSize="sm" color="mutedText">
            {t('None yet: add a Slack channel, a Teams channel, a Telegram chat or any webhook.')}
          </Text>
        )}
        {list.data?.map((d) =>
          editing !== 'new' && editing?.id === d.id ? (
            <DestinationForm key={d.id} current={d} onDone={() => setEditing(null)} />
          ) : (
            <Flex key={d.id} align="center" gap={3} px={3} py={2} borderRadius="xl" bg="chipBg" data-testid="destination-row">
              <Badge>{KIND_HELP[d.kind].label}</Badge>
              <Box flex={1} minW={0}>
                <Text fontSize="sm" fontWeight={600} noOfLines={1}>
                  {d.name}
                </Text>
                <Text fontSize="xs" color="mutedText" fontFamily="mono" noOfLines={1}>
                  {d.secret_hint}
                  {d.config.chat_id ? ` · ${t('chat {id}', { id: d.config.chat_id })}` : ''}
                </Text>
              </Box>
              <Tooltip label={t('Send a test message')} hasArrow>
                <IconButton aria-label={t('Test')} size="sm" icon={<SendIcon boxSize={3.5} />} onClick={() => void test(d)} />
              </Tooltip>
              <IconButton aria-label={t('Edit')} size="sm" icon={<PencilIcon boxSize={3.5} />} onClick={() => setEditing(d)} />
              <IconButton aria-label={t('Delete')} size="sm" variant="ghost" colorScheme="red" icon={<TrashIcon boxSize={3.5} />} onClick={() => void remove(d)} />
            </Flex>
          ),
        )}
        {editing === 'new' && <DestinationForm current={null} onDone={() => setEditing(null)} />}
      </VStack>
    </Panel>
  );
}

function DestinationForm({ current, onDone }: { current: Destination | null; onDone: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<Destination['kind']>(current?.kind ?? 'slack');
  const [name, setName] = useState(current?.name ?? '');
  const [secret, setSecret] = useState('');
  const [chatId, setChatId] = useState(current?.config.chat_id ?? '');
  const [busy, setBusy] = useState(false);
  const help = KIND_HELP[kind];
  const save = async () => {
    setBusy(true);
    try {
      await admin.saveDestination(current?.id ?? null, { name: name.trim(), kind, secret: secret.trim(), chat_id: chatId.trim() });
      onDone();
    } catch (e) {
      toast({ status: 'error', title: t('Could not save'), description: apiErrorMessage(e, t('Please try again')), duration: 6000, isClosable: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box border="1px solid" borderColor="brand.400" borderRadius="xl" p={3}>
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
        <FormControl>
          <FormLabel fontSize="xs">{t('Kind')}</FormLabel>
          <Select size="sm" value={kind} onChange={(e) => setKind(e.target.value as Destination['kind'])} data-testid="destination-kind">
            {Object.entries(KIND_HELP).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </FormControl>
        <FormControl>
          <FormLabel fontSize="xs">{t('Name people see')}</FormLabel>
          <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="#sales" maxLength={120} data-testid="destination-name" />
        </FormControl>
        <FormControl gridColumn={{ md: kind === 'telegram' ? undefined : 'span 2' }}>
          <FormLabel fontSize="xs">{help.secret}</FormLabel>
          <Input size="sm" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={current ? t('(unchanged)') : ''} autoComplete="off" data-testid="destination-secret" />
        </FormControl>
        {kind === 'telegram' && (
          <FormControl>
            <FormLabel fontSize="xs">{t('Chat id')}</FormLabel>
            <Input size="sm" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890" />
          </FormControl>
        )}
      </SimpleGrid>
      <Text fontSize="xs" color="mutedText" mt={2}>
        {help.help}
      </Text>
      <HStack mt={3}>
        <Button size="sm" variant="brand" onClick={() => void save()} isLoading={busy} isDisabled={!name.trim() || (!current && !secret.trim())} data-testid="save-destination">
          {t('Save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t('Cancel')}
        </Button>
      </HStack>
    </Box>
  );
}
