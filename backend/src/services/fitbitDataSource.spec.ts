import {
  allowsGoogleHealthReads,
  allowsLegacyFitbitReads,
  fitbitDataSourceMode,
  resolveDailyProvider,
} from './fitbitDataSource';

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
    expect(allowsLegacyFitbitReads()).toBe(true);

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
    await expect(resolveDailyProvider('user', google, fitbit)).resolves.toBe('google');

    google.hasTokens.mockResolvedValue(false);
    await expect(resolveDailyProvider('user', google, fitbit)).resolves.toBe('fitbit');
  });

  it('auto falls back to legacy Fitbit when Google credentials are not set', async () => {
    process.env.FITBIT_DATA_SOURCE = 'auto';
    const google = { isConfigured: () => false, hasTokens: jest.fn() };
    const fitbit = { isConfigured: () => true };
    await expect(resolveDailyProvider('user', google, fitbit)).resolves.toBe('fitbit');
    expect(google.hasTokens).not.toHaveBeenCalled();
  });

  it('legacy mode ignores a connected Google Health account', async () => {
    process.env.FITBIT_DATA_SOURCE = 'legacy';
    expect(allowsGoogleHealthReads()).toBe(false);
    const google = { isConfigured: () => true, hasTokens: jest.fn().mockResolvedValue(true) };
    await expect(resolveDailyProvider('user', google, { isConfigured: () => true })).resolves.toBe('fitbit');
    expect(google.hasTokens).not.toHaveBeenCalled();
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
