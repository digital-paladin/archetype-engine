/**
 * Recovery & Consistency quests — XP for the habits that unlock everything else.
 *
 * These are ordinary activity types (see XpCalculatorService.activityXP, all
 * prefixed `recovery-` so they route to the Warrior class). This module only
 * adds the anti-farming guards that make each one mean what it says:
 *
 *   Main quest  "Foot X-ray (Case 2)" — 4 one-time steps, in order:
 *     recovery-xray-order   Get the doctor's order        40 XP
 *     recovery-xray-book    Book the X-ray                40 XP
 *     recovery-xray-done    Get the X-ray done           120 XP
 *     recovery-xray-review  Review results with doctor/PT 100 XP   (quest total 300)
 *
 *   Recurring  "Rest Day Kept" — recovery-rest-day, 20 XP, once per Thursday,
 *     only when that Thursday has no training logged.
 *
 *   Recurring  "Session As Planned" — recovery-session-as-planned, 10 XP bonus on
 *     top of the session's own XP. Needs a training activity logged the same day
 *     (one bonus per logged training session).
 *
 *   Bonus      "Consistency Bonus (10 of 13)" — recovery-consistency-bonus, 50 XP,
 *     when at least 10 Session-As-Planned logs fall in the trailing 14 days
 *     (the two-week review window, ~13 planned sessions). Once per 14 days.
 */
import { ActivityEntry } from './data/IDataService';

export const XRAY_STEPS = [
  'recovery-xray-order',
  'recovery-xray-book',
  'recovery-xray-done',
  'recovery-xray-review',
] as const;

export const REST_DAY = 'recovery-rest-day';
export const SESSION_AS_PLANNED = 'recovery-session-as-planned';
export const CONSISTENCY_BONUS = 'recovery-consistency-bonus';

export const REST_DAY_WEEKDAY = 4; // Thursday (0 = Sunday)
export const CONSISTENCY_WINDOW_DAYS = 14;
export const CONSISTENCY_MIN_SESSIONS = 10;

/** Activity types (other than recovery bonuses) that count as a training session. */
const TRAINING_EXACT = new Set(['mma-class', 'sparring', 'swimming']);

const XRAY_STEP_LABELS = [
  "Doctor's order",
  'Booked',
  'X-ray done',
  'Results reviewed',
] as const;

export function isRecoveryQuestType(activityType: string): boolean {
  return typeof activityType === 'string' && activityType.startsWith('recovery-');
}

export function isTrainingActivity(activityType: string): boolean {
  if (typeof activityType !== 'string') return false;
  return activityType.startsWith('workout') || TRAINING_EXACT.has(activityType);
}

/** Tag the route adds to a recovery log's notes so the claimed day survives late logging. */
export const CLAIM_DATE_TAG = (dateStr: string) => `[claim-date:${dateStr}]`;
const CLAIM_DATE_RE = /\[claim-date:(\d{4}-\d{2}-\d{2})\]/;

/** True for a real YYYY-MM-DD. `2026-09-31` matches the shape but rolls over to October. */
export function isRealIsoDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Day an entry counts for.
 * The claim-date tag is honored only on recovery quests — it is how a late
 * Rest Day / Session As Planned claim names its day. Honoring it on a training
 * log would let a note move that session off Thursday and unlock the rest day.
 * Anything else is dated from logged_at in the user's zone.
 */
export function entryDate(e: ActivityEntry): string | null {
  if (typeof e.activity_type === 'string' && isRecoveryQuestType(e.activity_type)) {
    const tagged = e.notes?.match(CLAIM_DATE_RE);
    if (tagged && isRealIsoDate(tagged[1])) return tagged[1];
  }
  if (!e.logged_at) return null;
  const local = localDate(e.logged_at);
  return isRealIsoDate(local) ? local : null;
}

/**
 * Combine the recent activity log with the full recovery-quest history.
 * The same row is often in both; counting it twice would double Session As
 * Planned bonuses and the consistency window.
 */
export function mergeActivityLogs(...groups: ActivityEntry[][]): ActivityEntry[] {
  const seen = new Set<string>();
  const merged: ActivityEntry[] = [];
  for (const group of groups) {
    for (const entry of group) {
      const key = entry.id
        ?? `${entry.logged_at ?? ''}\0${entry.activity_type}\0${entry.notes ?? ''}\0${entry.xp_awarded ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged;
}

/** YYYY-MM-DD for an ISO timestamp in the user's zone (APP_TIMEZONE, default America/Chicago). */
export function localDate(iso: string, timeZone = process.env.APP_TIMEZONE || 'America/Chicago'): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone });
}

function weekday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export type RecoveryCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validate a recovery-quest log against the user's existing activity log.
 * `dateStr` is the day being claimed (clientDate or today), YYYY-MM-DD.
 * `log` is the user's activity_log (any order); see entryDate() for how each entry is dated.
 */
export function validateRecoveryActivity(
  activityType: string,
  dateStr: string,
  log: ActivityEntry[],
  today: string = localDate(new Date().toISOString()),
): RecoveryCheck {
  if (!isRealIsoDate(dateStr)) {
    return { ok: false, reason: 'Claim date must be a real calendar day (YYYY-MM-DD)' };
  }

  const dated = log
    .map(e => ({ type: e.activity_type, date: entryDate(e) }))
    .filter((e): e is { type: string; date: string } => typeof e.type === 'string' && e.date !== null);
  const has = (type: string) => dated.some(e => e.type === type);

  // ── Foot X-ray main quest: one-time steps, in order ──────────────────────
  const stepIdx = (XRAY_STEPS as readonly string[]).indexOf(activityType);
  if (stepIdx >= 0) {
    if (has(activityType)) {
      return { ok: false, reason: `Foot X-ray ${stepIdx + 1}/4 (${XRAY_STEP_LABELS[stepIdx]}) is already completed` };
    }
    if (stepIdx > 0 && !has(XRAY_STEPS[stepIdx - 1])) {
      return { ok: false, reason: `Complete Foot X-ray ${stepIdx}/4 (${XRAY_STEP_LABELS[stepIdx - 1]}) first` };
    }
    return { ok: true };
  }

  if (activityType === REST_DAY) {
    if (weekday(dateStr) !== REST_DAY_WEEKDAY) return { ok: false, reason: 'Rest Day Kept only counts on Thursday' };
    if (daysBetween(today, dateStr) > 0) return { ok: false, reason: 'Cannot claim a future rest day' };
    const sameDay = dated.filter(e => e.date === dateStr);
    if (sameDay.some(e => e.type === REST_DAY)) return { ok: false, reason: 'Rest day already claimed for this Thursday' };
    if (sameDay.some(e => isTrainingActivity(e.type) || e.type === SESSION_AS_PLANNED)) {
      return { ok: false, reason: 'Training was logged this Thursday — rest day not kept' };
    }
    return { ok: true };
  }

  if (activityType === SESSION_AS_PLANNED) {
    const sameDay = dated.filter(e => e.date === dateStr);
    const sessions = sameDay.filter(e => isTrainingActivity(e.type)).length;
    const bonuses = sameDay.filter(e => e.type === SESSION_AS_PLANNED).length;
    if (sessions === 0) return { ok: false, reason: 'Log the training session first' };
    if (bonuses >= sessions) return { ok: false, reason: 'Every logged session that day already has its Session As Planned bonus' };
    return { ok: true };
  }

  if (activityType === CONSISTENCY_BONUS) {
    const inWindow = (d: string) => { const diff = daysBetween(d, dateStr); return diff >= 0 && diff < CONSISTENCY_WINDOW_DAYS; };
    if (dated.some(e => e.type === CONSISTENCY_BONUS && inWindow(e.date))) {
      return { ok: false, reason: `Consistency bonus already claimed in the last ${CONSISTENCY_WINDOW_DAYS} days` };
    }
    const count = dated.filter(e => e.type === SESSION_AS_PLANNED && inWindow(e.date)).length;
    if (count < CONSISTENCY_MIN_SESSIONS) {
      return { ok: false, reason: `${count}/${CONSISTENCY_MIN_SESSIONS} sessions as planned in the last ${CONSISTENCY_WINDOW_DAYS} days` };
    }
    return { ok: true };
  }

  return { ok: false, reason: `Unknown recovery quest type: ${activityType}` };
}
