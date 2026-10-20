"""Import reports and dashboards from a DataDesk app database (roadmap M4).

    python -m app.manage import-datadesk app-data.sqlite --map db1=mes,db2=crm --dry-run
    python -m app.manage import-datadesk app-data.sqlite --map db1=mes,db2=crm --owner mark

What becomes what:

* "single" reports -> builder questions (QuerySpec v1)
* "sql" reports    -> SQL questions, if they pass Ncode's read-only guard
* "multi" reports  -> multi-source questions (M6): every source joined to the first on
                      its key column with a FULL JOIN, as DataDesk merged them - but every
                      row is kept (DataDesk kept only the last row per key)
* dashboards       -> dashboards (M5), each in a collection of the same name that also
                      holds its reports; cards are laid out two per row

Everything lands in a collection "DataDesk import" owned by --owner. The importer reads
the DataDesk file read-only, never touches it, and can be run again: reports imported
before are recognised (by their DataDesk id) and skipped. A dashboard that was imported as
a collection only (before M5) is created by re-running the import, and multi-source
reports imported before M6 (as placeholders) are converted ("upgraded").

DataDesk's tables are read by looking at the columns that exist, so small differences
between DataDesk versions do not matter; whatever cannot be converted is listed in the
report with the reason.
"""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select

from ..appdb import User
from ..federation.spec import FederatedSpec
from ..query.spec import QuerySpec
from ..query.sqlguard import GuardError, check_sql
from .dashboards import Card, DashboardStore, Definition, Layout
from .store import ContentStore
from .tables import collections_table, questions_table

ROOT_NAME = "DataDesk import"
LOOSE_NAME = "Reports not on a dashboard"

# DataDesk operator spellings -> QuerySpec operators (keys are lower-case, no "_" / " ")
OPERATORS = {
    "=": "=", "eq": "=", "equals": "=", "is": "=",
    "!=": "!=", "<>": "!=", "ne": "!=", "neq": "!=", "notequals": "!=",
    ">": ">", "gt": ">", ">=": ">=", "gte": ">=", "<": "<", "lt": "<", "<=": "<=", "lte": "<=",
    "like": "contains", "contains": "contains", "ilike": "contains",
    "notlike": "not_contains", "notcontains": "not_contains",
    "startswith": "starts_with", "endswith": "ends_with",
    "in": "in", "notin": "not_in", "between": "between",
    "isnull": "is_null", "null": "is_null", "isempty": "is_empty",
    "isnotnull": "not_null", "notnull": "not_null", "isnotempty": "not_empty",
    "istrue": "is_true", "isfalse": "is_false",
}
AGGREGATES = {
    "count": "count", "sum": "sum", "avg": "avg", "average": "avg", "min": "min", "max": "max",
    "countdistinct": "count_distinct", "distinct": "count_distinct",
}
CHARTS = {
    "table": "table", "bar": "bar", "column": "bar", "line": "line", "area": "area", "pie": "pie",
    "donut": "pie", "kpi": "kpi", "number": "kpi", "metric": "kpi", "scatter": "scatter",
}
ENGINE_DIALECT = {"mysql": "mysql", "mariadb": "mysql", "postgresql": "postgresql", "mssql": "mssql", "sqlite": "sqlite"}


class ImportError_(Exception):
    pass


class Unconvertible(Exception):
    """One report cannot be converted; the message goes into the report."""


@dataclass
class Item:
    source_id: Any
    name: str
    kind: str
    outcome: str                 # builder | sql | federated | skipped | exists | upgraded
    notes: list[str] = field(default_factory=list)
    collection: str = ""


@dataclass
class ImportReport:
    items: list[Item] = field(default_factory=list)
    dashboards: list[tuple[str, int]] = field(default_factory=list)
    dashboard_outcomes: list[str] = field(default_factory=list)  # "new" | "exists", per dashboard
    warnings: list[str] = field(default_factory=list)
    dry_run: bool = True

    def count(self, outcome: str) -> int:
        return sum(1 for i in self.items if i.outcome == outcome)

    def text(self) -> str:
        head = "DRY RUN - nothing was written" if self.dry_run else "Import finished"
        lines = [
            f"# DataDesk import report ({head})",
            "",
            f"Reports: {len(self.items)} · builder questions: {self.count('builder')} · SQL questions: {self.count('sql')}"
            f" · multi-source: {self.count('federated')} · already imported: {self.count('exists')}"
            f" · upgraded to multi-source: {self.count('upgraded')}"
            f" · could not be converted: {self.count('skipped')}",
            f"Dashboards: {len(self.dashboards)} · new: {self.dashboard_outcomes.count('new')}"
            f" · already imported: {self.dashboard_outcomes.count('exists')}",
            "",
        ]
        for w in self.warnings:
            lines.append(f"Warning: {w}")
        if self.warnings:
            lines.append("")
        lines.append("| DataDesk id | Name | Kind | Result | Collection | Notes |")
        lines.append("|---|---|---|---|---|---|")
        for i in self.items:
            notes = "; ".join(i.notes).replace("|", "/")
            lines.append(f"| {i.source_id} | {i.name.replace('|', '/')} | {i.kind} | {i.outcome} | {i.collection} | {notes} |")
        return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- reading DataDesk

def _connect(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise ImportError_(f"No such file: {path}")
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def _tables(con: sqlite3.Connection) -> dict[str, str]:
    return {r[0].lower(): r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _pick(row: dict[str, Any], *names: str, default: Any = None) -> Any:
    for n in names:
        if n in row and row[n] not in (None, ""):
            return row[n]
    return default


def _json(value: Any) -> Any:
    if value is None or isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return value


def read_datadesk(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(reports, dashboards) as plain dicts; dashboards carry "report_ids" in order."""
    con = _connect(path)
    try:
        names = _tables(con)
        table = next((names[t] for t in ("reports", "report", "saved_reports") if t in names), None)
        if table is None:
            raise ImportError_(f"{path.name} has no reports table - is it a DataDesk app database? Tables: {', '.join(sorted(names.values()))}")
        reports = [{k.lower(): r[k] for k in r.keys()} for r in con.execute(f'SELECT * FROM "{table}"')]
        dashboards: list[dict[str, Any]] = []
        dtable = next((names[t] for t in ("dashboards", "dashboard") if t in names), None)
        if dtable:
            for r in con.execute(f'SELECT * FROM "{dtable}"'):
                d = {k.lower(): r[k] for k in r.keys()}
                ids = _json(_pick(d, "report_ids", "reportids", "reports", "items", "cards", "layout", default=[]))
                d["report_ids"] = _ids(ids)
                dashboards.append(d)
            link = next((names[t] for t in ("dashboard_reports", "dashboard_items", "dashboard_cards") if t in names), None)
            if link:
                cols = [c[1].lower() for c in con.execute(f'PRAGMA table_info("{link}")')]
                order = next((c for c in ("position", "sort_order", "order_index", "ord", "id") if c in cols), None)
                rows = con.execute(f'SELECT * FROM "{link}"' + (f' ORDER BY "{order}"' if order else "")).fetchall()
                by_dash: dict[Any, list[Any]] = {}
                for r in rows:
                    row = {k.lower(): r[k] for k in r.keys()}
                    by_dash.setdefault(row.get("dashboard_id"), []).append(row.get("report_id"))
                for d in dashboards:
                    if d.get("id") in by_dash:
                        d["report_ids"] = [i for i in by_dash[d["id"]] if i is not None]
        return reports, dashboards
    finally:
        con.close()


def _ids(value: Any) -> list[Any]:
    if isinstance(value, list):
        out = []
        for v in value:
            if isinstance(v, dict):
                v = _pick(v, "report_id", "reportId", "id")
            if v is not None:
                out.append(v)
        return out
    if isinstance(value, str):
        return [int(x) if x.strip().isdigit() else x.strip() for x in value.split(",") if x.strip()]
    return []


# ---------------------------------------------------------------- converting one report

def _ref(column: Any, table: str | None, base: str) -> str:
    if isinstance(column, dict):
        table = column.get("table") or table
        column = column.get("column") or column.get("name") or column.get("field")
    if not isinstance(column, str) or not column.strip():
        raise Unconvertible(f"a column reference is missing ({column!r})")
    column = column.strip().strip("`\"[]")
    if "." in column:
        return column
    return f"{table or base}.{column}"


def _key(word: Any) -> str:
    return re.sub(r"[\s_-]", "", str(word or "")).lower()


def _condition(node: dict[str, Any], base: str) -> dict[str, Any]:
    raw_op = _pick(node, "operator", "op", "comparison", default="=")
    op = OPERATORS.get(_key(raw_op)) or OPERATORS.get(str(raw_op).strip())
    if op is None:
        raise Unconvertible(f"filter operator {raw_op!r} is not known")
    out: dict[str, Any] = {"ref": _ref(_pick(node, "column", "field", "name"), node.get("table"), base), "op": op}
    value = node.get("value", node.get("values"))
    if op in ("in", "not_in") and isinstance(value, str):
        value = [v.strip() for v in value.split(",") if v.strip()]
    if op == "between" and not isinstance(value, list):
        value = [node.get("from", node.get("min")), node.get("to", node.get("max"))]
    if op not in ("is_null", "not_null", "is_empty", "not_empty", "is_true", "is_false"):
        out["value"] = value
    if op == "contains" and isinstance(value, str) and ("%" in value or "_" in value) and _key(raw_op) in ("like", "ilike"):
        # LIKE patterns: a leading/trailing % is what "contains" means; others are approximated
        stripped = value.strip("%")
        if "%" in stripped or "_" in stripped:
            raise Unconvertible(f"LIKE pattern {value!r} has wildcards inside; rebuild this filter by hand")
        out["value"] = stripped
        if value.endswith("%") and not value.startswith("%"):
            out["op"] = "starts_with"
        elif value.startswith("%") and not value.endswith("%"):
            out["op"] = "ends_with"
    return out


def _group(node: Any, base: str, depth: int = 0) -> dict[str, Any] | None:
    if node in (None, [], {}):
        return None
    if depth > 20:
        raise Unconvertible("filters are nested too deeply")
    if isinstance(node, list):
        node = {"logic": "and", "conditions": node}
    if not isinstance(node, dict):
        raise Unconvertible(f"unexpected filter shape {type(node).__name__}")
    children = _pick(node, "conditions", "rules", "children", "filters")
    if children is None:
        return {"op": "and", "rules": [_condition(node, base)]}
    logic = str(_pick(node, "logic", "operator", "op", "combinator", "type", default="and")).lower()
    rules = []
    for child in children:
        is_group = isinstance(child, list) or (isinstance(child, dict) and _pick(child, "conditions", "rules", "children", "filters") is not None)
        if is_group:
            inner = _group(child, base, depth + 1)
            if inner:
                rules.append(inner)
        else:
            rules.append(_condition(child, base))
    return {"op": "or" if logic == "or" else "and", "rules": rules} if rules else None


def convert_single(spec: dict[str, Any], connection: str) -> tuple[dict[str, Any], list[str]]:
    """A DataDesk single-source spec -> QuerySpec v1 (as JSON) and notes about what changed."""
    notes: list[str] = []
    base = _pick(spec, "from", "table", "source")
    if isinstance(base, dict):
        base = base.get("table")
    if not isinstance(base, str) or not base:
        raise Unconvertible("the report has no main table ('from')")
    out: dict[str, Any] = {"version": 1, "connection": connection, "source": {"table": base}}

    joins = []
    for j in spec.get("joins") or []:
        table = j.get("table") if isinstance(j, dict) else j
        if not table:
            raise Unconvertible("a join has no table")
        join: dict[str, Any] = {"table": table, "type": "left"}
        jtype = str(j.get("type", "left")).lower() if isinstance(j, dict) else "left"
        if jtype in ("inner", "left", "full"):
            join["type"] = jtype
        elif jtype == "right":
            notes.append(f"right join to {table} became a left join (swap the tables if rows are missing)")
        on = j.get("on") if isinstance(j, dict) else None
        if isinstance(on, dict):
            on = [on]
        if isinstance(j, dict) and not on and (j.get("leftColumn") or j.get("left_column")):
            on = [{"left": j.get("leftColumn") or j.get("left_column"), "right": j.get("rightColumn") or j.get("right_column")}]
        if on:
            join["on"] = [
                {"left": _ref(c.get("left") or c.get("from"), None, base), "right": _ref(c.get("right") or c.get("to"), table, table)}
                for c in on
            ]
        joins.append(join)
    if joins:
        out["joins"] = joins

    aggregations, plain = [], []
    for item in spec.get("select") or spec.get("columns") or []:
        if isinstance(item, str):
            if item.strip() == "*":
                continue
            plain.append({"ref": _ref(item, None, base)})
            continue
        fn = item.get("aggregate") or item.get("agg") or item.get("function")
        alias = item.get("alias") or item.get("as")
        if fn:
            mapped = AGGREGATES.get(_key(fn))
            if mapped is None:
                raise Unconvertible(f"aggregate {fn!r} is not known")
            col = _pick(item, "column", "field", "name")
            agg: dict[str, Any] = {"fn": mapped}
            if col and col != "*":
                agg["ref"] = _ref(item, None, base)
            elif mapped != "count":
                raise Unconvertible(f"{fn} needs a column")
            if alias:
                agg["alias"] = str(alias)[:64]
            aggregations.append(agg)
        else:
            if _pick(item, "column", "field", "name") == "*":
                continue
            field_: dict[str, Any] = {"ref": _ref(item, None, base)}
            if alias:
                field_["alias"] = str(alias)[:64]
            plain.append(field_)

    group_by = [_ref(g, None, base) for g in (spec.get("groupBy") or spec.get("group_by") or [])]
    if aggregations or group_by:
        breakouts: list[dict[str, Any]] = []
        for ref in group_by + [p["ref"] for p in plain]:
            if ref not in [b["ref"] for b in breakouts]:
                breakouts.append({"ref": ref})
        for p in plain:
            if p.get("alias"):
                next(b for b in breakouts if b["ref"] == p["ref"])["alias"] = p["alias"]
        if breakouts:
            out["breakouts"] = breakouts
        if aggregations:
            out["aggregations"] = aggregations
    elif plain:
        out["fields"] = plain

    filters = _group(spec.get("where") or spec.get("filters"), base)
    if filters:
        out["filters"] = filters
    having = _group(spec.get("having"), base)
    if having:
        out["having"] = having
        notes.append("check the 'having' filter: it now refers to output column names")

    order = []
    outputs = {a.get("alias") for a in out.get("aggregations", [])} | {b.get("alias") for b in out.get("breakouts", [])}
    for o in spec.get("orderBy") or spec.get("order_by") or spec.get("order") or []:
        col = o if isinstance(o, str) else _pick(o, "column", "field", "alias", "name")
        direction = "asc" if isinstance(o, str) else str(o.get("direction") or o.get("dir") or "asc").lower()
        if col in outputs:
            ref = col
        else:
            ref = _ref(col, o.get("table") if isinstance(o, dict) else None, base)
            if "aggregations" in out or "breakouts" in out:
                match = next((b for b in out.get("breakouts", []) if b["ref"] == ref), None)
                if match is None:
                    notes.append(f"sorting by {col} was dropped (not part of the summary)")
                    continue
                ref = match.get("alias") or ref.split(".")[-1]
        order.append({"ref": ref, "dir": "desc" if direction.startswith("desc") else "asc"})
    if order:
        out["order"] = order

    limit = spec.get("limit")
    if isinstance(limit, (int, float)) and limit > 0:
        out["limit"] = int(limit)
    try:
        QuerySpec.model_validate(out)
    except ValidationError as exc:
        raise Unconvertible(f"converted question is not valid: {exc.errors()[0]['msg']}") from exc
    return out, notes


def convert_multi(
    spec: dict[str, Any], connection_for: Any, connections: dict[str, str]
) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    """A DataDesk "multi" report -> FederatedSpec v1 (+ parameters, notes)."""
    raw = spec.get("sources") or []
    if not isinstance(raw, list) or not raw:
        raise Unconvertible("the multi-source report has no sources")
    if len(raw) > 6:
        raise Unconvertible("more than 6 sources (Ncode's limit)")
    notes: list[str] = []
    sources: list[dict[str, Any]] = []
    keys: list[str | None] = []
    params: list[dict[str, Any]] = []
    taken: set[str] = set()
    for i, s in enumerate(raw):
        if not isinstance(s, dict):
            raise Unconvertible(f"source {i + 1} is not an object")
        label = str(_pick(s, "label", "name", "alias", default=f"source {i + 1}"))[:120]
        alias = re.sub(r"[^a-z0-9_]+", "_", label.lower()).strip("_")[:28] or f"s{i + 1}"
        if alias[0].isdigit():
            alias = f"s_{alias}"[:28]
        base, n = alias, 2
        while alias in taken or alias in ("result", "main", "temp", "system"):
            alias = f"{base}_{n}"
            n += 1
        taken.add(alias)
        conn = connection_for(_pick(s, "database", "db", "connection") or spec.get("database"))
        sql = _pick(s, "sql", "query")
        if isinstance(sql, str) and sql.strip():
            try:
                checked = check_sql(sql, ENGINE_DIALECT.get(connections[conn], connections[conn]), allow_system=False)
            except GuardError as exc:
                raise Unconvertible(f"{label}: the SQL is refused by Ncode's read-only guard: {exc}") from exc
            params += [{"name": p} for p in checked.params if p not in {x["name"] for x in params}]
            sources.append({"alias": alias, "label": label, "type": "sql", "connection": conn, "sql": sql})
        else:
            inner = _pick(s, "spec", "query_spec", default=None)
            if not isinstance(inner, dict):
                raise Unconvertible(f"{label}: the source has neither SQL nor a query")
            converted, inner_notes = convert_single(inner, conn)
            notes += [f"{label}: {n}" for n in inner_notes]
            sources.append({"alias": alias, "label": label, "type": "builder", "spec": converted})
        key = _pick(s, "keyColumn", "key_column", "key", "joinKey", default=None)
        keys.append(str(key).split(".")[-1] if key else None)
    joins = []
    if len(sources) > 1:
        if not all(keys):
            raise Unconvertible("every source needs a key column to be joined")
        first = sources[0]["alias"]
        for s, key in zip(sources[1:], keys[1:]):
            joins.append({"source": s["alias"], "type": "full",
                          "on": [{"left": f"{first}.{keys[0]}", "right": f"{s['alias']}.{key}", "match": "auto"}]})
        notes.append("sources joined with FULL JOIN on their key columns; unlike DataDesk every row is kept, "
                     "so totals can differ where a key repeats")
    out = {"version": 1, "sources": sources, "mode": "join", "joins": joins}
    try:
        FederatedSpec.model_validate(out)
    except ValidationError as exc:
        raise Unconvertible(f"converted question is not valid: {exc.errors()[0]['msg']}") from exc
    return out, params, notes


def _placeholder(store: ContentStore, qid: int) -> bool:
    """A multi-source report imported before M6, kept as a placeholder spec."""
    with store.engine.connect() as conn:
        row = conn.execute(select(questions_table.c.kind, questions_table.c.spec).where(questions_table.c.id == qid)).first()
    if row is None or row.kind != "federated":
        return False
    try:
        return isinstance(json.loads(row.spec).get("datadesk"), dict)
    except (ValueError, AttributeError):
        return False


def convert_viz(chart_type: Any, config: Any) -> dict[str, Any] | None:
    chart = CHARTS.get(_key(chart_type))
    if chart is None or chart == "table":
        return {"mode": "table", "spec": None}
    config = _json(config) if config else {}
    config = config if isinstance(config, dict) else {}
    x = _pick(config, "xKey", "xAxis", "x", "category", "labelKey")
    ys = _pick(config, "yKeys", "yAxis", "y", "series", "valueKey", "value")
    if isinstance(ys, str):
        ys = [ys]
    ys = [y if isinstance(y, str) else _pick(y, "key", "column", "dataKey") for y in (ys or [])]
    ys = [y for y in ys if isinstance(y, str)]
    spec: dict[str, Any] = {"version": 1, "type": chart}
    if chart in ("bar", "line", "area", "scatter"):
        if x:
            spec["x"] = x
        if ys:
            spec["series"] = [{"y": y} for y in ys]
    elif chart == "pie":
        if x:
            spec["x"] = x
        if ys:
            spec["value"] = ys[0]
    elif chart == "kpi" and ys:
        spec["value"] = ys[0]
    return {"mode": "chart", "spec": spec}


# ---------------------------------------------------------------- the import

def parse_map(raw: str | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in (raw or "").split(","):
        if not part.strip():
            continue
        if "=" not in part:
            raise ImportError_(f"--map entries look like datadesk_db=ncode_connection, not {part!r}")
        k, v = part.split("=", 1)
        out[k.strip()] = v.strip().lower()
    return out


def run_import(
    path: Path,
    store: ContentStore,
    owner: User,
    *,
    mapping: dict[str, str],
    connections: dict[str, str],   # Ncode connection key -> engine
    dry_run: bool = True,
) -> ImportReport:
    reports, dashboards = read_datadesk(path)
    report = ImportReport(dry_run=dry_run)
    by_id = {r.get("id"): r for r in reports}

    def connection_for(db: Any) -> str:
        if db in (None, ""):
            if len(mapping) == 1:
                return next(iter(mapping.values()))
            raise Unconvertible("the report names no database and --map has more than one entry")
        key = mapping.get(str(db), str(db).lower())
        if key not in connections:
            raise Unconvertible(f"no Ncode connection for DataDesk database {db!r} (add it to --map)")
        return key

    # where each report goes: its first dashboard, else the loose collection
    home: dict[Any, str] = {}
    dashboard_store = DashboardStore(store)
    named: list[tuple[dict[str, Any], str]] = []
    for d in dashboards:
        name = str(_pick(d, "name", "title", default=f"Dashboard {d.get('id')}"))[:120]
        missing = [i for i in d["report_ids"] if i not in by_id]
        if missing:
            report.warnings.append(f"dashboard {name!r} refers to reports that do not exist: {missing}")
        report.dashboards.append((name, len(d["report_ids"])))
        exists = dashboard_store.by_import_key(f"datadesk:dashboard:{d.get('id')}") is not None
        report.dashboard_outcomes.append("exists" if exists else "new")
        named.append((d, name))
        for rid in d["report_ids"]:
            home.setdefault(rid, name)

    planned: list[tuple[Item, dict[str, Any]]] = []
    for r in reports:
        name = str(_pick(r, "name", "title", default=f"Report {r.get('id')}"))[:200]
        spec = _json(_pick(r, "spec_json", "spec", "query_spec", "query", default={}))
        kind = str(_pick(r, "kind", "type", "report_type", default="")).lower()
        if not kind:
            kind = "sql" if isinstance(spec, dict) and spec.get("sql") else "multi" if isinstance(spec, dict) and spec.get("sources") else "single"
        item = Item(source_id=r.get("id"), name=name, kind=kind, outcome="skipped", collection=home.get(r.get("id"), LOOSE_NAME))
        report.items.append(item)
        existing = store.question_by_import_key(f"datadesk:report:{r.get('id')}")
        if existing is not None and not _placeholder(store, existing):
            item.outcome = "exists"
            continue
        try:
            if not isinstance(spec, dict):
                if kind == "sql" and isinstance(spec, str):
                    spec = {"sql": spec}
                else:
                    raise Unconvertible("the report's spec is not JSON")
            db = _pick(r, "database", "db", "connection", default=None) or spec.get("database") or spec.get("db")
            viz = convert_viz(_pick(r, "chart_type", "chart", "visualization"), _pick(r, "chart_config", "chartconfig"))
            values: dict[str, Any] = {"name": name, "description": _pick(r, "description"), "viz": viz}
            if kind == "single":
                conn = connection_for(db)
                converted, notes = convert_single(spec, conn)
                item.notes += notes
                values.update(kind="builder", connection=conn, spec=converted)
            elif kind == "sql":
                conn = connection_for(db)
                sql = _pick(r, "sql") or spec.get("sql") or spec.get("query")
                if not isinstance(sql, str) or not sql.strip():
                    raise Unconvertible("the SQL report has no SQL text")
                try:
                    checked = check_sql(sql, ENGINE_DIALECT.get(connections[conn], connections[conn]), allow_system=False)
                except GuardError as exc:
                    raise Unconvertible(f"the SQL is refused by Ncode's read-only guard: {exc}") from exc
                values.update(kind="sql", connection=conn, spec={"sql": sql}, parameters=[{"name": p} for p in checked.params])
                if checked.params:
                    item.notes.append(f"parameters to review: {', '.join(checked.params)}")
            elif kind in ("multi", "federated", "cross", "crossdb"):
                if isinstance(spec.get("datadesk"), dict):  # a placeholder of an earlier import
                    spec = spec["datadesk"]
                converted, params, notes = convert_multi(spec, connection_for, connections)
                item.notes += notes
                values.update(kind="federated", connection="", spec=converted, parameters=params)
            else:
                raise Unconvertible(f"unknown report kind {kind!r}")
            item.outcome = values["kind"]
            if existing is not None:
                item.outcome = "upgraded"
                values["existing_id"] = existing
            planned.append((item, values))
        except Unconvertible as exc:
            item.notes.append(str(exc))

    if dry_run:
        return report

    root = _collection(store, owner, ROOT_NAME, None)
    folders: dict[str, int] = {}
    for item, values in planned:
        existing_id = values.pop("existing_id", None)
        if existing_id is not None:
            store.update_question(owner, existing_id, kind=values["kind"], connection=values["connection"],
                                  spec=values["spec"], parameters=values.get("parameters", []))
            continue
        if item.collection not in folders:
            folders[item.collection] = _collection(store, owner, item.collection, root)
        store.create_question(
            owner, collection_id=folders[item.collection], import_key=f"datadesk:report:{item.source_id}", **values
        )
    for (d, name), outcome in zip(named, report.dashboard_outcomes):
        if outcome == "exists":
            continue
        if name not in folders:
            folders[name] = _collection(store, owner, name, root)
        cards: list[Card] = []
        for rid in dict.fromkeys(d["report_ids"]):  # in order, without repeats
            qid = store.question_by_import_key(f"datadesk:report:{rid}")
            if qid is None:
                continue
            i = len(cards)
            cards.append(Card(key=f"r{i + 1}", kind="question", question_id=qid,
                              layout=Layout(x=(i % 2) * 6, y=(i // 2) * 8, w=6, h=8)))
        dashboard_store.create(owner, name=name, collection_id=folders[name], definition=Definition(cards=cards),
                               description="Imported from DataDesk", import_key=f"datadesk:dashboard:{d.get('id')}")
    return report


def _collection(store: ContentStore, owner: User, name: str, parent: int | None) -> int:
    """Reuse a collection of that name in that place (re-runs), or create it."""
    with store.engine.connect() as conn:
        stmt = select(collections_table.c.id).where(
            collections_table.c.name == name, collections_table.c.archived.is_(False),
            collections_table.c.personal_owner_id.is_(None),
            collections_table.c.parent_id.is_(None) if parent is None else collections_table.c.parent_id == parent,
        )
        found = conn.execute(stmt).scalar()
    if found is not None:
        return int(found)
    return store.create_collection(owner, name, "Imported from DataDesk" if parent is None else None, parent).id
