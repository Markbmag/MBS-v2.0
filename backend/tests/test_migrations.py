"""Ncode's own database is created and upgraded by Alembic migrations."""

import sqlite3

from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app.content.tables import collections_table  # also registers the library tables in `metadata`
from app.appdb import AppDB, metadata, users_table
from app.migrate import current_revision, head_revision, upgrade
from app.security import hash_password


def tables(path):
    con = sqlite3.connect(path)
    try:
        return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        con.close()


def test_fresh_database_is_created_at_head(tmp_path):
    db = AppDB(tmp_path / "app.sqlite")
    assert current_revision(db.engine) == head_revision()
    assert {"users", "sessions", "connections", "audit_log", "alembic_version"} <= tables(db.path)
    assert {collections_table.name, "questions", "permissions", "favorites"} <= tables(db.path)
    db.dispose()


def test_migrated_schema_matches_the_models(tmp_path):
    db = AppDB(tmp_path / "app.sqlite")
    with db.engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), metadata)
    # Server-side defaults are not used; only Python-side ones, which are not schema.
    assert diff == []
    db.dispose()


def test_existing_v5_database_keeps_its_data(tmp_path):
    path = tmp_path / "app.sqlite"
    engine = create_engine(f"sqlite:///{path}")
    v5 = [metadata.tables[t] for t in ("users", "sessions", "connections", "audit_log")]
    metadata.create_all(engine, tables=v5)  # how v5 created its tables, without migrations
    with engine.begin() as conn:
        conn.execute(
            users_table.insert().values(
                username="old", password_hash=hash_password("old-password-1"), role="admin",
                is_active=True, allowed_connections="*", created_at=1.0,
            )
        )
    engine.dispose()

    db = AppDB(path)
    assert current_revision(db.engine) == head_revision()
    assert db.get_user_by_name("old").is_admin
    db.dispose()


def test_older_database_without_connections_table_gets_it(tmp_path):
    path = tmp_path / "app.sqlite"
    engine = create_engine(f"sqlite:///{path}")
    metadata.create_all(engine, tables=[metadata.tables["users"], metadata.tables["sessions"]])
    engine.dispose()

    db = AppDB(path)
    assert {"connections", "audit_log"} <= set(inspect(db.engine).get_table_names())
    db.dispose()


def test_upgrade_twice_is_harmless(tmp_path):
    db = AppDB(tmp_path / "app.sqlite")
    db.create_user("bob", hash_password("bob-password-1"))
    upgrade(db.engine)
    db.dispose()
    again = AppDB(tmp_path / "app.sqlite")
    assert again.get_user_by_name("bob") is not None
    again.dispose()
