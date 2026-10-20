# API reference

Everything the web app does goes through this HTTP API; the interactive reference is at
`http://localhost:8000/docs` while the backend runs.

    GET    /api/engines
    GET    /api/connections
    POST   /api/connections                     (admin) add
    POST   /api/connections/test-draft          (admin) try settings before saving
    GET    /api/connections/{key}/details       (admin)
    PUT    /api/connections/{key}               (admin) edit
    DELETE /api/connections/{key}               (admin) remove
    POST   /api/connections/{key}/test
    GET    /api/connections/{key}/tables
    GET    /api/connections/{key}/schema?refresh=false   typed columns, primary/foreign keys, relationships
    GET    /api/connections/{key}/browse?table=...     paged rows (limit, offset, sort, desc, q, mode ...)
    GET    /api/connections/{key}/structure?table=...
    GET    /api/connections/{key}/export?table=...     CSV stream
    GET    /api/limits
    POST   /api/query                 {"spec": {...}}             run a question (see below)
    POST   /api/query/compile         {"spec": {...}}             the SQL a question runs, without running it
    POST   /api/query/sql             {"connection", "sql", "params"}   SQL mode (read-only)
    POST   /api/query/sql/check       {"connection", "sql"}       is this SQL allowed? which {{params}}?
    GET    /api/query/tasks/{id}      poll a long query           DELETE: cancel it
    GET    /api/query/tasks/{id}/export.xlsx   the finished result as an Excel workbook
    POST   /api/search            {"connection": "mes", "phrase": "..."}  -> {"task_id"}
    GET    /api/search/{task_id}
    DELETE /api/search/{task_id}  (cancel)
    WS     /ws/{task_id}

Interactive docs: http://localhost:8000/docs

### Questions (query engine)

A *question* is JSON, so the visual builder (M2), saved questions and dashboards all share it:

    {"connection": "mes", "source": {"table": "orders"},
     "joins": [{"table": "customers"}],
     "aggregations": [{"fn": "sum", "ref": "orders.total", "alias": "revenue"},
                      {"fn": "count_distinct", "ref": "orders.customer_id", "alias": "buyers"}],
     "breakouts": [{"ref": "orders.created_at", "bucket": "month"}, {"ref": "customers.region"}],
     "filters": {"op": "and", "rules": [{"ref": "orders.status", "op": "=", "value": "paid"},
                                        {"ref": "orders.created_at", "op": "last", "value": {"amount": 12, "unit": "month"}}]},
     "having": [{"ref": "revenue", "op": ">", "value": 1000}],
     "order": [{"ref": "revenue", "dir": "desc"}],
     "limit": 1000}

- **Joins** without `on` follow foreign keys, also through tables in between
  (customers -> orders -> order_items -> products). If no path exists you get an error, never a
  silently dropped join. Give `on` (and an `alias`) to join on anything else.
- **Aggregations**: count, count_distinct, sum, avg, min, max. **Breakouts** group by a column, a
  date `bucket` (minute ... year; weeks start on Monday) or a number `bin_width`.
- **Filters** nest `and`/`or` groups. Operators depend on the column type: `= != > >= < <= between
  in not_in is_null not_null is_empty not_empty contains not_contains starts_with ends_with is_true
  is_false last current`. Text matching ignores case unless `"case_sensitive": true`; `%` and `_`
  are matched literally. `!=`, `not_in` and `not_contains` keep empty (NULL) values.
- **Custom columns** (`"expressions"`): `+ - * /` (division by zero gives empty, not an error),
  `coalesce`, `nullif`, `lower`, `upper`, `trim`, `length`, `abs`, `round`, `concat` and
  `case`/`when`, usable everywhere a column is.
- Every name is checked against the real schema and every value is sent as a parameter.

A run answers `{"task_id", "status", "result", "error"}`. The `result` is the same envelope for
questions and SQL: `columns` (name, type, role), `rows` as arrays, `stats` (duration, row count,
`truncated`, `cached`) and the `sql` that ran. Results are capped at `NCODE_QUERY_MAX_ROWS` and
identical runs within `NCODE_QUERY_CACHE_TTL_SEC` are served from a short cache (`"refresh": true`
skips it).

### Library

    GET    /api/collections                       visible collections (flat tree) + your own collection's id
    POST   /api/collections                       {"name", "description", "parent_id"}
    GET    /api/collections/{id}                  the collection, its path, sub-collections and questions
    PATCH  /api/collections/{id}                  rename / move ("parent_id") / archive ("archived": true)
    DELETE /api/collections/{id}                  an archived collection with everything in it
    GET    /api/collections/{id}/permissions      own and inherited grants (owner and admins)
    PUT    /api/collections/{id}/permissions      {"grants": [{"user": "bob", "level": "view"}, {"role": "all", "level": "edit"}]}
    GET    /api/questions?q=&favorites=&collection=
    POST   /api/questions                         {"name", "collection_id", "kind": "builder"|"sql"|"federated", "spec", "viz", "parameters"}
    GET    /api/questions/{id}   PATCH /api/questions/{id}   DELETE /api/questions/{id} (archived only)
    POST   /api/questions/{id}/duplicate
    POST   /api/questions/{id}/run                {"params": {"region": "EU"}} -> a query task, as above
    PUT    /api/questions/{id}/favorite           (DELETE to remove the star)
    GET    /api/library/archive                   GET /api/library/people

A builder question's `spec` is the question JSON above; a filter rule with `"param": "region"` takes
its value from the parameter. A SQL question's `spec` is `{"sql": "...", "limit": 2000}`. Parameters
are `[{"name", "label", "type": "text"|"number"|"date", "default", "required"}]`. Questions are
checked when saved (unknown columns, SQL that is not read-only are refused).

### Multi-source questions and uploads

    POST   /api/federated/run                     {"spec", "parameters", "params", "wait_ms", "refresh"} -> a query task
    POST   /api/federated/check                   {"spec", "parameters"} -> the clean spec and the parameters it uses
    GET    /api/datasets?q=&collection=           uploaded files you can see
    POST   /api/datasets?filename=plan.csv&name=&collection_id=&delimiter=auto|comma|semicolon|tab|pipe&header=true&encoding=utf-8|latin-1|utf-16&sheet=
                                                  body: the file itself (Content-Type: application/octet-stream)
    GET    /api/datasets/{id}   PATCH (name, description, collection_id, archived)   DELETE (archived only)

A multi-source `spec`:

    {"version": 1,
     "sources": [{"alias": "mes", "type": "question", "question_id": 12},
                 {"alias": "les", "type": "sql", "connection": "les", "sql": "SELECT vin, shipped_at FROM shipments"},
                 {"alias": "plan", "type": "dataset", "dataset_id": 3}],
     "joins": [{"source": "les", "type": "left", "on": [{"left": "mes.vin", "right": "les.vin", "match": "text_ci"}]},
               {"source": "plan", "type": "left", "on": [{"left": "mes.vin", "right": "plan.VIN"}]}],
     "post": {"breakouts": [{"ref": "plant"}], "aggregations": [{"fn": "count"}]},
     "limit": 2000}

Source types: `question`, `builder` (`"spec"`: a question JSON), `sql` and `dataset`. Instead of
`joins`, `"mode": "sql", "sql": "SELECT ... FROM mes JOIN les ..."`. `post` is a question without
its own table (the combined rows are the table `result`; columns whose names clash get the source
name in front, `mes_vin`). The result envelope adds `federation`: rows read per source, per-join
statistics (`left_unmatched_keys`, `right_repeated_keys`, samples ...) and the combined columns.

### Data model, analysis

    GET    /api/semantic/{conn}/fields            PUT /api/semantic/{conn}/fields/{table}/{column}   (admins)
           {"display_name", "description", "semantic_type", "format", "hidden", "parse_as_date"}
    GET    /api/semantic/{conn}/relationships     POST (admins) {"from_table", "from_columns", "to_table", "to_columns"}   DELETE .../{id}
    GET    /api/metrics?connection=               POST /api/metrics   PUT /api/metrics/{id}   PATCH {"archived": true}   (admins)
    POST   /api/profile/table                     {"connection", "table"} -> a query task; result.analysis.profile
    POST   /api/query/tasks/{id}/profile          the profile of a finished result
    POST   /api/xray                              {"connection", "table"} | {"question_id"} -> a query task; result.analysis.cards

In a question, `{"fn": "metric", "metric": 3}` uses a saved metric and `"where": {...}` on any
aggregation counts only matching rows (`{"fn": "sum", "ref": "orders.total", "where": {"rules": [...]}}`).
`"transforms": [{"type": "previous_period", "column": "revenue", "period": "year"}]` works on builder,
SQL (`/api/query/sql` and saved SQL questions) and multi-source questions; types are `running_total`,
`moving_average` (`window`), `pct_change`, `previous_period` (`period`), `rank` and `pct_of_total` (`by` =
group), `outliers` (`method`: `iqr` or `zscore`). Result columns can carry `display_name`, `description`,
`semantic_type`, `format` (from the data model) and `generated` (added by a calculation).

### Dashboards

    GET    /api/dashboards?q=&favorites=&collection=
    POST   /api/dashboards                        {"name", "description", "collection_id"}
    GET    /api/dashboards/{id}                   filters, tabs, cards (each with the question as far as you may see it)
    PUT    /api/dashboards/{id}                   {"filters", "tabs", "cards", "settings"}: the whole definition
    PATCH  /api/dashboards/{id}                   rename / move / archive;  DELETE (archived only)
    POST   /api/dashboards/{id}/duplicate         PUT|DELETE /api/dashboards/{id}/favorite
    POST   /api/dashboards/{id}/cards/{key}/run   {"filters": {"period": ["2026-01-01", "2026-03-31"]}} -> a query task

A card is `{"key", "kind": "question"|"text"|"heading", "question_id", "tab", "layout": {"x", "y",
"w", "h"} (12 columns), "viz", "title", "text", "mappings": {"<filter id>": {"param": "since"} |
{"field": "orders.created_at"}}}`; a filter is `{"id", "label", "type":
"date_range"|"date"|"text"|"category"|"number", "default", "required"}`.

### Subscriptions, sharing, usage

    GET    /api/subscriptions?target_type=&target_id=&all=   yours and the ones you receive (admins: all=true)
    GET    /api/subscriptions/options                 destinations, people, is email set up
    POST   /api/subscriptions                         see below;  PUT|DELETE /api/subscriptions/{id};  PATCH {"enabled"}
    POST   /api/subscriptions/preview                 render without sending -> {"html", "text", "alert"}
    GET    /api/subscriptions/{id}                    with the latest runs
    POST   /api/subscriptions/{id}/send               send now;  POST .../unsubscribe (a recipient leaves)
    PUT    /api/account/email                         {"email"}: your own address
    GET    /api/admin/settings                        PUT /api/admin/settings/email | general | sharing (admins)
    POST   /api/admin/settings/email/test             {"to"}
    GET    /api/admin/destinations                    POST, PUT|DELETE /{id}, POST /{id}/test (admins)
    GET    /api/share?target_type=&target_id=         POST /api/share/public, PATCH|DELETE /api/share/public/{id},
                                                      PUT /api/share/embed, POST /api/share/embed/token (admins)
    GET    /api/admin/settings/embedding-key          POST: a new key (admins)
    GET    /api/admin/usage?days=30                   GET /api/admin/query-log?kind=slow|errors&days=7 (admins)

    GET    /api/public/{token}                        POST /unlock {"password"}, POST /run, POST /cards/{key}/run,
                                                      GET|DELETE /tasks/{id}, GET /tasks/{id}/export.csv|xlsx
    GET    /api/embed/{jwt}                           the same without password and downloads

A subscription is `{"name", "target_type": "dashboard"|"question", "target_id", "schedule": {"every":
"hour"|"day"|"week"|"month", "hour", "minute", "days": [0..6] (0 = Monday), "monthday": 1..28 | -1,
"timezone": "Europe/Berlin"}, "recipients": {"users": [...], "emails": [...], "destinations": [ids]},
"options": {"filters", "attach": "none"|"csv"|"xlsx", "rows", "skip_empty", "message"}, "alert": null |
{"type": "rows"|"above"|"below", "column", "value", "once"}, "enabled"}`. An embedding token's payload
is `{"resource": {"dashboard": 12}, "params": {"region": "EU"}, "exp": <unix time>}`.

### SQL mode

`POST /api/query/sql` runs one read-only query, exactly as written. `{{name}}` placeholders become
parameters (`"params": {"name": "EU"}`); write them without quotes. Before running, the SQL is
parsed in the database's own dialect and refused unless it is a single `SELECT` / `WITH ... SELECT`
/ `UNION`, without writes, `SELECT ... INTO`, locking clauses or functions that touch files,
sleep or reach other servers (`LOAD_FILE`, `SLEEP`, `pg_sleep`, `pg_read_file`, `xp_cmdshell`,
`OPENROWSET` ...). Only admins may read system catalogs (`information_schema`, `pg_catalog`, `sys`
...). Rows are capped per database without rewriting your SQL, so `ORDER BY` and `WITH` keep working.

`/schema` normalises column types to `string`, `number`, `boolean`, `date`, `datetime`, `time`,
`json`, `binary` or `unknown` (the original type is in `db_type`) and lists the foreign keys between
visible tables as `relationships`. Admins can see it as **Admin -> Data model**.
