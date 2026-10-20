"""Table definitions for the library, the semantic layer, automation and sharing. They mirror migrations 0002-0006 (app/migrations/versions)."""

from __future__ import annotations

from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String, Table, Text, UniqueConstraint

from ..appdb import metadata  # one MetaData for the whole app DB (the migration test compares it)

collections_table = Table(
    "collections",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(120), nullable=False),
    Column("description", Text),
    Column("parent_id", Integer, ForeignKey("collections.id"), index=True),
    Column("owner_id", Integer),
    Column("personal_owner_id", Integer, unique=True),
    Column("archived", Boolean, nullable=False, default=False),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
)

questions_table = Table(
    "questions",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(200), nullable=False),
    Column("description", Text),
    Column("collection_id", Integer, ForeignKey("collections.id"), nullable=False, index=True),
    Column("connection", String(64), nullable=False),
    Column("kind", String(16), nullable=False),
    Column("spec", Text, nullable=False),
    Column("viz", Text),
    Column("parameters", Text, nullable=False, default="[]"),
    Column("owner_id", Integer),
    Column("archived", Boolean, nullable=False, default=False),
    Column("import_key", String(120), unique=True),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
    Column("updated_by", String(64)),
    Column("model", Boolean, nullable=False, default=False),  # usable as a source like a table (M7)
)

permissions_table = Table(
    "permissions",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("collection_id", Integer, ForeignKey("collections.id"), nullable=False, index=True),
    Column("user_id", Integer),
    Column("role", String(16)),
    Column("level", String(8), nullable=False),
    Column("group_id", Integer),  # M9
)

favorites_table = Table(
    "favorites",
    metadata,
    Column("user_id", Integer, primary_key=True),
    Column("item_type", String(16), primary_key=True),
    Column("item_id", Integer, primary_key=True),
    Column("created_at", Float, nullable=False),
)

dashboards_table = Table(
    "dashboards",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(200), nullable=False),
    Column("description", Text),
    Column("collection_id", Integer, ForeignKey("collections.id"), nullable=False, index=True),
    Column("owner_id", Integer),
    Column("archived", Boolean, nullable=False, default=False),
    Column("filters", Text, nullable=False, default="[]"),
    Column("tabs", Text, nullable=False, default="[]"),
    Column("settings", Text, nullable=False, default="{}"),
    Column("import_key", String(120), unique=True),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
    Column("updated_by", String(64)),
)

dashboard_cards_table = Table(
    "dashboard_cards",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("dashboard_id", Integer, ForeignKey("dashboards.id"), nullable=False, index=True),
    Column("card_key", String(40), nullable=False),
    Column("tab", String(40)),
    Column("kind", String(16), nullable=False),
    Column("question_id", Integer, ForeignKey("questions.id"), index=True),
    Column("layout", Text, nullable=False),
    Column("viz", Text),
    Column("mappings", Text, nullable=False, default="{}"),
    Column("text", Text),
    Column("title", String(200)),
    Column("position", Integer, nullable=False),
)

datasets_table = Table(
    "datasets",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(200), nullable=False),
    Column("description", Text),
    Column("collection_id", Integer, ForeignKey("collections.id"), nullable=False, index=True),
    Column("owner_id", Integer),
    Column("archived", Boolean, nullable=False, default=False),
    Column("file", String(80), nullable=False),
    Column("columns", Text, nullable=False),
    Column("row_count", Integer, nullable=False),
    Column("size_bytes", Integer, nullable=False),
    Column("source_name", String(255)),
    Column("source_format", String(16), nullable=False),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
    Column("updated_by", String(64)),
)

# ---------------------------------------------------------------- semantic layer (M7)

field_metadata_table = Table(
    "field_metadata",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("connection", String(64), nullable=False),
    Column("table_name", String(255), nullable=False),
    Column("column_name", String(255), nullable=False),
    Column("display_name", String(200)),
    Column("description", Text),
    Column("semantic_type", String(32)),
    Column("format", Text),
    Column("hidden", Boolean, nullable=False, default=False),
    Column("parse_as_date", Boolean, nullable=False, default=False),
    Column("updated_at", Float, nullable=False),
    Column("updated_by", String(64)),
    UniqueConstraint("connection", "table_name", "column_name", name="uq_field_metadata_column"),
)

relationships_table = Table(
    "relationships",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("connection", String(64), nullable=False, index=True),
    Column("from_table", String(255), nullable=False),
    Column("from_columns", Text, nullable=False),
    Column("to_table", String(255), nullable=False),
    Column("to_columns", Text, nullable=False),
    Column("created_at", Float, nullable=False),
    Column("created_by", String(64)),
)

metrics_table = Table(
    "metrics",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(120), nullable=False),
    Column("description", Text),
    Column("connection", String(64), nullable=False, index=True),
    Column("table_name", String(255), nullable=False),
    Column("definition", Text, nullable=False),
    Column("format", Text),
    Column("archived", Boolean, nullable=False, default=False),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
    Column("updated_by", String(64)),
)

# ---------------------------------------------------------------- M8: automation and sharing (migration 0006)

app_settings_table = Table(
    "app_settings",
    metadata,
    Column("key", String(64), primary_key=True),
    Column("value", Text, nullable=False),
    Column("secret", Text),
    Column("updated_at", Float, nullable=False),
    Column("updated_by", String(64)),
)

destinations_table = Table(
    "destinations",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(120), nullable=False),
    Column("kind", String(16), nullable=False),
    Column("config", Text, nullable=False),
    Column("secret", Text, nullable=False),
    Column("created_at", Float, nullable=False),
    Column("created_by", String(64)),
    Column("updated_at", Float, nullable=False),
)

subscriptions_table = Table(
    "subscriptions",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(200), nullable=False),
    Column("target_type", String(16), nullable=False),
    Column("target_id", Integer, nullable=False, index=True),
    Column("owner_id", Integer, nullable=False, index=True),
    Column("schedule", Text, nullable=False),
    Column("recipients", Text, nullable=False),
    Column("options", Text, nullable=False),
    Column("alert", Text),
    Column("enabled", Boolean, nullable=False, default=True),
    Column("next_run_at", Float, index=True),
    Column("last_run_at", Float),
    Column("last_status", String(16)),
    Column("last_error", Text),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
)

subscription_runs_table = Table(
    "subscription_runs",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("subscription_id", Integer, nullable=False, index=True),
    Column("trigger", String(16), nullable=False),
    Column("started_at", Float, nullable=False),
    Column("finished_at", Float),
    Column("status", String(16), nullable=False),
    Column("detail", Text),
)

share_links_table = Table(
    "share_links",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("kind", String(8), nullable=False),
    Column("target_type", String(16), nullable=False),
    Column("target_id", Integer, nullable=False, index=True),
    Column("token_hash", String(64), unique=True),
    Column("token_enc", Text),
    Column("password_hash", String(255)),
    Column("expires_at", Float),
    Column("allow_download", Boolean, nullable=False, default=False),
    Column("settings", Text, nullable=False),
    Column("created_by", String(64)),
    Column("created_at", Float, nullable=False),
    Column("revoked_at", Float),
    Column("last_used_at", Float),
    Column("views", Integer, nullable=False, default=0),
)
