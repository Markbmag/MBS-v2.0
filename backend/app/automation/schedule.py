"""When a subscription or alert runs.

    {"every": "hour",  "minute": 15, "days": [0, 1, 2, 3, 4], "timezone": "Europe/Berlin"}
    {"every": "day",   "hour": 8, "minute": 0, "days": [0, 1, 2, 3, 4]}        weekdays at 08:00
    {"every": "week",  "hour": 7, "days": [0]}                                  Mondays at 07:00
    {"every": "month", "hour": 6, "monthday": 1}                                the 1st; -1 = the last day

Days are 0 = Monday ... 6 = Sunday. Times are wall-clock times in the schedule's time
zone, so "08:00" stays 08:00 when daylight saving time starts or ends.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_LOOKAHEAD_DAYS = 400


class Schedule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    every: Literal["hour", "day", "week", "month"]
    minute: int = Field(default=0, ge=0, le=59)
    hour: int = Field(default=8, ge=0, le=23)
    days: list[int] = Field(default_factory=lambda: list(range(7)), max_length=7)
    monthday: int = Field(default=1, ge=-1, le=28)
    timezone: str = Field(default="UTC", max_length=64)

    @field_validator("days")
    @classmethod
    def _days(cls, value: list[int]) -> list[int]:
        if any(d < 0 or d > 6 for d in value):
            raise ValueError("days are 0 (Monday) to 6 (Sunday)")
        return sorted(set(value))

    @field_validator("timezone")
    @classmethod
    def _tz(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError(f"unknown time zone {value!r}") from None
        return value

    @model_validator(mode="after")
    def _shape(self) -> "Schedule":
        if self.every in ("hour", "day", "week") and not self.days:
            raise ValueError("choose at least one day")
        if self.monthday == 0:
            raise ValueError("monthday is 1-28, or -1 for the last day of the month")
        return self


def _last_day(d: date) -> int:
    nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return (nxt - timedelta(days=1)).day


def _runs_on(s: Schedule, d: date) -> bool:
    if s.every == "month":
        return d.day == (_last_day(d) if s.monthday == -1 else s.monthday)
    return d.weekday() in s.days


def next_run(s: Schedule, after: float) -> float | None:
    """The first run strictly after `after` (a unix timestamp), as a unix timestamp."""
    tz = ZoneInfo(s.timezone)
    day = datetime.fromtimestamp(after, tz).date()
    hours = range(24) if s.every == "hour" else (s.hour,)
    for _ in range(MAX_LOOKAHEAD_DAYS):
        if _runs_on(s, day):
            for h in hours:
                ts = datetime(day.year, day.month, day.day, h, s.minute, tzinfo=tz).timestamp()
                if ts > after:
                    return ts
        day += timedelta(days=1)
    return None
