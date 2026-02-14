from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str


class ProviderHealthResponse(BaseModel):
    status: Literal[
        "ok",
        "not_configured",
        "auth_failed",
        "endpoint_not_found",
        "upstream_error",
    ]
    reachable: bool
    detail: str | None = None
    upstream_status_code: int | None = None
    endpoint: str | None = None


class Chunk(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str


class TranscriptionSummary(BaseModel):
    id: str
    filename: str
    source: Literal["recording", "upload"]
    language: str
    duration_seconds: float | None = None
    status: Literal["completed", "failed"]
    text: str
    created_at: datetime
    audio_url: str


class Transcription(TranscriptionSummary):
    chunks: list[Chunk] = Field(default_factory=list)


class TranscriptionListResponse(BaseModel):
    items: list[TranscriptionSummary]
    total: int
    limit: int
    offset: int


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail
    request_id: str
