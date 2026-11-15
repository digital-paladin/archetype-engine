/**
 * Wearables shown on the Integrations tab and linked from the Sleep panel.
 *
 * Adding a provider is one entry in this list, plus a backend connect route
 * and a `providers[id]` block on GET /api/wearables/status:
 * - `connect-url` — GET JSON `{ success, url }`, then leave the app (Oura, Google Health).
 * - `redirect` — navigate straight to the path (legacy Fitbit `/auth`, which 302s).
 *
 * The Integrations panel renders this array. It does not need a template change.
 * Stubs with no connect route (Garmin) stay off the list until that route exists.
 */
export type WearableConnectMode = 'connect-url' | 'redirect';

export interface WearableProvider {
  /** Key on GET /api/wearables/status `providers`. */
  id: string;
  title: string;
  description: string;
  note?: string;
  connectMode: WearableConnectMode;
  /** Used when status omits connectPath. Relative to the API origin. */
  connectPath: string;
  notConfiguredMessage: string;
  connectFailedMessage: string;
}

export interface WearableStatusSnapshot {
  configured: boolean | null;
  connected: boolean | null;
}

export const WEARABLE_PROVIDERS: readonly WearableProvider[] = [
  {
    id: 'oura',
    title: 'Oura',
    description: 'Sleep and readiness from an Oura Ring.',
    connectMode: 'connect-url',
    connectPath: '/api/oura/connect-url',
    notConfiguredMessage: 'Oura is not configured yet.',
    connectFailedMessage: 'Could not start Oura authorization.',
  },
  {
    id: 'google',
    title: 'Fitbit / Pixel Watch',
    description:
      'Reads Fitbit and Pixel Watch sleep, activity, heart rate, and nutrition from Google Health.',
    note: 'Testing-mode consent expires about every 7 days. Connect again when sync stops.',
    connectMode: 'connect-url',
    connectPath: '/api/google-health/connect-url',
    notConfiguredMessage: 'Google Health is not configured yet.',
    connectFailedMessage: 'Could not start Google Health authorization.',
  },
  {
    id: 'fitbit',
    title: 'Fitbit Web API (legacy)',
    description:
      'Legacy Fitbit Web API. It shuts down on 2026-10-30. New connections should use Fitbit / Pixel Watch.',
    connectMode: 'redirect',
    connectPath: '/api/fitbit/auth',
    notConfiguredMessage: 'Fitbit is not configured yet.',
    connectFailedMessage: 'Could not start Fitbit authorization.',
  },
];

export function wearableProvider(id: string): WearableProvider {
  const found = WEARABLE_PROVIDERS.find((provider) => provider.id === id);
  if (!found) {
    throw new Error(`Unknown wearable provider: ${id}`);
  }
  return found;
}

/** Label for a provider row. Null means the backend did not report this provider. */
export function wearableStatusLabel(status: WearableStatusSnapshot | null): string {
  if (!status || (status.configured === null && status.connected === null)) {
    return 'Status unavailable';
  }
  if (status.connected) return 'Connected';
  if (status.configured === false) return 'Not configured';
  return 'Not connected';
}
