import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSystemAudio } from './useSystemAudio';
import { useTeamsCallMonitor } from './useTeamsCallMonitor';
import { deriveRecordingBaseName } from '../services/recording-name';

export type RecordingStatus = 'idle' | 'recording' | 'stopped';
export type CaptureMode = 'microphone' | 'microphone_system';
export type RecordingTrigger = 'manual' | 'auto';

const RECORDER_MIME_CANDIDATES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/webm;codecs=opus',
  'audio/webm',
] as const;
const DEFAULT_AUDIO_MIME = 'audio/webm';
const AUTO_TEAMS_RECORD_STORAGE_KEY = 'voxvault.autoTeamsRecordEnabled';

function pickRecorderMimeType(): string | undefined {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return undefined;
  }
  if (typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  return RECORDER_MIME_CANDIDATES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

interface UseAudioRecorderResult {
  status: RecordingStatus;
  captureMode: CaptureMode;
  audioBlob: Blob | null;
  audioUrl: string | null;
  durationSeconds: number;
  isSupported: boolean;
  supportsSystemAudio: boolean;
  systemAudioBackend: 'electron' | 'browser' | 'unsupported';
  autoTeamsRecordEnabled: boolean;
  teamsCallDetected: boolean;
  teamsCallMonitorSupported: boolean;
  teamsMatchedWindowTitle: string | null;
  recordingBaseName: string;
  activeRecordingTrigger: RecordingTrigger | null;
  error: string | null;
  setCaptureMode: (mode: CaptureMode) => void;
  setAutoTeamsRecordEnabled: (enabled: boolean) => void;
  startRecording: (trigger?: RecordingTrigger) => Promise<void>;
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
  const [recordingBaseName, setRecordingBaseName] = useState('recording');
  const [activeRecordingTrigger, setActiveRecordingTrigger] = useState<RecordingTrigger | null>(
    null
  );
  const [autoTeamsRecordEnabled, setAutoTeamsRecordEnabledState] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.localStorage.getItem(AUTO_TEAMS_RECORD_STORAGE_KEY) === 'true';
  });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const mixedStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const { supportsSystemAudio, systemAudioBackend, getSystemAudioStream } = useSystemAudio();
  const { supported, callDetected, matchedWindowTitle } = useTeamsCallMonitor();
  const autoRecordingRef = useRef(false);
  const recordingWindowTitleRef = useRef<string | null>(null);
  const recordingStartedAtRef = useRef<string | null>(null);
  const recordingTriggerRef = useRef<RecordingTrigger | null>(null);
  const previousTeamsCallDetectedRef = useRef(callDetected);
  const previousAutoTeamsRecordEnabledRef = useRef(autoTeamsRecordEnabled);

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
    autoRecordingRef.current = false;
    recordingWindowTitleRef.current = null;
    recordingStartedAtRef.current = null;
    recordingTriggerRef.current = null;
    setStatus('idle');
    setAudioBlob(null);
    setDurationSeconds(0);
    setError(null);
    setRecordingBaseName('recording');
    setActiveRecordingTrigger(null);
    clearTimer();
    stopStream();

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
  }, [audioUrl, clearTimer, stopStream]);

  const startRecording = useCallback(async (trigger: RecordingTrigger = 'manual') => {
    if (!isSupported) {
      setError('Recording is not supported in this browser.');
      return;
    }

    if (status === 'recording') {
      return;
    }

    try {
      autoRecordingRef.current = trigger === 'auto';
      recordingWindowTitleRef.current = matchedWindowTitle;
      recordingStartedAtRef.current = new Date().toISOString();
      recordingTriggerRef.current = trigger;
      setRecordingBaseName(deriveRecordingBaseName(matchedWindowTitle));
      setActiveRecordingTrigger(trigger);
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

      const recorderMimeType = pickRecorderMimeType();
      const recorder = recorderMimeType
        ? new MediaRecorder(recordingStream, { mimeType: recorderMimeType })
        : new MediaRecorder(recordingStream);
      recorderRef.current = recorder;

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        autoRecordingRef.current = false;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || recorderMimeType || DEFAULT_AUDIO_MIME,
        });
        setAudioBlob(blob);
        setRecordingBaseName(deriveRecordingBaseName(recordingWindowTitleRef.current));

        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
        }
        setAudioUrl(URL.createObjectURL(blob));
        setStatus('stopped');
        recordingStartedAtRef.current = null;
        recordingTriggerRef.current = null;
        setActiveRecordingTrigger(null);
        clearTimer();
        stopStream();
      });

      recorder.start();
      setStatus('recording');
      timerRef.current = window.setInterval(() => {
        setDurationSeconds((prev) => prev + 1);
      }, 1000);
    } catch (startError) {
      autoRecordingRef.current = false;
      recordingWindowTitleRef.current = null;
      recordingStartedAtRef.current = null;
      recordingTriggerRef.current = null;
      setRecordingBaseName('recording');
      setActiveRecordingTrigger(null);
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
    matchedWindowTitle,
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
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      AUTO_TEAMS_RECORD_STORAGE_KEY,
      autoTeamsRecordEnabled ? 'true' : 'false'
    );
  }, [autoTeamsRecordEnabled]);

  useEffect(() => {
    if (!window.electronAPI?.setRecorderRuntimeStatus) {
      return;
    }

    const payload = {
      recording: status === 'recording',
      startedAt: status === 'recording' ? recordingStartedAtRef.current : null,
      baseName: status === 'recording' ? recordingBaseName : null,
      trigger: status === 'recording' ? recordingTriggerRef.current : null,
    };

    void window.electronAPI.setRecorderRuntimeStatus(payload).catch(() => undefined);
  }, [recordingBaseName, status]);

  useEffect(() => {
    const previousTeamsCallDetected = previousTeamsCallDetectedRef.current;
    const previousAutoTeamsRecordEnabled = previousAutoTeamsRecordEnabledRef.current;

    previousTeamsCallDetectedRef.current = callDetected;
    previousAutoTeamsRecordEnabledRef.current = autoTeamsRecordEnabled;

    const canAutoRecord =
      autoTeamsRecordEnabled && supported && supportsSystemAudio && captureMode === 'microphone_system';

    if (
      canAutoRecord &&
      callDetected &&
      status !== 'recording' &&
      (!previousTeamsCallDetected || !previousAutoTeamsRecordEnabled)
    ) {
      void startRecording('auto');
      return;
    }

    if (previousTeamsCallDetected && !callDetected && status === 'recording' && autoRecordingRef.current) {
      stopRecording();
    }
  }, [
    autoTeamsRecordEnabled,
    callDetected,
    captureMode,
    startRecording,
    status,
    stopRecording,
    supported,
    supportsSystemAudio,
  ]);

  useEffect(() => {
    return () => {
      clearTimer();
      stopStream();
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl, clearTimer, stopStream]);

  const setAutoTeamsRecordEnabled = useCallback(
    (enabled: boolean) => {
      setAutoTeamsRecordEnabledState(enabled);
      if (enabled && supportsSystemAudio) {
        setCaptureMode('microphone_system');
      }
    },
    [supportsSystemAudio]
  );

  return {
    status,
    captureMode,
    audioBlob,
    audioUrl,
    durationSeconds,
    isSupported,
    supportsSystemAudio,
    systemAudioBackend,
    autoTeamsRecordEnabled,
    teamsCallDetected: callDetected,
    teamsCallMonitorSupported: supported,
    teamsMatchedWindowTitle: matchedWindowTitle,
    recordingBaseName,
    activeRecordingTrigger,
    error,
    setCaptureMode,
    setAutoTeamsRecordEnabled,
    startRecording,
    stopRecording,
    resetRecording,
  };
}
