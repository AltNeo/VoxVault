from __future__ import annotations

import asyncio
import platform
import sqlite3
import ssl
import time
from contextlib import closing
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
JEV_AMBIGUITY_SECONDS = 30
JEV_DAILY_LIMIT = 5
UNKNOWN_CALL_SECONDS = 10 * 60


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
    controls_readable: bool = True


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
        _, process_id = win32process.GetWindowThreadProcessId(hwnd)
        title = str(win32gui.GetWindowText(hwnd) or "").strip()
        class_name = str(win32gui.GetClassName(hwnd) or "")
        visible = bool(win32gui.IsWindowVisible(hwnd))
        minimized = bool(win32gui.IsIconic(hwnd))
        controls: list[str] = []
        leave_control = False
        call_toolbar_control = False
        controls_readable = True
        try:
            wrapper = desktop.window(handle=hwnd)
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

        except Exception:
            if not win32gui.IsWindow(hwnd):
                continue
            controls_readable = False

        results.append(
            TeamsWindow(
                window_id=str(hwnd),
                process_id=process_id,
                title=title,
                class_name=class_name,
                visible=visible,
                minimized=minimized,
                leave_control=controls_readable and leave_control,
                call_toolbar_control=controls_readable and call_toolbar_control,
                controls=tuple(sorted(set(controls))),
                controls_readable=controls_readable,
            )
        )

    return sorted(results, key=lambda window: (window.title.lower(), window.window_id))


def _window_closed(identity: tuple[int, str]) -> bool:
    import win32gui
    import win32process

    process_id, window_id = identity
    hwnd = int(window_id)
    try:
        return (
            not win32gui.IsWindow(hwnd)
            or win32process.GetWindowThreadProcessId(hwnd)[1] != process_id
        )
    except Exception:
        return False


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
        self._previous_decision: Transition = "UNCERTAIN"
        self._active: dict[str, Any] | None = None
        self._candidate: tuple[int, str] | None = None
        self._missing_polls = 0
        self._unknown_since: float | None = None
        self._ambiguity: tuple[tuple[int, str], ...] = ()
        self._ambiguity_since = 0.0
        self._attempted: set[tuple[tuple[int, str], ...]] = set()
        self._jev_blocked_day: str | None = None
        self._budget_path = settings.sqlite_path
        self._clock = time.monotonic
        self._lock = asyncio.Lock()

    @staticmethod
    def _identity(window: dict[str, Any]) -> tuple[int, str]:
        return window["process_id"], window["window_id"]

    def _reserve_jev_request(self, day: str) -> bool:
        with closing(sqlite3.connect(self._budget_path)) as db, db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS teams_jev_budget "
                "(day TEXT PRIMARY KEY, requests INTEGER NOT NULL, blocked INTEGER NOT NULL)"
            )
            cursor = db.execute(
                "INSERT INTO teams_jev_budget VALUES (?, 1, 0) "
                "ON CONFLICT(day) DO UPDATE SET requests = requests + 1 "
                "WHERE requests < ? AND blocked = 0",
                (day, JEV_DAILY_LIMIT),
            )
            return cursor.rowcount == 1

    def _block_jev(self, day: str) -> None:
        with closing(sqlite3.connect(self._budget_path)) as db, db:
            db.execute("UPDATE teams_jev_budget SET blocked = 1 WHERE day = ?", (day,))

    async def evaluate(self) -> dict[str, Any]:
        async with self._lock:
            current = await asyncio.to_thread(capture_teams_snapshot)
            now = self._clock()
            healthy = current["probe_health"] == "good"
            windows = {self._identity(window): window for window in current["windows"]}
            calls = (
                {
                    key: window
                    for key, window in windows.items()
                    if window["leave_control"] and window["call_toolbar_control"]
                }
                if healthy
                else {}
            )
            active_key = self._identity(self._active) if self._active else None
            tracked = windows.get(active_key)
            decision: Transition = "UNCERTAIN"
            ended = False
            if self._active:
                if active_key in calls:
                    self._missing_polls = 0
                    self._unknown_since = None
                    decision = "CONTINUE"
                elif healthy and (
                    not current["teams_running"]
                    or (tracked is None and await asyncio.to_thread(_window_closed, active_key))
                ):
                    ended = True
                elif (
                    healthy
                    and tracked
                    and tracked["controls_readable"]
                    and tracked["visible"]
                    and not tracked["minimized"]
                    and not tracked["leave_control"]
                    and not tracked["call_toolbar_control"]
                ):
                    self._unknown_since = None
                    self._missing_polls += 1
                    ended = self._missing_polls >= 3
                else:
                    self._missing_polls = 0
                    if self._unknown_since is None:
                        self._unknown_since = now
                    ended = now - self._unknown_since >= UNKNOWN_CALL_SECONDS

            if ended:
                self._active = None
                self._candidate = None
                self._missing_polls = 0
                self._unknown_since = None
                self._attempted.clear()
                decision = "END"
            elif self._active is None and len(calls) == 1:
                key, candidate = next(iter(calls.items()))
                if self._candidate == key:
                    self._active = candidate
                    self._candidate = None
                    self._attempted.clear()
                    decision = "START"
                else:
                    self._candidate = key
            else:
                self._candidate = None

            if healthy and not ended and len(calls) > 1 and self._active is None:
                ambiguity = tuple(sorted(calls))
            elif healthy and not ended and self._active and active_key not in calls and calls:
                ambiguity = tuple(sorted(calls))
            else:
                ambiguity = ()

            if not healthy:
                self._ambiguity_since = now
            elif ambiguity != self._ambiguity:
                self._ambiguity = ambiguity
                self._ambiguity_since = now
            if (
                ambiguity
                and self._api_key
                and ambiguity not in self._attempted
                and now - self._ambiguity_since >= JEV_AMBIGUITY_SECONDS
            ):
                self._attempted.add(ambiguity)
                return await self._resolve_ambiguity(current, calls)

            if decision in {"START", "CONTINUE", "END"}:
                self._previous_decision = decision
            if decision in {"START", "CONTINUE"}:
                self._previous_snapshot = current
            return self._result(
                current, decision, float(decision != "UNCERTAIN"), False, "Local Teams rules"
            )

    async def _resolve_ambiguity(
        self, current: dict[str, Any], calls: dict[tuple[int, str], dict[str, Any]]
    ) -> dict[str, Any]:
        day = datetime.now().astimezone().date().isoformat()
        if self._jev_blocked_day == day:
            return self._result(current, "UNCERTAIN", 0.0, False, "Jev paused for today: HTTP 402")
        try:
            if not await asyncio.to_thread(self._reserve_jev_request, day):
                return self._result(
                    current, "UNCERTAIN", 0.0, False, "Jev daily budget unavailable"
                )
        except sqlite3.Error:
            return self._result(current, "UNCERTAIN", 0.0, False, "Jev budget storage unavailable")

        try:
            raw, confidence, probabilities, model, selected = await self._ask_jev(
                self._previous_snapshot if self._active else None, current
            )
        except Exception as exc:
            reason = f"Jev unavailable: {type(exc).__name__}"
            if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 402:
                reason = "Jev paused for today: HTTP 402"
                self._jev_blocked_day = day
                try:
                    await asyncio.to_thread(self._block_jev, day)
                except sqlite3.Error:
                    pass
            return self._result(current, "UNCERTAIN", 0.0, True, reason)

        decision: Transition = "UNCERTAIN"
        if confidence >= self._confidence_threshold:
            replacement = (
                next(iter(calls.values()))
                if len(calls) == 1
                else next(
                    (window for window in calls.values() if window["window_id"] == selected), None
                )
            )
            allowed = {"CONTINUE", "SWITCH"} if self._active else {"START"}
            if replacement is not None and raw in allowed:
                self._active = (
                    replacement
                    if raw == "SWITCH"
                    else {
                        **replacement,
                        "title": self._active["title"] if self._active else replacement["title"],
                    }
                )
                self._missing_polls = 0
                self._unknown_since = None
                self._previous_snapshot = current
                self._previous_decision = raw
                if raw != "CONTINUE":
                    self._attempted.clear()
                decision = raw
        result = self._result(current, decision, confidence, True, "Jev ambiguity review")
        result.update(probabilities=probabilities, model=model, raw_decision=raw)
        return result

    async def _ask_jev(
        self,
        previous: dict[str, Any] | None,
        current: dict[str, Any],
    ) -> tuple[Transition, float, dict[str, float], str, str | None]:
        calendar_signal = (
            await self._calendar_signal_service.current_signal()
            if self._calendar_signal_service is not None
            else {"meeting_scheduled_now": False}
        )

        def call_evidence(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
            if snapshot is None:
                return None
            return {
                "teams_running": snapshot["teams_running"],
                "probe_health": snapshot["probe_health"],
                "windows": [
                    {
                        key: window[key]
                        for key in (
                            "window_id",
                            "visible",
                            "minimized",
                            "leave_control",
                            "call_toolbar_control",
                            "controls_readable",
                        )
                    }
                    for window in snapshot["windows"]
                    if window["leave_control"]
                    or window["call_toolbar_control"]
                    or (self._active and self._identity(window) == self._identity(self._active))
                ],
            }

        payload = {
            "model": self._model,
            "state": {
                "previous_snapshot": call_evidence(previous),
                "current_snapshot": call_evidence(current),
                "tracked_window_id": self._active["window_id"] if self._active else None,
                "previous_stable_decision": self._previous_decision,
                "calendar_signal": calendar_signal,
            },
            "questions": {
                "call_transition": {
                    "type": "choice",
                    "instructions": (
                        "Classify the Microsoft Teams call transition from window and toolbar evidence. "
                        "A new window handle alone may be a pop-out or a mode change. "
                        "Only classify SWITCH if the evidence identifies a different call. "
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
        candidates = {
            window["window_id"]: f"Window {window['window_id']}"
            for window in current["windows"]
            if window["leave_control"] and window["call_toolbar_control"]
        }
        if len(candidates) > 1:
            payload["questions"]["call_window"] = {
                "type": "choice",
                "instructions": "Select the window that owns the active call. Choose unknown if unclear.",
                "criteria": {**candidates, "unknown": "The active window is unclear"},
            }
        headers = {"Authorization": f"Bearer {self._api_key}"}
        timeout = httpx.Timeout(self._timeout_seconds)
        async with httpx.AsyncClient(
            timeout=timeout, verify=ssl.create_default_context()
        ) as client:
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
        window_answer = body["answers"].get("call_window", {})
        selected = (
            str(window_answer["choice"])
            if float(window_answer.get("confidence", 0)) >= self._confidence_threshold
            else None
        )
        return (
            decision,  # type: ignore[return-value]
            float(answer["confidence"]),
            {str(key): float(value) for key, value in answer["probabilities"].items()},
            str(body.get("model") or self._model),
            selected,
        )

    def _result(
        self,
        snapshot: dict[str, Any],
        decision: Transition,
        confidence: float,
        evaluated: bool,
        reason: str,
    ) -> dict[str, Any]:
        matched_title = (self._active["title"] or "Microsoft Teams call") if self._active else None
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
