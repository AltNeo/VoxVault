import { useEffect } from 'react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';

interface AudioRecorderProps {
  disabled?: boolean;
  onRecorded: (file: File, previewUrl: string) => void;
}

function resolveRecordingFormat(mimeType: string): { extension: string; fallbackMimeType: string } {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('mpeg') || normalized.includes('mp3')) {
    return { extension: 'mp3', fallbackMimeType: 'audio/mpeg' };
  }
  if (normalized.includes('mp4') || normalized.includes('m4a')) {
    return { extension: 'm4a', fallbackMimeType: 'audio/mp4' };
  }
  if (normalized.includes('wav')) {
    return { extension: 'wav', fallbackMimeType: 'audio/wav' };
  }
  if (normalized.includes('ogg')) {
    return { extension: 'ogg', fallbackMimeType: 'audio/ogg' };
  }
  return { extension: 'webm', fallbackMimeType: 'audio/webm' };
}

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function AudioRecorder({ disabled = false, onRecorded }: AudioRecorderProps) {
  const {
    status,
    captureMode,
    audioBlob,
    audioUrl,
    durationSeconds,
    isSupported,
    supportsSystemAudio,
    systemAudioBackend,
    error,
    setCaptureMode,
    startRecording,
    stopRecording,
    resetRecording,
  } = useAudioRecorder();

  useEffect(() => {
    if (!audioBlob || !audioUrl) {
      return;
    }

    const format = resolveRecordingFormat(audioBlob.type);
    const file = new File([audioBlob], `recording-${Date.now()}.${format.extension}`, {
      type: audioBlob.type || format.fallbackMimeType,
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
        Capture a fresh clip directly in your app. Output prefers MP3 and falls back to WebM.
      </p>

      <div className="capture-mode-row">
        <button
          className={`btn btn--ghost capture-mode-btn ${
            captureMode === 'microphone' ? 'capture-mode-btn--active' : ''
          }`}
          type="button"
          disabled={disabled || status === 'recording'}
          onClick={() => setCaptureMode('microphone')}
        >
          Microphone only
        </button>
        <button
          className={`btn btn--ghost capture-mode-btn ${
            captureMode === 'microphone_system' ? 'capture-mode-btn--active' : ''
          }`}
          type="button"
          disabled={disabled || status === 'recording' || !supportsSystemAudio}
          onClick={() => setCaptureMode('microphone_system')}
        >
          Mic + system audio
        </button>
      </div>
      {captureMode === 'microphone_system' && (
        <p className="muted muted--hint">
          {systemAudioBackend === 'electron'
            ? 'Electron desktop capture is active for system audio.'
            : 'Share your screen/tab with audio enabled so call participants are captured too.'}
        </p>
      )}
      {supportsSystemAudio && (
        <p className="muted muted--hint capture-backend">
          System audio backend: {systemAudioBackend === 'electron' ? 'electron bridge' : 'browser'}
        </p>
      )}
      {!supportsSystemAudio && (
        <p className="error-text">System audio capture is unavailable in this environment.</p>
      )}

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
