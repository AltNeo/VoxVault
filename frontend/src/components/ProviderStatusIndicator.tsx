import { useCallback, useEffect, useMemo, useState } from 'react';
import { useProviderStatus } from '../hooks/useProviderStatus';
import api from '../services/api';
import type { ProviderHealthStatus } from '../types/api';

interface StatusVisual {
  label: string;
  tone: 'ok' | 'warn';
}

function getVisual(status: ProviderHealthStatus): StatusVisual {
  if (status === 'ok') {
    return { label: 'Provider online', tone: 'ok' };
  }
  if (status === 'not_configured') {
    return { label: 'Provider not configured', tone: 'warn' };
  }
  if (status === 'auth_failed') {
    return { label: 'Provider auth failed', tone: 'warn' };
  }
  if (status === 'endpoint_not_found') {
    return { label: 'Provider endpoint invalid', tone: 'warn' };
  }
  return { label: 'Provider error', tone: 'warn' };
}

export default function ProviderStatusIndicator() {
  const {
    providerHealth,
    isChecking,
    checkError,
    backendStatus,
    isBackendApiOnline,
    isRestartingBackend,
    restartError,
    refresh,
    restartBackend,
  } = useProviderStatus();
  const [summaryModelReady, setSummaryModelReady] = useState<boolean | null>(null);
  const [summaryModelDetail, setSummaryModelDetail] = useState<string | null>(null);
  const [isSummaryModelChecking, setIsSummaryModelChecking] = useState(false);
  const [summaryModelError, setSummaryModelError] = useState<string | null>(null);

  const loadSummaryModelHealth = useCallback(async () => {
    setIsSummaryModelChecking(true);
    setSummaryModelError(null);

    try {
      const result = await api.summaryModelHealth();
      setSummaryModelReady(result.ready);
      const extra = [result.model_name, result.detail].filter(Boolean).join(' | ');
      setSummaryModelDetail(extra.length > 0 ? extra : null);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Failed to check summary model.';
      setSummaryModelError(message);
      setSummaryModelReady(false);
      setSummaryModelDetail(null);
    } finally {
      setIsSummaryModelChecking(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    await refresh();
    await loadSummaryModelHealth();
  }, [loadSummaryModelHealth, refresh]);

  useEffect(() => {
    void loadSummaryModelHealth();
  }, [loadSummaryModelHealth]);

  const visual = useMemo(
    () =>
      providerHealth
        ? getVisual(providerHealth.status)
        : { label: 'Checking provider...', tone: 'warn' },
    [providerHealth]
  );
  const backendMeta = useMemo(() => {
    if (!backendStatus) {
      return null;
    }

    if (isBackendApiOnline && backendStatus.state === 'stopped') {
      return 'Backend: running (externally managed)';
    }

    const segments = [`Backend: ${backendStatus.state}`];
    if (backendStatus.pid) {
      segments.push(`pid ${backendStatus.pid}`);
    }
    if (backendStatus.lastError) {
      segments.push(backendStatus.lastError);
    }
    return segments.join(' | ');
  }, [backendStatus, isBackendApiOnline]);
  const summaryModelLabel = useMemo(() => {
    if (isSummaryModelChecking) {
      return 'Summary model: checking...';
    }
    if (summaryModelReady) {
      return 'Summary model: ready';
    }
    return 'Summary model: not loaded';
  }, [isSummaryModelChecking, summaryModelReady]);

  return (
    <div className="provider-status" aria-live="polite">
      <div className="provider-status__row">
        <span
          className={`provider-status__badge ${
            visual.tone === 'ok' ? 'provider-status__badge--ok' : 'provider-status__badge--warn'
          }`}
        >
          {isChecking ? 'Checking provider...' : visual.label}
        </span>
        <button
          type="button"
          className="btn btn--ghost provider-status__refresh"
          disabled={isChecking || isRestartingBackend || isSummaryModelChecking}
          onClick={() => void handleRefresh()}
        >
          Refresh
        </button>
        <button
          type="button"
          className="btn btn--ghost provider-status__refresh"
          disabled={isChecking || isRestartingBackend}
          onClick={() => void restartBackend()}
        >
          {isRestartingBackend ? 'Restarting backend...' : 'Restart backend'}
        </button>
      </div>
      <p className="provider-status__meta provider-status__summary">{summaryModelLabel}</p>
      {summaryModelDetail && <p className="provider-status__meta">{summaryModelDetail}</p>}
      {backendMeta && <p className="provider-status__meta">{backendMeta}</p>}
      {restartError && <p className="provider-status__meta">Restart failed: {restartError}</p>}
      {checkError && <p className="provider-status__meta">Check failed: {checkError}</p>}
      {summaryModelError && (
        <p className="provider-status__meta">Summary check failed: {summaryModelError}</p>
      )}
      {!checkError && providerHealth?.upstream_status_code && (
        <p className="provider-status__meta">
          Upstream status: {providerHealth.upstream_status_code}
          {providerHealth.endpoint ? ` | ${providerHealth.endpoint}` : ''}
        </p>
      )}
    </div>
  );
}
