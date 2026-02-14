import { useMemo } from 'react';
import { useProviderStatus } from '../hooks/useProviderStatus';
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
  const { providerHealth, isChecking, checkError, refresh } = useProviderStatus();
  const visual = useMemo(
    () =>
      providerHealth
        ? getVisual(providerHealth.status)
        : { label: 'Checking provider...', tone: 'warn' },
    [providerHealth]
  );

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
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>
      {checkError && <p className="provider-status__meta">Check failed: {checkError}</p>}
      {!checkError && providerHealth?.upstream_status_code && (
        <p className="provider-status__meta">
          Upstream status: {providerHealth.upstream_status_code}
          {providerHealth.endpoint ? ` | ${providerHealth.endpoint}` : ''}
        </p>
      )}
    </div>
  );
}
