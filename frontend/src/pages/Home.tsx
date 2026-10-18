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
    isUploading,
    isLoadingDetail,
    isRetrying,
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
    retryTranscription,
    generateSummary,
  } = useTranscription();

  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const [inputMode, setInputMode] = useState<'record' | 'upload'>('record');
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptStatus, setPromptStatus] = useState<string | null>(null);
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
    const submitted = pendingAudio.previewUrl;
    try {
      await uploadAudio(pendingAudio.file, pendingAudio.source, promptDraft);
    } catch {
      return;
    }
    setPendingAudio((current) => (current?.previewUrl === submitted ? null : current));
  }, [pendingAudio, promptDraft, uploadAudio]);

  const clearPendingAudio = useCallback(() => {
    setPendingAudio(null);
    autoSubmittedPreviewRef.current = null;
  }, []);

  useEffect(() => {
    if (!pendingAudio || pendingAudio.source !== 'recording' || isUploading) {
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
  }, [isUploading, pendingAudio, promptDraft, uploadAudio]);

  const handlePromptsToggle = useCallback(() => {
    setPromptsOpen((current) => {
      const next = !current;
      if (next) {
        void loadTranscriptionPrompt();
        void loadSummaryPrompt();
      }
      return next;
    });
  }, [loadSummaryPrompt, loadTranscriptionPrompt]);

  const handlePromptSave = useCallback(async () => {
    try {
      await saveTranscriptionPrompt(promptDraft);
      setPromptStatus('Saved.');
    } catch (saveError) {
      setPromptStatus(saveError instanceof Error ? saveError.message : 'Could not save.');
    }
  }, [promptDraft, saveTranscriptionPrompt]);

  const handleSummaryPromptSave = useCallback(async () => {
    setIsSummaryPromptSaving(true);
    try {
      const result = await api.updateSummaryPrompt(summaryPromptDraft);
      setSummaryPrompt(result.custom_prompt);
      setSummaryPromptDraft(result.custom_prompt);
      setSummaryPromptStatus('Saved.');
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : 'Failed to update summary prompt.';
      setSummaryPromptStatus(message);
    } finally {
      setIsSummaryPromptSaving(false);
    }
  }, [summaryPromptDraft]);

  const handleGenerateSummary = useCallback(
    async (id: string, customPrompt?: string) => {
      await generateSummary(id, customPrompt);
      await loadHistory();
    },
    [generateSummary, loadHistory]
  );

  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) return history;
    return history.filter(
      (item) =>
        item.title.toLowerCase().includes(query) || item.text.toLowerCase().includes(query)
    );
  }, [history, historyQuery]);

  const activeAudioUrl = useMemo(() => {
    if (!activeTranscription) return null;
    return activeTranscription.audio_url || api.getAudioUrl(activeTranscription.id);
  }, [activeTranscription]);

  return (
    <div className="app">
      <aside className="sidebar card" aria-label="Recordings">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <span>VoxVault</span>
        </div>
        <input
          id="history-search"
          className="search"
          type="search"
          placeholder="Search recordings"
          value={historyQuery}
          onChange={(event) => setHistoryQuery(event.target.value)}
        />
        <TranscriptionHistory
          items={filteredHistory}
          activeId={activeTranscription?.id}
          isLoading={isHistoryLoading}
          emptyMessage={historyQuery.trim() ? 'No recordings match your search.' : undefined}
          onSelect={(id) => void selectTranscription(id)}
        />
      </aside>

      <main className="main">
        <header className="head">
          <h1>Recordings</h1>
          <div className="head__actions">
            <ProviderStatusIndicator />
            <button
              type="button"
              className={`btn ${promptsOpen ? 'btn--selected' : ''}`}
              onClick={handlePromptsToggle}
              aria-expanded={promptsOpen}
            >
              Prompts
            </button>
          </div>
        </header>

        {error && (
          <div className="banner banner--error" role="alert">
            {error}
          </div>
        )}

        {promptsOpen && (
          <section className="card prompts" aria-label="Prompts">
            <div className="prompts__field">
              <label htmlFor="custom-prompt">Spelling corrections</label>
              <p className="hint">Sent with every transcription to fix names and terms it gets wrong.</p>
              <textarea
                id="custom-prompt"
                value={promptDraft}
                onChange={(event) => {
                  setPromptDraft(event.target.value);
                  setPromptStatus(null);
                }}
                placeholder="Examples: teh -> the, Jon Smyth -> John Smith"
                disabled={isPromptLoading || isPromptSaving}
              />
              <div className="row">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void handlePromptSave()}
                  disabled={isPromptLoading || isPromptSaving}
                >
                  {isPromptSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPromptDraft(transcriptionPrompt)}
                  disabled={isPromptLoading || isPromptSaving}
                >
                  Reset
                </button>
                {promptStatus && <span className="hint">{promptStatus}</span>}
              </div>
            </div>
            <div className="prompts__field">
              <label htmlFor="summary-prompt">Summary instructions</label>
              <p className="hint">Shapes every summary. Leave empty to use the default sections.</p>
              <textarea
                id="summary-prompt"
                value={summaryPromptDraft}
                onChange={(event) => {
                  setSummaryPromptDraft(event.target.value);
                  setSummaryPromptStatus(null);
                }}
                placeholder="Key topics, decisions, action items with owners, and a short summary."
                disabled={isSummaryPromptLoading || isSummaryPromptSaving}
              />
              <div className="row">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void handleSummaryPromptSave()}
                  disabled={isSummaryPromptLoading || isSummaryPromptSaving}
                >
                  {isSummaryPromptSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setSummaryPromptDraft(summaryPrompt)}
                  disabled={isSummaryPromptLoading || isSummaryPromptSaving}
                >
                  Reset
                </button>
                {summaryPromptStatus && <span className="hint">{summaryPromptStatus}</span>}
              </div>
            </div>
          </section>
        )}

        <section className="card capture" aria-label="Capture audio">
          <div className="seg" role="tablist" aria-label="Record or upload">
            <button
              type="button"
              role="tab"
              aria-selected={inputMode === 'record'}
              onClick={() => setInputMode('record')}
            >
              Record
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inputMode === 'upload'}
              onClick={() => setInputMode('upload')}
            >
              Upload a file
            </button>
          </div>

          {/* The recorder stays mounted so switching tabs never drops a recording in progress. */}
          <div hidden={inputMode !== 'record'}>
            <AudioRecorder onRecorded={handleRecorded} />
          </div>
          <div hidden={inputMode !== 'upload'}>
            <FileUploader disabled={isUploading} onFileSelected={handleFilePicked} />
          </div>

          {(pendingAudio || isUploading) && (
            <div className="pending">
              {pendingAudio && <audio src={pendingAudio.previewUrl} controls />}
              <div className="pending__row">
                <span className="pending__name">
                  {isUploading
                    ? 'Transcribing… you can keep browsing while this runs.'
                    : pendingAudio
                      ? `${pendingAudio.file.name} · ${formatBytes(pendingAudio.file.size)}`
                      : null}
                </span>
                {pendingAudio && !isUploading && (
                  <>
                    <button type="button" className="btn" onClick={clearPendingAudio}>
                      {pendingAudio.source === 'recording' ? 'Discard' : 'Remove'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => void handleSubmit()}
                    >
                      Transcribe
                    </button>
                  </>
                )}
                {isUploading && <span className="spinner" aria-hidden="true" />}
              </div>
            </div>
          )}
        </section>

        <TranscriptionView
          transcription={activeTranscription}
          audioUrl={activeAudioUrl}
          isLoading={isLoadingDetail}
          isSaving={isSavingEdits}
          isSummarizing={isSummarizing}
          isRetrying={isRetrying}
          onSave={async (id, title, text) => {
            await saveTranscriptionEdits(id, title, text).catch(() => undefined);
          }}
          onGenerateSummary={handleGenerateSummary}
          onRetry={retryTranscription}
        />
      </main>
    </div>
  );
}
