/** Shared wearable sleep payload (maps into journal fitbit_score / sleep_hours). */
export interface WearableSleepData {
  score: number;
  hours: number;
  vitality: number;
  efficiency: number;
  deep_min: number;
  rem_min: number;
  light_min: number;
  awake_min: number;
  startTime?: string;
  endTime?: string;
}

export interface WearableReadinessData {
  score: number;           // 0–100
  temperatureDeviation?: number;
  hrvBalance?: number;
  date: string;            // YYYY-MM-DD
}

export type WearableProvider = 'oura' | 'garmin' | 'fitbit' | 'whoop';

export interface WearableTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix ms
  scope?: string;
}

export interface IWearableService {
  readonly provider: WearableProvider;
  isConfigured(): boolean;
  getAuthUrl(state: string): string;
  exchangeCode(code: string, userId: string): Promise<void>;
  getSleepData(date: string, userId: string): Promise<WearableSleepData>;
  getReadiness?(date: string, userId: string): Promise<WearableReadinessData | null>;
}
