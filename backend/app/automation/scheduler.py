"""The scheduler: a background thread that runs due subscriptions.

Every `interval` seconds it looks for enabled subscriptions whose next run has come,
moves each one to its following run first (an atomic update, so two Ncode processes
on one database never send the same report twice) and runs it in a small pool.
Runs missed while the server was off are not repeated: a subscription that was due
runs once, then follows its schedule again.
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from .engine import Engine
from .store import Subscription, SubscriptionStore

logger = logging.getLogger("ncode.scheduler")


class Scheduler:
    def __init__(self, engine: Engine, subs: SubscriptionStore, *, interval_sec: int = 30, workers: int = 2):
        self.engine = engine
        self.subs = subs
        self.interval = interval_sec
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="ncode-subscription")
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._running: set[int] = set()
        self._lock = threading.Lock()
        self.chores: list = []  # other periodic jobs (the daily backup, M9), called on every tick

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name="ncode-scheduler", daemon=True)
            self._thread.start()
            logger.info("Scheduler started (every %ss)", self.interval)

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        self.pool.shutdown(wait=False, cancel_futures=True)

    def alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            try:
                self.tick()
            except Exception:  # a broken tick must not end the loop
                logger.exception("scheduler tick failed")
            for chore in self.chores:
                try:
                    chore()
                except Exception:
                    logger.exception("scheduled chore failed")

    def tick(self, now: float | None = None) -> list[int]:
        """Start every due subscription; returns their ids (tests call this directly)."""
        now = time.time() if now is None else now
        started = []
        for sub in self.subs.due(now):
            with self._lock:
                if sub.id in self._running:
                    continue
            if self.subs.claim(sub, now):
                self.submit(sub, "schedule")
                started.append(sub.id)
        return started

    def is_running(self, sid: int) -> bool:
        with self._lock:
            return sid in self._running

    def submit(self, sub: Subscription, trigger: str):
        with self._lock:
            self._running.add(sub.id)

        def work() -> dict:
            try:
                return self.engine.run(sub, trigger)
            finally:
                with self._lock:
                    self._running.discard(sub.id)

        return self.pool.submit(work)
