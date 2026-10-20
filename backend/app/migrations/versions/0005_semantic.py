"""Semantic layer (roadmap M7): column metadata, manual relationships, metrics, models.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-11
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "field_metadata",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("connection", sa.String(64), nullable=False),
        sa.Column("table_name", sa.String(255), nullable=False),
        sa.Column("column_name", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(200)),
        sa.Column("description", sa.Text),
        sa.Column("semantic_type", sa.String(32)),         # category, currency, percent, quantity, id, email, url ...
        sa.Column("format", sa.Text),                       # JSON: number/date format, as in a chart's format
        sa.Column("hidden", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("parse_as_date", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.Float, nullable=False),
        sa.Column("updated_by", sa.String(64)),
        sa.UniqueConstraint("connection", "table_name", "column_name", name="uq_field_metadata_column"),
    )
    op.create_table(
        "relationships",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("connection", sa.String(64), nullable=False, index=True),
        sa.Column("from_table", sa.String(255), nullable=False),
        sa.Column("from_columns", sa.Text, nullable=False),  # JSON list
        sa.Column("to_table", sa.String(255), nullable=False),
        sa.Column("to_columns", sa.Text, nullable=False),    # JSON list
        sa.Column("created_at", sa.Float, nullable=False),
        sa.Column("created_by", sa.String(64)),
    )
    op.create_table(
        "metrics",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("connection", sa.String(64), nullable=False, index=True),
        sa.Column("table_name", sa.String(255), nullable=False),
        sa.Column("definition", sa.Text, nullable=False),    # JSON: {"fn", "ref" | "expr", "where"}
        sa.Column("format", sa.Text),                        # JSON, like field_metadata.format
        sa.Column("archived", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.Float, nullable=False),
        sa.Column("updated_at", sa.Float, nullable=False),
        sa.Column("updated_by", sa.String(64)),
    )
    with op.batch_alter_table("questions") as batch:
        batch.add_column(sa.Column("model", sa.Boolean, nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table("questions") as batch:
        batch.drop_column("model")
    op.drop_table("metrics")
    op.drop_table("relationships")
    op.drop_table("field_metadata")
