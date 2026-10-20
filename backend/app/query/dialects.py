"""SQL that differs between databases: date buckets, number bins, a few functions.

Constants inside these expressions are rendered as literals (literal_column), never
as bound parameters: the same expression appears in SELECT and GROUP BY, and
PostgreSQL rejects `GROUP BY date_trunc($1, x)` when $1 and the SELECT's $2 are
different parameters. Every literal here comes from a fixed list, not from users.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Date, DateTime, Float, Integer, Numeric, String, and_, case, cast, func, literal_column, null
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.expression import ColumnElement

MYSQL_FAMILY = ("mysql", "mariadb")
# DuckDB (multi-source questions, M6) speaks PostgreSQL's dialect for everything compiled here.
PG_FAMILY = ("postgresql", "duckdb")

# Which buckets give a date and which a date-time.
DATE_BUCKETS = ("day", "week", "month", "quarter", "year")
TIME_BUCKETS = ("minute", "hour")


class UnsupportedFeature(ValueError):
    """The question is valid but this database cannot run it (e.g. FULL JOIN on MySQL)."""


def _lit(sql: str) -> Any:
    return literal_column(sql)


class _MySQLInterval(ColumnElement):
    """MySQL's `INTERVAL <expr> <UNIT>` (not a function, so func.* cannot build it)."""

    inherit_cache = True

    def __init__(self, amount: Any, unit: str):
        self.amount = amount
        self.unit = unit


@compiles(_MySQLInterval)
def _compile_interval(element: _MySQLInterval, compiler: Any, **kw: Any) -> str:
    return f"INTERVAL {compiler.process(element.amount, **kw)} {element.unit}"


def date_bucket(expr: Any, unit: str, dialect: str) -> tuple[Any, str]:
    """(expression, result type) truncating a date/datetime to the start of its unit.

    Weeks start on Monday everywhere (ISO 8601).
    """
    out_type = "date" if unit in DATE_BUCKETS else "datetime"
    sa_type = Date() if out_type == "date" else DateTime()

    if dialect in PG_FAMILY:
        truncated = func.date_trunc(_lit(f"'{unit}'"), expr, type_=DateTime())
        return (cast(truncated, Date) if out_type == "date" else truncated), out_type

    if dialect in MYSQL_FAMILY:
        day = func.date(expr, type_=Date())
        one = _lit("1")
        if unit == "day":
            result = day
        elif unit == "week":
            result = func.date_sub(day, _MySQLInterval(func.weekday(expr), "DAY"), type_=Date())
        elif unit == "month":
            result = func.date_sub(day, _MySQLInterval(func.dayofmonth(expr) - one, "DAY"), type_=Date())
        elif unit == "quarter":
            result = func.date_add(
                func.makedate(func.year(expr), one), _MySQLInterval(func.quarter(expr) - one, "QUARTER"), type_=Date()
            )
        elif unit == "year":
            result = func.makedate(func.year(expr), one, type_=Date())
        elif unit == "hour":
            result = func.date_add(day, _MySQLInterval(func.hour(expr), "HOUR"), type_=DateTime())
        else:  # minute
            minutes = func.hour(expr) * _lit("60") + func.minute(expr)
            result = func.date_add(day, _MySQLInterval(minutes, "MINUTE"), type_=DateTime())
        return result, out_type

    if dialect == "mssql":
        zero, one = _lit("0"), _lit("1")
        if unit == "day":
            result = cast(expr, Date)
        elif unit == "week":
            # 0 is 1900-01-01, a Monday; DATEDIFF(week) counts Sunday boundaries, hence the -1 day.
            monday = func.dateadd(
                _lit("week"),
                func.datediff(_lit("week"), zero, func.dateadd(_lit("day"), _lit("-1"), expr)),
                zero,
            )
            result = cast(monday, Date)
        elif unit == "month":
            result = func.datefromparts(func.year(expr), func.month(expr), one, type_=Date())
        elif unit == "quarter":
            first_month = (func.datepart(_lit("quarter"), expr) - one) * _lit("3") + one
            result = func.datefromparts(func.year(expr), first_month, one, type_=Date())
        elif unit == "year":
            result = func.datefromparts(func.year(expr), one, one, type_=Date())
        else:  # hour / minute
            part = _lit(unit)
            result = func.dateadd(part, func.datediff(part, zero, expr), zero, type_=DateTime())
        return result, out_type

    if dialect == "sqlite":
        if unit == "day":
            result = func.date(expr, type_=sa_type)
        elif unit == "week":
            result = func.date(expr, _lit("'-6 days'"), _lit("'weekday 1'"), type_=sa_type)
        elif unit == "month":
            result = func.date(expr, _lit("'start of month'"), type_=sa_type)
        elif unit == "year":
            result = func.date(expr, _lit("'start of year'"), type_=sa_type)
        elif unit == "quarter":
            # .op("/") keeps SQLite's integer division (SQLAlchemy's "/" would make it true division)
            months = (cast(func.strftime(_lit("'%m'"), expr), Integer) - _lit("1")).self_group().op("/")(_lit("3")) * _lit("3")
            shift = _lit("'+'").op("||")(cast(months, String)).op("||")(_lit("' months'"))
            result = func.date(expr, _lit("'start of year'"), shift, type_=sa_type)
        elif unit == "hour":
            result = func.strftime(_lit("'%Y-%m-%d %H:00:00'"), expr, type_=sa_type)
        else:  # minute
            result = func.strftime(_lit("'%Y-%m-%d %H:%M:00'"), expr, type_=sa_type)
        return result, out_type

    raise UnsupportedFeature(f"Grouping by {unit} is not supported on {dialect}")


def number_bin(expr: Any, width: float, dialect: str) -> Any:
    """Lower edge of the bin a number falls into: floor(x / width) * width."""
    w = _lit(repr(float(width)))  # validated positive float: a safe literal
    ratio = expr / w
    if dialect == "sqlite":
        # SQLite's floor() needs a build option Python's sqlite3 may lack.
        whole = cast(ratio, Integer)
        floored = whole - (ratio < whole)
        return cast(floored, Float) * w
    return func.floor(ratio, type_=Float()) * w


def avg(expr: Any, dialect: str) -> Any:
    # SQL Server averages integers as integers (AVG(1,2) = 1); average as float there.
    if dialect == "mssql":
        return func.avg(cast(expr, Float), type_=Float())
    return func.avg(expr, type_=Numeric())


def round_(expr: Any, digits: int, dialect: str) -> Any:
    # PostgreSQL has round(numeric, int) but no round(double precision, int).
    if dialect == "postgresql":
        expr = cast(expr, Numeric)
    return func.round(expr, _lit(str(int(digits))), type_=Numeric())


def supports_full_join(dialect: str) -> bool:
    return dialect not in MYSQL_FAMILY


# ---------------------------------------------------------------- text that holds dates (M7)

# Patterns are fixed constants (never user input). Recognised, per value:
#   ISO      2026-01-31, 2026-01-31 08:15[:30], 2026-01-31T08:15:30
#   dotted   31.01.2026, 31.01.2026 08:15[:30]          (day first, as in MES/LES exports)
#   unix     1767225600 (seconds, 9-10 digits) or 1767225600000 (milliseconds, 12-13 digits)
# Anything else is NULL, so one odd value never breaks a question.
_ISO_RE = "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])([ T][0-2][0-9]:[0-5][0-9](:[0-5][0-9])?)?.*$"
_DOT_RE = "^(0[1-9]|[12][0-9]|3[01])\\.(0[1-9]|1[0-2])\\.[0-9]{4}( [0-2][0-9]:[0-5][0-9](:[0-5][0-9])?)?.*$"
_SEC_RE = "^[0-9]{9,10}$"
_MS_RE = "^[0-9]{12,13}$"
_ISO_LIKE = "[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]"
_DOT_LIKE = "[0-3][0-9].[01][0-9].[0-9][0-9][0-9][0-9]"


def _matches(text: Any, kind: str, dialect: str) -> Any:
    """`text` looks like an ISO / dotted date or a unix time (kind: iso, dot, sec, ms)."""
    if dialect in PG_FAMILY or dialect in MYSQL_FAMILY:
        pattern = {"iso": _ISO_RE, "dot": _DOT_RE, "sec": _SEC_RE, "ms": _MS_RE}[kind]
        op = "~" if dialect in PG_FAMILY else "REGEXP"
        return text.op(op)(_lit("'" + pattern.replace("\\", "\\\\" if dialect in MYSQL_FAMILY else "\\") + "'"))
    if kind in ("sec", "ms"):
        lo, hi = (9, 10) if kind == "sec" else (12, 13)
        length = func.len(text) if dialect == "mssql" else func.length(text)
        digits_only = text.op("NOT LIKE")(_lit("'%[^0-9]%'")) if dialect == "mssql" else text.op("NOT GLOB")(_lit("'*[^0-9]*'"))
        return and_(digits_only, length.between(_lit(str(lo)), _lit(str(hi))))
    pattern = _ISO_LIKE if kind == "iso" else _DOT_LIKE
    if dialect == "mssql":
        return text.op("LIKE")(_lit(f"'{pattern}%'"))
    if dialect == "sqlite":
        glob = pattern.replace(".", "[.]") if kind == "dot" else pattern
        return text.op("GLOB")(_lit(f"'{glob}*'"))
    raise UnsupportedFeature(f"Reading dates from text is not supported on {dialect}")


def _substr(text: Any, start: int, length: int, dialect: str) -> Any:
    name = "substring" if dialect == "mssql" else "substr"
    return getattr(func, name)(text, _lit(str(start)), _lit(str(length)), type_=String())


def _concat(parts: list[Any], dialect: str) -> Any:
    if dialect == "mssql":
        out = parts[0]
        for p in parts[1:]:
            out = out.op("+")(p)
        return out
    if dialect in MYSQL_FAMILY:
        return func.concat(*parts, type_=String())
    out = parts[0]
    for p in parts[1:]:
        out = out.op("||")(p)
    return out


def _iso_to_datetime(iso: Any, dialect: str) -> Any:
    """'YYYY-MM-DD[ HH:MM[:SS]]' -> a date-time; impossible dates (31.02.) give NULL where the database allows."""
    if dialect == "postgresql":
        return cast(iso, DateTime)  # PostgreSQL has no TRY_CAST: an impossible day (2026-02-31) is an error
    if dialect == "duckdb":
        return func.try_cast(iso.op("AS")(_lit("TIMESTAMP")), type_=DateTime())
    if dialect in MYSQL_FAMILY:
        return cast(iso, DateTime)  # NULL (with a warning) for impossible dates
    if dialect == "mssql":
        return func.try_convert(_lit("datetime2"), iso, _lit("120"), type_=DateTime())
    return func.datetime(iso, type_=DateTime())  # SQLite: NULL for impossible dates


def _unix_to_datetime(text: Any, millis: bool, dialect: str) -> Any:
    seconds = cast(text, Numeric(20, 0))
    if millis:
        seconds = func.floor(seconds / _lit("1000"))
    if dialect in PG_FAMILY:
        return cast(func.to_timestamp(seconds), DateTime) if dialect == "postgresql" else func.to_timestamp(seconds, type_=DateTime())
    if dialect in MYSQL_FAMILY:
        return func.from_unixtime(seconds, type_=DateTime())
    if dialect == "mssql":
        # DATEADD takes an int: add whole days, then the seconds of the last day
        days = func.floor(seconds / _lit("86400"))
        rest = seconds - days * _lit("86400")
        base = func.dateadd(_lit("day"), cast(days, Integer), _lit("CAST('1970-01-01' AS datetime2)"))
        return func.dateadd(_lit("second"), cast(rest, Integer), base, type_=DateTime())
    return func.datetime(seconds, _lit("'unixepoch'"), type_=DateTime())


def parse_text_date(expr: Any, dialect: str) -> Any:
    """A text column holding dates in mixed formats (DataDesk's normaliser, per value) as a date-time."""
    from .compiler import _as_text  # avoids an import cycle

    text = func.trim(_as_text(expr), type_=String())
    iso = _substr(text, 1, 19, dialect)
    if dialect != "duckdb":
        iso = func.replace(iso, _lit("'T'"), _lit("' '"), type_=String())
    else:
        iso = func.replace(iso, _lit("'T'"), _lit("' '"))
    dotted = _concat(
        [_substr(text, 7, 4, dialect), _lit("'-'"), _substr(text, 4, 2, dialect), _lit("'-'"), _substr(text, 1, 2, dialect),
         _substr(text, 11, 9, dialect)],
        dialect,
    )
    parsed = case(
        (_matches(text, "iso", dialect), _iso_to_datetime(iso, dialect)),
        (_matches(text, "dot", dialect), _iso_to_datetime(func.rtrim(dotted, type_=String()), dialect)),
        (_matches(text, "sec", dialect), _unix_to_datetime(text, False, dialect)),
        (_matches(text, "ms", dialect), _unix_to_datetime(text, True, dialect)),
        else_=null(),
    )
    if dialect == "sqlite":
        # SQLite keeps date-times as text; SQLAlchemy binds them with microseconds, so the
        # parsed text needs them too for >= and = to compare correctly.
        return parsed.op("||")(_lit("'.000000'"))
    return parsed
