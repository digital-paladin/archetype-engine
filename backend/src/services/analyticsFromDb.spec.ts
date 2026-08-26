import { buildAnalyticsFromDb } from './analyticsFromDb';
import { CharacterStats, XPHistoryEntry } from './data/IDataService';

const sage: CharacterStats = {
  user_id: 'u1',
  class_name: 'Sage',
  level: 26,
  current_xp: 88,
  total_xp: 1000,
};

describe('buildAnalyticsFromDb', () => {
  it('returns timeToLevel from character_stats when xp_history is empty', () => {
    const payload = buildAnalyticsFromDb([], [sage], 90);
    expect(payload.recentEntries).toEqual([]);
    expect(payload.timeToLevel).toHaveLength(1);
    expect(payload.timeToLevel[0].className).toBe('Sage');
    expect(payload.timeToLevel[0].isInactive).toBe(true);
    expect(payload.timeToLevel[0].projectedDate).toBe('N/A');
  });

  it('groups history by earned_at day even if a Date-like string is longer', () => {
    const history: XPHistoryEntry[] = [{
      user_id: 'u1',
      earned_at: '2026-08-10T00:00:00.000Z',
      class_name: 'Sage',
      xp_pending: 0,
      xp_confirmed: 12,
    }];
    const payload = buildAnalyticsFromDb(history, [sage], 90);
    expect(payload.recentEntries).toHaveLength(1);
    expect(payload.recentEntries[0].totalXP).toBe(12);
    expect(payload.timeToLevel[0].isInactive).toBe(false);
  });
});
