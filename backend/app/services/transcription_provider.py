from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from app.core.exceptions import APIError
from app.services.chutes_client import ChutesClient, TranscriptionResult
from app.services.local_whisper_client import LocalWhisperClient

logger = logging.getLogger("app.transactions")


class TranscriptionProvider:
    """Prefer local Whisper; fall back to Chutes when configured."""

    def __init__(
        self,
        *,
        local_client: LocalWhisperClient,
        chutes_client: ChutesClient,
    ) -> None:
        self._local = local_client
        self._chutes = chutes_client

    async def warmup(self) -> None:
        await self._local.warmup()

    async def ping(self) -> dict[str, Any]:
        if self._local.is_ready():
            return {
                "status": "ok",
                "reachable": True,
                "detail": f"Local Whisper ({self._local.model_size})",
                "upstream_status_code": None,
                "endpoint": None,
            }
        return await self._chutes.ping()

    def get_transcription_metrics(self) -> dict[str, Any]:
        return self._chutes.get_transcription_metrics()

    async def transcribe_audio(
        self,
        *,
        audio_path: Path,
        language: str,
        prompt: str | None = None,
    ) -> TranscriptionResult:
        if self._local.is_ready():
            try:
                return await asyncio.to_thread(
                    self._local.transcribe_sync,
                    audio_path,
                    language,
                    prompt,
                )
            except Exception as exc:
                logger.warning("local.transcribe.failed", exc_info=exc)
                if self._chutes_configured():
                    return await self._chutes.transcribe_audio(audio_path, language, prompt)
                raise APIError(
                    code="LOCAL_TRANSCRIPTION_FAILED",
                    message="Local transcription failed and no cloud fallback is configured.",
                    status_code=502,
                    details={"reason": str(exc)},
                ) from exc

        return await self._chutes.transcribe_audio(audio_path, language, prompt)

    def _chutes_configured(self) -> bool:
        return bool(self._chutes.api_url and self._chutes.api_key)
