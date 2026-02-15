/// <reference types="vite/client" />

type ElectronAudioSource = {
  id: string;
  name: string;
  thumbnail: string;
};

interface ElectronAPI {
  getAudioSources: () => Promise<ElectronAudioSource[]>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
