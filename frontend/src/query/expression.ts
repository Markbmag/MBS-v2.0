/**
 * Formulas for custom columns, e.g.
 *
 *   [Orders.total] - [Orders.tax]
 *   round([total] / [qty], 2)
 *   coalesce([status], 'none')
 *   case([total] >= 100, 'big', [total] >= 10, 'medium', 'small')
 *
 * parsed into the spec's expression JSON (and printed back for editing).
 * Column names go in [brackets]; plain table.column or column also works when
 * the name has no spaces. Strings use 'single' or "double" quotes.
 */
import type { Condition, Expr, FilterOp, FunctionName, Literal } from './types.ts';
import { t } from '../i18n/index.ts';

export class FormulaError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.position = position;
  }
}

export const FUNCTIONS: Record<string, { min: number; max: number; help: string }> = {
  coalesce: { min: 1, max: 20, help: t('coalesce(a, b, …) — the first value that is not empty') },
  nullif: { min: 2, max: 2, help: t('nullif(a, b) — empty when a equals b') },
  lower: { min: 1, max: 1, help: t('lower(text)') },
  upper: { min: 1, max: 1, help: t('upper(text)') },
  trim: { min: 1, max: 1, help: t('trim(text) — without leading/trailing spaces') },
  length: { min: 1, max: 1, help: t('length(text)') },
  abs: { min: 1, max: 1, help: t('abs(number)') },
  round: { min: 1, max: 2, help: t('round(number, digits)') },
  concat: { min: 2, max: 20, help: t('concat(a, b, …) — join texts') },
  case: { min: 2, max: 99, help: t('case(condition, value, …, otherwise)') },
};

type Token =
  | { kind: 'num'; value: number; pos: number }
  | { kind: 'str'; value: string; pos: number }
  | { kind: 'ref'; value: string; pos: number }
  | { kind: 'ident'; value: string; pos: number }
  | { kind: 'op'; value: string; pos: number }
  | { kind: 'end'; pos: number };

const COMPARE = ['>=', '<=', '!=', '<>', '=', '>', '<'];

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const start = i;
    if (ch === '[') {
      const end = text.indexOf(']', i + 1);
      if (end < 0) throw new FormulaError(t('A [column name] is not closed'), i);
      const name = text.slice(i + 1, end).trim();
      if (!name) throw new FormulaError(t('Empty [ ]'), i);
      tokens.push({ kind: 'ref', value: name, pos: start });
      i = end + 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let value = '';
      i++;
      for (;;) {
        if (i >= text.length) throw new FormulaError(t('A text in quotes is not closed'), start);
        if (text[i] === ch) {
          if (text[i + 1] === ch) {
            value += ch; // doubled quote = the quote itself
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += text[i++];
      }
      tokens.push({ kind: 'str', value, pos: start });
      continue;
    }
    const num = /^\d+(?:\.\d+)?/.exec(text.slice(i));
    if (num) {
      tokens.push({ kind: 'num', value: Number(num[0]), pos: start });
      i += num[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?/.exec(text.slice(i));
    if (ident) {
      tokens.push({ kind: 'ident', value: ident[0], pos: start });
      i += ident[0].length;
      continue;
    }
    const op = [...COMPARE, '+', '-', '*', '/', '(', ')', ','].find((o) => text.startsWith(o, i));
    if (op) {
      tokens.push({ kind: 'op', value: op, pos: start });
      i += op.length;
      continue;
    }
    throw new FormulaError(t('Unexpected "{text}"', { text: ch }), i);
  }
  tokens.push({ kind: 'end', pos: text.length });
  return tokens;
}

class Parser {
  private i = 0;
  private readonly tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.i];
  }
  private next(): Token {
    return this.tokens[this.i++];
  }
  private isOp(value: string): boolean {
    const tok = this.peek();
    return tok.kind === 'op' && tok.value === value;
  }
  private expect(value: string): void {
    const tok = this.next();
    if (tok.kind !== 'op' || tok.value !== value) throw new FormulaError(t('Expected "{text}"', { text: value }), tok.pos);
  }

  parse(): Expr {
    const expr = this.additive();
    const tok = this.peek();
    if (tok.kind !== 'end') throw new FormulaError(t('Unexpected text after the formula'), tok.pos);
    return expr;
  }

  private additive(): Expr {
    let left = this.multiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next() as { value: '+' | '-' };
      left = { op: op.value, args: [left, this.multiplicative()] };
    }
    return left;
  }

  private multiplicative(): Expr {
    let left = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = this.next() as { value: '*' | '/' };
      left = { op: op.value, args: [left, this.unary()] };
    }
    return left;
  }

  private unary(): Expr {
    if (this.isOp('-')) {
      this.next();
      const inner = this.unary();
      if ('value' in inner && typeof inner.value === 'number') return { value: -inner.value };
      return { op: '-', args: [{ value: 0 }, inner] };
    }
    return this.primary();
  }

  private primary(): Expr {
    const tok = this.next();
    if (tok.kind === 'num') return { value: tok.value };
    if (tok.kind === 'str') return { value: tok.value };
    if (tok.kind === 'ref') return { ref: tok.value };
    if (tok.kind === 'op' && tok.value === '(') {
      const inner = this.additive();
      this.expect(')');
      return inner;
    }
    if (tok.kind === 'ident') {
      const lower = tok.value.toLowerCase();
      if (this.isOp('(')) return this.call(lower, tok.pos);
      if (lower === 'null') return { value: null };
      if (lower === 'true' || lower === 'false') return { value: lower === 'true' };
      return { ref: tok.value };
    }
    throw new FormulaError(tok.kind === 'end' ? t('The formula ends too early') : t('Unexpected "{text}"', { text: (tok as { value: string }).value }), tok.pos);
  }

  private call(name: string, pos: number): Expr {
    const info = FUNCTIONS[name];
    if (!info) throw new FormulaError(t('Unknown function {name}()', { name }), pos);
    this.expect('(');
    if (name === 'case') return this.caseCall(pos);
    const args: Expr[] = [];
    if (!this.isOp(')')) {
      args.push(this.additive());
      while (this.isOp(',')) {
        this.next();
        args.push(this.additive());
      }
    }
    this.expect(')');
    if (args.length < info.min || args.length > info.max) throw new FormulaError(t('Wrong number of arguments: {help}', { help: info.help }), pos);
    if (name === 'round') {
      const digits = args[1];
      if (digits !== undefined && !('value' in digits && Number.isInteger(digits.value))) {
        throw new FormulaError(t('round(number, digits): digits must be a whole number'), pos);
      }
      return { fn: 'round', args: [args[0]], digits: digits ? (digits as { value: number }).value : 0 };
    }
    return { fn: name as FunctionName, args };
  }

  private caseCall(pos: number): Expr {
    const branches: { when: Condition; then: Expr }[] = [];
    let otherwise: Expr | undefined;
    for (;;) {
      const startPos = this.peek().pos;
      const left = this.additive();
      const tok = this.peek();
      if (tok.kind === 'op' && COMPARE.includes(tok.value)) {
        this.next();
        const right = this.additive();
        if (!('value' in right)) throw new FormulaError(t('Compare with a fixed value, e.g. [total] > 100'), startPos);
        this.expect(',');
        const then = this.additive();
        const op = (tok.value === '<>' ? '!=' : tok.value) as FilterOp;
        const when: Condition = 'ref' in left ? { ref: left.ref, op, value: right.value } : { expr: left, op, value: right.value };
        branches.push({ when, then });
      } else {
        otherwise = left;
      }
      if (this.isOp(',')) {
        if (otherwise !== undefined) throw new FormulaError(t('The "otherwise" value must come last'), this.peek().pos);
        this.next();
        continue;
      }
      break;
    }
    this.expect(')');
    if (branches.length === 0) throw new FormulaError(t('case() needs at least one condition: case([x] > 1, value, otherwise)'), pos);
    return otherwise === undefined ? { case: branches } : { case: branches, else: otherwise };
  }
}

export function parseFormula(text: string): Expr {
  if (!text.trim()) throw new FormulaError(t('Write a formula'), 0);
  return new Parser(tokenize(text)).parse();
}

// ---------------------------------------------------------------- printing

function literal(value: Literal): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  return String(value);
}

function refText(ref: string): string {
  return `[${ref}]`; // brackets always: safe for names with spaces or that look like functions
}

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

export function formatFormula(expr: Expr, parentPrecedence = 0): string {
  if ('ref' in expr) return refText(expr.ref);
  if ('value' in expr) return literal(expr.value);
  if ('op' in expr) {
    const p = PRECEDENCE[expr.op];
    const text = `${formatFormula(expr.args[0], p)} ${expr.op} ${formatFormula(expr.args[1], p + 1)}`;
    return p < parentPrecedence ? `(${text})` : text;
  }
  if ('fn' in expr) {
    const args = expr.args.map((a) => formatFormula(a));
    if (expr.fn === 'round' && expr.digits) args.push(String(expr.digits));
    return `${expr.fn}(${args.join(', ')})`;
  }
  const parts: string[] = [];
  for (const branch of expr.case) {
    const w = branch.when as Condition;
    const target = w.ref !== undefined ? refText(w.ref) : formatFormula(w.expr as Expr);
    parts.push(`${target} ${w.op} ${literal(w.value as Literal)}`, formatFormula(branch.then));
  }
  if (expr.else) parts.push(formatFormula(expr.else));
  return `case(${parts.join(', ')})`;
}

/** Every column/custom-column name a formula refers to. */
export function formulaRefs(expr: Expr): string[] {
  const out: string[] = [];
  const walk = (e: Expr) => {
    if ('ref' in e) out.push(e.ref);
    else if ('op' in e || 'fn' in e) e.args.forEach(walk);
    else if ('case' in e) {
      for (const b of e.case) {
        const w = b.when as Condition;
        if (w.ref) out.push(w.ref);
        if (w.expr) walk(w.expr);
        walk(b.then);
      }
      if (e.else) walk(e.else);
    }
  };
  walk(expr);
  return [...new Set(out)];
}
