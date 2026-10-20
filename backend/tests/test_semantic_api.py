"""Semantic layer, transforms, profiles and X-ray (M7)."""

import pytest
from sqlalchemy import create_engine, text

from .test_federation_api import _logged_in, env_with
from .test_library_api import call, run
from .test_query_api import wait_done

EVENTS = [
    (1, "2026-01-05", "10"), (2, "07.01.2026 08:30", "5"), (3, "1769904000", "7"),  # 2026-02-01 as unix seconds
    (4, "1770076800000", "1"), (5, "garbage", "3"), (6, None, "2"), (7, "2026-02-14T12:00:00", "4"),
]


def _shop_extras(tmp_path):
    """Tables without foreign keys and with dates stored as text, as in MES/LES exports."""
    engine = create_engine(f"sqlite:///{tmp_path / 'shop.db'}")
    with engine.begin() as c:
        c.execute(text("CREATE TABLE q_events (id INTEGER PRIMARY KEY, happened TEXT, amount TEXT)"))
        for row in EVENTS:
            c.execute(text("INSERT INTO q_events VALUES (:a, :b, :c)"), {"a": row[0], "b": row[1], "c": row[2]})
        c.execute(text("CREATE TABLE q_notes (order_ref INTEGER, note TEXT)"))
        c.execute(text("INSERT INTO q_notes VALUES (1, 'gift'), (3, 'urgent')"))
    engine.dispose()


@pytest.fixture()
def env(tmp_path):
    client, app_db = env_with(tmp_path)
    _shop_extras(tmp_path)
    with client:
        yield _logged_in(client, app_db)


def query(env, who, spec, status=200):
    data = call(env, who, "POST", "/api/query", status, json={"spec": spec, "wait_ms": 8000})
    if status == 200 and data["status"] == "running":
        data = wait_done(env["client"], env[who], data["task_id"])
    return data


def task(env, who, path, body, status=200):
    data = call(env, who, "POST", path, status, json={**body, "wait_ms": 10000})
    if status == 200 and data["status"] == "running":
        data = wait_done(env["client"], env[who], data["task_id"])
    return data


# ---------------------------------------------------------------- column metadata

def test_column_metadata_is_admin_only_and_shows_everywhere(env):
    body = {"display_name": "Order total", "semantic_type": "currency", "format": {"style": "currency", "currency": "EUR"}}
    call(env, "alice", "PUT", "/api/semantic/shop/fields/q_orders/total", 403, json=body)
    call(env, "admin", "PUT", "/api/semantic/shop/fields/q_orders/nope", 404, json=body)
    call(env, "admin", "PUT", "/api/semantic/shop/fields/q_orders/total", json=body)
    call(env, "admin", "PUT", "/api/semantic/shop/fields/q_orders/qty", json={"hidden": True})
    schema = call(env, "alice", "GET", "/api/connections/shop/schema")
    cols = {c["name"]: c for c in next(t for t in schema["tables"] if t["name"] == "q_orders")["columns"]}
    assert cols["total"]["display_name"] == "Order total" and cols["qty"]["hidden"] is True
    assert "display_name" not in cols["status"]

    rows = query(env, "alice", {"connection": "shop", "source": {"table": "q_orders"}, "limit": 2})["result"]
    names = [c["name"] for c in rows["columns"]]
    assert "qty" not in names  # hidden: not shown by default ...
    total = next(c for c in rows["columns"] if c["name"] == "total")
    assert total["display_name"] == "Order total" and total["format"]["currency"] == "EUR"
    picked = query(env, "alice", {"connection": "shop", "source": {"table": "q_orders"}, "fields": [{"ref": "qty"}]})
    assert picked["status"] == "completed"  # ... but still usable by name
    summed = query(env, "alice", {"connection": "shop", "source": {"table": "q_orders"},
                                  "aggregations": [{"fn": "sum", "ref": "total", "alias": "revenue"}]})["result"]
    assert summed["columns"][0]["format"]["currency"] == "EUR" and summed["columns"][0]["display_name"] is None
    # clearing everything removes the entry
    call(env, "admin", "PUT", "/api/semantic/shop/fields/q_orders/qty", json={})
    assert "qty" not in call(env, "alice", "GET", "/api/semantic/shop/fields")["fields"]["q_orders"]
    call(env, "bob", "GET", "/api/semantic/shop/fields", 404)  # no access to the connection


def test_parse_as_date_turns_text_into_dates(env):
    call(env, "admin", "PUT", "/api/semantic/shop/fields/q_events/happened", json={"parse_as_date": True})
    schema = call(env, "alice", "GET", "/api/connections/shop/schema")
    col = next(c for t in schema["tables"] if t["name"] == "q_events" for c in t["columns"] if c["name"] == "happened")
    assert col["type"] == "datetime" and col["db_type"].upper().startswith("TEXT")
    by_month = query(env, "alice", {
        "connection": "shop", "source": {"table": "q_events"},
        "breakouts": [{"ref": "happened", "bucket": "month", "alias": "month"}], "aggregations": [{"fn": "count", "alias": "n"}],
    })["result"]
    assert by_month["rows"] == [[None, 2], ["2026-01-01", 2], ["2026-02-01", 3]]  # garbage and NULL have no date
    since = query(env, "alice", {
        "connection": "shop", "source": {"table": "q_events"}, "fields": [{"ref": "id"}],
        "filters": {"rules": [{"ref": "happened", "op": ">=", "value": "2026-02-01"}]}, "order": [{"ref": "id"}],
    })["result"]
    assert [r[0] for r in since["rows"]] == [3, 4, 7]


# ---------------------------------------------------------------- relationships

def test_manual_relationships_let_the_builder_join(env):
    spec = {"connection": "shop", "source": {"table": "q_notes"}, "joins": [{"table": "q_orders"}],
            "fields": [{"ref": "q_notes.note"}, {"ref": "q_orders.status"}], "order": [{"ref": "q_notes.note"}]}
    assert "No relationship" in query(env, "alice", spec, 400)["detail"]
    rel = {"from_table": "q_notes", "from_columns": ["order_ref"], "to_table": "q_orders", "to_columns": ["id"]}
    call(env, "alice", "POST", "/api/semantic/shop/relationships", 403, json=rel)
    call(env, "admin", "POST", "/api/semantic/shop/relationships", 404, json={**rel, "to_columns": ["nope"]})
    added = call(env, "admin", "POST", "/api/semantic/shop/relationships", json=rel)
    assert query(env, "alice", spec)["result"]["rows"] == [["gift", "paid"], ["urgent", "paid"]]
    schema = call(env, "alice", "GET", "/api/connections/shop/schema")
    assert {"from_table": "q_notes", "from_columns": ["order_ref"], "to_table": "q_orders", "to_columns": ["id"],
            "manual": True} in schema["relationships"]
    call(env, "admin", "DELETE", f"/api/semantic/shop/relationships/{added['id']}")
    query(env, "alice", spec, 400)


# ---------------------------------------------------------------- metrics

PAID = {"op": "and", "rules": [{"ref": "q_orders.status", "op": "=", "value": "paid"}]}


def test_metrics_in_questions_and_dashboards(env):
    body = {"name": "Paid revenue", "connection": "shop", "table": "q_orders",
            "definition": {"fn": "sum", "ref": "total", "where": PAID}, "format": {"style": "currency", "currency": "USD"}}
    call(env, "alice", "POST", "/api/metrics", 403, json=body)
    bad = {**body, "definition": {"fn": "sum", "ref": "status"}}
    assert "number" in call(env, "admin", "POST", "/api/metrics", 400, json=bad)["detail"]
    metric = call(env, "admin", "POST", "/api/metrics", json=body)
    assert metric["slug"] == "paid_revenue"
    assert [m["name"] for m in call(env, "alice", "GET", "/api/metrics")["metrics"]] == ["Paid revenue"]
    assert call(env, "bob", "GET", "/api/metrics")["metrics"] == []  # bob may not use "shop"

    spec = {"connection": "shop", "source": {"table": "q_orders"}, "joins": [{"table": "q_customers"}],
            "breakouts": [{"ref": "q_customers.region", "alias": "region"}],
            "aggregations": [{"fn": "metric", "metric": metric["id"]}, {"fn": "count", "alias": "orders"}],
            "order": [{"ref": "paid_revenue", "dir": "desc"}]}
    result = query(env, "alice", spec)["result"]
    assert [c["name"] for c in result["columns"]] == ["region", "paid_revenue", "orders"]
    assert result["rows"] == [["US", 200.0, 2], ["EU", 150.0, 3], [None, 10.0, 2]]
    assert result["columns"][1]["format"]["currency"] == "USD"

    q = call(env, "alice", "POST", "/api/questions", json={"name": "Paid by region", "kind": "builder", "spec": spec})
    board = call(env, "alice", "POST", "/api/dashboards", json={"name": "Money"})
    call(env, "alice", "PUT", f"/api/dashboards/{board['id']}", json={
        "cards": [{"key": "a", "kind": "question", "question_id": q["id"], "layout": {"x": 0, "y": 0, "w": 6, "h": 4}}]})
    card = call(env, "alice", "POST", f"/api/dashboards/{board['id']}/cards/a/run", json={"wait_ms": 8000})
    if card["status"] == "running":
        card = wait_done(env["client"], env["alice"], card["task_id"])
    assert card["result"]["rows"][0] == ["US", 200.0, 2]

    # a changed definition applies everywhere; an archived metric is refused with a clear message
    call(env, "admin", "PUT", f"/api/metrics/{metric['id']}", json={**body, "definition": {"fn": "sum", "ref": "total"}})
    assert run(env, "alice", q["id"])["result"]["rows"][0] == ["US", 230.0, 2]
    call(env, "admin", "PATCH", f"/api/metrics/{metric['id']}", json={"archived": True})
    assert call(env, "alice", "GET", "/api/metrics")["metrics"] == []
    assert run(env, "alice", q["id"])["result"]["rows"][0][1] == 230.0  # archived: hidden from pickers, still defined


def test_metric_without_format_keeps_the_column_format(env):
    call(env, "admin", "PUT", "/api/semantic/shop/fields/q_orders/total", json={"format": {"style": "currency", "currency": "EUR"}})
    m = call(env, "admin", "POST", "/api/metrics", json={"name": "Revenue", "connection": "shop", "table": "q_orders",
                                                         "definition": {"fn": "sum", "ref": "q_orders.total"}})
    out = query(env, "alice", {"connection": "shop", "source": {"table": "q_orders"}, "aggregations": [{"fn": "metric", "metric": m["id"]}]})
    assert out["result"]["columns"][0]["format"]["currency"] == "EUR" and out["result"]["rows"] == [[465.5]]


def test_conditional_aggregation(env):
    spec = {"connection": "shop", "source": {"table": "q_orders"},
            "aggregations": [{"fn": "count", "alias": "paid", "where": PAID}, {"fn": "sum", "ref": "total", "alias": "paid_total", "where": PAID},
                             {"fn": "count", "alias": "all"}]}
    assert query(env, "alice", spec)["result"]["rows"] == [[5, 360.0, 7]]


# ---------------------------------------------------------------- transforms

def test_transforms_on_builder_sql_and_saved_questions(env):
    spec = {"connection": "shop", "source": {"table": "q_orders"},
            "breakouts": [{"ref": "created_at", "bucket": "month", "alias": "month"}],
            "aggregations": [{"fn": "sum", "ref": "total", "alias": "revenue"}],
            "transforms": [{"type": "running_total", "column": "revenue"}, {"type": "pct_of_total", "column": "revenue"},
                           {"type": "previous_period", "column": "revenue", "period": "month"}]}
    result = query(env, "alice", spec)["result"]
    names = [c["name"] for c in result["columns"]]
    assert names == ["month", "revenue", "revenue_running_total", "revenue_pct_of_total", "revenue_prev_month", "revenue_vs_prev_month"]
    rows = {r[0]: r for r in result["rows"]}
    assert rows["2026-12-01"][2] == 465.5
    assert rows["2026-02-01"][4] == 150.0 and rows["2026-02-01"][5] == pytest.approx(230 / 150 - 1)
    assert rows["2026-04-01"][4] is None  # March had no orders: no previous month to compare with
    assert result["columns"][3]["format"] == {"style": "percent", "decimals": 1} and result["columns"][2]["generated"]

    sql = call(env, "alice", "POST", "/api/query/sql", json={
        "connection": "shop", "sql": "SELECT status, count(*) AS n FROM q_orders WHERE status IS NOT NULL GROUP BY status",
        "transforms": [{"type": "rank", "column": "n"}], "wait_ms": 5000})
    assert sorted(r[2] for r in sql["result"]["rows"]) == [1, 2]
    saved = call(env, "alice", "POST", "/api/questions", json={
        "name": "Ranked", "kind": "sql", "connection": "shop",
        "spec": {"sql": "SELECT status, count(*) AS n FROM q_orders GROUP BY status", "transforms": [{"type": "pct_of_total", "column": "n"}]}})
    assert run(env, "alice", saved["id"])["result"]["columns"][-1]["name"] == "n_pct_of_total"
    bad = {**spec, "transforms": [{"type": "rank", "column": "nope"}]}
    failed = query(env, "alice", bad)
    assert failed["status"] == "error" and "no column 'nope'" in failed["error"]


# ---------------------------------------------------------------- profiles, X-ray, models

def test_profile_a_table_and_a_result(env):
    data = task(env, "alice", "/api/profile/table", {"connection": "shop", "table": "q_orders"})
    profile = data["result"]["analysis"]["profile"]
    assert profile["rows_profiled"] == 7 and profile["total_rows"] == 7 and not profile["sampled"]
    cols = {c["name"]: c for c in profile["columns"]}
    assert cols["total"]["max"] == 200 and cols["total"]["median"] == 50 and cols["total"]["histogram"]
    assert cols["status"]["top"][0] == {"value": "paid", "count": 5} and cols["status"]["nulls"] == 1
    assert cols["created_at"]["type"] == "datetime" and cols["created_at"]["unit"] == "month"
    assert cols["id"]["unique"] and cols["id"]["id_like"]
    assert profile["correlations"]["columns"] == ["total", "qty"]

    events = task(env, "alice", "/api/profile/table", {"connection": "shop", "table": "q_events"})["result"]["analysis"]["profile"]
    happened = next(c for c in events["columns"] if c["name"] == "happened")
    assert happened["looks_like_dates"]  # the hint to switch on "parse as date"

    ran = query(env, "alice", {"connection": "shop", "source": {"table": "q_orders"}})
    result_profile = call(env, "alice", "POST", f"/api/query/tasks/{ran['task_id']}/profile")
    assert {c["name"]: c["type"] for c in result_profile["columns"]}["paid_on"] == "date"
    call(env, "carol", "POST", f"/api/query/tasks/{ran['task_id']}/profile", 404)
    call(env, "bob", "POST", "/api/profile/table", 404, json={"connection": "shop", "table": "q_orders"})


def test_xray_of_a_table_and_of_a_question(env):
    data = task(env, "alice", "/api/xray", {"connection": "shop", "table": "q_orders"})
    cards = data["result"]["analysis"]["cards"]
    keys = [c["key"] for c in cards]
    assert keys[:2] == ["rows", "total_total"] and "rows_by_created_at" in keys and "rows_by_status" in keys
    for card in cards:
        assert query(env, "alice", card["spec"])["status"] == "completed", card["key"]
    q = call(env, "alice", "POST", "/api/questions", json={
        "name": "Paid orders", "kind": "builder",
        "spec": {"connection": "shop", "source": {"table": "q_orders"}, "joins": [{"table": "q_customers"}], "filters": PAID}})
    xq = task(env, "alice", "/api/xray", {"question_id": q["id"]})["result"]["analysis"]
    assert xq["title"] == "Paid orders" and xq["profile"]["total_rows"] == 5
    region = next(c for c in xq["cards"] if c["key"] == "rows_by_q_customers_region")
    assert region["spec"]["filters"] == PAID and query(env, "alice", region["spec"])["status"] == "completed"
    sql = call(env, "alice", "POST", "/api/questions", json={"name": "s", "kind": "sql", "connection": "shop", "spec": {"sql": "SELECT 1 AS x"}})
    call(env, "alice", "POST", "/api/xray", 400, json={"question_id": sql["id"]})


def test_models(env):
    q = call(env, "alice", "POST", "/api/questions", json={"name": "Clean orders", "kind": "builder",
                                                           "spec": {"connection": "shop", "source": {"table": "q_orders"}}})
    assert q["model"] is False
    assert call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"model": True})["model"] is True
    models = call(env, "alice", "GET", "/api/questions", params={"models": True})["questions"]
    assert [m["name"] for m in models] == ["Clean orders"]
