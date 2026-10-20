/**
 * POST /api/activities — Recovery & Consistency quest guards.
 */
import request from 'supertest';
import express, { Express } from 'express';

const mockLogActivity = jest.fn().mockResolvedValue(undefined);
const mockGetActivityLog = jest.fn();
const mockGetActivitiesByTypePrefix = jest.fn();

jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    logActivity:                (...args: any[]) => mockLogActivity(...args),
    getActivityLog:             (...args: any[]) => mockGetActivityLog(...args),
    getActivitiesByTypePrefix:  (...args: any[]) => mockGetActivitiesByTypePrefix(...args),
    getCharacterStats:          jest.fn().mockResolvedValue([]),
    upsertCharacterStats:       jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('../services/bodyStatus.service', () => ({
  getActiveBodyStatuses: jest.fn().mockResolvedValue([]),
}));

import { activityRouter } from './activity.routes';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.userId = 'test-user'; next(); });
  app.use('/api/activities', activityRouter);
  return app;
}
const flush = async () => { await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); };

beforeEach(() => {
  mockLogActivity.mockClear();
  mockGetActivityLog.mockReset();
  mockGetActivitiesByTypePrefix.mockReset().mockResolvedValue([]);
});

describe('POST /api/activities — recovery quests', () => {
  it('awards flat server XP and ignores client-supplied XP', async () => {
    mockGetActivityLog.mockResolvedValue([]);
    const res = await request(makeApp()).post('/api/activities')
      .send({ activityType: 'recovery-xray-order', xp: 9999, clientDate: '2026-10-19', notes: 'order from Dr. X' });
    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(40);
    await flush();
    expect(mockLogActivity.mock.calls[0][1]).toMatchObject({
      activity_type: 'recovery-xray-order', class_name: 'Warrior', xp_awarded: 40,
      notes: '[claim-date:2026-10-19] order from Dr. X',
    });
  });

  it('returns 409 and logs nothing when a guard fails', async () => {
    mockGetActivityLog.mockResolvedValue([]);
    const res = await request(makeApp()).post('/api/activities')
      .send({ activityType: 'recovery-rest-day', clientDate: '2026-10-19' }); // Monday
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Thursday/);
    await flush();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it('does not touch the activity log for normal activities', async () => {
    const res = await request(makeApp()).post('/api/activities').send({ activityType: 'workout-strength', duration: 60 });
    expect(res.status).toBe(200);
    expect(mockGetActivityLog).not.toHaveBeenCalled();
    expect(mockGetActivitiesByTypePrefix).not.toHaveBeenCalled();
  });

  it('returns 409 for an impossible claim date and does not read or write the log', async () => {
    const res = await request(makeApp()).post('/api/activities')
      .send({ activityType: 'recovery-rest-day', clientDate: '2026-09-31' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/calendar day/);
    expect(mockGetActivityLog).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it('sees a one-time step that is only in the recovery history', async () => {
    mockGetActivityLog.mockResolvedValue([]);
    mockGetActivitiesByTypePrefix.mockResolvedValue([{
      id: 'old-order', user_id: 'test-user', class_name: 'Warrior',
      activity_type: 'recovery-xray-order', logged_at: '2020-01-02T17:00:00.000Z',
      notes: '[claim-date:2020-01-02]',
    }]);
    const res = await request(makeApp()).post('/api/activities')
      .send({ activityType: 'recovery-xray-order', clientDate: '2026-10-19' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already completed/);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });
});
