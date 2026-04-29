import mimetypes
import inspect
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse
from starlette import status

from app.api.deps import AppServices, get_services
from app.core.exceptions import APIError
from app.models.schemas import (
    HealthResponse,
    ProviderHealthResponse,
    SummarizeRequest,
    SummaryModelHealthResponse,
    SummaryPromptResponse,
    SummaryPromptUpdateRequest,
    SummaryResponse,
    Transcription,
    TranscriptionDiagnosticsResponse,
    TranscriptionListResponse,
    TranscriptionPromptResponse,
    TranscriptionPromptUpdateRequest,
    TranscriptionUpdateRequest,
)
from app.services.chutes_client import TranscriptionResult
from app.services.summary_service import DEFAULT_SUMMARY_PROMPT

router = APIRouter()
SERVICES_DEP = Depends(get_services)
UPLOAD_FILE = File(...)
LANGUAGE_FORM = Form("en")
SOURCE_FORM = Form("upload")
CUSTOM_PROMPT_FORM = Form(None)
LIMIT_QUERY = Query(20, ge=1, le=100)
OFFSET_QUERY = Query(0, ge=0)
CUSTOM_PROMPT_SETTING_KEY = "transcription_custom_prompt"
SUMMARY_PROMPT_SETTING_KEY = "summary_custom_prompt"
MAX_CUSTOM_PROMPT_LENGTH = 4000


@router.get("/health", response_model=HealthResponse)
async def health(services: AppServices = SERVICES_DEP) -> HealthResponse:
    return HealthResponse(status="ok", version=services.settings.app_version)


@router.get("/health/provider", response_model=ProviderHealthResponse)
async def provider_health(services: AppServices = SERVICES_DEP) -> dict[str, Any]:
    return await services.transcription_provider.ping()


@router.get(
    "/health/provider/transcription-metrics", response_model=TranscriptionDiagnosticsResponse
)
async def provider_transcription_metrics(services: AppServices = SERVICES_DEP) -> dict[str, Any]:
    return services.transcription_provider.get_transcription_metrics()


@router.get("/health/summary-model", response_model=SummaryModelHealthResponse)
async def summary_model_health(services: AppServices = SERVICES_DEP) -> dict[str, Any]:
    summary_service = _get_summary_service(services)
    if summary_service is None:
        return {
            "ready": False,
            "model_name": None,
            "detail": "Summary service is not configured.",
        }

    try:
        ready_callable = getattr(summary_service, "is_ready", None)
        ready = bool(ready_callable()) if callable(ready_callable) else True
    except Exception as exc:  # pragma: no cover - defensive fallback
        return {
            "ready": False,
            "model_name": getattr(summary_service, "model_name", None),
            "detail": f"Summary model health check failed: {exc}",
        }

    return {
        "ready": ready,
        "model_name": getattr(summary_service, "model_name", None),
        "detail": getattr(
            summary_service,
            "detail",
            "Summary model is ready." if ready else "Summary model is not loaded.",
        ),
    }


@router.post("/upload", response_model=Transcription, status_code=status.HTTP_201_CREATED)
async def upload_audio(
    file: UploadFile = UPLOAD_FILE,
    language: str = LANGUAGE_FORM,
    source: Literal["recording", "upload"] = SOURCE_FORM,
    custom_prompt: str | None = CUSTOM_PROMPT_FORM,
    services: AppServices = SERVICES_DEP,
) -> dict[str, Any]:
    normalized_language = language.strip()
    if not normalized_language:
        raise APIError(
            code="INVALID_LANGUAGE",
            message="Language must be provided.",
            status_code=400,
        )
    prompt_override = _normalize_custom_prompt(custom_prompt)
    stored_custom_prompt = _normalize_custom_prompt(
        services.storage.get_setting(CUSTOM_PROMPT_SETTING_KEY)
    )
    effective_custom_prompt = prompt_override or stored_custom_prompt

    stored_audio = await services.backup_service.save_upload(
        upload_file=file,
        max_size_bytes=services.settings.max_upload_size_mb * 1024 * 1024,
        allowed_extensions=services.settings.allowed_extensions,
    )

    stored_filename = stored_audio.filename
    stored_audio_path = stored_audio.path
    transcription_input = stored_audio.path
    temporary_files: list[Path] = []
    temporary_dirs: list[Path] = []

    try:
        if source == "recording":
            recording_mp3_path = services.audio_processor.convert_to_mp3(stored_audio.path)
            if recording_mp3_path != stored_audio.path:
                stored_audio.path.unlink(missing_ok=True)
            stored_audio_path = recording_mp3_path
            transcription_input = recording_mp3_path
            stored_filename = f"{Path(stored_audio.filename).stem}.mp3"
        else:
            transcription_input = services.audio_processor.convert_for_transcription(
                stored_audio.path
            )
            if transcription_input != stored_audio.path:
                temporary_files.append(transcription_input)

        duration_seconds = services.audio_processor.get_duration_seconds(stored_audio_path)
        transcription_result, chunk_temp_dir = await _transcribe_with_chunking(
            services=services,
            audio_path=transcription_input,
            language=normalized_language,
            custom_prompt=effective_custom_prompt,
        )
        if chunk_temp_dir is not None:
            temporary_dirs.append(chunk_temp_dir)
    except APIError:
        raise
    except RuntimeError as exc:
        raise APIError(
            code="AUDIO_PROCESSING_FAILED",
            message=str(exc),
            status_code=422,
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive fallback
        raise APIError(
            code="TRANSCRIPTION_FAILED",
            message="Failed to transcribe audio.",
            status_code=502,
            details={"reason": str(exc)},
        ) from exc
    finally:
        for temp_file in temporary_files:
            temp_file.unlink(missing_ok=True)
        for temp_dir in temporary_dirs:
            if temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)

    record = {
        "id": stored_audio.transcription_id,
        "title": _default_title_from_filename(stored_filename),
        "filename": stored_filename,
        "source": source,
        "language": normalized_language,
        "duration_seconds": duration_seconds,
        "status": "completed",
        "text": transcription_result.text,
        "chunks": transcription_result.chunks,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "audio_path": str(stored_audio_path.resolve()),
    }
    services.storage.create_transcription(record)

    stored_record = services.storage.get_transcription(stored_audio.transcription_id)
    if stored_record is None:
        raise APIError(
            code="STORAGE_ERROR",
            message="Transcription was stored but could not be retrieved.",
            status_code=500,
        )
    return _to_transcription_payload(stored_record, services.settings.api_prefix)


@router.get("/transcription-prompt", response_model=TranscriptionPromptResponse)
async def get_transcription_prompt(
    services: AppServices = SERVICES_DEP,
) -> dict[str, str]:
    prompt = _normalize_custom_prompt(services.storage.get_setting(CUSTOM_PROMPT_SETTING_KEY))
    return {"custom_prompt": prompt or ""}


@router.put("/transcription-prompt", response_model=TranscriptionPromptResponse)
async def update_transcription_prompt(
    payload: TranscriptionPromptUpdateRequest,
    services: AppServices = SERVICES_DEP,
) -> dict[str, str]:
    prompt = _normalize_custom_prompt(payload.custom_prompt)
    services.storage.set_setting(CUSTOM_PROMPT_SETTING_KEY, prompt or "")
    return {"custom_prompt": prompt or ""}


@router.get("/summary-prompt", response_model=SummaryPromptResponse)
async def get_summary_prompt(services: AppServices = SERVICES_DEP) -> dict[str, str]:
    prompt = _normalize_custom_prompt(services.storage.get_setting(SUMMARY_PROMPT_SETTING_KEY))
    return {"custom_prompt": prompt or ""}


@router.put("/summary-prompt", response_model=SummaryPromptResponse)
async def update_summary_prompt(
    payload: SummaryPromptUpdateRequest,
    services: AppServices = SERVICES_DEP,
) -> dict[str, str]:
    prompt = _normalize_custom_prompt(payload.custom_prompt)
    services.storage.set_setting(SUMMARY_PROMPT_SETTING_KEY, prompt or "")
    return {"custom_prompt": prompt or ""}


@router.get("/transcriptions", response_model=TranscriptionListResponse)
async def list_transcriptions(
    limit: int = LIMIT_QUERY,
    offset: int = OFFSET_QUERY,
    services: AppServices = SERVICES_DEP,
) -> dict[str, Any]:
    rows = services.storage.list_transcriptions(limit=limit, offset=offset)
    total = services.storage.count_transcriptions()
    return {
        "items": [_to_summary_payload(row, services.settings.api_prefix) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/transcriptions/{transcription_id}", response_model=Transcription)
async def get_transcription(
    transcription_id: str,
    services: AppServices = SERVICES_DEP,
) -> dict[str, Any]:
    row = services.storage.get_transcription(transcription_id)
    if row is None:
        raise APIError(
            code="NOT_FOUND",
            message="Transcription not found.",
            status_code=404,
        )
    return _to_transcription_payload(row, services.settings.api_prefix)


@router.patch("/transcriptions/{transcription_id}", response_model=Transcription)
async def update_transcription(
    transcription_id: str,
    update: TranscriptionUpdateRequest,
    services: AppServices = SERVICES_DEP,
) -> dict[str, Any]:
    if update.title is None and update.text is None and update.summary_text is None:
        raise APIError(
            code="EMPTY_UPDATE",
            message="Provide at least one field to update.",
            status_code=400,
        )

    normalized_title = update.title.strip() if update.title is not None else None
    normalized_text = update.text.strip() if update.text is not None else None
    normalized_summary_text = (
        update.summary_text.strip() if update.summary_text is not None else None
    )

    if update.title is not None and not normalized_title:
        raise APIError(
            code="INVALID_TITLE",
            message="Title must not be empty.",
            status_code=422,
        )

    if update.text is not None and not normalized_text:
        raise APIError(
            code="INVALID_TEXT",
            message="Transcription text must not be empty.",
            status_code=422,
        )

    if update.summary_text is not None and not normalized_summary_text:
        raise APIError(
            code="INVALID_SUMMARY_TEXT",
            message="Summary text must not be empty.",
            status_code=422,
        )

    updated = services.storage.update_transcription(
        transcription_id,
        title=normalized_title,
        text=normalized_text,
        summary_text=normalized_summary_text,
    )
    if not updated:
        raise APIError(
            code="NOT_FOUND",
            message="Transcription not found.",
            status_code=404,
        )

    row = services.storage.get_transcription(transcription_id)
    if row is None:
        raise APIError(
            code="STORAGE_ERROR",
            message="Updated transcription could not be retrieved.",
            status_code=500,
        )
    return _to_transcription_payload(row, services.settings.api_prefix)


@router.post("/transcriptions/{transcription_id}/summarize", response_model=SummaryResponse)
async def summarize_transcription(
    transcription_id: str,
    payload: SummarizeRequest,
    services: AppServices = SERVICES_DEP,
) -> dict[str, str]:
    row = services.storage.get_transcription(transcription_id)
    if row is None:
        raise APIError(
            code="NOT_FOUND",
            message="Transcription not found.",
            status_code=404,
        )

    transcript_text = str(row.get("text", "")).strip()
    if not transcript_text:
        raise APIError(
            code="EMPTY_TRANSCRIPTION",
            message="Transcription text is empty.",
            status_code=422,
        )

    summary_service = _get_summary_service(services)
    if summary_service is None:
        raise APIError(
            code="SUMMARY_SERVICE_UNAVAILABLE",
            message="Summary service is not configured.",
            status_code=503,
        )

    prompt = _resolve_summary_prompt(services, payload.custom_prompt)
    summarize = getattr(summary_service, "summarize", None)
    if not callable(summarize):
        raise APIError(
            code="SUMMARY_SERVICE_UNAVAILABLE",
            message="Summary service is not available.",
            status_code=503,
        )

    try:
        summary_result = summarize(transcript_text, custom_prompt=prompt)
        if inspect.isawaitable(summary_result):
            summary_result = await summary_result
        summary_text = str(summary_result).strip()
    except APIError:
        raise
    except Exception as exc:  # pragma: no cover - defensive fallback
        raise APIError(
            code="SUMMARY_GENERATION_FAILED",
            message="Failed to generate summary.",
            status_code=502,
            details={"reason": str(exc)},
        ) from exc

    if not summary_text:
        raise APIError(
            code="EMPTY_SUMMARY",
            message="Summary service returned empty text.",
            status_code=502,
        )

    updated = services.storage.update_transcription(
        transcription_id,
        summary_text=summary_text,
    )
    if not updated:
        raise APIError(
            code="NOT_FOUND",
            message="Transcription not found.",
            status_code=404,
        )

    return {"id": transcription_id, "summary_text": summary_text}


@router.get("/audio/{transcription_id}")
async def get_audio(
    transcription_id: str,
    services: AppServices = SERVICES_DEP,
) -> FileResponse:
    row = services.storage.get_transcription(transcription_id)
    if row is None:
        raise APIError(
            code="NOT_FOUND",
            message="Transcription not found.",
            status_code=404,
        )

    audio_path = Path(row["audio_path"])
    if not audio_path.exists():
        raise APIError(
            code="AUDIO_NOT_FOUND",
            message="Audio file for this transcription is missing.",
            status_code=404,
        )

    media_type = mimetypes.guess_type(row["filename"])[0] or "application/octet-stream"
    return FileResponse(
        path=audio_path,
        media_type=media_type,
        filename=row["filename"],
    )


def _to_summary_payload(row: dict[str, Any], api_prefix: str) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row.get("title") or _default_title_from_filename(row["filename"]),
        "filename": row["filename"],
        "source": row["source"],
        "language": row["language"],
        "duration_seconds": row["duration_seconds"],
        "status": row["status"],
        "text": row["text"],
        "summary_text": row.get("summary_text"),
        "created_at": row["created_at"],
        "audio_url": f"{api_prefix}/audio/{row['id']}",
    }


def _to_transcription_payload(row: dict[str, Any], api_prefix: str) -> dict[str, Any]:
    payload = _to_summary_payload(row, api_prefix)
    payload["chunks"] = row.get("chunks", [])
    return payload


def _default_title_from_filename(filename: str) -> str:
    stem = Path(filename).stem.strip()
    return stem or filename


async def _transcribe_with_chunking(
    *,
    services: AppServices,
    audio_path: Path,
    language: str,
    custom_prompt: str | None,
) -> tuple[TranscriptionResult, Path | None]:
    chunk_paths = services.audio_processor.split_for_max_size(
        audio_path,
        services.settings.max_transcription_chunk_mb,
    )
    if len(chunk_paths) == 1 and chunk_paths[0] == audio_path:
        return await services.transcription_provider.transcribe_audio(
            audio_path=audio_path,
            language=language,
            prompt=custom_prompt,
        ), None

    merged_text_parts: list[str] = []
    merged_chunks: list[dict[str, Any]] = []
    chunk_offset_seconds = 0.0

    for chunk_path in chunk_paths:
        chunk_result = await services.transcription_provider.transcribe_audio(
            audio_path=chunk_path,
            language=language,
            prompt=custom_prompt,
        )
        chunk_duration_seconds = services.audio_processor.get_duration_seconds(chunk_path) or 0.0

        if chunk_result.text.strip():
            merged_text_parts.append(chunk_result.text.strip())

        normalized_chunk_entries = _offset_chunks(chunk_result.chunks, chunk_offset_seconds)
        if normalized_chunk_entries:
            merged_chunks.extend(normalized_chunk_entries)
            if chunk_duration_seconds <= 0:
                chunk_duration_seconds = max(
                    (
                        max(float(entry["end"]) - chunk_offset_seconds, 0.0)
                        for entry in normalized_chunk_entries
                    ),
                    default=0.0,
                )

        chunk_offset_seconds += max(chunk_duration_seconds, 0.0)

    merged_text = " ".join(merged_text_parts).strip()
    if not merged_text and merged_chunks:
        merged_text = " ".join(chunk["text"] for chunk in merged_chunks).strip()

    return TranscriptionResult(text=merged_text, chunks=merged_chunks), chunk_paths[0].parent


def _offset_chunks(chunks: list[dict[str, Any]], offset_seconds: float) -> list[dict[str, Any]]:
    offset_chunks: list[dict[str, Any]] = []
    for chunk in chunks:
        text = str(chunk.get("text", "")).strip()
        if not text:
            continue

        try:
            start = float(chunk.get("start", 0.0))
        except (TypeError, ValueError):
            start = 0.0
        try:
            end = float(chunk.get("end", start))
        except (TypeError, ValueError):
            end = start

        offset_chunks.append(
            {
                "start": round(start + offset_seconds, 2),
                "end": round(end + offset_seconds, 2),
                "text": text,
            }
        )
    return offset_chunks


def _normalize_custom_prompt(prompt: str | None) -> str | None:
    if prompt is None:
        return None
    normalized = prompt.strip()
    if not normalized:
        return None
    if len(normalized) > MAX_CUSTOM_PROMPT_LENGTH:
        raise APIError(
            code="CUSTOM_PROMPT_TOO_LONG",
            message=f"Custom prompt must be at most {MAX_CUSTOM_PROMPT_LENGTH} characters.",
            status_code=422,
        )
    return normalized


def _resolve_summary_prompt(services: AppServices, custom_prompt: str | None) -> str:
    prompt = _normalize_custom_prompt(custom_prompt)
    if prompt is not None:
        return prompt

    stored_prompt = _normalize_custom_prompt(
        services.storage.get_setting(SUMMARY_PROMPT_SETTING_KEY)
    )
    return stored_prompt or DEFAULT_SUMMARY_PROMPT


def _get_summary_service(services: AppServices) -> Any | None:
    return getattr(services, "summary_service", None)
