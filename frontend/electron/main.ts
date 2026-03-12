import { app, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTeamsCallMonitor } from './teams-call-monitor.js';
import { createBackendProcessManager } from './backend-process.js';
import { registerIpcHandlers, type RecorderRuntimeStatus } from './ipc-handlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backend = createBackendProcessManager();
const teamsCallMonitor = createTeamsCallMonitor();
const recorderStatusFilePath = path.join(app.getPath('userData'), 'recorder-runtime-status.json');

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

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 920,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  registerIpcHandlers({
    getBackendStatus: backend.getStatus,
    restartBackend: backend.restart,
    getTeamsCallMonitorStatus: teamsCallMonitor.getStatus,
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
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await setRecorderRuntimeStatus({
    recording: false,
    startedAt: null,
    baseName: null,
    trigger: null,
  }).catch(() => undefined);
  teamsCallMonitor.stop();
  await backend.stop();
});
