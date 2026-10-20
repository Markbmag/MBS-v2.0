import { Box, Text, VStack } from '@chakra-ui/react';
import { PageHeader } from '../components/PageHeader';
import { SparklesIcon } from '../icons';
import { t } from '../i18n/index.ts';

interface ComingSoonProps {
  title: string;
  milestone: string;
  points: string[];
}

/** Placeholder for a section that a later roadmap milestone builds (docs/ROADMAP.md). */
export function ComingSoon({ title, milestone, points }: ComingSoonProps) {
  return (
    <VStack align="stretch" spacing={6}>
      <PageHeader title={title} subtitle={t('Arrives with milestone {milestone} of the roadmap.', { milestone })} />
      <Box bg="panelBg" border="1px dashed" borderColor="lineColor" borderRadius="2xl" p={{ base: 5, md: 8 }}>
        <VStack align="flex-start" spacing={3}>
          <SparklesIcon boxSize={6} color="brand.300" />
          <Text fontWeight={600}>{t('What it will do')}</Text>
          {points.map((point) => (
            <Text key={point} fontSize="sm" color="mutedText">
              • {point}
            </Text>
          ))}
        </VStack>
      </Box>
    </VStack>
  );
}
