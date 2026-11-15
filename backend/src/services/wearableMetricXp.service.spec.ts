const mockLogActivity = jest.fn();
const mockGetActivityLog = jest.fn();
const mockPersist = jest.fn();
const mockOura = {
  isConfigured: jest.fn(),
  hasTokens: jest.fn(),
  getSleepData: jest.fn(),
  getReadiness: jest.fn(),
};
const mockGoogle = {
  isConfigured: jest.fn(),
  hasTokens: jest.fn(),
  getSleepData: jest.fn(),
};
const mockFitbit = {
  isConfigured: jest.fn(),
  getSleepData: jest.fn(),
};

jest.mock('./data/dataService', () => ({
  getDataService: () => ({
    logActivity: (...args: unknown[]) => mockLogActivity(...args),
    getActivityLog: (...args: unknown[]) => mockGetActivityLog(...args),
  }),
}));
jest.mock('./xpAward.service', () => ({
  ...jest.requireActual('./xpAward.service'),
  persistClassXpAwards: (...args: unknown[]) => mockPersist(...args),
}));
jest.mock('./oura.service', () => ({
  OuraService: jest.fn().mockImplementation(() => mockOura),
}));
jest.mock('./googleHealth.service', () => ({
  GoogleHealthService: jest.fn().mockImplementation(() => mockGoogle),
}));
jest.mock('./fitbit.service', () => ({
  FitbitService: jest.fn().mockImplementation(() => mockFitbit),
}));

import { MemoryStatusEffectStore, setStatusEffectStore } from './statusEffect.store';
import { getAllEffects } from './statusEffects.service';
import {
  MemoryWearableXpAwardStore,
  setWearableXpAwardStore,
} from './wearableXpAward.store';
import { awardDailyWearableMetrics, loadGoogleSleep, loadOuraSleep } from './wearableMetricXp.service';
import { setHumeScanSource } from './humeScanSource';

const NOW = new Date('2026-11-14T18:00:00.000Z');

function scan(date: string, lean: number, fatPct: number) {
  return {
    source: 'hume',
    measuredAt: `${date}T15:00:00.000Z`,
    proofRef: `app-record:${date}`,
    skeletalMuscleMassLb: lean,
    weightLb: 180,
    bodyFatPct: fatPct,
    fasted: true,
  };
}

describe('awardDailyWearableMetrics', () => {
  let awards: MemoryWearableXpAwardStore;

  beforeEach(() => {
    awards = new MemoryWearableXpAwardStore();
    setWearableXpAwardStore(awards);
    setStatusEffectStore(new MemoryStatusEffectStore());
    setHumeScanSource(null);
    mockLogActivity.mockReset().mockResolvedValue(undefined);
    mockGetActivityLog.mockReset().mockResolvedValue([]);
    mockPersist.mockReset().mockResolvedValue([]);
    mockOura.isConfigured.mockReset().mockReturnValue(false);
    mockOura.hasTokens.mockReset().mockResolvedValue(false);
    mockOura.getSleepData.mockReset();
    mockOura.getReadiness.mockReset();
    mockGoogle.isConfigured.mockReset().mockReturnValue(false);
    mockGoogle.hasTokens.mockReset().mockResolvedValue(false);
    mockGoogle.getSleepData.mockReset();
    mockFitbit.isConfigured.mockReset().mockReturnValue(false);
    mockFitbit.getSleepData.mockReset();
  });

  afterEach(() => {
    setWearableXpAwardStore(null);
    setStatusEffectStore(null);
    setHumeScanSource(null);
  });

  it('awards Oura sleep once and ignores a higher Google night for the same wake date', async () => {
    const first = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-14',
      now: NOW,
      ouraSleep: { hours: 7.5, score: 80 },
      otherSleep: { hours: 9, score: 99 },
      otherSleepSource: 'google-health',
      steps: 0,
      readinessScore: null,
    });
    expect(first.totalXp).toBe(15);
    expect(first.awards[0]).toMatchObject({
      metric: 'sleep',
      xp: 15,
      source: 'oura',
      dedupeKey: 'wearable:sleep:2026-11-14',
      replay: false,
    });
    expect(mockPersist).toHaveBeenCalledWith('player-1', [{ className: 'Warrior', xp: 15 }]);
    expect(mockLogActivity.mock.calls[0][1].notes).toContain('[wearable:sleep:2026-11-14]');

    const second = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-14',
      now: NOW,
      ouraSleep: { hours: 7.5, score: 80 },
      readinessScore: null,
    });
    expect(second.awards.find(line => line.metric === 'sleep')).toMatchObject({ xp: 0, replay: true });
    expect(second.totalXp).toBe(0);
    expect(mockPersist).toHaveBeenCalledTimes(1);
  });

  it('uses Google sleep when Oura has no record, and refuses Oura steps', async () => {
    const result = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-14',
      now: NOW,
      ouraSleep: null,
      otherSleep: { hours: 8, score: 80 },
      otherSleepSource: 'google-health',
      steps: 15000,
      stepsSource: 'oura',
      readinessScore: null,
    });
    expect(result.awards.find(line => line.metric === 'sleep')).toMatchObject({ xp: 15, source: 'google-health' });
    expect(result.skipped.find(line => line.metric === 'steps')?.reason).toBe('steps_source');
    expect(result.passiveXp).toBe(15);
  });

  it('pays 5 then replaces it is not how steps work: 10000 pays 10, not 15', async () => {
    const eight = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-13',
      now: NOW,
      ouraSleep: null,
      steps: 8000,
      stepsSource: 'google-health',
      readinessScore: null,
    });
    expect(eight.awards.find(line => line.metric === 'steps')?.xp).toBe(5);

    const ten = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-14',
      now: NOW,
      ouraSleep: null,
      steps: 10000,
      stepsSource: 'google-health',
      readinessScore: null,
    });
    expect(ten.awards.find(line => line.metric === 'steps')?.xp).toBe(10);
    expect(ten.passiveXp).toBe(10);
  });

  it('stops passive awards at 40 for the day', async () => {
    await awards.insert({
      userId: 'player-1',
      dedupeKey: 'wearable:sleep:2026-11-14',
      metric: 'sleep',
      awardDate: '2026-11-14',
      source: 'oura',
      activityType: 'recovery-wearable-sleep',
      className: 'Warrior',
      xpAwarded: 36,
    });
    const result = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-14',
      now: NOW,
      ouraSleep: null,
      steps: 12000,
      stepsSource: 'google-health',
      readinessScore: null,
    });
    expect(result.awards.find(line => line.metric === 'steps')?.xp).toBe(4);
    expect(result.passiveXp).toBe(4);
  });

  it('refuses a wake date older than three days', async () => {
    const result = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-10',
      now: NOW,
      ouraSleep: { hours: 8, score: 90 },
      steps: 12000,
      stepsSource: 'google-health',
      readinessScore: 90,
    });
    expect(result.totalXp).toBe(0);
    expect(result.skipped[0]).toEqual({ metric: 'day', reason: 'outside_window' });
    expect(mockPersist).not.toHaveBeenCalled();
    expect(await getAllEffects('player-1', NOW)).toEqual([]);
  });

  it('sets Well-Rested at 85 with no score XP, and pays adherence only for a lighter fatigued day', async () => {
    const rested = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-14',
      now: NOW,
      ouraSleep: null,
      readinessScore: 85,
      activities: [{ activityType: 'workout-mobility' }],
    });
    expect(rested.readinessEffect).toBe('well-rested');
    expect(rested.awards.find(line => line.metric === 'readiness-adherence')).toBeUndefined();
    expect(rested.skipped.find(line => line.metric === 'readiness-adherence')?.reason).toBe('not_adherent');
    const effects = await getAllEffects('player-1', NOW);
    expect(effects.map(effect => effect.name)).toEqual(['Well-Rested']);

    const again = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-14',
      now: NOW,
      ouraSleep: null,
      readinessScore: 85,
      activities: [{ activityType: 'workout-mobility' }],
    });
    expect(again.readinessEffect).toBe('well-rested');
    expect(await getAllEffects('player-1', NOW)).toHaveLength(1);

    const fatigued = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-13',
      now: NOW,
      ouraSleep: null,
      readinessScore: 69,
      activities: [{ activityType: 'workout-mobility' }],
    });
    expect(fatigued.readinessEffect).toBe('fatigued');
    expect(fatigued.awards.find(line => line.metric === 'readiness-adherence')).toMatchObject({
      xp: 10,
      dedupeKey: 'wearable:readiness-adherence:2026-11-13',
    });
    const names = (await getAllEffects('player-1', NOW)).map(effect => effect.name).sort();
    expect(names).toEqual(['Fatigued', 'Well-Rested']);

    const hard = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-12',
      now: NOW,
      ouraSleep: null,
      readinessScore: 69,
      activities: [{ activityType: 'workout-strength' }],
    });
    expect(hard.awards.find(line => line.metric === 'readiness-adherence')).toBeUndefined();
    expect(hard.readinessEffect).toBe('fatigued');
  });

  it('clears the readiness effect when the score is between the thresholds', async () => {
    await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-14',
      now: NOW,
      ouraSleep: null,
      readinessScore: 90,
    });
    await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-14',
      now: NOW,
      ouraSleep: null,
      readinessScore: 70,
    });
    expect(await getAllEffects('player-1', NOW)).toEqual([]);
  });

  it('awards one Hume scan per ISO week and one trend per month, and ignores a scan with no proof', async () => {
    const now = new Date('2026-11-09T18:00:00.000Z');
    const readings = [
      scan('2026-10-19', 40, 20),
      scan('2026-10-26', 40.5, 19),
      scan('2026-11-02', 41, 18),
      { ...scan('2026-11-09', 41.5, 17), proofRef: null, appRecordId: null },
      { ...scan('2026-11-09', 41.5, 17), measuredAt: '2026-11-09T18:00:00.000Z', proofRef: 'app-record:later' },
    ];
    const first = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-09',
      now,
      ouraSleep: null,
      readinessScore: null,
      scans: readings,
    });
    const scanLines = first.awards.filter(line => line.metric === 'hume-scan' && line.xp > 0);
    expect(scanLines).toHaveLength(1);
    expect(scanLines[0].xp).toBe(15);
    expect(scanLines[0].dedupeKey).toBe('wearable:hume-scan:2026-W46');
    expect(first.skipped.filter(line => line.metric === 'hume-scan' && line.reason === 'outside_window').length).toBe(3);
    expect(first.skipped.find(line => line.reason === 'no_proof')).toBeTruthy();
    expect(first.awards.find(line => line.metric === 'hume-trend')).toMatchObject({
      xp: 25,
      dedupeKey: 'wearable:hume-trend:2026-11',
    });

    const second = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-09',
      now,
      ouraSleep: null,
      readinessScore: null,
      scans: readings,
    });
    expect(second.totalXp).toBe(0);
    expect(second.awards.find(line => line.metric === 'hume-scan')).toMatchObject({ xp: 0, replay: true });
    expect(second.awards.find(line => line.metric === 'hume-trend')).toMatchObject({ xp: 0, replay: true });
  });

  it('loads Oura first and does not call Google when Oura has the night', async () => {
    mockOura.isConfigured.mockReturnValue(true);
    mockOura.hasTokens.mockResolvedValue(true);
    mockOura.getSleepData.mockResolvedValue({ hours: 8, score: 81, vitality: 8, efficiency: 90, deep_min: 0, rem_min: 0, light_min: 0, awake_min: 0 });
    mockOura.getReadiness.mockResolvedValue({ score: 86, date: '2026-11-14' });
    mockGoogle.isConfigured.mockReturnValue(true);
    mockGoogle.hasTokens.mockResolvedValue(true);
    mockGetActivityLog.mockResolvedValue([{ activity_type: 'workout-mobility' }]);

    const result = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-14',
      now: NOW,
      steps: 10000,
      stepsSource: 'google-health',
      fetchDevices: true,
    });
    expect(mockGoogle.getSleepData).not.toHaveBeenCalled();
    expect(result.awards.find(line => line.metric === 'sleep')?.source).toBe('oura');
    expect(result.readinessEffect).toBe('well-rested');
    expect(result.awards.find(line => line.metric === 'steps')?.xp).toBe(10);
    expect(result.passiveXp).toBe(25);
  });

  it('falls through to Google sleep when Oura has no record', async () => {
    mockOura.isConfigured.mockReturnValue(true);
    mockOura.hasTokens.mockResolvedValue(true);
    mockOura.getSleepData.mockResolvedValue({ hours: 0, score: 0, vitality: 0, efficiency: 0, deep_min: 0, rem_min: 0, light_min: 0, awake_min: 0 });
    mockOura.getReadiness.mockResolvedValue(null);
    mockGoogle.isConfigured.mockReturnValue(true);
    mockGoogle.hasTokens.mockResolvedValue(true);
    mockGoogle.getSleepData.mockResolvedValue({ hours: 7, score: 70, vitality: 7, efficiency: 80, deep_min: 0, rem_min: 0, light_min: 0, awake_min: 0 });

    const result = await awardDailyWearableMetrics({
      userId: 'player-1',
      date: '2026-11-14',
      now: NOW,
      steps: null,
      fetchDevices: true,
    });
    expect(result.awards.find(line => line.metric === 'sleep')).toMatchObject({ xp: 10, source: 'google-health' });
  });

  it('returns null from the loaders when the device call fails', async () => {
    mockOura.isConfigured.mockReturnValue(true);
    mockOura.hasTokens.mockResolvedValue(true);
    mockOura.getSleepData.mockRejectedValue(new Error('oura down'));
    mockGoogle.isConfigured.mockReturnValue(true);
    mockGoogle.hasTokens.mockResolvedValue(true);
    mockGoogle.getSleepData.mockRejectedValue(new Error('google down'));
    expect(await loadOuraSleep('player-1', '2026-11-14')).toBeNull();
    expect(await loadGoogleSleep('player-1', '2026-11-14')).toBeNull();
  });
});
