import { contextBridge, ipcRenderer } from "electron";

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

const GET_AUDIO_SOURCES_CHANNEL = "get-audio-sources";
const GET_BACKEND_STATUS_CHANNEL = "get-backend-status";
const RESTART_BACKEND_CHANNEL = "restart-backend";

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
});
