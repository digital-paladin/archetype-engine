/**
 * Chooses the Fitbit data path.
 *
 *   auto   (default) — Google Health API v4 when that client is configured
 *                      and the user has tokens; otherwise the legacy Fitbit Web API.
 *   google           — Google Health only. Legacy Fitbit is not called.
 *   legacy           — Fitbit Web API only. Google Health reads are skipped.
 *
 * Credentials are never read here. Callers still read GOOGLE_HEALTH_* and
 * FITBIT_* from the environment inside their own services.
 */
export type FitbitDataSourceMode = 'auto' | 'google' | 'legacy';

export class WearableSourceError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly requiresAuth = false,
  ) {
    super(message);
    this.name = 'WearableSourceError';
  }
}

export interface ConfiguredClient {
  isConfigured(): boolean;
}

export interface GoogleHealthClient extends ConfiguredClient {
  hasTokens(userId: string): Promise<boolean>;
}

export function fitbitDataSourceMode(): FitbitDataSourceMode {
  const raw = (process.env.FITBIT_DATA_SOURCE || 'auto').trim().toLowerCase();
  if (raw === 'google' || raw === 'legacy' || raw === 'auto') return raw;
  console.warn(`[WEARABLES] Unknown FITBIT_DATA_SOURCE="${raw}" — using auto`);
  return 'auto';
}

export function allowsGoogleHealthReads(): boolean {
  return fitbitDataSourceMode() !== 'legacy';
}

/** Inclusive UTC calendar day Google shuts down the Fitbit Web API. */
export const FITBIT_WEB_API_SHUTDOWN = '2026-10-30';

export function legacyFitbitRetired(now: Date = new Date()): boolean {
  return now.toISOString().slice(0, 10) >= FITBIT_WEB_API_SHUTDOWN;
}

export function allowsLegacyFitbitReads(now: Date = new Date()): boolean {
  if (legacyFitbitRetired(now)) return false;
  return fitbitDataSourceMode() !== 'google';
}

function sunsetError(google: ConfiguredClient): WearableSourceError {
  if (google.isConfigured()) {
    return new WearableSourceError(
      'The Fitbit Web API shut down on 2026-10-30. Authorize Google Health at /api/google-health/connect-url.',
      200,
      true,
    );
  }
  return new WearableSourceError(
    'The Fitbit Web API shut down on 2026-10-30. Set GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET, then authorize at /api/google-health/connect-url.',
    503,
  );
}

/**
 * Which client should serve today's Fitbit-shaped payloads
 * (sleep, activity, nutrition, vitals).
 *
 * Before 2026-10-30 UTC, `auto` with no Google client keeps the legacy path.
 * On and after that date the legacy API is not selected.
 */
export async function resolveDailyProvider(
  userId: string,
  google: GoogleHealthClient,
  fitbit: ConfiguredClient,
  now: Date = new Date(),
): Promise<'google' | 'fitbit'> {
  const mode = fitbitDataSourceMode();
  const retired = legacyFitbitRetired(now);

  if (mode === 'legacy') {
    if (retired) throw sunsetError(google);
    if (!fitbit.isConfigured()) {
      throw new WearableSourceError(
        'Fitbit not configured. Set FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET.',
        503,
      );
    }
    return 'fitbit';
  }

  if (mode === 'google') {
    if (!google.isConfigured()) {
      throw new WearableSourceError(
        'Google Health not configured. Set GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET.',
        503,
      );
    }
    if (!(await google.hasTokens(userId))) {
      throw new WearableSourceError(
        'Google Health not connected. Authorize at /api/google-health/connect-url.',
        200,
        true,
      );
    }
    return 'google';
  }

  if (google.isConfigured() && await google.hasTokens(userId)) return 'google';
  if (!retired && fitbit.isConfigured()) return 'fitbit';
  if (retired) throw sunsetError(google);
  throw new WearableSourceError(
    'No Fitbit provider configured. Set GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET, or the legacy FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET.',
    503,
  );
}
