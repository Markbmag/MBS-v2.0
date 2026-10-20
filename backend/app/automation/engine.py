"""Running a subscription: run its question(s) as the owner, check the alert, render, deliver.

Used by the scheduler (app/automation/scheduler.py), by "Send now" and by the
preview, which renders without sending.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from ..appdb import AppDB, User
from ..content.store import ContentError
from ..query.runner import QueryRunner
from ..results import ResultEnvelope
from . import channels
from .render import CardOut, Report, attachments, email_html, plain_text, slack_payload, teams_payload, telegram_text, webhook_payload
from .settings import SettingsStore
from .store import AlertCondition, Subscription, SubscriptionIn, SubscriptionStore

logger = logging.getLogger("ncode.automation")
CAPACITY_RETRIES = 60  # the owner's own queries can be using all their slots: wait up to ~1 minute


@dataclass
class Outcome:
    report: Report
    alert_met: bool | None = None      # None: not an alert
    alert_note: str | None = None
    empty: bool = False
    error: str | None = None           # the report could not be built at all
    cards: list[dict[str, Any]] = field(default_factory=list)


def check_alert(cond: AlertCondition, result: ResultEnvelope | None) -> tuple[bool, str]:
    if result is None:
        return False, "The question did not return a result"
    n = result.stats.row_count
    if cond.type == "rows":
        return n > 0, f"{n:,} row{'s' if n != 1 else ''}" + (" (or more)" if result.stats.truncated else "")
    idx = None
    if cond.column:
        idx = next((i for i, c in enumerate(result.columns) if c.name == cond.column), None)
        if idx is None:
            return False, f"The result has no column {cond.column!r} any more"
    else:
        idx = next((i for i, c in enumerate(result.columns) if c.type == "number" and c.role == "measure"), None)
        if idx is None:
            idx = next((i for i, c in enumerate(result.columns) if c.type == "number"), None)
        if idx is None:
            return False, "The result has no number column to compare"
    if not result.rows:
        return False, "No rows"
    value = result.rows[-1][idx]
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False, f"{result.columns[idx].name} is empty in the last row"
    limit = cond.value if cond.value is not None else 0
    met = value > limit if cond.type == "above" else value < limit
    col = result.columns[idx]
    name = col.display_name or col.name
    return met, f"{name} is {value:,.6g} ({'above' if cond.type == 'above' else 'below'} {limit:,.6g}: {'yes' if met else 'no'})"


class Engine:
    def __init__(
        self, *, app_db: AppDB, settings_store: SettingsStore, subs: SubscriptionStore, runner: QueryRunner,
        content: Callable[[], Any], statement_timeout_sec: int,
    ):
        self.app_db = app_db
        self.settings = settings_store
        self.subs = subs
        self.runner = runner
        self._content = content  # app.state.content, set once the library routes are registered
        self.timeout = statement_timeout_sec

    @property
    def content(self) -> Any:
        return self._content()

    # ------------------------------------------------------------------ running
    def _wait(self, start: Callable[[], dict[str, Any]]) -> tuple[ResultEnvelope | None, str | None]:
        for attempt in range(CAPACITY_RETRIES):
            try:
                snap = start()
                break
            except HTTPException as exc:
                if exc.status_code == 429 and attempt < CAPACITY_RETRIES - 1:
                    time.sleep(1)
                    continue
                return None, str(exc.detail)
            except ContentError as exc:
                return None, str(exc)
        if snap["status"] == "running":
            task = self.runner.get(snap["task_id"])
            if task is None:
                return None, "The query was lost"
            if not task.done.wait(self.timeout * 3 + 60):
                task.cancel(timed_out=True)
                return None, "The query took too long"
            snap = task.snapshot()
        if snap["status"] != "completed":
            return None, snap.get("error") or f"The query was {snap['status']}"
        return ResultEnvelope.model_validate(snap["result"]), None

    def _site(self) -> str:
        return self.settings.site_url()

    def build(self, owner: User, body: SubscriptionIn, sub_id: int | None) -> Outcome:
        site = self._site()
        extra = {"subscription_id": sub_id} if sub_id else {"subscription_preview": True}
        tz = ZoneInfo(body.schedule.timezone)
        stamp = datetime.now(tz).strftime("%d %b %Y, %H:%M")
        content = self.content
        if body.target_type == "dashboard":
            try:
                d = content.dashboards.get(owner, body.target_id)
            except ContentError:
                return Outcome(Report(title="Dashboard"), error="The dashboard is gone or not shared with the subscription's owner any more")
            url = f"{site}/dashboards/{d.id}" if site else None
            report = Report(title=body.name or d.name, subtitle=stamp, url=url, rows_per_card=body.options.rows)
            questions = content.dashboards.card_questions(owner, d)
            tab_order = {t["id"]: i for i, t in enumerate(d.tabs)}
            cards = sorted(d.cards, key=lambda c: (tab_order.get(c.get("tab"), 0), c["layout"]["y"], c["layout"]["x"]))
            for c in cards:
                if c["kind"] != "question":
                    if c.get("text"):
                        report.cards.append(CardOut(title=c.get("title") or c["text"] if c["kind"] == "heading" else c.get("title") or "",
                                                    kind=c["kind"], text=c["text"]))
                    continue
                q = questions.get(c["question_id"]) if c.get("question_id") else None
                title = c.get("title") or (q.name if q else "Question")
                out = CardOut(title=title, viz=c.get("viz") or (q.viz if q else None),
                              url=f"{site}/questions/{q.id}" if site and q else None)
                if q is None:
                    out.error = "This question is not shared with the subscription's owner"
                else:
                    out.result, out.error = self._wait(
                        lambda key=c["key"]: content.start_card(owner, d, key, body.options.filters, 0, True, extra)
                    )
                report.cards.append(out)
        else:
            try:
                q = content.store.get_question(owner, body.target_id)
            except ContentError:
                return Outcome(Report(title="Question"), error="The question is gone or not shared with the subscription's owner any more")
            url = f"{site}/questions/{q.id}" if site else None
            report = Report(title=body.name or q.name, subtitle=stamp, url=url, rows_per_card=body.options.rows)
            out = CardOut(title=q.name, viz=q.viz, url=url)
            out.result, out.error = self._wait(
                lambda: content.run_saved(owner, q, body.options.filters, [], 0, True, {"question_id": q.id, **extra})
            )
            report.cards.append(out)
        if body.options.message.strip():
            report.cards.insert(0, CardOut(title="", kind="text", text=body.options.message.strip()))
        outcome = Outcome(report)
        outcome.cards = [
            {"title": c.title, "rows": c.result.stats.row_count if c.result else None, "error": c.error}
            for c in report.cards if c.kind == "question"
        ]
        questions_out = [c for c in report.cards if c.kind == "question"]
        outcome.empty = all(c.result is not None and not c.result.rows for c in questions_out)
        if body.alert is not None:
            met, note = check_alert(body.alert, questions_out[0].result if questions_out else None)
            outcome.alert_met, outcome.alert_note = met, note
            report.alert_note = f"Alert: {note}"
        owner_name = owner.username
        report.footer = (
            f"Sent by Ncode because {owner_name} set up this {'alert' if body.alert else 'subscription'}. "
            + (f"Change or stop it at {site}/subscriptions" if site else "Change or stop it in Ncode under Subscriptions.")
        )
        return outcome

    # ------------------------------------------------------------------ delivering
    def recipients(self, body: SubscriptionIn, owner: User | None = None) -> tuple[list[str], list[dict[str, str]]]:
        """(addresses, problems): users' addresses plus the typed ones. The admin's allowed domains
        apply at send time to every address of a non-admin owner (account addresses included)."""
        addresses: list[str] = []
        problems: list[dict[str, str]] = []
        for name in body.recipients.users:
            u = self.app_db.get_user_by_name(name)
            if u is None or not u.is_active:
                problems.append({"channel": f"user {name}", "status": "skipped: the user does not exist or is disabled"})
            elif not u.email:
                problems.append({"channel": f"user {name}", "status": "skipped: no email address (they can add it under their name → Email)"})
            else:
                addresses.append(u.email)
        addresses += body.recipients.emails
        seen: set[str] = set()
        unique = [a for a in addresses if not (a.lower() in seen or seen.add(a.lower()))]  # type: ignore[func-returns-value]
        domains = self.settings.get("email").allowed_domains
        if domains and not (owner is not None and owner.is_admin):
            outside = [a for a in unique if a.rsplit("@", 1)[-1].lower() not in domains]
            problems += [{"channel": f"email {a}", "status": "skipped: outside the allowed domains"} for a in outside]
            unique = [a for a in unique if a not in outside]
        return unique, problems

    def deliver(self, body: SubscriptionIn, outcome: Outcome, sub_id: int | None, owner: User | None = None) -> list[dict[str, str]]:
        report = outcome.report
        results: list[dict[str, str]] = []
        files = attachments(report, body.options.attach) if body.options.attach != "none" else []
        addresses, problems = self.recipients(body, owner)
        results += problems
        if addresses:
            cfg = self.settings.get("email")
            subject = (f"🔔 {report.title}: {outcome.alert_note}" if outcome.alert_met else report.title)
            try:
                sent = channels.send_email(cfg, self.settings.secret("email"), addresses, subject,
                                           email_html(report), plain_text(report), files)
                results += [{"channel": f"email {a}", "status": s} for a, s in sent.items()]
            except channels.DeliveryError as exc:
                results += [{"channel": f"email {a}", "status": f"error: {exc}"} for a in addresses]
        for did in body.recipients.destinations:
            try:
                dest, secret = self.settings.destination(did)
            except ContentError:
                results.append({"channel": f"destination {did}", "status": "error: the destination was deleted"})
                continue
            label = f"{dest.kind} {dest.name}"
            if not secret:
                results.append({"channel": label, "status": "error: its address cannot be read (was the secret key changed?)"})
                continue
            try:
                if dest.kind == "slack":
                    channels.post_json(secret, slack_payload(report), "Slack")
                elif dest.kind == "teams":
                    channels.post_json(secret, teams_payload(report), "Teams")
                elif dest.kind == "telegram":
                    channels.send_telegram(secret, dest.config.get("chat_id", ""), telegram_text(report), files)
                else:
                    event = {"event": "alert" if body.alert else "subscription", "subscription_id": sub_id,
                             "target": {"type": body.target_type, "id": body.target_id}, "sent_at": time.time()}
                    channels.post_json(secret, webhook_payload(report, event), "The webhook")
                results.append({"channel": label, "status": "sent"})
            except channels.DeliveryError as exc:
                results.append({"channel": label, "status": f"error: {exc}"})
        return results

    def run(self, sub: Subscription, trigger: str) -> dict[str, Any]:
        """Run and deliver one subscription; the run is recorded."""
        run_id = self.subs.start_run(sub.id, trigger)
        detail: dict[str, Any] = {}
        status, disable = "error", False
        try:
            owner = self.app_db.get_user(sub.owner_id)
            if owner is None or not owner.is_active:
                detail["error"] = "The owner of this subscription is disabled"
            else:
                body = sub.body()
                outcome = self.build(owner, body, sub.id)
                detail["cards"] = outcome.cards
                if outcome.alert_note:
                    detail["condition"] = outcome.alert_note
                if outcome.error:
                    detail["error"] = outcome.error
                elif outcome.alert_met is False:
                    status = "skipped"
                    detail["reason"] = "The alert condition was not met"
                elif body.options.skip_empty and outcome.empty:
                    status = "skipped"
                    detail["reason"] = "Every card was empty"
                else:
                    detail["channels"] = self.deliver(body, outcome, sub.id, owner)
                    states = [c["status"] for c in detail["channels"]]
                    ok = sum(s == "sent" for s in states)
                    status = "sent" if ok and ok == len(states) else "partial" if ok else "error"
                    if not states:
                        detail["error"] = "Nobody to send to"
                    disable = bool(body.alert and body.alert.once and ok)
        except Exception as exc:  # never kill the scheduler
            logger.exception("subscription %s failed", sub.id)
            detail["error"] = f"Unexpected error: {exc.__class__.__name__}"
        self.subs.finish_run(run_id, sub.id, status, detail, disable=disable)
        logger.info("subscription %s (%s): %s", sub.id, trigger, status)
        return {"run_id": run_id, "status": status, "detail": detail}
