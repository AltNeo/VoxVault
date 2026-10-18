import { useCallback, useRef, useState } from 'react';
import api from '../services/api';
import type {
  ListTranscriptionsInput,
  Transcription,
  TranscriptionSource,
  TranscriptionSummary,
} from '../types/api';

interface UseTranscriptionResult {
  history: TranscriptionSummary[];
  activeTranscription: Transcription | null;
  transcriptionPrompt: string;
  isUploading: boolean;
  isLoadingDetail: boolean;
  isRetrying: boolean;
  isHistoryLoading: boolean;
  isPromptLoading: boolean;
  isPromptSaving: boolean;
  isSummarizing: boolean;
  isSavingEdits: boolean;
  error: string | null;
  uploadAudio: (
    file: File,
    source: TranscriptionSource,
    customPrompt?: string
  ) => Promise<Transcription>;
  loadTranscriptionPrompt: () => Promise<void>;
  saveTranscriptionPrompt: (customPrompt: string) => Promise<void>;
  generateSummary: (id: string, customPrompt?: string) => Promise<void>;
  saveTranscriptionEdits: (id: string, title: string, text: string) => Promise<Transcription>;
  loadHistory: (input?: ListTranscriptionsInput) => Promise<void>;
  selectTranscription: (id: string) => Promise<void>;
  retryTranscription: (id: string) => Promise<void>;
  clearActive: () => void;
}

const HISTORY_PAGE_SIZE = 100;

function toSummary(item: TranscriptionSummary | Transcription): TranscriptionSummary {
  if (!('chunks' in item)) {
    return item;
  }
  const { chunks: _chunks, ...summary } = item;
  return summary;
}

// Replace an entry in place so the sidebar keeps its order; new entries go on top.
export function upsertHistory(
  items: TranscriptionSummary[],
  item: TranscriptionSummary | Transcription
): TranscriptionSummary[] {
  const summary = toSummary(item);
  const index = items.findIndex((current) => current.id === summary.id);
  if (index < 0) {
    return [summary, ...items];
  }
  const next = items.slice();
  next[index] = summary;
  return next;
}

export function useTranscription(): UseTranscriptionResult {
  const [history, setHistory] = useState<TranscriptionSummary[]>([]);
  const [activeTranscription, setActiveTranscription] = useState<Transcription | null>(null);
  const [transcriptionPrompt, setTranscriptionPrompt] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  // Bumped whenever the user picks a recording, so slower responses can't overwrite it.
  const selectionVersionRef = useRef(0);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isPromptLoading, setIsPromptLoading] = useState(false);
  const [isPromptSaving, setIsPromptSaving] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async (input?: ListTranscriptionsInput) => {
    setIsHistoryLoading(true);
    setError(null);

    try {
      const result = await api.listTranscriptions({ limit: HISTORY_PAGE_SIZE, ...input });
      setHistory(result.items);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Failed to load transcription history.';
      setError(message);
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  const uploadAudio = useCallback(
    async (file: File, source: TranscriptionSource, customPrompt?: string) => {
      const selectionAtStart = selectionVersionRef.current;
      setIsUploading(true);
      setError(null);

      try {
        const transcription = await api.uploadAudio({
          file,
          source,
          language: 'en',
          customPrompt,
        });

        setHistory((current) => upsertHistory(current, transcription));
        // Only jump to the new transcript if the user hasn't opened another one meanwhile.
        if (selectionVersionRef.current === selectionAtStart) {
          setActiveTranscription(transcription);
        }
        return transcription;
      } catch (uploadError) {
        const message =
          uploadError instanceof Error ? uploadError.message : 'Failed to transcribe audio.';
        setError(message);
        // A failed transcription is still saved with its audio, so refresh to show it.
        void api
          .listTranscriptions({ limit: HISTORY_PAGE_SIZE })
          .then((result) => setHistory(result.items))
          .catch(() => undefined);
        throw uploadError;
      } finally {
        setIsUploading(false);
      }
    },
    []
  );

  const loadTranscriptionPrompt = useCallback(async () => {
    setIsPromptLoading(true);
    setError(null);

    try {
      const result = await api.getTranscriptionPrompt();
      setTranscriptionPrompt(result.custom_prompt);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Failed to load transcription prompt.';
      setError(message);
    } finally {
      setIsPromptLoading(false);
    }
  }, []);

  const saveTranscriptionPrompt = useCallback(async (customPrompt: string) => {
    setIsPromptSaving(true);
    setError(null);

    try {
      const result = await api.updateTranscriptionPrompt(customPrompt);
      setTranscriptionPrompt(result.custom_prompt);
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : 'Failed to update transcription prompt.';
      setError(message);
      throw saveError;
    } finally {
      setIsPromptSaving(false);
    }
  }, []);

  const generateSummary = useCallback(async (id: string, customPrompt?: string) => {
    setIsSummarizing(true);
    setError(null);

    try {
      await api.summarizeTranscription(id, customPrompt);
      const refreshed = await api.getTranscription(id);
      setActiveTranscription((current) => (current?.id === id ? refreshed : current));
      setHistory((current) => upsertHistory(current, refreshed));
    } catch (summaryError) {
      const message =
        summaryError instanceof Error ? summaryError.message : 'Failed to generate summary.';
      setError(message);
      throw summaryError;
    } finally {
      setIsSummarizing(false);
    }
  }, []);

  const selectTranscription = useCallback(async (id: string) => {
    const version = ++selectionVersionRef.current;
    setIsLoadingDetail(true);
    setError(null);

    try {
      const transcription = await api.getTranscription(id);
      if (version !== selectionVersionRef.current) {
        return;
      }
      setActiveTranscription(transcription);
      setHistory((current) => upsertHistory(current, transcription));
    } catch (loadError) {
      if (version !== selectionVersionRef.current) {
        return;
      }
      const message =
        loadError instanceof Error ? loadError.message : 'Failed to load transcription details.';
      setError(message);
    } finally {
      if (version === selectionVersionRef.current) {
        setIsLoadingDetail(false);
      }
    }
  }, []);

  const retryTranscription = useCallback(async (id: string) => {
    setIsRetrying(true);
    setError(null);

    try {
      const transcription = await api.retryTranscription(id);
      setHistory((current) => upsertHistory(current, transcription));
      setActiveTranscription((current) => (current?.id === id ? transcription : current));
    } catch (retryError) {
      const message =
        retryError instanceof Error ? retryError.message : 'Failed to transcribe this recording.';
      setError(message);
    } finally {
      setIsRetrying(false);
    }
  }, []);

  const saveTranscriptionEdits = useCallback(async (id: string, title: string, text: string) => {
    setIsSavingEdits(true);
    setError(null);

    try {
      const transcription = await api.updateTranscription({ id, title, text });
      setActiveTranscription((current) => (current?.id === id ? transcription : current));
      setHistory((current) => upsertHistory(current, transcription));
      return transcription;
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : 'Failed to save transcription edits.';
      setError(message);
      throw saveError;
    } finally {
      setIsSavingEdits(false);
    }
  }, []);

  const clearActive = useCallback(() => {
    selectionVersionRef.current += 1;
    setActiveTranscription(null);
    setError(null);
  }, []);

  return {
    history,
    activeTranscription,
    transcriptionPrompt,
    isUploading,
    isLoadingDetail,
    isRetrying,
    isHistoryLoading,
    isPromptLoading,
    isPromptSaving,
    isSummarizing,
    isSavingEdits,
    error,
    uploadAudio,
    loadTranscriptionPrompt,
    saveTranscriptionPrompt,
    generateSummary,
    saveTranscriptionEdits,
    loadHistory,
    selectTranscription,
    retryTranscription,
    clearActive,
  };
}
