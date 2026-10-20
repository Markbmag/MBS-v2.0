"""Subscriptions and alerts: what is sent, to whom and when (M8).

A subscription belongs to the user who created it ("owner"). It always runs with
the owner's permissions: what the owner may no longer see is not sent. Recipients
get what the owner sees - like forwarding a report - so only add people who may
see it. Admins see and manage every subscription; a recipient can remove
themselves.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import delete, func, insert, or_, select, update
from sqlalchemy.engine import Engine

from ..appdb import User
from ..content.store import ContentError
from ..content.tables import subscription_runs_table, subscriptions_table
from .schedule import Schedule, next_run
from .settings import valid_email

MAX_RECIPIENTS = 100
RUNS_KEPT = 50


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Recipients(_Model):
    users: list[str] = Field(default_factory=list, max_length=MAX_RECIPIENTS)     # Ncode users (their email)
    emails: list[str] = Field(default_factory=list, max_length=MAX_RECIPIENTS)    # other addresses
    destinations: list[int] = Field(default_factory=list, max_length=20)          # Slack, Teams ... (admin-defined)

    @field_validator("users")
    @classmethod
    def _users(cls, value: list[str]) -> list[str]:
        return sorted({u.strip().lower() for u in value if u.strip()})

    @field_validator("emails")
    @classmethod
    def _emails(cls, value: list[str]) -> list[str]:
        out = []
        for e in value:
            e = e.strip()
            if not e:
                continue
            if not valid_email(e):
                raise ValueError(f"{e!r} is not an email address")
            out.append(e)
        return sorted(set(out), key=str.lower)

    @field_validator("destinations")
    @classmethod
    def _dest(cls, value: list[int]) -> list[int]:
        return sorted(set(value))

    @property
    def empty(self) -> bool:
        return not (self.users or self.emails or self.destinations)


class Options(_Model):
    filters: dict[str, Any] = Field(default_factory=dict, max_length=50)  # dashboard filter values / question parameters
    attach: Literal["none", "csv", "xlsx"] = "none"
    rows: int = Field(default=10, ge=1, le=50)                            # rows shown per card
    skip_empty: bool = False                                              # send nothing when every card is empty
    message: str = Field(default="", max_length=2000)                     # a note above the results


class AlertCondition(_Model):
    type: Literal["rows", "above", "below"]
    column: str | None = Field(default=None, max_length=255)  # above/below: default = the first number column
    value: float | None = None
    once: bool = False                                        # switch the alert off after it fired

    @model_validator(mode="after")
    def _value(self) -> "AlertCondition":
        if self.type != "rows" and self.value is None:
            raise ValueError("give the value to compare with")
        return self


class SubscriptionIn(_Model):
    name: str = Field(default="", max_length=200)
    target_type: Literal["dashboard", "question"]
    target_id: int
    schedule: Schedule
    recipients: Recipients
    options: Options = Field(default_factory=Options)
    alert: AlertCondition | None = None
    enabled: bool = True

    @model_validator(mode="after")
    def _shape(self) -> "SubscriptionIn":
        if self.alert is not None and self.target_type != "question":
            raise ValueError("alerts watch a question, not a dashboard")
        return self


@dataclass
class Subscription:
    id: int
    name: str
    target_type: str
    target_id: int
    owner_id: int
    schedule: Schedule
    recipients: Recipients
    options: Options
    alert: AlertCondition | None
    enabled: bool
    next_run_at: float | None
    last_run_at: float | None
    last_status: str | None
    last_error: str | None
    created_at: float
    updated_at: float

    def body(self) -> SubscriptionIn:
        return SubscriptionIn(
            name=self.name, target_type=self.target_type, target_id=self.target_id, schedule=self.schedule,  # type: ignore[arg-type]
            recipients=self.recipients, options=self.options, alert=self.alert, enabled=self.enabled,
        )


def _from_row(row: Any) -> Subscription:
    alert = json.loads(row.alert) if row.alert else None
    return Subscription(
        id=row.id, name=row.name, target_type=row.target_type, target_id=row.target_id, owner_id=row.owner_id,
        schedule=Schedule.model_validate(json.loads(row.schedule)),
        recipients=Recipients.model_validate(json.loads(row.recipients)),
        options=Options.model_validate(json.loads(row.options)),
        alert=AlertCondition.model_validate(alert) if alert else None,
        enabled=bool(row.enabled), next_run_at=row.next_run_at, last_run_at=row.last_run_at,
        last_status=row.last_status, last_error=row.last_error, created_at=row.created_at, updated_at=row.updated_at,
    )


class SubscriptionStore:
    def __init__(self, engine: Engine):
        self.engine = engine

    # ------------------------------------------------------------------ read
    def get(self, sid: int) -> Subscription:
        with self.engine.connect() as conn:
            row = conn.execute(select(subscriptions_table).where(subscriptions_table.c.id == sid)).first()
        if row is None:
            raise ContentError("No such subscription", 404)
        return _from_row(row)

    def visible(self, user: User, sid: int, *, manage: bool = False) -> Subscription:
        """The subscription if the user owns it (or is admin); recipients may only read it."""
        sub = self.get(sid)
        if user.is_admin or sub.owner_id == user.id:
            return sub
        if not manage and user.username in sub.recipients.users:
            return sub
        raise ContentError("No such subscription", 404)

    def list(self, user: User, *, target_type: str | None = None, target_id: int | None = None, everyone: bool = False) -> list[Subscription]:
        stmt = select(subscriptions_table).order_by(subscriptions_table.c.name, subscriptions_table.c.id)
        if target_type:
            stmt = stmt.where(subscriptions_table.c.target_type == target_type)
        if target_id is not None:
            stmt = stmt.where(subscriptions_table.c.target_id == target_id)
        if not (user.is_admin and everyone):
            # own ones, and the ones the user receives (a JSON list; checked exactly below)
            stmt = stmt.where(or_(
                subscriptions_table.c.owner_id == user.id,
                subscriptions_table.c.recipients.like(f'%"{user.username}"%'),
            ))
        with self.engine.connect() as conn:
            subs = [_from_row(r) for r in conn.execute(stmt).all()]
        if user.is_admin and everyone:
            return subs
        return [s for s in subs if s.owner_id == user.id or user.username in s.recipients.users]

    def due(self, now: float, limit: int = 20) -> list[Subscription]:
        with self.engine.connect() as conn:
            rows = conn.execute(
                select(subscriptions_table)
                .where(subscriptions_table.c.enabled.is_(True), subscriptions_table.c.next_run_at <= now)
                .order_by(subscriptions_table.c.next_run_at).limit(limit)
            ).all()
        return [_from_row(r) for r in rows]

    # ------------------------------------------------------------------ write
    @staticmethod
    def _values(body: SubscriptionIn, now: float) -> dict[str, Any]:
        return {
            "name": body.name.strip(),
            "target_type": body.target_type,
            "target_id": body.target_id,
            "schedule": body.schedule.model_dump_json(),
            "recipients": body.recipients.model_dump_json(),
            "options": body.options.model_dump_json(),
            "alert": body.alert.model_dump_json() if body.alert else None,
            "enabled": body.enabled,
            "next_run_at": next_run(body.schedule, now) if body.enabled else None,
            "updated_at": now,
        }

    def create(self, owner: User, body: SubscriptionIn) -> Subscription:
        now = time.time()
        with self.engine.begin() as conn:
            sid = conn.execute(insert(subscriptions_table).values(owner_id=owner.id, created_at=now, **self._values(body, now))).inserted_primary_key[0]
        return self.get(int(sid))

    def update(self, sid: int, body: SubscriptionIn) -> Subscription:
        values = self._values(body, time.time())
        with self.engine.begin() as conn:
            conn.execute(update(subscriptions_table).where(subscriptions_table.c.id == sid).values(**values))
        return self.get(sid)

    def set_enabled(self, sid: int, on: bool) -> None:
        sub = self.get(sid)
        with self.engine.begin() as conn:
            conn.execute(update(subscriptions_table).where(subscriptions_table.c.id == sid).values(
                enabled=on, next_run_at=next_run(sub.schedule, time.time()) if on else None, updated_at=time.time(),
            ))

    def remove_recipient(self, sid: int, username: str) -> None:
        sub = self.get(sid)
        recipients = sub.recipients.model_copy(update={"users": [u for u in sub.recipients.users if u != username]})
        with self.engine.begin() as conn:
            conn.execute(update(subscriptions_table).where(subscriptions_table.c.id == sid).values(
                recipients=recipients.model_dump_json(), updated_at=time.time(),
            ))

    def delete(self, sid: int) -> None:
        with self.engine.begin() as conn:
            conn.execute(delete(subscription_runs_table).where(subscription_runs_table.c.subscription_id == sid))
            conn.execute(delete(subscriptions_table).where(subscriptions_table.c.id == sid))

    def claim(self, sub: Subscription, now: float) -> bool:
        """Move a due subscription to its next run; False if another worker got there first."""
        with self.engine.begin() as conn:
            result = conn.execute(
                update(subscriptions_table)
                .where(subscriptions_table.c.id == sub.id, subscriptions_table.c.next_run_at == sub.next_run_at)
                .values(next_run_at=next_run(sub.schedule, now))
            )
        return result.rowcount == 1

    # ------------------------------------------------------------------ runs
    def start_run(self, sid: int, trigger: str) -> int:
        with self.engine.begin() as conn:
            return int(conn.execute(insert(subscription_runs_table).values(
                subscription_id=sid, trigger=trigger, started_at=time.time(), status="running",
            )).inserted_primary_key[0])

    def finish_run(self, run_id: int, sid: int, status: str, detail: dict[str, Any], disable: bool = False) -> None:
        now = time.time()
        error = detail.get("error") or next(
            (f"{c['channel']}: {c['status']}" for c in detail.get("channels", []) if c["status"] != "sent"), None
        )
        with self.engine.begin() as conn:
            conn.execute(update(subscription_runs_table).where(subscription_runs_table.c.id == run_id).values(
                finished_at=now, status=status, detail=json.dumps(detail, default=str)[:200_000],
            ))
            values: dict[str, Any] = {"last_run_at": now, "last_status": status, "last_error": error}
            if disable:
                values.update(enabled=False, next_run_at=None)
            conn.execute(update(subscriptions_table).where(subscriptions_table.c.id == sid).values(**values))
            # keep the latest runs only
            old = select(subscription_runs_table.c.id).where(subscription_runs_table.c.subscription_id == sid) \
                .order_by(subscription_runs_table.c.id.desc()).offset(RUNS_KEPT)
            conn.execute(delete(subscription_runs_table).where(subscription_runs_table.c.id.in_(old)))

    def runs(self, sid: int, limit: int = 20) -> list[dict[str, Any]]:
        with self.engine.connect() as conn:
            rows = conn.execute(
                select(subscription_runs_table).where(subscription_runs_table.c.subscription_id == sid)
                .order_by(subscription_runs_table.c.id.desc()).limit(limit)
            ).all()
        return [
            {"id": r.id, "trigger": r.trigger, "started_at": r.started_at, "finished_at": r.finished_at,
             "status": r.status, "detail": json.loads(r.detail) if r.detail else None}
            for r in rows
        ]

    def count_for(self, target_type: str, target_id: int) -> int:
        with self.engine.connect() as conn:
            return conn.execute(select(func.count()).select_from(subscriptions_table).where(
                subscriptions_table.c.target_type == target_type, subscriptions_table.c.target_id == target_id,
            )).scalar_one()
