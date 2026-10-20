import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Flex, HStack, IconButton, Input, InputGroup, InputLeftElement, Link, Menu, MenuButton, MenuDivider,
  MenuItem, MenuList, Skeleton, Stack, Text, Tooltip, VStack, useDisclosure, useToast,
} from '@chakra-ui/react';
import { Link as RouterLink, NavLink, useNavigate, useParams } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { PageHeader } from '../components/PageHeader';
import {
  ArchiveIcon, ChartIcon, ChevronRightIcon, CodeIcon, CopyIcon, FolderIcon, LayoutIcon, MergeIcon, MoreIcon, PencilIcon, PlusIcon, RefreshIcon,
  SearchIcon, StarIcon, TrashIcon, UploadIcon, UsersIcon,
} from '../icons';
import { flattenTree, library, useArchive, useCollection, useCollections, useQuestions } from '../library/api';
import type { CollectionInfo, QuestionKind, QuestionSummary } from '../library/api';
import { CollectionDialog, ConfirmDialog, MoveDialog, ShareDialog } from '../library/dialogs';
import { dashboards, useDashboards } from '../dashboards/api';
import { DashboardRow, NewDashboardDialog } from './DashboardsPage';
import { DatasetRow } from './DatasetsPage';
import { datasets } from '../federation/api';
import { UploadDialog } from '../federation/UploadDialog';
import { locale, t, tc } from '../i18n/index.ts';

const KIND_ICON: Record<QuestionKind, typeof ChartIcon> = { builder: ChartIcon, sql: CodeIcon, federated: MergeIcon };

function ago(ts: number): string {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n} h ago', { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t('{n} d ago', { n: Math.floor(s / 86400) });
  return new Date(ts * 1000).toLocaleDateString(locale());
}

/** /library, /library/c/:id and /library/archive. */
export default function LibraryPage({ archive = false }: { archive?: boolean }) {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  return (
    <Flex gap={6} direction={{ base: 'column', md: 'row' }} align="flex-start">
      <Box w={{ base: '100%', md: '250px' }} flexShrink={0} position={{ md: 'sticky' }} top={{ md: 6 }}>
        <CollectionTree activeId={id} archive={archive} />
      </Box>
      <Box flex={1} minW={0} w="100%">
        {archive ? <ArchiveView /> : id !== null ? <CollectionView key={id} id={id} /> : <LibraryHome />}
      </Box>
    </Flex>
  );
}

// ---------------------------------------------------------------- tree

function TreeLink({ to, active, depth = 0, icon, children, testId }: { to: string; active: boolean; depth?: number; icon: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <Link
      as={NavLink}
      to={to}
      display="flex"
      alignItems="center"
      gap={2}
      pl={`${8 + depth * 14}px`}
      pr={2}
      py={1.5}
      borderRadius="md"
      fontSize="sm"
      bg={active ? 'rgba(99,102,241,0.14)' : undefined}
      color={active ? 'bodyText' : 'mutedText'}
      fontWeight={active ? 600 : 400}
      _hover={{ textDecoration: 'none', bg: active ? 'rgba(99,102,241,0.14)' : 'panelHover' }}
      data-testid={testId}
    >
      {icon}
      <Text as="span" noOfLines={1}>
        {children}
      </Text>
    </Link>
  );
}

function CollectionTree({ activeId, archive }: { activeId: number | null; archive: boolean }) {
  const { data, isPending, isError, error } = useCollections();
  const create = useDisclosure();
  const navigate = useNavigate();
  const nodes = useMemo(() => flattenTree(data?.collections ?? []), [data]);
  const own = nodes.filter((n) => !(n.personal && !n.mine) && !inOthers(n, nodes));
  const others = nodes.filter((n) => (n.personal && !n.mine) || inOthers(n, nodes));
  return (
    <VStack align="stretch" spacing={0.5} data-testid="collection-tree">
      <TreeLink to="/library" active={activeId === null && !archive} icon={<StarIcon boxSize={4} />}>
        {t('Start')}
      </TreeLink>
      <Flex align="center" justify="space-between" pt={3} pb={1} pl={2}>
        <Text fontSize="2xs" fontWeight={700} color="faintText" textTransform="uppercase" letterSpacing="0.08em">
          {t('Collections')}
        </Text>
        <Tooltip label={t('New collection')} hasArrow>
          <IconButton aria-label={t('New collection')} size="xs" variant="ghost" icon={<PlusIcon boxSize={3} />} onClick={create.onOpen} data-testid="new-collection" />
        </Tooltip>
      </Flex>
      {isPending && <Skeleton h="120px" borderRadius="md" />}
      {isError && <Text fontSize="xs" color="red.400">{apiErrorMessage(error, t('Could not load collections'))}</Text>}
      {own.map((n) => (
        <TreeLink key={n.id} to={`/library/c/${n.id}`} active={n.id === activeId} depth={n.depth} icon={<FolderIcon boxSize={4} />} testId={`tree-${n.id}`}>
          {n.mine ? t('My collection') : n.name}
          {n.shared && !n.personal && <UsersIcon boxSize={3} ml={1.5} color="faintText" />}
        </TreeLink>
      ))}
      {others.length > 0 && (
        <>
          <Text fontSize="2xs" fontWeight={700} color="faintText" textTransform="uppercase" letterSpacing="0.08em" pt={3} pb={1} pl={2}>
            {t('Other people’s collections')}
          </Text>
          {others.map((n) => (
            <TreeLink key={n.id} to={`/library/c/${n.id}`} active={n.id === activeId} depth={n.depth} icon={<FolderIcon boxSize={4} />}>
              {n.name}
            </TreeLink>
          ))}
        </>
      )}
      <Box pt={3}>
        <TreeLink to="/library/archive" active={archive} icon={<ArchiveIcon boxSize={4} />} testId="tree-archive">
          {tc('noun', 'Archive')}
        </TreeLink>
      </Box>
      <CollectionDialog isOpen={create.isOpen} onClose={create.onClose} parentId={null} onDone={(c) => navigate(`/library/c/${c.id}`)} />
    </VStack>
  );
}

// a collection inside someone else's personal collection (admins see those)
function inOthers(n: CollectionInfo, nodes: CollectionInfo[]): boolean {
  let parent = nodes.find((x) => x.id === n.parent_id);
  let guard = 0;
  while (parent && guard++ < 30) {
    if (parent.personal && !parent.mine) return true;
    const next = parent.parent_id;
    parent = nodes.find((x) => x.id === next);
  }
  return false;
}

// ---------------------------------------------------------------- lists

function QuestionRow({ q, showCollection = false }: { q: QuestionSummary; showCollection?: boolean }) {
  const toast = useToast();
  const navigate = useNavigate();
  const move = useDisclosure();
  const Icon = KIND_ICON[q.kind];
  const act = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast({ status: 'error', title: what, description: apiErrorMessage(e, t('Please try again')), duration: 5000 });
    }
  };
  return (
    <Flex align="center" gap={3} px={3} py={2.5} borderBottom="1px solid" borderColor="lineColor" _last={{ borderBottom: 'none' }} _hover={{ bg: 'panelHover' }} data-testid="question-row">
      <Icon boxSize={4} color={q.kind === 'sql' ? 'cyan.400' : q.kind === 'federated' ? 'orange.300' : 'brand.400'} flexShrink={0} />
      <Box flex={1} minW={0}>
        <Link as={RouterLink} to={`/questions/${q.id}`} fontWeight={600} fontSize="sm" noOfLines={1}>
          {q.name}
        </Link>
        <Text fontSize="xs" color="mutedText" noOfLines={1}>
          {showCollection && q.collection && `${q.collection.name} · `}
          {q.kind === 'federated' ? t('multi-source') : q.connection} · {q.owner ?? t('former user')} · {ago(q.updated_at)}
          {q.description && ` · ${q.description}`}
        </Text>
      </Box>
      {q.imported && <Badge fontSize="2xs">DataDesk</Badge>}
      {q.model && <Badge fontSize="2xs" colorScheme="teal">{t('model')}</Badge>}
      {q.access === 'view' && <Badge fontSize="2xs">{t('view only')}</Badge>}
      <IconButton
        aria-label={q.favorite ? t('Remove from favourites') : t('Add to favourites')}
        size="xs"
        variant="ghost"
        color={q.favorite ? 'yellow.400' : 'faintText'}
        icon={<StarIcon boxSize={4} fill={q.favorite ? 'currentColor' : 'none'} />}
        onClick={() => void act(t('Could not change favourites'), () => library.favorite(q.id, !q.favorite))}
      />
      <Menu isLazy placement="bottom-end">
        <MenuButton as={IconButton} aria-label={t('Actions for {name}', { name: q.name })} size="xs" variant="ghost" icon={<MoreIcon boxSize={4} />} />
        <MenuList fontSize="sm">
          <MenuItem icon={<CopyIcon boxSize={4} />} onClick={() => void act(t('Could not duplicate'), async () => navigate(`/questions/${(await library.duplicate(q.id)).id}`))}>
            {t('Duplicate')}
          </MenuItem>
          {q.access === 'edit' && (
            <>
              <MenuItem icon={<FolderIcon boxSize={4} />} onClick={move.onOpen}>
                {t('Move…')}
              </MenuItem>
              <MenuDivider />
              <MenuItem icon={<ArchiveIcon boxSize={4} />} onClick={() => void act(t('Could not archive'), () => library.updateQuestion(q.id, { archived: true }))}>
                {t('Archive')}
              </MenuItem>
            </>
          )}
        </MenuList>
      </Menu>
      <MoveDialog isOpen={move.isOpen} onClose={move.onClose} title={t('Move “{name}”', { name: q.name })} current={q.collection_id} onMove={(target) => library.updateQuestion(q.id, { collection_id: target as number })} />
    </Flex>
  );
}

function Panel({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <Box bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden">
      {title && (
        <Flex align="center" justify="space-between" px={3} py={2} borderBottom="1px solid" borderColor="lineColor">
          <Text fontSize="sm" fontWeight={700}>
            {title}
          </Text>
          {actions}
        </Flex>
      )}
      {children}
    </Box>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <Text fontSize="sm" color="faintText" px={3} py={4}>
      {children}
    </Text>
  );
}

function QuestionList({ items, loading, error, empty, showCollection }: { items?: QuestionSummary[]; loading: boolean; error: unknown; empty: string; showCollection?: boolean }) {
  if (loading) return <Skeleton h="100px" />;
  if (error) return <Empty>{apiErrorMessage(error, t('Could not load the questions'))}</Empty>;
  if (!items?.length) return empty ? <Empty>{empty}</Empty> : null;
  return (
    <Box>
      {items.map((q) => (
        <QuestionRow key={q.id} q={q} showCollection={showCollection} />
      ))}
    </Box>
  );
}

function NewButtons({ collection }: { collection?: number }) {
  const into = collection ? `?collection=${collection}` : ''; // saving then defaults to this collection
  return (
    <HStack>
      <Button as={RouterLink} to={`/questions${into}`} size="sm" variant="brand" leftIcon={<ChartIcon boxSize={4} />}>
        {t('New question')}
      </Button>
      <Button as={RouterLink} to={`/sql${into}`} size="sm" variant="subtle" leftIcon={<CodeIcon boxSize={4} />}>
        {t('New SQL query')}
      </Button>
      <Button as={RouterLink} to={`/combine${into}`} size="sm" variant="subtle" leftIcon={<MergeIcon boxSize={4} />}>
        {t('Combine sources')}
      </Button>
    </HStack>
  );
}

// ---------------------------------------------------------------- start

function LibraryHome() {
  const [text, setText] = useState('');
  const query = text.trim();
  const favorites = useQuestions({ favorites: true });
  const favoriteBoards = useDashboards({ favorites: true });
  const recent = useQuestions({ limit: 15 });
  const found = useQuestions({ q: query, limit: 100 }, query.length > 0);
  const foundBoards = useDashboards({ q: query, limit: 50 }, query.length > 0);
  return (
    <VStack align="stretch" spacing={5}>
      <PageHeader title={t('Library')} subtitle={t('Saved questions and dashboards, organised in collections you can share.')} actions={<NewButtons />} />
      <InputGroup size="md">
        <InputLeftElement pointerEvents="none">
          <SearchIcon boxSize={4} color="faintText" />
        </InputLeftElement>
        <Input placeholder={t('Find a question by name or description…')} value={text} onChange={(e) => setText(e.target.value)} bg="panelBg" data-testid="library-search" />
      </InputGroup>
      {query ? (
        <>
          {(foundBoards.data?.length ?? 0) > 0 && (
            <Panel title={t('Dashboards matching “{query}”', { query })}>
              {foundBoards.data!.map((d) => (
                <DashboardRow key={d.id} d={d} showCollection />
              ))}
            </Panel>
          )}
          <Panel title={t('Questions matching “{query}”', { query })}>
            <QuestionList items={found.data} loading={found.isPending} error={found.error} empty={t('Nothing found.')} showCollection />
          </Panel>
        </>
      ) : (
        <>
          <Panel title={t('Favourites')}>
            {favoriteBoards.data?.map((d) => (
              <DashboardRow key={`d${d.id}`} d={d} showCollection />
            ))}
            <QuestionList
              items={favorites.data}
              loading={favorites.isPending}
              error={favorites.error}
              empty={favoriteBoards.data?.length ? '' : t('Star a question or a dashboard to keep it here.')}
              showCollection
            />
          </Panel>
          <Panel title={t('Recently changed')}>
            <QuestionList items={recent.data} loading={recent.isPending} error={recent.error} empty={t('No saved questions yet. Build one and press Save.')} showCollection />
          </Panel>
        </>
      )}
    </VStack>
  );
}

// ---------------------------------------------------------------- one collection

function CollectionView({ id }: { id: number }) {
  const { data, isPending, isError, error } = useCollection(id);
  const navigate = useNavigate();
  const toast = useToast();
  const share = useDisclosure();
  const newBoard = useDisclosure();
  const uploadHere = useDisclosure();
  const edit = useDisclosure();
  const sub = useDisclosure();
  const move = useDisclosure();

  if (isPending) return <Skeleton h="300px" borderRadius="xl" />;
  if (isError || !data)
    return (
      <Alert status="error" borderRadius="xl">
        <AlertIcon />
        {apiErrorMessage(error, t('This collection could not be opened.'))}
      </Alert>
    );
  const c = data.collection;
  const archive = async () => {
    try {
      await library.updateCollection(c.id, { archived: true });
      toast({ status: 'info', title: t('“{name}” archived', { name: c.name }), description: t('Restore it from the Archive.'), duration: 4000 });
      navigate('/library');
    } catch (e) {
      toast({ status: 'error', title: t('Could not archive'), description: apiErrorMessage(e, t('Please try again')), duration: 5000 });
    }
  };

  return (
    <VStack align="stretch" spacing={4}>
      <HStack spacing={1} fontSize="xs" color="mutedText">
        <Link as={RouterLink} to="/library">
          {t('Library')}
        </Link>
        {data.path.slice(0, -1).map((p) => (
          <HStack key={p.id} spacing={1}>
            <ChevronRightIcon boxSize={3} />
            <Link as={RouterLink} to={`/library/c/${p.id}`}>
              {p.name}
            </Link>
          </HStack>
        ))}
      </HStack>
      <PageHeader
        title={c.mine ? t('My collection') : c.name}
        subtitle={
          <>
            {c.description || (c.mine ? t('Only you (and admins) can see what is in here.') : null)}
            {c.archived && <Badge ml={2}>{t('archived')}</Badge>}
            {c.access === 'view' && <Badge ml={2}>{t('view only')}</Badge>}
          </>
        }
        actions={
          <HStack>
            {c.can_manage && !c.personal && (
              <Button size="sm" variant="subtle" leftIcon={<UsersIcon boxSize={4} />} onClick={share.onOpen} data-testid="share-collection">
                {t('Share')}
              </Button>
            )}
            {c.access === 'edit' && (
              <Button size="sm" variant="subtle" leftIcon={<PlusIcon boxSize={4} />} onClick={sub.onOpen}>
                {t('Collection')}
              </Button>
            )}
            {(c.access === 'edit' || c.can_manage) && !c.personal && (
              <Menu isLazy placement="bottom-end">
                <MenuButton as={IconButton} aria-label={t('Collection actions')} size="sm" variant="ghost" icon={<MoreIcon boxSize={4} />} data-testid="collection-menu" />
                <MenuList fontSize="sm">
                  {c.access === 'edit' && (
                    <MenuItem icon={<PencilIcon boxSize={4} />} onClick={edit.onOpen}>
                      {t('Rename / describe…')}
                    </MenuItem>
                  )}
                  {c.can_manage && (
                    <MenuItem icon={<FolderIcon boxSize={4} />} onClick={move.onOpen}>
                      {t('Move…')}
                    </MenuItem>
                  )}
                  {c.can_manage && (
                    <>
                      <MenuDivider />
                      <MenuItem icon={<ArchiveIcon boxSize={4} />} onClick={() => void archive()}>
                        {t('Archive')}
                      </MenuItem>
                    </>
                  )}
                </MenuList>
              </Menu>
            )}
          </HStack>
        }
      />
      {data.collections.length > 0 && (
        <Panel title={t('Collections')}>
          {data.collections.map((child) => (
            <Flex key={child.id} align="center" gap={3} px={3} py={2.5} borderBottom="1px solid" borderColor="lineColor" _last={{ borderBottom: 'none' }} _hover={{ bg: 'panelHover' }}>
              <FolderIcon boxSize={4} color="yellow.400" />
              <Link as={RouterLink} to={`/library/c/${child.id}`} fontSize="sm" fontWeight={600} flex={1}>
                {child.name}
              </Link>
              {child.shared && <UsersIcon boxSize={3} color="faintText" />}
            </Flex>
          ))}
        </Panel>
      )}
      {(data.dashboards.length > 0 || c.access === 'edit') && (
        <Panel
          title={t('Dashboards')}
          actions={
            c.access === 'edit' ? (
              <Button size="sm" variant="subtle" leftIcon={<PlusIcon boxSize={4} />} onClick={newBoard.onOpen} data-testid="new-dashboard-here">
                {t('New dashboard')}
              </Button>
            ) : undefined
          }
        >
          {data.dashboards.length === 0 ? (
            <Empty>{t('No dashboards here yet.')}</Empty>
          ) : (
            data.dashboards.map((d) => <DashboardRow key={d.id} d={d} />)
          )}
        </Panel>
      )}
      <Panel title={t('Questions')} actions={c.access === 'edit' ? <NewButtons collection={c.id} /> : undefined}>
        <QuestionList items={data.questions} loading={false} error={null} empty={c.access === 'edit' ? t('Empty. Save a question into this collection.') : t('Empty.')} />
      </Panel>
      {((data.datasets?.length ?? 0) > 0 || c.access === 'edit') && (
        <Panel
          title={t('Uploaded files')}
          actions={
            c.access === 'edit' ? (
              <Button size="sm" variant="subtle" leftIcon={<UploadIcon boxSize={4} />} onClick={uploadHere.onOpen} data-testid="upload-here">
                {t('Upload a file')}
              </Button>
            ) : undefined
          }
        >
          {data.datasets?.length ? data.datasets.map((d) => <DatasetRow key={d.id} d={d} />) : <Empty>{t('No files here.')}</Empty>}
        </Panel>
      )}
      <UploadDialog isOpen={uploadHere.isOpen} onClose={uploadHere.onClose} collectionId={c.id} />
      <NewDashboardDialog isOpen={newBoard.isOpen} onClose={newBoard.onClose} collectionId={c.id} />

      {c.can_manage && !c.personal && <ShareDialog isOpen={share.isOpen} onClose={share.onClose} collection={c} />}
      <CollectionDialog isOpen={edit.isOpen} onClose={edit.onClose} collection={c} />
      <CollectionDialog isOpen={sub.isOpen} onClose={sub.onClose} parentId={c.id} onDone={(n) => navigate(`/library/c/${n.id}`)} />
      <MoveDialog
        isOpen={move.isOpen}
        onClose={move.onClose}
        title={t('Move “{name}”', { name: c.name })}
        current={c.parent_id}
        allowRoot
        exclude={c.id}
        onMove={(target) => library.updateCollection(c.id, { parent_id: target })}
      />
    </VStack>
  );
}

// ---------------------------------------------------------------- archive

function ArchiveView() {
  const { data, isPending, error } = useArchive();
  const toast = useToast();
  const [deleting, setDeleting] = useState<{ kind: 'question' | 'collection' | 'dashboard' | 'dataset'; id: number; name: string } | null>(null);
  const restore = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast({ status: 'error', title: t('Could not restore'), description: apiErrorMessage(e, t('Please try again')), duration: 5000 });
    }
  };
  return (
    <VStack align="stretch" spacing={4}>
      <PageHeader title={tc('noun', 'Archive')} subtitle={t('Archived questions, dashboards and collections. Restore them, or delete them for good.')} />
      {isPending && <Skeleton h="160px" borderRadius="xl" />}
      {error && (
        <Alert status="error" borderRadius="xl">
          <AlertIcon />
          {apiErrorMessage(error, t('Could not load the archive'))}
        </Alert>
      )}
      {data && (
        <>
          <Panel title={t('Collections')}>
            {data.collections.length === 0 && <Empty>{t('No archived collections.')}</Empty>}
            {data.collections.map((c) => (
              <ArchiveRow
                key={`c${c.id}`}
                icon={<FolderIcon boxSize={4} color="yellow.400" />}
                name={c.name}
                onRestore={() => void restore(() => library.updateCollection(c.id, { archived: false }))}
                onDelete={() => setDeleting({ kind: 'collection', id: c.id, name: c.name })}
              />
            ))}
          </Panel>
          <Panel title={t('Dashboards')}>
            {data.dashboards.length === 0 && <Empty>{t('No archived dashboards.')}</Empty>}
            {data.dashboards.map((d) => (
              <ArchiveRow
                key={`d${d.id}`}
                icon={<LayoutIcon boxSize={4} />}
                name={d.name}
                detail={d.collection?.name}
                onRestore={() => void restore(() => dashboards.update(d.id, { archived: false }))}
                onDelete={() => setDeleting({ kind: 'dashboard', id: d.id, name: d.name })}
              />
            ))}
          </Panel>
          {(data.datasets?.length ?? 0) > 0 && (
            <Panel title={t('Uploaded files')}>
              {data.datasets!.map((d) => (
                <ArchiveRow
                  key={`f${d.id}`}
                  icon={<UploadIcon boxSize={4} />}
                  name={d.name}
                  detail={d.collection?.name}
                  onRestore={() => void restore(() => datasets.update(d.id, { archived: false }))}
                  onDelete={() => setDeleting({ kind: 'dataset', id: d.id, name: d.name })}
                />
              ))}
            </Panel>
          )}
          <Panel title={t('Questions')}>
            {data.questions.length === 0 && <Empty>{t('No archived questions.')}</Empty>}
            {data.questions.map((q) => {
              const Icon = KIND_ICON[q.kind];
              return (
                <ArchiveRow
                  key={`q${q.id}`}
                  icon={<Icon boxSize={4} />}
                  name={q.name}
                  detail={q.collection?.name}
                  onRestore={() => void restore(() => library.updateQuestion(q.id, { archived: false }))}
                  onDelete={() => setDeleting({ kind: 'question', id: q.id, name: q.name })}
                />
              );
            })}
          </Panel>
        </>
      )}
      <ConfirmDialog
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('Delete for good?')}
        confirmLabel={t('Delete')}
        body={
          deleting?.kind === 'collection'
            ? t('“{name}” and everything inside it (questions, dashboards and collections) will be deleted. This cannot be undone.', { name: deleting.name })
            : t('“{name}” will be deleted. This cannot be undone.', { name: deleting?.name })
        }
        onConfirm={async () => {
          if (!deleting) return;
          if (deleting.kind === 'collection') await library.deleteCollection(deleting.id);
          else if (deleting.kind === 'dashboard') await dashboards.remove(deleting.id);
          else if (deleting.kind === 'dataset') await datasets.remove(deleting.id);
          else await library.deleteQuestion(deleting.id);
        }}
      />
    </VStack>
  );
}

function ArchiveRow({ icon, name, detail, onRestore, onDelete }: { icon: ReactNode; name: string; detail?: string; onRestore: () => void; onDelete: () => void }) {
  return (
    <Stack direction="row" align="center" spacing={3} px={3} py={2.5} borderBottom="1px solid" borderColor="lineColor" _last={{ borderBottom: 'none' }} data-testid="archive-row">
      {icon}
      <Box flex={1} minW={0}>
        <Text fontSize="sm" fontWeight={600} noOfLines={1}>
          {name}
        </Text>
        {detail && (
          <Text fontSize="xs" color="mutedText">
            {t('was in {name}', { name: detail })}
          </Text>
        )}
      </Box>
      <Button size="xs" variant="subtle" leftIcon={<RefreshIcon boxSize={3} />} onClick={onRestore}>
        {t('Restore')}
      </Button>
      <Button size="xs" variant="ghost" colorScheme="red" leftIcon={<TrashIcon boxSize={3} />} onClick={onDelete}>
        {t('Delete')}
      </Button>
    </Stack>
  );
}
