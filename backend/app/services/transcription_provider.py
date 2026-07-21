from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from app.core.exceptions import APIError
from app.services.chutes_client import ChutesClient, TranscriptionResult
from app.services.gemini_client import GeminiClient
from app.services.local_whisper_client import LocalWhisperClient

logger = logging.getLogger("app.transactions")


class TranscriptionProvider:
    """Prefer Gemini audio transcription and lazily fall back to local Whisper."""

    def __init__(
        self,
        *,
        google_client: GeminiClient,
        local_client: LocalWhisperClient,
        chutes_client: ChutesClient,
    ) -> None:
        self._google = google_client
        self._local = local_client
        self._chutes = chutes_client

    async def warmup(self) -> None:
        # Keep startup light; local Whisper is loaded only after Google fails.
        return None

    async def ping(self) -> dict[str, Any]:
        if self._google.is_configured():
            return {
                "status": "ok",
                "reachable": True,
                "detail": f"Gemini audio transcription configured ({self._google.model})",
                "upstream_status_code": None,
                "endpoint": self._google.endpoint,
            }
        if self._local.is_ready():
            return {
                "status": "ok",
                "reachable": True,
                "detail": f"Local Whisper ({self._local.model_size})",
                "upstream_status_code": None,
                "endpoint": None,
            }
        return {
            "status": "not_configured",
            "reachable": False,
            "detail": "Set GEMINI_API_KEY or GOOGLE_API_KEY to use Gemini audio transcription.",
            "upstream_status_code": None,
            "endpoint": None,
        }

    def get_transcription_metrics(self) -> dict[str, Any]:
        return self._chutes.get_transcription_metrics()

    async def transcribe_audio(
        self,
        *,
        audio_path: Path,
        language: str,
        prompt: str | None = None,
    ) -> TranscriptionResult:
        if self._google.is_configured():
            try:
                return await self._google.transcribe_audio(audio_path, language, prompt)
            except Exception as exc:
                logger.warning("gemini.transcribe.failed; falling back to local", exc_info=exc)

        if self._local.enabled:
            try:
                await self._local.ensure_ready()
                return await asyncio.to_thread(
                    self._local.transcribe_sync,
                    audio_path,
                    language,
                    prompt,
                )
            except Exception as exc:
                logger.warning("local.transcribe.failed", exc_info=exc)
                raise APIError(
                    code="LOCAL_TRANSCRIPTION_FAILED",
                    message="Gemini transcription failed and local transcription was unavailable.",
                    status_code=502,
                    details={"reason": str(exc)},
                ) from exc

        # Preserve the existing no-provider mock for local test/development runs.
        return await self._chutes.transcribe_audio(audio_path, language, prompt)
