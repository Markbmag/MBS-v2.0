"""Uploaded files ("datasets", roadmap M6): CSV, Excel and Parquet.

An upload is read once, its column types are inferred, and it is kept as Ncode's own
Parquet copy in data/datasets/. The original file is not kept. Datasets live in
collections, like questions, so the same view / edit permissions apply; they are
used as sources of multi-source questions.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from sqlalchemy import delete, func, insert, or_, select, update

from ..appdb import User, users_table
from ..content.store import ContentError, ContentStore, Level, NotFound, Snapshot, _clean_name
from ..content.tables import datasets_table
from .workspace import Workspace, literal, ncode_type, quote, unique_names

Format = Literal["csv", "xlsx", "parquet"]
FILE_RE = re.compile(r"^ds_[0-9a-f]{32}\.parquet$")
EXTENSIONS: dict[str, Format] = {
    ".csv": "csv", ".tsv": "csv", ".txt": "csv", ".xlsx": "xlsx", ".xlsm": "xlsx", ".parquet": "parquet",
}
DELIMITERS = {"auto": None, "comma": ",", "semicolon": ";", "tab": "\t", "pipe": "|"}
ENCODINGS = ("utf-8", "latin-1", "utf-16")
_SIMPLE_TYPES = ("number", "string", "boolean", "date", "datetime", "time")


class IngestError(ValueError):
    """The file cannot be read as asked; shown to the user."""


@dataclass
class IngestOptions:
    delimiter: str = "auto"          # key of DELIMITERS
    header: bool = True              # first row holds the column names
    encoding: str = "utf-8"
    sheet: str | None = None         # Excel: sheet name (default: the first)


@dataclass
class Ingested:
    file: str
    columns: list[dict[str, str]]
    row_count: int
    size_bytes: int


def format_for(filename: str) -> Format:
    ext = Path(filename).suffix.lower()
    if ext == ".xls":
        raise IngestError("Old .xls workbooks cannot be read: save the file as .xlsx or .csv")
    fmt = EXTENSIONS.get(ext)
    if fmt is None:
        raise IngestError("Upload a .csv, .tsv, .xlsx or .parquet file")
    return fmt


def ingest(
    src: Path, fmt: Format, options: IngestOptions, *, dest_dir: Path, max_rows: int, memory_mb: int, threads: int
) -> Ingested:
    """Read an uploaded file into a new Parquet file in dest_dir."""
    if options.delimiter not in DELIMITERS:
        raise IngestError(f"Unknown delimiter {options.delimiter!r}")
    if options.encoding not in ENCODINGS:
        raise IngestError(f"Unknown encoding {options.encoding!r}")
    dest_dir.mkdir(parents=True, exist_ok=True)
    name = f"ds_{uuid.uuid4().hex}.parquet"
    target = dest_dir / name
    # This session reads and writes files, so it never runs SQL written by a user;
    # every value in it is one of the checked options above or a path Ncode made.
    ws = Workspace(memory_mb=memory_mb, threads=threads)
    try:
        if fmt == "csv":
            args = [literal(str(src)), "auto_detect = true", "sample_size = -1", f"header = {'true' if options.header else 'false'}",
                    f"encoding = {literal(options.encoding)}", "null_padding = true"]
            delim = DELIMITERS[options.delimiter]
            if delim is not None:
                args.append(f"delim = {literal(delim)}")
            _create(ws, f"SELECT * FROM read_csv({', '.join(args)}) LIMIT {int(max_rows) + 1}")
        elif fmt == "parquet":
            _create(ws, f"SELECT * FROM read_parquet({literal(str(src))}) LIMIT {int(max_rows) + 1}")
        else:
            names, rows = _read_xlsx(src, options, max_rows)
            ws.load_rows("data", names, rows)
            _dates_without_time(ws)
        rows = ws.count("data")
        if rows > max_rows:
            raise IngestError(f"The file has more than {max_rows:,} rows (the limit for uploads)")
        if rows == 0:
            raise IngestError("The file has no data rows")
        _plain_types(ws)
        ws.execute(f"COPY data TO {literal(str(target))} (FORMAT parquet, COMPRESSION zstd)")
        columns = [{"name": n, "type": ncode_type(t)} for n, t in ws.columns("data")]
    except IngestError:
        target.unlink(missing_ok=True)
        raise
    except Exception as exc:
        target.unlink(missing_ok=True)
        text = str(exc).strip().splitlines()
        raise IngestError(f"Could not read the file: {text[0] if text else type(exc).__name__}"[:500]) from None
    finally:
        ws.close()
    return Ingested(file=name, columns=columns, row_count=rows, size_bytes=target.stat().st_size)


def _create(ws: Workspace, select_sql: str) -> None:
    ws.execute(f"CREATE TABLE data AS {select_sql}")
    # header names exactly as DuckDB read them, made unique case-insensitively
    names = [n for n, _ in ws.columns("data")]
    for old, new in zip(names, unique_names(names)):
        if old != new:
            ws.execute(f"ALTER TABLE data RENAME COLUMN {quote(old)} TO {quote(new)}")


def _plain_types(ws: Workspace) -> None:
    """Lists, structs, blobs ... become text: the builder and the charts work with simple types."""
    for name, type_ in ws.columns("data"):
        if ncode_type(type_) not in _SIMPLE_TYPES:
            ws.execute(f"ALTER TABLE data ALTER {quote(name)} TYPE VARCHAR USING CAST({quote(name)} AS VARCHAR)")


def _dates_without_time(ws: Workspace) -> None:
    """Excel has no date type: date-times that are all at midnight are dates."""
    for name, type_ in ws.columns("data"):
        if type_ == "TIMESTAMP":
            col = quote(name)
            only_dates = ws.execute(
                f"SELECT bool_and(CAST({col} AS TIME) = TIME '00:00:00') FROM data WHERE {col} IS NOT NULL"
            ).fetchone()[0]
            if only_dates:
                ws.execute(f"ALTER TABLE data ALTER {col} TYPE DATE USING CAST({col} AS DATE)")


def _read_xlsx(src: Path, options: IngestOptions, max_rows: int) -> tuple[list[str], list[tuple]]:
    from openpyxl import load_workbook

    try:
        wb = load_workbook(src, read_only=True, data_only=True)
    except Exception as exc:
        raise IngestError(f"Could not open the workbook: {str(exc).splitlines()[0] if str(exc) else type(exc).__name__}") from None
    try:
        if options.sheet:
            if options.sheet not in wb.sheetnames:
                raise IngestError(f"The workbook has no sheet {options.sheet!r} (sheets: {', '.join(wb.sheetnames)})")
            sheet = wb[options.sheet]
        else:
            sheet = wb.worksheets[0]
        header: list[Any] | None = None
        rows: list[tuple] = []
        width = 0
        for raw in sheet.iter_rows(values_only=True):
            if raw is None or all(v is None or (isinstance(v, str) and not v.strip()) for v in raw):
                continue  # empty rows
            values = [v.strip() if isinstance(v, str) else v for v in raw]
            if header is None:
                if options.header:
                    header = values
                    width = max((i + 1 for i, v in enumerate(values) if v not in (None, "")), default=0)
                    continue
                header = []
            width = max(width, max((i + 1 for i, v in enumerate(values) if v not in (None, "")), default=0))
            rows.append(tuple(values))
            if len(rows) > max_rows:
                raise IngestError(f"The sheet has more than {max_rows:,} rows (the limit for uploads)")
    finally:
        wb.close()
    if header is None or width == 0:
        raise IngestError("The sheet is empty")
    names = [str(header[i]) if i < len(header) and header[i] not in (None, "") else f"column_{i + 1}" for i in range(width)]
    fixed = [tuple(_cell(r[i]) if i < len(r) else None for i in range(width)) for r in rows]
    return names, fixed


def _cell(v: Any) -> Any:
    if isinstance(v, str) and v == "":
        return None
    if isinstance(v, dt.timedelta):  # durations: seconds
        return v.total_seconds()
    return v


# ---------------------------------------------------------------- the store

@dataclass
class Dataset:
    id: int
    name: str
    description: str | None
    collection_id: int
    owner: str | None
    archived: bool
    file: str
    columns: list[dict[str, str]]
    row_count: int
    size_bytes: int
    source_name: str | None
    source_format: str
    created_at: float
    updated_at: float
    updated_by: str | None
    access: Level | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        return {
            "id": self.id, "name": self.name, "description": self.description, "collection_id": self.collection_id,
            "collection": self.extra.get("collection"), "owner": self.owner, "archived": self.archived,
            "columns": self.columns, "row_count": self.row_count, "size_bytes": self.size_bytes,
            "source_name": self.source_name, "source_format": self.source_format, "access": self.access,
            "created_at": self.created_at, "updated_at": self.updated_at, "updated_by": self.updated_by,
        }


class DatasetStore:
    def __init__(self, content: ContentStore, directory: Path):
        self.content = content
        self.engine = content.engine
        self.directory = directory

    def path(self, d: Dataset) -> Path:
        if not FILE_RE.match(d.file):  # never follow a name Ncode did not make
            raise ContentError("The dataset's file name is not valid", 500)
        return self.directory / d.file

    def _select(self):
        return select(datasets_table, users_table.c.username.label("owner")).outerjoin(
            users_table, users_table.c.id == datasets_table.c.owner_id
        )

    def _to(self, row: Any, snap: Snapshot, user: User) -> Dataset:
        col = snap.collections.get(row.collection_id)
        try:
            columns = json.loads(row.columns)
        except ValueError:
            columns = []
        return Dataset(
            id=row.id, name=row.name, description=row.description, collection_id=row.collection_id, owner=row.owner,
            archived=bool(row.archived), file=row.file, columns=columns, row_count=row.row_count,
            size_bytes=row.size_bytes, source_name=row.source_name, source_format=row.source_format,
            created_at=row.created_at, updated_at=row.updated_at, updated_by=row.updated_by,
            access=snap.access(user, row.collection_id),
            extra={"collection": {"id": col.id, "name": col.name} if col else None},
        )

    def get(self, user: User, did: int, level: Level = "view") -> Dataset:
        snap = self.content.snapshot()
        with self.engine.connect() as conn:
            row = conn.execute(self._select().where(datasets_table.c.id == did)).first()
        if row is None or snap.access(user, row.collection_id) is None:
            raise NotFound("Dataset")
        self.content._require(snap, user, row.collection_id, level)
        d = self._to(row, snap, user)
        d.extra["path"] = self.content.breadcrumbs(user, snap, d.collection_id)
        return d

    def list(
        self, user: User, *, collection_id: int | None = None, text: str | None = None, archived: bool = False,
        limit: int = 200,
    ) -> list[Dataset]:
        snap = self.content.snapshot()
        stmt = self._select()
        if collection_id is not None:
            self.content._require(snap, user, collection_id, "view")
            stmt = stmt.where(datasets_table.c.collection_id == collection_id)
        if text:
            pattern = f"%{text.strip().lower()}%"
            stmt = stmt.where(or_(
                func.lower(datasets_table.c.name).like(pattern),
                func.lower(func.coalesce(datasets_table.c.description, "")).like(pattern),
                func.lower(func.coalesce(datasets_table.c.source_name, "")).like(pattern),
            ))
        stmt = stmt.where(datasets_table.c.archived.is_(archived)).order_by(datasets_table.c.updated_at.desc())
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

    def check_target(self, user: User, collection_id: int) -> None:
        self.content._require(self.content.snapshot(), user, collection_id, "edit")

    def create(
        self, user: User, *, name: str, description: str | None, collection_id: int, ingested: Ingested,
        source_name: str | None, source_format: str,
    ) -> Dataset:
        self.check_target(user, collection_id)
        now = time.time()
        with self.engine.begin() as conn:
            did = int(conn.execute(insert(datasets_table).values(
                name=_clean_name(name, 200), description=(description or "").strip() or None,
                collection_id=collection_id, owner_id=user.id, archived=False, file=ingested.file,
                columns=json.dumps(ingested.columns), row_count=ingested.row_count, size_bytes=ingested.size_bytes,
                source_name=(source_name or "")[:255] or None, source_format=source_format,
                created_at=now, updated_at=now, updated_by=user.username,
            )).inserted_primary_key[0])
        return self.get(user, did)

    def update(self, user: User, did: int, **changes: Any) -> Dataset:
        current = self.get(user, did, "edit")
        values: dict[str, Any] = {}
        if "name" in changes and changes["name"] is not None:
            values["name"] = _clean_name(changes["name"], 200)
        if "description" in changes:
            values["description"] = (changes["description"] or "").strip() or None
        if changes.get("collection_id") is not None and changes["collection_id"] != current.collection_id:
            self.check_target(user, changes["collection_id"])
            values["collection_id"] = changes["collection_id"]
        if changes.get("archived") is not None:
            values["archived"] = bool(changes["archived"])
        if values:
            values.update(updated_at=time.time(), updated_by=user.username)
            with self.engine.begin() as conn:
                conn.execute(update(datasets_table).where(datasets_table.c.id == did).values(**values))
        return self.get(user, did)

    def delete(self, user: User, did: int) -> None:
        d = self.get(user, did, "edit")
        if not d.archived:
            raise ContentError("Archive the dataset first; only archived datasets can be deleted", 409)
        with self.engine.begin() as conn:
            conn.execute(delete(datasets_table).where(datasets_table.c.id == did))
        remove_files(self.directory, [d.file])


def remove_files(directory: Path, files: list[str]) -> None:
    for name in files:
        if FILE_RE.match(name):
            try:
                os.remove(directory / name)
            except OSError:
                pass  # already gone
