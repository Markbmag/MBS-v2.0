"""Baseline: users, sessions, connections, audit_log (the schema of Ncode v5).

Databases created before migrations existed already hold some or all of these
tables (create_all), so each table is only created when it is missing. That makes
this revision safe on a fresh file, on a v5 file and on older files that predate
the connections table.

Revision ID: 0001
Revises:
Create Date: 2026-10-10
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if "users" not in existing:
        op.create_table(
            "users",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("username", sa.String(64), unique=True, nullable=False),
            sa.Column("password_hash", sa.String(255), nullable=False),
            sa.Column("role", sa.String(16), nullable=False),
            sa.Column("is_active", sa.Boolean, nullable=False),
            sa.Column("allowed_connections", sa.String(500), nullable=False),
            sa.Column("created_at", sa.Float, nullable=False),
        )

    if "sessions" not in existing:
        op.create_table(
            "sessions",
            sa.Column("token_hash", sa.String(64), primary_key=True),
            sa.Column("user_id", sa.Integer, nullable=False),
            sa.Column("created_at", sa.Float, nullable=False),
            sa.Column("expires_at", sa.Float, nullable=False),
        )
        op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
        op.create_index("ix_sessions_expires_at", "sessions", ["expires_at"])

    if "connections" not in existing:
        op.create_table(
            "connections",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("slug", sa.String(64), unique=True, nullable=False),
            sa.Column("label", sa.String(120), nullable=False),
            sa.Column("engine", sa.String(16), nullable=False),
            sa.Column("host", sa.String(255)),
            sa.Column("port", sa.Integer),
            sa.Column("username", sa.String(128)),
            sa.Column("password_enc", sa.Text),
            sa.Column("db_name", sa.String(500), nullable=False),
            sa.Column("db_schema", sa.String(128)),
            sa.Column("id_hints", sa.String(500), nullable=False),
            sa.Column("created_by", sa.String(64)),
            sa.Column("created_at", sa.Float, nullable=False),
            sa.Column("updated_at", sa.Float, nullable=False),
        )

    if "audit_log" not in existing:
        op.create_table(
            "audit_log",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("ts", sa.Float, nullable=False),
            sa.Column("username", sa.String(64)),
            sa.Column("action", sa.String(32), nullable=False),
            sa.Column("connection", sa.String(64)),
            sa.Column("phrase", sa.String(200)),
            sa.Column("options", sa.Text),
            sa.Column("status", sa.String(16)),
            sa.Column("found", sa.Integer),
            sa.Column("error_count", sa.Integer),
            sa.Column("duration_sec", sa.Float),
        )
        op.create_index("ix_audit_log_ts", "audit_log", ["ts"])


def downgrade() -> None:
    # Dropping the baseline would delete every user and saved connection.
    raise RuntimeError("The baseline migration cannot be downgraded")
