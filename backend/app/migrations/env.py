"""Alembic environment for Ncode's own database.

Normally migrations run from AppDB (app.migrate.upgrade), which hands over an open
connection. Run from the command line (`alembic upgrade head`), the database path
comes from NCODE_APP_DB / backend/.env, like the rest of the app.
"""

from __future__ import annotations

from alembic import context
from sqlalchemy import create_engine
from sqlalchemy.engine import URL


def _run(connection) -> None:
    # render_as_batch: SQLite cannot ALTER most things; batch mode copies the table instead.
    context.configure(connection=connection, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


connection = context.config.attributes.get("connection")
if connection is not None:
    _run(connection)
else:
    from app.appdb import resolve_app_db_path
    from app.config import init_environment, load_settings

    init_environment()
    path = resolve_app_db_path(load_settings().app_db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(URL.create("sqlite", database=str(path)))
    with engine.connect() as conn:
        _run(conn)
    engine.dispose()
