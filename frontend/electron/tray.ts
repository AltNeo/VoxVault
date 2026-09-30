import { Menu, nativeImage, Tray } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RecorderRuntimeStatus } from './ipc-handlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type TrayController = {
  create: () => void;
  destroy: () => void;
  updateStatus: (status: RecorderRuntimeStatus) => void;
};

type TrayControllerOptions = {
  onOpen: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onRestartBackend: () => void;
  onQuit: () => void;
};

const FALLBACK_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAmElEQVR4nO2WQQ7AIAgEeWh/1P/22p56E2EXlDbBhJvsDkhUEZG7OBrghwDncQ1jKYBmmgCDm0f3QQBMVWCOLcQOmDN/jTmgE2vhuwLHEaveAnDo5QFoMBCAx1wznXVjotsADfAxAC+EBQPo5QFoQQOUXcVoFwLV6wAZEKHnmDkOMgcT3P4l08S3fkq9MOSscAOWGA1QC/AA3zONpFPFLBsAAAAASUVORK5CYII=';

function createTrayIcon(): Electron.NativeImage {
  const iconPaths = [
    path.join(__dirname, '../public/tray-icon.png'),
    path.join(__dirname, '../dist/tray-icon.png'),
  ];

  for (const iconPath of iconPaths) {
    if (!existsSync(iconPath)) {
      continue;
    }

    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon;
    }
  }

  return nativeImage.createFromDataURL(FALLBACK_ICON_DATA_URL);
}

function getStatusLabel(status: RecorderRuntimeStatus): string {
  if (!status.recording) {
    return 'Status: Idle';
  }

  return `Status: Recording: ${status.baseName ?? 'Untitled'}`;
}

function getTooltip(status: RecorderRuntimeStatus): string {
  if (!status.recording) {
    return 'VoxVault';
  }

  return `VoxVault - Recording: ${status.baseName ?? 'Untitled'}`;
}

export function createTrayController(options: TrayControllerOptions): TrayController {
  let tray: Tray | null = null;
  let status: RecorderRuntimeStatus = {
    recording: false,
    startedAt: null,
    baseName: null,
    trigger: null,
    updatedAt: null,
  };
  let statusLabel = getStatusLabel(status);

  const rebuildContextMenu = (): void => {
    if (!tray) {
      return;
    }

    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open VoxVault', click: options.onOpen },
        { label: statusLabel, enabled: false },
        {
          label: status.recording ? 'Stop and save recording' : 'Start recording',
          click: status.recording ? options.onStopRecording : options.onStartRecording,
        },
        { type: 'separator' },
        { label: 'Restart backend', click: options.onRestartBackend },
        { type: 'separator' },
        { label: 'Quit VoxVault', click: options.onQuit },
      ])
    );
  };

  const create = (): void => {
    if (tray) {
      return;
    }

    tray = new Tray(createTrayIcon());
    tray.setToolTip(getTooltip(status));
    tray.on('click', options.onOpen);
    tray.on('double-click', options.onOpen);
    rebuildContextMenu();
  };

  const destroy = (): void => {
    if (!tray) {
      return;
    }

    tray.destroy();
    tray = null;
  };

  const updateStatus = (nextStatus: RecorderRuntimeStatus): void => {
    status = nextStatus;
    const nextStatusLabel = getStatusLabel(status);
    if (nextStatusLabel !== statusLabel) {
      statusLabel = nextStatusLabel;
      rebuildContextMenu();
    }

    tray?.setToolTip(getTooltip(status));
  };

  return {
    create,
    destroy,
    updateStatus,
  };
}
