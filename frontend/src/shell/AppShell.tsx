import { Suspense } from 'react';
import { Box, Flex, HStack, IconButton, Skeleton, VStack } from '@chakra-ui/react';
import { Outlet, useLocation } from 'react-router-dom';
import { ColorModeButton, Logo, NavLinks, Sidebar } from '../components/Sidebar';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { LogOutIcon } from '../icons';
import { useWorkspace } from '../workspace/useWorkspace';
import { t } from '../i18n/index.ts';

function PageFallback() {
  return (
    <VStack align="stretch" spacing={4}>
      <Skeleton h="120px" borderRadius="2xl" />
      <Skeleton h="280px" borderRadius="2xl" />
    </VStack>
  );
}

/** Sidebar (sections + databases) around the current page. */
// Work surfaces that use the whole window (editor + results side by side).
const WIDE_PAGES = [/^\/questions(\/\d+)?$/, /^\/sql$/, /^\/combine$/];

export default function AppShell() {
  const ws = useWorkspace();
  const path = useLocation().pathname;
  const wide = WIDE_PAGES.some((re) => re.test(path));
  const fullWidth = wide || /^\/dashboards\/\d+$/.test(path); // dashboards use the whole width but scroll
  return (
    <Flex minH="100vh" align="flex-start">
      <Box display="contents" data-print-hide>
        <Sidebar
          connections={ws.connections}
          activeKey={ws.activeKey}
          onSelect={ws.selectConnection}
          isAdmin={ws.isAdmin}
          onAdd={ws.openAddConnection}
          onEdit={ws.openEditConnection}
          user={ws.user}
          onLogout={ws.onLogout}
        />
      </Box>

      <Box flex={1} minW={0}>
        <Box display={{ base: 'block', md: 'none' }} bg="sidebarBg" borderBottom="1px solid" borderColor="lineColor" data-print-hide>
          <Flex align="center" justify="space-between" px={4} py={3}>
            <Logo />
            <HStack>
              <LanguageSwitch />
              <ColorModeButton />
              <IconButton aria-label={t('Sign out')} size="sm" icon={<LogOutIcon boxSize={4} />} onClick={ws.onLogout} />
            </HStack>
          </Flex>
          <Box px={2} pb={2}>
            <NavLinks isAdmin={ws.isAdmin} compact />
          </Box>
        </Box>

        <Box
          maxW={fullWidth ? 'none' : '1180px'}
          mx="auto"
          px={wide ? { base: 3, md: 4 } : fullWidth ? { base: 3, md: 6 } : { base: 4, md: 8 }}
          py={wide ? 3 : { base: 5, md: 8 }}
          h={wide ? { base: 'auto', md: '100vh' } : undefined}
        >
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </Box>
      </Box>
    </Flex>
  );
}
