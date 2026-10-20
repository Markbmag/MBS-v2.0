"""Public links and embedding settings per question or dashboard (table share_links).

    kind "public": a link anyone can open (optional password and expiry); several per item
    kind "embed":  one row per item that may be embedded, with what each filter or
                   parameter does in an embed: "locked" (the signed token sets it),
                   "editable" (the viewer may change it) or "disabled" (not used)
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import insert, select, update
from sqlalchemy.engine import Engine

from ..content.store import ContentError
from ..content.tables import share_links_table
from ..crypto import Cipher, CipherError
from ..security import hash_password
from .tokens import hash_public_token, new_public_token

TargetType = Literal["dashboard", "question"]
ParamMode = Literal["locked", "editable", "disabled"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PublicLinkIn(_Model):
    target_type: TargetType
    target_id: int
    expires_at: float | None = None
    password: str | None = Field(default=None, max_length=256)
    allow_download: bool = False


class PublicLinkPatch(_Model):
    expires_at: float | None = None
    clear_expiry: bool = False
    password: str | None = Field(default=None, max_length=256)  # "" removes it
    allow_download: bool | None = None


class EmbedIn(_Model):
    target_type: TargetType
    target_id: int
    enabled: bool
    params: dict[str, ParamMode] = Field(default_factory=dict, max_length=50)


@dataclass
class Link:
    id: int
    kind: str
    target_type: str
    target_id: int
    token_enc: str | None
    password_hash: str | None
    expires_at: float | None
    allow_download: bool
    settings: dict[str, Any]
    created_by: str | None
    created_at: float
    revoked_at: float | None
    last_used_at: float | None
    views: int

    @property
    def active(self) -> bool:
        return self.revoked_at is None and (self.expires_at is None or self.expires_at > time.time())


def _link(row: Any) -> Link:
    return Link(
        id=row.id, kind=row.kind, target_type=row.target_type, target_id=row.target_id, token_enc=row.token_enc,
        password_hash=row.password_hash, expires_at=row.expires_at, allow_download=bool(row.allow_download),
        settings=json.loads(row.settings or "{}"), created_by=row.created_by, created_at=row.created_at,
        revoked_at=row.revoked_at, last_used_at=row.last_used_at, views=row.views or 0,
    )


class ShareStore:
    def __init__(self, engine: Engine, cipher: Cipher | None):
        self.engine = engine
        self.cipher = cipher

    def token_of(self, link: Link) -> str | None:
        if not link.token_enc or self.cipher is None:
            return None
        try:
            return self.cipher.decrypt(link.token_enc)
        except CipherError:
            return None

    # ------------------------------------------------------------------ read
    def get(self, lid: int) -> Link:
        with self.engine.connect() as conn:
            row = conn.execute(select(share_links_table).where(share_links_table.c.id == lid)).first()
        if row is None:
            raise ContentError("No such link", 404)
        return _link(row)

    def list(self, *, target_type: str | None = None, target_id: int | None = None, kind: str | None = None) -> list[Link]:
        stmt = select(share_links_table).order_by(share_links_table.c.created_at.desc())
        if target_type:
            stmt = stmt.where(share_links_table.c.target_type == target_type)
        if target_id is not None:
            stmt = stmt.where(share_links_table.c.target_id == target_id)
        if kind:
            stmt = stmt.where(share_links_table.c.kind == kind)
        with self.engine.connect() as conn:
            return [_link(r) for r in conn.execute(stmt).all()]

    def by_token(self, token: str) -> Link | None:
        if not token or len(token) > 100:
            return None
        with self.engine.connect() as conn:
            row = conn.execute(select(share_links_table).where(
                share_links_table.c.token_hash == hash_public_token(token), share_links_table.c.kind == "public",
            )).first()
        return _link(row) if row else None

    def embed_for(self, target_type: str, target_id: int) -> Link | None:
        found = self.list(target_type=target_type, target_id=target_id, kind="embed")
        return found[0] if found else None

    # ------------------------------------------------------------------ write
    def create_public(self, body: PublicLinkIn, user: str) -> tuple[Link, str]:
        if self.cipher is None:
            raise ContentError("Public links need the server's encryption key", 500)
        if body.expires_at is not None and body.expires_at <= time.time():
            raise ContentError("The expiry date is in the past")
        token = new_public_token()
        with self.engine.begin() as conn:
            lid = conn.execute(insert(share_links_table).values(
                kind="public", target_type=body.target_type, target_id=body.target_id,
                token_hash=hash_public_token(token), token_enc=self.cipher.encrypt(token),
                password_hash=hash_password(body.password) if body.password else None,
                expires_at=body.expires_at, allow_download=body.allow_download, settings="{}",
                created_by=user, created_at=time.time(), views=0,
            )).inserted_primary_key[0]
        return self.get(int(lid)), token

    def update_public(self, lid: int, body: PublicLinkPatch) -> Link:
        link = self.get(lid)
        if link.kind != "public":
            raise ContentError("No such link", 404)
        values: dict[str, Any] = {}
        if body.clear_expiry:
            values["expires_at"] = None
        elif body.expires_at is not None:
            if body.expires_at <= time.time():
                raise ContentError("The expiry date is in the past")
            values["expires_at"] = body.expires_at
        if body.password is not None:
            values["password_hash"] = hash_password(body.password) if body.password else None
        if body.allow_download is not None:
            values["allow_download"] = body.allow_download
        if values:
            with self.engine.begin() as conn:
                conn.execute(update(share_links_table).where(share_links_table.c.id == lid).values(**values))
        return self.get(lid)

    def revoke(self, lid: int) -> None:
        self.get(lid)
        with self.engine.begin() as conn:
            conn.execute(update(share_links_table).where(share_links_table.c.id == lid, share_links_table.c.revoked_at.is_(None))
                         .values(revoked_at=time.time()))

    def set_embed(self, body: EmbedIn, user: str) -> Link | None:
        current = self.embed_for(body.target_type, body.target_id)
        settings = json.dumps({"params": body.params})
        with self.engine.begin() as conn:
            if current is None:
                if not body.enabled:
                    return None
                conn.execute(insert(share_links_table).values(
                    kind="embed", target_type=body.target_type, target_id=body.target_id, settings=settings,
                    allow_download=False, created_by=user, created_at=time.time(), views=0,
                ))
            else:
                # whoever changes it last is whose permissions the embed runs with
                conn.execute(update(share_links_table).where(share_links_table.c.id == current.id).values(
                    settings=settings, created_by=user, revoked_at=None if body.enabled else time.time(),
                ))
        return self.embed_for(body.target_type, body.target_id)

    def touch(self, lid: int, view: bool) -> None:
        values: dict[str, Any] = {"last_used_at": time.time()}
        if view:
            values["views"] = share_links_table.c.views + 1
        with self.engine.begin() as conn:
            conn.execute(update(share_links_table).where(share_links_table.c.id == lid).values(**values))
