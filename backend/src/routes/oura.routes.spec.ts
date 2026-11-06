const mockOura = {
  isConfigured: jest.fn(),
  getAuthUrl: jest.fn((state: string) => `https://cloud.ouraring.com/oauth/authorize?state=${encodeURIComponent(state)}`),
  exchangeCode: jest.fn(),
  hasTokens: jest.fn(),
  getSleepData: jest.fn(),
  getReadiness: jest.fn(),
  syncDay: jest.fn(),
  disconnect: jest.fn(),
  connectionStatus: jest.fn(),
  writeJournalSleepIfEmpty: jest.fn(),
};

jest.mock('../services/oura.service', () => ({
  OuraService: jest.fn().mockImplementation(() => mockOura),
}));

jest.mock('../middleware/auth.middleware', () => ({
  authMiddleware: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = 'user-1';
    next();
  },
}));

jest.mock('../middleware/requireTier.middleware', () => ({
  requireTier: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mockGetJournal = jest.fn();
jest.mock('../services/data/dataService', () => ({
  getDataService: () => ({
    getJournalEntry: (...args: unknown[]) => mockGetJournal(...args),
  }),
}));

import express from 'express';
import request from 'supertest';
import { OuraError } from '../services/ouraErrors';
import { resetOuraOAuthStateForTests, signOuraState, verifyOuraState } from '../services/ouraOAuthState';
import router from './oura.routes';

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/oura', router);
  return server;
}

describe('oura routes', () => {
  const env = {
    INTEGRATIONS_ENCRYPTION_KEY: process.env.INTEGRATIONS_ENCRYPTION_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    OWNER_USER_ID: process.env.OWNER_USER_ID,
    FRONTEND_URL: process.env.FRONTEND_URL,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetOuraOAuthStateForTests();
    process.env.INTEGRATIONS_ENCRYPTION_KEY = 'oura-route-test-key';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.OWNER_USER_ID = 'owner-should-not-bind';
    process.env.FRONTEND_URL = 'https://app.example.test';
    mockOura.isConfigured.mockReturnValue(true);
    mockGetJournal.mockResolvedValue(null);
    mockOura.exchangeCode.mockResolvedValue(undefined);
    mockOura.writeJournalSleepIfEmpty.mockResolvedValue(false);
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('returns a signed authorize URL that is not the user id and has no client secret', async () => {
    const res = await request(app()).get('/api/oura/connect-url');
    expect(res.status).toBe(200);
    const state = new URL(res.body.url).searchParams.get('state');
    expect(state).toBeTruthy();
    expect(state).not.toBe('user-1');
    expect(state && verifyOuraState(state).userId).toBe('user-1');
    expect(mockOura.getAuthUrl).toHaveBeenCalledWith(state);
    expect(res.body.url).not.toContain('client_secret');
    expect(res.body.url).not.toContain('owner-should-not-bind');
  });

  it('refuses to start OAuth without an encryption key', async () => {
    delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await request(app()).get('/api/oura/connect-url');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/INTEGRATIONS_ENCRYPTION_KEY/);
    expect(mockOura.getAuthUrl).not.toHaveBeenCalled();
  });

  it('exchanges a signed state and ignores a raw user id or a missing state', async () => {
    const state = signOuraState('user-1');
    const ok = await request(app()).get('/api/oura/callback').query({ code: 'auth-code', state });
    expect(ok.status).toBe(200);
    expect(mockOura.exchangeCode).toHaveBeenCalledWith('auth-code', 'user-1');
    expect(ok.text).not.toContain('auth-code');
    expect(ok.text).toContain('https://app.example.test');

    const raw = await request(app()).get('/api/oura/callback').query({ code: 'other-code', state: 'user-1' });
    expect(raw.status).toBe(400);
    expect(raw.text).not.toContain('owner-should-not-bind');

    const missing = await request(app()).get('/api/oura/callback').query({ code: 'another-code' });
    expect(missing.status).toBe(400);
    expect(mockOura.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it('rejects a replayed state', async () => {
    const state = signOuraState('user-1');
    await request(app()).get('/api/oura/callback').query({ code: 'one', state });
    const again = await request(app()).get('/api/oura/callback').query({ code: 'two', state });
    expect(again.status).toBe(400);
    expect(mockOura.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it('escapes an OAuth error instead of embedding it as HTML', async () => {
    const res = await request(app()).get('/api/oura/callback').query({ error: '<script>alert(1)</script>' });
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('<script>');
    expect(res.text).toContain('&lt;script&gt;');
  });

  it('syncs the authenticated user and ignores a user id in the body', async () => {
    mockOura.syncDay.mockResolvedValue({
      date: '2026-11-06',
      status: 'no_data',
      detail: 'No Oura summaries for this day. The account can be connected before a ring is paired or synced.',
      journalUpdated: false,
      xpAwarded: 0,
      sleep: { missing: true, score: null, hours: null },
      readiness: { missing: true, score: null },
      activity: { missing: true, steps: null },
    });
    const res = await request(app()).post('/api/oura/sync').send({
      userId: 'victim',
      date: '2026-11-06',
      access_token: 'should-not-stick',
    });
    expect(res.status).toBe(200);
    expect(mockOura.syncDay).toHaveBeenCalledWith('user-1', '2026-11-06');
    expect(res.body.xpAwarded).toBe(0);
    expect(JSON.stringify(res.body)).not.toContain('should-not-stick');
    expect(JSON.stringify(res.body)).not.toContain('victim');
  });

  it('rejects an impossible sync date before calling Oura', async () => {
    const res = await request(app()).post('/api/oura/sync').send({ date: '2026-02-31' });
    expect(res.status).toBe(400);
    expect(mockOura.syncDay).not.toHaveBeenCalled();
  });

  it('maps revocation to a safe 401 and hides generic error text', async () => {
    mockOura.syncDay.mockRejectedValue(new OuraError(
      'Oura authorization expired or was revoked. Connect again.',
      401,
      'revoked',
    ));
    const revoked = await request(app()).post('/api/oura/sync').send({ date: '2026-11-06' });
    expect(revoked.status).toBe(401);
    expect(revoked.body.requiresAuth).toBe(true);
    expect(revoked.body.error).not.toContain('access_token');

    mockGetJournal.mockResolvedValue(null);
    mockOura.getSleepData.mockRejectedValue(new Error('token=super-secret-value'));
    const leaked = await request(app()).get('/api/oura/sleep/today').query({ date: '2026-11-06' });
    expect(leaked.status).toBe(500);
    expect(leaked.body.error).toBe('Oura request failed.');
    expect(JSON.stringify(leaked.body)).not.toContain('super-secret-value');
  });

  it('serves cached sleep without calling Oura and does not award XP', async () => {
    mockGetJournal.mockResolvedValue({ sleep_hours: 7, fitbit_score: 80, sleep_start: '23:15', sleep_end: '06:15' });
    const res = await request(app()).get('/api/oura/sleep/today').query({ date: '2026-11-06' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('cache');
    expect(res.body.xpAwarded).toBe(0);
    expect(mockOura.getSleepData).not.toHaveBeenCalled();
  });

  it('returns readiness as information and does not write the journal', async () => {
    mockOura.getReadiness.mockResolvedValue({
      score: 74,
      hrvBalance: 68,
      hrvBalanceContributor: 68,
      date: '2026-11-06',
    });
    const res = await request(app()).get('/api/oura/readiness/today').query({ date: '2026-11-06' });
    expect(res.status).toBe(200);
    expect(res.body.xpAwarded).toBe(0);
    expect(res.body.note).toMatch(/does not award XP/);
    expect(res.body.readiness.hrvBalanceContributor).toBe(68);
    expect(mockGetJournal).not.toHaveBeenCalled();
  });

  it('disconnects only the authenticated user and omits tokens from status', async () => {
    mockOura.disconnect.mockResolvedValue(undefined);
    const gone = await request(app()).delete('/api/oura/connection');
    expect(gone.status).toBe(200);
    expect(mockOura.disconnect).toHaveBeenCalledWith('user-1');

    mockOura.connectionStatus.mockResolvedValue({
      configured: true,
      connected: true,
      requestedScope: 'daily',
      lastSyncAt: null,
      lastSyncStatus: null,
      lastSyncDetail: null,
      lastSummaryDate: null,
      latest: null,
    });
    const status = await request(app()).get('/api/oura/status');
    expect(status.status).toBe(200);
    expect(status.body.connected).toBe(true);
    expect(JSON.stringify(status.body)).not.toMatch(/access_token|refresh_token|client_secret/);
  });
});
