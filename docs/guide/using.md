# Using Ncode

Databases, search, questions, the library, the SQL editor, charts, combining sources, analysis,
the data model, dashboards, subscriptions and sharing. Setup is in [install.md](install.md), administration in
[admin.md](admin.md).

## Adding a database

### From the interface (recommended)

Sign in as an admin and click **Add a database** in the sidebar:

1. Pick the database type (or paste a connection string such as
   `postgresql://user:password@host:5432/dbname` and the form is filled in for you).
2. Fill in the server, database name, user and password.
3. Click **Check connection**. You see the number of tables found, or a plain-language reason
   why it failed (wrong password, host unreachable, driver missing...).
4. **Save**. The database is searchable immediately.

Passwords are stored **encrypted** (AES via Fernet) in `backend/data/ncode.sqlite` and never sent
back to the browser. Edit or remove a connection with the pencil icon next to it.

> **Back up the encryption key.** It is created automatically as `backend/data/secret.key`
> (or set `NCODE_SECRET_KEY`; make one with `python -m app.manage generate-key`).
> Without it, saved passwords cannot be recovered - you would have to enter them again.

A database type shows **driver missing** until its Python driver is installed on the server,
for example `pip install psycopg[binary]` for PostgreSQL. Restart the backend afterwards.

SQLite connections point to a file path **on the machine running the backend**.

### From `.env` (optional)

Add a group of `NCODE_CONN_<KEY>_*` variables to `backend/.env` (see `.env.example`) and restart.
These connections show a lock icon and can only be changed in the file. If the same key exists
in both places, `.env` wins.

`NCODE_CONN_<KEY>_ID_HINTS=vin,serial` (or "Record identifier columns" in the UI) makes columns
whose name contains one of these words show up as the record's badge in the results list.

Use a **read-only** database account.

## Search options

| Option | Meaning |
|---|---|
| `match_mode` | `contains` (default), `exact`, `starts_with` |
| `case_sensitive` | default off. On MySQL/SQL Server the DB collation may still ignore case; results are re-checked in Python so you may get fewer rows |
| `include_numeric` / `include_dates` | also search number / date columns (only when the phrase looks like one) |
| `row_limit` | rows returned per table (default 10, max 200) |
| `tables` | exact table names to search (the picker in the UI); empty = all |
| `include_tables` / `exclude_tables` | glob patterns, e.g. `["log_*"]` |

Binary columns (BLOBs) are never searched or returned.

## Questions (no SQL needed)

**New question** in the sidebar is a step-by-step builder for the database selected in the sidebar:

1. **Data** - the table to start from.
2. **Join** - *Join data* lists the tables related by foreign keys (also through tables in
   between, e.g. customers → orders → products) and joins them automatically. Other tables can be
   joined on columns you choose.
3. **Custom columns** - formulas such as `[total] - [discount]`, `round([total] / [qty], 2)`,
   `coalesce([status], 'none')` or `case([total] >= 100, 'big', 'small')`.
4. **Filter** - conditions that fit the column type (text contains, number between, dates "in the
   last 30 days" / "this month" ...), combined with *all* / *any* and nested groups.
5. **Summarise** - metrics (count, number of distinct, sum, average, min, max) grouped by columns;
   dates can be grouped by day, week (Monday), month, quarter or year, numbers in ranges.
6. **Filter the summary**, **Sort**, **Row limit**.

The result updates as you build (*Live preview*; turn it off for slow databases and press **Run**
or Ctrl/Cmd+Enter). **View SQL** shows the exact SQL; **Open in SQL editor** continues there.
An unsaved question is kept while the browser tab is open; **Save** puts it in the library.

## Library: saving and sharing

**Save** (builder or SQL editor) stores the question, its chart and its parameters in a
**collection**. **Library** in the sidebar lists them:

- *Start*: your favourites (the star) and recently changed questions; the search box finds
  questions by name or description.
- *My collection* is private: only you (and admins) see it. Create other collections (and
  collections inside them) with **+**; a new top-level collection is yours.
- **Share** (on a collection you own) gives people *Can view* or *Can edit*, by name or to
  *Everyone*. Access covers the collections inside it too. Editors can save, move and archive
  questions; only the owner and admins can share, move or archive the collection itself. Running a
  question still needs access to its database (`python -m app.manage allow ...`).
- An opened question shows *edited* when it differs from what is saved: **Save** updates it,
  the **⋯** menu has *Save as new question*, *Discard changes*, *Rename*, *Duplicate*, *Move* and
  *Archive*. People with view access can only *Save as new* (into a collection of theirs).
- **Archive** keeps archived questions and collections; restore them or delete them for good.

**Parameters** let one question answer many variants. In SQL, every `{{name}}` becomes an input
(the ⚙ next to it sets label, type text/number/date, default and *required*). In the builder,
the sliders button on a filter (*Ask for the value*) turns it into a parameter: its value is asked for above the result, and
without a value the filter is left out. The values are part of the link (`?p.region=EU`), so a
link opens the question with the same values. Dashboard filters (M5) will set them.

### Importing from DataDesk

    cd backend
    python -m app.manage import-datadesk path/to/app-data.sqlite --map db1=mes,db2=crm --dry-run
    python -m app.manage import-datadesk path/to/app-data.sqlite --map db1=mes,db2=crm --report import.md

`--map` says which Ncode connection each DataDesk database is. The dry run only prints the report;
without it, everything goes into a collection **DataDesk import** owned by `--owner` (default: the
first admin). Each DataDesk dashboard becomes a dashboard, in a sub-collection of the same name that
also holds its reports (cards two per row). Single-table reports become builder questions,
SQL reports SQL questions (only if they pass the read-only check), multi-database reports wait for
multi-source questions (each source joined to the first on its key column with a FULL JOIN, as
DataDesk merged them - but Ncode keeps every row, where DataDesk kept only the last row per key).
The report lists every report and why something was not converted. DataDesk's file is only read;
running the import again skips what was imported before, creates the dashboards of an import made
before dashboards existed and converts multi-database reports that an earlier import kept as
placeholders ("upgraded").

## SQL editor

**SQL editor** in the sidebar: the database's tables and columns on the left (click to insert a
name, *SELECT* to insert a query), the editor, and the result below.

- Ctrl/Cmd+Enter runs the query, or only the selected part. *Stop* cancels it in the database.
- Autocomplete knows your tables and columns; *Format* tidies the SQL; *History* keeps your last
  queries (in this browser only).
- `{{name}}` in the SQL becomes an input field; values are sent as parameters, never pasted into
  the SQL. Its ⚙ sets the type (text, number, date), a default and a label.
- A badge says whether the query passes the read-only check before you run it.

Both pages share the result grid: it scrolls smoothly through thousands of rows, columns can be
resized by dragging the header edge, a click selects a cell and Ctrl/Cmd+C (or a double-click)
copies it. **Smart dates** shows dates stored as text (`31.01.2026`) or unix time as real dates.
Results can be downloaded as CSV.

## Charts

Every result (question or SQL) has a **Table / Chart** switch. *Chart* picks a chart from the shape
of the result (one number → a number tile, a date and numbers → a line, a category and numbers →
bars, two categories and a number → stacked bars or a heatmap ...); the *auto* badge says so.
Choose another type in the list or open **Settings**:

- axes and series, *Split into one series per* (a second column, e.g. one line per region),
  side by side / stacked / 100 %, horizontal bars, value labels, a goal line, "only the largest N"
  (the rest is added up as *Other*), axis titles and ranges, legend position;
- *Highlight one series* (the others turn grey) and a fixed colour per series, which it keeps
  even when a filter removes other series;
- number formats per column: currency, percent, decimals, 1.2K style, prefix/suffix;
- pivot table: rows, columns, values (sum, average, count, min, max) and totals.

Charts follow a few rules on purpose: one y-axis only (two scales on one chart suggest links that
are not there; Ncode says when two series differ too much in size), at most 8 colours (smaller
series are added up as *Other*), at most 6 pie slices, and colours tested for colour-blind
readers in both themes. **Download** offers CSV, an **Excel workbook** (numbers and dates as real
Excel values) and, for charts, **PNG** or **SVG**. *Reset* returns to the automatic chart.
Admins find every chart type with sample data under **Admin → Chart gallery**.

## Combining sources and uploads

**Combine** in the sidebar builds a *multi-source question*:

1. **Sources** (up to 6): a saved question, a table, SQL on any of your databases, or an uploaded
   file. Each source is read on its own database (at most `NCODE_FEDERATION_SOURCE_ROWS` rows,
   100,000 by default) and gets a short name used by the joins and in SQL (`mes_builds`).
2. **Join**: every further source is joined to the ones above it - *keep all rows on the left*
   (LEFT JOIN), *only rows with a match* (INNER), *keep all rows on both sides* (FULL) or on the
   right - on up to four key columns. Ncode suggests a key when both sides have a column with the
   same name. Keys are compared *automatically* (numbers as numbers, text trimmed), *as text*,
   *as text ignoring case*, *as numbers* or *exactly as stored*. **Write SQL instead** combines the
   sources with your own SELECT over their names (DuckDB SQL; read-only, no files, no settings).
3. Then filter, summarise, sort and chart the combined rows exactly like a question - and save it.

**Match report** (next to the result) shows, per join, how many keys on each side found no
partner ("37.5 % of MES builds keys have no match in LES shipments (15 of 40)"), examples of such
keys, keys that repeat (each repeat multiplies rows - the totals grow) and empty keys. A source that
returned more rows than allowed is flagged, because the combination then only sees the first rows.

Saved multi-source questions behave like the others: they live in collections, go on dashboards
(dashboard filters can target a column of the combined rows or a parameter) and take parameters:
filters set to *ask for the value*, `{{name}}` in SQL, and the parameters of saved questions used as
sources (a value is passed on to every source question with a parameter of that name). Viewing one
never grants more than you already have: every source still needs your access to its database,
question or file.

**Uploads** (sidebar) takes CSV / TSV (separator and encoding detected, or chosen), Excel `.xlsx`
(first sheet or a named one) and Parquet, up to `NCODE_DATASET_MAX_MB` (100 MB) and
`NCODE_DATASET_MAX_ROWS` (1,000,000 rows). Column types are recognised (numbers, dates such as
`01.09.2026`, date-times, text); a column that mixes numbers and text stays text. Ncode keeps its own
compact copy in `backend/data/datasets/` (back it up with `ncode.sqlite`), not the original file.
Uploaded files live in collections, like questions. `NCODE_UPLOADS_ENABLED=false` turns uploads off.

Everything is combined in an in-process **DuckDB** (installed by `requirements.txt`), with memory
and thread limits (`NCODE_FEDERATION_MEMORY_MB`, `NCODE_FEDERATION_THREADS`) and, before anything you
wrote runs, no access to files, the network, extensions or its own settings.

## Analysing: profiles, X-ray, calculations

- **Profile** (Browse → a table → *Profile*, or *Profile* above any result): per column the empty
  values, distinct values, min / median / mean / max, a histogram, the most common values, outliers
  (beyond 1.5 × the interquartile range), and for text that looks like dates a hint to read it as
  dates. Numbers get a correlation table ("how they move together"). A table profile reads at most
  `NCODE_PROFILE_SAMPLE_ROWS` rows (20,000) plus one row count - the cost guard; a result profile
  uses the rows on screen and runs no query.
- **X-ray** (Browse → *X-ray*, Admin → Data model, or a saved question's **⋯** → *X-ray*): a first
  dashboard made from the profile - number of rows, sums of the main numbers, rows and sums over
  time, rows per category, distributions. For a question it keeps the question's joins and filters.
  *Save as dashboard* turns every card into a saved question in your collection.
- **Calculate** (a step in the builder and in Combine, *Calculations* in the SQL editor): on the rows
  returned - *compare with previous* (the same series one day / week / month / quarter / year earlier,
  matched by date, so a missing month is not mistaken for the previous one), *% change*, *running
  total*, *moving average*, *% of total* and *rank* (overall or within a group), *flag outliers*. A
  series is one value of the other columns (one region), so a running total restarts per region.
- Charts (line, bar, area) have a **trend line** and an optional **forecast** that continues it a
  few periods (a straight line, not a prediction model).

## Data model (admins)

**Admin → Data model**, per database:

- Click a column to give it a **display name** and a **description** (shown in the builder, in result
  headers and tooltips), say **what it is** (money, percentage, category, id ...), set a **format**
  (money in EUR, percent, decimals - used by tables and charts unless a chart sets its own; sums,
  averages, minima and maxima of the column keep it), **hide** it (not offered in the builder and not
  in "all columns"; still usable by name - not a permission) or **read it as dates**: text such as
  `2026-01-31`, `31.01.2026 08:15` or unix time (seconds or milliseconds) becomes a real date-time
  in the database's own SQL, so filters and "by month" work; other values become empty. On
  PostgreSQL an impossible date like `31.02.2026` stops the query; elsewhere it becomes empty
  (SQLite moves it to 3 March).
- **Relationships added by hand** for databases without foreign keys: the builder then joins and
  suggests joins as if they were foreign keys. The database is not changed.
- **Metrics**: a named calculation on a table - e.g. *Paid revenue* = sum of total where status is
  paid - picked in Summarise (*★ Saved metric*). Changing a metric changes every question that uses
  it; archiving hides it from the picker while saved questions keep working.
- A saved question's **⋯ → Use as a model** makes it a starting point like a table: *New question* →
  *… or start from a model*, and Combine.

Everyone who may use a database sees its data model; only admins change it.

## Dashboards

**Dashboards** in the sidebar → **New dashboard** (name and collection) opens it in edit mode:

- **Question** adds a saved question as a card, **Text** a note (Markdown: `# heading`, `**bold**`,
  `*italic*`, lists, links), **Heading** a section title. Drag a card by its title bar, resize it
  from the bottom-right corner; the ✎ on a card changes its title, the table/chart button how it is
  shown on this dashboard (the question itself is not changed).
- **Tab** splits the dashboard into tabs (double-click a tab to rename it).
- **Filters** adds dashboard filters - date range, single date, list of values, text, number - with
  a default and *required*. For each card choose what the filter changes: a **parameter** of the
  question (`{{name}}` in SQL, a filter set to *ask for the value* in the builder; a parameter with
  the same name is connected automatically) or, for questions built without SQL, a **column**
  directly. A date range on a single-date parameter passes its start date ("since").
- **Save** keeps the layout, **Cancel** throws the changes away.

Viewing: change a filter and only the cards it is connected to run again (the badge on a card says
how many filters apply to it). Filter values and the tab are part of the link, so a link opens the
same view. ↻ refreshes every card (bypassing the cache); auto-refresh every 30 s ... 15 min (saved
with the dashboard as its default). **TV mode** shows the dashboard alone, full screen. The **⋯** of
a card opens its question in the editor (with the filter values as parameters) and downloads the
card as CSV, Excel or PNG; the dashboard's **⋯** has *Print / save as PDF*, *Duplicate*, *Rename*,
*Move* and *Archive*. Cards load a few at a time (as many as `NCODE_MAX_CONCURRENT_QUERIES` allows).

Dashboards live in collections and follow their sharing. A dashboard never shows more than the
viewer may see: a card whose question is not shared with them says so, and running a card still
needs access to its database. Editors can rearrange cards they cannot see but not add such questions.

## Subscriptions, alerts and sharing

**Subscriptions** send a dashboard or a saved question on a schedule: the bell button on a dashboard
or question → *New subscription*.

- **When:** every hour (at a minute, on chosen days), daily (on chosen days, e.g. weekdays at 08:00),
  weekly or monthly (a day of the month or the last day), in your browser's time zone - 08:00 stays
  08:00 when the clocks change.
- **To:** Ncode users (their own email address: the account button (envelope) next to your name, bottom
  left), other addresses, and the chats and webhooks an admin set up (Slack, Microsoft Teams,
  Telegram, any JSON webhook).
- **What:** the email shows each card - headline numbers, bar lists for charts, the first rows of
  tables (*Rows shown per card*) - with links back to Ncode, a note of your own on top, and
  optionally every result as **CSV or Excel attachments** (scheduled exports). Dashboard filter values
  or question parameters can be set per subscription. *Preview* shows the email without sending;
  *Don't send when there are no results* skips empty reports.
- **Alerts** (a question's ⋯ → *Set up an alert…*) check the question on a schedule and only send
  when it has results, or when a number (the last row: the latest month) goes above or drops below a
  value - optionally *only once*.
- *Send now*, pause, the last sends and what went wrong (per recipient) are in the drawer and on the
  **Subscriptions** page (admins: *Everyone's*). Recipients who are Ncode users can *Unsubscribe me*.

A subscription runs with **its owner's permissions**: recipients see what the owner sees, like a
forwarded report. When the owner loses access, is disabled or deleted, it stops. Admins can limit
typed-in addresses to the company's domains.

**Admin → Delivery** sets the **site address** (links in emails and public links start with it), the
**email server** (SMTP with STARTTLS / SSL, a *Send test* button) and the **chats and webhooks**
(each with *Send test*). Passwords, webhook addresses and bot tokens are stored encrypted and never
shown again (only their last characters).

**Public links and embedding** (admins): a dashboard's or question's ⋯ → *Public link / embed…*,
after switching them on in **Admin → Sharing**.

- A **public link** opens the results for anyone with the link, without signing in: read-only, no
  SQL, no table names, no editing; filters can be changed. Optional password, expiry and downloads.
  Stop a link at any time; switching public links off stops all of them.
- **Embedding** shows a dashboard or question inside another website. That website's server signs a
  short token (a standard JWT, HS256, with the embedding key from Admin → Sharing; it must expire,
  at most after 30 days) naming the dashboard or question and, for **locked** filters, their values -
  e.g. the customer who is signed in there. Editable filters can be changed by the visitor, the
  others are off. The share dialog shows the code for Python and Node.js; add
  `#titled=false&bordered=false&theme=light` to the iframe address to hide the title and margins.
- Both run with the permissions of the admin who made the link or allowed the embed, under their
  own name in the audit log (`public#3:mark`, `embed#5:mark`) with their own query slots, and
  visitors are limited to `NCODE_PUBLIC_RATE_PER_MIN` requests a minute.

**Admin → Usage** shows how much Ncode is used (queries per day, people, sign-ins, failures, the most
used questions and dashboards, where queries come from) and the **query log** of the slowest and the
failed queries (slower than `NCODE_SLOW_QUERY_SEC`, also written to the server log as
`ncode.slow`).

## Browsing and exporting

**Browse** (in the sidebar): pick a table to page through its rows, click a
column header to sort, type in the filter box to show only matching rows, open the **Structure**
tab for column types and keys. Click any row for the full record.

From search results, **Open in table view** (or **See all matches** when a table had more matches
than the per-table limit) jumps to that table with your phrase already applied, so you can page
through every match instead of just the first few.

**Export CSV** works in two places:
- *Results panel*: the rows already shown (one table, or all results with `_table` and `_matched` columns).
- *Table view*: streams the **whole table, or all rows matching the filter**, straight from the
  database, up to `NCODE_MAX_EXPORT_ROWS` (default 50,000). Nothing is held in memory.

Choose *For Excel* (semicolon-separated, UTF-8 BOM - opens correctly in most regional Excel
versions, including Cyrillic) or *Standard* (comma). Cells that spreadsheets could execute as
formulas (starting with `=` or `@`) get a leading apostrophe.
Opening and exporting a table are written to the audit log.
