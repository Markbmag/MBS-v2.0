"""Profiles and X-rays (roadmap M7).

    POST /api/profile/table         {"connection", "table"}     -> a query task; result.analysis = the profile
    POST /api/query/tasks/{id}/profile                          -> the profile of a finished result (rows on screen)
    POST /api/xray                  {"connection", "table"} | {"question_id"}
                                                                -> a query task; result.analysis = {"profile", "title", "cards"}

A table profile reads at most NCODE_PROFILE_SAMPLE_ROWS rows (the cost guard) plus one
COUNT(*); both are ordinary read-only queries with the usual timeout, limits and audit.
"""

from __future__ import annotations

import time
from typing import Any, Callable

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, model_validator

from ..appdb import User
from ..config import Settings
from ..content.store import ContentError, ContentStore
from ..db import ConnectionRegistry, describe_error
from ..federation.workspace import Workspace, available
from ..query.routes import MAX_WAIT_MS, QueryService
from ..query.runner import QueryRunner, QueryTask, ResultCache, fetch_statement
from ..query.spec import QuerySpec
from ..results import ResultEnvelope, ResultStats
from ..schema_graph import normalize_type
from .profile import load_typed, profile_table
from .xray import build_cards


class TableIn(BaseModel):
    connection: str = Field(min_length=1, max_length=64)
    table: str = Field(min_length=1, max_length=255)
    wait_ms: int = Field(default=2000, ge=0, le=MAX_WAIT_MS)
    refresh: bool = False


class XrayIn(BaseModel):
    connection: str | None = Field(default=None, max_length=64)
    table: str | None = Field(default=None, max_length=255)
    question_id: int | None = None
    wait_ms: int = Field(default=2000, ge=0, le=MAX_WAIT_MS)
    refresh: bool = False

    @model_validator(mode="after")
    def _one(self) -> "XrayIn":
        if (self.question_id is None) == (self.connection is None or self.table is None):
            raise ValueError("give connection and table, or question_id")
        return self


BASE_KEYS = ("version", "connection", "source", "joins", "expressions", "filters")


def register_analysis_routes(
    app: FastAPI,
    *,
    registry: ConnectionRegistry,
    settings: Settings,
    runner: QueryRunner,
    queries: QueryService,
    content: ContentStore,
    semantic: Any,
    current_user: Callable[..., User],
    require_connection: Callable[[str, User], None],
) -> None:
    router = APIRouter(tags=["analysis"])

    def need_duckdb() -> None:
        if not available():
            raise HTTPException(status_code=503, detail="Profiles and X-rays need the duckdb package: pip install -r requirements.txt")

    def table_columns(connection: str, table: str) -> tuple[str, list[dict[str, Any]]]:
        try:
            schema = registry.get_schema(connection)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Could not read the database structure: {describe_error(exc)}") from exc
        real = table if table in schema else next((t for t in schema if t.lower() == table.lower()), None)
        if real is None:
            raise HTTPException(status_code=404, detail=f"Unknown table {table!r}")
        return real, schema[real]

    def candidates(base: dict[str, Any]) -> list[dict[str, Any]]:
        """Every column of the tables named in the question: {"ref", "name", "table", "column"}."""
        out = []
        entries = [(base["source"].get("alias") or base["source"]["table"], base["source"]["table"])]
        entries += [(j.get("alias") or j["table"], j["table"]) for j in base.get("joins") or []]
        several = len(entries) > 1
        for alias, table in entries:
            real, cols = table_columns(base["connection"], table)
            for c in cols:
                if normalize_type(c["type"]) == "binary":
                    continue
                out.append({"ref": f"{alias}.{c['name']}", "name": f"{alias}_{c['name']}" if several else c["name"],
                            "table": real, "column": c["name"]})
        return out

    def start_analysis(user: User, base: dict[str, Any], kind: str, title: str, xray: bool, wait_ms: int, refresh: bool):
        need_duckdb()
        require_connection(base["connection"], user)
        cols = candidates(base)
        if not cols:
            raise HTTPException(status_code=400, detail="The table has no columns to profile")
        sample = settings.profile_sample_rows
        sample_spec = QuerySpec.model_validate({
            **base, "fields": [{"ref": c["ref"], "alias": c["name"]} for c in cols], "limit": sample,
        })
        count_spec = QuerySpec.model_validate({**base, "aggregations": [{"fn": "count", "alias": "n"}]})
        engine, compiled, _sql = queries.compile_for(sample_spec, user=user, default_limit=sample, max_limit=sample)
        _e, counted, _csql = queries.compile_for(count_spec, user=user)
        types = [c.type for c in compiled.columns]
        fields = semantic.fields(base["connection"]) if semantic is not None else {}
        meta = {c["name"]: fields.get(c["table"], {}).get(c["column"], {}) for c in cols}

        def work(task: QueryTask) -> ResultEnvelope:
            started = time.perf_counter()
            names, rows, _cut = fetch_statement(engine, task, compiled.limited(1), compiled.limit)
            try:
                _n, total_rows, _t = fetch_statement(engine, task, counted.limited(), 1)
                total = int(total_rows[0][0]) if total_rows else None
            except Exception:
                total = None  # the count is a nicety; a timeout there must not lose the profile
            ws = Workspace(memory_mb=settings.federation_memory_mb, threads=settings.federation_threads)
            try:
                load_typed(ws, "t", names, types, rows)
                ws.lock()
                profile = profile_table(ws, "t", total_rows=total, meta=meta)
            finally:
                ws.close()
            analysis: dict[str, Any] = {"kind": kind, "title": title, "profile": profile}
            if xray:
                by_name = {c["name"]: c for c in cols}
                profiled = [{**col, "ref": by_name[col["name"]]["ref"]} for col in profile["columns"] if col["name"] in by_name]
                analysis.update(build_cards({k: v for k, v in base.items() if k in BASE_KEYS}, profiled, title))
            return ResultEnvelope(
                columns=[], rows=[], stats=ResultStats(duration_ms=round((time.perf_counter() - started) * 1000), row_count=0),
                analysis=analysis,
            )

        return queries.start_task(
            user, kind="xray" if xray else "profile", connection=base["connection"], sql=f"{'x-ray' if xray else 'profile'}: {title}",
            options={"base": base, "sample": sample}, work=work,
            cache_key=ResultCache.key("analysis", xray, base, sample), wait_ms=wait_ms, refresh=refresh,
        )

    @router.post("/api/profile/table")
    def profile_a_table(body: TableIn, user: User = Depends(current_user)):
        require_connection(body.connection, user)
        real, _cols = table_columns(body.connection, body.table)
        base = {"version": 1, "connection": body.connection, "source": {"table": real}}
        return start_analysis(user, base, "table", real, False, body.wait_ms, body.refresh)

    @router.post("/api/xray")
    def xray(body: XrayIn, user: User = Depends(current_user)):
        if body.question_id is not None:
            try:
                q = content.get_question(user, body.question_id)
            except ContentError as exc:
                raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
            if q.kind != "builder":
                raise HTTPException(status_code=400, detail="X-ray works on tables and questions built without SQL")
            base = {k: v for k, v in q.spec.items() if k in BASE_KEYS}
            if any(c.get("param") for c in _conditions(base.get("filters"))):
                base.pop("filters", None)  # filters waiting for a parameter value: X-ray the whole table
            return start_analysis(user, base, "question", q.name, True, body.wait_ms, body.refresh)
        require_connection(body.connection or "", user)
        real, _cols = table_columns(body.connection or "", body.table or "")
        base = {"version": 1, "connection": body.connection, "source": {"table": real}}
        return start_analysis(user, base, "table", real, True, body.wait_ms, body.refresh)

    @router.post("/api/query/tasks/{task_id}/profile")
    async def profile_result(task_id: str, user: User = Depends(current_user)):
        need_duckdb()
        task = runner.get(task_id)
        if task is None or not (user.is_admin or task.owner == user.username):
            raise HTTPException(status_code=404, detail="Unknown or expired query")
        if task.status != "completed" or task.result is None:
            raise HTTPException(status_code=409, detail="The query has no finished result to profile")
        env = task.result

        def compute() -> dict[str, Any]:
            ws = Workspace(memory_mb=settings.federation_memory_mb, threads=settings.federation_threads)
            try:
                names = load_typed(ws, "t", [c.name for c in env.columns], [c.type for c in env.columns], env.rows)
                ws.lock()
                meta = {n: {"display_name": c.display_name, "description": c.description, "semantic_type": c.semantic_type}
                        for n, c in zip(names, env.columns)}
                out = profile_table(ws, "t", meta=meta)
                out["truncated"] = env.stats.truncated
                return out
            finally:
                ws.close()

        return await run_in_threadpool(compute)

    app.include_router(router)


def _conditions(group: Any) -> list[dict[str, Any]]:
    if not isinstance(group, dict):
        return []
    out = []
    for r in group.get("rules") or []:
        out += _conditions(r) if "rules" in r else [r]
    return out
