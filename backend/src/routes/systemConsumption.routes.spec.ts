/**
 * Service-key consumption logging. Kept out of system.routes.spec.ts so it
 * does not collide with the quest-correction and activity-timestamp PRs.
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
import { MemoryStatusEffectStore, setStatusEffectStore } from '../services/statusEffect.store';

const mockGetUser = jest.fn();
const entries = new Map<string, Record<string, unknown>>();

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
    getJournalEntry: async (userId: string, date: string) => entries.get(`${userId}:${date}`) ?? null,
    upsertJournalEntry: async (userId: string, entry: { entry_date: string }) => {
      const key = `${userId}:${entry.entry_date}`;
      entries.set(key, { ...(entries.get(key) ?? {}), ...entry, user_id: userId });
    },
  }),
}));

import systemRouter from './system.routes';

function userApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { userId?: string; authKind?: string }).userId = 'paul';
    (req as express.Request & { authKind?: string }).authKind = 'user';
    next();
  });
  app.use('/api/system', systemRouter);
  return app;
}

function authedApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.post('/api/consume', (_req, res) => res.json({ ok: true }));
  app.get('/api/activities/ping', (_req, res) => res.json({ ok: true }));
  app.use('/api/system', systemRouter);
  return app;
}

const miller = {
  idempotencyKey: 'miller-2026-10-20-1900',
  itemName: 'Miller Lite (12 oz)',
  calories: 96,
  alcohol: { volumeOz: 12, abvPercent: 4.2 },
  consumedAt: '2026-10-20T19:00:00-05:00',
  bedtime: '23:00',
};

beforeEach(() => {
  entries.clear();
  setSystemQuestStore(new MemorySystemQuestStore());
  setServiceCredentialStore(new MemoryServiceCredentialStore());
  setStatusEffectStore(new MemoryStatusEffectStore());
  mockGetUser.mockReset().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
});

describe('POST /api/system/consumption', () => {
  it('requires an idempotency key', async () => {
    const res = await request(userApp()).post('/api/system/consumption').send({ itemName: 'Water', waterOz: 8 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_consumption');
  });

  it('lets a service key log a beer, replay it, and still blocks other routes', async () => {
    const minted = await request(userApp()).post('/api/system/credentials').send({ name: 'Grok Bot' });
    const token = minted.body.token as string;
    const app = authedApp();

    const created = await request(app)
      .post('/api/system/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(miller);
    expect(created.status).toBe(201);
    expect(created.body.idempotentReplay).toBe(false);
    expect(created.body.abstinencePrompt.broken).toBe(false);
    const shadow = created.body.effects.find((effect: { effectKey: string }) => effect.effectKey === 'alcohol');
    expect(shadow.dose).toBe('0.84 standard drinks');
    expect(shadow.autoApplied).toBe(true);
    expect(shadow.source).toContain('4h before bedtime');
    expect(created.body.noticeBody).toContain('Alcohol Shadow');

    const replay = await request(app)
      .post('/api/system/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...miller, itemName: 'should be ignored' });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.effects.find((effect: { effectKey: string }) => effect.effectKey === 'alcohol').id).toBe(shadow.id);

    const messages = await request(app)
      .get('/api/system/messages')
      .set('Authorization', `Bearer ${token}`);
    expect(messages.body.messages).toHaveLength(1);

    const consume = await request(app)
      .post('/api/consume')
      .set('Authorization', `Bearer ${token}`)
      .send(miller);
    expect(consume.status).toBe(403);
    expect(consume.body.error).toBe('service_key_scope');

    const ping = await request(app)
      .get('/api/activities/ping')
      .set('Authorization', `Bearer ${token}`);
    expect(ping.status).toBe(403);
  });
});
