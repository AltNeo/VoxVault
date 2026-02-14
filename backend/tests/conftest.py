# ruff: noqa: E402

import io
import sys
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        backup_dir=tmp_path / "backups",
        sqlite_path=tmp_path / "transcriptions.db",
        chutes_api_url=None,
        chutes_api_key=None,
    )
    app = create_app(settings=settings)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def wav_bytes() -> bytes:
    frame_rate = 16000
    duration_seconds = 1
    frames = frame_rate * duration_seconds

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(frame_rate)
        wav_file.writeframes(b"\x00\x00" * frames)
    return buffer.getvalue()
