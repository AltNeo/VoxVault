import { useEffect } from 'react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { normalizeRecordedAudio } from '../services/recorded-audio';

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
    captureMode,
    audioBlob,
    audioUrl,
    durationSeconds,
    isSupported,
    supportsSystemAudio,
    systemAudioBackend,
    autoTeamsRecordEnabled,
    teamsCallDetected,
    teamsCallMonitorSupported,
    teamsMatchedWindowTitle,
    recordingBaseName,
    activeRecordingTrigger,
    error,
    setCaptureMode,
    setAutoTeamsRecordEnabled,
    startRecording,
    stopRecording,
    resetRecording,
  } = useAudioRecorder();

  useEffect(() => {
    if (!audioBlob || !audioUrl) {
      return;
    }

    let cancelled = false;
    let ownsPreviewUrl = false;
    let generatedPreviewUrl: string | null = null;

    const prepareRecording = async () => {
      const normalized = await normalizeRecordedAudio(audioBlob, window.electronAPI);
      if (cancelled) {
        return;
      }

      const previewUrl = normalized.wasConverted
        ? (() => {
            generatedPreviewUrl = URL.createObjectURL(normalized.blob);
            return generatedPreviewUrl;
          })()
        : audioUrl;
      const file = new File([normalized.blob], `${recordingBaseName}.${normalized.extension}`, {
        type: normalized.mimeType,
      });
      onRecorded(file, previewUrl);
      ownsPreviewUrl = true;
    };

    void prepareRecording().catch((error) => {
      console.error('Failed to convert recording to mp3 before upload.', error);
      if (cancelled) {
        return;
      }
      const file = new File([audioBlob], `${recordingBaseName}.webm`, {
        type: audioBlob.type || 'audio/webm',
      });
      onRecorded(file, audioUrl);
    });

    return () => {
      cancelled = true;
      if (generatedPreviewUrl && !ownsPreviewUrl) {
        URL.revokeObjectURL(generatedPreviewUrl);
      }
    };
  }, [audioBlob, audioUrl, onRecorded, recordingBaseName]);

  return (
    <section className="module">
      <div className="module__head">
        <h3>Audio Recorder</h3>
        <span className={`status-dot ${status === 'recording' ? 'status-dot--live' : ''}`}>
          {status}
        </span>
      </div>

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
            ? 'System audio capture is active.'
            : 'Share your screen/tab with audio enabled.'}
        </p>
      )}
      {supportsSystemAudio && (
        <p className="muted muted--hint capture-backend">
          {systemAudioBackend === 'electron'
            ? 'System audio: electron bridge'
            : 'System audio: browser'}
        </p>
      )}
      <label
        className={`automation-toggle ${
          autoTeamsRecordEnabled ? 'automation-toggle--active' : ''
        } ${!teamsCallMonitorSupported ? 'automation-toggle--disabled' : ''}`}
      >
        <input
          type="checkbox"
          checked={autoTeamsRecordEnabled}
          onChange={(event) => setAutoTeamsRecordEnabled(event.target.checked)}
          disabled={disabled || !teamsCallMonitorSupported || !supportsSystemAudio}
        />
        <span>Auto-record Teams calls</span>
      </label>
      {teamsCallMonitorSupported ? (
        <p className="muted muted--hint">
          {autoTeamsRecordEnabled
            ? teamsCallDetected
              ? `Teams call detected${
                  teamsMatchedWindowTitle ? `: ${teamsMatchedWindowTitle}` : ''
                }. Auto-record is armed.`
              : 'Watching for a Teams call window.'
            : 'Enable this to auto-start on Teams calls.'}
        </p>
      ) : (
        <p className="muted muted--hint">
          Teams auto-recording requires the Electron app and system audio.
        </p>
      )}
      <p className="muted muted--hint">
        Recording now:{' '}
        <strong>
          {status === 'recording'
            ? `${activeRecordingTrigger === 'auto' ? 'yes (auto)' : 'yes (manual)'}`
            : 'no'}
        </strong>
        {status === 'recording' ? `, saving as ${recordingBaseName}` : ''}
      </p>
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
          onClick={() => void startRecording()}
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
