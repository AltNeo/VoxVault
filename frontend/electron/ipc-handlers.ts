import { desktopCapturer, ipcMain } from 'electron';
import { convertAudioToMp3 } from './audio-conversion.js';
import type { BackendStatus } from './backend-process.js';
import type { TeamsCallMonitorStatus } from './teams-call-monitor.js';

export type RecorderRuntimeStatus = {
  recording: boolean;
  startedAt: string | null;
  baseName: string | null;
  trigger: 'manual' | 'auto' | null;
  updatedAt: string | null;
};

export type AutoRecordPromptState = {
  visible: boolean;
  title: string | null;
  updatedAt: string | null;
};

export type AutoRecordPromptRequestResult = {
  status: 'shown' | 'ignored' | 'already-open';
};

export type AutoRecordPromptAction = 'confirm' | 'dismiss';

export type AudioSource = {
  id: string;
  name: string;
  thumbnail: string;
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
const GET_RECORDER_RUNTIME_STATUS_CHANNEL = 'get-recorder-runtime-status';
const SET_RECORDER_RUNTIME_STATUS_CHANNEL = 'set-recorder-runtime-status';

type RegisterIpcHandlersOptions = {
  getBackendStatus: () => BackendStatus;
  restartBackend: () => Promise<BackendStatus>;
  getTeamsCallMonitorStatus: () => TeamsCallMonitorStatus;
  setTeamsCallMonitorEnabled: (enabled: boolean) => void;
  getTeamsIgnoreList: () => string[];
  addToTeamsIgnoreList: (title: string) => string[];
  getAutoRecordPromptState: () => AutoRecordPromptState;
  requestAutoRecordPrompt: (title: string) => Promise<AutoRecordPromptRequestResult>;
  respondToAutoRecordPrompt: (action: AutoRecordPromptAction) => Promise<void>;
  getRecorderRuntimeStatus: () => RecorderRuntimeStatus;
  setRecorderRuntimeStatus: (
    status: Omit<RecorderRuntimeStatus, 'updatedAt'>
  ) => Promise<RecorderRuntimeStatus> | RecorderRuntimeStatus;
};

export function registerIpcHandlers(options: RegisterIpcHandlersOptions): void {
  ipcMain.removeHandler(GET_AUDIO_SOURCES_CHANNEL);
  ipcMain.removeHandler(GET_BACKEND_STATUS_CHANNEL);
  ipcMain.removeHandler(RESTART_BACKEND_CHANNEL);
  ipcMain.removeHandler(CONVERT_AUDIO_TO_MP3_CHANNEL);
  ipcMain.removeHandler(GET_TEAMS_CALL_MONITOR_STATUS_CHANNEL);
  ipcMain.removeHandler(SET_TEAMS_CALL_MONITOR_ENABLED_CHANNEL);
  ipcMain.removeHandler(GET_TEAMS_IGNORE_LIST_CHANNEL);
  ipcMain.removeHandler(ADD_TO_TEAMS_IGNORE_LIST_CHANNEL);
  ipcMain.removeHandler(GET_AUTO_RECORD_PROMPT_STATE_CHANNEL);
  ipcMain.removeHandler(REQUEST_AUTO_RECORD_PROMPT_CHANNEL);
  ipcMain.removeHandler(RESPOND_TO_AUTO_RECORD_PROMPT_CHANNEL);
  ipcMain.removeHandler(GET_RECORDER_RUNTIME_STATUS_CHANNEL);
  ipcMain.removeHandler(SET_RECORDER_RUNTIME_STATUS_CHANNEL);

  ipcMain.handle(GET_AUDIO_SOURCES_CHANNEL, async (): Promise<AudioSource[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      fetchWindowIcons: true,
    });

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
    }));
  });

  ipcMain.handle(GET_BACKEND_STATUS_CHANNEL, async (): Promise<BackendStatus> => {
    return options.getBackendStatus();
  });

  ipcMain.handle(RESTART_BACKEND_CHANNEL, async (): Promise<BackendStatus> => {
    return options.restartBackend();
  });

  ipcMain.handle(
    GET_TEAMS_CALL_MONITOR_STATUS_CHANNEL,
    async (): Promise<TeamsCallMonitorStatus> => {
      return options.getTeamsCallMonitorStatus();
    }
  );

  ipcMain.handle(
    SET_TEAMS_CALL_MONITOR_ENABLED_CHANNEL,
    async (_event, enabled: boolean): Promise<void> => {
      options.setTeamsCallMonitorEnabled(enabled);
    }
  );

  ipcMain.handle(GET_TEAMS_IGNORE_LIST_CHANNEL, async (): Promise<string[]> => {
    return options.getTeamsIgnoreList();
  });

  ipcMain.handle(
    ADD_TO_TEAMS_IGNORE_LIST_CHANNEL,
    async (_event, title: string): Promise<string[]> => {
      return options.addToTeamsIgnoreList(title);
    }
  );

  ipcMain.handle(GET_AUTO_RECORD_PROMPT_STATE_CHANNEL, async (): Promise<AutoRecordPromptState> => {
    return options.getAutoRecordPromptState();
  });

  ipcMain.handle(
    REQUEST_AUTO_RECORD_PROMPT_CHANNEL,
    async (_event, title: string): Promise<AutoRecordPromptRequestResult> => {
      return options.requestAutoRecordPrompt(title);
    }
  );

  ipcMain.handle(
    RESPOND_TO_AUTO_RECORD_PROMPT_CHANNEL,
    async (_event, action: AutoRecordPromptAction): Promise<void> => {
      await options.respondToAutoRecordPrompt(action);
    }
  );

  ipcMain.handle(GET_RECORDER_RUNTIME_STATUS_CHANNEL, async (): Promise<RecorderRuntimeStatus> => {
    return options.getRecorderRuntimeStatus();
  });

  ipcMain.handle(
    SET_RECORDER_RUNTIME_STATUS_CHANNEL,
    async (
      _event,
      status: Omit<RecorderRuntimeStatus, 'updatedAt'>
    ): Promise<RecorderRuntimeStatus> => {
      return options.setRecorderRuntimeStatus(status);
    }
  );

  ipcMain.handle(
    CONVERT_AUDIO_TO_MP3_CHANNEL,
    async (_event, audioBytes: Uint8Array | ArrayBuffer, mimeType: string): Promise<Uint8Array> => {
      return convertAudioToMp3(audioBytes, mimeType);
    }
  );
}

export {
  AUTO_RECORD_PROMPT_ACTION_CHANNEL,
  AUTO_RECORD_PROMPT_STATE_CHANGED_CHANNEL,
};
