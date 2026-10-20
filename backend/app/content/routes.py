"""Library API (roadmap M4).

    GET    /api/collections                         visible collections (flat tree) + the caller's own
    POST   /api/collections                         {"name", "description", "parent_id"}
    GET    /api/collections/{id}                    the collection, its path, sub-collections and questions
    PATCH  /api/collections/{id}                    rename / move ("parent_id") / archive ("archived")
    DELETE /api/collections/{id}                    an archived collection, with everything in it
    GET    /api/collections/{id}/permissions        grants (own + inherited)
    PUT    /api/collections/{id}/permissions        {"grants": [{"user": "bob", "level": "view"}, {"role": "all", "level": "edit"}]}

    GET    /api/questions?q=&favorites=&collection= search what the caller can see
    POST   /api/questions                           save a question
    GET    /api/questions/{id}
    PATCH  /api/questions/{id}                      save changes / move / archive / restore
    DELETE /api/questions/{id}                      an archived question
    POST   /api/questions/{id}/duplicate            {"collection_id", "name"}
    POST   /api/questions/{id}/run                  {"params": {...}, "wait_ms", "refresh"} -> a query task
    PUT    /api/questions/{id}/favorite             star; DELETE to unstar

    GET    /api/library/archive                     archived collections and questions
    GET    /api/library/people                      user names and roles to share with

A question is {"kind": "builder", "spec": QuerySpec}, {"kind": "sql", "spec": {"sql", "limit"}}
or {"kind": "federated", "spec": FederatedSpec} (several sources combined, app/federation).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Literal

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field, ValidationError

from ..appdb import AppDB, User
from ..config import Settings
from ..federation.routes import register_federation_routes
from ..query.routes import MAX_WAIT_MS, QueryService
from ..query.spec import QuerySpec, Transform
from .dashboard_routes import dashboard_summary, register_dashboard_routes
from .dashboards import DashboardStore, add_conditions
from .params import (
    ParameterDef, bind_spec, check_builder_params, check_sql_params, resolve, sample_values, sql_bind_values,
)
from .store import ROLES, ContentError, ContentStore, Question

MAX_VIZ_BYTES = 100_000


@dataclass(frozen=True)
class ContentServices:
    store: ContentStore
    dashboards: DashboardStore
    run_saved: Callable[..., dict[str, Any]]   # (user, question, params, conditions, wait_ms, refresh, extra)
    start_card: Callable[..., dict[str, Any]]  # (user, dashboard, card key, filter values, wait_ms, refresh, extra)


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    parent_id: int | None = None


class CollectionPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    parent_id: int | None = None
    archived: bool | None = None


class GrantIn(BaseModel):
    user: str | None = Field(default=None, max_length=64)
    group: str | None = Field(default=None, max_length=64)
    role: str | None = Field(default=None, max_length=16)
    level: Literal["view", "edit"]


class GrantsIn(BaseModel):
    grants: list[GrantIn] = Field(default_factory=list, max_length=500)


class QuestionIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    collection_id: int | None = Field(default=None, description="default: the caller's own collection")
    kind: Literal["builder", "sql", "federated"]
    connection: str | None = Field(default=None, max_length=64, description="sql questions; builder specs carry it")
    spec: dict[str, Any]
    viz: dict[str, Any] | None = None
    parameters: list[ParameterDef] = Field(default_factory=list, max_length=50)


class QuestionPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    collection_id: int | None = None
    kind: Literal["builder", "sql", "federated"] | None = None
    connection: str | None = Field(default=None, max_length=64)
    spec: dict[str, Any] | None = None
    viz: dict[str, Any] | None = None
    parameters: list[ParameterDef] | None = Field(default=None, max_length=50)
    archived: bool | None = None
    model: bool | None = None  # usable as a source in Combine / New question (M7)


class DuplicateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    collection_id: int | None = None


class RunIn(BaseModel):
    params: dict[str, Any] = Field(default_factory=dict, max_length=100)
    wait_ms: int = Field(default=2000, ge=0, le=MAX_WAIT_MS)
    refresh: bool = False


class SqlSpec(BaseModel):
    sql: str = Field(min_length=1, max_length=100_000)
    limit: int | None = Field(default=None, ge=1)
    transforms: list[Transform] = Field(default_factory=list, max_length=20)


def question_json(q: Question) -> dict[str, Any]:
    return {
        "id": q.id,
        "name": q.name,
        "description": q.description,
        "collection_id": q.collection_id,
        "collection": q.extra.get("collection"),
        "path": q.extra.get("path"),
        "connection": q.connection,
        "kind": q.kind,
        "spec": q.spec,
        "viz": q.viz,
        "parameters": q.parameters,
        "owner": q.owner,
        "archived": q.archived,
        "favorite": q.favorite,
        "access": q.access,
        "imported": q.import_key is not None,
        "model": q.model,
        "created_at": q.created_at,
        "updated_at": q.updated_at,
        "updated_by": q.updated_by,
    }


def summary_json(q: Question) -> dict[str, Any]:
    out = question_json(q)
    for heavy in ("spec", "viz", "parameters", "path"):
        out.pop(heavy)
    return out


def register_content_routes(
    app: FastAPI,
    *,
    app_db: AppDB,
    settings: Settings,
    queries: QueryService,
    current_user: Callable[..., User],
    require_connection: Callable[[str, User], None],
) -> ContentStore:
    store = ContentStore(app_db.engine)
    dashboard_store = DashboardStore(store)
    router = APIRouter(tags=["library"])

    def fail(exc: ContentError) -> HTTPException:
        return HTTPException(status_code=exc.status, detail=str(exc))

    federation, dataset_store = register_federation_routes(
        app, content=store, app_db=app_db, settings=settings, queries=queries, current_user=current_user,
        require_connection=require_connection, fail=fail,
    )

    # ------------------------------------------------------------------ validation
    def validate(user: User, kind: str, connection: str | None, spec: dict[str, Any], defs: list[ParameterDef]):
        """(connection, clean spec, clean parameter list) - or a 400 explaining what is wrong."""
        if kind == "federated":
            try:
                parsed_fed, clean_fed = federation.check(user, spec, defs)
            except ContentError as exc:
                raise fail(exc) from exc
            return "", parsed_fed.model_dump(mode="json", by_alias=True, exclude_unset=True), clean_fed
        if kind == "builder":
            try:
                parsed = QuerySpec.model_validate(spec)
            except ValidationError as exc:
                raise HTTPException(status_code=400, detail=f"Invalid question: {exc.errors()[0]['msg']}") from exc
            if connection and connection != parsed.connection:
                raise HTTPException(status_code=400, detail="The question's spec belongs to another connection")
            require_connection(parsed.connection, user)
            try:
                clean_defs = check_builder_params(parsed, defs)
            except ContentError as exc:
                raise fail(exc) from exc
            try:
                # unknown columns etc. are refused now, not at the next run (sample values stand in for parameters)
                queries.compile_for(bind_spec(parsed, sample_values(clean_defs)), user=user)
            except HTTPException as exc:
                if exc.status_code != 502:  # database unreachable: save anyway
                    raise
            return parsed.connection, parsed.model_dump(mode="json", by_alias=True, exclude_unset=True), clean_defs
        try:
            parsed_sql = SqlSpec.model_validate(spec)
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid SQL question: {exc.errors()[0]['msg']}") from exc
        if not connection:
            raise HTTPException(status_code=400, detail="A SQL question needs a connection")
        require_connection(connection, user)
        _engine, checked = queries.guard(connection, parsed_sql.sql, user)
        clean_sql = parsed_sql.model_dump(mode="json", exclude_none=True)
        if not clean_sql.get("transforms"):
            clean_sql.pop("transforms", None)
        return connection, clean_sql, check_sql_params(checked.params, defs)

    def check_viz(viz: dict[str, Any] | None) -> None:
        if viz is not None and len(json.dumps(viz)) > MAX_VIZ_BYTES:
            raise HTTPException(status_code=400, detail="The chart settings are too large")

    # ------------------------------------------------------------------ collections
    @router.get("/api/collections")
    def list_collections(user: User = Depends(current_user)):
        personal = store.personal_collection(user)
        return {"personal_id": personal.id, "collections": store.visible_collections(user)}

    @router.post("/api/collections")
    def create_collection(body: CollectionCreate, user: User = Depends(current_user)):
        try:
            col = store.create_collection(user, body.name, body.description, body.parent_id)
            return store.describe(col, store.snapshot(), user)
        except ContentError as exc:
            raise fail(exc) from exc

    @router.get("/api/collections/{cid}")
    def get_collection(cid: int, user: User = Depends(current_user)):
        try:
            col, snap = store.get_collection(user, cid)
            children = [
                store.describe(c, snap, user)
                for c in sorted(snap.collections.values(), key=lambda c: c.name.lower())
                if c.parent_id == cid and not c.archived and snap.access(user, c.id) is not None
            ]
            questions = store.list_questions(user, collection_id=cid)
            dashboards = dashboard_store.list(user, collection_id=cid)
            datasets = dataset_store.list(user, collection_id=cid)
        except ContentError as exc:
            raise fail(exc) from exc
        return {
            "collection": store.describe(col, snap, user),
            "path": store.breadcrumbs(user, snap, cid),
            "collections": children,
            "questions": [summary_json(q) for q in questions],
            "dashboards": [dashboard_summary(d) for d in dashboards],
            "datasets": [d.summary() for d in datasets],
        }

    @router.patch("/api/collections/{cid}")
    def patch_collection(cid: int, body: CollectionPatch, user: User = Depends(current_user)):
        changes = body.model_dump(exclude_unset=True)
        try:
            col = store.update_collection(user, cid, **changes)
            return store.describe(col, store.snapshot(), user)
        except ContentError as exc:
            raise fail(exc) from exc

    @router.delete("/api/collections/{cid}")
    def delete_collection(cid: int, user: User = Depends(current_user)):
        try:
            removed = store.delete_collection(user, cid)
        except ContentError as exc:
            raise fail(exc) from exc
        app_db.audit(user.username, "collection_delete", phrase=f"collection {cid} ({removed} questions)", status="ok")
        return {"deleted": cid, "questions_deleted": removed}

    @router.get("/api/collections/{cid}/permissions")
    def get_permissions(cid: int, user: User = Depends(current_user)):
        try:
            return {"grants": store.grants(user, cid)}
        except ContentError as exc:
            raise fail(exc) from exc

    @router.put("/api/collections/{cid}/permissions")
    def put_permissions(cid: int, body: GrantsIn, user: User = Depends(current_user)):
        try:
            grants = store.set_grants(user, cid, [g.model_dump() for g in body.grants])
        except ContentError as exc:
            raise fail(exc) from exc
        summary = ", ".join(
            f"{g['user'] or ('group:' + g['group'] if g['group'] else 'role:' + g['role'])}={g['level']}"
            for g in grants if not g["inherited_from"]
        )
        app_db.audit(user.username, "permissions", phrase=f"collection {cid}: {summary or 'none'}", status="ok")
        return {"grants": grants}

    # ------------------------------------------------------------------ questions
    @router.get("/api/questions")
    def list_questions(
        q: str | None = Query(None, max_length=200),
        favorites: bool = False,
        collection: int | None = None,
        models: bool = False,
        limit: int = Query(200, ge=1, le=1000),
        user: User = Depends(current_user),
    ):
        try:
            found = store.list_questions(user, collection_id=collection, text=q, favorites=favorites, limit=1000 if models else limit)
        except ContentError as exc:
            raise fail(exc) from exc
        if models:
            found = [x for x in found if x.model][:limit]
        return {"questions": [summary_json(x) for x in found]}

    @router.post("/api/questions")
    def create_question(body: QuestionIn, user: User = Depends(current_user)):
        connection, spec, defs = validate(user, body.kind, body.connection, body.spec, body.parameters)
        check_viz(body.viz)
        collection_id = body.collection_id if body.collection_id is not None else store.personal_collection(user).id
        try:
            q = store.create_question(
                user, name=body.name, description=body.description, collection_id=collection_id,
                connection=connection, kind=body.kind, spec=spec, viz=body.viz,
                parameters=[d.model_dump() for d in defs],
            )
        except ContentError as exc:
            raise fail(exc) from exc
        return question_json(q)

    @router.get("/api/questions/{qid}")
    def get_question(qid: int, user: User = Depends(current_user)):
        try:
            return question_json(store.get_question(user, qid))
        except ContentError as exc:
            raise fail(exc) from exc

    @router.patch("/api/questions/{qid}")
    def patch_question(qid: int, body: QuestionPatch, user: User = Depends(current_user)):
        changes = body.model_dump(exclude_unset=True)
        try:
            current = store.get_question(user, qid, "edit")
        except ContentError as exc:
            raise fail(exc) from exc
        if {"spec", "kind", "connection", "parameters"} & changes.keys():
            kind = changes.get("kind") or current.kind
            spec = changes.get("spec") if changes.get("spec") is not None else current.spec
            defs = body.parameters if body.parameters is not None else [ParameterDef(**p) for p in current.parameters]
            connection = changes.get("connection") or (current.connection if kind == "sql" else None)
            connection, spec, defs = validate(user, kind, connection, spec, defs)
            changes.update(kind=kind, connection=connection, spec=spec, parameters=[d.model_dump() for d in defs])
        if "viz" in changes:
            check_viz(changes["viz"])
        try:
            return question_json(store.update_question(user, qid, **changes))
        except ContentError as exc:
            raise fail(exc) from exc

    @router.delete("/api/questions/{qid}")
    def delete_question(qid: int, user: User = Depends(current_user)):
        try:
            store.delete_question(user, qid)
        except ContentError as exc:
            raise fail(exc) from exc
        app_db.audit(user.username, "question_delete", phrase=f"question {qid}", status="ok")
        return {"deleted": qid}

    @router.post("/api/questions/{qid}/duplicate")
    def duplicate_question(qid: int, body: DuplicateIn, user: User = Depends(current_user)):
        try:
            src = store.get_question(user, qid)
            target = body.collection_id
            if target is None:
                target = src.collection_id if src.access == "edit" else store.personal_collection(user).id
            q = store.create_question(
                user, name=body.name or f"{src.name} (copy)"[:200], description=src.description,
                collection_id=target, connection=src.connection, kind=src.kind, spec=src.spec,
                viz=src.viz, parameters=src.parameters,
            )
        except ContentError as exc:
            raise fail(exc) from exc
        return question_json(q)

    @router.put("/api/questions/{qid}/favorite")
    def star(qid: int, user: User = Depends(current_user)):
        try:
            store.set_favorite(user, qid, True)
        except ContentError as exc:
            raise fail(exc) from exc
        return {"favorite": True}

    @router.delete("/api/questions/{qid}/favorite")
    def unstar(qid: int, user: User = Depends(current_user)):
        try:
            store.set_favorite(user, qid, False)
        except ContentError as exc:
            raise fail(exc) from exc
        return {"favorite": False}

    @router.post("/api/questions/{qid}/run")
    def run_question(qid: int, body: RunIn, user: User = Depends(current_user)):
        try:
            q = store.get_question(user, qid)
        except ContentError as exc:
            raise fail(exc) from exc
        return run_saved(user, q, body.params, [], body.wait_ms, body.refresh, {"question_id": q.id})

    def run_saved(
        user: User,
        q: Question,
        params: dict[str, Any],
        conditions: list[dict[str, Any]],
        wait_ms: int,
        refresh: bool,
        extra: dict[str, Any],
    ) -> dict[str, Any]:
        """Run a saved question with parameter values (and, for builder questions, extra conditions)."""
        defs = [ParameterDef(**p) for p in q.parameters]
        if q.kind == "federated":  # each source checks its own access
            try:
                return federation.start(user, q.spec, defs, params, conditions, wait_ms, refresh, extra)
            except ContentError as exc:
                raise fail(exc) from exc
        require_connection(q.connection, user)
        try:
            if q.kind == "builder":
                values = resolve(defs, params)
                spec = add_conditions(bind_spec(QuerySpec.model_validate(q.spec), values), conditions)
                return queries.start_spec(user, spec, wait_ms, refresh, extra)
            if q.kind == "sql":
                sql_spec = SqlSpec.model_validate(q.spec)
                engine, checked = queries.guard(q.connection, sql_spec.sql, user)
                defs = check_sql_params(checked.params, defs)
                values = sql_bind_values(resolve(defs, params), defs, engine.dialect.name)
                return queries.start_sql(
                    user, q.connection, sql_spec.sql, values, sql_spec.limit, wait_ms, refresh, extra, transforms=sql_spec.transforms
                )
        except ContentError as exc:
            raise fail(exc) from exc
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=f"The saved question is not valid any more: {exc.errors()[0]['msg']}") from exc
        raise HTTPException(status_code=409, detail=f"Unknown question kind {q.kind!r}")

    # ------------------------------------------------------------------ archive, people
    @router.get("/api/library/archive")
    def archive(user: User = Depends(current_user)):
        questions = [
            q for q in store.list_questions(user, archived=True, limit=1000) if q.access == "edit"
        ]
        return {
            "collections": [c for c in store.archived_collections(user) if c["can_manage"]],
            "questions": [summary_json(q) for q in questions],
            "dashboards": [dashboard_summary(d) for d in dashboard_store.list(user, archived=True, limit=1000) if d.access == "edit"],
            "datasets": [d.summary() for d in dataset_store.list(user, archived=True, limit=1000) if d.access == "edit"],
        }

    @router.get("/api/library/people")
    def people(user: User = Depends(current_user)):
        return {
            "users": [u.username for u in app_db.list_users() if u.is_active and u.id != user.id],
            "groups": [g["name"] for g in app_db.list_groups()],
            "roles": list(ROLES),
        }

    app.include_router(router)
    start_card = register_dashboard_routes(
        app, store=dashboard_store, app_db=app_db, current_user=current_user, run_saved=run_saved, fail=fail
    )
    # subscriptions and public links (M8) run saved content through the same checks
    app.state.content = ContentServices(store=store, dashboards=dashboard_store, run_saved=run_saved, start_card=start_card)
    return store
