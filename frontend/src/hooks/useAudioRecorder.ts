import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSystemAudio } from './useSystemAudio';

export type RecordingStatus = 'idle' | 'recording' | 'stopped';
export type CaptureMode = 'microphone' | 'microphone_system';

interface UseAudioRecorderResult {
  status: RecordingStatus;
  captureMode: CaptureMode;
  audioBlob: Blob | null;
  audioUrl: string | null;
  durationSeconds: number;
  isSupported: boolean;
  supportsSystemAudio: boolean;
  systemAudioBackend: 'electron' | 'browser' | 'unsupported';
  error: string | null;
  setCaptureMode: (mode: CaptureMode) => void;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  resetRecording: () => void;
}

export function useAudioRecorder(): UseAudioRecorderResult {
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [captureMode, setCaptureMode] = useState<CaptureMode>('microphone_system');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const mixedStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const { supportsSystemAudio, systemAudioBackend, getSystemAudioStream } = useSystemAudio();

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
    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach((track) => track.stop());
      systemStreamRef.current = null;
    }
    if (mixedStreamRef.current) {
      mixedStreamRef.current.getTracks().forEach((track) => track.stop());
      mixedStreamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
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

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;

      let recordingStream = micStream;
      if (captureMode === 'microphone_system') {
        if (!supportsSystemAudio) {
          throw new Error('System audio capture is not supported in this environment.');
        }

        const systemAudioStream = await getSystemAudioStream();
        systemStreamRef.current = systemAudioStream;

        const systemAudioTracks = systemAudioStream.getAudioTracks();
        systemAudioStream.getVideoTracks().forEach((track) => track.stop());
        if (systemAudioTracks.length === 0) {
          throw new Error('No system audio track found for selected source.');
        }

        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const destination = audioContext.createMediaStreamDestination();

        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(destination);

        const systemAudioOnlyStream = new MediaStream(systemAudioTracks);
        const systemSource = audioContext.createMediaStreamSource(systemAudioOnlyStream);
        systemSource.connect(destination);

        const mixedStream = destination.stream;
        mixedStreamRef.current = mixedStream;
        recordingStream = mixedStream;
      }

      recordingStreamRef.current = recordingStream;

      const recorder = new MediaRecorder(recordingStream);
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
    } catch (startError) {
      const message =
        startError instanceof Error && startError.message
          ? startError.message
          : captureMode === 'microphone_system'
            ? systemAudioBackend === 'electron'
              ? 'Could not access microphone + system audio from Electron. Check app permissions.'
              : 'Could not access microphone + system audio. Allow mic and screen-share audio.'
            : 'Microphone permission denied or unavailable.';
      setError(message);
      setStatus('idle');
      clearTimer();
      stopStream();
    }
  }, [
    audioUrl,
    captureMode,
    clearTimer,
    getSystemAudioStream,
    isSupported,
    status,
    stopStream,
    supportsSystemAudio,
    systemAudioBackend,
  ]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  useEffect(() => {
    if (!supportsSystemAudio && captureMode === 'microphone_system') {
      setCaptureMode('microphone');
    }
  }, [captureMode, supportsSystemAudio]);

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
    captureMode,
    audioBlob,
    audioUrl,
    durationSeconds,
    isSupported,
    supportsSystemAudio,
    systemAudioBackend,
    error,
    setCaptureMode,
    startRecording,
    stopRecording,
    resetRecording,
  };
}
