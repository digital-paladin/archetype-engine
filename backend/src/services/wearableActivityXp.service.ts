/**
 * Wearable-detected workouts → Warrior XP.
 *
 * Owner rule (Oct 22 2026): a physical activity logged by a wearable counts as
 * verified and earns XP the same way a manually logged workout does.
 *
 * Rate: the engine's own Warrior entries in XpCalculatorService
 * (workout-strength / workout-cardio / workout-mobility / workout-mma), i.e.
 * baseXP + floor(minutes × durationMultiplier). No new XP constants.
 *
 * Each session is written once to activity_log (so consolidation and daily
 * metrics see it on the day it happened) and credited to character_stats via
 * persistClassXpAwards, the same path POST /api/activities uses. A dedupe tag
 * in activity_log.notes makes repeat syncs of the same day award nothing new.
 * No schema change: the tag lives in the existing notes column, the same way
 * recovery quests tag their claim date.
 *
 * Dedupe is per synced civil day and per process. Two server processes can
 * still race; there is no unique index (no migration). Provider-id matches
 * win over the minute slot, so two different sessions that start in the same
 * minute both earn XP.
 */

import { getDataService } from './data/dataService';
import type { ActivityEntry } from './data/IDataService';
import type { FitbitActivity } from './fitbit.service';
import { XpCalculatorService } from './xpCalculator.service';
import { persistClassXpAwards, toCanonicalClassName } from './xpAward.service';
import { getActiveBodyStatuses } from './bodyStatus.service';
import { ActivityWhenError, resolveActivityWhen } from './activityOccurredAt';

export type WearableWorkoutType =
  | 'workout-strength'
  | 'workout-cardio'
  | 'workout-mobility'
  | 'workout-mma';

/** Engine workout rates an override is allowed to name. No new constants. */
export const WEARABLE_WORKOUT_TYPES: readonly WearableWorkoutType[] = [
  'workout-strength',
  'workout-cardio',
  'workout-mobility',
  'workout-mma',
];

export function isWearableWorkoutType(value: string): value is WearableWorkoutType {
  return (WEARABLE_WORKOUT_TYPES as readonly string[]).includes(value);
}

/**
 * Caller-supplied type for one wearable session, matched by Fitbit sourceId
 * or, if that misses, by start time. The sync route may also add one from
 * Toggl Track when the request did not name that Sport session. Re-typing a
 * session that was already awarded is not supported; dedupe skips it.
 */
export interface WearableTypeOverride {
  sourceId?: string;
  /** Normalized "HH:MM". */
  startTime?: string;
  activityType: WearableWorkoutType;
  label?: string;
}

export class WearableOverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WearableOverrideError';
  }
}

/** Wearable start times are wall-clock "HH:MM" in the owner's zone. */
export const WEARABLE_TIME_ZONE = 'America/Chicago';

/** One UTC day's rows, newest first, at the single-page activity_log cap. */
const DEDUPE_LOG_LIMIT = 1000;

const MMA = /(martial|kickbox|boxing|wrestl|judo|jiu|bjj|sambo|muay|mma|karate|taekwondo|grappl)/;
const MOBILITY = /(yoga|pilates|stretch|mobility|tai chi|barre|meditat)/;
const STRENGTH = /(weight|strength|lift|circuit|crossfit|calisthen|resistance|bootcamp)/;
const WALL_CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Map a wearable session label onto an engine workout type. Fitbit's "Sport"
 * stays workout-cardio unless a sync override names that session (Sambo is
 * not in the activity name). "Aerobic Workout" is also cardio. Anything that
 * is not clearly martial arts, mobility, or strength (walks, runs, swims,
 * bikes) uses workout-cardio, the lower of the two general rates.
 */
export function classifyWearableActivity(name: string): WearableWorkoutType {
  const n = (name || '').trim().toLowerCase();
  if (MMA.test(n)) return 'workout-mma';
  if (MOBILITY.test(n)) return 'workout-mobility';
  if (STRENGTH.test(n)) return 'workout-strength';
  return 'workout-cardio';
}

/**
 * Auto-detected walks do not earn XP. Fitbit marks those `auto_detected`.
 * When the payload has no log type (older Fitbit rows, Google Health), a Walk
 * under 30 minutes is treated the same way. A Walk he logs or starts by hand
 * (`manual`, `tracker`, anything other than `auto_detected`) still earns
 * cardio XP, including a short one. The quest text is written from the full
 * activity list, so a skipped walk still shows there.
 */
export function isAutoDetectedWalk(a: Pick<FitbitActivity, 'name' | 'durationMin' | 'logType'>): boolean {
  if ((a.name || '').trim().toLowerCase() !== 'walk') return false;
  const logType = a.logType?.trim().toLowerCase();
  if (logType === 'auto_detected') return true;
  if (!logType) return (a.durationMin ?? 0) < 30;
  return false;
}

/** "H:MM" or "HH:MM:SS" → "HH:MM". Null when it is not a clock time. */
export function wallClock(startTime: string): string | null {
  const match = WALL_CLOCK.exec(startTime.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = match[3] != null ? Number(match[3]) : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function slotIdentity(date: string, a: FitbitActivity): string | null {
  if (a.startTime) {
    const clock = wallClock(a.startTime);
    if (clock) return `${date}T${clock}`;
    const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(a.startTime.trim());
    if (iso) return `${iso[1]}T${iso[2]}:${iso[3]}`;
    return null;
  }
  return null;
}

function slotTag(date: string, a: FitbitActivity): string {
  const identity = slotIdentity(date, a);
  if (identity) return `[wearable:${identity}]`;
  const slug = (a.name || 'activity').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `[wearable:${date}:${slug}:${a.durationMin}m]`;
}

function safeTagPart(value: string): string {
  return value.replace(/[\[\]]/g, '').trim();
}

function idTag(provider: string, a: FitbitActivity): string | null {
  const id = a.sourceId ? safeTagPart(a.sourceId) : '';
  const who = safeTagPart(provider);
  if (!id || !who) return null;
  return `[wearable-id:${who}:${id}]`;
}

/** Offset of `timeZone` at a UTC instant, in minutes east of UTC. */
function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  let hour = get('hour');
  // Some ICU builds report midnight as hour 24.
  if (hour === 24) hour = 0;
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'));
  return Math.round((wall - utcMs) / 60000);
}

function formatOffset(offsetMin: number): string {
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * UTC offset ("-05:00") of `timeZone` at the given wall-clock time.
 * A second pass corrects the days the offset changes (DST). The first
 * guess treats the wall clock as UTC, which is an hour off on the morning
 * of a transition.
 */
export function zoneOffset(date: string, hhmm: string, timeZone = WEARABLE_TIME_ZONE): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetMinutesAt(utcGuess, timeZone);
  let utc = utcGuess - first * 60_000;
  const second = offsetMinutesAt(utc, timeZone);
  if (second !== first) utc = utcGuess - second * 60_000;
  return formatOffset(offsetMinutesAt(utc, timeZone));
}

function zonedStart(date: string, startTime: string): string | null {
  const trimmed = startTime.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed;
  const clock = wallClock(trimmed);
  if (!clock) return null;
  return `${date}T${clock}:00${zoneOffset(date, clock)}`;
}

export interface WearableXpAward {
  name: string;
  activityType: WearableWorkoutType;
  durationMin: number;
  xp: number;
  tag: string;
}

export interface WearableXpSkip {
  name: string;
  reason: 'already_awarded' | 'no_duration' | 'outside_window' | 'future' | 'invalid_time' | 'auto_walk';
  tag: string;
}

export interface WearableXpResult {
  date: string;
  awarded: WearableXpAward[];
  skipped: WearableXpSkip[];
  totalXp: number;
}

/** XP one session earns before any body-status penalty. Pure; used by tests and back-pay math. */
export function wearableSessionXp(
  a: Pick<FitbitActivity, 'name' | 'durationMin'> & { activityType?: WearableWorkoutType },
): { activityType: WearableWorkoutType; xp: number } {
  const activityType = a.activityType ?? classifyWearableActivity(a.name);
  const xp = new XpCalculatorService().calculateXP(activityType, a.durationMin);
  return { activityType, xp };
}

/** "Sport" + "Toggl: Sambo" → "Sport (Toggl: Sambo)". Brackets are stripped so a label cannot forge a dedupe tag. */
export function wearableDisplayName(name: string, label?: string): string {
  const base = (name || 'Activity').trim() || 'Activity';
  const extra = label?.replace(/[\[\]]/g, '').trim();
  if (!extra) return base;
  return `${base} (${extra})`;
}

export function wearableQuestLine(a: FitbitActivity, overrides: WearableTypeOverride[] = []): string {
  const matched = matchWearableOverride(a, overrides);
  const name = wearableDisplayName(a.name, matched?.label);
  return `${name} ${a.durationMin}min (${a.calories} cal${a.startTime ? ` @ ${a.startTime}` : ''})`;
}

/**
 * sourceId wins. A start-time match is used only when no override names this
 * session's sourceId. An override that names a different sourceId does not
 * attach to another session that happens to start on the same minute.
 */
export function matchWearableOverride(
  a: FitbitActivity,
  overrides: WearableTypeOverride[],
): WearableTypeOverride | undefined {
  const id = a.sourceId?.trim();
  if (id) {
    const byId = overrides.find(o => o.sourceId === id);
    if (byId) return byId;
  }
  const clock = a.startTime ? wallClock(a.startTime) : null;
  if (!clock) return undefined;
  return overrides.find(o => o.startTime === clock && (!o.sourceId || !id));
}

export function parseWearableOverrides(raw: unknown): WearableTypeOverride[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new WearableOverrideError('overrides must be an array');
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new WearableOverrideError(`overrides[${index}] must be an object`);
    }
    const row = item as Record<string, unknown>;
    if (typeof row.activityType !== 'string' || !isWearableWorkoutType(row.activityType)) {
      throw new WearableOverrideError(
        `overrides[${index}].activityType must be one of ${WEARABLE_WORKOUT_TYPES.join(', ')}`,
      );
    }
    let sourceId: string | undefined;
    if (row.sourceId != null) {
      if (typeof row.sourceId !== 'string' || !row.sourceId.trim()) {
        throw new WearableOverrideError(`overrides[${index}].sourceId must be a non-empty string`);
      }
      sourceId = row.sourceId.trim();
    }
    let startTime: string | undefined;
    if (row.startTime != null) {
      if (typeof row.startTime !== 'string') {
        throw new WearableOverrideError(`overrides[${index}].startTime must be HH:MM`);
      }
      const clock = wallClock(row.startTime);
      if (!clock) throw new WearableOverrideError(`overrides[${index}].startTime must be HH:MM`);
      startTime = clock;
    }
    if (!sourceId && !startTime) {
      throw new WearableOverrideError(`overrides[${index}] needs a sourceId or startTime`);
    }
    let label: string | undefined;
    if (row.label != null) {
      if (typeof row.label !== 'string') {
        throw new WearableOverrideError(`overrides[${index}].label must be a string`);
      }
      label = row.label.replace(/[\[\]]/g, '').trim() || undefined;
    }
    return { sourceId, startTime, activityType: row.activityType, label };
  });
}

interface WearableSeen {
  ids: Set<string>;
  /** Minute slots written on a row that had no provider-id tag. */
  anonymousSlots: Set<string>;
  /** Minute slots written together with a provider-id tag. */
  identifiedSlots: Set<string>;
}

function emptySeen(): WearableSeen {
  return { ids: new Set(), anonymousSlots: new Set(), identifiedSlots: new Set() };
}

function rememberNotes(notes: string | null | undefined, seen: WearableSeen): void {
  const tags = [...(notes ?? '').matchAll(/\[wearable(?:-id)?:[^\]]+\]/g)].map(m => m[0]);
  const ids = tags.filter(tag => tag.startsWith('[wearable-id:'));
  const slots = tags.filter(tag => tag.startsWith('[wearable:') && !tag.startsWith('[wearable-id:'));
  if (ids.length === 0) {
    for (const slot of slots) seen.anonymousSlots.add(slot);
    return;
  }
  for (const id of ids) seen.ids.add(id);
  for (const slot of slots) seen.identifiedSlots.add(slot);
}

/**
 * Provider id is the stable key. The minute slot dedupes sessions that never
 * received an id, and a later sync that gained an id still matches the older
 * slot-only row. Two ids in the same minute are two sessions.
 */
function alreadyAwarded(slot: string, id: string | null, seen: WearableSeen): boolean {
  if (id && seen.ids.has(id)) return true;
  if (seen.anonymousSlots.has(slot)) return true;
  if (!id && seen.identifiedSlots.has(slot)) return true;
  return false;
}

function whenSkipReason(err: ActivityWhenError): WearableXpSkip['reason'] {
  if (err.message.includes('backfill')) return 'outside_window';
  if (err.message.includes('future')) return 'future';
  return 'invalid_time';
}

// One award run at a time per process, so two overlapping syncs of the same
// day cannot both miss each other's dedupe tag.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export function awardWearableActivities(
  userId: string,
  date: string,
  provider: 'google' | 'fitbit' | 'oura' | string,
  activities: FitbitActivity[],
  nowOrOptions: Date | { now?: Date; overrides?: WearableTypeOverride[] } = new Date(),
): Promise<WearableXpResult> {
  const now = nowOrOptions instanceof Date ? nowOrOptions : (nowOrOptions.now ?? new Date());
  const overrides = nowOrOptions instanceof Date ? [] : (nowOrOptions.overrides ?? []);
  return serialized(() => awardUnlocked(userId, date, provider, activities, now, overrides));
}

async function awardUnlocked(
  userId: string,
  date: string,
  provider: string,
  activities: FitbitActivity[],
  now: Date,
  overrides: WearableTypeOverride[],
): Promise<WearableXpResult> {
  const result: WearableXpResult = { date, awarded: [], skipped: [], totalXp: 0 };
  if (activities.length === 0) return result;

  const db = getDataService();
  const existing: ActivityEntry[] = await db.getActivityLog(userId, DEDUPE_LOG_LIMIT, date);
  const seen = emptySeen();
  for (const row of existing) rememberNotes(row.notes, seen);

  // Same body-status rule as POST /api/activities: highest matching penalty wins.
  const penaltyByType: Record<string, number> = {};
  try {
    const statuses = await getActiveBodyStatuses(userId);
    for (const s of statuses) {
      for (const action of s.impacts_actions ?? []) {
        penaltyByType[action] = Math.max(penaltyByType[action] ?? 0, s.xp_penalty ?? 0);
      }
    }
  } catch (err) {
    console.warn('[WEARABLE XP] Body-status lookup failed (defaulting to 0%):', err instanceof Error ? err.message : err);
  }

  for (const a of activities) {
    const slot = slotTag(date, a);
    const id = idTag(provider, a);
    if (alreadyAwarded(slot, id, seen)) {
      result.skipped.push({ name: a.name, reason: 'already_awarded', tag: slot });
      continue;
    }
    if (!a.durationMin || a.durationMin <= 0) {
      result.skipped.push({ name: a.name, reason: 'no_duration', tag: slot });
      continue;
    }
    if (isAutoDetectedWalk(a)) {
      result.skipped.push({ name: a.name, reason: 'auto_walk', tag: slot });
      continue;
    }

    let when;
    try {
      if (a.startTime) {
        const start = zonedStart(date, a.startTime);
        if (!start) {
          result.skipped.push({ name: a.name, reason: 'invalid_time', tag: slot });
          console.warn(`[WEARABLE XP] skip ${a.name}: start time "${a.startTime}" is not a clock or ISO timestamp`);
          continue;
        }
        when = resolveActivityWhen({ startTime: start }, now);
      } else {
        when = resolveActivityWhen({ date }, now);
      }
    } catch (err) {
      if (err instanceof ActivityWhenError) {
        const reason = whenSkipReason(err);
        result.skipped.push({ name: a.name, reason, tag: slot });
        console.warn(`[WEARABLE XP] skip ${a.name}: ${err.message}`);
        continue;
      }
      throw err;
    }

    const override = matchWearableOverride(a, overrides);
    const displayName = wearableDisplayName(a.name, override?.label);
    const { activityType, xp: rawXp } = wearableSessionXp({ ...a, activityType: override?.activityType });
    const penalty = penaltyByType[activityType] ?? 0;
    const xp = Math.round(rawXp * (100 - penalty) / 100);
    const className = toCanonicalClassName(new XpCalculatorService().getCategoryFromActivity(activityType));
    const tags = [slot, id].filter(Boolean).join(' ');
    const detail = `${displayName} ${a.durationMin}min (${a.calories} cal${a.startTime ? ` @ ${a.startTime}` : ''})`;
    const notes = `${tags} Wearable (${provider}): ${detail}`;

    // Log first, then credit XP, same order as POST /api/activities. A stats
    // write that fails after the log row exists will not be retried: the tag
    // is already in activity_log. Both writes are non-transactional.
    await db.logActivity(userId, {
      activity_type: activityType,
      class_name: className,
      duration_hours: +(a.durationMin / 60).toFixed(2),
      xp_awarded: xp,
      notes,
      logged_at: when.loggedAt,
    });
    await persistClassXpAwards(userId, [{ className, xp }]);

    rememberNotes(notes, seen);
    result.awarded.push({ name: displayName, activityType, durationMin: a.durationMin, xp, tag: slot });
    result.totalXp += xp;
  }

  console.log(`[WEARABLE XP] ${date}: +${result.totalXp} XP from ${result.awarded.length} session(s), ${result.skipped.length} skipped`);
  return result;
}
