const mockGoogle = {
  isConfigured: jest.fn(),
  hasTokens: jest.fn(),
  getActivities: jest.fn(),
  getFoodLog: jest.fn(),
  getVitals: jest.fn(),
  getSleepData: jest.fn(),
};
const mockFitbit = {
  isConfigured: jest.fn(),
  getActivities: jest.fn(),
  getFoodLog: jest.fn(),
  getVitals: jest.fn(),
  getSleepData: jest.fn(),
};
const mockGetJournal = jest.fn();
const mockUpsertJournal = jest.fn();
const mockGetQuests = jest.fn();
const mockUpsertQuest = jest.fn();

jest.mock('../services/googleHealth.service', () => ({
  GoogleHealthService: jest.fn().mockImplementation(() => mockGoogle),
}));
jest.mock('../services/fitbit.service', () => ({
  FitbitService: jest.fn().mockImplementation(() => mockFitbit),
}));
jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    getJournalEntry: (...args: unknown[]) => mockGetJournal(...args),
    upsertJournalEntry: (...args: unknown[]) => mockUpsertJournal(...args),
    getQuestEntries: (...args: unknown[]) => mockGetQuests(...args),
    upsertQuestEntry: (...args: unknown[]) => mockUpsertQuest(...args),
  }),
}));
const mockAwardWearable = jest.fn();
const mockLoadToggl = jest.fn();
jest.mock('../services/togglWearableTyping.service', () => ({
  loadTogglSportOverrides: (...args: unknown[]) => mockLoadToggl(...args),
}));
jest.mock('../services/wearableActivityXp.service', () => {
  const actual = jest.requireActual('../services/wearableActivityXp.service');
  return {
    ...actual,
    awardWearableActivities: (...args: unknown[]) => mockAwardWearable(...args),
  };
});
jest.mock('../services/sleepDebt.service', () => ({
  syncSleepDebtFromJournalSafe: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../middleware/auth.middleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 'user-1';
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import router from './fitbit.routes';

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/fitbit', router);
  return server;
}

describe('fitbit routes provider switch', () => {
  const original = process.env.FITBIT_DATA_SOURCE;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetJournal.mockResolvedValue(null);
    mockUpsertJournal.mockResolvedValue(undefined);
    mockGetQuests.mockResolvedValue([]);
    mockUpsertQuest.mockResolvedValue(undefined);
    mockAwardWearable.mockResolvedValue({ date: '2026-10-18', awarded: [], skipped: [], totalXp: 0 });
    mockLoadToggl.mockResolvedValue([]);
    mockGoogle.isConfigured.mockReturnValue(false);
    mockGoogle.hasTokens.mockResolvedValue(false);
    mockFitbit.isConfigured.mockReturnValue(false);
    delete process.env.FITBIT_DATA_SOURCE;
  });

  afterAll(() => {
    if (original === undefined) delete process.env.FITBIT_DATA_SOURCE;
    else process.env.FITBIT_DATA_SOURCE = original;
  });

  it('GET activities is read-only: no quest write and no XP', async () => {
    mockGoogle.isConfigured.mockReturnValue(true);
    mockGoogle.hasTokens.mockResolvedValue(true);
    mockGoogle.getActivities.mockResolvedValue({
      steps: 4000,
      activeMinutes: 30,
      caloriesOut: 2200,
      activities: [{ name: 'Walk', durationMin: 30, calories: 150, startTime: '08:00' }],
    });

    const res = await request(app()).get('/api/fitbit/activities/today?date=2026-10-18');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('google-health');
    expect(res.body.activities).toHaveLength(1);
    expect(mockGetQuests).not.toHaveBeenCalled();
    expect(mockUpsertQuest).not.toHaveBeenCalled();
    expect(mockAwardWearable).not.toHaveBeenCalled();
  });

  it('POST sync uses Google Health, writes the Warrior quest and awards XP', async () => {
    mockGoogle.isConfigured.mockReturnValue(true);
    mockGoogle.hasTokens.mockResolvedValue(true);
    mockFitbit.isConfigured.mockReturnValue(true);
    const activities = [{ name: 'Walk', durationMin: 30, calories: 150, startTime: '08:00' }];
    mockGoogle.getActivities.mockResolvedValue({ steps: 4000, activeMinutes: 30, caloriesOut: 2200, activities });
    mockAwardWearable.mockResolvedValue({
      date: '2026-10-18',
      awarded: [{ name: 'Walk', activityType: 'workout-cardio', durationMin: 30, xp: 19, tag: '[wearable:2026-10-18T08:00]' }],
      skipped: [],
      totalXp: 19,
    });

    const res = await request(app()).post('/api/fitbit/activities/sync').send({ date: '2026-10-18' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('google-health');
    expect(res.body.questWritten).toBe(true);
    expect(res.body.xp.totalXp).toBe(19);
    expect(mockGoogle.getActivities).toHaveBeenCalledWith('2026-10-18', 'user-1');
    expect(mockFitbit.getActivities).not.toHaveBeenCalled();
    expect(mockUpsertQuest).toHaveBeenCalledWith(
      'user-1',
      '2026-10-18',
      'Paladin of God',
      'Warrior Skills',
      expect.stringContaining('Walk 30min'),
    );
    expect(mockAwardWearable).toHaveBeenCalledWith('user-1', '2026-10-18', 'google', activities, { overrides: [] });
  });

  it('POST sync writes an auto-detected walk into the quest and still passes it to the awarder', async () => {
    mockFitbit.isConfigured.mockReturnValue(true);
    const activities = [
      { name: 'Walk', durationMin: 12, calories: 40, startTime: '07:10', logType: 'auto_detected' },
      { name: 'Sport', durationMin: 45, calories: 459, startTime: '18:03', logType: 'tracker' },
    ];
    mockFitbit.getActivities.mockResolvedValue({
      steps: 4000, activeMinutes: 50, caloriesOut: 2000, activities,
    });

    const res = await request(app()).post('/api/fitbit/activities/sync').send({ date: '2026-10-13' });

    expect(res.status).toBe(200);
    expect(res.body.questWritten).toBe(true);
    const quest = mockUpsertQuest.mock.calls[0][4] as string;
    expect(quest).toContain('Walk 12min');
    expect(quest).toContain('Sport 45min');
    expect(mockAwardWearable).toHaveBeenCalledWith('user-1', '2026-10-13', 'fitbit', activities, { overrides: [] });
  });

  it('POST sync keeps an existing Warrior Skills entry but still awards XP', async () => {
    mockFitbit.isConfigured.mockReturnValue(true);
    mockFitbit.getActivities.mockResolvedValue({
      steps: 10, activeMinutes: 0, caloriesOut: 1800,
      activities: [{ name: 'Sport', durationMin: 45, calories: 459, startTime: '18:03' }],
    });
    mockGetQuests.mockResolvedValue([
      { class_name: 'Paladin of God', quest_label: 'Warrior Skills', content: 'Sambo class' },
    ]);

    const res = await request(app()).post('/api/fitbit/activities/sync?date=2026-10-13');

    expect(res.status).toBe(200);
    expect(res.body.questWritten).toBe(false);
    expect(mockUpsertQuest).not.toHaveBeenCalled();
    expect(mockAwardWearable).toHaveBeenCalledWith('user-1', '2026-10-13', 'fitbit', expect.any(Array), { overrides: [] });
  });

  it('POST sync rejects a malformed date before any fetch', async () => {
    const res = await request(app()).post('/api/fitbit/activities/sync').send({ date: '10/13/2026' });
    expect(res.status).toBe(400);
    expect(mockFitbit.getActivities).not.toHaveBeenCalled();
    expect(mockAwardWearable).not.toHaveBeenCalled();
    expect(mockLoadToggl).not.toHaveBeenCalled();
  });

  it('POST sync rejects a calendar date that does not exist', async () => {
    const res = await request(app()).post('/api/fitbit/activities/sync').send({ date: '2026-02-31' });
    expect(res.status).toBe(400);
    expect(mockFitbit.getActivities).not.toHaveBeenCalled();
    expect(mockAwardWearable).not.toHaveBeenCalled();
  });

  it('POST sync defaults an omitted date to America/Chicago today', async () => {
    mockFitbit.isConfigured.mockReturnValue(true);
    mockFitbit.getActivities.mockResolvedValue({
      steps: 0, activeMinutes: 0, caloriesOut: 0, activities: [],
    });
    const chicagoToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    const res = await request(app()).post('/api/fitbit/activities/sync').send({});

    expect(res.status).toBe(200);
    expect(res.body.date).toBe(chicagoToday);
    expect(mockAwardWearable).toHaveBeenCalledWith('user-1', chicagoToday, 'fitbit', [], { overrides: [] });
  });

  it('POST sync rejects an override activity type outside the engine workout rates before any fetch', async () => {
    mockFitbit.isConfigured.mockReturnValue(true);
    const res = await request(app()).post('/api/fitbit/activities/sync').send({
      date: '2026-10-13',
      overrides: [{ sourceId: '111', activityType: 'workout-sambo' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/workout-cardio/);
    expect(mockFitbit.getActivities).not.toHaveBeenCalled();
    expect(mockGoogle.getActivities).not.toHaveBeenCalled();
    expect(mockAwardWearable).not.toHaveBeenCalled();
    expect(mockLoadToggl).not.toHaveBeenCalled();
  });

  it('POST sync applies an override label in the quest and passes the parsed overrides to the awarder', async () => {
    mockFitbit.isConfigured.mockReturnValue(true);
    const activities = [
      { name: 'Sport', durationMin: 45, calories: 459, startTime: '18:03', sourceId: '111', logType: 'tracker' },
      { name: 'Walk', durationMin: 12, calories: 40, startTime: '07:10', logType: 'auto_detected' },
    ];
    mockFitbit.getActivities.mockResolvedValue({
      steps: 4000, activeMinutes: 50, caloriesOut: 2000, activities,
    });

    const res = await request(app()).post('/api/fitbit/activities/sync').send({
      date: '2026-10-13',
      overrides: [{ sourceId: '111', activityType: 'workout-mma', label: 'Toggl: Sambo' }],
    });

    expect(res.status).toBe(200);
    const quest = mockUpsertQuest.mock.calls[0][4] as string;
    expect(quest).toContain('Sport (Toggl: Sambo) 45min');
    expect(quest).toContain('Walk 12min');
    expect(mockAwardWearable).toHaveBeenCalledWith(
      'user-1',
      '2026-10-13',
      'fitbit',
      activities,
      {
        overrides: [{
          sourceId: '111',
          startTime: undefined,
          activityType: 'workout-mma',
          label: 'Toggl: Sambo',
        }],
      },
    );
    expect(mockLoadToggl).toHaveBeenCalledWith('2026-10-13', activities, [{
      sourceId: '111',
      startTime: undefined,
      activityType: 'workout-mma',
      label: 'Toggl: Sambo',
    }]);
  });

  it('POST sync appends a Toggl Sport type without replacing an explicit override', async () => {
    mockFitbit.isConfigured.mockReturnValue(true);
    const activities = [
      { name: 'Sport', durationMin: 45, calories: 459, startTime: '18:03', sourceId: '111' },
      { name: 'Sport', durationMin: 30, calories: 200, startTime: '12:00', sourceId: '222' },
    ];
    mockFitbit.getActivities.mockResolvedValue({
      steps: 1, activeMinutes: 1, caloriesOut: 1, activities,
    });
    mockLoadToggl.mockResolvedValue([
      { sourceId: '222', startTime: '12:00', activityType: 'workout-mma', label: 'Toggl: Sambo' },
    ]);

    const res = await request(app()).post('/api/fitbit/activities/sync').send({
      date: '2026-10-13',
      overrides: [{ sourceId: '111', activityType: 'workout-strength', label: 'Toggl: Lift' }],
    });

    expect(res.status).toBe(200);
    const quest = mockUpsertQuest.mock.calls[0][4] as string;
    expect(quest).toContain('Sport (Toggl: Lift) 45min');
    expect(quest).toContain('Sport (Toggl: Sambo) 30min');
    expect(mockAwardWearable).toHaveBeenCalledWith('user-1', '2026-10-13', 'fitbit', activities, {
      overrides: [
        { sourceId: '111', startTime: undefined, activityType: 'workout-strength', label: 'Toggl: Lift' },
        { sourceId: '222', startTime: '12:00', activityType: 'workout-mma', label: 'Toggl: Sambo' },
      ],
    });
  });

  it('POST sync still awards cardio when Toggl typing throws', async () => {
    mockFitbit.isConfigured.mockReturnValue(true);
    const activities = [
      { name: 'Sport', durationMin: 45, calories: 459, startTime: '18:03', sourceId: '111' },
    ];
    mockFitbit.getActivities.mockResolvedValue({
      steps: 1, activeMinutes: 1, caloriesOut: 1, activities,
    });
    mockLoadToggl.mockRejectedValue(new Error('socket hang up'));

    const res = await request(app()).post('/api/fitbit/activities/sync').send({ date: '2026-10-13' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockAwardWearable).toHaveBeenCalledWith(
      'user-1',
      '2026-10-13',
      'fitbit',
      activities,
      { overrides: [] },
    );
  });

  it('falls back to the legacy Fitbit API when Google Health is not configured', async () => {
    mockFitbit.isConfigured.mockReturnValue(true);
    mockFitbit.getActivities.mockResolvedValue({
      steps: 10,
      activeMinutes: 0,
      caloriesOut: 1800,
      activities: [],
    });

    const res = await request(app()).get('/api/fitbit/activities/today?date=2026-10-18');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('fitbit');
    expect(mockGoogle.getActivities).not.toHaveBeenCalled();
  });

  it('legacy mode ignores a connected Google Health account', async () => {
    process.env.FITBIT_DATA_SOURCE = 'legacy';
    mockGoogle.isConfigured.mockReturnValue(true);
    mockGoogle.hasTokens.mockResolvedValue(true);
    mockFitbit.isConfigured.mockReturnValue(true);
    mockFitbit.getVitals.mockResolvedValue({ waterOz: 16 });

    const res = await request(app()).get('/api/fitbit/vitals/today?date=2026-10-18');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('fitbit');
    expect(res.body.waterOz).toBe(16);
    expect(mockGoogle.getVitals).not.toHaveBeenCalled();
    expect(mockUpsertJournal).toHaveBeenCalledWith('user-1', {
      entry_date: '2026-10-18',
      hydration_oz: 16,
    });
  });

  it('returns 503 before credentials exist instead of calling either API', async () => {
    const res = await request(app()).get('/api/fitbit/nutrition/today?date=2026-10-18');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(mockGoogle.getFoodLog).not.toHaveBeenCalled();
    expect(mockFitbit.getFoodLog).not.toHaveBeenCalled();
    expect(mockUpsertJournal).not.toHaveBeenCalled();
  });

  it('google mode asks for consent and does not write a fake protein level', async () => {
    process.env.FITBIT_DATA_SOURCE = 'google';
    mockGoogle.isConfigured.mockReturnValue(true);
    mockGoogle.hasTokens.mockResolvedValue(false);
    mockFitbit.isConfigured.mockReturnValue(true);

    const res = await request(app()).get('/api/fitbit/nutrition/today?date=2026-10-18');

    expect(res.status).toBe(200);
    expect(res.body.requiresAuth).toBe(true);
    expect(mockFitbit.getFoodLog).not.toHaveBeenCalled();
    expect(mockUpsertJournal).not.toHaveBeenCalled();
  });

  it('persists the same protein band from a Google Health food log', async () => {
    mockGoogle.isConfigured.mockReturnValue(true);
    mockGoogle.hasTokens.mockResolvedValue(true);
    mockGoogle.getFoodLog.mockResolvedValue({
      entries: [],
      totals: { calories: 2000, protein: 140, carbs: 100, fat: 60, fiber: 20, water: 0 },
      goalCalories: 0,
    });

    const res = await request(app()).get('/api/fitbit/nutrition/today?date=2026-10-18');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('google-health');
    expect(mockUpsertJournal).toHaveBeenCalledWith('user-1', {
      entry_date: '2026-10-18',
      protein_level: 'high',
    });
  });

  it('keeps a cached sleep night and does not refetch', async () => {
    mockGoogle.isConfigured.mockReturnValue(true);
    mockGoogle.hasTokens.mockResolvedValue(true);
    mockGetJournal.mockResolvedValue({ sleep_hours: 7.5, fitbit_score: 90, sleep_start: '23:00', sleep_end: '06:30' });

    const res = await request(app()).get('/api/fitbit/sleep/today?date=2026-10-18');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('cache');
    expect(res.body.sleep.score).toBe(90);
    expect(res.body.sleep.hours).toBe(7.5);
    expect(mockGoogle.getSleepData).not.toHaveBeenCalled();
    expect(mockFitbit.getSleepData).not.toHaveBeenCalled();
  });
});
