"""Read-only guard for SQL typed by users (SQL mode).

DataDesk used a keyword blacklist on the raw text; it let `LOAD_FILE()` and `SLEEP()`
through and rejected `REPLACE()`, `'please update'` and a column named `set`.
This guard parses the statement with sqlglot (in the database's own dialect) and
checks the syntax tree instead:

- exactly one statement, whose root is a SELECT (or UNION / INTERSECT / EXCEPT);
- no writes, DDL, commands, SELECT ... INTO or locking clauses anywhere in it
  (also not hidden in a CTE: `WITH d AS (DELETE ...) SELECT ...`);
- no functions that read files, sleep, lock, or reach other servers;
- for non-admins, no system catalogs (information_schema, pg_catalog, sys ...);
- `{{name}}` placeholders become bound parameters, never pasted text.

What the parser cannot see, the database must enforce: Ncode opens read-only
sessions where the engine supports it, and the database account should only have
SELECT. The guard is one layer, not the only one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError, TokenError

from .dialects import MYSQL_FAMILY

SQLGLOT_DIALECT = {
    "mysql": "mysql", "mariadb": "mysql", "postgresql": "postgres", "mssql": "tsql", "sqlite": "sqlite",
    "duckdb": "duckdb",  # SQL over the sources of a multi-source question (M6)
}

PARAM = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}")
MAX_SQL_CHARS = 100_000

# Node types that must not appear anywhere in a read-only query.
_FORBIDDEN_NODES = tuple(
    getattr(exp, name)
    for name in (
        "Insert", "Update", "Delete", "Merge", "Create", "Drop", "Alter", "AlterColumn", "TruncateTable",
        "Command", "Execute", "Set", "Pragma", "Attach", "Detach", "Use", "Declare", "Copy", "LoadData",
        "Transaction", "Commit", "Rollback", "Grant", "Revoke", "Into", "Lock", "Show", "Describe", "Analyze",
        "Cache", "Uncache", "Refresh", "Kill", "Summarize",
    )
    if hasattr(exp, name)
)

# Functions with side effects (files, sleeping, locks, other servers, server settings).
DENIED_FUNCTIONS = {
    # MySQL / MariaDB
    "load_file", "sleep", "benchmark", "get_lock", "release_lock", "release_all_locks", "is_free_lock", "is_used_lock",
    "master_pos_wait", "source_pos_wait", "sys_exec", "sys_eval", "sys_get", "sys_set", "load_extension",
    # PostgreSQL
    "pg_sleep", "pg_sleep_for", "pg_sleep_until", "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file",
    "pg_ls_logdir", "pg_ls_waldir", "pg_ls_tmpdir", "pg_ls_archive_statusdir",
    "lo_import", "lo_export", "lo_get", "lo_put", "lo_from_bytea", "lo_create", "lo_unlink", "lo_open", "lo_write",
    "dblink", "dblink_exec", "dblink_connect", "dblink_send_query", "pg_terminate_backend", "pg_cancel_backend",
    "pg_reload_conf", "pg_rotate_logfile", "set_config", "pg_advisory_lock", "pg_advisory_xact_lock",
    "pg_advisory_lock_shared", "pg_try_advisory_lock", "pg_notify", "pg_logical_emit_message", "pg_switch_wal",
    "pg_create_restore_point", "query_to_xml", "query_to_xml_and_xmlschema", "cursor_to_xml", "table_to_xml",
    "nextval", "setval",
    # SQL Server
    "openrowset", "opendatasource", "openquery", "openxml", "xp_cmdshell", "xp_dirtree", "xp_fileexist",
    "xp_regread", "sp_executesql", "sp_oacreate",
    # SQLite
    "readfile", "writefile", "edit", "fts3_tokenizer", "zipfile", "sqlar_compress",
}

# DuckDB: reading files or settings. External access is also switched off in the
# DuckDB session (app/federation/workspace.py); this is the second layer.
DUCKDB_DENIED_FUNCTIONS = {
    "read_csv", "read_csv_auto", "read_parquet", "parquet_scan", "read_json", "read_json_auto", "read_ndjson",
    "read_ndjson_auto", "read_json_objects", "read_ndjson_objects", "read_text", "read_blob", "glob", "sniff_csv",
    "parquet_metadata", "parquet_schema", "parquet_file_metadata", "parquet_kv_metadata", "iceberg_scan",
    "delta_scan", "sqlite_scan", "sqlite_attach", "postgres_scan", "postgres_query", "mysql_scan", "mysql_query",
    "query", "query_table", "getenv", "current_setting", "which_secret", "load_extension",
}
_DUCKDB_DENIED_PREFIXES = ("duckdb_", "pragma_", "read_", "parquet_", "json_execute")

SYSTEM_SCHEMAS = {"information_schema", "pg_catalog", "pg_toast", "mysql", "performance_schema", "sys"}
SYSTEM_DATABASES = {"master", "msdb", "model", "tempdb", "mysql", "information_schema", "performance_schema", "sys"}
_SYSTEM_TABLE_PREFIXES = ("pg_", "sqlite_")

# SQL Server table hints that only read; anything else (UPDLOCK, XLOCK, TABLOCKX ...) takes locks.
_SAFE_TSQL_HINTS = {"NOLOCK", "READUNCOMMITTED", "READCOMMITTED", "NOWAIT"}


class GuardError(ValueError):
    """The SQL is not allowed; the message says why (shown to the user)."""


@dataclass
class CheckedSQL:
    sql: str                                   # the user's text, unchanged
    params: list[str] = field(default_factory=list)  # {{names}} in order of first use
    tables: list[str] = field(default_factory=list)


def find_params(sql: str) -> list[str]:
    seen: list[str] = []
    for name in PARAM.findall(sql):
        if name not in seen:
            seen.append(name)
    return seen


def check_sql(sql: str, dialect: str, *, allow_system: bool = False) -> CheckedSQL:
    """Raise GuardError unless `sql` is a single read-only query."""
    if not sql or not sql.strip():
        raise GuardError("Write a SELECT query")
    if len(sql) > MAX_SQL_CHARS:
        raise GuardError(f"The query is longer than {MAX_SQL_CHARS:,} characters")
    if "\x00" in sql:
        raise GuardError("The query contains a NUL character")
    if dialect in MYSQL_FAMILY:
        _check_mysql_comments(sql)

    params = find_params(sql)
    # Placeholders are checked as NULL; at run time they become driver parameters.
    parse_text = PARAM.sub("NULL", sql)
    read = SQLGLOT_DIALECT.get(dialect)
    if read is None:
        raise GuardError(f"SQL mode is not available for {dialect}")
    try:
        statements = [s for s in sqlglot.parse(parse_text, read=read) if s is not None]
    except (ParseError, TokenError) as exc:
        raise GuardError(f"Could not read this SQL: {_first_line(exc)}") from None
    if not statements:
        raise GuardError("Write a SELECT query")
    if len(statements) > 1:
        raise GuardError("Run one statement at a time (remove the extra ';' statements)")
    tree = statements[0]

    root = tree.this if isinstance(tree, exp.Subquery) else tree
    if not isinstance(root, (exp.Select, exp.Union, exp.Intersect, exp.Except)):
        raise GuardError("Only SELECT queries are allowed (WITH ... SELECT and UNION too)")

    tables: list[str] = []
    cte_names = {cte.alias_or_name.lower() for cte in tree.find_all(exp.CTE)}
    for node in tree.walk():
        if isinstance(node, _FORBIDDEN_NODES):
            raise GuardError(f"Not allowed in a read-only query: {_describe(node)}")
        if isinstance(node, exp.Func):
            name = _function_name(node)
            if name in DENIED_FUNCTIONS or (dialect == "duckdb" and _duckdb_denied(name)):
                raise GuardError(f"The function {name.upper()}() is not allowed")
        if isinstance(node, exp.WithTableHint):
            for hint in node.expressions:
                if hint.name.upper() not in _SAFE_TSQL_HINTS:
                    raise GuardError(f"The table hint {hint.name.upper()} is not allowed")
        if isinstance(node, exp.Table) and node.name:
            if node.name.lower() in cte_names and not node.db:
                continue
            if not allow_system and _is_system(node):
                raise GuardError(f"System tables ({_table_label(node)}) are only available to administrators")
            label = _table_label(node)
            if label not in tables:
                tables.append(label)
    return CheckedSQL(sql=sql, params=params, tables=tables)


def _duckdb_denied(name: str) -> bool:
    return name in DUCKDB_DENIED_FUNCTIONS or name.startswith(_DUCKDB_DENIED_PREFIXES)


def _function_name(node: exp.Func) -> str:
    if isinstance(node, exp.Anonymous):
        # .name drops identifier quotes: "pg_sleep"(1) is pg_sleep
        return (node.name or str(node.this)).strip('"`[]').lower()
    try:
        return node.sql_name().lower()
    except Exception:
        return type(node).__name__.lower()


def _is_system(table: exp.Table) -> bool:
    schema, catalog, name = table.db.lower(), table.catalog.lower(), table.name.lower()
    return (
        schema in SYSTEM_SCHEMAS
        or catalog in SYSTEM_DATABASES
        or (not schema and name in SYSTEM_SCHEMAS)
        or name.startswith(_SYSTEM_TABLE_PREFIXES)
    )


def _table_label(table: exp.Table) -> str:
    return ".".join(p for p in (table.catalog, table.db, table.name) if p)


def _describe(node: exp.Expression) -> str:
    names = {"Into": "SELECT ... INTO", "Lock": "FOR UPDATE / locking", "Command": "a command"}
    kind = type(node).__name__
    return names.get(kind, kind.upper())


def _first_line(exc: Exception) -> str:
    text = re.sub(r"\x1b\[[0-9;]*m", "", str(exc)).strip()  # sqlglot underlines with ANSI codes
    return text.splitlines()[0][:200] if text else type(exc).__name__


def _check_mysql_comments(sql: str) -> None:
    """MySQL reads some comments differently from the parser, so refuse those forms.

    - `/*! ... */` and `/*M! ... */` are executed by MySQL / MariaDB, not ignored;
    - `--` starts a comment only when followed by a space: `1 --1` is `1 - -1` in
      MySQL, but a comment for sqlglot, which would hide what comes after it.
    """
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        if ch in ("'", '"', "`"):
            i = _skip_quoted(sql, i, ch)
            continue
        if sql.startswith("/*", i):
            if sql.startswith(("/*!", "/*M!"), i):
                raise GuardError("MySQL executable comments (/*! ... */) are not allowed")
            end = sql.find("*/", i + 2)
            if end < 0:
                raise GuardError("A /* comment is not closed")
            i = end + 2
            continue
        if ch == "#":
            end = sql.find("\n", i)
            i = n if end < 0 else end + 1
            continue
        if sql.startswith("--", i):
            nxt = sql[i + 2] if i + 2 < n else " "
            if not nxt.isspace():
                raise GuardError("In MySQL '--' needs a space after it to start a comment; write '-- ' or use '#'")
            end = sql.find("\n", i)
            i = n if end < 0 else end + 1
            continue
        i += 1


def _skip_quoted(sql: str, start: int, quote: str) -> int:
    i, n = start + 1, len(sql)
    while i < n:
        ch = sql[i]
        if ch == "\\" and quote != "`":
            i += 2
            continue
        if ch == quote:
            if i + 1 < n and sql[i + 1] == quote:  # doubled quote = escaped quote
                i += 2
                continue
            return i + 1
        i += 1
    raise GuardError("A quoted string or name is not closed")


# ---------------------------------------------------------------------- parameters

def bind_params(sql: str, values: dict[str, Any], paramstyle: str) -> tuple[str, Any]:
    """Replace {{name}} with the driver's placeholders. Returns (sql, parameters).

    With format/pyformat drivers (psycopg, pymysql, pymssql) every literal % must be
    doubled once parameters are passed.
    """
    names = PARAM.findall(sql)
    missing = sorted({n for n in names if n not in values})
    if missing:
        raise GuardError(f"Give a value for {', '.join('{{' + m + '}}' for m in missing)}")
    for name in names:
        value = values[name]
        # dates come from typed parameters of saved questions (app/content/params.py)
        if value is not None and not isinstance(value, (str, int, float, bool, date)):
            raise GuardError(f"{{{{{name}}}}} must be text, a number, a date, true/false or null")

    if paramstyle in ("pyformat", "format"):
        sql = sql.replace("%", "%%")
    positional: list[Any] = []

    def placeholder(match: re.Match) -> str:
        name = match.group(1)
        if paramstyle == "pyformat":
            return f"%(p_{name})s"
        if paramstyle == "named":
            return f":p_{name}"
        positional.append(values[name])
        if paramstyle == "format":
            return "%s"
        if paramstyle == "numeric":
            return f":{len(positional)}"
        return "?"  # qmark

    text = PARAM.sub(placeholder, sql)
    if paramstyle in ("pyformat", "named"):
        return text, {f"p_{n}": values[n] for n in set(names)}
    return text, tuple(positional)
