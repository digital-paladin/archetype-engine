/**
 * Pure-logic unit tests for abstinence.service (no DB).
 */

import {
  applyBreak,
  applyDailyIncrement,
  appendResistance,
  detectCompoundBreak,
  normalizeStreakRow,
  parseJsonArray,
  toPublicView,
  type AbstinenceStreakRow,
} from '../services/abstinence.service';

function row(partial: Partial<AbstinenceStreakRow> & { item_index: number }): AbstinenceStreakRow {
  return {
    id: partial.id ?? 'id-1',
    user_id: partial.user_id ?? 'user-1',
    item_index: partial.item_index,
    current_streak: partial.current_streak ?? 10,
    longest_streak: partial.longest_streak ?? 20,
    last_break_date: partial.last_break_date ?? null,
    last_break_type: partial.last_break_type ?? null,
    break_log: partial.break_log ?? [],
    resistance_events: partial.resistance_events ?? [],
  };
}

describe('abstinence.service pure helpers', () => {
  const today = '2026-07-17';

  it('parseJsonArray handles array and JSON string', () => {
    expect(parseJsonArray([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(parseJsonArray('[{"date":"2026-01-01"}]')).toEqual([{ date: '2026-01-01' }]);
    expect(parseJsonArray(null)).toEqual([]);
  });

  it('normalizeStreakRow + toPublicView', () => {
    const n = normalizeStreakRow({
      id: 'x',
      user_id: 'u',
      item_index: 0,
      current_streak: 5,
      longest_streak: 9,
      last_break_date: today,
      last_break_type: 'unscheduled',
      break_log: [],
      resistance_events: '[]',
    });
    const view = toPublicView(n, today);
    expect(view.broke_today).toBe(true);
    expect(view.amcc_label).toContain('Very High');
  });

  it('detectCompoundBreak true when sibling broken today', () => {
    const rows = [
      row({ item_index: 0, last_break_date: null }),
      row({ item_index: 10, last_break_date: today }),
    ];
    expect(detectCompoundBreak(rows, 0, today)).toBe(true);
    expect(detectCompoundBreak(rows, 10, today)).toBe(false);
  });

  it('applyBreak resets streak and appends break_log', () => {
    const alcohol = row({ item_index: 0, current_streak: 47 });
    const sexual = row({ item_index: 10, last_break_date: null });
    const result = applyBreak(alcohol, [alcohol, sexual], today, 'unscheduled');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.already_broken_today).toBe(false);
    expect(result.compound_break).toBe(false);
    expect(result.updated.current_streak).toBe(0);
    expect(result.updated.last_break_date).toBe(today);
    expect(result.updated.break_log).toHaveLength(1);
    expect(result.updated.break_log[0].streak_at_break).toBe(47);
    expect(result.updated.break_log[0].compound_break).toBe(false);
  });

  it('applyBreak sets compound_break when sibling already broken', () => {
    const alcohol = row({ item_index: 0, current_streak: 12 });
    const sexual = row({ item_index: 10, last_break_date: today, current_streak: 0 });
    const result = applyBreak(alcohol, [alcohol, sexual], today);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compound_break).toBe(true);
    expect(result.updated.break_log[0].compound_break).toBe(true);
  });

  it('applyBreak is idempotent if already broken today', () => {
    const alcohol = row({
      item_index: 0,
      current_streak: 0,
      last_break_date: today,
      break_log: [{ date: today, type: 'unscheduled', streak_at_break: 5, compound_break: false }],
    });
    const result = applyBreak(alcohol, [alcohol], today);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.already_broken_today).toBe(true);
    expect(result.updated.break_log).toHaveLength(1);
  });

  it('applyDailyIncrement skips rows broken today', () => {
    const r = applyDailyIncrement(row({ item_index: 0, last_break_date: today, current_streak: 0 }), today);
    expect(r.incremented).toBe(false);
    expect(r.new_record).toBe(false);
  });

  it('applyDailyIncrement bumps streak and fires new_record when exceeding longest', () => {
    const r = applyDailyIncrement(
      row({ item_index: 0, current_streak: 20, longest_streak: 20, last_break_date: null }),
      today,
    );
    expect(r.incremented).toBe(true);
    expect(r.new_record).toBe(true);
    expect(r.updated.current_streak).toBe(21);
    expect(r.updated.longest_streak).toBe(21);

    // Each new high is a record; equal-to-longest after update does not fire on same day twice
    const plateau = applyDailyIncrement(
      row({ item_index: 0, current_streak: 21, longest_streak: 21, last_break_date: today }),
      today,
    );
    expect(plateau.incremented).toBe(false);
    expect(plateau.new_record).toBe(false);
  });

  it('appendResistance validates note and does not touch streak', () => {
    const base = row({ item_index: 0, current_streak: 15 });
    expect(appendResistance(base, today, '   ').ok).toBe(false);
    const ok = appendResistance(base, today, 'Turned down open bar');
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.updated.current_streak).toBe(15);
    expect(ok.updated.resistance_events).toHaveLength(1);
    expect(ok.updated.resistance_events[0].note).toBe('Turned down open bar');
  });
});
