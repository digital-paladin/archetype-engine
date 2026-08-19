import {
  applyWearableNights,
  calendarDaysNewestFirst,
  mergeJournalIntoCalendar,
  missingSleepDates,
} from './sleepHistoryCalendar';

describe('sleepHistoryCalendar', () => {
  it('returns exactly N newest-first calendar days', () => {
    const days = calendarDaysNewestFirst('2026-08-13', 30);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-08-13');
    expect(days[29]).toBe('2026-07-15');
    expect(new Set(days).size).toBe(30);
  });

  it('pads journal rows onto the calendar (not last-N-rows)', () => {
    const dates = calendarDaysNewestFirst('2026-08-13', 5);
    const slots = mergeJournalIntoCalendar(dates, [
      { date: '2026-06-01', hours: 8, score: 90 },
      { date: '2026-08-12', hours: 5.5, score: 79 },
    ]);
    expect(slots).toHaveLength(5);
    expect(slots[0]).toEqual({ date: '2026-08-13', hours: 0, score: 0 });
    expect(slots[1]).toEqual({ date: '2026-08-12', hours: 5.5, score: 79 });
    expect(slots.find(s => s.date === '2026-06-01')).toBeUndefined();
    expect(slots.every(s => Object.keys(s).sort().join() === 'date,hours,score')).toBe(true);
  });

  it('lists missing nights and fills from wearables without overwriting', () => {
    const slots = mergeJournalIntoCalendar(calendarDaysNewestFirst('2026-08-13', 3), [
      { date: '2026-08-13', hours: 7.4, score: 80 },
    ]);
    expect(missingSleepDates(slots)).toEqual(['2026-08-12', '2026-08-11']);
    const filled = applyWearableNights(slots, [
      { date: '2026-08-13', hours: 9, score: 99 },
      { date: '2026-08-12', hours: 3.4, score: 50 },
    ]);
    expect(filled[0].hours).toBe(7.4);
    expect(filled[1].hours).toBe(3.4);
  });
});
