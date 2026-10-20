import { useMemo, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Checkbox, Flex, FormControl, FormHelperText, FormLabel, HStack, Input,
  InputGroup, InputLeftElement, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader,
  ModalOverlay, Spinner, Text, VStack,
} from '@chakra-ui/react';
import type { TableInfo } from '../api';
import { SearchIcon } from '../icons';
import { t, tn } from '../i18n/index.ts';

const MAX_SHOWN = 300;

interface ScopeModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionLabel: string;
  tables: TableInfo[] | null; // null while loading
  loadError: string | null;
  selected: string[]; // empty = every table
  excludeText: string;
  onApply: (selected: string[], excludeText: string) => void;
  onReload: () => void;
}

export function ScopeModal(props: ScopeModalProps) {
  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} size="xl" scrollBehavior="inside" isCentered>
      <ModalOverlay backdropFilter="blur(4px)" />
      <ModalContent>
        <ScopeBody {...props} />
      </ModalContent>
    </Modal>
  );
}

function ScopeBody({ onClose, connectionLabel, tables, loadError, selected, excludeText, onApply, onReload }: ScopeModalProps) {
  const [mode, setMode] = useState<'all' | 'custom'>(selected.length > 0 ? 'custom' : 'all');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selected));
  const [filter, setFilter] = useState('');
  const [exclude, setExclude] = useState(excludeText);

  const visible = useMemo(() => {
    if (!tables) return [];
    const needle = filter.trim().toLowerCase();
    return needle ? tables.filter((t) => t.name.toLowerCase().includes(needle)) : tables;
  }, [tables, filter]);

  const toggle = (name: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const selectVisible = () =>
    setPicked((prev) => {
      const next = new Set(prev);
      visible.forEach((t) => next.add(t.name));
      return next;
    });

  const apply = () => onApply(mode === 'all' ? [] : Array.from(picked), exclude);
  const canApply = mode === 'all' || picked.size > 0;
  const total = tables?.length ?? 0;

  return (
    <>
      <ModalHeader pb={1}>
        {t('Where to search')}
        <Text fontSize="sm" fontWeight={400} color="mutedText">
          {connectionLabel}
        </Text>
      </ModalHeader>
      <ModalCloseButton />
      <ModalBody>
        <VStack align="stretch" spacing={4}>
          <HStack spacing={3}>
            <ModeCard active={mode === 'all'} title={t('All tables')} detail={tables ? tn(total, '{n} table', '{n} tables') : ''} onClick={() => setMode('all')} />
            <ModeCard
              active={mode === 'custom'}
              title={t('Choose tables')}
              detail={mode === 'custom' ? t('{n} selected', { n: picked.size }) : t('Pick exactly which ones')}
              onClick={() => setMode('custom')}
            />
          </HStack>

          {mode === 'custom' && (
            <Box>
              {loadError ? (
                <Alert status="error" borderRadius="lg" alignItems="flex-start">
                  <AlertIcon />
                  <Box flex={1}>
                    <Text fontSize="sm">{loadError}</Text>
                    <Button size="xs" mt={2} variant="subtle" onClick={onReload}>
                      {t('Try again')}
                    </Button>
                  </Box>
                </Alert>
              ) : !tables ? (
                <Flex justify="center" py={10}>
                  <Spinner color="brand.300" />
                </Flex>
              ) : (
                <>
                  <HStack mb={3} spacing={2}>
                    <InputGroup size="sm" flex={1}>
                      <InputLeftElement pointerEvents="none" color="faintText">
                        <SearchIcon boxSize={4} />
                      </InputLeftElement>
                      <Input placeholder={t('Filter tables…')} value={filter} onChange={(e) => setFilter(e.target.value)} />
                    </InputGroup>
                    <Button size="sm" variant="subtle" onClick={selectVisible} isDisabled={visible.length === 0}>
                      {filter ? t('Select matching') : t('Select all')}
                    </Button>
                    <Button size="sm" variant="subtle" onClick={() => setPicked(new Set())} isDisabled={picked.size === 0}>
                      {t('Clear')}
                    </Button>
                  </HStack>

                  <Box
                    border="1px solid"
                    borderColor="lineColor"
                    borderRadius="xl"
                    maxH="320px"
                    overflowY="auto"
                    bg="appBg"
                  >
                    {visible.length === 0 && (
                      <Text p={4} fontSize="sm" color="mutedText">
                        {t('No table matches “{filter}”.', { filter })}
                      </Text>
                    )}
                    {visible.slice(0, MAX_SHOWN).map((table) => (
                      <Flex
                        key={table.name}
                        as="label"
                        align="center"
                        gap={3}
                        px={3}
                        py={2}
                        cursor="pointer"
                        borderBottom="1px solid"
                        borderColor="lineColor"
                        _hover={{ bg: 'panelHover' }}
                        opacity={table.searchable === 0 ? 0.55 : 1}
                      >
                        <Checkbox
                          colorScheme="brand"
                          isChecked={picked.has(table.name)}
                          onChange={() => toggle(table.name)}
                        />
                        <Text flex={1} fontFamily="mono" fontSize="sm" noOfLines={1}>
                          {table.name}
                        </Text>
                        {table.searchable === 0 ? (
                          <Badge bg="chipBg" color="faintText" fontSize="2xs">
                            {t('no text columns')}
                          </Badge>
                        ) : (
                          <Badge bg="chipBg" color="mutedText" fontSize="2xs">
                            {t('{searchable}/{columns} cols', { searchable: table.searchable, columns: table.columns })}
                          </Badge>
                        )}
                      </Flex>
                    ))}
                  </Box>
                  {visible.length > MAX_SHOWN && (
                    <Text mt={2} fontSize="xs" color="faintText">
                      {t('Showing the first {shown} of {total}. Type in the filter to narrow the list.', { shown: MAX_SHOWN, total: visible.length })}
                    </Text>
                  )}
                </>
              )}
            </Box>
          )}

          <FormControl>
            <FormLabel fontSize="sm">{t('Always skip these tables (optional)')}</FormLabel>
            <Input
              size="sm"
              placeholder="log_*, tmp_*, *_backup"
              value={exclude}
              onChange={(e) => setExclude(e.target.value)}
              fontFamily="mono"
            />
            <FormHelperText fontSize="xs">
              {t('Comma-separated patterns.')} <b>*</b> {t('matches any characters. Applies on top of the selection above.')}
            </FormHelperText>
          </FormControl>
        </VStack>
      </ModalBody>
      <ModalFooter gap={3}>
        <Button variant="subtle" onClick={onClose}>
          {t('Cancel')}
        </Button>
        <Button onClick={apply} isDisabled={!canApply}>
          {t('Apply')}
        </Button>
      </ModalFooter>
    </>
  );
}

interface ModeCardProps {
  active: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}

function ModeCard({ active, title, detail, onClick }: ModeCardProps) {
  return (
    <Box
      as="button"
      type="button"
      flex={1}
      textAlign="left"
      p={3}
      borderRadius="xl"
      border="1.5px solid"
      borderColor={active ? 'brand.400' : 'lineColor'}
      bg={active ? 'rgba(99,102,241,0.12)' : 'transparent'}
      _hover={{ borderColor: 'brand.300' }}
      onClick={onClick}
    >
      <Text fontWeight={600} fontSize="sm">
        {title}
      </Text>
      <Text fontSize="xs" color="mutedText">
        {detail || '\u00a0'}
      </Text>
    </Box>
  );
}
