import type { ColumnType } from '../api';
import type { FilterOp } from './types.ts';
import { t } from '../i18n/index.ts';

/** What kind of value input an operator needs in the filter editor. */
export type ValueKind = 'none' | 'single' | 'pair' | 'list' | 'relative' | 'current';

export interface OperatorInfo {
  op: FilterOp;
  label: string;
  value: ValueKind;
}

const O = (op: FilterOp, label: string, value: ValueKind): OperatorInfo => ({ op, label, value });

const EMPTY = [O('is_null', t('is empty (null)'), 'none'), O('not_null', t('is not empty (null)'), 'none')];

export const OPERATORS: Record<'string' | 'number' | 'date' | 'boolean' | 'other', OperatorInfo[]> = {
  string: [
    O('=', t('is'), 'single'),
    O('!=', t('is not'), 'single'),
    O('contains', t('contains'), 'single'),
    O('not_contains', t('does not contain'), 'single'),
    O('starts_with', t('starts with'), 'single'),
    O('ends_with', t('ends with'), 'single'),
    O('in', t('is one of'), 'list'),
    O('not_in', t('is none of'), 'list'),
    O('is_empty', t('is empty or blank'), 'none'),
    O('not_empty', t('has a value'), 'none'),
    ...EMPTY,
  ],
  number: [
    O('=', '=', 'single'),
    O('!=', '≠', 'single'),
    O('>', '>', 'single'),
    O('>=', '≥', 'single'),
    O('<', '<', 'single'),
    O('<=', '≤', 'single'),
    O('between', t('between'), 'pair'),
    O('in', t('is one of'), 'list'),
    O('not_in', t('is none of'), 'list'),
    ...EMPTY,
  ],
  date: [
    O('last', t('in the last'), 'relative'),
    O('current', t('this'), 'current'),
    O('between', t('between'), 'pair'),
    O('>=', t('on or after'), 'single'),
    O('<', t('before'), 'single'),
    O('=', t('on'), 'single'),
    ...EMPTY,
  ],
  boolean: [O('is_true', t('is true'), 'none'), O('is_false', t('is false'), 'none'), ...EMPTY],
  other: [O('=', t('is'), 'single'), O('!=', t('is not'), 'single'), ...EMPTY],
};

export function operatorGroup(type: ColumnType): keyof typeof OPERATORS {
  if (type === 'string') return 'string';
  if (type === 'number') return 'number';
  if (type === 'date' || type === 'datetime') return 'date';
  if (type === 'boolean') return 'boolean';
  if (type === 'unknown') return 'string';
  return 'other';
}

export function operatorsFor(type: ColumnType): OperatorInfo[] {
  return OPERATORS[operatorGroup(type)];
}

export function operatorInfo(type: ColumnType, op: FilterOp): OperatorInfo {
  return operatorsFor(type).find((o) => o.op === op) ?? O(op, op, 'single');
}

/** The value a new condition starts with after picking an operator. */
export function defaultValue(kind: ValueKind): unknown {
  switch (kind) {
    case 'pair':
      return ['', ''];
    case 'list':
      return [];
    case 'relative':
      return { amount: 30, unit: 'day', include_current: false };
    case 'current':
      return { unit: 'month' };
    case 'none':
      return undefined;
    default:
      return '';
  }
}

/** True when the condition has everything it needs to be sent. */
export function valueComplete(kind: ValueKind, value: unknown): boolean {
  switch (kind) {
    case 'none':
    case 'relative':
    case 'current':
      return true;
    case 'pair':
      return Array.isArray(value) && value.length === 2 && value.every((v) => String(v ?? '').trim() !== '');
    case 'list':
      return Array.isArray(value) && value.length > 0;
    default:
      return value !== undefined && value !== null && String(value).trim() !== '';
  }
}
