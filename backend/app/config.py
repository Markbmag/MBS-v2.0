"""Configuration loaded from environment variables / a local .env file.

Database connections are declared with one group of variables per connection:

    NCODE_CONN_<KEY>_ENGINE=mysql        # mysql | mariadb | postgresql | mssql | sqlite
    NCODE_CONN_<KEY>_HOST=10.0.0.1
    NCODE_CONN_<KEY>_PORT=3306           # optional, engine default is used
    NCODE_CONN_<KEY>_USER=readonly_user
    NCODE_CONN_<KEY>_PASSWORD='secret'   # quote it if it contains # or $
    NCODE_CONN_<KEY>_DATABASE=mydb       # for sqlite: path to the file
    NCODE_CONN_<KEY>_SCHEMA=             # optional (postgresql / mssql)
    NCODE_CONN_<KEY>_LABEL=My database   # optional display name
    NCODE_CONN_<KEY>_ID_HINTS=vin,order  # optional, see ConnectionConfig

The password is stored separately from the host/user/database on purpose: that
way you never have to URL-encode special characters such as ( ) @ / #.
"""

from __future__ import annotations

import importlib.util
import os
import re
from dataclasses import dataclass, field
from typing import Mapping

from dotenv import load_dotenv

@dataclass(frozen=True)
class EngineInfo:
    name: str                      # canonical name used everywhere
    label: str                     # shown in the UI
    driver: str                    # SQLAlchemy driver name
    default_port: int | None
    module: str | None             # python module that must be importable (None = built in)
    pip: str | None                # what to pip install if the module is missing
    file_based: bool = False       # sqlite: "database" is a file path, no host/user


ENGINES: dict[str, EngineInfo] = {
    "mysql": EngineInfo("mysql", "MySQL", "mysql+pymysql", 3306, "pymysql", "pymysql"),
    "mariadb": EngineInfo("mariadb", "MariaDB", "mysql+pymysql", 3306, "pymysql", "pymysql"),
    "postgresql": EngineInfo("postgresql", "PostgreSQL", "postgresql+psycopg", 5432, "psycopg", "psycopg[binary]"),
    "mssql": EngineInfo("mssql", "SQL Server", "mssql+pymssql", 1433, "pymssql", "pymssql"),
    "sqlite": EngineInfo("sqlite", "SQLite", "sqlite", None, None, None, file_based=True),
}
ENGINE_ALIASES = {"postgres": "postgresql", "pg": "postgresql", "sqlserver": "mssql", "mariadb": "mariadb"}

# Kept for backwards compatibility: name -> (driver, default port)
SUPPORTED_ENGINES: dict[str, tuple[str, int | None]] = {
    name: (info.driver, info.default_port) for name, info in ENGINES.items()
}


def normalize_engine(name: str) -> str:
    name = (name or "").strip().lower()
    return ENGINE_ALIASES.get(name, name)


def driver_available(engine: str) -> bool:
    """True when the Python driver for this engine is installed."""
    info = ENGINES.get(engine)
    if info is None:
        return False
    return info.module is None or importlib.util.find_spec(info.module) is not None


_CONN_VAR = re.compile(
    r"^NCODE_CONN_([A-Z0-9_]+?)_(ENGINE|HOST|PORT|USER|PASSWORD|DATABASE|SCHEMA|LABEL|ID_HINTS)$"
)


class ConfigError(ValueError):
    """Raised when the environment configuration is invalid."""


@dataclass(frozen=True)
class ConnectionConfig:
    key: str                      # lowercase identifier used in the API, e.g. "mes"
    label: str                    # human readable name shown in the UI
    engine: str                   # normalised engine name, e.g. "mysql"
    database: str
    host: str | None = None
    port: int | None = None
    user: str | None = None
    password: str | None = field(default=None, repr=False)  # never printed
    schema: str | None = None
    # Substrings of column names that identify a record (e.g. "vin", "serial").
    # The first matching column of a result row is returned as `id_column`.
    id_hints: tuple[str, ...] = ()
    # Where the connection is defined: "env" (read-only, from .env) or "ui" (editable, stored encrypted)
    source: str = "env"

    @property
    def driver(self) -> str:
        return ENGINES[self.engine].driver

    @property
    def is_mariadb(self) -> bool:
        return self.engine == "mariadb"


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    search_workers: int = 8              # parallel tables per search
    statement_timeout_sec: int = 20      # per-query timeout where the DB supports it
    default_row_limit: int = 10          # rows returned per table
    max_row_limit: int = 200
    max_total_results: int = 1000        # cap on rows kept per search task
    max_export_rows: int = 50_000        # cap on rows in one CSV export
    task_ttl_sec: int = 3600             # finished tasks are forgotten after this
    schema_cache_ttl_sec: int = 600      # table/column metadata cache
    read_only_sessions: bool = True      # ask the DB to refuse writes (best effort)
    # --- authentication / team usage ---
    auth_enabled: bool = True            # NEVER turn off on a shared network
    session_ttl_hours: int = 12
    app_db_path: str = ""                # users + audit log; "" = backend/data/ncode.sqlite
    max_concurrent_searches: int = 3     # running searches per user
    login_max_failures: int = 5          # failed logins before a temporary lock
    login_lock_sec: int = 300
    # --- questions and SQL mode (query engine) ---
    query_default_rows: int = 2000       # rows returned when a question does not say
    query_max_rows: int = 10000          # hard cap per question / SQL query
    query_cache_ttl_sec: int = 60        # identical questions within this time reuse the result; 0 = off
    max_concurrent_queries: int = 3      # running questions per user
    query_workers: int = 8               # questions running at once on this server
    # --- federation and uploaded datasets (M6) ---
    federation_source_rows: int = 100_000  # rows read from each source of a multi-source question
    federation_memory_mb: int = 512      # DuckDB memory per multi-source run
    federation_threads: int = 2          # DuckDB threads per multi-source run
    uploads_enabled: bool = True         # users may upload CSV / Excel / Parquet files
    dataset_max_mb: int = 100            # largest file that can be uploaded
    dataset_max_rows: int = 1_000_000    # rows kept per uploaded file
    profile_sample_rows: int = 20_000    # rows read to profile / X-ray a table (M7)
    # --- automation and sharing (M8) ---
    scheduler_enabled: bool = True       # send subscriptions and alerts on schedule
    scheduler_interval_sec: int = 30     # how often due subscriptions are looked for
    scheduler_workers: int = 2           # subscriptions sent at the same time
    slow_query_sec: int = 5              # queries slower than this show in Admin → Usage → Slow queries
    public_rate_per_min: int = 120       # requests per minute per visitor on public links and embeds
    # --- operations (M9) ---
    backup_hour: int = 2                 # automatic daily backup at this hour (server time); -1 = off
    backup_keep: int = 7                 # automatic backups kept
    metrics_token: str = field(default="", repr=False)  # lets Prometheus read /metrics without signing in
    # Encrypts passwords of connections created in the UI. Empty = auto-generated key file.
    secret_key: str = field(default="", repr=False)


def _int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc


def _bool(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    origins_raw = env.get("NCODE_CORS_ORIGINS", "")
    origins = tuple(o.strip() for o in origins_raw.split(",") if o.strip())
    defaults = Settings()
    return Settings(
        host=env.get("NCODE_HOST", defaults.host),
        port=_int(env, "NCODE_PORT", defaults.port),
        cors_origins=origins or defaults.cors_origins,
        search_workers=max(1, _int(env, "NCODE_SEARCH_WORKERS", defaults.search_workers)),
        statement_timeout_sec=max(1, _int(env, "NCODE_STATEMENT_TIMEOUT_SEC", defaults.statement_timeout_sec)),
        default_row_limit=max(1, _int(env, "NCODE_DEFAULT_ROW_LIMIT", defaults.default_row_limit)),
        max_row_limit=max(1, _int(env, "NCODE_MAX_ROW_LIMIT", defaults.max_row_limit)),
        max_total_results=max(1, _int(env, "NCODE_MAX_TOTAL_RESULTS", defaults.max_total_results)),
        max_export_rows=max(1, _int(env, "NCODE_MAX_EXPORT_ROWS", defaults.max_export_rows)),
        task_ttl_sec=max(60, _int(env, "NCODE_TASK_TTL_SEC", defaults.task_ttl_sec)),
        schema_cache_ttl_sec=max(0, _int(env, "NCODE_SCHEMA_CACHE_TTL_SEC", defaults.schema_cache_ttl_sec)),
        read_only_sessions=_bool(env, "NCODE_READ_ONLY_SESSIONS", defaults.read_only_sessions),
        auth_enabled=_bool(env, "NCODE_AUTH_ENABLED", defaults.auth_enabled),
        session_ttl_hours=max(1, _int(env, "NCODE_SESSION_TTL_HOURS", defaults.session_ttl_hours)),
        app_db_path=(env.get("NCODE_APP_DB") or "").strip(),
        max_concurrent_searches=max(1, _int(env, "NCODE_MAX_CONCURRENT_SEARCHES", defaults.max_concurrent_searches)),
        login_max_failures=max(1, _int(env, "NCODE_LOGIN_MAX_FAILURES", defaults.login_max_failures)),
        login_lock_sec=max(1, _int(env, "NCODE_LOGIN_LOCK_SEC", defaults.login_lock_sec)),
        secret_key=(env.get("NCODE_SECRET_KEY") or "").strip(),
        query_default_rows=max(1, _int(env, "NCODE_QUERY_DEFAULT_ROWS", defaults.query_default_rows)),
        query_max_rows=max(1, _int(env, "NCODE_QUERY_MAX_ROWS", defaults.query_max_rows)),
        query_cache_ttl_sec=max(0, _int(env, "NCODE_QUERY_CACHE_TTL_SEC", defaults.query_cache_ttl_sec)),
        max_concurrent_queries=max(1, _int(env, "NCODE_MAX_CONCURRENT_QUERIES", defaults.max_concurrent_queries)),
        query_workers=max(1, _int(env, "NCODE_QUERY_WORKERS", defaults.query_workers)),
        federation_source_rows=max(1, _int(env, "NCODE_FEDERATION_SOURCE_ROWS", defaults.federation_source_rows)),
        federation_memory_mb=max(64, _int(env, "NCODE_FEDERATION_MEMORY_MB", defaults.federation_memory_mb)),
        federation_threads=max(1, _int(env, "NCODE_FEDERATION_THREADS", defaults.federation_threads)),
        uploads_enabled=_bool(env, "NCODE_UPLOADS_ENABLED", defaults.uploads_enabled),
        dataset_max_mb=max(1, _int(env, "NCODE_DATASET_MAX_MB", defaults.dataset_max_mb)),
        dataset_max_rows=max(1, _int(env, "NCODE_DATASET_MAX_ROWS", defaults.dataset_max_rows)),
        profile_sample_rows=max(100, _int(env, "NCODE_PROFILE_SAMPLE_ROWS", defaults.profile_sample_rows)),
        scheduler_enabled=_bool(env, "NCODE_SCHEDULER_ENABLED", defaults.scheduler_enabled),
        scheduler_interval_sec=max(5, _int(env, "NCODE_SCHEDULER_INTERVAL_SEC", defaults.scheduler_interval_sec)),
        scheduler_workers=max(1, _int(env, "NCODE_SCHEDULER_WORKERS", defaults.scheduler_workers)),
        slow_query_sec=max(1, _int(env, "NCODE_SLOW_QUERY_SEC", defaults.slow_query_sec)),
        public_rate_per_min=max(10, _int(env, "NCODE_PUBLIC_RATE_PER_MIN", defaults.public_rate_per_min)),
        backup_hour=min(23, max(-1, _int(env, "NCODE_BACKUP_HOUR", defaults.backup_hour))),
        backup_keep=max(1, _int(env, "NCODE_BACKUP_KEEP", defaults.backup_keep)),
        metrics_token=(env.get("NCODE_METRICS_TOKEN") or "").strip(),
    )


def load_connections(env: Mapping[str, str] | None = None) -> dict[str, ConnectionConfig]:
    """Parse every NCODE_CONN_<KEY>_* variable into a ConnectionConfig.

    Fails loudly (ConfigError) on incomplete or unknown configuration instead of
    silently ignoring it.
    """
    env = os.environ if env is None else env

    raw: dict[str, dict[str, str]] = {}
    for name, value in env.items():
        match = _CONN_VAR.match(name)
        if match:
            raw.setdefault(match.group(1), {})[match.group(2)] = value

    connections: dict[str, ConnectionConfig] = {}
    for key_upper, values in sorted(raw.items()):
        key = key_upper.lower()
        engine = normalize_engine(values.get("ENGINE") or "")
        if engine not in ENGINES:
            raise ConfigError(
                f"NCODE_CONN_{key_upper}_ENGINE must be one of "
                f"{', '.join(sorted(ENGINES))}, got {engine!r}"
            )
        database = (values.get("DATABASE") or "").strip()
        if not database:
            raise ConfigError(f"NCODE_CONN_{key_upper}_DATABASE is required")

        host = (values.get("HOST") or "").strip() or None
        if not ENGINES[engine].file_based and not host:
            raise ConfigError(f"NCODE_CONN_{key_upper}_HOST is required for engine {engine!r}")

        port_raw = (values.get("PORT") or "").strip()
        if port_raw:
            try:
                port: int | None = int(port_raw)
            except ValueError as exc:
                raise ConfigError(f"NCODE_CONN_{key_upper}_PORT must be an integer") from exc
        else:
            port = ENGINES[engine].default_port

        hints = tuple(
            h.strip().lower() for h in (values.get("ID_HINTS") or "").split(",") if h.strip()
        )
        connections[key] = ConnectionConfig(
            key=key,
            label=(values.get("LABEL") or "").strip() or key_upper,
            engine=engine,
            database=database,
            host=host,
            port=port,
            user=(values.get("USER") or "").strip() or None,
            password=values.get("PASSWORD") or None,
            schema=(values.get("SCHEMA") or "").strip() or None,
            id_hints=hints,
        )
    return connections


def init_environment() -> None:
    """Load backend/.env (if present) into os.environ. Real env vars win."""
    load_dotenv(override=False)
