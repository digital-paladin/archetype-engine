import { GarminService } from './garmin.service';

describe('GarminService stub', () => {
  const svc = new GarminService();

  it('reports not configured without env', () => {
    const prevId = process.env.GARMIN_CLIENT_ID;
    const prevSecret = process.env.GARMIN_CLIENT_SECRET;
    delete process.env.GARMIN_CLIENT_ID;
    delete process.env.GARMIN_CLIENT_SECRET;
    expect(new GarminService().isConfigured()).toBe(false);
    if (prevId) process.env.GARMIN_CLIENT_ID = prevId;
    if (prevSecret) process.env.GARMIN_CLIENT_SECRET = prevSecret;
  });

  it('throws on auth/sleep until implemented', async () => {
    expect(() => svc.getAuthUrl('user')).toThrow(/not implemented/i);
    await expect(svc.exchangeCode('code', 'user')).rejects.toThrow(/not implemented/i);
    await expect(svc.getSleepData('today', 'user')).rejects.toThrow(/stub/i);
  });
});
