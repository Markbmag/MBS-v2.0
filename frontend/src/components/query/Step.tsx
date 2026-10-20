import type { ReactNode } from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

interface StepProps {
  title: string;
  color: string;
  hint?: string;
  children: ReactNode;
  actions?: ReactNode;
  testId?: string;
}

/** One block of the notebook-style builder (Data, Join, Filter, Summarise ...). */
export function Step({ title, color, hint, children, actions, testId }: StepProps) {
  return (
    <Box data-testid={testId}>
      <Flex align="center" justify="space-between" mb={1.5} gap={2}>
        <Text fontSize="xs" fontWeight={800} letterSpacing="0.08em" color={color} textTransform="uppercase">
          {title}
        </Text>
        {actions}
      </Flex>
      <Box bg="panelBg" border="1px solid" borderColor="lineColor" borderLeft="3px solid" borderLeftColor={color} borderRadius="xl" p={3}>
        {children}
        {hint && (
          <Text fontSize="xs" color="faintText" mt={2}>
            {hint}
          </Text>
        )}
      </Box>
    </Box>
  );
}
