"""Multi-source questions and uploaded files (M6)."""

import datetime as dt
import io

import pytest
from fastapi.testclient import TestClient

from app.federation.workspace import Workspace
from app.security import hash_password

from .helpers import auth
from .test_library_api import call, run
from .test_query_api import make_client, wait_done

ORDERS = {"alias": "o", "label": "Orders", "type": "builder", "spec": {
    "connection": "shop", "source": {"table": "q_orders"},
    "fields": [{"ref": "q_orders.id"}, {"ref": "q_orders.customer_id"}, {"ref": "q_orders.total"}, {"ref": "q_orders.status"}],
}}
CUSTOMERS = {"alias": "c", "label": "Customers", "type": "sql", "connection": "shop",
             "sql": "SELECT id, name, region FROM q_customers WHERE id <> 4"}
JOIN_C = {"source": "c", "type": "left", "on": [{"left": "o.customer_id", "right": "c.id"}]}
BY_REGION = {"breakouts": [{"ref": "region"}], "aggregations": [{"fn": "sum", "ref": "total", "alias": "revenue"}],
             "order": [{"ref": "region"}]}
TARGETS_CSV = b"customer;target;since\n1;120;01.02.2026\n2;150;15.03.2026\n9;10;\n"


def env_with(tmp_path, **settings):
    client, app_db = make_client(tmp_path, **settings)
    app_db.create_user("carol", hash_password("carol-pass-1"))
    return client, app_db


@pytest.fixture()
def env(tmp_path):
    client, app_db = env_with(tmp_path)
    with client:
        yield _logged_in(client, app_db)


def _logged_in(client: TestClient, app_db):
    return {
        "client": client,
        "db": app_db,
        "alice": auth(client, "alice", "alice-pass-1"),
        "bob": auth(client, "bob", "bob-pass-123"),      # may not use the "shop" connection
        "carol": auth(client, "carol", "carol-pass-1"),
        "admin": auth(client, "admin", "admin-pass-1"),
    }


def fed_run(env, who, spec, status=200, params=None, parameters=None):
    body = {"spec": spec, "params": params or {}, "parameters": parameters or [], "wait_ms": 10000}
    data = call(env, who, "POST", "/api/federated/run", status, json=body)
    if status == 200 and data["status"] == "running":
        data = wait_done(env["client"], env[who], data["task_id"])
    return data


def upload(env, who, filename, content, status=200, **params):
    res = env["client"].post("/api/datasets", params={"filename": filename, **params}, content=content,
                             headers={**env[who], "Content-Type": "application/octet-stream"})
    assert res.status_code == status, res.text
    return res.json()


# ---------------------------------------------------------------- joins and the unmatched-keys report

def test_join_reports_unmatched_keys(env):
    data = fed_run(env, "alice", {"sources": [ORDERS, CUSTOMERS], "joins": [JOIN_C], "post": BY_REGION})
    assert data["status"] == "completed", data["error"]
    result = data["result"]
    assert [c["name"] for c in result["columns"]] == ["region", "revenue"]
    # a LEFT join keeps every order; customer 4 and the order without a customer have no region
    assert result["rows"] == [["EU", 150.0], ["US", 230.0], [None, 85.5]]
    fed = result["federation"]
    assert [(s["alias"], s["rows"], s["truncated"]) for s in fed["sources"]] == [("o", 7, False), ("c", 3, False)]
    (j,) = fed["joins"]
    assert j["match"] == ["exact"]
    assert (j["left_rows"], j["left_unmatched_rows"], j["left_null_keys"]) == (7, 2, 1)
    assert (j["left_keys"], j["left_unmatched_keys"], j["left_samples"]) == (4, 1, [4])
    assert (j["right_rows"], j["right_unmatched_rows"], j["right_keys"]) == (3, 0, 3)
    assert (j["left_repeated_keys"], j["right_repeated_keys"]) == (2, 0)
    assert fed["combined_rows"] == 7
    names = [c["name"] for c in fed["combined_columns"]]
    assert names == ["o_id", "customer_id", "total", "status", "c_id", "name", "region"]  # clashing names get the source
    assert "LEFT JOIN" in result["sql"] and "-- o: Orders (7 rows)" in result["sql"]


def test_join_types_and_key_matching(env):
    text_ids = {"alias": "t", "type": "sql", "connection": "shop",
                "sql": "SELECT ' ' || CAST(id AS TEXT) || ' ' AS cid, name FROM q_customers UNION ALL SELECT 'x', 'nobody'"}
    inner = {"source": "t", "type": "inner", "on": [{"left": "o.customer_id", "right": "t.cid"}]}
    data = fed_run(env, "alice", {"sources": [ORDERS, text_ids], "joins": [inner]})
    assert data["status"] == "completed", data["error"]
    j = data["result"]["federation"]["joins"][0]
    assert j["match"] == ["number"]  # a number and text: compared as numbers (" 1 " = 1, "x" matches nothing)
    assert data["result"]["stats"]["row_count"] == 6 and j["right_unmatched_keys"] == 0 and j["right_null_keys"] == 1
    exact = {**inner, "on": [{"left": "o.customer_id", "right": "t.cid", "match": "exact"}]}
    data = fed_run(env, "alice", {"sources": [ORDERS, text_ids], "joins": [exact]})
    assert data["status"] == "error" and "Compare them as text or as numbers" in data["error"]
    as_text = {**inner, "on": [{"left": "o.customer_id", "right": "t.cid", "match": "text"}]}
    assert fed_run(env, "alice", {"sources": [ORDERS, text_ids], "joins": [as_text]})["result"]["stats"]["row_count"] == 6
    right = {"source": "c", "type": "right", "on": [{"left": "o.customer_id", "right": "c.id"}]}
    data = fed_run(env, "alice", {"sources": [ORDERS, CUSTOMERS], "joins": [right],
                                  "columns": [{"ref": "c.name", "alias": "who"}, {"ref": "o.total"}]})
    rows = data["result"]["rows"]
    assert data["result"]["columns"][0]["name"] == "who" and len(rows) == 5  # Anna x2, Bob x2, Chen x1


def test_spec_problems_are_400(env):
    loose = {"sources": [ORDERS, CUSTOMERS]}
    assert "join 'c'" in call(env, "alice", "POST", "/api/federated/run", 400, json={"spec": loose})["detail"]
    wrong_side = {"sources": [ORDERS, CUSTOMERS], "joins": [{"source": "c", "on": [{"left": "o.id", "right": "o.status"}]}]}
    assert "each key pairs" in call(env, "alice", "POST", "/api/federated/run", 400, json={"spec": wrong_side})["detail"]
    dup = {"sources": [ORDERS, {**CUSTOMERS, "alias": "o"}], "joins": []}
    assert "unique" in call(env, "alice", "POST", "/api/federated/run", 400, json={"spec": dup})["detail"]
    reserved = {"sources": [{**ORDERS, "alias": "result"}]}
    call(env, "alice", "POST", "/api/federated/run", 400, json={"spec": reserved})
    unknown_col = {"sources": [ORDERS, CUSTOMERS], "joins": [{"source": "c", "on": [{"left": "o.nope", "right": "c.id"}]}]}
    data = fed_run(env, "alice", unknown_col)
    assert data["status"] == "error" and "no column 'nope'" in data["error"]


def test_sql_over_the_sources_is_guarded(env):
    spec = {"sources": [ORDERS, CUSTOMERS], "mode": "sql",
            "sql": "SELECT c.region, count(*) AS n FROM o JOIN c ON o.customer_id = c.id WHERE o.status = {{status}} GROUP BY 1 ORDER BY 1"}
    data = fed_run(env, "alice", spec, params={"status": "paid"}, parameters=[{"name": "status"}])
    assert data["status"] == "completed", data["error"]
    assert data["result"]["rows"] == [["EU", 2], ["US", 1], [None, 1]]
    for bad, why in [
        ("SELECT * FROM read_csv('/etc/passwd')", "READ_CSV"),
        ("SELECT * FROM q_orders", "Unknown table"),
        ("SELECT * FROM '/etc/passwd'", "Unknown table"),
        ("SELECT * FROM duckdb_settings()", "DUCKDB_SETTINGS"),
        ("DELETE FROM o", "Only SELECT"),
        ("SELECT getenv('HOME')", "GETENV"),
    ]:
        detail = call(env, "alice", "POST", "/api/federated/run", 400, json={"spec": {**spec, "sql": bad}})["detail"]
        assert why in detail, (bad, detail)


def test_the_duckdb_session_is_locked():
    ws = Workspace(memory_mb=128, threads=1)
    try:
        ws.load_rows("t", ["a", "a", ""], [(1, "x", dt.date(2026, 1, 1)), (None, 2, None)])
        assert [n for n, _ in ws.columns("t")] == ["a", "a_2", "column_3"]
        assert [t for _, t in ws.columns("t")] == ["BIGINT", "VARCHAR", "DATE"]  # mixed values become text
        ws.lock()
        for sql in ["SELECT * FROM read_csv('/etc/passwd')", "SET enable_external_access = true", "INSTALL httpfs"]:
            with pytest.raises(Exception):
                ws.execute(sql)
    finally:
        ws.close()


def test_rows_per_source_are_capped(tmp_path):
    client, app_db = env_with(tmp_path, federation_source_rows=3)
    with client:
        env = _logged_in(client, app_db)
        data = fed_run(env, "alice", {"sources": [ORDERS]})
        (src,) = data["result"]["federation"]["sources"]
        assert (src["rows"], src["truncated"]) == (3, True)
        assert "cut off at the row limit" in data["result"]["sql"]


# ---------------------------------------------------------------- permissions

def test_sources_need_their_own_access(env):
    call(env, "bob", "POST", "/api/federated/run", 404, json={"spec": {"sources": [CUSTOMERS]}})
    ds = upload(env, "alice", "targets.csv", TARGETS_CSV)
    as_source = {"sources": [{"alias": "t", "type": "dataset", "dataset_id": ds["id"]}]}
    assert "Dataset not found" in call(env, "carol", "POST", "/api/federated/run", 404, json={"spec": as_source})["detail"]
    shared = call(env, "alice", "POST", "/api/collections", json={"name": "Shared files"})
    call(env, "alice", "PATCH", f"/api/datasets/{ds['id']}", json={"collection_id": shared["id"]})
    call(env, "alice", "PUT", f"/api/collections/{shared['id']}/permissions",
         json={"grants": [{"user": "carol", "level": "view"}]})
    assert fed_run(env, "carol", as_source)["result"]["stats"]["row_count"] == 3
    call(env, "carol", "PATCH", f"/api/datasets/{ds['id']}", 403, json={"name": "mine now"})
    # a saved question as a source needs view access to it
    q = call(env, "alice", "POST", "/api/questions", json={"name": "Customers", "kind": "sql", "connection": "shop",
                                                           "spec": {"sql": "SELECT * FROM q_customers"}})
    by_question = {"sources": [{"alias": "q", "type": "question", "question_id": q["id"]}]}
    assert "not found" in call(env, "carol", "POST", "/api/federated/run", 404, json={"spec": by_question})["detail"]


# ---------------------------------------------------------------- uploads

def test_upload_csv_infers_types_and_joins(env):
    ds = upload(env, "alice", "targets.csv", TARGETS_CSV, name="Targets", delimiter="semicolon")
    assert ds["name"] == "Targets" and ds["row_count"] == 3 and ds["source_format"] == "csv"
    assert ds["columns"] == [{"name": "customer", "type": "number"}, {"name": "target", "type": "number"},
                             {"name": "since", "type": "date"}]
    t = {"alias": "t", "type": "dataset", "dataset_id": ds["id"]}
    spec = {"sources": [CUSTOMERS, t], "joins": [{"source": "t", "type": "full", "on": [{"left": "c.id", "right": "t.customer"}]}],
            "post": {"fields": [{"ref": "name"}, {"ref": "target"}, {"ref": "since"}], "order": [{"ref": "customer"}]}}
    data = fed_run(env, "alice", spec)
    assert data["status"] == "completed", data["error"]
    assert data["result"]["rows"] == [["Anna", 120, "2026-02-01"], ["Bob", 150, "2026-03-15"], [None, 10, None], ["Chen", None, None]]
    j = data["result"]["federation"]["joins"][0]
    assert (j["left_unmatched_keys"], j["right_unmatched_keys"], j["right_samples"]) == (1, 1, [9])
    listed = call(env, "alice", "GET", "/api/datasets")["datasets"]
    assert [d["id"] for d in listed] == [ds["id"]]
    assert call(env, "carol", "GET", "/api/datasets")["datasets"] == []


def test_upload_xlsx_and_parquet(env, tmp_path):
    from openpyxl import Workbook

    wb = Workbook()
    sheet = wb.active
    sheet.title = "Plan"
    sheet.append(["VIN", "Planned", "Qty", None])
    sheet.append(["V1", dt.datetime(2026, 1, 3), 5, None])
    sheet.append([None, None, None, None])  # empty rows are skipped
    sheet.append(["V2", dt.datetime(2026, 1, 4), "n/a", None])
    other = wb.create_sheet("Other")
    other.append(["x"])
    other.append([1])
    buf = io.BytesIO()
    wb.save(buf)
    ds = upload(env, "alice", "plan.xlsx", buf.getvalue())
    assert ds["columns"] == [{"name": "VIN", "type": "string"}, {"name": "Planned", "type": "date"},
                             {"name": "Qty", "type": "string"}]  # 5 and "n/a" in one column: text
    assert ds["row_count"] == 2
    assert upload(env, "alice", "plan.xlsx", buf.getvalue(), sheet="Other")["columns"] == [{"name": "x", "type": "number"}]
    assert "no sheet" in upload(env, "alice", "plan.xlsx", buf.getvalue(), 400, sheet="Nope")["detail"]

    import duckdb

    path = tmp_path / "f.parquet"
    duckdb.connect().execute(
        f"COPY (SELECT 1 AS a, [1, 2] AS l, TIMESTAMP '2026-01-01 10:00:00' AS ts) TO '{path}' (FORMAT parquet)"
    )
    pq = upload(env, "alice", "f.parquet", path.read_bytes())
    assert pq["columns"] == [{"name": "a", "type": "number"}, {"name": "l", "type": "string"}, {"name": "ts", "type": "datetime"}]


def test_upload_limits_and_bad_files(tmp_path):
    client, app_db = env_with(tmp_path, dataset_max_mb=1, dataset_max_rows=2)
    with client:
        env = _logged_in(client, app_db)
        assert "more than 2 rows" in upload(env, "alice", "t.csv", TARGETS_CSV, 400)["detail"]
        assert upload(env, "alice", "big.csv", b"a\n" + b"1\n" * 600_000, 413)["detail"].startswith("The file is larger")
        assert ".xlsx or .csv" in upload(env, "alice", "old.xls", b"x", 400)["detail"]
        assert "Upload a .csv" in upload(env, "alice", "x.exe", b"x", 400)["detail"]
        assert "empty" in upload(env, "alice", "x.csv", b"", 400)["detail"]
        assert "workbook" in upload(env, "alice", "x.xlsx", b"not a zip", 400)["detail"]
        assert "Unknown delimiter" in upload(env, "alice", "x.csv", b"a\n1\n", 400, delimiter="?")["detail"]
        assert list((tmp_path / "datasets").iterdir()) == []  # nothing left behind


def test_uploads_can_be_turned_off(tmp_path):
    client, app_db = env_with(tmp_path, uploads_enabled=False)
    with client:
        env = _logged_in(client, app_db)
        assert "turned off" in upload(env, "alice", "t.csv", TARGETS_CSV, 403)["detail"]


def test_dataset_lifecycle_removes_the_file(env, tmp_path):
    ds = upload(env, "alice", "targets.csv", TARGETS_CSV, delimiter="semicolon")
    folder = tmp_path / "datasets"
    assert len(list(folder.iterdir())) == 1
    call(env, "alice", "DELETE", f"/api/datasets/{ds['id']}", 409)
    call(env, "alice", "PATCH", f"/api/datasets/{ds['id']}", json={"archived": True, "name": "Old targets"})
    archive = call(env, "alice", "GET", "/api/library/archive")
    assert [d["name"] for d in archive["datasets"]] == ["Old targets"]
    call(env, "alice", "DELETE", f"/api/datasets/{ds['id']}")
    assert list(folder.iterdir()) == []
    # deleting a collection removes the files of the datasets in it
    col = call(env, "alice", "POST", "/api/collections", json={"name": "Files"})
    upload(env, "alice", "targets.csv", TARGETS_CSV, collection_id=col["id"])
    assert call(env, "alice", "GET", f"/api/collections/{col['id']}")["datasets"][0]["row_count"] == 3
    call(env, "alice", "PATCH", f"/api/collections/{col['id']}", json={"archived": True})
    call(env, "alice", "DELETE", f"/api/collections/{col['id']}")
    assert list(folder.iterdir()) == []


# ---------------------------------------------------------------- saved, with parameters, on a dashboard

def test_saved_multi_source_question_with_parameters_on_a_dashboard(env):
    by_status = call(env, "alice", "POST", "/api/questions", json={
        "name": "Orders by status", "kind": "sql", "connection": "shop",
        "spec": {"sql": "SELECT id, customer_id, total FROM q_orders WHERE status = {{status}}"},
        "parameters": [{"name": "status", "default": "paid"}],
    })
    spec = {"sources": [{"alias": "o", "type": "question", "question_id": by_status["id"]}, CUSTOMERS],
            "joins": [{"source": "c", "type": "inner", "on": [{"left": "o.customer_id", "right": "c.id"}]}],
            "post": {**BY_REGION, "filters": {"op": "and", "rules": [{"ref": "total", "op": ">=", "value": None, "param": "min_total"}]}},
            "result_columns": [{"name": "region", "type": "string"}]}
    params = [{"name": "status", "label": "Status"}, {"name": "min_total", "type": "number"}, {"name": "unused"}]
    saved = call(env, "alice", "POST", "/api/questions", json={"name": "Revenue (MES + CRM)", "kind": "federated",
                                                              "spec": spec, "parameters": params})
    assert saved["connection"] == "" and [p["name"] for p in saved["parameters"]] == ["status", "min_total"]
    assert run(env, "alice", saved["id"])["result"]["rows"] == [["EU", 150.0], ["US", 200.0], [None, 0.0]]
    assert run(env, "alice", saved["id"], {"status": "refunded"})["result"]["rows"] == [["US", 30.0]]
    assert run(env, "alice", saved["id"], {"min_total": 60})["result"]["rows"] == [["EU", 100.0], ["US", 200.0]]

    board = call(env, "alice", "POST", "/api/dashboards", json={"name": "Combined"})
    definition = {
        "filters": [{"id": "region", "label": "Region", "type": "category"}, {"id": "status", "label": "Status", "type": "text"}],
        "cards": [{"key": "a", "kind": "question", "question_id": saved["id"], "layout": {"x": 0, "y": 0, "w": 6, "h": 6},
                   "mappings": {"region": {"field": "region"}, "status": {"param": "status"}}}],
    }
    shown = call(env, "alice", "PUT", f"/api/dashboards/{board['id']}", json=definition)
    assert shown["cards"][0]["question"]["fields"] == [{"name": "region", "type": "string"}]
    res = call(env, "alice", "POST", f"/api/dashboards/{board['id']}/cards/a/run",
               json={"filters": {"region": ["US"], "status": "refunded"}, "wait_ms": 10000})
    if res["status"] == "running":
        res = wait_done(env["client"], env["alice"], res["task_id"])
    assert res["status"] == "completed", res["error"]
    assert res["result"]["rows"] == [["US", 30.0]]

    # someone who may see the question but not use the database gets the source's 404
    col = call(env, "alice", "POST", "/api/collections", json={"name": "Team"})
    call(env, "alice", "PATCH", f"/api/questions/{saved['id']}", json={"collection_id": col["id"]})
    call(env, "alice", "PATCH", f"/api/questions/{by_status['id']}", json={"collection_id": col["id"]})
    call(env, "alice", "PUT", f"/api/collections/{col['id']}/permissions", json={"grants": [{"role": "all", "level": "view"}]})
    assert "o: Unknown connection" in run(env, "bob", saved["id"], status=404)["detail"]
    assert run(env, "carol", saved["id"])["status"] == "completed"


def test_saving_checks_the_sources(env):
    bad_sql = {"sources": [ORDERS, {**CUSTOMERS, "sql": "DELETE FROM q_customers"}], "joins": [JOIN_C]}
    detail = call(env, "alice", "POST", "/api/questions", 400, json={"name": "x", "kind": "federated", "spec": bad_sql})["detail"]
    assert detail.startswith("Customers:")
    undeclared = {"sources": [ORDERS], "post": {"filters": {"op": "and", "rules": [{"ref": "total", "op": ">", "param": "x"}]}}}
    assert "not declared" in call(env, "alice", "POST", "/api/questions", 400, json={"name": "x", "kind": "federated", "spec": undeclared})["detail"]
    call(env, "bob", "POST", "/api/questions", 404, json={"name": "x", "kind": "federated", "spec": {"sources": [ORDERS]}})
    nested = call(env, "alice", "POST", "/api/questions", json={"name": "inner", "kind": "federated", "spec": {"sources": [ORDERS]}})
    outer = {"sources": [{"alias": "n", "type": "question", "question_id": nested["id"]}]}
    assert "cannot be a source" in call(env, "alice", "POST", "/api/questions", 400, json={"name": "y", "kind": "federated", "spec": outer})["detail"]
