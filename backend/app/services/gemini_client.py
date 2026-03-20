import json
import logging
import mimetypes
from pathlib import Path
from time import perf_counter
from typing import Any

import httpx

from app.core.exceptions import APIError
from app.db.storage import TranscriptionStorage
from app.services.transcription_provider import TranscriptionResult

logger = logging.getLogger("app.transactions")

_TRANSCRIPTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "text": {
            "type": "string",
            "description": "The complete transcript as plain text.",
        },
        "chunks": {
            "type": "array",
            "description": "Chronological transcript segments with second-based timestamps.",
            "items": {
                "type": "object",
                "properties": {
                    "start": {"type": "number"},
                    "end": {"type": "number"},
                    "text": {"type": "string"},
                },
                "required": ["start", "end", "text"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["text", "chunks"],
    "additionalProperties": False,
}


class GeminiClient:
    def __init__(
        self,
        *,
        api_key: str | None,
        model: str,
        api_base_url: str,
        timeout_seconds: float,
        storage: TranscriptionStorage | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model.strip()
        self.api_base_url = api_base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.storage = storage

    async def ping(self) -> dict[str, Any]:
        if not self.api_key:
            return {
                "status": "not_configured",
                "reachable": False,
                "detail": "Set GEMINI_API_KEY to enable Google AI Studio transcription.",
                "provider": "gemini",
            }

        endpoint = self._generate_content_endpoint()
        start_time = perf_counter()
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(
                    endpoint,
                    headers=self._headers(),
                    json={
                        "contents": [
                            {
                                "parts": [
                                    {
                                        "text": "Reply with the single word ok.",
                                    }
                                ]
                            }
                        ]
                    },
                )
        except httpx.TimeoutException as exc:
            duration_ms = (perf_counter() - start_time) * 1000
            logger.warning(
                "upstream.ping.timeout provider=gemini endpoint=%s duration_ms=%.2f",
                endpoint,
                duration_ms,
            )
            raise APIError(
                code="GEMINI_TIMEOUT",
                message="Gemini timed out during ping.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            duration_ms = (perf_counter() - start_time) * 1000
            logger.warning(
                "upstream.ping.connection_error provider=gemini endpoint=%s duration_ms=%.2f",
                endpoint,
                duration_ms,
            )
            raise APIError(
                code="GEMINI_CONNECTION_ERROR",
                message="Unable to reach Gemini during ping.",
                status_code=502,
            ) from exc

        duration_ms = (perf_counter() - start_time) * 1000
        logger.info(
            "upstream.ping.completed provider=gemini endpoint=%s status_code=%s duration_ms=%.2f",
            endpoint,
            response.status_code,
            duration_ms,
        )

        return self._build_ping_response(response.status_code, endpoint)

    async def transcribe_audio(
        self,
        audio_path: Path,
        language: str,
        prompt: str | None = None,
    ) -> TranscriptionResult:
        if not self.api_key:
            return self._mock_transcription(audio_path=audio_path, language=language)

        try:
            audio_bytes = audio_path.read_bytes()
        except OSError as exc:
            raise APIError(
                code="AUDIO_READ_FAILED",
                message="Unable to read audio for transcription.",
                status_code=500,
            ) from exc

        mime_type = self._resolve_mime_type(audio_path)
        start_time = perf_counter()
        uploaded_file_name: str | None = None

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                upload_result = await self._upload_file(
                    client=client,
                    audio_path=audio_path,
                    audio_bytes=audio_bytes,
                    mime_type=mime_type,
                )
                uploaded_file_name = upload_result["name"]
                response = await client.post(
                    self._generate_content_endpoint(),
                    headers=self._headers(),
                    json=self._build_transcription_request(
                        file_uri=upload_result["uri"],
                        mime_type=upload_result["mime_type"],
                        language=language,
                        prompt=prompt,
                    ),
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
                "upstream.transcribe.timeout provider=gemini model=%s audio_bytes=%s audio_mb=%.2f duration_ms=%.2f avg_duration_ms=%.2f avg_audio_mb=%.2f avg_ms_per_mb=%.2f total_calls=%s",
                self.model,
                len(audio_bytes),
                stats["audio_mb"],
                duration_ms,
                stats["average_duration_ms"],
                stats["average_audio_mb"],
                stats["average_ms_per_mb"],
                stats["total_calls"],
            )
            raise APIError(
                code="GEMINI_TIMEOUT",
                message="Gemini timed out while transcribing audio.",
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
                "upstream.transcribe.connection_error provider=gemini model=%s audio_bytes=%s audio_mb=%.2f duration_ms=%.2f avg_duration_ms=%.2f avg_audio_mb=%.2f avg_ms_per_mb=%.2f total_calls=%s",
                self.model,
                len(audio_bytes),
                stats["audio_mb"],
                duration_ms,
                stats["average_duration_ms"],
                stats["average_audio_mb"],
                stats["average_ms_per_mb"],
                stats["total_calls"],
            )
            raise APIError(
                code="GEMINI_CONNECTION_ERROR",
                message="Unable to reach Gemini transcription services.",
                status_code=502,
            ) from exc
        finally:
            if uploaded_file_name:
                await self._delete_file(uploaded_file_name)

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
            "upstream.transcribe.%s provider=gemini model=%s status_code=%s audio_bytes=%s audio_mb=%.2f duration_ms=%.2f avg_duration_ms=%.2f avg_audio_mb=%.2f avg_ms_per_mb=%.2f total_calls=%s",
            status_name,
            self.model,
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
                code="GEMINI_REQUEST_FAILED",
                message="Gemini returned an error while transcribing audio.",
                status_code=502,
                details={"upstream_status_code": response.status_code},
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise APIError(
                code="GEMINI_INVALID_RESPONSE",
                message="Gemini returned invalid JSON.",
                status_code=502,
            ) from exc

        text, chunks = self._extract_text_and_chunks(payload)
        if not text:
            raise APIError(
                code="EMPTY_TRANSCRIPTION",
                message="Gemini returned empty transcription text.",
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

    def _build_ping_response(self, status_code: int, endpoint: str) -> dict[str, Any]:
        response: dict[str, Any] = {
            "reachable": status_code < 500,
            "upstream_status_code": status_code,
            "endpoint": endpoint,
            "provider": "gemini",
        }
        if status_code < 400:
            response["status"] = "ok"
            return response
        if status_code in {401, 403}:
            response["status"] = "auth_failed"
            response["detail"] = "Gemini endpoint reached, but authentication failed."
            response["reachable"] = True
            return response
        if status_code == 404:
            response["status"] = "endpoint_not_found"
            response["detail"] = "Gemini model endpoint was not found."
            response["reachable"] = True
            return response
        if status_code >= 500:
            response["status"] = "upstream_error"
            response["detail"] = "Gemini returned a server error."
            return response
        response["status"] = "ok"
        return response

    async def _upload_file(
        self,
        *,
        client: httpx.AsyncClient,
        audio_path: Path,
        audio_bytes: bytes,
        mime_type: str,
    ) -> dict[str, str]:
        start_response = await client.post(
            f"{self.api_base_url}/upload/v1beta/files",
            headers={
                **self._headers(),
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": str(len(audio_bytes)),
                "X-Goog-Upload-Header-Content-Type": mime_type,
            },
            json={"file": {"display_name": audio_path.name}},
        )
        if start_response.status_code >= 400:
            raise APIError(
                code="GEMINI_UPLOAD_START_FAILED",
                message="Gemini rejected the file upload start request.",
                status_code=502,
                details={"upstream_status_code": start_response.status_code},
            )

        upload_url = start_response.headers.get("x-goog-upload-url")
        if not upload_url:
            raise APIError(
                code="GEMINI_UPLOAD_URL_MISSING",
                message="Gemini did not return an upload URL.",
                status_code=502,
            )

        upload_response = await client.post(
            upload_url,
            headers={
                "Content-Length": str(len(audio_bytes)),
                "X-Goog-Upload-Offset": "0",
                "X-Goog-Upload-Command": "upload, finalize",
            },
            content=audio_bytes,
        )
        if upload_response.status_code >= 400:
            raise APIError(
                code="GEMINI_UPLOAD_FAILED",
                message="Gemini rejected the audio file upload.",
                status_code=502,
                details={"upstream_status_code": upload_response.status_code},
            )

        try:
            payload = upload_response.json()
        except ValueError as exc:
            raise APIError(
                code="GEMINI_UPLOAD_INVALID_RESPONSE",
                message="Gemini returned invalid JSON during file upload.",
                status_code=502,
            ) from exc

        file_payload = payload.get("file") if isinstance(payload, dict) else None
        if not isinstance(file_payload, dict):
            raise APIError(
                code="GEMINI_UPLOAD_FILE_MISSING",
                message="Gemini upload response did not include a file resource.",
                status_code=502,
            )

        file_name = str(file_payload.get("name", "")).strip()
        file_uri = str(file_payload.get("uri", "")).strip()
        resolved_mime_type = str(file_payload.get("mimeType", "")).strip() or mime_type
        if not file_name or not file_uri:
            raise APIError(
                code="GEMINI_UPLOAD_FILE_INVALID",
                message="Gemini upload response did not include a usable file reference.",
                status_code=502,
            )

        return {
            "name": file_name,
            "uri": file_uri,
            "mime_type": resolved_mime_type,
        }

    async def _delete_file(self, file_name: str) -> None:
        if not self.api_key:
            return

        endpoint = f"{self.api_base_url}/v1beta/{file_name}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.delete(endpoint, headers=self._headers())
                if response.status_code >= 400:
                    logger.warning(
                        "upstream.file.delete_failed provider=gemini file_name=%s status_code=%s",
                        file_name,
                        response.status_code,
                    )
        except httpx.HTTPError:
            logger.warning(
                "upstream.file.delete_failed provider=gemini file_name=%s reason=connection_error",
                file_name,
            )

    def _build_transcription_request(
        self,
        *,
        file_uri: str,
        mime_type: str,
        language: str,
        prompt: str | None,
    ) -> dict[str, Any]:
        return {
            "contents": [
                {
                    "parts": [
                        {"text": self._build_prompt(language=language, prompt=prompt)},
                        {
                            "file_data": {
                                "mime_type": mime_type,
                                "file_uri": file_uri,
                            }
                        },
                    ]
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseJsonSchema": _TRANSCRIPTION_SCHEMA,
            },
        }

    def _build_prompt(self, *, language: str, prompt: str | None) -> str:
        prompt_sections = [
            "Generate an accurate transcript of the spoken audio.",
            f"Expected spoken language: {language}.",
            "Return JSON with these fields only:",
            '- "text": the full transcript as a single plain-text string.',
            '- "chunks": chronological speech segments with start and end timestamps in seconds.',
            "Keep chunk text verbatim when possible and avoid adding speaker labels unless clearly stated.",
            "Do not include commentary outside the JSON response.",
        ]
        normalized_prompt = prompt.strip() if prompt else ""
        if normalized_prompt:
            prompt_sections.append(f"Additional transcription guidance: {normalized_prompt}")
        return "\n".join(prompt_sections)

    def _generate_content_endpoint(self) -> str:
        return f"{self.api_base_url}/v1beta/models/{self.model}:generateContent"

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["x-goog-api-key"] = self.api_key
        return headers

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
                "upstream.transcribe.metrics_persist_failed provider=gemini audio_bytes=%s duration_ms=%.2f status=%s",
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
        response_text = self._extract_response_text(payload)
        if not response_text:
            return "", []

        try:
            parsed = json.loads(response_text)
        except json.JSONDecodeError:
            return response_text.strip(), []

        if not isinstance(parsed, dict):
            return response_text.strip(), []

        text = str(parsed.get("text", "")).strip()
        chunks = self._normalize_chunks(parsed.get("chunks", []))
        if not text and chunks:
            text = " ".join(chunk["text"] for chunk in chunks).strip()
        return text, chunks

    @staticmethod
    def _extract_response_text(payload: Any) -> str:
        if not isinstance(payload, dict):
            return ""

        candidates = payload.get("candidates")
        if not isinstance(candidates, list):
            return ""

        parts: list[str] = []
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            content = candidate.get("content")
            if not isinstance(content, dict):
                continue
            raw_parts = content.get("parts")
            if not isinstance(raw_parts, list):
                continue
            for part in raw_parts:
                if not isinstance(part, dict):
                    continue
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text)
        return "".join(parts).strip()

    @staticmethod
    def _normalize_chunks(raw_chunks: Any) -> list[dict[str, Any]]:
        if not isinstance(raw_chunks, list):
            return []

        normalized: list[dict[str, Any]] = []
        for chunk in raw_chunks:
            if not isinstance(chunk, dict):
                continue
            text = str(chunk.get("text", "")).strip()
            if not text:
                continue
            start = GeminiClient._to_float(chunk.get("start", 0.0), 0.0)
            end = GeminiClient._to_float(chunk.get("end", start), start)
            normalized.append(
                {
                    "start": start,
                    "end": end,
                    "text": text,
                }
            )
        return normalized

    @staticmethod
    def _to_float(value: Any, default: float) -> float:
        try:
            if value is None:
                return default
            return float(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _resolve_mime_type(audio_path: Path) -> str:
        guessed_mime_type, _ = mimetypes.guess_type(audio_path.name)
        if guessed_mime_type:
            return guessed_mime_type

        suffix = audio_path.suffix.lower()
        if suffix == ".wav":
            return "audio/wav"
        if suffix == ".mp3":
            return "audio/mp3"
        if suffix == ".m4a":
            return "audio/aac"
        if suffix == ".ogg":
            return "audio/ogg"
        if suffix == ".flac":
            return "audio/flac"
        return "application/octet-stream"

    @staticmethod
    def _mock_transcription(*, audio_path: Path, language: str) -> TranscriptionResult:
        text = (
            f"Mock transcription for {audio_path.name} ({language}). "
            "Set GEMINI_API_KEY to enable Google AI Studio transcription."
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
