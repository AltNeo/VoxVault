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
type AutoRecordPromptState = {
  visible: boolean;
  title: string | null;
  updatedAt: string | null;
};
type AutoRecordPromptAction = 'confirm' | 'dismiss';
type AutoRecordPromptRequestResult = {
  status: 'shown' | 'ignored' | 'already-open';
};

const GET_AUDIO_SOURCES_CHANNEL = 'get-audio-sources';
const GET_BACKEND_STATUS_CHANNEL = 'get-backend-status';
const RESTART_BACKEND_CHANNEL = 'restart-backend';
const CONVERT_AUDIO_TO_MP3_CHANNEL = 'convert-audio-to-mp3';
const GET_TEAMS_CALL_MONITOR_STATUS_CHANNEL = 'get-teams-call-monitor-status';
const SET_TEAMS_CALL_MONITOR_ENABLED_CHANNEL = 'set-teams-call-monitor-enabled';
const GET_TEAMS_IGNORE_LIST_CHANNEL = 'get-teams-ignore-list';
const ADD_TO_TEAMS_IGNORE_LIST_CHANNEL = 'add-to-teams-ignore-list';
const GET_AUTO_RECORD_PROMPT_STATE_CHANNEL = 'get-auto-record-prompt-state';
const REQUEST_AUTO_RECORD_PROMPT_CHANNEL = 'request-auto-record-prompt';
const RESPOND_TO_AUTO_RECORD_PROMPT_CHANNEL = 'respond-to-auto-record-prompt';
const AUTO_RECORD_PROMPT_STATE_CHANGED_CHANNEL = 'auto-record-prompt-state-changed';
const AUTO_RECORD_PROMPT_ACTION_CHANNEL = 'auto-record-prompt-action';
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
  setTeamsCallMonitorEnabled: async (enabled: boolean): Promise<void> => {
    return ipcRenderer.invoke(SET_TEAMS_CALL_MONITOR_ENABLED_CHANNEL, enabled);
  },
  getTeamsIgnoreList: async (): Promise<string[]> => {
    return ipcRenderer.invoke(GET_TEAMS_IGNORE_LIST_CHANNEL);
  },
  addToTeamsIgnoreList: async (title: string): Promise<string[]> => {
    return ipcRenderer.invoke(ADD_TO_TEAMS_IGNORE_LIST_CHANNEL, title);
  },
  getAutoRecordPromptState: async (): Promise<AutoRecordPromptState> => {
    return ipcRenderer.invoke(GET_AUTO_RECORD_PROMPT_STATE_CHANNEL);
  },
  requestAutoRecordPrompt: async (title: string): Promise<AutoRecordPromptRequestResult> => {
    return ipcRenderer.invoke(REQUEST_AUTO_RECORD_PROMPT_CHANNEL, title);
  },
  respondToAutoRecordPrompt: async (action: AutoRecordPromptAction): Promise<void> => {
    return ipcRenderer.invoke(RESPOND_TO_AUTO_RECORD_PROMPT_CHANNEL, action);
  },
  onAutoRecordPromptStateChanged: (listener: (state: AutoRecordPromptState) => void): (() => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: AutoRecordPromptState) => {
      listener(state);
    };

    ipcRenderer.on(AUTO_RECORD_PROMPT_STATE_CHANGED_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(AUTO_RECORD_PROMPT_STATE_CHANGED_CHANNEL, wrappedListener);
    };
  },
  onAutoRecordPromptAction: (
    listener: (payload: { action: AutoRecordPromptAction; title: string }) => void
  ): (() => void) => {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      payload: { action: AutoRecordPromptAction; title: string }
    ) => {
      listener(payload);
    };

    ipcRenderer.on(AUTO_RECORD_PROMPT_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(AUTO_RECORD_PROMPT_ACTION_CHANNEL, wrappedListener);
    };
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
