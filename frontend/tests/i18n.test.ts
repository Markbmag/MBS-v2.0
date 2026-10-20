import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { ruForm, setLangForTests, t, tc, tn } from '../src/i18n/index.ts';
import { RU } from '../src/i18n/ru/index.ts';

test('English is the key and the fallback', () => {
  setLangForTests('en');
  assert.equal(t('Save'), 'Save');
  assert.equal(t('{n} rows found', { n: 3 }), '3 rows found');
  assert.equal(tn(1, '{n} row', '{n} rows'), '1 row');
  assert.equal(tn(5, '{n} row', '{n} rows'), '5 rows');
  setLangForTests('ru');
  assert.equal(t('A text nobody translated'), 'A text nobody translated');
  setLangForTests('en');
});

test('Russian plural forms', () => {
  assert.deepEqual([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(ruForm), [0, 1, 1, 2, 2, 2, 2, 0, 1, 2, 0, 2]);
});

test('every Russian text keeps the placeholders of its English key', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [en, ru] of Object.entries(RU)) {
    if (en.includes('|')) {
      const forms = ru.split('|');
      assert.equal(forms.length, 3, `plural "${en}" needs three Russian forms`);
      for (const f of forms) assert.equal(names(f), names(en.split('|')[1]), `placeholders of "${en}"`);
    } else {
      assert.equal(names(ru), names(en), `placeholders of "${en}"`);
    }
    assert.ok(ru.trim() !== '', `empty translation for "${en}"`);
  }
});

test('a word with a context has its own Russian, falling back to the plain word', () => {
  setLangForTests('en');
  assert.equal(tc('noun', 'Archive'), 'Archive');
  setLangForTests('ru');
  assert.equal(tc('noun', 'Archive'), RU['noun::Archive']);
  assert.notEqual(tc('noun', 'Archive'), t('Archive'));
  assert.equal(tc('nothing', 'Save'), t('Save'));
  setLangForTests('en');
});

test('areas agree on the Russian of a shared text', async () => {
  const seen = new Map<string, [string, string]>();
  for (const area of ['shell', 'query', 'viz', 'library', 'analysis', 'automation', 'admin']) {
    const mod = (await import(`../src/i18n/ru/${area}.ts`)) as Record<string, Record<string, string>>;
    for (const [en, ru] of Object.entries(Object.values(mod)[0])) {
      const before = seen.get(en);
      if (before) assert.equal(ru, before[0], `"${en}" differs between ${before[1]} and ${area}`);
      else seen.set(en, [ru, area]);
    }
  }
});

test('every text the app shows has a Russian translation', () => {
  const unquote = (q: string, body: string) => (q === '`' ? body : (JSON.parse(`"${body.replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"')}"`) as string));
  const str = String.raw`(['"])((?:\\.|(?!\1)[^\\\n])*)\1`;
  const single = new RegExp(String.raw`\b(?:t|tr)\(\s*${str}`, 'g');
  const ctx = new RegExp(String.raw`\btc\(\s*'(\w+)',\s*${str}`, 'g');
  const plural = new RegExp(String.raw`\btn\([^,()]+(?:\([^()]*\))?,\s*${str},\s*${str.replace('\\1', '\\3')}`, 'g');
  const missing: string[] = [];
  let checked = 0;
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
  for (const file of walk('src')) {
    if (file.includes(`${sep}i18n${sep}`)) continue;
    const src = readFileSync(file, 'utf8');
    checked += [...src.matchAll(single), ...src.matchAll(ctx), ...src.matchAll(plural)].length;
    for (const m of src.matchAll(single)) if (!(unquote(m[1], m[2]) in RU)) missing.push(`${file}: ${m[2]}`);
    for (const m of src.matchAll(ctx)) if (!(`${m[1]}::${unquote(m[2], m[3])}` in RU)) missing.push(`${file}: ${m[1]}::${m[3]}`);
    for (const m of src.matchAll(plural)) if (!(`${unquote(m[1], m[2])}|${unquote(m[3], m[4])}` in RU)) missing.push(`${file}: ${m[2]}|${m[4]}`);
  }
  assert.ok(checked > 1000, `only ${checked} texts found`);
  assert.deepEqual(missing, []);
});
