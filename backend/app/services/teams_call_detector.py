from __future__ import annotations

import asyncio
import json
import platform
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any, Literal

import httpx
import psutil

from app.core.config import Settings
from app.services.calendar_signal import CalendarSignalService

Transition = Literal["START", "CONTINUE", "SWITCH", "END", "UNCERTAIN"]
TEAMS_PROCESS_NAMES = {"ms-teams.exe", "teams.exe"}
CALL_TOOLBAR_PREFIX = "callingButtons-"
LONG_CALL_REVIEW_AFTER_SECONDS = 40 * 60
LONG_CALL_REVIEW_INTERVAL_SECONDS = 20 * 60


@dataclass(frozen=True, slots=True)
class TeamsWindow:
    window_id: str
    process_id: int
    title: str
    class_name: str
    visible: bool
    minimized: bool
    leave_control: bool
    call_toolbar_control: bool
    controls: tuple[str, ...]


def snapshot_signature(snapshot: dict[str, Any]) -> str:
    stable = {key: value for key, value in snapshot.items() if key != "observed_at"}
    return json.dumps(stable, sort_keys=True, separators=(",", ":"))


def capture_teams_snapshot() -> dict[str, Any]:
    observed_at = datetime.now().astimezone().isoformat(timespec="milliseconds")
    if platform.system() != "Windows":
        return {
            "observed_at": observed_at,
            "probe_health": "unsupported",
            "teams_running": False,
            "root_process_ids": [],
            "windows": [],
            "active_call_evidence": False,
            "error": "Teams UI Automation is Windows-only",
        }

    try:
        process_ids, root_ids = _teams_process_tree()
        windows = _teams_windows(process_ids)
    except Exception as exc:
        return {
            "observed_at": observed_at,
            "probe_health": "error",
            "teams_running": False,
            "root_process_ids": [],
            "windows": [],
            "active_call_evidence": False,
            "error": f"{type(exc).__name__}: {exc}",
        }

    return {
        "observed_at": observed_at,
        "probe_health": "good",
        "teams_running": bool(root_ids),
        "root_process_ids": sorted(root_ids),
        "windows": [asdict(window) for window in windows],
        "active_call_evidence": any(
            window.leave_control and window.call_toolbar_control for window in windows
        ),
        "error": None,
    }


def _teams_process_tree() -> tuple[set[int], set[int]]:
    processes: dict[int, tuple[int, str]] = {}
    for process in psutil.process_iter(["pid", "ppid", "name"]):
        try:
            info = process.info
            processes[int(info["pid"])] = (
                int(info.get("ppid") or 0),
                str(info.get("name") or "").lower(),
            )
        except (psutil.AccessDenied, psutil.NoSuchProcess, TypeError, ValueError):
            continue

    roots = {pid for pid, (_, name) in processes.items() if name in TEAMS_PROCESS_NAMES}
    teams = set(roots)
    changed = True
    while changed:
        changed = False
        for pid, (parent_pid, _) in processes.items():
            if parent_pid in teams and pid not in teams:
                teams.add(pid)
                changed = True
    return teams, roots


def _teams_windows(process_ids: set[int]) -> list[TeamsWindow]:
    if not process_ids:
        return []

    import win32gui
    import win32process
    from pywinauto import Desktop

    handles: list[int] = []

    def collect_handle(hwnd: int, _: object) -> bool:
        try:
            _, process_id = win32process.GetWindowThreadProcessId(hwnd)
            if process_id in process_ids and (
                win32gui.IsWindowVisible(hwnd) or win32gui.IsIconic(hwnd)
            ):
                handles.append(hwnd)
        except Exception:
            pass
        return True

    win32gui.EnumWindows(collect_handle, None)
    desktop = Desktop(backend="uia")
    results: list[TeamsWindow] = []
    for hwnd in handles:
        try:
            _, process_id = win32process.GetWindowThreadProcessId(hwnd)
            wrapper = desktop.window(handle=hwnd)
            controls: list[str] = []
            leave_control = False
            call_toolbar_control = False
            for item in wrapper.descendants():
                info = item.element_info
                if info.control_type != "Button" or not item.is_visible():
                    continue
                name = str(info.name or "").strip()
                automation_id = str(info.automation_id or "").strip()
                is_leave = automation_id == "hangup-button" or name.lower() in {
                    "leave",
                    "leave call",
                }
                is_toolbar = automation_id.startswith(CALL_TOOLBAR_PREFIX)
                if not is_leave and not is_toolbar:
                    continue
                leave_control = leave_control or is_leave
                call_toolbar_control = call_toolbar_control or is_toolbar
                controls.append(f"{name}|{automation_id}|enabled={item.is_enabled()}")

            results.append(
                TeamsWindow(
                    window_id=str(hwnd),
                    process_id=process_id,
                    title=str(win32gui.GetWindowText(hwnd) or "").strip(),
                    class_name=str(win32gui.GetClassName(hwnd) or ""),
                    visible=bool(win32gui.IsWindowVisible(hwnd)),
                    minimized=bool(win32gui.IsIconic(hwnd)),
                    leave_control=leave_control,
                    call_toolbar_control=call_toolbar_control,
                    controls=tuple(sorted(set(controls))),
                )
            )
        except Exception:
            continue

    return sorted(results, key=lambda window: (window.title.lower(), window.window_id))


class TeamsCallTransitionService:
    def __init__(
        self,
        settings: Settings,
        calendar_signal_service: CalendarSignalService | None = None,
    ) -> None:
        self._api_key = (settings.typesafe_api_key or "").strip()
        self._model = settings.typesafe_model
        self._timeout_seconds = settings.typesafe_timeout_seconds
        self._confidence_threshold = settings.typesafe_transition_confidence
        self._calendar_signal_service = calendar_signal_service
        self._previous_snapshot: dict[str, Any] | None = None
        self._previous_signature: str | None = None
        self._previous_decision: Transition = "UNCERTAIN"
        self._active_since: float | None = None
        self._last_jev_evaluation_at: float | None = None
        self._clock = time.monotonic
        self._lock = asyncio.Lock()

    async def evaluate(self) -> dict[str, Any]:
        async with self._lock:
            current = await asyncio.to_thread(capture_teams_snapshot)
            current_signature = snapshot_signature(current)
            now = self._clock()
            periodic_review_due = self._is_periodic_review_due(now)

            if self._previous_signature == current_signature and not periodic_review_due:
                decision: Transition = (
                    "CONTINUE"
                    if self._previous_decision in {"START", "CONTINUE", "SWITCH"}
                    else self._previous_decision
                )
                return self._result(current, decision, 1.0, False, "No feature change")

            previous = self._previous_snapshot

            if not self._api_key:
                return self._result(current, "UNCERTAIN", 0.0, False, "TYPESAFE_API_KEY missing")

            try:
                decision, confidence, probabilities, model = await self._ask_jev(
                    previous,
                    current,
                    periodic_review_due,
                )
            except Exception as exc:
                return self._result(
                    current,
                    "UNCERTAIN",
                    0.0,
                    True,
                    f"Jev unavailable: {type(exc).__name__}",
                )

            if confidence < self._confidence_threshold:
                effective_decision: Transition = "UNCERTAIN"
                reason = f"Jev confidence {confidence:.3f} below threshold"
            else:
                effective_decision = decision
                self._previous_snapshot = current
                self._previous_signature = current_signature
                self._previous_decision = decision
                self._last_jev_evaluation_at = now
                if decision in {"START", "SWITCH"}:
                    self._active_since = now
                elif decision == "END":
                    self._active_since = None
                reason = (
                    "Jev performed scheduled long-call review"
                    if periodic_review_due
                    else "Jev classified changed Teams features"
                )

            result = self._result(current, effective_decision, confidence, True, reason)
            result["probabilities"] = probabilities
            result["model"] = model
            result["raw_decision"] = decision
            return result

    async def _ask_jev(
        self,
        previous: dict[str, Any] | None,
        current: dict[str, Any],
        periodic_review: bool,
    ) -> tuple[Transition, float, dict[str, float], str]:
        calendar_signal = (
            await self._calendar_signal_service.current_signal()
            if self._calendar_signal_service is not None
            else {"meeting_scheduled_now": False}
        )
        payload = {
            "model": self._model,
            "state": {
                "previous_snapshot": previous,
                "current_snapshot": current,
                "previous_stable_decision": self._previous_decision,
                "periodic_long_call_review": periodic_review,
                "calendar_signal": calendar_signal,
            },
            "questions": {
                "call_transition": {
                    "type": "choice",
                    "instructions": (
                        "Classify the Microsoft Teams call transition. Same call can expose "
                        "different title aliases in maximized and minimized modes. Treat mode-only "
                        "title changes as CONTINUE when call-window and toolbar continuity support it. "
                        "If active call evidence remains but a meeting or participant title, owning "
                        "call window, or other call identity evidence changes, classify SWITCH. "
                        "When snapshots contain identical call evidence, classify CONTINUE."
                        " Calendar schedule is supporting context only: it may strengthen START or "
                        "CONTINUE, but a scheduled meeting alone is not active-call evidence. "
                        "A meeting reaching its scheduled end must never cause END; calls may run "
                        "past their calendar end time."
                    ),
                    "criteria": {
                        "START": "No prior active call and current evidence identifies an active call.",
                        "CONTINUE": "The same call remains active, including maximized/minimized title aliases.",
                        "SWITCH": "A different call replaced the prior call, even when there was no idle gap.",
                        "END": "A prior active call ended and current evidence reliably shows no active call.",
                        "UNCERTAIN": "Probe health or call identity evidence is insufficient or contradictory.",
                    },
                }
            },
        }
        headers = {"Authorization": f"Bearer {self._api_key}"}
        timeout = httpx.Timeout(self._timeout_seconds)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                "https://api.typesafe.ai/v1/systemone",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            body = response.json()

        answer = body["answers"]["call_transition"]
        decision = str(answer["choice"]).upper()
        allowed = {"START", "CONTINUE", "SWITCH", "END", "UNCERTAIN"}
        if decision not in allowed:
            raise ValueError(f"Unexpected Jev transition: {decision}")
        return (
            decision,  # type: ignore[return-value]
            float(answer["confidence"]),
            {str(key): float(value) for key, value in answer["probabilities"].items()},
            str(body.get("model") or self._model),
        )

    def _is_periodic_review_due(self, now: float) -> bool:
        if self._previous_decision not in {"START", "CONTINUE", "SWITCH"}:
            return False
        if self._active_since is None or self._last_jev_evaluation_at is None:
            return False
        return (
            now - self._active_since >= LONG_CALL_REVIEW_AFTER_SECONDS
            and now - self._last_jev_evaluation_at >= LONG_CALL_REVIEW_INTERVAL_SECONDS
        )

    def _result(
        self,
        snapshot: dict[str, Any],
        decision: Transition,
        confidence: float,
        evaluated: bool,
        reason: str,
    ) -> dict[str, Any]:
        call_windows = [
            window
            for window in snapshot["windows"]
            if window["leave_control"] and window["call_toolbar_control"]
        ]
        matched_title = next(
            (window["title"] for window in call_windows if window["title"]),
            None,
        )
        return {
            "supported": snapshot["probe_health"] != "unsupported",
            "decision": decision,
            "confidence": confidence,
            "evaluated": evaluated,
            "reason": reason,
            "matched_window_title": matched_title,
            "snapshot": snapshot,
            "probabilities": {},
            "model": self._model,
            "raw_decision": decision,
        }
