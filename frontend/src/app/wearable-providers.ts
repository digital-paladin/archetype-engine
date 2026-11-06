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
    description: 'Daily sleep, readiness, and activity summaries from an Oura account.',
    note: 'Readiness is stored as Oura sent it. It does not award XP, create workouts, or give medical advice. Connecting before a ring is paired is fine.',
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

export interface OuraLatestView {
  date: string;
  timezone?: string | null;
  noData?: boolean;
  sleep?: { score?: number | null; hours?: number | null } | null;
  readiness?: { score?: number | null } | null;
  activity?: { score?: number | null; steps?: number | null } | null;
}

export interface OuraSyncSnapshot {
  connected: boolean | null;
  lastSyncAt?: string | null;
  lastSyncDetail?: string | null;
}

/** Server-written detail wins. Otherwise explain a connection that has never synced. */
export function ouraSyncLabel(status: OuraSyncSnapshot | null): string | null {
  if (!status) return null;
  if (status.lastSyncDetail) return status.lastSyncDetail;
  if (status.connected && !status.lastSyncAt) {
    return 'Connected. No sync yet. An account with no paired ring has nothing to ingest until Oura publishes a daily summary.';
  }
  return null;
}

/** Compact line for the latest stored summaries. Not a new score. */
export function formatOuraLatest(latest: OuraLatestView | null | undefined): string | null {
  if (!latest || latest.noData) return null;
  const parts: string[] = [];
  if (latest.sleep && (latest.sleep.score != null || latest.sleep.hours != null)) {
    const score = latest.sleep.score == null ? 'no score' : `score ${latest.sleep.score}`;
    const hours = latest.sleep.hours == null ? 'hours unavailable' : `${latest.sleep.hours} h`;
    parts.push(`Sleep ${score}, ${hours}`);
  }
  if (latest.readiness?.score != null) parts.push(`Readiness ${latest.readiness.score}`);
  if (latest.activity && (latest.activity.steps != null || latest.activity.score != null)) {
    const bits: string[] = [];
    if (latest.activity.score != null) bits.push(`score ${latest.activity.score}`);
    if (latest.activity.steps != null) bits.push(`${latest.activity.steps} steps`);
    parts.push(`Activity ${bits.join(', ')}`);
  }
  if (parts.length === 0) return null;
  const tz = latest.timezone ? ` (${latest.timezone})` : '';
  return `${latest.date}${tz}: ${parts.join(' · ')}`;
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
