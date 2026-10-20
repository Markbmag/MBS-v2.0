"""Datasets (roadmap M6): uploaded CSV / Excel / Parquet files.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-11
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "datasets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("collection_id", sa.Integer, sa.ForeignKey("collections.id"), nullable=False, index=True),
        sa.Column("owner_id", sa.Integer),
        sa.Column("archived", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("file", sa.String(80), nullable=False),          # Parquet file name inside data/datasets
        sa.Column("columns", sa.Text, nullable=False),             # JSON [{"name", "type"}]
        sa.Column("row_count", sa.Integer, nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),       # of the Parquet file
        sa.Column("source_name", sa.String(255)),                  # the uploaded file's name
        sa.Column("source_format", sa.String(16), nullable=False),  # csv | xlsx | parquet
        sa.Column("created_at", sa.Float, nullable=False),
        sa.Column("updated_at", sa.Float, nullable=False),
        sa.Column("updated_by", sa.String(64)),
    )


def downgrade() -> None:
    op.drop_table("datasets")
