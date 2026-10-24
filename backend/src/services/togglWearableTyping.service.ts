/**
 * Type a Fitbit "Sport" session from the Toggl Track entry with the greatest
 * time overlap (project name, description, or tags), when the sync request
 * did not already name that session.
 *
 * Explicit overrides win. An unreachable Toggl, a missing token, or an
 * unmapped entry leaves the session on workout-cardio and does not fail the
 * sync. Re-typing an already-awarded session is still the awarder's job to
 * refuse; this only adds overrides for the current sync.
 */

import type { FitbitActivity } from './fitbit.service';
import { mapTogglProjectOrTags } from './togglActivityMap';
import {
  fetchTogglEntriesForChicagoDay,
  redactTogglSecret,
  togglEntryInterval,
  type TogglTimeEntry,
} from './togglTrack.service';
import {
  matchWearableOverride,
  wallClock,
  zoneOffset,
  type WearableTypeOverride,
} from './wearableActivityXp.service';

function isSportSession(activity: FitbitActivity): boolean {
  return (activity.name || '').trim().toLowerCase() === 'sport';
}

export function sportSessionInterval(
  date: string,
  activity: FitbitActivity,
): { startMs: number; endMs: number } | null {
  if (!activity.durationMin || activity.durationMin <= 0 || !activity.startTime) return null;
  const clock = wallClock(activity.startTime);
  if (!clock) return null;
  const startMs = Date.parse(`${date}T${clock}:00${zoneOffset(date, clock)}`);
  if (Number.isNaN(startMs)) return null;
  return { startMs, endMs: startMs + activity.durationMin * 60_000 };
}

function overlapMs(
  a: { startMs: number; endMs: number },
  b: { startMs: number; endMs: number },
): number {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
}

/**
 * Greatest overlap wins. The caller applies the mapping of that one entry;
 * a smaller overlap that maps does not replace a larger one that does not.
 * An exact overlap tie prefers an entry that maps, then the earlier start.
 */
export function bestOverlappingTogglEntry(
  interval: { startMs: number; endMs: number },
  entries: readonly TogglTimeEntry[],
  now: Date,
): TogglTimeEntry | null {
  let best: { entry: TogglTimeEntry; overlap: number; startMs: number; mapped: boolean } | null = null;
  for (const entry of entries) {
    const span = togglEntryInterval(entry, now);
    if (!span) continue;
    const overlap = overlapMs(interval, span);
    if (overlap <= 0) continue;
    const mapped = mapTogglProjectOrTags(entry.projectName, entry.tags, entry.description) != null;
    const candidate = { entry, overlap, startMs: span.startMs, mapped };
    if (!best) {
      best = candidate;
      continue;
    }
    const betterOverlap = candidate.overlap > best.overlap;
    const sameOverlap = candidate.overlap === best.overlap;
    const betterMap = sameOverlap && candidate.mapped && !best.mapped;
    const sameMap = sameOverlap && candidate.mapped === best.mapped;
    const earlier = sameMap && candidate.startMs < best.startMs;
    const sameStart = sameMap && candidate.startMs === best.startMs && candidate.entry.id < best.entry.id;
    if (betterOverlap || betterMap || earlier || sameStart) best = candidate;
  }
  return best?.entry ?? null;
}

/** Overrides for Sport sessions that the request did not already type. */
export function togglOverridesForSportSessions(
  date: string,
  activities: FitbitActivity[],
  explicitOverrides: WearableTypeOverride[],
  entries: readonly TogglTimeEntry[],
  now = new Date(),
): WearableTypeOverride[] {
  const added: WearableTypeOverride[] = [];
  for (const activity of activities) {
    if (!isSportSession(activity)) continue;
    if (matchWearableOverride(activity, explicitOverrides)) continue;
    const interval = sportSessionInterval(date, activity);
    if (!interval) continue;
    const winner = bestOverlappingTogglEntry(interval, entries, now);
    if (!winner) continue;
    const mapped = mapTogglProjectOrTags(winner.projectName, winner.tags, winner.description);
    if (!mapped) continue;
    const sourceId = activity.sourceId?.trim() || undefined;
    const startTime = activity.startTime ? wallClock(activity.startTime) ?? undefined : undefined;
    if (!sourceId && !startTime) continue;
    added.push({
      sourceId,
      startTime,
      activityType: mapped.activityType,
      label: `Toggl: ${mapped.label}`,
    });
  }
  return added;
}

/**
 * Fetch Toggl for this Chicago day and return Sport overrides.
 * Never throws. A missing token or a failed request yields [].
 */
export async function loadTogglSportOverrides(
  date: string,
  activities: FitbitActivity[],
  explicitOverrides: WearableTypeOverride[],
  now = new Date(),
): Promise<WearableTypeOverride[]> {
  const needsLookup = activities.some(activity =>
    isSportSession(activity) && !matchWearableOverride(activity, explicitOverrides));
  if (!needsLookup) return [];
  try {
    const entries = await fetchTogglEntriesForChicagoDay(date, now);
    return togglOverridesForSportSessions(date, activities, explicitOverrides, entries, now);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[TOGGL] time entry fetch failed; Sport sessions stay workout-cardio: ${redactTogglSecret(message)}`);
    return [];
  }
}
