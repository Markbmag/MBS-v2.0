"""An in-process DuckDB session for one multi-source run (or one file upload).

Rows read from the databases are loaded as typed tables; uploaded files are read
from Ncode's own Parquet copies. Before anything a user wrote runs, the session is
locked down: no file or network access, no extensions, and the configuration
cannot be changed back (`lock_configuration`). Memory and threads are capped.
"""

from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Any, Sequence

from sqlalchemy import types as sqltypes

from ..serialize import serialize_value

INSERT_CHUNK = 50_000
_INT64 = (-(2**63), 2**63 - 1)


class FederationUnavailable(RuntimeError):
    """DuckDB is not installed."""


def _duckdb() -> Any:
    try:
        import duckdb
    except ImportError as exc:  # pragma: no cover - duckdb is in requirements.txt
        raise FederationUnavailable(
            "Multi-source questions and uploads need the duckdb package: pip install -r requirements.txt"
        ) from exc
    return duckdb


def available() -> bool:
    try:
        _duckdb()
    except FederationUnavailable:
        return False
    return True


def quote(name: str) -> str:
    """A DuckDB identifier. Every name used here comes from loaded data or the spec's aliases."""
    return '"' + name.replace('"', '""') + '"'


def literal(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


# ---------------------------------------------------------------- types

def ncode_type(duck_type: Any) -> str:
    """DuckDB column type (or its name) -> one of schema_graph.TYPES."""
    name = str(duck_type).upper()
    if name.endswith("]") or name.startswith(("STRUCT", "MAP", "UNION", "JSON")):  # INTEGER[] is a list, not a number
        return "json"
    if name.startswith(("TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UTINYINT", "USMALLINT", "UINTEGER",
                        "UBIGINT", "UHUGEINT", "DECIMAL", "DOUBLE", "FLOAT", "REAL", "NUMERIC")):
        return "number"
    if name.startswith("BOOLEAN"):
        return "boolean"
    if name.startswith("TIMESTAMP") or name == "DATETIME":
        return "datetime"
    if name == "DATE":
        return "date"
    if name.startswith("TIME"):
        return "time"
    if name in ("VARCHAR", "UUID", "INTERVAL", "BIT") or name.startswith(("VARCHAR", "ENUM")):
        return "string"
    if name == "BLOB":
        return "binary"
    return "unknown"


def sa_type(ncode: str) -> sqltypes.TypeEngine:
    """What the query compiler needs to know about a column of the combined result."""
    return {
        "number": sqltypes.Float(), "boolean": sqltypes.Boolean(), "datetime": sqltypes.DateTime(),
        "date": sqltypes.Date(), "time": sqltypes.Time(), "string": sqltypes.String(),
    }.get(ncode, sqltypes.String())


def _column_plan(values: Sequence[Any]) -> tuple[str, Any]:
    """(DuckDB type, converter) for a column of raw driver values.

    Databases like SQLite mix types inside one column; anything that is not one
    clean type becomes text, so loading never fails half-way.
    """
    kinds: set[str] = set()
    low, high = 0, 0
    for v in values:
        if v is None:
            continue
        if isinstance(v, bool):
            kinds.add("bool")
        elif isinstance(v, int):
            kinds.add("int")
            low, high = min(low, v), max(high, v)
        elif isinstance(v, (float, Decimal)):
            kinds.add("float")
        elif isinstance(v, dt.datetime):
            kinds.add("datetime")
        elif isinstance(v, dt.date):
            kinds.add("date")
        elif isinstance(v, dt.time):
            kinds.add("time")
        else:
            kinds.add("text")
        if len(kinds) > 2:
            break
    if not kinds:
        return "VARCHAR", None
    if kinds == {"bool"}:
        return "BOOLEAN", None
    if kinds == {"int"} and _INT64[0] <= low and high <= _INT64[1]:
        return "BIGINT", None
    if kinds <= {"int", "float"}:
        return "DOUBLE", lambda v: None if v is None else float(v)
    if kinds == {"datetime"} or kinds == {"datetime", "date"}:
        return "TIMESTAMP", _as_naive_datetime
    if kinds == {"date"}:
        return "DATE", None
    if kinds == {"time"}:
        return "TIME", lambda v: None if v is None else v.replace(tzinfo=None)
    return "VARCHAR", _as_text


def _as_naive_datetime(v: Any) -> Any:
    if v is None:
        return None
    if not isinstance(v, dt.datetime):
        return dt.datetime(v.year, v.month, v.day)
    if v.tzinfo is not None:  # one clock for every source: UTC
        return v.astimezone(dt.timezone.utc).replace(tzinfo=None)
    return v


def _as_text(v: Any) -> Any:
    if v is None or isinstance(v, str):
        return v
    return str(serialize_value(v, clip=False))


def unique_names(names: Sequence[str]) -> list[str]:
    """Column names DuckDB accepts: not empty, unique (case-insensitively, as DuckDB compares them)."""
    out: list[str] = []
    seen: set[str] = set()
    for i, raw in enumerate(names):
        name = (str(raw) if raw is not None else "").strip()[:128] or f"column_{i + 1}"
        base, n = name, 2
        while name.lower() in seen:
            name = f"{base}_{n}"
            n += 1
        seen.add(name.lower())
        out.append(name)
    return out


# ---------------------------------------------------------------- the session

class Workspace:
    def __init__(self, *, memory_mb: int, threads: int):
        duckdb = _duckdb()
        self.con = duckdb.connect(
            ":memory:",
            config={
                "memory_limit": f"{int(memory_mb)}MB",
                "threads": int(threads),
                "autoinstall_known_extensions": False,
                "autoload_known_extensions": False,
                "temp_directory": "",  # no spilling to disk: the memory limit is the limit
            },
        )
        self.locked = False

    # -- loading (before lock) -------------------------------------------
    def load_rows(self, table: str, names: Sequence[str], rows: Sequence[Sequence[Any]]) -> list[str]:
        """A table from raw driver rows. Returns the column names used."""
        cols = unique_names(names)
        columns = list(zip(*rows)) if rows else [() for _ in cols]
        plans = [_column_plan(values) for values in columns]
        ddl = ", ".join(f"{quote(c)} {t}" for c, (t, _) in zip(cols, plans))
        self.con.execute(f"CREATE TABLE {quote(table)} ({ddl})")
        if rows and cols:
            converted = [
                list(values) if conv is None else [conv(v) for v in values]
                for values, (_t, conv) in zip(columns, plans)
            ]
            unnest = ", ".join(f"UNNEST(${i + 1}::{t}[])" for i, (t, _) in enumerate(plans))
            for start in range(0, len(rows), INSERT_CHUNK):
                self.con.execute(
                    f"INSERT INTO {quote(table)} SELECT {unnest}",
                    [values[start:start + INSERT_CHUNK] for values in converted],
                )
        return cols

    def load_parquet(self, table: str, path: Path) -> None:
        if self.locked:
            raise RuntimeError("files are loaded before the session is locked")
        self.con.execute(f"CREATE TABLE {quote(table)} AS SELECT * FROM read_parquet({literal(str(path))})")

    def lock(self) -> None:
        """From here on nothing outside this session can be reached, and that cannot be undone."""
        self.con.execute("SET enable_external_access = false")
        self.con.execute("SET allow_community_extensions = false")
        self.con.execute("SET lock_configuration = true")
        self.locked = True

    # -- querying ---------------------------------------------------------
    def columns(self, table: str) -> list[tuple[str, str]]:
        """(name, DuckDB type) of a table."""
        rows = self.con.execute(f"DESCRIBE {quote(table)}").fetchall()
        return [(r[0], str(r[1])) for r in rows]

    def count(self, table: str) -> int:
        return int(self.con.execute(f"SELECT count(*) FROM {quote(table)}").fetchone()[0])

    def execute(self, sql: str, params: Sequence[Any] | None = None) -> Any:
        return self.con.execute(sql, list(params or []))

    def fetch(self, sql: str, params: Sequence[Any] | None = None, limit: int | None = None) -> tuple[list[str], list[str], list[tuple]]:
        """(names, DuckDB types, rows) of a query; at most `limit` rows."""
        cur = self.con.execute(sql, list(params or []))
        names = [d[0] for d in cur.description]
        types = [str(d[1]) for d in cur.description]
        rows = cur.fetchmany(limit) if limit is not None else cur.fetchall()
        return names, types, [tuple(r) for r in rows]

    def interrupt(self) -> None:
        try:
            self.con.interrupt()
        except Exception:  # already closed
            pass

    def close(self) -> None:
        try:
            self.con.close()
        except Exception:
            pass


def scratch_name() -> str:
    return "t_" + uuid.uuid4().hex[:12]
