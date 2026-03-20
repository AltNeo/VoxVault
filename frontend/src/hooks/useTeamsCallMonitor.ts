import { useEffect, useMemo, useState } from 'react';

export interface TeamsCallMonitorState {
  supported: boolean;
  callDetected: boolean;
  matchedWindowTitle: string | null;
  updatedAt: string | null;
}

const DEFAULT_STATE: TeamsCallMonitorState = {
  supported: false,
  callDetected: false,
  matchedWindowTitle: null,
  updatedAt: null,
};

export function useTeamsCallMonitor(): TeamsCallMonitorState {
  const [state, setState] = useState<TeamsCallMonitorState>(DEFAULT_STATE);

  const electronApiAvailable = useMemo(() => {
    return (
      typeof window !== 'undefined' &&
      typeof window.electronAPI?.getTeamsCallMonitorStatus === 'function' &&
      typeof window.electronAPI?.onTeamsCallMonitorStatusChanged === 'function'
    );
  }, []);

  useEffect(() => {
    if (!electronApiAvailable || !window.electronAPI) {
      setState(DEFAULT_STATE);
      return;
    }

    let cancelled = false;
    const loadState = async () => {
      const nextState = await window.electronAPI?.getTeamsCallMonitorStatus();
      if (!cancelled && nextState) {
        setState(nextState);
      }
    };

    void loadState().catch(() => {
      if (!cancelled) {
        setState(DEFAULT_STATE);
      }
    });

    const unsubscribe = window.electronAPI.onTeamsCallMonitorStatusChanged((nextState) => {
      if (!cancelled) {
        setState(nextState);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [electronApiAvailable]);

  return state;
}
