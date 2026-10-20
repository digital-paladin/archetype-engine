const mockGetWearableTokens = jest.fn();
const mockSaveWearableTokens = jest.fn();

jest.mock('./data/dataService', () => ({
  getDataService: () => ({
    getWearableTokens: (...args: unknown[]) => mockGetWearableTokens(...args),
    saveWearableTokens: (...args: unknown[]) => mockSaveWearableTokens(...args),
  }),
}));

import { GoogleHealthService } from './googleHealth.service';

describe('GoogleHealthService fetches', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.GOOGLE_HEALTH_CLIENT_ID = 'client-id';
    process.env.GOOGLE_HEALTH_CLIENT_SECRET = 'client-secret';
    mockGetWearableTokens.mockReset();
    mockSaveWearableTokens.mockReset();
    mockGetWearableTokens.mockResolvedValue({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_at: Date.now() + 60 * 60 * 1000,
    });
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  }

  it('reads steps from dailyRollUp and workouts from reconcile without sending the client secret', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const href = String(url);
      expect(href).not.toContain('client-secret');
      expect(JSON.stringify(init?.body ?? '')).not.toContain('client-secret');
      if (href.includes('/dataTypes/steps/dataPoints:dailyRollUp')) {
        const body = JSON.parse(String(init?.body));
        expect(init?.method).toBe('POST');
        expect(body.dataSourceFamily).toBe('users/me/dataSourceFamilies/google-wearables');
        expect(body.range.start.date).toEqual({ year: 2026, month: 10, day: 18 });
        return jsonResponse({ rollupDataPoints: [{ steps: { countSum: '1000' } }] });
      }
      if (href.includes('/dataTypes/exercise/dataPoints:reconcile')) {
        expect(href).toContain('dataSourceFamilies%2Fgoogle-sources');
        return jsonResponse({ dataPoints: [] });
      }
      return jsonResponse({ rollupDataPoints: [], dataPoints: [] });
    });

    const summary = await new GoogleHealthService().getActivities('2026-10-18', 'user-1');
    expect(summary.steps).toBe(1000);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('refreshes once on 401 and stores the new access token', async () => {
    let sleepCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      const href = String(url);
      if (href.includes('oauth2.googleapis.com/token')) {
        const raw = fetchMock.mock.calls.find(call => String(call[0]).includes('oauth2.googleapis.com/token'));
        expect(String(raw?.[1]?.body)).toContain('client_secret=client-secret');
        expect(String(raw?.[1]?.body)).toContain('refresh_token=refresh-1');
        return jsonResponse({
          access_token: 'access-2',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
        });
      }
      sleepCalls += 1;
      if (sleepCalls === 1) return jsonResponse({ error: 'expired' }, 401);
      return jsonResponse({
        dataPoints: [{
          sleep: {
            interval: { startTime: '2026-10-17T22:00:00Z', endTime: '2026-10-18T06:00:00Z' },
            summary: { minutesAsleep: '480' },
          },
        }],
      });
    });

    const sleep = await new GoogleHealthService().getSleepData('2026-10-18', 'user-1');
    expect(sleep.hours).toBe(8);
    expect(sleep.score).toBe(100);
    expect(mockSaveWearableTokens).toHaveBeenCalledWith('user-1', 'google', expect.objectContaining({
      access_token: 'access-2',
      refresh_token: 'refresh-1',
    }));
  });
});
