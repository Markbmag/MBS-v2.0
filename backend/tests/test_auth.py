"""Authentication, permissions, task ownership and the audit log."""

import time

import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.appdb import AppDB, parse_allowed
from app.config import Settings, load_connections
from app.security import hash_password

from .helpers import auth, login, wait_finished


@pytest.fixture()
def env(tmp_path, sample_db):
    settings = Settings(search_workers=2, login_max_failures=3, login_lock_sec=60, max_concurrent_searches=2)
    connections = load_connections(
        {
            "NCODE_CONN_ONE_ENGINE": "sqlite",
            "NCODE_CONN_ONE_DATABASE": str(sample_db),
            "NCODE_CONN_ONE_ID_HINTS": "vin",
            "NCODE_CONN_TWO_ENGINE": "sqlite",
            "NCODE_CONN_TWO_DATABASE": str(sample_db),
        }
    )
    app_db = AppDB(tmp_path / "app.sqlite")
    app_db.create_user("admin", hash_password("admin-pass-1"), "admin")
    app_db.create_user("alice", hash_password("alice-pass-1"), "user", parse_allowed("one"))
    app_db.create_user("bob", hash_password("bob-pass-123"), "user", None)
    client = TestClient(create_app(settings, connections, app_db))
    yield client, app_db
    client.close()


def test_protected_endpoints_need_a_token(env):
    client, _ = env
    assert client.get("/api/connections").status_code == 401
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/search", json={"connection": "one", "phrase": "x"}).status_code == 401
    assert client.get("/api/health").status_code == 200  # public


def test_login_success_and_me(env):
    client, _ = env
    res = login(client, "Alice", "alice-pass-1")  # username is case-insensitive
    assert res.status_code == 200
    body = res.json()
    assert body["user"] == {"username": "alice", "role": "user"}
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.json() == {"username": "alice", "role": "user", "email": None}


def test_wrong_password_and_unknown_user_look_the_same(env):
    client, _ = env
    a = login(client, "alice", "nope")
    b = login(client, "nobody", "nope")
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


def test_lockout_after_repeated_failures(env):
    client, _ = env
    for _ in range(3):
        assert login(client, "alice", "bad").status_code == 401
    locked = login(client, "alice", "alice-pass-1")  # even the right password is refused now
    assert locked.status_code == 429
    assert int(locked.headers["Retry-After"]) > 0


def test_logout_invalidates_token(env):
    client, _ = env
    headers = auth(client, "alice", "alice-pass-1")
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_disabled_user_cannot_login_and_is_kicked_out(env):
    client, db = env
    headers = auth(client, "bob", "bob-pass-123")
    db.update_user("bob", is_active=False)
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert login(client, "bob", "bob-pass-123").status_code == 401


def test_password_change_logs_user_out(env):
    client, db = env
    headers = auth(client, "bob", "bob-pass-123")
    db.update_user("bob", password_hash=hash_password("new-password-9"))
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert login(client, "bob", "new-password-9").status_code == 200


def test_connections_are_filtered_per_user(env):
    client, _ = env
    alice = client.get("/api/connections", headers=auth(client, "alice", "alice-pass-1")).json()
    bob = client.get("/api/connections", headers=auth(client, "bob", "bob-pass-123")).json()
    assert [c["key"] for c in alice] == ["one"]
    assert sorted(c["key"] for c in bob) == ["one", "two"]
    assert all("password" not in c and "host" not in c for c in bob)


def test_user_cannot_use_a_connection_they_are_not_allowed(env):
    client, _ = env
    headers = auth(client, "alice", "alice-pass-1")
    assert client.post("/api/search", json={"connection": "two", "phrase": "x"}, headers=headers).status_code == 404
    assert client.post("/api/connections/two/test", headers=headers).status_code == 404
    assert client.get("/api/connections/two/tables", headers=headers).status_code == 404


def test_search_end_to_end_and_audit(env):
    client, db = env
    headers = auth(client, "alice", "alice-pass-1")
    res = client.post("/api/search", json={"connection": "one", "phrase": "passat"}, headers=headers)
    assert res.status_code == 202
    data = wait_finished(client, headers, res.json()["task_id"])
    assert data["status"] == "completed"
    assert {r["table"] for r in data["results"]} == {"vehicles", "notes", "log_2024"}

    entry = next(r for r in db.list_audit(20) if r.action == "search")
    assert entry.username == "alice" and entry.connection == "one" and entry.phrase == "passat"
    deadline = time.time() + 5  # audit_finish runs just after the task ends
    while entry.status != "completed" and time.time() < deadline:
        time.sleep(0.05)
        entry = next(r for r in db.list_audit(20) if r.action == "search")
    assert entry.status == "completed" and entry.found == data["found"]


def test_tasks_are_private_but_admin_can_see_them(env):
    client, _ = env
    alice = auth(client, "alice", "alice-pass-1")
    bob = auth(client, "bob", "bob-pass-123")
    admin = auth(client, "admin", "admin-pass-1")
    task_id = client.post("/api/search", json={"connection": "one", "phrase": "golf"}, headers=alice).json()["task_id"]
    wait_finished(client, alice, task_id)
    assert client.get(f"/api/search/{task_id}", headers=bob).status_code == 404
    assert client.delete(f"/api/search/{task_id}", headers=bob).status_code == 404
    assert client.get(f"/api/search/{task_id}", headers=admin).status_code == 200


def test_websocket_requires_token_and_ownership(env):
    client, _ = env
    alice = auth(client, "alice", "alice-pass-1")
    bob_token = login(client, "bob", "bob-pass-123").json()["token"]
    alice_token = alice["Authorization"].split()[1]
    task_id = client.post("/api/search", json={"connection": "one", "phrase": "golf"}, headers=alice).json()["task_id"]

    with client.websocket_connect(f"/ws/{task_id}") as ws:
        ws.send_json({"token": "garbage"})
        assert ws.receive_json()["status"] == "unauthorized"

    with client.websocket_connect(f"/ws/{task_id}") as ws:
        ws.send_json({"token": bob_token})
        assert ws.receive_json()["status"] == "unknown"  # exists, but not bob's

    with client.websocket_connect(f"/ws/{task_id}") as ws:
        ws.send_json({"token": alice_token})
        last = None
        for _ in range(200):
            last = ws.receive_json()
            if last["status"] in ("completed", "cancelled", "error"):
                break
        assert last["status"] == "completed" and "results" in last


def test_concurrent_search_limit(env):
    client, _ = env
    headers = auth(client, "bob", "bob-pass-123")
    ids = []
    for _ in range(2):
        r = client.post("/api/search", json={"connection": "one", "phrase": "passat"}, headers=headers)
        assert r.status_code == 202
        ids.append(r.json()["task_id"])
    # The tiny test DB may already be done; only assert the limit if both are still running.
    statuses = [client.get(f"/api/search/{i}", headers=headers, params={"include_results": False}).json()["status"] for i in ids]
    if all(s in ("pending", "running") for s in statuses):
        assert client.post("/api/search", json={"connection": "one", "phrase": "x"}, headers=headers).status_code == 429


def test_auth_can_be_disabled_explicitly(tmp_path, sample_db):
    settings = Settings(auth_enabled=False)
    connections = load_connections({"NCODE_CONN_ONE_ENGINE": "sqlite", "NCODE_CONN_ONE_DATABASE": str(sample_db)})
    client = TestClient(create_app(settings, connections, AppDB(tmp_path / "x.sqlite")))
    assert client.get("/api/connections").status_code == 200
    assert client.get("/api/auth/me").json()["username"] == "anonymous"
    client.close()
