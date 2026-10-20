import { Box, Button, Flex, HStack, Input, Text, Tooltip } from '@chakra-ui/react';
import { XIcon } from '../icons';
import { shownValue } from './logic';
import type { FilterValue, FilterValues } from './logic';
import type { DashFilter } from './types';
import { t } from '../i18n/index.ts';

interface Props {
  filters: DashFilter[];
  values: FilterValues;
  onChange: (values: FilterValues) => void;
}

/** The dashboard's filters; changing one re-runs the cards it is mapped to. Values live in the URL. */
export function FilterBar({ filters, values, onChange }: Props) {
  if (filters.length === 0) return null;
  const set = (id: string, value: FilterValue) => onChange({ ...values, [id]: value });
  const changed = filters.some((f) => values[f.id] !== undefined);
  return (
    <Flex gap={4} wrap="wrap" align="flex-end" bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" px={4} py={3} data-testid="filter-bar">
      {filters.map((f) => {
        const shown = shownValue(f, values);
        return (
          <Box key={f.id}>
            <Text fontSize="2xs" fontWeight={700} color="faintText" textTransform="uppercase" letterSpacing="0.06em" mb={1}>
              {f.label}
              {f.required && ' *'}
            </Text>
            {f.type === 'date_range' ? (
              <HStack spacing={1}>
                {[0, 1].map((i) => {
                  const pair = Array.isArray(shown) ? shown : ['', ''];
                  return (
                    <Input
                      key={i}
                      size="sm"
                      type="date"
                      w="150px"
                      value={pair[i] ?? ''}
                      onChange={(e) => set(f.id, i === 0 ? [e.target.value, pair[1] ?? ''] : [pair[0] ?? '', e.target.value])}
                      aria-label={i === 0 ? t('{label} from', { label: f.label }) : t('{label} to', { label: f.label })}
                      data-testid={`filter-${f.id}-${i === 0 ? 'from' : 'to'}`}
                    />
                  );
                })}
              </HStack>
            ) : (
              <Input
                size="sm"
                w={f.type === 'category' ? '220px' : '170px'}
                type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                placeholder={f.type === 'category' ? 'a, b, c' : t('any')}
                value={Array.isArray(shown) ? shown.join(', ') : shown}
                onChange={(e) => set(f.id, e.target.value)}
                aria-label={f.label}
                data-testid={`filter-${f.id}`}
              />
            )}
          </Box>
        );
      })}
      {changed && (
        <Tooltip label={t('Back to the default values')} hasArrow>
          <Button size="sm" variant="ghost" leftIcon={<XIcon boxSize={3} />} onClick={() => onChange({})}>
            {t('Reset')}
          </Button>
        </Tooltip>
      )}
    </Flex>
  );
}
