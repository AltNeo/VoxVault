import { desktopCapturer } from 'electron';
import { isLikelyTeamsCallWindow } from './meeting-detection.js';

export type TeamsCallMonitorStatus = {
  supported: boolean;
  callDetected: boolean;
  matchedWindowTitle: string | null;
  updatedAt: string | null;
};

type Listener = (status: TeamsCallMonitorStatus) => void;

const POLL_INTERVAL_MS = 4000;
const EXIT_MISSED_POLLS_THRESHOLD = 2;

function createInitialStatus(): TeamsCallMonitorStatus {
  return {
    supported: process.platform === 'win32',
    callDetected: false,
    matchedWindowTitle: null,
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
    left.matchedWindowTitle === right.matchedWindowTitle
  );
}

export function createTeamsCallMonitor() {
  let status = createInitialStatus();
  let timer: NodeJS.Timeout | null = null;
  let enabled = false;
  let polling = false;
  let missedPollCount = 0;
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

  const poll = async () => {
    if (!status.supported || polling) {
      return;
    }

    polling = true;
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        fetchWindowIcons: false,
      });
      const matchedSource = sources.find((source) => isLikelyTeamsCallWindow(source.name));
      if (matchedSource) {
        missedPollCount = 0;
        updateStatus({
          supported: true,
          callDetected: true,
          matchedWindowTitle: matchedSource.name,
        });
      } else if (status.callDetected) {
        missedPollCount += 1;
        if (missedPollCount >= EXIT_MISSED_POLLS_THRESHOLD) {
          missedPollCount = 0;
          updateStatus({
            supported: true,
            callDetected: false,
            matchedWindowTitle: null,
          });
        }
      } else {
        missedPollCount = 0;
        updateStatus({
          supported: true,
          callDetected: false,
          matchedWindowTitle: null,
        });
      }
    } catch {
      if (status.callDetected) {
        missedPollCount += 1;
        if (missedPollCount >= EXIT_MISSED_POLLS_THRESHOLD) {
          missedPollCount = 0;
          updateStatus({
            supported: true,
            callDetected: false,
            matchedWindowTitle: null,
          });
        }
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
        missedPollCount = 0;
        polling = false;
        updateStatus({
          supported: status.supported,
          callDetected: false,
          matchedWindowTitle: null,
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
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
