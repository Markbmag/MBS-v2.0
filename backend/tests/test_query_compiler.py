"""QuerySpec compiler: errors (no database), golden SQL for 4 dialects, execution on SQLite."""

import os
import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.dialects import mssql, mysql, postgresql, sqlite

from app.query.compiler import CompileError, compile_spec, render_sql
from app.query.spec import QuerySpec

from .query_cases import CASES, NOW, norm_rows
from .query_data import load, reflect

GOLDEN = Path(__file__).parent / "golden" / "query"


def _mssql_2022():
    # Without a connection SQLAlchemy assumes a pre-2008 server (DATE -> DATETIME); be explicit.
    d = mssql.dialect()
    d.server_version_info = (16, 0)
    d._setup_version_attributes()
    return d


DIALECTS = {"postgresql": postgresql.dialect(), "mysql": mysql.dialect(), "mssql": _mssql_2022(), "sqlite": sqlite.dialect()}
GOLDEN_CASES = [
    "revenue_by_month_and_region", "bucket_created_at_week", "bucket_created_at_quarter", "bucket_created_at_hour",
    "bucket_paid_on_month", "bin_totals_by_50", "nested_and_or", "contains_literal_percent", "not_equal_keeps_nulls",
    "relative_last_month", "having_and_order_by_aggregate_alias", "avg_of_integers_is_not_truncated",
    "three_hop_join_via_foreign_keys", "explicit_join_with_aliases", "custom_expressions",
    "group_by_custom_expression_with_a_text_constant", "group_by_case_expression_with_a_threshold",
]


@pytest.fixture(scope="module")
def shop(tmp_path_factory):
    engine = create_engine(f"sqlite:///{tmp_path_factory.mktemp('q') / 'shop.db'}")
    load(engine)
    tables, rels = reflect(engine)
    yield engine, tables, rels
    engine.dispose()


def build(case_spec, tables, rels, dialect="sqlite", **kw):
    spec = QuerySpec.model_validate({"connection": "shop", **case_spec})
    return compile_spec(spec, dialect=dialect, tables=tables, relationships=rels, now=NOW, **kw)


def run(engine, compiled):
    with engine.connect() as conn:
        return conn.execute(compiled.limited(1)).all()


# ---------------------------------------------------------------- execution on SQLite

@pytest.mark.parametrize("case", CASES, ids=lambda c: c.name)
def test_case_on_sqlite(shop, case):
    if sqlite3.sqlite_version_info < (3, 39) and case.name == "full_join":
        pytest.skip("FULL JOIN needs SQLite 3.39+")
    engine, tables, rels = shop
    rows = norm_rows(run(engine, build(case.spec, tables, rels)))
    expected = case.expected
    if not case.ordered:
        rows, expected = sorted(rows, key=repr), sorted(expected, key=repr)
    assert rows == expected


def test_default_columns_types_and_truncation(shop):
    engine, tables, rels = shop
    compiled = build({"source": {"table": "q_customers"}, "limit": 2}, tables, rels)
    assert [(c.name, c.type) for c in compiled.columns] == [
        ("id", "number"), ("name", "string"), ("region", "string"), ("vip", "boolean"),
    ]
    assert compiled.limit == 2 and len(run(engine, compiled)) == 3  # limit + 1 tells the runner it was cut


def test_limit_is_capped(shop):
    _, tables, rels = shop
    assert build({"source": {"table": "q_orders"}, "limit": 10**6}, tables, rels, max_limit=500).limit == 500
    assert build({"source": {"table": "q_orders"}}, tables, rels, default_limit=7).limit == 7


def test_output_names_are_unique(shop):
    _, tables, rels = shop
    compiled = build({"source": {"table": "q_orders"}, "joins": [{"table": "q_customers"}]}, tables, rels)
    names = [c.name for c in compiled.columns]
    assert len(names) == len(set(names)) and "id" in names and "id_2" in names


# ---------------------------------------------------------------- errors

@pytest.mark.parametrize(
    "spec, message",
    [
        ({"source": {"table": "nope"}}, "Unknown table"),
        ({"source": {"table": "q_orders; DROP TABLE q_orders"}}, "Unknown table"),
        ({"source": {"table": "q_orders"}, "fields": [{"ref": "nope"}]}, "Unknown column"),
        ({"source": {"table": "q_orders"}, "fields": [{"ref": 'id" FROM q_orders; --'}]}, "Unknown column"),
        ({"source": {"table": "q_orders"}, "aggregations": [{"fn": "sum", "ref": "status"}]}, "sum needs a number"),
        ({"source": {"table": "q_orders"}, "filters": {"rules": [{"ref": "total", "op": "contains", "value": "1"}]}},
         "needs a text column"),
        ({"source": {"table": "q_orders"}, "breakouts": [{"ref": "status", "bucket": "month"}]}, "needs a date column"),
        ({"source": {"table": "q_orders"}, "breakouts": [{"ref": "status", "bin_width": 5}]}, "needs a number column"),
        ({"source": {"table": "q_orders"}, "filters": {"rules": [{"ref": "total", "op": "between", "value": [1]}]}},
         "two values"),
        ({"source": {"table": "q_orders"}, "filters": {"rules": [{"ref": "created_at", "op": "=", "value": "soon"}]}},
         "not a valid datetime"),
        ({"source": {"table": "q_orders"}, "filters": {"rules": [{"ref": "total", "op": "=", "value": "abc"}]}},
         "not a valid number"),
        ({"source": {"table": "q_orders"}, "joins": [{"table": "q_order_items"}], "fields": [{"ref": "qty"}]},
         "several tables"),
        ({"source": {"table": "q_orders"}, "aggregations": [{"fn": "count"}], "breakouts": [{"ref": "status"}],
          "order": [{"ref": "total"}]}, "Sort a summarised question"),
        ({"source": {"table": "q_products"}, "joins": [{"table": "q_products", "alias": "q_products"}]}, "already in"),
    ],
)
def test_compile_errors(shop, spec, message):
    _, tables, rels = shop
    with pytest.raises(CompileError, match=message):
        build(spec, tables, rels)


def test_join_without_a_relationship_is_an_error_not_silently_dropped(shop):
    _, tables, rels = shop
    tables = {**tables, "lonely": [{"name": "x", "type": tables["q_orders"][0]["type"]}]}
    with pytest.raises(CompileError, match="No relationship"):
        build({"source": {"table": "q_orders"}, "joins": [{"table": "lonely"}]}, tables, rels)


def test_full_join_on_mysql_is_refused(shop):
    _, tables, rels = shop
    with pytest.raises(CompileError, match="FULL JOIN"):
        build({"source": {"table": "q_orders"}, "joins": [{"table": "q_customers", "type": "full"}]}, tables, rels,
              dialect="mysql")


def test_spec_shape_errors():
    from pydantic import ValidationError

    base = {"connection": "x", "source": {"table": "t"}}
    for bad in (
        {"fields": [{"ref": "a"}], "aggregations": [{"fn": "count"}]},
        {"having": [{"ref": "a", "op": "=", "value": 1}]},
        {"aggregations": [{"fn": "sum"}]},
        {"expressions": [{"name": "e", "expr": {"ref": "a", "value": 1}}]},
        {"surprise": 1},
    ):
        with pytest.raises(ValidationError):
            QuerySpec.model_validate({**base, **bad})


# ---------------------------------------------------------------- golden SQL

@pytest.mark.parametrize("dialect_name", list(DIALECTS))
@pytest.mark.parametrize("case_name", GOLDEN_CASES)
def test_golden_sql(shop, case_name, dialect_name):
    """The exact SQL per database. After an intended change: UPDATE_GOLDEN=1 pytest, then review the diff."""
    _, tables, rels = shop
    case = next(c for c in CASES if c.name == case_name)
    dialect = DIALECTS[dialect_name]
    sql = render_sql(build(case.spec, tables, rels, dialect=dialect_name).limited(), dialect).strip() + "\n"
    path = GOLDEN / f"{case_name}.{dialect_name}.sql"
    if os.environ.get("UPDATE_GOLDEN"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(sql)
    assert path.exists(), f"missing golden file {path.name}; run UPDATE_GOLDEN=1 pytest"
    assert sql == path.read_text()
