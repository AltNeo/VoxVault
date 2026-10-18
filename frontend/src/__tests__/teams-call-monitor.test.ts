import {
  TEAMS_CALL_SESSION_GRACE_MS,
  applyTeamsTransition,
  createTeamsCallSession,
  extendTeamsCallSession,
  isTeamsCallSessionExpired,
  refreshTeamsCallSession,
} from '../../electron/teams-call-monitor';

describe('teams call session helpers', () => {
  it('keeps the original title while refreshing detections', () => {
    const session = createTeamsCallSession('Initial Call | Microsoft Teams', 1_000);
    const refreshed = refreshTeamsCallSession(session, 61_000);

    expect(refreshed.originalTitle).toBe('Initial Call | Microsoft Teams');
    expect(refreshed.startedAtMs).toBe(1_000);
    expect(refreshed.lastSeenAtMs).toBe(61_000);
    expect(refreshed.graceExpiresAtMs).toBe(61_000 + TEAMS_CALL_SESSION_GRACE_MS);
  });

  it('expires only after the 45 minute grace window passes', () => {
    const session = createTeamsCallSession('Daily Sync | Microsoft Teams', 5_000);

    expect(isTeamsCallSessionExpired(session, 5_000 + TEAMS_CALL_SESSION_GRACE_MS - 1)).toBe(false);
    expect(isTeamsCallSessionExpired(session, 5_000 + TEAMS_CALL_SESSION_GRACE_MS)).toBe(true);
  });

  it('extends grace from now when the prior grace already expired', () => {
    const session = createTeamsCallSession('Roadmap Call | Microsoft Teams', 0);
    const nowMs = TEAMS_CALL_SESSION_GRACE_MS + 5_000;
    const extended = extendTeamsCallSession(session, nowMs, 20 * 60 * 1000);

    expect(extended.graceExpiresAtMs).toBe(nowMs + 20 * 60 * 1000);
  });

  it('starts a fresh session when Jev identifies an immediate call switch', () => {
    const first = createTeamsCallSession('Alpha planning', 1_000);
    const switched = applyTeamsTransition(first, 'SWITCH', 'Beta review', 2_000);

    expect(switched?.originalTitle).toBe('Beta review');
    expect(switched?.startedAtMs).toBe(2_000);
  });

  it('keeps the current session when Jev is uncertain', () => {
    const current = createTeamsCallSession('Alpha planning', 1_000);

    expect(applyTeamsTransition(current, 'UNCERTAIN', 'Other title', 2_000)).toBe(current);
  });

  it('treats title aliases as the same call when Jev says continue', () => {
    const current = createTeamsCallSession('Alpha planning | Microsoft Teams', 1_000);
    const continued = applyTeamsTransition(current, 'CONTINUE', 'Microsoft Teams', 2_000);

    expect(continued?.originalTitle).toBe('Alpha planning | Microsoft Teams');
    expect(continued?.startedAtMs).toBe(1_000);
  });
});
