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

export function vitalityFromSleepDebt(debt: number): number {
  return debt > 5
    ? Math.round(Math.max(0, 100 - (debt - 5) * 3) * 10) / 10
    : 100;
}

export function sleepTrendFromDebt(prev: number, next: number): 'Increased' | 'Decreased' | 'Stable' {
  if (next > prev + 0.05) return 'Increased';
  if (next < prev - 0.05) return 'Decreased';
  return 'Stable';
}

export async function syncSleepDebtFromJournal(
  userId: string,
  db: SleepDebtDb = getDataService(),
  today: string = localDateStr(),
): Promise<SleepDebtSyncResult | null> {
  const profile = await db.getCharacterProfile(userId);
  if (!profile) return null;

  const windowStart = addCalendarDays(today, -(SLEEP_DEBT_WINDOW_DAYS - 1));
  const journal = await db.listJournalSleepRange(userId, windowStart, today);
  const inWindow = selectNightsInWindow(journal, { today });

  const sleepDebt = Math.round(
    inWindow.reduce((sum, n) => sum + nightlyDeficit(n.hours), 0) * 100,
  ) / 100;
  const vitality = vitalityFromSleepDebt(sleepDebt);
  const opening = Number(profile.sleep_debt) || 0;
  const sleepTrend = sleepTrendFromDebt(opening, sleepDebt);

  await db.upsertCharacterProfile(userId, {
    vitality,
    sleep_debt: sleepDebt,
    sleep_trend: sleepTrend,
  });

  console.log(
    `[SLEEP-DEBT] ${userId.slice(0, 8)}… 14-day rolling debt: ${opening} → ${sleepDebt} ` +
    `(${inWindow.length} logged night(s) in window)`,
  );

  return {
    nights: inWindow.map(n => ({ ...n, deficit: nightlyDeficit(n.hours) })),
    sleepDebt,
    vitality,
    sleepTrend,
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
