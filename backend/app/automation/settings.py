"""Admin settings kept in Ncode's own database (M8): email server, site address, sharing,
and the delivery destinations (Slack, Teams, Telegram, webhooks).

Secrets (SMTP password, webhook URLs, bot tokens, the embedding key) are stored
encrypted with the same key as database passwords and are never sent back to the
browser: the API only says whether one is set.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, insert, select, update
from sqlalchemy.engine import Engine

from ..content.store import ContentError
from ..content.tables import app_settings_table, destinations_table
from ..crypto import Cipher, CipherError

EMAIL_RE = re.compile(r"^[^@\s<>,;\"']{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,63}$")
DOMAIN_RE = re.compile(r"^[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,63}$")
DestinationKind = Literal["slack", "teams", "telegram", "webhook"]
UNCHANGED = object()


def valid_email(value: str) -> bool:
    return bool(EMAIL_RE.match(value or ""))


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmailSettings(_Model):
    host: str = Field(default="", max_length=255)
    port: int = Field(default=587, ge=1, le=65535)
    security: Literal["starttls", "ssl", "none"] = "starttls"
    username: str = Field(default="", max_length=255)
    from_address: str = Field(default="", max_length=254)
    from_name: str = Field(default="Ncode", max_length=120)
    reply_to: str = Field(default="", max_length=254)
    # empty: any address; otherwise addresses typed in must end with one of these
    allowed_domains: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("from_address", "reply_to")
    @classmethod
    def _address(cls, value: str) -> str:
        value = value.strip()
        if value and not valid_email(value):
            raise ValueError(f"{value!r} is not an email address")
        return value

    @field_validator("from_name")
    @classmethod
    def _name(cls, value: str) -> str:
        return re.sub(r"[\r\n]+", " ", value).strip()

    @field_validator("allowed_domains")
    @classmethod
    def _domains(cls, value: list[str]) -> list[str]:
        out = []
        for d in value:
            d = d.strip().lower().lstrip("@")
            if not d:
                continue
            if not DOMAIN_RE.match(d):
                raise ValueError(f"{d!r} is not a domain")
            out.append(d)
        return sorted(set(out))

    @property
    def configured(self) -> bool:
        return bool(self.host and self.from_address)


class GeneralSettings(_Model):
    # how people reach Ncode: links in emails and public links start with it
    site_url: str = Field(default="", max_length=500)

    @field_validator("site_url")
    @classmethod
    def _url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if value and not re.match(r"^https?://[^\s/]+", value):
            raise ValueError("the site address starts with http:// or https://")
        return value


class SharingSettings(_Model):
    public_links: bool = False      # admins may create public links
    embedding: bool = False         # signed embedding is on (needs the embedding key)


SETTINGS = {"email": EmailSettings, "general": GeneralSettings, "sharing": SharingSettings}


@dataclass
class Destination:
    id: int
    name: str
    kind: str
    config: dict[str, Any]
    created_by: str | None
    created_at: float
    updated_at: float

    def public(self) -> dict[str, Any]:
        """What every user may see: enough to pick it, nothing secret."""
        return {"id": self.id, "name": self.name, "kind": self.kind}

    def admin(self, secret_hint: str) -> dict[str, Any]:
        return {**self.public(), "config": self.config, "secret_hint": secret_hint,
                "created_by": self.created_by, "created_at": self.created_at, "updated_at": self.updated_at}


class DestinationIn(_Model):
    name: str = Field(min_length=1, max_length=120)
    kind: DestinationKind
    # Slack / Teams / webhook: the webhook URL; Telegram: the bot token. Empty on update = keep.
    secret: str = Field(default="", max_length=2000)
    chat_id: str = Field(default="", max_length=64)   # Telegram


def _hint(secret: str) -> str:
    """Enough to recognise a secret, not to use it: https://hooks.slack.com/…a1b2."""
    if secret.startswith("http"):
        host = re.sub(r"^(https?://[^/]+).*$", r"\1", secret)
        return f"{host}/…{secret[-4:]}"
    return f"…{secret[-4:]}" if len(secret) > 8 else "set"


def check_destination_secret(kind: str, secret: str) -> None:
    if kind == "telegram":
        if not re.match(r"^\d{3,15}:[A-Za-z0-9_-]{20,100}$", secret):
            raise ContentError("A Telegram bot token looks like 123456789:AA… (from @BotFather)")
        return
    if not re.match(r"^https?://[^\s]+$", secret):
        raise ContentError("Paste the webhook address (https://…)")


class SettingsStore:
    def __init__(self, engine: Engine, cipher: Cipher | None):
        self.engine = engine
        self.cipher = cipher

    # ------------------------------------------------------------------ secrets
    def _encrypt(self, value: str) -> str:
        if self.cipher is None:
            raise ContentError("Secrets cannot be stored: the server has no encryption key", 500)
        return self.cipher.encrypt(value)

    def _decrypt(self, value: str | None) -> str | None:
        if not value or self.cipher is None:
            return None
        try:
            return self.cipher.decrypt(value)
        except CipherError:
            return None

    # ------------------------------------------------------------------ settings
    def _row(self, key: str) -> Any:
        with self.engine.connect() as conn:
            return conn.execute(select(app_settings_table).where(app_settings_table.c.key == key)).first()

    def get(self, key: str) -> Any:
        model = SETTINGS[key]
        row = self._row(key)
        if row is None:
            return model()
        try:
            return model.model_validate(json.loads(row.value))
        except ValueError:
            return model()

    def has_secret(self, key: str) -> bool:
        row = self._row(key)
        return bool(row is not None and row.secret)

    def secret(self, key: str) -> str | None:
        row = self._row(key)
        return self._decrypt(row.secret) if row is not None else None

    def put(self, key: str, value: BaseModel, user: str | None, secret: Any = UNCHANGED) -> None:
        values: dict[str, Any] = {"value": value.model_dump_json(), "updated_at": time.time(), "updated_by": user}
        if secret is not UNCHANGED:
            values["secret"] = self._encrypt(secret) if secret else None
        with self.engine.begin() as conn:
            exists = conn.execute(select(app_settings_table.c.key).where(app_settings_table.c.key == key)).first()
            if exists:
                conn.execute(update(app_settings_table).where(app_settings_table.c.key == key).values(**values))
            else:
                conn.execute(insert(app_settings_table).values(key=key, **{"secret": None, **values}))

    def site_url(self) -> str:
        return self.get("general").site_url

    # ------------------------------------------------------------------ destinations
    @staticmethod
    def _dest(row: Any) -> Destination:
        return Destination(
            id=row.id, name=row.name, kind=row.kind, config=json.loads(row.config or "{}"),
            created_by=row.created_by, created_at=row.created_at, updated_at=row.updated_at,
        )

    def destinations(self) -> list[Destination]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(destinations_table).order_by(destinations_table.c.name)).all()
        return [self._dest(r) for r in rows]

    def destination(self, did: int) -> tuple[Destination, str | None]:
        with self.engine.connect() as conn:
            row = conn.execute(select(destinations_table).where(destinations_table.c.id == did)).first()
        if row is None:
            raise ContentError("No such destination", 404)
        return self._dest(row), self._decrypt(row.secret)

    def hint(self, did: int) -> str:
        _dest, secret = self.destination(did)
        return _hint(secret) if secret else "cannot be read (was the secret key changed?)"

    def save_destination(self, body: DestinationIn, user: str, did: int | None = None) -> Destination:
        secret = body.secret.strip()
        if did is None and not secret:
            raise ContentError("Paste the webhook address or bot token")
        if secret:
            check_destination_secret(body.kind, secret)
        if body.kind == "telegram" and not re.match(r"^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$", body.chat_id.strip()):
            raise ContentError("A Telegram chat id is a number (groups start with -100…) or @channelname")
        config = {"chat_id": body.chat_id.strip()} if body.kind == "telegram" else {}
        now = time.time()
        values: dict[str, Any] = {"name": body.name.strip(), "kind": body.kind, "config": json.dumps(config), "updated_at": now}
        if secret:
            values["secret"] = self._encrypt(secret)
        with self.engine.begin() as conn:
            if did is None:
                did = int(conn.execute(insert(destinations_table).values(created_at=now, created_by=user, **values)).inserted_primary_key[0])
            else:
                current = conn.execute(select(destinations_table.c.kind).where(destinations_table.c.id == did)).first()
                if current is None:
                    raise ContentError("No such destination", 404)
                if current.kind != body.kind and not secret:
                    raise ContentError("Another kind of destination needs its own address or token")
                conn.execute(update(destinations_table).where(destinations_table.c.id == did).values(**values))
        return self.destination(did)[0]

    def delete_destination(self, did: int) -> None:
        with self.engine.begin() as conn:
            if conn.execute(delete(destinations_table).where(destinations_table.c.id == did)).rowcount == 0:
                raise ContentError("No such destination", 404)
