import type { ReactNode } from 'react';
import { Box } from '@chakra-ui/react';
import { Group, Panel, Separator } from 'react-resizable-panels';

interface SplitProps {
  orientation?: 'horizontal' | 'vertical';
  first: ReactNode;
  second: ReactNode;
  defaultFirst?: string; // percent, e.g. "40%"
  minFirst?: string;
  minSecond?: string;
  id?: string;
}

/** Two panes with a draggable divider (react-resizable-panels). */
export function Split({ orientation = 'horizontal', first, second, defaultFirst = '50%', minFirst = '20%', minSecond = '20%', id }: SplitProps) {
  const horizontal = orientation === 'horizontal';
  return (
    <Group orientation={orientation} id={id} style={{ height: '100%', width: '100%' }}>
      <Panel defaultSize={defaultFirst} minSize={minFirst}>
        <Box h="100%" w="100%" minW={0} minH={0}>
          {first}
        </Box>
      </Panel>
      <Separator style={{ outline: 'none' }}>
        <Box
          w={horizontal ? '8px' : '100%'}
          h={horizontal ? '100%' : '8px'}
          display="flex"
          alignItems="center"
          justifyContent="center"
          cursor={horizontal ? 'col-resize' : 'row-resize'}
          _hover={{ '& > div': { bg: 'brand.400' } }}
        >
          <Box w={horizontal ? '2px' : '40px'} h={horizontal ? '40px' : '2px'} borderRadius="full" bg="lineColor" transition="background 0.15s" />
        </Box>
      </Separator>
      <Panel minSize={minSecond}>
        <Box h="100%" w="100%" minW={0} minH={0}>
          {second}
        </Box>
      </Panel>
    </Group>
  );
}
