"""Sending: email over SMTP, and HTTPS posts to Slack, Teams, Telegram and other webhooks.

Only the standard library is used (smtplib, urllib). Error messages never contain a
webhook address or token: those are secrets (a Slack webhook URL lets anyone post).
"""

from __future__ import annotations

import json
import re
import smtplib
import ssl
import uuid
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .settings import EmailSettings

TIMEOUT_SEC = 20
MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
Files = list[tuple[str, bytes, str]]


class DeliveryError(Exception):
    """A channel refused or could not be reached; the message is safe to show."""


def one_line(text: str, limit: int = 200) -> str:
    """For headers: no line breaks (a header with a newline could add headers of its own)."""
    return re.sub(r"[\r\n\t]+", " ", text).strip()[:limit]


# ---------------------------------------------------------------- email

def build_email(cfg: EmailSettings, to: str, subject: str, html: str, text: str, files: Files) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = one_line(subject)
    msg["From"] = formataddr((one_line(cfg.from_name, 120), cfg.from_address))
    msg["To"] = to
    if cfg.reply_to:
        msg["Reply-To"] = cfg.reply_to
    msg["Message-ID"] = make_msgid(domain=cfg.from_address.rsplit("@", 1)[-1])
    msg["Auto-Submitted"] = "auto-generated"  # out-of-office replies stay away
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    for name, data, mime in files:
        main, _, sub = mime.partition("/")
        msg.add_attachment(data, maintype=main, subtype=sub or "octet-stream", filename=name)
    return msg


def _smtp(cfg: EmailSettings, password: str | None) -> smtplib.SMTP:
    context = ssl.create_default_context()
    try:
        if cfg.security == "ssl":
            server: smtplib.SMTP = smtplib.SMTP_SSL(cfg.host, cfg.port, timeout=TIMEOUT_SEC, context=context)
        else:
            server = smtplib.SMTP(cfg.host, cfg.port, timeout=TIMEOUT_SEC)
            server.ehlo()
            if cfg.security == "starttls":
                server.starttls(context=context)
                server.ehlo()
        if cfg.username:
            server.login(cfg.username, password or "")
        return server
    except smtplib.SMTPAuthenticationError as exc:
        raise DeliveryError("The email server refused the user name or password") from exc
    except (smtplib.SMTPException, OSError) as exc:
        raise DeliveryError(f"Cannot reach the email server {cfg.host}:{cfg.port}: {_reason(exc)}") from exc


def _reason(exc: BaseException) -> str:
    if isinstance(exc, smtplib.SMTPResponseException):
        return f"{exc.smtp_code} {exc.smtp_error.decode('utf-8', 'replace')[:200] if isinstance(exc.smtp_error, bytes) else exc.smtp_error}"
    return str(exc)[:200] or exc.__class__.__name__


def send_email(
    cfg: EmailSettings, password: str | None, recipients: list[str], subject: str, html: str, text: str, files: Files,
) -> dict[str, str]:
    """One message per recipient (nobody sees the others' addresses). Returns {address: "sent" | error}."""
    if not cfg.configured:
        raise DeliveryError("Email is not set up yet: Admin → Delivery → Email server")
    if sum(len(f[1]) for f in files) > MAX_ATTACHMENT_BYTES:
        files = []
        text += "\n\nThe attachments were left out: together they are larger than 15 MB."
        html = html.replace("</body>", "<p style='font-size:12px;color:#b45309'>The attachments were left out: "
                                       "together they are larger than 15 MB.</p></body>")
    outcome: dict[str, str] = {}
    server = _smtp(cfg, password)
    try:
        for address in recipients:
            try:
                refused = server.send_message(build_email(cfg, address, subject, html, text, files))
                outcome[address] = "sent" if not refused else f"refused: {refused}"
            except smtplib.SMTPServerDisconnected:
                server = _smtp(cfg, password)  # some servers close after N messages
                server.send_message(build_email(cfg, address, subject, html, text, files))
                outcome[address] = "sent"
            except (smtplib.SMTPException, OSError) as exc:
                outcome[address] = f"error: {_reason(exc)}"
    finally:
        try:
            server.quit()
        except (smtplib.SMTPException, OSError):
            pass
    return outcome


# ---------------------------------------------------------------- HTTP

def _post(url: str, body: bytes, content_type: str, what: str) -> bytes:
    req = Request(url, data=body, method="POST", headers={"Content-Type": content_type, "User-Agent": "Ncode"})
    try:
        with urlopen(req, timeout=TIMEOUT_SEC) as res:  # noqa: S310 - admin-configured https endpoint
            return res.read(100_000)
    except HTTPError as exc:
        detail = exc.read(500).decode("utf-8", "replace").strip()
        raise DeliveryError(f"{what} answered {exc.code}" + (f": {detail[:200]}" if detail else "")) from exc
    except (URLError, OSError, ValueError) as exc:
        reason = getattr(exc, "reason", exc)
        raise DeliveryError(f"{what} could not be reached: {str(reason)[:200]}") from exc


def post_json(url: str, payload: dict[str, Any], what: str) -> None:
    _post(url, json.dumps(payload, default=str).encode("utf-8"), "application/json", what)


def _multipart(fields: dict[str, str], file: tuple[str, str, bytes, str]) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts: list[bytes] = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    field, name, data, mime = file
    safe = name.replace('"', "").replace("\r", "").replace("\n", "")
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{safe}"\r\n'
                 f"Content-Type: {mime}\r\n\r\n".encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


TELEGRAM_API = "https://api.telegram.org"


def send_telegram(token: str, chat_id: str, text: str, files: Files, api: str | None = None) -> None:
    api = api or TELEGRAM_API
    post_json(f"{api}/bot{token}/sendMessage",
              {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}, "Telegram")
    for name, data, mime in files[:10]:
        body, ctype = _multipart({"chat_id": chat_id}, ("document", name, data, mime))
        _post(f"{api}/bot{token}/sendDocument", body, ctype, "Telegram")
