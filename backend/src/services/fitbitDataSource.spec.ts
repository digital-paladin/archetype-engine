import {
  allowsGoogleHealthReads,
  allowsLegacyFitbitReads,
  fitbitDataSourceMode,
  legacyFitbitRetired,
  resolveDailyProvider,
} from './fitbitDataSource';

const beforeShutdown = new Date('2026-10-19T12:00:00Z');
const shutdownDay = new Date('2026-10-30T00:00:00Z');

describe('fitbit data source flag', () => {
  const original = process.env.FITBIT_DATA_SOURCE;

  afterEach(() => {
    if (original === undefined) delete process.env.FITBIT_DATA_SOURCE;
    else process.env.FITBIT_DATA_SOURCE = original;
  });

  it('defaults to auto and treats unknown values as auto', () => {
    delete process.env.FITBIT_DATA_SOURCE;
    expect(fitbitDataSourceMode()).toBe('auto');
    expect(allowsGoogleHealthReads()).toBe(true);
    expect(allowsLegacyFitbitReads(beforeShutdown)).toBe(true);
    expect(legacyFitbitRetired(beforeShutdown)).toBe(false);
    expect(legacyFitbitRetired(shutdownDay)).toBe(true);

    process.env.FITBIT_DATA_SOURCE = 'sometimes';
    expect(fitbitDataSourceMode()).toBe('auto');
  });

  it('auto prefers Google Health tokens and falls back when they are absent', async () => {
    process.env.FITBIT_DATA_SOURCE = 'auto';
    const google = {
      isConfigured: () => true,
      hasTokens: jest.fn().mockResolvedValue(true),
    };
    const fitbit = { isConfigured: () => true };
    await expect(resolveDailyProvider('user', google, fitbit, beforeShutdown)).resolves.toBe('google');

    google.hasTokens.mockResolvedValue(false);
    await expect(resolveDailyProvider('user', google, fitbit, beforeShutdown)).resolves.toBe('fitbit');
  });

  it('auto falls back to legacy Fitbit when Google credentials are not set', async () => {
    process.env.FITBIT_DATA_SOURCE = 'auto';
    const google = { isConfigured: () => false, hasTokens: jest.fn() };
    const fitbit = { isConfigured: () => true };
    await expect(resolveDailyProvider('user', google, fitbit, beforeShutdown)).resolves.toBe('fitbit');
    expect(google.hasTokens).not.toHaveBeenCalled();
  });

  it('after the shutdown, auto with no Google client returns 503 and does not select Fitbit', async () => {
    process.env.FITBIT_DATA_SOURCE = 'auto';
    await expect(resolveDailyProvider(
      'user',
      { isConfigured: () => false, hasTokens: async () => false },
      { isConfigured: () => true },
      shutdownDay,
    )).rejects.toMatchObject({ httpStatus: 503, requiresAuth: false });
    expect(allowsLegacyFitbitReads(shutdownDay)).toBe(false);
  });

  it('after the shutdown, auto with a Google client but no tokens asks for consent', async () => {
    process.env.FITBIT_DATA_SOURCE = 'auto';
    await expect(resolveDailyProvider(
      'user',
      { isConfigured: () => true, hasTokens: async () => false },
      { isConfigured: () => true },
      shutdownDay,
    )).rejects.toMatchObject({
      httpStatus: 200,
      requiresAuth: true,
    });
  });

  it('legacy mode ignores a connected Google Health account', async () => {
    process.env.FITBIT_DATA_SOURCE = 'legacy';
    expect(allowsGoogleHealthReads()).toBe(false);
    const google = { isConfigured: () => true, hasTokens: jest.fn().mockResolvedValue(true) };
    await expect(resolveDailyProvider('user', google, { isConfigured: () => true }, beforeShutdown)).resolves.toBe('fitbit');
    expect(google.hasTokens).not.toHaveBeenCalled();
  });

  it('legacy mode stops selecting Fitbit after the shutdown', async () => {
    process.env.FITBIT_DATA_SOURCE = 'legacy';
    await expect(resolveDailyProvider(
      'user',
      { isConfigured: () => false, hasTokens: async () => false },
      { isConfigured: () => true },
      shutdownDay,
    )).rejects.toMatchObject({ httpStatus: 503, requiresAuth: false });
  });

  it('google mode does not call the legacy API and asks for consent when disconnected', async () => {
    process.env.FITBIT_DATA_SOURCE = 'google';
    expect(allowsLegacyFitbitReads()).toBe(false);
    const google = { isConfigured: () => true, hasTokens: jest.fn().mockResolvedValue(false) };
    await expect(resolveDailyProvider('user', google, { isConfigured: () => true }))
      .rejects.toMatchObject({ requiresAuth: true, httpStatus: 200 });
  });

  it('503s when the selected provider has no credentials', async () => {
    process.env.FITBIT_DATA_SOURCE = 'auto';
    await expect(resolveDailyProvider(
      'user',
      { isConfigured: () => false, hasTokens: async () => false },
      { isConfigured: () => false },
    )).rejects.toMatchObject({ httpStatus: 503 });
  });
});
