/**
 * SYNTHETIC Oura HTTP fixtures. Not measurements from any person.
 */
const mockGetTokens = jest.fn();
const mockSaveTokens = jest.fn();
const mockDeleteTokens = jest.fn();
const mockGetJournal = jest.fn();
const mockUpsertJournal = jest.fn();
const mockUpsertSummary = jest.fn();
const mockUpsertStatus = jest.fn();
const mockGetStatus = jest.fn();
const mockGetLatest = jest.fn();
const mockDeleteData = jest.fn();
const mockSleepDebt = jest.fn();

jest.mock('./data/dataService', () => ({
  getDataService: () => ({
    getWearableTokens: (...args: unknown[]) => mockGetTokens(...args),
    saveWearableTokens: (...args: unknown[]) => mockSaveTokens(...args),
    deleteWearableTokens: (...args: unknown[]) => mockDeleteTokens(...args),
    getJournalEntry: (...args: unknown[]) => mockGetJournal(...args),
    upsertJournalEntry: (...args: unknown[]) => mockUpsertJournal(...args),
  }),
}));

jest.mock('./ouraSummaryStore', () => ({
  upsertOuraSummary: (...args: unknown[]) => mockUpsertSummary(...args),
  upsertOuraSyncStatus: (...args: unknown[]) => mockUpsertStatus(...args),
  getOuraSyncStatus: (...args: unknown[]) => mockGetStatus(...args),
  getLatestOuraSummary: (...args: unknown[]) => mockGetLatest(...args),
  deleteOuraUserData: (...args: unknown[]) => mockDeleteData(...args),
}));

jest.mock('./sleepDebt.service', () => ({
  syncSleepDebtFromJournalSafe: (...args: unknown[]) => mockSleepDebt(...args),
}));

import { OuraError } from './ouraErrors';
import { OuraService, OURA_SCOPE } from './oura.service';
import { sealOuraSecret } from './ouraTokenCrypto';

const DAY = '2026-11-06';
const ACCESS = 'access-SHOULD-NOT-LEAK';
const REFRESH = 'refresh-SHOULD-NOT-LEAK';
const SECRET = 'client-secret-SHOULD-NOT-LEAK';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function syntheticDay(score = 82) {
  return {
    daily_sleep: {
      data: [{
        id: 'daily-sleep-1',
        day: DAY,
        score,
        timestamp: '2026-11-06T00:00:00-05:00',
        contributors: { total_sleep: 80, efficiency: 10 },
      }],
    },
    sleep: {
      data: [{
        id: 'night-1',
        day: DAY,
        type: 'long_sleep',
        total_sleep_duration: 25200,
        deep_sleep_duration: 4800,
        rem_sleep_duration: 5400,
        light_sleep_duration: 15000,
        awake_time: 1200,
        efficiency: 91,
        bedtime_start: '2026-11-05T23:15:00-05:00',
        bedtime_end: '2026-11-06T06:15:00-05:00',
        sleep_score_delta: 5,
        heart_rate: { items: [50] },
        readiness: { score: 99 },
      }],
    },
    daily_readiness: {
      data: [{
        id: 'ready-1',
        day: DAY,
        score: 74,
        temperature_deviation: -0.2,
        timestamp: '2026-11-06T06:20:00-05:00',
        contributors: { hrv_balance: 68, resting_heart_rate: 90 },
      }],
    },
    daily_activity: {
      data: [{
        id: 'act-1',
        day: DAY,
        score: 80,
        steps: 8421,
        active_calories: 340,
        total_calories: 2300,
        high_activity_time: 600,
        timestamp: '2026-11-06T23:00:00-05:00',
        class_5_min: '111222',
        met: { items: [1] },
      }],
    },
  };
}

describe('OuraService', () => {
  const originalFetch = global.fetch;
  const env = {
    OURA_CLIENT_ID: process.env.OURA_CLIENT_ID,
    OURA_CLIENT_SECRET: process.env.OURA_CLIENT_SECRET,
    OURA_REDIRECT_URI: process.env.OURA_REDIRECT_URI,
    INTEGRATIONS_ENCRYPTION_KEY: process.env.INTEGRATIONS_ENCRYPTION_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NODE_ENV: process.env.NODE_ENV,
  };
  let fetchMock: jest.Mock;
  let logs: string[];
  const summaries = new Map<string, Record<string, unknown>>();
  let journal: Record<string, unknown> | null;

  beforeEach(() => {
    process.env.OURA_CLIENT_ID = 'oura-client';
    process.env.OURA_CLIENT_SECRET = SECRET;
    process.env.OURA_REDIRECT_URI = 'http://localhost:3000/api/oura/callback';
    process.env.INTEGRATIONS_ENCRYPTION_KEY = 'oura-service-test-key';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    summaries.clear();
    journal = null;
    logs = [];
    jest.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.map(String).join(' ')); });
    jest.spyOn(console, 'error').mockImplementation((...args) => { logs.push(args.map(String).join(' ')); });
    jest.spyOn(console, 'warn').mockImplementation((...args) => { logs.push(args.map(String).join(' ')); });
    mockGetTokens.mockReset();
    mockSaveTokens.mockReset();
    mockDeleteTokens.mockReset();
    mockGetJournal.mockReset();
    mockUpsertJournal.mockReset();
    mockUpsertSummary.mockReset();
    mockUpsertStatus.mockReset();
    mockGetStatus.mockReset();
    mockGetLatest.mockReset();
    mockDeleteData.mockReset();
    mockSleepDebt.mockReset();
    mockGetTokens.mockResolvedValue({
      access_token: ACCESS,
      refresh_token: REFRESH,
      expires_at: Date.now() + 60 * 60 * 1000,
    });
    mockSaveTokens.mockImplementation(async (_user: string, _provider: string, tokens: Record<string, unknown>) => {
      mockGetTokens.mockResolvedValue(tokens);
    });
    mockDeleteTokens.mockResolvedValue(undefined);
    mockGetJournal.mockImplementation(async () => journal);
    mockUpsertJournal.mockImplementation(async (_user: string, patch: Record<string, unknown>) => {
      journal = { ...(journal ?? {}), ...patch };
    });
    mockUpsertSummary.mockImplementation(async (row: Record<string, unknown>) => {
      summaries.set(`${row.user_id}|${row.summary_date}`, { ...row });
    });
    mockUpsertStatus.mockResolvedValue(undefined);
    mockGetStatus.mockResolvedValue(null);
    mockGetLatest.mockResolvedValue(null);
    mockDeleteData.mockResolvedValue(undefined);
    mockSleepDebt.mockResolvedValue(undefined);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  afterAll(() => {
    restoreEnv(env);
  });

  function routeFetch(overrides?: {
    daily_sleep?: unknown;
    sleep?: unknown;
    daily_readiness?: unknown;
    daily_activity?: unknown;
    sleepPages?: unknown[];
  }) {
    const day = syntheticDay();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const href = String(url);
      expect(href).not.toContain(SECRET);
      expect(JSON.stringify(init?.headers ?? {})).not.toContain(SECRET);
      const path = new URL(href).pathname;
      if (path.endsWith('/daily_sleep')) return jsonResponse(overrides?.daily_sleep ?? day.daily_sleep);
      if (path.endsWith('/daily_readiness')) return jsonResponse(overrides?.daily_readiness ?? day.daily_readiness);
      if (path.endsWith('/daily_activity')) return jsonResponse(overrides?.daily_activity ?? day.daily_activity);
      if (path.endsWith('/sleep')) {
        if (overrides?.sleepPages) {
          const page = Number(new URL(href).searchParams.get('page') ?? '0');
          const token = new URL(href).searchParams.get('next_token');
          const index = token === 'page-2' ? 1 : page;
          return jsonResponse(overrides.sleepPages[index] ?? { data: [] });
        }
        return jsonResponse(overrides?.sleep ?? day.sleep);
      }
      return jsonResponse({ data: [] });
    });
  }

  it('requests only the daily scope and keeps the client secret off the authorize URL', () => {
    const url = new URL(new OuraService().getAuthUrl('signed-state'));
    expect(url.origin + url.pathname).toBe('https://cloud.ouraring.com/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe(OURA_SCOPE);
    expect(url.searchParams.get('scope')).not.toContain('personal');
    expect(url.searchParams.get('scope')).not.toContain('heartrate');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('signed-state');
    expect(url.searchParams.get('client_secret')).toBeNull();
    expect(url.toString()).not.toContain(SECRET);
  });

  it('is not configured without credentials, or in production without a redirect URI', () => {
    delete process.env.OURA_CLIENT_ID;
    delete process.env.OURA_CLIENT_SECRET;
    expect(new OuraService().isConfigured()).toBe(false);
    process.env.OURA_CLIENT_ID = 'oura-client';
    process.env.OURA_CLIENT_SECRET = SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.OURA_REDIRECT_URI;
    expect(new OuraService().isConfigured()).toBe(false);
  });

  it('seals exchanged tokens and does not log them or the client secret', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      access_token: ACCESS,
      refresh_token: REFRESH,
      expires_in: 86400,
      scope: 'daily',
    }));
    await new OuraService().exchangeCode('auth-code', 'user-1');
    const saved = mockSaveTokens.mock.calls[0][2];
    expect(saved.access_token.startsWith('v1:')).toBe(true);
    expect(saved.refresh_token.startsWith('v1:')).toBe(true);
    expect(saved.access_token).not.toContain(ACCESS);
    expect(saved.refresh_token).not.toContain(REFRESH);
    expect(mockSaveTokens.mock.calls[0][0]).toBe('user-1');
    expect(mockSaveTokens.mock.calls[0][1]).toBe('oura');
    const blob = logs.join('\n');
    expect(blob).not.toContain(ACCESS);
    expect(blob).not.toContain(REFRESH);
    expect(blob).not.toContain(SECRET);
  });

  it('refuses a token response that did not grant daily and does not keep the body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      access_token: ACCESS,
      refresh_token: REFRESH,
      expires_in: 3600,
      scope: 'personal email',
      debug: SECRET,
    }));
    await expect(new OuraService().exchangeCode('auth-code', 'user-1')).rejects.toThrow(/daily scope/);
    expect(mockSaveTokens).not.toHaveBeenCalled();
    expect(logs.join('\n')).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain(ACCESS);
  });

  it('refreshes an expired token, rotates the refresh token, and re-seals both', async () => {
    mockGetTokens.mockResolvedValue({
      access_token: 'legacy-access',
      refresh_token: 'legacy-refresh',
      expires_at: Date.now() - 1000,
    });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const href = String(url);
      if (href.includes('/oauth/token')) {
        expect(String(init?.body)).toContain('grant_type=refresh_token');
        expect(String(init?.body)).toContain('refresh_token=legacy-refresh');
        expect(String(init?.body)).not.toContain(ACCESS);
        return jsonResponse({
          access_token: 'rotated-access',
          refresh_token: 'rotated-refresh',
          expires_in: 3600,
        });
      }
      const header = (init?.headers as Record<string, string>).Authorization;
      expect(header).toBe('Bearer rotated-access');
      expect(href).not.toContain(SECRET);
      return jsonResponse({ data: [] });
    });
    const sleep = await new OuraService().getSleepData(DAY, 'user-1');
    expect(sleep.score).toBe(0);
    expect(sleep.hours).toBe(0);
    const saved = mockSaveTokens.mock.calls[0][2];
    expect(saved.access_token.startsWith('v1:')).toBe(true);
    expect(saved.refresh_token.startsWith('v1:')).toBe(true);
    expect(saved.access_token).not.toContain('rotated-access');
    expect(logs.join('\n')).not.toContain('rotated-refresh');
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  it('retries once after 401 and shares one refresh across overlapping calls', async () => {
    mockGetTokens.mockResolvedValue({
      access_token: 'old-access',
      refresh_token: 'old-refresh',
      expires_at: Date.now() - 1000,
    });
    let release: (value: Response) => void = () => undefined;
    const gate = new Promise<Response>((resolve) => { release = resolve; });
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/oauth/token')) return gate;
      return jsonResponse({ data: [] });
    });
    const svc = new OuraService();
    const first = svc.getSleepData(DAY, 'user-1');
    const second = svc.getSleepData(DAY, 'user-1');
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    const tokenCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/oauth/token'));
    expect(tokenCalls).toHaveLength(1);
    release(jsonResponse({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }));
    await Promise.all([first, second]);
    expect(mockSaveTokens).toHaveBeenCalledTimes(1);
  });

  it('refreshes once when a live call returns 401', async () => {
    let sleepHits = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const href = String(url);
      if (href.includes('/oauth/token')) {
        return jsonResponse({ access_token: 'refreshed-access', refresh_token: 'refreshed-refresh', expires_in: 3600 });
      }
      const path = new URL(href).pathname;
      const header = (init?.headers as Record<string, string>).Authorization;
      if (path.endsWith('/daily_sleep')) {
        sleepHits += 1;
        if (sleepHits === 1) {
          expect(header).toBe(`Bearer ${ACCESS}`);
          return jsonResponse({ error: 'expired' }, 401);
        }
        expect(header).toBe('Bearer refreshed-access');
        return jsonResponse(syntheticDay().daily_sleep);
      }
      expect(header).toBe('Bearer refreshed-access');
      if (path.endsWith('/sleep')) return jsonResponse(syntheticDay().sleep);
      return jsonResponse({ data: [] });
    });
    const sleep = await new OuraService().getSleepData(DAY, 'user-1');
    expect(sleep.score).toBe(82);
    expect(sleep.hours).toBe(7);
    expect(sleepHits).toBe(2);
    expect(logs.join('\n')).not.toContain('refreshed-refresh');
  });

  it('clears tokens when refresh is rejected and does not return the upstream body', async () => {
    mockGetTokens.mockResolvedValue({
      access_token: 'old-access',
      refresh_token: REFRESH,
      expires_at: Date.now() - 1000,
    });
    fetchMock.mockResolvedValue(jsonResponse({
      error: 'invalid_grant',
      refresh_token: REFRESH,
      client_secret: SECRET,
    }, 400));
    let caught: OuraError | null = null;
    try {
      await new OuraService().getSleepData(DAY, 'user-1');
    } catch (err) {
      caught = err as OuraError;
    }
    expect(caught).toBeInstanceOf(OuraError);
    expect(caught?.code).toBe('revoked');
    expect(caught?.safeMessage).toMatch(/Connect again/);
    expect(caught?.safeMessage).not.toContain(REFRESH);
    expect(caught?.safeMessage).not.toContain(SECRET);
    expect(mockDeleteTokens).toHaveBeenCalledWith('user-1', 'oura');
    expect(mockUpsertStatus).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      last_sync_status: 'revoked',
    }));
    expect(logs.join('\n')).not.toContain(REFRESH);
  });

  it('follows next_token and ignores a repeated token', async () => {
    routeFetch({
      sleepPages: [
        { data: [{ id: 'partial', day: DAY, type: 'rest' }], next_token: 'page-2' },
        {
          data: [{
            id: 'night-1',
            day: DAY,
            type: 'long_sleep',
            total_sleep_duration: 25200,
            efficiency: 91,
            bedtime_start: '2026-11-05T23:15:00-05:00',
            bedtime_end: '2026-11-06T06:15:00-05:00',
          }],
          next_token: 'page-2',
        },
      ],
    });
    const sleep = await new OuraService().getSleepData(DAY, 'user-1');
    expect(sleep.hours).toBe(7);
    expect(sleep.startTime).toBe('23:15');
    expect(sleep.endTime).toBe('06:15');
    const sleepCalls = fetchMock.mock.calls.filter((call) => new URL(String(call[0])).pathname.endsWith('/sleep'));
    expect(sleepCalls).toHaveLength(2);
    expect(String(sleepCalls[1][0])).toContain('next_token=page-2');
  });

  it('retries one rate-limit response and then stores a no-data day without journal XP fields', async () => {
    let hits = 0;
    fetchMock.mockImplementation(async (url: string) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/daily_sleep')) {
        hits += 1;
        if (hits === 1) return jsonResponse({ error: 'slow down', token: ACCESS }, 429, { 'retry-after': '0' });
      }
      return jsonResponse({ data: [] });
    });
    const result = await new OuraService().syncDay('user-1', DAY);
    expect(hits).toBe(2);
    expect(result.status).toBe('no_data');
    expect(result.xpAwarded).toBe(0);
    expect(result.journalUpdated).toBe(false);
    expect(mockUpsertJournal).not.toHaveBeenCalled();
    expect(mockSleepDebt).not.toHaveBeenCalled();
    expect(summaries.size).toBe(1);
    expect(JSON.stringify(result)).not.toContain(ACCESS);
    expect(logs.join('\n')).not.toContain(ACCESS);
  });

  it('stores an idempotent summary and fills an empty journal once', async () => {
    const scores = [82, 90];
    fetchMock.mockImplementation(async (url: string) => {
      const path = new URL(String(url)).pathname;
      const day = syntheticDay(scores[0]);
      if (path.endsWith('/daily_sleep')) return jsonResponse(day.daily_sleep);
      if (path.endsWith('/sleep')) return jsonResponse(day.sleep);
      if (path.endsWith('/daily_readiness')) return jsonResponse(day.daily_readiness);
      if (path.endsWith('/daily_activity')) return jsonResponse(day.daily_activity);
      return jsonResponse({ data: [] });
    });
    const svc = new OuraService();
    const first = await svc.syncDay('user-1', DAY);
    expect(first.status).toBe('ok');
    expect(first.journalUpdated).toBe(true);
    expect(first.xpAwarded).toBe(0);
    expect(first.sleep.hours).toBe(7);
    expect(first.sleep.startClock).toBe('23:15');
    expect(first.readiness.hrvBalanceContributor).toBe(68);
    expect(first.activity.steps).toBe(8421);
    const patch = mockUpsertJournal.mock.calls[0][1];
    expect(patch).toEqual({
      user_id: 'user-1',
      entry_date: DAY,
      fitbit_score: 82,
      sleep_hours: 7,
      sleep_start: '23:15',
      sleep_end: '06:15',
    });
    expect(patch.hrv_ms).toBeUndefined();
    expect(patch.resting_hr).toBeUndefined();
    expect(patch.energy_score).toBeUndefined();
    expect(JSON.stringify(summaries.get(`user-1|${DAY}`))).not.toContain('111222');
    expect(JSON.stringify(summaries.get(`user-1|${DAY}`))).not.toContain('heart_rate');

    scores[0] = 90;
    const second = await svc.syncDay('user-1', DAY);
    expect(second.journalUpdated).toBe(false);
    expect(second.sleep.score).toBe(90);
    expect(mockUpsertJournal).toHaveBeenCalledTimes(1);
    expect(summaries.size).toBe(1);
    expect((summaries.get(`user-1|${DAY}`)?.sleep as { score: number }).score).toBe(90);
    expect(journal?.fitbit_score).toBe(82);
  });

  it('does not overwrite a journal night that already has sleep', async () => {
    journal = { sleep_hours: 6.5, fitbit_score: 70, hrv_ms: 40 };
    routeFetch();
    const result = await new OuraService().syncDay('user-1', DAY);
    expect(result.journalUpdated).toBe(false);
    expect(mockUpsertJournal).not.toHaveBeenCalled();
    expect(journal.hrv_ms).toBe(40);
    expect(summaries.size).toBe(1);
  });

  it('keeps a score when durations are missing and does not invent hours from contributor points', async () => {
    routeFetch({
      sleep: { data: [] },
      daily_readiness: { data: [] },
      daily_activity: { data: [] },
    });
    const result = await new OuraService().syncDay('user-1', DAY);
    expect(result.status).toBe('partial');
    expect(result.sleep.score).toBe(82);
    expect(result.sleep.hours).toBeNull();
    expect(result.readiness.score).toBeNull();
    const patch = mockUpsertJournal.mock.calls[0][1];
    expect(patch.fitbit_score).toBe(82);
    expect(patch.sleep_hours).toBeUndefined();
    expect(patch.hrv_ms).toBeUndefined();

    routeFetch();
    const filled = await new OuraService().syncDay('user-1', DAY);
    expect(filled.journalUpdated).toBe(true);
    expect(mockUpsertJournal.mock.calls[1][1]).toEqual({
      user_id: 'user-1',
      entry_date: DAY,
      sleep_hours: 7,
      sleep_start: '23:15',
      sleep_end: '06:15',
    });
    expect(journal?.fitbit_score).toBe(82);
  });

  it('records no data without writing a zero score', async () => {
    routeFetch({
      daily_sleep: { data: [] },
      sleep: { data: [] },
      daily_readiness: { data: [] },
      daily_activity: { data: [] },
    });
    const result = await new OuraService().syncDay('victim-id-should-not-be-used', DAY);
    expect(mockGetTokens).toHaveBeenCalledWith('victim-id-should-not-be-used', 'oura');
    expect(result.status).toBe('no_data');
    expect(mockUpsertJournal).not.toHaveBeenCalled();
    expect((summaries.values().next().value as { user_id: string }).user_id).toBe('victim-id-should-not-be-used');
  });

  it('stops after a second rate-limit response and does not store an empty summary as no data', async () => {
    fetchMock.mockImplementation(() => jsonResponse(
      { error: 'limit', access_token: ACCESS },
      429,
      { 'retry-after': '0' },
    ));
    await expect(new OuraService().syncDay('user-1', DAY)).rejects.toMatchObject({ code: 'rate_limited' });
    expect(summaries.size).toBe(0);
    expect(mockUpsertStatus).toHaveBeenCalledWith(expect.objectContaining({ last_sync_status: 'rate_limited' }));
    expect(logs.join('\n')).not.toContain(ACCESS);
  });

  it('treats a refused sleep-period read as partial and still keeps the daily score', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/sleep')) return jsonResponse({ error: 'nope', token: ACCESS }, 403);
      if (path.endsWith('/daily_sleep')) return jsonResponse(syntheticDay().daily_sleep);
      if (path.endsWith('/daily_readiness')) return jsonResponse(syntheticDay().daily_readiness);
      if (path.endsWith('/daily_activity')) return jsonResponse(syntheticDay().daily_activity);
      return jsonResponse({ data: [] });
    });
    const result = await new OuraService().syncDay('user-1', DAY);
    expect(result.status).toBe('partial');
    expect(result.sleep.score).toBe(82);
    expect(result.sleep.hours).toBeNull();
    expect(JSON.stringify(result)).not.toContain(ACCESS);
  });

  it('does not put a stored token on the connection status', async () => {
    const sealed = sealOuraSecret(ACCESS);
    mockGetTokens.mockResolvedValue({
      access_token: sealed,
      refresh_token: sealOuraSecret(REFRESH),
      expires_at: Date.now() + 60_000,
    });
    const status = await new OuraService().connectionStatus('user-1');
    expect(status.connected).toBe(true);
    expect(status.requestedScope).toBe('daily');
    const encoded = JSON.stringify(status);
    expect(encoded).not.toContain(ACCESS);
    expect(encoded).not.toContain(sealed);
    expect(encoded).not.toContain(REFRESH);
  });

  it('disconnects one user and reports an unreadable token without deleting it', async () => {
    await new OuraService().disconnect('user-1');
    expect(mockDeleteTokens).toHaveBeenCalledWith('user-1', 'oura');
    expect(mockDeleteData).toHaveBeenCalledWith('user-1');

    const sealed = sealOuraSecret(ACCESS);
    process.env.INTEGRATIONS_ENCRYPTION_KEY = 'different-key';
    mockGetTokens.mockResolvedValue({
      access_token: sealed,
      refresh_token: sealed,
      expires_at: Date.now() + 60_000,
    });
    await expect(new OuraService().getSleepData(DAY, 'user-1')).rejects.toThrow(/cannot be read/);
    expect(mockDeleteTokens).toHaveBeenCalledTimes(1);
  });

  it('rejects a calendar day that does not exist', async () => {
    await expect(new OuraService().syncDay('user-1', '2026-02-31')).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function restoreEnv(env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
