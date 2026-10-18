from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import Any

import httpx

from app.core.exceptions import APIError
from app.services.chutes_client import TranscriptionResult

logger = logging.getLogger("app.transactions")


class GeminiClient:
    """Gemini API client for audio transcription with an AI Studio key."""

    base_url = "https://generativelanguage.googleapis.com/v1beta/models"
    max_inline_bytes = 14 * 1024 * 1024

    def __init__(self, *, api_key: str | None, model: str, timeout_seconds: float) -> None:
        self.api_key = api_key.strip() if api_key else None
        self.model = model
        self.timeout_seconds = timeout_seconds

    @property
    def endpoint(self) -> str:
        return f"{self.base_url}/{self.model}:generateContent"

    def is_configured(self) -> bool:
        return bool(self.api_key)

    async def transcribe_audio(
        self,
        audio_path: Path,
        language: str,
        prompt: str | None = None,
    ) -> TranscriptionResult:
        if not self.api_key:
            raise APIError(
                code="GEMINI_NOT_CONFIGURED",
                message="Gemini is not configured.",
                status_code=503,
            )

        try:
            audio_bytes = audio_path.read_bytes()
        except OSError as exc:
            raise APIError(
                code="AUDIO_READ_FAILED",
                message="Unable to read audio for transcription.",
                status_code=500,
            ) from exc

        if len(audio_bytes) > self.max_inline_bytes:
            raise APIError(
                code="GEMINI_AUDIO_TOO_LARGE",
                message="Audio is too large for Gemini inline transcription.",
                status_code=413,
            )

        language_hint = language.strip() or "the detected language"
        prompt_text = (
            "Transcribe all spoken words in this audio exactly. "
            f"The expected language is {language_hint}. "
            "Return only the transcript, with no commentary, labels, or summary."
        )
        normalized_prompt = prompt.strip() if prompt else ""
        if normalized_prompt:
            prompt_text += f"\nUse these spelling hints when relevant: {normalized_prompt}"

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt_text},
                        {
                            "inlineData": {
                                "mimeType": self._mime_type(audio_path),
                                "data": base64.b64encode(audio_bytes).decode("ascii"),
                            }
                        },
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0,
                "responseMimeType": "text/plain",
            },
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(
                    self.endpoint,
                    headers={
                        "x-goog-api-key": self.api_key,
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
        except httpx.TimeoutException as exc:
            raise APIError(
                code="GEMINI_TIMEOUT",
                message="Gemini transcription timed out.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise APIError(
                code="GEMINI_CONNECTION_ERROR",
                message="Unable to reach Gemini.",
                status_code=502,
            ) from exc

        if response.status_code >= 400:
            logger.warning("gemini.transcribe.failed status_code=%s", response.status_code)
            raise APIError(
                code="GEMINI_REQUEST_FAILED",
                message="Gemini returned an error while transcribing audio.",
                status_code=502,
                details={"upstream_status_code": response.status_code},
            )

        try:
            response_payload = response.json()
        except ValueError as exc:
            raise APIError(
                code="GEMINI_INVALID_RESPONSE",
                message="Gemini returned invalid JSON.",
                status_code=502,
            ) from exc

        text = self._extract_text(response_payload)
        if not text:
            raise APIError(
                code="EMPTY_TRANSCRIPTION",
                message="Gemini returned empty transcription text.",
                status_code=502,
            )
        return TranscriptionResult(
            text=text,
            chunks=[{"start": 0.0, "end": 0.0, "text": text}],
        )

    @staticmethod
    def _mime_type(audio_path: Path) -> str:
        return {
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
            ".webm": "audio/webm",
            ".m4a": "audio/mp4",
        }.get(audio_path.suffix.lower(), "application/octet-stream")

    @staticmethod
    def _extract_text(payload: Any) -> str:
        if not isinstance(payload, dict):
            return ""
        candidates = payload.get("candidates", [])
        if not isinstance(candidates, list):
            return ""
        text_parts: list[str] = []
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            content = candidate.get("content", {})
            parts = content.get("parts", []) if isinstance(content, dict) else []
            if not isinstance(parts, list):
                continue
            for part in parts:
                if isinstance(part, dict) and part.get("text"):
                    text_parts.append(str(part["text"]).strip())
        return "\n".join(part for part in text_parts if part).strip()
