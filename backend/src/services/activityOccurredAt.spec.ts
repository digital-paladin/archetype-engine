import {
  ACTIVITY_BACKFILL_DAYS,
  ACTIVITY_FUTURE_TOLERANCE_MS,
  resolveActivityWhen,
  utcDayBounds,
} from './activityOccurredAt';

const NOW = new Date('2026-10-20T09:38:00.000Z'); // 4:38 AM America/Chicago

describe('resolveActivityWhen', () => {
  it('stamps the request time when no date is sent', () => {
    const resolved = resolveActivityWhen({}, NOW);
    expect(resolved.loggedAt).toBe(NOW.toISOString());
    expect(resolved.occurredAt).toBe(NOW.toISOString());
    expect(resolved.date).toBe('2026-10-20');
  });

  it('treats empty strings as omitted and falls through to the next field', () => {
    const resolved = resolveActivityWhen({ occurredAt: '  ', date: '', clientDate: '2026-10-19' }, NOW);
    expect(resolved.date).toBe('2026-10-19');
    expect(resolved.loggedAt).toBe('2026-10-19T12:00:00.000Z');
  });

  it('keeps request time when clientDate is today in UTC or Chicago', () => {
    const utcToday = resolveActivityWhen({ clientDate: '2026-10-20' }, NOW);
    expect(utcToday.loggedAt).toBe(NOW.toISOString());
    expect(utcToday.date).toBe('2026-10-20');

    // 10:38 PM CDT on Oct 19 is already Oct 20 UTC. The app's clientDate is still the 19th.
    const evening = new Date('2026-10-20T03:38:00.000Z');
    const chicagoToday = resolveActivityWhen({ clientDate: '2026-10-19' }, evening);
    expect(chicagoToday.loggedAt).toBe(evening.toISOString());
    expect(chicagoToday.date).toBe('2026-10-19');
  });

  it('anchors a past date-only value at noon UTC so the UTC day window includes it', () => {
    const resolved = resolveActivityWhen({ date: '2026-10-19' }, NOW);
    expect(resolved.date).toBe('2026-10-19');
    expect(resolved.loggedAt).toBe('2026-10-19T12:00:00.000Z');
    expect(resolved.occurredAt).toBe('2026-10-19T12:00:00.000Z');

    const bounds = utcDayBounds(resolved.date);
    expect(resolved.loggedAt >= bounds.start && resolved.loggedAt <= bounds.end).toBe(true);
  });

  it('accepts clientDate as the legacy alias for a past day', () => {
    const resolved = resolveActivityWhen({ clientDate: '2026-10-19' }, NOW);
    expect(resolved.loggedAt).toBe('2026-10-19T12:00:00.000Z');
  });

  it('stores a zoned timestamp on its civil day, including evenings that cross UTC midnight', () => {
    const sameUtcDay = resolveActivityWhen(
      { occurredAt: '2026-10-19T18:46:00-05:00' },
      NOW,
    );
    expect(sameUtcDay.date).toBe('2026-10-19');
    expect(sameUtcDay.occurredAt).toBe('2026-10-19T23:46:00.000Z');
    expect(sameUtcDay.loggedAt).toBe('2026-10-19T23:46:00.000Z');

    const crossesMidnight = resolveActivityWhen(
      { occurredAt: '2026-10-19T20:30:00-05:00' },
      NOW,
    );
    expect(crossesMidnight.date).toBe('2026-10-19');
    expect(crossesMidnight.occurredAt).toBe('2026-10-20T01:30:00.000Z');
    expect(crossesMidnight.loggedAt).toBe('2026-10-19T12:00:00.000Z');
  });

  it('prefers occurredAt over startTime over date', () => {
    const resolved = resolveActivityWhen({
      occurredAt: '2026-10-18T15:00:00.000Z',
      startTime: '2026-10-17T15:00:00.000Z',
      date: '2026-10-16',
    }, NOW);
    expect(resolved.loggedAt).toBe('2026-10-18T15:00:00.000Z');
    expect(resolved.date).toBe('2026-10-18');

    const fromStart = resolveActivityWhen({
      startTime: '2026-10-17T15:04:00Z',
      date: '2026-10-16',
    }, NOW);
    expect(fromStart.date).toBe('2026-10-17');
    expect(fromStart.loggedAt).toBe('2026-10-17T15:04:00.000Z');
  });

  it('allows a few minutes of future clock skew and rejects anything further ahead', () => {
    const within = new Date(NOW.getTime() + ACTIVITY_FUTURE_TOLERANCE_MS - 60_000).toISOString();
    expect(resolveActivityWhen({ occurredAt: within }, NOW).loggedAt).toBe(within);

    const beyond = new Date(NOW.getTime() + ACTIVITY_FUTURE_TOLERANCE_MS + 60_000).toISOString();
    expect(() => resolveActivityWhen({ occurredAt: beyond }, NOW)).toThrow(/future/);
    expect(() => resolveActivityWhen({ date: '2026-10-21' }, NOW)).toThrow(/future/);
  });

  it(`rejects civil dates older than ${ACTIVITY_BACKFILL_DAYS} days`, () => {
    const earliest = new Date(Date.UTC(2026, 9, 20 - ACTIVITY_BACKFILL_DAYS)).toISOString().slice(0, 10);
    expect(resolveActivityWhen({ date: earliest }, NOW).date).toBe(earliest);

    const tooOld = new Date(Date.UTC(2026, 9, 20 - ACTIVITY_BACKFILL_DAYS - 1)).toISOString().slice(0, 10);
    expect(() => resolveActivityWhen({ date: tooOld }, NOW)).toThrow(/backfill window/);
  });

  it('rejects unparseable values instead of falling through to a valid sibling field', () => {
    expect(() => resolveActivityWhen({ occurredAt: 'yesterday', date: '2026-10-19' }, NOW))
      .toThrow(/occurredAt/);
    expect(() => resolveActivityWhen({ startTime: '18:30' }, NOW)).toThrow(/startTime/);
    expect(() => resolveActivityWhen({ date: '2026-10-19T18:30:00' }, NOW)).toThrow(/timezone/);
    expect(() => resolveActivityWhen({ date: '2026-02-31' }, NOW)).toThrow(/not a valid calendar date/);
    expect(() => resolveActivityWhen({ clientDate: 20261019 as unknown as string }, NOW))
      .toThrow(/clientDate must be a string/);
  });
});

describe('utcDayBounds', () => {
  it('covers noon UTC and the whole UTC day', () => {
    expect(utcDayBounds('2026-10-19')).toEqual({
      start: '2026-10-19T00:00:00.000Z',
      end: '2026-10-19T23:59:59.999Z',
    });
  });
});
