/**
 * Smart-scale readings.
 * POST /api/system/body-composition — player session or system service key.
 * GET  /api/system/body-composition — same credentials.
 * GET  /api/body-composition — player session only.
 * A reading does not award XP.
 */

import request from 'supertest';
import express, { Express } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import {
  MemoryServiceCredentialStore,
  setServiceCredentialStore,
} from '../services/serviceCredential.store';
import {
  MemorySystemQuestStore,
  setSystemQuestStore,
} from '../services/systemQuest.store';
import {
  MemoryBodyCompositionStore,
  setBodyCompositionStore,
} from '../services/bodyComposition.store';

const mockGetUser = jest.fn();

jest.mock('../lib/supabase', () => ({
  getSupabaseAuth: () => ({
    auth: { getUser: (token: string) => mockGetUser(token) },
  }),
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        neq: () => Promise.resolve({ data: [] }),
      }),
    }),
  }),
}));

jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    logActivity: () => {
      throw new Error('body composition must not log activity');
    },
    appendXPHistory: () => {
      throw new Error('body composition must not award XP');
    },
    upsertCharacterStats: () => {
      throw new Error('body composition must not award XP');
    },
  }),
}));

import systemRouter from './system.routes';
import bodyCompositionRouter from './bodyComposition.routes';

function userApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { userId?: string; authKind?: string }).userId = 'player-1';
    (req as express.Request & { authKind?: string }).authKind = 'user';
    next();
  });
  app.use('/api/system', systemRouter);
  app.use('/api/body-composition', bodyCompositionRouter);
  return app;
}

function playerApp(userId?: string): Express {
  const app = express();
  app.use(express.json());
  if (userId) {
    app.use((req, _res, next) => {
      (req as express.Request & { userId?: string }).userId = userId;
      next();
    });
  }
  app.use('/api/body-composition', bodyCompositionRouter);
  return app;
}

function authedApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api/system', systemRouter);
  app.use('/api/body-composition', bodyCompositionRouter);
  return app;
}

const sparse = {
  idempotencyKey: 'scale-example-001',
  source: 'hume',
  measuredAt: '2026-01-15T15:00:00.000Z',
  fasted: true,
  context: 'morning',
  notes: 'synthetic fixture',
  healthScore: 111,
  healthScoreLabel: 'Example Band',
  healthScoreConfidencePct: 42,
  biologicalAgeYears: 30,
  metabolicAgeYears: 28.5,
  bodyFatPct: 15.5,
  bodyWaterPct: 60,
  skeletalMuscleMassLb: 50.25,
  weightLb: null,
  bodyCompositionGrade: 'B',
  activityGrade: 'C',
  sleepGrade: 'A-',
  bodyFatLabel: 'Example High',
  bodyWaterLabel: 'Example Standard',
  xp: 99999,
};

beforeEach(() => {
  setBodyCompositionStore(new MemoryBodyCompositionStore());
  setSystemQuestStore(new MemorySystemQuestStore());
  setServiceCredentialStore(new MemoryServiceCredentialStore());
  mockGetUser.mockReset().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
});

describe('POST /api/system/body-composition', () => {
  it('requires an idempotency key', async () => {
    const res = await request(userApp()).post('/api/system/body-composition').send({
      source: 'hume',
      measuredAt: '2026-01-15T15:00:00.000Z',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body_composition');
  });

  it('stores a reading, replays the key, and does not award XP', async () => {
    const created = await request(userApp()).post('/api/system/body-composition').send(sparse);
    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);
    expect(created.body.idempotentReplay).toBe(false);
    expect(created.body.reading.weightLb).toBeNull();
    expect(created.body.reading.healthScore).toBe(111);
    expect(created.body.reading.sleepGrade).toBe('A-');
    expect(created.body.reading.bodyFatLabel).toBe('Example High');
    expect(created.body.reading).not.toHaveProperty('xp');

    const replay = await request(userApp()).post('/api/system/body-composition').send({
      ...sparse,
      healthScore: 999,
      weightLb: 400,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.reading.id).toBe(created.body.reading.id);
    expect(replay.body.reading.healthScore).toBe(111);
    expect(replay.body.reading.weightLb).toBeNull();
  });

  it('lets a service key write and read, and blocks the player path', async () => {
    const minted = await request(userApp()).post('/api/system/credentials').send({ name: 'Scale Bot' });
    const token = minted.body.token as string;
    const app = authedApp();

    const created = await request(app)
      .post('/api/system/body-composition')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...sparse, idempotencyKey: 'scale-example-service' });
    expect(created.status).toBe(201);
    expect(created.body.reading.source).toBe('hume');

    const listed = await request(app)
      .get('/api/system/body-composition')
      .set('Authorization', `Bearer ${token}`);
    expect(listed.status).toBe(200);
    expect(listed.body.readings).toHaveLength(1);
    expect(listed.body.readings[0].idempotencyKey).toBe('scale-example-service');

    const playerPath = await request(app)
      .get('/api/body-composition')
      .set('Authorization', `Bearer ${token}`);
    expect(playerPath.status).toBe(403);
    expect(playerPath.body.error).toBe('service_key_scope');
  });
});

describe('GET /api/body-composition', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(playerApp()).get('/api/body-composition');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns the player readings newest first', async () => {
    await request(userApp()).post('/api/system/body-composition').send(sparse);
    await request(userApp()).post('/api/system/body-composition').send({
      ...sparse,
      idempotencyKey: 'scale-example-002',
      measuredAt: '2026-04-01T12:00:00.000Z',
      weightLb: 160.4,
    });

    const res = await request(playerApp('player-1')).get('/api/body-composition?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.readings).toHaveLength(1);
    expect(res.body.readings[0].weightLb).toBe(160.4);
    expect(res.body.readings[0].idempotencyKey).toBe('scale-example-002');
  });

  it('rejects a bad limit', async () => {
    const res = await request(playerApp('player-1')).get('/api/body-composition?limit=0');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body_composition');
  });
});
