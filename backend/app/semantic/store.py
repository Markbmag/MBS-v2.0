"""The semantic layer (roadmap M7): what columns mean, how tables relate, named metrics.

* Column metadata, per connection / table / column: display name, description,
  semantic type (currency, percent, category ...), number/date format, hidden, and
  "parse as date" for text columns that hold dates in several formats.
* Manual relationships, for databases without foreign keys: the builder then joins
  and suggests joins as if they were real foreign keys.
* Metrics: a named aggregation on a table ("Revenue" = sum of total where status is
  paid), used in questions like any other summary.

Admins maintain all three (Admin -> Data model); everyone who may use a connection
sees them. Small tables, read on every compile: cached until the next change.
"""

from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import delete, insert, select, update
from sqlalchemy.engine import Engine

from ..appdb import User
from ..content.store import ContentError, NotFound
from ..content.tables import field_metadata_table, metrics_table, relationships_table
from ..query.spec import AggregateFn, Expr, FilterGroup, QuerySpec

SemanticType = Literal[
    "category", "id", "name", "email", "url", "currency", "percent", "quantity", "score", "latitude", "longitude",
    "created", "updated", "description",
]
SEMANTIC_TYPES = SemanticType.__args__  # type: ignore[attr-defined]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FieldIn(_Model):
    display_name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    semantic_type: SemanticType | None = None
    format: dict[str, Any] | None = None
    hidden: bool = False
    parse_as_date: bool = False

    @model_validator(mode="after")
    def _small(self) -> "FieldIn":
        if self.format is not None and len(json.dumps(self.format)) > 2000:
            raise ValueError("the format is too large")
        return self

    def empty(self) -> bool:
        return self == FieldIn()


class RelationshipIn(_Model):
    from_table: str = Field(min_length=1, max_length=255)
    from_columns: list[str] = Field(min_length=1, max_length=4)
    to_table: str = Field(min_length=1, max_length=255)
    to_columns: list[str] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def _pairs(self) -> "RelationshipIn":
        if len(self.from_columns) != len(self.to_columns):
            raise ValueError("give as many columns on each side")
        return self


class MetricDefinition(_Model):
    """An aggregation of the metric's table: {"fn": "sum", "ref": "orders.total", "where": {...}}."""

    fn: AggregateFn
    ref: str | None = Field(default=None, min_length=1, max_length=300)
    expr: Expr | None = None
    where: FilterGroup | None = None

    @model_validator(mode="after")
    def _shape(self) -> "MetricDefinition":
        if self.fn == "metric":
            raise ValueError("a metric cannot be built from another metric")
        if self.ref is not None and self.expr is not None:
            raise ValueError("a metric takes ref or expr, not both")
        if self.ref is None and self.expr is None and self.fn != "count":
            raise ValueError(f"{self.fn} needs a column")
        return self


class MetricIn(_Model):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    connection: str = Field(min_length=1, max_length=64)
    table: str = Field(min_length=1, max_length=255)
    definition: MetricDefinition
    format: dict[str, Any] | None = None


@dataclass
class Metric:
    id: int
    name: str
    description: str | None
    connection: str
    table: str
    definition: dict[str, Any]
    format: dict[str, Any] | None
    archived: bool
    updated_at: float
    updated_by: str | None

    @property
    def slug(self) -> str:
        return re.sub(r"[^a-z0-9_]+", "_", self.name.lower()).strip("_")[:60] or f"metric_{self.id}"

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id, "name": self.name, "description": self.description, "connection": self.connection,
            "table": self.table, "definition": self.definition, "format": self.format, "archived": self.archived,
            "slug": self.slug, "updated_at": self.updated_at, "updated_by": self.updated_by,
        }


@dataclass
class _Cache:
    fields: dict[str, dict[str, dict[str, dict[str, Any]]]] = field(default_factory=dict)  # conn -> table -> column -> meta
    rels: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    metrics: dict[int, Metric] = field(default_factory=dict)


def _loads(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except ValueError:
        return default


class SemanticStore:
    def __init__(self, engine: Engine):
        self.engine = engine
        self._cache: _Cache | None = None
        self._lock = threading.Lock()

    def _data(self) -> _Cache:
        with self._lock:
            if self._cache is not None:
                return self._cache
        cache = _Cache()
        with self.engine.connect() as conn:
            for r in conn.execute(select(field_metadata_table)).all():
                cache.fields.setdefault(r.connection, {}).setdefault(r.table_name, {})[r.column_name] = {
                    "display_name": r.display_name, "description": r.description, "semantic_type": r.semantic_type,
                    "format": _loads(r.format, None), "hidden": bool(r.hidden), "parse_as_date": bool(r.parse_as_date),
                }
            for r in conn.execute(select(relationships_table).order_by(relationships_table.c.id)).all():
                cache.rels.setdefault(r.connection, []).append({
                    "id": r.id, "from_table": r.from_table, "from_columns": _loads(r.from_columns, []),
                    "to_table": r.to_table, "to_columns": _loads(r.to_columns, []), "created_by": r.created_by,
                })
            for r in conn.execute(select(metrics_table).order_by(metrics_table.c.name)).all():
                cache.metrics[r.id] = Metric(
                    r.id, r.name, r.description, r.connection, r.table_name, _loads(r.definition, {}),
                    _loads(r.format, None), bool(r.archived), r.updated_at, r.updated_by,
                )
        with self._lock:
            self._cache = cache
        return cache

    def _changed(self) -> None:
        with self._lock:
            self._cache = None

    # ------------------------------------------------------------------ columns
    def fields(self, connection: str) -> dict[str, dict[str, dict[str, Any]]]:
        return self._data().fields.get(connection, {})

    def set_field(self, user: User, connection: str, table: str, column: str, values: FieldIn) -> dict[str, Any] | None:
        where = (
            (field_metadata_table.c.connection == connection)
            & (field_metadata_table.c.table_name == table)
            & (field_metadata_table.c.column_name == column)
        )
        with self.engine.begin() as conn:
            conn.execute(delete(field_metadata_table).where(where))
            if not values.empty():
                conn.execute(insert(field_metadata_table).values(
                    connection=connection, table_name=table, column_name=column,
                    display_name=(values.display_name or "").strip() or None,
                    description=(values.description or "").strip() or None,
                    semantic_type=values.semantic_type, format=json.dumps(values.format) if values.format else None,
                    hidden=values.hidden, parse_as_date=values.parse_as_date,
                    updated_at=time.time(), updated_by=user.username,
                ))
        self._changed()
        return self.fields(connection).get(table, {}).get(column)

    # ------------------------------------------------------------------ relationships
    def relationships(self, connection: str) -> list[dict[str, Any]]:
        return list(self._data().rels.get(connection, []))

    def foreign_keys(self, connection: str) -> dict[str, list[dict[str, Any]]]:
        """Manual relationships in the shape of reflected foreign keys ({table: [fk]})."""
        out: dict[str, list[dict[str, Any]]] = {}
        for r in self.relationships(connection):
            out.setdefault(r["from_table"], []).append({
                "constrained_columns": r["from_columns"], "referred_table": r["to_table"],
                "referred_columns": r["to_columns"], "manual": True,
            })
        return out

    def add_relationship(self, user: User, connection: str, rel: RelationshipIn) -> dict[str, Any]:
        with self.engine.begin() as conn:
            rid = int(conn.execute(insert(relationships_table).values(
                connection=connection, from_table=rel.from_table, from_columns=json.dumps(rel.from_columns),
                to_table=rel.to_table, to_columns=json.dumps(rel.to_columns), created_at=time.time(),
                created_by=user.username,
            )).inserted_primary_key[0])
        self._changed()
        return next(r for r in self.relationships(connection) if r["id"] == rid)

    def delete_relationship(self, connection: str, rid: int) -> None:
        with self.engine.begin() as conn:
            gone = conn.execute(delete(relationships_table).where(
                (relationships_table.c.id == rid) & (relationships_table.c.connection == connection)
            )).rowcount
        if not gone:
            raise NotFound("Relationship")
        self._changed()

    # ------------------------------------------------------------------ metrics
    def metrics(self, connections: set[str] | None = None, *, archived: bool = False) -> list[Metric]:
        return [
            m for m in self._data().metrics.values()
            if m.archived == archived and (connections is None or m.connection in connections)
        ]

    def metric(self, mid: int) -> Metric:
        m = self._data().metrics.get(mid)
        if m is None:
            raise NotFound("Metric")
        return m

    def save_metric(self, user: User, body: MetricIn, mid: int | None = None) -> Metric:
        values = dict(
            name=body.name.strip(), description=(body.description or "").strip() or None, connection=body.connection,
            table_name=body.table, definition=json.dumps(body.definition.model_dump(mode="json", by_alias=True, exclude_none=True)),
            format=json.dumps(body.format) if body.format else None, updated_at=time.time(), updated_by=user.username,
        )
        with self.engine.begin() as conn:
            if mid is None:
                mid = int(conn.execute(insert(metrics_table).values(created_at=time.time(), archived=False, **values)).inserted_primary_key[0])
            else:
                self.metric(mid)
                conn.execute(update(metrics_table).where(metrics_table.c.id == mid).values(**values))
        self._changed()
        return self.metric(mid)

    def archive_metric(self, mid: int, archived: bool) -> Metric:
        self.metric(mid)
        with self.engine.begin() as conn:
            conn.execute(update(metrics_table).where(metrics_table.c.id == mid).values(archived=archived, updated_at=time.time()))
        self._changed()
        return self.metric(mid)

    def expand_metrics(self, spec: QuerySpec) -> tuple[QuerySpec, dict[str, dict[str, Any] | None]]:
        """The spec with saved metrics replaced by their aggregation (+ the metric format per output name)."""
        if not any(a.fn == "metric" for a in spec.aggregations):
            return spec, {}
        data = spec.model_dump(mode="json", by_alias=True, exclude_unset=True)
        formats: dict[str, dict[str, Any] | None] = {}
        out = []
        for a in data.get("aggregations", []):
            if a.get("fn") != "metric":
                out.append(a)
                continue
            m = self._data().metrics.get(int(a.get("metric") or 0))
            if m is None or m.connection != spec.connection:
                raise ContentError(f"Metric {a.get('metric')} does not exist (any more) for this database")
            alias = a.get("alias") or m.slug
            entry = dict(m.definition)
            ref = entry.get("ref")
            if ref and "." not in ref:
                entry["ref"] = f"{m.table}.{ref}"
            out.append({**entry, "alias": alias})
            formats[alias] = m.format
        data["aggregations"] = out
        return QuerySpec.model_validate(data), formats
