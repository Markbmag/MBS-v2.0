import type { RefObject } from 'react';
import {
  Button, ButtonGroup, Flex, HStack, Input, InputGroup, InputLeftElement, Select, Switch, Text, Tooltip, Wrap, WrapItem,
} from '@chakra-ui/react';
import type { MatchMode } from '../api';
import { SearchIcon, TableIcon } from '../icons';
import { t } from '../i18n/index.ts';

const ROW_LIMITS = [10, 25, 50, 100, 200];

const MODES: { value: MatchMode; label: string; hint: string }[] = [
  { value: 'contains', label: t('Contains'), hint: t('The phrase appears anywhere in the value') },
  { value: 'starts_with', label: t('Starts with'), hint: t('The value begins with the phrase') },
  { value: 'exact', label: t('Exact'), hint: t('The whole value equals the phrase') },
];

interface SearchBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  phrase: string;
  onPhraseChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  running: boolean;
  disabled: boolean;
  matchMode: MatchMode;
  onMatchMode: (value: MatchMode) => void;
  caseSensitive: boolean;
  onCaseSensitive: (value: boolean) => void;
  includeNumbers: boolean;
  onIncludeNumbers: (value: boolean) => void;
  rowLimit: number;
  onRowLimit: (value: number) => void;
  scopeLabel: string;
  scopeCustom: boolean;
  onOpenScope: () => void;
}

export function SearchBar({ inputRef, ...props }: SearchBarProps) {
  const { running, disabled } = props;
  return (
    <Flex
      direction="column"
      gap={4}
      bg="panelBg"
      border="1px solid"
      borderColor="lineColor"
      borderRadius="2xl"
      p={{ base: 4, md: 5 }}
      boxShadow="0 1px 2px rgba(0,0,0,0.06), 0 12px 32px -16px rgba(79,70,229,0.25)"
    >
      <Flex gap={3} direction={{ base: 'column', sm: 'row' }}>
        <InputGroup size="lg" flex={1}>
          <InputLeftElement h="56px" w="52px" pointerEvents="none" color="faintText">
            <SearchIcon boxSize={5} />
          </InputLeftElement>
          <Input
            ref={inputRef}
            h="56px"
            pl="52px"
            fontSize="md"
            placeholder={disabled ? t('Add a database to start searching') : t('Search for a name, code, VIN, email…   (press / to focus)')}
            value={props.phrase}
            onChange={(e) => props.onPhraseChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !running && !disabled) props.onSubmit();
            }}
            isDisabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
        </InputGroup>
        {running ? (
          <Button h="56px" px={8} variant="subtle" colorScheme="red" onClick={props.onCancel}>
            {t('Stop')}
          </Button>
        ) : (
          <Button h="56px" px={10} onClick={props.onSubmit} isDisabled={disabled || !props.phrase.trim()}>
            {t('Search')}
          </Button>
        )}
      </Flex>

      <Wrap spacing={3} align="center">
        <WrapItem>
          <Tooltip label={t('Choose which tables are searched')} hasArrow>
            <Button
              size="sm"
              variant={props.scopeCustom ? 'brand' : 'subtle'}
              leftIcon={<TableIcon boxSize={4} />}
              onClick={props.onOpenScope}
              isDisabled={disabled}
            >
              {props.scopeLabel}
            </Button>
          </Tooltip>
        </WrapItem>

        <WrapItem>
          <ButtonGroup isAttached size="sm">
            {MODES.map((mode) => (
              <Tooltip key={mode.value} label={mode.hint} hasArrow>
                <Button
                  variant={props.matchMode === mode.value ? 'brand' : 'subtle'}
                  onClick={() => props.onMatchMode(mode.value)}
                  isDisabled={disabled}
                >
                  {mode.label}
                </Button>
              </Tooltip>
            ))}
          </ButtonGroup>
        </WrapItem>

        <WrapItem>
          <Tooltip label={t('Treat “VIN” and “vin” as different')} hasArrow>
            <HStack spacing={2}>
              <Switch
                size="sm"
                colorScheme="brand"
                isChecked={props.caseSensitive}
                onChange={(e) => props.onCaseSensitive(e.target.checked)}
                isDisabled={disabled}
              />
              <Text fontSize="sm" color="mutedText">
                {t('Match case')}
              </Text>
            </HStack>
          </Tooltip>
        </WrapItem>

        <WrapItem>
          <Tooltip label={t('Also look inside number and date columns (when the phrase looks like one)')} hasArrow>
            <HStack spacing={2}>
              <Switch
                size="sm"
                colorScheme="brand"
                isChecked={props.includeNumbers}
                onChange={(e) => props.onIncludeNumbers(e.target.checked)}
                isDisabled={disabled}
              />
              <Text fontSize="sm" color="mutedText">
                {t('Numbers & dates')}
              </Text>
            </HStack>
          </Tooltip>
        </WrapItem>

        <WrapItem>
          <Tooltip label={t('Maximum rows shown per table')} hasArrow>
            <Select
              size="sm"
              w="auto"
              value={props.rowLimit}
              onChange={(e) => props.onRowLimit(Number(e.target.value))}
              isDisabled={disabled}
            >
              {ROW_LIMITS.map((n) => (
                <option key={n} value={n}>
                  {t('{n} rows / table', { n })}
                </option>
              ))}
            </Select>
          </Tooltip>
        </WrapItem>
      </Wrap>
    </Flex>
  );
}
