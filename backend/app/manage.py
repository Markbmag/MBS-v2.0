"""User administration. Run from the backend folder:

    python -m app.manage create-user alice                 # regular user, all databases
    python -m app.manage create-user bob --admin
    python -m app.manage create-user carol --connections mes,les
    python -m app.manage list-users
    python -m app.manage set-password alice
    python -m app.manage allow alice mes,les               # or:  allow alice "*"
    python -m app.manage disable alice                     # also logs the user out
    python -m app.manage enable alice
    python -m app.manage delete-user alice
    python -m app.manage audit --limit 50                  # who searched what
    python -m app.manage generate-key                      # a new NCODE_SECRET_KEY value
    python -m app.manage import-datadesk app-data.sqlite --map db1=mes,db2=crm --dry-run
"""

from __future__ import annotations

import argparse
import getpass
from pathlib import Path
import re
import sys
from datetime import datetime

from .crypto import generate_key
from .appdb import AppDB, format_allowed, parse_allowed, resolve_app_db_path
from .config import ConfigError, init_environment, load_connections, load_settings
from .security import MIN_PASSWORD_LENGTH, hash_password

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,63}$")


def _fail(message: str) -> None:
    print(f"Error: {message}", file=sys.stderr)
    sys.exit(1)


def _ask_password() -> str:
    first = getpass.getpass("Password: ")
    if len(first) < MIN_PASSWORD_LENGTH:
        _fail(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    if getpass.getpass("Repeat password: ") != first:
        _fail("passwords do not match")
    return first


def _check_username(name: str) -> str:
    name = name.strip().lower()
    if not USERNAME_RE.match(name):
        _fail("username must be 3-64 chars: letters, digits, dot, dash, underscore")
    return name


def _check_connections(raw: str, known: set[str]) -> tuple[str, ...] | None:
    allowed = parse_allowed(raw)
    if allowed is not None:
        unknown = [k for k in allowed if k not in known]
        if unknown:
            print(f"Warning: not configured in .env right now: {', '.join(unknown)}", file=sys.stderr)
    return allowed


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.manage", description="Ncode user administration")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("create-user")
    p.add_argument("username")
    p.add_argument("--admin", action="store_true", help="admins see every connection and every task")
    p.add_argument("--connections", default="*", help='comma-separated connection keys, or "*" (default)')
    sub.add_parser("list-users")
    sub.add_parser("set-password").add_argument("username")
    p = sub.add_parser("allow")
    p.add_argument("username")
    p.add_argument("connections", help='comma-separated connection keys, or "*"')
    p = sub.add_parser("set-email", help="the address subscriptions and alerts are sent to (\"\" removes it)")
    p.add_argument("username")
    p.add_argument("email")
    sub.add_parser("disable").add_argument("username")
    sub.add_parser("enable").add_argument("username")
    sub.add_parser("delete-user").add_argument("username")
    p = sub.add_parser("audit")
    p.add_argument("--limit", type=int, default=50)
    sub.add_parser("generate-key", help="print a new encryption key for NCODE_SECRET_KEY")
    p = sub.add_parser("backup", help="write a backup zip (app database + uploaded files) to data/backups")
    p.add_argument("--to", default=None, help="another folder for the zip")
    p = sub.add_parser("restore", help="replace Ncode's data with a backup zip - STOP THE SERVER FIRST")
    p.add_argument("file")
    p.add_argument("--yes", action="store_true", help="do not ask")
    p = sub.add_parser("import-datadesk", help="import DataDesk reports and dashboards into the library")
    p.add_argument("file", help="DataDesk's app database (app-data.sqlite); it is only read")
    p.add_argument("--map", default="", help="DataDesk database -> Ncode connection, e.g. db1=mes,db2=crm")
    p.add_argument("--owner", default=None, help="user who owns the imported content (default: the first admin)")
    p.add_argument("--dry-run", action="store_true", help="only show what would be imported")
    p.add_argument("--report", default=None, help="also write the report to this Markdown file")

    args = parser.parse_args(argv)

    if args.command == "generate-key":
        print(generate_key())
        return

    init_environment()
    try:
        settings = load_settings()
        known = set(load_connections())
    except ConfigError as exc:
        _fail(str(exc))

    if args.command == "restore":  # before AppDB(): opening it would create or migrate the current file
        from .backup import BackupError, restore

        target = resolve_app_db_path(settings.app_db_path)
        if not args.yes:
            print(f"This replaces {target} and the uploaded files with {args.file}.")
            print("The current ones are kept as *.before-restore-<time>. The server must be stopped.")
            if input("Type yes to continue: ").strip().lower() != "yes":
                _fail("cancelled")
        try:
            manifest = restore(Path(args.file), target)
        except BackupError as exc:
            _fail(str(exc))
        when = datetime.fromtimestamp(manifest.get("created_at", 0)).strftime("%Y-%m-%d %H:%M")
        print(f"Restored the backup from {when} ({manifest.get('datasets', 0)} uploaded files). Start the server again;")
        print("its database is brought up to date automatically. Keep using the same secret key as before.")
        return

    db = AppDB(resolve_app_db_path(settings.app_db_path))
    if args.command == "backup":
        from .backup import make_backup

        made = make_backup(db.path, out_dir=Path(args.to) if args.to else None)
        print(f"Backup written: {made}  (the encryption key is not in it - keep secret.key / NCODE_SECRET_KEY apart)")
        return

    if args.command == "create-user":
        name = _check_username(args.username)
        allowed = _check_connections(args.connections, known)
        password = _ask_password()
        try:
            db.create_user(name, hash_password(password), "admin" if args.admin else "user", allowed)
        except ValueError as exc:
            _fail(str(exc))
        print(f"Created {'admin' if args.admin else 'user'} {name!r}.")

    elif args.command == "list-users":
        users = db.list_users()
        if not users:
            print("No users yet. Create one with: python -m app.manage create-user <name> --admin")
        for u in users:
            status = "active" if u.is_active else "DISABLED"
            print(f"{u.username:<24} {u.role:<6} {status:<9} connections: {format_allowed(u.allowed_connections)}"
                  + (f"  email: {u.email}" if u.email else ""))

    elif args.command == "set-password":
        name = _check_username(args.username)
        if db.get_user_by_name(name) is None:
            _fail(f"no such user {name!r}")
        db.update_user(name, password_hash=hash_password(_ask_password()))
        print("Password changed; the user was logged out everywhere.")

    elif args.command == "allow":
        name = _check_username(args.username)
        allowed = _check_connections(args.connections, known)
        if not db.update_user(name, allowed_connections=format_allowed(allowed)):
            _fail(f"no such user {name!r}")
        print(f"{name}: connections = {format_allowed(allowed)}")

    elif args.command == "set-email":
        from .automation.settings import valid_email

        name = _check_username(args.username)
        email = args.email.strip()
        if email and not valid_email(email):
            _fail(f"{email!r} is not an email address")
        if not db.update_user(name, email=email or None):
            _fail(f"no such user {name!r}")
        print(f"{name}: email = {email or '(none)'}")

    elif args.command in ("disable", "enable"):
        name = _check_username(args.username)
        if not db.update_user(name, is_active=(args.command == "enable")):
            _fail(f"no such user {name!r}")
        print(f"{name}: {args.command}d")

    elif args.command == "delete-user":
        name = _check_username(args.username)
        if not db.delete_user(name):
            _fail(f"no such user {name!r}")
        print(f"Deleted {name!r}.")

    elif args.command == "audit":
        for r in reversed(db.list_audit(args.limit)):
            when = datetime.fromtimestamp(r.ts).strftime("%Y-%m-%d %H:%M:%S")
            detail = ""
            if r.action in ("browse", "export", "connection_add", "connection_edit", "connection_delete"):
                detail = f"conn={r.connection} {r.phrase or ''}".strip()
            if r.action == "search":
                detail = (
                    f"conn={r.connection} phrase={r.phrase!r} status={r.status} "
                    f"found={r.found} errors={r.error_count} "
                    f"time={'%.1fs' % r.duration_sec if r.duration_sec is not None else '-'}"
                )
            elif r.action in ("query", "sql"):
                detail = (
                    f"conn={r.connection} status={r.status} rows={r.found} "
                    f"time={'%.1fs' % r.duration_sec if r.duration_sec is not None else '-'} sql={r.phrase!r}"
                )
            print(f"{when}  {r.username or '-':<16} {r.action:<13} {detail}")

    elif args.command == "import-datadesk":
        _import_datadesk(args, db, settings)

    db.dispose()


def _import_datadesk(args: argparse.Namespace, db: AppDB, settings) -> None:
    from pathlib import Path

    from .content.datadesk import ImportError_, parse_map, run_import
    from .content.store import ContentStore

    users = db.list_users()
    if args.owner:
        owner = db.get_user_by_name(_check_username(args.owner))
        if owner is None:
            _fail(f"no such user {args.owner!r}")
    else:
        owner = next((u for u in users if u.is_admin and u.is_active), None)
        if owner is None:
            _fail("no admin exists yet; create one or pass --owner")
    connections = {k: c.engine for k, c in load_connections().items()}
    for key, engine in db.connection_engines().items():  # UI-made connections (no password needed)
        connections.setdefault(key, engine)
    try:
        mapping = parse_map(args.map)
        unknown = sorted(v for v in mapping.values() if v not in connections)
        if unknown:
            _fail(f"--map names connections Ncode does not have: {', '.join(unknown)} (known: {', '.join(sorted(connections))})")
        report = run_import(
            Path(args.file), ContentStore(db.engine), owner, mapping=mapping, connections=connections, dry_run=args.dry_run
        )
    except ImportError_ as exc:
        _fail(str(exc))
    text = report.text()
    print(text)
    if args.report:
        Path(args.report).write_text(text, encoding="utf-8")
        print(f"Report written to {args.report}")
    if not args.dry_run:
        db.audit(owner.username, "import_datadesk", phrase=Path(args.file).name, status="ok")


if __name__ == "__main__":
    main()
