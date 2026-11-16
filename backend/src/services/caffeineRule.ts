/**
 * Paul's caffeine rule (approved Nov 15, 2026).
 *
 * A logged caffeine milligram dose refreshes two status effects and nothing else.
 * Caffeinated is a status-only buff: 5 hours from the latest dose, extended
 * rather than stacked, and it pays no XP. Sleep Risk is a warning debuff when
 * a dose is at or after 2:00 PM America/Chicago, or the Chicago day's total
 * is over 400 mg. It lasts until 6:00 AM America/Chicago the next day and
 * pays no XP. Neither effect grants fat-burning credit.
 *
 * The Oura/journal sleep flag is read-only. A night under 70 after afternoon
 * caffeine the prior Chicago day is a one-line note. No XP is removed.
 */

import { randomUUID } from 'crypto';
import { StatusEffect } from '../models/statusEffect';
import { EffectDraft, addCalendarDays, localDateInZone, zonedParts } from './consumptionEffects';
import { FoodLogItem } from './data/IDataService';
import { getDataService } from './data/dataService';
import { OuraSummaryRecord, getOuraSummaryByDate } from './ouraSummaryStore';
import { getStatusEffectStore } from './statusEffect.store';
import { removeEffectByKey } from './statusEffects.service';

export const CAFFEINE_RULE_ZONE = 'America/Chicago';
export const CAFFEINE_BUFF_MS = 5 * 60 * 60 * 1000;
export const CAFFEINE_AFTERNOON_MINUTES = 14 * 60;
export const CAFFEINE_DAILY_LIMIT_MG = 400;
export const CAFFEINE_MORNING_HOUR = 6;
/** Caffeine never awards or removes XP. */
export const CAFFEINE_RULE_XP = 0;

export const CAFFEINATED_KEY = 'caffeinated';
export const CAFFEINATED_NAME = 'Caffeinated';
export const SLEEP_RISK_KEY = 'caffeine-sleep-risk';
export const SLEEP_RISK_NAME = 'Sleep Risk';

export interface CaffeineIntake {
  at: string;
  mg: number;
  itemName: string;
  entryId?: string;
}

export interface CaffeineWindow {
  start: Date;
  end: Date;
  doses: CaffeineIntake[];
  latest: CaffeineIntake;
}

export interface CaffeineSleepFlag {
  date: string;
  priorDate: string;
  sleepScore: number | null;
  flagged: boolean;
  /** One line for a nightly report, or null when the condition is not met. */
  flag: string | null;
  xpDelta: 0;
}

export function chicagoDateOf(at: Date): string {
  return localDateInZone(at, CAFFEINE_RULE_ZONE);
}

/** Minutes after midnight in America/Chicago. DST is resolved by the zone, not a fixed offset. */
export function chicagoClockMinutes(at: Date): number {
  const parts = zonedParts(at, CAFFEINE_RULE_ZONE);
  const hour = parts.hour === 24 ? 0 : parts.hour;
  return hour * 60 + parts.minute;
}

export function isAtOrAfterChicagoAfternoon(at: Date): boolean {
  return chicagoClockMinutes(at) >= CAFFEINE_AFTERNOON_MINUTES;
}

/**
 * UTC instant of a wall-clock time in America/Chicago.
 * 6:00 AM is outside the DST gap and the fall-back overlap, so the result is unique.
 */
export function chicagoWallToUtc(date: string, hour: number, minute: number): Date {
  const [year, month, day] = date.split('-').map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let utc = desiredUtc;
  for (let i = 0; i < 4; i++) {
    const parts = zonedParts(new Date(utc), CAFFEINE_RULE_ZONE);
    const hourPart = parts.hour === 24 ? 0 : parts.hour;
    const observed = Date.UTC(parts.year, parts.month - 1, parts.day, hourPart, parts.minute, 0, 0);
    const next = desiredUtc - (observed - utc);
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc);
}

/** 6:00 AM America/Chicago on the calendar day after `day`. */
export function nextChicagoMorning(day: string): Date {
  return chicagoWallToUtc(addCalendarDays(day, 1), CAFFEINE_MORNING_HOUR, 0);
}

export function dedupeIntakes(doses: CaffeineIntake[]): CaffeineIntake[] {
  const seen = new Set<string>();
  const out: CaffeineIntake[] = [];
  for (const dose of doses) {
    if (typeof dose.mg !== 'number' || !(dose.mg > 0) || typeof dose.at !== 'string') continue;
    const at = new Date(dose.at);
    if (Number.isNaN(at.getTime())) continue;
    const iso = at.toISOString();
    const key = dose.entryId
      ? `id:${dose.entryId}`
      : `raw:${iso}:${dose.mg}:${dose.itemName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      at: iso,
      mg: dose.mg,
      itemName: dose.itemName?.trim() || 'Caffeine',
      ...(dose.entryId ? { entryId: dose.entryId } : {}),
    });
  }
  out.sort((a, b) => a.at.localeCompare(b.at) || (a.entryId ?? '').localeCompare(b.entryId ?? ''));
  return out;
}

export function intakesFromFoodLog(
  items: Array<Pick<FoodLogItem, 'id' | 'item' | 'ts' | 'caffeineMg'>> | null | undefined,
): CaffeineIntake[] {
  if (!items) return [];
  return dedupeIntakes(items.map(item => ({
    at: item.ts,
    mg: item.caffeineMg ?? 0,
    itemName: item.item,
    entryId: item.id,
  })));
}

export function intakesFromFoodDays(
  days: Array<{ food_log?: FoodLogItem[] | null }>,
): CaffeineIntake[] {
  const all: CaffeineIntake[] = [];
  for (const day of days) all.push(...intakesFromFoodLog(day.food_log));
  return dedupeIntakes(all);
}

export function dosesOnChicagoDay(doses: CaffeineIntake[], day: string): CaffeineIntake[] {
  return dedupeIntakes(doses).filter(dose => chicagoDateOf(new Date(dose.at)) === day);
}

export function dailyCaffeineMg(doses: CaffeineIntake[], day: string): number {
  return dosesOnChicagoDay(doses, day).reduce((sum, dose) => sum + dose.mg, 0);
}

export function dayTriggersSleepRisk(doses: CaffeineIntake[], day: string): boolean {
  const dayDoses = dosesOnChicagoDay(doses, day);
  if (dayDoses.length === 0) return false;
  if (dailyCaffeineMg(dayDoses, day) > CAFFEINE_DAILY_LIMIT_MG) return true;
  return dayDoses.some(dose => isAtOrAfterChicagoAfternoon(new Date(dose.at)));
}

/**
 * The chain covering `now`. A later dose extends the end by 5 hours while the
 * previous window is still open (expiry is exclusive). A dose at the exact
 * expiry starts a new window instead of stacking a second effect.
 */
export function caffeineWindow(doses: CaffeineIntake[], now: Date): CaffeineWindow | null {
  const sorted = dedupeIntakes(doses);
  if (sorted.length === 0) return null;
  const nowMs = now.getTime();
  let startMs = new Date(sorted[0].at).getTime();
  let endMs = startMs + CAFFEINE_BUFF_MS;
  let chain: CaffeineIntake[] = [sorted[0]];
  let active: { startMs: number; endMs: number; chain: CaffeineIntake[] } | null = null;
  const remember = (from: number, until: number, dosesInChain: CaffeineIntake[]) => {
    if (until > nowMs && from <= nowMs) {
      active = { startMs: from, endMs: until, chain: dosesInChain };
    }
  };
  for (let i = 1; i < sorted.length; i++) {
    const atMs = new Date(sorted[i].at).getTime();
    if (atMs < endMs) {
      endMs = atMs + CAFFEINE_BUFF_MS;
      chain = [...chain, sorted[i]];
    } else {
      remember(startMs, endMs, chain);
      startMs = atMs;
      endMs = atMs + CAFFEINE_BUFF_MS;
      chain = [sorted[i]];
    }
  }
  remember(startMs, endMs, chain);
  if (!active) return null;
  const found: { startMs: number; endMs: number; chain: CaffeineIntake[] } = active;
  return {
    start: new Date(found.startMs),
    end: new Date(found.endMs),
    doses: found.chain,
    latest: found.chain[found.chain.length - 1],
  };
}

function formatMg(mg: number): string {
  const rounded = Math.round(mg * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function sourceNames(doses: CaffeineIntake[]): string {
  const names: string[] = [];
  for (const dose of doses) {
    if (dose.itemName && !names.includes(dose.itemName)) names.push(dose.itemName);
  }
  return names.join(' + ') || 'Caffeine';
}

function sleepRiskStart(doses: CaffeineIntake[], day: string): Date {
  const dayDoses = dosesOnChicagoDay(doses, day);
  let total = 0;
  for (const dose of dayDoses) {
    total += dose.mg;
    const at = new Date(dose.at);
    if (isAtOrAfterChicagoAfternoon(at) || total > CAFFEINE_DAILY_LIMIT_MG) return at;
  }
  return new Date(dayDoses[dayDoses.length - 1].at);
}

function caffeinatedDraft(window: CaffeineWindow): EffectDraft {
  return {
    effectKey: CAFFEINATED_KEY,
    name: CAFFEINATED_NAME,
    type: 'buff',
    category: 'substance',
    source: sourceNames(window.doses),
    icon: '☕',
    effects: [],
    duration: Math.max(1, Math.round((window.end.getTime() - window.start.getTime()) / 60000)),
    dose: `${formatMg(window.latest.mg)} mg caffeine`,
    notes: 'Status only. Lasts 5 hours from the latest dose and does not stack. Pays no XP.',
    autoApplied: true,
    meta: {
      kind: CAFFEINATED_KEY,
      xp: CAFFEINE_RULE_XP,
      fatBurn: false,
      doses: window.doses,
      latestAt: window.latest.at,
    },
  };
}

function sleepRiskDraft(doses: CaffeineIntake[], day: string): EffectDraft {
  const dayDoses = dosesOnChicagoDay(doses, day);
  const total = dailyCaffeineMg(dayDoses, day);
  const late = dayDoses.some(dose => isAtOrAfterChicagoAfternoon(new Date(dose.at)));
  const reasons: string[] = [];
  if (late) reasons.push('at or after 2:00 PM America/Chicago');
  if (total > CAFFEINE_DAILY_LIMIT_MG) reasons.push(`${formatMg(total)} mg on ${day}`);
  return {
    effectKey: SLEEP_RISK_KEY,
    name: SLEEP_RISK_NAME,
    type: 'debuff',
    category: 'substance',
    source: sourceNames(dayDoses),
    icon: '🌙',
    effects: [],
    duration: 1,
    dose: reasons.join('; ') || 'caffeine',
    notes: 'Warning only. Lasts until 6:00 AM America/Chicago the next day. Pays no XP.',
    autoApplied: true,
    meta: {
      kind: SLEEP_RISK_KEY,
      xp: CAFFEINE_RULE_XP,
      fatBurn: false,
      chicagoDate: day,
      totalMg: total,
      doses: dayDoses,
    },
  };
}

async function saveKeyedEffect(
  userId: string,
  draft: EffectDraft,
  appliedAt: Date,
  expiresAt: Date,
): Promise<StatusEffect> {
  const store = getStatusEffectStore();
  const existing = await store.findByKey(userId, draft.effectKey);
  const effect: StatusEffect = {
    id: existing?.id ?? randomUUID(),
    name: draft.name,
    type: draft.type,
    category: draft.category,
    source: draft.source,
    icon: draft.icon,
    effects: [],
    appliedAt: appliedAt.toISOString(),
    duration: Math.max(1, Math.round((expiresAt.getTime() - appliedAt.getTime()) / 60000)),
    expiresAt: expiresAt.toISOString(),
    notes: draft.notes,
    dose: draft.dose,
    effectKey: draft.effectKey,
    autoApplied: true,
    meta: draft.meta,
  };
  if (existing) return store.update(userId, effect);
  return store.insert(userId, effect);
}

/**
 * Recompute both effects from the intake list. The same list writes the same
 * row ids, so a replay cannot duplicate them.
 */
export async function syncCaffeineRule(userId: string, raw: CaffeineIntake[]): Promise<StatusEffect[]> {
  const doses = dedupeIntakes(raw);
  if (doses.length === 0) {
    await removeEffectByKey(userId, CAFFEINATED_KEY);
    await removeEffectByKey(userId, SLEEP_RISK_KEY);
    return [];
  }

  const latest = doses[doses.length - 1];
  const now = new Date(latest.at);
  const saved: StatusEffect[] = [];
  const window = caffeineWindow(doses, now);
  if (!window) {
    await removeEffectByKey(userId, CAFFEINATED_KEY);
  } else {
    saved.push(await saveKeyedEffect(userId, caffeinatedDraft(window), window.start, window.end));
  }

  const day = chicagoDateOf(now);
  const existing = await getStatusEffectStore().findByKey(userId, SLEEP_RISK_KEY);
  if (dayTriggersSleepRisk(doses, day)) {
    const start = sleepRiskStart(doses, day);
    const end = nextChicagoMorning(day);
    saved.push(await saveKeyedEffect(userId, sleepRiskDraft(doses, day), start, end));
  } else if (existing?.meta && (existing.meta as { chicagoDate?: string }).chicagoDate === day) {
    await removeEffectByKey(userId, SLEEP_RISK_KEY);
  } else if (existing?.expiresAt && new Date(existing.expiresAt).getTime() > now.getTime()) {
    saved.push(existing);
  }
  return saved;
}

export function caffeineSleepFlagLine(
  sleepScore: number | null,
  priorDay: CaffeineIntake[],
): string | null {
  if (sleepScore == null || !Number.isFinite(sleepScore) || sleepScore <= 0 || sleepScore >= 70) return null;
  const late = dedupeIntakes(priorDay).some(dose => isAtOrAfterChicagoAfternoon(new Date(dose.at)));
  if (!late) return null;
  const shown = Number.isInteger(sleepScore) ? String(sleepScore) : String(Math.round(sleepScore * 10) / 10);
  return `Sleep score ${shown} after caffeine at or after 2:00 PM America/Chicago the prior day.`;
}

function ouraNight(row: OuraSummaryRecord | null): { recorded: boolean; score: number | null } {
  if (!row || row.no_data || !row.sleep || row.sleep.missing) return { recorded: false, score: null };
  const score = typeof row.sleep.score === 'number' && row.sleep.score > 0 ? row.sleep.score : null;
  const hours = typeof row.sleep.hours === 'number' ? row.sleep.hours : 0;
  if (score == null && !(hours > 0)) return { recorded: false, score: null };
  return { recorded: true, score };
}

/** Oura wins when that night was stored. Otherwise the journal score is used. A missing score is not under 70. */
export async function loadRuleSleepScore(userId: string, date: string): Promise<number | null> {
  try {
    const night = ouraNight(await getOuraSummaryByDate(userId, date));
    if (night.recorded) return night.score;
  } catch (err) {
    console.warn(`[CAFFEINE] Oura summary unread: ${err instanceof Error ? err.name : 'error'}`);
  }
  const entry = await getDataService().getJournalEntry(userId, date);
  if (!entry) return null;
  const score = typeof entry.fitbit_score === 'number' && entry.fitbit_score > 0 ? entry.fitbit_score : null;
  const hours = entry.sleep_hours ?? 0;
  if (score == null && !(hours > 0)) return null;
  return score;
}

export async function loadRuleIntakes(userId: string): Promise<CaffeineIntake[]> {
  const days = await getDataService().listJournalFoodDays(userId);
  return intakesFromFoodDays(days);
}

export async function readCaffeineSleepFlag(
  userId: string,
  date: string,
  deps?: {
    sleepScore?: (userId: string, date: string) => Promise<number | null>;
    intakes?: (userId: string) => Promise<CaffeineIntake[]>;
  },
): Promise<CaffeineSleepFlag> {
  const priorDate = addCalendarDays(date, -1);
  const sleepScore = await (deps?.sleepScore ?? loadRuleSleepScore)(userId, date);
  const intakes = await (deps?.intakes ?? loadRuleIntakes)(userId);
  const prior = dedupeIntakes(intakes).filter(dose => chicagoDateOf(new Date(dose.at)) === priorDate);
  const flag = caffeineSleepFlagLine(sleepScore, prior);
  return {
    date,
    priorDate,
    sleepScore,
    flagged: flag != null,
    flag,
    xpDelta: CAFFEINE_RULE_XP,
  };
}
