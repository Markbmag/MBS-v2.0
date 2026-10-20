"""Semantic layer API (roadmap M7). Reading needs access to the connection; changing needs an admin.

    GET    /api/semantic/{connection}/fields                     column metadata of the connection
    PUT    /api/semantic/{connection}/fields/{table}/{column}    {"display_name", "description", "semantic_type",
                                                                  "format", "hidden", "parse_as_date"}
    GET    /api/semantic/{connection}/relationships              relationships added by hand
    POST   /api/semantic/{connection}/relationships              {"from_table", "from_columns", "to_table", "to_columns"}
    DELETE /api/semantic/{connection}/relationships/{id}
    GET    /api/metrics?connection=&archived=                    metrics of the connections you may use
    POST   /api/metrics                                          {"name", "description", "connection", "table", "definition", "format"}
    PUT    /api/metrics/{id}    PATCH /api/metrics/{id} {"archived": true}

A metric's definition is an aggregation of its table, e.g.
{"fn": "sum", "ref": "orders.total", "where": {"op": "and", "rules": [{"ref": "orders.status", "op": "=", "value": "paid"}]}};
questions use it as {"fn": "metric", "metric": <id>}.
"""

from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel

from ..appdb import User
from ..content.store import ContentError
from ..db import ConnectionRegistry, describe_error
from ..query.routes import QueryService
from ..query.spec import QuerySpec
from .store import FieldIn, MetricIn, RelationshipIn, SemanticStore


class ArchiveIn(BaseModel):
    archived: bool


def register_semantic_routes(
    app: FastAPI,
    *,
    semantic: SemanticStore,
    registry: ConnectionRegistry,
    queries: QueryService,
    current_user: Callable[..., User],
    require_admin: Callable[..., User],
    require_connection: Callable[[str, User], None],
) -> None:
    router = APIRouter(tags=["semantic"])

    def columns_of(connection: str) -> dict[str, list[str]]:
        try:
            schema = registry.get_schema(connection)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Could not read the database structure: {describe_error(exc)}") from exc
        return {t: [c["name"] for c in cols] for t, cols in schema.items()}

    def check_column(connection: str, table: str, column: str) -> None:
        cols = columns_of(connection)
        if table not in cols:
            raise HTTPException(status_code=404, detail=f"Unknown table {table!r}")
        if column not in cols[table]:
            raise HTTPException(status_code=404, detail=f"{table!r} has no column {column!r}")

    # ------------------------------------------------------------------ columns
    @router.get("/api/semantic/{connection}/fields")
    def get_fields(connection: str, user: User = Depends(current_user)):
        require_connection(connection, user)
        return {"fields": semantic.fields(connection)}

    @router.put("/api/semantic/{connection}/fields/{table}/{column}")
    def put_field(connection: str, table: str, column: str, body: FieldIn, admin: User = Depends(require_admin)):
        require_connection(connection, admin)
        check_column(connection, table, column)
        return {"field": semantic.set_field(admin, connection, table, column, body)}

    # ------------------------------------------------------------------ relationships
    @router.get("/api/semantic/{connection}/relationships")
    def get_relationships(connection: str, user: User = Depends(current_user)):
        require_connection(connection, user)
        return {"relationships": semantic.relationships(connection)}

    @router.post("/api/semantic/{connection}/relationships")
    def add_relationship(connection: str, body: RelationshipIn, admin: User = Depends(require_admin)):
        require_connection(connection, admin)
        for c in body.from_columns:
            check_column(connection, body.from_table, c)
        for c in body.to_columns:
            check_column(connection, body.to_table, c)
        return semantic.add_relationship(admin, connection, body)

    @router.delete("/api/semantic/{connection}/relationships/{rid}")
    def delete_relationship(connection: str, rid: int, admin: User = Depends(require_admin)):
        require_connection(connection, admin)
        try:
            semantic.delete_relationship(connection, rid)
        except ContentError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
        return {"deleted": rid}

    # ------------------------------------------------------------------ metrics
    def visible(user: User) -> set[str]:
        return {k for k in registry.configs if user.can_use(k)}

    @router.get("/api/metrics")
    def list_metrics(connection: str | None = Query(None, max_length=64), archived: bool = False, user: User = Depends(current_user)):
        allowed = visible(user)
        if connection is not None:
            allowed &= {connection}
        if archived and not user.is_admin:
            allowed = set()
        return {"metrics": [m.to_json() for m in semantic.metrics(allowed, archived=archived)]}

    def check_metric(admin: User, body: MetricIn) -> None:
        require_connection(body.connection, admin)
        if body.table not in columns_of(body.connection):
            raise HTTPException(status_code=404, detail=f"Unknown table {body.table!r}")
        spec = QuerySpec.model_validate({
            "connection": body.connection, "source": {"table": body.table},
            "aggregations": [{**body.definition.model_dump(mode="json", by_alias=True, exclude_none=True), "alias": "value"}],
        })
        queries.compile_for(spec, user=admin)  # unknown columns, sum of text ... are refused here

    @router.post("/api/metrics")
    def create_metric(body: MetricIn, admin: User = Depends(require_admin)):
        check_metric(admin, body)
        return semantic.save_metric(admin, body).to_json()

    @router.put("/api/metrics/{mid}")
    def update_metric(mid: int, body: MetricIn, admin: User = Depends(require_admin)):
        check_metric(admin, body)
        try:
            return semantic.save_metric(admin, body, mid).to_json()
        except ContentError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc

    @router.patch("/api/metrics/{mid}")
    def archive_metric(mid: int, body: ArchiveIn, admin: User = Depends(require_admin)):
        try:
            return semantic.archive_metric(mid, body.archived).to_json()
        except ContentError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc

    app.include_router(router)


def schema_extras(semantic: SemanticStore, connection: str) -> dict[str, Any]:
    return {"fields": semantic.fields(connection), "manual": semantic.foreign_keys(connection)}
