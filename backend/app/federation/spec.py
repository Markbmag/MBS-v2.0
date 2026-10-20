"""FederatedSpec v1: a question that combines several sources (roadmap M6).

    {"version": 1,
     "sources": [
        {"alias": "mes", "type": "question", "question_id": 12},
        {"alias": "les", "type": "sql", "connection": "les", "sql": "SELECT vin, shipped_at FROM shipments"},
        {"alias": "plan", "type": "builder", "spec": {QuerySpec}},
        {"alias": "targets", "type": "dataset", "dataset_id": 3}],
     "mode": "join",
     "joins": [{"source": "les", "type": "left", "on": [{"left": "mes.vin", "right": "les.vin", "match": "auto"}]}],
     "columns": [{"ref": "mes.vin"}, {"ref": "les.shipped_at", "alias": "shipped"}],
     "post": {"breakouts": [...], "aggregations": [...], "filters": {...}, "order": [...]},
     "limit": 2000}

Every source is read (up to a row cap) and loaded into an in-process DuckDB as a
table named by its alias. In "join" mode the sources are joined one after the other
onto the first; in "sql" mode a SELECT over the aliases does it. Either way the
result is a table "result" that the post step - a builder question without its own
source or joins - can filter, summarise and sort.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..query.spec import Aggregation, Breakout, CustomColumn, Field_, FilterGroup, OrderBy, QuerySpec, Transform

ALIAS_RE = r"^[a-z_][a-z0-9_]{0,31}$"
RESULT_TABLE = "result"
POST_CONNECTION = "__federated__"  # placeholder: the post step's spec runs in DuckDB, not on a connection
MAX_SOURCES = 6
RESERVED = {RESULT_TABLE, "main", "temp", "information_schema", "pg_catalog", "system"}

SourceType = Literal["question", "builder", "sql", "dataset"]
JoinType = Literal["inner", "left", "right", "full"]
KeyMatch = Literal["auto", "exact", "text", "text_ci", "number"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Source(_Model):
    alias: str = Field(pattern=ALIAS_RE)
    label: str | None = Field(default=None, max_length=120)
    type: SourceType
    question_id: int | None = None            # type question: a saved builder / SQL question
    spec: QuerySpec | None = None             # type builder
    connection: str | None = Field(default=None, max_length=64)  # type sql
    sql: str | None = Field(default=None, max_length=100_000)    # type sql
    dataset_id: int | None = None             # type dataset: an uploaded file
    limit: int | None = Field(default=None, ge=1, description="rows read from the source (capped by the server)")

    @model_validator(mode="after")
    def _fields(self) -> "Source":
        need = {"question": "question_id", "builder": "spec", "sql": "sql", "dataset": "dataset_id"}[self.type]
        if getattr(self, need) is None:
            raise ValueError(f"a {self.type} source needs {need}")
        if self.type == "sql" and not self.connection:
            raise ValueError("a sql source needs a connection")
        if self.alias in RESERVED:
            raise ValueError(f"{self.alias!r} cannot be used as a source name")
        return self


class KeyPair(_Model):
    left: str = Field(min_length=3, max_length=300)   # "alias.column" of a source already joined
    right: str = Field(min_length=3, max_length=300)  # "alias.column" of the source being joined
    match: KeyMatch = "auto"


class Join(_Model):
    source: str = Field(pattern=ALIAS_RE)
    type: JoinType = "left"
    on: list[KeyPair] = Field(min_length=1, max_length=4)


class OutputColumn(_Model):
    ref: str = Field(min_length=3, max_length=300)    # "alias.column"
    alias: str | None = Field(default=None, min_length=1, max_length=64)


class PostSpec(_Model):
    """A builder question over the combined rows (the table "result")."""

    expressions: list[CustomColumn] = Field(default_factory=list, max_length=50)
    fields: list[Field_] = Field(default_factory=list, max_length=300)
    aggregations: list[Aggregation] = Field(default_factory=list, max_length=50)
    breakouts: list[Breakout] = Field(default_factory=list, max_length=10)
    filters: FilterGroup | None = None
    having: FilterGroup | None = None
    order: list[OrderBy] = Field(default_factory=list, max_length=20)

    def query_spec(self, limit: int | None) -> QuerySpec:
        data: dict[str, Any] = self.model_dump(mode="json", by_alias=True, exclude_unset=True)
        return QuerySpec.model_validate(
            {"version": 1, "connection": POST_CONNECTION, "source": {"table": RESULT_TABLE}, **data, "limit": limit}
        )


class ColumnHint(_Model):
    name: str = Field(max_length=200)
    type: str = Field(max_length=16)


class FederatedSpec(_Model):
    version: Literal[1] = 1
    sources: list[Source] = Field(min_length=1, max_length=MAX_SOURCES)
    mode: Literal["join", "sql"] = "join"
    joins: list[Join] = Field(default_factory=list, max_length=MAX_SOURCES - 1)
    columns: list[OutputColumn] = Field(default_factory=list, max_length=500)
    sql: str | None = Field(default=None, max_length=100_000)
    post: PostSpec | None = None
    limit: int | None = Field(default=None, ge=1)
    # The combined columns as of the last run, saved by the editor: dashboards offer them
    # for filter mappings without running the question. Not used to run it.
    result_columns: list[ColumnHint] = Field(default_factory=list, max_length=500)
    transforms: list[Transform] = Field(default_factory=list, max_length=20)  # on the final rows (M7)

    @model_validator(mode="after")
    def _shape(self) -> "FederatedSpec":
        aliases = [s.alias for s in self.sources]
        if len(aliases) != len(set(aliases)):
            raise ValueError("source names must be unique")
        if self.mode == "sql":
            if not (self.sql or "").strip():
                raise ValueError("write the SQL that combines the sources")
            return self
        joined = {aliases[0]}
        for j in self.joins:
            if j.source not in aliases:
                raise ValueError(f"the join refers to an unknown source {j.source!r}")
            if j.source in joined:
                raise ValueError(f"{j.source!r} is joined twice (or is the first source)")
            for pair in j.on:
                left, right = pair.left.split(".", 1)[0], pair.right.split(".", 1)[0]
                if left == j.source and right in joined:  # written the other way round
                    pair.left, pair.right = pair.right, pair.left
                    left, right = right, left
                if right != j.source or left not in joined:
                    raise ValueError(
                        f"joining {j.source!r}: each key pairs a column of {j.source!r} with one of {', '.join(sorted(joined))}"
                    )
            joined.add(j.source)
        loose = [a for a in aliases if a not in joined]
        if loose:
            raise ValueError(f"join {', '.join(repr(a) for a in loose)} to the other sources, or remove it")
        return self

    def post_spec(self, limit: int | None) -> QuerySpec:
        return (self.post or PostSpec()).query_spec(limit)


def split_ref(ref: str) -> tuple[str, str]:
    alias, _, column = ref.partition(".")
    if not alias or not column:
        raise ValueError(f"{ref!r} should look like source.column")
    return alias, column
