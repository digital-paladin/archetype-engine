import { validateRecoveryActivity, isTrainingActivity } from './recoveryQuests.service';
import { XpCalculatorService, WEARABLE_XP_RULES, WEARABLE_XP_TYPES, isWearableXpType } from './xpCalculator.service';
import {
  calendarMonthKey,
  chooseSleepSource,
  clampPassiveAwards,
  deviceOwnershipXp,
  followedLighterPlan,
  googleBodyCompositionXp,
  heartMetricXp,
  humeScanAward,
  humeScanDedupeKey,
  humeTrendAward,
  humeTrendDedupeKey,
  isPrimaryWorkoutSource,
  isSameWorkoutSession,
  isWithinWearableBackfill,
  isoWeekKey,
  readinessAdherenceAward,
  readinessEffect,
  readinessScoreXp,
  sleepAward,
  sleepDedupeKey,
  stepsAward,
  stepsDedupeKey,
} from './wearableMetricXp';

const NOW = new Date('2026-11-14T18:00:00.000Z');

describe('wearable XP table', () => {
  const calc = new XpCalculatorService();

  it('names the awards next to recovery and workout entries and keeps them off the loggable list', () => {
    expect(calc.calculateXP(WEARABLE_XP_TYPES.sleepDuration)).toBe(10);
    expect(calc.calculateXP(WEARABLE_XP_TYPES.sleepScore)).toBe(5);
    expect(calc.calculateXP(WEARABLE_XP_TYPES.readinessAdherence)).toBe(10);
    expect(calc.calculateXP(WEARABLE_XP_TYPES.steps8k)).toBe(5);
    expect(calc.calculateXP(WEARABLE_XP_TYPES.steps10k)).toBe(10);
    expect(calc.calculateXP(WEARABLE_XP_TYPES.humeScan)).toBe(15);
    expect(calc.calculateXP(WEARABLE_XP_TYPES.humeTrend)).toBe(25);
    expect(calc.getCategoryFromActivity(WEARABLE_XP_TYPES.steps10k)).toBe('warrior');
    expect(calc.getCategoryFromActivity(WEARABLE_XP_TYPES.sleepDuration)).toBe('warrior');

    const listed = new Set(calc.getActivityTypes().map(entry => entry.type));
    for (const type of Object.values(WEARABLE_XP_TYPES)) {
      expect(isWearableXpType(type)).toBe(true);
      expect(listed.has(type)).toBe(false);
    }
  });

  it('does not treat a step award as training, so Thursday rest still stands', () => {
    expect(isTrainingActivity(WEARABLE_XP_TYPES.steps10k)).toBe(false);
    expect(isTrainingActivity('workout-strength')).toBe(true);
    const steps = [{
      user_id: 'player-1',
      activity_type: WEARABLE_XP_TYPES.steps10k,
      class_name: 'Warrior',
      logged_at: '2026-11-12T12:00:00.000Z',
      xp_awarded: 10,
    }];
    expect(validateRecoveryActivity('recovery-rest-day', '2026-11-12', steps, '2026-11-12').ok).toBe(true);
    expect(validateRecoveryActivity('recovery-wearable-sleep', '2026-11-12', [], '2026-11-12').ok).toBe(false);
  });
});

describe('sleep source and cap', () => {
  it('uses Oura when both devices have the night, and Google only when Oura has no record', () => {
    const oura = chooseSleepSource({ hours: 6, score: 90 }, { hours: 8, score: 95 }, 'google-health');
    expect(oura.source).toBe('oura');
    expect(sleepAward(oura.night!.hours, oura.night!.score).xp).toBe(0);

    const google = chooseSleepSource(null, { hours: 8, score: 80 }, 'google-health');
    expect(google.source).toBe('google-health');
    expect(sleepAward(google.night!.hours, google.night!.score)).toMatchObject({ xp: 15 });
    expect(sleepDedupeKey('2026-11-14')).toBe('wearable:sleep:2026-11-14');
  });

  it('pays 10 at 7 hours, 15 when the score is also 80, and nothing under 7 hours', () => {
    expect(sleepAward(7, 79).xp).toBe(10);
    expect(sleepAward(7, 80).xp).toBe(WEARABLE_XP_RULES.sleepMaxPerNight);
    expect(sleepAward(6.9, 99).xp).toBe(0);
    expect(sleepAward(9, 100).xp).toBe(15);
  });

  it('accepts Fitbit sleep only as the fallback source', () => {
    const fitbit = chooseSleepSource({ hours: 0, score: 0 }, { hours: 7.5, score: 70 }, 'fitbit');
    expect(fitbit.source).toBe('fitbit');
    expect(sleepAward(fitbit.night!.hours, fitbit.night!.score).xp).toBe(10);
  });
});

describe('steps source and cap', () => {
  it('pays Google Health only, 5 at 8000 and 10 at 10000', () => {
    expect(stepsAward(12000, 'oura')).toMatchObject({ xp: 0, reason: 'steps_source' });
    expect(stepsAward(12000, 'fitbit')).toMatchObject({ xp: 0, reason: 'steps_source' });
    expect(stepsAward(7999, 'google-health').xp).toBe(0);
    expect(stepsAward(8000, 'google').xp).toBe(5);
    expect(stepsAward(10000, 'google-health').xp).toBe(WEARABLE_XP_RULES.stepsMaxPerDay);
    expect(stepsAward(20000, 'Google-Health').xp).toBe(10);
    expect(stepsDedupeKey('2026-11-14')).toBe('wearable:steps:2026-11-14');
  });
});

describe('readiness buff, debuff, and adherence', () => {
  it('applies Well-Rested at 85 and Fatigued below 70, and the score pays nothing', () => {
    expect(readinessScoreXp(99)).toBe(0);
    expect(readinessEffect(85)).toBe('well-rested');
    expect(readinessEffect(84)).toBeNull();
    expect(readinessEffect(70)).toBeNull();
    expect(readinessEffect(69)).toBe('fatigued');
  });

  it('pays 10 only when a fatigued day logged mobility or rest and nothing harder', () => {
    expect(readinessAdherenceAward(69, [{ activityType: 'workout-mobility' }]).xp).toBe(10);
    expect(readinessAdherenceAward(69, [{ activityType: 'recovery-rest-day' }]).xp).toBe(10);
    expect(readinessAdherenceAward(69, [
      { activityType: 'workout-mobility' },
      { activityType: 'personal-project' },
    ]).xp).toBe(10);
    expect(readinessAdherenceAward(69, [{ activityType: 'workout-strength' }]).xp).toBe(0);
    expect(readinessAdherenceAward(69, []).xp).toBe(0);
    expect(readinessAdherenceAward(85, [{ activityType: 'workout-mobility' }]).xp).toBe(0);
    expect(followedLighterPlan([{ activityType: 'workout-cardio' }])).toBe(false);
  });
});

describe('passive cap, back-fill, and non-awards', () => {
  it('caps sleep, adherence, and steps at 40 and leaves the earlier awards intact', () => {
    const clamped = clampPassiveAwards([
      { metric: 'sleep', xp: 20 },
      { metric: 'readiness-adherence', xp: 15 },
      { metric: 'steps', xp: 10 },
    ], 0, 40);
    expect(clamped.map(row => row.xp)).toEqual([20, 15, 5]);

    const full = clampPassiveAwards([
      { metric: 'steps', xp: 10 },
    ], 40, 40);
    expect(full[0].xp).toBe(0);
  });

  it('allows today and the three previous Chicago days', () => {
    expect(isWithinWearableBackfill('2026-11-14', NOW)).toBe(true);
    expect(isWithinWearableBackfill('2026-11-11', NOW)).toBe(true);
    expect(isWithinWearableBackfill('2026-11-10', NOW)).toBe(false);
    expect(isWithinWearableBackfill('2026-11-15', NOW)).toBe(false);
  });

  it('pays nothing for heart metrics, Google body composition, or owning a device', () => {
    expect(heartMetricXp('resting-hr', 60, 'hume')).toBe(0);
    expect(heartMetricXp('hrv', 40, 'oura')).toBe(0);
    expect(heartMetricXp('resting-hr', 48, 'google-health')).toBe(0);
    expect(googleBodyCompositionXp('weight', 180)).toBe(0);
    expect(googleBodyCompositionXp('body-fat', 20)).toBe(0);
    expect(deviceOwnershipXp()).toBe(0);
    expect(isPrimaryWorkoutSource('google')).toBe(true);
    expect(isPrimaryWorkoutSource('Fitbit')).toBe(true);
    expect(isPrimaryWorkoutSource('oura')).toBe(false);
    expect(isPrimaryWorkoutSource('manual')).toBe(false);
  });
});

describe('workout overlap', () => {
  const awarded = { startMs: 0, endMs: 60 * 60_000 };

  it('treats 50% or more of the candidate as the same session', () => {
    expect(isSameWorkoutSession({ startMs: 30 * 60_000, endMs: 90 * 60_000 }, awarded)).toBe(true);
    expect(isSameWorkoutSession({ startMs: 0, endMs: 120 * 60_000 }, awarded)).toBe(true);
    expect(isSameWorkoutSession({ startMs: 50 * 60_000, endMs: 150 * 60_000 }, awarded)).toBe(false);
  });
});

describe('Hume scan and trend rules', () => {
  const scan = (date: string, overrides: Record<string, unknown> = {}) => ({
    source: 'hume',
    measuredAt: `${date}T15:00:00.000Z`,
    proofRef: `app-record:${date}`,
    skeletalMuscleMassLb: 40,
    weightLb: 180,
    bodyFatPct: 20,
    fasted: true,
    ...overrides,
  });

  it('pays 15 for a proved Hume scan and nothing without proof or from another source', () => {
    expect(humeScanAward(scan('2026-11-09')).xp).toBe(15);
    expect(humeScanAward(scan('2026-11-09', { proofRef: '  ', appRecordId: null })).xp).toBe(0);
    expect(humeScanAward(scan('2026-11-09', { proofRef: null, appRecordId: 'scale-1' })).xp).toBe(15);
    expect(humeScanAward(scan('2026-11-09', { source: 'google-health' })).reason).toBe('hume_source');
    expect(humeScanDedupeKey(isoWeekKey('2026-11-09'))).toBe('wearable:hume-scan:2026-W46');
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01');
    expect(isoWeekKey('2026-11-08')).toBe('2026-W45');
  });

  it('pays the monthly bonus once the last four consecutive weeks move lean mass up or fat mass down', () => {
    const readings = [
      scan('2026-10-19', { skeletalMuscleMassLb: 40, bodyFatPct: 20 }),
      scan('2026-10-26', { skeletalMuscleMassLb: 40.4, bodyFatPct: 19 }),
      scan('2026-11-02', { skeletalMuscleMassLb: 40.8, bodyFatPct: 18 }),
      scan('2026-11-09', { skeletalMuscleMassLb: 41.2, bodyFatPct: 17 }),
      scan('2026-11-09', { source: 'google', proofRef: 'app-record:google', skeletalMuscleMassLb: 10, bodyFatPct: 40 }),
    ];
    const trend = humeTrendAward(readings, new Date('2026-11-09T18:00:00.000Z'));
    expect(trend.xp).toBe(25);
    expect(trend.month).toBe('2026-11');
    expect(humeTrendDedupeKey(trend.month!)).toBe('wearable:hume-trend:2026-11');
    expect(calendarMonthKey('2026-11-09')).toBe('2026-11');
  });

  it('withholds the trend when a week is missing or the masses do not move', () => {
    const now = new Date('2026-11-09T18:00:00.000Z');
    const flat = [
      scan('2026-10-19'),
      scan('2026-10-26'),
      scan('2026-11-02'),
      scan('2026-11-09'),
    ];
    expect(humeTrendAward(flat, now).xp).toBe(0);

    const gapped = [
      scan('2026-10-05', { skeletalMuscleMassLb: 40 }),
      scan('2026-10-19', { skeletalMuscleMassLb: 41 }),
      scan('2026-11-02', { skeletalMuscleMassLb: 42 }),
      scan('2026-11-09', { skeletalMuscleMassLb: 43 }),
    ];
    expect(humeTrendAward(gapped, now).xp).toBe(0);
  });
});
