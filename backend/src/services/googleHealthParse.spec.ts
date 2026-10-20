import { parseFitbitSleepDay } from './fitbitSleepParse';
import {
  assembleActivitySummary,
  assembleFoodLog,
  assembleVitals,
  parseGoogleSleep,
} from './googleHealthParse';

const stagedSleep = {
  dataPoints: [{
    sleep: {
      interval: {
        startTime: '2026-08-12T22:30:00Z',
        endTime: '2026-08-13T06:30:00Z',
      },
      stages: [
        { startTime: '2026-08-12T22:30:00Z', endTime: '2026-08-12T23:50:00Z', type: 'LIGHT' },
        { startTime: '2026-08-12T23:50:00Z', endTime: '2026-08-13T01:10:00Z', type: 'DEEP' },
        { startTime: '2026-08-13T01:10:00Z', endTime: '2026-08-13T02:40:00Z', type: 'REM' },
        { startTime: '2026-08-13T02:40:00Z', endTime: '2026-08-13T06:10:00Z', type: 'LIGHT' },
        { startTime: '2026-08-13T06:10:00Z', endTime: '2026-08-13T06:30:00Z', type: 'AWAKE' },
      ],
    },
  }],
};

describe('google health parsers', () => {
  it('keeps the Fitbit sleep score so journal fitbit_score and XP consolidation stay aligned', () => {
    const google = parseGoogleSleep(stagedSleep, '2026-08-13');
    const fitbit = parseFitbitSleepDay({
      summary: {
        totalMinutesAsleep: 460,
        totalTimeInBed: 480,
        stages: { deep: 80, rem: 90, light: 290, wake: 20 },
      },
      sleep: [{ isMainSleep: true, startTime: '2026-08-12T22:30:00', endTime: '2026-08-13T06:30:00' }],
    });
    expect(google.hours).toBe(fitbit.hours);
    expect(google.efficiency).toBe(fitbit.efficiency);
    expect(google.score).toBe(fitbit.score);
    expect(google.vitality).toBe(fitbit.vitality);
    expect(google.deep_min).toBe(80);
    expect(google.rem_min).toBe(90);
  });

  it('maps activity rollups and workouts onto the Fitbit activity summary', () => {
    const summary = assembleActivitySummary({
      date: '2026-10-18',
      stepsRollup: { steps: { countSum: '8432' } },
      activeMinutesRollup: {
        activeMinutes: {
          activeMinutesRollupByActivityLevel: [
            { activityLevel: 'LIGHT', activeMinutesSum: '40' },
            { activityLevel: 'MODERATE', activeMinutesSum: '22' },
            { activityLevel: 'VIGOROUS', activeMinutesSum: '15' },
          ],
        },
      },
      sedentaryRollup: { sedentaryPeriod: { durationSum: '28800s' } },
      caloriesRollup: { totalCalories: { kcalSum: 2410.4 } },
      azmRollup: {
        activeZoneMinutes: {
          sumInFatBurnHeartZone: '20',
          sumInCardioHeartZone: '10',
          sumInPeakHeartZone: '4',
        },
      },
      timeInZoneRollup: {
        timeInHeartRateZone: {
          timeInHeartRateZones: [
            { heartRateZone: 'LIGHT', duration: '600s' },
            { heartRateZone: 'MODERATE', duration: '1800s' },
            { heartRateZone: 'VIGOROUS', duration: '900s' },
            { heartRateZone: 'PEAK', duration: '120s' },
          ],
        },
      },
      caloriesInZoneRollup: {
        caloriesInHeartRateZone: {
          caloriesInHeartRateZones: [
            { heartRateZone: 'MODERATE', kcal: 180.2 },
            { heartRateZone: 'VIGOROUS', kcal: 140 },
            { heartRateZone: 'PEAK', kcal: 40.4 },
          ],
        },
      },
      restingPoints: [{
        dailyRestingHeartRate: {
          date: { year: 2026, month: 10, day: 18 },
          beatsPerMinute: '58',
        },
      }],
      zoneThresholdPoints: [{
        dailyHeartRateZones: {
          date: { year: 2026, month: 10, day: 18 },
          heartRateZones: [
            { heartRateZoneType: 'MODERATE', minBeatsPerMinute: '109', maxBeatsPerMinute: '136' },
            { heartRateZoneType: 'VIGOROUS', minBeatsPerMinute: '137', maxBeatsPerMinute: '164' },
            { heartRateZoneType: 'PEAK', minBeatsPerMinute: '165', maxBeatsPerMinute: '190' },
          ],
        },
      }],
      exercisePoints: [{
        exercise: {
          exerciseType: 'RUNNING',
          displayName: 'Running',
          activeDuration: '2700s',
          interval: {
            startTime: '2026-10-18T13:00:00Z',
            endTime: '2026-10-18T13:45:00Z',
            civilStartTime: { time: { hours: 8, minutes: 0 } },
          },
          metricsSummary: {
            caloriesKcal: 420.2,
            distanceMillimeters: 5_400_000,
            steps: '6100',
          },
        },
      }],
    });

    expect(summary.steps).toBe(8432);
    expect(summary.activeMinutes).toBe(37);
    expect(summary.lightlyActiveMinutes).toBe(40);
    expect(summary.sedentaryMinutes).toBe(480);
    expect(summary.caloriesOut).toBe(2410);
    expect(summary.activeZoneMinutes).toBe(34);
    expect(summary.restingHR).toBe(58);
    expect(summary.heartZones).toEqual([
      { name: 'Fat Burn', minutes: 30, calOut: 180, min: 109, max: 136 },
      { name: 'Cardio', minutes: 15, calOut: 140, min: 137, max: 164 },
      { name: 'Peak', minutes: 2, calOut: 40, min: 165, max: 190 },
    ]);
    expect(summary.activities).toEqual([
      {
        name: 'Running',
        durationMin: 45,
        calories: 420,
        steps: 6100,
        distanceKm: 5.4,
        startTime: '08:00',
      },
    ]);
  });

  it('prefers activity-level reconcile minutes over the active-minutes rollup', () => {
    const summary = assembleActivitySummary({
      activeMinutesRollup: {
        activeMinutes: {
          activeMinutesRollupByActivityLevel: [
            { activityLevel: 'LIGHT', activeMinutesSum: '5' },
            { activityLevel: 'MODERATE', activeMinutesSum: '5' },
            { activityLevel: 'VIGOROUS', activeMinutesSum: '5' },
          ],
        },
      },
      sedentaryRollup: { sedentaryPeriod: { durationSum: '100s' } },
      activityLevelPoints: [
        {
          activityLevel: {
            interval: { startTime: '2026-10-18T12:00:00Z', endTime: '2026-10-18T12:40:00Z' },
            activityLevelType: 'LIGHTLY_ACTIVE',
          },
        },
        {
          activityLevel: {
            interval: { startTime: '2026-10-18T13:00:00Z', endTime: '2026-10-18T13:22:00Z' },
            activityLevelType: 'MODERATELY_ACTIVE',
          },
        },
        {
          activityLevel: {
            interval: { startTime: '2026-10-18T14:00:00Z', endTime: '2026-10-18T14:15:00Z' },
            activityLevelType: 'VERY_ACTIVE',
          },
        },
        {
          activityLevel: {
            interval: { startTime: '2026-10-18T00:00:00Z', endTime: '2026-10-18T08:00:00Z' },
            activityLevelType: 'SEDENTARY',
          },
        },
      ],
    });
    expect(summary.lightlyActiveMinutes).toBe(40);
    expect(summary.activeMinutes).toBe(37);
    expect(summary.sedentaryMinutes).toBe(480);
  });

  it('builds a food log and prefers rollup totals for the protein journal write', () => {
    const log = assembleFoodLog({
      points: [{
        name: 'users/me/dataTypes/nutrition-log/dataPoints/lunch-1',
        nutritionLog: {
          foodDisplayName: 'Chicken bowl',
          mealType: 'LUNCH',
          energy: { kcal: 640 },
          totalCarbohydrate: { grams: 48 },
          totalFat: { grams: 18 },
          nutrients: [
            { nutrient: 'PROTEIN', quantity: { grams: 52.2 } },
            { nutrient: 'DIETARY_FIBER', quantity: { grams: 8 } },
          ],
          serving: { amount: 1, foodMeasurementUnitDisplayName: 'bowl' },
        },
      }],
      rollup: {
        nutritionLog: {
          energy: { kcalSum: 1804 },
          totalCarbohydrate: { gramsSum: 160.2 },
          totalFat: { gramsSum: 55 },
          nutrients: [
            { nutrient: 'PROTEIN', quantity: { gramsSum: 142.4 } },
            { nutrient: 'DIETARY_FIBER', quantity: { gramsSum: 28 } },
          ],
        },
      },
    });

    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].mealType).toBe('Lunch');
    expect(log.entries[0].protein).toBe(52.2);
    expect(log.entries[0].unit).toBe('bowl');
    expect(log.entries[0].logId).toBeGreaterThan(0);
    expect(log.totals.protein).toBe(142.4);
    expect(log.totals.calories).toBe(1804);
    expect(log.totals.carbs).toBe(160.2);
    expect(log.goalCalories).toBe(0);
  });

  it('converts weight, hydration, SpO2, and VO2 into the vitals shape', () => {
    const vitals = assembleVitals({
      date: '2026-10-18',
      weightRollup: { weight: { weightGramsAvg: 80_000 } },
      weekWeightRollups: [
        { weight: { weightGramsAvg: 80_000 } },
        { weight: { weightGramsAvg: 79_500 } },
        { weight: {} },
      ],
      bodyFatRollup: { bodyFat: { bodyFatPercentageAvg: 18.24 } },
      hydrationRollup: { hydrationLog: { amountConsumed: { millilitersSum: 1000 } } },
      spo2Points: [{
        dailyOxygenSaturation: {
          date: { year: 2026, month: 10, day: 18 },
          averagePercentage: 96.4,
          lowerBoundPercentage: 94.1,
          upperBoundPercentage: 98.2,
        },
      }],
      vo2Points: [{
        dailyVo2Max: { date: { year: 2026, month: 10, day: 18 }, vo2Max: 42 },
      }],
      respiratoryPoints: [{
        dailyRespiratoryRate: { date: { year: 2026, month: 10, day: 18 }, breathsPerMinute: 14.26 },
      }],
      heightPoints: [{
        height: { sampleTime: { physicalTime: '2026-01-01T00:00:00Z' }, heightMillimeters: '1800' },
      }],
    });

    expect(vitals.weight).toBeCloseTo(176.4, 1);
    expect(vitals.weeklyWeightDays).toBe(2);
    expect(vitals.weeklyAvgWeight).toBeGreaterThan(170);
    expect(vitals.bodyFat).toBe(18.2);
    expect(vitals.waterOz).toBe(34);
    expect(vitals.spo2Avg).toBe(96.4);
    expect(vitals.spo2Min).toBe(94.1);
    expect(vitals.spo2Max).toBe(98.2);
    expect(vitals.vo2Max).toBe('42');
    expect(vitals.respiratoryRate).toBe(14.3);
    expect(vitals.bmi).toBeCloseTo(24.7, 1);
  });
});
