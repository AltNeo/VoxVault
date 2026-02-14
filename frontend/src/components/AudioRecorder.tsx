import { useEffect } from 'react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';

interface AudioRecorderProps {
  disabled?: boolean;
  onRecorded: (file: File, previewUrl: string) => void;
}

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function AudioRecorder({ disabled = false, onRecorded }: AudioRecorderProps) {
  const {
    status,
    audioBlob,
    audioUrl,
    durationSeconds,
    isSupported,
    error,
    startRecording,
    stopRecording,
    resetRecording,
  } = useAudioRecorder();

  useEffect(() => {
    if (!audioBlob || !audioUrl) {
      return;
    }
    const file = new File([audioBlob], `recording-${Date.now()}.webm`, {
      type: audioBlob.type || 'audio/webm',
    });
    onRecorded(file, audioUrl);
  }, [audioBlob, audioUrl, onRecorded]);

  return (
    <section className="module">
      <div className="module__head">
        <h3>Audio Recorder</h3>
        <span className={`status-dot ${status === 'recording' ? 'status-dot--live' : ''}`}>
          {status}
        </span>
      </div>

      <p className="muted">
        Capture a fresh clip directly in your browser. Output is generated as WebM/Opus.
      </p>

      <div className="recorder-display">
        <span className="recorder-display__label">REC</span>
        <strong>{formatDuration(durationSeconds)}</strong>
      </div>

      <div className="button-row">
        <button
          className="btn btn--accent"
          type="button"
          disabled={disabled || !isSupported || status === 'recording'}
          onClick={startRecording}
        >
          Start
        </button>
        <button
          className="btn"
          type="button"
          disabled={disabled || status !== 'recording'}
          onClick={stopRecording}
        >
          Stop
        </button>
        <button
          className="btn btn--ghost"
          type="button"
          disabled={disabled || (status === 'idle' && !audioBlob)}
          onClick={resetRecording}
        >
          Clear
        </button>
      </div>

      {!isSupported && (
        <p className="error-text">MediaRecorder is not supported in this browser.</p>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
