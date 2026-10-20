"""Databases added from the UI: permissions, validation, encryption, persistence."""

import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.appdb import AppDB
from app.config import Settings, load_connections
from app.crypto import Cipher, generate_key
from app.security import hash_password

from .helpers import auth, wait_finished


def make_app(tmp_path, sample_db, app_db=None, settings=None):
    settings = settings or Settings(search_workers=2)
    env_connections = load_connections(
        {
            "NCODE_CONN_ENVDB_ENGINE": "sqlite",
            "NCODE_CONN_ENVDB_DATABASE": str(sample_db),
            "NCODE_CONN_ENVDB_LABEL": "From env",
        }
    )
    if app_db is None:
        app_db = AppDB(tmp_path / "app.sqlite", cipher=Cipher(generate_key()))
        app_db.create_user("admin", hash_password("admin-pass-1"), "admin")
        app_db.create_user("alice", hash_password("alice-pass-1"), "user")
    return TestClient(create_app(settings, env_connections, app_db)), app_db


@pytest.fixture()
def env(tmp_path, sample_db):
    client, app_db = make_app(tmp_path, sample_db)
    admin = auth(client, "admin", "admin-pass-1")
    alice = auth(client, "alice", "alice-pass-1")
    yield client, app_db, admin, alice, sample_db
    client.close()


def sqlite_payload(path, label="My Cars"):
    return {"label": label, "engine": "sqlite", "database": str(path), "id_hints": ["VIN"]}


def mysql_payload(**overrides):
    body = {
        "label": "Prod MySQL", "engine": "mysql", "host": "10.0.0.5", "port": 3306,
        "username": "ro", "password": "s3cret!", "database": "shop",
    }
    body.update(overrides)
    return body


def test_engines_list(env):
    client, _, _, alice, _ = env
    engines = {e["name"]: e for e in client.get("/api/engines", headers=alice).json()}
    assert set(engines) == {"mysql", "mariadb", "postgresql", "mssql", "sqlite"}
    assert engines["sqlite"]["available"] is True and engines["sqlite"]["file_based"] is True
    assert engines["postgresql"]["default_port"] == 5432 and engines["mysql"]["pip"] == "pymysql"


def test_only_admins_manage_connections(env):
    client, _, _, alice, db = env
    body = sqlite_payload(db)
    assert client.post("/api/connections", json=body, headers=alice).status_code == 403
    assert client.post("/api/connections/test-draft", json=body, headers=alice).status_code == 403
    assert client.get("/api/connections/envdb/details", headers=alice).status_code == 403
    assert client.delete("/api/connections/envdb", headers=alice).status_code == 403
    assert client.post("/api/connections", json=body).status_code == 401


def test_draft_test_reports_table_count(env):
    client, _, admin, _, db = env
    res = client.post("/api/connections/test-draft", json=sqlite_payload(db), headers=admin).json()
    assert res == {"ok": True, "tables": 4}


@pytest.mark.parametrize(
    "path_fn, expected",
    [
        (lambda tmp, db, app: tmp / "missing.db", "not found"),
        (lambda tmp, db, app: app, "own database"),
    ],
)
def test_draft_rejects_bad_sqlite_paths(env, tmp_path, path_fn, expected):
    client, app_db, admin, _, db = env
    res = client.post(
        "/api/connections/test-draft", json=sqlite_payload(path_fn(tmp_path, db, app_db.path)), headers=admin
    ).json()
    assert res["ok"] is False and expected in res["error"]


def test_draft_rejects_non_sqlite_file(env, tmp_path):
    client, _, admin, _, _ = env
    fake = tmp_path / "notes.txt"
    fake.write_text("hello")
    res = client.post("/api/connections/test-draft", json=sqlite_payload(fake), headers=admin).json()
    assert res["ok"] is False and "not a SQLite file" in res["error"]


def test_create_list_search_and_delete_flow(env):
    client, _, admin, alice, db = env
    created = client.post("/api/connections", json=sqlite_payload(db), headers=admin)
    assert created.status_code == 201
    info = created.json()
    assert info["key"] == "my_cars" and info["source"] == "ui" and info["editable"] is True
    assert info["id_hints"] == ["vin"]

    # duplicate labels get distinct keys
    again = client.post("/api/connections", json=sqlite_payload(db), headers=admin).json()
    assert again["key"] == "my_cars_2"

    admin_view = {c["key"]: c for c in client.get("/api/connections", headers=admin).json()}
    alice_view = {c["key"]: c for c in client.get("/api/connections", headers=alice).json()}
    assert set(admin_view) == {"envdb", "my_cars", "my_cars_2"}
    assert admin_view["my_cars"]["editable"] is True and admin_view["envdb"]["editable"] is False
    assert alice_view["my_cars"]["editable"] is False

    # the new connection is immediately searchable, with its id badge column
    task = client.post("/api/search", json={"connection": "my_cars", "phrase": "passat"}, headers=alice).json()
    data = wait_finished(client, alice, task["task_id"])
    assert data["status"] == "completed"
    vehicle = next(r for r in data["results"] if r["table"] == "vehicles")
    assert vehicle["id_column"] == "vin"

    assert client.delete("/api/connections/my_cars", headers=admin).status_code == 200
    keys = [c["key"] for c in client.get("/api/connections", headers=admin).json()]
    assert "my_cars" not in keys
    assert client.post("/api/search", json={"connection": "my_cars", "phrase": "x"}, headers=alice).status_code == 404


def test_env_connections_are_read_only(env):
    client, _, admin, _, db = env
    assert client.delete("/api/connections/envdb", headers=admin).status_code == 400
    assert client.put("/api/connections/envdb", json=sqlite_payload(db), headers=admin).status_code == 400


def test_update_connection(env):
    client, _, admin, _, db = env
    client.post("/api/connections", json=sqlite_payload(db), headers=admin)
    res = client.put("/api/connections/my_cars", json=sqlite_payload(db, label="Renamed"), headers=admin)
    assert res.status_code == 200 and res.json()["label"] == "Renamed" and res.json()["key"] == "my_cars"
    labels = {c["key"]: c["label"] for c in client.get("/api/connections", headers=admin).json()}
    assert labels["my_cars"] == "Renamed"


def test_password_is_encrypted_and_never_returned(env, monkeypatch):
    client, app_db, admin, alice, _ = env
    monkeypatch.setattr("app.api.driver_available", lambda engine: True)
    res = client.post("/api/connections", json=mysql_payload(), headers=admin)
    assert res.status_code == 201
    assert "s3cret" not in res.text
    assert res.json()["has_password"] is True and "password" not in res.json()

    # stored encrypted, decrypts back for use
    from sqlalchemy import select
    from app.appdb import connections_table
    with app_db.engine.connect() as conn:
        raw = conn.execute(select(connections_table.c.password_enc)).scalar_one()
    assert raw and "s3cret" not in raw
    assert app_db.get_connection("prod_mysql").password == "s3cret!"

    for headers in (admin, alice):
        assert "s3cret" not in client.get("/api/connections", headers=headers).text
    assert "s3cret" not in client.get("/api/connections/prod_mysql/details", headers=admin).text
    assert client.get("/api/connections/prod_mysql/details", headers=admin).json()["host"] == "10.0.0.5"
    assert "host" not in client.get("/api/connections", headers=alice).json()[0]


def test_update_keeps_password_only_for_the_same_target(env, monkeypatch):
    client, app_db, admin, _, _ = env
    monkeypatch.setattr("app.api.driver_available", lambda engine: True)
    client.post("/api/connections", json=mysql_payload(), headers=admin)

    ok = client.put("/api/connections/prod_mysql", json=mysql_payload(password="", database="other"), headers=admin)
    assert ok.status_code == 200
    assert app_db.get_connection("prod_mysql").password == "s3cret!"  # kept
    assert app_db.get_connection("prod_mysql").database == "other"

    # pointing the saved password at a different server must require re-entering it
    moved = client.put("/api/connections/prod_mysql", json=mysql_payload(password="", host="evil.example"), headers=admin)
    assert moved.status_code == 400 and "password again" in moved.json()["detail"]

    changed = client.put("/api/connections/prod_mysql", json=mysql_payload(password="new-one"), headers=admin)
    assert changed.status_code == 200 and app_db.get_connection("prod_mysql").password == "new-one"


def test_missing_driver_gives_install_hint(env, monkeypatch):
    client, _, admin, _, _ = env
    monkeypatch.setattr("app.api.driver_available", lambda engine: False)
    res = client.post("/api/connections", json=mysql_payload(), headers=admin)
    assert res.status_code == 400 and "pip install pymysql" in res.json()["detail"]


def test_network_engines_require_a_host(env):
    client, _, admin, _, _ = env
    res = client.post("/api/connections/test-draft", json=mysql_payload(host=""), headers=admin).json()
    assert res["ok"] is False and "server address" in res["error"]


def test_ui_connections_survive_a_restart(tmp_path, sample_db):
    client, app_db = make_app(tmp_path, sample_db)
    admin = auth(client, "admin", "admin-pass-1")
    client.post("/api/connections", json=sqlite_payload(sample_db), headers=admin)
    client.close()

    client2, _ = make_app(tmp_path, sample_db, app_db=AppDB(tmp_path / "app.sqlite", cipher=app_db.cipher))
    admin2 = auth(client2, "admin", "admin-pass-1")
    assert "my_cars" in [c["key"] for c in client2.get("/api/connections", headers=admin2).json()]
    client2.close()


def test_table_listing_counts_searchable_columns(env):
    client, _, _, alice, _ = env
    tables = {t["name"]: t for t in client.get("/api/connections/envdb/tables", headers=alice).json()["tables"]}
    assert tables["vehicles"] == {"name": "vehicles", "columns": 6, "searchable": 2}
    assert tables["empty_numbers"]["searchable"] == 0


def test_search_can_be_limited_to_chosen_tables(env):
    client, _, _, alice, _ = env
    task = client.post(
        "/api/search", json={"connection": "envdb", "phrase": "passat", "tables": ["NOTES"]}, headers=alice
    ).json()
    data = wait_finished(client, alice, task["task_id"])
    assert {r["table"] for r in data["results"]} == {"notes"}
    assert data["total"] == 1
    assert "elapsed_sec" in data
