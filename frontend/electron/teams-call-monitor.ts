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

type JevTransition = 'START' | 'CONTINUE' | 'SWITCH' | 'END' | 'UNCERTAIN';

type TeamsTransitionResponse = {
  supported: boolean;
  decision: JevTransition;
  confidence: number;
  matched_window_title: string | null;
};

const POLL_INTERVAL_MS = 2000;
const TEAMS_TRANSITION_URL = 'http://127.0.0.1:8000/api/teams/call-transition';
export const TEAMS_CALL_SESSION_GRACE_MS = 45 * 60 * 1000;

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

export function applyTeamsTransition(
  session: TeamsCallSession | null,
  decision: JevTransition,
  title: string | null,
  nowMs: number
): TeamsCallSession | null {
  const resolvedTitle = title?.trim() || session?.originalTitle || 'Microsoft Teams call';

  if (decision === 'START') {
    return session ?? createTeamsCallSession(resolvedTitle, nowMs);
  }
  if (decision === 'CONTINUE') {
    return session
      ? refreshTeamsCallSession(session, nowMs)
      : createTeamsCallSession(resolvedTitle, nowMs);
  }
  if (decision === 'SWITCH') {
    return createTeamsCallSession(resolvedTitle, nowMs);
  }
  if (decision === 'END') {
    return null;
  }
  return session;
}

function createInitialStatus(): TeamsCallMonitorStatus {
  const runtimeProcess = (globalThis as { process?: { platform?: string } }).process;
  return {
    supported: runtimeProcess?.platform === 'win32',
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
  let timer: ReturnType<typeof setInterval> | null = null;
  let enabled = false;
  let polling = false;
  let activeSession: TeamsCallSession | null = null;
  let lastSession: TeamsCallSession | null = null;
  let manualContinueUntilMs = 0;
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

  const buildStatus = (
    session: TeamsCallSession | null
  ): Omit<TeamsCallMonitorStatus, 'updatedAt'> => ({
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
      const response = await fetch(TEAMS_TRANSITION_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`Teams transition request failed: ${response.status}`);
      }
      const transition = (await response.json()) as TeamsTransitionResponse;

      if (transition.decision === 'END' && activeSession && nowMs < manualContinueUntilMs) {
        activeSession = refreshTeamsCallSession(
          activeSession,
          nowMs,
          manualContinueUntilMs - nowMs
        );
      } else {
        activeSession = applyTeamsTransition(
          activeSession,
          transition.decision,
          transition.matched_window_title,
          nowMs
        );
      }
      if (activeSession) {
        lastSession = activeSession;
      }
      updateStatus({ ...buildStatus(activeSession), supported: transition.supported });
    } catch {
      // Hold current recording state when local probing or Jev is unavailable.
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
        manualContinueUntilMs = 0;
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
      manualContinueUntilMs = revivedSession.graceExpiresAtMs;
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
