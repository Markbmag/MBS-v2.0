import type { ReactNode } from 'react';
import { Box, Button, Flex, Heading, SimpleGrid, Text, VStack } from '@chakra-ui/react';
import { DatabaseIcon, PlusIcon, SearchIcon, SparklesIcon, TableIcon } from '../icons';
import { t } from '../i18n/index.ts';

interface FrameProps {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

function Frame({ icon, title, children, action }: FrameProps) {
  return (
    <Flex
      direction="column"
      align="center"
      textAlign="center"
      bg="panelBg"
      border="1px dashed"
      borderColor="lineColor"
      borderRadius="2xl"
      px={6}
      py={{ base: 10, md: 14 }}
      gap={4}
    >
      <Flex
        w="64px"
        h="64px"
        align="center"
        justify="center"
        borderRadius="2xl"
        color="brand.300"
        bgGradient="linear(to-br, rgba(99,102,241,0.22), rgba(99,102,241,0.06))"
        border="1px solid"
        borderColor="rgba(99,102,241,0.35)"
      >
        {icon}
      </Flex>
      <Heading as="h2" fontSize="xl" fontWeight={650}>
        {title}
      </Heading>
      <Box color="mutedText" maxW="480px" fontSize="sm" lineHeight="tall">
        {children}
      </Box>
      {action}
    </Flex>
  );
}

interface NoConnectionsProps {
  isAdmin: boolean;
  onAdd: () => void;
}

export function NoConnectionsState({ isAdmin, onAdd }: NoConnectionsProps) {
  return (
    <Frame
      icon={<DatabaseIcon boxSize={7} />}
      title={isAdmin ? t('Connect your first database') : t('No databases available yet')}
      action={
        isAdmin ? (
          <Button leftIcon={<PlusIcon />} onClick={onAdd} size="lg">
            {t('Add a database')}
          </Button>
        ) : undefined
      }
    >
      {isAdmin
        ? t('Pick MySQL, PostgreSQL, SQL Server, MariaDB or SQLite, enter the connection details and start searching in under a minute. No code needed.')
        : t('Ask an administrator to connect a database or to give you access to an existing one.')}
    </Frame>
  );
}

interface ReadyProps {
  connectionLabel: string;
  scopeLabel: string;
}

export function ReadyState({ connectionLabel, scopeLabel }: ReadyProps) {
  const tips = [
    {
      icon: <SearchIcon boxSize={4} />,
      title: t('Search everywhere at once'),
      text: t('Every text column of every table is checked. Names, codes, VINs, emails — just type it.'),
    },
    {
      icon: <TableIcon boxSize={4} />,
      title: t('Narrow it down'),
      text: t('Currently searching: {scope}. Use the scope button to pick tables or skip noisy ones.', { scope: scopeLabel }),
    },
    {
      icon: <SparklesIcon boxSize={4} />,
      title: t('Export what you find'),
      text: t('Download any result table as CSV that opens correctly in Excel.'),
    },
  ];
  return (
    <Frame icon={<SearchIcon boxSize={7} />} title={t('Find anything in {name}', { name: connectionLabel })}>
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} mt={2} textAlign="left" w="100%" maxW="860px">
        {tips.map((tip) => (
          <VStack
            key={tip.title}
            align="flex-start"
            spacing={2}
            bg="chipBg"
            borderRadius="xl"
            p={4}
            border="1px solid"
            borderColor="lineColor"
          >
            <Flex color="brand.300" align="center" gap={2} fontWeight={600} fontSize="sm">
              {tip.icon}
              <Text as="span" color="bodyText">
                {tip.title}
              </Text>
            </Flex>
            <Text fontSize="sm" color="mutedText">
              {tip.text}
            </Text>
          </VStack>
        ))}
      </SimpleGrid>
    </Frame>
  );
}

interface NoResultsProps {
  phrase: string;
  matchMode: string;
  caseSensitive: boolean;
  includeNumbers: boolean;
  tablesSearched: number;
}

export function NoResultsState({ phrase, matchMode, caseSensitive, includeNumbers, tablesSearched }: NoResultsProps) {
  const ideas: string[] = [];
  if (matchMode !== 'contains') ideas.push(t('Switch the match to “Contains”.'));
  if (caseSensitive) ideas.push(t('Turn off “Match case”.'));
  if (!includeNumbers) ideas.push(t('Turn on “Numbers & dates” if you are looking for a number.'));
  ideas.push(t('Check that the right tables are selected in the scope.'));
  ideas.push(t('Try a shorter part of the phrase.'));
  return (
    <Frame icon={<SearchIcon boxSize={7} />} title={t('Nothing found for “{phrase}”', { phrase })}>
      <Text mb={3}>
        {tablesSearched > 0 ? t('{n} tables were searched.', { n: tablesSearched }) : t('No table had searchable columns.')} {t('Things to try:')}
      </Text>
      <VStack align="flex-start" spacing={1} display="inline-flex" textAlign="left">
        {ideas.map((idea) => (
          <Text key={idea}>• {idea}</Text>
        ))}
      </VStack>
    </Frame>
  );
}
