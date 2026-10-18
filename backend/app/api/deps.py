from dataclasses import dataclass
from typing import TYPE_CHECKING, cast

from fastapi import Request

from app.db.storage import TranscriptionStorage
from app.services.audio_processor import AudioProcessor
from app.services.backup_service import BackupService
from app.services.transcription_provider import TranscriptionProvider

if TYPE_CHECKING:
    from app.core.config import Settings
    from app.services.summary_service import SummaryService
    from app.services.teams_call_detector import TeamsCallTransitionService


@dataclass(slots=True)
class AppServices:
    settings: "Settings"
    storage: TranscriptionStorage
    backup_service: BackupService
    audio_processor: AudioProcessor
    transcription_provider: TranscriptionProvider
    summary_service: "SummaryService"
    teams_call_transition_service: "TeamsCallTransitionService"


def get_services(request: Request) -> AppServices:
    return cast(AppServices, request.app.state.services)
