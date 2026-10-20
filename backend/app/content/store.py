"""Collections, saved questions, permissions and favourites, with the access rules.

Who may do what with a collection (and everything in it):

* Admins: everything.
* A personal collection ("alice's collection") and whatever is inside it belong to
  that user alone. Grants are not possible there.
* The owner of a collection - or of any collection above it - may view, edit and
  manage it (rename, move, archive, delete, share).
* Everyone else gets the strongest grant ("view" or "edit") given on the collection
  or on a collection above it, to them by name or to their role ("all" = every
  signed-in user). Editors can save, move and archive questions; they cannot share
  or move the collection itself, so an editor can never take access away from the
  people who shared it with them.

Questions follow the collection they are in. Running one also needs access to its
database connection (checked by the API, not here).
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Iterable, Literal

from sqlalchemy import and_, delete, func, insert, or_, select, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from ..appdb import User, groups_table, users_table
from .tables import (
    collections_table, dashboard_cards_table, dashboards_table, datasets_table, favorites_table, permissions_table,
    questions_table, share_links_table, subscription_runs_table, subscriptions_table,
)

Level = Literal["view", "edit"]
_RANK = {None: 0, "view": 1, "edit": 2}
ROLES = ("all", "user", "admin")
MAX_DEPTH = 12


class ContentError(Exception):
    """A request that cannot be done; `status` is the HTTP status the API answers with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class NotFound(ContentError):
    def __init__(self, what: str):
        super().__init__(f"{what} not found", 404)


@dataclass(frozen=True)
class Collection:
    id: int
    name: str
    description: str | None
    parent_id: int | None
    owner_id: int | None
    personal_owner_id: int | None
    archived: bool
    created_at: float
    updated_at: float

    @property
    def personal(self) -> bool:
        return self.personal_owner_id is not None


@dataclass(frozen=True)
class Grant:
    collection_id: int
    user_id: int | None
    role: str | None
    level: Level
    group_id: int | None = None  # M9


@dataclass
class Question:
    id: int
    name: str
    description: str | None
    collection_id: int
    connection: str
    kind: str
    spec: dict[str, Any]
    viz: dict[str, Any] | None
    parameters: list[dict[str, Any]]
    owner_id: int | None
    owner: str | None
    archived: bool
    import_key: str | None
    created_at: float
    updated_at: float
    updated_by: str | None
    favorite: bool = False
    model: bool = False
    access: Level | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class Snapshot:
    """Every collection and grant, read once per request (both tables stay small)."""

    def __init__(self, collections: Iterable[Collection], grants: Iterable[Grant]):
        self.collections = {c.id: c for c in collections}
        self.grants: dict[int, list[Grant]] = {}
        for g in grants:
            self.grants.setdefault(g.collection_id, []).append(g)

    def get(self, cid: int) -> Collection:
        col = self.collections.get(cid)
        if col is None:
            raise NotFound("Collection")
        return col

    def chain(self, cid: int | None) -> list[Collection]:
        """The collection and its ancestors, nearest first."""
        out: list[Collection] = []
        seen: set[int] = set()
        node = self.collections.get(cid) if cid is not None else None
        while node is not None and node.id not in seen:
            seen.add(node.id)
            out.append(node)
            node = self.collections.get(node.parent_id) if node.parent_id is not None else None
        return out

    def personal_root(self, cid: int) -> Collection | None:
        return next((c for c in self.chain(cid) if c.personal), None)

    def access(self, user: User, cid: int) -> Level | None:
        if user.is_admin:
            return "edit"
        chain = self.chain(cid)
        personal = next((c for c in chain if c.personal), None)
        if personal is not None:
            return "edit" if personal.personal_owner_id == user.id else None
        best: Level | None = None
        for node in chain:
            if node.owner_id is not None and node.owner_id == user.id:
                return "edit"
            for g in self.grants.get(node.id, ()):
                if (
                    (g.user_id is not None and g.user_id == user.id)
                    or (g.role is not None and g.role in ("all", user.role))
                    or (g.group_id is not None and g.group_id in user.group_ids)
                ):
                    if _RANK[g.level] > _RANK[best]:
                        best = g.level
        return best

    def can_manage(self, user: User, cid: int) -> bool:
        """Rename, move, archive, delete and share the collection itself."""
        if user.is_admin:
            return True
        chain = self.chain(cid)
        personal = next((c for c in chain if c.personal), None)
        if personal is not None:
            return personal.personal_owner_id == user.id and not self.get(cid).personal
        return any(n.owner_id is not None and n.owner_id == user.id for n in chain)

    def hidden(self, cid: int) -> bool:
        """Archived itself or inside an archived collection."""
        return any(c.archived for c in self.chain(cid))

    def descendants(self, cid: int) -> list[int]:
        children: dict[int, list[int]] = {}
        for c in self.collections.values():
            if c.parent_id is not None:
                children.setdefault(c.parent_id, []).append(c.id)
        out, todo = [], [cid]
        while todo:
            current = todo.pop()
            out.append(current)
            todo.extend(children.get(current, []))
        return out


def _collection(row: Any) -> Collection:
    return Collection(
        id=row.id, name=row.name, description=row.description, parent_id=row.parent_id,
        owner_id=row.owner_id, personal_owner_id=row.personal_owner_id, archived=bool(row.archived),
        created_at=row.created_at, updated_at=row.updated_at,
    )


def _question(row: Any) -> Question:
    return Question(
        id=row.id, name=row.name, description=row.description, collection_id=row.collection_id,
        connection=row.connection, kind=row.kind, spec=json.loads(row.spec),
        viz=json.loads(row.viz) if row.viz else None, parameters=json.loads(row.parameters or "[]"),
        owner_id=row.owner_id, owner=row.owner, archived=bool(row.archived), import_key=row.import_key,
        model=bool(getattr(row, "model", False)),
        created_at=row.created_at, updated_at=row.updated_at, updated_by=row.updated_by,
    )


def _clean_name(name: str, limit: int) -> str:
    name = (name or "").strip()
    if not name:
        raise ContentError("A name is required")
    if len(name) > limit:
        raise ContentError(f"Names are limited to {limit} characters")
    return name


class ContentStore:
    def __init__(self, engine: Engine):
        self.engine = engine
        self.on_files_deleted: Any = None  # set by app/federation: removes uploaded files of deleted datasets

    # ------------------------------------------------------------------ snapshot
    def snapshot(self) -> Snapshot:
        with self.engine.connect() as conn:
            cols = [_collection(r) for r in conn.execute(select(collections_table)).all()]
            grants = [
                Grant(r.collection_id, r.user_id, r.role, r.level, r.group_id)
                for r in conn.execute(select(permissions_table)).all()
            ]
        return Snapshot(cols, grants)

    def _require(self, snap: Snapshot, user: User, cid: int, level: Level) -> Collection:
        col = snap.get(cid)
        got = snap.access(user, cid)
        if got is None:
            raise NotFound("Collection")  # don't reveal collections the user cannot see
        if _RANK[got] < _RANK[level]:
            raise ContentError("You can only view this collection", 403)
        return col

    def _require_manage(self, snap: Snapshot, user: User, cid: int) -> Collection:
        col = self._require(snap, user, cid, "view")
        if not snap.can_manage(user, cid):
            raise ContentError("Only the owner of this collection (or an admin) can do that", 403)
        return col

    # ------------------------------------------------------------------ collections
    def personal_collection(self, user: User) -> Collection:
        """The user's own collection, created on first use."""
        with self.engine.begin() as conn:
            row = conn.execute(
                select(collections_table).where(collections_table.c.personal_owner_id == user.id)
            ).first()
            if row is None:
                now = time.time()
                try:
                    conn.execute(
                        insert(collections_table).values(
                            name=f"{user.username}'s collection", owner_id=user.id, personal_owner_id=user.id,
                            archived=False, created_at=now, updated_at=now,
                        )
                    )
                except IntegrityError:  # created by a parallel request
                    pass
                row = conn.execute(
                    select(collections_table).where(collections_table.c.personal_owner_id == user.id)
                ).first()
        return _collection(row)

    def visible_collections(self, user: User, snap: Snapshot | None = None) -> list[dict[str, Any]]:
        """Collections the user can see (not archived), as a flat tree.

        `parent_id` points at the nearest *visible* ancestor, so a collection shared
        on its own (without its parent) shows up at the top level.
        """
        personal = self.personal_collection(user)
        snap = snap or self.snapshot()
        visible = {
            c.id: c for c in snap.collections.values()
            if not snap.hidden(c.id) and snap.access(user, c.id) is not None
        }
        out = []
        for c in visible.values():
            parent = next((a.id for a in snap.chain(c.id)[1:] if a.id in visible), None)
            out.append(self.describe(c, snap, user, parent_id=parent, mine=c.id == personal.id))
        out.sort(key=lambda c: (not c["mine"], c["personal"], c["name"].lower()))
        return out

    def describe(
        self, c: Collection, snap: Snapshot, user: User, *, parent_id: int | None = None, mine: bool | None = None
    ) -> dict[str, Any]:
        return {
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "parent_id": parent_id if parent_id is not None or mine is not None else c.parent_id,
            "personal": c.personal,
            "mine": bool(mine) if mine is not None else c.personal_owner_id == user.id,
            "archived": c.archived,
            "access": snap.access(user, c.id),
            "can_manage": snap.can_manage(user, c.id),
            "shared": bool(any(snap.grants.get(a.id) for a in snap.chain(c.id))),
            "updated_at": c.updated_at,
        }

    def get_collection(self, user: User, cid: int) -> tuple[Collection, Snapshot]:
        snap = self.snapshot()
        return self._require(snap, user, cid, "view"), snap

    def breadcrumbs(self, user: User, snap: Snapshot, cid: int) -> list[dict[str, Any]]:
        chain = [c for c in reversed(snap.chain(cid)) if snap.access(user, c.id) is not None]
        return [{"id": c.id, "name": c.name} for c in chain]

    def create_collection(
        self, user: User, name: str, description: str | None = None, parent_id: int | None = None
    ) -> Collection:
        name = _clean_name(name, 120)
        snap = self.snapshot()
        if parent_id is not None:
            self._require(snap, user, parent_id, "edit")
            if len(snap.chain(parent_id)) >= MAX_DEPTH:
                raise ContentError(f"Collections can be nested at most {MAX_DEPTH} levels deep")
        now = time.time()
        with self.engine.begin() as conn:
            cid = conn.execute(
                insert(collections_table).values(
                    name=name, description=(description or "").strip() or None, parent_id=parent_id,
                    owner_id=user.id, archived=False, created_at=now, updated_at=now,
                )
            ).inserted_primary_key[0]
        return self.snapshot().get(int(cid))

    def update_collection(self, user: User, cid: int, **changes: Any) -> Collection:
        snap = self.snapshot()
        col = snap.get(cid)
        values: dict[str, Any] = {}
        if "name" in changes or "description" in changes:
            self._require(snap, user, cid, "edit")
            if col.personal:
                raise ContentError("A personal collection cannot be renamed")
            if "name" in changes:
                values["name"] = _clean_name(changes["name"], 120)
            if "description" in changes:
                values["description"] = (changes["description"] or "").strip() or None
        if "parent_id" in changes:
            self._require_manage(snap, user, cid)
            if col.personal:
                raise ContentError("A personal collection cannot be moved")
            target = changes["parent_id"]
            if target is not None:
                self._require(snap, user, target, "edit")
                if cid in [c.id for c in snap.chain(target)]:
                    raise ContentError("A collection cannot be moved into itself")
                depth = len(snap.chain(target)) + max(len(snap.chain(d)) - len(snap.chain(cid)) + 1 for d in snap.descendants(cid))
                if depth > MAX_DEPTH:
                    raise ContentError(f"Collections can be nested at most {MAX_DEPTH} levels deep")
            values["parent_id"] = target
        if "archived" in changes:
            self._require_manage(snap, user, cid)
            if col.personal:
                raise ContentError("A personal collection cannot be archived")
            values["archived"] = bool(changes["archived"])
        if not values:
            return col
        values["updated_at"] = time.time()
        with self.engine.begin() as conn:
            conn.execute(update(collections_table).where(collections_table.c.id == cid).values(**values))
        return self.snapshot().get(cid)

    def delete_collection(self, user: User, cid: int) -> int:
        """Delete an archived collection with everything in it. Returns the number of questions removed."""
        snap = self.snapshot()
        col = self._require_manage(snap, user, cid)
        if not col.archived:
            raise ContentError("Archive the collection first; only archived collections can be deleted", 409)
        ids = snap.descendants(cid)
        with self.engine.begin() as conn:
            qids = [r.id for r in conn.execute(select(questions_table.c.id).where(questions_table.c.collection_id.in_(ids)))]
            if qids:
                conn.execute(delete(favorites_table).where(favorites_table.c.item_type == "question", favorites_table.c.item_id.in_(qids)))
                # cards elsewhere that showed these questions say "deleted" from now on
                conn.execute(update(dashboard_cards_table).where(dashboard_cards_table.c.question_id.in_(qids)).values(question_id=None))
                conn.execute(delete(questions_table).where(questions_table.c.id.in_(qids)))
                forget_items(conn, "question", qids)
            dids = [r.id for r in conn.execute(select(dashboards_table.c.id).where(dashboards_table.c.collection_id.in_(ids)))]
            if dids:
                conn.execute(delete(favorites_table).where(favorites_table.c.item_type == "dashboard", favorites_table.c.item_id.in_(dids)))
                conn.execute(delete(dashboard_cards_table).where(dashboard_cards_table.c.dashboard_id.in_(dids)))
                conn.execute(delete(dashboards_table).where(dashboards_table.c.id.in_(dids)))
                forget_items(conn, "dashboard", dids)
            files = [r.file for r in conn.execute(select(datasets_table.c.file).where(datasets_table.c.collection_id.in_(ids)))]
            conn.execute(delete(datasets_table).where(datasets_table.c.collection_id.in_(ids)))
            conn.execute(delete(permissions_table).where(permissions_table.c.collection_id.in_(ids)))
            # children first: parent_id is a foreign key
            for dead in sorted(ids, key=lambda i: -len(snap.chain(i))):
                conn.execute(delete(collections_table).where(collections_table.c.id == dead))
        if files and self.on_files_deleted is not None:
            self.on_files_deleted(files)
        return len(qids)

    # ------------------------------------------------------------------ permissions
    def grants(self, user: User, cid: int) -> list[dict[str, Any]]:
        snap = self.snapshot()
        self._require_manage(snap, user, cid)
        names = self._usernames()
        groups = self._groupnames()
        out = []
        for node in snap.chain(cid):
            for g in snap.grants.get(node.id, ()):
                out.append({
                    "user": names.get(g.user_id) if g.user_id is not None else None,
                    "group": groups.get(g.group_id) if g.group_id is not None else None,
                    "role": g.role,
                    "level": g.level,
                    "inherited_from": None if node.id == cid else {"id": node.id, "name": node.name},
                })
        return out

    def set_grants(self, user: User, cid: int, grants: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Replace the grants made on this collection (inherited ones are untouched)."""
        snap = self.snapshot()
        self._require_manage(snap, user, cid)
        if snap.personal_root(cid) is not None:
            raise ContentError("Personal collections cannot be shared; move the questions to a shared collection")
        ids = {name: uid for uid, name in self._usernames().items()}
        group_ids = {name.lower(): gid for gid, name in self._groupnames().items()}
        rows: dict[tuple[int | None, str | None, int | None], str] = {}
        for g in grants:
            level = g.get("level")
            if level not in ("view", "edit"):
                raise ContentError("level must be 'view' or 'edit'")
            if sum(g.get(k) is not None for k in ("user", "role", "group")) != 1:
                raise ContentError("each grant names one user, group or role")
            if g.get("user") is not None:
                uid = ids.get(str(g["user"]).lower())
                if uid is None:
                    raise ContentError(f"Unknown user {g['user']!r}")
                key: tuple[int | None, str | None, int | None] = (uid, None, None)
            elif g.get("group") is not None:
                gid = group_ids.get(str(g["group"]).lower())
                if gid is None:
                    raise ContentError(f"Unknown group {g['group']!r}")
                key = (None, None, gid)
            else:
                if g["role"] not in ROLES:
                    raise ContentError(f"role must be one of {', '.join(ROLES)}")
                key = (None, g["role"], None)
            if _RANK[level] > _RANK[rows.get(key)]:
                rows[key] = level
        with self.engine.begin() as conn:
            conn.execute(delete(permissions_table).where(permissions_table.c.collection_id == cid))
            for (uid, role, gid), level in rows.items():
                conn.execute(insert(permissions_table).values(collection_id=cid, user_id=uid, role=role, group_id=gid, level=level))
            conn.execute(update(collections_table).where(collections_table.c.id == cid).values(updated_at=time.time()))
        return self.grants(user, cid)

    def _groupnames(self) -> dict[int, str]:
        with self.engine.connect() as conn:
            return {r.id: r.name for r in conn.execute(select(groups_table.c.id, groups_table.c.name))}

    def _usernames(self) -> dict[int, str]:
        with self.engine.connect() as conn:
            return {r.id: r.username for r in conn.execute(select(users_table.c.id, users_table.c.username))}

    # ------------------------------------------------------------------ questions
    def _question_select(self, user: User):
        fav = (
            select(func.count())
            .select_from(favorites_table)
            .where(
                favorites_table.c.user_id == user.id,
                favorites_table.c.item_type == "question",
                favorites_table.c.item_id == questions_table.c.id,
            )
            .scalar_subquery()
        )
        return select(questions_table, users_table.c.username.label("owner"), fav.label("fav")).outerjoin(
            users_table, users_table.c.id == questions_table.c.owner_id
        )

    def _with_meta(self, rows: Iterable[Any], snap: Snapshot, user: User) -> list[Question]:
        out = []
        for row in rows:
            q = _question(row)
            q.favorite = bool(row.fav)
            q.access = snap.access(user, q.collection_id)
            if q.access is None:
                continue
            col = snap.collections.get(q.collection_id)
            q.extra = {"collection": {"id": col.id, "name": col.name} if col else None}
            out.append(q)
        return out

    def get_question(self, user: User, qid: int, level: Level = "view") -> Question:
        snap = self.snapshot()
        with self.engine.connect() as conn:
            row = conn.execute(self._question_select(user).where(questions_table.c.id == qid)).first()
        if row is None or snap.access(user, row.collection_id) is None:
            raise NotFound("Question")
        self._require(snap, user, row.collection_id, level)
        q = self._with_meta([row], snap, user)[0]
        q.extra["path"] = self.breadcrumbs(user, snap, q.collection_id)
        return q

    def list_questions(
        self,
        user: User,
        *,
        collection_id: int | None = None,
        text: str | None = None,
        favorites: bool = False,
        archived: bool = False,
        limit: int = 200,
    ) -> list[Question]:
        snap = self.snapshot()
        stmt = self._question_select(user)
        if collection_id is not None:
            self._require(snap, user, collection_id, "view")
            stmt = stmt.where(questions_table.c.collection_id == collection_id)
        if text:
            pattern = f"%{text.strip().lower()}%"
            stmt = stmt.where(
                or_(func.lower(questions_table.c.name).like(pattern), func.lower(func.coalesce(questions_table.c.description, "")).like(pattern))
            )
        if favorites:
            stmt = stmt.where(
                questions_table.c.id.in_(
                    select(favorites_table.c.item_id).where(
                        favorites_table.c.user_id == user.id, favorites_table.c.item_type == "question"
                    )
                )
            )
        stmt = stmt.where(questions_table.c.archived.is_(archived))
        stmt = stmt.order_by(questions_table.c.updated_at.desc())
        with self.engine.connect() as conn:
            rows = conn.execute(stmt).all()
        out = []
        for q in self._with_meta(rows, snap, user):
            # an archived collection hides what is in it (unless we are listing the archive)
            if not archived and collection_id is None and snap.hidden(q.collection_id):
                continue
            out.append(q)
            if len(out) >= limit:
                break
        return out

    def archived_collections(self, user: User) -> list[dict[str, Any]]:
        snap = self.snapshot()
        return [
            self.describe(c, snap, user)
            for c in sorted(snap.collections.values(), key=lambda c: -c.updated_at)
            if c.archived and snap.access(user, c.id) is not None
        ]

    def create_question(
        self,
        user: User,
        *,
        name: str,
        collection_id: int,
        connection: str,
        kind: str,
        spec: dict[str, Any],
        viz: dict[str, Any] | None = None,
        parameters: list[dict[str, Any]] | None = None,
        description: str | None = None,
        import_key: str | None = None,
    ) -> Question:
        snap = self.snapshot()
        self._require(snap, user, collection_id, "edit")
        now = time.time()
        with self.engine.begin() as conn:
            qid = conn.execute(
                insert(questions_table).values(
                    name=_clean_name(name, 200), description=(description or "").strip() or None,
                    collection_id=collection_id, connection=connection, kind=kind,
                    spec=json.dumps(spec), viz=json.dumps(viz) if viz is not None else None,
                    parameters=json.dumps(parameters or []), owner_id=user.id, archived=False,
                    import_key=import_key, created_at=now, updated_at=now, updated_by=user.username,
                )
            ).inserted_primary_key[0]
        return self.get_question(user, int(qid))

    def update_question(self, user: User, qid: int, **changes: Any) -> Question:
        current = self.get_question(user, qid, "edit")
        snap = self.snapshot()
        values: dict[str, Any] = {}
        if "name" in changes:
            values["name"] = _clean_name(changes["name"], 200)
        if "description" in changes:
            values["description"] = (changes["description"] or "").strip() or None
        if "collection_id" in changes and changes["collection_id"] != current.collection_id:
            self._require(snap, user, changes["collection_id"], "edit")
            values["collection_id"] = changes["collection_id"]
        for key in ("spec", "viz", "parameters"):
            if key in changes:
                values[key] = json.dumps(changes[key]) if changes[key] is not None else (None if key == "viz" else "[]")
        if "connection" in changes:
            values["connection"] = changes["connection"]
        if "kind" in changes:
            values["kind"] = changes["kind"]
        if "archived" in changes:
            values["archived"] = bool(changes["archived"])
        if changes.get("model") is not None:
            values["model"] = bool(changes["model"])
        if values:
            values.update(updated_at=time.time(), updated_by=user.username)
            with self.engine.begin() as conn:
                conn.execute(update(questions_table).where(questions_table.c.id == qid).values(**values))
        return self.get_question(user, qid)

    def delete_question(self, user: User, qid: int) -> None:
        q = self.get_question(user, qid, "edit")
        if not q.archived:
            raise ContentError("Archive the question first; only archived questions can be deleted", 409)
        with self.engine.begin() as conn:
            conn.execute(delete(favorites_table).where(favorites_table.c.item_type == "question", favorites_table.c.item_id == qid))
            conn.execute(update(dashboard_cards_table).where(dashboard_cards_table.c.question_id == qid).values(question_id=None))
            conn.execute(delete(questions_table).where(questions_table.c.id == qid))
            forget_items(conn, "question", [qid])

    def question_by_import_key(self, key: str) -> int | None:
        with self.engine.connect() as conn:
            return conn.execute(select(questions_table.c.id).where(questions_table.c.import_key == key)).scalar()

    # ------------------------------------------------------------------ favourites
    def set_favorite(self, user: User, qid: int, on: bool) -> None:
        self.get_question(user, qid)  # must be visible
        with self.engine.begin() as conn:
            conn.execute(
                delete(favorites_table).where(
                    and_(favorites_table.c.user_id == user.id, favorites_table.c.item_type == "question", favorites_table.c.item_id == qid)
                )
            )
            if on:
                conn.execute(
                    insert(favorites_table).values(user_id=user.id, item_type="question", item_id=qid, created_at=time.time())
                )


def forget_items(conn: Any, target_type: str, ids: list[int]) -> None:
    """Inside the transaction that deletes questions or dashboards: their subscriptions,
    alerts and public links go too (M8)."""
    if not ids:
        return
    subs = select(subscriptions_table.c.id).where(
        subscriptions_table.c.target_type == target_type, subscriptions_table.c.target_id.in_(ids)
    )
    conn.execute(delete(subscription_runs_table).where(subscription_runs_table.c.subscription_id.in_(subs)))
    conn.execute(delete(subscriptions_table).where(
        subscriptions_table.c.target_type == target_type, subscriptions_table.c.target_id.in_(ids)
    ))
    conn.execute(delete(share_links_table).where(
        share_links_table.c.target_type == target_type, share_links_table.c.target_id.in_(ids)
    ))


def forget_user(conn: Any, user_id: int, username: str) -> None:
    """Called inside the transaction that deletes a user: content stays, the user's traces go.

    Ids can be reused by a later user, so nothing may keep pointing at the old id: the
    personal collection becomes an ordinary admin-only collection.
    """
    conn.execute(delete(favorites_table).where(favorites_table.c.user_id == user_id))
    conn.execute(delete(permissions_table).where(permissions_table.c.user_id == user_id))
    conn.execute(
        update(collections_table)
        .where(collections_table.c.personal_owner_id == user_id)
        .values(personal_owner_id=None, name=f"{username}'s collection (deleted user)"[:120])
    )
    conn.execute(update(collections_table).where(collections_table.c.owner_id == user_id).values(owner_id=None))
    conn.execute(update(questions_table).where(questions_table.c.owner_id == user_id).values(owner_id=None))
    conn.execute(update(dashboards_table).where(dashboards_table.c.owner_id == user_id).values(owner_id=None))
    conn.execute(update(datasets_table).where(datasets_table.c.owner_id == user_id).values(owner_id=None))
    # what ran or was shared in the user's name stops (it would run with their permissions)
    subs = select(subscriptions_table.c.id).where(subscriptions_table.c.owner_id == user_id)
    conn.execute(delete(subscription_runs_table).where(subscription_runs_table.c.subscription_id.in_(subs)))
    conn.execute(delete(subscriptions_table).where(subscriptions_table.c.owner_id == user_id))
    conn.execute(update(share_links_table).where(
        share_links_table.c.created_by == username, share_links_table.c.revoked_at.is_(None)
    ).values(revoked_at=time.time()))
