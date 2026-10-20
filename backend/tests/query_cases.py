"""Questions with known answers, run on every engine (see test_query_compiler / test_query_live)."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from .query_data import CUSTOMERS, ORDER_ITEMS, ORDERS

NOW = dt.datetime(2026, 2, 15, 12, 0, 0)  # fixed "now" for relative date filters


def norm(value: Any) -> Any:
    """Make values from different drivers comparable."""
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (Decimal, float)):
        return round(float(value), 4)
    if isinstance(value, dt.datetime):
        return value.isoformat(sep=" ")
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, str) and len(value) == 19 and value[10] == "T":
        return value.replace("T", " ")
    return value


def norm_rows(rows) -> list[tuple]:
    return [tuple(norm(v) for v in row) for row in rows]


@dataclass
class Case:
    name: str
    spec: dict
    expected: list[tuple]
    ordered: bool = False           # compare order too (the spec sorts deterministically)
    skip: tuple[str, ...] = field(default_factory=tuple)  # dialects that cannot run it


def _start(d: dt.datetime, unit: str) -> Any:
    if unit == "minute":
        return d.replace(second=0)
    if unit == "hour":
        return d.replace(minute=0, second=0)
    day = d.date()
    if unit == "day":
        return day
    if unit == "week":
        return day - dt.timedelta(days=day.weekday())
    if unit == "month":
        return day.replace(day=1)
    if unit == "quarter":
        return day.replace(day=1, month=(day.month - 1) // 3 * 3 + 1)
    return day.replace(day=1, month=1)


def _bucket_case(column: str, unit: str) -> Case:
    counts: dict[Any, int] = {}
    for o in ORDERS:
        value = o[column] if column == "created_at" else dt.datetime.combine(o[column], dt.time())
        key = norm(_start(value, unit))
        counts[key] = counts.get(key, 0) + 1
    return Case(
        f"bucket_{column}_{unit}",
        {"source": {"table": "q_orders"}, "aggregations": [{"fn": "count", "alias": "n"}],
         "breakouts": [{"ref": column, "bucket": unit, "alias": "period"}]},
        sorted(counts.items()),
        ordered=True,
    )


def _customers(pred) -> list[tuple]:
    return [(c["id"],) for c in CUSTOMERS if pred(c)]


def _ids(pred) -> list[tuple]:
    return [(o["id"],) for o in ORDERS if pred(o)]


def _cust_filter(name: str, rule: dict, pred) -> Case:
    return Case(
        name,
        {"source": {"table": "q_customers"}, "fields": [{"ref": "id"}], "filters": {"op": "and", "rules": [rule]},
         "order": [{"ref": "id"}]},
        _customers(pred),
        ordered=True,
    )


def _per_item(o) -> Any:
    if o["total"] is None or not o["qty"]:
        return None
    return o["total"] / o["qty"]


CASES: list[Case] = [
    Case(
        "revenue_by_month_and_region",
        {
            "source": {"table": "q_orders"},
            "joins": [{"table": "q_customers"}],
            "aggregations": [
                {"fn": "sum", "ref": "q_orders.total", "alias": "revenue"},
                {"fn": "count_distinct", "ref": "q_orders.customer_id", "alias": "buyers"},
            ],
            "breakouts": [{"ref": "q_orders.created_at", "bucket": "month"}, {"ref": "q_customers.region"}],
            "filters": {"op": "and", "rules": [{"ref": "q_orders.status", "op": "=", "value": "paid"}]},
        },
        [("2025-12-01", None, 10.0, 0), ("2026-01-01", "EU", 150.0, 1), ("2026-02-01", "US", 200.0, 1),
         ("2026-04-01", None, 0.0, 1)],
    ),
    *[_bucket_case("created_at", u) for u in ("minute", "hour", "day", "week", "month", "quarter", "year")],
    *[_bucket_case("paid_on", u) for u in ("day", "week", "month", "quarter", "year")],
    Case(
        "bin_totals_by_50",
        {"source": {"table": "q_orders"}, "aggregations": [{"fn": "count", "alias": "n"}],
         "breakouts": [{"ref": "total", "bin_width": 50}]},
        [(0.0, 3), (50.0, 2), (100.0, 1), (200.0, 1)],
        ordered=True,
    ),
    Case(
        "nested_and_or",
        {"source": {"table": "q_orders"}, "fields": [{"ref": "id"}],
         "filters": {"op": "or", "rules": [
             {"op": "and", "rules": [{"ref": "status", "op": "=", "value": "paid"}, {"ref": "total", "op": ">", "value": 60}]},
             {"ref": "status", "op": "is_null"},
         ]},
         "order": [{"ref": "id"}]},
        [(1,), (3,), (6,)],
        ordered=True,
    ),
    _cust_filter("contains_literal_percent", {"ref": "name", "op": "contains", "value": "50%"}, lambda c: "50%" in c["name"]),
    _cust_filter("contains_underscore_is_literal", {"ref": "name", "op": "contains", "value": "_"}, lambda c: "_" in c["name"]),
    _cust_filter("contains_case_insensitive", {"ref": "name", "op": "contains", "value": "N"}, lambda c: "n" in c["name"].lower()),
    _cust_filter("starts_with", {"ref": "name", "op": "starts_with", "value": "b"}, lambda c: c["name"].lower().startswith("b")),
    _cust_filter("ends_with", {"ref": "name", "op": "ends_with", "value": "N"}, lambda c: c["name"].lower().endswith("n")),
    _cust_filter("not_contains_keeps_nulls", {"ref": "name", "op": "not_contains", "value": "an"}, lambda c: "an" not in c["name"].lower()),
    _cust_filter("not_equal_keeps_nulls", {"ref": "region", "op": "!=", "value": "EU"}, lambda c: c["region"] != "EU"),
    _cust_filter("in_list", {"ref": "region", "op": "in", "value": ["EU", "US"]}, lambda c: c["region"] in ("EU", "US")),
    _cust_filter("not_in_keeps_nulls", {"ref": "region", "op": "not_in", "value": ["US"]}, lambda c: c["region"] != "US"),
    _cust_filter("is_empty", {"ref": "region", "op": "is_empty"}, lambda c: not c["region"]),
    _cust_filter("is_true", {"ref": "vip", "op": "is_true"}, lambda c: c["vip"] is True),
    _cust_filter("is_false", {"ref": "vip", "op": "is_false"}, lambda c: c["vip"] is False),
    _cust_filter("injection_is_just_a_value", {"ref": "name", "op": "=", "value": "x' OR '1'='1"}, lambda c: False),
    Case(
        "between_datetimes",
        {"source": {"table": "q_orders"}, "fields": [{"ref": "id"}],
         "filters": {"rules": [{"ref": "created_at", "op": "between", "value": ["2026-01-01", "2026-02-28"]}]},
         "order": [{"ref": "id"}]},
        _ids(lambda o: dt.datetime(2026, 1, 1) <= o["created_at"] <= dt.datetime(2026, 2, 28)),
        ordered=True,
    ),
    Case(
        "between_dates",
        {"source": {"table": "q_orders"}, "fields": [{"ref": "id"}],
         "filters": {"rules": [{"ref": "paid_on", "op": "between", "value": ["2026-01-11", "2026-02-14"]}]},
         "order": [{"ref": "id"}]},
        _ids(lambda o: dt.date(2026, 1, 11) <= o["paid_on"] <= dt.date(2026, 2, 14)),
        ordered=True,
    ),
    Case(
        "relative_last_month",
        {"source": {"table": "q_orders"}, "fields": [{"ref": "id"}],
         "filters": {"rules": [{"ref": "created_at", "op": "last", "value": {"amount": 1, "unit": "month"}}]},
         "order": [{"ref": "id"}]},
        [(1,), (2,)],
        ordered=True,
    ),
    Case(
        "relative_current_quarter_on_date",
        {"source": {"table": "q_orders"}, "fields": [{"ref": "id"}],
         "filters": {"rules": [{"ref": "paid_on", "op": "current", "value": {"unit": "quarter"}}]},
         "order": [{"ref": "id"}]},
        [(1,), (2,), (3,), (4,)],
        ordered=True,
    ),
    Case(
        "having_and_order_by_aggregate_alias",
        {"source": {"table": "q_orders"},
         "aggregations": [{"fn": "sum", "ref": "total", "alias": "revenue"}],
         "breakouts": [{"ref": "customer_id"}],
         "having": [{"ref": "revenue", "op": ">", "value": 60}],
         "order": [{"ref": "revenue", "dir": "desc"}]},
        [(2, 230.0), (1, 150.0), (4, 75.5)],
        ordered=True,
    ),
    Case(
        "avg_of_integers_is_not_truncated",
        {"source": {"table": "q_orders"}, "aggregations": [{"fn": "avg", "ref": "qty", "alias": "a"},
                                                        {"fn": "min", "ref": "created_at", "alias": "first"},
                                                        {"fn": "count", "ref": "qty", "alias": "n"}]},
        [(round(19 / 6, 4), "2025-12-29 09:00:00", 6)],
    ),
    Case(
        "three_hop_join_via_foreign_keys",
        {"source": {"table": "q_customers"}, "joins": [{"table": "q_products", "type": "inner"}],
         "aggregations": [{"fn": "count_distinct", "ref": "q_products.sku", "alias": "skus"}],
         "breakouts": [{"ref": "q_customers.name"}]},
        [("Anna", 2), ("Bob", 1), ("Chen", 1)],
        ordered=True,
    ),
    Case(
        "explicit_join_with_aliases",
        {"source": {"table": "q_orders", "alias": "o"},
         "joins": [{"table": "q_customers", "alias": "c", "type": "inner",
                    "on": [{"left": "o.customer_id", "right": "c.id"}]}],
         "fields": [{"ref": "o.id"}, {"ref": "c.name"}],
         "filters": {"rules": [{"ref": "c.region", "op": "=", "value": "EU"}]},
         "order": [{"ref": "o.id"}]},
        [(1, "Anna"), (2, "Anna"), (6, "50% Club")],
        ordered=True,
    ),
    Case(
        "custom_expressions",
        {"source": {"table": "q_orders"},
         "expressions": [
             {"name": "per_item", "expr": {"op": "/", "args": [{"ref": "total"}, {"ref": "qty"}]}},
             {"name": "size", "expr": {"case": [{"when": {"ref": "total", "op": ">=", "value": 100}, "then": {"value": "big"}}],
                                       "else": {"value": "small"}}},
             {"name": "state", "expr": {"fn": "coalesce", "args": [{"ref": "status"}, {"value": "none"}]}},
             {"name": "third", "expr": {"fn": "round", "digits": 2,
                                        "args": [{"op": "/", "args": [{"ref": "total"}, {"value": 3}]}]}},
             {"name": "label", "expr": {"fn": "concat", "args": [{"ref": "status"}, {"value": "-"}, {"ref": "id"}]}},
             {"name": "name_len", "expr": {"fn": "length", "args": [{"ref": "status"}]}},
         ],
         "fields": [{"ref": "id"}, {"ref": "per_item"}, {"ref": "size"}, {"ref": "state"}, {"ref": "third"},
                    {"ref": "label"}, {"ref": "name_len"}],
         "order": [{"ref": "id"}]},
        [
            (o["id"], norm(_per_item(o)), "big" if o["total"] >= 100 else "small", o["status"] or "none",
             round(float(o["total"]) / 3, 2), f"{o['status']}-{o['id']}" if o["status"] else None,
             len(o["status"]) if o["status"] else None)
            for o in ORDERS
        ],
        ordered=True,
    ),
    Case(
        "group_by_custom_expression_with_a_text_constant",
        {"source": {"table": "q_orders"},
         "expressions": [{"name": "state", "expr": {"fn": "coalesce", "args": [{"ref": "status"}, {"value": "none"}]}}],
         "aggregations": [{"fn": "count", "alias": "n"}],
         "breakouts": [{"ref": "state"}]},
        [("none", 1), ("paid", 5), ("refunded", 1)],
        ordered=True,
    ),
    Case(
        "group_by_case_expression_with_a_threshold",
        {"source": {"table": "q_orders"},
         "expressions": [{"name": "size", "expr": {
             "case": [{"when": {"ref": "total", "op": ">=", "value": 100}, "then": {"value": "big"}}],
             "else": {"value": "small"}}}],
         "aggregations": [{"fn": "count", "alias": "n"}],
         "breakouts": [{"ref": "size"}]},
        [("big", 2), ("small", 5)],
        ordered=True,
    ),
    Case(
        "full_join",
        {"source": {"table": "q_orders"}, "joins": [{"table": "q_customers", "type": "full"}],
         "aggregations": [{"fn": "count", "alias": "n"}]},
        [(7,)],  # every customer has an order; order 7 has none
        skip=("mysql", "mariadb"),
    ),
]

ITEMS_TOTAL = sum(i["qty"] for i in ORDER_ITEMS)
