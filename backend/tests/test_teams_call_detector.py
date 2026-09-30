import asyncio

from app.core.config import Settings
from app.services import teams_call_detector
from app.services.teams_call_detector import TeamsCallTransitionService, snapshot_signature


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
                "controls": ("Leave|hangup-button|enabled=True",),
            }
        ],
        "active_call_evidence": active,
        "error": None,
    }


def test_snapshot_signature_ignores_observation_time() -> None:
    first = _snapshot(title="Alpha planning")
    second = {**first, "observed_at": "2026-09-30T12:00:02+05:30"}

    assert snapshot_signature(first) == snapshot_signature(second)


def test_service_only_asks_jev_when_features_change(monkeypatch) -> None:
    settings = Settings(typesafe_api_key="test-key")
    service = TeamsCallTransitionService(settings)
    snapshots = iter([_snapshot(title="Alpha planning"), _snapshot(title="Alpha planning")])
    monkeypatch.setattr(teams_call_detector, "capture_teams_snapshot", lambda: next(snapshots))
    calls = 0

    async def fake_ask(previous, current, periodic_review):
        nonlocal calls
        calls += 1
        return "START", 0.95, {"START": 0.95, "CONTINUE": 0.05}, "jev-test"

    monkeypatch.setattr(service, "_ask_jev", fake_ask)

    first = asyncio.run(service.evaluate())
    second = asyncio.run(service.evaluate())

    assert first["decision"] == "START"
    assert second["decision"] == "CONTINUE"
    assert second["evaluated"] is False
    assert calls == 1


def test_low_confidence_transition_becomes_uncertain(monkeypatch) -> None:
    settings = Settings(typesafe_api_key="test-key", typesafe_transition_confidence=0.8)
    service = TeamsCallTransitionService(settings)
    monkeypatch.setattr(
        teams_call_detector,
        "capture_teams_snapshot",
        lambda: _snapshot(title="Beta review"),
    )

    async def fake_ask(previous, current, periodic_review):
        return "SWITCH", 0.55, {"SWITCH": 0.55, "CONTINUE": 0.45}, "jev-test"

    monkeypatch.setattr(service, "_ask_jev", fake_ask)
    first = asyncio.run(service.evaluate())
    second = asyncio.run(service.evaluate())

    assert first["decision"] == "UNCERTAIN"
    assert first["raw_decision"] == "SWITCH"
    assert second["evaluated"] is True


def test_long_call_forces_jev_review_after_40_minutes(monkeypatch) -> None:
    settings = Settings(typesafe_api_key="test-key")
    service = TeamsCallTransitionService(settings)
    snapshot = _snapshot(title="Alpha planning")
    monkeypatch.setattr(teams_call_detector, "capture_teams_snapshot", lambda: snapshot)
    now = 0.0
    service._clock = lambda: now
    calls: list[bool] = []

    async def fake_ask(previous, current, periodic_review):
        calls.append(periodic_review)
        decision = "START" if previous is None else "CONTINUE"
        return decision, 0.95, {decision: 0.95}, "jev-test"

    monkeypatch.setattr(service, "_ask_jev", fake_ask)

    asyncio.run(service.evaluate())
    now = 39 * 60
    before_threshold = asyncio.run(service.evaluate())
    now = 40 * 60
    first_review = asyncio.run(service.evaluate())
    now = 59 * 60
    before_interval = asyncio.run(service.evaluate())
    now = 60 * 60
    second_review = asyncio.run(service.evaluate())

    assert before_threshold["evaluated"] is False
    assert first_review["evaluated"] is True
    assert before_interval["evaluated"] is False
    assert second_review["evaluated"] is True
    assert calls == [False, True, True]
