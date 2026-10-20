# Security

- Credentials live only in `backend/.env` and `backend/data/` (both git-ignored). Never commit them.
- Admins can make the server connect to any host they type in. That is by design for a
  "connect anything" tool, so only give the admin role to people you trust.
- The server binds to `127.0.0.1` by default. For colleagues, use the Docker setup: Caddy serves
  everything over **HTTPS** (HSTS, no framing except embeds, no MIME sniffing) and the backend is not
  reachable from outside. Without Docker, set `NCODE_HOST=0.0.0.0` and `NCODE_CORS_ORIGINS` only on a
  trusted network, and put a reverse proxy with HTTPS in front before using it outside a trusted LAN -
  otherwise passwords can be sniffed.
- Sessions are opened read-only where the database supports it, but the real
  protection is a database user that only has `SELECT`. **SQL Server has no read-only session
  switch**: there, SQL mode relies on the SQL guard and on the login's permissions, so give Ncode a
  login with `db_datareader` only. A MySQL account must not have the `FILE` privilege.
- Queries (questions and SQL mode) stop after `NCODE_STATEMENT_TIMEOUT_SEC`; users can cancel
  them; each user may run `NCODE_MAX_CONCURRENT_QUERIES` at once; every run is in the audit log
  (action `query`, `sql` or `federated`, with the SQL or the sources).
- Multi-source questions run in DuckDB inside the backend process: before any SQL a user wrote
  runs, file and network access, extensions and setting changes are switched off for that
  session, and the SQL is checked by the same guard (plus DuckDB's file functions). Each source is
  read through the normal, read-only connection with your permissions. Uploaded files are stored
  as Parquet copies under `backend/data/datasets/`; whoever can see a file's collection can read all
  of its rows.
- **Subscriptions, public links and embeds send data outside the people who may see it**, so:
  subscriptions run with the owner's permissions and stop when the owner loses them; only admins
  create public links, allow embedding and set up chats/webhooks; public links and embedding are
  off until an admin switches them on and stop at once when switched off; visitors get results
  only (no SQL, no database errors, no table names) and are rate-limited; embedding tokens must be
  HS256-signed and expire within 30 days. Serve Ncode over HTTPS before using public links outside
  your network. See [M8-review.md](../security/M8-review.md).
- Searching with `LIKE '%text%'` scans whole tables. On very large databases use
  `include_tables` / `exclude_tables` and the per-query timeout
  (`NCODE_STATEMENT_TIMEOUT_SEC`).
- **Groups and row-level security** (M9): access to databases and collections can come from groups;
  row rules are added to every question before it is compiled, to Browse and to exports, and SQL is
  refused where rules apply (it cannot be filtered reliably). Admins are never restricted - keep the
  admin role for people who may see everything.
- **Backups** contain Ncode's own data and uploads, not the encryption key; store the key apart and
  protect the backup files like the database itself (they contain password hashes and the audit log).
- `/metrics` needs an admin session or `NCODE_METRICS_TOKEN`; `/api/health/ready` is public and only
  says whether the server works, free disk space and the time of the last backup.
- Passwords: scrypt hashes; at least 8 characters; changing a password (yourself or by an admin)
  ends every session of that user.
