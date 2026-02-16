import mimetypes
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
    Transcription,
    TranscriptionDiagnosticsResponse,
    TranscriptionListResponse,
    TranscriptionUpdateRequest,
)
from app.services.chutes_client import TranscriptionResult

router = APIRouter()
SERVICES_DEP = Depends(get_services)
UPLOAD_FILE = File(...)
LANGUAGE_FORM = Form("en")
SOURCE_FORM = Form("upload")
LIMIT_QUERY = Query(20, ge=1, le=100)
OFFSET_QUERY = Query(0, ge=0)


@router.get("/health", response_model=HealthResponse)
async def health(services: AppServices = SERVICES_DEP) -> HealthResponse:
    return HealthResponse(status="ok", version=services.settings.app_version)


@router.get("/health/provider", response_model=ProviderHealthResponse)
async def provider_health(services: AppServices = SERVICES_DEP) -> dict[str, Any]:
    return await services.chutes_client.ping()


@router.get(
    "/health/provider/transcription-metrics", response_model=TranscriptionDiagnosticsResponse
)
async def provider_transcription_metrics(services: AppServices = SERVICES_DEP) -> dict[str, Any]:
    return services.chutes_client.get_transcription_metrics()


@router.post("/upload", response_model=Transcription, status_code=status.HTTP_201_CREATED)
async def upload_audio(
    file: UploadFile = UPLOAD_FILE,
    language: str = LANGUAGE_FORM,
    source: Literal["recording", "upload"] = SOURCE_FORM,
    services: AppServices = SERVICES_DEP,
) -> dict[str, Any]:
    normalized_language = language.strip()
    if not normalized_language:
        raise APIError(
            code="INVALID_LANGUAGE",
            message="Language must be provided.",
            status_code=400,
        )

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
            transcription_input = services.audio_processor.convert_for_transcription(stored_audio.path)
            if transcription_input != stored_audio.path:
                temporary_files.append(transcription_input)

        duration_seconds = services.audio_processor.get_duration_seconds(stored_audio_path)
        transcription_result, chunk_temp_dir = await _transcribe_with_chunking(
            services=services,
            audio_path=transcription_input,
            language=normalized_language,
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
    if update.title is None and update.text is None:
        raise APIError(
            code="EMPTY_UPDATE",
            message="Provide at least one field to update.",
            status_code=400,
        )

    normalized_title = update.title.strip() if update.title is not None else None
    normalized_text = update.text.strip() if update.text is not None else None

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

    updated = services.storage.update_transcription(
        transcription_id,
        title=normalized_title,
        text=normalized_text,
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
) -> tuple[TranscriptionResult, Path | None]:
    chunk_paths = services.audio_processor.split_for_max_size(
        audio_path,
        services.settings.max_transcription_chunk_mb,
    )
    if len(chunk_paths) == 1 and chunk_paths[0] == audio_path:
        return await services.chutes_client.transcribe_audio(audio_path, language), None

    merged_text_parts: list[str] = []
    merged_chunks: list[dict[str, Any]] = []
    chunk_offset_seconds = 0.0

    for chunk_path in chunk_paths:
        chunk_result = await services.chutes_client.transcribe_audio(chunk_path, language)
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
