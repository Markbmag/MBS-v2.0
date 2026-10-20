"""Public links and signed embedding (roadmap M8).

Admin side (admins only):

    GET    /api/share?target_type=&target_id=     the item's public links and embedding settings
    POST   /api/share/public                      PublicLinkIn -> the link, with its URL
    PATCH  /api/share/public/{id}                 expiry, password, downloads
    DELETE /api/share/public/{id}                 revoke (the link stops working at once)
    PUT    /api/share/embed                       EmbedIn: allow embedding, what each filter does
    POST   /api/share/embed/token                 a 10-minute token to preview the embed
    GET    /api/admin/share                       every public link and embed
    PUT    /api/admin/settings/sharing            {"public_links", "embedding"}
    GET    /api/admin/settings/embedding-key      the key websites sign embedding tokens with
    POST   /api/admin/settings/embedding-key      a new key (old tokens stop working)

Visitor side (no sign-in; rate-limited per address):

    GET    /api/public/{token}                    what to show (dashboard layout or question)
    POST   /api/public/{token}/unlock             {"password"} -> {"access"}; send it as X-Ncode-Access
    POST   /api/public/{token}/run                a question: {"params"}
    POST   /api/public/{token}/cards/{key}/run    a dashboard card: {"filters"}
    GET    /api/public/{token}/tasks/{id}         follow a run; DELETE cancels
    GET    /api/public/{token}/tasks/{id}/export.csv | export.xlsx   only if the link allows downloads
    ... and the same under /api/embed/{jwt} (no password, no downloads)

Everything runs with the permissions of the admin who made the link or allowed the
embed (under a name like "public#3:mark" in the audit log, with its own query
slots). Visitors never get SQL, database names or database error messages.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field, replace
from typing import Any, Callable

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from ..appdb import AppDB, User
from ..automation.render import csv_bytes, safe_filename
from ..automation.settings import SettingsStore, SharingSettings
from ..config import Settings
from ..content.store import ContentError
from ..query.routes import MAX_WAIT_MS
from ..query.runner import QueryRunner, QueryTask
from ..query.xlsx import xlsx_stream
from ..security import LoginThrottle, verify_password
from .store import EmbedIn, Link, PublicLinkIn, PublicLinkPatch, ShareStore
from .tokens import AccessSigner, TokenError, new_embedding_key, sign_jwt, verify_jwt

logger = logging.getLogger("ncode.sharing")
GONE = "This link does not exist or no longer works"
CARD_FAILED = "This card could not be loaded right now"
PUBLIC_MAX_WAIT_MS = 2000  # visitors poll; long waits would hold server threads


class UnlockIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class PublicRunIn(BaseModel):
    params: dict[str, Any] = Field(default_factory=dict, max_length=50)
    filters: dict[str, Any] = Field(default_factory=dict, max_length=50)
    wait_ms: int = Field(default=2000, ge=0, le=PUBLIC_MAX_WAIT_MS)


class EmbedTokenIn(BaseModel):
    target_type: str = Field(pattern="^(dashboard|question)$")
    target_id: int
    params: dict[str, Any] = Field(default_factory=dict, max_length=50)


class RateLimiter:
    """At most `per_min` requests per minute per client address (sliding window)."""

    def __init__(self, per_min: int):
        self.per_min = per_min
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.time()
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] > 60:
                hits.popleft()
            if len(hits) >= self.per_min:
                return False
            hits.append(now)
            if len(self._hits) > 10_000:  # forget idle clients
                for k in [k for k, v in self._hits.items() if not v or now - v[-1] > 60][:5000]:
                    self._hits.pop(k, None)
            return True


@dataclass
class Shared:
    """A resolved public link or embed: what it shows and as whom it runs."""

    link: Link
    kind: str                         # public | embed
    runner_user: User                 # the creator's permissions, under its own name
    target_type: str
    target_id: int
    locked: dict[str, Any] = field(default_factory=dict)     # embed: values from the signed token
    editable: set[str] | None = None                          # embed: names the viewer may set; None = all

    def given(self, values: dict[str, Any]) -> dict[str, Any]:
        """Viewer values merged with the locked ones: the viewer cannot override a locked value."""
        allowed = {k: v for k, v in values.items() if self.editable is None or k in self.editable}
        return {**allowed, **self.locked}


def register_sharing_routes(
    app: FastAPI,
    *,
    app_db: AppDB,
    settings: Settings,
    settings_store: SettingsStore,
    runner: QueryRunner,
    current_user: Callable[..., User],
    require_admin: Callable[..., User],
) -> ShareStore:
    store = ShareStore(app_db.engine, app_db.cipher)
    signer = AccessSigner()
    limiter = RateLimiter(settings.public_rate_per_min)
    passwords = LoginThrottle(5, 300)
    tasks: dict[str, tuple[int, float]] = {}   # task id -> (link id, started): a link follows only its own runs
    tasks_lock = threading.Lock()
    content = lambda: app.state.content  # noqa: E731 - set by the library routes

    def fail(exc: ContentError) -> HTTPException:
        return HTTPException(status_code=exc.status, detail=str(exc))

    def sharing() -> SharingSettings:
        return settings_store.get("sharing")

    def target_name(user: User, target_type: str, target_id: int) -> str | None:
        try:
            if target_type == "dashboard":
                return content().dashboards.get(user, target_id).name
            return content().store.get_question(user, target_id).name
        except ContentError:
            return None

    def site() -> str:
        return settings_store.site_url()

    def link_json(link: Link, admin: User) -> dict[str, Any]:
        token = store.token_of(link) if link.kind == "public" else None
        return {
            "id": link.id,
            "kind": link.kind,
            "target_type": link.target_type,
            "target_id": link.target_id,
            "target_name": target_name(admin, link.target_type, link.target_id),
            "token": token,
            "path": f"/public/{token}" if token else None,
            "url": f"{site()}/public/{token}" if token and site() else None,
            "expires_at": link.expires_at,
            "has_password": bool(link.password_hash),
            "allow_download": link.allow_download,
            "params": link.settings.get("params", {}) if link.kind == "embed" else None,
            "created_by": link.created_by,
            "created_at": link.created_at,
            "revoked_at": link.revoked_at,
            "last_used_at": link.last_used_at,
            "views": link.views,
            "active": link.active,
        }

    # ------------------------------------------------------------------ admin
    admin_router = APIRouter(tags=["sharing"])

    def require_target(admin: User, target_type: str, target_id: int) -> None:
        if target_name(admin, target_type, target_id) is None:
            raise HTTPException(status_code=404, detail=f"No such {target_type}")

    @admin_router.get("/api/share")
    def item_links(
        target_type: str = Query(pattern="^(dashboard|question)$"), target_id: int = Query(), admin: User = Depends(require_admin),
    ):
        require_target(admin, target_type, target_id)
        links = store.list(target_type=target_type, target_id=target_id)
        embed = next((l for l in links if l.kind == "embed"), None)
        return {
            "public_links": [link_json(l, admin) for l in links if l.kind == "public" and l.revoked_at is None],
            "embed": link_json(embed, admin) if embed and embed.revoked_at is None else None,
            "settings": {**sharing().model_dump(), "embedding_key_set": settings_store.has_secret("sharing"), "site_url": site()},
        }

    @admin_router.post("/api/share/public")
    def create_public(body: PublicLinkIn, admin: User = Depends(require_admin)):
        if not sharing().public_links:
            raise HTTPException(status_code=409, detail="Public links are switched off: Admin → Sharing")
        require_target(admin, body.target_type, body.target_id)
        try:
            link, _token = store.create_public(body, admin.username)
        except ContentError as exc:
            raise fail(exc) from exc
        app_db.audit(admin.username, "share_public", phrase=f"{body.target_type} {body.target_id} (link {link.id})", status="ok")
        return link_json(link, admin)

    @admin_router.patch("/api/share/public/{lid}")
    def patch_public(lid: int, body: PublicLinkPatch, admin: User = Depends(require_admin)):
        try:
            return link_json(store.update_public(lid, body), admin)
        except ContentError as exc:
            raise fail(exc) from exc

    @admin_router.delete("/api/share/public/{lid}")
    def revoke_public(lid: int, admin: User = Depends(require_admin)):
        try:
            store.revoke(lid)
        except ContentError as exc:
            raise fail(exc) from exc
        app_db.audit(admin.username, "share_revoke", phrase=f"link {lid}", status="ok")
        return {"revoked": lid}

    @admin_router.put("/api/share/embed")
    def put_embed(body: EmbedIn, admin: User = Depends(require_admin)):
        require_target(admin, body.target_type, body.target_id)
        if body.enabled and not sharing().embedding:
            raise HTTPException(status_code=409, detail="Embedding is switched off: Admin → Sharing")
        link = store.set_embed(body, admin.username)
        app_db.audit(admin.username, "share_embed", phrase=f"{body.target_type} {body.target_id}: {'on' if body.enabled else 'off'}", status="ok")
        return {"embed": link_json(link, admin) if link and link.revoked_at is None else None}

    @admin_router.post("/api/share/embed/token")
    def preview_token(body: EmbedTokenIn, admin: User = Depends(require_admin)):
        key = settings_store.secret("sharing")
        if not key:
            raise HTTPException(status_code=409, detail="Create the embedding key first: Admin → Sharing")
        token = sign_jwt({"resource": {body.target_type: body.target_id}, "params": body.params, "exp": int(time.time()) + 600}, key)
        return {"token": token, "path": f"/embed/{token}"}

    @admin_router.get("/api/admin/share")
    def all_links(admin: User = Depends(require_admin)):
        return {"links": [link_json(l, admin) for l in store.list() if l.revoked_at is None]}

    @admin_router.put("/api/admin/settings/sharing")
    def put_sharing(body: SharingSettings, admin: User = Depends(require_admin)):
        settings_store.put("sharing", body, admin.username)
        app_db.audit(admin.username, "settings", phrase=f"sharing: public={body.public_links} embed={body.embedding}", status="ok")
        return {**body.model_dump(), "embedding_key_set": settings_store.has_secret("sharing")}

    @admin_router.get("/api/admin/settings/embedding-key")
    def get_key(_admin: User = Depends(require_admin)):
        return {"key": settings_store.secret("sharing")}

    @admin_router.post("/api/admin/settings/embedding-key")
    def new_key(admin: User = Depends(require_admin)):
        key = new_embedding_key()
        settings_store.put("sharing", sharing(), admin.username, secret=key)
        app_db.audit(admin.username, "settings", phrase="new embedding key", status="ok")
        return {"key": key}

    app.include_router(admin_router)

    # ------------------------------------------------------------------ visitors
    def client_key(request: Request) -> str:
        return request.client.host if request.client else "unknown"

    def limited(request: Request) -> None:
        if not limiter.allow(client_key(request)):
            raise HTTPException(status_code=429, detail="Too many requests, wait a minute", headers={"Retry-After": "60"})

    def owner_of(link: Link, label: str) -> User:
        owner = app_db.get_user_by_name(link.created_by or "")
        if owner is None or not owner.is_active:
            raise HTTPException(status_code=404, detail=GONE)
        # own name -> own query slots and a recognisable audit trail
        return replace(owner, username=f"{label}#{link.id}:{owner.username}"[:64])

    def resolve_public(token: str, access: str | None, *, unlocked: bool = True) -> Shared:
        link = store.by_token(token)
        if link is None or not link.active or not sharing().public_links:
            raise HTTPException(status_code=404, detail=GONE)
        if unlocked and link.password_hash and not signer.check(link.id, access, link.password_hash):
            raise HTTPException(status_code=403, detail="This link needs a password")
        return Shared(link=link, kind="public", runner_user=owner_of(link, "public"),
                      target_type=link.target_type, target_id=link.target_id)

    def resolve_embed(jwt: str) -> Shared:
        key = settings_store.secret("sharing")
        if not sharing().embedding or not key:
            raise HTTPException(status_code=404, detail="Embedding is switched off")
        try:
            payload = verify_jwt(jwt, key)
        except TokenError as exc:
            raise HTTPException(status_code=403 if "expired" in str(exc) else 400, detail=str(exc)) from exc  # never 401: that signs the viewer out of Ncode
        resource = payload.get("resource")
        if not isinstance(resource, dict) or len(resource) != 1:
            raise HTTPException(status_code=400, detail='The token\'s "resource" names one dashboard or question')
        ((target_type, target_id),) = resource.items()
        if target_type not in ("dashboard", "question") or not isinstance(target_id, int) or isinstance(target_id, bool):
            raise HTTPException(status_code=400, detail='The token\'s "resource" names one dashboard or question')
        link = store.embed_for(target_type, target_id)
        if link is None or not link.active:
            raise HTTPException(status_code=404, detail=f"This {target_type} may not be embedded")
        modes: dict[str, str] = link.settings.get("params", {})
        given = payload.get("params") or {}
        if not isinstance(given, dict):
            raise HTTPException(status_code=400, detail='The token\'s "params" is an object')
        locked = {k: given.get(k) for k, mode in modes.items() if mode == "locked"}
        missing = [k for k, v in locked.items() if v is None]
        if missing:
            raise HTTPException(status_code=400, detail=f"The token must set {', '.join(missing)}")
        return Shared(link=link, kind="embed", runner_user=owner_of(link, "embed"), target_type=target_type,
                      target_id=target_id, locked=locked, editable={k for k, m in modes.items() if m == "editable"})

    def visible_params(shared: Shared, names: list[str]) -> list[str]:
        return names if shared.editable is None else [n for n in names if n in shared.editable]

    def definition(shared: Shared) -> dict[str, Any]:
        user = shared.runner_user
        try:
            if shared.target_type == "dashboard":
                d = content().dashboards.get(user, shared.target_id)
                questions = content().dashboards.card_questions(user, d)
                shown = set(visible_params(shared, [f["id"] for f in d.filters]))
                cards = []
                for c in d.cards:
                    item = {k: c.get(k) for k in ("key", "kind", "tab", "layout", "viz", "title", "text")}
                    if c["kind"] == "question":
                        q = questions.get(c["question_id"]) if c.get("question_id") else None
                        item["question"] = (
                            {"state": "archived" if q.archived else "ok", "name": q.name, "viz": q.viz, "parameters": []}
                            if q else {"state": "hidden" if c.get("question_id") else "deleted"}
                        )
                        # which shown filters reach this card (for its "filtered" badge), without column names
                        item["mappings"] = {fid: {"param": "_"} for fid in (c.get("mappings") or {}) if fid in shown}
                    cards.append(item)
                return {
                    "type": "dashboard", "name": d.name, "description": d.description,
                    "filters": [f for f in d.filters if f["id"] in shown], "tabs": d.tabs, "settings": d.settings, "cards": cards,
                    "download": shared.kind == "public" and shared.link.allow_download,
                }
            q = content().store.get_question(user, shared.target_id)
            shown = set(visible_params(shared, [p["name"] for p in q.parameters]))
            return {
                "type": "question", "name": q.name, "description": q.description, "viz": q.viz,
                "parameters": [p for p in q.parameters if p["name"] in shown],
                "download": shared.kind == "public" and shared.link.allow_download,
            }
        except ContentError:
            raise HTTPException(status_code=404, detail=GONE) from None

    def clean(snap: dict[str, Any]) -> dict[str, Any]:
        """No SQL, no source details, no database error text."""
        out = dict(snap)
        result = out.get("result")
        if result:
            out["result"] = {k: v for k, v in result.items() if k not in ("sql", "federation", "analysis")}
        if out.get("status") == "error":
            if out.get("error"):
                logger.info("shared run failed: %s", out["error"])
            out["error"] = CARD_FAILED
        return out

    def remember(shared: Shared, snap: dict[str, Any]) -> dict[str, Any]:
        now = time.time()
        with tasks_lock:
            tasks[snap["task_id"]] = (shared.link.id, now)
            if len(tasks) > 20_000:
                for k in [k for k, (_l, t) in tasks.items() if now - t > 3600]:
                    tasks.pop(k, None)
        return clean(snap)

    def start(shared: Shared, run: Callable[[], dict[str, Any]]) -> dict[str, Any]:
        try:
            snap = run()
        except HTTPException as exc:
            # the details name parameters, columns or connections: visitors get a plain message
            logger.info("shared run refused (%s): %s", exc.status_code, exc.detail)
            if exc.status_code == 429:
                raise HTTPException(status_code=429, detail="Too many requests, wait a moment") from None
            if exc.status_code == 400:
                raise HTTPException(status_code=400, detail="This card cannot be shown with these filter values") from None
            if exc.status_code in (403, 404, 410):
                raise HTTPException(status_code=404, detail="This card is not available") from None
            raise HTTPException(status_code=503, detail=CARD_FAILED) from None
        store.touch(shared.link.id, view=False)
        return remember(shared, snap)

    def run_question(shared: Shared, body: PublicRunIn) -> dict[str, Any]:
        if shared.target_type != "question":
            raise HTTPException(status_code=404, detail="Not a question")
        user = shared.runner_user
        try:
            q = content().store.get_question(user, shared.target_id)
        except ContentError:
            raise HTTPException(status_code=404, detail=GONE) from None
        params = shared.given(body.params)
        return start(shared, lambda: content().run_saved(user, q, params, [], body.wait_ms, False,
                                                          {"question_id": q.id, "share_link": shared.link.id}))

    def run_card(shared: Shared, key: str, body: PublicRunIn) -> dict[str, Any]:
        if shared.target_type != "dashboard":
            raise HTTPException(status_code=404, detail="Not a dashboard")
        user = shared.runner_user
        try:
            d = content().dashboards.get(user, shared.target_id)
        except ContentError:
            raise HTTPException(status_code=404, detail=GONE) from None
        given = shared.given(body.filters)
        return start(shared, lambda: content().start_card(user, d, key, given, body.wait_ms, False, {"share_link": shared.link.id}))

    def own_task(shared: Shared, task_id: str) -> QueryTask:
        with tasks_lock:
            entry = tasks.get(task_id)
        task = runner.get(task_id)
        if entry is None or entry[0] != shared.link.id or task is None or task.owner != shared.runner_user.username:
            raise HTTPException(status_code=404, detail="Unknown or expired query")
        return task

    def follow(shared: Shared, task_id: str, wait_ms: int) -> dict[str, Any]:
        task = own_task(shared, task_id)
        if wait_ms and not task.is_final:
            task.done.wait(wait_ms / 1000)
        return clean(task.snapshot())

    def export(shared: Shared, task_id: str, fmt: str) -> Response:
        if shared.kind != "public" or not shared.link.allow_download:
            raise HTTPException(status_code=403, detail="Downloads are not allowed on this link")
        task = own_task(shared, task_id)
        if task.status != "completed" or task.result is None:
            raise HTTPException(status_code=409, detail="The query has no finished result to export")
        app_db.audit(shared.runner_user.username, f"export_{fmt}", connection=task.connection, status="ok")
        if fmt == "csv":
            return Response(csv_bytes(task.result), media_type="text/csv; charset=utf-8",
                            headers={"Content-Disposition": 'attachment; filename="result.csv"'})
        return StreamingResponse(xlsx_stream(task.result),
                                 media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": 'attachment; filename="result.xlsx"'})

    public = APIRouter(prefix="/api/public/{token}", tags=["public"], dependencies=[Depends(limited)])
    Access = Header(default=None, alias="X-Ncode-Access")

    @public.get("")
    def public_get(token: str, access: str | None = Access):
        shared = resolve_public(token, access, unlocked=False)
        if shared.link.password_hash and not signer.check(shared.link.id, access, shared.link.password_hash):
            return {"password_required": True}
        store.touch(shared.link.id, view=True)
        return {"password_required": False, **definition(shared)}

    @public.post("/unlock")
    def public_unlock(token: str, body: UnlockIn, request: Request):
        shared = resolve_public(token, None, unlocked=False)
        key = f"{shared.link.id}|{client_key(request)}"
        wait = passwords.locked_for(key)
        if wait:
            raise HTTPException(status_code=429, detail="Too many wrong passwords", headers={"Retry-After": str(wait)})
        if not shared.link.password_hash or not verify_password(body.password, shared.link.password_hash):
            passwords.fail(key)
            raise HTTPException(status_code=403, detail="Wrong password")
        passwords.success(key)
        return {"access": signer.issue(shared.link.id, shared.link.password_hash)}

    @public.post("/run")
    def public_run(token: str, body: PublicRunIn, access: str | None = Access):
        return run_question(resolve_public(token, access), body)

    @public.post("/cards/{key}/run")
    def public_card(token: str, key: str, body: PublicRunIn, access: str | None = Access):
        return run_card(resolve_public(token, access), key, body)

    @public.get("/tasks/{task_id}")
    def public_task(token: str, task_id: str, wait_ms: int = Query(0, ge=0, le=PUBLIC_MAX_WAIT_MS), access: str | None = Access):
        return follow(resolve_public(token, access), task_id, wait_ms)

    @public.delete("/tasks/{task_id}")
    def public_cancel(token: str, task_id: str, access: str | None = Access):
        own_task(resolve_public(token, access), task_id).cancel()
        return {"status": "cancelling"}

    @public.get("/tasks/{task_id}/export.{fmt}")
    def public_export(token: str, task_id: str, fmt: str, access: str | None = Access):
        if fmt not in ("csv", "xlsx"):
            raise HTTPException(status_code=404, detail="Not found")
        return export(resolve_public(token, access), task_id, fmt)

    embed = APIRouter(prefix="/api/embed/{jwt}", tags=["embed"], dependencies=[Depends(limited)])

    @embed.get("")
    def embed_get(jwt: str):
        shared = resolve_embed(jwt)
        store.touch(shared.link.id, view=True)
        return {"password_required": False, **definition(shared)}

    @embed.post("/run")
    def embed_run(jwt: str, body: PublicRunIn):
        return run_question(resolve_embed(jwt), body)

    @embed.post("/cards/{key}/run")
    def embed_card(jwt: str, key: str, body: PublicRunIn):
        return run_card(resolve_embed(jwt), key, body)

    @embed.get("/tasks/{task_id}")
    def embed_task(jwt: str, task_id: str, wait_ms: int = Query(0, ge=0, le=PUBLIC_MAX_WAIT_MS)):
        return follow(resolve_embed(jwt), task_id, wait_ms)

    @embed.delete("/tasks/{task_id}")
    def embed_cancel(jwt: str, task_id: str):
        own_task(resolve_embed(jwt), task_id).cancel()
        return {"status": "cancelling"}

    app.include_router(public)
    app.include_router(embed)
    return store


