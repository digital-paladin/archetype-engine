/**
 * UTC calendar helpers for nightly consolidation.
 * activity_log windows already use `${date}T00:00:00Z`–`23:59:59Z`.
 */
export const DEFAULT_CONSOLIDATION_STREAK_DAYS = 690;
export const CONSOLIDATION_CRON_EXPR = '5 0 * * *';

export function utcDateStr(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** UTC calendar date that has just ended at `now` (00:05 UTC → yesterday). */
export function previousUtcDate(d = new Date()): string {
  const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1);
  return new Date(ms).toISOString().slice(0, 10);
}

export function xpHistoryCoversDate(earnedAtValues: string[], date: string): boolean {
  return earnedAtValues.some(v => String(v).slice(0, 10) === date);
}

export function consolidationUserIds(
  profileIds: Array<string | null | undefined>,
  statsIds: Array<string | null | undefined>,
  opts: { ownerUserId?: string; demoUserId?: string } = {},
): string[] {
  const ids = new Set<string>();
  for (const id of [...profileIds, ...statsIds]) {
    if (id) ids.add(id);
  }
  if (opts.ownerUserId) ids.add(opts.ownerUserId);
  if (opts.demoUserId) ids.delete(opts.demoUserId);
  return [...ids];
}
