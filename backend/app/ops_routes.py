"""Operations for admins (roadmap M9): the audit log, backups, health and metrics.

    GET    /api/admin/audit?user=&action=&connection=&status=&q=&since=&until=&limit=&offset=
    GET    /api/admin/audit.csv                 the same filters, as a CSV file (up to 50,000 entries)
    GET    /api/admin/backups                   POST: make one now
    GET    /api/admin/backups/{name}            download;  DELETE removes it
    GET    /api/health                          liveness (no sign-in)
    GET    /api/health/ready                    app database, scheduler, disk, last backup (no sign-in; 503 if not ready)
    GET    /metrics                             Prometheus format; admins, or "Authorization: Bearer $NCODE_METRICS_TOKEN"
"""

from __future__ import annotations

import csv
import hmac
import io
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, PlainTextResponse, Response
from sqlalchemy import and_, func, or_, select, text

from .appdb import AppDB, User, audit_table, sessions_table, users_table
from .backup import BackupError, backup_path, list_backups, make_backup
from .metrics import Metrics

MAX_AUDIT_EXPORT = 50_000


def register_ops_routes(
    app: FastAPI,
    *,
    app_db: AppDB,
    metrics: Metrics,
    metrics_token: str,
    scheduler: Any,
    current_user_optional: Callable[..., User | None],
    require_admin: Callable[..., User],
) -> None:
    router = APIRouter(tags=["operations"])
    db_path: Path = app_db.path

    # ------------------------------------------------------------------ audit
    def audit_where(user: str | None, action: str | None, connection: str | None, status: str | None,
                    q: str | None, since: float | None, until: float | None) -> Any:
        t = audit_table.c
        conds = []
        if user:
            conds.append(t.username == user)
        if action:
            conds.append(t.action == action)
        if connection:
            conds.append(t.connection == connection)
        if status:
            conds.append(t.status == status)
        if since is not None:
            conds.append(t.ts >= since)
        if until is not None:
            conds.append(t.ts < until)
        if q:
            escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")  # typed text, not wildcards
            like = f"%{escaped}%"
            conds.append(or_(*(c.like(like, escape="\\") for c in (t.phrase, t.options, t.username))))
        return and_(*conds) if conds else None

    def entry(r: Any) -> dict[str, Any]:
        return {"id": r.id, "ts": r.ts, "username": r.username, "action": r.action, "connection": r.connection,
                "phrase": r.phrase, "status": r.status, "found": r.found, "error_count": r.error_count,
                "duration_sec": r.duration_sec, "options": (r.options or "")[:2000]}

    Filters = dict(
        user=Query(None, max_length=64), action=Query(None, max_length=32), connection=Query(None, max_length=64),
        status=Query(None, max_length=16), q=Query(None, max_length=200), since=Query(None), until=Query(None),
    )

    @router.get("/api/admin/audit")
    def audit(
        user: str | None = Filters["user"], action: str | None = Filters["action"], connection: str | None = Filters["connection"],
        status: str | None = Filters["status"], q: str | None = Filters["q"], since: float | None = Filters["since"],
        until: float | None = Filters["until"], limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0),
        _admin: User = Depends(require_admin),
    ):
        where = audit_where(user, action, connection, status, q, since, until)
        stmt = select(audit_table).order_by(audit_table.c.id.desc()).limit(limit).offset(offset)
        count = select(func.count()).select_from(audit_table)
        if where is not None:
            stmt, count = stmt.where(where), count.where(where)
        with app_db.engine.connect() as conn:
            rows = conn.execute(stmt).all()
            total = conn.execute(count).scalar_one()
            actions = [r[0] for r in conn.execute(select(audit_table.c.action).distinct().order_by(audit_table.c.action))]
            users = [r[0] for r in conn.execute(select(audit_table.c.username).distinct().order_by(audit_table.c.username)) if r[0]]
        return {"entries": [entry(r) for r in rows], "total": total, "actions": actions, "users": users}

    @router.get("/api/admin/audit.csv")
    def audit_csv(
        user: str | None = Filters["user"], action: str | None = Filters["action"], connection: str | None = Filters["connection"],
        status: str | None = Filters["status"], q: str | None = Filters["q"], since: float | None = Filters["since"],
        until: float | None = Filters["until"], admin: User = Depends(require_admin),
    ):
        where = audit_where(user, action, connection, status, q, since, until)
        stmt = select(audit_table).order_by(audit_table.c.id.desc()).limit(MAX_AUDIT_EXPORT)
        if where is not None:
            stmt = stmt.where(where)
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
        w.writerow(["time", "user", "action", "connection", "what", "status", "rows", "errors", "seconds"])
        with app_db.engine.connect() as conn:
            for r in conn.execute(stmt):
                w.writerow([datetime.fromtimestamp(r.ts).isoformat(sep=" ", timespec="seconds"), r.username, r.action,
                            r.connection, _cell(r.phrase), r.status, r.found, r.error_count,
                            "" if r.duration_sec is None else round(r.duration_sec, 3)])
        app_db.audit(admin.username, "audit_export", status="ok")
        return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="ncode-audit.csv"'})

    # ------------------------------------------------------------------ backups
    @router.get("/api/admin/backups")
    def backups(_admin: User = Depends(require_admin)):
        free = shutil.disk_usage(db_path.parent).free
        return {"backups": list_backups(db_path), "folder": str(db_path.parent / "backups"), "disk_free": free}

    @router.post("/api/admin/backups")
    def backup_now(admin: User = Depends(require_admin)):
        try:
            made = make_backup(db_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"The backup failed: {exc}") from exc
        app_db.audit(admin.username, "backup", phrase=made.name, status="ok")
        return next(b for b in list_backups(db_path) if b["name"] == made.name)

    @router.get("/api/admin/backups/{name}")
    def download(name: str, admin: User = Depends(require_admin)):
        try:
            path = backup_path(db_path, name)
        except BackupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        app_db.audit(admin.username, "backup_download", phrase=name, status="ok")
        return FileResponse(path, media_type="application/zip", filename=name)

    @router.delete("/api/admin/backups/{name}")
    def delete_backup(name: str, admin: User = Depends(require_admin)):
        try:
            backup_path(db_path, name).unlink()
        except BackupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        app_db.audit(admin.username, "backup_delete", phrase=name, status="ok")
        return {"deleted": name}

    # ------------------------------------------------------------------ health and metrics
    @router.get("/api/health/ready")
    def ready():
        checks: dict[str, Any] = {}
        ok = True
        try:
            with app_db.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            checks["app_db"] = "ok"
        except Exception as exc:  # noqa: BLE001 - reported, not raised
            checks["app_db"] = f"error: {exc.__class__.__name__}"
            ok = False
        checks["scheduler"] = "running" if scheduler.alive() else "off"
        checks["disk_free_mb"] = shutil.disk_usage(db_path.parent).free // (1024 * 1024)
        autos = [b for b in list_backups(db_path)]
        checks["last_backup_at"] = autos[0]["created_at"] if autos else None
        body = {"status": "ok" if ok else "error", "checks": checks, "uptime_sec": round(time.time() - metrics.started)}
        return Response(content=_json(body), status_code=200 if ok else 503, media_type="application/json")

    @router.get("/metrics")
    def prometheus(request: Request, user: User | None = Depends(current_user_optional)):
        auth = request.headers.get("authorization", "")
        token_ok = bool(metrics_token) and hmac.compare_digest(auth, f"Bearer {metrics_token}")
        if not token_ok and not (user is not None and user.is_admin):
            raise HTTPException(status_code=401 if user is None else 403, detail="Admins only, or the metrics token")
        return PlainTextResponse(metrics.render(), media_type="text/plain; version=0.0.4")

    # gauges read at scrape time
    metrics.gauge("ncode_users", "Active users", lambda: _scalar(app_db, select(func.count()).select_from(users_table).where(users_table.c.is_active.is_(True))))
    metrics.gauge("ncode_sessions", "Signed-in sessions", lambda: _scalar(app_db, select(func.count()).select_from(sessions_table).where(sessions_table.c.expires_at > time.time())))
    metrics.gauge("ncode_app_db_bytes", "Size of Ncode's own database", lambda: float(db_path.stat().st_size))
    metrics.gauge("ncode_uptime_seconds", "Seconds since the backend started", lambda: time.time() - metrics.started)
    metrics.gauge("ncode_last_backup_age_seconds", "Seconds since the newest backup",
                  lambda: (time.time() - list_backups(db_path)[0]["created_at"]) if list_backups(db_path) else None)

    app.include_router(router)


def _scalar(app_db: AppDB, stmt: Any) -> float:
    with app_db.engine.connect() as conn:
        return float(conn.execute(stmt).scalar_one())


def _cell(value: Any) -> Any:
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def _json(body: dict[str, Any]) -> str:
    import json

    return json.dumps(body)
