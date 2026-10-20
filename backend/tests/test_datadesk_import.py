"""DataDesk importer (M4) on a fixture built from DataDesk's schema."""

import sqlite3

import pytest

from app.content.datadesk import ImportError_, convert_single, parse_map, run_import
from app.content.datadesk import Unconvertible
from app.content.store import ContentStore
from app.manage import main as manage

from . import datadesk_fixture
from .test_library_api import call, library_env, run

CONNECTIONS = {"shop": "sqlite", "crm": "postgresql"}


@pytest.fixture()
def env(tmp_path):
    yield from library_env(tmp_path)


@pytest.fixture()
def datadesk(tmp_path):
    path = tmp_path / "app-data.sqlite"
    datadesk_fixture.build(path)
    return path


def do_import(env, path, dry_run):
    db = env["db"]
    return run_import(
        path, ContentStore(db.engine), db.get_user_by_name("admin"),
        mapping={"db1": "shop", "db2": "crm"}, connections=CONNECTIONS, dry_run=dry_run,
    )


def outcomes(report):
    return {i.source_id: i.outcome for i in report.items}


def test_dry_run_reports_and_writes_nothing(env, datadesk):
    before = datadesk.read_bytes()
    report = do_import(env, datadesk, dry_run=True)
    assert outcomes(report) == {1: "builder", 2: "sql", 3: "skipped", 4: "federated", 5: "skipped", 6: "builder", 7: "skipped"}
    assert "FULL JOIN" in " ".join(report.items[3].notes)
    notes = {i.source_id: " ".join(i.notes) for i in report.items}
    assert "read-only guard" in notes[3]
    assert "'regex' is not known" in notes[5]
    assert "db9" in notes[7]
    assert report.dashboards == [("Sales", 2), ("Operations", 2)] and report.dashboard_outcomes == ["new", "new"]
    assert any("99" in w for w in report.warnings)
    text = report.text()
    assert "DRY RUN" in text and "| 3 | Cleanup | sql | skipped |" in text
    assert call(env, "admin", "GET", "/api/questions")["questions"] == []
    assert datadesk.read_bytes() == before  # DataDesk's file is only read


def test_import_creates_questions_in_dashboard_collections(env, datadesk):
    report = do_import(env, datadesk, dry_run=False)
    assert "Import finished" in report.text()
    questions = {q["name"]: q for q in call(env, "admin", "GET", "/api/questions")["questions"]}
    assert set(questions) == {"Revenue by region", "Orders per status", "Orders vs tickets", "Customers starting with A"}
    assert questions["Revenue by region"]["collection"]["name"] == "Sales"
    assert questions["Orders vs tickets"]["collection"]["name"] == "Operations"
    assert questions["Customers starting with A"]["collection"]["name"] == "Reports not on a dashboard"
    assert questions["Revenue by region"]["imported"]
    tree = {c["name"]: c for c in call(env, "admin", "GET", "/api/collections")["collections"]}
    assert tree["Sales"]["parent_id"] == tree["DataDesk import"]["id"]

    revenue = call(env, "admin", "GET", f"/api/questions/{questions['Revenue by region']['id']}")
    assert revenue["viz"] == {"mode": "chart", "spec": {"version": 1, "type": "bar", "x": "region", "series": [{"y": "revenue"}]}}
    data = run(env, "admin", revenue["id"])
    assert data["status"] == "completed"
    assert data["result"]["rows"][0] == ["US", 200]  # sorted by revenue, descending

    sql = questions["Orders per status"]
    assert run(env, "admin", sql["id"])["status"] == "completed"
    starts = call(env, "admin", "GET", f"/api/questions/{questions['Customers starting with A']['id']}")
    assert starts["spec"]["filters"]["rules"][0]["op"] == "starts_with"
    assert starts["viz"]["spec"]["type"] == "kpi"

    boards = {d["name"]: d for d in call(env, "admin", "GET", "/api/dashboards")["dashboards"]}
    assert set(boards) == {"Sales", "Operations"} and boards["Sales"]["imported"]
    sales = call(env, "admin", "GET", f"/api/dashboards/{boards['Sales']['id']}")
    assert sales["collection"]["name"] == "Sales"
    assert [(c["question"]["name"], c["layout"]) for c in sales["cards"]] == [
        ("Revenue by region", {"x": 0, "y": 0, "w": 6, "h": 8}),
        ("Orders per status", {"x": 6, "y": 0, "w": 6, "h": 8}),
    ]
    assert run(env, "admin", revenue["id"])["status"] == "completed"

    federated = call(env, "admin", "GET", f"/api/questions/{questions['Orders vs tickets']['id']}")
    assert federated["kind"] == "federated" and federated["connection"] == ""
    spec = federated["spec"]
    assert [(s["alias"], s["type"]) for s in spec["sources"]] == [("orders", "builder"), ("tickets", "sql")]
    assert spec["sources"][1]["connection"] == "crm"
    assert spec["joins"] == [{"source": "tickets", "type": "full",
                              "on": [{"left": "orders.customer_id", "right": "tickets.customer", "match": "auto"}]}]
    # runs like any multi-source question; here "crm" is not a connection of this server
    assert "tickets: Unknown connection 'crm'" in run(env, "admin", federated["id"], status=404)["detail"]


def test_placeholders_of_earlier_imports_are_upgraded(env, datadesk):
    """Before M6 a multi-source report was imported as a placeholder; importing again converts it."""
    db = env["db"]
    store = ContentStore(db.engine)
    admin = db.get_user_by_name("admin")
    store.create_question(
        admin, name="Orders vs tickets", description=None, collection_id=store.personal_collection(admin).id,
        connection="shop", kind="federated", spec={"datadesk": {"sources": [
            {"label": "orders", "database": "db1", "spec": {"from": "q_orders"}, "keyColumn": "customer_id"},
            {"label": "again", "database": "db1", "sql": "SELECT * FROM q_orders", "keyColumn": "customer_id"},
        ]}, "connections": ["shop"]}, viz=None, parameters=[], import_key="datadesk:report:4",
    )
    report = do_import(env, datadesk, dry_run=False)
    assert outcomes(report)[4] == "upgraded"
    q = next(q for q in call(env, "admin", "GET", "/api/questions")["questions"] if q["name"] == "Orders vs tickets")
    full = call(env, "admin", "GET", f"/api/questions/{q['id']}")
    assert full["connection"] == "" and full["spec"]["sources"][1]["alias"] == "tickets"


def test_import_twice_skips_what_exists(env, datadesk):
    do_import(env, datadesk, dry_run=False)
    again = do_import(env, datadesk, dry_run=False)
    assert outcomes(again)[1] == "exists"
    names = [c["name"] for c in call(env, "admin", "GET", "/api/collections")["collections"]]
    assert names.count("DataDesk import") == 1 and names.count("Sales") == 1
    assert len(call(env, "admin", "GET", "/api/questions")["questions"]) == 4
    assert again.dashboard_outcomes == ["exists", "exists"]
    assert len(call(env, "admin", "GET", "/api/dashboards")["dashboards"]) == 2


def test_imported_content_is_private_to_the_owner_until_shared(env, datadesk):
    do_import(env, datadesk, dry_run=False)
    assert call(env, "alice", "GET", "/api/questions")["questions"] == []


def test_dashboards_from_a_link_table(env, tmp_path):
    path = tmp_path / "linked.sqlite"
    datadesk_fixture.build(path)
    con = sqlite3.connect(path)
    con.executescript(
        """
        CREATE TABLE dashboard_reports (dashboard_id INTEGER, report_id INTEGER, position INTEGER);
        INSERT INTO dashboard_reports VALUES (1, 6, 1), (1, 1, 0);
        """
    )
    con.commit()
    con.close()
    report = do_import(env, path, dry_run=True)
    homes = {i.source_id: i.collection for i in report.items}
    assert homes[6] == "Sales" and homes[1] == "Sales" and homes[2] == "Reports not on a dashboard"


def test_not_a_datadesk_file(env, tmp_path):
    path = tmp_path / "other.sqlite"
    sqlite3.connect(path).execute("CREATE TABLE x (a)").connection.close()
    with pytest.raises(ImportError_, match="no reports table"):
        do_import(env, path, dry_run=True)
    with pytest.raises(ImportError_, match="No such file"):
        do_import(env, tmp_path / "missing.sqlite", dry_run=True)


def test_convert_single_details():
    spec, notes = convert_single(
        {"from": "t", "joins": [{"table": "u", "type": "right"}], "select": [{"column": "*", "aggregate": "count"}],
         "orderBy": [{"column": "t.name"}]},
        "shop",
    )
    assert spec["joins"] == [{"table": "u", "type": "left"}]
    assert spec["aggregations"] == [{"fn": "count"}]
    assert "order" not in spec
    assert any("right join" in n for n in notes) and any("sorting" in n for n in notes)
    with pytest.raises(Unconvertible, match="wildcards"):
        convert_single({"from": "t", "where": [{"column": "a", "operator": "like", "value": "a%b"}]}, "shop")
    with pytest.raises(Unconvertible, match="main table"):
        convert_single({"select": ["a"]}, "shop")


def test_parse_map():
    assert parse_map("db1=MES, db2=crm") == {"db1": "mes", "db2": "crm"}
    with pytest.raises(ImportError_):
        parse_map("db1")


def test_cli_dry_run(tmp_path, datadesk, monkeypatch, capsys):
    shop = tmp_path / "shop.db"
    sqlite3.connect(shop).close()
    monkeypatch.setenv("NCODE_APP_DB", str(tmp_path / "cli-app.sqlite"))
    monkeypatch.setenv("NCODE_CONN_SHOP_ENGINE", "sqlite")
    monkeypatch.setenv("NCODE_CONN_SHOP_DATABASE", str(shop))
    monkeypatch.setattr("app.manage.init_environment", lambda: None)
    from app.appdb import AppDB
    from app.security import hash_password

    AppDB(tmp_path / "cli-app.sqlite").create_user("boss", hash_password("boss-pass-12"), "admin")
    report_file = tmp_path / "report.md"
    manage(["import-datadesk", str(datadesk), "--map", "db1=shop", "--dry-run", "--report", str(report_file)])
    out = capsys.readouterr().out
    assert "DRY RUN" in out and report_file.read_text().startswith("# DataDesk import report")
    with pytest.raises(SystemExit):
        manage(["import-datadesk", str(datadesk), "--map", "db1=nope", "--dry-run"])
