/**
 * English / Russian UI (roadmap M9).
 *
 *   t('Save')                          -> "Сохранить" when Russian is chosen
 *   t('{n} rows found', { n: 12 })     -> placeholders in braces are filled in
 *   tn(n, '{n} row', '{n} rows')       -> plural: English one/other, Russian one/few/many
 *   tc('noun', 'Archive')              -> same English word, its own Russian ("noun::Archive")
 *
 * The English text is the key, so anything without a translation simply stays English.
 * Russian texts live in src/i18n/ru/*.ts as { "English": "Русский" }; a plural entry is keyed
 * "one|other" and holds three forms "одна|две|пять".
 *
 * The language is read once when the app starts (localStorage "ncode_lang"); switching
 * reloads the page. Messages from the server stay English.
 */
import { RU } from './ru/index.ts';

export type Lang = 'en' | 'ru';
export const LANGUAGES: { code: Lang; label: string; short: string }[] = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'ru', label: 'Русский', short: 'RU' },
];
const KEY = 'ncode_lang';

function initial(): Lang {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return saved === 'ru' ? 'ru' : 'en';
  } catch {
    return 'en';
  }
}

let current: Lang = initial();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const lang = (): Lang => current;

/** For tests: switch without reloading. */
export function setLangForTests(next: Lang): void {
  current = next;
}

export function setLang(next: Lang): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // private window: the choice lasts until the reload below only
  }
  current = next;
  window.location.reload();
}

type Vars = Record<string, string | number | null | undefined>;

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (vars[name] === undefined || vars[name] === null ? all : String(vars[name])));
}

export function t(text: string, vars?: Vars): string {
  if (current === 'en') return fill(text, vars);
  return fill(RU[text] ?? text, vars);
}

/**
 * The same English word with a different meaning: tc('noun', 'Archive') shows "Archive" in
 * English and looks up "noun::Archive" in Russian (falling back to plain "Archive").
 */
export function tc(context: string, text: string, vars?: Vars): string {
  if (current === 'en') return fill(text, vars);
  return fill(RU[`${context}::${text}`] ?? RU[text] ?? text, vars);
}

/** Russian plural form: 1 / 2-4 / 5-20 (21 like 1, 22 like 2 ...). */
export function ruForm(n: number): 0 | 1 | 2 {
  const a = Math.abs(Math.trunc(n));
  const d = a % 10;
  const dd = a % 100;
  if (d === 1 && dd !== 11) return 0;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 1;
  return 2;
}

export function tn(n: number, one: string, other: string, vars?: Vars): string {
  const all = { n: n.toLocaleString(current === 'ru' ? 'ru-RU' : 'en-US'), ...vars };
  if (current === 'en') return fill(n === 1 ? one : other, all);
  const forms = RU[`${one}|${other}`]?.split('|');
  if (!forms || forms.length !== 3) return fill(n === 1 ? one : other, all);
  return fill(forms[ruForm(n)], all);
}

/** Locale for toLocaleString / Intl. */
export const locale = (): string => (current === 'ru' ? 'ru-RU' : 'en-GB');
