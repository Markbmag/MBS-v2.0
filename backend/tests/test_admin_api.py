"""Users, groups, group permissions and row-level security (M9)."""

import time

import pytest

from .helpers import auth, login
from .test_library_api import call, library_env, new_collection, run, save_builder
from .test_query_api import wait_done

ORDERS_BY_CUSTOMER = {"connection": "shop", "source": {"table": "q_orders"}, "fields": [{"ref": "q_orders.id"}, {"ref": "q_orders.customer_id"}],
                      "order": [{"ref": "q_orders.id", "dir": "asc"}]}
CUSTOMERS = {"connection": "shop", "source": {"table": "q_customers"}, "fields": [{"ref": "q_customers.name"}, {"ref": "q_customers.region"}],
             "order": [{"ref": "q_customers.id", "dir": "asc"}]}
JOINED = {"connection": "shop", "source": {"table": "q_orders"}, "joins": [{"table": "q_customers"}],
          "breakouts": [{"ref": "q_customers.region", "alias": "region"}], "aggregations": [{"fn": "count", "alias": "n"}],
          "order": [{"ref": "region", "dir": "asc"}]}


@pytest.fixture()
def env(tmp_path):
    yield from library_env(tmp_path)


def query(env, who, spec, status=200):
    data = call(env, who, "POST", "/api/query", status, json={"spec": spec, "wait_ms": 5000, "refresh": True})
    if status == 200 and data["status"] == "running":
        data = wait_done(env["client"], env[who], data["task_id"])
    return data


def group(env, name, members, connections="", status=200):
    return call(env, "admin", "POST", "/api/admin/groups", status, json={"name": name, "connections": connections, "members": members})


def rule(env, gid, table, column, values, status=200):
    return call(env, "admin", "POST", "/api/admin/row-rules", status,
                json={"group_id": gid, "connection": "shop", "table": table, "column": column, "values": values})


# ---------------------------------------------------------------- users

def test_admin_manages_users(env):
    u = call(env, "admin", "POST", "/api/admin/users", json={"username": "Dave", "password": "dave-pass-1", "email": "dave@example.com",
                                                              "connections": ""})
    assert u["username"] == "dave" and u["connections"] == [] and u["effective_connections"] == [] and u["email"] == "dave@example.com"
    call(env, "admin", "POST", "/api/admin/users", 409, json={"username": "dave", "password": "dave-pass-1"})
    call(env, "admin", "POST", "/api/admin/users", 422, json={"username": "x", "password": "dave-pass-1"})
    call(env, "admin", "POST", "/api/admin/users", 422, json={"username": "eve", "password": "short"})
    dave = auth(env["client"], "dave", "dave-pass-1")
    assert env["client"].get("/api/connections", headers=dave).json() == []
    call(env, "admin", "PATCH", "/api/admin/users/dave", json={"connections": ["shop"]})
    assert [c["key"] for c in env["client"].get("/api/connections", headers=dave).json()] == ["shop"]
    # a password reset signs the user out
    call(env, "admin", "PATCH", "/api/admin/users/dave", json={"password": "dave-pass-2"})
    assert env["client"].get("/api/auth/me", headers=dave).status_code == 401
    listed = {x["username"]: x for x in call(env, "admin", "GET", "/api/admin/users")["users"]}
    assert listed["dave"]["last_login_at"] is not None and listed["alice"]["role"] == "user"
    call(env, "alice", "GET", "/api/admin/users", 403)
    call(env, "admin", "DELETE", "/api/admin/users/dave")
    assert login(env["client"], "dave", "dave-pass-2").status_code == 401


def test_the_last_admin_stays(env):
    call(env, "admin", "PATCH", "/api/admin/users/admin", 400, json={"role": "user"})
    call(env, "admin", "PATCH", "/api/admin/users/admin", 400, json={"is_active": False})
    call(env, "admin", "DELETE", "/api/admin/users/admin", 400)
    call(env, "admin", "PATCH", "/api/admin/users/carol", json={"role": "admin"})
    call(env, "admin", "PATCH", "/api/admin/users/admin", json={"role": "user"})  # now fine


def test_own_password_change(env):
    call(env, "alice", "PUT", "/api/account/password", 403, json={"current": "wrong", "new": "alice-pass-2"})
    call(env, "alice", "PUT", "/api/account/password", 422, json={"current": "alice-pass-1", "new": "short"})
    out = call(env, "alice", "PUT", "/api/account/password", json={"current": "alice-pass-1", "new": "alice-pass-2"})
    assert env["client"].get("/api/auth/me", headers=env["alice"]).status_code == 401  # the old session ended
    assert env["client"].get("/api/auth/me", headers={"Authorization": f"Bearer {out['token']}"}).json()["username"] == "alice"
    assert login(env["client"], "alice", "alice-pass-2").status_code == 200


# ---------------------------------------------------------------- groups

def test_groups_give_databases_and_collections(env):
    # bob may not use "shop"; a group gives it to him
    call(env, "bob", "POST", "/api/query", 404, json={"spec": CUSTOMERS})
    g = group(env, "Sales", ["bob", "carol"], connections=["shop"])
    assert g["members"] == ["bob", "carol"] and g["connections"] == "shop"
    assert query(env, "bob", CUSTOMERS)["status"] == "completed"
    group(env, "sales", [], status=409)  # names are unique, ignoring case
    # a collection shared with the group
    team = new_collection(env, "alice", "Team reports")
    q = save_builder(env, "alice", spec=CUSTOMERS, collection=team["id"], name="Customers")
    call(env, "carol", "GET", f"/api/questions/{q['id']}", 404)
    call(env, "alice", "PUT", f"/api/collections/{team['id']}/permissions", json={"grants": [{"group": "Sales", "level": "view"}]})
    assert call(env, "carol", "GET", f"/api/questions/{q['id']}")["name"] == "Customers"
    grants = call(env, "alice", "GET", f"/api/collections/{team['id']}/permissions")["grants"]
    assert grants[0]["group"] == "Sales"
    assert "Sales" in call(env, "alice", "GET", "/api/library/people")["groups"]
    # leaving the group removes both
    call(env, "admin", "PUT", f"/api/admin/groups/{g['id']}", json={"name": "Sales", "connections": ["shop"], "members": ["bob"]})
    call(env, "carol", "GET", f"/api/questions/{q['id']}", 404)
    call(env, "admin", "DELETE", f"/api/admin/groups/{g['id']}")
    call(env, "bob", "POST", "/api/query", 404, json={"spec": CUSTOMERS})


# ---------------------------------------------------------------- row-level security

def eu_only(env, who="alice"):
    g = group(env, "EU team", [who])
    rule(env, g["id"], "q_customers", "region", ["EU"])
    return g


def test_rules_filter_questions(env):
    assert len(query(env, "alice", CUSTOMERS)["result"]["rows"]) == 4
    eu_only(env)
    rows = query(env, "alice", CUSTOMERS)["result"]["rows"]
    assert rows == [["Anna", "EU"], ["50% Club", "EU"]]
    assert len(query(env, "admin", CUSTOMERS)["result"]["rows"]) == 4  # admins are never restricted
    assert len(query(env, "carol", CUSTOMERS)["result"]["rows"]) == 4  # not in the group
    # on a joined table too: orders of EU customers only
    assert query(env, "alice", JOINED)["result"]["rows"] == [["EU", 3]]
    # the shown SQL carries the condition
    compiled = call(env, "alice", "POST", "/api/query/compile", json={"spec": CUSTOMERS})
    assert "region" in compiled["sql"].lower() and " in " in compiled["sql"].lower()


def test_rules_reach_saved_questions_dashboards_and_profiles(env):
    q = save_builder(env, "admin", spec=CUSTOMERS, name="All customers")
    team = new_collection(env, "admin", "Shared")
    call(env, "admin", "PATCH", f"/api/questions/{q['id']}", json={"collection_id": team["id"]})
    call(env, "admin", "PUT", f"/api/collections/{team['id']}/permissions", json={"grants": [{"role": "all", "level": "view"}]})
    eu_only(env)
    assert len(run(env, "alice", q["id"])["result"]["rows"]) == 2
    snap = call(env, "alice", "POST", "/api/profile/table", json={"connection": "shop", "table": "q_customers", "wait_ms": 5000})
    if snap["status"] == "running":
        snap = wait_done(env["client"], env["alice"], snap["task_id"])
    assert snap["result"]["analysis"]["profile"]["rows_profiled"] == 2


def test_sql_is_refused_where_rules_apply(env):
    eu_only(env)
    res = call(env, "alice", "POST", "/api/query/sql", 403, json={"connection": "shop", "sql": "SELECT * FROM q_customers"})
    assert "Row-level rules" in res["detail"]
    assert call(env, "alice", "POST", "/api/query/sql/check", json={"connection": "shop", "sql": "SELECT 1"})["ok"] is False
    call(env, "carol", "POST", "/api/query/sql", 200, json={"connection": "shop", "sql": "SELECT 1 AS x", "wait_ms": 5000})


def test_browse_export_and_search(env):
    eu_only(env)
    c = env["client"]
    rows = c.get("/api/connections/shop/browse", params={"table": "q_customers"}, headers=env["alice"]).json()["rows"]
    assert [r["values"]["name"] for r in rows] == ["Anna", "50% Club"]
    csv = c.get("/api/connections/shop/export", params={"table": "q_customers"}, headers=env["alice"]).text
    assert "Bob" not in csv and "Anna" in csv
    # search skips the restricted table
    task = c.post("/api/search", json={"connection": "shop", "phrase": "Bob"}, headers=env["alice"]).json()["task_id"]
    deadline = time.time() + 10
    while time.time() < deadline:
        data = c.get(f"/api/search/{task}", headers=env["alice"]).json()
        if data["status"] != "running":
            break
        time.sleep(0.05)
    assert all(r["table"] != "q_customers" for r in data.get("results", []))


def test_rules_combine_and_name_the_viewer(env):
    eu = eu_only(env)
    us = group(env, "US team", ["alice"])
    rule(env, us["id"], "q_customers", "region", ["US"])
    assert {r[1] for r in query(env, "alice", CUSTOMERS)["result"]["rows"]} == {"EU", "US"}  # either group's rows
    rule(env, eu["id"], "q_customers", "vip", ["1"])  # within a group: all rules
    assert {r[0] for r in query(env, "alice", CUSTOMERS)["result"]["rows"]} == {"Anna", "Bob"}
    # numbers compare as numbers; {username} is the viewer
    own = group(env, "Own orders", ["carol"])
    rule(env, own["id"], "q_orders", "customer_id", ["2", "x"])
    assert [r[0] for r in query(env, "carol", ORDERS_BY_CUSTOMER)["result"]["rows"]] == [3, 4]
    named = group(env, "Named", ["bob"], connections=["shop"])
    rule(env, named["id"], "q_customers", "name", ["{username}"])
    assert query(env, "bob", CUSTOMERS)["result"]["rows"] == []  # names are compared exactly: "bob" is not "Bob"
    assert "'bob'" in call(env, "bob", "POST", "/api/query/compile", json={"spec": CUSTOMERS})["sql"]


def test_rule_validation(env):
    g = group(env, "G", ["alice"])
    rule(env, g["id"], "nope", "region", ["EU"], status=400)
    rule(env, g["id"], "q_customers", "nope", ["EU"], status=400)
    rule(env, 999, "q_customers", "region", ["EU"], status=404)
    rule(env, g["id"], "q_customers", "region", [" "], status=422)
    r = rule(env, g["id"], "q_customers", "REGION", ["EU"])
    assert r["column"] == "region" and r["group"] == "G"
    call(env, "alice", "POST", "/api/admin/row-rules", 403, json={"group_id": g["id"], "connection": "shop", "table": "q_customers",
                                                                  "column": "region", "values": ["US"]})
    call(env, "admin", "DELETE", f"/api/admin/row-rules/{r['id']}")
    assert len(query(env, "alice", CUSTOMERS)["result"]["rows"]) == 4
