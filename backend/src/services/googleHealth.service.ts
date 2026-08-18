import { getDataService } from './data/dataService';
import {
  IWearableService,
  WearableProvider,
  WearableSleepData,
  WearableTokens,
} from './wearable.types';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SLEEP_RECONCILE_URL =
  'https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile';
const SLEEP_SCOPE = 'https://www.googleapis.com/auth/googlehealth.sleep.readonly';

interface SleepStage {
  startTime?: string;
  endTime?: string;
  type?: string;
}

interface SleepInterval {
  startTime?: string;
  endTime?: string;
}

interface SleepSession {
  interval?: SleepInterval;
  startTime?: string;
  endTime?: string;
  type?: string;
  sleepType?: string;
  stages?: SleepStage[];
  sleepStages?: SleepStage[];
}

interface DataPoint {
  sleep?: SleepSession;
}

/**
 * Google Health API v4 — Fitbit / Pixel Watch cloud path (sleep slice).
 * Docs: https://developers.google.com/health
 *
 * Tokens live in wearable_tokens (provider=google). Legacy Fitbit Web API
 * tokens stay in fitbit_tokens until the user re-consents.
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
      scope:         SLEEP_SCOPE,
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
    const dateStr = date === 'today' ? new Date().toLocaleDateString('en-CA') : date;
    const tokens  = await this.getValidTokens(userId);
    const res     = await this.fetchSleep(tokens.access_token, dateStr);

    if (res.status === 401) {
      const refreshed = await this.doRefresh(tokens, userId);
      const retry = await this.fetchSleep(refreshed.access_token, dateStr);
      if (!retry.ok) throw new Error(`Google Health sleep API error: ${retry.status}`);
      return this.parseSleep(await retry.json() as { dataPoints?: DataPoint[] }, dateStr);
    }
    if (!res.ok) throw new Error(`Google Health sleep API error: ${res.status}`);
    return this.parseSleep(await res.json() as { dataPoints?: DataPoint[] }, dateStr);
  }

  async hasTokens(userId: string): Promise<boolean> {
    const t = await getDataService().getWearableTokens(userId, 'google');
    return !!t?.access_token;
  }

  /**
   * Map a reconcile/list payload to WearableSleepData.
   * Google Health has no Fitbit sleep score — derive score/efficiency from stages.
   */
  parseSleep(data: { dataPoints?: DataPoint[] } | null | undefined, dateStr: string): WearableSleepData {
    const empty: WearableSleepData = {
      score: 0, hours: 0, vitality: 0, efficiency: 0,
      deep_min: 0, rem_min: 0, light_min: 0, awake_min: 0,
    };

    const points = Array.isArray(data?.dataPoints) ? data!.dataPoints! : [];
    const sessions = points
      .map(p => p.sleep)
      .filter((s): s is SleepSession => !!s);

    const main = this.pickMainSession(sessions, dateStr);
    if (!main) return empty;

    const startIso = main.interval?.startTime || main.startTime;
    const endIso   = main.interval?.endTime || main.endTime;
    const bedMin   = this.minutesBetween(startIso, endIso);

    const stages = main.stages || main.sleepStages || [];
    let deep = 0, rem = 0, light = 0, awake = 0;
    for (const st of stages) {
      const mins = this.minutesBetween(st.startTime, st.endTime);
      switch ((st.type || '').toUpperCase()) {
        case 'DEEP':  deep  += mins; break;
        case 'REM':   rem   += mins; break;
        case 'LIGHT': light += mins; break;
        case 'AWAKE':
        case 'WAKE':  awake += mins; break;
        default: break;
      }
    }

    const asleepMin  = deep + rem + light;
    const totalMin   = asleepMin > 0 ? asleepMin : Math.max(0, bedMin - awake);
    const totalBed   = bedMin > 0 ? bedMin : (totalMin || 1);
    const efficiency = Math.min(Math.round((totalMin / totalBed) * 100), 100);
    const hours      = Math.round((totalMin / 60) * 10) / 10;
    const vitality   = Math.min(Math.round(((totalMin / 480) * (efficiency / 100)) * 100) / 10, 10);
    const score      = Math.min(Math.round((totalMin / 480) * 60 + (efficiency / 100) * 40), 100);

    return {
      score,
      hours,
      vitality,
      efficiency,
      deep_min:  Math.round(deep),
      rem_min:   Math.round(rem),
      light_min: Math.round(light),
      awake_min: Math.round(awake),
      startTime: this.toHHMM(startIso),
      endTime:   this.toHHMM(endIso),
    };
  }

  private pickMainSession(sessions: SleepSession[], dateStr: string): SleepSession | null {
    if (sessions.length === 0) return null;
    const matching = sessions.filter(s => {
      const end = s.interval?.endTime || s.endTime;
      return end ? end.slice(0, 10) === dateStr : true;
    });
    const pool = matching.length > 0 ? matching : sessions;
    return pool.reduce((best, cur) => {
      const bestLen = this.sessionMinutes(best);
      const curLen  = this.sessionMinutes(cur);
      return curLen > bestLen ? cur : best;
    });
  }

  private sessionMinutes(s: SleepSession): number {
    return this.minutesBetween(s.interval?.startTime || s.startTime, s.interval?.endTime || s.endTime);
  }

  private minutesBetween(start?: string, end?: string): number {
    if (!start || !end) return 0;
    const a = new Date(start).getTime();
    const b = new Date(end).getTime();
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
    return (b - a) / 60000;
  }

  private toHHMM(iso?: string): string | undefined {
    if (!iso) return undefined;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return undefined;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  private fetchSleep(accessToken: string, date: string) {
    const next = this.nextCivilDate(date);
    const filter = `sleep.interval.civil_end_time >= "${date}" AND sleep.interval.civil_end_time < "${next}"`;
    const q = new URLSearchParams({
      filter,
      dataSourceFamily: 'users/me/dataSourceFamilies/google-wearables',
    });
    return fetch(`${SLEEP_RECONCILE_URL}?${q}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
  }

  private nextCivilDate(yyyyMmDd: string): string {
    const [y, m, d] = yyyyMmDd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 1));
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
