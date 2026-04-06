from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from app.core.exceptions import APIError
from app.services.chutes_client import TranscriptionResult

logger = logging.getLogger("app.transactions")


class LocalWhisperClient:
    """Wraps faster-whisper for CPU/GPU transcription."""

    def __init__(
        self,
        *,
        enabled: bool,
        model_size: str,
        device: str,
        compute_type: str,
        download_root: Path,
    ) -> None:
        self.enabled = enabled
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.download_root = download_root
        self._model: Any = None

    def is_ready(self) -> bool:
        return self.enabled and self._model is not None

    async def warmup(self) -> None:
        if not self.enabled:
            return
        try:
            self._model = await asyncio.to_thread(self._load_model)
        except Exception as exc:
            raise APIError(
                code="LOCAL_WHISPER_WARMUP_FAILED",
                message="Failed to load local Whisper model.",
                status_code=503,
                details={"reason": str(exc)},
            ) from exc

    def _load_model(self) -> Any:
        from faster_whisper import WhisperModel

        self.download_root.mkdir(parents=True, exist_ok=True)
        return WhisperModel(
            self.model_size,
            device=self.device,
            compute_type=self.compute_type,
            download_root=str(self.download_root),
        )

    def transcribe_sync(
        self,
        audio_path: Path,
        language: str,
        prompt: str | None,
    ) -> TranscriptionResult:
        if not self.is_ready():
            raise RuntimeError("Local Whisper model is not loaded.")

        assert self._model is not None
        lang = language.strip() if language.strip() else None
        initial_prompt = prompt.strip() if prompt else None

        segments, _info = self._model.transcribe(
            str(audio_path),
            language=lang,
            initial_prompt=initial_prompt,
        )

        chunks: list[dict[str, Any]] = []
        text_parts: list[str] = []
        for segment in segments:
            piece = segment.text.strip()
            if not piece:
                continue
            text_parts.append(piece)
            chunks.append(
                {
                    "start": float(segment.start),
                    "end": float(segment.end),
                    "text": piece,
                }
            )

        text = " ".join(text_parts).strip()
        return TranscriptionResult(text=text, chunks=chunks)
