"""Dashboard API (roadmap M5).

    GET    /api/dashboards?q=&favorites=&collection=   dashboards the caller can see
    POST   /api/dashboards                             {"name", "description", "collection_id"}
    GET    /api/dashboards/{id}                        definition + the questions on it (as far as the caller may see them)
    PUT    /api/dashboards/{id}                        {"filters", "tabs", "cards", "settings"}: save the whole layout
    PATCH  /api/dashboards/{id}                        rename / move ("collection_id") / archive ("archived")
    DELETE /api/dashboards/{id}                        an archived dashboard
    POST   /api/dashboards/{id}/duplicate
    PUT    /api/dashboards/{id}/favorite               (DELETE to remove the star)
    POST   /api/dashboards/{id}/cards/{key}/run        {"filters": {"period": ["2026-01-01", "2026-03-31"]}, "wait_ms", "refresh"}

A card run applies the dashboard's filter values to the card's question (parameters or
columns, see dashboards.py) and answers like any query run: a task to follow.
"""

from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field, ValidationError

from ..appdb import AppDB, User
from ..query.routes import MAX_WAIT_MS
from .dashboards import (
    Card, Dashboard, DashboardFilter, DashboardStore, Definition, apply_filters, filter_values, param_shapes,
)
from .store import ContentError, Question


class DashboardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    collection_id: int | None = Field(default=None, description="default: the caller's own collection")


class DashboardPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    collection_id: int | None = None
    archived: bool | None = None


class DuplicateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    collection_id: int | None = None


class CardRunIn(BaseModel):
    filters: dict[str, Any] = Field(default_factory=dict, max_length=50)
    wait_ms: int = Field(default=2000, ge=0, le=MAX_WAIT_MS)
    refresh: bool = False


def dashboard_summary(d: Dashboard) -> dict[str, Any]:
    return {
        "id": d.id,
        "name": d.name,
        "description": d.description,
        "collection_id": d.collection_id,
        "collection": d.extra.get("collection"),
        "owner": d.owner,
        "archived": d.archived,
        "favorite": d.favorite,
        "access": d.access,
        "imported": d.imported,
        "created_at": d.created_at,
        "updated_at": d.updated_at,
        "updated_by": d.updated_by,
    }


def _question_info(q: Question | None, qid: int | None) -> dict[str, Any]:
    if qid is None:
        return {"state": "deleted"}
    if q is None:
        return {"state": "hidden"}  # exists or not: the caller may not know
    return {
        "state": "archived" if q.archived else "ok",
        "id": q.id,
        "name": q.name,
        "kind": q.kind,
        "connection": q.connection,
        "parameters": q.parameters,
        "viz": q.viz,
        "tables": _builder_tables(q),
        "fields": _federated_fields(q),
    }


def _federated_fields(q: Question) -> list[dict[str, Any]]:
    """Columns of a multi-source question's combined rows (as of its last save): filters can be mapped to them."""
    if q.kind != "federated" or not isinstance(q.spec, dict):
        return []
    return [c for c in q.spec.get("result_columns") or [] if isinstance(c, dict) and c.get("name")]


def _builder_tables(q: Question) -> list[str]:
    """Tables (or join aliases) of a builder question: a filter can be mapped to their columns."""
    if q.kind != "builder":
        return []
    spec = q.spec
    tables = [spec.get("source", {}).get("alias") or spec.get("source", {}).get("table")]
    tables += [j.get("alias") or j.get("table") for j in spec.get("joins", [])]
    return [t for t in tables if t]


def dashboard_json(d: Dashboard, questions: dict[int, Question | None]) -> dict[str, Any]:
    out = dashboard_summary(d)
    out.update(path=d.extra.get("path"), filters=d.filters, tabs=d.tabs, settings=d.settings, cards=[])
    for card in d.cards:
        item = dict(card)
        if card["kind"] == "question":
            item["question"] = _question_info(questions.get(card["question_id"]) if card["question_id"] else None, card["question_id"])
        out["cards"].append(item)
    return out


def register_dashboard_routes(
    app: FastAPI,
    *,
    store: DashboardStore,
    app_db: AppDB,
    current_user: Callable[..., User],
    run_saved: Callable[..., dict[str, Any]],
    fail: Callable[[ContentError], HTTPException],
) -> Callable[..., dict[str, Any]]:
    router = APIRouter(tags=["dashboards"])

    def full(user: User, d: Dashboard) -> dict[str, Any]:
        return dashboard_json(d, store.card_questions(user, d))

    @router.get("/api/dashboards")
    def list_dashboards(
        q: str | None = Query(None, max_length=200),
        favorites: bool = False,
        collection: int | None = None,
        limit: int = Query(200, ge=1, le=1000),
        user: User = Depends(current_user),
    ):
        try:
            found = store.list(user, collection_id=collection, text=q, favorites=favorites, limit=limit)
        except ContentError as exc:
            raise fail(exc) from exc
        return {"dashboards": [dashboard_summary(d) for d in found]}

    @router.post("/api/dashboards")
    def create(body: DashboardCreate, user: User = Depends(current_user)):
        target = body.collection_id if body.collection_id is not None else store.content.personal_collection(user).id
        try:
            return full(user, store.create(user, name=body.name, description=body.description, collection_id=target))
        except ContentError as exc:
            raise fail(exc) from exc

    @router.get("/api/dashboards/{did}")
    def get(did: int, user: User = Depends(current_user)):
        try:
            return full(user, store.get(user, did))
        except ContentError as exc:
            raise fail(exc) from exc

    @router.put("/api/dashboards/{did}")
    def save(did: int, body: dict[str, Any], user: User = Depends(current_user)):
        try:
            definition = Definition.model_validate(body)
        except ValidationError as exc:
            err = exc.errors()[0]
            where = ".".join(str(p) for p in err.get("loc", ()))
            raise HTTPException(status_code=400, detail=f"Invalid dashboard: {err['msg']}" + (f" ({where})" if where else "")) from exc
        try:
            return full(user, store.save_definition(user, did, definition))
        except ContentError as exc:
            raise fail(exc) from exc

    @router.patch("/api/dashboards/{did}")
    def patch(did: int, body: DashboardPatch, user: User = Depends(current_user)):
        try:
            return full(user, store.update(user, did, **body.model_dump(exclude_unset=True)))
        except ContentError as exc:
            raise fail(exc) from exc

    @router.delete("/api/dashboards/{did}")
    def remove(did: int, user: User = Depends(current_user)):
        try:
            store.delete(user, did)
        except ContentError as exc:
            raise fail(exc) from exc
        app_db.audit(user.username, "dashboard_delete", phrase=f"dashboard {did}", status="ok")
        return {"deleted": did}

    @router.post("/api/dashboards/{did}/duplicate")
    def duplicate(did: int, body: DuplicateIn, user: User = Depends(current_user)):
        try:
            return full(user, store.duplicate(user, did, body.name, body.collection_id))
        except ContentError as exc:
            raise fail(exc) from exc

    @router.put("/api/dashboards/{did}/favorite")
    def star(did: int, user: User = Depends(current_user)):
        try:
            store.set_favorite(user, did, True)
        except ContentError as exc:
            raise fail(exc) from exc
        return {"favorite": True}

    @router.delete("/api/dashboards/{did}/favorite")
    def unstar(did: int, user: User = Depends(current_user)):
        try:
            store.set_favorite(user, did, False)
        except ContentError as exc:
            raise fail(exc) from exc
        return {"favorite": False}

    def start_card(
        user: User, d: Dashboard, key: str, given: dict[str, Any], wait_ms: int, refresh: bool, extra: dict[str, Any],
    ) -> dict[str, Any]:
        """Run one question card of a dashboard the user may see, with the dashboard's filter values.
        Also used by subscriptions and public links (M8), always with the permissions of `user`."""
        try:
            raw = next((c for c in d.cards if c["key"] == key), None)
            if raw is None or raw["kind"] != "question":
                raise ContentError("No such question card on this dashboard", 404)
            if raw["question_id"] is None:
                raise ContentError("The question on this card was deleted", 410)
            try:
                q = store.content.get_question(user, raw["question_id"])
            except ContentError:
                raise ContentError("This question is not shared with you", 403) from None
            card = Card.model_validate(raw)
            filters = [DashboardFilter.model_validate(f) for f in d.filters]
            values = filter_values(filters, given)
            params, conditions = apply_filters(card, filters, values, q.kind, param_shapes(q.kind, q.spec))
        except ContentError as exc:
            raise fail(exc) from exc
        return run_saved(user, q, params, conditions, wait_ms, refresh, {"question_id": q.id, "dashboard_id": d.id, **extra})

    @router.post("/api/dashboards/{did}/cards/{key}/run")
    def run_card(did: int, key: str, body: CardRunIn, user: User = Depends(current_user)):
        try:
            d = store.get(user, did)
        except ContentError as exc:
            raise fail(exc) from exc
        return start_card(user, d, key, body.filters, body.wait_ms, body.refresh, {})

    app.include_router(router)
    return start_card
