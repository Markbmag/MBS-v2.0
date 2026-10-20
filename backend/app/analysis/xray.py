"""X-ray (roadmap M7): a first dashboard for a table (or a question), made from its profile.

The cards are ordinary builder questions over the same table (keeping the question's
joins and filters), so they run on the database like any question and can be saved:

* how many rows; totals of the main numbers
* rows over time (by day, week, month or year, after the date range) and the main
  numbers over time
* rows per category (columns with a few distinct values; a pie when there are <= 6)
* how the main numbers are distributed (ranges)

Columns marked hidden in the data model, ids and keys are left out.
"""

from __future__ import annotations

from typing import Any

from .profile import nice_width

MAX_MEASURES = 3
MAX_CATEGORIES = 4
CATEGORY_MAX_DISTINCT = 40
_DATE_HINTS = ("created", "date", "time", "day", "_at", "_on", "built", "shipped", "ordered")


def _label(col: dict[str, Any]) -> str:
    return col.get("display_name") or col["name"].replace("_", " ").strip().capitalize()


def _card(key: str, title: str, spec: dict[str, Any], viz: dict[str, Any] | None, w: int, h: int) -> dict[str, Any]:
    return {"key": key, "title": title, "spec": spec, "viz": viz or {"mode": "chart", "spec": None}, "w": w, "h": h}


def build_cards(base: dict[str, Any], columns: list[dict[str, Any]], title: str) -> dict[str, Any]:
    """`base`: the question without summaries ({connection, source, joins, filters, expressions}).
    `columns`: profiled columns, each with "ref" (alias.column) and the profile fields."""
    usable = [c for c in columns if not c.get("hidden") and c.get("nulls", 0) < c.get("rows", 0)]
    measures = [
        c for c in usable
        if c["type"] == "number" and not c.get("id_like") and c.get("distinct", 0) > 5
        and c.get("semantic_type") not in ("id", "latitude", "longitude")
    ][:MAX_MEASURES]
    dates = sorted(
        [c for c in usable if c["type"] in ("date", "datetime") and c.get("distinct", 0) > 1],
        key=lambda c: (not any(h in c["name"].lower() for h in _DATE_HINTS), c["name"]),
    )
    categories = [
        c for c in usable
        if c["type"] in ("string", "boolean") and 2 <= c.get("distinct", 0) <= CATEGORY_MAX_DISTINCT
        and not c.get("id_like") and c.get("semantic_type") not in ("id", "email", "url", "description", "name")
    ][:MAX_CATEGORIES]

    def q(**parts: Any) -> dict[str, Any]:
        return {**base, **parts}

    cards: list[dict[str, Any]] = []
    cards.append(_card("rows", "Number of rows", q(aggregations=[{"fn": "count", "alias": "rows"}]),
                       {"mode": "chart", "spec": {"version": 1, "type": "kpi", "value": "rows"}}, 3, 4))
    for m in measures[:2]:
        alias = f"sum_{m['name']}"[:60]
        cards.append(_card(f"total_{m['name']}", f"Sum of {_label(m).lower()}",
                           q(aggregations=[{"fn": "sum", "ref": m["ref"], "alias": alias}]),
                           {"mode": "chart", "spec": {"version": 1, "type": "kpi", "value": alias}}, 3, 4))
    if dates:
        d = dates[0]
        unit = {"day": "day", "week": "week", "month": "month", "year": "year"}.get(d.get("unit", "month"), "month")
        x = f"{d['name']}_{unit}"[:60]
        line = lambda y: {"mode": "chart", "spec": {"version": 1, "type": "line", "x": x, "series": [{"y": y}]}}  # noqa: E731
        cards.append(_card(f"rows_by_{d['name']}", f"Rows by {unit} of {_label(d).lower()}",
                           q(breakouts=[{"ref": d["ref"], "bucket": unit, "alias": x}], aggregations=[{"fn": "count", "alias": "rows"}]),
                           line("rows"), 6, 7))
        for m in measures[:2]:
            alias = f"sum_{m['name']}"[:60]
            cards.append(_card(f"{m['name']}_by_{d['name']}", f"Sum of {_label(m).lower()} by {unit}",
                               q(breakouts=[{"ref": d["ref"], "bucket": unit, "alias": x}],
                                 aggregations=[{"fn": "sum", "ref": m["ref"], "alias": alias}]),
                               line(alias), 6, 7))
    for c in categories:
        name = c["name"][:60]
        pie = c.get("distinct", 0) <= 6
        viz = (
            {"mode": "chart", "spec": {"version": 1, "type": "pie", "x": name, "value": "rows", "donut": True}}
            if pie else
            {"mode": "chart", "spec": {"version": 1, "type": "bar", "x": name, "series": [{"y": "rows"}], "horizontal": True, "topN": 12}}
        )
        cards.append(_card(f"rows_by_{c['name']}", f"Rows by {_label(c).lower()}",
                           q(breakouts=[{"ref": c["ref"], "alias": name}], aggregations=[{"fn": "count", "alias": "rows"}],
                             order=[{"ref": "rows", "dir": "desc"}], limit=50),
                           viz, 4 if pie else 6, 7))
    for m in measures[:2]:
        if m.get("min") is None or m.get("max") is None or m["min"] == m["max"]:
            continue
        lo, hi = m.get("p05", m["min"]), m.get("p95", m["max"])
        width = nice_width(float(lo if lo is not None else m["min"]), float(hi if hi is not None else m["max"]))
        x = f"{m['name']}_bin"[:60]
        cards.append(_card(f"dist_{m['name']}", f"How {_label(m).lower()} is distributed",
                           q(breakouts=[{"ref": m["ref"], "bin_width": width, "alias": x}], aggregations=[{"fn": "count", "alias": "rows"}]),
                           {"mode": "chart", "spec": {"version": 1, "type": "bar", "x": x, "series": [{"y": "rows"}]}}, 6, 7))
    return {"title": title, "cards": _layout(cards)}


def _layout(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Left to right in rows of 12 columns."""
    x = y = row_h = 0
    for c in cards:
        if x + c["w"] > 12:
            x, y, row_h = 0, y + row_h, 0
        c["layout"] = {"x": x, "y": y, "w": c.pop("w"), "h": c.pop("h")}
        x += c["layout"]["w"]
        row_h = max(row_h, c["layout"]["h"])
    return cards
