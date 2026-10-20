"""Admin and production (roadmap M9): groups, group grants, row-level security, last sign-in.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def _has(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    op.create_table(
        "groups",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(64), nullable=False, unique=True),
        sa.Column("description", sa.Text),
        sa.Column("connections", sa.String(500), nullable=False, server_default=""),  # "", "*" or "mes,les"
        sa.Column("created_at", sa.Float, nullable=False),
    )
    op.create_table(
        "group_members",
        sa.Column("group_id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, primary_key=True, index=True),
    )
    op.create_table(
        "row_rules",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("group_id", sa.Integer, nullable=False, index=True),
        sa.Column("connection", sa.String(64), nullable=False),
        sa.Column("table_name", sa.String(255), nullable=False),
        sa.Column("column_name", sa.String(255), nullable=False),
        sa.Column("values", sa.Text, nullable=False),   # JSON list; "{username}" / "{email}" stand for the viewer
        sa.Column("created_at", sa.Float, nullable=False),
        sa.Column("created_by", sa.String(64)),
    )
    # a database created by the old v5 code (tests build it from today's models) may have them already
    if not _has("permissions", "group_id"):
        with op.batch_alter_table("permissions") as batch:
            batch.add_column(sa.Column("group_id", sa.Integer))
    if not _has("users", "last_login_at"):
        with op.batch_alter_table("users") as batch:
            batch.add_column(sa.Column("last_login_at", sa.Float))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("last_login_at")
    with op.batch_alter_table("permissions") as batch:
        batch.drop_column("group_id")
    op.drop_table("row_rules")
    op.drop_table("group_members")
    op.drop_table("groups")
