"""The query cases on real database servers. Skipped unless a URL is given:

    NCODE_TEST_PG_URL=postgresql+psycopg://user:pass@host:5432/scratch_db
    NCODE_TEST_MYSQL_URL=mysql+pymysql://user:pass@host:3306/scratch_db      (MySQL or MariaDB)
    NCODE_TEST_MSSQL_URL=mssql+pymssql://user:pass@host:1433/scratch_db

WARNING: the tests create and drop tables named q_* in that database. Use an empty
scratch database and an account that may create tables - never production.
"""

import os

import pytest
from sqlalchemy import create_engine

from app.query.compiler import compile_spec
from app.query.spec import QuerySpec

from .query_cases import CASES, NOW, norm_rows
from .query_data import load, reflect

URLS = {name: os.environ.get(f"NCODE_TEST_{name.upper()}_URL") for name in ("pg", "mysql", "mssql")}


@pytest.fixture(scope="module", params=[n for n in URLS], ids=lambda n: n)
def live(request):
    url = URLS[request.param]
    if not url:
        pytest.skip(f"NCODE_TEST_{request.param.upper()}_URL not set")
    engine = create_engine(url)
    load(engine)
    tables, rels = reflect(engine)
    yield engine, tables, rels
    engine.dispose()


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.name)
def test_case_live(live, case):
    engine, tables, rels = live
    dialect = engine.dialect.name
    if dialect in case.skip:
        pytest.skip(f"not supported on {dialect}")
    spec = QuerySpec.model_validate({"connection": "live", **case.spec})
    compiled = compile_spec(spec, dialect=engine.dialect, tables=tables, relationships=rels, now=NOW)
    with engine.connect() as conn:
        rows = norm_rows(conn.execute(compiled.limited(1)).all())
    expected = case.expected
    if not case.ordered or _nulls_sort_differently(case, rows):
        rows, expected = sorted(rows, key=repr), sorted(expected, key=repr)
    assert rows == expected
    assert [c.name for c in compiled.columns]  # every output column is named


def _nulls_sort_differently(case, rows):
    # PostgreSQL sorts NULL last, the others first: the order of a NULL group is not part of the contract.
    return any(v is None for row in case.expected for v in row)


# ---------------------------------------------------------------- SQL mode on real servers

import time  # noqa: E402

from sqlalchemy.engine import make_url  # noqa: E402

from app.config import ConnectionConfig, Settings  # noqa: E402
from app.db import build_engine  # noqa: E402
from app.query.runner import QueryRunner, QueryTask, run_sql  # noqa: E402

# MariaDB on purpose registered as "mysql": Ncode must detect the server itself.
ENGINE_NAMES = {"postgresql": "postgresql", "mysql": "mysql", "mssql": "mssql"}
SLOW = {
    "postgresql": "SELECT pg_sleep(30)",
    "mysql": "SELECT SLEEP(30)",
    "mssql": "WITH n AS (SELECT CAST(1 AS BIGINT) AS i UNION ALL SELECT i + 1 FROM n WHERE i < 1000000000) "
             "SELECT COUNT_BIG(*) FROM n OPTION (MAXRECURSION 0)",
}


@pytest.fixture(scope="module")
def ncode_engine(live):
    """The same database through Ncode's own engine factory (read-only sessions, timeouts, guards)."""
    engine, _tables, _rels = live
    url = make_url(engine.url.render_as_string(hide_password=False))
    cfg = ConnectionConfig(
        key="live", label="live", engine=ENGINE_NAMES[engine.dialect.name], database=url.database,
        host=url.host or url.query.get("host"), port=url.port or int(url.query.get("port", 0)) or None,
        user=url.username, password=url.password,
    )
    ours = build_engine(cfg, Settings(statement_timeout_sec=20), pool_size=1)  # one connection: state must not leak
    yield ours
    ours.dispose()


def sql(engine, text, params=None, limit=100):
    return run_sql(engine, QueryTask(owner="t", connection="live", kind="sql"), text, params or {}, limit)


def test_sql_mode_rows_percent_and_params(ncode_engine):
    env = sql(ncode_engine, "SELECT name FROM q_customers WHERE name LIKE '50%' ORDER BY name")
    assert env.rows == [["50% Club"]]
    env = sql(ncode_engine, "SELECT name FROM q_customers WHERE name LIKE '%' || {{x}}" if ncode_engine.dialect.name == "postgresql"
              else "SELECT name FROM q_customers WHERE name = {{x}} AND name LIKE '%n%'", {"x": "Anna"})
    assert env.rows == [["Anna"]]


def test_sql_mode_cap_keeps_order_and_ctes_and_resets(ncode_engine):
    text = "WITH o AS (SELECT id, total FROM q_orders) SELECT id FROM o ORDER BY total DESC"
    env = sql(ncode_engine, text, limit=2)
    assert env.rows == [[3], [1]] and env.stats.truncated is True
    # the same pooled connection afterwards: no leftover row cap
    assert len(sql(ncode_engine, "SELECT id FROM q_orders", limit=100).rows) == 7
    # the user's own smaller LIMIT/TOP still wins
    small = "SELECT TOP 1 id FROM q_orders ORDER BY id" if ncode_engine.dialect.name == "mssql" else "SELECT id FROM q_orders ORDER BY id LIMIT 1"
    assert sql(ncode_engine, small, limit=5).rows == [[1]]


def test_sql_mode_sessions_are_read_only(ncode_engine):
    name = ncode_engine.dialect.name
    if name == "mssql":
        pytest.skip("SQL Server has no read-only session switch; use a SELECT-only login")
    if name == "postgresql":
        setting = sql(ncode_engine, "SELECT current_setting('default_transaction_read_only')").rows
        assert setting == [["on"]]
    # bypasses the guard on purpose: the database itself must refuse
    with pytest.raises(Exception, match="(?i)read.only|syntax error|DECLARE"):
        sql(ncode_engine, "DELETE FROM q_order_items")
    with pytest.raises(Exception):
        sql(ncode_engine, "WITH d AS (DELETE FROM q_order_items RETURNING 1) SELECT * FROM d" if name == "postgresql"
            else "UPDATE q_order_items SET qty = 0")
    assert len(sql(ncode_engine, "SELECT * FROM q_order_items").rows) == 5  # nothing changed


def test_mysql_family_timeout_matches_the_server(ncode_engine):
    if ncode_engine.dialect.name != "mysql":
        pytest.skip("MySQL / MariaDB only")
    with ncode_engine.connect() as conn:
        server = conn.exec_driver_sql("SELECT VERSION()").scalar()
        var = "max_statement_time" if "mariadb" in server.lower() else "max_execution_time"
        value = conn.exec_driver_sql(f"SELECT @@SESSION.{var}").scalar()
    assert float(value) in (20, 20000)


def test_cancel_stops_a_running_query(ncode_engine):
    runner = QueryRunner(workers=1, timeout_sec=60, cache_ttl_sec=0)
    task = QueryTask(owner="t", connection="live", kind="sql")
    runner.submit(task, lambda t: run_sql(ncode_engine, t, SLOW[ncode_engine.dialect.name], {}, 10))
    time.sleep(1.5)
    started = time.time()
    task.cancel()
    assert task.done.wait(15), "the query was not stopped"
    assert task.status == "cancelled" and time.time() - started < 10
    assert sql(ncode_engine, "SELECT 1 AS one").rows == [[1]]  # the connection still works
    runner.shutdown()


def test_saved_question_parameters_bind_on_the_server(ncode_engine, live):
    """M4: typed parameter values (dates, numbers) work against each server, in SQL and builder questions."""
    from app.content.params import ParameterDef, bind_spec, resolve, sql_bind_values

    defs = [ParameterDef(name="since", type="date"), ParameterDef(name="min_total", type="number")]
    values = sql_bind_values(resolve(defs, {"since": "2026-02-01", "min_total": "50"}), defs, ncode_engine.dialect.name)
    env = sql(ncode_engine, "SELECT id FROM q_orders WHERE paid_on >= {{since}} AND total >= {{min_total}} ORDER BY id", values)
    assert env.rows == [[3], [6]]

    engine, tables, rels = live
    spec = QuerySpec.model_validate({
        "connection": "live", "source": {"table": "q_orders"}, "aggregations": [{"fn": "count", "alias": "n"}],
        "filters": {"rules": [{"ref": "q_orders.paid_on", "op": "between", "param": "period"}]},
    })
    bound = bind_spec(spec, resolve([ParameterDef(name="period", type="date")], {"period": ["2026-01-01", "2026-01-31"]}))
    compiled = compile_spec(bound, dialect=engine.dialect, tables=tables, relationships=rels, now=NOW)
    with engine.connect() as conn:
        assert norm_rows(conn.execute(compiled.limited(1)).all()) == [(2,)]


def test_dashboard_date_range_on_a_timestamp_column(live):
    """M5: a dashboard date range applied to a datetime column counts the whole last day, on every server."""
    from app.content.dashboards import Card, DashboardFilter, add_conditions, apply_filters, filter_values

    engine, tables, rels = live
    period = DashboardFilter(id="period", label="Period", type="date_range")
    card = Card.model_validate({"key": "c", "kind": "question", "question_id": 1, "layout": {"x": 0, "y": 0, "w": 6, "h": 4},
                                "mappings": {"period": {"field": "q_orders.created_at"}}})
    values = filter_values([period], {"period": ["2026-01-01", "2026-01-11"]})
    _params, conditions = apply_filters(card, [period], values, "builder")
    spec = add_conditions(QuerySpec.model_validate({"connection": "live", "source": {"table": "q_orders"},
                                                    "aggregations": [{"fn": "count", "alias": "n"}]}), conditions)
    compiled = compile_spec(spec, dialect=engine.dialect, tables=tables, relationships=rels, now=NOW)
    with engine.connect() as conn:
        assert norm_rows(conn.execute(compiled.limited(1)).all()) == [(2,)]  # 2026-01-05 and 2026-01-11 23:59


def test_federated_sources_load_with_their_types(ncode_engine, live):
    """M6: rows read through each server's driver (Decimal, dates, booleans, NULLs) load into DuckDB and join."""
    from app.federation.engine import FederatedRun, Plan, PreparedSource
    from app.federation.spec import FederatedSpec
    from app.query.runner import fetch_sql

    spec = FederatedSpec.model_validate({
        "sources": [{"alias": "o", "type": "sql", "connection": "live", "sql": "x"},
                    {"alias": "c", "type": "sql", "connection": "live", "sql": "x"}],
        "joins": [{"source": "c", "type": "left", "on": [{"left": "o.customer_id", "right": "c.id"}]}],
        "post": {"breakouts": [{"ref": "region"}, {"ref": "created_at", "bucket": "month"}],
                 "aggregations": [{"fn": "sum", "ref": "total", "alias": "revenue"}],
                 "filters": {"rules": [{"ref": "vip", "op": "is_true"}]}, "order": [{"ref": "created_at_month"}]},
    })

    def source(alias, text):
        return PreparedSource(alias, alias, "sql", "live", fetch=lambda t: fetch_sql(ncode_engine, t, text, {}, 100))

    plan = Plan(spec=spec, post=spec.post_spec(None), sources=[
        source("o", "SELECT id, customer_id, total, created_at, paid_on FROM q_orders"),
        source("c", "SELECT id, name, region, vip FROM q_customers"),
    ])
    env = FederatedRun(plan, memory_mb=256, threads=1, default_rows=100, max_rows=1000)(
        QueryTask(owner="t", connection="", kind="federated"))
    assert env.rows == [["EU", "2026-01-01", 150.0]]  # Anna (VIP): both January orders
    types = {c["name"]: c["type"] for c in env.federation["combined_columns"]}
    assert types["total"] == "number" and types["created_at"] == "datetime" and types["paid_on"] == "date"
    assert types["vip"] in ("boolean", "number")  # SQL Server's BIT reads as a boolean, MySQL's TINYINT(1) as a number


def test_federated_join_across_servers():
    """M6 "done when": results of different servers joined on a key, with the unmatched-keys report."""
    from app.federation.engine import FederatedRun, Plan, PreparedSource
    from app.federation.spec import FederatedSpec
    from app.query.runner import fetch_sql

    urls = [u for u in URLS.values() if u]
    if len(urls) < 2:
        pytest.skip("needs two of NCODE_TEST_PG_URL / NCODE_TEST_MYSQL_URL / NCODE_TEST_MSSQL_URL")
    engines = [create_engine(u) for u in urls[:3]]
    for e in engines:
        load(e)
    try:
        def source(alias, engine, text):
            return PreparedSource(alias, f"{alias} on {engine.dialect.name}", "sql", engine.dialect.name,
                                  fetch=lambda t: fetch_sql(engine, t, text, {}, 100))

        sources = [source("orders", engines[0], "SELECT id, customer_id, total FROM q_orders"),
                   source("customers", engines[1], "SELECT id, name FROM q_customers WHERE id <> 4")]
        joins = [{"source": "customers", "type": "left", "on": [{"left": "orders.customer_id", "right": "customers.id"}]}]
        if len(engines) > 2:
            sources.append(source("items", engines[2], "SELECT order_id, sku FROM q_order_items"))
            joins.append({"source": "items", "type": "left", "on": [{"left": "orders.id", "right": "items.order_id"}]})
        spec = FederatedSpec.model_validate({"sources": [{"alias": s.alias, "type": "sql", "connection": "x", "sql": "x"} for s in sources],
                                             "joins": joins})
        env = FederatedRun(Plan(spec=spec, sources=sources, post=spec.post_spec(None)), memory_mb=256, threads=1,
                           default_rows=100, max_rows=1000)(QueryTask(owner="t", connection="", kind="federated"))
        first = env.federation["joins"][0]
        assert (first["left_rows"], first["left_unmatched_rows"], first["left_unmatched_keys"], first["left_samples"]) == (7, 2, 1, [4])
        assert env.federation["combined_rows"] == (8 if len(engines) > 2 else 7)  # order 1 has two items
    finally:
        for e in engines:
            e.dispose()


def test_text_dates_and_conditional_sums_on_the_server(live):
    """M7: "parse as date" on a text column (ISO, dotted, unix) and aggregations with a condition, per server."""
    from sqlalchemy import Column, Integer, MetaData, String, Table

    engine, tables, rels = live
    md = MetaData()
    events = Table("q_text_dates", md, Column("id", Integer, primary_key=True, autoincrement=False), Column("happened", String(40)))
    md.drop_all(engine)
    md.create_all(engine)
    values = ["2026-01-05", "07.01.2026 08:30", "1769904000", "1770076800000", "garbage", None, "2026-02-14T12:00:00"]
    with engine.begin() as conn:
        conn.execute(events.insert(), [{"id": i + 1, "happened": v} for i, v in enumerate(values)])
    try:
        schema = {**tables, "q_text_dates": [{"name": c.name, "type": c.type} for c in events.columns]}
        fields = {"q_text_dates": {"happened": {"parse_as_date": True}}}
        spec = QuerySpec.model_validate({
            "connection": "live", "source": {"table": "q_text_dates"},
            "breakouts": [{"ref": "happened", "bucket": "month", "alias": "month"}],
            "aggregations": [{"fn": "count", "alias": "n"},
                             {"fn": "count", "alias": "late", "where": {"rules": [{"ref": "happened", "op": ">=", "value": "2026-02-01"}]}}],
        })
        compiled = compile_spec(spec, dialect=engine.dialect, tables=schema, relationships=rels, now=NOW, fields=fields)
        with engine.connect() as conn:
            rows = {str(r[0])[:10] if r[0] is not None else None: (r[1], r[2]) for r in conn.execute(compiled.limited(1)).all()}
        assert rows == {None: (2, 0), "2026-01-01": (2, 0), "2026-02-01": (3, 3)}
    finally:
        md.drop_all(engine)
