export type TranscriptionSource = 'recording' | 'upload';
export type TranscriptionStatus = 'completed' | 'failed';

export interface HealthResponse {
  status: 'ok';
  version: string;
}

export type ProviderHealthStatus =
  | 'ok'
  | 'not_configured'
  | 'auth_failed'
  | 'endpoint_not_found'
  | 'upstream_error';

export interface ProviderHealthResponse {
  status: ProviderHealthStatus;
  reachable: boolean;
  detail: string | null;
  upstream_status_code: number | null;
  endpoint: string | null;
}

export interface Chunk {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionSummary {
  id: string;
  title: string;
  filename: string;
  source: TranscriptionSource;
  language: string;
  duration_seconds: number | null;
  status: TranscriptionStatus;
  text: string;
  created_at: string;
  audio_url: string;
}

export interface Transcription extends TranscriptionSummary {
  chunks: Chunk[];
}

export interface TranscriptionListResponse {
  items: TranscriptionSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ErrorDetail {
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
}

export interface ErrorResponse {
  error: ErrorDetail;
  request_id: string;
}

export interface UploadAudioInput {
  file: File;
  source?: TranscriptionSource;
  language?: string;
  customPrompt?: string;
}

export interface UpdateTranscriptionInput {
  id: string;
  title?: string;
  text?: string;
}

export interface ListTranscriptionsInput {
  limit?: number;
  offset?: number;
}

export interface TranscriptionPromptResponse {
  custom_prompt: string;
}
