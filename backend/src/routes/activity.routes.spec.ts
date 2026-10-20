/**
 * activity.routes.ts — body-status XP penalty wiring
 *
 * Previously getXPPenaltyForAction() was dead code (frontend-only, only used
 * in its own spec). This confirms POST /api/activities now fetches active
 * body_status rows, applies the max matching xp_penalty to both the response
 * `xp` and the per-class awards used for Supabase persistence.
 */

import request from 'supertest';
import express, { Express } from 'express';

const mockLogActivity         = jest.fn().mockResolvedValue(undefined);
const mockGetCharacterStats   = jest.fn().mockResolvedValue([]);
const mockUpsertCharacterStats = jest.fn().mockResolvedValue(undefined);
const mockGetActivityLog      = jest.fn().mockResolvedValue([]);
const mockGetActiveBodyStatuses = jest.fn();

jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    logActivity:         (...args: any[]) => mockLogActivity(...args),
    getCharacterStats:   (...args: any[]) => mockGetCharacterStats(...args),
    upsertCharacterStats: (...args: any[]) => mockUpsertCharacterStats(...args),
    getActivityLog:      (...args: any[]) => mockGetActivityLog(...args),
  }),
}));

jest.mock('../services/bodyStatus.service', () => ({
  getActiveBodyStatuses: (...args: any[]) => mockGetActiveBodyStatuses(...args),
}));

// ── Import AFTER mocks ──────────────────────────────────────────────────────
import { activityRouter, setSocketIO } from './activity.routes';
import { pushLog, resetActivityLogForTests } from '../services/activityLogStore';

function makeApp(withAuth = true): Express {
  const app = express();
  app.use(express.json());
  if (withAuth) {
    app.use((req: any, _res: any, next: any) => { req.userId = 'test-user'; next(); });
  }
  app.use('/api/activities', activityRouter);
  return app;
}

/** Flush the setImmediate() Supabase write block scheduled by the route. */
async function flushAsync() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

beforeEach(() => {
  mockLogActivity.mockClear();
  mockGetCharacterStats.mockClear().mockResolvedValue([]);
  mockUpsertCharacterStats.mockClear();
  mockGetActivityLog.mockReset().mockResolvedValue([]);
  mockGetActiveBodyStatuses.mockReset();
});

describe('POST /api/activities — body-status XP penalty', () => {
  it('applies no penalty when there are no active body statuses', async () => {
    mockGetActiveBodyStatuses.mockResolvedValue([]);

    const res = await request(makeApp())
      .post('/api/activities')
      .send({ activityType: 'workout-penalty-test-none', xp: 100 });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(100);
    expect(res.body.xpPenaltyPct).toBeUndefined();
  });

  it('applies no penalty when active statuses exist but do not impact this activityType', async () => {
    mockGetActiveBodyStatuses.mockResolvedValue([
      { id: 'a', body_part: 'left-knee', type: 'injury', severity: 'severe', name: 'Knee sprain',
        start_date: new Date().toISOString(), impacts_actions: ['running'], xp_penalty: 30 },
    ]);

    const res = await request(makeApp())
      .post('/api/activities')
      .send({ activityType: 'workout-penalty-test-nomatch', xp: 100 });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(100);
  });

  it('reduces xp by the matching status xp_penalty percentage', async () => {
    mockGetActiveBodyStatuses.mockResolvedValue([
      { id: 'a', body_part: 'left-knee', type: 'injury', severity: 'severe', name: 'Knee sprain',
        start_date: new Date().toISOString(), impacts_actions: ['workout-penalty-test-match'], xp_penalty: 20 },
    ]);

    const res = await request(makeApp())
      .post('/api/activities')
      .send({ activityType: 'workout-penalty-test-match', xp: 100 });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(80); // 100 * (1 - 0.20)
    expect(res.body.xpPenaltyPct).toBe(20);
  });

  it('takes the max penalty among multiple matching statuses — not cumulative', async () => {
    mockGetActiveBodyStatuses.mockResolvedValue([
      { id: 'a', body_part: 'left-knee', type: 'injury', severity: 'moderate', name: 'Minor strain',
        start_date: new Date().toISOString(), impacts_actions: ['workout-penalty-test-multi'], xp_penalty: 10 },
      { id: 'b', body_part: 'right-shoulder', type: 'injury', severity: 'critical', name: 'Major injury',
        start_date: new Date().toISOString(), impacts_actions: ['workout-penalty-test-multi'], xp_penalty: 40 },
    ]);

    const res = await request(makeApp())
      .post('/api/activities')
      .send({ activityType: 'workout-penalty-test-multi', xp: 100 });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(60); // max(10, 40) = 40% off, not 10+40
    expect(res.body.xpPenaltyPct).toBe(40);
  });

  it('propagates the penalty to per-class xpAwards persisted to character_stats', async () => {
    mockGetActiveBodyStatuses.mockResolvedValue([
      { id: 'a', body_part: 'left-knee', type: 'injury', severity: 'severe', name: 'Knee sprain',
        start_date: new Date().toISOString(), impacts_actions: ['workout-penalty-test-persist'], xp_penalty: 50 },
    ]);

    // No clientXp override — unrecognized activityType falls back to a single
    // [{ class, xp: 10 }] award, so the response `xp` and xpAwards total agree.
    const res = await request(makeApp())
      .post('/api/activities')
      .send({ activityType: 'workout-penalty-test-persist' });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(5); // base 10, halved by the 50% penalty
    expect(res.body.xpAwards.every((a: { xp: number }) => a.xp === 5)).toBe(true);

    await flushAsync();

    expect(mockLogActivity).toHaveBeenCalledWith('test-user', expect.objectContaining({ xp_awarded: 5 }));
    expect(mockUpsertCharacterStats).toHaveBeenCalled();
    const persistedTotalXp = mockUpsertCharacterStats.mock.calls[0][1].total_xp;
    expect(persistedTotalXp).toBe(5);
  });

  it('skips the body-status lookup entirely when unauthenticated (no penalty possible)', async () => {
    const res = await request(makeApp(false))
      .post('/api/activities')
      .send({ activityType: 'workout-penalty-test-noauth', xp: 100 });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(100);
    expect(mockGetActiveBodyStatuses).not.toHaveBeenCalled();
  });

  it('defaults to 0% penalty (does not fail the request) if the body-status lookup errors', async () => {
    mockGetActiveBodyStatuses.mockRejectedValue(new Error('db down'));

    const res = await request(makeApp())
      .post('/api/activities')
      .send({ activityType: 'workout-penalty-test-error', xp: 100 });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(100);
  });

  // Regression coverage for combining the single-class client/server XP
  // reconciliation (client's authoritative xp overriding a stale server
  // config-based estimate — the Survivalist "wilderness-craft" fix) with the
  // body-status penalty multiplier. The reconciled award must be the
  // baseline the penalty is applied ON TOP OF, not bypassed by it.
  it('applies the body-status penalty on top of the single-class client/server XP reconciliation', async () => {
    mockGetActiveBodyStatuses.mockResolvedValue([
      { id: 'a', body_part: 'left-hand', type: 'injury', severity: 'moderate', name: 'Sprained wrist',
        start_date: new Date().toISOString(), impacts_actions: ['wilderness-craft'], xp_penalty: 25 },
    ]);

    // 'wilderness-craft' is not in the server's activityXP config, so
    // xpCalculator falls back to a flat single-class [{ class, xp: 10 }]
    // award (totalServerXp = 10) — the client's clientXp: 60 (from a
    // per-recipe xpReward) diverges from that, triggering reconciliation.
    const res = await request(makeApp())
      .post('/api/activities')
      .send({ activityType: 'wilderness-craft', xp: 60 });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(45); // reconciled to 60, then -25% body-status penalty
    expect(res.body.xpPenaltyPct).toBe(25);
    expect(res.body.xpAwards).toHaveLength(1);
    expect(res.body.xpAwards[0].xp).toBe(45); // per-class award matches the top-level xp exactly

    await flushAsync();

    const persistedTotalXp = mockUpsertCharacterStats.mock.calls[0][1].total_xp;
    expect(persistedTotalXp).toBe(45);
  });
});

describe('POST /api/activities — occurred-at backfill', () => {
  beforeEach(() => {
    mockGetActiveBodyStatuses.mockResolvedValue([]);
    resetActivityLogForTests();
  });

  it('persists the request time when no date is sent', async () => {
    const before = Date.now();
    const res = await request(makeApp())
      .post('/api/activities')
      .send({ activityType: 'workout-mobility', duration: 20, xp: 12 });

    expect(res.status).toBe(200);
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const loggedAt = new Date(res.body.loggedAt).getTime();
    expect(loggedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(loggedAt).toBeLessThanOrEqual(Date.now() + 1000);

    await flushAsync();
    expect(mockLogActivity).toHaveBeenCalledWith('test-user', expect.objectContaining({
      logged_at: res.body.loggedAt,
      activity_type: 'workout-mobility',
    }));
  });

  it('keeps request time when clientDate is today, so existing clients are unchanged', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const before = Date.now();
    const res = await request(makeApp())
      .post('/api/activities')
      .send({ activityType: 'workout-strength', duration: 46, xp: 30, clientDate: today });

    expect(res.status).toBe(200);
    expect(res.body.date).toBe(today);
    const loggedAt = new Date(res.body.loggedAt).getTime();
    expect(loggedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(loggedAt).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('stores a past date at noon UTC and reports that day on the level-up event', async () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const emit = jest.fn();
    setSocketIO({ to: () => ({ emit }) } as any);
    mockGetCharacterStats.mockResolvedValue([
      { class_name: 'Warrior', level: 1, current_xp: 0, total_xp: 0, user_id: 'test-user' },
    ]);

    const res = await request(makeApp())
      .post('/api/activities')
      .send({ activityType: 'workout-strength', duration: 46, xp: 1000, date: past });

    expect(res.status).toBe(200);
    expect(res.body.date).toBe(past);
    expect(res.body.loggedAt).toBe(`${past}T12:00:00.000Z`);
    expect(res.body.occurredAt).toBe(`${past}T12:00:00.000Z`);

    await flushAsync();
    expect(mockLogActivity).toHaveBeenCalledWith('test-user', expect.objectContaining({
      logged_at: `${past}T12:00:00.000Z`,
    }));
    expect(emit).toHaveBeenCalledWith('level-up', expect.objectContaining({
      class: 'Warrior',
      date: past,
    }));
    setSocketIO(undefined as any);
  });

  it('persists a zoned occurredAt and lets it win over date', async () => {
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [y, m, d] = past.split('-').map(Number);
    const nextDay = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);

    const res = await request(makeApp())
      .post('/api/activities')
      .send({
        activityType: 'workout-mobility',
        duration: 20,
        xp: 12,
        date: '2026-10-01',
        occurredAt: `${past}T21:00:00-05:00`,
      });

    expect(res.status).toBe(200);
    expect(res.body.date).toBe(past);
    // 21:00 at UTC-5 is 02:00Z the next day, so the row is anchored onto the civil day.
    expect(res.body.occurredAt).toBe(`${nextDay}T02:00:00.000Z`);
    expect(res.body.loggedAt).toBe(`${past}T12:00:00.000Z`);

    await flushAsync();
    expect(mockLogActivity.mock.calls[0][1].logged_at).toBe(`${past}T12:00:00.000Z`);
  });

  it('accepts startTime as an alias for occurredAt', async () => {
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await request(makeApp())
      .post('/api/activities')
      .send({
        activityType: 'workout-mobility',
        xp: 12,
        startTime: `${past}T16:00:00.000Z`,
      });

    expect(res.status).toBe(200);
    expect(res.body.loggedAt).toBe(`${past}T16:00:00.000Z`);
    expect(res.body.date).toBe(past);
  });

  it('rejects unparseable, future, and too-old timestamps without writing', async () => {
    const unparseable = await request(makeApp())
      .post('/api/activities')
      .send({ activityType: 'workout-mobility', xp: 12, occurredAt: 'yesterday' });
    expect(unparseable.status).toBe(400);
    expect(unparseable.body.error).toMatch(/occurredAt/);

    const future = await request(makeApp())
      .post('/api/activities')
      .send({ activityType: 'workout-mobility', xp: 12, date: '2099-01-01' });
    expect(future.status).toBe(400);
    expect(future.body.error).toMatch(/future/);

    const ancient = await request(makeApp())
      .post('/api/activities')
      .send({ activityType: 'workout-mobility', xp: 12, occurredAt: '2020-01-01T12:00:00.000Z' });
    expect(ancient.status).toBe(400);
    expect(ancient.body.error).toMatch(/backfill window/);

    expect(mockLogActivity).not.toHaveBeenCalled();
  });
});

describe('GET /api/activities — persistent store', () => {
  beforeEach(() => {
    resetActivityLogForTests();
  });

  it('returns rows from the persistent store when the in-memory list is empty', async () => {
    mockGetActivityLog.mockResolvedValue([
      {
        id: 'row-1',
        user_id: 'test-user',
        logged_at: '2026-10-19T12:00:00.000Z',
        class_name: 'Warrior',
        activity_type: 'workout-strength',
        duration_hours: 0.77,
        xp_awarded: 29,
        notes: 'backfill',
      },
    ]);

    const res = await request(makeApp()).get('/api/activities');

    expect(res.status).toBe(200);
    expect(mockGetActivityLog).toHaveBeenCalledWith('test-user', 200, undefined);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: 'row-1',
        activityType: 'workout-strength',
        xp: 29,
        duration: 46,
        notes: 'backfill',
        category: 'Warrior',
        source: 'skill',
        timestamp: '2026-10-19T12:00:00.000Z',
        date: '2026-10-19',
      }),
    ]);
  });

  it('filters the persistent query by date and limit', async () => {
    await request(makeApp()).get('/api/activities?date=2026-10-19&limit=20');
    expect(mockGetActivityLog).toHaveBeenCalledWith('test-user', 20, '2026-10-19');
  });

  it('keeps in-memory consume entries that were never written to activity_log', async () => {
    pushLog({ activityType: 'Water', xp: 0, notes: '+12 oz', source: 'water', timestamp: '2026-10-20T15:00:00.000Z' });
    mockGetActivityLog.mockResolvedValue([
      {
        id: 'row-1',
        logged_at: '2026-10-19T12:00:00.000Z',
        class_name: 'Warrior',
        activity_type: 'workout-mobility',
        xp_awarded: 12,
      },
    ]);

    const res = await request(makeApp()).get('/api/activities');
    expect(res.status).toBe(200);
    expect(res.body.map((entry: { activityType: string }) => entry.activityType)).toEqual([
      'Water',
      'workout-mobility',
    ]);
  });

  it('falls back to the in-memory list when the persistent read fails', async () => {
    pushLog({ activityType: 'workout-cardio', xp: 15, source: 'skill', timestamp: '2026-10-20T15:00:00.000Z' });
    mockGetActivityLog.mockRejectedValue(new Error('db down'));

    const res = await request(makeApp()).get('/api/activities');
    expect(res.status).toBe(200);
    expect(res.body[0].activityType).toBe('workout-cardio');
  });

  it('rejects a malformed date query', async () => {
    const res = await request(makeApp()).get('/api/activities?date=10-19-2026');
    expect(res.status).toBe(400);
    expect(mockGetActivityLog).not.toHaveBeenCalled();
  });
});
