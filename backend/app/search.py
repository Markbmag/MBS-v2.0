"""Database-agnostic "search everywhere" engine.

For every table of a connection it builds one SELECT with
`WHERE col1 LIKE ... OR col2 LIKE ... ` over the searchable columns and returns
a few matching rows. SQLAlchemy takes care of quoting and dialect differences.
"""

from __future__ import annotations

import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from fnmatch import fnmatchcase
from typing import Any, Callable

from sqlalchemy import String, cast, column, func, or_, select, table as sa_table
from sqlalchemy import types as sqltypes
from sqlalchemy.engine import Engine

from .config import ConnectionConfig, Settings
from .db import ConnectionRegistry
from .serialize import serialize_value
from .tasks import SearchTask

logger = logging.getLogger(__name__)

LIKE_ESCAPE = "!"
_NUMERIC_PHRASE = re.compile(r"^[+-]?[\d\s.,]+$")
_DATE_PHRASE = re.compile(r"^[\d\-:./T\s]+$")


@dataclass
class SearchOptions:
    phrase: str
    match_mode: str = "contains"          # contains | exact | starts_with
    case_sensitive: bool = False
    include_numeric: bool = False
    include_dates: bool = False
    row_limit: int = 10
    tables: list[str] = field(default_factory=list)          # exact names; empty = all
    include_tables: list[str] = field(default_factory=list)  # glob patterns
    exclude_tables: list[str] = field(default_factory=list)  # glob patterns
    schema: str | None = None
    refresh_schema: bool = False
    denied_tables: frozenset[str] = frozenset()  # lower-case names never searched (row-level security, M9)


@dataclass
class TableOutcome:
    table: str
    rows: list[dict[str, Any]] = field(default_factory=list)
    truncated: bool = False
    skipped: bool = False
    error: str | None = None


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def escape_like(value: str) -> str:
    """Escape LIKE wildcards (including [ for SQL Server) using LIKE_ESCAPE."""
    for ch in (LIKE_ESCAPE, "%", "_", "["):
        value = value.replace(ch, LIKE_ESCAPE + ch)
    return value


def classify_type(col_type: Any) -> str | None:
    """Return 'text', 'numeric', 'date', 'binary' or None (not searchable)."""
    if isinstance(col_type, getattr(sqltypes, "_Binary", sqltypes.LargeBinary)):
        return "binary"
    if isinstance(col_type, sqltypes.String):  # VARCHAR, CHAR, TEXT, ENUM, SET ...
        return "text"
    if isinstance(col_type, (sqltypes.Integer, sqltypes.Numeric)):
        return "numeric"
    if isinstance(col_type, (sqltypes.DateTime, sqltypes.Date, sqltypes.Time)):
        return "date"
    return None


def value_matches(value: Any, opts: SearchOptions) -> bool:
    """Python-side check, used to report which columns matched."""
    if value is None:
        return False
    text, phrase = str(value), opts.phrase
    if not opts.case_sensitive:
        text, phrase = text.lower(), phrase.lower()
    if opts.match_mode == "exact":
        return text == phrase
    if opts.match_mode == "starts_with":
        return text.startswith(phrase)
    return phrase in text


def filter_tables(names: list[str], opts: SearchOptions) -> list[str]:
    def hit(name: str, patterns: list[str]) -> bool:
        return any(fnmatchcase(name.lower(), p.lower()) for p in patterns)

    exact = {t.lower() for t in opts.tables}
    selected = [n for n in names if not exact or n.lower() in exact]
    selected = [n for n in selected if not opts.include_tables or hit(n, opts.include_tables)]
    return [n for n in selected if not hit(n, opts.exclude_tables) and n.lower() not in opts.denied_tables]


def _predicate(expr: Any, opts: SearchOptions) -> Any:
    phrase = opts.phrase
    if opts.match_mode == "exact":
        return expr == phrase if opts.case_sensitive else func.lower(expr) == phrase.lower()
    pattern = escape_like(phrase)
    pattern = f"{pattern}%" if opts.match_mode == "starts_with" else f"%{pattern}%"
    if opts.case_sensitive:
        return expr.like(pattern, escape=LIKE_ESCAPE)
    return expr.ilike(pattern, escape=LIKE_ESCAPE)


def _searchable_columns(columns: list[dict[str, Any]], opts: SearchOptions) -> list[tuple[str, str]]:
    """[(column_name, kind)] of columns worth searching for this phrase."""
    numeric_ok = opts.include_numeric and bool(_NUMERIC_PHRASE.match(opts.phrase))
    date_ok = opts.include_dates and bool(_DATE_PHRASE.match(opts.phrase))
    result = []
    for col in columns:
        kind = classify_type(col["type"])
        if kind == "text" or (kind == "numeric" and numeric_ok) or (kind == "date" and date_ok):
            result.append((col["name"], kind))
    return result


def build_conditions(columns: list[dict[str, Any]], opts: SearchOptions) -> list[Any]:
    """One LIKE/equality condition per searchable column (to be OR-ed together)."""
    conditions = []
    for name, kind in _searchable_columns(columns, opts):
        expr = column(name, String()) if kind == "text" else cast(column(name), String())
        conditions.append(_predicate(expr, opts))
    return conditions


def _pick_id_column(row: dict[str, Any], cfg: ConnectionConfig) -> str | None:
    for hint in cfg.id_hints:
        for name in row:
            if hint in name.lower() and row[name] not in (None, ""):
                return name
    return None


# --------------------------------------------------------------------------
# per-table search
# --------------------------------------------------------------------------
def search_table(
    engine: Engine,
    cfg: ConnectionConfig,
    table_name: str,
    columns: list[dict[str, Any]],
    opts: SearchOptions,
) -> TableOutcome:
    outcome = TableOutcome(table=table_name)
    searchable = _searchable_columns(columns, opts)
    if not searchable:
        outcome.skipped = True
        return outcome

    try:
        # Select every column except binary blobs (can be huge, never searchable).
        selected_names = [c["name"] for c in columns if classify_type(c["type"]) != "binary"]
        tbl = sa_table(table_name, *[column(n) for n in selected_names], schema=opts.schema or cfg.schema)

        conditions = build_conditions(columns, opts)

        # Fetch one extra row so we can tell the user the result was cut off.
        stmt = select(*[tbl.c[n] for n in selected_names]).where(or_(*conditions)).limit(opts.row_limit + 1)
        with engine.connect() as conn:
            rows = conn.execute(stmt).mappings().all()

        if len(rows) > opts.row_limit:
            outcome.truncated = True
            rows = rows[: opts.row_limit]

        for raw in rows:
            row = {k: serialize_value(v) for k, v in raw.items()}
            matched = [k for k, v in row.items() if value_matches(v, opts)]
            # Case-sensitive search on a case-insensitive collation: the DB
            # over-matches, so drop rows that don't match exactly.
            if opts.case_sensitive and not matched:
                continue
            outcome.rows.append(
                {
                    "table": table_name,
                    "row": row,
                    "cols": list(row.keys()),
                    "matched_columns": matched,
                    "id_column": _pick_id_column(row, cfg),
                }
            )
    except Exception as exc:  # report it, never hide it
        logger.warning("[%s] table %s failed: %s", cfg.key, table_name, exc)
        outcome.error = _short_error(exc)
    return outcome


def _short_error(exc: Exception) -> str:
    # `orig` is the driver's own error (cleaner than the SQLAlchemy wrapper)
    message = str(getattr(exc, "orig", None) or exc).strip().splitlines()[0]
    return message[:300]


# --------------------------------------------------------------------------
# orchestration
# --------------------------------------------------------------------------
def run_search(
    task: SearchTask,
    registry: ConnectionRegistry,
    opts: SearchOptions,
    settings: Settings,
    on_finish: Callable[[SearchTask], None] | None = None,
) -> None:
    """Blocking; meant to run in a background thread. Updates `task` as it goes."""
    try:
        cfg = registry.get_config(task.connection)
        engine = registry.get_engine(task.connection)
        schema_map = registry.get_schema(task.connection, opts.schema, refresh=opts.refresh_schema)
        names = filter_tables(sorted(schema_map), opts)
        task.start(total=len(names))

        pool = ThreadPoolExecutor(max_workers=settings.search_workers, thread_name_prefix="ncode-search")
        try:
            def work(name: str) -> TableOutcome:
                if task.cancel_event.is_set():
                    return TableOutcome(table=name, skipped=True)
                return search_table(engine, cfg, name, schema_map[name], opts)

            futures = [pool.submit(work, name) for name in names]
            for future in as_completed(futures):
                outcome = future.result()
                task.add_table(outcome.table, outcome.rows, outcome.truncated, outcome.skipped, outcome.error)
                if task.cancel_event.is_set():
                    break
        finally:
            pool.shutdown(wait=True, cancel_futures=True)

        task.finish("cancelled" if task.cancel_event.is_set() else "completed")
    except Exception as exc:
        logger.exception("search task %s failed", task.id)
        task.finish("error", _short_error(exc))
    if on_finish is not None:
        try:
            on_finish(task)
        except Exception:
            logger.exception("on_finish callback failed for task %s", task.id)


def start_search_thread(
    task: SearchTask,
    registry: ConnectionRegistry,
    opts: SearchOptions,
    settings: Settings,
    on_finish: Callable[[SearchTask], None] | None = None,
) -> threading.Thread:
    thread = threading.Thread(
        target=run_search,
        args=(task, registry, opts, settings, on_finish),
        name=f"ncode-task-{task.id[:8]}",
        daemon=True,
    )
    thread.start()
    return thread
