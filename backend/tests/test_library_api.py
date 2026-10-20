"""Library (M4): collections, saved questions, permissions, favourites, parameters."""

import pytest
from fastapi.testclient import TestClient

from app.security import hash_password

from .helpers import auth
from .test_query_api import REVENUE, make_client, wait_done

COUNT_BY_STATUS = {
    "connection": "shop",
    "source": {"table": "q_orders"},
    "aggregations": [{"fn": "count", "alias": "orders"}],
    "filters": {"op": "and", "rules": [{"ref": "q_orders.status", "op": "=", "value": None, "param": "status"}]},
}


def library_env(tmp_path):
    """Client + app DB with alice, bob (no access to "shop"), carol and an admin, logged in."""
    client, app_db = make_client(tmp_path)
    app_db.create_user("carol", hash_password("carol-pass-1"))
    with client:
        yield {
            "client": client,
            "db": app_db,
            "alice": auth(client, "alice", "alice-pass-1"),
            "bob": auth(client, "bob", "bob-pass-123"),      # may not use the "shop" connection
            "carol": auth(client, "carol", "carol-pass-1"),
            "admin": auth(client, "admin", "admin-pass-1"),
        }


@pytest.fixture()
def env(tmp_path):
    yield from library_env(tmp_path)


def call(env, who, method, path, status=200, **kwargs):
    res = env["client"].request(method, path, headers=env[who], **kwargs)
    assert res.status_code == status, f"{method} {path} -> {res.status_code}: {res.text}"
    return res.json()


def new_collection(env, who, name, parent=None):
    return call(env, who, "POST", "/api/collections", json={"name": name, "parent_id": parent})


def save_builder(env, who, spec=REVENUE, collection=None, name="Revenue by region", parameters=None, status=200):
    body = {"name": name, "kind": "builder", "spec": spec, "collection_id": collection, "parameters": parameters or [],
            "viz": {"mode": "chart", "spec": {"type": "bar"}}}
    return call(env, who, "POST", "/api/questions", status, json=body)


def save_sql(env, who, sql, collection=None, parameters=None, status=200):
    body = {"name": "SQL q", "kind": "sql", "connection": "shop", "spec": {"sql": sql, "limit": 100},
            "collection_id": collection, "parameters": parameters or []}
    return call(env, who, "POST", "/api/questions", status, json=body)


def run(env, who, qid, params=None, status=200):
    data = call(env, who, "POST", f"/api/questions/{qid}/run", status, json={"params": params or {}, "wait_ms": 5000})
    if status == 200 and data["status"] == "running":
        data = wait_done(env["client"], env[who], data["task_id"])
    return data


# ---------------------------------------------------------------- save, open, run

def test_personal_collection_is_created_and_private(env):
    mine = call(env, "alice", "GET", "/api/collections")
    personal = next(c for c in mine["collections"] if c["id"] == mine["personal_id"])
    assert personal["name"] == "alice's collection" and personal["mine"] and personal["personal"]
    carol = call(env, "carol", "GET", "/api/collections")
    assert mine["personal_id"] not in [c["id"] for c in carol["collections"]]
    call(env, "carol", "GET", f"/api/collections/{mine['personal_id']}", 404)


def test_save_open_and_run_round_trip(env):
    q = save_builder(env, "alice")
    assert q["collection"]["name"] == "alice's collection"
    assert q["owner"] == "alice" and q["access"] == "edit" and q["viz"]["mode"] == "chart"
    opened = call(env, "alice", "GET", f"/api/questions/{q['id']}")
    assert opened["spec"]["source"] == {"table": "q_orders"}
    assert opened["path"][0]["name"] == "alice's collection"
    data = run(env, "alice", q["id"])
    assert data["status"] == "completed"
    assert dict(data["result"]["rows"])["EU"] == 150


def test_update_rename_and_move(env):
    q = save_builder(env, "alice")
    team = new_collection(env, "alice", "Team")
    changed = call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"name": "Renamed", "collection_id": team["id"]})
    assert changed["name"] == "Renamed" and changed["collection_id"] == team["id"]
    spec = {**REVENUE, "limit": 2}
    changed = call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"spec": spec})
    assert changed["spec"]["limit"] == 2 and changed["updated_by"] == "alice"


def test_sql_question_with_parameters(env):
    sql = "SELECT count(*) AS n FROM q_orders WHERE status = {{status}} AND total >= {{min_total}}"
    q = save_sql(env, "alice", sql, parameters=[{"name": "min_total", "type": "number", "default": 0}])
    assert [p["name"] for p in q["parameters"]] == ["status", "min_total"]  # SQL order, undeclared = text
    assert q["parameters"][0]["type"] == "text"
    assert run(env, "alice", q["id"], {"status": "paid"})["result"]["rows"] == [[5]]
    assert run(env, "alice", q["id"], {"status": "paid", "min_total": "60"})["result"]["rows"] == [[2]]
    err = run(env, "alice", q["id"], {"status": "paid", "min_total": "lots"}, status=400)
    assert "must be a number" in err["detail"]
    assert "status" in run(env, "alice", q["id"], {}, status=400)["detail"]


def test_sql_date_parameter(env):
    sql = "SELECT count(*) FROM q_orders WHERE paid_on >= {{since}}"
    q = save_sql(env, "alice", sql, parameters=[{"name": "since", "type": "date"}])
    assert run(env, "alice", q["id"], {"since": "2026-02-01"})["result"]["rows"] == [[4]]
    assert "date" in run(env, "alice", q["id"], {"since": "01.02.2026"}, status=400)["detail"]


def test_builder_parameter_is_dropped_without_a_value(env):
    q = save_builder(env, "alice", spec=COUNT_BY_STATUS, parameters=[{"name": "status", "label": "Status"}])
    assert run(env, "alice", q["id"])["result"]["rows"] == [[7]]
    assert run(env, "alice", q["id"], {"status": "paid"})["result"]["rows"] == [[5]]
    assert run(env, "alice", q["id"], {"status": ""})["result"]["rows"] == [[7]]


def test_builder_parameter_default_required_and_lists(env):
    spec = {**COUNT_BY_STATUS, "filters": {"rules": [{"ref": "q_orders.status", "op": "in", "value": None, "param": "status"}]}}
    q = save_builder(env, "alice", spec=spec, parameters=[{"name": "status", "default": "refunded", "required": True}])
    assert run(env, "alice", q["id"])["result"]["rows"] == [[1]]
    assert run(env, "alice", q["id"], {"status": ["paid", "refunded"]})["result"]["rows"] == [[6]]
    between = {**COUNT_BY_STATUS, "filters": {"rules": [{"ref": "q_orders.paid_on", "op": "between", "param": "period"}]}}
    q2 = save_builder(env, "alice", spec=between, parameters=[{"name": "period", "type": "date"}])
    assert run(env, "alice", q2["id"], {"period": ["2026-01-01", "2026-01-31"]})["result"]["rows"] == [[2]]
    assert "two values" in run(env, "alice", q2["id"], {"period": "2026-01-01"}, status=400)["detail"]


def test_builder_parameters_must_be_declared(env):
    res = save_builder(env, "alice", spec=COUNT_BY_STATUS, status=400)
    assert "not declared" in res["detail"]
    unused = save_builder(env, "alice", spec=REVENUE, parameters=[{"name": "nope"}])
    assert unused["parameters"] == []


def test_invalid_questions_are_refused(env):
    bad = {**REVENUE, "breakouts": [{"ref": "q_customers.nope"}]}
    assert "nope" in save_builder(env, "alice", spec=bad, status=400)["detail"]
    save_sql(env, "alice", "DELETE FROM q_orders", status=400)
    save_sql(env, "alice", "SELECT 1; SELECT 2", status=400)
    body = {"name": "x", "kind": "federated", "spec": {}, "connection": "shop"}
    assert "sources" in call(env, "alice", "POST", "/api/questions", 400, json=body)["detail"]
    body = {"name": "x", "kind": "pivot", "spec": {}}
    call(env, "alice", "POST", "/api/questions", 422, json=body)


def test_favorites_and_search(env):
    a = save_builder(env, "alice", name="Revenue by region")
    save_sql(env, "alice", "SELECT 1 AS one")
    call(env, "alice", "PUT", f"/api/questions/{a['id']}/favorite")
    favs = call(env, "alice", "GET", "/api/questions", params={"favorites": True})["questions"]
    assert [q["id"] for q in favs] == [a["id"]] and favs[0]["favorite"]
    found = call(env, "alice", "GET", "/api/questions", params={"q": "REVENUE"})["questions"]
    assert [q["id"] for q in found] == [a["id"]]
    assert call(env, "carol", "GET", "/api/questions", params={"q": "revenue"})["questions"] == []
    call(env, "alice", "DELETE", f"/api/questions/{a['id']}/favorite")
    assert call(env, "alice", "GET", "/api/questions", params={"favorites": True})["questions"] == []


def test_archive_restore_and_delete(env):
    q = save_builder(env, "alice")
    call(env, "alice", "DELETE", f"/api/questions/{q['id']}", 409)  # must be archived first
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"archived": True})
    assert call(env, "alice", "GET", "/api/questions")["questions"] == []
    archive = call(env, "alice", "GET", "/api/library/archive")
    assert [x["id"] for x in archive["questions"]] == [q["id"]]
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"archived": False})
    assert len(call(env, "alice", "GET", "/api/questions")["questions"]) == 1
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"archived": True})
    call(env, "alice", "DELETE", f"/api/questions/{q['id']}")
    call(env, "alice", "GET", f"/api/questions/{q['id']}", 404)


def test_archived_collection_hides_its_content_and_deletes_with_it(env):
    team = new_collection(env, "alice", "Team")
    sub = new_collection(env, "alice", "Sub", parent=team["id"])
    q = save_builder(env, "alice", collection=sub["id"])
    call(env, "alice", "DELETE", f"/api/collections/{team['id']}", 409)
    call(env, "alice", "PATCH", f"/api/collections/{team['id']}", json={"archived": True})
    ids = [c["id"] for c in call(env, "alice", "GET", "/api/collections")["collections"]]
    assert team["id"] not in ids and sub["id"] not in ids
    assert call(env, "alice", "GET", "/api/questions")["questions"] == []
    assert [c["id"] for c in call(env, "alice", "GET", "/api/library/archive")["collections"]] == [team["id"]]
    deleted = call(env, "alice", "DELETE", f"/api/collections/{team['id']}")
    assert deleted["questions_deleted"] == 1
    call(env, "alice", "GET", f"/api/questions/{q['id']}", 404)


def test_duplicate(env):
    q = save_builder(env, "alice")
    copy = call(env, "alice", "POST", f"/api/questions/{q['id']}/duplicate", json={})
    assert copy["name"] == "Revenue by region (copy)" and copy["id"] != q["id"]
    assert copy["spec"] == q["spec"] and copy["collection_id"] == q["collection_id"]


# ---------------------------------------------------------------- permissions

def share(env, who, cid, grants, status=200):
    return call(env, who, "PUT", f"/api/collections/{cid}/permissions", status, json={"grants": grants})


def test_view_grant(env):
    team = new_collection(env, "alice", "Sales")
    q = save_builder(env, "alice", collection=team["id"])
    call(env, "carol", "GET", f"/api/questions/{q['id']}", 404)
    share(env, "alice", team["id"], [{"user": "carol", "level": "view"}])
    seen = call(env, "carol", "GET", f"/api/questions/{q['id']}")
    assert seen["access"] == "view"
    assert run(env, "carol", q["id"])["status"] == "completed"
    call(env, "carol", "PATCH", f"/api/questions/{q['id']}", 403, json={"name": "mine now"})
    call(env, "carol", "PATCH", f"/api/questions/{q['id']}", 403, json={"archived": True})
    save_builder(env, "carol", collection=team["id"], status=403)
    call(env, "carol", "POST", "/api/collections", 403, json={"name": "Inside", "parent_id": team["id"]})
    # a viewer can still copy it into their own collection
    copy = call(env, "carol", "POST", f"/api/questions/{q['id']}/duplicate", json={})
    assert copy["collection"]["name"] == "carol's collection"


def test_edit_grant_cannot_share_or_move_the_collection(env):
    team = new_collection(env, "alice", "Sales")
    share(env, "alice", team["id"], [{"user": "carol", "level": "edit"}])
    q = save_builder(env, "carol", collection=team["id"])
    assert q["owner"] == "carol"
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"name": "Edited by Alice"})
    share(env, "carol", team["id"], [{"user": "bob", "level": "view"}], status=403)
    call(env, "carol", "GET", f"/api/collections/{team['id']}/permissions", 403)
    mine = call(env, "carol", "GET", "/api/collections")["personal_id"]
    call(env, "carol", "PATCH", f"/api/collections/{team['id']}", 403, json={"parent_id": mine})
    call(env, "carol", "PATCH", f"/api/collections/{team['id']}", 403, json={"archived": True})


def test_role_grant_and_inheritance(env):
    team = new_collection(env, "alice", "Company")
    sub = new_collection(env, "alice", "Finance", parent=team["id"])
    q = save_builder(env, "alice", collection=sub["id"])
    share(env, "alice", team["id"], [{"role": "all", "level": "view"}])
    assert call(env, "carol", "GET", f"/api/questions/{q['id']}")["access"] == "view"
    grants = call(env, "alice", "GET", f"/api/collections/{sub['id']}/permissions")["grants"]
    assert grants == [{"user": None, "group": None, "role": "all", "level": "view", "inherited_from": {"id": team["id"], "name": "Company"}}]
    # a stronger grant lower down wins there
    share(env, "alice", sub["id"], [{"user": "carol", "level": "edit"}])
    assert call(env, "carol", "GET", f"/api/questions/{q['id']}")["access"] == "edit"
    tree = {c["id"]: c for c in call(env, "carol", "GET", "/api/collections")["collections"]}
    assert tree[sub["id"]]["parent_id"] == team["id"] and tree[team["id"]]["access"] == "view"


def test_collection_shared_alone_appears_at_the_top(env):
    team = new_collection(env, "alice", "Company")
    sub = new_collection(env, "alice", "Finance", parent=team["id"])
    share(env, "alice", sub["id"], [{"user": "carol", "level": "view"}])
    tree = {c["id"]: c for c in call(env, "carol", "GET", "/api/collections")["collections"]}
    assert team["id"] not in tree and tree[sub["id"]]["parent_id"] is None
    detail = call(env, "carol", "GET", f"/api/collections/{sub['id']}")
    assert detail["path"] == [{"id": sub["id"], "name": "Finance"}]  # the hidden parent is not revealed


def test_revoking_a_grant(env):
    team = new_collection(env, "alice", "Sales")
    q = save_builder(env, "alice", collection=team["id"])
    share(env, "alice", team["id"], [{"user": "carol", "level": "view"}])
    call(env, "carol", "GET", f"/api/questions/{q['id']}")
    share(env, "alice", team["id"], [])
    call(env, "carol", "GET", f"/api/questions/{q['id']}", 404)


def test_personal_collections_cannot_be_shared(env):
    mine = call(env, "alice", "GET", "/api/collections")["personal_id"]
    res = share(env, "alice", mine, [{"user": "carol", "level": "view"}], status=403)
    assert "owner" in res["detail"]
    inner = new_collection(env, "alice", "Drafts", parent=mine)
    res = share(env, "alice", inner["id"], [{"user": "carol", "level": "view"}], status=400)
    assert "Personal" in res["detail"]


def test_viewing_needs_connection_access_to_run(env):
    team = new_collection(env, "alice", "Sales")
    q = save_builder(env, "alice", collection=team["id"])
    share(env, "alice", team["id"], [{"user": "bob", "level": "view"}])
    assert call(env, "bob", "GET", f"/api/questions/{q['id']}")["name"] == "Revenue by region"
    run(env, "bob", q["id"], status=404)  # bob may not use the shop database


def test_admin_sees_and_manages_everything(env):
    q = save_builder(env, "alice")
    assert call(env, "admin", "GET", f"/api/questions/{q['id']}")["access"] == "edit"
    tree = call(env, "admin", "GET", "/api/collections")["collections"]
    other = [c for c in tree if c["personal"] and not c["mine"]]
    assert [c["name"] for c in other] == ["alice's collection"]


def test_unknown_people_and_bad_grants(env):
    team = new_collection(env, "alice", "Sales")
    share(env, "alice", team["id"], [{"user": "nobody", "level": "view"}], status=400)
    share(env, "alice", team["id"], [{"role": "wizards", "level": "view"}], status=400)
    share(env, "alice", team["id"], [{"user": "carol", "role": "all", "level": "view"}], status=400)
    people = call(env, "alice", "GET", "/api/library/people")
    assert "carol" in people["users"] and "alice" not in people["users"] and "all" in people["roles"]


def test_moving_a_collection_into_itself_is_refused(env):
    a = new_collection(env, "alice", "A")
    b = new_collection(env, "alice", "B", parent=a["id"])
    call(env, "alice", "PATCH", f"/api/collections/{a['id']}", 400, json={"parent_id": b["id"]})
    call(env, "alice", "PATCH", f"/api/collections/{b['id']}", json={"parent_id": None})


def test_deleting_a_user_keeps_content_but_not_access(env):
    team = new_collection(env, "carol", "Carol's team")
    q = save_builder(env, "carol", collection=team["id"])
    personal = call(env, "carol", "GET", "/api/collections")["personal_id"]
    env["db"].delete_user("carol")
    detail = call(env, "admin", "GET", f"/api/collections/{personal}")["collection"]
    assert detail["name"] == "carol's collection (deleted user)" and not detail["personal"]
    assert call(env, "admin", "GET", f"/api/questions/{q['id']}")["owner"] is None
    # a new user who happens to get the same id inherits nothing
    env["db"].create_user("dave", hash_password("dave-pass-12"))
    dave = auth(env["client"], "dave", "dave-pass-12")
    res = env["client"].get(f"/api/questions/{q['id']}", headers=dave)
    assert res.status_code == 404


def test_requires_login(env):
    assert TestClient(env["client"].app).get("/api/collections").status_code == 401
