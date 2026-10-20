import { useContext, useMemo, useRef, useState } from 'react';
import {
  Badge, Box, Button, Flex, HStack, IconButton, Menu, MenuButton, MenuDivider, MenuItem, MenuList, Spinner, Text, Tooltip, useColorMode, useToast,
} from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import { apiErrorMessageAsync, http } from '../api';
import { Visualization } from '../components/viz/Visualization';
import type { EChartHandle } from '../components/viz/EChart';
import { AlertIcon, ChartIcon, CodeIcon, DownloadIcon, MoreIcon, PencilIcon, RefreshIcon, TableIcon, XIcon } from '../icons';
import { buildCsvFromArrays, downloadText, safeFilename, saveBlob } from '../lib/csv';
import { chartTheme } from '../viz/palette';
import { DEFAULT_VIZ, effectiveViz } from '../viz/state';
import type { VizSpec } from '../viz/types';
import { CardEndpointsContext, useCardRun } from './api';
import { activeMappings, editorParams } from './logic';
import type { FilterValues } from './logic';
import { Markdown } from './Markdown';
import type { DashCard, DashFilter } from './types';
import { t, tn } from '../i18n/index.ts';

interface Props {
  dashboardId: number;
  card: DashCard;
  filters: DashFilter[];
  values: FilterValues;
  runValuesJson: string;
  /** false while a card added in edit mode is not saved yet: it runs its question without filters */
  saved: boolean;
  trigger: number;
  refresh: boolean;
  editing: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onChange?: (card: DashCard) => void;
}

const DRAG = 'card-drag';

/** One card of a dashboard: a question (run with the dashboard's filters), text or a heading. */
export function DashboardCard(props: Props) {
  const { card, editing } = props;
  if (card.kind === 'heading')
    return (
      <Frame editing={editing} onEdit={props.onEdit} onRemove={props.onRemove} plain>
        <Text fontSize="xl" fontWeight={700} noOfLines={1} data-testid="heading-card">
          {card.text || t('Heading')}
        </Text>
      </Frame>
    );
  if (card.kind === 'text')
    return (
      <Frame editing={editing} onEdit={props.onEdit} onRemove={props.onRemove} title={card.title ?? undefined}>
        <Box px={4} py={3} overflowY="auto" h="100%" data-testid="text-card">
          <Markdown source={card.text ?? ''} />
        </Box>
      </Frame>
    );
  return <QuestionCard {...props} />;
}

function Frame({
  title, editing, onEdit, onRemove, menu, status, children, plain = false, testId,
}: {
  title?: string;
  editing: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  menu?: React.ReactNode;
  status?: React.ReactNode;
  children: React.ReactNode;
  plain?: boolean;
  testId?: string;
}) {
  return (
    <Flex
      direction="column"
      h="100%"
      bg={plain && !editing ? 'transparent' : 'panelBg'}
      border="1px solid"
      borderColor={plain && !editing ? 'transparent' : 'lineColor'}
      borderRadius="xl"
      overflow="hidden"
      className="dash-card"
      data-testid={testId ?? 'dash-card'}
    >
      {(title !== undefined || editing || menu) && (
        <Flex align="center" gap={2} px={3} py={1.5} minH="36px" className={editing ? DRAG : undefined} cursor={editing ? 'grab' : undefined} borderBottom={title !== undefined ? '1px solid' : undefined} borderColor="lineColor">
          <Text fontSize="sm" fontWeight={600} noOfLines={1} flex={1} title={title}>
            {title}
          </Text>
          {status}
          {editing ? (
            <HStack spacing={0} className="no-drag">
              {onEdit && <IconButton aria-label={t('Card settings')} size="xs" variant="ghost" icon={<PencilIcon boxSize={3} />} onClick={onEdit} data-testid="card-edit" />}
              {onRemove && <IconButton aria-label={t('Remove card')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={onRemove} data-testid="card-remove" />}
            </HStack>
          ) : (
            menu
          )}
        </Flex>
      )}
      <Box flex={1} minH={0} display={plain ? 'flex' : undefined} alignItems={plain ? 'center' : undefined} px={plain ? 1 : 0}>
        {children}
      </Box>
    </Flex>
  );
}

function Message({ children, tone = 'muted', action }: { children: React.ReactNode; tone?: 'muted' | 'error'; action?: React.ReactNode }) {
  return (
    <Flex h="100%" direction="column" align="center" justify="center" gap={2} p={4} textAlign="center">
      {tone === 'error' && <AlertIcon boxSize={5} color="red.400" />}
      <Text fontSize="sm" color={tone === 'error' ? 'red.400' : 'mutedText'} noOfLines={4}>
        {children}
      </Text>
      {action}
    </Flex>
  );
}

function QuestionCard({ dashboardId, card, filters, values, runValuesJson, saved, trigger, refresh, editing, onEdit, onRemove, onChange }: Props) {
  const q = card.question;
  const runnable = !!q && (q.state === 'ok' || q.state === 'archived');
  const [retry, setRetry] = useState(0);
  const endpoints = useContext(CardEndpointsContext); // public links and embeds run elsewhere
  const url = endpoints ? endpoints.run(card) : saved ? `/api/dashboards/${dashboardId}/cards/${card.key}/run` : `/api/questions/${card.question_id}/run`;
  const request = saved || endpoints ? `{"filters":${runValuesJson}}` : '{"params":{}}';
  const tasks = endpoints?.tasks ?? '/api/query';
  const headersJson = JSON.stringify(endpoints?.headers ?? {});
  const run = useCardRun(url, request, trigger + retry, refresh || retry > 0, runnable, tasks, headersJson);
  const canDownload = !endpoints || endpoints.download;
  const navigate = useNavigate();
  const toast = useToast();
  const { colorMode } = useColorMode();
  const chartRef = useRef<EChartHandle | null>(null);
  const vizState = card.viz ?? q?.viz ?? DEFAULT_VIZ;
  const result = run.result;
  const spec: VizSpec | null = useMemo(() => {
    if (!result) return null;
    if (vizState.mode === 'table') return { version: 1, type: 'table' };
    return effectiveViz(vizState, result).spec;
  }, [result, vizState]);
  const title = card.title || q?.name || (q?.state === 'hidden' ? t('Not shared with you') : t('Question'));
  const name = safeFilename(title);
  const filtering = activeMappings(card, filters, values);

  const exportXlsx = async () => {
    if (!run.taskId) return;
    try {
      const res = await http.get<Blob>(`${tasks}/tasks/${run.taskId}/export.xlsx`, { responseType: 'blob', headers: endpoints?.headers });
      saveBlob(`${name}.xlsx`, res.data);
    } catch (error) {
      toast({ status: 'error', title: t('Excel export failed'), description: await apiErrorMessageAsync(error, t('Refresh the card and retry')) });
    }
  };
  const exportPng = () => {
    const url = chartRef.current?.png(chartTheme(colorMode === 'dark' ? 'dark' : 'light').surface);
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.png`;
    link.click();
  };
  const openInEditor = () => {
    if (!q?.id) return;
    const params = editorParams(card, filters, values).toString();
    navigate(`/questions/${q.id}${params ? `?${params}` : ''}`);
  };

  const busy = run.status === 'queued' || run.status === 'running';
  const status = (
    <HStack spacing={1.5}>
      {filtering.length > 0 && (
        <Tooltip label={t('Filtered by {filters}', { filters: filtering.map((f) => f.label).join(', ') })} hasArrow>
          <Badge fontSize="2xs" colorScheme="purple" variant="subtle">
            {tn(filtering.length, '{n} filter', '{n} filters')}
          </Badge>
        </Tooltip>
      )}
      {q?.state === 'archived' && <Badge fontSize="2xs">{t('archived')}</Badge>}
      {busy && result && <Spinner size="xs" color="faintText" />}
    </HStack>
  );
  const menu = runnable ? (
    <Menu isLazy placement="bottom-end">
      <MenuButton as={IconButton} aria-label={t('Actions for {name}', { name: title })} size="xs" variant="ghost" icon={<MoreIcon boxSize={4} />} className="no-print" data-testid="card-menu" />
      <MenuList fontSize="sm">
        <MenuItem icon={<RefreshIcon boxSize={4} />} onClick={() => setRetry((n) => n + 1)}>
          {t('Refresh')}
        </MenuItem>
        {!endpoints && (
          <MenuItem icon={<CodeIcon boxSize={4} />} onClick={openInEditor} data-testid="card-open">
            {t('Open in editor')}
          </MenuItem>
        )}
        <MenuDivider />
        {canDownload && (
          <>
            <MenuItem icon={<DownloadIcon boxSize={4} />} isDisabled={!result} onClick={() => result && downloadText(`${name}.csv`, buildCsvFromArrays(result.columns.map((c) => c.name), result.rows, ';'))}>
              {t('CSV (for Excel)')}
            </MenuItem>
            <MenuItem icon={<DownloadIcon boxSize={4} />} isDisabled={!run.taskId || !result} onClick={() => void exportXlsx()}>
              {t('Excel workbook')}
            </MenuItem>
          </>
        )}
        {spec && !['table', 'kpi', 'pivot'].includes(spec.type) && (
          <MenuItem icon={<DownloadIcon boxSize={4} />} onClick={exportPng}>
            {t('Chart as PNG')}
          </MenuItem>
        )}
      </MenuList>
    </Menu>
  ) : null;

  let body: React.ReactNode;
  if (!q || q.state === 'hidden') body = <Message>{t('This question is not shared with you.')}</Message>;
  else if (q.state === 'deleted') body = <Message>{t('The question on this card was deleted.')}</Message>;
  else if (run.status === 'error')
    body = (
      <Message tone="error" action={<Button size="xs" variant="subtle" onClick={() => setRetry((n) => n + 1)}>{t('Try again')}</Button>}>
        {run.error}
      </Message>
    );
  else if (!result || !spec)
    body = (
      <Flex h="100%" align="center" justify="center" gap={2} color="mutedText" fontSize="sm">
        <Spinner size="sm" /> {run.status === 'queued' ? t('Waiting…') : t('Loading…')}
      </Flex>
    );
  else body = <Visualization result={result} viz={spec} chartRef={chartRef} />;

  const flipViz = () => onChange?.({ ...card, viz: { mode: vizState.mode === 'table' ? 'chart' : 'table', spec: vizState.spec } });

  return (
    <Frame
      title={title}
      editing={editing}
      onEdit={onEdit}
      onRemove={onRemove}
      menu={menu}
      status={
        editing && runnable ? (
          <HStack spacing={1}>
            <Tooltip label={vizState.mode === 'table' ? t('Show as chart') : t('Show as table')} hasArrow>
              <IconButton aria-label={t('Table or chart')} size="xs" variant="ghost" className="no-drag" icon={vizState.mode === 'table' ? <ChartIcon boxSize={3} /> : <TableIcon boxSize={3} />} onClick={flipViz} />
            </Tooltip>
          </HStack>
        ) : (
          status
        )
      }
      testId="question-card"
    >
      <Box h="100%" pointerEvents={editing ? 'none' : undefined}>
        {body}
      </Box>
    </Frame>
  );
}
