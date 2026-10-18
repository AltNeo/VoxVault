import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSystemAudio } from './useSystemAudio';
import { useTeamsCallMonitor } from './useTeamsCallMonitor';
import { deriveRecordingBaseName } from '../services/recording-name';

export type RecordingStatus = 'idle' | 'recording' | 'stopped';
export type CaptureMode = 'microphone' | 'microphone_system';
export type RecordingTrigger = 'manual' | 'auto';
type StartRecordingRequest = {
  trigger: RecordingTrigger;
  windowTitle: string | null;
};

export function didTeamsCallSwitch(
  previousDetected: boolean,
  currentDetected: boolean,
  previousSessionStartedAt: string | null,
  currentSessionStartedAt: string | null
): boolean {
  return (
    previousDetected &&
    currentDetected &&
    previousSessionStartedAt !== null &&
    currentSessionStartedAt !== null &&
    previousSessionStartedAt !== currentSessionStartedAt
  );
}

export function isTeamsSessionSuppressed(
  suppressedSessionStartedAt: string | null,
  currentSessionStartedAt: string | null
): boolean {
  return (
    suppressedSessionStartedAt !== null &&
    currentSessionStartedAt !== null &&
    suppressedSessionStartedAt === currentSessionStartedAt
  );
}

const RECORDER_MIME_CANDIDATES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/webm;codecs=opus',
  'audio/webm',
] as const;
const DEFAULT_AUDIO_MIME = 'audio/webm';
const AUTO_TEAMS_RECORD_STORAGE_KEY = 'voxvault.autoTeamsRecordEnabled';
const AUTO_STOP_CONFIRM_THRESHOLD_MS = 20 * 60 * 1000;

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
  startRecording: (
    trigger?: RecordingTrigger,
    requestedWindowTitle?: string | null
  ) => Promise<void>;
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
      return true;
    }

    const stored = window.localStorage.getItem(AUTO_TEAMS_RECORD_STORAGE_KEY);
    return stored === null ? true : stored === 'true';
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
  const { supported, callDetected, matchedWindowTitle, sessionStartedAt } = useTeamsCallMonitor();
  const autoRecordingRef = useRef(false);
  const recordingWindowTitleRef = useRef<string | null>(null);
  const recordingStartedAtRef = useRef<string | null>(null);
  const recordingTriggerRef = useRef<RecordingTrigger | null>(null);
  const previousTeamsCallDetectedRef = useRef(callDetected);
  const previousTeamsSessionStartedAtRef = useRef(sessionStartedAt);
  const previousAutoTeamsRecordEnabledRef = useRef(autoTeamsRecordEnabled);
  const requestedAutoRecordTitleRef = useRef<string | null>(null);
  const pendingStartRequestRef = useRef<StartRecordingRequest | null>(null);
  const stoppingForRestartRef = useRef(false);
  const suppressedTeamsSessionStartedAtRef = useRef<string | null>(null);

  const stopRecordingNow = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

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
    requestedAutoRecordTitleRef.current = null;
    pendingStartRequestRef.current = null;
    stoppingForRestartRef.current = false;
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

  const startRecording = useCallback(
    async (trigger: RecordingTrigger = 'manual', requestedWindowTitle: string | null = null) => {
      if (!isSupported) {
        setError('Recording is not supported in this browser.');
        return;
      }
      const activeRecorder = recorderRef.current;
      const hasActiveRecorder = activeRecorder !== null && activeRecorder.state !== 'inactive';
      if (status === 'recording' || hasActiveRecorder) {
        pendingStartRequestRef.current = {
          trigger,
          windowTitle: requestedWindowTitle ?? matchedWindowTitle ?? null,
        };
        if (hasActiveRecorder && !stoppingForRestartRef.current) {
          stoppingForRestartRef.current = true;
          activeRecorder.stop();
        }
        return;
      }

      try {
        autoRecordingRef.current = trigger === 'auto';
        const resolvedWindowTitle = requestedWindowTitle ?? matchedWindowTitle;
        recordingWindowTitleRef.current = resolvedWindowTitle;
        recordingStartedAtRef.current = new Date().toISOString();
        recordingTriggerRef.current = trigger;
        setRecordingBaseName(deriveRecordingBaseName(resolvedWindowTitle));
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
          stoppingForRestartRef.current = false;
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
        stoppingForRestartRef.current = false;
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
    },
    [
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
    ]
  );

  const stopRecording = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') {
      return;
    }

    stopRecordingNow();
  }, [stopRecordingNow]);

  const requestStopRecordingConfirmation = useCallback(async () => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') {
      return;
    }

    const promptResult = await window.electronAPI?.requestStopRecordPrompt?.().catch(() => null);
    if (!promptResult) {
      stopRecordingNow();
    }
  }, [stopRecordingNow]);

  const shouldConfirmAutoStop = useCallback(() => {
    if (!autoRecordingRef.current) {
      return false;
    }

    const startedAt = recordingStartedAtRef.current;
    if (!startedAt) {
      return true;
    }

    const startedAtMs = Date.parse(startedAt);
    if (Number.isNaN(startedAtMs)) {
      return true;
    }

    return Date.now() - startedAtMs < AUTO_STOP_CONFIRM_THRESHOLD_MS;
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
    if (!window.electronAPI?.setTeamsCallMonitorEnabled) {
      return;
    }

    void window.electronAPI
      .setTeamsCallMonitorEnabled(autoTeamsRecordEnabled)
      .catch(() => undefined);
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
    if (status !== 'stopped') {
      return;
    }

    const pendingRequest = pendingStartRequestRef.current;
    if (!pendingRequest) {
      return;
    }

    pendingStartRequestRef.current = null;
    void startRecording(pendingRequest.trigger, pendingRequest.windowTitle);
  }, [startRecording, status]);

  useEffect(() => {
    if (!window.electronAPI?.onAutoRecordPromptAction) {
      return;
    }

    return window.electronAPI.onAutoRecordPromptAction(({ action, title }) => {
      if (action === 'dismiss' || action === 'ignore') {
        if (status === 'recording') {
          return;
        }

        requestedAutoRecordTitleRef.current = title;
        return;
      }

      if (status === 'recording') {
        stopRecordingNow();
        return;
      }

      if (action === 'confirm') {
        void startRecording('auto', title);
      }
    });
  }, [startRecording, status, stopRecordingNow]);

  useEffect(() => {
    if (!window.electronAPI?.onRecorderCommand) {
      return;
    }

    return window.electronAPI.onRecorderCommand((command) => {
      if (command === 'stop') {
        if (status === 'recording' && autoRecordingRef.current) {
          suppressedTeamsSessionStartedAtRef.current = sessionStartedAt;
        }
        stopRecordingNow();
        return;
      }

      suppressedTeamsSessionStartedAtRef.current = null;
      if (status !== 'recording') {
        void startRecording(callDetected ? 'auto' : 'manual', matchedWindowTitle);
      }
    });
  }, [
    callDetected,
    matchedWindowTitle,
    sessionStartedAt,
    startRecording,
    status,
    stopRecordingNow,
  ]);

  useEffect(() => {
    const previousTeamsCallDetected = previousTeamsCallDetectedRef.current;
    const previousTeamsSessionStartedAt = previousTeamsSessionStartedAtRef.current;
    const previousAutoTeamsRecordEnabled = previousAutoTeamsRecordEnabledRef.current;

    previousTeamsCallDetectedRef.current = callDetected;
    previousTeamsSessionStartedAtRef.current = sessionStartedAt;
    previousAutoTeamsRecordEnabledRef.current = autoTeamsRecordEnabled;

    const canAutoRecord =
      autoTeamsRecordEnabled &&
      supported &&
      supportsSystemAudio &&
      captureMode === 'microphone_system';
    const currentSessionSuppressed = isTeamsSessionSuppressed(
      suppressedTeamsSessionStartedAtRef.current,
      sessionStartedAt
    );

    const callSwitched = didTeamsCallSwitch(
      previousTeamsCallDetected,
      callDetected,
      previousTeamsSessionStartedAt,
      sessionStartedAt
    );

    if (canAutoRecord && callSwitched && !currentSessionSuppressed) {
      const currentTitle = matchedWindowTitle?.trim() ?? '';
      if (!currentTitle) {
        return;
      }

      requestedAutoRecordTitleRef.current = currentTitle;
      if (status === 'recording' && autoRecordingRef.current) {
        void startRecording('auto', currentTitle);
      } else if (status !== 'recording') {
        void window.electronAPI?.requestAutoRecordPrompt?.(currentTitle).catch(() => {
          requestedAutoRecordTitleRef.current = null;
        });
      }
      return;
    }

    if (
      canAutoRecord &&
      callDetected &&
      !currentSessionSuppressed &&
      status !== 'recording' &&
      (!previousTeamsCallDetected || !previousAutoTeamsRecordEnabled)
    ) {
      const currentTitle = matchedWindowTitle?.trim() ?? '';
      if (!currentTitle) {
        return;
      }

      if (requestedAutoRecordTitleRef.current === currentTitle) {
        return;
      }

      requestedAutoRecordTitleRef.current = currentTitle;
      void window.electronAPI?.requestAutoRecordPrompt?.(currentTitle).catch(() => {
        requestedAutoRecordTitleRef.current = null;
      });
      return;
    }

    if (
      previousTeamsCallDetected &&
      !callDetected &&
      status === 'recording' &&
      autoRecordingRef.current
    ) {
      if (shouldConfirmAutoStop()) {
        void requestStopRecordingConfirmation();
      } else {
        stopRecordingNow();
      }
    }

    if (!callDetected) {
      requestedAutoRecordTitleRef.current = null;
      suppressedTeamsSessionStartedAtRef.current = null;
    }
  }, [
    autoTeamsRecordEnabled,
    callDetected,
    captureMode,
    matchedWindowTitle,
    status,
    requestStopRecordingConfirmation,
    shouldConfirmAutoStop,
    startRecording,
    stopRecording,
    stopRecordingNow,
    supported,
    supportsSystemAudio,
    sessionStartedAt,
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
