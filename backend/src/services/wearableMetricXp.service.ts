/**
 * Awards wearable XP once per dedupe key.
 *
 * The daily Fitbit/Google sync route calls awardDailyWearableMetrics after
 * workout XP. Oura sleep and readiness are read here when fetchDevices is
 * set. Hume scans are read only if PR #43's store is available or a source
 * was registered. This module does not run migrations.
 */

import { getDataService } from './data/dataService';
import { FitbitService } from './fitbit.service';
import { allowsLegacyFitbitReads } from './fitbitDataSource';
import { GoogleHealthService } from './googleHealth.service';
import { loadHumeScanSource } from './humeScanSource';
import { OuraService } from './oura.service';
import { applyEffectDraft } from './statusEffects.service';
import { EffectDraft } from './consumptionEffects';
import { toCanonicalClassName } from './xpAward.service';
import { persistClassXpAwards } from './xpAward.service';
import { WEARABLE_XP_RULES, XpCalculatorService } from './xpCalculator.service';
import {
  HumeScanReading,
  MetricAward,
  ReadinessEffectName,
  SleepNight,
  WearableMetric,
  chooseSleepSource,
  clampPassiveAwards,
  humeScanAward,
  humeScanDedupeKey,
  humeTrendAward,
  humeTrendDedupeKey,
  isWithinWearableBackfill,
  isoWeekKey,
  readinessAdherenceAward,
  readinessAdherenceDedupeKey,
  readinessEffect,
  readinessEffectKey,
  scanCivilDate,
  sleepAward,
  sleepDedupeKey,
  sleepRecorded,
  stepsAward,
  stepsDedupeKey,
} from './wearableMetricXp';
import {
  WearableXpAwardRow,
  getWearableXpAwardStore,
  isUniqueViolation,
} from './wearableXpAward.store';

export interface WearableMetricAwardLine {
  metric: string;
  xp: number;
  source: string;
  dedupeKey: string;
  replay: boolean;
  activityType: string | null;
}

export interface WearableMetricSkip {
  metric: string;
  reason: string;
}

export interface DailyWearableXpResult {
  date: string;
  awards: WearableMetricAwardLine[];
  skipped: WearableMetricSkip[];
  passiveXp: number;
  totalXp: number;
  readinessEffect: ReadinessEffectName | null;
}

export interface DailyWearableAwardInput {
  userId: string;
  date: string;
  now?: Date;
  /** Step count. Ignored unless stepsSource is Google Health. */
  steps?: number | null;
  stepsSource?: string | null;
  ouraSleep?: SleepNight | null;
  otherSleep?: SleepNight | null;
  otherSleepSource?: 'google-health' | 'fitbit' | null;
  readinessScore?: number | null;
  activities?: Array<{ activityType: string }>;
  scans?: HumeScanReading[];
  /**
   * When true, missing sleep, readiness, activity, and scan fields are loaded.
   * Tests pass the fields and leave this false.
   */
  fetchDevices?: boolean;
}

const calc = new XpCalculatorService();

function emptyResult(date: string): DailyWearableXpResult {
  return {
    date,
    awards: [],
    skipped: [],
    passiveXp: 0,
    totalXp: 0,
    readinessEffect: null,
  };
}

export async function loadOuraSleep(userId: string, date: string): Promise<SleepNight | null> {
  try {
    const oura = new OuraService();
    if (!oura.isConfigured() || !(await oura.hasTokens(userId))) return null;
    const sleep = await oura.getSleepData(date, userId);
    return sleepRecorded(sleep) ? { hours: sleep.hours, score: sleep.score } : null;
  } catch (err) {
    console.warn(`[WEARABLE XP] Oura sleep skipped: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export async function loadOuraReadiness(userId: string, date: string): Promise<number | null> {
  try {
    const oura = new OuraService();
    if (!oura.isConfigured() || !(await oura.hasTokens(userId)) || !oura.getReadiness) return null;
    const readiness = await oura.getReadiness(date, userId);
    return readiness == null ? null : readiness.score;
  } catch (err) {
    console.warn(`[WEARABLE XP] Oura readiness skipped: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export async function loadGoogleSleep(userId: string, date: string): Promise<SleepNight | null> {
  try {
    const google = new GoogleHealthService();
    if (!google.isConfigured() || !(await google.hasTokens(userId))) return null;
    const sleep = await google.getSleepData(date, userId);
    return sleepRecorded(sleep) ? { hours: sleep.hours, score: sleep.score } : null;
  } catch (err) {
    console.warn(`[WEARABLE XP] Google Health sleep skipped: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export async function loadFitbitSleep(userId: string, date: string, now: Date): Promise<SleepNight | null> {
  try {
    if (!allowsLegacyFitbitReads(now)) return null;
    const fitbit = new FitbitService();
    if (!fitbit.isConfigured()) return null;
    const sleep = await fitbit.getSleepData(date, userId);
    return sleepRecorded(sleep) ? { hours: sleep.hours, score: sleep.score } : null;
  } catch (err) {
    console.warn(`[WEARABLE XP] Fitbit sleep skipped: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export async function loadLoggedActivities(
  userId: string,
  date: string,
): Promise<Array<{ activityType: string }>> {
  const rows = await getDataService().getActivityLog(userId, 1000, date);
  return rows.map(row => ({ activityType: row.activity_type }));
}

export async function loadHumeScans(userId: string): Promise<HumeScanReading[]> {
  const source = await loadHumeScanSource();
  if (!source) return [];
  return source.listReadings(userId);
}

function readinessDraft(date: string, effect: ReadinessEffectName | null): EffectDraft {
  const key = readinessEffectKey(date);
  if (effect === 'fatigued') {
    return {
      effectKey: key,
      name: 'Fatigued',
      type: 'debuff',
      category: 'training',
      source: 'Oura readiness',
      icon: '😮‍💨',
      effects: [{ stat: 'Session', modifier: 'Mobility or a lighter session', direction: 'negative' }],
      duration: 1440,
      dose: '',
      notes: 'Mobility or a lighter session.',
      autoApplied: true,
      meta: { date },
    };
  }
  if (effect === 'well-rested') {
    return {
      effectKey: key,
      name: 'Well-Rested',
      type: 'buff',
      category: 'training',
      source: 'Oura readiness',
      icon: '✨',
      effects: [{ stat: 'Recovery', modifier: 'Well rested', direction: 'positive' }],
      duration: 1440,
      dose: '',
      notes: 'Readiness is in the well-rested band. The score itself pays no XP.',
      autoApplied: true,
      meta: { date },
    };
  }
  return {
    effectKey: key,
    name: 'Readiness',
    type: 'buff',
    category: 'training',
    source: 'Oura readiness',
    icon: '✨',
    effects: [],
    duration: 1,
    dose: '',
    notes: '',
    autoApplied: true,
    meta: { date },
    remove: true,
  };
}

async function applyReadiness(
  userId: string,
  date: string,
  score: number | null,
  now: Date,
): Promise<ReadinessEffectName | null> {
  if (score == null || !Number.isFinite(score)) return null;
  const effect = readinessEffect(score);
  await applyEffectDraft(userId, readinessDraft(date, effect), now);
  return effect;
}

interface GrantArgs {
  userId: string;
  date: string;
  metric: WearableMetric;
  dedupeKey: string;
  source: string;
  award: MetricAward;
  /** Remaining passive room. Ignored for scans and the trend bonus. */
  passiveRoom: { value: number } | null;
}

async function grant(
  result: DailyWearableXpResult,
  args: GrantArgs,
): Promise<void> {
  if (args.award.xp <= 0 || !args.award.activityType) {
    result.skipped.push({ metric: args.metric, reason: args.award.reason ?? 'no_award' });
    return;
  }

  let xp = args.award.xp;
  if (args.passiveRoom) {
    xp = Math.min(xp, args.passiveRoom.value);
    if (xp <= 0) {
      result.skipped.push({ metric: args.metric, reason: 'passive_cap' });
      return;
    }
  }

  const awards = getWearableXpAwardStore();
  const existing = await awards.findByKey(args.userId, args.dedupeKey);
  if (existing) {
    result.awards.push({
      metric: args.metric,
      xp: 0,
      source: existing.source,
      dedupeKey: args.dedupeKey,
      replay: true,
      activityType: existing.activityType,
    });
    result.skipped.push({ metric: args.metric, reason: 'duplicate' });
    return;
  }

  const className = toCanonicalClassName(calc.getCategoryFromActivity(args.award.activityType));
  const row: WearableXpAwardRow = {
    userId: args.userId,
    dedupeKey: args.dedupeKey,
    metric: args.metric,
    awardDate: args.date,
    source: args.source,
    activityType: args.award.activityType,
    className,
    xpAwarded: xp,
  };

  try {
    await awards.insert(row);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    result.awards.push({
      metric: args.metric,
      xp: 0,
      source: args.source,
      dedupeKey: args.dedupeKey,
      replay: true,
      activityType: args.award.activityType,
    });
    result.skipped.push({ metric: args.metric, reason: 'duplicate' });
    return;
  }

  const db = getDataService();
  await db.logActivity(args.userId, {
    activity_type: args.award.activityType,
    class_name: className,
    duration_hours: 0,
    xp_awarded: xp,
    notes: `[${args.dedupeKey}] ${args.award.activityType} via ${args.source}`,
    logged_at: `${args.date}T12:00:00.000Z`,
  });
  await persistClassXpAwards(args.userId, [{ className, xp }]);

  if (args.passiveRoom) args.passiveRoom.value -= xp;
  result.passiveXp = args.passiveRoom ? result.passiveXp + xp : result.passiveXp;
  result.totalXp += xp;
  result.awards.push({
    metric: args.metric,
    xp,
    source: args.source,
    dedupeKey: args.dedupeKey,
    replay: false,
    activityType: args.award.activityType,
  });
}

async function awardScans(
  result: DailyWearableXpResult,
  userId: string,
  scans: HumeScanReading[],
  now: Date,
): Promise<void> {
  const ordered = [...scans].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const seenWeeks = new Set<string>();
  for (const reading of ordered) {
    const preview = humeScanAward(reading);
    const civil = scanCivilDate(reading.measuredAt);
    if (preview.xp <= 0 || !preview.activityType) {
      if (preview.reason) result.skipped.push({ metric: 'hume-scan', reason: preview.reason });
      continue;
    }
    if (!civil || !isWithinWearableBackfill(civil, now)) {
      result.skipped.push({ metric: 'hume-scan', reason: 'outside_window' });
      continue;
    }
    const week = isoWeekKey(civil);
    if (seenWeeks.has(week)) {
      result.skipped.push({ metric: 'hume-scan', reason: 'weekly_limit' });
      continue;
    }
    const before = result.awards.length;
    await grant(result, {
      userId,
      date: civil,
      metric: 'hume-scan',
      dedupeKey: humeScanDedupeKey(week),
      source: reading.source,
      award: preview,
      passiveRoom: null,
    });
    const line = result.awards[result.awards.length - 1];
    if (result.awards.length > before && (line.xp > 0 || line.replay)) seenWeeks.add(week);
  }

  const trend = humeTrendAward(scans, now);
  if (trend.xp > 0 && trend.month && trend.newestDate) {
    await grant(result, {
      userId,
      date: trend.newestDate,
      metric: 'hume-trend',
      dedupeKey: humeTrendDedupeKey(trend.month),
      source: 'hume',
      award: trend,
      passiveRoom: null,
    });
    return;
  }
  if (scans.length > 0) {
    result.skipped.push({ metric: 'hume-trend', reason: trend.reason ?? 'no_trend' });
  }
}

export async function awardDailyWearableMetrics(
  input: DailyWearableAwardInput,
): Promise<DailyWearableXpResult> {
  const now = input.now ?? new Date();
  const result = emptyResult(input.date);
  if (!isWithinWearableBackfill(input.date, now)) {
    result.skipped.push({ metric: 'day', reason: 'outside_window' });
    return result;
  }

  const fetchDevices = input.fetchDevices === true;
  const ouraSleep = input.ouraSleep !== undefined
    ? input.ouraSleep
    : fetchDevices ? await loadOuraSleep(input.userId, input.date) : null;

  let otherSleep = input.otherSleep !== undefined ? input.otherSleep : null;
  let otherSource = input.otherSleepSource ?? null;
  if (input.otherSleep === undefined && fetchDevices && !sleepRecorded(ouraSleep)) {
    const google = await loadGoogleSleep(input.userId, input.date);
    if (sleepRecorded(google)) {
      otherSleep = google;
      otherSource = 'google-health';
    } else {
      const fitbit = await loadFitbitSleep(input.userId, input.date, now);
      otherSleep = fitbit;
      otherSource = fitbit ? 'fitbit' : null;
    }
  }

  const choice = chooseSleepSource(ouraSleep, otherSleep, otherSource);
  const sleep = choice.night ? sleepAward(choice.night.hours, choice.night.score) : sleepAward(0, 0);

  const readinessScore = input.readinessScore !== undefined
    ? input.readinessScore
    : fetchDevices ? await loadOuraReadiness(input.userId, input.date) : null;
  result.readinessEffect = await applyReadiness(input.userId, input.date, readinessScore, now);

  const activities = input.activities !== undefined
    ? input.activities
    : fetchDevices ? await loadLoggedActivities(input.userId, input.date) : [];
  const adherence = readinessAdherenceAward(readinessScore, activities);

  const steps = stepsAward(input.steps ?? 0, input.stepsSource);

  const alreadyPassive = await getWearableXpAwardStore().passiveXpOnDate(input.userId, input.date);
  const [sleepClamped, adherenceClamped, stepsClamped] = clampPassiveAwards(
    [
      { metric: 'sleep', xp: sleep.xp },
      { metric: 'readiness-adherence', xp: adherence.xp },
      { metric: 'steps', xp: steps.xp },
    ],
    alreadyPassive,
  );
  const room = { value: Math.max(0, WEARABLE_XP_RULES.passiveDailyCap - alreadyPassive) };

  const capped = (original: MetricAward, xp: number): MetricAward => {
    if (original.xp > 0 && xp <= 0) {
      return { ...original, xp: 0, activityType: null, reason: 'passive_cap' };
    }
    return { ...original, xp };
  };

  await grant(result, {
    userId: input.userId,
    date: input.date,
    metric: 'sleep',
    dedupeKey: sleepDedupeKey(input.date),
    source: choice.source ?? 'none',
    award: capped(sleep, sleepClamped.xp),
    passiveRoom: room,
  });
  await grant(result, {
    userId: input.userId,
    date: input.date,
    metric: 'readiness-adherence',
    dedupeKey: readinessAdherenceDedupeKey(input.date),
    source: 'oura',
    award: capped(adherence, adherenceClamped.xp),
    passiveRoom: room,
  });
  await grant(result, {
    userId: input.userId,
    date: input.date,
    metric: 'steps',
    dedupeKey: stepsDedupeKey(input.date),
    source: (input.stepsSource ?? 'none').trim().toLowerCase() || 'none',
    award: capped(steps, stepsClamped.xp),
    passiveRoom: room,
  });

  const scans = input.scans !== undefined
    ? input.scans
    : fetchDevices ? await loadHumeScans(input.userId) : [];
  await awardScans(result, input.userId, scans, now);

  result.passiveXp = result.awards
    .filter(line => line.metric === 'sleep' || line.metric === 'readiness-adherence' || line.metric === 'steps')
    .reduce((sum, line) => sum + line.xp, 0);
  return result;
}
