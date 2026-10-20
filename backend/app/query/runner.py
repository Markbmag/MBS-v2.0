"""Runs questions in background threads: row caps, timeouts, cancel, a short result cache.

Every run is a QueryTask. The API waits a moment for it (most questions finish in
well under a second) and otherwise hands back a task id to poll or cancel.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

from sqlalchemy.engine import Connection, Engine

from ..results import ResultEnvelope, build_envelope
from .dialects import MYSQL_FAMILY
from .sqlguard import bind_params, find_params

logger = logging.getLogger(__name__)

FINAL = ("completed", "error", "cancelled")


class QueryCancelled(Exception):
    pass


@dataclass
class QueryTask:
    owner: str
    connection: str
    kind: str                                  # "builder" | "sql"
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: str = "running"
    result: ResultEnvelope | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    timed_out: bool = False
    cancel_event: threading.Event = field(default_factory=threading.Event)
    done: threading.Event = field(default_factory=threading.Event)
    _cancel_hook: Callable[[], None] | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def is_final(self) -> bool:
        return self.status in FINAL

    def set_cancel_hook(self, hook: Callable[[], None] | None) -> None:
        with self._lock:
            self._cancel_hook = hook
            fire = hook is not None and self.cancel_event.is_set()
        if fire:
            _safe(hook)

    def cancel(self, timed_out: bool = False) -> None:
        if self.is_final:
            return
        self.timed_out = self.timed_out or timed_out
        self.cancel_event.set()
        with self._lock:
            hook = self._cancel_hook
        if hook is not None:
            # A cancel can block (MySQL opens a connection for KILL QUERY): don't hold up the caller.
            threading.Thread(target=_safe, args=(hook,), daemon=True, name=f"ncode-cancel-{self.id[:8]}").start()

    def finish(self, status: str, result: ResultEnvelope | None = None, error: str | None = None) -> None:
        self.status, self.result, self.error = status, result, error
        self.finished_at = time.time()
        self.done.set()

    def snapshot(self) -> dict[str, Any]:
        end = self.finished_at or time.time()
        return {
            "task_id": self.id,
            "status": self.status,
            "result": self.result.model_dump() if self.result is not None else None,
            "error": self.error,
            "elapsed_ms": round((end - self.created_at) * 1000),
        }


def _safe(fn: Callable[[], None]) -> None:
    try:
        fn()
    except Exception as exc:  # cancelling is best effort
        logger.info("cancel hook failed: %s", exc)


class ResultCache:
    """Small in-memory LRU with a TTL. Keys include everything that changes the answer."""

    def __init__(self, ttl_sec: int, max_entries: int = 64):
        self.ttl = ttl_sec
        self.max = max_entries
        self._items: OrderedDict[str, tuple[float, ResultEnvelope]] = OrderedDict()
        self._lock = threading.Lock()

    @staticmethod
    def key(*parts: Any) -> str:
        return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()

    def get(self, key: str) -> ResultEnvelope | None:
        if self.ttl <= 0:
            return None
        with self._lock:
            item = self._items.get(key)
            if item is None:
                return None
            if time.time() - item[0] > self.ttl:
                del self._items[key]
                return None
            self._items.move_to_end(key)
            return item[1]

    def put(self, key: str, value: ResultEnvelope) -> None:
        if self.ttl <= 0:
            return
        with self._lock:
            self._items[key] = (time.time(), value)
            self._items.move_to_end(key)
            while len(self._items) > self.max:
                self._items.popitem(last=False)

    def drop_connection(self, connection: str) -> None:
        # keys are hashes; simplest correct thing when a connection changes is to forget everything
        with self._lock:
            self._items.clear()


class QueryRunner:
    def __init__(self, *, workers: int, timeout_sec: int, cache_ttl_sec: int, task_ttl_sec: int = 900):
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="ncode-query")
        self.timeout_sec = timeout_sec
        self.cache = ResultCache(cache_ttl_sec)
        self.task_ttl = task_ttl_sec
        self._tasks: dict[str, QueryTask] = {}
        self._lock = threading.Lock()

    # -- task bookkeeping -------------------------------------------------
    def get(self, task_id: str) -> QueryTask | None:
        self._cleanup()
        with self._lock:
            return self._tasks.get(task_id)

    def running_total(self) -> int:
        with self._lock:
            return sum(1 for t in self._tasks.values() if not t.is_final)

    def running_count(self, owner: str) -> int:
        with self._lock:
            return sum(1 for t in self._tasks.values() if t.owner == owner and not t.is_final)

    def _cleanup(self) -> None:
        cutoff = time.time() - self.task_ttl
        with self._lock:
            for tid in [t.id for t in self._tasks.values() if t.is_final and (t.finished_at or 0) < cutoff]:
                del self._tasks[tid]

    def shutdown(self) -> None:
        with self._lock:
            tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        self.pool.shutdown(wait=False, cancel_futures=True)

    # -- running ----------------------------------------------------------
    def submit(
        self,
        task: QueryTask,
        work: Callable[[QueryTask], ResultEnvelope],
        *,
        cache_key: str | None = None,
        read_cache: bool = True,
        on_finish: Callable[[QueryTask], None] | None = None,
    ) -> QueryTask:
        with self._lock:
            self._tasks[task.id] = task
        if cache_key is not None and read_cache:
            cached = self.cache.get(cache_key)
            if cached is not None:
                envelope = cached.model_copy(deep=True)
                envelope.stats.cached = True
                task.finish("completed", envelope)
                if on_finish:
                    on_finish(task)
                return task

        def run() -> None:
            timer = threading.Timer(self.timeout_sec + 2, task.cancel, kwargs={"timed_out": True})
            timer.daemon = True
            timer.start()
            try:
                if task.cancel_event.is_set():
                    raise QueryCancelled()
                envelope = work(task)
                if task.cancel_event.is_set():
                    raise QueryCancelled()
                task.finish("completed", envelope)
                if cache_key is not None:
                    self.cache.put(cache_key, envelope)
            except Exception as exc:
                if task.cancel_event.is_set() or isinstance(exc, QueryCancelled):
                    if task.timed_out:
                        task.finish("error", error=f"The query took longer than {self.timeout_sec} seconds and was stopped")
                    else:
                        task.finish("cancelled")
                else:
                    logger.info("query %s failed: %s", task.id, exc)
                    task.finish("error", error=_short_error(exc))
            finally:
                timer.cancel()
                task.set_cancel_hook(None)
                if on_finish:
                    try:
                        on_finish(task)
                    except Exception:
                        logger.exception("on_finish failed for query %s", task.id)

        self.pool.submit(run)
        return task


def _short_error(exc: Exception) -> str:
    text = str(getattr(exc, "orig", None) or exc).strip()
    return (text.splitlines()[0] if text else type(exc).__name__)[:500]


# ---------------------------------------------------------------------- execution

def _cancel_hook(engine: Engine, conn: Connection, dialect: str) -> Callable[[], None]:
    """How to stop the statement running on `conn` from another thread."""
    dbapi = conn.connection.dbapi_connection
    if dialect == "sqlite":
        return dbapi.interrupt
    if dialect == "postgresql":
        return getattr(dbapi, "cancel_safe", None) or dbapi.cancel
    if dialect in MYSQL_FAMILY:
        thread_id = conn.exec_driver_sql("SELECT CONNECTION_ID()").scalar()

        def kill() -> None:
            # A separate connection outside the pool: when the pool is full, waiting for a
            # pooled one would wait for the very connection we are trying to stop.
            raw = _unpooled_connection(engine)
            try:
                cursor = raw.cursor()
                cursor.execute(f"KILL QUERY {int(thread_id)}")
                cursor.close()
            finally:
                raw.close()

        return kill
    if dialect == "mssql":
        inner = getattr(dbapi, "_conn", None)
        if inner is not None and hasattr(inner, "cancel"):
            return inner.cancel
    return lambda: None


def _unpooled_connection(engine: Engine) -> Any:
    creator = getattr(engine.pool, "_creator", None)  # same driver arguments as the pool's connections
    if creator is not None:
        try:
            return creator()
        except TypeError:  # creators that take the connection record
            return creator(None)
    cargs, cparams = engine.dialect.create_connect_args(engine.url)
    return engine.dialect.connect(*cargs, **cparams)


def fetch_statement(engine: Engine, task: QueryTask, statement: Any, limit: int) -> tuple[list[str], list[tuple], bool]:
    """(column names, at most `limit` raw rows, truncated) of a compiled builder statement."""
    dialect = engine.dialect.name
    with engine.connect() as conn:
        task.set_cancel_hook(_cancel_hook(engine, conn, dialect))
        result = conn.execution_options(stream_results=dialect == "postgresql").execute(statement)
        names = list(result.keys())
        rows = result.fetchmany(limit + 1)
        result.close()
    return names, [tuple(r) for r in rows[:limit]], len(rows) > limit


def run_statement(engine: Engine, task: QueryTask, statement: Any, limit: int, column_types: list[str], sql: str) -> ResultEnvelope:
    """A compiled builder statement (already limited to limit + 1 rows)."""
    started = time.perf_counter()
    names, rows, truncated = fetch_statement(engine, task, statement, limit)
    return build_envelope(
        names, rows, column_types=column_types, duration_ms=(time.perf_counter() - started) * 1000,
        truncated=truncated, sql=sql,
    )


def fetch_sql(engine: Engine, task: QueryTask, sql: str, params: dict[str, Any], limit: int) -> tuple[list[str], list[tuple], bool]:
    """(column names, at most `limit` raw rows, truncated) of SQL typed by a user (already checked by sqlguard).

    The SQL runs exactly as written.

    Rows are capped without rewriting the SQL: PostgreSQL uses a server-side cursor
    (also refuses a second statement), MySQL/MariaDB sql_select_limit, SQL Server
    SET ROWCOUNT; then at most limit + 1 rows are fetched.
    """
    dialect = engine.dialect.name
    text = sql.rstrip()
    while text.endswith(";"):
        text = text[:-1].rstrip()
    if find_params(text):
        driver_sql, driver_params = bind_params(text, params, engine.dialect.paramstyle)
    else:
        driver_sql, driver_params = text, None
        if dialect == "postgresql":
            # Parameters are always passed to PostgreSQL (extended protocol: one statement only),
            # and with parameters psycopg reads every % as a placeholder: escape them.
            driver_sql = text.replace("%", "%%")

    with engine.connect() as conn:
        task.set_cancel_hook(_cancel_hook(engine, conn, dialect))
        dbapi = conn.connection.dbapi_connection
        cap = limit + 1
        reset: str | None = None
        if dialect in MYSQL_FAMILY:
            conn.exec_driver_sql(f"SET SESSION sql_select_limit = {int(cap)}")
            reset = "SET SESSION sql_select_limit = DEFAULT"
        elif dialect == "mssql":
            conn.exec_driver_sql(f"SET ROWCOUNT {int(cap)}")
            reset = "SET ROWCOUNT 0"
        try:
            if dialect == "postgresql":
                cursor = dbapi.cursor(name=f"ncode_{task.id[:12]}")
                cursor.execute(driver_sql, driver_params or {})
            else:
                cursor = dbapi.cursor()
                if driver_params:
                    cursor.execute(driver_sql, driver_params)
                else:
                    cursor.execute(driver_sql)
            if cursor.description is None:
                raise ValueError("The statement returned no rows")
            names = [d[0] for d in cursor.description]
            rows = [tuple(r) for r in cursor.fetchmany(cap)]
            cursor.close()
        except Exception:
            conn.rollback()
            raise
        finally:
            if reset is not None:
                try:
                    conn.exec_driver_sql(reset)
                except Exception:
                    conn.invalidate()  # never return a connection with a row cap to the pool
        if not conn.invalidated:
            conn.rollback()  # end the read transaction (closes the PostgreSQL cursor too)
    return names, rows[:limit], len(rows) > limit


def run_sql(engine: Engine, task: QueryTask, sql: str, params: dict[str, Any], limit: int) -> ResultEnvelope:
    """SQL typed by a user, as a result envelope."""
    started = time.perf_counter()
    names, rows, truncated = fetch_sql(engine, task, sql, params, limit)
    return build_envelope(
        names, rows, duration_ms=(time.perf_counter() - started) * 1000, truncated=truncated, sql=sql,
    )
