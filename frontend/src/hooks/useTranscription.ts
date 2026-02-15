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
  isLoading: boolean;
  isHistoryLoading: boolean;
  isSavingEdits: boolean;
  error: string | null;
  uploadAudio: (file: File, source: TranscriptionSource) => Promise<Transcription>;
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
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
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

  const uploadAudio = useCallback(async (file: File, source: TranscriptionSource) => {
    setIsLoading(true);
    setError(null);

    try {
      const transcription = await api.uploadAudio({
        file,
        source,
        language: 'en',
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
    isLoading,
    isHistoryLoading,
    isSavingEdits,
    error,
    uploadAudio,
    saveTranscriptionEdits,
    loadHistory,
    selectTranscription,
    clearActive,
  };
}
