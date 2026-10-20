"""Brings Ncode's own database up to the latest schema (Alembic, see app/migrations)."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.engine import Engine

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def _config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    return cfg


def head_revision() -> str | None:
    return ScriptDirectory.from_config(_config()).get_current_head()


def current_revision(engine: Engine) -> str | None:
    with engine.connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def upgrade(engine: Engine) -> None:
    """Apply every pending migration in one transaction."""
    cfg = _config()
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
