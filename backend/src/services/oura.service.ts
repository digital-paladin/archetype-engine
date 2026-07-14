import { getDataService } from './data/dataService';
import {
  IWearableService,
  WearableProvider,
  WearableReadinessData,
  WearableSleepData,
  WearableTokens,
} from './wearable.types';

/**
 * Oura Ring API v2 — primary wearable (S2).
 * Docs: https://cloud.ouraring.com/v2/docs
 */
export class OuraService implements IWearableService {
  readonly provider: WearableProvider = 'oura';

  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor() {
    this.clientId     = process.env.OURA_CLIENT_ID || '';
    this.clientSecret = process.env.OURA_CLIENT_SECRET || '';
    this.redirectUri  = process.env.OURA_REDIRECT_URI
      || 'http://localhost:3000/api/oura/callback';
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  getAuthUrl(state: string): string {
    if (!this.clientId) throw new Error('OURA_CLIENT_ID not set in environment');
    const params = new URLSearchParams({
      client_id:     this.clientId,
      redirect_uri:  this.redirectUri,
      response_type: 'code',
      scope:         'daily personal',
      state,
    });
    return `https://cloud.ouraring.com/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string, userId: string): Promise<void> {
    if (!this.isConfigured()) throw new Error('Oura client credentials not configured');

    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  this.redirectUri,
      client_id:     this.clientId,
      client_secret: this.clientSecret,
    });

    const res = await fetch('https://api.ouraring.com/oauth/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });

    if (!res.ok) throw new Error(`Oura token exchange failed: ${await res.text()}`);

    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope?: string;
    };

    await this.saveTokens(userId, {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    Date.now() + (data.expires_in - 60) * 1000,
      scope:         data.scope,
    });
    console.log(`[OURA] ✅ Tokens saved for user ${userId.slice(0, 8)}…`);
  }

  async getSleepData(date = 'today', userId: string): Promise<WearableSleepData> {
    const dateStr = date === 'today' ? new Date().toLocaleDateString('en-CA') : date;
    const tokens  = await this.getValidTokens(userId);
    const res     = await this.fetchDailySleep(tokens.access_token, dateStr);

    if (res.status === 401) {
      const refreshed = await this.doRefresh(tokens, userId);
      const retry = await this.fetchDailySleep(refreshed.access_token, dateStr);
      if (!retry.ok) throw new Error(`Oura sleep API error: ${retry.status}`);
      return this.parseSleep(await retry.json(), dateStr);
    }
    if (!res.ok) throw new Error(`Oura sleep API error: ${res.status}`);
    return this.parseSleep(await res.json(), dateStr);
  }

  async getReadiness(date = 'today', userId: string): Promise<WearableReadinessData | null> {
    const dateStr = date === 'today' ? new Date().toLocaleDateString('en-CA') : date;
    const tokens  = await this.getValidTokens(userId);
    const res     = await this.fetchDailyReadiness(tokens.access_token, dateStr);

    if (res.status === 401) {
      const refreshed = await this.doRefresh(tokens, userId);
      const retry = await this.fetchDailyReadiness(refreshed.access_token, dateStr);
      if (!retry.ok) throw new Error(`Oura readiness API error: ${retry.status}`);
      return this.parseReadiness(await retry.json(), dateStr);
    }
    if (!res.ok) throw new Error(`Oura readiness API error: ${res.status}`);
    return this.parseReadiness(await res.json(), dateStr);
  }

  async hasTokens(userId: string): Promise<boolean> {
    const t = await getDataService().getWearableTokens(userId, 'oura');
    return !!t?.access_token;
  }

  // ── Parsing (exported for unit tests via parse helpers) ───────────────────

  parseSleep(data: any, dateStr: string): WearableSleepData {
    const rows = Array.isArray(data?.data) ? data.data : [];
    const row  = rows.find((r: any) => r.day === dateStr) || rows[0];
    if (!row) {
      return {
        score: 0, hours: 0, vitality: 0, efficiency: 0,
        deep_min: 0, rem_min: 0, light_min: 0, awake_min: 0,
      };
    }

    const score      = Number(row.score ?? 0);
    const totalSec   = Number(row.total_sleep_duration ?? row.contributors?.total_sleep ?? 0);
    const hours      = Math.round((totalSec / 3600) * 10) / 10;
    const deepSec    = Number(row.deep_sleep_duration ?? 0);
    const remSec     = Number(row.rem_sleep_duration ?? 0);
    const lightSec   = Number(row.light_sleep_duration ?? 0);
    const awakeSec   = Number(row.awake_time ?? 0);
    const efficiency = Number(row.efficiency ?? 0);

    return {
      score,
      hours,
      vitality:   Math.round((score / 10) * 10) / 10,
      efficiency,
      deep_min:   Math.round(deepSec / 60),
      rem_min:    Math.round(remSec / 60),
      light_min:  Math.round(lightSec / 60),
      awake_min:  Math.round(awakeSec / 60),
      startTime:  row.bedtime_start ? this.toHHMM(row.bedtime_start) : undefined,
      endTime:    row.bedtime_end ? this.toHHMM(row.bedtime_end) : undefined,
    };
  }

  parseReadiness(data: any, dateStr: string): WearableReadinessData | null {
    const rows = Array.isArray(data?.data) ? data.data : [];
    const row  = rows.find((r: any) => r.day === dateStr) || rows[0];
    if (!row || row.score == null) return null;
    return {
      score:                 Number(row.score),
      temperatureDeviation:  row.temperature_deviation != null
        ? Number(row.temperature_deviation) : undefined,
      hrvBalance:            row.contributors?.hrv_balance != null
        ? Number(row.contributors.hrv_balance) : undefined,
      date:                  row.day || dateStr,
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private toHHMM(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  private fetchDailySleep(accessToken: string, date: string) {
    const q = new URLSearchParams({ start_date: date, end_date: date });
    return fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?${q}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  private fetchDailyReadiness(accessToken: string, date: string) {
    const q = new URLSearchParams({ start_date: date, end_date: date });
    return fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?${q}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  private async getValidTokens(userId: string): Promise<WearableTokens> {
    const tokens = await getDataService().getWearableTokens(userId, 'oura');
    if (!tokens) throw new Error('Oura not connected — authorize at /api/oura/connect-url');
    if (Date.now() < tokens.expires_at) return tokens;
    return this.doRefresh(tokens, userId);
  }

  private async doRefresh(tokens: WearableTokens, userId: string): Promise<WearableTokens> {
    if (!this.isConfigured()) throw new Error('Oura client credentials not configured');
    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id:     this.clientId,
      client_secret: this.clientSecret,
    });
    const res = await fetch('https://api.ouraring.com/oauth/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });
    if (!res.ok) throw new Error(`Oura token refresh failed: ${await res.text()}`);
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
    await getDataService().saveWearableTokens(userId, 'oura', tokens);
  }
}
