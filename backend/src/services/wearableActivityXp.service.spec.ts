const mockGetActivityLog = jest.fn();
const mockLogActivity = jest.fn();
const mockPersist = jest.fn();
const mockBodyStatuses = jest.fn();

jest.mock('./data/dataService', () => ({
  getDataService: () => ({
    getActivityLog: (...a: unknown[]) => mockGetActivityLog(...a),
    logActivity: (...a: unknown[]) => mockLogActivity(...a),
  }),
}));
jest.mock('./xpAward.service', () => ({
  ...jest.requireActual('./xpAward.service'),
  persistClassXpAwards: (...a: unknown[]) => mockPersist(...a),
}));
jest.mock('./bodyStatus.service', () => ({
  getActiveBodyStatuses: (...a: unknown[]) => mockBodyStatuses(...a),
}));

import {
  awardWearableActivities,
  classifyWearableActivity,
  wearableSessionXp,
  zoneOffset,
} from './wearableActivityXp.service';

const NOW = new Date('2026-10-22T21:00:00.000Z');

describe('classifyWearableActivity', () => {
  it.each([
    ['Walk', 'workout-cardio'],
    ['Run', 'workout-cardio'],
    ['Swim', 'workout-cardio'],
    ['Sport', 'workout-cardio'],
    ['Aerobic Workout', 'workout-cardio'],
    ['Weights', 'workout-strength'],
    ['Strength training', 'workout-strength'],
    ['Yoga', 'workout-mobility'],
    ['Martial Arts', 'workout-mma'],
    ['Kickboxing', 'workout-mma'],
  ])('%s → %s', (name, type) => {
    expect(classifyWearableActivity(name)).toBe(type);
  });
});

describe('wearableSessionXp uses the engine workout rates', () => {
  it('cardio = 15 + floor(min × 0.15)', () => {
    expect(wearableSessionXp({ name: 'Sport', durationMin: 45 })).toEqual({ activityType: 'workout-cardio', xp: 21 });
    expect(wearableSessionXp({ name: 'Walk', durationMin: 15 })).toEqual({ activityType: 'workout-cardio', xp: 17 });
  });
  it('mma = 15 + floor(min × 0.2)', () => {
    expect(wearableSessionXp({ name: 'Martial Arts', durationMin: 56 })).toEqual({ activityType: 'workout-mma', xp: 26 });
  });
});

describe('zoneOffset', () => {
  it('handles CDT and CST', () => {
    expect(zoneOffset('2026-10-13', '18:03')).toBe('-05:00');
    expect(zoneOffset('2026-11-10', '18:03')).toBe('-06:00');
  });
});

describe('awardWearableActivities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActivityLog.mockResolvedValue([]);
    mockLogActivity.mockResolvedValue(undefined);
    mockPersist.mockResolvedValue([]);
    mockBodyStatuses.mockResolvedValue([]);
  });

  const oct13 = [
    { name: 'Sport', durationMin: 45, calories: 459, startTime: '18:03', sourceId: '111' },
    { name: 'Aerobic Workout', durationMin: 11, calories: 80, startTime: '18:51' },
    { name: 'Sport', durationMin: 19, calories: 184, startTime: '19:54' },
  ];

  it('logs each session on its own day and credits Warrior XP', async () => {
    const r = await awardWearableActivities('u1', '2026-10-13', 'fitbit', oct13, NOW);

    expect(r.totalXp).toBe(21 + 16 + 17);
    expect(r.awarded.map(a => a.xp)).toEqual([21, 16, 17]);
    expect(mockGetActivityLog).toHaveBeenCalledWith('u1', 200, '2026-10-13');
    expect(mockLogActivity).toHaveBeenCalledTimes(3);
    const first = mockLogActivity.mock.calls[0][1];
    expect(first).toMatchObject({ activity_type: 'workout-cardio', class_name: 'Warrior', xp_awarded: 21 });
    expect(first.notes).toContain('[wearable:2026-10-13T18:03]');
    expect(first.notes).toContain('[wearable-id:fitbit:111]');
    expect(first.logged_at).toBe('2026-10-13T23:03:00.000Z');
    // 19:54 CDT is already Oct 14 UTC → anchored at noon UTC on the civil day.
    expect(mockLogActivity.mock.calls[2][1].logged_at).toBe('2026-10-13T12:00:00.000Z');
    expect(mockPersist).toHaveBeenCalledWith('u1', [{ className: 'Warrior', xp: 21 }]);
  });

  it('does not double-award on a re-read', async () => {
    mockGetActivityLog.mockResolvedValue([
      { activity_type: 'workout-cardio', class_name: 'Warrior', notes: '[wearable:2026-10-13T18:03] Wearable (fitbit): Sport 45min' },
      { activity_type: 'workout-cardio', class_name: 'Warrior', notes: '[wearable:2026-10-13T18:51] Wearable (fitbit): Aerobic' },
    ]);
    const r = await awardWearableActivities('u1', '2026-10-13', 'fitbit', oct13, NOW);
    expect(r.awarded.map(a => a.name)).toEqual(['Sport']);
    expect(r.awarded[0].durationMin).toBe(19);
    expect(r.skipped.filter(s => s.reason === 'already_awarded')).toHaveLength(2);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
  });

  it('dedupes by provider id even if the start time shifts', async () => {
    mockGetActivityLog.mockResolvedValue([{ activity_type: 'workout-cardio', class_name: 'Warrior', notes: '[wearable:2026-10-13T18:02] [wearable-id:fitbit:111] x' }]);
    const r = await awardWearableActivities('u1', '2026-10-13', 'fitbit', [oct13[0]], NOW);
    expect(r.awarded).toHaveLength(0);
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it('two overlapping syncs award once', async () => {
    const written: Array<{ notes: string }> = [];
    mockGetActivityLog.mockImplementation(async () => written.map(w => ({ ...w })));
    mockLogActivity.mockImplementation(async (_u: string, row: { notes: string }) => { written.push(row); });
    const [a, b] = await Promise.all([
      awardWearableActivities('u1', '2026-10-13', 'fitbit', oct13, NOW),
      awardWearableActivities('u1', '2026-10-13', 'fitbit', oct13, NOW),
    ]);
    expect(a.totalXp + b.totalXp).toBe(54);
    expect(mockLogActivity).toHaveBeenCalledTimes(3);
  });

  it('applies the same body-status penalty as manual logging', async () => {
    mockBodyStatuses.mockResolvedValue([{ impacts_actions: ['workout-cardio'], xp_penalty: 50 }]);
    const r = await awardWearableActivities('u1', '2026-10-13', 'fitbit', [oct13[0]], NOW);
    expect(r.totalXp).toBe(11); // round(21 × 0.5)
  });

  it('skips zero-length sessions and days outside the 90-day backfill window', async () => {
    const r = await awardWearableActivities('u1', '2026-06-01', 'fitbit', [
      { name: 'Walk', durationMin: 20, calories: 100, startTime: '09:00' },
    ], NOW);
    expect(r.skipped[0].reason).toBe('outside_window');
    const z = await awardWearableActivities('u1', '2026-10-13', 'fitbit', [
      { name: 'Walk', durationMin: 0, calories: 0, startTime: '09:00' },
    ], NOW);
    expect(z.skipped[0].reason).toBe('no_duration');
    expect(mockLogActivity).not.toHaveBeenCalled();
  });
});
