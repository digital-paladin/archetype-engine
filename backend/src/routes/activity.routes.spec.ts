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
const mockGetActiveBodyStatuses = jest.fn();

jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    logActivity:         (...args: any[]) => mockLogActivity(...args),
    getCharacterStats:   (...args: any[]) => mockGetCharacterStats(...args),
    upsertCharacterStats: (...args: any[]) => mockUpsertCharacterStats(...args),
  }),
}));

jest.mock('../services/bodyStatus.service', () => ({
  getActiveBodyStatuses: (...args: any[]) => mockGetActiveBodyStatuses(...args),
}));

// ── Import AFTER mocks ──────────────────────────────────────────────────────
import { activityRouter } from './activity.routes';

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
});
