import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

export type BackendState = 'stopped' | 'starting' | 'running';

export type BackendStatus = {
  state: BackendState;
  pid: number | null;
  startedAt: string | null;
  lastError: string | null;
};

type BackendProcessManager = {
  start: () => Promise<BackendStatus>;
  stop: () => Promise<BackendStatus>;
  restart: () => Promise<BackendStatus>;
  getStatus: () => BackendStatus;
};

const DEFAULT_BACKEND_PORT = 8000;
const STARTUP_GRACE_MS = 400;

function resolveRepoRoot(): string {
  return path.resolve(app.getAppPath(), '..');
}

function resolveBackendPath(): string {
  return path.join(resolveRepoRoot(), 'backend');
}

function resolveBackendCommand(): string {
  return (
    process.env.VOXVAULT_BACKEND_CMD ??
    `python -m uvicorn app.main:app --host 127.0.0.1 --port ${DEFAULT_BACKEND_PORT}`
  );
}

export function createBackendProcessManager(): BackendProcessManager {
  let backendProcess: ChildProcess | null = null;
  let state: BackendState = 'stopped';
  let startedAt: string | null = null;
  let lastError: string | null = null;

  const getStatus = (): BackendStatus => ({
    state,
    pid: backendProcess?.pid ?? null,
    startedAt,
    lastError,
  });

  const stop = async (): Promise<BackendStatus> => {
    if (!backendProcess) {
      state = 'stopped';
      return getStatus();
    }

    const proc = backendProcess;
    backendProcess = null;
    state = 'stopped';
    startedAt = null;

    await new Promise<void>((resolve) => {
      let settled = false;

      const finalize = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      proc.once('exit', finalize);
      proc.once('close', finalize);

      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], {
          windowsHide: true,
        });
        killer.once('exit', finalize);
        killer.once('error', finalize);
      } else {
        proc.kill('SIGTERM');
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Ignore - process likely already exited.
          }
          finalize();
        }, 1500);
      }
    });

    return getStatus();
  };

  const start = async (): Promise<BackendStatus> => {
    if (backendProcess) {
      state = 'running';
      return getStatus();
    }

    const backendCwd = resolveBackendPath();
    const command = resolveBackendCommand();
    state = 'starting';
    lastError = null;

    const proc = spawn(command, {
      cwd: backendCwd,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    backendProcess = proc;
    startedAt = new Date().toISOString();

    proc.stdout?.on('data', (chunk) => {
      process.stdout.write(`[backend] ${chunk.toString()}`);
    });

    proc.stderr?.on('data', (chunk) => {
      process.stderr.write(`[backend] ${chunk.toString()}`);
    });

    proc.once('error', (error) => {
      lastError = error.message;
      state = 'stopped';
      backendProcess = null;
      startedAt = null;
    });

    proc.once('exit', (code, signal) => {
      const isExpectedStop = state === 'stopped';
      if (!isExpectedStop) {
        lastError = `backend exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
      }
      state = 'stopped';
      backendProcess = null;
      startedAt = null;
    });

    await new Promise((resolve) => setTimeout(resolve, STARTUP_GRACE_MS));
    if (backendProcess) {
      state = 'running';
    }
    return getStatus();
  };

  const restart = async (): Promise<BackendStatus> => {
    await stop();
    return start();
  };

  return {
    start,
    stop,
    restart,
    getStatus,
  };
}
