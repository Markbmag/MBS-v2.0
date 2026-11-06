# MBS Quality

Internal web portal with quality dashboards and reports (DRR by checkpoint, defects,
SGP, warranty, brigades, VRT, voltage SPC, line defect capture, and more).

## Parts

| Folder    | What it is                                                     | Port  |
|-----------|----------------------------------------------------------------|-------|
| `client/` | React app (Vite). Pages are listed in `client/src/App.jsx`.    | 30000 |
| `server/` | Node.js + Express API, all routes under `/api`.                | 40000 |

The Vite dev server forwards `/api` requests to `http://localhost:40000`
(`client/vite.config.js`).

Server layout:

```
server/
  server.js        entry point: loads .env, then every module below in a fixed order
  mailer.js        e-mail sending
  src/app.js       Express app and middleware
  src/db.js        database pools and connection checks
  src/config/      page passwords
  src/services/    OPC UA polling
  src/routes/      API routes by page/topic (DRR checkpoints under routes/drr/)
  src/lib/         helpers shared by several modules
  uploads/         stored photos (created at start)
```

The order of `require` lines in `server/server.js` matters: it fixes the order of
Express routes and of background jobs.

The server uses five MySQL databases (main, LES, MES, notes, BMS), reads one value
from a PLC over OPC UA, and sends e-mail through Exchange/SMTP.

## Running

For everyday use on the Windows server (built pages, automatic restart, log files,
auto-start) see **[docs/DEPLOY.md](docs/DEPLOY.md)** — in short: `start-mbs.bat`.
The development way below keeps working.

Server:

```bash
cd server
npm install
npm run dev
```

Settings are read from `server/.env`. See `server/.env.example` for the full list.
Page passwords (`BRIGADE_PASSWORD`, `IMPORT_PASSWORD`) exist only in `server/.env`;
the pages check them through `POST /api/check-password`.
The server stops at start if the main or LES database is unreachable; the notes and
BMS databases are optional at start.

Client:

```bash
cd client
npm install
npm run dev
```

## Monitoring and backup

* `GET /api/health` — state of every database, the PLC (OPC UA) link, when each DRR
  snapshot was last saved, and the last backup. HTTP 200 when the main and LES
  databases work, 503 otherwise.
* Nightly backup of the notes database and `server/uploads` — set `BACKUP_DIR` in
  `server/.env` (see `server/.env.example`). Files: `mbs_YYYY-MM-DD_HHMM.sql`
  (restore with any MySQL client, e.g. HeidiSQL "Load SQL file") and `uploads/`.

## Changing server code safely

`server/test/harness` records what the server does for 823 requests covering
every route, without connecting to any database. Run `npm run harness:baseline`
in `server/` before a change and `npm run harness:verify` after it. See
`server/test/harness/README.md`.
