import { describe, expect, it } from 'vitest';
import { upsertHistory } from '../hooks/useTranscription';
import type { Transcription, TranscriptionSummary } from '../types/api';

function item(id: string, title = id): TranscriptionSummary {
  return {
    id,
    title,
    filename: `${id}.mp3`,
    source: 'recording',
    language: 'en',
    duration_seconds: 60,
    status: 'completed',
    text: 'text',
    summary_text: null,
    created_at: '2026-10-17T10:00:00Z',
    audio_url: `/api/audio/${id}`,
  };
}

describe('upsertHistory', () => {
  it('updates an existing entry in place instead of moving it to the top', () => {
    const history = [item('a'), item('b'), item('c')];
    const opened: Transcription = { ...item('c', 'renamed'), chunks: [] };

    const next = upsertHistory(history, opened);

    expect(next.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(next[2].title).toBe('renamed');
    expect('chunks' in next[2]).toBe(false);
  });

  it('puts a new recording at the top', () => {
    const next = upsertHistory([item('a')], item('new'));
    expect(next.map((entry) => entry.id)).toEqual(['new', 'a']);
  });
});
