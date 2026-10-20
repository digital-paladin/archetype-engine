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
    mockGoogle.isConfigured.mockReturnValue(false);
    mockGoogle.hasTokens.mockResolvedValue(false);
    mockFitbit.isConfigured.mockReturnValue(false);
    delete process.env.FITBIT_DATA_SOURCE;
  });

  afterAll(() => {
    if (original === undefined) delete process.env.FITBIT_DATA_SOURCE;
    else process.env.FITBIT_DATA_SOURCE = original;
  });

  it('uses Google Health activities and still writes the Warrior quest', async () => {
    mockGoogle.isConfigured.mockReturnValue(true);
    mockGoogle.hasTokens.mockResolvedValue(true);
    mockFitbit.isConfigured.mockReturnValue(true);
    mockGoogle.getActivities.mockResolvedValue({
      steps: 4000,
      activeMinutes: 30,
      caloriesOut: 2200,
      activities: [{ name: 'Walk', durationMin: 30, calories: 150, startTime: '08:00' }],
    });

    const res = await request(app()).get('/api/fitbit/activities/today?date=2026-10-18');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('google-health');
    expect(res.body.steps).toBe(4000);
    expect(mockFitbit.getActivities).not.toHaveBeenCalled();
    expect(mockUpsertQuest).toHaveBeenCalledWith(
      'user-1',
      '2026-10-18',
      'Paladin of God',
      'Warrior Skills',
      expect.stringContaining('Walk 30min'),
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
