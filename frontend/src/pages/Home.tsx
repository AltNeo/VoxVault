import { useCallback, useEffect, useMemo, useState } from 'react';
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
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Home() {
  const {
    history,
    activeTranscription,
    transcriptionPrompt,
    isLoading,
    isHistoryLoading,
    isPromptLoading,
    isPromptSaving,
    isSavingEdits,
    error,
    uploadAudio,
    loadTranscriptionPrompt,
    saveTranscriptionPrompt,
    saveTranscriptionEdits,
    loadHistory,
    selectTranscription,
  } = useTranscription();

  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [inputMode, setInputMode] = useState<'record' | 'upload'>('record');
  const [promptSectionOpen, setPromptSectionOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptStatus, setPromptStatus] = useState<string | null>(null);

  useEffect(() => {
    void loadHistory();
    void loadTranscriptionPrompt();
  }, [loadHistory, loadTranscriptionPrompt]);

  useEffect(() => {
    setPromptDraft(transcriptionPrompt);
  }, [transcriptionPrompt]);

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
    if (!pendingAudio) return;
    await uploadAudio(pendingAudio.file, pendingAudio.source, promptDraft);
  }, [pendingAudio, promptDraft, uploadAudio]);

  const handlePromptSave = useCallback(async () => {
    await saveTranscriptionPrompt(promptDraft);
    setPromptStatus('Prompt updated.');
  }, [promptDraft, saveTranscriptionPrompt]);

  const handleSelectHistory = useCallback(
    async (id: string) => {
      await selectTranscription(id);
      setHistoryOpen(false);
    },
    [selectTranscription]
  );

  const playerSource = useMemo(() => {
    if (pendingAudio?.previewUrl) return pendingAudio.previewUrl;
    if (activeTranscription?.audio_url) return activeTranscription.audio_url;
    return null;
  }, [activeTranscription?.audio_url, pendingAudio?.previewUrl]);

  return (
    <div className="void">
      <div className="void__orb void__orb--1" />
      <div className="void__orb void__orb--2" />
      <div className="void__orb void__orb--3" />
      <div className="void__watermark">VoxVault by AltNeo</div>
      <div
        className={`void__scrim ${historyOpen ? 'void__scrim--visible' : ''}`}
        onClick={() => setHistoryOpen(false)}
      />

      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="VoxVault" className="brand__mark" />
          <span className="brand__name">VoxVault</span>
        </div>
        <ProviderStatusIndicator />
        <div className="topbar__actions">
          <button
            type="button"
            className={`history-toggle ${promptSectionOpen ? 'history-toggle--active' : ''}`}
            onClick={() => setPromptSectionOpen((current) => !current)}
            aria-label="Toggle known misspellings"
          >
            <span className="history-toggle__icon">
              {promptSectionOpen ? 'Hide Misspellings' : 'Known Misspellings'}
            </span>
          </button>
          <button
            type="button"
            className={`history-toggle ${historyOpen ? 'history-toggle--active' : ''}`}
            onClick={() => setHistoryOpen((current) => !current)}
            aria-label="Toggle history panel"
          >
            <span className="history-toggle__icon">{historyOpen ? 'Close' : 'Open'}</span>
            <span className="history-toggle__count">{history.length}</span>
          </button>
        </div>

        {promptSectionOpen && (
          <div className="prompt-popover">
            <label className="field-block__label" htmlFor="custom-prompt">
              Corrections Prompt
            </label>
            <textarea
              id="custom-prompt"
              className="transcription-body prompt-panel__input"
              value={promptDraft}
              onChange={(event) => {
                setPromptDraft(event.target.value);
                if (promptStatus) {
                  setPromptStatus(null);
                }
              }}
              placeholder="Examples: teh -> the, recieve -> receive, Jon Smyth -> John Smith"
              disabled={isPromptLoading || isPromptSaving}
            />
            <p className="muted muted--hint">
              This text is sent with each transcription to help fix known misspellings.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void handlePromptSave()}
                disabled={isPromptLoading || isPromptSaving}
              >
                {isPromptSaving ? 'Updating...' : 'Update Prompt'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setPromptDraft(transcriptionPrompt)}
                disabled={isPromptLoading || isPromptSaving}
              >
                Reset
              </button>
            </div>
            {promptStatus && <span className="prompt-toolbar__status">{promptStatus}</span>}
          </div>
        )}
      </header>

      <main className={`workspace ${historyOpen ? 'workspace--history-open' : ''}`}>
        {error && <div className="toast toast--error">{error}</div>}

        <section className="workspace__controls">
          <div className="module panel panel--controls">
            <div className="panel__header">
              <h2>Capture Input</h2>
              <p>Choose one source to prepare audio for transcription.</p>
            </div>

            <div className="dock__modes">
              <button
                type="button"
                className={`dock__mode ${inputMode === 'record' ? 'dock__mode--active' : ''}`}
                onClick={() => setInputMode('record')}
              >
                Record
              </button>
              <button
                type="button"
                className={`dock__mode ${inputMode === 'upload' ? 'dock__mode--active' : ''}`}
                onClick={() => setInputMode('upload')}
              >
                Upload
              </button>
            </div>

            <div className="dock__panel">
              {inputMode === 'record' ? (
                <AudioRecorder disabled={isLoading} onRecorded={handleRecorded} />
              ) : (
                <FileUploader disabled={isLoading} onFileSelected={handleFilePicked} />
              )}
            </div>

            {playerSource && (
              <div className="dock__preview">
                <audio src={playerSource} controls />
                {pendingAudio && (
                  <span className="dock__filename">
                    {pendingAudio.file.name} ({formatBytes(pendingAudio.file.size)})
                  </span>
                )}
              </div>
            )}

            <button
              type="button"
              className={`dock__action ${isLoading ? 'dock__action--loading' : ''}`}
              disabled={isLoading || !pendingAudio}
              onClick={() => void handleSubmit()}
            >
              {isLoading ? (
                <>
                  <span className="spinner" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <span className="dock__action-icon">Start</span>
                  <span>Transcribe</span>
                </>
              )}
            </button>

          </div>
        </section>

        <section className="workspace__transcript">
          <div className="transcript-hero">
            <TranscriptionView
              transcription={activeTranscription}
              isLoading={isLoading}
              isSaving={isSavingEdits}
              onSave={async (id, title, text) => {
                await saveTranscriptionEdits(id, title, text);
              }}
            />
          </div>
        </section>

        <aside className={`history-panel ${historyOpen ? 'history-panel--open' : ''}`}>
          <div className="history-panel__header">
            <h2>History</h2>
            <button
              type="button"
              className="history-panel__close"
              onClick={() => setHistoryOpen(false)}
            >
              Close
            </button>
          </div>
          <TranscriptionHistory
            items={history}
            activeId={activeTranscription?.id}
            isLoading={isHistoryLoading}
            onSelect={(id) => void handleSelectHistory(id)}
          />
        </aside>
      </main>
    </div>
  );
}
