import { getDataService } from './data/dataService';
import { FitbitTokens } from './data/IDataService';

export interface SleepData {
  score: number;      // 0–100 composite score
  hours: number;      // total sleep hours (1 decimal)
  vitality: number;   // 0–10 derived metric
  efficiency: number; // 0–100 Fitbit efficiency %
  deep_min: number;
  rem_min: number;
  light_min: number;
  awake_min: number;
  startTime?: string;  // HH:MM bedtime (main sleep entry)
  endTime?: string;    // HH:MM wake time (main sleep entry)
}

export interface FitbitActivity {
  name: string;
  durationMin: number;    // minutes
  calories: number;
  steps?: number;
  distanceKm?: number;
  startTime: string;      // "HH:MM"
}

export interface HeartZone {
  name: string;           // 'Fat Burn' | 'Cardio' | 'Peak'
  minutes: number;
  calOut: number;
  min: number;
  max: number;
}

export interface FoodEntry {
  name: string;
  brand?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  amount: number;
  unit: string;
  mealType: string;
  logId: number;
}

export interface FoodLog {
  entries: FoodEntry[];
  totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number; water: number };
  goalCalories: number;
}

export interface ActivitySummary {
  steps: number;
  activeMinutes: number;       // fairlyActive + veryActive
  lightlyActiveMinutes?: number;
  sedentaryMinutes?: number;
  caloriesOut: number;
  activeZoneMinutes?: number;  // HR-zone-weighted intensity (Fitbit AZM)
  activities: FitbitActivity[];
  restingHR?: number;          // requires heartrate scope
  heartZones?: HeartZone[];    // Fat Burn, Cardio, Peak (only zones with > 0 min)
}

export interface VitalsData {
  weight?: number;          // raw value in user's unit setting (lbs or kg)
  bmi?: number;
  bodyFat?: number;         // body fat %
  spo2Avg?: number;         // blood oxygen avg % (last night)
  spo2Min?: number;
  spo2Max?: number;
  vo2Max?: string;          // VO2 max range string e.g. "42–46"
  respiratoryRate?: number; // nightly avg breaths per min
  waterOz?: number;         // total water logged today (fl oz, converted from Fitbit ml)
  weeklyAvgWeight?: number; // 7-day rolling avg bodyweight (lbs, converted)
  weeklyWeightDays?: number;// how many of the past 7 days had a weight log entry
}

export class FitbitService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor() {
    this.clientId     = process.env.FITBIT_CLIENT_ID     || '';
    this.clientSecret = process.env.FITBIT_CLIENT_SECRET || '';
    this.redirectUri  = process.env.FITBIT_REDIRECT_URI  || '';
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  getAuthUrl(): string {
    if (!this.clientId) throw new Error('FITBIT_CLIENT_ID not set in environment');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id:     this.clientId,
      scope:         'activity cardio_fitness electrocardiogram heartrate irregular_rhythm_notifications location nutrition oxygen_saturation profile respiratory_rate settings sleep social temperature weight',
      redirect_uri:  this.redirectUri,
    });
    return `https://www.fitbit.com/oauth2/authorize?${params}`;
  }

  async exchangeCode(code: string, userId: string): Promise<void> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Fitbit client credentials not configured');
    }
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    });

    const res = await fetch('https://api.fitbit.com/oauth2/token', {
      method:  'POST',
      headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });

    if (!res.ok) throw new Error(`Fitbit token exchange failed: ${await res.text()}`);

    const data = await res.json() as any;
    await this.saveTokens(userId, {
      access_token:   data.access_token,
      refresh_token:  data.refresh_token,
      expires_at:     Date.now() + (data.expires_in - 60) * 1000,
      fitbit_user_id: data.user_id,
    });
    console.log(`[FITBIT] ✅ Tokens saved for user: ${data.user_id}`);
  }

  async getSleepData(date = 'today', userId: string): Promise<SleepData> {
    const dateStr = date === 'today' ? new Date().toLocaleDateString('en-CA') : date;
    console.log(`[FITBIT] Fetching sleep data from Fitbit API (date=${dateStr})...`);
    const tokens = await this.getValidTokens(userId);
    console.log(`[FITBIT] Token valid — user_id=${tokens.fitbit_user_id ?? '-'} expires_at=${new Date(tokens.expires_at).toISOString()}`);
    const res = await this.fetchSleep(tokens.access_token, dateStr);
    console.log(`[FITBIT] Sleep API response status: ${res.status}`);
    if (res.status === 401) {
      console.warn('[FITBIT] 401 received — attempting token refresh...');
      const refreshed = await this.doRefresh(tokens, userId);
      const retry = await this.fetchSleep(refreshed.access_token, dateStr);
      console.log(`[FITBIT] Retry response status: ${retry.status}`);
      if (!retry.ok) throw new Error(`Fitbit sleep API error: ${retry.status}`);
      return this.parse(await retry.json() as any);
    }
    if (res.status === 403) throw new Error(`Fitbit sleep API error: 403 (scope not authorized — re-authorize at /api/fitbit/auth)`);
    if (!res.ok) throw new Error(`Fitbit sleep API error: ${res.status}`);
    return this.parse(await res.json() as any);
  }

  async getActivities(date = 'today', userId: string): Promise<ActivitySummary> {
    console.log(`[FITBIT] Fetching activities from Fitbit API (date=${date})...`);
    const tokens = await this.getValidTokens(userId);
    const dateStr = date === 'today' ? new Date().toISOString().split('T')[0] : date;
    const res = await this.fetchActivities(tokens.access_token, dateStr);
    console.log(`[FITBIT] Activities API response status: ${res.status}`);
    if (res.status === 401) {
      console.warn('[FITBIT] 401 received — attempting token refresh...');
      const refreshed = await this.doRefresh(tokens, userId);
      const retry = await this.fetchActivities(refreshed.access_token, dateStr);
      if (!retry.ok) throw new Error(`Fitbit activities API error: ${retry.status}`);
      return this.parseActivities(await retry.json() as any);
    }
    if (!res.ok) throw new Error(`Fitbit activities API error: ${res.status}`);
    return this.parseActivities(await res.json() as any);
  }

  async getFoodLog(date = 'today', userId: string): Promise<FoodLog> {
    console.log(`[FITBIT] Fetching food log from Fitbit API (date=${date})...`);
    const tokens = await this.getValidTokens(userId);
    const dateStr = date === 'today' ? new Date().toISOString().split('T')[0] : date;
    const res = await this.fetchFoodLog(tokens.access_token, dateStr);
    console.log(`[FITBIT] Food log API response status: ${res.status}`);
    if (res.status === 401) {
      console.warn('[FITBIT] 401 received — attempting token refresh...');
      const refreshed = await this.doRefresh(tokens, userId);
      const retry = await this.fetchFoodLog(refreshed.access_token, dateStr);
      if (!retry.ok) throw new Error(`Fitbit food log API error: ${retry.status}`);
      return this.parseFoodLog(await retry.json() as any);
    }
    if (!res.ok) throw new Error(`Fitbit food log API error: ${res.status}`);
    return this.parseFoodLog(await res.json() as any);
  }

  async getVitals(userId: string, clientDate?: string): Promise<VitalsData> {
    console.log('[FITBIT] Fetching vitals from Fitbit API...');
    const tokens = await this.getValidTokens(userId);
    const today  = clientDate ?? new Date().toISOString().split('T')[0];
    const h = { 'Authorization': `Bearer ${tokens.access_token}` };

    const [wRes, fRes, sRes, cRes, rRes, hRes, w7Res] = await Promise.allSettled([
      fetch(`https://api.fitbit.com/1/user/-/body/log/weight/date/${today}.json`,    { headers: h }),
      fetch(`https://api.fitbit.com/1/user/-/body/log/fat/date/${today}.json`,       { headers: h }),
      fetch(`https://api.fitbit.com/1/user/-/spo2/date/${today}.json`,               { headers: h }),
      fetch(`https://api.fitbit.com/1/user/-/cardioscore/date/${today}.json`,         { headers: h }),
      fetch(`https://api.fitbit.com/1/user/-/br/date/${today}/all.json`,             { headers: h }),
      fetch(`https://api.fitbit.com/1/user/-/foods/log/water/date/${today}.json`,    { headers: h }),
      fetch(`https://api.fitbit.com/1/user/-/body/log/weight/date/${today}/7d.json`, { headers: h }),
    ]);

    const safeJson = async (r: PromiseSettledResult<Response>): Promise<any> => {
      if (r.status === 'rejected') return null;
      if (!r.value.ok) return null;
      try { return await r.value.json(); } catch { return null; }
    };

    const [wData, fData, sData, cData, rData, hData, w7Data] = await Promise.all([
      safeJson(wRes), safeJson(fRes), safeJson(sRes), safeJson(cRes), safeJson(rRes), safeJson(hRes), safeJson(w7Res),
    ]);

    return this.parseVitals(wData, fData, sData, cData, rData, hData, w7Data);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private fetchSleep(accessToken: string, date: string) {
    return fetch(`https://api.fitbit.com/1.2/user/-/sleep/date/${date}.json`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
  }

  private fetchActivities(accessToken: string, date: string) {
    return fetch(`https://api.fitbit.com/1/user/-/activities/date/${date}.json`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
  }

  private fetchFoodLog(accessToken: string, date: string) {
    return fetch(`https://api.fitbit.com/1/user/-/foods/log/date/${date}.json`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
  }

  private parseActivities(data: any): ActivitySummary {
    const summary = data.summary || {};
    const activities: FitbitActivity[] = (data.activities || []).map((a: any) => ({
      name:       a.name       || 'Activity',
      durationMin: Math.round((a.duration || 0) / 60000),
      calories:   a.calories  || 0,
      steps:      (a.steps    > 0) ? a.steps                             : undefined,
      distanceKm: (a.distance > 0) ? Math.round(a.distance * 10) / 10   : undefined,
      startTime:  a.startTime || '',
    }));
    const result: ActivitySummary = {
      steps:                summary.steps || 0,
      activeMinutes:        (summary.fairlyActiveMinutes || 0) + (summary.veryActiveMinutes || 0),
      lightlyActiveMinutes: (summary.lightlyActiveMinutes > 0) ? summary.lightlyActiveMinutes : undefined,
      sedentaryMinutes:     (summary.sedentaryMinutes > 0) ? summary.sedentaryMinutes : undefined,
      caloriesOut:          summary.caloriesOut || 0,
      activeZoneMinutes:    (summary.activeZoneMinutes?.total > 0) ? summary.activeZoneMinutes.total : undefined,
      activities,
      restingHR:            (summary.restingHeartRate > 0) ? summary.restingHeartRate : undefined,
      heartZones:    (summary.heartRateZones || [])
        .filter((z: any) => z.name !== 'Out of Range' && (z.minutes ?? 0) > 0)
        .map((z: any) => ({
          name:    z.name,
          minutes: z.minutes,
          calOut:  Math.round(z.caloriesOut || 0),
          min:     z.min,
          max:     z.max,
        })),
    };
    console.log(`[FITBIT] ── Activity Parse Results ────────────────`);
    console.log(`[FITBIT]   Steps          : ${result.steps}`);
    console.log(`[FITBIT]   Active min     : ${result.activeMinutes}`);
    console.log(`[FITBIT]   Lightly active : ${result.lightlyActiveMinutes ?? 'n/a'}`);
    console.log(`[FITBIT]   Sedentary min  : ${result.sedentaryMinutes ?? 'n/a'}`);
    console.log(`[FITBIT]   Active zone min: ${result.activeZoneMinutes ?? 'n/a'}`);
    console.log(`[FITBIT]   Calories out   : ${result.caloriesOut}`);
    console.log(`[FITBIT]   Activities     : ${activities.length} logged`);
    activities.forEach(a => console.log(`[FITBIT]     - ${a.name}: ${a.durationMin}min ${a.calories}cal`));
    console.log(`[FITBIT] ─────────────────────────────────────────────`);
    return result;
  }

  private parseFoodLog(data: any): FoodLog {
    const MEAL_NAMES: Record<number, string> = {
      1: 'Breakfast', 2: 'Morning Snack', 3: 'Lunch',
      4: 'Afternoon Snack', 5: 'Dinner', 6: 'Evening Snack', 7: 'Anytime',
    };
    const entries: FoodEntry[] = (data.foods || []).map((f: any) => {
      const lf = f.loggedFood || {};
      const nv = lf.nutritionalValues || {};
      return {
        name:      lf.name     || 'Unknown',
        brand:     lf.brand    || undefined,
        calories:  Math.round(nv.calories || lf.calories || 0),
        protein:   Math.round((nv.protein  || 0) * 10) / 10,
        carbs:     Math.round((nv.carbs    || 0) * 10) / 10,
        fat:       Math.round((nv.fat      || 0) * 10) / 10,
        fiber:     Math.round((nv.fiber    || 0) * 10) / 10,
        amount:    lf.amount   || 1,
        unit:      lf.unit?.name || 'serving',
        mealType:  MEAL_NAMES[lf.mealTypeId] || 'Anytime',
        logId:     f.logId     || 0,
      };
    });
    const s = data.summary || {};
    const totals = {
      calories: Math.round(s.calories || 0),
      protein:  Math.round((s.protein || 0) * 10) / 10,
      carbs:    Math.round((s.carbs   || 0) * 10) / 10,
      fat:      Math.round((s.fat     || 0) * 10) / 10,
      fiber:    Math.round((s.fiber   || 0) * 10) / 10,
      water:    Math.round(s.water    || 0),
    };
    console.log(`[FITBIT] ── Food Log Parse Results ─────────────`);
    console.log(`[FITBIT]   Entries  : ${entries.length} logged`);
    console.log(`[FITBIT]   Protein  : ${totals.protein}g / Calories: ${totals.calories} kcal`);
    console.log(`[FITBIT]   Carbs    : ${totals.carbs}g / Fat: ${totals.fat}g`);
    console.log(`[FITBIT] ────────────────────────────────────────`);
    return { entries, totals, goalCalories: data.goals?.calories || 0 };
  }

  private parseVitals(
    wData: any, fData: any, sData: any, cData: any, rData: any, hData: any, w7Data?: any,
  ): VitalsData {
    const result: VitalsData = {};

    const wEntry = (wData?.weight ?? [])[0];
    if (wEntry) {
      // Fitbit returns weight in the account's unit system; convert kg → lbs
      result.weight = Math.round(wEntry.weight * 2.20462 * 10) / 10;
      result.bmi    = Math.round(wEntry.bmi   * 10) / 10;
    }

    const fEntry = (fData?.fat ?? [])[0];
    if (fEntry) {
      result.bodyFat = Math.round(fEntry.fat * 10) / 10;
    }

    if (sData?.value) {
      result.spo2Avg = Math.round((sData.value.avg ?? sData.value) * 10) / 10;
      result.spo2Min = sData.value.min != null ? Math.round(sData.value.min * 10) / 10 : undefined;
      result.spo2Max = sData.value.max != null ? Math.round(sData.value.max * 10) / 10 : undefined;
    }

    const cEntry = (cData?.cardioScore ?? [])[0];
    if (cEntry?.value?.vo2Max) {
      result.vo2Max = cEntry.value.vo2Max;
    }

    const rEntry = (rData?.br ?? [])[0];
    if (rEntry?.value?.breathingRate) {
      result.respiratoryRate = Math.round(rEntry.value.breathingRate * 10) / 10;
    }

    const waterMl = hData?.summary?.water ?? 0;
    if (waterMl > 0) {
      result.waterOz = Math.round(waterMl / 29.5735);
    }

    // ── Weekly average weight (7-day range) ────────────────────────────────
    const weekEntries: number[] = (w7Data?.weight ?? [])
      .map((e: any) => e.weight * 2.20462)
      .filter((v: number) => v > 0);
    if (weekEntries.length > 0) {
      const sum = weekEntries.reduce((a: number, b: number) => a + b, 0);
      result.weeklyAvgWeight = Math.round((sum / weekEntries.length) * 10) / 10;
      result.weeklyWeightDays = Math.min(weekEntries.length, 7); // Fitbit '7d' range can return 8 entries; cap at 7
    }

    console.log('[FITBIT] ── Vitals Parse Results ─────────────────');
    console.log(`[FITBIT]   Weight          : ${result.weight ?? 'n/a'}`);
    console.log(`[FITBIT]   BMI             : ${result.bmi    ?? 'n/a'}`);
    console.log(`[FITBIT]   Body fat        : ${result.bodyFat ?? 'n/a'}%`);
    console.log(`[FITBIT]   SpO2 avg        : ${result.spo2Avg ?? 'n/a'}%`);
    console.log(`[FITBIT]   SpO2 range      : ${result.spo2Min ?? '?'}–${result.spo2Max ?? '?'}%`);
    console.log(`[FITBIT]   VO2 max         : ${result.vo2Max  ?? 'n/a'}`);
    console.log(`[FITBIT]   Respiratory rate: ${result.respiratoryRate ?? 'n/a'} br/min`);
    console.log(`[FITBIT]   Hydration       : ${result.waterOz ?? 'n/a'} oz (${waterMl} ml raw)`);
    console.log(`[FITBIT]   Weekly avg wt   : ${result.weeklyAvgWeight ?? 'n/a'} lbs (${result.weeklyWeightDays ?? 0}/7 days)`);
    console.log('[FITBIT] ─────────────────────────────────────────');
    return result;
  }

  private parse(data: any): SleepData {
    const summary    = data.summary || {};
    const stages     = summary.stages || {};
    const totalMin   = summary.totalMinutesAsleep || 0;
    const totalBed   = summary.totalTimeInBed    || totalMin || 1;
    const efficiency = Math.min(Math.round((totalMin / totalBed) * 100), 100);
    const hours      = Math.round((totalMin / 60) * 10) / 10;
    // Vitality: 8-hr target × efficiency, capped at 10
    const vitality   = Math.min(Math.round(((totalMin / 480) * (efficiency / 100)) * 100) / 10, 10);
    // Composite score: hours 60% + efficiency 40%, mapped 0–100
    const score      = Math.min(Math.round((totalMin / 480) * 60 + (efficiency / 100) * 40), 100);

    console.log(`[FITBIT] ── Sleep Parse Results ──────────────────`);
    console.log(`[FITBIT]   Total sleep    : ${totalMin} min (${hours} hrs)`);
    console.log(`[FITBIT]   Time in bed    : ${totalBed} min`);
    console.log(`[FITBIT]   Efficiency     : ${efficiency}%`);
    console.log(`[FITBIT]   Deep           : ${stages.deep  || 0} min`);
    console.log(`[FITBIT]   REM            : ${stages.rem   || 0} min`);
    console.log(`[FITBIT]   Light          : ${stages.light || 0} min`);
    console.log(`[FITBIT]   Awake          : ${stages.wake  || 0} min`);
    console.log(`[FITBIT]   Score (calc)   : ${score} / 100`);
    console.log(`[FITBIT]   Vitality (calc): ${vitality} / 10`);
    console.log(`[FITBIT] ─────────────────────────────────────────`);

    // Extract bedtime / wake time from main sleep entry
    const mainSleep = (data.sleep as any[] | undefined)
      ?.find((s: any) => s.isMainSleep) ?? (data.sleep as any[])?.[0];
    const toHHMM = (iso: string | undefined): string | undefined => {
      if (!iso) return undefined;
      const m = iso.match(/(\d{2}:\d{2})/);
      return m ? m[1] : undefined;
    };

    return {
      score, hours, vitality, efficiency,
      deep_min:  stages.deep  || 0,
      rem_min:   stages.rem   || 0,
      light_min: stages.light || 0,
      awake_min: stages.wake  || 0,
      startTime: toHHMM(mainSleep?.startTime),
      endTime:   toHHMM(mainSleep?.endTime),
    };
  }

  private async doRefresh(tokens: FitbitTokens, userId: string): Promise<FitbitTokens> {
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch('https://api.fitbit.com/oauth2/token', {
      method:  'POST',
      headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }).toString(),
    });
    if (!res.ok) throw new Error(`Fitbit token refresh failed: ${await res.text()}`);
    const data = await res.json() as any;
    const refreshed: FitbitTokens = {
      access_token:   data.access_token,
      refresh_token:  data.refresh_token || tokens.refresh_token,
      expires_at:     Date.now() + (data.expires_in - 60) * 1000,
      fitbit_user_id: data.user_id || tokens.fitbit_user_id,
    };
    await this.saveTokens(userId, refreshed);
    console.log('[FITBIT] ✅ Tokens refreshed');
    return refreshed;
  }

  private async getValidTokens(userId: string): Promise<FitbitTokens> {
    const db     = getDataService();
    const tokens = await db.getFitbitTokens(userId);
    if (!tokens) throw new Error('No Fitbit tokens found. Visit /api/fitbit/auth to authorize.');
    if (Date.now() >= tokens.expires_at) {
      console.log('[FITBIT] Access token expired — refreshing...');
      return this.doRefresh(tokens, userId);
    }
    return tokens;
  }

  private async saveTokens(userId: string, tokens: FitbitTokens): Promise<void> {
    const db = getDataService();
    await db.saveFitbitTokens(userId, tokens);
  }
}
