/**
 * bodyStatus.routes.ts — Unit tests
 *
 * GET    /api/body-status      → active-only rows via getActiveBodyStatuses()
 * POST   /api/body-status      → validates + db.addBodyStatus()
 * PATCH  /api/body-status/:id  → db.updateBodyStatus()
 * DELETE /api/body-status/:id  → db.removeBodyStatus()
 */

import request from 'supertest';
import express, { Express } from 'express';

// ── Mocks BEFORE importing the route ───────────────────────────────────────
const mockGetBodyStatuses    = jest.fn<Promise<any[]>, any[]>();
const mockAddBodyStatus      = jest.fn<Promise<any>, any[]>();
const mockUpdateBodyStatus   = jest.fn<Promise<void>, any[]>();
const mockRemoveBodyStatus   = jest.fn<Promise<void>, any[]>();

jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    getBodyStatuses:  (...args: any[]) => mockGetBodyStatuses(...args),
    addBodyStatus:    (...args: any[]) => mockAddBodyStatus(...args),
    updateBodyStatus: (...args: any[]) => mockUpdateBodyStatus(...args),
    removeBodyStatus: (...args: any[]) => mockRemoveBodyStatus(...args),
  }),
}));

// ── Import AFTER mocks ──────────────────────────────────────────────────────
import router from './bodyStatus.routes';

function makeApp(withAuth = true): Express {
  const app = express();
  app.use(express.json());
  if (withAuth) {
    app.use((req: any, _res: any, next: any) => { req.userId = 'test-user'; next(); });
  }
  app.use('/api/body-status', router);
  return app;
}

beforeEach(() => {
  mockGetBodyStatuses.mockReset();
  mockAddBodyStatus.mockReset();
  mockUpdateBodyStatus.mockReset();
  mockRemoveBodyStatus.mockReset();
});

describe('GET /api/body-status', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(makeApp(false)).get('/api/body-status');
    expect(res.status).toBe(401);
  });

  it('returns only active statuses (healed rows filtered out)', async () => {
    const daysAgo = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return d.toISOString();
    };
    mockGetBodyStatuses.mockResolvedValue([
      { id: 'a', body_part: 'left-knee', type: 'injury', severity: 'moderate',
        name: 'Active', start_date: daysAgo(1), estimated_recovery_days: 7 },
      { id: 'b', body_part: 'left-knee', type: 'injury', severity: 'minor',
        name: 'Healed', start_date: daysAgo(30), estimated_recovery_days: 7 },
    ]);

    const res = await request(makeApp()).get('/api/body-status');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.statuses).toHaveLength(1);
    expect(res.body.statuses[0].id).toBe('a');
    expect(mockGetBodyStatuses).toHaveBeenCalledWith('test-user');
  });

  it('returns 500 on db error', async () => {
    mockGetBodyStatuses.mockRejectedValue(new Error('db down'));
    const res = await request(makeApp()).get('/api/body-status');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/body-status', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(makeApp(false)).post('/api/body-status').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(makeApp()).post('/api/body-status').send({ bodyPart: 'left-knee' });
    expect(res.status).toBe(400);
    expect(mockAddBodyStatus).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid type', async () => {
    const res = await request(makeApp()).post('/api/body-status').send({
      bodyPart: 'left-knee', type: 'curse', severity: 'minor', name: 'Test',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid severity', async () => {
    const res = await request(makeApp()).post('/api/body-status').send({
      bodyPart: 'left-knee', type: 'injury', severity: 'catastrophic', name: 'Test',
    });
    expect(res.status).toBe(400);
  });

  it('maps camelCase body to snake_case row and creates it', async () => {
    mockAddBodyStatus.mockResolvedValue({ id: 'new-id', body_part: 'left-knee' });

    const res = await request(makeApp()).post('/api/body-status').send({
      bodyPart: 'left-knee', type: 'injury', severity: 'moderate', name: 'Sprain',
      description: 'Twisted it', estimatedRecoveryDays: 10, impactsActions: ['workout'], xpPenalty: 20,
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mockAddBodyStatus).toHaveBeenCalledWith('test-user', expect.objectContaining({
      body_part: 'left-knee',
      type: 'injury',
      severity: 'moderate',
      name: 'Sprain',
      description: 'Twisted it',
      estimated_recovery_days: 10,
      impacts_actions: ['workout'],
      xp_penalty: 20,
    }));
  });
});

describe('PATCH /api/body-status/:id', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(makeApp(false)).patch('/api/body-status/abc').send({ notes: 'x' });
    expect(res.status).toBe(401);
  });

  it('maps provided fields to snake_case and delegates to db.updateBodyStatus', async () => {
    mockUpdateBodyStatus.mockResolvedValue(undefined);

    const res = await request(makeApp()).patch('/api/body-status/abc').send({
      notes: 'Feeling better', estimatedRecoveryDays: 5,
    });

    expect(res.status).toBe(200);
    expect(mockUpdateBodyStatus).toHaveBeenCalledWith('test-user', 'abc', {
      notes: 'Feeling better',
      estimated_recovery_days: 5,
    });
  });

  it('returns 500 on db error', async () => {
    mockUpdateBodyStatus.mockRejectedValue(new Error('db down'));
    const res = await request(makeApp()).patch('/api/body-status/abc').send({ notes: 'x' });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/body-status/:id', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(makeApp(false)).delete('/api/body-status/abc');
    expect(res.status).toBe(401);
  });

  it('delegates to db.removeBodyStatus and returns success', async () => {
    mockRemoveBodyStatus.mockResolvedValue(undefined);
    const res = await request(makeApp()).delete('/api/body-status/abc');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockRemoveBodyStatus).toHaveBeenCalledWith('test-user', 'abc');
  });

  it('returns 500 on db error', async () => {
    mockRemoveBodyStatus.mockRejectedValue(new Error('db down'));
    const res = await request(makeApp()).delete('/api/body-status/abc');
    expect(res.status).toBe(500);
  });
});
