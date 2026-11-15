import { getDataService } from './data/dataService';
import { JournalEntry } from './data/IDataService';
import { OuraError } from './ouraErrors';
import {
  normalizeOuraDay,
  OuraActivitySummary,
  OuraDayNormalized,
  OuraReadinessSummary,
  OuraSleepSummary,
  toWearableReadiness,
  toWearableSleep,
} from './ouraNormalize';
import { openOuraSecret, sealOuraSecret } from './ouraTokenCrypto';
import {
  deleteOuraUserData,
  getLatestOuraSummary,
  getOuraSyncStatus,
  OuraSummaryRecord,
  upsertOuraSummary,
  upsertOuraSyncStatus,
} from './ouraSummaryStore';
import { syncSleepDebtFromJournalSafe } from './sleepDebt.service';
import { chicagoDay } from './activityOccurredAt';
import { isRealIsoDate } from './recoveryQuests.service';
import {
  IWearableService,
  WearableProvider,
  WearableReadinessData,
  WearableSleepData,
  WearableTokens,
} from './wearable.types';

/**
 * Oura API v2 — OAuth2 authorization code only.
 * Personal access tokens were deprecated in December 2025 and are not accepted.
 * Docs: https://cloud.ouraring.com/v2/docs
 *
 * Scope is `daily` only: daily sleep, readiness, and activity summaries.
 * Durations and bedtimes are read from /sleep. If Oura refuses that route,
 * the sync stays partial and keeps the daily_sleep score. Heart-rate series,
 * workouts, personal info, email, tags, sessions, and SpO2 are not requested.
 */
export const OURA_AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize';
export const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
export const OURA_API_BASE = 'https://api.ouraring.com/v2/usercollection';
export const OURA_SCOPE = 'daily';

const COLLECTION_PATHS = ['daily_sleep', 'sleep', 'daily_readiness', 'daily_activity'] as const;
type CollectionPath = typeof COLLECTION_PATHS[number];

export interface OuraSyncResult {
  date: string;
  status: OuraDayNormalized['status'];
  detail: string;
  journalUpdated: boolean;
  /** Oura sync never awards XP. Readiness is not a workout or a medical instruction. */
  xpAwarded: 0;
  sleep: OuraSleepSummary;
  readiness: OuraReadinessSummary;
  activity: OuraActivitySummary;
}

export interface OuraConnectionStatus {
  configured: boolean;
  connected: boolean;
  requestedScope: 'daily';
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncDetail: string | null;
  lastSummaryDate: string | null;
  latest: {
    date: string;
    timezone: string | null;
    noData: boolean;
    partial: boolean;
    sleep: OuraSleepSummary | null;
    readiness: OuraReadinessSummary | null;
    activity: OuraActivitySummary | null;
  } | null;
}

export class OuraService implements IWearableService {
  readonly provider: WearableProvider = 'oura';
  private readonly refreshLocks = new Map<string, Promise<WearableTokens>>();

  private creds(): { clientId: string; clientSecret: string; redirectUri: string } {
    const clientId = process.env.OURA_CLIENT_ID?.trim() || '';
    const clientSecret = process.env.OURA_CLIENT_SECRET?.trim() || '';
    const configuredRedirect = process.env.OURA_REDIRECT_URI?.trim() || '';
    const redirectUri = configuredRedirect || 'http://localhost:3000/api/oura/callback';
    return { clientId, clientSecret, redirectUri };
  }

  isConfigured(): boolean {
    const { clientId, clientSecret } = this.creds();
    if (!clientId || !clientSecret) return false;
    if (process.env.NODE_ENV === 'production' && !process.env.OURA_REDIRECT_URI?.trim()) return false;
    return true;
  }

  getAuthUrl(state: string): string {
    const { clientId, redirectUri } = this.creds();
    if (!clientId) throw new OuraError('Oura is not configured.', 503, 'not_configured');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: OURA_SCOPE,
      state,
    });
    return `${OURA_AUTHORIZE_URL}?${params}`;
  }

  async exchangeCode(code: string, userId: string): Promise<void> {
    const { clientId, clientSecret, redirectUri } = this.creds();
    if (!clientId || !clientSecret) {
      throw new OuraError('Oura is not configured.', 503, 'not_configured');
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });
    let res: Response;
    try {
      res = await fetch(OURA_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch {
      throw new OuraError('Oura could not be reached.', 502, 'upstream');
    }
    const parsed = await readJson(res);
    if (!res.ok) {
      console.error(`[OURA] token exchange HTTP ${res.status}`);
      throw new OuraError(
        'Oura authorization failed. Check the redirect URI and client credentials.',
        502,
        'upstream',
      );
    }
    const access = typeof parsed.access_token === 'string' ? parsed.access_token : '';
    const refresh = typeof parsed.refresh_token === 'string' ? parsed.refresh_token : '';
    const scope = typeof parsed.scope === 'string' ? parsed.scope : undefined;
    if (!access || !refresh) {
      throw new OuraError('Oura did not return a refresh token. Connect again.', 502, 'upstream');
    }
    if (scope && !scope.split(/\s+/).includes(OURA_SCOPE)) {
      throw new OuraError(
        'Oura did not grant the daily scope. Connect again and allow daily summaries.',
        403,
        'forbidden',
      );
    }
    await this.saveTokens(userId, {
      access_token: access,
      refresh_token: refresh,
      expires_at: expiresAtFrom(parsed.expires_in, Date.now()),
      scope: scope || OURA_SCOPE,
    });
    console.log(`[OURA] tokens saved for user ${userId.slice(0, 8)}`);
  }

  async getSleepData(date = 'today', userId: string): Promise<WearableSleepData> {
    const dateStr = this.resolveDate(date);
    const docs = await this.collect(userId, dateStr, ['daily_sleep', 'sleep']);
    if (docs.daily_sleep.forbidden && docs.sleep.forbidden) {
      throw new OuraError(
        'Oura refused this read. The membership may be inactive, or the daily scope was not granted.',
        403,
        'forbidden',
      );
    }
    const day = normalizeOuraDay({
      date: dateStr,
      dailySleep: { data: docs.daily_sleep.rows },
      sleepPeriods: { data: docs.sleep.rows },
      dailyReadiness: { data: [] },
      dailyActivity: { data: [] },
      forbidden: forbiddenNames(docs),
    });
    return toWearableSleep(day.sleep);
  }

  async getReadiness(date = 'today', userId: string): Promise<WearableReadinessData | null> {
    const dateStr = this.resolveDate(date);
    const docs = await this.collect(userId, dateStr, ['daily_readiness']);
    if (docs.daily_readiness.forbidden) {
      throw new OuraError(
        'Oura refused this read. The membership may be inactive, or the daily scope was not granted.',
        403,
        'forbidden',
      );
    }
    const day = normalizeOuraDay({
      date: dateStr,
      dailySleep: { data: [] },
      sleepPeriods: { data: [] },
      dailyReadiness: { data: docs.daily_readiness.rows },
      dailyActivity: { data: [] },
      forbidden: forbiddenNames(docs),
    });
    return toWearableReadiness(day.readiness);
  }

  /**
   * Fetches one Chicago-or-explicit civil day and upserts it for this user.
   * Does not award activity XP and does not turn readiness into a workout.
   */
  async syncDay(userId: string, date: string): Promise<OuraSyncResult> {
    const dateStr = this.resolveDate(date);
    let docs: CollectionDocs;
    try {
      docs = await this.collect(userId, dateStr, [...COLLECTION_PATHS]);
    } catch (err) {
      if (err instanceof OuraError && err.code === 'rate_limited') {
        await this.recordStatus(userId, dateStr, 'rate_limited', err.safeMessage, null);
      }
      throw err;
    }
    const day = normalizeOuraDay({
      date: dateStr,
      dailySleep: { data: docs.daily_sleep.rows },
      sleepPeriods: { data: docs.sleep.rows },
      dailyReadiness: { data: docs.daily_readiness.rows },
      dailyActivity: { data: docs.daily_activity.rows },
      forbidden: forbiddenNames(docs),
    });
    const syncedAt = new Date().toISOString();
    const record: OuraSummaryRecord = {
      user_id: userId,
      summary_date: dateStr,
      timezone: day.timezone,
      sleep: day.sleep,
      readiness: day.readiness,
      activity: day.activity,
      provenance: {
        provider: 'oura',
        api: 'v2',
        scope: OURA_SCOPE,
        requestedDate: dateStr,
        sourceDay: dateStr,
        timezoneOffset: day.timezone,
        endpoints: {
          daily_sleep: !day.sleep.missing || docs.daily_sleep.forbidden,
          sleep: day.sleep.periodDocumentId != null || docs.sleep.forbidden,
          daily_readiness: !day.readiness.missing || docs.daily_readiness.forbidden,
          daily_activity: !day.activity.missing || docs.daily_activity.forbidden,
        },
        forbidden: day.forbiddenEndpoints,
        fetchedAt: syncedAt,
      },
      partial: day.status === 'partial' || day.status === 'forbidden',
      no_data: day.status === 'no_data',
      synced_at: syncedAt,
    };
    await upsertOuraSummary(record);
    const journalUpdated = await this.writeJournalSleepIfEmpty(userId, dateStr, toWearableSleep(day.sleep));
    const statusName = day.status === 'forbidden' ? 'forbidden' : day.status;
    await this.recordStatus(userId, dateStr, statusName, day.detail, day.timezone);
    return {
      date: dateStr,
      status: day.status,
      detail: day.detail,
      journalUpdated,
      xpAwarded: 0,
      sleep: day.sleep,
      readiness: day.readiness,
      activity: day.activity,
    };
  }

  async writeJournalSleepIfEmpty(
    userId: string,
    date: string,
    sleep: WearableSleepData,
  ): Promise<boolean> {
    if (!(sleep.score > 0) && !(sleep.hours > 0)) return false;
    try {
      const existing = await getDataService().getJournalEntry(userId, date);
      // Hours already on the journal are left alone. That covers a manual nap
      // and a night this sync already completed.
      if ((existing?.sleep_hours ?? 0) > 0) return false;
      const hasScore = (existing?.fitbit_score ?? 0) > 0;
      if (!hasScore && !(sleep.score > 0)) return false;
      const patch: Partial<JournalEntry> = {
        user_id: userId,
        entry_date: date,
      };
      if (!hasScore && sleep.score > 0) patch.fitbit_score = sleep.score;
      if (sleep.hours > 0) {
        patch.sleep_hours = sleep.hours;
        if (sleep.startTime) patch.sleep_start = sleep.startTime;
        if (sleep.endTime) patch.sleep_end = sleep.endTime;
      }
      if (patch.fitbit_score == null && patch.sleep_hours == null) return false;
      await getDataService().upsertJournalEntry(userId, patch);
      await syncSleepDebtFromJournalSafe(userId);
      return true;
    } catch (err) {
      if (err instanceof OuraError) throw err;
      console.error('[OURA] journal write failed');
      throw new OuraError('Oura sleep could not be written to the journal.', 500, 'storage');
    }
  }

  async hasTokens(userId: string): Promise<boolean> {
    const row = await getDataService().getWearableTokens(userId, 'oura');
    return !!row?.access_token;
  }

  async disconnect(userId: string): Promise<void> {
    await getDataService().deleteWearableTokens(userId, 'oura');
    try {
      await deleteOuraUserData(userId);
    } catch (err) {
      if (err instanceof OuraError && err.code === 'storage') return;
      throw err;
    }
  }

  async connectionStatus(userId: string): Promise<OuraConnectionStatus> {
    const connected = await this.hasTokens(userId);
    let lastSyncAt: string | null = null;
    let lastSyncStatus: string | null = null;
    let lastSyncDetail: string | null = null;
    let lastSummaryDate: string | null = null;
    let latest: OuraConnectionStatus['latest'] = null;
    try {
      const status = await getOuraSyncStatus(userId);
      if (status) {
        lastSyncAt = status.last_sync_at;
        lastSyncStatus = status.last_sync_status;
        lastSyncDetail = status.last_sync_detail;
        lastSummaryDate = status.last_summary_date;
      }
      const row = await getLatestOuraSummary(userId);
      if (row) {
        latest = {
          date: String(row.summary_date).slice(0, 10),
          timezone: row.timezone,
          noData: row.no_data,
          partial: row.partial,
          sleep: row.sleep,
          readiness: row.readiness,
          activity: row.activity,
        };
      }
    } catch (err) {
      console.warn(`[OURA] status read failed: ${err instanceof OuraError ? err.code : 'error'}`);
    }
    return {
      configured: this.isConfigured(),
      connected,
      requestedScope: 'daily',
      lastSyncAt,
      lastSyncStatus,
      lastSyncDetail,
      lastSummaryDate,
      latest,
    };
  }

  resolveDate(date: string): string {
    if (date === 'today' || date.trim() === '') return chicagoDay(new Date());
    if (!isRealIsoDate(date)) {
      throw new OuraError('date must be YYYY-MM-DD', 400, 'bad_request');
    }
    return date;
  }

  private async collect(
    userId: string,
    date: string,
    paths: CollectionPath[],
  ): Promise<CollectionDocs> {
    const tokens = await this.getValidTokens(userId);
    const holder = { tokens };
    const docs = emptyDocs();
    for (const path of paths) {
      try {
        docs[path] = {
          rows: await this.fetchCollection(userId, holder, path, date),
          forbidden: false,
        };
      } catch (err) {
        if (err instanceof OuraError && err.code === 'forbidden') {
          docs[path] = { rows: [], forbidden: true };
          continue;
        }
        throw err;
      }
    }
    return docs;
  }

  private async fetchCollection(
    userId: string,
    holder: { tokens: WearableTokens },
    path: CollectionPath,
    date: string,
  ): Promise<unknown[]> {
    const rows: unknown[] = [];
    const seenTokens = new Set<string>();
    let next: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const params = new URLSearchParams({ start_date: date, end_date: date });
      if (next) params.set('next_token', next);
      const url = `${OURA_API_BASE}/${path}?${params}`;
      let result = await this.send(holder.tokens.access_token, url);
      if (result.status === 401) {
        holder.tokens = await this.doRefresh(holder.tokens, userId);
        result = await this.send(holder.tokens.access_token, url);
      }
      if (result.status === 401) {
        await this.markRevoked(userId);
        throw new OuraError(
          'Oura authorization expired or was revoked. Connect again.',
          401,
          'revoked',
        );
      }
      if (result.status === 403) {
        throw new OuraError(
          'Oura refused this read. The membership may be inactive, or the daily scope was not granted.',
          403,
          'forbidden',
        );
      }
      if (result.status === 429) {
        throw new OuraError('Oura rate limit reached. Try again shortly.', 429, 'rate_limited');
      }
      if (result.status !== 200) {
        console.error(`[OURA] ${path} HTTP ${result.status}`);
        throw new OuraError('Oura returned an error.', 502, 'upstream');
      }
      const data = Array.isArray(result.body?.data) ? result.body.data : [];
      for (const row of data) {
        const id = row && typeof row === 'object' && 'id' in row
          ? String((row as { id?: unknown }).id ?? '')
          : '';
        if (id && rows.some((existing) => existing && typeof existing === 'object' && String((existing as { id?: unknown }).id ?? '') === id)) {
          continue;
        }
        rows.push(row);
      }
      const token = typeof result.body?.next_token === 'string' ? result.body.next_token : '';
      if (!token || seenTokens.has(token)) break;
      seenTokens.add(token);
      next = token;
    }
    return rows;
  }

  private async send(
    accessToken: string,
    url: string,
    attempt = 0,
  ): Promise<{ status: number; body: { data?: unknown[]; next_token?: string } | null }> {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'archetype-engine',
        },
      });
    } catch {
      throw new OuraError('Oura could not be reached.', 502, 'upstream');
    }
    if (res.status === 429 && attempt < 1) {
      await res.text().catch(() => '');
      await pause(retryAfterMs(res.headers.get('retry-after')));
      return this.send(accessToken, url, attempt + 1);
    }
    const text = await res.text();
    let body: { data?: unknown[]; next_token?: string } | null = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { status: res.status, body };
  }

  private async getValidTokens(userId: string): Promise<WearableTokens> {
    const row = await getDataService().getWearableTokens(userId, 'oura');
    if (!row?.access_token || !row.refresh_token) {
      throw new OuraError('Oura is not connected.', 401, 'not_connected');
    }
    const tokens: WearableTokens = {
      access_token: openOuraSecret(row.access_token),
      refresh_token: openOuraSecret(row.refresh_token),
      expires_at: row.expires_at,
      scope: row.scope,
    };
    if (Date.now() < tokens.expires_at) return tokens;
    return this.doRefresh(tokens, userId);
  }

  private doRefresh(tokens: WearableTokens, userId: string): Promise<WearableTokens> {
    const existing = this.refreshLocks.get(userId);
    if (existing) return existing;
    const pending = this.refreshOnce(tokens, userId)
      .finally(() => this.refreshLocks.delete(userId));
    this.refreshLocks.set(userId, pending);
    return pending;
  }

  private async refreshOnce(tokens: WearableTokens, userId: string): Promise<WearableTokens> {
    const { clientId, clientSecret } = this.creds();
    if (!clientId || !clientSecret) {
      throw new OuraError('Oura is not configured.', 503, 'not_configured');
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    });
    let res: Response;
    try {
      res = await fetch(OURA_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch {
      throw new OuraError('Oura could not be reached.', 502, 'upstream');
    }
    const parsed = await readJson(res);
    if (!res.ok) {
      const errorCode = typeof parsed.error === 'string' ? parsed.error : '';
      console.error(`[OURA] token refresh HTTP ${res.status}`);
      if (res.status === 400 || res.status === 401 || errorCode === 'invalid_grant') {
        await this.markRevoked(userId);
        throw new OuraError(
          'Oura authorization expired or was revoked. Connect again.',
          401,
          'revoked',
        );
      }
      throw new OuraError('Oura token refresh failed.', 502, 'upstream');
    }
    const access = typeof parsed.access_token === 'string' ? parsed.access_token : '';
    if (!access) throw new OuraError('Oura token refresh failed.', 502, 'upstream');
    const next: WearableTokens = {
      access_token: access,
      refresh_token: typeof parsed.refresh_token === 'string' && parsed.refresh_token
        ? parsed.refresh_token
        : tokens.refresh_token,
      expires_at: expiresAtFrom(parsed.expires_in, Date.now()),
      scope: typeof parsed.scope === 'string' ? parsed.scope : tokens.scope,
    };
    await this.saveTokens(userId, next);
    return next;
  }

  private async markRevoked(userId: string): Promise<void> {
    try {
      await getDataService().deleteWearableTokens(userId, 'oura');
    } catch {
      console.error('[OURA] token delete failed during revoke');
    }
    await this.recordStatus(
      userId,
      null,
      'revoked',
      'Oura authorization expired or was revoked. Connect again.',
      null,
    );
  }

  private async recordStatus(
    userId: string,
    date: string | null,
    status: 'ok' | 'partial' | 'no_data' | 'forbidden' | 'revoked' | 'rate_limited',
    detail: string,
    timezone: string | null,
  ): Promise<void> {
    try {
      await upsertOuraSyncStatus({
        user_id: userId,
        last_sync_at: new Date().toISOString(),
        last_sync_status: status,
        last_sync_detail: detail,
        last_summary_date: date,
        timezone,
      });
    } catch (err) {
      if (err instanceof OuraError && err.code === 'storage' && status === 'revoked') return;
      throw err;
    }
  }

  private async saveTokens(userId: string, tokens: WearableTokens): Promise<void> {
    await getDataService().saveWearableTokens(userId, 'oura', {
      access_token: sealOuraSecret(tokens.access_token),
      refresh_token: sealOuraSecret(tokens.refresh_token),
      expires_at: tokens.expires_at,
      scope: tokens.scope,
    });
  }
}

interface CollectionBucket {
  rows: unknown[];
  forbidden: boolean;
}

type CollectionDocs = Record<CollectionPath, CollectionBucket>;

function emptyDocs(): CollectionDocs {
  return {
    daily_sleep: { rows: [], forbidden: false },
    sleep: { rows: [], forbidden: false },
    daily_readiness: { rows: [], forbidden: false },
    daily_activity: { rows: [], forbidden: false },
  };
}

function forbiddenNames(docs: CollectionDocs): string[] {
  return COLLECTION_PATHS.filter((name) => docs[name].forbidden);
}

function expiresAtFrom(expiresIn: unknown, now: number): number {
  const seconds = typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
    ? expiresIn
    : 24 * 60 * 60;
  const buffer = seconds > 120 ? 60 : 0;
  return now + (seconds - buffer) * 1000;
}

function retryAfterMs(header: string | null): number {
  if (!header) return 1000;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, 2000);
  const when = Date.parse(header);
  if (Number.isNaN(when)) return 1000;
  return Math.min(Math.max(when - Date.now(), 0), 2000);
}

function pause(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
