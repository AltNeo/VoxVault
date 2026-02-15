import { useCallback, useMemo } from 'react';

export type SystemAudioBackend = 'electron' | 'browser' | 'unsupported';

interface UseSystemAudioResult {
  supportsSystemAudio: boolean;
  systemAudioBackend: SystemAudioBackend;
  getSystemAudioStream: () => Promise<MediaStream>;
}

const isElectronAudioApiAvailable = (): boolean => {
  return typeof window !== 'undefined' && typeof window.electronAPI?.getAudioSources === 'function';
};

const isBrowserDisplayCaptureAvailable = (): boolean => {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
};

const isUserMediaAvailable = (): boolean => {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
};

type DesktopCaptureMandatoryConstraints = {
  chromeMediaSource: 'desktop';
  chromeMediaSourceId: string;
};

type DesktopCaptureTrackConstraints = MediaTrackConstraints & {
  mandatory: DesktopCaptureMandatoryConstraints;
};

function getPreferredElectronAudioSource(
  sources: ElectronAudioSource[]
): ElectronAudioSource | null {
  if (sources.length === 0) {
    return null;
  }

  const screenSource = sources.find((source) => source.id.startsWith('screen:'));
  return screenSource ?? sources[0];
}

async function getElectronSystemAudioStream(): Promise<MediaStream> {
  if (!isElectronAudioApiAvailable()) {
    throw new Error('Electron audio API is unavailable.');
  }
  const electronAPI = window.electronAPI;

  if (!isUserMediaAvailable()) {
    throw new Error('Media device capture is not available in this environment.');
  }

  if (!electronAPI) {
    throw new Error('Electron audio API is unavailable.');
  }

  const sources = await electronAPI.getAudioSources();
  const source = getPreferredElectronAudioSource(sources);

  if (!source) {
    throw new Error('No desktop audio sources were returned by Electron.');
  }

  const desktopTrackConstraints: DesktopCaptureTrackConstraints = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: source.id,
    },
  };

  return navigator.mediaDevices.getUserMedia({
    audio: desktopTrackConstraints,
    video: desktopTrackConstraints,
  });
}

async function getBrowserSystemAudioStream(): Promise<MediaStream> {
  if (!isBrowserDisplayCaptureAvailable()) {
    throw new Error('System audio capture is not supported in this browser.');
  }

  return navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true,
  });
}

export function useSystemAudio(): UseSystemAudioResult {
  const systemAudioBackend = useMemo<SystemAudioBackend>(() => {
    if (isElectronAudioApiAvailable()) {
      return 'electron';
    }

    if (isBrowserDisplayCaptureAvailable()) {
      return 'browser';
    }

    return 'unsupported';
  }, []);

  const supportsSystemAudio = systemAudioBackend !== 'unsupported';

  const getSystemAudioStream = useCallback(async (): Promise<MediaStream> => {
    if (systemAudioBackend === 'electron') {
      return getElectronSystemAudioStream();
    }

    if (systemAudioBackend === 'browser') {
      return getBrowserSystemAudioStream();
    }

    throw new Error('System audio capture is unsupported in this environment.');
  }, [systemAudioBackend]);

  return {
    supportsSystemAudio,
    systemAudioBackend,
    getSystemAudioStream,
  };
}
