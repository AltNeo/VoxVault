import { deriveRecordingBaseName } from '../services/recording-name';

describe('recording name helpers', () => {
  it('uses the teams meeting title without the product suffix', () => {
    expect(deriveRecordingBaseName('Daily Standup Meeting | Microsoft Teams')).toBe(
      'Daily Standup Meeting'
    );
  });

  it('removes invalid filename characters', () => {
    expect(deriveRecordingBaseName('Roadmap: Q2/Q3 Sync? | Microsoft Teams')).toBe(
      'Roadmap Q2 Q3 Sync'
    );
  });

  it('falls back when the title is unavailable', () => {
    expect(deriveRecordingBaseName(null)).toBe('recording');
  });
});
