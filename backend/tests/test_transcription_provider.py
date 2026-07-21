import asyncio
from pathlib import Path

from app.services.chutes_client import TranscriptionResult
from app.services.transcription_provider import TranscriptionProvider


class FakeGoogle:
    endpoint = "https://speech.googleapis.com/v1/speech:recognize"

    def __init__(self, result=None, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls = 0

    def is_configured(self) -> bool:
        return True

    async def transcribe_audio(self, audio_path, language, prompt=None):
        self.calls += 1
        if self.error:
            raise self.error
        return self.result


class FakeLocal:
    enabled = True
    model_size = "small"

    def __init__(self) -> None:
        self.calls = 0
        self.ready_calls = 0
        self._ready = False

    def is_ready(self) -> bool:
        return self._ready

    async def ensure_ready(self) -> None:
        self.ready_calls += 1
        self._ready = True

    def transcribe_sync(self, audio_path, language, prompt=None):
        self.calls += 1
        return TranscriptionResult(text="local text", chunks=[])


class FakeChutes:
    api_url = None
    api_key = None

    async def transcribe_audio(self, audio_path, language, prompt=None):
        return TranscriptionResult(text="mock text", chunks=[])


def test_google_is_used_before_local(tmp_path: Path) -> None:
    google = FakeGoogle(TranscriptionResult(text="google text", chunks=[]))
    local = FakeLocal()
    provider = TranscriptionProvider(
        google_client=google,
        local_client=local,
        chutes_client=FakeChutes(),
    )

    result = asyncio.run(
        provider.transcribe_audio(
            audio_path=tmp_path / "note.wav",
            language="en",
        )
    )

    assert result.text == "google text"
    assert google.calls == 1
    assert local.ready_calls == 0
    assert local.calls == 0


def test_google_failure_lazily_loads_local(tmp_path: Path) -> None:
    google = FakeGoogle(error=RuntimeError("network unavailable"))
    local = FakeLocal()
    provider = TranscriptionProvider(
        google_client=google,
        local_client=local,
        chutes_client=FakeChutes(),
    )

    result = asyncio.run(
        provider.transcribe_audio(
            audio_path=tmp_path / "note.wav",
            language="en",
        )
    )

    assert result.text == "local text"
    assert google.calls == 1
    assert local.ready_calls == 1
    assert local.calls == 1
