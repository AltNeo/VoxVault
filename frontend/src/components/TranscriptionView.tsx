import { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import { splitSummarySections } from '../services/summary-sections';
import type { Transcription } from '../types/api';
import { formatDuration } from './TranscriptionHistory';

interface TranscriptionViewProps {
  transcription: Transcription | null;
  audioUrl?: string | null;
  isLoading?: boolean;
  isSaving?: boolean;
  isSummarizing?: boolean;
  isRetrying?: boolean;
  onSave: (id: string, title: string, text: string) => Promise<void>;
  onGenerateSummary: (id: string, customPrompt?: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
}

type Tab = 'transcript' | 'summary';
type CopyState = 'idle' | 'copied' | 'failed';

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function copyText(text: string, setState: (state: CopyState) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setState('copied');
    window.setTimeout(() => setState('idle'), 1400);
  } catch {
    setState('failed');
  }
}

export default function TranscriptionView({
  transcription,
  audioUrl = null,
  isLoading = false,
  isSaving = false,
  isSummarizing = false,
  isRetrying = false,
  onSave,
  onGenerateSummary,
  onRetry,
}: TranscriptionViewProps) {
  const [tab, setTab] = useState<Tab>('transcript');
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [summaryCopyState, setSummaryCopyState] = useState<CopyState>('idle');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftText, setDraftText] = useState('');

  const isDirty = useMemo(() => {
    if (!transcription) {
      return false;
    }
    return draftTitle.trim() !== transcription.title || draftText !== transcription.text;
  }, [draftText, draftTitle, transcription]);
  const summaryText = transcription?.summary_text?.trim() ?? '';
  const sections = useMemo(() => splitSummarySections(summaryText), [summaryText]);
  const hasSummary = sections.length > 0;
  const failed = transcription?.status === 'failed';

  useEffect(() => {
    if (!transcription) {
      setDraftTitle('');
      setDraftText('');
      return;
    }
    setDraftTitle(transcription.title);
    setDraftText(transcription.text);
  }, [transcription?.id, transcription?.title, transcription?.text]);

  useEffect(() => {
    setCopyState('idle');
    setSummaryCopyState('idle');
  }, [transcription?.id]);

  if (!transcription) {
    return (
      <section className="card doc doc--empty">
        <p className="doc__placeholder">
          {isLoading
            ? 'Opening recording…'
            : 'Pick a recording on the left, or record a call to see its transcript here.'}
        </p>
      </section>
    );
  }

  const meta = [
    transcription.source === 'recording' ? 'Recording' : 'Upload',
    formatTimestamp(transcription.created_at),
    formatDuration(transcription.duration_seconds),
  ].filter(Boolean);

  return (
    <section className={`card doc ${isLoading ? 'doc--busy' : ''}`} aria-busy={isLoading}>
      <div className="doc__head">
        <div className="doc__heading">
          <input
            className="doc__title"
            aria-label="Title"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            disabled={isSaving || failed}
          />
          <div className="doc__meta">{meta.join(' · ')}</div>
        </div>
        {!failed && (
          <div className="seg" role="tablist" aria-label="Transcript or summary">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'transcript'}
              onClick={() => setTab('transcript')}
            >
              Transcript
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'summary'}
              onClick={() => setTab('summary')}
            >
              Summary
            </button>
          </div>
        )}
      </div>

      {audioUrl && <audio className="doc__audio" src={audioUrl} controls preload="none" />}

      {failed ? (
        <div className="doc__failed">
          <p>
            This recording was saved, but it wasn&apos;t transcribed. Check that a transcription
            service is online, then try again.
          </p>
          <button
            className="btn btn--primary"
            type="button"
            disabled={isRetrying}
            onClick={() => void onRetry(transcription.id)}
          >
            {isRetrying ? 'Transcribing…' : 'Transcribe again'}
          </button>
        </div>
      ) : tab === 'transcript' ? (
        <>
          <textarea
            className="doc__body"
            aria-label="Transcript"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            disabled={isSaving}
          />
          <div className="doc__actions">
            <button
              className="btn btn--primary"
              type="button"
              onClick={() =>
                void onSave(transcription.id, draftTitle.trim(), draftText.trim())
              }
              disabled={
                !isDirty || isSaving || !draftTitle.trim() || !draftText.trim()
              }
            >
              {isSaving ? 'Saving…' : 'Save edits'}
            </button>
            <button className="btn" type="button" onClick={() => void copyText(draftText, setCopyState)}>
              {copyState === 'copied' ? 'Copied' : 'Copy text'}
            </button>
            {copyState === 'failed' && (
              <span className="error-text">Couldn&apos;t copy to the clipboard.</span>
            )}
          </div>
        </>
      ) : (
        <div aria-live="polite">
          {isSummarizing && (
            <p className="doc__placeholder">
              <span className="spinner" /> Writing the summary…
            </p>
          )}
          {!isSummarizing && !hasSummary && (
            <p className="doc__placeholder">
              Get the key points, decisions and action items from this call.
            </p>
          )}
          {hasSummary && (
            <div className="sumgrid">
              {sections.map((section, index) => (
                <article
                  key={`${section.title}-${index}`}
                  className={`sumcard sumcard--${section.kind} ${
                    index === 0 && section.kind === 'brief' ? 'sumcard--wide' : ''
                  }`}
                >
                  <h3>{section.title}</h3>
                  <Markdown>{section.body}</Markdown>
                </article>
              ))}
            </div>
          )}
          <div className="doc__actions">
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => void onGenerateSummary(transcription.id)}
              disabled={isSummarizing || !transcription.text.trim()}
            >
              {isSummarizing ? 'Summarizing…' : hasSummary ? 'Regenerate summary' : 'Summarize'}
            </button>
            {hasSummary && (
              <button
                className="btn"
                type="button"
                onClick={() => void copyText(summaryText, setSummaryCopyState)}
                disabled={isSummarizing}
              >
                {summaryCopyState === 'copied' ? 'Copied' : 'Copy summary'}
              </button>
            )}
            {summaryCopyState === 'failed' && (
              <span className="error-text">Couldn&apos;t copy to the clipboard.</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
