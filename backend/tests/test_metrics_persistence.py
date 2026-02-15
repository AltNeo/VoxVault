# ruff: noqa: E402

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.storage import TranscriptionStorage


def test_transcription_metrics_persist_across_instances(tmp_path: Path) -> None:
    db_path = tmp_path / "transcriptions.db"

    first_storage = TranscriptionStorage(db_path)
    first_storage.initialize()
    first_storage.create_transcription_metric(
        audio_bytes=12_000_000,
        duration_ms=90_000.0,
        status="completed",
        upstream_status_code=200,
    )

    second_storage = TranscriptionStorage(db_path)
    second_storage.initialize()
    metrics = second_storage.get_transcription_metrics()

    assert metrics["total_calls"] == 1
    assert metrics["average_audio_bytes"] == 12_000_000.0
    assert metrics["average_duration_ms"] == 90_000.0
    assert metrics["average_audio_mb"] > 11
    assert metrics["average_ms_per_mb"] > 0
    assert len(metrics["recent_samples"]) == 1
    assert metrics["recent_samples"][0]["status"] == "completed"
