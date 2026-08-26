/**
 * Sleep debt vs 7.5h baseline, computed as a 14-day rolling deficit sum
 * (Van Dongen et al. 2003 chronic-restriction window; same window Oura uses
 * for its Sleep Debt metric). No running accumulator, no watermark, no
 * "opening balance" — old deficits simply age out of the window instead of
 * needing an explicit paydown mechanic. Days with no logged sleep are
 * excluded rather than assumed to be 7.5h.
 */
import { getDataService } from './data/dataService';
import { CharacterProfile } from './data/IDataService';
import { addCalendarDays, localDateStr } from './sleepHistoryCalendar';

export const SLEEP_BASELINE_HOURS = 7.5;
export const SLEEP_DEBT_WINDOW_DAYS = 14;

/** Surplus hours counted toward the nightly extension bonus (mirror of deficit, capped). */
export const SLEEP_EXTENSION_CAP_HOURS = 2;
/** Consecutive nights at or above this duration count toward the streak bonus. */
export const SLEEP_EXTENSION_STREAK_HOURS = 9;
/** Streak bonus is 0 until this many consecutive ≥9h nights. */
export const SLEEP_EXTENSION_STREAK_MIN_NIGHTS = 5;
/** How far back to walk when recomputing the extension streak. */
export const SLEEP_EXTENSION_LOOKBACK_DAYS = 30;
/** +5% consolidation per surplus hour, so cap hours → +10%. */
export const SLEEP_EXTENSION_PCT_PER_SURPLUS_HOUR = 5;

export interface SleepNightInput {
  date: string;
  hours: number;
  score: number;
}

export interface SleepDebtSyncResult {
  nights: Array<SleepNightInput & { deficit: number }>;
  sleepDebt: number;
  vitality: number;
  sleepTrend: string;
  extensionStreak: number;
  extensionBonusPct: number;
}

type SleepDebtDb = {
  getCharacterProfile(userId: string): Promise<CharacterProfile | null>;
  upsertCharacterProfile(userId: string, profile: Partial<CharacterProfile>): Promise<void>;
  listJournalSleepRange(
    userId: string,
    fromDate: string,
    toDate: string,
  ): Promise<Array<{ date: string; hours: number; score: number }>>;
};

/** Deficit contribution for one night: 0 if no data logged or hours >= baseline. */
export function nightlyDeficit(hours: number): number {
  if (!(hours > 0) || hours >= SLEEP_BASELINE_HOURS) return 0;
  return Math.round((SLEEP_BASELINE_HOURS - hours) * 100) / 100;
}

/** Only nights with real logged hours, within [today - (windowDays-1), today]. */
export function selectNightsInWindow(
  nights: Array<{ date: string; hours: number; score: number }>,
  opts: { today: string; windowDays?: number },
): SleepNightInput[] {
  const windowDays = opts.windowDays ?? SLEEP_DEBT_WINDOW_DAYS;
  const windowStart = addCalendarDays(opts.today, -(windowDays - 1));
  return nights
    .map(n => ({
      date: String(n.date).slice(0, 10),
      hours: Number(n.hours) || 0,
      score: Number(n.score) || 0,
    }))
    .filter(n => n.hours > 0 && n.date >= windowStart && n.date <= opts.today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Sum of nightly deficits over the trailing window (Van Dongen 2003 / Oura 14-day model). */
export function computeRollingSleepDebt(
  nights: Array<{ date: string; hours: number; score: number }>,
  opts: { today: string; windowDays?: number },
): number {
  const inWindow = selectNightsInWindow(nights, opts);
  const total = inWindow.reduce((sum, n) => sum + nightlyDeficit(n.hours), 0);
  return Math.round(total * 100) / 100;
}

/** 3-segment vitality curve (matches Sleep tab color tiers): flat 100 ≤2h, −2/h to 5h, −3/h above 5h. */
export function vitalityFromSleepDebt(debt: number): number {
  let vitality: number;
  if (debt <= 2) {
    vitality = 100;
  } else if (debt <= 5) {
    vitality = 100 - (debt - 2) * 2;
  } else {
    vitality = Math.max(0, 94 - (debt - 5) * 3);
  }
  return Math.round(vitality * 10) / 10;
}

export function sleepTrendFromDebt(prev: number, next: number): 'Increased' | 'Decreased' | 'Stable' {
  if (next > prev + 0.05) return 'Increased';
  if (next < prev - 0.05) return 'Decreased';
  return 'Stable';
}

/**
 * Surplus hours above the 7.5h baseline, capped at SLEEP_EXTENSION_CAP_HOURS.
 * Oversleep does not reduce sleep_debt — this is a separate reward track.
 */
export function nightlySurplus(hours: number): number {
  if (!(hours > 0) || hours <= SLEEP_BASELINE_HOURS) return 0;
  const raw = hours - SLEEP_BASELINE_HOURS;
  return Math.round(Math.min(raw, SLEEP_EXTENSION_CAP_HOURS) * 100) / 100;
}

/** Immediate per-night bonus percent: +5% per surplus hour, max +10%. */
export function nightlyExtensionBonusPct(hours: number): number {
  return Math.round(nightlySurplus(hours) * SLEEP_EXTENSION_PCT_PER_SURPLUS_HOUR * 100) / 100;
}

/**
 * Consecutive nights ending on `today` with hours >= 9.
 * Breaks on the first missing or sub-threshold night (including today).
 * Recomputed from journal rows — not a running accumulator.
 */
export function computeExtensionStreak(
  nights: Array<{ date: string; hours: number }>,
  opts: { today: string; lookbackDays?: number; thresholdHours?: number },
): number {
  const lookback = opts.lookbackDays ?? SLEEP_EXTENSION_LOOKBACK_DAYS;
  const threshold = opts.thresholdHours ?? SLEEP_EXTENSION_STREAK_HOURS;
  const byDate = new Map<string, number>();
  for (const n of nights) {
    byDate.set(String(n.date).slice(0, 10), Number(n.hours) || 0);
  }
  let streak = 0;
  for (let i = 0; i < lookback; i++) {
    const date = addCalendarDays(opts.today, -i);
    const hours = byDate.get(date) ?? 0;
    if (hours >= threshold) streak += 1;
    else break;
  }
  return streak;
}

/**
 * Sustained-streak bonus percent. 0 until 5 consecutive ≥9h nights
 * (Mah et al. 2011 needed multiple weeks of extension for the athletic gains).
 */
export function extensionStreakBonusPct(streakNights: number): number {
  if (streakNights < SLEEP_EXTENSION_STREAK_MIN_NIGHTS) return 0;
  if (streakNights < 10) return 5;
  if (streakNights < 14) return 10;
  return 15;
}

/** Combined multiplicative bonus as a percent: (1+n)(1+s) − 1. */
export function combinedExtensionBonusPct(hours: number, streakNights: number): number {
  const nightly = nightlyExtensionBonusPct(hours);
  const streak = extensionStreakBonusPct(streakNights);
  return Math.round(((1 + nightly / 100) * (1 + streak / 100) - 1) * 1000) / 10;
}

export async function syncSleepDebtFromJournal(
  userId: string,
  db: SleepDebtDb = getDataService(),
  today: string = localDateStr(),
): Promise<SleepDebtSyncResult | null> {
  const profile = await db.getCharacterProfile(userId);
  if (!profile) return null;

  const lookbackStart = addCalendarDays(today, -(SLEEP_EXTENSION_LOOKBACK_DAYS - 1));
  const journal = await db.listJournalSleepRange(userId, lookbackStart, today);
  const inWindow = selectNightsInWindow(journal, { today });

  const sleepDebt = Math.round(
    inWindow.reduce((sum, n) => sum + nightlyDeficit(n.hours), 0) * 100,
  ) / 100;
  const vitality = vitalityFromSleepDebt(sleepDebt);
  const opening = Number(profile.sleep_debt) || 0;
  const sleepTrend = sleepTrendFromDebt(opening, sleepDebt);

  const tonightHours = journal.find(n => String(n.date).slice(0, 10) === today)?.hours ?? 0;
  const extensionStreak = computeExtensionStreak(journal, { today });
  const extensionBonusPct = combinedExtensionBonusPct(tonightHours, extensionStreak);

  await db.upsertCharacterProfile(userId, {
    vitality,
    sleep_debt: sleepDebt,
    sleep_trend: sleepTrend,
    sleep_extension_streak: extensionStreak,
  });

  console.log(
    `[SLEEP-DEBT] ${userId.slice(0, 8)}… 14-day rolling debt: ${opening} → ${sleepDebt} ` +
    `(${inWindow.length} logged night(s) in window); extension streak ${extensionStreak} ` +
    `(tonight +${extensionBonusPct}%)`,
  );

  return {
    nights: inWindow.map(n => ({ ...n, deficit: nightlyDeficit(n.hours) })),
    sleepDebt,
    vitality,
    sleepTrend,
    extensionStreak,
    extensionBonusPct,
  };
}

export async function syncSleepDebtFromJournalSafe(userId: string): Promise<void> {
  try {
    await syncSleepDebtFromJournal(userId);
  } catch (err) {
    console.warn(
      `[SLEEP-DEBT] sync skipped: ${err instanceof Error ? err.message : err}`,
    );
  }
}
