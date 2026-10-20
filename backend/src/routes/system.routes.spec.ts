/**
 * System quests — idempotent create, single resolution, server-side XP,
 * deadline expiry, hidden masking, service-key scope, and corrections.
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

  it('lets a service key correct an active quest', async () => {
    const token = await mint();
    const app = authedApp();
    const created = await request(app)
      .post('/api/system/quests')
      .set('Authorization', `Bearer ${token}`)
      .send(bedtime());
    const edited = await request(app)
      .patch(`/api/system/quests/${created.body.quest.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        idempotencyKey: 'bot-edit-parkour',
        reason: 'Tuesday schedule changed: parkour 7:30-8:30 PM',
        objectives: {
          update: [{ id: 'last-bite', label: 'Last bite before 9:45 PM' }],
        },
      });

    expect(edited.status).toBe(200);
    expect(edited.body.quest.objectives[0].label).toBe('Last bite before 9:45 PM');
    expect(edited.body.quest.editedAt).toBeTruthy();
  });
});

function bedtime(overrides: Record<string, unknown> = {}) {
  return daily({
    idempotencyKey: 'daily-2026-10-20-bedtime',
    title: 'Daily Quest',
    description: 'Tuesday night.',
    objectives: [
      { id: 'last-bite', label: 'Last bite before 8:20 PM', target: 1 },
      { id: 'lights-out', label: 'Lights out by 9:30 PM', target: 1 },
    ],
    deadline: '2027-06-01T02:30:00.000Z',
    penalty: {
      recoveryType: 'earlier_lights_out',
      xpPenalty: { Warrior: 15 },
      penaltyQuest: {
        title: 'Lights out at 21:30',
        recoveryType: 'earlier_lights_out',
        objectives: [{ id: 'bed', label: 'In bed by 21:30' }],
      },
    },
    ...overrides,
  });
}

describe('PATCH /api/system/quests/:id — corrections', () => {
  it('rewrites objective text, adds an objective, and moves the deadline and penalty wording', async () => {
    const created = await request(userApp()).post('/api/system/quests').send(bedtime());
    const id = created.body.quest.id as string;

    const edited = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'edit:daily:2026-10-20:parkour',
      reason: 'Tuesday schedule changed: parkour 7:30-8:30 PM',
      deadline: '2027-06-01T03:15:00.000Z',
      objectives: {
        update: [
          { id: 'last-bite', label: 'Last bite before 9:45 PM' },
          { id: 'lights-out', label: 'Lights out by 10:15 PM' },
        ],
        add: [{ id: 'parkour', label: 'Parkour technique only', target: 1 }],
      },
      penalty: {
        penaltyQuest: {
          title: 'Lights out at 22:15',
          objectives: [{ id: 'bed', label: 'In bed by 22:15' }],
        },
      },
    });

    expect(edited.status).toBe(200);
    expect(edited.body.idempotentReplay).toBe(false);
    expect(edited.body.quest.editedAt).toBeTruthy();
    expect(edited.body.quest.editCount).toBe(1);
    expect(edited.body.quest.lastEditReason).toMatch(/parkour 7:30-8:30/);
    expect(edited.body.quest.objectives.map((o: { label: string }) => o.label)).toEqual([
      'Last bite before 9:45 PM',
      'Lights out by 10:15 PM',
      'Parkour technique only',
    ]);
    expect(edited.body.quest.deadline).toBe('2027-06-01T03:15:00.000Z');
    expect(edited.body.quest.penalty.penaltyQuest.title).toBe('Lights out at 22:15');
    expect(edited.body.quest.rewardApproval).toBe('not_required');
    expect(edited.body.changes.join('\n')).toContain('Parkour technique only');

    const listed = await request(userApp()).get('/api/system/quests');
    const quest = listed.body.quests.find((q: { id: string }) => q.id === id);
    expect(quest.objectives[2].label).toBe('Parkour technique only');
    expect(quest.editedAt).toBe(edited.body.quest.editedAt);

    const messages = await request(userApp()).get('/api/system/messages');
    expect(messages.body.messages).toHaveLength(1);
    expect(messages.body.messages[0].questId).toBe(id);
    expect(messages.body.messages[0].body).toContain('Reason: Tuesday schedule changed: parkour 7:30-8:30 PM');
    expect(messages.body.messages[0].body).toContain('Last bite before 9:45 PM');
    expect(messages.body.messages[0].body).toContain('Lights out at 22:15');

    const failed = await request(userApp()).post(`/api/system/quests/${id}/fail`).send({});
    expect(failed.status).toBe(200);
    const after = await request(userApp()).get('/api/system/quests');
    const child = after.body.quests.find((q: { kind: string }) => q.kind === 'penalty');
    expect(child.title).toBe('Lights out at 22:15');
    expect(child.objectives[0].label).toBe('In bed by 22:15');
    expect(child.training).toBe(false);
  });

  it('replays the same idempotency key without applying a second edit or a second message', async () => {
    const created = await request(userApp()).post('/api/system/quests').send(bedtime());
    const id = created.body.quest.id as string;
    const first = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'edit-once',
      reason: 'schedule moved',
      objectives: { add: [{ id: 'parkour', label: 'Parkour technique only' }] },
    });
    expect(first.status).toBe(200);

    const second = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'edit-once',
      reason: 'this reason must be ignored',
      xpReward: { Warrior: 1 },
      objectives: { add: [{ id: 'extra', label: 'Should not appear' }] },
    });
    expect(second.status).toBe(200);
    expect(second.body.idempotentReplay).toBe(true);
    expect(second.body.quest.objectives.map((o: { id: string }) => o.id)).toEqual(['last-bite', 'lights-out', 'parkour']);
    expect(second.body.quest.xpReward).toEqual({ Warrior: 40 });
    expect(second.body.quest.editCount).toBe(1);
    expect(second.body.changes.join('\n')).toContain('Parkour technique only');
    expect(second.body.changes.join('\n')).not.toContain('Should not appear');

    const messages = await request(userApp()).get('/api/system/messages');
    expect(messages.body.messages).toHaveLength(1);
    expect(messages.body.messages[0].body).toContain('schedule moved');
    expect(messages.body.messages[0].body).not.toContain('this reason must be ignored');
  });

  it('rejects corrections of cleared, failed, and expired quests', async () => {
    const cleared = await request(userApp()).post('/api/system/quests').send(bedtime({ idempotencyKey: 'done' }));
    await request(userApp()).post(`/api/system/quests/${cleared.body.quest.id}/clear`).send({});
    const clearedEdit = await request(userApp()).patch(`/api/system/quests/${cleared.body.quest.id}`).send({
      idempotencyKey: 'too-late',
      title: 'Changed after clear',
    });
    expect(clearedEdit.status).toBe(409);
    expect(clearedEdit.body.error).toBe('not_active');

    const failed = await request(userApp()).post('/api/system/quests').send(bedtime({ idempotencyKey: 'failed' }));
    await request(userApp()).post(`/api/system/quests/${failed.body.quest.id}/fail`).send({});
    const failedEdit = await request(userApp()).patch(`/api/system/quests/${failed.body.quest.id}`).send({
      idempotencyKey: 'too-late-fail',
      title: 'Changed after fail',
    });
    expect(failedEdit.status).toBe(409);
    expect(failedEdit.body.error).toBe('not_active');

    const expired = await request(userApp()).post('/api/system/quests').send(bedtime({
      idempotencyKey: 'already-expired',
      deadline: '2020-01-01T00:00:00.000Z',
    }));
    expect(expired.body.quest.status).toBe('expired');
    const expiredEdit = await request(userApp()).patch(`/api/system/quests/${expired.body.quest.id}`).send({
      idempotencyKey: 'too-late-expire',
      title: 'Changed after expiry',
    });
    expect(expiredEdit.status).toBe(409);
    expect(expiredEdit.body.error).toBe('not_active');
  });

  it('removes an objective with no progress and refuses one that has started', async () => {
    const created = await request(userApp()).post('/api/system/quests').send(bedtime());
    const id = created.body.quest.id as string;
    await request(userApp()).patch(`/api/system/quests/${id}/progress`).send({ objectiveId: 'last-bite', progress: 1 });

    const blocked = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'remove-started',
      objectives: { remove: ['last-bite'] },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('objective_has_progress');

    const removed = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'remove-untouched',
      objectives: { remove: ['lights-out'] },
    });
    expect(removed.status).toBe(200);
    expect(removed.body.quest.objectives.map((o: { id: string }) => o.id)).toEqual(['last-bite']);
    expect(removed.body.quest.objectives[0].progress).toBe(1);

    const last = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'remove-last',
      objectives: { remove: ['last-bite'] },
    });
    expect(last.status).toBe(409);
    expect(last.body.error).toBe('objective_has_progress');

    const bare = await request(userApp()).post('/api/system/quests').send(daily({
      idempotencyKey: 'one-left',
      objectives: [{ id: 'only', label: 'Only objective', target: 1 }],
    }));
    const wipe = await request(userApp()).patch(`/api/system/quests/${bare.body.quest.id}`).send({
      idempotencyKey: 'wipe',
      objectives: { remove: ['only'] },
    });
    expect(wipe.status).toBe(400);
    expect(wipe.body.message).toMatch(/at least one/);
  });

  it('refuses a target below current progress and marks the objective done when the target meets it', async () => {
    const created = await request(userApp()).post('/api/system/quests').send(daily({
      idempotencyKey: 'walk-target',
      objectives: [{ id: 'walk', label: 'Walk 20 minutes', target: 20 }],
    }));
    const id = created.body.quest.id as string;
    await request(userApp()).patch(`/api/system/quests/${id}/progress`).send({ objectiveId: 'walk', progress: 10 });

    const tooLow = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'target-low',
      objectives: { update: [{ id: 'walk', target: 5 }] },
    });
    expect(tooLow.status).toBe(409);
    expect(tooLow.body.error).toBe('target_below_progress');

    const meet = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'target-meet',
      objectives: { update: [{ id: 'walk', target: 10 }] },
    });
    expect(meet.status).toBe(200);
    expect(meet.body.quest.objectives[0]).toEqual(expect.objectContaining({ target: 10, progress: 10, done: true }));
  });

  it('records an XP decrease and refuses an increase unless it is acknowledged', async () => {
    const created = await request(userApp()).post('/api/system/quests').send(bedtime({ idempotencyKey: 'xp-edit' }));
    const id = created.body.quest.id as string;

    const raised = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'xp-up',
      xpReward: { Warrior: 80 },
    });
    expect(raised.status).toBe(422);
    expect(raised.body.error).toBe('xp_increase_not_acknowledged');
    expect(raised.body.xpReward.previous).toEqual({ Warrior: 40 });
    expect(raised.body.xpReward.next).toEqual({ Warrior: 80 });

    const unchanged = await request(userApp()).get(`/api/system/quests/${id}`);
    expect(unchanged.body.quest.xpReward).toEqual({ Warrior: 40 });
    expect(unchanged.body.quest.editedAt).toBeNull();

    const lowered = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'xp-down',
      xpReward: { Warrior: 25 },
    });
    expect(lowered.status).toBe(200);
    expect(lowered.body.quest.xpReward).toEqual({ Warrior: 25 });
    expect(lowered.body.changes.join('\n')).toContain('xpReward: Warrior 40 → Warrior 25');

    const acknowledged = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'xp-up-ack',
      xpReward: { Warrior: 30 },
      acknowledgeXpIncrease: true,
    });
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.changes.join('\n')).toContain('xpReward increased (acknowledged): Warrior 25 → Warrior 30');

    const cleared = await request(userApp()).post(`/api/system/quests/${id}/clear`).send({ xp: 99999 });
    expect(cleared.body.xpApplied).toEqual([{ className: 'Warrior', xp: 30 }]);
    expect(JSON.stringify(cleared.body)).not.toContain('99999');

    const messages = await request(userApp()).get('/api/system/messages');
    const body = messages.body.messages.map((m: { body: string }) => m.body).join('\n');
    expect(body).toContain('xpReward: Warrior 40 → Warrior 25');
    expect(body).toContain('acknowledged');
  });

  it('refuses to raise penalty XP unless the increase is acknowledged', async () => {
    const created = await request(userApp()).post('/api/system/quests').send(bedtime({ idempotencyKey: 'pen-xp' }));
    const id = created.body.quest.id as string;

    const raised = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'pen-up',
      penalty: { xpPenalty: { Warrior: 40 } },
    });
    expect(raised.status).toBe(422);
    expect(raised.body.error).toBe('xp_increase_not_acknowledged');
    expect(raised.body.xpPenalty.previous).toEqual({ Warrior: 15 });

    const ok = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'pen-up-ack',
      acknowledgeXpIncrease: true,
      reason: 'harsher lights-out',
      penalty: { xpPenalty: { Warrior: 40 } },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.quest.penalty.xpPenalty).toEqual({ Warrior: 40 });
    expect(ok.body.changes.join('\n')).toContain('penalty.xpPenalty increased (acknowledged)');
  });

  it('does not put hidden-quest details in the audit message', async () => {
    const created = await request(userApp()).post('/api/system/quests').send(bedtime({
      idempotencyKey: 'hidden-edit',
      kind: 'hidden',
      title: 'Secret Door Protocol',
    }));
    const id = created.body.quest.id as string;
    const edited = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'hidden-correction',
      reason: 'The sealed title is Secret Door Protocol revised',
      title: 'Secret Door Protocol revised',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.quest.title).toBe('Secret Door Protocol revised');

    const messages = await request(userApp()).get('/api/system/messages');
    expect(messages.body.messages[0].body).toBe('The System corrected a hidden quest.');
    expect(messages.body.messages[0].body).not.toContain('Secret Door Protocol');

    const list = await request(userApp()).get('/api/system/quests');
    expect(list.body.quests[0].title).toBeNull();
    expect(list.body.quests[0].editedAt).toBeTruthy();
    expect(list.body.quests[0].lastEditReason).toBeNull();
    expect(JSON.stringify(list.body)).not.toContain('Secret Door Protocol');
  });

  it('rejects a past deadline, a missing key, and an empty correction', async () => {
    const created = await request(userApp()).post('/api/system/quests').send(bedtime({ idempotencyKey: 'guard' }));
    const id = created.body.quest.id as string;

    const past = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'past-deadline',
      deadline: '2020-01-01T00:00:00.000Z',
    });
    expect(past.status).toBe(400);
    expect(past.body.message).toMatch(/future/i);

    const missing = await request(userApp()).patch(`/api/system/quests/${id}`).send({ title: 'No key' });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toMatch(/idempotencyKey/);

    const empty = await request(userApp()).patch(`/api/system/quests/${id}`).send({ idempotencyKey: 'empty' });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('no_changes');

    const kind = await request(userApp()).patch(`/api/system/quests/${id}`).send({
      idempotencyKey: 'change-kind',
      kind: 'emergency',
    });
    expect(kind.status).toBe(400);
    expect(kind.body.message).toMatch(/kind/);
  });
});
