from app.core.config import Settings
from app.db.storage import TranscriptionStorage
from app.services.chutes_client import ChutesClient
from app.services.gemini_client import GeminiClient
from app.services.transcription_provider import TranscriptionProvider


def build_transcription_provider(
    *,
    settings: Settings,
    storage: TranscriptionStorage,
) -> TranscriptionProvider:
    if settings.transcription_provider == "gemini":
        return GeminiClient(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            api_base_url=settings.gemini_api_base_url,
            timeout_seconds=settings.request_timeout_seconds,
            storage=storage,
        )

    return ChutesClient(
        api_url=settings.chutes_api_url,
        api_key=settings.chutes_api_key,
        timeout_seconds=settings.request_timeout_seconds,
        storage=storage,
    )
