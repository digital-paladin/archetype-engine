import {
  IWearableService,
  WearableProvider,
  WearableSleepData,
} from './wearable.types';

/**
 * Garmin Connect API stub (S2 secondary).
 * Full OAuth + Body Battery lands when GARMIN_* credentials are set and
 * Partner API access is approved.
 */
export class GarminService implements IWearableService {
  readonly provider: WearableProvider = 'garmin';

  isConfigured(): boolean {
    return !!(process.env.GARMIN_CLIENT_ID && process.env.GARMIN_CLIENT_SECRET);
  }

  getAuthUrl(_state: string): string {
    throw new Error('Garmin OAuth not implemented yet — awaiting Partner API credentials');
  }

  async exchangeCode(_code: string, _userId: string): Promise<void> {
    throw new Error('Garmin OAuth not implemented yet');
  }

  async getSleepData(_date: string, _userId: string): Promise<WearableSleepData> {
    throw new Error('Garmin sleep sync stub — not implemented');
  }

  async hasTokens(_userId: string): Promise<boolean> {
    return false;
  }
}
