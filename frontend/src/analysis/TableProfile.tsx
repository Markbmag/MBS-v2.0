import { Alert, AlertIcon, Box, Button, Flex, Skeleton, Text } from '@chakra-ui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage } from '../api';
import { t } from '../i18n/index.ts';
import { RefreshIcon } from '../icons';
import { semantic } from '../semantic/api';
import { useWorkspace } from '../workspace/useWorkspace';
import { runAnalysis } from './api';
import { ProfileView } from './ProfileView';

/** Browse → Profile: a sample of the table, column by column. */
export function TableProfile({ connection, table }: { connection: string; table: string }) {
  const ws = useWorkspace();
  const client = useQueryClient();
  const key = ['profile', 'table', connection, table];
  const profile = useQuery({
    queryKey: key,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: ({ signal }) => runAnalysis('/api/profile/table', { connection, table }, signal),
  });
  const again = () => {
    void client.fetchQuery({ queryKey: key, queryFn: ({ signal }) => runAnalysis('/api/profile/table', { connection, table, refresh: true }, signal) });
  };
  return (
    <Box bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" p={4}>
      <Flex justify="space-between" align="center" mb={3} gap={3}>
        <Text fontSize="sm" color="mutedText">
          {t('Reads the first rows of the table (at most a few ten thousand) and counts all rows. Nothing is changed in the database.')}
        </Text>
        <Button size="xs" variant="subtle" leftIcon={<RefreshIcon boxSize={3} />} onClick={again} isLoading={profile.isFetching}>
          {t('Again')}
        </Button>
      </Flex>
      {profile.isPending && <Skeleton h="300px" borderRadius="xl" />}
      {profile.isError && (
        <Alert status="error" borderRadius="xl" fontSize="sm">
          <AlertIcon />
          {apiErrorMessage(profile.error, t('Could not profile the table'))}
        </Alert>
      )}
      {profile.data && (
        <ProfileView
          profile={profile.data.profile}
          onParseAsDate={
            ws.isAdmin
              ? async (column) => {
                  await semantic.setField(connection, table, column, { parse_as_date: true });
                  again();
                }
              : undefined
          }
        />
      )}
    </Box>
  );
}
