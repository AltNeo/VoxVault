import { isLikelyTeamsCallWindow } from '../../electron/meeting-detection';

describe('teams meeting detection', () => {
  it('detects branded meeting windows', () => {
    expect(isLikelyTeamsCallWindow('Daily Standup Meeting | Microsoft Teams')).toBe(true);
    expect(isLikelyTeamsCallWindow('Calling with Alex - Microsoft Teams')).toBe(true);
    expect(isLikelyTeamsCallWindow('Arora, Naman | Microsoft Teams')).toBe(true);
    expect(isLikelyTeamsCallWindow('Naman Arora | Microsoft Teams')).toBe(true);
  });

  it('ignores non-call Teams windows', () => {
    expect(isLikelyTeamsCallWindow('Chat')).toBe(false);
    expect(isLikelyTeamsCallWindow('Chat | Karanth, Sujay | Microsoft Teams')).toBe(false);
    expect(isLikelyTeamsCallWindow('Chat ML Promo Planning | Microsoft Teams')).toBe(false);
    expect(isLikelyTeamsCallWindow('Calendar | Microsoft Teams')).toBe(false);
    expect(isLikelyTeamsCallWindow('Calendar | Calendar | Microsoft Teams')).toBe(false);
    expect(isLikelyTeamsCallWindow('Settings | Microsoft Teams')).toBe(false);
    expect(isLikelyTeamsCallWindow('General | Contoso Team | Microsoft Teams')).toBe(false);
    expect(isLikelyTeamsCallWindow('Files | Product Strategy | Microsoft Teams')).toBe(false);
    expect(isLikelyTeamsCallWindow('Approvals | Microsoft Teams')).toBe(false);
    expect(isLikelyTeamsCallWindow('Tasks by Planner and To Do | Microsoft Teams')).toBe(false);
    expect(isLikelyTeamsCallWindow('Roadmap discussion | Microsoft Teams')).toBe(false);
    expect(isLikelyTeamsCallWindow('Marketing Sync | Microsoft Teams')).toBe(false);
  });
});
