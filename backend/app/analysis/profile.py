"""Column profiles (roadmap M7): what is in a table or a result, column by column.

For every column: rows, empty values, distinct values; numbers get min / max / mean /
median / standard deviation / percentiles, a histogram and an outlier count (1.5 x IQR);
dates their range and a histogram by day / week / month / year; text its lengths, the
most common values and how many values look like dates (a hint to switch on "parse as
date" in the data model). Numeric columns also get a correlation matrix.

Everything is computed in DuckDB over rows that were already read, never on the source
database: a table profile reads a sample first (the cost guard), a result profile uses
the rows on screen.
"""

from __future__ import annotations

import datetime as dt
import math
from typing import Any, Sequence

from ..federation.workspace import Workspace, ncode_type, quote
from ..serialize import serialize_value

TOP_VALUES = 10
HIST_BINS = 20
MAX_CORRELATED = 12
_ISO = "^[0-9]{4}-[0-9]{2}-[0-9]{2}"
_DOT = "^[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}"
_UNIX = "^[0-9]{9,10}$|^[0-9]{12,13}$"
_ID_NAME = ("id", "_id", "_no", "_nr", "code", "key", "uuid")


def _f(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, float):
        return None if math.isnan(v) or math.isinf(v) else round(v, 10)
    if isinstance(v, (int, bool, str)):
        return v
    return serialize_value(v)


def load_typed(ws: Workspace, table: str, names: Sequence[str], types: Sequence[str], rows: Sequence[Sequence[Any]]) -> list[str]:
    """Load rows; columns known to hold dates but read as text (a result envelope) become dates again."""
    cols = ws.load_rows(table, names, rows)
    loaded = dict(ws.columns(table))
    for name, type_ in zip(cols, types):
        if type_ in ("date", "datetime") and loaded.get(name) == "VARCHAR":
            target = "DATE" if type_ == "date" else "TIMESTAMP"
            ws.execute(f"ALTER TABLE {quote(table)} ALTER {quote(name)} TYPE {target} USING TRY_CAST({quote(name)} AS {target})")
    return cols


def profile_table(ws: Workspace, table: str, *, total_rows: int | None = None, meta: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    meta = meta or {}
    rows = ws.count(table)
    columns = []
    numeric: list[str] = []
    for name, duck_type in ws.columns(table):
        kind = ncode_type(duck_type)
        col = _profile_column(ws, table, name, kind, rows)
        info = meta.get(name) or {}
        col.update({k: info.get(k) for k in ("display_name", "description", "semantic_type", "hidden") if info.get(k) is not None})
        columns.append(col)
        if kind == "number" and col["distinct"] > 1 and not _id_like(name):
            numeric.append(name)
    return {
        "rows_profiled": rows,
        "total_rows": total_rows,
        "sampled": total_rows is not None and total_rows > rows,
        "columns": columns,
        "correlations": _correlations(ws, table, numeric[:MAX_CORRELATED]),
    }


def _id_like(name: str) -> bool:
    low = name.lower()
    return low == "id" or low.endswith(_ID_NAME)


def _profile_column(ws: Workspace, table: str, name: str, kind: str, rows: int) -> dict[str, Any]:
    t, c = quote(table), quote(name)
    non_null, distinct = ws.execute(f"SELECT count({c}), count(DISTINCT {c}) FROM {t}").fetchone()
    out: dict[str, Any] = {
        "name": name, "type": kind, "rows": rows, "nulls": rows - non_null, "distinct": distinct,
        "unique": non_null > 0 and distinct == non_null, "id_like": _id_like(name),
    }
    if non_null == 0:
        return out
    if kind == "number":
        r = ws.execute(
            f"""SELECT min({c}), max({c}), avg({c}), median({c}), stddev_samp({c}),
                       quantile_cont({c}, [0.05, 0.25, 0.75, 0.95]),
                       count(*) FILTER (WHERE {c} = 0), count(*) FILTER (WHERE {c} < 0)
                FROM {t}"""
        ).fetchone()
        lo, hi = float(r[0]), float(r[1])
        q = r[5] or [None] * 4
        out.update(min=_f(r[0]), max=_f(r[1]), mean=_f(r[2]), median=_f(r[3]), stddev=_f(r[4]),
                   p05=_f(q[0]), p25=_f(q[1]), p75=_f(q[2]), p95=_f(q[3]), zeros=r[6], negatives=r[7])
        if q[1] is not None and q[2] is not None:
            iqr = q[2] - q[1]
            low, high = q[1] - 1.5 * iqr, q[2] + 1.5 * iqr
            out["outliers"] = ws.execute(f"SELECT count(*) FROM {t} WHERE {c} < ? OR {c} > ?", [low, high]).fetchone()[0]
            out["outlier_range"] = [_f(low), _f(high)]
        out["histogram"] = _number_histogram(ws, t, c, lo, hi)
    elif kind in ("date", "datetime"):
        lo, hi = ws.execute(f"SELECT min({c}), max({c}) FROM {t}").fetchone()
        out.update(min=_f(lo), max=_f(hi))
        span = (_as_date(hi) - _as_date(lo)).days if lo is not None and hi is not None else 0
        unit = "day" if span <= 62 else "week" if span <= 366 else "month" if span <= 366 * 5 else "year"
        out["unit"] = unit
        hist = ws.execute(
            f"SELECT CAST(date_trunc('{unit}', {c}) AS DATE) AS b, count(*) FROM {t} WHERE {c} IS NOT NULL GROUP BY b ORDER BY b"
        ).fetchall()
        out["histogram"] = [{"start": _f(b), "count": n} for b, n in hist]
    elif kind == "boolean":
        r = ws.execute(f"SELECT count(*) FILTER (WHERE {c}), count(*) FILTER (WHERE NOT {c}) FROM {t}").fetchone()
        out.update(true=r[0], false=r[1])
    else:
        text = f"CAST({c} AS VARCHAR)"
        r = ws.execute(
            f"""SELECT min(length({text})), max(length({text})), avg(length({text})),
                       count(*) FILTER (WHERE trim({text}) = ''),
                       count(*) FILTER (WHERE regexp_matches(trim({text}), '{_ISO}') OR regexp_matches(trim({text}), '{_DOT}')
                                         OR regexp_matches(trim({text}), '{_UNIX}'))
                FROM {t} WHERE {c} IS NOT NULL"""
        ).fetchone()
        out.update(min_length=r[0], max_length=r[1], avg_length=_f(r[2]), empty=r[3], date_like=r[4])
        out["looks_like_dates"] = non_null > 0 and r[4] / non_null >= 0.8 and kind == "string"
    if kind != "number" or distinct <= 50:
        top = ws.execute(
            f"SELECT {c}, count(*) AS n FROM {t} WHERE {c} IS NOT NULL GROUP BY {c} ORDER BY n DESC, {c} LIMIT {TOP_VALUES}"
        ).fetchall()
        out["top"] = [{"value": _f(v), "count": n} for v, n in top]
    return out


def _as_date(v: Any) -> dt.date:
    if isinstance(v, dt.datetime):
        return v.date()
    return v


def _number_histogram(ws: Workspace, t: str, c: str, lo: float, hi: float) -> list[dict[str, Any]]:
    if hi == lo:
        n = ws.execute(f"SELECT count({c}) FROM {t}").fetchone()[0]
        return [{"start": _f(lo), "end": _f(hi), "count": n}]
    width = _nice((hi - lo) / HIST_BINS)
    start = math.floor(lo / width) * width
    rows = ws.execute(
        f"SELECT floor(({c} - ?) / ?) AS b, count(*) FROM {t} WHERE {c} IS NOT NULL GROUP BY b ORDER BY b", [start, width]
    ).fetchall()
    return [{"start": _f(start + b * width), "end": _f(start + (b + 1) * width), "count": n} for b, n in rows]


def _nice(raw: float) -> float:
    """1, 2, 2.5 or 5 times a power of ten: bins people can read (0-50, 50-100 ...)."""
    exp = math.floor(math.log10(raw))
    for step in (1, 2, 2.5, 5, 10):
        if raw <= step * 10**exp:
            return step * 10**exp
    return 10 ** (exp + 1)


def nice_width(lo: float, hi: float, bins: int = 10) -> float:
    return _nice((hi - lo) / bins) if hi > lo else 1.0


def _correlations(ws: Workspace, t: str, names: list[str]) -> dict[str, Any] | None:
    if len(names) < 2:
        return None
    pairs = [(a, b) for i, a in enumerate(names) for b in names[i + 1 :]]
    select = ", ".join(f"corr({quote(a)}, {quote(b)})" for a, b in pairs)
    values = ws.execute(f"SELECT {select} FROM {quote(t)}").fetchone()
    matrix = [[1.0 if i == j else None for j in range(len(names))] for i in range(len(names))]
    for (a, b), v in zip(pairs, values):
        i, j = names.index(a), names.index(b)
        matrix[i][j] = matrix[j][i] = _f(v)
    return {"columns": names, "matrix": matrix}
