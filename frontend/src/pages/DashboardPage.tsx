import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Badge, Box, Button, Flex, FormControl, FormLabel, HStack, IconButton, Input, Link, Menu, MenuButton,
  MenuDivider, MenuItem, MenuList, Select, Skeleton, Text, Textarea, Tooltip, useBreakpointValue, useDisclosure, useToast,
} from '@chakra-ui/react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ReactGridLayout, { useContainerWidth, verticalCompactor } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { apiErrorMessage, http } from '../api';
import type { SavedQuestion } from '../library/api';
import {
  ArchiveIcon, BellIcon, ChartIcon, GlobeIcon, ChevronRightIcon, CopyIcon, FolderIcon, LayoutIcon, MoreIcon, PencilIcon, PlusIcon, RefreshIcon, SaveIcon,
  SlidersIcon, StarIcon, XIcon,
} from '../icons';
import { DialogShell, MoveDialog } from '../library/dialogs';
import { SubscriptionsDrawer } from '../automation/SubscriptionsDrawer';
import { ShareDialog } from '../sharing/ShareDialog';
import { useWorkspace } from '../workspace/useWorkspace';
import { cardQueue, dashboards, useDashboard } from '../dashboards/api';
import { DashboardCard } from '../dashboards/DashboardCard';
import { AddQuestionDialog, CardDialog, FiltersDialog } from '../dashboards/EditDialogs';
import { FilterBar } from '../dashboards/FilterBar';
import {
  DEFAULT_SIZE, addTab, applyLayout, cardsOnTab, newKey, placeNew, removeTab, runValues, toDefinition, valuesFromSearch, valuesToSearch,
} from '../dashboards/logic';
import type { FilterValues } from '../dashboards/logic';
import { REFRESH_CHOICES } from '../dashboards/types';
import type { Dashboard, DashCard, Definition } from '../dashboards/types';
import { locale, t } from '../i18n/index.ts';

const ROW_HEIGHT = 40;
const MARGIN = 12;

/** /dashboards/:id */
export default function DashboardPage() {
  const id = Number(useParams().id);
  const query = useDashboard(id);
  if (query.isPending) return <Skeleton h="480px" borderRadius="2xl" />;
  if (query.isError || !query.data)
    return (
      <Alert status="error" borderRadius="xl" flexDirection="column" alignItems="flex-start" gap={2}>
        <Text fontWeight={600}>{t('This dashboard could not be opened')}</Text>
        <Text fontSize="sm">{apiErrorMessage(query.error, t('It may have been deleted, or it was not shared with you.'))}</Text>
        <Button as={RouterLink} to="/dashboards" size="sm">
          {t('All dashboards')}
        </Button>
      </Alert>
    );
  return <DashboardView key={id} dashboard={query.data} />;
}

function DashboardView({ dashboard }: { dashboard: Dashboard }) {
  const ws = useWorkspace();
  const toast = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const canEdit = dashboard.access === 'edit';
  const definitionOf = (d: Dashboard): Definition => ({ filters: d.filters, tabs: d.tabs, cards: d.cards, settings: d.settings });
  // set while editing; a new dashboard opens in edit mode (?edit=1)
  const [draft, setDraft] = useState<Definition | null>(() => (search.get('edit') === '1' && canEdit ? definitionOf(dashboard) : null));
  const editing = draft !== null;
  const def: Definition = draft ?? dashboard;
  useEffect(() => {
    if (search.get('edit') === null) return;
    setSearch((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('edit');
      return next;
    }, { replace: true });
  }, [search, setSearch]);
  const [saving, setSaving] = useState(false);
  const addQuestion = useDisclosure();
  const filtersDialog = useDisclosure();
  const details = useDisclosure();
  const move = useDisclosure();
  const share = useDisclosure();
  const [subsOpen, setSubsOpen] = useState(() => search.get('subscriptions') === '1');
  const [editingCard, setEditingCard] = useState<DashCard | null>(null);
  const [renamingTab, setRenamingTab] = useState<string | null>(null);

  // Card runs share a queue sized to the server's per-user limit.
  useEffect(() => {
    cardQueue.limit = Math.max(1, ws.limits.max_concurrent_queries ?? 3);
  }, [ws.limits.max_concurrent_queries]);

  // filters and tab live in the URL, so a link shows the same view
  const values = useMemo(() => valuesFromSearch(search), [search]);
  const setValues = (next: FilterValues) => setSearch((prev) => valuesToSearch(next, prev), { replace: true });
  const tabParam = search.get('tab');
  const activeTab = def.tabs.length ? (def.tabs.find((t) => t.id === tabParam)?.id ?? def.tabs[0].id) : null;
  const setTab = (id: string) =>
    setSearch((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', id);
      return next;
    }, { replace: true });
  const runJson = useMemo(() => JSON.stringify(runValues(def.filters, values)), [def.filters, values]);

  // refresh: manual, or every N seconds (paused while editing)
  const [refreshEvery, setRefreshEvery] = useState<number>(dashboard.settings.refresh ?? 0);
  const [tick, setTick] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(() => Date.now());
  const refreshAll = useCallback(() => {
    setTick((n) => n + 1);
    setLastRefresh(Date.now());
  }, []);
  useEffect(() => {
    if (!refreshEvery || editing) return;
    const timer = window.setInterval(refreshAll, refreshEvery * 1000);
    return () => window.clearInterval(timer);
  }, [refreshEvery, editing, refreshAll]);

  // TV mode: the dashboard alone, full screen
  const frame = useRef<HTMLDivElement | null>(null);
  const [tv, setTv] = useState(false);
  useEffect(() => {
    const onChange = () => setTv(document.fullscreenElement === frame.current && frame.current !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const enterTv = () => {
    void frame.current?.requestFullscreen?.().catch(() => toast({ status: 'warning', title: t('Full screen is not available in this browser') }));
  };

  // ------------------------------------------------------------------ editing
  const startEdit = () => setDraft(definitionOf(dashboard));
  const change = useCallback((fn: (d: Definition) => Definition) => setDraft((d) => (d ? fn(d) : d)), []);
  const tabCards = cardsOnTab(def, activeTab);
  const addCard = (card: Omit<DashCard, 'key' | 'layout' | 'tab'>) =>
    change((d) => {
      const size = DEFAULT_SIZE[card.kind];
      const key = newKey('c', d.cards.map((c) => c.key));
      return { ...d, cards: [...d.cards, { ...card, key, tab: activeTab, layout: placeNew(cardsOnTab(d, activeTab), size.w, size.h) }] };
    });
  const replaceCard = (next: DashCard) => change((d) => ({ ...d, cards: d.cards.map((c) => (c.key === next.key ? next : c)) }));
  const removeCard = (key: string) => change((d) => ({ ...d, cards: d.cards.filter((c) => c.key !== key) }));
  const onLayout = (layout: Layout) =>
    change((d) => {
      const updated = applyLayout(cardsOnTab(d, activeTab), [...layout]);
      if (updated === cardsOnTab(d, activeTab)) return d;
      const byKey = new Map(updated.map((c) => [c.key, c]));
      return { ...d, cards: d.cards.map((c) => byKey.get(c.key) ?? c) };
    });
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await dashboards.save(dashboard.id, toDefinition({ ...draft, settings: { ...draft.settings, refresh: refreshEvery as Definition['settings']['refresh'] } }));
      setDraft(null);
      toast({ status: 'success', title: t('Dashboard saved'), duration: 1500 });
    } catch (e) {
      toast({ status: 'error', title: t('Could not save'), description: apiErrorMessage(e, t('Please try again')), duration: 6000, isClosable: true });
    } finally {
      setSaving(false);
    }
  };

  const act = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast({ status: 'error', title: what, description: apiErrorMessage(e, t('Please try again')), duration: 5000 });
    }
  };

  // ------------------------------------------------------------------ grid
  const { width, containerRef, mounted } = useContainerWidth();
  const stacked = (useBreakpointValue({ base: true, md: false }, { ssr: false }) ?? false) && !editing;
  const layout: Layout = tabCards.map((c) => ({
    i: c.key, x: c.layout.x, y: c.layout.y, w: c.layout.w, h: c.layout.h, minW: 2, minH: c.kind === 'heading' ? 1 : 2,
  }));
  const renderCard = (c: DashCard) => (
    <DashboardCard
      dashboardId={dashboard.id}
      card={c}
      filters={def.filters}
      values={values}
      runValuesJson={runJson}
      saved={dashboard.cards.some((x) => x.key === c.key && x.question_id === c.question_id)}
      trigger={tick}
      refresh={tick > 0}
      editing={editing}
      onEdit={() => setEditingCard(c)}
      onRemove={() => removeCard(c.key)}
      onChange={replaceCard}
    />
  );

  return (
    <Box ref={frame} bg={tv ? 'appBg' : undefined} p={tv ? 6 : 0} overflowY={tv ? 'auto' : undefined} data-testid="dashboard">
      {/* header */}
      {!tv && (
        <HStack spacing={1} fontSize="xs" color="mutedText" mb={1} className="no-print">
          <Link as={RouterLink} to="/dashboards">
            {t('Dashboards')}
          </Link>
          {dashboard.path.map((p) => (
            <HStack key={p.id} spacing={1}>
              <ChevronRightIcon boxSize={3} />
              <Link as={RouterLink} to={`/library/c/${p.id}`}>
                {p.name}
              </Link>
            </HStack>
          ))}
        </HStack>
      )}
      <Flex align="center" gap={3} wrap="wrap" mb={3}>
        <Box minW={0}>
          <HStack spacing={2}>
            <Text as="h1" fontSize={tv ? '3xl' : '2xl'} fontWeight={700} letterSpacing="-0.02em" noOfLines={1} data-testid="dashboard-title">
              {dashboard.name}
            </Text>
            {!tv && (
              <IconButton
                aria-label={dashboard.favorite ? t('Remove from favourites') : t('Add to favourites')}
                size="xs"
                variant="ghost"
                className="no-print"
                color={dashboard.favorite ? 'yellow.400' : 'faintText'}
                icon={<StarIcon boxSize={4} fill={dashboard.favorite ? 'currentColor' : 'none'} />}
                onClick={() => void act(t('Could not change favourites'), () => dashboards.favorite(dashboard.id, !dashboard.favorite))}
              />
            )}
            {!canEdit && !tv && <Badge className="no-print">{t('view only')}</Badge>}
            {editing && <Badge colorScheme="orange">{t('editing')}</Badge>}
          </HStack>
          {dashboard.description && !tv && (
            <Text fontSize="sm" color="mutedText" noOfLines={2}>
              {dashboard.description}
            </Text>
          )}
        </Box>
        <Box flex={1} />
        {editing ? (
          <HStack spacing={2} wrap="wrap" className="no-print">
            <Button size="sm" variant="subtle" leftIcon={<ChartIcon boxSize={4} />} onClick={addQuestion.onOpen} data-testid="add-question-card">
              {t('Question')}
            </Button>
            <Button size="sm" variant="subtle" leftIcon={<PencilIcon boxSize={4} />} onClick={() => setEditingCard({ key: '', kind: 'text', text: '', layout: { x: 0, y: 0, w: 6, h: 3 } })} data-testid="add-text-card">
              {t('Text')}
            </Button>
            <Button size="sm" variant="subtle" leftIcon={<PlusIcon boxSize={4} />} onClick={() => setEditingCard({ key: '', kind: 'heading', text: '', layout: { x: 0, y: 0, w: 12, h: 1 } })} data-testid="add-heading-card">
              {t('Heading')}
            </Button>
            <Button size="sm" variant="subtle" leftIcon={<SlidersIcon boxSize={4} />} onClick={filtersDialog.onOpen} data-testid="edit-filters">
              {def.filters.length ? t('Filters ({n})', { n: def.filters.length }) : t('Filters')}
            </Button>
            <Button size="sm" variant="subtle" leftIcon={<LayoutIcon boxSize={4} />} onClick={() => change((d) => addTab(d, t('Tab {n}', { n: d.tabs.length + (d.tabs.length ? 1 : 2) })))} data-testid="add-tab">
              {t('Tab')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              {t('Cancel')}
            </Button>
            <Button size="sm" variant="brand" leftIcon={<SaveIcon boxSize={4} />} onClick={() => void save()} isLoading={saving} data-testid="save-dashboard">
              {t('Save')}
            </Button>
          </HStack>
        ) : (
          <HStack spacing={2} wrap="wrap" className="no-print">
            <Tooltip label={t('Last refreshed {time}', { time: new Date(lastRefresh).toLocaleTimeString(locale()) })} hasArrow>
              <IconButton aria-label={t('Refresh all cards')} size="sm" variant="subtle" icon={<RefreshIcon boxSize={4} />} onClick={refreshAll} data-testid="refresh-dashboard" />
            </Tooltip>
            <Select size="sm" w="170px" value={refreshEvery} onChange={(e) => setRefreshEvery(Number(e.target.value))} aria-label={t('Auto-refresh')} data-testid="auto-refresh">
              {REFRESH_CHOICES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.value ? t('Every {interval}', { interval: r.label }) : t('Auto-refresh off')}
                </option>
              ))}
            </Select>
            {!tv && (
              <>
                <Tooltip label={t('Subscriptions: send it by email or to a chat')} hasArrow>
                  <IconButton aria-label={t('Subscriptions')} size="sm" variant="subtle" icon={<BellIcon boxSize={4} />} onClick={() => setSubsOpen(true)} data-testid="dashboard-subscriptions" />
                </Tooltip>
                <Button size="sm" variant="subtle" onClick={enterTv} data-testid="tv-mode">
                  {t('TV mode')}
                </Button>
                {canEdit && (
                  <Button size="sm" variant="brand" leftIcon={<PencilIcon boxSize={4} />} onClick={startEdit} data-testid="edit-dashboard">
                    {t('Edit')}
                  </Button>
                )}
                <Menu isLazy placement="bottom-end">
                  <MenuButton as={IconButton} aria-label={t('More actions')} size="sm" variant="ghost" icon={<MoreIcon boxSize={4} />} data-testid="dashboard-menu" />
                  <MenuList fontSize="sm">
                    <MenuItem onClick={() => window.print()}>{t('Print / save as PDF')}</MenuItem>
                    {ws.isAdmin && (
                      <MenuItem icon={<GlobeIcon boxSize={4} />} onClick={share.onOpen} data-testid="dashboard-share">
                        {t('Public link / embed…')}
                      </MenuItem>
                    )}
                    <MenuItem icon={<CopyIcon boxSize={4} />} onClick={() => void act(t('Could not duplicate'), async () => navigate(`/dashboards/${(await dashboards.duplicate(dashboard.id)).id}`))}>
                      {t('Duplicate')}
                    </MenuItem>
                    {canEdit && (
                      <>
                        <MenuItem icon={<PencilIcon boxSize={4} />} onClick={details.onOpen}>
                          {t('Rename / describe…')}
                        </MenuItem>
                        <MenuItem icon={<FolderIcon boxSize={4} />} onClick={move.onOpen}>
                          {t('Move…')}
                        </MenuItem>
                        <MenuDivider />
                        <MenuItem
                          icon={<ArchiveIcon boxSize={4} />}
                          onClick={() =>
                            void act(t('Could not archive'), async () => {
                              await dashboards.update(dashboard.id, { archived: true });
                              toast({ status: 'info', title: t('“{name}” archived', { name: dashboard.name }), description: t('Restore it from Library → Archive.') });
                              navigate('/dashboards');
                            })
                          }
                        >
                          {t('Archive')}
                        </MenuItem>
                      </>
                    )}
                  </MenuList>
                </Menu>
              </>
            )}
            {tv && (
              <Button size="sm" variant="ghost" onClick={() => void document.exitFullscreen()}>
                {t('Exit TV mode')}
              </Button>
            )}
          </HStack>
        )}
      </Flex>

      {/* filters */}
      {def.filters.length > 0 && (
        <Box mb={3}>
          <FilterBar filters={def.filters} values={values} onChange={setValues} />
        </Box>
      )}

      {/* tabs */}
      {def.tabs.length > 0 && (
        <HStack spacing={1} mb={3} borderBottom="1px solid" borderColor="lineColor" overflowX="auto" data-testid="dashboard-tabs">
          {def.tabs.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <HStack key={tab.id} spacing={0} borderBottom="2px solid" borderColor={active ? 'brand.400' : 'transparent'} mb="-1px">
                {editing && renamingTab === tab.id ? (
                  <Input
                    size="xs"
                    w="140px"
                    autoFocus
                    defaultValue={tab.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim() || tab.name;
                      change((d) => ({ ...d, tabs: d.tabs.map((x) => (x.id === tab.id ? { ...x, name: name.slice(0, 80) } : x)) }));
                      setRenamingTab(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    aria-label={t('Tab name')}
                  />
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    borderRadius="0"
                    fontWeight={active ? 700 : 500}
                    color={active ? 'bodyText' : 'mutedText'}
                    onClick={() => setTab(tab.id)}
                    onDoubleClick={() => editing && setRenamingTab(tab.id)}
                    data-testid={`tab-${tab.id}`}
                  >
                    {tab.name}
                  </Button>
                )}
                {editing && (
                  <IconButton aria-label={t('Remove tab {name}', { name: tab.name })} size="xs" variant="ghost" icon={<XIcon boxSize={2.5} />} onClick={() => change((d) => removeTab(d, tab.id))} />
                )}
              </HStack>
            );
          })}
          {editing && (
            <Text fontSize="2xs" color="faintText" pl={2} whiteSpace="nowrap">
              {t('double-click a tab to rename it')}
            </Text>
          )}
        </HStack>
      )}

      {/* cards */}
      {tabCards.length === 0 && (
        <Flex direction="column" align="center" justify="center" gap={3} py={16} border="1px dashed" borderColor="lineColor" borderRadius="2xl" color="mutedText" textAlign="center">
          <LayoutIcon boxSize={8} />
          <Text fontSize="sm">{editing ? t('Add saved questions, text and headings with the buttons above.') : t('This dashboard is empty.')}</Text>
          {!editing && canEdit && (
            <Button size="sm" variant="brand" onClick={startEdit}>
              {t('Add cards')}
            </Button>
          )}
        </Flex>
      )}
      {/* the measured box is always there: the grid library measures its width once, on mount */}
      <Box ref={containerRef} mx={stacked ? 0 : `-${MARGIN}px`} className={editing ? 'dash-grid editing' : 'dash-grid'}>
        {stacked ? (
          <Box display="flex" flexDirection="column" gap={3}>
            {[...tabCards]
              .sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)
              .map((c) => (
                <Box key={c.key} h={c.kind === 'heading' ? 'auto' : `${Math.max(c.layout.h, 4) * ROW_HEIGHT}px`}>
                  {renderCard(c)}
                </Box>
              ))}
          </Box>
        ) : (
          mounted &&
          tabCards.length > 0 && (
            <ReactGridLayout
              width={width}
              layout={layout}
              gridConfig={{ cols: 12, rowHeight: ROW_HEIGHT, margin: [MARGIN, MARGIN] }}
              dragConfig={{ enabled: editing, handle: '.card-drag', cancel: '.no-drag' }}
              resizeConfig={{ enabled: editing }}
              compactor={verticalCompactor}
              onLayoutChange={(l) => editing && onLayout(l)}
            >
              {tabCards.map((c) => (
                <div key={c.key}>{renderCard(c)}</div>
              ))}
            </ReactGridLayout>
          )
        )}
      </Box>

      <PrintStyles />

      {/* dialogs */}
      <AddQuestionDialog
        isOpen={addQuestion.isOpen}
        onClose={addQuestion.onClose}
        onAdd={(q) =>
          void act(t('Could not add the question'), async () => {
            // its parameters and tables are needed to connect filters before the dashboard is saved
            const full = (await http.get<SavedQuestion>(`/api/questions/${q.id}`)).data;
            addCard({ kind: 'question', question_id: q.id, question: cardQuestion(full) });
          })
        }
      />
      <CardDialog
        card={editingCard}
        onClose={() => setEditingCard(null)}
        onSave={(c) => (c.key ? replaceCard(c) : addCard({ kind: c.kind, text: c.text, title: c.title }))}
      />
      <FiltersDialog
        isOpen={filtersDialog.isOpen}
        onClose={filtersDialog.onClose}
        filters={def.filters}
        cards={def.cards}
        onSave={(filters, cards) => change((d) => ({ ...d, filters, cards }))}
      />
      {details.isOpen && <DetailsDialog dashboard={dashboard} onClose={details.onClose} />}
      <SubscriptionsDrawer
        isOpen={subsOpen}
        onClose={() => setSubsOpen(false)}
        target={{ type: 'dashboard', id: dashboard.id, name: dashboard.name, filters: dashboard.filters }}
      />
      {share.isOpen && (
        <ShareDialog
          isOpen
          onClose={share.onClose}
          target={{ type: 'dashboard', id: dashboard.id, name: dashboard.name, params: dashboard.filters.map((f) => ({ name: f.id, label: f.label })) }}
        />
      )}
      <MoveDialog
        isOpen={move.isOpen}
        onClose={move.onClose}
        title={t('Move “{name}”', { name: dashboard.name })}
        current={dashboard.collection_id}
        onMove={(target) => dashboards.update(dashboard.id, { collection_id: target as number })}
      />
    </Box>
  );
}

/** What the server says about a question on a card (dashboard_routes._question_info). */
function cardQuestion(q: SavedQuestion): DashCard['question'] {
  const spec = q.spec as {
    source?: { table?: string; alias?: string };
    joins?: { table?: string; alias?: string }[];
    result_columns?: { name: string; type: string }[];
  };
  const tables = q.kind === 'builder' ? [spec.source, ...(spec.joins ?? [])].map((t) => t?.alias || t?.table).filter((t): t is string => !!t) : [];
  const fields = q.kind === 'federated' ? spec.result_columns ?? [] : [];
  return {
    state: q.archived ? 'archived' : 'ok', id: q.id, name: q.name, kind: q.kind, connection: q.connection,
    parameters: q.parameters, viz: q.viz, tables, fields,
  };
}

function DetailsDialog({ dashboard, onClose }: { dashboard: Dashboard; onClose: () => void }) {
  const [name, setName] = useState(dashboard.name);
  const [description, setDescription] = useState(dashboard.description ?? '');
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title={t('Rename / describe')}
      submitLabel={t('Save')}
      canSubmit={name.trim() !== ''}
      onSubmit={() => dashboards.update(dashboard.id, { name: name.trim(), description: description.trim() || null })}
    >
      <FormControl isRequired>
        <FormLabel fontSize="sm">{t('Name')}</FormLabel>
        <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
      </FormControl>
      <FormControl>
        <FormLabel fontSize="sm">{t('Description')}</FormLabel>
        <Textarea size="sm" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
      </FormControl>
    </DialogShell>
  );
}

/** Print / "save as PDF": only the dashboard, cards not cut in half. */
function PrintStyles() {
  return (
    <style>{`
      .dash-grid.editing .react-grid-item { transition: none; }
      .dash-grid .react-grid-item.react-grid-placeholder { background: rgba(99,102,241,0.25); border-radius: 12px; }
      @media print {
        [data-print-hide], .no-print { display: none !important; }
        html, body { background: #fff !important; }
        .dash-card { break-inside: avoid; }
        @page { margin: 12mm; }
      }
    `}</style>
  );
}

