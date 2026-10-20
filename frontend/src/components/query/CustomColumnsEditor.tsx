import { useState } from 'react';
import {
  Box, Button, Flex, HStack, IconButton, Input, Popover, PopoverArrow, PopoverBody, PopoverContent, PopoverTrigger, Text, VStack,
} from '@chakra-ui/react';
import { PlusIcon, XIcon } from '../../icons';
import { FormulaError, FUNCTIONS, formatFormula, parseFormula } from '../../query/expression';
import type { CustomColumn } from '../../query/types';
import { ColumnSelect } from './ColumnSelect';
import type { PickOption } from './ColumnSelect';
import { t } from '../../i18n/index.ts';

interface CustomColumnsEditorProps {
  columns: CustomColumn[];
  onChange: (columns: CustomColumn[]) => void;
  options: PickOption[]; // columns usable in formulas
}

const NAME = /^[A-Za-z_][A-Za-z0-9_ ]{0,63}$/;

export function CustomColumnsEditor({ columns, onChange, options }: CustomColumnsEditorProps) {
  return (
    <VStack align="stretch" spacing={2}>
      {columns.map((col, i) => (
        <FormulaRow
          key={`${i}-${col.name}`}
          initialName={col.name}
          initialText={formatFormula(col.expr)}
          options={options}
          taken={columns.filter((_, k) => k !== i).map((c) => c.name)}
          onSave={(name, expr) => onChange(columns.map((c, k) => (k === i ? { name, expr } : c)))}
          onRemove={() => onChange(columns.filter((_, k) => k !== i))}
        />
      ))}
      <FormulaRow
        key={`new-${columns.length}`}
        initialName=""
        initialText=""
        options={options}
        taken={columns.map((c) => c.name)}
        isNew
        onSave={(name, expr) => onChange([...columns, { name, expr }])}
      />
    </VStack>
  );
}

interface FormulaRowProps {
  initialName: string;
  initialText: string;
  options: PickOption[];
  taken: string[];
  isNew?: boolean;
  onSave: (name: string, expr: CustomColumn['expr']) => void;
  onRemove?: () => void;
}

function FormulaRow({ initialName, initialText, options, taken, isNew, onSave, onRemove }: FormulaRowProps) {
  const [name, setName] = useState(initialName);
  const [text, setText] = useState(initialText);

  let error: string | null = null;
  let expr: CustomColumn['expr'] | null = null;
  if (text.trim()) {
    try {
      expr = parseFormula(text);
    } catch (e) {
      error = e instanceof FormulaError ? e.message : t('Invalid formula');
    }
  }
  const nameError = !name.trim() ? (text.trim() ? t('Give it a name') : null) : !NAME.test(name.trim()) ? t('Letters, digits, spaces, _') : taken.includes(name.trim()) ? t('Name already used') : null;
  const valid = expr !== null && !nameError && name.trim() !== '';
  const changed = name !== initialName || text !== initialText;

  const save = () => {
    if (valid && expr) onSave(name.trim(), expr);
  };

  return (
    <Box data-testid={isNew ? 'new-custom-column' : 'custom-column'}>
      <Flex gap={2} align="center">
        <Input size="sm" maxW="160px" placeholder={t('name')} value={name} onChange={(e) => setName(e.target.value)} aria-label={t('Column name')} />
        <Text fontSize="sm" color="mutedText">
          =
        </Text>
        <Input
          size="sm"
          fontFamily="mono"
          placeholder="[total] - [discount]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          isInvalid={!!error}
          aria-label={t('Formula')}
        />
        <InsertColumn options={options} onPick={(ref) => setText((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}[${ref}]`)} />
        {(isNew || changed) && (
          <Button size="sm" onClick={save} isDisabled={!valid}>
            {isNew ? t('Add') : t('Save')}
          </Button>
        )}
        {onRemove && <IconButton aria-label={t('Remove custom column')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={onRemove} />}
      </Flex>
      {(error || nameError) && (
        <Text fontSize="xs" color="red.300" mt={1}>
          {nameError ?? error}
        </Text>
      )}
    </Box>
  );
}

function InsertColumn({ options, onPick }: { options: PickOption[]; onPick: (ref: string) => void }) {
  return (
    <Popover placement="bottom-end" isLazy>
      <PopoverTrigger>
        <IconButton aria-label={t('Insert a column or see functions')} size="sm" icon={<PlusIcon boxSize={3.5} />} />
      </PopoverTrigger>
      <PopoverContent w="320px">
        <PopoverArrow />
        <PopoverBody>
          <VStack align="stretch" spacing={2}>
            <Text fontSize="xs" fontWeight={700}>
              {t('Insert a column')}
            </Text>
            <ColumnSelect options={options} value={undefined} onChange={(ref) => ref && onPick(ref)} />
            <Text fontSize="xs" fontWeight={700} pt={1}>
              {t('Functions')}
            </Text>
            {Object.values(FUNCTIONS).map((f) => (
              <Text key={f.help} fontSize="xs" fontFamily="mono" color="mutedText">
                {f.help}
              </Text>
            ))}
            <HStack fontSize="xs" color="mutedText">
              <Text>{t("Operators: + − × ÷ ( ). Texts in 'quotes'.")}</Text>
            </HStack>
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
