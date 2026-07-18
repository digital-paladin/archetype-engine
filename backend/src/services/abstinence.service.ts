/**
 * Phase 2.10 / Sprint S5 — Abstinence streak counters.
 * Pure helpers are unit-tested; DB ops use Supabase admin.
 */

import { getSupabaseAdmin } from '../lib/supabase';
import {
  ABSTINENCE_AMCC_LABELS,
  ABSTINENCE_AMCC_TOOLTIP,
  ABSTINENCE_ITEM_INDICES,
  isAbstinenceItem,
} from '../config/acm.config';

export type BreakType = 'unscheduled' | 'scheduled';

export interface BreakLogEntry {
  date: string;
  type: BreakType;
  streak_at_break: number;
  compound_break: boolean;
}

export interface ResistanceEvent {
  date: string;
  note: string;
}

export interface AbstinenceStreakRow {
  id: string;
  user_id: string;
  item_index: number;
  current_streak: number;
  longest_streak: number;
  last_break_date: string | null;
  last_break_type: BreakType | null;
  break_log: BreakLogEntry[];
  resistance_events: ResistanceEvent[];
  created_at?: string;
}

export interface StreakPublicView {
  item_index: number;
  current_streak: number;
  longest_streak: number;
  last_break_date: string | null;
  last_break_type: BreakType | null;
  broke_today: boolean;
  amcc_label: string;
  amcc_tooltip: string;
  resistance_events: ResistanceEvent[];
  break_log: BreakLogEntry[];
}

export function todayChicago(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

export function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizeStreakRow(raw: Record<string, unknown>): AbstinenceStreakRow {
  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    item_index: Number(raw.item_index),
    current_streak: Number(raw.current_streak ?? 0),
    longest_streak: Number(raw.longest_streak ?? 0),
    last_break_date: (raw.last_break_date as string | null) ?? null,
    last_break_type: (raw.last_break_type as BreakType | null) ?? null,
    break_log: parseJsonArray<BreakLogEntry>(raw.break_log),
    resistance_events: parseJsonArray<ResistanceEvent>(raw.resistance_events),
    created_at: raw.created_at as string | undefined,
  };
}

export function toPublicView(row: AbstinenceStreakRow, today: string): StreakPublicView {
  return {
    item_index: row.item_index,
    current_streak: row.current_streak,
    longest_streak: row.longest_streak,
    last_break_date: row.last_break_date,
    last_break_type: row.last_break_type,
    broke_today: row.last_break_date === today,
    amcc_label: ABSTINENCE_AMCC_LABELS[row.item_index] ?? '+aMCC  Resistance',
    amcc_tooltip: ABSTINENCE_AMCC_TOOLTIP,
    resistance_events: row.resistance_events,
    break_log: row.break_log,
  };
}

/** Pure: detect compound break from sibling rows (already broken today). */
export function detectCompoundBreak(
  rows: AbstinenceStreakRow[],
  itemIndex: number,
  today: string,
): boolean {
  return rows.some(
    (r) => r.item_index !== itemIndex && r.last_break_date === today,
  );
}

export type BreakComputeResult =
  | {
      ok: true;
      updated: AbstinenceStreakRow;
      compound_break: boolean;
      already_broken_today: boolean;
    }
  | {
      ok: false;
      error: string;
    };

/** Pure break apply — used by unit tests + service. */
export function applyBreak(
  row: AbstinenceStreakRow,
  allRows: AbstinenceStreakRow[],
  today: string,
  breakType: BreakType = 'unscheduled',
): BreakComputeResult {
  if (!isAbstinenceItem(row.item_index)) {
    return { ok: false, error: 'item_index is not an abstinence item' };
  }
  if (row.last_break_date === today) {
    return {
      ok: true,
      updated: row,
      compound_break: detectCompoundBreak(allRows, row.item_index, today),
      already_broken_today: true,
    };
  }

  const compound = detectCompoundBreak(allRows, row.item_index, today);
  const entry: BreakLogEntry = {
    date: today,
    type: breakType,
    streak_at_break: row.current_streak,
    compound_break: compound,
  };

  return {
    ok: true,
    updated: {
      ...row,
      current_streak: 0,
      last_break_date: today,
      last_break_type: breakType,
      break_log: [...row.break_log, entry],
    },
    compound_break: compound,
    already_broken_today: false,
  };
}

export interface IncrementResult {
  updated: AbstinenceStreakRow;
  incremented: boolean;
  new_record: boolean;
}

/** Pure daily increment for one row. */
export function applyDailyIncrement(row: AbstinenceStreakRow, today: string): IncrementResult {
  if (row.last_break_date === today) {
    return { updated: row, incremented: false, new_record: false };
  }
  const next = row.current_streak + 1;
  const newRecord = next > row.longest_streak;
  return {
    updated: {
      ...row,
      current_streak: next,
      longest_streak: newRecord ? next : row.longest_streak,
    },
    incremented: true,
    new_record: newRecord,
  };
}

export function appendResistance(
  row: AbstinenceStreakRow,
  today: string,
  note: string,
): { ok: true; updated: AbstinenceStreakRow } | { ok: false; error: string } {
  const trimmed = note.trim();
  if (!trimmed) return { ok: false, error: 'note is required' };
  if (trimmed.length > 280) return { ok: false, error: 'note max 280 characters' };
  return {
    ok: true,
    updated: {
      ...row,
      resistance_events: [...row.resistance_events, { date: today, note: trimmed }],
    },
  };
}

export async function seedAbstinenceStreaks(
  userId: string,
  opts?: { currentStreak?: number; longestStreak?: number },
): Promise<void> {
  const admin = getSupabaseAdmin();
  const current = opts?.currentStreak ?? 0;
  const longest = opts?.longestStreak ?? current;
  const rows = ABSTINENCE_ITEM_INDICES.map((item_index) => ({
    user_id: userId,
    item_index,
    current_streak: current,
    longest_streak: longest,
    break_log: [],
    resistance_events: [],
  }));

  const { error } = await admin.from('abstinence_streaks').upsert(rows, {
    onConflict: 'user_id,item_index',
    ignoreDuplicates: false,
  });
  if (error) throw new Error(`abstinence_streaks seed failed: ${error.message}`);
}

export async function ensureAbstinenceRows(userId: string): Promise<AbstinenceStreakRow[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('abstinence_streaks')
    .select('*')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);

  let rows = (data ?? []).map((r) => normalizeStreakRow(r as Record<string, unknown>));
  const have = new Set(rows.map((r) => r.item_index));
  const missing = ABSTINENCE_ITEM_INDICES.filter((i) => !have.has(i));
  if (missing.length > 0) {
    await seedAbstinenceStreaks(userId);
    const { data: again, error: err2 } = await admin
      .from('abstinence_streaks')
      .select('*')
      .eq('user_id', userId);
    if (err2) throw new Error(err2.message);
    rows = (again ?? []).map((r) => normalizeStreakRow(r as Record<string, unknown>));
  }
  return rows.sort((a, b) => a.item_index - b.item_index);
}

export async function getStreaksForUser(userId: string, today = todayChicago()): Promise<StreakPublicView[]> {
  const rows = await ensureAbstinenceRows(userId);
  return rows.map((r) => toPublicView(r, today));
}

export async function logBreak(params: {
  userId: string;
  itemIndex: number;
  breakType?: BreakType;
  today?: string;
}): Promise<{
  streak: StreakPublicView;
  compound_break: boolean;
  already_broken_today: boolean;
}> {
  const today = params.today ?? todayChicago();
  const breakType = params.breakType ?? 'unscheduled';

  if (!isAbstinenceItem(params.itemIndex)) {
    throw new Error('item_index is not an abstinence item');
  }
  if (breakType === 'scheduled') {
    throw new Error('scheduled breaks are not enabled yet (Phase 3)');
  }

  const rows = await ensureAbstinenceRows(params.userId);
  const row = rows.find((r) => r.item_index === params.itemIndex);
  if (!row) throw new Error('streak row missing');

  const result = applyBreak(row, rows, today, breakType);
  if (!result.ok) throw new Error(result.error);

  if (!result.already_broken_today) {
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('abstinence_streaks')
      .update({
        current_streak: result.updated.current_streak,
        last_break_date: result.updated.last_break_date,
        last_break_type: result.updated.last_break_type,
        break_log: result.updated.break_log,
      })
      .eq('user_id', params.userId)
      .eq('item_index', params.itemIndex);
    if (error) throw new Error(error.message);
  }

  return {
    streak: toPublicView(result.updated, today),
    compound_break: result.compound_break,
    already_broken_today: result.already_broken_today,
  };
}

export async function logResistanceEvent(params: {
  userId: string;
  itemIndex: number;
  note: string;
  today?: string;
}): Promise<StreakPublicView> {
  const today = params.today ?? todayChicago();
  if (!isAbstinenceItem(params.itemIndex)) {
    throw new Error('item_index is not an abstinence item');
  }
  const rows = await ensureAbstinenceRows(params.userId);
  const row = rows.find((r) => r.item_index === params.itemIndex);
  if (!row) throw new Error('streak row missing');

  const appended = appendResistance(row, today, params.note);
  if (!appended.ok) throw new Error(appended.error);

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('abstinence_streaks')
    .update({ resistance_events: appended.updated.resistance_events })
    .eq('user_id', params.userId)
    .eq('item_index', params.itemIndex);
  if (error) throw new Error(error.message);

  return toPublicView(appended.updated, today);
}

export async function getResistanceEvents(
  userId: string,
  itemIndex: number,
): Promise<ResistanceEvent[]> {
  if (!isAbstinenceItem(itemIndex)) {
    throw new Error('item_index is not an abstinence item');
  }
  const rows = await ensureAbstinenceRows(userId);
  const row = rows.find((r) => r.item_index === itemIndex);
  return row?.resistance_events ?? [];
}

/**
 * Increment all abstinence rows with no break today.
 * Returns count of rows updated + new-record crossings.
 */
export async function runDailyIncrement(today = todayChicago()): Promise<{
  scanned: number;
  incremented: number;
  new_records: Array<{ user_id: string; item_index: number; streak: number }>;
}> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('abstinence_streaks').select('*');
  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((r) => normalizeStreakRow(r as Record<string, unknown>));
  let incremented = 0;
  const new_records: Array<{ user_id: string; item_index: number; streak: number }> = [];

  for (const row of rows) {
    const result = applyDailyIncrement(row, today);
    if (!result.incremented) continue;
    const { error: upErr } = await admin
      .from('abstinence_streaks')
      .update({
        current_streak: result.updated.current_streak,
        longest_streak: result.updated.longest_streak,
      })
      .eq('id', row.id);
    if (upErr) {
      console.error(`[abstinence] increment failed id=${row.id}: ${upErr.message}`);
      continue;
    }
    incremented += 1;
    if (result.new_record) {
      new_records.push({
        user_id: row.user_id,
        item_index: row.item_index,
        streak: result.updated.current_streak,
      });
    }
  }

  return { scanned: rows.length, incremented, new_records };
}
