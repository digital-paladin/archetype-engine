/**
 * Route smoke tests for /api/abstinence/* (mocked service).
 */

import express from 'express';
import request from 'supertest';

jest.mock('../services/abstinence.service', () => ({
  todayChicago: () => '2026-07-17',
  getStreaksForUser: jest.fn(async () => [
    {
      item_index: 0,
      current_streak: 47,
      longest_streak: 89,
      last_break_date: null,
      last_break_type: null,
      broke_today: false,
      amcc_label: '+aMCC  Very High resistance',
      amcc_tooltip: 'tip',
      resistance_events: [],
      break_log: [],
    },
  ]),
  logBreak: jest.fn(async ({ itemIndex }: { itemIndex: number }) => ({
    streak: {
      item_index: itemIndex,
      current_streak: 0,
      longest_streak: 89,
      last_break_date: '2026-07-17',
      last_break_type: 'unscheduled',
      broke_today: true,
      amcc_label: '+aMCC  Very High resistance',
      amcc_tooltip: 'tip',
      resistance_events: [],
      break_log: [],
    },
    compound_break: itemIndex === 0,
    already_broken_today: false,
  })),
  logResistanceEvent: jest.fn(async () => ({
    item_index: 0,
    current_streak: 47,
    longest_streak: 89,
    last_break_date: null,
    last_break_type: null,
    broke_today: false,
    amcc_label: '+aMCC  Very High resistance',
    amcc_tooltip: 'tip',
    resistance_events: [{ date: '2026-07-17', note: 'win' }],
    break_log: [],
  })),
  getResistanceEvents: jest.fn(async () => [{ date: '2026-07-17', note: 'win' }]),
  runDailyIncrement: jest.fn(async () => ({
    scanned: 2,
    incremented: 2,
    new_records: [{ user_id: 'u', item_index: 0, streak: 48 }],
  })),
}));

import abstinenceRouter from './abstinence.routes';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 'test-user';
    next();
  });
  app.use('/api/abstinence', abstinenceRouter);
  return app;
}

describe('abstinence.routes', () => {
  it('GET /streaks returns streaks', async () => {
    const res = await request(makeApp()).get('/api/abstinence/streaks');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.streaks[0].current_streak).toBe(47);
  });

  it('POST /break rejects bad item_index', async () => {
    const res = await request(makeApp()).post('/api/abstinence/break').send({ item_index: 3 });
    expect(res.status).toBe(400);
  });

  it('POST /break returns compound_break flag', async () => {
    const res = await request(makeApp())
      .post('/api/abstinence/break')
      .send({ item_index: 0, break_type: 'unscheduled' });
    expect(res.status).toBe(200);
    expect(res.body.compound_break).toBe(true);
    expect(res.body.streak.current_streak).toBe(0);
  });

  it('POST /resistance-event works', async () => {
    const res = await request(makeApp())
      .post('/api/abstinence/resistance-event')
      .send({ item_index: 0, note: 'win' });
    expect(res.status).toBe(200);
    expect(res.body.streak.resistance_events).toHaveLength(1);
  });

  it('GET /resistance-events requires item_index', async () => {
    const bad = await request(makeApp()).get('/api/abstinence/resistance-events');
    expect(bad.status).toBe(400);
    const ok = await request(makeApp()).get('/api/abstinence/resistance-events?item_index=0');
    expect(ok.status).toBe(200);
    expect(ok.body.resistance_events).toHaveLength(1);
  });

  it('POST /daily-increment returns counts', async () => {
    const res = await request(makeApp()).post('/api/abstinence/daily-increment');
    expect(res.status).toBe(200);
    expect(res.body.incremented).toBe(2);
    expect(res.body.new_records).toHaveLength(1);
  });
});
