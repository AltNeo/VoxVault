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
    assert uploaded["audio_url"] == f"/api/audio/{transcription_id}"
    assert "Mock transcription" in uploaded["text"]
    assert isinstance(uploaded["chunks"], list)

    list_response = client.get("/api/transcriptions")
    assert list_response.status_code == 200
    listed = list_response.json()
    assert listed["total"] == 1
    assert len(listed["items"]) == 1
    assert listed["items"][0]["id"] == transcription_id

    detail_response = client.get(f"/api/transcriptions/{transcription_id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["id"] == transcription_id
    assert detail["filename"] == "sample.wav"
    assert isinstance(detail["chunks"], list)

    audio_response = client.get(f"/api/audio/{transcription_id}")
    assert audio_response.status_code == 200
    assert audio_response.content == wav_bytes
    assert audio_response.headers["content-type"].startswith("audio/")

