"""Calculations on result rows (roadmap M7): what changed, by how much, compared with what.

    running_total     cumulative sum along the time (or first) column, per series
    moving_average    average of the last `window` rows, per series
    pct_change        change against the previous row, as a fraction (0.12 = +12 %)
    previous_period   the value of the same series one period earlier ("last year") and the
                      change against it; matched by date, so a missing month is not mistaken
                      for the previous one
    rank              1 = largest, within each value of `by` (or overall)
    pct_of_total      share of the total, within each value of `by` (or overall)
    outliers          true where a value lies outside 1.5 x IQR (or |z| > 3)

They run on the rows the query returned (at most the row limit), after the database,
the same way for builder questions, SQL and multi-source questions. A series is one
combination of the other dimension columns (e.g. one region), so "running total of
revenue by month" restarts for every region.
"""

from __future__ import annotations

import datetime as dt
import math
import statistics
from typing import Any, Callable

from ..results import ResultColumn, ResultEnvelope
from .spec import Transform

DATE_TYPES = ("date", "datetime")
PERCENT = {"style": "percent", "decimals": 1}


class TransformError(ValueError):
    """The transform does not fit the result (unknown column ...); shown to the user."""


def output_names(t: Transform) -> list[str]:
    base = t.alias or t.column
    if t.type == "running_total":
        return [t.alias or f"{base}_running_total"]
    if t.type == "moving_average":
        return [t.alias or f"{base}_avg_{t.window}"]
    if t.type == "pct_change":
        return [t.alias or f"{base}_change"]
    if t.type == "previous_period":
        p = t.period or "period"
        return [f"{base}_prev_{p}", t.alias or f"{base}_vs_prev_{p}"]
    if t.type == "rank":
        return [t.alias or f"{base}_rank"]
    if t.type == "pct_of_total":
        return [t.alias or f"{base}_pct_of_total"]
    return [t.alias or f"{base}_outlier"]


def apply_transforms(envelope: ResultEnvelope, transforms: list[Transform]) -> ResultEnvelope:
    for t in transforms:
        _apply(envelope, t)
    return envelope


def _index(env: ResultEnvelope, name: str | None, what: str) -> int:
    names = [c.name for c in env.columns]
    if name in names:
        return names.index(name)
    lowered = [n.lower() for n in names]
    if name and name.lower() in lowered:
        return lowered.index(name.lower())
    raise TransformError(f"{what}: the result has no column {name!r} (columns: {', '.join(names)})")


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return None if isinstance(v, float) and math.isnan(v) else float(v)
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _add(env: ResultEnvelope, name: str, type_: str, values: list[Any], fmt: dict[str, Any] | None = None) -> None:
    taken = {c.name for c in env.columns}
    base, n = name, 2
    while name in taken:
        name = f"{base}_{n}"
        n += 1
    col = ResultColumn(name=name, type=type_, role="measure" if type_ == "number" else "dimension")
    if fmt is not None:
        col.format = fmt
    env.columns.append(col)
    for row, v in zip(env.rows, values):
        row.append(_clean(v))


def _clean(v: Any) -> Any:
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return round(v, 10)
    return v


def _order_column(env: ResultEnvelope, t: Transform, value_idx: int) -> int | None:
    if t.by:
        return _index(env, t.by, t.type)
    for i, c in enumerate(env.columns):
        if i != value_idx and c.type in DATE_TYPES:
            return i
    for i, c in enumerate(env.columns):
        if i != value_idx and c.role == "dimension":
            return i
    return None


def _series(env: ResultEnvelope, exclude: set[int]) -> Callable[[list[Any]], tuple]:
    """Key of the series a row belongs to: its other dimension columns."""
    dims = [i for i, c in enumerate(env.columns) if c.role == "dimension" and i not in exclude and not c.generated]
    return lambda row: tuple(row[i] for i in dims)


def _apply(env: ResultEnvelope, t: Transform) -> None:
    vi = _index(env, t.column, t.type)
    values = [_num(r[vi]) for r in env.rows]
    names = output_names(t)
    fmt = env.columns[vi].format

    if t.type in ("rank", "pct_of_total", "outliers"):
        group_idx = _index(env, t.by, t.type) if t.by else None
        groups: dict[Any, list[int]] = {}
        for i, row in enumerate(env.rows):
            groups.setdefault(row[group_idx] if group_idx is not None else None, []).append(i)
        out: list[Any] = [None] * len(env.rows)
        for members in groups.values():
            vals = [(i, values[i]) for i in members if values[i] is not None]
            if t.type == "rank":
                ordered = sorted(vals, key=lambda p: -p[1])
                for pos, (i, v) in enumerate(ordered):
                    # ties share the better rank (1, 2, 2, 4)
                    out[i] = pos + 1 if pos == 0 or v != ordered[pos - 1][1] else out[ordered[pos - 1][0]]
            elif t.type == "pct_of_total":
                total = sum(v for _, v in vals)
                for i, v in vals:
                    out[i] = v / total if total else None
            else:
                out = _outliers(vals, t.method, out)
        if t.type == "outliers":
            _add(env, names[0], "boolean", [bool(x) if x is not None else None for x in out])
        else:
            _add(env, names[0], "number", out, PERCENT if t.type == "pct_of_total" else None)
        _mark(env, len(names))
        return

    oi = _order_column(env, t, vi)
    key = _series(env, {vi} | ({oi} if oi is not None else set()))
    series: dict[tuple, list[int]] = {}
    for i, row in enumerate(env.rows):
        series.setdefault(key(row), []).append(i)
    if oi is not None:
        sort_key = _sort_key(env.columns[oi].type)
        for members in series.values():
            members.sort(key=lambda i: sort_key(env.rows[i][oi]))

    if t.type == "previous_period":
        if oi is None or env.columns[oi].type not in DATE_TYPES:
            raise TransformError("Comparing with the previous period needs a date column (e.g. grouped by month)")
        period = t.period or _guess_period(env, oi)
        names = output_names(t.model_copy(update={"period": period}))
        prev: list[Any] = [None] * len(env.rows)
        change: list[Any] = [None] * len(env.rows)
        for members in series.values():
            by_day = {_day(env.rows[i][oi]): i for i in members}
            for i in members:
                day = _day(env.rows[i][oi])
                if day is None:
                    continue
                j = by_day.get(_shift(day, period, -1))
                if j is not None:
                    prev[i] = values[j]
                    if values[i] is not None and values[j]:
                        change[i] = (values[i] - values[j]) / abs(values[j])
        _add(env, names[0], "number", prev, fmt)
        _add(env, names[1], "number", change, PERCENT)
        _mark(env, 2)
        return

    out = [None] * len(env.rows)
    for members in series.values():
        running = 0.0
        window: list[float] = []
        last: float | None = None
        for i in members:
            v = values[i]
            if t.type == "running_total":
                running += v or 0.0
                out[i] = running
            elif t.type == "moving_average":
                if v is not None:
                    window.append(v)
                    window = window[-t.window:]
                out[i] = sum(window) / len(window) if len(window) == t.window else None
            else:  # pct_change against the previous row of the series
                out[i] = (v - last) / abs(last) if v is not None and last not in (None, 0) else None
                last = v if v is not None else last
    if t.type == "pct_change":
        _add(env, names[0], "number", out, PERCENT)
    else:
        _add(env, names[0], "number", out, fmt)
    _mark(env, 1)


def _mark(env: ResultEnvelope, count: int) -> None:
    for c in env.columns[-count:]:
        c.generated = True


def _outliers(vals: list[tuple[int, float]], method: str, out: list[Any]) -> list[Any]:
    numbers = [v for _, v in vals]
    if len(numbers) < 4:
        for i, _ in vals:
            out[i] = False
        return out
    if method == "zscore":
        mean = statistics.fmean(numbers)
        sd = statistics.pstdev(numbers)
        for i, v in vals:
            out[i] = bool(sd) and abs(v - mean) / sd > 3
        return out
    q1, _q2, q3 = statistics.quantiles(numbers, n=4, method="inclusive")
    low, high = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
    for i, v in vals:
        out[i] = v < low or v > high
    return out


# ---------------------------------------------------------------- dates

def _day(v: Any) -> dt.date | None:
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if isinstance(v, str) and len(v) >= 10:
        try:
            return dt.date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


def _sort_key(type_: str) -> Callable[[Any], tuple]:
    def key(v: Any) -> tuple:
        if v is None:
            return (1, "")
        if type_ == "number" and isinstance(v, (int, float)):
            return (0, v)
        return (0, str(v))

    return key


def _shift(day: dt.date, period: str, n: int) -> dt.date:
    if period == "day":
        return day + dt.timedelta(days=n)
    if period == "week":
        return day + dt.timedelta(weeks=n)
    months = {"month": 1, "quarter": 3, "year": 12}[period] * n
    m = day.month - 1 + months
    year, month = day.year + m // 12, m % 12 + 1
    last = [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    return dt.date(year, month, min(day.day, last))


def _guess_period(env: ResultEnvelope, oi: int) -> str:
    """The step between consecutive dates: a monthly result compares with the previous month."""
    days = sorted({d for d in (_day(r[oi]) for r in env.rows) if d is not None})
    gaps = sorted((b - a).days for a, b in zip(days, days[1:]))
    if not gaps:
        return "month"
    step = gaps[len(gaps) // 2]
    if step <= 1:
        return "day"
    if step <= 7:
        return "week"
    if step <= 31:
        return "month"
    if step <= 92:
        return "quarter"
    return "year"
