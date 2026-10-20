import type { ReactNode } from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

export function Panel({ title, children, actions, subtitle }: { title: string; children: ReactNode; actions?: ReactNode; subtitle?: ReactNode }) {
  return (
    <Box bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="2xl" p={{ base: 4, md: 5 }}>
      <Flex align="center" justify="space-between" mb={subtitle ? 1 : 4} gap={3} wrap="wrap">
        <Text fontWeight={700}>{title}</Text>
        {actions}
      </Flex>
      {subtitle && (
        <Text fontSize="sm" color="mutedText" mb={4}>
          {subtitle}
        </Text>
      )}
      {children}
    </Box>
  );
}
