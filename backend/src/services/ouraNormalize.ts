import { WearableReadinessData, WearableSleepData } from './wearable.types';

/**
 * Maps Oura API v2 documents into daily summaries.
 * Field names follow https://cloud.ouraring.com/v2/docs (fetched for this change).
 *
 * daily_sleep carries the sleep score and contributor scores (0–100). It does
 * not carry durations or bedtimes. Those live on /v2/usercollection/sleep.
 * daily_readiness.contributors.hrv_balance is a contributor score, not HRV in ms.
 * Sleep-period readiness and sleep_score_delta are not the daily summaries.
 */

export interface OuraSleepSummary {
  source: 'oura';
  day: string;
  timezoneOffset: string | null;
  score: number | null;
  scoreTimestamp: string | null;
  documentId: string | null;
  periodDocumentId: string | null;
  periodType: string | null;
  hours: number | null;
  totalSleepSeconds: number | null;
  deepSeconds: number | null;
  remSeconds: number | null;
  lightSeconds: number | null;
  awakeSeconds: number | null;
  efficiency: number | null;
  bedtimeStart: string | null;
  bedtimeEnd: string | null;
  startClock: string | null;
  endClock: string | null;
  napCount: number;
  missing: boolean;
}

export interface OuraReadinessSummary {
  source: 'oura';
  day: string;
  timezoneOffset: string | null;
  score: number | null;
  timestamp: string | null;
  documentId: string | null;
  temperatureDeviation: number | null;
  temperatureTrendDeviation: number | null;
  /** Oura contributor, 0–100. Not heart-rate variability in milliseconds. */
  hrvBalanceContributor: number | null;
  missing: boolean;
}

export interface OuraActivitySummary {
  source: 'oura';
  day: string;
  timezoneOffset: string | null;
  score: number | null;
  timestamp: string | null;
  documentId: string | null;
  steps: number | null;
  activeCalories: number | null;
  totalCalories: number | null;
  equivalentWalkingDistanceM: number | null;
  highActivitySeconds: number | null;
  mediumActivitySeconds: number | null;
  lowActivitySeconds: number | null;
  sedentarySeconds: number | null;
  nonWearSeconds: number | null;
  missing: boolean;
}

export type OuraDayStatus = 'ok' | 'partial' | 'no_data' | 'forbidden';

export interface OuraDayNormalized {
  date: string;
  timezone: string | null;
  sleep: OuraSleepSummary;
  readiness: OuraReadinessSummary;
  activity: OuraActivitySummary;
  status: OuraDayStatus;
  detail: string;
  forbiddenEndpoints: string[];
}

const MAIN_SLEEP = new Set(['long_sleep', 'sleep']);
const IGNORED_SLEEP = new Set(['deleted', 'rest']);

export function clockInSourceZone(iso: string | null): string | null {
  if (!iso) return null;
  const match = iso.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

export function offsetOf(iso: string | null): string | null {
  if (!iso) return null;
  const match = iso.match(/([+-]\d{2}:\d{2}|Z)$/);
  if (!match) return null;
  return match[1] === 'Z' ? '+00:00' : match[1];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function rowsForDay(payload: unknown, day: string): Record<string, unknown>[] {
  const root = asRecord(payload);
  const data = root && Array.isArray(root.data) ? root.data : Array.isArray(payload) ? payload : [];
  return data
    .map(asRecord)
    .filter((row): row is Record<string, unknown> => !!row && row.day === day);
}

function hoursFromSeconds(seconds: number | null): number | null {
  if (seconds == null) return null;
  return Math.round((seconds / 3600) * 10) / 10;
}

function emptySleep(day: string): OuraSleepSummary {
  return {
    source: 'oura',
    day,
    timezoneOffset: null,
    score: null,
    scoreTimestamp: null,
    documentId: null,
    periodDocumentId: null,
    periodType: null,
    hours: null,
    totalSleepSeconds: null,
    deepSeconds: null,
    remSeconds: null,
    lightSeconds: null,
    awakeSeconds: null,
    efficiency: null,
    bedtimeStart: null,
    bedtimeEnd: null,
    startClock: null,
    endClock: null,
    napCount: 0,
    missing: true,
  };
}

function emptyReadiness(day: string): OuraReadinessSummary {
  return {
    source: 'oura',
    day,
    timezoneOffset: null,
    score: null,
    timestamp: null,
    documentId: null,
    temperatureDeviation: null,
    temperatureTrendDeviation: null,
    hrvBalanceContributor: null,
    missing: true,
  };
}

function emptyActivity(day: string): OuraActivitySummary {
  return {
    source: 'oura',
    day,
    timezoneOffset: null,
    score: null,
    timestamp: null,
    documentId: null,
    steps: null,
    activeCalories: null,
    totalCalories: null,
    equivalentWalkingDistanceM: null,
    highActivitySeconds: null,
    mediumActivitySeconds: null,
    lowActivitySeconds: null,
    sedentarySeconds: null,
    nonWearSeconds: null,
    missing: true,
  };
}

function pickMainPeriod(rows: Record<string, unknown>[]): {
  main: Record<string, unknown> | null;
  napCount: number;
} {
  const mains: Record<string, unknown>[] = [];
  let napCount = 0;
  for (const row of rows) {
    const type = str(row.type) ?? '';
    if (IGNORED_SLEEP.has(type)) continue;
    if (MAIN_SLEEP.has(type)) mains.push(row);
    else napCount += 1;
  }
  const longSleep = mains.filter((row) => row.type === 'long_sleep');
  const pool = longSleep.length > 0 ? longSleep : mains;
  pool.sort((a, b) => {
    const duration = (num(b.total_sleep_duration) ?? -1) - (num(a.total_sleep_duration) ?? -1);
    if (duration !== 0) return duration;
    return (str(b.bedtime_end) ?? '').localeCompare(str(a.bedtime_end) ?? '');
  });
  return { main: pool[0] ?? null, napCount };
}

function preferredRow(rows: Record<string, unknown>[]): Record<string, unknown> | null {
  return rows.find((row) => num(row.score) != null) ?? rows[0] ?? null;
}

export function normalizeSleep(
  dailySleepPayload: unknown,
  sleepPeriodPayload: unknown,
  day: string,
): OuraSleepSummary {
  const daily = preferredRow(rowsForDay(dailySleepPayload, day));
  const { main, napCount } = pickMainPeriod(rowsForDay(sleepPeriodPayload, day));
  if (!daily && !main) {
    const empty = emptySleep(day);
    empty.napCount = napCount;
    empty.missing = napCount === 0;
    return empty;
  }
  const bedtimeStart = main ? str(main.bedtime_start) : null;
  const bedtimeEnd = main ? str(main.bedtime_end) : null;
  const scoreTimestamp = daily ? str(daily.timestamp) : null;
  const totalSleepSeconds = main ? num(main.total_sleep_duration) : null;
  return {
    source: 'oura',
    day,
    timezoneOffset: offsetOf(bedtimeStart) ?? offsetOf(bedtimeEnd) ?? offsetOf(scoreTimestamp),
    score: daily ? num(daily.score) : null,
    scoreTimestamp,
    documentId: daily ? str(daily.id) : null,
    periodDocumentId: main ? str(main.id) : null,
    periodType: main ? str(main.type) : null,
    hours: hoursFromSeconds(totalSleepSeconds),
    totalSleepSeconds,
    deepSeconds: main ? num(main.deep_sleep_duration) : null,
    remSeconds: main ? num(main.rem_sleep_duration) : null,
    lightSeconds: main ? num(main.light_sleep_duration) : null,
    awakeSeconds: main ? num(main.awake_time) : null,
    efficiency: main ? num(main.efficiency) : null,
    bedtimeStart,
    bedtimeEnd,
    startClock: clockInSourceZone(bedtimeStart),
    endClock: clockInSourceZone(bedtimeEnd),
    napCount,
    missing: false,
  };
}

export function normalizeReadiness(payload: unknown, day: string): OuraReadinessSummary {
  const row = preferredRow(rowsForDay(payload, day));
  if (!row) return emptyReadiness(day);
  const contributors = asRecord(row.contributors);
  const timestamp = str(row.timestamp);
  return {
    source: 'oura',
    day,
    timezoneOffset: offsetOf(timestamp),
    score: num(row.score),
    timestamp,
    documentId: str(row.id),
    temperatureDeviation: num(row.temperature_deviation),
    temperatureTrendDeviation: num(row.temperature_trend_deviation),
    hrvBalanceContributor: contributors ? num(contributors.hrv_balance) : null,
    missing: false,
  };
}

export function normalizeActivity(payload: unknown, day: string): OuraActivitySummary {
  const row = preferredRow(rowsForDay(payload, day));
  if (!row) return emptyActivity(day);
  const timestamp = str(row.timestamp);
  return {
    source: 'oura',
    day,
    timezoneOffset: offsetOf(timestamp),
    score: num(row.score),
    timestamp,
    documentId: str(row.id),
    steps: num(row.steps),
    activeCalories: num(row.active_calories),
    totalCalories: num(row.total_calories),
    equivalentWalkingDistanceM: num(row.equivalent_walking_distance),
    highActivitySeconds: num(row.high_activity_time),
    mediumActivitySeconds: num(row.medium_activity_time),
    lowActivitySeconds: num(row.low_activity_time),
    sedentarySeconds: num(row.sedentary_time),
    nonWearSeconds: num(row.non_wear_time),
    missing: false,
  };
}

function activityHasMetrics(activity: OuraActivitySummary): boolean {
  return [
    activity.score,
    activity.steps,
    activity.activeCalories,
    activity.totalCalories,
  ].some((value) => value != null);
}

export function normalizeOuraDay(input: {
  date: string;
  dailySleep: unknown;
  sleepPeriods: unknown;
  dailyReadiness: unknown;
  dailyActivity: unknown;
  forbidden?: string[];
}): OuraDayNormalized {
  const forbidden = input.forbidden ?? [];
  const sleep = normalizeSleep(input.dailySleep, input.sleepPeriods, input.date);
  const readiness = normalizeReadiness(input.dailyReadiness, input.date);
  const activity = normalizeActivity(input.dailyActivity, input.date);
  const timezone = sleep.timezoneOffset ?? readiness.timezoneOffset ?? activity.timezoneOffset;
  if (timezone) {
    if (!sleep.timezoneOffset) sleep.timezoneOffset = timezone;
    if (!readiness.timezoneOffset) readiness.timezoneOffset = timezone;
    if (!activity.timezoneOffset) activity.timezoneOffset = timezone;
  }

  const present = !sleep.missing || !readiness.missing || !activity.missing;
  const allForbidden = forbidden.length > 0 && !present
    && ['daily_sleep', 'sleep', 'daily_readiness', 'daily_activity'].every((name) => forbidden.includes(name));
  const hoursMissing = sleep.hours == null;
  const sleepScoreMissing = !sleep.missing && sleep.score == null;
  const readinessScoreMissing = !readiness.missing && readiness.score == null;
  const activityEmpty = !activity.missing && !activityHasMetrics(activity);
  const sectionMissing = sleep.missing || readiness.missing || activity.missing;

  let status: OuraDayStatus;
  let detail: string;
  if (!present && forbidden.length === 0) {
    status = 'no_data';
    detail = 'No Oura summaries for this day. The account can be connected before a ring is paired or synced.';
  } else if (allForbidden) {
    status = 'forbidden';
    detail = 'Oura refused these reads. The membership may be inactive, or the daily scope was not granted.';
  } else if (
    sectionMissing
    || hoursMissing
    || sleepScoreMissing
    || readinessScoreMissing
    || activityEmpty
    || forbidden.length > 0
  ) {
    status = 'partial';
    detail = 'Some Oura daily summaries are missing for this day.';
  } else {
    status = 'ok';
    detail = 'Sleep, readiness, and activity summaries stored.';
  }

  return {
    date: input.date,
    timezone,
    sleep,
    readiness,
    activity,
    status,
    detail,
    forbiddenEndpoints: forbidden,
  };
}

/** Existing sleep card contract. Zero means "not measured", matching the other wearables. */
export function toWearableSleep(summary: OuraSleepSummary): WearableSleepData {
  const score = summary.score ?? 0;
  const minutes = (seconds: number | null) => (seconds == null ? 0 : Math.round(seconds / 60));
  return {
    score,
    hours: summary.hours ?? 0,
    vitality: Math.round((score / 10) * 10) / 10,
    efficiency: summary.efficiency ?? 0,
    deep_min: minutes(summary.deepSeconds),
    rem_min: minutes(summary.remSeconds),
    light_min: minutes(summary.lightSeconds),
    awake_min: minutes(summary.awakeSeconds),
    startTime: summary.startClock ?? undefined,
    endTime: summary.endClock ?? undefined,
  };
}

export function toWearableReadiness(summary: OuraReadinessSummary): WearableReadinessData | null {
  if (summary.missing || summary.score == null) return null;
  return {
    score: summary.score,
    temperatureDeviation: summary.temperatureDeviation ?? undefined,
    hrvBalance: summary.hrvBalanceContributor ?? undefined,
    hrvBalanceContributor: summary.hrvBalanceContributor ?? undefined,
    date: summary.day,
  };
}
