"""Server-side simulation clock shared by every UI client.

The clock is stored as an anchor (sim minute, wall time, rate); the current value is
derived on read, so nothing ticks in the background. Clients fetch a snapshot and
extrapolate locally with the same formula, re-syncing whenever the anchor changes.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable

DAY_START_MIN = 8 * 60  # 08:00, before the first field report (08:35)
DAY_END_MIN = 16 * 60  # 16:00, after the last image (15:50)
# Sim seconds per wall second: 1 is real time, 60 is one sim minute per second.
RATES = (1.0, 10.0, 60.0, 300.0)


def to_minutes(value: str) -> int:
    hour, minute = value.split(":")
    result = int(hour) * 60 + int(minute)
    if not 0 <= int(minute) < 60 or not 0 <= result < 24 * 60:
        raise ValueError(f"Gecersiz saat: {value}")
    return result


def to_hhmm(minute: float) -> str:
    whole = int(minute)
    return f"{whole // 60:02d}:{whole % 60:02d}"


class SimClock:
    def __init__(
        self,
        start_min: float = DAY_START_MIN,
        rate: float = 60.0,
        running: bool = False,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self._now = now
        self._lock = threading.Lock()
        self._anchor_min = float(start_min)
        self._anchor_wall = now()
        self._rate = rate
        self._running = running
        self._version = 0

    def _minute(self) -> float:
        if not self._running:
            return self._anchor_min
        elapsed_s = self._now() - self._anchor_wall
        return min(self._anchor_min + elapsed_s * self._rate / 60, DAY_END_MIN)

    def _reanchor(self) -> None:
        self._anchor_min = self._minute()
        self._anchor_wall = self._now()
        if self._anchor_min >= DAY_END_MIN:
            self._running = False

    def minute(self) -> float:
        with self._lock:
            return self._minute()

    def update(
        self, *, time_hhmm: str | None = None, running: bool | None = None,
        rate: float | None = None,
    ) -> dict:
        with self._lock:
            self._reanchor()
            if time_hhmm is not None:
                minute = to_minutes(time_hhmm)
                if not DAY_START_MIN <= minute <= DAY_END_MIN:
                    raise ValueError(
                        f"Saat {to_hhmm(DAY_START_MIN)}-{to_hhmm(DAY_END_MIN)} araliginda olmali"
                    )
                self._anchor_min = float(minute)
            if rate is not None:
                if rate not in RATES:
                    raise ValueError(f"Hiz su degerlerden biri olmali: {RATES}")
                self._rate = rate
            if running is not None:
                # Play at the end of the day rewinds, like a media player.
                if running and self._anchor_min >= DAY_END_MIN:
                    self._anchor_min = float(DAY_START_MIN)
                self._running = running
            self._version += 1
            return self._snapshot()

    def snapshot(self) -> dict:
        with self._lock:
            return self._snapshot()

    def _snapshot(self) -> dict:
        minute = self._minute()
        running = self._running and minute < DAY_END_MIN
        return {
            "time": to_hhmm(minute),
            "minute": round(minute, 4),
            "running": running,
            "rate": self._rate,
            "rates": list(RATES),
            "start": to_hhmm(DAY_START_MIN),
            "end": to_hhmm(DAY_END_MIN),
            "version": self._version,
        }