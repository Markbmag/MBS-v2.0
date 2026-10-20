"""Dashboards (roadmap M5): dashboards and their cards.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-11
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dashboards",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("collection_id", sa.Integer, sa.ForeignKey("collections.id"), nullable=False, index=True),
        sa.Column("owner_id", sa.Integer),
        sa.Column("archived", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("filters", sa.Text, nullable=False, server_default="[]"),   # JSON: dashboard filters
        sa.Column("tabs", sa.Text, nullable=False, server_default="[]"),      # JSON: [{"id", "name"}]
        sa.Column("settings", sa.Text, nullable=False, server_default="{}"),  # JSON: refresh ...
        sa.Column("import_key", sa.String(120), unique=True),
        sa.Column("created_at", sa.Float, nullable=False),
        sa.Column("updated_at", sa.Float, nullable=False),
        sa.Column("updated_by", sa.String(64)),
    )
    op.create_table(
        "dashboard_cards",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("dashboard_id", sa.Integer, sa.ForeignKey("dashboards.id"), nullable=False, index=True),
        sa.Column("card_key", sa.String(40), nullable=False),     # stable id used by the layout
        sa.Column("tab", sa.String(40)),
        sa.Column("kind", sa.String(16), nullable=False),         # question | text | heading
        sa.Column("question_id", sa.Integer, sa.ForeignKey("questions.id"), index=True),  # NULL: deleted
        sa.Column("layout", sa.Text, nullable=False),             # JSON {"x", "y", "w", "h"}
        sa.Column("viz", sa.Text),                                # JSON: chart override
        sa.Column("mappings", sa.Text, nullable=False, server_default="{}"),  # JSON {filter_id: {"param"|"field"}}
        sa.Column("text", sa.Text),
        sa.Column("title", sa.String(200)),
        sa.Column("position", sa.Integer, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("dashboard_cards")
    op.drop_table("dashboards")
