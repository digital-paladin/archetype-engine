import { TestBed } from '@angular/core/testing';
import { LevelProgressionService } from './level-progression.service';
import {
  chicagoDate,
  formatXpToNextLevel,
  isDoneForToday,
  objectiveIsDone,
  questObjectiveProgress,
  xpRemaining,
} from './quest-progress';

describe('questObjectiveProgress', () => {
  it('reads a multi-objective quest as completed of total', () => {
    const progress = questObjectiveProgress([
      { done: true, progress: 1, target: 1 },
      { done: true, progress: 1, target: 1 },
      { done: false, progress: 0, target: 1 },
    ]);
    expect(progress.completed).toBe(2);
    expect(progress.total).toBe(3);
    expect(progress.percent).toBe(67);
    expect(progress.label).toBe('2 of 3 objectives');
    expect(progress.nearMiss).toBe(true);
    expect(progress.nearMissLabel).toBe('1 step to clear');
  });

  it('uses the singular when the quest has one objective', () => {
    const progress = questObjectiveProgress([{ done: false, progress: 5, target: 20 }]);
    expect(progress.label).toBe('0 of 1 objective');
    expect(progress.percent).toBe(0);
    expect(progress.nearMiss).toBe(true);
  });

  it('does not treat a partial objective as complete', () => {
    const progress = questObjectiveProgress([
      { done: false, progress: 19, target: 20 },
      { done: false, progress: 0, target: 1 },
    ]);
    expect(progress.completed).toBe(0);
    expect(progress.label).toBe('0 of 2 objectives');
    expect(progress.nearMiss).toBe(false);
    expect(progress.nearMissLabel).toBeNull();
  });

  it('counts an objective whose progress has reached its target', () => {
    expect(objectiveIsDone({ done: false, progress: 20, target: 20 })).toBe(true);
    const progress = questObjectiveProgress([
      { done: false, progress: 20, target: 20 },
      { done: true, progress: 1, target: 1 },
      { done: false, progress: 0, target: 1 },
    ]);
    expect(progress.label).toBe('2 of 3 objectives');
    expect(progress.nearMiss).toBe(true);
  });

  it('trusts a done flag even when the counter is still zero', () => {
    expect(objectiveIsDone({ done: true, progress: 0, target: 5 })).toBe(true);
  });

  it('has no near-miss when the quest is cleared or more than one step remains', () => {
    expect(questObjectiveProgress([
      { done: true },
      { done: true },
      { done: true },
    ]).nearMiss).toBe(false);
    expect(questObjectiveProgress([
      { done: true },
      { done: false },
      { done: false },
    ]).nearMiss).toBe(false);
  });

  it('returns an empty reading for a quest with no objectives', () => {
    const progress = questObjectiveProgress([]);
    expect(progress).toEqual({
      completed: 0,
      total: 0,
      percent: 0,
      label: '0 of 0 objectives',
      nearMiss: false,
      nearMissLabel: null,
    });
    expect(questObjectiveProgress(null).total).toBe(0);
  });
});

describe('isDoneForToday', () => {
  const today = '2026-11-21';

  it('is done when every daily quest scheduled for that day is cleared', () => {
    expect(isDoneForToday([
      { kind: 'daily', status: 'cleared', scheduledFor: today },
      { kind: 'daily', status: 'cleared', scheduledFor: today },
      { kind: 'acquisition', status: 'active', scheduledFor: null },
    ], today)).toBe(true);
  });

  it('is not done when a daily quest for that day is still active', () => {
    expect(isDoneForToday([
      { kind: 'daily', status: 'cleared', scheduledFor: today },
      { kind: 'daily', status: 'active', scheduledFor: today },
    ], today)).toBe(false);
  });

  it('ignores dailies scheduled for another day and quests that are not daily', () => {
    expect(isDoneForToday([
      { kind: 'daily', status: 'cleared', scheduledFor: '2026-11-20' },
      { kind: 'emergency', status: 'active', scheduledFor: today },
      { kind: 'daily', status: 'cleared', scheduledFor: null },
    ], today)).toBe(false);
  });

  it('is not done when a daily quest for that day failed', () => {
    expect(isDoneForToday([
      { kind: 'daily', status: 'failed', scheduledFor: today },
    ], today)).toBe(false);
  });

  it('is not done when the day has no daily quests', () => {
    expect(isDoneForToday([], today)).toBe(false);
  });
});

describe('chicagoDate', () => {
  it('uses the America/Chicago civil date across midnight UTC', () => {
    // 05:30 UTC is still the previous evening in Chicago (CST, UTC−6).
    expect(chicagoDate(new Date('2026-11-22T05:30:00.000Z'))).toBe('2026-11-21');
    // 06:30 UTC is 00:30 in Chicago, the next civil day.
    expect(chicagoDate(new Date('2026-11-22T06:30:00.000Z'))).toBe('2026-11-22');
  });

  it('uses the Chicago date during daylight time', () => {
    // 04:30 UTC is 23:30 the previous evening in Chicago (CDT, UTC−5).
    expect(chicagoDate(new Date('2026-07-15T04:30:00.000Z'))).toBe('2026-07-14');
  });
});

describe('XP to next level', () => {
  let service: LevelProgressionService;

  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => store[key] ?? null);
    vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      store[key] = value;
    });
    TestBed.configureTestingModule({});
    service = TestBed.inject(LevelProgressionService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('subtracts current XP from the threshold it is given', () => {
    expect(xpRemaining(250, 1000)).toBe(750);
    expect(formatXpToNextLevel(8, 250, 1000)).toBe('750 XP to level 9');
  });

  it('reports zero when current XP has already reached the threshold', () => {
    expect(xpRemaining(1000, 1000)).toBe(0);
    expect(xpRemaining(1500, 1000)).toBe(0);
    expect(formatXpToNextLevel(8, 1000, 1000)).toBe('0 XP to level 9');
  });

  it('reuses LevelProgressionService.calculateXPForLevel for that curve', () => {
    const level = 20;
    const current = 100;
    const threshold = service.calculateXPForLevel(level + 1);
    expect(service.xpRemainingToNextLevel(level, current)).toBe(threshold - current);
    expect(formatXpToNextLevel(level, 0, service.xpRemainingToNextLevel(level, 0))).toBe(
      `${threshold.toLocaleString('en-US')} XP to level ${level + 1}`,
    );
    expect(formatXpToNextLevel(level, current, threshold)).toBe(
      `${(threshold - current).toLocaleString('en-US')} XP to level ${level + 1}`,
    );
  });

  it('keeps a stats-source threshold instead of swapping in the service curve', () => {
    const level = 4;
    const current = 10;
    const statsThreshold = service.calculateXPForLevel(level + 1) + 500;
    expect(service.xpRemainingToNextLevel(level, current)).toBe(service.calculateXPForLevel(level + 1) - current);
    expect(xpRemaining(current, statsThreshold)).toBe(statsThreshold - current);
    expect(formatXpToNextLevel(level, current, statsThreshold)).toBe(
      `${(statsThreshold - current).toLocaleString('en-US')} XP to level ${level + 1}`,
    );
  });
});
