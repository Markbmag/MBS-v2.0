#!/usr/bin/env node
/*
 * Builds test/harness/requests.json: the list of HTTP requests the recorder sends.
 *
 * It reads a server source file (by default the original monolithic server.js),
 * finds every route, collects the query/body parameter names each handler reads,
 * and creates several request variants per route (no params, typical params, and
 * one variant per value of the parameters that switch code paths).
 *
 * The generated list is committed, so the same input is used before and after any
 * refactor. Re-run only on purpose:  node test/harness/gen-requests.js [server.js]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const lines = src.split('\n');

// ---- locate routes and the text of their handlers --------------------------
const routeRe = /^app\.(get|post|put|delete|patch)\('([^']+)'/;
const starts = [];
lines.forEach((l, i) => {
  const m = l.match(routeRe);
  if (m) starts.push({ line: i, method: m[1].toUpperCase(), path: m[2] });
});
const topLevelRe = /^(app\.|function |async function |const |let |var |setInterval|\/\/ =|\/\*)/;
for (const r of starts) {
  let end = r.line + 1;
  while (end < lines.length && !topLevelRe.test(lines[end])) end++;
  r.body = lines.slice(r.line, end).join('\n');
}

function namesFrom(body, objName) {
  const out = new Set();
  for (const m of body.matchAll(new RegExp(`req\\.${objName}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g'))) out.add(m[1]);
  for (const m of body.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*=\\s*req\\.${objName}\\b`, 'g'))) {
    for (const part of m[1].split(',')) {
      const n = part.split('=')[0].split(':')[0].trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) out.add(n);
    }
  }
  return [...out].sort();
}

// ---- values -----------------------------------------------------------------
const VIN1 = 'LVTDB21B0RD000001';
const VIN2 = 'LVTDB21B0RD000002';
function baseValue(name) {
  const n = name.toLowerCase();
  if (n === 'starttime') return '2026-10-01 08:00:00';
  if (n === 'endtime') return '2026-10-02 08:00:00';
  if (/^(datefrom|fromdate|weekstart|cp8start|from|start)$/.test(n)) return '2026-10-01';
  if (/^(dateto|todate|weekend|cp8end|to|end)$/.test(n)) return '2026-10-07';
  if (/^(date|uploadedat|day)$/.test(n)) return '2026-10-05';
  if (n === 'vin') return VIN1;
  if (n === 'vins') return `${VIN1},${VIN2}`;
  if (n === 'model') return 'M1';
  if (n === 'models') return 'M1,M2';
  if (n === 'periods') return '2026-10,2026-09';
  if (/^(count|days|weeks|limit|limitbefore|limitafter|hour|offset|page)$/.test(n)) return '3';
  if (n === 'password') return '1234561';
  if (n === 'shift') return 'all';
  if (n === 'period') return 'week';
  if (n === 'periodtype') return 'week';
  if (n === 'checkpoint') return 'ALL';
  if (n === 'defecttype') return 'online';
  if (n === 'timefilter') return 'all';
  if (n === 'shiftletter') return 'A';
  if (n === 'filter') return 'all';
  return `${name}_v`;
}
const BRANCHES = {
  period: ['day', 'week', 'month', 'year', 'all', 'custom'],
  periodType: ['day', 'week', 'month'],
  shift: ['all', 'day', 'evening', 'night', 'A', 'B', 'C'],
  checkpoint: ['ALL', 'CP7', 'CP8', 'PIP', 'TL', 'Key_Uloc_Type_TRIMIN', 'Inbound'],
  defectType: ['online', 'offline', 'all'],
  timeFilter: ['all', 'day', 'evening', 'night'],
  filter: ['all', 'cp7', 'tup', 'body'],
  shiftLetter: ['ALL', 'A', 'B', 'C'],
  password: ['1234561', '4002', 'wrong'],
};
function pathParamValue(name) {
  if (name === 'vin') return VIN1;
  if (name === 'id') return '1';
  if (name === 'filename') return 'nofile_123.jpg';
  if (name === 'type') return 'cp7';
  return `${name}_v`;
}
function bodyValue(name) {
  const n = name.toLowerCase();
  if (['entries', 'rows', 'mappings'].includes(n)) {
    return [{ model: 'M1', part_name: 'P1', problem_type: 'T1', vin: VIN1, name: 'N1', zone: 'Z1', defect_name: 'D1', value: 1 }];
  }
  if (n === 'data') return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
  if (n === 'mime') return 'image/jpeg';
  if (n === 'score') return 5;
  return baseValue(name);
}

// ---- build the list ---------------------------------------------------------
const requests = [];
const seen = new Set();
function add(r) {
  const key = JSON.stringify(r);
  if (seen.has(key)) return;
  seen.add(key);
  requests.push(r);
}
for (const r of starts) {
  const urlPath = r.path.replace(/:([A-Za-z_]+)/g, (_, n) => encodeURIComponent(pathParamValue(n)));
  const extraPaths = [];
  if (r.path === '/api/drr-weekly-analytics/:type') for (const t of ['adas', 'cpfinal', 'pip', 'bad']) extraPaths.push(r.path.replace(':type', t));
  const q = namesFrom(r.body, 'query');
  const b = namesFrom(r.body, 'body');
  const base = Object.fromEntries(q.map(n => [n, baseValue(n)]));
  const bodyBase = Object.fromEntries(b.map(n => [n, bodyValue(n)]));
  const isGet = r.method === 'GET';

  for (const p of [urlPath, ...extraPaths]) {
    if (isGet) {
      add({ method: r.method, path: p, query: {} });
      if (q.length) add({ method: r.method, path: p, query: base });
      for (const n of q) {
        for (const v of BRANCHES[n] || []) add({ method: r.method, path: p, query: { ...base, [n]: v } });
      }
      // a custom date range for routes that accept one
      if (q.includes('period') && (q.includes('fromDate') || q.includes('dateFrom'))) {
        add({ method: r.method, path: p, query: { ...base, period: 'custom' } });
      }
    } else {
      add({ method: r.method, path: p, query: {}, body: {} });
      if (b.length) add({ method: r.method, path: p, query: {}, body: bodyBase });
      if (b.includes('password')) {
        for (const v of BRANCHES.password) add({ method: r.method, path: p, query: {}, body: { ...bodyBase, password: v } });
      }
      if (q.length) add({ method: r.method, path: p, query: base, body: bodyBase });
    }
  }
}

const out = path.join(__dirname, 'requests.json');
fs.writeFileSync(out, JSON.stringify(requests, null, 1) + '\n');
console.log(`${starts.length} routes -> ${requests.length} requests written to ${out}`);
