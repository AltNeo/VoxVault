import type {
  ErrorResponse,
  HealthResponse,
  ListTranscriptionsInput,
  ProviderHealthResponse,
  SummaryModelHealthResponse,
  SummaryPromptResponse,
  SummaryResponse,
  TranscriptionPromptResponse,
  Transcription,
  TranscriptionListResponse,
  TranscriptionSummary,
  UploadAudioInput,
  UpdateTranscriptionInput,
} from '../types/api';

const MOCK_STORAGE_KEY = 'mock_transcriptions_v1';
const MOCK_PROMPT_STORAGE_KEY = 'mock_transcription_prompt_v1';
const MOCK_SUMMARY_PROMPT_STORAGE_KEY = 'mock_summary_prompt_v1';
const DEFAULT_BASE_URL = 'http://localhost:8000';
const DEFAULT_DELAY_MS = 300;
const mockAudioRegistry = new Map<string, string>();

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type FetchImpl = typeof fetch;

export interface ApiClient {
  health(): Promise<HealthResponse>;
  providerHealth(): Promise<ProviderHealthResponse>;
  summaryModelHealth(): Promise<SummaryModelHealthResponse>;
  uploadAudio(input: UploadAudioInput): Promise<Transcription>;
  getTranscriptionPrompt(): Promise<TranscriptionPromptResponse>;
  updateTranscriptionPrompt(customPrompt: string): Promise<TranscriptionPromptResponse>;
  getSummaryPrompt(): Promise<SummaryPromptResponse>;
  updateSummaryPrompt(customPrompt: string): Promise<SummaryPromptResponse>;
  summarizeTranscription(id: string, customPrompt?: string): Promise<SummaryResponse>;
  updateTranscription(input: UpdateTranscriptionInput): Promise<Transcription>;
  listTranscriptions(input?: ListTranscriptionsInput): Promise<TranscriptionListResponse>;
  getTranscription(id: string): Promise<Transcription>;
  getAudioUrl(id: string): string;
}

interface ApiClientOptions {
  baseUrl?: string;
  useMockApi?: boolean;
  fetchImpl?: FetchImpl;
  storage?: StorageLike;
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `mock-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

function resolveAudioUrl(baseUrl: string, value: string): string {
  if (
    value.startsWith('blob:') ||
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('mock://')
  ) {
    return value;
  }
  if (value.startsWith('/')) {
    return `${baseUrl}${value}`;
  }
  return `${baseUrl}/${value}`;
}

function normalizeTranscription<T extends TranscriptionSummary>(baseUrl: string, item: T): T {
  return {
    ...item,
    audio_url: resolveAudioUrl(baseUrl, item.audio_url),
    summary_text: item.summary_text ?? null,
  };
}

async function requestJson<T>(fetchImpl: FetchImpl, url: string, init: RequestInit): Promise<T> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const maybeError = payload as Partial<ErrorResponse>;
    const message = maybeError?.error?.message ?? `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

function parseStore(storage: StorageLike): Transcription[] {
  const raw = storage.getItem(MOCK_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as Transcription[];
    }
    return [];
  } catch {
    return [];
  }
}

function saveStore(storage: StorageLike, items: Transcription[]): void {
  storage.setItem(MOCK_STORAGE_KEY, JSON.stringify(items));
}

function toChunks(text: string): Transcription['chunks'] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const chunks: Transcription['chunks'] = [];
  const chunkSize = 10;
  for (let index = 0; index < words.length; index += chunkSize) {
    const chunkWords = words.slice(index, index + chunkSize);
    chunks.push({
      start: Number((index * 0.45).toFixed(2)),
      end: Number(((index + chunkWords.length) * 0.45).toFixed(2)),
      text: chunkWords.join(' '),
    });
  }
  return chunks;
}

function inferText(filename: string): string {
  const base = filename
    .replace(/\.[^/.]+$/, '')
    .replace(/[-_]/g, ' ')
    .trim();
  return `Transcription for ${base || 'audio file'} generated by mock mode.`;
}

function createMockClient(storage: StorageLike): ApiClient {
  let items = parseStore(storage).map((item) => ({
    ...item,
    summary_text: item.summary_text ?? null,
  }));

  return {
    async health() {
      await delay(DEFAULT_DELAY_MS);
      return {
        status: 'ok',
        version: 'mock-1.0.0',
      };
    },

    async providerHealth() {
      await delay(DEFAULT_DELAY_MS);
      return {
        status: 'ok',
        reachable: true,
        detail: 'Mock mode provider health',
        upstream_status_code: 200,
        endpoint: 'mock://provider',
      };
    },

    async summaryModelHealth() {
      await delay(DEFAULT_DELAY_MS);
      return {
        ready: true,
        model_name: 'mock-lfm2-2.6b',
        detail: 'Mock mode summary model health',
      };
    },

    async uploadAudio(input) {
      await delay(DEFAULT_DELAY_MS);

      const id = makeId();
      const guessedText = inferText(input.file.name);
      const chunkedText = toChunks(guessedText);
      const audioUrl =
        typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(input.file)
          : `mock://audio/${id}`;
      mockAudioRegistry.set(id, audioUrl);

      const transcription: Transcription = {
        id,
        title: input.file.name.replace(/\.[^/.]+$/, '').trim() || input.file.name,
        filename: input.file.name,
        source: input.source ?? 'upload',
        language: input.language ?? 'en',
        duration_seconds: Number((input.file.size / 32_000).toFixed(2)),
        status: 'completed',
        text: guessedText,
        summary_text: null,
        created_at: new Date().toISOString(),
        audio_url: audioUrl,
        chunks: chunkedText,
      };

      items = [transcription, ...items];
      saveStore(storage, items);
      return transcription;
    },

    async getTranscriptionPrompt() {
      await delay(DEFAULT_DELAY_MS);
      return {
        custom_prompt: storage.getItem(MOCK_PROMPT_STORAGE_KEY) ?? '',
      };
    },

    async updateTranscriptionPrompt(customPrompt) {
      await delay(DEFAULT_DELAY_MS);
      const normalizedPrompt = customPrompt.trim();
      storage.setItem(MOCK_PROMPT_STORAGE_KEY, normalizedPrompt);
      return {
        custom_prompt: normalizedPrompt,
      };
    },

    async getSummaryPrompt() {
      await delay(DEFAULT_DELAY_MS);
      return {
        custom_prompt: storage.getItem(MOCK_SUMMARY_PROMPT_STORAGE_KEY) ?? '',
      };
    },

    async updateSummaryPrompt(customPrompt) {
      await delay(DEFAULT_DELAY_MS);
      const normalizedPrompt = customPrompt.trim();
      storage.setItem(MOCK_SUMMARY_PROMPT_STORAGE_KEY, normalizedPrompt);
      return {
        custom_prompt: normalizedPrompt,
      };
    },

    async summarizeTranscription(id, customPrompt) {
      await delay(DEFAULT_DELAY_MS);
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) {
        throw new ApiError('Transcription not found', 404, {
          error: { code: 'not_found', message: 'Transcription not found' },
          request_id: 'mock',
        });
      }

      const current = items[index];
      const prompt = customPrompt?.trim() || storage.getItem(MOCK_SUMMARY_PROMPT_STORAGE_KEY) || '';
      const excerpt = current.text.trim().slice(0, 120) || 'No transcript text available.';
      const summaryText = [
        `Key Topics: ${current.title}`,
        `Decisions Made: none captured in mock mode`,
        `Action Items: review transcript`,
        `Brief Summary: ${excerpt}`,
        prompt ? `Prompt Used: ${prompt}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      const updated: Transcription = {
        ...current,
        summary_text: summaryText,
      };

      items = [updated, ...items.filter((item) => item.id !== id)];
      saveStore(storage, items);

      return {
        id,
        summary_text: summaryText,
      };
    },

    async updateTranscription(input) {
      await delay(DEFAULT_DELAY_MS);
      const index = items.findIndex((item) => item.id === input.id);
      if (index < 0) {
        throw new ApiError('Transcription not found', 404, {
          error: { code: 'not_found', message: 'Transcription not found' },
          request_id: 'mock',
        });
      }

      const current = items[index];
      const updated: Transcription = {
        ...current,
        title: input.title ?? current.title,
        text: input.text ?? current.text,
      };
      items = [updated, ...items.filter((item) => item.id !== input.id)];
      saveStore(storage, items);
      return updated;
    },

    async listTranscriptions(input = {}) {
      await delay(DEFAULT_DELAY_MS);
      const limit = input.limit ?? 20;
      const offset = input.offset ?? 0;
      const sliced = items.slice(offset, offset + limit);

      return {
        items: sliced.map(({ chunks: _chunks, ...summary }) => summary),
        total: items.length,
        limit,
        offset,
      };
    },

    async getTranscription(id) {
      await delay(DEFAULT_DELAY_MS);
      const found = items.find((item) => item.id === id);
      if (!found) {
        throw new ApiError('Transcription not found', 404, {
          error: { code: 'not_found', message: 'Transcription not found' },
          request_id: 'mock',
        });
      }
      return found;
    },

    getAudioUrl(id) {
      const blobUrl = mockAudioRegistry.get(id);
      if (blobUrl) {
        return blobUrl;
      }

      const found = items.find((item) => item.id === id);
      if (!found) {
        return `mock://audio/${id}`;
      }
      return found.audio_url;
    },
  };
}

function createHttpClient(baseUrl: string, fetchImpl: FetchImpl): ApiClient {
  return {
    async health() {
      return requestJson<HealthResponse>(fetchImpl, `${baseUrl}/api/health`, {
        method: 'GET',
      });
    },

    async providerHealth() {
      return requestJson<ProviderHealthResponse>(fetchImpl, `${baseUrl}/api/health/provider`, {
        method: 'GET',
      });
    },

    async summaryModelHealth() {
      return requestJson<SummaryModelHealthResponse>(
        fetchImpl,
        `${baseUrl}/api/health/summary-model`,
        {
          method: 'GET',
        }
      );
    },

    async uploadAudio(input) {
      const formData = new FormData();
      formData.append('file', input.file);

      if (input.language) {
        formData.append('language', input.language);
      }
      if (input.source) {
        formData.append('source', input.source);
      }
      if (typeof input.customPrompt === 'string') {
        const normalizedPrompt = input.customPrompt.trim();
        if (normalizedPrompt) {
          formData.append('custom_prompt', normalizedPrompt);
        }
      }

      const result = await requestJson<Transcription>(fetchImpl, `${baseUrl}/api/upload`, {
        method: 'POST',
        body: formData,
      });
      return normalizeTranscription(baseUrl, result);
    },

    async getTranscriptionPrompt() {
      return requestJson<TranscriptionPromptResponse>(
        fetchImpl,
        `${baseUrl}/api/transcription-prompt`,
        {
          method: 'GET',
        }
      );
    },

    async updateTranscriptionPrompt(customPrompt) {
      return requestJson<TranscriptionPromptResponse>(
        fetchImpl,
        `${baseUrl}/api/transcription-prompt`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ custom_prompt: customPrompt.trim() }),
        }
      );
    },

    async getSummaryPrompt() {
      return requestJson<SummaryPromptResponse>(fetchImpl, `${baseUrl}/api/summary-prompt`, {
        method: 'GET',
      });
    },

    async updateSummaryPrompt(customPrompt) {
      return requestJson<SummaryPromptResponse>(fetchImpl, `${baseUrl}/api/summary-prompt`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_prompt: customPrompt.trim() }),
      });
    },

    async summarizeTranscription(id, customPrompt) {
      const body: Record<string, string> = {};
      if (typeof customPrompt === 'string') {
        const normalizedPrompt = customPrompt.trim();
        if (normalizedPrompt) {
          body.custom_prompt = normalizedPrompt;
        }
      }

      return requestJson<SummaryResponse>(
        fetchImpl,
        `${baseUrl}/api/transcriptions/${encodeURIComponent(id)}/summarize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
    },

    async updateTranscription(input) {
      const body: Record<string, string> = {};
      if (typeof input.title === 'string') {
        body.title = input.title;
      }
      if (typeof input.text === 'string') {
        body.text = input.text;
      }

      const result = await requestJson<Transcription>(
        fetchImpl,
        `${baseUrl}/api/transcriptions/${encodeURIComponent(input.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      return normalizeTranscription(baseUrl, result);
    },

    async listTranscriptions(input = {}) {
      const params = new URLSearchParams();
      if (typeof input.limit === 'number') {
        params.set('limit', String(input.limit));
      }
      if (typeof input.offset === 'number') {
        params.set('offset', String(input.offset));
      }

      const query = params.toString();
      const url = query
        ? `${baseUrl}/api/transcriptions?${query}`
        : `${baseUrl}/api/transcriptions`;

      const result = await requestJson<TranscriptionListResponse>(fetchImpl, url, {
        method: 'GET',
      });

      return {
        ...result,
        items: result.items.map((item) => normalizeTranscription(baseUrl, item)),
      };
    },

    async getTranscription(id) {
      const result = await requestJson<Transcription>(
        fetchImpl,
        `${baseUrl}/api/transcriptions/${encodeURIComponent(id)}`,
        { method: 'GET' }
      );
      return normalizeTranscription(baseUrl, result);
    },

    getAudioUrl(id) {
      return `${baseUrl}/api/audio/${encodeURIComponent(id)}`;
    },
  };
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const runtimeEnv = import.meta.env;
  const useMockFlag = options.useMockApi ?? String(runtimeEnv.VITE_USE_MOCK_API) === 'true';
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? runtimeEnv.VITE_API_BASE_URL ?? DEFAULT_BASE_URL
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const storage = options.storage ?? localStorage;

  if (useMockFlag) {
    return createMockClient(storage);
  }
  return createHttpClient(baseUrl, fetchImpl);
}

const api = createApiClient();

export default api;
