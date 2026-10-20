"""Row-level security (roadmap M9): per-group row filters.

An admin gives a group rules like "connection shop, table orders: region in (EU, CH)". A member
of the group then only sees those rows of that table, wherever its rows are read:

* questions built without SQL, dashboards, subscriptions, public links, multi-source sources,
  profiles and X-rays (the condition is added to the question before it is compiled);
* Browse, its CSV export (the condition is added to the SELECT);
* Search skips the table (it searches every column of every table, row by row);
* SQL mode, saved SQL questions and SQL sources of multi-source questions are refused on that
  connection: SQL cannot be filtered reliably.

Combining: a group's rules on one table must all match (AND); with several restricted groups the
user sees what any of them may see (OR). Users in no restricted group, and admins, see everything.
The value "{username}" or "{email}" stands for the viewer, e.g. orders where sales_rep = {username}.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from typing import Any

from sqlalchemy import and_, delete, insert, or_, select
from sqlalchemy.engine import Engine
from sqlalchemy.sql import ColumnElement, column as sa_column

from .appdb import User, groups_table, row_rules_table

SPECIAL = ("{username}", "{email}")


class RowSecurityError(Exception):
    """The viewer may not do this because of row-level rules (message safe to show)."""


@dataclass(frozen=True)
class Rule:
    id: int
    group_id: int
    connection: str
    table: str
    column: str
    values: tuple[str, ...]

    def json(self, group_name: str | None = None) -> dict[str, Any]:
        return {"id": self.id, "group_id": self.group_id, "group": group_name, "connection": self.connection,
                "table": self.table, "column": self.column, "values": list(self.values)}


class RowRules:
    def __init__(self, engine: Engine):
        self.engine = engine
        self._lock = threading.Lock()
        self._cache: list[Rule] | None = None

    # ------------------------------------------------------------------ storage
    def all(self) -> list[Rule]:
        with self._lock:
            if self._cache is None:
                with self.engine.connect() as conn:
                    rows = conn.execute(select(row_rules_table).order_by(row_rules_table.c.id)).all()
                self._cache = [
                    Rule(r.id, r.group_id, r.connection, r.table_name, r.column_name, tuple(json.loads(r.values)))
                    for r in rows
                ]
            return list(self._cache)

    def _changed(self) -> None:
        with self._lock:
            self._cache = None

    def add(self, group_id: int, connection: str, table: str, column: str, values: list[str], by: str) -> int:
        with self.engine.begin() as conn:
            if conn.execute(select(groups_table.c.id).where(groups_table.c.id == group_id)).first() is None:
                raise KeyError(group_id)
            rid = conn.execute(insert(row_rules_table).values(
                group_id=group_id, connection=connection, table_name=table, column_name=column,
                values=json.dumps(values), created_at=time.time(), created_by=by,
            )).inserted_primary_key[0]
        self._changed()
        return int(rid)

    def remove(self, rid: int) -> bool:
        with self.engine.begin() as conn:
            gone = conn.execute(delete(row_rules_table).where(row_rules_table.c.id == rid)).rowcount > 0
        self._changed()
        return gone

    def forget_group(self) -> None:
        self._changed()  # rows were deleted with the group (AppDB.delete_group)

    # ------------------------------------------------------------------ evaluation
    def for_user(self, user: User, connection: str) -> dict[str, list[list[tuple[str, tuple[str, ...]]]]]:
        """{table (lower case): [one list of (column, values) per restricted group]}; {} = unrestricted."""
        if user.is_admin or not user.group_ids:
            return {}
        by_table: dict[str, dict[int, list[tuple[str, tuple[str, ...]]]]] = {}
        for r in self.all():
            if r.connection != connection or r.group_id not in user.group_ids:
                continue
            values = tuple(_resolve(v, user) for v in r.values)
            by_table.setdefault(r.table.lower(), {}).setdefault(r.group_id, []).append((r.column, values))
        return {t: list(groups.values()) for t, groups in by_table.items()}

    def restricted(self, user: User, connection: str) -> bool:
        return bool(self.for_user(user, connection))

    def check_sql(self, user: User, connection: str) -> None:
        if self.restricted(user, connection):
            raise RowSecurityError(
                "Row-level rules apply to you on this database, so SQL is not available there. "
                "Use a question built without SQL."
            )

    # -------- builder questions: conditions added to the spec (app/query/routes.compile_for)
    def apply_to_spec(self, spec: Any, user: User, tables: dict[str, list[dict[str, Any]]]) -> Any:
        """The question with the user's row conditions added; `tables`: the schema ({table: [column dicts]})."""
        rules = self.for_user(user, spec.connection)
        if not rules:
            return spec
        from .query.spec import Condition, FilterGroup

        added: list[Any] = []
        sources = [(spec.source.table, spec.source.alias or spec.source.table)]
        sources += [(j.table, j.alias or j.table) for j in spec.joins]
        for table, alias in sources:
            groups = rules.get(table.lower())
            if not groups:
                continue
            cols = _columns(tables.get(table, []))
            alternatives = []
            for group_rules in groups:
                conditions = []
                for col, values in group_rules:
                    name, numeric = _find(cols, col, table)
                    conditions.append(Condition(ref=f"{alias}.{name}", op="in", value=_typed(values, numeric), case_sensitive=True))
                alternatives.append(FilterGroup(op="and", rules=conditions))
            added.append(alternatives[0] if len(alternatives) == 1 else FilterGroup(op="or", rules=alternatives))
        if not added:
            return spec
        rules_group = FilterGroup(op="and", rules=([spec.filters] if spec.filters else []) + added)
        return spec.model_copy(update={"filters": rules_group})

    # -------- Browse / export: a WHERE condition
    def where(self, user: User, connection: str, table: str, columns: list[dict[str, Any]]) -> ColumnElement[bool] | None:
        groups = self.for_user(user, connection).get(table.lower())
        if not groups:
            return None
        cols = _columns(columns)
        alternatives = []
        for group_rules in groups:
            parts = []
            for col, values in group_rules:
                name, numeric = _find(cols, col, table)
                parts.append(sa_column(name).in_(_typed(values, numeric)))
            alternatives.append(and_(*parts))
        return or_(*alternatives)

    def searchable_tables(self, user: User, connection: str, tables: list[str]) -> list[str]:
        restricted = set(self.for_user(user, connection))
        return [t for t in tables if t.lower() not in restricted]


def _resolve(value: str, user: User) -> str:
    if value == "{username}":
        return user.username
    if value == "{email}":
        return user.email or "\x00no-email"  # matches nothing
    return value


def _columns(columns: list[dict[str, Any]]) -> dict[str, tuple[str, bool]]:
    from .search import classify_type

    return {c["name"].lower(): (c["name"], classify_type(c.get("type")) == "numeric") for c in columns}


def _find(cols: dict[str, tuple[str, bool]], col: str, table: str) -> tuple[str, bool]:
    found = cols.get(col.lower())
    if found is None:  # the column of a rule is gone: refuse rather than show everything
        raise RowSecurityError(f"A row-level rule on {table} names a column that does not exist any more. Ask an admin.")
    return found


def _typed(values: tuple[str, ...], numeric: bool) -> list[Any]:
    """Rule values are text; numeric columns compare with numbers (PostgreSQL refuses integer = text)."""
    if not numeric:
        return list(values)
    out: list[Any] = []
    for v in values:
        try:
            out.append(int(v) if v.strip().lstrip("-").isdigit() else float(v))
        except ValueError:
            continue  # cannot match a number column
    return out or [None]
