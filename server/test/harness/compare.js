#!/usr/bin/env node
/*
 * Compares two recordings made by record.js.
 *   node test/harness/compare.js before.json after.json
 * Exit code 0 = identical behaviour, 1 = differences (printed).
 */
'use strict';
const util = require('util');
const [a, b] = process.argv.slice(2).map((p) => require(require('path').resolve(p)));
let diffs = 0;
const MAX_SHOWN = Number(process.env.MAX_SHOWN || 25);

function show(label, x, y) {
  diffs++;
  if (diffs > MAX_SHOWN) return;
  console.log(`\n✗ ${label}`);
  console.log('  before:', util.inspect(x, { depth: 6, breakLength: 160 }).slice(0, 1500));
  console.log('  after: ', util.inspect(y, { depth: 6, breakLength: 160 }).slice(0, 1500));
}
const same = (x, y) => util.isDeepStrictEqual(x, y);

function compareCtx(label, x, y) {
  for (const key of ['status', 'type', 'body']) {
    if (!same(x[key], y[key])) show(`${label} — ${key}`, x[key], y[key]);
  }
  for (const key of ['queries', 'effects', 'logs']) {
    const xs = x[key] || [], ys = y[key] || [];
    const n = Math.max(xs.length, ys.length);
    for (let i = 0; i < n; i++) {
      if (!same(xs[i], ys[i])) { show(`${label} — ${key}[${i}] (before ${xs.length}, after ${ys.length})`, xs[i], ys[i]); break; }
    }
  }
}

if (!same(a.meta, b.meta)) show('meta (recordings were made with different settings)', a.meta, b.meta);
compareCtx('startup', a.startup, b.startup);
if (a.requests.length !== b.requests.length) show('number of requests', a.requests.length, b.requests.length);
// Routes removed on purpose: the request must now get 404 and touch nothing.
const removed = require('./removed-routes.json').routes.map((s) => {
  const [method, route] = s.split(' ');
  return { method, re: new RegExp(`^${route.replace(/:[A-Za-z_]+/g, '[^/?]+')}(\\?|$| )`) };
});
const isRemoved = (req) => {
  const [method, rest] = [req.slice(0, req.indexOf(' ')), req.slice(req.indexOf(' ') + 1)];
  return removed.some((r) => r.method === method && r.re.test(rest));
};
let removedChecked = 0;
const byReq = new Map(b.requests.map((r) => [r.request, r]));
for (const r of a.requests) {
  const o = byReq.get(r.request);
  if (!o) { show(`missing in after: ${r.request}`, r.status, undefined); continue; }
  if (isRemoved(r.request)) {
    removedChecked++;
    if (o.status !== 404 || o.queries.length || o.effects.length) show(`${r.request} — removed route should be 404 with no effects`, r.status, { status: o.status, queries: o.queries.length, effects: o.effects.length });
    continue;
  }
  compareCtx(r.request, r, o);
}
const total = a.requests.length;
if (diffs === 0) {
  console.log(`✓ identical: startup + ${total - removedChecked} requests${removedChecked ? ` (+${removedChecked} to removed routes now 404)` : ''} (${a.requests.reduce((s, r) => s + r.queries.length, 0)} queries)`);
  process.exit(0);
}
console.log(`\n${diffs} difference(s)${diffs > MAX_SHOWN ? ` (first ${MAX_SHOWN} shown)` : ''}`);
process.exit(1);
