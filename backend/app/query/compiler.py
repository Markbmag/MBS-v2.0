"""QuerySpec -> SQLAlchemy Select.

Safety comes from construction, not from inspecting SQL text afterwards:
- every table and column name is looked up in the reflected schema (a whitelist);
  SQLAlchemy quotes it for the target database;
- every value typed by a user is a bound parameter (or, inside custom expressions,
  an inline literal escaped by the database dialect - see _literal);
- operators are checked against the column type, so `contains` on a number or
  `sum` of a text column fail with a clear message instead of a database error.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any, Iterable

from sqlalchemy import (
    Boolean, Date, DateTime, Integer, Numeric, String, and_, case, column, distinct, false, func, literal,
    literal_column, not_, null, or_, select, table as sa_table, true, type_coerce,
)
from sqlalchemy import types as sqltypes
from sqlalchemy.engine import Dialect
from sqlalchemy.sql.expression import Select

from ..schema_graph import Relationship, find_join_path, normalize_type
from ..search import LIKE_ESCAPE, escape_like
from . import dialects
from .spec import Aggregation, Breakout, Condition, Expr, FilterGroup, QuerySpec, RelativeDate

MAX_EXPR_DEPTH = 12
MAX_IN_VALUES = 1000

# What each operator accepts. "unknown" columns (exotic types) are let through.
_TEXT_OPS = {"contains", "not_contains", "starts_with", "ends_with", "is_empty", "not_empty"}
_ORDERED_OPS = {">", ">=", "<", "<=", "between"}
_ORDERED_TYPES = {"number", "date", "datetime", "time", "string", "unknown"}
_DATE_TYPES = {"date", "datetime", "unknown"}


class CompileError(ValueError):
    """The question cannot be built as asked; the message is shown to the user."""


@dataclass
class OutputColumn:
    name: str
    type: str  # normalised, see schema_graph.TYPES
    source: tuple[str, str] | None = None  # (table, column) whose metadata (format, display name) applies


@dataclass
class Compiled:
    statement: Select          # without LIMIT; the runner adds limit + 1 to detect truncation
    columns: list[OutputColumn]
    limit: int
    meta: list[Any] = field(default_factory=list)  # data-model metadata per column (set by the API)

    def limited(self, extra: int = 0) -> Select:
        return self.statement.limit(self.limit + extra)


@dataclass
class _Typed:
    expr: Any
    type: str
    source: tuple[str, str] | None = None  # a plain table column (not an expression)


@dataclass
class _Table:
    alias: str
    name: str
    clause: Any
    columns: dict[str, Any] = field(default_factory=dict)  # real column name -> reflected type


def _typed_type(type_name: str) -> sqltypes.TypeEngine:
    return {
        "number": Numeric(), "string": String(), "boolean": Boolean(), "date": Date(), "datetime": DateTime(),
    }.get(type_name, sqltypes.NullType())


def _now() -> dt.datetime:
    return dt.datetime.now().replace(microsecond=0)


class SpecCompiler:
    def __init__(
        self,
        spec: QuerySpec,
        *,
        dialect: Dialect | str,
        tables: dict[str, list[dict[str, Any]]],
        relationships: list[Relationship],
        db_schema: str | None = None,
        default_limit: int = 2000,
        max_limit: int = 10_000,
        now: dt.datetime | None = None,
        fields: dict[str, dict[str, dict[str, Any]]] | None = None,
    ):
        self.spec = spec
        self.dialect = dialect if isinstance(dialect, str) else dialect.name
        self.schema_tables = tables
        self.relationships = relationships
        self.db_schema = db_schema
        self.default_limit = default_limit
        self.max_limit = max_limit
        self.now = now or _now()
        # semantic layer (M7): {table: {column: {"parse_as_date": bool, "hidden": bool}}}
        self.fields = fields or {}
        self.tables: dict[str, _Table] = {}          # alias -> table in the query
        self.custom: dict[str, _Typed] = {}          # custom expression name -> compiled
        self.outputs: dict[str, _Typed] = {}         # output name -> underlying (unlabelled) expression

    # ------------------------------------------------------------------ names
    def _real_table(self, name: str) -> str:
        if name in self.schema_tables:
            return name
        matches = [t for t in self.schema_tables if t.lower() == name.lower()]
        if len(matches) == 1:
            return matches[0]
        raise CompileError(f"Unknown table {name!r}")

    def _add_table(self, name: str, alias: str | None) -> _Table:
        real = self._real_table(name)
        alias = alias or real
        if alias in self.tables:
            raise CompileError(f"The table {alias!r} is already in the question; give the join an alias")
        cols = {c["name"]: c["type"] for c in self.schema_tables[real]}
        clause = sa_table(real, *[column(n, t) for n, t in cols.items()], schema=self.db_schema)
        if alias != real:
            clause = clause.alias(alias)
        entry = _Table(alias, real, clause, cols)
        self.tables[alias] = entry
        return entry

    def _column(self, tbl: _Table, name: str) -> _Typed | None:
        real = name if name in tbl.columns else next((c for c in tbl.columns if c.lower() == name.lower()), None)
        if real is None:
            return None
        expr = tbl.clause.c[real]
        if self.fields.get(tbl.name, {}).get(real, {}).get("parse_as_date"):
            # text holding dates (several formats): a real date-time for filters and "by month"
            try:
                return _Typed(dialects.parse_text_date(expr, self.dialect), "datetime", (tbl.name, real))
            except dialects.UnsupportedFeature as exc:
                raise CompileError(str(exc)) from None
        return _Typed(expr, normalize_type(tbl.columns[real]), (tbl.name, real))

    def _resolve_column(self, ref: str) -> _Typed | None:
        # "alias.column" - try the longest matching alias first ("a.b" table names exist).
        for alias in sorted(self.tables, key=len, reverse=True):
            for prefix in (alias, alias.lower()):
                if ref.startswith(prefix + ".") or ref.lower().startswith(prefix.lower() + "."):
                    found = self._column(self.tables[alias], ref[len(alias) + 1 :])
                    if found is not None:
                        return found
        # bare column name, if exactly one table in the query has it
        hits = [c for c in (self._column(t, ref) for t in self.tables.values()) if c is not None]
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            raise CompileError(f"{ref!r} exists in several tables; write it as table.column")
        return None

    def _resolve(self, ref: str, *, outputs: bool = False) -> _Typed:
        if outputs and ref in self.outputs:
            return self.outputs[ref]
        if ref in self.custom:
            return self.custom[ref]
        found = self._resolve_column(ref)
        if found is None:
            raise CompileError(f"Unknown column {ref!r}")
        return found

    # ------------------------------------------------------------------ expressions
    def _literal(self, value: Any) -> _Typed:
        """A constant inside a custom expression.

        Rendered inline by the dialect's own literal escaping (literal_execute) instead
        of as a parameter, so that the expression is textually identical in SELECT and
        GROUP BY (PostgreSQL compares parameter numbers, not values).
        """
        if value is None:
            return _Typed(null(), "unknown")
        if isinstance(value, bool):
            return _Typed(true() if value else false(), "boolean")
        if isinstance(value, (int, float)):
            return _Typed(literal_column(repr(value)), "number")
        return _Typed(literal(value, String(), literal_execute=True), "string")

    def _expr(self, e: Expr, depth: int = 0, *, outputs: bool = False) -> _Typed:
        if depth > MAX_EXPR_DEPTH:
            raise CompileError("The expression is nested too deeply")
        if e.ref is not None:
            return self._resolve(e.ref, outputs=outputs)
        if "value" in e.model_fields_set and e.op is None and e.fn is None and e.case is None:
            return self._literal(e.value)
        args = [self._expr(a, depth + 1, outputs=outputs) for a in e.args]
        if e.op is not None:
            left, right = args
            for side in (left, right):
                if side.type not in ("number", "unknown"):
                    raise CompileError(f"'{e.op}' works on numbers, not on {side.type}")
            a, b = _numeric(left.expr), _numeric(right.expr)
            if e.op == "+":
                return _Typed(a + b, "number")
            if e.op == "-":
                return _Typed(a - b, "number")
            if e.op == "*":
                return _Typed(a * b, "number")
            # division by zero gives NULL instead of an error (PostgreSQL / SQL Server raise)
            return _Typed(a / func.nullif(b, literal_column("0"), type_=b.type), "number")
        if e.fn is not None:
            return self._function(e.fn, args, e.digits)
        assert e.case is not None
        whens = [(self._condition_tree(w.when, depth + 1, outputs=outputs), self._expr(w.then, depth + 1, outputs=outputs)) for w in e.case]
        otherwise = self._expr(e.else_, depth + 1, outputs=outputs) if e.else_ is not None else None
        result_type = next((t.type for _, t in whens if t.type != "unknown"), otherwise.type if otherwise else "unknown")
        expr = case(*[(cond, then.expr) for cond, then in whens], else_=otherwise.expr if otherwise else None)
        return _Typed(expr, result_type)

    def _function(self, fn: str, args: list[_Typed], digits: int | None) -> _Typed:
        first = args[0]
        if fn == "coalesce":
            kind = next((a.type for a in args if a.type != "unknown"), "unknown")
            return _Typed(func.coalesce(*[a.expr for a in args], type_=_typed_type(kind)), kind)
        if fn == "nullif":
            if len(args) != 2:
                raise CompileError("nullif() needs exactly 2 args")
            return _Typed(func.nullif(args[0].expr, args[1].expr, type_=_typed_type(first.type)), first.type)
        if fn in ("lower", "upper", "trim"):
            return _Typed(getattr(func, fn)(first.expr, type_=String()), "string")
        if fn == "length":
            # SQL Server calls it LEN
            name = "len" if self.dialect == "mssql" else "length"
            return _Typed(getattr(func, name)(first.expr, type_=Integer()), "number")
        if fn == "abs":
            return _Typed(func.abs(_numeric(first.expr), type_=first.expr.type), "number")
        if fn == "round":
            return _Typed(dialects.round_(_numeric(first.expr), digits or 0, self.dialect), "number")
        if fn == "concat":
            # String "+" compiles to ||, CONCAT() or + depending on the database.
            parts = [_as_text(a.expr) for a in args]
            out = parts[0]
            for part in parts[1:]:
                out = out + part
            return _Typed(out, "string")
        raise CompileError(f"Unknown function {fn!r}")

    # ------------------------------------------------------------------ filters
    def _condition_tree(self, node: FilterGroup | Condition, depth: int = 0, *, outputs: bool = False) -> Any:
        if depth > MAX_EXPR_DEPTH:
            raise CompileError("The filter is nested too deeply")
        if isinstance(node, Condition):
            return self._condition(node, outputs=outputs)
        parts = [self._condition_tree(r, depth + 1, outputs=outputs) for r in node.rules]
        if not parts:
            return true()
        return and_(*parts) if node.op == "and" else or_(*parts)

    def _condition(self, c: Condition, *, outputs: bool) -> Any:
        target = self._resolve(c.ref, outputs=outputs) if c.ref is not None else self._expr(c.expr, outputs=outputs)
        x, kind, op, label = target.expr, target.type, c.op, c.ref or "the expression"

        def need(types: Iterable[str], what: str) -> None:
            if kind not in set(types) | {"unknown"}:
                raise CompileError(f"'{op}' needs {what}; {label} is {kind}")

        if op == "is_null":
            return x.is_(None)
        if op == "not_null":
            return x.is_not(None)
        if op in ("is_true", "is_false"):
            need({"boolean", "number"}, "a yes/no column")
            return x == (op == "is_true")
        if op in _TEXT_OPS:
            need({"string"}, "a text column")
            if op == "is_empty":
                return or_(x.is_(None), x == "")
            if op == "not_empty":
                return and_(x.is_not(None), x != "")
            text = self._value(c.value, "string", label)
            pattern = escape_like(text)
            pattern = {
                "contains": f"%{pattern}%", "not_contains": f"%{pattern}%",
                "starts_with": f"{pattern}%", "ends_with": f"%{pattern}",
            }[op]
            match = x.like(pattern, escape=LIKE_ESCAPE) if c.case_sensitive else x.ilike(pattern, escape=LIKE_ESCAPE)
            return or_(not_(match), x.is_(None)) if op == "not_contains" else match
        if op in ("last", "current"):
            need(_DATE_TYPES, "a date column")
            start, end = self._relative_range(c.value, op)
            if kind == "date":
                start, end = start.date(), end.date()
            return and_(x >= start, x < end)
        if op in ("in", "not_in"):
            if kind in ("json", "binary"):
                raise CompileError(f"'{op}' does not work on {kind} columns")
            values = c.value if isinstance(c.value, list) else [c.value]
            if not values or len(values) > MAX_IN_VALUES:
                raise CompileError(f"'{op}' needs between 1 and {MAX_IN_VALUES} values")
            values = [self._value(v, kind, label) for v in values]
            if op == "in":
                return x.in_(values)
            return or_(x.not_in(values), x.is_(None))
        if op == "between":
            need(_ORDERED_TYPES, "a number, date or text column")
            if not isinstance(c.value, list) or len(c.value) != 2:
                raise CompileError("'between' needs two values: [from, to]")
            low, high = (self._value(v, kind, label) for v in c.value)
            return x.between(low, high)
        if op in _ORDERED_OPS:
            need(_ORDERED_TYPES, "a number, date or text column")
        elif kind in ("json", "binary"):
            raise CompileError(f"'{op}' does not work on {kind} columns")
        value = self._value(c.value, kind, label)
        if op == "=":
            return x == value
        if op == "!=":
            # "is not X" should keep rows where the column is empty, as people expect.
            return or_(x != value, x.is_(None))
        return {">": x > value, ">=": x >= value, "<": x < value, "<=": x <= value}[op]

    def _value(self, value: Any, kind: str, label: str) -> Any:
        """Check and convert a filter value for a column of this type (bound as a parameter)."""
        if value is None:
            raise CompileError(f"A value is required for {label}")
        if isinstance(value, (list, dict)):
            raise CompileError(f"Expected a single value for {label}")
        try:
            if kind == "number":
                if isinstance(value, bool):
                    return int(value)
                if isinstance(value, (int, float)):
                    return value
                text = str(value).strip().replace(",", ".")
                return int(text) if text.lstrip("+-").isdigit() else float(text)
            if kind == "date":
                return dt.date.fromisoformat(str(value)[:10])
            if kind == "datetime":
                text = str(value).strip()
                return dt.datetime.fromisoformat(text) if len(text) > 10 else dt.datetime.fromisoformat(text[:10])
            if kind == "boolean":
                if isinstance(value, bool):
                    return value
                return str(value).strip().lower() in ("1", "true", "yes")
        except ValueError:
            raise CompileError(f"{value!r} is not a valid {kind} for {label}") from None
        text = str(value)
        if len(text) > 500:
            raise CompileError("Filter values are limited to 500 characters")
        return text

    def _relative_range(self, raw: Any, op: str) -> tuple[dt.datetime, dt.datetime]:
        try:
            rel = RelativeDate.model_validate(raw if isinstance(raw, dict) else {})
        except Exception:
            raise CompileError(f"'{op}' needs a value like {{\"amount\": 30, \"unit\": \"day\"}}") from None
        start_of_unit = _start_of(self.now, rel.unit)
        if op == "current":
            return start_of_unit, _shift(start_of_unit, rel.unit, 1)
        end = _shift(start_of_unit, rel.unit, 1) if rel.include_current else start_of_unit
        return _shift(start_of_unit, rel.unit, -rel.amount), end

    # ------------------------------------------------------------------ main
    def compile(self) -> Compiled:
        spec = self.spec
        source = self._add_table(spec.source.table, spec.source.alias)
        joined = source.clause
        for join in spec.joins:
            joined = self._join(joined, join)

        for custom in spec.expressions:
            if custom.name in self.custom:
                raise CompileError(f"Duplicate custom column {custom.name!r}")
            self.custom[custom.name] = self._expr(custom.expr)

        names: list[str] = []
        selected: list[Any] = []
        columns: list[OutputColumn] = []

        def add_output(name: str, typed: _Typed) -> None:
            unique = _unique(name, names)
            names.append(unique)
            selected.append(typed.expr.label(unique))
            columns.append(OutputColumn(unique, typed.type, typed.source))
            self.outputs[unique] = typed

        group_by: list[Any] = []
        grouped = bool(spec.aggregations or spec.breakouts)
        if grouped:
            for b in spec.breakouts:
                typed, default_name = self._breakout(b)
                add_output(b.alias or default_name, typed)
                group_by.append(typed.expr)
            for a in spec.aggregations:
                typed, default_name = self._aggregation(a)
                add_output(a.alias or default_name, typed)
        elif spec.fields:
            for f in spec.fields:
                typed = self._resolve(f.ref) if f.ref is not None else self._expr(f.expr)
                default_name = (f.ref or "expression").split(".")[-1] if f.ref not in self.custom else f.ref
                add_output(f.alias or default_name, typed)
        else:  # every column (except binary blobs) of every table in the query
            for tbl in self.tables.values():
                hidden = {c for c, info in self.fields.get(tbl.name, {}).items() if info.get("hidden")}
                for col_name in tbl.columns:
                    if col_name in hidden:
                        continue  # hidden in the data model: still usable by name, not shown by default
                    typed = self._column(tbl, col_name)
                    if typed is not None and typed.type != "binary":
                        add_output(col_name, typed)
            for name, typed in self.custom.items():
                add_output(name, typed)

        stmt = select(*selected).select_from(joined)
        if spec.filters is not None and spec.filters.rules:
            stmt = stmt.where(self._condition_tree(spec.filters))
        if group_by:
            stmt = stmt.group_by(*group_by)
        if spec.having is not None and spec.having.rules:
            stmt = stmt.having(self._condition_tree(spec.having, outputs=True))

        order = []
        for o in spec.order:
            if o.ref in self.outputs:
                target = literal_column(_quoted(o.ref, self.dialect))  # ORDER BY the output alias
            elif grouped:
                raise CompileError(f"Sort a summarised question by one of its columns: {', '.join(names)}")
            else:
                target = self._resolve(o.ref).expr
            order.append(target.desc() if o.dir == "desc" else target.asc())
        if not order and spec.breakouts:
            # Charts want time/categories in order.
            order = [literal_column(_quoted(n, self.dialect)).asc() for n in names[: len(spec.breakouts)]]
        if order:
            stmt = stmt.order_by(*order)

        limit = min(spec.limit or self.default_limit, self.max_limit)
        return Compiled(stmt, columns, limit)

    def _join(self, joined: Any, join: Any) -> Any:
        if join.type == "full" and not dialects.supports_full_join(self.dialect):
            raise CompileError("FULL JOIN is not supported by MySQL / MariaDB; use a left join")
        isouter, full = join.type in ("left", "full"), join.type == "full"

        if join.on:
            target = self._add_table(join.table, join.alias)
            conditions = []
            for pair in join.on:
                left = self._resolve_column_in(pair.left, exclude=target.alias)
                right = self._column(target, _strip_prefix(pair.right, (target.alias, target.name)))
                if left is None or right is None:
                    raise CompileError(f"Unknown join column in {pair.left} = {pair.right}")
                conditions.append(left.expr == right.expr)
            return joined.join(target.clause, and_(*conditions), isouter=isouter, full=full)

        # No condition given: follow foreign keys, adding tables in between if needed.
        real_target = self._real_table(join.table)
        if any(t.name == real_target for t in self.tables.values()):
            raise CompileError(
                f"{real_target!r} is already in the question; to join it again give an alias and the join condition"
            )
        best = None
        for alias, tbl in self.tables.items():
            path = find_join_path(self.relationships, tbl.name, real_target)
            if path and (best is None or len(path) < len(best[1])):
                best = (alias, path)
        if best is None:
            raise CompileError(
                f"No relationship (foreign key) connects {real_target!r} to the tables in this question; "
                "give the join condition yourself"
            )
        start_alias, path = best
        aliases_by_name = {self.tables[start_alias].name: start_alias}
        for i, step in enumerate(path):
            last = i == len(path) - 1
            if last:
                target = self._add_table(step.table, join.alias)
            else:
                existing = next((a for a, t in self.tables.items() if t.name == step.table), None)
                if existing is not None:
                    aliases_by_name[step.table] = existing
                    continue
                target = self._add_table(step.table, None)
            aliases_by_name[step.table] = target.alias
            conditions = []
            for left_ref, right_ref in step.on:
                lt, lc = left_ref.split(".", 1)
                _rt, rc = right_ref.split(".", 1)
                left = self._column(self.tables[aliases_by_name[lt]], lc)
                right = self._column(target, rc)
                assert left is not None and right is not None
                conditions.append(left.expr == right.expr)
            joined = joined.join(target.clause, and_(*conditions), isouter=isouter, full=full)
        return joined

    def _resolve_column_in(self, ref: str, exclude: str) -> _Typed | None:
        saved = self.tables.pop(exclude)
        try:
            return self._resolve_column(ref)
        finally:
            self.tables[exclude] = saved

    def _breakout(self, b: Breakout) -> tuple[_Typed, str]:
        typed = self._resolve(b.ref) if b.ref is not None else self._expr(b.expr)
        base = (b.ref or "group").split(".")[-1]
        if b.bucket is not None:
            if typed.type not in ("date", "datetime", "unknown"):
                raise CompileError(f"Grouping by {b.bucket} needs a date column; {b.ref} is {typed.type}")
            try:
                expr, out_type = dialects.date_bucket(typed.expr, b.bucket, self.dialect)
            except dialects.UnsupportedFeature as exc:
                raise CompileError(str(exc)) from None
            return _Typed(expr, out_type), f"{base}_{b.bucket}"  # no source: a month is not the column's format
        if b.bin_width is not None:
            if typed.type not in ("number", "unknown"):
                raise CompileError(f"Binning needs a number column; {b.ref} is {typed.type}")
            return _Typed(dialects.number_bin(_numeric(typed.expr), b.bin_width, self.dialect), "number"), f"{base}_bin"
        if typed.type in ("json", "binary"):
            raise CompileError(f"Cannot group by a {typed.type} column ({b.ref})")
        return typed, base

    def _aggregation(self, a: Aggregation) -> tuple[_Typed, str]:
        if a.fn == "metric":
            raise CompileError(f"Metric {a.metric} is not available")  # expanded by the API before compiling
        condition = self._condition_tree(a.where) if a.where is not None and a.where.rules else None
        if a.ref is None and a.expr is None:
            if condition is not None:  # count of the matching rows
                return _Typed(func.count(case((condition, literal_column("1")))), "number"), "count"
            return _Typed(func.count(), "number"), "count"
        typed = self._resolve(a.ref) if a.ref is not None else self._expr(a.expr)
        if condition is not None:
            typed = _Typed(case((condition, typed.expr)), typed.type, typed.source)
        base = (a.ref or "expression").split(".")[-1]
        if a.fn in ("sum", "avg") and typed.type not in ("number", "unknown"):
            raise CompileError(f"{a.fn} needs a number column; {a.ref or 'the expression'} is {typed.type}")
        if a.fn in ("min", "max") and typed.type in ("json", "binary", "boolean"):
            raise CompileError(f"{a.fn} does not work on {typed.type} columns")
        x = typed.expr
        if a.fn == "count":
            return _Typed(func.count(x), "number"), f"count_{base}"
        if a.fn == "count_distinct":
            return _Typed(func.count(distinct(x)), "number"), f"distinct_{base}"
        # sum / avg / min / max keep the column's format (a sum of euros is euros)
        if a.fn == "sum":
            return _Typed(func.sum(_numeric(x)), "number", typed.source), f"sum_{base}"
        if a.fn == "avg":
            return _Typed(dialects.avg(_numeric(x), self.dialect), "number", typed.source), f"avg_{base}"
        return _Typed(getattr(func, a.fn)(x, type_=getattr(x, "type", None)), typed.type, typed.source), f"{a.fn}_{base}"


# ---------------------------------------------------------------------- helpers

def _numeric(expr: Any) -> Any:
    """Give untyped expressions a numeric type so '/' is real division (SQLAlchemy 2)."""
    if isinstance(getattr(expr, "type", None), (sqltypes.Integer, sqltypes.Numeric, sqltypes.Float)):
        return expr
    return type_coerce(expr, Numeric())  # typing only, no CAST in the SQL


def _as_text(expr: Any) -> Any:
    from sqlalchemy import cast

    if isinstance(getattr(expr, "type", None), sqltypes.String):
        return expr
    return cast(expr, String())


def _strip_prefix(ref: str, prefixes: tuple[str, ...]) -> str:
    for prefix in prefixes:
        if ref.lower().startswith(prefix.lower() + "."):
            return ref[len(prefix) + 1 :]
    return ref


def _unique(name: str, taken: list[str]) -> str:
    if name not in taken:
        return name
    n = 2
    while f"{name}_{n}" in taken:
        n += 1
    return f"{name}_{n}"


def _quoted(name: str, dialect: str) -> str:
    """Quote an output alias (our own label, already unique) for ORDER BY."""
    if dialect in dialects.MYSQL_FAMILY:
        return "`" + name.replace("`", "``") + "`"
    if dialect == "mssql":
        return "[" + name.replace("]", "]]") + "]"
    return '"' + name.replace('"', '""') + '"'


def _start_of(now: dt.datetime, unit: str) -> dt.datetime:
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if unit == "day":
        return day
    if unit == "week":
        return day - dt.timedelta(days=day.weekday())
    if unit == "month":
        return day.replace(day=1)
    if unit == "quarter":
        return day.replace(day=1, month=(day.month - 1) // 3 * 3 + 1)
    return day.replace(day=1, month=1)


def _shift(start: dt.datetime, unit: str, amount: int) -> dt.datetime:
    if unit == "day":
        return start + dt.timedelta(days=amount)
    if unit == "week":
        return start + dt.timedelta(weeks=amount)
    months = {"month": 1, "quarter": 3, "year": 12}[unit] * amount
    index = start.year * 12 + start.month - 1 + months
    return start.replace(year=index // 12, month=index % 12 + 1)


def compile_spec(spec: QuerySpec, **kwargs: Any) -> Compiled:
    return SpecCompiler(spec, **kwargs).compile()


def render_sql(statement: Any, dialect: Dialect) -> str:
    """SQL text for people to read ("View SQL"), with values inlined.

    Display only: execution always uses bound parameters.
    """
    try:
        text = str(statement.compile(dialect=dialect, compile_kwargs={"literal_binds": True}))
    except Exception:  # a value type the dialect cannot inline: show the placeholders
        return str(statement.compile(dialect=dialect))
    if dialect.paramstyle in ("format", "pyformat"):
        text = text.replace("%%", "%")  # no placeholders left, so every %% is an escaped %
    return text
