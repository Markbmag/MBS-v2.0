"""Query API (roadmap M1).

    POST   /api/query                 {"spec": QuerySpec, "wait_ms": 2000}   run a question built without SQL
    POST   /api/query/compile         {"spec": QuerySpec}                    the SQL it would run ("View SQL")
    POST   /api/query/sql             {"connection", "sql", "params", "limit", "wait_ms"}   SQL mode
    POST   /api/query/sql/check       {"connection", "sql"}                  guard verdict, {{params}}, tables
    GET    /api/query/tasks/{id}?wait_ms=0
    DELETE /api/query/tasks/{id}      cancel
    GET    /api/query/tasks/{id}/export.xlsx   the finished result as an Excel workbook

A run answers with {"task_id", "status", "result", "error", "elapsed_ms"}. When the
query finishes within wait_ms the result (a result envelope) is right there;
otherwise poll the task. Problems with the question itself (unknown column, SQL
that is not read-only ...) are 400 errors with a readable `detail`.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..appdb import AppDB, User
from ..config import Settings
from ..db import ConnectionRegistry, describe_error
from ..rowsec import RowSecurityError
from ..schema_graph import relationships
from .compiler import CompileError, compile_spec, render_sql
from ..content.store import ContentError
from ..results import ResultEnvelope
from .runner import QueryRunner, QueryTask, ResultCache, run_sql, run_statement
from .spec import QuerySpec, Transform
from .sqlguard import GuardError, check_sql
from .transforms import TransformError, apply_transforms
from .xlsx import xlsx_stream

MAX_WAIT_MS = 15_000
slow_log = logging.getLogger("ncode.slow")
ParamValue = str | int | float | bool | None


class RunSpecRequest(BaseModel):
    spec: QuerySpec
    wait_ms: int = Field(default=2000, ge=0, le=MAX_WAIT_MS)
    refresh: bool = Field(default=False, description="ignore cached results")


class CompileRequest(BaseModel):
    spec: QuerySpec


class RunSqlRequest(BaseModel):
    connection: str = Field(min_length=1, max_length=64)
    sql: str = Field(min_length=1, max_length=100_000)
    params: dict[str, ParamValue] = Field(default_factory=dict, max_length=100)
    limit: int | None = Field(default=None, ge=1)
    wait_ms: int = Field(default=2000, ge=0, le=MAX_WAIT_MS)
    refresh: bool = False
    transforms: list[Transform] = Field(default_factory=list, max_length=20)


def finish_envelope(env: ResultEnvelope, meta: list[dict[str, Any] | None], transforms: list[Transform]) -> ResultEnvelope:
    """Column metadata from the data model, then the transforms (running totals ...)."""
    for col, m in zip(env.columns, meta):
        if m:
            for key in ("display_name", "description", "semantic_type", "format"):
                if m.get(key) is not None:
                    setattr(col, key, m[key])
    if transforms:
        try:
            apply_transforms(env, transforms)
        except TransformError as exc:
            raise ValueError(str(exc)) from None
    return env


@dataclass(frozen=True)
class QueryService:
    """What saved questions (app/content/routes.py) use to run through the same checks."""

    start_spec: Callable[..., dict[str, Any]]
    start_sql: Callable[..., dict[str, Any]]
    guard: Callable[..., Any]
    compile_for: Callable[..., Any]
    start_task: Callable[..., dict[str, Any]]  # any other work (multi-source questions) with the same limits and audit


def column_meta(compiled: Any, fields: dict[str, Any], metric_formats: dict[str, Any]) -> list[dict[str, Any] | None]:
    """Per output column: what the data model says about the column it comes from."""
    out: list[dict[str, Any] | None] = []
    for col in compiled.columns:
        if metric_formats.get(col.name):
            out.append({"format": metric_formats[col.name]})
            continue  # a metric without its own format keeps its column's (a sum of euros is euros)
        if col.source is None:
            out.append(None)
            continue
        info = fields.get(col.source[0], {}).get(col.source[1])
        if not info:
            out.append(None)
            continue
        same = col.name.lower() == col.source[1].lower()  # the column itself, not e.g. its sum
        out.append({
            "display_name": info.get("display_name") if same else None,
            "description": info.get("description") if same else None,
            "semantic_type": info.get("semantic_type"),
            "format": info.get("format"),
        })
    return out


class CheckSqlRequest(BaseModel):
    connection: str = Field(min_length=1, max_length=64)
    sql: str = Field(min_length=1, max_length=100_000)


def register_query_routes(
    app: FastAPI,
    *,
    registry: ConnectionRegistry,
    settings: Settings,
    app_db: AppDB,
    runner: QueryRunner,
    current_user: Callable[..., User],
    require_connection: Callable[[str, User], None],
    semantic: Any = None,
    rowsec: Any = None,
) -> "QueryService":
    router = APIRouter(prefix="/api/query", tags=["query"])

    def check_capacity(user: User) -> None:
        if runner.running_count(user.username) >= settings.max_concurrent_queries:
            raise HTTPException(
                status_code=429,
                detail=f"You already have {settings.max_concurrent_queries} queries running. "
                "Wait for one to finish or cancel it.",
            )

    def compile_for(spec: QuerySpec, *, user: User, default_limit: int | None = None, max_limit: int | None = None):
        key = spec.connection
        try:
            columns = registry.get_schema(key)
            _primary, foreign = registry.get_keys(key)
        except Exception as exc:
            detail = describe_error(exc, registry.get_config(key).engine)
            raise HTTPException(status_code=502, detail=f"Could not read the database structure: {detail}") from exc
        engine = registry.get_engine(key)
        fields: dict[str, Any] = {}
        metric_formats: dict[str, Any] = {}
        if semantic is not None:
            try:
                spec, metric_formats = semantic.expand_metrics(spec)
            except ContentError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            fields = semantic.fields(key)
            manual = semantic.foreign_keys(key)
            if manual:
                foreign = {t: list(foreign.get(t, [])) + manual.get(t, []) for t in set(foreign) | set(manual)}
        if rowsec is not None:  # row-level security (M9): the user's row conditions become part of the question
            try:
                spec = rowsec.apply_to_spec(spec, user, columns)
            except RowSecurityError as exc:
                raise HTTPException(status_code=403, detail=str(exc)) from exc
        try:
            compiled = compile_spec(
                spec,
                dialect=engine.dialect,
                tables=columns,
                relationships=relationships(foreign, set(columns)),
                db_schema=registry.get_config(key).schema,
                default_limit=default_limit or settings.query_default_rows,
                max_limit=max_limit or settings.query_max_rows,
                fields=fields,
            )
        except CompileError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        compiled.meta = column_meta(compiled, fields, metric_formats)
        return engine, compiled, render_sql(compiled.limited(), engine.dialect)

    def audit_start(user: User, action: str, connection: str, sql: str, options: dict[str, Any]) -> int:
        return app_db.audit(
            user.username, action, connection=connection, phrase=sql[:200],
            options=json.dumps(options, default=str)[:20_000], status="running",
        )

    def audit_finish(audit_id: int) -> Callable[[QueryTask], None]:
        def finish(task: QueryTask) -> None:
            rows = task.result.stats.row_count if task.result is not None else 0
            duration = (task.finished_at or time.time()) - task.created_at
            app_db.audit_finish(audit_id, task.status, rows, 1 if task.status == "error" else 0, duration)
            m = getattr(app.state, "metrics", None)
            if m is not None:
                m.counter("ncode_queries_total", "Queries run, by kind and outcome", kind=task.kind, status=task.status)
                m.observe("ncode_query_seconds", "Query duration", duration, kind=task.kind)
            if duration >= settings.slow_query_sec:  # also in Admin → Usage → Slow queries
                slow_log.warning("slow query (%.1fs, %s, %s on %s): %s", duration, task.status, task.owner, task.connection,
                                 (task.result.sql if task.result is not None and task.result.sql else "")[:300])

        return finish

    def respond(task: QueryTask, wait_ms: int) -> dict[str, Any]:
        if wait_ms and not task.is_final:
            task.done.wait(wait_ms / 1000)
        return task.snapshot()

    def task_for(task_id: str, user: User) -> QueryTask:
        task = runner.get(task_id)
        if task is None or not (user.is_admin or task.owner == user.username):
            raise HTTPException(status_code=404, detail="Unknown or expired query")
        return task

    # ------------------------------------------------------------------ builder questions
    def start_spec(user: User, spec: QuerySpec, wait_ms: int, refresh: bool, extra: dict[str, Any] | None = None):
        require_connection(spec.connection, user)
        check_capacity(user)
        engine, compiled, sql = compile_for(spec, user=user)
        statement = compiled.limited(1)  # one extra row tells us the result was cut off
        types = [c.type for c in compiled.columns]
        task = QueryTask(owner=user.username, connection=spec.connection, kind="builder")
        options = {"spec": spec.model_dump(mode="json", by_alias=True), **(extra or {})}
        audit_id = audit_start(user, "query", spec.connection, sql, options)
        meta, transforms = compiled.meta, spec.transforms
        runner.submit(
            task,
            lambda t: finish_envelope(run_statement(engine, t, statement, compiled.limit, types, sql), meta, transforms),
            # the SQL is part of the key: a changed metric or data-model setting changes it
            cache_key=ResultCache.key("builder", spec.model_dump(mode="json"), compiled.limit, sql),
            read_cache=not refresh,
            on_finish=audit_finish(audit_id),
        )
        return respond(task, wait_ms)

    @router.post("")
    def run_question(body: RunSpecRequest, user: User = Depends(current_user)):
        return start_spec(user, body.spec, body.wait_ms, body.refresh)

    @router.post("/compile")
    def compile_question(body: CompileRequest, user: User = Depends(current_user)):
        require_connection(body.spec.connection, user)
        _engine, compiled, sql = compile_for(body.spec, user=user)
        return {
            "sql": sql,
            "columns": [{"name": c.name, "type": c.type} for c in compiled.columns],
            "limit": compiled.limit,
        }

    # ------------------------------------------------------------------ SQL mode
    def guard(connection: str, sql: str, user: User):
        engine = registry.get_engine(connection)
        if rowsec is not None:
            try:
                rowsec.check_sql(user, connection)
            except RowSecurityError as exc:
                raise HTTPException(status_code=403, detail=str(exc)) from exc
        try:
            return engine, check_sql(sql, engine.dialect.name, allow_system=user.is_admin)
        except GuardError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/sql/check")
    def check(body: CheckSqlRequest, user: User = Depends(current_user)):
        require_connection(body.connection, user)
        try:
            _engine, checked = guard(body.connection, body.sql, user)
        except HTTPException as exc:
            return {"ok": False, "error": exc.detail, "params": [], "tables": []}
        return {"ok": True, "error": None, "params": checked.params, "tables": checked.tables}

    def start_sql(
        user: User,
        connection: str,
        sql: str,
        params: dict[str, Any],
        limit: int | None,
        wait_ms: int,
        refresh: bool,
        extra: dict[str, Any] | None = None,
        transforms: list[Transform] | None = None,
    ):
        require_connection(connection, user)
        check_capacity(user)
        engine, checked = guard(connection, sql, user)
        transforms = transforms or []
        missing = [p for p in checked.params if p not in params]
        if missing:
            raise HTTPException(status_code=400, detail=f"Give a value for {', '.join('{{' + m + '}}' for m in missing)}")
        limit = min(limit or settings.query_default_rows, settings.query_max_rows)
        params = {k: v for k, v in params.items() if k in checked.params}
        task = QueryTask(owner=user.username, connection=connection, kind="sql")
        audit_id = audit_start(user, "sql", connection, sql, {"params": params, "limit": limit, **(extra or {})})
        runner.submit(
            task,
            lambda t: finish_envelope(run_sql(engine, t, sql, params, limit), [], transforms),
            cache_key=ResultCache.key("sql", connection, sql, params, limit, [t.model_dump() for t in transforms]),
            read_cache=not refresh,
            on_finish=audit_finish(audit_id),
        )
        return respond(task, wait_ms)

    def start_task(
        user: User,
        *,
        kind: str,
        connection: str,
        sql: str,
        options: dict[str, Any],
        work: Callable[[QueryTask], Any],
        cache_key: str | None,
        wait_ms: int,
        refresh: bool,
    ) -> dict[str, Any]:
        check_capacity(user)
        task = QueryTask(owner=user.username, connection=connection, kind=kind)
        audit_id = audit_start(user, kind, connection, sql, options)
        runner.submit(task, work, cache_key=cache_key, read_cache=not refresh, on_finish=audit_finish(audit_id))
        return respond(task, wait_ms)

    @router.post("/sql")
    def run_sql_query(body: RunSqlRequest, user: User = Depends(current_user)):
        return start_sql(user, body.connection, body.sql, body.params, body.limit, body.wait_ms, body.refresh, transforms=body.transforms)

    # ------------------------------------------------------------------ tasks
    @router.get("/tasks/{task_id}")
    def get_task(task_id: str, wait_ms: int = Query(0, ge=0, le=MAX_WAIT_MS), user: User = Depends(current_user)):
        return respond(task_for(task_id, user), wait_ms)

    @router.delete("/tasks/{task_id}")
    def cancel_task(task_id: str, user: User = Depends(current_user)):
        task = task_for(task_id, user)
        task.cancel()
        return {"status": "cancelling" if not task.is_final else task.status}

    @router.get("/tasks/{task_id}/export.xlsx")
    def export_xlsx(task_id: str, user: User = Depends(current_user)):
        """The rows the user already sees, as .xlsx (re-running the query is not needed)."""
        task = task_for(task_id, user)
        if task.status != "completed" or task.result is None:
            raise HTTPException(status_code=409, detail="The query has no finished result to export")
        app_db.audit(user.username, "export_xlsx", connection=task.connection, phrase=(task.result.sql or "")[:200], status="ok")
        return StreamingResponse(
            xlsx_stream(task.result),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="result.xlsx"'},
        )

    app.include_router(router)
    return QueryService(
        start_spec=start_spec, start_sql=start_sql, guard=guard, compile_for=compile_for, start_task=start_task
    )
