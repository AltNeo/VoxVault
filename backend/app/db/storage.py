import json
import sqlite3
from datetime import datetime, timezone
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
                    title TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    source TEXT NOT NULL,
                    language TEXT NOT NULL,
                    duration_seconds REAL,
                    status TEXT NOT NULL,
                    text TEXT NOT NULL,
                    summary_text TEXT DEFAULT NULL,
                    chunks_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    audio_path TEXT NOT NULL
                )
                """
            )
            transcription_columns = {
                row[1] for row in conn.execute("PRAGMA table_info(transcriptions)").fetchall()
            }
            if "title" not in transcription_columns:
                conn.execute("ALTER TABLE transcriptions ADD COLUMN title TEXT NOT NULL DEFAULT ''")
                conn.execute("UPDATE transcriptions SET title = filename WHERE title = ''")
            if "summary_text" not in transcription_columns:
                conn.execute("ALTER TABLE transcriptions ADD COLUMN summary_text TEXT DEFAULT NULL")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS transcription_metrics (
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
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def create_transcription(self, payload: dict[str, Any]) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO transcriptions (
                    id, title, filename, source, language, duration_seconds, status, text,
                    summary_text, chunks_json, created_at, audio_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload["id"],
                    payload["title"],
                    payload["filename"],
                    payload["source"],
                    payload["language"],
                    payload["duration_seconds"],
                    payload["status"],
                    payload["text"],
                    payload.get("summary_text"),
                    json.dumps(payload.get("chunks", [])),
                    payload["created_at"],
                    payload["audio_path"],
                ),
            )
            conn.commit()

    def update_transcription(
        self,
        transcription_id: str,
        *,
        title: str | None = None,
        text: str | None = None,
        summary_text: str | None = None,
    ) -> bool:
        updates: list[str] = []
        values: list[Any] = []

        if title is not None:
            updates.append("title = ?")
            values.append(title)
        if text is not None:
            updates.append("text = ?")
            values.append(text)
        if summary_text is not None:
            updates.append("summary_text = ?")
            values.append(summary_text)

        if not updates:
            return False

        values.append(transcription_id)

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                f"UPDATE transcriptions SET {', '.join(updates)} WHERE id = ?",
                tuple(values),
            )
            conn.commit()
            return cursor.rowcount > 0

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

    def create_transcription_metric(
        self,
        *,
        audio_bytes: int,
        duration_ms: float,
        status: str,
        upstream_status_code: int | None,
    ) -> None:
        timestamp = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO transcription_metrics (
                    timestamp, audio_bytes, duration_ms, status, upstream_status_code
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (timestamp, audio_bytes, duration_ms, status, upstream_status_code),
            )
            conn.commit()

    def get_transcription_metrics(self, *, recent_limit: int = 200) -> dict[str, Any]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row

            aggregate_row = conn.execute(
                """
                SELECT
                    COUNT(*) AS total_calls,
                    COALESCE(AVG(duration_ms), 0) AS average_duration_ms,
                    COALESCE(AVG(audio_bytes), 0) AS average_audio_bytes,
                    COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
                    COALESCE(SUM(audio_bytes), 0) AS total_audio_bytes
                FROM transcription_metrics
                """
            ).fetchone()

            rows: list[sqlite3.Row] = []
            if recent_limit > 0:
                rows = conn.execute(
                    """
                    SELECT
                        timestamp, audio_bytes, duration_ms, status, upstream_status_code
                    FROM transcription_metrics
                    ORDER BY id DESC
                    LIMIT ?
                    """,
                    (recent_limit,),
                ).fetchall()

        total_calls = int(aggregate_row["total_calls"]) if aggregate_row else 0
        average_duration_ms = float(aggregate_row["average_duration_ms"]) if aggregate_row else 0.0
        average_audio_bytes = float(aggregate_row["average_audio_bytes"]) if aggregate_row else 0.0
        total_duration_ms = float(aggregate_row["total_duration_ms"]) if aggregate_row else 0.0
        total_audio_bytes = float(aggregate_row["total_audio_bytes"]) if aggregate_row else 0.0
        average_audio_mb = average_audio_bytes / (1024 * 1024)
        average_ms_per_mb = (
            total_duration_ms / (total_audio_bytes / (1024 * 1024))
            if total_audio_bytes > 0
            else 0.0
        )
        recent_samples = [dict(row) for row in rows]

        return {
            "total_calls": total_calls,
            "average_duration_ms": round(average_duration_ms, 2),
            "average_audio_bytes": round(average_audio_bytes, 2),
            "average_audio_mb": round(average_audio_mb, 2),
            "average_ms_per_mb": round(average_ms_per_mb, 2),
            "recent_samples": recent_samples,
        }

    def get_setting(self, key: str) -> str | None:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        if not row:
            return None
        return str(row[0])

    def set_setting(self, key: str, value: str) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO app_settings (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, value),
            )
            conn.commit()

    @staticmethod
    def _deserialize(row: dict[str, Any]) -> dict[str, Any]:
        row["chunks"] = json.loads(row.pop("chunks_json", "[]"))
        row["title"] = str(row.get("title", "")).strip() or row.get("filename", "")
        return row
