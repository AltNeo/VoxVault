from dataclasses import dataclass
from typing import cast

from fastapi import Request

from app.core.config import Settings
from app.db.storage import TranscriptionStorage
from app.services.audio_processor import AudioProcessor
from app.services.backup_service import BackupService
from app.services.chutes_client import ChutesClient


@dataclass(slots=True)
class AppServices:
    settings: Settings
    storage: TranscriptionStorage
    backup_service: BackupService
    audio_processor: AudioProcessor
    chutes_client: ChutesClient


def get_services(request: Request) -> AppServices:
    return cast(AppServices, request.app.state.services)

