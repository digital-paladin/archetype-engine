/**
 * actionLog.routes.ts — Unit & Integration Tests (Supabase)
 *
 * GET /api/action-log:
 *  - Returns boolean[] from Supabase acm_entries rows
 *  - Returns false[] (not 404) when no rows exist for the date
 *
 * POST /api/action-log:
 *  - Validates date (YYYY-MM-DD) and actionItems (boolean[ACM_ITEM_COUNT])
 *  - Delegates to db.updateACMEntries(userId, date, actionItems)
 *  - Does NOT write to the filesystem
 */

import request from 'supertest';
import express, { Express } from 'express';

// ── Mock getDataService BEFORE importing the route ─────────────────────────
const mockGetACMEntries    = jest.fn<Promise<any[]>, any[]>();
const mockUpdateACMEntries = jest.fn<Promise<void>,  any[]>();

jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    getACMEntries:    (...args: any[]) => mockGetACMEntries(...args),
    updateACMEntries: (...args: any[]) => mockUpdateACMEntries(...args),
  }),
}));

// ── Import AFTER mock ──────────────────────────────────────────────────────
import router from './actionLog.routes';
import { ACM_ITEM_COUNT } from '../config/acm.config';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.userId = 'test-user'; next(); });
  app.use('/api/action-log', router);
  return app;
}

const DATE_STR  = '2026-04-12';
const ALL_FALSE = Array(ACM_ITEM_COUNT).fill(false);
const ALL_TRUE  = Array(ACM_ITEM_COUNT).fill(true);

/** Convert boolean array to DB rows (only completed ones stored) */
function toRows(states: boolean[]) {
  return states
    .map((completed, item_index) => ({ item_index, completed }))
    .filter(r => r.completed);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/action-log
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/action-log', () => {
  beforeEach(() => {
    mockGetACMEntries.mockReset();
    mockUpdateACMEntries.mockReset();
  });

  it('returns 400 when date param is missing', async () => {
    const res = await request(makeApp()).get('/api/action-log');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date/i);
  });

  it('returns 400 for invalid date format', async () => {
    const res = await request(makeApp()).get('/api/action-log?date=12-04-2026');
    expect(res.status).toBe(400);
  });

  it('returns 200 with all-false actionItems when DB has no rows', async () => {
    mockGetACMEntries.mockResolvedValue([]);

    const res = await request(makeApp()).get(`/api/action-log?date=${DATE_STR}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.date).toBe(DATE_STR);
    expect(Array.isArray(res.body.actionItems)).toBe(true);
    expect(res.body.actionItems.length).toBe(ACM_ITEM_COUNT);
    expect(res.body.actionItems.every((v: boolean) => v === false)).toBe(true);
  });

  it('returns labels array with ACM_ITEM_COUNT entries', async () => {
    mockGetACMEntries.mockResolvedValue([]);

    const res = await request(makeApp()).get(`/api/action-log?date=${DATE_STR}`);

    expect(Array.isArray(res.body.labels)).toBe(true);
    expect(res.body.labels.length).toBe(ACM_ITEM_COUNT);
  });

  it('returns all-true actionItems when all items are checked in DB', async () => {
    mockGetACMEntries.mockResolvedValue(toRows(ALL_TRUE));

    const res = await request(makeApp()).get(`/api/action-log?date=${DATE_STR}`);

    expect(res.status).toBe(200);
    expect(res.body.actionItems.every((v: boolean) => v === true)).toBe(true);
  });

  it('returns correct individual checked state from DB rows', async () => {
    const states = [...ALL_FALSE];
    states[2] = true;
    states[5] = true;
    mockGetACMEntries.mockResolvedValue(toRows(states));

    const res = await request(makeApp()).get(`/api/action-log?date=${DATE_STR}`);

    expect(res.body.actionItems[2]).toBe(true);
    expect(res.body.actionItems[5]).toBe(true);
    expect(res.body.actionItems[0]).toBe(false);
    expect(res.body.actionItems[1]).toBe(false);
  });

  it('returns 500 when getACMEntries throws', async () => {
    mockGetACMEntries.mockRejectedValue(new Error('DB error'));

    const res = await request(makeApp()).get(`/api/action-log?date=${DATE_STR}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/action-log
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/action-log', () => {
  beforeEach(() => {
    mockGetACMEntries.mockReset();
    mockUpdateACMEntries.mockReset().mockResolvedValue(undefined);
  });

  it('returns 400 when date is missing', async () => {
    const res = await request(makeApp())
      .post('/api/action-log')
      .send({ actionItems: ALL_FALSE });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date/i);
  });

  it('returns 400 for invalid date format', async () => {
    const res = await request(makeApp())
      .post('/api/action-log')
      .send({ date: '12-04-2026', actionItems: ALL_FALSE });
    expect(res.status).toBe(400);
  });

  it('returns 400 when actionItems is missing', async () => {
    const res = await request(makeApp())
      .post('/api/action-log')
      .send({ date: DATE_STR });
    expect(res.status).toBe(400);
  });

  it('returns 400 when actionItems is wrong length', async () => {
    const res = await request(makeApp())
      .post('/api/action-log')
      .send({ date: DATE_STR, actionItems: [true, false] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when actionItems is not an array', async () => {
    const res = await request(makeApp())
      .post('/api/action-log')
      .send({ date: DATE_STR, actionItems: 'true' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when actionItems contains non-boolean values', async () => {
    const items = Array(ACM_ITEM_COUNT).fill(false);
    items[0] = 'yes';
    const res = await request(makeApp())
      .post('/api/action-log')
      .send({ date: DATE_STR, actionItems: items });
    expect(res.status).toBe(400);
  });

  it('returns 200 and calls updateACMEntries on valid request', async () => {
    const res = await request(makeApp())
      .post('/api/action-log')
      .send({ date: DATE_STR, actionItems: ALL_FALSE });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUpdateACMEntries).toHaveBeenCalledTimes(1);
  });

  it('passes correct userId, date, and actionItems to updateACMEntries', async () => {
    const checked = [...ALL_FALSE];
    checked[0] = true;
    checked[3] = true;

    await request(makeApp())
      .post('/api/action-log')
      .send({ date: DATE_STR, actionItems: checked });

    const [userId, date, items] = mockUpdateACMEntries.mock.calls[0];
    expect(userId).toBe('test-user');
    expect(date).toBe(DATE_STR);
    expect(items[0]).toBe(true);
    expect(items[3]).toBe(true);
    expect(items[1]).toBe(false);
  });

  it('returns 500 when updateACMEntries throws', async () => {
    mockUpdateACMEntries.mockRejectedValue(new Error('DB write failed'));

    const res = await request(makeApp())
      .post('/api/action-log')
      .send({ date: DATE_STR, actionItems: ALL_FALSE });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });
});
