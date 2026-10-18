from app.core.exceptions import APIError


def _fail_transcription(*_args, **_kwargs):
    raise APIError(code="LOCAL_TRANSCRIPTION_FAILED", message="Provider down.", status_code=502)


def test_failed_transcription_is_kept_in_history_and_can_be_retried(
    client, wav_bytes: bytes, monkeypatch
) -> None:
    provider = client.app.state.services.transcription_provider
    original = provider.transcribe_audio
    monkeypatch.setattr(provider, "transcribe_audio", _fail_transcription)

    upload_response = client.post(
        "/api/upload",
        data={"language": "en", "source": "upload"},
        files={"file": ("standup.wav", wav_bytes, "audio/wav")},
    )
    assert upload_response.status_code == 502

    listed = client.get("/api/transcriptions").json()
    assert listed["total"] == 1
    failed = listed["items"][0]
    assert failed["status"] == "failed"
    assert failed["title"] == "standup"
    assert failed["text"] == ""

    audio_response = client.get(f"/api/audio/{failed['id']}")
    assert audio_response.status_code == 200

    monkeypatch.setattr(provider, "transcribe_audio", original)
    retry_response = client.post(f"/api/transcriptions/{failed['id']}/retry")
    assert retry_response.status_code == 200
    retried = retry_response.json()
    assert retried["id"] == failed["id"]
    assert retried["status"] == "completed"
    assert "Mock transcription" in retried["text"]


def test_retry_unknown_transcription_returns_404(client) -> None:
    response = client.post("/api/transcriptions/missing/retry")
    assert response.status_code == 404
