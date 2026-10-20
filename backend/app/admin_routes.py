"""Users, groups and row-level security for admins (roadmap M9).

    GET    /api/admin/users                    everyone, with groups, databases and last sign-in
    POST   /api/admin/users                    {"username", "password", "role", "email", "connections", "groups"}
    PATCH  /api/admin/users/{name}             any of: role, is_active, email, connections, groups, password
    DELETE /api/admin/users/{name}
    GET    /api/admin/groups                   POST {"name", "description", "connections", "members"}
    PUT    /api/admin/groups/{id}              DELETE /api/admin/groups/{id}
    GET    /api/admin/row-rules                POST {"group_id", "connection", "table", "column", "values"}
    DELETE /api/admin/row-rules/{id}
    PUT    /api/account/password               {"current", "new"}: your own password -> a new session token

"connections" is "*" (all), "" (none) or a list of connection keys. A user may use the databases
of their own setting plus those of their groups.
"""

from __future__ import annotations

import re
import time
from typing import Any, Callable

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from .appdb import AppDB, User, format_allowed, parse_allowed
from .automation.settings import valid_email
from .db import ConnectionRegistry
from .rowsec import RowRules
from .security import MIN_PASSWORD_LENGTH, hash_password, hash_token, new_token, verify_password

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,63}$")
Connections = str | list[str]


def _connections(value: Connections | None) -> tuple[str, ...] | None:
    if value is None or value == "*":
        return None
    if isinstance(value, str):
        return parse_allowed(value) or ()
    return tuple(sorted({v.strip().lower() for v in value if v.strip()}))


def _password(value: str) -> str:
    if len(value) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"the password needs at least {MIN_PASSWORD_LENGTH} characters")
    return value


def _email(value: str | None) -> str | None:
    value = (value or "").strip()
    if value and not valid_email(value):
        raise ValueError(f"{value!r} is not an email address")
    return value or None


class UserIn(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(max_length=256)
    role: str = Field(default="user", pattern="^(user|admin)$")
    email: str | None = Field(default=None, max_length=254)
    connections: Connections = "*"
    groups: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("username")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip().lower()
        if not USERNAME_RE.match(v):
            raise ValueError("3-64 characters: letters, digits, dot, dash, underscore")
        return v

    _p = field_validator("password")(classmethod(lambda cls, v: _password(v)))
    _e = field_validator("email")(classmethod(lambda cls, v: _email(v)))


class UserPatch(BaseModel):
    role: str | None = Field(default=None, pattern="^(user|admin)$")
    is_active: bool | None = None
    email: str | None = Field(default=None, max_length=254)
    connections: Connections | None = None
    groups: list[str] | None = Field(default=None, max_length=100)
    password: str | None = Field(default=None, max_length=256)

    _p = field_validator("password")(classmethod(lambda cls, v: v if v is None else _password(v)))


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=2000)
    connections: Connections = ""
    members: list[str] = Field(default_factory=list, max_length=1000)


class RuleIn(BaseModel):
    group_id: int
    connection: str = Field(min_length=1, max_length=64)
    table: str = Field(min_length=1, max_length=255)
    column: str = Field(min_length=1, max_length=255)
    values: list[str] = Field(min_length=1, max_length=500)

    @field_validator("values")
    @classmethod
    def _values(cls, v: list[str]) -> list[str]:
        out = [x.strip() for x in v if x.strip()]
        if not out:
            raise ValueError("give at least one value")
        return out


class PasswordIn(BaseModel):
    current: str = Field(min_length=1, max_length=256)
    new: str = Field(max_length=256)

    _p = field_validator("new")(classmethod(lambda cls, v: _password(v)))


def register_admin_routes(
    app: FastAPI,
    *,
    app_db: AppDB,
    registry: ConnectionRegistry,
    rowsec: RowRules,
    session_ttl_hours: int,
    current_user: Callable[..., User],
    require_admin: Callable[..., User],
) -> None:
    router = APIRouter(tags=["admin"])

    def group_ids(names: list[str]) -> list[int]:
        by_name = {g["name"].lower(): g["id"] for g in app_db.list_groups()}
        out = []
        for n in names:
            gid = by_name.get(n.strip().lower())
            if gid is None:
                raise HTTPException(status_code=400, detail=f"Unknown group {n!r}")
            out.append(gid)
        return out

    def user_json(u: User, groups: dict[int, str]) -> dict[str, Any]:
        return {
            "id": u.id, "username": u.username, "role": u.role, "is_active": u.is_active, "email": u.email,
            "connections": "*" if u.allowed_connections is None else list(u.allowed_connections),
            "groups": [groups[g] for g in u.group_ids if g in groups],
            "effective_connections": sorted(k for k in registry.configs if u.can_use(k)),
            "row_rules": sum(1 for r in rowsec.all() if r.group_id in u.group_ids) if not u.is_admin else 0,
            "last_login_at": u.last_login_at,
        }

    def group_names() -> dict[int, str]:
        return {g["id"]: g["name"] for g in app_db.list_groups()}

    def active_admins() -> list[User]:
        return [u for u in app_db.list_users() if u.is_admin and u.is_active]

    # ------------------------------------------------------------------ users
    @router.get("/api/admin/users")
    def list_users(_admin: User = Depends(require_admin)):
        names = group_names()
        return {"users": [user_json(u, names) for u in app_db.list_users()]}

    @router.post("/api/admin/users")
    def create_user(body: UserIn, admin: User = Depends(require_admin)):
        gids = group_ids(body.groups)
        try:
            created = app_db.create_user(body.username, hash_password(body.password), body.role, _connections(body.connections))
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if body.email:
            app_db.update_user(created.username, email=body.email)
        app_db.set_user_groups(created.id, gids)
        app_db.audit(admin.username, "user_add", phrase=f"{created.username} ({body.role})", status="ok")
        return user_json(app_db.get_user(created.id), group_names())  # type: ignore[arg-type]

    @router.patch("/api/admin/users/{name}")
    def patch_user(name: str, body: UserPatch, admin: User = Depends(require_admin)):
        target = app_db.get_user_by_name(name.strip().lower())
        if target is None:
            raise HTTPException(status_code=404, detail="No such user")
        changes = body.model_dump(exclude_unset=True)
        demoting = changes.get("role") == "user" or changes.get("is_active") is False
        if demoting and target.is_admin and target.is_active and len(active_admins()) <= 1:
            raise HTTPException(status_code=400, detail="This is the last active admin: make someone else admin first")
        values: dict[str, Any] = {}
        if "role" in changes:
            values["role"] = changes["role"]
        if "is_active" in changes:
            values["is_active"] = changes["is_active"]
        if "email" in changes:
            try:
                values["email"] = _email(changes["email"])
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        if "connections" in changes:
            values["allowed_connections"] = format_allowed(_connections(changes["connections"]))
        if changes.get("password"):
            values["password_hash"] = hash_password(changes["password"])  # also signs them out everywhere
        if values:
            app_db.update_user(target.username, **values)
        if changes.get("groups") is not None:
            app_db.set_user_groups(target.id, group_ids(changes["groups"]))
        what = ", ".join(sorted(k if k != "password" else "password reset" for k in changes))
        app_db.audit(admin.username, "user_edit", phrase=f"{target.username}: {what}"[:200], status="ok")
        return user_json(app_db.get_user(target.id), group_names())  # type: ignore[arg-type]

    @router.delete("/api/admin/users/{name}")
    def delete_user(name: str, admin: User = Depends(require_admin)):
        target = app_db.get_user_by_name(name.strip().lower())
        if target is None:
            raise HTTPException(status_code=404, detail="No such user")
        if target.id == admin.id:
            raise HTTPException(status_code=400, detail="You cannot delete yourself")
        if target.is_admin and target.is_active and len(active_admins()) <= 1:
            raise HTTPException(status_code=400, detail="This is the last active admin")
        app_db.delete_user(target.username)
        app_db.audit(admin.username, "user_delete", phrase=target.username, status="ok")
        return {"deleted": target.username}

    # ------------------------------------------------------------------ groups
    def member_ids(names: list[str]) -> list[int]:
        out = []
        for n in names:
            u = app_db.get_user_by_name(n.strip().lower())
            if u is None:
                raise HTTPException(status_code=400, detail=f"Unknown user {n!r}")
            out.append(u.id)
        return out

    @router.get("/api/admin/groups")
    def list_groups(_admin: User = Depends(require_admin)):
        rules = rowsec.all()
        return {"groups": [{**g, "row_rules": sum(1 for r in rules if r.group_id == g["id"])} for g in app_db.list_groups()]}

    def save_group(gid: int | None, body: GroupIn, admin: User) -> dict[str, Any]:
        members = member_ids(body.members)
        try:
            gid = app_db.save_group(gid, body.name.strip(), body.description, _connections(body.connections))
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except KeyError:
            raise HTTPException(status_code=404, detail="No such group") from None
        app_db.set_group_members(gid, members)
        app_db.audit(admin.username, "group_save", phrase=f"{body.name}: {len(members)} members", status="ok")
        return app_db.get_group(gid)  # type: ignore[return-value]

    @router.post("/api/admin/groups")
    def create_group(body: GroupIn, admin: User = Depends(require_admin)):
        return save_group(None, body, admin)

    @router.put("/api/admin/groups/{gid}")
    def update_group(gid: int, body: GroupIn, admin: User = Depends(require_admin)):
        return save_group(gid, body, admin)

    @router.delete("/api/admin/groups/{gid}")
    def delete_group(gid: int, admin: User = Depends(require_admin)):
        if not app_db.delete_group(gid):
            raise HTTPException(status_code=404, detail="No such group")
        rowsec.forget_group()
        app_db.audit(admin.username, "group_delete", phrase=f"group {gid}", status="ok")
        return {"deleted": gid}

    # ------------------------------------------------------------------ row-level security
    @router.get("/api/admin/row-rules")
    def list_rules(_admin: User = Depends(require_admin)):
        names = group_names()
        return {"rules": [r.json(names.get(r.group_id)) for r in rowsec.all()]}

    @router.post("/api/admin/row-rules")
    def add_rule(body: RuleIn, admin: User = Depends(require_admin)):
        if body.connection not in registry.configs:
            raise HTTPException(status_code=404, detail=f"Unknown connection {body.connection!r}")
        tables = registry.get_schema(body.connection)
        table = next((t for t in tables if t.lower() == body.table.lower()), None)
        if table is None:
            raise HTTPException(status_code=400, detail=f"Unknown table {body.table!r}")
        column = next((c["name"] for c in tables[table] if c["name"].lower() == body.column.lower()), None)
        if column is None:
            raise HTTPException(status_code=400, detail=f"{table} has no column {body.column!r}")
        try:
            rid = rowsec.add(body.group_id, body.connection, table, column, body.values, admin.username)
        except KeyError:
            raise HTTPException(status_code=404, detail="No such group") from None
        app_db.audit(admin.username, "row_rule_add", connection=body.connection,
                     phrase=f"group {body.group_id}: {table}.{column} in {body.values}"[:200], status="ok")
        rule = next(r for r in rowsec.all() if r.id == rid)
        return rule.json(group_names().get(rule.group_id))

    @router.delete("/api/admin/row-rules/{rid}")
    def delete_rule(rid: int, admin: User = Depends(require_admin)):
        if not rowsec.remove(rid):
            raise HTTPException(status_code=404, detail="No such rule")
        app_db.audit(admin.username, "row_rule_delete", phrase=f"rule {rid}", status="ok")
        return {"deleted": rid}

    # ------------------------------------------------------------------ own password
    @router.put("/api/account/password")
    def change_password(body: PasswordIn, user: User = Depends(current_user)):
        if user.id == 0:
            raise HTTPException(status_code=400, detail="Sign-in is turned off")
        stored = app_db.get_user_by_name(user.username)
        if stored is None or not verify_password(body.current, stored.password_hash):
            raise HTTPException(status_code=403, detail="The current password is wrong")
        app_db.update_user(user.username, password_hash=hash_password(body.new))  # signs out every session
        token = new_token()
        expires_at = app_db.create_session(user.id, hash_token(token), session_ttl_hours * 3600)
        app_db.audit(user.username, "password_change", status="ok")
        return {"token": token, "expires_at": expires_at, "changed_at": time.time()}

    app.include_router(router)
