import asyncio
import json

import httpx

from app.core.config import Settings
from app.services import teams_call_detector
from app.services.calendar_signal import CalendarSignalService
from app.services.teams_call_detector import TeamsCallTransitionService


def _snapshot(*, title: str, active: bool = True, minimized: bool = False) -> dict:
    return {
        "observed_at": "2026-09-30T12:00:00+05:30",
        "probe_health": "good",
        "teams_running": True,
        "root_process_ids": [10],
        "windows": [
            {
                "window_id": "100",
                "process_id": 20,
                "title": title,
                "class_name": "TeamsWebView",
                "visible": True,
                "minimized": minimized,
                "leave_control": active,
                "call_toolbar_control": active,
                "controls_readable": True,
                "controls": ("Leave|hangup-button|enabled=True",),
            }
        ],
        "active_call_evidence": active,
        "error": None,
    }


def test_clear_call_lifecycle_stays_local(monkeypatch, tmp_path) -> None:
    service = TeamsCallTransitionService(
        Settings(typesafe_api_key="test-key", sqlite_path=tmp_path / "budget.db")
    )
    idle = _snapshot(title="Teams", active=False)
    call = _snapshot(title="Alpha")
    minimized = _snapshot(title="Teams", active=False, minimized=True)
    failed = {**idle, "probe_health": "error", "windows": []}
    snapshots = iter([idle, call, call, minimized, failed, call, idle, idle, idle])
    monkeypatch.setattr(teams_call_detector, "capture_teams_snapshot", lambda: next(snapshots))

    results = [asyncio.run(service.evaluate()) for _ in range(9)]

    assert [result["decision"] for result in results] == [
        "UNCERTAIN",
        "UNCERTAIN",
        "START",
        "UNCERTAIN",
        "UNCERTAIN",
        "CONTINUE",
        "UNCERTAIN",
        "UNCERTAIN",
        "END",
    ]
    assert not (tmp_path / "budget.db").exists()


def _ambiguous_snapshot() -> dict:
    snapshot = _snapshot(title="Alpha")
    snapshot["windows"].append({**snapshot["windows"][0], "title": "Beta", "window_id": "101"})
    return snapshot


def test_jev_debounce_and_daily_cap_across_restarts(monkeypatch, tmp_path) -> None:
    settings = Settings(typesafe_api_key="test-key", sqlite_path=tmp_path / "budget.db")
    now = 0.0
    calls = 0
    monkeypatch.setattr(teams_call_detector, "capture_teams_snapshot", _ambiguous_snapshot)

    async def fake_ask(previous, current):
        nonlocal calls
        calls += 1
        return "START", 0.55, {"START": 0.55}, "jev-test", "101"

    def clock():
        return now

    for _ in range(7):
        service = TeamsCallTransitionService(settings)
        service._clock = clock
        monkeypatch.setattr(service, "_ask_jev", fake_ask)
        assert not asyncio.run(service.evaluate())["evaluated"]
        now += 29
        assert not asyncio.run(service.evaluate())["evaluated"]
        now += 1
        assert asyncio.run(service.evaluate())["decision"] == "UNCERTAIN"
        now += 120
        assert not asyncio.run(service.evaluate())["evaluated"]

    assert calls == 5


def test_jev_billing_error_blocks_requests_after_restart(monkeypatch, tmp_path) -> None:
    settings = Settings(typesafe_api_key="test-key", sqlite_path=tmp_path / "budget.db")
    now = 0.0
    monkeypatch.setattr(teams_call_detector, "capture_teams_snapshot", _ambiguous_snapshot)

    async def billing_error(previous, current):
        request = httpx.Request("POST", "https://example.com")
        httpx.Response(402, request=request).raise_for_status()

    service = TeamsCallTransitionService(settings)
    service._clock = lambda: now
    monkeypatch.setattr(service, "_ask_jev", billing_error)
    asyncio.run(service.evaluate())
    now += 30
    assert "HTTP 402" in asyncio.run(service.evaluate())["reason"]

    restarted = TeamsCallTransitionService(settings)
    restarted._clock = lambda: now
    monkeypatch.setattr(restarted, "_ask_jev", billing_error)
    asyncio.run(restarted.evaluate())
    now += 30
    assert not asyncio.run(restarted.evaluate())["evaluated"]


def test_jev_start_uses_selected_window(monkeypatch, tmp_path) -> None:
    service = TeamsCallTransitionService(
        Settings(typesafe_api_key="test-key", sqlite_path=tmp_path / "budget.db")
    )
    now = 0.0
    service._clock = lambda: now
    monkeypatch.setattr(teams_call_detector, "capture_teams_snapshot", _ambiguous_snapshot)

    async def fake_ask(previous, current):
        return "START", 0.95, {"START": 0.95}, "jev-test", "101"

    monkeypatch.setattr(service, "_ask_jev", fake_ask)
    asyncio.run(service.evaluate())
    now += 30
    result = asyncio.run(service.evaluate())
    assert result["decision"] == "START"
    assert result["matched_window_title"] == "Beta"
    assert asyncio.run(service.evaluate())["decision"] == "CONTINUE"


def test_ambiguity_flicker_does_not_retry_failed_request(monkeypatch, tmp_path) -> None:
    service = TeamsCallTransitionService(
        Settings(typesafe_api_key="test-key", sqlite_path=tmp_path / "budget.db")
    )
    now = 0.0
    snapshot = _ambiguous_snapshot()
    service._clock = lambda: now
    monkeypatch.setattr(teams_call_detector, "capture_teams_snapshot", lambda: snapshot)

    async def connection_error(previous, current):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(service, "_ask_jev", connection_error)
    asyncio.run(service.evaluate())
    now += 30
    assert asyncio.run(service.evaluate())["evaluated"]
    snapshot = _snapshot(title="Alpha")
    asyncio.run(service.evaluate())
    snapshot = _ambiguous_snapshot()
    asyncio.run(service.evaluate())
    now += 30
    assert not asyncio.run(service.evaluate())["evaluated"]


def test_jev_receives_only_current_calendar_signal(monkeypatch, tmp_path) -> None:
    calendar_path = tmp_path / "calendar.json"
    calendar_path.write_text(
        json.dumps(
            {
                "value": [
                    {
                        "subject": "Team Huddle",
                        "startWithTimeZone": "2026-09-30T11:30:00+05:30",
                        "endWithTimeZone": "2026-09-30T12:30:00+05:30",
                        "responseType": "accepted",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    calendar = CalendarSignalService(
        calendar_path,
        1800,
        now=lambda: teams_call_detector.datetime.fromisoformat("2026-09-30T12:00:00+05:30"),
    )
    service = TeamsCallTransitionService(
        Settings(typesafe_api_key="test-key"),
        calendar,
    )
    captured_payload = None

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "answers": {
                    "call_transition": {
                        "choice": "START",
                        "confidence": 0.95,
                        "probabilities": {"START": 0.95},
                    }
                },
                "model": "jev-test",
            }

    class FakeClient:
        def __init__(self, **kwargs) -> None:
            context = kwargs["verify"]
            assert context.verify_mode == teams_call_detector.ssl.CERT_REQUIRED
            assert context.check_hostname

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback) -> None:
            return None

        async def post(self, url, *, headers, json):
            nonlocal captured_payload
            captured_payload = json
            return FakeResponse()

    monkeypatch.setattr(teams_call_detector.httpx, "AsyncClient", FakeClient)

    asyncio.run(service._ask_jev(None, _snapshot(title="Team Huddle")))

    assert captured_payload["state"]["calendar_signal"] == {
        "meeting_scheduled_now": True,
    }
    assert "value" not in captured_payload["state"]["calendar_signal"]
    assert "Team Huddle" not in json.dumps(captured_payload)
    assert "process_id" not in json.dumps(captured_payload)
