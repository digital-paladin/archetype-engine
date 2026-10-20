/**
 * Resolve when a logged activity happened.
 *
 * Precedence: `occurredAt`, then `startTime`, then `date`, then `clientDate`.
 * When every field is omitted, the activity is stamped with the request time
 * so existing clients keep working.
 *
 * Date-only values that are "today" in UTC or America/Chicago also keep the
 * request time. The web app sends `clientDate` set to the browser's local
 * today on every live log; treating that as a backfill would move those
 * rows off the real clock.
 *
 * A past date-only value is stored at 12:00:00.000Z on that calendar day.
 * Per-day XP (consolidation, daily metrics, streaks) sums `activity_log`
 * with a UTC window of `YYYY-MM-DDT00:00:00.000Z`–`T23:59:59.999Z`. Noon UTC
 * falls inside the day the client named and inside the America/Chicago day.
 *
 * A zoned timestamp is stored as that instant when the UTC date of the
 * instant matches the civil date written in the string. After 19:00
 * America/Chicago the local evening is already the next UTC day; those
 * instants are anchored at noon UTC on the civil date so the XP still counts
 * on the day it happened. The exact instant is returned as `occurredAt`.
 *
 * Rejects unparseable input, instants more than ACTIVITY_FUTURE_TOLERANCE_MS
 * ahead of the server clock, and civil dates older than ACTIVITY_BACKFILL_DAYS.
 *
 * System quest resolution (PR #26 `commitXp`) is not on this branch. When it
 * lands it should pass `scheduledFor` through this helper instead of
 * `new Date()`, so quest XP uses the quest day rather than the clear time.
 */

export const ACTIVITY_BACKFILL_DAYS = 90;
export const ACTIVITY_FUTURE_TOLERANCE_MS = 15 * 60 * 1000;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT =
  /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

export class ActivityWhenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivityWhenError';
  }
}

export interface ActivityWhenInput {
  occurredAt?: unknown;
  startTime?: unknown;
  date?: unknown;
  clientDate?: unknown;
}

export interface ResolvedActivityWhen {
  /** Value written to activity_log.logged_at. Its UTC date is `date`. */
  loggedAt: string;
  /** Calendar day for level-up events, courage daily cap, and per-day XP. */
  date: string;
  /**
   * Exact instant when the client sent one. Equals `loggedAt` when the
   * stored stamp did not need to be anchored onto the civil day.
   */
  occurredAt: string;
}

function readOptionalString(value: unknown, name: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') {
    throw new ActivityWhenError(`${name} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function chicagoDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function shiftUtcDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function assertRealCalendarDay(day: string, name: string): void {
  const match = DATE_ONLY.exec(day);
  if (!match) {
    throw new ActivityWhenError(`${name} must be YYYY-MM-DD or ISO 8601 with a timezone`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new ActivityWhenError(`${name} is not a valid calendar date`);
  }
}

function assertWithinBackfill(day: string, now: Date, name: string): void {
  const earliest = shiftUtcDay(utcDay(now), -ACTIVITY_BACKFILL_DAYS);
  if (day < earliest) {
    throw new ActivityWhenError(
      `${name} is outside the ${ACTIVITY_BACKFILL_DAYS}-day backfill window (earliest ${earliest})`,
    );
  }
}

function isLiveDay(day: string, now: Date): boolean {
  return day === utcDay(now) || day === chicagoDay(now);
}

function anchorNoonUtc(day: string): string {
  return `${day}T12:00:00.000Z`;
}

function resolveDateOnly(day: string, now: Date, name: string): ResolvedActivityWhen {
  assertRealCalendarDay(day, name);
  if (day > utcDay(now)) {
    throw new ActivityWhenError(`${name} is in the future`);
  }
  assertWithinBackfill(day, now, name);
  if (isLiveDay(day, now)) {
    const loggedAt = now.toISOString();
    return { loggedAt, occurredAt: loggedAt, date: day };
  }
  const loggedAt = anchorNoonUtc(day);
  return { loggedAt, occurredAt: loggedAt, date: day };
}

function resolveInstant(raw: string, now: Date, name: string): ResolvedActivityWhen {
  const match = ISO_INSTANT.exec(raw);
  if (!match) {
    throw new ActivityWhenError(
      `${name} must be ISO 8601 with a timezone (for example 2026-10-19T18:30:00-05:00)`,
    );
  }
  const civil = match[1];
  assertRealCalendarDay(civil, name);
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) {
    throw new ActivityWhenError(`${name} is not a valid datetime`);
  }
  if (instant.getTime() > now.getTime() + ACTIVITY_FUTURE_TOLERANCE_MS) {
    throw new ActivityWhenError(`${name} is in the future`);
  }
  if (civil > utcDay(now)) {
    throw new ActivityWhenError(`${name} is in the future`);
  }
  assertWithinBackfill(civil, now, name);

  const loggedAt = utcDay(instant) === civil ? instant.toISOString() : anchorNoonUtc(civil);
  return { loggedAt, occurredAt: instant.toISOString(), date: civil };
}

function parseChosen(raw: string, now: Date, name: string): ResolvedActivityWhen {
  if (DATE_ONLY.test(raw)) return resolveDateOnly(raw, now, name);
  return resolveInstant(raw, now, name);
}

export function resolveActivityWhen(input: ActivityWhenInput, now = new Date()): ResolvedActivityWhen {
  const occurredAt = readOptionalString(input.occurredAt, 'occurredAt');
  const startTime = readOptionalString(input.startTime, 'startTime');
  const date = readOptionalString(input.date, 'date');
  const clientDate = readOptionalString(input.clientDate, 'clientDate');

  if (occurredAt !== undefined) return parseChosen(occurredAt, now, 'occurredAt');
  if (startTime !== undefined) return parseChosen(startTime, now, 'startTime');
  if (date !== undefined) return parseChosen(date, now, 'date');
  if (clientDate !== undefined) return parseChosen(clientDate, now, 'clientDate');

  const loggedAt = now.toISOString();
  return { loggedAt, occurredAt: loggedAt, date: utcDay(now) };
}

/** Inclusive UTC bounds used by activity_log per-day queries. */
export function utcDayBounds(date: string): { start: string; end: string } {
  return {
    start: `${date}T00:00:00.000Z`,
    end: `${date}T23:59:59.999Z`,
  };
}
