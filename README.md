# Ncode - universal database search

Type a phrase, pick a database, and Ncode searches **every table and text column**
for it, showing matching rows with the matching fields highlighted. Works with
MySQL / MariaDB, PostgreSQL, SQL Server and SQLite (via SQLAlchemy).

Ncode is growing into a self-hosted data work and analysis platform (question builder, SQL
editor, charts, dashboards). The plan and its milestones are in [docs/ROADMAP.md](docs/ROADMAP.md).

- **Connect databases from the UI** - no config files, no code (admins only).
- **Choose where to search** - all tables, hand-picked tables, or skip patterns like `log_*`.
- **Browse tables** - page through any table, sort by a column, filter rows, see its structure.
- **Ask questions without SQL** - pick a table, join related tables, filter, summarise (sum, count,
  average ... by month, by region) and sort, with a live preview. One click shows the SQL.
- **Charts** - bar, line, area, combo, pie/donut, scatter/bubble, number (KPI), gauge, pivot
  table, histogram, heatmap and funnel; picked automatically, adjustable, downloadable as PNG/SVG,
  results as CSV or Excel.
- **SQL editor** - read-only SQL with autocomplete from your schema, `{{parameters}}`, history and
  formatting; unsafe statements are refused before they reach the database.
- **Combine databases and files** - join results from several databases and uploaded CSV / Excel /
  Parquet files on a key (e.g. VIN), with a report of the keys that found no match.
- **Analyse** - profile any table or result column by column, get an automatic X-ray dashboard,
  compare with last month / last year, running totals, shares, ranks, outliers, trend lines.
- **Data model** - friendly column names and formats, dates stored as text read as real dates,
  relationships for databases without foreign keys, and named metrics everyone shares.
- **Subscriptions and alerts** - dashboards and questions by email, Slack, Teams, Telegram or
  webhook on a schedule, with CSV / Excel attached; alerts when a number crosses a line.
- **Share outside Ncode** - public links (password, expiry) and signed embedding in other websites.
- **Export to CSV** - from results, or stream a whole table / all matches (up to 50,000 rows by default).
- **Team ready** - users and groups, row-level security, an audit log, usage and slow-query reports,
  backups, English and Russian.
- **Production ready** - Docker Compose with automatic HTTPS (Caddy), health checks and Prometheus metrics, CI.

## Quick start

**With Docker** (a server for your team, HTTPS included):

    cp backend/.env.example backend/.env          # database connections, secret key
    echo "NCODE_SITE=ncode.company.local" > .env  # the address people will use
    docker compose up -d --build
    docker compose exec backend python -m app.manage create-user yourname --admin

**Without Docker** (development, or one PC):

    cd backend && python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
    pip install -r requirements.txt && cp .env.example .env
    python -m app.manage create-user yourname --admin
    uvicorn app.main:app --reload --port 8000

    cd frontend && npm install && npm run dev      # then open http://localhost:5173

Details, upgrades, backups and monitoring: [docs/guide/install.md](docs/guide/install.md).

## Documentation

| | |
|---|---|
| [Installing and running](docs/guide/install.md) | Docker and HTTPS, running without Docker, upgrades, tests, backups, health and metrics |
| [Using Ncode](docs/guide/using.md) | databases, search, questions, library, SQL, charts, combining sources, analysis, data model, dashboards, subscriptions and sharing |
| [Administration](docs/guide/admin.md) | users and groups, row-level security, audit log, delivery, sharing, backups, languages |
| [Security](docs/guide/security.md) | what protects your databases and data, and what is up to you |
| [API reference](docs/guide/api.md) | every endpoint |
| [Roadmap and changelog](docs/ROADMAP.md) | the plan, decisions and what each milestone delivered |
| [Checklists](docs/checklists/) | manual test lists per milestone |
