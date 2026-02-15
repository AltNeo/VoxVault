import mimetypes
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
)

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

    converted_path: Path | None = None
    transcription_input = stored_audio.path

    try:
        transcription_input = services.audio_processor.convert_for_transcription(stored_audio.path)
        if transcription_input != stored_audio.path:
            converted_path = transcription_input

        duration_seconds = services.audio_processor.get_duration_seconds(transcription_input)
        transcription_result = await services.chutes_client.transcribe_audio(
            transcription_input, normalized_language
        )
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
        if converted_path is not None:
            converted_path.unlink(missing_ok=True)

    record = {
        "id": stored_audio.transcription_id,
        "filename": stored_audio.filename,
        "source": source,
        "language": normalized_language,
        "duration_seconds": duration_seconds,
        "status": "completed",
        "text": transcription_result.text,
        "chunks": transcription_result.chunks,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "audio_path": str(stored_audio.path.resolve()),
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
