from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Transcription API"
    app_version: str = "1.0.0"
    api_prefix: str = "/api"
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://localhost:3000",
        ]
    )

    backup_dir: Path = Path("backups")
    sqlite_path: Path = Path("transcriptions.db")
    diagnostics_log_path: Path = Path("diagnostics/transactions.log")

    max_upload_size_mb: int = 50
    max_transcription_chunk_mb: int = 18
    request_timeout_seconds: float = 60.0
    allowed_extensions: set[str] = {"wav", "mp3", "m4a", "webm"}

    chutes_api_url: str | None = None
    chutes_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("CHUTES_API_KEY", "CHUTES_API_TOKEN"),
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
