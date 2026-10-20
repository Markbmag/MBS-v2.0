"""Schema v2: type normalisation across dialects, relationships and join paths (no database)."""

import datetime as dt
from decimal import Decimal

import pytest
from sqlalchemy import types as t
from sqlalchemy.dialects import mssql, mysql, postgresql, sqlite

from app.results import build_envelope, column_role, infer_type
from app.schema_graph import Relationship, describe_schema, find_join_path, normalize_type, relationships


@pytest.mark.parametrize(
    "col_type, expected",
    [
        (t.String(20), "string"), (t.Text(), "string"), (t.Enum("a", "b"), "string"), (t.Uuid(), "string"),
        (t.Integer(), "number"), (t.BigInteger(), "number"), (t.Numeric(10, 2), "number"), (t.Float(), "number"),
        (t.Boolean(), "boolean"), (t.Date(), "date"), (t.DateTime(), "datetime"), (t.Time(), "time"),
        (t.JSON(), "json"), (t.LargeBinary(), "binary"), (t.NullType(), "unknown"),
        # MySQL / MariaDB
        (mysql.TINYINT(), "number"), (mysql.YEAR(), "number"), (mysql.SET("a"), "string"),
        (mysql.LONGTEXT(), "string"), (mysql.DATETIME(fsp=3), "datetime"), (mysql.BLOB(), "binary"),
        (mysql.JSON(), "json"),
        # PostgreSQL
        (postgresql.JSONB(), "json"), (postgresql.UUID(), "string"), (postgresql.TIMESTAMP(timezone=True), "datetime"),
        (postgresql.ARRAY(t.Integer()), "json"), (postgresql.BYTEA(), "binary"), (postgresql.INTERVAL(), "string"),
        (postgresql.DOUBLE_PRECISION(), "number"),
        # SQL Server
        (mssql.BIT(), "boolean"), (mssql.MONEY(), "number"), (mssql.DATETIME2(), "datetime"),
        (mssql.DATETIMEOFFSET(), "datetime"), (mssql.NVARCHAR(50), "string"), (mssql.UNIQUEIDENTIFIER(), "string"),
        (mssql.VARBINARY(), "binary"),
        # SQLite
        (sqlite.DATETIME(), "datetime"), (sqlite.DATE(), "date"),
    ],
)
def test_normalize_type(col_type, expected):
    assert normalize_type(col_type) == expected


SHOP_FKS = {
    "orders": [{"constrained_columns": ["customer_id"], "referred_table": "customers", "referred_columns": ["id"]}],
    "order_items": [
        {"constrained_columns": ["order_id"], "referred_table": "orders", "referred_columns": ["id"]},
        {"constrained_columns": ["product_id"], "referred_table": "products", "referred_columns": ["id"]},
    ],
    "customers": [
        # points to a table we can't see: must be ignored
        {"constrained_columns": ["region_id"], "referred_table": "hidden_regions", "referred_columns": ["id"]},
    ],
}
SHOP_TABLES = {"customers", "orders", "order_items", "products", "notes"}


def test_relationships_skip_unknown_tables():
    rels = relationships(SHOP_FKS, SHOP_TABLES)
    assert [(r.from_table, r.to_table) for r in rels] == [
        ("order_items", "orders"), ("order_items", "products"), ("orders", "customers"),
    ]


def test_join_path_through_the_graph_in_both_directions():
    rels = relationships(SHOP_FKS, SHOP_TABLES)
    path = find_join_path(rels, "customers", "products")
    assert [step.table for step in path] == ["orders", "order_items", "products"]
    assert path[0].on == (("customers.id", "orders.customer_id"),)
    assert path[2].on == (("order_items.product_id", "products.id"),)
    assert find_join_path(rels, "orders", "orders") == []
    assert find_join_path(rels, "orders", "notes") is None
    assert find_join_path(rels, "customers", "products", max_hops=2) is None


def test_composite_foreign_key():
    rels = [Relationship("lines", ("doc_type", "doc_no"), "docs", ("type", "no"))]
    (step,) = find_join_path(rels, "lines", "docs")
    assert step.on == (("lines.doc_type", "docs.type"), ("lines.doc_no", "docs.no"))


def test_describe_schema_marks_keys():
    columns = {
        "orders": [
            {"name": "id", "type": t.Integer(), "nullable": False},
            {"name": "customer_id", "type": t.Integer()},
            {"name": "total", "type": t.Numeric(10, 2)},
        ],
        "customers": [{"name": "id", "type": t.Integer(), "nullable": False}],
    }
    out = describe_schema(columns, {"orders": ["id"], "customers": ["id"]}, SHOP_FKS)
    assert out["version"] == 2 and [tb["name"] for tb in out["tables"]] == ["customers", "orders"]
    cols = {c["name"]: c for c in out["tables"][1]["columns"]}
    assert cols["id"]["primary_key"] and not cols["id"]["nullable"]
    assert cols["customer_id"]["foreign_key"] == {"table": "customers", "column": "id"}
    assert cols["total"]["type"] == "number" and cols["total"]["db_type"] == "NUMERIC(10, 2)"
    assert out["relationships"] == [
        {"from_table": "orders", "from_columns": ["customer_id"], "to_table": "customers", "to_columns": ["id"], "manual": False}
    ]


# ---------------------------------------------------------------- result envelope


def test_envelope_types_roles_and_serialisation():
    rows = [
        (1, "EU", Decimal("10.50"), dt.date(2026, 1, 1), None),
        (2, "US", Decimal("3"), dt.date(2026, 2, 1), True),
    ]
    env = build_envelope(["customer_id", "region", "revenue", "month", "vip"], rows, duration_ms=12.4, sql="SELECT 1")
    assert [(c.name, c.type, c.role) for c in env.columns] == [
        ("customer_id", "number", "dimension"),
        ("region", "string", "dimension"),
        ("revenue", "number", "measure"),
        ("month", "date", "dimension"),
        ("vip", "boolean", "dimension"),
    ]
    assert env.rows[0] == [1, "EU", 10.5, "2026-01-01", None]
    assert env.stats.row_count == 2 and env.stats.duration_ms == 12 and env.sql == "SELECT 1"


def test_envelope_keeps_duplicate_names_and_prefers_db_types():
    env = build_envelope(["id", "id"], [(None, "7")], db_types=[t.Integer(), t.NullType()])
    assert [c.type for c in env.columns] == ["number", "string"]
    assert env.model_dump()["rows"] == [[None, "7"]]


def test_helpers():
    assert infer_type([None, None]) == "unknown"
    assert infer_type([None, dt.datetime(2026, 1, 1)]) == "datetime"
    assert column_role("amount", "number") == "measure"
    assert column_role("order_id", "number") == "dimension"
    assert column_role("name", "string") == "dimension"
