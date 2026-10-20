import {
  Box, Checkbox, Flex, FormControl, FormLabel, HStack, IconButton, Input, Popover, PopoverArrow, PopoverBody, PopoverContent,
  PopoverTrigger, Select, Text, Tooltip, VStack,
} from '@chakra-ui/react';
import { SettingsIcon } from '../icons';
import type { ParamShape, ParamType, ParamValue, ParamValues, ParameterDef } from './params';
import { t } from '../i18n/index.ts';

const inputType = (type: ParamType) => (type === 'number' ? 'number' : type === 'date' ? 'date' : 'text');

interface Props {
  defs: ParameterDef[];
  shapes?: Record<string, ParamShape>;
  values: ParamValues;
  onValues: (values: ParamValues) => void;
  /** null = the viewer cannot change the declarations */
  onDefs?: ((defs: ParameterDef[]) => void) | null;
  /** SQL parameters can change type; builder ones follow their column */
  typeEditable?: boolean;
}

/** One input per question parameter, plus its settings (label, type, default, required). */
export function ParametersBar({ defs, shapes = {}, values, onValues, onDefs, typeEditable = false }: Props) {
  if (defs.length === 0) return null;
  const setValue = (name: string, value: ParamValue) => onValues({ ...values, [name]: value });
  const setDef = (name: string, patch: Partial<ParameterDef>) => onDefs?.(defs.map((d) => (d.name === name ? { ...d, ...patch } : d)));
  return (
    <Flex gap={3} px={3} py={2} wrap="wrap" align="center" borderTop="1px solid" borderColor="lineColor" data-testid="parameters">
      {defs.map((def) => {
        const shape = shapes[def.name] ?? 'single';
        const value = values[def.name];
        const placeholder = def.default !== null && def.default !== undefined && def.default !== '' ? String(def.default) : def.required ? t('required') : t('any');
        return (
          <HStack key={def.name} spacing={1.5}>
            <Tooltip label={`{{${def.name}}}${def.required ? ` · ${t('required')}` : ''}`} hasArrow openDelay={400}>
              <Text fontSize="xs" fontWeight={600} color="mutedText" whiteSpace="nowrap">
                {def.label || def.name}
                {def.required && ' *'}
              </Text>
            </Tooltip>
            {shape === 'pair' ? (
              <HStack spacing={1}>
                {[0, 1].map((i) => {
                  const pair = Array.isArray(value) ? value : ['', ''];
                  return (
                    <Input
                      key={i}
                      size="xs"
                      maxW="130px"
                      type={inputType(def.type)}
                      value={pair[i] ?? ''}
                      onChange={(e) => setValue(def.name, i === 0 ? [e.target.value, pair[1] ?? ''] : [pair[0] ?? '', e.target.value])}
                      aria-label={i === 0 ? t('{name} from', { name: def.label || def.name }) : t('{name} to', { name: def.label || def.name })}
                    />
                  );
                })}
              </HStack>
            ) : (
              <Input
                size="xs"
                maxW={shape === 'list' ? '200px' : '150px'}
                type={shape === 'list' ? 'text' : inputType(def.type)}
                value={Array.isArray(value) ? value.join(', ') : (value ?? '')}
                placeholder={shape === 'list' ? `${placeholder} (a, b, c)` : placeholder}
                onChange={(e) => setValue(def.name, e.target.value)}
                aria-label={t('Value of {name}', { name: def.label || def.name })}
                data-testid={`param-${def.name}`}
              />
            )}
            {onDefs && (
              <Popover placement="bottom-start" isLazy>
                <PopoverTrigger>
                  <IconButton aria-label={t('Settings of {name}', { name: def.name })} size="xs" variant="ghost" icon={<SettingsIcon boxSize={3} />} />
                </PopoverTrigger>
                <PopoverContent w="260px">
                  <PopoverArrow />
                  <PopoverBody>
                    <VStack align="stretch" spacing={2}>
                      <FormControl>
                        <FormLabel fontSize="xs" mb={1}>
                          {t('Label')}
                        </FormLabel>
                        <Input size="xs" value={def.label ?? ''} onChange={(e) => setDef(def.name, { label: e.target.value })} />
                      </FormControl>
                      {typeEditable && (
                        <FormControl>
                          <FormLabel fontSize="xs" mb={1}>
                            {t('Type')}
                          </FormLabel>
                          <Select size="xs" value={def.type} onChange={(e) => setDef(def.name, { type: e.target.value as ParamType })} aria-label={t('Type')}>
                            <option value="text">{t('Text')}</option>
                            <option value="number">{t('Number')}</option>
                            <option value="date">{t('Date')}</option>
                          </Select>
                        </FormControl>
                      )}
                      <FormControl>
                        <FormLabel fontSize="xs" mb={1}>
                          {t('Default value')}
                        </FormLabel>
                        <Input
                          size="xs"
                          type={shape === 'single' ? inputType(def.type) : 'text'}
                          value={def.default === null || def.default === undefined ? '' : String(def.default)}
                          onChange={(e) => setDef(def.name, { default: e.target.value === '' ? null : e.target.value })}
                          placeholder={shape === 'pair' ? t('from, to') : shape === 'list' ? 'a, b, c' : ''}
                        />
                      </FormControl>
                      <Checkbox size="sm" isChecked={!!def.required} onChange={(e) => setDef(def.name, { required: e.target.checked })}>
                        <Text fontSize="xs">{t('Required')}</Text>
                      </Checkbox>
                      <Box fontSize="2xs" color="faintText">
                        {typeEditable ? t('Every {{parameter}} in SQL needs a value or a default.') : t('Without a value (and no default) this filter is left out.')}
                      </Box>
                    </VStack>
                  </PopoverBody>
                </PopoverContent>
              </Popover>
            )}
          </HStack>
        );
      })}
    </Flex>
  );
}
