"""Browse a single table: paged rows, optional filter, structure and CSV export.

Table and column names always come from the cached schema (never from raw user
input), and values only ever travel as bound parameters.
"""

from __future__ import annotations

import csv
import io
import re
from typing import Any, Iterator

from sqlalchemy import column, inspect, or_, select, table as sa_table
from sqlalchemy.engine import Engine

from .config import ConnectionConfig
from .search import SearchOptions, build_conditions, classify_type, value_matches
from .serialize import serialize_value

# Same rule as the frontend: stop spreadsheets from executing cells such as "=1+1".
_FORMULA = re.compile(r"^(?:[=@\t\r]|[+-](?=[^\d\s.()-]))")


def split_columns(columns: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    """(columns we can show, binary columns we leave out)."""
    shown, omitted = [], []
    for col in columns:
        (omitted if classify_type(col["type"]) == "binary" else shown).append(col["name"])
    return shown, omitted


def _primary_key(engine: Engine, table_name: str, schema: str | None) -> list[str]:
    try:
        with engine.connect() as conn:
            return list(inspect(conn).get_pk_constraint(table_name, schema=schema).get("constrained_columns") or [])
    except Exception:
        return []


def _build_select(
    table_name: str, selected: list[str], schema: str | None, columns: list[dict[str, Any]], search: SearchOptions | None,
    row_filter: Any = None,
) -> tuple[Any, bool]:
    """(statement, can_search). can_search is False when a filter was asked for but nothing is searchable.
    row_filter: the viewer's row-level security condition (app/rowsec.py), always applied."""
    tbl = sa_table(table_name, *[column(n) for n in selected], schema=schema)
    stmt = select(*[tbl.c[n] for n in selected])
    if row_filter is not None:
        stmt = stmt.where(row_filter)
    if search is not None:
        conditions = build_conditions(columns, search)
        if not conditions:
            return stmt, False
        stmt = stmt.where(or_(*conditions))
    return stmt, True


def browse_table(
    engine: Engine,
    cfg: ConnectionConfig,
    table_name: str,
    columns: list[dict[str, Any]],
    *,
    limit: int,
    offset: int,
    sort: str | None,
    descending: bool,
    search: SearchOptions | None,
    row_filter: Any = None,
) -> dict[str, Any]:
    schema = cfg.schema
    selected, omitted = split_columns(columns)
    result: dict[str, Any] = {
        "table": table_name,
        "columns": selected,
        "omitted": omitted,
        "rows": [],
        "has_more": False,
        "offset": offset,
        "limit": limit,
        "sort": sort if sort in selected else None,
        "descending": descending and sort in selected,
        "note": None,
    }
    if not selected:
        result["note"] = "This table only has binary columns, which are not shown."
        return result

    stmt, can_search = _build_select(table_name, selected, schema, columns, search, row_filter)
    if not can_search:
        result["note"] = "None of this table's columns can be searched for this phrase."
        return result

    if sort in selected:
        sort_col = column(sort)
        order = [sort_col.desc() if descending else sort_col.asc()]
    else:
        # Stable paging needs an ORDER BY (SQL Server requires one for OFFSET).
        keys = [c for c in _primary_key(engine, table_name, schema) if c in selected] or selected[:1]
        order = [column(c).asc() for c in keys]

    stmt = stmt.order_by(*order).limit(limit + 1).offset(offset)
    with engine.connect() as conn:
        rows = conn.execute(stmt).mappings().all()

    if len(rows) > limit:
        result["has_more"] = True
        rows = rows[:limit]

    for raw in rows:
        values = {k: serialize_value(v) for k, v in raw.items()}
        matched = [k for k, v in values.items() if value_matches(v, search)] if search is not None else []
        result["rows"].append({"values": values, "matched": matched})
    return result


def table_structure(
    engine: Engine, cfg: ConnectionConfig, table_name: str, columns: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    primary = set(_primary_key(engine, table_name, cfg.schema))
    out = []
    for col in columns:
        try:
            type_text = col["type"].compile(dialect=engine.dialect)
        except Exception:
            type_text = type(col["type"]).__name__
        out.append(
            {
                "name": col["name"],
                "type": str(type_text),
                "nullable": bool(col.get("nullable", True)),
                "primary_key": col["name"] in primary,
            }
        )
    return out


def _csv_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return f"'{value}" if _FORMULA.match(value) else value
    return str(serialize_value(value, clip=False))


def csv_stream(
    engine: Engine,
    cfg: ConnectionConfig,
    table_name: str,
    columns: list[dict[str, Any]],
    *,
    delimiter: str,
    max_rows: int,
    sort: str | None,
    descending: bool,
    search: SearchOptions | None,
    row_filter: Any = None,
) -> Iterator[str]:
    """Yields the CSV in chunks so big exports never sit in memory."""
    selected, _omitted = split_columns(columns)
    stmt, can_search = _build_select(table_name, selected, cfg.schema, columns, search, row_filter)

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=delimiter, lineterminator="\r\n")

    def flush() -> str:
        data = buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)
        return data

    yield "\ufeff"  # BOM: Excel then reads the file as UTF-8 (Cyrillic etc.)
    writer.writerow(selected)
    yield flush()
    if not selected or not can_search:
        return

    if sort in selected:
        sort_col = column(sort)
        stmt = stmt.order_by(sort_col.desc() if descending else sort_col.asc())

    with engine.connect() as conn:
        result = conn.execution_options(stream_results=True).execute(stmt.limit(max_rows))
        for chunk in result.partitions(500):
            for row in chunk:
                writer.writerow([_csv_cell(v) for v in row])
            yield flush()
