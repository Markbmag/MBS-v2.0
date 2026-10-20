"""Question parameters (roadmap M4; dashboard filters in M5 map onto them).

A saved question declares its parameters:

    [{"name": "region", "label": "Region", "type": "text", "default": null, "required": false}]

* SQL questions use them as {{region}} in the SQL text. Every {{name}} needs a value
  when the question runs: the one given, else the default.
* Builder questions mark filter conditions with "param": "region". The value given
  (or the default) replaces the condition's value; with neither the condition is
  left out, so an unset filter shows everything - unless the parameter is required.

Values are always bound parameters; their type is checked here first.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..query.spec import Condition, FilterGroup, QuerySpec
from .store import ContentError

ParamType = Literal["text", "number", "date"]
NAME_RE = r"^[A-Za-z_][A-Za-z0-9_]{0,63}$"
# operators whose value a parameter can supply (plain values, lists for in / between)
PARAM_OPS = {"=", "!=", ">", ">=", "<", "<=", "between", "in", "not_in", "contains", "not_contains", "starts_with", "ends_with"}
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$")
MAX_LIST = 1000


class ParameterDef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(pattern=NAME_RE)
    label: str | None = Field(default=None, max_length=120)
    type: ParamType = "text"
    default: Any = None
    required: bool = False


def _scalar(defn: ParameterDef, raw: Any) -> Any:
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        return None
    if isinstance(raw, (dict, list)):
        raise ContentError(f"Parameter {defn.name!r}: a single value was expected")
    if defn.type == "number":
        if isinstance(raw, bool):
            raise ContentError(f"Parameter {defn.name!r} must be a number")
        if isinstance(raw, (int, float)):
            return raw
        try:
            text = str(raw).strip()
            return int(text) if re.fullmatch(r"-?\d+", text) else float(text)
        except ValueError:
            raise ContentError(f"Parameter {defn.name!r} must be a number, not {raw!r}") from None
    if defn.type == "date":
        text = str(raw).strip()
        if not _DATE_RE.match(text):
            raise ContentError(f"Parameter {defn.name!r} must be a date like 2026-01-31, not {raw!r}")
        try:
            datetime.fromisoformat(text.replace(" ", "T"))
        except ValueError:
            raise ContentError(f"Parameter {defn.name!r} is not a real date: {raw!r}") from None
        return text
    text = str(raw)
    if len(text) > 500:
        raise ContentError(f"Parameter {defn.name!r} is limited to 500 characters")
    return text


def coerce(defn: ParameterDef, raw: Any) -> Any:
    """A checked value (or list of values), or None for "no value"."""
    if isinstance(raw, list):
        if len(raw) > MAX_LIST:
            raise ContentError(f"Parameter {defn.name!r} takes at most {MAX_LIST} values")
        values = [_scalar(defn, v) for v in raw]
        values = [v for v in values if v is not None]
        return values or None
    return _scalar(defn, raw)


def resolve(defs: list[ParameterDef], given: dict[str, Any]) -> dict[str, Any]:
    """Value per parameter: given, else default (None = no value)."""
    out: dict[str, Any] = {}
    for d in defs:
        value = coerce(d, given.get(d.name)) if d.name in given else None
        if value is None:
            value = coerce(d, d.default)
        if value is None and d.required:
            raise ContentError(f"Give a value for {d.label or d.name}")
        out[d.name] = value
    return out


# ---------------------------------------------------------------- builder questions

def spec_params(spec: QuerySpec) -> list[tuple[str, str]]:
    """(parameter name, operator) of every condition that takes its value from a parameter."""
    found: list[tuple[str, str]] = []

    def walk(group: FilterGroup | None) -> None:
        if group is None:
            return
        for rule in group.rules:
            if isinstance(rule, Condition):
                if rule.param:
                    found.append((rule.param, rule.op))
            else:
                walk(rule)

    walk(spec.filters)
    walk(spec.having)
    return found


def _shape(value: Any, op: str, name: str) -> Any:
    if op in ("in", "not_in"):
        return value if isinstance(value, list) else [value]
    if op == "between":
        if not isinstance(value, list) or len(value) != 2:
            raise ContentError(f"Parameter {name!r} needs two values (from, to) for 'between'")
        return value
    if isinstance(value, list):
        if len(value) != 1 and len(set(map(str, value))) != 1:
            raise ContentError(f"Parameter {name!r} takes one value here")
        return value[0]
    return value


_SAMPLES = {"text": "x", "number": 0, "date": "2000-01-01"}


def sample_values(defs: list[ParameterDef]) -> dict[str, Any]:
    """Stand-in values, to check that a question with parameters compiles."""
    return {d.name: [_SAMPLES[d.type], _SAMPLES[d.type]] for d in defs}


def bind_spec(spec: QuerySpec, values: dict[str, Any]) -> QuerySpec:
    """The spec with parameter values filled in; conditions without a value are dropped."""
    bound = spec.model_copy(deep=True)

    def walk(group: FilterGroup | None) -> FilterGroup | None:
        if group is None:
            return None
        rules: list[FilterGroup | Condition] = []
        for rule in group.rules:
            if isinstance(rule, Condition):
                if rule.param:
                    value = values.get(rule.param)
                    if value is None:
                        continue
                    rule.value = _shape(value, rule.op, rule.param)
                rules.append(rule)
            else:
                inner = walk(rule)
                if inner is not None:
                    rules.append(inner)
        if not rules:
            return None
        group.rules = rules
        return group

    bound.filters = walk(bound.filters)
    bound.having = walk(bound.having)
    return bound


def check_builder_params(spec: QuerySpec, defs: list[ParameterDef]) -> list[ParameterDef]:
    """Every parameter used is declared and fits its operator; unused declarations are dropped."""
    used = spec_params(spec)
    names = {d.name for d in defs}
    for name, op in used:
        if name not in names:
            raise ContentError(f"Filter parameter {name!r} is not declared")
        if op not in PARAM_OPS:
            raise ContentError(f"The '{op}' filter cannot take its value from a parameter")
    keep = {n for n, _ in used}
    return [d for d in defs if d.name in keep]


def check_sql_params(found: list[str], defs: list[ParameterDef]) -> list[ParameterDef]:
    """One declaration per {{name}} in the SQL (text when not declared), in SQL order."""
    by_name = {d.name: d for d in defs}
    return [by_name.get(n) or ParameterDef(name=n) for n in found]


def sql_bind_values(values: dict[str, Any], defs: list[ParameterDef], dialect: str) -> dict[str, Any]:
    """Values for a SQL question; each {{name}} must have one."""
    out: dict[str, Any] = {}
    for d in defs:
        value = values.get(d.name)
        if value is None:
            raise ContentError(f"Give a value for {d.label or d.name}")
        if isinstance(value, list):
            raise ContentError(f"Parameter {d.name!r} takes one value in SQL")
        if d.type == "date" and dialect != "sqlite" and len(value) == 10:
            value = date.fromisoformat(value)  # drivers bind real dates; SQLite keeps ISO text
        out[d.name] = value
    return out
