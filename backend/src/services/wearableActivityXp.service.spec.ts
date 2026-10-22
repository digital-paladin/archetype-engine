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
  isAutoDetectedWalk,
  parseWearableOverrides,
  wearableQuestLine,
  wearableSessionXp,
  WearableOverrideError,
  zoneOffset,
} from './wearableActivityXp.service';

const NOW = new Date('2026-10-22T21:00:00.000Z');

describe('classifyWearableActivity', () => {
  it.each([
    ['Walk', 'workout-cardio'],
    ['Run', 'workout-cardio'],
    ['Swim', 'workout-cardio'],
    ['Sport', 'workout-cardio'],
    ['sport', 'workout-cardio'],
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
    expect(wearableSessionXp({ name: 'Aerobic Workout', durationMin: 11 })).toEqual({ activityType: 'workout-cardio', xp: 16 });
    expect(wearableSessionXp({ name: 'Walk', durationMin: 15 })).toEqual({ activityType: 'workout-cardio', xp: 17 });
  });
  it('Sport stays cardio; Martial Arts uses the mma rate 15 + floor(min × 0.2)', () => {
    expect(wearableSessionXp({ name: 'Sport', durationMin: 45 })).toEqual({ activityType: 'workout-cardio', xp: 21 });
    expect(wearableSessionXp({ name: 'Sport', durationMin: 19 })).toEqual({ activityType: 'workout-cardio', xp: 17 });
    expect(wearableSessionXp({ name: 'Sport', durationMin: 45, activityType: 'workout-mma' })).toEqual({ activityType: 'workout-mma', xp: 24 });
    expect(wearableSessionXp({ name: 'Martial Arts', durationMin: 56 })).toEqual({ activityType: 'workout-mma', xp: 26 });
  });
});

describe('parseWearableOverrides', () => {
  it('returns an empty list when overrides are omitted', () => {
    expect(parseWearableOverrides(undefined)).toEqual([]);
    expect(parseWearableOverrides(null)).toEqual([]);
  });

  it('rejects an activity type outside the engine workout rates', () => {
    expect(() => parseWearableOverrides([{ sourceId: '111', activityType: 'workout-sambo' }]))
      .toThrow(WearableOverrideError);
    expect(() => parseWearableOverrides('workout-mma')).toThrow(WearableOverrideError);
    expect(() => parseWearableOverrides([{ activityType: 'workout-mma' }])).toThrow(/sourceId or startTime/);
  });

  it('normalizes start time and strips brackets from the label', () => {
    expect(parseWearableOverrides([{
      startTime: '18:03:00',
      activityType: 'workout-mma',
      label: 'Toggl: [Sambo]',
    }])).toEqual([{
      sourceId: undefined,
      startTime: '18:03',
      activityType: 'workout-mma',
      label: 'Toggl: Sambo',
    }]);
  });
});

describe('wearableQuestLine', () => {
  it('puts the override label on the matched session', () => {
    const line = wearableQuestLine(
      { name: 'Sport', durationMin: 45, calories: 459, startTime: '18:03', sourceId: '111' },
      [{ sourceId: '111', activityType: 'workout-mma', label: 'Toggl: Sambo' }],
    );
    expect(line).toBe('Sport (Toggl: Sambo) 45min (459 cal @ 18:03)');
  });
});

describe('isAutoDetectedWalk', () => {
  it('skips auto_detected walks and short walks with no log type', () => {
    expect(isAutoDetectedWalk({ name: 'Walk', durationMin: 45, logType: 'auto_detected' })).toBe(true);
    expect(isAutoDetectedWalk({ name: 'Walk', durationMin: 12 })).toBe(true);
    expect(isAutoDetectedWalk({ name: 'Walk', durationMin: 29, logType: '  ' })).toBe(true);
  });

  it('keeps hand-logged walks and a 30 minute walk when log type is missing', () => {
    expect(isAutoDetectedWalk({ name: 'Walk', durationMin: 10, logType: 'manual' })).toBe(false);
    expect(isAutoDetectedWalk({ name: 'Walk', durationMin: 10, logType: 'tracker' })).toBe(false);
    expect(isAutoDetectedWalk({ name: 'Walk', durationMin: 30 })).toBe(false);
    expect(isAutoDetectedWalk({ name: 'Sport', durationMin: 12, logType: 'auto_detected' })).toBe(false);
    expect(isAutoDetectedWalk({ name: 'Aerobic Workout', durationMin: 11 })).toBe(false);
  });
});

describe('zoneOffset', () => {
  it('handles CDT and CST', () => {
    expect(zoneOffset('2026-10-13', '18:03')).toBe('-05:00');
    expect(zoneOffset('2026-11-10', '18:03')).toBe('-06:00');
  });

  it('uses the offset after a DST transition, not the UTC-clock guess', () => {
    // 2026-03-08 02:00 CST springs forward to 03:00 CDT. 03:30 is CDT.
    expect(zoneOffset('2026-03-08', '03:30')).toBe('-05:00');
    // 2026-11-01 02:00 CDT falls back to 01:00 CST. 02:00 is CST.
    expect(zoneOffset('2026-11-01', '02:00')).toBe('-06:00');
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
    expect(r.awarded.map(a => a.activityType)).toEqual(['workout-cardio', 'workout-cardio', 'workout-cardio']);
    expect(r.awarded.map(a => a.xp)).toEqual([21, 16, 17]);
    expect(mockGetActivityLog).toHaveBeenCalledWith('u1', 1000, '2026-10-13');
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
    expect(r.totalXp).toBe(11); // round(21 × 0.5) on Sport → workout-cardio
  });

  it('skips zero-length sessions and days outside the 90-day backfill window', async () => {
    const r = await awardWearableActivities('u1', '2026-06-01', 'fitbit', [
      { name: 'Run', durationMin: 20, calories: 100, startTime: '09:00' },
    ], NOW);
    expect(r.skipped[0].reason).toBe('outside_window');
    const z = await awardWearableActivities('u1', '2026-10-13', 'fitbit', [
      { name: 'Walk', durationMin: 0, calories: 0, startTime: '09:00' },
    ], NOW);
    expect(z.skipped[0].reason).toBe('no_duration');
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it('awards two sessions that share a start minute when their provider ids differ', async () => {
    const sessions = [
      { name: 'Walk', durationMin: 20, calories: 100, startTime: '18:03', sourceId: '111', logType: 'manual' },
      { name: 'Sport', durationMin: 45, calories: 400, startTime: '18:03', sourceId: '222' },
    ];
    const r = await awardWearableActivities('u1', '2026-10-13', 'fitbit', sessions, NOW);
    expect(r.awarded.map(a => a.name)).toEqual(['Walk', 'Sport']);
    expect(r.awarded.map(a => a.activityType)).toEqual(['workout-cardio', 'workout-cardio']);
    expect(mockLogActivity).toHaveBeenCalledTimes(2);
    expect(r.totalXp).toBe(18 + 21);
  });

  it('normalizes HH:MM:SS onto the same slot as HH:MM', async () => {
    const r = await awardWearableActivities('u1', '2026-10-13', 'fitbit', [
      { name: 'Sport', durationMin: 45, calories: 459, startTime: '18:03:00', sourceId: '111' },
    ], NOW);
    expect(r.awarded).toHaveLength(1);
    const row = mockLogActivity.mock.calls[0][1];
    expect(row.logged_at).toBe('2026-10-13T23:03:00.000Z');
    expect(row.notes).toContain('[wearable:2026-10-13T18:03]');
    expect(row.notes).toContain('[wearable-id:fitbit:111]');
  });

  it('strips brackets from a provider id so the tag still round-trips', async () => {
    const r = await awardWearableActivities('u1', '2026-10-13', 'google', [
      { name: 'Run', durationMin: 30, calories: 200, startTime: '08:00', sourceId: 'points/abc]def' },
    ], NOW);
    expect(r.awarded).toHaveLength(1);
    const notes = mockLogActivity.mock.calls[0][1].notes as string;
    expect(notes).toContain('[wearable-id:google:points/abcdef]');
    mockGetActivityLog.mockResolvedValue([{ activity_type: 'workout-cardio', class_name: 'Warrior', notes }]);
    const again = await awardWearableActivities('u1', '2026-10-13', 'google', [
      { name: 'Run', durationMin: 30, calories: 200, startTime: '08:05', sourceId: 'points/abc]def' },
    ], NOW);
    expect(again.awarded).toHaveLength(0);
    expect(again.skipped[0].reason).toBe('already_awarded');
  });

  it('skips a future day and an unparseable clock without writing', async () => {
    const future = await awardWearableActivities('u1', '2026-10-23', 'fitbit', [
      { name: 'Run', durationMin: 20, calories: 80, startTime: '09:00' },
    ], NOW);
    expect(future.skipped[0].reason).toBe('future');
    expect(future.skipped[0].name).toBe('Run');
    const bad = await awardWearableActivities('u1', '2026-10-13', 'fitbit', [
      { name: 'Run', durationMin: 20, calories: 80, startTime: 'not-a-time' },
    ], NOW);
    expect(bad.skipped[0].reason).toBe('invalid_time');
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it('does not log or award an auto-detected walk, and still awards Sport at the cardio rate', async () => {
    const r = await awardWearableActivities('u1', '2026-10-13', 'fitbit', [
      { name: 'Walk', durationMin: 40, calories: 180, startTime: '07:10', sourceId: 'w-auto', logType: 'auto_detected' },
      { name: 'Walk', durationMin: 12, calories: 40, startTime: '12:00', sourceId: 'w-short' },
      { name: 'Walk', durationMin: 15, calories: 70, startTime: '17:00', sourceId: 'w-hand', logType: 'manual' },
      { name: 'Aerobic Workout', durationMin: 11, calories: 80, startTime: '18:51' },
      { name: 'Sport', durationMin: 45, calories: 459, startTime: '18:03', sourceId: '111', logType: 'tracker' },
    ], NOW);

    expect(r.skipped.map(s => ({ name: s.name, reason: s.reason }))).toEqual([
      { name: 'Walk', reason: 'auto_walk' },
      { name: 'Walk', reason: 'auto_walk' },
    ]);
    expect(r.awarded.map(a => ({ name: a.name, activityType: a.activityType, xp: a.xp }))).toEqual([
      { name: 'Walk', activityType: 'workout-cardio', xp: 17 },
      { name: 'Aerobic Workout', activityType: 'workout-cardio', xp: 16 },
      { name: 'Sport', activityType: 'workout-cardio', xp: 21 },
    ]);
    expect(mockLogActivity).toHaveBeenCalledTimes(3);
    expect(mockLogActivity.mock.calls.map(call => call[1].notes as string).join('\n')).not.toContain('07:10');
    expect(mockLogActivity.mock.calls.map(call => call[1].notes as string).join('\n')).not.toContain('12:00');
    expect(mockPersist).toHaveBeenCalledTimes(3);
  });

  it('types a Sport session from a sourceId override and does not award it again on re-sync', async () => {
    const session = [{ name: 'Sport', durationMin: 45, calories: 459, startTime: '18:03', sourceId: '111', logType: 'tracker' }];
    const overrides = [{ sourceId: '111', activityType: 'workout-mma' as const, label: 'Toggl: Sambo' }];
    const first = await awardWearableActivities('u1', '2026-10-13', 'fitbit', session, { now: NOW, overrides });

    expect(first.awarded).toEqual([
      expect.objectContaining({ name: 'Sport (Toggl: Sambo)', activityType: 'workout-mma', durationMin: 45, xp: 24 }),
    ]);
    const notes = mockLogActivity.mock.calls[0][1].notes as string;
    expect(notes).toContain('Sport (Toggl: Sambo)');
    expect(notes).toContain('[wearable-id:fitbit:111]');
    expect(notes).toContain('[wearable:2026-10-13T18:03]');

    mockGetActivityLog.mockResolvedValue([{ activity_type: 'workout-mma', class_name: 'Warrior', notes }]);
    const second = await awardWearableActivities('u1', '2026-10-13', 'fitbit', session, { now: NOW, overrides });
    expect(second.awarded).toHaveLength(0);
    expect(second.totalXp).toBe(0);
    expect(second.skipped[0].reason).toBe('already_awarded');
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
  });

  it('prefers a sourceId override over a start-time override for the same minute', async () => {
    const r = await awardWearableActivities('u1', '2026-10-13', 'fitbit', [oct13[0]], {
      now: NOW,
      overrides: [
        { startTime: '18:03', activityType: 'workout-strength', label: 'Toggl: Lift' },
        { sourceId: '111', activityType: 'workout-mma', label: 'Toggl: Sambo' },
      ],
    });
    expect(r.awarded[0]).toMatchObject({ name: 'Sport (Toggl: Sambo)', activityType: 'workout-mma', xp: 24 });
  });

  it('applies a start-time override when no override names that session sourceId', async () => {
    const r = await awardWearableActivities('u1', '2026-10-13', 'fitbit', [
      { name: 'Sport', durationMin: 45, calories: 459, startTime: '18:03:00', sourceId: '999' },
    ], {
      now: NOW,
      overrides: [{ startTime: '18:03', activityType: 'workout-mma', label: 'Toggl: Sambo' }],
    });
    expect(r.awarded[0]).toMatchObject({ name: 'Sport (Toggl: Sambo)', activityType: 'workout-mma', xp: 24 });
  });

  it('does not attach an override that names a different sourceId to another session at that minute', async () => {
    const r = await awardWearableActivities('u1', '2026-10-13', 'fitbit', [
      { name: 'Sport', durationMin: 45, calories: 459, startTime: '18:03', sourceId: '222' },
    ], {
      now: NOW,
      overrides: [{ sourceId: '111', startTime: '18:03', activityType: 'workout-mma', label: 'Toggl: Sambo' }],
    });
    expect(r.awarded[0]).toMatchObject({ name: 'Sport', activityType: 'workout-cardio', xp: 21 });
    expect(mockLogActivity.mock.calls[0][1].notes).not.toContain('Sambo');
  });

  it('does not award an auto-detected walk when an override names it', async () => {
    const r = await awardWearableActivities('u1', '2026-10-13', 'fitbit', [
      { name: 'Walk', durationMin: 40, calories: 180, startTime: '07:10', sourceId: 'w-auto', logType: 'auto_detected' },
    ], {
      now: NOW,
      overrides: [{ sourceId: 'w-auto', activityType: 'workout-mma', label: 'Toggl: Sambo' }],
    });
    expect(r.awarded).toHaveLength(0);
    expect(r.skipped[0].reason).toBe('auto_walk');
    expect(mockLogActivity).not.toHaveBeenCalled();
  });
});
