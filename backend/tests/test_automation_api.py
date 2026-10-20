"""Subscriptions and alerts (M8): schedules, permissions, rendering, delivery by email and webhooks."""

import json
import threading
import time
from datetime import datetime
from email import message_from_bytes
from email.policy import default as email_policy
from http.server import BaseHTTPRequestHandler, HTTPServer
from zoneinfo import ZoneInfo

import pytest

from app.automation import channels
from app.automation import routes as automation_routes
from app.automation.schedule import Schedule, next_run
from app.security import hash_password

from .helpers import auth
from .test_dashboards_api import card, new_dashboard, put
from .test_library_api import COUNT_BY_STATUS, call, library_env, save_builder, save_sql

BERLIN = ZoneInfo("Europe/Berlin")
DAILY = {"every": "day", "hour": 8, "minute": 0, "timezone": "Europe/Berlin"}
BY_STATUS = {"connection": "shop", "source": {"table": "q_orders"}, "breakouts": [{"ref": "q_orders.status", "alias": "status"}],
             "aggregations": [{"fn": "count", "alias": "orders"}], "order": [{"ref": "status", "dir": "asc"}]}


# ---------------------------------------------------------------- fakes

class FakeSMTP:
    """Stands in for smtplib.SMTP: records what would be sent."""
    sent: list = []
    logins: list = []
    fail_login = False

    def __init__(self, host, port, timeout=None):
        self.host, self.port = host, port

    def ehlo(self):
        pass

    def starttls(self, context=None):
        pass

    def login(self, user, password):
        import smtplib
        if FakeSMTP.fail_login:
            raise smtplib.SMTPAuthenticationError(535, b"bad credentials")
        FakeSMTP.logins.append((user, password))

    def send_message(self, msg):
        FakeSMTP.sent.append(message_from_bytes(msg.as_bytes(), policy=email_policy))
        return {}

    def quit(self):
        pass


class Hook:
    """A local HTTP server that records POSTs (Slack, Teams, Telegram, webhooks)."""

    def __init__(self):
        self.posts = []
        self.status = 200
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                outer.posts.append({"path": self.path, "type": self.headers.get("Content-Type"), "body": body})
                self.send_response(outer.status)
                self.end_headers()
                self.wfile.write(b'{"ok": true}' if outer.status == 200 else b"nope")

            def log_message(self, *args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def json(self, i=-1):
        return json.loads(self.posts[i]["body"])


@pytest.fixture()
def env(tmp_path, monkeypatch):
    FakeSMTP.sent, FakeSMTP.logins, FakeSMTP.fail_login = [], [], False
    monkeypatch.setattr(channels.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(automation_routes, "MANUAL_COOLDOWN_SEC", 0)
    for e in library_env(tmp_path):
        e["db"].update_user("alice", email="alice@example.com")
        e["db"].update_user("carol", email="carol@example.com")
        hook = Hook()
        e["hook"] = hook
        e["app"] = e["client"].app
        yield e
        hook.server.shutdown()


def setup_email(env, **extra):
    body = {"host": "smtp.example.com", "port": 587, "security": "starttls", "username": "ncode", "password": "smtp-secret",
            "from_address": "ncode@example.com", "from_name": "Ncode", **extra}
    return call(env, "admin", "PUT", "/api/admin/settings/email", json=body)


def subscription(env, who, target_type, target_id, status=200, **extra):
    body = {"name": "", "target_type": target_type, "target_id": target_id, "schedule": DAILY,
            "recipients": {"users": ["alice"]}, **extra}
    return call(env, who, "POST", "/api/subscriptions", status, json=body)


def send_now(env, who, sid):
    call(env, who, "POST", f"/api/subscriptions/{sid}/send")
    deadline = time.time() + 15
    while time.time() < deadline:
        sub = call(env, who, "GET", f"/api/subscriptions/{sid}")
        if sub["runs"] and sub["runs"][0]["status"] != "running":
            return sub["runs"][0]
        time.sleep(0.05)
    raise AssertionError("the run did not finish")


def html_of(msg):
    return msg.get_body(("html",)).get_content()


def text_of(msg):
    return msg.get_body(("plain",)).get_content()


# ---------------------------------------------------------------- schedules

def ts(*args):
    return datetime(*args, tzinfo=BERLIN).timestamp()


def at(t):
    return datetime.fromtimestamp(t, BERLIN).replace(tzinfo=None)


def test_schedule_daily_weekdays_monthly_hourly():
    weekdays = Schedule(every="day", hour=8, days=[0, 1, 2, 3, 4], timezone="Europe/Berlin")
    assert at(next_run(weekdays, ts(2026, 10, 23, 9))) == datetime(2026, 10, 26, 8)       # Friday after 8 -> Monday
    assert at(next_run(weekdays, ts(2026, 10, 23, 7, 59))) == datetime(2026, 10, 23, 8)   # still today
    monday = Schedule(every="week", hour=7, days=[0], timezone="Europe/Berlin")
    assert at(next_run(monday, ts(2026, 10, 26, 7))) == datetime(2026, 11, 2, 7)          # exactly at 7: the next one
    last = Schedule(every="month", hour=6, monthday=-1, timezone="Europe/Berlin")
    assert at(next_run(last, ts(2027, 2, 1, 0))) == datetime(2027, 2, 28, 6)
    first = Schedule(every="month", hour=6, monthday=1, timezone="Europe/Berlin")
    assert at(next_run(first, ts(2026, 12, 15))) == datetime(2027, 1, 1, 6)
    hourly = Schedule(every="hour", minute=15, days=[5, 6], timezone="Europe/Berlin")
    assert at(next_run(hourly, ts(2026, 10, 23, 12))) == datetime(2026, 10, 24, 0, 15)    # Friday -> Saturday 00:15
    assert at(next_run(hourly, ts(2026, 10, 24, 0, 15))) == datetime(2026, 10, 24, 1, 15)


def test_schedule_keeps_wall_clock_time_over_daylight_saving():
    daily = Schedule(every="day", hour=8, timezone="Europe/Berlin")
    before = next_run(daily, ts(2026, 10, 24, 7))   # summer time ends in the night to 25 October
    assert at(before) == datetime(2026, 10, 24, 8)
    assert next_run(daily, before) - before == 25 * 3600  # the day has 25 hours, 08:00 stays 08:00


def test_schedule_validation():
    for bad in ({"every": "day", "timezone": "Mars/Base"}, {"every": "day", "days": []}, {"every": "day", "days": [7]},
                {"every": "month", "monthday": 0}, {"every": "day", "hour": 24}, {"every": "minute"}):
        with pytest.raises(ValueError):
            Schedule(**bad)


# ---------------------------------------------------------------- settings and secrets

def test_email_settings_keep_the_password_secret(env):
    out = setup_email(env)
    assert out["email"]["password_set"] is True and "password" not in out["email"]
    assert "smtp-secret" not in json.dumps(call(env, "admin", "GET", "/api/admin/settings"))
    out = setup_email(env, password=None, from_name="Reports")  # null: keep
    assert out["email"]["password_set"] and out["email"]["from_name"] == "Reports"
    assert env["app"].state.scheduler.engine.settings.secret("email") == "smtp-secret"
    assert setup_email(env, password="")["email"]["password_set"] is False  # "": remove
    call(env, "alice", "GET", "/api/admin/settings", 403)
    call(env, "alice", "PUT", "/api/admin/settings/email", 403, json={"host": "evil"})
    call(env, "admin", "PUT", "/api/admin/settings/email", 422, json={"from_address": "not-an-address"})


def test_test_email_and_a_refused_login(env):
    setup_email(env)
    assert call(env, "admin", "POST", "/api/admin/settings/email/test", json={"to": "me@example.com"}) == {"ok": True, "error": None}
    assert FakeSMTP.logins == [("ncode", "smtp-secret")] and FakeSMTP.sent[0]["To"] == "me@example.com"
    FakeSMTP.fail_login = True
    out = call(env, "admin", "POST", "/api/admin/settings/email/test", json={"to": "me@example.com"})
    assert not out["ok"] and "user name or password" in out["error"]


def test_destinations_hide_their_address(env):
    url = env["hook"].url + "/services/T000/B000/very-secret-token"
    d = call(env, "admin", "POST", "/api/admin/destinations", json={"name": "Sales channel", "kind": "slack", "secret": url})
    assert "very-secret-token" not in json.dumps(d) and d["secret_hint"].endswith("oken")
    listed = call(env, "admin", "GET", "/api/admin/destinations")
    assert "very-secret-token" not in json.dumps(listed)
    options = call(env, "alice", "GET", "/api/subscriptions/options")
    assert options["destinations"] == [{"id": d["id"], "name": "Sales channel", "kind": "slack"}]
    call(env, "alice", "GET", "/api/admin/destinations", 403)
    call(env, "alice", "POST", "/api/admin/destinations", 403, json={"name": "x", "kind": "webhook", "secret": url})
    # test message, and an edit that keeps the address
    assert call(env, "admin", "POST", f"/api/admin/destinations/{d['id']}/test")["ok"]
    assert env["hook"].posts[-1]["path"] == "/services/T000/B000/very-secret-token"
    call(env, "admin", "PUT", f"/api/admin/destinations/{d['id']}", json={"name": "Sales", "kind": "slack", "secret": ""})
    assert call(env, "admin", "POST", f"/api/admin/destinations/{d['id']}/test")["ok"]
    # a failing endpoint: the error does not repeat the address
    env["hook"].status = 404
    out = call(env, "admin", "POST", f"/api/admin/destinations/{d['id']}/test")
    assert not out["ok"] and "404" in out["error"] and "very-secret-token" not in out["error"]
    call(env, "admin", "POST", "/api/admin/destinations", 400, json={"name": "t", "kind": "telegram", "secret": "nope", "chat_id": "1"})
    call(env, "admin", "POST", "/api/admin/destinations", 400, json={"name": "w", "kind": "webhook", "secret": "ftp://x"})


# ---------------------------------------------------------------- subscriptions

def test_dashboard_subscription_email_with_attachment(env):
    setup_email(env)
    call(env, "admin", "PUT", "/api/admin/settings/general", json={"site_url": "https://ncode.example.com/"})
    total = save_builder(env, "alice", spec={"connection": "shop", "source": {"table": "q_orders"},
                                              "aggregations": [{"fn": "sum", "ref": "q_orders.total", "alias": "revenue"}]}, name="Revenue")
    by_status = save_builder(env, "alice", spec=BY_STATUS, name="Orders by status")
    d = new_dashboard(env, "alice", "Weekly sales")
    put(env, "alice", d["id"], {"cards": [
        card("h", kind="heading", text="Overview", w=12, h=1),
        card("k", total["id"], y=1, w=4, viz={"mode": "chart", "spec": {"version": 1, "type": "kpi", "value": "revenue"}}),
        card("b", by_status["id"], x=4, y=1, viz={"mode": "chart", "spec": {"version": 1, "type": "bar", "x": "status", "series": [{"y": "orders"}]}}),
    ]})
    sub = subscription(env, "alice", "dashboard", d["id"], recipients={"users": ["alice", "carol"], "emails": ["boss@example.com"]},
                       options={"attach": "csv", "message": "Good morning!"})
    assert sub["owner"] == "alice" and sub["target_name"] == "Weekly sales" and sub["enabled"] and sub["next_run_at"] > time.time()

    run = send_now(env, "alice", sub["id"])
    assert run["status"] == "sent", run
    assert [c["rows"] for c in run["detail"]["cards"]] == [1, 3]
    assert sorted(m["To"] for m in FakeSMTP.sent) == ["alice@example.com", "boss@example.com", "carol@example.com"]
    msg = FakeSMTP.sent[0]
    assert msg["Subject"] == "Weekly sales" and msg["Auto-Submitted"] == "auto-generated"
    html = html_of(msg)
    assert "Overview" in html and "Good morning!" in html and "465" in html  # 100+50+200+30+0+75.5+10 = 465.5
    assert "paid" in html and "refunded" in html
    assert "https://ncode.example.com/dashboards/" in html and "https://ncode.example.com/subscriptions" in html
    assert "Revenue" in text_of(msg)
    files = {p.get_filename(): p.get_content() for p in msg.iter_attachments()}
    assert set(files) == {"Revenue.csv", "Orders by status.csv"}
    assert "status;orders" in files["Orders by status.csv"]
    sub = call(env, "alice", "GET", f"/api/subscriptions/{sub['id']}")
    assert sub["last_status"] == "sent" and sub["last_error"] is None


def test_values_from_the_database_are_escaped_and_headers_stay_single_line(env):
    setup_email(env)
    q = save_sql(env, "alice", "SELECT '<script>alert(1)</script>' AS s, 1 AS n")
    sub = subscription(env, "alice", "question", q["id"], name="Evil\r\nBcc: victim@example.com")
    assert send_now(env, "alice", sub["id"])["status"] == "sent"
    msg = FakeSMTP.sent[0]
    assert "<script>" not in html_of(msg) and "&lt;script&gt;" in html_of(msg)
    assert msg["Bcc"] is None and "\n" not in msg["Subject"]


def test_preview_renders_without_sending(env):
    q = save_builder(env, "alice", spec=BY_STATUS, name="Orders by status")
    out = call(env, "alice", "POST", "/api/subscriptions/preview",
               json={"target_type": "question", "target_id": q["id"], "schedule": DAILY, "recipients": {}})
    assert "Orders by status" in out["html"] and "refunded" in out["text"] and out["alert"] is None
    assert FakeSMTP.sent == []
    call(env, "carol", "POST", "/api/subscriptions/preview", 404,
         json={"target_type": "question", "target_id": q["id"], "schedule": DAILY})


def test_permissions(env):
    q = save_builder(env, "alice", spec=BY_STATUS)
    subscription(env, "carol", "question", q["id"], 404)      # alice's collection is private
    subscription(env, "alice", "question", q["id"], 400, recipients={})
    subscription(env, "alice", "question", q["id"], 400, recipients={"users": ["nobody"]})
    subscription(env, "alice", "question", q["id"], 400, recipients={"destinations": [999]})
    subscription(env, "alice", "dashboard", 999, 404)
    sub = subscription(env, "alice", "question", q["id"], recipients={"users": ["carol"]})
    # carol receives it: she sees it, may leave it, but not change or send it
    mine = call(env, "carol", "GET", "/api/subscriptions")["subscriptions"]
    assert [s["id"] for s in mine] == [sub["id"]] and not mine[0]["can_manage"]
    call(env, "carol", "PATCH", f"/api/subscriptions/{sub['id']}", 404, json={"enabled": False})
    call(env, "carol", "POST", f"/api/subscriptions/{sub['id']}/send", 404)
    call(env, "carol", "DELETE", f"/api/subscriptions/{sub['id']}", 404)
    call(env, "carol", "POST", f"/api/subscriptions/{sub['id']}/unsubscribe")
    assert call(env, "carol", "GET", "/api/subscriptions")["subscriptions"] == []
    call(env, "bob", "GET", f"/api/subscriptions/{sub['id']}", 404)
    # admins see everything with all=true
    assert [s["id"] for s in call(env, "admin", "GET", "/api/subscriptions", params={"all": True})["subscriptions"]] == [sub["id"]]
    assert call(env, "admin", "GET", "/api/subscriptions")["subscriptions"] == []
    # the target cannot be swapped
    call(env, "alice", "PUT", f"/api/subscriptions/{sub['id']}", 400,
         json={"target_type": "question", "target_id": q["id"] + 1, "schedule": DAILY, "recipients": {"users": ["alice"]}})


def test_allowed_domains_bind_people_but_not_admins(env):
    setup_email(env, allowed_domains=["example.com"])
    q = save_builder(env, "alice", spec=BY_STATUS)
    subscription(env, "alice", "question", q["id"], 400, recipients={"emails": ["someone@gmail.test"]})
    subscription(env, "alice", "question", q["id"], recipients={"emails": ["someone@example.com"]})
    share_q = save_builder(env, "admin", spec=BY_STATUS)
    subscription(env, "admin", "question", share_q["id"], recipients={"emails": ["partner@gmail.test"]})


def test_the_owner_permissions_apply_at_send_time(env):
    setup_email(env)
    q = save_builder(env, "alice", spec=BY_STATUS)
    sub = subscription(env, "alice", "question", q["id"])
    env["db"].update_user("alice", is_active=False)
    run = send_now(env, "admin", sub["id"])
    assert run["status"] == "error" and "disabled" in run["detail"]["error"] and FakeSMTP.sent == []


def test_users_without_an_address_are_reported(env):
    setup_email(env)
    q = save_builder(env, "alice", spec=BY_STATUS)
    sub = subscription(env, "alice", "question", q["id"], recipients={"users": ["alice", "admin"]})
    run = send_now(env, "alice", sub["id"])
    assert run["status"] == "partial"
    assert any(c["channel"] == "user admin" and "no email address" in c["status"] for c in run["detail"]["channels"])
    call(env, "admin", "PUT", "/api/account/email", json={"email": "admin@example.com"})
    assert call(env, "admin", "GET", "/api/auth/me")["email"] == "admin@example.com"
    call(env, "admin", "PUT", "/api/account/email", 400, json={"email": "nope"})
    assert send_now(env, "alice", sub["id"])["status"] == "sent"


def test_email_not_set_up(env):
    q = save_builder(env, "alice", spec=BY_STATUS)
    sub = subscription(env, "alice", "question", q["id"])
    run = send_now(env, "alice", sub["id"])
    assert run["status"] == "error" and "not set up" in run["detail"]["channels"][0]["status"]


def test_skip_empty(env):
    setup_email(env)
    q = save_sql(env, "alice", "SELECT id FROM q_orders WHERE id < 0")
    sub = subscription(env, "alice", "question", q["id"], options={"skip_empty": True})
    run = send_now(env, "alice", sub["id"])
    assert run["status"] == "skipped" and FakeSMTP.sent == []


def test_webhooks_slack_teams_telegram(env, monkeypatch):
    hook = env["hook"]
    monkeypatch.setattr(channels, "TELEGRAM_API", hook.url)
    ids = [
        call(env, "admin", "POST", "/api/admin/destinations", json={"name": "S", "kind": "slack", "secret": hook.url + "/slack"})["id"],
        call(env, "admin", "POST", "/api/admin/destinations", json={"name": "T", "kind": "teams", "secret": hook.url + "/teams"})["id"],
        call(env, "admin", "POST", "/api/admin/destinations", json={"name": "W", "kind": "webhook", "secret": hook.url + "/hook"})["id"],
        call(env, "admin", "POST", "/api/admin/destinations",
             json={"name": "G", "kind": "telegram", "secret": "123456:" + "A" * 35, "chat_id": "-1001234"})["id"],
    ]
    q = save_builder(env, "alice", spec=BY_STATUS, name="Orders by status")
    sub = subscription(env, "alice", "question", q["id"], recipients={"destinations": ids}, options={"attach": "xlsx"})
    run = send_now(env, "alice", sub["id"])
    assert run["status"] == "sent", run
    by_path = {p["path"]: p for p in hook.posts}
    slack = json.loads(by_path["/slack"]["body"])
    assert slack["blocks"][0]["text"]["text"] == "Orders by status" and "refunded" in json.dumps(slack)
    teams = json.loads(by_path["/teams"]["body"])
    assert teams["attachments"][0]["contentType"] == "application/vnd.microsoft.card.adaptive"
    generic = json.loads(by_path["/hook"]["body"])
    assert generic["event"] == "subscription" and generic["cards"][0]["columns"][0]["name"] == "status"
    tg = json.loads(by_path["/bot123456:" + "A" * 35 + "/sendMessage"]["body"])
    assert tg["chat_id"] == "-1001234" and tg["parse_mode"] == "HTML"
    doc = by_path["/bot123456:" + "A" * 35 + "/sendDocument"]
    assert doc["type"].startswith("multipart/form-data") and b"Orders by status.xlsx" in doc["body"]


# ---------------------------------------------------------------- alerts

def test_alert_on_rows_and_once(env):
    setup_email(env)
    q = save_builder(env, "alice", spec=COUNT_BY_STATUS, name="Refunds",
                     parameters=[{"name": "status", "type": "text", "default": "refunded"}])
    rows = save_sql(env, "alice", "SELECT id FROM q_orders WHERE status = 'refunded'")
    sub = subscription(env, "alice", "question", rows["id"], alert={"type": "rows", "once": True})
    run = send_now(env, "alice", sub["id"])
    assert run["status"] == "sent" and run["detail"]["condition"] == "1 row"
    assert FakeSMTP.sent[0]["Subject"].startswith("🔔")
    assert call(env, "alice", "GET", f"/api/subscriptions/{sub['id']}")["enabled"] is False  # once
    # a dashboard cannot have an alert
    subscription(env, "alice", "dashboard", 1, 400, alert={"type": "rows"})
    assert q["id"]


def test_alert_goal_above_and_below(env):
    setup_email(env)
    q = save_builder(env, "alice", spec={"connection": "shop", "source": {"table": "q_orders"},
                                          "aggregations": [{"fn": "sum", "ref": "q_orders.total", "alias": "revenue"}]})
    above = subscription(env, "alice", "question", q["id"], alert={"type": "above", "value": 400})
    below = subscription(env, "alice", "question", q["id"], alert={"type": "below", "value": 400})
    assert send_now(env, "alice", above["id"])["status"] == "sent"
    run = send_now(env, "alice", below["id"])
    assert run["status"] == "skipped" and "465.5" in run["detail"]["condition"]
    assert len(FakeSMTP.sent) == 1
    missing = subscription(env, "alice", "question", q["id"], alert={"type": "above", "value": 1, "column": "gone"})
    assert send_now(env, "alice", missing["id"])["status"] == "skipped"
    subscription(env, "alice", "question", q["id"], 400, alert={"type": "above"})


# ---------------------------------------------------------------- scheduler

def test_scheduler_runs_due_subscriptions_once(env):
    setup_email(env)
    q = save_builder(env, "alice", spec=BY_STATUS)
    sub = subscription(env, "alice", "question", q["id"])
    scheduler = env["app"].state.scheduler
    assert scheduler.tick(time.time()) == []               # not due yet
    due = sub["next_run_at"] + 1
    assert scheduler.tick(due) == [sub["id"]]
    assert scheduler.tick(due) == []                       # already moved on
    deadline = time.time() + 10
    while not FakeSMTP.sent and time.time() < deadline:
        time.sleep(0.05)
    assert len(FakeSMTP.sent) == 1
    after = call(env, "alice", "GET", f"/api/subscriptions/{sub['id']}")
    assert after["next_run_at"] > due and after["runs"][0]["trigger"] == "schedule"
    # paused subscriptions do not run
    call(env, "alice", "PATCH", f"/api/subscriptions/{sub['id']}", json={"enabled": False})
    assert scheduler.tick(after["next_run_at"] + 1) == []


def test_deleting_content_or_the_owner_removes_subscriptions(env):
    q = save_builder(env, "alice", spec=BY_STATUS)
    subscription(env, "alice", "question", q["id"])
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"archived": True})
    call(env, "alice", "DELETE", f"/api/questions/{q['id']}")
    assert call(env, "alice", "GET", "/api/subscriptions")["subscriptions"] == []
    q2 = save_builder(env, "carol", spec=BY_STATUS)
    subscription(env, "carol", "question", q2["id"])
    env["db"].delete_user("carol")
    assert call(env, "admin", "GET", "/api/subscriptions", params={"all": True})["subscriptions"] == []


def test_new_user_gets_an_address(tmp_path):
    from app.appdb import AppDB
    db = AppDB(tmp_path / "a.sqlite")
    db.create_user("x", hash_password("x-password-1"))
    db.update_user("x", email="x@example.com")
    assert db.get_user_by_name("x").email == "x@example.com"
    assert auth  # helpers import kept for symmetry


# ---------------------------------------------------------------- from the security review

def test_allowed_domains_apply_at_send_time_to_account_addresses(env):
    setup_email(env)
    q = save_builder(env, "alice", spec=BY_STATUS)
    sub = subscription(env, "alice", "question", q["id"], recipients={"users": ["alice", "carol"]})
    setup_email(env, password=None, allowed_domains=["company.com"])  # set after the subscription
    call(env, "carol", "PUT", "/api/account/email", json={"email": "carol@company.com"})
    run = send_now(env, "alice", sub["id"])
    assert [m["To"] for m in FakeSMTP.sent] == ["carol@company.com"]  # alice@example.com is outside
    assert any("outside the allowed domains" in c["status"] for c in run["detail"]["channels"])


def test_send_now_is_throttled(env, monkeypatch):
    setup_email(env)
    monkeypatch.setattr(automation_routes, "MANUAL_COOLDOWN_SEC", 60)
    q = save_builder(env, "alice", spec=BY_STATUS)
    sub = subscription(env, "alice", "question", q["id"])
    call(env, "alice", "POST", f"/api/subscriptions/{sub['id']}/send")
    assert env["client"].post(f"/api/subscriptions/{sub['id']}/send", headers=env["alice"]).status_code in (409, 429)


def test_recipients_do_not_see_send_details(env):
    setup_email(env)
    q = save_builder(env, "alice", spec=BY_STATUS)
    sub = subscription(env, "alice", "question", q["id"], recipients={"users": ["carol"], "emails": ["secret@example.com"]})
    send_now(env, "alice", sub["id"])
    seen = call(env, "carol", "GET", f"/api/subscriptions/{sub['id']}")
    assert "secret@example.com" not in json.dumps(seen) and "runs" not in seen


def test_csv_headers_cannot_be_formulas():
    from app.automation.render import csv_bytes
    from app.results import build_envelope
    out = csv_bytes(build_envelope(["=HYPERLINK(1)", "n"], [["=1+1", 2]])).decode("utf-8-sig")
    assert out.splitlines() == ["'=HYPERLINK(1);n", "'=1+1;2"]
