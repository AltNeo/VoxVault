import { contextBridge, ipcRenderer } from "electron";

type AudioSource = {
  id: string;
  name: string;
  thumbnail: string;
};

const GET_AUDIO_SOURCES_CHANNEL = "get-audio-sources";

contextBridge.exposeInMainWorld('electronAPI', {
  getAudioSources: async (): Promise<AudioSource[]> => {
    return ipcRenderer.invoke(GET_AUDIO_SOURCES_CHANNEL);
  }
});
