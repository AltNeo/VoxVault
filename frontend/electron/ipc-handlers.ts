import { desktopCapturer, ipcMain } from 'electron';

export type AudioSource = {
  id: string;
  name: string;
  thumbnail: string;
};

const GET_AUDIO_SOURCES_CHANNEL = 'get-audio-sources';

export function registerIpcHandlers(): void {
  ipcMain.removeHandler(GET_AUDIO_SOURCES_CHANNEL);

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
}
