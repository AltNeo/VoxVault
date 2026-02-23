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

interface ElectronAPI {
  getAudioSources: () => Promise<ElectronAudioSource[]>;
  getBackendStatus: () => Promise<ElectronBackendStatus>;
  restartBackend: () => Promise<ElectronBackendStatus>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
