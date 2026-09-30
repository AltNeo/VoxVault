import { didTeamsCallSwitch } from '../hooks/useAudioRecorder';

describe('Teams call switch detection', () => {
  it('detects a new session while call detection remains active', () => {
    expect(didTeamsCallSwitch(true, true, '2026-09-30T10:00:00Z', '2026-09-30T10:05:00Z')).toBe(
      true
    );
  });

  it('does not split recording when the same call session continues', () => {
    expect(didTeamsCallSwitch(true, true, '2026-09-30T10:00:00Z', '2026-09-30T10:00:00Z')).toBe(
      false
    );
  });
});
