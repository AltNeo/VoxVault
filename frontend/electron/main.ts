import { app, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTeamsCallMonitor } from './teams-call-monitor.js';
import { createTeamsIgnoreList } from './teams-ignore-list.js';
import { createBackendProcessManager } from './backend-process.js';
import {
  AUTO_RECORD_PROMPT_ACTION_CHANNEL,
  AUTO_RECORD_PROMPT_STATE_CHANGED_CHANNEL,
  registerIpcHandlers,
  type AutoRecordPromptAction,
  type AutoRecordPromptRequestResult,
  type AutoRecordPromptState,
  type RecorderRuntimeStatus,
} from './ipc-handlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backend = createBackendProcessManager();
const teamsCallMonitor = createTeamsCallMonitor();
const teamsIgnoreList = createTeamsIgnoreList();
const recorderStatusFilePath = path.join(app.getPath('userData'), 'recorder-runtime-status.json');

let mainWindow: BrowserWindow | null = null;
let autoRecordPromptWindow: BrowserWindow | null = null;
let autoRecordPromptState: AutoRecordPromptState = {
  visible: false,
  title: null,
  updatedAt: null,
};

let recorderRuntimeStatus: RecorderRuntimeStatus = {
  recording: false,
  startedAt: null,
  baseName: null,
  trigger: null,
  updatedAt: null,
};

async function persistRecorderRuntimeStatus(): Promise<void> {
  await writeFile(recorderStatusFilePath, JSON.stringify(recorderRuntimeStatus, null, 2), 'utf8');
}

async function setRecorderRuntimeStatus(
  status: Omit<RecorderRuntimeStatus, 'updatedAt'>
): Promise<RecorderRuntimeStatus> {
  recorderRuntimeStatus = {
    ...status,
    updatedAt: new Date().toISOString(),
  };

  await persistRecorderRuntimeStatus().catch(() => undefined);

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('recorder-runtime-status-changed', recorderRuntimeStatus);
  }

  return recorderRuntimeStatus;
}

function getRendererEntryUrl(windowName?: 'auto-record-prompt'): string | null {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (!devServerUrl) {
    return null;
  }

  const url = new URL(devServerUrl);
  if (windowName) {
    url.searchParams.set('window', windowName);
  }

  return url.toString();
}

function broadcastAutoRecordPromptState(): void {
  autoRecordPromptState = {
    ...autoRecordPromptState,
    updatedAt: new Date().toISOString(),
  };

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(AUTO_RECORD_PROMPT_STATE_CHANGED_CHANNEL, autoRecordPromptState);
  }
}

function emitAutoRecordPromptAction(action: AutoRecordPromptAction, title: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(AUTO_RECORD_PROMPT_ACTION_CHANNEL, { action, title });
  }
}

function closeAutoRecordPromptWindow(): void {
  if (autoRecordPromptWindow && !autoRecordPromptWindow.isDestroyed()) {
    autoRecordPromptWindow.close();
  }
  autoRecordPromptWindow = null;
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 920,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const entryUrl = getRendererEntryUrl();

  if (entryUrl) {
    win.loadURL(entryUrl);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return win;
}

function createAutoRecordPromptWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 220,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    title: 'Teams recording prompt',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const entryUrl = getRendererEntryUrl('auto-record-prompt');
  if (entryUrl) {
    void win.loadURL(entryUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'), {
      query: {
        window: 'auto-record-prompt',
      },
    });
  }

  win.on('ready-to-show', () => {
    win.show();
    win.focus();
    win.moveTop();
    win.flashFrame(true);
  });

  win.on('closed', () => {
    autoRecordPromptWindow = null;
    if (autoRecordPromptState.visible) {
      autoRecordPromptState = {
        visible: false,
        title: null,
        updatedAt: autoRecordPromptState.updatedAt,
      };
      broadcastAutoRecordPromptState();
    }
  });

  return win;
}

async function requestAutoRecordPrompt(title: string): Promise<AutoRecordPromptRequestResult> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return { status: 'ignored' };
  }

  if (teamsIgnoreList.getIgnoreList().includes(normalizedTitle)) {
    return { status: 'ignored' };
  }

  autoRecordPromptState = {
    visible: true,
    title: normalizedTitle,
    updatedAt: new Date().toISOString(),
  };
  broadcastAutoRecordPromptState();

  if (autoRecordPromptWindow && !autoRecordPromptWindow.isDestroyed()) {
    autoRecordPromptWindow.show();
    autoRecordPromptWindow.focus();
    autoRecordPromptWindow.moveTop();
    autoRecordPromptWindow.flashFrame(true);
    return { status: 'already-open' };
  }

  autoRecordPromptWindow = createAutoRecordPromptWindow();
  return { status: 'shown' };
}

async function respondToAutoRecordPrompt(action: AutoRecordPromptAction): Promise<void> {
  const title = autoRecordPromptState.title?.trim();
  if (!title) {
    closeAutoRecordPromptWindow();
    return;
  }

  if (action === 'dismiss') {
    teamsIgnoreList.addToIgnoreList(title);
  }

  emitAutoRecordPromptAction(action, title);
  autoRecordPromptState = {
    visible: false,
    title: null,
    updatedAt: new Date().toISOString(),
  };
  broadcastAutoRecordPromptState();
  closeAutoRecordPromptWindow();
}

app.whenReady().then(() => {
  mainWindow = createMainWindow();

  registerIpcHandlers({
    getBackendStatus: backend.getStatus,
    restartBackend: backend.restart,
    getTeamsCallMonitorStatus: teamsCallMonitor.getStatus,
    setTeamsCallMonitorEnabled: teamsCallMonitor.setEnabled,
    getTeamsIgnoreList: teamsIgnoreList.getIgnoreList,
    addToTeamsIgnoreList: teamsIgnoreList.addToIgnoreList,
    getAutoRecordPromptState: () => autoRecordPromptState,
    requestAutoRecordPrompt,
    respondToAutoRecordPrompt,
    getRecorderRuntimeStatus: () => recorderRuntimeStatus,
    setRecorderRuntimeStatus,
  });
  void backend.start();
  teamsCallMonitor.start();
  void persistRecorderRuntimeStatus().catch(() => undefined);
  teamsCallMonitor.subscribe((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('teams-call-monitor-status-changed', status);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  autoRecordPromptState = {
    visible: false,
    title: null,
    updatedAt: new Date().toISOString(),
  };
  closeAutoRecordPromptWindow();
  await setRecorderRuntimeStatus({
    recording: false,
    startedAt: null,
    baseName: null,
    trigger: null,
  }).catch(() => undefined);
  teamsCallMonitor.stop();
  await backend.stop();
});
