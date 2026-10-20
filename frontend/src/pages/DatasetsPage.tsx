import { useState } from 'react';
import {
  Badge, Box, Button, Flex, FormControl, FormLabel, IconButton, Input, InputGroup, InputLeftElement, Link, Menu, MenuButton, MenuDivider,
  MenuItem, MenuList, Skeleton, Text, Textarea, Tooltip, VStack, useDisclosure, useToast,
} from '@chakra-ui/react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { PageHeader } from '../components/PageHeader';
import { locale, t, tn } from '../i18n/index.ts';
import { ArchiveIcon, FolderIcon, MergeIcon, MoreIcon, PencilIcon, SearchIcon, UploadIcon } from '../icons';
import { DialogShell, MoveDialog } from '../library/dialogs';
import { useWorkspace } from '../workspace/useWorkspace';
import { datasets, formatBytes, useDatasets } from '../federation/api';
import type { Dataset } from '../federation/types';
import { UploadDialog } from '../federation/UploadDialog';

function ago(ts: number): string {
  const s = Date.now() / 1000 - ts;
  if (s < 3600) return t('{n} min ago', { n: Math.max(1, Math.floor(s / 60)) });
  if (s < 86400) return t('{n} h ago', { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t('{n} d ago', { n: Math.floor(s / 86400) });
  return new Date(ts * 1000).toLocaleDateString(locale());
}

/** /datasets: uploaded files (CSV, Excel, Parquet) - the sources multi-source questions can use besides databases. */
export default function DatasetsPage() {
  const ws = useWorkspace();
  const [text, setText] = useState('');
  const upload = useDisclosure();
  const navigate = useNavigate();
  const list = useDatasets({ q: text.trim() || undefined });
  const enabled = ws.limits.uploads_enabled !== false;
  return (
    <VStack align="stretch" spacing={5}>
      <PageHeader
        title={t('Uploads')}
        subtitle={t('Spreadsheets and files to combine with your databases. Stored by Ncode in a compact copy; the original file is not kept.')}
        actions={
          <Tooltip label={enabled ? '' : t('Uploads are turned off on this server')} isDisabled={enabled} hasArrow>
            <Button size="sm" variant="brand" leftIcon={<UploadIcon boxSize={4} />} onClick={upload.onOpen} isDisabled={!enabled} data-testid="upload-file">
              {t('Upload a file')}
            </Button>
          </Tooltip>
        }
      />
      <InputGroup>
        <InputLeftElement pointerEvents="none">
          <SearchIcon boxSize={4} color="faintText" />
        </InputLeftElement>
        <Input placeholder={t('Find a file…')} value={text} onChange={(e) => setText(e.target.value)} bg="panelBg" />
      </InputGroup>
      <Box bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden">
        {list.isPending && <Skeleton h="100px" />}
        {list.isError && (
          <Text fontSize="sm" color="red.400" p={3}>
            {apiErrorMessage(list.error, t('Could not load the files'))}
          </Text>
        )}
        {list.data?.length === 0 && (
          <Text fontSize="sm" color="faintText" px={3} py={4}>
            {text.trim() ? t('Nothing found.') : t('No files yet. Upload a CSV or Excel file, then combine it with a database in “Combine”.')}
          </Text>
        )}
        {list.data?.map((d) => (
          <DatasetRow key={d.id} d={d} showCollection />
        ))}
      </Box>
      <UploadDialog isOpen={upload.isOpen} onClose={upload.onClose} onUploaded={(d) => navigate(`/combine?dataset=${d.id}`)} />
    </VStack>
  );
}

/** One uploaded file in a list (also used by the Library). */
export function DatasetRow({ d, showCollection = false }: { d: Dataset; showCollection?: boolean }) {
  const toast = useToast();
  const move = useDisclosure();
  const rename = useDisclosure();
  const act = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast({ status: 'error', title: what, description: apiErrorMessage(e, t('Please try again')), duration: 5000 });
    }
  };
  const columns = d.columns.map((c) => `${c.name} (${c.type})`).join(', ');
  return (
    <Flex align="center" gap={3} px={3} py={2.5} borderBottom="1px solid" borderColor="lineColor" _last={{ borderBottom: 'none' }} _hover={{ bg: 'panelHover' }} data-testid="dataset-row">
      <UploadIcon boxSize={4} color="teal.300" flexShrink={0} />
      <Box flex={1} minW={0}>
        <Link as={RouterLink} to={`/combine?dataset=${d.id}`} fontWeight={600} fontSize="sm" noOfLines={1}>
          {d.name}
        </Link>
        <Tooltip label={columns} hasArrow openDelay={300}>
          <Text fontSize="xs" color="mutedText" noOfLines={1}>
            {showCollection && d.collection && `${d.collection.name} · `}
            {d.source_format.toUpperCase()} · {tn(d.row_count, '{n} row', '{n} rows')} · {tn(d.columns.length, '{n} column', '{n} columns')} · {formatBytes(d.size_bytes)} · {d.owner ?? t('former user')} ·{' '}
            {ago(d.updated_at)}
          </Text>
        </Tooltip>
      </Box>
      {d.access === 'view' && <Badge fontSize="2xs">{t('view only')}</Badge>}
      <Button as={RouterLink} to={`/combine?dataset=${d.id}`} size="xs" variant="ghost" leftIcon={<MergeIcon boxSize={3} />}>
        {t('Combine')}
      </Button>
      {d.access === 'edit' && (
        <Menu isLazy placement="bottom-end">
          <MenuButton as={IconButton} aria-label={t('Actions for {name}', { name: d.name })} size="xs" variant="ghost" icon={<MoreIcon boxSize={4} />} />
          <MenuList fontSize="sm">
            <MenuItem icon={<PencilIcon boxSize={4} />} onClick={rename.onOpen}>
              {t('Rename / describe…')}
            </MenuItem>
            <MenuItem icon={<FolderIcon boxSize={4} />} onClick={move.onOpen}>
              {t('Move…')}
            </MenuItem>
            <MenuDivider />
            <MenuItem icon={<ArchiveIcon boxSize={4} />} onClick={() => void act(t('Could not archive'), () => datasets.update(d.id, { archived: true }))}>
              {t('Archive')}
            </MenuItem>
          </MenuList>
        </Menu>
      )}
      <MoveDialog isOpen={move.isOpen} onClose={move.onClose} title={t('Move “{name}”', { name: d.name })} current={d.collection_id} onMove={(target) => datasets.update(d.id, { collection_id: target as number })} />
      {rename.isOpen && <RenameDialog d={d} onClose={rename.onClose} />}
    </Flex>
  );
}

function RenameDialog({ d, onClose }: { d: Dataset; onClose: () => void }) {
  const [name, setName] = useState(d.name);
  const [description, setDescription] = useState(d.description ?? '');
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title={t('Rename / describe')}
      submitLabel={t('Save')}
      canSubmit={name.trim() !== ''}
      onSubmit={() => datasets.update(d.id, { name: name.trim(), description: description.trim() || null })}
    >
      <FormControl isRequired>
        <FormLabel fontSize="sm">{t('Name')}</FormLabel>
        <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
      </FormControl>
      <FormControl>
        <FormLabel fontSize="sm">{t('Description')}</FormLabel>
        <Textarea size="sm" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
      </FormControl>
      <Text fontSize="xs" color="faintText">
        {t('Uploaded as {file}', { file: d.source_name ?? t('a file') })} · {tn(d.columns.length, '{n} column: {names}', '{n} columns: {names}', { names: d.columns.map((c) => c.name).join(', ') })}
      </Text>
    </DialogShell>
  );
}
