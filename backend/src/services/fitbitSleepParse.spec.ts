import { parseFitbitSleepDay, parseFitbitSleepRange } from './fitbitSleepParse';

describe('parseFitbitSleepRange', () => {
  it('groups range logs by dateOfSleep', () => {
    const parsed = parseFitbitSleepRange({
      sleep: [
        {
          dateOfSleep: '2026-08-12',
          isMainSleep: true,
          minutesAsleep: 330,
          timeInBed: 360,
          startTime: '2026-08-12T00:30:00.000',
          endTime: '2026-08-12T06:30:00.000',
          levels: { summary: { deep: { minutes: 40 }, rem: { minutes: 80 }, light: { minutes: 200 }, wake: { minutes: 30 } } },
        },
        {
          dateOfSleep: '2026-08-11',
          isMainSleep: true,
          minutesAsleep: 204,
          timeInBed: 240,
        },
      ],
    });
    const byDate = Object.fromEntries(parsed.map(p => [p.date, p]));
    expect(byDate['2026-08-12'].hours).toBe(5.5);
    expect(byDate['2026-08-12'].startTime).toBe('00:30');
    expect(byDate['2026-08-11'].hours).toBe(3.4);
  });
});

describe('parseFitbitSleepDay', () => {
  it('uses summary totals for a single-day payload', () => {
    const day = parseFitbitSleepDay({
      summary: { totalMinutesAsleep: 480, totalTimeInBed: 500, stages: { deep: 90, rem: 100, light: 270, wake: 20 } },
      sleep: [{ isMainSleep: true, startTime: '2026-08-01T23:00:00.000', endTime: '2026-08-02T07:00:00.000' }],
    });
    expect(day.hours).toBe(8);
    expect(day.startTime).toBe('23:00');
  });
});
