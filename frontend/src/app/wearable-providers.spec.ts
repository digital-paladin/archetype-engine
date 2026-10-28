import { WEARABLE_PROVIDERS, wearableProvider, wearableStatusLabel } from './wearable-providers';

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

  it('labels connection state from the status payload', () => {
    expect(wearableStatusLabel(null)).toBe('Status unavailable');
    expect(wearableStatusLabel({ configured: null, connected: null })).toBe('Status unavailable');
    expect(wearableStatusLabel({ configured: true, connected: true })).toBe('Connected');
    expect(wearableStatusLabel({ configured: true, connected: false })).toBe('Not connected');
    expect(wearableStatusLabel({ configured: false, connected: false })).toBe('Not configured');
    expect(wearableStatusLabel({ configured: false, connected: true })).toBe('Connected');
  });
});
