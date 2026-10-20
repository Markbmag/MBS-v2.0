"""Joining the loaded sources into the table "result", with match statistics.

DataDesk merged sources in a dictionary keyed by the key value, so a second row with
the same key silently replaced the first, and keys without a partner were never
reported. Here the join is a real SQL join (inner / left / right / full, up to four
key columns, with key normalisation), and every join reports how many rows and
distinct keys on each side found no partner - "37 % of mes keys have no match in
les" - plus a few of the keys that did not match and whether keys repeat (which
multiplies rows).

All names in the SQL built here come from the spec's aliases and the columns of the
loaded tables (looked up, then quoted); no value typed by a user is pasted in.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..serialize import serialize_value
from .spec import RESULT_TABLE, FederatedSpec, Join, KeyPair, split_ref
from .workspace import Workspace, ncode_type, quote

SAMPLE_KEYS = 5


class CombineError(ValueError):
    """The spec does not fit the loaded data (unknown column ...); shown to the user."""


@dataclass
class JoinStats:
    source: str
    type: str
    keys: list[str]
    match: list[str]
    left_rows: int = 0
    right_rows: int = 0
    left_unmatched_rows: int = 0
    right_unmatched_rows: int = 0
    left_null_keys: int = 0
    right_null_keys: int = 0
    left_keys: int = 0
    right_keys: int = 0
    left_unmatched_keys: int = 0
    right_unmatched_keys: int = 0
    left_repeated_keys: int = 0
    right_repeated_keys: int = 0
    left_samples: list[Any] = field(default_factory=list)
    right_samples: list[Any] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


class Combiner:
    def __init__(self, ws: Workspace, spec: FederatedSpec):
        self.ws = ws
        self.spec = spec
        self.types: dict[str, dict[str, str]] = {}   # alias -> column (lower) -> DuckDB type
        self.names: dict[str, dict[str, str]] = {}   # alias -> column (lower) -> real column name
        for s in spec.sources:
            cols = ws.columns(s.alias)
            self.types[s.alias] = {n.lower(): t for n, t in cols}
            self.names[s.alias] = {n.lower(): n for n, _ in cols}

    # ------------------------------------------------------------------ names
    def _column(self, ref: str) -> tuple[str, str, str]:
        """(alias, real column name, DuckDB type) of "alias.column"."""
        try:
            alias, column = split_ref(ref)
        except ValueError as exc:
            raise CombineError(str(exc)) from None
        if alias not in self.names:
            raise CombineError(f"Unknown source {alias!r} in {ref!r}")
        real = self.names[alias].get(column.lower())
        if real is None:
            raise CombineError(f"{alias!r} has no column {column!r}")
        return alias, real, self.types[alias][real.lower()]

    def _sql_ref(self, ref: str) -> tuple[str, str]:
        alias, real, type_ = self._column(ref)
        return f"{quote(alias)}.{quote(real)}", type_

    # ------------------------------------------------------------------ keys
    @staticmethod
    def _effective_match(pair: KeyPair, left_type: str, right_type: str) -> str:
        if pair.match != "auto":
            return pair.match
        lt, rt = ncode_type(left_type), ncode_type(right_type)
        if lt == rt and lt in ("number", "date", "datetime", "time", "boolean"):
            return "exact"
        if {lt, rt} <= {"date", "datetime"}:
            return "exact"
        if "number" in (lt, rt) and {lt, rt} <= {"number", "string", "unknown"}:
            return "number"
        return "text"

    @staticmethod
    def _key(expr: str, match: str) -> str:
        if match == "exact":
            return expr
        if match == "number":
            return f"TRY_CAST({expr} AS DOUBLE)"
        text = f"NULLIF(trim(CAST({expr} AS VARCHAR)), '')"
        return f"lower({text})" if match == "text_ci" else text

    def _pairs(self, join: Join) -> list[tuple[str, str, str]]:
        """(left key SQL, right key SQL, match used) per key pair."""
        out = []
        for pair in join.on:
            lsql, ltype = self._sql_ref(pair.left)
            rsql, rtype = self._sql_ref(pair.right)
            match = self._effective_match(pair, ltype, rtype)
            out.append((self._key(lsql, match), self._key(rsql, match), match))
        return out

    def _from(self, upto: int) -> str:
        """FROM clause: the first source with the first `upto` joins."""
        first = self.spec.sources[0].alias
        sql = f"{quote(first)}"
        for join in self.spec.joins[:upto]:
            on = " AND ".join(f"{l} = {r}" for l, r, _ in self._pairs(join))
            sql += f" {join.type.upper()} JOIN {quote(join.source)} ON {on}"
        return sql

    # ------------------------------------------------------------------ output
    def _select_list(self) -> list[tuple[str, str]]:
        """(SQL, output name) of the combined columns."""
        out: list[tuple[str, str]] = []
        if self.spec.columns:
            for c in self.spec.columns:
                alias, real, _ = self._column(c.ref)
                out.append((f"{quote(alias)}.{quote(real)}", c.alias or real))
        else:
            counts: dict[str, int] = {}
            for s in self.spec.sources:
                for n in self.names[s.alias].values():
                    counts[n.lower()] = counts.get(n.lower(), 0) + 1
            for s in self.spec.sources:
                for low, real in self.names[s.alias].items():
                    name = real if counts[low] == 1 else f"{s.alias}_{real}"
                    out.append((f"{quote(s.alias)}.{quote(real)}", name))
        taken: set[str] = set()
        unique = []
        for sql, name in out:
            base, n = name, 2
            while name.lower() in taken:
                name = f"{base}_{n}"
                n += 1
            taken.add(name.lower())
            unique.append((sql, name))
        return unique

    def join_sql(self) -> str:
        columns = ", ".join(f"{sql} AS {quote(name)}" for sql, name in self._select_list())
        return f"SELECT {columns} FROM {self._from(len(self.spec.joins))}"

    def build(self) -> tuple[str, list[JoinStats]]:
        """Create the table "result"; returns its SQL and the statistics of every join."""
        stats = []
        for i, join in enumerate(self.spec.joins):
            try:
                stats.append(self._stats(i))
            except Exception as exc:
                if "Conversion" not in type(exc).__name__:
                    raise
                raise CombineError(
                    f"Joining {join.source!r}: the key columns cannot be compared as they are "
                    f"({str(exc).splitlines()[0]}). Compare them as text or as numbers instead."
                ) from None
        sql = self.join_sql()
        self.ws.execute(f"CREATE TABLE {quote(RESULT_TABLE)} AS {sql}")
        return sql, stats

    def _stats(self, index: int) -> JoinStats:
        join = self.spec.joins[index]
        pairs = self._pairs(join)
        k = [f"k{i}" for i in range(len(pairs))]
        lkeys = ", ".join(f"{l} AS {k[i]}" for i, (l, _, _) in enumerate(pairs))
        rkeys = ", ".join(f"{r} AS {k[i]}" for i, (_, r, _) in enumerate(pairs))
        not_null = " AND ".join(f"{c} IS NOT NULL" for c in k)
        any_null = " OR ".join(f"{c} IS NULL" for c in k)
        on = lambda a, b: " AND ".join(f"{a}.{c} = {b}.{c}" for c in k)  # noqa: E731
        keys = ", ".join(k)
        sql = f"""
        WITH l AS (SELECT {lkeys} FROM {self._from(index)}),
             r AS (SELECT {rkeys} FROM {quote(join.source)}),
             ld AS (SELECT DISTINCT {keys} FROM l WHERE {not_null}),
             rd AS (SELECT DISTINCT {keys} FROM r WHERE {not_null})
        SELECT
          (SELECT count(*) FROM l),
          (SELECT count(*) FROM r),
          (SELECT count(*) FROM l ANTI JOIN r ON {on('l', 'r')}),
          (SELECT count(*) FROM r ANTI JOIN l ON {on('r', 'l')}),
          (SELECT count(*) FROM l WHERE {any_null}),
          (SELECT count(*) FROM r WHERE {any_null}),
          (SELECT count(*) FROM ld),
          (SELECT count(*) FROM rd),
          (SELECT count(*) FROM ld ANTI JOIN rd ON {on('ld', 'rd')}),
          (SELECT count(*) FROM rd ANTI JOIN ld ON {on('rd', 'ld')}),
          (SELECT count(*) FROM (SELECT 1 FROM l WHERE {not_null} GROUP BY {keys} HAVING count(*) > 1)),
          (SELECT count(*) FROM (SELECT 1 FROM r WHERE {not_null} GROUP BY {keys} HAVING count(*) > 1))
        """
        values = self.ws.execute(sql).fetchone()
        samples = []
        for a, b in (("ld", "rd"), ("rd", "ld")):
            rows = self.ws.execute(
                f"""WITH l AS (SELECT {lkeys} FROM {self._from(index)}),
                         r AS (SELECT {rkeys} FROM {quote(join.source)}),
                         ld AS (SELECT DISTINCT {keys} FROM l WHERE {not_null}),
                         rd AS (SELECT DISTINCT {keys} FROM r WHERE {not_null})
                    SELECT {keys} FROM {a} ANTI JOIN {b} ON {on(a, b)} ORDER BY {keys} LIMIT {SAMPLE_KEYS}"""
            ).fetchall()
            samples.append([serialize_value(r[0]) if len(r) == 1 else [serialize_value(v) for v in r] for r in rows])
        return JoinStats(
            source=join.source, type=join.type, keys=[f"{p.left} = {p.right}" for p in join.on],
            match=[m for _, _, m in pairs],
            left_rows=values[0], right_rows=values[1], left_unmatched_rows=values[2], right_unmatched_rows=values[3],
            left_null_keys=values[4], right_null_keys=values[5], left_keys=values[6], right_keys=values[7],
            left_unmatched_keys=values[8], right_unmatched_keys=values[9],
            left_repeated_keys=values[10], right_repeated_keys=values[11],
            left_samples=samples[0], right_samples=samples[1],
        )
