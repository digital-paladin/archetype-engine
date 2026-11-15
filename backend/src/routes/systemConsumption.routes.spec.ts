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
    listJournalFoodDays: async (userId: string) => {
      const days = [];
      for (const [key, row] of entries) {
        if (!key.startsWith(`${userId}:`) || !Array.isArray(row.food_log)) continue;
        days.push({
          entry_date: String(row.entry_date ?? key.slice(userId.length + 1)),
          food_log: row.food_log,
          protein_grams_logged: row.protein_grams_logged,
          meal_count: row.meal_count,
          hydration_oz: row.hydration_oz,
          sleep_start: row.sleep_start,
        });
      }
      return days;
    },
  }),
}));

import systemRouter from './system.routes';
import consumeRouter from './consume.routes';
import { getLogs, resetActivityLogForTests } from '../services/activityLogStore';

function userApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { userId?: string; authKind?: string }).userId = 'paul';
    (req as express.Request & { authKind?: string }).authKind = 'user';
    next();
  });
  app.use('/api/consume', consumeRouter);
  app.use('/api/system', systemRouter);
  return app;
}

function authedApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api/consume', consumeRouter);
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
  resetActivityLogForTests();
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

describe('PATCH /api/system/consumption/:id', () => {
  const dessert = {
    idempotencyKey: 'tres-leches-2026-10-27',
    itemName: 'Tres Leches Slice',
    calories: 540,
    protein: 9,
    consumedAt: '2026-10-27T19:30:00-05:00',
    clientDate: '2026-10-27',
  };

  async function serviceToken(): Promise<{ app: Express; token: string }> {
    const minted = await request(userApp()).post('/api/system/credentials').send({ name: 'Grok Bot' });
    return { app: authedApp(), token: minted.body.token as string };
  }

  it('rejects a missing credential', async () => {
    const res = await request(authedApp()).patch('/api/system/consumption/missing').send({ addedSugarG: 1 });
    expect(res.status).toBe(401);
  });

  it('requires an idempotency key', async () => {
    const { app, token } = await serviceToken();
    const res = await request(app)
      .patch('/api/system/consumption/missing')
      .set('Authorization', `Bearer ${token}`)
      .send({ addedSugarG: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_consumption');
  });

  it('returns 404 for an unknown id', async () => {
    const { app, token } = await serviceToken();
    const res = await request(app)
      .patch('/api/system/consumption/does-not-exist')
      .set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: 'missing-row', addedSugarG: 42.5 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('lists the day, corrects added sugar, and does not log a second meal', async () => {
    const { app, token } = await serviceToken();
    const created = await request(app)
      .post('/api/system/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(dessert);
    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();
    expect(created.body.mealCount).toBe(1);

    const listed = await request(app)
      .get('/api/system/consumption')
      .query({ date: '2026-10-27' })
      .set('Authorization', `Bearer ${token}`);
    expect(listed.status).toBe(200);
    expect(listed.body.entries).toHaveLength(1);
    expect(listed.body.entries[0].id).toBe(created.body.id);
    expect(listed.body.entries[0].addedSugarG).toBe(0);

    const corrected = await request(app)
      .patch(`/api/system/consumption/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        idempotencyKey: 'tres-leches-sugar',
        addedSugarG: 42.5,
        totalSugarG: 42.5,
        notes: 'Label sugar for the portion eaten',
        reason: 'Label was read after the meal was logged',
      });
    expect(corrected.status).toBe(200);
    expect(corrected.body.idempotentReplay).toBe(false);
    expect(corrected.body.dietFlags).toEqual(['added-sugar']);
    expect(corrected.body.entry.addedSugarG).toBe(42.5);
    expect(corrected.body.entry.totalSugarG).toBe(42.5);
    expect(corrected.body.mealCount).toBe(1);
    expect(corrected.body.proteinGrams).toBe(9);
    const rush = corrected.body.effects.find((effect: { effectKey: string }) => effect.effectKey === 'sugar');
    expect(rush.name).toBe('Sugar Rush');
    expect(rush.dose).toBe('42.5 g added sugar');
    expect(corrected.body.noticeBody).toContain('Corrected Tres Leches Slice');
    expect(getLogs()).toHaveLength(0);

    const replay = await request(app)
      .patch(`/api/system/consumption/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: 'tres-leches-sugar', addedSugarG: 90 });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.entry.addedSugarG).toBe(42.5);

    const messages = await request(app)
      .get('/api/system/messages')
      .set('Authorization', `Bearer ${token}`);
    expect(messages.body.messages).toHaveLength(2);
  });

  it('assigns an id to a legacy row and lets the player correct it without a second activity line', async () => {
    entries.set('paul:2026-10-27', {
      user_id: 'paul',
      entry_date: '2026-10-27',
      protein_grams_logged: 9,
      meal_count: 1,
      food_log: [{ item: 'Tres Leches Slice', protein: 9, calories: 540, ts: '2026-10-27T19:30:00-05:00' }],
    });
    const listed = await request(userApp()).get('/api/consume').query({ date: '2026-10-27' });
    expect(listed.status).toBe(200);
    const id = listed.body.entries[0].id as string;
    expect(id).toBeTruthy();

    const logged = await request(userApp()).post('/api/consume').send({
      itemName: 'Water',
      waterOz: 8,
      consumedAt: '2026-10-27T12:00:00-05:00',
      clientDate: '2026-10-27',
    });
    expect(logged.status).toBe(200);
    expect(getLogs()).toHaveLength(1);

    const corrected = await request(userApp()).patch(`/api/consume/${id}`).send({ addedSugarG: 42.5 });
    expect(corrected.status).toBe(200);
    expect(corrected.body.dietFlags).toContain('added-sugar');
    expect(corrected.body.effects.find((effect: { name: string }) => effect.name === 'Sugar Rush')).toBeTruthy();
    expect(corrected.body.mealCount).toBe(1);
    expect(corrected.body.noticeBody).toBeNull();
    expect(getLogs()).toHaveLength(1);
  });

  it('blocks a service key from the player correction route', async () => {
    const { app, token } = await serviceToken();
    const res = await request(app)
      .patch('/api/consume/whatever')
      .set('Authorization', `Bearer ${token}`)
      .send({ addedSugarG: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('service_key_scope');
  });

  it('lets a player session correct through the user route', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'player-2' } }, error: null });
    const app = authedApp();
    const created = await request(app)
      .post('/api/consume')
      .set('Authorization', 'Bearer player-session')
      .send({
        itemName: 'Tres Leches Slice',
        calories: 540,
        protein: 9,
        consumedAt: '2026-10-27T19:30:00-05:00',
        clientDate: '2026-10-27',
      });
    expect(created.status).toBe(200);
    const corrected = await request(app)
      .patch(`/api/consume/${created.body.id}`)
      .set('Authorization', 'Bearer player-session')
      .send({ addedSugarG: 42.5, notes: 'canola oil glaze' });
    expect(corrected.status).toBe(200);
    expect(corrected.body.dietFlags).toEqual(expect.arrayContaining(['added-sugar', 'seed-oil']));
    expect(corrected.body.entry.addedSugarG).toBe(42.5);
  });
});
