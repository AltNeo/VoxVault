from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable


class CalendarSignalService:
    def __init__(
        self,
        path: Path,
        refresh_seconds: float,
        *,
        clock: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] = lambda: datetime.now().astimezone(),
    ) -> None:
        self._path = path
        self._refresh_seconds = refresh_seconds
        self._clock = clock
        self._now = now
        self._events: list[dict[str, Any]] = []
        self._last_refresh_at: float | None = None
        self._lock = asyncio.Lock()

    async def current_signal(self) -> dict[str, Any]:
        await self._refresh_if_due()
        current = self._now()
        scheduled = [event for event in self._events if self._is_scheduled_now(event, current)]
        return {"meeting_scheduled_now": bool(scheduled)}

    async def _refresh_if_due(self) -> None:
        now = self._clock()
        if self._last_refresh_at is not None and now - self._last_refresh_at < self._refresh_seconds:
            return

        async with self._lock:
            now = self._clock()
            if (
                self._last_refresh_at is not None
                and now - self._last_refresh_at < self._refresh_seconds
            ):
                return
            try:
                events = await asyncio.to_thread(self._read_events)
            except (OSError, UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
                # OneDrive may briefly replace or expose a partial file while syncing. Keep the
                # last valid snapshot and try again on the next request.
                return
            self._events = events
            self._last_refresh_at = now

    def _read_events(self) -> list[dict[str, Any]]:
        # The handle exists only for this read. Parsing happens after it is closed so OneDrive and
        # Power Automate remain free to replace the synced file.
        with self._path.open("rb") as source:
            raw = source.read()
        body = json.loads(raw.decode("utf-8-sig"))
        values = body.get("value")
        if not isinstance(values, list):
            raise ValueError("Calendar export must contain a value array")
        return [event for event in values if isinstance(event, dict)]

    @classmethod
    def _is_scheduled_now(cls, event: dict[str, Any], current: datetime) -> bool:
        if str(event.get("responseType") or "").lower() == "declined":
            return False
        subject = str(event.get("subject") or "").strip()
        if subject.casefold() == "focus time":
            return False
        start = cls._parse_time(event.get("startWithTimeZone"))
        end = cls._parse_time(event.get("endWithTimeZone"))
        if start is None or end is None:
            return False
        return start <= current.astimezone(start.tzinfo) < end

    @staticmethod
    def _parse_time(value: object) -> datetime | None:
        if not isinstance(value, str) or not value.strip():
            return None
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else None
