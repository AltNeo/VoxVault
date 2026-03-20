from app.core.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient


def test_health_returns_ok(client) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.headers.get("x-response-time-ms")
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str)
    assert body["version"]


def test_provider_health_not_configured(client) -> None:
    response = client.get("/api/health/provider")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "not_configured"
    assert body["reachable"] is False


def test_provider_transcription_metrics_initial_state(client) -> None:
    response = client.get("/api/health/provider/transcription-metrics")

    assert response.status_code == 200
    body = response.json()
    assert body["total_calls"] == 0
    assert body["average_duration_ms"] == 0
    assert body["average_audio_bytes"] == 0
    assert body["average_audio_mb"] == 0
    assert body["average_ms_per_mb"] == 0
    assert body["recent_samples"] == []


def test_provider_health_not_configured_for_gemini(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    settings = Settings(
        _env_file=None,
        backup_dir=tmp_path / "backups",
        sqlite_path=tmp_path / "transcriptions.db",
        diagnostics_log_path=tmp_path / "diagnostics" / "transactions.log",
        transcription_provider="gemini",
        gemini_api_key=None,
    )
    app = create_app(settings=settings)

    with TestClient(app) as client:
        response = client.get("/api/health/provider")

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "gemini"
    assert body["status"] == "not_configured"
    assert body["reachable"] is False
