/**
 * POST /api/activities — social XP is decided on the server.
 * Skill XP needs a named skill and a reflection. Casual time is flat and
 * capped. Overlap with a recorded work or training block pays nothing.
 */
import request from 'supertest';
import express, { Express } from 'express';

const mockLogActivity = jest.fn().mockResolvedValue(undefined);
const mockGetActivityLog = jest.fn().mockResolvedValue([]);
const mockGetActivitiesByTypePrefix = jest.fn().mockResolvedValue([]);
const mockGetCharacterStats = jest.fn().mockResolvedValue([]);
const mockUpsertCharacterStats = jest.fn().mockResolvedValue(undefined);

jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    logActivity: (...args: unknown[]) => mockLogActivity(...args),
    getActivityLog: (...args: unknown[]) => mockGetActivityLog(...args),
    getActivitiesByTypePrefix: (...args: unknown[]) => mockGetActivitiesByTypePrefix(...args),
    getCharacterStats: (...args: unknown[]) => mockGetCharacterStats(...args),
    upsertCharacterStats: (...args: unknown[]) => mockUpsertCharacterStats(...args),
  }),
}));

jest.mock('../services/bodyStatus.service', () => ({
  getActiveBodyStatuses: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/togglTrack.service', () => {
  const actual = jest.requireActual('../services/togglTrack.service');
  return {
    ...actual,
    isTogglConfigured: jest.fn(() => false),
    fetchTogglEntriesForChicagoDay: jest.fn(async () => []),
  };
});

import { activityRouter } from './activity.routes';
import { fetchTogglEntriesForChicagoDay, isTogglConfigured } from '../services/togglTrack.service';
import { CASUAL_SOCIAL_WEEKLY_CAP, CASUAL_SOCIAL_XP } from '../config/socialXp.config';

const REFLECTION = 'Named the goal beforehand and noted one thing to repeat.';
const WHEN = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as express.Request & { userId?: string }).userId = 'test-user'; next(); });
  app.use('/api/activities', activityRouter);
  return app;
}

async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

beforeEach(() => {
  mockLogActivity.mockClear();
  mockGetActivityLog.mockReset().mockResolvedValue([]);
  mockGetActivitiesByTypePrefix.mockReset().mockResolvedValue([]);
  mockGetCharacterStats.mockReset().mockResolvedValue([]);
  mockUpsertCharacterStats.mockClear();
  (isTogglConfigured as jest.Mock).mockReturnValue(false);
  (fetchTogglEntriesForChicagoDay as jest.Mock).mockReset().mockResolvedValue([]);
});

describe('POST /api/activities — social XP', () => {
  it('pays Social Dynamics XP for a named skill plus a reflection and ignores client XP', async () => {
    const res = await request(makeApp()).post('/api/activities').send({
      activityType: 'social',
      occurredAt: WHEN,
      duration: 30,
      xp: 9999,
      skillGoals: ['networking'],
      reflection: REFLECTION,
    });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(16);
    expect(res.body.social.mode).toBe('skill');
    expect(res.body.social.awards).toEqual([
      expect.objectContaining({ class: 'Social Dynamics', xp: 16 }),
    ]);

    await flush();
    expect(mockLogActivity).toHaveBeenCalledWith('test-user', expect.objectContaining({
      activity_type: 'social',
      class_name: 'Social Dynamics',
      xp_awarded: 16,
      notes: expect.stringContaining('[social-xp:skill:16]'),
    }));
    expect(mockUpsertCharacterStats).toHaveBeenCalledWith('test-user', expect.objectContaining({
      class_name: 'Social Dynamics',
      current_xp: 16,
    }));
  });

  it('pays both trees when each one is named', async () => {
    const res = await request(makeApp()).post('/api/activities').send({
      activityType: 'social',
      occurredAt: WHEN,
      duration: 30,
      skillGoals: ['hosting', 'storytelling'],
      reflection: REFLECTION,
    });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(32);
    expect(res.body.social.awards.map((award: { class: string }) => award.class)).toEqual([
      'Social Dynamics',
      'Charisma',
    ]);

    await flush();
    const classes = mockUpsertCharacterStats.mock.calls.map(call => call[1].class_name);
    expect(classes).toEqual(['Social Dynamics', 'Charisma']);
  });

  it('pays nothing for a skill goal without a reflection', async () => {
    const res = await request(makeApp()).post('/api/activities').send({
      activityType: 'social-public-speaking',
      occurredAt: WHEN,
      duration: 30,
      xp: 9999,
      reflection: 'too short',
    });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(0);
    expect(res.body.social.mode).toBe('none');
    expect(res.body.social.reasons).toContain('reflection_required');
    await flush();
    expect(mockUpsertCharacterStats).not.toHaveBeenCalled();
  });

  it('pays the flat casual amount and does not level a skill tree', async () => {
    const res = await request(makeApp()).post('/api/activities').send({
      activityType: 'social',
      occurredAt: WHEN,
      duration: 90,
      xp: 9999,
    });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(CASUAL_SOCIAL_XP);
    expect(res.body.social.mode).toBe('casual');
    expect(res.body.category).toBe('Social');
    await flush();
    expect(mockLogActivity).toHaveBeenCalledWith('test-user', expect.objectContaining({
      class_name: 'Social',
      xp_awarded: CASUAL_SOCIAL_XP,
      notes: `[social-xp:casual:${CASUAL_SOCIAL_XP}]`,
    }));
    expect(mockUpsertCharacterStats).not.toHaveBeenCalled();
  });

  it('stops casual XP at the weekly cap', async () => {
    mockGetActivitiesByTypePrefix.mockResolvedValue([{
      user_id: 'test-user',
      class_name: 'Social',
      activity_type: 'social',
      logged_at: WHEN,
      notes: `[social-xp:casual:${CASUAL_SOCIAL_WEEKLY_CAP}]`,
    }]);

    const res = await request(makeApp()).post('/api/activities').send({
      activityType: 'social',
      occurredAt: WHEN,
      duration: 15,
    });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(0);
    expect(res.body.social.reasons).toContain('weekly_cap');
    await flush();
    expect(mockUpsertCharacterStats).not.toHaveBeenCalled();
  });

  it('flags a social event that overlaps a logged training block and pays 0', async () => {
    const start = new Date(WHEN);
    mockGetActivityLog.mockResolvedValue([{
      id: 'train-1',
      user_id: 'test-user',
      class_name: 'Warrior',
      activity_type: 'workout-strength',
      logged_at: new Date(start.getTime() - 15 * 60 * 1000).toISOString(),
      duration_hours: 1,
    }]);

    const res = await request(makeApp()).post('/api/activities').send({
      activityType: 'social',
      occurredAt: WHEN,
      duration: 30,
      skillGoals: ['rapport'],
      reflection: REFLECTION,
      xp: 9999,
    });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(0);
    expect(res.body.social.flags).toEqual([
      expect.objectContaining({ kind: 'training', source: 'activity-log', label: 'workout-strength' }),
    ]);
    expect(res.body.message).toMatch(/training block/);
    await flush();
    expect(mockLogActivity.mock.calls[0][1].notes).toContain('[social-flag:training]');
    expect(mockUpsertCharacterStats).not.toHaveBeenCalled();
  });

  it('flags overlap with a workout-mapped Toggl entry', async () => {
    const start = new Date(WHEN);
    (isTogglConfigured as jest.Mock).mockReturnValue(true);
    (fetchTogglEntriesForChicagoDay as jest.Mock).mockResolvedValue([{
      id: 'toggl-1',
      description: 'session',
      projectName: 'Sambo',
      tags: [],
      start: new Date(start.getTime() - 10 * 60 * 1000).toISOString(),
      stop: new Date(start.getTime() + 50 * 60 * 1000).toISOString(),
      duration: 3600,
    }]);

    const res = await request(makeApp()).post('/api/activities').send({
      activityType: 'social',
      occurredAt: WHEN,
      duration: 20,
      skillGoals: ['stranger conversation'],
      reflection: REFLECTION,
    });

    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(0);
    expect(res.body.social.flags).toEqual([
      expect.objectContaining({ kind: 'training', source: 'toggl', label: 'Sambo' }),
    ]);
  });

  it('does not apply the social rules to a workout', async () => {
    const res = await request(makeApp()).post('/api/activities').send({
      activityType: 'workout-strength',
      duration: 60,
    });
    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(32);
    expect(res.body.social).toBeUndefined();
    expect(mockGetActivityLog).not.toHaveBeenCalled();
    expect(mockGetActivitiesByTypePrefix).not.toHaveBeenCalled();
  });
});

describe('GET /api/activities/calculate-xp — social preview', () => {
  it('previews the casual flat award instead of the unknown-type fallback', async () => {
    const res = await request(makeApp()).get('/api/activities/calculate-xp?type=social&duration=60');
    expect(res.status).toBe(200);
    expect(res.body.xp).toBe(CASUAL_SOCIAL_XP);
    expect(res.body.xp).toBeLessThan(10);
    expect(res.body.weeklyCap).toBe(CASUAL_SOCIAL_WEEKLY_CAP);
  });
});
