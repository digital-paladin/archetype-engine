export interface SleepHistorySlot {
  date: string;
  hours: number;
  score: number;
}

/** YYYY-MM-DD in local calendar time (same as journal `entry_date`). */
export function localDateStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addCalendarDays(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

/** Newest first: [endInclusive, end-1, …] length `days`. */
export function calendarDaysNewestFirst(endInclusive: string, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    out.push(addCalendarDays(endInclusive, -i));
  }
  return out;
}

export function mergeJournalIntoCalendar(
  datesNewestFirst: string[],
  journal: Array<{ date: string; hours: number; score: number }>,
): SleepHistorySlot[] {
  const byDate = new Map<string, { hours: number; score: number }>();
  for (const row of journal) {
    const date = String(row.date).slice(0, 10);
    byDate.set(date, { hours: Number(row.hours) || 0, score: Number(row.score) || 0 });
  }
  return datesNewestFirst.map(date => {
    const hit = byDate.get(date);
    return { date, hours: hit?.hours ?? 0, score: hit?.score ?? 0 };
  });
}

export function missingSleepDates(slots: SleepHistorySlot[]): string[] {
  return slots.filter(s => !(s.hours > 0)).map(s => s.date);
}

export function applyWearableNights(
  slots: SleepHistorySlot[],
  nights: Array<{ date: string; hours: number; score: number }>,
): SleepHistorySlot[] {
  const byDate = new Map(nights.map(n => [String(n.date).slice(0, 10), n]));
  return slots.map(slot => {
    if (slot.hours > 0) return slot;
    const hit = byDate.get(slot.date);
    if (!hit || !(hit.hours > 0)) return slot;
    return {
      date: slot.date,
      hours: Number(hit.hours) || 0,
      score: Number(hit.score) || 0,
    };
  });
}
