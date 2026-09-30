import asyncio
import json
from datetime import datetime, timezone

from app.services.calendar_signal import CalendarSignalService


def _write_calendar(path, events) -> None:
    path.write_text(json.dumps({"value": events}), encoding="utf-8")


def test_current_signal_matches_active_non_declined_meeting(tmp_path) -> None:
    path = tmp_path / "calendar.json"
    _write_calendar(
        path,
        [
            {
                "subject": "Active call",
                "startWithTimeZone": "2026-09-30T11:30:00+05:30",
                "endWithTimeZone": "2026-09-30T12:30:00+05:30",
                "responseType": "accepted",
            },
            {
                "subject": "Declined call",
                "startWithTimeZone": "2026-09-30T11:00:00+05:30",
                "endWithTimeZone": "2026-09-30T13:00:00+05:30",
                "responseType": "declined",
            },
        ],
    )
    service = CalendarSignalService(
        path,
        1800,
        now=lambda: datetime(2026, 9, 30, 6, 30, tzinfo=timezone.utc),
    )

    assert asyncio.run(service.current_signal()) == {"meeting_scheduled_now": True}


def test_scheduled_end_is_exclusive(tmp_path) -> None:
    path = tmp_path / "calendar.json"
    _write_calendar(
        path,
        [
            {
                "subject": "Finished call",
                "startWithTimeZone": "2026-09-30T11:30:00+05:30",
                "endWithTimeZone": "2026-09-30T12:00:00+05:30",
                "responseType": "accepted",
            }
        ],
    )
    service = CalendarSignalService(
        path,
        1800,
        now=lambda: datetime(2026, 9, 30, 6, 30, tzinfo=timezone.utc),
    )

    assert asyncio.run(service.current_signal())["meeting_scheduled_now"] is False


def test_invalid_sync_file_keeps_last_valid_snapshot(tmp_path) -> None:
    path = tmp_path / "calendar.json"
    _write_calendar(
        path,
        [
            {
                "subject": "Active call",
                "startWithTimeZone": "2026-09-30T11:30:00+05:30",
                "endWithTimeZone": "2026-09-30T12:30:00+05:30",
                "responseType": "accepted",
            }
        ],
    )
    clock = 0.0
    service = CalendarSignalService(
        path,
        10,
        clock=lambda: clock,
        now=lambda: datetime(2026, 9, 30, 6, 30, tzinfo=timezone.utc),
    )
    assert asyncio.run(service.current_signal())["meeting_scheduled_now"] is True

    path.write_text("{partial", encoding="utf-8")
    clock = 11.0

    assert asyncio.run(service.current_signal())["meeting_scheduled_now"] is True
