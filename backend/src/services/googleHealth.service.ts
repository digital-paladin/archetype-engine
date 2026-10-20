import { getDataService } from './data/dataService';
import { ActivitySummary, FoodLog, VitalsData } from './fitbit.service';
import {
  GOOGLE_HEALTH_READONLY_SCOPES,
  GOOGLE_SOURCES_FAMILY,
  GOOGLE_WEARABLES_FAMILY,
  assembleActivitySummary,
  assembleFoodLog,
  assembleVitals,
  parseGoogleSleep,
} from './googleHealthParse';
import {
  IWearableService,
  WearableProvider,
  WearableSleepData,
  WearableTokens,
} from './wearable.types';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://health.googleapis.com/v4';

interface ReconcilePage {
  dataPoints?: any[];
  nextPageToken?: string;
}

interface RollupPage {
  rollupDataPoints?: any[];
}

interface TokenBox {
  current: string;
}

/**
 * Google Health API v4 — Fitbit / Pixel Watch replacement for the Web API
 * that Google shuts down on 2026-10-30.
 *
 * Sleep, steps, heart rate, workouts, nutrition, and vitals are read with
 * the restricted readonly scopes in GOOGLE_HEALTH_READONLY_SCOPES. Tokens
 * live in wearable_tokens (provider=google). Legacy Fitbit tokens stay in
 * fitbit_tokens until FITBIT_DATA_SOURCE drops the fallback.
 */
export class GoogleHealthService implements IWearableService {
  readonly provider: WearableProvider = 'google';

  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor() {
    this.clientId     = process.env.GOOGLE_HEALTH_CLIENT_ID || '';
    this.clientSecret = process.env.GOOGLE_HEALTH_CLIENT_SECRET || '';
    this.redirectUri  = process.env.GOOGLE_HEALTH_REDIRECT_URI
      || 'http://localhost:3000/api/google-health/callback';
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  getAuthUrl(state: string): string {
    if (!this.clientId) throw new Error('GOOGLE_HEALTH_CLIENT_ID not set in environment');
    const params = new URLSearchParams({
      client_id:     this.clientId,
      redirect_uri:  this.redirectUri,
      response_type: 'code',
      scope:         GOOGLE_HEALTH_READONLY_SCOPES.join(' '),
      state,
      access_type:   'offline',
      prompt:        'consent',
    });
    return `${AUTH_URL}?${params}`;
  }

  async exchangeCode(code: string, userId: string): Promise<void> {
    if (!this.isConfigured()) throw new Error('Google Health client credentials not configured');

    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  this.redirectUri,
      client_id:     this.clientId,
      client_secret: this.clientSecret,
    });

    const res = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });

    if (!res.ok) throw new Error(`Google Health token exchange failed: ${await res.text()}`);

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };

    if (!data.refresh_token) {
      throw new Error('Google Health token response missing refresh_token — re-consent with prompt=consent');
    }

    await this.saveTokens(userId, {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    Date.now() + (data.expires_in - 60) * 1000,
      scope:         data.scope,
    });
    console.log(`[GOOGLE-HEALTH] ✅ Tokens saved for user ${userId.slice(0, 8)}…`);
  }

  async getSleepData(date = 'today', userId: string): Promise<WearableSleepData> {
    const dateStr = this.resolveDate(date);
    const token = await this.tokenBox(userId);
    const next = this.nextCivilDate(dateStr);
    const points = await this.reconcile(
      userId,
      token,
      'sleep',
      `sleep.interval.civil_end_time >= "${dateStr}" AND sleep.interval.civil_end_time < "${next}"`,
      GOOGLE_WEARABLES_FAMILY,
    );
    return this.parseSleep({ dataPoints: points }, dateStr);
  }

  async getActivities(date = 'today', userId: string): Promise<ActivitySummary> {
    const dateStr = this.resolveDate(date);
    const next = this.nextCivilDate(dateStr);
    const token = await this.tokenBox(userId);
    const day = (dataType: string) => this.dailyRollup(userId, token, dataType, dateStr, next, GOOGLE_WEARABLES_FAMILY);
    const daily = (dataType: string, field: string) => this.reconcile(
      userId,
      token,
      dataType,
      `${field} >= "${dateStr}" AND ${field} < "${next}"`,
      GOOGLE_WEARABLES_FAMILY,
    );

    const parts = await Promise.all([
      this.settle('steps', () => day('steps')),
      this.settle('active-minutes', () => day('active-minutes')),
      this.settle('sedentary-period', () => day('sedentary-period')),
      this.settle('total-calories', () => day('total-calories')),
      this.settle('active-zone-minutes', () => day('active-zone-minutes')),
      this.settle('time-in-heart-rate-zone', () => day('time-in-heart-rate-zone')),
      this.settle('calories-in-heart-rate-zone', () => day('calories-in-heart-rate-zone')),
      this.settle('resting-hr', () => daily('daily-resting-heart-rate', 'daily_resting_heart_rate.date')),
      this.settle('hr-zones', () => daily('daily-heart-rate-zones', 'daily_heart_rate_zones.date')),
      this.settle('exercise', () => this.reconcile(
        userId,
        token,
        'exercise',
        `exercise.interval.civil_start_time >= "${dateStr}" AND exercise.interval.civil_start_time < "${next}"`,
        GOOGLE_SOURCES_FAMILY,
      )),
      this.settle('activity-level', () => this.reconcile(
        userId,
        token,
        'activity-level',
        `activity_level.interval.civil_start_time >= "${dateStr}" AND activity_level.interval.civil_start_time < "${next}"`,
        GOOGLE_WEARABLES_FAMILY,
      )),
    ]);
    this.assertSome('activity', parts);
    const [steps, activeMinutes, sedentary, calories, azm, timeInZone, caloriesInZone, resting, zones, exercises, activityLevel] = parts;

    return assembleActivitySummary({
      stepsRollup: first(steps.value),
      activeMinutesRollup: first(activeMinutes.value),
      sedentaryRollup: first(sedentary.value),
      caloriesRollup: first(calories.value),
      azmRollup: first(azm.value),
      timeInZoneRollup: first(timeInZone.value),
      caloriesInZoneRollup: first(caloriesInZone.value),
      restingPoints: resting.value ?? [],
      zoneThresholdPoints: zones.value ?? [],
      exercisePoints: exercises.value ?? [],
      activityLevelPoints: activityLevel.value ?? [],
      date: dateStr,
    });
  }

  async getFoodLog(date = 'today', userId: string): Promise<FoodLog> {
    const dateStr = this.resolveDate(date);
    const next = this.nextCivilDate(dateStr);
    const token = await this.tokenBox(userId);
    const filter = `nutrition_log.interval.civil_start_time >= "${dateStr}" AND nutrition_log.interval.civil_start_time < "${next}"`;
    const points = await this.reconcile(userId, token, 'nutrition-log', filter, GOOGLE_SOURCES_FAMILY);
    const rollups = await this.settle('nutrition-rollup', () => this.dailyRollup(
      userId, token, 'nutrition-log', dateStr, next, GOOGLE_SOURCES_FAMILY,
    ));
    return assembleFoodLog({ points, rollup: first(rollups.value) });
  }

  async getVitals(userId: string, clientDate?: string): Promise<VitalsData> {
    const dateStr = this.resolveDate(clientDate ?? 'today');
    const next = this.nextCivilDate(dateStr);
    const weekStart = this.shiftCivilDate(dateStr, -6);
    const token = await this.tokenBox(userId);
    const onDay = (dataType: string, field: string, family: string) => this.reconcile(
      userId,
      token,
      dataType,
      `${field} >= "${dateStr}" AND ${field} < "${next}"`,
      family,
    );

    const parts = await Promise.all([
      this.settle('weight', () => this.dailyRollup(userId, token, 'weight', dateStr, next, GOOGLE_SOURCES_FAMILY)),
      this.settle('weight-week', () => this.dailyRollup(userId, token, 'weight', weekStart, next, GOOGLE_SOURCES_FAMILY)),
      this.settle('body-fat', () => this.dailyRollup(userId, token, 'body-fat', dateStr, next, GOOGLE_SOURCES_FAMILY)),
      this.settle('hydration', () => this.dailyRollup(userId, token, 'hydration-log', dateStr, next, GOOGLE_SOURCES_FAMILY)),
      this.settle('spo2', () => onDay('daily-oxygen-saturation', 'daily_oxygen_saturation.date', GOOGLE_WEARABLES_FAMILY)),
      this.settle('vo2', () => onDay('daily-vo2-max', 'daily_vo2_max.date', GOOGLE_WEARABLES_FAMILY)),
      this.settle('respiratory', () => onDay('daily-respiratory-rate', 'daily_respiratory_rate.date', GOOGLE_WEARABLES_FAMILY)),
      this.settle('height', () => this.reconcile(
        userId,
        token,
        'height',
        'height.sample_time.civil_time >= "2000-01-01"',
        GOOGLE_SOURCES_FAMILY,
      )),
    ]);
    this.assertSome('vitals', parts);
    const [weight, weekWeight, bodyFat, hydration, spo2, vo2, respiratory, height] = parts;

    return assembleVitals({
      date: dateStr,
      weightRollup: first(weight.value),
      weekWeightRollups: weekWeight.value ?? [],
      bodyFatRollup: first(bodyFat.value),
      hydrationRollup: first(hydration.value),
      spo2Points: spo2.value ?? [],
      vo2Points: vo2.value ?? [],
      respiratoryPoints: respiratory.value ?? [],
      heightPoints: height.value ?? [],
    });
  }

  async hasTokens(userId: string): Promise<boolean> {
    const t = await getDataService().getWearableTokens(userId, 'google');
    return !!t?.access_token;
  }

  /** @deprecated Prefer parseGoogleSleep. Kept so existing parser tests call the service. */
  parseSleep(data: { dataPoints?: unknown[] } | null | undefined, dateStr: string): WearableSleepData {
    return parseGoogleSleep(data as never, dateStr);
  }

  private resolveDate(date: string): string {
    return date === 'today' ? new Date().toLocaleDateString('en-CA') : date;
  }

  private async tokenBox(userId: string): Promise<TokenBox> {
    const tokens = await this.getValidTokens(userId);
    return { current: tokens.access_token };
  }

  private async settle<T>(label: string, run: () => Promise<T>): Promise<{ value: T | null; error?: string }> {
    try {
      return { value: await run() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[GOOGLE-HEALTH] ${label} skipped: ${message}`);
      return { value: null, error: message };
    }
  }

  /** A fully denied or fully failed fan-out must not look like a real zero day. */
  private assertSome(label: string, parts: Array<{ error?: string }>): void {
    if (parts.some(part => part.error == null)) return;
    const denied = parts.some(part => (part.error || '').includes('403'));
    if (denied) {
      throw new Error(`Google Health API error: 403 (${label} scope not authorized — re-authorize at /api/google-health/connect-url)`);
    }
    throw new Error(`Google Health ${label} fetch failed: ${parts[0]?.error || 'unknown'}`);
  }

  private async reconcile(
    userId: string,
    token: TokenBox,
    dataType: string,
    filter: string,
    family: string,
  ): Promise<any[]> {
    const points: any[] = [];
    let pageToken = '';
    for (let page = 0; page < 8; page++) {
      const q = new URLSearchParams({ filter, dataSourceFamily: family });
      if (pageToken) q.set('pageToken', pageToken);
      const url = `${API_BASE}/users/me/dataTypes/${dataType}/dataPoints:reconcile?${q}`;
      const body = await this.withToken<ReconcilePage>(userId, token, access => fetch(url, {
        headers: this.authHeaders(access),
      }));
      points.push(...(body.dataPoints ?? []));
      if (!body.nextPageToken) break;
      pageToken = body.nextPageToken;
    }
    return points;
  }

  private async dailyRollup(
    userId: string,
    token: TokenBox,
    dataType: string,
    startDate: string,
    endDate: string,
    family: string,
  ): Promise<any[]> {
    const url = `${API_BASE}/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`;
    const body = await this.withToken<RollupPage>(userId, token, access => fetch(url, {
      method: 'POST',
      headers: { ...this.authHeaders(access), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        range: {
          start: this.civilDateTime(startDate),
          end: this.civilDateTime(endDate),
        },
        windowSizeDays: 1,
        dataSourceFamily: family,
      }),
    }));
    return body.rollupDataPoints ?? [];
  }

  private civilDateTime(yyyyMmDd: string): { date: { year: number; month: number; day: number } } {
    const [year, month, day] = yyyyMmDd.split('-').map(Number);
    return { date: { year, month, day } };
  }

  private authHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    };
  }

  private async withToken<T>(
    userId: string,
    token: TokenBox,
    run: (accessToken: string) => Promise<Response>,
  ): Promise<T> {
    let res = await run(token.current);
    if (res.status === 401) {
      const stored = await getDataService().getWearableTokens(userId, 'google');
      if (!stored) throw new Error('Google Health not connected — authorize at /api/google-health/connect-url');
      const refreshed = await this.doRefresh(stored, userId);
      token.current = refreshed.access_token;
      res = await run(token.current);
    }
    if (!res.ok) {
      throw new Error(`Google Health API error: ${res.status} (re-authorize at /api/google-health/connect-url if a scope was withheld)`);
    }
    return await res.json() as T;
  }

  private nextCivilDate(yyyyMmDd: string): string {
    return this.shiftCivilDate(yyyyMmDd, 1);
  }

  private shiftCivilDate(yyyyMmDd: string, days: number): string {
    const [y, m, d] = yyyyMmDd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
  }

  private async getValidTokens(userId: string): Promise<WearableTokens> {
    const tokens = await getDataService().getWearableTokens(userId, 'google');
    if (!tokens) throw new Error('Google Health not connected — authorize at /api/google-health/connect-url');
    if (Date.now() < tokens.expires_at) return tokens;
    return this.doRefresh(tokens, userId);
  }

  private async doRefresh(tokens: WearableTokens, userId: string): Promise<WearableTokens> {
    if (!this.isConfigured()) throw new Error('Google Health client credentials not configured');
    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id:     this.clientId,
      client_secret: this.clientSecret,
    });
    const res = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });
    if (!res.ok) throw new Error(`Google Health token refresh failed: ${await res.text()}`);
    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };
    const next: WearableTokens = {
      access_token:  data.access_token,
      refresh_token: data.refresh_token || tokens.refresh_token,
      expires_at:    Date.now() + (data.expires_in - 60) * 1000,
      scope:         data.scope || tokens.scope,
    };
    await this.saveTokens(userId, next);
    return next;
  }

  private async saveTokens(userId: string, tokens: WearableTokens): Promise<void> {
    await getDataService().saveWearableTokens(userId, 'google', tokens);
  }
}

function first<T>(rows: T[] | null | undefined): T | null {
  return rows && rows.length > 0 ? rows[0] : null;
}
