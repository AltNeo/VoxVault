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

  const isRecording = status === 'recording';
  const statusLabel = isRecording
    ? activeRecordingTrigger === 'auto'
      ? `Recording ${recordingBaseName}`
      : 'Recording your call'
    : status === 'stopped'
      ? 'Recording saved'
      : 'Ready when you are';
  const teamsHint = !teamsCallMonitorSupported
    ? 'Auto-record needs the desktop app with system audio.'
    : !autoTeamsRecordEnabled
      ? 'Turn on to get a prompt when a Teams call starts.'
      : teamsCallDetected
        ? `Teams call detected${teamsMatchedWindowTitle ? `: ${teamsMatchedWindowTitle}` : ''}.`
        : 'Watching for Teams calls.';

  return (
    <div className={`recorder ${isRecording ? 'recorder--live' : ''}`}>
      <button
        className="recorder__button"
        type="button"
        disabled={!isSupported || (!isRecording && disabled)}
        onClick={() => (isRecording ? stopRecording() : void startRecording())}
        aria-pressed={isRecording}
      >
        {isRecording ? 'Stop' : 'Record'}
      </button>

      <div className="recorder__body">
        <div className="recorder__time">
          <span className="recorder__clock">{formatDuration(durationSeconds)}</span>
          <span className="recorder__status">{statusLabel}</span>
        </div>
        <div className="recorder__bars" aria-hidden="true">
          {Array.from({ length: 32 }, (_, index) => (
            <i key={index} style={{ animationDelay: `${(index % 8) * 90}ms` }} />
          ))}
        </div>
        <div className="recorder__toggles">
          <label className="switch">
            <input
              type="checkbox"
              checked={captureMode === 'microphone_system'}
              disabled={isRecording || !supportsSystemAudio}
              onChange={(event) =>
                setCaptureMode(event.target.checked ? 'microphone_system' : 'microphone')
              }
            />
            <span>System audio</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked disabled />
            <span>Microphone</span>
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={autoTeamsRecordEnabled}
              onChange={(event) => setAutoTeamsRecordEnabled(event.target.checked)}
              disabled={!teamsCallMonitorSupported || !supportsSystemAudio}
            />
            <span>Auto-record Teams calls</span>
          </label>
        </div>
        <p className="hint">
          {teamsHint}
          {captureMode === 'microphone_system' && systemAudioBackend !== 'electron'
            ? ' Share your screen or tab with audio when asked.'
            : ''}
        </p>
        {status === 'stopped' && audioBlob && (
          <button className="btn btn--quiet" type="button" onClick={resetRecording}>
            Clear recorder
          </button>
        )}
        {!isSupported && <p className="error-text">Recording isn&apos;t supported here.</p>}
        {!supportsSystemAudio && (
          <p className="hint">System audio capture isn&apos;t available here, so only the mic is recorded.</p>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
