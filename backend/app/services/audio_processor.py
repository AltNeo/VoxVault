import re
import shutil
import subprocess
import wave
from pathlib import Path


class AudioProcessor:
    _DIRECT_PROVIDER_EXTENSIONS = {".wav", ".mp3"}
    _DURATION_LINE_PATTERN = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
    _PROGRESS_TIME_PATTERN = re.compile(r"time=(\d+):(\d+):(\d+(?:\.\d+)?)")

    def _resolve_ffmpeg(self) -> str:
        ffmpeg_path = shutil.which("ffmpeg")
        if ffmpeg_path is not None:
            return ffmpeg_path

        try:
            import imageio_ffmpeg  # type: ignore[import-not-found]

            bundled_path = imageio_ffmpeg.get_ffmpeg_exe()
            if bundled_path and Path(bundled_path).exists():
                return bundled_path
        except Exception:
            pass

        raise RuntimeError(
            "ffmpeg is required to convert non-wav audio files. "
            "Install ffmpeg on PATH or install imageio-ffmpeg."
        )

    @staticmethod
    def _hms_to_seconds(hours: str, minutes: str, seconds: str) -> float:
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)

    def _run_ffmpeg(self, command: list[str]) -> None:
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise RuntimeError(
                result.stderr.strip() or result.stdout.strip() or "Audio conversion failed."
            )

    def _probe_duration_seconds(self, audio_path: Path) -> float | None:
        ffmpeg_executable = self._resolve_ffmpeg()
        command = [ffmpeg_executable, "-hide_banner", "-i", str(audio_path), "-f", "null", "-"]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        output = "\n".join(filter(None, [result.stdout, result.stderr]))
        progress_matches = self._PROGRESS_TIME_PATTERN.findall(output)
        if progress_matches:
            hours, minutes, seconds = progress_matches[-1]
            return round(self._hms_to_seconds(hours, minutes, seconds), 2)

        duration_match = self._DURATION_LINE_PATTERN.search(output)
        if duration_match is None:
            return None

        hours, minutes, seconds = duration_match.groups()
        return round(self._hms_to_seconds(hours, minutes, seconds), 2)

    def convert_to_mp3(self, audio_path: Path) -> Path:
        if audio_path.suffix.lower() == ".mp3":
            return audio_path

        ffmpeg_executable = self._resolve_ffmpeg()
        output_path = audio_path.with_suffix(".mp3")
        command = [
            ffmpeg_executable,
            "-y",
            "-i",
            str(audio_path),
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "64k",
            "-ac",
            "1",
            "-ar",
            "16000",
            str(output_path),
        ]
        self._run_ffmpeg(command)
        return output_path

    def convert_for_transcription(self, audio_path: Path) -> Path:
        if audio_path.suffix.lower() in self._DIRECT_PROVIDER_EXTENSIONS:
            return audio_path

        ffmpeg_executable = self._resolve_ffmpeg()

        output_path = audio_path.with_suffix(".wav")
        command = [
            ffmpeg_executable,
            "-y",
            "-i",
            str(audio_path),
            "-ar",
            "16000",
            "-ac",
            "1",
            str(output_path),
        ]
        self._run_ffmpeg(command)
        return output_path

    def split_for_max_size(self, audio_path: Path, max_chunk_size_mb: int) -> list[Path]:
        if max_chunk_size_mb <= 0:
            raise RuntimeError("Chunk size must be greater than zero.")

        max_bytes = max_chunk_size_mb * 1024 * 1024
        if audio_path.stat().st_size <= max_bytes:
            return [audio_path]

        duration_seconds = self.get_duration_seconds(audio_path)
        if duration_seconds is None or duration_seconds <= 0:
            raise RuntimeError("Unable to determine audio duration for chunking.")

        bytes_per_second = audio_path.stat().st_size / duration_seconds
        if bytes_per_second <= 0:
            raise RuntimeError("Unable to determine audio bitrate for chunking.")

        ffmpeg_executable = self._resolve_ffmpeg()
        chunk_dir = audio_path.parent / f"{audio_path.stem}.chunks"
        if chunk_dir.exists():
            shutil.rmtree(chunk_dir)
        chunk_dir.mkdir(parents=True, exist_ok=True)

        suffix = audio_path.suffix.lower()
        output_pattern = chunk_dir / f"chunk_%03d{suffix}"
        safety_factors = (0.75, 0.55, 0.4)
        chunk_paths: list[Path] = []

        for factor in safety_factors:
            segment_time = max(int((max_bytes * factor) / bytes_per_second), 30)
            for path in chunk_dir.glob(f"*{suffix}"):
                path.unlink(missing_ok=True)

            command = [
                ffmpeg_executable,
                "-y",
                "-i",
                str(audio_path),
                "-f",
                "segment",
                "-segment_time",
                str(segment_time),
                "-reset_timestamps",
                "1",
                "-c",
                "copy",
                str(output_pattern),
            ]
            self._run_ffmpeg(command)
            chunk_paths = sorted(chunk_dir.glob(f"*{suffix}"))
            if not chunk_paths:
                continue
            if all(path.stat().st_size <= max_bytes for path in chunk_paths):
                return chunk_paths

        if chunk_paths:
            oversized_chunks = [
                path.name for path in chunk_paths if path.stat().st_size > max_bytes
            ]
            raise RuntimeError(
                "Failed to split audio into chunks below size limit. "
                f"Oversized chunks: {', '.join(oversized_chunks)}"
            )
        raise RuntimeError("Failed to split audio into chunks.")

    def get_duration_seconds(self, audio_path: Path) -> float | None:
        if audio_path.suffix.lower() == ".wav":
            with wave.open(str(audio_path), "rb") as audio_file:
                frame_rate = audio_file.getframerate()
                total_frames = audio_file.getnframes()
                if frame_rate == 0:
                    return None
                return round(total_frames / float(frame_rate), 2)

        return self._probe_duration_seconds(audio_path)
