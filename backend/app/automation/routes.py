"""Subscriptions, alerts and delivery settings API (roadmap M8).

    GET    /api/subscriptions?target_type=&target_id=&all=   own ones and the ones you receive (admins: all=true)
    GET    /api/subscriptions/options          what the editor offers: destinations, people, email set up?
    POST   /api/subscriptions                  SubscriptionIn (app/automation/store.py)
    POST   /api/subscriptions/preview          render without sending -> {"html", "text", "alert"}
    GET    /api/subscriptions/{id}             with the latest runs
    PUT    /api/subscriptions/{id}             replace
    PATCH  /api/subscriptions/{id}             {"enabled": false}
    DELETE /api/subscriptions/{id}
    POST   /api/subscriptions/{id}/send        send now (in the background; see its runs)
    POST   /api/subscriptions/{id}/unsubscribe a recipient removes themselves
    PUT    /api/account/email                  {"email"} your own address, for subscriptions

    GET    /api/admin/settings                 email server, site address, sharing (secrets: only "is set")
    PUT    /api/admin/settings/email           {..., "password": null = keep, "" = remove}
    POST   /api/admin/settings/email/test      {"to"}
    PUT    /api/admin/settings/general         {"site_url"}
    GET    /api/admin/destinations             Slack / Teams / Telegram / webhooks
    POST   /api/admin/destinations             DestinationIn
    PUT    /api/admin/destinations/{id}
    DELETE /api/admin/destinations/{id}
    POST   /api/admin/destinations/{id}/test
"""

from __future__ import annotations

import time
from typing import Any, Callable

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field, ValidationError

from ..appdb import AppDB, User
from ..content.store import ContentError
from . import channels
from .engine import Engine
from .render import CardOut, Report, email_html, plain_text, slack_payload, teams_payload, telegram_text, webhook_payload
from .scheduler import Scheduler
from .settings import UNCHANGED, DestinationIn, EmailSettings, GeneralSettings, SettingsStore, valid_email
from .store import Subscription, SubscriptionIn, SubscriptionStore


MANUAL_COOLDOWN_SEC = 20


class EmailIn(EmailSettings):
    password: str | None = Field(default=None, max_length=500)


class TestEmailIn(BaseModel):
    to: str = Field(min_length=3, max_length=254)


class AccountEmailIn(BaseModel):
    email: str = Field(default="", max_length=254)


class EnabledIn(BaseModel):
    enabled: bool


def register_automation_routes(
    app: FastAPI,
    *,
    app_db: AppDB,
    settings_store: SettingsStore,
    subs: SubscriptionStore,
    engine: Engine,
    scheduler: Scheduler,
    current_user: Callable[..., User],
    require_admin: Callable[..., User],
) -> None:
    router = APIRouter(tags=["automation"])
    manual_sends: dict[int, float] = {}  # "Send now" at most once per MANUAL_COOLDOWN_SEC per subscription

    def fail(exc: ContentError) -> HTTPException:
        return HTTPException(status_code=exc.status, detail=str(exc))

    content = lambda: app.state.content  # noqa: E731 - set by the library routes

    def target_name(user: User, target_type: str, target_id: int) -> str | None:
        try:
            if target_type == "dashboard":
                return content().dashboards.get(user, target_id).name
            return content().store.get_question(user, target_id).name
        except ContentError:
            return None

    def as_json(user: User, sub: Subscription, runs: bool = False) -> dict[str, Any]:
        owner = app_db.get_user(sub.owner_id)
        out = {
            "id": sub.id,
            "name": sub.name,
            "target_type": sub.target_type,
            "target_id": sub.target_id,
            "target_name": target_name(user, sub.target_type, sub.target_id),
            "owner": owner.username if owner else None,
            "can_manage": user.is_admin or sub.owner_id == user.id,
            "schedule": sub.schedule.model_dump(),
            "recipients": sub.recipients.model_dump(),
            "options": sub.options.model_dump(),
            "alert": sub.alert.model_dump() if sub.alert else None,
            "enabled": sub.enabled,
            "next_run_at": sub.next_run_at,
            "last_run_at": sub.last_run_at,
            "last_status": sub.last_status,
            "last_error": sub.last_error,
            "running": scheduler.is_running(sub.id),
            "created_at": sub.created_at,
            "updated_at": sub.updated_at,
        }
        if not out["can_manage"]:  # a recipient sees who else gets it by name only, and no send details
            out["recipients"] = {**out["recipients"], "emails": [f"{len(sub.recipients.emails)} other address(es)"] if sub.recipients.emails else []}
            out["last_error"] = None
            runs = False
        if runs:
            out["runs"] = subs.runs(sub.id)
        return out

    def check(user: User, body: SubscriptionIn) -> None:
        """The caller may see the target, the recipients exist and are allowed."""
        if target_name(user, body.target_type, body.target_id) is None:
            raise HTTPException(status_code=404, detail=f"No such {body.target_type}, or it is not shared with you")
        if body.recipients.empty:
            raise HTTPException(status_code=400, detail="Add at least one recipient")
        for name in body.recipients.users:
            u = app_db.get_user_by_name(name)
            if u is None or not u.is_active:
                raise HTTPException(status_code=400, detail=f"Unknown user {name!r}")
        domains = settings_store.get("email").allowed_domains
        if domains and not user.is_admin:
            for e in body.recipients.emails:
                if e.rsplit("@", 1)[-1].lower() not in domains:
                    raise HTTPException(
                        status_code=400,
                        detail=f"{e} is outside the allowed domains ({', '.join(domains)}). An admin can send there.",
                    )
        known = {d.id for d in settings_store.destinations()}
        for did in body.recipients.destinations:
            if did not in known:
                raise HTTPException(status_code=400, detail="A chosen destination does not exist any more")

    def parse(raw: dict[str, Any]) -> SubscriptionIn:
        try:
            return SubscriptionIn.model_validate(raw)
        except ValidationError as exc:
            err = exc.errors()[0]
            where = ".".join(str(p) for p in err.get("loc", ()))
            raise HTTPException(status_code=400, detail=f"{err['msg']}" + (f" ({where})" if where else "")) from exc

    # ------------------------------------------------------------------ subscriptions
    @router.get("/api/subscriptions")
    def list_subscriptions(
        target_type: str | None = Query(None, pattern="^(dashboard|question)$"),
        target_id: int | None = None,
        all: bool = False,  # noqa: A002 - query parameter name
        user: User = Depends(current_user),
    ):
        found = subs.list(user, target_type=target_type, target_id=target_id, everyone=all)
        return {"subscriptions": [as_json(user, s) for s in found]}

    @router.get("/api/subscriptions/options")
    def options(user: User = Depends(current_user)):
        email = settings_store.get("email")
        return {
            "email_configured": email.configured,
            "allowed_domains": email.allowed_domains,
            "site_url": settings_store.site_url(),
            "my_email": user.email,
            "destinations": [d.public() for d in settings_store.destinations()],
            "people": [
                {"username": u.username, "has_email": bool(u.email)}
                for u in app_db.list_users() if u.is_active
            ],
            "scheduler": scheduler is not None and scheduler._thread is not None,
        }

    @router.post("/api/subscriptions")
    def create(raw: dict[str, Any], user: User = Depends(current_user)):
        body = parse(raw)
        check(user, body)
        sub = subs.create(user, body)
        app_db.audit(user.username, "subscription_add", phrase=f"{sub.target_type} {sub.target_id}: {sub.name}"[:200], status="ok")
        return as_json(user, sub, runs=True)

    @router.post("/api/subscriptions/preview")
    def preview(raw: dict[str, Any], user: User = Depends(current_user)):
        """Renders with the caller's permissions (the preview runs as the person looking at it)."""
        body = parse({**raw, "recipients": raw.get("recipients") or {"emails": []}})
        if target_name(user, body.target_type, body.target_id) is None:
            raise HTTPException(status_code=404, detail=f"No such {body.target_type}, or it is not shared with you")
        outcome = engine.build(user, body, None)
        if outcome.error:
            raise HTTPException(status_code=409, detail=outcome.error)
        return {
            "html": email_html(outcome.report),
            "text": plain_text(outcome.report),
            "alert": None if outcome.alert_met is None else {"met": outcome.alert_met, "note": outcome.alert_note},
            "empty": outcome.empty,
            "cards": outcome.cards,
        }

    @router.get("/api/subscriptions/{sid}")
    def get(sid: int, user: User = Depends(current_user)):
        try:
            return as_json(user, subs.visible(user, sid), runs=True)
        except ContentError as exc:
            raise fail(exc) from exc

    @router.put("/api/subscriptions/{sid}")
    def replace(sid: int, raw: dict[str, Any], user: User = Depends(current_user)):
        try:
            current = subs.visible(user, sid, manage=True)
        except ContentError as exc:
            raise fail(exc) from exc
        body = parse(raw)
        if (body.target_type, body.target_id) != (current.target_type, current.target_id):
            raise HTTPException(status_code=400, detail="A subscription stays on its dashboard or question")
        check(user, body)
        return as_json(user, subs.update(sid, body), runs=True)

    @router.patch("/api/subscriptions/{sid}")
    def patch(sid: int, body: EnabledIn, user: User = Depends(current_user)):
        try:
            subs.visible(user, sid, manage=True)
        except ContentError as exc:
            raise fail(exc) from exc
        subs.set_enabled(sid, body.enabled)
        return as_json(user, subs.get(sid), runs=True)

    @router.delete("/api/subscriptions/{sid}")
    def remove(sid: int, user: User = Depends(current_user)):
        try:
            sub = subs.visible(user, sid, manage=True)
        except ContentError as exc:
            raise fail(exc) from exc
        subs.delete(sid)
        app_db.audit(user.username, "subscription_delete", phrase=f"{sub.target_type} {sub.target_id}: {sub.name}"[:200], status="ok")
        return {"deleted": sid}

    @router.post("/api/subscriptions/{sid}/send")
    def send_now(sid: int, user: User = Depends(current_user)):
        try:
            sub = subs.visible(user, sid, manage=True)
        except ContentError as exc:
            raise fail(exc) from exc
        if scheduler.is_running(sid):
            raise HTTPException(status_code=409, detail="It is being sent right now")
        last = manual_sends.get(sid, 0)
        if time.time() - last < MANUAL_COOLDOWN_SEC:
            raise HTTPException(status_code=429, detail=f"It was sent less than {MANUAL_COOLDOWN_SEC} seconds ago")
        manual_sends[sid] = time.time()
        scheduler.submit(sub, "manual")
        app_db.audit(user.username, "subscription_send", phrase=f"{sub.target_type} {sub.target_id}: {sub.name}"[:200], status="ok")
        return {"started": True}

    @router.post("/api/subscriptions/{sid}/unsubscribe")
    def unsubscribe(sid: int, user: User = Depends(current_user)):
        try:
            sub = subs.visible(user, sid)
        except ContentError as exc:
            raise fail(exc) from exc
        if user.username not in sub.recipients.users:
            raise HTTPException(status_code=400, detail="You are not a recipient of this subscription")
        subs.remove_recipient(sid, user.username)
        return {"unsubscribed": sid}

    @router.put("/api/account/email")
    def set_my_email(body: AccountEmailIn, user: User = Depends(current_user)):
        email = body.email.strip()
        if email and not valid_email(email):
            raise HTTPException(status_code=400, detail=f"{email!r} is not an email address")
        if user.id == 0:
            raise HTTPException(status_code=400, detail="Sign-in is turned off: there is no account to keep an address for")
        app_db.update_user(user.username, email=email or None)
        return {"email": email or None}

    # ------------------------------------------------------------------ admin: settings
    def settings_json() -> dict[str, Any]:
        return {
            "email": {**settings_store.get("email").model_dump(), "password_set": settings_store.has_secret("email")},
            "general": settings_store.get("general").model_dump(),
            "sharing": {**settings_store.get("sharing").model_dump(), "embedding_key_set": settings_store.has_secret("sharing")},
        }

    @router.get("/api/admin/settings")
    def get_settings(_admin: User = Depends(require_admin)):
        return settings_json()

    @router.put("/api/admin/settings/email")
    def put_email(body: EmailIn, admin: User = Depends(require_admin)):
        data = body.model_dump()
        password = data.pop("password")
        try:
            settings_store.put("email", EmailSettings(**data), admin.username, secret=password if password is not None else UNCHANGED)
        except ContentError as exc:
            raise fail(exc) from exc
        app_db.audit(admin.username, "settings", phrase="email server", status="ok")
        return settings_json()

    @router.post("/api/admin/settings/email/test")
    def test_email(body: TestEmailIn, admin: User = Depends(require_admin)):
        if not valid_email(body.to.strip()):
            raise HTTPException(status_code=400, detail="Not an email address")
        report = Report(title="Ncode test email", subtitle="If you can read this, email delivery works.",
                        url=settings_store.site_url() or None,
                        cards=[CardOut(title="", kind="text", text=f"Sent by {admin.username} from Admin → Delivery.")],
                        footer="Ncode")
        try:
            out = channels.send_email(settings_store.get("email"), settings_store.secret("email"), [body.to.strip()],
                                      "Ncode test email", email_html(report), plain_text(report), [])
        except channels.DeliveryError as exc:
            return {"ok": False, "error": str(exc)}
        status = out.get(body.to.strip(), "error")
        return {"ok": status == "sent", "error": None if status == "sent" else status}

    @router.put("/api/admin/settings/general")
    def put_general(body: GeneralSettings, admin: User = Depends(require_admin)):
        settings_store.put("general", body, admin.username)
        app_db.audit(admin.username, "settings", phrase="general", status="ok")
        return settings_json()

    # ------------------------------------------------------------------ admin: destinations
    def dest_json(d: Any) -> dict[str, Any]:
        return d.admin(settings_store.hint(d.id))

    @router.get("/api/admin/destinations")
    def list_destinations(_admin: User = Depends(require_admin)):
        return {"destinations": [dest_json(d) for d in settings_store.destinations()]}

    @router.post("/api/admin/destinations")
    def add_destination(body: DestinationIn, admin: User = Depends(require_admin)):
        try:
            d = settings_store.save_destination(body, admin.username)
        except ContentError as exc:
            raise fail(exc) from exc
        app_db.audit(admin.username, "destination_add", phrase=f"{d.kind}: {d.name}", status="ok")
        return dest_json(d)

    @router.put("/api/admin/destinations/{did}")
    def edit_destination(did: int, body: DestinationIn, admin: User = Depends(require_admin)):
        try:
            d = settings_store.save_destination(body, admin.username, did)
        except ContentError as exc:
            raise fail(exc) from exc
        app_db.audit(admin.username, "destination_edit", phrase=f"{d.kind}: {d.name}", status="ok")
        return dest_json(d)

    @router.delete("/api/admin/destinations/{did}")
    def delete_destination(did: int, admin: User = Depends(require_admin)):
        try:
            settings_store.delete_destination(did)
        except ContentError as exc:
            raise fail(exc) from exc
        app_db.audit(admin.username, "destination_delete", phrase=f"destination {did}", status="ok")
        return {"deleted": did}

    @router.post("/api/admin/destinations/{did}/test")
    def test_destination(did: int, admin: User = Depends(require_admin)):
        try:
            dest, secret = settings_store.destination(did)
        except ContentError as exc:
            raise fail(exc) from exc
        if not secret:
            return {"ok": False, "error": "Its address cannot be read (was the secret key changed?)"}
        report = Report(title="Ncode test message", url=settings_store.site_url() or None,
                        cards=[CardOut(title="", kind="text", text=f"Sent by {admin.username} from Admin → Delivery. Delivery works.")])
        try:
            if dest.kind == "slack":
                channels.post_json(secret, slack_payload(report), "Slack")
            elif dest.kind == "teams":
                channels.post_json(secret, teams_payload(report), "Teams")
            elif dest.kind == "telegram":
                channels.send_telegram(secret, dest.config.get("chat_id", ""), telegram_text(report), [])
            else:
                channels.post_json(secret, webhook_payload(report, {"event": "test"}), "The webhook")
        except channels.DeliveryError as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "error": None}

    app.include_router(router)

