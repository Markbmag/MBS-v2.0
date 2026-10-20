import { Box, SimpleGrid, Text, VStack } from '@chakra-ui/react';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Visualization } from '../components/viz/Visualization';
import { FIXTURES } from '../viz/fixtures';
import { useWorkspace } from '../workspace/useWorkspace';
import { t } from '../i18n/index.ts';

/** Every chart type drawn from sample data: a quick visual check of charts in the current theme. */
export default function ChartGalleryPage() {
  const ws = useWorkspace();
  if (!ws.isAdmin) return <Navigate to="/" replace />;
  return (
    <VStack align="stretch" spacing={6}>
      <PageHeader title={t('Chart gallery')} subtitle={t('Every chart type with sample data. Switch the theme to check light and dark.')} />
      <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={4}>
        {FIXTURES.map((f) => (
          <Box key={f.name} bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden" data-testid="gallery-card">
            <Text px={4} pt={3} fontSize="sm" fontWeight={700}>
              {f.name}
            </Text>
            <Box h="300px">
              <Visualization result={f.table} viz={f.viz} />
            </Box>
          </Box>
        ))}
      </SimpleGrid>
    </VStack>
  );
}
