import type { ReactNode } from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Flex align={{ base: 'flex-start', md: 'center' }} justify="space-between" gap={4} direction={{ base: 'column', md: 'row' }}>
      <Box>
        <Text as="h1" fontSize="2xl" fontWeight={700} letterSpacing="-0.02em" lineHeight="1.2">
          {title}
        </Text>
        {subtitle && (
          <Text fontSize="sm" color="mutedText" mt={1}>
            {subtitle}
          </Text>
        )}
      </Box>
      {actions}
    </Flex>
  );
}
