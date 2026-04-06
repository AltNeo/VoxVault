import { useCallback, useState } from 'react';
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
  isLoading: boolean;
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
  clearActive: () => void;
}

function mergeHistory(
  items: TranscriptionSummary[],
  item: TranscriptionSummary
): TranscriptionSummary[] {
  const without = items.filter((current) => current.id !== item.id);
  return [item, ...without];
}

export function useTranscription(): UseTranscriptionResult {
  const [history, setHistory] = useState<TranscriptionSummary[]>([]);
  const [activeTranscription, setActiveTranscription] = useState<Transcription | null>(null);
  const [transcriptionPrompt, setTranscriptionPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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
      const result = await api.listTranscriptions(input);
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
      setIsLoading(true);
      setError(null);

      try {
        const transcription = await api.uploadAudio({
          file,
          source,
          language: 'en',
          customPrompt,
        });

        setActiveTranscription(transcription);
        setHistory((current) => mergeHistory(current, transcription));
        return transcription;
      } catch (uploadError) {
        const message =
          uploadError instanceof Error ? uploadError.message : 'Failed to transcribe audio.';
        setError(message);
        throw uploadError;
      } finally {
        setIsLoading(false);
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
      const { chunks: _chunks, ...summary } = refreshed;
      setActiveTranscription(refreshed);
      setHistory((current) => mergeHistory(current, summary));
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
    setIsLoading(true);
    setError(null);

    try {
      const transcription = await api.getTranscription(id);
      setActiveTranscription(transcription);
      setHistory((current) => mergeHistory(current, transcription));
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Failed to load transcription details.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveTranscriptionEdits = useCallback(async (id: string, title: string, text: string) => {
    setIsSavingEdits(true);
    setError(null);

    try {
      const transcription = await api.updateTranscription({ id, title, text });
      setActiveTranscription(transcription);
      setHistory((current) => mergeHistory(current, transcription));
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
    setActiveTranscription(null);
    setError(null);
  }, []);

  return {
    history,
    activeTranscription,
    transcriptionPrompt,
    isLoading,
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
    clearActive,
  };
}
