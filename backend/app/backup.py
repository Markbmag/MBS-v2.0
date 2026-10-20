"""Backups of Ncode's own data (roadmap M9).

A backup is one zip file:

    ncode.sqlite      a consistent copy of the app database (SQLite's online backup, safe while running)
    datasets/...      the uploaded files (Parquet)
    manifest.json     when, which schema version, what is inside

The encryption key (backend/data/secret.key or NCODE_SECRET_KEY) is NOT in it: keep it apart.
Without it, saved database passwords, the email password and webhook addresses cannot be
read after a restore (everything else works).

Backups are made on request (Admin → Backups, `python -m app.manage backup`) and, when
NCODE_BACKUP_HOUR is set (default 02:00 server time), once a day; the newest NCODE_BACKUP_KEEP
(default 7) automatic ones are kept. Restoring is done with the server stopped:
`python -m app.manage restore <file.zip>`.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import sqlite3
import tempfile
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger("ncode.backup")
NAME_RE = re.compile(r"^ncode-backup-\d{8}-\d{6}(-auto)?\.zip$")


class BackupError(Exception):
    """A backup or restore problem; the message is safe to show."""


def backups_dir(app_db_path: Path) -> Path:
    return app_db_path.parent / "backups"


def datasets_dir(app_db_path: Path) -> Path:
    return app_db_path.parent / "datasets"


def make_backup(app_db_path: Path, *, auto: bool = False, out_dir: Path | None = None) -> Path:
    out_dir = out_dir or backups_dir(app_db_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = out_dir / f"ncode-backup-{stamp}{'-auto' if auto else ''}.zip"
    n = 1
    while target.exists():  # two in the same second
        n += 1
        target = out_dir / f"ncode-backup-{stamp}{'-auto' if auto else ''}.zip".replace(".zip", f"-{n}.zip")
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "ncode.sqlite"
        src = sqlite3.connect(app_db_path)
        dst = sqlite3.connect(copy)
        try:
            src.backup(dst)  # consistent even while the app writes
            revision = _revision(dst)
        finally:
            dst.close()
            src.close()
        files = 0
        partial = target.with_suffix(".zip.part")
        with zipfile.ZipFile(partial, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(copy, "ncode.sqlite")
            data = datasets_dir(app_db_path)
            if data.is_dir():
                for f in sorted(data.rglob("*")):
                    if f.is_file():
                        zf.write(f, f"datasets/{f.relative_to(data).as_posix()}")
                        files += 1
            zf.writestr("manifest.json", json.dumps({
                "created_at": time.time(), "schema_revision": revision, "datasets": files, "auto": auto,
                "note": "The encryption key (secret.key / NCODE_SECRET_KEY) is not included: keep it apart.",
            }, indent=2))
        os.replace(partial, target)
    logger.info("backup written: %s", target)
    return target


def _revision(conn: sqlite3.Connection) -> str | None:
    try:
        row = conn.execute("SELECT version_num FROM alembic_version").fetchone()
        return row[0] if row else None
    except sqlite3.Error:
        return None


def list_backups(app_db_path: Path) -> list[dict[str, Any]]:
    folder = backups_dir(app_db_path)
    if not folder.is_dir():
        return []
    out = []
    for f in sorted(folder.glob("ncode-backup-*.zip"), reverse=True):
        st = f.stat()
        out.append({"name": f.name, "size": st.st_size, "created_at": st.st_mtime, "auto": "-auto" in f.name})
    return out


def backup_path(app_db_path: Path, name: str) -> Path:
    if not NAME_RE.match(name) and not re.match(r"^ncode-backup-\d{8}-\d{6}(-auto)?-\d+\.zip$", name):
        raise BackupError("No such backup")
    path = backups_dir(app_db_path) / name
    if not path.is_file():
        raise BackupError("No such backup")
    return path


def prune(app_db_path: Path, keep: int) -> list[str]:
    """Delete automatic backups beyond the newest `keep` (ones made by hand stay)."""
    autos = [b for b in list_backups(app_db_path) if b["auto"]]
    removed = []
    for b in autos[keep:]:
        (backups_dir(app_db_path) / b["name"]).unlink(missing_ok=True)
        removed.append(b["name"])
    return removed


def restore(zip_path: Path, app_db_path: Path) -> dict[str, Any]:
    """Replace the app database and uploaded files with the backup's (the server must be stopped).
    The current ones are kept next to them as *.before-restore-<time>."""
    if not zip_path.is_file():
        raise BackupError(f"{zip_path} does not exist")
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        if "ncode.sqlite" not in names or "manifest.json" not in names:
            raise BackupError("This is not an Ncode backup (ncode.sqlite / manifest.json missing)")
        for n in names:  # no absolute paths or ".." in the archive
            if n.startswith("/") or ".." in Path(n).parts:
                raise BackupError(f"Unsafe path in the backup: {n}")
        manifest = json.loads(zf.read("manifest.json"))
        with tempfile.TemporaryDirectory() as tmp:
            zf.extractall(tmp)
            restored_db = Path(tmp) / "ncode.sqlite"
            check = sqlite3.connect(restored_db)
            try:
                ok = check.execute("PRAGMA integrity_check").fetchone()[0]
            finally:
                check.close()
            if ok != "ok":
                raise BackupError(f"The database in the backup is damaged: {ok}")
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            app_db_path.parent.mkdir(parents=True, exist_ok=True)
            if app_db_path.exists():
                shutil.move(str(app_db_path), f"{app_db_path}.before-restore-{stamp}")
            shutil.copy2(restored_db, app_db_path)
            data = datasets_dir(app_db_path)
            if data.exists():
                shutil.move(str(data), f"{data}.before-restore-{stamp}")
            src = Path(tmp) / "datasets"
            if src.is_dir():
                shutil.copytree(src, data)
    return manifest


class AutoBackup:
    """Called by the scheduler's loop: one automatic backup a day at `hour` (server time)."""

    def __init__(self, app_db_path: Path, hour: int, keep: int):
        self.path, self.hour, self.keep = app_db_path, hour, keep

    def last(self) -> float | None:
        autos = [b for b in list_backups(self.path) if b["auto"]]
        return autos[0]["created_at"] if autos else None

    def tick(self, now: float | None = None) -> Path | None:
        if self.hour < 0:
            return None
        now = time.time() if now is None else now
        if datetime.fromtimestamp(now).hour != self.hour:
            return None
        last = self.last()
        if last is not None and now - last < 20 * 3600:
            return None
        try:
            made = make_backup(self.path, auto=True)
            prune(self.path, self.keep)
            return made
        except Exception:
            logger.exception("automatic backup failed")
            return None
