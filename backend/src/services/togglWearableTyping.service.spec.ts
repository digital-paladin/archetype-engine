import { fetchTogglEntriesForChicagoDay } from './togglTrack.service';
import type { TogglTimeEntry } from './togglTrack.service';
import {
  loadTogglSportOverrides,
  togglOverridesForSportSessions,
} from './togglWearableTyping.service';

jest.mock('./togglTrack.service', () => {
  const actual = jest.requireActual('./togglTrack.service');
  return {
    ...actual,
    fetchTogglEntriesForChicagoDay: jest.fn(),
  };
});

const fetchEntries = fetchTogglEntriesForChicagoDay as jest.MockedFunction<typeof fetchTogglEntriesForChicagoDay>;

const NOW = new Date('2026-10-14T16:00:00Z');

function entry(partial: Partial<TogglTimeEntry> & Pick<TogglTimeEntry, 'id' | 'start' | 'stop'>): TogglTimeEntry {
  return {
    description: '',
    projectName: null,
    tags: [],
    duration: 3600,
    ...partial,
  };
}

const sport = {
  name: 'Sport',
  durationMin: 45,
  calories: 459,
  startTime: '18:03',
  sourceId: '111',
  logType: 'tracker',
};

describe('togglOverridesForSportSessions', () => {
  it('types Sport from the Toggl project with the greatest overlap', () => {
    const overrides = togglOverridesForSportSessions('2026-10-13', [sport], [], [
      entry({
        id: 'sambo',
        projectName: 'Sambo',
        start: '2026-10-13T23:00:00Z',
        stop: '2026-10-13T23:50:00Z',
        duration: 3000,
      }),
      entry({
        id: 'lift',
        projectName: 'Lifting',
        start: '2026-10-13T22:30:00Z',
        stop: '2026-10-13T23:10:00Z',
        duration: 2400,
      }),
    ], NOW);

    expect(overrides).toEqual([{
      sourceId: '111',
      startTime: '18:03',
      activityType: 'workout-mma',
      label: 'Toggl: Sambo',
    }]);
  });

  it('falls back to cardio when the greatest overlap is unmapped, even if a smaller overlap maps', () => {
    const overrides = togglOverridesForSportSessions('2026-10-13', [sport], [], [
      entry({
        id: 'email',
        projectName: 'Email',
        tags: ['inbox'],
        start: '2026-10-13T22:00:00Z',
        stop: '2026-10-14T01:00:00Z',
        duration: 10800,
      }),
      entry({
        id: 'sambo',
        projectName: 'Sambo',
        start: '2026-10-13T23:40:00Z',
        stop: '2026-10-13T23:50:00Z',
        duration: 600,
      }),
    ], NOW);
    expect(overrides).toEqual([]);
  });

  it('does not type a session an explicit override already matches', () => {
    const activities = [
      sport,
      { name: 'Sport', durationMin: 30, calories: 200, startTime: '12:00', sourceId: '222' },
      { name: 'Aerobic Workout', durationMin: 11, calories: 80, startTime: '18:51' },
    ];
    const explicit = [{ sourceId: '111', activityType: 'workout-strength' as const, label: 'Owner' }];
    const overrides = togglOverridesForSportSessions('2026-10-13', activities, explicit, [
      entry({
        id: 'sambo',
        projectName: 'Sambo',
        start: '2026-10-13T17:00:00Z',
        stop: '2026-10-14T01:00:00Z',
        duration: 8 * 3600,
      }),
    ], NOW);

    expect(overrides).toEqual([{
      sourceId: '222',
      startTime: '12:00',
      activityType: 'workout-mma',
      label: 'Toggl: Sambo',
    }]);
  });

  it('uses a tag when the project name does not map, and ignores a non-Sport session', () => {
    const overrides = togglOverridesForSportSessions('2026-10-13', [
      { name: 'Walk', durationMin: 45, calories: 100, startTime: '18:03', sourceId: 'walk', logType: 'manual' },
      { name: ' sport ', durationMin: 45, calories: 459, startTime: '18:03', sourceId: '111' },
    ], [], [
      entry({
        id: 'tag',
        projectName: 'Training',
        tags: ['BJJ'],
        start: '2026-10-13T23:00:00Z',
        stop: '2026-10-14T00:00:00Z',
      }),
    ], NOW);
    expect(overrides).toEqual([{
      sourceId: '111',
      startTime: '18:03',
      activityType: 'workout-mma',
      label: 'Toggl: BJJ',
    }]);
  });

  it('on an equal overlap, prefers the entry that maps', () => {
    const overrides = togglOverridesForSportSessions('2026-10-13', [sport], [], [
      entry({
        id: 'email',
        projectName: 'Email',
        start: '2026-10-13T23:03:00Z',
        stop: '2026-10-13T23:48:00Z',
        duration: 45 * 60,
      }),
      entry({
        id: 'yoga',
        projectName: 'Yoga',
        start: '2026-10-13T23:03:00Z',
        stop: '2026-10-13T23:48:00Z',
        duration: 45 * 60,
      }),
    ], NOW);
    expect(overrides[0]).toMatchObject({ activityType: 'workout-mobility', label: 'Toggl: Yoga' });
  });
});

describe('loadTogglSportOverrides', () => {
  let warn: jest.SpyInstance;
  const originalToken = process.env.TOGGL_API_TOKEN;

  beforeEach(() => {
    fetchEntries.mockReset();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.TOGGL_API_TOKEN = 'super-secret-toggl-token';
  });

  afterEach(() => {
    warn.mockRestore();
    if (originalToken === undefined) delete process.env.TOGGL_API_TOKEN;
    else process.env.TOGGL_API_TOKEN = originalToken;
  });

  it('does not call Toggl when every Sport session already has an explicit override', async () => {
    const overrides = await loadTogglSportOverrides('2026-10-13', [sport], [
      { sourceId: '111', activityType: 'workout-mma', label: 'Toggl: Sambo' },
    ], NOW);
    expect(overrides).toEqual([]);
    expect(fetchEntries).not.toHaveBeenCalled();
  });

  it('returns the mapped override from a mocked Toggl response', async () => {
    fetchEntries.mockResolvedValue([
      entry({
        id: 'sambo',
        projectName: 'Sambo',
        start: '2026-10-13T23:00:00Z',
        stop: '2026-10-14T00:00:00Z',
      }),
    ]);
    const overrides = await loadTogglSportOverrides('2026-10-13', [sport], [], NOW);
    expect(fetchEntries).toHaveBeenCalledWith('2026-10-13', NOW);
    expect(overrides[0]).toMatchObject({ activityType: 'workout-mma', label: 'Toggl: Sambo' });
  });

  it('keeps cardio when Toggl is unreachable and does not throw or log the token', async () => {
    fetchEntries.mockRejectedValue(new Error('connect failed for user super-secret-toggl-token'));
    const overrides = await loadTogglSportOverrides('2026-10-13', [sport], [], NOW);
    expect(overrides).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain('super-secret-toggl-token');
    expect(String(warn.mock.calls[0][0])).toContain('[redacted]');
    expect(String(warn.mock.calls[0][0])).toMatch(/stay workout-cardio/);
  });

  it('does not call the network when the token is unset', async () => {
    delete process.env.TOGGL_API_TOKEN;
    fetchEntries.mockImplementation((...args: unknown[]) =>
      jest.requireActual('./togglTrack.service').fetchTogglEntriesForChicagoDay(...args));
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const realFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const overrides = await loadTogglSportOverrides('2026-10-13', [sport], [], NOW);
      expect(overrides).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(info.mock.calls.map(call => String(call[0])).join('\n')).toMatch(/TOGGL_API_TOKEN is unset/);
    } finally {
      global.fetch = realFetch;
      info.mockRestore();
    }
  });
});
