import { useMemo, useState } from 'react';
import {
  Alert, AlertIcon, Box, Button, Collapse, Flex, Grid, HStack, Skeleton, Spinner, Text, VStack, useBreakpointValue, useToast,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { runAnalysis } from '../analysis/api';
import { ProfileView } from '../analysis/ProfileView';
import type { XrayCard } from '../analysis/types';
import { PageHeader } from '../components/PageHeader';
import { Visualization } from '../components/viz/Visualization';
import { dashboards, useCardRun } from '../dashboards/api';
import { t } from '../i18n/index.ts';
import { LayoutIcon, SparklesIcon } from '../icons';
import { library, useCollections } from '../library/api';
import { effectiveViz } from '../viz/state';

const ROW_PX = 40;

/** /xray?connection=&table= or /xray?question=ID: a first dashboard, made from the data's profile. */
export default function XrayPage() {
  const [search] = useSearchParams();
  const connection = search.get('connection');
  const table = search.get('table');
  const question = Number(search.get('question')) || null;
  const body = question ? { question_id: question } : { connection, table };
  const xray = useQuery({
    queryKey: ['xray', body],
    staleTime: 5 * 60_000,
    retry: false,
    enabled: !!question || (!!connection && !!table),
    queryFn: ({ signal }) => runAnalysis('/api/xray', body, signal),
  });
  const [showProfile, setShowProfile] = useState(false);
  const wide = useBreakpointValue({ base: false, md: true }) ?? true;
  const toast = useToast();
  const navigate = useNavigate();
  const { data: cols } = useCollections();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!xray.data?.cards || cols?.personal_id === undefined) return;
    setSaving(true);
    try {
      const collection = cols.personal_id;
      const board = await dashboards.create({ name: t('X-ray: {title}', { title: xray.data.title }), description: t('Made by X-ray'), collection_id: collection });
      const cards = [];
      for (const c of xray.data.cards) {
        const q = await library.createQuestion({ name: c.title, kind: 'builder', spec: c.spec, viz: c.viz, parameters: [], collection_id: collection });
        cards.push({ key: c.key.slice(0, 40), kind: 'question' as const, question_id: q.id, layout: c.layout });
      }
      await dashboards.save(board.id, { filters: [], tabs: [], cards, settings: {} });
      toast({ status: 'success', title: t('Saved as a dashboard'), description: t('The cards are saved questions in your collection.'), duration: 3000 });
      navigate(`/dashboards/${board.id}`);
    } catch (e) {
      toast({ status: 'error', title: t('Could not save'), description: apiErrorMessage(e, t('Please try again')), duration: 6000 });
    } finally {
      setSaving(false);
    }
  };

  if (!question && !(connection && table))
    return (
      <Alert status="info" borderRadius="xl">
        <AlertIcon />
        {t('Open X-ray from a table (Browse → X-ray) or from a saved question (⋯ → X-ray).')}
      </Alert>
    );

  return (
    <VStack align="stretch" spacing={4}>
      <PageHeader
        title={xray.data ? t('X-ray: {title}', { title: xray.data.title }) : t('X-ray')}
        subtitle={t('A first look, made automatically from what is in the data. Save it to keep and change it.')}
        actions={
          <HStack>
            <Button size="sm" variant="subtle" onClick={() => setShowProfile((v) => !v)} isDisabled={!xray.data}>
              {showProfile ? t('Hide the profile') : t('Show the profile')}
            </Button>
            <Button size="sm" variant="brand" leftIcon={<LayoutIcon boxSize={4} />} onClick={() => void save()} isLoading={saving} isDisabled={!xray.data?.cards?.length} data-testid="xray-save">
              {t('Save as dashboard')}
            </Button>
          </HStack>
        }
      />
      {xray.isPending && (
        <Flex align="center" gap={3} color="mutedText" fontSize="sm">
          <Spinner size="sm" /> {t('Reading a sample and looking at every column…')}
        </Flex>
      )}
      {xray.isError && (
        <Alert status="error" borderRadius="xl">
          <AlertIcon />
          {apiErrorMessage(xray.error, t('The X-ray did not work'))}
        </Alert>
      )}
      {xray.data && (
        <>
          <Collapse in={showProfile} animateOpacity>
            <Box bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" p={4}>
              <ProfileView profile={xray.data.profile} />
            </Box>
          </Collapse>
          {question && (
            <Text fontSize="xs" color="mutedText">
              {t('Over the table(s) of')} <RouterLink to={`/questions/${question}`}>{t('the question')}</RouterLink>{t(', with its filters.')}
            </Text>
          )}
          <Grid templateColumns={wide ? 'repeat(12, 1fr)' : '1fr'} autoRows={`${ROW_PX}px`} gap={3} data-testid="xray-grid">
            {(xray.data.cards ?? []).map((c) => (
              <Box
                key={c.key}
                gridColumn={wide ? `${c.layout.x + 1} / span ${c.layout.w}` : undefined}
                gridRow={wide ? `${c.layout.y + 1} / span ${c.layout.h}` : `span ${c.layout.h}`}
                minW={0}
              >
                <XrayCardView card={c} />
              </Box>
            ))}
          </Grid>
          {(xray.data.cards ?? []).length <= 1 && (
            <Text fontSize="sm" color="mutedText">
              <SparklesIcon boxSize={3.5} /> {t('Not much to show: the table has few rows or no dates, numbers or categories.')}
            </Text>
          )}
        </>
      )}
      {!xray.data && !xray.isPending && !xray.isError && <Skeleton h="200px" />}
    </VStack>
  );
}

function XrayCardView({ card }: { card: XrayCard }) {
  const body = useMemo(() => JSON.stringify({ spec: card.spec }), [card.spec]);
  const run = useCardRun('/api/query', body, 0, false, true);
  const spec = useMemo(() => (run.result ? effectiveViz(card.viz, run.result).spec : null), [run.result, card.viz]);
  return (
    <Flex direction="column" h="100%" bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden" data-testid="xray-card">
      <Text fontSize="sm" fontWeight={700} px={3} pt={2.5} pb={1} noOfLines={1}>
        {card.title}
      </Text>
      <Box flex={1} minH={0} px={1}>
        {run.status === 'error' ? (
          <Text fontSize="sm" color="red.400" p={3}>
            {run.error}
          </Text>
        ) : run.result && spec ? (
          <Visualization result={run.result} viz={spec} />
        ) : (
          <Flex h="100%" align="center" justify="center">
            <Spinner size="sm" color="faintText" />
          </Flex>
        )}
      </Box>
    </Flex>
  );
}
