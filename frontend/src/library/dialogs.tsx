import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  Alert, AlertIcon, Box, Button, Flex, FormControl, FormHelperText, FormLabel, HStack, IconButton, Input, Modal, ModalBody,
  ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Spinner, Text, Textarea, VStack,
} from '@chakra-ui/react';
import { apiErrorMessage } from '../api';
import { PlusIcon, XIcon } from '../icons';
import { flattenTree, library, libraryKeys, useCollections, usePeople } from './api';
import type { CollectionInfo, Grant } from './api';
import { t } from '../i18n/index.ts';

// ---------------------------------------------------------------- collection picker

interface PickerProps {
  value: number | null;
  onChange: (id: number | null) => void;
  /** offer "top level" (moving collections) */
  allowRoot?: boolean;
  /** hide this collection and everything in it (a collection cannot move into itself) */
  exclude?: number | null;
}

export function CollectionPicker({ value, onChange, allowRoot = false, exclude = null }: PickerProps) {
  const { data, isPending } = useCollections();
  const nodes = useMemo(() => {
    const all = flattenTree(data?.collections ?? []);
    const out = [];
    let skipDepth: number | null = null;
    for (const n of all) {
      if (skipDepth !== null && n.depth > skipDepth) continue;
      skipDepth = null;
      if (n.id === exclude) {
        skipDepth = n.depth;
        continue;
      }
      if (n.access === 'edit') out.push(n);
    }
    return out;
  }, [data, exclude]);
  if (isPending) return <Spinner size="sm" />;
  return (
    <Select
      size="sm"
      value={value === null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      aria-label={t('Collection')}
      data-testid="collection-picker"
    >
      {allowRoot ? <option value="">{t('Top level')}</option> : value === null && <option value="">{t('Choose…')}</option>}
      {nodes.map((n) => (
        <option key={n.id} value={n.id}>
          {'  '.repeat(n.depth)}
          {n.mine ? t('My collection') : n.name}
        </option>
      ))}
    </Select>
  );
}

// ---------------------------------------------------------------- a small modal with an error line

interface ShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  submitLabel: string;
  onSubmit: () => Promise<unknown>;
  canSubmit?: boolean;
  danger?: boolean;
  size?: string;
}

export function DialogShell({ isOpen, onClose, title, children, submitLabel, onSubmit, canSubmit = true, danger, size = 'md' }: ShellProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, t('That did not work')));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen={isOpen} onClose={onClose} size={size} isCentered>
      <ModalOverlay />
      <ModalContent
        as="form"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation(); // a dialog opened from another dialog: React events bubble through portals
          if (canSubmit && !busy) void submit();
        }}
      >
        <ModalHeader fontSize="md">{title}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack align="stretch" spacing={4}>
            {children}
            {error && (
              <Alert status="error" borderRadius="md" fontSize="sm">
                <AlertIcon />
                {error}
              </Alert>
            )}
          </VStack>
        </ModalBody>
        <ModalFooter gap={2}>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" type="submit" colorScheme={danger ? 'red' : undefined} variant={danger ? 'solid' : 'brand'} isLoading={busy} isDisabled={!canSubmit} data-testid="dialog-submit">
            {submitLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ---------------------------------------------------------------- save a question

export interface SaveTarget {
  name: string;
  description: string | null;
  collection_id: number;
}

interface SaveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  defaultName: string;
  defaultCollection?: number | null;
  onSave: (target: SaveTarget) => Promise<unknown>;
}

/** The dialogs below mount only while open, so each opening starts from the defaults. */
export function SaveQuestionDialog(props: SaveDialogProps) {
  return props.isOpen ? <SaveQuestionForm {...props} /> : null;
}

function SaveQuestionForm({ isOpen, onClose, title = t('Save question'), defaultName, defaultCollection, onSave }: SaveDialogProps) {
  const { data } = useCollections();
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<number | null>(defaultCollection ?? null);
  const collection = picked ?? data?.personal_id ?? null; // the user's own collection until the list says otherwise
  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      submitLabel={t('Save')}
      canSubmit={name.trim() !== '' && collection !== null}
      onSubmit={() => onSave({ name: name.trim(), description: description.trim() || null, collection_id: collection as number })}
    >
      <FormControl isRequired>
        <FormLabel fontSize="sm">{t('Name')}</FormLabel>
        <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={200} data-testid="save-name" />
      </FormControl>
      <FormControl>
        <FormLabel fontSize="sm">{t('Description')}</FormLabel>
        <Textarea size="sm" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
      </FormControl>
      <FormControl isRequired>
        <FormLabel fontSize="sm">{t('Collection')}</FormLabel>
        <CollectionPicker value={collection} onChange={setPicked} />
        <FormHelperText fontSize="xs">{t('Only collections you can edit are listed. Your own collection is private.')}</FormHelperText>
      </FormControl>
    </DialogShell>
  );
}

// ---------------------------------------------------------------- move

interface MoveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  current: number | null;
  allowRoot?: boolean;
  exclude?: number | null;
  onMove: (target: number | null) => Promise<unknown>;
}

export function MoveDialog(props: MoveDialogProps) {
  return props.isOpen ? <MoveForm {...props} /> : null;
}

function MoveForm({ isOpen, onClose, title, current, allowRoot = false, exclude = null, onMove }: MoveDialogProps) {
  const [target, setTarget] = useState<number | null>(current);
  return (
    <DialogShell isOpen={isOpen} onClose={onClose} title={title} submitLabel={t('Move')} canSubmit={target !== current && (allowRoot || target !== null)} onSubmit={() => onMove(target)}>
      <FormControl>
        <FormLabel fontSize="sm">{t('Move to')}</FormLabel>
        <CollectionPicker value={target} onChange={setTarget} allowRoot={allowRoot} exclude={exclude} />
      </FormControl>
    </DialogShell>
  );
}

// ---------------------------------------------------------------- create / rename a collection

interface CollectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  collection?: CollectionInfo | null; // set = rename
  parentId?: number | null;
  onDone?: (c: CollectionInfo) => void;
}

export function CollectionDialog(props: CollectionDialogProps) {
  return props.isOpen ? <CollectionForm {...props} /> : null;
}

function CollectionForm({ isOpen, onClose, collection, parentId, onDone }: CollectionDialogProps) {
  const [name, setName] = useState(collection?.name ?? '');
  const [description, setDescription] = useState(collection?.description ?? '');
  const [parent, setParent] = useState<number | null>(parentId ?? null);
  const save = async () => {
    const body = { name: name.trim(), description: description.trim() || null };
    const saved = collection ? await library.updateCollection(collection.id, body) : await library.createCollection({ ...body, parent_id: parent });
    onDone?.(saved);
  };
  return (
    <DialogShell isOpen={isOpen} onClose={onClose} title={collection ? t('Edit collection') : t('New collection')} submitLabel={collection ? t('Save') : t('Create')} canSubmit={name.trim() !== ''} onSubmit={save}>
      <FormControl isRequired>
        <FormLabel fontSize="sm">{t('Name')}</FormLabel>
        <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} data-testid="collection-name" />
      </FormControl>
      <FormControl>
        <FormLabel fontSize="sm">{t('Description')}</FormLabel>
        <Textarea size="sm" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </FormControl>
      {!collection && (
        <FormControl>
          <FormLabel fontSize="sm">{t('Inside')}</FormLabel>
          <CollectionPicker value={parent} onChange={setParent} allowRoot />
          <FormHelperText fontSize="xs">{t('A collection at the top level is yours; share it to let others see it.')}</FormHelperText>
        </FormControl>
      )}
    </DialogShell>
  );
}

// ---------------------------------------------------------------- sharing

const who = (g: Grant) => (g.user ? g.user : g.group ? t('Group “{group}”', { group: g.group }) : g.role === 'all' ? t('Everyone') : t('All with role "{role}"', { role: g.role }));

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  collection: CollectionInfo;
}

export function ShareDialog(props: ShareDialogProps) {
  return props.isOpen ? <ShareForm {...props} /> : null;
}

function ShareForm({ isOpen, onClose, collection }: ShareDialogProps) {
  const people = usePeople();
  const current = useQuery({ queryKey: libraryKeys.grants(collection.id), queryFn: () => library.grants(collection.id), gcTime: 0 });
  const [edited, setGrants] = useState<Grant[] | null>(null); // null = unchanged
  const grants = edited ?? current.data ?? null;
  const loadError = current.isError ? apiErrorMessage(current.error, t('Could not read who has access')) : null;
  const [pick, setPick] = useState('');
  const [level, setLevel] = useState<'view' | 'edit'>('view');

  const own = (grants ?? []).filter((g) => !g.inherited_from);
  const inherited = (grants ?? []).filter((g) => g.inherited_from);
  const setOwn = (next: Grant[]) => setGrants([...next, ...inherited]);
  const add = () => {
    if (!pick) return;
    const grant: Grant = pick.startsWith('role:')
      ? { user: null, role: pick.slice(5), level }
      : pick.startsWith('group:')
        ? { user: null, group: pick.slice(6), role: null, level }
        : { user: pick, role: null, level };
    setOwn([...own.filter((g) => who(g) !== who(grant)), grant]);
    setPick('');
  };
  const taken = new Set(own.map(who));

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t('Share “{name}”', { name: collection.name })}
      submitLabel={t('Save access')}
      size="lg"
      canSubmit={grants !== null}
      onSubmit={() => library.setGrants(collection.id, own)}
    >
      <Text fontSize="sm" color="mutedText">
        {t('People you add here see everything in this collection and in the collections inside it.')} <b>{t('Can edit')}</b>{' '}
        {t('lets them save, move and archive questions; only you (the owner) and admins can share, move or archive the collection itself. Running a question also needs access to its database.')}
      </Text>
      {loadError && (
        <Alert status="error" borderRadius="md" fontSize="sm">
          <AlertIcon />
          {loadError}
        </Alert>
      )}
      {grants === null && !loadError && <Spinner size="sm" />}
      {grants !== null && (
        <VStack align="stretch" spacing={2} data-testid="grants">
          {own.length === 0 && inherited.length === 0 && (
            <Text fontSize="sm" color="faintText">
              {t('Only you and admins have access.')}
            </Text>
          )}
          {own.map((g) => (
            <Flex key={who(g)} align="center" gap={2}>
              <Text fontSize="sm" flex={1}>
                {who(g)}
              </Text>
              <Select size="xs" maxW="120px" value={g.level} onChange={(e) => setOwn(own.map((x) => (who(x) === who(g) ? { ...x, level: e.target.value as 'view' | 'edit' } : x)))} aria-label={t('Access of {name}', { name: who(g) })}>
                <option value="view">{t('Can view')}</option>
                <option value="edit">{t('Can edit')}</option>
              </Select>
              <IconButton aria-label={t('Remove {name}', { name: who(g) })} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => setOwn(own.filter((x) => who(x) !== who(g)))} />
            </Flex>
          ))}
          {inherited.map((g) => (
            <Flex key={`${who(g)}-${g.inherited_from?.id}`} align="center" gap={2} color="mutedText">
              <Text fontSize="sm" flex={1}>
                {who(g)}
              </Text>
              <Text fontSize="xs">
                {t(g.level === 'edit' ? 'Can edit · from “{name}”' : 'Can view · from “{name}”', { name: g.inherited_from?.name })}
              </Text>
            </Flex>
          ))}
          <HStack pt={2} borderTop="1px solid" borderColor="lineColor">
            <Select size="sm" value={pick} onChange={(e) => setPick(e.target.value)} placeholder={t('Add a person, a group or everyone…')} aria-label={t('Person to add')} data-testid="share-pick">
              {!taken.has(t('Everyone')) && <option value="role:all">{t('Everyone (all signed-in users)')}</option>}
              {(people.data?.groups ?? [])
                .filter((g) => !taken.has(t('Group “{group}”', { group: g })))
                .map((g) => (
                  <option key={`g-${g}`} value={`group:${g}`}>
                    {t('Group: {group}', { group: g })}
                  </option>
                ))}
              {(people.data?.users ?? [])
                .filter((u) => !taken.has(u))
                .map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
            </Select>
            <Select size="sm" maxW="130px" value={level} onChange={(e) => setLevel(e.target.value as 'view' | 'edit')} aria-label={t('Access to give')}>
              <option value="view">{t('Can view')}</option>
              <option value="edit">{t('Can edit')}</option>
            </Select>
            <Button size="sm" leftIcon={<PlusIcon boxSize={3} />} onClick={add} isDisabled={!pick} data-testid="share-add">
              {t('Add')}
            </Button>
          </HStack>
        </VStack>
      )}
    </DialogShell>
  );
}

// ---------------------------------------------------------------- confirm

export function ConfirmDialog({
  isOpen,
  onClose,
  title,
  body,
  confirmLabel,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
}) {
  return (
    <DialogShell isOpen={isOpen} onClose={onClose} title={title} submitLabel={confirmLabel} onSubmit={onConfirm} danger>
      <Box fontSize="sm">{body}</Box>
    </DialogShell>
  );
}
