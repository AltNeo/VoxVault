import sqlite3
from types import SimpleNamespace

from app.db.storage import TranscriptionStorage
from app.services.chutes_client import TranscriptionResult


class FakeSummaryService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []
        self.model_name = "mock-summary-model.gguf"

    def is_ready(self) -> bool:
        return True

    def summarize(self, transcript_text: str, custom_prompt: str | None = None) -> str:
        self.calls.append((transcript_text, custom_prompt))
        prompt_fragment = custom_prompt or "default"
        return f"summary[{prompt_fragment}]: {transcript_text}"


def _attach_summary_service(client, summary_service: FakeSummaryService) -> None:
    services = client.app.state.services
    client.app.state.services = SimpleNamespace(
        settings=services.settings,
        storage=services.storage,
        backup_service=services.backup_service,
        audio_processor=services.audio_processor,
        transcription_provider=services.transcription_provider,
        summary_service=summary_service,
    )


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
    assert uploaded["summary_text"] is None
    assert isinstance(uploaded["chunks"], list)

    list_response = client.get("/api/transcriptions")
    assert list_response.status_code == 200
    listed = list_response.json()
    assert listed["total"] == 1
    assert len(listed["items"]) == 1
    assert listed["items"][0]["id"] == transcription_id
    assert listed["items"][0]["title"] == "sample"
    assert listed["items"][0]["summary_text"] is None

    detail_response = client.get(f"/api/transcriptions/{transcription_id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["id"] == transcription_id
    assert detail["title"] == "sample"
    assert detail["filename"] == "sample.wav"
    assert detail["summary_text"] is None
    assert isinstance(detail["chunks"], list)

    audio_response = client.get(f"/api/audio/{transcription_id}")
    assert audio_response.status_code == 200
    assert audio_response.content == wav_bytes
    assert audio_response.headers["content-type"].startswith("audio/")

    update_response = client.patch(
        f"/api/transcriptions/{transcription_id}",
        json={
            "title": "team standup",
            "text": "updated text",
            "summary_text": "team summary",
        },
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["title"] == "team standup"
    assert updated["text"] == "updated text"
    assert updated["summary_text"] == "team summary"


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

    client.app.state.services.transcription_provider.transcribe_audio = fake_transcribe_audio

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


def test_summary_prompt_settings_and_summary_generation(client, wav_bytes: bytes) -> None:
    initial_prompt_response = client.get("/api/summary-prompt")
    assert initial_prompt_response.status_code == 200
    assert initial_prompt_response.json()["custom_prompt"] == ""

    updated_prompt_response = client.put(
        "/api/summary-prompt",
        json={"custom_prompt": "Focus on decisions and action items."},
    )
    assert updated_prompt_response.status_code == 200
    assert updated_prompt_response.json()["custom_prompt"] == "Focus on decisions and action items."

    summary_service = FakeSummaryService()
    _attach_summary_service(client, summary_service)

    upload_response = client.post(
        "/api/upload",
        data={"language": "en", "source": "upload"},
        files={"file": ("sample.wav", wav_bytes, "audio/wav")},
    )
    assert upload_response.status_code == 201
    transcription_id = upload_response.json()["id"]

    summarize_response = client.post(f"/api/transcriptions/{transcription_id}/summarize", json={})
    assert summarize_response.status_code == 200
    summarized = summarize_response.json()
    assert summarized["id"] == transcription_id
    assert summarized["summary_text"].startswith("summary[Focus on decisions and action items.]:")
    assert summary_service.calls[-1][1] == "Focus on decisions and action items."

    detail_response = client.get(f"/api/transcriptions/{transcription_id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["summary_text"] == summarized["summary_text"]

    list_response = client.get("/api/transcriptions")
    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["summary_text"] == summarized["summary_text"]

    override_response = client.post(
        f"/api/transcriptions/{transcription_id}/summarize",
        json={"custom_prompt": "Use a concise executive summary."},
    )
    assert override_response.status_code == 200
    assert summary_service.calls[-1][1] == "Use a concise executive summary."


def test_summary_generation_uses_builtin_fallback(client, wav_bytes: bytes) -> None:
    upload_response = client.post(
        "/api/upload",
        data={"language": "en", "source": "upload"},
        files={"file": ("sample.wav", wav_bytes, "audio/wav")},
    )
    assert upload_response.status_code == 201
    transcription_id = upload_response.json()["id"]

    updated = client.patch(
        f"/api/transcriptions/{transcription_id}",
        json={
            "text": (
                "We reviewed the launch timeline. "
                "The team agreed to ship on Friday after QA sign-off. "
                "Alice will send the customer update by Thursday. "
                "Bob needs to confirm the migration checklist today."
            )
        },
    )
    assert updated.status_code == 200

    summarize_response = client.post(f"/api/transcriptions/{transcription_id}/summarize", json={})
    assert summarize_response.status_code == 200
    summary_text = summarize_response.json()["summary_text"]
    assert "Key Topics:" in summary_text
    assert "Decisions Made:" in summary_text
    assert "Action Items:" in summary_text
    assert "ship on Friday" in summary_text
    assert "Alice will send the customer update" in summary_text


def test_storage_migrates_summary_text_column(tmp_path) -> None:
    db_path = tmp_path / "legacy-transcriptions.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE transcriptions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                filename TEXT NOT NULL,
                source TEXT NOT NULL,
                language TEXT NOT NULL,
                duration_seconds REAL,
                status TEXT NOT NULL,
                text TEXT NOT NULL,
                chunks_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                audio_path TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE transcription_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                audio_bytes INTEGER NOT NULL,
                duration_ms REAL NOT NULL,
                status TEXT NOT NULL,
                upstream_status_code INTEGER
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        conn.commit()

    storage = TranscriptionStorage(db_path)
    storage.initialize()

    with sqlite3.connect(db_path) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(transcriptions)").fetchall()}

    assert "summary_text" in columns

    storage.create_transcription(
        {
            "id": "transcription-1",
            "title": "sample",
            "filename": "sample.wav",
            "source": "upload",
            "language": "en",
            "duration_seconds": 1.0,
            "status": "completed",
            "text": "hello world",
            "chunks": [],
            "created_at": "2026-04-06T00:00:00Z",
            "audio_path": str(db_path),
        }
    )
    assert storage.update_transcription(
        "transcription-1",
        summary_text="meeting summary",
    )
    stored = storage.get_transcription("transcription-1")
    assert stored is not None
    assert stored["summary_text"] == "meeting summary"
