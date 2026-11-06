#!/usr/bin/env node
/*
 * Behaviour recorder. Development-only; never loaded by the production server.
 *
 * Loads a server entry file (normally server/server.js) WITHOUT touching real
 * systems, then replays test/harness/requests.json against it and writes a
 * recording of everything observable:
 *   - every SQL query (which database, SQL text, parameters), in order
 *   - every HTTP response (status, content type, JSON body or a hash of the body)
 *   - side effects: file writes/deletes, emails, cron/interval registrations
 *   - console output
 *
 * Replaced while recording:
 *   mysql2/promise  -> fake pools that log queries and return canned rows
 *   node-opcua      -> client that never connects
 *   nodemailer      -> transport that logs instead of sending
 *   node-cron, setInterval -> registered, never fired
 *   fs write/delete -> logged, not performed
 *   dotenv          -> no-op (the real .env is never read)
 *   Date, Math.random -> frozen clock (HARNESS_NOW) and seeded random
 *   app.listen      -> loopback server on a random port
 *
 * Usage:
 *   node test/harness/record.js --entry server.js --out rec.json \
 *        [--now 2026-11-05T10:30:00+03:00] [--rows empty|fake]
 */
'use strict';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
process.env.TZ = args.tz || 'Europe/Moscow';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const Module = require('module');

const ENTRY = path.resolve(args.entry || path.join(__dirname, '..', '..', 'server.js'));
const OUT = path.resolve(args.out || 'recording.json');
const ROWS_MODE = args.rows || 'empty';
const NOW = new Date(args.now || '2026-11-05T10:30:00+03:00').getTime();
const REQUESTS = require(path.join(__dirname, 'requests.json'));

// ---------------------------------------------------------------------------
// Recording context
// ---------------------------------------------------------------------------
const recording = { meta: { now: new Date(NOW).toISOString(), rows: ROWS_MODE }, startup: null, requests: [] };
let current = { queries: [], effects: [], logs: [] };
const startupCtx = current;

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
function safeArg(a) {
  if (a instanceof Error) return `Error: ${a.message}`;
  if (Buffer.isBuffer(a)) return `<buffer ${a.length} sha1:${sha1(a)}>`;
  if (typeof a === 'object' && a !== null) {
    try { return JSON.parse(JSON.stringify(a, errReplacer)); } catch { return String(a); }
  }
  return a;
}
function errReplacer(_k, v) { return v instanceof Error ? `Error: ${v.message}` : v; }
// Absolute paths of the checkout differ between machines/folders: replace with <root>.
function scrubPaths(obj) {
  const root = path.dirname(ENTRY);
  return JSON.parse(JSON.stringify(obj).split(JSON.stringify(root).slice(1, -1)).join('<root>'));
}
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');

// ---------------------------------------------------------------------------
// Frozen clock and seeded random
// ---------------------------------------------------------------------------
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
FrozenDate.UTC = RealDate.UTC;
FrozenDate.parse = RealDate.parse;
global.Date = FrozenDate;
let seed = 1;
Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// ---------------------------------------------------------------------------
// Timers: intervals are recorded, never run. setTimeout keeps working.
// ---------------------------------------------------------------------------
global.setInterval = (fn, ms) => { current.effects.push({ type: 'setInterval', ms }); return { unref() {}, ref() {} }; };
global.clearInterval = () => {};

// ---------------------------------------------------------------------------
// fs: writes and deletes are recorded, not performed
// ---------------------------------------------------------------------------
const realWriteFileSync = fs.writeFileSync;
fs.realWrite = (...a) => realWriteFileSync(...a);
const writeFns = ['writeFileSync', 'appendFileSync', 'unlinkSync', 'rmSync', 'renameSync', 'mkdirSync', 'copyFileSync', 'rmdirSync'];
for (const fn of writeFns) {
  fs[fn] = (p, data) => {
    current.effects.push({ type: `fs.${fn}`, path: relPath(p), size: data && data.length });
    return undefined;
  };
}
for (const fn of ['writeFile', 'appendFile', 'unlink', 'rm', 'rename', 'mkdir', 'copyFile']) {
  fs[fn] = (p, ...rest) => {
    const cb = rest.reverse().find((x) => typeof x === 'function');
    current.effects.push({ type: `fs.${fn}`, path: relPath(p) });
    if (cb) process.nextTick(cb, null);
  };
  fs.promises[fn] = async (p, data) => { current.effects.push({ type: `fs.promises.${fn}`, path: relPath(p), size: data && data.length }); };
}
function relPath(p) {
  // Paths are recorded relative to the folder of the entry file, so that the
  // location of uploads/ is part of what is compared.
  return path.relative(path.dirname(ENTRY), String(p)).split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// Fake database rows
// ---------------------------------------------------------------------------
function fakeValue(key, i) {
  const k = String(key);
  if (/vin/i.test(k)) return `LVTDB21B0RD00000${i + 1}`;
  if (/(time|date|_at$|^dt$|created|updated)/i.test(k)) return `2026-10-0${i + 1} 10:15:00`;
  if (/(cnt|count|total|num|qty|sum|amount|score|drr|dpu|percent|rate|^id$|_id$|hours|minutes|duration|value|voltage|week)/i.test(k)) return i + 1;
  return `${k}_${i}`;
}
function fakeRow(i) {
  return new Proxy({}, {
    get(_t, key) {
      if (typeof key === 'symbol' || key === 'toJSON' || key === 'then' || key === 'constructor') return undefined;
      return fakeValue(key, i);
    },
  });
}
function rowsFor(sql) {
  const isRead = /^\s*(\(?\s*SELECT|WITH|SHOW|DESCRIBE|EXPLAIN)/i.test(sql);
  if (!isRead) return { affectedRows: 1, insertId: 42, changedRows: 1, warningStatus: 0 };
  if (ROWS_MODE === 'empty') return [];
  return [fakeRow(0), fakeRow(1), fakeRow(2)];
}

function makePool(cfg) {
  const name = cfg.database || cfg.host || 'unknown';
  const run = async (sql, params) => {
    const text = typeof sql === 'object' && sql !== null ? sql.sql : sql;
    const p = Array.isArray(params) ? params : typeof sql === 'object' && sql !== null ? sql.values : params;
    current.queries.push({ db: name, sql: norm(text), params: safeArg(p === undefined ? null : p) });
    return [rowsFor(String(text)), []];
  };
  const conn = {
    query: run, execute: run, release() {}, destroy() {}, end: async () => {},
    beginTransaction: async () => { current.queries.push({ db: name, sql: 'BEGIN' }); },
    commit: async () => { current.queries.push({ db: name, sql: 'COMMIT' }); },
    rollback: async () => { current.queries.push({ db: name, sql: 'ROLLBACK' }); },
    ping: async () => {},
  };
  return {
    query: run, execute: run,
    getConnection: async () => conn,
    end: async () => {}, on() {}, pool: { config: { connectionConfig: cfg } },
    promise() { return this; },
  };
}

// ---------------------------------------------------------------------------
// Module replacements
// ---------------------------------------------------------------------------
let capturedApp = null;
let listening = null;
const listenPromise = new Promise((r) => { listening = r; });
const realExpress = require('express');
function expressWrapper(...a) {
  const app = realExpress(...a);
  app.listen = (...la) => {
    const cb = la.find((x) => typeof x === 'function');
    const srv = http.createServer(app).listen(0, '127.0.0.1', () => { listening(srv); if (cb) cb(); });
    return srv;
  };
  if (!capturedApp) capturedApp = app;
  return app;
}
Object.assign(expressWrapper, realExpress);
Object.setPrototypeOf(expressWrapper, Object.getPrototypeOf(realExpress));

const fakeOpcClient = {
  connect: () => new Promise(() => {}), // never connects, never fails: polling loop stays parked
  createSession: () => new Promise(() => {}),
  disconnect: async () => {}, on() {},
};
const stubs = {
  'mysql2/promise': { createPool: makePool, createConnection: async (cfg) => (await makePool(cfg).getConnection()) },
  'mysql2': { createPool: (cfg) => makePool(cfg) },
  'dotenv': { config: () => ({ parsed: {} }) },
  'node-opcua': new Proxy({
    OPCUAClient: { create: () => fakeOpcClient },
    MessageSecurityMode: { None: 1, Sign: 2, SignAndEncrypt: 3 },
    SecurityPolicy: { None: 'None' },
    AttributeIds: { Value: 13 },
  }, { get: (t, k) => (k in t ? t[k] : {}) }),
  'nodemailer': {
    createTransport: (cfg) => ({
      sendMail: async (m) => {
        current.effects.push({ type: 'email', port: cfg && cfg.port, to: m.to, cc: m.cc, subject: m.subject,
          html: m.html && sha1(String(m.html)), attachments: (m.attachments || []).map((x) => x.filename) });
        return { messageId: 'fake' };
      },
      verify: async () => true,
    }),
  },
  'node-cron': {
    schedule: (expr) => { current.effects.push({ type: 'cron', expr }); return { start() {}, stop() {} }; },
    validate: () => true,
  },
  'express': expressWrapper,
};
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad.call(this, request, parent, isMain);
};

// Fixed environment: pool names come from the *_NAME variables.
Object.assign(process.env, {
  DB_NAME: 'main', NOTES_NAME: 'notes', MES_NAME: 'mes', LES_NAME: 'les', BMS_NAME: 'bms',
  DB_HOST: 'h', NOTES_HOST: 'h', MES_HOST: 'h', LES_HOST: 'h', BMS_HOST: 'h',
});
for (const k of ['PORT', 'BRIGADE_PASSWORD', 'IMPORT_PASSWORD', 'BRIGADE_MANAGE_PASSWORD',
  'EXCHANGE_HOST', 'EXCHANGE_USER', 'EXCHANGE_PASS', 'EXCHANGE_FROM', 'EXCHANGE_FROM_NAME',
  'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'OPC_ENDPOINT', 'OPC_NODE_ID']) delete process.env[k];

// Console capture
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (...a) => { current.logs.push([level, ...a.map(safeArg)]); };
}
const realExit = process.exit.bind(process);
process.exit = (code) => { current.effects.push({ type: 'process.exit', code }); throw new Error(`process.exit(${code})`); };
process.on('unhandledRejection', (e) => { current.effects.push({ type: 'unhandledRejection', message: e && e.message }); });

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const settle = () => new Promise((r) => setTimeout(r, 30));

async function main() {
  process.chdir(path.dirname(ENTRY));
  require(ENTRY);
  const srv = await Promise.race([listenPromise, new Promise((_, rej) => setTimeout(() => rej(new Error('server did not call listen()')), 5000))]);
  await settle();
  recording.startup = scrubPaths(startupCtx);
  const port = srv.address().port;

  for (const r of REQUESTS) {
    current = { queries: [], effects: [], logs: [] };
    seed = 1;
    const qs = new URLSearchParams(r.query || {}).toString();
    const url = `http://127.0.0.1:${port}${r.path}${qs ? `?${qs}` : ''}`;
    const init = { method: r.method, headers: {} };
    if (r.body !== undefined && r.method !== 'GET') {
      init.body = JSON.stringify(r.body);
      init.headers['content-type'] = 'application/json';
    }
    const entry = { request: `${r.method} ${r.path}${qs ? `?${qs}` : ''}${init.body ? ` ${init.body}` : ''}` };
    try {
      const res = await fetch(url, init);
      const buf = Buffer.from(await res.arrayBuffer());
      const ctype = res.headers.get('content-type') || '';
      entry.status = res.status;
      entry.type = ctype.split(';')[0];
      if (ctype.includes('application/json')) {
        entry.body = JSON.parse(buf.toString('utf8'), (k, v) => (k === 'stack' && typeof v === 'string' ? v.split('\n')[0] : v));
      } else {
        entry.body = buf.length ? `<${buf.length} bytes sha1:${sha1(buf)}>` : '';
      }
    } catch (e) {
      entry.status = 'FETCH_ERROR';
      entry.body = e.message;
    }
    await settle(); // let fire-and-forget work finish so it is attributed to this request
    Object.assign(entry, current);
    recording.requests.push(scrubPaths(entry));
  }

  fs.realWrite(OUT, JSON.stringify(recording, null, 1));
  const failed = recording.requests.filter((x) => x.status === 'FETCH_ERROR').length;
  const counts = recording.requests.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {});
  process.stdout.write(`recorded ${recording.requests.length} requests -> ${OUT}\nstatus counts: ${JSON.stringify(counts)}${failed ? `\n${failed} fetch errors` : ''}\n`);
  srv.close();
  realExit(0);
}

main().catch((e) => { process.stderr.write(`recorder failed: ${e.stack}\n`); realExit(1); });
