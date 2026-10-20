import { useEffect, useState } from 'react';
import { Badge, Box, HStack, Progress, Text, VStack } from '@chakra-ui/react';
import { Player } from '@lottiefiles/react-lottie-player';
import animationUrl from '../assets/Loading Animation Bored Hand.json?url';
import { t } from '../i18n/index.ts';

interface SearchProgressProps {
  phrase: string;
  processed: number;
  total: number;
  found: number;
  starting: boolean;
}

export function SearchProgress({ phrase, processed, total, found, starting }: SearchProgressProps) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const indeterminate = starting || total === 0;

  return (
    <Box bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="2xl" p={{ base: 6, md: 10 }}>
      <VStack spacing={5} maxW="520px" mx="auto">
        <Box w="150px" h="150px" borderRadius="full" overflow="hidden" boxShadow="0 0 60px rgba(99, 102, 241, 0.35)">
          <Player src={animationUrl} loop autoplay style={{ width: '100%', height: '100%' }} />
        </Box>
        <VStack spacing={1}>
          <Text fontSize="lg" fontWeight={600} textAlign="center" wordBreak="break-word">
            {t('Searching for “{phrase}”', { phrase })}
          </Text>
          <Text fontSize="sm" color="mutedText">
            {indeterminate ? t('Reading the database structure…') : t('Scanned {processed} of {total} tables', { processed, total })}
          </Text>
        </VStack>
        <Progress
          w="100%"
          value={percent}
          isIndeterminate={indeterminate}
          size="sm"
          borderRadius="full"
          colorScheme="brand"
          bg="chipBg"
          hasStripe={!indeterminate}
          isAnimated
        />
        <HStack spacing={3}>
          <Badge colorScheme="brand" borderRadius="full" px={3} py={1} fontSize="xs">
            {t('{n} found', { n: found })}
          </Badge>
          <Badge borderRadius="full" px={3} py={1} fontSize="xs" bg="chipBg" color="mutedText">
            {t('{n}s', { n: seconds })}
          </Badge>
          {!indeterminate && (
            <Badge borderRadius="full" px={3} py={1} fontSize="xs" bg="chipBg" color="mutedText">
              {percent}%
            </Badge>
          )}
        </HStack>
      </VStack>
    </Box>
  );
}
