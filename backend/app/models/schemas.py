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


class TranscriptionMetricSample(BaseModel):
    timestamp: datetime
    audio_bytes: int = Field(ge=0)
    duration_ms: float = Field(ge=0)
    status: str
    upstream_status_code: int | None = None


class TranscriptionDiagnosticsResponse(BaseModel):
    total_calls: int = Field(ge=0)
    average_duration_ms: float = Field(ge=0)
    average_audio_bytes: float = Field(ge=0)
    average_audio_mb: float = Field(ge=0)
    average_ms_per_mb: float = Field(ge=0)
    recent_samples: list[TranscriptionMetricSample] = Field(default_factory=list)


class Chunk(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str


class TranscriptionSummary(BaseModel):
    id: str
    title: str
    filename: str
    source: Literal["recording", "upload"]
    language: str
    duration_seconds: float | None = None
    status: Literal["completed", "failed"]
    text: str
    summary_text: str | None = None
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


class TranscriptionUpdateRequest(BaseModel):
    title: str | None = None
    text: str | None = None
    summary_text: str | None = None


class SummarizeRequest(BaseModel):
    custom_prompt: str | None = None


class SummaryResponse(BaseModel):
    id: str
    summary_text: str


class SummaryModelHealthResponse(BaseModel):
    ready: bool
    model_name: str | None = None
    detail: str | None = None


class TranscriptionPromptResponse(BaseModel):
    custom_prompt: str


class TranscriptionPromptUpdateRequest(BaseModel):
    custom_prompt: str = ""


class SummaryPromptResponse(BaseModel):
    custom_prompt: str


class SummaryPromptUpdateRequest(BaseModel):
    custom_prompt: str = ""
