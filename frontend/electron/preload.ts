import { contextBridge, ipcRenderer } from 'electron';
import type { AudioSource } from './ipc-handlers.js';

const GET_AUDIO_SOURCES_CHANNEL = 'get-audio-sources';

contextBridge.exposeInMainWorld('electronAPI', {
  getAudioSources: async (): Promise<AudioSource[]> => {
    return ipcRenderer.invoke(GET_AUDIO_SOURCES_CHANNEL);
  }
});
