"""Ncode API (routes). Use create_app() to build the FastAPI application.

    POST   /api/auth/login              {username, password} -> {token, expires_at, user}
    POST   /api/auth/logout
    GET    /api/auth/me
    GET    /api/health
    GET    /api/connections             (only the ones the user may use)
    GET    /api/engines                 database types + whether their driver is installed
    POST   /api/connections             (admin) add a database from the UI
    POST   /api/connections/test-draft  (admin) try settings before saving
    GET    /api/connections/{key}/details   (admin)
    PUT    /api/connections/{key}       (admin)
    DELETE /api/connections/{key}       (admin)
    POST   /api/connections/{key}/test
    GET    /api/connections/{key}/tables?refresh=false
    GET    /api/connections/{key}/schema?refresh=false   tables, typed columns, keys, relationships
    GET    /api/connections/{key}/browse?table=...   paged rows, optional filter (q, mode ...)
    GET    /api/connections/{key}/structure?table=...
    GET    /api/connections/{key}/export?table=...   CSV stream (all rows or only matches)
    GET    /api/limits
    POST   /api/query, /api/query/compile, /api/query/sql, /api/query/sql/check, /api/query/tasks/{id}
                                        questions and SQL mode, see app/query/routes.py
    POST   /api/search                  -> {"task_id": ...}
    GET    /api/search/{task_id}        -> progress (+ results when finished)
    DELETE /api/search/{task_id}        -> cancel
    WS     /ws/{task_id}                first client message: {"token": "..."}

Send the token as `Authorization: Bearer <token>`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from contextlib import asynccontextmanager
from dataclasses import replace
from typing import Any
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from .appdb import ANONYMOUS, AppDB, User
from .config import ENGINES, ConnectionConfig, Settings, driver_available, normalize_engine
from .crypto import CipherError
from .db import ConnectionRegistry, describe_error, probe
from .explore import browse_table, csv_stream, table_structure
from .content.routes import register_content_routes
from .query.routes import register_query_routes
from .analysis.routes import register_analysis_routes
from .automation.engine import Engine as AutomationEngine
from .automation.routes import register_automation_routes
from .automation.scheduler import Scheduler
from .automation.settings import SettingsStore
from .automation.store import SubscriptionStore
from .sharing.routes import register_sharing_routes
from .usage import register_usage_routes
from .admin_routes import register_admin_routes
from .backup import AutoBackup
from .metrics import Metrics
from .ops_routes import register_ops_routes
from .semantic.routes import register_semantic_routes, schema_extras
from .semantic.store import SemanticStore
from .query.runner import QueryRunner
from .rowsec import RowRules, RowSecurityError
from .schema_graph import describe_schema
from .models import ConnectionDetails, ConnectionInfo, ConnectionPayload, EngineOption, MatchMode, SearchRequest
from .search import SearchOptions, classify_type, start_search_thread
from .security import LoginThrottle, hash_password, hash_token, new_token, verify_password
from .tasks import SearchTask, TaskStore

logger = logging.getLogger("ncode.api")

# Used to spend the same time on unknown usernames as on real ones.
_DUMMY_HASH = hash_password("not-a-real-password")


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


def create_app(settings: Settings, connections: dict[str, ConnectionConfig], app_db: AppDB) -> FastAPI:
    registry = ConnectionRegistry(connections, settings)
    for stored in app_db.list_connections():
        if stored.key in connections:  # a .env definition always wins
            logger.warning("UI connection %r ignored: the same key is defined in .env", stored.key)
            continue
        registry.set_config(stored)
    store = TaskStore(ttl_sec=settings.task_ttl_sec)
    runner = QueryRunner(
        workers=settings.query_workers,
        timeout_sec=settings.statement_timeout_sec,
        cache_ttl_sec=settings.query_cache_ttl_sec,
    )
    throttle = LoginThrottle(settings.login_max_failures, settings.login_lock_sec)
    semantic = SemanticStore(app_db.engine)
    rowsec = RowRules(app_db.engine)
    settings_store = SettingsStore(app_db.engine, app_db.cipher)
    subscriptions = SubscriptionStore(app_db.engine)
    automation = AutomationEngine(
        app_db=app_db, settings_store=settings_store, subs=subscriptions, runner=runner,
        content=lambda: app.state.content, statement_timeout_sec=settings.statement_timeout_sec,
    )
    scheduler = Scheduler(automation, subscriptions, interval_sec=settings.scheduler_interval_sec, workers=settings.scheduler_workers)
    scheduler.chores.append(AutoBackup(app_db.path, settings.backup_hour, settings.backup_keep).tick)
    metrics = Metrics()
    bearer = HTTPBearer(auto_error=False)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if not settings.auth_enabled:
            logger.warning("AUTHENTICATION IS DISABLED - anyone who can reach this server can search your databases.")
        elif app_db.user_count() == 0:
            logger.warning(
                "No users exist yet. Create the first admin with:  python -m app.manage create-user <name> --admin"
            )
        if settings.scheduler_enabled:
            scheduler.start()
        yield
        scheduler.stop()
        runner.shutdown()
        registry.dispose_all()
        app_db.dispose()

    app = FastAPI(title="Ncode", version="0.3.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["*"],
        expose_headers=["Retry-After"],  # lets the login screen show the lockout countdown
    )

    @app.middleware("http")
    async def count_requests(request: Request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        route = request.scope.get("route")
        path = getattr(route, "path", None) or "unmatched"  # the template (/api/questions/{qid}), never ids
        if path.startswith("/api") or path == "/metrics":
            labels = {"method": request.method, "route": path, "status": f"{response.status_code // 100}xx"}
            metrics.counter("ncode_http_requests_total", "HTTP requests", **labels)
            metrics.observe("ncode_http_request_seconds", "HTTP request duration", time.perf_counter() - started,
                            method=request.method, route=path)
        return response

    # ------------------------------------------------------------------
    # auth helpers
    # ------------------------------------------------------------------
    def user_from_token(token: str | None) -> User | None:
        if not settings.auth_enabled:
            return ANONYMOUS
        if not token:
            return None
        return app_db.user_for_token(hash_token(token))

    def current_user_optional(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> User | None:
        return user_from_token(creds.credentials if creds else None)

    def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> User:
        user = user_from_token(creds.credentials if creds else None)
        if user is None:
            raise HTTPException(status_code=401, detail="Not authenticated", headers={"WWW-Authenticate": "Bearer"})
        return user

    def require_connection(key: str, user: User) -> None:
        # Same 404 for "doesn't exist" and "not allowed": don't reveal hidden databases.
        if key not in registry.configs or not user.can_use(key):
            raise HTTPException(status_code=404, detail=f"Unknown connection {key!r}")

    def can_access_task(user: User, task: SearchTask) -> bool:
        return user.is_admin or task.owner == user.username

    def rows_for(user: User, key: str, table: str, columns: list) -> Any:
        try:
            return rowsec.where(user, key, table, columns)
        except RowSecurityError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc

    def get_task_or_404(task_id: str, user: User) -> SearchTask:
        task = store.get(task_id)
        if task is None or not can_access_task(user, task):
            raise HTTPException(status_code=404, detail="Unknown or expired task")
        return task

    # ------------------------------------------------------------------
    # auth endpoints
    # ------------------------------------------------------------------
    @app.post("/api/auth/login")
    def login(payload: LoginRequest, request: Request):
        if not settings.auth_enabled:
            raise HTTPException(status_code=400, detail="Authentication is disabled")
        username = payload.username.strip().lower()
        ip = request.client.host if request.client else "unknown"
        throttle_key = f"{username}|{ip}"

        wait = throttle.locked_for(throttle_key)
        if wait:
            raise HTTPException(status_code=429, detail="Too many failed attempts", headers={"Retry-After": str(wait)})

        user = app_db.get_user_by_name(username)
        password_ok = verify_password(payload.password, user.password_hash if user else _DUMMY_HASH)
        if user is None or not password_ok or not user.is_active:
            throttle.fail(throttle_key)
            app_db.audit(username, "login_failed", status="denied")
            raise HTTPException(status_code=401, detail="Invalid username or password")

        throttle.success(throttle_key)
        app_db.update_user(user.username, last_login_at=time.time())
        token = new_token()
        expires_at = app_db.create_session(user.id, hash_token(token), settings.session_ttl_hours * 3600)
        app_db.audit(user.username, "login", status="ok")
        return {
            "token": token,
            "expires_at": expires_at,
            "user": {"username": user.username, "role": user.role},
        }

    @app.post("/api/auth/logout")
    def logout(creds: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if creds and settings.auth_enabled:
            app_db.delete_session(hash_token(creds.credentials))
        return {"ok": True}

    @app.get("/api/auth/me")
    def me(user: User = Depends(current_user)):
        return {"username": user.username, "role": user.role, "email": user.email}

    # ------------------------------------------------------------------
    # connections
    # ------------------------------------------------------------------
    def require_admin(user: User = Depends(current_user)) -> User:
        if not user.is_admin:
            raise HTTPException(status_code=403, detail="Only an administrator can do this")
        return user

    def details_of(cfg: ConnectionConfig, user: User) -> ConnectionDetails:
        return ConnectionDetails(
            key=cfg.key,
            label=cfg.label,
            engine=cfg.engine,
            host=cfg.host,
            port=cfg.port,
            username=cfg.user,
            has_password=bool(cfg.password),
            database=cfg.database,
            schema_name=cfg.schema,
            id_hints=list(cfg.id_hints),
            source=cfg.source,
            editable=user.is_admin and cfg.source == "ui",
        )

    def slugify(label: str) -> str:
        base = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:40] or "db"
        if base[0].isdigit():
            base = f"db_{base}"
        existing = registry.configs
        key, n = base, 2
        while key in existing:
            key = f"{base}_{n}"
            n += 1
        return key

    def validate_sqlite_path(raw: str) -> None:
        path = Path(raw).expanduser()
        if not path.is_file():
            raise HTTPException(status_code=400, detail=f"File not found on the server: {raw}")
        try:
            if path.resolve() == app_db.path.resolve():
                raise HTTPException(status_code=400, detail="Ncode's own database cannot be connected")
            with open(path, "rb") as handle:
                header = handle.read(16)
        except OSError as exc:
            raise HTTPException(status_code=400, detail=f"Cannot read the file: {exc.strerror or exc}") from exc
        if header != b"SQLite format 3\x00":
            raise HTTPException(status_code=400, detail="This is not a SQLite file")

    def build_config(payload: ConnectionPayload, key: str) -> ConnectionConfig:
        """Validate the form and build a config (without a password)."""
        engine = normalize_engine(payload.engine)
        info = ENGINES.get(engine)
        if info is None:
            raise HTTPException(status_code=400, detail=f"Unknown database type: {payload.engine}")
        host = (payload.host or "").strip() or None
        if info.file_based:
            validate_sqlite_path(payload.database)
        elif not host:
            raise HTTPException(status_code=400, detail="Enter the server address (host)")
        return ConnectionConfig(
            key=key,
            label=payload.label,
            engine=engine,
            database=payload.database,
            host=None if info.file_based else host,
            port=None if info.file_based else (payload.port or info.default_port),
            user=(payload.username or "").strip() or None,
            password=None,
            schema=(payload.schema_name or "").strip() or None,
            id_hints=tuple(h.strip().lower() for h in payload.id_hints if h.strip()),
            source="ui",
        )

    def same_target(a: ConnectionConfig, b: ConnectionConfig) -> bool:
        """A saved password may only be reused for the same server, port and user."""
        return (a.engine, a.host, a.port, a.user) == (b.engine, b.host, b.port, b.user)

    def ensure_driver(engine: str) -> None:
        if not driver_available(engine):
            info = ENGINES[engine]
            raise HTTPException(
                status_code=400,
                detail=f"The driver for {info.label} is not installed. Run on the server: pip install {info.pip} "
                "— then restart the backend.",
            )

    def get_ui_connection(key: str) -> ConnectionConfig:
        cfg = registry.configs.get(key)
        if cfg is None:
            raise HTTPException(status_code=404, detail=f"Unknown connection {key!r}")
        if cfg.source != "ui":
            raise HTTPException(
                status_code=400, detail="This connection is defined in the .env file — it can only be changed there"
            )
        return cfg

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/engines", response_model=list[EngineOption])
    def list_engines(_user: User = Depends(current_user)):
        return [
            EngineOption(
                name=i.name,
                label=i.label,
                default_port=i.default_port,
                available=driver_available(i.name),
                pip=i.pip,
                file_based=i.file_based,
            )
            for i in ENGINES.values()
        ]

    @app.get("/api/connections", response_model=list[ConnectionInfo])
    def list_connections(user: User = Depends(current_user)):
        # Host, user and password are never exposed here.
        return [
            ConnectionInfo(
                key=c.key,
                label=c.label,
                engine=c.engine,
                database=c.database,
                id_hints=list(c.id_hints),
                source=c.source,
                editable=user.is_admin and c.source == "ui",
            )
            for c in sorted(registry.configs.values(), key=lambda c: c.label.lower())
            if user.can_use(c.key)
        ]

    @app.post("/api/connections/test-draft")
    def test_draft(payload: ConnectionPayload, _admin: User = Depends(require_admin)):
        """Try a connection that has not been saved yet (the 'Check connection' button)."""
        try:
            cfg = build_config(payload, "draft")
        except HTTPException as exc:
            return {"ok": False, "error": exc.detail}
        password = payload.password or None
        existing = registry.configs.get(payload.key) if payload.key else None
        if not password and existing is not None and existing.source == "ui" and same_target(existing, cfg):
            password = existing.password
        try:
            tables = probe(replace(cfg, password=password), settings)
        except Exception as exc:
            return {"ok": False, "error": describe_error(exc, cfg.engine)}
        return {"ok": True, "tables": tables}

    @app.post("/api/connections", response_model=ConnectionDetails, status_code=201)
    def create_connection(payload: ConnectionPayload, admin: User = Depends(require_admin)):
        cfg = replace(build_config(payload, slugify(payload.label)), password=payload.password or None)
        ensure_driver(cfg.engine)
        try:
            saved = app_db.save_connection(cfg, admin.username)
        except CipherError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        registry.set_config(saved)
        app_db.audit(admin.username, "connection_add", connection=saved.key, status="ok")
        return details_of(saved, admin)

    @app.get("/api/connections/{key}/details", response_model=ConnectionDetails)
    def connection_details(key: str, admin: User = Depends(require_admin)):
        cfg = registry.configs.get(key)
        if cfg is None:
            raise HTTPException(status_code=404, detail=f"Unknown connection {key!r}")
        return details_of(cfg, admin)

    @app.put("/api/connections/{key}", response_model=ConnectionDetails)
    def update_connection(key: str, payload: ConnectionPayload, admin: User = Depends(require_admin)):
        existing = get_ui_connection(key)
        draft = build_config(payload, key)
        password = payload.password or None
        if not password:
            if same_target(existing, draft):
                password = existing.password
            elif not ENGINES[draft.engine].file_based:
                raise HTTPException(
                    status_code=400, detail="When changing the server, port or user, enter the password again"
                )
        cfg = replace(draft, password=password)
        ensure_driver(cfg.engine)
        try:
            found = app_db.update_connection(cfg)
        except CipherError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if not found:
            raise HTTPException(status_code=404, detail=f"Unknown connection {key!r}")
        registry.set_config(cfg)
        runner.cache.drop_connection(key)
        app_db.audit(admin.username, "connection_edit", connection=key, status="ok")
        return details_of(cfg, admin)

    @app.delete("/api/connections/{key}")
    def delete_connection(key: str, admin: User = Depends(require_admin)):
        get_ui_connection(key)
        app_db.delete_connection(key)
        registry.remove(key)
        runner.cache.drop_connection(key)
        app_db.audit(admin.username, "connection_delete", connection=key, status="ok")
        return {"ok": True}

    @app.post("/api/connections/{key}/test")
    def test_connection(key: str, user: User = Depends(current_user)):
        require_connection(key, user)
        try:
            registry.test(key)
        except Exception as exc:
            return {"ok": False, "error": describe_error(exc, registry.get_config(key).engine)}
        return {"ok": True}

    @app.get("/api/connections/{key}/tables")
    def list_tables(key: str, refresh: bool = Query(False), user: User = Depends(current_user)):
        require_connection(key, user)
        try:
            schema = registry.get_schema(key, refresh=refresh)
        except Exception as exc:
            detail = describe_error(exc, registry.get_config(key).engine)
            raise HTTPException(status_code=502, detail=f"Could not read the database structure: {detail}") from exc
        return {
            "tables": [
                {
                    "name": name,
                    "columns": len(cols),
                    # columns that a text search can look into
                    "searchable": sum(1 for c in cols if classify_type(c["type"]) == "text"),
                }
                for name, cols in sorted(schema.items(), key=lambda item: item[0].lower())
            ]
        }

    @app.get("/api/connections/{key}/schema")
    def schema_v2(key: str, refresh: bool = Query(False), user: User = Depends(current_user)):
        """Schema v2: every table with typed columns, primary keys, foreign keys and relationships."""
        require_connection(key, user)
        try:
            columns = registry.get_schema(key, refresh=refresh)
            primary, foreign = registry.get_keys(key, refresh=refresh)
        except Exception as exc:
            detail = describe_error(exc, registry.get_config(key).engine)
            raise HTTPException(status_code=502, detail=f"Could not read the database structure: {detail}") from exc
        return {"connection": key, **describe_schema(columns, primary, foreign, **schema_extras(semantic, key))}

    # ------------------------------------------------------------------
    # explorer: browse one table, see its structure, export it
    # ------------------------------------------------------------------
    def resolve_table(key: str, table: str) -> tuple[str, list]:
        """Map the requested name to a real table (from the cached schema, never raw input)."""
        try:
            schema_map = registry.get_schema(key)
        except Exception as exc:
            detail = describe_error(exc, registry.get_config(key).engine)
            raise HTTPException(status_code=502, detail=f"Could not read the database structure: {detail}") from exc
        if table in schema_map:
            return table, schema_map[table]
        lowered = {name.lower(): name for name in schema_map}
        real = lowered.get(table.lower())
        if real is None:
            raise HTTPException(status_code=404, detail=f"Unknown table {table!r}")
        return real, schema_map[real]

    def filter_options(q: str | None, mode: str, case_sensitive: bool, include_numeric: bool) -> SearchOptions | None:
        phrase = (q or "").strip()
        if not phrase:
            return None
        return SearchOptions(
            phrase=phrase,
            match_mode=mode,
            case_sensitive=case_sensitive,
            include_numeric=include_numeric,
            include_dates=include_numeric,
        )

    @app.get("/api/limits")
    def limits(_user: User = Depends(current_user)):
        return {
            "max_row_limit": settings.max_row_limit,
            "max_export_rows": settings.max_export_rows,
            "query_default_rows": settings.query_default_rows,
            "query_max_rows": settings.query_max_rows,
            "max_concurrent_queries": settings.max_concurrent_queries,  # dashboards queue their cards below it
            "federation_source_rows": settings.federation_source_rows,
            "uploads_enabled": settings.uploads_enabled,
            "dataset_max_mb": settings.dataset_max_mb,
            "dataset_max_rows": settings.dataset_max_rows,
        }

    @app.get("/api/connections/{key}/browse")
    def browse(
        key: str,
        table: str = Query(..., min_length=1),
        limit: int = Query(50, ge=1),
        offset: int = Query(0, ge=0, le=10_000_000),
        sort: str | None = Query(None),
        desc: bool = Query(False),
        q: str | None = Query(None, max_length=200),
        mode: MatchMode = Query("contains"),
        case_sensitive: bool = Query(False),
        include_numeric: bool = Query(False),
        user: User = Depends(current_user),
    ):
        require_connection(key, user)
        name, columns = resolve_table(key, table)
        search = filter_options(q, mode, case_sensitive, include_numeric)
        row_filter = rows_for(user, key, name, columns)
        try:
            data = browse_table(
                registry.get_engine(key),
                registry.get_config(key),
                name,
                columns,
                limit=min(limit, settings.max_row_limit),
                offset=offset,
                sort=sort,
                descending=desc,
                search=search,
                row_filter=row_filter,
            )
        except Exception as exc:
            detail = describe_error(exc, registry.get_config(key).engine)
            raise HTTPException(status_code=502, detail=f"The query failed: {detail}") from exc
        if offset == 0:  # log "opened the table" once, not every page
            app_db.audit(
                user.username, "browse", connection=key, phrase=name + (f" ~ {search.phrase}" if search else ""), status="ok"
            )
        return data

    @app.get("/api/connections/{key}/structure")
    def structure(key: str, table: str = Query(..., min_length=1), user: User = Depends(current_user)):
        require_connection(key, user)
        name, columns = resolve_table(key, table)
        try:
            cols = table_structure(registry.get_engine(key), registry.get_config(key), name, columns)
        except Exception as exc:
            detail = describe_error(exc, registry.get_config(key).engine)
            raise HTTPException(status_code=502, detail=f"Could not read the table: {detail}") from exc
        return {"table": name, "columns": cols}

    @app.get("/api/connections/{key}/export")
    def export_table(
        key: str,
        table: str = Query(..., min_length=1),
        delimiter: str = Query(";", pattern="^[;,]$"),
        sort: str | None = Query(None),
        desc: bool = Query(False),
        q: str | None = Query(None, max_length=200),
        mode: MatchMode = Query("contains"),
        case_sensitive: bool = Query(False),
        include_numeric: bool = Query(False),
        user: User = Depends(current_user),
    ):
        """Streams the table (or only the rows matching `q`) as CSV, up to NCODE_MAX_EXPORT_ROWS rows."""
        require_connection(key, user)
        name, columns = resolve_table(key, table)
        search = filter_options(q, mode, case_sensitive, include_numeric)
        row_filter = rows_for(user, key, name, columns)
        engine, cfg = registry.get_engine(key), registry.get_config(key)
        try:  # fail now with a clear error instead of sending a half-empty file
            browse_table(engine, cfg, name, columns, limit=1, offset=0, sort=sort, descending=desc, search=search,
                         row_filter=row_filter)
        except Exception as exc:
            detail = describe_error(exc, cfg.engine)
            raise HTTPException(status_code=502, detail=f"The export failed: {detail}") from exc
        app_db.audit(
            user.username, "export", connection=key, phrase=name + (f" ~ {search.phrase}" if search else ""), status="ok"
        )
        stream = csv_stream(
            engine, cfg, name, columns,
            delimiter=delimiter, max_rows=settings.max_export_rows, sort=sort, descending=desc, search=search,
            row_filter=row_filter,
        )
        filename = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or "export"
        return StreamingResponse(
            stream,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'},
        )

    # ------------------------------------------------------------------
    # search
    # ------------------------------------------------------------------
    @app.post("/api/search", status_code=202)
    def start_search(payload: SearchRequest, user: User = Depends(current_user)):
        require_connection(payload.connection, user)
        if store.running_count(user.username) >= settings.max_concurrent_searches:
            raise HTTPException(
                status_code=429,
                detail=f"You already have {settings.max_concurrent_searches} searches running. "
                "Wait for one to finish or cancel it.",
            )

        row_limit = min(payload.row_limit or settings.default_row_limit, settings.max_row_limit)
        opts = SearchOptions(
            phrase=payload.phrase,
            match_mode=payload.match_mode,
            case_sensitive=payload.case_sensitive,
            include_numeric=payload.include_numeric,
            include_dates=payload.include_dates,
            row_limit=row_limit,
            tables=payload.tables,
            include_tables=payload.include_tables,
            exclude_tables=payload.exclude_tables,
            schema=payload.schema_name,
            refresh_schema=payload.refresh_schema,
            # tables with row-level rules for this user are not searched (row by row, every column)
            denied_tables=frozenset(rowsec.for_user(user, payload.connection)),
        )
        task = store.create(payload.connection, payload.phrase, settings.max_total_results, owner=user.username)

        audit_id = app_db.audit(
            user.username,
            "search",
            connection=payload.connection,
            phrase=payload.phrase,
            options=json.dumps(
                {
                    "match_mode": opts.match_mode,
                    "case_sensitive": opts.case_sensitive,
                    "include_numeric": opts.include_numeric,
                    "include_dates": opts.include_dates,
                    "row_limit": opts.row_limit,
                    "tables": opts.tables[:50],
                    "include_tables": opts.include_tables,
                    "exclude_tables": opts.exclude_tables,
                }
            ),
            status="running",
        )

        def on_finish(finished: SearchTask) -> None:
            info = finished.progress()
            app_db.audit_finish(
                audit_id,
                finished.status,
                info["found"],
                info["error_count"],
                (finished.finished_at or time.time()) - finished.created_at,
            )

        start_search_thread(task, registry, opts, settings, on_finish=on_finish)
        return {"task_id": task.id}

    @app.get("/api/search/{task_id}")
    def get_search(task_id: str, include_results: bool = Query(True), user: User = Depends(current_user)):
        task = get_task_or_404(task_id, user)
        return task.snapshot(include_results=include_results and task.is_final)

    @app.delete("/api/search/{task_id}")
    def cancel_search(task_id: str, user: User = Depends(current_user)):
        get_task_or_404(task_id, user).cancel()
        return {"status": "cancelling"}

    @app.websocket("/ws/{task_id}")
    async def search_progress(websocket: WebSocket, task_id: str):
        await websocket.accept()
        task: SearchTask | None = None
        try:
            # Browsers can't set headers on WebSockets, and tokens in the URL end up in
            # logs, so the client sends the token as its first message instead.
            try:
                first = await asyncio.wait_for(websocket.receive_json(), timeout=5)
                token = first.get("token") if isinstance(first, dict) else None
            except (asyncio.TimeoutError, ValueError, KeyError):
                token = None
            user = await asyncio.to_thread(user_from_token, token)
            if user is None:
                await websocket.send_json({"status": "unauthorized"})
                return

            candidate = store.get(task_id)
            if candidate is None or not can_access_task(user, candidate):
                await websocket.send_json({"status": "unknown"})
                return
            task = candidate

            last_sent = None
            while True:
                if task.is_final:
                    await websocket.send_json(task.snapshot(include_results=True))
                    break
                progress = task.progress()
                if progress != last_sent:
                    await websocket.send_json(progress)
                    last_sent = progress
                await asyncio.sleep(0.3)
        except WebSocketDisconnect:
            # The browser went away: stop wasting database resources on this search.
            if task is not None and not task.is_final:
                task.cancel()
        finally:
            try:
                await websocket.close()
            except RuntimeError:
                pass  # already closed

    queries = register_query_routes(
        app,
        registry=registry,
        settings=settings,
        app_db=app_db,
        runner=runner,
        current_user=current_user,
        require_connection=require_connection,
        semantic=semantic,
        rowsec=rowsec,
    )
    register_semantic_routes(
        app, semantic=semantic, registry=registry, queries=queries, current_user=current_user,
        require_admin=require_admin, require_connection=require_connection,
    )
    content = register_content_routes(
        app, app_db=app_db, settings=settings, queries=queries, current_user=current_user,
        require_connection=require_connection,
    )
    register_analysis_routes(
        app, registry=registry, settings=settings, runner=runner, queries=queries, content=content, semantic=semantic,
        current_user=current_user, require_connection=require_connection,
    )
    app.state.scheduler = scheduler
    register_automation_routes(
        app, app_db=app_db, settings_store=settings_store, subs=subscriptions, engine=automation,
        scheduler=scheduler, current_user=current_user, require_admin=require_admin,
    )
    register_sharing_routes(
        app, app_db=app_db, settings=settings, settings_store=settings_store, runner=runner,
        current_user=current_user, require_admin=require_admin,
    )
    register_usage_routes(app, app_db=app_db, settings=settings, require_admin=require_admin)
    metrics.gauge("ncode_queries_running", "Questions and SQL queries running now", runner.running_total)
    metrics.gauge("ncode_scheduler_up", "1 when the subscription scheduler runs", lambda: 1.0 if scheduler.alive() else 0.0)
    app.state.metrics = metrics
    register_ops_routes(
        app, app_db=app_db, metrics=metrics, metrics_token=settings.metrics_token, scheduler=scheduler,
        current_user_optional=current_user_optional, require_admin=require_admin,
    )
    register_admin_routes(
        app, app_db=app_db, registry=registry, rowsec=rowsec, session_ttl_hours=settings.session_ttl_hours,
        current_user=current_user, require_admin=require_admin,
    )
    return app
