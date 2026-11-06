#!/usr/bin/env node
/*
 * Records the server under several conditions and, optionally, compares with an
 * earlier set of recordings.
 *
 *   node test/harness/run-all.js --out <dir>                    record only
 *   node test/harness/run-all.js --out <dir> --compare <dir>    record, then compare
 *   [--entry server.js]
 *
 * Conditions: two clock times (day shift, night shift) x two row modes
 * (empty results, filled results).
 */
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
const entry = path.resolve(args.entry || path.join(__dirname, '..', '..', 'server.js'));
const outDir = path.resolve(args.out || 'recordings');
fs.mkdirSync(outDir, { recursive: true });

const CONDITIONS = [
  { name: 'day-empty', now: '2026-11-05T10:30:00+03:00', rows: 'empty' },
  { name: 'day-fake', now: '2026-11-05T10:30:00+03:00', rows: 'fake' },
  { name: 'night-empty', now: '2026-11-05T23:40:00+03:00', rows: 'empty' },
  { name: 'night-fake', now: '2026-11-06T03:10:00+03:00', rows: 'fake' },
];

function record(c) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'record.js'), '--entry', entry,
      '--out', path.join(outDir, `${c.name}.json`), '--now', c.now, '--rows', c.rows], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', (code) => (code === 0 ? resolve(`${c.name}: ${out.trim().split('\n').pop()}`) : reject(new Error(`${c.name} failed (${code})`))));
  });
}

(async () => {
  const results = await Promise.all(CONDITIONS.map(record));
  results.forEach((r) => console.log(r));
  if (!args.compare) return;
  let failed = 0;
  for (const c of CONDITIONS) {
    console.log(`\n=== ${c.name}`);
    const r = spawnSync(process.execPath, [path.join(__dirname, 'compare.js'),
      path.join(path.resolve(args.compare), `${c.name}.json`), path.join(outDir, `${c.name}.json`)], { stdio: 'inherit' });
    if (r.status !== 0) failed++;
  }
  console.log(failed ? `\n✗ ${failed} condition(s) differ` : '\n✓ all conditions identical');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
