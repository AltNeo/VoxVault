import { contextBridge, ipcRenderer } from 'electron';

type AudioSource = {
  id: string;
  name: string;
  thumbnail: string;
};
type BackendState = 'stopped' | 'starting' | 'running';
type BackendStatus = {
  state: BackendState;
  pid: number | null;
  startedAt: string | null;
  lastError: string | null;
};
type TeamsCallMonitorStatus = {
  supported: boolean;
  callDetected: boolean;
  matchedWindowTitle: string | null;
  updatedAt: string | null;
};
type RecorderRuntimeStatus = {
  recording: boolean;
  startedAt: string | null;
  baseName: string | null;
  trigger: 'manual' | 'auto' | null;
  updatedAt: string | null;
};

const GET_AUDIO_SOURCES_CHANNEL = 'get-audio-sources';
const GET_BACKEND_STATUS_CHANNEL = 'get-backend-status';
const RESTART_BACKEND_CHANNEL = 'restart-backend';
const CONVERT_AUDIO_TO_MP3_CHANNEL = 'convert-audio-to-mp3';
const GET_TEAMS_CALL_MONITOR_STATUS_CHANNEL = 'get-teams-call-monitor-status';
const TEAMS_CALL_MONITOR_STATUS_CHANGED_CHANNEL = 'teams-call-monitor-status-changed';
const GET_RECORDER_RUNTIME_STATUS_CHANNEL = 'get-recorder-runtime-status';
const SET_RECORDER_RUNTIME_STATUS_CHANNEL = 'set-recorder-runtime-status';
const RECORDER_RUNTIME_STATUS_CHANGED_CHANNEL = 'recorder-runtime-status-changed';

contextBridge.exposeInMainWorld('electronAPI', {
  getAudioSources: async (): Promise<AudioSource[]> => {
    return ipcRenderer.invoke(GET_AUDIO_SOURCES_CHANNEL);
  },
  getBackendStatus: async (): Promise<BackendStatus> => {
    return ipcRenderer.invoke(GET_BACKEND_STATUS_CHANNEL);
  },
  restartBackend: async (): Promise<BackendStatus> => {
    return ipcRenderer.invoke(RESTART_BACKEND_CHANNEL);
  },
  getTeamsCallMonitorStatus: async (): Promise<TeamsCallMonitorStatus> => {
    return ipcRenderer.invoke(GET_TEAMS_CALL_MONITOR_STATUS_CHANNEL);
  },
  onTeamsCallMonitorStatusChanged: (
    listener: (status: TeamsCallMonitorStatus) => void
  ): (() => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, status: TeamsCallMonitorStatus) => {
      listener(status);
    };

    ipcRenderer.on(TEAMS_CALL_MONITOR_STATUS_CHANGED_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(TEAMS_CALL_MONITOR_STATUS_CHANGED_CHANNEL, wrappedListener);
    };
  },
  getRecorderRuntimeStatus: async (): Promise<RecorderRuntimeStatus> => {
    return ipcRenderer.invoke(GET_RECORDER_RUNTIME_STATUS_CHANNEL);
  },
  setRecorderRuntimeStatus: async (
    status: Omit<RecorderRuntimeStatus, 'updatedAt'>
  ): Promise<RecorderRuntimeStatus> => {
    return ipcRenderer.invoke(SET_RECORDER_RUNTIME_STATUS_CHANNEL, status);
  },
  onRecorderRuntimeStatusChanged: (
    listener: (status: RecorderRuntimeStatus) => void
  ): (() => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, status: RecorderRuntimeStatus) => {
      listener(status);
    };

    ipcRenderer.on(RECORDER_RUNTIME_STATUS_CHANGED_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(RECORDER_RUNTIME_STATUS_CHANGED_CHANNEL, wrappedListener);
    };
  },
  convertAudioToMp3: async (audioBytes: Uint8Array, mimeType: string): Promise<Uint8Array> => {
    return ipcRenderer.invoke(CONVERT_AUDIO_TO_MP3_CHANNEL, audioBytes, mimeType);
  },
});
