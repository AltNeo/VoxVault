from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.exceptions import APIError


@dataclass
class StoredAudio:
    transcription_id: str
    filename: str
    extension: str
    path: Path
    size_bytes: int


class BackupService:
    def __init__(self, backup_dir: Path) -> None:
        self.backup_dir = backup_dir
        self.backup_dir.mkdir(parents=True, exist_ok=True)

    async def save_upload(
        self,
        *,
        upload_file: UploadFile,
        max_size_bytes: int,
        allowed_extensions: set[str],
    ) -> StoredAudio:
        if not upload_file.filename:
            raise APIError(
                code="INVALID_FILE_TYPE",
                message="File name is required.",
                status_code=400,
            )

        extension = Path(upload_file.filename).suffix.lower().removeprefix(".")
        if extension not in allowed_extensions:
            raise APIError(
                code="INVALID_FILE_TYPE",
                message=f"Unsupported file extension: {extension or 'unknown'}.",
                status_code=400,
                details={"allowed_extensions": sorted(allowed_extensions)},
            )

        transcription_id = uuid4().hex
        target_path = self.backup_dir / f"{transcription_id}.{extension}"

        size_bytes = 0
        chunk_size = 1024 * 1024
        with target_path.open("wb") as handle:
            while True:
                chunk = await upload_file.read(chunk_size)
                if not chunk:
                    break
                size_bytes += len(chunk)
                if size_bytes > max_size_bytes:
                    handle.close()
                    target_path.unlink(missing_ok=True)
                    raise APIError(
                        code="FILE_TOO_LARGE",
                        message="Uploaded file exceeds allowed size.",
                        status_code=413,
                        details={"max_upload_size_mb": max_size_bytes // (1024 * 1024)},
                    )
                handle.write(chunk)
        await upload_file.close()

        return StoredAudio(
            transcription_id=transcription_id,
            filename=upload_file.filename,
            extension=extension,
            path=target_path,
            size_bytes=size_bytes,
        )
