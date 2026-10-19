jest.mock('./fitbitDataSource', () => ({
  legacyFitbitRetired: () => true,
}));

import { FitbitService } from './fitbit.service';

describe('FitbitService after the Web API shutdown', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.FITBIT_CLIENT_ID = 'fitbit-client';
    process.env.FITBIT_CLIENT_SECRET = 'fitbit-secret';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('refuses every legacy call before fetch', async () => {
    const svc = new FitbitService();
    expect(() => svc.getAuthUrl()).toThrow(/shut down on 2026-10-30/);
    await expect(svc.exchangeCode('code', 'user')).rejects.toThrow(/shut down on 2026-10-30/);
    await expect(svc.getSleepData('2026-10-30', 'user')).rejects.toThrow(/shut down on 2026-10-30/);
    await expect(svc.getSleepRange('2026-10-01', '2026-10-30', 'user')).rejects.toThrow(/shut down on 2026-10-30/);
    await expect(svc.getActivities('2026-10-30', 'user')).rejects.toThrow(/shut down on 2026-10-30/);
    await expect(svc.getFoodLog('2026-10-30', 'user')).rejects.toThrow(/shut down on 2026-10-30/);
    await expect(svc.getVitals('user')).rejects.toThrow(/shut down on 2026-10-30/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
