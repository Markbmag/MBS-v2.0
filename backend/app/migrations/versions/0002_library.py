"""Library (roadmap M4): collections, saved questions, collection permissions, favourites.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-11
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "collections",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("parent_id", sa.Integer, sa.ForeignKey("collections.id"), index=True),
        sa.Column("owner_id", sa.Integer),                      # NULL once the owner was deleted
        sa.Column("personal_owner_id", sa.Integer, unique=True),  # set on a user's own collection
        sa.Column("archived", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.Float, nullable=False),
        sa.Column("updated_at", sa.Float, nullable=False),
    )
    op.create_table(
        "questions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("collection_id", sa.Integer, sa.ForeignKey("collections.id"), nullable=False, index=True),
        sa.Column("connection", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),        # builder | sql | federated
        sa.Column("spec", sa.Text, nullable=False),              # JSON
        sa.Column("viz", sa.Text),                               # JSON
        sa.Column("parameters", sa.Text, nullable=False, server_default="[]"),  # JSON
        sa.Column("owner_id", sa.Integer),
        sa.Column("archived", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("import_key", sa.String(120), unique=True),   # e.g. "datadesk:report:12"
        sa.Column("created_at", sa.Float, nullable=False),
        sa.Column("updated_at", sa.Float, nullable=False),
        sa.Column("updated_by", sa.String(64)),
    )
    op.create_table(
        "permissions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("collection_id", sa.Integer, sa.ForeignKey("collections.id"), nullable=False, index=True),
        sa.Column("user_id", sa.Integer),       # exactly one of user_id / role
        sa.Column("role", sa.String(16)),       # "all" = every signed-in user, or a role name
        sa.Column("level", sa.String(8), nullable=False),  # view | edit
    )
    op.create_table(
        "favorites",
        sa.Column("user_id", sa.Integer, primary_key=True),
        sa.Column("item_type", sa.String(16), primary_key=True),  # question (dashboards in M5)
        sa.Column("item_id", sa.Integer, primary_key=True),
        sa.Column("created_at", sa.Float, nullable=False),
    )


def downgrade() -> None:
    for table in ("favorites", "permissions", "questions", "collections"):
        op.drop_table(table)
