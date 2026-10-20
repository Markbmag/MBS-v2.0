"""A DataDesk app database (app-data.sqlite) built from DataDesk's schema, for the importer tests.

Reports keep their spec as JSON in spec_json, a kind (single / sql / multi), a chart
type and the chart's axis settings; dashboards list their report ids.
"""

import json
import sqlite3

REPORTS = [
    # 1: the typical builder report, with nested AND/OR filters
    (1, "Revenue by region", "single", {
        "database": "db1", "from": "q_orders",
        "joins": [{"table": "q_customers", "type": "left", "on": {"left": "q_orders.customer_id", "right": "q_customers.id"}}],
        "select": [{"table": "q_customers", "column": "region"}, {"table": "q_orders", "column": "total", "aggregate": "sum", "alias": "revenue"}],
        "where": {"logic": "AND", "conditions": [
            {"column": "status", "operator": "=", "value": "paid"},
            {"logic": "OR", "conditions": [{"column": "total", "operator": ">", "value": 10}, {"column": "qty", "operator": "isNull"}]},
        ]},
        "groupBy": ["q_customers.region"],
        "orderBy": [{"column": "revenue", "direction": "DESC"}],
        "limit": 100,
    }, "bar", {"xKey": "region", "yKeys": ["revenue"]}),
    (2, "Orders per status", "sql", {"database": "db1", "sql": "SELECT status, count(*) AS n FROM q_orders GROUP BY status"}, "pie", {"xKey": "status", "yKeys": ["n"]}),
    (3, "Cleanup", "sql", {"database": "db1", "sql": "DELETE FROM q_orders"}, "table", None),
    (4, "Orders vs tickets", "multi", {"sources": [
        {"label": "orders", "database": "db1", "spec": {"from": "q_orders"}, "keyColumn": "customer_id"},
        {"label": "tickets", "database": "db2", "sql": "SELECT * FROM tickets", "keyColumn": "customer"},
    ]}, "table", None),
    (5, "Regex filter", "single", {"database": "db1", "from": "q_orders",
        "where": [{"column": "status", "operator": "regex", "value": "^p"}]}, "table", None),
    (6, "Customers starting with A", "single", {"database": "db1", "from": "q_customers",
        "select": ["name", "region"], "where": [{"column": "name", "operator": "like", "value": "A%"}]}, "number", None),
    (7, "Somewhere else", "single", {"database": "db9", "from": "things"}, "line", None),
]
DASHBOARDS = [(1, "Sales", [1, 2]), (2, "Operations", [4, 99])]


def build(path) -> None:
    con = sqlite3.connect(path)
    con.executescript(
        """
        CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
        CREATE TABLE reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, kind TEXT NOT NULL,
            spec_json TEXT NOT NULL, chart_type TEXT, chart_config TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE dashboards (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, report_ids TEXT NOT NULL DEFAULT '[]',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    con.execute("INSERT INTO users (username, password_hash) VALUES ('admin', 'x')")
    for rid, name, kind, spec, chart, config in REPORTS:
        con.execute(
            "INSERT INTO reports (id, name, kind, spec_json, chart_type, chart_config) VALUES (?, ?, ?, ?, ?, ?)",
            (rid, name, kind, json.dumps(spec), chart, json.dumps(config) if config else None),
        )
    for did, name, ids in DASHBOARDS:
        con.execute("INSERT INTO dashboards (id, name, report_ids) VALUES (?, ?, ?)", (did, name, json.dumps(ids)))
    con.commit()
    con.close()
