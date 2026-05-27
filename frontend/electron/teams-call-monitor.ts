import { desktopCapturer } from 'electron';
import { isLikelyTeamsCallWindow } from './meeting-detection.js';

export type TeamsCallMonitorStatus = {
  supported: boolean;
  callDetected: boolean;
  matchedWindowTitle: string | null;
  sessionStartedAt: string | null;
  lastSeenAt: string | null;
  graceExpiresAt: string | null;
  updatedAt: string | null;
};

type Listener = (status: TeamsCallMonitorStatus) => void;

const POLL_INTERVAL_MS = 4000;
export const TEAMS_CALL_SESSION_GRACE_MS = 30 * 60 * 1000;

export type TeamsCallSession = {
  originalTitle: string;
  startedAtMs: number;
  lastSeenAtMs: number;
  graceExpiresAtMs: number;
};

export function createTeamsCallSession(
  title: string,
  nowMs: number,
  graceMs: number = TEAMS_CALL_SESSION_GRACE_MS
): TeamsCallSession {
  return {
    originalTitle: title,
    startedAtMs: nowMs,
    lastSeenAtMs: nowMs,
    graceExpiresAtMs: nowMs + graceMs,
  };
}

export function refreshTeamsCallSession(
  session: TeamsCallSession,
  nowMs: number,
  graceMs: number = TEAMS_CALL_SESSION_GRACE_MS
): TeamsCallSession {
  return {
    ...session,
    lastSeenAtMs: nowMs,
    graceExpiresAtMs: nowMs + graceMs,
  };
}

export function extendTeamsCallSession(
  session: TeamsCallSession,
  nowMs: number,
  extensionMs: number
): TeamsCallSession {
  const baseMs = Math.max(session.graceExpiresAtMs, nowMs);

  return {
    ...session,
    graceExpiresAtMs: baseMs + extensionMs,
  };
}

export function isTeamsCallSessionExpired(session: TeamsCallSession, nowMs: number): boolean {
  return nowMs >= session.graceExpiresAtMs;
}

function createInitialStatus(): TeamsCallMonitorStatus {
  return {
    supported: process.platform === 'win32',
    callDetected: false,
    matchedWindowTitle: null,
    sessionStartedAt: null,
    lastSeenAt: null,
    graceExpiresAt: null,
    updatedAt: null,
  };
}

function isStatusEqual(
  left: TeamsCallMonitorStatus,
  right: Omit<TeamsCallMonitorStatus, 'updatedAt'>
): boolean {
  return (
    left.supported === right.supported &&
    left.callDetected === right.callDetected &&
    left.matchedWindowTitle === right.matchedWindowTitle &&
    left.sessionStartedAt === right.sessionStartedAt &&
    left.lastSeenAt === right.lastSeenAt &&
    left.graceExpiresAt === right.graceExpiresAt
  );
}

export function createTeamsCallMonitor() {
  let status = createInitialStatus();
  let timer: NodeJS.Timeout | null = null;
  let enabled = false;
  let polling = false;
  let activeSession: TeamsCallSession | null = null;
  let lastSession: TeamsCallSession | null = null;
  const listeners = new Set<Listener>();

  const emit = () => {
    for (const listener of listeners) {
      listener(status);
    }
  };

  const updateStatus = (nextStatus: Omit<TeamsCallMonitorStatus, 'updatedAt'>) => {
    if (isStatusEqual(status, nextStatus)) {
      return;
    }

    status = {
      ...nextStatus,
      updatedAt: new Date().toISOString(),
    };
    emit();
  };

  const buildStatus = (session: TeamsCallSession | null): Omit<TeamsCallMonitorStatus, 'updatedAt'> => ({
    supported: true,
    callDetected: session !== null,
    matchedWindowTitle: session?.originalTitle ?? null,
    sessionStartedAt: session ? new Date(session.startedAtMs).toISOString() : null,
    lastSeenAt: session ? new Date(session.lastSeenAtMs).toISOString() : null,
    graceExpiresAt: session ? new Date(session.graceExpiresAtMs).toISOString() : null,
  });

  const poll = async () => {
    if (!status.supported || polling) {
      return;
    }

    polling = true;
    try {
      const nowMs = Date.now();
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        fetchWindowIcons: false,
      });
      const matchedSource = sources.find((source) => isLikelyTeamsCallWindow(source.name));

      if (matchedSource) {
        activeSession = activeSession
          ? refreshTeamsCallSession(activeSession, nowMs)
          : createTeamsCallSession(matchedSource.name, nowMs);
        lastSession = activeSession;
        updateStatus(buildStatus(activeSession));
      } else if (activeSession) {
        if (isTeamsCallSessionExpired(activeSession, nowMs)) {
          lastSession = activeSession;
          activeSession = null;
          updateStatus(buildStatus(null));
        } else {
          updateStatus(buildStatus(activeSession));
        }
      } else {
        updateStatus(buildStatus(null));
      }
    } catch {
      if (activeSession && isTeamsCallSessionExpired(activeSession, Date.now())) {
        lastSession = activeSession;
        activeSession = null;
        updateStatus(buildStatus(null));
      }
    } finally {
      polling = false;
    }
  };

  return {
    getStatus: (): TeamsCallMonitorStatus => status,
    setEnabled: (nextEnabled: boolean) => {
      enabled = nextEnabled;
      if (!enabled) {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        polling = false;
        activeSession = null;
        lastSession = null;
        updateStatus({
          supported: status.supported,
          callDetected: false,
          matchedWindowTitle: null,
          sessionStartedAt: null,
          lastSeenAt: null,
          graceExpiresAt: null,
        });
        return;
      }

      if (!timer && status.supported) {
        void poll();
        timer = setInterval(() => {
          void poll();
        }, POLL_INTERVAL_MS);
      }
    },
    start: () => {
      if (timer || !status.supported || !enabled) {
        return;
      }

      void poll();
      timer = setInterval(() => {
        void poll();
      }, POLL_INTERVAL_MS);
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    extendGracePeriod: (extensionMs: number): TeamsCallMonitorStatus => {
      const baseSession = activeSession ?? lastSession;
      if (!baseSession) {
        return status;
      }

      const revivedSession = extendTeamsCallSession(baseSession, Date.now(), extensionMs);
      activeSession = revivedSession;
      lastSession = revivedSession;
      updateStatus(buildStatus(activeSession));
      return status;
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
