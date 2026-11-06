/**
 * SYNTHETIC Oura documents. These are not measurements from any person.
 * Shapes follow Oura API v2 samples: daily_sleep has a score and contributor
 * points, while durations and bedtimes live on the sleep-period document.
 */
import {
  normalizeActivity,
  normalizeOuraDay,
  normalizeReadiness,
  normalizeSleep,
  toWearableReadiness,
  toWearableSleep,
} from './ouraNormalize';

const DAY = '2026-11-06';

const dailySleep = {
  data: [{
    id: 'daily-sleep-1',
    day: DAY,
    score: 82,
    timestamp: '2026-11-06T00:00:00-05:00',
    contributors: {
      deep_sleep: 70,
      efficiency: 10,
      latency: 80,
      rem_sleep: 75,
      restfulness: 60,
      timing: 55,
      total_sleep: 80,
    },
  }],
};

const sleepPeriods = {
  data: [
    {
      id: 'nap-1',
      day: DAY,
      type: 'late_nap',
      total_sleep_duration: 1800,
      bedtime_start: '2026-11-06T14:00:00-05:00',
      bedtime_end: '2026-11-06T14:40:00-05:00',
    },
    {
      id: 'deleted-1',
      day: DAY,
      type: 'deleted',
      total_sleep_duration: 99999,
    },
    {
      id: 'night-short',
      day: DAY,
      type: 'long_sleep',
      total_sleep_duration: 1000,
      bedtime_start: '2026-11-05T20:00:00-05:00',
      bedtime_end: '2026-11-05T21:00:00-05:00',
    },
    {
      id: 'night-1',
      day: DAY,
      type: 'long_sleep',
      total_sleep_duration: 25200,
      deep_sleep_duration: 4800,
      rem_sleep_duration: 5400,
      light_sleep_duration: 15000,
      awake_time: 1200,
      efficiency: 91,
      bedtime_start: '2026-11-05T23:15:00-05:00',
      bedtime_end: '2026-11-06T06:15:00-05:00',
      sleep_score_delta: 5,
      heart_rate: { interval: 300, items: [55, 54, 53], timestamp: '2026-11-05T23:15:00-05:00' },
      movement_30_sec: '112233',
      readiness: { score: 99, contributors: { hrv_balance: 1 } },
    },
    {
      id: 'other-day',
      day: '2026-11-05',
      type: 'long_sleep',
      total_sleep_duration: 30000,
      score: 10,
    },
  ],
};

const readiness = {
  data: [{
    id: 'ready-1',
    day: DAY,
    score: 74,
    temperature_deviation: -0.2,
    temperature_trend_deviation: 0.1,
    timestamp: '2026-11-06T06:20:00-05:00',
    contributors: {
      hrv_balance: 68,
      resting_heart_rate: 90,
    },
  }],
};

const activity = {
  data: [{
    id: 'act-1',
    day: DAY,
    score: 80,
    steps: 8421,
    active_calories: 340,
    total_calories: 2300,
    equivalent_walking_distance: 6100,
    high_activity_time: 600,
    medium_activity_time: 1800,
    low_activity_time: 3600,
    sedentary_time: 28800,
    non_wear_time: 0,
    timestamp: '2026-11-06T23:00:00-05:00',
    class_5_min: '1111112222',
    met: { interval: 60, items: [1.2, 1.4], timestamp: '2026-11-06T00:00:00-05:00' },
  }],
};

describe('Oura daily normalization (synthetic)', () => {
  const sleep = normalizeSleep(dailySleep, sleepPeriods, DAY);

  it('uses the daily sleep score and the longest long_sleep period for durations', () => {
    expect(sleep.score).toBe(82);
    expect(sleep.hours).toBe(7);
    expect(sleep.totalSleepSeconds).toBe(25200);
    expect(sleep.deepSeconds).toBe(4800);
    expect(sleep.remSeconds).toBe(5400);
    expect(sleep.lightSeconds).toBe(15000);
    expect(sleep.awakeSeconds).toBe(1200);
    expect(sleep.efficiency).toBe(91);
    expect(sleep.periodType).toBe('long_sleep');
    expect(sleep.periodDocumentId).toBe('night-1');
    expect(sleep.napCount).toBe(1);
    expect(sleep.missing).toBe(false);
  });

  it('keeps the clock time in the source offset instead of the server zone', () => {
    expect(sleep.startClock).toBe('23:15');
    expect(sleep.endClock).toBe('06:15');
    expect(sleep.timezoneOffset).toBe('-05:00');
    expect(sleep.bedtimeStart).toBe('2026-11-05T23:15:00-05:00');
  });

  it('does not treat contributor points, score deltas, or sample arrays as durations', () => {
    const encoded = JSON.stringify(sleep);
    expect(sleep.hours).not.toBeCloseTo(80 / 3600, 5);
    expect(sleep.score).not.toBe(5);
    expect(encoded).not.toContain('112233');
    expect(encoded).not.toContain('"items"');
    expect(encoded).not.toContain('heart_rate');
  });

  it('leaves hours null when only a daily_sleep score is present', () => {
    const scoreOnly = normalizeSleep(dailySleep, { data: [] }, DAY);
    expect(scoreOnly.score).toBe(82);
    expect(scoreOnly.hours).toBeNull();
    expect(scoreOnly.deepSeconds).toBeNull();
    expect(scoreOnly.efficiency).toBeNull();
    expect(toWearableSleep(scoreOnly).hours).toBe(0);
    expect(toWearableSleep(scoreOnly).deep_min).toBe(0);
    expect(toWearableSleep(scoreOnly).vitality).toBe(8.2);
  });

  it('returns an empty night when the day has no documents', () => {
    const empty = normalizeSleep({ data: [] }, { data: [] }, DAY);
    expect(empty.missing).toBe(true);
    expect(empty.score).toBeNull();
    expect(empty.hours).toBeNull();
    expect(toWearableSleep(empty).score).toBe(0);
  });

  it('ignores a document from another day', () => {
    const other = normalizeSleep(
      { data: [{ day: '2026-11-05', score: 10 }] },
      { data: [] },
      DAY,
    );
    expect(other.missing).toBe(true);
    expect(other.score).toBeNull();
  });

  it('maps readiness without turning the HRV contributor into milliseconds', () => {
    const row = normalizeReadiness(readiness, DAY);
    expect(row.score).toBe(74);
    expect(row.temperatureDeviation).toBe(-0.2);
    expect(row.hrvBalanceContributor).toBe(68);
    expect(row.timezoneOffset).toBe('-05:00');
    const wearable = toWearableReadiness(row);
    expect(wearable?.hrvBalanceContributor).toBe(68);
    expect(wearable?.hrvBalance).toBe(68);
    expect(toWearableReadiness(normalizeReadiness({ data: [] }, DAY))).toBeNull();
  });

  it('does not copy a sleep-period readiness snapshot when daily readiness is absent', () => {
    const day = normalizeOuraDay({
      date: DAY,
      dailySleep,
      sleepPeriods,
      dailyReadiness: { data: [] },
      dailyActivity: activity,
    });
    expect(day.readiness.missing).toBe(true);
    expect(day.readiness.score).toBeNull();
    expect(day.status).toBe('partial');
  });

  it('maps the activity summary and drops per-interval series', () => {
    const row = normalizeActivity(activity, DAY);
    expect(row.score).toBe(80);
    expect(row.steps).toBe(8421);
    expect(row.activeCalories).toBe(340);
    expect(row.highActivitySeconds).toBe(600);
    expect(row.nonWearSeconds).toBe(0);
    const encoded = JSON.stringify(row);
    expect(encoded).not.toContain('class_5_min');
    expect(encoded).not.toContain('1111112222');
    expect(encoded).not.toContain('"items"');
  });

  it('marks a full day ok and an empty day as no data', () => {
    const full = normalizeOuraDay({
      date: DAY,
      dailySleep,
      sleepPeriods,
      dailyReadiness: readiness,
      dailyActivity: activity,
    });
    expect(full.status).toBe('ok');
    expect(full.timezone).toBe('-05:00');
    expect(full.detail).toMatch(/stored/);

    const empty = normalizeOuraDay({
      date: DAY,
      dailySleep: { data: [] },
      sleepPeriods: { data: [] },
      dailyReadiness: { data: [] },
      dailyActivity: { data: [] },
    });
    expect(empty.status).toBe('no_data');
    expect(empty.detail).toMatch(/paired or synced/);
  });

  it('marks every refused endpoint as forbidden instead of an empty ring', () => {
    const refused = normalizeOuraDay({
      date: DAY,
      dailySleep: { data: [] },
      sleepPeriods: { data: [] },
      dailyReadiness: { data: [] },
      dailyActivity: { data: [] },
      forbidden: ['daily_sleep', 'sleep', 'daily_readiness', 'daily_activity'],
    });
    expect(refused.status).toBe('forbidden');
  });

  it('keeps nulls for missing numeric fields on an otherwise present activity document', () => {
    const row = normalizeActivity({
      data: [{ id: 'act-sparse', day: DAY, steps: 0, score: null, non_wear_time: 86400 }],
    }, DAY);
    expect(row.missing).toBe(false);
    expect(row.steps).toBe(0);
    expect(row.score).toBeNull();
    expect(row.activeCalories).toBeNull();
  });
});
