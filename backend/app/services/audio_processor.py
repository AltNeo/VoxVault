import shutil
import subprocess
import wave
from pathlib import Path


class AudioProcessor:
    def convert_for_transcription(self, audio_path: Path) -> Path:
        if audio_path.suffix.lower() == ".wav":
            return audio_path

        if shutil.which("ffmpeg") is None:
            raise RuntimeError("ffmpeg is required to convert non-wav audio files.")

        output_path = audio_path.with_suffix(".wav")
        command = [
            "ffmpeg",
            "-y",
            "-i",
            str(audio_path),
            "-ar",
            "16000",
            "-ac",
            "1",
            str(output_path),
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "Audio conversion failed.")
        return output_path

    def get_duration_seconds(self, audio_path: Path) -> float | None:
        if audio_path.suffix.lower() != ".wav":
            return None

        with wave.open(str(audio_path), "rb") as audio_file:
            frame_rate = audio_file.getframerate()
            total_frames = audio_file.getnframes()
            if frame_rate == 0:
                return None
            return round(total_frames / float(frame_rate), 2)
