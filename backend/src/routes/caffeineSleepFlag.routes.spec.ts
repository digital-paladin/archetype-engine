import request from 'supertest';
import express, { Express } from 'express';
import { JournalEntry } from '../services/data/IDataService';

const entries = new Map<string, JournalEntry>();
const ouraByDate = jest.fn();

jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    getJournalEntry: async (userId: string, date: string) => entries.get(`${userId}:${date}`) ?? null,
    listJournalFoodDays: async (userId: string) => {
      const days = [];
      for (const [key, row] of entries) {
        if (!key.startsWith(`${userId}:`) || !Array.isArray(row.food_log)) continue;
        days.push({ entry_date: row.entry_date, food_log: row.food_log });
      }
      return days;
    },
    upsertJournalEntry: async () => undefined,
  }),
}));

jest.mock('../services/ouraSummaryStore', () => ({
  getOuraSummaryByDate: (...args: unknown[]) => ouraByDate(...args),
}));

import systemRouter from './system.routes';

function app(): Express {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    (req as express.Request & { userId?: string }).userId = 'player-1';
    next();
  });
  server.use('/api/system', systemRouter);
  return server;
}

function remember(date: string, entry: Partial<JournalEntry>): void {
  entries.set(`player-1:${date}`, {
    user_id: 'player-1',
    entry_date: date,
    ...entry,
  });
}

describe('GET /api/system/caffeine-sleep-flag', () => {
  beforeEach(() => {
    entries.clear();
    ouraByDate.mockReset();
    ouraByDate.mockResolvedValue(null);
  });

  it('returns a one-line flag and no XP change when Oura sleep is under 70 after afternoon caffeine', async () => {
    ouraByDate.mockResolvedValue({
      no_data: false,
      sleep: { missing: false, score: 64, hours: 6.2 },
    });
    remember('2026-11-14', {
      food_log: [{ id: 'cup', item: 'Coffee', protein: 0, calories: 0, ts: '2026-11-14T20:00:00.000Z', caffeineMg: 95 }],
    });

    const res = await request(app()).get('/api/system/caffeine-sleep-flag?date=2026-11-15');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      date: '2026-11-15',
      priorDate: '2026-11-14',
      sleepScore: 64,
      flagged: true,
      xpDelta: 0,
      flag: 'Sleep score 64 after caffeine at or after 2:00 PM America/Chicago the prior day.',
    });
    expect(res.body.flag).not.toMatch(/more caffeine|another cup|take caffeine/i);
    expect(res.body).not.toHaveProperty('xpAwarded');
  });

  it('stays quiet at a score of 70, before 2:00 PM, and when the dose is not on the prior day', async () => {
    remember('2026-11-14', {
      food_log: [{ item: 'Coffee', protein: 0, calories: 0, ts: '2026-11-14T19:59:00.000Z', caffeineMg: 95 }],
    });
    ouraByDate.mockResolvedValue({ no_data: false, sleep: { missing: false, score: 69, hours: 7 } });
    const early = await request(app()).get('/api/system/caffeine-sleep-flag?date=2026-11-15');
    expect(early.body.flagged).toBe(false);
    expect(early.body.xpDelta).toBe(0);

    ouraByDate.mockResolvedValue({ no_data: false, sleep: { missing: false, score: 70, hours: 7 } });
    remember('2026-07-15', {
      food_log: [{ item: 'Coffee', protein: 0, calories: 0, ts: '2026-07-15T19:00:00.000Z', caffeineMg: 95 }],
    });
    const atSeventy = await request(app()).get('/api/system/caffeine-sleep-flag?date=2026-07-16');
    expect(atSeventy.body.flagged).toBe(false);

    ouraByDate.mockResolvedValue({ no_data: false, sleep: { missing: false, score: 55, hours: 5 } });
    const sameDay = await request(app()).get('/api/system/caffeine-sleep-flag?date=2026-07-15');
    expect(sameDay.body.flagged).toBe(false);
  });

  it('uses the journal score when Oura has no night, and does not borrow it when Oura has no score', async () => {
    remember('2026-11-15', { fitbit_score: 64, sleep_hours: 7 });
    remember('2026-11-14', {
      food_log: [{ item: 'Coffee', protein: 0, calories: 0, ts: '2026-11-14T20:00:00.000Z', caffeineMg: 40 }],
    });
    const fromJournal = await request(app()).get('/api/system/caffeine-sleep-flag?date=2026-11-15');
    expect(fromJournal.body.flagged).toBe(true);
    expect(fromJournal.body.sleepScore).toBe(64);
    expect(fromJournal.body.xpDelta).toBe(0);

    ouraByDate.mockResolvedValue({ no_data: false, sleep: { missing: false, score: null, hours: 7 } });
    const ouraWithoutScore = await request(app()).get('/api/system/caffeine-sleep-flag?date=2026-11-15');
    expect(ouraWithoutScore.body.flagged).toBe(false);
    expect(ouraWithoutScore.body.sleepScore).toBeNull();
    expect(ouraWithoutScore.body.xpDelta).toBe(0);
  });

  it('falls back to the journal when the Oura read fails and rejects a bad date', async () => {
    ouraByDate.mockRejectedValue(new Error('relation oura_daily_summaries does not exist'));
    remember('2026-11-15', { fitbit_score: 61, sleep_hours: 6 });
    remember('2026-11-14', {
      food_log: [{ item: 'Tea', protein: 0, calories: 0, ts: '2026-11-14T21:00:00.000Z', caffeineMg: 30 }],
    });
    const res = await request(app()).get('/api/system/caffeine-sleep-flag?date=2026-11-15');
    expect(res.status).toBe(200);
    expect(res.body.flagged).toBe(true);
    expect(res.body.xpDelta).toBe(0);

    const bad = await request(app()).get('/api/system/caffeine-sleep-flag?date=2026-02-31');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_date');
  });

  it('does not flag a night that has hours and no score', async () => {
    remember('2026-11-15', { sleep_hours: 7.5 });
    remember('2026-11-14', {
      food_log: [{ item: 'Coffee', protein: 0, calories: 0, ts: '2026-11-14T20:00:00.000Z', caffeineMg: 95 }],
    });
    const res = await request(app()).get('/api/system/caffeine-sleep-flag?date=2026-11-15');
    expect(res.body.flagged).toBe(false);
    expect(res.body.sleepScore).toBeNull();
    expect(res.body.xpDelta).toBe(0);
  });
});
