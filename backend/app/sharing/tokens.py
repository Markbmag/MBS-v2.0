"""Tokens for public links and embedding.

Public links carry a random token (192 bits); the database keeps its SHA-256 for
look-ups and an encrypted copy so an admin can copy the link again.

Embedding uses standard JWTs signed with HS256 and the embedding key, so the
website that embeds can sign them with any JWT library:

    {"resource": {"dashboard": 12}, "params": {"region": ["EU"]}, "exp": 1767225600}

Only HS256 is accepted (never "none" or another algorithm), "exp" is required and
at most MAX_LIFETIME_SEC in the future.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import secrets
import time
from typing import Any

MAX_LIFETIME_SEC = 30 * 24 * 3600
LEEWAY_SEC = 60


class TokenError(Exception):
    """The token is malformed, forged or expired; the message is safe to show."""


def new_public_token() -> str:
    return secrets.token_urlsafe(24)


def hash_public_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_embedding_key() -> str:
    return secrets.token_hex(32)


def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64d(text: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (ValueError, TypeError) as exc:
        raise TokenError("The embedding token is not valid") from exc


def sign_jwt(payload: dict[str, Any], key: str) -> str:
    """For tests, the admin's example snippet and the "preview" button."""
    header = _b64e(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = _b64e(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(key.encode("utf-8"), f"{header}.{body}".encode("ascii"), hashlib.sha256).digest()
    return f"{header}.{body}.{_b64e(sig)}"


def verify_jwt(token: str, key: str, now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    parts = token.split(".")
    if len(parts) != 3 or len(token) > 8000:
        raise TokenError("The embedding token is not valid")
    try:
        header = json.loads(_b64d(parts[0]))
    except ValueError as exc:
        raise TokenError("The embedding token is not valid") from exc
    if not isinstance(header, dict) or header.get("alg") != "HS256":
        raise TokenError("The embedding token must be signed with HS256")
    try:
        signed = f"{parts[0]}.{parts[1]}".encode("ascii")
    except UnicodeEncodeError as exc:
        raise TokenError("The embedding token is not valid") from exc
    expected = hmac.new(key.encode("utf-8"), signed, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, _b64d(parts[2])):
        raise TokenError("The embedding token's signature is wrong")
    try:
        payload = json.loads(_b64d(parts[1]))
    except ValueError as exc:
        raise TokenError("The embedding token is not valid") from exc
    if not isinstance(payload, dict):
        raise TokenError("The embedding token is not valid")
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)) or isinstance(exp, bool) or not math.isfinite(exp):
        raise TokenError('The embedding token needs an expiry ("exp")')
    if exp < now - LEEWAY_SEC:
        raise TokenError("The embedding token has expired")
    if exp > now + MAX_LIFETIME_SEC:
        raise TokenError("The embedding token may live at most 30 days")
    return payload


class AccessSigner:
    """Short-lived proof that a visitor typed a public link's password (kept in the browser's memory)."""

    def __init__(self) -> None:
        self._key = secrets.token_bytes(32)  # a restart asks for the password again

    # The password's hash is part of what is signed: changing the password locks out earlier visitors.
    def _sig(self, msg: str, password_hash: str) -> str:
        return _b64e(hmac.new(self._key, f"{msg}|{password_hash}".encode(), hashlib.sha256).digest())

    def issue(self, link_id: int, password_hash: str, ttl_sec: int = 12 * 3600) -> str:
        msg = f"{link_id}.{int(time.time()) + ttl_sec}"
        return f"{msg}.{self._sig(msg, password_hash)}"

    def check(self, link_id: int, value: str | None, password_hash: str) -> bool:
        if not value:
            return False
        parts = value.split(".")
        if len(parts) != 3 or parts[0] != str(link_id) or not parts[1].isdigit():
            return False
        expected = self._sig(f"{parts[0]}.{parts[1]}", password_hash)
        return hmac.compare_digest(expected, parts[2]) and int(parts[1]) > time.time()
