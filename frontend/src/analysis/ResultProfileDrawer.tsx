import { Alert, AlertIcon, Drawer, DrawerBody, DrawerCloseButton, DrawerContent, DrawerHeader, DrawerOverlay, Skeleton } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { apiErrorMessage, http } from '../api';
import { t } from '../i18n/index.ts';
import { ProfileView } from './ProfileView';
import type { Profile } from './types';

/** The profile of the rows on screen (no new query: the server profiles the finished result). */
export function ResultProfileDrawer({ taskId, isOpen, onClose }: { taskId: string | null; isOpen: boolean; onClose: () => void }) {
  const profile = useQuery({
    queryKey: ['profile', 'task', taskId],
    enabled: isOpen && !!taskId,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => (await http.post<Profile>(`/api/query/tasks/${taskId}/profile`)).data,
  });
  return (
    <Drawer isOpen={isOpen} onClose={onClose} size="xl" placement="right">
      <DrawerOverlay />
      <DrawerContent bg="appBg">
        <DrawerCloseButton />
        <DrawerHeader fontSize="md">{t('Profile of this result')}</DrawerHeader>
        <DrawerBody pb={6}>
          {profile.isPending && <Skeleton h="300px" borderRadius="xl" />}
          {profile.isError && (
            <Alert status="warning" borderRadius="xl" fontSize="sm">
              <AlertIcon />
              {apiErrorMessage(profile.error, t('Run the question again, then profile it'))}
            </Alert>
          )}
          {profile.data && <ProfileView profile={profile.data} />}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
