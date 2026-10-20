"""Running a multi-source question: read the sources, combine them in DuckDB, apply the post step.

The API (routes.py) checks permissions and turns every source into a PreparedSource
before anything runs; this module only executes. Database sources are read in
parallel, each with its own cancel hook, so Stop (or the timeout) stops all of them.
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from ..query.compiler import CompileError, compile_spec, render_sql
from ..query.runner import QueryCancelled, QueryTask
from ..query.sqlguard import GuardError, bind_params, check_sql
from ..query.spec import QuerySpec
from ..results import ResultEnvelope, build_envelope
from .combine import CombineError, Combiner
from .spec import RESULT_TABLE, FederatedSpec
from .workspace import Workspace, ncode_type, quote, sa_type

logger = logging.getLogger(__name__)

Fetch = Callable[[QueryTask], tuple[list[str], list[tuple], bool]]


class FederationError(ValueError):
    """A problem with the question (not with a database); shown to the user."""


@dataclass
class PreparedSource:
    alias: str
    label: str
    kind: str                         # question | builder | sql | dataset
    connection: str | None = None
    fetch: Fetch | None = None        # database sources
    path: Path | None = None          # dataset sources (Ncode's Parquet copy)
    limit: int = 0
    cache_part: Any = None            # what identifies the source's data for the result cache


@dataclass
class SourceStats:
    alias: str
    label: str
    kind: str
    connection: str | None
    rows: int = 0
    truncated: bool = False
    duration_ms: int = 0

    def as_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class Plan:
    spec: FederatedSpec
    sources: list[PreparedSource]
    post: QuerySpec                    # parameters bound, dashboard conditions added
    sql_params: dict[str, Any] = field(default_factory=dict)  # {{name}} values for "sql" mode
    allow_system: bool = False


DUCK_DIALECT: Any = None


def duck_dialect() -> Any:
    """SQLAlchemy's PostgreSQL dialect, named duckdb, with $1 placeholders (what DuckDB reads)."""
    global DUCK_DIALECT
    if DUCK_DIALECT is None:
        from sqlalchemy.dialects.postgresql.base import PGDialect

        class DuckDBDialect(PGDialect):
            name = "duckdb"
            supports_statement_cache = False

        DUCK_DIALECT = DuckDBDialect(paramstyle="numeric_dollar")
    return DUCK_DIALECT


def check_combine_sql(sql: str, aliases: list[str]) -> list[str]:
    """Guard for SQL over the sources: read-only, and only the sources as tables. Returns {{params}}."""
    try:
        checked = check_sql(sql, "duckdb", allow_system=False)
    except GuardError as exc:
        raise FederationError(str(exc)) from None
    allowed = {a.lower() for a in aliases}
    for table in checked.tables:
        if table.lower() not in allowed:
            raise FederationError(
                f"Unknown table {table!r}: the SQL can only use the sources ({', '.join(aliases)})"
            )
    return checked.params


class FederatedRun:
    def __init__(self, plan: Plan, *, memory_mb: int, threads: int, default_rows: int, max_rows: int):
        self.plan = plan
        self.memory_mb = memory_mb
        self.threads = threads
        self.default_rows = default_rows
        self.max_rows = max_rows
        self._children: list[QueryTask] = []
        self._ws: Workspace | None = None
        self._lock = threading.Lock()
        self._cancelled = False

    def _cancel_all(self) -> None:
        with self._lock:
            self._cancelled = True
            children, ws = list(self._children), self._ws
        for child in children:
            child.cancel()
        if ws is not None:
            ws.interrupt()

    def __call__(self, task: QueryTask) -> ResultEnvelope:
        started = time.perf_counter()
        task.set_cancel_hook(self._cancel_all)
        try:
            loaded = self._read_sources(task)
            if task.cancel_event.is_set():
                raise QueryCancelled()
            ws = Workspace(memory_mb=self.memory_mb, threads=self.threads)
            with self._lock:
                self._ws = ws
                if self._cancelled:
                    raise QueryCancelled()
            try:
                return self._combine(ws, loaded, started)
            finally:
                ws.close()
        except (CombineError, CompileError, FederationError) as exc:
            raise FederationError(str(exc)) from None

    # ------------------------------------------------------------------ sources
    def _read_sources(self, task: QueryTask) -> dict[str, tuple[SourceStats, Any]]:
        out: dict[str, tuple[SourceStats, Any]] = {}
        db_sources = [s for s in self.plan.sources if s.fetch is not None]

        def read(src: PreparedSource) -> tuple[SourceStats, Any]:
            child = QueryTask(owner=task.owner, connection=src.connection or "", kind=src.kind)
            with self._lock:
                self._children.append(child)
                if self._cancelled:
                    child.cancel()
            t0 = time.perf_counter()
            try:
                names, rows, truncated = src.fetch(child)  # type: ignore[misc]
            except Exception as exc:
                if task.cancel_event.is_set():
                    raise QueryCancelled() from None
                detail = str(getattr(exc, "orig", None) or exc).strip().splitlines()
                raise FederationError(f"{src.label}: {detail[0] if detail else type(exc).__name__}") from None
            stats = SourceStats(
                src.alias, src.label, src.kind, src.connection, len(rows), truncated, round((time.perf_counter() - t0) * 1000)
            )
            return stats, (names, rows)

        if db_sources:
            with ThreadPoolExecutor(max_workers=len(db_sources), thread_name_prefix="ncode-fed") as pool:
                futures = {s.alias: pool.submit(read, s) for s in db_sources}
                for alias, fut in futures.items():
                    out[alias] = fut.result()
        for s in self.plan.sources:
            if s.path is not None:
                out[s.alias] = (SourceStats(s.alias, s.label, s.kind, None), s.path)
        return out

    # ------------------------------------------------------------------ DuckDB
    def _combine(self, ws: Workspace, loaded: dict[str, tuple[SourceStats, Any]], started: float) -> ResultEnvelope:
        plan = self.plan
        script: list[str] = []
        for s in plan.sources:
            stats, data = loaded[s.alias]
            t0 = time.perf_counter()
            if isinstance(data, Path):
                ws.load_parquet(s.alias, data)
                stats.rows = ws.count(s.alias)
                stats.duration_ms = round((time.perf_counter() - t0) * 1000)
                script.append(f"-- {s.alias}: uploaded file {s.label} ({stats.rows:,} rows)")
            else:
                names, rows = data
                ws.load_rows(s.alias, names, rows)
                cut = ", cut off at the row limit" if stats.truncated else ""
                script.append(f"-- {s.alias}: {s.label} ({stats.rows:,} rows{cut})")
        ws.lock()

        joins: list[dict[str, Any]] = []
        if plan.spec.mode == "sql":
            sql = plan.spec.sql or ""
            check_combine_sql(sql, [s.alias for s in plan.sources])
            text = sql.strip().rstrip(";").strip()
            driver_sql, params = bind_params(text, plan.sql_params, "qmark")
            ws.execute(f"CREATE TABLE {quote(RESULT_TABLE)} AS {driver_sql}", list(params))
            script.append(f"CREATE TABLE {RESULT_TABLE} AS\n{text};")
        else:
            combiner = Combiner(ws, plan.spec)
            join_sql, stats = combiner.build()
            joins = [s.as_dict() for s in stats]
            script.append(f"CREATE TABLE {RESULT_TABLE} AS\n{join_sql};")

        combined_rows = ws.count(RESULT_TABLE)
        columns = ws.columns(RESULT_TABLE)
        tables = {RESULT_TABLE: [{"name": n, "type": sa_type(ncode_type(t))} for n, t in columns]}
        dialect = duck_dialect()
        compiled = compile_spec(
            plan.post, dialect=dialect, tables=tables, relationships=[],
            default_limit=self.default_rows, max_limit=self.max_rows,
        )
        statement = compiled.limited(1).compile(dialect=dialect, compile_kwargs={"render_postcompile": True})
        params = [statement.params[k] for k in (statement.positiontup or [])]
        names, _types, rows = ws.fetch(str(statement), params, compiled.limit + 1)
        truncated = len(rows) > compiled.limit
        script.append(render_sql(compiled.limited(), dialect))
        envelope = build_envelope(
            names, rows[: compiled.limit], column_types=[c.type for c in compiled.columns],
            duration_ms=(time.perf_counter() - started) * 1000, truncated=truncated, sql="\n".join(script),
        )
        if plan.spec.transforms:
            from ..query.routes import finish_envelope

            finish_envelope(envelope, [], plan.spec.transforms)
        envelope.federation = {
            "sources": [loaded[s.alias][0].as_dict() for s in plan.sources],
            "joins": joins,
            "combined_rows": combined_rows,
            "combined_columns": [{"name": n, "type": ncode_type(t)} for n, t in columns],
        }
        return envelope
