import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  AlertDialog, AlertDialogBody, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogOverlay,
  Alert, AlertDescription, AlertIcon, Badge, Box, Button, Code, Collapse, Flex, FormControl, FormHelperText,
  FormLabel, HStack, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader,
  ModalOverlay, SimpleGrid, Spinner, Text, VStack, useDisclosure, useToast,
} from '@chakra-ui/react';
import { apiErrorMessage, http } from '../api';
import type { ConnectionDetails, ConnectionPayload, DraftTestResult, EngineOption } from '../api';
import { engineMeta } from '../lib/engines';
import { parseConnectionString } from '../lib/dburl';
import { CheckIcon, ChevronDownIcon, TrashIcon } from '../icons';
import { EngineBadge } from './EngineBadge';
import { t, tn } from '../i18n/index.ts';

interface FormState {
  engine: string;
  label: string;
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
  schema: string;
  idHints: string;
}

const EMPTY_FORM: FormState = {
  engine: '',
  label: '',
  host: '',
  port: '',
  username: '',
  password: '',
  database: '',
  schema: '',
  idHints: '',
};

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  engines: EngineOption[];
  editKey: string | null; // null = add a new database
  onSaved: (details: ConnectionDetails) => void;
  onDeleted: (key: string) => void;
}

export function ConnectionModal(props: ConnectionModalProps) {
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      size="2xl"
      scrollBehavior="inside"
      isCentered
      closeOnOverlayClick={false}
    >
      <ModalOverlay backdropFilter="blur(4px)" />
      <ModalContent>
        <ConnectionBody {...props} />
      </ModalContent>
    </Modal>
  );
}

function ConnectionBody({ onClose, engines, editKey, onSaved, onDeleted }: ConnectionModalProps) {
  const toast = useToast();
  const [step, setStep] = useState<'engine' | 'form'>(editKey ? 'form' : 'engine');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(Boolean(editKey));
  const [loadError, setLoadError] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testResult, setTestResult] = useState<DraftTestResult | null>(null);
  const [saveError, setSaveError] = useState('');
  const confirm = useDisclosure();
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // Editing: load the saved settings (the password itself is never sent to the browser).
  useEffect(() => {
    if (!editKey) return;
    let cancelled = false;
    http
      .get<ConnectionDetails>(`/api/connections/${editKey}/details`)
      .then((res) => {
        if (cancelled) return;
        const d = res.data;
        setForm({
          engine: d.engine,
          label: d.label,
          host: d.host ?? '',
          port: d.port ? String(d.port) : '',
          username: d.username ?? '',
          password: '',
          database: d.database,
          schema: d.schema_name ?? '',
          idHints: d.id_hints.join(', '),
        });
        setHasPassword(d.has_password);
        setShowAdvanced(Boolean(d.schema_name) || d.id_hints.length > 0);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(apiErrorMessage(err, t('Could not load this connection')));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editKey]);

  const engine = engines.find((e) => e.name === form.engine);
  const fileBased = engine?.file_based ?? false;
  const driverMissing = engine !== undefined && !engine.available;
  const portNumber = form.port.trim() === '' ? null : Number(form.port);
  const portInvalid = portNumber !== null && (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535);
  const canSubmit =
    form.label.trim() !== '' &&
    form.database.trim() !== '' &&
    (fileBased || form.host.trim() !== '') &&
    !portInvalid &&
    !driverMissing;

  const edit = (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    setTestResult(null);
    setSaveError('');
  };

  const chooseEngine = (name: string) => {
    const option = engines.find((e) => e.name === name);
    setForm((prev) => ({ ...prev, engine: name, port: option?.default_port ? String(option.default_port) : '' }));
    setTestResult(null);
    setStep('form');
  };

  const applyConnectionString = () => {
    const parsed = parseConnectionString(pasteText);
    if (!parsed) {
      setPasteError(t('Could not read this. Expected something like {example}', { example: 'mysql://user:password@host:3306/database' }));
      return;
    }
    const option = engines.find((e) => e.name === parsed.engine);
    const meta = engineMeta(parsed.engine);
    setForm((prev) => ({
      ...prev,
      engine: parsed.engine,
      label: prev.label || `${meta.label} · ${parsed.database || parsed.host}`,
      host: parsed.host,
      port: parsed.port ? String(parsed.port) : option?.default_port ? String(option.default_port) : '',
      username: parsed.username,
      password: parsed.password,
      database: parsed.database,
    }));
    setPasteText('');
    setPasteError('');
    setTestResult(null);
    setStep('form');
  };

  const buildPayload = (): ConnectionPayload => ({
    label: form.label.trim(),
    engine: form.engine,
    host: fileBased ? null : form.host.trim() || null,
    port: fileBased ? null : portNumber,
    username: fileBased ? null : form.username.trim() || null,
    password: form.password || null,
    database: form.database.trim(),
    schema_name: form.schema.trim() || null,
    id_hints: form.idHints
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
    key: editKey,
  });

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await http.post<DraftTestResult>('/api/connections/test-draft', buildPayload());
      setTestResult(res.data);
    } catch (err) {
      setTestResult({ ok: false, error: apiErrorMessage(err, t('The check failed')) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const payload = buildPayload();
      const res = editKey
        ? await http.put<ConnectionDetails>(`/api/connections/${editKey}`, payload)
        : await http.post<ConnectionDetails>('/api/connections', payload);
      toast({ title: editKey ? t('Connection updated') : t('Database connected'), status: 'success', duration: 3000 });
      onSaved(res.data);
      onClose();
    } catch (err) {
      setSaveError(apiErrorMessage(err, t('Could not save the connection')));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editKey) return;
    setDeleting(true);
    try {
      await http.delete(`/api/connections/${editKey}`);
      toast({ title: t('Connection removed'), status: 'info', duration: 3000 });
      confirm.onClose();
      onDeleted(editKey);
      onClose();
    } catch (err) {
      confirm.onClose();
      setSaveError(apiErrorMessage(err, t('Could not remove the connection')));
    } finally {
      setDeleting(false);
    }
  };

  // ------------------------------------------------------------------ render
  if (loading) {
    return (
      <ModalBody py={16}>
        <Flex justify="center">
          <Spinner color="brand.300" size="lg" />
        </Flex>
      </ModalBody>
    );
  }
  if (loadError) {
    return (
      <>
        <ModalCloseButton />
        <ModalBody py={10}>
          <Alert status="error" borderRadius="lg">
            <AlertIcon />
            {loadError}
          </Alert>
        </ModalBody>
      </>
    );
  }

  if (step === 'engine') {
    return (
      <>
        <ModalHeader pb={1}>
          {t('Add a database')}
          <Text fontSize="sm" fontWeight={400} color="mutedText">
            {t('What kind of database do you want to search?')}
          </Text>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={3}>
            {engines.map((option) => {
              const meta = engineMeta(option.name);
              return (
                <Flex
                  key={option.name}
                  as="button"
                  type="button"
                  align="center"
                  gap={3}
                  p={3}
                  textAlign="left"
                  borderRadius="xl"
                  border="1.5px solid"
                  borderColor="lineColor"
                  bg="transparent"
                  transition="all 0.15s"
                  _hover={{ borderColor: 'brand.400', bg: 'panelHover', transform: 'translateY(-1px)' }}
                  onClick={() => chooseEngine(option.name)}
                >
                  <EngineBadge engine={option.name} size={42} />
                  <Box minW={0}>
                    <HStack spacing={2}>
                      <Text fontWeight={600}>{meta.label}</Text>
                      {!option.available && (
                        <Badge colorScheme="orange" fontSize="2xs">
                          {t('driver missing')}
                        </Badge>
                      )}
                    </HStack>
                    <Text fontSize="xs" color="mutedText">
                      {meta.blurb}
                    </Text>
                  </Box>
                </Flex>
              );
            })}
          </SimpleGrid>

          <Box mt={6} p={4} borderRadius="xl" bg="chipBg" border="1px solid" borderColor="lineColor">
            <Text fontSize="sm" fontWeight={600} mb={1}>
              {t('Already have a connection string?')}
            </Text>
            <Text fontSize="xs" color="mutedText" mb={3}>
              {t('Paste it and the form will be filled in for you. It is only read in your browser until you save.')}
            </Text>
            <HStack>
              <Input
                size="sm"
                placeholder="mysql://user:password@host:3306/database"
                value={pasteText}
                onChange={(e) => {
                  setPasteText(e.target.value);
                  setPasteError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && pasteText.trim() && applyConnectionString()}
                fontFamily="mono"
                autoComplete="off"
              />
              <Button size="sm" onClick={applyConnectionString} isDisabled={!pasteText.trim()}>
                {t('Fill in')}
              </Button>
            </HStack>
            {pasteError && (
              <Text fontSize="xs" color="red.300" mt={2}>
                {pasteError}
              </Text>
            )}
          </Box>
        </ModalBody>
      </>
    );
  }

  const meta = engineMeta(form.engine);
  return (
    <>
      <ModalHeader>
        <HStack spacing={3}>
          <EngineBadge engine={form.engine} size={38} />
          <Box>
            <Text>{editKey ? t('Edit connection') : t('Connect {engine}', { engine: meta.label })}</Text>
            {!editKey && (
              <Button variant="link" size="xs" fontWeight={500} color="brand.300" onClick={() => setStep('engine')}>
                {t('Choose a different type')}
              </Button>
            )}
          </Box>
        </HStack>
      </ModalHeader>
      <ModalCloseButton />
      <ModalBody>
        <VStack spacing={4} align="stretch">
          {driverMissing && engine && (
            <Alert status="warning" borderRadius="lg" alignItems="flex-start">
              <AlertIcon />
              <AlertDescription fontSize="sm">
                {t('The Python driver for {engine} is not installed on the server. Run', { engine: engine.label })}{' '}
                <Code>pip install {engine.pip}</Code>{' '}
                {t('in the backend environment, restart the backend and reopen this window.')}
              </AlertDescription>
            </Alert>
          )}

          <FormControl isRequired>
            <FormLabel fontSize="sm">{t('Name')}</FormLabel>
            <Input value={form.label} onChange={edit('label')} placeholder={t('e.g. Production orders')} autoFocus />
            <FormHelperText fontSize="xs">{t('How this database appears in the sidebar.')}</FormHelperText>
          </FormControl>

          {fileBased ? (
            <FormControl isRequired>
              <FormLabel fontSize="sm">{t('Path to the database file')}</FormLabel>
              <Input
                value={form.database}
                onChange={edit('database')}
                placeholder={t('{a}  or  {b}', { a: 'C:\\data\\catalog.sqlite', b: '/var/data/catalog.db' })}
                fontFamily="mono"
              />
              <FormHelperText fontSize="xs">
                {t('The path is on the machine where the Ncode backend runs. The file is opened read-only.')}
              </FormHelperText>
            </FormControl>
          ) : (
            <>
              <Flex gap={3}>
                <FormControl isRequired flex={3}>
                  <FormLabel fontSize="sm">{t('Server address')}</FormLabel>
                  <Input value={form.host} onChange={edit('host')} placeholder={t('{a} or {b}', { a: 'db.company.local', b: '10.0.0.5' })} />
                </FormControl>
                <FormControl flex={1} isInvalid={portInvalid}>
                  <FormLabel fontSize="sm">{t('Port')}</FormLabel>
                  <Input value={form.port} onChange={edit('port')} inputMode="numeric" />
                </FormControl>
              </Flex>
              <FormControl isRequired>
                <FormLabel fontSize="sm">{t('Database name')}</FormLabel>
                <Input value={form.database} onChange={edit('database')} placeholder={t('e.g. {example}', { example: 'shop' })} />
              </FormControl>
              <Flex gap={3} direction={{ base: 'column', sm: 'row' }}>
                <FormControl>
                  <FormLabel fontSize="sm">{t('Username')}</FormLabel>
                  <Input value={form.username} onChange={edit('username')} autoComplete="off" />
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="sm">{t('Password')}</FormLabel>
                  <Input
                    type="password"
                    value={form.password}
                    onChange={edit('password')}
                    autoComplete="new-password"
                    placeholder={editKey && hasPassword ? t('Saved — leave empty to keep') : ''}
                  />
                </FormControl>
              </Flex>
              <Text fontSize="xs" color="faintText" mt={-2}>
                {t('Tip: use an account that can only read data (SELECT). The password is stored encrypted.')}
              </Text>
            </>
          )}

          <Box>
            <Button
              variant="link"
              size="sm"
              color="mutedText"
              rightIcon={
                <ChevronDownIcon
                  boxSize={4}
                  transform={showAdvanced ? 'rotate(180deg)' : undefined}
                  transition="transform 0.15s"
                />
              }
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {t('Advanced')}
            </Button>
            <Collapse in={showAdvanced} animateOpacity>
              <VStack spacing={4} align="stretch" pt={3}>
                {!fileBased && (
                  <FormControl>
                    <FormLabel fontSize="sm">{t('Schema')}</FormLabel>
                    <Input value={form.schema} onChange={edit('schema')} placeholder={t('public, dbo … (leave empty for default)')} />
                  </FormControl>
                )}
                <FormControl>
                  <FormLabel fontSize="sm">{t('Record identifier columns')}</FormLabel>
                  <Input value={form.idHints} onChange={edit('idHints')} placeholder="vin, serial, order_no" />
                  <FormHelperText fontSize="xs">
                    {t('Columns whose name contains one of these words are shown as a badge on each result, so records are easy to recognise.')}
                  </FormHelperText>
                </FormControl>
              </VStack>
            </Collapse>
          </Box>

          {testResult && (
            <Alert status={testResult.ok ? 'success' : 'error'} borderRadius="lg" alignItems="flex-start">
              <AlertIcon />
              <AlertDescription fontSize="sm" wordBreak="break-word">
                {testResult.ok
                  ? tn(testResult.tables ?? 0, 'Connected. {n} table found.', 'Connected. {n} tables found.')
                  : testResult.error}
              </AlertDescription>
            </Alert>
          )}
          {saveError && (
            <Alert status="error" borderRadius="lg" alignItems="flex-start">
              <AlertIcon />
              <AlertDescription fontSize="sm" wordBreak="break-word">
                {saveError}
              </AlertDescription>
            </Alert>
          )}
        </VStack>
      </ModalBody>

      <ModalFooter gap={3} justifyContent="space-between" flexWrap="wrap">
        <Box>
          {editKey && (
            <Button variant="subtle" colorScheme="red" leftIcon={<TrashIcon boxSize={4} />} onClick={confirm.onOpen}>
              {t('Remove')}
            </Button>
          )}
        </Box>
        <HStack spacing={3}>
          <Button variant="subtle" onClick={runTest} isLoading={testing} loadingText={t('Checking')} isDisabled={!canSubmit}>
            {t('Check connection')}
          </Button>
          <Button
            leftIcon={testResult?.ok ? <CheckIcon boxSize={4} /> : undefined}
            onClick={save}
            isLoading={saving}
            isDisabled={!canSubmit}
          >
            {editKey ? t('Save changes') : t('Save')}
          </Button>
        </HStack>
      </ModalFooter>

      <AlertDialog isOpen={confirm.isOpen} leastDestructiveRef={cancelRef as never /* Chakra types expect a non-null ref */} onClose={confirm.onClose} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent bg="panelBg" borderRadius="2xl">
            <AlertDialogHeader>{t('Remove “{name}”?', { name: form.label })}</AlertDialogHeader>
            <AlertDialogBody fontSize="sm" color="mutedText">
              {t('Ncode will forget this connection and its saved password. Your database itself is not touched.')}
            </AlertDialogBody>
            <AlertDialogFooter gap={3}>
              <Button ref={cancelRef} variant="subtle" onClick={confirm.onClose}>
                {t('Keep it')}
              </Button>
              <Button colorScheme="red" bg="red.500" _hover={{ bg: 'red.600' }} onClick={remove} isLoading={deleting}>
                {t('Remove')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </>
  );
}
