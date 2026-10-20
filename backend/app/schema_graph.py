"""Schema v2: normalised column types, primary/foreign keys and the relationship graph.

Everything here is pure (no database access), so it is tested without a server.
The query builder (M1/M2) uses the graph to suggest joins between tables that are
not directly related, e.g. order_items -> orders -> customers.
"""

from __future__ import annotations

from collections import deque
from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy import types as sqltypes

# The small set of types the UI, charts and formatting work with.
TYPES = ("string", "number", "boolean", "date", "datetime", "time", "json", "binary", "unknown")


def normalize_type(col_type: Any) -> str:
    """Map a SQLAlchemy column type (as reflected from any engine) to one of TYPES."""
    t = col_type
    if isinstance(t, sqltypes.NullType) or t is None:
        return "unknown"
    if isinstance(t, sqltypes.Boolean):
        return "boolean"
    if isinstance(t, (sqltypes.Integer, sqltypes.Numeric)):  # Float is a Numeric
        return "number"
    # DateTime is not a subclass of Date in SQLAlchemy, but check it first anyway.
    if isinstance(t, sqltypes.DateTime):
        return "datetime"
    if isinstance(t, sqltypes.Date):
        return "date"
    if isinstance(t, sqltypes.Time):
        return "time"
    if isinstance(t, (sqltypes.JSON, sqltypes.ARRAY)):
        return "json"
    if isinstance(t, getattr(sqltypes, "_Binary", sqltypes.LargeBinary)):
        return "binary"
    if isinstance(t, (sqltypes.String, sqltypes.Uuid, sqltypes.Interval)):  # Text, Enum, Unicode ...
        return "string"
    # Dialect-specific types that don't inherit from the generic ones (MySQL YEAR,
    # SQL Server MONEY, PostgreSQL INTERVAL ...): their python type, else their name.
    try:
        found = python_type_name(t.python_type)
    except (NotImplementedError, AttributeError):
        found = "unknown"
    if found != "unknown":
        return found
    name = type(t).__name__.upper()
    if name in _NUMBER_NAMES:
        return "number"
    if name in _STRING_NAMES:
        return "string"
    return "unknown"


_NUMBER_NAMES = {"YEAR", "MONEY", "SMALLMONEY"}
_STRING_NAMES = {"INTERVAL", "INET", "CIDR", "MACADDR", "XML", "SQL_VARIANT", "HIERARCHYID", "CITEXT", "TSVECTOR"}


def python_type_name(python_type: type) -> str:
    import datetime as dt
    import decimal

    if issubclass(python_type, bool):
        return "boolean"
    if issubclass(python_type, (int, float, decimal.Decimal)):
        return "number"
    if issubclass(python_type, dt.datetime):
        return "datetime"
    if issubclass(python_type, dt.date):
        return "date"
    if issubclass(python_type, dt.time):
        return "time"
    if issubclass(python_type, (dict, list)):
        return "json"
    if issubclass(python_type, (bytes, bytearray, memoryview)):
        return "binary"
    if issubclass(python_type, str):
        return "string"
    return "unknown"


@dataclass(frozen=True)
class Relationship:
    """One foreign key: from_table(from_columns) references to_table(to_columns)."""

    from_table: str
    from_columns: tuple[str, ...]
    to_table: str
    to_columns: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["from_columns"] = list(self.from_columns)
        data["to_columns"] = list(self.to_columns)
        return data


def relationships(foreign_keys: dict[str, list[dict[str, Any]]], tables: set[str]) -> list[Relationship]:
    """Relationships between known tables, from reflected foreign keys ({table: [fk dicts]}).

    Keys pointing to tables outside the set (another schema, a view, a table the
    user cannot see) are left out: the builder could not join to them anyway.
    """
    out: set[Relationship] = set()
    for table, fks in foreign_keys.items():
        if table not in tables:
            continue
        for fk in fks:
            target = fk.get("referred_table")
            cols = tuple(fk.get("constrained_columns") or ())
            ref_cols = tuple(fk.get("referred_columns") or ())
            if target in tables and cols and len(cols) == len(ref_cols):
                out.add(Relationship(table, cols, target, ref_cols))
    return sorted(out, key=lambda r: (r.from_table, r.from_columns, r.to_table, r.to_columns))


@dataclass(frozen=True)
class JoinStep:
    """Join `table` using `on` pairs of (column already in the query, column of `table`)."""

    table: str
    on: tuple[tuple[str, str], ...]
    via: Relationship


def find_join_path(rels: list[Relationship], start: str, target: str, max_hops: int = 4) -> list[JoinStep] | None:
    """Shortest chain of joins from `start` to `target` (foreign keys work in both directions).

    Returns [] when start == target and None when the tables are not connected within
    max_hops. Ties are broken alphabetically, so the answer is stable.
    """
    if start == target:
        return []
    adjacency: dict[str, list[tuple[str, JoinStep]]] = {}
    for rel in rels:
        forward = JoinStep(
            rel.to_table,
            tuple((f"{rel.from_table}.{a}", f"{rel.to_table}.{b}") for a, b in zip(rel.from_columns, rel.to_columns)),
            rel,
        )
        backward = JoinStep(
            rel.from_table,
            tuple((f"{rel.to_table}.{b}", f"{rel.from_table}.{a}") for a, b in zip(rel.from_columns, rel.to_columns)),
            rel,
        )
        adjacency.setdefault(rel.from_table, []).append((rel.to_table, forward))
        adjacency.setdefault(rel.to_table, []).append((rel.from_table, backward))
    for edges in adjacency.values():
        edges.sort(key=lambda e: (e[0], e[1].on))

    queue: deque[tuple[str, list[JoinStep]]] = deque([(start, [])])
    seen = {start}
    while queue:
        table, path = queue.popleft()
        if len(path) >= max_hops:
            continue
        for neighbour, step in adjacency.get(table, []):
            if neighbour in seen:
                continue
            if neighbour == target:
                return path + [step]
            seen.add(neighbour)
            queue.append((neighbour, path + [step]))
    return None


def describe_schema(
    columns: dict[str, list[dict[str, Any]]],
    primary_keys: dict[str, list[str]],
    foreign_keys: dict[str, list[dict[str, Any]]],
    fields: dict[str, dict[str, dict[str, Any]]] | None = None,
    manual: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """The JSON body of GET /api/connections/{key}/schema.

    `fields` (column metadata) and `manual` (relationships added by an admin) come from
    the semantic layer (M7); a column read as a date is typed "datetime".
    """
    names = set(columns)
    fields = fields or {}
    manual = manual or {}
    merged = {t: list(foreign_keys.get(t, [])) + list(manual.get(t, [])) for t in set(foreign_keys) | set(manual)}
    rels = relationships(merged, names)
    manual_rels = set(relationships(manual, names))
    fk_of: dict[tuple[str, str], dict[str, str]] = {}
    for rel in rels:
        for a, b in zip(rel.from_columns, rel.to_columns):
            fk_of.setdefault((rel.from_table, a), {"table": rel.to_table, "column": b})

    tables = []
    for name in sorted(columns, key=str.lower):
        pk = list(primary_keys.get(name) or [])
        tables.append(
            {
                "name": name,
                "primary_key": pk,
                "columns": [_column_json(name, col, pk, fk_of, fields.get(name, {}).get(col["name"])) for col in columns[name]],
            }
        )
    return {
        "version": 2,
        "tables": tables,
        "relationships": [{**r.to_dict(), "manual": r in manual_rels} for r in rels],
    }


def _column_json(table: str, col: dict[str, Any], pk: list[str], fk_of: dict, meta: dict[str, Any] | None) -> dict[str, Any]:
    out = {
        "name": col["name"],
        "type": normalize_type(col["type"]),
        "db_type": _db_type(col["type"]),
        "nullable": bool(col.get("nullable", True)),
        "primary_key": col["name"] in pk,
        "foreign_key": fk_of.get((table, col["name"])),
    }
    if meta:
        out.update({k: meta.get(k) for k in ("display_name", "description", "semantic_type", "format", "hidden", "parse_as_date")})
        if meta.get("parse_as_date"):
            out["type"] = "datetime"
    return out


def _db_type(col_type: Any) -> str:
    try:
        return str(col_type)
    except Exception:  # some dialect types cannot render without a dialect
        return type(col_type).__name__
