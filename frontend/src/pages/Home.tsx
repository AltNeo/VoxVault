import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AudioRecorder from '../components/AudioRecorder';
import FileUploader from '../components/FileUploader';
import ProviderStatusIndicator from '../components/ProviderStatusIndicator';
import TranscriptionHistory from '../components/TranscriptionHistory';
import TranscriptionView from '../components/TranscriptionView';
import { useTranscription } from '../hooks/useTranscription';
import api from '../services/api';
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
    isSummarizing,
    error,
    uploadAudio,
    loadTranscriptionPrompt,
    saveTranscriptionPrompt,
    saveTranscriptionEdits,
    loadHistory,
    selectTranscription,
    generateSummary,
  } = useTranscription();

  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [inputMode, setInputMode] = useState<'record' | 'upload'>('record');
  const [promptSectionOpen, setPromptSectionOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptStatus, setPromptStatus] = useState<string | null>(null);
  const [summaryPromptSectionOpen, setSummaryPromptSectionOpen] = useState(false);
  const [summaryPrompt, setSummaryPrompt] = useState('');
  const [summaryPromptDraft, setSummaryPromptDraft] = useState('');
  const [summaryPromptStatus, setSummaryPromptStatus] = useState<string | null>(null);
  const [isSummaryPromptLoading, setIsSummaryPromptLoading] = useState(false);
  const [isSummaryPromptSaving, setIsSummaryPromptSaving] = useState(false);
  const autoSubmittedPreviewRef = useRef<string | null>(null);

  const loadSummaryPrompt = useCallback(async () => {
    setIsSummaryPromptLoading(true);
    try {
      const result = await api.getSummaryPrompt();
      setSummaryPrompt(result.custom_prompt);
      setSummaryPromptDraft(result.custom_prompt);
      setSummaryPromptStatus(null);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Failed to load summary prompt.';
      setSummaryPromptStatus(message);
    } finally {
      setIsSummaryPromptLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    void loadTranscriptionPrompt();
    void loadSummaryPrompt();
  }, [loadHistory, loadSummaryPrompt, loadTranscriptionPrompt]);

  useEffect(() => {
    setPromptDraft(transcriptionPrompt);
  }, [transcriptionPrompt]);

  useEffect(() => {
    setSummaryPromptDraft(summaryPrompt);
  }, [summaryPrompt]);

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

  const clearPendingAudio = useCallback(() => {
    setPendingAudio(null);
    autoSubmittedPreviewRef.current = null;
  }, []);

  useEffect(() => {
    if (!pendingAudio || pendingAudio.source !== 'recording' || isLoading) {
      return;
    }

    if (autoSubmittedPreviewRef.current === pendingAudio.previewUrl) {
      return;
    }

    autoSubmittedPreviewRef.current = pendingAudio.previewUrl;

    void uploadAudio(pendingAudio.file, pendingAudio.source, promptDraft)
      .then(() => {
        setPendingAudio((current) => {
          if (current?.previewUrl !== pendingAudio.previewUrl) {
            return current;
          }

          return null;
        });
      })
      .catch(() => undefined);
  }, [isLoading, pendingAudio, promptDraft, uploadAudio]);

  const handlePromptToggle = useCallback(() => {
    setPromptSectionOpen((current) => {
      const next = !current;
      if (next) {
        void loadTranscriptionPrompt();
      }
      return next;
    });
  }, [loadTranscriptionPrompt]);

  const handlePromptSave = useCallback(async () => {
    await saveTranscriptionPrompt(promptDraft);
    setPromptStatus('Prompt updated.');
  }, [promptDraft, saveTranscriptionPrompt]);

  const handleSummaryPromptToggle = useCallback(() => {
    setSummaryPromptSectionOpen((current) => {
      const next = !current;
      if (next) {
        void loadSummaryPrompt();
      }
      return next;
    });
  }, [loadSummaryPrompt]);

  const handleSummaryPromptSave = useCallback(async () => {
    setIsSummaryPromptSaving(true);
    try {
      const result = await api.updateSummaryPrompt(summaryPromptDraft);
      setSummaryPrompt(result.custom_prompt);
      setSummaryPromptDraft(result.custom_prompt);
      setSummaryPromptStatus('Summary prompt updated.');
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : 'Failed to update summary prompt.';
      setSummaryPromptStatus(message);
    } finally {
      setIsSummaryPromptSaving(false);
    }
  }, [summaryPromptDraft]);

  const handleSelectHistory = useCallback(
    async (id: string) => {
      await selectTranscription(id);
      setHistoryOpen(false);
    },
    [selectTranscription]
  );

  const handleGenerateSummary = useCallback(
    async (id: string, customPrompt?: string) => {
      await generateSummary(id, customPrompt);
      await loadHistory();
    },
    [generateSummary, loadHistory]
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
            onClick={handlePromptToggle}
            aria-label="Toggle known misspellings"
          >
            <span className="history-toggle__icon">
              {promptSectionOpen ? 'Hide Misspellings' : 'Known Misspellings'}
            </span>
          </button>
          <button
            type="button"
            className={`history-toggle ${summaryPromptSectionOpen ? 'history-toggle--active' : ''}`}
            onClick={handleSummaryPromptToggle}
            aria-label="Toggle summary prompt"
          >
            <span className="history-toggle__icon">
              {summaryPromptSectionOpen ? 'Hide Summary' : 'Summary Prompt'}
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

        {summaryPromptSectionOpen && (
          <div className="prompt-popover prompt-popover--summary">
            <label className="field-block__label" htmlFor="summary-prompt">
              Summary Prompt
            </label>
            <textarea
              id="summary-prompt"
              className="transcription-body prompt-panel__input"
              value={summaryPromptDraft}
              onChange={(event) => {
                setSummaryPromptDraft(event.target.value);
                if (summaryPromptStatus) {
                  setSummaryPromptStatus(null);
                }
              }}
              placeholder="You are a meeting summarizer. Given a transcript, produce key topics, decisions, action items, and a brief summary."
              disabled={isSummaryPromptLoading || isSummaryPromptSaving}
            />
            <p className="muted muted--hint">
              This prompt shapes the summary model&apos;s output for every generated summary.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void handleSummaryPromptSave()}
                disabled={isSummaryPromptLoading || isSummaryPromptSaving}
              >
                {isSummaryPromptSaving ? 'Saving...' : 'Save Prompt'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setSummaryPromptDraft(summaryPrompt)}
                disabled={isSummaryPromptLoading || isSummaryPromptSaving}
              >
                Reset
              </button>
            </div>
            {summaryPromptStatus && (
              <span className="prompt-toolbar__status">{summaryPromptStatus}</span>
            )}
          </div>
        )}
      </header>

      <main className={`workspace ${historyOpen ? 'workspace--history-open' : ''}`}>
        {error && <div className="toast toast--error">{error}</div>}

        <section className="workspace__controls">
          <div className="module panel panel--controls">
            <div className="panel__header">
              <h2>Capture Input</h2>
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
                  <div className="dock__preview-meta">
                    <span className="dock__filename">
                      {pendingAudio.file.name} ({formatBytes(pendingAudio.file.size)})
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost dock__preview-delete"
                      onClick={clearPendingAudio}
                      disabled={isLoading}
                    >
                      {pendingAudio.source === 'recording' ? 'Delete recording' : 'Remove upload'}
                    </button>
                  </div>
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
              isSummarizing={isSummarizing}
              onSave={async (id, title, text) => {
                await saveTranscriptionEdits(id, title, text);
              }}
              onGenerateSummary={handleGenerateSummary}
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
