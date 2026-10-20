"""A few process metrics in the Prometheus text format (roadmap M9), without a client library.

Counters only grow while the process runs; gauges are read when /metrics is scraped.
"""

from __future__ import annotations

import threading
import time
from typing import Callable

BUCKETS = (0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30)


class Metrics:
    def __init__(self) -> None:
        self.started = time.time()
        self._lock = threading.Lock()
        self._counters: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
        self._hist: dict[tuple[str, tuple[tuple[str, str], ...]], list[float]] = {}  # bucket counts + sum + count
        self._help: dict[str, tuple[str, str]] = {}
        self._gauges: dict[str, tuple[str, Callable[[], float | None]]] = {}

    def counter(self, name: str, help_: str, value: float = 1, **labels: str) -> None:
        key = (name, tuple(sorted(labels.items())))
        with self._lock:
            self._help.setdefault(name, ("counter", help_))
            self._counters[key] = self._counters.get(key, 0) + value

    def observe(self, name: str, help_: str, seconds: float, **labels: str) -> None:
        key = (name, tuple(sorted(labels.items())))
        with self._lock:
            self._help.setdefault(name, ("histogram", help_))
            h = self._hist.setdefault(key, [0.0] * (len(BUCKETS) + 2))
            for i, b in enumerate(BUCKETS):
                if seconds <= b:
                    h[i] += 1
            h[-2] += seconds
            h[-1] += 1

    def gauge(self, name: str, help_: str, read: Callable[[], float | None]) -> None:
        self._gauges[name] = (help_, read)

    def render(self) -> str:
        lines: list[str] = []

        def labels(pairs: tuple[tuple[str, str], ...], extra: str = "") -> str:
            parts = [f'{k}="{_esc(v)}"' for k, v in pairs] + ([extra] if extra else [])
            return "{" + ",".join(parts) + "}" if parts else ""

        with self._lock:
            counters = dict(self._counters)
            hist = {k: list(v) for k, v in self._hist.items()}
            help_ = dict(self._help)
        seen: set[str] = set()
        for (name, pairs), value in sorted(counters.items()):
            if name not in seen:
                lines += [f"# HELP {name} {help_[name][1]}", f"# TYPE {name} counter"]
                seen.add(name)
            lines.append(f"{name}{labels(pairs)} {value:g}")
        for (name, pairs), h in sorted(hist.items()):
            if name not in seen:
                lines += [f"# HELP {name} {help_[name][1]}", f"# TYPE {name} histogram"]
                seen.add(name)
            for i, b in enumerate(BUCKETS):
                le = 'le="%g"' % b  # no backslashes in f-string expressions before Python 3.12
                lines.append(f"{name}_bucket{labels(pairs, le)} {h[i]:g}")
            inf = 'le="+Inf"'
            lines.append(f"{name}_bucket{labels(pairs, inf)} {h[-1]:g}")
            lines.append(f"{name}_sum{labels(pairs)} {h[-2]:.6f}")
            lines.append(f"{name}_count{labels(pairs)} {h[-1]:g}")
        for name, (help_text, read) in sorted(self._gauges.items()):
            try:
                value = read()
            except Exception:
                value = None
            if value is None:
                continue
            lines += [f"# HELP {name} {help_text}", f"# TYPE {name} gauge", f"{name} {value:g}"]
        return "\n".join(lines) + "\n"


def _esc(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
