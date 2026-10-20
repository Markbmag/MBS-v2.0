"""A small shop dataset that loads into any database (SQLite, PostgreSQL, MariaDB, SQL Server).

Used by the compiler tests on SQLite and by the live tests on real servers, so
the same questions are checked on every engine against the same expectations.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey, Integer, MetaData, Numeric, String, Table, inspect,
)

metadata = MetaData()

customers = Table(
    "q_customers", metadata,
    Column("id", Integer, primary_key=True, autoincrement=False),
    Column("name", String(50), nullable=False),
    Column("region", String(10)),
    Column("vip", Boolean),
)
products = Table(
    "q_products", metadata,
    Column("sku", String(10), primary_key=True),
    Column("title", String(50)),
    Column("price", Numeric(10, 2)),
)
orders = Table(
    "q_orders", metadata,
    Column("id", Integer, primary_key=True, autoincrement=False),
    Column("customer_id", Integer, ForeignKey("q_customers.id")),
    Column("status", String(20)),
    Column("total", Numeric(10, 2)),
    Column("qty", Integer),
    Column("created_at", DateTime),
    Column("paid_on", Date),
)
order_items = Table(
    "q_order_items", metadata,
    Column("order_id", Integer, ForeignKey("q_orders.id"), primary_key=True, autoincrement=False),
    Column("sku", String(10), ForeignKey("q_products.sku"), primary_key=True),
    Column("qty", Integer),
)

CUSTOMERS = [
    {"id": 1, "name": "Anna", "region": "EU", "vip": True},
    {"id": 2, "name": "Bob", "region": "US", "vip": False},
    {"id": 3, "name": "Chen", "region": None, "vip": None},
    {"id": 4, "name": "50% Club", "region": "EU", "vip": False},
]
PRODUCTS = [
    {"sku": "A", "title": "Apple", "price": Decimal("1.50")},
    {"sku": "B", "title": "Bread", "price": Decimal("2.00")},
    {"sku": "C", "title": "Cheese", "price": None},
]


def _o(i, customer, status, total, qty, when):
    created = dt.datetime.fromisoformat(when)
    return {"id": i, "customer_id": customer, "status": status, "total": Decimal(total) if total is not None else None,
            "qty": qty, "created_at": created, "paid_on": created.date()}


ORDERS = [
    _o(1, 1, "paid", "100.00", 3, "2026-01-05 10:15:00"),      # Monday
    _o(2, 1, "paid", "50.00", 10, "2026-01-11 23:59:00"),      # Sunday, same ISO week
    _o(3, 2, "paid", "200.00", 1, "2026-02-01 00:00:00"),      # Sunday
    _o(4, 2, "refunded", "30.00", 0, "2026-02-14 12:30:00"),   # Saturday
    _o(5, 3, "paid", "0.00", 3, "2026-04-01 08:00:00"),        # Wednesday, Q2
    _o(6, 4, None, "75.50", 2, "2026-12-31 23:30:00"),         # Thursday, Q4
    _o(7, None, "paid", "10.00", None, "2025-12-29 09:00:00"), # Monday, previous year
]
ORDER_ITEMS = [
    {"order_id": 1, "sku": "A", "qty": 2},
    {"order_id": 1, "sku": "B", "qty": 1},
    {"order_id": 2, "sku": "A", "qty": 10},
    {"order_id": 3, "sku": "C", "qty": 1},
    {"order_id": 5, "sku": "B", "qty": 3},
]


def load(engine, schema: str | None = None) -> None:
    """(Re)create the tables and rows."""
    md = metadata if schema is None else metadata.to_metadata(MetaData(), schema=schema)
    md.drop_all(engine)
    md.create_all(engine)
    by_name = {t.name: t for t in md.tables.values()}
    with engine.begin() as conn:
        conn.execute(by_name["q_customers"].insert(), CUSTOMERS)
        conn.execute(by_name["q_products"].insert(), PRODUCTS)
        conn.execute(by_name["q_orders"].insert(), ORDERS)
        conn.execute(by_name["q_order_items"].insert(), ORDER_ITEMS)


def reflect(engine, schema: str | None = None):
    """(tables, relationships) the way the API gets them from the registry."""
    from app.schema_graph import relationships

    insp = inspect(engine)
    names = [n for n in insp.get_table_names(schema=schema) if n.startswith("q_")]
    tables = {n: insp.get_columns(n, schema=schema) for n in names}
    fks = {n: insp.get_foreign_keys(n, schema=schema) for n in names}
    return tables, relationships(fks, set(names))
