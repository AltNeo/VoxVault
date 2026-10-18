import { app, BrowserWindow } from 'electron';
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTeamsCallMonitor } from './teams-call-monitor.js';
import { createTeamsIgnoreList } from './teams-ignore-list.js';
import { createBackendProcessManager } from './backend-process.js';
import { createTrayController } from './tray.js';
import {
  AUTO_RECORD_PROMPT_ACTION_CHANNEL,
  AUTO_RECORD_PROMPT_STATE_CHANGED_CHANNEL,
  RECORDER_COMMAND_CHANNEL,
  registerIpcHandlers,
  type AutoRecordPromptAction,
  type AutoRecordPromptRequestResult,
  type AutoRecordPromptState,
  type RecorderRuntimeStatus,
} from './ipc-handlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const shouldStartHidden =
  process.argv.includes('--hidden') || process.env.VOXVAULT_START_HIDDEN === '1';
const backend = createBackendProcessManager();
const teamsCallMonitor = createTeamsCallMonitor();
const STOP_PROMPT_CONTINUE_EXTENSION_MS = 20 * 60 * 1000;
const teamsIgnoreList = createTeamsIgnoreList();
const recorderStatusFilePath = path.join(app.getPath('userData'), 'recorder-runtime-status.json');
const popupDiagnosticLogPath = path.join(app.getPath('userData'), 'popup-diagnostics.jsonl');

let mainWindow: BrowserWindow | null = null;
let autoRecordPromptWindow: BrowserWindow | null = null;
let trayController: ReturnType<typeof createTrayController> | null = null;
let isQuitting = false;
let autoRecordPromptState: AutoRecordPromptState = {
  visible: false,
  kind: 'start',
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

function logPopupDiagnostic(event: string, details: Record<string, unknown> = {}): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...details,
  });
  void appendFile(popupDiagnosticLogPath, `${entry}\n`, 'utf8').catch((error: unknown) => {
    console.error('Failed to write popup diagnostics.', error);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

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
  trayController?.updateStatus(recorderRuntimeStatus);

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

function emitRecorderCommand(command: 'start' | 'stop'): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(RECORDER_COMMAND_CHANNEL, command);
  }
}

function closeAutoRecordPromptWindow(): void {
  if (autoRecordPromptWindow && !autoRecordPromptWindow.isDestroyed()) {
    logPopupDiagnostic('close-requested');
    autoRecordPromptWindow.close();
  }
  autoRecordPromptWindow = null;
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 920,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.on('ready-to-show', () => {
    if (!shouldStartHidden) {
      showMainWindow();
    }
  });

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideMainWindow();
    }
  });

  const entryUrl = getRendererEntryUrl();

  if (entryUrl) {
    win.loadURL(entryUrl);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return win;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }

  mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
}

function hideMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.hide();
  mainWindow.setSkipTaskbar(true);
}

function createAutoRecordPromptWindow(): BrowserWindow {
  logPopupDiagnostic('window-create', {
    kind: autoRecordPromptState.kind,
    titleLength: autoRecordPromptState.title?.length ?? 0,
  });
  const win = new BrowserWindow({
    width: 500,
    height: 320,
    show: false,
    skipTaskbar: true,
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
  const loadPromise = entryUrl
    ? win.loadURL(entryUrl)
    : win.loadFile(path.join(__dirname, '../dist/index.html'), {
        query: {
          window: 'auto-record-prompt',
        },
      });

  void loadPromise.catch((error: unknown) => {
    logPopupDiagnostic('load-rejected', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  win.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) {
      logPopupDiagnostic('navigation-started');
    }
  });
  win.webContents.on('dom-ready', () => logPopupDiagnostic('dom-ready'));
  win.webContents.on('did-finish-load', () => logPopupDiagnostic('load-finished'));
  win.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
      if (isMainFrame) {
        logPopupDiagnostic('load-failed', { errorCode, errorDescription });
      }
    }
  );
  win.webContents.on('preload-error', (_event, _preloadPath, error) => {
    logPopupDiagnostic('preload-error', { error: error.message });
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    logPopupDiagnostic('renderer-gone', { ...details });
  });

  win.on('ready-to-show', () => {
    logPopupDiagnostic('ready-to-show');
    win.show();
    win.focus();
    win.moveTop();
    win.flashFrame(true);
  });

  win.on('show', () => logPopupDiagnostic('shown'));
  win.on('focus', () => logPopupDiagnostic('focused'));
  win.on('unresponsive', () => logPopupDiagnostic('unresponsive'));
  win.on('responsive', () => logPopupDiagnostic('responsive'));

  win.on('closed', () => {
    logPopupDiagnostic('closed');
    autoRecordPromptWindow = null;
    if (autoRecordPromptState.visible) {
      autoRecordPromptState = {
        visible: false,
        kind: 'start',
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
  logPopupDiagnostic('start-prompt-requested', { titleLength: normalizedTitle.length });
  if (!normalizedTitle) {
    return { status: 'ignored' };
  }

  if (teamsIgnoreList.getIgnoreList().includes(normalizedTitle)) {
    return { status: 'ignored' };
  }

  autoRecordPromptState = {
    visible: true,
    kind: 'start',
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

async function requestStopRecordPrompt(): Promise<AutoRecordPromptRequestResult> {
  logPopupDiagnostic('stop-prompt-requested');
  autoRecordPromptState = {
    visible: true,
    kind: 'stop',
    title: recorderRuntimeStatus.baseName,
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
  logPopupDiagnostic('response-received', { action, kind: autoRecordPromptState.kind });
  const title = autoRecordPromptState.title?.trim() ?? '';
  if (autoRecordPromptState.kind === 'start' && !title) {
    closeAutoRecordPromptWindow();
    return;
  }

  if (autoRecordPromptState.kind === 'start' && action === 'dismiss') {
    teamsIgnoreList.addToIgnoreList(title);
  }

  if (autoRecordPromptState.kind === 'stop' && action === 'dismiss') {
    teamsCallMonitor.extendGracePeriod(STOP_PROMPT_CONTINUE_EXTENSION_MS);
  }

  emitAutoRecordPromptAction(action, title);
  autoRecordPromptState = {
    visible: false,
    kind: 'start',
    title: null,
    updatedAt: new Date().toISOString(),
  };
  broadcastAutoRecordPromptState();
  closeAutoRecordPromptWindow();
}

app.whenReady().then(() => {
  logPopupDiagnostic('app-ready', {
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    platform: process.platform,
    release: process.getSystemVersion(),
    gpuFeatures: app.getGPUFeatureStatus(),
  });
  mainWindow = createMainWindow();
  trayController = createTrayController({
    onOpen: showMainWindow,
    onStartRecording: () => emitRecorderCommand('start'),
    onStopRecording: () => emitRecorderCommand('stop'),
    onRestartBackend: () => {
      void backend.restart();
    },
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });
  trayController.create();

  registerIpcHandlers({
    getBackendStatus: backend.getStatus,
    restartBackend: backend.restart,
    getTeamsCallMonitorStatus: teamsCallMonitor.getStatus,
    setTeamsCallMonitorEnabled: teamsCallMonitor.setEnabled,
    getTeamsIgnoreList: teamsIgnoreList.getIgnoreList,
    addToTeamsIgnoreList: teamsIgnoreList.addToIgnoreList,
    getAutoRecordPromptState: () => autoRecordPromptState,
    requestAutoRecordPrompt,
    requestStopRecordPrompt,
    respondToAutoRecordPrompt,
    getRecorderRuntimeStatus: () => recorderRuntimeStatus,
    setRecorderRuntimeStatus,
  });
  void backend.start();
  teamsCallMonitor.start();
  void persistRecorderRuntimeStatus().catch(() => undefined);
  teamsCallMonitor.subscribe((status) => {
    if (
      autoRecordPromptState.visible &&
      autoRecordPromptState.kind === 'stop' &&
      status.callDetected
    ) {
      autoRecordPromptState = {
        visible: false,
        kind: 'start',
        title: null,
        updatedAt: new Date().toISOString(),
      };
      broadcastAutoRecordPromptState();
      closeAutoRecordPromptWindow();
    }

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
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});

app.on('before-quit', async () => {
  isQuitting = true;
  trayController?.destroy();
  trayController = null;
  autoRecordPromptState = {
    visible: false,
    kind: 'start',
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
