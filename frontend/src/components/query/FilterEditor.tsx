import { Badge, Box, Button, ButtonGroup, Checkbox, Flex, HStack, IconButton, Input, Select, Text, Tooltip, VStack } from '@chakra-ui/react';
import type { ColumnType } from '../../api';
import { PlusIcon, SlidersIcon, XIcon } from '../../icons';
import { PARAM_OPS, paramName } from '../../library/params';
import { defaultValue, operatorInfo, operatorsFor } from '../../query/operators';
import type { Condition, DateUnit, FilterGroup, FilterNode, FilterOp, RelativeDate } from '../../query/types';
import { isGroup } from '../../query/types';
import { ColumnSelect } from './ColumnSelect';
import type { PickOption } from './ColumnSelect';
import { t } from '../../i18n/index.ts';

const UNITS: DateUnit[] = ['day', 'week', 'month', 'quarter', 'year'];
const MAX_DEPTH = 3;
const UNIT_LABELS: Record<DateUnit, { one: string; many: string; incl: string }> = {
  day: { one: t('day'), many: t('days'), incl: t('incl. today') },
  week: { one: t('week'), many: t('weeks'), incl: t('incl. this week') },
  month: { one: t('month'), many: t('months'), incl: t('incl. this month') },
  quarter: { one: t('quarter'), many: t('quarters'), incl: t('incl. this quarter') },
  year: { one: t('year'), many: t('years'), incl: t('incl. this year') },
};

interface FilterEditorProps {
  group: FilterGroup;
  onChange: (group: FilterGroup) => void;
  options: PickOption[];
  depth?: number;
  emptyText?: string;
  testId?: string;
  /** set = a filter's value can be asked for when the question runs (a parameter) */
  params?: FilterParams;
}

export interface FilterParams {
  names: string[];
  label: (name: string) => string;
}

export function FilterEditor({ group, onChange, options, depth = 0, emptyText = t('No filters: every row is used.'), testId, params }: FilterEditorProps) {
  const typeOf = (ref?: string): ColumnType => options.find((o) => o.ref === ref)?.type ?? 'unknown';

  const setRule = (index: number, rule: FilterNode | null) => {
    const rules = [...group.rules];
    if (rule === null) rules.splice(index, 1);
    else rules[index] = rule;
    onChange({ ...group, rules });
  };

  const addCondition = () => onChange({ ...group, rules: [...group.rules, { op: '=', value: '' } as Condition] });
  const addGroup = () => onChange({ ...group, rules: [...group.rules, { op: group.op === 'and' ? 'or' : 'and', rules: [{ op: '=', value: '' }] }] });

  return (
    <VStack align="stretch" spacing={2} data-testid={testId}>
      {group.rules.length > 1 && (
        <HStack spacing={2}>
          <Text fontSize="xs" color="mutedText">
            {t('Rows must match')}
          </Text>
          <ButtonGroup size="xs" isAttached>
            <Button variant={group.op === 'and' ? 'brand' : 'subtle'} onClick={() => onChange({ ...group, op: 'and' })}>
              {t('all')}
            </Button>
            <Button variant={group.op === 'or' ? 'brand' : 'subtle'} onClick={() => onChange({ ...group, op: 'or' })}>
              {t('any')}
            </Button>
          </ButtonGroup>
          <Text fontSize="xs" color="mutedText">
            {t('of these')}
          </Text>
        </HStack>
      )}
      {group.rules.length === 0 && depth === 0 && (
        <Text fontSize="sm" color="faintText">
          {emptyText}
        </Text>
      )}
      {group.rules.map((rule, i) =>
        isGroup(rule) ? (
          <Flex key={i} gap={2} align="flex-start">
            <Box flex={1} border="1px dashed" borderColor="lineColor" borderRadius="lg" p={2}>
              <FilterEditor group={rule} onChange={(g) => setRule(i, g)} options={options} depth={depth + 1} params={params} />
            </Box>
            <IconButton aria-label={t('Remove group')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => setRule(i, null)} />
          </Flex>
        ) : (
          <ConditionRow
            key={i}
            condition={rule}
            type={typeOf(rule.ref)}
            options={options}
            onChange={(c) => setRule(i, c)}
            onRemove={() => setRule(i, null)}
            joiner={i > 0 ? (group.op === 'and' ? 'and' : 'or') : null}
            params={params}
          />
        ),
      )}
      <HStack spacing={2}>
        <Button size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} onClick={addCondition}>
          {t('Filter')}
        </Button>
        {depth < MAX_DEPTH - 1 && (
          <Button size="xs" variant="ghost" leftIcon={<PlusIcon boxSize={3} />} onClick={addGroup}>
            {group.op === 'and' ? t('Group (any of)') : t('Group (all of)')}
          </Button>
        )}
      </HStack>
    </VStack>
  );
}

interface ConditionRowProps {
  condition: Condition;
  type: ColumnType;
  options: PickOption[];
  onChange: (c: Condition) => void;
  onRemove: () => void;
  joiner: string | null;
  params?: FilterParams;
}

function ConditionRow({ condition, type, options, onChange, onRemove, joiner, params }: ConditionRowProps) {
  const ops = operatorsFor(type);
  const info = operatorInfo(type, condition.op);

  const pickColumn = (ref: string) => {
    const newType = options.find((o) => o.ref === ref)?.type ?? 'unknown';
    const keepOp = operatorsFor(newType).some((o) => o.op === condition.op) && newType === type;
    const op = keepOp ? condition.op : operatorsFor(newType)[0].op;
    onChange({ ref, op, value: keepOp ? condition.value : defaultValue(operatorInfo(newType, op).value) });
  };

  const pickOp = (op: FilterOp) => {
    const next = operatorInfo(type, op);
    const sameKind = next.value === info.value;
    const keepParam = condition.param && PARAM_OPS.includes(op) ? { param: condition.param } : {};
    const { param: _dropped, ...rest } = condition; // eslint-disable-line @typescript-eslint/no-unused-vars
    onChange({ ...rest, ...keepParam, op, value: sameKind ? condition.value : defaultValue(next.value) });
  };

  const canAsk = !!params && !!condition.ref && PARAM_OPS.includes(condition.op);
  const toggleAsk = () => {
    if (!params || !condition.ref) return;
    if (condition.param) {
      const { param: _dropped, ...rest } = condition; // eslint-disable-line @typescript-eslint/no-unused-vars
      onChange({ ...rest, value: defaultValue(info.value) });
    } else {
      onChange({ ref: condition.ref, op: condition.op, param: paramName(condition.ref, params.names) });
    }
  };

  return (
    <Flex gap={2} align="center" wrap="wrap" data-testid="filter-row">
      {joiner && (
        <Text fontSize="2xs" fontWeight={700} color="faintText" w="24px" textTransform="uppercase">
          {joiner === 'and' ? t('and') : t('or')}
        </Text>
      )}
      <ColumnSelect options={options} value={condition.ref} onChange={pickColumn} maxW="220px" aria-label={t('Filter column')} />
      {condition.ref && (
        <Select size="sm" maxW="170px" value={condition.op} onChange={(e) => pickOp(e.target.value as FilterOp)} aria-label={t('Operator')}>
          {ops.map((o) => (
            <option key={o.op} value={o.op}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
      {condition.ref && condition.param && params ? (
        <Badge colorScheme="purple" textTransform="none" fontWeight={500} data-testid="asked-filter">
          {t('asks “{name}”', { name: params.label(condition.param) })}
        </Badge>
      ) : (
        condition.ref && <ValueInput kind={info.value} type={type} value={condition.value} onChange={(value) => onChange({ ...condition, value })} />
      )}
      <HStack spacing={0} ml="auto">
        {canAsk && (
          <Tooltip label={condition.param ? t('Use a fixed value again') : t('Ask for this value when the question runs (a parameter)')} hasArrow>
            <IconButton
              aria-label={condition.param ? t('Use a fixed value') : t('Ask for the value')}
              size="xs"
              variant={condition.param ? 'subtle' : 'ghost'}
              color={condition.param ? 'purple.300' : undefined}
              icon={<SlidersIcon boxSize={3} />}
              onClick={toggleAsk}
              data-testid="ask-filter"
            />
          </Tooltip>
        )}
        <IconButton aria-label={t('Remove filter')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={onRemove} />
      </HStack>
    </Flex>
  );
}

function inputType(type: ColumnType): string {
  if (type === 'number') return 'number';
  if (type === 'date') return 'date';
  if (type === 'datetime') return 'datetime-local';
  return 'text';
}

interface ValueInputProps {
  kind: ReturnType<typeof operatorInfo>['value'];
  type: ColumnType;
  value: unknown;
  onChange: (value: unknown) => void;
}

function ValueInput({ kind, type, value, onChange }: ValueInputProps) {
  const htmlType = inputType(type);
  if (kind === 'none') return null;
  if (kind === 'single') {
    return <Input size="sm" type={htmlType} maxW="200px" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={t('value')} aria-label={t('Value')} />;
  }
  if (kind === 'pair') {
    const pair = Array.isArray(value) ? value : ['', ''];
    return (
      <HStack spacing={1}>
        <Input size="sm" type={htmlType} maxW="170px" value={String(pair[0] ?? '')} onChange={(e) => onChange([e.target.value, pair[1]])} aria-label={t('From')} />
        <Text fontSize="xs" color="mutedText">
          {t('and')}
        </Text>
        <Input size="sm" type={htmlType} maxW="170px" value={String(pair[1] ?? '')} onChange={(e) => onChange([pair[0], e.target.value])} aria-label={t('To')} />
      </HStack>
    );
  }
  if (kind === 'list') {
    const items = Array.isArray(value) ? value : [];
    return (
      <Input
        size="sm"
        maxW="260px"
        defaultValue={items.join(', ')}
        placeholder="a, b, c"
        aria-label={t('Values, separated by commas')}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => (type === 'number' && !Number.isNaN(Number(s)) ? Number(s) : s)),
          )
        }
      />
    );
  }
  const rel = (value && typeof value === 'object' ? value : { unit: 'day' }) as RelativeDate;
  const unitSelect = (
    <Select size="sm" maxW="120px" value={rel.unit} onChange={(e) => onChange({ ...rel, unit: e.target.value as DateUnit })} aria-label={t('Unit')}>
      {UNITS.map((u) => (
        <option key={u} value={u}>
          {kind === 'relative' ? UNIT_LABELS[u].many : UNIT_LABELS[u].one}
        </option>
      ))}
    </Select>
  );
  if (kind === 'current') return unitSelect;
  return (
    <HStack spacing={2}>
      <Input
        size="sm"
        type="number"
        min={1}
        maxW="80px"
        value={rel.amount ?? 1}
        onChange={(e) => onChange({ ...rel, amount: Math.max(1, Number(e.target.value) || 1) })}
        aria-label={t('Amount')}
      />
      {unitSelect}
      <Checkbox size="sm" isChecked={!!rel.include_current} onChange={(e) => onChange({ ...rel, include_current: e.target.checked })}>
        <Text fontSize="xs">{UNIT_LABELS[rel.unit]?.incl ?? t('incl. this {unit}', { unit: rel.unit })}</Text>
      </Checkbox>
    </HStack>
  );
}
