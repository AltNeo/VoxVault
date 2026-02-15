import { useCallback, useEffect, useMemo, useState } from 'react';
import AudioPlayer from '../components/AudioPlayer';
import AudioRecorder from '../components/AudioRecorder';
import FileUploader from '../components/FileUploader';
import ProviderStatusIndicator from '../components/ProviderStatusIndicator';
import TranscriptionHistory from '../components/TranscriptionHistory';
import TranscriptionView from '../components/TranscriptionView';
import { useTranscription } from '../hooks/useTranscription';
import type { TranscriptionSource } from '../types/api';

interface PendingAudio {
  file: File;
  previewUrl: string;
  source: TranscriptionSource;
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Home() {
  const {
    history,
    activeTranscription,
    isLoading,
    isHistoryLoading,
    isSavingEdits,
    error,
    uploadAudio,
    saveTranscriptionEdits,
    loadHistory,
    selectTranscription,
  } = useTranscription();

  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const setPending = useCallback((file: File, previewUrl: string, source: TranscriptionSource) => {
    setPendingAudio((current) => {
      if (current?.previewUrl && current.previewUrl !== previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return { file, previewUrl, source };
    });
  }, []);

  useEffect(() => {
    return () => {
      if (pendingAudio?.previewUrl) {
        URL.revokeObjectURL(pendingAudio.previewUrl);
      }
    };
  }, [pendingAudio]);

  const handleRecorded = useCallback(
    (file: File, previewUrl: string) => {
      setPending(file, previewUrl, 'recording');
    },
    [setPending]
  );

  const handleFilePicked = useCallback(
    (file: File, previewUrl: string) => {
      setPending(file, previewUrl, 'upload');
    },
    [setPending]
  );

  const handleSubmit = useCallback(async () => {
    if (!pendingAudio) {
      return;
    }
    await uploadAudio(pendingAudio.file, pendingAudio.source);
  }, [pendingAudio, uploadAudio]);

  const handleSelectHistory = useCallback(
    async (id: string) => {
      await selectTranscription(id);
    },
    [selectTranscription]
  );

  const playerSource = useMemo(() => {
    if (pendingAudio?.previewUrl) {
      return pendingAudio.previewUrl;
    }
    if (activeTranscription?.audio_url) {
      return activeTranscription.audio_url;
    }
    return null;
  }, [activeTranscription?.audio_url, pendingAudio?.previewUrl]);

  return (
    <main className="home">
      <section className="hero">
        <p className="hero__eyebrow">Audio to Text Studio</p>
        <h1>Signal Forge</h1>
        <p className="hero__lead">
          Record voice, upload files, and keep a searchable archive of transcripts with one focused
          workflow.
        </p>
        <ProviderStatusIndicator />
      </section>

      {error && <p className="global-error">{error}</p>}

      <section className="workspace-grid">
        <div className="stack">
          <AudioRecorder disabled={isLoading} onRecorded={handleRecorded} />
          <FileUploader disabled={isLoading} onFileSelected={handleFilePicked} />
          <AudioPlayer
            src={playerSource}
            label={
              pendingAudio
                ? `Selected: ${pendingAudio.file.name} (${formatBytes(pendingAudio.file.size)})`
                : 'Preview the selected clip or load from transcription history.'
            }
          />
          <button
            type="button"
            className="btn btn--primary action-button"
            disabled={isLoading || !pendingAudio}
            onClick={() => void handleSubmit()}
          >
            {isLoading ? 'Transcribing...' : 'Transcribe Selected Audio'}
          </button>
        </div>

        <TranscriptionView
          transcription={activeTranscription}
          isLoading={isLoading}
          isSaving={isSavingEdits}
          onSave={async (id, title, text) => {
            await saveTranscriptionEdits(id, title, text);
          }}
        />
      </section>

      <TranscriptionHistory
        items={history}
        activeId={activeTranscription?.id}
        isLoading={isHistoryLoading}
        onSelect={(id) => void handleSelectHistory(id)}
      />
    </main>
  );
}
