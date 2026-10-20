"""Multi-source questions and uploaded files (roadmap M6).

    POST   /api/federated/run            {"spec": FederatedSpec, "parameters": [...], "params": {...}, "wait_ms", "refresh"}
    POST   /api/federated/check          {"spec", "parameters"}  -> the parameters the spec uses, or a 400

    GET    /api/datasets?q=&collection=  uploaded files the caller can see
    POST   /api/datasets?filename=&name=&collection_id=&delimiter=&header=&encoding=&sheet=
                                         body = the file itself (application/octet-stream)
    GET    /api/datasets/{id}
    PATCH  /api/datasets/{id}            rename / describe / move ("collection_id") / archive ("archived")
    DELETE /api/datasets/{id}            an archived dataset (its file is removed)

A run answers like every other query: a task (app/query/routes.py). Its result
envelope carries "federation": the rows read per source, the statistics of every
join (unmatched keys ...) and the columns of the combined rows.

Who may run what: each database source needs access to its connection, a saved
question source needs view access to the question (and its connection), a dataset
source view access to the dataset's collection. A multi-source question never
widens access: viewing it does not grant any of these.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, ValidationError

from ..appdb import AppDB, User
from ..config import Settings
from ..content.params import (
    PARAM_OPS, ParameterDef, bind_spec, check_sql_params, resolve, sample_values, spec_params, sql_bind_values,
)
from ..content.store import ContentError, ContentStore
from ..query.routes import MAX_WAIT_MS, QueryService
from ..query.runner import ResultCache, fetch_sql, fetch_statement
from ..query.spec import QuerySpec
from ..query.sqlguard import find_params
from .datasets import DatasetStore, IngestError, IngestOptions, format_for, ingest, remove_files
from .engine import FederatedRun, FederationError, Plan, PreparedSource, check_combine_sql
from .spec import FederatedSpec, Source
from .workspace import FederationUnavailable, available

UPLOAD_CHUNK = 1 << 20


class FederatedRunIn(BaseModel):
    spec: dict[str, Any]
    parameters: list[ParameterDef] = Field(default_factory=list, max_length=50)
    params: dict[str, Any] = Field(default_factory=dict, max_length=100)
    wait_ms: int = Field(default=2000, ge=0, le=MAX_WAIT_MS)
    refresh: bool = False


class FederatedCheckIn(BaseModel):
    spec: dict[str, Any]
    parameters: list[ParameterDef] = Field(default_factory=list, max_length=50)


class DatasetPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    collection_id: int | None = None
    archived: bool | None = None


def parse_spec(raw: dict[str, Any]) -> FederatedSpec:
    try:
        return FederatedSpec.model_validate(raw)
    except ValidationError as exc:
        err = exc.errors()[0]
        where = ".".join(str(p) for p in err.get("loc", ()))
        raise ContentError(f"Invalid multi-source question: {err['msg']}" + (f" ({where})" if where else "")) from None


@dataclass
class FederationService:
    """What the library (saved questions, dashboards) uses to check and run multi-source questions."""

    check: Callable[..., tuple[FederatedSpec, list[ParameterDef]]]
    start: Callable[..., dict[str, Any]]


def register_federation_routes(
    app: FastAPI,
    *,
    content: ContentStore,
    app_db: AppDB,
    settings: Settings,
    queries: QueryService,
    current_user: Callable[..., User],
    require_connection: Callable[[str, User], None],
    fail: Callable[[ContentError], HTTPException],
) -> tuple[FederationService, DatasetStore]:
    directory = Path(app_db.path).parent / "datasets"
    datasets = DatasetStore(content, directory)
    content.on_files_deleted = lambda files: remove_files(directory, files)
    router = APIRouter(tags=["federation"])
    cap = settings.federation_source_rows

    def need_duckdb() -> None:
        if not available():
            raise HTTPException(status_code=503, detail=str(FederationUnavailable(
                "Multi-source questions and uploads need the duckdb package: pip install -r requirements.txt"
            )))

    # ------------------------------------------------------------------ parameters
    def used_params(spec: FederatedSpec) -> tuple[list[tuple[str, str]], list[str]]:
        """(builder-style uses (name, operator), {{name}} uses) in the spec itself."""
        builder: list[tuple[str, str]] = []
        sql: list[str] = []
        for s in spec.sources:
            if s.type == "builder" and s.spec is not None:
                builder += spec_params(s.spec)
            elif s.type == "sql" and s.sql:
                sql += find_params(s.sql)
        if spec.mode == "sql" and spec.sql:
            sql += find_params(spec.sql)
        builder += spec_params(spec.post_spec(None))
        return builder, list(dict.fromkeys(sql))

    def check_params(
        spec: FederatedSpec, defs: list[ParameterDef], forwarded: set[str]
    ) -> list[ParameterDef]:
        """Every parameter used is declared (SQL ones are declared as text when missing);
        declarations that a source question takes are kept and passed on to it."""
        builder, sql = used_params(spec)
        names = {d.name for d in defs}
        for name, op in builder:
            if name not in names:
                raise ContentError(f"Filter parameter {name!r} is not declared")
            if op not in PARAM_OPS:
                raise ContentError(f"The '{op}' filter cannot take its value from a parameter")
        keep = {n for n, _ in builder} | set(sql) | forwarded
        out = [d for d in defs if d.name in keep]
        out += [d for d in check_sql_params(sql, defs) if d.name not in names]
        return out

    # ------------------------------------------------------------------ preparing sources
    def prepare(
        user: User, spec: FederatedSpec, defs: list[ParameterDef], given: dict[str, Any], *, check_only: bool = False
    ) -> tuple[list[PreparedSource], dict[str, Any], set[str]]:
        """Sources ready to run (permissions checked), the parameter values, the names source questions take."""
        values = sample_values(defs) if check_only else resolve(defs, given)
        by_name = {d.name: d for d in defs}
        out: list[PreparedSource] = []
        forwarded: set[str] = set()
        for s in spec.sources:
            try:
                out.append(prepare_source(user, s, values, by_name, forwarded, check_only))
            except ContentError as exc:
                raise ContentError(f"{s.label or s.alias}: {exc}", exc.status) from None
            except HTTPException as exc:
                if check_only and exc.status_code == 502:  # database unreachable: save anyway
                    out.append(PreparedSource(s.alias, s.label or s.alias, s.type))
                    continue
                raise HTTPException(exc.status_code, f"{s.label or s.alias}: {exc.detail}") from None
        return out, values, forwarded

    def source_limit(s: Source) -> int:
        return min(s.limit or cap, cap)

    def builder_source(user: User, alias: str, label: str, kind: str, spec: QuerySpec, limit: int, part: Any) -> PreparedSource:
        require_connection(spec.connection, user)
        data = spec.model_dump(mode="json", by_alias=True, exclude_unset=True)
        data["limit"] = min(spec.limit or limit, limit)
        engine, compiled, _sql = queries.compile_for(QuerySpec.model_validate(data), user=user, default_limit=limit, max_limit=cap)
        statement = compiled.limited(1)
        return PreparedSource(
            alias, label, kind, spec.connection, limit=compiled.limit, cache_part=part,
            fetch=lambda t: fetch_statement(engine, t, statement, compiled.limit),
        )

    def sql_source(
        user: User, alias: str, label: str, kind: str, connection: str, sql: str, defs: list[ParameterDef],
        values: dict[str, Any], limit: int, part: Any, check_only: bool,
    ) -> PreparedSource:
        require_connection(connection, user)
        engine, checked = queries.guard(connection, sql, user)
        bound: dict[str, Any] = {}
        if not check_only:
            used = check_sql_params(checked.params, defs)
            bound = sql_bind_values({d.name: values.get(d.name) for d in used}, used, engine.dialect.name)
        return PreparedSource(
            alias, label, kind, connection, limit=limit, cache_part=[part, bound],
            fetch=lambda t: fetch_sql(engine, t, sql, bound, limit),
        )

    def prepare_source(
        user: User, s: Source, values: dict[str, Any], by_name: dict[str, ParameterDef], forwarded: set[str],
        check_only: bool,
    ) -> PreparedSource:
        limit = source_limit(s)
        if s.type == "dataset":
            d = datasets.get(user, s.dataset_id)  # type: ignore[arg-type]
            if d.archived:
                raise ContentError("the uploaded file is archived")
            return PreparedSource(s.alias, s.label or d.name, "dataset", path=datasets.path(d), cache_part=d.file)
        if s.type == "builder":
            spec = bind_spec(s.spec, values)  # type: ignore[arg-type]  # (sample values when checking: it must compile)
            label = s.label or f"{spec.connection}: {spec.source.table}"
            return builder_source(user, s.alias, label, "builder", spec, limit, spec.model_dump(mode="json"))
        if s.type == "sql":
            defs = [by_name.get(n) or ParameterDef(name=n) for n in find_params(s.sql or "")]
            return sql_source(user, s.alias, s.label or f"SQL on {s.connection}", "sql", s.connection or "", s.sql or "",
                              defs, values, limit, [s.connection, s.sql], check_only)
        # a saved question; its parameters take the values of parameters with the same name
        q = content.get_question(user, s.question_id)  # type: ignore[arg-type]
        if q.kind == "federated":
            raise ContentError("a multi-source question cannot be a source of another one")
        qdefs = [ParameterDef(**p) for p in q.parameters]
        forwarded.update(d.name for d in qdefs)
        label = s.label or q.name
        given = {d.name: values[d.name] for d in qdefs if values.get(d.name) is not None and not check_only}
        qvalues = sample_values(qdefs) if check_only else resolve(qdefs, given)
        part = [q.id, q.updated_at]
        if q.kind == "builder":
            spec = bind_spec(QuerySpec.model_validate(q.spec), qvalues)
            return builder_source(user, s.alias, label, "question", spec, limit, part + [spec.model_dump(mode="json")])
        sql = str(q.spec.get("sql") or "")
        return sql_source(user, s.alias, label, "question", q.connection, sql, qdefs, qvalues, limit, part, check_only)

    # ------------------------------------------------------------------ check / start
    def check(user: User, raw: dict[str, Any], defs: list[ParameterDef]) -> tuple[FederatedSpec, list[ParameterDef]]:
        """Validate a multi-source question before it is saved; returns the clean spec and parameters."""
        need_duckdb()
        spec = parse_spec(raw)
        if spec.mode == "sql":
            try:
                check_combine_sql(spec.sql or "", [s.alias for s in spec.sources])
            except FederationError as exc:
                raise ContentError(str(exc)) from None
        _sources, _values, forwarded = prepare(user, spec, defs, {}, check_only=True)
        clean = check_params(spec, defs, forwarded)
        return spec, clean

    def start(
        user: User,
        raw: dict[str, Any],
        defs: list[ParameterDef],
        given: dict[str, Any],
        conditions: list[dict[str, Any]],
        wait_ms: int,
        refresh: bool,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        need_duckdb()
        spec = parse_spec(raw)
        if spec.mode == "sql":
            try:
                check_combine_sql(spec.sql or "", [s.alias for s in spec.sources])
            except FederationError as exc:
                raise ContentError(str(exc)) from None
        sources, values, _forwarded = prepare(user, spec, defs, given)
        from ..content.dashboards import add_conditions  # dashboards imports the store, like this module

        post = add_conditions(bind_spec(spec.post_spec(spec.limit), values), conditions)
        combine_params = {n: values.get(n) for n in find_params(spec.sql or "")} if spec.mode == "sql" else {}
        missing = [n for n, v in combine_params.items() if v is None]
        if missing:
            raise ContentError(f"Give a value for {', '.join(missing)}")
        plan = Plan(spec=spec, sources=sources, post=post, sql_params=combine_params)
        work = FederatedRun(
            plan, memory_mb=settings.federation_memory_mb, threads=settings.federation_threads,
            default_rows=settings.query_default_rows, max_rows=settings.query_max_rows,
        )
        connections = sorted({s.connection for s in sources if s.connection})
        cache_key = ResultCache.key(
            "federated", spec.model_dump(mode="json"), [s.cache_part for s in sources], combine_params,
            post.model_dump(mode="json"), cap, settings.query_max_rows,
        )
        summary = "; ".join(f"{s.alias}={s.label}" for s in sources)
        return queries.start_task(
            user, kind="federated", connection=",".join(connections)[:64], sql=f"multi-source: {summary}",
            options={"spec": spec.model_dump(mode="json", exclude_none=True), "params": values, **(extra or {})},
            work=work, cache_key=cache_key, wait_ms=wait_ms, refresh=refresh,
        )

    # ------------------------------------------------------------------ endpoints: runs
    @router.post("/api/federated/run")
    def run(body: FederatedRunIn, user: User = Depends(current_user)):
        try:
            return start(user, body.spec, body.parameters, body.params, [], body.wait_ms, body.refresh)
        except ContentError as exc:
            raise fail(exc) from exc

    @router.post("/api/federated/check")
    def check_endpoint(body: FederatedCheckIn, user: User = Depends(current_user)):
        try:
            spec, defs = check(user, body.spec, body.parameters)
        except ContentError as exc:
            raise fail(exc) from exc
        return {"spec": spec.model_dump(mode="json", exclude_none=True), "parameters": [d.model_dump() for d in defs]}

    # ------------------------------------------------------------------ endpoints: datasets
    @router.get("/api/datasets")
    def list_datasets(
        q: str | None = Query(None, max_length=200),
        collection: int | None = None,
        archived: bool = False,
        limit: int = Query(200, ge=1, le=1000),
        user: User = Depends(current_user),
    ):
        try:
            found = datasets.list(user, collection_id=collection, text=q, archived=archived, limit=limit)
        except ContentError as exc:
            raise fail(exc) from exc
        return {"datasets": [d.summary() for d in found if not archived or d.access == "edit"]}

    @router.get("/api/datasets/{did}")
    def get_dataset(did: int, user: User = Depends(current_user)):
        try:
            d = datasets.get(user, did)
        except ContentError as exc:
            raise fail(exc) from exc
        return {**d.summary(), "path": d.extra.get("path")}

    @router.post("/api/datasets")
    async def upload(
        request: Request,
        filename: str = Query(min_length=1, max_length=255),
        name: str | None = Query(None, max_length=200),
        description: str | None = Query(None, max_length=5000),
        collection_id: int | None = None,
        delimiter: str = Query("auto", max_length=16),
        header: bool = True,
        encoding: str = Query("utf-8", max_length=16),
        sheet: str | None = Query(None, max_length=120),
        user: User = Depends(current_user),
    ):
        if not settings.uploads_enabled:
            raise HTTPException(status_code=403, detail="Uploads are turned off on this server")
        need_duckdb()
        try:
            fmt = format_for(filename)
            target = collection_id if collection_id is not None else (await run_in_threadpool(content.personal_collection, user)).id
            await run_in_threadpool(datasets.check_target, user, target)
        except (ContentError, IngestError) as exc:
            raise HTTPException(status_code=getattr(exc, "status", 400), detail=str(exc)) from exc
        limit = settings.dataset_max_mb * 1024 * 1024
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > limit:
            raise HTTPException(status_code=413, detail=f"The file is larger than {settings.dataset_max_mb} MB")
        directory.mkdir(parents=True, exist_ok=True)
        tmp = directory / f"upload_{uuid.uuid4().hex}{Path(filename).suffix.lower()[:10]}"
        size = 0
        try:
            with open(tmp, "wb") as fh:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > limit:
                        raise HTTPException(status_code=413, detail=f"The file is larger than {settings.dataset_max_mb} MB")
                    await asyncio.to_thread(fh.write, chunk)
            if size == 0:
                raise HTTPException(status_code=400, detail="The file is empty")
            options = IngestOptions(delimiter=delimiter, header=header, encoding=encoding, sheet=sheet or None)
            try:
                result = await run_in_threadpool(
                    ingest, tmp, fmt, options, dest_dir=directory, max_rows=settings.dataset_max_rows,
                    memory_mb=settings.federation_memory_mb, threads=settings.federation_threads,
                )
            except IngestError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        label = (name or "").strip() or Path(filename).stem or "Uploaded file"
        try:
            d = await run_in_threadpool(
                lambda: datasets.create(
                    user, name=label, description=description, collection_id=target, ingested=result,
                    source_name=Path(filename).name, source_format=fmt,
                )
            )
        except ContentError as exc:
            remove_files(directory, [result.file])
            raise fail(exc) from exc
        app_db.audit(user.username, "dataset_upload", phrase=f"{Path(filename).name} -> dataset {d.id} ({d.row_count} rows)", status="ok")
        return d.summary()

    @router.patch("/api/datasets/{did}")
    def patch_dataset(did: int, body: DatasetPatch, user: User = Depends(current_user)):
        try:
            return datasets.update(user, did, **body.model_dump(exclude_unset=True)).summary()
        except ContentError as exc:
            raise fail(exc) from exc

    @router.delete("/api/datasets/{did}")
    def delete_dataset(did: int, user: User = Depends(current_user)):
        try:
            datasets.delete(user, did)
        except ContentError as exc:
            raise fail(exc) from exc
        app_db.audit(user.username, "dataset_delete", phrase=f"dataset {did}", status="ok")
        return {"deleted": did}

    app.include_router(router)
    return FederationService(check=check, start=start), datasets

