import json
import sqlite3
from pathlib import Path
from typing import Any


class TranscriptionStorage:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path

    def initialize(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS transcriptions (
                    id TEXT PRIMARY KEY,
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
            conn.commit()

    def create_transcription(self, payload: dict[str, Any]) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO transcriptions (
                    id, filename, source, language, duration_seconds, status, text,
                    chunks_json, created_at, audio_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload["id"],
                    payload["filename"],
                    payload["source"],
                    payload["language"],
                    payload["duration_seconds"],
                    payload["status"],
                    payload["text"],
                    json.dumps(payload.get("chunks", [])),
                    payload["created_at"],
                    payload["audio_path"],
                ),
            )
            conn.commit()

    def get_transcription(self, transcription_id: str) -> dict[str, Any] | None:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT * FROM transcriptions WHERE id = ?",
                (transcription_id,),
            ).fetchone()

        if not row:
            return None
        return self._deserialize(dict(row))

    def list_transcriptions(self, *, limit: int, offset: int) -> list[dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT * FROM transcriptions
                ORDER BY datetime(created_at) DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ).fetchall()

        return [self._deserialize(dict(row)) for row in rows]

    def count_transcriptions(self) -> int:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("SELECT COUNT(*) FROM transcriptions").fetchone()
        return int(row[0]) if row else 0

    @staticmethod
    def _deserialize(row: dict[str, Any]) -> dict[str, Any]:
        row["chunks"] = json.loads(row.pop("chunks_json", "[]"))
        return row
