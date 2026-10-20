"""QuerySpec v1: a question built without SQL, as JSON.

    {"version": 1, "connection": "mes",
     "source": {"table": "orders"},
     "joins": [{"table": "customers", "type": "left"}],            # "on" omitted: found via foreign keys
     "expressions": [{"name": "net", "expr": {"op": "-", "args": [{"ref": "orders.total"}, {"ref": "orders.tax"}]}}],
     "aggregations": [{"fn": "sum", "ref": "net", "alias": "revenue"},
                      {"fn": "count_distinct", "ref": "orders.customer_id", "alias": "buyers"}],
     "breakouts": [{"ref": "orders.created_at", "bucket": "month"}, {"ref": "customers.region"}],
     "filters": {"op": "and", "rules": [{"ref": "orders.status", "op": "=", "value": "paid"}]},
     "having": {"op": "and", "rules": [{"ref": "revenue", "op": ">", "value": 1000}]},
     "order": [{"ref": "revenue", "dir": "desc"}],
     "limit": 1000}

References ("ref") are "table.column" (or "alias.column" for an aliased join), a bare
column name when it is unique in the query, the name of a custom expression, or -
in "having" and "order" - the name of an output column (aggregation or breakout).

Specs are data: names are only ever looked up in the real schema, values are only
ever bound parameters (compiler.py), never pasted into SQL text.
"""

from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Name = Field(min_length=1, max_length=128)
Ref = Field(min_length=1, max_length=300)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# ---------------------------------------------------------------- expressions

ArithmeticOp = Literal["+", "-", "*", "/"]
FunctionName = Literal["coalesce", "lower", "upper", "trim", "length", "abs", "round", "concat", "nullif"]
Literal_ = Union[str, int, float, bool, None]


class CaseWhen(_Model):
    when: "FilterGroup | Condition"
    then: "Expr"


class Expr(_Model):
    """Exactly one of: ref, value, op (+args), fn (+args), case (+else)."""

    ref: str | None = Field(default=None, min_length=1, max_length=300)
    value: Literal_ = Field(default=None)
    op: ArithmeticOp | None = None
    fn: FunctionName | None = None
    args: list["Expr"] = Field(default_factory=list, max_length=20)
    case: list[CaseWhen] | None = Field(default=None, max_length=50)
    else_: "Expr | None" = Field(default=None, alias="else")
    digits: int | None = Field(default=None, ge=0, le=10, description="round() only")

    @model_validator(mode="after")
    def _one_form(self) -> "Expr":
        forms = [
            self.ref is not None,
            "value" in self.model_fields_set,
            self.op is not None,
            self.fn is not None,
            self.case is not None,
        ]
        if sum(forms) != 1:
            raise ValueError("an expression needs exactly one of: ref, value, op, fn, case")
        if isinstance(self.value, str) and len(self.value) > 500:
            raise ValueError("text values are limited to 500 characters")
        if self.op is not None and len(self.args) != 2:
            raise ValueError(f"'{self.op}' needs exactly 2 args")
        if self.fn is not None and not self.args:
            raise ValueError(f"{self.fn}() needs at least one arg")
        return self


# ---------------------------------------------------------------- filters

FilterOp = Literal[
    "=", "!=", ">", ">=", "<", "<=", "between", "in", "not_in",
    "is_null", "not_null", "is_empty", "not_empty",
    "contains", "not_contains", "starts_with", "ends_with",
    "is_true", "is_false",
    "last", "current",  # relative dates: {"amount": 30, "unit": "day"} / {"unit": "month"}
]
DateUnit = Literal["day", "week", "month", "quarter", "year"]


class RelativeDate(_Model):
    amount: int = Field(default=1, ge=1, le=10_000)
    unit: DateUnit
    include_current: bool = False


class Condition(_Model):
    ref: str | None = Field(default=None, min_length=1, max_length=300)
    expr: Expr | None = None
    op: FilterOp
    value: Any = None
    case_sensitive: bool = False
    # Saved questions (M4): the value comes from this question parameter when it is run
    # (app/content/params.py); without a value the condition is left out.
    param: str | None = Field(default=None, pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")

    @model_validator(mode="after")
    def _target(self) -> "Condition":
        if (self.ref is None) == (self.expr is None):
            raise ValueError("a condition needs either ref or expr")
        return self


class FilterGroup(_Model):
    op: Literal["and", "or"] = "and"
    rules: list["FilterGroup | Condition"] = Field(default_factory=list, max_length=200)


# ---------------------------------------------------------------- the question

JoinType = Literal["inner", "left", "full"]
AggregateFn = Literal["count", "count_distinct", "sum", "avg", "min", "max", "metric"]
Bucket = Literal["minute", "hour", "day", "week", "month", "quarter", "year"]


class Source(_Model):
    table: str = Name
    alias: str | None = Field(default=None, min_length=1, max_length=64)


class JoinOn(_Model):
    left: str = Ref   # a column of a table already in the query
    right: str = Ref  # a column of the joined table


class Join(_Model):
    table: str = Name
    alias: str | None = Field(default=None, min_length=1, max_length=64)
    type: JoinType = "left"
    on: list[JoinOn] = Field(default_factory=list, max_length=10)  # empty = follow foreign keys


class CustomColumn(_Model):
    name: str = Field(min_length=1, max_length=64)
    expr: Expr


class Field_(_Model):
    ref: str | None = Field(default=None, min_length=1, max_length=300)
    expr: Expr | None = None
    alias: str | None = Field(default=None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def _target(self) -> "Field_":
        if (self.ref is None) == (self.expr is None):
            raise ValueError("a field needs either ref or expr")
        return self


class Aggregation(_Model):
    fn: AggregateFn
    ref: str | None = Field(default=None, min_length=1, max_length=300)
    expr: Expr | None = None
    alias: str | None = Field(default=None, min_length=1, max_length=64)
    # only rows matching this count ("revenue of paid orders"); M7
    where: "FilterGroup | None" = None
    # {"fn": "metric", "metric": 3}: a saved metric (app/semantic), expanded before compiling
    metric: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _target(self) -> "Aggregation":
        if self.fn == "metric":
            if self.metric is None or self.ref is not None or self.expr is not None:
                raise ValueError("a metric aggregation names only the metric")
            return self
        if self.metric is not None:
            raise ValueError("metric goes with fn 'metric'")
        if self.ref is not None and self.expr is not None:
            raise ValueError("an aggregation takes ref or expr, not both")
        if self.ref is None and self.expr is None and self.fn != "count":
            raise ValueError(f"{self.fn} needs a column (ref) or an expression")
        return self


class Breakout(_Model):
    ref: str | None = Field(default=None, min_length=1, max_length=300)
    expr: Expr | None = None
    bucket: Bucket | None = None                         # dates: group by month, week ...
    bin_width: float | None = Field(default=None, gt=0)  # numbers: 0-10, 10-20 ...
    alias: str | None = Field(default=None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def _target(self) -> "Breakout":
        if (self.ref is None) == (self.expr is None):
            raise ValueError("a breakout needs either ref or expr")
        if self.bucket is not None and self.bin_width is not None:
            raise ValueError("use bucket (dates) or bin_width (numbers), not both")
        return self


TransformType = Literal[
    "running_total", "moving_average", "pct_change", "previous_period", "rank", "pct_of_total", "outliers",
]


class Transform(_Model):
    """A calculation on the result rows (app/query/transforms.py), e.g. revenue vs. the same month last year."""

    type: TransformType
    column: str = Field(min_length=1, max_length=128)     # the value column of the result
    by: str | None = Field(default=None, max_length=128)  # order (time) column; for rank / % of total: the group
    window: int = Field(default=3, ge=2, le=365)          # moving_average
    period: Literal["day", "week", "month", "quarter", "year"] | None = None  # previous_period
    method: Literal["iqr", "zscore"] = "iqr"              # outliers
    alias: str | None = Field(default=None, min_length=1, max_length=64)


class OrderBy(_Model):
    ref: str = Ref
    dir: Literal["asc", "desc"] = "asc"


class QuerySpec(_Model):
    version: Literal[1] = 1
    connection: str = Field(min_length=1, max_length=64)
    source: Source
    joins: list[Join] = Field(default_factory=list, max_length=20)
    expressions: list[CustomColumn] = Field(default_factory=list, max_length=50)
    fields: list[Field_] = Field(default_factory=list, max_length=300)
    aggregations: list[Aggregation] = Field(default_factory=list, max_length=50)
    breakouts: list[Breakout] = Field(default_factory=list, max_length=10)
    filters: FilterGroup | None = None
    having: FilterGroup | None = None
    order: list[OrderBy] = Field(default_factory=list, max_length=20)
    limit: int | None = Field(default=None, ge=1)
    transforms: list[Transform] = Field(default_factory=list, max_length=20)

    @field_validator("having", mode="before")
    @classmethod
    def _having_list(cls, value: Any) -> Any:
        # The roadmap sketch wrote having as a plain list of conditions: accept it as AND.
        if isinstance(value, list):
            return {"op": "and", "rules": value}
        return value

    @model_validator(mode="after")
    def _shape(self) -> "QuerySpec":
        if self.fields and (self.aggregations or self.breakouts):
            raise ValueError("fields cannot be combined with aggregations/breakouts (group by the breakouts instead)")
        if self.having and not (self.aggregations or self.breakouts):
            raise ValueError("having needs aggregations or breakouts")
        names = [c.name for c in self.expressions]
        if len(names) != len(set(names)):
            raise ValueError("custom expression names must be unique")
        return self


Aggregation.model_rebuild()
CaseWhen.model_rebuild()
Expr.model_rebuild()
FilterGroup.model_rebuild()
Condition.model_rebuild()
