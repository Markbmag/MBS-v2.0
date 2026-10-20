"""Table explorer: paged browsing, filtering, structure, CSV export."""

import csv
import io
import sqlite3

import pytest

from app.config import Settings

from .helpers import auth
from .test_connections import make_app


@pytest.fixture()
def env(tmp_path, sample_db):
    con = sqlite3.connect(sample_db)
    con.execute("INSERT INTO notes VALUES (4, '=HYPERLINK(\"http://x\")')")
    con.execute("INSERT INTO notes VALUES (5, 'a;b \"quoted\"')")
    con.commit()
    con.close()
    client, app_db = make_app(tmp_path, sample_db)
    yield client, app_db, auth(client, "alice", "alice-pass-1"), tmp_path, sample_db
    client.close()


def browse(client, headers, **params):
    params.setdefault("table", "notes")
    res = client.get("/api/connections/envdb/browse", params=params, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def ids(data):
    return [r["values"]["id"] for r in data["rows"]]


def test_browse_returns_rows_in_primary_key_order(env):
    client, _, headers, *_ = env
    data = browse(client, headers)
    assert data["columns"] == ["id", "body"] and data["has_more"] is False
    assert ids(data) == [1, 2, 3, 4, 5]


def test_pagination(env):
    client, _, headers, *_ = env
    first = browse(client, headers, limit=2, offset=0)
    assert ids(first) == [1, 2] and first["has_more"] is True
    second = browse(client, headers, limit=2, offset=2)
    assert ids(second) == [3, 4] and second["has_more"] is True
    last = browse(client, headers, limit=2, offset=4)
    assert ids(last) == [5] and last["has_more"] is False


def test_sorting_and_unknown_sort_column(env):
    client, _, headers, *_ = env
    data = browse(client, headers, sort="id", desc="true", limit=2)
    assert ids(data) == [5, 4] and data["sort"] == "id" and data["descending"] is True
    ignored = browse(client, headers, sort="no_such_column")
    assert ignored["sort"] is None and ids(ignored)[0] == 1


def test_filter_reports_matched_columns(env):
    client, _, headers, *_ = env
    data = browse(client, headers, q="passat")
    assert ids(data) == [3] and data["rows"][0]["matched"] == ["body"]


def test_filter_modes_and_wildcard_escaping(env):
    client, _, headers, *_ = env
    assert ids(browse(client, headers, q="100 items", mode="exact")) == [2]
    assert ids(browse(client, headers, q="100%")) == [1]  # % is literal, not a wildcard
    assert ids(browse(client, headers, q="PASS", mode="starts_with")) == [3]


def test_numeric_filter_needs_the_flag(env):
    client, _, headers, *_ = env
    assert browse(client, headers, table="vehicles", q="120345")["rows"] == []
    found = browse(client, headers, table="vehicles", q="120345", include_numeric="true")
    assert [r["values"]["id"] for r in found["rows"]] == [1]


def test_binary_columns_are_left_out(env):
    client, _, headers, *_ = env
    data = browse(client, headers, table="vehicles")
    assert "photo" in data["omitted"] and "photo" not in data["columns"]


def test_table_name_is_resolved_case_insensitively_and_unknown_is_404(env):
    client, _, headers, *_ = env
    assert browse(client, headers, table="NOTES")["table"] == "notes"
    res = client.get("/api/connections/envdb/browse", params={"table": "nope; DROP TABLE notes"}, headers=headers)
    assert res.status_code == 404
    assert browse(client, headers)["rows"]  # nothing was dropped


def test_requires_login_and_known_connection(env):
    client, _, headers, *_ = env
    assert client.get("/api/connections/envdb/browse", params={"table": "notes"}).status_code == 401
    assert client.get("/api/connections/missing/browse", params={"table": "notes"}, headers=headers).status_code == 404


def test_page_size_is_capped_by_the_server(tmp_path, sample_db):
    client, _ = make_app(tmp_path, sample_db, settings=Settings(search_workers=2, max_row_limit=2))
    headers = auth(client, "alice", "alice-pass-1")
    data = browse(client, headers, limit=100)
    assert len(data["rows"]) == 2 and data["has_more"] is True and data["limit"] == 2
    assert client.get("/api/limits", headers=headers).json()["max_row_limit"] == 2
    client.close()


def test_structure(env):
    client, _, headers, *_ = env
    res = client.get("/api/connections/envdb/structure", params={"table": "vehicles"}, headers=headers).json()
    cols = {c["name"]: c for c in res["columns"]}
    assert list(cols) == ["id", "vin", "model", "mileage", "built", "photo"]
    assert cols["id"]["primary_key"] is True and cols["vin"]["primary_key"] is False
    assert "TEXT" in cols["vin"]["type"].upper()


def read_csv(response):
    text = response.text
    assert text.startswith("\ufeff")  # BOM so Excel reads UTF-8
    return list(csv.reader(io.StringIO(text.lstrip("\ufeff")), delimiter=";"))


def test_csv_export_streams_everything_and_neutralises_formulas(env):
    client, app_db, headers, *_ = env
    res = client.get("/api/connections/envdb/export", params={"table": "notes"}, headers=headers)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert 'filename="notes.csv"' in res.headers["content-disposition"]
    rows = read_csv(res)
    assert rows[0] == ["id", "body"] and len(rows) == 6
    bodies = {r[0]: r[1] for r in rows[1:]}
    assert bodies["4"].startswith("'=HYPERLINK")  # would otherwise run as a formula
    assert bodies["5"] == 'a;b "quoted"'  # delimiter and quotes survive
    assert any(r.action == "export" for r in app_db.list_audit(10))


def test_csv_export_of_matches_only(env):
    client, _, headers, *_ = env
    res = client.get("/api/connections/envdb/export", params={"table": "notes", "q": "passat"}, headers=headers)
    rows = read_csv(res)
    assert len(rows) == 2 and rows[1][1] == "Passat service"


def test_csv_export_respects_the_row_cap_and_delimiter(tmp_path, sample_db):
    client, _ = make_app(tmp_path, sample_db, settings=Settings(search_workers=2, max_export_rows=2))
    headers = auth(client, "alice", "alice-pass-1")
    res = client.get("/api/connections/envdb/export", params={"table": "notes", "delimiter": ","}, headers=headers)
    lines = res.text.lstrip("\ufeff").strip().splitlines()
    assert lines[0] == "id,body" and len(lines) == 3  # header + 2 capped rows
    bad = client.get("/api/connections/envdb/export", params={"table": "notes", "delimiter": "|"}, headers=headers)
    assert bad.status_code == 422
    client.close()
