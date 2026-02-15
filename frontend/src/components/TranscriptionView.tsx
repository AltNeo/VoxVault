import { useEffect, useMemo, useState } from 'react';
import type { Transcription } from '../types/api';

interface TranscriptionViewProps {
  transcription: Transcription | null;
  isLoading?: boolean;
  isSaving?: boolean;
  onSave: (id: string, title: string, text: string) => Promise<void>;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export default function TranscriptionView({
  transcription,
  isLoading = false,
  isSaving = false,
  onSave,
}: TranscriptionViewProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftText, setDraftText] = useState('');

  const chunkCount = useMemo(() => {
    return transcription?.chunks.length ?? 0;
  }, [transcription]);
  const isDirty = useMemo(() => {
    if (!transcription) {
      return false;
    }
    return draftTitle.trim() !== transcription.title || draftText !== transcription.text;
  }, [draftText, draftTitle, transcription]);

  useEffect(() => {
    if (!transcription) {
      setDraftTitle('');
      setDraftText('');
      return;
    }
    setDraftTitle(transcription.title);
    setDraftText(transcription.text);
  }, [transcription?.id, transcription?.title, transcription?.text]);

  const handleCopy = async () => {
    if (!transcription) {
      return;
    }

    try {
      await navigator.clipboard.writeText(draftText);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1400);
    } catch {
      setCopyState('failed');
    }
  };

  const handleSave = async () => {
    if (!transcription) {
      return;
    }
    await onSave(transcription.id, draftTitle.trim(), draftText.trim());
  };

  return (
    <section className="module module--transcription">
      <div className="module__head">
        <h3>Transcription View</h3>
        <button
          className="btn btn--ghost"
          type="button"
          onClick={handleCopy}
          disabled={!transcription}
        >
          {copyState === 'copied' ? 'Copied' : 'Copy Text'}
        </button>
      </div>

      {isLoading && <p className="placeholder-text">Transcribing audio...</p>}

      {!isLoading && !transcription && (
        <p className="placeholder-text">Upload or record audio to generate a transcript.</p>
      )}

      {transcription && (
        <>
          <label className="field-block">
            <span className="field-block__label">Title</span>
            <input
              className="field-input"
              type="text"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              disabled={isSaving}
            />
          </label>

          <div className="transcription-meta">
            <span>{transcription.filename}</span>
            <span>{formatTimestamp(transcription.created_at)}</span>
            <span>{transcription.language.toUpperCase()}</span>
            <span>{chunkCount} chunks</span>
          </div>

          <label className="field-block">
            <span className="field-block__label">Transcript</span>
            <textarea
              className="transcription-body transcription-body--editable"
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              disabled={isSaving}
            />
          </label>

          <div className="transcription-actions">
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => void handleSave()}
              disabled={!isDirty || isSaving || draftTitle.trim().length === 0 || draftText.trim().length === 0}
            >
              {isSaving ? 'Saving...' : 'Save edits'}
            </button>
          </div>

          {copyState === 'failed' && (
            <p className="error-text">Could not copy to clipboard in this browser context.</p>
          )}
        </>
      )}
    </section>
  );
}
