"""Usage analytics and the slow-query log for admins (roadmap M8), read from the audit log.

    GET /api/admin/usage?days=30                         totals, per day, top people / questions / dashboards
    GET /api/admin/query-log?kind=slow|errors&days=7     the slowest or failed queries, newest first

Every query is already in the audit log (who, what, how long, how it ended);
nothing extra is recorded. Runs from subscriptions, public links and embeds are
told apart by the run's options and the name it ran under ("public#3:mark").
"""

from __future__ import annotations

import time
from typing import Any, Callable

from fastapi import APIRouter, Depends, FastAPI, Query
from sqlalchemy import text

from .appdb import AppDB, User
from .config import Settings

QUERY_ACTIONS = ("query", "sql", "federated", "profile", "xray")
_IN = ", ".join(f"'{a}'" for a in QUERY_ACTIONS)
_JSON = "CASE WHEN json_valid(options) THEN json_extract(options, '$.{key}') END"


def _source() -> str:
    return (
        "CASE WHEN username LIKE 'public#%' THEN 'public link' "
        "WHEN username LIKE 'embed#%' THEN 'embed' "
        f"WHEN {_JSON.format(key='subscription_id')} IS NOT NULL THEN 'subscription' "
        f"WHEN {_JSON.format(key='dashboard_id')} IS NOT NULL THEN 'dashboard' "
        f"WHEN {_JSON.format(key='question_id')} IS NOT NULL THEN 'saved question' "
        "ELSE 'editor' END"
    )


def register_usage_routes(app: FastAPI, *, app_db: AppDB, settings: Settings, require_admin: Callable[..., User]) -> None:
    router = APIRouter(prefix="/api/admin", tags=["admin"])

    def rows(sql: str, **params: Any) -> list[dict[str, Any]]:
        with app_db.engine.connect() as conn:
            return [dict(r._mapping) for r in conn.execute(text(sql), params)]

    def names(table: str, ids: list[Any]) -> dict[int, str]:
        clean = sorted({int(i) for i in ids if isinstance(i, (int, float)) or (isinstance(i, str) and i.isdigit())})
        if not clean:
            return {}
        found = rows(f"SELECT id, name FROM {table} WHERE id IN ({', '.join(str(i) for i in clean)})")
        return {r["id"]: r["name"] for r in found}

    @router.get("/usage")
    def usage(days: int = Query(30, ge=1, le=366), _admin: User = Depends(require_admin)):
        since = time.time() - days * 86400
        where = f"ts >= :since AND action IN ({_IN})"
        totals = rows(
            f"SELECT COUNT(*) AS queries, COUNT(DISTINCT username) AS people, "
            f"SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors, "
            f"SUM(CASE WHEN duration_sec >= :slow THEN 1 ELSE 0 END) AS slow, "
            f"AVG(duration_sec) AS avg_sec FROM audit_log WHERE {where}", since=since, slow=settings.slow_query_sec,
        )[0]
        per_day = rows(
            f"SELECT date(ts, 'unixepoch', 'localtime') AS day, COUNT(*) AS queries, "
            f"SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors, COUNT(DISTINCT username) AS people "
            f"FROM audit_log WHERE {where} GROUP BY day ORDER BY day", since=since,
        )
        people = rows(
            f"SELECT username, COUNT(*) AS queries, AVG(duration_sec) AS avg_sec, MAX(ts) AS last_seen "
            f"FROM audit_log WHERE {where} GROUP BY username ORDER BY queries DESC LIMIT 15", since=since,
        )
        qid = _JSON.format(key="question_id")
        questions = rows(
            f"SELECT {qid} AS id, COUNT(*) AS runs, AVG(duration_sec) AS avg_sec, "
            f"SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors "
            f"FROM audit_log WHERE {where} AND {qid} IS NOT NULL GROUP BY 1 ORDER BY runs DESC LIMIT 15", since=since,
        )
        did = _JSON.format(key="dashboard_id")
        dashboards = rows(
            f"SELECT {did} AS id, COUNT(*) AS card_runs, COUNT(DISTINCT username) AS people "
            f"FROM audit_log WHERE {where} AND {did} IS NOT NULL GROUP BY 1 ORDER BY card_runs DESC LIMIT 15", since=since,
        )
        qn, dn = names("questions", [q["id"] for q in questions]), names("dashboards", [d["id"] for d in dashboards])
        for q in questions:
            q["name"] = qn.get(int(q["id"])) if q["id"] is not None else None
        for d in dashboards:
            d["name"] = dn.get(int(d["id"])) if d["id"] is not None else None
        sources = rows(f"SELECT {_source()} AS source, COUNT(*) AS queries FROM audit_log WHERE {where} GROUP BY 1 ORDER BY 2 DESC", since=since)
        logins = rows("SELECT COUNT(*) AS n, COUNT(DISTINCT username) AS people FROM audit_log WHERE ts >= :since AND action = 'login'", since=since)[0]
        return {
            "days": days, "since": since, "slow_query_sec": settings.slow_query_sec,
            "totals": {**totals, "logins": logins["n"], "people_signed_in": logins["people"]},
            "per_day": per_day, "people": people, "questions": questions, "dashboards": dashboards, "sources": sources,
        }

    @router.get("/query-log")
    def query_log(
        kind: str = Query("slow", pattern="^(slow|errors)$"),
        days: int = Query(7, ge=1, le=366),
        min_sec: float | None = Query(None, ge=0),
        limit: int = Query(100, ge=1, le=500),
        _admin: User = Depends(require_admin),
    ):
        since = time.time() - days * 86400
        if kind == "slow":
            cond, order = "duration_sec >= :min_sec", "duration_sec DESC"
        else:
            cond, order = "status = 'error'", "ts DESC"
        found = rows(
            f"SELECT id, ts, username, action, connection, phrase AS sql, duration_sec, status, found AS rows, "
            f"{_JSON.format(key='question_id')} AS question_id, {_JSON.format(key='dashboard_id')} AS dashboard_id, "
            f"{_source()} AS source "
            f"FROM audit_log WHERE ts >= :since AND action IN ({_IN}) AND {cond} ORDER BY {order} LIMIT :limit",
            since=since, min_sec=settings.slow_query_sec if min_sec is None else min_sec, limit=limit,
        )
        qn = names("questions", [r["question_id"] for r in found])
        dn = names("dashboards", [r["dashboard_id"] for r in found])
        for r in found:
            r["question_name"] = qn.get(int(r["question_id"])) if r["question_id"] is not None else None
            r["dashboard_name"] = dn.get(int(r["dashboard_id"])) if r["dashboard_id"] is not None else None
        return {"kind": kind, "days": days, "min_sec": settings.slow_query_sec if min_sec is None else min_sec, "queries": found}

    app.include_router(router)
