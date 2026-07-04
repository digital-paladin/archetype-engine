/**
 * dailyMetrics.routes.ts — Unit & Integration Tests
 *
 * Covers:
 *  - GET /api/daily-metrics: returns null metrics when entry absent, returns
 *    populated metrics when entry exists, stress_level Title-Case normalization
 *    (regression for commit e7d531e), defaults to today when no date given.
 *  - POST /api/daily-metrics: 400 on missing/invalid date, 200 on valid body,
 *    stress level is stored lowercase regardless of what the frontend sends.
 *
 * getDataService is fully mocked — no real Supabase calls.
 */

import request from 'supertest';
import express, { Express } from 'express';

// ── Mock getDataService BEFORE importing the route ───────────────────────────
const mockGetJournalEntry   = jest.fn<Promise<any>, any[]>();
const mockUpsertJournalEntry = jest.fn<Promise<void>, any[]>();

jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    getJournalEntry:    (...args: any[]) => mockGetJournalEntry(...args),
    upsertJournalEntry: (...args: any[]) => mockUpsertJournalEntry(...args),
  }),
}));

// ── Import AFTER mock ─────────────────────────────────────────────────────────
import router from './dailyMetrics.routes';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.userId = 'test-user-id'; next(); });
  app.use('/api/daily-metrics', router);
  return app;
}

/** A fully-populated JournalEntry row as Supabase would return */
const FULL_ENTRY = {
  id:              'entry-1',
  user_id:         'test-user-id',
  entry_date:      '2026-04-12',
  sleep_start:     '23:30',
  sleep_end:       '07:15',
  sleep_hours:     7.8,
  fitbit_score:    82,
  protein_level:   'high',
  calories_status: 'maintenance',
  hydration_oz:    80,
  notes:           'Chipotle steak bowl',
  stress_level:    'low',          // DB stores lowercase
  energy_score:    7,
  mental_state:    'Focused and productive',
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/daily-metrics
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/daily-metrics', () => {
  beforeEach(() => {
    mockGetJournalEntry.mockReset();
    mockUpsertJournalEntry.mockReset();
  });

  it('returns null metrics when entry does not exist', async () => {
    mockGetJournalEntry.mockResolvedValue(null);

    const res = await request(makeApp()).get('/api/daily-metrics?date=2026-05-17');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.metrics.sleep.bedtime).toBeNull();
    expect(res.body.metrics.stress.stress).toBeNull();
  });

  it('returns populated sleep metrics when entry exists', async () => {
    mockGetJournalEntry.mockResolvedValue(FULL_ENTRY);

    const res = await request(makeApp()).get('/api/daily-metrics?date=2026-04-12');

    expect(res.status).toBe(200);
    const { sleep } = res.body.metrics;
    expect(sleep.bedtime).toBe('23:30');
    expect(sleep.wakeTime).toBe('07:15');
    expect(sleep.totalSleep).toBe(7.8);
    expect(sleep.fitbitScore).toBe(82);
    expect(sleep.vitalityScore).toBeCloseTo(8.2, 1);
  });

  it('returns populated nutrition metrics when entry exists', async () => {
    mockGetJournalEntry.mockResolvedValue(FULL_ENTRY);

    const res = await request(makeApp()).get('/api/daily-metrics?date=2026-04-12');

    const { nutrition } = res.body.metrics;
    expect(nutrition.protein).toBe('high');
    expect(nutrition.calories).toBe('maintenance');
    expect(nutrition.hydration).toBe(80);
    expect(nutrition.foodNotes).toBe('Chipotle steak bowl');
  });

  /**
   * REGRESSION TEST — commit e7d531e
   * DB stores stress_level lowercase ('low', 'medium', 'high').
   * Frontend button matching requires Title-Case ('Low', 'Medium', 'High').
   * entryToMetrics() must capitalize before returning.
   */
  it('returns stress level as Title-Case regardless of DB casing', async () => {
    mockGetJournalEntry.mockResolvedValue({ ...FULL_ENTRY, stress_level: 'low' });
    const res1 = await request(makeApp()).get('/api/daily-metrics?date=2026-04-12');
    expect(res1.body.metrics.stress.stress).toBe('Low');

    mockGetJournalEntry.mockResolvedValue({ ...FULL_ENTRY, stress_level: 'medium' });
    const res2 = await request(makeApp()).get('/api/daily-metrics?date=2026-04-12');
    expect(res2.body.metrics.stress.stress).toBe('Medium');

    mockGetJournalEntry.mockResolvedValue({ ...FULL_ENTRY, stress_level: 'high' });
    const res3 = await request(makeApp()).get('/api/daily-metrics?date=2026-04-12');
    expect(res3.body.metrics.stress.stress).toBe('High');
  });

  it('returns null stress when stress_level is null', async () => {
    mockGetJournalEntry.mockResolvedValue({ ...FULL_ENTRY, stress_level: null });

    const res = await request(makeApp()).get('/api/daily-metrics?date=2026-04-12');

    expect(res.body.metrics.stress.stress).toBeNull();
  });

  it('returns energy score and mental state', async () => {
    mockGetJournalEntry.mockResolvedValue(FULL_ENTRY);

    const res = await request(makeApp()).get('/api/daily-metrics?date=2026-04-12');

    expect(res.body.metrics.stress.energy).toBe(7);
    expect(res.body.metrics.stress.mentalState).toBe('Focused and productive');
  });

  it('uses today\'s date when no date query param provided', async () => {
    mockGetJournalEntry.mockResolvedValue(null);

    const res = await request(makeApp()).get('/api/daily-metrics');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('date');
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/daily-metrics
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/daily-metrics', () => {
  beforeEach(() => {
    mockGetJournalEntry.mockReset();
    mockUpsertJournalEntry.mockReset().mockResolvedValue(undefined);
  });

  it('returns 400 when date is missing', async () => {
    const res = await request(makeApp())
      .post('/api/daily-metrics')
      .send({ metrics: {} });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when date format is invalid', async () => {
    const res = await request(makeApp())
      .post('/api/daily-metrics')
      .send({ date: '12-04-2026', metrics: {} });

    expect(res.status).toBe(400);
  });

  it('returns 400 when metrics object is missing', async () => {
    const res = await request(makeApp())
      .post('/api/daily-metrics')
      .send({ date: '2026-04-12' });

    expect(res.status).toBe(400);
  });

  it('saves stress level as lowercase to the DB', async () => {
    await request(makeApp())
      .post('/api/daily-metrics')
      .send({ date: '2026-04-12', metrics: { stress: { stress: 'High', energy: 8, mentalState: 'Sharp' } } });

    const patch = mockUpsertJournalEntry.mock.calls[0][1]; // upsertJournalEntry(userId, entry)
    expect(patch.stress_level).toBe('high'); // stored lowercase
    expect(patch.energy_score).toBe(8);
    expect(patch.mental_state).toBe('Sharp');
  });

  it('returns 200 on a valid sleep update', async () => {
    const res = await request(makeApp())
      .post('/api/daily-metrics')
      .send({ date: '2026-04-12', metrics: { sleep: { bedtime: '23:00', wakeTime: '07:00', totalSleep: 8, fitbitScore: 90 } } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 500 when DB throws on upsert', async () => {
    mockUpsertJournalEntry.mockRejectedValue(new Error('DB error'));

    const res = await request(makeApp())
      .post('/api/daily-metrics')
      .send({ date: '2026-04-12', metrics: { stress: { stress: 'Low' } } });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
