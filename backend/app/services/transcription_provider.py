from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol


@dataclass(slots=True)
class TranscriptionResult:
    text: str
    chunks: list[dict[str, Any]]


class TranscriptionProvider(Protocol):
    async def ping(self) -> dict[str, Any]: ...

    async def transcribe_audio(
        self,
        audio_path: Path,
        language: str,
        prompt: str | None = None,
    ) -> TranscriptionResult: ...

    def get_transcription_metrics(self) -> dict[str, Any]: ...
