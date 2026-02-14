import { useMemo, useState } from 'react';
import type { Transcription } from '../types/api';

interface TranscriptionViewProps {
  transcription: Transcription | null;
  isLoading?: boolean;
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
}: TranscriptionViewProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const chunkCount = useMemo(() => {
    return transcription?.chunks.length ?? 0;
  }, [transcription]);

  const handleCopy = async () => {
    if (!transcription) {
      return;
    }

    try {
      await navigator.clipboard.writeText(transcription.text);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1400);
    } catch {
      setCopyState('failed');
    }
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
          <div className="transcription-meta">
            <span>{transcription.filename}</span>
            <span>{formatTimestamp(transcription.created_at)}</span>
            <span>{transcription.language.toUpperCase()}</span>
            <span>{chunkCount} chunks</span>
          </div>
          <article className="transcription-body">{transcription.text}</article>

          {copyState === 'failed' && (
            <p className="error-text">Could not copy to clipboard in this browser context.</p>
          )}
        </>
      )}
    </section>
  );
}
