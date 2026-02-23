from app.services.chutes_client import TranscriptionResult


def test_upload_list_get_and_audio_flow(client, wav_bytes: bytes) -> None:
    upload_response = client.post(
        "/api/upload",
        data={"language": "en", "source": "upload"},
        files={"file": ("sample.wav", wav_bytes, "audio/wav")},
    )
    assert upload_response.status_code == 201

    uploaded = upload_response.json()
    transcription_id = uploaded["id"]
    assert transcription_id
    assert uploaded["source"] == "upload"
    assert uploaded["language"] == "en"
    assert uploaded["title"] == "sample"
    assert uploaded["audio_url"] == f"/api/audio/{transcription_id}"
    assert "Mock transcription" in uploaded["text"]
    assert isinstance(uploaded["chunks"], list)

    list_response = client.get("/api/transcriptions")
    assert list_response.status_code == 200
    listed = list_response.json()
    assert listed["total"] == 1
    assert len(listed["items"]) == 1
    assert listed["items"][0]["id"] == transcription_id
    assert listed["items"][0]["title"] == "sample"

    detail_response = client.get(f"/api/transcriptions/{transcription_id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["id"] == transcription_id
    assert detail["title"] == "sample"
    assert detail["filename"] == "sample.wav"
    assert isinstance(detail["chunks"], list)

    audio_response = client.get(f"/api/audio/{transcription_id}")
    assert audio_response.status_code == 200
    assert audio_response.content == wav_bytes
    assert audio_response.headers["content-type"].startswith("audio/")

    update_response = client.patch(
        f"/api/transcriptions/{transcription_id}",
        json={"title": "team standup", "text": "updated text"},
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["title"] == "team standup"
    assert updated["text"] == "updated text"


def test_upload_mp3_passthrough_flow(client) -> None:
    upload_response = client.post(
        "/api/upload",
        data={"language": "en", "source": "upload"},
        files={"file": ("sample.mp3", b"ID3mock-audio", "audio/mpeg")},
    )
    assert upload_response.status_code == 201

    uploaded = upload_response.json()
    assert uploaded["filename"] == "sample.mp3"
    assert uploaded["title"] == "sample"
    assert uploaded["source"] == "upload"
    assert uploaded["language"] == "en"
    assert "Mock transcription" in uploaded["text"]


def test_transcription_prompt_settings_and_upload_override(client, wav_bytes: bytes) -> None:
    initial_prompt_response = client.get("/api/transcription-prompt")
    assert initial_prompt_response.status_code == 200
    assert initial_prompt_response.json()["custom_prompt"] == ""

    updated_prompt_response = client.put(
        "/api/transcription-prompt",
        json={"custom_prompt": "teh -> the; VauxVault -> VoxVault"},
    )
    assert updated_prompt_response.status_code == 200
    assert "VoxVault" in updated_prompt_response.json()["custom_prompt"]

    captured: dict[str, str | None] = {}

    async def fake_transcribe_audio(audio_path, language, prompt=None):
        captured["prompt"] = prompt
        return TranscriptionResult(
            text=f"captured {language} for {audio_path.name}",
            chunks=[],
        )

    client.app.state.services.chutes_client.transcribe_audio = fake_transcribe_audio

    upload_response = client.post(
        "/api/upload",
        data={"language": "en", "source": "upload"},
        files={"file": ("sample.wav", wav_bytes, "audio/wav")},
    )
    assert upload_response.status_code == 201
    assert captured["prompt"] == "teh -> the; VauxVault -> VoxVault"

    override_response = client.post(
        "/api/upload",
        data={
            "language": "en",
            "source": "upload",
            "custom_prompt": "Alyce -> Alice; recieve -> receive",
        },
        files={"file": ("sample.wav", wav_bytes, "audio/wav")},
    )
    assert override_response.status_code == 201
    assert captured["prompt"] == "Alyce -> Alice; recieve -> receive"
