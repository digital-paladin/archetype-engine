/**
 * Pure wearable XP rules. Amounts and thresholds come from xpCalculator.service.
 * One source per metric: a second device for the same night or day pays nothing.
 * Resting heart rate, HRV, and owning a device never pay.
 */

import { chicagoDay } from './activityOccurredAt';
import { isTrainingActivity } from './recoveryQuests.service';
import {
  WEARABLE_XP_RULES,
  WEARABLE_XP_TYPES,
  XpCalculatorService,
} from './xpCalculator.service';

const calc = new XpCalculatorService();

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const GOOGLE_STEPS_SOURCES = new Set(['google', 'google-health']);
const PASSIVE_METRICS = new Set(['sleep', 'readiness-adherence', 'steps']);

export type WearableMetric =
  | 'sleep'
  | 'readiness-adherence'
  | 'steps'
  | 'hume-scan'
  | 'hume-trend';

export type ReadinessEffectName = 'well-rested' | 'fatigued';

export interface SleepNight {
  hours: number;
  score: number;
}

export interface SleepChoice {
  source: 'oura' | 'google-health' | 'fitbit' | null;
  night: SleepNight | null;
}

export interface XpPiece {
  activityType: string;
  xp: number;
}

export interface MetricAward {
  xp: number;
  activityType: string | null;
  pieces: XpPiece[];
  reason: string | null;
}

export interface HumeScanReading {
  source: string;
  measuredAt: string;
  proofRef?: string | null;
  /** App record id. PR #43's idempotency key counts as one. */
  appRecordId?: string | null;
  skeletalMuscleMassLb?: number | null;
  bodyFatPct?: number | null;
  weightLb?: number | null;
  fatMassLb?: number | null;
  fasted?: boolean | null;
}

export interface WorkoutInterval {
  startMs: number;
  endMs: number;
}

export function deviceOwnershipXp(): number {
  return 0;
}

export function heartMetricXp(
  _metric: 'resting-hr' | 'hrv',
  _value: number,
  _source: string,
): number {
  return 0;
}

export function googleBodyCompositionXp(
  _kind: 'weight' | 'body-fat',
  _value: number,
): number {
  return 0;
}

export function readinessScoreXp(_score: number): number {
  return 0;
}

export function isPassiveWearableMetric(metric: string): boolean {
  return PASSIVE_METRICS.has(metric);
}

export function sleepDedupeKey(wakeDate: string): string {
  return `wearable:sleep:${wakeDate}`;
}

export function stepsDedupeKey(date: string): string {
  return `wearable:steps:${date}`;
}

export function readinessAdherenceDedupeKey(date: string): string {
  return `wearable:readiness-adherence:${date}`;
}

export function readinessEffectKey(date: string): string {
  return `wearable-readiness:${date}`;
}

export function humeScanDedupeKey(isoWeek: string): string {
  return `wearable:hume-scan:${isoWeek}`;
}

export function humeTrendDedupeKey(yearMonth: string): string {
  return `wearable:hume-trend:${yearMonth}`;
}

export function sleepRecorded(sleep: SleepNight | null | undefined): boolean {
  if (!sleep) return false;
  return sleep.hours > 0 || sleep.score > 0;
}

/**
 * Oura wins when it has any night for this wake date, even if that night
 * is under the XP threshold. Google Health and Fitbit pay only when Oura
 * has no record.
 */
export function chooseSleepSource(
  oura: SleepNight | null | undefined,
  other: SleepNight | null | undefined,
  otherSource: 'google-health' | 'fitbit' | null,
): SleepChoice {
  if (sleepRecorded(oura)) return { source: 'oura', night: oura! };
  if (sleepRecorded(other) && otherSource) return { source: otherSource, night: other! };
  return { source: null, night: null };
}

export function sleepAward(hours: number, score: number): MetricAward {
  const pieces: XpPiece[] = [];
  if (hours >= WEARABLE_XP_RULES.sleepMinHours) {
    pieces.push({
      activityType: WEARABLE_XP_TYPES.sleepDuration,
      xp: calc.calculateXP(WEARABLE_XP_TYPES.sleepDuration),
    });
    if (score >= WEARABLE_XP_RULES.sleepScoreMin) {
      pieces.push({
        activityType: WEARABLE_XP_TYPES.sleepScore,
        xp: calc.calculateXP(WEARABLE_XP_TYPES.sleepScore),
      });
    }
  }
  const raw = pieces.reduce((sum, piece) => sum + piece.xp, 0);
  const xp = Math.min(raw, WEARABLE_XP_RULES.sleepMaxPerNight);
  return {
    xp,
    activityType: xp > 0 ? WEARABLE_XP_TYPES.sleepDuration : null,
    pieces,
    reason: xp > 0 ? null : 'below_threshold',
  };
}

export function stepsAward(steps: number, source: string | null | undefined): MetricAward {
  const normalized = (source ?? '').trim().toLowerCase();
  if (!GOOGLE_STEPS_SOURCES.has(normalized)) {
    return { xp: 0, activityType: null, pieces: [], reason: 'steps_source' };
  }
  if (steps >= WEARABLE_XP_RULES.steps10k) {
    const xp = Math.min(
      calc.calculateXP(WEARABLE_XP_TYPES.steps10k),
      WEARABLE_XP_RULES.stepsMaxPerDay,
    );
    return {
      xp,
      activityType: WEARABLE_XP_TYPES.steps10k,
      pieces: [{ activityType: WEARABLE_XP_TYPES.steps10k, xp }],
      reason: null,
    };
  }
  if (steps >= WEARABLE_XP_RULES.steps8k) {
    const xp = Math.min(
      calc.calculateXP(WEARABLE_XP_TYPES.steps8k),
      WEARABLE_XP_RULES.stepsMaxPerDay,
    );
    return {
      xp,
      activityType: WEARABLE_XP_TYPES.steps8k,
      pieces: [{ activityType: WEARABLE_XP_TYPES.steps8k, xp }],
      reason: null,
    };
  }
  return { xp: 0, activityType: null, pieces: [], reason: 'below_threshold' };
}

export function readinessEffect(score: number): ReadinessEffectName | null {
  if (score >= WEARABLE_XP_RULES.readinessWellRestedMin) return 'well-rested';
  if (score < WEARABLE_XP_RULES.readinessFatiguedBelow) return 'fatigued';
  return null;
}

const LIGHTER_TYPES = new Set(['workout-mobility', 'recovery-rest-day', 'rest']);

/**
 * The lighter plan is verified from what was logged: at least one mobility or
 * rest entry, and no harder training session that day.
 */
export function followedLighterPlan(activities: Array<{ activityType: string }>): boolean {
  let lighter = false;
  for (const activity of activities) {
    const type = activity.activityType;
    if (type === 'workout-mobility') {
      lighter = true;
      continue;
    }
    if (LIGHTER_TYPES.has(type)) {
      lighter = true;
      continue;
    }
    if (isTrainingActivity(type)) return false;
  }
  return lighter;
}

export function readinessAdherenceAward(
  score: number | null | undefined,
  activities: Array<{ activityType: string }>,
): MetricAward {
  if (score == null || readinessEffect(score) !== 'fatigued' || !followedLighterPlan(activities)) {
    return { xp: 0, activityType: null, pieces: [], reason: 'not_adherent' };
  }
  const xp = calc.calculateXP(WEARABLE_XP_TYPES.readinessAdherence);
  return {
    xp,
    activityType: WEARABLE_XP_TYPES.readinessAdherence,
    pieces: [{ activityType: WEARABLE_XP_TYPES.readinessAdherence, xp }],
    reason: null,
  };
}

export interface PassiveProposal {
  metric: WearableMetric;
  xp: number;
}

/**
 * Shrink passive awards until they fit the remaining daily room.
 * Earlier proposals keep their XP. Workouts and scans are not passed in.
 */
export function clampPassiveAwards(
  proposals: PassiveProposal[],
  alreadyAwarded: number,
  cap = WEARABLE_XP_RULES.passiveDailyCap,
): PassiveProposal[] {
  let room = Math.max(0, cap - alreadyAwarded);
  return proposals.map(proposal => {
    if (!isPassiveWearableMetric(proposal.metric) || proposal.xp <= 0 || room <= 0) {
      return proposal.xp > 0 && isPassiveWearableMetric(proposal.metric) && room <= 0
        ? { ...proposal, xp: 0 }
        : proposal;
    }
    const xp = Math.min(proposal.xp, room);
    room -= xp;
    return { ...proposal, xp };
  });
}

export function shiftCivilDate(day: string, delta: number): string {
  const match = DATE_ONLY.exec(day);
  if (!match) throw new Error(`date must be YYYY-MM-DD, got ${day}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export function isWithinWearableBackfill(date: string, now: Date): boolean {
  if (!DATE_ONLY.test(date)) return false;
  const today = chicagoDay(now);
  if (date > today) return false;
  const earliest = shiftCivilDate(today, -WEARABLE_XP_RULES.backfillDays);
  return date >= earliest;
}

export function hasAwardProof(input: {
  proofRef?: string | null;
  appRecordId?: string | null;
}): boolean {
  const proof = input.proofRef?.trim() ?? '';
  const appRecord = input.appRecordId?.trim() ?? '';
  return proof.length > 0 || appRecord.length > 0;
}

export function isHumeScanSource(source: string): boolean {
  const normalized = source.trim().toLowerCase().replace(/[\s_]+/g, '-');
  return normalized === 'hume' || normalized.startsWith('hume-');
}

/** ISO week of a civil date, `YYYY-Www`. Week 1 is the week of the first Thursday. */
export function isoWeekKey(dateStr: string): string {
  const match = DATE_ONLY.exec(dateStr);
  if (!match) throw new Error(`date must be YYYY-MM-DD, got ${dateStr}`);
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const isoYear = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

export function calendarMonthKey(dateStr: string): string {
  const match = DATE_ONLY.exec(dateStr);
  if (!match) throw new Error(`date must be YYYY-MM-DD, got ${dateStr}`);
  return `${match[1]}-${match[2]}`;
}

export function scanCivilDate(measuredAt: string): string | null {
  const ms = Date.parse(measuredAt);
  if (!Number.isFinite(ms)) return null;
  return chicagoDay(new Date(ms));
}

export function humeScanAward(reading: HumeScanReading): MetricAward {
  if (!isHumeScanSource(reading.source)) {
    return { xp: 0, activityType: null, pieces: [], reason: 'hume_source' };
  }
  if (!hasAwardProof(reading)) {
    return { xp: 0, activityType: null, pieces: [], reason: 'no_proof' };
  }
  const xp = calc.calculateXP(WEARABLE_XP_TYPES.humeScan);
  return {
    xp,
    activityType: WEARABLE_XP_TYPES.humeScan,
    pieces: [{ activityType: WEARABLE_XP_TYPES.humeScan, xp }],
    reason: null,
  };
}

interface ComparableScan {
  civilDate: string;
  week: string;
  measuredAt: string;
  lean: number | null;
  fat: number | null;
  fasted: boolean | null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function fatMassLb(reading: HumeScanReading): number | null {
  const explicit = finiteOrNull(reading.fatMassLb);
  if (explicit != null && explicit > 0) return explicit;
  const weight = finiteOrNull(reading.weightLb);
  const fatPct = finiteOrNull(reading.bodyFatPct);
  if (weight != null && weight > 0 && fatPct != null && fatPct >= 0) {
    return (weight * fatPct) / 100;
  }
  return null;
}

function toComparable(reading: HumeScanReading): ComparableScan | null {
  if (!isHumeScanSource(reading.source) || !hasAwardProof(reading)) return null;
  const civilDate = scanCivilDate(reading.measuredAt);
  if (!civilDate) return null;
  const lean = finiteOrNull(reading.skeletalMuscleMassLb);
  return {
    civilDate,
    week: isoWeekKey(civilDate),
    measuredAt: reading.measuredAt,
    lean: lean != null && lean > 0 ? lean : null,
    fat: fatMassLb(reading),
    fasted: reading.fasted ?? null,
  };
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const left = Date.UTC(ay, am - 1, ad);
  const right = Date.UTC(by, bm - 1, bd);
  return Math.round((right - left) / 86_400_000);
}

/**
 * Four consecutive ISO weeks of comparable Hume scans, newest within the
 * back-fill window. Lean mass up or fat mass down from the first week to the
 * fourth. Fasted state has to match the newest scan.
 */
export function humeTrendQualifies(
  readings: HumeScanReading[],
  now: Date,
): { qualifies: boolean; newestDate: string | null; month: string | null } {
  const comparable = readings
    .map(toComparable)
    .filter((row): row is ComparableScan => row !== null)
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt) || a.civilDate.localeCompare(b.civilDate));
  if (comparable.length === 0) return { qualifies: false, newestDate: null, month: null };

  const newest = comparable[comparable.length - 1];
  if (!isWithinWearableBackfill(newest.civilDate, now)) {
    return { qualifies: false, newestDate: newest.civilDate, month: calendarMonthKey(newest.civilDate) };
  }

  const byWeek = new Map<string, ComparableScan>();
  for (const scan of comparable) {
    if (scan.fasted !== newest.fasted) continue;
    const current = byWeek.get(scan.week);
    if (!current || scan.measuredAt > current.measuredAt) byWeek.set(scan.week, scan);
  }

  const weeks = [...byWeek.values()].sort((a, b) => a.civilDate.localeCompare(b.civilDate));
  const needed = WEARABLE_XP_RULES.humeTrendWeeks;
  if (weeks.length < needed) return { qualifies: false, newestDate: newest.civilDate, month: null };

  const last = weeks.slice(-needed);
  const thursdays = last.map(scan => isoThursday(scan.civilDate));
  for (let i = 1; i < thursdays.length; i++) {
    if (daysBetween(thursdays[i - 1], thursdays[i]) !== 7) {
      return { qualifies: false, newestDate: newest.civilDate, month: null };
    }
  }

  const first = last[0];
  const end = last[last.length - 1];
  const leanUp = first.lean != null && end.lean != null && end.lean > first.lean;
  const fatDown = first.fat != null && end.fat != null && end.fat < first.fat;
  return {
    qualifies: leanUp || fatDown,
    newestDate: end.civilDate,
    month: calendarMonthKey(end.civilDate),
  };
}

function isoThursday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  return utc.toISOString().slice(0, 10);
}

export function humeTrendAward(readings: HumeScanReading[], now: Date): MetricAward & {
  newestDate: string | null;
  month: string | null;
} {
  const trend = humeTrendQualifies(readings, now);
  if (!trend.qualifies) {
    return { xp: 0, activityType: null, pieces: [], reason: 'no_trend', newestDate: trend.newestDate, month: trend.month };
  }
  const xp = calc.calculateXP(WEARABLE_XP_TYPES.humeTrend);
  return {
    xp,
    activityType: WEARABLE_XP_TYPES.humeTrend,
    pieces: [{ activityType: WEARABLE_XP_TYPES.humeTrend, xp }],
    reason: null,
    newestDate: trend.newestDate,
    month: trend.month,
  };
}

export function overlapFractionOfCandidate(
  candidate: WorkoutInterval,
  awarded: WorkoutInterval,
): number {
  const duration = candidate.endMs - candidate.startMs;
  if (duration <= 0) return 0;
  const overlap = Math.min(candidate.endMs, awarded.endMs) - Math.max(candidate.startMs, awarded.startMs);
  if (overlap <= 0) return 0;
  return overlap / duration;
}

/** True when the candidate overlaps an awarded session by at least half of the candidate's own time. */
export function isSameWorkoutSession(candidate: WorkoutInterval, awarded: WorkoutInterval): boolean {
  return overlapFractionOfCandidate(candidate, awarded) >= WEARABLE_XP_RULES.workoutSameSessionOverlap;
}

export function isPrimaryWorkoutSource(provider: string): boolean {
  const normalized = provider.trim().toLowerCase();
  return normalized === 'google' || normalized === 'google-health' || normalized === 'fitbit';
}
