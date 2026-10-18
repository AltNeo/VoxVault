import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProviderStatus } from '../hooks/useProviderStatus';
import api from '../services/api';
import type { ProviderHealthStatus } from '../types/api';

interface StatusVisual {
  label: string;
  tone: 'ok' | 'warn';
}

function getVisual(status: ProviderHealthStatus): StatusVisual {
  if (status === 'ok') {
    return { label: 'Transcription online', tone: 'ok' };
  }
  if (status === 'not_configured') {
    return { label: 'Transcription not set up', tone: 'warn' };
  }
  if (status === 'auth_failed') {
    return { label: 'Transcription key rejected', tone: 'warn' };
  }
  if (status === 'endpoint_not_found') {
    return { label: 'Transcription address wrong', tone: 'warn' };
  }
  return { label: 'Transcription error', tone: 'warn' };
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!detailsOpen) return;
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setDetailsOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [detailsOpen]);

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
        : { label: 'Checking transcription…', tone: 'warn' },
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
      return 'Checking summaries…';
    }
    if (summaryModelReady) {
      return 'Summaries ready';
    }
    return 'Summaries load on first use';
  }, [isSummaryModelChecking, summaryModelReady]);

  return (
    <div className="status" ref={rootRef} aria-live="polite">
      <button
        type="button"
        className={`chip ${visual.tone === 'ok' ? 'chip--ok' : 'chip--warn'}`}
        onClick={() => setDetailsOpen((current) => !current)}
        aria-expanded={detailsOpen}
      >
        {isChecking ? 'Checking transcription…' : visual.label}
      </button>
      <button
        type="button"
        className={`chip chip--hide-narrow ${summaryModelReady ? 'chip--ok' : 'chip--idle'}`}
        onClick={() => setDetailsOpen((current) => !current)}
        aria-expanded={detailsOpen}
      >
        {summaryModelLabel}
      </button>
      {detailsOpen && (
        <div className="status__panel" role="dialog" aria-label="Service status">
          {providerHealth?.detail && <p>{providerHealth.detail}</p>}
          {summaryModelDetail && <p>Summaries: {summaryModelDetail}</p>}
          {backendMeta && <p>{backendMeta}</p>}
          {restartError && <p className="error-text">Restart failed: {restartError}</p>}
          {checkError && <p className="error-text">Check failed: {checkError}</p>}
          {summaryModelError && (
            <p className="error-text">Summary check failed: {summaryModelError}</p>
          )}
          {!checkError && providerHealth?.upstream_status_code && (
            <p>
              Upstream status: {providerHealth.upstream_status_code}
              {providerHealth.endpoint ? ` · ${providerHealth.endpoint}` : ''}
            </p>
          )}
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={isChecking || isRestartingBackend || isSummaryModelChecking}
              onClick={() => void handleRefresh()}
            >
              Check again
            </button>
            <button
              type="button"
              className="btn"
              disabled={isChecking || isRestartingBackend}
              onClick={() => void restartBackend()}
            >
              {isRestartingBackend ? 'Restarting…' : 'Restart backend'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
