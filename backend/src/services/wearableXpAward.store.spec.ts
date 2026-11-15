import { awardToRow, isUniqueViolation, MemoryWearableXpAwardStore, rowToAward } from './wearableXpAward.store';

describe('wearable XP award store', () => {
  it('rejects a second insert of the same dedupe key and sums passive XP for the day', async () => {
    const store = new MemoryWearableXpAwardStore();
    const row = {
      userId: 'player-1',
      dedupeKey: 'wearable:sleep:2026-11-14',
      metric: 'sleep',
      awardDate: '2026-11-14',
      source: 'oura',
      activityType: 'recovery-wearable-sleep',
      className: 'Warrior',
      xpAwarded: 15,
    };
    await store.insert(row);
    await expect(store.insert(row)).rejects.toMatchObject({ code: '23505' });
    await store.insert({
      ...row,
      dedupeKey: 'wearable:steps:2026-11-14',
      metric: 'steps',
      xpAwarded: 10,
    });
    await store.insert({
      ...row,
      dedupeKey: 'wearable:hume-scan:2026-W46',
      metric: 'hume-scan',
      xpAwarded: 15,
    });
    expect(await store.passiveXpOnDate('player-1', '2026-11-14')).toBe(25);
    expect(await store.findByKey('player-1', 'wearable:sleep:2026-11-14')).toMatchObject({ xpAwarded: 15 });
    expect(isUniqueViolation(Object.assign(new Error('duplicate'), { code: '23505' }))).toBe(true);
  });

  it('maps the wearable_xp_awards columns and numeric strings', () => {
    const row = {
      userId: 'player-1',
      dedupeKey: 'wearable:steps:2026-11-14',
      metric: 'steps',
      awardDate: '2026-11-14',
      source: 'google-health',
      activityType: 'recovery-wearable-steps-10k',
      className: 'Warrior',
      xpAwarded: 10,
    };
    expect(Object.keys(awardToRow(row)).sort()).toEqual([
      'activity_type',
      'award_date',
      'class_name',
      'dedupe_key',
      'metric',
      'source',
      'user_id',
      'xp_awarded',
    ]);
    expect(rowToAward({ ...awardToRow(row), xp_awarded: '10', award_date: '2026-11-14T00:00:00.000Z' })).toMatchObject({
      xpAwarded: 10,
      awardDate: '2026-11-14',
      dedupeKey: 'wearable:steps:2026-11-14',
    });
  });
});
