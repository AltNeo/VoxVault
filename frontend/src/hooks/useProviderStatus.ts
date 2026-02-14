import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import type { ProviderHealthResponse } from '../types/api';

interface UseProviderStatusResult {
  providerHealth: ProviderHealthResponse | null;
  isChecking: boolean;
  checkError: string | null;
  refresh: () => Promise<void>;
}

export function useProviderStatus(): UseProviderStatusResult {
  const [providerHealth, setProviderHealth] = useState<ProviderHealthResponse | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsChecking(true);
    setCheckError(null);

    try {
      const result = await api.providerHealth();
      setProviderHealth(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check provider status.';
      setCheckError(message);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    providerHealth,
    isChecking,
    checkError,
    refresh,
  };
}
