"""GET /api/connections/{key}/schema on a real (SQLite) database with foreign keys."""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.appdb import AppDB
from app.config import Settings, load_connections
from app.security import hash_password

from .helpers import auth


@pytest.fixture()
def client(tmp_path):
    shop = tmp_path / "shop.db"
    con = sqlite3.connect(shop)
    con.executescript(
        """
        CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, region TEXT);
        CREATE TABLE products (sku TEXT PRIMARY KEY, title TEXT, price NUMERIC(10, 2));
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id),
            created_at DATETIME, paid BOOLEAN
        );
        CREATE TABLE order_items (
            order_id INTEGER REFERENCES orders(id), sku TEXT REFERENCES products(sku), qty INTEGER,
            PRIMARY KEY (order_id, sku)
        );
        CREATE VIEW big_orders AS SELECT * FROM orders;
        """
    )
    con.close()
    connections = load_connections(
        {"NCODE_CONN_SHOP_ENGINE": "sqlite", "NCODE_CONN_SHOP_DATABASE": str(shop)}
    )
    app_db = AppDB(tmp_path / "app.sqlite")
    app_db.create_user("alice", hash_password("alice-pass-1"))
    app_db.create_user("bob", hash_password("bob-pass-12"), allowed=("other",))
    with TestClient(create_app(Settings(search_workers=2), connections, app_db)) as c:
        yield c


def test_schema_v2(client):
    res = client.get("/api/connections/shop/schema", headers=auth(client, "alice", "alice-pass-1"))
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["connection"] == "shop" and data["version"] == 2
    tables = {t["name"]: t for t in data["tables"]}
    assert set(tables) == {"customers", "products", "orders", "order_items"}  # views are not tables

    assert tables["order_items"]["primary_key"] == ["order_id", "sku"]
    cols = {c["name"]: c for c in tables["orders"]["columns"]}
    assert cols["id"]["primary_key"] is True
    assert cols["customer_id"]["foreign_key"] == {"table": "customers", "column": "id"}
    assert (cols["created_at"]["type"], cols["paid"]["type"]) == ("datetime", "boolean")
    assert {c["name"]: c["type"] for c in tables["products"]["columns"]} == {
        "sku": "string", "title": "string", "price": "number",
    }

    pairs = {(r["from_table"], r["to_table"]) for r in data["relationships"]}
    assert pairs == {("orders", "customers"), ("order_items", "orders"), ("order_items", "products")}


def test_schema_respects_connection_access(client):
    res = client.get("/api/connections/shop/schema", headers=auth(client, "bob", "bob-pass-12"))
    assert res.status_code == 404
    assert client.get("/api/connections/shop/schema").status_code == 401
