"""Dashboards (M5): definition round-trip, filters mapped to parameters and columns, permissions."""

import pytest

from .test_library_api import COUNT_BY_STATUS, call, library_env, new_collection, save_builder, save_sql, share
from .test_query_api import wait_done

COUNT_ORDERS = {"connection": "shop", "source": {"table": "q_orders"}, "aggregations": [{"fn": "count", "alias": "n"}]}


@pytest.fixture()
def env(tmp_path):
    yield from library_env(tmp_path)


def new_dashboard(env, who, name="Sales overview", collection=None, status=200):
    return call(env, who, "POST", "/api/dashboards", status, json={"name": name, "collection_id": collection})


def card(key, qid=None, kind="question", x=0, y=0, w=6, h=4, **extra):
    out = {"key": key, "kind": kind, "layout": {"x": x, "y": y, "w": w, "h": h}, **extra}
    if qid is not None:
        out["question_id"] = qid
    return out


def put(env, who, did, definition, status=200):
    return call(env, who, "PUT", f"/api/dashboards/{did}", status, json=definition)


def run_card(env, who, did, key, filters=None, status=200):
    data = call(env, who, "POST", f"/api/dashboards/{did}/cards/{key}/run", status,
                json={"filters": filters or {}, "wait_ms": 5000})
    if status == 200 and data["status"] == "running":
        data = wait_done(env["client"], env[who], data["task_id"])
    return data


def rows(data):
    assert data["status"] == "completed", data
    return data["result"]["rows"]


# ---------------------------------------------------------------- definition

def test_create_save_and_reopen(env):
    q = save_builder(env, "alice", spec=COUNT_ORDERS, name="Orders")
    d = new_dashboard(env, "alice")
    assert d["collection"]["name"] == "alice's collection" and d["cards"] == [] and d["access"] == "edit"
    definition = {
        "tabs": [{"id": "t1", "name": "Overview"}, {"id": "t2", "name": "Details"}],
        "filters": [{"id": "status", "label": "Status", "type": "category"}],
        "settings": {"refresh": 60},
        "cards": [
            card("h", kind="heading", text="Sales", tab="t1", w=12, h=1),
            card("c1", q["id"], tab="t1", y=1, mappings={"status": {"field": "q_orders.status"}}),
            card("note", kind="text", text="**Paid** orders only", tab="t2", x=6, w=6, h=3),
        ],
    }
    saved = put(env, "alice", d["id"], definition)
    again = call(env, "alice", "GET", f"/api/dashboards/{d['id']}")
    assert again["tabs"] == definition["tabs"] and again["settings"] == {"refresh": 60}
    assert [c["key"] for c in again["cards"]] == ["h", "c1", "note"]
    assert again["cards"][1]["layout"] == {"x": 0, "y": 1, "w": 6, "h": 4}
    assert again["cards"][1]["mappings"] == {"status": {"field": "q_orders.status"}}
    assert again["cards"][1]["question"]["name"] == "Orders" and again["cards"][1]["question"]["state"] == "ok"
    assert again["cards"][1]["question"]["tables"] == ["q_orders"]
    assert saved["updated_by"] == "alice"


@pytest.mark.parametrize("bad, message", [
    ({"cards": [card("a", kind="text", text="x"), card("a", kind="text", text="y")]}, "unique"),
    ({"cards": [card("a", kind="text", text="x", x=8, w=6)]}, "wider"),
    ({"cards": [card("a", kind="question")]}, "question_id"),
    ({"cards": [card("a", kind="text", text="x", mappings={"f": {"param": "p"}})]}, "only question cards"),
    ({"filters": [{"id": "f", "label": "F", "type": "text"}], "cards": [card("a", 1, mappings={"g": {"param": "p"}})]}, "unknown filter"),
    ({"tabs": [{"id": "t1", "name": "A"}], "cards": [card("a", kind="text", text="x")]}, "unknown tab"),
    ({"settings": {"refresh": 7}}, "refresh"),
    ({"filters": [{"id": "f", "label": "F", "type": "colour"}]}, "Invalid dashboard"),
])
def test_invalid_definitions_are_refused(env, bad, message):
    d = new_dashboard(env, "alice")
    res = put(env, "alice", d["id"], bad, status=400)
    assert message in res["detail"]


# ---------------------------------------------------------------- filters

def test_filter_mapped_to_a_column(env):
    q = save_builder(env, "alice", spec=COUNT_ORDERS, name="Orders")
    d = new_dashboard(env, "alice")
    put(env, "alice", d["id"], {
        "filters": [
            {"id": "status", "label": "Status", "type": "category"},
            {"id": "period", "label": "Period", "type": "date_range"},
            {"id": "min", "label": "Minimum", "type": "number"},
            {"id": "day", "label": "Day", "type": "date"},
        ],
        "cards": [card("c1", q["id"], mappings={
            "status": {"field": "q_orders.status"}, "period": {"field": "q_orders.created_at"},
            "min": {"field": "q_orders.qty"}, "day": {"field": "q_orders.created_at"},
        })],
    })
    assert rows(run_card(env, "alice", d["id"], "c1")) == [[7]]
    assert rows(run_card(env, "alice", d["id"], "c1", {"status": ["paid", "refunded"]})) == [[6]]
    assert rows(run_card(env, "alice", d["id"], "c1", {"status": "paid"})) == [[5]]
    # the last day of a range counts as a whole day (order 2 is at 23:59 on 2026-01-11)
    assert rows(run_card(env, "alice", d["id"], "c1", {"period": ["2026-01-01", "2026-01-11"]})) == [[2]]
    assert rows(run_card(env, "alice", d["id"], "c1", {"period": ["2026-02-01", ""]})) == [[4]]
    assert rows(run_card(env, "alice", d["id"], "c1", {"min": "3"})) == [[2]]  # orders 1 and 5
    assert rows(run_card(env, "alice", d["id"], "c1", {"day": "2026-12-31"})) == [[1]]
    assert "date" in run_card(env, "alice", d["id"], "c1", {"day": "31.12.2026"}, status=400)["detail"]


def test_filter_mapped_to_parameters(env):
    sql = save_sql(env, "alice", "SELECT count(*) FROM q_orders WHERE paid_on >= {{since}}",
                   parameters=[{"name": "since", "type": "date", "default": "2000-01-01"}])
    builder = save_builder(env, "alice", spec=COUNT_BY_STATUS, parameters=[{"name": "status"}], name="By status")
    d = new_dashboard(env, "alice")
    put(env, "alice", d["id"], {
        "filters": [{"id": "since", "label": "Since", "type": "date", "default": "2026-02-01"},
                    {"id": "status", "label": "Status", "type": "text"}],
        "cards": [card("sql", sql["id"], mappings={"since": {"param": "since"}}),
                  card("b", builder["id"], x=6, mappings={"status": {"param": "status"}})],
    })
    assert rows(run_card(env, "alice", d["id"], "sql")) == [[4]]  # the filter's default
    assert rows(run_card(env, "alice", d["id"], "sql", {"since": "2026-04-01"})) == [[2]]
    assert rows(run_card(env, "alice", d["id"], "b")) == [[7]]
    assert rows(run_card(env, "alice", d["id"], "b", {"status": "paid"})) == [[5]]


def test_filter_values_take_the_shape_of_the_parameter(env):
    sql = save_sql(env, "alice", "SELECT count(*) FROM q_orders WHERE paid_on >= {{since}}",
                   parameters=[{"name": "since", "type": "date", "default": "2000-01-01"}])
    between = {**COUNT_ORDERS, "filters": {"rules": [{"ref": "q_orders.paid_on", "op": "between", "param": "period"}]}}
    b = save_builder(env, "alice", spec=between, parameters=[{"name": "period", "type": "date"}], name="Between")
    listed = {**COUNT_ORDERS, "filters": {"rules": [{"ref": "q_orders.status", "op": "=", "param": "status"}]}}
    one = save_builder(env, "alice", spec=listed, parameters=[{"name": "status"}], name="One status")
    d = new_dashboard(env, "alice")
    put(env, "alice", d["id"], {
        "filters": [{"id": "period", "label": "Period", "type": "date_range"}, {"id": "status", "label": "Status", "type": "category"}],
        "cards": [card("sql", sql["id"], mappings={"period": {"param": "since"}}),
                  card("b", b["id"], x=6, mappings={"period": {"param": "period"}}),
                  card("one", one["id"], y=4, mappings={"status": {"param": "status"}})],
    })
    # a range given to a single-date parameter passes its start ("since")
    assert rows(run_card(env, "alice", d["id"], "sql", {"period": ["2026-04-01", "2026-04-30"]})) == [[2]]
    assert rows(run_card(env, "alice", d["id"], "sql", {"period": ["", "2026-04-30"]})) == [[7]]  # no start: the default
    # ... and both ends to a "between" parameter, an open end reaching far
    assert rows(run_card(env, "alice", d["id"], "b", {"period": ["2026-01-01", "2026-01-31"]})) == [[2]]
    assert rows(run_card(env, "alice", d["id"], "b", {"period": ["2026-04-01", ""]})) == [[2]]
    # a list with one value fits a single-value parameter; with two it does not
    assert rows(run_card(env, "alice", d["id"], "one", {"status": ["refunded"]})) == [[1]]
    assert "takes one" in run_card(env, "alice", d["id"], "one", {"status": ["paid", "refunded"]}, status=400)["detail"]


def test_sql_cards_cannot_be_filtered_by_column(env):
    sql = save_sql(env, "alice", "SELECT 1 AS one")
    d = new_dashboard(env, "alice")
    put(env, "alice", d["id"], {"filters": [{"id": "f", "label": "F", "type": "text"}],
                                 "cards": [card("s", sql["id"], mappings={"f": {"field": "x.y"}})]})
    assert rows(run_card(env, "alice", d["id"], "s")) == [[1]]  # no value: nothing to apply
    assert "parameter" in run_card(env, "alice", d["id"], "s", {"f": "a"}, status=400)["detail"]


def test_required_filter(env):
    q = save_builder(env, "alice", spec=COUNT_ORDERS)
    d = new_dashboard(env, "alice")
    put(env, "alice", d["id"], {"filters": [{"id": "s", "label": "Status", "type": "text", "required": True}],
                                 "cards": [card("c", q["id"], mappings={"s": {"field": "q_orders.status"}})]})
    assert "Status" in run_card(env, "alice", d["id"], "c", status=400)["detail"]


def test_mapping_to_an_unknown_column_is_reported_per_card(env):
    q = save_builder(env, "alice", spec=COUNT_ORDERS)
    d = new_dashboard(env, "alice")
    put(env, "alice", d["id"], {"filters": [{"id": "s", "label": "S", "type": "text"}],
                                 "cards": [card("c", q["id"], mappings={"s": {"field": "q_orders.nope"}})]})
    assert "nope" in run_card(env, "alice", d["id"], "c", {"s": "x"}, status=400)["detail"]


# ---------------------------------------------------------------- permissions

def test_viewer_sees_and_runs_but_cannot_change(env):
    team = new_collection(env, "alice", "Sales")
    q = save_builder(env, "alice", spec=COUNT_ORDERS, collection=team["id"])
    d = new_dashboard(env, "alice", collection=team["id"])
    put(env, "alice", d["id"], {"cards": [card("c", q["id"])]})
    call(env, "carol", "GET", f"/api/dashboards/{d['id']}", 404)
    share(env, "alice", team["id"], [{"user": "carol", "level": "view"}])
    seen = call(env, "carol", "GET", f"/api/dashboards/{d['id']}")
    assert seen["access"] == "view"
    assert rows(run_card(env, "carol", d["id"], "c")) == [[7]]
    put(env, "carol", d["id"], {"cards": []}, status=403)
    call(env, "carol", "PATCH", f"/api/dashboards/{d['id']}", 403, json={"archived": True})


def test_a_dashboard_never_shows_questions_the_viewer_cannot_see(env):
    team = new_collection(env, "alice", "Sales")
    private = save_builder(env, "alice", spec=COUNT_ORDERS, name="Secret numbers")  # alice's own collection
    d = new_dashboard(env, "alice", collection=team["id"])
    put(env, "alice", d["id"], {"cards": [card("p", private["id"])]})
    share(env, "alice", team["id"], [{"user": "carol", "level": "edit"}])
    seen = call(env, "carol", "GET", f"/api/dashboards/{d['id']}")
    assert seen["cards"][0]["question"] == {"state": "hidden"}  # no name, nothing
    assert "not shared" in run_card(env, "carol", d["id"], "p", status=403)["detail"]
    # carol may rearrange the dashboard; alice's card stays
    moved = put(env, "carol", d["id"], {"cards": [card("p", private["id"], x=6)]})
    assert moved["cards"][0]["layout"]["x"] == 6
    # but she cannot add a question she cannot see
    other = save_builder(env, "alice", spec=COUNT_ORDERS, name="Also secret")
    res = put(env, "carol", d["id"], {"cards": [card("p", private["id"]), card("o", other["id"], x=6)]}, status=400)
    assert "not shared" in res["detail"]


def test_bob_without_the_database_cannot_run_cards(env):
    team = new_collection(env, "alice", "Sales")
    q = save_builder(env, "alice", spec=COUNT_ORDERS, collection=team["id"])
    d = new_dashboard(env, "alice", collection=team["id"])
    put(env, "alice", d["id"], {"cards": [card("c", q["id"])]})
    share(env, "alice", team["id"], [{"user": "bob", "level": "view"}])
    call(env, "bob", "GET", f"/api/dashboards/{d['id']}")
    run_card(env, "bob", d["id"], "c", status=404)


# ---------------------------------------------------------------- library life cycle

def test_deleted_question_leaves_a_marked_card(env):
    q = save_builder(env, "alice", spec=COUNT_ORDERS)
    d = new_dashboard(env, "alice")
    put(env, "alice", d["id"], {"cards": [card("c", q["id"])]})
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"archived": True})
    assert call(env, "alice", "GET", f"/api/dashboards/{d['id']}")["cards"][0]["question"]["state"] == "archived"
    call(env, "alice", "DELETE", f"/api/questions/{q['id']}")
    again = call(env, "alice", "GET", f"/api/dashboards/{d['id']}")
    assert again["cards"][0]["question"] == {"state": "deleted"} and again["cards"][0]["question_id"] is None
    assert "deleted" in run_card(env, "alice", d["id"], "c", status=410)["detail"]
    put(env, "alice", d["id"], {"cards": [card("c", kind="text", text="gone")]})  # the card can be replaced


def test_list_favorite_search_archive_delete(env):
    d = new_dashboard(env, "alice", name="Weekly KPIs")
    other = new_dashboard(env, "alice", name="Ops")
    call(env, "alice", "PUT", f"/api/dashboards/{d['id']}/favorite")
    favs = call(env, "alice", "GET", "/api/dashboards", params={"favorites": True})["dashboards"]
    assert [x["id"] for x in favs] == [d["id"]] and favs[0]["favorite"]
    assert [x["name"] for x in call(env, "alice", "GET", "/api/dashboards", params={"q": "kpi"})["dashboards"]] == ["Weekly KPIs"]
    mine = call(env, "alice", "GET", "/api/collections")["personal_id"]
    items = call(env, "alice", "GET", f"/api/collections/{mine}")
    assert {x["name"] for x in items["dashboards"]} == {"Weekly KPIs", "Ops"}
    call(env, "alice", "DELETE", f"/api/dashboards/{other['id']}", 409)
    call(env, "alice", "PATCH", f"/api/dashboards/{other['id']}", json={"archived": True})
    assert [x["id"] for x in call(env, "alice", "GET", "/api/library/archive")["dashboards"]] == [other["id"]]
    assert other["id"] not in [x["id"] for x in call(env, "alice", "GET", "/api/dashboards")["dashboards"]]
    call(env, "alice", "DELETE", f"/api/dashboards/{other['id']}")
    call(env, "alice", "GET", f"/api/dashboards/{other['id']}", 404)


def test_duplicate_keeps_only_visible_questions(env):
    team = new_collection(env, "alice", "Sales")
    shared_q = save_builder(env, "alice", spec=COUNT_ORDERS, collection=team["id"], name="Shared")
    private = save_builder(env, "alice", spec=COUNT_ORDERS, name="Private")
    d = new_dashboard(env, "alice", collection=team["id"])
    put(env, "alice", d["id"], {"cards": [card("a", shared_q["id"]), card("b", private["id"], x=6), card("t", kind="text", text="hi", y=4)]})
    share(env, "alice", team["id"], [{"user": "carol", "level": "view"}])
    copy = call(env, "carol", "POST", f"/api/dashboards/{d['id']}/duplicate", json={})
    assert copy["collection"]["name"] == "carol's collection" and copy["name"] == "Sales overview (copy)"
    assert [c["key"] for c in copy["cards"]] == ["a", "t"]


def test_deleting_a_collection_deletes_its_dashboards(env):
    team = new_collection(env, "alice", "Temp")
    d = new_dashboard(env, "alice", collection=team["id"])
    call(env, "alice", "PATCH", f"/api/collections/{team['id']}", json={"archived": True})
    call(env, "alice", "DELETE", f"/api/collections/{team['id']}")
    call(env, "alice", "GET", f"/api/dashboards/{d['id']}", 404)


def test_move_dashboard(env):
    team = new_collection(env, "alice", "Sales")
    d = new_dashboard(env, "alice")
    moved = call(env, "alice", "PATCH", f"/api/dashboards/{d['id']}", json={"collection_id": team["id"], "name": "Renamed"})
    assert moved["collection_id"] == team["id"] and moved["name"] == "Renamed"
    new_dashboard(env, "carol", collection=team["id"], status=404)
