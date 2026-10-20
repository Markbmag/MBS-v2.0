"""Dashboards (roadmap M5): a grid of cards in a collection, with filters.

A dashboard follows the permissions of its collection, like a question. Cards are
saved together with the dashboard (PUT replaces the whole definition):

    {"key": "c1", "kind": "question", "question_id": 12, "tab": "t1",
     "layout": {"x": 0, "y": 0, "w": 6, "h": 4}, "viz": null, "title": null,
     "mappings": {"period": {"param": "since"}, "region": {"field": "customers.region"}}}
    {"key": "c2", "kind": "text", "text": "**Note** ...", "layout": {...}}
    {"key": "c3", "kind": "heading", "text": "Sales", "layout": {...}}

Filters are declared once per dashboard and mapped per card, either to a question
parameter ("param") or - builder questions only - to a column ("field"):

    {"id": "period", "label": "Period", "type": "date_range", "default": ["2026-01-01", "2026-12-31"]}

A card shows a question only to people who may view that question too: a dashboard
never widens access to what is on it.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import and_, delete, func, insert, or_, select, update

from ..appdb import User, users_table
from ..query.spec import QuerySpec
from .store import ContentError, ContentStore, Level, NotFound, Question, Snapshot, _clean_name, forget_items
from .tables import dashboard_cards_table, dashboards_table, favorites_table

KEY = r"^[A-Za-z0-9_-]{1,40}$"
FilterType = Literal["date_range", "date", "text", "category", "number"]
MAX_CARDS = 100
GRID_COLS = 12


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DashboardFilter(_Model):
    id: str = Field(pattern=KEY)
    label: str = Field(min_length=1, max_length=120)
    type: FilterType
    default: Any = None
    required: bool = False


class Tab(_Model):
    id: str = Field(pattern=KEY)
    name: str = Field(min_length=1, max_length=80)


class Layout(_Model):
    x: int = Field(ge=0, le=GRID_COLS - 1)
    y: int = Field(ge=0, le=10_000)
    w: int = Field(ge=1, le=GRID_COLS)
    h: int = Field(ge=1, le=60)


class Mapping(_Model):
    param: str | None = Field(default=None, pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
    field: str | None = Field(default=None, min_length=1, max_length=300)

    @model_validator(mode="after")
    def _one(self) -> "Mapping":
        if (self.param is None) == (self.field is None):
            raise ValueError("a mapping names either a param or a field")
        return self


class Card(_Model):
    key: str = Field(pattern=KEY)
    kind: Literal["question", "text", "heading"]
    question_id: int | None = None
    tab: str | None = Field(default=None, pattern=KEY)
    layout: Layout
    viz: dict[str, Any] | None = None
    title: str | None = Field(default=None, max_length=200)
    text: str | None = Field(default=None, max_length=10_000)
    mappings: dict[str, Mapping] = Field(default_factory=dict, max_length=50)

    @model_validator(mode="after")
    def _shape(self) -> "Card":
        if self.kind == "question" and self.question_id is None:
            raise ValueError("a question card needs question_id")
        if self.kind != "question" and (self.question_id is not None or self.mappings):
            raise ValueError("only question cards have a question and filter mappings")
        if self.layout.x + self.layout.w > GRID_COLS:
            raise ValueError(f"card {self.key} is wider than the grid")
        return self


class Definition(_Model):
    filters: list[DashboardFilter] = Field(default_factory=list, max_length=20)
    tabs: list[Tab] = Field(default_factory=list, max_length=20)
    cards: list[Card] = Field(default_factory=list, max_length=MAX_CARDS)
    settings: dict[str, Any] = Field(default_factory=dict)

    @field_validator("settings")
    @classmethod
    def _settings(cls, value: dict[str, Any]) -> dict[str, Any]:
        refresh = value.get("refresh")
        if refresh not in (None, 0, 30, 60, 300, 900):
            raise ValueError("refresh is one of 0, 30, 60, 300, 900 seconds")
        unknown = set(value) - {"refresh"}
        if unknown:
            raise ValueError(f"unknown settings: {', '.join(sorted(unknown))}")
        return value

    @model_validator(mode="after")
    def _references(self) -> "Definition":
        for what, ids in (("filter", [f.id for f in self.filters]), ("tab", [t.id for t in self.tabs]), ("card", [c.key for c in self.cards])):
            if len(ids) != len(set(ids)):
                raise ValueError(f"{what} ids must be unique")
        filters = {f.id for f in self.filters}
        tabs = {t.id for t in self.tabs}
        for c in self.cards:
            if self.tabs and c.tab not in tabs:
                raise ValueError(f"card {c.key} is on an unknown tab")
            if not self.tabs and c.tab is not None:
                raise ValueError(f"card {c.key} names a tab, but the dashboard has none")
            for fid in c.mappings:
                if fid not in filters:
                    raise ValueError(f"card {c.key} maps unknown filter {fid!r}")
        return self


@dataclass
class Dashboard:
    id: int
    name: str
    description: str | None
    collection_id: int
    owner: str | None
    archived: bool
    filters: list[dict[str, Any]]
    tabs: list[dict[str, Any]]
    settings: dict[str, Any]
    cards: list[dict[str, Any]]
    imported: bool
    created_at: float
    updated_at: float
    updated_by: str | None
    favorite: bool = False
    access: Level | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def _loads(text: str | None, default: Any) -> Any:
    return json.loads(text) if text else default


# ---------------------------------------------------------------- filter values -> question run

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _day(value: Any, label: str) -> date:
    if not isinstance(value, str) or not _DATE.match(value.strip()):
        raise ContentError(f"Filter {label!r} needs a date like 2026-01-31")
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        raise ContentError(f"Filter {label!r} is not a real date: {value!r}") from None


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip()) or (isinstance(value, list) and all(_blank(v) for v in value))


def filter_values(filters: list[DashboardFilter], given: dict[str, Any]) -> dict[str, Any]:
    """Value per filter id (given, else default; None = not set), checked against its type."""
    out: dict[str, Any] = {}
    for f in filters:
        value = given.get(f.id)
        if _blank(value):
            value = f.default
        if _blank(value):
            if f.required:
                raise ContentError(f"Give a value for the filter {f.label!r}")
            out[f.id] = None
            continue
        if f.type == "date_range":
            if not isinstance(value, list) or len(value) != 2:
                raise ContentError(f"Filter {f.label!r} needs two dates (from, to)")
            start, end = (_day(v, f.label) if not _blank(v) else None for v in value)
            out[f.id] = [start, end]
        elif f.type == "date":
            out[f.id] = _day(value, f.label)
        elif f.type == "number":
            if isinstance(value, bool):
                raise ContentError(f"Filter {f.label!r} needs a number")
            try:
                out[f.id] = value if isinstance(value, (int, float)) else float(str(value).strip()) if "." in str(value) else int(str(value).strip())
            except ValueError:
                raise ContentError(f"Filter {f.label!r} needs a number, not {value!r}") from None
        elif f.type == "category":
            items = value if isinstance(value, list) else [v.strip() for v in str(value).split(",")]
            out[f.id] = [str(v) for v in items if not _blank(v)][:1000] or None
        else:
            out[f.id] = str(value)[:500]
    return out


ParamShape = Literal["single", "pair", "list"]


def param_shapes(kind: str, spec: dict[str, Any]) -> dict[str, ParamShape]:
    """How many values each parameter of a question takes: one, two (between) or a list (in).

    SQL parameters always take one value; builder parameters follow the filter operator."""
    if kind not in ("builder", "federated"):
        return {}
    from .params import spec_params  # params imports store, like this module

    if kind == "federated":
        from ..federation.spec import FederatedSpec

        try:
            parsed = FederatedSpec.model_validate(spec)
        except ValueError:
            return {}
        uses = spec_params(parsed.post_spec(None))
        for s in parsed.sources:
            if s.spec is not None:
                uses += spec_params(s.spec)
    else:
        uses = spec_params(QuerySpec.model_validate(spec))
    out: dict[str, ParamShape] = {}
    for name, op in uses:
        out.setdefault(name, "pair" if op == "between" else "list" if op in ("in", "not_in") else "single")
    return out


def _as_param(f: DashboardFilter, value: Any, shape: ParamShape, param: str) -> Any:
    """A filter value in the shape the parameter takes (None = leave the parameter unset)."""
    if f.type == "date_range":
        start, end = value
        if shape == "pair":  # an open end becomes a far-away date
            return [(start or date(1900, 1, 1)).isoformat(), (end or date(9999, 12, 31)).isoformat()]
        if shape == "list":
            return [d.isoformat() for d in (start, end) if d] or None
        return start.isoformat() if start else None  # one date: the start of the range ("since")
    if f.type == "date":
        day = value.isoformat()
        return [day, day] if shape == "pair" else [day] if shape == "list" else day
    if isinstance(value, list):  # category
        if shape == "list":
            return value
        if shape == "pair" and len(value) == 2:
            return value
        if shape == "single" and len(value) == 1:
            return value[0]
        raise ContentError(f"Filter {f.label!r} has {len(value)} values, but {{{{{param}}}}} takes {'two' if shape == 'pair' else 'one'}")
    if shape == "list":
        return [value]
    if shape == "pair":
        raise ContentError(f"Filter {f.label!r} has one value, but parameter {param!r} needs two (between)")
    return value


def _field_conditions(ftype: str, ref: str, value: Any) -> list[dict[str, Any]]:
    """Conditions that apply a filter value to a column (builder questions)."""
    if ftype == "date_range":
        start, end = value
        rules = []
        if start:
            rules.append({"ref": ref, "op": ">=", "value": start.isoformat()})
        if end:  # the whole last day counts, for datetime columns too
            rules.append({"ref": ref, "op": "<", "value": (end + timedelta(days=1)).isoformat()})
        return rules
    if ftype == "date":
        return [{"ref": ref, "op": ">=", "value": value.isoformat()}, {"ref": ref, "op": "<", "value": (value + timedelta(days=1)).isoformat()}]
    if ftype == "category":
        return [{"ref": ref, "op": "in", "value": value}]
    if ftype == "text":
        return [{"ref": ref, "op": "contains", "value": value}]
    return [{"ref": ref, "op": "=", "value": value}]


def apply_filters(
    card: Card, filters: list[DashboardFilter], values: dict[str, Any], kind: str,
    shapes: dict[str, ParamShape] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """(question parameter values, extra builder conditions) for one card."""
    shapes = shapes or {}
    by_id = {f.id: f for f in filters}
    params: dict[str, Any] = {}
    conditions: list[dict[str, Any]] = []
    for fid, mapping in card.mappings.items():
        value = values.get(fid)
        f = by_id.get(fid)
        if f is None or value is None:
            continue
        if mapping.param:
            converted = _as_param(f, value, shapes.get(mapping.param, "single"), mapping.param)
            if converted is not None:
                params[mapping.param] = converted
        elif mapping.field:
            if kind not in ("builder", "federated"):
                raise ContentError("Only questions built without SQL can be filtered by a column; map the filter to a parameter")
            conditions.extend(_field_conditions(f.type, mapping.field, value))
    return params, conditions


def add_conditions(spec: QuerySpec, conditions: list[dict[str, Any]]) -> QuerySpec:
    """The spec with extra conditions ANDed to its filters."""
    if not conditions:
        return spec
    data = spec.model_dump(mode="json", by_alias=True, exclude_unset=True)
    rules: list[Any] = list(conditions)
    if data.get("filters"):
        rules.insert(0, data["filters"])
    data["filters"] = {"op": "and", "rules": rules}
    return QuerySpec.model_validate(data)


# ---------------------------------------------------------------- store

class DashboardStore:
    def __init__(self, content: ContentStore):
        self.content = content
        self.engine = content.engine

    def _select(self, user: User):
        fav = (
            select(func.count())
            .select_from(favorites_table)
            .where(
                favorites_table.c.user_id == user.id,
                favorites_table.c.item_type == "dashboard",
                favorites_table.c.item_id == dashboards_table.c.id,
            )
            .scalar_subquery()
        )
        return select(dashboards_table, users_table.c.username.label("owner"), fav.label("fav")).outerjoin(
            users_table, users_table.c.id == dashboards_table.c.owner_id
        )

    def _to(self, row: Any, snap: Snapshot, user: User, cards: list[dict[str, Any]] | None = None) -> Dashboard:
        col = snap.collections.get(row.collection_id)
        return Dashboard(
            id=row.id, name=row.name, description=row.description, collection_id=row.collection_id, owner=row.owner,
            archived=bool(row.archived), filters=_loads(row.filters, []), tabs=_loads(row.tabs, []),
            settings=_loads(row.settings, {}), cards=cards or [], imported=row.import_key is not None,
            created_at=row.created_at, updated_at=row.updated_at, updated_by=row.updated_by, favorite=bool(row.fav),
            access=snap.access(user, row.collection_id),
            extra={"collection": {"id": col.id, "name": col.name} if col else None},
        )

    def _cards(self, dashboard_id: int) -> list[dict[str, Any]]:
        with self.engine.connect() as conn:
            rows = conn.execute(
                select(dashboard_cards_table)
                .where(dashboard_cards_table.c.dashboard_id == dashboard_id)
                .order_by(dashboard_cards_table.c.position)
            ).all()
        return [
            {
                "key": r.card_key, "kind": r.kind, "question_id": r.question_id, "tab": r.tab,
                "layout": _loads(r.layout, {}), "viz": _loads(r.viz, None), "title": r.title, "text": r.text,
                "mappings": _loads(r.mappings, {}),
            }
            for r in rows
        ]

    def get(self, user: User, did: int, level: Level = "view") -> Dashboard:
        snap = self.content.snapshot()
        with self.engine.connect() as conn:
            row = conn.execute(self._select(user).where(dashboards_table.c.id == did)).first()
        if row is None or snap.access(user, row.collection_id) is None:
            raise NotFound("Dashboard")
        self.content._require(snap, user, row.collection_id, level)
        d = self._to(row, snap, user, self._cards(did))
        d.extra["path"] = self.content.breadcrumbs(user, snap, d.collection_id)
        return d

    def card_questions(self, user: User, d: Dashboard) -> dict[int, Question | None]:
        """The questions on the dashboard; None where the user may not see one (or it is gone)."""
        out: dict[int, Question | None] = {}
        for card in d.cards:
            qid = card.get("question_id")
            if qid is None or qid in out:
                continue
            try:
                out[qid] = self.content.get_question(user, qid)
            except ContentError:
                out[qid] = None
        return out

    def list(
        self, user: User, *, collection_id: int | None = None, text: str | None = None,
        favorites: bool = False, archived: bool = False, limit: int = 200,
    ) -> list[Dashboard]:
        snap = self.content.snapshot()
        stmt = self._select(user)
        if collection_id is not None:
            self.content._require(snap, user, collection_id, "view")
            stmt = stmt.where(dashboards_table.c.collection_id == collection_id)
        if text:
            pattern = f"%{text.strip().lower()}%"
            stmt = stmt.where(or_(
                func.lower(dashboards_table.c.name).like(pattern),
                func.lower(func.coalesce(dashboards_table.c.description, "")).like(pattern),
            ))
        if favorites:
            stmt = stmt.where(dashboards_table.c.id.in_(
                select(favorites_table.c.item_id).where(favorites_table.c.user_id == user.id, favorites_table.c.item_type == "dashboard")
            ))
        stmt = stmt.where(dashboards_table.c.archived.is_(archived)).order_by(dashboards_table.c.updated_at.desc())
        with self.engine.connect() as conn:
            rows = conn.execute(stmt).all()
        out = []
        for row in rows:
            if snap.access(user, row.collection_id) is None:
                continue
            if not archived and collection_id is None and snap.hidden(row.collection_id):
                continue
            out.append(self._to(row, snap, user))
            if len(out) >= limit:
                break
        return out

    def create(
        self, user: User, *, name: str, collection_id: int, description: str | None = None,
        definition: Definition | None = None, import_key: str | None = None,
    ) -> Dashboard:
        snap = self.content.snapshot()
        self.content._require(snap, user, collection_id, "edit")
        definition = definition or Definition()
        self._check_questions(user, definition, allowed=set())
        now = time.time()
        with self.engine.begin() as conn:
            did = int(conn.execute(insert(dashboards_table).values(
                name=_clean_name(name, 200), description=(description or "").strip() or None,
                collection_id=collection_id, owner_id=user.id, archived=False,
                filters=json.dumps([f.model_dump() for f in definition.filters]),
                tabs=json.dumps([t.model_dump() for t in definition.tabs]),
                settings=json.dumps(definition.settings), import_key=import_key,
                created_at=now, updated_at=now, updated_by=user.username,
            )).inserted_primary_key[0])
            self._write_cards(conn, did, definition.cards)
        return self.get(user, did)

    def _check_questions(self, user: User, definition: Definition, allowed: set[int]) -> None:
        """Editors may only add questions they can see; cards already there stay as they are."""
        for c in definition.cards:
            if c.question_id is None or c.question_id in allowed:
                continue
            try:
                self.content.get_question(user, c.question_id)
            except ContentError:
                raise ContentError(f"Question {c.question_id} does not exist or is not shared with you", 400) from None

    def _write_cards(self, conn: Any, did: int, cards: list[Card]) -> None:
        conn.execute(delete(dashboard_cards_table).where(dashboard_cards_table.c.dashboard_id == did))
        for position, c in enumerate(cards):
            conn.execute(insert(dashboard_cards_table).values(
                dashboard_id=did, card_key=c.key, tab=c.tab, kind=c.kind, question_id=c.question_id,
                layout=json.dumps(c.layout.model_dump()), viz=json.dumps(c.viz) if c.viz is not None else None,
                mappings=json.dumps({k: m.model_dump(exclude_none=True) for k, m in c.mappings.items()}),
                text=c.text, title=c.title, position=position,
            ))

    def save_definition(self, user: User, did: int, definition: Definition) -> Dashboard:
        current = self.get(user, did, "edit")
        self._check_questions(user, definition, allowed={c["question_id"] for c in current.cards if c.get("question_id")})
        with self.engine.begin() as conn:
            conn.execute(update(dashboards_table).where(dashboards_table.c.id == did).values(
                filters=json.dumps([f.model_dump() for f in definition.filters]),
                tabs=json.dumps([t.model_dump() for t in definition.tabs]),
                settings=json.dumps(definition.settings), updated_at=time.time(), updated_by=user.username,
            ))
            self._write_cards(conn, did, definition.cards)
        return self.get(user, did)

    def update(self, user: User, did: int, **changes: Any) -> Dashboard:
        current = self.get(user, did, "edit")
        snap = self.content.snapshot()
        values: dict[str, Any] = {}
        if "name" in changes:
            values["name"] = _clean_name(changes["name"], 200)
        if "description" in changes:
            values["description"] = (changes["description"] or "").strip() or None
        if "collection_id" in changes and changes["collection_id"] != current.collection_id:
            self.content._require(snap, user, changes["collection_id"], "edit")
            values["collection_id"] = changes["collection_id"]
        if "archived" in changes:
            values["archived"] = bool(changes["archived"])
        if values:
            values.update(updated_at=time.time(), updated_by=user.username)
            with self.engine.begin() as conn:
                conn.execute(update(dashboards_table).where(dashboards_table.c.id == did).values(**values))
        return self.get(user, did)

    def delete(self, user: User, did: int) -> None:
        d = self.get(user, did, "edit")
        if not d.archived:
            raise ContentError("Archive the dashboard first; only archived dashboards can be deleted", 409)
        with self.engine.begin() as conn:
            delete_dashboards(conn, [did])

    def duplicate(self, user: User, did: int, name: str | None, collection_id: int | None) -> Dashboard:
        src = self.get(user, did)
        target = collection_id
        if target is None:
            target = src.collection_id if src.access == "edit" else self.content.personal_collection(user).id
        definition = Definition.model_validate({"filters": src.filters, "tabs": src.tabs, "cards": src.cards, "settings": src.settings})
        # the copy keeps only the questions its new owner can see
        visible = {qid for qid, q in self.card_questions(user, src).items() if q is not None}
        definition.cards = [c for c in definition.cards if c.question_id is None or c.question_id in visible]
        return self.create(user, name=name or f"{src.name} (copy)"[:200], collection_id=target,
                           description=src.description, definition=definition)

    def set_favorite(self, user: User, did: int, on: bool) -> None:
        self.get(user, did)
        with self.engine.begin() as conn:
            conn.execute(delete(favorites_table).where(and_(
                favorites_table.c.user_id == user.id, favorites_table.c.item_type == "dashboard", favorites_table.c.item_id == did,
            )))
            if on:
                conn.execute(insert(favorites_table).values(user_id=user.id, item_type="dashboard", item_id=did, created_at=time.time()))

    def by_import_key(self, key: str) -> int | None:
        with self.engine.connect() as conn:
            return conn.execute(select(dashboards_table.c.id).where(dashboards_table.c.import_key == key)).scalar()


def delete_dashboards(conn: Any, ids: list[int]) -> None:
    if not ids:
        return
    conn.execute(delete(favorites_table).where(favorites_table.c.item_type == "dashboard", favorites_table.c.item_id.in_(ids)))
    conn.execute(delete(dashboard_cards_table).where(dashboard_cards_table.c.dashboard_id.in_(ids)))
    conn.execute(delete(dashboards_table).where(dashboards_table.c.id.in_(ids)))
    forget_items(conn, "dashboard", ids)

