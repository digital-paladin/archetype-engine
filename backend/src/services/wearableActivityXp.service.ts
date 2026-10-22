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

/** Wearable start times are wall-clock "HH:MM" in the owner's zone. */
export const WEARABLE_TIME_ZONE = 'America/Chicago';

const MMA = /(martial|kickbox|boxing|wrestl|judo|jiu|bjj|sambo|muay|mma|karate|taekwondo|grappl)/;
const MOBILITY = /(yoga|pilates|stretch|mobility|tai chi|barre|meditat)/;
const STRENGTH = /(weight|strength|lift|circuit|crossfit|calisthen|resistance|bootcamp)/;

/**
 * Map a wearable session label onto an engine workout type. Anything that is
 * not clearly martial arts, mobility or strength (walks, runs, swims, bikes,
 * Fitbit's generic "Sport" / "Aerobic Workout") uses workout-cardio, the lower
 * of the two general rates.
 */
export function classifyWearableActivity(name: string): WearableWorkoutType {
  const n = (name || '').toLowerCase();
  if (MMA.test(n)) return 'workout-mma';
  if (MOBILITY.test(n)) return 'workout-mobility';
  if (STRENGTH.test(n)) return 'workout-strength';
  return 'workout-cardio';
}

function slotTag(date: string, a: FitbitActivity): string {
  if (a.startTime) return `[wearable:${date}T${a.startTime}]`;
  const slug = (a.name || 'activity').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `[wearable:${date}:${slug}:${a.durationMin}m]`;
}

function idTag(provider: string, a: FitbitActivity): string | null {
  return a.sourceId ? `[wearable-id:${provider}:${a.sourceId}]` : null;
}

/** UTC offset ("-05:00") of `timeZone` at the given wall-clock time. */
export function zoneOffset(date: string, hhmm: string, timeZone = WEARABLE_TIME_ZONE): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(asUtc));
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  const offsetMin = Math.round((wall - asUtc) / 60000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
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
  reason: 'already_awarded' | 'no_duration' | 'outside_window';
  tag: string;
}

export interface WearableXpResult {
  date: string;
  awarded: WearableXpAward[];
  skipped: WearableXpSkip[];
  totalXp: number;
}

/** XP one session earns before any body-status penalty. Pure; used by tests and back-pay math. */
export function wearableSessionXp(a: Pick<FitbitActivity, 'name' | 'durationMin'>): { activityType: WearableWorkoutType; xp: number } {
  const activityType = classifyWearableActivity(a.name);
  const xp = new XpCalculatorService().calculateXP(activityType, a.durationMin);
  return { activityType, xp };
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
  now: Date = new Date(),
): Promise<WearableXpResult> {
  return serialized(() => awardUnlocked(userId, date, provider, activities, now));
}

async function awardUnlocked(
  userId: string,
  date: string,
  provider: string,
  activities: FitbitActivity[],
  now: Date,
): Promise<WearableXpResult> {
  const result: WearableXpResult = { date, awarded: [], skipped: [], totalXp: 0 };
  if (activities.length === 0) return result;

  const db = getDataService();
  const existing: ActivityEntry[] = await db.getActivityLog(userId, 200, date);
  const seen = new Set<string>();
  for (const row of existing) {
    for (const m of (row.notes ?? '').matchAll(/\[wearable(?:-id)?:[^\]]+\]/g)) seen.add(m[0]);
  }

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
    if (seen.has(slot) || (id && seen.has(id))) {
      result.skipped.push({ name: a.name, reason: 'already_awarded', tag: slot });
      continue;
    }
    if (!a.durationMin || a.durationMin <= 0) {
      result.skipped.push({ name: a.name, reason: 'no_duration', tag: slot });
      continue;
    }

    let when;
    try {
      when = a.startTime
        ? resolveActivityWhen({ startTime: `${date}T${a.startTime}:00${zoneOffset(date, a.startTime)}` }, now)
        : resolveActivityWhen({ date }, now);
    } catch (err) {
      if (err instanceof ActivityWhenError) {
        result.skipped.push({ name: a.name, reason: 'outside_window', tag: slot });
        continue;
      }
      throw err;
    }

    const { activityType, xp: rawXp } = wearableSessionXp(a);
    const penalty = penaltyByType[activityType] ?? 0;
    const xp = Math.round(rawXp * (100 - penalty) / 100);
    const className = toCanonicalClassName(new XpCalculatorService().getCategoryFromActivity(activityType));
    const tags = [slot, id].filter(Boolean).join(' ');
    const detail = `${a.name} ${a.durationMin}min (${a.calories} cal${a.startTime ? ` @ ${a.startTime}` : ''})`;

    await db.logActivity(userId, {
      activity_type: activityType,
      class_name: className,
      duration_hours: +(a.durationMin / 60).toFixed(2),
      xp_awarded: xp,
      notes: `${tags} Wearable (${provider}): ${detail}`,
      logged_at: when.loggedAt,
    });
    await persistClassXpAwards(userId, [{ className, xp }]);

    seen.add(slot);
    if (id) seen.add(id);
    result.awarded.push({ name: a.name, activityType, durationMin: a.durationMin, xp, tag: slot });
    result.totalXp += xp;
  }

  console.log(`[WEARABLE XP] ${date}: +${result.totalXp} XP from ${result.awarded.length} session(s), ${result.skipped.length} skipped`);
  return result;
}
