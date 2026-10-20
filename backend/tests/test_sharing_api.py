"""Public links, signed embedding (M8) and the admin usage log: what outsiders can and cannot reach."""

import base64
import json
import time

import pytest

from app.sharing.tokens import TokenError, sign_jwt, verify_jwt

from .test_dashboards_api import card, new_dashboard, put
from .test_library_api import COUNT_BY_STATUS, call, library_env, save_builder, save_sql

BY_STATUS = {"connection": "shop", "source": {"table": "q_orders"}, "breakouts": [{"ref": "q_orders.status", "alias": "status"}],
             "aggregations": [{"fn": "count", "alias": "orders"}], "order": [{"ref": "status", "dir": "asc"}]}
STATUS_PARAM = [{"name": "status", "type": "text", "default": "paid"}]


@pytest.fixture()
def env(tmp_path):
    yield from library_env(tmp_path)


def anon(env, method, path, status=200, **kwargs):
    res = env["client"].request(method, path, **kwargs)
    assert res.status_code == status, f"{method} {path} -> {res.status_code}: {res.text}"
    return res


def enable(env, public=True, embedding=False):
    call(env, "admin", "PUT", "/api/admin/settings/sharing", json={"public_links": public, "embedding": embedding})


def dashboard(env):
    """Admin's dashboard: a count per status card filtered by a "status" filter, and a text card."""
    q = save_builder(env, "admin", spec=COUNT_BY_STATUS, name="Orders", parameters=STATUS_PARAM)
    d = new_dashboard(env, "admin", "Shop overview")
    put(env, "admin", d["id"], {
        "filters": [{"id": "status", "label": "Status", "type": "text"}, {"id": "region", "label": "Region", "type": "category"}],
        "cards": [card("c1", q["id"], mappings={"status": {"param": "status"}}), card("t", kind="text", text="Hello", x=6)],
    })
    return d, q


def public_link(env, target_type, target_id, status=200, **extra):
    return call(env, "admin", "POST", "/api/share/public", status, json={"target_type": target_type, "target_id": target_id, **extra})


def run_public(env, base, path, body, headers=None):
    snap = anon(env, "POST", f"{base}{path}", json={**body, "wait_ms": 2000}, headers=headers or {}).json()
    while snap["status"] == "running":
        snap = anon(env, "GET", f"{base}/tasks/{snap['task_id']}", params={"wait_ms": 1000}, headers=headers or {}).json()
    return snap


# ---------------------------------------------------------------- public links

def test_public_dashboard_link(env):
    d, q = dashboard(env)
    public_link(env, "dashboard", d["id"], 409)  # switched off by default
    enable(env)
    link = public_link(env, "dashboard", d["id"])
    assert link["path"] == f"/public/{link['token']}" and len(link["token"]) >= 32 and link["active"]
    base = f"/api/public/{link['token']}"
    view = anon(env, "GET", base).json()
    assert view["type"] == "dashboard" and view["name"] == "Shop overview" and [c["key"] for c in view["cards"]] == ["c1", "t"]
    text = json.dumps(view)
    assert "q_orders" not in text and "shop" not in text and "question_id" not in text  # no tables, connections, ids
    assert view["cards"][0]["mappings"] == {"status": {"param": "_"}}
    snap = run_public(env, base, "/cards/c1/run", {"filters": {"status": "refunded"}})
    assert snap["status"] == "completed" and snap["result"]["rows"] == [[1]]
    assert "sql" not in snap["result"]
    assert run_public(env, base, "/cards/c1/run", {})["result"]["rows"] == [[5]]  # the parameter's default: paid
    # the text card cannot be run, unknown cards neither
    anon(env, "POST", f"{base}/cards/t/run", 404, json={})
    anon(env, "POST", f"{base}/run", 404, json={})  # it is a dashboard
    stats = call(env, "admin", "GET", "/api/share", params={"target_type": "dashboard", "target_id": d["id"]})
    assert stats["public_links"][0]["views"] == 1
    # the query ran under the link's own name
    audit = [r.username for r in env["db"].list_audit(50) if r.action == "query"]
    assert audit and all(u.startswith(f"public#{link['id']}:admin") for u in audit)


def test_public_question_link_with_password_expiry_and_revoke(env):
    enable(env)
    q = save_builder(env, "admin", spec=BY_STATUS, name="By status")
    link = public_link(env, "question", q["id"], password="open sesame", expires_at=time.time() + 3600)
    base = f"/api/public/{link['token']}"
    assert anon(env, "GET", base).json() == {"password_required": True}  # not even the name
    anon(env, "POST", f"{base}/run", 403, json={})
    anon(env, "POST", f"{base}/unlock", 403, json={"password": "wrong"})
    access = anon(env, "POST", f"{base}/unlock", json={"password": "open sesame"}).json()["access"]
    headers = {"X-Ncode-Access": access}
    assert anon(env, "GET", base, headers=headers).json()["name"] == "By status"
    assert len(run_public(env, base, "/run", {}, headers)["result"]["rows"]) == 3
    # access for one link does not open another
    other = public_link(env, "question", q["id"], password="x")
    anon(env, "POST", f"/api/public/{other['token']}/run", 403, json={}, headers=headers)
    # revoke: gone at once
    call(env, "admin", "DELETE", f"/api/share/public/{link['id']}")
    anon(env, "GET", base, 404, headers=headers)
    # expired
    call(env, "admin", "POST", "/api/share/public", 400, json={"target_type": "question", "target_id": q["id"], "expires_at": time.time() - 1})
    short = public_link(env, "question", q["id"])
    env["db"].engine.dispose()
    from sqlalchemy import update

    from app.content.tables import share_links_table
    with env["db"].engine.begin() as conn:
        conn.execute(update(share_links_table).where(share_links_table.c.id == short["id"]).values(expires_at=time.time() - 5))
    anon(env, "GET", f"/api/public/{short['token']}", 404)


def test_password_guessing_is_throttled(env):
    enable(env)
    q = save_builder(env, "admin", spec=BY_STATUS)
    base = f"/api/public/{public_link(env, 'question', q['id'], password='right')['token']}"
    for _ in range(5):
        anon(env, "POST", f"{base}/unlock", 403, json={"password": "guess"})
    anon(env, "POST", f"{base}/unlock", 429, json={"password": "right"})


def test_switching_public_links_off_stops_every_link(env):
    enable(env)
    q = save_builder(env, "admin", spec=BY_STATUS)
    link = public_link(env, "question", q["id"])
    anon(env, "GET", f"/api/public/{link['token']}")
    enable(env, public=False)
    anon(env, "GET", f"/api/public/{link['token']}", 404)
    anon(env, "GET", "/api/public/not-a-token", 404)
    anon(env, "GET", "/api/public/" + "x" * 200, 404)


def test_only_admins_share_and_links_follow_the_creator(env):
    enable(env)
    q = save_builder(env, "alice", spec=BY_STATUS)
    call(env, "alice", "POST", "/api/share/public", 403, json={"target_type": "question", "target_id": q["id"]})
    call(env, "alice", "GET", "/api/share", 403, params={"target_type": "question", "target_id": q["id"]})
    call(env, "alice", "PUT", "/api/admin/settings/sharing", 403, json={"public_links": True, "embedding": True})
    # an admin shares alice's question (admins see everything); disabling the admin stops the link
    env["db"].create_user("admin2", __import__("app.security", fromlist=["hash_password"]).hash_password("admin2-pass-1"), "admin")
    from .helpers import auth
    env["admin2"] = auth(env["client"], "admin2", "admin2-pass-1")
    link = call(env, "admin2", "POST", "/api/share/public", json={"target_type": "question", "target_id": q["id"]})
    anon(env, "GET", f"/api/public/{link['token']}")
    env["db"].update_user("admin2", is_active=False)
    anon(env, "GET", f"/api/public/{link['token']}", 404)


def test_tasks_of_one_link_are_invisible_to_another(env):
    enable(env)
    q = save_builder(env, "admin", spec=BY_STATUS)
    a = public_link(env, "question", q["id"])
    b = public_link(env, "question", q["id"])
    snap = anon(env, "POST", f"/api/public/{a['token']}/run", json={"wait_ms": 0}).json()
    anon(env, "GET", f"/api/public/{b['token']}/tasks/{snap['task_id']}", 404)
    # nor are the tasks of signed-in people
    mine = call(env, "admin", "POST", f"/api/questions/{q['id']}/run", json={"wait_ms": 0})
    anon(env, "GET", f"/api/public/{a['token']}/tasks/{mine['task_id']}", 404)


def test_database_errors_do_not_reach_visitors(env):
    enable(env)
    q = save_sql(env, "admin", "SELECT no_such_column FROM q_orders")
    snap = run_public(env, f"/api/public/{public_link(env, 'question', q['id'])['token']}", "/run", {})
    assert snap["status"] == "error" and snap["error"] == "This card could not be loaded right now"


def test_downloads_only_when_allowed(env):
    enable(env)
    q = save_builder(env, "admin", spec=BY_STATUS)
    plain = public_link(env, "question", q["id"])
    snap = run_public(env, f"/api/public/{plain['token']}", "/run", {})
    anon(env, "GET", f"/api/public/{plain['token']}/tasks/{snap['task_id']}/export.csv", 403)
    dl = public_link(env, "question", q["id"], allow_download=True)
    snap = run_public(env, f"/api/public/{dl['token']}", "/run", {})
    csv = anon(env, "GET", f"/api/public/{dl['token']}/tasks/{snap['task_id']}/export.csv").content.decode("utf-8-sig")
    assert csv.splitlines()[0] == "status;orders"
    anon(env, "GET", f"/api/public/{dl['token']}/tasks/{snap['task_id']}/export.xlsx")
    anon(env, "GET", f"/api/public/{dl['token']}/tasks/{snap['task_id']}/export.exe", 404)


def test_rate_limit(tmp_path):
    from .test_library_api import make_client
    client, app_db = make_client(tmp_path, public_rate_per_min=10)
    with client:
        codes = [client.get("/api/public/nope").status_code for _ in range(12)]
    assert codes[:10] == [404] * 10 and codes[10:] == [429, 429]


# ---------------------------------------------------------------- embedding

def embed_setup(env, params):
    enable(env, public=False, embedding=True)
    key = call(env, "admin", "POST", "/api/admin/settings/embedding-key")["key"]
    d, q = dashboard(env)
    call(env, "admin", "PUT", "/api/share/embed", json={"target_type": "dashboard", "target_id": d["id"], "enabled": True, "params": params})
    return key, d


def test_jwt_checks():
    key = "k" * 64
    good = sign_jwt({"resource": {"dashboard": 1}, "exp": time.time() + 60}, key)
    assert verify_jwt(good, key)["resource"] == {"dashboard": 1}
    with pytest.raises(TokenError):
        verify_jwt(good, "other" * 10)
    with pytest.raises(TokenError, match="expired"):
        verify_jwt(sign_jwt({"exp": time.time() - 3600}, key), key)
    with pytest.raises(TokenError, match="expiry"):
        verify_jwt(sign_jwt({"resource": {"dashboard": 1}}, key), key)
    with pytest.raises(TokenError, match="30 days"):
        verify_jwt(sign_jwt({"exp": time.time() + 365 * 86400}, key), key)
    # "alg": "none" and tampered payloads
    header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').rstrip(b"=").decode()
    payload = good.split(".")[1]
    with pytest.raises(TokenError, match="HS256"):
        verify_jwt(f"{header}.{payload}.", key)
    forged = base64.urlsafe_b64encode(json.dumps({"resource": {"dashboard": 2}, "exp": time.time() + 60}).encode()).rstrip(b"=").decode()
    with pytest.raises(TokenError, match="signature"):
        verify_jwt(f"{good.split('.')[0]}.{forged}.{good.split('.')[2]}", key)
    with pytest.raises(TokenError):
        verify_jwt("a.b", key)


def test_embedded_dashboard_with_a_locked_filter(env):
    key, d = embed_setup(env, {"status": "locked"})
    token = sign_jwt({"resource": {"dashboard": d["id"]}, "params": {"status": "refunded"}, "exp": time.time() + 600}, key)
    base = f"/api/embed/{token}"
    view = anon(env, "GET", base).json()
    assert view["filters"] == [] and view["download"] is False  # locked and disabled filters are not shown
    snap = run_public(env, base, "/cards/c1/run", {"filters": {"status": "paid"}})  # the viewer cannot override
    assert snap["result"]["rows"] == [[1]]
    # the token must set locked values
    missing = sign_jwt({"resource": {"dashboard": d["id"]}, "params": {}, "exp": time.time() + 600}, key)
    assert "must set status" in anon(env, "GET", f"/api/embed/{missing}", 400).json()["detail"]
    # another dashboard that is not embeddable
    other = new_dashboard(env, "admin", "Other")
    t2 = sign_jwt({"resource": {"dashboard": other["id"]}, "exp": time.time() + 600}, key)
    anon(env, "GET", f"/api/embed/{t2}", 404)
    # a wrong key, a new key, switching embedding off
    anon(env, "GET", f"/api/embed/{sign_jwt({'resource': {'dashboard': d['id']}, 'params': {'status': 'x'}, 'exp': time.time() + 60}, 'wrong' * 10)}", 400)
    call(env, "admin", "POST", "/api/admin/settings/embedding-key")
    anon(env, "GET", base, 400)


def test_embedded_editable_filter(env):
    key, d = embed_setup(env, {"status": "editable"})
    token = sign_jwt({"resource": {"dashboard": d["id"]}, "exp": time.time() + 600}, key)
    base = f"/api/embed/{token}"
    assert [f["id"] for f in anon(env, "GET", base).json()["filters"]] == ["status"]
    assert run_public(env, base, "/cards/c1/run", {"filters": {"status": "refunded"}})["result"]["rows"] == [[1]]
    # embeds have no downloads
    snap = run_public(env, base, "/cards/c1/run", {})
    anon(env, "GET", f"{base}/tasks/{snap['task_id']}/export.csv", 404)


def test_embedding_off_and_disabled_items(env):
    key, d = embed_setup(env, {})
    token = sign_jwt({"resource": {"dashboard": d["id"]}, "exp": time.time() + 600}, key)
    anon(env, "GET", f"/api/embed/{token}")
    call(env, "admin", "PUT", "/api/share/embed", json={"target_type": "dashboard", "target_id": d["id"], "enabled": False})
    anon(env, "GET", f"/api/embed/{token}", 404)
    call(env, "admin", "PUT", "/api/share/embed", json={"target_type": "dashboard", "target_id": d["id"], "enabled": True})
    anon(env, "GET", f"/api/embed/{token}")
    enable(env, public=False, embedding=False)
    anon(env, "GET", f"/api/embed/{token}", 404)
    call(env, "admin", "PUT", "/api/share/embed", 409, json={"target_type": "dashboard", "target_id": d["id"], "enabled": True})
    # the admin preview token
    enable(env, public=False, embedding=True)
    preview = call(env, "admin", "POST", "/api/share/embed/token", json={"target_type": "dashboard", "target_id": d["id"]})
    anon(env, "GET", f"/api/embed/{preview['token']}")
    assert call(env, "admin", "GET", "/api/admin/settings/embedding-key")["key"] == key
    call(env, "alice", "GET", "/api/admin/settings/embedding-key", 403)


def test_deleting_the_dashboard_removes_its_links(env):
    enable(env)
    d, _q = dashboard(env)
    link = public_link(env, "dashboard", d["id"])
    call(env, "admin", "PATCH", f"/api/dashboards/{d['id']}", json={"archived": True})
    call(env, "admin", "DELETE", f"/api/dashboards/{d['id']}")
    anon(env, "GET", f"/api/public/{link['token']}", 404)
    assert call(env, "admin", "GET", "/api/admin/share")["links"] == []


# ---------------------------------------------------------------- usage

def test_usage_and_query_log(env):
    q = save_builder(env, "alice", spec=BY_STATUS, name="By status")
    from .test_library_api import run
    run(env, "alice", q["id"])
    bad = save_sql(env, "alice", "SELECT nope FROM q_orders")
    run(env, "alice", bad["id"])
    usage = call(env, "admin", "GET", "/api/admin/usage", params={"days": 7})
    assert usage["totals"]["queries"] >= 2 and usage["totals"]["errors"] >= 1
    assert any(x["name"] == "By status" for x in usage["questions"])
    assert any(s["source"] == "saved question" for s in usage["sources"])
    assert usage["per_day"] and usage["people"][0]["username"] == "alice"
    errors = call(env, "admin", "GET", "/api/admin/query-log", params={"kind": "errors"})["queries"]
    assert errors[0]["status"] == "error" and errors[0]["question_name"] == "SQL q"
    slow = call(env, "admin", "GET", "/api/admin/query-log", params={"kind": "slow", "min_sec": 0})["queries"]
    assert len(slow) >= 2
    call(env, "alice", "GET", "/api/admin/usage", 403)


# ---------------------------------------------------------------- from the security review

def test_changing_the_password_locks_out_earlier_visitors(env):
    enable(env)
    q = save_builder(env, "admin", spec=BY_STATUS)
    link = public_link(env, "question", q["id"], password="first")
    base = f"/api/public/{link['token']}"
    access = anon(env, "POST", f"{base}/unlock", json={"password": "first"}).json()["access"]
    anon(env, "POST", f"{base}/run", json={}, headers={"X-Ncode-Access": access})
    call(env, "admin", "PATCH", f"/api/share/public/{link['id']}", json={"password": "second"})
    anon(env, "POST", f"{base}/run", 403, json={}, headers={"X-Ncode-Access": access})


def test_refusals_do_not_name_parameters_or_columns(env):
    enable(env)
    q = save_builder(env, "admin", spec=COUNT_BY_STATUS, name="Orders", parameters=STATUS_PARAM)
    d = new_dashboard(env, "admin", "Numbers")
    put(env, "admin", d["id"], {"filters": [{"id": "secret_limit", "label": "Limit", "type": "number"}],
                                "cards": [card("c1", q["id"], mappings={"secret_limit": {"param": "status"}})]})
    base = f"/api/public/{public_link(env, 'dashboard', d['id'])['token']}"
    res = anon(env, "POST", f"{base}/cards/c1/run", 400, json={"filters": {"secret_limit": "not a number"}})
    assert res.json()["detail"] == "This card cannot be shown with these filter values"
    anon(env, "GET", f"{base}/tasks/x", 422, params={"wait_ms": 10000})  # visitors wait at most 2 s


def test_jwt_with_nan_expiry_is_refused():
    key = "k" * 64
    with pytest.raises(TokenError):
        verify_jwt(sign_jwt({"resource": {"dashboard": 1}, "exp": float("nan")}, key), key)
    with pytest.raises(TokenError):
        verify_jwt("é.é.é", key)
