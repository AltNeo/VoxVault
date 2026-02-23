import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from '../services/api';

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

describe('api client', () => {
  it('stores and retrieves transcriptions in mock mode', async () => {
    const client = createApiClient({
      useMockApi: true,
      storage: createMemoryStorage(),
    });

    const file = new File(['mock audio'], 'meeting.webm', { type: 'audio/webm' });
    const created = await client.uploadAudio({ file, source: 'upload', language: 'en' });
    const listed = await client.listTranscriptions({ limit: 10, offset: 0 });
    const loaded = await client.getTranscription(created.id);

    expect(created.filename).toBe('meeting.webm');
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.id).toBe(created.id);
    expect(loaded.text.length).toBeGreaterThan(0);
  });

  it('calls backend health endpoint in real mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok', version: '1.0.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createApiClient({
      useMockApi: false,
      baseUrl: 'http://localhost:8000',
      fetchImpl: fetchMock,
    });

    const result = await client.health();

    expect(result.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/health',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('calls backend provider health endpoint in real mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          reachable: true,
          detail: null,
          upstream_status_code: 400,
          endpoint: 'https://chutes-whisper-large-v3.chutes.ai/transcribe',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const client = createApiClient({
      useMockApi: false,
      baseUrl: 'http://localhost:8000',
      fetchImpl: fetchMock,
    });

    const result = await client.providerHealth();

    expect(result.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/health/provider',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('throws ApiError for non-2xx backend responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'bad_request',
            message: 'Invalid payload',
          },
          request_id: 'req-1',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const client = createApiClient({
      useMockApi: false,
      baseUrl: 'http://localhost:8000',
      fetchImpl: fetchMock,
    });

    await expect(client.health()).rejects.toBeInstanceOf(ApiError);
  });

  it('updates transcription in mock mode', async () => {
    const client = createApiClient({
      useMockApi: true,
      storage: createMemoryStorage(),
    });

    const file = new File(['mock audio'], 'meeting.webm', { type: 'audio/webm' });
    const created = await client.uploadAudio({ file, source: 'upload', language: 'en' });
    const updated = await client.updateTranscription({
      id: created.id,
      title: 'team sync',
      text: 'edited transcript',
    });

    expect(updated.title).toBe('team sync');
    expect(updated.text).toBe('edited transcript');
  });

  it('stores and retrieves transcription prompt in mock mode', async () => {
    const client = createApiClient({
      useMockApi: true,
      storage: createMemoryStorage(),
    });

    await client.updateTranscriptionPrompt('teh -> the; recieve -> receive');
    const loaded = await client.getTranscriptionPrompt();

    expect(loaded.custom_prompt).toBe('teh -> the; recieve -> receive');
  });

  it('sends custom prompt with upload form data in real mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'tx-1',
          title: 'meeting',
          filename: 'meeting.mp3',
          source: 'upload',
          language: 'en',
          duration_seconds: 10,
          status: 'completed',
          text: 'hello world',
          created_at: new Date().toISOString(),
          audio_url: '/api/audio/tx-1',
          chunks: [],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const client = createApiClient({
      useMockApi: false,
      baseUrl: 'http://localhost:8000',
      fetchImpl: fetchMock,
    });

    const file = new File(['mock audio'], 'meeting.mp3', { type: 'audio/mpeg' });
    await client.uploadAudio({
      file,
      source: 'upload',
      language: 'en',
      customPrompt: 'Jon Smyth -> John Smith',
    });

    const call = fetchMock.mock.calls[0];
    const request = call[1] as RequestInit;
    const formData = request.body as FormData;
    expect(formData.get('custom_prompt')).toBe('Jon Smyth -> John Smith');
  });
});
