import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import type { ProviderHealthResponse } from '../types/api';

type BackendState = 'stopped' | 'starting' | 'running';
type BackendStatus = {
  state: BackendState;
  pid: number | null;
  startedAt: string | null;
  lastError: string | null;
};

interface UseProviderStatusResult {
  providerHealth: ProviderHealthResponse | null;
  isChecking: boolean;
  checkError: string | null;
  backendStatus: BackendStatus | null;
  isRestartingBackend: boolean;
  restartError: string | null;
  refresh: () => Promise<void>;
  restartBackend: () => Promise<void>;
}

export function useProviderStatus(): UseProviderStatusResult {
  const [providerHealth, setProviderHealth] = useState<ProviderHealthResponse | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [isRestartingBackend, setIsRestartingBackend] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  const loadBackendStatus = useCallback(async () => {
    if (!window.electronAPI?.getBackendStatus) {
      setBackendStatus(null);
      return;
    }

    const status = await window.electronAPI.getBackendStatus();
    setBackendStatus(status);
  }, []);

  const refresh = useCallback(async () => {
    setIsChecking(true);
    setCheckError(null);

    try {
      await loadBackendStatus();
      const health = await api.health();
      if (health.status !== 'ok') {
        throw new Error('Backend health check returned a non-ok status.');
      }
      const result = await api.providerHealth();
      setProviderHealth(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check provider status.';
      setCheckError(message);
      setProviderHealth(null);
    } finally {
      setIsChecking(false);
    }
  }, [loadBackendStatus]);

  const restartBackend = useCallback(async () => {
    if (!window.electronAPI?.restartBackend) {
      setRestartError('Backend restart is available only in the Electron desktop app.');
      return;
    }

    setIsRestartingBackend(true);
    setRestartError(null);
    setCheckError(null);

    try {
      const status = await window.electronAPI.restartBackend();
      setBackendStatus(status);

      let backendReady = false;
      const maxAttempts = 20;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const health = await api.health();
          if (health.status === 'ok') {
            backendReady = true;
            break;
          }
        } catch {
          // Keep polling until the backend is available again.
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      if (!backendReady) {
        throw new Error('Backend did not become healthy after restart.');
      }

      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to restart backend.';
      setRestartError(message);
      await loadBackendStatus().catch(() => undefined);
    } finally {
      setIsRestartingBackend(false);
    }
  }, [loadBackendStatus, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh, loadBackendStatus]);

  return {
    providerHealth,
    isChecking,
    checkError,
    backendStatus,
    isRestartingBackend,
    restartError,
    refresh,
    restartBackend,
  };
}
