"""Automation and sharing (roadmap M8): subscriptions and alerts, delivery channels, public links.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-11
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # a database created by the old v5 code (tests build it from today's models) may have it already
    if "email" not in {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}:
        with op.batch_alter_table("users") as batch:
            batch.add_column(sa.Column("email", sa.String(254)))
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.Text, nullable=False),       # JSON
        sa.Column("secret", sa.Text),                       # Fernet token (SMTP password, embedding key)
        sa.Column("updated_at", sa.Float, nullable=False),
        sa.Column("updated_by", sa.String(64)),
    )
    op.create_table(
        "destinations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),   # slack | teams | telegram | webhook
        sa.Column("config", sa.Text, nullable=False),       # JSON, nothing secret (Telegram chat id ...)
        sa.Column("secret", sa.Text, nullable=False),       # Fernet token: webhook URL or bot token
        sa.Column("created_at", sa.Float, nullable=False),
        sa.Column("created_by", sa.String(64)),
        sa.Column("updated_at", sa.Float, nullable=False),
    )
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("target_type", sa.String(16), nullable=False),   # dashboard | question
        sa.Column("target_id", sa.Integer, nullable=False, index=True),
        sa.Column("owner_id", sa.Integer, nullable=False, index=True),
        sa.Column("schedule", sa.Text, nullable=False),            # JSON, see app/automation/schedule.py
        sa.Column("recipients", sa.Text, nullable=False),          # JSON: users, addresses, destinations
        sa.Column("options", sa.Text, nullable=False),             # JSON: filters, attachments, rows ...
        sa.Column("alert", sa.Text),                               # JSON condition; NULL = a plain subscription
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("next_run_at", sa.Float, index=True),
        sa.Column("last_run_at", sa.Float),
        sa.Column("last_status", sa.String(16)),
        sa.Column("last_error", sa.Text),
        sa.Column("created_at", sa.Float, nullable=False),
        sa.Column("updated_at", sa.Float, nullable=False),
    )
    op.create_table(
        "subscription_runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("subscription_id", sa.Integer, nullable=False, index=True),
        sa.Column("trigger", sa.String(16), nullable=False),       # schedule | manual
        sa.Column("started_at", sa.Float, nullable=False),
        sa.Column("finished_at", sa.Float),
        sa.Column("status", sa.String(16), nullable=False),        # running | sent | skipped | partial | error
        sa.Column("detail", sa.Text),                              # JSON: per channel, per card
    )
    op.create_table(
        "share_links",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("kind", sa.String(8), nullable=False),           # public | embed
        sa.Column("target_type", sa.String(16), nullable=False),
        sa.Column("target_id", sa.Integer, nullable=False, index=True),
        sa.Column("token_hash", sa.String(64), unique=True),       # public links: sha256 of the token
        sa.Column("token_enc", sa.Text),                           # the token, encrypted (so it can be copied again)
        sa.Column("password_hash", sa.String(255)),
        sa.Column("expires_at", sa.Float),
        sa.Column("allow_download", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("settings", sa.Text, nullable=False),            # JSON: embedding parameters
        sa.Column("created_by", sa.String(64)),
        sa.Column("created_at", sa.Float, nullable=False),
        sa.Column("revoked_at", sa.Float),
        sa.Column("last_used_at", sa.Float),
        sa.Column("views", sa.Integer, nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("share_links")
    op.drop_table("subscription_runs")
    op.drop_table("subscriptions")
    op.drop_table("destinations")
    op.drop_table("app_settings")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("email")
