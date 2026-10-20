/**
 * System quests — idempotent create, single resolution, server-side XP,
 * deadline expiry, hidden masking, and service-key scope.
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

const mockGetUser = jest.fn();
const mockGetCharacterStats = jest.fn();
const mockUpsertCharacterStats = jest.fn();
const mockLogActivity = jest.fn();

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
    getCharacterStats: (...args: unknown[]) => mockGetCharacterStats(...args),
    upsertCharacterStats: (...args: unknown[]) => mockUpsertCharacterStats(...args),
    logActivity: (...args: unknown[]) => mockLogActivity(...args),
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
  app.get('/api/activities/ping', (_req, res) => res.json({ ok: true }));
  app.get('/api/auth/api-key', (_req, res) => res.json({ apiKey: 'should-not-leak' }));
  app.use('/api/system', systemRouter);
  return app;
}

function daily(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: 'daily-mobility-2026-10-20',
    kind: 'daily',
    title: 'Mobility walk',
    description: 'Twenty easy minutes outside.',
    objectives: [{ id: 'walk', label: 'Walk 20 minutes', target: 20 }],
    xpReward: { Warrior: 40 },
    scheduledFor: '2026-10-20',
    ...overrides,
  };
}

beforeEach(() => {
  setSystemQuestStore(new MemorySystemQuestStore());
  setServiceCredentialStore(new MemoryServiceCredentialStore());
  mockGetUser.mockReset().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
  mockGetCharacterStats.mockReset().mockResolvedValue([
    { user_id: 'paul', class_name: 'Warrior', level: 2, current_xp: 100, total_xp: 500 },
  ]);
  mockUpsertCharacterStats.mockReset().mockResolvedValue(undefined);
  mockLogActivity.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/system/quests — idempotency and rules', () => {
  it('creates a quest once and replays the same id when the key is reused', async () => {
    const first = await request(userApp()).post('/api/system/quests').send(daily());
    expect(first.status).toBe(201);
    expect(first.body.idempotentReplay).toBe(false);
    expect(first.body.quest.title).toBe('Mobility walk');

    const second = await request(userApp())
      .post('/api/system/quests')
      .send(daily({ title: 'A different title that must be ignored', idempotencyKey: 'daily-mobility-2026-10-20' }));

    expect(second.status).toBe(200);
    expect(second.body.idempotentReplay).toBe(true);
    expect(second.body.quest.id).toBe(first.body.quest.id);
    expect(second.body.quest.title).toBe('Mobility walk');

    const list = await request(userApp()).get('/api/system/quests');
    expect(list.body.quests).toHaveLength(1);
  });

  it('rejects an explicit training quest scheduled on Thursday', async () => {
    const res = await request(userApp())
      .post('/api/system/quests')
      .send(daily({
        idempotencyKey: 'thu-train',
        title: 'Squat session',
        training: true,
        scheduledFor: '2026-01-01',
      }));

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('thursday_rest_day');
    expect(res.body.flagged).toBe(true);
  });

  it('flags a Thursday quest whose text looks like training', async () => {
    const res = await request(userApp())
      .post('/api/system/quests')
      .send(daily({
        idempotencyKey: 'thu-gym-word',
        title: 'Gym session',
        scheduledFor: '2026-01-01',
      }));

    expect(res.status).toBe(201);
    expect(res.body.quest.thursdayTrainingFlag).toBe(true);
    expect(res.body.warning).toMatch(/Thursday/i);
  });

  it('rejects a penalty that is extra training', async () => {
    const res = await request(userApp())
      .post('/api/system/quests')
      .send(daily({
        idempotencyKey: 'bad-penalty',
        penalty: { recoveryType: 'extra_sets', xpPenalty: { Warrior: 10 } },
      }));

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('penalty_must_be_recovery');
  });

  it('accepts a recovery penalty such as earlier lights-out', async () => {
    const res = await request(userApp())
      .post('/api/system/quests')
      .send(daily({
        idempotencyKey: 'good-penalty',
        penalty: {
          recoveryType: 'earlier_lights_out',
          xpPenalty: { Warrior: 15 },
          penaltyQuest: {
            title: 'Lights out at 21:30',
            recoveryType: 'earlier_lights_out',
            objectives: [{ label: 'In bed by 21:30' }],
          },
        },
      }));

    expect(res.status).toBe(201);
    expect(res.body.quest.penalty.recoveryType).toBe('earlier_lights_out');
  });

  it('keeps a money reward as a suggestion pending the player', async () => {
    const created = await request(userApp())
      .post('/api/system/quests')
      .send(daily({
        idempotencyKey: 'shoes',
        rewardCostsMoney: true,
        rewardNote: 'New running shoes — suggestion only',
      }));

    expect(created.status).toBe(201);
    expect(created.body.quest.rewardApproval).toBe('pending');

    const cleared = await request(userApp())
      .post(`/api/system/quests/${created.body.quest.id}/clear`)
      .send({ xp: 99999 });

    expect(cleared.status).toBe(200);
    expect(cleared.body.quest.rewardApproval).toBe('pending');
    expect(cleared.body.xpApplied).toEqual([{ className: 'Warrior', xp: 40 }]);

    const approved = await request(userApp())
      .post(`/api/system/quests/${created.body.quest.id}/reward-approval`)
      .send({ decision: 'approved' });

    expect(approved.status).toBe(200);
    expect(approved.body.quest.rewardApproval).toBe('approved');
  });
});

describe('quest resolution', () => {
  it('awards the stored XP exactly once and ignores XP in the request body', async () => {
    const created = await request(userApp()).post('/api/system/quests').send(daily());
    const id = created.body.quest.id;

    const first = await request(userApp()).post(`/api/system/quests/${id}/clear`).send({ xp: 99999, xpReward: { Warrior: 1 } });
    expect(first.status).toBe(200);
    expect(first.body.alreadyResolved).toBe(false);
    expect(first.body.quest.status).toBe('cleared');
    expect(first.body.xpApplied).toEqual([{ className: 'Warrior', xp: 40 }]);
    expect(mockUpsertCharacterStats).toHaveBeenCalledTimes(1);
    expect(mockUpsertCharacterStats.mock.calls[0][1]).toEqual(expect.objectContaining({
      class_name: 'Warrior',
      total_xp: 540,
      current_xp: 140,
    }));

    const second = await request(userApp()).post(`/api/system/quests/${id}/clear`).send({ xp: 99999 });
    expect(second.status).toBe(200);
    expect(second.body.alreadyResolved).toBe(true);
    expect(second.body.xpApplied).toEqual([]);
    expect(mockUpsertCharacterStats).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(second.body)).not.toContain('99999');
  });

  it('writes cleared quest XP on scheduledFor when that day is in the past', async () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const created = await request(userApp()).post('/api/system/quests').send(daily({
      idempotencyKey: 'backfill-day',
      scheduledFor: past,
      title: 'Easy walk',
    }));
    expect(created.status).toBe(201);

    const cleared = await request(userApp()).post(`/api/system/quests/${created.body.quest.id}/clear`).send({});
    expect(cleared.status).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledWith('paul', expect.objectContaining({
      logged_at: `${past}T12:00:00.000Z`,
    }));
  });

  it('applies the stored penalty exactly once when the quest fails', async () => {
    const created = await request(userApp())
      .post('/api/system/quests')
      .send(daily({
        idempotencyKey: 'fail-me',
        penalty: {
          recoveryType: 'mobility',
          xpPenalty: { Warrior: 15 },
          penaltyQuest: {
            title: 'Mobility only',
            recoveryType: 'mobility',
            objectives: [{ label: '10 minutes of mobility' }],
          },
        },
      }));

    const failed = await request(userApp()).post(`/api/system/quests/${created.body.quest.id}/fail`).send({ xp: 99999 });
    expect(failed.status).toBe(200);
    expect(failed.body.quest.status).toBe('failed');
    expect(failed.body.xpApplied).toEqual([{ className: 'Warrior', xp: -15 }]);
    expect(mockUpsertCharacterStats.mock.calls[0][1]).toEqual(expect.objectContaining({
      total_xp: 485,
      current_xp: 85,
      level: 2,
    }));

    const list = await request(userApp()).get('/api/system/quests');
    const child = list.body.quests.find((q: { title: string | null }) => q.title === 'Mobility only');
    expect(child).toBeTruthy();
    expect(child.kind).toBe('penalty');
    expect(child.training).toBe(false);

    await request(userApp()).post(`/api/system/quests/${created.body.quest.id}/fail`).send({});
    expect(mockUpsertCharacterStats).toHaveBeenCalledTimes(1);
  });

  it('expires a quest past its deadline and applies the penalty once', async () => {
    const created = await request(userApp())
      .post('/api/system/quests')
      .send(daily({
        idempotencyKey: 'expired',
        deadline: '2020-01-01T00:00:00.000Z',
        xpReward: { Warrior: 40 },
        penalty: { recoveryType: 'rest', xpPenalty: { Warrior: 10 } },
      }));

    expect(created.status).toBe(201);
    expect(created.body.quest.status).toBe('expired');
    expect(created.body.xpApplied).toBeUndefined();
    expect(mockUpsertCharacterStats).toHaveBeenCalledTimes(1);
    expect(mockUpsertCharacterStats.mock.calls[0][1].total_xp).toBe(490);

    await request(userApp()).get('/api/system/quests');
    expect(mockUpsertCharacterStats).toHaveBeenCalledTimes(1);
  });

  it('updates objective progress on an active quest', async () => {
    const created = await request(userApp()).post('/api/system/quests').send(daily());
    const res = await request(userApp())
      .patch(`/api/system/quests/${created.body.quest.id}/progress`)
      .send({ objectiveId: 'walk', progress: 20 });

    expect(res.status).toBe(200);
    expect(res.body.quest.objectives[0]).toEqual(expect.objectContaining({ progress: 20, done: true }));
  });
});

describe('hidden quests', () => {
  it('masks hidden quests in listings until they are revealed', async () => {
    const created = await request(userApp())
      .post('/api/system/quests')
      .send(daily({
        idempotencyKey: 'hidden-1',
        kind: 'hidden',
        title: 'Secret Door Protocol',
        description: 'Do not show this sentence.',
      }));

    expect(created.status).toBe(201);
    expect(created.body.quest.title).toBe('Secret Door Protocol');

    const list = await request(userApp()).get('/api/system/quests');
    expect(list.body.quests).toHaveLength(1);
    expect(list.body.quests[0].hidden).toBe(true);
    expect(list.body.quests[0].title).toBeNull();
    expect(list.body.quests[0].objectives).toEqual([]);
    expect(JSON.stringify(list.body)).not.toContain('Secret Door Protocol');
    expect(JSON.stringify(list.body)).not.toContain('Do not show this sentence');

    const revealed = await request(userApp()).post(`/api/system/quests/${created.body.quest.id}/reveal`);
    expect(revealed.body.quest.title).toBe('Secret Door Protocol');

    const after = await request(userApp()).get('/api/system/quests');
    expect(after.body.quests[0].title).toBe('Secret Door Protocol');
    expect(after.body.quests[0].hidden).toBe(false);
  });
});

describe('service credentials', () => {
  async function mint(): Promise<string> {
    const res = await request(userApp())
      .post('/api/system/credentials')
      .send({ name: 'Grok Bot' });
    expect(res.status).toBe(201);
    expect(res.body.token.startsWith('sys_')).toBe(true);
    expect(res.body.credential.scopes).toEqual(['system']);
    return res.body.token as string;
  }

  it('lets a service key use System routes and blocks every other route', async () => {
    const token = await mint();
    const app = authedApp();

    const quest = await request(app)
      .post('/api/system/quests')
      .set('Authorization', `Bearer ${token}`)
      .send(daily({ idempotencyKey: 'from-bot' }));
    expect(quest.status).toBe(201);
    expect(quest.body.quest.source).toBe('grokbot');

    const ping = await request(app)
      .get('/api/activities/ping')
      .set('Authorization', `Bearer ${token}`);
    expect(ping.status).toBe(403);
    expect(ping.body.error).toBe('service_key_scope');

    const key = await request(app)
      .get('/api/auth/api-key')
      .set('Authorization', `Bearer ${token}`);
    expect(key.status).toBe(403);

    const mintAgain = await request(app)
      .post('/api/system/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'another' });
    expect(mintAgain.status).toBe(403);

    const approve = await request(app)
      .post('/api/system/quests')
      .set('Authorization', `Bearer ${token}`)
      .send(daily({
        idempotencyKey: 'bot-money',
        rewardCostsMoney: true,
        rewardNote: 'Cafe visit',
      }));
    const decision = await request(app)
      .post(`/api/system/quests/${approve.body.quest.id}/reward-approval`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'approved' });
    expect(decision.status).toBe(403);
    expect(decision.body.error).toBe('approval_required');
  });

  it('rejects a Thursday training quest from a service key and stops accepting a revoked key', async () => {
    const token = await mint();
    const app = authedApp();

    const thursday = await request(app)
      .post('/api/system/quests')
      .set('Authorization', `Bearer ${token}`)
      .send(daily({
        idempotencyKey: 'bot-thursday',
        training: true,
        scheduledFor: '2026-01-01',
        acknowledgeThursdayRest: true,
      }));
    expect(thursday.status).toBe(422);
    expect(thursday.body.error).toBe('thursday_rest_day');

    const listed = await request(userApp()).get('/api/system/credentials');
    const id = listed.body.credentials[0].id as string;
    const revoked = await request(userApp()).delete(`/api/system/credentials/${id}`);
    expect(revoked.body.credential.revokedAt).toBeTruthy();

    const after = await request(app)
      .get('/api/system/quests')
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it('posts and lists System messages', async () => {
    const token = await mint();
    const app = authedApp();
    const posted = await request(app)
      .post('/api/system/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: 'msg-1', body: 'The System is watching.' });
    expect(posted.status).toBe(201);

    const replay = await request(app)
      .post('/api/system/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: 'msg-1', body: 'different' });
    expect(replay.status).toBe(200);
    expect(replay.body.message.id).toBe(posted.body.message.id);
    expect(replay.body.message.body).toBe('The System is watching.');

    const list = await request(userApp()).get('/api/system/messages');
    expect(list.body.messages).toHaveLength(1);
  });
});
