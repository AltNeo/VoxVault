import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type RecordingStatus = 'idle' | 'recording' | 'stopped';

interface UseAudioRecorderResult {
  status: RecordingStatus;
  audioBlob: Blob | null;
  audioUrl: string | null;
  durationSeconds: number;
  isSupported: boolean;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  resetRecording: () => void;
}

export function useAudioRecorder(): UseAudioRecorderResult {
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const isSupported = useMemo(() => {
    return typeof window !== 'undefined' && 'MediaRecorder' in window;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const resetRecording = useCallback(() => {
    setStatus('idle');
    setAudioBlob(null);
    setDurationSeconds(0);
    setError(null);
    clearTimer();
    stopStream();

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
  }, [audioUrl, clearTimer, stopStream]);

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      setError('Recording is not supported in this browser.');
      return;
    }

    if (status === 'recording') {
      return;
    }

    try {
      setError(null);
      setDurationSeconds(0);
      chunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setAudioBlob(blob);

        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
        }
        setAudioUrl(URL.createObjectURL(blob));
        setStatus('stopped');
        clearTimer();
        stopStream();
      });

      recorder.start(250);
      setStatus('recording');
      timerRef.current = window.setInterval(() => {
        setDurationSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      setError('Microphone permission denied or unavailable.');
      setStatus('idle');
      clearTimer();
      stopStream();
    }
  }, [audioUrl, clearTimer, isSupported, status, stopStream]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
      stopStream();
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl, clearTimer, stopStream]);

  return {
    status,
    audioBlob,
    audioUrl,
    durationSeconds,
    isSupported,
    error,
    startRecording,
    stopRecording,
    resetRecording,
  };
}
