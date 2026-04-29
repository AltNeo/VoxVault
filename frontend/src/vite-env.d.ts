/// <reference types="vite/client" />

type ElectronAudioSource = {
  id: string;
  name: string;
  thumbnail: string;
};
type ElectronBackendState = 'stopped' | 'starting' | 'running';
type ElectronBackendStatus = {
  state: ElectronBackendState;
  pid: number | null;
  startedAt: string | null;
  lastError: string | null;
};
type ElectronTeamsCallMonitorStatus = {
  supported: boolean;
  callDetected: boolean;
  matchedWindowTitle: string | null;
  updatedAt: string | null;
};
type ElectronRecorderRuntimeStatus = {
  recording: boolean;
  startedAt: string | null;
  baseName: string | null;
  trigger: 'manual' | 'auto' | null;
  updatedAt: string | null;
};
type ElectronAutoRecordPromptState = {
  visible: boolean;
  title: string | null;
  updatedAt: string | null;
};
type ElectronAutoRecordPromptAction = 'confirm' | 'dismiss';
type ElectronAutoRecordPromptRequestResult = {
  status: 'shown' | 'ignored' | 'already-open';
};

interface ElectronAPI {
  getAudioSources: () => Promise<ElectronAudioSource[]>;
  getBackendStatus: () => Promise<ElectronBackendStatus>;
  restartBackend: () => Promise<ElectronBackendStatus>;
  getTeamsCallMonitorStatus: () => Promise<ElectronTeamsCallMonitorStatus>;
  setTeamsCallMonitorEnabled: (enabled: boolean) => Promise<void>;
  getTeamsIgnoreList: () => Promise<string[]>;
  addToTeamsIgnoreList: (title: string) => Promise<string[]>;
  getAutoRecordPromptState: () => Promise<ElectronAutoRecordPromptState>;
  requestAutoRecordPrompt: (title: string) => Promise<ElectronAutoRecordPromptRequestResult>;
  respondToAutoRecordPrompt: (action: ElectronAutoRecordPromptAction) => Promise<void>;
  onAutoRecordPromptStateChanged: (
    listener: (state: ElectronAutoRecordPromptState) => void
  ) => () => void;
  onAutoRecordPromptAction: (
    listener: (payload: { action: ElectronAutoRecordPromptAction; title: string }) => void
  ) => () => void;
  onTeamsCallMonitorStatusChanged: (
    listener: (status: ElectronTeamsCallMonitorStatus) => void
  ) => () => void;
  getRecorderRuntimeStatus: () => Promise<ElectronRecorderRuntimeStatus>;
  setRecorderRuntimeStatus: (
    status: Omit<ElectronRecorderRuntimeStatus, 'updatedAt'>
  ) => Promise<ElectronRecorderRuntimeStatus>;
  onRecorderRuntimeStatusChanged: (
    listener: (status: ElectronRecorderRuntimeStatus) => void
  ) => () => void;
  convertAudioToMp3: (audioBytes: Uint8Array, mimeType: string) => Promise<Uint8Array>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
