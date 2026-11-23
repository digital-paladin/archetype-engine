import {
  OBJECTIVES_COLLAPSED_KEY,
  OBJECTIVES_QUEST_CAP,
  buildObjectivesView,
  groupTrackerQuests,
  hydrationGoalForReading,
  isAwaitingTurnIn,
  liveCounterLines,
  metricsFromFoodAndVitals,
  objectiveCounterLines,
  proteinGoalFromWeight,
  readCollapsedGroups,
  trackerGroup,
  writeCollapsedGroups,
  type TrackerQuestSource,
} from './objectives-tracker';

const TODAY = '2026-11-23';

function quest(partial: Partial<TrackerQuestSource> & Pick<TrackerQuestSource, 'id'>): TrackerQuestSource {
  return {
    kind: 'daily',
    status: 'active',
    hidden: false,
    title: 'Sample quest',
    scheduledFor: TODAY,
    objectives: [{ label: 'Sample step', progress: 0, target: 1, done: false }],
    ...partial,
  };
}

describe('tracker grouping', () => {
  it('keeps today\'s dailies, the active weekly, and boss quests, in that order', () => {
    const quests = [
      quest({ id: 'boss-1', kind: 'acquisition', title: 'BOSS: Sample Contract', scheduledFor: null }),
      quest({ id: 'weekly-1', kind: 'weekly', title: 'Sample week of walks', scheduledFor: null }),
      quest({ id: 'daily-old', kind: 'daily', title: 'Yesterday stretch', scheduledFor: '2026-11-22' }),
      quest({ id: 'daily-1', kind: 'daily', title: 'Sample stretch', scheduledFor: TODAY }),
      quest({ id: 'emergency-1', kind: 'emergency', title: 'Sample emergency', scheduledFor: TODAY }),
      quest({ id: 'cleared-1', kind: 'daily', status: 'cleared', title: 'Cleared stretch', scheduledFor: TODAY }),
      quest({ id: 'hidden-1', kind: 'daily', hidden: true, title: 'Sealed daily', scheduledFor: TODAY }),
      quest({ id: 'acquisition-1', kind: 'acquisition', title: 'Sample savings kit', scheduledFor: null }),
      quest({ id: 'boss-kind', kind: 'boss', title: 'Sample raid', scheduledFor: null }),
      quest({ id: 'weekly-title', kind: 'acquisition', title: 'WEEKLY: Sample budget', scheduledFor: null }),
    ];

    expect(groupTrackerQuests(quests, TODAY).map(item => item.id)).toEqual([
      'daily-1',
      'weekly-1',
      'weekly-title',
      'boss-1',
      'boss-kind',
    ]);
    expect(trackerGroup(quests[3], TODAY)).toBe('dailies');
    expect(trackerGroup(quest({ id: 'blank', title: '   ' }), TODAY)).toBeNull();
  });

  it('does not treat a non-boss acquisition as a boss', () => {
    expect(trackerGroup(quest({
      id: 'kit',
      kind: 'acquisition',
      title: 'Save for a sample kit',
      scheduledFor: null,
    }), TODAY)).toBeNull();
  });
});

describe('quest cap and expander', () => {
  const many = [
    ...Array.from({ length: 6 }, (_, index) => quest({
      id: `daily-${index}`,
      title: `Sample daily ${index}`,
    })),
    quest({ id: 'weekly-1', kind: 'weekly', title: 'Sample week', scheduledFor: null }),
    quest({ id: 'boss-1', kind: 'boss', title: 'BOSS: Sample', scheduledFor: null }),
  ];

  it('shows at most five quest lines and reports the rest', () => {
    const view = buildObjectivesView({ quests: many, today: TODAY });
    const shown = view.groups.flatMap(group => group.quests.map(item => item.id));
    expect(OBJECTIVES_QUEST_CAP).toBe(5);
    expect(shown).toEqual(['daily-0', 'daily-1', 'daily-2', 'daily-3', 'daily-4']);
    expect(view.hiddenCount).toBe(3);
    expect(view.showLess).toBe(false);
    expect(view.groups.map(group => group.id)).toEqual(['dailies', 'weekly', 'boss']);
    expect(view.groups.find(group => group.id === 'boss')?.quests).toEqual([]);
  });

  it('reveals every open quest after the expander is used', () => {
    const view = buildObjectivesView({ quests: many, today: TODAY, showAll: true });
    expect(view.hiddenCount).toBe(0);
    expect(view.showLess).toBe(true);
    expect(view.groups.flatMap(group => group.quests).map(item => item.id)).toEqual([
      'daily-0', 'daily-1', 'daily-2', 'daily-3', 'daily-4', 'daily-5', 'weekly-1', 'boss-1',
    ]);
  });

  it('does not count a collapsed group toward the cap', () => {
    const view = buildObjectivesView({
      quests: many,
      today: TODAY,
      collapsed: new Set(['dailies']),
    });
    expect(view.groups.find(group => group.id === 'dailies')).toMatchObject({ collapsed: true, quests: [] });
    expect(view.groups.flatMap(group => group.quests).map(item => item.id)).toEqual(['weekly-1', 'boss-1']);
    expect(view.hiddenCount).toBe(0);
  });

  it('omits empty groups', () => {
    const view = buildObjectivesView({
      quests: [quest({ id: 'daily-1', title: 'Sample stretch' })],
      today: TODAY,
    });
    expect(view.groups.map(group => group.label)).toEqual(['Dailies']);
    expect(view.empty).toBe(false);
  });
});

describe('turn-in marker', () => {
  it('marks an active quest whose objectives all look complete', () => {
    const ready = quest({
      id: 'ready',
      title: 'Sample turn-in',
      objectives: [
        { label: 'First sample step', progress: 1, target: 1, done: true },
        { label: 'Second sample step', progress: 3, target: 3, done: false },
      ],
    });
    expect(isAwaitingTurnIn(ready)).toBe(true);
    expect(groupTrackerQuests([ready], TODAY)[0].awaitingTurnIn).toBe(true);
  });

  it('stays off when a step remains, the quest is cleared, or it has no objectives', () => {
    expect(isAwaitingTurnIn(quest({
      id: 'open',
      objectives: [
        { label: 'Done step', progress: 1, target: 1, done: true },
        { label: 'Open step', progress: 0, target: 1, done: false },
      ],
    }))).toBe(false);
    expect(isAwaitingTurnIn(quest({
      id: 'cleared',
      status: 'cleared',
      objectives: [{ label: 'Done step', progress: 1, target: 1, done: true }],
    }))).toBe(false);
    expect(isAwaitingTurnIn(quest({ id: 'empty', objectives: [] }))).toBe(false);
    expect(isAwaitingTurnIn(quest({
      id: 'failed',
      status: 'failed',
      objectives: [{ label: 'Done step', done: true }],
    }))).toBe(false);
  });
});

describe('objective counter lines', () => {
  it('uses a numeric counter when an objective has a current and target value', () => {
    expect(objectiveCounterLines([
      { label: 'Sample spiders', progress: 0, target: 10 },
      { label: 'Sample husks', progress: 2, target: 8 },
    ])).toEqual([
      '0/10 Sample spiders',
      '2/8 Sample husks',
    ]);
  });

  it('falls back to the shared objective count when no objective has a numeric target', () => {
    expect(objectiveCounterLines([
      { label: 'One', done: true },
      { label: 'Two', done: false },
      { label: 'Three', done: false },
    ])).toEqual(['1/3 objectives']);
    expect(objectiveCounterLines([{ label: 'Only', done: false }])).toEqual(['0/1 objective']);
    expect(objectiveCounterLines([])).toEqual([]);
  });
});

describe('live counters', () => {
  it('shows protein and water only when both sides of the counter exist', () => {
    expect(proteinGoalFromWeight(50)).toBe(32);
    expect(hydrationGoalForReading(7)).toBe(100);
    expect(liveCounterLines(metricsFromFoodAndVitals(
      { totals: { protein: 12 } },
      { weight: 50, waterOz: 7 },
    ))).toEqual([
      'Protein 12 / 32 g',
      'Water 7 / 100 oz',
    ]);
  });

  it('hides a counter when its source data is missing', () => {
    expect(liveCounterLines(metricsFromFoodAndVitals(null, null))).toEqual([]);
    expect(liveCounterLines(metricsFromFoodAndVitals(
      { totals: { protein: 12 } },
      { waterOz: 7 },
    ))).toEqual(['Water 7 / 100 oz']);
    expect(liveCounterLines(metricsFromFoodAndVitals(
      { totals: { protein: 12 } },
      { weight: 50 },
    ))).toEqual(['Protein 12 / 32 g']);
    expect(liveCounterLines(metricsFromFoodAndVitals(
      { totals: {} },
      { weight: 50, waterOz: null },
    ))).toEqual([]);
    expect(proteinGoalFromWeight(null)).toBeNull();
    expect(proteinGoalFromWeight(0)).toBeNull();
    expect(hydrationGoalForReading(null)).toBeNull();
    expect(hydrationGoalForReading(undefined)).toBeNull();
    expect(liveCounterLines({
      proteinGrams: Number.NaN,
      proteinGoalGrams: 32,
      waterOz: -1,
      hydrationGoalOz: 100,
    })).toEqual([]);
  });

  it('keeps a zero reading when the log actually sent zero', () => {
    expect(liveCounterLines(metricsFromFoodAndVitals(
      { totals: { protein: 0 } },
      { weight: 50, waterOz: 0 },
    ))).toEqual([
      'Protein 0 / 32 g',
      'Water 0 / 100 oz',
    ]);
  });
});

describe('collapsed groups', () => {
  it('remembers only the known groups and ignores a bad store', () => {
    const store = new Map<string, string>();
    const memory = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    };
    writeCollapsedGroups(memory, new Set(['boss', 'dailies']));
    expect(store.get(OBJECTIVES_COLLAPSED_KEY)).toBe('["dailies","boss"]');
    expect(readCollapsedGroups(memory)).toEqual(new Set(['dailies', 'boss']));

    store.set(OBJECTIVES_COLLAPSED_KEY, '["weekly","nope",1]');
    expect(readCollapsedGroups(memory)).toEqual(new Set(['weekly']));
    store.set(OBJECTIVES_COLLAPSED_KEY, '{');
    expect(readCollapsedGroups(memory)).toEqual(new Set());
    expect(readCollapsedGroups(null)).toEqual(new Set());
  });
});
