import { desktopCapturer, ipcMain } from 'electron';
import type { BackendStatus } from './backend-process.js';

export type AudioSource = {
  id: string;
  name: string;
  thumbnail: string;
};

const GET_AUDIO_SOURCES_CHANNEL = 'get-audio-sources';
const GET_BACKEND_STATUS_CHANNEL = 'get-backend-status';
const RESTART_BACKEND_CHANNEL = 'restart-backend';

type RegisterIpcHandlersOptions = {
  getBackendStatus: () => BackendStatus;
  restartBackend: () => Promise<BackendStatus>;
};

export function registerIpcHandlers(options: RegisterIpcHandlersOptions): void {
  ipcMain.removeHandler(GET_AUDIO_SOURCES_CHANNEL);
  ipcMain.removeHandler(GET_BACKEND_STATUS_CHANNEL);
  ipcMain.removeHandler(RESTART_BACKEND_CHANNEL);

  ipcMain.handle(GET_AUDIO_SOURCES_CHANNEL, async (): Promise<AudioSource[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      fetchWindowIcons: true
    });

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }));
  });

  ipcMain.handle(GET_BACKEND_STATUS_CHANNEL, async (): Promise<BackendStatus> => {
    return options.getBackendStatus();
  });

  ipcMain.handle(RESTART_BACKEND_CHANNEL, async (): Promise<BackendStatus> => {
    return options.restartBackend();
  });
}
