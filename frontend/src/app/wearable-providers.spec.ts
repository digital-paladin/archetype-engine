import {
  formatOuraLatest,
  ouraSyncLabel,
  WEARABLE_PROVIDERS,
  wearableProvider,
  wearableStatusLabel,
} from './wearable-providers';

describe('wearable providers', () => {
  it('lists Oura, Google Health, and legacy Fitbit as separate connect flows', () => {
    expect(WEARABLE_PROVIDERS.map((provider) => provider.id)).toEqual(['oura', 'google', 'fitbit']);

    expect(wearableProvider('oura').connectMode).toBe('connect-url');
    expect(wearableProvider('oura').connectPath).toBe('/api/oura/connect-url');

    expect(wearableProvider('google').connectMode).toBe('connect-url');
    expect(wearableProvider('google').connectPath).toBe('/api/google-health/connect-url');
    expect(wearableProvider('google').title).toContain('Pixel Watch');

    expect(wearableProvider('fitbit').connectMode).toBe('redirect');
    expect(wearableProvider('fitbit').connectPath).toBe('/api/fitbit/auth');
  });

  it('explains an Oura connection that has not synced and formats stored summaries', () => {
    expect(ouraSyncLabel({ connected: true, lastSyncAt: null, lastSyncDetail: null }))
      .toMatch(/No sync yet/);
    expect(ouraSyncLabel({
      connected: false,
      lastSyncDetail: 'Oura authorization expired or was revoked. Connect again.',
    })).toMatch(/revoked/);
    expect(formatOuraLatest({
      date: '2026-11-06',
      timezone: '-05:00',
      noData: false,
      sleep: { score: 82, hours: 7 },
      readiness: { score: 74 },
      activity: { score: 80, steps: 8421 },
    })).toBe('2026-11-06 (-05:00): Sleep score 82, 7 h · Readiness 74 · Activity score 80, 8421 steps');
    expect(formatOuraLatest({ date: '2026-11-06', noData: true })).toBeNull();
  });

  it('labels connection state from the status payload', () => {
    expect(wearableStatusLabel(null)).toBe('Status unavailable');
    expect(wearableStatusLabel({ configured: null, connected: null })).toBe('Status unavailable');
    expect(wearableStatusLabel({ configured: true, connected: true })).toBe('Connected');
    expect(wearableStatusLabel({ configured: true, connected: false })).toBe('Not connected');
    expect(wearableStatusLabel({ configured: false, connected: false })).toBe('Not configured');
    expect(wearableStatusLabel({ configured: false, connected: true })).toBe('Connected');
  });
});
