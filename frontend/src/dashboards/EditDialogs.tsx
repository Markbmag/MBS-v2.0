import { useMemo, useState } from 'react';
import {
  Badge, Box, Checkbox, Flex, FormControl, FormHelperText, FormLabel, HStack, IconButton, Input, InputGroup, InputLeftElement,
  Select, Skeleton, Text, Textarea, VStack,
} from '@chakra-ui/react';
import { ChartIcon, CodeIcon, LinkIcon, SearchIcon, XIcon } from '../icons';
import { useQuestions } from '../library/api';
import type { QuestionSummary } from '../library/api';
import { DialogShell } from '../library/dialogs';
import { humanize } from '../query/draft';
import { useSchema } from '../query/useSchema';
import { filterId, fittingParams, suggestMapping } from './logic';
import { Markdown } from './Markdown';
import { FILTER_TYPES } from './types';
import type { DashCard, DashFilter, FilterType, Mapping } from './types';
import { t } from '../i18n/index.ts';

// ---------------------------------------------------------------- add a question

export function AddQuestionDialog({ isOpen, onClose, onAdd }: { isOpen: boolean; onClose: () => void; onAdd: (q: QuestionSummary) => void }) {
  return isOpen ? <AddQuestionForm onClose={onClose} onAdd={onAdd} /> : null;
}

function AddQuestionForm({ onClose, onAdd }: { onClose: () => void; onAdd: (q: QuestionSummary) => void }) {
  const [text, setText] = useState('');
  const found = useQuestions({ q: text.trim() || undefined, limit: 50 });
  const [picked, setPicked] = useState<QuestionSummary | null>(null);
  return (
    <DialogShell isOpen onClose={onClose} title={t('Add a saved question')} submitLabel={t('Add')} size="lg" canSubmit={picked !== null} onSubmit={async () => picked && onAdd(picked)}>
      <InputGroup size="sm">
        <InputLeftElement pointerEvents="none">
          <SearchIcon boxSize={3.5} color="faintText" />
        </InputLeftElement>
        <Input placeholder={t('Find a question…')} value={text} onChange={(e) => setText(e.target.value)} autoFocus data-testid="add-question-search" />
      </InputGroup>
      <Box maxH="320px" overflowY="auto" border="1px solid" borderColor="lineColor" borderRadius="md">
        {found.isPending && <Skeleton h="80px" />}
        {found.data?.length === 0 && (
          <Text fontSize="sm" color="faintText" p={3}>
            {t('No saved questions found. Save a question first (New question → Save).')}
          </Text>
        )}
        {found.data?.map((q) => {
          const Icon = q.kind === 'sql' ? CodeIcon : q.kind === 'federated' ? LinkIcon : ChartIcon;
          const active = picked?.id === q.id;
          return (
            <Flex
              key={q.id}
              as="button"
              type="button"
              w="100%"
              textAlign="left"
              align="center"
              gap={3}
              px={3}
              py={2}
              bg={active ? 'rgba(99,102,241,0.14)' : undefined}
              _hover={{ bg: active ? undefined : 'panelHover' }}
              borderBottom="1px solid"
              borderColor="lineColor"
              onClick={() => setPicked(q)}
              onDoubleClick={() => {
                onAdd(q);
                onClose();
              }}
              data-testid="add-question-row"
            >
              <Icon boxSize={4} color="brand.400" />
              <Box flex={1} minW={0}>
                <Text fontSize="sm" fontWeight={600} noOfLines={1}>
                  {q.name}
                </Text>
                <Text fontSize="xs" color="mutedText" noOfLines={1}>
                  {q.collection?.name} · {q.connection}
                </Text>
              </Box>
            </Flex>
          );
        })}
      </Box>
    </DialogShell>
  );
}

// ---------------------------------------------------------------- text, heading, card title

export function CardDialog({ card, onClose, onSave }: { card: DashCard | null; onClose: () => void; onSave: (card: DashCard) => void }) {
  return card ? <CardForm card={card} onClose={onClose} onSave={onSave} /> : null;
}

function CardForm({ card, onClose, onSave }: { card: DashCard; onClose: () => void; onSave: (card: DashCard) => void }) {
  const [title, setTitle] = useState(card.title ?? '');
  const [text, setText] = useState(card.text ?? '');
  const isQuestion = card.kind === 'question';
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title={isQuestion ? t('Card title') : card.kind === 'heading' ? t('Heading') : t('Text card')}
      submitLabel={t('Apply')}
      size={card.kind === 'text' ? 'xl' : 'md'}
      onSubmit={async () => onSave({ ...card, title: title.trim() || null, text: isQuestion ? card.text : text })}
    >
      {card.kind !== 'heading' && (
        <FormControl>
          <FormLabel fontSize="sm">{t('Title')}</FormLabel>
          <Input size="sm" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={isQuestion ? card.question?.name ?? '' : t('optional')} autoFocus={isQuestion} />
          {isQuestion && <FormHelperText fontSize="xs">{t('Empty = the question’s name.')}</FormHelperText>}
        </FormControl>
      )}
      {card.kind === 'heading' && (
        <FormControl>
          <FormLabel fontSize="sm">{t('Heading')}</FormLabel>
          <Input size="sm" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} autoFocus data-testid="heading-text" />
        </FormControl>
      )}
      {card.kind === 'text' && (
        <HStack align="stretch" spacing={4}>
          <FormControl flex={1}>
            <FormLabel fontSize="sm">{t('Text')}</FormLabel>
            <Textarea size="sm" rows={10} value={text} onChange={(e) => setText(e.target.value)} maxLength={10000} fontFamily="mono" autoFocus data-testid="text-card-input" />
            <FormHelperText fontSize="xs">{t('# heading, **bold**, *italic*, `code`, - list, [link](https://…)')}</FormHelperText>
          </FormControl>
          <Box flex={1} border="1px solid" borderColor="lineColor" borderRadius="md" p={3} overflowY="auto" maxH="260px">
            <Markdown source={text} />
          </Box>
        </HStack>
      )}
    </DialogShell>
  );
}

// ---------------------------------------------------------------- filters and where they apply

interface FiltersDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filters: DashFilter[];
  cards: DashCard[];
  onSave: (filters: DashFilter[], cards: DashCard[]) => void;
}

export function FiltersDialog(props: FiltersDialogProps) {
  return props.isOpen ? <FiltersForm {...props} /> : null;
}

function FiltersForm({ onClose, filters: initialFilters, cards: initialCards, onSave }: FiltersDialogProps) {
  const [filters, setFilters] = useState<DashFilter[]>(initialFilters);
  const [cards, setCards] = useState<DashCard[]>(initialCards);
  const [selected, setSelected] = useState<string | null>(initialFilters[0]?.id ?? null);
  const current = filters.find((f) => f.id === selected) ?? null;
  const questionCards = cards.filter((c) => c.kind === 'question' && c.question && (c.question.state === 'ok' || c.question.state === 'archived'));

  const add = (type: FilterType) => {
    const label = FILTER_TYPES.find((ft) => ft.type === type)?.label ?? t('Filter');
    const f: DashFilter = { id: filterId(label, filters.map((x) => x.id)), label, type, default: null, required: false };
    setFilters([...filters, f]);
    setSelected(f.id);
    // map it where a parameter obviously fits
    setCards(cards.map((c) => {
      const m = suggestMapping(f, c.question);
      return m ? { ...c, mappings: { ...c.mappings, [f.id]: m } } : c;
    }));
  };
  const update = (patch: Partial<DashFilter>) => {
    if (!current) return;
    // a filter added in this dialog takes its id (used in links: ?f.status=...) from its label
    const fresh = !initialFilters.some((f) => f.id === current.id);
    const id = fresh && patch.label !== undefined ? filterId(patch.label, filters.filter((f) => f.id !== current.id).map((f) => f.id)) : current.id;
    setFilters(filters.map((f) => (f.id === current.id ? { ...f, ...patch, id } : f)));
    if (id !== current.id) {
      setCards(cards.map((c) => {
        if (!c.mappings?.[current.id]) return c;
        const rest = { ...c.mappings, [id]: c.mappings[current.id] };
        delete rest[current.id];
        return { ...c, mappings: rest };
      }));
      setSelected(id);
    }
  };
  const remove = (id: string) => {
    setFilters(filters.filter((f) => f.id !== id));
    setCards(cards.map((c) => {
      if (!c.mappings?.[id]) return c;
      const rest = { ...c.mappings };
      delete rest[id];
      return { ...c, mappings: rest };
    }));
    setSelected(filters.find((f) => f.id !== id)?.id ?? null);
  };
  const setMapping = (key: string, mapping: Mapping | null) =>
    current &&
    setCards(cards.map((c) => {
      if (c.key !== key) return c;
      const rest = { ...c.mappings };
      if (mapping) rest[current.id] = mapping;
      else delete rest[current.id];
      return { ...c, mappings: rest };
    }));

  return (
    <DialogShell isOpen onClose={onClose} title={t('Dashboard filters')} submitLabel={t('Apply')} size="4xl" onSubmit={async () => onSave(filters, cards)}>
      <Flex gap={5} direction={{ base: 'column', md: 'row' }} minH="320px">
        <VStack align="stretch" w={{ base: '100%', md: '220px' }} spacing={1}>
          {filters.map((f) => (
            <Flex
              key={f.id}
              as="button"
              type="button"
              align="center"
              justify="space-between"
              px={3}
              py={2}
              borderRadius="md"
              bg={f.id === selected ? 'rgba(99,102,241,0.14)' : undefined}
              _hover={{ bg: f.id === selected ? undefined : 'panelHover' }}
              onClick={() => setSelected(f.id)}
              data-testid="filter-item"
            >
              <Text fontSize="sm" fontWeight={600} noOfLines={1}>
                {f.label}
              </Text>
              <Badge fontSize="2xs">{cards.filter((c) => c.mappings?.[f.id]).length}</Badge>
            </Flex>
          ))}
          {filters.length === 0 && (
            <Text fontSize="sm" color="faintText" px={1}>
              {t('No filters yet.')}
            </Text>
          )}
          <Select size="sm" mt={2} placeholder={t('+ Add a filter…')} value="" onChange={(e) => e.target.value && add(e.target.value as FilterType)} aria-label={t('Add a filter')} data-testid="add-filter">
            {FILTER_TYPES.map((ft) => (
              <option key={ft.type} value={ft.type}>
                {ft.label}
              </option>
            ))}
          </Select>
        </VStack>

        <Box flex={1} minW={0}>
          {!current ? (
            <Text fontSize="sm" color="mutedText">
              {(() => {
                const [before, after] = t(
                  'A filter is set once at the top of the dashboard and changes every card it is connected to — through a question’s parameter ({param} in SQL, an asked-for filter in the builder) or, for questions built without SQL, directly on a column.',
                ).split('{param}');
                return (
                  <>
                    {before}
                    <code>{'{{name}}'}</code>
                    {after}
                  </>
                );
              })()}
            </Text>
          ) : (
            <VStack align="stretch" spacing={4}>
              <HStack align="flex-end" spacing={3} wrap="wrap">
                <FormControl w="200px">
                  <FormLabel fontSize="xs">{t('Label')}</FormLabel>
                  <Input size="sm" value={current.label} onChange={(e) => update({ label: e.target.value })} maxLength={120} data-testid="filter-label" />
                </FormControl>
                <FormControl w="160px">
                  <FormLabel fontSize="xs">{t('Type')}</FormLabel>
                  <Select size="sm" value={current.type} onChange={(e) => update({ type: e.target.value as FilterType, default: null })} aria-label={t('Filter type')}>
                    {FILTER_TYPES.map((ft) => (
                      <option key={ft.type} value={ft.type}>
                        {ft.label}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl w="230px">
                  <FormLabel fontSize="xs">{t('Default')}</FormLabel>
                  <DefaultInput filter={current} onChange={(d) => update({ default: d })} />
                </FormControl>
                <Checkbox size="sm" isChecked={!!current.required} onChange={(e) => update({ required: e.target.checked })} pb={2}>
                  <Text fontSize="xs">{t('Required')}</Text>
                </Checkbox>
                <IconButton aria-label={t('Remove filter')} size="sm" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => remove(current.id)} />
              </HStack>
              <Box>
                <Text fontSize="xs" fontWeight={700} color="faintText" textTransform="uppercase" letterSpacing="0.06em" mb={2}>
                  {t('Applies to')}
                </Text>
                {questionCards.length === 0 && (
                  <Text fontSize="sm" color="faintText">
                    {t('Add question cards first.')}
                  </Text>
                )}
                <VStack align="stretch" spacing={2}>
                  {questionCards.map((c) => (
                    <MappingRow key={c.key} card={c} filter={current} onChange={(m) => setMapping(c.key, m)} />
                  ))}
                </VStack>
              </Box>
            </VStack>
          )}
        </Box>
      </Flex>
    </DialogShell>
  );
}

function DefaultInput({ filter, onChange }: { filter: DashFilter; onChange: (value: unknown) => void }) {
  const d = filter.default;
  if (filter.type === 'date_range') {
    const pair = Array.isArray(d) ? (d as string[]) : ['', ''];
    return (
      <HStack spacing={1}>
        <Input size="sm" type="date" value={pair[0] ?? ''} onChange={(e) => onChange([e.target.value, pair[1] ?? ''])} aria-label={t('Default from')} />
        <Input size="sm" type="date" value={pair[1] ?? ''} onChange={(e) => onChange([pair[0] ?? '', e.target.value])} aria-label={t('Default to')} />
      </HStack>
    );
  }
  const text = Array.isArray(d) ? d.join(', ') : d === null || d === undefined ? '' : String(d);
  return (
    <Input
      size="sm"
      type={filter.type === 'date' ? 'date' : filter.type === 'number' ? 'number' : 'text'}
      value={text}
      placeholder={filter.type === 'category' ? 'a, b, c' : t('none')}
      onChange={(e) =>
        onChange(
          filter.type === 'category'
            ? e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : e.target.value,
        )
      }
      aria-label={t('Default value')}
    />
  );
}

function MappingRow({ card, filter, onChange }: { card: DashCard; filter: DashFilter; onChange: (m: Mapping | null) => void }) {
  const q = card.question!;
  const schema = useSchema(q.kind === 'builder' && q.connection ? q.connection : '');
  const params = fittingParams(filter.type, q);
  const columns = useMemo(() => {
    if (q.kind === 'federated') return (q.fields ?? []).filter((c) => c.type !== 'binary').map((c) => ({ ref: c.name, label: humanize(c.name) }));
    if (q.kind !== 'builder' || !schema.data) return [];
    const out: { ref: string; label: string }[] = [];
    const several = (q.tables ?? []).length > 1;
    for (const table of q.tables ?? []) {
      const tbl = schema.data.tables.find((x) => x.name === table);
      for (const col of tbl?.columns ?? []) {
        if (col.type === 'binary') continue;
        out.push({ ref: `${table}.${col.name}`, label: several ? `${humanize(table)} → ${humanize(col.name)}` : humanize(col.name) });
      }
    }
    return out;
  }, [q, schema.data]);
  const m = card.mappings?.[filter.id];
  const value = m?.param ? `param:${m.param}` : m?.field ? `field:${m.field}` : '';
  return (
    <Flex align="center" gap={3} border="1px solid" borderColor="lineColor" borderRadius="md" px={3} py={2} data-testid="mapping-row">
      <Text fontSize="sm" flex={1} noOfLines={1}>
        {card.title || q.name}
      </Text>
      <Select
        size="sm"
        maxW="280px"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v.startsWith('param:') ? { param: v.slice(6) } : v.startsWith('field:') ? { field: v.slice(6) } : null);
        }}
        aria-label={t('Connect {filter} to {card}', { filter: filter.label, card: card.title || q.name })}
      >
        <option value="">{t('Not connected')}</option>
        {params.length > 0 && (
          <optgroup label={t('Parameter')}>
            {params.map((p) => (
              <option key={p.name} value={`param:${p.name}`}>
                {p.label || p.name}
              </option>
            ))}
          </optgroup>
        )}
        {columns.length > 0 && (
          <optgroup label={t('Column')}>
            {columns.map((c) => (
              <option key={c.ref} value={`field:${c.ref}`}>
                {c.label}
              </option>
            ))}
          </optgroup>
        )}
        {m?.field && !columns.some((c) => c.ref === m.field) && <option value={value}>{m.field}</option>}
      </Select>
      {q.kind === 'sql' && params.length === 0 && (
        <Text fontSize="2xs" color="faintText" maxW="140px">
          {t('add a {param} of a fitting type to the SQL', { param: '{{parameter}}' })}
        </Text>
      )}
    </Flex>
  );
}

