import base64
import logging
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Any

import httpx

from app.core.exceptions import APIError
from app.db.storage import TranscriptionStorage

logger = logging.getLogger("app.transactions")


@dataclass(slots=True)
class TranscriptionResult:
    text: str
    chunks: list[dict[str, Any]]


class ChutesClient:
    def __init__(
        self,
        *,
        api_url: str | None,
        api_key: str | None,
        timeout_seconds: float,
        storage: TranscriptionStorage | None = None,
    ) -> None:
        self.api_url = api_url.rstrip("/") if api_url else None
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self.storage = storage

    async def ping(self) -> dict[str, Any]:
        if not self.api_url or not self.api_key:
            return {
                "status": "not_configured",
                "reachable": False,
                "detail": "Set CHUTES_API_URL and CHUTES_API_KEY (or CHUTES_API_TOKEN).",
            }

        endpoint = self._resolve_endpoint(self.api_url)
        start_time = perf_counter()
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(
                    endpoint,
                    headers=self._headers(),
                    json={"audio_b64": "example-string"},
                )
        except httpx.TimeoutException as exc:
            duration_ms = (perf_counter() - start_time) * 1000
            logger.warning(
                "upstream.ping.timeout endpoint=%s duration_ms=%.2f",
                endpoint,
                duration_ms,
            )
            raise APIError(
                code="CHUTES_TIMEOUT",
                message="Transcription provider timed out during ping.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            duration_ms = (perf_counter() - start_time) * 1000
            logger.warning(
                "upstream.ping.connection_error endpoint=%s duration_ms=%.2f",
                endpoint,
                duration_ms,
            )
            raise APIError(
                code="CHUTES_CONNECTION_ERROR",
                message="Unable to reach transcription provider during ping.",
                status_code=502,
            ) from exc
        duration_ms = (perf_counter() - start_time) * 1000
        logger.info(
            "upstream.ping.completed endpoint=%s status_code=%s duration_ms=%.2f",
            endpoint,
            response.status_code,
            duration_ms,
        )

        if response.status_code in {401, 403}:
            return {
                "status": "auth_failed",
                "reachable": True,
                "detail": "Provider reached, but authentication failed.",
                "upstream_status_code": response.status_code,
            }
        if response.status_code == 404:
            return {
                "status": "endpoint_not_found",
                "reachable": True,
                "detail": "Provider reached, but the configured CHUTES_API_URL is not a valid model endpoint.",
                "upstream_status_code": response.status_code,
            }
        if response.status_code >= 500:
            return {
                "status": "upstream_error",
                "reachable": True,
                "detail": "Provider returned a server error.",
                "upstream_status_code": response.status_code,
            }

        # 2xx or 4xx (except auth/404) confirms network path + auth header format.
        return {
            "status": "ok",
            "reachable": True,
            "upstream_status_code": response.status_code,
            "endpoint": endpoint,
        }

    async def transcribe_audio(self, audio_path: Path, language: str) -> TranscriptionResult:
        if not self.api_url or not self.api_key:
            return self._mock_transcription(audio_path=audio_path, language=language)

        try:
            audio_bytes = audio_path.read_bytes()
        except OSError as exc:
            raise APIError(
                code="AUDIO_READ_FAILED",
                message="Unable to read audio for transcription.",
                status_code=500,
            ) from exc

        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
        endpoint = self._resolve_endpoint(self.api_url)
        start_time = perf_counter()

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(
                    endpoint,
                    headers=self._headers(),
                    json={
                        "audio_b64": audio_b64,
                        "language": language,
                    },
                )
        except httpx.TimeoutException as exc:
            duration_ms = (perf_counter() - start_time) * 1000
            stats = self._record_transcription_metric(
                audio_bytes=len(audio_bytes),
                duration_ms=duration_ms,
                status="timeout",
                upstream_status_code=None,
            )
            logger.warning(
                "upstream.transcribe.timeout endpoint=%s audio_bytes=%s audio_mb=%.2f duration_ms=%.2f avg_duration_ms=%.2f avg_audio_mb=%.2f avg_ms_per_mb=%.2f total_calls=%s",
                endpoint,
                len(audio_bytes),
                stats["audio_mb"],
                duration_ms,
                stats["average_duration_ms"],
                stats["average_audio_mb"],
                stats["average_ms_per_mb"],
                stats["total_calls"],
            )
            raise APIError(
                code="CHUTES_TIMEOUT",
                message="Transcription provider timed out.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            duration_ms = (perf_counter() - start_time) * 1000
            stats = self._record_transcription_metric(
                audio_bytes=len(audio_bytes),
                duration_ms=duration_ms,
                status="connection_error",
                upstream_status_code=None,
            )
            logger.warning(
                "upstream.transcribe.connection_error endpoint=%s audio_bytes=%s audio_mb=%.2f duration_ms=%.2f avg_duration_ms=%.2f avg_audio_mb=%.2f avg_ms_per_mb=%.2f total_calls=%s",
                endpoint,
                len(audio_bytes),
                stats["audio_mb"],
                duration_ms,
                stats["average_duration_ms"],
                stats["average_audio_mb"],
                stats["average_ms_per_mb"],
                stats["total_calls"],
            )
            raise APIError(
                code="CHUTES_CONNECTION_ERROR",
                message="Unable to reach transcription provider.",
                status_code=502,
            ) from exc
        duration_ms = (perf_counter() - start_time) * 1000
        response_status = int(response.status_code)
        status_name = "completed" if response_status < 400 else "http_error"
        stats = self._record_transcription_metric(
            audio_bytes=len(audio_bytes),
            duration_ms=duration_ms,
            status=status_name,
            upstream_status_code=response_status,
        )
        logger.info(
            "upstream.transcribe.%s endpoint=%s status_code=%s audio_bytes=%s audio_mb=%.2f duration_ms=%.2f avg_duration_ms=%.2f avg_audio_mb=%.2f avg_ms_per_mb=%.2f total_calls=%s",
            status_name,
            endpoint,
            response.status_code,
            len(audio_bytes),
            stats["audio_mb"],
            duration_ms,
            stats["average_duration_ms"],
            stats["average_audio_mb"],
            stats["average_ms_per_mb"],
            stats["total_calls"],
        )

        if response.status_code >= 400:
            raise APIError(
                code="CHUTES_REQUEST_FAILED",
                message="Transcription provider returned an error.",
                status_code=502,
                details={"upstream_status_code": response.status_code},
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise APIError(
                code="CHUTES_INVALID_RESPONSE",
                message="Transcription provider returned invalid JSON.",
                status_code=502,
            ) from exc

        text, chunks = self._extract_text_and_chunks(payload)

        if not text:
            raise APIError(
                code="EMPTY_TRANSCRIPTION",
                message="Transcription provider returned empty text.",
                status_code=502,
            )
        return TranscriptionResult(text=text, chunks=chunks)

    def get_transcription_metrics(self) -> dict[str, Any]:
        if self.storage is None:
            return {
                "total_calls": 0,
                "average_duration_ms": 0.0,
                "average_audio_bytes": 0.0,
                "average_audio_mb": 0.0,
                "average_ms_per_mb": 0.0,
                "recent_samples": [],
            }
        return self.storage.get_transcription_metrics()

    @staticmethod
    def _resolve_endpoint(api_url: str) -> str:
        return api_url if api_url.endswith("/transcribe") else f"{api_url}/transcribe"

    def _headers(self) -> dict[str, str]:
        if self.api_key is None:
            return {"Content-Type": "application/json"}
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _record_transcription_metric(
        self,
        *,
        audio_bytes: int,
        duration_ms: float,
        status: str,
        upstream_status_code: int | None,
    ) -> dict[str, float | int]:
        if self.storage is None:
            return {
                "total_calls": 0,
                "average_duration_ms": 0.0,
                "average_audio_mb": 0.0,
                "average_ms_per_mb": 0.0,
                "audio_mb": audio_bytes / (1024 * 1024),
            }

        try:
            self.storage.create_transcription_metric(
                audio_bytes=audio_bytes,
                duration_ms=duration_ms,
                status=status,
                upstream_status_code=upstream_status_code,
            )
            metrics = self.storage.get_transcription_metrics(recent_limit=0)
        except Exception:
            logger.exception(
                "upstream.transcribe.metrics_persist_failed audio_bytes=%s duration_ms=%.2f status=%s",
                audio_bytes,
                duration_ms,
                status,
            )
            return {
                "total_calls": 0,
                "average_duration_ms": 0.0,
                "average_audio_mb": 0.0,
                "average_ms_per_mb": 0.0,
                "audio_mb": audio_bytes / (1024 * 1024),
            }

        return {
            "total_calls": int(metrics["total_calls"]),
            "average_duration_ms": float(metrics["average_duration_ms"]),
            "average_audio_mb": float(metrics["average_audio_mb"]),
            "average_ms_per_mb": float(metrics["average_ms_per_mb"]),
            "audio_mb": audio_bytes / (1024 * 1024),
        }

    def _extract_text_and_chunks(self, payload: Any) -> tuple[str, list[dict[str, Any]]]:
        if isinstance(payload, dict):
            text = str(payload.get("text", "")).strip()
            chunks = self._normalize_chunks(payload.get("chunks", []))
            if not text and chunks:
                text = " ".join(chunk["text"] for chunk in chunks).strip()
            return text, chunks

        if isinstance(payload, list):
            chunks = self._normalize_chunks(payload)
            text = " ".join(chunk["text"] for chunk in chunks).strip()
            return text, chunks

        return "", []

    @staticmethod
    def _normalize_chunks(raw_chunks: Any) -> list[dict[str, Any]]:
        if not isinstance(raw_chunks, list):
            return []

        def _to_float(value: Any, default: float) -> float:
            try:
                if value is None:
                    return default
                return float(value)
            except (TypeError, ValueError):
                return default

        normalized: list[dict[str, Any]] = []
        for chunk in raw_chunks:
            if not isinstance(chunk, dict):
                continue
            text = str(chunk.get("text", "")).strip()
            if not text:
                continue
            start = _to_float(chunk.get("start", 0.0), 0.0)
            end = _to_float(chunk.get("end", start), start)
            normalized.append(
                {
                    "start": start,
                    "end": end,
                    "text": text,
                }
            )
        return normalized

    @staticmethod
    def _mock_transcription(*, audio_path: Path, language: str) -> TranscriptionResult:
        text = (
            f"Mock transcription for {audio_path.name} ({language}). "
            "Set CHUTES_API_URL and CHUTES_API_KEY for live transcription."
        )
        return TranscriptionResult(
            text=text,
            chunks=[
                {
                    "start": 0.0,
                    "end": 0.0,
                    "text": text,
                }
            ],
        )
