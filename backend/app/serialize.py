"""Convert database values into JSON-safe values."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

MAX_VALUE_CHARS = 10_000  # protects the WebSocket payload from giant TEXT columns


def serialize_value(value: Any, clip: bool = True) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, timedelta):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = "0x" + raw.hex()
        return _clip(text) if clip else text
    if isinstance(value, str):
        return _clip(value) if clip else value
    return _clip(str(value)) if clip else str(value)


def _clip(text: str) -> str:
    if len(text) > MAX_VALUE_CHARS:
        return text[:MAX_VALUE_CHARS] + "…"
    return text
